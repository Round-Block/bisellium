import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_ENTRIES } from "../src/lib/nav.js";
import { BASELINE_BOOTSTRAP_REASON, baselineSetState } from "./baseline-set.js";
import { expectFontAssets, FONT_ASSETS } from "./font-assets.js";
import { REPO_ROOT, startServed, type ServedInstance } from "./harness.js";
import { expectRenderingEnvironment } from "./rendering-environment.js";

const FIXED_NOW = "2026-09-25T09:35:43.947Z";
const VIEWPORTS = [1280, 390] as const;
const STABLE_STUDIO_PATH = "/fixtures/w350";

let served: ServedInstance | undefined;
test.afterEach(async () => {
  await served?.close();
  served = undefined;
});
test.describe.configure({ retries: 0 });

async function signIn(page: Page, route: string): Promise<void> {
  await page.goto(`${served!.baseURL}/#/${route}`);
  if (await page.locator(".token-prompt").isVisible()) {
    await page.locator("#token-prompt-input").fill(served!.token);
    await page.locator(".token-prompt__submit").click();
  }
  await expect(page.locator(".token-prompt")).toBeHidden();
}

function prepareStudio(studioDir: string): void {
  const allowance = readFileSync(join(studioDir, "aerarium", "2026-W38.yml"), "utf8");
  writeFileSync(join(studioDir, "aerarium", "2026-W39.yml"), allowance.replace("period: 2026-W38", "period: 2026-W39"));
  writeFileSync(
    join(studioDir, "health.json"),
    JSON.stringify({
      at: FIXED_NOW,
      ok: false,
      blocks: 1,
      advisories: 3,
      findingsByRule: { "state.done.probationes": 1, "traditio.stale": 2, "traditio.stage": 1 },
      autonomy: { paused: false },
      lastTick: FIXED_NOW,
      due: [{ kind: "traditio", id: "W-002" }],
    }),
  );
  rmSync(join(studioDir, "acta"), { recursive: true, force: true });
  mkdirSync(join(studioDir, "acta"), { recursive: true });
  writeFileSync(
    join(studioDir, "acta", "2026-09-25-w350.md"),
    ["---", "author: producer", "kind: cascade", "title: W-350 fixed cascade", `at: ${FIXED_NOW}`, "evidence: []", "---", "Fixed screenshot fixture.", ""].join("\n"),
  );
}

async function stabilizeOfficinaPath(page: Page): Promise<void> {
  await page.route("**/api/officina", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, studio: STABLE_STUDIO_PATH } });
  });
}

async function expectLoadedState(page: Page, route: string, width: number): Promise<void> {
  if (route === "inbox") {
    const inbox = await page.request.get(`${served!.baseURL}/api/inbox`);
    const fixture = (await inbox.json()) as { petitiones: { id: string; opus: string }[] };
    expect(fixture.petitiones[0]).toMatchObject({ id: "A-1", opus: "W-004" });
    await expect(page.locator(".inbox__row").first()).toHaveAttribute("data-focused", "true");
    if (width === 1280) {
      await expect(page.locator(".inbox__detail-opus")).toHaveText("W-004");
      await expect(page.locator(".inbox__detail-content")).toContainText("Drag-and-drop grew a second screen");
      await expect(page.locator(".inbox__input-ratio")).toBeVisible();
      await expect(page.locator(".inbox__btn-action")).toHaveText([/approve/, /defer/, /decline/, /delegate/]);
    } else {
      await expect(page.locator(".inbox__list")).toBeVisible();
      await expect(page.locator(".inbox__detail")).toBeHidden();
    }
  } else if (route === "board") {
    await expect(page.locator("[data-column-id]")).toHaveCount(7);
    await expect.poll(() => page.locator("[data-card-id]").count()).toBeGreaterThan(0);
    await expect.poll(() => page.locator(".gate-ladder").count()).toBeGreaterThan(0);
    await expect(page.locator('[data-column-id="needs_you"]')).toBeInViewport();
    await expect(page.locator(".board__liveness")).toContainText(/connected|live/);
  } else if (route === "seats") {
    await expect.poll(() => page.locator('select[aria-label^="model for seat "]').count()).toBeGreaterThan(0);
    await expect(page.locator('select[aria-label="model for seat builder"]')).toHaveValue("claude-sonnet-5");
    await expect(page.locator(".seats__confirm-bar")).toHaveCount(0);
  } else {
    await expect(page.locator(".panel--completion")).toContainText("No milestone records");
    await expect(page.locator(".officina__collegium-name")).toHaveCount(4);
    await expect(page.locator(".officina__as-of")).toHaveCount(2);
    await expect(page.locator(".fasti-strip__tick--filled")).toHaveCount(1);
    await expect(page.locator(".panel--engine")).toContainText("W-002");
  }
}

async function settleInitialView(page: Page, width: number): Promise<void> {
  const loaded = await page.evaluate(async (assets) => {
    await document.fonts.ready;
    return Promise.all(assets.map(async ({ family, style, weight }) => (await document.fonts.load(`${style} ${weight} 16px "${family}"`)).length));
  }, FONT_ASSETS);
  expect(loaded, "every committed production font face and weight loads without fallback").toEqual(FONT_ASSETS.map(() => 1));
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".shell__main")?.scrollTo(0, 0);
    document.querySelector<HTMLElement>(".board__columns")?.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    getSelection()?.removeAllRanges();
  });
  await page.mouse.move(width - 1, 899);
}

test("the live screens match their fixed desktop and phone initial-view baselines", async ({ page }) => {
  const baselineRoot = join(REPO_ROOT, "apps", "web", "tests-serve", "screenshots.spec.ts-snapshots");
  const baselineState = baselineSetState(baselineRoot);
  const refreshing = process.env["BISELLIUM_UPDATE_SCREENSHOTS"] === "1";
  if (!refreshing && baselineState === "complete") expectRenderingEnvironment(join(baselineRoot, "rendering-environment.json"));
  expectFontAssets(join(REPO_ROOT, "apps", "web", "src", "assets", "fonts"));
  served = await startServed("screenshots", { now: FIXED_NOW, prepareStudio });
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await stabilizeOfficinaPath(page);

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    for (const entry of NAV_ENTRIES) {
      await signIn(page, entry.route);
      await expectLoadedState(page, entry.route, width);
      await settleInitialView(page, width);
      const mutant = process.env["BISELLIUM_SCREENSHOT_MUTANT"];
      if (mutant === "solid") await page.addStyleTag({ content: "body::after{content:'';position:fixed;left:0;top:0;width:1px;height:1px;background:#000;z-index:2147483647}" });
      if (mutant === "edge") await page.addStyleTag({ content: ".shell__main{transform:translateX(1px)}" });
      if (mutant === "font-weight") await page.addStyleTag({ content: ".inbox__title,.board__title,.seats__heading,.officina__title{font-weight:600!important}" });
      if (baselineState === "complete" || refreshing) {
        await expect(page).toHaveScreenshot(`${entry.route}-${width}.png`, {
          animations: "disabled",
          caret: "hide",
          fullPage: false,
        });
      }
    }
  }
  if (baselineState === "absent" && !refreshing) test.skip(true, BASELINE_BOOTSTRAP_REASON);
});
