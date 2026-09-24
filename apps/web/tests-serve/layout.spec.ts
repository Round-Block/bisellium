/**
 * apps/web/tests-serve/layout.spec.ts — W-065 behaviour 15: computed layout,
 * mounted (static markup can't prove any of this). Same served-dist harness
 * as seats.spec.ts.
 */
import { expect, test } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

test.describe("computed layout (W-065 behaviour 15)", () => {
  let served: ServedInstance;

  test.afterEach(async () => {
    await served?.close();
  });

  async function openSeats(page: import("@playwright/test").Page): Promise<void> {
    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();
  }

  test("1280px: the rail is 220px, link text visible", async ({ page }) => {
    served = await startServed("layout-1280");
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSeats(page);
    const box = await page.locator(".sidebar").boundingBox();
    expect(box?.width).toBeCloseTo(220, 0);
    await expect(page.locator(".sidebar__link-text").first()).toBeVisible();
  });

  test("800px: the rail is 72px, labels present at 11px (not display:none)", async ({ page }) => {
    served = await startServed("layout-800");
    await page.setViewportSize({ width: 800, height: 900 });
    await openSeats(page);
    const box = await page.locator(".sidebar").boundingBox();
    expect(box?.width).toBeCloseTo(72, 0);
    const label = page.locator(".sidebar__link-text").first();
    await expect(label).toBeVisible();
    const fontSize = await label.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe("11px");
  });

  test("500px: the shell is a top row, labels still readable", async ({ page }) => {
    served = await startServed("layout-500");
    await page.setViewportSize({ width: 500, height: 900 });
    await openSeats(page);
    const sidebarBox = await page.locator(".sidebar").boundingBox();
    // A top row: wide (spans ~the viewport) and short, not a tall left rail.
    expect(sidebarBox?.width).toBeGreaterThan(400);
    expect(sidebarBox?.height).toBeLessThan(100);
    await expect(page.locator(".sidebar__link-text").first()).toBeVisible();
  });

  test("a focused model select has a visible focus indicator", async ({ page }) => {
    served = await startServed("layout-focus");
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSeats(page);
    const select = page.locator('select[aria-label="model for seat builder-1"]');
    await select.focus();
    const outline = await select.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outline: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
    });
    const hasFocusRing = (outline.outline !== "none" && outline.outlineWidth !== "0px") || outline.boxShadow !== "none";
    expect(hasFocusRing).toBe(true);
  });

  test("with the confirm bar open, the last roster row does not sit under it", async ({ page }) => {
    served = await startServed("layout-confirm-bar");
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSeats(page);
    const select = page.locator('select[aria-label="model for seat builder-1"]');
    await select.selectOption("claude-opus-5");
    await expect(page.locator(".seats__confirm-bar")).toBeVisible();

    // Scroll the main content area all the way down — the realistic "can the
    // Patron see the last row while the bar is open" case, not whatever
    // partial-visibility heuristic scrollIntoViewIfNeeded uses.
    await page.evaluate(() => {
      const main = document.querySelector(".shell__main");
      if (main) main.scrollTop = main.scrollHeight;
    });
    const lastRow = page.locator(".seats__card--roster .seats__row").last();
    const rowBox = await lastRow.boundingBox();
    const barBox = await page.locator(".seats__confirm-bar").boundingBox();
    expect(rowBox).toBeTruthy();
    expect(barBox).toBeTruthy();
    if (rowBox && barBox) {
      const rowBottom = rowBox.y + rowBox.height;
      // No vertical overlap: the row's bottom sits at or above the bar's top.
      expect(rowBottom).toBeLessThanOrEqual(barBox.y + 1);
    }
  });
});
