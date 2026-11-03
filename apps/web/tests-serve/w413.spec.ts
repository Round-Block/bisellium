import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
const NOW = new Date("2026-11-02T12:00:00Z");
let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

const officina = {
  studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], wip_limit: 3,
  probationes: [{ id: "tests", name: "Tests", kind: "automated" }],
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
const makeOpus = (id: string, state: string, startHours: number | undefined, blocked = false, endHours?: number) => ({
  id, title: `${id} policy card`, body: `${id} body`, kind: "ui", collegium: "design", sella: "builder", state, tokens: 0,
  ...(startHours === undefined ? {} : { start: new Date(NOW.getTime() - startHours * 3_600_000).toISOString() }),
  ...(endHours === undefined ? {} : { end: new Date(NOW.getTime() - endHours * 3_600_000).toISOString() }),
  probationes: blocked ? { tests: { status: "failed" } } : {},
  traditio: undefined,
});
const opera = [
  makeOpus("W-1", "greenlit", 6),
  makeOpus("W-2", "building", 9),
  makeOpus("W-3", "building", 1, true),
  makeOpus("W-4", "building", 3),
  makeOpus("W-5", "building", undefined),
  makeOpus("W-6", "review", 24),
  makeOpus("W-7", "done", 12, false, 4),
  makeOpus("W-8", "halted", 4, true),
  makeOpus("W-9", "verifying", 2),
  makeOpus("W-10", "done", 10, false, 4),
  makeOpus("W-11", "done", 14, false, 4),
];

async function install(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: { opera: [], petitiones: [] } }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: [] }));
}

async function openBoard(page: Page, width: number, row: string): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served!.baseURL}/?w413=${row}-${width}#/board`);
  const prompt = page.locator("#token-prompt-input");
  if (await prompt.isVisible()) {
    await prompt.fill(served!.token);
    await page.locator(".token-prompt__submit").click();
  }
  await expect(page.locator(".board__column")).toHaveCount(6);
}

test("W-413-b1 total and blocked counts use two plain rows at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b1");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b1");
    const active = page.locator('.board__column[data-column-id="in_progress"]');
    await expect(active.locator(".board__column-count"), `${width}: the first row is the column total`).toHaveText("4 tasks");
    await expect(active.locator(".board__column-blocked"), `${width}: the second row is the column blocked count`).toHaveText("1 blocked");
    await expect(page.locator('[data-column-id="verifying"] .board__column-count'), `${width}: another column keeps its own total`).toHaveText("1 task");
    await expect(page.locator('[data-column-id="verifying"] .board__column-blocked'), `${width}: zero uses plain blocked copy`).toHaveText("None blocked");
    await expect(page.locator('[data-column-id="done"] .board__column-count'), `${width}: plural totals stay plain`).toHaveText("3 tasks");
    await expect(page.locator('[data-column-id="done"] .board__column-blocked'), `${width}: zero blocked stays on its own row`).toHaveText("None blocked");
    await expect(page.locator(".board__wip-scope, .board__wip-count, .board__wip-rule"), `${width}: no Board limit surface remains`).toHaveCount(0);
    const colours = await page.locator('[data-card-id="W-3"]').evaluate((card) => ({
      marker: getComputedStyle(card).borderLeftColor,
      blockedText: getComputedStyle(document.querySelector<HTMLElement>('[data-column-id="in_progress"] .board__column-blocked')!).color,
      zeroBlockedText: getComputedStyle(document.querySelector<HTMLElement>('[data-column-id="verifying"] .board__column-blocked')!).color,
      blockingTextToken: (() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--severity-blocking-text)";
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      })(),
    }));
    expect(colours.marker, `${width}: blocked card line uses the blocking-severity token`).toBe("rgb(255, 85, 85)");
    expect(colours.blockedText, `${width}: a positive blocked header count uses the red text-safe blocking token`).toBe(colours.blockingTextToken);
    expect(colours.blockedText, `${width}: a positive blocked header count is visibly different from neutral text`).not.toBe(colours.zeroBlockedText);
    expect(colours.zeroBlockedText, `${width}: None blocked stays neutral`).toBe("rgb(158, 164, 196)");
  }
});

test("W-413-b2 card elapsed, actual completion and estimate stay legible at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b2");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b2");
    await expect(page.locator('[data-card-id="W-3"] .board__card-timing'), `${width}: an open card states elapsed and estimated time in full words`).toHaveText("Started 1 hour ago. About 7 hours left (estimate).");
    await expect(page.locator('[data-card-id="W-2"] .board__card-timing'), `${width}: an overdue open card does not promise another hour`).toHaveText("Started 9 hours ago. Taking longer than usual (estimate)");
    await expect(page.locator('[data-card-id="W-6"] .board__card-timing'), `${width}: another overdue phase uses the same honest estimate`).toHaveText("Started 1 day ago. Taking longer than usual (estimate)");
    await expect(page.locator('[data-card-id="W-8"] .board__card-timing'), `${width}: a Halted card never receives an estimate`).toHaveText("Stopped; no completion estimate");
    await expect(page.locator('[data-card-id="W-5"] .board__card-timing'), `${width}: an unknown start gets an honest no-estimate sentence`).toHaveText("No time estimate yet");
    await expect(page.locator('[data-card-id="W-7"] .board__card-timing'), `${width}: a done card plainly states its completion span`).toHaveText("Took 8 hours");
    await expect(page.locator(".board__column-dwell"), `${width}: no column header retains median dwell`).toHaveCount(0);
  }
});

test("W-413-b3 entry and exit rules stay legible at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b3");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b3");
    await expect(page.locator('[data-column-id="planned"] .board__column-policy')).toHaveText("Waiting to start. Moves on when approved and ready to build.");
    await expect(page.locator('[data-column-id="in_progress"] .board__column-policy')).toHaveText("Being built. Moves on when the build is complete.");
    await expect(page.locator('[data-column-id="verifying"] .board__column-policy')).toHaveText("Being checked. Moves on when checks pass.");
    await expect(page.locator('[data-column-id="awaiting_review"] .board__column-policy')).toHaveText("Waiting for review. Finished when approved.");
    await expect(page.locator('[data-column-id="done"] .board__column-policy')).toHaveText("Complete. No next step.");
    await expect(page.locator('[data-column-id="halted"] .board__column-policy')).toHaveText("Stopped. Resumes when the blocking condition is resolved.");
    const clipped = await page.locator(".board__column-policy, .board__column-counts").evaluateAll((nodes) => nodes.some((node) => node.scrollWidth > node.clientWidth + 0.5));
    expect(clipped, `${width}: plain policy copy wraps instead of clipping`).toBe(false);
    const headerHeight = await page.locator('.board__column[data-column-id="in_progress"]').evaluate((node) => {
      const top = node.querySelector<HTMLElement>(".board__column-head")!.getBoundingClientRect().top;
      const cards = node.querySelector<HTMLElement>(".board__column-cards")!.getBoundingClientRect().top;
      return cards - top;
    });
    expect(headerHeight, `${width}: the longer plain-English policy block stays bounded`).toBeLessThanOrEqual(150);
  }
});

test("W-413-b4 filtered cards stay counted against totals at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b4");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b4");
    await page.getByLabel("Choose which tasks to show").selectOption("blocked");
    await expect(page.locator('[data-column-id="planned"] .board__column-count'), `${width}: filter hides all`).toHaveText("Showing 0 of 1 task");
    await expect(page.locator('[data-column-id="in_progress"] .board__column-count'), `${width}: filter hides some`).toHaveText("Showing 1 of 4 tasks");
    await expect(page.locator('[data-column-id="halted"] .board__column-count'), `${width}: filter hides none`).toHaveText("1 task");
    await expect(page.locator('[data-column-id="in_progress"] .board__column-blocked'), `${width}: filtering keeps the column blocked total`).toHaveText("1 blocked");
    await expect(page.locator('[data-column-id="verifying"] .board__column-blocked'), `${width}: another column keeps its zero blocked total`).toHaveText("None blocked");
    await expect(page.locator('[data-column-id="in_progress"] .board__card')).toHaveCount(1);
    await page.getByLabel("Choose which tasks to show").selectOption("all");
    await expect(page.locator('[data-column-id="in_progress"] .board__card')).toHaveCount(4);
    await page.locator('[data-card-id="W-3"]').click();
    await expect(page.getByRole("dialog", { name: "W-3 policy card" }), `${width}: policy headers do not break the existing drawer`).toBeVisible();
    await page.getByRole("button", { name: "close" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: policy and filter add no page overflow`).toBeLessThanOrEqual(0);
  }
});
