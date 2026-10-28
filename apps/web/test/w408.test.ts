/** W-408 Officina-detail policy rows; served geometry lives in tests-serve/w408.spec.ts. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => {
  try { return readFileSync(resolve(HERE, "..", path), "utf8"); }
  catch { return ""; }
};
const screen = read("src/screens/Officina.tsx");
const nav = read("src/lib/nav.ts");
const route = read("src/lib/route.ts");
const work = read("src/lib/officinaWork.ts");
const css = read("src/components/w025.css");
const tokens = read("src/tokens.css");
const burn = read("src/lib/burn.ts");
const burnBar = read("src/components/BurnBar.tsx");
const direction = read("../../docs/design/DIRECTION.md");
const served = read("tests-serve/w408.spec.ts");
const w406Policy = read("test/w406.test.ts");
const w442Served = read("tests-serve/w442.spec.ts");
const screenshotServed = read("tests-serve/screenshots.spec.ts");
const smoke = read("tests/smoke.spec.ts");

test("W-408-b1 behaviour 1: Officina is a three-section detail ledger with one shell scrollbar", () => {
  assert.match(nav, /NAV_ENTRIES\s*=\s*\[\s*\{ route: "inbox"[^]*\{ route: "officina"/, "master's Inbox-first navigation order is restored");
  assert.match(route, /\?\? "inbox"/, "master's absent or unknown route returns to Inbox");
  assert.doesNotMatch(screen, /fetchInbox|InboxResponse|datePresentation|petitiones|panel--needs-you|Needs you|FastiStrip|fetchActa|fasti-strip/, "Home and fasti summaries are absent from Officina");
  assert.match(screen, /Work in flight[^]*Health/, "Officina detail begins with work and ends with health");
  assert.match(css, /\.shell__main:has\(> \.officina\)\s*{[^}]*overflow-y:\s*scroll[^}]*scrollbar-gutter:\s*stable/s, "the detail page keeps the one always-allocated shell scrollbar");
  const nestedOfficinaScroller = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selectors = "", body = ""]) => selectors.split(",").some((selector) => selector.trim().startsWith(".officina")) && /overflow-y:\s*(?:auto|scroll)/.test(body));
  assert.equal(nestedOfficinaScroller, false, "the detail page adds no nested vertical scroller");
  assert.match(served, /detail frame and sole scrollbar/, "served Chromium pins the Officina frame");
  assert.match(w406Policy, /W-408 removes the non-actionable Officina fasti/, "W-406 policy names the approved predecessor flip");
  assert.match(w442Served, /W-442-b1 retired: Officina omits the fasti today rule/, "W-442's obsolete today-rule row is retired");
  assert.match(screenshotServed, /officina__panel-heading[^]*Work in flight[^]*Budget[^]*Health[^]*officina__budget-row[^]*officina__health-row/, "screenshot readiness waits for the three-section detail");
  assert.match(smoke, /three-section detail without fasti strip[^]*officina__panel-heading[^]*fasti-strip[^]*toHaveCount\(0\)/, "the non-CI smoke row follows the approved detail screen");
});

test("W-408-b2 behaviour 2: detailed work in flight groups active opera by lifecycle phase and names the mover", () => {
  assert.match(screen, /officinaWorkGroups\(boardModel\(officina, opera\)\)/, "Officina reuses the Board read and model");
  assert.match(work, /\["review", "building", "blocked"\]/, "the operational groups keep ruled order without a Patron summary");
  assert.match(work, /column\.id === "needs_you" \|\| column\.id === "planned" \|\| column\.id === "done"/, "summary and terminal Board columns are not detail groups");
  assert.match(work, /seen\.has\(card\.id\)/, "an opus cannot appear twice");
  assert.match(screen, /Active opera grouped by lifecycle phase; each row names who moves next\./, "the subtitle matches lifecycle grouping and retains the mover field");
  assert.doesNotMatch(work, /card\.blocked \|\| column\.id === "halted"/, "a failed gate cannot silently replace the lifecycle phase");
  assert.match(work, /card\.sella \? `\$\{card\.sella} next`/, "a row without a pending gate still names its assigned next mover");
  assert.match(css, /\.officina__work-groups\s*{[^}]*flex-direction:\s*column/s, "next-mover groups stack at every width");
  assert.match(css, /\.officina__row\.officina__work-row\s*{[^}]*display:\s*grid/s, "each group uses left-aligned ruled rows");
  assert.match(css, /\.officina__work-row > \.officina__value-mono\s*{[^}]*white-space:\s*nowrap/s, "opus ids never wrap");
  assert.doesNotMatch(screen, /row\.state/, "a row does not repeat its group state");
  assert.match(screen, /row\.note && <span className="officina__work-note">/, "a distinct Board gate label may earn a row field");
  assert.match(served, /detailed work-in-flight groups/, "served Chromium pins grouped rows");
});
