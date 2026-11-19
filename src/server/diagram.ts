import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { connections, elements, portUses, routes, splitters } from "@/db/schema";
import { BOX_KINDS, SPLITTER_RATIOS, parsePort } from "@/lib/network";
import { type Actor, NotFoundError, requireRole } from "./access";

const uuid = z.string().uuid();
const port = z.string().min(3).max(120);

export const splitterAddInput = z
  .object({
    projectId: uuid,
    boxId: uuid,
    ratio: z.number().int().refine((n) => (SPLITTER_RATIOS as readonly number[]).includes(n), "Pick a ratio"),
  })
  .strict();
export const splitterRemoveInput = z.object({ projectId: uuid, splitterId: uuid }).strict();
export const connectInput = z
  .object({ projectId: uuid, boxId: uuid, a: port, b: port, id: uuid.optional() })
  .strict();
export const disconnectInput = z.object({ projectId: uuid, connectionId: uuid }).strict();
export const autoConnectInput = z.object({ projectId: uuid, boxId: uuid, routeId: uuid }).strict();

export class PortTakenError extends Error {
  constructor() {
    super("That port already has a connection");
    this.name = "PortTakenError";
  }
}

async function requireBox(projectId: string, boxId: string) {
  const [box] = await db.select().from(elements).where(and(eq(elements.id, boxId), eq(elements.projectId, projectId)));
  if (!box || !BOX_KINDS.includes(box.kind)) throw new NotFoundError("Box not found");
  return box;
}

/** What a box's diagram shows: cables touching it, its splitters, its customers. */
async function boxContents(projectId: string, boxId: string) {
  const [cables, boxSplitters] = await Promise.all([
    db.select().from(routes).where(and(eq(routes.projectId, projectId), or(eq(routes.fromElementId, boxId), eq(routes.toElementId, boxId)))),
    db.select().from(splitters).where(eq(splitters.boxId, boxId)),
  ]);
  const farIds = cables.map((r) => (r.fromElementId === boxId ? r.toElementId : r.fromElementId)).filter((id): id is string => !!id);
  const far = farIds.length ? await db.select().from(elements).where(inArray(elements.id, farIds)) : [];
  return { cables, splitters: boxSplitters, far };
}

async function validatePort(projectId: string, boxId: string, key: string) {
  const p = parsePort(key);
  if (!p) throw new Error("Unknown port");
  const contents = await boxContents(projectId, boxId);
  if (p.type === "f") {
    const cable = contents.cables.find((r) => r.id === p.routeId);
    if (!cable || !Number.isInteger(p.fiber) || p.fiber < 1 || p.fiber > cable.fiberCount) throw new Error("That fiber isn't in this box");
  } else if (p.type === "si" || p.type === "so") {
    const sp = contents.splitters.find((s) => s.id === p.splitterId);
    if (!sp) throw new Error("That splitter isn't in this box");
    if (p.type === "so" && (!Number.isInteger(p.output) || p.output < 1 || p.output > sp.ratio)) throw new Error("No such splitter output");
  } else if (!contents.far.some((e) => e.id === p.customerId && e.kind === "customer")) {
    throw new Error("That customer has no cable to this box");
  }
  return p;
}

const ALLOWED = new Set(["f-f", "f-si", "si-f", "f-so", "so-f", "so-d", "d-so", "f-d", "d-f"]);

export async function addSplitter(actor: Actor, input: z.infer<typeof splitterAddInput>) {
  await requireRole(actor, input.projectId, "editor");
  await requireBox(input.projectId, input.boxId);
  const id = crypto.randomUUID();
  await db.insert(splitters).values({ id, ...input });
  return { id };
}

export async function removeSplitter(actor: Actor, { projectId, splitterId }: z.infer<typeof splitterRemoveInput>) {
  await requireRole(actor, projectId, "editor");
  const [sp] = await db.select().from(splitters).where(and(eq(splitters.id, splitterId), eq(splitters.projectId, projectId)));
  if (!sp) throw new NotFoundError("Splitter not found");
  const mine = db
    .select({ id: portUses.connectionId })
    .from(portUses)
    .where(and(eq(portUses.boxId, sp.boxId), or(eq(portUses.port, `si:${sp.id}`), inArray(portUses.port, Array.from({ length: sp.ratio }, (_, i) => `so:${sp.id}:${i + 1}`)))));
  const ids = (await mine).map((r) => r.id);
  await db.batch([
    db.delete(portUses).where(inArray(portUses.connectionId, ids.concat([""]))),
    db.delete(connections).where(inArray(connections.id, ids.concat([""]))),
    db.delete(splitters).where(eq(splitters.id, sp.id)),
  ]);
}

export async function connect(actor: Actor, input: z.infer<typeof connectInput>) {
  await requireRole(actor, input.projectId, "editor");
  await requireBox(input.projectId, input.boxId);
  if (input.a === input.b) throw new Error("Pick two different ports");
  const pa = await validatePort(input.projectId, input.boxId, input.a);
  const pb = await validatePort(input.projectId, input.boxId, input.b);
  if (!ALLOWED.has(`${pa.type}-${pb.type}`)) throw new Error("Those two ports can't be connected");
  if ((pa.type === "si" || pa.type === "so") && (pb.type === "si" || pb.type === "so") && pa.splitterId === pb.splitterId) throw new Error("A splitter can't feed itself");
  const id = input.id ?? crypto.randomUUID();
  const taken = await db
    .select({ port: portUses.port })
    .from(portUses)
    .where(and(eq(portUses.boxId, input.boxId), inArray(portUses.port, [input.a, input.b])));
  if (taken.length) throw new PortTakenError();
  try {
    await db.batch([
      db.insert(connections).values({ id, projectId: input.projectId, boxId: input.boxId, a: input.a, b: input.b }),
      db.insert(portUses).values([
        { boxId: input.boxId, port: input.a, connectionId: id },
        { boxId: input.boxId, port: input.b, connectionId: id },
      ]),
    ]);
  } catch {
    throw new PortTakenError();
  }
  return { id, boxId: input.boxId, a: input.a, b: input.b };
}

export async function disconnect(actor: Actor, { projectId, connectionId }: z.infer<typeof disconnectInput>) {
  await requireRole(actor, projectId, "editor");
  const [c] = await db.select().from(connections).where(and(eq(connections.id, connectionId), eq(connections.projectId, projectId)));
  if (!c) throw new NotFoundError("Connection not found");
  await db.batch([
    db.delete(portUses).where(eq(portUses.connectionId, c.id)),
    db.delete(connections).where(eq(connections.id, c.id)),
  ]);
  return { id: c.id, boxId: c.boxId, a: c.a, b: c.b };
}

/**
 * Feeds the NAP at the far end of a cable: the cable's first free fiber in
 * this box is joined to the next free splitter output here, or else to the
 * next free fiber of another cable coming into the box.
 */
export async function autoConnect(actor: Actor, input: z.infer<typeof autoConnectInput>) {
  await requireRole(actor, input.projectId, "editor");
  await requireBox(input.projectId, input.boxId);
  const contents = await boxContents(input.projectId, input.boxId);
  const cable = contents.cables.find((r) => r.id === input.routeId);
  if (!cable) throw new NotFoundError("Cable not found");
  const farId = cable.fromElementId === input.boxId ? cable.toElementId : cable.fromElementId;
  const farKind = (id: string | null) => contents.far.find((e) => e.id === id)?.kind;
  if (farKind(farId) !== "nap") throw new Error("This cable doesn't lead to a NAP");
  const used = new Set(
    (await db.select({ port: portUses.port }).from(portUses).where(eq(portUses.boxId, input.boxId))).map((u) => u.port),
  );
  const firstFree = (keys: string[]) => keys.find((k) => !used.has(k));
  const own = firstFree(Array.from({ length: cable.fiberCount }, (_, i) => `f:${cable.id}:${i + 1}`));
  if (!own) throw new Error("Every fiber of this cable is already connected");
  const sources = [
    ...contents.splitters.flatMap((sp) => Array.from({ length: sp.ratio }, (_, i) => `so:${sp.id}:${i + 1}`)),
    ...contents.cables
      .filter((r) => r.id !== cable.id && r.kind !== "drop")
      .filter((r) => {
        const far = r.fromElementId === input.boxId ? r.toElementId : r.fromElementId;
        return farKind(far) !== "nap" && farKind(far) !== "customer";
      })
      .flatMap((r) => Array.from({ length: r.fiberCount }, (_, i) => `f:${r.id}:${i + 1}`)),
  ];
  const source = firstFree(sources);
  if (!source) throw new Error("No free fiber or splitter output in this box");
  return connect(actor, { projectId: input.projectId, boxId: input.boxId, a: source, b: own });
}
