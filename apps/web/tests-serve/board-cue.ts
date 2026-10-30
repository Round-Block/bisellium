/**
 * apps/web/tests-serve/board-cue.ts — W-446. Not a spec itself: the served
 * Board's scroll-cue steps that W-406-b1 and W-446-b1 share.
 */
import { expect, type Locator } from "@playwright/test";

/** Scrolls the Board's columns to the left terminal before a cue gesture, as
 *  W-406-b1 did: it waits until the columns read scrollLeft 0. */
export async function scrollBoardToLeftTerminal(columns: Locator, cue: Locator, thumb: Locator, gesture: string): Promise<void> {
  void cue;
  void thumb;
  await columns.evaluate((node) => {
    (node as HTMLElement).scrollLeft = 0;
  });
  await expect.poll(() => columns.evaluate((node) => (node as HTMLElement).scrollLeft), `${gesture} starts at the left terminal`).toBe(0);
}
