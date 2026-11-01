import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../src/screens/BoardView.tsx", import.meta.url), "utf8");
const board = readFileSync(new URL("../src/screens/Board.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../src/screens/BoardDrawer.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/w025.css", import.meta.url), "utf8");
const served = readFileSync(new URL("../tests-serve/w411.spec.ts", import.meta.url), "utf8");

test("W-411-b1 behaviour 1: the Board header contains product facts, not implementation prose", () => {
  assert.doesNotMatch(view, /one officina per serve process|no project registry exists/i, "the implementation explanation is absent from the Board header");
  assert.doesNotMatch(view, /board__project-select-reason/, "the header has no implementation-reason node");
  assert.match(served, /header omits implementation prose at 1280, 640 and 390/, "the served row pins all ruled widths");
});

test("W-411-b2 behaviour 2: phone phase navigation names the phase in view", () => {
  assert.match(view, /function PhaseNavigation/, "one component owns the phone phase strip");
  assert.match(view, /aria-current=\{column\.id === currentColumnId \? "true" : undefined\}/, "the visible phase is exposed on its strip button");
  assert.match(view, /addEventListener\("scroll", updateCurrentColumn/, "swipe and programmatic phase moves update the strip");
  assert.match(css, /\.board__strip-item\[aria-current="true"\]\s*\{[^}]*border-color:\s*var\(--ink\)[^}]*background:\s*var\(--rule\)/s, "the current phone phase has a visible neutral state");
  assert.match(served, /phase navigation reaches and names every ruled-width phase/, "the served row pins all ruled widths");
});

test("W-411-b3 behaviour 3: item detail keeps its close path in view", () => {
  assert.match(css, /\.board-drawer__close\s*\{[^}]*position:\s*fixed[^}]*background:\s*var\(--surface\)/s, "the Close control stays pinned at every ruled width");
  assert.doesNotMatch(css, /\.board-drawer__header\s*\{[^}]*position:\s*sticky/s, "the complete detail header scrolls with its content");
  assert.match(drawer, /board-drawer__close/, "the existing close control remains in the drawer");
  assert.match(served, /item detail remains readable and closable at 1280, 640 and 390/, "the served row pins all ruled widths");
});

test.skip("W-411-b4 behaviour 4: return restores selection, exact focus origin and both Board scrolls", () => {
  assert.match(board, /origin:\s*"card"\s*\|\s*"waiting"/, "a selection records which visible copy opened detail");
  assert.match(board, /waitingScrollLeft/, "the waiting rail scroll is snapshotted with the phase track");
  assert.match(board, /lastSelectedId/, "selection outlives the open drawer");
  assert.match(view, /onSelect\(card\.id, columnId, "card"\)/, "a lifecycle card identifies itself as the focus origin");
  assert.match(view, /onSelectCard\(card\.id, columnId \?\? "unplaced", "waiting"\)/, "a waiting entry identifies itself as the focus origin");
  assert.match(css, /\.board__card\[aria-selected="true"\]/, "returned selection has a visible state");
  assert.match(served, /return restores selection, exact focus and both scroll offsets at 1280, 640 and 390/, "the served row pins all ruled widths");
});
