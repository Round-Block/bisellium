/**
 * apps/web/tests-serve/board-cue.ts — W-446. Not a spec itself: the served
 * Board's scroll-cue steps that W-406-b1 and W-446-b1 share.
 */
import { expect, type Locator } from "@playwright/test";

/** Scrolls the Board's columns to the left terminal before a cue gesture and
 *  waits until both halves of the cue's state show it: the columns read
 *  scrollLeft 0, and the painted thumb stands at the track's left edge.
 *  W-446: the thumb follows the columns from their `scroll` event, which the
 *  browser dispatches with its next frame, not when scrollLeft is set; a
 *  pointer pressed before that frame hit-tests the thumb where it was still
 *  painted. Pressing only once the painted thumb is at the terminal removes
 *  that race from W-406-b1 (its track press, at 1280, landed on a thumb still
 *  painted at the right terminal and started a drag instead of a jump). */
export async function scrollBoardToLeftTerminal(columns: Locator, cue: Locator, thumb: Locator, gesture: string): Promise<void> {
  await columns.evaluate((node) => {
    (node as HTMLElement).scrollLeft = 0;
  });
  await expect.poll(() => columns.evaluate((node) => (node as HTMLElement).scrollLeft), `${gesture} starts at the left terminal`).toBe(0);
  await expect.poll(async () => {
    const [track, box] = await Promise.all([cue.boundingBox(), thumb.boundingBox()]);
    return track !== null && box !== null ? Math.abs(box.x - track.x) : Number.POSITIVE_INFINITY;
  }, `${gesture} starts with the painted thumb at the left terminal`).toBeLessThanOrEqual(1);
}
