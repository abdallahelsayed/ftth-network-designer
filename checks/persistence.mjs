// Projects, map features, diagrams and settings survive a restart.
import { startRuntime, expect } from "/home/user/oss-new/control/runtime/index.mjs";
import { connect, createProject, drawRoute, placeElement, plan } from "./lib.mjs";

const runtime = await startRuntime();
try {
  const page = await (await runtime.context("owner")).newPage();
  const projectId = await createProject(page, { name: "Valley Road rollout", description: "Rural extension", lat: 48.8566, lng: 2.3522 });
  await placeElement(page, "splitter", 0, 0, "Splitter cabinet 3");
  await drawRoute(page, [[-200, 0], [0, 0]], { name: "Feeder west", fibers: 24, kind: "Feeder" });
  const before = await plan(runtime, projectId);
  const cabinet = before.elements[0];
  const feeder = before.routes[0];
  await page.goto(`/projects/${projectId}/boxes/${cabinet.id}`);
  await page.getByTestId("splitter-ratio").click();
  await page.getByRole("option", { name: "1:16", exact: true }).click();
  await page.getByRole("button", { name: "Add splitter" }).click();
  const input = await page.locator('[data-port^="si:"]').getAttribute("data-port");
  await connect(page, `f:${feeder.id}:1`, input);

  await runtime.restart();

  const after = await plan(runtime, projectId);
  expect(after.project.name).toBe("Valley Road rollout");
  expect(after.elements.map((e) => e.name)).toEqual(["Splitter cabinet 3"]);
  expect(after.routes[0].lengthM).toBeCloseTo(feeder.lengthM, 3);
  expect(after.splitters.map((s) => s.ratio)).toEqual([16]);
  expect(after.connections.length).toBe(1);
  const again = await (await runtime.context("owner")).newPage();
  await again.goto(`/projects/${projectId}/boxes/${cabinet.id}`);
  await expect(again.locator(`[data-port="f:${feeder.id}:1"]`)).toHaveAttribute("data-connected", "true");
} finally {
  await runtime.close();
}
