import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

test("W-415-b1 behaviour 1: D-119's icon rail carries D-120's sole Inbox notification dot", () => {
  const app = read("apps/web/src/App.tsx"), sidebar = read("apps/web/src/components/Sidebar.tsx"), css = read("apps/web/src/components/w025.css"), served = read("apps/web/tests-serve/w415.spec.ts");
  assert.match(app, /min-width: 960px/, "the shell owns D-119's wide boundary");
  assert.match(sidebar, /aria-label=\{collapsed \? "Expand sidebar" : "Collapse sidebar"\}/, "toggle has D-119's exact state names");
  assert.match(sidebar, /name="panel"/, "same panel icon renders in both states");
  assert.match(css, /shell--sidebar-collapsed[\s\S]*--sidebar-width:\s*48px/, "wide collapse leaves a 48px rail");
  assert.match(css, /\.sidebar\s*\{[^}]*padding:\s*8px 6px 16px/s, "wide toggle keeps one horizontal coordinate");
  assert.match(served, /1280 and 960/, "served row pins both wide widths");
  assert.match(served, /press\("Enter"\)[\s\S]*press\("Space"\)/, "native toggle is pinned by keyboard");
  assert.match(sidebar, /type IconName = "panel" \| "inbox" \| "board" \| "seats" \| "officina"/, "console owns five inline icons");
  assert.match(sidebar, /<svg[\s\S]*stroke="currentColor"[\s\S]*strokeWidth="1\.5"/, "icons share one monochrome stroke style");
  assert.match(sidebar, /title=\{collapsed \? e\.label/, "collapsed links have tooltips");
  assert.match(sidebar, /aria-current=\{active \? "page"/, "current screen is marked");
  assert.match(sidebar, /role="img" aria-label=\{`Inbox, \$\{needsYouCount\} needs you`\}/, "Inbox count is a labelled badge");
  assert.match(sidebar, /collapsed && needsYouCount > 9 \? "9\+" : needsYouCount/, "D-120 caps only the visible collapsed dot at 9+");
  assert.match(sidebar, /collapsed && "sidebar__badge--dot"/, "only collapsed navigation receives the D-120 dot form");
  assert.match(css, /\.sidebar__badge--dot\s*\{[^}]*position:\s*absolute;[^}]*top:\s*1px;[^}]*right:\s*1px;[^}]*width:\s*16px;[^}]*height:\s*16px;/s, "the dot is bounded at the icon's top-right");
  assert.match(css, /\.sidebar__badge--dot\s*\{[^}]*font-size:\s*11px;[^}]*line-height:\s*14px;/s, "D-120 dot uses the ruled micro-count typography");
  assert.match(served, /toggle retains identical viewport coordinates/, "served rows pin the toggle's fixed position");
  assert.match(served, /expanded Inbox keeps its full uncapped count/, "served evidence preserves D-120's expanded exception");
  assert.match(served, /zero Inbox count removes the collapsed notification dot/, "served evidence pins the zero case");
});

test("W-415-b2 behaviour 2: screens reflow without unnamed page overflow", () => {
  const board = read("apps/web/src/screens/Board.tsx"), css = read("apps/web/src/components/w025.css"), served = read("apps/web/tests-serve/w415.spec.ts");
  assert.doesNotMatch(css, /100vw/, "screen internals avoid viewport-unit width assumptions");
  assert.equal((board.match(/matchMedia\?\.\("\(max-width: 612px\)"\)/g) ?? []).length, 2, "Board initial logic keeps 612");
  assert.equal((board.match(/matchMedia\("\(max-width: 612px\)"\)/g) ?? []).length, 1, "Board resize logic keeps 612");
  assert.match(served, /640 CSS-pixel zoom viewport/, "served row pins 200% equivalent width");
  assert.match(served, /sole horizontal scroller/, "Board phase strip is the named exception");
  assert.match(css, /@media \(max-width: 599px\)/, "existing shell content breakpoint remains 599");
  assert.match(css, /@media \(max-width: 612px\)/, "existing Board boundary remains 612");
  assert.match(served, /Officina text, counts and row labels stay in main pane/, "Officina containment is pinned");
  assert.match(css, /@media \(max-width: 959px\)[\s\S]*--sidebar-width:\s*0px/, "narrow shell resets the fixed-bar offset");
  assert.match(css, /\.inbox__subject\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s, "Inbox subjects retain one-line containment");
  assert.match(css, /@media \(min-width: 613px\) and \(max-width: 640px\)\s*\{\s*\.board__liveness/, "Board liveness wraps at the 640 zoom width");
});
