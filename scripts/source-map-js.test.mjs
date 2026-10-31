/**
 * scripts/source-map-js.test.mjs — W-236 behaviour 1, offline: the root
 * package-lock.json carries no source-map-js below 1.2.2 (GHSA-68fv-2mgg-jv7q).
 * W-346 behaviour 1, the same way: no vite below 8.3.3 (three launch-editor advisories).
 * W-477 behaviour 1, the same way: no minimatch below 11.0.1 (GHSA-g3hv-75wg-m249), and the root override.
 * Reads the lockfile and package.json; W-477-b1 fix 1 and 2 also read the installed node_modules
 * (scripts/installed-inventory.mjs) and temp fixtures: no network, no npm. The general gate is
 * `npm run -s audit`; this is the replayable evidence for the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedInventoryProblems } from "./installed-inventory.mjs";

const FLOOR = [1, 2, 2];
const lock = JSON.parse(
  readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "package-lock.json"), "utf8"),
);

test("W-236 behaviour 1: package-lock.json carries no source-map-js below 1.2.2", () => {
  const found = Object.entries(lock.packages ?? {}).filter(([path]) => /(^|\/)node_modules\/source-map-js$/.test(path));
  assert.ok(found.length > 0, "package-lock.json lists source-map-js");
  for (const [path, entry] of found) {
    const version = entry?.version;
    // Exactly major.minor.patch, digits only; anything else (a range, a prerelease, empty, missing) fails.
    assert.ok(
      typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version),
      `${path} has a malformed version ${JSON.stringify(version)}`,
    );
    const parts = version.split(".").map(Number);
    const at = parts.findIndex((n, i) => n !== FLOOR[i]);
    assert.ok(at === -1 || parts[at] > FLOOR[at], `${path} is ${version}`);
  }
});

// W-346 behaviour 1: vite 8.3.0-8.3.2 carries three high launch-editor advisories (GHSA-698v-4r3x-3vcv,
// GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm); 8.3.3 is the first version outside that range.
const VITE_FLOOR = [8, 3, 3];

test("W-346-b1 behaviour 1: package-lock.json carries no vite below 8.3.3", () => {
  const found = Object.entries(lock.packages ?? {}).filter(([path]) => /(^|\/)node_modules\/vite$/.test(path));
  assert.ok(found.length > 0, "package-lock.json lists vite");
  for (const [path, entry] of found) {
    const version = entry?.version;
    assert.ok(
      typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version),
      `${path} has a malformed version ${JSON.stringify(version)}`,
    );
    const parts = version.split(".").map(Number);
    const at = parts.findIndex((n, i) => n !== VITE_FLOOR[i]);
    assert.ok(at === -1 || parts[at] > VITE_FLOOR[at], `${path} is ${version}`);
  }
});

// W-477-b1 behaviour 1: minimatch below 11.0.1 carries GHSA-g3hv-75wg-m249 (moderate, DoS by globparts amplification).
// eslint and typescript-eslint ask for `^10`, so the root package.json forces 11 with an `overrides` entry.
const MINIMATCH_FLOOR = [11, 0, 1];
const pkg = JSON.parse(readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "package.json"), "utf8"));

test("W-477-b1 behaviour 1: package-lock.json carries no minimatch below 11.0.1, forced by the root override", () => {
  const found = Object.entries(lock.packages ?? {}).filter(([path]) => /(^|\/)node_modules\/minimatch$/.test(path));
  assert.ok(found.length > 0, "package-lock.json lists minimatch");
  for (const [path, entry] of found) {
    const version = entry?.version;
    // Exactly major.minor.patch, digits only; anything else (a range, a prerelease, empty, missing) fails.
    assert.ok(
      typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version),
      `every minimatch entry is a plain version: ${path} has ${JSON.stringify(version)}`,
    );
    const parts = version.split(".").map(Number);
    const at = parts.findIndex((n, i) => n !== MINIMATCH_FLOOR[i]);
    assert.ok(
      at === -1 || parts[at] > MINIMATCH_FLOOR[at],
      `every minimatch entry is 11.0.1 or above: ${path} is ${version}`,
    );
  }
  const forced = pkg.overrides?.minimatch;
  assert.ok(forced === "^11.0.1", `package.json overrides minimatch to ^11.0.1: it has ${JSON.stringify(forced)}`);
});

// W-477-b1 fix 2 (revisions 2 and 3): the lockfile is not the install. scripts/installed-inventory.mjs walks every installed
// minimatch (root and workspace node_modules, nested and scoped, by folder name or package.json name) and matches each
// to a lock entry at the same version and at 11.0.1 or above; an extra, a missing, a differing or an unreadable copy fails.
// Revision 3: `workspaces` is read as npm reads it (an array, or an object with a `packages` array); any other value, an
// unreadable root package.json and a pattern of another form are refused, never read as no workspaces.
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

const WORKSPACES = JSON.stringify({ name: "fixture", workspaces: ["packages/*"] });
/** A fixture install under a fresh temp root: `manifest` as its package.json, and `copies` as { folder: package.json }. */
function fixtureInstall(copies, manifest) {
  const root = mkdtempSync(join(tmpdir(), "w477-install-"));
  writeFileSync(join(root, "package.json"), manifest);
  mkdirSync(join(root, "packages", "ws"), { recursive: true });
  for (const [folder, manifest] of Object.entries(copies)) {
    mkdirSync(join(root, folder), { recursive: true });
    if (manifest !== null) writeFileSync(join(root, folder, "package.json"), manifest);
  }
  return root;
}
const mm = (version) => JSON.stringify({ name: "minimatch", version });
const LOCKED = {
  "node_modules/minimatch": { version: "11.0.3" },
  "node_modules/eslint/node_modules/minimatch": { version: "11.0.3" },
};
const MATCHED = {
  "node_modules/minimatch": mm("11.0.3"),
  "node_modules/eslint": JSON.stringify({ name: "eslint", version: "10.10.0" }),
  "node_modules/eslint/node_modules/minimatch": mm("11.0.3"),
};

test("W-477-b1 fix 2: every installed minimatch matches a lock entry, and every other installed form is refused", () => {
  const roots = [];
  const problems = (copies, packages = LOCKED, manifest = WORKSPACES) => {
    const root = fixtureInstall(copies, manifest);
    roots.push(root);
    return installedInventoryProblems(root, packages, "minimatch", MINIMATCH_FLOOR);
  };
  try {
    const ok = problems(MATCHED);
    assert.deepEqual(ok, [], `an install matching the lock passes: ${JSON.stringify(ok)}`);
    const extra = problems({ ...MATCHED, "node_modules/typescript-eslint/node_modules/minimatch": mm("10.2.6") });
    assert.deepEqual(
      extra,
      ["node_modules/typescript-eslint/node_modules/minimatch is installed at 10.2.6 and the lock has no such entry"],
      `an extra nested minimatch absent from the lock is refused: ${JSON.stringify(extra)}`,
    );
    const scoped = problems({ ...MATCHED, "node_modules/@eslint/config-array/node_modules/minimatch": mm("10.2.6") });
    assert.deepEqual(
      scoped,
      [
        "node_modules/@eslint/config-array/node_modules/minimatch is installed at 10.2.6 and the lock has no such entry",
      ],
      `an extra minimatch under a scoped package is refused: ${JSON.stringify(scoped)}`,
    );
    const ws = problems({ ...MATCHED, "packages/ws/node_modules/minimatch": mm("11.0.3") });
    assert.deepEqual(
      ws,
      ["packages/ws/node_modules/minimatch is installed at 11.0.3 and the lock has no such entry"],
      `an extra minimatch in a workspace node_modules is refused: ${JSON.stringify(ws)}`,
    );
    const STALE_WS = { ...MATCHED, "packages/ws/node_modules/minimatch": mm("10.2.6") };
    const bare = problems(STALE_WS, LOCKED, JSON.stringify({ name: "fixture" }));
    assert.deepEqual(
      bare,
      [],
      `a package.json without workspaces walks the root node_modules only: ${JSON.stringify(bare)}`,
    );
    const declared = problems(
      STALE_WS,
      LOCKED,
      JSON.stringify({ name: "fixture", workspaces: { packages: ["packages/*"] } }),
    );
    assert.deepEqual(
      declared,
      ["packages/ws/node_modules/minimatch is installed at 10.2.6 and the lock has no such entry"],
      `the object workspaces form is walked: ${JSON.stringify(declared)}`,
    );
    for (const value of ["packages/*", null, 5, {}, { packages: "packages/*" }]) {
      const other = problems(STALE_WS, LOCKED, JSON.stringify({ name: "fixture", workspaces: value }));
      assert.deepEqual(
        other,
        [`package.json workspaces ${JSON.stringify(value)} is not an array or an object with a packages array`],
        `a workspaces value of another form is refused: ${JSON.stringify(other)}`,
      );
    }
    for (const manifest of ["{ not json", "null", "[]"]) {
      const unread = problems(STALE_WS, LOCKED, manifest);
      assert.deepEqual(
        unread,
        ["package.json is unreadable"],
        `an unreadable root package.json is refused: ${JSON.stringify(unread)}`,
      );
    }
    const glob = problems(STALE_WS, LOCKED, JSON.stringify({ name: "fixture", workspaces: ["packages/**"] }));
    assert.deepEqual(
      glob,
      ['workspaces pattern "packages/**" is not read'],
      `a workspaces pattern of another form is refused: ${JSON.stringify(glob)}`,
    );
    const alias = problems({ ...MATCHED, "node_modules/glob-match": mm("10.2.6") });
    assert.deepEqual(
      alias,
      ["node_modules/glob-match is installed at 10.2.6 and the lock has no such entry"],
      `a minimatch installed under another folder name is refused: ${JSON.stringify(alias)}`,
    );
    const stale = problems({ ...MATCHED, "node_modules/minimatch": mm("10.2.6") });
    assert.deepEqual(
      stale,
      ["node_modules/minimatch is installed at 10.2.6 and the lock has 11.0.3"],
      `an installed version that differs from the lock is refused: ${JSON.stringify(stale)}`,
    );
    const { ["node_modules/eslint/node_modules/minimatch"]: _gone, ...missing } = MATCHED;
    const absent = problems(missing);
    assert.deepEqual(
      absent,
      ["node_modules/eslint/node_modules/minimatch is in the lock at 11.0.3 and not installed"],
      `a lock entry with no installed copy is refused: ${JSON.stringify(absent)}`,
    );
    const unreadable = problems({ ...MATCHED, "node_modules/minimatch": "{ not json" });
    assert.deepEqual(
      unreadable,
      ["node_modules/minimatch has an unreadable package.json"],
      `a minimatch with an unreadable package.json is refused: ${JSON.stringify(unreadable)}`,
    );
    const low = problems(
      { ...MATCHED, "node_modules/minimatch": mm("10.2.6") },
      { ...LOCKED, "node_modules/minimatch": { version: "10.2.6" } },
    );
    assert.deepEqual(
      low,
      ["node_modules/minimatch is installed at 10.2.6, below 11.0.1"],
      `an installed copy below 11.0.1 is refused even when the lock agrees: ${JSON.stringify(low)}`,
    );
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

test("W-477-b1 fix 1: the installed minimatch inventory matches the lockfile at 11.0.1 or above", () => {
  const problems = installedInventoryProblems(REPO, lock.packages, "minimatch", MINIMATCH_FLOOR);
  assert.deepEqual(
    problems,
    [],
    `the installed minimatch inventory matches the lock: ${problems.join("; ")} (run npm ci)`,
  );
});
