/**
 * apps/web/src/lib/route.ts — pure hash-routing map behind App.tsx.
 * `/#/inbox` -> Inbox, `/#/officina` -> Officina, default -> Inbox.
 */
export type Route = "inbox" | "officina";

export function parseRoute(hash: string): Route {
  return hash.replace(/^#/, "") === "/officina" ? "officina" : "inbox";
}
