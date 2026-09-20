/**
 * packages/cli/src/rules.test.ts — W-021: `opus.untracked`,
 * `opus.red_evidence` (rules/evidence.ts) and D-008's `path.id.unvalidated` /
 * `path.escapes.officina` (rules/paths.ts), against temp officinae built
 * from scratch (house pattern, nearest model packages/cli/src/docs.test.ts).
 * No framework, exit code off `failed`.
 *
 * Behaviours 1-4 need a real git repo (the fixture trap: a copied fixture
 * is neither tracked nor untracked, it's not in a repo at all) — a fresh
 * `$TMPDIR` directory, `git init`, and a throwaway user.name/user.email so
 * the commit can't fail on a machine with no global git identity.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { checkStudio } from "./check.js";
import { checkEvidence, countBehaviours } from "./rules/evidence.js";
import { checkPaths } from "./rules/paths.js";
import { checkProcess } from "./rules/process.js";

const repo = resolve(process.argv[2] ?? ".");
const NOW = new Date("2026-09-19T13:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
};

// W-035 behaviours 8-15 (lesson.addressed_by / three-way lesson.recurrent)
// are numbered so `bisellium red` can isolate one behaviour's output —
// `--only` off process.argv[3], same shape as rules/process.test.ts. When
// unset (the plain `npm test` invocation), every check below still runs.
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
const checkNumbered = (behaviour: number, name: string, ok: boolean, detail = "") => {
  if (only !== undefined && only !== behaviour) return;
  check(name, ok, detail);
};

const dirs: string[] = [];
function freshDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-rules-${tag}-`));
  dirs.push(dir);
  return dir;
}

function writeManifest(dir: string): void {
  writeFileSync(join(dir, "bisellium.yml"), "bisellium: 1\nstudio: fixture\ncollegia: []\nsellae: []\nprobationes: []\n");
}

function writeOpus(dir: string, id: string, front: Record<string, unknown>): string {
  mkdirSync(join(dir, "opera"), { recursive: true });
  const p = join(dir, "opera", `${id.replace(/[/\\]/g, "_")}.md`);
  writeFileSync(p, `---\n${stringify(front)}---\n\nbody\n`);
  return p;
}

function writeLesson(dir: string, id: string, front: Record<string, unknown>): string {
  mkdirSync(join(dir, "lessons"), { recursive: true });
  const p = join(dir, "lessons", `${id}.md`);
  writeFileSync(p, `---\n${stringify(front)}---\n\nbody\n`);
  return p;
}

function writeDecision(dir: string, id: string, front: Record<string, unknown>): string {
  mkdirSync(join(dir, "decisions"), { recursive: true });
  const p = join(dir, "decisions", `${id}.md`);
  writeFileSync(p, `---\n${stringify(front)}---\n\nbody\n`);
  return p;
}

function writeBrief(dir: string, relPath: string, text: string): string {
  const p = join(dir, relPath);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  return p;
}

/** A brief body with `n` top-level numbered behaviours under the exact
 *  heading `## Behaviours to test`, plus deliberate distractors: a
 *  continuation line, a 4-space-indented nested item, a bullet item, a
 *  numbered line inside a fenced code block, and a numbered item in the
 *  next `##` section — none of which should count. */
function briefWithBehaviours(n: number): string {
  const items = Array.from(
    { length: n },
    (_, i) => `${i + 1}. Behaviour ${i + 1} does a thing.\n   Continuation line for behaviour ${i + 1}, not a new item.`,
  ).join("\n");
  return [
    "# Fixture brief",
    "",
    "## Files owned",
    "",
    "- some/file.ts",
    "",
    "## Behaviours to test",
    "",
    items,
    "",
    "- a bullet item, not counted",
    "    1. a nested numbered item (4-space indent), not counted",
    "",
    "```",
    "99. inside a fenced code block, not counted",
    "```",
    "",
    "## Out of scope",
    "",
    "1. a numbered item in a later section, not counted",
    "",
  ].join("\n");
}

function writeRedLog(officina: string, id: string, nn: number, fields: Partial<Record<"behaviour" | "command" | "exit" | "at" | "sella" | "tree", string>>): void {
  const dir = join(officina, "ci", "reds", id);
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (const key of ["behaviour", "command", "exit", "at", "sella", "tree"] as const) {
    if (fields[key] !== undefined) lines.push(`# ${key}: ${fields[key]}`);
  }
  lines.push("", "command output here");
  writeFileSync(join(dir, `${String(nn).padStart(2, "0")}.log`), lines.join("\n"));
}

function gitFixture(tag: string): { repoDir: string; studioDir: string; commitAll: () => void } {
  const repoDir = freshDir(`git-${tag}`);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repoDir });
  const studioDir = join(repoDir, "studio");
  mkdirSync(studioDir, { recursive: true });
  writeManifest(studioDir);
  return {
    repoDir,
    studioDir,
    commitAll: () => {
      execFileSync("git", ["add", "-A"], { cwd: repoDir });
      execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: repoDir });
    },
  };
}

const untrackedFindings = (root: string, opts: { now: Date; repo?: string }) => checkEvidence(root, opts).filter((f) => f.rule === "opus.untracked");
const redFindings = (root: string, opts: { now: Date; repo?: string }) => checkEvidence(root, opts).filter((f) => f.rule === "opus.red_evidence");

try {
  // W-035 isolation: a labeled block, not an `if`, so the pre-existing
  // (W-021/P-004) checks below keep their original indentation untouched.
  legacyChecks: {
    if (only !== undefined) break legacyChecks;
  // ==== opus.untracked (behaviours 1-4) ====================================
  {
    // behaviour 1: opera/<id>.md itself untracked, blocks, clears once tracked
    const g = gitFixture("untracked-opus");
    g.commitAll(); // bisellium.yml tracked
    writeOpus(g.studioDir, "W-100", { id: "W-100", state: "building" });
    const before = untrackedFindings(g.studioDir, { now: NOW, repo: g.repoDir });
    check("opus.untracked: blocks for an untracked opera file", before.length === 1, JSON.stringify(before));

    g.commitAll();
    const after = untrackedFindings(g.studioDir, { now: NOW, repo: g.repoDir });
    check("opus.untracked: clears once the opera file is tracked", after.length === 0, JSON.stringify(after));
  }
  {
    // behaviour 2: brief at spec: untracked, named in the message
    const g = gitFixture("untracked-brief");
    writeOpus(g.studioDir, "W-101", { id: "W-101", state: "building", spec: "briefs/W-101.md" });
    g.commitAll(); // opus tracked, brief does not exist yet / is untracked
    writeBrief(g.studioDir, "briefs/W-101.md", briefWithBehaviours(1));
    const before = untrackedFindings(g.studioDir, { now: NOW, repo: g.repoDir });
    check("opus.untracked: blocks for an untracked brief", before.length === 1, JSON.stringify(before));
    check("opus.untracked: names the brief in the message", before.some((f) => f.message.includes("W-101.md")), JSON.stringify(before));

    g.commitAll();
    const after = untrackedFindings(g.studioDir, { now: NOW, repo: g.repoDir });
    check("opus.untracked: clears once the brief is tracked", after.length === 0, JSON.stringify(after));
  }
  {
    // behaviour 3: silent for backlog/greenlit/done/halted; [] with no opts.repo
    const g = gitFixture("untracked-inactive");
    for (const state of ["backlog", "greenlit", "done", "halted"]) writeOpus(g.studioDir, `W-${state}`, { id: `W-${state}`, state });
    const findings = untrackedFindings(g.studioDir, { now: NOW, repo: g.repoDir });
    check("opus.untracked: silent for backlog/greenlit/done/halted", findings.length === 0, JSON.stringify(findings));

    const noRepo = checkEvidence(g.studioDir, { now: NOW });
    check("opus.untracked: [] when opts.repo is absent", noRepo.filter((f) => f.rule === "opus.untracked").length === 0, JSON.stringify(noRepo));
  }
  {
    // behaviour 4: [] and never throws when opts.repo isn't a repo, or git fails
    const notRepo = freshDir("not-a-repo");
    const studioDir = join(notRepo, "studio");
    mkdirSync(studioDir, { recursive: true });
    writeManifest(studioDir);
    writeOpus(studioDir, "W-102", { id: "W-102", state: "building" });

    let threw = false;
    let findings: unknown[] = [];
    try {
      findings = untrackedFindings(studioDir, { now: NOW, repo: notRepo });
    } catch {
      threw = true;
    }
    check("opus.untracked: never throws when opts.repo is not a git repository", !threw);
    check("opus.untracked: [] when opts.repo is not a git repository", findings.length === 0, JSON.stringify(findings));

    let threw2 = false;
    let findings2: unknown[] = [];
    try {
      findings2 = untrackedFindings(studioDir, { now: NOW, repo: join(notRepo, "does-not-exist") });
    } catch {
      threw2 = true;
    }
    check("opus.untracked: never throws when git fails outright", !threw2);
    check("opus.untracked: [] when git fails outright", findings2.length === 0, JSON.stringify(findings2));
  }

  // ==== opus.red_evidence (behaviours 5-9) ==================================
  {
    // behaviour 5: silent (both levels) while ci/reds doesn't exist
    const dir = freshDir("red-store-absent");
    writeManifest(dir);
    writeOpus(dir, "W-200", { id: "W-200", state: "building", spec: "briefs/W-200.md" });
    writeBrief(dir, "briefs/W-200.md", briefWithBehaviours(3));
    const findings = redFindings(dir, { now: NOW });
    check("opus.red_evidence: silent while ci/reds does not exist", findings.length === 0, JSON.stringify(findings));
  }
  {
    // behaviour 6: blocks naming missing NN, clears once all N are present
    const dir = freshDir("red-missing");
    writeManifest(dir);
    writeOpus(dir, "W-201", { id: "W-201", state: "building", spec: "briefs/W-201.md" });
    writeBrief(dir, "briefs/W-201.md", briefWithBehaviours(3));
    mkdirSync(join(dir, "ci", "reds"), { recursive: true });

    const allMissing = redFindings(dir, { now: NOW });
    check(
      "opus.red_evidence: blocks naming all missing behaviours",
      allMissing.some((f) => f.level === "block" && f.message.includes("1") && f.message.includes("2") && f.message.includes("3")),
      JSON.stringify(allMissing),
    );

    writeRedLog(dir, "W-201", 1, { behaviour: "1", command: "npm test", exit: "1", at: "2026-09-19T13:00:00Z", sella: "builder-b", tree: "dirty:abc" });
    writeRedLog(dir, "W-201", 3, { behaviour: "3", command: "npm test", exit: "1", at: "2026-09-19T13:00:00Z", sella: "builder-b", tree: "dirty:abc" });
    const oneMissing = redFindings(dir, { now: NOW });
    check(
      "opus.red_evidence: names only the still-missing behaviour",
      oneMissing.some((f) => f.level === "block" && f.message.includes("2")) && !oneMissing.some((f) => f.level === "block" && f.message.includes("1 ")),
      JSON.stringify(oneMissing),
    );

    writeRedLog(dir, "W-201", 2, { behaviour: "2", command: "npm test", exit: "1", at: "2026-09-19T13:00:00Z", sella: "builder-b", tree: "dirty:abc" });
    const none = redFindings(dir, { now: NOW });
    check("opus.red_evidence: clears once all N logs are present", !none.some((f) => f.level === "block"), JSON.stringify(none));
  }
  {
    // behaviour 7: a present log with exit 0 / absent / non-integer blocks
    const dir = freshDir("red-bad-exit");
    writeManifest(dir);
    writeOpus(dir, "W-202", { id: "W-202", state: "building", spec: "briefs/W-202.md" });
    writeBrief(dir, "briefs/W-202.md", briefWithBehaviours(3));
    writeRedLog(dir, "W-202", 1, { behaviour: "1", exit: "0" }); // passed, not a red
    writeRedLog(dir, "W-202", 2, { behaviour: "2" }); // exit absent
    writeRedLog(dir, "W-202", 3, { behaviour: "3", exit: "not-a-number" });

    const bad = redFindings(dir, { now: NOW });
    check("opus.red_evidence: blocks on exit 0", bad.some((f) => f.level === "block" && f.message.includes("1")), JSON.stringify(bad));
    check("opus.red_evidence: blocks on absent exit", bad.some((f) => f.level === "block" && f.message.includes("2")), JSON.stringify(bad));
    check("opus.red_evidence: blocks on non-integer exit", bad.some((f) => f.level === "block" && f.message.includes("3")), JSON.stringify(bad));

    writeRedLog(dir, "W-202", 1, { behaviour: "1", exit: "2" });
    writeRedLog(dir, "W-202", 2, { behaviour: "2", exit: "1" });
    writeRedLog(dir, "W-202", 3, { behaviour: "3", exit: "137" });
    const fixed = redFindings(dir, { now: NOW });
    check("opus.red_evidence: clears once every log records a real non-zero exit", fixed.length === 0, JSON.stringify(fixed));
  }
  {
    // behaviour 8: advises when the brief parses to zero numbered behaviours
    const dir = freshDir("red-zero-behaviours");
    writeManifest(dir);
    writeOpus(dir, "W-203", { id: "W-203", state: "building", spec: "briefs/W-203.md" });
    writeBrief(dir, "briefs/W-203.md", "# Fixture brief\n\n## Behaviours to test\n\nNo numbered items here.\n");
    mkdirSync(join(dir, "ci", "reds"), { recursive: true }); // activate the rule
    const findings = redFindings(dir, { now: NOW });
    check("opus.red_evidence: advises for zero numbered behaviours", findings.some((f) => f.level === "advise"), JSON.stringify(findings));
    check("opus.red_evidence: does not block for zero numbered behaviours", !findings.some((f) => f.level === "block"), JSON.stringify(findings));
  }
  {
    // behaviour 9: countBehaviours parses only the top-level ordered list
    check("countBehaviours: counts the top-level list, ignoring every distractor", countBehaviours(briefWithBehaviours(4)) === 4, String(countBehaviours(briefWithBehaviours(4))));
    check("countBehaviours: 0 when the heading is missing", countBehaviours("# no such heading\n\n1. nope\n") === 0);
    check(
      "countBehaviours: 0 when the section has no numbered items",
      countBehaviours("## Behaviours to test\n\nnothing numbered\n") === 0,
    );
  }

  // ==== D-008: path.id.unvalidated (behaviour 10) ===========================
  {
    const bad = ["a/b", "a\\b", "a..b", "-bad", "bad id"];
    for (const badId of bad) {
      const dir = freshDir(`id-opus-${badId.replace(/[^a-z0-9]/gi, "_")}`);
      writeManifest(dir);
      writeOpus(dir, "SAFE", { id: badId, state: "building" });
      const findings = checkPaths(dir, { now: NOW });
      check(`path.id.unvalidated: blocks opus id "${badId}"`, findings.some((f) => f.rule === "path.id.unvalidated" && f.level === "block"), JSON.stringify(findings));
    }
  }
  {
    const dir = freshDir("id-sella");
    writeManifest(dir);
    writeOpus(dir, "W-300", { id: "W-300", state: "building", traditio: { sella: "a/b", stage: "building", next: "x", blocked_on: "none", at: "2026-09-19T13:00:00Z" } });
    const findings = checkPaths(dir, { now: NOW });
    check("path.id.unvalidated: blocks a bad front-matter sella reference", findings.some((f) => f.rule === "path.id.unvalidated" && f.level === "block" && f.message.includes("a/b")), JSON.stringify(findings));

    writeOpus(dir, "W-300", { id: "W-300", state: "building", traditio: { sella: "builder-a", stage: "building", next: "x", blocked_on: "none", at: "2026-09-19T13:00:00Z" } });
    const fixed = checkPaths(dir, { now: NOW });
    check("path.id.unvalidated: clears once the sella reference is valid", fixed.length === 0, JSON.stringify(fixed));
  }
  {
    const dir = freshDir("id-probatio-key");
    writeManifest(dir);
    writeOpus(dir, "W-301", { id: "W-301", state: "building", probationes: { "bad/key": { status: "pending" } } });
    const findings = checkPaths(dir, { now: NOW });
    check("path.id.unvalidated: blocks a bad probationes: key", findings.some((f) => f.rule === "path.id.unvalidated" && f.level === "block" && f.message.includes("bad/key")), JSON.stringify(findings));

    writeOpus(dir, "W-301", { id: "W-301", state: "building", probationes: { spec: { status: "pending" } } });
    const fixed = checkPaths(dir, { now: NOW });
    check("path.id.unvalidated: clears once the probatio key is valid", fixed.length === 0, JSON.stringify(fixed));
  }
  {
    const dir = freshDir("id-receipts-dir");
    writeManifest(dir);
    mkdirSync(join(dir, "receipts", "a..b"), { recursive: true });
    const findings = checkPaths(dir, { now: NOW });
    check("path.id.unvalidated: blocks a bad receipts/ directory name", findings.some((f) => f.rule === "path.id.unvalidated" && f.level === "block" && f.where === "receipts/"), JSON.stringify(findings));

    rmSync(join(dir, "receipts", "a..b"), { recursive: true, force: true });
    mkdirSync(join(dir, "receipts", "builder-a"), { recursive: true });
    const fixed = checkPaths(dir, { now: NOW });
    check("path.id.unvalidated: clears once the receipts/ directory name is valid", fixed.length === 0, JSON.stringify(fixed));
  }

  // ==== D-008: path.escapes.officina (behaviour 11) =========================
  {
    const dir = freshDir("escapes-spec");
    writeManifest(dir);
    writeOpus(dir, "W-400", { id: "W-400", state: "building", spec: "../../etc/passwd" });
    const r1 = checkPaths(dir, { now: NOW });
    check("path.escapes.officina: blocks a relative a/../../b escape in spec:", r1.some((f) => f.rule === "path.escapes.officina" && f.level === "block"), JSON.stringify(r1));

    writeOpus(dir, "W-401", { id: "W-401", state: "building", spec: "/etc/passwd" });
    const r2 = checkPaths(dir, { now: NOW });
    check("path.escapes.officina: blocks an absolute-path spec:", r2.some((f) => f.rule === "path.escapes.officina" && f.level === "block" && f.where.includes("W-401")), JSON.stringify(r2));

    writeOpus(dir, "W-402", { id: "W-402", state: "building", spec: "briefs/../briefs/W-402.md" });
    const r3 = checkPaths(dir, { now: NOW });
    check(
      "path.escapes.officina: a path that merely looks like an escape but resolves inside passes",
      !r3.some((f) => f.rule === "path.escapes.officina" && f.where.includes("W-402")),
      JSON.stringify(r3),
    );
  }
  {
    const dir = freshDir("escapes-gate-evidence");
    writeManifest(dir);
    writeOpus(dir, "W-403", { id: "W-403", state: "building", probationes: { spec: { status: "passed", evidence: "../outside.md" } } });
    const findings = checkPaths(dir, { now: NOW });
    check("path.escapes.officina: blocks a gate evidence: that escapes", findings.some((f) => f.rule === "path.escapes.officina" && f.level === "block"), JSON.stringify(findings));

    writeOpus(dir, "W-403", { id: "W-403", state: "building", probationes: { spec: { status: "passed", evidence: "briefs/W-403.md" } } });
    const fixed = checkPaths(dir, { now: NOW });
    check("path.escapes.officina: clears once gate evidence: resolves inside", fixed.length === 0, JSON.stringify(fixed));
  }
  {
    // P-004: acta evidence escaping does NOT fire — scoped out of
    // path.escapes.officina (acta evidence hrefs stay with checkLink). Own
    // fixture, not dependent on studio/acta/'s shape.
    const dir = freshDir("escapes-acta-scoped-out");
    writeManifest(dir);
    mkdirSync(join(dir, "acta"), { recursive: true });
    writeFileSync(
      join(dir, "acta", "2026-09-19-fixture-daily.md"),
      `---\n${stringify({
        author: "fixture",
        kind: "daily",
        title: "fixture",
        at: "2026-09-19T13:00:00Z",
        evidence: [{ href: "../outside.md" }],
      })}---\n\nbody\n`,
    );
    const findings = checkPaths(dir, { now: NOW });
    check(
      "path.escapes.officina: does not fire on an escaping acta evidence: href (scoped out)",
      !findings.some((f) => f.rule === "path.escapes.officina"),
      JSON.stringify(findings),
    );
  }
  {
    // no startsWith dogfooding, source-level check
    const src = readFileSync(fileURLToPath(new URL("./rules/paths.ts", import.meta.url)), "utf8");
    check("path rule module calls .startsWith() nowhere (dogfoods its own rule)", !src.includes(".startsWith("), "rules/paths.ts calls .startsWith()");
  }

  // ==== behaviour 12: real trees, both officinae =============================
  {
    // wiring proof: checkStudio (not checkPaths/checkEvidence directly) must
    // surface a D-008 finding — genuinely red before check.ts calls the rule
    // modules, genuinely green after.
    const dir = freshDir("wiring-proof");
    writeManifest(dir);
    writeOpus(dir, "W-500", { id: "bad/id", state: "building" });
    const r = checkStudio(dir, NOW);
    check("checkStudio is wired to path.id.unvalidated", r.findings.some((f) => f.rule === "path.id.unvalidated"), JSON.stringify(r.findings));
  }
  {
    const sampleStudio = join(repo, "examples", "sample-studio");
    const r = checkStudio(sampleStudio, NOW, { repo });
    const ours = r.findings.filter((f) => ["opus.untracked", "opus.red_evidence", "path.id.unvalidated", "path.escapes.officina"].includes(f.rule));
    check("examples/sample-studio: zero findings from all four W-021 rule ids", ours.length === 0, JSON.stringify(ours));
  }
  {
    // P-004 resolved: path.escapes.officina scoped to spec: and gate
    // evidence: only (acta evidence stays with checkLink). Both rules
    // promoted to blocking — zero blocking path.* findings expected.
    const studio = join(repo, "studio");
    const r = checkStudio(studio, NOW, { repo });
    const blockingPathFindings = r.findings.filter((f) => f.rule.startsWith("path.") && f.level === "block");
    check("studio: no BLOCKING path.* finding (the insurance clause)", blockingPathFindings.length === 0, JSON.stringify(blockingPathFindings));
  }
  } // legacyChecks

  // ==== W-035: lesson.addressed_by / three-way lesson.recurrent (behaviours 8-15) ====
  {
    // behaviour 8: silent when the key is absent (the 29-lesson landing)
    const dir = freshDir("addressed-absent");
    writeManifest(dir);
    writeLesson(dir, "L-800", { id: "L-800", at: "2026-09-19T00:00:00Z", class: "cls-800", evidence: ["studio/x"] });
    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.addressed_by");
    checkNumbered(8, "lesson.addressed_by: silent when the key is absent", findings.length === 0, JSON.stringify(findings));
  }
  {
    // behaviour 9: accepts an existing opus id
    const dir = freshDir("addressed-opus");
    writeManifest(dir);
    writeOpus(dir, "W-900", { id: "W-900", state: "building" });
    writeLesson(dir, "L-900", { id: "L-900", at: "2026-09-19T00:00:00Z", class: "cls-900", evidence: ["studio/x"], addressed_by: "W-900" });
    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.addressed_by");
    checkNumbered(9, "lesson.addressed_by: accepts an existing opus id", findings.length === 0, JSON.stringify(findings));
  }
  {
    // behaviour 10: accepts an id in RULE_IDS
    const dir = freshDir("addressed-rule");
    writeManifest(dir);
    writeLesson(dir, "L-1000", { id: "L-1000", at: "2026-09-19T00:00:00Z", class: "cls-1000", evidence: ["studio/x"], addressed_by: "decision.kill" });
    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.addressed_by");
    checkNumbered(10, "lesson.addressed_by: accepts an id in RULE_IDS", findings.length === 0, JSON.stringify(findings));
  }
  {
    // behaviour 11: accepts an existing decision id
    const dir = freshDir("addressed-decision");
    writeManifest(dir);
    writeDecision(dir, "D-1100", { id: "D-1100", title: "fixture decision", at: "2026-09-19T00:00:00Z", provenance: "stated", by: "patron", kill_when: "never" });
    writeLesson(dir, "L-1100", { id: "L-1100", at: "2026-09-19T00:00:00Z", class: "cls-1100", evidence: ["studio/x"], addressed_by: "D-1100" });
    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.addressed_by");
    checkNumbered(11, "lesson.addressed_by: accepts an existing decision id", findings.length === 0, JSON.stringify(findings));
  }
  {
    // behaviour 12: blocks on an unresolvable id, and on a non-string or empty value
    const dir = freshDir("addressed-bad");
    writeManifest(dir);
    writeLesson(dir, "L-1200", { id: "L-1200", at: "2026-09-19T00:00:00Z", class: "cls-1200a", evidence: ["studio/x"], addressed_by: "W-999" });
    writeLesson(dir, "L-1201", { id: "L-1201", at: "2026-09-19T00:00:00Z", class: "cls-1200b", evidence: ["studio/x"], addressed_by: "" });
    writeLesson(dir, "L-1202", { id: "L-1202", at: "2026-09-19T00:00:00Z", class: "cls-1200c", evidence: ["studio/x"], addressed_by: 123 });
    writeLesson(dir, "L-1203", { id: "L-1203", at: "2026-09-19T00:00:00Z", class: "cls-1200d", evidence: ["studio/x"], addressed_by: [] });
    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.addressed_by");
    checkNumbered(
      12,
      "lesson.addressed_by: blocks an unresolvable id",
      findings.some((f) => f.where.includes("L-1200") && f.level === "block" && f.message.includes("names no opus, rule id, or decision")),
      JSON.stringify(findings),
    );
    checkNumbered(
      12,
      "lesson.addressed_by: blocks an empty string",
      findings.some((f) => f.where.includes("L-1201") && f.level === "block" && f.message === `"addressed_by" must be a non-empty string`),
      JSON.stringify(findings),
    );
    checkNumbered(
      12,
      "lesson.addressed_by: blocks a non-string value (number)",
      findings.some((f) => f.where.includes("L-1202") && f.level === "block" && f.message === `"addressed_by" must be a non-empty string`),
      JSON.stringify(findings),
    );
    checkNumbered(
      12,
      "lesson.addressed_by: blocks a non-string value (list)",
      findings.some((f) => f.where.includes("L-1203") && f.level === "block" && f.message === `"addressed_by" must be a non-empty string`),
      JSON.stringify(findings),
    );
  }
  {
    // behaviour 13: unaddressed recurrent class
    const dir = freshDir("recurrent-unaddressed");
    writeManifest(dir);
    writeLesson(dir, "L-1300", { id: "L-1300", at: "2026-09-19T00:00:00Z", class: "recur-unaddressed", cascade: 1, evidence: ["studio/x"] });
    writeLesson(dir, "L-1301", { id: "L-1301", at: "2026-09-19T00:00:00Z", class: "recur-unaddressed", cascade: 2, evidence: ["studio/x"] });
    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.recurrent");
    checkNumbered(
      13,
      `lesson.recurrent: unaddressed class reports "no lesson names what addresses it"`,
      findings.some((f) => f.message.includes("recur-unaddressed") && f.message.endsWith("no lesson names what addresses it")),
      JSON.stringify(findings),
    );
  }
  {
    // behaviour 14: in-flight opus (not done)
    const dir = freshDir("recurrent-inflight");
    writeManifest(dir);
    writeOpus(dir, "W-1400", { id: "W-1400", state: "building" });
    writeLesson(dir, "L-1400", { id: "L-1400", at: "2026-09-19T00:00:00Z", class: "recur-inflight", cascade: 1, evidence: ["studio/x"], addressed_by: "W-1400" });
    writeLesson(dir, "L-1401", { id: "L-1401", at: "2026-09-19T00:00:00Z", class: "recur-inflight", cascade: 2, evidence: ["studio/x"] });
    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.recurrent");
    checkNumbered(
      14,
      "lesson.recurrent: in-flight opus reports the not-yet-done message",
      findings.some((f) => f.message.includes("recur-inflight") && f.message.includes("addressed by W-1400 (building), not yet done")),
      JSON.stringify(findings),
    );
  }
  {
    // behaviour 15: silent for a done opus, a rule id, or a decision id
    const dir = freshDir("recurrent-silent");
    writeManifest(dir);
    writeOpus(dir, "W-1500", { id: "W-1500", state: "done" });
    writeDecision(dir, "D-1500", { id: "D-1500", title: "fixture", at: "2026-09-19T00:00:00Z", provenance: "stated", by: "patron", kill_when: "never" });

    writeLesson(dir, "L-1500", { id: "L-1500", at: "2026-09-19T00:00:00Z", class: "recur-done-opus", cascade: 1, evidence: ["studio/x"], addressed_by: "W-1500" });
    writeLesson(dir, "L-1501", { id: "L-1501", at: "2026-09-19T00:00:00Z", class: "recur-done-opus", cascade: 2, evidence: ["studio/x"] });

    writeLesson(dir, "L-1502", { id: "L-1502", at: "2026-09-19T00:00:00Z", class: "recur-rule", cascade: 1, evidence: ["studio/x"], addressed_by: "decision.kill" });
    writeLesson(dir, "L-1503", { id: "L-1503", at: "2026-09-19T00:00:00Z", class: "recur-rule", cascade: 2, evidence: ["studio/x"] });

    writeLesson(dir, "L-1504", { id: "L-1504", at: "2026-09-19T00:00:00Z", class: "recur-decision", cascade: 1, evidence: ["studio/x"], addressed_by: "D-1500" });
    writeLesson(dir, "L-1505", { id: "L-1505", at: "2026-09-19T00:00:00Z", class: "recur-decision", cascade: 2, evidence: ["studio/x"] });

    const findings = checkProcess(dir, { now: NOW }).filter((f) => f.rule === "lesson.recurrent");
    checkNumbered(15, "lesson.recurrent: silent for a done opus", !findings.some((f) => f.message.includes("recur-done-opus")), JSON.stringify(findings));
    checkNumbered(15, "lesson.recurrent: silent for a rule id", !findings.some((f) => f.message.includes("recur-rule")), JSON.stringify(findings));
    checkNumbered(15, "lesson.recurrent: silent for a decision id", !findings.some((f) => f.message.includes("recur-decision")), JSON.stringify(findings));
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
