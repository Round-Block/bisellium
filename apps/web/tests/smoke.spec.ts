/**
 * apps/web/tests/smoke.spec.ts — W-029: Playwright integration smoke suite.
 * Static rendering is covered by apps/web/test/*.test.ts (react-dom/server,
 * no DOM); this suite drives a real Chromium against vite dev to cover
 * click handlers, keyboard navigation and hash-route transitions that a
 * static render can't exercise. `?demo=1` forces the screens' own
 * deterministic dev-fixture data (see src/screens/Inbox.tsx and
 * src/screens/Officina.tsx) so assertions don't depend on a running
 * bisellium server.
 */
import { expect, test } from "@playwright/test";

// behaviour 1: Inbox screen loads and shows the heading.
test("inbox screen loads and shows heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
});

// behaviour 2: nav links switch between Inbox and Officina screens.
test("nav links switch between Inbox and Officina", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Officina" }).click();
  await expect(page.getByRole("heading", { name: "Officina" })).toBeVisible();
  await expect(page).toHaveURL(/#\/officina$/);

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page).toHaveURL(/#\/inbox$/);
});

// behaviour 3: j/k keyboard navigation moves focus across inbox items.
test("keyboard navigation (j/k) moves focus on inbox items", async ({ page }) => {
  await page.goto("/?demo=1#/inbox");
  const rows = page.locator(".inbox__row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-focused", "true");

  await page.keyboard.press("j");
  await expect(rows.nth(0)).toHaveAttribute("data-focused", "false");
  await expect(rows.nth(1)).toHaveAttribute("data-focused", "true");

  await page.keyboard.press("k");
  await expect(rows.nth(0)).toHaveAttribute("data-focused", "true");
  await expect(rows.nth(1)).toHaveAttribute("data-focused", "false");
});

// behaviour 4: Officina screen loads and shows the fasti strip.
test("officina screen loads and shows fasti strip", async ({ page }) => {
  await page.goto("/?demo=1#/officina");
  await expect(page.getByRole("heading", { name: "Officina" })).toBeVisible();
  await expect(page.locator(".fasti-strip")).toBeVisible();
});

// behaviour 5: hash changes reflect in the displayed screen (no full reload).
test("route hash changes reflect in displayed screen", async ({ page }) => {
  await page.goto("/#/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = "#/officina";
  });
  await expect(page.getByRole("heading", { name: "Officina" })).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = "#/inbox";
  });
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
});
