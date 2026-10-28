import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
const NOW = "2026-10-28T12:00:00.000Z";
type Budget = { collegium: string; period: string; allowance: { tokens: unknown }; burn: { tokens: unknown }; posture: string };
type Opus = { id: string; title: string; body: string; kind: string; collegium: string; sella: string; state: string; tokens: number; probationes: Record<string, { status: string }>; traditio: unknown };
type Fixtures = { budgets: Budget[]; opera: Opus[]; health: ReturnType<typeof health> };
let served: ServedInstance | undefined;
let openSequence = 0;

const health = () => ({ at: NOW, ok: true, blocks: 0, advisories: 0, findingsByRule: {} as Record<string, number>, autonomy: { paused: false }, lastTick: NOW, due: [] as { kind: string; id: string }[] });
const officina = { studio: "studio", patron: "patron", collegia: [], sellae: [], probationes: [{ id: "patron", kind: "human" }, { id: "ci", kind: "automated" }], wip_limit: 8, lifecycle: { id: "opus", states: [
  { id: "building", name: "Building", phase: "in_progress" }, { id: "review", name: "Review", phase: "awaiting_review" }, { id: "blocked", name: "Blocked", phase: "halted" }, { id: "planned", name: "Planned", phase: "planned" }, { id: "done", name: "Done", phase: "done" },
] } };
const opus = (id: string, state: string, probationes: Opus["probationes"] = {}): Opus => ({ id, title: `A plain title for ${id}`, body: "", kind: "ui", collegium: "engineering", sella: "builder", state, tokens: 0, probationes, traditio: undefined });
const budget = (collegium: string, spent: unknown, allowance: unknown, period = "2026-W44"): Budget => ({ collegium, period, allowance: { tokens: allowance }, burn: { tokens: spent }, posture: spent === 650 ? "closeout" : "conserve" });
const base = (): Fixtures => ({ budgets: [], opera: [], health: health() });

async function routes(page: Page, fixtures: Fixtures, counts?: Record<string, number>): Promise<void> {
  const hit = (key: string) => { if (counts) counts[key] = (counts[key] ?? 0) + 1; };
  await page.route("**/api/aerarium*", (route) => { hit("aerarium"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtures.budgets) }); });
  await page.route("**/api/health", (route) => { hit("health"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtures.health) }); });
  await page.route("**/api/officina", (route) => { hit("officina"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(officina) }); });
  await page.route("**/api/opera*", (route) => { hit("opera"); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixtures.opera) }); });
}

async function open(page: Page, width: (typeof WIDTHS)[number], path = "#/officina"): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  openSequence += 1;
  await page.goto(`${served!.baseURL}/?w408=${openSequence}${path}`);
  const prompt = page.locator(".token-prompt");
  if (await prompt.isVisible()) { await page.locator("#token-prompt-input").fill(served!.token); await page.locator(".token-prompt__submit").click(); }
  await expect(page.locator(".officina__panel-heading")).toHaveCount(3);
  await expect(page.locator(".officina__loading")).toHaveCount(0);
}

test.beforeEach(async () => { served = await startServed("w408-detail", { now: NOW }); });
test.afterEach(async () => { await served?.close(); served = undefined; });

test("W-408-b1 detail frame and sole scrollbar hold at 1280, 640 and 390", async ({ page }) => {
  const fixtures = base(); await routes(page, fixtures);
  for (const width of WIDTHS) {
    await open(page, width);
    await expect(page.locator(".officina")).toBeVisible();
    await expect(page.locator(".sidebar__link").first()).toHaveAttribute("href", "#/inbox");
    await expect(page.locator(".sidebar__link").last()).toHaveAttribute("href", "#/officina");
    await expect(page.locator(".sidebar__link").last()).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".officina__panel-heading")).toHaveText(["Work in flight", "Budget", "Health"]);
    await expect(page.locator(".panel--needs-you, .fasti-strip")).toHaveCount(0);
    await expect(page.locator(".shell__main")).toHaveCSS("overflow-y", "scroll");
    await expect(page.locator(".shell__main")).toHaveCSS("scrollbar-gutter", "stable");
    const nestedScrollers = await page.locator(".officina, .officina *").evaluateAll((nodes) => nodes.filter((node) => ["auto", "scroll"].includes(getComputedStyle(node).overflowY)).map((node) => (node as HTMLElement).className));
    expect(nestedScrollers).toEqual([]);
  }
});

test("W-408-b2 empty and populated detailed work-in-flight groups render each active opus once", async ({ page }) => {
  const fixtures = base(); await routes(page, fixtures);
  for (const width of WIDTHS) {
    fixtures.opera = [];
    await open(page, width);
    await expect(page.locator(".panel--work")).toContainText("Nothing in flight.");
    fixtures.opera = [opus("W-1", "building", { patron: { status: "pending" }, ci: { status: "passed" } }), opus("W-2", "review", { patron: { status: "passed" }, ci: { status: "passed" } }), opus("W-3", "building", { patron: { status: "passed" }, ci: { status: "pending" } }), opus("W-4", "blocked", { patron: { status: "failed" }, ci: { status: "passed" } }), opus("W-5", "done", { patron: { status: "passed" }, ci: { status: "passed" } })];
    await open(page, width);
    await expect(page.locator(".panel--work .officina__unit")).toHaveText("Active opera grouped by lifecycle phase; each row names who moves next.");
    for (const [group, ids] of [["review", ["W-2"]], ["building", ["W-1", "W-3"]], ["blocked", ["W-4"]]] as const) await expect(page.locator(`[data-group="${group}"] .officina__work-row`)).toHaveText(ids.map((id) => new RegExp(id)));
    await expect(page.locator('[data-group="patron"]')).toHaveCount(0);
    await expect(page.locator(".officina__work-row")).toHaveCount(4);
    await expect(page.locator(".panel--work")).not.toContainText("W-5");
    await expect(page.locator('[data-group="building"] .officina__work-note')).toHaveText(["patron pending", "ci pending"]);
    await expect(page.locator('[data-group="review"] .officina__work-note')).toHaveText("builder next");
    await expect(page.locator('[data-group="blocked"] .officina__work-note')).toHaveText("builder next");
    const groups = await page.locator(".officina__work-group").all();
    const boxes = await Promise.all(groups.map((group) => group.boundingBox()));
    for (let i = 1; i < boxes.length; i += 1) { expect(boxes[i]!.x).toBeCloseTo(boxes[0]!.x, 0); expect(boxes[i]!.width).toBeCloseTo(boxes[0]!.width, 0); expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y); }
    for (const row of await page.locator(".officina__work-row").all()) { await expect(row).toHaveCSS("display", "grid"); await expect(row.locator(".officina__value-mono")).toHaveCSS("white-space", "nowrap"); await expect(row.locator("span").nth(1)).toHaveCSS("text-align", "left"); await expect(row).not.toContainText(/^(building|review|blocked)$/i); }
  }
});

test("W-408-b3 Budget pies normal, approaching, spent and over allowance retain palette, shapes, numerals, overage and posture at every width", async ({ page }) => {
  const fixtures = base(); fixtures.budgets = [budget("engineering", 1_880_000, 3_000_000, "2026-W44, including delegated review and correction work carried into this period"), budget("design", 80_000, 100_000), budget("qa", 100_000, 100_000), budget("production", 650_000, 500_000)]; await routes(page, fixtures);
  for (const width of WIDTHS) {
    await open(page, width);
    await expect(page.locator(".panel--budget .officina__unit")).toHaveText("Current token budget by collegium.");
    const rows = page.locator(".officina__budget-row");
    await expect(rows.nth(0).locator(".officina__posture-reason")).toHaveCSS("font-size", "13px");
    expect((await rows.nth(0).locator(".officina__posture-reason").boundingBox())!.height).toBeGreaterThan(18);
    await expect(rows).toHaveCount(4);
    await expect(rows.locator(".budget-meter__pie")).toHaveCount(4);
    expect(await rows.locator(".budget-meter__pie").evaluateAll((pies) => pies.map((pie) => getComputedStyle(pie).getPropertyValue("--budget-fraction").trim()))).toEqual(["0.6266666666666667turn", "0.8turn", "1turn", "1turn"]);
    expect(await rows.locator(".budget-meter__pie").evaluateAll((pies) => pies.map((pie) => getComputedStyle(pie).backgroundImage))).toEqual([
      expect.stringContaining("rgb(158, 164, 196)"), expect.stringContaining("rgb(255, 184, 108)"), expect.stringContaining("rgb(255, 184, 108)"), expect.stringContaining("rgb(255, 85, 85)"),
    ]);
    await expect(rows.nth(0).locator(".budget-meter__numerals")).toHaveAttribute("aria-label", "within allowance: 1,880,000 tokens spent of 3,000,000 allowance");
    await expect(rows.nth(3).locator(".budget-meter__over")).toHaveText("+150,000 over");
    await expect(rows.nth(0).locator("[data-budget-state=normal]")).toHaveClass(/severity-cue--normal/);
    await expect(rows.nth(1).locator("[data-budget-state=approaching]")).toHaveClass(/severity-cue--high/);
    await expect(rows.nth(2).locator("[data-budget-state=spent]")).toHaveClass(/severity-cue--high/);
    await expect(rows.nth(3).locator("[data-budget-state=over]")).toHaveClass(/severity-cue--blocking/);
    await expect(rows.nth(0).locator(".budget-meter__spent")).toHaveCSS("font-family", /IBM Plex Mono/);
    await expect(rows.nth(3).locator(".budget-meter__spent")).toHaveCSS("font-weight", "700");
    await expect(rows.locator(".budget-meter__pie").first()).toHaveAttribute("aria-hidden", "true");
    if (width === 640 || width === 390) {
      const bounds = await rows.nth(0).locator(".budget-meter__numerals").evaluate((node) => {
        const textRect = (selector: string) => { const element = node.querySelector(selector)!; const range = document.createRange(); range.selectNodeContents(element); const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right }; };
        const container = node.getBoundingClientRect();
        return { container: { left: container.left, right: container.right }, spent: textRect(".budget-meter__spent"), slash: textRect(".budget-meter__separator"), allowance: textRect(".budget-meter__allowance") };
      });
      expect(bounds.spent.left).toBeGreaterThanOrEqual(bounds.container.left);
      expect(bounds.spent.right + 6).toBeLessThanOrEqual(bounds.slash.left);
      expect(bounds.slash.right + 6).toBeLessThanOrEqual(bounds.allowance.left);
      expect(bounds.allowance.right).toBeLessThanOrEqual(bounds.container.right);
    }
  }
});

test("W-408-b4 health detail discloses its rows and brake without stamps", async ({ page }) => {
  const fixtures = base(); fixtures.health = { ...health(), ok: false, blocks: 1, advisories: 2, findingsByRule: { "traditio.stage": 2 }, due: [{ kind: "daily", id: "producer" }] }; await routes(page, fixtures);
  await page.route("**/api/pause", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, output: "paused" }) }));
  for (const width of WIDTHS) {
    await open(page, width);
    await expect(page.locator(".panel--health .officina__unit")).toHaveText("Current lex and process detail.");
    await expect(page.locator(".officina__health-row > summary")).toHaveCount(2);
    for (const summary of await page.locator(".officina__health-row > summary").all()) { await expect(summary).toHaveCSS("font-size", "13px"); await expect(summary).toHaveCSS("font-weight", "400"); expect(await summary.evaluate((node) => getComputedStyle(node, "::before").content)).toContain("▸"); }
    await expect(page.locator(".officina")).not.toContainText(/as of|Last tick|updated/i);
    await expect(page.locator(".officina__severity-summary").first()).toContainText("1 blocking");
    await expect(page.locator(".officina__severity-summary").first()).toContainText("2 high");
    await expect(page.locator(".severity-cue--blocking").first()).toHaveCSS("background-color", "rgb(255, 85, 85)");
    await expect(page.locator(".severity-cue--high").first()).toHaveCSS("background-color", "rgb(255, 184, 108)");
    await expect(page.locator(".severity-cue--low").first()).toHaveCSS("background-color", "rgb(98, 114, 164)");
    await expect(page.locator(".severity-cue--normal")).toHaveCount(0);
    await expect(page.locator(".panel--lex .officina__health-copy").last()).toHaveText("Severity is available only in aggregate.");
    await expect(page.locator(".panel--lex .officina__rule-family")).toHaveCount(1);
    await expect(page.locator(".panel--lex .officina__rule-family .severity-cue")).toHaveCount(0);
    await page.locator(".panel--lex > summary").focus(); await page.keyboard.press("Enter"); await expect(page.locator(".panel--lex")).toHaveAttribute("open", ""); expect(await page.locator(".panel--lex > summary").evaluate((node) => getComputedStyle(node, "::before").content)).toContain("▾");
    await page.locator(".panel--process > summary").focus(); await page.keyboard.press("Enter"); await expect(page.locator(".panel--process")).toHaveAttribute("open", ""); expect(await page.locator(".panel--process > summary").evaluate((node) => getComputedStyle(node, "::before").content)).toContain("▾"); await expect(page.locator(".officina__brake-explanation")).toHaveText("New pieces of work do not start; work already running carries on."); const brake = page.locator(".panel--process .officina__brake"); await expect(brake).toHaveText("Stop new work"); await expect(brake).toBeVisible(); await brake.focus(); await expect(brake).toBeFocused();
    const colors = await brake.evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderTopColor })); expect(colors.background).toBe(colors.border);
    await brake.click(); await expect(brake).toHaveText("Resume new work");
  }
});

test("W-408-b5 visible interval and focus refresh detail reads without a reload", async ({ page }) => {
  const fixtures = base(); fixtures.opera = [opus("W-1", "building")]; const counts: Record<string, number> = {};
  await page.addInitScript(() => { const native = window.setInterval; window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => native(fn, ms === 30_000 ? 40 : ms, ...args)) as typeof window.setInterval; });
  await routes(page, fixtures, counts); await open(page, 390);
  await expect.poll(() => counts.opera ?? 0).toBeGreaterThan(1);
  const before = counts.opera ?? 0; fixtures.opera = [{ ...fixtures.opera[0]!, title: "Refreshed Officina detail" }];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => counts.opera ?? 0).toBeGreaterThan(before);
  await expect(page.locator(".officina__work-row")).toContainText("Refreshed Officina detail");
  expect(counts.inbox).toBeUndefined();
});
