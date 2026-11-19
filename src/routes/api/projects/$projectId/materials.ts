import { createFileRoute } from "@tanstack/react-router";
import { materialsCsv, parseKinds, planForRequest } from "@/server/requestActor";

// The materials list and element coordinates as a CSV spreadsheet.
export const Route = createFileRoute("/api/projects/$projectId/materials")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const plan = await planForRequest(request, params.projectId);
        if (plan instanceof Response) return plan;
        const kinds = parseKinds(new URL(request.url).searchParams.get("kinds"));
        const slug = plan.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";
        return new Response(materialsCsv(plan, kinds), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${slug}-materials.csv"`,
          },
        });
      },
    },
  },
});
