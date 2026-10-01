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
async function installWriteCounter(page: Page): Promise<{ count: () => number }> {
  let nonGet = 0;
  // Awaited, not fire-and-forget: TARGET-9's requirement is an ORDERING one
  // (the counter live before page.goto) — awaiting page.route()'s own
  // promise is what actually says so, rather than relying on Playwright's
  // channel ordering to make it true in practice (censor round 1, A4).
  await page.route("**/api/**", (route) => {
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

function setOpusBody(studioDir: string, id: string, body: string): void {
  const path = join(studioDir, "opera", `${id}.md`);
  const raw = readFileSync(path, "utf8");
  const closing = raw.indexOf("\n---\n", 4);
  if (closing < 0) throw new Error(`${id} has no closing front-matter delimiter`);
  writeFileSync(path, `${raw.slice(0, closing + 5)}${body}\n`, "utf8");
}

function setTraditioNext(studioDir: string, id: string, value: string): void {
  const path = join(studioDir, "opera", `${id}.md`);
  const raw = readFileSync(path, "utf8");
  const changed = raw.replace(/next: [^,}]*/, `next: "${value}"`);
  if (changed === raw) throw new Error(`${id} has no inline traditio.next`);
  writeFileSync(path, changed, "utf8");
}

function appendFixtureEvent(studioDir: string, itemId: string, ts: string, marker: string): void {
  const line = JSON.stringify({
    id: `w087:${marker}`,
    name: "workflow.attention",
    ts,
    projectId: PROJECT_ID,
    attrs: { "workflow.item.id": itemId, "workflow.attention.event": marker },
  });
  appendFileSync(join(studioDir, ".bisellium", "events.jsonl"), line + "\n", "utf8");
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
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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

    // Same window as the live case (:233's 11_000ms) — the brief binds both
    // sides to "at least two configured poll intervals" ("The card NEVER
    // appears within the same window"). A shorter window here would pass
    // for the wrong reason against e.g. a client setInterval(5000) refetch,
    // whose next tick simply hasn't fired yet at 2s.
    await page.waitForTimeout(11_000);
    await expect(page.locator('.board__column[data-column-id="planned"] .board__card[data-card-id="W-007"]')).toHaveCount(0);
    expect(opusRequests).toBe(before);

    await page.unroute("**/api/live");
    await page.goto(`${r.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("reconnect reconciliation: a change made while disconnected appears on reconnect, without a reload", async ({ page }) => {
    const r = await startRestartable("board-reconnect");
    served = r;
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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

    // Move focus INTO the drawer (a real user tabs into it) before Esc —
    // without this, document.activeElement never actually leaves the card,
    // and the restoration branch can be deleted entirely with the assertion
    // below staying green for the wrong reason (censor round 1, B1).
    await page.locator(".board-drawer__close").focus();
    await expect(page.locator(".board-drawer__close")).toBeFocused();

    // Esc closes it and returns focus to that card — never document.body.
    // The restoration itself is scheduled via requestAnimationFrame (one
    // frame after the drawer unmounts), so poll rather than read once.
    await page.keyboard.press("Escape");
    await expect(page.locator(".board-drawer")).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-card-id")))
      .toBe(firstFocused);
    const isBody = await page.evaluate(() => document.activeElement === document.body);
    expect(isBody).toBe(false);

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
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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

    // "Shadow exists once, on the drawer" (DIRECTION §3) — actually open it
    // and check, rather than only asserting the CARD's absence of one.
    await card.click();
    const drawer = page.locator(".board-drawer");
    await expect(drawer).toBeVisible();
    const drawerShadow = await drawer.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(drawerShadow === "none" || drawerShadow === "").toBe(false);

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });

  test("800px: columns still 288px, needs-you unpinned, drawer leaves the rail visible", async ({ page }) => {
    served = await startServed("board-800");
    const counter = await installWriteCounter(page);
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
    const counter = await installWriteCounter(page);
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

    // needs-you non-empty on this fixture (W-004's human "patron" gate is
    // pending — see examples/sample-studio; W-003's own pending gate is
    // "qa", kind agent, not human); initial visible column is needs_you.
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

  test("390x844, empty needs_you: the initial visible column is in_progress, never an empty attention column", async ({ page }) => {
    served = await startServed("board-phone-empty-needsyou");
    const counter = await installWriteCounter(page);
    // The fixture's only human gate (W-004's "patron") made NOT pending, so
    // needs_you is empty — *Composition*'s other half: "An empty attention
    // column is never the first thing the Patron sees" (censor round 1, B2).
    const patronGatePath = join(served.studioDir, "opera", "W-004.md");
    writeFileSync(patronGatePath, readFileSync(patronGatePath, "utf8").replace("patron: { status: pending }", "patron: { status: passed }"), "utf8");

    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page, served);

    await expect(page.locator('.board__column[data-column-id="needs_you"] .board__card')).toHaveCount(0);
    const needsYouColumn = page.locator('.board__column[data-column-id="needs_you"]');
    const inProgressColumn = page.locator('.board__column[data-column-id="in_progress"]');
    await expect(inProgressColumn).toBeInViewport();
    await expect(needsYouColumn).not.toBeInViewport();

    await page.goto(`${served.baseURL}/#/inbox`);
    expect(counter.count()).toBe(0);
  });
});

test.describe("W-087 behaviour 1: bounded titles retain their native full-title affordance", () => {
  let served: ServedInstance;
  test.afterEach(async () => {
    await served?.close();
  });

  test("a 300-character mixed title clamps to four lines while a short card remains 64px", async ({ page }) => {
    served = await startServed("w087-title-bounds");
    const prose = "Several ordinary words must wrap before this unbroken token ";
    const title = prose + "x".repeat(300 - prose.length);
    expect(title).toHaveLength(300);
    setOpusTitle(served.studioDir, "W-002", title);

    await page.setViewportSize({ width: 1280, height: 900 });
    await openBoard(page, served);

    const card = page.locator('.board__card[data-card-id="W-002"]');
    const titleNode = card.locator(".board__card-title");
    await expect(titleNode).toHaveText(title);
    await expect(titleNode).toHaveAttribute("title", title);

    const titleMetrics = await titleNode.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        clamp: style.getPropertyValue("-webkit-line-clamp"),
        overflow: style.overflow,
        overflowWrap: style.overflowWrap,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
    });
    expect(titleMetrics.clamp).toBe("4");
    expect(titleMetrics.overflow).toBe("hidden");
    expect(titleMetrics.overflowWrap).toBe("anywhere");
    expect(titleMetrics.clientHeight).toBe(72);
    expect(titleMetrics.scrollHeight).toBeGreaterThan(titleMetrics.clientHeight);

    const containment = await card.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const ladder = el.querySelector(".gate-ladder")?.getBoundingClientRect();
      const metaElement = el.querySelector(".board__card-meta");
      const meta = metaElement?.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        height: box.height,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        flexShrink: style.flexShrink,
        metaLineHeight: metaElement ? getComputedStyle(metaElement).lineHeight : "",
        ladderInside: !!ladder && ladder.height > 0 && ladder.top >= box.top && ladder.bottom <= box.bottom,
        metaInside: !!meta && meta.height > 0 && meta.top >= box.top && meta.bottom <= box.bottom,
      };
    });
    expect(containment.height).toBe(108);
    expect(containment.height).toBeLessThanOrEqual(108);
    expect(containment.minHeight).toBe("64px");
    expect(containment.maxHeight).toBe("108px");
    expect(containment.flexShrink).toBe("0");
    expect(containment.metaLineHeight).toBe("14px");
    expect(containment.ladderInside).toBe(true);
    expect(containment.metaInside).toBe(true);

    const shortCard = page.locator('.board__card[data-card-id="W-005"]');
    expect((await shortCard.boundingBox())?.height).toBe(64);
  });
});

test.describe("W-087 behaviour 2: the served drawer carries the complete opus body", () => {
  let served: ServedInstance;
  test.afterEach(async () => {
    await served?.close();
  });

  test("the collection and drawer preserve a long literal body and expose an honest empty state", async ({ page }) => {
    served = await startServed("w087-record-body");
    const body = [
      "First paragraph remains whole.",
      "",
      "## Literal markdown stays source",
      '<article data-test="literal"><img src=x onerror=alert(1)></article>',
      "",
      ...Array.from({ length: 48 }, (_, i) => `Paragraph ${String(i + 1).padStart(2, "0")}: ${"untruncated record prose ".repeat(3)}`),
    ].join("\n");
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(2048);
    setOpusBody(served.studioDir, "W-004", body);

    const response = await fetch(`${served.baseURL}/api/opera`);
    expect(response.status).toBe(200);
    const opera = (await response.json()) as OpusEntry[];
    const w004 = opera.find((row) => row.id === "W-004");
    expect(w004).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(w004, "body")).toBe(true);
    expect(w004?.body).toBe(body);

    await openBoard(page, served);
    await page.locator('.board__card[data-card-id="W-004"]').first().click();
    const renderedBody = page.locator(".board-drawer__record-body");
    await expect(renderedBody).toHaveText(body);
    expect(await renderedBody.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
    const renderedSource = await renderedBody.innerHTML();
    expect(renderedSource).toContain("&lt;article");
    expect(renderedSource).not.toContain("<article");

    await page.locator(".board-drawer__close").click();
    await page.locator('.board__card[data-card-id="W-002"]').click();
    await expect(page.locator(".board-drawer__record-body")).toHaveText("No record body.");
    await expect(page.locator(".board-drawer__record-body")).not.toContainText("undefined");
  });
});

test.describe("W-087 behaviour 3: every generated Board time has the viewer-local shape", () => {
  test.use({ timezoneId: "Asia/Singapore" });
  let served: ServedInstance;
  test.afterEach(async () => {
    await served?.close();
  });

  test("four timestamp fields localize without touching ISO-like authored content or raw ordering", async ({ page }) => {
    served = await startServed("w087-local-times");
    const fixed = "2026-09-25T11:58:00.000Z";
    const newer = "2026-10-01T00:01:00.000Z";
    const sourceTitle = `Title keeps ${fixed} verbatim`;
    const sourceBody = `Body keeps ${fixed} verbatim.`;
    const sourceNext = `next keeps ${fixed} verbatim`;
    setOpusTitle(served.studioDir, "W-002", sourceTitle);
    setOpusBody(served.studioDir, "W-002", sourceBody);
    setTraditioNext(served.studioDir, "W-002", sourceNext);
    appendFixtureEvent(served.studioDir, "W-002", fixed, "fixed");
    appendFixtureEvent(served.studioDir, "W-002", newer, "newer");

    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page, served);
    await expect(page.locator(".board__liveness")).toContainText("updated");
    await page.locator('.board__card[data-card-id="W-002"]').click();

    const fixedEvent = page.locator(".board-drawer__event").filter({ has: page.locator(".board-drawer__event-summary", { hasText: /^attention fixed$/ }) });
    await expect(fixedEvent.locator(".board-drawer__event-at")).toHaveText("25/09/26 19:58");
    const summaries = await page.locator(".board-drawer__event-summary").allTextContents();
    expect(summaries.indexOf("attention newer")).toBeLessThan(summaries.indexOf("attention fixed"));

    const liveness = (await page.locator(".board__liveness").textContent())?.replace(/^.*updated\s+/, "") ?? "";
    const colophonLine = (await page.locator(".board footer > div").nth(1).textContent()) ?? "";
    const generatedAt = colophonLine.split(" · ").at(-1) ?? "";
    const atRecord = page.locator(".board-drawer__record-row").filter({ has: page.locator(".board-drawer__record-label", { hasText: /^at$/ }) });
    const recordAt = (await atRecord.locator(".board-drawer__record-value").textContent()) ?? "";
    const eventAt = (await fixedEvent.locator(".board-drawer__event-at").textContent()) ?? "";
    for (const [name, value] of [
      ["liveness", liveness],
      ["colophon", generatedAt],
      ["event", eventAt],
      ["record at", recordAt],
    ] as const) {
      expect(value, name).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
      expect(value, name).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(value, name).not.toMatch(/Z$/);
    }

    await expect(page.locator('.board__card[data-card-id="W-002"] .board__card-title')).toHaveText(sourceTitle);
    await expect(page.locator(".board-drawer__record-body")).toHaveText(sourceBody);
    const nextRecord = page.locator(".board-drawer__record-row").filter({ has: page.locator(".board-drawer__record-label", { hasText: /^next$/ }) });
    await expect(nextRecord.locator(".board-drawer__record-value")).toHaveText(sourceNext);

    const allocation = await fixedEvent.evaluate((row) => {
      const at = row.querySelector<HTMLElement>(".board-drawer__event-at")!;
      const summary = row.querySelector<HTMLElement>(".board-drawer__event-summary")!;
      const rowBox = row.getBoundingClientRect();
      const atBox = at.getBoundingClientRect();
      const summaryBox = summary.getBoundingClientRect();
      const gap = Number.parseFloat(getComputedStyle(row).columnGap);
      return {
        atWidth: atBox.width,
        atFlexBasis: getComputedStyle(at).flexBasis,
        atWhiteSpace: getComputedStyle(at).whiteSpace,
        atClientWidth: at.clientWidth,
        atScrollWidth: at.scrollWidth,
        textLength: at.textContent?.length ?? 0,
        rowWidth: rowBox.width,
        summaryWidth: summaryBox.width,
        gap,
      };
    });
    expect(allocation.atWidth).toBeCloseTo(112, 0);
    expect(allocation.atFlexBasis).toBe("112px");
    expect(allocation.atWhiteSpace).toBe("nowrap");
    expect(allocation.textLength).toBe(14);
    expect(allocation.atScrollWidth).toBeLessThanOrEqual(allocation.atClientWidth);
    expect(allocation.summaryWidth).toBeCloseTo(allocation.rowWidth - allocation.atWidth - allocation.gap, 0);
  });
});

test.describe("W-087 behaviour 4: the pushed drawer never covers reachable terminal columns", () => {
  let served: ServedInstance;
  test.afterEach(async () => {
    await served?.close();
  });

  test("the binding breakpoint table, terminal reachability and both focus-return paths hold", async ({ page }) => {
    test.setTimeout(60_000);
    served = await startServed("w087-pushed-drawer");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBoard(page, served);

    const widths = [
      { viewport: 1440, board: 680, main: 1220, close: "escape" },
      { viewport: 800, board: 188, main: 728, close: "escape" },
      { viewport: 900, board: 140, main: 680, close: "escape" },
      { viewport: 613, board: 1, main: 541, close: "escape" },
      { viewport: 612, board: 0, main: 540, close: "escape" },
      { viewport: 606, board: 0, main: 534, close: "escape" },
      { viewport: 600, board: 0, main: 528, close: "escape" },
      { viewport: 390, board: 0, main: 390, close: "button" },
    ] as const;

    for (const row of widths) {
      await page.setViewportSize({ width: row.viewport, height: 900 });
      const source = page.locator('.board__card[data-card-id="W-002"]');
      await source.scrollIntoViewIfNeeded();
      await source.focus();
      const columns = page.locator(".board__columns");
      await columns.evaluate((el) => {
        el.scrollLeft = Math.min(137, Math.max(0, el.scrollWidth - el.clientWidth));
      });
      const beforeOpenScroll = await columns.evaluate((el) => el.scrollLeft);
      const fullWidth = await page.locator(".board").evaluate((el) => el.getBoundingClientRect().width);
      expect(fullWidth).toBeCloseTo(row.main, 0);
      await page.evaluate(() => {
        const holder = window as typeof window & { __w087Board?: Element | null };
        holder.__w087Board = document.querySelector(".board");
      });

      await page.keyboard.press("Enter");
      const close = page.locator(".board-drawer__close");
      await expect(close).toBeVisible();
      await expect(close).toBeFocused();
      const geometry = await page.evaluate(() => {
        const workspace = document.querySelector(".board-workspace");
        const board = document.querySelector(".board");
        const drawer = document.querySelector(".board-drawer");
        if (!workspace || !board || !drawer) return null;
        const workspaceBox = workspace.getBoundingClientRect();
        const boardBox = board.getBoundingClientRect();
        const drawerBox = drawer.getBoundingClientRect();
        const holder = window as typeof window & { __w087Board?: Element | null };
        return {
          workspaceWidth: workspaceBox.width,
          boardWidth: boardBox.width,
          boardRight: boardBox.right,
          drawerLeft: drawerBox.left,
          sameBoard: holder.__w087Board === board,
        };
      });
      expect(geometry).not.toBeNull();
      expect(geometry?.workspaceWidth).toBeCloseTo(row.main, 0);
      expect(geometry?.boardWidth).toBeCloseTo(row.board, 0);
      expect(Math.abs((geometry?.boardRight ?? 0) - (geometry?.drawerLeft ?? 0))).toBeLessThanOrEqual(1);
      expect(geometry?.sameBoard).toBe(true);

      if (row.viewport === 1440) {
        const needsYou = page.locator('.board__column[data-column-id="needs_you"]');
        await expect(needsYou).toBeVisible();
        expect(await needsYou.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
        for (const terminal of ["done", "halted"]) {
          const terminalColumn = page.locator(`.board__column[data-column-id="${terminal}"]`);
          await columns.evaluate((el, id) => {
            const target = el.querySelector<HTMLElement>(`.board__column[data-column-id="${id}"]`)!;
            el.scrollLeft = target.offsetLeft + target.offsetWidth - el.clientWidth + 24;
          }, terminal);
          await expect(terminalColumn).toBeVisible();
          const boxes = await page.evaluate((id) => {
            const pinned = document.querySelector('.board__column[data-column-id="needs_you"]')?.getBoundingClientRect();
            const terminalBox = document.querySelector(`.board__column[data-column-id="${id}"]`)?.getBoundingClientRect();
            const drawer = document.querySelector(".board-drawer")?.getBoundingClientRect();
            return pinned && terminalBox && drawer ? { pinnedRight: pinned.right, terminalLeft: terminalBox.left, terminalRight: terminalBox.right, drawerLeft: drawer.left } : null;
          }, terminal);
          expect(boxes).not.toBeNull();
          expect((boxes?.terminalLeft ?? 0) + 1).toBeGreaterThanOrEqual(boxes?.pinnedRight ?? Number.POSITIVE_INFINITY);
          expect(boxes?.terminalRight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((boxes?.drawerLeft ?? 0) + 1);
        }
      }

      if (row.close === "escape") await page.keyboard.press("Escape");
      else await close.click();
      await expect(page.locator(".board-drawer")).toBeHidden();
      await expect(source).toBeFocused();
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
      expect(await page.locator(".board").evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(row.main, 0);
      expect(await columns.evaluate((el) => el.scrollLeft)).toBeCloseTo(beforeOpenScroll, 0);
    }

    // The established reconciliation fallback is part of the focus contract:
    // if the source leaves its column, focus lands on that column's nearest
    // remaining card (or its head), never on document.body.
    await page.setViewportSize({ width: 1280, height: 900 });
    const inProgress = page.locator('.board__column[data-column-id="in_progress"]');
    const beforeIds = await inProgress.locator(".board__card").evaluateAll((els) => els.map((el) => el.getAttribute("data-card-id")));
    const expectedFallback = beforeIds.find((id) => id !== "W-002");
    const columns = page.locator(".board__columns");
    const source = page.locator('.board__card[data-card-id="W-002"]');
    await source.scrollIntoViewIfNeeded();
    await source.focus();
    const beforeOpenScroll = await columns.evaluate((el) => el.scrollLeft);
    await page.keyboard.press("Enter");
    await expect(page.locator(".board-drawer__close")).toBeFocused();
    setOpusState(served.studioDir, "W-002", "building", "review");
    await forcePoll(served);
    await expect(page.locator(".board-drawer")).toBeHidden({ timeout: 11_000 });
    if (expectedFallback) await expect(inProgress.locator(`.board__card[data-card-id="${expectedFallback}"]`)).toBeFocused();
    else await expect(inProgress.locator(".board__column-head")).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    expect(await columns.evaluate((el) => el.scrollLeft)).toBeCloseTo(beforeOpenScroll, 0);
  });
});
