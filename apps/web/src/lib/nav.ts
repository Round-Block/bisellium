/**
 * apps/web/src/lib/nav.ts — pure constants/logic behind Nav
 * (DIRECTION.md §3 chrome budget: nav <= 44px).
 */
export const NAV_HEIGHT_PX = 44;

export function needsYouVisible(count: number): boolean {
  return count > 0;
}
