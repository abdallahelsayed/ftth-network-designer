import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft, Trash2, Undo2, Wand2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/client/components/PageHeader";
import { errorMessage, ProjectFrame, ProjectNotFound } from "@/client/components/ProjectFrame";
import { SimpleSelect } from "@/client/components/SimpleSelect";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { BOX_KINDS, ELEMENT_LABELS, ROUTE_LABELS, SPLITTER_RATIOS, fiberColor, parsePort } from "@/lib/network";
import type { Plan } from "@/server/projects";
import { addSplitter, autoConnect, connectPorts, disconnectPorts, getPlan, removeSplitter } from "@/serverFunctions/projects";

export const Route = createFileRoute("/projects/$projectId/boxes/$boxId")({
  loader: ({ params }) => getPlan({ data: { projectId: params.projectId } }),
  head: ({ loaderData, params }) => ({
    meta: [{ title: loaderData?.elements.find((e) => e.id === params.boxId)?.name ?? "Splice diagram" }],
  }),
  component: DiagramPage,
});

function DiagramPage() {
  const plan = Route.useLoaderData();
  const { boxId } = Route.useParams();
  const box = plan?.elements.find((e) => e.id === boxId && BOX_KINDS.includes(e.kind));
  if (!plan || !box) return <ProjectNotFound />;
  return <Diagram key={box.id} plan={plan} boxId={box.id} />;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ratioOptions = SPLITTER_RATIOS.map((r) => ({ value: String(r), label: `1:${r}` }));
const portBase =
  "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs transition-colors tabular-nums disabled:cursor-default";

function Diagram({ plan, boxId }: { plan: Plan; boxId: string }) {
  const router = useRouter();
  const projectId = plan.project.id;
  const box = plan.elements.find((e) => e.id === boxId)!;
  const [picked, setPicked] = useState<string | null>(null);
  const [ratio, setRatio] = useState("8");
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<(() => Promise<unknown>)[]>([]);
  const canEdit = plan.canEdit;

  const cables = plan.routes.filter((r) => r.fromElementId === boxId || r.toElementId === boxId);
  const farOf = (r: Plan["routes"][number]) => {
    const id = r.fromElementId === boxId ? r.toElementId : r.fromElementId;
    return plan.elements.find((e) => e.id === id) ?? null;
  };
  const customers = cables.map(farOf).filter((e): e is NonNullable<typeof e> => e?.kind === "customer");
  const splitters = plan.splitters.filter((s) => s.boxId === boxId);
  const links = plan.connections.filter((c) => c.boxId === boxId);
  const peer = new Map<string, string>();
  for (const c of links) {
    peer.set(c.a, c.b);
    peer.set(c.b, c.a);
  }

  function portLabel(key: string): string {
    const p = parsePort(key);
    if (!p) return key;
    if (p.type === "f") {
      const r = plan.routes.find((x) => x.id === p.routeId);
      return `${r?.name ?? "Cable"} #${p.fiber} ${fiberColor(p.fiber).color}`;
    }
    if (p.type === "d") return `Drop ${plan.elements.find((e) => e.id === p.customerId)?.name ?? ""}`;
    const idx = splitters.findIndex((s) => s.id === p.splitterId) + 1;
    const sp = splitters[idx - 1];
    if (p.type === "si") return `Splitter ${idx} (1:${sp?.ratio}) in`;
    return `Splitter ${idx} out ${p.output}`;
  }

  async function run<T>(work: () => Promise<T>) {
    setError(null);
    try {
      const result = await work();
      await router.invalidate();
      return result;
    } catch (cause) {
      setError(errorMessage(cause));
      await router.invalidate();
      return undefined;
    }
  }
  const pushUndo = (step: () => Promise<unknown>) => setUndoStack((s) => [...s, step].slice(-50));

  async function pick(key: string) {
    if (!canEdit) return;
    if (!picked) return setPicked(key);
    if (picked === key) return setPicked(null);
    const a = picked;
    setPicked(null);
    const made = await run(() => connectPorts({ data: { projectId, boxId, a, b: key } }));
    if (made) pushUndo(() => disconnectPorts({ data: { projectId, connectionId: made.id } }));
  }

  function Port({ portKey, label }: { portKey: string; label: string }) {
    const connected = peer.has(portKey);
    const isPicked = picked === portKey;
    return (
      <button
        type="button"
        data-port={portKey}
        data-connected={connected ? "true" : "false"}
        aria-pressed={isPicked}
        title={connected ? `→ ${portLabel(peer.get(portKey)!)}` : undefined}
        disabled={!canEdit}
        onClick={() => void pick(portKey)}
        className={`${portBase} ${
          isPicked
            ? "border-primary bg-primary text-primary-foreground"
            : connected
              ? "border-primary/40 bg-primary/10"
              : "border-border bg-background hover:bg-muted"
        }`}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-primary" : "bg-border"}`} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <ProjectFrame projectId={projectId} wide>
      <PageHeader
        backLink={
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
            Map
          </Link>
        }
        title={box.name}
        description={[ELEMENT_LABELS[box.kind], count(cables.length, "cable"), count(splitters.length, "splitter"), count(links.length, "connection")].join(" · ")}
        actions={
          canEdit ? (
            <Button
              variant="outline"
              data-testid="diagram-undo"
              disabled={!undoStack.length}
              onClick={() => {
                const step = undoStack[undoStack.length - 1];
                if (!step) return;
                setUndoStack((s) => s.slice(0, -1));
                void run(step);
              }}
            >
              <Undo2 data-icon="inline-start" aria-hidden />
              Undo
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert variant="destructive" data-testid="diagram-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {canEdit && picked ? (
        <p className="text-sm text-muted-foreground">
          Connect <span className="font-medium text-foreground">{portLabel(picked)}</span> to…
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Cables</h2>
          {cables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cable ends at this box. Draw a route to it on the map.</p>
          ) : null}
          {cables.map((r) => {
            const far = farOf(r);
            const tubes = Math.ceil(r.fiberCount / 12);
            return (
              <div key={r.id} data-testid="cable" className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.fiberCount} fibers · {ROUTE_LABELS[r.kind]} · {far ? `to ${far.name}` : "open end"}
                    </div>
                  </div>
                  {canEdit && far?.kind === "nap" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`autoconnect-${r.id}`}
                      onClick={() =>
                        void run(() => autoConnect({ data: { projectId, boxId, routeId: r.id } })).then(
                          (made) => made && pushUndo(() => disconnectPorts({ data: { projectId, connectionId: made.id } })),
                        )
                      }
                    >
                      <Wand2 data-icon="inline-start" aria-hidden />
                      Feed {far.name}
                    </Button>
                  ) : null}
                </div>
                {Array.from({ length: tubes }, (_, t) => (
                  <div key={t} className="space-y-1.5">
                    {tubes > 1 ? (
                      <div className="text-xs text-muted-foreground">
                        Tube {t + 1} · {fiberColor(t * 12 + 1).tubeColor}
                      </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                      {Array.from({ length: Math.min(12, r.fiberCount - t * 12) }, (_, i) => {
                        const n = t * 12 + i + 1;
                        return <Port key={n} portKey={`f:${r.id}:${n}`} label={`${n} ${fiberColor(n).color}`} />;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </section>
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Splitters</h2>
            {canEdit ? (
              <div className="flex gap-2">
                <SimpleSelect testId="splitter-ratio" label="Ratio" value={ratio} onChange={setRatio} options={ratioOptions} className="w-28" />
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(() => addSplitter({ data: { projectId, boxId, ratio: Number(ratio) } })).then(
                      (made) => made && pushUndo(() => removeSplitter({ data: { projectId, splitterId: made.id } })),
                    )
                  }
                >
                  Add splitter
                </Button>
              </div>
            ) : null}
            {splitters.length === 0 ? <p className="text-sm text-muted-foreground">No splitters in this box.</p> : null}
            {splitters.map((sp, i) => (
              <div key={sp.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Splitter {i + 1} <Badge variant="secondary">1:{sp.ratio}</Badge>
                  </span>
                  {canEdit ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove splitter ${i + 1}`}
                      onClick={() => void run(() => removeSplitter({ data: { projectId, splitterId: sp.id } }))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <Port portKey={`si:${sp.id}`} label="Input" />
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: sp.ratio }, (_, o) => (
                    <Port key={o} portKey={`so:${sp.id}:${o + 1}`} label={`${o + 1}`} />
                  ))}
                </div>
              </div>
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Customer drops</h2>
            {customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No customer has a drop cable to this box.</p>
            ) : (
              <div className="grid gap-1.5">
                {customers.map((c) => (
                  <Port key={c.id} portKey={`d:${c.id}`} label={c.name} />
                ))}
              </div>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Connections</h2>
            {links.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {canEdit ? "Click two ports to connect them." : "No connections yet."}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {links.map((c) => (
                  <li key={c.id} data-testid="connection-row" className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="min-w-0">
                      {portLabel(c.a)} <span className="text-muted-foreground">↔</span> {portLabel(c.b)}
                    </span>
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void run(() => disconnectPorts({ data: { projectId, connectionId: c.id } })).then(
                            (gone) => gone && pushUndo(() => connectPorts({ data: { projectId, boxId, a: gone.a, b: gone.b, id: gone.id } })),
                          )
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </ProjectFrame>
  );
}
