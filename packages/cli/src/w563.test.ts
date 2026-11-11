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
import { fileURLToPath, pathToFileURL } from "node:url";
import { runGate, type GateOptions } from "@bisellium/commands/presign-gate.js";
import { createHash } from "node:crypto";
import { runVerdict } from "./verdict.js";
import { PROMPT_TEMPLATES, checkPromptTemplates } from "./rules/prompts.js";
import { gateRows, readGateLog, rowsAt } from "@bisellium/commands/presign-gate.js";

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
function gateWorld(o: { failing?: boolean; listed?: boolean; slow?: boolean; scalar?: boolean } = {}): { repo: string; base: string; mbox: string; out: string; run: (opts?: GateOptions) => Promise<{ exit: number; stderr: string }> } {
  const repo = initRepo("b2");
  const pkg = (record: string | number): string =>
    JSON.stringify({ scripts: { test: "true", check: "true", typecheck: "true", "test:suite": "node src/a.test.mjs && node src/r.test.mjs", "test:record": record } });
  put(repo, "package.json", pkg(o.scalar === true ? 5 : ""));
  put(repo, "studio/bisellium.yml", "bisellium: 1\n");
  put(repo, "src/a.mjs", "export const ok = true;\n");
  put(repo, "src/a.test.mjs", 'import { ok } from "./a.mjs";\nprocess.exit(ok ? 0 : 1);\n');
  for (const s of ["record-reads.mjs", "ci-scope.mjs"]) {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    copyFileSync(join(HOST_SCRIPTS, s), join(repo, "scripts", s));
  }
  const base = commitAll(repo, "base");
  const hang = o.slow === true ? 'import { createServer } from "node:net";\ncreateServer().listen(0); // an open listener keeps the process alive\nawait new Promise(() => {}); // blocks without spinning until the row timeout kills it\n' : "";
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

row("W-563-b2 a reads check that exits non-zero fails its reads row", async () => {
  // a scalar test:record makes `ci-scope.mjs --check-reads` throw: exit 1 and no unlisted:/failed:/missing: line
  const w = gateWorld({ scalar: true });
  const r = await w.run();
  assert.equal(r.exit, 1, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.ok(rowLines(w.out).includes("1 reads src/r.test.mjs node src/r.test.mjs"), `the reads row fails: ${rowLines(w.out).join(" | ")}`);
});

row("W-563-b2 a run under an outer read trace still passes", async () => {
  // `bisellium ci` runs the suite with NODE_OPTIONS preloading record-reads and a trace root in the environment: the gate's rows must not inherit it
  const w = gateWorld({ listed: true });
  const keep = ["NODE_OPTIONS", "BISELLIUM_RECORD_READS", "BISELLIUM_RECORD_ROOT", "BISELLIUM_RECORD_OWNER"].map((k) => [k, process.env[k]] as const);
  process.env.NODE_OPTIONS = `--import ${pathToFileURL(join(HOST_SCRIPTS, "record-reads.mjs")).href}`;
  process.env.BISELLIUM_RECORD_READS = join(scratch("b2-trace"), "outer.log");
  process.env.BISELLIUM_RECORD_ROOT = "outer-root";
  process.env.BISELLIUM_RECORD_OWNER = "outer.test.ts";
  try {
    const r = await w.run();
    assert.equal(r.exit, 0, `exit (stderr ${JSON.stringify(r.stderr)}; rows ${rowLines(w.out).join(" | ")})`);
  } finally {
    for (const [k, v] of keep) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

row("W-563-b2 a row past its timeout is recorded 124 and the run goes on", async () => {
  const w = gateWorld({ slow: true, listed: true });
  const t0 = Date.now();
  const r = await w.run({ rowTimeoutMs: 20_000 });
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


const MANIFEST = [
  "bisellium: 1",
  "studio: W-563 gate",
  "patron: patron",
  "collegia:",
  "  - { id: engineering, name: Engineering, magister: eng-lead }",
  "sellae:",
  "  - { id: qa-lead, collegium: engineering, kind: agent }",
  "probationes:",
  "  - { id: review, name: Review, kind: agent }",
  "wip_limit: 10",
  "",
].join("\n");
const NOW = new Date("2026-11-11T12:00:00.000Z");
const FINDINGS = "## Findings\n1. advisory — fine — check: none: x\n";
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** b3's fixture: an officina in a git repo (briefs/ and ci/ excluded, so the runner sees it clean), a base, a signed series, and its gate log. */
async function signWorld(): Promise<{
  repo: string;
  dir: string;
  side: string;
  log: string;
  brief: (mbox?: string) => void;
  series: (body: string) => string;
  sign: (body: string, sella?: string) => { exitCode: number; stderr: string; written: boolean };
}> {
  const repo = initRepo("b3");
  const dir = join(repo, "studio");
  put(repo, ".git/info/exclude", "studio/briefs/\nstudio/ci/\nstudio/.bisellium/\n");
  put(repo, "package.json", JSON.stringify({ scripts: { test: "true", check: "true", typecheck: "true", "test:suite": "node src/a.test.mjs" } }));
  put(repo, "src/a.mjs", "export const ok = true;\n");
  put(repo, "src/a.test.mjs", 'import { ok } from "./a.mjs";\nprocess.exit(ok ? 0 : 1);\n');
  put(repo, "studio/bisellium.yml", MANIFEST);
  put(repo, "studio/opera/W-300.md", "---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: engineering\nstate: greenlit\nspec: briefs/W-300.md\nprobationes: {}\n---\n");
  const base = commitAll(repo, "base");
  const side = scratch("b3-side");
  let n = 0;
  const series = (body: string): string => {
    put(repo, "src/a.mjs", body);
    commitAll(repo, `series ${++n}`);
    const mbox = join(side, `series-${n}.mbox`);
    writeFileSync(mbox, execFileSync("git", ["-C", repo, "format-patch", "--no-numbered", "--stdout", `${base}..HEAD`], { encoding: "utf8" }));
    return mbox;
  };
  const first = series("export const ok = true; // the series\n");
  const log = join(side, "gate.log");
  assert.equal(await runGate(["--opus", "W-300", "--worktree", repo, "--base", base, "--series", first, "--out", log]), 0, "the fixture's gate passes");
  const brief = (mbox?: string): void =>
    put(repo, "studio/briefs/W-300.md", ["# W-300 fixture brief", ...(mbox === undefined ? [] : [`Prototype: ${mbox} sha256:${sha256(mbox)}`]), ""].join("\n"));
  brief(first);
  const sign = (body: string, sella = "architect"): { exitCode: number; stderr: string; written: boolean } => {
    const input = join(side, `input-${++n}.md`);
    writeFileSync(input, body);
    let stderr = "";
    const [log0, err0] = [console.log, console.error];
    console.log = () => undefined;
    console.error = (...a: unknown[]) => void (stderr += `${a.map(String).join(" ")}\n`);
    let exitCode: number;
    try {
      exitCode = runVerdict(["W-300", "--round", "1", "--sella", sella, "--outcome", "passed", "--phase", "spec", "--from", input, "--studio", dir], { now: NOW }).exitCode;
    } finally {
      [console.log, console.error] = [log0, err0];
    }
    const written = existsSync(join(dir, "ci", "W-300-spec-1.log"));
    if (written) rmSync(join(dir, "ci", "W-300-spec-1.log"));
    return { exitCode, stderr, written };
  };
  return { repo, dir, side, log, brief, series, sign };
}
const cited = (log: string): string => `Gate log: ${log}\n\n${FINDINGS}`;
const variant = (w: { side: string; log: string }, name: string, edit: (text: string) => string): string => {
  const p = join(w.side, name);
  writeFileSync(p, edit(readFileSync(w.log, "utf8")));
  return p;
};
const refusedB3 = (r: { exitCode: number; stderr: string; written: boolean }, want: RegExp): void => {
  assert.equal(r.exitCode, 2, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(r.written, false, "no log is written");
  assert.match(r.stderr, want);
};

row("W-563-b3 no gate log is refused", async () => {
  const w = await signWorld();
  refusedB3(w.sign(FINDINGS), /^W-300: pre-sign gate: 0 "Gate log:" lines; cite the runner's log/);
});

row("W-563-b3 a log of another series is refused", async () => {
  const w = await signWorld();
  const other = variant(w, "series.log", (t) => t.replace(/^# series: sha256:[0-9a-f]{64}$/m, `# series: sha256:${"1".repeat(64)}`));
  refusedB3(w.sign(cited(other)), /^W-300: pre-sign gate: \S+ gates series sha256:1{64}, not the brief's sha256:[0-9a-f]{64}/);
});

row("W-563-b3 a log of another tree is refused", async () => {
  const w = await signWorld();
  const base = git(w.repo, "rev-parse", "HEAD~1^{tree}");
  const other = variant(w, "tree.log", (t) => t.replace(/^# tree: [0-9a-f]+$/m, `# tree: ${base}`));
  refusedB3(w.sign(cited(other)), /^W-300: pre-sign gate: \S+ gates tree [0-9a-f]+, and the series makes [0-9a-f]+ on [0-9a-f]+/);
});

row("W-563-b3 a missing row is refused", async () => {
  const w = await signWorld();
  const other = variant(w, "missing.log", (t) => t.split("\n").filter((l) => !/\ttest\tsrc\/a\.test\.mjs\t/.test(l)).join("\n"));
  refusedB3(w.sign(cited(other)), /^W-300: pre-sign gate: \S+ has no row test src\/a\.test\.mjs \(`node src\/a\.test\.mjs`\)/);
});

row("W-563-b3 a failed row is refused", async () => {
  const w = await signWorld();
  const other = variant(w, "failed.log", (t) => t.replace(/^0(\t[0-9.]+\ttest\tsrc\/a\.test\.mjs\t)/m, "1$1"));
  refusedB3(w.sign(cited(other)), /^W-300: pre-sign gate: \S+'s row test src\/a\.test\.mjs exited 1/);
});

row("W-563-b3 a deferred row signs", async () => {
  const w = await signWorld();
  const other = variant(w, "deferred.log", (t) => t.replace(/^0\t[0-9.]+(\ttest\tsrc\/a\.test\.mjs\t)/m, "deferred\t0.0$1"));
  assert.ok(readFileSync(other, "utf8").split("\n").includes("deferred\t0.0\ttest\tsrc/a.test.mjs\tnode src/a.test.mjs"), "the fixture defers the test row");
  const r = w.sign(cited(other));
  assert.equal(r.exitCode, 0, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(r.written, true, "the log is written");
});

row("W-563-b3 a re-sign with a stale log is refused", async () => {
  const w = await signWorld();
  w.brief(w.series("export const ok = true; // round 2\n"));
  refusedB3(w.sign(cited(w.log)), /^W-300: pre-sign gate: \S+ gates series sha256:[0-9a-f]{64}, not the brief's/);
});

row("W-563-b3 a current passing log signs", async () => {
  const w = await signWorld();
  const r = w.sign(cited(w.log));
  assert.equal(r.exitCode, 0, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(r.written, true, "the log is written");
});

row("W-563-b3 another seat's verdict and a brief with no prototype are not judged", async () => {
  const w = await signWorld();
  const seat = w.sign(FINDINGS, "qa-lead");
  assert.equal(seat.exitCode, 0, `another seat (stderr ${JSON.stringify(seat.stderr)})`);
  w.brief();
  const plain = w.sign(FINDINGS);
  assert.equal(plain.exitCode, 0, `no prototype (stderr ${JSON.stringify(plain.stderr)})`);
});


/** b4's fixture: an officina (no prototype) whose W-300 failed a spec round on an S1 class; `elsewhere` puts the class in another opus's log. */
function censusWorld(elsewhere: boolean): { dir: string; side: string; setBrief: (lines: string[]) => void; sign: (sella: string, round: string, body: string, outcome?: string) => { exitCode: number; stderr: string; written: boolean } } {
  const dir = scratch("b4");
  const side = scratch("b4-side");
  put(dir, "bisellium.yml", MANIFEST);
  put(dir, "opera/W-300.md", "---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: engineering\nstate: greenlit\nspec: briefs/W-300.md\nprobationes: {}\n---\n");
  const setBrief = (lines: string[]): void => put(dir, "briefs/W-300.md", ["# W-300 fixture brief", "brief line 2", ...lines, ""].join("\n"));
  setBrief([]);
  let n = 0;
  const sign = (sella: string, round: string, body: string, outcome = "passed"): { exitCode: number; stderr: string; written: boolean } => {
    const input = join(side, `input-${++n}.md`);
    writeFileSync(input, body);
    let stderr = "";
    const [log0, err0] = [console.log, console.error];
    console.log = () => undefined;
    console.error = (...a: unknown[]) => void (stderr += `${a.map(String).join(" ")}\n`);
    let exitCode: number;
    try {
      exitCode = runVerdict(["W-300", "--round", round, "--sella", sella, "--outcome", outcome, "--phase", "spec", "--from", input, "--studio", dir], { now: NOW }).exitCode;
    } finally {
      [console.log, console.error] = [log0, err0];
    }
    const log = join(dir, "ci", `W-300-spec-${round}.log`);
    const written = existsSync(log);
    if (written && sella === "architect") rmSync(log);
    return { exitCode, stderr, written };
  };
  const failed = sign("qa-lead", "1", "## Findings\n1. blocking — the gap at briefs/W-300.md:2 [severity: S1] [design: changes] [class: spec×wide-gap] — check: none: x\n", "failed");
  assert.equal(failed.exitCode, 0, `the fixture's failed round is written (stderr ${JSON.stringify(failed.stderr)})`);
  if (elsewhere) put(dir, "ci/W-299-review-1.log", "# opus: W-299\n\n## Findings\n1. blocking — the same gap [class: spec×wide-gap]\n");
  return { dir, side, setBrief, sign };
}
const census = (w: { side: string }, name: string, output: string, digest?: string): string => {
  const script = join(w.side, `${name}.sh`);
  const out = join(w.side, `${name}.out`);
  writeFileSync(script, "#!/bin/sh\ngit grep -n gap\n");
  writeFileSync(out, output);
  return `Class census: spec×wide-gap ${script} -> ${out} sha256:${digest ?? createHash("sha256").update(output).digest("hex")}`;
};
const SIGNED = "## Findings\n1. advisory — fine — check: none: x\n";

row("W-563-b4 a repeated class without a census is refused", () => {
  const w = censusWorld(true);
  const r = w.sign("architect", "2", SIGNED);
  assert.equal(r.exitCode, 2, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(r.written, false, "no log is written");
  assert.equal(r.stderr, 'W-300: class census: spec×wide-gap is a repeated class of this opus, and the brief has no "Class census: spec×wide-gap <script> -> <output> sha256:<hex>" line\n');
});

row("W-563-b4 an output at another digest is refused", () => {
  const w = censusWorld(true);
  w.setBrief([census(w, "c1", "site a.ts:1\n", "0".repeat(64))]);
  const r = w.sign("architect", "2", SIGNED);
  assert.equal(r.exitCode, 2, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.match(r.stderr, /^W-300: class census: spec×wide-gap's census output \S+c1\.out has sha256 [0-9a-f]{64}, not the 0{64} the brief names\n$/);
});

row("W-563-b4 a limit without a follow-on is refused", () => {
  const w = censusWorld(true);
  w.setBrief([census(w, "c2", "site a.ts:1\nlimit b.ts:2 unchanged\n")]);
  const r = w.sign("architect", "2", SIGNED);
  assert.equal(r.exitCode, 2, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(r.stderr, `W-300: class census: spec×wide-gap's census output line 2 is a limit with no "follow-on:"\n`);
});

row("W-563-b4 a class seen once needs no census", () => {
  const w = censusWorld(false);
  const r = w.sign("architect", "2", SIGNED);
  assert.equal(r.exitCode, 0, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(r.written, true, "the log is written");
});

row("W-563-b4 a well-shaped census signs", () => {
  const w = censusWorld(true);
  w.setBrief([census(w, "c3", "site a.ts:1\nlimit b.ts:2 unchanged follow-on: W-999\n")]);
  const r = w.sign("architect", "2", SIGNED);
  assert.equal(r.exitCode, 0, `exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(r.written, true, "the log is written");
});


const EVERY = "every site of a flagged class in round 1";
const SENSE_TEXTS = ["for sense, not only conformance", "the Patron ruled it or an agent wrote it", "what the screen should do instead"];
/** b5's fixture: an officina root whose manifest declares the ops collegium and whose one prompt holds `texts`; findings for that prompt only. */
function promptFindings(path: string, texts: readonly string[]): string[] {
  const root = scratch("b5");
  put(root, path, `# t\n\n---\n\n${texts.join("\n")}\n`);
  const manifest = { collegia: [{ id: "ops" }] };
  return checkPromptTemplates(root, { manifest } as unknown as Parameters<typeof checkPromptTemplates>[1]).filter((f) => f.where === path).map((f) => f.message);
}

row("W-563-b5 a spec prompt without the clause is blocked", () => {
  assert.deepEqual(promptFindings("prompts/spec-review.md", [...SENSE_TEXTS, EVERY]), [], "with the clause it passes");
  assert.deepEqual(promptFindings("prompts/spec-review.md", SENSE_TEXTS), [`lacks ${EVERY}`], "without it the template is blocked");
});

row("W-563-b5 a build prompt without the clause is blocked", () => {
  const needs = (PROMPT_TEMPLATES["prompts/build-review.md"] ?? []).filter((n) => n !== EVERY);
  assert.deepEqual(promptFindings("prompts/build-review.md", [...needs, EVERY]), [], "with the clause it passes");
  assert.deepEqual(promptFindings("prompts/build-review.md", needs), [`lacks ${EVERY}`], "without it the template is blocked");
});

row("W-563-b5 a draft prompt without the gate is blocked", () => {
  const needs = (PROMPT_TEMPLATES["prompts/spec-draft.md"] ?? []).filter((n) => n !== "Gate log:" && n !== "presign-gate.ts");
  assert.deepEqual(promptFindings("prompts/spec-draft.md", [...needs, "Gate log:", "presign-gate.ts"]), [], "with the gate it passes");
  assert.deepEqual(promptFindings("prompts/spec-draft.md", [...needs, "presign-gate.ts"]), ["lacks Gate log:"], "without the citation it is blocked");
  assert.deepEqual(promptFindings("prompts/spec-draft.md", [...needs, "Gate log:"]), ["lacks presign-gate.ts"], "without the runner it is blocked");
});

row("W-563-b5 a draft prompt without the exit-boundary clause is blocked", () => {
  const clause = "Each reused command, script or subprocess the opus runs gets one Input row naming the call and the function that turns its non-zero exit or timeout into a refusal.";
  const needs = (PROMPT_TEMPLATES["prompts/spec-draft.md"] ?? []).filter((n) => n !== clause);
  assert.deepEqual(promptFindings("prompts/spec-draft.md", [...needs, clause]), [], "with the clause it passes");
  assert.deepEqual(promptFindings("prompts/spec-draft.md", needs), [`lacks ${clause}`], "without it the template is blocked");
});

// ---- round-1 review fixes (build review 1): the log's `started` is the runner's ISO instant; the import scan is comment- and string-aware ----
const HEX40 = "a".repeat(40);
const logWith = (over: Record<string, string> = {}, rows: string[] = ["0\t0.1\tcheck\t-\tnpm run -s check -- studio --repo ."]): string =>
  [`# presign-gate: ${over.id ?? "W-1"}`, `# base: ${over.base ?? HEX40}`, `# series: ${over.series ?? `sha256:${"b".repeat(64)}`}`, `# tree: ${over.tree ?? HEX40}`, `# started: ${over.started ?? "2026-11-11T12:00:00.000Z"}`, ...rows, `# minutes: ${over.minutes ?? "0.1"}`].join("\n") + "\n";

row("W-563-b3 a log with a valid ISO instant for started reads", () => {
  assert.ok(!("error" in readGateLog(logWith())), "the runner's own form reads");
});
for (const bad of ["not-an-iso-instant", "2026-11-11", "2026-11-11T12:00:00Z", "2026-11-11T12:00:00.000+00:00", "2026-02-30T00:00:00.000Z", "2026-13-01T00:00:00.000Z", "2026-11-11 12:00:00.000Z", "2026-11-11T25:00:00.000Z", "2026-11-11t12:00:00.000z", "+012026-11-11T12:00:00.000Z", "2026-11-11T12:00:00.0000Z"])
  row(`W-563-b3 a started of ${JSON.stringify(bad)} is refused`, () => {
    assert.ok("error" in readGateLog(logWith({ started: bad })), "a started that is not the runner's ISO instant is refused");
  });
// the census of every other field: each already exact, pinned so a loosening fails here
for (const [what, over] of [
  ["base in uppercase hex", { base: "A".repeat(40) }],
  ["base of 39 hex", { base: "a".repeat(39) }],
  ["tree of 65 hex", { tree: "a".repeat(65) }],
  ["tree with a non-hex digit", { tree: `${"a".repeat(39)}g` }],
  ["series without sha256:", { series: "b".repeat(64) }],
  ["series of 63 hex", { series: `sha256:${"b".repeat(63)}` }],
  ["minutes without a decimal", { minutes: "1" }],
  ["minutes of two decimals", { minutes: "1.25" }],
  ["minutes negative", { minutes: "-1.0" }],
] as [string, Record<string, string>][])
  row(`W-563-b3 a log with ${what} is refused`, () => {
    assert.ok("error" in readGateLog(logWith(over)), `${what} is refused`);
  });
for (const [what, line] of [
  ["an exit of 1000", "1000\t0.1\tcheck\t-\tx"],
  ["an exit of 01", "01\t0.1\tcheck\t-\tx"],
  ["seconds without a decimal", "0\t1\tcheck\t-\tx"],
  ["an unknown kind", "0\t0.1\tlint\t-\tx"],
  ["an empty command", "0\t0.1\tcheck\t-\t"],
  ["an empty file field", "0\t0.1\ttest\t\tx"],
  ["a fifth tab", "0\t0.1\ttest\ta\tb\tc"],
] as [string, string][])
  row(`W-563-b3 a row with ${what} is refused`, () => {
    assert.ok("error" in readGateLog(logWith({}, [line])), `${what} is refused`);
  });

/** One test file `pkg/a.test.ts` (named by test:suite) holding `src`, and a touched `pkg/a.ts`: does the scan owe the test a row? */
function owes(src: string): boolean {
  const files = ["package.json", "pkg/a.ts", "pkg/a.test.ts"];
  const rows = rowsAt(files, (p) => (p === "package.json" ? JSON.stringify({ scripts: { "test:suite": "node --import tsx pkg/a.test.ts" } }) : p === "pkg/a.test.ts" ? src : undefined), ["pkg/a.ts"], []);
  assert.ok(!("error" in rows), "rows are computed");
  return (rows as { kind: string }[]).some((r) => r.kind === "test");
}
const OWES: [string, string][] = [
  ["static default import", 'import x from "./a.js";\n'],
  ["static named import", 'import { a } from "./a.js";\n'],
  ["static namespace import", 'import * as a from "./a.js";\n'],
  ["default and named import", 'import x, { a } from "./a.js";\n'],
  ["type import", 'import type { A } from "./a.js";\n'],
  ["side-effect import", 'import "./a.js";\n'],
  ["export star from", 'export * from "./a.js";\n'],
  ["export star as from", 'export * as n from "./a.js";\n'],
  ["export named from", 'export { a } from "./a.js";\n'],
  ["export type from", 'export type { A } from "./a.js";\n'],
  ["literal dynamic import", 'await import("./a.js");\n'],
  ["side-effect import with a block comment before the specifier", 'import/* stray */ "./a.js";\n'],
  ["side-effect import with a block comment between", 'import /* a */ "./a.js";\n'],
  ["side-effect import with a newline between", 'import\n"./a.js";\n'],
  ["side-effect import with a line comment and newline between", 'import // c\n"./a.js";\n'],
  ["static import with comments between every token", 'import /* a */ x /* b */ from /* c */ "./a.js";\n'],
  ["static import with a line comment before the specifier", 'import x from // c\n "./a.js";\n'],
  ["static import with a multi-line brace list and comments", 'import {\n  a, // one\n  b, /* two */\n} from "./a.js";\n'],
  ["export from with a newline before from", 'export {a}\nfrom "./a.js";\n'],
  ["export star with comments", 'export /* a */ * /* b */ from /* c */ "./a.js";\n'],
  ["dynamic import with comments inside the parentheses", 'await import(/* c */ "./a.js" /* d */);\n'],
  ["dynamic import with a newline in the parentheses", 'await import(\n  "./a.js"\n);\n'],
  ["import after a comment holding a semicolon and a quote", '/* it\'s ; */ import "./a.js";\n'],
  ["import after a line comment holding a quote", "// don't\nimport \"./a.js\";\n"],
  ["import after a string holding two slashes", 'const u = "http://x"; import "./a.js";\n'],
  ["import after a string holding a block-comment opener", 'const u = "/*"; import "./a.js";\n'],
  ["import after a template holding a comment opener", "const u = `//`;\nimport \"./a.js\";\n"],
  ["dynamic import inside a template expression", "const u = `${await import(\"./a.js\")}`;\n"],
  ["dynamic import after a regular-expression literal", 'const r = /"/; await import("./a.js");\n'],
  ["import after an object literal inside a template expression and a block", "const u = `${ {a: 1}.a }`; { const v = 1; }\nimport \"./a.js\";\n"],
  ["import after a block that closes", 'if (x) { y(); }\nimport "./a.js";\n'],
  ["string-named namespace re-export", 'export * as "ns" from "./a.js";\n'],
  ["string-named re-export binding", 'export { a as "b" } from "./a.js";\n'],
  ["string-named re-exported name", 'export { "a" as b } from "./a.js";\n'],
  ["string-named import binding", 'import { "a" as b } from "./a.js";\n'],
  ["string-named import and default", 'import d, { "a-b" as b } from "./a.js";\n'],
  ["export type star", 'export type * from "./a.js";\n'],
  ["export type star as", 'export type * as n from "./a.js";\n'],
  ["static import with attributes", 'import x from "./a.js" with { type: "json" };\n'],
  ["side-effect import with attributes", 'import "./a.js" with { type: "json" };\n'],
  ["export from with attributes", 'export * from "./a.js" with { type: "json" };\n'],
  ["import defer namespace", 'import defer * as ns from "./a.js";\n'],
  ["import source binding", 'import source x from "./a.js";\n'],
  ["dynamic import with a trailing comma", 'await import("./a.js",);\n'],
  ["dynamic import with options", 'await import("./a.js", { with: { type: "json" } });\n'],
  ["dynamic import with options and a trailing comma", 'await import("./a.js", { with: { type: "json" } },);\n'],
  ["dynamic import with comments around the comma", 'await import("./a.js" /* a */, /* b */ {});\n'],
  ["import.defer dynamic", 'await import.defer("./a.js");\n'],
  ["import.source dynamic", 'await import.source("./a.js");\n'],
  ["escaped hex in a side-effect specifier", 'import "./\\x61.js";\n'],
  ["escaped unicode in a static specifier", 'import x from "./\\u0061.js";\n'],
  ["escaped braced unicode in a dynamic specifier", 'await import("./\\u{61}.js");\n'],
  ["escaped braced unicode for the dot in a specifier", 'import "./a\\u{2e}js";\n'],
  ["escaped octal in a specifier", 'import "./\\141.js";\n'],
  ["line continuation inside a specifier", 'import "./a\\\n.js";\n'],
  ["CRLF line continuation inside a specifier", 'import "./a\\\r\n.js";\n'],
  ["escaped slash in a specifier", 'import ".\\/a.js";\n'],
  ["escaped quote kept inside a string before the import", 'const s = "\\"";\nimport "./a.js";\n'],
  ["single-quoted specifier", "import './a.js';\n"],
  ["import after import.meta", 'const u = import.meta.url;\nimport "./a.js";\n'],
];
for (const [what, src] of OWES) row(`W-563-b1 ${what} owes a row`, () => assert.ok(owes(src), "the direct import is a row"));
const OWES_NOT: [string, string][] = [
  ["a line comment holding a side-effect import", '// import "./a.js"\n'],
  ["a line comment holding a static import", '// import x from "./a.js"\n'],
  ["a block comment holding a side-effect import", '/* import "./a.js" */\n'],
  ["a block comment holding a static import", '/* import x from "./a.js" */\n'],
  ["a multi-line block comment holding an import", '/*\n import { a } from "./a.js";\n*/\n'],
  ["a block comment holding a dynamic import", '/* import("./a.js") */\n'],
  ["a block comment holding an export from", '/* export * from "./a.js" */\n'],
  ["a trailing line comment holding an import", 'const x = 1; // import "./a.js"\n'],
  ["a single-quoted string holding an import", "const s = 'import \"./a.js\"';\n"],
  ["a double-quoted string holding a static import", 'const s = "import x from \'./a.js\'";\n'],
  ["a double-quoted string holding a dynamic import", 'const s = "import(\'./a.js\')";\n'],
  ["a template holding a side-effect import", "const s = `import \"./a.js\"`;\n"],
  ["a template holding a static import", "const s = `\nimport x from \"./a.js\";\n`;\n"],
  ["import.meta alone", "const u = import.meta.url;\n"],
  ["a member named import", 'const m = o.import("./a.js");\n'],
  ["a regular-expression literal holding an import", 'const r = /import "\\.\\/a.js"/;\n'],
  ["a string holding a comment closer after a comment opener", 'const s = "/*"; const t = "*/ import \\"./a.js\\"";\n'],
  ["a string-named export with no from", 'export { a as "b" };\n'],
  ["an escaped specifier that cooks to another file", 'import "./\\x62.js";\n'],
  ["a dynamic import of a template literal", "await import(`./a.js`);\n"],
  ["a dynamic import whose second argument holds the specifier", 'await import(spec, "./a.js");\n'],
  ["a member import.meta.resolve of a string", 'const u = import.meta.resolve("./a.js");\n'],
  ["an escaped string holding an import", 'const s = "import \\"./a.js\\"";\n'],
  ["a variable named from", 'export const from = "./a.js";\n'],
  ["a non-literal dynamic import", "await import(spec);\n"],
  ["a non-literal dynamic import over a comment", 'await import(/* "./a.js" */ spec);\n'],
];
for (const [what, src] of OWES_NOT) row(`W-563-b1 ${what} owes no row`, () => assert.ok(!owes(src), "no direct import, no row"));
