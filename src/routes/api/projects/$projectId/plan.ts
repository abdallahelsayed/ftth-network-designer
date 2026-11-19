import { createFileRoute } from "@tanstack/react-router";
import { planForRequest } from "@/server/requestActor";

// The whole plan as JSON: map, diagrams, budget and materials.
export const Route = createFileRoute("/api/projects/$projectId/plan")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const plan = await planForRequest(request, params.projectId);
        return plan instanceof Response ? plan : Response.json(plan);
      },
    },
  },
});
