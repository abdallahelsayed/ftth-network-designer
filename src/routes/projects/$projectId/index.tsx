import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Download, MousePointer2, Pencil, Ruler, Spline, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css?url";
import { PageHeader } from "@/client/components/PageHeader";
import { errorMessage, ProjectFrame, ProjectNotFound } from "@/client/components/ProjectFrame";
import { SimpleSelect } from "@/client/components/SimpleSelect";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { KIND_CLASS, NetworkMap, exportMapPng } from "@/client/map/NetworkMap";
import {
  BOX_KINDS,
  ELEMENT_KINDS,
  ELEMENT_LABELS,
  FIBER_COUNTS,
  ROUTE_KINDS,
  ROUTE_LABELS,
  pathLengthM,
  type ElementKind,
  type RouteKind,
} from "@/lib/network";
import type { Plan } from "@/server/projects";
import {
  createElement,
  createLayer,
  createRoute,
  deleteElement,
  deleteRoute,
  getPlan,
  updateElement,
  updateLayer,
  updateRoute,
} from "@/serverFunctions/projects";

export const Route = createFileRoute("/projects/$projectId/")({
  loader: ({ params }) => getPlan({ data: { projectId: params.projectId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.project.name} · Map` : "Project not found" }],
    links: [{ rel: "stylesheet", href: leafletCss }],
  }),
  component: MapPage,
});

type El = Plan["elements"][number];
type Rt = Plan["routes"][number];
type Tool = "select" | ElementKind | "route" | "measure";
interface UndoStep {
  undo: () => Promise<unknown>;
  createdElementId?: string;
}

const UNDO_LIMIT = 50;
export const meters = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;

function MapPage() {
  const plan = Route.useLoaderData();
  if (!plan) return <ProjectNotFound />;
  return <MapEditor key={plan.project.id} plan={plan} />;
}

function MapEditor({ plan }: { plan: Plan }) {
  const router = useRouter();
  const projectId = plan.project.id;
  const canEdit = plan.canEdit;
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ pt: [number, number]; ref: string | null }[]>([]);
  const [measure, setMeasure] = useState<[number, number][]>([]);
  const [finishing, setFinishing] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(plan.layers.filter((l) => !l.visible).map((l) => l.id)));
  const [activeLayer, setActiveLayer] = useState(plan.layers[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);

  const visibleElements = useMemo(() => plan.elements.filter((e) => !hidden.has(e.layerId)), [plan.elements, hidden]);
  const visibleRoutes = useMemo(() => plan.routes.filter((r) => !hidden.has(r.layerId)), [plan.routes, hidden]);
  const selectedElement = plan.elements.find((e) => e.id === selected) ?? null;
  const selectedRoute = plan.routes.find((r) => r.id === selected) ?? null;
  const layerId = plan.layers.some((l) => l.id === activeLayer) ? activeLayer : plan.layers[0]!.id;

  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      const result = await work();
      await router.invalidate();
      return result;
    } catch (cause) {
      setError(errorMessage(cause));
      return undefined;
    }
  }
  const pushUndo = (step: UndoStep) => setUndoStack((s) => [...s, step].slice(-UNDO_LIMIT));

  async function undo() {
    const step = undoStack[undoStack.length - 1];
    if (!step) return;
    setUndoStack((s) => s.slice(0, -1));
    setSelected(null);
    await run(step.undo);
  }

  function chooseTool(next: Tool) {
    setTool(next);
    setDraft([]);
    if (next !== "select") setSelected(null);
    if (next !== "measure") setMeasure([]);
  }

  async function placeElement(kind: ElementKind, lat: number, lng: number) {
    const n = plan.elements.filter((e) => e.kind === kind).length + 1;
    const created = await run(() =>
      createElement({ data: { projectId, layerId, kind, name: `${ELEMENT_LABELS[kind]} ${n}`, lat, lng } }),
    );
    if (!created) return;
    setSelected(created.id);
    setTool("select");
    pushUndo({ createdElementId: created.id, undo: () => deleteElement({ data: { projectId, elementId: created.id } }) });
  }

  const handlers = {
    onMapClick(lat: number, lng: number) {
      if (tool === "measure") setMeasure((m) => [...m, [lat, lng]]);
      else if (tool === "route") setDraft((d) => [...d, { pt: [lat, lng], ref: null }]);
      else if (tool !== "select" && canEdit) void placeElement(tool, lat, lng);
      else setSelected(null);
    },
    onElementClick(e: El) {
      if (tool === "measure") setMeasure((m) => [...m, [e.lat, e.lng]]);
      else if (tool === "route") setDraft((d) => [...d, { pt: [e.lat, e.lng], ref: e.id }]);
      else setSelected(e.id);
    },
    onRouteClick(r: Rt) {
      if (tool === "select") setSelected(r.id);
    },
    onElementMoved(e: El, lat: number, lng: number) {
      void run(() => updateElement({ data: { projectId, elementId: e.id, lat, lng } })).then(() =>
        pushUndo({ undo: () => updateElement({ data: { projectId, elementId: e.id, lat: e.lat, lng: e.lng } }) }),
      );
    },
  };

  const tools: { id: Tool; label: string; icon?: typeof Ruler }[] = [
    { id: "select", label: "Select", icon: MousePointer2 },
    ...(canEdit ? ELEMENT_KINDS.map((k) => ({ id: k as Tool, label: ELEMENT_LABELS[k] })) : []),
    ...(canEdit ? [{ id: "route" as Tool, label: "Route", icon: Spline }] : []),
    { id: "measure", label: "Measure", icon: Ruler },
  ];
  const measured = pathLengthM(measure);

  return (
    <ProjectFrame projectId={projectId} wide>
      <PageHeader
        title={plan.project.name}
        description={plan.project.description || undefined}
        actions={
          <Button
            variant="outline"
            data-testid="export-png"
            onClick={() => mapRef.current && void exportMapPng(mapRef.current, visibleElements, visibleRoutes, "network-map.png")}
          >
            <Download data-icon="inline-start" aria-hidden />
            PNG
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Map tools">
            {tools.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={tool === t.id ? "default" : "outline"}
                data-testid={`tool-${t.id}`}
                aria-pressed={tool === t.id}
                onClick={() => chooseTool(t.id)}
              >
                {t.icon ? (
                  <t.icon data-icon="inline-start" aria-hidden />
                ) : (
                  <span aria-hidden className={`size-2.5 rounded-full ${KIND_CLASS[t.id as ElementKind]}`} />
                )}
                {t.label}
              </Button>
            ))}
            {canEdit ? (
              <Button size="sm" variant="ghost" data-testid="undo" disabled={!undoStack.length} onClick={() => void undo()}>
                <Undo2 data-icon="inline-start" aria-hidden />
                Undo
              </Button>
            ) : null}
          </div>
          {tool === "route" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {draft.length} points · {meters(pathLengthM(draft.map((d) => d.pt)))}
              </span>
              <Button size="sm" data-testid="finish-route" disabled={draft.length < 2} onClick={() => setFinishing(true)}>
                Finish route
              </Button>
              <Button size="sm" variant="ghost" disabled={!draft.length} onClick={() => setDraft([])}>
                Clear
              </Button>
            </div>
          ) : null}
          {tool === "measure" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span data-testid="measure-distance" className="font-medium tabular-nums">
                {meters(measured)}
              </span>
              <Button size="sm" variant="ghost" disabled={!measure.length} onClick={() => setMeasure([])}>
                Clear
              </Button>
            </div>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <NetworkMap
            center={[plan.project.centerLat, plan.project.centerLng]}
            elements={visibleElements}
            routes={visibleRoutes}
            draft={draft.map((d) => d.pt)}
            measure={measure}
            selectedId={selected}
            draggable={canEdit && tool === "select"}
            handlers={handlers}
            onReady={(map) => (mapRef.current = map)}
          />
        </div>
        <aside className="space-y-6">
          {selectedElement ? (
            <ElementPanel
              key={selectedElement.id + selectedElement.name}
              plan={plan}
              element={selectedElement}
              onSave={(change) =>
                void run(() => updateElement({ data: { projectId, elementId: selectedElement.id, ...change } })).then(() => {
                  const top = undoStack[undoStack.length - 1];
                  if (top?.createdElementId === selectedElement.id) return;
                  const before = { name: selectedElement.name, address: selectedElement.address, notes: selectedElement.notes, layerId: selectedElement.layerId };
                  pushUndo({ undo: () => updateElement({ data: { projectId, elementId: selectedElement.id, ...before } }) });
                })
              }
              onDelete={() =>
                void run(() => deleteElement({ data: { projectId, elementId: selectedElement.id } })).then((gone) => {
                  setSelected(null);
                  if (gone) pushUndo({ undo: () => createElement({ data: { ...gone.element, reattach: gone.reattach } }) });
                })
              }
            />
          ) : null}
          {selectedRoute ? (
            <RoutePanel
              key={selectedRoute.id + selectedRoute.name}
              plan={plan}
              route={selectedRoute}
              onSave={(change) =>
                void run(() => updateRoute({ data: { projectId, routeId: selectedRoute.id, ...change } })).then(() => {
                  const before = { name: selectedRoute.name, fiberCount: selectedRoute.fiberCount, kind: selectedRoute.kind, layerId: selectedRoute.layerId };
                  pushUndo({ undo: () => updateRoute({ data: { projectId, routeId: selectedRoute.id, ...before } }) });
                })
              }
              onDelete={() =>
                void run(() => deleteRoute({ data: { projectId, routeId: selectedRoute.id } })).then((gone) => {
                  setSelected(null);
                  if (gone) pushUndo({ undo: () => createRoute({ data: { projectId, ...gone.route } }) });
                })
              }
            />
          ) : null}
          <LayersPanel
            plan={plan}
            hidden={hidden}
            activeLayer={layerId}
            onActive={setActiveLayer}
            onToggle={(id) => {
              const next = new Set(hidden);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              setHidden(next);
              if (canEdit) void updateLayer({ data: { projectId, layerId: id, visible: !next.has(id) } });
            }}
            onCreate={(name) => run(() => createLayer({ data: { projectId, name } }))}
            onRename={(id, name) => run(() => updateLayer({ data: { projectId, layerId: id, name } }))}
          />
          <FeatureList plan={plan} selected={selected} onSelect={(id) => { setTool("select"); setSelected(id); }} />
        </aside>
      </div>
      {finishing ? (
        <RouteDialog
          defaultName={`Route ${plan.routes.length + 1}`}
          lengthM={pathLengthM(draft.map((d) => d.pt))}
          onClose={() => setFinishing(false)}
          onSave={async (values) => {
            const created = await run(() =>
              createRoute({
                data: {
                  projectId,
                  layerId,
                  ...values,
                  points: draft.map((d) => d.pt),
                  fromElementId: draft[0]?.ref ?? null,
                  toElementId: draft[draft.length - 1]?.ref ?? null,
                },
              }),
            );
            if (!created) return false;
            pushUndo({ undo: () => deleteRoute({ data: { projectId, routeId: created.id } }) });
            setDraft([]);
            setFinishing(false);
            setTool("select");
            setSelected(created.id);
            return true;
          }}
        />
      ) : null}
    </ProjectFrame>
  );
}

function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

const layerOptions = (plan: Plan) => plan.layers.map((l) => ({ value: l.id, label: l.name }));

function ElementPanel({
  plan,
  element,
  onSave,
  onDelete,
}: {
  plan: Plan;
  element: El;
  onSave: (change: { name: string; address: string; notes: string; layerId: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(element.name);
  const [address, setAddress] = useState(element.address);
  const [notes, setNotes] = useState(element.notes);
  const [layer, setLayer] = useState(element.layerId);
  const readOnly = !plan.canEdit;
  const isBox = BOX_KINDS.includes(element.kind);
  return (
    <Panel title={ELEMENT_LABELS[element.kind]}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name, address, notes, layerId: layer });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="el-name">Name</Label>
          <Input id="el-name" data-testid="element-name" value={name} onChange={(e) => setName(e.target.value)} readOnly={readOnly} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="el-address">Address</Label>
          <Input id="el-address" data-testid="element-address" value={address} onChange={(e) => setAddress(e.target.value)} readOnly={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="el-notes">Notes</Label>
          <Textarea id="el-notes" data-testid="element-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={readOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="el-layer">Layer</Label>
          <SimpleSelect id="el-layer" value={layer} onChange={setLayer} options={layerOptions(plan)} disabled={readOnly} />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {element.lat.toFixed(6)}, {element.lng.toFixed(6)}
        </p>
        <div className="flex flex-wrap gap-2">
          {plan.canEdit ? (
            <>
              <Button type="submit" size="sm" data-testid="save-element">
                Save
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
                Delete
              </Button>
            </>
          ) : null}
          {isBox ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="open-diagram"
              render={<Link to="/projects/$projectId/boxes/$boxId" params={{ projectId: plan.project.id, boxId: element.id }} />}
            >
              Splice diagram
            </Button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

const fiberOptions = FIBER_COUNTS.map((n) => ({ value: String(n), label: String(n) }));
const kindOptions = ROUTE_KINDS.map((k) => ({ value: k, label: ROUTE_LABELS[k] }));

function RoutePanel({
  plan,
  route,
  onSave,
  onDelete,
}: {
  plan: Plan;
  route: Rt;
  onSave: (change: { name: string; fiberCount: number; kind: RouteKind; layerId: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(route.name);
  const [fibers, setFibers] = useState(String(route.fiberCount));
  const [kind, setKind] = useState<RouteKind>(route.kind);
  const [layer, setLayer] = useState(route.layerId);
  const readOnly = !plan.canEdit;
  const nameOf = (id: string | null) => plan.elements.find((e) => e.id === id)?.name ?? "Open end";
  return (
    <Panel title="Cable route">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name, fiberCount: Number(fibers), kind, layerId: layer });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="rt-name">Name</Label>
          <Input id="rt-name" value={name} onChange={(e) => setName(e.target.value)} readOnly={readOnly} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rt-fibers">Fibers</Label>
            <SimpleSelect id="rt-fibers" value={fibers} onChange={setFibers} options={fiberOptions} disabled={readOnly} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rt-kind">Kind</Label>
            <SimpleSelect id="rt-kind" value={kind} onChange={setKind} options={kindOptions} disabled={readOnly} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rt-layer">Layer</Label>
          <SimpleSelect id="rt-layer" value={layer} onChange={setLayer} options={layerOptions(plan)} disabled={readOnly} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Length</dt>
          <dd className="tabular-nums">{meters(route.lengthM)}</dd>
          <dt className="text-muted-foreground">From</dt>
          <dd>{nameOf(route.fromElementId)}</dd>
          <dt className="text-muted-foreground">To</dt>
          <dd>{nameOf(route.toElementId)}</dd>
        </dl>
        {plan.canEdit ? (
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

function LayersPanel({
  plan,
  hidden,
  activeLayer,
  onActive,
  onToggle,
  onCreate,
  onRename,
}: {
  plan: Plan;
  hidden: Set<string>;
  activeLayer: string;
  onActive: (id: string) => void;
  onToggle: (id: string) => void;
  onCreate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<unknown>;
}) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  return (
    <Panel title="Layers">
      <ul className="space-y-1">
        {plan.layers.map((layer) => (
          <li key={layer.id} data-testid="layer-row" className="flex items-center gap-2 text-sm">
            <Checkbox
              data-testid="layer-visible"
              aria-label={`Show ${layer.name}`}
              checked={!hidden.has(layer.id)}
              onCheckedChange={() => onToggle(layer.id)}
            />
            {renaming === layer.id ? (
              <Input
                data-testid="layer-name-input"
                className="h-7"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => setRenaming(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(null);
                  if (e.key === "Enter" && renameValue.trim()) {
                    e.preventDefault();
                    void onRename(layer.id, renameValue.trim()).then(() => setRenaming(null));
                  }
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">{layer.name}</span>
            )}
            {plan.canEdit && renaming !== layer.id ? (
              <Button
                size="icon-sm"
                variant="ghost"
                data-testid="rename-layer"
                aria-label={`Rename ${layer.name}`}
                onClick={() => {
                  setRenaming(layer.id);
                  setRenameValue(layer.name);
                }}
              >
                <Pencil aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {plan.canEdit ? (
        <>
          {plan.layers.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="active-layer">New items go on</Label>
              <SimpleSelect id="active-layer" testId="active-layer" value={activeLayer} onChange={onActive} options={layerOptions(plan)} />
            </div>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              void onCreate(newName.trim()).then(() => setNewName(""));
            }}
          >
            <Input
              data-testid="new-layer-name"
              aria-label="New layer name"
              placeholder="New layer"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={120}
            />
            <Button type="submit" size="sm" variant="outline">
              Add layer
            </Button>
          </form>
        </>
      ) : null}
    </Panel>
  );
}

function FeatureList({ plan, selected, onSelect }: { plan: Plan; selected: string | null; onSelect: (id: string) => void }) {
  if (!plan.elements.length && !plan.routes.length) {
    return (
      <Panel title="Network">
        <p className="text-sm text-muted-foreground">
          {plan.canEdit ? "Pick a tool above and click the map." : "Nothing on the map yet."}
        </p>
      </Panel>
    );
  }
  const row = "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted";
  return (
    <Panel title="Network">
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {plan.elements.map((e) => (
          <li key={e.id}>
            <button type="button" data-testid="feature-row" data-kind={e.kind} className={`${row} ${selected === e.id ? "bg-muted" : ""}`} onClick={() => onSelect(e.id)}>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${KIND_CLASS[e.kind]}`} />
                <span className="truncate">{e.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{ELEMENT_LABELS[e.kind]}</span>
            </button>
          </li>
        ))}
        {plan.routes.map((r) => (
          <li key={r.id}>
            <button type="button" data-testid="feature-row" data-kind="route" className={`${row} ${selected === r.id ? "bg-muted" : ""}`} onClick={() => onSelect(r.id)}>
              <span className="min-w-0 truncate">
                {r.name} <span className="text-xs text-muted-foreground">· {r.fiberCount}F {ROUTE_LABELS[r.kind]}</span>
              </span>
              <span data-testid="route-length" className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {meters(r.lengthM)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RouteDialog({
  defaultName,
  lengthM,
  onClose,
  onSave,
}: {
  defaultName: string;
  lengthM: number;
  onClose: () => void;
  onSave: (values: { name: string; fiberCount: number; kind: RouteKind }) => Promise<boolean>;
}) {
  const [name, setName] = useState(defaultName);
  const [fibers, setFibers] = useState("12");
  const [kind, setKind] = useState<RouteKind>("distribution");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPending(true);
            void onSave({ name, fiberCount: Number(fibers), kind }).then((ok) => !ok && setPending(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>New route · {meters(lengthM)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nr-name">Route name</Label>
            <Input id="nr-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nr-fibers">Fiber count</Label>
              <SimpleSelect id="nr-fibers" testId="route-fibers" value={fibers} onChange={setFibers} options={fiberOptions} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nr-kind">Kind</Label>
              <SimpleSelect id="nr-kind" testId="route-kind" value={kind} onChange={setKind} options={kindOptions} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" pending={pending}>
              Save route
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
