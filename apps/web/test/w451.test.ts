import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as routeModule from "../src/lib/route.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

type BoardLocation = { route: string; boardOpusId?: string; boardPathError?: "malformed" };
type RouteModule = {
  parseLocation?: (hash: string) => BoardLocation;
  boardOpusHref?: (id: string) => string;
  isBoardOpusId?: (id: string) => boolean;
  canOpenBoardDrawer?: (id: string) => boolean;
};

test("W-451-b1 behaviour 1: Board work links are durable drawer routes", () => {
  const routes = routeModule as RouteModule;
  assert.equal(typeof routes.parseLocation, "function", "the hash router exposes a Board drawer target");
  assert.equal(typeof routes.boardOpusHref, "function", "one encoder owns every Board work-item href");
  assert.equal(typeof routes.isBoardOpusId, "function", "one native-id classifier guards Board card activation");
  assert.equal(typeof routes.canOpenBoardDrawer, "function", "one pure guard decides whether a card may open the drawer");

  assert.deepEqual(routes.parseLocation!("#/board"), { route: "board" }, "bare Board stays the closed Board");
  assert.deepEqual(routes.parseLocation!("#/board/W-451"), { route: "board", boardOpusId: "W-451" }, "a valid opus id selects its drawer");
  assert.deepEqual(routes.parseLocation!("#/board/W-999"), { route: "board", boardOpusId: "W-999" }, "a syntactically valid unknown id reaches the honest not-found state");
  for (const hash of ["#/board/not-an-opus", "#/board/W-451/", "#/board/W-451/files", "#/board/%"])
    assert.deepEqual(routes.parseLocation!(hash), { route: "board", boardPathError: "malformed" }, `${hash} is a malformed Board target, never a different screen`);
  assert.equal(routes.boardOpusHref!("W-451"), "#/board/W-451", "the canonical work-item href is copyable");
  assert.equal(routes.isBoardOpusId!("W-451"), true, "a decimal W id can open a Board drawer");
  for (const id of ["not-an-opus", "w-451", "W-x", "W-451/files"])
    assert.equal(routes.isBoardOpusId!(id), false, `${id} cannot open a Board drawer`);
  assert.equal(routes.canOpenBoardDrawer!("not-an-opus"), false, "a non-native card opens no drawer");

  const app = read("apps/web/src/App.tsx");
  const board = read("apps/web/src/screens/Board.tsx");
  const inboxView = read("apps/web/src/screens/InboxView.tsx");
  assert.match(app, /parseLocation\(hash\)/, "App renders the drawer target from the current hash");
  assert.match(board, /Work item .* was not found\./, "an unknown id receives an honest answer instead of a blank drawer");
  assert.match(board, /if \(opera\.some\(\(entry\) => entry\.id === sel\.id\)\) return;/, "a returned route target stays open whether placed, unplaced or filtered");
  assert.match(board, /if \(!canOpenBoardDrawer\(id\)\) \{\s*if \(publishRoute\) onDrawerRouteOpen\?\.\(id\);\s*return;\s*\}[\s\S]*setSelected\(selection\)/, "a non-native card publishes the malformed route for the invalid notice before drawer selection");
  assert.match(inboxView, /href=\{boardOpusHref\(/, "Inbox work-item actions are real shareable links");
  assert.match(inboxView, /event\.button === 0 && !event\.metaKey && !event\.ctrlKey && !event\.shiftKey && !event\.altKey/, "only an ordinary primary activation routes the current tab");
  assert.match(inboxView, /onClick=\{\(event\) => \{\s*if \(!ownsBoardLinkActivation\(event\)\) return;/, "modified and non-primary link clicks retain native browser behavior");
});

test("W-451-b2 behaviour 2: the narrow menu opens on the current page", () => {
  const sidebar = read("apps/web/src/components/Sidebar.tsx");
  const served = read("apps/web/tests-serve/w415.spec.ts");
  assert.match(sidebar, /querySelector<HTMLAnchorElement>\('\.sidebar__link\[aria-current="page"\]'\)\?\.focus/, "opening focuses the active link identified by aria-current");
  assert.doesNotMatch(sidebar, /querySelector<HTMLAnchorElement>\("\.sidebar__link"\)\?\.focus/, "opening never falls back to the first page");
  assert.match(served, /for \(const route of ROUTES\)[\s\S]*current page receives focus/, "the existing W-415 row checks every current page at both narrow widths");
});
