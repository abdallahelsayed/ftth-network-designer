import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { PageHeader } from "@/client/components/PageHeader";
import { errorMessage, ProjectFrame, ProjectNotFound } from "@/client/components/ProjectFrame";
import { SimpleSelect } from "@/client/components/SimpleSelect";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { OLT_CLASSES, OLT_CLASS_IDS, type OltClass } from "@/lib/network";
import type { Plan } from "@/server/projects";
import { addMember, deleteProject, getPlan, removeMember, updateProject, updateSettings } from "@/serverFunctions/projects";

export const Route = createFileRoute("/projects/$projectId/settings")({
  loader: ({ params }) => getPlan({ data: { projectId: params.projectId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.project.name} · Settings` : "Project not found" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const plan = Route.useLoaderData();
  if (!plan) return <ProjectNotFound />;
  return (
    <ProjectFrame projectId={plan.project.id}>
      <PageHeader title="Settings" />
      <DetailsSection plan={plan} />
      <NetworkSection plan={plan} />
      {plan.canManage ? <SharingSection plan={plan} /> : null}
      {plan.canManage ? <DeleteSection plan={plan} /> : null}
    </ProjectFrame>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function useSave() {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; error: string | null; saved: boolean }>({ pending: false, error: null, saved: false });
  async function save(work: () => Promise<unknown>) {
    setState({ pending: true, error: null, saved: false });
    try {
      await work();
      await router.invalidate();
      setState({ pending: false, error: null, saved: true });
    } catch (cause) {
      setState({ pending: false, error: errorMessage(cause), saved: false });
    }
  }
  return { ...state, save };
}

function Status({ error, saved, testId }: { error: string | null; saved: boolean; testId: string }) {
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  return saved ? (
    <span data-testid={testId} className="text-sm text-muted-foreground">
      Saved
    </span>
  ) : null;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function DetailsSection({ plan }: { plan: Plan }) {
  const p = plan.project;
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description);
  const [lat, setLat] = useState(String(p.centerLat));
  const [lng, setLng] = useState(String(p.centerLng));
  const { pending, error, saved, save } = useSave();
  const readOnly = !plan.canManage;
  return (
    <Section title="Project">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(() => updateProject({ data: { projectId: p.id, name, description, centerLat: Number(lat), centerLng: Number(lng) } }));
        }}
      >
        <Field id="pr-name" label="Name">
          <Input id="pr-name" data-testid="project-name" value={name} onChange={(e) => setName(e.target.value)} readOnly={readOnly} required maxLength={120} />
        </Field>
        <Field id="pr-description" label="Description">
          <Textarea id="pr-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} readOnly={readOnly} maxLength={1000} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="pr-lat" label="Map center latitude">
            <Input id="pr-lat" type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} readOnly={readOnly} required />
          </Field>
          <Field id="pr-lng" label="Map center longitude">
            <Input id="pr-lng" type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} readOnly={readOnly} required />
          </Field>
        </div>
        {plan.canManage ? (
          <div className="flex items-center gap-3">
            <Button type="submit" data-testid="save-project" pending={pending}>
              Save
            </Button>
            <Status error={error} saved={saved} testId="project-saved" />
          </div>
        ) : null}
      </form>
    </Section>
  );
}

const oltOptions = OLT_CLASS_IDS.map((id) => ({
  value: id,
  label: `${OLT_CLASSES[id].label} · ${OLT_CLASSES[id].maxLossDb} dB, ${OLT_CLASSES[id].txDbm > 0 ? "+" : ""}${OLT_CLASSES[id].txDbm} dBm`,
}));

function NetworkSection({ plan }: { plan: Plan }) {
  const p = plan.project;
  const [olt, setOlt] = useState(p.oltClass as OltClass);
  const [v, setV] = useState({
    attenuationDbKm: String(p.attenuationDbKm),
    spliceLossDb: String(p.spliceLossDb),
    connectorLossDb: String(p.connectorLossDb),
    overlengthPct: String(p.overlengthPct),
    closureReserveM: String(p.closureReserveM),
    splitterReserveM: String(p.splitterReserveM),
  });
  const { pending, error, saved, save } = useSave();
  const readOnly = !plan.canEdit;
  const num = (key: keyof typeof v, label: string) => (
    <Field id={`ns-${key}`} label={label}>
      <Input
        id={`ns-${key}`}
        type="number"
        step="any"
        min={0}
        value={v[key]}
        onChange={(e) => setV({ ...v, [key]: e.target.value })}
        readOnly={readOnly}
        required
      />
    </Field>
  );
  return (
    <Section title="Optical budget and materials">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) as Record<keyof typeof v, number>;
          void save(() => updateSettings({ data: { projectId: p.id, oltClass: olt, ...n } }));
        }}
      >
        <Field id="ns-olt" label="OLT class">
          <SimpleSelect id="ns-olt" testId="olt-class" value={olt} onChange={setOlt} options={oltOptions} disabled={readOnly} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          {num("attenuationDbKm", "Fiber attenuation (dB/km)")}
          {num("spliceLossDb", "Splice loss (dB)")}
          {num("connectorLossDb", "Connector loss (dB)")}
          {num("overlengthPct", "Cable overlength (%)")}
          {num("closureReserveM", "Reserve per closure (m)")}
          {num("splitterReserveM", "Reserve per splitter (m)")}
        </div>
        {plan.canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" data-testid="save-settings" pending={pending}>
              Save
            </Button>
            <Status error={error} saved={saved} testId="settings-saved" />
          </div>
        ) : null}
      </form>
    </Section>
  );
}

const roleOptions = [
  { value: "editor" as const, label: "Editor" },
  { value: "viewer" as const, label: "Viewer" },
];

function SharingSection({ plan }: { plan: Plan }) {
  const projectId = plan.project.id;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const { pending, error, save } = useSave();
  return (
    <Section title="People">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(async () => {
            await addMember({ data: { projectId, email, role } });
            setEmail("");
          });
        }}
      >
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="sh-email">Email</Label>
          <Input id="sh-email" data-testid="share-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <SimpleSelect testId="share-role" label="Role" value={role} onChange={setRole} options={roleOptions} className="w-32" />
        <Button type="submit" pending={pending}>
          Add person
        </Button>
      </form>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {plan.members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Only the owner and organization admins can open this project.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {plan.members.map((m) => (
            <li key={m.email} data-testid="share-row" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{m.email}</span>
              <div className="flex items-center gap-2">
                <SimpleSelect
                  testId="share-row-role"
                  label={`Role of ${m.email}`}
                  value={m.role}
                  onChange={(next) => void save(() => addMember({ data: { projectId, email: m.email, role: next } }))}
                  options={roleOptions}
                  className="w-28"
                />
                <Button size="sm" variant="ghost" onClick={() => void save(() => removeMember({ data: { projectId, email: m.email } }))}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DeleteSection({ plan }: { plan: Plan }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <Section title="Delete project">
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete project
      </Button>
      {open ? (
        <ConfirmDialog
          title={`Delete ${plan.project.name}?`}
          confirmLabel="Delete"
          destructive
          pending={pending}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setPending(true);
            void deleteProject({ data: { projectId: plan.project.id } }).then(() => navigate({ to: "/" }));
          }}
        >
          Its map, splice diagrams and budget are deleted for everyone.
        </ConfirmDialog>
      ) : null}
    </Section>
  );
}
