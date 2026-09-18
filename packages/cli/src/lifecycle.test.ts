/**
 * packages/cli/src/lifecycle.test.ts — W-020 (ready, done, review, red),
 * against temp copies of examples/sample-studio. `now` is pinned to
 * 2026-09-19T13:00:00Z. House pattern: writes.test.ts is the model.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL } from "@bisellium/core";
import { WF } from "@bisellium/schema";
import { splitFront } from "./frontmatter.js";
import { runReady, runDone, runReview, runRed } from "./lifecycle.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-19T13:00:00Z");

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
  {
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
  {
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
  {
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

  {
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

  {
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
  {
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

  {
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

  {
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
  {
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

  {
    const dir = freshStudio("red-exit0");
    const redsDir = join(dir, "ci", "reds", "W-901");
    const r = await runRed(["W-901", "--behaviour", "5", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(0)"], {});
    check("red: a passing command refuses with exit 1", r.exitCode === 1, String(r.exitCode));
    check("red: no directory created for a passing command", !existsSync(redsDir));
  }

  {
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
  {
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
  {
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
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
