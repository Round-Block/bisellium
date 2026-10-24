import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

test("W-406-b1 behaviour 1: every Board phase is visibly reachable at desktop and phone widths", () => {
  const css = read("apps/web/src/components/w025.css");
  const served = read("apps/web/tests-serve/w406.spec.ts");
  const pkg = JSON.parse(read("apps/web/package.json")) as { scripts?: Record<string, string> };

  assert.match(css, /\.board__columns\s*\{[^}]*scrollbar-gutter:\s*stable;/s, "the Board reserves a visible horizontal-scroll affordance");
  assert.doesNotMatch(css, /\.board__columns\s*\{[^}]*scrollbar-color\s*:/s, "the standard colour property does not override Chromium's ruled scrollbar");
  assert.match(css, /\.board__columns::\-webkit-scrollbar\s*\{[^}]*height:\s*8px;/s, "Chromium receives an 8px horizontal scrollbar");
  assert.match(css, /\.board__columns::\-webkit-scrollbar-track\s*\{[^}]*background:\s*var\(--surface\);/s, "the scrollbar track uses the ruled surface token");
  assert.match(css, /\.board__columns::\-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--ink-3\);[^}]*border-radius:\s*0;/s, "the square scrollbar thumb uses the ruled ink token");
  assert.match(served, /W-406-b1 Board exposes and reaches its terminal phase at 1280 and 390/, "the served row names both ruled widths");
  assert.match(served, /webkitScrollbar/, "the served row reads Chromium's accepted scrollbar pseudo-style before scrolling");
  assert.match(served, /scrollWidth\s*-\s*element\.clientWidth/, "the served row computes the terminal horizontal offset");
  assert.match(served, /terminal phase right edge/, "the served row measures the final column against its scroll container");
  assert.match(pkg.scripts?.["test:policy"] ?? "", /test\/w406\.test\.ts/, "the focused policy runner includes W-406");
});
