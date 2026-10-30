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
 *
 * W-466: npm test's stdout passes through as it arrives, and a failed run repeats on stderr, after everything else, its
 * last FAILING_MAX failing lines (`failingLine`) and its last STDOUT_TAIL lines, under one header each. A gate log keeps
 * only the last 200 lines of stdout then stderr (localPipeline), so a loud suite's stderr pushed every `not ok` out of
 * it; the two blocks, at most 2 + FAILING_MAX + STDOUT_TAIL lines, now end it and name the failing test.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TEST = "npm test";
export const PRELOAD = "scripts/record-reads.mjs";
export const CHECK = "scripts/ci-scope.mjs --check-reads";
/** W-466: how many failing lines, and how many last stdout lines, a failed run repeats on stderr. */
export const FAILING_MAX = 50;
export const STDOUT_TAIL = 50;

/** W-466: a failing line of the suite's three reporters, at any indent: TAP's `not ok <n>` and `# fail <n>`, node's spec
 *  reporter's `✖ ` and `ℹ fail <n>` (a count above 0), and the house `PASS/FAIL` harnesses' `FAIL` row. */
export function failingLine(line) {
  return /^\s*(?:not ok \d|FAIL\s|\u2716 |# fail [1-9]|\u2139 fail [1-9])/.test(line);
}

/** Runs `bin args` with stdout passed to this process's as it arrives, keeping its last `FAILING_MAX` failing lines and its
 *  last `STDOUT_TAIL` lines; resolves its status (1 for a signal or a spawn failure) and what it kept. */
function runKept(bin, args, options) {
  return new Promise((resolve) => {
    const failing = [];
    const tail = [];
    let failed = 0;
    let partial = "";
    const decoder = new StringDecoder("utf8");
    const keep = (line) => {
      if (failingLine(line)) {
        failed++;
        failing.push(line);
        if (failing.length > FAILING_MAX) failing.shift();
      }
      tail.push(line);
      if (tail.length > STDOUT_TAIL) tail.shift();
    };
    const feed = (text) => {
      const lines = (partial + text).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) keep(line);
    };
    const child = spawn(bin, args, { ...options, stdio: ["inherit", "pipe", "inherit"] });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      feed(decoder.write(chunk));
    });
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      feed(decoder.end());
      if (partial !== "") keep(partial);
      resolve({ status, failing, failed, tail });
    };
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 1));
  });
}

/** Runs `npm test` traced to `log`, then, only on exit 0, the guard on it; resolves the first non-zero status (1 for a
 *  signal or a spawn failure). A failed `npm test` ends stderr with its failing lines and last stdout lines (W-466). */
export async function runTestReads(repo, log) {
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
  const { status, failing, failed, tail } = await runKept(bin, args, { cwd: repo, env });
  if (status !== 0) {
    // W-466: last on stderr, so inside a gate log's 200-line tail however loud the suite's stderr was
    console.error(
      `--- ${TEST} failed (exit ${status}): its last ${failing.length} of ${failed} failing lines on stdout ---`,
    );
    for (const line of failing) console.error(line);
    console.error(`--- ${TEST}: its last ${tail.length} lines of stdout ---`);
    for (const line of tail) console.error(line);
    return status;
  }
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
    status = await runTestReads(repo, join(dir, "record-reads.log"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exitCode = status;
}
