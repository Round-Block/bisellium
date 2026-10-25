import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

test("W-406-b1 behaviour 1: every Board phase is visibly reachable at desktop and phone widths", () => {
  const board = read("apps/web/src/screens/Board.tsx");
  const view = read("apps/web/src/screens/BoardView.tsx");
  const css = read("apps/web/src/components/w025.css");
  const served = read("apps/web/tests-serve/w406.spec.ts");
  const pkg = JSON.parse(read("apps/web/package.json")) as { scripts?: Record<string, string> };

  assert.match(css, /\.board__columns\s*\{[^}]*scrollbar-gutter:\s*stable;/s, "the Board columns keep a stable inline scrollbar gutter");
  assert.doesNotMatch(css, /\.board__columns\s*\{[^}]*scrollbar-color\s*:/s, "the standard colour property does not override Chromium's ruled scrollbar");
  assert.match(css, /\.board__columns::\-webkit-scrollbar\s*\{[^}]*height:\s*8px;/s, "Chromium receives an 8px horizontal scrollbar");
  assert.match(css, /\.board__columns::\-webkit-scrollbar-track\s*\{[^}]*background:\s*var\(--surface\);/s, "the scrollbar track uses the ruled surface token");
  assert.match(css, /\.board__columns::\-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--ink-3\);[^}]*border-radius:\s*0;/s, "the square scrollbar thumb uses the ruled ink token");
  assert.match(view, /className="board__scroll-cue"[^>]*aria-hidden="true"/, "Board paints a synchronized horizontal-scroll cue: decorative cue semantics");
  assert.match(view, /className="board__scroll-cue-thumb"/, "BoardView renders the cue thumb");
  assert.match(css, /\.board__scroll-cue\s*\{[^}]*height:\s*8px;[^}]*background:\s*var\(--rule\);[^}]*pointer-events:\s*none;/s, "Board paints a synchronized horizontal-scroll cue: 8px square ruled track");
  assert.match(css, /\.board__scroll-cue-thumb\s*\{[^}]*width:\s*var\(--board-scroll-thumb-width\);[^}]*height:\s*100%;[^}]*background:\s*var\(--ink-3\);[^}]*border-radius:\s*0;[^}]*transform:\s*translateX\(var\(--board-scroll-thumb-offset\)\);/s, "the Board paints a square ink thumb at the synchronized geometry");
  assert.match(board, /new ResizeObserver\(updateScrollCue\)/, "the cue remeasures when its rendered width changes");
  assert.match(board, /columns\.addEventListener\("scroll", updateScrollCue,/, "the cue follows the existing scroll container");
  assert.match(board, /trackWidth \* columns\.clientWidth \/ columns\.scrollWidth/, "thumb width is proportional to the visible Board fraction");
  assert.match(board, /columns\.scrollWidth\s*-\s*columns\.clientWidth/, "the cue range is the container's maximum scrollLeft");
  assert.match(board, /Number\.isFinite\(trackWidth\)[\s\S]*?maxScroll > 0/, "the cue hides for non-finite or zero scroll ranges");
  assert.match(board, /Math\.min\(maxScroll, Math\.max\(0, columns\.scrollLeft\)\)/, "the cue clamps its source scroll position to the container range");
  assert.match(board, /Math\.min\(availableTrack, Math\.max\(0, availableTrack \* scrollLeft \/ maxScroll\)\)/, "Board paints a synchronized horizontal-scroll cue: proportional offset follows existing scroll position");
  assert.match(served, /W-406-b1 Board exposes and reaches its terminal phase at 1280 and 390/, "the served row names both ruled widths");
  assert.match(served, /thumbPixel\.equals\(trackPixel\)/, "the served row compares rendered track and thumb pixels before scrolling");
  assert.match(served, /initial thumb width matches the visible scroll fraction/, "the served row pins proportional cue geometry before scrolling");
  assert.match(served, /scrollWidth\s*-\s*element\.clientWidth/, "the served row computes the container's terminal horizontal offset");
  assert.match(served, /terminal thumb reaches the track right edge/, "the served row pins the synchronized terminal cue position");
  assert.match(served, /terminal phase right edge/, "the served row measures the final column against its scroll container");
  assert.match(pkg.scripts?.["test:policy"] ?? "", /test\/w406\.test\.ts/, "the focused policy runner includes W-406");
});

test("W-406-b2 behaviour 2: Board keeps liveness in its header and ends with one inset colophon", () => {
  const board = read("apps/web/src/screens/Board.tsx");
  const view = read("apps/web/src/screens/BoardView.tsx");
  const boardLib = read("apps/web/src/lib/board.ts");
  const css = read("apps/web/src/components/w025.css");
  const served = read("apps/web/tests-serve/w406.spec.ts");
  const states = read("apps/web/tests-serve/states.spec.ts");
  const screenshots = read("apps/web/tests-serve/screenshots.spec.ts");
  const boardRows = read("apps/web/tests-serve/board.spec.ts");

  const header = view.slice(view.indexOf('<div className="board__header">'), view.indexOf("{notice !== undefined"));
  assert.match(header, /board__liveness/, "BoardView renders connection and refresh information in the existing header");
  assert.equal((view.match(/board__liveness/g) ?? []).length, 1, "BoardView renders liveness once");
  assert.equal((view.match(/<Colophon(?![\p{L}\p{M}\p{N}])/gu) ?? []).length, 1, "BoardView renders the ruled colophon exactly once");
  assert.match(board, /liveLabel\(\{ connected, lastRefreshAt, now: new Date\(\) \}\)/, "Board derives visible liveness from connection and last-successful-refresh state");
  assert.match(boardLib, /stale · last updated/, "a disconnect preserves the last successful refresh in visible copy");
  assert.match(css, /\.board__liveness\s*\{[^}]*white-space:\s*nowrap;/s, "header liveness remains legible on one line");
  assert.match(css, /@media \(max-width: 599px\)[\s\S]*?\.board__header\s*\{[^}]*flex-wrap:\s*wrap;/s, "the phone header wraps without horizontal overflow");
  assert.match(css, /\.board\s*>\s*footer\s*\{[^}]*padding:\s*0\s+var\(--sp-6\);/s, "the Board colophon uses the title's content gutter");
  assert.match(served, /W-406-b2 Board header preserves live and stale refresh time above one footer at 1280 and 390/, "the served row names both ruled widths and states");
  assert.match(states, /shell__status\[data-state="stale"\]/, "the stale state stays visible to assistive technology in the shell region");
  assert.match(states, /shell__status\[data-state="live"\]/, "the live state stays visible to assistive technology in the shell region");
  assert.match(states, /board__liveness/, "the state matrix requires visible header liveness as well as shell announcements");
  assert.match(screenshots, /board__liveness/, "capture readiness waits for visible refreshed state");
  assert.match(boardRows, /four timestamp fields/, "the Board timestamp row retains the visible refresh time");
});

test("W-406-b3 behaviour 3: the Officina today rule clears its weekday glyph at desktop and phone widths", () => {
  const css = read("apps/web/src/components/w025.css");
  const served = read("apps/web/tests-serve/w406.spec.ts");

  assert.match(css, /\.fasti-strip__today-rule\s*\{[^}]*right:\s*0;/s, "the today rule uses the trailing edge");
  assert.match(served, /W-406-b3 Officina today rule clears the last day letter at 1280 and 390/, "the served row names both ruled widths");
  assert.match(served, /today rule and weekday letter do not overlap/, "the served row compares the marker and glyph boxes");
});
