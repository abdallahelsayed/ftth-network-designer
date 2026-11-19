// Who may open and change what: private projects, viewer and editor roles,
// owner/admin-only sharing and deletion, and no sign-in of the app's own.
import { startRuntime, expect } from "/home/user/oss-new/control/runtime/index.mjs";
import { createProject, placeElement, plan, shareProject } from "./lib.mjs";

const runtime = await startRuntime();
try {
  await runtime.assertPrivateAccess(["/", "/health"]);

  // The app has no login, sign-up or account pages of its own.
  for (const path of ["/login", "/signin", "/signup", "/register", "/logout", "/password"]) {
    const res = await runtime.fetch(path, { role: "owner" });
    expect(res.status, path).toBe(404);
    expect(await res.text()).not.toMatch(/type="password"/);
  }

  const ownerCtx = await runtime.context("owner");
  const owner = await ownerCtx.newPage();
  const memberCtx = await runtime.context("member");
  const member = await memberCtx.newPage();

  const projectId = await createProject(owner, { name: "Northside backbone", description: "Owner only", lat: 40.7128, lng: -74.006 });
  await placeElement(owner, "closure", 0, 0, "Closure Elm Ave");

  // Private paths: anonymous and outsider are refused.
  for (const path of [`/projects/${projectId}`, `/api/projects/${projectId}/plan`, `/api/projects/${projectId}/materials`]) {
    for (const role of [undefined, "outsider"]) {
      const res = await runtime.fetch(path, { role });
      expect([401, 403, 302, 303]).toContain(res.status);
    }
  }

  // Another member sees nothing of a project they were not added to.
  expect((await runtime.fetch(`/api/projects/${projectId}/plan`, { role: "member" })).status).toBe(404);
  expect((await runtime.fetch(`/api/projects/${projectId}/materials`, { role: "member" })).status).toBe(404);
  await member.goto("/");
  await expect(member.getByTestId("project-link").filter({ hasText: "Northside backbone" })).toHaveCount(0);
  await member.goto(`/projects/${projectId}`);
  await expect(member.getByTestId("not-found")).toBeVisible();
  await expect(member.getByTestId("map")).toHaveCount(0);

  // Capture the owner's rename call, then replay it as the member: refused.
  await owner.goto(`/projects/${projectId}/settings`);
  await owner.getByTestId("project-name").fill("Northside backbone v2");
  const [renameReq] = await Promise.all([
    owner.waitForRequest((r) => r.method() === "POST" && r.url().includes("/_serverFn/")),
    owner.getByTestId("save-project").click(),
  ]);
  await expect(owner.getByTestId("project-saved")).toBeVisible();
  const replayHeaders = { ...(await renameReq.allHeaders()) };
  for (const name of ["cookie", "content-length", "host"]) delete replayHeaders[name];
  const body = renameReq.postData().replace("Northside backbone v2", "Taken over");
  const replay = await runtime.fetch(new URL(renameReq.url()).pathname + new URL(renameReq.url()).search, {
    role: "member", method: "POST", headers: replayHeaders, body,
  });
  expect(replay.status).toBeGreaterThanOrEqual(400);
  expect((await plan(runtime, projectId)).project.name).toBe("Northside backbone v2");

  // Viewer: sees everything, changes nothing.
  await shareProject(owner, projectId, "member@example.test", "Viewer");
  const viewerPlan = await plan(runtime, projectId, "member");
  expect(viewerPlan.role).toBe("viewer");
  expect(viewerPlan.elements.map((e) => e.name)).toContain("Closure Elm Ave");
  await member.goto("/");
  await expect(member.getByTestId("project-link").filter({ hasText: "Northside backbone v2" })).toBeVisible();
  await member.goto(`/projects/${projectId}`);
  await expect(member.getByTestId("map")).toBeVisible();
  await expect(member.getByTestId("tool-closure")).toHaveCount(0);
  await expect(member.getByTestId("new-layer-name")).toHaveCount(0);
  const closureId = viewerPlan.elements[0].id;
  await member.goto(`/projects/${projectId}/boxes/${closureId}`);
  await expect(member.getByRole("heading", { level: 1 })).toHaveText("Closure Elm Ave");
  await expect(member.getByRole("button", { name: "Add splitter" })).toHaveCount(0);
  await member.goto(`/projects/${projectId}/settings`);
  await expect(member.getByTestId("save-settings")).toHaveCount(0);
  await expect(member.getByTestId("share-email")).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Delete project" })).toHaveCount(0);
  const asViewer = await runtime.fetch(new URL(renameReq.url()).pathname, { role: "member", method: "POST", headers: replayHeaders, body });
  expect(asViewer.status).toBeGreaterThanOrEqual(400);
  expect((await plan(runtime, projectId)).project.name).toBe("Northside backbone v2");

  // Editor: changes the map, but not sharing or deletion.
  await owner.goto(`/projects/${projectId}/settings`);
  const row = owner.getByTestId("share-row").filter({ hasText: "member@example.test" });
  await row.getByTestId("share-row-role").click();
  await owner.getByRole("option", { name: "Editor", exact: true }).click();
  await expect.poll(async () => (await plan(runtime, projectId, "member")).role).toBe("editor");
  await member.goto(`/projects/${projectId}`);
  await placeElement(member, "pole", 60, 60, "Pole by the school");
  await member.goto(`/projects/${projectId}/settings`);
  await expect(member.getByTestId("save-settings")).toBeVisible();
  await expect(member.getByTestId("share-email")).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Delete project" })).toHaveCount(0);

  // Replaying the owner's add-person call as the editor is refused.
  await owner.goto(`/projects/${projectId}/settings`);
  await owner.getByTestId("share-email").fill("planner2@example.test");
  await owner.getByTestId("share-role").click();
  await owner.getByRole("option", { name: "Viewer", exact: true }).click();
  const [shareReq] = await Promise.all([
    owner.waitForRequest((r) => r.method() === "POST" && r.url().includes("/_serverFn/")),
    owner.getByRole("button", { name: "Add person" }).click(),
  ]);
  await expect(owner.getByTestId("share-row").filter({ hasText: "planner2@example.test" })).toBeVisible();
  await owner.getByTestId("share-row").filter({ hasText: "planner2@example.test" }).getByRole("button", { name: "Remove" }).click();
  await expect(owner.getByTestId("share-row").filter({ hasText: "planner2@example.test" })).toHaveCount(0);
  const shareHeaders = { ...(await shareReq.allHeaders()) };
  for (const name of ["cookie", "content-length", "host"]) delete shareHeaders[name];
  const asEditor = await runtime.fetch(new URL(shareReq.url()).pathname, { role: "member", method: "POST", headers: shareHeaders, body: shareReq.postData() });
  expect(asEditor.status).toBeGreaterThanOrEqual(400);
  const shared = await plan(runtime, projectId);
  expect(shared.members.map((m) => m.email)).not.toContain("planner2@example.test");

  // Removal takes access away again.
  await owner.goto(`/projects/${projectId}/settings`);
  await owner.getByTestId("share-row").filter({ hasText: "member@example.test" }).getByRole("button", { name: "Remove" }).click();
  await expect(owner.getByTestId("share-row").filter({ hasText: "member@example.test" })).toHaveCount(0);
  expect((await runtime.fetch(`/api/projects/${projectId}/plan`, { role: "member" })).status).toBe(404);

  // Admin: the organization owner opens and manages a member's project.
  const memberProject = await createProject(member, { name: "Member test route", description: "", lat: 51.5072, lng: -0.1276 });
  await owner.goto("/");
  await expect(owner.getByTestId("project-link").filter({ hasText: "Member test route" })).toBeVisible();
  await owner.goto(`/projects/${memberProject}/settings`);
  await expect(owner.getByTestId("share-email")).toBeVisible();
  await expect(owner.getByRole("button", { name: "Delete project" })).toBeVisible();

  // Deleting removes the project and everything in it.
  await owner.goto(`/projects/${projectId}/settings`);
  await owner.getByRole("button", { name: "Delete project" }).click();
  await Promise.all([owner.waitForURL((u) => u.pathname === "/"), owner.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()]);
  expect((await runtime.fetch(`/api/projects/${projectId}/plan`, { role: "owner" })).status).toBe(404);
  const db = await runtime.database();
  const left = await db.prepare("select count(*) as n from elements where project_id = ?").bind(projectId).first();
  expect(left.n).toBe(0);
} finally {
  await runtime.close();
}
