/**
 * apps/web/tests-serve/states.spec.ts — W-341 (D-088 F, D-090 B and C). The states matrix, served: every served
 * cell of `STATES_MATRIX` on its route at desktop and phone width, through the shared harness (a real
 * `bisellium serve` over a temp copy of examples/sample-studio). Each row asserts what the screen shows, the shell's
 * one live region (role, aria-live, data-state and text), and an axe scan of the page in that state.
 *
 * Reads and writes are steered with `page.route` so each state is reached deterministically; the Board's stale
 * state is the real thing (the server is stopped under a connected Board).
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { servedCells, type Screen, type ScreenState } from "../src/lib/screenState.js";
import { PHONE_UNREACHABLE } from "./states-policy.js";
import { startServed, type ServedInstance } from "./harness.js";

const VIEWPORTS = [1280, 390] as const;

let served: ServedInstance | undefined;
test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

/** A held request: the route waits until `release` is called. */
function hold(page: Page, pattern: string): { release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((r) => (release = r));
  void page.route(pattern, async (route: Route) => {
    await gate;
    await route.continue().catch(() => undefined);
  });
  return { release: () => release() };
}

async function fail(page: Page, pattern: string): Promise<void> {
  await page.route(pattern, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
}

async function json(page: Page, pattern: string, body: unknown): Promise<void> {
  await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
}

async function signIn(page: Page, screen: Screen): Promise<void> {
  await page.goto(`${served!.baseURL}/#/${screen}`);
  await page.locator("#token-prompt-input").fill(served!.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
}

const REFUSAL = { ok: false, exitCode: 1, output: "refused by the W-341 row" };

async function answerFirst(page: Page): Promise<void> {
  await expect(page.locator(".inbox__row").first()).toBeVisible();
  await page.locator(".inbox__input-ratio").fill("a reason for the record");
  await page.locator(".inbox__btn-action").first().click();
}

async function draftSeat(page: Page): Promise<void> {
  await page.locator('select[aria-label="model for seat builder"]').selectOption("claude-opus-5");
  await page.locator(".seats__confirm-btn").click();
}

/** One driver per served cell: steer the page into the state and assert what the screen shows. Returns a teardown. */
type Driver = (page: Page) => Promise<(() => void) | void>;

const DRIVERS: Record<string, Driver> = {
  "inbox:loading": async (page) => {
    const held = hold(page, "**/api/inbox");
    await signIn(page, "inbox");
    await expect(page.locator(".inbox__empty")).toHaveText("Loading the inbox…");
    return held.release;
  },
  "inbox:empty": async (page) => {
    await json(page, "**/api/inbox", { opera: [], petitiones: [] });
    await signIn(page, "inbox");
    await expect(page.locator(".inbox__empty")).toHaveText("Nothing waiting on you");
  },
  "inbox:error": async (page) => {
    await fail(page, "**/api/inbox");
    await signIn(page, "inbox");
    await expect(page.locator(".inbox__empty")).toHaveText("Could not load the inbox.");
    await expect(page.locator(".inbox__row")).toHaveCount(0);
  },
  "inbox:refused": async (page) => {
    await json(page, "**/api/answer", REFUSAL);
    await signIn(page, "inbox");
    await answerFirst(page);
    await expect(page.locator(".inbox__error")).toHaveText(REFUSAL.output);
  },
  "inbox:pending": async (page) => {
    const held = hold(page, "**/api/answer");
    await signIn(page, "inbox");
    await answerFirst(page);
    await expect(page.locator(".inbox__decision-panel .screen-notice")).toHaveText("Sending your answer…");
    return held.release;
  },
  "board:loading": async (page) => {
    const held = hold(page, "**/api/opera");
    await signIn(page, "board");
    await expect(page.locator(".board__notice")).toHaveText("Loading the board…");
    return held.release;
  },
  "board:empty": async (page) => {
    await json(page, "**/api/opera", []);
    await signIn(page, "board");
    await expect(page.locator(".board__notice")).toHaveText("No work items yet.");
    await expect(page.locator("[data-card-id]")).toHaveCount(0);
  },
  "board:error": async (page) => {
    await fail(page, "**/api/opera");
    await signIn(page, "board");
    await expect(page.locator(".board__notice")).toHaveText("Could not load the board.");
  },
  "board:stale": async (page) => {
    await signIn(page, "board");
    await expect(page.locator('.shell__status[data-state="live"]')).toHaveText("Connected: the board updates live.");
    const liveness = page.locator(".board__header .board__liveness");
    await expect(liveness).toHaveText(/^live · updated \d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    const refreshedAt = (await liveness.textContent())!.replace(/^live · updated /, "");
    await served!.close();
    served = undefined;
    await expect(page.locator('.shell__status[data-state="stale"]')).toHaveText("Disconnected: the board may be out of date.");
    await expect(liveness).toHaveText(`stale · last updated ${refreshedAt}`);
  },
  "board:live": async (page) => {
    await signIn(page, "board");
    await expect(page.locator('.shell__status[data-state="live"]')).toHaveText("Connected: the board updates live.");
    await expect(page.locator(".board__header .board__liveness")).toHaveText(/^live · updated \d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    await expect(page.locator(".board__notice")).toHaveCount(0);
  },
  "seats:loading": async (page) => {
    const held = hold(page, "**/api/officina");
    await signIn(page, "seats");
    await expect(page.locator(".seats .screen-notice")).toHaveText("Loading the seats…");
    return held.release;
  },
  "seats:empty": async (page) => {
    await page.route("**/api/officina", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...body, sellae: [], munera: [] } });
    });
    await signIn(page, "seats");
    await expect(page.locator(".seats .screen-notice")).toHaveText("No seats are declared.");
  },
  "seats:error": async (page) => {
    await fail(page, "**/api/officina");
    await signIn(page, "seats");
    await expect(page.locator(".seats .screen-notice")).toHaveText("Could not load the seats.");
  },
  "seats:refused": async (page) => {
    await json(page, "**/api/delegate", REFUSAL);
    await signIn(page, "seats");
    await draftSeat(page);
    await expect(page.locator(".seats__confirm-error")).toHaveText(REFUSAL.output);
  },
  "seats:pending": async (page) => {
    const held = hold(page, "**/api/delegate");
    await signIn(page, "seats");
    await draftSeat(page);
    await expect(page.locator(".seats__confirm-btn")).toBeDisabled();
    return held.release;
  },
  "officina:loading": async (page) => {
    const held = hold(page, "**/api/health");
    await signIn(page, "officina");
    await expect(page.locator(".panel--engine .officina__loading")).toHaveText("Loading health…");
    return held.release;
  },
  "officina:empty": async (page) => {
    await json(page, "**/api/aerarium*", []);
    await json(page, "**/api/acta*", []);
    await json(page, "**/api/completion", { meter: null, estimate: null });
    await json(page, "**/api/health", { at: "2026-09-25T09:35:43.947Z", ok: true, blocks: 0, advisories: 0, findingsByRule: {}, autonomy: { paused: false }, lastTick: "2026-09-25T09:35:43.947Z", due: [] });
    await signIn(page, "officina");
    await expect(page.locator(".panel--engine")).toContainText("Nothing pending.");
    await expect(page.locator(".panel--completion")).toContainText("No milestone records");
  },
  "officina:error": async (page) => {
    await fail(page, "**/api/health");
    await signIn(page, "officina");
    await expect(page.locator(".panel--engine")).toContainText("Could not load health.");
  },
};

const cells = servedCells();
const missing = cells.map((c) => `${c.screen}:${c.state}`).filter((key) => !(key in DRIVERS));
const extra = Object.keys(DRIVERS).filter((key) => !cells.some((c) => `${c.screen}:${c.state}` === key));
if (missing.length > 0 || extra.length > 0) throw new Error(`states matrix and drivers differ: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`);

async function expectRegion(page: Page, state: ScreenState, copy: string): Promise<void> {
  await expect(page.locator('[aria-live], [role="status"]')).toHaveCount(1);
  const region = page.locator(".shell > .shell__status");
  await expect(region).toHaveAttribute("role", "status");
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(region).toHaveAttribute("data-state", state);
  if (state === "refused") await expect(region).toHaveText(`${copy} ${REFUSAL.output}`);
  else await expect(region).toHaveText(copy);
}

for (const width of VIEWPORTS) {
  for (const { screen, state, copy } of cells) {
    test(`W-341 ${screen} ${state} at ${width}: shown, announced and axe-clean`, async ({ page }) => {
      const unreachable = width === 390 ? PHONE_UNREACHABLE[`${screen}:${state}`] : undefined;
      test.skip(unreachable !== undefined, unreachable);
      await page.setViewportSize({ width, height: 900 });
      served = await startServed(`states-${screen}-${state}`);
      const teardown = await DRIVERS[`${screen}:${state}`]!(page);
      await expectRegion(page, state, copy);
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
      teardown?.();
    });
  }
}

test("W-341 the live region is one node across a state change, so the change is announced", async ({ page }) => {
  served = await startServed("states-region");
  const held = hold(page, "**/api/inbox");
  await signIn(page, "inbox");
  const region = page.locator(".shell > .shell__status");
  await expect(region).toHaveAttribute("data-state", "loading");
  await region.evaluate((el) => el.setAttribute("data-w341-mark", "same-node"));
  held.release();
  await expect(region).toHaveAttribute("data-state", "ready");
  await expect(region).toHaveText("");
  await expect(region).toHaveAttribute("data-w341-mark", "same-node");
  const box = await region.boundingBox();
  expect(box === null || (box.width <= 1 && box.height <= 1)).toBe(true);
});

// A write that fails (HTTP 500 -> postWrite's { kind: "error" }) is announced by the shell's one live region.
for (const width of VIEWPORTS) {
  test(`W-341 inbox write error at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    served = await startServed("states-inbox-write-error");
    await fail(page, "**/api/answer");
    await signIn(page, "inbox");
    await answerFirst(page);
    const region = page.locator(".shell > .shell__status");
    await expect(region).toHaveAttribute("data-state", "error");
    await expect(region).toHaveText("Could not send the answer.");
    await expect(page.locator(".inbox__error")).toHaveText("error submitting the answer");
  });
}

for (const width of VIEWPORTS) {
  test(`W-341 seats write error at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    served = await startServed("states-seats-write-error");
    await fail(page, "**/api/delegate");
    await signIn(page, "seats");
    await draftSeat(page);
    const region = page.locator(".shell > .shell__status");
    await expect(region).toHaveAttribute("data-state", "error");
    await expect(region).toHaveText("Could not record the change.");
    await expect(page.locator(".seats__confirm-error")).toHaveText("error submitting the change");
  });
}
