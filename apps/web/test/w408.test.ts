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

test("W-408-b3 behaviour 3: Budget pairs an accessible pie with numerals and posture", () => {
  assert.match(screen, /<h2 className="officina__panel-heading">Budget<\/h2>[^]*Current token budget by collegium\./, "Budget is one word and its unit names collegia");
  assert.match(burn, /BUDGET_APPROACHING_FRACTION = 0\.8/, "the approaching threshold is one Patron-changeable constant");
  assert.match(burn, /spent > allowance/, "exactly at allowance remains distinct from past allowance");
  assert.match(burn, /overBy:\s*Math\.max\(spent - allowance, 0\)/, "the overage is a fail-closed numeric fact");
  assert.match(burn, /state === "over" \? "blocking" : state === "normal" \? "normal" : "high"/, "Budget reuses the shared normal, high and blocking severity levels");
  assert.match(burnBar, /budget-meter__pie[^]*--budget-fraction[^]*aria-hidden="true"/, "each collegium has one decorative pie backed by text");
  assert.match(burnBar, /severity-cue severity-cue--\$\{measure\.severity\}[^]*data-budget-state=\{measure\.state\}[^]*budget-meter__numerals/, "the shared shape cue sits beside the numerals");
  assert.match(burnBar, /budget-meter__numerals[^]*aria-label=\{`\$\{stateLabel\}: \$\{measure\.spent\.toLocaleString\(\)\} tokens spent of \$\{measure\.allowance\.toLocaleString\(\)\} allowance`\}/, "visible mono numerals name the accessible fraction and state");
  assert.match(burnBar, /\+\{measure\.overBy\.toLocaleString\(\)\} over/, "past allowance gains the exact +N over label");
  assert.match(css, /\.budget-meter__pie\s*{[^}]*border-radius:\s*50%[^}]*conic-gradient\(var\(--budget-state-color\) 0 var\(--budget-fraction\), var\(--rule\)/s, "the pie is palette spent versus muted remaining allowance");
  assert.match(css, /budget-meter--normal[^}]*ink-3[^]*budget-meter--approaching[^}]*budget-meter--spent[^}]*severity-high[^]*budget-meter--over[^}]*severity-blocking/s, "normal, approaching/spent and over use neutral ink, Orange and Red");
  assert.match(css, /@media \(width <= 700px\)[^]*\.budget-meter__reading\s*{[^}]*grid-column:\s*1 \/ -1[^}]*grid-row:\s*3/s, "zoom and phone widths reserve a full ruled line for complete Budget numerals");
  assert.doesNotMatch(css, /\.budget-meter__pie\s*{[^}]*var\(--ink\)/s, "Budget pies never use white ink as their spent colour");
  assert.doesNotMatch(css, /burn-bar__rail|budget-meter__rail/, "the superseded 4px burn rule is gone");
  assert.match(direction, /Budget pies reuse the shared\s+severity palette[^]*No\s+white pie/, "DIRECTION records the dated palette ruling");
  assert.match(served, /Budget pies normal, approaching, spent and over allowance/, "served widths pin palette pies, shapes, numerals, overage and posture");
});

test("W-408-b4 behaviour 4: Health is two detailed disclosures with one verdigris brake", () => {
  assert.match(screen, /Current lex and process detail\./, "Health names its detail unit");
  assert.match(screen, /<details className="officina__health-row panel--lex">/, "lex status is a disclosure");
  assert.match(screen, /<details className="officina__health-row panel--process">/, "process health is a disclosure");
  assert.doesNotMatch(screen, /healthStamp|officina__as-of|Last tick/, "generated and as-of stamps are absent");
  assert.match(css, /\.officina__health-row > summary\s*{[^}]*font-size:\s*13px[^}]*font-weight:\s*400/s, "health summaries use the page row type");
  assert.match(css, /\.officina__health-row > summary::before\s*{[^}]*content:\s*"\\25B8"[^}]*}[^]*\.officina__health-row\[open\] > summary::before\s*{[^}]*content:\s*"\\25BE"/s, "health summaries show changing disclosure indicators");
  assert.match(tokens, /--severity-blocking:\s*var\(--bad\)[^]*--severity-high:\s*var\(--amber\)[^]*--severity-low:\s*#6272a4/s, "Health and W-427 share one severity token set");
  assert.match(screen, /SeverityCue level="blocking"[^]*SeverityCue level="high"[^]*level=\{loadedHealth\.due\.length > 0 \? "low" : "normal"\}/, "block, advisory/high, due/low and normal all map explicitly");
  assert.match(screen, /Severity is available only in aggregate\.[^]*officina__rule-family[^]*<span>\{row\.label\}<\/span>/, "unclassified rule families carry no invented severity cue");
  assert.match(css, /severity-cue--blocking[^]*severity-blocking[^]*severity-cue--high[^]*severity-high[^]*severity-cue--normal[^]*border-radius:\s*50%[^]*severity-cue--low[^]*severity-low[^]*clip-path/s, "every severity colour has a distinct shape cue");
  assert.match(screen, /New pieces of work do not start; work already running carries on\./, "Process health explains the brake in one line");
  assert.match(screen, /Resume new work[^]*Stop new work/, "the brake labels state their effect");
  assert.match(css, /\.officina__brake\s*{[^}]*background:\s*var\(--verdigris\)/s, "the brake is the verdigris fill");
  assert.match(served, /health detail discloses its rows and brake/, "served Chromium pins disclosure and write behavior");
});

test("W-408-b5 behaviour 5: one W-407 visible-refresh helper keeps Officina detail current", () => {
  assert.match(screen, /import \{ useVisibleRefresh \} from "\.\.\/lib\/useVisibleRefresh\.js"/, "Officina imports W-407's shared refresh helper");
  assert.match(screen, /useVisibleRefresh\(refresh\)/, "Officina consumes the shared helper");
  const forbiddenRefreshApis = new RegExp(["set" + "Interval", "set" + "Timeout", "addEventListener\\(", "visibilitychange"].join("|"));
  assert.doesNotMatch(screen, forbiddenRefreshApis, "the screen owns no refresh listener or timer");
  assert.doesNotMatch(screen, /fetchInbox|datePresentation/, "the detail refresh owns no Home or Inbox summary read");
  assert.match(served, /visible interval and focus refresh detail reads/, "served Chromium pins refreshed content without reload");
});
