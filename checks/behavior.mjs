// Main path of every feature: a project, its map, splice diagrams, the
// optical budget and the materials and exports.
import { startRuntime, expect } from "/home/user/oss-new/control/runtime/index.mjs";
import { connect, createProject, drawRoute, mapPoint, placeElement, plan } from "./lib.mjs";

const runtime = await startRuntime();
try {
  await runtime.assertPrivateAccess(["/"]);
  const context = await runtime.context("owner", { acceptDownloads: true });
  const page = await context.newPage();

  // F001: a project with a map centre.
  await page.goto("/");
  await runtime.assertBackLink(page);
  const projectId = await createProject(page, {
    name: "Harbor District FTTH",
    description: "GPON build for the harbor blocks, phase one",
    lat: 45.5017,
    lng: -73.5673,
  });
  await runtime.assertBackLink(page);
  await page.goto("/");
  await expect(page.getByTestId("project-link").filter({ hasText: "Harbor District FTTH" })).toBeVisible();
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByTestId("map")).toBeVisible();

  // F002: points, routes snapped to them, lengths.
  await placeElement(page, "closure", -100, 0, "Closure Pier St");
  await placeElement(page, "nap", 120, 0, "NAP Dock 4");
  await placeElement(page, "customer", 240, 80, "Bakery on Quay Rd");
  await drawRoute(page, [[-320, -40], [-100, 0]], { name: "Feeder from CO", fibers: 48, kind: "Feeder" });
  await drawRoute(page, [[-100, 0], [10, -30], [120, 0]], { name: "Pier to Dock 4", fibers: 12, kind: "Distribution" });
  await drawRoute(page, [[120, 0], [240, 80]], { name: "Drop bakery", fibers: 12, kind: "Drop" });

  let data = await plan(runtime, projectId);
  const closure = data.elements.find((e) => e.name === "Closure Pier St");
  const nap = data.elements.find((e) => e.name === "NAP Dock 4");
  const customer = data.elements.find((e) => e.name === "Bakery on Quay Rd");
  const feeder = data.routes.find((r) => r.name === "Feeder from CO");
  const dist = data.routes.find((r) => r.name === "Pier to Dock 4");
  const drop = data.routes.find((r) => r.name === "Drop bakery");
  expect(feeder.fromElementId).toBeNull();
  expect(feeder.toElementId).toBe(closure.id);
  expect(feeder.fiberCount).toBe(48);
  expect(feeder.kind).toBe("feeder");
  expect(dist.fromElementId).toBe(closure.id);
  expect(dist.toElementId).toBe(nap.id);
  expect(drop.toElementId).toBe(customer.id);
  expect(dist.points.length).toBe(3);
  expect(dist.lengthM).toBeGreaterThan(50);

  // Editing an element's details.
  await page.getByTestId("feature-row").filter({ hasText: "Bakery on Quay Rd" }).click();
  await page.getByTestId("element-address").fill("12 Quay Road");
  await page.getByTestId("save-element").click();
  await expect.poll(async () => (await plan(runtime, projectId)).elements.find((e) => e.id === customer.id).address).toBe("12 Quay Road");

  // Undo removes a just-placed pole.
  await placeElement(page, "pole", 0, 120, "Pole 17");
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("feature-row").filter({ hasText: "Pole 17" })).toHaveCount(0);

  // Layers: create, rename, hide and show.
  await page.getByTestId("new-layer-name").fill("Phase two");
  await page.getByRole("button", { name: "Add layer" }).click();
  const phase = page.getByTestId("layer-row").filter({ hasText: "Phase two" });
  await expect(phase).toBeVisible();
  await phase.getByTestId("rename-layer").click();
  await page.getByTestId("layer-name-input").fill("Phase two north");
  await page.getByTestId("layer-name-input").press("Enter");
  await expect(page.getByTestId("layer-row").filter({ hasText: "Phase two north" })).toBeVisible();
  const markers = page.getByTestId("map").getByTestId("marker");
  await expect(markers).toHaveCount(3);
  const main = page.getByTestId("layer-row").first();
  await main.getByTestId("layer-visible").click();
  await expect(markers).toHaveCount(0);
  await main.getByTestId("layer-visible").click();
  await expect(markers).toHaveCount(3);

  // Measuring saves nothing.
  await page.getByTestId("tool-measure").click();
  for (const [dx, dy] of [[-200, 150], [200, 150]]) {
    const p = await mapPoint(page, dx, dy);
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.getByTestId("measure-distance")).toHaveText(/[1-9][\d,]* m/);
  data = await plan(runtime, projectId);
  expect(data.routes.length).toBe(3);

  // Map PNG.
  await page.getByTestId("tool-select").click();
  const [png] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);

  // F003: the closure's diagram, colours, a splitter and splices.
  await page.goto(`/projects/${projectId}/boxes/${closure.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Closure Pier St");
  await expect(page.locator(`[data-port="f:${feeder.id}:1"]`)).toContainText("Blue");
  await expect(page.locator(`[data-port="f:${feeder.id}:12"]`)).toContainText("Aqua");
  await expect(page.locator(`[data-port="f:${feeder.id}:13"]`)).toContainText("Blue");
  await expect(page.locator(`[data-port^="f:${feeder.id}:"]`)).toHaveCount(48);
  await page.getByTestId("splitter-ratio").click();
  await page.getByRole("option", { name: "1:8", exact: true }).click();
  await page.getByRole("button", { name: "Add splitter" }).click();
  await expect(page.locator('[data-port^="so:"]')).toHaveCount(8);
  const splitterIn = await page.locator('[data-port^="si:"]').getAttribute("data-port");
  const splitterId = splitterIn.slice(3);
  await connect(page, `f:${feeder.id}:1`, splitterIn);
  // A port takes one connection only.
  await page.locator(`[data-port="f:${feeder.id}:2"]`).click();
  await page.locator(`[data-port="${splitterIn}"]`).click();
  await expect(page.getByTestId("diagram-error")).toBeVisible();
  await expect(page.locator(`[data-port="f:${feeder.id}:2"]`)).toHaveAttribute("data-connected", "false");
  // Undo in the diagram.
  await connect(page, `f:${feeder.id}:3`, `f:${dist.id}:5`);
  await page.getByTestId("diagram-undo").click();
  await expect(page.locator(`[data-port="f:${feeder.id}:3"]`)).toHaveAttribute("data-connected", "false");
  // Auto-connect the NAP: its fiber goes to the next free port.
  await page.getByTestId(`autoconnect-${dist.id}`).click();
  await expect(page.locator(`[data-port="f:${dist.id}:1"]`)).toHaveAttribute("data-connected", "true");
  await expect(page.locator(`[data-port="so:${splitterId}:1"]`)).toHaveAttribute("data-connected", "true");
  await expect(page.getByTestId("connection-row")).toHaveCount(2);

  // The NAP: a splitter and the customer's drop.
  await page.goto(`/projects/${projectId}/boxes/${nap.id}`);
  await page.getByTestId("splitter-ratio").click();
  await page.getByRole("option", { name: "1:8", exact: true }).click();
  await page.getByRole("button", { name: "Add splitter" }).click();
  const napIn = await page.locator('[data-port^="si:"]').getAttribute("data-port");
  await connect(page, `f:${dist.id}:1`, napIn);
  await connect(page, `so:${napIn.slice(3)}:1`, `d:${customer.id}`);

  // F004: the budget traces the customer back to the feeder.
  await page.goto(`/projects/${projectId}/budget`);
  const row = page.getByTestId("budget-row").filter({ hasText: "Bakery on Quay Rd" });
  await expect(row.getByTestId("verdict")).toHaveText("OK");
  await expect(row).toContainText(/dBm/);
  data = await plan(runtime, projectId);
  const result = data.budget.customers.find((c) => c.customerId === customer.id);
  expect(result.splitterLossDb).toBeCloseTo(21, 0);
  expect(result.totalLossDb).toBeGreaterThan(21);
  expect(result.totalLossDb).toBeLessThan(28);
  await expect(page.getByTestId("alert-row").filter({ hasText: "Bakery" })).toHaveCount(0);

  // A stricter attenuation pushes it over budget.
  await page.goto(`/projects/${projectId}/settings`);
  await page.getByLabel("Fiber attenuation (dB/km)").fill("40");
  await page.getByTestId("save-settings").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await page.goto(`/projects/${projectId}/budget`);
  await expect(row.getByTestId("verdict")).toHaveText("Over budget");
  await expect(page.getByTestId("alert-row").filter({ hasText: "Bakery on Quay Rd" })).toBeVisible();
  await page.goto(`/projects/${projectId}/settings`);
  await page.getByLabel("Fiber attenuation (dB/km)").fill("0.35");
  await page.getByTestId("save-settings").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();

  // F005: materials, CSV, printable plan.
  await page.goto(`/projects/${projectId}/materials`);
  const cable48 = page.getByTestId("cable-row").filter({ hasText: "48 fibers" });
  await expect(cable48).toBeVisible();
  const expected48 = Math.ceil(feeder.lengthM * 1.03 + 30);
  await expect(cable48.getByTestId("cable-total")).toHaveText(`${expected48.toLocaleString("en-US")} m`);
  await expect(page.getByTestId("count-row").filter({ hasText: "Splitter 1:8" })).toContainText("2");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const csvRes = await runtime.fetch(`/api/projects/${projectId}/materials?kinds=customer,nap`, { role: "owner" });
  expect(csvRes.status).toBe(200);
  expect(csvRes.headers.get("content-type")).toContain("text/csv");
  const csvText = await csvRes.text();
  expect(csvText).toContain("Bakery on Quay Rd");
  expect(csvText).toContain("NAP Dock 4");
  expect(csvText).not.toContain("Closure Pier St,");
  await page.getByTestId("print-plan").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/print$`));
  await expect(page.getByTestId("print-plan-sheet")).toContainText("Harbor District FTTH");
  await expect(page.getByTestId("print-plan-sheet")).toContainText("Bakery on Quay Rd");

  // The picture: the closure's wired splice diagram.
  await page.goto(`/projects/${projectId}/boxes/${closure.id}`);
  await expect(page.getByTestId("connection-row")).toHaveCount(2);
  await runtime.assertBackLink(page);
  await runtime.screenshot(page);

  // Phone-sized smoke.
  const phone = await runtime.context("owner", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const small = await phone.newPage();
  await small.goto("/");
  await expect(small.getByTestId("project-link").filter({ hasText: "Harbor District FTTH" })).toBeVisible();
  await small.goto(`/projects/${projectId}/budget`);
  await expect(small.getByTestId("budget-row").first()).toBeVisible();
  const overflow = await small.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
} finally {
  await runtime.close();
}
