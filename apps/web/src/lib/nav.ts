/**
 * apps/web/src/lib/nav.ts — pure logic Sidebar uses (needsYouVisible) and the
 * rail's one entry table (W-110): Sidebar renders from it, route.ts derives
 * its hash map from it, and the walk spec reads it. D-023 §1's order.
 * `NAV_HEIGHT_PX` (the old top-bar's chrome-budget constant) is gone with
 * Nav.tsx — W-025 already migrated the shipped layout to Sidebar, which
 * never read it (W-065, ui-lead pass finding 8).
 */
export const NAV_ENTRIES = [
  { route: "inbox", href: "#/inbox", label: "Inbox" },
  { route: "board", href: "#/board", label: "Board" },
  { route: "seats", href: "#/seats", label: "Seats" },
  { route: "officina", href: "#/officina", label: "Officina" },
] as const;
export type Route = (typeof NAV_ENTRIES)[number]["route"];

export function needsYouVisible(count: number): boolean {
  return count > 0;
}
