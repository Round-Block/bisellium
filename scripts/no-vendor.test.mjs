/**
 * scripts/no-vendor.test.mjs — the 11 behaviours of studio/briefs/W-072.md
 * (revision 5). No framework, same house style as scripts/backlog-page.test.mjs
 * (the behaviour-number filter follows packages/cli/src/ci.test.ts's `only`
 * pattern, so `bisellium red` can record one assertion-level failure per
 * behaviour).
 *
 * THE ABSOLUTE PROHIBITION (the brief's own trap, restated because it is
 * this file's one unforgivable mistake): no block below ever spawns the
 * bare string `claude` or `codex`. Every shim invocation here is by
 * ABSOLUTE PATH, into an isolated fixture directory (never this repo's own
 * `.bisellium/vendor-violations.log`, which the outer `npm test` wrapper
 * that runs this very file is watching) — a self-test invocation, a
 * runOnce() call, or a fake vendor name are the only three shapes used.
 *
 * `scripts/no-vendor.mjs` does not exist at HEAD, so `mod` below is
 * `undefined` on a fresh checkout; every behaviour asserts that fact rather
 * than crashing on the failed import (P-005: an assertion-level red, never
 * a module-load stack trace).
 */
import {
  appendFileSync,
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const CLAUDE_SHIM_SRC = join(REPO_ROOT, "test", "bin", "claude");
const CODEX_SHIM_SRC = join(REPO_ROOT, "test", "bin", "codex");

let mod;
try {
  mod = await import("./no-vendor.mjs");
} catch {
  mod = undefined;
}

const only = process.argv[2] !== undefined ? Number(process.argv[2]) : undefined;
let failed = 0;
function check(behaviour, name, ok, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  [${behaviour}] ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
}
function runs(behaviour) {
  return only === undefined || only === behaviour;
}

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

const dirsToClean = [];
function freshDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `no-vendor-${prefix}-`));
  dirsToClean.push(dir);
  return dir;
}

/** Copies the checked-in shim source into `destDir/name`, preserving the
 *  exec bit explicitly (cpSync's permission behaviour is not guaranteed
 *  across platforms). Returns the absolute path. */
function installShim(destDir, name, srcPath = CLAUDE_SHIM_SRC) {
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, name);
  cpSync(srcPath, dest);
  chmodSync(dest, 0o755);
  return dest;
}

function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Every check in a behaviour that needs the runner/shims to exist starts
 *  here — a single assertion-level FAIL when they don't, never a crash. */
function requireBuilt(behaviour) {
  const ok = mod !== undefined && existsSync(CLAUDE_SHIM_SRC) && existsSync(CODEX_SHIM_SRC);
  check(
    behaviour,
    "scripts/no-vendor.mjs, test/bin/claude and test/bin/codex all exist",
    ok,
    `mod=${mod !== undefined} claude=${existsSync(CLAUDE_SHIM_SRC)} codex=${existsSync(CODEX_SHIM_SRC)}`,
  );
  return ok;
}

function withCapturedStderr(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const result = fn();
    return { result, stderr: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------
// Behaviour 1 — the shim records, refuses, and appends. Absolute path only.
// ---------------------------------------------------------------------------
if (runs(1) && requireBuilt(1)) {
  const dir = freshDir("b1");
  const claude = installShim(join(dir, "test", "bin"), "claude");
  const codex = installShim(join(dir, "test", "bin"), "codex", CODEX_SHIM_SRC);
  const logPath = join(dir, ".bisellium", "vendor-violations.log");

  const src = readFileSync(claude, "utf8");
  check(
    1,
    "the shim's own source never imports child_process (it spawns nothing)",
    !/child_process/.test(src),
    src.slice(0, 40),
  );

  const r1 = spawnSync(claude, ["--foo", "bar"], { cwd: dir, stdio: "ignore" });
  check(1, "claude invoked by absolute path exits non-zero", r1.status !== 0, String(r1.status));
  let lines = readLines(logPath);
  check(1, "exactly one line appended after the first invocation", lines.length === 1, JSON.stringify(lines));
  let rec = {};
  try {
    rec = JSON.parse(lines[0] ?? "{}");
  } catch {
    /* leave rec empty — the checks below fail honestly */
  }
  check(1, "the line names the binary", rec.bin === "claude", JSON.stringify(rec));
  check(
    1,
    "the line names the argv",
    JSON.stringify(rec.argv) === JSON.stringify(["--foo", "bar"]),
    JSON.stringify(rec),
  );
  check(1, "the line names the cwd", rec.cwd === dir, JSON.stringify(rec));
  const firstLine = lines[0];

  const r2 = spawnSync(codex, [], { cwd: dir, stdio: "ignore" });
  check(1, "codex invoked by absolute path also exits non-zero", r2.status !== 0, String(r2.status));
  lines = readLines(logPath);
  check(1, "two lines after the second invocation", lines.length === 2, JSON.stringify(lines));
  check(
    1,
    "the first line is byte-identical to what it was",
    lines[0] === firstLine,
    JSON.stringify({ before: firstLine, after: lines[0] }),
  );
}

// ---------------------------------------------------------------------------
// Behaviour 2 — the violation names its caller; degrades, never drops, when
// /proc is unreadable.
// ---------------------------------------------------------------------------
if (runs(2) && requireBuilt(2)) {
  const dir = freshDir("b2");
  const claude = installShim(join(dir, "test", "bin"), "claude");
  const logPath = join(dir, ".bisellium", "vendor-violations.log");

  spawnSync(claude, [], { cwd: dir, stdio: "ignore" });
  let rec = JSON.parse(readLines(logPath)[0] ?? "{}");
  check(
    2,
    "caller names this test file (real /proc, real ppid)",
    typeof rec.caller === "string" && rec.caller.includes("no-vendor.test.mjs"),
    rec.caller,
  );

  rmSync(logPath, { force: true });
  const r = spawnSync(claude, [], {
    cwd: dir,
    stdio: "ignore",
    env: { ...process.env, BISELLIUM_TEST_PROC_PATH: join(dir, "does-not-exist") },
  });
  check(2, "with /proc unreadable, the shim still exits non-zero", r.status !== 0, String(r.status));
  const lines = readLines(logPath);
  check(
    2,
    "with /proc unreadable, a line is still written (degraded, never dropped)",
    lines.length === 1,
    JSON.stringify(lines),
  );
  rec = JSON.parse(lines[0] ?? "{}");
  check(2, "the caller is recorded as unknown, not omitted", rec.caller === "unknown", JSON.stringify(rec));
}

// ---------------------------------------------------------------------------
// Behaviour 3 — preflight fails closed; the suite never starts. Five rows,
// each proving the inner command never ran via a marker file.
// ---------------------------------------------------------------------------
if (runs(3) && requireBuilt(3)) {
  const markerSuite = (markerPath) =>
    `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`)}`;

  function row(name, setup) {
    const dir = freshDir("b3");
    const shadowDir = join(dir, "test", "bin");
    installShim(shadowDir, "claude");
    installShim(shadowDir, "codex", CODEX_SHIM_SRC);
    mkdirSync(join(dir, "packages"), { recursive: true });
    const markerPath = join(dir, "marker.txt");
    setup(dir, shadowDir);
    const { result } = withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand: markerSuite(markerPath) }),
    );
    check(3, `${name}: exits non-zero`, result.exitCode !== 0, String(result.exitCode));
    check(3, `${name}: the inner command never ran`, !existsSync(markerPath), markerPath);
  }

  row("test/bin/claude missing", (dir, shadowDir) => unlinkSync(join(shadowDir, "claude")));
  row("test/bin/codex present but not executable", (dir, shadowDir) => chmodSync(join(shadowDir, "codex"), 0o644));
  row("the lock is already present (liveness never consulted)", (dir) => {
    mkdirSync(join(dir, ".bisellium"), { recursive: true });
    writeFileSync(
      join(dir, ".bisellium", "vendor-sentinel.lock"),
      JSON.stringify({ pid: 999999, startedAt: "2020-01-01T00:00:00.000Z" }),
    );
  });
  row("a static scan fails", (dir) => {
    mkdirSync(join(dir, "packages", "fake"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "fake", "bad.ts"),
      `import { spawnSync } from "node:child_process";\nspawnSync("/usr/local/bin/claude", []);\n`,
    );
  });
  // Round-1 B1(i)/(ii): the activation self-test itself had no assertion —
  // neither the `if (!selfTest(...))` gate (runOnce) nor selfTest's own
  // `readLogLines(...).length > 0` observation was pinned. A shim that is
  // present and executable but writes nothing to the log must still stop
  // the run before the suite spends anything: deleting the gate (M3) or
  // hardcoding `fired = true` (M12) both let the marker get written.
  row("test/bin/claude is present and executable but never fires (writes nothing)", (dir, shadowDir) => {
    writeFileSync(join(shadowDir, "claude"), "#!/usr/bin/env node\nprocess.exit(1);\n");
    chmodSync(join(shadowDir, "claude"), 0o755);
  });

  // ".bisellium unwritable": this precondition is `main()`'s alone —
  // `runOnce()` never creates `.bisellium/` from nothing, so this row
  // exercises the real CLI end to end (a fixture copy of the checked-in
  // runner, invoked as its own process) rather than `runOnce()` directly,
  // which would crash on the same EACCES `runOnce()` is never asked to
  // handle.
  {
    const dir = freshDir("b3-bisdir");
    const shadowDir = join(dir, "test", "bin");
    installShim(shadowDir, "claude");
    installShim(shadowDir, "codex", CODEX_SHIM_SRC);
    mkdirSync(join(dir, "packages"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    const runnerCopy = join(dir, "scripts", "no-vendor.mjs");
    cpSync(join(REPO_ROOT, "scripts", "no-vendor.mjs"), runnerCopy);
    const markerPath = join(dir, "marker.txt");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: {
          "test:suite": `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`)}`,
        },
      }),
    );
    const bisDir = join(dir, ".bisellium");
    mkdirSync(bisDir, { recursive: true });
    chmodSync(bisDir, 0o555);

    const pre = mod.preflightBisDir(dir);
    check(
      3,
      "preflightBisDir itself reports not-ok for an unwritable .bisellium",
      pre.ok === false,
      JSON.stringify(pre),
    );

    const r = spawnSync(process.execPath, [runnerCopy], { cwd: dir, encoding: "utf8" });
    check(3, ".bisellium unwritable: the whole CLI exits non-zero", r.status !== 0, String(r.status));
    check(3, ".bisellium unwritable: the inner command never ran", !existsSync(markerPath), markerPath);
    chmodSync(bisDir, 0o755); // restore so cleanup can remove it
  }

  // Round-1 B2 regression: `import.meta.url === \`file://${process.argv[1]}\``
  // compares a percent-encoded URL against a raw path — false (main() never
  // runs, exit 0, NOTHING happened) on any checkout with a space in it. This
  // is the opposite assertion shape from every row above: the suite here is
  // SUPPOSED to run, and a space in the path must not stop it.
  {
    const outer = freshDir("b3-space");
    const dir = join(outer, "space test");
    mkdirSync(dir, { recursive: true });
    const shadowDir = join(dir, "test", "bin");
    installShim(shadowDir, "claude");
    installShim(shadowDir, "codex", CODEX_SHIM_SRC);
    mkdirSync(join(dir, "packages"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    const runnerCopy = join(dir, "scripts", "no-vendor.mjs");
    cpSync(join(REPO_ROOT, "scripts", "no-vendor.mjs"), runnerCopy);
    const markerPath = join(dir, "marker.txt");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: {
          "test:suite": `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`)}`,
        },
      }),
    );
    const r = spawnSync(process.execPath, [runnerCopy], { cwd: dir, encoding: "utf8" });
    check(
      3,
      "a checkout path with a space still runs main(): the suite executes and the runner exits 0",
      r.status === 0 && existsSync(markerPath),
      JSON.stringify({ status: r.status, markerExists: existsSync(markerPath) }),
    );
  }
}

// ---------------------------------------------------------------------------
// Behaviour 4 — activation is proved, not assumed.
// ---------------------------------------------------------------------------
if (runs(4) && requireBuilt(4)) {
  const dir = freshDir("b4");
  const shadowDir = join(dir, "test", "bin");
  installShim(shadowDir, "claude");
  installShim(shadowDir, "codex", CODEX_SHIM_SRC);
  const logPath = join(dir, ".bisellium", "vendor-violations.log");

  const fired = mod.selfTest(shadowDir, logPath);
  check(4, "selfTest() observes its own violation line and reports true", fired === true, String(fired));
  // Round-1 M12: the other half of "observes, not assumes" — a shim that IS
  // executable but writes nothing must report false, directly, at the unit
  // level (not only through runOnce's gate, see behaviour 3's new row).
  writeFileSync(join(shadowDir, "claude"), "#!/usr/bin/env node\nprocess.exit(1);\n");
  chmodSync(join(shadowDir, "claude"), 0o755);
  const notFired = mod.selfTest(shadowDir, logPath);
  check(4, "selfTest() reports false for a shim that never writes a line", notFired === false, String(notFired));
  installShim(shadowDir, "claude"); // restore the real, firing shim for the rest of this behaviour
  check(
    4,
    "the log is empty immediately after the self-test",
    readLines(logPath).length === 0,
    JSON.stringify(readLines(logPath)),
  );

  const resultPath = join(dir, "result.txt");
  const suiteCommand = `node -e ${JSON.stringify(
    `const fs=require('fs'); const p=${JSON.stringify(logPath)}; const c = fs.existsSync(p) ? fs.readFileSync(p,'utf8') : ''; fs.writeFileSync(${JSON.stringify(resultPath)}, c.length === 0 ? 'EMPTY' : 'NONEMPTY')`,
  )}`;
  const { result } = withCapturedStderr(() => mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand }));
  check(
    4,
    "the suite observes an empty log at start",
    readFileSync(resultPath, "utf8") === "EMPTY",
    readFileSync(resultPath, "utf8"),
  );
  check(
    4,
    "the whole run exits 0 (self-test spawned no vendor, no violation recorded)",
    result.exitCode === 0,
    String(result.exitCode),
  );
}

// ---------------------------------------------------------------------------
// Behaviour 5 — PATH precedence inside the suite, and the nested-`npm run`
// regression pin.
// ---------------------------------------------------------------------------
if (runs(5) && requireBuilt(5)) {
  const dir = freshDir("b5");
  const shadowDir = join(dir, "test", "bin");
  installShim(shadowDir, "claude");
  installShim(shadowDir, "codex", CODEX_SHIM_SRC);
  const resultPath = join(dir, "path.txt");
  const npmResultPath = join(dir, "npm-path.txt");

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        version: "0.0.0",
        scripts: {
          "echo-path": `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(npmResultPath)}, process.env.PATH)`)}`,
        },
      },
      null,
      2,
    ),
  );

  const suiteCommand = [
    `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(resultPath)}, process.env.PATH)`)}`,
    `npm run -s echo-path`,
  ].join(" && ");

  const inheritedPath = process.env.PATH ?? "";
  const { result } = withCapturedStderr(() => mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand }));
  const observed = readFileSync(resultPath, "utf8");
  const parts = observed.split(":");
  check(5, "the inner command observes the shadow dir as PATH[0]", parts[0] === shadowDir, observed);
  check(
    5,
    "the inherited PATH still follows, unchanged, behind it",
    observed === `${shadowDir}:${inheritedPath}`,
    observed,
  );

  const npmObserved = existsSync(npmResultPath) ? readFileSync(npmResultPath, "utf8") : "";
  const npmParts = npmObserved.split(":");
  check(
    5,
    "regression pin: an inner `npm run` sees node_modules/.bin ahead of the sentinel — the exact reason the runner never nests npm run",
    npmParts[0] !== shadowDir && npmObserved.includes("node_modules/.bin"),
    npmObserved,
  );
  check(5, "smoke: the run overall still exits 0", result.exitCode === 0, String(result.exitCode));
}

// ---------------------------------------------------------------------------
// Behaviour 6 — the runner's verdict table. No vendor name anywhere.
// ---------------------------------------------------------------------------
if (runs(6) && requireBuilt(6)) {
  function freshRunnerFixture() {
    const dir = freshDir("b6");
    const shadowDir = join(dir, "test", "bin");
    installShim(shadowDir, "claude");
    installShim(shadowDir, "codex", CODEX_SHIM_SRC);
    const logPath = join(dir, ".bisellium", "vendor-violations.log");
    return { dir, shadowDir, logPath };
  }

  {
    const { dir, shadowDir } = freshRunnerFixture();
    const { result } = withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand: 'node -e "process.exit(0)"' }),
    );
    check(6, "suite exits 0, no log -> runner exits 0", result.exitCode === 0, String(result.exitCode));
  }
  {
    const { dir, shadowDir } = freshRunnerFixture();
    const { result } = withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand: 'node -e "process.exit(1)"' }),
    );
    check(6, "suite exits 1, no log -> runner exits 1, unmasked", result.exitCode === 1, String(result.exitCode));
  }
  {
    const { dir, shadowDir, logPath } = freshRunnerFixture();
    const suiteCommand = `node -e ${JSON.stringify(`require('fs').appendFileSync(${JSON.stringify(logPath)}, 'line-one\\nline-two\\n')`)}`;
    const { result } = withCapturedStderr(() => mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand }));
    check(
      6,
      "suite exits 0 with a two-line log -> runner exits non-zero",
      result.exitCode !== 0,
      String(result.exitCode),
    );
    check(6, "...and reports both lines", result.log.length === 2, JSON.stringify(result.log));
  }
  {
    const { dir, shadowDir, logPath } = freshRunnerFixture();
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "stale-from-yesterday\n");
    const { result } = withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand: 'node -e "process.exit(0)"' }),
    );
    check(
      6,
      "a stale log before a clean run -> runner exits 0 (cleared at preflight)",
      result.exitCode === 0,
      String(result.exitCode),
    );
  }
}

// ---------------------------------------------------------------------------
// Behaviour 7 — the shadow composes end to end, with a FAKE vendor name.
// ---------------------------------------------------------------------------
if (runs(7) && requireBuilt(7)) {
  const dir = freshDir("b7");
  // Same "test/bin" nesting depth as every other fixture: the shim locates
  // its own repo root two directories up from itself, so a shadow dir at
  // any other depth would make it write outside this fixture entirely.
  const shadowDir = join(dir, "test", "bin");
  installShim(shadowDir, "claude");
  installShim(shadowDir, "codex", CODEX_SHIM_SRC);
  installShim(shadowDir, "bisellium-fake-vendor", CLAUDE_SHIM_SRC);

  const suiteCommand = "bisellium-fake-vendor --hello";
  const { result } = withCapturedStderr(() => mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand }));
  check(
    7,
    "a suite spawning a bare FAKE vendor name is caught, non-zero exit",
    result.exitCode !== 0,
    String(result.exitCode),
  );
  check(
    7,
    "the fake vendor's own line is in the snapshot",
    result.log.some((l) => l.includes("bisellium-fake-vendor")),
    JSON.stringify(result.log),
  );

  // packages/shim is TypeScript; import it the same way ci-workflow.test.mjs
  // reads ci.ts — a short-lived `node --import tsx` child, never a direct
  // import of a .ts file from plain node.
  const ENV_TS_URL = `file://${join(REPO_ROOT, "packages", "shim", "src", "harness", "env.ts")}`;
  let harnessEnvOut;
  try {
    const out = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(ENV_TS_URL)}).then(m=>process.stdout.write(JSON.stringify(m.harnessEnv({PATH:"x",FOO:"y"}))))`,
      ],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    harnessEnvOut = JSON.parse(out);
  } catch (err) {
    harnessEnvOut = { error: String(err) };
  }
  check(
    7,
    "harnessEnv passes an inherited PATH through verbatim (the runtime guard's own foundation)",
    harnessEnvOut && harnessEnvOut.PATH === "x" && !("FOO" in harnessEnvOut),
    JSON.stringify(harnessEnvOut),
  );
}

// ---------------------------------------------------------------------------
// Behaviour 8 — a swallowed failure is still caught.
// ---------------------------------------------------------------------------
if (runs(8) && requireBuilt(8)) {
  const dir = freshDir("b8");
  const shadowDir = join(dir, "test", "bin");
  installShim(shadowDir, "claude");
  installShim(shadowDir, "codex", CODEX_SHIM_SRC);
  // A fake name, not either bare vendor string — pin 10(b) scans this very
  // file's own source text for a spawn of one, and would (rightly) flag it
  // even though it would never really reach a vendor; a fake shadowed name
  // proves the exact same swallowed-failure property with zero ambiguity
  // about what's under test.
  const fakeName = "bisellium-fake-vendor-b8";
  installShim(shadowDir, fakeName, CLAUDE_SHIM_SRC);

  // The inner script spawns the shadowed name inside a try/catch that
  // discards the error and exits 0 — exactly createListingCache's and
  // harnessVersions' own shape.
  const inner = [
    "const { spawnSync } = require('node:child_process');",
    `try { spawnSync(${JSON.stringify(fakeName)}, ['debug']); } catch (e) { /* discarded, on purpose */ }`,
    "process.exit(0);",
  ].join(" ");
  const suiteCommand = `node -e ${JSON.stringify(inner)}`;
  const { result } = withCapturedStderr(() => mod.runOnce({ repoRoot: dir, shadowDir, suiteCommand }));
  check(
    8,
    "even though the inner script swallows the error and exits 0, the runner still exits non-zero",
    result.exitCode !== 0,
    String(result.exitCode),
  );
  check(8, "the violation is on record", result.log.length === 1, JSON.stringify(result.log));
}

// ---------------------------------------------------------------------------
// Behaviour 9 — the lock serialises runs and loses no violation; a crashed
// run wedges the checkout on purpose.
// ---------------------------------------------------------------------------
if (runs(9) && requireBuilt(9)) {
  function lockFixture(prefix) {
    const dir = freshDir(prefix);
    const shadowDir = join(dir, "test", "bin");
    installShim(shadowDir, "claude");
    installShim(shadowDir, "codex", CODEX_SHIM_SRC);
    const lockPath = join(dir, ".bisellium", "vendor-sentinel.lock");
    const logPath = join(dir, ".bisellium", "vendor-violations.log");
    return { dir, shadowDir, lockPath, logPath };
  }
  const markerSuite = (markerPath) =>
    `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`)}`;

  // Row 1: a second runner started while the lock is present exits
  // non-zero and never runs its suite. No liveness check anywhere.
  {
    const { dir, shadowDir, lockPath } = lockFixture("b9-1");
    mod.acquireLock(lockPath);
    const markerPath = join(dir, "marker.txt");
    const { result } = withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, lockPath, suiteCommand: markerSuite(markerPath) }),
    );
    check(9, "row 1: second runner refused while lock present", result.exitCode !== 0, String(result.exitCode));
    check(9, "row 1: its suite never ran", !existsSync(markerPath), markerPath);
    mod.releaseLock(lockPath);
  }

  // Row 2: clear-before-lock. A has written a violation; B starts; B must
  // not delete A's line.
  {
    const { dir, shadowDir, lockPath, logPath } = lockFixture("b9-2");
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "A-already-wrote-this\n");
    mod.acquireLock(lockPath);
    withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, lockPath, logPath, suiteCommand: 'node -e "process.exit(0)"' }),
    );
    check(
      9,
      "row 2 (clear-before-lock): A's line survives B's entire refused attempt",
      readFileSync(logPath, "utf8") === "A-already-wrote-this\n",
      readFileSync(logPath, "utf8"),
    );
    mod.releaseLock(lockPath);
  }

  // Row 3: release-before-adjudicate. A runs as a genuinely separate OS
  // process (so it can be raced against for real, not just called
  // in-process); its suite writes a violation and exits immediately. While
  // A's process is alive, this test polls — from OUTSIDE A's process, the
  // only way an external actor genuinely could — trying to acquire the same
  // lock. Rev 2's bug released the lock right after the suite's spawnSync
  // returned, BEFORE reading the log; ours reads the snapshot first and
  // releases last, so the lock must never come free until A's whole process
  // (acquire-through-adjudicate-through-release) has finished.
  {
    const { dir, shadowDir, lockPath, logPath } = lockFixture("b9-3");
    const aResultPath = join(dir, "a-result.json");
    const aScript = join(dir, "run-a.mjs");
    const suiteInner = `require('fs').appendFileSync(${JSON.stringify(logPath)}, 'row3-violation\\n')`;
    writeFileSync(
      aScript,
      [
        `import { runOnce } from ${JSON.stringify(`file://${join(REPO_ROOT, "scripts", "no-vendor.mjs")}`)};`,
        `import { writeFileSync } from "node:fs";`,
        `const r = runOnce({ repoRoot: ${JSON.stringify(dir)}, shadowDir: ${JSON.stringify(shadowDir)}, lockPath: ${JSON.stringify(lockPath)}, logPath: ${JSON.stringify(logPath)}, suiteCommand: ${JSON.stringify(`node -e ${JSON.stringify(suiteInner)}`)} });`,
        `writeFileSync(${JSON.stringify(aResultPath)}, JSON.stringify(r));`,
      ].join("\n"),
    );

    const aChild = spawn(process.execPath, [aScript], { stdio: "ignore" });
    let aExited = false;
    aChild.on("exit", () => {
      aExited = true;
    });

    // A free lock only counts as a real race if A had NOT yet produced its
    // result at that instant — the 'exit' event and this poll loop's own
    // timer both ride the same event loop, so a free lock noticed a tick
    // after A's own natural, correctly-ordered completion is expected, not
    // a bug: it is exactly what "release last" looks like from outside.
    let racedEarly = false;
    let attempts = 0;
    const pollDeadline = Date.now() + 8000;
    while (!aExited && Date.now() < pollDeadline) {
      attempts++;
      try {
        closeSync(openSync(lockPath, "wx"));
        if (!existsSync(aResultPath)) racedEarly = true;
        unlinkSync(lockPath); // we're not the real owner — undo the damage.
      } catch {
        /* expected: A still holds it */
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    const flushDeadline = Date.now() + 8000;
    while (!existsSync(aResultPath) && Date.now() < flushDeadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const aResult = existsSync(aResultPath) ? JSON.parse(readFileSync(aResultPath, "utf8")) : { log: [] };
    check(
      9,
      "row 3: A's adjudication still reports the violation",
      Array.isArray(aResult.log) && aResult.log.includes("row3-violation"),
      JSON.stringify(aResult),
    );
    check(
      9,
      "row 3: the lock was never free before A had already produced its (correct) result",
      racedEarly === false,
      `attempts=${attempts}`,
    );
  }

  // Row 4: a lock left behind by a crashed run refuses the next run; the
  // message names the file, the recorded pid and start time, and the rm.
  {
    const { dir, shadowDir, lockPath } = lockFixture("b9-4");
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: 424242, startedAt: "2020-01-01T00:00:00.000Z" }));
    const { result, stderr } = withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, lockPath, suiteCommand: 'node -e "process.exit(0)"' }),
    );
    check(9, "row 4: refused, non-zero", result.exitCode !== 0, String(result.exitCode));
    check(9, "row 4: the message names the lock file", stderr.includes(lockPath), stderr);
    check(9, "row 4: the message names the recorded pid", stderr.includes("424242"), stderr);
    check(9, "row 4: the message names the start time", stderr.includes("2020-01-01T00:00:00.000Z"), stderr);
    check(9, "row 4: the message names the exact rm to run", stderr.includes(`rm ${lockPath}`), stderr);
  }

  // Row 5: released on the passing path, the failing path, and on a throw.
  {
    const { dir, shadowDir, lockPath } = lockFixture("b9-5-pass");
    withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, lockPath, suiteCommand: 'node -e "process.exit(0)"' }),
    );
    check(9, "row 5: lock released on the passing path", !existsSync(lockPath), lockPath);
  }
  {
    const { dir, shadowDir, lockPath } = lockFixture("b9-5-fail");
    withCapturedStderr(() =>
      mod.runOnce({ repoRoot: dir, shadowDir, lockPath, suiteCommand: 'node -e "process.exit(1)"' }),
    );
    check(9, "row 5: lock released on the failing path", !existsSync(lockPath), lockPath);
  }
  {
    const { dir, shadowDir, lockPath, logPath } = lockFixture("b9-5-throw");
    // logPath IS a directory, not a file — clearLog()'s writeFileSync throws.
    mkdirSync(logPath, { recursive: true });
    let threw = false;
    try {
      mod.runOnce({ repoRoot: dir, shadowDir, lockPath, logPath, suiteCommand: 'node -e "process.exit(0)"' });
    } catch {
      threw = true;
    }
    check(9, "row 5: the throw path actually threw (test validity)", threw, String(threw));
    check(9, "row 5: lock released even on a throw", !existsSync(lockPath), lockPath);
  }
}

// ---------------------------------------------------------------------------
// Behaviour 10 — the static pins, each with a positive control.
// ---------------------------------------------------------------------------
if (runs(10) && requireBuilt(10)) {
  // (a) bare name vs. path.
  {
    const dir = freshDir("b10a");
    mkdirSync(join(dir, "packages", "fake"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "fake", "bad.ts"),
      `import { spawnSync } from "node:child_process";\nspawnSync("/usr/local/bin/claude", []);\n`,
    );
    writeFileSync(
      join(dir, "packages", "fake", "good.ts"),
      `import { spawnSync } from "node:child_process";\nspawnSync("claude", []);\n`,
    );
    const violations = mod.scanBareVendorSpawns({
      repoRoot: dir,
      dirs: ["packages"],
      shadowNames: ["claude", "codex"],
    });
    check(
      10,
      "pin (a) positive control: a path spawn of a shadowed name is flagged",
      violations.some((v) => v.file.includes("bad.ts")),
      JSON.stringify(violations),
    );
    check(
      10,
      "pin (a) negative control: a bare-name spawn is not flagged",
      !violations.some((v) => v.file.includes("good.ts")),
      JSON.stringify(violations),
    );
  }

  // (b) no test file spawns the bare vendor string.
  {
    const dir = freshDir("b10b");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(
      join(dir, "scripts", "bad.test.mjs"),
      `import { spawnSync } from "node:child_process";\nspawnSync("codex", []);\n`,
    );
    writeFileSync(
      join(dir, "scripts", "good.test.mjs"),
      `import { spawnSync } from "node:child_process";\nspawnSync("bisellium-fake-vendor", []);\n`,
    );
    const violations = mod.scanTestFilesForVendorNames({ repoRoot: dir, dirs: ["scripts"] });
    check(
      10,
      "pin (b) positive control: a test spawning the bare vendor string is flagged",
      violations.some((v) => v.file.includes("bad.test.mjs")),
      JSON.stringify(violations),
    );
    check(
      10,
      "pin (b) negative control: a test spawning a fake name is not flagged",
      !violations.some((v) => v.file.includes("good.test.mjs")),
      JSON.stringify(violations),
    );
  }

  // (c) test-supplied PATH: inherited / shadow-marked / machine-checked.
  {
    const dir = freshDir("b10c");
    const fakeBinDir = join(dir, "fakebin");
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(join(fakeBinDir, "claude"), "#!/usr/bin/env node\n");
    chmodSync(join(fakeBinDir, "claude"), 0o755);
    mkdirSync(join(dir, "packages"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "paths.test.ts"),
      [
        `const reachable = { PATH: "${fakeBinDir}" };`, // (c) violates — resolves a shadowed binary here.
        `const safe = { PATH: "/nonexistent-w046-bin" };`, // (c) passes — nothing there.
        `const inherited = { PATH: \`\${x}:\${process.env.PATH}\` };`, // (a) passes.
        `const marked = { PATH: \`\${x}:SHADOW_DIR_REL\` };`, // (b) passes.
        "",
      ].join("\n"),
    );
    const violations = mod.scanTestSuppliedPaths({
      repoRoot: dir,
      dirs: ["packages"],
      shadowNames: ["claude", "codex"],
    });
    check(
      10,
      "pin (c) positive control: a PATH resolving a shadowed binary here is flagged",
      violations.length === 1,
      JSON.stringify(violations),
    );
    check(
      10,
      "pin (c) negative control: inherited/marked/nonexistent PATHs are not flagged",
      violations.every((v) => v.line === 1),
      JSON.stringify(violations),
    );
  }

  // The honest pre-implementation red: with test/bin/ absent, the shadow
  // set read by runStaticPins' default is empty.
  check(
    10,
    "readShadowNames on a nonexistent dir returns []",
    JSON.stringify(mod.readShadowNames(join(freshDir("b10-empty"), "nope"))) === "[]",
  );
}

// ---------------------------------------------------------------------------
// Behaviour 11 — the log cannot dirty the tree.
// ---------------------------------------------------------------------------
if (runs(11) && requireBuilt(11)) {
  check(11, "LOG_REL lives under .bisellium/", mod.LOG_REL.startsWith(".bisellium/"), mod.LOG_REL);
  check(11, "LOCK_REL lives under .bisellium/", mod.LOCK_REL.startsWith(".bisellium/"), mod.LOCK_REL);

  const dir = freshDir("b11");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), ".bisellium/\n");
  writeFileSync(join(dir, "README.md"), "fixture\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

  const before = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  mkdirSync(join(dir, ".bisellium"), { recursive: true });
  appendFileSync(join(dir, mod.LOG_REL), "a-recorded-violation\n");
  writeFileSync(join(dir, mod.LOCK_REL), JSON.stringify({ pid: 1, startedAt: "x" }));
  const after = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  check(
    11,
    "git status --porcelain is byte-identical after a violation and a lock are recorded",
    before === after,
    JSON.stringify({ before, after }),
  );

  // Round-1 B1(iii): the brief's own second clause — "`.bisellium` is in
  // the exclusion set `verify` computes" — had no assertion anywhere in the
  // repo. Exercise the real, unmodified packages/commands/src/verify.ts
  // (imported the same way behaviour 7 reaches TypeScript, via a short-lived
  // `node --import tsx` child) end to end: a recorded violation under
  // `.bisellium/` must never make `verify` refuse the tree as dirty.
  // Removing ".bisellium" from verify.ts's excludeDirs (M15) makes it dirty
  // and this check fails.
  {
    const vdir = freshDir("b11-verify");
    execFileSync("git", ["init", "-q", "-b", "master"], { cwd: vdir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: vdir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: vdir });
    const vstudio = join(vdir, "studio");
    mkdirSync(join(vstudio, "opera"), { recursive: true });
    writeFileSync(
      join(vstudio, "bisellium.yml"),
      "bisellium: 1\nstudio: Test\ncollegia: []\nsellae: []\nprobationes: []\n",
    );
    writeFileSync(
      join(vstudio, "opera", "W-999.md"),
      [
        "---",
        "id: W-999",
        "title: verify exclusion fixture",
        "kind: feature",
        "collegium: engineering",
        "state: building",
        "probationes: {}",
        "---",
        "Body.",
        "",
      ].join("\n"),
    );
    execFileSync("git", ["add", "-A"], { cwd: vdir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: vdir });
    execFileSync("git", ["branch", "opus/W-999"], { cwd: vdir });
    execFileSync("git", ["checkout", "-q", "opus/W-999"], { cwd: vdir });
    mkdirSync(join(vdir, ".bisellium"), { recursive: true });
    writeFileSync(join(vdir, ".bisellium", "vendor-violations.log"), "a-recorded-violation\n");

    const verifyTsUrl = `file://${join(REPO_ROOT, "packages", "commands", "src", "verify.ts")}`;
    const script = [
      `import { runVerify } from ${JSON.stringify(verifyTsUrl)};`,
      `let stderr = ''; const orig = console.error;`,
      `console.error = (...a) => { stderr += a.join(' ') + '\\n'; };`,
      `const r = await runVerify([${JSON.stringify("W-999")}, '--studio', ${JSON.stringify(vstudio)}, '--repo', ${JSON.stringify(vdir)}]);`,
      `console.error = orig;`,
      `process.stdout.write(JSON.stringify({ exitCode: r.exitCode, stderr }));`,
    ].join("\n");
    let out = { exitCode: -1, stderr: "<child did not run>" };
    try {
      const raw = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        encoding: "utf8",
        cwd: REPO_ROOT,
      });
      out = JSON.parse(raw);
    } catch (err) {
      out = { exitCode: -1, stderr: String(err) };
    }
    check(
      11,
      "verify's own excludeDirs covers .bisellium: a recorded violation under it never trips the dirty-tree refusal",
      !out.stderr.includes("working tree is dirty"),
      JSON.stringify(out),
    );
  }
}

// ---------------------------------------------------------------------------
for (const dir of dirsToClean) {
  try {
    chmodSync(dir, 0o755);
  } catch {
    /* ignore */
  }
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
