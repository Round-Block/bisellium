/**
 * W-096 focused red suite. Select exactly one numbered behaviour with
 * `--behaviour N`; omitting the selector runs all seven for test:suite.
 *
 * Every fixture is a fresh temporary officina (and, for behaviour 1, a
 * fresh temporary Git repository). Nothing here reads or writes studio/ or
 * examples/sample-studio.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readFront } from "@bisellium/adapter-native";
import { checkStudio } from "./check.js";
import { runBranch } from "./branch.js";
import { runReady, runDone, runAmend } from "./lifecycle.js";
import { newItem, runNew } from "./new.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 7)) {
  console.error("opus-model.test.ts: --behaviour must be an integer from 1 through 7");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;
const NOW = new Date("2026-10-01T12:00:00.000Z");

const roots: string[] = [];
function scratch(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `w096-opus-model-${tag}-`));
  roots.push(root);
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function writeManifest(root: string, probationes: string[] = []): void {
  mkdirSync(join(root, "opera"), { recursive: true });
  mkdirSync(join(root, "briefs"), { recursive: true });
  mkdirSync(join(root, "ci"), { recursive: true });
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-096 focused fixture",
      "patron: patron",
      "collegia:",
      "  - { id: design, name: Design, magister: ui-lead }",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: ui-lead, collegium: design, kind: agent, harness: fake }",
      "  - { id: architect, collegium: design, kind: agent, harness: fake }",
      "  - { id: eng-lead, collegium: engineering, kind: agent, harness: fake }",
      "probationes:",
      ...(probationes.length === 0 ? ["  []"] : probationes.map((line) => `  ${line}`)),
      "wip_limit: 20",
      "",
    ].join("\n"),
  );
}

function writeOpus(root: string, id: string, front: string[], body = "Fixture description.\n"): string {
  const path = join(root, "opera", `${id}.md`);
  writeFileSync(path, ["---", `id: ${JSON.stringify(id)}`, ...front, "---", body].join("\n"));
  return path;
}

function front(root: string, id: string): Record<string, unknown> {
  return readFront<Record<string, unknown>>(join(root, "opera", `${id}.md`)).data;
}

function rules(root: string, id: string): string[] {
  return checkStudio(root, NOW).findings.filter((finding) => finding.where === `opera/${id}.md`).map((finding) => finding.rule);
}

function capture<T>(fn: () => T): T {
  const oldLog = console.log;
  const oldError = console.error;
  const oldWarn = console.warn;
  console.log = () => undefined;
  console.error = () => undefined;
  console.warn = () => undefined;
  try {
    return fn();
  } finally {
    console.log = oldLog;
    console.error = oldError;
    console.warn = oldWarn;
  }
}

function inventory(root: string): { opera: string[]; briefs: string[] } {
  return {
    opera: readdirSync(join(root, "opera")).sort(),
    briefs: readdirSync(join(root, "briefs")).sort(),
  };
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

if (runs(1)) {
  test("W-096 behaviour 1: native kinds are closed and branch creation pins the reviewed trunk", () => {
    const root = scratch("b1-kinds");
    writeManifest(root);
    writeOpus(root, "W-001", [
      'title: "invalid kind on disk"',
      "kind: typo",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ]);
    const before = inventory(root);
    const direct = capture(() => newItem(root, { kind: "typo", collegium: "engineering", title: "direct invalid kind" }));
    const cli = capture(() => runNew(["--kind", "typo", "--collegium", "engineering", "--title", "CLI invalid kind", root]));
    const after = inventory(root);

    const repo = scratch("b1-branch");
    git(repo, ["init", "-q", "-b", "master"]);
    git(repo, ["config", "user.name", "W-096 Test"]);
    git(repo, ["config", "user.email", "w096@example.invalid"]);
    const studio = join(repo, "studio");
    writeManifest(studio);
    writeOpus(studio, "W-096", [
      'title: "branch point fixture"',
      "kind: opus",
      "collegium: design",
      "state: greenlit",
      "probationes: {}",
    ]);
    writeOpus(studio, "W-095", [
      'title: "protected baseline record"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ]);
    writeFileSync(join(repo, "source.txt"), "reviewed trunk\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "test: establish reviewed trunk"]);
    const branchPoint = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["update-ref", "refs/remotes/origin/master", branchPoint]);
    const branched = capture(() => runBranch(["W-096", "--studio", studio, "--repo", repo]));
    const writerCheckedOutOwningBranch = git(repo, ["branch", "--show-current"]) === "opus/W-096";
    const writerBaselineCommit = front(studio, "W-096")["baseline_commit"];
    if (!writerCheckedOutOwningBranch) git(repo, ["switch", "opus/W-096"]);
    const opusPath = join(studio, "opera", "W-096.md");
    if (front(studio, "W-096")["baseline_commit"] === undefined) {
      writeFileSync(opusPath, readFileSync(opusPath, "utf8").replace("probationes: {}", `baseline_commit: ${branchPoint}\nprobationes: {}`));
    }
    git(repo, ["add", "studio/opera/W-096.md"]);
    git(repo, ["commit", "-q", "-m", "test: pin fixture baseline"]);
    writeFileSync(join(studio, "opera", "W-095.md"), `${readFileSync(join(studio, "opera", "W-095.md"), "utf8")}tampered\n`);
    const preservationRule = checkStudio(studio, NOW, { repo }).findings.some((finding) => finding.rule === "opus.records_unchanged");

    assert.deepEqual(
      {
        diskKindRule: rules(root, "W-001").includes("opus.kind"),
        newItemRefused: direct.ok === false,
        runNewRefused: cli.exitCode !== 0,
        creationInventoryUnchanged: JSON.stringify(after) === JSON.stringify(before),
        branchSucceeded: branched.exitCode === 0,
        checkedOutOwningBranch: writerCheckedOutOwningBranch,
        baselineCommit: writerBaselineCommit,
        preservationRule,
      },
      {
        diskKindRule: true,
        newItemRefused: true,
        runNewRefused: true,
        creationInventoryUnchanged: true,
        branchSucceeded: true,
        checkedOutOwningBranch: true,
        baselineCommit: branchPoint,
        preservationRule: true,
      },
    );
  });
}

if (runs(2)) {
  test("W-096 behaviour 2: UI readiness requires current substantive ui-lead input", () => {
    const root = scratch("b2-design-input");
    writeManifest(root, ['- { id: spec, name: Specification, kind: agent }']);
    writeFileSync(join(root, "briefs", "W-002.md"), "# W-002\n\n## Intent\n\nUI fixture.\n");
    writeOpus(root, "W-002", [
      'title: "UI work without design input"',
      "kind: ui",
      "collegium: design",
      "state: greenlit",
      "probationes: {}",
    ]);
    const before = readFileSync(join(root, "opera", "W-002.md"), "utf8");
    const result = capture(() => runReady(["W-002", "--sella", "architect", "--studio", root], { now: NOW }));

    const evidenceRoot = scratch("b2-red-assertion");
    writeManifest(evidenceRoot);
    writeFileSync(
      join(evidenceRoot, "briefs", "W-096.md"),
      ["# W-096", "", "## Behaviours to test", "", ...Array.from({ length: 7 }, (_, index) => `${index + 1}. Fixture behaviour.`), ""].join("\n"),
    );
    writeOpus(evidenceRoot, "W-096", [
      'title: "assertion red fixture"',
      "kind: opus",
      "collegium: engineering",
      "state: building",
      "spec: briefs/W-096.md",
      "probationes: {}",
    ]);
    const reds = join(evidenceRoot, "ci", "reds", "W-096");
    mkdirSync(reds, { recursive: true });
    for (let behaviour = 1; behaviour <= 7; behaviour++) {
      const body =
        behaviour === 2
          ? "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './missing.js'\n"
          : `FAIL unique non-assertion output for behaviour ${behaviour}\n`;
      writeFileSync(
        join(reds, `${String(behaviour).padStart(2, "0")}.log`),
        `# behaviour: ${behaviour}\n# command: node fixture.js --behaviour ${behaviour}\n# exit: 1\n# sella: builder-codex.W-096\n\n${body}`,
      );
    }
    const assertionRule = checkStudio(evidenceRoot, NOW).findings.some((finding) => finding.rule === "opus.red_assertion");

    assert.deepEqual(
      {
        exitCode: result.exitCode,
        unchanged: readFileSync(join(root, "opera", "W-002.md"), "utf8") === before,
        state: front(root, "W-002")["state"],
        designRule: rules(root, "W-002").includes("opus.ui.design"),
        assertionRule,
      },
      { exitCode: 1, unchanged: true, state: "greenlit", designRule: true, assertionRule: true },
    );
  });
}

if (runs(3)) {
  test("W-096 behaviour 3: UI completion requires a fresh served-e2e result", () => {
    const root = scratch("b3-served-e2e");
    writeManifest(root);
    writeOpus(root, "W-003", [
      'title: "UI work without served evidence"',
      "kind: ui",
      "collegium: design",
      "state: review",
      "probationes: {}",
    ]);
    const before = readFileSync(join(root, "opera", "W-003.md"), "utf8");
    const result = capture(() => runDone(["W-003", "--sella", "eng-lead", "--studio", root], { now: NOW }));

    assert.deepEqual(
      {
        exitCode: result.exitCode,
        unchanged: readFileSync(join(root, "opera", "W-003.md"), "utf8") === before,
        state: front(root, "W-003")["state"],
        e2eRule: rules(root, "W-003").includes("opus.ui.e2e"),
      },
      { exitCode: 1, unchanged: true, state: "review", e2eRule: true },
    );
  });
}

if (runs(4)) {
  test("W-096 behaviour 4: UI completion requires a current scoped Patron ruling", () => {
    const root = scratch("b4-rulings");
    writeManifest(root, ['- { id: served-e2e, name: Served e2e, kind: automated, command: "node scripts/served-e2e.mjs" }']);
    writeFileSync(join(root, "ci", "served.log"), "served-e2e passed tree:1111111111111111111111111111111111111111\n");
    writeOpus(root, "W-004", [
      'title: "UI work without Patron rulings"',
      "kind: ui",
      "collegium: design",
      "state: review",
      "probationes:",
      "  served-e2e:",
      "    status: passed",
      "    evidence: ci/served.log",
      "    certifies: tree:1111111111111111111111111111111111111111",
    ]);
    const before = readFileSync(join(root, "opera", "W-004.md"), "utf8");
    const result = capture(() => runDone(["W-004", "--sella", "eng-lead", "--studio", root], { now: NOW }));

    assert.deepEqual(
      {
        exitCode: result.exitCode,
        unchanged: readFileSync(join(root, "opera", "W-004.md"), "utf8") === before,
        state: front(root, "W-004")["state"],
        rulingRule: rules(root, "W-004").includes("opus.ui.rulings"),
      },
      { exitCode: 1, unchanged: true, state: "review", rulingRule: true },
    );
  });
}

if (runs(5)) {
  test("W-096 behaviour 5: arcs and subtask parents are bounded valid references", () => {
    const root = scratch("b5-hierarchy");
    writeManifest(root);
    writeOpus(root, "W-005", [
      'title: "dangling arc"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "arc: W-999",
      "probationes: {}",
    ]);
    writeOpus(root, "W-006", [
      'title: "subtask without parent"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ]);

    assert.deepEqual(
      {
        danglingArc: rules(root, "W-005").includes("opus.arc"),
        missingParent: rules(root, "W-006").includes("opus.parent"),
      },
      { danglingArc: true, missingParent: true },
    );
  });
}

if (runs(6)) {
  test("W-096 behaviour 6: successful lifecycle transitions persist their exact start and end", () => {
    const root = scratch("b6-dates");
    writeManifest(root);
    writeFileSync(join(root, "briefs", "W-007.md"), "# W-007\n\nLifecycle fixture.\n");
    writeOpus(root, "W-007", [
      'title: "lifecycle dates"',
      "kind: task",
      "collegium: engineering",
      "state: greenlit",
      "probationes: {}",
    ]);
    const started = new Date("2026-10-01T12:34:56.123Z");
    const ended = new Date("2026-10-01T13:45:01.456Z");
    const ready = capture(() => runReady(["W-007", "--sella", "eng-lead", "--studio", root], { now: started }));
    const done = capture(() => runDone(["W-007", "--sella", "eng-lead", "--studio", root], { now: ended }));
    const data = front(root, "W-007");

    assert.deepEqual(
      { ready: ready.exitCode, done: done.exitCode, state: data["state"], start: data["start"], end: data["end"] },
      { ready: 0, done: 0, state: "done", start: started.toISOString(), end: ended.toISOString() },
    );
  });
}

if (runs(7)) {
  test("W-096 behaviour 7: title is a one-line summary at every native writer boundary", () => {
    const root = scratch("b7-title");
    writeManifest(root);
    writeOpus(root, "W-008", [
      'title: "decoded\\nnewline"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ], "Description with CRLF follows.\r\n\r\nSecond paragraph.\r\n");
    writeOpus(root, "W-009", [
      'title: "amend target"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ], "Body must survive.\r\n");
    const before = inventory(root);
    const amendBefore = readFileSync(join(root, "opera", "W-009.md"), "utf8");
    const direct = capture(() => newItem(root, { kind: "task", collegium: "engineering", title: "bad\nsummary" }));
    const cli = capture(() => runNew(["--kind", "task", "--collegium", "engineering", "--title", "bad\nsummary", root]));
    const amend = capture(() =>
      runAmend(["W-009", "--title", "bad\nsummary", "--reason", "exercise title boundary", "--sella", "eng-lead", "--studio", root], { now: NOW }),
    );
    const after = inventory(root);

    assert.deepEqual(
      {
        diskTitleRule: rules(root, "W-008").includes("opus.title"),
        newItemRefused: direct.ok === false,
        runNewRefused: cli.exitCode !== 0,
        amendRefused: amend.exitCode !== 0,
        creationInventoryUnchanged: JSON.stringify(after) === JSON.stringify(before),
        amendBytesUnchanged: readFileSync(join(root, "opera", "W-009.md"), "utf8") === amendBefore,
      },
      {
        diskTitleRule: true,
        newItemRefused: true,
        runNewRefused: true,
        amendRefused: true,
        creationInventoryUnchanged: true,
        amendBytesUnchanged: true,
      },
    );
  });
}
