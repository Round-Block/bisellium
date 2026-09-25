#!/usr/bin/env node
/**
 * scripts/no-vendor.mjs — W-072 (studio/briefs/W-072.md, revision 5): the
 * `npm test` runner that keeps the suite from ever reaching a real vendor
 * CLI (`claude`, `codex`) through a PATH it controls. `package.json`'s
 * `test` script is this file, invoked with no arguments; the real chain of
 * ~60 test invocations lives in `test:suite`, read out of `package.json` at
 * runtime and executed with `sh -c` — never a nested `npm run`, which would
 * let npm re-prepend `node_modules/.bin` ahead of the shadow (see the
 * brief's "The shadow", land 1).
 *
 * Mechanism, in one line: `test/bin/claude` and `test/bin/codex` are
 * checked-in shims that record a violation to a file and refuse, rather
 * than exit non-zero — a caught rejection can swallow an exit code, it
 * cannot unwrite a file. This runner shadows PATH ahead of the suite,
 * fail-closed preflight before anything spends a cent, then adjudicates
 * from a snapshot of that file taken while an exclusive lock is still held.
 *
 * Every exported function here is pure or takes its paths as an argument,
 * so scripts/no-vendor.test.mjs can drive each piece — including the two
 * lock races (finding 10) and the ordering itself — directly, without
 * spawning a whole child process for every case, and without ever spawning
 * the bare string `claude` or `codex` (the brief's own trap, behaviour 1's
 * header).
 */
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = dirname(HERE);

/** Repo-root-relative locations, deliberately under `.bisellium/` (already
 *  gitignored, already excluded from every source-tree hash and dirty
 *  check — see check.ts/verify.ts — so a violation or a lock can never mint
 *  a `dirty:` certificate; behaviour 11). */
export const SHADOW_DIR_REL = "test/bin";
export const LOG_REL = ".bisellium/vendor-violations.log";
export const LOCK_REL = ".bisellium/vendor-sentinel.lock";
export const VENDOR_BINS = Object.freeze(["claude", "codex"]);

// ---------------------------------------------------------------------------
// Step 1 of "Fail closed": the ONLY thing that happens before the lock.
// ---------------------------------------------------------------------------

/** `mkdir -p .bisellium` and confirm it's writable — the one precondition
 *  that must hold before anything touches the lock or the log. Never
 *  throws; reports failure instead, so `main()` can exit without running
 *  the suite. */
export function preflightBisDir(repoRoot) {
  const bisDir = join(repoRoot, ".bisellium");
  try {
    mkdirSync(bisDir, { recursive: true });
    accessSync(bisDir, constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false, message: `vendor-sentinel: ${bisDir} is not writable` };
  }
}

// ---------------------------------------------------------------------------
// The lock — refuse-only, no pid-liveness takeover (finding 14: measured
// unsafe — an orphaned suite survives a SIGKILLed runner and keeps writing,
// see the brief's "There is no automatic takeover"). Held for the whole
// run; released last, in a `finally`.
// ---------------------------------------------------------------------------

export class LockHeldError extends Error {}

/** The refusal message: names the file, the recorded pid and start time,
 *  and the exact `rm` to run — behaviour 9 asserts this text, not just the
 *  exit code, because the operator's next action is the whole value of the
 *  row. */
function lockRefusalMessage(lockPath, raw) {
  let pid = "unknown";
  let startedAt = "unknown";
  try {
    const info = JSON.parse(raw);
    if (typeof info.pid === "number") pid = String(info.pid);
    if (typeof info.startedAt === "string") startedAt = info.startedAt;
  } catch {
    // malformed lock content — still refuse, still name the file and the rm.
  }
  return [
    `vendor-sentinel: lock held at ${lockPath}`,
    `  recorded pid: ${pid}`,
    `  started: ${startedAt}`,
    `A concurrent run is refused rather than taking over (a dead pid does not`,
    `imply a dead suite). If that run crashed, remove the lock and retry:`,
    `  rm ${lockPath}`,
  ].join("\n");
}

/** `open(..., "wx")` — atomic exclusive create. Throws `LockHeldError` with
 *  the full refusal message when a lock already exists; never takes it
 *  over, and never consults whether the recorded pid is alive (presence is
 *  the whole test). */
export function acquireLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (err) {
    if (err && err.code === "EEXIST") {
      const raw = existsSync(lockPath) ? readFileSync(lockPath, "utf8") : "";
      throw new LockHeldError(lockRefusalMessage(lockPath, raw));
    }
    throw err;
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  closeSync(fd);
}

/** Best-effort release — never throws, so a release in a `finally` can
 *  never itself mask the real outcome of a run. */
export function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // already gone, or never existed — nothing to do.
  }
}

// ---------------------------------------------------------------------------
// The violations log — appended by the shims, read (never cleared) by
// adjudication, cleared only in the NEXT run's own preflight (step 3).
// ---------------------------------------------------------------------------

/** Every non-empty line currently in the log, in file order. Read-only:
 *  callers that need a fresh run clear the file themselves, never this
 *  function, so "read" and "clear" stay two separate, individually
 *  testable operations. */
export function readLogLines(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function clearLog(logPath) {
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, "");
}

// ---------------------------------------------------------------------------
// The activation self-test (fail-closed, land 8): fire a shim by ABSOLUTE
// PATH — never through PATH, never the bare string — and observe its own
// violation line before the suite starts.
// ---------------------------------------------------------------------------

export function readShadowNames(shadowDir) {
  if (!existsSync(shadowDir)) return [];
  return readdirSync(shadowDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

function canExecute(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Runs the first of `VENDOR_BINS` present in `shadowDir`, by its absolute
 *  path, and confirms it wrote a violation — then clears the log so the
 *  suite starts empty. Returns `false` (never throws) if nothing fired,
 *  which the caller treats as "the shim did not activate" rather than a
 *  crash. */
export function selfTest(shadowDir, logPath) {
  const bin = VENDOR_BINS.find((name) => existsSync(join(shadowDir, name)));
  if (!bin) return false;
  clearLog(logPath);
  spawnSync(join(shadowDir, bin), ["--version"], { stdio: "ignore" });
  const fired = readLogLines(logPath).length > 0;
  clearLog(logPath);
  return fired;
}

// ---------------------------------------------------------------------------
// Static pins (behaviour 10) — exported scans, called from preflight
// (finding 15: a suite step runs too late to PREVENT contact), imported by
// the test file for their positive controls.
// ---------------------------------------------------------------------------

function listSourceFiles(repoRoot, dirs, matches) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (matches(entry.name)) out.push(p);
    }
  };
  for (const d of dirs) walk(join(repoRoot, d));
  return out;
}

const SPAWN_CALL_RE =
  /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g;

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

/** Pin (a): every spawn-family call under `dirs` (production code) that
 *  names a binary present in the shadow set uses the BARE name, never a
 *  path — a path routes around PATH precedence entirely, which is the one
 *  thing this sentinel cannot see happen at runtime. Reads the shadow set
 *  from `shadowNames` (the caller's job to source it — `runStaticPins`
 *  reads it from `test/bin/`, so on a checkout without that directory yet
 *  the set is empty and this scan has nothing to compare against — the
 *  brief's own honest-red note). */
export function scanBareVendorSpawns({ repoRoot, dirs = ["packages", "apps", "adapters"], shadowNames }) {
  const files = listSourceFiles(
    repoRoot,
    dirs,
    (name) =>
      (name.endsWith(".ts") || name.endsWith(".mjs")) &&
      !name.endsWith(".d.ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.mjs"),
  );
  const violations = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    SPAWN_CALL_RE.lastIndex = 0;
    let m;
    while ((m = SPAWN_CALL_RE.exec(src))) {
      const literal = m[2] ?? "";
      if (!literal.includes("/")) continue; // bare name — the good state.
      const base = literal.split("/").pop();
      if (base && shadowNames.includes(base)) {
        violations.push({
          file: relative(repoRoot, file),
          line: lineOf(src, m.index),
          message: `spawns "${literal}" by path instead of the bare name "${base}"`,
        });
      }
    }
  }
  return violations;
}

/** Pin (b): the $0 prohibition made mechanical — no test file spawns the
 *  bare string `claude` or `codex`. A test for a vendor-spend guard that
 *  spends is the one unacceptable outcome (the brief's own trap). */
export function scanTestFilesForVendorNames({ repoRoot, dirs = ["packages", "apps", "adapters", "scripts", "test"] }) {
  const files = listSourceFiles(repoRoot, dirs, (name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"));
  const violations = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    SPAWN_CALL_RE.lastIndex = 0;
    let m;
    while ((m = SPAWN_CALL_RE.exec(src))) {
      const literal = m[2] ?? "";
      if (literal === "claude" || literal === "codex") {
        violations.push({
          file: relative(repoRoot, file),
          line: lineOf(src, m.index),
          message: `spawns the bare vendor name "${literal}"`,
        });
      }
    }
  }
  return violations;
}

const PATH_LITERAL_RE = /\bPATH\s*:\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

/** Pin (c): every test-supplied `PATH` either inherits `process.env.PATH`,
 *  carries the shadow-dir marker (`SHADOW_DIR_REL` in its source text), or
 *  resolves no shadowed binary on THIS machine (checked with
 *  `accessSync(X_OK)`, never a denylist of directory names — finding 11).
 *  Conservative, and known to be so (finding 15): it cannot tell whether a
 *  literal ever reaches a spawn, so a projection-only fixture PATH is
 *  scanned exactly like a spawned one. */
export function scanTestSuppliedPaths({
  repoRoot,
  dirs = ["packages", "apps", "adapters", "scripts", "test"],
  shadowNames,
}) {
  const files = listSourceFiles(repoRoot, dirs, (name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"));
  const violations = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    PATH_LITERAL_RE.lastIndex = 0;
    let m;
    while ((m = PATH_LITERAL_RE.exec(src))) {
      const raw = m[1] ?? "";
      if (raw.includes("process.env")) continue; // (a) inherited.
      if (raw.includes("SHADOW_DIR_REL")) continue; // (b) shadow dir present.
      const inner = raw.slice(1, -1).replace(/\$\{[^}]*\}/g, "");
      const segments = inner
        .split(":")
        .map((s) => s.trim())
        .filter((s) => s.startsWith("/"));
      const resolvesShadow = segments.some((seg) => shadowNames.some((name) => canExecute(join(seg, name))));
      if (resolvesShadow) {
        violations.push({
          file: relative(repoRoot, file),
          line: lineOf(src, m.index),
          message: `PATH literal resolves a shadowed vendor binary on this machine: ${raw}`,
        });
      }
    }
  }
  return violations;
}

/** All three pins, run in preflight — never as a suite step (finding 15). */
export function runStaticPins({ repoRoot, shadowDir = join(repoRoot, SHADOW_DIR_REL) }) {
  const shadowNames = readShadowNames(shadowDir);
  return [
    ...scanBareVendorSpawns({ repoRoot, shadowNames }),
    ...scanTestFilesForVendorNames({ repoRoot }),
    ...scanTestSuppliedPaths({ repoRoot, shadowNames }),
  ];
}

// ---------------------------------------------------------------------------
// The whole sequenced run — mkdir is the only pre-lock step (handled by
// `preflightBisDir`, called from `main()` before this); everything else
// (clear, verify, self-test, scans, suite, snapshot, adjudicate) runs with
// the lock held, released last in a `finally` covering every path,
// including a throw.
// ---------------------------------------------------------------------------

/** The ordering from the brief's "Fail closed" section, steps 2-6 plus the
 *  suite and adjudication. Returns `{ exitCode, log }` and never throws for
 *  an EXPECTED failure (missing shim, failed scan, lock held); an
 *  unexpected one (e.g. `logPath` colliding with a directory) propagates
 *  after the lock is released, so the finally is exercised on that path
 *  too. `log` is always the final on-disk snapshot content, even on an
 *  early return, which is what makes the two races in behaviour 9
 *  assertable directly. */
export function runOnce(opts) {
  const { repoRoot, suiteCommand } = opts;
  const shadowDir = opts.shadowDir ?? join(repoRoot, SHADOW_DIR_REL);
  const logPath = opts.logPath ?? join(repoRoot, LOG_REL);
  const lockPath = opts.lockPath ?? join(repoRoot, LOCK_REL);
  const env = opts.env ?? process.env;

  let lockHeld = false;
  try {
    try {
      acquireLock(lockPath);
      lockHeld = true;
    } catch (err) {
      if (err instanceof LockHeldError) {
        console.error(err.message);
        return { exitCode: 1, log: readLogLines(logPath) };
      }
      throw err;
    }

    clearLog(logPath);

    for (const bin of VENDOR_BINS) {
      const p = join(shadowDir, bin);
      if (!canExecute(p)) {
        console.error(`vendor-sentinel: shim missing or not executable: ${p}`);
        return { exitCode: 1, log: readLogLines(logPath) };
      }
    }

    if (!selfTest(shadowDir, logPath)) {
      console.error(`vendor-sentinel: activation self-test failed — the shim in ${shadowDir} did not fire`);
      return { exitCode: 1, log: readLogLines(logPath) };
    }

    const staticViolations = runStaticPins({ repoRoot, shadowDir });
    if (staticViolations.length > 0) {
      console.error("vendor-sentinel: static scan violation(s):");
      for (const v of staticViolations) console.error(`  ${v.file}:${v.line}: ${v.message}`);
      return { exitCode: 1, log: readLogLines(logPath) };
    }

    const runEnv = { ...env, PATH: `${shadowDir}:${env.PATH ?? ""}` };
    const result = spawnSync("sh", ["-c", suiteCommand], { cwd: repoRoot, env: runEnv, stdio: "inherit" });
    // `status` is `null` when the suite was killed by a signal (SIGKILL from
    // an OOM, a timeout elsewhere, ^C) rather than exiting on its own — that
    // is a fundamentally different event than "the suite's own checks
    // failed", and reporting it as a bare exit code 1 would erase the one
    // fact an operator most needs (a signal killed it, not a red test).
    if (result.status === null) {
      console.error(
        `vendor-sentinel: the suite was killed by signal ${result.signal ?? "unknown"}, not a test failure`,
      );
    }
    const suiteExit = result.status ?? 1;

    const snapshot = readLogLines(logPath);
    if (snapshot.length > 0) {
      console.error(`vendor-sentinel: ${snapshot.length} vendor-spend violation(s) detected:`);
      for (const line of snapshot) console.error(`  ${line}`);
      return { exitCode: 1, log: snapshot };
    }
    return { exitCode: suiteExit, log: snapshot };
  } finally {
    if (lockHeld) releaseLock(lockPath);
  }
}

async function main() {
  const pre = preflightBisDir(REPO_ROOT);
  if (!pre.ok) {
    console.error(pre.message);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const suiteCommand = pkg.scripts && pkg.scripts["test:suite"];
  if (typeof suiteCommand !== "string" || suiteCommand.length === 0) {
    console.error(`vendor-sentinel: package.json has no scripts["test:suite"]`);
    process.exit(1);
  }

  const { exitCode } = runOnce({ repoRoot: REPO_ROOT, suiteCommand });
  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
