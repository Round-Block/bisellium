import { expect, test } from "@playwright/test";
import { CAPTURE_NOW, expectCapturedScreenSettled, freezeCaptureClock } from "./capture-state.js";
import { startServed, type ServedInstance } from "./harness.js";

let served: ServedInstance | undefined;
test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-360-b1 the capture clock fixes browser-owned dates at the ruled instant", async ({ page }) => {
  await freezeCaptureClock(page);
  expect(await page.evaluate(() => new Date().toISOString()), "the browser wall clock is fixed before a screen loads").toBe(CAPTURE_NOW);
});
