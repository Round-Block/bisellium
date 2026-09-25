/**
 * apps/web/tests-serve/board.spec.ts — W-064 behaviours 7-9: mounted,
 * against the built `apps/web/dist` served by a real `bisellium serve` on a
 * temp copy of `examples/sample-studio`, via W-067's `startServed`.
 *
 * NODE_ENV=test is set here (module scope, before any `startServed()` call)
 * because `child_process.spawn` inherits `process.env` by default and
 * `startServed` never passes an explicit `env` — this makes `/api/_poll`
 * (the test-only manual re-ingest hook, W-014/W-016, 404 outside
 * NODE_ENV=test) reachable. Using it does not weaken the transport-
 * dependence claim (note 3): it exercises the exact `ingestOnce()` path the
 * real `setInterval` poll uses, it just removes the wall-clock wait for that
 * timer to fire — the brief's "at least two configured poll intervals" is a
 * TIMEOUT BOUND on how long the change may take to appear, not a
 * requirement to wait out the literal timer (`harness.ts`, not owned by
 * this opus, has no `--poll-ms` override to speed the real one up).
 */
process.env["NODE_ENV"] = "test";

import { expect, test, type Page } from "@playwright/test";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGreenlight } from "@bisellium/commands/writes.js";
import { boardModel, type BoardModel } from "../src/lib/board.js";
import type { OfficinaResponse, OpusEntry } from "../src/api.js";
import { startServed, type ServedInstance } from "./harness.js";

const PROJECT_ID = "sample-studio";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const MAIN_TS = join(REPO_ROOT, "packages", "cli", "src", "main.ts");
const SAMPLE_STUDIO = join(REPO_ROOT, "examples", "sample-studio");

async function forcePoll(served: { baseURL: string }): Promise<void> {
  const res = await fetch(`${served.baseURL}/api/_poll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (res.status !== 200) throw new Error(`/api/_poll answered ${res.status} — is NODE_ENV=test reaching the spawned server?`);
}

/**
 * A `bisellium serve` instance this test can KILL and RESTART on the exact
 * same port and studio dir — `harness.ts` (not owned by this opus) has no
 * such capability, and there is no other reliable way in this environment to
 * sever an already-open `/api/live` connection: `browserContext.setOffline`
 * was measured (empirically, against a real served instance) to have NO
 * effect on an established loopback SSE stream — no `onError`/reconnect ever
 * fires, even held offline for 16s (spanning a heartbeat). Killing the
 * process is a real TCP reset the browser's `EventSource` genuinely notices
 * (confirmed: the liveness label flips to "disconnected" within one poll of
 * the kill, and to "live" again within ~1s of the restart) — this is what
 * actually exercises the reconnect path recorded in the brief's *Liveness*
 * section, rather than a no-op that happened to pass anyway.
 */
interface RestartableServed {
  port: number;
  token: string;
  studioDir: string;
  baseURL: string;
  kill: () => void;
  restart: () => Promise<void>;
  close: () => Promise<void>;
}

async function startRestartable(tag: string): Promise<RestartableServed> {
  const studioDir = mkdtempSync(join(tmpdir(), `bisellium-w064r-${tag}-`));
  cpSync(SAMPLE_STUDIO, studioDir, { recursive: true });

  let child: ChildProcessWithoutNullStreams;
  let port: number | undefined;
  let token: string | undefined;

  async function spawnAndWaitReady(fixedPort: number): Promise<void> {
    child = spawn(process.execPath, ["--import", "tsx", MAIN_TS, "serve", "--studio", studioDir, "--port", String(fixedPort)], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`bisellium serve never printed its port/token within 15s:\n${stdout}`)), 15_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        const portMatch = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
        const tokenMatch = /write-auth token \(X-Bisellium-Token\): (\S+)/.exec(stdout);
        if (portMatch) port = Number(portMatch[1]);
        if (tokenMatch) token = tokenMatch[1];
        if (port !== undefined && token !== undefined) {
          clearTimeout(timer);
          resolvePromise();
        }
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("exit", (code) => {
        if (port === undefined || token === undefined) {
          clearTimeout(timer);
          reject(new Error(`bisellium serve exited (${code}) before printing port/token:\n${stdout}`));
        }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      try {
        if ((await fetch(`${base}/api/officina`)).status === 200) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`served instance never became ready at ${base}`);
  }

  await spawnAndWaitReady(0);
  const fixedPort = port!;

  return {
    get port() {
      return fixedPort;
    },
    get token() {
      return token!;
    },
    studioDir,
    baseURL: `http://127.0.0.1:${fixedPort}`,
    kill: () => child.kill("SIGTERM"),
    restart: () => spawnAndWaitReady(fixedPort),
    close: async () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      rmSync(studioDir, { recursive: true, force: true });
    },
  };
}

/** A single non-GET-request counter, installed BEFORE `page.goto` and never
 *  removed — TARGET-9's mounted-lifetime requirement, spanning mount,
 *  reconciliation, SSE delivery, disconnect/reconnect, every drawer and
 *  keyboard interaction, and unmount. */
function installWriteCounter(page: Page): { count: () => number } {
  let nonGet = 0;
  void page.route("**/api/**", (route) => {
    if (route.request().method() !== "GET") nonGet++;
    void route.continue();
  });
  return { count: () => nonGet };
}

async function openBoard(page: Page, served: { baseURL: string; token: string }): Promise<void> {
  await page.goto(`${served.baseURL}/#/board`);
  await page.locator("#token-prompt-input").fill(served.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
  await expect(page.locator(".board")).toBeVisible();
  await expect(page.locator(".board__column").first()).toBeVisible();
}

/** Directly mutates a fixture opus's `state:` line — a throwaway temp studio
 *  copy, not the real officina bookkeeping CLAUDE.md's "never by hand" rule
 *  protects (same class of fixture edit `answer.spec.ts`/`seats.spec.ts`
 *  already do against `.md`/`.yml` files in `served.studioDir`). */
function setOpusState(studioDir: string, id: string, from: string, to: string): void {
  const path = join(studioDir, "opera", `${id}.md`);
  const raw = readFileSync(path, "utf8");
  writeFileSync(path, raw.replace(`state: ${from}`, `state: ${to}`), "utf8");
}

function setOpusTitle(studioDir: string, id: string, title: string): void {
  const path = join(studioDir, "opera", `${id}.md`);
  const raw = readFileSync(path, "utf8");
  writeFileSync(path, raw.replace(/^title: .*$/m, `title: ${title}`), "utf8");
}

/** Appends one valid `GantryEvent` line directly to `events.jsonl` — the
 *  survey's own proof case (an externally-appended event, never seen by a
 *  running Index, must still reach `/api/events?item=`). */
function appendUsageEvent(studioDir: string, itemId: string): void {
  const line = JSON.stringify({
    id: `test:${Date.now()}`,
    name: "gen_ai.usage",
    ts: new Date().toISOString(),
    projectId: PROJECT_ID,
    attrs: { "workflow.item.id": itemId, "workflow.actor.role": "builder-1", "gen_ai.usage.total_tokens": 4242 },
  });
  appendFileSync(join(studioDir, ".bisellium", "events.jsonl"), line + "\n", "utf8");
}

async function expectedModel(served: ServedInstance): Promise<BoardModel> {
  const officina = (await (await fetch(`${served.baseURL}/api/officina`)).json()) as OfficinaResponse;
  const opera = (await (await fetch(`${served.baseURL}/api/opera`)).json()) as OpusEntry[];
  return boardModel(officina, opera);
}

test.describe("W-064 behaviour 7: transport dependence, reconnect reconciliation, coalescing, no writes", () => {
  let served: ServedInstance;
  test.afterEach(async () => {
    await served?.close();
  });

  test("renders every column, each count equal to the spec's own computation from GET /api/opera", async ({ page }) => {
    served = await startServed("board-counts");
    const counter = installWriteCounter(page);
    await openBoard(page, served);

    const expected = await expectedModel(served);
    for (const col of expected.columns) {
      const head = page.locator(`.board__column[data-column-id="${col.id}"] .board__column-count`);
      await expect(head).toHaveText(String(col.cards.length));
    }

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("live case: an SSE-delivered greenlight moves the card, no reload, within two poll intervals", async ({ page }) => {
    served = await startServed("board-live");
    const counter = installWriteCounter(page);
    await openBoard(page, served);

    // W-007 (the only backlog opus in the fixture) starts uncounted in
    // Planned (backlog is a count, not a column) — not "zero cards in
    // Planned": W-006 is already greenlit there.
    await expect(page.locator('.board__column[data-column-id="planned"] .board__card[data-card-id="W-007"]')).toHaveCount(0);

    const result = runGreenlight(["W-007", "--studio", served.studioDir]);
    expect(result.exitCode).toBe(0);
    await forcePoll(served);

    await expect(page.locator('.board__column[data-column-id="planned"] .board__card[data-card-id="W-007"]')).toBeVisible({ timeout: 11_000 });
    await expect(page.locator('.board__column[data-column-id="planned"] .board__backlog-footer')).toBeHidden();

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("negative: with /api/live blocked after the initial connection, the card never appears and no further /api/opera requests are issued", async ({ page }) => {
    const r = await startRestartable("board-negative");
    served = r;
    const counter = installWriteCounter(page);
    await openBoard(page, r);

    // Block only AFTER initial connect+reconciliation — blocking before
    // navigation would prevent onOpen from ever firing, and so the initial
    // fetch, contaminating the result (closure note).
    await page.route("**/api/live", (route) => route.abort());
    let opusRequests = 0;
    await page.route("**/api/opera", (route) => {
      opusRequests++;
      void route.continue();
    });
    // A real TCP reset the client's EventSource genuinely notices; the
    // route above keeps every reconnect attempt blocked from here on.
    r.kill();
    await r.restart();
    await page.waitForTimeout(500);

    const before = opusRequests;
    const result = runGreenlight(["W-007", "--studio", r.studioDir]);
    expect(result.exitCode).toBe(0);
    await forcePoll(r);

    await page.waitForTimeout(2_000);
    await expect(page.locator('.board__column[data-column-id="planned"] .board__card[data-card-id="W-007"]')).toHaveCount(0);
    expect(opusRequests).toBe(before);

    await page.unroute("**/api/live");
    await page.goto(`${r.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("reconnect reconciliation: a change made while disconnected appears on reconnect, without a reload", async ({ page }) => {
    const r = await startRestartable("board-reconnect");
    served = r;
    const counter = installWriteCounter(page);
    await openBoard(page, r);

    r.kill();
    setOpusTitle(r.studioDir, "W-002", "reconnected title");
    await r.restart();

    await expect(page.locator('.board__card[data-card-id="W-002"] .board__card-title')).toHaveText("reconnected title", { timeout: 15_000 });

    await page.goto(`${r.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("reconnect repairs an OPEN DRAWER: an event appended while disconnected appears without closing/reopening", async ({ page }) => {
    const r = await startRestartable("board-reconnect-drawer");
    served = r;
    const counter = installWriteCounter(page);
    await openBoard(page, r);

    await page.locator('.board__card[data-card-id="W-002"]').click();
    await expect(page.locator(".board-drawer")).toBeVisible();

    r.kill();
    appendUsageEvent(r.studioDir, "W-002");
    await r.restart();

    await expect(page.locator(".board-drawer__record")).toContainText("4242", { timeout: 15_000 });
    await expect(page.locator(".board-drawer")).toBeVisible(); // never closed/reopened

    await page.goto(`${r.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("coalescing: a poll delivering several frames issues exactly one /api/opera request", async ({ page }) => {
    served = await startServed("board-coalesce");
    const counter = installWriteCounter(page);
    await openBoard(page, served);

    let opusRequests = 0;
    await page.route("**/api/opera", (route) => {
      opusRequests++;
      void route.continue();
    });

    setOpusState(served.studioDir, "W-002", "building", "verifying");
    setOpusState(served.studioDir, "W-005", "building", "review");
    await forcePoll(served);

    await expect(page.locator('.board__column[data-column-id="verifying"] .board__card[data-card-id="W-002"]')).toBeVisible({ timeout: 11_000 });
    await page.waitForTimeout(300); // let the trailing timer settle fully
    expect(opusRequests).toBe(1);

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });
});

test.describe("W-064 behaviour 8: keyboard traversal, the drawer, and focus restoration", () => {
  let served: ServedInstance;
  test.afterEach(async () => {
    await served?.close();
  });

  test("j/k move and stop at column ends; Enter opens; Esc closes and restores focus; the board stays visible behind the drawer", async ({ page }) => {
    served = await startServed("board-keyboard");
    const counter = installWriteCounter(page);
    await openBoard(page, served);

    const inProgress = page.locator('.board__column[data-column-id="in_progress"]');
    await inProgress.locator('[role="option"][tabindex="0"]').first().focus();
    const ids = await inProgress.locator('[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute("data-card-id")));
    expect(ids.length).toBeGreaterThanOrEqual(1);

    // stop at the end: pressing "j" ids.length times never wraps.
    for (let i = 0; i < ids.length + 2; i++) await page.keyboard.press("j");
    const lastFocused = await page.evaluate(() => document.activeElement?.getAttribute("data-card-id"));
    expect(lastFocused).toBe(ids[ids.length - 1]);

    // k back to the top, stop at the start.
    for (let i = 0; i < ids.length + 2; i++) await page.keyboard.press("k");
    const firstFocused = await page.evaluate(() => document.activeElement?.getAttribute("data-card-id"));
    expect(firstFocused).toBe(ids[0]);

    // Enter opens the drawer for the focused card; the board is still visible.
    await page.keyboard.press("Enter");
    await expect(page.locator(".board-drawer")).toBeVisible();
    await expect(page.locator(".board__columns")).toBeVisible();

    // Esc closes it and returns focus to that card.
    await page.keyboard.press("Escape");
    await expect(page.locator(".board-drawer")).toBeHidden();
    const restored = await page.evaluate(() => document.activeElement?.getAttribute("data-card-id"));
    expect(restored).toBe(firstFocused);

    // The drawer's own close control also closes it.
    await page.keyboard.press("Enter");
    await expect(page.locator(".board-drawer")).toBeVisible();
    await page.locator(".board-drawer__close").click();
    await expect(page.locator(".board-drawer")).toBeHidden();

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("ArrowRight/ArrowLeft move to the nearest card in the next/previous non-empty column", async ({ page }) => {
    served = await startServed("board-arrows");
    const counter = installWriteCounter(page);
    await openBoard(page, served);

    const inProgress = page.locator('.board__column[data-column-id="in_progress"]');
    await inProgress.locator('[role="option"][tabindex="0"]').first().focus();
    const startColumn = await page.evaluate(() => document.activeElement?.getAttribute("data-column-id"));

    await page.keyboard.press("ArrowRight");
    const afterRight = await page.evaluate(() => ({ column: document.activeElement?.getAttribute("data-column-id"), card: document.activeElement?.getAttribute("data-card-id") }));
    expect(afterRight.column).not.toBe(startColumn);
    expect(afterRight.card).toBeTruthy();

    await page.keyboard.press("ArrowLeft");
    const backColumn = await page.evaluate(() => document.activeElement?.getAttribute("data-column-id"));
    expect(backColumn).toBe(startColumn);

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("removal: the drawer closes and focus lands on a remaining card in that column, or the column head — never document.body", async ({ page }) => {
    served = await startServed("board-removal");
    const counter = installWriteCounter(page);
    await openBoard(page, served);

    await page.locator('.board__card[data-card-id="W-002"]').click();
    await expect(page.locator(".board-drawer")).toBeVisible();

    setOpusState(served.studioDir, "W-002", "building", "review");
    await forcePoll(served);

    await expect(page.locator(".board-drawer")).toBeHidden({ timeout: 11_000 });
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    const activeIsBody = await page.evaluate(() => document.activeElement === document.body);
    expect(activeIsBody).toBe(false);
    expect(activeTag).toBeTruthy();

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });
});

test.describe("W-064 behaviour 9: computed composition at desktop, tablet and phone", () => {
  let served: ServedInstance;
  test.afterEach(async () => {
    await served?.close();
  });

  test("1280px: 288px columns, sticky needs-you, 64px cards, 8px gaps, drawer shadow, card no-shadow, focus indicator", async ({ page }) => {
    served = await startServed("board-1280");
    const counter = installWriteCounter(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openBoard(page, served);

    const column = page.locator(".board__column").first();
    const columnBox = await column.boundingBox();
    expect(columnBox?.width).toBeCloseTo(288, 0);

    const needsYou = page.locator('.board__column[data-column-id="needs_you"]');
    const position = await needsYou.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe("sticky");
    const beforeScroll = await needsYou.boundingBox();
    await page.locator(".board__columns").evaluate((el) => (el.scrollLeft = 500));
    const afterScroll = await needsYou.boundingBox();
    expect(afterScroll?.x).toBeCloseTo(beforeScroll?.x ?? 0, 0);

    const card = page.locator(".board__card").first();
    const cardBox = await card.boundingBox();
    expect(cardBox?.height).toBeCloseTo(64, 0);
    const cardShadow = await card.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(cardShadow === "none" || cardShadow === "").toBe(true);

    // Scoped to ONE column: `.board__card` across the whole board isn't
    // vertically stacked (different columns), which a bare `nth(0)/nth(1)`
    // over the whole page would wrongly compare.
    const stacked = page.locator('.board__column[data-column-id="in_progress"] .board__card');
    if ((await stacked.count()) >= 2) {
      const first = await stacked.nth(0).boundingBox();
      const second = await stacked.nth(1).boundingBox();
      if (first && second) expect(second.y - (first.y + first.height)).toBeCloseTo(8, 0);
    }

    await card.focus();
    const outline = await card.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("800px: columns still 288px, needs-you unpinned, drawer leaves the rail visible", async ({ page }) => {
    served = await startServed("board-800");
    const counter = installWriteCounter(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await openBoard(page, served);

    const columnBox = await page.locator(".board__column").first().boundingBox();
    expect(columnBox?.width).toBeCloseTo(288, 0);

    const position = await page.locator('.board__column[data-column-id="needs_you"]').evaluate((el) => getComputedStyle(el).position);
    expect(position).not.toBe("sticky");

    await page.locator('.board__card[data-card-id="W-002"]').click();
    await expect(page.locator(".board-drawer")).toBeVisible();
    const drawerBox = await page.locator(".board-drawer").boundingBox();
    expect(drawerBox?.x).toBeGreaterThanOrEqual(72 - 1);

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("390x844: one column visible, the strip reaches the last column, needs-you-first-if-non-empty, full-width close control reachable without scrolling", async ({ page }) => {
    served = await startServed("board-phone");
    const counter = installWriteCounter(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page, served);

    const viewportWidth = 390;
    const visibleColumns = await page.locator(".board__column").evaluateAll((els, vw) => els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left < vw && r.right > 0 && r.left > -10;
    }).length, viewportWidth);
    expect(visibleColumns).toBe(1);

    const strip = page.locator(".board__strip");
    await expect(strip).toBeVisible();
    const lastItem = strip.locator(".board__strip-item").last();
    const lastName = await lastItem.textContent();
    await lastItem.click();
    await expect(page.locator(".board__column").last()).toBeInViewport();
    expect(lastName?.length).toBeGreaterThan(0);

    // needs-you non-empty on this fixture (W-003's human "patron" gate is
    // pending — see examples/sample-studio); initial visible column is
    // needs_you.
    await page.reload();
    await expect(page.locator(".board")).toBeVisible();
    const needsYouColumn = page.locator('.board__column[data-column-id="needs_you"]');
    await expect(needsYouColumn).toBeInViewport();

    await page.locator('.board__card').first().click();
    const drawerBox = await page.locator(".board-drawer").boundingBox();
    expect(Math.abs((drawerBox?.width ?? 0) - viewportWidth)).toBeLessThanOrEqual(1);
    const closeBox = await page.locator(".board-drawer__close").boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
    expect(closeBox && closeBox.y >= 0 && closeBox.y < 844).toBe(true);

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });
});
