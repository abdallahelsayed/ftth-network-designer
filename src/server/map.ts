import { and, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { connections, elements, layers, portUses, routes, splitters } from "@/db/schema";
import { ELEMENT_KINDS, FIBER_COUNTS, ROUTE_KINDS, pathLengthM } from "@/lib/network";
import { type Actor, NotFoundError, requireRole } from "./access";

const uuid = z.string().uuid();
const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const name = z.string().trim().min(1, "Name is required").max(120);

export const layerCreateInput = z.object({ projectId: uuid, name }).strict();
export const layerUpdateInput = z
  .object({ projectId: uuid, layerId: uuid, name: name.optional(), visible: z.boolean().optional() })
  .strict();

export const elementCreateInput = z
  .object({
    projectId: uuid,
    // Set only when an undo puts a deleted element back.
    id: uuid.optional(),
    layerId: uuid,
    kind: z.enum(ELEMENT_KINDS),
    name,
    address: z.string().trim().max(300).default(""),
    notes: z.string().trim().max(2000).default(""),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    // Route ends that pointed at it before it was deleted.
    reattach: z.array(z.object({ routeId: uuid, end: z.enum(["from", "to"]) })).max(500).default([]),
  })
  .strict();
export const elementUpdateInput = z
  .object({
    projectId: uuid,
    elementId: uuid,
    layerId: uuid.optional(),
    name: name.optional(),
    address: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(2000).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();
export const elementDeleteInput = z.object({ projectId: uuid, elementId: uuid }).strict();

export const routeCreateInput = z
  .object({
    projectId: uuid,
    id: uuid.optional(),
    layerId: uuid,
    name,
    fiberCount: z.number().int().refine((n) => (FIBER_COUNTS as readonly number[]).includes(n), "Pick a fiber count"),
    kind: z.enum(ROUTE_KINDS),
    points: z.array(latLng).min(2, "A route needs two points").max(2000),
    fromElementId: uuid.nullable().default(null),
    toElementId: uuid.nullable().default(null),
  })
  .strict();
export const routeUpdateInput = z
  .object({
    projectId: uuid,
    routeId: uuid,
    layerId: uuid.optional(),
    name: name.optional(),
    fiberCount: z.number().int().refine((n) => (FIBER_COUNTS as readonly number[]).includes(n)).optional(),
    kind: z.enum(ROUTE_KINDS).optional(),
  })
  .strict();
export const routeDeleteInput = z.object({ projectId: uuid, routeId: uuid }).strict();

async function requireLayer(projectId: string, layerId: string) {
  const [layer] = await db.select({ id: layers.id }).from(layers).where(and(eq(layers.id, layerId), eq(layers.projectId, projectId)));
  if (!layer) throw new NotFoundError("Layer not found");
}

export async function createLayer(actor: Actor, input: z.infer<typeof layerCreateInput>) {
  await requireRole(actor, input.projectId, "editor");
  const id = crypto.randomUUID();
  await db.insert(layers).values({ id, projectId: input.projectId, name: input.name });
  return { id };
}

export async function updateLayer(actor: Actor, { projectId, layerId, ...change }: z.infer<typeof layerUpdateInput>) {
  await requireRole(actor, projectId, "editor");
  const done = await db.update(layers).set(change).where(and(eq(layers.id, layerId), eq(layers.projectId, projectId))).returning({ id: layers.id });
  if (!done.length) throw new NotFoundError("Layer not found");
}

async function projectElement(projectId: string, elementId: string) {
  const [row] = await db.select().from(elements).where(and(eq(elements.id, elementId), eq(elements.projectId, projectId)));
  if (!row) throw new NotFoundError("Element not found");
  return row;
}

export async function createElement(actor: Actor, input: z.infer<typeof elementCreateInput>) {
  await requireRole(actor, input.projectId, "editor");
  await requireLayer(input.projectId, input.layerId);
  const { reattach, ...values } = input;
  const id = values.id ?? crypto.randomUUID();
  await db.insert(elements).values({ ...values, id });
  for (const { routeId, end } of reattach) {
    await db
      .update(routes)
      .set(end === "from" ? { fromElementId: id } : { toElementId: id })
      .where(and(eq(routes.id, routeId), eq(routes.projectId, input.projectId)));
  }
  return { id };
}

export async function updateElement(actor: Actor, { projectId, elementId, ...change }: z.infer<typeof elementUpdateInput>) {
  await requireRole(actor, projectId, "editor");
  const before = await projectElement(projectId, elementId);
  if (change.layerId) await requireLayer(projectId, change.layerId);
  await db.update(elements).set(change).where(eq(elements.id, elementId));
  // Routes that end at a moved element follow it.
  if (change.lat !== undefined || change.lng !== undefined) {
    const at: [number, number] = [change.lat ?? before.lat, change.lng ?? before.lng];
    const attached = await db
      .select()
      .from(routes)
      .where(and(eq(routes.projectId, projectId), or(eq(routes.fromElementId, elementId), eq(routes.toElementId, elementId))));
    for (const r of attached) {
      const points = [...r.points];
      if (r.fromElementId === elementId) points[0] = at;
      if (r.toElementId === elementId) points[points.length - 1] = at;
      await db.update(routes).set({ points, lengthM: pathLengthM(points) }).where(eq(routes.id, r.id));
    }
  }
}

/** Deletes an element with its splitters and connections; returns what undo needs. */
export async function deleteElement(actor: Actor, { projectId, elementId }: z.infer<typeof elementDeleteInput>) {
  await requireRole(actor, projectId, "editor");
  const element = await projectElement(projectId, elementId);
  const attached = await db
    .select({ id: routes.id, fromElementId: routes.fromElementId, toElementId: routes.toElementId })
    .from(routes)
    .where(and(eq(routes.projectId, projectId), or(eq(routes.fromElementId, elementId), eq(routes.toElementId, elementId))));
  const reattach = attached.flatMap((r) => [
    ...(r.fromElementId === elementId ? [{ routeId: r.id, end: "from" as const }] : []),
    ...(r.toElementId === elementId ? [{ routeId: r.id, end: "to" as const }] : []),
  ]);
  const dropKey = `d:${elementId}`;
  const dropConnections = db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.projectId, projectId), or(eq(connections.a, dropKey), eq(connections.b, dropKey))));
  await db.batch([
    db.delete(portUses).where(inArray(portUses.connectionId, dropConnections)),
    db.delete(connections).where(and(eq(connections.projectId, projectId), or(eq(connections.a, dropKey), eq(connections.b, dropKey)))),
    db.delete(portUses).where(eq(portUses.boxId, elementId)),
    db.delete(connections).where(eq(connections.boxId, elementId)),
    db.delete(splitters).where(eq(splitters.boxId, elementId)),
    db.update(routes).set({ fromElementId: null }).where(eq(routes.fromElementId, elementId)),
    db.update(routes).set({ toElementId: null }).where(eq(routes.toElementId, elementId)),
    db.delete(elements).where(eq(elements.id, elementId)),
  ]);
  const { createdAt: _c, ...restorable } = element;
  return { element: restorable, reattach };
}

export async function createRoute(actor: Actor, input: z.infer<typeof routeCreateInput>) {
  await requireRole(actor, input.projectId, "editor");
  await requireLayer(input.projectId, input.layerId);
  for (const end of [input.fromElementId, input.toElementId]) {
    if (end) await projectElement(input.projectId, end);
  }
  const id = input.id ?? crypto.randomUUID();
  await db.insert(routes).values({ ...input, id, lengthM: pathLengthM(input.points) });
  return { id };
}

export async function updateRoute(actor: Actor, { projectId, routeId, ...change }: z.infer<typeof routeUpdateInput>) {
  await requireRole(actor, projectId, "editor");
  const [route] = await db.select().from(routes).where(and(eq(routes.id, routeId), eq(routes.projectId, projectId)));
  if (!route) throw new NotFoundError("Route not found");
  if (change.layerId) await requireLayer(projectId, change.layerId);
  if (change.fiberCount !== undefined && change.fiberCount < route.fiberCount) {
    const used = await db
      .select({ port: portUses.port })
      .from(portUses)
      .where(like(portUses.port, `f:${routeId}:%`));
    if (used.some((u) => Number(u.port.split(":")[2]) > change.fiberCount!)) {
      throw new Error("Remove the splices on the higher fibers first");
    }
  }
  await db.update(routes).set(change).where(eq(routes.id, routeId));
}

export async function deleteRoute(actor: Actor, { projectId, routeId }: z.infer<typeof routeDeleteInput>) {
  await requireRole(actor, projectId, "editor");
  const [route] = await db.select().from(routes).where(and(eq(routes.id, routeId), eq(routes.projectId, projectId)));
  if (!route) throw new NotFoundError("Route not found");
  const prefix = `f:${routeId}:%`;
  const touching = db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.projectId, projectId), or(like(connections.a, prefix), like(connections.b, prefix))));
  await db.batch([
    db.delete(portUses).where(inArray(portUses.connectionId, touching)),
    db.delete(connections).where(and(eq(connections.projectId, projectId), or(like(connections.a, prefix), like(connections.b, prefix)))),
    db.delete(routes).where(eq(routes.id, routeId)),
  ]);
  const { createdAt: _c, lengthM: _l, projectId: _p, ...restorable } = route;
  return { route: restorable };
}
