/**
 * packages/cli/src/process.test.ts — W-018 (2/4): the process-as-data rules
 * (`state.building.spec`, the `since:` exemption, `lex.unchecked`,
 * `decision.*`, `lesson.*`) and `bisellium new`'s `--spec`/`--brief`. Each
 * officina here is a synthetic temp directory built by hand so a test
 * controls every manifest/opus field precisely — no shared fixture drifts
 * out from under these assertions. `retro.test.ts` covers the retro
 * command (behaviours 10-13); this file covers 1-9.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkStudio } from "./check.js";
import { runNew } from "./new.js";

const repo = resolve(process.argv[2] ?? ".");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function tempDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `bisellium-process-${tag}-`));
  dirs.push(d);
  return d;
}

/** A minimal officina: one collegium, one sella, and whatever probationes
 *  the caller declares (empty by default, so state.building.spec has
 *  nothing to fire on unless the test asks for it). */
function makeOfficina(dir: string, probationesYaml: string): void {
  writeFileSync(
    join(dir, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: Process Fixture",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: eng-lead, collegium: engineering, kind: agent }",
      "probationes:",
      probationesYaml,
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(dir, "opera"), { recursive: true });
}

function writeOpus(dir: string, id: string, frontLines: string[]): void {
  writeFileSync(join(dir, "opera", `${id}.md`), `---\n${frontLines.join("\n")}\n---\n`);
}

function rulesFor(dir: string, opusId: string): Set<string> {
  const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
  return new Set(r.findings.filter((f) => f.where.includes(opusId)).map((f) => f.rule));
}

try {
  // =========================================================================
  // Behaviour 1 — state.building.spec blocks/clears
  // =========================================================================
  {
    const dir = tempDir("spec-gate");
    makeOfficina(dir, "  - { id: spec, name: Spec, kind: agent }");

    writeOpus(dir, "W-001", [
      'id: "W-001"',
      'title: "No spec at all"',
      "kind: feature",
      "collegium: engineering",
      "state: building",
      "probationes: {}",
      "traditio: { sella: eng-lead, stage: building, next: code, blocked_on: none, at: 2026-09-18T10:00:00Z }",
    ]);
    // RED: recorded before the rule existed — see redEvidence in the report.
    check("1a. building with no spec: key blocks state.building.spec", rulesFor(dir, "W-001").has("state.building.spec"));

    writeOpus(dir, "W-002", [
      'id: "W-002"',
      'title: "spec key but gate not passed"',
      "kind: feature",
      "collegium: engineering",
      "state: building",
      "spec: briefs/W-002.md",
      "probationes: {}",
      "traditio: { sella: eng-lead, stage: building, next: code, blocked_on: none, at: 2026-09-18T10:00:00Z }",
    ]);
    check("1b. spec: set but gate not passed still blocks", rulesFor(dir, "W-002").has("state.building.spec"));

    writeOpus(dir, "W-003", [
      'id: "W-003"',
      'title: "spec key and gate passed"',
      "kind: feature",
      "collegium: engineering",
      "state: building",
      "spec: briefs/W-003.md",
      "probationes: { spec: { status: passed, evidence: briefs/W-003.md } }",
      "traditio: { sella: eng-lead, stage: building, next: code, blocked_on: none, at: 2026-09-18T10:00:00Z }",
    ]);
    check("1c. spec: set and gate passed clears state.building.spec", !rulesFor(dir, "W-003").has("state.building.spec"));
  }

  // =========================================================================
  // Behaviour 2 — never fires on done/halted, nor when no spec probatio is
  // declared at all (explicit assertion against bad-wip-cap).
  // =========================================================================
  {
    const dir = tempDir("spec-gate-scope");
    makeOfficina(dir, "  - { id: spec, name: Spec, kind: agent }");

    writeOpus(dir, "W-001", [
      'id: "W-001"',
      'title: "done, no spec"',
      "kind: feature",
      "collegium: engineering",
      "state: done",
      "probationes: {}",
    ]);
    check("2a. done with no spec never blocks state.building.spec", !rulesFor(dir, "W-001").has("state.building.spec"));

    writeOpus(dir, "W-002", [
      'id: "W-002"',
      'title: "halted, no spec"',
      "kind: feature",
      "collegium: engineering",
      "state: halted",
      "reason: paused",
      "resume_when: later",
      "halted_at: 2026-09-01T00:00:00Z",
      "probationes: {}",
    ]);
    check("2b. halted with no spec never blocks state.building.spec", !rulesFor(dir, "W-002").has("state.building.spec"));
  }
  {
    // bad-wip-cap's manifest declares `probationes: []` — no `spec` probatio
    // at all — so its two `building` opera with no `spec:` key must NOT
    // pick up state.building.spec, and its EXPECT set (wip.cap only) must
    // be exactly what W-018 leaves it.
    const dir = tempDir("bad-wip-cap-copy");
    const src = join(repo, "examples/fixtures/bad-wip-cap");
    mkdirSync(dir, { recursive: true });
    for (const f of ["bisellium.yml"]) writeFileSync(join(dir, f), readFileSync(join(src, f)));
    mkdirSync(join(dir, "opera"));
    for (const f of readdirSync(join(src, "opera"))) writeFileSync(join(dir, "opera", f), readFileSync(join(src, "opera", f)));

    const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
    const blocks = [...new Set(r.findings.filter((f) => f.level === "block").map((f) => f.rule))].sort();
    check("2c. bad-wip-cap (no spec probatio declared): EXPECT set unchanged", blocks.join(",") === "wip.cap", blocks.join(", "));
  }

  // =========================================================================
  // Behaviour 3 — `since:` exemption, fails closed on a bad traditio.at
  // =========================================================================
  {
    const dir = tempDir("since");
    // "qa" is an agent gate distinct from the (default) "review" probatio
    // id itself — state.review.agent checks agent gates OTHER than the one
    // that gates the "review" state, so testing against a gate literally
    // named "review" would always exclude itself from that check.
    makeOfficina(
      dir,
      ["  - { id: automated1, name: Automated, kind: automated }", "  - { id: qa, name: QA, kind: agent, since: 2026-09-18T19:00:00Z }"].join("\n"),
    );

    // qa, since 19:00Z: traditio.at BEFORE it -> exempt, no finding.
    writeOpus(dir, "W-001", [
      'id: "W-001"',
      'title: "before cutoff"',
      "kind: feature",
      "collegium: engineering",
      "state: review",
      "probationes: { automated1: { status: passed, evidence: x.log } }",
      "traditio: { sella: eng-lead, stage: review, next: x, blocked_on: none, at: 2026-09-18T17:00:00Z }",
    ]);
    check("3a. traditio.at before since: no state.review.agent", !rulesFor(dir, "W-001").has("state.review.agent"));

    // qa, since 19:00Z: traditio.at AFTER it -> demanded, finding fires.
    writeOpus(dir, "W-002", [
      'id: "W-002"',
      'title: "after cutoff"',
      "kind: feature",
      "collegium: engineering",
      "state: review",
      "probationes: { automated1: { status: passed, evidence: x.log } }",
      "traditio: { sella: eng-lead, stage: review, next: x, blocked_on: none, at: 2026-09-18T20:00:00Z }",
    ]);
    check("3b. traditio.at after since: state.review.agent fires", rulesFor(dir, "W-002").has("state.review.agent"));

    // qa, since 19:00Z: traditio.at unparseable -> fails closed, demanded.
    writeOpus(dir, "W-003", [
      'id: "W-003"',
      'title: "unparseable traditio.at"',
      "kind: feature",
      "collegium: engineering",
      "state: review",
      "probationes: { automated1: { status: passed, evidence: x.log } }",
      "traditio: { sella: eng-lead, stage: review, next: x, blocked_on: none, at: not-a-date }",
    ]);
    check("3c. unparseable traditio.at fails closed: state.review.agent fires", rulesFor(dir, "W-003").has("state.review.agent"));

    // Same three, for state.done.probationes.
    writeOpus(dir, "W-004", [
      'id: "W-004"',
      'title: "done, before cutoff"',
      "kind: feature",
      "collegium: engineering",
      "state: done",
      "probationes: { automated1: { status: passed, evidence: x.log } }",
      "traditio: { sella: eng-lead, stage: done, next: x, blocked_on: none, at: 2026-09-18T17:00:00Z }",
    ]);
    check("3d. done, traditio.at before since: no state.done.probationes", !rulesFor(dir, "W-004").has("state.done.probationes"));

    writeOpus(dir, "W-005", [
      'id: "W-005"',
      'title: "done, after cutoff"',
      "kind: feature",
      "collegium: engineering",
      "state: done",
      "probationes: { automated1: { status: passed, evidence: x.log } }",
      "traditio: { sella: eng-lead, stage: done, next: x, blocked_on: none, at: 2026-09-18T20:00:00Z }",
    ]);
    check("3e. done, traditio.at after since: state.done.probationes fires", rulesFor(dir, "W-005").has("state.done.probationes"));

    writeOpus(dir, "W-006", [
      'id: "W-006"',
      'title: "done, no traditio.at"',
      "kind: feature",
      "collegium: engineering",
      "state: done",
      "probationes: { automated1: { status: passed, evidence: x.log } }",
    ]);
    check("3f. done, missing traditio.at fails closed: state.done.probationes fires", rulesFor(dir, "W-006").has("state.done.probationes"));
  }

  // =========================================================================
  // Behaviour 4 — runNew --brief / --spec
  // =========================================================================
  {
    const dir = tempDir("runnew");
    makeOfficina(dir, "  - { id: spec, name: Spec, kind: agent }");

    const r1 = runNew(["--kind", "feature", "--collegium", "engineering", "--title", "Brief me", "--brief", dir]);
    check("4a. new --brief exits 0", r1.exitCode === 0);
    const opusPath = join(dir, "opera", "W-001.md");
    const opusRaw = readFileSync(opusPath, "utf8");
    check("4b. --brief sets spec: briefs/W-001.md", opusRaw.includes('spec: "briefs/W-001.md"'), opusRaw);
    const briefPath = join(dir, "briefs", "W-001.md");
    const briefRaw = readFileSync(briefPath, "utf8");
    const sections = ["Intent", "Files owned", "Interfaces", "Behaviours to test", "Acceptance", "Out of scope"];
    check(
      "4c. --brief creates briefs/W-001.md with all six sections",
      sections.every((s) => briefRaw.includes(`## ${s}`)),
      briefRaw,
    );

    const r2 = runNew(["--kind", "feature", "--collegium", "engineering", "--title", "Explicit spec", "--spec", "briefs/elsewhere.md", dir]);
    check("4d. new --spec <officina-relative path> is accepted (exit 0)", r2.exitCode === 0);
    const opus2 = readFileSync(join(dir, "opera", "W-002.md"), "utf8");
    check("4e. --spec value round-trips into spec:", opus2.includes('spec: "briefs/elsewhere.md"'), opus2);

    const beforeAbs = readdirSync(join(dir, "opera")).length;
    const rAbs = runNew(["--kind", "feature", "--collegium", "engineering", "--title", "Abs", "--spec", "/etc/passwd", dir]);
    check("4f. --spec absolute path refused, exit 1", rAbs.exitCode === 1);
    check("4g. --spec absolute path: nothing written", readdirSync(join(dir, "opera")).length === beforeAbs);

    const rDotDot = runNew(["--kind", "feature", "--collegium", "engineering", "--title", "Dotdot", "--spec", "../escape.md", dir]);
    check("4h. --spec with '..' segment refused, exit 1", rDotDot.exitCode === 1);
    check("4i. --spec '..' segment: nothing written", readdirSync(join(dir, "opera")).length === beforeAbs);

    const rOutside = runNew(["--kind", "feature", "--collegium", "engineering", "--title", "Outside", "--spec", "briefs/../../escape.md", dir]);
    check("4j. --spec resolving outside officina refused, exit 1", rOutside.exitCode === 1);
    check("4k. --spec outside officina: nothing written", readdirSync(join(dir, "opera")).length === beforeAbs);

    // Existing flags/exit codes unchanged.
    const rMissing = runNew(["--kind", "feature", dir]);
    check("4l. missing --collegium/--title still exits 2 (usage)", rMissing.exitCode === 2);
    const rNonStudio = runNew(["--kind", "task", "--collegium", "x", "--title", "X", tempDir("non-studio-empty")]);
    check("4m. non-studio dir still exits 2", rNonStudio.exitCode === 2);
  }

  // =========================================================================
  // Behaviour 5 — lex.unchecked
  // =========================================================================
  {
    const dir = tempDir("lex-unchecked");
    makeOfficina(dir, "  - { id: tests, name: Tests, kind: automated }");
    mkdirSync(join(dir, "leges"), { recursive: true });
    writeFileSync(
      join(dir, "leges", "engineering.md"),
      [
        "# Engineering Lex",
        "",
        "## 1. Mandate",
        "",
        "Ship things.",
        "",
        "## 2. Decides alone",
        "",
        "- Checked clause (check: wip.cap)",
        "- Unchecked clause one",
        "- Unchecked clause two",
        "",
        "## 3. Digests",
        "",
        "- Unchecked clause three",
        "",
        "## 4. Asks",
        "",
        "- Checked ask (check: decision.kill)",
        "",
      ].join("\n"),
    );
    const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
    const finding = r.findings.find((f) => f.rule === "lex.unchecked");
    check("5a. lex.unchecked reports exactly 3 unchecked clauses", !!finding && finding.message.includes("3 clause"), JSON.stringify(finding));
    check(
      "5b. lex.unchecked emits exactly one finding for this lex",
      r.findings.filter((f) => f.rule === "lex.unchecked" && f.where === "leges/engineering.md").length === 1,
    );
  }

  // =========================================================================
  // Behaviours 6-7 — decision.shape / decision.kill
  // =========================================================================
  {
    const dir = tempDir("decisions");
    makeOfficina(dir, "  - { id: tests, name: Tests, kind: automated }");
    mkdirSync(join(dir, "decisions"), { recursive: true });

    const good =
      'id: "D-001"\ntitle: "Something"\nat: 2026-09-18T00:00:00Z\nprovenance: stated\nby: patron\nkill_when: "the condition no longer holds"\n';
    for (const missing of ["id", "title", "at", "provenance", "by", "kill_when"]) {
      const lines = good
        .split("\n")
        .filter((l) => l && !l.startsWith(`${missing}:`))
        .join("\n");
      writeFileSync(join(dir, "decisions", "D-001.md"), `---\n${lines}\n---\n`);
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("D-001")).map((f) => f.rule));
      check(`6. decision.shape blocks missing "${missing}"`, rules.has("decision.shape"), [...rules].join(","));
    }

    writeFileSync(join(dir, "decisions", "D-001.md"), `---\n${good.replace("provenance: stated", "provenance: guessed")}---\n`);
    {
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("D-001")).map((f) => f.rule));
      check("6. decision.shape blocks unknown provenance", rules.has("decision.shape"), [...rules].join(","));
    }

    writeFileSync(join(dir, "decisions", "D-001.md"), `---\n${good.replace('kill_when: "the condition no longer holds"\n', "")}---\n`);
    {
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("D-001")).map((f) => f.rule));
      check("7a. decision.kill blocks a missing kill_when", rules.has("decision.kill"), [...rules].join(","));
    }

    writeFileSync(join(dir, "decisions", "D-001.md"), `---\n${good.replace('kill_when: "the condition no longer holds"', 'kill_when: ""')}---\n`);
    {
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("D-001")).map((f) => f.rule));
      check("7b. decision.kill blocks an empty kill_when", rules.has("decision.kill"), [...rules].join(","));
    }

    writeFileSync(join(dir, "decisions", "D-001.md"), `---\n${good}---\n`);
    {
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("D-001")).map((f) => f.rule));
      check("7c. a well-formed decision blocks nothing", !rules.has("decision.shape") && !rules.has("decision.kill"), [...rules].join(","));
    }
  }

  // =========================================================================
  // Behaviours 8-9 — lesson.shape / lesson.evidence / lesson.recurrent
  // =========================================================================
  {
    const dir = tempDir("lessons");
    makeOfficina(dir, "  - { id: tests, name: Tests, kind: automated }");
    mkdirSync(join(dir, "lessons"), { recursive: true });
    writeFileSync(join(dir, "real-evidence.log"), "log\n");

    const good = 'id: "L-001"\nat: 2026-09-18T00:00:00Z\nclass: "tests×flaky"\nevidence: ["real-evidence.log"]\n';
    for (const missing of ["id", "at", "class", "evidence"]) {
      const lines = good
        .split("\n")
        .filter((l) => l && !l.startsWith(`${missing}:`))
        .join("\n");
      writeFileSync(join(dir, "lessons", "L-001.md"), `---\n${lines}\n---\n`);
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("L-001")).map((f) => f.rule));
      check(`8a. lesson.shape blocks missing "${missing}"`, rules.has("lesson.shape"), [...rules].join(","));
    }

    writeFileSync(join(dir, "lessons", "L-001.md"), `---\n${good.replace('evidence: ["real-evidence.log"]', "evidence: []")}---\n`);
    {
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("L-001")).map((f) => f.rule));
      check("8b. lesson.evidence blocks an empty evidence list", rules.has("lesson.evidence"), [...rules].join(","));
    }

    writeFileSync(join(dir, "lessons", "L-001.md"), `---\n${good.replace("real-evidence.log", "nonexistent.log")}---\n`);
    {
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("L-001")).map((f) => f.rule));
      check("8c. lesson.evidence blocks a dead href", rules.has("lesson.evidence"), [...rules].join(","));
    }

    writeFileSync(join(dir, "lessons", "L-001.md"), `---\n${good}---\n`);
    {
      const r = checkStudio(dir, new Date("2026-09-18T20:00:00Z"));
      const rules = new Set(r.findings.filter((f) => f.where.includes("L-001")).map((f) => f.rule));
      check("8d. a well-formed lesson blocks nothing", !rules.has("lesson.shape") && !rules.has("lesson.evidence"), [...rules].join(","));
    }

    // lesson.recurrent: same class across >=2 cascades on >=2 lessons -> advises.
    const dirR = tempDir("lesson-recurrent");
    makeOfficina(dirR, "  - { id: tests, name: Tests, kind: automated }");
    mkdirSync(join(dirR, "lessons"), { recursive: true });
    writeFileSync(join(dirR, "ev.log"), "log\n");
    writeFileSync(
      join(dirR, "lessons", "L-001.md"),
      '---\nid: "L-001"\nat: 2026-09-18T00:00:00Z\nclass: "tests×flaky"\nevidence: ["ev.log"]\ncascade: 3\n---\n',
    );
    writeFileSync(
      join(dirR, "lessons", "L-002.md"),
      '---\nid: "L-002"\nat: 2026-09-18T00:00:00Z\nclass: "tests×flaky"\nevidence: ["ev.log"]\ncascade: 4\n---\n',
    );
    {
      const r = checkStudio(dirR, new Date("2026-09-18T20:00:00Z"));
      check("9a. same class, 2 distinct cascades, 2 lessons: lesson.recurrent advises", r.findings.some((f) => f.rule === "lesson.recurrent"));
    }
    // A single lesson can't be "recurrent" on its own, even filed twice
    // (same cascade both times counts as one distinct cascade value).
    const dirR2 = tempDir("lesson-not-recurrent");
    makeOfficina(dirR2, "  - { id: tests, name: Tests, kind: automated }");
    mkdirSync(join(dirR2, "lessons"), { recursive: true });
    writeFileSync(join(dirR2, "ev.log"), "log\n");
    writeFileSync(
      join(dirR2, "lessons", "L-001.md"),
      '---\nid: "L-001"\nat: 2026-09-18T00:00:00Z\nclass: "tests×flaky"\nevidence: ["ev.log"]\ncascade: 3\n---\n',
    );
    {
      const r = checkStudio(dirR2, new Date("2026-09-18T20:00:00Z"));
      check("9b. a single lesson never triggers lesson.recurrent", !r.findings.some((f) => f.rule === "lesson.recurrent"));
    }
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
