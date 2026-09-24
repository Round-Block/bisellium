/**
 * apps/web/src/lib/nav.ts — pure logic Sidebar uses (needsYouVisible).
 * `NAV_HEIGHT_PX` (the old top-bar's chrome-budget constant) is gone with
 * Nav.tsx — W-025 already migrated the shipped layout to Sidebar, which
 * never read it (W-065, ui-lead pass finding 8).
 */
export function needsYouVisible(count: number): boolean {
  return count > 0;
}
