/**
 * W-110 behaviour 1: the rail's entries and the router's map are one table.
 * node:test TAP; `--behaviour 1` (only 1 exists) selects the one test.
 * `NAV_ENTRIES` is reached through a namespace import, after the Genuine red
 * row, so a missing export is an assertion failure and not a module-load one.
 * Source text is located with import.meta.url, never a cwd-relative path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as nav from "./nav.js";
import { parseRoute } from "./route.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && only !== 1) {
  console.error("nav-source.test.ts: --behaviour must be 1");
  process.exit(2);
}

interface NavEntry {
  route: string;
  href: string;
  label: string;
}
const table = (): readonly NavEntry[] | undefined => (nav as unknown as { NAV_ENTRIES?: readonly NavEntry[] }).NAV_ENTRIES;
const source = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

if (only === undefined || only === 1) {
  test("W-110 behaviour 1: the rail's entries and the router's map are one table", () => {
    // (a) passes today: parseRoute and needsYouVisible are unchanged.
    for (const r of ["inbox", "board", "seats", "officina"]) {
      assert.equal(parseRoute(`#/${r}`), r, `(a) parseRoute("#/${r}") gives its own route`);
    }
    for (const h of ["", "#/", "#/nonsense", "#/inbox/extra"]) {
      assert.equal(parseRoute(h), "inbox", `(a) parseRoute(${JSON.stringify(h)}) falls back to inbox`);
    }
    assert.equal(nav.needsYouVisible(0), false, "(a) needsYouVisible(0) is false");
    assert.equal(nav.needsYouVisible(3), true, "(a) needsYouVisible(3) is true");

    // (b) Genuine red: nav.ts exports the table, in D-023 section 1's order.
    const entries = table();
    assert.ok(entries, "(b) nav.js exports NAV_ENTRIES");
    assert.ok(Array.isArray(entries) && entries.length === 4, "(b) NAV_ENTRIES has exactly four entries");
    assert.deepEqual(
      entries.map((e) => e.href),
      ["#/inbox", "#/board", "#/seats", "#/officina"],
      "(b) NAV_ENTRIES hrefs, in order",
    );
    assert.deepEqual(
      entries.map((e) => e.label),
      ["Inbox", "Board", "Seats", "Officina"],
      "(b) NAV_ENTRIES labels, in order",
    );

    // (c) every href round-trips through the router; routes distinct; no `disabled` key.
    for (const e of entries) {
      assert.equal(parseRoute(e.href), e.route, `(c) parseRoute(${e.href}) round-trips to ${e.route}`);
      assert.equal("disabled" in e, false, `(c) entry ${e.route} carries no disabled key`);
    }
    assert.equal(new Set(entries.map((e) => e.route)).size, 4, "(c) the four routes are distinct");

    // (d) route.ts declares no second table and re-exports Route from nav.ts.
    const route = source("./route.ts");
    assert.doesNotMatch(route, /^const ROUTES\b/m, "(d) route.ts declares no ROUTES table");
    assert.doesNotMatch(route, /^export type Route =/m, "(d) route.ts does not declare Route");
    assert.match(route, /^export type \{ Route \} from "\.\/nav\.js";$/m, "(d) route.ts re-exports Route from nav.js");
    assert.doesNotMatch(route, /^\s*"#\/[a-z]+":/m, "(d) route.ts has no hash-keyed map literal");

    // (e) Sidebar renders from the table and marks the current entry.
    const sidebar = source("../components/Sidebar.tsx");
    assert.match(sidebar, /\baria-current\b/, "(e) Sidebar sets aria-current");
    assert.doesNotMatch(sidebar, /"#\//, "(e) Sidebar repeats no hash literal");
    assert.doesNotMatch(sidebar, /\blabel:\s*"/, "(e) Sidebar repeats no label literal");
  });
}
