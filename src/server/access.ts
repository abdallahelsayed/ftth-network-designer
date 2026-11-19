import { isAdmin } from "@every-app/sdk/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, projects, users } from "@/db/schema";

/** The part of the Gateway's verified user the queries need. */
export interface Actor {
  id: string;
  email: string;
  orgId: string;
  admin: boolean;
}

/** The actor for a verified Gateway user. */
export const actorOf = (user: { id: string; email: string; orgId: string; orgRole: string }): Actor => ({
  id: user.id,
  email: user.email,
  orgId: user.orgId,
  admin: isAdmin(user),
});

export type ProjectRole = "owner" | "admin" | "editor" | "viewer";

export { ForbiddenError, NotFoundError } from "./errors";
import { ForbiddenError, NotFoundError } from "./errors";

/** Records the person on first sight, keyed by the Gateway's user id. */
export async function seeUser(actor: Actor) {
  await db
    .insert(users)
    .values({ id: actor.id, email: actor.email.toLowerCase() })
    .onConflictDoUpdate({ target: users.id, set: { email: actor.email.toLowerCase() } });
}

/** The actor's role in a project of their organization, or null. */
export async function roleIn(actor: Actor, projectId: string): Promise<ProjectRole | null> {
  const [row] = await db
    .select({ ownerId: projects.ownerId, role: projectMembers.role })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.email, actor.email.toLowerCase())),
    )
    .where(and(eq(projects.id, projectId), eq(projects.orgId, actor.orgId)));
  if (!row) return null;
  if (row.ownerId === actor.id) return "owner";
  if (actor.admin) return "admin";
  return row.role ?? null;
}

const RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 2 };

/**
 * Throws unless the actor has at least `need` in the project. A project the
 * actor may not see at all is "not found", never "forbidden".
 */
export async function requireRole(
  actor: Actor,
  projectId: string,
  need: "viewer" | "editor" | "manager",
): Promise<ProjectRole> {
  const role = await roleIn(actor, projectId);
  if (!role) throw new NotFoundError("Project not found");
  const needed = need === "manager" ? 2 : need === "editor" ? 1 : 0;
  if (RANK[role] < needed) throw new ForbiddenError();
  return role;
}
