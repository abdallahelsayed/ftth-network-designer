import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { PageHeader } from "@/client/components/PageHeader";
import { ProjectFrame, ProjectNotFound } from "@/client/components/ProjectFrame";
import { Button } from "@/client/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/client/components/ui/table";
import { KIND_CLASS, ROUTE_CLASS } from "@/client/map/NetworkMap";
import { ELEMENT_LABELS, ROUTE_LABELS } from "@/lib/network";
import type { Plan } from "@/server/projects";
import { getPlan } from "@/serverFunctions/projects";

export const Route = createFileRoute("/projects/$projectId/print")({
  loader: ({ params }) => getPlan({ data: { projectId: params.projectId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.project.name} · Plan` : "Project not found" }] }),
  component: PrintPage,
});

const VERDICT = { ok: "OK", marginal: "Marginal", over: "Over budget", untraced: "Not traced" } as const;

function PrintPage() {
  const plan = Route.useLoaderData();
  if (!plan) return <ProjectNotFound />;
  const { project } = plan;
  return (
    <ProjectFrame projectId={project.id}>
      <div data-testid="print-plan-sheet" className="space-y-8">
        <PageHeader
          title={project.name}
          description={project.description || undefined}
          actions={
            <Button className="print:hidden" onClick={() => window.print()}>
              <Printer data-icon="inline-start" aria-hidden />
              Print or save as PDF
            </Button>
          }
        />
        <Sketch plan={plan} />
        <section className="space-y-2">
          <h2 className="font-semibold">Cable</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Fibers</TableHead>
                <TableHead className="text-right">Length</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.routes.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{ROUTE_LABELS[r.kind]}</TableCell>
                  <TableCell className="text-right">{r.fiberCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(r.lengthM).toLocaleString("en-US")} m</TableCell>
                </TableRow>
              ))}
              {plan.materials.cables.map((c) => (
                <TableRow key={c.fiberCount}>
                  <TableCell className="font-medium" colSpan={3}>
                    To buy, {c.fiberCount} fibers
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{c.totalM.toLocaleString("en-US")} m</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">Elements</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Coordinates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.elements.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.name}</TableCell>
                  <TableCell>{ELEMENT_LABELS[e.kind]}</TableCell>
                  <TableCell>{e.address}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.lat.toFixed(6)}, {e.lng.toFixed(6)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
        {plan.budget.customers.length ? (
          <section className="space-y-2">
            <h2 className="font-semibold">Power budget · {plan.budget.olt.label}</h2>
            <Table>
              <TableBody>
                {plan.budget.customers.map((c) => (
                  <TableRow key={c.customerId}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.rxDbm === null ? "—" : `${c.rxDbm.toFixed(2)} dBm`}</TableCell>
                    <TableCell>{VERDICT[c.verdict]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}
      </div>
    </ProjectFrame>
  );
}

/** The network drawn to scale, without a basemap. */
function Sketch({ plan }: { plan: Plan }) {
  const pts = [...plan.elements.map((e) => [e.lat, e.lng] as [number, number]), ...plan.routes.flatMap((r) => r.points)];
  if (!pts.length) return null;
  const k = Math.cos((plan.project.centerLat * Math.PI) / 180);
  const xs = pts.map((p) => p[1] * k);
  const ys = pts.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-5);
  const W = 800, H = Math.max(240, Math.min(600, (W * (maxY - minY)) / Math.max(maxX - minX, 1e-5)));
  const pad = 30;
  const s = Math.min((W - 2 * pad) / Math.max(maxX - minX, span / 10), (H - 2 * pad) / Math.max(maxY - minY, span / 10));
  const at = (p: [number, number]) => [pad + (p[1] * k - minX) * s, pad + (-p[0] - minY) * s] as const;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-border bg-card" role="img" aria-label="Network sketch">
      {plan.routes.map((r) => (
        <polyline key={r.id} points={r.points.map((p) => at(p).join(",")).join(" ")} fill="none" strokeWidth={r.kind === "drop" ? 2 : 3.5} strokeLinecap="round" className={ROUTE_CLASS[r.kind]} />
      ))}
      {plan.elements.map((e) => {
        const [x, y] = at([e.lat, e.lng]);
        return (
          <g key={e.id}>
            <circle cx={x} cy={y} r={6} className={`${KIND_CLASS[e.kind].replace("bg-", "fill-")} stroke-background`} strokeWidth={2} />
            <text x={x + 9} y={y + 4} className="fill-foreground text-[11px]">
              {e.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
