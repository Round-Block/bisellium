/**
 * W-179: the shared fixture of the next.test.ts rows, split by behaviour group into the packages/cli/src/next*.test.ts
 * files package.json's test:suite runs side by side. It registers no row; each importing file gets its own copy
 * (its own process under node --test), so its scratch roots, stub bin and after() hook are that file's own.
 *
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";
import { sourceTreeHash } from "@bisellium/shim";
import { editOpusFrontMatter } from "@bisellium/commands/frontmatter.js";


export const argv = process.argv.slice(2);
export const behaviourAt = argv.indexOf("--behaviour");
export const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 6)) {
  console.error("next.test.ts: --behaviour must be an integer from 1 through 6");
  process.exit(2);
}
export const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

export const OPUS = "W-900";
export const BRANCH = `opus/${OPUS}`;
export const NOW_ISO = "2026-10-02T12:00:00.000Z";
export const NOW_MS = Date.parse(NOW_ISO);
export const T = {
  spec: "2026-10-02T01:00:00.000Z",
  ready: "2026-10-02T02:00:00.000Z",
  reds: "2026-10-02T03:00:00.000Z",
  review1: "2026-10-02T06:00:00.000Z",
  review2: "2026-10-02T07:00:00.000Z",
  done: "2026-10-02T10:00:00.000Z",
  handoffFresh: "2026-10-02T09:00:00.000Z",
  handoffStale: "2026-10-02T02:30:00.000Z",
};
export const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "main.ts");
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const TSX = import.meta.resolve("tsx");
export const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
export const FAST = ["--poll-ms", "1", "--max-polls", "3"];

// ---------------------------------------------------------------------------
// scratch, git, cli helpers
// ---------------------------------------------------------------------------
export const roots: string[] = [];
export const children: ChildProcess[] = [];
export function scratch(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `w124-${tag}-`));
  roots.push(root);
  return root;
}
after(() => {
  for (const child of children) child.kill("SIGKILL");
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

export const SETUP_ENV: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"] ?? "/usr/bin:/bin",
  HOME: scratch("home"),
  TMPDIR: tmpdir(),
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

export function git(cwd: string, args: string[], check = true): string {
  const r = spawnSync("git", args, { cwd, env: SETUP_ENV, encoding: "utf8", timeout: 60_000 });
  if (check && r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.stderr}${r.stdout}`);
  return (r.stdout ?? "").trim();
}
/** git whose failure is data (an empty string), for reads of refs the verb should have made. */
export const gitq = (cwd: string, args: string[]): string => git(cwd, args, false);
export const gitOk = (cwd: string, args: string[]): boolean => spawnSync("git", args, { cwd, env: SETUP_ENV, timeout: 60_000 }).status === 0;
/** W-199: a git read with two valid answers, exit 0 (true) and exit 1 (false); any other exit or a spawn error throws. */
export function gitYesNo(cwd: string, args: string[]): boolean {
  const r = spawnSync("git", args, { cwd, env: SETUP_ENV, encoding: "utf8", timeout: 60_000 });
  if (r.error !== undefined || (r.status !== 0 && r.status !== 1)) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.error?.message ?? r.stderr}`);
  return r.status === 0;
}

export function put(dir: string, rel: string, text: string): void {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
export function commit(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  if (!gitYesNo(dir, ["diff", "--cached", "--quiet"])) git(dir, ["commit", "-q", "-m", message]);
}
/** A REAL bisellium verb, run the way an operator would, in `cwd`. */
export function verb(cwd: string, args: string[]): void {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd, env: SETUP_ENV, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`fixture bisellium ${args.join(" ")} (cwd ${cwd}) exited ${r.status}: ${r.stderr}${r.stdout}`);
}

// ---------------------------------------------------------------------------
// the stub gh and the git shim (single scenario source; see scenario())
// ---------------------------------------------------------------------------
export const GH_STUB = String.raw`#!/usr/bin/env node
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
if (reply.files) {
  const path = require("node:path");
  const into = argv[argv.indexOf("-D") + 1];
  for (const [rel, text] of Object.entries(reply.files)) {
    fs.mkdirSync(path.dirname(path.join(into, rel)), { recursive: true });
    fs.writeFileSync(path.join(into, rel), text);
  }
}
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
export const GIT_SHIM = String.raw`#!/bin/sh
if [ -n "${"$"}{GIT_STUB_LOG:-}" ]; then
  { printf 'git'; for a in "$@"; do printf '\037%s' "$a"; done; printf '\n'; } >> "$GIT_STUB_LOG"
fi
exec "$GIT_STUB_REAL" "$@"
`;
export const BIN = scratch("bin");
writeFileSync(join(BIN, "gh"), GH_STUB, { mode: 0o755 });
writeFileSync(join(BIN, "git"), GIT_SHIM, { mode: 0o755 });

// ---------------------------------------------------------------------------
// captured real gh shapes (packages/cli/src/fixtures/gh, see provenance.json)
// ---------------------------------------------------------------------------
export const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/gh/${name}`, import.meta.url), "utf8"));
export const SLUG = (fx("repo-view.json") as { nameWithOwner: string }).nameWithOwner;
export const CAND = (fx("pr-list-150.json") as Record<string, unknown>[])[0]!;
export const CHECKS = fx("pr-checks.json") as { name: string; bucket: string; state: string }[];
export const PR_NUMBER = 901;

export type Json = Record<string, unknown>;
export const OID_UNFETCHED = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export interface CandOpts {
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
export function cand(w: World, o: CandOpts): Json {
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
export function viewOf(c: Json): Json {
  const out: Json = {};
  for (const key of ["number", "state", "mergeStateStatus", "headRefName", "headRefOid", "baseRefName", "mergeCommit"]) if (key in c) out[key] = c[key];
  return out;
}
export const greens = (n = 6): Json[] => Array.from({ length: n }, (_, i) => ({ ...CHECKS[i % CHECKS.length]!, name: `${CHECKS[i % CHECKS.length]!.name} ${i}` }));
export const check = (name: string, bucket: string): Json => ({ name, bucket, state: bucket === "pass" ? "SUCCESS" : bucket === "fail" ? "FAILURE" : "PENDING" });

export interface Reply {
  stdout?: unknown;
  stderr?: string;
  exit?: number;
  bytes?: number;
  touch?: string;
  /** W-259: files written under the call's -D directory, as gh run download writes an artifact */
  files?: Record<string, string>;
}
export interface Alt {
  ifExists?: string;
  ifMissing?: string;
  replies: Reply[];
}
export interface Rule {
  replies: Reply[];
  alts?: Alt[];
}
export type SlotName = "repoView" | "list" | "view" | "checks" | "rules" | "alerts" | "update" | "merge" | "create" | "runList" | "runView" | "runDownload";
export const SLOT_MATCH: Record<SlotName, string[]> = {
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
  // W-259: the merge queue's CI run for a merge commit, its jobs and its certify artifact
  runList: ["run", "list"],
  runView: ["run", "view"],
  runDownload: ["run", "download"],
};
export type SlotValue = Reply | Reply[] | Rule;
export const asRule = (v: SlotValue): Rule => (Array.isArray(v) ? { replies: v } : "replies" in v ? v : { replies: [v] });

// ---------------------------------------------------------------------------
// the world: a repository, a bare origin, a studio, built with real verbs
// ---------------------------------------------------------------------------
export interface World {
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
export const STAGES = ["greenlight", "spec", "branch", "ready", "reds", "build", "review", "pr", "merge", "cleanup", "done", "retro", "checkpoint"] as const;
export type Stage = (typeof STAGES)[number];
export const idx = (s: Stage | "backlog"): number => (s === "backlog" ? -1 : STAGES.indexOf(s));

export interface WorldOpts {
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

export const MANIFEST = [
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

export function briefText(behaviours: number): string {
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
export function recordText(fields: Json): string {
  const base: Json = { id: OPUS, title: "W-124 fixture: the cascade ladder", kind: "opus", collegium: "engineering", ...fields };
  const lines = Object.entries(base)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\nFixture body.\n`;
}
export const tipOf = (w: World): string => git(w.repo, ["rev-parse", `refs/heads/${BRANCH}`]);
export const headOf = (w: World): string => (gitYesNo(w.repo, ["show-ref", "--verify", "--quiet", `refs/heads/${BRANCH}`]) ? tipOf(w) : w.headOid!);
export const sourceTree = (dir: string): string => `tree:${sourceTreeHash(dir, ["studio", ".bisellium"], "HEAD")}`;

export function writeTranscript(w: World, name: string, body = "No findings"): string {
  const path = join(w.root, name);
  writeFileSync(path, `## Findings\n${body}\n`);
  return path;
}
export function signSpec(w: World, dir: string): void {
  put(dir, "studio/briefs/W-900.md", briefText(w.behaviours));
  verb(dir, ["verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, "spec.md"), "--studio", join(dir, "studio"), "--now", T.spec]);
  commit(dir, `spec(${OPUS}): signed`);
}
export function writeReds(w: World, kinds: Record<number, "good" | "dirty" | "moduleload" | "exit0"> = {}): void {
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
export function writeReceipt(w: World, kind: "current" | "stale"): void {
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
export function addReview(w: World, outcome: "passed" | "failed", round: number, at: string, body = outcome === "failed" ? "1. blocking: fixture defect at brief:1 [severity: S1]. check: none: fixture" : "No findings", extra: string[] = []): void {
  verb(w.wt, ["verdict", OPUS, "--round", String(round), "--sella", "qa-lead", "--outcome", outcome, "--from", writeTranscript(w, `review-${round}.md`, body), "--studio", w.wtStudio, "--now", at, ...extra]);
  verb(w.wt, ["review", OPUS, outcome === "passed" ? "--pass" : "--fail", "--evidence", `ci/${OPUS}-review-${round}.log`, "--round", String(round), "--sella", "qa-lead", "--studio", w.wtStudio, "--now", at]);
  commit(w.wt, `studio(${OPUS}): review round ${round} ${outcome}`);
}
/** A new SOURCE commit on the opus branch; the receipt follows it unless asked not to. */
export function advanceSource(w: World, refresh = true): void {
  appendFileSync(join(w.wt, "source.txt"), `change ${Date.now()}\n`);
  commit(w.wt, `feat(${OPUS}): source change`);
  if (refresh) writeReceipt(w, "current");
}
export function landMerge(w: World, fetched: boolean, moved = false): string {
  const side = join(scratch(`${w.tag}-side`), "c");
  git(dirname(side), ["clone", "-q", w.origin, side]);
  let tree = git(side, ["rev-parse", `origin/${BRANCH}^{tree}`]);
  if (moved) {
    // W-312: the queue's merge result carries a source move of master's, as most real merges do, so the branch's own gates
    // certify the branch's tree, not the merge's
    git(side, ["read-tree", tree]);
    put(side, "moved.txt", "master moved\n");
    git(side, ["update-index", "--add", "moved.txt"]);
    tree = git(side, ["write-tree"]);
  }
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
export function removeBranchAndWorktree(w: World): void {
  if (existsSync(w.wt)) git(w.repo, ["worktree", "remove", "--force", w.wt]);
  git(w.repo, ["branch", "-D", BRANCH], false);
  git(w.repo, ["push", "-q", "origin", "--delete", BRANCH], false);
  git(w.repo, ["update-ref", "-d", `refs/remotes/origin/${BRANCH}`], false);
}
export function ensureMaster(w: World): void {
  if (git(w.repo, ["symbolic-ref", "-q", "HEAD"], false) !== "refs/heads/master") git(w.repo, ["switch", "-q", "master"]);
}
/** A handoff that names the opus under the old `Where things stand` heading (the new rule does not read it). */
export const HANDOFF_DONE = `# Handoff\n\n## Where things stand\n\n- ${OPUS} done, merged, fetched (fixture)\n`;
/** The done record is committed with `handoff` (the checkpoint) when one is given, as `next` commits them together. */
export function markDone(w: World, onChore: boolean, handoff?: string): void {
  ensureMaster(w);
  if (onChore) git(w.repo, ["switch", "-q", "-c", `chore/done-${OPUS}`]);
  verb(w.repo, ["done", OPUS, "--sella", "producer", "--studio", w.studio, "--now", T.done]);
  if (handoff !== undefined) put(w.repo, "docs/SESSION-HANDOFF.md", handoff);
  commit(w.repo, `chore(studio): mark ${OPUS} done`);
  if (onChore) git(w.repo, ["switch", "-q", "master"]);
  else git(w.repo, ["push", "-q", "origin", "master"]);
}
/** A tracked edit to the handoff: the checkpoint a `done` perform commits with the record. */
export const touchHandoff = (w: World): void => appendFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), "- checkpoint line\n");

/** Build a fixture officina in which every rung up to and including `upTo` is met. */
export function world(tag: string, upTo: Stage | "backlog", o: WorldOpts = {}): World {
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
  put(w.repo, "docs/SESSION-HANDOFF.md", "# Handoff\n\n## Queue\n\n- (nothing queued)\n");
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
  // W-312: an automated world's builder leaves its gate logs at the tip, as its `ci --opus` would
  if (reach >= idx("build") && o.automated) writeGates(w);
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
  if (reach >= idx("merge")) landMerge(w, o.fetched ?? true, o.automated ?? false);
  if (reach >= idx("cleanup")) removeBranchAndWorktree(w);
  if (reach >= idx("done")) markDone(w, false, reach >= idx("checkpoint") ? HANDOFF_DONE : undefined);
  return w;
}

export function scenario(w: World, over: Partial<Record<SlotName, SlotValue>>): void {
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
    runList: { stdout: [] },
    runView: { stdout: { jobs: [] } },
    runDownload: { exit: 1, stderr: "no artifact" },
  };
  const rules = (Object.keys(SLOT_MATCH) as SlotName[]).map((slot) => ({ match: SLOT_MATCH[slot], ...asRule(over[slot] ?? defaults[slot]) }));
  writeFileSync(w.scn, JSON.stringify({ rules }));
  rmSync(`${w.scn}.state`, { force: true });
  rmSync(w.log, { force: true });
}
/** The common "open PR on the current tip" scenario with a merge that lands. */
export const openList = (w: World, extra: CandOpts = { state: "OPEN" }): SlotValue => ({ stdout: [cand(w, extra)] });

// ---------------------------------------------------------------------------
// running the verb, reading the stub logs
// ---------------------------------------------------------------------------
export interface Out {
  status: number | null;
  out: string;
  err: string;
  first: string;
  kv: Map<string, string>;
}
export function parse(status: number | null, out: string, err: string): Out {
  const kv = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = /^([A-Za-z_-]+): (.*)$/.exec(line);
    if (m && !kv.has(m[1]!)) kv.set(m[1]!, m[2]!);
  }
  return { status, out, err, first: out.split("\n")[0] ?? "", kv };
}
export interface RunOpts {
  env?: Record<string, string | undefined>;
  /** BISELLIUM_TEST_CLOCK=1 and --now (default true). */
  clock?: boolean;
  cwd?: string;
  /** Do not add --repo/--studio. */
  bare?: boolean;
}
export function envFor(w: World, o: RunOpts): NodeJS.ProcessEnv {
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
export function nextArgs(w: World, args: string[], o: RunOpts): string[] {
  const full = [...args];
  if (!o.bare) full.push("--repo", w.repo, "--studio", w.studio);
  if ((o.clock ?? true) && !full.includes("--now")) full.push("--now", NOW_ISO);
  return full;
}
export function next(w: World, args: string[], o: RunOpts = {}): Out {
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
export function nextAsync(w: World, args: string[], o: RunOpts = {}): { child: ChildProcess; done: Promise<Out> } {
  const child = spawn(process.execPath, ["--import", TSX, MAIN, "next", ...nextArgs(w, args, o)], { cwd: o.cwd ?? w.repo, env: envFor(w, o), stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout!.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr!.on("data", (d: Buffer) => (err += d.toString()));
  const done = new Promise<Out>((ok) => child.on("close", (code) => ok(parse(code, out, err))));
  return { child, done };
}
export const ran = (label: string, o: Out): string => `${label}\n--- exit ${o.status}\n--- stdout\n${o.out}\n--- stderr\n${o.err.slice(0, 600)}`;

export function calls(w: World): string[][] {
  if (!existsSync(w.log)) return [];
  return readFileSync(w.log, "utf8").split("\n").filter(Boolean).map((l) => l.split("\x1f"));
}
export function gitArgs(a: string[]): string[] {
  const out = [...a];
  for (;;) {
    if (out[0] === "-C" || out[0] === "-c") out.splice(0, 2);
    else break;
  }
  return out;
}
/** Every git call the verb made, with -C/-c stripped. */
export const gitCalls = (w: World): string[][] => calls(w).filter((c) => c[0] === "git").map((c) => gitArgs(c.slice(1)));
export const ghCalls = (w: World): string[][] => calls(w).filter((c) => c[0] === "gh").map((c) => c.slice(1));
/** The ordered mutating calls the verb made, normalised to a short label. */
export function mutating(w: World): string[] {
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
export const unmatched = (w: World): string[][] => calls(w).filter((c) => c[0] === "gh-unmatched");

export function walk(dir: string, rel = ""): string[] {
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
export function snap(w: World): string {
  return [
    ...walk(w.repo),
    "--worktree--",
    ...(existsSync(w.wt) ? walk(w.wt) : []),
    git(w.repo, ["for-each-ref"]),
    git(w.repo, ["worktree", "list", "--porcelain"]),
    git(w.repo, ["status", "--porcelain"]),
  ].join("\n");
}
export const branchExists = (w: World, name = BRANCH): boolean => gitOk(w.repo, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
export const remoteBranchExists = (w: World): boolean => git(w.origin, ["for-each-ref", `refs/heads/${BRANCH}`]) !== "";
export const recordOf = (w: World, dir: "repo" | "wt" = "repo"): string => {
  const path = join(dir === "repo" ? w.studio : w.wtStudio, "opera", `${OPUS}.md`);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

/** Expect `next: W-900 <step> <status>` as the first stdout line. */
export function expectStep(o: Out, step: string, status: string, row: string): void {
  assert.equal(o.first, `next: ${OPUS} ${step} ${status}`, ran(row, o));
}
/** Move the origin master forward by a commit that touches `file`. */
export function advanceOrigin(w: World, file: string, text: string): void {
  const side = join(scratch(`${w.tag}-adv`), "c");
  git(dirname(side), ["clone", "-q", w.origin, side]);
  put(side, file, text);
  commit(side, `chore: advance trunk (${file})`);
  git(side, ["push", "-q", "origin", "HEAD:refs/heads/master"]);
}

// ---------------------------------------------------------------------------
// health helpers: markers, live/dead/zombie pids, a fake /proc
// ---------------------------------------------------------------------------
export const stepsDir = (w: World): string => join(w.repo, ".bisellium", "steps");
export const markerPath = (w: World): string => join(stepsDir(w), `${OPUS}.json`);
export const outputPath = (w: World): string => join(stepsDir(w), `${OPUS}.log`);
export function tickOf(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[19]);
}
export function liveChild(): number {
  const child = spawn("sleep", ["600"], { stdio: "ignore" });
  children.push(child);
  return child.pid!;
}
export function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  return r.pid!;
}
/** A child that has exited but is not reaped: node reaps only when its loop turns, and this never yields. */
export function zombiePid(): number {
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
export interface MarkerOpts {
  step: string;
  pid: number;
  start_ticks: number;
  writer?: string;
  budget?: number;
}
export function putMarker(w: World, m: MarkerOpts): void {
  mkdirSync(stepsDir(w), { recursive: true });
  writeFileSync(
    markerPath(w),
    JSON.stringify({ schema: 1, opus: OPUS, step: m.step, pid: m.pid, start_ticks: m.start_ticks, started: new Date(NOW_MS - 3600_000).toISOString(), output: `steps/${OPUS}.log`, budget_seconds: m.budget ?? 1800, writer: m.writer ?? "perform" }),
  );
}
/** Create the step's output file, last written `ageSeconds` before NOW (negative: in the future). */
export function putOutput(w: World, text: string, ageSeconds: number): void {
  mkdirSync(stepsDir(w), { recursive: true });
  writeFileSync(outputPath(w), text);
  const t = new Date(NOW_MS - ageSeconds * 1000);
  utimesSync(outputPath(w), t, t);
}
export function statLine(pid: number | string, comm: string, state: string, start: number | string): string {
  return `${pid} (${comm}) ${state} ${Array(18).fill("0").join(" ")} ${start} ${Array(30).fill("0").join(" ")}\n`;
}
/** A directory standing in for /proc; `entries[pid]` is the body of `<pid>/stat`, or "dir" to make stat a directory (EISDIR). */
export function fakeProc(w: World, entries: Record<string, string>): string {
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
export const PROC_ENV = (dir: string): Record<string, string> => ({ BISELLIUM_TEST_PROC: dir });
export const markerText = (w: World): string => (existsSync(markerPath(w)) ? readFileSync(markerPath(w), "utf8") : "");
export const markerJson = (w: World): Json => (existsSync(markerPath(w)) ? (JSON.parse(markerText(w)) as Json) : {});

// ---------------------------------------------------------------------------
// shared scenario helpers for the PR-facing behaviours
// ---------------------------------------------------------------------------
/** A world whose review rung is met; `mutate` runs on the opus worktree before the review so it certifies that tree. */
export function reviewed(tag: string, o: WorldOpts = {}, mutate?: (w: World) => void, push = false): World {
  const w = world(tag, "build", o);
  mutate?.(w);
  addReview(w, "passed", 1, T.review1);
  w.headOid = tipOf(w);
  if (push) git(w.wt, ["push", "-q", "-u", "origin", BRANCH]);
  return w;
}
export const mergedList = (w: World, extra: Partial<CandOpts> = {}): SlotValue => ({ stdout: [cand(w, { state: "MERGED", ...extra })] });
/** A review-met world with the branch pushed (so a merge commit can be landed from origin) and the main checkout detached. */
export const pushed = (tag: string, mutate?: (w: World) => void): World => reviewed(tag, { mainOnMaster: false }, mutate, true);
export function expectHeld(o: Out, row: string): void {
  assert.match(o.first, new RegExp(`^next: ${OPUS} \\S+ held$`), ran(row, o));
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
}
export const editRecord = (w: World, dir: "repo" | "wt", fn: (doc: { setIn(path: string[], value: unknown): void }) => void): void =>
  editOpusFrontMatter(join(dir === "repo" ? w.studio : w.wtStudio, "opera", `${OPUS}.md`), (doc) => {
    fn(doc);
    return undefined;
  });

// ---------------------------------------------------------------------------
// behaviour 3: pr, merge and cleanup run in order, with the refusals the ladder
// documents, and fail closed on gh
// ---------------------------------------------------------------------------
export const TITLE = "feat(W-900): fixture";
export const BODY = join(scratch("body"), "body.md");
writeFileSync(BODY, "PR body\n");
export const MIN_CHECKS = 5;
export const prArgs = ["--title", TITLE, "--body-file", BODY];
export const performPr = (w: World, extra: string[] = prArgs): Out => next(w, [OPUS, "--perform", "--expect", "pr", ...extra, ...FAST]);
export const performMerge = (w: World, extra: string[] = []): Out => next(w, [OPUS, "--perform", "--expect", "merge", ...FAST, ...extra]);
export const ghMerges = (w: World): string[][] => ghCalls(w).filter((a) => a[0] === "pr" && a[1] === "merge");
export function handoffAt(w: World, dir: "repo" | "wt", at: string): void {
  const studio = dir === "repo" ? w.studio : w.wtStudio;
  verb(dir === "repo" ? w.repo : w.wt, ["handoff", "--opus", OPUS, "--sella", "producer", "--next", "resume from the handover artifact", "--studio", studio, "--now", at]);
  commit(dir === "repo" ? w.repo : w.wt, `studio(${OPUS}): handoff ${at}`);
}
/** A bisellium verb run the way an operator would, under the stub gh and git shim. */
export function cli(w: World, args: string[], cwd: string, env: Record<string, string | undefined> = {}): Out {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd, env: envFor(w, { env }), encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  return parse(r.status, r.stdout ?? "", r.stderr ?? "");
}
export const eventsOf = (studio: string): string | null => (existsSync(join(studio, ".bisellium", "events.jsonl")) ? readFileSync(join(studio, ".bisellium", "events.jsonl"), "utf8") : null);
export const outLines = (o: Out): string[] => o.out.split("\n");
/** A real-git wrapper (for GIT_STUB_REAL) that fails any call whose arguments contain one of `needles`. */
export function failingGit(tag: string, needles: string[]): string {
  const wrapper = join(scratch(`${tag}-git`), "git-real");
  const arms = needles.map((n) => `*"${n}"*) echo "fatal: simulated failure" >&2; exit 1;;`).join("\n");
  writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in\n${arms}\nesac\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  return wrapper;
}
export const stagedPaths = (w: World): string => git(w.repo, ["diff", "--cached", "--name-only"]);

// ---------------------------------------------------------------------------
// W-162: spec review before build. With `spec_reviewer` set, `next` names no
// `branch` until one recorded Codex review has passed after the architect's
// newest signature. Rows are selectable with --test-name-pattern=W-162-b<n>.
// ---------------------------------------------------------------------------
export const SR = "spec-reviewer";
export const SR_MODEL = "gpt-5.6-sol";
export const SR_ROW = `  - { id: ${SR}, collegium: qa, kind: agent, model: ${SR_MODEL}, harness: codex }`;
export const QA_ROW = "  - { id: qa-lead, collegium: qa, kind: agent }";
export const BUDGET = ["--budget", "100000"];
export const NO_FINDINGS = "## Findings\nNo findings\n";
export const BLOCKER = "## Findings\n1. blocking brief:7 the Input domain omits a record it reads [design: changes]. check: none: no rule\n";
export const BRIEF_REL = "studio/briefs/W-900.md";
export const specLog = (n: number): string => `studio/ci/${OPUS}-spec-${n}.log`;

export interface SrOpts {
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
export function srWorld(tag: string, o: SrOpts = {}): World {
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
export const putBrief = (w: World): void => put(w.repo, BRIEF_REL, briefText(w.behaviours));
export const briefPath = (w: World): string => join(w.repo, BRIEF_REL);
/** A spec-phase verdict through the real writer, in the main checkout. */
export function specVerdict(w: World, round: number, sella: string, outcome: string, body: string, model?: string, extra: string[] = []): void {
  const from = join(w.root, `w162-${round}-${sella}.md`);
  writeFileSync(from, body);
  verb(w.repo, ["verdict", OPUS, "--round", String(round), "--sella", sella, ...(model === undefined ? [] : ["--model", model]), "--outcome", outcome, "--phase", "spec", "--from", from, "--studio", w.studio, "--now", T.spec, ...extra]);
}
export const sign = (w: World, round: number, body = NO_FINDINGS): void => specVerdict(w, round, "architect", "passed", body);
export const review = (w: World, round: number, outcome: "passed" | "failed", o: { body?: string; model?: string; sella?: string; extra?: string[] } = {}): void =>
  specVerdict(w, round, o.sella ?? SR, outcome, o.body ?? (outcome === "passed" ? NO_FINDINGS : BLOCKER), o.model ?? SR_MODEL, o.extra ?? []);
export const specNext = (w: World, extra: string[] = []): Out => next(w, [OPUS, ...BUDGET, ...extra]);

export function reviewerOrder(o: Out, round: number, row: string): void {
  assert.equal(o.kv.get("role"), "spec-reviewer", ran(`${row}: role: spec-reviewer`, o));
  expectStep(o, "spec", "named", row);
  assert.equal(o.status, 0, ran(`${row}: exit`, o));
  assert.equal(o.kv.get("sella"), SR, ran(`${row}: sella`, o));
  assert.equal(o.kv.get("model"), SR_MODEL, ran(`${row}: model`, o));
  assert.equal(o.kv.get("round"), String(round), ran(`${row}: round`, o));
  assert.equal(o.kv.get("phase"), "spec", ran(`${row}: phase`, o));
}
export function architectOrder(o: Out, round: number, row: string): void {
  assert.equal(o.kv.get("role"), "architect", ran(`${row}: role: architect`, o));
  expectStep(o, "spec", "named", row);
  assert.equal(o.kv.get("sella"), "architect", ran(`${row}: sella`, o));
  assert.equal(o.kv.get("round"), String(round), ran(`${row}: round`, o));
}
export function specHeld(o: Out, row: string, why?: RegExp): void {
  expectStep(o, "spec", "held", row);
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(o.kv.has("role"), false, ran(`${row}: no order is named`, o));
  assert.equal(o.kv.has("command"), false, ran(`${row}: no command is named`, o));
  if (why !== undefined) assert.match(o.kv.get("why") ?? "", why, ran(`${row}: why`, o));
}
/** The signed spec is committed on the trunk by hand (as the verdict-then-commit fixtures do). */
export const landed = (w: World): void => commit(w.repo, "spec: signed and reviewed");

// ---------------------------------------------------------------------------
// W-167: the build-review loop's strict reads; a class blocker's fix order names the
// input boundary (L-069). W-246 removed the three-failure stop (D-046 §2, D-044). Rows are selectable with --test-name-pattern=W-167-b<n>.
// ---------------------------------------------------------------------------
/** Round n's recorded time: 04:00 for round 1, then every half hour (all before the 09:00 handover). */
export const rt = (n: number): string => new Date(Date.parse("2026-10-02T03:30:00.000Z") + n * 30 * 60_000).toISOString();
export const plain = (t = "fixture defect"): string => `blocking: ${t} at brief:1 [severity: S1]. check: none: fixture`;
/** A Findings body: each line is numbered in order; "pass" is a passed round. */
export const found = (...lines: string[]): string => lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
export const F = found(plain());
export type Round = string;
/** Round n is recorded through the verbs at its own tree: a source edit precedes every round after the first. */
export function record167(w: World, bodies: Round[], from = 1): void {
  bodies.forEach((b, i) => {
    const n = from + i;
    if (n > 1) advanceSource(w);
    addReview(w, b === "pass" ? "passed" : "failed", n, rt(n), b === "pass" ? undefined : b);
  });
}
/** A build-stage world with the named rounds recorded and a fresh handover (so a named order passes the context cap). */
export function w167(tag: string, bodies: Round[]): World {
  const w = world(tag, "build");
  record167(w, bodies);
  handoffAt(w, "wt", T.handoffFresh);
  return w;
}
export const n167 = (w: World, env?: Record<string, string | undefined>): Out => next(w, [OPUS, ...BUDGET], env === undefined ? {} : { env });
export function buildFix(o: Out, row: string): void {
  expectStep(o, "build", "named", row);
  assert.equal(o.status, 0, ran(`${row}: exit`, o));
  assert.match(o.out, /^phase:\s*fix$/m, ran(`${row}: phase fix`, o));
}
export function reviewNamed(o: Out, round: number, row: string): void {
  expectStep(o, "review", "named", row);
  assert.equal(o.kv.get("round"), String(round), ran(`${row}: round`, o));
}
export function reviewHeld(o: Out, row: string, why?: RegExp): void {
  expectStep(o, "review", "held", row);
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(o.kv.has("role"), false, ran(`${row}: no order is named`, o));
  assert.equal(o.kv.has("command"), false, ran(`${row}: no command is named`, o));
  if (why !== undefined) assert.match(o.kv.get("why") ?? "", why, ran(`${row}: why`, o));
}
/** W-166: the hold on a malformed source_excludes, printed before any derivation: `next: <id> held`, no step. */
export function excludesHeld(o: Out, row: string): void {
  assert.equal(o.first, `next: ${OPUS} held`, ran(`${row}: the held line carries no step`, o));
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(o.kv.has("role"), false, ran(`${row}: no order is named`, o));
  assert.equal(o.kv.has("command"), false, ran(`${row}: no command is named`, o));
  assert.match(o.kv.get("why") ?? "", /^bisellium\.yml#source_excludes is malformed \(/, ran(`${row}: why names bisellium.yml#source_excludes`, o));
}
export interface Edit {
  dir: "repo" | "wt";
  rel: string;
  /** the new text from the old; a fixture whose edit changes nothing is a defect */
  text?: (old: string) => string;
  symlink?: string;
}
/** Apply the edits (committed in both checkouts), run `fn`, then put every file back and commit again. */
export function trial(w: World, edits: Edit[], fn: () => void): void {
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
export const MANIFEST_REL = "studio/bisellium.yml";

// ---------------------------------------------------------------------------
// W-168 behaviours 3 and 4: the merge-queue mode of `pr` and `merge`
// ---------------------------------------------------------------------------
export const QUEUE_PARAMS: Json = {
  merge_method: "SQUASH",
  max_entries_to_build: 1,
  min_entries_to_merge: 1,
  max_entries_to_merge: 1,
  min_entries_to_merge_wait_minutes: 0,
  grouping_strategy: "ALLGREEN",
  check_response_timeout_minutes: 120,
};
export const QUEUE_CONTEXTS = ["gates", "officina", "web-e2e", "certify"];
/** The full setup of the brief, as `gh api repos/<slug>/rules/branches/master` returns it. */
export const QUEUE_RULES: Json[] = [
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
export const modeLine = (o: Out): string | undefined => o.out.split("\n").find((l) => l.startsWith("mode:"));
/** A review-met world whose PR appears once `gh pr create` ran, with `rules` as master's rules. */
export function queueWorld(tag: string, rules: SlotValue, advance = true, mutate?: (w: World) => void): World {
  const w = reviewed(tag, { mainOnMaster: false }, mutate);
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
/** The key, appended to the main checkout's manifest and the worktree's, committed in each (W-167's `both`). */
export function ticketed(w: World, value = "required"): void {
  for (const dir of [w.repo, ...(existsSync(w.wt) ? [w.wt] : [])]) {
    const path = join(dir, MANIFEST_REL);
    writeFileSync(path, `${readFileSync(path, "utf8")}step_tickets: ${value}\n`);
    commit(dir, `test: W-233 step_tickets ${value}`);
  }
}
export const WT_STUDIO_REL = `.worktrees/${OPUS}/studio`;

/** A real verb run directly, as an agent would: its refusal is the point, so the result is data. */
export function direct(w: World, cwd: string, args: string[]): Out {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd, env: envFor(w, {}), encoding: "utf8", timeout: 120_000 });
  return parse(r.status, r.stdout ?? "", r.stderr ?? "");
}

// ---------------------------------------------------------------------------
// W-206 part 1: a brief amended after opus/<id> exists is re-signed, re-reviewed and committed on that branch
// ---------------------------------------------------------------------------
/** A reviewer-configured world whose spec (signature 1, review 2) landed on master before the branch was cut, built through `upTo`. */
export function w206World(tag: string, upTo: "ready" | "review", review1: "passed" | "failed" = "passed"): World {
  const w = srWorld(tag);
  putBrief(w);
  sign(w, 1);
  review(w, 2, "passed");
  landed(w);
  git(w.repo, ["branch", BRANCH]);
  git(w.repo, ["worktree", "add", "-q", w.wt, BRANCH]);
  verb(w.wt, ["ready", OPUS, "--sella", "architect", "--studio", w.wtStudio, "--now", T.ready]);
  commit(w.wt, `studio(${OPUS}): ready`);
  if (upTo === "review") {
    writeReds(w);
    writeReceipt(w, "current");
    addReview(w, review1, 1, T.review1);
  }
  handoffAt(w, "wt", T.handoffFresh);
  return w;
}
export const WT_BRIEF = (w: World): string => join(w.wtStudio, "briefs", `${OPUS}.md`);
export const amend = (w: World): void => appendFileSync(WT_BRIEF(w), "\nAmended mid-build.\n");
/** A spec-phase verdict through the real writer, in the opus worktree. */
export function wtSpec(w: World, round: number, sella: string, outcome: "passed" | "failed", model?: string): Out {
  const from = join(w.root, `w206-${round}-${sella}.md`);
  writeFileSync(from, outcome === "passed" ? NO_FINDINGS : BLOCKER);
  return direct(w, w.wt, ["verdict", OPUS, "--round", String(round), "--sella", sella, ...(model === undefined ? [] : ["--model", model]), "--outcome", outcome, "--phase", "spec", "--from", from, "--studio", w.wtStudio, "--now", T.spec]);
}

// ---------------------------------------------------------------------------
// W-274: a build-review round is one `next --perform --expect review`. Codex is a stub on PATH that logs each call
// (argv and stdin) under $HOME and answers from $HOME/codex-reply.json; the real codex never runs.
// ---------------------------------------------------------------------------
export const CODEX_STUB = String.raw`#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const home = process.env.HOME;
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  fs.appendFileSync(path.join(home, "codex-calls.jsonl"), JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }) + "\n");
  const r = JSON.parse(fs.readFileSync(path.join(home, "codex-reply.json"), "utf8"));
  // poison: a directory where the perform will write verdict.md, so that write throws
  const packet = /packet (\S+)\.\n/.exec(stdin);
  if (r.poison && packet) fs.mkdirSync(path.join(packet[1], "verdict.md"));
  // the delay is a spin in the stub process (no timer): the adapter's kill ends it early, so the timeout row waits on the call's own deadline
  for (const end = Date.now() + (r.sleepMs ?? 0); Date.now() < end; ) { /* spin */ }
  (() => {
    if (r.session !== undefined) process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: r.session }) + "\n");
    process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: r.reply } }) + "\n", () => {
      if (r.signal !== undefined) process.kill(process.pid, r.signal);
      else {
        if (r.stderr !== undefined) process.stderr.write(r.stderr);
        process.exit(r.exit ?? 0);
      }
    });
  })();
});
`;
export const CODEX_BIN = scratch("codex-bin");
writeFileSync(join(CODEX_BIN, "codex"), CODEX_STUB, { mode: 0o755 });

// ---------------------------------------------------------------------------
// W-312: review is admitted by the branch's own gate logs at its current source tree (the builder's `bisellium ci --opus`
// in the worktree), never by a host-minted receipt; nothing mints before review, and the chain performs review and pr only
// ---------------------------------------------------------------------------
/** What `verify` (and `ci --opus`) leaves for the `tests` gate at the worktree's tip: the record's three keys and the log, committed unless asked not to. */
export function writeGates(w: World, o: { gate?: string; log?: (tree: string) => string; certifies?: (tree: string) => string; evidence?: (tree: string) => string; commit?: boolean } = {}): void {
  const tree = sourceTree(w.wt);
  const gate = o.gate ?? "tests";
  const evidence = o.evidence?.(tree) ?? `ci/${OPUS}-${gate}-${tree.slice(5, 13)}.log`;
  put(w.wtStudio, evidence, o.log?.(tree) ?? `certifies: ${tree}\ncommand: node -e 0\nexit code: 0\n\n\n`);
  editRecord(w, "wt", (doc) => doc.setIn(["probationes", gate], { status: "passed", evidence, certifies: o.certifies?.(tree) ?? tree }));
  if (o.commit ?? true) commit(w.wt, `studio(${OPUS}): gates`);
}
