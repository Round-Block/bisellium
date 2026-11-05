process.env["NODE_ENV"] = "test";

import { expect, test } from "@playwright/test";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-503-b1 Home is the default route and first shared navigation entry at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w503-b1");
  await seedToken(page, served);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w503=b1-${width}`);
    await expect(page.getByRole("heading", { name: "Home", exact: true }), `${width}: bare entry opens Home`).toBeVisible();
    await expect(page.locator(".sidebar__link").first(), `${width}: Home is first in shared navigation`).toHaveAttribute("href", "#/home");
    await expect(page.locator('.sidebar__link[href="#/home"]'), `${width}: Home is the current page`).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: Home does not overflow horizontally`).toBeLessThanOrEqual(0);
  }
  await page.goto(`${served.baseURL}/?w503=b1-unknown#/not-a-screen`);
  await expect(page.getByRole("heading", { name: "Home", exact: true }), "an unknown hash falls back to Home").toBeVisible();
});
