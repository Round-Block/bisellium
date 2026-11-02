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
const makeOpus = (id: string, state: string, hours: number | undefined, blocked = false) => ({
  id, title: `${id} policy card`, body: `${id} body`, kind: "ui", collegium: "design", sella: "builder", state, tokens: 0,
  probationes: blocked ? { tests: { status: "failed" } } : {},
  traditio: hours === undefined ? undefined : { sella: "builder", stage: state, blocked_on: "none", at: new Date(NOW.getTime() - hours * 3_600_000).toISOString() },
});
const opera = [
  makeOpus("W-1", "greenlit", 6),
  makeOpus("W-2", "building", 9),
  makeOpus("W-3", "building", 1, true),
  makeOpus("W-4", "building", 3),
  makeOpus("W-5", "building", undefined),
  makeOpus("W-6", "review", 24),
  makeOpus("W-7", "done", 48),
  makeOpus("W-8", "halted", 4, true),
  makeOpus("W-9", "verifying", 2),
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

test("W-413-b1 total WIP, cap and blocked contribution stay legible at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b1");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b1");
    const scopeKey = page.locator(".board__wip-scope");
    await expect(scopeKey, `${width}: shared WIP scope key is visible`).toBeVisible();
    await expect(scopeKey, `${width}: shared WIP scope key names states and blocked inclusion`).toHaveText("Shared WIP = Building + Verifying; blocked work included");
    const active = page.locator('.board__column[data-column-id="in_progress"]');
    await expect(active.locator(".board__column-count"), `${width}: the Building-column count stays local`).toHaveText("4 shown");
    await expect(active.locator(".board__wip-count"), `${width}: check-compatible shared numerator spans building and verifying`).toHaveText("Shared WIP 5 / 3 · 1 blocked");
    await expect(page.locator('[data-column-id="verifying"] .board__column-count'), `${width}: the Verifying-column count stays local`).toHaveText("1 shown");
    await expect(page.locator('[data-column-id="verifying"] .board__wip-count'), `${width}: every WIP column names and repeats the same shared policy`).toHaveText("Shared WIP 5 / 3 · 1 blocked");
    await expect(page.locator('[data-column-id="done"] .board__wip-count'), `${width}: non-WIP policy uses singular item copy`).toHaveText("1 item · 0 blocked");
    const policy = await active.evaluate((node) => {
      const count = node.querySelector<HTMLElement>(".board__wip-count")!;
      const fill = node.querySelector<HTMLElement>(".board__wip-fill")!;
      const rule = node.querySelector<HTMLElement>(".board__wip-rule")!;
      return { weight: getComputedStyle(count).fontWeight, fill: fill.getBoundingClientRect().width, rule: rule.getBoundingClientRect().width, colour: getComputedStyle(fill).backgroundColor };
    });
    expect(Number(policy.weight), `${width}: at/over cap count is bold`).toBeGreaterThanOrEqual(700);
    expect(policy.fill, `${width}: over-cap rule is full`).toBeCloseTo(policy.rule, 0);
    expect(policy.colour, `${width}: WIP never reuses amber`).not.toBe("rgb(255, 184, 108)");
  }
});

test("W-413-b2 median dwell stays honest at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b2");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b2");
    await expect(page.locator('[data-column-id="in_progress"] .board__column-dwell'), `${width}: three recorded samples have a three-hour median`).toHaveText("median 3h");
    await expect(page.locator('[data-column-id="in_progress"] .board__column-dwell'), `${width}: the sample denominator is available`).toHaveAttribute("title", "Median dwell from 3 of 4 recorded current-state handoffs");
    await expect(page.locator('[data-column-id="verifying"] .board__column-dwell'), `${width}: a verifying handoff has an honest dwell`).toHaveText("median 2h");
    await expect(page.locator('[data-column-id="done"] .board__column-dwell'), `${width}: Done omits meaningless dwell`).toHaveCount(0);
    await expect(page.locator('[data-column-id="halted"] .board__column-dwell'), `${width}: Halted omits meaningless dwell`).toHaveCount(0);
  }
});

test("W-413-b3 entry and exit rules stay legible at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b3");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b3");
    await expect(page.locator('[data-column-id="planned"] .board__column-policy')).toHaveText("Backlog + Greenlit; approval + readiness before building");
    await expect(page.locator('[data-column-id="in_progress"] .board__column-policy')).toHaveText("Building; build complete before verification");
    await expect(page.locator('[data-column-id="verifying"] .board__column-policy')).toHaveText("Verifying; passing checks before review");
    await expect(page.locator('[data-column-id="awaiting_review"] .board__column-policy')).toHaveText("Awaiting review; approval completes work");
    await expect(page.locator('[data-column-id="done"] .board__column-policy')).toHaveText("Complete; no forward exit");
    await expect(page.locator('[data-column-id="halted"] .board__column-policy')).toHaveText("Stopped; resume when condition is met");
    const clipped = await page.locator(".board__column-policy").evaluateAll((nodes) => nodes.some((node) => node.scrollWidth > node.clientWidth + 0.5));
    expect(clipped, `${width}: ruled entry/exit copy is visible rather than clipped`).toBe(false);
    const headerHeight = await page.locator('.board__column[data-column-id="in_progress"]').evaluate((node) => {
      const top = node.querySelector<HTMLElement>(".board__column-head")!.getBoundingClientRect().top;
      const cards = node.querySelector<HTMLElement>(".board__column-cards")!.getBoundingClientRect().top;
      return cards - top;
    });
    expect(headerHeight, `${width}: name/count, rule and metrics stay a compact three-line header`).toBeLessThanOrEqual(82);
  }
});

test("W-413-b4 filtered cards stay counted against totals at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w413-b4");
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b4");
    await page.getByLabel("Filter Board work").selectOption("blocked");
    await expect(page.locator('[data-column-id="planned"] .board__column-count'), `${width}: filter hides all`).toHaveText("0 of 1 shown");
    await expect(page.locator('[data-column-id="in_progress"] .board__column-count'), `${width}: filter hides some`).toHaveText("1 of 4 shown");
    await expect(page.locator('[data-column-id="halted"] .board__column-count'), `${width}: filter hides none`).toHaveText("1 shown");
    await expect(page.locator('[data-column-id="in_progress"] .board__wip-count'), `${width}: named shared numerator survives filtering`).toHaveText("Shared WIP 5 / 3 · 1 blocked");
    await expect(page.locator('[data-column-id="verifying"] .board__wip-count'), `${width}: hidden verifying card still consumes named shared WIP`).toHaveText("Shared WIP 5 / 3 · 1 blocked");
    await expect(page.locator('[data-column-id="in_progress"] .board__card')).toHaveCount(1);
    await page.getByLabel("Filter Board work").selectOption("all");
    await expect(page.locator('[data-column-id="in_progress"] .board__card')).toHaveCount(4);
    await page.locator('[data-card-id="W-3"]').click();
    await expect(page.getByRole("dialog", { name: "W-3 policy card" }), `${width}: policy headers do not break the existing drawer`).toBeVisible();
    if (width === 640) await expect(page.locator(".board__wip-scope"), "640: the scope key is suppressed beside the open drawer's narrow Board rail").toBeHidden();
    await page.getByRole("button", { name: "close" }).click();
    if (width === 640) await expect(page.locator(".board__wip-scope"), "640: closing the drawer restores the complete scope key").toHaveText("Shared WIP = Building + Verifying; blocked work included");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: policy and filter add no page overflow`).toBeLessThanOrEqual(0);
  }
});
