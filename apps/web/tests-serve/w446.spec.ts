/**
 * apps/web/tests-serve/w446.spec.ts — W-446. W-406-b1's track press failed
 * now and then at 1280 when it ran beside w442.spec.ts: the row set the columns'
 * scrollLeft to 0, saw it read 0, and pressed the track at three quarters of
 * its width, while the thumb was still painted at the right terminal (the cue
 * follows the columns from their `scroll` event, which the browser dispatches
 * with its next frame). At 1280 the thumb covers more than a quarter of the
 * track, so the press landed on the thumb, started a drag and left scrollLeft
 * at 0. This row forces that interleaving instead of waiting on the host's
 * timing: a fixture holds the cue's next scroll update for HOLD_FRAMES
 * animation frames, and the row presses the track as W-406-b1 does, after
 * the shared `scrollBoardToLeftTerminal`.
 */
import { expect, test } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";
import { scrollBoardToLeftTerminal } from "./board-cue.js";

/** How many animation frames the fixture holds the cue's scroll update: longer than a press takes, well inside a poll's timeout. */
const HOLD_FRAMES = 30;

let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-446-b1 a Board track press after a scroll to the left terminal jumps to its centred offset when the cue repaints late", async ({ page }) => {
  served = await startServed("w446-board-1280");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/#/board`);
  await page.locator("#token-prompt-input").fill(served.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
  await expect(page.locator(".board")).toBeVisible();
  await expect.poll(() => page.locator(".board__column").count(), "1280: the served Board has every phase").toBeGreaterThan(1);
  const columns = page.locator(".board__columns");
  const cue = page.locator(".board__scroll-cue");
  const thumb = cue.locator(".board__scroll-cue-thumb");
  await expect(thumb, "1280: the scroll thumb is painted").toBeVisible();

  // The state W-406-b1 leaves before its track press: the columns and the painted thumb at the right terminal.
  const maxScroll = await columns.evaluate((node) => {
    const element = node as HTMLElement;
    element.style.scrollSnapType = "none";
    element.scrollLeft = element.scrollWidth - element.clientWidth;
    return element.scrollWidth - element.clientWidth;
  });
  expect(maxScroll, "1280: the phases overflow into a horizontal scroll range").toBeGreaterThan(0);
  await expect.poll(async () => {
    const [track, box] = await Promise.all([cue.boundingBox(), thumb.boundingBox()]);
    return track !== null && box !== null ? Math.abs(track.x + track.width - box.x - box.width) : Number.POSITIVE_INFINITY;
  }, "1280: the painted thumb starts at the right terminal").toBeLessThanOrEqual(1);
  const [track, terminalThumb] = await Promise.all([cue.boundingBox(), thumb.boundingBox()]);
  expect(track, "1280: the track has a rendered box").toBeTruthy();
  expect(terminalThumb, "1280: the thumb has a rendered box").toBeTruthy();
  const trackPressX = track!.x + track!.width * 0.75;
  const pressY = track!.y + track!.height / 2;
  expect(terminalThumb!.x, "1280: the right-terminal thumb covers the track press point").toBeLessThan(trackPressX);

  // The fixture: the cue's next scroll update reaches it HOLD_FRAMES frames late, as when a press beats the next frame.
  await columns.evaluate((node, hold) => {
    const record = window as unknown as { w446Held?: number };
    record.w446Held = 0;
    node.addEventListener("scroll", (event) => {
      event.stopImmediatePropagation();
      record.w446Held = (record.w446Held ?? 0) + 1;
      let frames = hold;
      const release = (): void => {
        frames -= 1;
        if (frames > 0) requestAnimationFrame(release);
        else node.dispatchEvent(new Event("scroll"));
      };
      requestAnimationFrame(release);
    }, { capture: true, once: true });
  }, HOLD_FRAMES);

  await scrollBoardToLeftTerminal(columns, cue, thumb, "1280: track press");
  await page.mouse.click(trackPressX, pressY);
  const availableTrack = track!.width - terminalThumb!.width;
  const expectedTrackScroll = Math.min(maxScroll, Math.max(0, (trackPressX - track!.x - terminalThumb!.width / 2) * maxScroll / availableTrack));
  await expect.poll(async () => Math.abs(await columns.evaluate((node) => (node as HTMLElement).scrollLeft) - expectedTrackScroll), "1280: track press jumps to its centred proportional offset").toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (window as unknown as { w446Held?: number }).w446Held), "1280: the fixture held the cue's scroll update once").toBe(1);
});
