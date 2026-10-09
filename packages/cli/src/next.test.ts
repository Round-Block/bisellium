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
  chmodSync,
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
  lstatSync,
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
/** W-199: a git read with two valid answers, exit 0 (true) and exit 1 (false); any other exit or a spawn error throws. */
function gitYesNo(cwd: string, args: string[]): boolean {
  const r = spawnSync("git", args, { cwd, env: SETUP_ENV, encoding: "utf8", timeout: 60_000 });
  if (r.error !== undefined || (r.status !== 0 && r.status !== 1)) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.error?.message ?? r.stderr}`);
  return r.status === 0;
}

function put(dir: string, rel: string, text: string): void {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function commit(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  if (!gitYesNo(dir, ["diff", "--cached", "--quiet"])) git(dir, ["commit", "-q", "-m", message]);
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
type SlotName = "repoView" | "list" | "view" | "checks" | "rules" | "alerts" | "update" | "merge" | "create";
const SLOT_MATCH: Record<SlotName, string[]> = {
  repoView: ["repo", "view"],
  list: ["pr", "list"],
  view: ["pr", "view"],
  checks: ["pr", "checks"],
  // W-168: master's active rules. Ahead of `alerts`, whose ["api"] matches every `gh api` call.
  rules: ["api", `repos/${SLUG}/rules/branches/master?per_page=100`],
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
const STAGES = ["greenlight", "spec", "branch", "ready", "reds", "build", "review", "pr", "merge", "cleanup", "done", "retro", "checkpoint"] as const;
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
  /** W-197: the base commit tracks a `.github/` path (`.github/workflows/ci.yml`). */
  github?: boolean;
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
const headOf = (w: World): string => (gitYesNo(w.repo, ["show-ref", "--verify", "--quiet", `refs/heads/${BRANCH}`]) ? tipOf(w) : w.headOid!);
const sourceTree = (dir: string): string => `tree:${sourceTreeHash(dir, ["studio", ".bisellium"], "HEAD")}`;

function writeTranscript(w: World, name: string, body = "No findings"): string {
  const path = join(w.root, name);
  writeFileSync(path, `## Findings\n${body}\n`);
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
function addReview(w: World, outcome: "passed" | "failed", round: number, at: string, body = outcome === "failed" ? "1. blocking: fixture defect at brief:1. check: none: fixture" : "No findings"): void {
  verb(w.wt, ["verdict", OPUS, "--round", String(round), "--sella", "qa-lead", "--outcome", outcome, "--from", writeTranscript(w, `review-${round}.md`, body), "--studio", w.wtStudio, "--now", at]);
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
  if (o.github) put(w.repo, ".github/workflows/ci.yml", "name: ci\n");
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
    rules: { stdout: [] },
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
      assert.match(o.out, /^command: bisellium next W-900 --perform --expect spec$/m, ran("names next's own landing for spec/<id> (W-141)", o));
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
      assert.match(o.out, /^command: bisellium next W-900 --perform --expect done$/m, ran("names next's own landing for chore/done-<id> (W-141)", o));
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
          // W-162: a spec verdict pins the brief, so the brief must exist when it is recorded
          put(w.repo, "studio/briefs/W-900.md", briefText(w.behaviours));
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

// ---------------------------------------------------------------------------
// W-141 behaviour 5: next lands spec/<id> and chore/done-<id> through a PR
// ---------------------------------------------------------------------------
/** Write a raw gh scenario: `rules` are tried in order, first match wins (the slot builder cannot tell two `pr list` heads apart). */
function rawScenario(w: World, rules: { match: string[]; replies: Reply[]; alts?: Alt[] }[]): void {
  writeFileSync(w.scn, JSON.stringify({ rules }));
  rmSync(`${w.scn}.state`, { force: true });
  rmSync(w.log, { force: true });
}
/** The gh world of landing `head`: a PR that is created (or already OPEN), merges on request, and then reads MERGED. */
function landingScenario(w: World, head: string, o: { open: boolean; checks?: Json[]; opusMerged?: boolean }): { merged: string } {
  const created = join(w.root, "created.flag");
  const merged = join(w.root, "merged.flag");
  const oid = git(w.repo, ["rev-parse", `refs/heads/${head}`]);
  const m = git(w.repo, ["commit-tree", `${head}^{tree}`, "-p", "master", "-m", `squash ${head} (#${PR_NUMBER})`]);
  git(w.repo, ["push", "-q", "origin", `${m}:refs/heads/master`]);
  const open = cand(w, { state: "OPEN", head, oid });
  const done = cand(w, { state: "MERGED", head, oid, merge: m });
  const std = (slot: SlotName): { match: string[]; replies: Reply[]; alts?: Alt[] } => ({ match: SLOT_MATCH[slot], ...asRule(slot === "checks" ? { stdout: o.checks ?? greens() } : slot === "view" ? { stdout: viewOf(open) } : slot === "create" ? { stdout: `https://github.com/${SLUG}/pull/${PR_NUMBER}\n`, touch: created } : slot === "merge" ? { stdout: "", touch: merged } : slot === "alerts" || slot === "rules" ? { stdout: [] } : slot === "repoView" ? { stdout: { nameWithOwner: SLUG } } : { stdout: "" }) });
  rawScenario(w, [
    ...(o.opusMerged ? [{ match: ["pr", "list", "--head", BRANCH], replies: [{ stdout: [cand(w, { state: "MERGED" })] }] }] : []),
    {
      match: ["pr", "list", "--head", head],
      replies: [{ stdout: o.open ? [open] : [] }],
      alts: [{ ifExists: merged, replies: [{ stdout: [done] }] }, ...(o.open ? [] : [{ ifExists: created, replies: [{ stdout: [open] }] }])],
    },
    { match: ["pr", "list"], replies: [{ stdout: [] }] },
    { match: ["pr", "view"], replies: [{ stdout: viewOf(open) }], alts: [{ ifExists: merged, replies: [{ stdout: viewOf(done) }] }] },
    std("repoView"),
    std("checks"),
    std("rules"),
    std("alerts"),
    std("update"),
    std("merge"),
    std("create"),
  ]);
  return { merged };
}
const originHas = (w: World, head: string): boolean => git(w.origin, ["for-each-ref", `refs/heads/${head}`]) !== "";

test("W-141-b5 behaviour 5: next lands spec/<id> and chore/done-<id> through a PR, as it lands an opus", { timeout: 1_800_000 }, () => {
  const specHead = `spec/${OPUS}`;
  // spec head: no PR yet, so one is created
  const s = world("w141-b5-spec", "greenlight");
  signSpecUncommitted(s, s.repo);
  expectStep(next(s, [OPUS, "--perform", "--expect", "spec"]), "spec", "performed", "the spec is committed first");
  landingScenario(s, specHead, { open: false });
  const subject = git(s.repo, ["log", "-1", "--format=%s", specHead]);
  const body = git(s.repo, ["log", "-1", "--format=%b", specHead]);
  const landed = next(s, [OPUS, "--perform", "--expect", "spec", ...FAST]);
  const creates = ghCalls(s).filter((a) => a[0] === "pr" && a[1] === "create");
  assert.equal(creates.length, 1, ran("one gh pr create call", landed));
  const arg = (a: string[], flag: string): string | undefined => a[a.indexOf(flag) + 1];
  assert.equal(arg(creates[0]!, "--title"), subject, "the PR title is the head commit's subject");
  assert.equal(arg(creates[0]!, "--body"), body, "the PR body is the head commit's body");
  assert.equal(arg(creates[0]!, "--head"), specHead);
  assert.equal(landed.status, 0, ran("landing exits 0", landed));
  expectStep(landed, "spec", "performed", "the spec head is landed");
  assert.deepEqual(mutating(s), ["git push --force-with-lease", "gh pr create", "gh pr merge --squash --auto", "git fetch master:master", "git merge --ff-only"], "push, create, merge, fetch, in order");
  const pushes = gitCalls(s).filter((a) => a[0] === "push");
  assert.ok(pushes.every((a) => !a.includes("-u") && !a.includes("--set-upstream")), "no -u");
  assert.deepEqual(pushes[0], ["push", "-q", "--force-with-lease", "origin", specHead], "the head is pushed with --force-with-lease");
  assert.ok(pushes.some((a) => a.includes("--delete") && a.some((x) => x.startsWith(`--force-with-lease=refs/heads/${specHead}:`))), "the remote head is deleted, leased to the PR head");
  assert.equal(branchExists(s, specHead), false, "the local head is deleted");
  assert.equal(originHas(s, specHead), false, "the remote head is deleted");
  assert.ok(existsSync(join(s.repo, "studio/briefs/W-900.md")), "master now carries the brief");
  expectStep(next(s, [OPUS]), "branch", "named", "next reads branch");

  // done head: an OPEN PR is reused, and the checkpoint rides along
  const d = world("w141-b5-done", "cleanup");
  scenario(d, { list: mergedList(d) });
  touchHandoff(d);
  expectStep(next(d, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the done commit is made first");
  const chore = `chore/done-${OPUS}`;
  landingScenario(d, chore, { open: true, opusMerged: true });
  const choreSubject = git(d.repo, ["log", "-1", "--format=%s", chore]);
  expectStep(next(d, [OPUS]), "done", "named", "next names the landing of chore/done-<id>");
  const doneLanded = next(d, [OPUS, "--perform", "--expect", "done", ...FAST]);
  assert.equal(ghCalls(d).filter((a) => a[0] === "pr" && a[1] === "create").length, 0, ran("an OPEN PR is reused: no gh pr create", doneLanded));
  assert.equal(ghCalls(d).filter((a) => a[0] === "pr" && a[1] === "merge" && a.includes("--squash") && a.includes("--auto")).length, 1, "merged with --squash --auto");
  assert.equal(doneLanded.status, 0, ran("done landing exits 0", doneLanded));
  assert.equal(branchExists(d, chore), false, "the local chore head is deleted");
  assert.equal(originHas(d, chore), false, "the remote chore head is deleted");
  assert.equal(git(d.repo, ["log", "-1", "--format=%s", "master"]), `squash ${chore} (#${PR_NUMBER})`, "master fast-forwarded to the squash commit");
  assert.ok(choreSubject.includes(OPUS));
  assert.equal(next(d, [OPUS]).first, `next: ${OPUS} checkpoint complete`, "the done head carried the handoff: complete");

  // mergeGate's rules apply: a failing check holds, merges nothing and deletes nothing
  const f = world("w141-b5-fail", "greenlight");
  signSpecUncommitted(f, f.repo);
  next(f, [OPUS, "--perform", "--expect", "spec"]);
  landingScenario(f, specHead, { open: false, checks: [...greens(MIN_CHECKS), check("lint", "fail")] });
  const failed = next(f, [OPUS, "--perform", "--expect", "spec", ...FAST]);
  expectHeld(failed, "a failing check");
  assert.match(failed.out, /state=CHECKS_FAILED/, ran("CHECKS_FAILED", failed));
  assert.equal(ghMerges(f).length, 0, "no merge");
  assert.equal(branchExists(f, specHead), true, "the head stays");

  // a head that changes a path outside the officina and docs/ is refused before the push, with no gh call
  const o = world("w141-b5-outside", "greenlight", { specOn: "spec-branch" });
  git(o.repo, ["switch", "-q", specHead]);
  put(o.repo, "source.txt", "changed outside the officina\n");
  commit(o.repo, "feat: touch the source");
  git(o.repo, ["switch", "-q", "master"]);
  expectStep(next(o, [OPUS]), "spec", "named", "the spec head is named");
  const refused = next(o, [OPUS, "--perform", "--expect", "spec", ...FAST]);
  expectHeld(refused, "an outside path");
  assert.match(refused.out, /why: .*source\.txt/, ran("the refusal names the path", refused));
  assert.equal(ghCalls(o).length, 0, "no gh call is made");
  assert.deepEqual(mutating(o), [], "nothing is pushed");
  assert.equal(originHas(o, specHead), false, "the head never reached origin");
});

// ---------------------------------------------------------------------------
// W-141 review round 1: the rows the censor named
// ---------------------------------------------------------------------------
/** Every ref with its object: a refusal must leave all of them (master and origin/master included) untouched. */
const refsOf = (w: World): string => git(w.repo, ["for-each-ref", "--format=%(refname) %(objectname)"]);
/** A real-git wrapper (for GIT_STUB_REAL) that fails any call whose arguments contain one of `needles`. */
function failingGit(tag: string, needles: string[]): string {
  const wrapper = join(scratch(`${tag}-git`), "git-real");
  const arms = needles.map((n) => `*"${n}"*) echo "fatal: simulated failure" >&2; exit 1;;`).join("\n");
  writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in\n${arms}\nesac\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  return wrapper;
}
const stagedPaths = (w: World): string => git(w.repo, ["diff", "--cached", "--name-only"]);

test("W-141-b1 round 1: the Patron preflight runs before any fetch moves a ref, master checked out or not", { timeout: 1_800_000 }, () => {
  for (const checkedOut of [false, true]) {
    const label = checkedOut ? "master checked out" : "master unchecked out";
    const w = reviewed(
      `w141-r1-b1-${checkedOut}`,
      { patron: true, mainOnMaster: checkedOut },
      (x) => {
        put(x.wt, CENSOR, "censor v2\n");
        commit(x.wt, `feat(${OPUS}): censor change`);
        writeReceipt(x, "current");
      },
      true,
    );
    const m = landMerge(w, false);
    scenario(w, { list: mergedList(w, { merge: m }) });
    const before = refsOf(w);
    const held = performMerge(w);
    expectHeld(held, `${label}: held`);
    assert.equal(refsOf(w), before, ran(`${label}: every ref is unchanged (master and origin/master included)`, held));
    assert.ok(
      outLines(held).some((l) => l.startsWith("why: refusing: incoming paths belong to the Patron")),
      ran(`${label}: the Patron refusal`, held),
    );
    const patron = outLines(held).find((l) => l.startsWith("patron: "));
    assert.ok(patron !== undefined, ran(`${label}: a patron line`, held));
    // the printed command, run as given, lets next move on
    const [, ...args] = patron!.slice("patron: ".length).split(" ");
    git(w.root, args);
    expectStep(next(w, [OPUS]), "cleanup", "named", `${label}: after the Patron's command next derives cleanup`);
  }
});

test("W-141-b1 round 1: a staged rename out of .claude/ is a Patron change", { timeout: 1_800_000 }, () => {
  const w = world("w141-r1-b1-rename", "spec", { patron: true });
  git(w.repo, ["mv", CENSOR, "docs/censor.md"]);
  const was = [git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["status", "--porcelain"])].join("\n");
  const held = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(held, "branch with a staged rename out of .claude/");
  assert.equal([git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["status", "--porcelain"])].join("\n"), was, ran("nothing is mutated", held));
  const lines = outLines(held);
  assert.ok(lines.some((l) => l.startsWith("dirty: R")), ran("the rename is a dirty line", held));
  const patron = lines.find((l) => l.startsWith("patron: "));
  assert.ok(patron?.includes(CENSOR), ran("the patron line names the original path", held));
  const [, ...args] = patron!.slice("patron: ".length).split(" ");
  git(w.root, args);
  assert.equal(readFileSync(join(w.repo, CENSOR), "utf8"), "censor v1\n", "the printed command restores the Patron file");
});

/** A done world (merged, fetched, cleaned up) of an automated opus whose main-checkout record carries `gates`. */
function certifiedWorld(tag: string, kind: "opus" | "ui", gates: Record<string, { certifies: (tree: string) => string; hex: string }>): World {
  const w = world(tag, "cleanup", { automated: true });
  scenario(w, { list: mergedList(w) });
  const tree = sourceTree(w.repo);
  if (kind === "ui") editRecord(w, "repo", (doc) => doc.setIn(["kind"], "ui"));
  editRecord(w, "repo", (doc) => {
    for (const [id, g] of Object.entries(gates)) doc.setIn(["probationes", id], { status: "passed", evidence: `ci/${OPUS}-${id}-${g.hex}.log`, certifies: g.certifies(tree) });
  });
  return w;
}
const VERIFY = `bisellium verify ${OPUS} --studio studio --repo .`;

test("W-141-b2 round 1: a UI opus's implicit served-e2e gate counts toward certificate readiness", { timeout: 1_800_000 }, () => {
  const w = certifiedWorld("w141-r1-b2-ui", "ui", { tests: { certifies: (t) => t, hex: "aaa111" } });
  const tree = sourceTree(w.repo);
  const missing = next(w, [OPUS]);
  expectStep(missing, "done", "named", "ui opus with no served-e2e certificate");
  assert.equal(missing.kv.get("command"), VERIFY, ran("the rung names verify", missing));
  editRecord(w, "repo", (doc) => doc.setIn(["probationes", "served-e2e"], { status: "passed", evidence: `ci/${OPUS}-served-e2e-bbb222.log`, certifies: tree }));
  put(w.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  put(w.repo, `studio/ci/${OPUS}-served-e2e-bbb222.log`, "served e2e log\n");
  const ready = next(w, [OPUS]);
  assert.equal(ready.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("with both certificates the rung is the perform", ready));
});

test("W-141-b2 round 1: the done commit stages each gate's recorded evidence, never another matching log", { timeout: 1_800_000 }, () => {
  const w = world("w141-r1-b2-logs", "cleanup", { automated: true });
  // a second automated gate, declared in the manifest as a UI opus's implicit one would be
  put(w.studio, "bisellium.yml", readFileSync(join(w.studio, "bisellium.yml"), "utf8").replace("source_excludes:", '  - { id: served-e2e, name: Served e2e, kind: automated, command: "node scripts/served-e2e.mjs" }\nsource_excludes:'));
  commit(w.repo, "test: a second automated gate");
  git(w.repo, ["push", "-q", "origin", "master"]);
  scenario(w, { list: mergedList(w) });
  const tree = sourceTree(w.repo);
  editRecord(w, "repo", (doc) => {
    doc.setIn(["probationes", "tests"], { status: "passed", evidence: `ci/${OPUS}-tests-aaa111.log`, certifies: tree });
    doc.setIn(["probationes", "served-e2e"], { status: "passed", evidence: `ci/${OPUS}-served-e2e-bbb222.log`, certifies: tree });
  });
  put(w.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  put(w.repo, `studio/ci/${OPUS}-served-e2e-bbb222.log`, "served e2e log\n");
  put(w.repo, `studio/ci/${OPUS}-tests-0badcafe.log`, "an unrelated, filename-shaped log\n");
  touchHandoff(w);
  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  assert.equal(done.status, 0, ran("perform exits 0", done));
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/chore/done-${OPUS}`]).split("\n").sort();
  assert.deepEqual(paths, ["docs/SESSION-HANDOFF.md", `studio/ci/${OPUS}-served-e2e-bbb222.log`, `studio/ci/${OPUS}-tests-aaa111.log`, `studio/opera/${OPUS}.md`], "both gates' recorded logs ride, and only those");
  assert.match(git(w.repo, ["status", "--porcelain", "-uall"]), /\?\? studio\/ci\/W-900-tests-0badcafe\.log/, "the unrelated matching log is not committed");
});

test("W-141-b2 round 1: a stale or dirty certificate is not a certificate", { timeout: 1_800_000 }, () => {
  for (const [row, certifies] of [
    ["a tree: value of another tree", () => `tree:${"0".repeat(40)}`],
    ["a dirty: value of this tree", (t: string) => `dirty:${t.slice(5)}`],
  ] as const) {
    const w = certifiedWorld(`w141-r1-b2-${row.split(" ")[1]}`, "opus", { tests: { certifies, hex: "aaa111" } });
    const o = next(w, [OPUS]);
    expectStep(o, "done", "named", row);
    assert.equal(o.kv.get("command"), VERIFY, ran(`${row}: the rung names verify`, o));
    const held = next(w, [OPUS, "--perform", "--expect", "done"]);
    expectHeld(held, `${row}: perform`);
    assert.ok(outLines(held).some((l) => l.startsWith("why: ") && l.includes(VERIFY)), ran(`${row}: the why line names verify`, held));
  }
});

test("W-141-b2 round 1: a failed done commit or switch-back never leaves the main checkout half-moved or reports success", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  // the commit fails: master is restored with nothing staged, no chore head
  const c = world("w141-r1-b2-commit", "cleanup");
  scenario(c, { list: mergedList(c) });
  touchHandoff(c);
  const failed = next(c, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r1-b2-commit", ["commit -q -m chore(studio): mark"]) } });
  expectHeld(failed, "done with a failing commit");
  assert.equal(git(c.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", ran("HEAD is back on master", failed));
  assert.equal(stagedPaths(c), "", ran("nothing is staged on master", failed));
  assert.equal(branchExists(c, chore), false, "no chore head is left");

  // the switch back fails after a good commit: the rung holds, it never reports success off master
  const s = world("w141-r1-b2-switch", "cleanup");
  scenario(s, { list: mergedList(s) });
  touchHandoff(s);
  const stuck = next(s, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r1-b2-switch", ["switch -q master"]) } });
  expectHeld(stuck, "done with a failing switch back");
  assert.match(stuck.out, /why: .*master/, ran("the why names the failed switch", stuck));
});

test("W-141-b4 round 1: a failed spec commit or switch-back never carries staged files onto master or reports success", { timeout: 1_800_000 }, () => {
  const head = `spec/${OPUS}`;
  const c = world("w141-r1-b4-commit", "greenlight");
  signSpecUncommitted(c, c.repo);
  const failed = next(c, [OPUS, "--perform", "--expect", "spec"], { env: { GIT_STUB_REAL: failingGit("w141-r1-b4-commit", ["commit -q -m spec(W-900)"]) } });
  expectHeld(failed, "spec with a failing commit");
  assert.equal(git(c.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", ran("HEAD is master", failed));
  assert.equal(stagedPaths(c), "", ran("nothing is staged on master", failed));
  assert.equal(branchExists(c, head), false, "no spec head is left");
  assert.ok(existsSync(join(c.repo, "studio/briefs/W-900.md")), "the brief is still in the working tree");

  const s = world("w141-r1-b4-switch", "greenlight");
  signSpecUncommitted(s, s.repo);
  const stuck = next(s, [OPUS, "--perform", "--expect", "spec"], { env: { GIT_STUB_REAL: failingGit("w141-r1-b4-switch", ["switch -q master"]) } });
  expectHeld(stuck, "spec with a failing switch back");
  assert.match(stuck.out, /why: .*master/, ran("the why names the failed switch", stuck));
});

// ---------------------------------------------------------------------------
// W-141 review round 2: the classes the censor named, closed whole
// ---------------------------------------------------------------------------
const fetchHead = (w: World): string => (existsSync(join(w.repo, ".git/FETCH_HEAD")) ? readFileSync(join(w.repo, ".git/FETCH_HEAD"), "utf8") : "(absent)");

test("W-141-b1 round 2: the Patron preflight mutates nothing: no ref, no tag, no FETCH_HEAD, and every indeterminate target refuses", { timeout: 1_800_000 }, () => {
  const build = (tag: string, merge?: (w: World, m: string) => string): { w: World; held: () => Out } => {
    const w = reviewed(
      tag,
      { patron: true, mainOnMaster: false },
      (x) => {
        put(x.wt, CENSOR, "censor v2\n");
        commit(x.wt, `feat(${OPUS}): censor change`);
        writeReceipt(x, "current");
      },
      true,
    );
    const m = landMerge(w, false);
    // a tag on origin that a bare `git fetch origin <oid>` would follow
    git(w.origin, ["tag", "v-r2", m]);
    scenario(w, { list: mergedList(w, { merge: merge === undefined ? m : merge(w, m) }) });
    return { w, held: () => performMerge(w) };
  };
  const state = (w: World): string => [refsOf(w), git(w.repo, ["tag"]), fetchHead(w)].join("\n--\n");

  // the Patron stop: nothing is written, not even FETCH_HEAD or the tag
  const stop = build("w141-r2-b1-stop");
  const before = state(stop.w);
  const held = stop.held();
  expectHeld(held, "Patron stop");
  assert.match(held.out, /why: refusing: incoming paths belong to the Patron/, ran("the Patron refusal", held));
  assert.equal(state(stop.w), before, ran("refs, tags and FETCH_HEAD are all unchanged", held));

  // an absent target, a tag object that merely peels to a commit and a tree id each refuse with nothing written
  const absent = build("w141-r2-b1-absent", () => "1".repeat(40));
  const absentBefore = state(absent.w);
  const a = absent.held();
  expectHeld(a, "an absent target");
  assert.equal(state(absent.w), absentBefore, ran("an absent target: nothing written", a));

  const peel = build("w141-r2-b1-peel", (w, m) => {
    const body = `object ${m}\ntype commit\ntag peel\ntagger t <t@example.com> 1700000000 +0000\n\nm\n`;
    return spawnSync("git", ["hash-object", "-t", "tag", "-w", "--stdin"], { cwd: w.repo, env: SETUP_ENV, encoding: "utf8", input: body }).stdout.trim();
  });
  const peelBefore = state(peel.w);
  const p = peel.held();
  expectHeld(p, "a tag object");
  assert.equal(state(peel.w), peelBefore, ran("a tag object that peels to the commit: refs, tags and FETCH_HEAD unchanged", p));

  const tree = build("w141-r2-b1-tree", (w) => git(w.repo, ["rev-parse", "master^{tree}"]));
  const treeBefore = state(tree.w);
  const t = tree.held();
  expectHeld(t, "a tree id");
  assert.equal(state(tree.w), treeBefore, ran("a tree id: refs, tags and FETCH_HEAD unchanged", t));
});

test("W-141-b1 round 2: a rename or copy into .claude/ is a Patron change", { timeout: 1_800_000 }, () => {
  const w = world("w141-r2-b1-into", "spec", { patron: true });
  git(w.repo, ["mv", "README.md", ".claude/readme.md"]);
  const held = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(held, "branch with a staged rename into .claude/");
  const lines = outLines(held);
  assert.ok(
    lines.some((l) => l.startsWith("dirty: R README.md -> .claude/readme.md")),
    ran("the rename is a dirty line", held),
  );
  const patron = lines.filter((l) => l.startsWith("patron: "));
  assert.ok(
    patron.some((l) => l.includes(".claude/readme.md")),
    ran("a patron line names the destination", held),
  );
  for (const l of patron) git(w.root, l.slice("patron: ".length).split(" ").slice(1));
  assert.equal(git(w.repo, ["ls-files", ".claude/readme.md"]), "", "the printed command takes the destination out of the index");

  // a copy: status reports it as C when copy detection is on
  const c = world("w141-r2-b1-copy", "spec", { patron: true });
  git(c.repo, ["config", "status.renames", "copies"]);
  appendFileSync(join(c.repo, "README.md"), "edit\n");
  put(c.repo, ".claude/copy.md", readFileSync(join(c.repo, "README.md"), "utf8"));
  git(c.repo, ["add", "README.md", ".claude/copy.md"]);
  assert.match(git(c.repo, ["status", "--porcelain"]), /^C /m, "the fixture reports a copy");
  const heldCopy = next(c, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(heldCopy, "branch with a staged copy into .claude/");
  assert.ok(
    outLines(heldCopy).some((l) => l.startsWith("patron: ") && l.includes(".claude/copy.md")),
    ran("a patron line names the copy's destination", heldCopy),
  );
});

test("W-141-b2 round 2: readiness judges the working record: a valid trunk certificate never masks a stale or dirty one, and kind drift is judged by the stricter kind", { timeout: 1_800_000 }, () => {
  // a valid certificate committed on the trunk, a stale one in the working record
  const w = certifiedWorld("w141-r2-b2-mask", "opus", { tests: { certifies: (t) => t, hex: "aaa111" } });
  put(w.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  commit(w.repo, "test: the certificate rides the trunk");
  editRecord(w, "repo", (doc) => doc.setIn(["probationes", "tests", "certifies"], `tree:${"0".repeat(40)}`));
  const masked = next(w, [OPUS]);
  expectStep(masked, "done", "named", "stale working certificate");
  assert.equal(masked.kv.get("command"), VERIFY, ran("the stale working record is not masked by the trunk's", masked));
  const heldPerform = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(heldPerform, "perform with a stale working record");

  // kind drift: ui on the trunk (with the ui-lead's input, so the ladder is past spec), opus in the working record
  const d = certifiedWorld("w141-r2-b2-drift", "opus", {});
  put(d.studio, "ci/dispatch.md", "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n");
  const from = join(d.root, "ui-spec.md");
  writeFileSync(from, ["## Findings", "No findings", "The navigation relationships remain legible across the complete narrow viewport arrangement.", "## Recommendation", "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.", "Additional original observations cover focus movement responsive density and stable content grouping throughout.", "Verdict: passed", ""].join("\n"));
  editRecord(d, "repo", (doc) => {
    doc.setIn(["kind"], "ui");
    doc.setIn(["spec"], `briefs/${OPUS}.md`);
  });
  verb(d.repo, ["verdict", OPUS, "--round", "2", "--sella", "ui-lead", "--outcome", "passed", "--phase", "spec", "--dispatch-prompt", "ci/dispatch.md", "--from", from, "--studio", d.studio, "--now", T.spec]);
  commit(d.repo, "test: the record is ui on the trunk");
  const tree = sourceTree(d.repo);
  put(d.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  editRecord(d, "repo", (doc) => {
    doc.setIn(["kind"], "opus");
    doc.setIn(["probationes", "tests"], { status: "passed", evidence: `ci/${OPUS}-tests-aaa111.log`, certifies: tree });
  });
  const drift = next(d, [OPUS]);
  expectStep(drift, "done", "named", "kind drift ui -> opus");
  assert.equal(drift.kv.get("command"), VERIFY, ran("the stricter kind's gates are required", drift));
});

test("W-141-b2 round 2: readiness validates each gate's recorded evidence file, and refuses any it cannot read or list", { timeout: 1_800_000 }, () => {
  const certified = (tag: string, evidenceName = "aaa111"): World => {
    const w = certifiedWorld(tag, "opus", { tests: { certifies: (t) => t, hex: evidenceName } });
    return w;
  };
  // the record cites a log that exists nowhere
  const missing = certified("w141-r2-b2-missing");
  const m = next(missing, [OPUS]);
  expectStep(m, "done", "named", "evidence file missing");
  assert.equal(m.kv.get("command"), VERIFY, ran("a missing log is not certified", m));
  touchHandoff(missing);
  expectHeld(next(missing, [OPUS, "--perform", "--expect", "done"]), "perform with a missing log");
  assert.equal(branchExists(missing, `chore/done-${OPUS}`), false, "no chore head");

  // the record cites a path that is not `ci/<id>-<gate>-<hex>.log`
  const odd = certified("w141-r2-b2-odd");
  editRecord(odd, "repo", (doc) => doc.setIn(["probationes", "tests", "evidence"], "../README.md"));
  const o = next(odd, [OPUS]);
  assert.equal(o.kv.get("command"), VERIFY, ran("a malformed evidence path is not certified", o));

  // a good untracked log, but `git ls-files` fails: the omission is a refusal, not a silent skip
  const fine = certified("w141-r2-b2-lsfiles");
  put(fine.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  touchHandoff(fine);
  const failed = next(fine, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r2-b2-lsfiles", ["ls-files"]) } });
  expectHeld(failed, "perform with ls-files failing");
  assert.equal(branchExists(fine, `chore/done-${OPUS}`), false, "no chore head");
  assert.equal(git(fine.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "HEAD stays on master");
  // and with ls-files working, the same world performs
  expectStep(next(fine, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the same world performs once git can list");
});

test("W-141-b2 round 2: a failed unstage keeps the branch and HEAD on it, never carrying staged files onto master", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  const c = world("w141-r2-b2-restore", "cleanup");
  scenario(c, { list: mergedList(c) });
  touchHandoff(c);
  const failed = next(c, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r2-b2-restore", ["commit -q -m chore(studio): mark", "restore -q --staged"]) } });
  expectHeld(failed, "done with failing commit and restore");
  assert.equal(git(c.repo, ["symbolic-ref", "HEAD"]), `refs/heads/${chore}`, ran("HEAD stays on the chore branch", failed));
  assert.equal(branchExists(c, chore), true, "the recovery branch is kept");
  assert.match(failed.out, /restore --staged/, ran("the why names the recovery command", failed));
  assert.match(failed.out, /switch master/, ran("and the switch back", failed));

  const head = `spec/${OPUS}`;
  const s = world("w141-r2-b4-restore", "greenlight");
  signSpecUncommitted(s, s.repo);
  const stuck = next(s, [OPUS, "--perform", "--expect", "spec"], { env: { GIT_STUB_REAL: failingGit("w141-r2-b4-restore", ["commit -q -m spec(W-900)", "restore -q --staged"]) } });
  expectHeld(stuck, "spec with failing commit and restore");
  assert.equal(git(s.repo, ["symbolic-ref", "HEAD"]), `refs/heads/${head}`, ran("HEAD stays on the spec branch", stuck));
  assert.equal(branchExists(s, head), true, "the recovery branch is kept");
  assert.match(stuck.out, /restore --staged/, ran("the why names the recovery command", stuck));
});

// ---------------------------------------------------------------------------
// W-137 behaviour 4: next names the retro after done and holds every new start until it is filed
// ---------------------------------------------------------------------------
const OTHER = "W-901";
/** A second opus, greenlit and specced on master, with no branch: the next one that would start. */
function addSpecced(w: World): void {
  put(w.studio, `opera/${OTHER}.md`, recordText({ id: OTHER, state: "greenlit", probationes: {} }));
  put(w.repo, `studio/briefs/${OTHER}.md`, briefText(w.behaviours).replace(`# ${OPUS}`, `# ${OTHER}`));
  verb(w.repo, ["verdict", OTHER, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, "spec-other.md"), "--studio", w.studio, "--now", T.spec]);
  commit(w.repo, `spec(${OTHER}): signed`);
  git(w.repo, ["push", "-q", "origin", "master"]);
}
/** Expect `next: W-901 <step> <status>` as the first stdout line. */
function expectOther(o: Out, step: string, status: string, row: string): void {
  assert.equal(o.first, `next: ${OTHER} ${step} ${status}`, ran(row, o));
}
function setRetro(w: World, line: string): void {
  appendFileSync(join(w.studio, "bisellium.yml"), `${line}\n`);
  commit(w.repo, "test: retro setting");
  git(w.repo, ["push", "-q", "origin", "master"]);
}
test("W-137-b4 behaviour 4: next names the retro after done and holds every new start until it is filed", { timeout: 1_800_000 }, () => {
  const w = world("w137-b4", "done");
  addSpecced(w);
  setRetro(w, "retro: { since: 2026-10-01T00:00:00Z }");

  const named = next(w, [OPUS]);
  expectStep(named, "retro", "named", "a done opus whose retro is owed names the retro");
  assert.match(named.out, /^command: bisellium retro --opus W-900 --from <triage\.json> --studio /m, ran("the retro command", named));
  assert.match(named.out, /^actor: producer$/m, ran("the producer files it", named));

  const held = next(w, [OTHER]);
  expectOther(held, "branch", "held", "a new start holds at branch while a retro is owed");
  assert.match(held.out, /retro owed: W-900; file them before a new opus starts/, ran("the hold names the owed opus", held));

  put(w.studio, "acta/2026-10-06-retro-W-900.md", `---\nauthor: producer\nkind: decision\ntitle: "Retro W-900"\nat: 2026-10-06T13:00:00Z\nopus: W-900\n---\nFiled.\n`);
  commit(w.repo, "chore(studio): retro W-900 filed");
  git(w.repo, ["push", "-q", "origin", "master"]);
  expectStep(next(w, [OPUS]), "checkpoint", "named", "once the retro is filed the ladder goes on to the checkpoint");
  expectOther(next(w, [OTHER]), "branch", "named", "and the next opus may start");

  const none = world("w137-b4-none", "done");
  addSpecced(none);
  expectStep(next(none, [OPUS]), "checkpoint", "named", "with no retro key the done opus goes straight to the checkpoint");
  expectOther(next(none, [OTHER]), "branch", "named", "with no retro key a new start is named as today");

  const bad = world("w137-b4-bad", "done");
  addSpecced(bad);
  setRetro(bad, 'retro: { since: "soon" }');
  const badDone = next(bad, [OPUS]);
  expectStep(badDone, "retro", "held", "a malformed retro setting holds the retro step");
  assert.match(badDone.out, /since/, ran("and names the setting", badDone));
  const badNew = next(bad, [OTHER]);
  expectOther(badNew, "branch", "held", "a malformed retro setting holds a new start");
  assert.match(badNew.out, /since/, ran("and names the setting", badNew));
});

// ---------------------------------------------------------------------------
// W-162: spec review before build. With `spec_reviewer` set, `next` names no
// `branch` until one recorded Codex review has passed after the architect's
// newest signature. Rows are selectable with --test-name-pattern=W-162-b<n>.
// ---------------------------------------------------------------------------
const SR = "spec-reviewer";
const SR_MODEL = "gpt-5.6-sol";
const SR_ROW = `  - { id: ${SR}, collegium: qa, kind: agent, model: ${SR_MODEL}, harness: codex }`;
const QA_ROW = "  - { id: qa-lead, collegium: qa, kind: agent }";
const ARCHITECT_ROW = "  - { id: architect, collegium: design, kind: agent }";
const BUDGET = ["--budget", "100000"];
const NO_FINDINGS = "## Findings\nNo findings\n";
const BLOCKER = "## Findings\n1. blocking brief:7 the Input domain omits a record it reads. check: none: no rule\n";
const BRIEF_REL = "studio/briefs/W-900.md";
const specLog = (n: number): string => `studio/ci/${OPUS}-spec-${n}.log`;

interface SrOpts {
  /** The reviewer's sellae row: undefined is the valid row, null omits it. */
  row?: string | null;
  /** The raw yaml value of `spec_reviewer`: undefined is the valid seat, null omits the key. */
  setting?: string | null;
  /** A fresh handover is committed before anything is signed (default), so a resumed order passes gateDispatch. */
  handoff?: boolean;
  upTo?: Stage;
  edit?: (manifest: string) => string;
}
/** A world whose manifest declares the spec reviewer (or the named variant of it). */
function srWorld(tag: string, o: SrOpts = {}): World {
  const w = world(tag, o.upTo ?? "greenlight");
  const path = join(w.studio, "bisellium.yml");
  let text = readFileSync(path, "utf8");
  if (o.row !== null) text = text.replace(QA_ROW, `${QA_ROW}\n${o.row ?? SR_ROW}`);
  if (o.setting !== null) text += `spec_reviewer: ${o.setting ?? SR}\n`;
  writeFileSync(path, o.edit === undefined ? text : o.edit(text));
  commit(w.repo, "studio: W-162 spec_reviewer");
  if (o.handoff ?? true) handoffAt(w, "repo", T.handoffFresh);
  return w;
}
const putBrief = (w: World): void => put(w.repo, BRIEF_REL, briefText(w.behaviours));
const briefPath = (w: World): string => join(w.repo, BRIEF_REL);
/** A spec-phase verdict through the real writer, in the main checkout. */
function specVerdict(w: World, round: number, sella: string, outcome: string, body: string, model?: string): void {
  const from = join(w.root, `w162-${round}-${sella}.md`);
  writeFileSync(from, body);
  verb(w.repo, ["verdict", OPUS, "--round", String(round), "--sella", sella, ...(model === undefined ? [] : ["--model", model]), "--outcome", outcome, "--phase", "spec", "--from", from, "--studio", w.studio, "--now", T.spec]);
}
const sign = (w: World, round: number, body = NO_FINDINGS): void => specVerdict(w, round, "architect", "passed", body);
const review = (w: World, round: number, outcome: "passed" | "failed", o: { body?: string; model?: string; sella?: string } = {}): void =>
  specVerdict(w, round, o.sella ?? SR, outcome, o.body ?? (outcome === "passed" ? NO_FINDINGS : BLOCKER), o.model ?? SR_MODEL);
const readLog = (w: World, n: number): string => readFileSync(join(w.repo, specLog(n)), "utf8");
const writeLog = (w: World, n: number, text: string): void => writeFileSync(join(w.repo, specLog(n)), text);
const specNext = (w: World, extra: string[] = []): Out => next(w, [OPUS, ...BUDGET, ...extra]);

function reviewerOrder(o: Out, round: number, row: string): void {
  assert.equal(o.kv.get("role"), "spec-reviewer", ran(`${row}: role: spec-reviewer`, o));
  expectStep(o, "spec", "named", row);
  assert.equal(o.status, 0, ran(`${row}: exit`, o));
  assert.equal(o.kv.get("sella"), SR, ran(`${row}: sella`, o));
  assert.equal(o.kv.get("model"), SR_MODEL, ran(`${row}: model`, o));
  assert.equal(o.kv.get("round"), String(round), ran(`${row}: round`, o));
  assert.equal(o.kv.get("phase"), "spec", ran(`${row}: phase`, o));
}
function architectOrder(o: Out, round: number, row: string): void {
  assert.equal(o.kv.get("role"), "architect", ran(`${row}: role: architect`, o));
  expectStep(o, "spec", "named", row);
  assert.equal(o.kv.get("sella"), "architect", ran(`${row}: sella`, o));
  assert.equal(o.kv.get("round"), String(round), ran(`${row}: round`, o));
}
function specHeld(o: Out, row: string, why?: RegExp): void {
  expectStep(o, "spec", "held", row);
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(o.kv.has("role"), false, ran(`${row}: no order is named`, o));
  assert.equal(o.kv.has("command"), false, ran(`${row}: no command is named`, o));
  if (why !== undefined) assert.match(o.kv.get("why") ?? "", why, ran(`${row}: why`, o));
}
/** The signed spec is committed on the trunk by hand (as the verdict-then-commit fixtures do). */
const landed = (w: World): void => commit(w.repo, "spec: signed and reviewed");

test("W-162-b1 behaviour 1: a valid reviewer setting sends a signed spec to the reviewer, while bad settings and UI opera hold", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b1");
  putBrief(w);
  sign(w, 1);
  const o = specNext(w);
  reviewerOrder(o, 2, "a working-tree signature with no review");
  const inputs = o.kv.get("inputs") ?? "";
  assert.match(inputs, /briefs\/W-900\.md/, ran("the brief is an input", o));
  assert.match(inputs, /ci\/W-900-spec-1\.log/, ran("the signature log is an input", o));
  const command = o.kv.get("command") ?? "";
  assert.match(command, /does its Input domain name every record the opus reads, with one rejecting function that fails closed\?/, ran("question 1", o));
  assert.match(command, /can every promise be guaranteed, or does it state its limit\?/, ran("question 2", o));
  assert.match(command, /bisellium verdict W-900 --round 2 --sella spec-reviewer --model gpt-5\.6-sol --outcome <passed\|failed> --phase spec --from <file> --studio studio/, ran("the exact verdict command", o));
  assert.equal(o.out.includes("traditio"), false, ran("the reviewer order reads no handover", o));

  // an absent key preserves the existing commit path
  const absent = srWorld("w162-b1-absent", { setting: null });
  putBrief(absent);
  sign(absent, 1);
  const kept = specNext(absent);
  expectStep(kept, "spec", "named", "absent key: the existing ladder");
  assert.match(kept.kv.get("why") ?? "", /spec signed in the working tree, not committed/, ran("absent key names commit", kept));
  assert.equal(kept.kv.has("role"), false, ran("absent key names no order", kept));

  const bad: [string, SrOpts][] = [
    ["null", { setting: "null" }],
    ["another type", { setting: "42" }],
    ["an unknown seat", { setting: "ghost" }],
    ["a retired seat", { row: SR_ROW.replace(" }", ", retired: true }") }],
    ["the design magister", { setting: "architect", edit: (t) => t.replace(ARCHITECT_ROW, "  - { id: architect, collegium: design, kind: agent, model: gpt-5.6-sol, harness: codex }") }],
    ["a non-agent seat", { row: SR_ROW.replace("kind: agent", "kind: orchestrator") }],
    ["a non-codex harness", { row: SR_ROW.replace("harness: codex", "harness: claude-code") }],
    ["a missing harness", { row: SR_ROW.replace(", harness: codex", "") }],
    ["a missing model", { row: SR_ROW.replace(` model: ${SR_MODEL},`, "") }],
    ["another codex model", { row: SR_ROW.replace(SR_MODEL, "gpt-5.6-terra") }],
  ];
  for (const [name, opts] of bad) {
    const b = srWorld(`w162-b1-bad-${name.replace(/\W+/g, "-")}`, opts);
    putBrief(b);
    sign(b, 1);
    specHeld(specNext(b), `${name} holds at spec`, /spec_reviewer|spec-reviewer/);
  }

  // a kind: ui opus holds and names the verdict-writer / UI-input limit
  const ui = srWorld("w162-b1-ui");
  editRecord(ui, "repo", (doc) => doc.setIn(["kind"], "ui"));
  commit(ui.repo, "studio: W-900 is a ui opus");
  putBrief(ui);
  const held = specNext(ui);
  specHeld(held, "a kind: ui opus holds at spec", /UI input/);
  assert.match(held.kv.get("why") ?? "", /verdict/i, ran("it names the verdict writer", held));
});

test("W-162-b1 behaviour 1 review round 1: a duplicate reviewer-seat row holds at spec even when the first row is valid", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b1-r1-dup-seat", { row: `${SR_ROW}\n${SR_ROW}` });
  putBrief(w);
  sign(w, 1);
  specHeld(specNext(w), "two rows for the reviewer seat hold", /spec_reviewer|spec-reviewer/);
});

test("W-162-b1 behaviour 1 review round 1: a duplicate design collegium row holds at spec even when the first row is valid", { timeout: 1_800_000 }, () => {
  const design = "  - { id: design, name: Design, magister: architect }";
  const w = srWorld("w162-b1-r1-dup-design", { edit: (t) => t.replace(design, `${design}\n${design}`) });
  putBrief(w);
  sign(w, 1);
  specHeld(specNext(w), "two design collegium rows hold", /spec_reviewer|spec-reviewer/);
});

test("W-162-b2 behaviour 2: architect signatures and review verdicts are strict, and their outcomes agree with their findings", { timeout: 1_800_000 }, () => {
  // editing the brief after the signature orders the architect at the next round, not the reviewer
  const w = srWorld("w162-b2-blob");
  putBrief(w);
  const blob = gitq(w.repo, ["hash-object", briefPath(w)]);
  sign(w, 1);
  appendFileSync(briefPath(w), "\nEdited after the signature.\n");
  architectOrder(specNext(w), 2, "a brief edited after its signature");

  // the writer pins the brief's blob on a non-UI spec-phase verdict
  assert.match(readLog(w, 1), new RegExp(`^# brief: briefs/W-900\\.md blob:${blob}$`, "m"), "the signature carries # brief: <path> blob:<sha1>");

  // and refuses, writing nothing, when the brief is unreadable
  const bare = srWorld("w162-b2-nobrief");
  const from = join(bare.root, "none.md");
  writeFileSync(from, NO_FINDINGS);
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", from, "--studio", bare.studio, "--now", T.spec], { cwd: bare.repo, env: SETUP_ENV, encoding: "utf8" });
  assert.equal(r.status, 2, `an unreadable brief exits 2\n${r.stderr}${r.stdout}`);
  assert.match(r.stderr, /brief/, "the refusal names the brief");
  assert.equal(existsSync(join(bare.repo, specLog(1))), false, "no spec log is written");

  // a sole signature that is not strictly valid anchors nothing: the architect signs again
  const lone: [string, (t: string) => string][] = [
    ["a signature with no brief header", (t) => t.replace(/^# brief: .*\n/m, "")],
    ["a signature with a duplicate sella header", (t) => t.replace(/^# sella: architect\n/m, "# sella: architect\n# sella: architect\n")],
    ["a signature by another sella", (t) => t.replace("# sella: architect", "# sella: qa-lead")],
    ["a signature for another phase", (t) => t.replace("# phase: spec", "# phase: build")],
    ["a signature with a blocking finding", (t) => t.replace("No findings", "1. blocking brief:7 a defect. check: none: x")],
  ];
  for (const [name, mutate] of lone) {
    const s = srWorld(`w162-b2-lone-${name.replace(/\W+/g, "-")}`);
    putBrief(s);
    sign(s, 1);
    writeLog(s, 1, mutate(readLog(s, 1)));
    architectOrder(specNext(s), 2, `${name} is no signature`);
  }

  // a log above the newest valid signature must be that signature's strict review: nothing is skipped
  const above: [string, (t: string) => string, RegExp][] = [
    ["a review with no model", (t) => t.replace(/^# model: .*\n/m, ""), /spec-2\.log/],
    ["a review with another model", (t) => t.replace(`# model: ${SR_MODEL}`, "# model: gpt-5.6-terra"), /spec-2\.log/],
    ["a review with a duplicate header", (t) => t.replace(/^# outcome: passed\n/m, "# outcome: passed\n# outcome: passed\n"), /spec-2\.log/],
    ["a review with no brief header", (t) => t.replace(/^# brief: .*\n/m, ""), /spec-2\.log/],
    ["a review with no Findings section", (t) => t.replace("## Findings", "## Notes"), /spec-2\.log/],
    ["a review by another sella", (t) => t.replace(`# sella: ${SR}`, "# sella: qa-lead"), /spec-2\.log/],
    ["a review of another round", (t) => t.replace("# round: 2", "# round: 5"), /spec-2\.log/],
    ["a review of another phase", (t) => t.replace("# phase: spec", "# phase: build"), /spec-2\.log/],
    ["a review naming another brief blob", (t) => t.replace(/blob:[0-9a-f]{40}/, `blob:${"0".repeat(40)}`), /spec-2\.log/],
    ["a review with an unknown outcome", (t) => t.replace("# outcome: passed", "# outcome: passed with notes"), /spec-2\.log/],
  ];
  for (const [name, mutate, why] of above) {
    const s = srWorld(`w162-b2-above-${name.replace(/\W+/g, "-")}`);
    putBrief(s);
    sign(s, 1);
    review(s, 2, "passed");
    writeLog(s, 2, mutate(readLog(s, 2)));
    specHeld(specNext(s), `${name} holds`, why);
  }
  // outcome and findings must agree
  const blocked = srWorld("w162-b2-passed-blocker");
  putBrief(blocked);
  sign(blocked, 1);
  review(blocked, 2, "passed", { body: BLOCKER });
  specHeld(specNext(blocked), "passed beside a blocking finding holds", /spec-2\.log/);
  const empty = srWorld("w162-b2-failed-none");
  putBrief(empty);
  sign(empty, 1);
  review(empty, 2, "failed", { body: NO_FINDINGS });
  specHeld(specNext(empty), "failed beside No findings holds", /spec-2\.log/);
  const unchecked = srWorld("w162-b2-no-check");
  putBrief(unchecked);
  sign(unchecked, 1);
  review(unchecked, 2, "failed", { body: BLOCKER });
  writeLog(unchecked, 2, readLog(unchecked, 2).replace(" check: none: no rule", ""));
  specHeld(specNext(unchecked), "a numbered finding with no check holds", /spec-2\.log/);

  // malformed names hold, wherever they sit
  for (const name of [`${OPUS}-spec-01.log`, `${OPUS}-spec-x.log`, `${OPUS}-spec-2.txt`]) {
    const n = srWorld(`w162-b2-name-${name.replace(/\W+/g, "-")}`);
    putBrief(n);
    sign(n, 1);
    put(n.repo, `studio/ci/${name}`, "junk\n");
    specHeld(specNext(n), `the name ${name} holds`, /spec-/);
  }

  // a malformed newest signature is not skipped in favour of an older one
  const newest = srWorld("w162-b2-newest");
  putBrief(newest);
  sign(newest, 1);
  sign(newest, 2);
  writeLog(newest, 2, readLog(newest, 2).replace(/^# brief: .*\n/m, ""));
  specHeld(specNext(newest), "a malformed newest signature holds", /spec-2/);
});

test("W-162-b3 behaviour 3: only a passed review after the newest architect signature unlocks commit, landing and branch", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b3");
  putBrief(w);
  sign(w, 1);
  review(w, 2, "passed");
  const named = specNext(w);
  assert.match(named.kv.get("why") ?? "", /spec signed in the working tree, not committed/, ran("act: commit", named));
  expectStep(named, "spec", "named", "signature 1 plus passed review 2 names commit");
  assert.equal(named.kv.has("role"), false, ran("no order is named", named));

  const master = git(w.repo, ["rev-parse", "master"]);
  const done = next(w, [OPUS, "--perform", "--expect", "spec"]);
  expectStep(done, "spec", "performed", "the spec is committed");
  assert.match(done.out, /^branch: spec\/W-900$/m, ran("the branch line", done));
  assert.match(done.out, /^commit: [0-9a-f]+$/m, ran("the commit line", done));
  assert.equal(git(w.repo, ["rev-parse", `spec/${OPUS}^`]), master, "spec/<id> is master plus one commit");
  assert.deepEqual(git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `spec/${OPUS}`]).split("\n").sort(), [BRIEF_REL, specLog(1), specLog(2)], "exactly the brief and both validated logs");
  const landing = next(w, [OPUS]);
  expectStep(landing, "spec", "named", "the accepted spec branch names landing");
  assert.match(landing.out, /why: spec signed on spec\/W-900, not on master/, ran("the landing why", landing));

  // the landed trunk names branch; then ready is attributed to the signer, never the reviewer
  git(w.repo, ["merge", "-q", "--ff-only", `spec/${OPUS}`]);
  expectStep(next(w, [OPUS]), "branch", "named", "the landed trunk names branch");
  git(w.repo, ["branch", BRANCH]);
  git(w.repo, ["worktree", "add", "-q", w.wt, BRANCH]);
  const ready = next(w, [OPUS]);
  expectStep(ready, "ready", "named", "ready follows branch");
  assert.match(ready.out, /^attributed: architect \(signed ci\/W-900-spec-1\.log\)$/m, ran("attributed to the signer", ready));
  assert.match(ready.out, /--sella architect /, ran("the ready command names the design magister", ready));
  assert.doesNotMatch(ready.out, /--sella spec-reviewer/, ran("never the reviewer", ready));

  // a signature with no passed review does not unlock anything, committed or not
  const only = srWorld("w162-b3-only");
  putBrief(only);
  sign(only, 1);
  landed(only);
  reviewerOrder(specNext(only), 2, "a committed signature with no review");

  // an edit after a passed review orders the architect, in the working tree and on the trunk
  const edited = srWorld("w162-b3-edit");
  putBrief(edited);
  sign(edited, 1);
  review(edited, 2, "passed");
  appendFileSync(briefPath(edited), "\nEdited after the review.\n");
  architectOrder(specNext(edited), 3, "a working-tree brief edited after a passed review");
  const trunk = srWorld("w162-b3-edit-trunk");
  putBrief(trunk);
  sign(trunk, 1);
  review(trunk, 2, "passed");
  landed(trunk);
  appendFileSync(briefPath(trunk), "\nEdited after the review.\n");
  commit(trunk.repo, "spec: brief edited after review");
  architectOrder(specNext(trunk), 3, "a trunk brief edited after a passed review");

  // a newer signature needs a newer review
  for (const committed of [false, true]) {
    const s = srWorld(`w162-b3-resign-${committed}`);
    putBrief(s);
    sign(s, 1);
    review(s, 2, "passed");
    sign(s, 3);
    if (committed) landed(s);
    const o = specNext(s);
    reviewerOrder(o, 4, `signature 3 after a passed review 2 (committed: ${committed})`);
    assert.doesNotMatch(o.out, /^next: W-900 branch/m, ran("never branch", o));
  }

  // the review's model must be exact, independently of the sella header
  for (const [name, opts] of [
    ["another model", { model: "gpt-5.6-terra" }],
    ["another sella with the right model", { sella: "qa-lead" }],
  ] as const) {
    const s = srWorld(`w162-b3-model-${name.replace(/\W+/g, "-")}`);
    putBrief(s);
    sign(s, 1);
    review(s, 2, "passed", opts);
    specHeld(specNext(s), `a passed review by ${name} holds`);
  }

  // a spec/<id> branch carrying only a signature holds at spec and is not landed
  const lone = srWorld("w162-b3-spec-branch");
  git(lone.repo, ["switch", "-q", "-c", `spec/${OPUS}`]);
  putBrief(lone);
  sign(lone, 1);
  commit(lone.repo, "spec: signed");
  git(lone.repo, ["switch", "-q", "master"]);
  const heldBranch = specNext(lone);
  specHeld(heldBranch, "a spec branch with only a signature holds", /spec\/W-900/);
  const tried = next(lone, [OPUS, "--perform", "--expect", "spec"]);
  assert.equal(tried.status, 1, ran("perform does not land it", tried));
  assert.equal(ghCalls(lone).length, 0, "no PR call was made");

  // a merged record past ready keeps today's check: pre-gate logs (no brief header, no review) go past spec
  const past = srWorld("w162-b3-past-ready", { upTo: "spec" });
  writeFileSync(join(past.repo, specLog(1)), readLog(past, 1).replace(/^# brief: .*\n/m, ""));
  editRecord(past, "repo", (doc) => doc.setIn(["state"], "building"));
  commit(past.repo, "studio: W-900 is building on the trunk");
  expectStep(next(past, [OPUS]), "branch", "named", "a past-ready record goes past spec as today");
});

test("W-162-b4 behaviour 4: a failed review returns to the architect, and only a newer signature can reopen review", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b4");
  putBrief(w);
  sign(w, 1);
  review(w, 2, "failed");
  const o = specNext(w);
  architectOrder(o, 3, "signature 1 plus failed review 2");
  const inputs = o.kv.get("inputs") ?? "";
  assert.match(inputs, /briefs\/W-900\.md/, ran("the brief is an input", o));
  assert.match(inputs, /ci\/W-900-spec-2\.log/, ran("the failed review is an input", o));

  // a second reviewer verdict, with no signature between, holds and cannot erase the finding
  review(w, 3, "passed");
  specHeld(specNext(w), "a second reviewer verdict after a failed review holds", /spec-3|second|another/);

  // the architect's re-sign order resumes, so it needs a handover; the reviewer order does not
  const gated = srWorld("w162-b4-gate", { handoff: false });
  putBrief(gated);
  sign(gated, 1);
  reviewerOrder(specNext(gated), 2, "the first reviewer order needs no traditio");
  review(gated, 2, "failed");
  specHeld(specNext(gated), "the architect's order is held until the record carries a traditio", /stale handover/);
  handoffAt(gated, "repo", T.handoffFresh);
  architectOrder(specNext(gated), 3, "the architect's order with a handover");
  sign(gated, 3);
  reviewerOrder(specNext(gated), 4, "signature 3 orders the reviewer at round 4");
  review(gated, 4, "passed");
  const commitNamed = specNext(gated);
  expectStep(commitNamed, "spec", "named", "passed review 4 permits the commit");
  assert.match(commitNamed.kv.get("why") ?? "", /spec signed in the working tree, not committed/, ran("act: commit", commitNamed));

  // a malformed log at round 2 holds; a valid signature at round 3 makes it history
  const bad = srWorld("w162-b4-history");
  putBrief(bad);
  sign(bad, 1);
  put(bad.repo, specLog(2), "junk, not a verdict\n");
  specHeld(specNext(bad), "a malformed log at round 2 holds", /spec-2/);
  sign(bad, 3);
  reviewerOrder(specNext(bad), 4, "a valid signature at round 3 makes the malformed log history");
});

// ---------------------------------------------------------------------------
// W-167: the build-review loop stops at three counted failures (D-046 §2),
// security rounds are exempt (D-044), a class blocker's fix order names the
// input boundary (L-069). Rows are selectable with --test-name-pattern=W-167-b<n>.
// ---------------------------------------------------------------------------
/** Round n's recorded time: 04:00 for round 1, then every half hour (all before the 09:00 handover). */
const rt = (n: number): string => new Date(Date.parse("2026-10-02T03:30:00.000Z") + n * 30 * 60_000).toISOString();
const plain = (t = "fixture defect"): string => `blocking: ${t} at brief:1. check: none: fixture`;
const secure = (t = "fixture defect"): string => `blocking (security): ${t} at brief:1. check: none: fixture`;
const klass = (t = "fixture"): string => `blocking: a class of defects (${t}) at brief:1. check: none: fixture`;
/** A Findings body: each line is numbered in order; "pass" is a passed round. */
const found = (...lines: string[]): string => lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
const F = found(plain());
type Round = string;
/** Round n is recorded through the verbs at its own tree: a source edit precedes every round after the first. */
function record167(w: World, bodies: Round[], from = 1): void {
  bodies.forEach((b, i) => {
    const n = from + i;
    if (n > 1) advanceSource(w);
    addReview(w, b === "pass" ? "passed" : "failed", n, rt(n), b === "pass" ? undefined : b);
  });
}
function secGate(w: World): void {
  editRecord(w, "wt", (doc) => doc.setIn(["probationes", "sec"], { status: "passed", sella: "qa-lead", evidence: `ci/${OPUS}-review-1.log`, at: T.review1 }));
  commit(w.wt, `studio(${OPUS}): sec gate`);
}
/** A build-stage world with the named rounds recorded and a fresh handover (so a named order passes the context cap). */
function w167(tag: string, bodies: Round[]): World {
  const w = world(tag, "build");
  record167(w, bodies);
  handoffAt(w, "wt", T.handoffFresh);
  return w;
}
const n167 = (w: World, env?: Record<string, string | undefined>): Out => next(w, [OPUS, ...BUDGET], env === undefined ? {} : { env });
function buildFix(o: Out, row: string): void {
  expectStep(o, "build", "named", row);
  assert.equal(o.status, 0, ran(`${row}: exit`, o));
  assert.match(o.out, /^phase:\s*fix$/m, ran(`${row}: phase fix`, o));
}
function reviewNamed(o: Out, round: number, row: string): void {
  expectStep(o, "review", "named", row);
  assert.equal(o.kv.get("round"), String(round), ran(`${row}: round`, o));
}
function reviewHeld(o: Out, row: string, why?: RegExp): void {
  expectStep(o, "review", "held", row);
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(o.kv.has("role"), false, ran(`${row}: no order is named`, o));
  assert.equal(o.kv.has("command"), false, ran(`${row}: no command is named`, o));
  if (why !== undefined) assert.match(o.kv.get("why") ?? "", why, ran(`${row}: why`, o));
}
/** W-166: the hold on a malformed source_excludes, printed before any derivation: `next: <id> held`, no step. */
function excludesHeld(o: Out, row: string): void {
  assert.equal(o.first, `next: ${OPUS} held`, ran(`${row}: the held line carries no step`, o));
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(o.kv.has("role"), false, ran(`${row}: no order is named`, o));
  assert.equal(o.kv.has("command"), false, ran(`${row}: no command is named`, o));
  assert.match(o.kv.get("why") ?? "", /^bisellium\.yml#source_excludes is malformed \(/, ran(`${row}: why names bisellium.yml#source_excludes`, o));
}
function patronHeld(o: Out, row: string): void {
  reviewHeld(o, row);
  assert.equal(o.kv.get("actor"), "patron", ran(`${row}: actor`, o));
}
interface Edit {
  dir: "repo" | "wt";
  rel: string;
  /** the new text from the old; a fixture whose edit changes nothing is a defect */
  text?: (old: string) => string;
  symlink?: string;
}
/** Apply the edits (committed in both checkouts), run `fn`, then put every file back and commit again. */
function trial(w: World, edits: Edit[], fn: () => void): void {
  const at = (e: Edit): string => join(e.dir === "repo" ? w.repo : w.wt, e.rel);
  const saved = edits.map((e) => ({ path: at(e), old: existsSync(at(e)) ? readFileSync(at(e), "utf8") : undefined }));
  try {
    edits.forEach((e, i) => {
      const path = at(e);
      const old = saved[i]!.old;
      rmSync(path, { force: true });
      if (e.symlink !== undefined) symlinkSync(e.symlink, path);
      else {
        const text = e.text!(old ?? "");
        assert.notEqual(text, old, `fixture defect: the edit of ${e.rel} changed nothing`);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      }
    });
    commit(w.repo, "test: W-167 trial");
    commit(w.wt, "test: W-167 trial");
    fn();
  } finally {
    for (const s of saved) {
      rmSync(s.path, { force: true });
      if (s.old !== undefined) writeFileSync(s.path, s.old);
    }
    commit(w.repo, "test: W-167 trial undone");
    commit(w.wt, "test: W-167 trial undone");
  }
}
const LOG167 = (n: number): string => `studio/ci/${OPUS}-review-${n}.log`;
const MANIFEST_REL = "studio/bisellium.yml";
/** The same manifest edit in the main checkout and in the worktree, so the two agree. */
const both = (edit: (t: string) => string): Edit[] => [
  { dir: "repo", rel: MANIFEST_REL, text: edit },
  { dir: "wt", rel: MANIFEST_REL, text: edit },
];
const REVIEW_ROW = "  - { id: review, name: Lead review, kind: agent }";
const CENSOR_ROW = "  - { id: qa-lead, collegium: qa, kind: agent }";
const QA_COLLEGIUM = "  - { id: qa, name: QA, magister: qa-lead }";

test("W-167-b1 behaviour 1: round history, review configuration and the cited gate are read strictly", { timeout: 1_800_000 }, () => {
  // today's rungs, read from valid logs
  buildFix(n167(w167("w167-b1-failed", [F])), "a valid failed current round names build, phase fix");
  const passed = w167("w167-b1-passed", ["pass"]);
  secGate(passed);
  expectStep(n167(passed), "pr", "named", "a valid passed current round names pr");

  const w = w167("w167-b1-holds", [F]);
  // an unreadable ci/ is an error, never zero rounds (an absent one also loses the reds beneath it, so the reds rung names first)
  const ci = join(w.wt, "studio/ci");
  try {
    chmodSync(ci, 0o100); // traversable but not listable, so the reds under it still read
    reviewHeld(n167(w), "an unreadable ci/ holds", /ci\//);
  } finally {
    chmodSync(ci, 0o755);
  }
  // the round logs
  const rows: [string, (t: string) => string][] = [
    ["a duplicate header", (t) => t.replace("# round: 1\n", "# round: 1\n# round: 1\n")],
    ["a missing # at", (t) => t.replace(/^# at: .*\n/m, "")],
    ["a missing # tree", (t) => t.replace(/^# tree: .*\n/m, "")],
    ["the wrong phase", (t) => t.replace("# phase: build", "# phase: spec")],
    ["the wrong round", (t) => t.replace("# round: 1", "# round: 2")],
    ["a non-censor sella", (t) => t.replace("# sella: qa-lead", "# sella: eng-lead")],
    ["an invalid # at", (t) => t.replace(/^# at: .*$/m, "# at: yesterday")],
    ["passed with a standing blocker", (t) => t.replace("# outcome: failed", "# outcome: passed")],
    ["failed with no standing blocker", (t) => t.replace(/## Findings[^]*$/, "## Findings\nNo findings\n")],
  ];
  for (const [name, mutate] of rows)
    trial(w, [{ dir: "wt", rel: LOG167(1), text: mutate }], () => reviewHeld(n167(w), `${name} holds`, /W-900-review-1\.log/));
  for (const name of [`${OPUS}-review-01.log`, `${OPUS}-review-x.log`, `${OPUS}-review-2.txt`])
    trial(w, [{ dir: "wt", rel: `studio/ci/${name}`, text: () => "junk\n" }], () => reviewHeld(n167(w), `the name ${name} holds`, /review-/));
  const log = readFileSync(join(w.wt, LOG167(1)), "utf8");
  const elsewhere = join(w.root, "elsewhere.log");
  writeFileSync(elsewhere, log);
  trial(w, [{ dir: "wt", rel: LOG167(1), symlink: elsewhere }], () => reviewHeld(n167(w), "a symlinked review log holds", /W-900-review-1\.log/));
  trial(w, [{ dir: "wt", rel: LOG167(1), text: (t) => `${t}\n${"x".repeat(4_100_000)}` }], () => reviewHeld(n167(w), "an over-4 MB review log holds", /W-900-review-1\.log/));

  // the review configuration, the same in both checkouts
  const configs: [string, (t: string) => string][] = [
    ["review_probatio: null", (t) => `${t}review_probatio: null\n`],
    ["an empty review_probatio", (t) => `${t}review_probatio: ""\n`],
    ["a non-string review_probatio", (t) => `${t}review_probatio: 42\n`],
    ["review_probatio: spec", (t) => `${t}review_probatio: spec\n`],
    ["an unknown review_probatio", (t) => `${t}review_probatio: ghost\n`],
    ["a duplicated review probatio", (t) => t.replace(REVIEW_ROW, `${REVIEW_ROW}\n${REVIEW_ROW}`)],
    ["a non-agent review probatio", (t) => `${t.replace("source_excludes:", '  - { id: tests, name: Tests, kind: automated, command: "node -e 0" }\nsource_excludes:')}review_probatio: tests\n`],
    ["a retired censor", (t) => t.replace(CENSOR_ROW, CENSOR_ROW.replace(" }", ", retired: true }"))],
    ["a non-agent censor", (t) => t.replace(CENSOR_ROW, CENSOR_ROW.replace("kind: agent", "kind: orchestrator"))],
    ["a builder-class censor", (t) => t.replace(QA_COLLEGIUM, QA_COLLEGIUM.replace("qa-lead", "builder"))],
  ];
  for (const [name, edit] of configs) trial(w, both(edit), () => reviewHeld(n167(w), `${name} holds`));
  // W-166: a malformed source_excludes holds before any derivation, so there is no step on the held line
  const malformed: [string, (t: string) => string][] = [
    ["a scalar source_excludes", (t) => t.replace("source_excludes: []", "source_excludes: studio")],
    ["a null source_excludes", (t) => t.replace("source_excludes: []", "source_excludes: null")],
    ["a source_excludes with an empty string", (t) => t.replace("source_excludes: []", 'source_excludes: [""]')],
  ];
  for (const [name, edit] of malformed) trial(w, both(edit), () => excludesHeld(n167(w), `${name} holds`));
  trial(w, both((t) => `${t}review_probatio: review\n`), () => buildFix(n167(w), "review_probatio: review is the default spelled out"));

  // the worktree manifest against the main checkout's: one row per key, naming it and both values
  const drift: [string, (t: string) => string, RegExp[]][] = [
    ["review_probatio", (t) => `${t}review_probatio: sec\n`, [/review_probatio/, /sec/]],
    ["the QA magister", (t) => t.replace(QA_COLLEGIUM, QA_COLLEGIUM.replace("magister: qa-lead", "magister: eng-lead")), [/qa-lead/, /eng-lead/]],
    ["the censor's seat row", (t) => t.replace(CENSOR_ROW, CENSOR_ROW.replace(" }", ", model: other-model }")), [/other-model/]],
    ["patron", (t) => t.replace("patron: patron", "patron: someone-else"), [/patron/, /someone-else/]],
    ["source_excludes", (t) => t.replace("source_excludes: []", "source_excludes: [extra-dir]"), [/source_excludes/, /extra-dir/]],
  ];
  for (const [name, edit, parts] of drift)
    trial(w, [{ dir: "wt", rel: MANIFEST_REL, text: edit }], () => {
      const o = n167(w);
      reviewHeld(o, `a worktree manifest that differs in ${name} holds`);
      for (const part of parts) assert.match(o.kv.get("why") ?? "", part, ran(`${name}: why names ${part}`, o));
    });
  trial(w, [{ dir: "wt", rel: MANIFEST_REL, text: (t) => t.replace("studio: W-124 fixture", "studio: renamed") }], () => buildFix(n167(w), "an unrelated key differing does not hold"));
  trial(w, [{ dir: "wt", rel: MANIFEST_REL, text: (t) => `${t}: [unparseable\n` }], () => reviewHeld(n167(w), "an unparseable worktree manifest holds"));

  // the cited gate
  const gates: [string, (t: string) => string][] = [
    ["a gate citing a missing log", (t) => t.replace(`ci/${OPUS}-review-1.log`, `ci/${OPUS}-review-9.log`)],
    ["a gate whose status disagrees with its log", (t) => t.replace("status: failed", "status: passed")],
    ["a gate carrying a non-censor sella", (t) => t.replace(/(review: \{[^}]*sella: )qa-lead/, "$1eng-lead")],
  ];
  for (const [name, mutate] of gates) trial(w, [{ dir: "wt", rel: `studio/opera/${OPUS}.md`, text: mutate }], () => reviewHeld(n167(w), `${name} holds`));
  const two = w167("w167-b1-other-log", [F, F]);
  trial(two, [{ dir: "wt", rel: `studio/opera/${OPUS}.md`, text: (t) => t.replace(`ci/${OPUS}-review-2.log`, `ci/${OPUS}-review-1.log`) }], () => reviewHeld(n167(two), "a gate citing another log holds"));

  // an uncomputable current tree holds rather than naming review
  reviewHeld(n167(w, { GIT_STUB_REAL: failingGit("w167-b1-tree", ["ls-tree -r"]) }), "an uncomputable current tree holds");
});

test("W-167-b2 behaviour 2: the third counted failure holds for the Patron, recommends from the newest failure, and survives a re-spec", { timeout: 1_800_000 }, () => {
  const w = w167("w167-b2", [found(klass("round one")), F, F]);
  const o = n167(w);
  patronHeld(o, "three plain failures hold for the Patron");
  assert.equal(o.kv.get("why"), "3 counted failed build-review rounds (1, 2, 3); a further round needs the Patron's OK (D-046)", ran("why", o));
  assert.equal(o.kv.get("recommendation"), "one more fix round: round 3's blockers are single instances", ran("a class in an older round does not count", o));
  assert.equal(o.kv.get("grant"), "Grant: one more build-review round for W-900.", ran("grant", o));
  assert.equal(o.kv.get("attach"), "bisellium amend W-900 --round-ruling <decision-id> --reason <text> --studio .worktrees/W-900/studio", ran("attach", o));

  advanceSource(w);
  patronHeld(n167(w), "a source edit leaves the hold unchanged");
  appendFileSync(join(w.wt, "studio", "briefs", `${OPUS}.md`), "\nA brief edit.\n");
  verb(w.wt, ["verdict", OPUS, "--round", "2", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, "spec-2.md"), "--studio", w.wtStudio, "--now", "2026-10-02T08:00:00.000Z"]);
  commit(w.wt, `spec(${OPUS}): re-signed`);
  patronHeld(n167(w), "a brief edit and a newer signature leave the hold unchanged");

  const classy = w167("w167-b2-class", [F, F, found(plain(), klass("round three"))]);
  const c = n167(classy);
  patronHeld(c, "a class blocker in the newest failure holds");
  assert.equal(c.kv.get("recommendation"), "re-spec: ci/W-900-review-3.log finding 2 is a class, so the brief's boundary or promise is the problem", ran("the re-spec recommendation names the lowest class finding", c));

  const two = w167("w167-b2-two", [F, F]);
  buildFix(n167(two), "two failures name the normal fix rung");
  advanceSource(two);
  reviewNamed(n167(two), 3, "two failures then a fix name the next review");

  const passed = w167("w167-b2-pass", [F, F, F]);
  record167(passed, ["pass"], 4);
  secGate(passed);
  expectStep(n167(passed), "pr", "named", "three failures then a passed round 4 at the current tree reach pr");
});

test("W-167-b3 behaviour 3: a security-only round is pre-approved, a mixed round counts, and the review order says so", { timeout: 1_800_000 }, () => {
  const exempt = w167("w167-b3-exempt", [F, F, found(secure("a"), secure("b"))]);
  buildFix(n167(exempt), "two plain failures plus a security-only third name build, phase fix");
  const mixed = w167("w167-b3-mixed", [F, F, found(secure("a"), plain("b"))]);
  patronHeld(n167(mixed), "the same third round with one plain blocker holds");
  record167(exempt, [F], 4);
  const later = n167(exempt);
  patronHeld(later, "a later plain failure holds");
  assert.match(later.kv.get("why") ?? "", /^3 counted failed build-review rounds \(1, 2, 4\);/, ran("why names only the counted rounds", later));

  const order = w167("w167-b3-order", [F]);
  advanceSource(order);
  const review = n167(order);
  reviewNamed(review, 2, "a review order");
  const command = review.kv.get("command") ?? "";
  assert.match(command, /blocking \(security\)/, ran("the command names the marker", review));
  assert.match(command, /every blocker/i, ran("the command says every blocker must carry it", review));
  assert.match(command, /D-044/, ran("the command cites D-044", review));
});

const RULING_LINE = `Grant: one more build-review round for ${OPUS}.`;
function decision(w: World, id: string, o: { by?: string; at?: string; body?: string } = {}): void {
  put(w.wt, `studio/decisions/${id}.md`, `---\nid: "${id}"\ntitle: "Patron ruling for ${OPUS}"\nat: ${o.at ?? rt(3).replace(/(\d\d):00/, "$1:10")}\nprovenance: stated\nby: ${o.by ?? "patron"}\n---\n\n${o.body ?? RULING_LINE}\n`);
  commit(w.wt, `studio(${OPUS}): ${id}`);
}
function amendRuling(w: World, id: string): Out {
  return cli(w, ["amend", OPUS, "--round-ruling", id, "--reason", "Patron ruling", "--sella", "producer", "--studio", w.wtStudio, "--now", "2026-10-02T08:30:00.000Z"], w.wt);
}
const recordPath = (w: World): string => join(w.wtStudio, "opera", `${OPUS}.md`);
/** Amend refuses with exit 2, and neither the record nor the event log moves. */
function refusedRuling(w: World, id: string, row: string): void {
  const before = [readFileSync(recordPath(w), "utf8"), eventsOf(w.wtStudio)];
  const o = amendRuling(w, id);
  assert.equal(o.status, 2, ran(`${row}: exit`, o));
  assert.deepEqual([readFileSync(recordPath(w), "utf8"), eventsOf(w.wtStudio)], before, `${row}: the record and the event log are byte-identical`);
}

test("W-167-b4 behaviour 4: a Patron ruling attached by amend --round-ruling permits exactly one more round", { timeout: 1_800_000 }, () => {
  const w = w167("w167-b4", [F, F, F]);
  decision(w, "D-901");
  const attached = amendRuling(w, "D-901");
  assert.equal(attached.status, 0, ran("a valid ruling attaches", attached));
  commit(w.wt, `studio(${OPUS}): ruling attached`);
  buildFix(n167(w), "one ruling lets the fix run");
  refusedRuling(w, "D-901", "a duplicate id");
  advanceSource(w);
  reviewNamed(n167(w), 4, "one ruling lets round 4 run");
  addReview(w, "failed", 4, rt(4), F);
  patronHeld(n167(w), "a fourth counted failure holds again");
  decision(w, "D-902", { at: rt(3).replace(/(\d\d):00/, "$1:20") });
  const second = amendRuling(w, "D-902");
  assert.equal(second.status, 0, ran("a second valid ruling attaches", second));
  commit(w.wt, `studio(${OPUS}): second ruling attached`);
  buildFix(n167(w), "a second ruling permits one more");

  const r = w167("w167-b4-refused", [F, F, F]);
  refusedRuling(r, "D-999", "a missing decision");
  decision(r, "D-910", { by: "someone-else" });
  refusedRuling(r, "D-910", "a decision by another author");
  decision(r, "D-911", { by: '""' });
  refusedRuling(r, "D-911", "a decision with an empty by");
  decision(r, "D-912", { body: "One more build-review round is fine." });
  refusedRuling(r, "D-912", "a missing grant line");
  decision(r, "D-913", { body: `Grant: one more build-review round for ${OPUS}` });
  refusedRuling(r, "D-913", "an altered grant line");
  decision(r, "D-914", { body: "Grant: one more build-review round for W-901." });
  refusedRuling(r, "D-914", "a grant line for another opus");
  decision(r, "D-915", { at: "not-a-date" });
  refusedRuling(r, "D-915", "an invalid at");
  decision(r, "D-916", { at: rt(3) });
  refusedRuling(r, "D-916", "an at equal to the third failure");
  decision(r, "D-917", { at: rt(2) });
  refusedRuling(r, "D-917", "an at before the third failure");
  decision(r, "D-918");
  for (const [name, patron] of [["absent", ""], ["null", "patron: null\n"], ["empty", 'patron: ""\n']] as const)
    trial(r, [{ dir: "wt", rel: MANIFEST_REL, text: (t) => t.replace("patron: patron\n", patron) }], () => refusedRuling(r, "D-918", `an ${name} manifest patron`));
  trial(r, [{ dir: "wt", rel: `studio/opera/${OPUS}.md`, text: (t) => t.replace("\n---\n", "\nround_rulings: nonsense\n---\n") }], () => refusedRuling(r, "D-918", "an existing malformed round_rulings"));
  trial(r, [{ dir: "wt", rel: LOG167(2), text: (t) => t.replace("# phase: build", "# phase: spec") }], () => refusedRuling(r, "D-918", "a malformed review history"));
  const fewer = w167("w167-b4-fewer", [F, F]);
  decision(fewer, "D-919", { at: rt(2).replace(/(\d\d):00/, "$1:10") });
  refusedRuling(fewer, "D-919", "fewer than three counted failures");

  // next reads the same lists, written by hand
  const h = w167("w167-b4-hand", [F, F, F]);
  decision(h, "D-930");
  const lists: [string, string][] = [
    ["a scalar", "round_rulings: D-930"],
    ["an empty list", "round_rulings: []"],
    ["a duplicated id", "round_rulings: [D-930, D-930]"],
    ["a missing decision", "round_rulings: [D-940]"],
  ];
  for (const [name, line] of lists)
    trial(h, [{ dir: "wt", rel: `studio/opera/${OPUS}.md`, text: (t) => t.replace("\n---\n", `\n${line}\n---\n`) }], () => reviewHeld(n167(h), `${name} holds`, /round_rulings|D-9/));
  trial(h, [{ dir: "wt", rel: `studio/opera/${OPUS}.md`, text: (t) => t.replace("\n---\n", "\nround_rulings: [D-930]\n---\n") }], () => buildFix(n167(h), "a valid hand-written list permits one round"));
});

test("W-167-b5 behaviour 5: a class blocker's fix order prescribes one check at the input boundary", { timeout: 1_800_000 }, () => {
  const boundary = (n: number, f: number): string =>
    `ci/${OPUS}-review-${n}.log finding ${f} is a class: fix it with one check at the input boundary named by the brief's Input domain, which every path reads, not a patch at the cited site (L-069)`;
  const one = w167("w167-b5-one", [found(klass())]);
  const o = n167(one);
  buildFix(o, "a class blocker still names build, phase fix");
  assert.equal(o.kv.get("boundary"), boundary(1, 1), ran("finding 1 is named", o));
  const second = w167("w167-b5-second", [found(plain(), klass())]);
  assert.equal(n167(second).kv.get("boundary"), boundary(1, 2), "a plain blocker 1 and a class blocker 2 name finding 2");
  const single = w167("w167-b5-single", [F]);
  assert.equal(n167(single).kv.has("boundary"), false, "a single-instance blocker prints no boundary");
  const advisory = w167("w167-b5-advisory", [found(plain(), "advisory: this class of issue is minor. check: none: fixture")]);
  assert.equal(n167(advisory).kv.has("boundary"), false, "class in an advisory finding prints no boundary");
  const converted = w167("w167-b5-converted", [found(plain(), "blocking: a class of defects with no citation. check: none: fixture")]);
  assert.match(readFileSync(join(converted.wt, LOG167(1)), "utf8"), /^# converted: 2 /m, "fixture: finding 2 was converted");
  assert.equal(n167(converted).kv.has("boundary"), false, "class in a converted finding prints no boundary");
  const security = w167("w167-b5-security", [found(secure("a class of defects"))]);
  const s = n167(security);
  buildFix(s, "a security-only round is exempt");
  assert.equal(s.kv.get("boundary"), boundary(1, 1), ran("a security-marked class blocker still prints it", s));

  advanceSource(single);
  const review = n167(single);
  reviewNamed(review, 2, "a review order");
  assert.match(review.kv.get("command") ?? "", /\bclass\b[^]*recurs across sites|recurs across sites[^]*\bclass\b/, ran("the command names the word class for a blocker that recurs across sites", review));
});

test("W-166-b4 behaviour 4: next orders one behaviour's test, red, log commit and implementation at a time", { timeout: 1_800_000 }, () => {
  const budget = ["--budget", "100000"];
  const none = world("w166-b4-none", "ready");
  handoffAt(none, "wt", T.handoffFresh);
  const first = next(none, [OPUS, ...budget]);
  expectStep(first, "reds", "named", "4a: a world with no reds names reds");
  const order = first.kv.get("command") ?? "";
  assert.match(order, /from behaviour 1 through 2/, ran("4a: the order starts from behaviour 1", first));
  assert.equal(first.kv.get("actor"), "builder", "4a: the actor is the builder");
  assert.equal(first.kv.get("phase"), "1", "4a: phase 1");
  assert.match(order, /from \.worktrees\/W-900: bisellium red W-900 --behaviour <b> /, ran("4a: the red runs from the worktree", first));
  assert.doesNotMatch(order, /--repo/, ran("4a: the red command carries no --repo", first));
  assert.doesNotMatch(order, /reds only, implementation absent/, ran("4a: the old all-reds order is gone", first));
  assert.match(order, /commit the red log alone \(studio files only\), before any implementation/, ran("4a: the log is committed alone before the implementation", first));
  assert.match(order, /detached worktree[^]*never rewrite history/, ran("4a: the correction path is named", first));

  const one = world("w166-b4-one", "ready");
  writeReds(one);
  rmSync(join(one.wtStudio, "ci", "reds", OPUS, "02.log"));
  commit(one.wt, "studio: drop red 2");
  handoffAt(one, "wt", T.handoffFresh);
  const second = next(one, [OPUS, ...budget]);
  expectStep(second, "reds", "named", "4b: 01.log usable and 02.log absent names reds");
  assert.match(second.kv.get("command") ?? "", /from behaviour 2 through 2/, ran("4b: the order starts from behaviour 2", second));
});

test("W-166-b4 behaviour 4: a scalar source_excludes holds next and dispatches nothing", { timeout: 1_800_000 }, () => {
  const w = world("w166-b4-scalar", "ready");
  const manifest = join(w.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", "source_excludes: examples/"));
  commit(w.repo, "studio: scalar source_excludes");
  const o = next(w, [OPUS, "--budget", "100000"]);
  assert.equal(o.status, 1, ran("4c: a scalar source_excludes exits 1", o));
  assert.match(o.out, /why: .*bisellium\.yml#source_excludes/, ran("4c: the why names bisellium.yml#source_excludes", o));
  assert.doesNotMatch(o.out, /^(role|command|phase):/m, ran("4c: no order is dispatched", o));
});

test("W-166-b4 behaviour 4: a malformed source_excludes holds next on every derivation outcome", { timeout: 1_800_000 }, () => {
  const spoil = (w: World, to: string): void => {
    const manifest = join(w.studio, "bisellium.yml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", `source_excludes: ${to}`));
    commit(w.repo, "studio: malformed source_excludes");
  };
  for (const to of ["examples/", "null", '[""]']) {
    // a complete opus must not exit 0
    const done = world(`w166-b4-complete-${to.length}`, "checkpoint");
    spoil(done, to);
    const c = next(done, [OPUS, "--budget", "100000"]);
    assert.equal(c.status, 1, ran(`4d: a complete opus under source_excludes ${to} exits 1`, c));
    assert.equal(c.first.endsWith(" held"), true, ran(`4d: ${to} holds a complete opus`, c));
    assert.match(c.out, /bisellium\.yml#source_excludes/, ran(`4d: ${to} names source_excludes on a complete opus`, c));

    // an already-held rung (no budget declared) names source_excludes, not its own why
    const held = world(`w166-b4-held-${to.length}`, "ready");
    handoffAt(held, "wt", T.handoffFresh);
    spoil(held, to);
    const h = next(held, [OPUS]);
    assert.equal(h.status, 1, ran(`4e: a held rung under source_excludes ${to} exits 1`, h));
    assert.match(h.kv.get("why") ?? h.out, /bisellium\.yml#source_excludes/, ran(`4e: ${to} names source_excludes on a held rung`, h));
    assert.doesNotMatch(h.out, /^(role|command):/m, ran(`4e: ${to} dispatches nothing`, h));
  }
});

test("W-166-b3 behaviour 3: with a usable worktree next surfaces the shared-tree block at reds", { timeout: 1_800_000 }, () => {
  const w = world("w166-b3-shared", "ready");
  appendFileSync(join(w.wt, "studio/briefs/W-900.md"), "\nRed order: one at a time\n");
  writeReds(w);
  handoffAt(w, "wt", T.handoffFresh);
  const o = next(w, [OPUS, "--budget", "100000"]);
  expectStep(o, "reds", "named", "3a: a shared-tree pair in an opted-in opus names reds");
  assert.match(o.kv.get("why") ?? "", /opus\.red_evidence: red logs for behaviours 1 and 2 certify one tree/, ran("3a: the why carries the shared-tree block", o));
});

test("W-166-b4 behaviour 4: a malformed source_excludes is a terminal hold: no track, health or perform replaces it", { timeout: 1_800_000 }, () => {
  const budget = ["--budget", "100000"];
  for (const [n, to] of [["scalar", "examples/"], ["null", "null"], ["empty", '[""]']] as const) {
    const w = world(`w166-b4-terminal-${n}`, "reds");
    const manifest = join(w.studio, "bisellium.yml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", `source_excludes: ${to}`));
    commit(w.repo, "studio: malformed source_excludes");
    // any step: nothing is derived, so no step is compared
    const step = "review";
    const child = liveChild();
    mkdirSync(stepsDir(w), { recursive: true });
    const held = (row: string, o: Out): void => {
      assert.equal(o.status, 1, ran(`${n} ${row}: exit 1`, o));
      assert.match(o.first, /^next: W-900 held$/, ran(`${n} ${row}: the held line`, o));
      assert.match(o.out, /bisellium\.yml#source_excludes/, ran(`${n} ${row}: names source_excludes`, o));
      assert.doesNotMatch(o.out, /^(role|command|health):/m, ran(`${n} ${row}: no order and no health line`, o));
    };

    // (a) --track installs no marker
    writeFileSync(join(stepsDir(w), "w124.log"), "tee\n");
    held("--track", next(w, [OPUS, "--track", step, "--pid", String(child), "--output", "steps/w124.log", ...budget]));
    assert.equal(existsSync(markerPath(w)), false, `${n}: --track wrote no marker`);

    // (b) a live tracked process
    putMarker(w, { step, pid: child, start_ticks: tickOf(child), writer: "track" });
    putOutput(w, "fresh\n", 30);
    held("running", next(w, [OPUS, ...budget]));

    // (c) dead, invalid, unknown and anomaly markers
    putMarker(w, { step, pid: deadPid(), start_ticks: 1234 });
    held("dead", next(w, [OPUS, ...budget]));
    writeFileSync(markerPath(w), "{ this is not json");
    held("invalid", next(w, [OPUS, ...budget]));
    putMarker(w, { step, pid: 4242, start_ticks: 777 });
    held("unknown", next(w, [OPUS, ...budget], { env: PROC_ENV(fakeProc(w, { "4242": "dir" })) }));
    putMarker(w, { step, pid: child, start_ticks: tickOf(child) });
    putOutput(w, "future\n", -3600);
    held("anomaly", next(w, [OPUS, ...budget]));

    // (d) --perform --expect performs nothing and takes no marker
    rmSync(markerPath(w), { force: true });
    held("--perform", next(w, [OPUS, "--perform", "--expect", step, ...budget]));
    assert.equal(existsSync(markerPath(w)), false, `${n}: --perform took no marker`);
    assert.deepEqual(calls(w).filter((c) => c[0] === "gh"), [], `${n}: no gh call was made`);
  }
});

test("W-166-b4 behaviour 4: a malformed source_excludes holds before any derivation, gh or git read", { timeout: 1_800_000 }, () => {
  const spoil = (w: World): void => {
    const manifest = join(w.studio, "bisellium.yml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", "source_excludes: examples/"));
    commit(w.repo, "studio: scalar source_excludes");
  };
  const quiet = (w: World, row: string, o: Out): void => {
    excludesHeld(o, row);
    assert.deepEqual(ghCalls(w), [], `${row}: the gh stub recorded no call`);
    assert.deepEqual(
      gitCalls(w).filter((a) => a[0] !== "rev-parse"),
      [],
      `${row}: no git call beyond the repository checks`,
    );
  };
  const rows: [string, (w: World) => void, World][] = [
    ["5a an absent tip", () => undefined, world("w166-b4-notip", "spec")],
    ["5b an unusable worktree", (w) => rmSync(w.wt, { recursive: true, force: true }), world("w166-b4-nowt", "reds")],
    ["5c a pushed branch", () => undefined, world("w166-b4-pushed", "pr")],
  ];
  for (const [row, prep, w] of rows) {
    prep(w);
    spoil(w);
    rmSync(w.log, { force: true });
    quiet(w, row, next(w, [OPUS, "--budget", "100000"]));
  }
  // 5d: an unknown opus with a malformed value: the hold wins. The id, repository and studio checks come before
  // readSourceExcludes and keep exit 2; "unknown opus" was found only after it (by gather), so it no longer wins.
  const unknown = world("w166-b4-unknown", "spec");
  spoil(unknown);
  rmSync(unknown.log, { force: true });
  const o = next(unknown, ["W-999", "--budget", "100000"]);
  excludesHeld({ ...o, first: o.first.replace("W-999", OPUS) }, "5d an unknown opus");
  assert.equal(o.first, "next: W-999 held", ran("5d: the hold names the asked id", o));
  assert.deepEqual(ghCalls(unknown), [], "5d: no gh call");
});

// ---------------------------------------------------------------------------
// W-168 behaviours 3 and 4: the merge-queue mode of `pr` and `merge`
// ---------------------------------------------------------------------------
const QUEUE_PARAMS: Json = {
  merge_method: "SQUASH",
  max_entries_to_build: 1,
  min_entries_to_merge: 1,
  max_entries_to_merge: 1,
  min_entries_to_merge_wait_minutes: 0,
  grouping_strategy: "ALLGREEN",
  check_response_timeout_minutes: 120,
};
const QUEUE_CONTEXTS = ["gates", "officina", "web-e2e", "certify"];
/** The full setup of the brief, as `gh api repos/<slug>/rules/branches/master` returns it. */
const QUEUE_RULES: Json[] = [
  { type: "pull_request", parameters: { required_approving_review_count: 0 } },
  { type: "merge_queue", parameters: QUEUE_PARAMS },
  {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: false,
      required_status_checks: QUEUE_CONTEXTS.map((context) => ({ context, integration_id: 15368 })),
    },
  },
];
/** W-199: the queue binding is a file under the Git common directory (read through the fixture `git`, which throws on a failed read). */
const bindingPath = (w: World): string => join(git(w.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "bisellium", "queue", encodeURIComponent(BRANCH));
const rulesWith = (edit: (rules: Json[]) => Json[]): SlotValue => ({ stdout: edit(structuredClone(QUEUE_RULES)) });
const queueParams = (rules: Json[]): Json => rules.find((r) => r["type"] === "merge_queue")!["parameters"] as Json;
const checksRule = (rules: Json[]): Json => rules.find((r) => r["type"] === "required_status_checks")!["parameters"] as Json;
const bound = (w: World): string => readFileSync(bindingPath(w), "utf8");
const modeLine = (o: Out): string | undefined => o.out.split("\n").find((l) => l.startsWith("mode:"));
/** A review-met world whose PR appears once `gh pr create` ran, with `rules` as master's rules. */
function queueWorld(tag: string, rules: SlotValue, advance = true): World {
  const w = reviewed(tag, { mainOnMaster: false });
  if (advance) advanceOrigin(w, "trunk.txt", "a new trunk file changes the SOURCE tree\n");
  const created = join(w.root, "created.flag");
  scenario(w, {
    rules,
    list: { replies: [{ stdout: [] }], alts: [{ ifExists: created, replies: [{ stdout: [cand(w, { state: "OPEN" })] }] }] },
    create: { stdout: `https://github.com/${SLUG}/pull/${PR_NUMBER}\n`, touch: created },
  });
  // W-199: the sandbox's shape, an empty mode-444 lock, so a `git config` write in this clone fails as it does for an agent
  writeFileSync(join(w.repo, ".git", "config.lock"), "", { mode: 0o444 });
  return w;
}

test("W-168-b3 behaviour 3: in queue mode pr binds and pushes the reviewed head without a rebase and the ladder names merge (W-199-b1)", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-queue", { stdout: QUEUE_RULES });
  const head = tipOf(w);
  const o = performPr(w);
  assert.deepEqual(mutating(w), ["git fetch master:master", "git push --force-with-lease", "gh pr create"], ran("queue-mode pr never rebases", o));
  assert.equal(o.status, 0, ran("queue-mode pr exits 0", o));
  assert.equal(o.out.split("\n")[1], "mode: merge-queue", ran("the mode line is the first line of the result", o));
  assert.equal(git(w.origin, ["rev-parse", `refs/heads/${BRANCH}`]), head, "the pushed head is the reviewed head");
  assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, true, "the receipt is still admitted");
  assert.equal(bound(w), `${head}\n`, "the queue binding holds the pushed head");
  assert.deepEqual(unmatched(w), [], "no unexpected gh call");
  const rulesRead = ghCalls(w).filter((a) => a[0] === "api");
  assert.deepEqual(rulesRead, [["api", `repos/${SLUG}/rules/branches/master?per_page=100`]], "one rules read");
  expectStep(next(w, [OPUS]), "merge", "named", "the ladder goes on to merge, not build");
});

test("W-168-b3 behaviour 3: a binding that cannot be written holds the queue-mode pr before any push (W-199-b1)", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-lock", { stdout: QUEUE_RULES });
  const blocker = join(w.repo, ".git", "bisellium");
  writeFileSync(blocker, "a regular file where the binding directory belongs\n");
  const o = performPr(w);
  assert.deepEqual(mutating(w), ["git fetch master:master"], ran("no push when the binding cannot be written", o));
  assert.equal(o.status, 1, ran("held", o));
  assert.equal(remoteBranchExists(w), false, "nothing was pushed");
  assert.equal(o.out.split("\n")[1], "mode: merge-queue", ran("the mode line precedes the why", o));
  const why = o.out.split("\n").find((l) => l.startsWith("why:"));
  assert.ok(why?.startsWith("why: cannot write the queue binding ") && why.includes("bisellium/queue/opus%2FW-900"), ran("the why names the binding file", o));
  assert.equal(lstatSync(blocker).isFile(), true, "the blocking file is untouched");
});

test("W-168-b3 behaviour 3: a direct-mode pr after a queue-mode pr pushes and unsets the binding (W-199-b1)", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-unset", { stdout: QUEUE_RULES }, false);
  const first = performPr(w);
  assert.equal(first.status, 0, ran("queue-mode pr", first));
  const old = bound(w).trim();
  assert.notEqual(old, "", "the binding is set");
  put(w.wtStudio, "notes.md", "bookkeeping line\nmore bookkeeping\n");
  commit(w.wt, "studio: bookkeeping after the push");
  scenario(w, { list: openList(w, { state: "OPEN", oid: old }) });
  const o = performPr(w);
  assert.deepEqual(mutating(w), ["git fetch master:master", "git rebase", "git push --force-with-lease"], ran("direct-mode pr rebases and pushes", o));
  assert.equal(o.out.split("\n")[1], "mode: direct", ran("the mode line", o));
  assert.equal(lstatSync(bindingPath(w), { throwIfNoEntry: false }), undefined, "the binding is gone after the push");
  assert.equal(git(w.origin, ["rev-parse", `refs/heads/${BRANCH}`]), tipOf(w), "the new tip was pushed");
});

test("W-199-b1 behaviour 1: a direct-mode pr holds before the rebase when the binding cannot be read", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w199-b1-unreadable", { stdout: [] });
  writeFileSync(join(w.repo, ".git", "bisellium"), "a regular file where the binding directory belongs\n");
  const before = tipOf(w);
  const o = performPr(w);
  assert.equal(o.status, 1, ran("held", o));
  const why = o.out.split("\n").find((l) => l.startsWith("why:"));
  assert.ok(why?.startsWith("why: cannot read the queue binding:"), ran("the why", o));
  assert.equal(tipOf(w), before, "no rebase");
  assert.equal(remoteBranchExists(w), false, "nothing was pushed");
});

test("W-199-b1 behaviour 1: a direct-mode pr that pushed but cannot remove the binding holds before gh pr create", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w199-b1-undeletable", { stdout: [] }, false);
  mkdirSync(bindingPath(w), { recursive: true });
  const o = performPr(w);
  assert.equal(o.status, 1, ran("held", o));
  const why = o.out.split("\n").find((l) => l.startsWith("why:"));
  assert.ok(why?.startsWith("why: pushed, but the queue binding "), ran("the why", o));
  assert.equal(git(w.origin, ["rev-parse", `refs/heads/${BRANCH}`]), tipOf(w), "the head was pushed");
  assert.equal(lstatSync(bindingPath(w)).isDirectory(), true, "the obstacle is still there");
  assert.equal(existsSync(join(w.root, "created.flag")), false, "no gh pr create");
});

/** Each reply is direct mode: today's rebase and hold, the mode line, no queue call. */
function expectDirect(variants: [string, SlotValue][]): void {
  for (const [row, rules] of variants) {
    const w = reviewed(`w168-b3-direct-${row.replace(/\W+/g, "-")}`, { mainOnMaster: false });
    advanceOrigin(w, "trunk.txt", "a new trunk file changes the SOURCE tree\n");
    scenario(w, { rules });
    const o = performPr(w);
    assert.deepEqual(mutating(w), ["git fetch master:master", "git rebase"], ran(`${row}: today's rebase and hold`, o));
    assert.equal(modeLine(o), "mode: direct", ran(`${row}: mode: direct`, o));
    assert.match(o.out, /\bbuild\b/, ran(`${row}: re-derives build`, o));
    assert.deepEqual(unmatched(w), [], `${row}: no unexpected gh call`);
  }
}

test("W-168-b3 behaviour 3: any reply short of the full setup is direct mode and keeps today's calls", { timeout: 3_600_000 }, () => {
  const drop = (key: string) => (rules: Json[]): Json[] => {
    delete queueParams(rules)[key];
    return rules;
  };
  const variants: [string, SlotValue][] = [
    ["no merge-queue rule", rulesWith((r) => r.filter((x) => x["type"] !== "merge_queue"))],
    ["a second merge-queue entry", rulesWith((r) => [...r, structuredClone(r.find((x) => x["type"] === "merge_queue")!)])],
    ["max_entries_to_build 4", rulesWith((r) => ((queueParams(r)["max_entries_to_build"] = 4), r))],
    ["merge_method MERGE", rulesWith((r) => ((queueParams(r)["merge_method"] = "MERGE"), r))],
    ["a wait of 5 minutes", rulesWith((r) => ((queueParams(r)["min_entries_to_merge_wait_minutes"] = 5), r))],
    ["grouping HEADGREEN", rulesWith((r) => ((queueParams(r)["grouping_strategy"] = "HEADGREEN"), r))],
    ["a 60 minute timeout", rulesWith((r) => ((queueParams(r)["check_response_timeout_minutes"] = 60), r))],
    ["a removed parameter", rulesWith(drop("max_entries_to_merge"))],
    ["an extra parameter", rulesWith((r) => ((queueParams(r)["extra"] = true), r))],
    ["no required-checks rule", rulesWith((r) => r.filter((x) => x["type"] !== "required_status_checks"))],
    ...QUEUE_CONTEXTS.map((context): [string, SlotValue] => [
      `${context} missing`,
      rulesWith((r) => {
        const p = checksRule(r);
        p["required_status_checks"] = (p["required_status_checks"] as Json[]).filter((c) => c["context"] !== context);
        return r;
      }),
    ]),
    [
      "certify without an integration_id",
      rulesWith((r) => {
        delete (checksRule(r)["required_status_checks"] as Json[]).find((c) => c["context"] === "certify")!["integration_id"];
        return r;
      }),
    ],
    [
      "gates with another integration_id",
      rulesWith((r) => {
        (checksRule(r)["required_status_checks"] as Json[]).find((c) => c["context"] === "gates")!["integration_id"] = 1234;
        return r;
      }),
    ],
    ["a strict second required-checks rule", rulesWith((r) => [...r, { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [] } }])],
    ["100 entries", rulesWith((r) => [...r, ...Array.from({ length: 100 - r.length }, () => ({ type: "deletion" }))])],
    ["a gh exit 1", { exit: 1, stderr: "HTTP 500" }],
    ["a non-array reply", { stdout: { message: "Not Found" } }],
  ];
  expectDirect(variants);
});

test("W-168-b3 behaviour 3: a malformed part anywhere in the reply is direct mode, never filtered out", { timeout: 3_600_000 }, () => {
  const addCheck = (member: unknown) => (rules: Json[]): Json[] => {
    const list = checksRule(rules)["required_status_checks"] as unknown[];
    list.unshift(member);
    return rules;
  };
  expectDirect([
    ["a null required-status-check member", rulesWith(addCheck(null))],
    ["a string required-status-check member", rulesWith(addCheck("gates"))],
    ["a member with a non-string context", rulesWith(addCheck({ context: 7, integration_id: 15368 }))],
    ["a member with a non-numeric integration_id", rulesWith(addCheck({ context: "extra", integration_id: "15368" }))],
    [
      "a second required-checks rule whose list is not an array",
      rulesWith((r) => [...r, { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: "gates" } }]),
    ],
    ["a null rule entry beside the valid ones", rulesWith((r) => [...r, null as unknown as Json])],
    ["a rule entry with a non-string type beside the valid ones", rulesWith((r) => [...r, { type: 5 }])],
    ["a rule whose parameters are not an object", rulesWith((r) => [...r, { type: "deletion", parameters: "x" }])],
    ["a required-checks rule without a boolean strict flag", rulesWith((r) => ((checksRule(r)["strict_required_status_checks_policy"] = "false"), r))],
  ]);
});

test("W-168-b3 behaviour 3: a tracked change holds pr with today's lines and no mode line", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-dirty", { stdout: QUEUE_RULES });
  appendFileSync(join(w.wtStudio, "notes.md"), "uncommitted bookkeeping edit\n");
  const o = performPr(w);
  expectHeld(o, "a tracked change holds");
  assert.equal(modeLine(o), undefined, ran("no mode line before the mode read", o));
  assert.deepEqual(mutating(w), [], "nothing was fetched or pushed");
});

const CONFLICT_WHY = `why: PR #${PR_NUMBER} conflicts with master; rebase ${BRANCH} and resolve it there: that changes the SOURCE tree and needs the local mint again`;
const lineAfter = (o: Out, prefix: string): string | undefined => o.out.split("\n").find((l) => l.startsWith(prefix));

test("W-168-b4 behaviour 4: in queue mode merge enqueues once and never updates the branch", { timeout: 3_600_000 }, () => {
  const w = pushed("w168-b4-behind");
  const flag = join(w.root, "merged.flag");
  const m = landMerge(w, false);
  scenario(w, {
    rules: { stdout: QUEUE_RULES },
    list: openList(w),
    view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m })) }] }] },
    merge: { replies: [{ stdout: "", touch: flag }] },
  });
  const o = performMerge(w);
  assert.deepEqual(mutating(w), ["gh pr merge --squash --auto", "git fetch master:master"], ran("a BEHIND PR is enqueued, never updated", o));
  assert.match(o.out, /state=MERGED/, ran("and lands", o));
  assert.equal(o.out.split("\n")[1], "mode: merge-queue", ran("the mode line comes first", o));
  assert.equal(ghCalls(w).filter((a) => a[0] === "api" && a[1] === `repos/${SLUG}/rules/branches/master?per_page=100`).length, 2, "the rules are read, then read again just before the merge call");
  assert.deepEqual(unmatched(w), [], "no unexpected gh call");
});

test("W-168-b4 behaviour 4: a queued CLEAN PR gets no second merge call", { timeout: 3_600_000 }, () => {
  const w = pushed("w168-b4-clean");
  scenario(w, { rules: { stdout: QUEUE_RULES }, list: openList(w), view: { stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) } });
  const o = performMerge(w);
  assert.equal(ghMerges(w).length, 1, ran("exactly one gh pr merge call", o));
  assert.deepEqual(mutating(w), ["gh pr merge --squash --auto"], "no direct merge and no update-branch");
  assert.match(o.out, /state=QUEUE_TIMEOUT/, ran("and the poll runs out", o));
});

test("W-168-b4 behaviour 4: a DIRTY PR holds as a conflict in queue mode", { timeout: 3_600_000 }, () => {
  const before = pushed("w168-b4-dirty");
  scenario(before, { rules: { stdout: QUEUE_RULES }, list: openList(before), view: { stdout: viewOf(cand(before, { state: "OPEN", mss: "DIRTY" })) } });
  const o = performMerge(before);
  assert.deepEqual(mutating(before), [], ran("a DIRTY PR is never merged or updated", o));
  assert.match(o.out, /state=CONFLICT/, ran("state=CONFLICT", o));
  assert.ok(o.out.split("\n").includes(CONFLICT_WHY), ran("with the conflict why", o));
  assert.equal(o.status, 1);

  const after = pushed("w168-b4-dirty-after");
  const flag = join(after.root, "merged.flag");
  scenario(after, {
    rules: { stdout: QUEUE_RULES },
    list: openList(after),
    view: { replies: [{ stdout: viewOf(cand(after, { state: "OPEN" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(after, { state: "OPEN", mss: "DIRTY" })) }] }] },
    merge: { replies: [{ stdout: "", touch: flag }] },
  });
  const o2 = performMerge(after);
  assert.deepEqual(mutating(after), ["gh pr merge --squash --auto"], ran("one merge call, then the hold", o2));
  assert.match(o2.out, /state=CONFLICT/, ran("a PR that turns DIRTY after the request holds", o2));
  assert.ok(o2.out.split("\n").includes(CONFLICT_WHY), ran("with the conflict why", o2));
});

test("W-168-b4 behaviour 4: a changed setup at the recheck holds with nothing enqueued", { timeout: 3_600_000 }, () => {
  const w = pushed("w168-b4-recheck");
  scenario(w, { rules: { replies: [{ stdout: QUEUE_RULES }, { stdout: [] }] }, list: openList(w) });
  const o = performMerge(w);
  assert.deepEqual(mutating(w), [], ran("no gh write after the setup changed", o));
  assert.ok(o.out.includes("why: master's merge-queue setup changed while the merge step ran; nothing was enqueued"), ran("the why", o));
  assert.equal(o.out.split("\n")[1], "mode: merge-queue");
  assert.equal(o.status, 1);
});

/** W-199: a direct-mode merge of a PR whose binding is present or unreadable holds with W-168's why, before any gh write. */
function expectBoundHold(w: World, row: string): void {
  const updated = join(w.root, "updated.flag");
  const flag = join(w.root, "merged.flag");
  scenario(w, { rules: { stdout: [] }, list: openList(w), update: { stdout: "", touch: updated }, merge: { replies: [{ stdout: "", touch: flag }] } });
  const o = performMerge(w);
  assert.deepEqual(mutating(w), [], ran(`${row}: a PR pushed for the queue is held when the queue is gone`, o));
  assert.equal(o.out.split("\n")[1], "mode: direct", ran(`${row}: the mode line`, o));
  assert.ok(
    o.out.includes(`why: PR #${PR_NUMBER} was pushed for the merge queue without a rebase, and master no longer enforces the queue; rebase ${BRANCH} onto master, which changes the SOURCE tree and needs the local mint again`),
    ran(`${row}: the why`, o),
  );
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(ghMerges(w).length, 0, `${row}: no gh pr merge`);
  assert.equal(existsSync(flag) || existsSync(updated), false, `${row}: no gh write reached the stub`);
  assert.ok(
    ghCalls(w).some((a) => a.length === 2 && a[0] === "api" && a[1] === `repos/${SLUG}/rules/branches/master?per_page=100`),
    `${row}: the rules were read`,
  );
}

test("W-168-b4 behaviour 4: in direct mode a bound PR holds and an unbound one keeps today's calls (W-199-b2)", { timeout: 3_600_000 }, () => {
  const bound = pushed("w168-b4-bound");
  const file = bindingPath(bound);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${tipOf(bound)}\n`);
  expectBoundHold(bound, "bound");

  const w = pushed("w168-b4-unbound");
  const updated = join(w.root, "updated.flag");
  const flag = join(w.root, "merged.flag");
  const m = landMerge(w, false);
  scenario(w, {
    list: openList(w),
    view: {
      replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }],
      alts: [
        { ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m })) }] },
        { ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) }] },
      ],
    },
    update: { stdout: "", touch: updated },
    merge: { replies: [{ stdout: "", touch: flag }] },
  });
  const o2 = performMerge(w);
  assert.deepEqual(mutating(w), ["gh pr update-branch", "gh pr merge --squash --auto", "git fetch master:master"], ran("direct mode with no binding updates a BEHIND PR", o2));
  assert.equal(o2.out.split("\n")[1], "mode: direct", ran("the mode line", o2));

  const merged = pushed("w168-b4-merged");
  const mergedM = landMerge(merged, false);
  scenario(merged, { rules: { stdout: QUEUE_RULES }, list: mergedList(merged, { merge: mergedM }) });
  const o3 = performMerge(merged);
  assert.match(o3.out, /state=MERGED/, ran("an already-MERGED PR lands", o3));
  assert.equal(lineAfter(o3, "mode:"), undefined, ran("and reads no mode", o3));
});

test("W-199-b2 behaviour 2: a direct-mode merge holds a PR whose binding cannot be read", { timeout: 3_600_000 }, () => {
  const w = pushed("w199-b2-unreadable");
  writeFileSync(join(w.repo, ".git", "bisellium"), "a regular file where the binding directory belongs\n");
  expectBoundHold(w, "unreadable");
});

// ---------------------------------------------------------------------------
// W-197 behaviour 1: `.github/` is a Patron path for every existing Patron hold
// ---------------------------------------------------------------------------
const CI_YML = ".github/workflows/ci.yml";
/** What a hold must leave byte-identical, read only through the fixture `git` (it throws on a failed read) and `readFileSync`. */
const frozenGithub = (w: World): string =>
  [git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["ls-files", "-s"]), git(w.repo, ["status", "--porcelain"]), readFileSync(join(w.repo, CI_YML), "utf8")].join("\n--\n");

test("W-197-b1 behaviour 1: .github/ is a Patron path for every existing Patron hold", { timeout: 1_800_000 }, () => {
  // merge: the reviewed merge commit changes a .github/ path
  const w = reviewed(
    "w197-b1-merge",
    { github: true },
    (x) => {
      put(x.wt, CI_YML, "name: ci v2\n");
      commit(x.wt, `feat(${OPUS}): workflow change`);
      writeReceipt(x, "current");
    },
    true,
  );
  const m = landMerge(w, false);
  scenario(w, { list: mergedList(w, { merge: m }) });
  expectStep(next(w, [OPUS]), "merge", "named", "the world sits at merge");
  const before = frozenGithub(w);
  const held = performMerge(w);
  expectHeld(held, "merge: held");
  assert.equal(frozenGithub(w), before, ran("merge: nothing is mutated (HEAD, master, index, status, ci.yml bytes)", held));
  const lines = outLines(held);
  const why = lines.findIndex((l) => l === `why: refusing: incoming paths belong to the Patron (${CI_YML}); the main checkout is untouched`);
  assert.notEqual(why, -1, ran("merge: the why line names the .github/ path", held));
  assert.equal(lines[why - 1], `state=MERGED_NOT_FETCHED`, ran("merge: the state line precedes the why line", held));
  assert.equal(lines[why + 1], `patron: git -C ${w.repo} merge --ff-only ${m}`, ran("merge: the patron line follows the why line", held));
  // the Patron runs that exact line, and next moves on
  const [bin, ...args] = lines[why + 1]!.slice("patron: ".length).split(" ");
  assert.equal(bin, "git");
  git(w.root, args);
  expectStep(next(w, [OPUS]), "cleanup", "named", "after the Patron's command next derives cleanup");

  // branch and done: a tracked edit to a .github/ path holds the rung and prints the Patron's checkout line
  const dirtyRow = (row: string, o: Out, w2: World, was: string): void => {
    expectHeld(o, row);
    assert.equal(frozenGithub(w2), was, ran(`${row}: nothing is mutated`, o));
    const ls = outLines(o);
    const at = ls.indexOf("why: refusing: the working tree has tracked changes");
    assert.notEqual(at, -1, ran(`${row}: the why line`, o));
    assert.ok(ls.indexOf(`dirty: M ${CI_YML}`) > at, ran(`${row}: the dirty line follows the why line`, o));
    assert.ok(ls.indexOf(`patron: git -C ${w2.repo} checkout -- ${CI_YML}`) > at, ran(`${row}: the patron checkout line`, o));
  };
  const b = world("w197-b1-branch", "spec", { github: true });
  appendFileSync(join(b.repo, CI_YML), "edit\n");
  const bBefore = frozenGithub(b);
  dirtyRow("branch", next(b, [OPUS, "--perform", "--expect", "branch"]), b, bBefore);
  assert.equal(git(b.repo, ["for-each-ref", "--format=%(refname)", `refs/heads/${BRANCH}`]), "", "branch: no branch was cut");
  const d = world("w197-b1-done", "cleanup", { github: true });
  scenario(d, { list: mergedList(d) });
  appendFileSync(join(d.repo, CI_YML), "edit\n");
  const dBefore = frozenGithub(d);
  dirtyRow("done", next(d, [OPUS, "--perform", "--expect", "done"]), d, dBefore);
  assert.equal(git(d.repo, ["for-each-ref", "--format=%(refname)", `refs/heads/chore/done-${OPUS}`]), "", "done: no chore branch was made");

  // renames: out of .github/ restores the original from HEAD, into .github/ takes the destination out of the index
  const out = world("w197-b1-rename-out", "spec", { github: true });
  git(out.repo, ["mv", CI_YML, "docs/ci.yml"]);
  const outHeld = next(out, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(outHeld, "branch with a staged rename out of .github/");
  assert.ok(outLines(outHeld).includes(`patron: git -C ${out.repo} checkout HEAD -- ${CI_YML}`), ran("rename out: checkout HEAD of the original", outHeld));
  const into = world("w197-b1-rename-into", "spec", { github: true });
  git(into.repo, ["mv", "README.md", ".github/readme.md"]);
  const intoHeld = next(into, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(intoHeld, "branch with a staged rename into .github/");
  assert.ok(outLines(intoHeld).includes(`patron: git -C ${into.repo} rm --cached -q -- .github/readme.md`), ran("rename into: rm --cached of the destination", intoHeld));
});

// ---------------------------------------------------------------------------
// W-197 behaviour 2: the GitHub owner rule covers .github/, itself included
// ---------------------------------------------------------------------------
test("W-197-b2 behaviour 2: .github/CODEOWNERS names @edckt for /.github/, itself included", () => {
  const path = join(REPO_ROOT, ".github/CODEOWNERS");
  assert.ok(existsSync(path), ".github/CODEOWNERS exists");
  assert.equal(readFileSync(path, "utf8"), "/.github/ @edckt\n");
});

// ---------------------------------------------------------------------------
// W-197 pin: the code-owner setting does not change the merge-queue mode
// ---------------------------------------------------------------------------
/** Master's active rules as the live reply read on 2026-10-09, with the two booleans the Patron's setup turns on. */
const LIVE_RULES_WITH_OWNER_REVIEW: Json[] = [{"type": "deletion", "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "non_fast_forward", "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "pull_request", "parameters": {"required_approving_review_count": 0, "dismiss_stale_reviews_on_push": true, "required_reviewers": [], "require_code_owner_review": true, "dismissal_restriction": {"enabled": false, "allowed_actors": []}, "require_last_push_approval": false, "required_review_thread_resolution": true, "require_extra_approval_for_unattributed_changes": true, "allowed_merge_methods": ["merge", "squash", "rebase"]}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false, "do_not_enforce_on_create": false, "required_status_checks": [{"context": "gates", "integration_id": 15368}, {"context": "officina", "integration_id": 15368}, {"context": "web-e2e", "integration_id": 15368}, {"context": "certify", "integration_id": 15368}]}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "code_scanning", "parameters": {"code_scanning_tools": [{"tool": "CodeQL", "security_alerts_threshold": "medium_or_higher", "alerts_threshold": "errors_and_warnings"}]}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "code_quality", "parameters": {"severity": "errors"}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "merge_queue", "parameters": {"merge_method": "SQUASH", "max_entries_to_build": 1, "min_entries_to_merge": 1, "max_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0, "grouping_strategy": "ALLGREEN", "check_response_timeout_minutes": 120}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}];

test("W-197 pin: the pull_request rule's code-owner and stale-review booleans leave the mode merge-queue", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w197-pin", { stdout: LIVE_RULES_WITH_OWNER_REVIEW });
  const o = performPr(w);
  assert.equal(modeLine(o), "mode: merge-queue", ran("the mode line", o));
});
