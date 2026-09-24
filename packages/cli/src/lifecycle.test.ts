/**
 * packages/cli/src/lifecycle.test.ts — W-020 (ready, done, review, red),
 * against temp copies of examples/sample-studio. `now` is pinned to
 * 2026-09-19T13:00:00Z. House pattern: writes.test.ts is the model.
 *
 * `BISELLIUM_ONLY_BEHAVIOUR` (comma-separated behaviour numbers) restricts
 * the run to those blocks — the red-capture harness for a stubbed
 * lifecycle.ts (studio/ci/reds/W-020, round 6) invokes this file directly
 * rather than re-deriving its fixtures in a second script. Unset, every
 * behaviour runs, exactly as before this existed.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL } from "@bisellium/core";
import type { MergePipeline } from "@bisellium/pipeline";
import { WF } from "@bisellium/schema";
import { sourceTreeHash } from "@bisellium/shim";
import { checkStudio } from "./check.js";
import { executeClose } from "./close.js";
import { runCi } from "./ci.js";
import { splitFront } from "./frontmatter.js";
import { runReady, runDone, runReview, runRed, runHalt, runWaive } from "./lifecycle.js";
import { runVerify } from "./verify.js";
import { runGreenlight, runHandoff, type WriteResult } from "./writes.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-19T13:00:00Z");

// W-039: a stray $BISELLIUM_SELLA on the host would let a `red` call that
// passes no --sella slip past the new refusal on a local run and fail only
// in CI (or vice versa). Deleted once, up front, so every behaviour in this
// file sees the same environment; a test that needs the env var sets it
// itself and is responsible for its own cleanup.
delete process.env["BISELLIUM_SELLA"];

const only = process.env["BISELLIUM_ONLY_BEHAVIOUR"];
const selected = only ? new Set(only.split(",").map(Number)) : undefined;
const runs = (behaviour: number): boolean => selected === undefined || selected.has(behaviour);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-lifecycle-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

/** W-039 behaviours 1-2: preseeds `<redsDir>/01.log` and `.../02.log` with
 *  known bytes so a refusal test can prove, byte for byte, that it wrote
 *  nothing — a directory that's merely absent afterward would miss a
 *  refusal that overwrote an existing log. */
function preseedReds(dir: string, id: string): string {
  const redsDir = join(dir, "ci", "reds", id);
  mkdirSync(redsDir, { recursive: true });
  writeFileSync(join(redsDir, "01.log"), "PRESEEDED-01\n");
  writeFileSync(join(redsDir, "02.log"), "PRESEEDED-02\n");
  return redsDir;
}

/** Sorted file listing plus every file's bytes — the snapshot a refusal
 *  test takes before and compares against after. */
function snapshotDir(dir: string): { names: string[]; bytes: Map<string, string> } {
  const names = readdirSync(dir).sort();
  return { names, bytes: new Map(names.map((n) => [n, readFileSync(join(dir, n), "utf8")])) };
}

function sameSnapshot(dir: string, before: { names: string[]; bytes: Map<string, string> }): boolean {
  const after = snapshotDir(dir);
  if (after.names.length !== before.names.length || after.names.some((n, i) => n !== before.names[i])) return false;
  for (const n of after.names) if (after.bytes.get(n) !== before.bytes.get(n)) return false;
  return true;
}

function readEventLines(dir: string): Record<string, unknown>[] {
  const path = join(dir, EVENTS_LOG_REL);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Appends a probatio entry to a temp copy's own manifest — a fixture setup
 *  step for tests that need a "spec" probatio the real sample-studio manifest
 *  deliberately does not declare (out of scope: no new probatio there). */
function addProbatio(dir: string, entry: { id: string; name: string; kind: string }): void {
  const path = join(dir, "bisellium.yml");
  const doc = parseDocument(readFileSync(path, "utf8"));
  doc.addIn(["probationes"], entry);
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
}

function writeOpus(dir: string, id: string, contents: string): string {
  const path = join(dir, "opera", `${id}.md`);
  writeFileSync(path, contents);
  return path;
}

/** W-034: a `decisions/<id>.md` fixture with full `decision.shape` keys
 *  (`id`, `title`, `at`, `provenance`, `by`, `kill_when`) unless `raw` is
 *  given, for the unparseable-YAML case (D-903) — a decision `waive`/`done`
 *  must be able to name in a refusal even though it can't be read. */
function writeDecision(dir: string, id: string, opts: { by?: unknown; raw?: string } = {}): string {
  const decisionsDir = join(dir, "decisions");
  mkdirSync(decisionsDir, { recursive: true });
  const p = join(decisionsDir, `${id}.md`);
  if (opts.raw !== undefined) {
    writeFileSync(p, opts.raw);
    return p;
  }
  const byLine = opts.by === undefined ? "by: patron" : `by: ${typeof opts.by === "string" ? opts.by : JSON.stringify(opts.by)}`;
  const lines = ["---", `id: ${id}`, `title: Fixture decision ${id}`, "at: 2026-09-24T00:00:00Z", "provenance: stated"];
  if (opts.by !== false) lines.push(byLine); // false: omit the "by" key entirely (D-904)
  lines.push('kill_when: "never"', "---", "Body.", "");
  writeFileSync(p, lines.join("\n"));
  return p;
}

/** Sets/overwrites the manifest's top-level `patron:` id — the literal
 *  "patron" comparison bug behaviours 3/6 exist to catch (an implementation
 *  that hardcodes "patron" instead of reading `manifest.patron`). */
function setManifestPatron(dir: string, patronId: string): void {
  const path = join(dir, "bisellium.yml");
  const doc = parseDocument(readFileSync(path, "utf8"));
  doc.setIn(["patron"], patronId);
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
}

// =============================================================================
// W-033 fixtures — behaviours 23-29 need a REAL git repo with the studio
// committed inside it (the W-026 blind spot: a studio outside the repo, or
// never committed, collapses branch and trunk copies into one file and the
// guard never has anything to refuse).
// =============================================================================

/** `git init -b master`, copy `examples/sample-studio` to `<repo>/studio` —
 *  not yet committed, so callers can still add/overwrite opera files before
 *  the one `gitCommitAll` that puts the studio under version control. */
function tmpGitStudioRepo(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w033-${tag}-`));
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir });
  cpSync(sampleStudio, join(dir, "studio"), { recursive: true });
  dirs.push(dir);
  return dir;
}

/** Same as `tmpGitStudioRepo`, but `studio/` is committed as *ignored* — so
 *  every record inside it stays untracked (behaviour 7). */
function tmpGitRepoIgnoredStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w033-${tag}-`));
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), "studio/\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "ignore studio"], { cwd: dir });
  cpSync(sampleStudio, join(dir, "studio"), { recursive: true });
  dirs.push(dir);
  return dir;
}

function gitCommitAll(repo: string, msg: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", msg], { cwd: repo });
}

function gitBranch(repo: string, name: string): void {
  execFileSync("git", ["branch", name], { cwd: repo });
}

function gitCheckout(repo: string, ref: string): void {
  execFileSync("git", ["checkout", "-q", ref], { cwd: repo });
}

/** A linked worktree at a fresh temp dir, checked out at `ref` (`flags` is
 *  e.g. `["--detach"]`, or `[]` for an attached branch checkout). Tracked in
 *  `dirs` for cleanup like any other fixture dir; the repo itself is what
 *  owns `.git/worktrees/`, so removing this directory without `git worktree
 *  remove` is fine once the whole repo is thrown away too. */
function gitWorktreeAdd(repo: string, flags: string[], ref: string): string {
  const path = mkdtempSync(join(tmpdir(), "bisellium-w033-wt-"));
  rmSync(path, { recursive: true, force: true }); // git worktree add creates path itself
  execFileSync("git", ["worktree", "add", ...flags, path, ref], { cwd: repo });
  dirs.push(path);
  return path;
}

function gitStatusPorcelain(repo: string): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
}

/** Passing tests/lint/types/qa/review the way `runDone` demands them, so a
 *  fixture opus in `building` would pass `done` were the D-021 guard not
 *  there — every behaviour-23/28/29 opus that needs `done` to "would
 *  succeed without the guard" uses this front matter verbatim. */
function passingOpusFrontMatter(id: string, title: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "kind: feature",
    "collegium: engineering",
    "state: building",
    "probationes:",
    "  tests: { status: passed, evidence: ci/x.log, certifies: tree:deadbeef }",
    "  lint: { status: passed, evidence: ci/x.log, certifies: tree:deadbeef }",
    "  types: { status: passed, evidence: ci/x.log, certifies: tree:deadbeef }",
    "  qa: { status: passed }",
    "  review: { status: passed }",
    "---",
    "Body.",
    "",
  ].join("\n");
}

/** Replaces `console.error` for the duration of `fn` (sync or async) and
 *  returns whatever it printed alongside its result — same pattern
 *  writes.test.ts's answer-without-opus case uses, generalised so each
 *  W-033 refusal block doesn't repeat the save/restore dance. */
async function withStderr<T>(fn: () => T | Promise<T>): Promise<{ result: T; stderr: string }> {
  const orig = console.error;
  let stderr = "";
  console.error = (...parts: unknown[]) => {
    stderr += parts.map(String).join(" ") + "\n";
  };
  try {
    const result = await fn();
    return { result, stderr };
  } finally {
    console.error = orig;
  }
}

/** Same as `withStderr`, for stdout — W-034's trace assertions (`done`'s
 *  "waived: patron by D-900" line) read what the command printed, not just
 *  its exit code. */
async function withStdout<T>(fn: () => T | Promise<T>): Promise<{ result: T; stdout: string }> {
  const orig = console.log;
  let stdout = "";
  console.log = (...parts: unknown[]) => {
    stdout += parts.map(String).join(" ") + "\n";
  };
  try {
    const result = await fn();
    return { result, stdout };
  } finally {
    console.log = orig;
  }
}

try {
  // =========================================================================
  // ready — behaviours 1-3
  // =========================================================================

  // ---- behaviour 1: ready on a greenlit opus ------------------------------
  if (runs(1)) {
    const dir = freshStudio("ready-greenlit");
    addProbatio(dir, { id: "spec", name: "Spec", kind: "agent" });
    const briefsDir = join(dir, "briefs");
    mkdirSync(briefsDir, { recursive: true });
    writeFileSync(join(briefsDir, "W-006.md"), "Brief for W-006.\n");

    const opusPath = join(dir, "opera", "W-006.md");
    const before = readFileSync(opusPath, "utf8");
    const beforeSplit = splitFront(before)!;

    const r = runReady(["W-006", "--sella", "architect", "--studio", dir], { now: NOW });
    check("ready: greenlit -> building exits 0", r.exitCode === 0, String(r.exitCode));

    const after = readFront<{ state: string; spec: string; probationes: Record<string, { status: string; sella: string; evidence: string; at: string }> }>(opusPath);
    check("ready: state -> building", after.data.state === "building", after.data.state);
    check("ready: spec key set", after.data.spec === "briefs/W-006.md", after.data.spec);
    check(
      "ready: spec gate recorded passed",
      after.data.probationes.spec?.status === "passed" &&
        after.data.probationes.spec?.sella === "architect" &&
        after.data.probationes.spec?.evidence === "briefs/W-006.md" &&
        after.data.probationes.spec?.at === NOW.toISOString(),
      JSON.stringify(after.data.probationes.spec),
    );
    const afterSplit = splitFront(readFileSync(opusPath, "utf8"))!;
    check("ready: body byte-identical", afterSplit.body === beforeSplit.body, JSON.stringify({ before: beforeSplit.body, after: afterSplit.body }));

    const events = readEventLines(dir);
    check("ready: exactly one workflow.state_changed event", events.length === 1 && events[0]?.["name"] === "workflow.state_changed", JSON.stringify(events));
    const attrs = events[0]?.["attrs"] as Record<string, unknown> | undefined;
    check(
      "ready: event carries item/from/to/actor",
      attrs?.[WF.ITEM_ID] === "W-006" && attrs?.[WF.STATE_FROM] === "greenlit" && attrs?.[WF.STATE_TO] === "building" && attrs?.[WF.ACTOR_ROLE] === "architect",
      JSON.stringify(attrs),
    );
  }

  // ---- behaviour 2: ready on halted, and refusal from every other state ---
  if (runs(2)) {
    const dir = freshStudio("ready-halted");
    addProbatio(dir, { id: "spec", name: "Spec", kind: "agent" });
    const briefsDir = join(dir, "briefs");
    mkdirSync(briefsDir, { recursive: true });
    writeFileSync(join(briefsDir, "W-100.md"), "Brief for W-100.\n");
    writeOpus(
      dir,
      "W-100",
      [
        "---",
        "id: W-100",
        "title: Halted test opus",
        "kind: feature",
        "collegium: engineering",
        "state: halted",
        "halted_at: 2026-09-01T00:00:00Z",
        "reason: waiting on a decision",
        "resume_when: decision made",
        "probationes: {}",
        "---",
        "Halted body.",
        "",
      ].join("\n"),
    );

    const r = runReady(["W-100", "--sella", "architect", "--studio", dir], { now: NOW });
    check("ready: halted -> building exits 0", r.exitCode === 0, String(r.exitCode));
    const after = readFront<Record<string, unknown>>(join(dir, "opera", "W-100.md")).data;
    check("ready: halted -> building state", after["state"] === "building", String(after["state"]));
    check(
      "ready: halted_at/reason/resume_when deleted",
      after["halted_at"] === undefined && after["reason"] === undefined && after["resume_when"] === undefined,
      JSON.stringify(after),
    );

    // Every other state refuses with exit 2 and writes nothing.
    for (const id of ["W-007" /* backlog */, "W-002" /* building */, "W-003" /* verifying */, "W-004" /* review */, "W-001" /* done */]) {
      const opusPath = join(dir, "opera", `${id}.md`);
      const before = readFileSync(opusPath, "utf8");
      const rr = runReady([id, "--studio", dir], { now: NOW });
      check(`ready: refuses on ${id} (wrong state) with exit 2`, rr.exitCode === 2, String(rr.exitCode));
      check(`ready: ${id} untouched by the refusal`, readFileSync(opusPath, "utf8") === before);
    }
  }

  // ---- behaviour 3: missing spec file / no spec probatio declared --------
  if (runs(3)) {
    const dir = freshStudio("ready-no-spec");
    // No brief created for W-006 at all — the manifest here has no "spec"
    // probatio (sample-studio's own, untouched).
    const opusPath = join(dir, "opera", "W-006.md");
    const before = readFileSync(opusPath, "utf8");
    const r = runReady(["W-006", "--studio", dir], { now: NOW });
    check("ready: missing spec file refuses with exit 2", r.exitCode === 2, String(r.exitCode));
    check("ready: missing spec file writes nothing", readFileSync(opusPath, "utf8") === before);

    const briefsDir = join(dir, "briefs");
    mkdirSync(briefsDir, { recursive: true });
    writeFileSync(join(briefsDir, "W-006.md"), "Brief.\n");
    const r2 = runReady(["W-006", "--studio", dir], { now: NOW });
    check("ready: with brief present and no spec probatio, exits 0", r2.exitCode === 0, String(r2.exitCode));
    const after = readFront<{ probationes: Record<string, unknown> }>(opusPath).data;
    check("ready: records no spec gate when manifest declares none", after.probationes["spec"] === undefined, JSON.stringify(after.probationes));
  }

  // =========================================================================
  // done — behaviours 4-5
  // =========================================================================
  const passingLines = [
    "  tests: { status: passed, evidence: ci/x.log, certifies: tree:abc123 }",
    "  lint: { status: passed, evidence: ci/x.log, certifies: tree:abc123 }",
    "  types: { status: passed, evidence: ci/x.log, certifies: tree:abc123 }",
    "  qa: { status: passed, evidence: reviews/x.md }",
    "  review: { status: passed, evidence: reviews/x.md, certifies: tree:abc123 }",
  ];
  const passingProbationes = passingLines.join("\n");

  function opusWithProbationes(id: string, state: string, probationesBlock: string): string {
    return ["---", `id: ${id}`, "title: Done test opus", "kind: feature", "collegium: engineering", `state: ${state}`, "probationes:", probationesBlock, "---", "Body.", ""].join(
      "\n",
    );
  }

  if (runs(4)) {
    const dir = freshStudio("done-success");
    for (const [id, state] of [
      ["W-300", "building"],
      ["W-301", "verifying"],
      ["W-302", "review"],
    ] as const) {
      writeOpus(dir, id, opusWithProbationes(id, state, passingProbationes));
      const r = runDone([id, "--sella", "eng-lead", "--studio", dir], { now: NOW });
      check(`done: ${state} -> done exits 0`, r.exitCode === 0, String(r.exitCode));
      const after = readFront<{ state: string }>(join(dir, "opera", `${id}.md`)).data;
      check(`done: ${id} state -> done`, after.state === "done", after.state);
    }
    const events = readEventLines(dir);
    check("done: one workflow.state_changed per success", events.filter((e) => e["name"] === "workflow.state_changed").length === 3, String(events.length));
  }

  if (runs(5)) {
    const dir = freshStudio("done-refuse");
    const cases: [string, string][] = [
      ["W-310", passingLines.map((l) => (l.startsWith("  tests:") ? "  tests: { status: failed, evidence: ci/x.log, certifies: tree:abc123 }" : l)).join("\n")],
      ["W-311", passingLines.filter((l) => !l.startsWith("  tests:")).join("\n")],
      ["W-312", passingLines.map((l) => (l.startsWith("  tests:") ? "  tests: { status: passed, evidence: ci/x.log, certifies: dirty:abc123 }" : l)).join("\n")],
      ["W-313", passingLines.map((l) => (l.startsWith("  qa:") ? "  qa: { status: pending }" : l)).join("\n")],
      ["W-314", passingProbationes + "\n  patron: { status: pending }"],
    ];
    for (const [id, block] of cases) {
      writeOpus(dir, id, opusWithProbationes(id, "building", block));
      const path = join(dir, "opera", `${id}.md`);
      const before = readFileSync(path, "utf8");
      const r = runDone([id, "--studio", dir], { now: NOW });
      check(`done: refuses ${id} with exit 1`, r.exitCode === 1, String(r.exitCode));
      check(`done: ${id} untouched by the refusal`, readFileSync(path, "utf8") === before);
    }

    // An unrecorded human gate does not block — already exercised by
    // done-success above (patron is never recorded on W-300/301/302).
  }

  // =========================================================================
  // review — behaviours 6-8
  // =========================================================================
  if (runs(6)) {
    const dir = freshStudio("review-pass");
    writeFileSync(join(dir, "ci", "review-pass-1.log"), "review notes\n");
    const opusPath = join(dir, "opera", "W-002.md");
    const beforeState = readFront<{ state: string }>(opusPath).data.state;

    const r = runReview(["W-002", "--pass", "--evidence", "ci/review-pass-1.log", "--round", "2", "--sella", "eng-lead", "--studio", dir], { now: NOW });
    check("review --pass: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const after = readFront<{ state: string; probationes: Record<string, { status: string; sella: string; evidence: string; at: string }> }>(opusPath).data;
    check("review --pass: state unchanged", after.state === beforeState, after.state);
    check(
      "review --pass: records passed with sella/evidence/at",
      after.probationes.review?.status === "passed" &&
        after.probationes.review?.sella === "eng-lead" &&
        after.probationes.review?.evidence === "ci/review-pass-1.log" &&
        after.probationes.review?.at === NOW.toISOString(),
      JSON.stringify(after.probationes.review),
    );

    const events = readEventLines(dir);
    check("review --pass: one workflow.gate_evaluated event", events.length === 1 && events[0]?.["name"] === "workflow.gate_evaluated", JSON.stringify(events));
    const attrs = events[0]?.["attrs"] as Record<string, unknown> | undefined;
    check("review --pass: event carries WF.REVIEW_ROUND", attrs?.[WF.REVIEW_ROUND] === 2, JSON.stringify(attrs));
  }

  if (runs(7)) {
    const dir = freshStudio("review-fail");
    writeFileSync(join(dir, "ci", "review-fail-2.log"), "second round notes\n");

    // W-004 is in `review` with an already-passed review gate (L-016: a
    // second round must be able to overwrite it, not just append).
    const w004 = join(dir, "opera", "W-004.md");
    const r = runReview(["W-004", "--fail", "--evidence", "ci/review-fail-2.log", "--sella", "eng-lead", "--studio", dir], { now: NOW });
    check("review --fail: exitCode 0", r.exitCode === 0, String(r.exitCode));
    const after = readFront<{ state: string; probationes: Record<string, { status: string; evidence: string }> }>(w004).data;
    check("review --fail: overwrites evidence and records failed", after.probationes.review?.status === "failed" && after.probationes.review?.evidence === "ci/review-fail-2.log", JSON.stringify(after.probationes.review));
    check("review --fail: opus in review returns to building", after.state === "building", after.state);

    // W-002 is in `building` — a --fail there leaves the state alone.
    const w002 = join(dir, "opera", "W-002.md");
    const r2 = runReview(["W-002", "--fail", "--evidence", "ci/review-fail-2.log", "--studio", dir], { now: NOW });
    check("review --fail on building: exitCode 0", r2.exitCode === 0, String(r2.exitCode));
    const after2 = readFront<{ state: string }>(w002).data;
    check("review --fail on building: state stays building", after2.state === "building", after2.state);
  }

  if (runs(8)) {
    const dir = freshStudio("review-usage");
    const opusPath = join(dir, "opera", "W-002.md");
    const before = readFileSync(opusPath, "utf8");

    const neither = runReview(["W-002", "--evidence", "ci/W-002-tests-6b416199.log", "--studio", dir], { now: NOW });
    check("review: neither --pass nor --fail exits 2", neither.exitCode === 2, String(neither.exitCode));

    const both = runReview(["W-002", "--pass", "--fail", "--evidence", "ci/W-002-tests-6b416199.log", "--studio", dir], { now: NOW });
    check("review: both --pass and --fail exits 2", both.exitCode === 2, String(both.exitCode));

    const badEvidence = runReview(["W-002", "--pass", "--evidence", "ci/does-not-exist.log", "--studio", dir], { now: NOW });
    check("review: nonexistent --evidence exits 2", badEvidence.exitCode === 2, String(badEvidence.exitCode));

    check("review: file untouched by every usage refusal", readFileSync(opusPath, "utf8") === before);
  }

  // =========================================================================
  // red — behaviours 9-11
  // =========================================================================
  if (runs(9)) {
    const dir = freshStudio("red-record");
    const redsDir = join(dir, "ci", "reds", "W-900");

    const r = await runRed(["W-900", "--behaviour", "3", "--sella", "builder-a", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('out-line'); console.error('err-line'); process.exit(7)"], {});
    check("red: recording a real failure exits 0", r.exitCode === 0, String(r.exitCode));

    const logPath = join(redsDir, "03.log");
    check("red: writes 03.log", existsSync(logPath));
    const log = readFileSync(logPath, "utf8");
    const lines = log.split("\n");
    check("red: header line 1 is # behaviour: 3", lines[0] === "# behaviour: 3", lines[0]);
    check("red: header line 2 is # command:", lines[1]?.startsWith("# command: node -e") ?? false, lines[1]);
    check("red: header line 3 is # exit: 7", lines[2] === "# exit: 7", lines[2]);
    check("red: header line 4 is # at: <now>", lines[3] === `# at: ${NOW.toISOString()}`, lines[3]);
    check("red: header line 5 is # sella: builder-a", lines[4] === "# sella: builder-a", lines[4]);
    check("red: header line 6 is # tree: unknown (non-git --repo)", lines[5] === "# tree: unknown", lines[5]);
    check("red: blank line then combined output", lines[6] === "" && log.includes("out-line") && log.includes("err-line"), JSON.stringify(lines.slice(6)));
  }

  if (runs(10)) {
    const dir = freshStudio("red-exit0");
    const redsDir = join(dir, "ci", "reds", "W-901");
    const r = await runRed(["W-901", "--behaviour", "5", "--sella", "builder-a", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(0)"], {});
    check("red: a passing command refuses with exit 1", r.exitCode === 1, String(r.exitCode));
    check("red: no directory created for a passing command", !existsSync(redsDir));
  }

  if (runs(10)) {
    const dir = freshStudio("red-overwrite");
    const redsDir = join(dir, "ci", "reds", "W-902");
    await runRed(["W-902", "--behaviour", "1", "--sella", "builder-a", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('first'); process.exit(1)"], {});
    await runRed(["W-902", "--behaviour", "2", "--sella", "builder-a", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('second'); process.exit(1)"], {});
    await runRed(["W-902", "--behaviour", "1", "--sella", "builder-a", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('first-rerun'); process.exit(1)"], {});

    const log1 = readFileSync(join(redsDir, "01.log"), "utf8");
    const log2 = readFileSync(join(redsDir, "02.log"), "utf8");
    check("red: re-running a behaviour overwrites only that log", log1.includes("first-rerun") && !log1.includes("first\n"), log1);
    check("red: sibling behaviour's log is untouched", log2.includes("second"), log2);
  }

  // ---- behaviour 11: usage refusals -------------------------------------
  if (runs(11)) {
    const dir = freshStudio("red-usage");
    const okCmd = ["node", "-e", "process.exit(1)"];

    const zero = await runRed(["W-903", "--behaviour", "0", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: --behaviour 0 exits 2", zero.exitCode === 2, String(zero.exitCode));

    const negative = await runRed(["W-903", "--behaviour", "-1", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: negative --behaviour exits 2", negative.exitCode === 2, String(negative.exitCode));

    const nonInt = await runRed(["W-903", "--behaviour", "abc", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: non-integer --behaviour exits 2", nonInt.exitCode === 2, String(nonInt.exitCode));

    const noSep = await runRed(["W-903", "--behaviour", "1", "--studio", dir, "--repo", dir], {});
    check("red: missing -- separator exits 2", noSep.exitCode === 2, String(noSep.exitCode));

    const emptyCmd = await runRed(["W-903", "--behaviour", "1", "--studio", dir, "--repo", dir, "--"], {});
    check("red: empty command exits 2", emptyCmd.exitCode === 2, String(emptyCmd.exitCode));

    const dotdot = await runRed(["..", "--behaviour", "1", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: '..' opus id exits 2", dotdot.exitCode === 2, String(dotdot.exitCode));

    const withSlash = await runRed(["sub/dir", "--behaviour", "1", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: opus id with a path separator exits 2", withSlash.exitCode === 2, String(withSlash.exitCode));

    check("red: none of the usage refusals created ci/reds", !existsSync(join(dir, "ci", "reds")));
  }

  // =========================================================================
  // behaviour 12: no-argument invocation through main.ts prints its own
  // usage line (not the generic USAGE) and exits 2.
  // =========================================================================
  if (runs(12)) {
    const mainPath = join(repo, "packages/cli/src/main.ts");
    for (const [cmd, needle] of [
      ["ready", "usage: bisellium ready "],
      ["done", "usage: bisellium done "],
      ["review", "usage: bisellium review "],
      ["red", "usage: bisellium red "],
    ] as const) {
      let stderr = "";
      let exitCode = 0;
      try {
        execFileSync("node", ["--import", "tsx", mainPath, cmd], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        const err = e as { status?: number; stderr?: string };
        exitCode = err.status ?? 1;
        stderr = err.stderr ?? "";
      }
      check(`main.ts: "${cmd}" with no args exits 2`, exitCode === 2, String(exitCode));
      check(`main.ts: "${cmd}" prints its own usage, not the generic one`, stderr.trim().startsWith(needle), stderr);
    }
  }
  // =========================================================================
  // behaviour 13: ready --spec refuses a path that escapes the officina
  // (cascade 6 round-2 review, B1/D-008)
  // =========================================================================
  if (runs(13)) {
    const dir = freshStudio("ready-spec-escape");
    const opusPath = join(dir, "opera", "W-006.md"); // greenlit in the fixture
    const before = readFileSync(opusPath, "utf8");

    const r = runReady(["W-006", "--spec", "../../../../../etc/hostname", "--studio", dir], { now: NOW });
    check("ready: --spec escaping the officina refuses with exit 2", r.exitCode === 2, String(r.exitCode));
    check("ready: escaping --spec writes nothing", readFileSync(opusPath, "utf8") === before);
  }

  // =========================================================================
  // behaviour 14: review --evidence refuses a path that escapes the officina
  // (cascade 6 round-2 review, B1/D-008)
  // =========================================================================
  if (runs(14)) {
    const dir = freshStudio("review-evidence-escape");
    const opusPath = join(dir, "opera", "W-004.md"); // in `review` in the fixture
    const before = readFileSync(opusPath, "utf8");

    const r = runReview(["W-004", "--pass", "--evidence", "../../../../../etc/hostname", "--studio", dir], { now: NOW });
    check("review: --evidence escaping the officina refuses with exit 2", r.exitCode === 2, String(r.exitCode));
    check("review: escaping --evidence writes nothing", readFileSync(opusPath, "utf8") === before);
  }

  // =========================================================================
  // behaviour 15: review --fail on a `done` opus returns it to `building`
  // (cascade 6 round-2 review, F5 — the wall L-016 only half took down)
  // =========================================================================
  if (runs(15)) {
    const dir = freshStudio("review-fail-done");
    writeFileSync(join(dir, "ci", "W-950-review-2.log"), "round 2 notes\n");
    const opusPath = writeOpus(
      dir,
      "W-950",
      [
        "---",
        "id: W-950",
        "title: Done-with-failed-review",
        "kind: feature",
        "collegium: engineering",
        "state: done",
        "probationes:",
        "  review: { status: passed, evidence: ci/W-950-review-1.log, sella: eng-lead, at: 2026-09-19T12:00:00.000Z }",
        "---",
        "Body.",
        "",
      ].join("\n"),
    );

    const r = runReview(["W-950", "--fail", "--evidence", "ci/W-950-review-2.log", "--round", "2", "--sella", "eng-lead", "--studio", dir], { now: NOW });
    check("review --fail on done: exitCode 0", r.exitCode === 0, String(r.exitCode));
    const after = readFront<{ state: string; probationes: Record<string, { status: string; evidence: string }> }>(opusPath).data;
    check("review --fail on done: reopens to building", after.state === "building", after.state);
    check("review --fail on done: records the failed gate", after.probationes.review?.status === "failed" && after.probationes.review?.evidence === "ci/W-950-review-2.log", JSON.stringify(after.probationes.review));
  }

  // =========================================================================
  // behaviour 16: red --cwd — the wrapped command runs there, and the
  // `# tree:` header names the repo containing that directory, never the
  // officina's own (cascade 6 round-3 review, W-021 B2)
  // =========================================================================
  if (runs(16)) {
    function scratchRepo(tag: string): string {
      const gitDir = mkdtempSync(join(tmpdir(), `bisellium-w020-b16-${tag}-`));
      writeFileSync(join(gitDir, "marker.txt"), tag);
      execFileSync("git", ["init", "-q"], { cwd: gitDir });
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: gitDir });
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", tag], { cwd: gitDir });
      return gitDir;
    }

    const outer = scratchRepo("outer");
    const inner = scratchRepo("inner");
    const studioDir = join(outer, "studio");
    cpSync(sampleStudio, studioDir, { recursive: true });

    const outerHash = `tree:${sourceTreeHash(outer, ["studio"], "HEAD")}`;
    const innerHash = `tree:${sourceTreeHash(inner, [], "HEAD")}`;
    check("red behaviour-16 fixture: outer and inner trees differ", outerHash !== innerHash);

    // ---- --cwd runs the wrapped command there and certifies that repo ----
    {
      const r = await runRed(
        [
          "W-961",
          "--behaviour",
          "1",
          "--sella",
          "builder-a",
          "--studio",
          studioDir,
          "--now",
          NOW.toISOString(),
          "--cwd",
          inner,
          "--",
          "node",
          "-e",
          "require('node:fs').writeFileSync('ran-here.txt', 'x'); process.exit(1)",
        ],
        {},
      );
      check("red --cwd: recording exits 0", r.exitCode === 0, String(r.exitCode));
      check("red --cwd: the wrapped command ran with --cwd as its cwd", existsSync(join(inner, "ran-here.txt")));
      const treeLine = readFileSync(join(studioDir, "ci", "reds", "W-961", "01.log"), "utf8").split("\n")[5];
      check("red --cwd: # tree: names --cwd's repo, not the officina's", treeLine === `# tree: ${innerHash}`, treeLine);
      rmSync(join(inner, "ran-here.txt")); // leave `inner` clean for the next sub-test
    }

    // ---- no --cwd, no --repo: names the repo of the actual process cwd,
    //      never assumed from --studio's own location (the round-3 bug) ----
    {
      const prevCwd = process.cwd();
      process.chdir(inner);
      try {
        const r = await runRed(["W-962", "--behaviour", "1", "--sella", "builder-a", "--studio", studioDir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(1)"], {});
        check("red: default (no --cwd/--repo) exits 0", r.exitCode === 0, String(r.exitCode));
        const treeLine = readFileSync(join(studioDir, "ci", "reds", "W-962", "01.log"), "utf8").split("\n")[5];
        check("red: default names the actual cwd's repo, not the officina's parent", treeLine === `# tree: ${innerHash}` && treeLine !== `# tree: ${outerHash}`, treeLine);
      } finally {
        process.chdir(prevCwd);
      }
    }

    // ---- --cwd naming a directory outside any git repo -> "none" ---------
    {
      const plain = mkdtempSync(join(tmpdir(), "bisellium-w020-b16-none-"));
      const r = await runRed(["W-963", "--behaviour", "1", "--sella", "builder-a", "--studio", studioDir, "--now", NOW.toISOString(), "--cwd", plain, "--", "node", "-e", "process.exit(1)"], {});
      check("red --cwd (no enclosing git repo): exits 0", r.exitCode === 0, String(r.exitCode));
      const treeLine = readFileSync(join(studioDir, "ci", "reds", "W-963", "01.log"), "utf8").split("\n")[5];
      check('red --cwd (no enclosing git repo): "# tree: none"', treeLine === "# tree: none", treeLine);
      rmSync(plain, { recursive: true, force: true });
    }

    rmSync(outer, { recursive: true, force: true });
    rmSync(inner, { recursive: true, force: true });
  }
  // =========================================================================
  // behaviour 17: review --model records the model that actually executed
  // the gate — the field process.review_tier reads directly (W-028 round 2,
  // A5). Overwritten on every re-recorded round exactly like
  // sella/status/evidence/at: a round that omits --model must not leave a
  // stale model from a previous round attached to its own verdict.
  // =========================================================================
  if (runs(17)) {
    const dir = freshStudio("review-model");
    writeFileSync(join(dir, "ci", "review-model-1.log"), "round 1 notes\n");
    const opusPath = join(dir, "opera", "W-002.md");

    const r = runReview(
      ["W-002", "--pass", "--evidence", "ci/review-model-1.log", "--sella", "eng-lead", "--model", "claude-opus-5", "--studio", dir],
      { now: NOW },
    );
    check("review --model: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const after = readFront<{ probationes: Record<string, { model?: string }> }>(opusPath).data;
    check("review --model: records the model field", after.probationes.review?.model === "claude-opus-5", JSON.stringify(after.probationes.review));

    writeFileSync(join(dir, "ci", "review-model-2.log"), "round 2 notes\n");
    const r2 = runReview(["W-002", "--fail", "--evidence", "ci/review-model-2.log", "--sella", "eng-lead", "--studio", dir], { now: NOW });
    check("review --model omitted: exitCode 0", r2.exitCode === 0, String(r2.exitCode));

    const after2 = readFront<{ probationes: Record<string, { model?: string }> }>(opusPath).data;
    check(
      "review --model omitted: does not carry over a stale model from a previous round",
      after2.probationes.review?.model === undefined,
      JSON.stringify(after2.probationes.review),
    );
  }
  // =========================================================================
  // W-042 halt — behaviours 18-22 (this opus's own behaviours 1-5). See
  // studio/briefs/W-042.md "Order of work": behaviour 5 (block 22) is
  // written and its red recorded first, at HEAD, with no lifecycle.ts
  // changes — it only exercises `runReady`, already landed, and fails
  // because `runReady` today deletes three keys, not four.
  // =========================================================================

  // ---- behaviour 18 (opus behaviour 1): halt moves a building opus to
  //      halted and writes all five keys, body untouched, one event -------
  if (runs(18)) {
    const dir = freshStudio("halt-building");
    mkdirSync(join(dir, "decisions"), { recursive: true });
    writeFileSync(join(dir, "decisions", "D-900.md"), "# D-900\n\nDecision fixture.\n");

    const opusPath = join(dir, "opera", "W-002.md");
    const before = readFileSync(opusPath, "utf8");
    const beforeSplit = splitFront(before)!;

    const r = runHalt(["W-002", "--reason", "blocked on vendor", "--resume-when", "vendor responds", "--decision", "D-900", "--sella", "builder-a", "--studio", dir], { now: NOW });
    check("halt: building -> halted exits 0", r.exitCode === 0, String(r.exitCode));

    const after = readFront<Record<string, unknown>>(opusPath).data;
    check("halt: state -> halted", after["state"] === "halted", String(after["state"]));
    check("halt: halted_at set to now", after["halted_at"] === NOW.toISOString(), String(after["halted_at"]));
    check("halt: reason set from --reason", after["reason"] === "blocked on vendor", String(after["reason"]));
    check("halt: resume_when set from --resume-when", after["resume_when"] === "vendor responds", String(after["resume_when"]));
    check("halt: halted_by set from --decision", after["halted_by"] === "D-900", String(after["halted_by"]));

    const afterSplit = splitFront(readFileSync(opusPath, "utf8"))!;
    check("halt: body byte-identical", afterSplit.body === beforeSplit.body, JSON.stringify({ before: beforeSplit.body, after: afterSplit.body }));

    const events = readEventLines(dir);
    check("halt: exactly one workflow.state_changed event", events.length === 1 && events[0]?.["name"] === "workflow.state_changed", JSON.stringify(events));
    const attrs = events[0]?.["attrs"] as Record<string, unknown> | undefined;
    check(
      "halt: event carries item/from/to/actor",
      attrs?.[WF.ITEM_ID] === "W-002" && attrs?.[WF.STATE_FROM] === "building" && attrs?.[WF.STATE_TO] === "halted" && attrs?.[WF.ACTOR_ROLE] === "builder-a",
      JSON.stringify(attrs),
    );
  }

  // ---- behaviour 19 (opus behaviour 2): every refusal exits 2 and writes
  //      nothing (no file change, no event) --------------------------------
  if (runs(19)) {
    const dir = freshStudio("halt-refuse");
    mkdirSync(join(dir, "decisions"), { recursive: true });
    writeFileSync(join(dir, "decisions", "D-901.md"), "# D-901\n");

    writeOpus(
      dir,
      "W-101",
      [
        "---",
        "id: W-101",
        "title: Halted already",
        "kind: feature",
        "collegium: engineering",
        "state: halted",
        "halted_at: 2026-09-01T00:00:00Z",
        "reason: prior reason",
        "resume_when: prior resume",
        "halted_by: D-800",
        "probationes: {}",
        "---",
        "Body.",
        "",
      ].join("\n"),
    );

    const good = ["--reason", "r", "--resume-when", "rw", "--decision", "D-901"];
    const cases: { label: string; opusId: string; args: string[] }[] = [
      { label: "done source state", opusId: "W-001", args: [...good] },
      { label: "halted source state", opusId: "W-101", args: [...good] },
      { label: "unknown opus id", opusId: "W-999", args: [...good] },
      { label: "missing --reason", opusId: "W-002", args: ["--resume-when", "rw", "--decision", "D-901"] },
      { label: "missing --resume-when", opusId: "W-002", args: ["--reason", "r", "--decision", "D-901"] },
      { label: "missing --decision", opusId: "W-002", args: ["--reason", "r", "--resume-when", "rw"] },
      { label: "--decision naming a nonexistent file", opusId: "W-002", args: ["--reason", "r", "--resume-when", "rw", "--decision", "D-does-not-exist"] },
      { label: "--decision of ../../etc/passwd", opusId: "W-002", args: ["--reason", "r", "--resume-when", "rw", "--decision", "../../etc/passwd"] },
      // D-008: a plain join() (no safeItemPath) resolves "../leges/qa" to a
      // file that actually EXISTS in the sample studio, so only the
      // containment guard — never the missing-file check — refuses this one
      // (round-1 F-1a: "../../etc/passwd" above is defeated by a raw join
      // too, but its ".md"-suffixed target never exists either way).
      { label: "--decision of ../leges/qa", opusId: "W-002", args: ["--reason", "r", "--resume-when", "rw", "--decision", "../leges/qa"] },
      // D-008 on the opus id itself (round-1 F-1b): no prior case ever tried
      // traversal on the positional <opus>. "../petitiones/A-1" resolves
      // under a plain join to a real file (petitiones/A-1.md), so again only
      // the guard — not the missing-file check — can refuse it. The loop's
      // own opusPath (join(dir,"opera",`${opusId}.md`)) collapses the same
      // way and lands on that same petitio, so "leaves the file unchanged"
      // below is already asserting the traversal target, not just the id.
      { label: "opus id ../petitiones/A-1", opusId: "../petitiones/A-1", args: [...good] },
    ];

    for (const { label, opusId, args } of cases) {
      const opusPath = join(dir, "opera", `${opusId}.md`);
      const before = existsSync(opusPath) ? readFileSync(opusPath, "utf8") : undefined;
      const eventsBefore = readEventLines(dir).length;
      const r = runHalt([opusId, ...args, "--studio", dir], { now: NOW });
      check(`halt: refuses on ${label} with exit 2`, r.exitCode === 2, String(r.exitCode));
      if (before !== undefined) check(`halt: ${label} leaves the opus file unchanged`, readFileSync(opusPath, "utf8") === before);
      check(`halt: ${label} appends no event`, readEventLines(dir).length === eventsBefore);
    }

    // A positive control, a fully valid case distinct from behaviour 1's own
    // (a different opus, a different decision) — every case above expects
    // exit 2, which an always-refusing stub satisfies unconditionally; this
    // is the assertion that makes the block a genuine red instead of one a
    // stub trivially passes.
    writeOpus(dir, "W-960", ["---", "id: W-960", "title: Valid halt target", "kind: feature", "collegium: engineering", "state: building", "probationes: {}", "---", "Body.", ""].join("\n"));
    const validPath = join(dir, "opera", "W-960.md");
    const rValid = runHalt(["W-960", "--reason", "r2", "--resume-when", "rw2", "--decision", "D-901", "--sella", "builder-a", "--studio", dir], { now: NOW });
    check("halt: a fully valid case (source state + real decision) exits 0", rValid.exitCode === 0, String(rValid.exitCode));
    const afterValid = readFront<Record<string, unknown>>(validPath).data;
    check("halt: the valid case actually wrote state=halted", afterValid["state"] === "halted", String(afterValid["state"]));
  }

  // ---- behaviour 20 (opus behaviour 3): a failed review gate survives the
  //      halt untouched — the anti-dodge guard -----------------------------
  if (runs(20)) {
    const dir = freshStudio("halt-review-survives");
    mkdirSync(join(dir, "decisions"), { recursive: true });
    writeFileSync(join(dir, "decisions", "D-017.md"), "# D-017\n");

    const opusPath = writeOpus(
      dir,
      "W-950",
      [
        "---",
        "id: W-950",
        "title: Failed review, halted anyway",
        "kind: feature",
        "collegium: engineering",
        "state: building",
        "probationes:",
        "  review: { status: failed, evidence: ci/W-028-review-3.log, sella: eng-lead, at: 2026-09-18T10:00:00Z }",
        "---",
        "Body.",
        "",
      ].join("\n"),
    );

    const before = readFront<{ probationes: Record<string, unknown> }>(opusPath).data.probationes;

    const r = runHalt(["W-950", "--reason", "dodging nothing, see D-017", "--resume-when", "never", "--decision", "D-017", "--studio", dir], { now: NOW });
    check("halt: succeeds on a building opus with a failed review", r.exitCode === 0, String(r.exitCode));

    const after = readFront<{ state: string; probationes: Record<string, unknown> }>(opusPath).data;
    check("halt: state -> halted", after.state === "halted", after.state);
    check(
      "halt: probationes deep-equal before and after — the failed review is never edited",
      JSON.stringify(after.probationes) === JSON.stringify(before),
      JSON.stringify({ before, after: after.probationes }),
    );
  }

  // ---- behaviour 21 (opus behaviour 4): check reports a halted opus's
  //      active-state debt only while it is active -------------------------
  if (runs(21)) {
    const dir = freshStudio("halt-check-active");
    mkdirSync(join(dir, "ci", "reds"), { recursive: true });
    mkdirSync(join(dir, "decisions"), { recursive: true });
    writeFileSync(join(dir, "decisions", "D-902.md"), "# D-902\n");
    const briefsDir = join(dir, "briefs");
    mkdirSync(briefsDir, { recursive: true });
    writeFileSync(join(briefsDir, "W-970.md"), ["# W-970", "", "## Behaviours to test", "", "1. First behaviour.", "2. Second behaviour.", ""].join("\n"));
    writeOpus(
      dir,
      "W-970",
      [
        "---",
        "id: W-970",
        "title: Halt regression fixture",
        "kind: feature",
        "collegium: engineering",
        "state: building",
        "spec: briefs/W-970.md",
        "probationes: {}",
        "---",
        "Body.",
        "",
      ].join("\n"),
    );

    const before = checkStudio(dir, NOW);
    const beforeFor970 = before.findings.filter((f) => f.where.includes("W-970"));
    check("check: W-970 blocks on opus.red_evidence before halt", beforeFor970.some((f) => f.rule === "opus.red_evidence" && f.level === "block"), JSON.stringify(beforeFor970));
    check("check: W-970 blocks on traditio.present before halt", beforeFor970.some((f) => f.rule === "traditio.present" && f.level === "block"), JSON.stringify(beforeFor970));
    check("check: W-970 counts toward wip.cap before halt", before.findings.some((f) => f.rule === "wip.cap"), JSON.stringify(before.findings.filter((f) => f.rule === "wip.cap")));

    const r = runHalt(["W-970", "--reason", "regression guard", "--resume-when", "never", "--decision", "D-902", "--studio", dir], { now: NOW });
    check("halt: W-970 building -> halted exits 0", r.exitCode === 0, String(r.exitCode));

    const after = checkStudio(dir, NOW);
    const afterFor970 = after.findings.filter((f) => f.where.includes("W-970"));
    check("check: W-970 has no blocking findings once halted", afterFor970.every((f) => f.level !== "block"), JSON.stringify(afterFor970));
    check(
      "check: halted.exit/halted.at do not fire — the verb wrote what they read",
      !afterFor970.some((f) => f.rule === "halted.exit" || f.rule === "halted.at"),
      JSON.stringify(afterFor970),
    );
    check("check: wip.cap no longer counts W-970", !after.findings.some((f) => f.rule === "wip.cap"), JSON.stringify(after.findings.filter((f) => f.rule === "wip.cap")));

    const r2 = runReady(["W-970", "--studio", dir], { now: NOW });
    check("ready: W-970 halted -> building exits 0", r2.exitCode === 0, String(r2.exitCode));

    const afterReady = checkStudio(dir, NOW);
    check(
      "check: opus.red_evidence fires again once resurrected",
      afterReady.findings.some((f) => f.where.includes("W-970") && f.rule === "opus.red_evidence" && f.level === "block"),
      JSON.stringify(afterReady.findings.filter((f) => f.where.includes("W-970"))),
    );
  }

  // ---- behaviour 22 (opus behaviour 5): ready clears halted_by with the
  //      rest of the halt entry --------------------------------------------
  if (runs(22)) {
    const dir = freshStudio("ready-clears-halted-by");
    writeOpus(
      dir,
      "W-980",
      [
        "---",
        "id: W-980",
        "title: Halted, resurrected",
        "kind: feature",
        "collegium: engineering",
        "state: halted",
        "halted_at: 2026-09-01T00:00:00Z",
        "reason: waiting on a decision",
        "resume_when: decision made",
        "halted_by: D-017",
        "probationes: {}",
        "---",
        "Body.",
        "",
      ].join("\n"),
    );
    const briefsDir = join(dir, "briefs");
    mkdirSync(briefsDir, { recursive: true });
    writeFileSync(join(briefsDir, "W-980.md"), "Brief for W-980.\n");

    const r = runReady(["W-980", "--studio", dir], { now: NOW });
    check("ready: W-980 halted -> building exits 0", r.exitCode === 0, String(r.exitCode));

    const after = readFront<Record<string, unknown>>(join(dir, "opera", "W-980.md")).data;
    check(
      "ready: halted_at/reason/resume_when/halted_by all cleared",
      after["halted_at"] === undefined && after["reason"] === undefined && after["resume_when"] === undefined && after["halted_by"] === undefined,
      JSON.stringify(after),
    );
  }

  // =========================================================================
  // W-033 — D-021's one-writer guard. Every fixture here is a real git repo
  // with the studio committed inside it (studio/briefs/W-033.md: the W-026
  // blind spot). Blocks 23-29 map to this opus's behaviours 1-7.
  // =========================================================================

  // ---- behaviour 23 (opus behaviour 1): `done` from a trunk checkout is
  //      refused while opus/<id> exists (W-034 defect 2) --------------------
  if (runs(23)) {
    const repo = tmpGitStudioRepo("done-trunk");
    const studioDir = join(repo, "studio");
    writeOpus(studioDir, "W-100", passingOpusFrontMatter("W-100", "Done from trunk while branch exists"));
    gitCommitAll(repo, "init");
    gitBranch(repo, "opus/W-100"); // repo itself stays on master

    const opusPath = join(studioDir, "opera", "W-100.md");
    const before = readFileSync(opusPath, "utf8");
    const eventsPath = join(studioDir, EVENTS_LOG_REL);
    const eventsBefore = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : undefined;

    const { result: r, stderr } = await withStderr(() => runDone(["W-100", "--studio", studioDir], { now: NOW }));
    check("W-033 b1: done from trunk refused while opus/W-100 exists", r.exitCode === 2, String(r.exitCode));
    check("W-033 b1: refusal names opus/W-100 and D-021", stderr.includes("opus/W-100") && stderr.includes("D-021"), stderr);
    check("W-033 b1: record byte-identical", readFileSync(opusPath, "utf8") === before);
    check(
      "W-033 b1: events log unchanged (absence counts as unchanged)",
      (existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : undefined) === eventsBefore,
    );
    check("W-033 b1: git status is clean", gitStatusPorcelain(repo).trim() === "", gitStatusPorcelain(repo));

    // ---- round-1 B1: a git FAILURE in steps 2/4 (not the benign "no")
    //      refuses rather than allowing. `git pack-refs` then a garbage line
    //      appended to .git/packed-refs makes both `symbolic-ref -q HEAD` and
    //      `show-ref --verify --quiet` exit 128 — the round-1 defect read any
    //      non-zero exit as the benign negative and fell through to ALLOW. ---
    execFileSync("git", ["pack-refs", "--all"], { cwd: repo });
    const packedRefsPath = join(repo, ".git", "packed-refs");
    const packedRefsBefore = readFileSync(packedRefsPath, "utf8");
    writeFileSync(packedRefsPath, `${packedRefsBefore}garbage not a valid ref line\n`);
    const beforeCorrupt = readFileSync(opusPath, "utf8");
    let r3: { exitCode: number };
    let stderr3: string;
    try {
      ({ result: r3, stderr: stderr3 } = await withStderr(() => runDone(["W-100", "--studio", studioDir], { now: NOW })));
    } finally {
      writeFileSync(packedRefsPath, packedRefsBefore);
    }
    check("W-033 b1: a git failure (corrupt packed-refs, exit 128) refuses rather than allowing", r3.exitCode === 2, String(r3.exitCode));
    check("W-033 b1: git-failure refusal names D-021", stderr3.includes("D-021"), stderr3);
    check("W-033 b1: record byte-identical after the git-failure refusal", readFileSync(opusPath, "utf8") === beforeCorrupt);
  }

  // ---- behaviour 24 (opus behaviour 2): `review` from a detached worktree
  //      at the branch tip is refused (W-030/W-031) -------------------------
  if (runs(24)) {
    const repo = tmpGitStudioRepo("review-detached");
    const studioDir = join(repo, "studio");
    writeOpus(
      studioDir,
      "W-101",
      ["---", "id: W-101", "title: Review from a detached worktree at the branch tip", "kind: feature", "collegium: engineering", "state: building", "probationes: {}", "---", "Body.", ""].join(
        "\n",
      ),
    );
    gitCommitAll(repo, "init");
    gitBranch(repo, "opus/W-101");

    const wtPath = gitWorktreeAdd(repo, ["--detach"], "opus/W-101");
    const wtStudioDir = join(wtPath, "studio");
    mkdirSync(join(wtStudioDir, "ci"), { recursive: true });
    writeFileSync(join(wtStudioDir, "ci", "W-101-review.log"), "evidence\n");

    const opusPath = join(wtStudioDir, "opera", "W-101.md");
    const before = readFileSync(opusPath, "utf8");

    const { result: r, stderr } = await withStderr(() =>
      runReview(["W-101", "--pass", "--evidence", "ci/W-101-review.log", "--studio", wtStudioDir], { now: NOW }),
    );
    check("W-033 b2: review refused from a detached worktree at the branch tip", r.exitCode === 2, String(r.exitCode));
    check("W-033 b2: refusal names opus/W-101 and D-021 even though HEAD == branch tip", stderr.includes("opus/W-101") && stderr.includes("D-021"), stderr);
    check("W-033 b2: record byte-identical", readFileSync(opusPath, "utf8") === before);
  }

  // ---- behaviour 25 (opus behaviour 3): every other record writer refuses
  //      the same way from the trunk (ready/halt/handoff/greenlight) -------
  if (runs(25)) {
    const repo = tmpGitStudioRepo("other-writers-trunk");
    const studioDir = join(repo, "studio");

    const briefsDir = join(studioDir, "briefs");
    mkdirSync(briefsDir, { recursive: true });
    writeFileSync(join(briefsDir, "W-110.md"), "Brief for W-110.\n");
    writeOpus(studioDir, "W-110", ["---", "id: W-110", "title: ready target", "kind: feature", "collegium: engineering", "state: greenlit", "probationes: {}", "---", "Body.", ""].join("\n"));

    const decisionsDir = join(studioDir, "decisions");
    mkdirSync(decisionsDir, { recursive: true });
    writeFileSync(join(decisionsDir, "D-910.md"), "# D-910\n");
    writeOpus(studioDir, "W-111", ["---", "id: W-111", "title: halt target", "kind: feature", "collegium: engineering", "state: building", "probationes: {}", "---", "Body.", ""].join("\n"));

    writeOpus(studioDir, "W-112", ["---", "id: W-112", "title: handoff target", "kind: feature", "collegium: engineering", "state: backlog", "probationes: {}", "---", "Body.", ""].join("\n"));
    writeOpus(studioDir, "W-113", ["---", "id: W-113", "title: greenlight target", "kind: feature", "collegium: engineering", "state: backlog", "probationes: {}", "---", "Body.", ""].join("\n"));

    gitCommitAll(repo, "init");
    for (const id of ["W-110", "W-111", "W-112", "W-113"]) gitBranch(repo, `opus/${id}`);

    // `emitsEvent: false` for handoff (round-1 A3): runHandoff never calls
    // emitEvent even on success, so "appends no event" can't fail either
    // way for it — the guard is what makes handoff's write a no-op, and
    // that's what "record byte-identical" above already tests.
    const cases: { label: string; id: string; emitsEvent?: boolean; run: () => WriteResult }[] = [
      { label: "ready", id: "W-110", run: () => runReady(["W-110", "--studio", studioDir], { now: NOW }) },
      {
        label: "halt",
        id: "W-111",
        run: () => runHalt(["W-111", "--reason", "r", "--resume-when", "rw", "--decision", "D-910", "--studio", studioDir], { now: NOW }),
      },
      {
        label: "handoff",
        id: "W-112",
        emitsEvent: false,
        run: () => runHandoff(["--opus", "W-112", "--sella", "builder-1", "--next", "n", "--studio", studioDir], { now: NOW }),
      },
      { label: "greenlight", id: "W-113", run: () => runGreenlight(["W-113", "--studio", studioDir], { now: NOW }) },
    ];

    for (const { label, id, emitsEvent, run } of cases) {
      const opusPath = join(studioDir, "opera", `${id}.md`);
      const before = readFileSync(opusPath, "utf8");
      const eventsBefore = readEventLines(studioDir).length;
      const { result: r, stderr } = await withStderr(run);
      check(`W-033 b3: ${label} refused from trunk`, r.exitCode === 2, String(r.exitCode));
      check(`W-033 b3: ${label} message names opus/${id} and D-021`, stderr.includes(`opus/${id}`) && stderr.includes("D-021"), stderr);
      check(`W-033 b3: ${label} record byte-identical`, readFileSync(opusPath, "utf8") === before);
      if (emitsEvent !== false) check(`W-033 b3: ${label} appends no event`, readEventLines(studioDir).length === eventsBefore);
    }
  }

  // ---- behaviour 26 (opus behaviour 4): `verify` refuses before running
  //      anything ------------------------------------------------------------
  if (runs(26)) {
    const repo = tmpGitStudioRepo("verify-trunk");
    const studioDir = join(repo, "studio");
    writeOpus(studioDir, "W-120", ["---", "id: W-120", "title: verify target", "kind: feature", "collegium: engineering", "state: building", "probationes: {}", "---", "Body.", ""].join("\n"));
    gitCommitAll(repo, "init");
    gitBranch(repo, "opus/W-120");

    const opusPath = join(studioDir, "opera", "W-120.md");
    const before = readFileSync(opusPath, "utf8");
    const ciDir = join(studioDir, "ci");
    const ciCountBefore = existsSync(ciDir) ? readdirSync(ciDir).length : 0;

    // Round-1 A3: a stub that returns {} makes "no new file under ci/" and
    // "record byte-identical" pass whether or not the guard runs (an
    // unguarded verify with an empty result set still writes nothing new).
    // Return one passed gate and write its evidence file, the way a real
    // pipeline would, so both assertions actually bite if the guard is removed.
    let called = false;
    const stubPipeline: MergePipeline = {
      id: "stub",
      run: async (opts) => {
        called = true;
        writeFileSync(join(opts.logDir, "W-120-tests-stub.log"), "stub\n");
        return { tests: { status: "passed", evidence: "ci/W-120-tests-stub.log", certifies: `tree:${opts.treeHash}` } };
      },
    };

    const { result: r, stderr } = await withStderr(() => runVerify(["W-120", "--studio", studioDir, "--repo", repo], { pipeline: stubPipeline }));
    check("W-033 b4: verify refused from trunk", r.exitCode === 2, String(r.exitCode));
    check("W-033 b4: the pipeline was never called", called === false);
    check("W-033 b4: refusal names opus/W-120 and D-021", stderr.includes("opus/W-120") && stderr.includes("D-021"), stderr);
    check("W-033 b4: no new file under studio/ci/", (existsSync(ciDir) ? readdirSync(ciDir).length : 0) === ciCountBefore);
    check("W-033 b4: record byte-identical", readFileSync(opusPath, "utf8") === before);
  }

  // ---- behaviour 27 (opus behaviour 5): an opus branch cannot write
  //      another opus's record ----------------------------------------------
  if (runs(27)) {
    const repo = tmpGitStudioRepo("branch-cross-write");
    const studioDir = join(repo, "studio");
    writeOpus(studioDir, "W-130", ["---", "id: W-130", "title: the checkout's own opus", "kind: feature", "collegium: engineering", "state: building", "probationes: {}", "---", "Body.", ""].join("\n"));
    writeOpus(studioDir, "W-131", ["---", "id: W-131", "title: a different opus, no branch of its own", "kind: feature", "collegium: engineering", "state: backlog", "probationes: {}", "---", "Body.", ""].join("\n"));
    gitCommitAll(repo, "init");
    gitBranch(repo, "opus/W-130");
    gitCheckout(repo, "opus/W-130"); // opus/W-131 is never created

    const opusPathX = join(studioDir, "opera", "W-131.md");
    const before = readFileSync(opusPathX, "utf8");

    const { result: r, stderr } = await withStderr(() =>
      runHandoff(["--opus", "W-131", "--sella", "builder-1", "--next", "n", "--studio", studioDir], { now: NOW }),
    );
    check("W-033 b5: handoff on W-131 refused from an opus/W-130 checkout", r.exitCode === 2, String(r.exitCode));
    check("W-033 b5: message names opus/W-130, this checkout's own branch", stderr.includes("opus/W-130"), stderr);
    check("W-033 b5: W-131's record byte-identical", readFileSync(opusPathX, "utf8") === before);
  }

  // ---- behaviour 28 (opus behaviour 6): ownership is decided by the
  //      checkout that holds `--studio`, not by `process.cwd()` ------------
  if (runs(28)) {
    const repo = tmpGitStudioRepo("cwd-vs-studio");
    const studioDir = join(repo, "studio");
    writeOpus(studioDir, "W-140", passingOpusFrontMatter("W-140", "cwd vs --studio"));
    gitCommitAll(repo, "init");
    gitBranch(repo, "opus/W-140");
    const wtPath = gitWorktreeAdd(repo, [], "opus/W-140"); // attached, not detached
    const wtStudioDir = join(wtPath, "studio");

    const trunkOpusPath = join(studioDir, "opera", "W-140.md");
    const wtOpusPath = join(wtStudioDir, "opera", "W-140.md");
    const trunkBefore = readFileSync(trunkOpusPath, "utf8");

    const origCwd = process.cwd();
    let r1: { exitCode: number };
    try {
      process.chdir(repo); // cwd sits in the trunk checkout...
      r1 = runDone(["W-140", "--studio", wtStudioDir], { now: NOW }); // ...but --studio names the owning worktree
    } finally {
      process.chdir(origCwd);
    }
    check("W-033 b6: cwd=trunk, --studio=owning worktree exits 0", r1.exitCode === 0, String(r1.exitCode));
    const wtAfter = readFront<{ state: string }>(wtOpusPath).data;
    check("W-033 b6: the worktree's record is now done", wtAfter.state === "done", wtAfter.state);
    check("W-033 b6: the trunk's record stays byte-identical", readFileSync(trunkOpusPath, "utf8") === trunkBefore);

    let r2: { exitCode: number };
    try {
      process.chdir(wtStudioDir); // mirror: cwd sits in the owning worktree...
      r2 = runDone(["W-140", "--studio", studioDir], { now: NOW }); // ...but --studio names the trunk
    } finally {
      process.chdir(origCwd);
    }
    check("W-033 b6 mirror: cwd=worktree, --studio=trunk exits 2", r2.exitCode === 2, String(r2.exitCode));
    check("W-033 b6 mirror: the trunk's record still stays byte-identical", readFileSync(trunkOpusPath, "utf8") === trunkBefore);
  }

  // ---- behaviour 29 (opus behaviour 7): an untracked record is left
  //      alone ---------------------------------------------------------------
  if (runs(29)) {
    const repo = tmpGitRepoIgnoredStudio("untracked-record");
    const studioDir = join(repo, "studio");
    writeOpus(studioDir, "W-150", passingOpusFrontMatter("W-150", "an untracked record"));
    gitBranch(repo, "opus/W-150"); // the branch exists; the record is never tracked

    const r = runDone(["W-150", "--studio", studioDir], { now: NOW });
    check("W-033 b7: done on an untracked record exits 0 even though opus/W-150 exists", r.exitCode === 0, String(r.exitCode));
    const after = readFront<{ state: string }>(join(studioDir, "opera", "W-150.md")).data;
    check("W-033 b7: state -> done", after.state === "done", after.state);
  }

  // ---- behaviour 30 (round-1 A5): `close` and `ci --opus` inherit the
  //      refusal through executeClose -> runDone and ci -> runVerify -------
  if (runs(30)) {
    const repo = tmpGitStudioRepo("close-ci-inherit");
    const studioDir = join(repo, "studio");
    writeOpus(studioDir, "W-160", passingOpusFrontMatter("W-160", "close inherits the guard"));
    writeOpus(
      studioDir,
      "W-161",
      ["---", "id: W-161", "title: ci --opus inherits the guard", "kind: feature", "collegium: engineering", "state: building", "probationes: {}", "---", "Body.", ""].join("\n"),
    );
    // CI_STEPS' six commands need something real (but trivial) to run
    // against — same fixture shape ci.test.ts's makeCiRepo uses, so `ci`
    // actually reaches the `--opus` verify call instead of failing earlier.
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify(
        {
          name: "close-ci-inherit-fixture",
          private: true,
          scripts: {
            typecheck: 'node -e "process.exit(0)"',
            lint: 'node -e "process.exit(0)"',
            "format:check": 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
            check: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      ),
    );
    gitCommitAll(repo, "init");
    gitBranch(repo, "opus/W-160");
    gitBranch(repo, "opus/W-161");

    const closePath = join(studioDir, "opera", "W-160.md");
    const closeBefore = readFileSync(closePath, "utf8");
    const { result: closeResult, stderr: closeStderr } = await withStderr(() => executeClose(studioDir, "W-160"));
    check("W-033 A5: close refused while opus/W-160 exists", closeResult.ok === false, JSON.stringify(closeResult));
    check("W-033 A5: close's underlying refusal names opus/W-160 and D-021", closeStderr.includes("opus/W-160") && closeStderr.includes("D-021"), closeStderr);
    check("W-033 A5: close leaves the record byte-identical", readFileSync(closePath, "utf8") === closeBefore);

    const ciPath = join(studioDir, "opera", "W-161.md");
    const ciBefore = readFileSync(ciPath, "utf8");
    const { result: ciResult, stderr: ciStderr } = await withStderr(() => runCi(["--repo", repo, "--studio", studioDir, "--opus", "W-161"]));
    check("W-033 A5: ci --opus refused while opus/W-161 exists", ciResult.exitCode === 2, String(ciResult.exitCode));
    check("W-033 A5: ci --opus message names opus/W-161 and D-021", ciStderr.includes("opus/W-161") && ciStderr.includes("D-021"), ciStderr);
    check("W-033 A5: ci --opus leaves the record byte-identical", readFileSync(ciPath, "utf8") === ciBefore);
  }

  // =========================================================================
  // W-034 — `done` honours a Patron waiver, human gates only. Behaviour n is
  // block 30+n for n=1-9 and n=11; behaviour 10 is
  // examples/fixtures/bad-waived-agent/, picked up by test.ts, not here.
  // =========================================================================

  /** Every gate `runDone` demands, all passed by default — behaviours 1/2/3/
   *  4/9/11's shared baseline. `overrides` replaces (or, with `undefined`,
   *  drops) one gate's line; a dropped gate is "unrecorded". `spec`/`legal`
   *  are never in the base — only present when a caller's manifest declares
   *  them and passes an explicit override. */
  function w034Lines(overrides: Record<string, string | undefined> = {}): string {
    const base: Record<string, string | undefined> = {
      tests: "{ status: passed, evidence: ci/x.log, certifies: tree:abc123 }",
      lint: "{ status: passed, evidence: ci/x.log, certifies: tree:abc123 }",
      types: "{ status: passed, evidence: ci/x.log, certifies: tree:abc123 }",
      qa: "{ status: passed, evidence: reviews/x.md }",
      review: "{ status: passed, evidence: reviews/x.md }",
      ...overrides,
    };
    return Object.entries(base)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([id, v]) => `  ${id}: ${v}`)
      .join("\n");
  }

  // ---- behaviour 1 (block 31): the agent row, cell by cell — qa, review,
  //      spec (added to the manifest for this block only) -----------------
  if (runs(31)) {
    const dir = freshStudio("done-agent-row");
    addProbatio(dir, { id: "spec", name: "Spec", kind: "agent" });
    let n = 0;
    const nextId = () => `W-5${String(++n).padStart(2, "0")}`;

    for (const gate of ["qa", "review", "spec"] as const) {
      const passLine = gate === "spec" ? "{ status: passed, evidence: briefs/x.md }" : "{ status: passed, evidence: reviews/x.md }";

      for (const status of ["unrecorded", "pending", "failed", "stale"] as const) {
        const id = nextId();
        const line = status === "unrecorded" ? undefined : status === "failed" ? "{ status: failed, evidence: reviews/x.md }" : `{ status: ${status} }`;
        writeOpus(dir, id, opusWithProbationes(id, "building", w034Lines({ spec: passLine, [gate]: line })));
        const r = runDone([id, "--studio", dir], { now: NOW });
        check(`done b1: ${gate} ${status} exits 1`, r.exitCode === 1, `${gate}/${status}: ${r.exitCode}`);
      }

      // The positive control: passed exits 0.
      const idPass = nextId();
      writeOpus(dir, idPass, opusWithProbationes(idPass, "building", w034Lines({ spec: passLine, [gate]: passLine })));
      const rPass = runDone([idPass, "--studio", dir], { now: NOW });
      check(`done b1: ${gate} passed exits 0 (control)`, rPass.exitCode === 0, String(rPass.exitCode));

      // Waived, in two shapes — both refuse, an agent gate is never waivable.
      for (const [shape, line] of [
        ["honourable-shaped", "{ status: waived, reason: x, waived_by: D-900, sella: guest, at: 2026-01-01T00:00:00Z }"],
        ["bare", "{ status: waived }"],
      ] as const) {
        const idW = nextId();
        writeOpus(dir, idW, opusWithProbationes(idW, "building", w034Lines({ spec: passLine, [gate]: line })));
        const { result: rW, stderr } = await withStderr(() => runDone([idW, "--studio", dir], { now: NOW }));
        check(`done b1: ${gate} waived (${shape}) exits 1`, rW.exitCode === 1, String(rW.exitCode));
        check(`done b1: ${gate} waived (${shape}) stderr names the gate and probatio.waived.agent`, stderr.includes(gate) && stderr.includes("probatio.waived.agent"), stderr);
      }
    }
  }

  // ---- behaviour 2 (block 32): the automated row, cell by cell — tests ---
  if (runs(32)) {
    const dir = freshStudio("done-automated-row");
    let n = 0;
    const nextId = () => `W-6${String(++n).padStart(2, "0")}`;

    for (const status of ["unrecorded", "pending", "failed", "stale"] as const) {
      const id = nextId();
      const line = status === "unrecorded" ? undefined : status === "failed" ? "{ status: failed, evidence: ci/x.log, certifies: tree:abc123 }" : `{ status: ${status} }`;
      writeOpus(dir, id, opusWithProbationes(id, "building", w034Lines({ tests: line })));
      const r = runDone([id, "--studio", dir], { now: NOW });
      check(`done b2: tests ${status} exits 1`, r.exitCode === 1, String(r.exitCode));
    }

    const idDirty = nextId();
    writeOpus(dir, idDirty, opusWithProbationes(idDirty, "building", w034Lines({ tests: "{ status: passed, evidence: ci/x.log, certifies: dirty:abc123 }" })));
    const rDirty = runDone([idDirty, "--studio", dir], { now: NOW });
    check("done b2: tests passed with a dirty certificate exits 1", rDirty.exitCode === 1, String(rDirty.exitCode));

    const idPass = nextId();
    writeOpus(dir, idPass, opusWithProbationes(idPass, "building", w034Lines({ tests: "{ status: passed, evidence: ci/x.log, certifies: tree:abc123 }" })));
    const rPass = runDone([idPass, "--studio", dir], { now: NOW });
    check("done b2: tests passed with a tree certificate exits 0 (control)", rPass.exitCode === 0, String(rPass.exitCode));

    const idW = nextId();
    writeOpus(dir, idW, opusWithProbationes(idW, "building", w034Lines({ tests: "{ status: waived, reason: x, waived_by: D-900 }" })));
    const { result: rW, stderr: sW } = await withStderr(() => runDone([idW, "--studio", dir], { now: NOW }));
    check("done b2: tests waived exits 1", rW.exitCode === 1, String(rW.exitCode));
    check(
      "done b2: tests waived stderr names tests, probatio.waived.automated and revert",
      sW.includes("tests") && sW.includes("probatio.waived.automated") && sW.includes("revert"),
      sW,
    );
  }

  // ---- behaviour 3 (block 33): the human row's refusals, cell by cell —
  //      patron ---------------------------------------------------------
  if (runs(33)) {
    const dir = freshStudio("done-human-refuse");
    writeDecision(dir, "D-900", { by: "patron" });
    writeDecision(dir, "D-901", { by: "architect" });
    writeDecision(dir, "D-903", { raw: "---\nid: D-903\n\tbad: [unclosed\n---\nBody.\n" });
    writeDecision(dir, "D-904", { by: false });
    writeDecision(dir, "D-905", { by: ["patron"] });
    // The containment sentinel: a valid Patron decision, written OUTSIDE
    // decisions/ at the officina root — only safeItemPath's containment
    // guard (never a raw join) refuses "../D-777" as a --decision value.
    writeFileSync(
      join(dir, "D-777.md"),
      ["---", "id: D-777", "title: Containment sentinel", "at: 2026-09-24T00:00:00Z", "provenance: stated", "by: patron", 'kill_when: "never"', "---", "Body.", ""].join("\n"),
    );

    let n = 0;
    const nextId = () => `W-7${String(++n).padStart(2, "0")}`;

    for (const status of ["pending", "failed", "stale"] as const) {
      const id = nextId();
      const line = status === "failed" ? "{ status: failed, evidence: ci/x.log }" : `{ status: ${status} }`;
      writeOpus(dir, id, opusWithProbationes(id, "building", w034Lines({ patron: line })));
      const r = runDone([id, "--studio", dir], { now: NOW });
      check(`done b3: patron ${status} exits 1`, r.exitCode === 1, String(r.exitCode));
    }

    const waiverRows: [string, string, string][] = [
      ["reason absent", "{ status: waived, waived_by: D-900 }", "reason"],
      ["reason blank", '{ status: waived, reason: "   ", waived_by: D-900 }', "reason"],
      ["reason not a string", "{ status: waived, reason: 42, waived_by: D-900 }", "reason"],
      ["waived_by absent", "{ status: waived, reason: x }", "waived_by"],
      ["waived_by empty", '{ status: waived, reason: x, waived_by: "" }', "waived_by"],
      ["waived_by not a string", "{ status: waived, reason: x, waived_by: 900 }", "waived_by"],
      ["waived_by not found", "{ status: waived, reason: x, waived_by: D-404 }", "D-404"],
      ["waived_by wrong signer", "{ status: waived, reason: x, waived_by: D-901 }", "D-901"],
      ["waived_by unparseable", "{ status: waived, reason: x, waived_by: D-903 }", "D-903"],
      ["waived_by no by", "{ status: waived, reason: x, waived_by: D-904 }", "D-904"],
      ["waived_by by not a string", "{ status: waived, reason: x, waived_by: D-905 }", "D-905"],
      ["waived_by containment sentinel", '{ status: waived, reason: x, waived_by: "../D-777" }', "../D-777"],
    ];
    for (const [label, line, token] of waiverRows) {
      const id = nextId();
      writeOpus(dir, id, opusWithProbationes(id, "building", w034Lines({ patron: line })));
      const { result: r, stderr } = await withStderr(() => runDone([id, "--studio", dir], { now: NOW }));
      check(`done b3: ${label} exits 1`, r.exitCode === 1, String(r.exitCode));
      check(`done b3: ${label} stderr names patron and "${token}"`, stderr.includes("patron") && stderr.includes(token), stderr);
    }
  }

  // ---- behaviour 4 (block 34): the human row's passes, and the trace -----
  if (runs(34)) {
    const dir = freshStudio("done-human-pass");
    writeDecision(dir, "D-900", { by: "patron" });
    // Real evidence files, so the checkStudio call below reports only what
    // this behaviour is actually about (link.dead is a pre-existing rule,
    // not one of the three this assertion names, but a fixture that leaves
    // it firing is still noise worth avoiding).
    writeFileSync(join(dir, "ci", "x.log"), "ok\n");
    mkdirSync(join(dir, "reviews"), { recursive: true });
    writeFileSync(join(dir, "reviews", "x.md"), "Reviewed.\n");
    mkdirSync(join(dir, "acta"), { recursive: true });
    writeFileSync(join(dir, "acta", "x.md"), "Acta.\n");

    const idUnrec = "W-800";
    writeOpus(dir, idUnrec, opusWithProbationes(idUnrec, "building", w034Lines({})));
    const { result: rUnrec, stdout: outUnrec } = await withStdout(() => runDone([idUnrec, "--studio", dir], { now: NOW }));
    check("done b4: unrecorded patron exits 0", rUnrec.exitCode === 0, String(rUnrec.exitCode));
    check("done b4: unrecorded patron stdout has no 'waived:'", !outUnrec.includes("waived:"), outUnrec);

    const idPassed = "W-801";
    writeOpus(dir, idPassed, opusWithProbationes(idPassed, "building", w034Lines({ patron: "{ status: passed, evidence: acta/x.md }" })));
    const { result: rPassed, stdout: outPassed } = await withStdout(() => runDone([idPassed, "--studio", dir], { now: NOW }));
    check("done b4: passed patron exits 0", rPassed.exitCode === 0, String(rPassed.exitCode));
    check("done b4: passed patron stdout has no 'waived:'", !outPassed.includes("waived:"), outPassed);

    const idHon = "W-802";
    writeOpus(
      dir,
      idHon,
      opusWithProbationes(idHon, "review", w034Lines({ patron: "{ status: waived, reason: docs-only opus, waived_by: D-900, sella: guest, at: 2026-09-24T00:00:00Z }" })),
    );
    const opusPathHon = join(dir, "opera", `${idHon}.md`);
    const beforeProbationes = readFront<{ probationes: Record<string, unknown> }>(opusPathHon).data.probationes;
    const beforeSplit = splitFront(readFileSync(opusPathHon, "utf8"))!;

    const { result: rHon, stdout: outHon } = await withStdout(() => runDone([idHon, "--studio", dir], { now: NOW }));
    check("done b4: honourable waiver exits 0", rHon.exitCode === 0, String(rHon.exitCode));
    check(
      "done b4: honourable waiver stdout names waived/patron/D-900",
      outHon.includes("waived:") && outHon.includes("patron") && outHon.includes("D-900"),
      outHon,
    );

    const after = readFront<{ state: string; probationes: Record<string, { status: string }> }>(opusPathHon).data;
    check("done b4: honourable waiver state -> done", after.state === "done", after.state);
    check(
      "done b4: probationes deep-equal before and after — the waiver is never rewritten",
      JSON.stringify(after.probationes) === JSON.stringify(beforeProbationes),
      JSON.stringify({ before: beforeProbationes, after: after.probationes }),
    );
    check("done b4: patron.status is still waived", after.probationes.patron?.status === "waived", JSON.stringify(after.probationes.patron));
    const afterSplit = splitFront(readFileSync(opusPathHon, "utf8"))!;
    check("done b4: body byte-identical", afterSplit.body === beforeSplit.body, JSON.stringify({ before: beforeSplit.body, after: afterSplit.body }));

    const findings = checkStudio(dir, NOW).findings.filter((f) => f.where.includes(idHon));
    check(
      "done b4: check reports no state.done.probationes/probatio.waived.agent/probatio.waived.reason for the honoured opus",
      !findings.some((f) => ["state.done.probationes", "probatio.waived.agent", "probatio.waived.reason"].includes(f.rule)),
      JSON.stringify(findings),
    );
  }

  // ---- behaviour 5 (block 35): `waive` writes a Patron waiver on every
  //      admitted state and status ----------------------------------------
  if (runs(35)) {
    const dir = freshStudio("waive-writes");
    writeDecision(dir, "D-900", { by: "patron" });

    const idBase = "W-900";
    writeOpus(dir, idBase, opusWithProbationes(idBase, "building", w034Lines({ patron: "{ status: pending, note: keep-me }" })));
    const opusPathBase = join(dir, "opera", `${idBase}.md`);
    const beforeSplit = splitFront(readFileSync(opusPathBase, "utf8"))!;
    const beforeProbationes = readFront<{ probationes: Record<string, unknown> }>(opusPathBase).data.probationes;

    const r = runWaive([idBase, "--gate", "patron", "--reason", "docs-only opus", "--decision", "D-900", "--sella", "guest", "--studio", dir], { now: NOW });
    check("waive b5: base case exits 0", r.exitCode === 0, String(r.exitCode));

    const after = readFront<{ state: string; probationes: Record<string, Record<string, unknown>> }>(opusPathBase).data;
    const patronAfter = after.probationes["patron"];
    check(
      "waive b5: the five keys are set from the CLI arguments",
      patronAfter?.["status"] === "waived" &&
        patronAfter?.["reason"] === "docs-only opus" &&
        patronAfter?.["waived_by"] === "D-900" &&
        patronAfter?.["sella"] === "guest" &&
        patronAfter?.["at"] === NOW.toISOString(),
      JSON.stringify(patronAfter),
    );
    check("waive b5: the sibling key 'note' survives", patronAfter?.["note"] === "keep-me", JSON.stringify(patronAfter));
    check("waive b5: no stray key beyond the five plus 'note'", Object.keys(patronAfter ?? {}).length === 6, JSON.stringify(patronAfter));
    check("waive b5: state stays building", after.state === "building", after.state);
    const afterSplit = splitFront(readFileSync(opusPathBase, "utf8"))!;
    check("waive b5: body byte-identical", afterSplit.body === beforeSplit.body, JSON.stringify({ before: beforeSplit.body, after: afterSplit.body }));
    const { patron: _beforePatron, ...beforeRest } = beforeProbationes;
    const { patron: _afterPatron, ...afterRest } = after.probationes;
    check("waive b5: every other gate is deep-equal to before", JSON.stringify(afterRest) === JSON.stringify(beforeRest), JSON.stringify({ beforeRest, afterRest }));

    const events = readEventLines(dir);
    check("waive b5: exactly one workflow.gate_evaluated event", events.length === 1 && events[0]?.["name"] === "workflow.gate_evaluated", JSON.stringify(events));
    const attrs = events[0]?.["attrs"] as Record<string, unknown> | undefined;
    check(
      "waive b5: event carries item/gate/status/evidence/actor",
      attrs?.[WF.ITEM_ID] === idBase &&
        attrs?.[WF.GATE_ID] === "patron" &&
        attrs?.[WF.GATE_STATUS] === "waived" &&
        attrs?.[WF.GATE_EVIDENCE] === "decisions/D-900.md" &&
        attrs?.[WF.ACTOR_ROLE] === "guest",
      JSON.stringify(attrs),
    );

    // Repeat the base case with one thing changed each time.
    const variants: { label: string; state: string; patronLine: string | undefined }[] = [
      { label: "state verifying", state: "verifying", patronLine: "{ status: pending }" },
      { label: "state review", state: "review", patronLine: "{ status: pending }" },
      { label: "patron recorded as stale", state: "building", patronLine: "{ status: stale }" },
      { label: "patron unrecorded", state: "building", patronLine: undefined },
    ];
    let vn = 0;
    for (const v of variants) {
      vn++;
      const id = `W-91${vn}`;
      writeOpus(dir, id, opusWithProbationes(id, v.state, w034Lines({ patron: v.patronLine })));
      const rv = runWaive([id, "--gate", "patron", "--reason", "r", "--decision", "D-900", "--sella", "guest", "--studio", dir], { now: NOW });
      check(`waive b5: ${v.label} exits 0`, rv.exitCode === 0, String(rv.exitCode));
      const av = readFront<{ probationes: Record<string, { status: string }> }>(join(dir, "opera", `${id}.md`)).data;
      check(`waive b5: ${v.label} writes status: waived`, av.probationes.patron?.status === "waived", JSON.stringify(av.probationes.patron));
    }

    // A temp manifest with patron: edene, and a decision with by: edene.
    const dir2 = freshStudio("waive-writes-custom-patron");
    setManifestPatron(dir2, "edene");
    writeDecision(dir2, "D-950", { by: "edene" });
    const idCustom = "W-920";
    writeOpus(dir2, idCustom, opusWithProbationes(idCustom, "building", w034Lines({ patron: "{ status: pending }" })));
    const rCustom = runWaive([idCustom, "--gate", "patron", "--reason", "r", "--decision", "D-950", "--sella", "guest", "--studio", dir2], { now: NOW });
    check("waive b5: manifest patron: edene, decision by: edene exits 0", rCustom.exitCode === 0, String(rCustom.exitCode));
    const aCustom = readFront<{ probationes: Record<string, { status: string }> }>(join(dir2, "opera", `${idCustom}.md`)).data;
    check("waive b5: custom patron id writes status: waived", aCustom.probationes.patron?.status === "waived", JSON.stringify(aCustom.probationes.patron));
  }

  // ---- behaviour 6 (block 36): every `waive` refusal exits 2, leaves the
  //      record unchanged, and names its own cause -------------------------
  if (runs(36)) {
    const dir = freshStudio("waive-refuse");
    writeDecision(dir, "D-900", { by: "patron" });
    writeDecision(dir, "D-901", { by: "architect" });
    writeDecision(dir, "D-903", { raw: "---\nid: D-903\n\tbad: [unclosed\n---\nBody.\n" });
    writeDecision(dir, "D-904", { by: false });
    writeDecision(dir, "D-905", { by: ["patron"] });
    writeFileSync(
      join(dir, "D-777.md"),
      ["---", "id: D-777", "title: Containment sentinel", "at: 2026-09-24T00:00:00Z", "provenance: stated", "by: patron", 'kill_when: "never"', "---", "Body.", ""].join("\n"),
    );

    let n = 0;
    const nextId = () => `W-93${String(++n).padStart(2, "0")}`;
    const opusPathFor = (id: string) => join(dir, "opera", `${id}.md`);
    function freshBuildingOpus(patronLine: string | undefined): string {
      const id = nextId();
      writeOpus(dir, id, opusWithProbationes(id, "building", w034Lines({ patron: patronLine })));
      return id;
    }

    async function assertRefusal(label: string, opusPath: string | undefined, args: string[], tokens: string[]): Promise<void> {
      const before = opusPath !== undefined && existsSync(opusPath) ? readFileSync(opusPath, "utf8") : undefined;
      const eventsBefore = readEventLines(dir).length;
      let r: WriteResult;
      let stderr: string;
      try {
        ({ result: r, stderr } = await withStderr(() => runWaive(args, { now: NOW })));
      } catch (e) {
        check(`waive b6: ${label} does not throw`, false, (e as Error).message);
        return;
      }
      check(`waive b6: ${label} exits 2`, r.exitCode === 2, String(r.exitCode));
      if (before !== undefined) check(`waive b6: ${label} record unchanged`, readFileSync(opusPath!, "utf8") === before);
      check(`waive b6: ${label} events unchanged`, readEventLines(dir).length === eventsBefore);
      check(`waive b6: ${label} stderr names ${JSON.stringify(tokens)}`, tokens.every((t) => stderr.includes(t)), stderr);
    }

    for (const [label, args] of [
      ["missing --gate", ["--reason", "r", "--decision", "D-900"]],
      ["missing --reason", ["--gate", "patron", "--decision", "D-900"]],
      ["missing --decision", ["--gate", "patron", "--reason", "r"]],
      ["blank --reason", ["--gate", "patron", "--reason", "   ", "--decision", "D-900"]],
    ] as [string, string[]][]) {
      const id = freshBuildingOpus("{ status: pending }");
      await assertRefusal(label, opusPathFor(id), [id, ...args, "--studio", dir], ["usage:"]);
    }

    await assertRefusal("unknown opus", undefined, ["W-9999", "--gate", "patron", "--reason", "r", "--decision", "D-900", "--studio", dir], ["unknown opus"]);

    for (const state of ["greenlit", "halted", "done"] as const) {
      const id = nextId();
      const extra = state === "halted" ? ["halted_at: 2026-01-01T00:00:00Z", "reason: r", "resume_when: rw"] : [];
      writeOpus(
        dir,
        id,
        [
          "---",
          `id: ${id}`,
          "title: state refusal",
          "kind: feature",
          "collegium: engineering",
          `state: ${state}`,
          ...extra,
          "probationes:",
          w034Lines({ patron: "{ status: pending }" }),
          "---",
          "Body.",
          "",
        ].join("\n"),
      );
      await assertRefusal(`state ${state}`, opusPathFor(id), [id, "--gate", "patron", "--reason", "r", "--decision", "D-900", "--studio", dir], ["is not building", state]);
    }

    {
      const id = freshBuildingOpus("{ status: pending }");
      await assertRefusal("--gate nope", opusPathFor(id), [id, "--gate", "nope", "--reason", "r", "--decision", "D-900", "--studio", dir], ["not declared"]);
    }
    {
      const id = freshBuildingOpus("{ status: pending }");
      await assertRefusal("--gate tests", opusPathFor(id), [id, "--gate", "tests", "--reason", "r", "--decision", "D-900", "--studio", dir], ["probatio.waived.automated"]);
    }
    for (const gate of ["qa", "review"] as const) {
      const id = freshBuildingOpus("{ status: pending }");
      await assertRefusal(`--gate ${gate}`, opusPathFor(id), [id, "--gate", gate, "--reason", "r", "--decision", "D-900", "--studio", dir], ["probatio.waived.agent"]);
    }
    for (const status of ["passed", "failed", "waived"] as const) {
      const line =
        status === "passed"
          ? "{ status: passed, evidence: acta/x.md }"
          : status === "failed"
            ? "{ status: failed, evidence: acta/x.md }"
            : "{ status: waived, reason: x, waived_by: D-900 }";
      const id = freshBuildingOpus(line);
      await assertRefusal(`patron already ${status}`, opusPathFor(id), [id, "--gate", "patron", "--reason", "r", "--decision", "D-900", "--studio", dir], [`already ${status}`]);
    }
    for (const [label, decisionId, tokens] of [
      ["decision not found", "D-404", ["D-404", "not found"]],
      ["decision containment sentinel", "../D-777", ["../D-777"]],
      ["decision wrong signer", "D-901", ["D-901", "patron"]],
      ["decision unparseable", "D-903", ["D-903"]],
      ["decision no by", "D-904", ["D-904"]],
      ["decision by not a string", "D-905", ["D-905"]],
    ] as [string, string, string[]][]) {
      const id = freshBuildingOpus("{ status: pending }");
      await assertRefusal(label, opusPathFor(id), [id, "--gate", "patron", "--reason", "r", "--decision", decisionId, "--studio", dir], tokens);
    }

    // The literal "patron" comparison bug: a manifest with a custom patron
    // id, and a decision signed by the LITERAL string "patron" (not the
    // manifest's own patron id) — must fail, naming "edene".
    const dir2 = freshStudio("waive-refuse-literal-patron");
    setManifestPatron(dir2, "edene");
    writeDecision(dir2, "D-960", { by: "patron" });
    const idLit = "W-940";
    writeOpus(dir2, idLit, opusWithProbationes(idLit, "building", w034Lines({ patron: "{ status: pending }" })));
    const litPath = join(dir2, "opera", `${idLit}.md`);
    const litBefore = readFileSync(litPath, "utf8");
    const { result: rLit, stderr: sLit } = await withStderr(() =>
      runWaive([idLit, "--gate", "patron", "--reason", "r", "--decision", "D-960", "--studio", dir2], { now: NOW }),
    );
    check("waive b6: manifest patron: edene, decision by: patron exits 2", rLit.exitCode === 2, String(rLit.exitCode));
    check("waive b6: stderr names edene, not the literal 'patron'", sLit.includes("edene"), sLit);
    check("waive b6: record unchanged", readFileSync(litPath, "utf8") === litBefore);
  }

  // ---- behaviour 7 (block 37): `waive` obeys D-021, and the guard runs
  //      straight after the record lookup ---------------------------------
  if (runs(37)) {
    const gitRepo = tmpGitStudioRepo("waive-d021");
    const studioDir = join(gitRepo, "studio");
    writeDecision(studioDir, "D-900", { by: "patron" });
    writeOpus(studioDir, "W-950", opusWithProbationes("W-950", "building", w034Lines({ patron: "{ status: pending }" })));
    writeOpus(
      studioDir,
      "W-951",
      [
        "---",
        "id: W-951",
        "title: halted target",
        "kind: feature",
        "collegium: engineering",
        "state: halted",
        "halted_at: 2026-01-01T00:00:00Z",
        "reason: r",
        "resume_when: rw",
        "probationes: {}",
        "---",
        "Body.",
        "",
      ].join("\n"),
    );
    gitCommitAll(gitRepo, "init");
    gitBranch(gitRepo, "opus/W-950");
    gitBranch(gitRepo, "opus/W-951");

    const path950 = join(studioDir, "opera", "W-950.md");
    const before950 = readFileSync(path950, "utf8");
    const { result: r1, stderr: s1 } = await withStderr(() =>
      runWaive(["W-950", "--gate", "tests", "--reason", "r", "--decision", "D-900", "--studio", studioDir], { now: NOW }),
    );
    check("waive b7: trunk refuses (automated gate, chosen on purpose) with exit 2", r1.exitCode === 2, String(r1.exitCode));
    check(
      "waive b7: refusal names opus/W-950 and D-021, and none of the deeper checks",
      s1.includes("opus/W-950") &&
        s1.includes("D-021") &&
        !s1.includes("probatio.waived.automated") &&
        !s1.includes("is not building") &&
        !s1.includes("not declared") &&
        !s1.includes("not found"),
      s1,
    );
    check("waive b7: W-950 record unchanged", readFileSync(path950, "utf8") === before950);

    const path951 = join(studioDir, "opera", "W-951.md");
    const before951 = readFileSync(path951, "utf8");
    const { result: r2, stderr: s2 } = await withStderr(() =>
      runWaive(["W-951", "--gate", "nope", "--decision", "D-404", "--reason", "r", "--studio", studioDir], { now: NOW }),
    );
    check("waive b7: trunk refuses (halted + unknown gate + bad decision, all at once) with exit 2", r2.exitCode === 2, String(r2.exitCode));
    check(
      "waive b7: second refusal also names only opus/W-951 and D-021",
      s2.includes("opus/W-951") &&
        s2.includes("D-021") &&
        !s2.includes("probatio.waived.automated") &&
        !s2.includes("is not building") &&
        !s2.includes("not declared") &&
        !s2.includes("not found"),
      s2,
    );
    check("waive b7: W-951 record unchanged", readFileSync(path951, "utf8") === before951);
    check("waive b7: git status is clean", gitStatusPorcelain(gitRepo).trim() === "", gitStatusPorcelain(gitRepo));

    const wtPath = gitWorktreeAdd(gitRepo, [], "opus/W-950");
    const wtStudioDir = join(wtPath, "studio");
    const r3 = runWaive(["W-950", "--gate", "patron", "--reason", "r", "--decision", "D-900", "--studio", wtStudioDir], { now: NOW });
    check("waive b7: worktree with opus/W-950 checked out exits 0", r3.exitCode === 0, String(r3.exitCode));
    check("waive b7: the trunk's record stays byte-identical", readFileSync(path950, "utf8") === before950);
  }

  // ---- behaviour 8 (block 38): end to end through the real CLI entry, with
  //      no front matter written by the test after setup -------------------
  if (runs(38)) {
    const dir = freshStudio("waive-e2e");
    writeDecision(dir, "D-900", { by: "patron" });
    const id = "W-960";
    writeOpus(dir, id, opusWithProbationes(id, "building", w034Lines({ patron: "{ status: pending }" })));

    const mainPath = join(repo, "packages/cli/src/main.ts");
    const runMain = (args: string[]): { status: number; stdout: string; stderr: string } => {
      try {
        const stdout = execFileSync(process.execPath, ["--import", "tsx", mainPath, ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return { status: 0, stdout, stderr: "" };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      }
    };

    const r1 = runMain(["done", id, "--studio", dir, "--now", NOW.toISOString()]);
    check("waive b8: done before waiving exits 1", r1.status === 1, String(r1.status));
    check("waive b8: done before waiving names patron", r1.stderr.includes("patron"), r1.stderr);

    const r2 = runMain(["waive", id, "--gate", "patron", "--reason", "docs-only opus", "--decision", "D-900", "--sella", "guest", "--studio", dir, "--now", NOW.toISOString()]);
    check("waive b8: waive exits 0", r2.status === 0, `${r2.status} ${r2.stderr}`);

    const r3 = runMain(["done", id, "--studio", dir, "--now", NOW.toISOString()]);
    check("waive b8: done after waiving exits 0", r3.status === 0, String(r3.status));
    check("waive b8: done after waiving stdout names the waiver", r3.stdout.includes("waived: patron"), r3.stdout);
    const after = readFront<{ state: string }>(join(dir, "opera", `${id}.md`)).data;
    check("waive b8: record reads state: done", after.state === "done", after.state);

    const r4 = runMain([]);
    check("waive b8: main.ts with no arguments exits 2", r4.status === 2, String(r4.status));
    const bannerLine = r4.stderr
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("bisellium waive <opus> --gate <id> --reason <text> --decision <id>"));
    check("waive b8: the usage banner lists bisellium waive with its exact flags", bannerLine !== undefined, r4.stderr);
  }

  // ---- behaviour 9 (block 39): `close` inherits both halves --------------
  if (runs(39)) {
    const dir = freshStudio("close-inherits-waiver");
    writeDecision(dir, "D-900", { by: "patron" });

    const idAgent = "W-810";
    writeOpus(
      dir,
      idAgent,
      opusWithProbationes(idAgent, "building", w034Lines({ qa: "{ status: waived, reason: x, waived_by: D-900, sella: guest, at: 2026-09-24T00:00:00Z }" })),
    );
    const opusPathAgent = join(dir, "opera", `${idAgent}.md`);
    const beforeAgent = readFileSync(opusPathAgent, "utf8");
    const closeAgent = executeClose(dir, idAgent);
    check("close b9: an honourable-shaped agent-gate waiver still refuses", closeAgent.ok === false, JSON.stringify(closeAgent));
    check("close b9: the record is unchanged", readFileSync(opusPathAgent, "utf8") === beforeAgent);

    const idHuman = "W-811";
    writeOpus(
      dir,
      idHuman,
      opusWithProbationes(idHuman, "building", w034Lines({ patron: "{ status: waived, reason: x, waived_by: D-900, sella: guest, at: 2026-09-24T00:00:00Z }" })),
    );
    const opusPathHuman = join(dir, "opera", `${idHuman}.md`);
    const closeHuman = executeClose(dir, idHuman);
    check("close b9: a Patron-waived human gate reaches done", closeHuman.ok === true, JSON.stringify(closeHuman));
    const afterHuman = readFront<{ state: string }>(opusPathHuman).data;
    check("close b9: state -> done", afterHuman.state === "done", afterHuman.state);
  }

  // ---- behaviour 11 (block 41): every waived gate is reported, not just
  //      the first -----------------------------------------------------
  if (runs(41)) {
    const dir = freshStudio("done-multi-gate-report");
    addProbatio(dir, { id: "legal", name: "Legal sign-off", kind: "human" });
    writeDecision(dir, "D-900", { by: "patron" });
    writeDecision(dir, "D-902", { by: "patron" });

    const idRefuse = "W-820";
    writeOpus(
      dir,
      idRefuse,
      opusWithProbationes(
        idRefuse,
        "building",
        w034Lines({
          tests: "{ status: waived, reason: x, waived_by: D-900 }",
          qa: "{ status: waived, reason: x, waived_by: D-900, sella: guest, at: 2026-09-24T00:00:00Z }",
          patron: "{ status: waived, reason: x, waived_by: D-404 }",
        }),
      ),
    );
    const opusPathRefuse = join(dir, "opera", `${idRefuse}.md`);
    const beforeRefuse = readFileSync(opusPathRefuse, "utf8");
    const { result: rRefuse, stderr: sRefuse } = await withStderr(() => runDone([idRefuse, "--studio", dir], { now: NOW }));
    check("done b11: refuses when multiple gates are wrongly waived", rRefuse.exitCode === 1, String(rRefuse.exitCode));
    check("done b11: record unchanged", readFileSync(opusPathRefuse, "utf8") === beforeRefuse);
    check(
      "done b11: stderr names every offender, not just the first",
      sRefuse.includes("tests") &&
        sRefuse.includes("probatio.waived.automated") &&
        sRefuse.includes("qa") &&
        sRefuse.includes("probatio.waived.agent") &&
        sRefuse.includes("patron") &&
        sRefuse.includes("D-404"),
      sRefuse,
    );

    const idSuccess = "W-821";
    writeOpus(
      dir,
      idSuccess,
      opusWithProbationes(
        idSuccess,
        "building",
        w034Lines({
          patron: "{ status: waived, reason: x, waived_by: D-900, sella: guest, at: 2026-09-24T00:00:00Z }",
          legal: "{ status: waived, reason: y, waived_by: D-902, sella: guest, at: 2026-09-24T00:00:00Z }",
        }),
      ),
    );
    const { result: rSuccess, stdout: outSuccess } = await withStdout(() => runDone([idSuccess, "--studio", dir], { now: NOW }));
    check("done b11: exits 0 when every waived gate is honourable", rSuccess.exitCode === 0, String(rSuccess.exitCode));
    check(
      "done b11: stdout names every honoured waiver",
      outSuccess.includes("waived:") &&
        outSuccess.includes("patron") &&
        outSuccess.includes("D-900") &&
        outSuccess.includes("legal") &&
        outSuccess.includes("D-902"),
      outSuccess,
    );
  }

  // =========================================================================
  // W-039 behaviour 1 (block 42): the fallback-resolution refusal, then the
  // explicit --sella guest recording (matrix rows 1 and 9)
  // =========================================================================
  if (runs(42)) {
    const dir = freshStudio("red-sella-fallback");
    const id = "W-970";
    const redsDir = preseedReds(dir, id);
    const before = snapshotDir(redsDir);

    delete process.env["BISELLIUM_SELLA"];
    const { result: refused, stderr } = await withStderr(() =>
      runRed([id, "--behaviour", "1", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(1)"], {}),
    );
    check("red-sella b1: no --sella, no env -> exits 2", refused.exitCode === 2, String(refused.exitCode));
    check(
      "red-sella b1: refusal names the fix",
      stderr.includes("red: no sella — pass --sella <id> or set $BISELLIUM_SELLA (use --sella guest to record as guest deliberately)"),
      stderr,
    );
    check("red-sella b1: the preseeded directory is byte-identical, nothing written", sameSnapshot(redsDir, before));

    const recorded = await runRed(
      [id, "--behaviour", "1", "--sella", "guest", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(1)"],
      {},
    );
    check("red-sella b1: an explicit --sella guest records", recorded.exitCode === 0, String(recorded.exitCode));
    const header = readFileSync(join(redsDir, "01.log"), "utf8").split("\n");
    check("red-sella b1: header reads # sella: guest", header[4] === "# sella: guest", header[4]);
  }

  // =========================================================================
  // W-039 behaviour 2 (block 43): every other refusal row of the matrix
  // writes nothing
  // =========================================================================
  if (runs(43)) {
    const rows: { tag: string; env: string | undefined; args: string[] }[] = [
      { tag: "env-empty", env: "", args: [] },
      { tag: "env-whitespace", env: "  ", args: [] },
      { tag: "flag-empty-no-env", env: undefined, args: ["--sella", ""] },
      { tag: "flag-whitespace-no-env", env: undefined, args: ["--sella", "  "] },
      { tag: "flag-repeated-last-empty", env: undefined, args: ["--sella", "builder-a", "--sella", ""] },
    ];
    for (const row of rows) {
      const dir = freshStudio(`red-sella-refuse-${row.tag}`);
      const id = "W-971";
      const redsDir = preseedReds(dir, id);
      const before = snapshotDir(redsDir);

      if (row.env === undefined) delete process.env["BISELLIUM_SELLA"];
      else process.env["BISELLIUM_SELLA"] = row.env;
      const r = await runRed(
        [id, "--behaviour", "1", ...row.args, "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(1)"],
        {},
      );
      delete process.env["BISELLIUM_SELLA"];
      check(`red-sella b2 (${row.tag}): exits 2`, r.exitCode === 2, String(r.exitCode));
      check(`red-sella b2 (${row.tag}): the preseeded directory is byte-identical, nothing written`, sameSnapshot(redsDir, before));
    }
  }

  // =========================================================================
  // W-039 behaviour 3 (block 44): every other recording row writes the
  // named sella into the header
  // =========================================================================
  if (runs(44)) {
    const rows: { tag: string; env: string | undefined; args: string[]; want: string }[] = [
      { tag: "env-alone", env: "builder-b", args: [], want: "builder-b" },
      { tag: "flag-empty-env-set", env: "builder-b", args: ["--sella", ""], want: "builder-b" },
      { tag: "flag-repeated-last-wins", env: undefined, args: ["--sella", "", "--sella", "builder-a"], want: "builder-a" },
      { tag: "flag-over-env", env: "builder-b", args: ["--sella", "builder-a"], want: "builder-a" },
    ];
    for (const row of rows) {
      const dir = freshStudio(`red-sella-record-${row.tag}`);
      const id = "W-972";
      const redsDir = join(dir, "ci", "reds", id);

      if (row.env === undefined) delete process.env["BISELLIUM_SELLA"];
      else process.env["BISELLIUM_SELLA"] = row.env;
      const r = await runRed(
        [id, "--behaviour", "1", ...row.args, "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(1)"],
        {},
      );
      delete process.env["BISELLIUM_SELLA"];
      check(`red-sella b3 (${row.tag}): records`, r.exitCode === 0, String(r.exitCode));
      const header = readFileSync(join(redsDir, "01.log"), "utf8").split("\n");
      check(`red-sella b3 (${row.tag}): header names ${row.want}`, header[4] === `# sella: ${row.want}`, header[4]);
    }
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
