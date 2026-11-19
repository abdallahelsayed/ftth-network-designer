// Shared steps for the release checks. Selectors are the app's test ids.
import { expect } from "/home/user/oss-new/control/runtime/index.mjs";

export async function createProject(page, { name, description, lat, lng }) {
  await page.goto("/");
  await page.getByTestId("new-project").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Description").fill(description);
  await dialog.getByLabel("Center latitude").fill(String(lat));
  await dialog.getByLabel("Center longitude").fill(String(lng));
  await Promise.all([
    page.waitForURL(/\/projects\/[^/]+$/),
    dialog.getByRole("button", { name: "Create project" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByTestId("map")).toBeVisible();
  return page.url().split("/projects/")[1];
}

/** Pixel offset from the map's centre, in page coordinates. */
export async function mapPoint(page, dx, dy) {
  const box = await page.getByTestId("map").boundingBox();
  return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy };
}

export async function placeElement(page, kind, dx, dy, name) {
  await page.getByTestId(`tool-${kind}`).click();
  const p = await mapPoint(page, dx, dy);
  await page.mouse.click(p.x, p.y);
  const field = page.getByTestId("element-name");
  await expect(field).toBeVisible();
  await field.fill(name);
  await page.getByTestId("save-element").click();
  await expect(page.getByTestId("feature-row").filter({ hasText: name })).toBeVisible();
}

export async function drawRoute(page, offsets, { name, fibers, kind }) {
  await page.getByTestId("tool-route").click();
  for (const [dx, dy] of offsets) {
    const p = await mapPoint(page, dx, dy);
    await page.mouse.click(p.x, p.y);
  }
  await page.getByTestId("finish-route").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Route name").fill(name);
  await dialog.getByTestId("route-fibers").click();
  await page.getByRole("option", { name: String(fibers), exact: true }).click();
  await dialog.getByTestId("route-kind").click();
  await page.getByRole("option", { name: kind, exact: true }).click();
  await dialog.getByRole("button", { name: "Save route" }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByTestId("feature-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("route-length")).toHaveText(/^[1-9][\d,]* m$/);
}

export async function plan(runtime, projectId, role = "owner") {
  const res = await runtime.fetch(`/api/projects/${projectId}/plan`, { role });
  expect(res.status).toBe(200);
  return res.json();
}

export async function connect(page, a, b) {
  await page.locator(`[data-port="${a}"]`).click();
  await page.locator(`[data-port="${b}"]`).click();
  await expect(page.locator(`[data-port="${a}"]`)).toHaveAttribute("data-connected", "true");
  await expect(page.locator(`[data-port="${b}"]`)).toHaveAttribute("data-connected", "true");
}

export async function shareProject(page, projectId, email, role) {
  await page.goto(`/projects/${projectId}/settings`);
  await page.getByTestId("share-email").fill(email);
  await page.getByTestId("share-role").click();
  await page.getByRole("option", { name: role, exact: true }).click();
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByTestId("share-row").filter({ hasText: email })).toBeVisible();
}
