/**
 * W-124 focused red suite: `bisellium next <opus>`. Select exactly one
 * numbered behaviour with `--behaviour N` (1..6); omitting the selector runs
 * all six plus the fixture self-check. Modelled on W-125's run.test.ts.
 *
 * Every row spawns the CLI (`main.ts next ...`) with a stub `gh` and a git
 * shim first on PATH, against a temporary repository with a bare origin. No
 * row statically imports `next.ts`/`integrate.ts`/`trunk.ts`, so a red is the
 * row's own failed assertion on the usage-banner fall-through, never a
 * module-load error. Nothing here reads from or writes to studio/ or
 * examples/sample-studio, and nothing touches the network or the real remote.
 *
 * Fixture officinae are built with the REAL verbs (`verdict`, `ready`,
 * `review`, `handoff`, `done`) wherever one exists, so the evidence the ladder
 * reads is the evidence production writes.
 *
 * BISELLIUM_TEST_PROC (builder note from the sec-lead): when it applies
 * (only with BISELLIUM_TEST_CLOCK=1) it replaces `/proc` for EVERY health
 * read, including the verb's own `/proc/self/stat`; rows in behaviour 5 pin
 * that, so a fake root with no `self/stat` makes `--perform` hold.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  cpSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { sourceTreeHash } from "@bisellium/shim";
import { editOpusFrontMatter } from "@bisellium/commands/frontmatter.js";
import { admitCurrentRunReceipt } from "@bisellium/commands/builder-run.js";
import { runDone } from "@bisellium/commands/lifecycle.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 6)) {
  console.error("next.test.ts: --behaviour must be an integer from 1 through 6");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

const OPUS = "W-900";
const BRANCH = `opus/${OPUS}`;
const NOW_ISO = "2026-10-02T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const T = {
  spec: "2026-10-02T01:00:00.000Z",
  ready: "2026-10-02T02:00:00.000Z",
  reds: "2026-10-02T03:00:00.000Z",
  review1: "2026-10-02T06:00:00.000Z",
  review2: "2026-10-02T07:00:00.000Z",
  done: "2026-10-02T10:00:00.000Z",
  handoffFresh: "2026-10-02T09:00:00.000Z",
  handoffStale: "2026-10-02T02:30:00.000Z",
};
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "main.ts");
const REPO_ROOT = join(HERE, "..", "..", "..");
const TSX = import.meta.resolve("tsx");
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const FAST = ["--poll-ms", "1", "--max-polls", "3"];

// ---------------------------------------------------------------------------
// scratch, git, cli helpers
// ---------------------------------------------------------------------------
const roots: string[] = [];
const children: ChildProcess[] = [];
function scratch(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `w124-${tag}-`));
  roots.push(root);
  return root;
}
after(() => {
  for (const child of children) child.kill("SIGKILL");
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SETUP_ENV: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"] ?? "/usr/bin:/bin",
  HOME: scratch("home"),
  LANG: "C.UTF-8",
  TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "W-124 Test",
  GIT_AUTHOR_EMAIL: "w124@example.invalid",
  GIT_COMMITTER_NAME: "W-124 Test",
  GIT_COMMITTER_EMAIL: "w124@example.invalid",
};

function git(cwd: string, args: string[], check = true): string {
  const r = spawnSync("git", args, { cwd, env: SETUP_ENV, encoding: "utf8", timeout: 60_000 });
  if (check && r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.stderr}${r.stdout}`);
  return (r.stdout ?? "").trim();
}
/** git whose failure is data (an empty string), for reads of refs the verb should have made. */
const gitq = (cwd: string, args: string[]): string => git(cwd, args, false);
const gitOk = (cwd: string, args: string[]): boolean => spawnSync("git", args, { cwd, env: SETUP_ENV, timeout: 60_000 }).status === 0;

function put(dir: string, rel: string, text: string): void {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function commit(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  if (!gitOk(dir, ["diff", "--cached", "--quiet"])) git(dir, ["commit", "-q", "-m", message]);
}
/** A REAL bisellium verb, run the way an operator would, in `cwd`. */
function verb(cwd: string, args: string[]): void {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd, env: SETUP_ENV, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`fixture bisellium ${args.join(" ")} (cwd ${cwd}) exited ${r.status}: ${r.stderr}${r.stdout}`);
}

// ---------------------------------------------------------------------------
// the stub gh and the git shim (single scenario source; see scenario())
// ---------------------------------------------------------------------------
const GH_STUB = String.raw`#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const argv = process.argv.slice(2);
const logPath = process.env.GH_STUB_LOG;
const note = (tag) => { if (logPath) fs.appendFileSync(logPath, [tag].concat(argv).join("\x1f") + "\n"); };
const args = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "-R" || argv[i] === "--repo") { i++; continue; }
  args.push(argv[i]);
}
const scenarioPath = process.env.GH_STUB_SCENARIO;
if (!scenarioPath) { note("gh-unmatched"); process.stderr.write("gh stub: no scenario\n"); process.exit(97); }
const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const statePath = scenarioPath + ".state";
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (e) { state = {}; }
let hit = -1;
for (let i = 0; i < scenario.rules.length && hit < 0; i++) {
  if (scenario.rules[i].match.every((t, k) => args[k] === t)) hit = i;
}
if (hit < 0) { note("gh-unmatched"); process.stderr.write("gh stub: unexpected call: " + args.join(" ") + "\n"); process.exit(97); }
note("gh");
const rule = scenario.rules[hit];
let replies = rule.replies;
for (const alt of rule.alts || []) {
  if ((alt.ifExists && fs.existsSync(alt.ifExists)) || (alt.ifMissing && !fs.existsSync(alt.ifMissing))) { replies = alt.replies; break; }
}
const n = state[hit] || 0;
state[hit] = n + 1;
fs.writeFileSync(statePath, JSON.stringify(state));
const reply = replies[Math.min(n, replies.length - 1)];
if (reply.touch) fs.writeFileSync(reply.touch, "1");
let out = "";
if (reply.bytes !== undefined) out = "x".repeat(reply.bytes);
else if (typeof reply.stdout === "string") out = reply.stdout;
else if (reply.stdout !== undefined) out = JSON.stringify(reply.stdout);
const code = reply.exit || 0;
const qi = Math.max(args.indexOf("-q"), args.indexOf("--jq"));
if (qi >= 0 && code === 0) {
  const expr = args[qi + 1];
  const v = JSON.parse(out);
  let m;
  if (expr === "length") out = String(v.length) + "\n";
  else if ((m = /^\.(\w+)$/.exec(expr))) out = String(v[m[1]]) + "\n";
  else if ((m = /^\.(\w+) \+ " " \+ \.(\w+)$/.exec(expr))) out = v[m[1]] + " " + v[m[2]] + "\n";
  else { process.stderr.write("gh stub: unsupported jq " + expr + "\n"); process.exit(98); }
} else if (args[0] === "pr" && args[1] === "checks" && !args.includes("--json") && Array.isArray(reply.stdout)) {
  out = reply.stdout.map((c) => [c.name, c.bucket, "0", "https://example.invalid/" + encodeURIComponent(c.name)].join("\t")).join("\n") + "\n";
}
if (reply.stderr) process.stderr.write(reply.stderr);
process.stdout.write(out, () => process.exit(code));
`;
const GIT_SHIM = String.raw`#!/bin/sh
if [ -n "${"$"}{GIT_STUB_LOG:-}" ]; then
  { printf 'git'; for a in "$@"; do printf '\037%s' "$a"; done; printf '\n'; } >> "$GIT_STUB_LOG"
fi
exec "$GIT_STUB_REAL" "$@"
`;
const BIN = scratch("bin");
writeFileSync(join(BIN, "gh"), GH_STUB, { mode: 0o755 });
writeFileSync(join(BIN, "git"), GIT_SHIM, { mode: 0o755 });

// ---------------------------------------------------------------------------
// captured real gh shapes (packages/cli/src/fixtures/gh, see provenance.json)
// ---------------------------------------------------------------------------
const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/gh/${name}`, import.meta.url), "utf8"));
const SLUG = (fx("repo-view.json") as { nameWithOwner: string }).nameWithOwner;
const CAND = (fx("pr-list-150.json") as Record<string, unknown>[])[0]!;
const CHECKS = fx("pr-checks.json") as { name: string; bucket: string; state: string }[];
const PR_NUMBER = 901;

type Json = Record<string, unknown>;
const OID_UNFETCHED = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
interface CandOpts {
  state: "OPEN" | "MERGED" | "CLOSED";
  oid?: string;
  merge?: string | null;
  number?: unknown;
  base?: string;
  cross?: boolean;
  headRepo?: string;
  mss?: string;
  head?: string;
  drop?: string[];
}
/** The captured pr-list shape (PR 150), mutated only by field. */
function cand(w: World, o: CandOpts): Json {
  const c: Json = {
    ...CAND,
    headRefName: o.head ?? BRANCH,
    headRefOid: o.oid ?? headOf(w),
    number: o.number ?? PR_NUMBER,
    state: o.state,
    baseRefName: o.base ?? "master",
    isCrossRepository: o.cross ?? false,
    mergeStateStatus: o.mss ?? (o.state === "OPEN" ? "CLEAN" : "UNKNOWN"),
    mergeCommit: o.state === "MERGED" ? (o.merge === undefined ? { oid: w.mergeOid ?? OID_UNFETCHED } : o.merge === null ? null : { oid: o.merge }) : null,
    headRepository: { ...(CAND["headRepository"] as Json), nameWithOwner: o.headRepo ?? SLUG },
  };
  for (const key of o.drop ?? []) delete c[key];
  return c;
}
/** The captured pr-view shape (PR 150) for a candidate. */
function viewOf(c: Json): Json {
  const out: Json = {};
  for (const key of ["number", "state", "mergeStateStatus", "headRefName", "headRefOid", "baseRefName", "mergeCommit"]) if (key in c) out[key] = c[key];
  return out;
}
const greens = (n = 6): Json[] => Array.from({ length: n }, (_, i) => ({ ...CHECKS[i % CHECKS.length]!, name: `${CHECKS[i % CHECKS.length]!.name} ${i}` }));
const check = (name: string, bucket: string): Json => ({ name, bucket, state: bucket === "pass" ? "SUCCESS" : bucket === "fail" ? "FAILURE" : "PENDING" });

interface Reply {
  stdout?: unknown;
  stderr?: string;
  exit?: number;
  bytes?: number;
  touch?: string;
}
interface Alt {
  ifExists?: string;
  ifMissing?: string;
  replies: Reply[];
}
interface Rule {
  replies: Reply[];
  alts?: Alt[];
}
type SlotName = "repoView" | "list" | "view" | "checks" | "alerts" | "update" | "merge" | "create";
const SLOT_MATCH: Record<SlotName, string[]> = {
  repoView: ["repo", "view"],
  list: ["pr", "list"],
  view: ["pr", "view"],
  checks: ["pr", "checks"],
  alerts: ["api"],
  update: ["pr", "update-branch"],
  merge: ["pr", "merge"],
  create: ["pr", "create"],
};
type SlotValue = Reply | Reply[] | Rule;
const asRule = (v: SlotValue): Rule => (Array.isArray(v) ? { replies: v } : "replies" in v ? v : { replies: [v] });

// ---------------------------------------------------------------------------
// the world: a repository, a bare origin, a studio, built with real verbs
// ---------------------------------------------------------------------------
interface World {
  tag: string;
  root: string;
  repo: string;
  origin: string;
  studio: string;
  wt: string;
  wtStudio: string;
  home: string;
  scn: string;
  log: string;
  behaviours: number;
  mergeOid?: string;
  /** The opus branch tip once the branch has been reviewed (survives the branch's deletion). */
  headOid?: string;
}
const STAGES = ["greenlight", "spec", "branch", "ready", "reds", "build", "review", "pr", "merge", "cleanup", "done", "checkpoint"] as const;
type Stage = (typeof STAGES)[number];
const idx = (s: Stage | "backlog"): number => (s === "backlog" ? -1 : STAGES.indexOf(s));

interface WorldOpts {
  behaviours?: number;
  /** Main checkout HEAD: master (default) or detached at the master tip (so `fetch origin master:master` can update master). */
  mainOnMaster?: boolean;
  /** The merge commit reaches the local trunk (default true). */
  fetched?: boolean;
  /** Put brief + spec log only on spec/<id> (stage greenlight only). */
  specOn?: "master" | "spec-branch";
  legacy?: boolean;
  sec?: boolean;
  /** W-123: the manifest declares integration.pr.required: true (the guard in `done` applies). */
  prRequired?: boolean;
  /** W-141: the base commit tracks a Patron path (`.claude/agents/censor.md`) and one whose name needs quoting. */
  patron?: boolean;
  /** W-141: the manifest declares an automated probatio, `tests`, whose command is `node -e 0`. */
  automated?: boolean;
}

const MANIFEST = [
  "bisellium: 1",
  "studio: W-124 fixture",
  "patron: patron",
  "collegia:",
  "  - { id: production, name: Production, magister: producer }",
  "  - { id: design, name: Design, magister: architect }",
  "  - { id: engineering, name: Engineering, magister: eng-lead }",
  "  - { id: qa, name: QA, magister: qa-lead }",
  "sellae:",
  "  - { id: producer, collegium: production, kind: orchestrator }",
  "  - { id: architect, collegium: design, kind: agent }",
  "  - { id: eng-lead, collegium: engineering, kind: agent }",
  "  - { id: builder, collegium: engineering, kind: agent }",
  "  - { id: qa-lead, collegium: qa, kind: agent }",
  "probationes:",
  "  - { id: spec, name: Spec, kind: agent }",
  "  - { id: review, name: Lead review, kind: agent }",
  "  - { id: sec, name: Security review, kind: agent }",
  "source_excludes: []",
  "",
].join("\n");

function briefText(behaviours: number): string {
  return [
    `# ${OPUS} fixture brief`,
    "",
    "## Intent",
    "",
    "Fixture.",
    "",
    "## Files owned",
    "",
    "- `source.txt`",
    "",
    "## Interfaces",
    "",
    "None.",
    "",
    "## Behaviours to test",
    "",
    ...Array.from({ length: behaviours }, (_, i) => `${i + 1}. **Fixture behaviour ${i + 1}.**`),
    "",
    "## Acceptance",
    "",
    "Fixture.",
    "",
    "## Out of scope",
    "",
    "Fixture.",
    "",
  ].join("\n");
}
function recordText(fields: Json): string {
  const base: Json = { id: OPUS, title: "W-124 fixture: the cascade ladder", kind: "opus", collegium: "engineering", ...fields };
  const lines = Object.entries(base)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\nFixture body.\n`;
}
const tipOf = (w: World): string => git(w.repo, ["rev-parse", `refs/heads/${BRANCH}`]);
const headOf = (w: World): string => (gitOk(w.repo, ["show-ref", "--verify", "--quiet", `refs/heads/${BRANCH}`]) ? tipOf(w) : w.headOid!);
const sourceTree = (dir: string): string => `tree:${sourceTreeHash(dir, ["studio", ".bisellium"], "HEAD")}`;

function writeTranscript(w: World, name: string): string {
  const path = join(w.root, name);
  writeFileSync(path, `## Findings\nNo findings\n`);
  return path;
}
function signSpec(w: World, dir: string): void {
  put(dir, "studio/briefs/W-900.md", briefText(w.behaviours));
  verb(dir, ["verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, "spec.md"), "--studio", join(dir, "studio"), "--now", T.spec]);
  commit(dir, `spec(${OPUS}): signed`);
}
function writeReds(w: World, kinds: Record<number, "good" | "dirty" | "moduleload" | "exit0"> = {}): void {
  const tree = sourceTree(w.wt);
  for (let n = 1; n <= w.behaviours; n++) {
    const kind = kinds[n] ?? "good";
    const body =
      kind === "moduleload"
        ? `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'next.js' (behaviour ${n})`
        : `TAP version 13\nnot ok 1 - W-900 behaviour ${n}: fixture\n  ---\n  code: 'ERR_ASSERTION'\n  ...\n`;
    put(
      w.wt,
      `studio/ci/reds/${OPUS}/${String(n).padStart(2, "0")}.log`,
      [`# behaviour: ${n}`, `# command: node fixture.test.ts --behaviour ${n}`, `# exit: ${kind === "exit0" ? 0 : 1}`, `# at: ${T.reds}`, "# sella: builder.W-900", `# tree: ${kind === "dirty" ? "dirty:" : "tree:"}${tree.slice(5)}`, "", body, ""].join("\n"),
    );
  }
  commit(w.wt, `studio(${OPUS}): reds`);
}
function writeReceipt(w: World, kind: "current" | "stale"): void {
  const relative = `receipts/builder.${OPUS}/r.json`;
  editOpusFrontMatter(join(w.wtStudio, "opera", `${OPUS}.md`), (doc) => {
    doc.setIn(["run_receipt"], relative);
    return undefined;
  });
  commit(w.wt, `studio(${OPUS}): run_receipt`);
  const tip = git(w.wt, ["rev-parse", "HEAD"]);
  const tree = kind === "current" ? sourceTree(w.wt) : `tree:${"0".repeat(40)}`;
  put(
    w.wtStudio,
    relative,
    JSON.stringify({
      sella: `builder.${OPUS}`,
      harness: "run",
      exitCode: 0,
      completion: {
        schema: 1,
        origin: "host-producer",
        opus: OPUS,
        branch: BRANCH,
        builder: `builder.${OPUS}`,
        producer: "producer",
        baseCommit: tip,
        finalCommit: tip,
        toolingCommit: tip,
        finalSourceTree: tree,
        redReplays: Array.from({ length: w.behaviours }, (_, i) => ({ behaviour: i + 1, commit: tip, sourceTree: tree, command: "x", assertionFailed: true })),
        gates: { ci: true, verify: true, check: true },
        teardownComplete: true,
        completed: true,
      },
    }),
  );
}
function addReview(w: World, outcome: "passed" | "failed", round: number, at: string): void {
  verb(w.wt, ["verdict", OPUS, "--round", String(round), "--sella", "qa-lead", "--outcome", outcome, "--from", writeTranscript(w, `review-${round}.md`), "--studio", w.wtStudio, "--now", at]);
  verb(w.wt, ["review", OPUS, outcome === "passed" ? "--pass" : "--fail", "--evidence", `ci/${OPUS}-review-${round}.log`, "--round", String(round), "--sella", "qa-lead", "--studio", w.wtStudio, "--now", at]);
  commit(w.wt, `studio(${OPUS}): review round ${round} ${outcome}`);
}
/** A new SOURCE commit on the opus branch; the receipt follows it unless asked not to. */
function advanceSource(w: World, refresh = true): void {
  appendFileSync(join(w.wt, "source.txt"), `change ${Date.now()}\n`);
  commit(w.wt, `feat(${OPUS}): source change`);
  if (refresh) writeReceipt(w, "current");
}
function landMerge(w: World, fetched: boolean): string {
  const side = join(scratch(`${w.tag}-side`), "c");
  git(dirname(side), ["clone", "-q", w.origin, side]);
  const tree = git(side, ["rev-parse", `origin/${BRANCH}^{tree}`]);
  const parent = git(side, ["rev-parse", "origin/master"]);
  const m = git(side, ["commit-tree", tree, "-p", parent, "-m", `feat(${OPUS}): squash (#${PR_NUMBER})`]);
  git(side, ["push", "-q", "origin", `${m}:refs/heads/master`]);
  if (fetched) {
    if (git(w.repo, ["symbolic-ref", "-q", "HEAD"], false) === "refs/heads/master") git(w.repo, ["pull", "-q", "--ff-only", "origin", "master"]);
    else git(w.repo, ["fetch", "-q", "origin", "master:master"]);
  }
  w.mergeOid = m;
  return m;
}
function removeBranchAndWorktree(w: World): void {
  if (existsSync(w.wt)) git(w.repo, ["worktree", "remove", "--force", w.wt]);
  git(w.repo, ["branch", "-D", BRANCH], false);
  git(w.repo, ["push", "-q", "origin", "--delete", BRANCH], false);
  git(w.repo, ["update-ref", "-d", `refs/remotes/origin/${BRANCH}`], false);
}
function ensureMaster(w: World): void {
  if (git(w.repo, ["symbolic-ref", "-q", "HEAD"], false) !== "refs/heads/master") git(w.repo, ["switch", "-q", "master"]);
}
/** A handoff that names the opus under the old `Where things stand` heading (the new rule does not read it). */
const HANDOFF_DONE = `# Handoff\n\n## Where things stand\n\n- ${OPUS} done, merged, fetched (fixture)\n`;
/** The done record is committed with `handoff` (the checkpoint) when one is given, as `next` commits them together. */
function markDone(w: World, onChore: boolean, handoff?: string): void {
  ensureMaster(w);
  if (onChore) git(w.repo, ["switch", "-q", "-c", `chore/done-${OPUS}`]);
  verb(w.repo, ["done", OPUS, "--sella", "producer", "--studio", w.studio, "--now", T.done]);
  if (handoff !== undefined) put(w.repo, "docs/SESSION-HANDOFF.md", handoff);
  commit(w.repo, `chore(studio): mark ${OPUS} done`);
  if (onChore) git(w.repo, ["switch", "-q", "master"]);
  else git(w.repo, ["push", "-q", "origin", "master"]);
}
/** A tracked edit to the handoff: the checkpoint a `done` perform commits with the record. */
const touchHandoff = (w: World): void => appendFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), "- checkpoint line\n");

/** Build a fixture officina in which every rung up to and including `upTo` is met. */
function world(tag: string, upTo: Stage | "backlog", o: WorldOpts = {}): World {
  const root = scratch(tag);
  const w: World = {
    tag,
    root,
    repo: join(root, "repo"),
    origin: join(root, "origin.git"),
    studio: join(root, "repo", "studio"),
    wt: join(root, "repo", ".worktrees", OPUS),
    wtStudio: join(root, "repo", ".worktrees", OPUS, "studio"),
    home: join(root, "home"),
    scn: join(root, "scenario.json"),
    log: join(root, "calls.log"),
    behaviours: o.behaviours ?? 2,
  };
  mkdirSync(w.home);
  mkdirSync(w.repo);
  git(root, ["init", "-q", "--bare", "-b", "master", w.origin]);
  git(w.repo, ["init", "-q", "-b", "master"]);
  git(w.repo, ["remote", "add", "origin", w.origin]);
  put(w.repo, ".gitignore", ".bisellium/\nreceipts/\nnode_modules/\n");
  put(w.repo, "README.md", "fixture\n");
  put(w.repo, "source.txt", "candidate source\n");
  put(w.repo, "docs/SESSION-HANDOFF.md", "# Handoff\n\n## Where things stand\n\n- (nothing recorded)\n");
  if (o.patron) {
    put(w.repo, ".claude/agents/censor.md", "censor v1\n");
    put(w.repo, ".claude/my notes.md", "notes v1\n");
  }
  const manifest = o.automated ? MANIFEST.replace("source_excludes:", '  - { id: tests, name: Tests, kind: automated, command: "node -e 0" }\nsource_excludes:') : MANIFEST;
  put(w.studio, "bisellium.yml", o.prRequired ? `${manifest}integration:\n  pr:\n    required: true\n` : manifest);
  put(w.studio, "notes.md", "bookkeeping line\n");
  put(w.studio, `opera/${OPUS}.md`, recordText({ state: upTo === "backlog" ? "backlog" : "greenlit", probationes: {} }));
  commit(w.repo, "test: establish W-124 fixture");
  git(w.repo, ["push", "-q", "-u", "origin", "master"]);
  scenario(w, {});
  if (upTo === "backlog") return w;
  const reach = idx(upTo);

  if (reach >= idx("spec") || o.specOn === "spec-branch") {
    if (o.specOn === "spec-branch") {
      git(w.repo, ["switch", "-q", "-c", `spec/${OPUS}`]);
      signSpec(w, w.repo);
      git(w.repo, ["switch", "-q", "master"]);
    } else {
      signSpec(w, w.repo);
      git(w.repo, ["push", "-q", "origin", "master"]);
    }
  }
  if (reach >= idx("branch")) {
    git(w.repo, ["branch", BRANCH]);
    git(w.repo, ["worktree", "add", "-q", w.wt, BRANCH]);
  }
  if (reach >= idx("ready")) {
    verb(w.wt, ["ready", OPUS, "--sella", "architect", "--studio", w.wtStudio, "--now", T.ready]);
    if (o.legacy) {
      // an unmarked legacy record past ready: rewrite the record without the marker
      put(w.wtStudio, `opera/${OPUS}.md`, recordText({ state: "building", probationes: { spec: { sella: "architect", status: "passed", evidence: `briefs/${OPUS}.md`, at: T.ready } }, spec: `briefs/${OPUS}.md` }));
    }
    commit(w.wt, `studio(${OPUS}): ready`);
  }
  if (!(o.mainOnMaster ?? true) && reach >= idx("ready")) git(w.repo, ["switch", "-q", "--detach", "master"]);
  if (reach >= idx("reds")) writeReds(w);
  if (reach >= idx("build")) writeReceipt(w, "current");
  if (reach >= idx("review")) {
    addReview(w, "passed", 1, T.review1);
    if (o.sec ?? true) {
      editOpusFrontMatter(join(w.wtStudio, "opera", `${OPUS}.md`), (doc) => {
        doc.setIn(["probationes", "sec"], { status: "passed", sella: "qa-lead", evidence: `ci/${OPUS}-review-1.log`, at: T.review1 });
        return undefined;
      });
      commit(w.wt, `studio(${OPUS}): sec gate`);
    }
  }
  if (reach >= idx("review")) w.headOid = tipOf(w);
  if (reach >= idx("pr")) git(w.wt, ["push", "-q", "-u", "origin", BRANCH]);
  if (reach >= idx("merge")) landMerge(w, o.fetched ?? true);
  if (reach >= idx("cleanup")) removeBranchAndWorktree(w);
  if (reach >= idx("done")) markDone(w, false, reach >= idx("checkpoint") ? HANDOFF_DONE : undefined);
  return w;
}

function scenario(w: World, over: Partial<Record<SlotName, SlotValue>>): void {
  const defaults: Record<SlotName, SlotValue> = {
    repoView: { stdout: { nameWithOwner: SLUG } },
    list: { stdout: [] },
    view: { stdout: viewOf(CAND) },
    checks: { stdout: greens() },
    alerts: { stdout: [] },
    update: { stdout: "" },
    merge: { stdout: "" },
    create: { stdout: `https://github.com/${SLUG}/pull/${PR_NUMBER}\n` },
  };
  const rules = (Object.keys(SLOT_MATCH) as SlotName[]).map((slot) => ({ match: SLOT_MATCH[slot], ...asRule(over[slot] ?? defaults[slot]) }));
  writeFileSync(w.scn, JSON.stringify({ rules }));
  rmSync(`${w.scn}.state`, { force: true });
  rmSync(w.log, { force: true });
}
/** The common "open PR on the current tip" scenario with a merge that lands. */
const openList = (w: World, extra: CandOpts = { state: "OPEN" }): SlotValue => ({ stdout: [cand(w, extra)] });

// ---------------------------------------------------------------------------
// running the verb, reading the stub logs
// ---------------------------------------------------------------------------
interface Out {
  status: number | null;
  out: string;
  err: string;
  first: string;
  kv: Map<string, string>;
}
function parse(status: number | null, out: string, err: string): Out {
  const kv = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = /^([A-Za-z_-]+): (.*)$/.exec(line);
    if (m && !kv.has(m[1]!)) kv.set(m[1]!, m[2]!);
  }
  return { status, out, err, first: out.split("\n")[0] ?? "", kv };
}
interface RunOpts {
  env?: Record<string, string | undefined>;
  /** BISELLIUM_TEST_CLOCK=1 and --now (default true). */
  clock?: boolean;
  cwd?: string;
  /** Do not add --repo/--studio. */
  bare?: boolean;
}
function envFor(w: World, o: RunOpts): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...SETUP_ENV,
    HOME: w.home,
    PATH: `${BIN}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    GH_STUB_SCENARIO: w.scn,
    GH_STUB_LOG: w.log,
    GIT_STUB_LOG: w.log,
    GIT_STUB_REAL: REAL_GIT,
  };
  if (o.clock ?? true) env["BISELLIUM_TEST_CLOCK"] = "1";
  for (const [k, v] of Object.entries(o.env ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}
function nextArgs(w: World, args: string[], o: RunOpts): string[] {
  const full = [...args];
  if (!o.bare) full.push("--repo", w.repo, "--studio", w.studio);
  if ((o.clock ?? true) && !full.includes("--now")) full.push("--now", NOW_ISO);
  return full;
}
function next(w: World, args: string[], o: RunOpts = {}): Out {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "next", ...nextArgs(w, args, o)], {
    cwd: o.cwd ?? w.repo,
    env: envFor(w, o),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return parse(r.status, r.stdout ?? "", r.stderr ?? "");
}
/** Async twin of next(), for rows that must interleave with the running verb. */
function nextAsync(w: World, args: string[], o: RunOpts = {}): { child: ChildProcess; done: Promise<Out> } {
  const child = spawn(process.execPath, ["--import", TSX, MAIN, "next", ...nextArgs(w, args, o)], { cwd: o.cwd ?? w.repo, env: envFor(w, o), stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout!.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr!.on("data", (d: Buffer) => (err += d.toString()));
  const done = new Promise<Out>((ok) => child.on("close", (code) => ok(parse(code, out, err))));
  return { child, done };
}
const ran = (label: string, o: Out): string => `${label}\n--- exit ${o.status}\n--- stdout\n${o.out}\n--- stderr\n${o.err.slice(0, 600)}`;

function calls(w: World): string[][] {
  if (!existsSync(w.log)) return [];
  return readFileSync(w.log, "utf8").split("\n").filter(Boolean).map((l) => l.split("\x1f"));
}
function gitArgs(a: string[]): string[] {
  const out = [...a];
  for (;;) {
    if (out[0] === "-C" || out[0] === "-c") out.splice(0, 2);
    else break;
  }
  return out;
}
/** Every git call the verb made, with -C/-c stripped. */
const gitCalls = (w: World): string[][] => calls(w).filter((c) => c[0] === "git").map((c) => gitArgs(c.slice(1)));
const ghCalls = (w: World): string[][] => calls(w).filter((c) => c[0] === "gh").map((c) => c.slice(1));
/** The ordered mutating calls the verb made, normalised to a short label. */
function mutating(w: World): string[] {
  const out: string[] = [];
  for (const c of calls(w)) {
    if (c[0] === "gh") {
      const a = c.slice(1).filter((x, i, all) => x !== "-R" && all[i - 1] !== "-R");
      if (a[0] === "pr" && a[1] === "create") out.push("gh pr create");
      else if (a[0] === "pr" && a[1] === "update-branch") out.push("gh pr update-branch");
      else if (a[0] === "pr" && a[1] === "merge") out.push(a.includes("--auto") ? "gh pr merge --squash --auto" : "gh pr merge --squash");
    } else if (c[0] === "git") {
      const a = gitArgs(c.slice(1));
      if (a[0] === "fetch" && a.includes("master:master")) out.push("git fetch master:master");
      else if (a[0] === "merge" && a.includes("--ff-only")) out.push("git merge --ff-only");
      else if (a[0] === "rebase") out.push(a.includes("--abort") ? "git rebase --abort" : "git rebase");
      else if (a[0] === "push" && a.some((x) => x.startsWith("--force-with-lease")) && !a.includes("--delete")) out.push("git push --force-with-lease");
    }
  }
  return out;
}
const unmatched = (w: World): string[][] => calls(w).filter((c) => c[0] === "gh-unmatched");

function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git" || e.name === ".worktrees" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(p, r));
    else if (e.isSymbolicLink()) out.push(`${r}->${readlinkSync(p)}`);
    else if (e.isFile()) out.push(`${r}:${createHash("sha1").update(readFileSync(p)).digest("hex")}`);
  }
  return out;
}
/** Everything a report-only `next` must leave byte-identical. */
function snap(w: World): string {
  return [
    ...walk(w.repo),
    "--worktree--",
    ...(existsSync(w.wt) ? walk(w.wt) : []),
    git(w.repo, ["for-each-ref"]),
    git(w.repo, ["worktree", "list", "--porcelain"]),
    git(w.repo, ["status", "--porcelain"]),
  ].join("\n");
}
const branchExists = (w: World, name = BRANCH): boolean => gitOk(w.repo, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
const remoteBranchExists = (w: World): boolean => git(w.origin, ["for-each-ref", `refs/heads/${BRANCH}`]) !== "";
const recordOf = (w: World, dir: "repo" | "wt" = "repo"): string => {
  const path = join(dir === "repo" ? w.studio : w.wtStudio, "opera", `${OPUS}.md`);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

/** Expect `next: W-900 <step> <status>` as the first stdout line. */
function expectStep(o: Out, step: string, status: string, row: string): void {
  assert.equal(o.first, `next: ${OPUS} ${step} ${status}`, ran(row, o));
}
/** Move the origin master forward by a commit that touches `file`. */
function advanceOrigin(w: World, file: string, text: string): void {
  const side = join(scratch(`${w.tag}-adv`), "c");
  git(dirname(side), ["clone", "-q", w.origin, side]);
  put(side, file, text);
  commit(side, `chore: advance trunk (${file})`);
  git(side, ["push", "-q", "origin", "HEAD:refs/heads/master"]);
}

// ---------------------------------------------------------------------------
// health helpers: markers, live/dead/zombie pids, a fake /proc
// ---------------------------------------------------------------------------
const stepsDir = (w: World): string => join(w.repo, ".bisellium", "steps");
const markerPath = (w: World): string => join(stepsDir(w), `${OPUS}.json`);
const outputPath = (w: World): string => join(stepsDir(w), `${OPUS}.log`);
function tickOf(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[19]);
}
function liveChild(): number {
  const child = spawn("sleep", ["600"], { stdio: "ignore" });
  children.push(child);
  return child.pid!;
}
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  return r.pid!;
}
/** A child that has exited but is not reaped: node reaps only when its loop turns, and this never yields. */
function zombiePid(): number {
  const child = spawn("true", [], { stdio: "ignore" });
  children.push(child);
  const pid = child.pid!;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      if (stat.slice(stat.lastIndexOf(")") + 1).trim().startsWith("Z")) return pid;
    } catch {
      /* not there yet */
    }
    if (Date.now() > deadline) throw new Error("could not produce a zombie child");
  }
}
interface MarkerOpts {
  step: string;
  pid: number;
  start_ticks: number;
  writer?: string;
  budget?: number;
}
function putMarker(w: World, m: MarkerOpts): void {
  mkdirSync(stepsDir(w), { recursive: true });
  writeFileSync(
    markerPath(w),
    JSON.stringify({ schema: 1, opus: OPUS, step: m.step, pid: m.pid, start_ticks: m.start_ticks, started: new Date(NOW_MS - 3600_000).toISOString(), output: `steps/${OPUS}.log`, budget_seconds: m.budget ?? 1800, writer: m.writer ?? "perform" }),
  );
}
/** Create the step's output file, last written `ageSeconds` before NOW (negative: in the future). */
function putOutput(w: World, text: string, ageSeconds: number): void {
  mkdirSync(stepsDir(w), { recursive: true });
  writeFileSync(outputPath(w), text);
  const t = new Date(NOW_MS - ageSeconds * 1000);
  utimesSync(outputPath(w), t, t);
}
function statLine(pid: number | string, comm: string, state: string, start: number | string): string {
  return `${pid} (${comm}) ${state} ${Array(18).fill("0").join(" ")} ${start} ${Array(30).fill("0").join(" ")}\n`;
}
/** A directory standing in for /proc; `entries[pid]` is the body of `<pid>/stat`, or "dir" to make stat a directory (EISDIR). */
function fakeProc(w: World, entries: Record<string, string>): string {
  const dir = join(w.root, "proc");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  for (const [pid, body] of Object.entries(entries)) {
    mkdirSync(join(dir, pid));
    if (body === "dir") mkdirSync(join(dir, pid, "stat"));
    else writeFileSync(join(dir, pid, "stat"), body);
  }
  return dir;
}
const PROC_ENV = (dir: string): Record<string, string> => ({ BISELLIUM_TEST_PROC: dir });
const markerText = (w: World): string => (existsSync(markerPath(w)) ? readFileSync(markerPath(w), "utf8") : "");
const markerJson = (w: World): Json => (existsSync(markerPath(w)) ? (JSON.parse(markerText(w)) as Json) : {});

// ---------------------------------------------------------------------------
// fixture self-check: the worlds this file builds are what the real verbs read
// ---------------------------------------------------------------------------
if (only === undefined) {
  test("W-124 fixtures: worlds agree with the real verbs and the real gh shapes", () => {
    const w = world("sanity", "review");
    assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, true, "the current receipt is admitted by the real validator");
    const header = readFileSync(join(w.wtStudio, "ci", `${OPUS}-review-1.log`), "utf8").match(/^# tree: (.+)$/m)?.[1];
    assert.equal(header, sourceTree(w.wt), "a real verdict stamps the SOURCE tree sourceTreeHash computes");
    advanceSource(w, false);
    assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, false, "a source change without a refreshed receipt is not admitted");
    advanceSource(w, true);
    assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, true);
    assert.notEqual(header, sourceTree(w.wt), "the review log now certifies an older tree");
    assert.equal(CAND["isCrossRepository"], false);
    assert.match(String((CAND["mergeCommit"] as Json)["oid"]), /^[0-9a-f]{40}$/);
    const merged = world("sanity-merged", "merge", { fetched: false });
    assert.equal(gitOk(merged.repo, ["cat-file", "-e", `${merged.mergeOid}^{commit}`]), false, "an unfetched merge commit is not in the local object store");
    const fetched = world("sanity-fetched", "merge");
    assert.equal(gitOk(fetched.repo, ["merge-base", "--is-ancestor", fetched.mergeOid!, "refs/heads/master"]), true);
    const done = world("sanity-done", "checkpoint");
    assert.match(recordOf(done), /state: "?done/);
    assert.equal(statSync(join(done.repo, "docs/SESSION-HANDOFF.md")).isFile(), true);
  });
}

// ---------------------------------------------------------------------------
// shared scenario helpers for the PR-facing behaviours
// ---------------------------------------------------------------------------
/** A world whose review rung is met; `mutate` runs on the opus worktree before the review so it certifies that tree. */
function reviewed(tag: string, o: WorldOpts = {}, mutate?: (w: World) => void, push = false): World {
  const w = world(tag, "build", o);
  mutate?.(w);
  addReview(w, "passed", 1, T.review1);
  w.headOid = tipOf(w);
  if (push) git(w.wt, ["push", "-q", "-u", "origin", BRANCH]);
  return w;
}
const mergedList = (w: World, extra: Partial<CandOpts> = {}): SlotValue => ({ stdout: [cand(w, { state: "MERGED", ...extra })] });
/** An open PR on the tip whose merge lands (and reads back MERGED) once `gh pr merge` has been called. */
function landing(w: World, extra: Partial<Record<SlotName, SlotValue>> = {}): string {
  const flag = join(w.root, "merged.flag");
  const m = w.mergeOid ?? landMerge(w, false);
  scenario(w, {
    list: openList(w),
    view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m })) }] }] },
    merge: { replies: [{ stdout: "", touch: flag }] },
    ...extra,
  });
  return flag;
}
/** A review-met world with the branch pushed (so a merge commit can be landed from origin) and the main checkout detached. */
const pushed = (tag: string, mutate?: (w: World) => void): World => reviewed(tag, { mainOnMaster: false }, mutate, true);
function expectHeld(o: Out, row: string): void {
  assert.match(o.first, new RegExp(`^next: ${OPUS} \\S+ held$`), ran(row, o));
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
}
const editRecord = (w: World, dir: "repo" | "wt", fn: (doc: { setIn(path: string[], value: unknown): void }) => void): void =>
  editOpusFrontMatter(join(dir === "repo" ? w.studio : w.wtStudio, "opera", `${OPUS}.md`), (doc) => {
    fn(doc);
    return undefined;
  });

// ---------------------------------------------------------------------------
// behaviour 1: the ladder names exactly one legal next step from evidence
// ---------------------------------------------------------------------------
if (runs(1)) {
  test("W-124 behaviour 1: the ladder names exactly one legal next step from evidence", { timeout: 1_800_000 }, () => {
    const budget = ["--budget", "100000"];
    /** One rung boundary: the step line, its actor and why, and nothing written. */
    const rung = (w: World, row: string, step: string, status: string, extra?: (o: Out) => void): Out => {
      if (['spec','reds','build','review'].includes(step) && !/traditio/.test(recordOf(w, existsSync(w.wt) ? "wt" : "repo"))) handoffAt(w, existsSync(w.wt) ? "wt" : "repo", T.handoffFresh);
      const before = snap(w);
      const o = next(w, [OPUS, ...budget]);
      expectStep(o, step, status, row);
      assert.equal(o.status, 0, ran(`${row}: exit`, o));
      assert.equal(snap(w), before, `${row}: report mode writes nothing (record, ci/, .bisellium/ byte-identical)`);
      assert.equal(existsSync(join(w.repo, ".bisellium", "steps")), false, `${row}: no marker`);
      extra?.(o);
      return o;
    };
    const actor = (o: Out, who: RegExp, row: string): void => assert.match(o.kv.get("actor") ?? "", who, ran(`${row}: actor`, o));

    // 1 greenlight: backlog
    const backlog = world("b1-backlog", "backlog");
    rung(backlog, "backlog names greenlight", "greenlight", "named", (o) => actor(o, /patron/i, "backlog"));

    // halted and declined hold
    const halted = world("b1-halted", "greenlight");
    editRecord(halted, "repo", (doc) => doc.setIn(["state"], "halted"));
    commit(halted.repo, "studio: halt");
    expectHeld(next(halted, [OPUS, ...budget]), "halted holds");
    const declined = world("b1-declined", "backlog");
    editRecord(declined, "repo", (doc) => doc.setIn(["declined"], "not now"));
    commit(declined.repo, "studio: decline");
    expectHeld(next(declined, [OPUS, ...budget]), "declined holds");

    // 2 spec
    const greenlit = world("b1-greenlit", "greenlight");
    rung(greenlit, "greenlit without a signed spec names spec", "spec", "named", (o) => {
      actor(o, /architect/i, "spec");
      assert.equal(o.kv.get("budget_tokens"), "100000", ran("spec order carries the declared budget", o));
    });
    const specBranch = world("b1-spec-branch", "greenlight", { specOn: "spec-branch" });
    rung(specBranch, "brief and passing spec log only on spec/<id> still names spec", "spec", "named", (o) => {
      actor(o, /producer/i, "spec on branch");
      assert.match(o.out, /spec signed on spec\/W-900, not on master/, ran("spec-branch why", o));
      assert.match(o.out, /git push origin spec\/W-900, then gh pr create --base master --head spec\/W-900 --title "spec\(W-900\): signed"/, ran("names the gh landing for spec/<id>", o));
      assert.match(o.out, /git switch master && git pull --ff-only origin master/, ran("switches to master before it pulls", o));
      assert.doesNotMatch(o.out, /scripts\//, ran("names no script", o));
    });

    // 3 branch
    rung(world("b1-branch", "spec"), "branch absent names branch", "branch", "named", (o) => actor(o, /producer/i, "branch"));

    // 4 ready
    rung(world("b1-ready", "branch"), "branch present with state greenlit names ready", "ready", "named", (o) => {
      assert.match(o.out, /architect/, ran("ready is attributed to the sella of the passed spec log", o));
    });

    // 5 reds: none, one missing, and the three red kinds that count as missing
    const noReds = world("b1-reds", "ready");
    rung(noReds, "no reds names reds", "reds", "named", (o) => {
      actor(o, /builder/i, "reds");
      assert.match(o.out, /phase:\s*1/i, ran("reds is builder phase 1", o));
    });
    writeReds(noReds);
    rmSync(join(noReds.wtStudio, "ci", "reds", OPUS, "02.log"));
    commit(noReds.wt, "studio: drop red 2");
    rung(noReds, "reds missing one behaviour names reds", "reds", "named");
    for (const kind of ["dirty", "moduleload", "exit0"] as const) {
      writeReds(noReds, { 2: kind });
      rung(noReds, `a ${kind} red counts as missing`, "reds", "named");
    }

    // 6 build: stale receipt; then a current receipt moves to review
    const build = world("b1-build", "reds");
    rung(build, "no receipt names build", "build", "named", (o) => actor(o, /builder/i, "build"));
    writeReceipt(build, "stale");
    rung(build, "a stale receipt names build", "build", "named");
    writeReceipt(build, "current");
    rung(build, "a current receipt and no review names review (round 1)", "review", "named", (o) => {
      assert.match(o.out, /round[^\n]*1/i, ran("round 1", o));
    });

    // 7 review: failed at the current tree is build/fix; failed at an older tree is review, next round
    const failedNow = world("b1-failed-now", "build");
    addReview(failedNow, "failed", 1, T.review1);
    rung(failedNow, "a review gate failed at the current tree names build, phase fix", "build", "named", (o) => {
      assert.match(o.out, /phase:\s*fix/i, ran("phase fix", o));
      assert.match(o.out, /ci\/W-900-review-1\.log/, ran("the failing review log is an input", o));
    });
    advanceSource(failedNow);
    rung(failedNow, "a review gate failed at an older tree names review, next round", "review", "named", (o) => {
      assert.match(o.out, /round[^\n]*2/i, ran("round 2", o));
    });
    const older = world("b1-older", "review");
    advanceSource(older);
    rung(older, "a review gate passed at an older tree names review, next round", "review", "named", (o) => {
      assert.match(o.out, /round[^\n]*2/i, ran("round 2", o));
    });

    // 8 pr: the `# tree:` the rung compares is the one a real verdict wrote
    const prWorld = world("b1-pr", "review");
    const header = readFileSync(join(prWorld.wtStudio, "ci", `${OPUS}-review-1.log`), "utf8").match(/^# tree: (.+)$/m)?.[1];
    assert.equal(header, sourceTree(prWorld.wt), "the fixture's verdict header is the SOURCE tree");
    rung(prWorld, "review met, no PR names pr", "pr", "named", (o) => actor(o, /producer/i, "pr"));
    scenario(prWorld, { list: openList(prWorld, { state: "OPEN", oid: "8".repeat(40) }) });
    rung(prWorld, "an OPEN PR on another oid than the local tip still names pr", "pr", "named");

    // 9 merge: OPEN on the tip; MERGED with the trunk behind (branch present, then branch gone)
    scenario(prWorld, { list: openList(prWorld) });
    rung(prWorld, "an OPEN PR on the local tip names merge", "merge", "named");
    const behind = world("b1-merged-behind", "merge", { fetched: false });
    scenario(behind, { list: mergedList(behind) });
    rung(behind, "MERGED but the trunk behind names merge", "merge", "named");
    const behindGone = world("b1-merged-behind-gone", "cleanup", { fetched: false });
    scenario(behindGone, { list: mergedList(behindGone) });
    rung(behindGone, "MERGED, branch gone, trunk behind names merge, never branch", "merge", "named");

    // 10 cleanup, 11 done
    const fetched = world("b1-cleanup", "merge");
    scenario(fetched, { list: mergedList(fetched) });
    rung(fetched, "MERGED and fetched with the branch still present names cleanup", "cleanup", "named");
    const gone = world("b1-done", "cleanup");
    scenario(gone, { list: mergedList(gone) });
    rung(gone, "MERGED, fetched, branch gone names done", "done", "named");
    const chore = world("b1-chore", "cleanup");
    markDone(chore, true);
    scenario(chore, { list: mergedList(chore) });
    rung(chore, "done committed only on chore/done-<id> still names done", "done", "named", (o) => {
      assert.match(o.out, /done committed on chore\/done-W-900, not on master/, ran("chore why", o));
      assert.match(o.out, /git switch chore\/done-W-900 && git push origin chore\/done-W-900, then gh pr create --base master --head chore\/done-W-900 --title "chore\(studio\): mark W-900 done"/, ran("names the gh landing for chore/done-<id>", o));
      assert.match(o.out, /git switch master && git pull --ff-only origin master/, ran("chore: switches to master before it pulls", o));
      assert.doesNotMatch(o.out, /scripts\//, ran("chore: names no script", o));
    });

    // 12 checkpoint: the committed trunk record `done` settles everything before it without any gh call
    const doneWorld = world("b1-checkpoint", "done");
    rung(doneWorld, "trunk record done and no checkpoint names checkpoint", "checkpoint", "named");
    assert.equal(ghCalls(doneWorld).length, 0, "a done trunk record settles the earlier rungs without a gh call");
    const complete = world("b1-complete", "checkpoint");
    const completeOut = next(complete, [OPUS, ...budget]);
    assert.match(completeOut.first, /^next: W-900 \S+ complete$/, ran("checkpoint met reports complete", completeOut));
    assert.equal(completeOut.status, 0, ran("complete exits 0", completeOut));

    // an unmarked legacy record past ready is outside the ladder
    expectHeld(next(world("b1-legacy", "ready", { legacy: true }), [OPUS, ...budget]), "a legacy record past ready is held");

    // the same input twice gives the same output
    const twice = next(older, [OPUS, ...budget]);
    assert.equal(next(older, [OPUS, ...budget]).out, twice.out, "the same input twice gives the same output");
  });
}

// ---------------------------------------------------------------------------
// behaviour 2: next refuses to skip, and every refusal is bounded
// ---------------------------------------------------------------------------
if (runs(2)) {
  test("W-124 behaviour 2: next refuses to skip, and every refusal is bounded", { timeout: 1_800_000 }, () => {
    const budget = ["--budget", "100000"];
    const refusal = (o: Out, was: string, asked: string, row: string): void => {
      assert.match(o.out + o.err, new RegExp(`refusing: next step for ${OPUS} is ${was}, not ${asked}`), ran(`${row}: refusal text`, o));
      assert.equal(o.status, 1, ran(`${row}: exit`, o));
    };

    // --expect refuses when a LATER rung's evidence is present: an OPEN PR on a branch with no passing review
    const early = world("b2-early", "build", { mainOnMaster: false });
    scenario(early, { list: openList(early) });
    let before = snap(early);
    refusal(next(early, [OPUS, "--expect", "merge", ...budget]), "review", "merge", "an OPEN PR with no passing review names review, not merge");
    assert.equal(snap(early), before, "a refused --expect writes nothing");
    assert.equal(mutating(early).length, 0, "a refused --expect performs nothing");
    const matches = next(early, [OPUS, "--expect", "review", ...budget]);
    expectStep(matches, "review", "named", "--expect equal to the derived step passes");
    assert.equal(matches.status, 0, ran("--expect match exit", matches));

    // a clean tree with a review log but no receipt names build
    const noReceipt = world("b2-no-receipt", "reds");
    verb(noReceipt.wt, ["verdict", OPUS, "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--from", writeTranscript(noReceipt, "r.md"), "--studio", noReceipt.wtStudio, "--now", T.review1]);
    commit(noReceipt.wt, "studio: review log without receipt");
    refusal(next(noReceipt, [OPUS, "--expect", "review", ...budget]), "build", "review", "a review log without a receipt names build");

    // an unknown step id is usage
    const unknown = next(early, [OPUS, "--expect", "nonsense", ...budget]);
    assert.equal(unknown.status, 2, ran("an unknown --expect step is a usage error", unknown));
    assert.equal(unknown.out, "", "usage errors print no step line");

    // --perform takes the marker, re-derives, then checks --expect: flip the evidence once the marker exists
    const flip = world("b2-flip", "review", { mainOnMaster: false });
    scenario(flip, { list: { replies: [{ stdout: [] }], alts: [{ ifExists: markerPath(flip), replies: [{ stdout: [cand(flip, { state: "OPEN" })] }] }] } });
    const flipped = next(flip, [OPUS, "--perform", "--expect", "pr", ...FAST]);
    refusal(flipped, "merge", "pr", "the second derivation (after the marker) is the one --expect checks");
    assert.deepEqual(mutating(flip), [], "nothing was performed after the refusal");

    // --perform stops at the first named-only rung and runs nothing
    const dispatch = world("b2-dispatch", "ready");
    const dispatched = next(dispatch, [OPUS, "--perform", ...budget]);
    expectStep(dispatched, "reds", "named", "--perform on a dispatch rung only names the order");
    assert.equal(dispatched.status, 0, ran("dispatch perform exit", dispatched));
    assert.deepEqual(mutating(dispatch), [], "no mutating call on a named-only rung");
    assert.equal(existsSync(join(dispatch.wtStudio, "ci", "reds")), false, "no red was recorded");
    const gl = world("b2-greenlight", "backlog");
    const glRecord = recordOf(gl);
    const glOut = next(gl, [OPUS, "--perform"], { env: { BISELLIUM_ROLE: "eng-lead" } });
    expectStep(glOut, "greenlight", "named", "a greenlight rung is named, never performed");
    assert.equal(recordOf(gl), glRecord, "the backlog record is untouched: the verb never acts as the patron");
    const cp = world("b2-checkpoint", "done");
    const cpDocs = readFileSync(join(cp.repo, "docs/SESSION-HANDOFF.md"), "utf8");
    expectStep(next(cp, [OPUS, "--perform"]), "checkpoint", "named", "--perform stops at the checkpoint rung");
    assert.equal(readFileSync(join(cp.repo, "docs/SESSION-HANDOFF.md"), "utf8"), cpDocs, "the checkpoint rung writes nothing");

    // --perform does one rung per call: branch, then it stops (ready is not performed)
    const one = world("b2-one-rung", "spec");
    const performed = next(one, [OPUS, "--perform", "--expect", "branch"]);
    expectStep(performed, "branch", "performed", "branch is performed");
    assert.equal(performed.status, 0, ran("branch performed exit", performed));
    assert.equal(branchExists(one), true, "the branch was cut");
    assert.equal(existsSync(one.wt), true, "and its worktree added at .worktrees/<id>");
    assert.match(git(one.repo, ["worktree", "list", "--porcelain"]), new RegExp(`branch refs/heads/${BRANCH}`), "the worktree is registered on the branch");
    assert.match(recordOf(one, "wt"), /state: "?greenlit/, "ready was not performed in the same call");

    // branch refusals: other branch, not at the master tip, tracked changes (modified and staged)
    const refuseBranch = (row: string, prep: (w: World) => void): void => {
      const w = world(`b2-bref-${row.replace(/\W+/g, "-")}`, "spec");
      prep(w);
      const o = next(w, [OPUS, "--perform", "--expect", "branch"]);
      assert.equal(o.status, 1, ran(`branch refuses: ${row}`, o));
      assert.equal(branchExists(w), false, `${row}: no branch was created`);
      assert.equal(existsSync(w.wt), false, `${row}: no worktree was created`);
    };
    refuseBranch("HEAD is a branch other than master", (w) => git(w.repo, ["switch", "-q", "-c", "scratch"]));
    refuseBranch("HEAD is not at the master tip", (w) => git(w.repo, ["switch", "-q", "--detach", "HEAD~1"]));
    refuseBranch("a modified tracked file", (w) => appendFileSync(join(w.repo, "source.txt"), "dirty\n"));
    refuseBranch("a staged change", (w) => {
      appendFileSync(join(w.repo, "source.txt"), "staged\n");
      git(w.repo, ["add", "source.txt"]);
    });
    const untracked = world("b2-bref-untracked", "spec");
    mkdirSync(join(untracked.repo, ".worktrees", "other"), { recursive: true });
    writeFileSync(join(untracked.repo, ".worktrees", "other", "keep.txt"), "x");
    writeFileSync(join(untracked.repo, "scratch.tmp"), "untracked\n");
    expectStep(next(untracked, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", "an untracked .worktrees/ and an untracked file do not refuse branch");
    assert.equal(branchExists(untracked), true, "the branch was cut despite untracked files");

    // ready relays D-021 from a non-owner checkout (the branch exists, its worktree does not)
    const d021 = world("b2-d021", "branch");
    git(d021.repo, ["worktree", "remove", "--force", d021.wt]);
    const d021Record = recordOf(d021);
    const relayed = next(d021, [OPUS, "--perform", "--expect", "ready"]);
    assert.equal(relayed.status, 1, ran("ready refusal is relayed as held", relayed));
    assert.match(relayed.out + relayed.err, /D-021|worktree/i, ran("the D-021 refusal is relayed unchanged", relayed));
    assert.equal(recordOf(d021), d021Record, "the trunk record is untouched");

    // a linked-worktree --repo exits with usage status 2
    const linked = world("b2-linked", "branch");
    const lw = next(linked, [OPUS, "--repo", linked.wt, "--studio", linked.wtStudio], { bare: true });
    assert.equal(lw.status, 2, ran("a linked-worktree --repo is a usage error", lw));
    assert.match(lw.err, /main checkout/i, ran("and it names the main checkout", lw));

    // PR identity: only a verified tuple is a PR
    const id = world("b2-identity", "review", { mainOnMaster: false });
    const pr = (row: string, list: Json[], step: string, status: string): void => {
      scenario(id, { list: { stdout: list } });
      const o = next(id, [OPUS]);
      if (status === "held") expectHeld(o, row);
      else expectStep(o, step, status, row);
    };
    pr("a candidate with the wrong baseRefName is not a PR", [cand(id, { state: "OPEN", base: "develop" })], "pr", "named");
    pr("a fork head is not a PR", [cand(id, { state: "OPEN", cross: true })], "pr", "named");
    pr("a different head repository is not a PR", [cand(id, { state: "OPEN", headRepo: "evil/fork" })], "pr", "named");
    pr("a non-integer number is not a PR", [cand(id, { state: "OPEN", number: "12" })], "pr", "named");
    pr("a fractional number is not a PR", [cand(id, { state: "OPEN", number: 1.5 })], "pr", "named");
    pr("two OPEN candidates are held (ambiguous)", [cand(id, { state: "OPEN" }), cand(id, { state: "OPEN", number: 902 })], "pr", "held");
    pr("an old MERGED PR whose merge commit is not in the trunk settles nothing", [cand(id, { state: "MERGED", merge: OID_UNFETCHED })], "merge", "named");
    // unverifiable (this clone cannot resolve the head: merge-base exit 128) is not unrelated (exit 1)
    const unverifiable = world("b2-unverifiable", "merge");
    scenario(unverifiable, { list: mergedList(unverifiable, { oid: "9".repeat(40) }) });
    expectStep(next(unverifiable, [OPUS]), "merge", "named", "a MERGED PR whose headRefOid this clone cannot resolve is unverifiable: it stays at merge, never pr");
    const unrelated = world("b2-unrelated", "merge");
    const stranger = git(unrelated.repo, ["commit-tree", git(unrelated.repo, ["rev-parse", `${tipOf(unrelated)}^{tree}`]), "-m", "a root commit unrelated to the opus branch"]);
    scenario(unrelated, { list: mergedList(unrelated, { oid: stranger }) });
    expectStep(next(unrelated, [OPUS]), "pr", "named", "a MERGED PR whose locally known headRefOid does not contain the local branch tip settles nothing");
  });
}

// ---------------------------------------------------------------------------
// behaviour 3: pr, merge and cleanup run in order, with the refusals the ladder
// documents, and fail closed on gh
// ---------------------------------------------------------------------------
const TITLE = "feat(W-900): fixture";
const BODY = join(scratch("body"), "body.md");
writeFileSync(BODY, "PR body\n");
const MIN_CHECKS = 5;
const prArgs = ["--title", TITLE, "--body-file", BODY];
const performPr = (w: World, extra: string[] = prArgs): Out => next(w, [OPUS, "--perform", "--expect", "pr", ...extra, ...FAST]);
const performMerge = (w: World, extra: string[] = []): Out => next(w, [OPUS, "--perform", "--expect", "merge", ...FAST, ...extra]);
const performCleanup = (w: World): Out => next(w, [OPUS, "--perform", "--expect", "cleanup"]);
/** The terminal state a performed rung reports. */
function terminal(o: Out): string {
  const text = o.out + o.err;
  const states = [...text.matchAll(/state=([A-Z_]+)/g)];
  if (states.length) return states[states.length - 1]![1]!;
  if (/refusing|held/i.test(text)) return "REFUSED";
  if (new RegExp(`\\b${PR_NUMBER}\\b`).test(text)) return "CREATED";
  return "?";
}
const ghMerges = (w: World): string[][] => ghCalls(w).filter((a) => a[0] === "pr" && a[1] === "merge");
const callIndex = (w: World, pred: (a: string[]) => boolean): number => gitCalls(w).findIndex(pred);

type TerminalName = "CHECKS_FAILED" | "GHAS_STOP" | "MERGE_FAILED" | "MERGED" | "QUEUE_REJECTED" | "CONFLICT" | "dirty tree" | "on master" | "CREATED";
const TERMINALS: { name: TerminalName; kind: "merge" | "pr"; terminal: string; calls: string[] }[] = [
  { name: "CHECKS_FAILED", kind: "merge", terminal: "CHECKS_FAILED", calls: [] },
  { name: "GHAS_STOP", kind: "merge", terminal: "GHAS_STOP", calls: [] },
  { name: "MERGE_FAILED", kind: "merge", terminal: "MERGE_FAILED", calls: ["gh pr merge --squash --auto"] },
  { name: "MERGED", kind: "merge", terminal: "MERGED", calls: ["gh pr merge --squash --auto", "git fetch master:master"] },
  { name: "QUEUE_REJECTED", kind: "merge", terminal: "QUEUE_REJECTED", calls: ["gh pr merge --squash --auto"] },
  { name: "CONFLICT", kind: "pr", terminal: "CONFLICT", calls: ["git fetch master:master", "git rebase", "git rebase --abort"] },
  { name: "dirty tree", kind: "pr", terminal: "REFUSED", calls: [] },
  { name: "on master", kind: "pr", terminal: "REFUSED", calls: [] },
  { name: "CREATED", kind: "pr", terminal: "CREATED", calls: ["git fetch master:master", "git rebase", "git push --force-with-lease", "gh pr create"] },
];
/** A fresh world for one terminal-state scenario. */
function terminalWorld(name: TerminalName): World {
  const tag = `b3-terminal-${name.replace(/\W+/g, "-")}`;
  switch (name) {
    case "CHECKS_FAILED": {
      const w = pushed(tag);
      scenario(w, { list: openList(w), checks: { stdout: [...greens(MIN_CHECKS), check("lint", "fail")] } });
      return w;
    }
    case "GHAS_STOP": {
      const w = pushed(tag);
      scenario(w, { list: openList(w), alerts: { stdout: [{ number: 1, state: "open" }] } });
      return w;
    }
    case "MERGE_FAILED": {
      const w = pushed(tag);
      scenario(w, { list: openList(w), merge: { exit: 1, stderr: "merge refused" } });
      return w;
    }
    case "MERGED": {
      const w = pushed(tag);
      landing(w);
      return w;
    }
    case "QUEUE_REJECTED": {
      const w = pushed(tag);
      const flag = join(w.root, "merged.flag");
      scenario(w, {
        list: openList(w),
        view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "CLOSED" })) }] }] },
        merge: { replies: [{ stdout: "", touch: flag }] },
      });
      return w;
    }
    case "CONFLICT": {
      const w = reviewed(tag, { mainOnMaster: false }, (x) => advanceSource(x));
      advanceOrigin(w, "source.txt", "candidate source\ntrunk change\n");
      return w;
    }
    case "dirty tree": {
      const w = reviewed(tag, { mainOnMaster: false });
      appendFileSync(join(w.wtStudio, "notes.md"), "uncommitted bookkeeping edit\n");
      return w;
    }
    case "on master": {
      const w = reviewed(tag, { mainOnMaster: false });
      git(w.wt, ["switch", "-q", "master"]);
      return w;
    }
    case "CREATED":
      return reviewed(tag, { mainOnMaster: false });
  }
}

if (runs(3)) {
  test("W-124 behaviour 3: pr, merge and cleanup run in order and fail closed on gh", { timeout: 3_600_000 }, () => {
    // the verb's own terminal line, from a scenario that never sleeps
    const first = pushed("b3-first");
    scenario(first, { list: openList(first), merge: { exit: 1, stderr: "merge refused" } });
    const firstOut = performMerge(first);
    assert.match(firstOut.out, /state=MERGE_FAILED/, ran("a performed merge prints state=MERGE_FAILED", firstOut));
    assert.equal(firstOut.status, 1, ran("MERGE_FAILED exits 1", firstOut));

    // reads: fixed --json field lists, never -q or text greps; -R <slug> and --match-head-commit are the declared divergences
    const reads = pushed("b3-reads");
    landing(reads);
    const readsOut = performMerge(reads);
    assert.match(readsOut.out, /state=MERGED/, ran("the landing scenario merges", readsOut));
    assert.deepEqual(unmatched(reads), [], "the verb made no gh call the scenario did not expect");
    const gh = ghCalls(reads);
    assert.ok(gh.length > 0 && gh.filter((a) => a[0] !== "repo" && a[0] !== "api").every((a) => a.includes("-R") && a[a.indexOf("-R") + 1] === SLUG), "-R <slug> is pinned on every gh call that accepts it");
    for (const a of gh) assert.ok(!a.includes("-q") && !a.includes("--jq") && !a.includes("--template"), `no -q/--jq read: gh ${a.join(" ")}`);
    const list = gh.find((a) => a[0] === "pr" && a[1] === "list");
    assert.match(list?.[list.indexOf("--json") + 1] ?? "", /headRefOid/, "pr list reads a fixed --json field list");
    const checksCall = gh.find((a) => a[0] === "pr" && a[1] === "checks");
    assert.equal(checksCall?.[checksCall.indexOf("--json") + 1], "name,bucket,state", "pr checks reads --json name,bucket,state");
    assert.ok(gh.some((a) => a[0] === "api" && a.some((x) => x.startsWith(`repos/${SLUG}/code-scanning/alerts`))), "GHAS alerts come from gh api repos/<slug>/code-scanning/alerts");
    const mergeCall = ghMerges(reads)[0];
    assert.ok(mergeCall?.includes("--squash") && mergeCall.includes("--auto"), "the first merge is --squash --auto");
    assert.equal(mergeCall?.[mergeCall.indexOf("--match-head-commit") + 1], headOf(reads), "gh pr merge pins --match-head-commit <headRefOid>");
    assert.deepEqual(mutating(reads), ["gh pr merge --squash --auto", "git fetch master:master"], "MERGED is reported only after the merge and the trunk fetch");
    assert.equal(gitOk(reads.repo, ["merge-base", "--is-ancestor", reads.mergeOid!, "refs/heads/master"]), true, "the local trunk contains the merge commit");

    // terminal states: the verb reaches each one through its ordered mutating calls and no unexpected gh call
    for (const p of TERMINALS) {
      const b = terminalWorld(p.name);
      const v = p.kind === "merge" ? performMerge(b) : performPr(b);
      assert.equal(terminal(v), p.terminal, ran(`terminal ${p.name}: verb terminal state`, v));
      assert.deepEqual(mutating(b), p.calls, `terminal ${p.name}: the verb's ordered mutating calls`);
      assert.deepEqual(unmatched(b), [], `terminal ${p.name}: the verb made no unexpected gh call`);
    }

    // pr: what the verb creates and how
    const created = terminalWorld("CREATED");
    performPr(created);
    const createCall = ghCalls(created).find((a) => a[0] === "pr" && a[1] === "create") ?? [];
    assert.ok(createCall.includes("-R"), "gh pr create is pinned to -R <slug>");
    assert.equal(createCall[createCall.indexOf("--base") + 1], "master", "gh pr create --base master");
    assert.equal(createCall[createCall.indexOf("--head") + 1], BRANCH, "gh pr create --head opus/<id>");
    assert.equal(createCall[createCall.indexOf("--title") + 1], TITLE);
    assert.equal(createCall[createCall.indexOf("--body-file") + 1], BODY);
    const push = gitCalls(created).find((a) => a[0] === "push" && a.some((x) => x.startsWith("--force-with-lease"))) ?? [];
    assert.ok(push.includes(BRANCH), "the branch is pushed with --force-with-lease");
    const namedOnly = terminalWorld("CREATED");
    const named = performPr(namedOnly, []);
    expectStep(named, "pr", "named", "without --title and --body-file pr only names the command");
    assert.equal(named.status, 0, ran("named pr exit", named));
    assert.ok(named.kv.has("command"), ran("and prints the command", named));
    assert.deepEqual(mutating(namedOnly), [], "nothing is fetched, rebased, pushed or created");

    const reuse = reviewed("b3-reuse", { mainOnMaster: false });
    scenario(reuse, { list: openList(reuse, { state: "OPEN", oid: "8".repeat(40) }) });
    performPr(reuse);
    assert.deepEqual(mutating(reuse), ["git fetch master:master", "git rebase", "git push --force-with-lease"], "an existing OPEN PR is reused, never duplicated");

    const moved = reviewed("b3-rebase-source", { mainOnMaster: false });
    advanceOrigin(moved, "trunk.txt", "a new trunk file changes the SOURCE tree\n");
    const movedOut = performPr(moved);
    assert.deepEqual(mutating(moved), ["git fetch master:master", "git rebase"], "a rebase that changes the SOURCE tree stops before push and PR");
    assert.match(movedOut.out, /\bbuild\b/, ran("and re-derives (build)", movedOut));

    // merge: update when BEHIND, queue rejection/timeout, HEAD_MOVED, direct merge only when CLEAN
    const behind = pushed("b3-behind");
    const updated = join(behind.root, "updated.flag");
    const behindFlag = join(behind.root, "merged.flag");
    const behindM = landMerge(behind, false);
    scenario(behind, {
      list: openList(behind),
      view: {
        replies: [{ stdout: viewOf(cand(behind, { state: "OPEN", mss: "BEHIND" })) }],
        alts: [
          { ifExists: behindFlag, replies: [{ stdout: viewOf(cand(behind, { state: "MERGED", merge: behindM })) }] },
          { ifExists: updated, replies: [{ stdout: viewOf(cand(behind, { state: "OPEN", mss: "CLEAN" })) }] },
        ],
      },
      update: { stdout: "", touch: updated },
      merge: { replies: [{ stdout: "", touch: behindFlag }] },
    });
    performMerge(behind);
    assert.deepEqual(mutating(behind), ["gh pr update-branch", "gh pr merge --squash --auto", "git fetch master:master"], "gh pr update-branch when BEHIND, before the merge");

    const queuedBehind = pushed("b3-queued-behind");
    const queuedMerged = join(queuedBehind.root, "merged.flag");
    const queuedUpdated = join(queuedBehind.root, "updated.flag");
    const queuedM = landMerge(queuedBehind, false);
    scenario(queuedBehind, {
      list: openList(queuedBehind),
      view: {
        replies: [{ stdout: viewOf(cand(queuedBehind, { state: "OPEN" })) }],
        alts: [
          { ifExists: queuedUpdated, replies: [{ stdout: viewOf(cand(queuedBehind, { state: "MERGED", merge: queuedM })) }] },
          { ifExists: queuedMerged, replies: [{ stdout: viewOf(cand(queuedBehind, { state: "OPEN", mss: "BEHIND" })) }] },
        ],
      },
      update: { stdout: "", touch: queuedUpdated },
      merge: { replies: [{ stdout: "", touch: queuedMerged }] },
    });
    performMerge(queuedBehind);
    assert.deepEqual(mutating(queuedBehind), ["gh pr merge --squash --auto", "gh pr update-branch", "git fetch master:master"], "an update when BEHIND while queued");

    const direct = pushed("b3-direct");
    const directFlag = join(direct.root, "merged.flag");
    const directM = landMerge(direct, false);
    scenario(direct, {
      list: openList(direct),
      view: { replies: [{ stdout: viewOf(cand(direct, { state: "OPEN", mss: "CLEAN" })) }], alts: [{ ifExists: directFlag, replies: [{ stdout: viewOf(cand(direct, { state: "MERGED", merge: directM })) }] }] },
      merge: { replies: [{ stdout: "" }, { stdout: "", touch: directFlag }] },
    });
    performMerge(direct);
    assert.deepEqual(mutating(direct), ["gh pr merge --squash --auto", "gh pr merge --squash", "git fetch master:master"], "a direct merge follows only when CLEAN with every check pass");
    const directCall = ghMerges(direct)[1] ?? [];
    assert.equal(directCall[directCall.indexOf("--match-head-commit") + 1], headOf(direct), "the direct merge also pins --match-head-commit");

    const blocked = pushed("b3-blocked");
    scenario(blocked, { list: openList(blocked), view: { stdout: viewOf(cand(blocked, { state: "OPEN", mss: "BLOCKED" })) } });
    const blockedOut = performMerge(blocked);
    assert.match(blockedOut.out, /state=QUEUE_TIMEOUT/, ran("a BLOCKED green PR waits and ends QUEUE_TIMEOUT (a BLOCKED PR is never merged directly)", blockedOut));
    assert.deepEqual(mutating(blocked), ["gh pr merge --squash --auto"], "BLOCKED is never merged directly");

    const movedHead = pushed("b3-head-moved");
    const movedFlag = join(movedHead.root, "merged.flag");
    scenario(movedHead, {
      list: openList(movedHead),
      view: { replies: [{ stdout: viewOf(cand(movedHead, { state: "OPEN" })) }], alts: [{ ifExists: movedFlag, replies: [{ stdout: viewOf(cand(movedHead, { state: "OPEN", oid: "7".repeat(40) })) }] }] },
      merge: { replies: [{ stdout: "", touch: movedFlag }] },
    });
    const movedHeadOut = performMerge(movedHead);
    assert.match(movedHeadOut.out, /state=HEAD_MOVED/, ran("a head that moves from the pinned oid is HEAD_MOVED", movedHeadOut));
    assert.deepEqual(mutating(movedHead), ["gh pr merge --squash --auto"], "nothing more is done after HEAD_MOVED");

    // merge refusals: GHAS (alerts, API error, non-array), too few passing checks, skipping/cancel not counted
    const refuse = (row: string, over: Partial<Record<SlotName, SlotValue>>, state?: RegExp): void => {
      const w = pushed(`b3-refuse-${row.replace(/\W+/g, "-")}`);
      scenario(w, { list: openList(w), ...over });
      const o = performMerge(w);
      assert.equal(o.status, 1, ran(`merge refuses: ${row}`, o));
      if (state) assert.match(o.out, state, ran(`${row}: terminal state`, o));
      assert.deepEqual(mutating(w), [], `${row}: no mutating call`);
    };
    refuse("an API error on the GHAS read", { alerts: { exit: 1, stderr: "HTTP 403" } }, /state=GHAS_STOP/);
    refuse("a non-array reply on the GHAS read", { alerts: { stdout: { message: "Not Found" } } }, /state=GHAS_STOP/);
    refuse("fewer than MIN_CHECKS passing checks", { checks: { stdout: greens(MIN_CHECKS - 1) } });
    refuse("skipping and cancel checks do not count toward MIN_CHECKS", {
      checks: { stdout: [...greens(MIN_CHECKS - 1), check("s1", "skipping"), check("s2", "skipping"), check("c1", "cancel")] },
    });

    // a passed check named pending-review is not pending (the bucket decides, never the name)
    const pendingName = pushed("b3-pending-name");
    landing(pendingName, { checks: { stdout: [...greens(MIN_CHECKS), check("pending-review", "pass")] } });
    const pendingOut = performMerge(pendingName);
    assert.match(pendingOut.out, /state=MERGED/, ran("a check NAMED pending-review that passed does not block the merge", pendingOut));

    // an untracked file does not refuse pr (only tracked changes count as dirty)
    const untracked = reviewed("b3-untracked", { mainOnMaster: false });
    writeFileSync(join(untracked.wt, "scratch.txt"), "untracked\n");
    performPr(untracked);
    assert.ok(mutating(untracked).includes("gh pr create"), "an untracked file does not refuse pr");

    // a PR already MERGED: only the fetch and the re-check
    const merged = pushed("b3-already-merged");
    const mergedM = landMerge(merged, false);
    scenario(merged, { list: mergedList(merged, { merge: mergedM }) });
    const mergedOut = performMerge(merged);
    assert.match(mergedOut.out, /state=MERGED/, ran("an already-MERGED PR prints state=MERGED after the fetch and re-check", mergedOut));
    assert.deepEqual(mutating(merged), ["git fetch master:master"], "no update-branch and no merge for a MERGED PR");
    assert.deepEqual(gitCalls(merged).filter((a) => a[0] === "branch" || (a[0] === "worktree" && a[1] === "add")), [], "and no branch creation");
    const stuck = pushed("b3-merged-not-contained");
    scenario(stuck, { list: mergedList(stuck, { merge: OID_UNFETCHED }) });
    const stuckOut = performMerge(stuck);
    expectHeld(stuckOut, "a merge commit still not contained after the fetch");
    assert.ok(stuckOut.out.includes(OID_UNFETCHED.slice(0, 12)), ran("held names the merge commit", stuckOut));
    assert.equal(ghMerges(stuck).length, 0, "and issues no merge");

    // fail closed: one row per mode, each held, exit 1, zero mutating calls
    const fc = pushed("b3-failclosed");
    const good = cand(fc, { state: "OPEN" });
    const pad = "x".repeat(1_100_000);
    const modes: [string, Partial<Record<SlotName, SlotValue>>][] = [
      ["gh exits non-zero (pr list)", { list: { stdout: "", stderr: "HTTP 502", exit: 3 } }],
      ["empty output (pr list)", { list: { stdout: "" } }],
      ["non-JSON (pr list)", { list: { stdout: "<html>bad gateway</html>" } }],
      ["a missing required field (pr list)", { list: { stdout: [cand(fc, { state: "OPEN", drop: ["headRefOid"] })] } }],
      ["an unknown state (pr list)", { list: { stdout: [cand(fc, { state: "WEIRD" as "OPEN" })] } }],
      ["an unknown mergeStateStatus (pr list)", { list: { stdout: [cand(fc, { state: "OPEN", mss: "WOBBLY" })] } }],
      ["output over 1 MiB (pr list)", { list: { stdout: [good, { pad }] } }],
      ["gh exits non-zero (pr checks)", { checks: { stdout: "", stderr: "HTTP 502", exit: 3 } }],
      ["empty output (pr checks)", { checks: { stdout: "" } }],
      ["non-JSON (pr checks)", { checks: { stdout: "no checks reported" } }],
      ["a missing required field (pr checks)", { checks: { stdout: [...greens().slice(0, 5), { name: "no-bucket", state: "SUCCESS" }] } }],
      ["an unknown bucket (pr checks)", { checks: { stdout: [...greens().slice(0, 5), check("odd", "weird")] } }],
      ["output over 1 MiB (pr checks)", { checks: { stdout: [...greens(), { name: "pad", bucket: "pass", state: "SUCCESS", pad }] } }],
      ["an empty check list (pr checks)", { checks: { stdout: [] } }],
    ];
    for (const [mode, over] of modes) {
      scenario(fc, { list: { stdout: [good] }, ...over });
      const o = performMerge(fc);
      expectHeld(o, `fail closed: ${mode}`);
      assert.deepEqual(mutating(fc), [], `fail closed: ${mode}: zero mutating calls`);
    }

    // cleanup: deletions in order, each after a fresh MERGED read
    const cleanupWorld = (tag: string): World => {
      const w = world(tag, "merge", { mainOnMaster: false });
      scenario(w, { list: mergedList(w), view: { stdout: viewOf(cand(w, { state: "MERGED" })) } });
      return w;
    };
    const outcome = (o: Out, what: RegExp): string => {
      const line = o.out.split("\n").find((l) => what.test(l) && /(ran|skipped \(absent\)|held)/.test(l));
      return /\b(ran|skipped \(absent\)|held)(?!\w)/.exec(line ?? "")?.[1] ?? "(not reported)";
    };
    const WORKTREE = /worktree/i;
    const LOCAL = /^\s*(local )?branch/i;
    const REMOTE = /remote/i;
    const gone = (w: World): void => {
      assert.equal(existsSync(w.wt), false, "the worktree is gone");
      assert.equal(branchExists(w), false, "the local branch is gone");
      assert.equal(remoteBranchExists(w), false, "the remote branch is gone");
    };
    const full = cleanupWorld("b3-cleanup-full");
    const fullTip = tipOf(full);
    const fullOut = performCleanup(full);
    expectStep(fullOut, "cleanup", "performed", "cleanup performed");
    gone(full);
    assert.deepEqual([outcome(fullOut, WORKTREE), outcome(fullOut, LOCAL), outcome(fullOut, REMOTE)], ["ran", "ran", "ran"], ran("every deletion is reported", fullOut));
    const order = [
      callIndex(full, (a) => a[0] === "worktree" && a[1] === "remove"),
      callIndex(full, (a) => a[0] === "update-ref" && a[1] === "-d" && a.includes(`refs/heads/${BRANCH}`)),
      callIndex(full, (a) => a[0] === "push" && a.includes("--delete")),
    ];
    assert.ok(order[0]! >= 0 && order[0]! < order[1]! && order[1]! < order[2]!, `worktree, then branch, then remote: ${order.join(",")}`);
    const removal = gitCalls(full)[order[0]!] ?? [];
    assert.ok(!removal.includes("--force") && removal.includes("--") && removal.includes(full.wt), "git worktree remove -- <path>, never --force");
    assert.ok(gitCalls(full)[order[1]!]?.includes(fullTip), "update-ref -d is a compare-and-swap on the tip");
    assert.ok(gitCalls(full)[order[2]!]?.includes(`--force-with-lease=refs/heads/${BRANCH}:${headOf(full)}`), "the remote delete is leased on the merged headRefOid");

    // a flip to OPEN between the re-reads stops the later deletions
    const flipped2 = world("b3-cleanup-flip", "merge", { mainOnMaster: false });
    const open = [cand(flipped2, { state: "OPEN" })];
    scenario(flipped2, {
      list: { replies: [{ stdout: [cand(flipped2, { state: "MERGED" })] }], alts: [{ ifMissing: flipped2.wt, replies: [{ stdout: open }] }] },
      view: { replies: [{ stdout: viewOf(cand(flipped2, { state: "MERGED" })) }], alts: [{ ifMissing: flipped2.wt, replies: [{ stdout: viewOf(open[0]!) }] }] },
    });
    const flippedOut = performCleanup(flipped2);
    assert.equal(flippedOut.status, 1, ran("a flipped PR holds", flippedOut));
    assert.equal(existsSync(flipped2.wt), false, "the first deletion ran");
    assert.equal(branchExists(flipped2), true, "the later deletions did not (branch)");
    assert.equal(remoteBranchExists(flipped2), true, "the later deletions did not (remote)");

    // nothing is touched for a dirty worktree, a branch ahead of the merge, an OPEN PR, a CLOSED-unmerged PR
    const untouched = (w: World, row: string): void => {
      assert.equal(existsSync(w.wt), true, `${row}: worktree untouched`);
      assert.equal(branchExists(w), true, `${row}: branch untouched`);
      assert.equal(remoteBranchExists(w), true, `${row}: remote untouched`);
    };
    const dirty = cleanupWorld("b3-cleanup-dirty");
    appendFileSync(join(dirty.wt, "source.txt"), "uncommitted\n");
    const dirtyOut = performCleanup(dirty);
    assert.equal(dirtyOut.status, 1, ran("a dirty worktree holds", dirtyOut));
    untouched(dirty, "dirty worktree");
    const ahead = world("b3-cleanup-ahead", "merge", { mainOnMaster: false });
    const mergedTip = tipOf(ahead);
    advanceSource(ahead, false);
    scenario(ahead, { list: mergedList(ahead, { oid: mergedTip }), view: { stdout: viewOf(cand(ahead, { state: "MERGED", oid: mergedTip })) } });
    const aheadOut = performCleanup(ahead);
    assert.equal(aheadOut.status, 1, ran("a local branch ahead of the merged PR holds", aheadOut));
    untouched(ahead, "branch ahead of the merge");
    const openPr = cleanupWorld("b3-cleanup-open");
    scenario(openPr, { list: openList(openPr) });
    assert.equal(performCleanup(openPr).status, 1, "an OPEN PR is not cleaned up (the PR 127 shape)");
    untouched(openPr, "OPEN PR");
    const closedPr = cleanupWorld("b3-cleanup-closed");
    scenario(closedPr, { list: { stdout: [cand(closedPr, { state: "CLOSED" })] } });
    assert.equal(performCleanup(closedPr).status, 1, "a CLOSED-unmerged PR is not cleaned up");
    untouched(closedPr, "CLOSED-unmerged PR");

    // idempotent resume after an interrupted cleanup
    const r1 = cleanupWorld("b3-resume-1");
    git(r1.repo, ["worktree", "remove", "--force", r1.wt]);
    const r1Out = performCleanup(r1);
    gone(r1);
    assert.deepEqual([outcome(r1Out, WORKTREE), outcome(r1Out, LOCAL), outcome(r1Out, REMOTE)], ["skipped (absent)", "ran", "ran"], ran("worktree removed, branch present", r1Out));
    const r2 = cleanupWorld("b3-resume-2");
    git(r2.repo, ["worktree", "remove", "--force", r2.wt]);
    git(r2.repo, ["branch", "-D", BRANCH]);
    const r2Out = performCleanup(r2);
    gone(r2);
    assert.deepEqual([outcome(r2Out, WORKTREE), outcome(r2Out, LOCAL), outcome(r2Out, REMOTE)], ["skipped (absent)", "skipped (absent)", "ran"], ran("worktree and branch gone, remote present", r2Out));
    const r3 = cleanupWorld("b3-resume-3");
    rmSync(r3.wt, { recursive: true, force: true });
    const r3Out = performCleanup(r3);
    assert.equal(r3Out.status, 0, ran("a worktree directory deleted by hand is pruned", r3Out));
    gone(r3);
    assert.ok(callIndex(r3, (a) => a[0] === "worktree" && a[1] === "prune") >= 0, "git worktree prune ran for the prunable entry");
    assert.ok(gitCalls(r3).every((a) => !(a[0] === "worktree" && a.includes("--force"))), "and never --force");
    const r4 = world("b3-resume-4", "cleanup");
    scenario(r4, { list: mergedList(r4) });
    expectStep(next(r4, [OPUS]), "done", "named", "worktree, branch and remote all gone: the rung is met and the step is done");
    const r5 = cleanupWorld("b3-resume-5");
    git(r5.repo, ["worktree", "remove", "--force", r5.wt]);
    mkdirSync(r5.wt, { recursive: true });
    writeFileSync(join(r5.wt, "keep.txt"), "not a worktree\n");
    const r5Out = performCleanup(r5);
    assert.equal(r5Out.status, 1, ran("a directory that is not the registered worktree is held", r5Out));
    assert.equal(readFileSync(join(r5.wt, "keep.txt"), "utf8"), "not a worktree\n", "and left untouched");
    assert.equal(branchExists(r5), true, "the branch is left alone too");
  });
}

// ---------------------------------------------------------------------------
// behaviour 4: complete means MERGED and FETCHED
// ---------------------------------------------------------------------------
if (runs(4)) {
  test("W-124 behaviour 4: complete means MERGED and FETCHED (done needs a fresh MERGED read and a trunk that contains it)", { timeout: 1_800_000 }, () => {
    // MERGED with the local trunk one commit behind: the step is merge (branch present, then branch gone), never done
    const behind = world("b4-behind", "merge", { fetched: false, mainOnMaster: false });
    scenario(behind, { list: mergedList(behind) });
    expectStep(next(behind, [OPUS]), "merge", "named", "MERGED with the trunk one commit behind is merge, with the branch present");
    const behindGone = world("b4-behind-gone", "cleanup", { fetched: false, mainOnMaster: false });
    scenario(behindGone, { list: mergedList(behindGone) });
    expectStep(next(behindGone, [OPUS]), "merge", "named", "MERGED with the trunk behind and the branch gone is merge, never branch");
    const refusedDone = next(behindGone, [OPUS, "--perform", "--expect", "done"]);
    assert.match(refusedDone.out + refusedDone.err, /refusing: next step for W-900 is merge, not done/, ran("done is refused while the trunk is behind", refusedDone));
    for (const [row, w] of [["branch present", behind], ["branch gone", behindGone]] as const) {
      scenario(w, { list: mergedList(w, { merge: OID_UNFETCHED }) });
      const o = performMerge(w);
      expectHeld(o, `${row}: a merge commit that is still not contained after the fetch`);
      assert.ok(o.out.includes(OID_UNFETCHED.slice(0, 12)), ran(`${row}: held names the commit`, o));
      assert.equal(ghMerges(w).length, 0, `${row}: no gh merge`);
      assert.equal(ghCalls(w).filter((a) => a[1] === "update-branch").length, 0, `${row}: no update-branch`);
    }

    // OPEN, CLOSED unmerged, and a PR whose base is not master are not done-able
    const open = pushed("b4-open");
    scenario(open, { list: openList(open) });
    expectStep(next(open, [OPUS]), "merge", "named", "an OPEN PR is merge, not done");
    scenario(open, { list: { stdout: [cand(open, { state: "CLOSED" })] } });
    expectStep(next(open, [OPUS]), "pr", "named", "CLOSED unmerged is no PR");
    scenario(open, { list: mergedList(open, { base: "develop" }) });
    expectStep(next(open, [OPUS]), "pr", "named", "a MERGED PR whose baseRefName is not master is not a PR");

    // a malformed mergeCommit.oid is held and never reaches git
    const malformed = world("b4-malformed", "merge");
    const badOids: [string, string | null][] = [
      ["uppercase", "A".repeat(40)],
      ["39 characters", "a".repeat(39)],
      ["all zeros", "0".repeat(40)],
      ["null", null],
      ["a leading dash", `-${"a".repeat(39)}`],
    ];
    for (const [row, oid] of badOids) {
      scenario(malformed, { list: mergedList(malformed, { merge: oid }) });
      const o = next(malformed, [OPUS]);
      expectHeld(o, `mergeCommit.oid ${row}`);
      if (oid !== null) assert.ok(!gitCalls(malformed).some((a) => a.includes(oid)), `mergeCommit.oid ${row} never reaches git`);
      assert.ok(!gitCalls(malformed).some((a) => a.some((x) => x.includes("merge-base") || x === "null")), `mergeCommit.oid ${row}: no merge-base call at all`);
    }

    // master checked out in the main checkout (clean, behind): the verb fast-forwards it to the reviewed merge commit and nothing else
    const checkedOut = world("b4-checked-out", "pr");
    const m = landMerge(checkedOut, false);
    scenario(checkedOut, { list: mergedList(checkedOut, { merge: m }) });
    assert.equal(m, checkedOut.mergeOid, "the world's mergeOid is the merge commit the PR names");
    const ffOut = performMerge(checkedOut);
    assert.match(ffOut.out, /state=MERGED/, ran("a clean checked-out master that is behind is fast-forwarded and the merge reports MERGED", ffOut));
    assert.equal(gitq(checkedOut.repo, ["rev-parse", "refs/heads/master"]), m, "refs/heads/master equals the merge commit");
    assert.equal(gitq(checkedOut.repo, ["symbolic-ref", "-q", "HEAD"]), "refs/heads/master", "HEAD is still master");
    const raw = calls(checkedOut).filter((c) => c[0] === "git").map((c) => c.slice(1));
    const mergeCalls = raw.filter((a) => gitArgs(a)[0] === "merge");
    assert.equal(mergeCalls.length, 1, "exactly one merge call");
    assert.deepEqual(mergeCalls[0], ["-c", "submodule.recurse=false", "merge", "-q", "--ff-only", m], "the merge is --ff-only to the literal reviewed oid, never origin/master");
    assert.deepEqual(raw[raw.indexOf(mergeCalls[0]!) - 1], ["symbolic-ref", "-q", "HEAD"], "the call immediately before the merge is symbolic-ref -q HEAD");
    for (const a of raw) {
      assert.ok(!["reset", "pull", "stash", "checkout", "switch", "restore", "clean"].includes(gitArgs(a)[0] ?? ""), `no ${gitArgs(a)[0]} call`);
      assert.ok(!a.includes("--force") && !a.includes("-f") && !a.includes("--update-head-ok"), `no force flag in git ${a.join(" ")}`);
    }
    assert.ok(gitCalls(checkedOut).every((a) => !a.includes("-u") && !a.includes("--set-upstream")), "-u is never used");

    // master checked out in another worktree: the verb never writes there, so the step holds naming it and the pull to run there
    const elsewhere = world("b4-held-elsewhere", "pr");
    const m2 = landMerge(elsewhere, false);
    scenario(elsewhere, { list: mergedList(elsewhere, { merge: m2 }) });
    git(elsewhere.repo, ["switch", "-q", "-c", "side"]);
    const holder = join(elsewhere.root, "master-wt");
    git(elsewhere.repo, ["worktree", "add", "-q", holder, "master"]);
    const refusedFetch = performMerge(elsewhere);
    expectHeld(refusedFetch, "git fetch origin master:master refused because master is checked out in another worktree");
    assert.ok(refusedFetch.out.includes(holder), ran("held names the worktree that has master checked out", refusedFetch));
    assert.match(refusedFetch.out, /pull --ff-only/, ran("and the pull --ff-only to run there", refusedFetch));
    assert.equal(gitCalls(elsewhere).filter((a) => a[0] === "merge").length, 0, "no merge call");
    assert.ok(gitCalls(elsewhere).every((a) => !a.includes("-u") && !a.includes("--set-upstream")), "-u is never used");

    // performed done, end to end, from the main checkout on master
    const lifecycle = world("b4-done", "cleanup");
    scenario(lifecycle, { list: mergedList(lifecycle) });
    const masterTip = gitq(lifecycle.repo, ["rev-parse", "refs/heads/master"]);
    touchHandoff(lifecycle);
    const performed = next(lifecycle, [OPUS, "--perform", "--expect", "done"]);
    expectStep(performed, "done", "performed", "done is performed from a fresh MERGED read and a contained merge commit");
    assert.equal(performed.status, 0, ran("performed done exit", performed));
    const chore = `chore/done-${OPUS}`;
    const choreTip = gitq(lifecycle.repo, ["rev-parse", `refs/heads/${chore}`]);
    assert.equal(gitq(lifecycle.repo, ["rev-parse", `${choreTip}^`]), masterTip, "chore/done-<id> is created at the master tip");
    assert.equal(gitq(lifecycle.repo, ["log", "-1", "--format=%s", choreTip]), `chore(studio): mark ${OPUS} done`);
    assert.match(gitq(lifecycle.repo, ["log", "-1", "--format=%b", choreTip]), /Co-Authored-By: producer \(bisellium next\) <noreply@anthropic\.com>/, "the trailer");
    assert.deepEqual(gitq(lifecycle.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", choreTip]).split("\n"), ["docs/SESSION-HANDOFF.md", `studio/opera/${OPUS}.md`], "exactly the record and the handoff");
    assert.equal(gitq(lifecycle.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "and back on master");
    assert.doesNotMatch(gitq(lifecycle.repo, ["show", `refs/heads/master:studio/opera/${OPUS}.md`]), /state: "?done/, "the committed trunk record is not done until the commit lands");
    const landing2 = next(lifecycle, [OPUS]);
    expectStep(landing2, "done", "named", "the next call names the landing and performs nothing");
    assert.match(landing2.out, /done committed on chore\/done-W-900, not on master/, ran("landing why", landing2));
    assert.equal(gitq(lifecycle.repo, ["rev-parse", `refs/heads/${chore}`]), choreTip, "no second commit");

    // a refusing done leaves no branch and no commit
    const refusing = world("b4-done-refused", "cleanup", { sec: false });
    scenario(refusing, { list: mergedList(refusing) });
    touchHandoff(refusing);
    const refusingTip = git(refusing.repo, ["rev-parse", "refs/heads/master"]);
    const refusingOut = next(refusing, [OPUS, "--perform", "--expect", "done"]);
    assert.equal(refusingOut.status, 1, ran("a refusing done is relayed (exit 1)", refusingOut));
    assert.equal(branchExists(refusing, chore), false, "no chore branch is left");
    assert.equal(git(refusing.repo, ["rev-parse", "refs/heads/master"]), refusingTip, "and no commit");
    assert.equal(git(refusing.repo, ["status", "--porcelain", "--untracked-files=no"]), "M docs/SESSION-HANDOFF.md", "and only the handoff edit is left");

    // a second changed tracked path is held with nothing committed
    const second = world("b4-done-second-path", "cleanup");
    put(second.studio, ".bisellium/events.jsonl", "");
    git(second.repo, ["add", "-f", "studio/.bisellium/events.jsonl"]);
    commit(second.repo, "test: track the event log");
    scenario(second, { list: mergedList(second) });
    touchHandoff(second);
    const secondTip = git(second.repo, ["rev-parse", "refs/heads/master"]);
    const secondOut = next(second, [OPUS, "--perform", "--expect", "done"]);
    expectHeld(secondOut, "a second changed tracked path");
    assert.equal(gitq(second.repo, ["rev-parse", `refs/heads/${chore}`]), secondTip, "nothing was committed on the chore branch (left for inspection)");
  });
}

// ---------------------------------------------------------------------------
// behaviour 5: step health comes from evidence, never assumption
// ---------------------------------------------------------------------------
if (runs(5)) {
  test("W-124 behaviour 5: step health comes from the pid, /proc start time and the output mtime, never assumption", { timeout: 1_800_000 }, async () => {
    const budget = ["--budget", "100000"];
    const w = world("b5-health", "reds");
    const status = (o: Out): string => o.kv.get("health") ?? "";

    // the 2026-10-02 fixture: a marker whose pid is gone and whose output is four hours old is dead, not running
    const gone = deadPid();
    putMarker(w, { step: "build", pid: gone, start_ticks: 1234 });
    putOutput(w, "gate chain started\nrunning suite 3 of 9\n", 4 * 3600);
    const fourHours = next(w, [OPUS, ...budget]);
    expectStep(fourHours, "build", "dead", "a dead gate chain is dead, never running");
    assert.equal(fourHours.status, 1, ran("dead exits 1", fourHours));
    assert.match(fourHours.out, /resume/i, ran("the report names the resume point", fourHours));
    assert.match(fourHours.out, /age/i, ran("and the output age", fourHours));
    assert.match(fourHours.out, /running suite 3 of 9/, ran("and the last output line", fourHours));

    // a live pid with output inside its silence budget, on the derived rung, is running and names no next step
    const live = liveChild();
    putMarker(w, { step: "build", pid: live, start_ticks: tickOf(live) });
    putOutput(w, "compiling\n", 60);
    const running = next(w, [OPUS, ...budget]);
    expectStep(running, "build", "running", "a live pid with fresh output on the derived rung is running");
    assert.equal(running.status, 0, ran("running exits 0", running));
    assert.equal(running.kv.has("command"), false, ran("no next step is named while it runs", running));

    // pid reuse: the pid lives but its /proc start time is not the marker's
    putMarker(w, { step: "build", pid: live, start_ticks: tickOf(live) + 1 });
    expectStep(next(w, [OPUS, ...budget]), "build", "dead", "a live pid with another start time is a reused pid, hence dead");
    // a zombie is dead
    const zombie = zombiePid();
    putMarker(w, { step: "build", pid: zombie, start_ticks: tickOf(zombie) });
    expectStep(next(w, [OPUS, ...budget]), "build", "dead", "a zombie is dead");

    // pid alive but silent past the budget: dead (stalled), pid named, never killed
    putMarker(w, { step: "build", pid: live, start_ticks: tickOf(live) });
    putOutput(w, "last words\n", 3600);
    const stalled = next(w, [OPUS, ...budget]);
    expectStep(stalled, "build", "dead", "a live pid silent past its budget is dead");
    assert.match(status(stalled), /stalled/i, ran("health says stalled", stalled));
    assert.ok(stalled.out.includes(String(live)), ran("and names the pid", stalled));
    assert.doesNotThrow(() => process.kill(live, 0), "next never kills the pid");
    // output missing is dead
    rmSync(outputPath(w));
    expectStep(next(w, [OPUS, ...budget]), "build", "dead", "a missing output file is dead");
    // an output mtime more than 5 seconds in the future is a clock anomaly, held; up to 5 counts as 0
    putOutput(w, "from the future\n", -60);
    const anomaly = next(w, [OPUS, ...budget]);
    expectHeld(anomaly, "an output mtime 60s in the future");
    assert.match(anomaly.out, /clock/i, ran("names the clock anomaly", anomaly));
    putOutput(w, "slightly ahead\n", -3);
    expectStep(next(w, [OPUS, ...budget]), "build", "running", "0 to 5 seconds ahead counts as 0");

    // the marker's step against the derived rung
    putOutput(w, "fresh\n", 10);
    putMarker(w, { step: "reds", pid: live, start_ticks: tickOf(live) });
    const finished = next(w, [OPUS, ...budget]);
    expectStep(finished, "build", "named", "a marker for an earlier step whose rung is met names the real next step");
    assert.match(status(finished), /finished reds/, ran("health: finished <step>", finished));
    putMarker(w, { step: "review", pid: live, start_ticks: tickOf(live) });
    const stale = next(w, [OPUS, ...budget]);
    expectStep(stale, "build", "named", "a marker for a later step is never running");
    assert.match(status(stale), /stale marker/, ran("health: stale marker", stale));
    rmSync(markerPath(w), { force: true });
    const none = next(w, [OPUS, ...budget]);
    assert.match(status(none), /no step recorded/, ran("no marker is no step recorded, never healthy", none));
    assert.doesNotMatch(none.out, /running|healthy/i, "and never running or healthy");

    // an invalid marker is dead and its output is not opened
    writeFileSync(markerPath(w), "{ this is not json");
    putOutput(w, "SECRET-LINE-XYZ\n", 10);
    const invalid = next(w, [OPUS, ...budget]);
    expectStep(invalid, "build", "dead", "an invalid marker is dead");
    assert.ok(!invalid.out.includes("SECRET-LINE-XYZ"), ran("its output is not opened", invalid));

    // output is data: a 10 KiB last line with escapes prints as a clipped JSON string
    putMarker(w, { step: "build", pid: gone, start_ticks: 1234 });
    putOutput(w, `first\n\u001b[31m${"A".repeat(10240)}\u001b[0m\n`, 500);
    const clipped = next(w, [OPUS, ...budget]);
    const lastLine = /^last-output: (".*")$/m.exec(clipped.out)?.[1];
    assert.ok(lastLine !== undefined, ran("last-output is printed as a JSON-quoted value", clipped));
    const decoded = JSON.parse(lastLine ?? '""') as string;
    assert.ok(decoded.length <= 200, `clipped to 200 characters, got ${decoded.length}`);
    assert.ok(!decoded.includes("\u001b"), "control characters are stripped");

    // /proc parsing, with a fake root honoured only under BISELLIUM_TEST_CLOCK=1
    const pid = "4242";
    putOutput(w, "fresh\n", 10);
    putMarker(w, { step: "build", pid: Number(pid), start_ticks: 777 });
    const marker = markerText(w);
    const unknownRows: [string, Record<string, string>][] = [
      ["a non-ENOENT read error (stat is a directory)", { [pid]: "dir" }],
      ["no closing parenthesis", { [pid]: `${pid} no-paren S 1 2 3\n` }],
      ["too few fields after the comm", { [pid]: `${pid} (x) S 1 2\n` }],
      ["a state that is not one letter", { [pid]: statLine(pid, "x", "SS", 777) }],
      ["a field 22 that is not an integer", { [pid]: statLine(pid, "x", "S", "abc") }],
    ];
    for (const [row, entries] of unknownRows) {
      const proc = fakeProc(w, entries);
      const o = next(w, [OPUS, ...budget], { env: PROC_ENV(proc) });
      expectStep(o, "build", "held", `${row} is unknown, hence held`);
      assert.equal(o.status, 1, ran(`${row}: exit`, o));
      assert.match(status(o), /unknown/, ran(`${row}: health: unknown`, o));
      assert.doesNotMatch(status(o), /dead/, `${row}: never dead`);
      assert.equal(markerText(w), marker, `${row}: the marker is untouched`);
      const performRefused = next(w, [OPUS, "--perform", "--expect", "build", ...budget], { env: PROC_ENV(proc) });
      assert.equal(performRefused.status, 1, ran(`${row}: --perform refuses an unknown marker`, performRefused));
      assert.equal(markerText(w), marker, `${row}: --perform leaves the marker alone`);
    }
    // a comm containing spaces and ") (" parses by the last ")"
    const tricky = "a b) (c d";
    let proc = fakeProc(w, { [pid]: statLine(pid, tricky, "S", 5555) });
    putMarker(w, { step: "build", pid: Number(pid), start_ticks: 5555 });
    expectStep(next(w, [OPUS, ...budget], { env: PROC_ENV(proc) }), "build", "running", "a comm with spaces and ') (' reads live by its true field 22");
    putMarker(w, { step: "build", pid: Number(pid), start_ticks: 5554 });
    expectStep(next(w, [OPUS, ...budget], { env: PROC_ENV(proc) }), "build", "dead", "and dead by its true field 22");
    // BISELLIUM_TEST_PROC without BISELLIUM_TEST_CLOCK=1 is ignored: the real /proc has no such pid
    putMarker(w, { step: "build", pid: gone, start_ticks: 777 });
    proc = fakeProc(w, { [String(gone)]: statLine(gone, "x", "S", 777) });
    writeFileSync(outputPath(w), "fresh\n");
    const ignored = next(w, [OPUS, ...budget], { clock: false, env: PROC_ENV(proc) });
    expectStep(ignored, "build", "dead", "BISELLIUM_TEST_PROC without BISELLIUM_TEST_CLOCK=1 is ignored");

    // --track: registers a step an orchestrator launched itself
    const t = world("b5-track", "reds");
    const child = liveChild();
    mkdirSync(stepsDir(t), { recursive: true });
    writeFileSync(join(stepsDir(t), "w124.log"), "tee\n");
    const track = (args: string[], o: RunOpts = {}): Out => next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", "steps/w124.log", ...budget, ...args], o);
    const tracked = track([]);
    assert.equal(tracked.status, 0, ran("--track registers a live pid", tracked));
    const written = markerJson(t);
    assert.deepEqual([written["schema"], written["step"], written["pid"], written["writer"], written["output"]], [1, "build", child, "track", "steps/w124.log"], "the marker is verb-written with writer: track");
    assert.equal(written["start_ticks"], tickOf(child), "and next read start_ticks itself");
    utimesSync(join(stepsDir(t), "w124.log"), new Date(NOW_MS - 30_000), new Date(NOW_MS - 30_000));
    expectStep(next(t, [OPUS, ...budget]), "build", "running", "a tracked live step with fresh output is running");
    // the existing live marker refuses a second track
    const liveMarker = markerText(t);
    assert.equal(track([]).status, 1, "an existing live marker refuses --track");
    assert.equal(markerText(t), liveMarker, "and is left alone");
    rmSync(markerPath(t), { force: true });
    const trackRefused = (row: string, o: Out): void => {
      assert.equal(o.status, 1, ran(`--track refuses ${row}`, o));
      assert.equal(existsSync(markerPath(t)), false, `--track ${row}: no marker written`);
    };
    for (const bad of ["0", "1", "-1", "abc", "1.5"]) trackRefused(`pid ${bad}`, next(t, [OPUS, "--track", "build", "--pid", bad, "--output", "steps/w124.log", ...budget]));
    trackRefused("the test process's own pid (next's parent)", next(t, [OPUS, "--track", "build", "--pid", String(process.pid), "--output", "steps/w124.log", ...budget]));
    trackRefused("a pid with no /proc entry", next(t, [OPUS, "--track", "build", "--pid", String(deadPid()), "--output", "steps/w124.log", ...budget]));
    trackRefused("a step that is not the derived rung", next(t, [OPUS, "--track", "review", "--pid", String(child), "--output", "steps/w124.log", ...budget]));
    const outside = join(t.root, "outside.log");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(stepsDir(t), "link-out.log"));
    symlinkSync(join(stepsDir(t), "w124.log"), join(stepsDir(t), "link-in.log"));
    for (const [row, out] of [
      ["an --output outside .bisellium/steps", "../x.log"],
      ["an absolute --output", outside],
      ["an --output reached through ..", "steps/../steps/w124.log"],
      ["a symlink to a file outside", "steps/link-out.log"],
      ["a symlink to a file inside", "steps/link-in.log"],
      ["a missing --output file", "steps/missing.log"],
    ] as const)
      trackRefused(row, next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", out, ...budget]));
    trackRefused("a target pid whose /proc entry is unreadable", next(t, [OPUS, "--track", "build", "--pid", pid, "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fakeProc(t, { [pid]: "dir" })) }));
    trackRefused("a target pid whose /proc entry is unparseable", next(t, [OPUS, "--track", "build", "--pid", pid, "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fakeProc(t, { [pid]: "garbage" })) }));
    putMarker(t, { step: "build", pid: Number(pid), start_ticks: 777 });
    const unknownMarker = markerText(t);
    const overUnknown = next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fakeProc(t, { [pid]: "dir" })) });
    assert.equal(overUnknown.status, 1, ran("an existing unknown marker refuses --track", overUnknown));
    assert.equal(markerText(t), unknownMarker, "and is left alone");
    rmSync(markerPath(t), { force: true });
    const noClock = next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", "steps/w124.log", "--now", NOW_ISO, ...budget], { clock: false });
    assert.equal(noClock.status, 2, ran("--now without BISELLIUM_TEST_CLOCK=1 is a usage error", noClock));
    // the fake /proc root governs --track's own start_ticks read too (and is ignored without the clock guard)
    const fake = fakeProc(t, { [String(gone)]: statLine(gone, "x", "S", 777) });
    const fakeTracked = next(t, [OPUS, "--track", "build", "--pid", String(gone), "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fake) });
    assert.equal(fakeTracked.status, 0, ran("a fake /proc entry can be tracked under the clock guard", fakeTracked));
    assert.equal(markerJson(t)["start_ticks"], 777, "start_ticks came from the fake root");
    rmSync(markerPath(t), { force: true });
    trackRefused("a fake /proc entry without the clock guard", next(t, [OPUS, "--track", "build", "--pid", String(gone), "--output", "steps/w124.log", ...budget], { clock: false, env: PROC_ENV(fake) }));

    // --perform: refuses a live marker, refuses an unknown one, replaces a dead one, and reads its OWN start_ticks from the fake root too
    const p = world("b5-perform", "spec");
    const performLive = liveChild();
    putMarker(p, { step: "branch", pid: performLive, start_ticks: tickOf(performLive), budget: 120 });
    putOutput(p, "cutting\n", 10);
    const livePerform = next(p, [OPUS, "--perform", "--expect", "branch"]);
    assert.equal(livePerform.status, 1, ran("--perform refuses a live marker", livePerform));
    assert.match(livePerform.out + livePerform.err, new RegExp(`step branch is running, pid ${performLive}`), ran("with the running message", livePerform));
    assert.equal(branchExists(p), false, "and performs nothing");
    putMarker(p, { step: "branch", pid: Number(pid), start_ticks: 777, budget: 120 });
    const unknownPerform = next(p, [OPUS, "--perform", "--expect", "branch"], { env: PROC_ENV(fakeProc(p, { [pid]: "dir" })) });
    assert.equal(unknownPerform.status, 1, ran("--perform refuses an unknown marker", unknownPerform));
    assert.equal(branchExists(p), false, "and performs nothing");
    putMarker(p, { step: "branch", pid: gone, start_ticks: 777, budget: 120 });
    const replaced = next(p, [OPUS, "--perform", "--expect", "branch"]);
    assert.equal(replaced.status, 0, ran("--perform replaces a dead marker", replaced));
    assert.match(replaced.out, /dead|replac|took over/i, ran("and says so", replaced));
    assert.equal(branchExists(p), true, "and performs the rung");

    // the verb's own /proc/self/stat obeys BISELLIUM_TEST_PROC too: a fake root with no self/stat cannot supply start_ticks, so it holds
    const own = world("b5-own-stat", "spec");
    const bare = fakeProc(own, {});
    const heldOwn = next(own, [OPUS, "--perform", "--expect", "branch"], { env: PROC_ENV(bare) });
    assert.equal(heldOwn.status, 1, ran("a fake /proc with no self/stat holds --perform", heldOwn));
    assert.equal(branchExists(own), false, "and performs nothing (the real /proc/self/stat was not used)");
    assert.equal(existsSync(markerPath(own)), false, "and writes no marker");
    const unguarded = next(own, [OPUS, "--perform", "--expect", "branch"], { clock: false, env: PROC_ENV(bare) });
    assert.equal(unguarded.status, 0, ran("without BISELLIUM_TEST_CLOCK=1 the fake root is ignored and the real /proc/self/stat is read", unguarded));
    assert.equal(branchExists(own), true);

    // a takeover of a dead marker is unlink-if-unchanged: change the marker after the verb has read it and the takeover refuses
    const race = world("b5-race", "spec");
    const raceProc = join(race.root, "proc");
    mkdirSync(join(raceProc, String(gone)), { recursive: true });
    const fifo = join(raceProc, String(gone), "stat");
    execFileSync("mkfifo", [fifo]);
    mkdirSync(join(raceProc, "self"));
    writeFileSync(join(raceProc, "self", "stat"), statLine("self", "next", "S", 31337));
    putMarker(race, { step: "branch", pid: gone, start_ticks: 111, budget: 120 });
    putOutput(race, "x\n", 10);
    const racing = nextAsync(race, [OPUS, "--perform", "--expect", "branch"], { env: PROC_ENV(raceProc) });
    let served = 0;
    const serve = (async () => {
      for (;;) {
        const fd = await Promise.race([open(fifo, "w"), racing.done.then(() => null)]);
        if (fd === null) return;
        served++;
        appendFileSync(markerPath(race), " "); // same inode, new size and mtime: changed since the verb read it
        try {
          await fd.write(statLine(gone, "x", "S", 222)); // another start time: proven dead (reused pid)
        } finally {
          await fd.close().catch(() => undefined);
        }
      }
    })();
    const raced = await racing.done;
    closeSync(openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK)); // release a writer-open still pending
    await serve;
    assert.ok(served > 0, "the verb read the dead marker's /proc entry");
    assert.equal(raced.status, 1, ran("a marker changed between the read and the unlink refuses the takeover", raced));
    assert.equal(branchExists(race), false, "and performs nothing");
    assert.ok(existsSync(markerPath(race)), "the changed marker was not unlinked");
  });
}

// ---------------------------------------------------------------------------
// behaviour 6: a dispatch is refused over the context cap and resumes from the handover artifact
// ---------------------------------------------------------------------------
const DISPATCH_TOKEN_CAP = 500_000;
function handoffAt(w: World, dir: "repo" | "wt", at: string): void {
  const studio = dir === "repo" ? w.studio : w.wtStudio;
  verb(dir === "repo" ? w.repo : w.wt, ["handoff", "--opus", OPUS, "--sella", "producer", "--next", "resume from the handover artifact", "--studio", studio, "--now", at]);
  commit(dir === "repo" ? w.repo : w.wt, `studio(${OPUS}): handoff ${at}`);
}
if (runs(6)) {
  test("W-124 behaviour 6: a dispatch is refused over the context cap, and resumes only from a fresh handover artifact", { timeout: 1_800_000 }, () => {
    const dispatch: { step: string; build: (tag: string) => World; where: "repo" | "wt"; resume: (w: World) => void }[] = [
      {
        step: "build",
        where: "wt",
        build: (tag) => world(tag, "reds"),
        resume: (w) => writeReceipt(w, "stale"),
      },
      {
        step: "spec",
        where: "repo",
        build: (tag) => world(tag, "greenlight"),
        resume: (w) => {
          verb(w.repo, ["verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "revise", "--phase", "spec", "--from", writeTranscript(w, "spec-revise.md"), "--studio", w.studio, "--now", T.spec]);
          commit(w.repo, "studio: spec revise round");
        },
      },
      {
        step: "reds",
        where: "wt",
        build: (tag) => world(tag, "ready"),
        resume: (w) => {
          writeReds(w);
          rmSync(join(w.wtStudio, "ci", "reds", OPUS, "02.log"));
          commit(w.wt, "studio: only one red so far");
        },
      },
      {
        step: "review",
        where: "wt",
        build: (tag) => world(tag, "build"),
        resume: (w) => {
          addReview(w, "failed", 1, T.review1);
          advanceSource(w);
        },
      },
    ];
    const run = (w: World, args: string[]): Out => next(w, [OPUS, ...args]);
    for (const d of dispatch) {
      const w = d.build(`b6-${d.step}`);
      handoffAt(w, d.where, T.handoffFresh);
      const over = run(w, ["--budget", String(DISPATCH_TOKEN_CAP + 1)]);
      expectStep(over, d.step, "held", `${d.step}: a budget above DISPATCH_TOKEN_CAP is held`);
      assert.equal(over.status, 1, ran(`${d.step}: over-cap exit`, over));
      assert.match(over.kv.get("why") ?? "", new RegExp(`budget ${DISPATCH_TOKEN_CAP + 1} exceeds DISPATCH_TOKEN_CAP ${DISPATCH_TOKEN_CAP}`), ran(`${d.step}: over-cap why`, over));
      assert.equal(over.kv.has("command"), false, `${d.step}: no order is printed over the cap`);

      const absent = run(w, []);
      expectStep(absent, d.step, "held", `${d.step}: an undeclared budget is held`);
      assert.equal(absent.status, 1, ran(`${d.step}: undeclared exit`, absent));
      assert.match(absent.kv.get("why") ?? "", /dispatch budget undeclared/, ran(`${d.step}: undeclared why`, absent));
      assert.equal(absent.kv.has("command"), false, `${d.step}: no order without a declared budget`);

      for (const bad of ["abc", "0", "-5", "12345678901", "1.5", "05"]) {
        const o = run(w, ["--budget", bad]);
        assert.equal(o.status, 2, ran(`${d.step}: --budget ${bad} is a usage error`, o));
        assert.equal(o.out, "", `${d.step}: --budget ${bad} prints no step line`);
        assert.notEqual(o.err, "", `${d.step}: --budget ${bad} explains itself on stderr`);
      }

      const exact = run(w, ["--budget", String(DISPATCH_TOKEN_CAP)]);
      expectStep(exact, d.step, "named", `${d.step}: exactly DISPATCH_TOKEN_CAP is named`);
      assert.equal(exact.status, 0, ran(`${d.step}: exact-cap exit`, exact));
      assert.equal(exact.kv.get("budget_tokens"), String(DISPATCH_TOKEN_CAP), ran(`${d.step}: the order carries budget_tokens`, exact));
      for (const key of ["role", "sella", "phase", "inputs", "command"]) assert.ok(exact.kv.has(key), ran(`${d.step}: the order prints ${key}:`, exact));
      assert.match(exact.kv.get("inputs") ?? "", /briefs\/W-900\.md/, ran(`${d.step}: the brief is an input`, exact));
      assert.match(exact.kv.get("inputs") ?? "", /traditio/, ran(`${d.step}: the record's traditio block is an input`, exact));
      assert.doesNotMatch(exact.out, /conversation/i, `${d.step}: nothing is taken from conversation`);
    }

    // on a non-dispatch step the flag is syntax-checked and otherwise ignored
    const plain = world("b6-plain", "spec");
    const badFlag = run(plain, ["--budget", "abc"]);
    assert.equal(badFlag.status, 2, ran("a malformed --budget is a usage error even on a non-dispatch step", badFlag));
    expectStep(run(plain, ["--budget", "1"]), "branch", "named", "a well-formed --budget is ignored on a non-dispatch step");

    // a resume needs a fresh handover artifact: missing and stale are held, fresh is named
    for (const d of dispatch) {
      const missing = d.build(`b6-resume-${d.step}-missing`);
      d.resume(missing);
      const miss = run(missing, ["--budget", "100000"]);
      expectStep(miss, d.step, "held", `${d.step}: a resume with no traditio is held`);
      assert.match(miss.out + miss.err, /stale handover: run bisellium handoff first/, ran(`${d.step}: missing traditio`, miss));
      assert.equal(miss.status, 1, ran(`${d.step}: missing exit`, miss));

      const stale = d.build(`b6-resume-${d.step}-stale`);
      handoffAt(stale, d.where, T.handoffStale);
      d.resume(stale);
      if (d.step !== "spec") {
        const o = run(stale, ["--budget", "100000"]);
        expectStep(o, d.step, "held", `${d.step}: a traditio older than the newest red/review log is held`);
        assert.match(o.out + o.err, /stale handover: run bisellium handoff first/, ran(`${d.step}: stale traditio`, o));
      }

      const fresh = d.build(`b6-resume-${d.step}-fresh`);
      d.resume(fresh);
      handoffAt(fresh, d.where, T.handoffFresh);
      const ok = run(fresh, ["--budget", "100000"]);
      expectStep(ok, d.step, "named", `${d.step}: a resume from a fresh handover artifact is named`);
      assert.equal(ok.status, 0, ran(`${d.step}: fresh resume exit`, ok));
    }
  });
}

// ---------------------------------------------------------------------------
// round-1 fix pass (censor findings 1-2, sec-lead findings 1-3): each row is its
// own test so every red shows by itself
// ---------------------------------------------------------------------------
const lines = (o: Out): string[] => o.out.split("\n");
const CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
/** A parentless commit with the opus tree: known locally, never a descendant of the reviewed head. */
const strangerCommit = (w: World): string => git(w.repo, ["commit-tree", git(w.repo, ["rev-parse", `${tipOf(w)}^{tree}`]), "-m", "not descended from the reviewed head"]);
/** A commit on top of the opus tip, pushed over the origin's opus branch (what `update-branch` would produce). */
function pushChild(w: World): string {
  const child = git(w.repo, ["commit-tree", git(w.repo, ["rev-parse", `${tipOf(w)}^{tree}`]), "-p", tipOf(w), "-m", "update-branch merge"]);
  git(w.repo, ["push", "-q", "origin", `${child}:refs/heads/${BRANCH}`]);
  return child;
}

if (runs(2)) {
  test("W-124 behaviour 2 (round-1 fix A): performing an unverifiable merged head fetches, then holds naming the oid, never pr", { timeout: 1_800_000 }, () => {
    const w = world("r1-a-perform", "merge", { mainOnMaster: false });
    const unknown = "9".repeat(40);
    scenario(w, { list: mergedList(w, { oid: unknown }) });
    const o = performMerge(w);
    expectHeld(o, "an unverifiable head is held after the fetch");
    assert.match(o.first, /^next: W-900 merge held$/, ran("it is the merge step that holds", o));
    assert.ok(o.out.includes(unknown.slice(0, 12)), ran("the hold names the unresolvable oid", o));
    assert.doesNotMatch(o.out, /next-step: pr/, ran("and it never walks back to pr", o));
    assert.deepEqual(mutating(w), ["git fetch master:master"], "no rebase, push, PR or update-branch");
    assert.equal(gitCalls(w).some((a) => a[0] === "fetch" && a.some((x) => x.includes(`refs/remotes/origin/${BRANCH}`))), true, "the opus remote-tracking ref was fetched and re-checked");
  });
}

if (runs(3)) {
  test("W-124 behaviour 3 (round-1 fix C): a BEHIND PR on another head than the reviewed pin is HEAD_MOVED with nothing mutated", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-different");
    scenario(w, { list: openList(w), view: { stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND", oid: "7".repeat(40) })) } });
    const o = performMerge(w);
    assert.match(o.out, /state=HEAD_MOVED/, ran("a BEHIND view on another oid is HEAD_MOVED", o));
    assert.equal(o.status, 1, ran("HEAD_MOVED exits 1", o));
    assert.deepEqual(mutating(w), [], "no update-branch and no merge call");
  });

  test("W-124 behaviour 3 (round-1 fix C): a head after update-branch that does not descend from the pin is HEAD_MOVED", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-diverged");
    const stranger = strangerCommit(w);
    git(w.repo, ["push", "-q", "--force", "origin", `${stranger}:refs/heads/${BRANCH}`]);
    const updated = join(w.root, "updated.flag");
    scenario(w, {
      list: openList(w),
      view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }], alts: [{ ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN", oid: stranger })) }] }] },
      update: { stdout: "", touch: updated },
    });
    const o = performMerge(w);
    assert.match(o.out, /state=HEAD_MOVED/, ran("an unrelated post-update head is HEAD_MOVED", o));
    assert.deepEqual(mutating(w), ["gh pr update-branch"], "the new head is never adopted: no merge call");
  });

  test("W-124 behaviour 3 (round-1 fix C): a head that moved while queued and does not descend from the pin is HEAD_MOVED", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-queued");
    const stranger = strangerCommit(w);
    git(w.repo, ["push", "-q", "--force", "origin", `${stranger}:refs/heads/${BRANCH}`]);
    const merged = join(w.root, "merged.flag");
    const updated = join(w.root, "updated.flag");
    scenario(w, {
      list: openList(w),
      view: {
        replies: [{ stdout: viewOf(cand(w, { state: "OPEN" })) }],
        alts: [
          { ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN", oid: stranger })) }] },
          { ifExists: merged, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }] },
        ],
      },
      update: { stdout: "", touch: updated },
      merge: { replies: [{ stdout: "", touch: merged }] },
    });
    const o = performMerge(w);
    assert.match(o.out, /state=HEAD_MOVED/, ran("a queued re-pin onto an unrelated head is HEAD_MOVED", o));
    assert.deepEqual(mutating(w), ["gh pr merge --squash --auto", "gh pr update-branch"], "no direct merge on the unreviewed head");
  });

  test("W-124 behaviour 3 (round-1 fix C): a post-update head that descends from the pin is adopted and merged", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-descends");
    const child = pushChild(w);
    const m = landMerge(w, false);
    const updated = join(w.root, "updated.flag");
    const merged = join(w.root, "merged.flag");
    scenario(w, {
      list: openList(w),
      view: {
        replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }],
        alts: [
          { ifExists: merged, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m, oid: child })) }] },
          { ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN", oid: child })) }] },
        ],
      },
      update: { stdout: "", touch: updated },
      merge: { replies: [{ stdout: "", touch: merged }] },
    });
    const o = performMerge(w);
    assert.match(o.out, /state=MERGED/, ran("a descendant head is adopted", o));
    assert.deepEqual(mutating(w), ["gh pr update-branch", "gh pr merge --squash --auto", "git fetch master:master"]);
    const call = ghMerges(w)[0] ?? [];
    assert.equal(call[call.indexOf("--match-head-commit") + 1], child, "the merge is pinned to the descendant head");
  });

  test("W-124 behaviour 3 (round-1 fix D): a failing check named with a newline or control cannot inject a state= line", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-d-check");
    const evil = "evil\nstate=MERGED\u0085state=MERGED\u001b[31m";
    const long = "n".repeat(600);
    scenario(w, { list: openList(w), checks: { stdout: [...greens(MIN_CHECKS), check(evil, "fail"), check(long, "fail")] } });
    const o = performMerge(w);
    assert.deepEqual(lines(o).filter((l) => /^\s*state=/.test(l)), ["state=CHECKS_FAILED"], ran("the only state= line is the real one", o));
    assert.doesNotMatch(o.out.replace(/\n/g, ""), CONTROLS, ran("no control character reaches the output", o));
    assert.ok(lines(o).every((l) => l.length < 260), ran("an element is clipped", o));
  });

  test("W-124 behaviour 3 (round-1 fix D): gh stderr carries no control character into the output", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-d-stderr");
    scenario(w, { list: openList(w), merge: { exit: 1, stderr: "boom\u0085state=MERGED\u001b[31m" } });
    const o = performMerge(w);
    assert.match(o.out, /state=MERGE_FAILED/, ran("the real terminal state", o));
    assert.doesNotMatch(o.out.replace(/\n/g, ""), CONTROLS, ran("gh stderr carries no control character", o));
  });

  test("W-124 behaviour 3 (round-1 fix D): an unknown PR state carries no control character into the output", { timeout: 1_800_000 }, () => {
    const odd = reviewed("r1-d-state", { mainOnMaster: false });
    scenario(odd, { list: { stdout: [{ ...cand(odd, { state: "OPEN" }), state: "OPEN\u0085state=MERGED" }] } });
    const held = next(odd, [OPUS]);
    assert.match(held.first, /held$/, ran("an unknown state is held", held));
    assert.doesNotMatch(held.out.replace(/\n/g, ""), CONTROLS, ran("the unknown-state JSON carries no control character", held));
  });
}

if (runs(6)) {
  test("W-124 behaviour 6 (round-1 fix B): a kind: ui review order lists the ui-lead input and carries --ui-input", { timeout: 1_800_000 }, () => {
    const w = world("r1-b-ui", "build");
    const prompt = "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n";
    const transcript = [
      "## Findings",
      "No findings",
      "The navigation relationships remain legible across the complete narrow viewport arrangement.",
      "## Recommendation",
      "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.",
      "Additional original observations cover focus movement responsive density and stable content grouping throughout.",
      "Verdict: passed",
      "",
    ].join("\n");
    for (const dir of ["repo", "wt"] as const)
      editRecord(w, dir, (doc) => {
        doc.setIn(["kind"], "ui");
        doc.setIn(["spec"], `briefs/${OPUS}.md`);
      });
    put(w.wtStudio, "ci/dispatch.md", prompt);
    const from = join(w.root, "ui-spec.md");
    writeFileSync(from, transcript);
    verb(w.wt, ["verdict", OPUS, "--round", "2", "--sella", "ui-lead", "--outcome", "passed", "--phase", "spec", "--dispatch-prompt", "ci/dispatch.md", "--from", from, "--studio", w.wtStudio, "--now", T.spec]);
    commit(w.wt, `studio(${OPUS}): ui-lead input`);
    put(w.studio, "ci/dispatch.md", prompt);
    put(w.studio, `ci/${OPUS}-spec-2.log`, readFileSync(join(w.wtStudio, "ci", `${OPUS}-spec-2.log`), "utf8"));
    commit(w.repo, `studio(${OPUS}): ui-lead input on the trunk`);

    const o = next(w, [OPUS, "--budget", "100000"]);
    expectStep(o, "review", "named", "a kind: ui record with a met build gate names the review dispatch");
    assert.match(o.kv.get("inputs") ?? "", new RegExp(`ci/${OPUS}-spec-2\\.log`), ran("the ui-lead input path is an input", o));
    assert.match(o.kv.get("command") ?? "", new RegExp(`--ui-input ci/${OPUS}-spec-2\\.log`), ran("the verdict command carries --ui-input", o));
    const plain = next(world("r1-b-plain", "build"), [OPUS, "--budget", "100000"]);
    expectStep(plain, "review", "named", "a plain opus review order");
    assert.doesNotMatch(plain.kv.get("command") ?? "", /--ui-input/, ran("a non-ui order carries no --ui-input", plain));
  });
}

// ---------------------------------------------------------------------------
// W-123: `done` refuses unless the opus's merge is in the fetched trunk
// ---------------------------------------------------------------------------
const WHY_LINE = `${OPUS}: done needs the PR from ${BRANCH} merged and its merge commit in the local master; run: bisellium next ${OPUS}`;
/** A bisellium verb run the way an operator would, under the stub gh and git shim. */
function cli(w: World, args: string[], cwd: string, env: Record<string, string | undefined> = {}): Out {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd, env: envFor(w, { env }), encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  return parse(r.status, r.stdout ?? "", r.stderr ?? "");
}
const eventsOf = (studio: string): string | null => (existsSync(join(studio, ".bisellium", "events.jsonl")) ? readFileSync(join(studio, ".bisellium", "events.jsonl"), "utf8") : null);
/** The row is refused: exit 1, the two exact stderr lines, and neither the record nor the event log moved. */
function expectRefused(w: World, run: () => Out, reason: { is: string } | { startsWith: string }, row: string, studio = w.wtStudio): Out {
  const recordIn = (): string => readFileSync(join(studio, "opera", `${OPUS}.md`), "utf8");
  const recordBefore = recordIn();
  const eventsBefore = eventsOf(studio);
  const o = run();
  const lines = o.err.split("\n");
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  const first = lines[0] ?? "";
  if ("is" in reason) assert.equal(first, `${OPUS}: done refused: ${reason.is}`, ran(`${row}: first stderr line`, o));
  else assert.ok(first.startsWith(`${OPUS}: done refused: ${reason.startsWith}`), ran(`${row}: first stderr line`, o));
  assert.equal(lines[1], WHY_LINE, ran(`${row}: second stderr line`, o));
  assert.equal(recordIn(), recordBefore, `${row}: the record's bytes are unchanged`);
  assert.equal(eventsOf(studio), eventsBefore, `${row}: the event log is unchanged`);
  return o;
}
/** The handoff flow: the main checkout on a branch cut from master with no upstream. */
function onHandoffBranch(w: World): void {
  git(w.repo, ["switch", "-q", "--no-track", "-c", "chore/w123-done", "master"]);
}

test("W-123 behaviour 1: done and close refuse an opus whose merge is not in the local master, and accept one whose merge is", { timeout: 1_800_000 }, () => {
  const doneArgs = (w: World): string[] => ["done", OPUS, "--sella", "producer", "--studio", w.wtStudio, "--now", T.done];
  const reviewWorld = (tag: string, merge?: (w: World) => SlotValue): World => {
    const w = world(tag, "review", { prRequired: true });
    if (merge !== undefined) scenario(w, { list: merge(w) });
    return w;
  };

  const empty = reviewWorld("w123-b1-empty");
  expectRefused(empty, () => cli(empty, doneArgs(empty), empty.wt), { is: `no MERGED PR from ${BRANCH} to master` }, "an empty list");

  const open = reviewWorld("w123-b1-open", (w) => openList(w));
  expectRefused(open, () => cli(open, doneArgs(open), open.wt), { is: `PR #${PR_NUMBER} from ${BRANCH} is OPEN, not MERGED` }, "an OPEN candidate");

  const closed = reviewWorld("w123-b1-closed", (w) => ({ stdout: [cand(w, { state: "CLOSED" })] }));
  expectRefused(closed, () => cli(closed, doneArgs(closed), closed.wt), { is: `no MERGED PR from ${BRANCH} to master` }, "a CLOSED-only candidate");

  const failing = reviewWorld("w123-b1-gh-fails", () => ({ exit: 1, stderr: "boom\n" }));
  expectRefused(failing, () => cli(failing, doneArgs(failing), failing.wt), { startsWith: "gh pr list exited 1" }, "gh pr list exits 1");

  const behind = world("w123-b1-behind", "merge", { prRequired: true, fetched: false });
  scenario(behind, { list: mergedList(behind) });
  const refusedBehind = expectRefused(behind, () => cli(behind, doneArgs(behind), behind.wt), { startsWith: "merge commit " }, "MERGED but not fetched");
  assert.ok((refusedBehind.err.split("\n")[0] ?? "").includes(behind.mergeOid!.slice(0, 12)), ran("the reason names the merge commit's first 12 characters", refusedBehind));

  const closing = reviewWorld("w123-b1-close");
  const refusedClose = expectRefused(closing, () => cli(closing, ["close", OPUS, "--studio", closing.wtStudio, "--repo", closing.wt], closing.wt), { is: `no MERGED PR from ${BRANCH} to master` }, "close with an empty list");
  assert.ok(refusedClose.err.split("\n").includes("done failed (exit 1)"), ran("close still reports done failed (exit 1)", refusedClose));

  // accepted: merged and fetched, branch and worktree gone, from the main checkout on a branch cut from master
  const merged = world("w123-b1-merged", "cleanup", { prRequired: true });
  scenario(merged, { list: mergedList(merged) });
  onHandoffBranch(merged);
  const accepted = cli(merged, ["done", OPUS, "--sella", "producer", "--studio", merged.studio, "--now", T.done], merged.repo);
  assert.equal(accepted.status, 0, ran("done accepts a merged and fetched opus", accepted));
  assert.match(recordOf(merged), /state: "?done/, "the record reads done");

  const closed2 = world("w123-b1-merged-close", "cleanup", { prRequired: true });
  scenario(closed2, { list: mergedList(closed2) });
  onHandoffBranch(closed2);
  const acceptedClose = cli(closed2, ["close", OPUS, "--studio", closed2.studio, "--repo", closed2.repo], closed2.repo);
  assert.equal(acceptedClose.status, 0, ran("close accepts a merged and fetched opus", acceptedClose));
  assert.match(recordOf(closed2), /state: "?done/, "close leaves the record done");
});

test("W-123 behaviour 2: the guard fails closed, and stays silent where no PR is required", { timeout: 1_800_000 }, () => {
  const doneArgs = (studio: string): string[] => [OPUS, "--sella", "producer", "--studio", studio, "--now", T.done];
  /** In-process runDone with stderr captured, the way lifecycle.test.ts reads it. */
  const inProcess = (studio: string, opts: Parameters<typeof runDone>[1] = {}): Out => {
    const errors: string[] = [];
    const logs: string[] = [];
    const realError = console.error;
    const realLog = console.log;
    console.error = (...a: unknown[]): void => void errors.push(a.join(" "));
    console.log = (...a: unknown[]): void => void logs.push(a.join(" "));
    try {
      const r = runDone(doneArgs(studio), opts);
      return parse(r.exitCode, logs.join("\n"), errors.join("\n"));
    } finally {
      console.error = realError;
      console.log = realLog;
    }
  };

  // no reader supplied: refused, never let through
  const noReader = world("w123-b2-no-reader", "cleanup", { prRequired: true });
  scenario(noReader, { list: mergedList(noReader) });
  expectRefused(noReader, () => inProcess(noReader.studio), { is: "no merge reader was supplied" }, "no reader", noReader.studio);

  // no git work tree: refused, and the reader (gh) is never reached
  const bare = world("w123-b2-no-git", "cleanup", { prRequired: true });
  scenario(bare, { list: mergedList(bare) });
  const outside = join(scratch("w123-b2-outside"), "studio");
  cpSync(bare.studio, outside, { recursive: true });
  expectRefused(bare, () => cli(bare, ["done", ...doneArgs(outside)], outside), { is: `${outside} is not inside a git work tree` }, "outside any git work tree", outside);
  assert.equal(ghCalls(bare).filter((a) => a[0] === "pr" && a[1] === "list").length, 0, "no gh pr list call");

  // control: where no PR is required the reader is never called
  const control = world("w123-b2-control", "cleanup");
  let reads = 0;
  const counted = inProcess(control.studio, {
    mergeRefusal: () => {
      reads++;
      return "always refuses";
    },
  });
  assert.equal(counted.status, 0, ran("no pr.required: done exits 0", counted));
  assert.equal(reads, 0, "no pr.required: the reader was called 0 times");
  assert.match(recordOf(control), /state: "?done/, "no pr.required: the record reads done");
});

// round 1 (censor): the refusal reads the opus's identity from fresh, fail-closed reads
const doneFrom = (w: World, env: Record<string, string | undefined> = {}): Out => cli(w, ["done", OPUS, "--sella", "producer", "--studio", w.studio, "--now", T.done], w.repo, env);
/** A merged-and-fetched world on the handoff branch, whose gh list is `list`. */
function mergedWorld(tag: string, list: (w: World) => SlotValue): World {
  const w = world(tag, "cleanup", { prRequired: true });
  scenario(w, { list: list(w) });
  onHandoffBranch(w);
  return w;
}

test("W-123 round-1 fix 1a: a newer CLOSED PR for the head outranks an older MERGED one", { timeout: 1_800_000 }, () => {
  const w = mergedWorld("w123-r1-newest", (x) => ({ stdout: [cand(x, { state: "CLOSED", number: PR_NUMBER + 1 }), cand(x, { state: "MERGED" })] }));
  expectRefused(w, () => doneFrom(w), { is: `no MERGED PR from ${BRANCH} to master` }, "newest PR is CLOSED", w.studio);
});

test("W-123 round-1 fix 1b: a head force-pushed after the merge is refused when the local branch is gone, and a matching remote head is accepted", { timeout: 1_800_000 }, () => {
  const stale = mergedWorld("w123-r1-force", (x) => mergedList(x));
  const side = join(scratch("w123-r1-force-side"), "c");
  git(dirname(side), ["clone", "-q", stale.origin, side]);
  git(side, ["switch", "-q", "-c", BRANCH, "origin/master"]);
  put(side, "after-merge.txt", "force-pushed after the merge\n");
  commit(side, "feat: a head the merged PR never had");
  git(side, ["push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`]);
  expectRefused(stale, () => doneFrom(stale), { startsWith: `PR #${PR_NUMBER} merged head ${stale.headOid!.slice(0, 12)} is not the remote ${BRANCH} tip` }, "remote head differs from the merged head", stale.studio);

  const same = mergedWorld("w123-r1-same", (x) => mergedList(x));
  git(same.repo, ["push", "-q", "origin", `${same.headOid!}:refs/heads/${BRANCH}`]);
  const accepted = doneFrom(same);
  assert.equal(accepted.status, 0, ran("a remote head equal to the merged head is accepted", accepted));
});

test("W-123 round-1 fix 2a: an unreadable local branch ref is an error, never an absent branch", { timeout: 1_800_000 }, () => {
  const w = mergedWorld("w123-r1-tip", (x) => mergedList(x));
  const wrapper = join(scratch("w123-r1-tip-git"), "git-real");
  writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in *"rev-parse --verify -q refs/heads/${BRANCH}") echo "fatal: simulated failure" >&2; exit 3;; esac\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  expectRefused(w, () => doneFrom(w, { GIT_STUB_REAL: wrapper }), { startsWith: `cannot read refs/heads/${BRANCH}` }, "rev-parse exits 3", w.studio);
});

test("W-123 round-1 fix 2b: an all-zero headRefOid is refused outright", { timeout: 1_800_000 }, () => {
  const w = mergedWorld("w123-r1-zero", (x) => mergedList(x, { oid: "0".repeat(40) }));
  expectRefused(w, () => doneFrom(w), { startsWith: "headRefOid is not a 40-hex commit id" }, "an all-zero headRefOid", w.studio);
});

// ---------------------------------------------------------------------------
// W-141 behaviour 1: a Patron path stops `next` before the main checkout moves
// ---------------------------------------------------------------------------
const CENSOR = ".claude/agents/censor.md";
/** The four things a refusal must leave byte-identical: HEAD and master, the index, the status and the Patron file. */
const frozen = (w: World): string =>
  [git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["ls-files", "-s"]), git(w.repo, ["status", "--porcelain"]), readFileSync(join(w.repo, CENSOR), "utf8")].join("\n--\n");
const outLines = (o: Out): string[] => o.out.split("\n");

test("W-141-b1 behaviour 1: a Patron path stops next before the main checkout moves, and names the Patron's one command", { timeout: 1_800_000 }, () => {
  // merge: the reviewed merge commit changes a Patron path
  const w = reviewed(
    "w141-b1-merge",
    { patron: true },
    (x) => {
      put(x.wt, CENSOR, "censor v2\n");
      commit(x.wt, `feat(${OPUS}): censor change`);
      writeReceipt(x, "current");
    },
    true,
  );
  const m = landMerge(w, false);
  scenario(w, { list: mergedList(w, { merge: m }) });
  expectStep(next(w, [OPUS]), "merge", "named", "the world sits at merge");
  const before = frozen(w);
  const held = performMerge(w);
  assert.equal(frozen(w), before, ran("merge: nothing is mutated (master unmoved, index, status, censor.md bytes)", held));
  expectHeld(held, "merge: held");
  assert.equal(held.status, 1, ran("merge: exit 1", held));
  const lines = outLines(held);
  const why = lines.findIndex((l) => l === `why: refusing: incoming paths belong to the Patron (${CENSOR}); the main checkout is untouched`);
  assert.notEqual(why, -1, ran("merge: the why line names the Patron path", held));
  assert.equal(lines[why + 1], `patron: git -C ${w.repo} merge --ff-only ${m}`, ran("merge: the patron line follows the why line", held));
  assert.equal(gitCalls(w).filter((a) => a[0] === "merge").length, 0, "merge: no git merge call");
  // the Patron runs that exact line, and next moves on
  const [bin, ...args] = lines[why + 1]!.slice("patron: ".length).split(" ");
  assert.equal(bin, "git");
  git(w.root, args);
  expectStep(next(w, [OPUS]), "cleanup", "named", "after the Patron's command next derives cleanup");

  // dirty: a tracked edit to a Patron path holds the branch rung and the done rung, and prints the Patron's checkout line
  const dirtyRow = (row: string, o: Out, w2: World, was: string, file = CENSOR, quoted = file): void => {
    expectHeld(o, row);
    assert.equal(frozen(w2), was, ran(`${row}: nothing is mutated`, o));
    const ls = outLines(o);
    const at = ls.indexOf("why: refusing: the working tree has tracked changes");
    assert.notEqual(at, -1, ran(`${row}: the why line`, o));
    assert.ok(ls.indexOf(`dirty: M ${file}`) > at, ran(`${row}: the dirty line follows the why line`, o));
    assert.ok(ls.indexOf(`patron: git -C ${w2.repo} checkout -- ${quoted}`) > at, ran(`${row}: the patron checkout line`, o));
  };
  const b = world("w141-b1-branch", "spec", { patron: true });
  appendFileSync(join(b.repo, CENSOR), "edit\n");
  const bBefore = frozen(b);
  dirtyRow("branch", next(b, [OPUS, "--perform", "--expect", "branch"]), b, bBefore);
  assert.equal(branchExists(b), false, "branch: no branch was cut");
  const d = world("w141-b1-done", "cleanup", { patron: true });
  scenario(d, { list: mergedList(d) });
  appendFileSync(join(d.repo, CENSOR), "edit\n");
  const dBefore = frozen(d);
  dirtyRow("done", next(d, [OPUS, "--perform", "--expect", "done"]), d, dBefore);
  assert.equal(branchExists(d, `chore/done-${OPUS}`), false, "done: no chore branch was made");

  // a path with a character outside [A-Za-z0-9/._-] is single-quoted
  const q = world("w141-b1-quote", "spec", { patron: true });
  appendFileSync(join(q.repo, ".claude/my notes.md"), "edit\n");
  dirtyRow("quoted", next(q, [OPUS, "--perform", "--expect", "branch"]), q, frozen(q), ".claude/my notes.md", "'.claude/my notes.md'");
});

// ---------------------------------------------------------------------------
// W-141 behaviour 2: done composes with verify
// ---------------------------------------------------------------------------
test("W-141-b2 behaviour 2: done composes with verify: the rung names verify first, then commits the record and verify's certificates", { timeout: 1_800_000 }, () => {
  const w = world("w141-b2", "cleanup", { automated: true });
  scenario(w, { list: mergedList(w) });
  const chore = `chore/done-${OPUS}`;
  const verify = `bisellium verify ${OPUS} --studio studio --repo .`;

  // before verify: the rung names the verify command, and a perform holds with it on a why: line
  const named = next(w, [OPUS]);
  expectStep(named, "done", "named", "no certificate: done is named");
  assert.equal(named.kv.get("command"), verify, ran("the command is verify", named));
  const refused = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(refused, "perform before verify");
  assert.ok(outLines(refused).some((l) => l.startsWith("why: ") && l.includes(verify)), ran("the why line carries the verify command", refused));
  assert.equal(branchExists(w, chore), false, "no chore/done-<id> is created");

  // run the named command, then edit the handoff
  const [bin, ...args] = verify.split(" ");
  assert.equal(bin, "bisellium");
  verb(w.repo, args);
  appendFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), "- checkpoint line\n");
  assert.match(git(w.repo, ["status", "--porcelain"]), /studio\/opera\/W-900\.md/, "verify wrote the record");
  const ready = next(w, [OPUS]);
  expectStep(ready, "done", "named", "after verify: done is named again");
  assert.equal(ready.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("the command is the perform", ready));

  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  assert.equal(done.status, 0, ran("perform exits 0", done));
  expectStep(done, "done", "performed", "done is performed over verify's outputs");
  const tip = git(w.repo, ["rev-parse", `refs/heads/${chore}`]);
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", tip]).split("\n").sort();
  assert.equal(paths.length, 3, `the commit changes three paths: ${paths.join(", ")}`);
  assert.equal(paths[0], "docs/SESSION-HANDOFF.md");
  assert.match(paths[1]!, /^studio\/ci\/W-900-tests-[0-9a-f]+\.log$/);
  assert.equal(paths[2], `studio/opera/${OPUS}.md`);
  assert.equal(git(w.repo, ["rev-list", "--count", `master..${chore}`]), "1", "one commit");
  assert.equal(git(w.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "HEAD is back on master");
  const status = git(w.repo, ["status", "--porcelain"]);
  for (const p of paths) assert.ok(!status.includes(p), `git status lists none of the three paths (${p}): ${status}`);
});

// ---------------------------------------------------------------------------
// W-141 behaviour 3: the checkpoint rides the done commit
// ---------------------------------------------------------------------------
test("W-141-b3 behaviour 3: the checkpoint rides the done commit", { timeout: 1_800_000 }, () => {
  // a done commit that changed a heading-less handoff reads complete
  const c = world("w141-b3-complete", "cleanup");
  markDone(c, false, "# Handoff\n\n- the producer's note, under no heading at all\n");
  scenario(c, { list: mergedList(c) });
  const complete = next(c, [OPUS]);
  assert.equal(complete.first, `next: ${OPUS} checkpoint complete`, ran("the done commit carried the handoff: complete, with no heading", complete));
  assert.equal(complete.status, 0, ran("complete exits 0", complete));

  // a done commit that left the handoff unchanged reads named, even when a later commit names the opus under the old heading
  const n = world("w141-b3-named", "done");
  expectStep(next(n, [OPUS]), "checkpoint", "named", "the done commit left the handoff unchanged");
  put(n.repo, "docs/SESSION-HANDOFF.md", HANDOFF_DONE);
  commit(n.repo, "chore: a later handoff edit");
  git(n.repo, ["push", "-q", "origin", "master"]);
  expectStep(next(n, [OPUS]), "checkpoint", "named", "a later edit that names the opus under the old heading does not complete it");

  // master without a handoff: complete once the record is done
  const none = world("w141-b3-none", "cleanup");
  git(none.repo, ["rm", "-q", "docs/SESSION-HANDOFF.md"]);
  commit(none.repo, "test: no handoff");
  git(none.repo, ["push", "-q", "origin", "master"]);
  markDone(none, false);
  assert.equal(next(none, [OPUS]).first, `next: ${OPUS} checkpoint complete`, "no handoff on master: complete once the record is done");

  // --perform --expect done refuses when the handoff has no tracked change; nothing is mutated
  const r = world("w141-b3-refuse", "cleanup", { patron: true });
  scenario(r, { list: mergedList(r) });
  const was = frozen(r);
  const refused = next(r, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(refused, "done without a handoff change");
  assert.ok(outLines(refused).some((l) => /^why: .*checkpoint/.test(l)), ran("the why line names the checkpoint", refused));
  assert.equal(frozen(r), was, ran("nothing is mutated", refused));
  assert.equal(branchExists(r, `chore/done-${OPUS}`), false, "no chore branch");
  touchHandoff(r);
  expectStep(next(r, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "with a handoff change the perform commits");
});

// ---------------------------------------------------------------------------
// W-141 behaviour 4: a spec signed in the main checkout is committed onto spec/<id>
// ---------------------------------------------------------------------------
/** The signed spec of a world, left uncommitted in `dir` (the way the architect leaves it). */
function signSpecUncommitted(w: World, dir: string): void {
  put(dir, "studio/briefs/W-900.md", briefText(w.behaviours));
  verb(dir, ["verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, "spec.md"), "--studio", join(dir, "studio"), "--now", T.spec]);
}
test("W-141-b4 behaviour 4: a spec signed in the main checkout is committed onto spec/<id>, and nothing else moves", { timeout: 1_800_000 }, () => {
  const w = world("w141-b4", "greenlight");
  signSpecUncommitted(w, w.repo);
  appendFileSync(join(w.repo, "README.md"), "an unrelated edit\n");
  const brief = "studio/briefs/W-900.md";
  const log = "studio/ci/W-900-spec-1.log";
  assert.match(git(w.repo, ["status", "--porcelain", "-uall"]), /\?\? studio\/briefs\/W-900\.md/, "the brief is untracked");

  const named = next(w, [OPUS]);
  expectStep(named, "spec", "named", "a spec signed in the working tree is named");
  assert.match(named.out, /why: spec signed in the working tree, not committed/, ran("the why", named));

  const master = git(w.repo, ["rev-parse", "master"]);
  const done = next(w, [OPUS, "--perform", "--expect", "spec"]);
  assert.equal(done.status, 0, ran("perform exits 0", done));
  expectStep(done, "spec", "performed", "the spec is committed");
  assert.equal(git(w.repo, ["rev-parse", "master"]), master, "master is unmoved");
  assert.equal(git(w.repo, ["rev-parse", `spec/${OPUS}^`]), master, "spec/<id> is master plus one commit");
  assert.equal(git(w.repo, ["rev-list", "--count", `master..spec/${OPUS}`]), "1");
  assert.deepEqual(git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `spec/${OPUS}`]).split("\n").sort(), [brief, log], "exactly the brief and the spec log");
  assert.match(git(w.repo, ["log", "-1", "--format=%B", `spec/${OPUS}`]), /Co-Authored-By: architect \(bisellium next\)/, "the trailer names the spec log's sella");
  assert.equal(git(w.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "HEAD is master");
  assert.equal(existsSync(join(w.repo, brief)), false, "the brief is gone from the working tree");
  assert.equal(existsSync(join(w.repo, log)), false, "the log is gone from the working tree");
  assert.match(readFileSync(join(w.repo, "README.md"), "utf8"), /an unrelated edit/, "the README edit is still there");
  assert.match(git(w.repo, ["status", "--porcelain"]), /^ ?M README\.md$/m, "and still unstaged");
  const landing = next(w, [OPUS]);
  expectStep(landing, "spec", "named", "next names the landing of spec/<id>");
  assert.match(landing.out, /why: spec signed on spec\/W-900, not on master/, ran("the landing why", landing));
});
