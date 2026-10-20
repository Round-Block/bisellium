/**
 * scripts/source-map-js.test.mjs — W-236 behaviour 1, offline: the root
 * package-lock.json carries no source-map-js below 1.2.2 (GHSA-68fv-2mgg-jv7q).
 * W-346 behaviour 1, the same way: no vite below 8.3.3 (three launch-editor advisories).
 * Reads the lockfile only: no network, no npm. The general gate is
 * `npm run -s audit`; this is the replayable evidence for the fix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
