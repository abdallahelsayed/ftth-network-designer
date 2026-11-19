import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  connections,
  elements,
  layers,
  portUses,
  projectMembers,
  projects,
  routes,
  splitters,
} from "@/db/schema";
import { OLT_CLASS_IDS, computeBudget, computeMaterials, type OltClass } from "@/lib/network";
import { type Actor, NotFoundError, requireRole, seeUser } from "./access";

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

export const createProjectInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(1000).default(""),
    centerLat: lat,
    centerLng: lng,
  })
  .strict();

export const updateProjectInput = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(1000),
    centerLat: lat,
    centerLng: lng,
  })
  .strict();

export const updateSettingsInput = z
  .object({
    projectId: z.string().uuid(),
    oltClass: z.enum(OLT_CLASS_IDS as [OltClass, ...OltClass[]]),
    attenuationDbKm: z.coerce.number().min(0).max(100),
    spliceLossDb: z.coerce.number().min(0).max(10),
    connectorLossDb: z.coerce.number().min(0).max(10),
    overlengthPct: z.coerce.number().min(0).max(100),
    closureReserveM: z.coerce.number().min(0).max(1000),
    splitterReserveM: z.coerce.number().min(0).max(1000),
  })
  .strict();

export const projectIdInput = z.object({ projectId: z.string().uuid() }).strict();

export const memberInput = z
  .object({
    projectId: z.string().uuid(),
    email: z.string().trim().toLowerCase().email("Enter an email address"),
    role: z.enum(["editor", "viewer"]),
  })
  .strict();
export const removeMemberInput = z
  .object({ projectId: z.string().uuid(), email: z.string().trim().toLowerCase() })
  .strict();

export async function listProjects(actor: Actor) {
  await seeUser(actor);
  const email = actor.email.toLowerCase();
  const shared = db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.email, email));
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
      role: projectMembers.role,
    })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.email, email)))
    .where(
      and(
        eq(projects.orgId, actor.orgId),
        actor.admin ? undefined : or(eq(projects.ownerId, actor.id), inArray(projects.id, shared)),
      ),
    )
    .orderBy(asc(projects.name));
  const counts = await db
    .select({ projectId: elements.projectId, n: sql<number>`count(*)` })
    .from(elements)
    .where(inArray(elements.projectId, rows.map((r) => r.id).concat([""])))
    .groupBy(elements.projectId);
  const countOf = new Map(counts.map((c) => [c.projectId, c.n]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    role: r.ownerId === actor.id ? "owner" : r.role ?? "admin",
    elementCount: countOf.get(r.id) ?? 0,
  }));
}

export async function createProject(actor: Actor, input: z.infer<typeof createProjectInput>) {
  await seeUser(actor);
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(projects).values({ id, orgId: actor.orgId, ownerId: actor.id, ...input }),
    db.insert(layers).values({ id: crypto.randomUUID(), projectId: id, name: "Main" }),
  ]);
  return { id };
}

export async function updateProject(actor: Actor, { projectId, ...change }: z.infer<typeof updateProjectInput>) {
  await requireRole(actor, projectId, "manager");
  await db.update(projects).set(change).where(eq(projects.id, projectId));
}

export async function updateSettings(actor: Actor, { projectId, ...change }: z.infer<typeof updateSettingsInput>) {
  await requireRole(actor, projectId, "editor");
  await db.update(projects).set(change).where(eq(projects.id, projectId));
}

export async function deleteProject(actor: Actor, { projectId }: z.infer<typeof projectIdInput>) {
  await requireRole(actor, projectId, "manager");
  const boxIds = db.select({ id: elements.id }).from(elements).where(eq(elements.projectId, projectId));
  await db.batch([
    db.delete(portUses).where(inArray(portUses.boxId, boxIds)),
    db.delete(connections).where(eq(connections.projectId, projectId)),
    db.delete(splitters).where(eq(splitters.projectId, projectId)),
    db.delete(routes).where(eq(routes.projectId, projectId)),
    db.delete(elements).where(eq(elements.projectId, projectId)),
    db.delete(layers).where(eq(layers.projectId, projectId)),
    db.delete(projectMembers).where(eq(projectMembers.projectId, projectId)),
    db.delete(projects).where(eq(projects.id, projectId)),
  ]);
}

export async function addMember(actor: Actor, input: z.infer<typeof memberInput>) {
  await requireRole(actor, input.projectId, "manager");
  const [project] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, input.projectId));
  if (project?.ownerId === actor.id && input.email === actor.email.toLowerCase()) {
    throw new Error("You already own this project");
  }
  await db
    .insert(projectMembers)
    .values(input)
    .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.email], set: { role: input.role } });
}

export async function removeMember(actor: Actor, input: z.infer<typeof removeMemberInput>) {
  await requireRole(actor, input.projectId, "manager");
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.email, input.email)));
}

/** Everything in a project the actor may see, with its budget and materials. */
export async function loadPlan(actor: Actor, projectId: string) {
  await seeUser(actor);
  const role = await requireRole(actor, projectId, "viewer");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new NotFoundError("Project not found");
  const [layerRows, elementRows, routeRows, splitterRows, connectionRows, memberRows] = await db.batch([
    db.select().from(layers).where(eq(layers.projectId, projectId)).orderBy(asc(layers.createdAt), asc(layers.id)),
    db.select().from(elements).where(eq(elements.projectId, projectId)).orderBy(asc(elements.createdAt), asc(elements.id)),
    db.select().from(routes).where(eq(routes.projectId, projectId)).orderBy(asc(routes.createdAt), asc(routes.id)),
    db.select().from(splitters).where(eq(splitters.projectId, projectId)).orderBy(asc(splitters.createdAt), asc(splitters.id)),
    db.select().from(connections).where(eq(connections.projectId, projectId)).orderBy(asc(connections.createdAt), asc(connections.id)),
    db.select({ email: projectMembers.email, role: projectMembers.role }).from(projectMembers).where(eq(projectMembers.projectId, projectId)).orderBy(asc(projectMembers.email)),
  ]);
  const strip = <T extends { projectId: string; createdAt: string }>({ projectId: _p, createdAt: _c, ...rest }: T) => rest;
  const net = {
    elements: elementRows,
    routes: routeRows,
    splitters: splitterRows,
    connections: connectionRows,
  };
  const { orgId: _o, ...shownProject } = project;
  return {
    project: shownProject,
    role,
    canEdit: role !== "viewer",
    canManage: role === "owner" || role === "admin",
    members: role === "viewer" ? [] : memberRows,
    layers: layerRows.map(strip),
    elements: elementRows.map(strip),
    routes: routeRows.map(strip),
    splitters: splitterRows.map(strip),
    connections: connectionRows.map(strip),
    budget: computeBudget(net, {
      oltClass: project.oltClass as OltClass,
      attenuationDbKm: project.attenuationDbKm,
      spliceLossDb: project.spliceLossDb,
      connectorLossDb: project.connectorLossDb,
    }),
    materials: computeMaterials(net, project),
  };
}

export type Plan = Awaited<ReturnType<typeof loadPlan>>;
