/**
 * W-110 behaviour 1: the rail's entries and the router's map are one table.
 * node:test TAP; `--behaviour 1` (only 1 exists) selects the one test.
 * `NAV_ENTRIES` is reached through a namespace import, after the Genuine red
 * row, so a missing export is an assertion failure and not a module-load one.
 * Source text is located with import.meta.url, never a cwd-relative path.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

// W-342 (D-088 F 4): the README is the console's front door; the screen list comes from NAV_ENTRIES, so a new screen
// on the rail fails this row until the README names it. Skipped under `--behaviour 1` (W-110's one row).
if (only === undefined) {
  test("W-342-b1 behaviour 1: apps/web/README.md names the live screens, the two suites and points to docs/design/DIRECTION.md", () => {
    const readme = source("../../README.md");
    for (const e of nav.NAV_ENTRIES) {
      assert.match(readme, new RegExp(`\\b${e.label}\\b`), `the README names the ${e.label} screen`);
      assert.ok(readme.includes(`\`${e.href}\``), `the README names the ${e.label} route \`${e.href}\``);
    }
    const web = JSON.parse(source("../../package.json")) as { scripts?: Record<string, string> };
    assert.match(web.scripts?.["test:serve"] ?? "", /playwright\.serve\.config\.ts/, "apps/web's test:serve runs the served config");
    assert.ok(readme.includes("`npm run test:serve --workspace @bisellium/web`"), "the README names the served suite's command");
    const root = JSON.parse(source("../../../../package.json")) as { scripts?: Record<string, string> };
    assert.match(root.scripts?.["test:suite"] ?? "", /\(cd apps\/web && node /, "the root suite runs apps/web's unit tests");
    assert.ok(readme.includes("`npm test`"), "the README names the unit suite's command");
    const links = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((t) => t.endsWith("DIRECTION.md"));
    assert.deepEqual(links, ["../../docs/design/DIRECTION.md"], "the README links docs/design/DIRECTION.md once, relative to itself");
    assert.ok(existsSync(new URL("../../../../docs/design/DIRECTION.md", import.meta.url)), "the linked DIRECTION.md exists");
    assert.doesNotMatch(readme, /not yet implemented/i, "the README does not call the console unbuilt");
    assert.doesNotMatch(readme, /#[0-9A-Fa-f]{6}\b/, "the README copies no colour; tokens.css and DIRECTION.md hold them");
  });
}
