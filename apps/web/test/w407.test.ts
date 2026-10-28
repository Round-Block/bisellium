import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (fileName: string): string => readFileSync(resolve(ROOT, fileName), "utf8");
const readOptional = (fileName: string): string => existsSync(resolve(ROOT, fileName)) ? read(fileName) : "";

test("W-407-b1 behaviour 1: Inbox follows Outlook split and mobile layouts", () => {
  const view = read("apps/web/src/screens/InboxView.tsx");
  const css = read("apps/web/src/components/w025.css");
  const direction = read("docs/design/DIRECTION.md");
  const served = read("apps/web/tests-serve/w407.spec.ts");
  assert.match(view, /inbox__workspace[\s\S]*inbox__list-pane[\s\S]*inbox__reading-pane/, "the renderer has separate list and reading panes");
  assert.match(view, /className="inbox__mobile-header"[\s\S]*className="inbox__back"[\s\S]*Back[\s\S]*<h1 className="inbox__mobile-title">Inbox/, "the narrow reading view has visible Back and level-one title chrome");
  assert.match(css, /\.inbox__workspace\s*\{[^}]*grid-template-columns:\s*320px minmax\(0, 1fr\)/s, "the wide Inbox uses a fixed decision list beside a fluid reading pane");
  assert.match(css, /@media \(max-width: 839px\)[\s\S]*\.inbox__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s, "the 840px boundary changes to one full-width mobile pane");
  assert.match(view, /inbox__reading-scroll[\s\S]*inbox__action-bar[\s\S]*inbox__ratio-label[\s\S]*inbox__decision-panel/, "scrolling prose ends before the pinned decision action bar");
  assert.match(css, /\.inbox__list-pane,[\s\S]*\.inbox__reading-scroll\s*\{[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*auto;/s, "both scroll containers reserve visible vertical scrollbars");
  assert.match(css, /\.inbox__expansion\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/s, "the action bar owns the fixed bottom row");
  assert.match(direction, /Outlook is the interaction reference[\s\S]*Patron rulings, 2026-10-27 and 2026-10-28/s, "DIRECTION records both Patron rulings");
  assert.match(served, /for \(const width of \[1280, 640, 390\]\)/, "served geometry pins desktop and both narrow widths");
});
