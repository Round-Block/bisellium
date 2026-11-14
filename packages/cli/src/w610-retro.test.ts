/**
 * W-610 behaviour 7 (studio/briefs/W-610.md, D-198 ruling 1, D-199): the daily retro reads every gate status form the
 * pipeline writes. `packages/pipeline` writes a gate log's line 3 as `exit code: <n>`, `exit code: (timed out after <m>m)`,
 * `exit code: (error <code>)` or `exit code: (signal <name>)`; `retro --daily` reads each, `0` a pass and every other
 * form a failed gate, and the writer's forms go through one exported helper (`gateStatusLine`) that the reader's parser
 * (`readGateExit`) round-trips. It copies the real `studio/ci/W-563-tests-90514cbc.log` into a temp officina, so it is a
 * test:record file. Select it with --test-name-pattern='^W-610-b7\s'.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { initStudio } from "./init.js";
import { runRetro } from "./retro.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REAL_LOG = "W-563-tests-90514cbc.log";
const NOW = new Date("2026-11-13T09:00:00Z");
const DAY = "2026-11-12";
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-610-b[1-9] /, "");
  test(name, { timeout: 600_000 }, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}

const put = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
/** A temp officina in a git repository (retro --daily reads the main checkout's step markers), its tracker holding the day before. */
function officina(tag: string): string {
  const root = join(mkdtempSync(join(tmpdir(), `bisellium-w610-retro-${tag}-`)), "studio");
  made.push(join(root, ".."));
  execFileSync("git", ["init", "-q"], { cwd: join(root, "..") });
  initStudio(root, { now: NOW });
  for (const d of ["ci", "opera"]) mkdirSync(join(root, d), { recursive: true });
  put(
    root,
    "bisellium.yml",
    [
      "bisellium: 1",
      "studio: w610",
      "patron: patron",
      "collegia:",
      "  - { id: production, name: Production, magister: producer }",
      "  - { id: design, name: Design, magister: architect }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: producer, collegium: production, kind: agent }",
      "  - { id: architect, collegium: design, kind: agent }",
      "  - { id: qa-lead, collegium: qa, kind: agent }",
      "probationes:",
      "  - { id: tests, name: Tests, kind: automated }",
      "wip_limit: 9",
      "",
    ].join("\n"),
  );
  put(root, "acta/improvements.md", `---\nauthor: producer\nkind: daily\ntitle: "Improvements tracker"\nat: 2026-10-17T00:00:00Z\n---\n# Improvements tracker\n\n| Change | Status |\n|---|---|\n| W-1 | done |\n\n## Daily retro\n\n### 2026-11-11\n\n- fixture entry\n`);
  return root;
}
const done = (root: string, id: string): void =>
  put(root, `opera/${id}.md`, `---\nid: "${id}"\ntitle: "fixture ${id}"\nkind: "opus"\ncollegium: "qa"\nstate: done\nprobationes: {}\nend: ${DAY}T12:00:00Z\n---\n`);
/** A gate log whose line 3 is `head` (none when undefined), beside a failing W-7-b2 row. */
const gate = (root: string, id: string, tree8: string, head: string | undefined): void =>
  put(root, `ci/${id}-tests-${tree8}.log`, [`certifies: tree:${tree8}${"0".repeat(32)}`, "command: npm test", ...(head === undefined ? [] : [head]), "", "✖ W-7-b2 behaviour 2: a census row fails (5ms)", "  AssertionError [ERR_ASSERTION]", ""].join("\n"));

function daily(root: string): { status: number; out: string; err: string } {
  const [log, error] = [console.log, console.error];
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...a: unknown[]): void => void out.push(a.join(" "));
  console.error = (...a: unknown[]): void => void err.push(a.join(" "));
  try {
    return { status: runRetro(["--daily", "--studio", root, "--now", NOW.toISOString()]).exitCode, out: out.join("\n"), err: err.join("\n") };
  } finally {
    [console.log, console.error] = [log, error];
  }
}
const shown = (r: { status: number; out: string; err: string }): string => `exit ${r.status}\n--- stdout\n${r.out}\n--- stderr\n${r.err}`;
const section = (root: string): string[] => readFileSync(join(root, "acta/improvements.md"), "utf8").split("\n");

row("W-610-b7 retro --daily reads the real W-563 timeout log as a failed tests gate", () => {
  const root = officina("real");
  done(root, "W-563");
  copyFileSync(join(REPO_ROOT, "studio", "ci", REAL_LOG), join(root, "ci", REAL_LOG));
  assert.equal(readFileSync(join(root, "ci", REAL_LOG), "utf8").split("\n")[2], "exit code: (timed out after 30m)", "the real log's line 3 is the timeout form");
  const r = daily(root);
  assert.equal(r.status, 0, `retro --daily exits 0: ${shown(r)}`);
  assert.ok(section(root).includes(`| W-563 | ci/${REAL_LOG} | gate×tests |  |`), `the timed-out tests log is a failed tests gate: ${shown(r)}`);
});

const FAILED_FORMS = ["exit code: (timed out after 30m)", "exit code: (timed out after 0.005m)", "exit code: (error ENOBUFS)", "exit code: (error unknown)", "exit code: (signal SIGKILL)", "exit code: (signal unknown)", "exit code: 3"];

row("W-610-b7 each non-numeric writer form is a failed gate", () => {
  const root = officina("forms");
  FAILED_FORMS.forEach((head, i) => {
    done(root, `W-${20 + i}`);
    gate(root, `W-${20 + i}`, `${i}`.repeat(8), head);
  });
  done(root, "W-40");
  gate(root, "W-40", "eeeeeeee", "exit code: 0");
  const r = daily(root);
  assert.equal(r.status, 0, `retro --daily exits 0 over every writer form: ${shown(r)}`);
  const lines = section(root);
  FAILED_FORMS.forEach((head, i) => {
    const id = `W-${20 + i}`;
    assert.ok(lines.includes(`| ${id} | ci/${id}-tests-${`${i}`.repeat(8)}.log | gate×W-7 | W-7-b2 |`), `${head} is a failed gate classed by its failing row: ${shown(r)}`);
  });
  assert.ok(!lines.some((l) => l.includes("ci/W-40-tests-eeeeeeee.log")), `exit code: 0 is a pass, no row: ${shown(r)}`);
});

row("W-610-b7 a head in no writer form still refuses the retro", () => {
  for (const head of ["exit code: banana", "exit code: (timed out)", "exit code: ()", undefined]) {
    const root = officina("refuse");
    done(root, "W-30");
    gate(root, "W-30", "aaaaaaaa", head);
    const r = daily(root);
    assert.equal(r.status, 2, `a head in no writer form refuses the retro (${head ?? "no exit line"}): ${shown(r)}`);
    assert.match(r.err, /ci\/W-30-tests-aaaaaaaa\.log: a gate log carries an "exit code: <n>" line in its head/, `the refusal names the log: ${shown(r)}`);
  }
});

row("W-610-b7 every writer form round-trips through the reader", async () => {
  const pipeline = (await import("@bisellium/pipeline")) as Record<string, unknown>;
  assert.equal(typeof pipeline["gateStatusLine"], "function", "@bisellium/pipeline exports gateStatusLine, the writer's one status-line formatter");
  assert.equal(typeof pipeline["readGateExit"], "function", "@bisellium/pipeline exports readGateExit, the reader's one parser");
  type Outcome = { timedOut: boolean; timeoutMs: number; error?: { code?: string }; status: number | null; signal: string | null };
  const line = pipeline["gateStatusLine"] as (o: Outcome) => string;
  const read = pipeline["readGateExit"] as (l: string) => { passed: boolean; form: string } | undefined;
  const T = 30 * 60_000;
  const cases: [Outcome, string, string, boolean][] = [
    [{ timedOut: false, timeoutMs: T, status: 0, signal: null }, "exit code: 0", "code", true],
    [{ timedOut: false, timeoutMs: T, status: 3, signal: null }, "exit code: 3", "code", false],
    [{ timedOut: true, timeoutMs: T, status: null, signal: "SIGTERM" }, "exit code: (timed out after 30m)", "timeout", false],
    [{ timedOut: true, timeoutMs: 300, status: null, signal: null }, "exit code: (timed out after 0.005m)", "timeout", false],
    [{ timedOut: false, timeoutMs: T, error: { code: "ENOBUFS" }, status: 0, signal: null }, "exit code: (error ENOBUFS)", "error", false],
    [{ timedOut: false, timeoutMs: T, error: {}, status: null, signal: null }, "exit code: (error unknown)", "error", false],
    [{ timedOut: false, timeoutMs: T, status: null, signal: "SIGKILL" }, "exit code: (signal SIGKILL)", "signal", false],
    [{ timedOut: false, timeoutMs: T, status: null, signal: null }, "exit code: (signal unknown)", "signal", false],
  ];
  for (const [outcome, expected, form, passed] of cases) {
    assert.equal(line(outcome), expected, `the writer's form for ${JSON.stringify(outcome)}`);
    assert.deepEqual(read(line(outcome)), { passed, form }, `the reader reads ${expected} back`);
  }
  for (const bad of ["exit code: banana", "exit code: (timed out)", "exit code: ()", "exit code: 3 ", "exit code:"]) assert.equal(read(bad), undefined, `no writer form: ${bad}`);
  // the real writer: localPipeline.run's line 3 is gateStatusLine of its run's outcome, for the numeric and the signal form
  const { localPipeline, GATE_TIMEOUT_MS } = (await import("@bisellium/pipeline")) as typeof import("@bisellium/pipeline");
  const dir = mkdtempSync(join(tmpdir(), "bisellium-w610-writer-"));
  made.push(dir);
  await localPipeline.run({
    opus: { id: "W-7" } as never,
    repo: dir,
    commands: { tests: "exit 3", lint: "kill -KILL $$" },
    treeHash: "0123456789abcdef0123456789abcdef01234567",
    logDir: join(dir, "ci"),
    now: NOW,
    studioDir: dir,
  });
  const third = (gateId: string): string | undefined => readFileSync(join(dir, "ci", `W-7-${gateId}-01234567.log`), "utf8").split("\n")[2];
  assert.equal(third("tests"), line({ timedOut: false, timeoutMs: GATE_TIMEOUT_MS, status: 3, signal: null }), "a real exit 3's line 3 is the helper's numeric form");
  assert.equal(third("lint"), line({ timedOut: false, timeoutMs: GATE_TIMEOUT_MS, status: null, signal: "SIGKILL" }), "a real SIGKILL's line 3 is the helper's signal form");
});

// spec review r8 #1: a multiline command is one line 2, and the head's one status field is line 3
const MULTI = "echo start\nexit code: 0";
row("W-610-b7 a multiline command's status-shaped line never stands for the gate's status", async () => {
  const pipeline = (await import("@bisellium/pipeline")) as Record<string, unknown>;
  assert.equal(typeof pipeline["gateCommandLine"], "function", "@bisellium/pipeline exports gateCommandLine, line 2's one single-line encoder");
  assert.equal(typeof pipeline["readGateStatus"], "function", "@bisellium/pipeline exports readGateStatus, the head's one status-field reader");
  const encode = pipeline["gateCommandLine"] as (c: string) => string;
  const status = pipeline["readGateStatus"] as (t: string) => { passed: boolean; form: string } | { error: string };
  for (const c of ["npm test -s", "exit 3", 'node -e "1"', "a\tb", "json:x"]) assert.equal(encode(c), `command: ${c}`, `a single-line command's bytes are unchanged (D-198): ${JSON.stringify(c)}`);
  for (const c of [MULTI, "a\rb", "a\r\nexit code: 0", "a\u0000b"]) assert.equal(encode(c), `command: json:${JSON.stringify(c)}`, `a command holding a control character is one JSON line: ${JSON.stringify(c)}`);
  // the real writer: a failing multiline command whose second line is `exit code: 0`
  const { localPipeline } = (await import("@bisellium/pipeline")) as typeof import("@bisellium/pipeline");
  const dir = mkdtempSync(join(tmpdir(), "bisellium-w610-multi-"));
  made.push(dir);
  await localPipeline.run({ opus: { id: "W-7" } as never, repo: dir, commands: { tests: MULTI, lint: "exit 3" }, treeHash: "0123456789abcdef0123456789abcdef01234567", logDir: join(dir, "ci"), now: NOW, studioDir: dir });
  const text = readFileSync(join(dir, "ci", "W-7-tests-01234567.log"), "utf8");
  const lines = text.split("\n");
  assert.equal(lines[1], `command: json:${JSON.stringify(MULTI)}`, "the multiline command is one line 2");
  assert.match(lines[2] ?? "", /^exit code: [1-9]\d*$/, "line 3 is the failing run's status");
  assert.deepEqual(lines.slice(0, lines.indexOf("")).filter((l) => l.startsWith("exit code:")), [lines[2]], "the head holds one status line");
  assert.deepEqual(status(text), { passed: false, form: "code" }, "the reader reads the run's failure, never the command's line");
  assert.equal(readFileSync(join(dir, "ci", "W-7-lint-01234567.log"), "utf8").split("\n")[1], "command: exit 3", "a single-line command's line 2 is unchanged");
  const root = officina("multi");
  done(root, "W-7");
  copyFileSync(join(dir, "ci", "W-7-tests-01234567.log"), join(root, "ci", "W-7-tests-01234567.log"));
  const r = daily(root);
  assert.equal(r.status, 0, `retro --daily exits 0: ${shown(r)}`);
  assert.ok(section(root).includes("| W-7 | ci/W-7-tests-01234567.log | gate×tests |  |"), `the failing multiline command's log is a failed tests gate: ${shown(r)}`);
});

row("W-610-b7 a missing, duplicate or misplaced status field refuses the retro", async () => {
  const { readGateStatus } = (await import("@bisellium/pipeline")) as unknown as Record<string, (t: string) => unknown>;
  assert.equal(typeof readGateStatus, "function", "@bisellium/pipeline exports readGateStatus");
  const heads: [string, string[]][] = [
    ["an old raw multiline command, its line `exit code: 0` before the real status", ["command: echo start", "exit code: 0", "exit code: 2"]],
    ["a second status line in the head", ["command: npm test", "exit code: 0", "exit code: 1"]],
    ["a status line pushed to line 4", ["command: echo a", "echo b", "exit code: 1"]],
    ["no status line", ["command: npm test"]],
  ];
  for (const [what, head] of heads) {
    const text = [`certifies: tree:aaaaaaaa${"0".repeat(32)}`, ...head, "", "output", ""].join("\n");
    const read = readGateStatus!(text) as Record<string, unknown>;
    assert.ok(typeof read["error"] === "string", `the reader refuses ${what}: ${JSON.stringify(read)}`);
    const root = officina("field");
    done(root, "W-30");
    put(root, "ci/W-30-tests-aaaaaaaa.log", text);
    const r = daily(root);
    assert.equal(r.status, 2, `${what} refuses the retro: ${shown(r)}`);
    assert.match(r.err, /ci\/W-30-tests-aaaaaaaa\.log: a gate log carries an "exit code: <n>" line in its head/, `the refusal names the log (${what}): ${shown(r)}`);
  }
});
