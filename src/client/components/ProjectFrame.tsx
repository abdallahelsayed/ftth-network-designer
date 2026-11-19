import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/client/components/AppShell";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { Button } from "@/client/components/ui/button";

const TABS = [
  { to: "/projects/$projectId", label: "Map", exact: true },
  { to: "/projects/$projectId/budget", label: "Budget", exact: false },
  { to: "/projects/$projectId/materials", label: "Materials", exact: false },
  { to: "/projects/$projectId/settings", label: "Settings", exact: false },
] as const;

const NAV_LINK = "text-sm text-muted-foreground transition-colors hover:text-foreground";

/** The frame of every page inside a project: the way back and the project's tabs. */
export function ProjectFrame({
  projectId,
  wide = false,
  children,
}: {
  projectId: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <AppShell
      wide={wide}
      nav={
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Project">
          <Link to="/" className={NAV_LINK}>
            Projects
          </Link>
          <span className="text-border" aria-hidden>
            |
          </span>
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              params={{ projectId }}
              activeOptions={{ exact: tab.exact }}
              className={NAV_LINK}
              activeProps={{ className: "text-foreground font-medium" }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      }
    >
      {children}
    </AppShell>
  );
}

export function ProjectNotFound() {
  return (
    <AppShell>
      <PageHeader title="Project not found" />
      <div data-testid="not-found">
        <EmptyState
          kind="filtered"
          title="This project doesn't exist or isn't shared with you"
          action={<Button render={<Link to="/" />}>Your projects</Button>}
        />
      </div>
    </AppShell>
  );
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (Array.isArray(parsed) && parsed[0]?.message) return String(parsed[0].message);
    } catch {
      /* not a validation error */
    }
    return error.message;
  }
  return "That didn't work";
}
