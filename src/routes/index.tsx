import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { errorMessage } from "@/client/components/ProjectFrame";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
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
import { createProject, getProjects } from "@/serverFunctions/projects";

export const Route = createFileRoute("/")({
  loader: () => getProjects(),
  head: () => ({ meta: [{ title: "Projects · FTTH Network Designer" }] }),
  component: Projects,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

function Projects() {
  const projects = Route.useLoaderData();
  const [open, setOpen] = useState(false);
  const newButton = (
    <Button data-testid="new-project" onClick={() => setOpen(true)}>
      <Plus data-icon="inline-start" aria-hidden />
      New project
    </Button>
  );
  return (
    <AppShell>
      <PageHeader title="Projects" actions={newButton} />
      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create one to start drawing your network."
          media="rows"
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                data-testid="project-link"
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  {p.description ? (
                    <div className="truncate text-sm text-muted-foreground">{p.description}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                  <span>{p.elementCount} elements</span>
                  <Badge variant="secondary">{ROLE_LABEL[p.role] ?? p.role}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open ? <NewProjectDialog onClose={() => setOpen(false)} /> : null}
    </AppShell>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setPending(true);
    setError(null);
    try {
      const { id } = await createProject({
        data: {
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? ""),
          centerLat: Number(data.get("lat")),
          centerLng: Number(data.get("lng")),
        },
      });
      await navigate({ to: "/projects/$projectId", params: { projectId: id } });
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="np-name">Name</Label>
            <Input id="np-name" name="name" required maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="np-description">Description</Label>
            <Textarea id="np-description" name="description" rows={2} maxLength={1000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="np-lat">Center latitude</Label>
              <Input id="np-lat" name="lat" type="number" step="any" min={-90} max={90} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-lng">Center longitude</Label>
              <Input id="np-lng" name="lng" type="number" step="any" min={-180} max={180} required />
            </div>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" pending={pending}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
