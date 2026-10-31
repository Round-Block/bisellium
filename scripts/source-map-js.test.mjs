/**
 * scripts/source-map-js.test.mjs — W-236 behaviour 1, offline: the root
 * package-lock.json carries no source-map-js below 1.2.2 (GHSA-68fv-2mgg-jv7q).
 * W-346 behaviour 1, the same way: no vite below 8.3.3 (three launch-editor advisories).
 * W-477 behaviour 1, the same way: no minimatch below 11.0.1 (GHSA-g3hv-75wg-m249), and the root override.
 * Reads the lockfile and package.json only: no network, no npm. The general gate is
 * `npm run -s audit`; this is the replayable evidence for the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// W-477-b1 fix 1: the lockfile is not the install. Every minimatch the lockfile names must also be installed,
// at the lockfile's resolved version and at 11.0.1 or above, so a node_modules left from before the lock moved fails.
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// Offline: the lockfile's `packages` keys are the paths; each is read at <root>/<key>/package.json.
function installedMinimatchProblems(root, packages) {
  const problems = [];
  for (const [path, entry] of Object.entries(packages)) {
    const file = join(root, path, "package.json");
    if (!existsSync(file)) {
      problems.push(`${path} is not installed (the lock has ${entry?.version})`);
      continue;
    }
    let installed;
    try {
      installed = JSON.parse(readFileSync(file, "utf8"))?.version;
    } catch {
      problems.push(`${path} has an unreadable package.json`);
      continue;
    }
    if (installed !== entry?.version) {
      problems.push(`${path} is installed at ${JSON.stringify(installed)} but the lock has ${entry?.version}`);
      continue;
    }
    const parts =
      typeof installed === "string" && /^\d+\.\d+\.\d+$/.test(installed) ? installed.split(".").map(Number) : null;
    const at = parts ? parts.findIndex((n, i) => n !== MINIMATCH_FLOOR[i]) : -1;
    if (!parts || (at !== -1 && (parts[at] ?? 0) < (MINIMATCH_FLOOR[at] ?? 0))) {
      problems.push(`${path} is installed at ${installed}, below 11.0.1`);
    }
  }
  return problems;
}

test("W-477-b1 fix 1: a stale installed minimatch beside an 11 lock is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "w477-install-"));
  try {
    const packages = {
      "node_modules/minimatch": { version: "11.0.3" },
      "node_modules/eslint/node_modules/minimatch": { version: "11.0.3" },
      "node_modules/gone/node_modules/minimatch": { version: "11.0.3" },
    };
    mkdirSync(join(root, "node_modules/minimatch"), { recursive: true });
    writeFileSync(
      join(root, "node_modules/minimatch/package.json"),
      JSON.stringify({ name: "minimatch", version: "10.2.6" }),
    );
    mkdirSync(join(root, "node_modules/eslint/node_modules/minimatch"), { recursive: true });
    writeFileSync(
      join(root, "node_modules/eslint/node_modules/minimatch/package.json"),
      JSON.stringify({ name: "minimatch", version: "11.0.3" }),
    );
    const problems = installedMinimatchProblems(root, packages);
    assert.ok(
      problems.some((p) => p.includes("node_modules/minimatch") && p.includes("10.2.6")),
      `a stale installed 10.2.6 is named: ${JSON.stringify(problems)}`,
    );
    assert.ok(
      problems.some((p) => p.includes("gone/node_modules/minimatch") && p.includes("not installed")),
      `a lock entry with no installed copy is named: ${JSON.stringify(problems)}`,
    );
    assert.ok(!problems.some((p) => p.includes("eslint/node_modules/minimatch")), "a matching installed copy passes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("W-477-b1 fix 1: the installed minimatch inventory matches the lockfile at 11.0.1 or above", () => {
  const packages = Object.fromEntries(
    Object.entries(lock.packages ?? {}).filter(([path]) => /(^|\/)node_modules\/minimatch$/.test(path)),
  );
  const problems = installedMinimatchProblems(REPO, packages);
  assert.deepEqual(problems, [], `installed minimatch differs from the lock (run npm ci): ${problems.join("; ")}`);
});
