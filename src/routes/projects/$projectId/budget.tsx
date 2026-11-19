import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/client/components/PageHeader";
import { ProjectFrame, ProjectNotFound } from "@/client/components/ProjectFrame";
import { EmptyState } from "@/client/components/EmptyState";
import { Badge } from "@/client/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/client/components/ui/table";
import type { Verdict } from "@/lib/network";
import { getPlan } from "@/serverFunctions/projects";

export const Route = createFileRoute("/projects/$projectId/budget")({
  loader: ({ params }) => getPlan({ data: { projectId: params.projectId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.project.name} · Budget` : "Project not found" }] }),
  component: BudgetPage,
});

const VERDICT: Record<Verdict, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ok: { label: "OK", variant: "default" },
  marginal: { label: "Marginal", variant: "secondary" },
  over: { label: "Over budget", variant: "destructive" },
  untraced: { label: "Not traced", variant: "outline" },
};

const db = (n: number | null, unit = "dB") => (n === null ? "—" : `${n.toFixed(2)} ${unit}`);

function BudgetPage() {
  const plan = Route.useLoaderData();
  if (!plan) return <ProjectNotFound />;
  const { budget, project } = plan;
  return (
    <ProjectFrame projectId={project.id}>
      <PageHeader
        title="Power budget"
        description={`${budget.olt.label}: up to ${budget.olt.maxLossDb} dB loss, ${budget.olt.txDbm > 0 ? "+" : ""}${budget.olt.txDbm} dBm transmit · ${project.attenuationDbKm} dB/km · ${project.spliceLossDb} dB per splice · ${project.connectorLossDb} dB per connector`}
      />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Alerts</h2>
        {budget.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {budget.alerts.map((a) => (
              <li key={a.kind + a.subjectId} data-testid="alert-row" className="flex items-center gap-3 px-4 py-2 text-sm">
                <Badge variant={a.kind === "over" ? "destructive" : "outline"}>
                  {a.kind === "over" ? "Over budget" : a.kind === "untraced" ? "Not traced" : "Full"}
                </Badge>
                {a.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Customers</h2>
        {budget.customers.length === 0 ? (
          <EmptyState title="No customers yet" description="Place customers on the map and connect their drops in a box's splice diagram." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Fiber</TableHead>
                  <TableHead className="text-right">Splitters</TableHead>
                  <TableHead className="text-right">Total loss</TableHead>
                  <TableHead className="text-right">At the ONU</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead>Verdict</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.customers.map((c) => (
                  <TableRow key={c.customerId} data-testid="budget-row">
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      {c.path.length ? <div className="text-xs text-muted-foreground">via {c.path.join(" ← ")}</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(c.lengthM).toLocaleString("en-US")} m
                      <div className="text-xs text-muted-foreground">
                        {c.splices} splices · {c.connectors} conn.
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{db(c.splitterLossDb)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.verdict === "untraced" ? "—" : db(c.totalLossDb)}</TableCell>
                    <TableCell className="text-right tabular-nums">{db(c.rxDbm, "dBm")}</TableCell>
                    <TableCell className="text-right tabular-nums">{db(c.marginDb)}</TableCell>
                    <TableCell>
                      <Badge data-testid="verdict" variant={VERDICT[c.verdict].variant}>
                        {VERDICT[c.verdict].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </ProjectFrame>
  );
}
