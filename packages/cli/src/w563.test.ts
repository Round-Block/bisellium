/**
 * W-563 (studio/briefs/W-563.md): the pre-sign gate's rows (b1), its runner and log (b2), the signer's spec verdict refused
 * without a current passing gate log (b3) or a repeated class's census (b4), and the round-1 prompts' every-site clause (b5).
 * Every row works in its own scratch git repositories under the OS temp directory; none reads studio/, the host HOME or
 * ~/.codex. Select one behaviour with --test-name-pattern='^W-563-b<k>\s'.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runGate, type GateOptions } from "@bisellium/commands/presign-gate.js";
import { gateRows } from "@bisellium/commands/presign-gate.js";

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-563-b[1-9] /, "");
  test(name, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}
const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `w563-${tag}-`));
  roots.push(d);
  return d;
};
const git = (repo: string, ...args: string[]): string => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const put = (repo: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
function initRepo(tag: string): string {
  const repo = scratch(tag);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "commit.gpgsign", "false");
  return repo;
}
/** A tree: `from` with `files` written over it, built in a temporary index (the repo's own index and worktree untouched). */
function treeWith(repo: string, from: string, files: Record<string, string>): string {
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch("index"), "index") };
  const run = (args: string[], input?: string): string => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env, input }).trim();
  run(["read-tree", from]);
  for (const [path, text] of Object.entries(files)) run(["update-index", "--add", "--cacheinfo", `100644,${run(["hash-object", "-w", "--stdin"], text)},${path}`]);
  return run(["write-tree"]);
}
const commitAll = (repo: string, msg: string): string => (git(repo, "add", "-A"), git(repo, "commit", "-qm", msg), git(repo, "rev-parse", "HEAD"));

/** b1's fixture: a base commit and a tree that touches a module, a script, a workspace module and a dependency of the cli, and adds a test. */
let b1: { repo: string; base: string; tree: string } | undefined;
function b1World(): { repo: string; base: string; tree: string } {
  if (b1 !== undefined) return b1;
  const repo = initRepo("b1");
  const suite = ["pkg/src/a.test.ts", "scripts/s.test.mjs", "pkg/src/c.test.ts", "pkg/src/t.test.ts", "pkg/src/u.test.ts", "pkg/src/new.test.mjs", "pkg/src/p.test.ts", "pkg/src/d.test.ts"].map((f) => `node --import tsx ${f}`).join(" && ");
  put(repo, "package.json", JSON.stringify({ scripts: { "test:suite": suite } }));
  put(repo, "tsconfig.json", "{}\n");
  put(repo, "pkg/src/a.ts", "export const a = 1;\n");
  put(repo, "pkg/src/a.test.ts", 'import { a } from "./a.js";\nimport { w } from "@bisellium/commands/w.js";\nvoid a, w;\n');
  put(repo, "packages/commands/src/w.ts", "export const w = 1;\n");
  put(repo, "scripts/s.mjs", "export const s = 1;\n");
  put(repo, "scripts/s.test.mjs", 'const { s } = await import("./s.mjs");\nvoid s;\n');
  put(repo, "pkg/src/cli.ts", 'import { deep } from "./deep.js";\nvoid deep;\n');
  put(repo, "pkg/src/deep.ts", "export const deep = 1;\n");
  put(repo, "pkg/src/c.test.ts", 'import { spawnSync } from "node:child_process";\nspawnSync("node", ["--import", "tsx", "pkg/src/cli.ts"]);\n');
  put(repo, "pkg/src/t.test.ts", 'import "./cli.js";\n');
  put(repo, "pkg/src/other.ts", "export const other = 1;\n");
  put(repo, "pkg/src/u.test.ts", 'import { other } from "./other.js";\nvoid other;\n');
  put(repo, "prompts/p.md", "a prompt\n");
  put(repo, "pkg/src/dyn.ts", "export const dyn = 1;\n");
  put(repo, "pkg/src/d.test.ts", 'const { dyn } = await import("./dyn.js");\nvoid dyn;\n');
  put(repo, "pkg/src/p.test.ts", 'import { readFileSync } from "node:fs";\nreadFileSync("prompts/p.md", "utf8");\n');
  const base = commitAll(repo, "base");
  put(repo, "pkg/src/a.ts", "export const a = 2;\n");
  put(repo, "scripts/s.mjs", "export const s = 2;\n");
  put(repo, "pkg/src/deep.ts", "export const deep = 2;\n");
  put(repo, "packages/commands/src/w.ts", "export const w = 2;\n");
  put(repo, "pkg/src/new.test.mjs", "export {};\n");
  put(repo, "studio/briefs/W-1.md", "brief\n");
  const tip = commitAll(repo, "tip");
  b1 = { repo, base, tree: git(repo, "rev-parse", `${tip}^{tree}`) };
  return b1;
}
const rowsOf = (repo: string, base: string, tree: string): string[] => {
  const rows = gateRows(repo, base, tree);
  assert.ok(Array.isArray(rows), `gateRows refused: ${JSON.stringify(rows)}`);
  return rows.map((r) => `${r.kind} ${r.file ?? "-"} ${r.command}`);
};
const owedOnly = (rows: string[]): string[] => rows.filter((r) => !r.startsWith("check ") && !r.startsWith("typecheck "));

row("W-563-b1 a test importing a touched module is a row", () => {
  const { repo, base, tree } = b1World();
  const rows = rowsOf(repo, base, tree);
  assert.ok(rows.includes("check - npm run -s check -- studio --repo ."), "the check row");
  assert.ok(rows.includes("typecheck - npm run -s typecheck"), "the typecheck row");
  assert.ok(rows.includes("test pkg/src/a.test.ts node --import tsx pkg/src/a.test.ts"), "the importer of a touched module, with its test:suite command");
  assert.ok(!rows.some((r) => r.split(" ")[1] === "pkg/src/u.test.ts"), "an untouched test is no row");
});

row("W-563-b1 a workspace import resolves to its source", () => {
  const { repo, base } = b1World();
  const rows = rowsOf(repo, base, treeWith(repo, base, { "packages/commands/src/w.ts": "export const w = 3;\n" }));
  assert.deepEqual(owedOnly(rows), ["test pkg/src/a.test.ts node --import tsx pkg/src/a.test.ts"]);
});

row("W-563-b1 a scripts test reaching a touched script is a row", () => {
  const { repo, base, tree } = b1World();
  assert.ok(rowsOf(repo, base, tree).includes("test scripts/s.test.mjs node --import tsx scripts/s.test.mjs"));
});

row("W-563-b1 a transitive or named reach is no row", () => {
  const { repo, base } = b1World();
  // deep.ts is imported by cli.ts, which t.test.ts imports and c.test.ts spawns by name: neither imports deep.ts itself
  assert.deepEqual(owedOnly(rowsOf(repo, base, treeWith(repo, base, { "pkg/src/deep.ts": "export const deep = 3;\n" }))), [], "a transitive importer and a spawner owe no row");
  assert.deepEqual(owedOnly(rowsOf(repo, base, treeWith(repo, base, { "prompts/p.md": "a changed prompt\n" }))), [], "a test naming a touched data file owes no row");
});

row("W-563-b1 a new test file owes a reads row and a test row", () => {
  const { repo, base, tree } = b1World();
  const rows = rowsOf(repo, base, tree);
  assert.ok(rows.includes("reads pkg/src/new.test.mjs node --import tsx pkg/src/new.test.mjs"), "the reads row");
  assert.ok(rows.includes("test pkg/src/new.test.mjs node --import tsx pkg/src/new.test.mjs"), "the test row");
});

row("W-563-b1 a changed test file is a row and no suite row is owed", () => {
  const { repo, base } = b1World();
  const t = treeWith(repo, base, { "pkg/src/u.test.ts": 'import { other } from "./other.js";\nvoid other; // changed\n', "tsconfig.json": '{ "x": 1 }\n' });
  assert.deepEqual(owedOnly(rowsOf(repo, base, t)), ["test pkg/src/u.test.ts node --import tsx pkg/src/u.test.ts"]);
});

row("W-563-b1 a literal dynamic import is an edge", () => {
  const { repo, base } = b1World();
  const rows = rowsOf(repo, base, treeWith(repo, base, { "pkg/src/dyn.ts": "export const dyn = 2;\n" }));
  assert.deepEqual(owedOnly(rows), ["test pkg/src/d.test.ts node --import tsx pkg/src/d.test.ts"]);
});

row("W-563-b1 a shared command runs only the owed files", () => {
  const { repo, base } = b1World();
  const t = treeWith(repo, base, { "pkg/src/a.ts": "export const a = 8;\n", "package.json": JSON.stringify({ scripts: { "test:suite": "node --test --import tsx pkg/src/u.test.ts pkg/src/a.test.ts pkg/src/d.test.ts" } }) });
  assert.deepEqual(owedOnly(rowsOf(repo, base, t)), ["test pkg/src/a.test.ts node --test --import tsx pkg/src/a.test.ts"]);
});

row("W-563-b1 a required test no test:suite command names is a failing row", () => {
  const { repo, base } = b1World();
  const t = treeWith(repo, base, { "pkg/src/a.ts": "export const a = 9;\n", "package.json": JSON.stringify({ scripts: { "test:suite": "node --import tsx pkg/src/u.test.ts" } }) });
  assert.ok(rowsOf(repo, base, t).includes("test pkg/src/a.test.ts (no test:suite command names it)"));
});


const HOST_SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");

/** b2's fixture: a repo whose check and typecheck are `true`, a base, and a series that touches a module and adds a test reading studio/. */
function gateWorld(o: { failing?: boolean; listed?: boolean; slow?: boolean } = {}): { repo: string; base: string; mbox: string; out: string; run: (opts?: GateOptions) => Promise<{ exit: number; stderr: string }> } {
  const repo = initRepo("b2");
  const pkg = (record: string): string =>
    JSON.stringify({ scripts: { test: "true", check: "true", typecheck: "true", "test:suite": "node src/a.test.mjs && node src/r.test.mjs", "test:record": record } });
  put(repo, "package.json", pkg(""));
  put(repo, "studio/bisellium.yml", "bisellium: 1\n");
  put(repo, "src/a.mjs", "export const ok = true;\n");
  put(repo, "src/a.test.mjs", 'import { ok } from "./a.mjs";\nprocess.exit(ok ? 0 : 1);\n');
  for (const s of ["record-reads.mjs", "ci-scope.mjs"]) {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    copyFileSync(join(HOST_SCRIPTS, s), join(repo, "scripts", s));
  }
  const base = commitAll(repo, "base");
  // sleep-waiver: fixture -- the fixture module hangs so the runner's row timeout has a row to kill; no assertion waits on it
  const hang = o.slow === true ? "await new Promise((r) => setTimeout(r, 120_000));\n" : "";
  put(repo, "src/a.mjs", `${hang}export const ok = ${o.failing === true ? "false" : "true"}; // the series\n`);
  put(repo, "src/r.test.mjs", 'import { readFileSync } from "node:fs";\nreadFileSync("studio/bisellium.yml", "utf8");\n');
  if (o.listed === true) put(repo, "package.json", pkg("node src/r.test.mjs"));
  commitAll(repo, "series");
  const side = scratch("b2-side");
  const mbox = join(side, "series.mbox");
  writeFileSync(mbox, execFileSync("git", ["-C", repo, "format-patch", "--no-numbered", "--stdout", `${base}..HEAD`], { encoding: "utf8" }));
  const out = join(side, "gate.log");
  const run = async (opts: GateOptions = {}): Promise<{ exit: number; stderr: string }> => {
    let stderr = "";
    const error = console.error;
    console.error = (...a: unknown[]) => void (stderr += `${a.map(String).join(" ")}\n`);
    try {
      return { exit: await runGate(["--opus", "W-1", "--worktree", repo, "--base", base, "--series", mbox, "--out", out], opts), stderr };
    } finally {
      console.error = error;
    }
  };
  return { repo, base, mbox, out, run };
}
const rowLines = (out: string): string[] =>
  readFileSync(out, "utf8").split("\n").filter((l) => l !== "" && !l.startsWith("# ")).map((l) => l.split("\t")).map(([exit, , kind, file, command]) => `${exit} ${kind} ${file} ${command}`);

row("W-563-b2 a dirty worktree is refused", async () => {
  const w = gateWorld();
  writeFileSync(join(w.repo, "stray.txt"), "x\n");
  const r = await w.run();
  assert.equal(r.exit, 2, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(existsSync(w.out), false, "no log is written");
  assert.match(r.stderr, /is not clean/);
});

row("W-563-b2 a worktree at another tree is refused", async () => {
  const w = gateWorld();
  git(w.repo, "checkout", "-q", "--detach", w.base);
  const r = await w.run();
  assert.equal(r.exit, 2, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(existsSync(w.out), false, "no log is written");
  assert.match(r.stderr, /is at tree [0-9a-f]+, and the series makes [0-9a-f]+/);
});

row("W-563-b2 a failing row is recorded and the runner exits 1", async () => {
  const w = gateWorld({ failing: true, listed: true });
  const r = await w.run();
  assert.equal(r.exit, 1, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.ok(rowLines(w.out).includes("1 test src/a.test.mjs node src/a.test.mjs"), `the failed row is recorded: ${rowLines(w.out).join(" | ")}`);
});

row("W-563-b2 a new file reading studio unlisted fails its reads row", async () => {
  const w = gateWorld();
  const r = await w.run();
  assert.equal(r.exit, 1, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.ok(rowLines(w.out).includes("1 reads src/r.test.mjs node src/r.test.mjs"), `the reads row fails: ${rowLines(w.out).join(" | ")}`);
});

row("W-563-b2 a row past its timeout is recorded 124 and the run goes on", async () => {
  const w = gateWorld({ slow: true, listed: true });
  const t0 = Date.now();
  const r = await w.run({ rowTimeoutMs: 2000 });
  assert.equal(r.exit, 1, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.ok(Date.now() - t0 < 60_000, "the hung row is killed at its timeout");
  const rows = rowLines(w.out);
  assert.ok(rows.includes("124 test src/a.test.mjs node src/a.test.mjs"), `the timed-out row is recorded 124: ${rows.join(" | ")}`);
  assert.ok(rows.includes("0 test src/r.test.mjs node src/r.test.mjs"), `the other rows still run: ${rows.join(" | ")}`);
});

row("W-563-b2 rows past the budget are deferred and do not fail", async () => {
  const w = gateWorld({ listed: true });
  const r = await w.run({ budgetMs: 0 });
  assert.equal(r.exit, 0, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.ok(existsSync(w.out), "the log is written");
  const rows = rowLines(w.out);
  assert.deepEqual(rows, [
    "deferred check - npm run -s check -- studio --repo .",
    "deferred typecheck - npm run -s typecheck",
    "deferred reads src/r.test.mjs node src/r.test.mjs",
    "deferred test src/a.test.mjs node src/a.test.mjs",
    "deferred test src/r.test.mjs node src/r.test.mjs",
  ], "each row not started is deferred");
  assert.match(readFileSync(w.out, "utf8").slice(0, -1).split("\n").at(-1)!, /^# minutes: \d+\.\d$/, "the log is written whole");
});

row("W-563-b2 a passing run writes the whole log and exits 0", async () => {
  const w = gateWorld({ listed: true });
  const r = await w.run();
  assert.equal(r.exit, 0, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.ok(existsSync(w.out), "the log is written");
  const text = readFileSync(w.out, "utf8");
  const lines = text.slice(0, -1).split("\n");
  assert.equal(lines[0], "# presign-gate: W-1");
  assert.equal(lines[1], `# base: ${w.base}`);
  assert.match(lines[2]!, /^# series: sha256:[0-9a-f]{64}$/);
  assert.equal(lines[3], `# tree: ${git(w.repo, "rev-parse", "HEAD^{tree}")}`);
  assert.match(lines[4]!, /^# started: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.match(lines.at(-1)!, /^# minutes: \d+\.\d$/);
  assert.deepEqual(rowLines(w.out), [
    "0 check - npm run -s check -- studio --repo .",
    "0 typecheck - npm run -s typecheck",
    "0 reads src/r.test.mjs node src/r.test.mjs",
    "0 test src/a.test.mjs node src/a.test.mjs",
    "0 test src/r.test.mjs node src/r.test.mjs",
  ]);
});
