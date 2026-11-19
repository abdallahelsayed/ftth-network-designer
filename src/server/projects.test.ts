import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

// An in-memory SQLite with the app's migrations stands in for D1.
const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));
vi.mock("@every-app/sdk/server", () => ({ isAdmin: (u: { orgRole: string }) => u.orgRole === "owner" }));

const projects = await import("./projects");
const map = await import("./map");
const diagram = await import("./diagram");

const alice = { id: "alice", email: "alice@example.test", orgId: "org", admin: false };
const bob = { id: "bob", email: "bob@example.test", orgId: "org", admin: false };
const admin = { id: "root", email: "root@example.test", orgId: "org", admin: true };
const stranger = { id: "eve", email: "eve@example.test", orgId: "other", admin: true };

beforeAll(async () => {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  testDb.current = db;
});

async function setup() {
  const { id } = await projects.createProject(alice, { name: "A", description: "", centerLat: 1, centerLng: 2 });
  const plan = await projects.loadPlan(alice, id);
  const layerId = plan.layers[0]!.id;
  const box = await map.createElement(alice, { projectId: id, layerId, kind: "closure", name: "Box", address: "", notes: "", lat: 1, lng: 2, reattach: [] });
  const route = await map.createRoute(alice, { projectId: id, layerId, name: "R", fiberCount: 12, kind: "feeder", points: [[1, 1.99], [1, 2]], fromElementId: null, toElementId: box.id });
  return { id, layerId, boxId: box.id, routeId: route.id };
}

describe("project access", () => {
  it("keeps a project to its owner, admins and people added to it", async () => {
    const { id, layerId } = await setup();
    expect((await projects.listProjects(bob)).map((p) => p.id)).not.toContain(id);
    expect((await projects.listProjects(admin)).map((p) => p.id)).toContain(id);
    expect((await projects.listProjects(stranger)).map((p) => p.id)).not.toContain(id);
    await expect(projects.loadPlan(bob, id)).rejects.toThrow("Project not found");
    await expect(projects.loadPlan(stranger, id)).rejects.toThrow("Project not found");
    await expect(map.createLayer(bob, { projectId: id, name: "x" })).rejects.toThrow();

    await projects.addMember(alice, { projectId: id, email: "bob@example.test", role: "viewer" });
    expect((await projects.loadPlan(bob, id)).role).toBe("viewer");
    await expect(map.createElement(bob, { projectId: id, layerId, kind: "pole", name: "P", address: "", notes: "", lat: 1, lng: 2, reattach: [] })).rejects.toThrow();

    await projects.addMember(alice, { projectId: id, email: "bob@example.test", role: "editor" });
    await map.createElement(bob, { projectId: id, layerId, kind: "pole", name: "P", address: "", notes: "", lat: 1, lng: 2, reattach: [] });
    await expect(projects.addMember(bob, { projectId: id, email: "x@example.test", role: "editor" })).rejects.toThrow();
    await expect(projects.deleteProject(bob, { projectId: id })).rejects.toThrow();
    await expect(projects.updateProject(bob, { projectId: id, name: "B", description: "", centerLat: 0, centerLng: 0 })).rejects.toThrow();

    await projects.addMember(admin, { projectId: id, email: "x@example.test", role: "viewer" });
    await projects.removeMember(alice, { projectId: id, email: "bob@example.test" });
    await expect(projects.loadPlan(bob, id)).rejects.toThrow("Project not found");
  });

  it("refuses ids from another project", async () => {
    const mine = await setup();
    const { id: bobs } = await projects.createProject(bob, { name: "B", description: "", centerLat: 0, centerLng: 0 });
    await expect(map.deleteElement(bob, { projectId: bobs, elementId: mine.boxId })).rejects.toThrow("Element not found");
    await expect(map.createElement(bob, { projectId: bobs, layerId: mine.layerId, kind: "pole", name: "P", address: "", notes: "", lat: 0, lng: 0, reattach: [] })).rejects.toThrow("Layer not found");
    await expect(diagram.addSplitter(bob, { projectId: bobs, boxId: mine.boxId, ratio: 8 })).rejects.toThrow("Box not found");
  });

  it("lets a port carry one connection and deletes everything with the project", async () => {
    const { id, boxId, routeId } = await setup();
    const sp = await diagram.addSplitter(alice, { projectId: id, boxId, ratio: 4 });
    await diagram.connect(alice, { projectId: id, boxId, a: `f:${routeId}:1`, b: `si:${sp.id}` });
    await expect(diagram.connect(alice, { projectId: id, boxId, a: `f:${routeId}:2`, b: `si:${sp.id}` })).rejects.toThrow("already has a connection");
    await expect(diagram.connect(alice, { projectId: id, boxId, a: `f:${routeId}:13`, b: `so:${sp.id}:1` })).rejects.toThrow();
    await projects.deleteProject(alice, { projectId: id });
    await expect(projects.loadPlan(alice, id)).rejects.toThrow("Project not found");
  });
});
