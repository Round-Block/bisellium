process.env["NODE_ENV"] = "test";

import { expect, test, type Page, type Route } from "@playwright/test";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;

async function expectHomeRoute(page: Page, baseURL: string, label: string): Promise<void> {
  await expect(page, `${label}: canonical Home URL`).toHaveURL(`${baseURL}/#/home`);
  await expect(page.getByRole("heading", { name: "Home", exact: true }), `${label}: Home is mounted`).toBeVisible();
}

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

const MANY = {
  meter: {
    overall: 60,
    rows: [
      { id: "M1", title: "Build process", weight: 10, done: 2, planned: 3, met: false, pct: 66.67 },
      { id: "M2", title: "Records you can trust", weight: 15, done: 1, planned: 2, met: true, pct: 100 },
    ],
  },
  estimate: { kind: "none", line: "No estimate" },
};

const ONE = {
  meter: { overall: 67, rows: [{ id: "M1", title: "Build process", weight: 100, done: 2, planned: 3, met: false, pct: 66.67 }] },
  estimate: { kind: "none", line: "No estimate" },
};

test("W-504-b1 Completion renders exact milestone units and labels", async ({ page }) => {
  served = await startServed("w504-b1");
  await seedToken(page, served);
  await page.route("**/api/completion", (route) => route.fulfill({ json: MANY }));
  await page.goto(`${served.baseURL}/#/home`);
  await expect(page, "b1 opens the canonical Home route").toHaveURL(`${served.baseURL}/#/home`);
  await expect(page.getByRole("heading", { name: "Home", exact: true }), "b1 reaches Home before checking Completion").toBeVisible();
  await expect(page.getByRole("heading", { name: "Completion", exact: true }), "Completion joins Home after the existing W-503 rows").toBeVisible();
  await expect(page.locator(".home-completion__overall"), "the served overall value is named").toHaveText("60%");
  await expect(page.locator(".home-completion__group"), "every served milestone has one labelled group").toHaveCount(2);
  await expect(page.locator(".home-completion__group h3"), "milestone titles remain plain English").toHaveText(["Build process", "Records you can trust"]);
  await expect(page.locator(".home-completion__unit"), "one unit renders for every planned item").toHaveCount(5);
  await expect(page.locator(".home-completion__unit--done"), "only done items use the filled unit").toHaveCount(3);
  await expect(page.locator(".home-completion__count"), "exact done and planned labels remain visible").toHaveText(["2 of 3 done", "1 of 2 done"]);
});

test("W-504-b2 Completion handles ruled widths, absence, failure and the completion-only cut", async ({ page }) => {
  served = await startServed("w504-b2");
  await seedToken(page, served);
  let mode: "many" | "one" | "none" | "fail" | "hold" = "many";
  let held: Route | undefined;
  let providerReads = 0;
  let spendReads = 0;
  await page.route("**/api/completion", (route) => {
    if (mode === "hold") { held = route; return; }
    if (mode === "fail") return route.fulfill({ status: 503, body: "unavailable" });
    return route.fulfill({ json: mode === "none" ? { meter: null, estimate: null } : mode === "one" ? ONE : MANY });
  });
  await page.route("**/api/providers**", (route) => { providerReads++; return route.fulfill({ json: [{ id: "claude", usagePct: 81, status: "conserve", note: "stale" }] }); });
  await page.route("**/api/aerarium**", (route) => { spendReads++; return route.fulfill({ json: [{ collegium: "design", period: "2026-W47", allowance: { tokens: 100 }, burn: { tokens: 125 }, posture: "closeout" }] }); });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/#/home`);
    await expectHomeRoute(page, served.baseURL, `${width}`);
    await expect(page.locator(".home"), `${width}: capture readiness includes the settled Completion read`).toHaveAttribute("data-completion-settled", "true");
    await expect(page.locator(".home-card--completion"), `${width}: the populated Completion card is visible`).toBeVisible();
    await expect(page.getByRole("heading", { name: /Spend|Provider readings|Time/ }), `${width}: D-234's dropped and unsupported parts stay absent`).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: Completion stays inside the viewport`).toBeLessThanOrEqual(0);
    if (width === 1280) {
      await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "collapsed"));
      await page.reload();
      await expectHomeRoute(page, served.baseURL, "1280 collapsed");
      await expect(page.locator(".shell"), "1280 collapsed: Home remains mounted").toHaveClass(/shell--sidebar-collapsed/);
      await expect(page.locator(".home-card--completion"), "1280 collapsed: Completion remains visible").toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "1280 collapsed: no horizontal overflow").toBeLessThanOrEqual(0);
      await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "expanded"));
    }
  }
  expect(providerReads, "absent, stale or present provider readings are outside this Completion-only opus").toBe(0);
  expect(spendReads, "absent, under or over spend is outside this Completion-only opus").toBe(0);

  mode = "one";
  await page.reload();
  await expectHomeRoute(page, served.baseURL, "one milestone");
  await expect(page.locator(".home-completion__group"), "one milestone renders one labelled group").toHaveCount(1);
  await expect(page.locator(".home-completion__unit"), "one milestone retains its exact planned units").toHaveCount(3);

  mode = "none";
  await page.reload();
  await expectHomeRoute(page, served.baseURL, "no milestone record");
  await expect(page.locator(".home-card--completion"), "no milestone record does not create an empty card").toHaveCount(0);
  await expect(page.locator(".home-completion-status"), "milestone absence is stated outside a card").toHaveText("No completion record is available.");

  mode = "hold";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectHomeRoute(page, served.baseURL, "held Completion");
  await expect(page.locator(".home-card--needs"), "a slow Completion read does not hide loaded W-503 facts").toBeVisible();
  await expect(page.locator(".home"), "a slow Completion read does not claim capture readiness").toHaveAttribute("data-completion-settled", "false");
  await expect(page.locator(".home-completion-status"), "a slow Completion read is named").toHaveText("Loading completion…");
  await held!.fulfill({ json: MANY });
  await expect(page.locator(".home-card--completion"), "the held read settling reveals Completion").toBeVisible();
  await expect(page.locator(".home"), "the held read settling admits capture readiness").toHaveAttribute("data-completion-settled", "true");

  mode = "fail";
  await page.reload();
  await expectHomeRoute(page, served.baseURL, "failed Completion");
  await expect(page.locator(".home-card--completion"), "a failed Completion read renders no stale chart").toHaveCount(0);
  await expect(page.locator(".home-completion-status"), "a failed Completion read is explicit").toHaveText("Could not load completion.");
  await expect(page.locator(".home"), "an explicit failed state is settled, not a loading capture").toHaveAttribute("data-completion-settled", "true");
});
