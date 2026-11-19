import { env } from "cloudflare:workers";
import { getEveryAppUser, isAdmin } from "@every-app/sdk/server";
import { ELEMENT_KINDS, ELEMENT_LABELS, type ElementKind } from "@/lib/network";
import type { Actor } from "./access";
import { NotFoundError, ForbiddenError } from "./access";
import { loadPlan, type Plan } from "./projects";

/** The plan for a server route's caller, or the response to send instead. */
export async function planForRequest(request: Request, projectId: string): Promise<Plan | Response> {
  const user = await getEveryAppUser(request, env);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const actor: Actor = { id: user.id, email: user.email, orgId: user.orgId, admin: isAdmin(user) };
  try {
    return await loadPlan(actor, projectId);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }
    throw error;
  }
}

function cell(value: string | number) {
  let text = String(value);
  // A spreadsheet must never run a cell as a formula.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Materials, then the chosen kinds of element with their coordinates. */
export function materialsCsv(plan: Plan, kinds: ElementKind[]) {
  const rows: (string | number)[][] = [["Section", "Item", "Quantity", "Unit", "Latitude", "Longitude", "Address"]];
  for (const c of plan.materials.cables) {
    rows.push(["Cable", `${c.fiberCount} fibers`, c.totalM, "m", "", "", ""]);
  }
  for (const c of plan.materials.counts) rows.push(["Count", c.label, c.count, "pcs", "", "", ""]);
  for (const e of plan.elements) {
    if (!kinds.includes(e.kind)) continue;
    rows.push([ELEMENT_LABELS[e.kind], e.name, 1, "pcs", e.lat.toFixed(6), e.lng.toFixed(6), e.address]);
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function parseKinds(param: string | null): ElementKind[] {
  if (!param) return [...ELEMENT_KINDS];
  return param.split(",").filter((k): k is ElementKind => (ELEMENT_KINDS as readonly string[]).includes(k));
}
