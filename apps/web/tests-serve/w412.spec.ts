import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;
test.afterEach(async () => { await served?.close(); served = undefined; });

const treeA = `tree:${"a".repeat(40)}`;
const officina = {
  studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], wip_limit: 4,
  probationes: [
    { id: "spec", name: "Spec", kind: "agent" },
    { id: "review", name: "A deliberately long next-gate name that remains complete in the drawer", kind: "agent" },
    { id: "patron", name: "Patron call", kind: "human" },
  ],
  lifecycle: { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" }, { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" }, { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Awaiting review", phase: "awaiting_review" }, { id: "done", name: "Done", phase: "done" }, { id: "halted", name: "Halted", phase: "halted" },
  ] },
};
const boundOpus = () => ({ id: "W-1", title: `A deliberately long title ${"that remains readable ".repeat(12)}`, body: "", kind: "ui", collegium: "design", sella: "builder", state: "building", tokens: 0,
  probationes: { spec: { status: "passed", evidence: { certifies: treeA, href: "ci/W-1-spec-1.log" } }, patron: { status: "pending", evidence: { certifies: treeA, href: "decisions/D-412.md" } } },
  traditio: { blocked_on: "patron", next: "Decide", at: "2026-11-02T00:00:00Z" } });
const inbox = { opera: [{ id: "W-1", title: "Decision", collegium: "design", sella: "builder", traditio: undefined }], petitiones: [{ id: "P-1", opus: "W-1", from: "qa-lead", subject: "Decide", body: "Review the bound evidence." }] };

async function install(page: Page): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: [boundOpus()] }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/live*", (route) => route.fulfill({ contentType: "text/event-stream", body: "" }));
}

test("W-412-b1 drawer binds decision evidence at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w412-b1"); await install(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${served.baseURL}/?w412=b1-${width}#/board`); await page.locator('[data-card-id="W-1"]').click();
    const drawer = page.locator(".board-drawer");
    await expect(drawer.getByText("Reviewed revision", { exact: true }), `${width}: revision label`).toHaveCount(2);
    await expect(drawer.getByText(treeA, { exact: true }).first(), `${width}: complete source revision`).toBeVisible();
    await expect(drawer.getByText("spec · passed", { exact: true }), `${width}: gate result`).toBeVisible();
    await expect(drawer.locator('.board-drawer__waiting-evidence[href="ci/W-1-spec-1.log"]'), `${width}: decision record`).toBeVisible();
    await expect(drawer.locator(".board-drawer__record-body"), `${width}: absent description fallback remains`).toHaveText("No record body.");
    const geometry = await drawer.locator(".board-drawer__evidence-binding").first().evaluate((node) => { const d = node.closest<HTMLElement>(".board-drawer")!.getBoundingClientRect(); const b = node.getBoundingClientRect(); return { inside: b.left >= d.left && b.right <= d.right + 0.5, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    expect(geometry, `${width}: binding is contained`).toEqual({ inside: true, pageOverflow: 0 }); await drawer.locator(".board-drawer__close").click();
  }
});
