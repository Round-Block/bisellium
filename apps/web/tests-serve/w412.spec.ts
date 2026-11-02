import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;
test.afterEach(async () => { await served?.close(); served = undefined; });

const treeA = `tree:${"a".repeat(40)}`;
const treeB = `tree:${"b".repeat(40)}`;
const officina = {
  studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], wip_limit: 4,
  probationes: [
    { id: "spec", name: "Spec", kind: "agent" },
    { id: "review", name: "A deliberately long next-gate name that remains complete in the drawer", kind: "agent" },
    { id: "patron", name: "Patron call", kind: "human" },
  ],
  lifecycle: { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Awaiting review", phase: "awaiting_review" },
    { id: "done", name: "Done", phase: "done" },
    { id: "halted", name: "Halted", phase: "halted" },
  ] },
};
const boundOpus = (revision = treeA) => ({
  id: "W-1", title: `A deliberately long title ${"that remains readable ".repeat(12)}`, body: "", kind: "ui", collegium: "design", sella: "builder", state: "building", tokens: 0,
  probationes: {
    spec: { status: "passed", evidence: { certifies: revision, href: "ci/W-1-spec-1.log" } },
    patron: { status: "pending", evidence: { certifies: revision, href: "decisions/D-412.md" } },
  },
  traditio: { blocked_on: "patron", next: "Decide", at: "2026-11-02T00:00:00Z" },
});
const inbox = { opera: [{ id: "W-1", title: "Decision", collegium: "design", sella: "builder", traditio: undefined }], petitiones: [{ id: "P-1", opus: "W-1", from: "qa-lead", subject: "Decide", body: "Review the bound evidence." }] };

async function install(page: Page, current: () => unknown[]): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: current() }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/live*", (route) => route.fulfill({ contentType: "text/event-stream", body: "" }));
}

test("W-412-b1 drawer binds decision evidence at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w412-b1");
  await install(page, () => [boundOpus()]);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w412=b1-${width}#/board`);
    await page.locator('[data-card-id="W-1"]').click();
    const drawer = page.locator(".board-drawer");
    await expect(drawer.getByText("Reviewed revision", { exact: true }), `${width}: revision label`).toHaveCount(2);
    await expect(drawer.getByText(treeA, { exact: true }).first(), `${width}: complete source revision`).toBeVisible();
    await expect(drawer.getByText("spec · passed", { exact: true }), `${width}: gate result`).toBeVisible();
    await expect(drawer.locator('.board-drawer__waiting-evidence[href="ci/W-1-spec-1.log"]'), `${width}: decision record`).toBeVisible();
    await expect(drawer.locator(".board-drawer__record-body"), `${width}: absent description fallback remains`).toHaveText("No record body.");
    const geometry = await drawer.locator(".board-drawer__evidence-binding").first().evaluate((node) => {
      const drawerBox = node.closest<HTMLElement>(".board-drawer")!.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return { inside: box.left >= drawerBox.left && box.right <= drawerBox.right + 0.5, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(geometry, `${width}: binding is contained`).toEqual({ inside: true, pageOverflow: 0 });
    await drawer.locator(".board-drawer__close").click();
  }
});

test("W-412-b2 stale linked verdict is refused before POST at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w412-b2");
  let opera = [boundOpus()];
  let posts = 0;
  await install(page, () => opera);
  await page.route("**/api/answer", (route) => { posts += 1; return route.fulfill({ json: { ok: true, output: "recorded" } }); });
  await page.addInitScript((token) => sessionStorage.setItem("bisellium.token", token), served.token);
  for (const width of WIDTHS) {
    opera = [boundOpus(treeA)];
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w412=b2-${width}#/inbox`);
    const item = page.locator(".inbox__item").first();
    await item.waitFor();
    if (width < 840) await item.click();
    await expect(page.locator(".inbox__decision-evidence dt", { hasText: /^Reviewed revision$/ }), `${width}: the decision repeats explicit binding labels`).toHaveCount(2);
    await expect(page.getByLabel("Decision evidence").getByText(treeA, { exact: true }).first(), `${width}: the decision screen shows the revision it binds`).toBeVisible();
    await expect(page.getByLabel("Decision evidence").getByText("Patron call", { exact: true }), `${width}: the Inbox heads the binding by its declared label`).toBeVisible();
    await expect(page.getByLabel("Decision evidence").locator('a[href="decisions/D-412.md"]'), `${width}: the Inbox decision record is a link`).toBeVisible();
    await page.locator(".inbox__input-ratio").fill("The shown evidence supports this verdict.");
    opera = width === 390 ? [] : [boundOpus(treeB)];
    const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/opera"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    const staleMarker = width === 390
      ? "The linked Board item is no longer available."
      : "Evidence changed since it was shown.";
    await expect(page.locator(".inbox__evidence-stale"), `${width}: focus refresh marks the pinned decision stale`).toHaveText(staleMarker);
    await expect(page.getByLabel("Decision evidence").getByText(treeA, { exact: true }).first(), `${width}: refresh keeps the first-display revision`).toBeVisible();
    await expect(page.getByLabel("Decision evidence").getByText(treeB, { exact: true }), `${width}: refresh never replaces the pinned revision`).toHaveCount(0);
    if (width === 390) await expect(page.getByRole("button", { name: "Open Board actions" }), "390: the lost Board action is unavailable").toHaveCount(0);
    await page.getByRole("button", { name: /approve$/ }).click();
    const refusal = width === 390
      ? "The linked Board item is no longer available for this decision. Verdict not submitted. Your draft is kept."
      : "Evidence changed since it was shown. Review the current Board evidence before deciding.";
    await expect(page.locator(".inbox__error"), `${width}: refusal names whether current Board evidence is available`).toHaveText(refusal);
    expect(posts, `${width}: no stale verdict reaches POST /api/answer`).toBe(0);
    expect(await page.locator(".inbox__input-ratio").inputValue(), `${width}: the reason draft survives refusal`).toBe("The shown evidence supports this verdict.");
  }
});
