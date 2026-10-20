/**
 * W-335: ci.yml's full-path `npm test` step and the W-139 guard step after it, as one command:
 *
 *   node scripts/test-reads.mjs
 *
 * runs `npm test` in this checkout with NODE_OPTIONS `--import <checkout's file URL>/scripts/record-reads.mjs` (a file URL, so a path with a space survives NODE_OPTIONS' splitting) and
 * BISELLIUM_RECORD_READS a fresh log, then, only when that exits 0, `node scripts/ci-scope.mjs --check-reads <log>`,
 * and exits with the first non-zero status (1 for a signal). `bisellium ci` runs it in place of CI_STEPS' `npm test`
 * in a checkout whose package.json declares `test:record`, and `ci --opus` runs it as the gate `verify` would have run
 * as `npm test` (packages/commands/src/ci.ts), so a test missing from `test:record` fails before review, not in the
 * merge queue (#488, #614).
 *
 * Fails closed: a missing preload stops npm at startup; a missing or unreadable log is the guard's `missing:`. The
 * trace starts here: an inherited NODE_OPTIONS or BISELLIUM_RECORD_* key reaches neither npm nor the guard, as ci.yml's
 * steps set NODE_OPTIONS outright on npm test and not at all on the guard. `runTestReads` is the one rejecting function: a non-zero or null status, a signal or a spawn failure from `npm test` or from the guard becomes a non-zero exit, and no guard runs after a failing `npm test`. TEST, PRELOAD and CHECK are pinned to ci.yml's steps (W-335-b1).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TEST = "npm test";
export const PRELOAD = "scripts/record-reads.mjs";
export const CHECK = "scripts/ci-scope.mjs --check-reads";

/** Runs `npm test` traced to `log`, then, only on exit 0, the guard on it; returns the first non-zero status (1 for a
 *  signal or a spawn failure). */
export function runTestReads(repo, log) {
  // the guard runs as ci.yml's step does, with no NODE_OPTIONS; npm test with only this trace's two keys
  const plain = { ...process.env };
  for (const key of ["NODE_OPTIONS", "BISELLIUM_RECORD_READS", "BISELLIUM_RECORD_ROOT", "BISELLIUM_RECORD_OWNER"])
    delete plain[key];
  const env = {
    ...plain,
    NODE_OPTIONS: `--import ${pathToFileURL(join(repo, PRELOAD)).href}`,
    BISELLIUM_RECORD_READS: log,
  };
  const [bin, ...args] = TEST.split(" ");
  const status = spawnSync(bin, args, { cwd: repo, env, stdio: "inherit" }).status ?? 1;
  if (status !== 0) return status;
  const check = [...CHECK.split(" "), log];
  // on stderr, the guard's stdout too: a gate log is stdout then stderr, cut to its last 200 lines (localPipeline), so
  // only the end of stderr survives a suite as loud as this one
  console.error(`test-reads: node ${check.join(" ")}`);
  return spawnSync(process.execPath, check, { cwd: repo, env: plain, stdio: ["inherit", 2, "inherit"] }).status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), "bisellium-test-reads-"));
  let status = 1;
  try {
    status = runTestReads(repo, join(dir, "record-reads.log"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(status);
}
