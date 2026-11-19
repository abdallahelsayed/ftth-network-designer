// The app's tools for AI clients. The Gateway serves them at /mcp and calls
// each with the signed-in user; every one goes through the same queries and
// access rules as the pages.
import { ToolError, defineTools, isAdmin } from "@every-app/sdk/server";
import { z } from "zod";
import { NotFoundError } from "@/server/access";
import { listProjects, loadPlan } from "@/server/projects";

export const tools = defineTools(
  {
    list_projects: {
      description: "List the network projects the user can open, with their role in each.",
      risk: "read",
      input: z.object({}).strict(),
      handler: (_input, { user }) =>
        listProjects({ id: user.id, email: user.email, orgId: user.orgId, admin: isAdmin(user) }),
    },
    get_power_budget: {
      description:
        "Optical power budget of one project: each customer's loss, received power and verdict, plus design alerts.",
      risk: "read",
      input: z.object({ projectId: z.string().uuid() }).strict(),
      handler: async ({ projectId }, { user }) => {
        try {
          const plan = await loadPlan({ id: user.id, email: user.email, orgId: user.orgId, admin: isAdmin(user) }, projectId);
          return { project: plan.project.name, ...plan.budget };
        } catch (error) {
          if (error instanceof NotFoundError) throw new ToolError("No project with that id");
          throw error;
        }
      },
    },
  },
  { instructions: "Never guess project ids: call list_projects first." },
);
