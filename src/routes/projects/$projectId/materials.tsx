import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Printer } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { ProjectFrame, ProjectNotFound } from "@/client/components/ProjectFrame";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/client/components/ui/table";
import { ELEMENT_KINDS, ELEMENT_LABELS, type ElementKind } from "@/lib/network";
import { getPlan } from "@/serverFunctions/projects";

export const Route = createFileRoute("/projects/$projectId/materials")({
  loader: ({ params }) => getPlan({ data: { projectId: params.projectId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.project.name} · Materials` : "Project not found" }] }),
  component: MaterialsPage,
});

const m = (n: number) => `${Math.round(n).toLocaleString("en-US")} m`;

function MaterialsPage() {
  const plan = Route.useLoaderData();
  const [kinds, setKinds] = useState<Set<ElementKind>>(() => new Set(ELEMENT_KINDS));
  if (!plan) return <ProjectNotFound />;
  const { materials, project } = plan;
  const href = `/api/projects/${project.id}/materials?kinds=${[...kinds].join(",")}`;
  return (
    <ProjectFrame projectId={project.id}>
      <PageHeader
        title="Materials"
        description={`Route length + ${project.overlengthPct}% overlength + ${project.closureReserveM} m reserve per cable end in a closure and ${project.splitterReserveM} m in a splitter box`}
        actions={
          <Button variant="outline" data-testid="print-plan" render={<Link to="/projects/$projectId/print" params={{ projectId: project.id }} />}>
            <Printer data-icon="inline-start" aria-hidden />
            Printable plan
          </Button>
        }
      />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Cable</h2>
        {materials.cables.length === 0 ? (
          <EmptyState title="No routes yet" description="Draw cable routes on the map to see what to buy." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cable</TableHead>
                  <TableHead className="text-right">Routes</TableHead>
                  <TableHead className="text-right">Route length</TableHead>
                  <TableHead className="text-right">Reserve</TableHead>
                  <TableHead className="text-right">To buy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.cables.map((c) => (
                  <TableRow key={c.fiberCount} data-testid="cable-row">
                    <TableCell className="font-medium">{c.fiberCount} fibers</TableCell>
                    <TableCell className="text-right tabular-nums">{c.routes}</TableCell>
                    <TableCell className="text-right tabular-nums">{m(c.routeM)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m(c.reserveM)}</TableCell>
                    <TableCell data-testid="cable-total" className="text-right font-medium tabular-nums">
                      {c.totalM.toLocaleString("en-US")} m
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Equipment</h2>
        {materials.counts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing placed yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {materials.counts.map((c) => (
              <li key={c.label} data-testid="count-row" className="flex justify-between px-4 py-2 text-sm">
                <span>{c.label}</span>
                <span className="tabular-nums">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Spreadsheet</h2>
        <p className="text-sm text-muted-foreground">The materials above, plus the coordinates of these elements:</p>
        <div className="flex flex-wrap gap-4">
          {ELEMENT_KINDS.map((k) => (
            <Label key={k} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={kinds.has(k)}
                onCheckedChange={(on) => {
                  const next = new Set(kinds);
                  if (on) next.add(k);
                  else next.delete(k);
                  setKinds(next);
                }}
              />
              {ELEMENT_LABELS[k]}
            </Label>
          ))}
        </div>
        <Button data-testid="export-csv" render={<a href={href} download />}>
          <Download data-icon="inline-start" aria-hidden />
          Download CSV
        </Button>
      </section>
    </ProjectFrame>
  );
}
