/**
 * apps/web/src/lib/route.ts — pure hash-routing map behind App.tsx.
 * `/#/inbox` -> Inbox, `/#/board` -> Board (W-064, disabled), `/#/seats` ->
 * Seats (W-065), `/#/officina` -> Officina, default -> Inbox.
 */
export type Route = "inbox" | "board" | "seats" | "officina";

const ROUTES: Record<string, Route> = {
  "/inbox": "inbox",
  "/board": "board",
  "/seats": "seats",
  "/officina": "officina",
};

export function parseRoute(hash: string): Route {
  return ROUTES[hash.replace(/^#/, "")] ?? "inbox";
}
