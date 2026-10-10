/**
 * W-166: a recorded red certifies the tree its brief names. Rows are named
 * `W-166-b<n> behaviour <n>: …` and selected with `--test-name-pattern=W-166-b<n>`.
 * node:test TAP. The `red` rows spawn the real CLI against real git fixtures
 * under os.tmpdir(); no timers, sleeps or polling.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL } from "@bisellium/core";
import { sourceTreeHash } from "@bisellium/shim";
import { runReady } from "./lifecycle.js";
import { checkEvidence } from "./rules/evidence.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "main.ts");
const REPO = join(HERE, "..", "..", "..");
const SAMPLE = join(REPO, "examples", "sample-studio");
/** tsx by absolute URL: a red under test runs with cwd in a scratch repository, where a bare "tsx" does not resolve. */
const TSX = import.meta.resolve("tsx");
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

Object.assign(process.env, {
  LC_ALL: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "W-166 Test",
  GIT_AUTHOR_EMAIL: "w166@example.invalid",
  GIT_COMMITTER_NAME: "W-166 Test",
  GIT_COMMITTER_EMAIL: "w166@example.invalid",
});
delete process.env["BISELLIUM_SELLA"];

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function scratch(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w166-${tag}-`)));
  dirs.push(d);
  return d;
}

/** Fixture git: the real binary by absolute path. */
function G(cwd: string, args: string[]): string {
  const r = spawnSync(REAL_GIT, args, { cwd, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.stderr}${r.stdout}`);
  return r.stdout.trim();
}
function put(dir: string, rel: string, text: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

/** A scratch repository on master with `src/a.txt` and a copy of the sample officina at `studio/`, all committed. */
function repoWithStudio(tag: string): string {
  const R = scratch(tag);
  G(R, ["init", "-q", "-b", "master"]);
  put(R, "src/a.txt", "one\n");
  cpSync(SAMPLE, join(R, "studio"), { recursive: true, dereference: true });
  G(R, ["add", "-A"]);
  G(R, ["commit", "-q", "-m", "fixture"]);
  return R;
}
/** A linked worktree of `R` detached at its HEAD. */
function linked(R: string, name: string): string {
  const wt = join(scratch(name), "wt");
  G(R, ["worktree", "add", "-q", "--detach", wt, "HEAD"]);
  return realpathSync(wt);
}

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}
/** The real `bisellium red <id> --behaviour <n> --sella eng-lead …` in `cwd`; `flags` go before the `--` command. */
function red(cwd: string, id: string, n: number, flags: string[], cmd: string[]): Ran {
  const r = spawnSync(
    process.execPath,
    ["--import", TSX, MAIN, "red", id, "--behaviour", String(n), "--sella", "eng-lead", "--now", "2026-10-02T12:00:00Z", ...flags, "--", ...cmd],
    { cwd, encoding: "utf8", timeout: 120_000, env: process.env },
  );
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const FAIL: string[] = ["node", "-e", "process.exit(1)"];
const logOf = (studio: string, id: string, k: number): string => join(studio, "ci", "reds", id, `${String(k).padStart(2, "0")}.log`);
const headerLine = (log: string, key: string): string => readFileSync(log, "utf8").split("\n").find((l) => l.startsWith(`# ${key}:`)) ?? "";

// ---------------------------------------------------------------------------
// 1. a red never certifies another repository; it hashes with the officina's exclusions in every worktree of the studio's repository
// ---------------------------------------------------------------------------
test("W-166-b1 behaviour 1: a linked-worktree red hashes with the studio's exclusions", () => {
  const M = repoWithStudio("b1-main");
  const WT = linked(M, "b1-wt");
  const studio = join(M, "studio");
  const r = red(M, "W-900", 1, ["--studio", studio, "--cwd", WT], FAIL);
  assert.equal(r.status, 0, `1a: the red records (${r.stderr})`);
  const expected = `tree:${sourceTreeHash(WT, ["studio", ".bisellium"], "HEAD")}`;
  assert.equal(headerLine(logOf(studio, "W-900", 1), "tree"), `# tree: ${expected}`, "1a: # tree: is the worktree's source tree under the studio exclusions");
});

test("W-166-b1 behaviour 1: a --repo that is another worktree is refused and nothing runs", () => {
  const M = repoWithStudio("b1-two");
  const A = linked(M, "b1-a");
  const B = linked(M, "b1-b");
  const studio = join(M, "studio");
  const redsDir = join(studio, "ci", "reds", "W-900");
  put(studio, "ci/reds/W-900/01.log", "PRESEEDED-01\n");
  const marker = join(A, "ran-here.txt");
  const r = red(M, "W-900", 2, ["--studio", studio, "--cwd", A, "--repo", B], ["node", "-e", "require('node:fs').writeFileSync('ran-here.txt','x');process.exit(1)"]);
  assert.equal(r.status, 2, `1b: a disagreeing --repo exits 2 (${r.stderr})`);
  assert.equal(existsSync(marker), false, "1b: the command never ran");
  assert.deepEqual(readdirSync(redsDir), ["01.log"], "1b: no log was written");
  assert.equal(readFileSync(join(redsDir, "01.log"), "utf8"), "PRESEEDED-01\n", "1b: the preseeded log is byte-identical");
  assert.ok(r.stderr.includes(A) && r.stderr.includes(B), `1b: the refusal names both roots (${r.stderr})`);
});

test("W-166-b1 behaviour 1: a symlinked spelling of the cwd's root is accepted", () => {
  const M = repoWithStudio("b1-link");
  const A = linked(M, "b1-linka");
  const spelled = join(scratch("b1-spell"), "alias");
  symlinkSync(A, spelled);
  const r = red(M, "W-900", 1, ["--studio", join(M, "studio"), "--cwd", A, "--repo", spelled], FAIL);
  assert.equal(r.status, 0, `1c: the symlinked --repo is the same root (${r.stderr})`);
});

test("W-166-b1 behaviour 1: a --repo that is a subdirectory or a symlink to one is refused and nothing runs", () => {
  const M = repoWithStudio("b1-sub");
  const studio = join(M, "studio");
  const sub = join(M, "src");
  const alias = join(scratch("b1-subalias"), "alias");
  symlinkSync(sub, alias);
  for (const [name, repo] of [
    ["a subdirectory", sub],
    ["a symlink to a subdirectory", alias],
  ] as const) {
    put(studio, "ci/reds/W-900/01.log", "PRESEEDED-01\n");
    const marker = join(M, "ran-sub.txt");
    const r = red(M, "W-900", 2, ["--studio", studio, "--repo", repo], ["node", "-e", "require('node:fs').writeFileSync('ran-sub.txt','x');process.exit(1)"]);
    assert.equal(r.status, 2, `1e: ${name} exits 2 (${r.stderr})`);
    assert.equal(existsSync(marker), false, `1e: ${name}: the command never ran`);
    assert.deepEqual(readdirSync(join(studio, "ci", "reds", "W-900")), ["01.log"], `1e: ${name}: no log was written`);
    assert.equal(readFileSync(join(studio, "ci", "reds", "W-900", "01.log"), "utf8"), "PRESEEDED-01\n", `1e: ${name}: the preseeded log is byte-identical`);
  }
});

test("W-166-b1 behaviour 1: a non-Git --repo still records unknown", () => {
  const M = repoWithStudio("b1-nongit");
  const plain = scratch("b1-plain");
  const studio = join(M, "studio");
  const r = red(M, "W-900", 1, ["--studio", studio, "--repo", plain], FAIL);
  assert.equal(r.status, 0, `1d: a non-Git --repo records (${r.stderr})`);
  assert.equal(headerLine(logOf(studio, "W-900", 1), "tree"), "# tree: unknown", "1d: no repository is certified");
});

// ---------------------------------------------------------------------------
// 2. an opted-in red runs every earlier behaviour's recorded command first
// ---------------------------------------------------------------------------
const ID = "W-900";
const LINE = "Red order: one at a time";

interface FxOptions {
  /** The real lines of the brief's Intent that carry the opt-in; default one exact line. */
  lines?: string[];
  /** The opus record's `spec:` value; default the brief. */
  spec?: string;
  /** Written verbatim after `source_excludes:` in bisellium.yml. */
  excludes?: string;
  /** No `opera/W-900.md` at all. */
  noRecord?: boolean;
  /** 01.log: the prerequisite's exit code and `# pass` count; `null` writes no 01.log. */
  prereq?: { exit: number; pass: number } | null;
}
interface Fx {
  M: string;
  studio: string;
  /** Every command a red runs appends its name here, so the file is the order they ran in. */
  order: string;
  prereq: string;
  target: (mode?: string) => string[];
}

/** A scratch repository with the sample officina, an opted-in (or not) two-behaviour W-900, branch opus/W-900 at HEAD. */
function optedFixture(tag: string, o: FxOptions = {}): Fx {
  const M = repoWithStudio(tag);
  const studio = join(M, "studio");
  const S = scratch(`${tag}-scripts`);
  const order = join(S, "order.txt");
  put(S, "prereq.cjs", 'const fs=require("node:fs");fs.appendFileSync(process.argv[2],"b1\\n");console.log("# pass "+process.argv[4]);process.exit(Number(process.argv[3]));\n');
  put(
    S,
    "target.cjs",
    'const fs=require("node:fs");fs.appendFileSync(process.argv[2],"target\\n");const m=process.argv[3];if(m==="tracked")fs.appendFileSync("src/a.txt","x\\n");if(m==="studio")fs.writeFileSync("studio/note.txt","x\\n");process.exit(1);\n',
  );
  if (o.excludes !== undefined) {
    const yml = join(studio, "bisellium.yml");
    writeFileSync(yml, readFileSync(yml, "utf8").replace(/^source_excludes:.*$/m, `source_excludes: ${o.excludes}`));
  }
  put(studio, `briefs/${ID}.md`, `# ${ID} fixture\n\n## Intent\n\n${(o.lines ?? [LINE]).join("\n")}\n\n## Behaviours to test\n\n1. one\n2. two\n`);
  if (!o.noRecord)
    put(studio, `opera/${ID}.md`, `---\nid: ${ID}\ntitle: Order fixture\nkind: feature\ncollegium: engineering\nstate: building\nprobationes: {}\nspec: ${o.spec ?? `briefs/${ID}.md`}\n---\nbody\n`);
  const prereq = o.prereq === undefined ? { exit: 0, pass: 1 } : o.prereq;
  const prereqCmd = `node ${join(S, "prereq.cjs")} ${order} ${prereq?.exit ?? 0} ${prereq?.pass ?? 1}`;
  if (prereq !== null)
    put(studio, `ci/reds/${ID}/01.log`, `# behaviour: 1\n# command: ${prereqCmd}\n# exit: 1\n# at: 2026-10-02T12:00:00.000Z\n# sella: eng-lead\n# tree: tree:0000\n\nfixture\n`);
  put(M, "escape.md", "# not a brief\n");
  G(M, ["add", "-A"]);
  G(M, ["commit", "-q", "-m", "opus fixture"]);
  G(M, ["branch", `opus/${ID}`]);
  return { M, studio, order, prereq: prereqCmd, target: (mode = "plain") => ["node", join(S, "target.cjs"), order, mode] };
}
const ranOrder = (fx: Fx): string => (existsSync(fx.order) ? readFileSync(fx.order, "utf8") : "");
const redIn = (fx: Fx, n: number, flags: string[] = [], cmd: string[] = fx.target(), cwd: string = fx.M): Ran =>
  red(cwd, ID, n, ["--studio", fx.studio, ...flags], cmd);

test("W-166-b2 behaviour 2: an opted-in red runs the earlier behaviour first, then the target", () => {
  const fx = optedFixture("b2-ok");
  const r = redIn(fx, 2);
  assert.equal(r.status, 0, `2a: the red records (${r.stderr})`);
  assert.equal(ranOrder(fx), "b1\ntarget\n", "2a: behaviour 1's recorded command ran, then the target");
  const lines = readFileSync(logOf(fx.studio, ID, 2), "utf8").split("\n");
  assert.deepEqual(lines.slice(0, 5).map((l) => l.split(":")[0]), ["# behaviour", "# command", "# exit", "# at", "# sella"], "2a: the log keeps today's header");
  assert.ok((lines[5] ?? "").startsWith("# tree: tree:"), "2a: the sixth header line is a clean tree identity");
  assert.equal(lines[1], `# command: ${fx.target().join(" ")}`, "2a: # command: is the target alone");
  assert.equal(r.stdout.trim(), `${ID}: red recorded for behaviour 2 -> ci/reds/${ID}/02.log`, "2a: stdout keeps its one recorded line");
});

const refusals: { name: string; opts: FxOptions; flags?: (fx: Fx) => string[]; cmd?: (fx: Fx) => string[]; run?: (fx: Fx) => Ran; dirty?: boolean }[] = [
  { name: "a missing 01.log", opts: { prereq: null } },
  { name: "a malformed opt-in line", opts: { lines: ["red order: one at a time"] } },
  { name: "a repeated opt-in line", opts: { lines: [LINE, LINE] } },
  { name: "an unsafe spec", opts: { spec: "../escape.md" } },
  { name: "a dirty tree", opts: {}, dirty: true },
  { name: "a scalar source_excludes", opts: { excludes: "examples/" } },
  { name: "a scalar source_excludes without the line", opts: { excludes: "examples/", lines: [] } },
  { name: "a HEAD that is not on the opus branch", opts: {}, run: (fx) => {
    const WT = linked(fx.M, "b2-side");
    put(WT, "side.txt", "side\n");
    G(WT, ["add", "-A"]);
    G(WT, ["commit", "-q", "-m", "side"]);
    return redIn(fx, 2, ["--cwd", WT]);
  } },
  { name: "a cwd below the repository root", opts: {}, flags: (fx) => ["--cwd", join(fx.M, "src")] },
  { name: "an empty target argument", opts: {}, cmd: (fx) => [...fx.target(), ""] },
  { name: "a target argument with a space", opts: {}, cmd: (fx) => [...fx.target(), "two words"] },
  { name: "a non-Git --repo", opts: {}, flags: () => ["--repo", scratch("b2-plain")] },
];
for (const c of refusals)
  test(`W-166-b2 behaviour 2: ${c.name} exits 2 with no command run and no log`, () => {
    const fx = optedFixture("b2-refuse", c.opts);
    if (c.dirty) appendDirty(fx);
    const r = c.run ? c.run(fx) : redIn(fx, 2, c.flags?.(fx) ?? [], c.cmd?.(fx));
    assert.equal(r.status, 2, `2b: ${c.name} exits 2 (${r.stderr})`);
    assert.equal(ranOrder(fx), "", "2b: no command ran");
    assert.equal(existsSync(logOf(fx.studio, ID, 2)), false, "2b: no 02.log");
  });
function appendDirty(fx: Fx): void {
  writeFileSync(join(fx.M, "src", "a.txt"), "one\ndirty\n");
}

for (const withLine of [true, false])
  test(`W-166-b2 behaviour 2: an executable that never starts exits 2 and writes no log (${withLine ? "opted in" : "no line"})`, () => {
    const fx = optedFixture("b2-spawn", withLine ? {} : { lines: [] });
    const r = redIn(fx, 2, [], ["definitely-not-a-command-w166"]);
    assert.equal(r.status, 2, `2c: a spawn failure exits 2 (${r.stderr})`);
    assert.equal(existsSync(logOf(fx.studio, ID, 2)), false, "2c: no 02.log");
    assert.equal(ranOrder(fx), withLine ? "b1\n" : "", "2c: under the line b1 ran first; without it nothing did");
  });

for (const [name, prereq] of [["exits 1", { exit: 1, pass: 1 }], ["exits 0 with # pass 0", { exit: 0, pass: 0 }]] as const)
  test(`W-166-b2 behaviour 2: a behaviour 1 command that ${name} exits 1, writes no log and never runs the target`, () => {
    const fx = optedFixture("b2-prereq", { prereq });
    const r = redIn(fx, 2);
    assert.equal(r.status, 1, `2d: an unmet prerequisite exits 1 (${r.stderr})`);
    assert.equal(ranOrder(fx), "b1\n", "2d: only the prerequisite ran");
    assert.equal(existsSync(logOf(fx.studio, ID, 2)), false, "2d: no 02.log");
  });

test("W-166-b2 behaviour 2: a target that modifies a tracked file outside the exclusions exits 1", () => {
  const fx = optedFixture("b2-tracked");
  const r = redIn(fx, 2, [], fx.target("tracked"));
  assert.equal(r.status, 1, `2e: a tree moved by the target exits 1 (${r.stderr})`);
  assert.equal(existsSync(logOf(fx.studio, ID, 2)), false, "2e: no 02.log");
});

test("W-166-b2 behaviour 2: a target that writes under the studio still records", () => {
  const fx = optedFixture("b2-studio");
  const r = redIn(fx, 2, [], fx.target("studio"));
  assert.equal(r.status, 0, `2f: the studio is excluded from the moved-tree check (${r.stderr})`);
  assert.equal(existsSync(logOf(fx.studio, ID, 2)), true, "2f: 02.log exists");
});

test("W-166-b2 behaviour 2: behaviour 1, a brief without the line and an opus with no record run the target only", () => {
  const first = optedFixture("b2-first");
  assert.equal(redIn(first, 1).status, 0, "2g: behaviour 1 records");
  assert.equal(ranOrder(first), "target\n", "2g: behaviour 1 of an opted-in brief runs only the target");
  const plain = optedFixture("b2-plain", { lines: [], prereq: null });
  assert.equal(redIn(plain, 2).status, 0, "2h: a brief without the line records with no 01.log");
  assert.equal(ranOrder(plain), "target\n", "2h: and runs only the target");
  const bare = optedFixture("b2-bare", { noRecord: true, prereq: null });
  assert.equal(redIn(bare, 2).status, 0, "2i: an opus with no record records");
  assert.equal(ranOrder(bare), "target\n", "2i: and runs only the target");
});

// ---------------------------------------------------------------------------
// 3. check blocks an opted-in red that shares its tree with an earlier behaviour's red
// ---------------------------------------------------------------------------
/** An officina directory (no repository) with W-900 in `state`, a two-behaviour brief and one red log per entry of `trees`. */
function evidenceRoot(tag: string, o: { state?: string; lines?: string[]; trees: string[] }): string {
  const dir = scratch(tag);
  put(dir, "bisellium.yml", "name: fixture\n");
  put(dir, `opera/${ID}.md`, `---\nid: ${ID}\ntitle: Order fixture\nkind: feature\ncollegium: engineering\nstate: ${o.state ?? "building"}\nprobationes: {}\nspec: briefs/${ID}.md\n---\nbody\n`);
  put(dir, `briefs/${ID}.md`, `# ${ID} fixture\n\n## Intent\n\n${(o.lines ?? [LINE]).join("\n")}\n\n## Behaviours to test\n\n1. one\n2. two\n`);
  o.trees.forEach((tree, i) =>
    put(dir, `ci/reds/${ID}/${String(i + 1).padStart(2, "0")}.log`, `# behaviour: ${i + 1}\n# command: node t.test.ts\n# exit: 1\n# at: 2026-10-02T12:00:00.000Z\n# sella: eng-lead\n# tree: ${tree}\n\nnot ok 1 - behaviour ${i + 1}\n`),
  );
  return dir;
}
const sharedTree = (root: string) => checkEvidence(root, { now: new Date("2026-10-08T12:00:00Z") }).filter((f) => f.rule === "opus.red_evidence" && f.level === "block");

test("W-166-b3 behaviour 3: an active opted-in opus whose reds share a tree gets one block naming both behaviours and the tree", () => {
  const blocks = sharedTree(evidenceRoot("b3-shared", { trees: ["tree:aaaa", "tree:aaaa"] }));
  assert.equal(blocks.length, 1, `3a: one opus.red_evidence block (${JSON.stringify(blocks)})`);
  assert.match(blocks[0]!.message, /behaviours 1 and 2/, "3a: the block names behaviours 1 and 2");
  assert.ok(blocks[0]!.message.includes("tree:aaaa"), "3a: the block names the tree");
  assert.equal(blocks[0]!.where, `opera/${ID}.md`, "3a: the block is on the opus record");
});

test("W-166-b3 behaviour 3: distinct trees, no line, and a done or halted opus give no shared-tree block", () => {
  assert.deepEqual(sharedTree(evidenceRoot("b3-distinct", { trees: ["tree:aaaa", "tree:bbbb"] })), [], "3b: distinct trees give no block");
  assert.deepEqual(sharedTree(evidenceRoot("b3-noline", { lines: [], trees: ["tree:aaaa", "tree:aaaa"] })), [], "3b: no opt-in line gives no block");
  for (const state of ["done", "halted"])
    assert.deepEqual(sharedTree(evidenceRoot(`b3-${state}`, { state, trees: ["tree:aaaa", "tree:aaaa"] })), [], `3b: a ${state} opus gives no block`);
});

// ---------------------------------------------------------------------------
// 5. ready refuses a brief without the opt-in line where brief_behaviour_limit is declared
// ---------------------------------------------------------------------------
const NO_RED_ORDER = `declares no red order; add the line "${LINE}"`;
const NO_FAMILY = 'declares no decree family; add one line "Decree family: <slug>"';

/** A copy of the sample officina (with `brief_behaviour_limit: 6` unless `limit` is false), a greenlit W-900 and an admitted brief whose Intent carries `lines`. */
function readyFixture(lines: string[], o: { limit?: boolean; family?: boolean; state?: string; extra?: string } = {}): { dir: string; stderr: string[]; exitCode: number; opus: { before: string; after: string }; eventsSame: boolean } {
  const dir = scratch("b5-ready");
  cpSync(SAMPLE, dir, { recursive: true, dereference: true });
  const yml = join(dir, "bisellium.yml");
  const doc = parseDocument(readFileSync(yml, "utf8"));
  if (o.limit !== false) doc.setIn(["brief_behaviour_limit"], 6);
  writeFileSync(yml, doc.toString({ lineWidth: 0 }));
  const brief = [
    `# ${ID} fixture`,
    "",
    "## Intent",
    "",
    ...(o.family === false ? [] : ["Decree family: red-order"]),
    "Read enumeration: `enumerate-reads.mjs` -> `reads.txt`",
    ...lines,
    "",
    "## Files owned",
    "",
    "- a.ts",
    "",
    "## Interfaces",
    "",
    "none",
    "",
    "## Input domain",
    "",
    "Each record has one valid domain and one rejecting function; a rejection fails closed.",
    "",
    "| Record | Valid domain | Rejected by |",
    "|---|---|---|",
    "| fixture record | a string | `readFixture` |",
    "",
    "## Behaviours to test",
    "",
    "1. Behaviour 1 refuses a thing.",
    "   **Genuine red:** row 1.1 fails on its assertion.",
    "",
    "## Acceptance",
    "",
    "green",
    "",
    "## Out of scope",
    "",
    "none",
    "",
  ].join("\n");
  put(dir, `briefs/${ID}.md`, brief);
  put(dir, `opera/${ID}.md`, `---\nid: ${ID}\ntitle: Admission fixture\nkind: feature\ncollegium: engineering\nstate: ${o.state ?? "greenlit"}\n${o.extra ?? ""}probationes: {}\n---\nbody\n`);
  const opusPath = join(dir, `opera/${ID}.md`);
  const before = readFileSync(opusPath, "utf8");
  const eventsPath = join(dir, EVENTS_LOG_REL);
  const events = (): string | undefined => (existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : undefined);
  const eventsBefore = events();
  const errors: string[] = [];
  const err = console.error;
  const log = console.log;
  console.error = (...a: unknown[]) => void errors.push(a.join(" "));
  console.log = () => undefined;
  let exitCode: number;
  try {
    exitCode = runReady([ID, "--sella", "architect", "--studio", dir], { now: new Date("2026-10-05T12:00:00Z") }).exitCode;
  } finally {
    console.error = err;
    console.log = log;
  }
  return {
    dir,
    stderr: errors.join("\n").split("\n").filter((l) => l.trim().length > 0),
    exitCode,
    opus: { before, after: readFileSync(opusPath, "utf8") },
    eventsSame: eventsBefore === events(),
  };
}

test("W-166-b5 behaviour 5: an admitted brief without the line is refused and the record is unchanged", () => {
  const r = readyFixture([]);
  assert.equal(r.exitCode, 1, `5a: exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.deepEqual(r.stderr, [`${ID}: brief.admission: briefs/${ID}.md ${NO_RED_ORDER}`], "5a: the one refusal line");
  assert.equal(r.opus.after, r.opus.before, "5a: the record is byte-identical");
  assert.ok(r.eventsSame, "5a: no event log appeared");
});

test("W-166-b5 behaviour 5: with the line the opus reaches building", () => {
  const r = readyFixture([LINE]);
  assert.equal(r.exitCode, 0, `5b: exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(readFront<{ state: string }>(join(r.dir, `opera/${ID}.md`)).data.state, "building", "5b: building");
});

test("W-166-b5 behaviour 5: a malformed line is refused with readRedOrder's error", () => {
  const r = readyFixture(["red order: one at a time"]);
  assert.equal(r.exitCode, 1, `5c: exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.deepEqual(r.stderr, [`${ID}: brief.admission: briefs/${ID}.md red order line "red order: one at a time" is not exactly "${LINE}"`], "5c: the error");
});

test("W-166-b5 behaviour 5: admission problems keep their exact stderr, and an officina with no limit asks nothing", () => {
  const r = readyFixture([], { family: false });
  assert.deepEqual(r.stderr, [`${ID}: brief.admission: briefs/${ID}.md ${NO_FAMILY}`], "5d: the red order requirement waits for admission");
  const open = readyFixture([], { limit: false });
  assert.equal(open.exitCode, 0, `5e: no limit, no requirement (stderr ${JSON.stringify(open.stderr)})`);
});

test("W-166-b5 behaviour 5: an opus already past ready, halted without the line, resumes to building; one never past ready is still refused", () => {
  const past = readyFixture([], { state: "halted", extra: "start: 2026-10-01T12:00:00.000Z\nbuilder_runtime: isolated\n" });
  assert.equal(past.exitCode, 0, `5f: a halted opus past ready resumes (stderr ${JSON.stringify(past.stderr)})`);
  assert.equal(readFront<{ state: string }>(join(past.dir, `opera/${ID}.md`)).data.state, "building", "5f: building");
  const green = readyFixture([], { state: "greenlit" });
  assert.deepEqual(green.stderr, [`${ID}: brief.admission: briefs/${ID}.md ${NO_RED_ORDER}`], "5g: a greenlit opus without the line is refused");
  const never = readyFixture([], { state: "halted" });
  assert.deepEqual(never.stderr, [`${ID}: brief.admission: briefs/${ID}.md ${NO_RED_ORDER}`], "5g: a halted opus never past ready is refused");
});
