/**
 * apps/web/tests-serve/walk.spec.ts — W-110 behaviours 2 and 3: the console
 * walked end to end against the built dist, served by a real `bisellium
 * serve` over a throwaway copy of examples/sample-studio (the W-067 harness,
 * unchanged). Behaviour 2 clicks the rail; behaviour 3 checks each screen for
 * content only the served officina can supply and leaves one screenshot per
 * rail entry. No test.describe: each title is `W-110 behaviour N: ...` so a
 * playwright --grep selects exactly one. No wall-clock sleep: every wait is an
 * expect(locator) or an expect.poll.
 *
 * W-077 behaviours 6 and 7 follow the same shape: the Officina over a stale tick
 * snapshot and an empty aerarium (6), and over failed reads (7).
 *
 * `NAV_ENTRIES` is read through a namespace import, after each behaviour's
 * Genuine red row, so a missing export is an assertion failure and not a
 * module-load one.
 */
import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as nav from "../src/lib/nav.js";
import { REPO_ROOT, startServed, type ServedInstance } from "./harness.js";

interface NavEntry {
  route: string;
  href: string;
  label: string;
}
const navEntries = (): readonly NavEntry[] | undefined => (nav as unknown as { NAV_ENTRIES?: readonly NavEntry[] }).NAV_ENTRIES;

/** The mounted root element of each screen. */
const SCREEN_ROOT: Record<string, string> = { inbox: ".inbox", board: ".board", seats: ".seats", officina: ".officina" };
const ROUTES = ["inbox", "board", "seats", "officina"] as const;

let served: ServedInstance | undefined;
test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

async function signIn(page: Page, s: ServedInstance, route = "inbox"): Promise<void> {
  await page.goto(`${s.baseURL}/#/${route}`);
  await page.locator("#token-prompt-input").fill(s.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
}

async function expectOnlyScreen(page: Page, route: string): Promise<void> {
  for (const r of ROUTES) await expect(page.locator(SCREEN_ROOT[r]!), `${route}: ${r} root`).toHaveCount(r === route ? 1 : 0);
}

async function getJSON<T>(s: ServedInstance, path: string): Promise<T> {
  const res = await fetch(`${s.baseURL}${path}`);
  expect(res.status, `GET ${path}`).toBe(200);
  return (await res.json()) as T;
}

test("W-110 behaviour 2: the rail reaches every screen it lists, says which one is current, and survives Back, Forward and a reload", async ({ page }) => {
  served = await startServed("walk-2");
  const base = served.baseURL;
  await page.setViewportSize({ width: 1280, height: 900 });

  // Armed before the first goto: page errors, and served-origin responses and failures.
  const pageErrors: string[] = [];
  const badTraffic: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400) badTraffic.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith(base)) return; // third-party fonts answer 407 behind a proxy
    if (new URL(r.url()).pathname === "/api/live") return; // the SSE stream torn down on unmount
    badTraffic.push(`failed ${r.url()}`);
  });

  // (a) the prompt hides after the token is submitted, and #/inbox mounts exactly the inbox.
  await signIn(page, served, "inbox");
  await expectOnlyScreen(page, "inbox");

  // (b) clicking each rail link lands the hash, mounts that one screen and marks that one link active.
  const hash = (): Promise<string> => page.evaluate(() => location.hash);
  for (const route of ["board", "seats", "officina", "inbox"]) {
    await page.locator(`.sidebar__link[href="#/${route}"]`).click();
    await expect.poll(hash, `hash after clicking ${route}`).toBe(`#/${route}`);
    await expectOnlyScreen(page, route);
    await expect(page.locator(".sidebar__link--active"), `active mark after clicking ${route}`).toHaveCount(1);
    await expect(page.locator(".sidebar__link--active"), `active link after clicking ${route}`).toHaveAttribute("href", `#/${route}`);
  }

  // (c) Back re-mounts the previous screen, Forward the next, and a reload keeps each route.
  await page.goBack();
  await expect.poll(hash, "hash after Back").toBe("#/officina");
  await expectOnlyScreen(page, "officina");
  await page.goForward();
  await expect.poll(hash, "hash after Forward").toBe("#/inbox");
  await expectOnlyScreen(page, "inbox");
  for (const route of ROUTES) {
    await page.locator(`.sidebar__link[href="#/${route}"]`).click();
    await expectOnlyScreen(page, route);
    await page.reload();
    await expectOnlyScreen(page, route);
    await expect(page.locator(".token-prompt"), `${route}: the prompt stays closed after a reload`).toBeHidden();
  }

  // (d) no uncaught page error and no 4xx/5xx from the served origin across the whole walk.
  expect(pageErrors, "no uncaught page error across the walk").toEqual([]);
  expect(badTraffic, "no 4xx/5xx or failed request from the served origin").toEqual([]);

  // (e) Genuine red: on each route exactly one link is aria-current="page", and it is the right one.
  for (const route of ROUTES) {
    await page.locator(`.sidebar__link[href="#/${route}"]`).click();
    await expectOnlyScreen(page, route);
    await expect(page.locator('.sidebar__link[aria-current="page"]'), `${route}: exactly one link has aria-current="page"`).toHaveCount(1);
    await expect(page.locator('.sidebar__link[aria-current="page"]'), `${route}: the current link is the route's own`).toHaveAttribute("href", `#/${route}`);
    await expect(page.locator(".sidebar__link[aria-current]"), `${route}: no other link carries aria-current at all`).toHaveCount(1);
  }

  // (f) the rail is the table: the same hrefs in the same order, and no other anchor.
  const entries = navEntries();
  expect(entries, "nav.NAV_ENTRIES is exported").toBeTruthy();
  const hrefs = await page.locator(".sidebar__link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs, "the rail's hrefs in document order equal NAV_ENTRIES").toEqual(entries!.map((e) => e.href));
  await expect(page.locator(".sidebar a"), "the rail renders exactly one anchor per entry").toHaveCount(entries!.length);
});

test("W-110 behaviour 3: every screen shows the served officina's own content, and the walk leaves one screenshot per screen", async ({ page }) => {
  served = await startServed("walk-3");
  const s = served;
  await page.setViewportSize({ width: 1280, height: 900 });

  // Seed the throwaway studio: the allowance for the period the server itself reports missing,
  // and a cascade actum dated now. Seeding precedes the first load, which is the reload the
  // brief asks for: every route re-reads the studio dir per request.
  const dueBefore = await getJSON<{ due: { kind: string; id: string }[] }>(s, "/api/health");
  const missing = dueBefore.due.find((d) => d.kind === "aerarium");
  if (missing) {
    const source = readFileSync(join(s.studioDir, "aerarium", "2026-W38.yml"), "utf8");
    writeFileSync(join(s.studioDir, "aerarium", `${missing.id}.yml`), source.replace(/^period:.*$/m, `period: ${missing.id}`));
  }
  const now = new Date();
  mkdirSync(join(s.studioDir, "acta"), { recursive: true });
  writeFileSync(
    join(s.studioDir, "acta", `${now.toISOString().slice(0, 10)}-walk.md`),
    ["---", "author: producer", "kind: cascade", "title: Walk cascade landing", `at: ${now.toISOString()}`, "evidence: []", "---", "A cascade landed during the walk.", ""].join("\n"),
  );

  let actaRequests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/acta") actaRequests++;
  });
  await signIn(page, s, "inbox");

  // (a) Inbox shows the fixture's petitio and its opus id.
  await expect(page.locator(".inbox"), "inbox shows the fixture's petitio").toContainText("Drag-and-drop grew a second screen");
  await expect(page.locator(".inbox"), "inbox names W-004").toContainText("W-004");

  // (b) Board: the seven literal column ids (board policy, not data) and the served card-id set.
  await page.locator('.sidebar__link[href="#/board"]').click();
  const columns = ["awaiting_review", "done", "halted", "in_progress", "needs_you", "planned", "verifying"];
  await expect
    .poll(() => page.locator("[data-column-id]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-column-id")))].sort()), "board column ids")
    .toEqual(columns);
  const opera = await getJSON<{ id: string }[]>(s, "/api/opera");
  const wantCards = [...new Set(opera.map((o) => o.id))].sort();
  await expect
    .poll(() => page.locator("[data-card-id]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-card-id")))].sort()), "board card-id set")
    .toEqual(wantCards);

  // (c) Seats: a model select per declared seat, valued from the manifest.
  await page.locator('.sidebar__link[href="#/seats"]').click();
  const officina = await getJSON<{ sellae: { id: string }[] }>(s, "/api/officina");
  await expect(page.locator('select[aria-label^="model for seat "]'), "one model select per declared seat").toHaveCount(officina.sellae.length);
  await expect(page.locator('select[aria-label="model for seat builder"]'), "the builder seat's model is the manifest's").toHaveValue("claude-sonnet-5");

  // (d) Officina: headings, a posture card per seeded collegium, the Handoff notes count from /api/health.
  await page.locator('.sidebar__link[href="#/officina"]').click();
  await expect(page.locator(".officina__panel-heading"), "officina panel headings").toHaveText(["Posture and burn", "Pending actions", "Contract integrity"]);
  await expect
    .poll(() => page.locator(".officina__collegium-name").allTextContents().then((t) => [...t].sort()), "posture cards name exactly the seeded collegia")
    .toEqual(["art", "engineering", "production", "qa"]);
  const health = await getJSON<{ findingsByRule: Record<string, number> }>(s, "/api/health");
  const handoff = Object.entries(health.findingsByRule)
    .filter(([rule]) => rule.startsWith("traditio."))
    .reduce((sum, [, count]) => sum + count, 0);
  expect(handoff, "the fixture has traditio findings").toBeGreaterThan(0);
  const handoffRow = page.locator(".panel--integrity details.officina__row").filter({ has: page.locator("summary .officina__label", { hasText: "Handoff notes" }) });
  await expect(handoffRow, "the integrity list has a Handoff notes row").toHaveCount(1);
  await expect(handoffRow.locator("summary .officina__value-mono"), "its value is the sum of /api/health's traditio.* counts").toHaveText(new RegExp(`^${String(handoff)}$`));

  // (e) Genuine red: the seeded cascade actum fills exactly one recent tick, and /api/acta was requested.
  await expect.poll(() => actaRequests, "GET /api/acta was requested while the Officina screen loaded").toBeGreaterThan(0);
  await expect(page.locator(".fasti-strip__column"), "the fasti strip has 14 day columns").toHaveCount(14);
  await expect(page.locator(".fasti-strip__tick--filled"), "exactly one tick is filled").toHaveCount(1);
  const filledAt = await page.locator(".fasti-strip__column").evaluateAll((els) => els.findIndex((e) => e.querySelector(".fasti-strip__tick--filled") !== null));
  expect(filledAt, "the filled tick is among the most recent days").toBeGreaterThanOrEqual(12);

  // (f) one full-page screenshot per rail entry, named by route, 1280 wide and at least 900 tall.
  const entries = navEntries();
  expect(entries, "nav.NAV_ENTRIES is exported").toBeTruthy();
  const dir = process.env["BISELLIUM_SHOTS_DIR"] ?? join(REPO_ROOT, "apps", "web", "test-results", "shots");
  mkdirSync(dir, { recursive: true });
  for (const entry of entries!) {
    await page.locator(`.sidebar__link[href="${entry.href}"]`).click();
    await expect(page.locator(SCREEN_ROOT[entry.route]!), `${entry.route} is mounted before its screenshot`).toHaveCount(1);
    await page.screenshot({ path: join(dir, `${entry.route}.png`), fullPage: true });
  }
  expect(readdirSync(dir).filter((n) => n.endsWith(".png")).sort(), "the *.png names are exactly the rail's routes").toEqual(entries!.map((e) => `${e.route}.png`).sort());
  for (const entry of entries!) {
    const file = join(dir, `${entry.route}.png`);
    expect(existsSync(file), `${entry.route}.png exists`).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 8).toString("hex"), `${entry.route}.png has the PNG signature`).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16), `${entry.route}.png is 1280 wide`).toBe(1280);
    expect(bytes.readUInt32BE(20), `${entry.route}.png is at least 900 tall`).toBeGreaterThanOrEqual(900);
  }
});

test("W-077 behaviour 6: the Officina tells the truth about a stale tick snapshot and an empty aerarium", async ({ page }) => {
  served = await startServed("w077-6");
  const s = served;
  await page.setViewportSize({ width: 1280, height: 900 });

  // Precondition: the fixture holds no allowance for the current period.
  expect(await getJSON<unknown[]>(s, "/api/aerarium"), "/api/aerarium answers []").toEqual([]);
  const at = "2026-09-25T09:35:43.947Z";
  writeFileSync(
    join(s.studioDir, "health.json"),
    JSON.stringify({
      at,
      ok: false,
      blocks: 1,
      advisories: 3,
      findingsByRule: { "state.done.probationes": 1, "traditio.stale": 2, "traditio.stage": 1 },
      autonomy: { paused: true, since: "2026-09-24T00:00:00Z", reason: "walk" },
      lastTick: at,
      due: [
        { kind: "daily", sella: "producer" },
        { kind: "aerarium", period: "2026-W39" },
        { kind: "traditio", opus: "W-002" },
      ],
    }),
  );
  await signIn(page, s, "inbox");
  await page.locator('.sidebar__link[href="#/officina"]').click();
  const officina = page.locator(".officina");

  // (a) the Genuine red: both health panels carry the stamp of the file, not of the screen.
  await expect(page.locator(".officina__as-of"), "one as-of line in each health panel").toHaveCount(2);
  for (const stamp of await page.locator(".officina__as-of").all()) await expect(stamp).toHaveText(/^as of 2026-09-25 09:35 UTC,/);

  // (b) the empty aerarium is named, and nothing is drawn as a card.
  const burn = page.locator(".panel--status-wide");
  await expect(burn, "the empty state says nothing is recorded").toContainText("No budget allocation is recorded for this week. Burn and posture are unavailable.");
  await expect(burn, "and names the action").toContainText("Set one with bisellium budget.");
  await expect(page.locator(".officina__collegium-name"), "no posture card").toHaveCount(0);

  // (c) no Engine state, whatever the file says about a pause.
  await expect(officina).not.toContainText(/Engine state|Paused|Autonomous/);

  // (d) the pending actions are named, from the tick-shaped file.
  const pending = page.locator(".panel--engine");
  await expect(pending.locator(".officina__value-mono"), "pending rows are named").toHaveText(["producer", "2026-W39", "W-002"]);
  await expect(pending.locator(".officina__count"), "the count beside the heading").toHaveText("3");

  // (e) the integrity panel speaks in sentences and groups by area.
  const integrity = page.locator(".panel--integrity");
  await expect(integrity).toContainText("This check found 1 blocking problem.");
  await expect(integrity).toContainText("3 warnings; they do not stop work.");
  await expect(integrity).toContainText("All findings by area");
  const rows = integrity.locator("details.officina__row");
  await expect(rows, "one row per area").toHaveCount(2);
  await expect(rows.nth(0).locator("summary .officina__label")).toHaveText("Handoff notes");
  await expect(rows.nth(0).locator("summary .officina__value-mono")).toHaveText("3");
  await expect(rows.nth(0)).toHaveAttribute("title", "traditio.stage, traditio.stale");
  await expect(rows.nth(1).locator("summary .officina__label")).toHaveText("Work item states");
  await expect(rows.nth(1).locator("summary .officina__value-mono")).toHaveText("1");
  await expect(rows.nth(1)).toHaveAttribute("title", "state.done.probationes");

  // (f) rule ids are behind the disclosure until it is opened from the keyboard.
  const ids = integrity.locator(".officina__rule-ids");
  await expect(ids, "one rule-id list per row").toHaveCount(2);
  for (const id of await ids.all()) await expect(id).toBeHidden();
  await rows.nth(0).locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(rows.nth(0).locator(".officina__rule-ids")).toBeVisible();
  await expect(rows.nth(0).locator(".officina__rule-ids")).toHaveText("traditio.stage, traditio.stale");
});
