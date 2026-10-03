/**
 * scripts/cascade-loop.test.mjs — the restart loop in scripts/cascade-loop.sh.
 * node:test, plain node, TAP:
 *   node --test-reporter=tap scripts/cascade-loop.test.mjs
 *
 * CLAUDE_BIN is a synchronous stub: it appends a line to a counter file,
 * records its cwd, argv and whether the status file already existed, then
 * writes the next status from a scripted list (NONE writes nothing, FAIL
 * writes CONTINUE and exits nonzero). No real claude, no network, no sleeps.
 * Every test checks the run count before anything else, so while the script
 * is absent each one fails on its own assertion, not on a missing file.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "cascade-loop.sh");

const STUB = `#!/usr/bin/env bash
d=$STUB_DIR
echo run >> "$d/count"
n=$(wc -l < "$d/count")
n=\${n// /}
pwd -P > "$d/cwd.$n"
printf '%s\\0' "$@" > "$d/argv.$n"
if [ -e "$CASCADE_STATUS" ]; then echo yes > "$d/stale.$n"; else echo no > "$d/stale.$n"; fi
echo "stub run $n"
w=$(sed -n "\${n}p" "$d/script")
case $w in
  NONE | "") ;;
  FAIL) echo CONTINUE > "$CASCADE_STATUS"; exit 3 ;;
  *) echo "$w" > "$CASCADE_STATUS" ;;
esac
`;

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A temp world: HOME, AGENT_CLONE, status path and a stub fed `statuses`. */
const world = (statuses, env = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cascade-loop-")));
  roots.push(root);
  const home = join(root, "home");
  const clone = join(root, "clone");
  const stubDir = join(root, "stub");
  for (const d of [home, clone, stubDir]) mkdirSync(d);
  const stub = join(stubDir, "claude");
  writeFileSync(stub, STUB, { mode: 0o755 });
  writeFileSync(join(stubDir, "script"), statuses.join("\n") + "\n");
  const status = join(root, "status");
  const base = { ...process.env, HOME: home, AGENT_CLONE: clone, CASCADE_STATUS: status };
  delete base.CASCADE_MAX_RUNS;
  const run = () =>
    spawnSync(SCRIPT, [], {
      encoding: "utf8",
      env: { ...base, CLAUDE_BIN: stub, STUB_DIR: stubDir, ...env },
    });
  const read = (name) => readFileSync(join(stubDir, name), "utf8");
  const runs = () => (existsSync(join(stubDir, "count")) ? read("count").trim().split("\n").length : 0);
  const logDir = join(home, ".bisellium-evidence", "cascade-runs");
  return { clone, status, run, read, runs, logDir };
};

const said = (r) => `${r.stdout}${r.stderr}`;

test("1. CONTINUE, CONTINUE, NEEDS_PATRON: three runs, nonzero, names NEEDS_PATRON and the log", () => {
  const w = world(["CONTINUE", "CONTINUE", "NEEDS_PATRON"]);
  const r = w.run();
  assert.equal(w.runs(), 3);
  assert.notEqual(r.status, 0);
  assert.match(said(r), /NEEDS_PATRON/);
  assert.ok(said(r).includes(w.logDir), said(r));
  assert.equal(readdirSync(w.logDir).length, 3);
});

test("2. QUEUE_EMPTY on the first run: one run, exit 0", () => {
  const w = world(["QUEUE_EMPTY"]);
  const r = w.run();
  assert.equal(w.runs(), 1);
  assert.equal(r.status, 0, said(r));
});

test("3. no status written: one run, nonzero, the status is reported missing", () => {
  const w = world(["NONE"]);
  const r = w.run();
  assert.equal(w.runs(), 1);
  assert.notEqual(r.status, 0);
  assert.match(said(r), /status.*missing/i);
});

test("4. the stub exits nonzero: the loop stops after one run, whatever the status says", () => {
  const w = world(["FAIL", "CONTINUE"]);
  const r = w.run();
  assert.equal(w.runs(), 1);
  assert.notEqual(r.status, 0);
});

test("5. always CONTINUE with CASCADE_MAX_RUNS=2: exactly two runs, then the cap message", () => {
  const w = world(Array(10).fill("CONTINUE"), { CASCADE_MAX_RUNS: "2" });
  const r = w.run();
  assert.equal(w.runs(), 2);
  assert.notEqual(r.status, 0);
  assert.match(said(r), /CASCADE_MAX_RUNS/);
});

test("6a. the stub runs with cwd == AGENT_CLONE", () => {
  const w = world(["QUEUE_EMPTY"]);
  w.run();
  assert.equal(w.runs(), 1);
  assert.equal(w.read("cwd.1").trim(), w.clone);
});

test("6b. the stub receives -p", () => {
  const w = world(["QUEUE_EMPTY"]);
  w.run();
  assert.equal(w.runs(), 1);
  assert.ok(w.read("argv.1").split("\0").includes("-p"));
});

test("6c. the prompt carries the status path", () => {
  const w = world(["QUEUE_EMPTY"]);
  w.run();
  assert.equal(w.runs(), 1);
  const argv = w.read("argv.1").split("\0");
  assert.ok(argv[argv.indexOf("-p") + 1]?.includes(w.status), argv.join(" | "));
});

test("6d. headless flags: --permission-mode auto, and stream-json with the --verbose it requires", () => {
  const w = world(["QUEUE_EMPTY"]);
  w.run();
  assert.equal(w.runs(), 1);
  const argv = w.read("argv.1").split("\0");
  assert.equal(argv[argv.indexOf("--permission-mode") + 1], "auto", argv.join(" | "));
  assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json", argv.join(" | "));
  assert.ok(argv.includes("--verbose"), argv.join(" | "));
});

test("7. a stale status is deleted before each run, so a silent run cannot inherit CONTINUE", () => {
  const w = world(["CONTINUE", "NONE"]);
  writeFileSync(w.status, "CONTINUE\n");
  const r = w.run();
  assert.equal(w.runs(), 2);
  assert.equal(w.read("stale.1").trim(), "no");
  assert.equal(w.read("stale.2").trim(), "no");
  assert.match(said(r), /status.*missing/i);
});

test("8. LOW_CREDIT stops the loop, nonzero, and says so", () => {
  const w = world(["LOW_CREDIT", "CONTINUE"]);
  const r = w.run();
  assert.equal(w.runs(), 1);
  assert.notEqual(r.status, 0);
  assert.match(said(r), /LOW_CREDIT/);
});

test("9. an unknown status stops the loop, nonzero, and names the word", () => {
  const w = world(["BOGUS", "CONTINUE"]);
  const r = w.run();
  assert.equal(w.runs(), 1);
  assert.notEqual(r.status, 0);
  assert.match(said(r), /BOGUS/);
});
