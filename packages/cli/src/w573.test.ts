/**
 * W-573 (studio/briefs/W-573.md): a red is recorded only where certify would replay it. Rows are named
 * `W-573-b<n> behaviour <n>: …` and selected with `--test-name-pattern='^W-573-b<n>\s'`.
 * b1: certify's classifier (scripts/replay-accept.mjs) reads a read-only-mount throw as an environment failure.
 * b2: `red`, for an opted-in brief, runs the command again in certify's empty-HOME cell and records nothing unless both
 * runs are one red that classifier accepts; the reds perform (`next --perform --expect reds`) records through it.
 * No row reads studio/, the host's HOME or ~/.codex; every scratch path is under os.tmpdir().
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyReplay } from "../../../scripts/replay-accept.mjs";
import { BRIEF_REL, BUDGET, OPUS, briefText, commit, envFor, expectStep, git, next, put, ran, ticketed, world } from "./next-world.test.js";

/** A one-test TAP report whose failing block carries `code` and `error` as node:test prints them. */
const tap = (code: string, error: string): string =>
  [
    "TAP version 13",
    "# Subtest: W-900-b3 behaviour 3: a scratch officina",
    "not ok 1 - W-900-b3 behaviour 3: a scratch officina",
    "  ---",
    "  duration_ms: 3.1",
    "  type: 'test'",
    "  failureType: 'testCodeFailure'",
    `  error: '${error}'`,
    `  code: '${code}'`,
    "  ...",
    "1..1",
    "# fail 1",
    "",
  ].join("\n");

test("W-573-b1 behaviour 1: a throw from a read-only mount is an environment failure, not an assertion red", () => {
  // the 11-10 b3 rows: mkdtemp under a read-only /tmp, the test's own error, no assertion
  const thrown = classifyReplay({ status: 1, output: tap("EROFS", "EROFS: read-only file system, mkdtemp '/tmp/w562-b3-XXXXXX'") });
  assert.equal(thrown.accepted, false, "a read-only mount's throw is refused");
  assert.equal(thrown.reason, "the output names an environment failure (EROFS)", "named as an environment failure");
});

test("W-573-b1 behaviour 1: the message alone, in any case, is an environment failure", () => {
  const message = classifyReplay({ status: 1, output: tap("ERR_UNKNOWN", "Read-Only File System at open") });
  assert.equal(message.accepted, false, "the message without its code is refused");
  const shell = classifyReplay({ status: 1, output: "touch: cannot touch '/tmp/x': Read-only file system\nnot ok 1 - x\n" });
  assert.equal(shell.accepted, false, "a shell's message beside a failure is refused");
  const code = classifyReplay({ status: 1, output: "Error: EROFS\nAssertionError: x\n" });
  assert.equal(code.accepted, false, "the code alone is refused");
});

test("W-573-b1 behaviour 1: an assertion red is still accepted, its own message included", () => {
  assert.equal(classifyReplay({ status: 1, output: tap("ERR_ASSERTION", "1 !== 2") }).accepted, true, "a plain assertion red");
  // outsideOwnFailure: the one failing ERR_ASSERTION block is the test's own, as an ENOENT inside it is today
  assert.equal(classifyReplay({ status: 1, output: tap("ERR_ASSERTION", "expected EROFS: read-only file system") }).accepted, true, "an assertion whose own message names the mount");
  assert.equal(classifyReplay({ status: 1, output: tap("ERR_ASSERTION", "a missing file, ENOENT") }).accepted, true, "ENOENT inside the assertion, as before");
});

// ---------------------------------------------------------------------------
// 2. red runs the command again in certify's empty-HOME cell
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "main.ts");
const SAMPLE = join(HERE, "..", "..", "..", "examples", "sample-studio");
const TSX = import.meta.resolve("tsx");
const ID = "W-900";
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const scratchDir = (tag: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w573-${tag}-`)));
  dirs.push(d);
  return d;
};
const fixtureGit = (cwd: string, args: string[]): void => {
  const r = spawnSync("git", ["-c", "user.name=W-573 Test", "-c", "user.email=w573@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  assert.equal(r.status, 0, `fixture git ${args.join(" ")}: ${r.stderr}`);
};
/** The rows' test files, each one node:test file whose failure depends on what its environment holds. */
const ROWS: Record<string, string> = {
  // fails by assertion on a host whose HOME holds seat.txt; throws ENOENT in an empty HOME (W-562's red 3)
  "home.test.mjs": 'test("W-900-b1 the seat file", () => assert.equal(readFileSync(join(homedir(), "seat.txt"), "utf8"), "codex\\n"));',
  // fails on a host whose HOME holds seat.txt, passes in an empty HOME
  "homeless.test.mjs": 'test("W-900-b1 no seat file", () => assert.equal(existsSync(join(homedir(), "seat.txt")), false));',
  // fails at one test on the host and at another in an empty HOME
  "other.test.mjs": 'test("W-900-b1 with a seat", () => assert.equal(existsSync(join(homedir(), "seat.txt")), false));\ntest("W-900-b1 without a seat", () => assert.equal(existsSync(join(homedir(), "seat.txt")), true));',
  // throws as a read-only mount does where the host's environment names W573_RO, fails by assertion elsewhere
  "mount.test.mjs": 'test("W-900-b1 a scratch dir", () => { if (process.env.W573_RO === "1") throw Object.assign(new Error(["EROFS:", "read-only", "file", "system,", "mkdtemp"].join(" ")), { code: "ER" + "OFS" }); assert.equal(1, 2); });',
  // fails by assertion wherever it runs and touches neither HOME nor TMPDIR
  "plain.test.mjs": 'test("W-900-b1 a plain assertion", () => assert.equal(1, 2));',
  // writes under TMPDIR and HOME, then fails by assertion in both
  "assert.test.mjs": 'test("W-900-b1 an assertion", () => { mkdtempSync(join(tmpdir(), "w573-row-")); writeFileSync(join(homedir(), "probe.txt"), "x"); assert.equal(1, 2); });',
};
const PRELUDE = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";\nimport { homedir, tmpdir } from "node:os";\nimport { join } from "node:path";\n';
interface Fx {
  M: string;
  studio: string;
  home: string;
  tmp: string;
}
/** A scratch repository with the sample officina and W-900 building under "Red order: one at a time", on opus/W-900. */
function fixture(tag: string): Fx {
  const M = scratchDir(tag);
  fixtureGit(M, ["init", "-q", "-b", "master"]);
  cpSync(SAMPLE, join(M, "studio"), { recursive: true, dereference: true });
  const studio = join(M, "studio");
  mkdirSync(join(studio, "briefs"), { recursive: true });
  writeFileSync(join(studio, "briefs", `${ID}.md`), `# ${ID} fixture\n\n## Intent\n\nRed order: one at a time\n\n## Behaviours to test\n\n1. one\n`);
  writeFileSync(join(studio, "opera", `${ID}.md`), `---\nid: ${ID}\ntitle: Cell fixture\nkind: feature\ncollegium: engineering\nstate: building\nprobationes: {}\nspec: briefs/${ID}.md\n---\nbody\n`);
  for (const [name, body] of Object.entries(ROWS)) writeFileSync(join(M, name), `${PRELUDE}${body}\n`);
  fixtureGit(M, ["add", "-A"]);
  fixtureGit(M, ["commit", "-q", "-m", "fixture"]);
  fixtureGit(M, ["branch", `opus/${ID}`]);
  const home = scratchDir(`${tag}-home`);
  writeFileSync(join(home, "seat.txt"), "claude\n");
  return { M, studio, home, tmp: scratchDir(`${tag}-tmp`) };
}
/** The real `bisellium red W-900 --behaviour 1` from the repository root, the host's HOME and TMPDIR the fixture's. */
function red(fx: Fx, file: string, extra: Record<string, string> = {}): { status: number | null; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: fx.home, TMPDIR: fx.tmp, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
  delete env["NODE_TEST_CONTEXT"];
  delete env["BISELLIUM_SELLA"];
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "red", ID, "--behaviour", "1", "--sella", "eng-lead", "--now", "2026-11-11T00:00:00Z", "--studio", fx.studio, "--", process.execPath, "--test-reporter=tap", file], { cwd: fx.M, encoding: "utf8", timeout: 120_000, env });
  if (r.error) throw r.error;
  return { status: r.status, stderr: r.stderr };
}
const logOf = (fx: Fx): string => join(fx.studio, "ci", "reds", ID, "01.log");
const cellsLeft = (fx: Fx): string[] => readdirSync(fx.tmp).filter((n) => n.startsWith("bisellium-red-cell-"));

test("W-573-b2 behaviour 2: a red that fails by assertion only with the host's HOME is refused, and nothing is written", () => {
  const fx = fixture("b2-home");
  const r = red(fx, "home.test.mjs");
  assert.equal(r.status, 1, "a red whose empty-HOME run throws is refused");
  assert.equal(existsSync(logOf(fx)), false, "no 01.log");
  assert.match(r.stderr, /^red: behaviour 1's command run again in certify's replay cell \(an empty HOME, a fresh TMPDIR\) is not a red certify accepts: the output names an environment failure \(ENOENT\) — nothing recorded$/m, "the refusal names the cell and the classifier's reason");
  assert.deepEqual(cellsLeft(fx), [], "the cell's directories are removed");
});

test("W-573-b2 behaviour 2: a red that passes in an empty HOME is refused", () => {
  const fx = fixture("b2-homeless");
  const r = red(fx, "homeless.test.mjs");
  assert.equal(r.status, 1, "a red that passes in the cell is refused");
  assert.equal(existsSync(logOf(fx)), false, "no 01.log");
  assert.match(r.stderr, /^red: behaviour 1's command run again in certify's replay cell \(an empty HOME, a fresh TMPDIR\) is not a red certify accepts: the command exited 0 — nothing recorded$/m, "the cell run exited 0");
});

test("W-573-b2 behaviour 2: a red that fails at another test in an empty HOME is refused", () => {
  const fx = fixture("b2-other");
  const r = red(fx, "other.test.mjs");
  assert.equal(r.status, 1, "a red whose failing tests differ is refused");
  assert.equal(existsSync(logOf(fx)), false, "no 01.log");
  assert.match(r.stderr, /^red: behaviour 1's command fails at other tests in certify's replay cell \(an empty HOME, a fresh TMPDIR\) than on this host: \["W-900-b1 with a seat"\] here, \["W-900-b1 without a seat"\] there — nothing recorded$/m, "both titles named");
});

test("W-573-b2 behaviour 2: a red whose host run throws as a read-only mount does is refused", () => {
  const fx = fixture("b2-mount");
  const r = red(fx, "mount.test.mjs", { W573_RO: "1" });
  assert.equal(r.status, 1, "a host run certify's classifier refuses is refused");
  assert.equal(existsSync(logOf(fx)), false, "no 01.log");
  assert.match(r.stderr, /^red: behaviour 1's command is not a red certify's classifier accepts on this host: the output names an environment failure \(EROFS\) — nothing recorded$/m, "the host run is named");
});

test("W-573-b2 behaviour 2: a red failing by assertion in both runs records the host's run", () => {
  const fx = fixture("b2-assert");
  const r = red(fx, "assert.test.mjs");
  assert.equal(r.status, 0, `an assertion red records: ${r.stderr.slice(0, 400)}`);
  const log = readFileSync(logOf(fx), "utf8");
  assert.match(log, /^# command: .* --test-reporter=tap assert\.test\.mjs$/m, "the command as given");
  assert.match(log, /^not ok 1 - W-900-b1 an assertion$/m, "the host's failing test");
  assert.deepEqual(readdirSync(fx.home).sort(), ["probe.txt", "seat.txt"], "the host run wrote the host's HOME once; the cell wrote its own");
  assert.deepEqual(cellsLeft(fx), [], "the cell's directories are removed");
});

// the cell is opened under the host's TMPDIR; one it cannot open there is a refusal, not a throw. TSX_DISABLE_CACHE keeps tsx
// itself from making (or failing on) that directory, so the bad TMPDIR first reaches red's own cell
const statusOf = (fx: Fx): string => spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: fx.M, encoding: "utf8" }).stdout;
test("W-573-b2 behaviour 2: a host TMPDIR the cell cannot be opened under is refused, and nothing is written", () => {
  const fx = fixture("b2-notmp");
  const gone = join(fx.tmp, "gone");
  const r = red(fx, "plain.test.mjs", { TMPDIR: gone, TSX_DISABLE_CACHE: "1" });
  assert.equal(r.status, 1, "a nonexistent TMPDIR is refused");
  assert.equal(existsSync(logOf(fx)), false, "no 01.log under a nonexistent TMPDIR");
  assert.match(r.stderr, /^red: behaviour 1's command could not be run in certify's replay cell: .+ — nothing recorded$/m, "the setup failure is named");
  assert.equal(statusOf(fx), "", "the fixture's tree is unchanged under a nonexistent TMPDIR");
  const shut = join(fx.tmp, "shut");
  mkdirSync(shut, { mode: 0o500 });
  const s = red(fx, "plain.test.mjs", { TMPDIR: shut, TSX_DISABLE_CACHE: "1" });
  assert.equal(s.status, 1, "an unwritable TMPDIR is refused");
  assert.equal(existsSync(logOf(fx)), false, "no 01.log under an unwritable TMPDIR");
  assert.match(s.stderr, /^red: behaviour 1's command could not be run in certify's replay cell: .+ — nothing recorded$/m, "the unwritable setup failure is named");
  assert.equal(statusOf(fx), "", "the fixture's tree is unchanged under an unwritable TMPDIR");
});

// the same refusal in a studio that requires step tickets: the red's ticket stays pending, never claimed
test("W-573-b2 behaviour 2: a cell that cannot be opened leaves the red's ticket unclaimed", () => {
  const w = world("w573-b2-ticket", "ready");
  const genuine = `\`bisellium red ${OPUS} --behaviour 1 --sella builder --studio studio -- node --test-reporter=tap --test-name-pattern='^W-900-b1\\s' plain.test.mjs\``;
  put(w.wt, BRIEF_REL, briefText(1).replace(`# ${OPUS} fixture brief\n`, `# ${OPUS} fixture brief\n\nRed order: one at a time\n`).replace(/^1\. \*\*Fixture behaviour 1\.\*\*$/m, `1. **Fixture behaviour 1.** **Genuine red:** ${genuine}`));
  put(w.wt, "plain.test.mjs", `${PRELUDE}test("W-900-b1 fixture behaviour 1", () => assert.equal(1, 2));\n`);
  commit(w.wt, `test(${OPUS}): row b1, red`);
  ticketed(w);
  const o = next(w, [OPUS, ...BUDGET]);
  const pending = join(w.repo, ".git", "bisellium", "tickets", `${OPUS}.json`);
  assert.ok(existsSync(pending), ran("next issued the red's ticket", o));
  const env = { ...envFor(w, {}), TMPDIR: join(w.root, "gone"), TSX_DISABLE_CACHE: "1" };
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "red", OPUS, "--behaviour", "1", "--sella", "builder", "--studio", w.wtStudio, "--", "node", "--test-reporter=tap", "--test-name-pattern=^W-900-b1\\s", "plain.test.mjs"], { cwd: w.wt, env, encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 1, `a cell that cannot be opened is refused with a ticket: ${(r.stderr ?? "").slice(0, 400)}`);
  assert.match(r.stderr, /^red: behaviour 1's command could not be run in certify's replay cell: .+ — nothing recorded$/m, "the ticketed refusal names the setup failure");
  assert.equal(existsSync(join(w.wtStudio, "ci", "reds", OPUS, "01.log")), false, "no 01.log with a ticket");
  assert.equal(existsSync(pending), true, "the ticket stays pending");
  assert.equal(existsSync(join(w.repo, ".git", "bisellium", "tickets", `${OPUS}.claimed`)), false, "no claim");
});

// the reds perform records through red: a prototype whose red depends on the host's HOME holds, with no red recorded
const W573_SERIES_TEST = `${PRELUDE}test("W-900-b1 fixture behaviour 1", () => assert.equal(readFileSync(join(homedir(), "seat.txt"), "utf8"), "codex\\n"));\n`;
test("W-573-b2 behaviour 2: the reds perform refuses a HOME-dependent red the same way", () => {
  const w = world("w573-b2-perform", "ready", { automated: true });
  writeFileSync(join(w.home, "seat.txt"), "claude\n");
  const base = git(w.wt, ["rev-parse", "HEAD"]);
  put(w.wt, "w326.test.mjs", W573_SERIES_TEST);
  commit(w.wt, `test(${OPUS}): row b1, red`);
  put(w.wt, "source.txt", "behaviour 1\n");
  commit(w.wt, `feat(${OPUS}): behaviour 1`);
  const series = join(w.root, "series.mbox");
  writeFileSync(series, `${git(w.wt, ["format-patch", "--stdout", `${base}..HEAD`])}\n`);
  git(w.wt, ["reset", "-q", "--hard", base]);
  const digest = createHash("sha256").update(readFileSync(series)).digest("hex");
  const genuine = `\`bisellium red ${OPUS} --behaviour 1 --sella builder --studio studio -- node --test-reporter=tap --test-name-pattern='^W-900-b1\\s' w326.test.mjs\``;
  put(w.wt, BRIEF_REL, briefText(1).replace(`# ${OPUS} fixture brief\n`, `# ${OPUS} fixture brief\n\nPrototype: ${series} sha256:${digest}\n\nRed order: one at a time\n`).replace(/^1\. \*\*Fixture behaviour 1\.\*\*$/m, `1. **Fixture behaviour 1.** **Genuine red:** ${genuine}`));
  commit(w.wt, `spec(${OPUS}): the prototype line`);
  const p = next(w, [OPUS, "--perform", "--expect", "reds", ...BUDGET]);
  expectStep(p, "reds", "held", "the perform holds");
  assert.match(p.out, /behaviour 1's red was not recorded: red: behaviour 1's command run again in certify's replay cell/, ran("the hold names the cell", p));
  assert.equal(existsSync(join(w.wtStudio, "ci", "reds", OPUS, "01.log")), false, "no red is recorded");
});

// review round 1, S1: the launcher makes the cell relative to its own directory, the child resolves it from `--cwd`
/** `red` as above, run from `from` (not the repository) with `--cwd` naming the repository and a relative TMPDIR. */
function redFrom(fx: Fx, from: string, file: string, relTmp: string): { status: number | null; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: fx.home, TMPDIR: relTmp, TSX_DISABLE_CACHE: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  delete env["NODE_TEST_CONTEXT"];
  delete env["BISELLIUM_SELLA"];
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "red", ID, "--behaviour", "1", "--sella", "eng-lead", "--now", "2026-11-11T00:00:00Z", "--studio", fx.studio, "--repo", fx.M, "--cwd", fx.M, "--", process.execPath, "--test-reporter=tap", file], { cwd: from, encoding: "utf8", timeout: 120_000, env });
  if (r.error) throw r.error;
  return { status: r.status, stderr: r.stderr };
}

test("W-573-b2 behaviour 2: a relative TMPDIR with --cwd elsewhere still gives the command usable cell directories", () => {
  const fx = fixture("b2-rel");
  const from = scratchDir("b2-rel-from");
  mkdirSync(join(from, "t"));
  mkdirSync(join(fx.M, "t")); // the host run resolves the same relative TMPDIR from --cwd
  const r = redFrom(fx, from, "assert.test.mjs", "t");
  assert.equal(r.status, 0, "a valid red records under a relative TMPDIR");
  assert.match(readFileSync(logOf(fx), "utf8"), /^not ok 1 - W-900-b1 an assertion$/m, "the host's failing test");
  assert.deepEqual(readdirSync(join(from, "t")), [], "the cell, made under the launcher's TMPDIR, is removed");
});

test("W-573-b2 behaviour 2: the cell's directories and environment paths are absolute under a relative TMPDIR", async () => {
  const from = scratchDir("b2-abs");
  mkdirSync(join(from, "t"));
  const was = { cwd: process.cwd(), tmp: process.env["TMPDIR"] };
  process.chdir(from);
  process.env["TMPDIR"] = "t";
  try {
    const { openCell } = await import("@bisellium/commands/red-cell.js");
    const cell = openCell();
    try {
      for (const p of [cell.home, cell.tmp, cell.env["HOME"], cell.env["TMPDIR"], cell.env["PLAYWRIGHT_BROWSERS_PATH"]])
        if (p !== undefined) assert.equal(isAbsolute(p), true, `${p} is absolute`);
      assert.equal(existsSync(cell.home) && existsSync(cell.tmp), true, "both directories exist");
    } finally {
      cell.close();
    }
  } finally {
    process.chdir(was.cwd);
    if (was.tmp === undefined) delete process.env["TMPDIR"];
    else process.env["TMPDIR"] = was.tmp;
  }
});
