/**
 * apps/web/src/lib/route.ts — pure hash-routing map behind App.tsx. The map
 * is derived from nav.ts's NAV_ENTRIES (W-110): `/#/inbox` -> Inbox,
 * `/#/board` -> Board, `/#/board/W-451` -> Board with that drawer target,
 * `/#/seats` -> Seats, `/#/officina` -> Officina, default -> Inbox.
 */
import { NAV_ENTRIES } from "./nav.js";
import type { Route } from "./nav.js";

export type { Route } from "./nav.js";

const BY_PATH = new Map<string, Route>(NAV_ENTRIES.map((e) => [e.href.replace(/^#/, ""), e.route]));

export interface ParsedLocation {
  route: Route;
  boardOpusId?: string;
  boardPathError?: "malformed";
}

const OPUS_ID = /^W-\d+$/;

export function isBoardOpusId(id: string): boolean {
  return OPUS_ID.test(id);
}

export function canOpenBoardDrawer(id: string): boolean {
  return isBoardOpusId(id);
}

export function boardOpusHref(id: string): string {
  return `#/board/${encodeURIComponent(id)}`;
}

export function parseLocation(hash: string): ParsedLocation {
  const path = hash.replace(/^#/, "");
  if (path === "/board") return { route: "board" };
  if (path.startsWith("/board/")) {
    const encodedId = path.slice("/board/".length);
    let id: string;
    try {
      id = decodeURIComponent(encodedId);
    } catch {
      return { route: "board", boardPathError: "malformed" };
    }
    if (encodedId.length > 0 && !encodedId.includes("/") && isBoardOpusId(id))
      return { route: "board", boardOpusId: id };
    return { route: "board", boardPathError: "malformed" };
  }
  return { route: BY_PATH.get(path) ?? "inbox" };
}

export function parseRoute(hash: string): Route {
  return parseLocation(hash).route;
}
