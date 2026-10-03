/**
 * apps/web/src/lib/route.ts — pure hash-routing map behind App.tsx. The map
 * is derived from nav.ts's NAV_ENTRIES (W-110): `/#/inbox` -> Inbox,
 * `/#/board` -> Board, `/#/seats` -> Seats, `/#/officina` -> Officina,
 * default -> Inbox.
 */
import { NAV_ENTRIES } from "./nav.js";
import type { Route } from "./nav.js";

export type { Route } from "./nav.js";

const BY_PATH = new Map<string, Route>(NAV_ENTRIES.map((e) => [e.href.replace(/^#/, ""), e.route]));

export function parseRoute(hash: string): Route {
  return BY_PATH.get(hash.replace(/^#/, "")) ?? "inbox";
}
