/** W-442's fasti marker row is retired by W-408's approved fasti removal. */
import { expect, test } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-442-b1 retired: Officina omits the fasti today rule at 1280 and 390", async ({ page }) => {
  for (const width of [1280, 390] as const) {
    served = await startServed(`w442-retired-${width}`);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/#/officina`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();
    await expect(page.locator(".officina__panel-heading")).toHaveText(["Work in flight", "Budget", "Health"]);
    await expect(page.locator(".fasti-strip, .fasti-strip__today-rule"), `${width}: the retired timeline has no marker`).toHaveCount(0);
    await served.close();
    served = undefined;
  }
});
