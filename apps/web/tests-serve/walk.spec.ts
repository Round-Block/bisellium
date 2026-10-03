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

  // (d) Officina: headings, a posture card per seeded collegium, the integrity count from /api/health.
  await page.locator('.sidebar__link[href="#/officina"]').click();
  await expect(page.locator(".officina__panel-heading"), "officina panel headings").toHaveText(["System status", "Process engine", "Contract integrity"]);
  await expect
    .poll(() => page.locator(".officina__collegium-name").allTextContents().then((t) => [...t].sort()), "posture cards name exactly the seeded collegia")
    .toEqual(["art", "engineering", "production", "qa"]);
  const health = await getJSON<{ findingsByRule: Record<string, number> }>(s, "/api/health");
  const stale = health.findingsByRule["traditio.stale"];
  expect(stale, "the fixture has traditio.stale findings").toBeGreaterThan(0);
  const staleRow = page.locator(".panel--integrity .officina__row").filter({ hasText: "traditio.stale" });
  await expect(staleRow, "the integrity table has a traditio.stale row").toHaveCount(1);
  await expect(staleRow.locator(".officina__value-mono"), "its value is /api/health's own count").toHaveText(new RegExp(`^${String(stale)}$`));

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
