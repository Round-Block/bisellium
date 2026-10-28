/**
 * apps/web/tests-serve/w442.spec.ts — W-442. The Officina today rule clears
 * the today column's weekday letter on every weekday at 1280 and 390. The
 * browser clock is pinned to each day of one week, and each letter is measured
 * once its web font has loaded, so the row depends neither on the day it runs
 * nor on font timing (W-406-b3 read the real clock and the box before the
 * font loaded, so it failed on Wednesdays whenever the font won the race).
 */
import { expect, test } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

/** One week, Sunday to Saturday: every weekday letter (S M T W T F S) is today once. */
export const W442_WEEK = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"] as const;
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;

let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-442-b1 Officina today rule clears every weekday letter at 1280 and 390", async ({ page }) => {
  test.setTimeout(120_000);
  for (const [index, day] of W442_WEEK.entries()) {
    for (const width of [1280, 390] as const) {
      const at = `${day} ${width}`;
      served = await startServed(`w442-${width}`);
      await page.clock.setFixedTime(new Date(`${day}T12:00:00.000Z`));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${served.baseURL}/#/officina`);
      await page.locator("#token-prompt-input").fill(served.token);
      await page.locator(".token-prompt__submit").click();
      await expect(page.locator(".token-prompt")).toBeHidden();
      await expect(page.locator(".officina")).toBeVisible();
      const rule = page.locator(".fasti-strip__today-rule");
      await expect(rule, `${at}: exactly one day is today`).toHaveCount(1);
      const column = rule.locator("xpath=..");
      const letter = column.locator(".fasti-strip__weekday");
      await expect(letter, `${at}: the pinned clock makes ${LETTERS[index]} today`).toHaveText(LETTERS[index]!);
      // The letter is measured in its repository font: a box taken before the web font loads is a fallback's.
      const faces = await letter.evaluate(async (el) => {
        const style = getComputedStyle(el);
        const loaded = await document.fonts.load(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`);
        await document.fonts.ready;
        return loaded.length;
      });
      expect(faces, `${at}: the weekday letter's repository font is loaded before it is measured`).toBeGreaterThan(0);
      const [columnBox, ruleBox, letterBox] = await Promise.all([column.boundingBox(), rule.boundingBox(), letter.boundingBox()]);
      expect(columnBox, `${at}: the today column has a box`).toBeTruthy();
      expect(ruleBox, `${at}: the today rule has a box`).toBeTruthy();
      expect(letterBox, `${at}: the weekday letter has a box`).toBeTruthy();
      expect(ruleBox!.height, `${at}: the today rule remains full-height`).toBeCloseTo(columnBox!.height, 0);
      const separated = ruleBox!.x >= letterBox!.x + letterBox!.width - 0.5 || ruleBox!.x + ruleBox!.width <= letterBox!.x + 0.5;
      expect(separated, `${at}: today rule and weekday letter do not overlap`).toBe(true);
      const onTop = await rule.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
      });
      expect(onTop, `${at}: the today rule is painted, not clipped or covered`).toBe(true);
      await served.close();
      served = undefined;
    }
  }
});
