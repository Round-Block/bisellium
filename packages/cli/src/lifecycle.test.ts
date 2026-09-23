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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL } from "@bisellium/core";
import { WF } from "@bisellium/schema";
import { sourceTreeHash } from "@bisellium/shim";
import { checkStudio } from "./check.js";
import { splitFront } from "./frontmatter.js";
import { runReady, runDone, runReview, runRed, runHalt } from "./lifecycle.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-19T13:00:00Z");

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
    "  qa: { status: waived, reason: not needed, evidence: n/a }",
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
    const r = await runRed(["W-901", "--behaviour", "5", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(0)"], {});
    check("red: a passing command refuses with exit 1", r.exitCode === 1, String(r.exitCode));
    check("red: no directory created for a passing command", !existsSync(redsDir));
  }

  if (runs(10)) {
    const dir = freshStudio("red-overwrite");
    const redsDir = join(dir, "ci", "reds", "W-902");
    await runRed(["W-902", "--behaviour", "1", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('first'); process.exit(1)"], {});
    await runRed(["W-902", "--behaviour", "2", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('second'); process.exit(1)"], {});
    await runRed(["W-902", "--behaviour", "1", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('first-rerun'); process.exit(1)"], {});

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
        ["W-961", "--behaviour", "1", "--studio", studioDir, "--now", NOW.toISOString(), "--cwd", inner, "--", "node", "-e", "require('node:fs').writeFileSync('ran-here.txt', 'x'); process.exit(1)"],
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
        const r = await runRed(["W-962", "--behaviour", "1", "--studio", studioDir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(1)"], {});
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
      const r = await runRed(["W-963", "--behaviour", "1", "--studio", studioDir, "--now", NOW.toISOString(), "--cwd", plain, "--", "node", "-e", "process.exit(1)"], {});
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
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
