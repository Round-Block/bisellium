/**
 * W-096 focused red suite. Select exactly one numbered behaviour with
 * `--behaviour N`; omitting the selector runs all seven for test:suite.
 *
 * Every fixture is a fresh temporary officina (and, for behaviour 1, a
 * fresh temporary Git repository). Nothing here reads or writes studio/ or
 * examples/sample-studio.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { parseFrontMatter, readFront } from "@bisellium/adapter-native";
import { checkStudio } from "./check.js";
import { createOpusBranch, runBranch } from "./branch.js";
import { runReady, runDone, runAmend, runReview, runHalt } from "./lifecycle.js";
import { newItem, runNew } from "./new.js";
import { runVerdict } from "./verdict.js";
import { runVerify } from "./verify.js";
import {
  comparePrompt,
  designDigest,
  fullCaseFold,
  substantiveUiTranscript,
  titleProblem,
  utcTimestampProblem,
} from "@bisellium/commands/opus-model.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 7)) {
  console.error("opus-model.test.ts: --behaviour must be an integer from 1 through 7");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;
const NOW = new Date("2026-10-01T12:00:00.000Z");
const repoArg = argv.find((arg, index) => arg !== "--behaviour" && (index === 0 || argv[index - 1] !== "--behaviour"));
const sourceRepo = resolve(repoArg ?? ".");
const bootstrapScript = join(sourceRepo, "scripts", "bootstrap-w096-baseline.ts");

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
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: ui-lead, collegium: design, kind: agent, harness: fake }",
      "  - { id: architect, collegium: design, kind: agent, harness: fake }",
      "  - { id: eng-lead, collegium: engineering, kind: agent, harness: fake }",
      "  - { id: qa-lead, collegium: qa, kind: agent, harness: fake }",
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

const VALID_UI_BODY = [
  "## Findings",
  "No findings",
  "The navigation hierarchy remains legible across every supported viewport.",
  "## Recommendation",
  "The interface treatment preserves clear emphasis and predictable interaction order.",
  "Verdict: passed",
  "",
].join("\n");

function writeUiInput(root: string, id: string, round = 1, body = VALID_UI_BODY, prompt = "retained dispatch context uses wholly separate planning vocabulary for the assigned design review"): string {
  const record = front(root, id);
  const spec = String(record["spec"]);
  const digest = designDigest(String(record["title"]), readFileSync(join(root, spec)));
  const promptRel = `ci/${id}-prompt-${round}.md`;
  const inputRel = `ci/${id}-spec-${round}.log`;
  writeFileSync(join(root, promptRel), prompt);
  writeFileSync(
    join(root, inputRel),
    [
      `# opus: ${id}`,
      "# phase: spec",
      `# round: ${round}`,
      "# sella: ui-lead",
      "# outcome: passed",
      "# at: 2026-10-01T11:00:00.000Z",
      `# design_digest: ${digest}`,
      `# dispatch_prompt: ${promptRel}`,
      "",
      body,
    ].join("\n"),
  );
  return inputRel;
}

function writeReviewEvidence(root: string, id: string, inputRel: string, name = "review.log"): string {
  const record = front(root, id);
  const digest = designDigest(String(record["title"]), readFileSync(join(root, String(record["spec"]))));
  const rel = `ci/${name}`;
  writeFileSync(
    join(root, rel),
    [
      `# opus: ${id}`,
      "# phase: build",
      "# round: 1",
      "# sella: qa-lead",
      "# outcome: passed",
      "# at: 2026-10-01T11:30:00.000Z",
      `# ui_input: ${inputRel}`,
      `# design_digest: ${digest}`,
      "",
      "## UI input disposition",
      "The cited UI input was considered in the sole censor review.",
      "",
    ].join("\n"),
  );
  return rel;
}

function servedLines(tree: string): string[] {
  return [
    "  served-e2e:",
    "    status: passed",
    "    evidence: ci/served.log",
    `    certifies: ${tree}`,
    "    at: 2026-10-01T11:15:00.000Z",
  ];
}

function writeServedLog(root: string, tree: string): void {
  writeFileSync(join(root, "ci", "served.log"), [`certifies: ${tree}`, "command: node scripts/served-e2e.mjs", "exit code: 0", ""].join("\n"));
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

function captureErrors<T>(fn: () => T): { value: T; errors: string[] } {
  const oldLog = console.log;
  const oldError = console.error;
  const oldWarn = console.warn;
  const errors: string[] = [];
  console.log = () => undefined;
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    return { value: fn(), errors };
  } finally {
    console.log = oldLog;
    console.error = oldError;
    console.warn = oldWarn;
  }
}

async function captureAsync<T>(fn: () => Promise<T>): Promise<{ value: T; errors: string[] }> {
  const oldLog = console.log;
  const oldError = console.error;
  const oldWarn = console.warn;
  const errors: string[] = [];
  console.log = () => undefined;
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    return { value: await fn(), errors };
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

function commitAll(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

interface BootstrapFixture {
  repo: string;
  studio: string;
  baseline: string;
}

interface BootstrapRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function assertionRed(behaviour: number): string {
  return [
    `# behaviour: ${behaviour}`,
    `# command: node --test-reporter=tap --import tsx packages/cli/src/opus-model.test.ts . --behaviour ${behaviour}`,
    "# exit: 1",
    "# sella: builder-codex.W-096",
    "",
    "TAP version 13",
    `# Subtest: W-096 behaviour ${behaviour}: fixture red`,
    `not ok 1 - W-096 behaviour ${behaviour}: fixture red`,
    "  ---",
    "  code: 'ERR_ASSERTION'",
    "  ...",
    "1..1",
    "# tests 1",
    "# pass 0",
    "# fail 1",
    "",
  ].join("\n");
}

/** A wholly synthetic historical W-096 branch; no fixture state is cloned. */
function bootstrapFixture(tag: string): BootstrapFixture {
  const repo = scratch(`bootstrap-${tag}`);
  git(repo, ["init", "-q", "-b", "master"]);
  git(repo, ["config", "user.name", "W-096 Test"]);
  git(repo, ["config", "user.email", "w096@example.invalid"]);
  const studio = join(repo, "studio");
  writeManifest(studio, ['- { id: spec, name: Specification, kind: agent }']);
  writeFileSync(
    join(studio, "briefs", "W-096.md"),
    ["# W-096", "", "## Behaviours to test", "", ...Array.from({ length: 7 }, (_, index) => `${index + 1}. Fixture behaviour.`), ""].join("\n"),
  );
  writeOpus(studio, "W-094", [
    'title: "first protected fixture record"',
    "kind: task",
    "collegium: engineering",
    "state: backlog",
    "probationes: {}",
  ]);
  writeOpus(studio, "W-095", [
    'title: "second protected fixture record"',
    "kind: bug",
    "collegium: engineering",
    "state: backlog",
    "probationes: {}",
  ]);
  writeOpus(studio, "W-096", [
    'title: "already building one-time bootstrap fixture"',
    "kind: opus",
    "collegium: design",
    "state: building",
    'probationes: { spec: { sella: architect, status: passed, evidence: "briefs/W-096.md", at: 2026-10-01T11:00:00.000Z } }',
    "spec: briefs/W-096.md",
    'traditio: { sella: architect, stage: building, next: "fixture", blocked_on: none, at: 2026-10-01T11:00:00.000Z }',
  ]);
  mkdirSync(join(repo, "examples", "sample-studio", "opera"), { recursive: true });
  writeFileSync(
    join(repo, "examples", "sample-studio", "opera", "S-001.md"),
    "---\nid: S-001\ntitle: sample protected record\nkind: feature\ncollegium: engineering\nstate: backlog\nprobationes: {}\n---\n",
  );
  const reds = join(studio, "ci", "reds", "W-096");
  mkdirSync(reds, { recursive: true });
  for (let behaviour = 1; behaviour <= 7; behaviour++)
    writeFileSync(join(reds, `${String(behaviour).padStart(2, "0")}.log`), assertionRed(behaviour));
  writeFileSync(join(repo, "source.txt"), "reviewed trunk\n");
  const baseline = commitAll(repo, "test: establish reviewed W-096 trunk");

  const origin = scratch(`bootstrap-${tag}-origin`);
  git(origin, ["init", "-q", "--bare"]);
  git(repo, ["remote", "add", "origin", origin]);
  git(repo, ["push", "-q", "-u", "origin", "master"]);
  git(repo, ["switch", "-q", "-c", "opus/W-096"]);
  writeFileSync(join(repo, "implementation.txt"), "historical branch work\n");
  commitAll(repo, "test: establish already-building W-096 branch");
  return { repo, studio, baseline };
}

function runBootstrap(fixture: BootstrapFixture): BootstrapRun {
  // A missing implementation is a successful no-op so the red is always an
  // assertion about pin/refusal behaviour, never a loader or spawn failure.
  if (!existsSync(bootstrapScript)) return { status: 0, stdout: "", stderr: "" };
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", bootstrapScript, "--repo", fixture.repo, "--studio", fixture.studio],
    {
      cwd: sourceRepo,
      encoding: "utf8",
      env: {
        ...process.env,
        BISELLIUM_W096_BOOTSTRAP_TEST_SEAM: "1",
        BISELLIUM_W096_BOOTSTRAP_EXPECTED_BASE: fixture.baseline,
      },
      timeout: 30_000,
    },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

function runBootstrapWithoutTestSeam(fixture: BootstrapFixture): BootstrapRun {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", bootstrapScript, "--repo", fixture.repo, "--studio", fixture.studio],
    {
      cwd: sourceRepo,
      encoding: "utf8",
      env: {
        ...process.env,
        BISELLIUM_W096_BOOTSTRAP_TEST_SEAM: "",
        BISELLIUM_W096_BOOTSTRAP_EXPECTED_BASE: fixture.baseline,
      },
      timeout: 30_000,
    },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
}

function bootstrapRecord(fixture: BootstrapFixture): string {
  return join(fixture.studio, "opera", "W-096.md");
}

function expectBootstrapRefusal(
  problems: string[],
  name: string,
  prepare: (fixture: BootstrapFixture) => void,
): void {
  const fixture = bootstrapFixture(name.replaceAll(" ", "-"));
  prepare(fixture);
  const before = readFileSync(bootstrapRecord(fixture), "utf8");
  const result = runBootstrap(fixture);
  const after = readFileSync(bootstrapRecord(fixture), "utf8");
  if (result.status === 0) problems.push(`bootstrap did not refuse: ${name}`);
  if (after !== before) problems.push(`bootstrap mutated the record after refusing: ${name}`);
}

if (runs(1)) {
  test("W-096 behaviour 1: native kinds are closed and branch creation pins the reviewed trunk", async () => {
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

    const bootstrapProblems: string[] = [];
    const positive = bootstrapFixture("positive");
    const positivePath = bootstrapRecord(positive);
    const positiveBeforeRaw = readFileSync(positivePath, "utf8");
    const positiveBefore = parseFrontMatter<Record<string, unknown>>(positiveBeforeRaw, positivePath);
    const positiveResult = runBootstrap(positive);
    const positiveAfterRaw = readFileSync(positivePath, "utf8");
    const positiveAfter = parseFrontMatter<Record<string, unknown>>(positiveAfterRaw, positivePath);
    const { baseline_commit: bootstrapPin, ...positiveAfterWithoutPin } = positiveAfter.data;
    if (positiveResult.status !== 0 || bootstrapPin !== positive.baseline)
      bootstrapProblems.push(`bootstrap did not pin: ${`${positiveResult.stdout}${positiveResult.stderr}`.trim() || "no result"}`);
    if (
      bootstrapPin === positive.baseline &&
      (JSON.stringify(positiveAfterWithoutPin) !== JSON.stringify(positiveBefore.data) || positiveAfter.body !== positiveBefore.body)
    ) bootstrapProblems.push("bootstrap changed more than baseline_commit");
    if (bootstrapPin === positive.baseline && git(positive.repo, ["status", "--porcelain"]) !== "M studio/opera/W-096.md")
      bootstrapProblems.push("bootstrap dirtied paths other than the W-096 record");
    if (bootstrapPin === positive.baseline) {
      commitAll(positive.repo, "test: commit one-time W-096 baseline bootstrap");
      const ordinaryCheck = checkStudio(positive.studio, NOW, { repo: positive.repo });
      if (!ordinaryCheck.ok)
        bootstrapProblems.push(`ordinary check rejected the bootstrap: ${JSON.stringify(ordinaryCheck.findings.filter((finding) => finding.level === "block"))}`);
      const verified = await captureAsync(() => runVerify(["W-096", "--studio", positive.studio, "--repo", positive.repo]));
      const sandboxRefusal = verified.value.exitCode === 2 && verified.errors.some((line) => /EPERM|operation not permitted/i.test(line));
      if (verified.value.exitCode !== 0 && !sandboxRefusal)
        bootstrapProblems.push(`ordinary verify rejected the bootstrap: exit ${verified.value.exitCode}: ${verified.errors.join("; ")}`);
    }

    const unguarded = bootstrapFixture("unguarded-override");
    const unguardedBefore = readFileSync(bootstrapRecord(unguarded), "utf8");
    const unguardedResult = runBootstrapWithoutTestSeam(unguarded);
    if (unguardedResult.status === 0 || readFileSync(bootstrapRecord(unguarded), "utf8") !== unguardedBefore)
      bootstrapProblems.push("bootstrap honoured the expected-base override without the explicit test seam");

    const preservationProblems: string[] = [];
    const missingRepo = checkStudio(positive.studio, NOW).findings.filter((finding) => finding.rule === "opus.records_unchanged");
    if (!missingRepo.some((finding) => finding.level === "block" && finding.message.includes("unverifiable")))
      preservationProblems.push("active owning record did not fail closed without --repo");

    git(unguarded.repo, ["switch", "-q", "master"]);
    const wrongRepo = checkStudio(positive.studio, NOW, { repo: unguarded.repo }).findings.filter(
      (finding) => finding.rule === "opus.records_unchanged",
    );
    if (!wrongRepo.some((finding) => finding.level === "block" && finding.message.includes("unverifiable")))
      preservationProblems.push("active owning record did not fail closed for the wrong repository identity");

    const shallow = bootstrapFixture("shallow-validation");
    const shallowRun = runBootstrap(shallow);
    if (shallowRun.status === 0) {
      commitAll(shallow.repo, "test: commit shallow fixture pin");
      writeFileSync(join(shallow.repo, ".git", "shallow"), `${shallow.baseline}\n`);
      const findings = checkStudio(shallow.studio, NOW, { repo: shallow.repo }).findings.filter(
        (finding) => finding.rule === "opus.records_unchanged",
      );
      if (!findings.some((finding) => finding.level === "block" && finding.message.includes("incomplete")))
        preservationProblems.push("shallow history did not fail closed as incomplete");
    } else preservationProblems.push(`could not prepare shallow validation fixture: ${shallowRun.stderr}`);

    const missingRef = bootstrapFixture("missing-trusted-ref");
    const missingRefRun = runBootstrap(missingRef);
    if (missingRefRun.status === 0) {
      commitAll(missingRef.repo, "test: commit missing-ref fixture pin");
      git(missingRef.repo, ["update-ref", "-d", "refs/remotes/origin/master"]);
      const findings = checkStudio(missingRef.studio, NOW, { repo: missingRef.repo }).findings.filter(
        (finding) => finding.rule === "opus.records_unchanged",
      );
      if (!findings.some((finding) => finding.level === "block" && finding.message.includes("unverifiable")))
        preservationProblems.push("an unresolvable trusted trunk ref did not fail closed as unverifiable");
    } else preservationProblems.push(`could not prepare missing-ref fixture: ${missingRefRun.stderr}`);

    const linked = bootstrapFixture("intervening-symlink");
    const linkedRun = runBootstrap(linked);
    if (linkedRun.status === 0) {
      commitAll(linked.repo, "test: commit intervening-symlink fixture pin");
      const sampleOpera = join(linked.repo, "examples", "sample-studio", "opera");
      const externalOpera = scratch("external-sample-opera");
      writeFileSync(join(externalOpera, "S-001.md"), readFileSync(join(sampleOpera, "S-001.md")));
      renameSync(sampleOpera, `${sampleOpera}.original`);
      symlinkSync(externalOpera, sampleOpera, "dir");
      const findings = checkStudio(linked.studio, NOW, { repo: linked.repo }).findings.filter(
        (finding) => finding.rule === "opus.records_unchanged",
      );
      if (!findings.some((finding) => finding.level === "block"))
        preservationProblems.push("an intervening symlinked protected opera directory passed preservation");
    } else preservationProblems.push(`could not prepare intervening-symlink fixture: ${linkedRun.stderr}`);

    const unrelated = bootstrapFixture("unrelated-branch");
    const unrelatedRun = runBootstrap(unrelated);
    if (unrelatedRun.status === 0) {
      commitAll(unrelated.repo, "test: commit unrelated-branch fixture pin");
      git(unrelated.repo, ["switch", "-qc", "feature/after-w096"]);
      const protectedPath = join(unrelated.studio, "opera", "W-095.md");
      writeFileSync(protectedPath, `${readFileSync(protectedPath, "utf8")}changed elsewhere\n`);
      const findings = checkStudio(unrelated.studio, NOW, { repo: unrelated.repo }).findings.filter(
        (finding) => finding.rule === "opus.records_unchanged",
      );
      if (findings.length !== 0)
        preservationProblems.push(`unrelated branch replayed W-096 preservation: ${JSON.stringify(findings)}`);
    } else preservationProblems.push(`could not prepare unrelated-branch fixture: ${unrelatedRun.stderr}`);

    const everyState = bootstrapFixture("all-pinned-states");
    const everyStateRun = runBootstrap(everyState);
    if (everyStateRun.status === 0) {
      commitAll(everyState.repo, "test: commit all-state preservation fixture pin");
      const path = bootstrapRecord(everyState);
      const original = readFileSync(path, "utf8");
      for (const state of ["backlog", "greenlit", "building", "verifying", "review", "halted", "done"]) {
        writeFileSync(path, original.replace("state: building", `state: ${state}`));
        const withoutRepo = checkStudio(everyState.studio, NOW).findings.filter((finding) => finding.rule === "opus.records_unchanged");
        if (!withoutRepo.some((finding) => finding.level === "block" && finding.message.includes("unverifiable")))
          preservationProblems.push(`pinned ${state} record failed open without repository context`);
        const owning = checkStudio(everyState.studio, NOW, { repo: everyState.repo }).findings.filter(
          (finding) => finding.rule === "opus.records_unchanged",
        );
        if (owning.length !== 0) preservationProblems.push(`unchanged pinned ${state} record failed on its owning branch: ${JSON.stringify(owning)}`);
      }
      writeFileSync(path, original.replace("state: building", "state: done"));
      git(everyState.repo, ["checkout", "--detach", "-q"]);
      const detached = checkStudio(everyState.studio, NOW, { repo: everyState.repo }).findings.filter(
        (finding) => finding.rule === "opus.records_unchanged",
      );
      if (!detached.some((finding) => finding.level === "block" && finding.message.includes("unverifiable")))
        preservationProblems.push("detached HEAD failed open for an inactive pinned record");
    } else preservationProblems.push(`could not prepare all-state preservation fixture: ${everyStateRun.stderr}`);

    expectBootstrapRefusal(bootstrapProblems, "wrong branch", (fixture) => {
      git(fixture.repo, ["switch", "-q", "-c", "not-the-owner"]);
    });
    expectBootstrapRefusal(bootstrapProblems, "wrong record", (fixture) => {
      const path = bootstrapRecord(fixture);
      writeFileSync(path, readFileSync(path, "utf8").replace('id: "W-096"', 'id: "W-097"'));
      commitAll(fixture.repo, "test: put the wrong record at the W-096 path");
    });
    expectBootstrapRefusal(bootstrapProblems, "dirty checkout", (fixture) => {
      writeFileSync(join(fixture.repo, "untracked.txt"), "dirty\n");
    });
    expectBootstrapRefusal(bootstrapProblems, "mismatched merge-base", (fixture) => {
      git(fixture.repo, ["update-ref", "refs/remotes/origin/master", "HEAD"]);
    });
    expectBootstrapRefusal(bootstrapProblems, "ambiguous merge-base", (fixture) => {
      const tree = git(fixture.repo, ["rev-parse", "HEAD^{tree}"]);
      const commitTree = (message: string, parents: string[]): string =>
        git(fixture.repo, ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message]);
      const left = commitTree("left", [fixture.baseline]);
      const right = commitTree("right", [fixture.baseline]);
      const head = commitTree("head merge", [left, right]);
      const trunk = commitTree("trunk merge", [right, left]);
      git(fixture.repo, ["reset", "-q", "--hard", head]);
      git(fixture.repo, ["update-ref", "refs/remotes/origin/master", trunk]);
      assert.equal(git(fixture.repo, ["merge-base", "--all", "HEAD", "origin/master"]).split("\n").length, 2);
    });
    expectBootstrapRefusal(bootstrapProblems, "unavailable refs", (fixture) => {
      git(fixture.repo, ["update-ref", "-d", "refs/remotes/origin/master"]);
    });
    expectBootstrapRefusal(bootstrapProblems, "unavailable history", (fixture) => {
      writeFileSync(join(fixture.repo, ".git", "shallow"), `${git(fixture.repo, ["rev-parse", "HEAD"])}\n`);
    });
    expectBootstrapRefusal(bootstrapProblems, "previous pin", (fixture) => {
      const path = bootstrapRecord(fixture);
      const original = readFileSync(path, "utf8");
      writeFileSync(path, original.replace('id: "W-096"\n', `id: "W-096"\nbaseline_commit: ${fixture.baseline}\n`));
      commitAll(fixture.repo, "test: introduce a historical pin");
      writeFileSync(path, original);
      commitAll(fixture.repo, "test: remove the historical pin");
    });
    expectBootstrapRefusal(bootstrapProblems, "present pin", (fixture) => {
      const path = bootstrapRecord(fixture);
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace('id: "W-096"\n', `id: "W-096"\nbaseline_commit: ${fixture.baseline}\n`),
      );
      commitAll(fixture.repo, "test: record an existing pin");
    });
    expectBootstrapRefusal(bootstrapProblems, "changed protected records", (fixture) => {
      const protectedPath = join(fixture.studio, "opera", "W-095.md");
      writeFileSync(protectedPath, `${readFileSync(protectedPath, "utf8")}changed\n`);
      commitAll(fixture.repo, "test: change a protected record");
    });

    const ordinary = bootstrapFixture("ordinary-duplicate");
    createOpusBranch(ordinary.repo, "W-096-ordinary");
    if (createOpusBranch(ordinary.repo, "W-096-ordinary").ok)
      bootstrapProblems.push("ordinary branch writer did not refuse its existing branch");

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
    assert.equal(bootstrapProblems.length, 0, bootstrapProblems.join("; "));
    assert.equal(preservationProblems.length, 0, preservationProblems.join("; "));
  });
}

if (runs(2)) {
  test("W-096 behaviour 2: building UI records require current substantive ui-lead input", () => {
    const root = scratch("b2-design-input");
    writeManifest(root, ['- { id: spec, name: Specification, kind: agent }']);
    writeFileSync(join(root, "briefs", "W-002.md"), "# W-002\n\n## Intent\n\nUI fixture.\n");
    writeOpus(root, "W-002", [
      'title: "UI work without design input"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "probationes: {}",
    ]);
    const before = readFileSync(join(root, "opera", "W-002.md"), "utf8");
    const designRule = rules(root, "W-002").includes("opus.ui.design");

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

    const readyRoot = scratch("b2-greenlit-ready-refusal");
    writeManifest(readyRoot, ['- { id: spec, name: Specification, kind: agent }']);
    writeFileSync(join(readyRoot, "briefs", "W-012.md"), "# W-012\n\nUI readiness fixture.\n");
    writeOpus(readyRoot, "W-012", [
      'title: "greenlit UI still requires ui-lead input"',
      "kind: ui",
      "collegium: design",
      "state: greenlit",
      "spec: briefs/W-012.md",
      'probationes: { spec: { status: passed, sella: architect, evidence: briefs/W-012.md } }',
    ]);
    const readyBefore = readFileSync(join(readyRoot, "opera", "W-012.md"), "utf8");
    const readyResult = capture(() => runReady(["W-012", "--sella", "architect", "--studio", readyRoot], { now: NOW }));

    const emptyPromptRoot = scratch("b2-empty-prompt-grammar");
    writeManifest(emptyPromptRoot);
    writeFileSync(join(emptyPromptRoot, "briefs", "W-013.md"), "# W-013\n\nEmpty prompt fixture.\n");
    writeOpus(emptyPromptRoot, "W-013", [
      'title: "empty prompt cannot skip transcript grammar"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "spec: briefs/W-013.md",
      "probationes: {}",
    ]);
    const headingOnly = [
      "## Findings",
      "No findings",
      "### Heading text masquerading as explanatory prose with many distinct tokens",
      "## Recommendation",
      "###### Another heading masquerading as recommendation prose with enough distinct tokens",
      "Verdict: passed",
      "",
    ].join("\n");
    writeUiInput(emptyPromptRoot, "W-013", 1, headingOnly, "");
    const emptyPromptRule = rules(emptyPromptRoot, "W-013").includes("opus.ui.design");

    const directHeadingProblems = substantiveUiTranscript(
      [
        "## Findings",
        "No findings",
        "### level three headings never count as explanatory transcript body",
        "#### level four headings never count as explanatory transcript body",
        "## Recommendation",
        "##### level five headings never count as explanatory transcript body",
        "###### level six headings never count as explanatory transcript body",
        "Verdict: passed",
      ].join("\n"),
      "passed",
      "unrelated retained prompt vocabulary remains deliberately separate from every heading in this test fixture",
    );
    const placeholderProblems = substantiveUiTranscript(
      [
        "## Findings",
        "1. This finding is pending and therefore cannot count as substantive evidence.",
        "A sufficiently long explanatory sentence accompanies the finding for grammar.",
        "## Recommendation",
        "Another sufficiently long explanatory sentence accompanies the recommendation.",
        "Verdict: passed",
      ].join("\n"),
      "passed",
      "unrelated retained prompt vocabulary remains deliberately separate from this placeholder fixture",
    );

    const copiedPrompt = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau";
    const sentenceSplit = comparePrompt("ALPHA beta gamma delta\nepsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau", copiedPrompt);
    const whitespaceChanged = comparePrompt("Alpha\tbeta  gamma\r\ndelta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau", copiedPrompt);
    const promptPadding = comparePrompt(`${copiedPrompt} original filler words one two three four five`, copiedPrompt);
    const unicodePrompt = "straße ſignal ﬁle I dotted İ dotless ı alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    const unicodeCaseChanged = comparePrompt(
      "STRASSE Signal FILE i dotted i\u0307 dotless ı ALPHA BETA GAMMA DELTA EPSILON ZETA ETA THETA IOTA KAPPA LAMBDA",
      unicodePrompt,
    );
    const boundaryWords = Array.from({ length: 23 }, (_, index) => `boundary${index + 1}`);
    const exactlyThirty = comparePrompt(boundaryWords.join(" "), boundaryWords.slice(0, 9).join(" "));
    const aboveThirty = comparePrompt(boundaryWords.join(" "), boundaryWords.slice(0, 10).join(" "));
    const elevenNovelWords = Array.from({ length: 17 }, (_, index) => `novel${index + 1}`);
    const twelveNovelWords = Array.from({ length: 18 }, (_, index) => `novel${index + 1}`);
    const elevenNovel = comparePrompt(elevenNovelWords.join(" "), elevenNovelWords.slice(0, 6).join(" "));
    const twelveNovel = comparePrompt(twelveNovelWords.join(" "), twelveNovelWords.slice(0, 6).join(" "));
    const token = (index: number): string => `token${String(index).padStart(2, "0")}`;
    const blocks = (count: number): string[][] => Array.from({ length: count / 6 }, (_, block) =>
      Array.from({ length: 6 }, (__, offset) => token(block * 6 + offset + 1)),
    );
    const rejectedBlocks = blocks(24);
    const rejectedReorder = comparePrompt([...rejectedBlocks].reverse().flat().join(" "), rejectedBlocks.flat().join(" "));
    const residualWords = Array.from({ length: 32 }, (_, index) => token(index + 1));
    const residualBlocks = Array.from({ length: 8 }, (_, block) => residualWords.slice(block * 4, block * 4 + 4));
    const passingResidual = comparePrompt([...residualBlocks].reverse().flat().join(" "), residualWords.join(" "));

    const staleBriefRoot = scratch("b2-stale-brief-digest");
    writeManifest(staleBriefRoot);
    writeFileSync(join(staleBriefRoot, "briefs", "W-014.md"), "# W-014\n\nOriginal brief bytes.\n");
    writeOpus(staleBriefRoot, "W-014", [
      'title: "digest freshness fixture"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "spec: briefs/W-014.md",
      "probationes: {}",
    ]);
    writeUiInput(staleBriefRoot, "W-014");
    writeFileSync(join(staleBriefRoot, "briefs", "W-014.md"), "# W-014\n\nOriginal brief bytes changed in place.\n");
    const staleBriefRule = rules(staleBriefRoot, "W-014").includes("opus.ui.design");

    const staleTitleRoot = scratch("b2-stale-title-digest");
    writeManifest(staleTitleRoot);
    writeFileSync(join(staleTitleRoot, "briefs", "W-015.md"), "# W-015\n\nStable brief bytes.\n");
    const staleTitlePath = writeOpus(staleTitleRoot, "W-015", [
      'title: "original title digest fixture"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "spec: briefs/W-015.md",
      "probationes: {}",
    ]);
    writeUiInput(staleTitleRoot, "W-015");
    writeFileSync(staleTitlePath, readFileSync(staleTitlePath, "utf8").replace("original title", "changed title"));
    const staleTitleRule = rules(staleTitleRoot, "W-015").includes("opus.ui.design");

    const unsafeEvidenceRoot = scratch("b2-nonfollowing-evidence");
    writeManifest(unsafeEvidenceRoot);
    writeFileSync(
      join(unsafeEvidenceRoot, "briefs", "W-096.md"),
      ["# W-096", "", "## Behaviours to test", "", ...Array.from({ length: 7 }, (_, index) => `${index + 1}. Fixture behaviour.`), ""].join("\n"),
    );
    writeOpus(unsafeEvidenceRoot, "W-096", [
      'title: "symlinked red evidence fixture"',
      "kind: opus",
      "collegium: engineering",
      "state: building",
      "spec: briefs/W-096.md",
      "probationes: {}",
    ]);
    const unsafeReds = join(unsafeEvidenceRoot, "ci", "reds", "W-096");
    mkdirSync(unsafeReds, { recursive: true });
    const outsideReds = scratch("outside-red-logs");
    for (let behaviour = 1; behaviour <= 7; behaviour++) {
      const outside = join(outsideReds, `${behaviour}.log`);
      writeFileSync(outside, assertionRed(behaviour));
      symlinkSync(outside, join(unsafeReds, `${String(behaviour).padStart(2, "0")}.log`));
    }
    const unsafeRedRule = checkStudio(unsafeEvidenceRoot, NOW).findings.some((finding) => finding.rule === "opus.red_assertion");

    const numberedPrompt = Array.from({ length: 9 }, (_, line) =>
      `${line + 1}. ${Array.from({ length: 4 }, (__, word) => `copied${line * 4 + word + 1}`).join(" ")}`,
    ).join("\n");
    const numberedTranscript = numberedPrompt.replace(/^[1-9][0-9]*\.\s+/gm, "");
    const symmetricNumberedPrefixes = comparePrompt(numberedTranscript, numberedPrompt);
    const setextHeadingProblems = substantiveUiTranscript(
      [
        "## Findings",
        "No findings",
        "This apparent explanation is actually a Setext heading and must never count.",
        "---",
        "## Recommendation",
        "This second apparent explanation is another Setext heading and must never count.",
        "===",
        "Verdict: passed",
      ].join("\n"),
      "passed",
      "unrelated retained prompt vocabulary deliberately remains separate from this grammar fixture",
    );
    const malformedFenceProblems = substantiveUiTranscript(
      [
        "## Findings",
        "No findings",
        "~~~text",
        "fenced content must never satisfy transcript content requirements here",
        "~~~not-a-close",
        "This apparent explanation remains fenced after a malformed close marker.",
        "## Recommendation",
        "This apparent recommendation also remains fenced and cannot count as evidence.",
        "Verdict: passed",
      ].join("\n"),
      "passed",
      "unrelated retained prompt vocabulary deliberately remains separate from this fence fixture",
    );

    const censorRoot = scratch("b2-sole-censor-writers");
    writeManifest(censorRoot);
    writeFileSync(join(censorRoot, "briefs", "W-020.md"), "# W-020\n\nSole censor fixture.\n");
    writeOpus(censorRoot, "W-020", [
      'title: "only the QA magister may write the UI build verdict"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "spec: briefs/W-020.md",
      "probationes: {}",
    ]);
    const censorInput = writeUiInput(censorRoot, "W-020");
    const disposition = Buffer.from("## UI input disposition\n\nThe censor considered the complete design input before reaching this result.\n");
    const wrongBuildVerdict = captureErrors(() => runVerdict(
      ["W-020", "--phase", "build", "--round", "1", "--sella", "eng-lead", "--outcome", "passed", "--ui-input", censorInput, "--studio", censorRoot],
      { now: NOW, stdin: disposition },
    ));
    const wrongBuildVerdictRefused =
      wrongBuildVerdict.value.exitCode !== 0 &&
      !existsSync(join(censorRoot, "ci", "W-020-review-1.log")) &&
      wrongBuildVerdict.errors.some((line) => /censor|qa-lead/i.test(line));
    const rightBuildVerdict = captureErrors(() => runVerdict(
      ["W-020", "--phase", "build", "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--ui-input", censorInput, "--studio", censorRoot],
      { now: NOW, stdin: disposition },
    ));

    const reviewAuthRoot = scratch("b2-sole-censor-review");
    writeManifest(reviewAuthRoot);
    writeOpus(reviewAuthRoot, "W-021", [
      'title: "only the QA magister may pass review"',
      "kind: task",
      "collegium: engineering",
      "state: building",
      "probationes: {}",
    ]);
    writeFileSync(join(reviewAuthRoot, "ci", "review.log"), "review evidence\n");
    const reviewAuthPath = join(reviewAuthRoot, "opera", "W-021.md");
    const reviewAuthBefore = readFileSync(reviewAuthPath, "utf8");
    const wrongReviewPass = captureErrors(() => runReview(
      ["W-021", "--pass", "--evidence", "ci/review.log", "--sella", "eng-lead", "--studio", reviewAuthRoot],
      { now: NOW },
    ));
    const wrongReviewPassRefused =
      wrongReviewPass.value.exitCode !== 0 &&
      readFileSync(reviewAuthPath, "utf8") === reviewAuthBefore &&
      wrongReviewPass.errors.some((line) => /censor|qa-lead/i.test(line));
    const rightReviewPass = captureErrors(() => runReview(
      ["W-021", "--pass", "--evidence", "ci/review.log", "--sella", "qa-lead", "--studio", reviewAuthRoot],
      { now: NOW },
    ));

    const citationProblems = (tag: string, gateSella: string, headerSella: string): string[] => {
      const citationRoot = scratch(`b2-citation-${tag}`);
      writeManifest(citationRoot);
      writeFileSync(join(citationRoot, "briefs", "W-022.md"), "# W-022\n\nCitation identity fixture.\n");
      const tree = "tree:2222222222222222222222222222222222222222";
      writeServedLog(citationRoot, tree);
      writeOpus(citationRoot, "W-022", [
        'title: "citation identities must both name the censor"',
        "kind: ui",
        "collegium: design",
        "state: building",
        "spec: briefs/W-022.md",
        "probationes:",
        ...servedLines(tree),
      ]);
      const input = writeUiInput(citationRoot, "W-022");
      const evidence = writeReviewEvidence(citationRoot, "W-022", input, "W-022-review.log");
      const evidencePath = join(citationRoot, evidence);
      if (headerSella !== "qa-lead") writeFileSync(evidencePath, readFileSync(evidencePath, "utf8").replace("# sella: qa-lead", `# sella: ${headerSella}`));
      const path = join(citationRoot, "opera", "W-022.md");
      writeFileSync(path, readFileSync(path, "utf8").replace(
        "probationes:\n",
        `probationes:\n  review:\n    status: passed\n    evidence: ${evidence}\n    sella: ${gateSella}\n    at: 2026-10-01T11:30:00.000Z\n`,
      ));
      return checkStudio(citationRoot, NOW).findings
        .filter((finding) => finding.where === "opera/W-022.md" && finding.rule === "opus.ui.design")
        .map((finding) => finding.message);
    };
    const wrongGateCitation = citationProblems("gate", "eng-lead", "qa-lead");
    const wrongHeaderCitation = citationProblems("header", "qa-lead", "eng-lead");

    assert.deepEqual(
      {
        unchanged: readFileSync(join(root, "opera", "W-002.md"), "utf8") === before,
        state: front(root, "W-002")["state"],
        designRule,
        assertionRule,
        greenlitReadyRefused: readyResult.exitCode !== 0 && readFileSync(join(readyRoot, "opera", "W-012.md"), "utf8") === readyBefore,
        emptyPromptRule,
        everyHeadingLevelExcluded: directHeadingProblems.some((problem) => problem.includes("four nonblank")) && directHeadingProblems.some((problem) => problem.includes("two explanatory")),
        placeholderRejected: placeholderProblems.some((problem) => problem.includes("placeholder")),
        sentenceSplitRejected: !sentenceSplit.accepted,
        whitespaceAndCaseRejected: !whitespaceChanged.accepted,
        promptPaddingRejected: !promptPadding.accepted,
        fullFoldExpansion: fullCaseFold("ß ẞ STRASSE ſ ﬁ I İ ı") === "ss ss strasse s fi i i\u0307 ı",
        greekRhoCasePair: fullCaseFold("ῥ") === fullCaseFold("Ῥ"),
        unicodeCaseChangedRejected: !unicodeCaseChanged.accepted,
        dotlessIRemainsDistinct: fullCaseFold("ı") !== fullCaseFold("I"),
        overlapAndNoveltyBoundaries: {
          exactlyThirty: exactlyThirty.accepted,
          aboveThirty: aboveThirty.accepted,
          elevenNovel: elevenNovel.accepted,
          twelveNovel: twelveNovel.accepted,
          empty: comparePrompt("", copiedPrompt).accepted,
          fewerThanFour: comparePrompt("one two three", copiedPrompt).accepted,
        },
        rejectedReorder,
        passingResidual,
        staleBriefRule,
        staleTitleRule,
        unsafeRedRule,
        symmetricNumberedPrefixes,
        setextHeadingsExcluded: setextHeadingProblems.some((problem) => problem.includes("four nonblank")) && setextHeadingProblems.some((problem) => problem.includes("two explanatory")),
        malformedFenceStaysOpen: malformedFenceProblems.length > 0,
        wrongBuildVerdictRefused,
        rightBuildVerdictAccepted: rightBuildVerdict.value.exitCode === 0,
        wrongReviewPassRefused,
        rightReviewPassAccepted: rightReviewPass.value.exitCode === 0,
        wrongGateCitation,
        wrongHeaderCitation,
      },
      {
        unchanged: true,
        state: "building",
        designRule: true,
        assertionRule: true,
        greenlitReadyRefused: true,
        emptyPromptRule: true,
        everyHeadingLevelExcluded: true,
        placeholderRejected: true,
        sentenceSplitRejected: true,
        whitespaceAndCaseRejected: true,
        promptPaddingRejected: true,
        fullFoldExpansion: true,
        greekRhoCasePair: true,
        unicodeCaseChangedRejected: true,
        dotlessIRemainsDistinct: true,
        overlapAndNoveltyBoundaries: {
          exactlyThirty: true,
          aboveThirty: false,
          elevenNovel: false,
          twelveNovel: true,
          empty: false,
          fewerThanFour: false,
        },
        rejectedReorder: { transcript: 21, prompt: 21, shared: 12, novel: 9, accepted: false },
        passingResidual: { transcript: 29, prompt: 29, shared: 8, novel: 21, accepted: true },
        staleBriefRule: true,
        staleTitleRule: true,
        unsafeRedRule: true,
        symmetricNumberedPrefixes: { transcript: 33, prompt: 33, shared: 33, novel: 0, accepted: false },
        setextHeadingsExcluded: true,
        malformedFenceStaysOpen: true,
        wrongBuildVerdictRefused: true,
        rightBuildVerdictAccepted: true,
        wrongReviewPassRefused: true,
        rightReviewPassAccepted: true,
        wrongGateCitation: ["review gate sella must be the censor qa-lead"],
        wrongHeaderCitation: ["review evidence header sella must be the censor qa-lead"],
      },
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

    const reviewRoot = scratch("b3-review-needs-served");
    writeManifest(reviewRoot);
    writeFileSync(join(reviewRoot, "briefs", "W-016.md"), "# W-016\n\nReview ordering fixture.\n");
    writeOpus(reviewRoot, "W-016", [
      'title: "review pass requires served evidence"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "spec: briefs/W-016.md",
      "probationes: {}",
    ]);
    const reviewInput = writeUiInput(reviewRoot, "W-016");
    const reviewEvidence = writeReviewEvidence(reviewRoot, "W-016", reviewInput, "W-016-review.log");
    const reviewBefore = readFileSync(join(reviewRoot, "opera", "W-016.md"), "utf8");
    const reviewWithoutServed = capture(() =>
      runReview(["W-016", "--pass", "--evidence", reviewEvidence, "--sella", "eng-lead", "--studio", reviewRoot], { now: NOW }),
    );

    const repo = scratch("b3-review-stale-source");
    git(repo, ["init", "-q", "-b", "master"]);
    git(repo, ["config", "user.name", "W-096 Test"]);
    git(repo, ["config", "user.email", "w096@example.invalid"]);
    const staleRoot = join(repo, "studio");
    writeManifest(staleRoot);
    writeFileSync(join(staleRoot, "briefs", "W-017.md"), "# W-017\n\nSource binding fixture.\n");
    const staleTree = "tree:1111111111111111111111111111111111111111";
    writeServedLog(staleRoot, staleTree);
    writeOpus(staleRoot, "W-017", [
      'title: "review pass requires current source binding"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "spec: briefs/W-017.md",
      "probationes:",
      ...servedLines(staleTree),
    ]);
    const staleInput = writeUiInput(staleRoot, "W-017");
    const staleReviewEvidence = writeReviewEvidence(staleRoot, "W-017", staleInput, "W-017-review.log");
    writeFileSync(join(repo, "source.txt"), "current source bytes\n");
    commitAll(repo, "test: current source for review binding");
    git(repo, ["switch", "-qc", "opus/W-017"]);
    const staleBefore = readFileSync(join(staleRoot, "opera", "W-017.md"), "utf8");
    const staleReview = capture(() =>
      runReview(["W-017", "--pass", "--evidence", staleReviewEvidence, "--sella", "eng-lead", "--studio", staleRoot], { now: NOW }),
    );

    const runServedSpy = (tag: string, failAt?: number): { status: number | null; calls: string[] } => {
      const spy = scratch(`b3-served-script-${tag}`);
      const calls = join(spy, "calls.log");
      const count = join(spy, "count");
      const npm = join(spy, "npm");
      writeFileSync(
        npm,
        [
          "#!/bin/sh",
          `count_file=${JSON.stringify(count)}`,
          `calls_file=${JSON.stringify(calls)}`,
          "n=0",
          "if [ -f \"$count_file\" ]; then n=$(sed -n '1p' \"$count_file\"); fi",
          "n=$((n + 1))",
          "printf '%s\\n' \"$n\" > \"$count_file\"",
          "printf '%s\\n' \"$*\" >> \"$calls_file\"",
          "if [ \"${SPY_FAIL_AT:-0}\" -eq \"$n\" ]; then exit ${SPY_FAIL_CODE:-7}; fi",
          "exit 0",
          "",
        ].join("\n"),
      );
      chmodSync(npm, 0o755);
      const result = spawnSync(process.execPath, [join(sourceRepo, "scripts", "served-e2e.mjs")], {
        cwd: sourceRepo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${spy}:${process.env["PATH"] ?? ""}`,
          SPY_FAIL_AT: String(failAt ?? 0),
          SPY_FAIL_CODE: failAt === 2 ? "9" : "7",
        },
      });
      return { status: result.status, calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [] };
    };
    const servedSuccess = runServedSpy("success");
    const servedBuildFailure = runServedSpy("build-failure", 1);
    const servedTestFailure = runServedSpy("test-failure", 2);

    assert.deepEqual(
      {
        exitCode: result.exitCode,
        unchanged: readFileSync(join(root, "opera", "W-003.md"), "utf8") === before,
        state: front(root, "W-003")["state"],
        e2eRule: rules(root, "W-003").includes("opus.ui.e2e"),
        reviewWithoutServedRefused:
          reviewWithoutServed.exitCode !== 0 && readFileSync(join(reviewRoot, "opera", "W-016.md"), "utf8") === reviewBefore,
        staleServedBindingRefused:
          staleReview.exitCode !== 0 && readFileSync(join(staleRoot, "opera", "W-017.md"), "utf8") === staleBefore,
        servedSuccess,
        servedBuildFailure,
        servedTestFailure,
      },
      {
        exitCode: 1,
        unchanged: true,
        state: "review",
        e2eRule: true,
        reviewWithoutServedRefused: true,
        staleServedBindingRefused: true,
        servedSuccess: {
          status: 0,
          calls: ["--workspace @bisellium/web run build", "--workspace @bisellium/web run test:serve"],
        },
        servedBuildFailure: { status: 7, calls: ["--workspace @bisellium/web run build"] },
        servedTestFailure: {
          status: 9,
          calls: ["--workspace @bisellium/web run build", "--workspace @bisellium/web run test:serve"],
        },
      },
    );
  });
}

if (runs(4)) {
  test("W-096 behaviour 4: done UI claims require a current scoped Patron ruling", () => {
    const root = scratch("b4-rulings");
    writeManifest(root, ['- { id: served-e2e, name: Served e2e, kind: automated, command: "node scripts/served-e2e.mjs" }']);
    writeFileSync(join(root, "ci", "served.log"), "served-e2e passed tree:1111111111111111111111111111111111111111\n");
    writeOpus(root, "W-004", [
      'title: "UI work without Patron rulings"',
      "kind: ui",
      "collegium: design",
      "state: done",
      "probationes:",
      "  served-e2e:",
      "    status: passed",
      "    evidence: ci/served.log",
      "    certifies: tree:1111111111111111111111111111111111111111",
    ]);
    const before = readFileSync(join(root, "opera", "W-004.md"), "utf8");
    const rulingRule = rules(root, "W-004").includes("opus.ui.rulings");

    const reviewRoot = scratch("b4-review-done-refusal");
    writeManifest(reviewRoot, ['- { id: served-e2e, name: Served e2e, kind: automated, command: "node scripts/served-e2e.mjs" }']);
    writeFileSync(join(reviewRoot, "briefs", "W-018.md"), "# W-018\n\nDone refusal fixture.\n");
    const tree = "tree:2222222222222222222222222222222222222222";
    writeServedLog(reviewRoot, tree);
    writeOpus(reviewRoot, "W-018", [
      'title: "review state still refuses done without rulings"',
      "kind: ui",
      "collegium: design",
      "state: review",
      "spec: briefs/W-018.md",
      "probationes:",
      ...servedLines(tree),
    ]);
    const input = writeUiInput(reviewRoot, "W-018");
    const reviewEvidence = writeReviewEvidence(reviewRoot, "W-018", input, "W-018-review.log");
    const reviewPath = join(reviewRoot, "opera", "W-018.md");
    writeFileSync(
      reviewPath,
      readFileSync(reviewPath, "utf8").replace(
        "probationes:\n",
        `probationes:\n  review:\n    status: passed\n    evidence: ${reviewEvidence}\n    sella: eng-lead\n    at: 2026-10-01T11:30:00.000Z\n`,
      ),
    );
    const reviewBefore = readFileSync(reviewPath, "utf8");
    const doneFromReview = capture(() => runDone(["W-018", "--sella", "eng-lead", "--studio", reviewRoot], { now: NOW }));

    const grammarRoot = scratch("b4-ruling-grammar");
    writeManifest(grammarRoot);
    mkdirSync(join(grammarRoot, "decisions"), { recursive: true });
    writeFileSync(join(grammarRoot, "briefs", "W-019.md"), "# W-019\n\nRuling grammar fixture.\n");
    writeOpus(grammarRoot, "W-019", [
      'title: "ruling front matter is structural"',
      "kind: ui",
      "collegium: design",
      "state: building",
      "spec: briefs/W-019.md",
      "ui_rulings: [D-900]",
      "probationes: {}",
    ]);
    writeUiInput(grammarRoot, "W-019");
    writeFileSync(
      join(grammarRoot, "decisions", "D-900.md"),
      [
        "---",
        "id: D-900",
        "by: patron",
        "by: impostor",
        "provenance: stated",
        "title: malformed duplicate-key ruling",
        "kill_when: design changes",
        "opus: W-019",
        `certifies: ${tree}`,
        `design_digest: ${designDigest(String(front(grammarRoot, "W-019")["title"]), readFileSync(join(grammarRoot, "briefs", "W-019.md")))}`,
        "at: 2026-10-01T11:45:00.000Z",
        "---",
        "Actual visual ruling body.",
        "",
      ].join("\n"),
    );
    const malformedRulingRule = rules(grammarRoot, "W-019").includes("opus.ui.rulings");

    const rulingCase = (
      tag: string,
      mutate: (root: string, digest: string, tree: string) => void,
      refs = "[D-901]",
    ): string[] => {
      const caseRoot = scratch(`b4-ruling-${tag}`);
      writeManifest(caseRoot);
      mkdirSync(join(caseRoot, "decisions"), { recursive: true });
      writeFileSync(join(caseRoot, "briefs", "W-023.md"), "# W-023\n\nComplete ruling grammar fixture.\n");
      const caseTree = "tree:3333333333333333333333333333333333333333";
      writeServedLog(caseRoot, caseTree);
      writeOpus(caseRoot, "W-023", [
        'title: "complete ruling grammar is enforced"',
        "kind: ui",
        "collegium: design",
        "state: done",
        "spec: briefs/W-023.md",
        `ui_rulings: ${refs}`,
        "probationes:",
        ...servedLines(caseTree),
      ]);
      const caseInput = writeUiInput(caseRoot, "W-023");
      const caseReview = writeReviewEvidence(caseRoot, "W-023", caseInput, "W-023-review.log");
      const casePath = join(caseRoot, "opera", "W-023.md");
      writeFileSync(casePath, readFileSync(casePath, "utf8").replace(
        "probationes:\n",
        `probationes:\n  review:\n    status: passed\n    evidence: ${caseReview}\n    sella: qa-lead\n    at: 2026-10-01T11:30:00.000Z\n`,
      ));
      const digest = designDigest(String(front(caseRoot, "W-023")["title"]), readFileSync(join(caseRoot, "briefs", "W-023.md")));
      mutate(caseRoot, digest, caseTree);
      return checkStudio(caseRoot, NOW).findings
        .filter((finding) => finding.where === "opera/W-023.md" && finding.rule === "opus.ui.rulings")
        .map((finding) => finding.message);
    };
    const decision = (overrides: string[] = [], body = "A concrete visual ruling for the current interface.\n"): string => [
      "---",
      "id: D-901",
      "by: patron",
      "provenance: stated",
      "title: Current visual ruling",
      "kill_when: the design or served source changes",
      "opus: W-023",
      "certifies: tree:3333333333333333333333333333333333333333",
      `design_digest: ${"DIGEST"}`,
      "at: 2026-10-01T11:45:00.000Z",
      ...overrides,
      "---",
      body,
    ].join("\n");
    const writeDecisionCase = (root: string, digest: string, text: string): void =>
      writeFileSync(join(root, "decisions", "D-901.md"), text.replace("DIGEST", digest));
    const deadRuling = rulingCase("dead", () => undefined);
    const emptyRuling = rulingCase("empty", (caseRoot, digest) => writeDecisionCase(caseRoot, digest, decision([], "")));
    const bodyOnlyRuling = rulingCase("body-only", (caseRoot, digest, caseTree) => writeDecisionCase(
      caseRoot,
      digest,
      `---\nid: D-901\nby: patron\nprovenance: stated\ntitle: Body pseudo-fields do not count\nkill_when: design changes\n---\nopus: W-023\ncertifies: ${caseTree}\ndesign_digest: ${digest}\nat: 2026-10-01T11:45:00.000Z\n`,
    ));
    const aliasRuling = rulingCase("alias", (caseRoot, digest) => writeDecisionCase(
      caseRoot,
      digest,
      decision(["alias_source: &actor patron", "by: *actor"]),
    ));
    const actorRuling = rulingCase("actor", (caseRoot, digest) => writeDecisionCase(caseRoot, digest, decision(["by: architect"])));
    const opusRuling = rulingCase("opus", (caseRoot, digest) => writeDecisionCase(caseRoot, digest, decision(["opus: W-999"])));
    const treeRuling = rulingCase("tree", (caseRoot, digest) => writeDecisionCase(caseRoot, digest, decision(["certifies: tree:4444444444444444444444444444444444444444"])));
    const earlyRuling = rulingCase("early", (caseRoot, digest) => writeDecisionCase(caseRoot, digest, decision(["at: 2026-10-01T11:00:00.000Z"])));
    const validRuling = rulingCase("valid", (caseRoot, digest) => writeDecisionCase(caseRoot, digest, decision()));

    assert.deepEqual(
      {
        unchanged: readFileSync(join(root, "opera", "W-004.md"), "utf8") === before,
        state: front(root, "W-004")["state"],
        rulingRule,
        reviewDoneRefused:
          doneFromReview.exitCode !== 0 && readFileSync(reviewPath, "utf8") === reviewBefore && front(reviewRoot, "W-018")["state"] === "review",
        malformedRulingRule,
        rulingGrammarMatrix: {
          dead: deadRuling.length > 0,
          empty: emptyRuling.length > 0,
          bodyOnly: bodyOnlyRuling.length > 0,
          alias: aliasRuling.length > 0,
          wrongActor: actorRuling.length > 0,
          wrongOpus: opusRuling.length > 0,
          wrongTree: treeRuling.length > 0,
          tooEarly: earlyRuling.length > 0,
          valid: validRuling,
        },
      },
      {
        unchanged: true,
        state: "done",
        rulingRule: true,
        reviewDoneRefused: true,
        malformedRulingRule: true,
        rulingGrammarMatrix: {
          dead: true,
          empty: true,
          bodyOnly: true,
          alias: true,
          wrongActor: true,
          wrongOpus: true,
          wrongTree: true,
          tooEarly: true,
          valid: [],
        },
      },
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

    writeOpus(root, "W-100", [
      'title: "first grouping arc"',
      "kind: arc",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ]);
    writeOpus(root, "W-101", [
      'title: "ordinary parent in the first arc"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "arc: W-100",
      "probationes: {}",
    ]);
    writeOpus(root, "W-102", [
      'title: "valid child inheriting its parent arc"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-101",
      "probationes: {}",
    ]);
    writeOpus(root, "W-103", [
      'title: "self parent"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-103",
      "probationes: {}",
    ]);
    writeOpus(root, "W-104", [
      'title: "nested subtask parent"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-102",
      "probationes: {}",
    ]);
    writeOpus(root, "W-105", [
      'title: "conflicting explicit child arc"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-101",
      "arc: W-999",
      "probationes: {}",
    ]);
    writeOpus(root, "W-106", [
      'title: "hostile parent id"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      'parent: "../W-101"',
      "probationes: {}",
    ]);
    const other = scratch("b5-cross-officina-parent");
    writeManifest(other);
    writeOpus(other, "W-999", [
      'title: "record that exists only in another officina"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ]);
    writeOpus(root, "W-107", [
      'title: "cross officina parent remains dangling locally"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-999",
      "probationes: {}",
    ]);
    writeOpus(root, "W-108", [
      'title: "first member of a forbidden parent cycle"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-109",
      "probationes: {}",
    ]);
    writeOpus(root, "W-109", [
      'title: "second member of a forbidden parent cycle"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-108",
      "probationes: {}",
    ]);

    const amendRoot = scratch("b5-amend-whole-graph");
    writeManifest(amendRoot);
    writeOpus(amendRoot, "W-200", ['title: "arc A"', "kind: arc", "collegium: engineering", "state: backlog", "probationes: {}"]);
    writeOpus(amendRoot, "W-201", ['title: "arc B"', "kind: arc", "collegium: engineering", "state: backlog", "probationes: {}"]);
    writeOpus(amendRoot, "W-202", [
      'title: "parent whose child pins arc A"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "arc: W-200",
      "probationes: {}",
    ]);
    writeOpus(amendRoot, "W-203", [
      'title: "child that would be invalidated by the parent amendment"',
      "kind: subtask",
      "collegium: engineering",
      "state: backlog",
      "parent: W-202",
      "arc: W-200",
      "probationes: {}",
    ]);
    const amendPath = join(amendRoot, "opera", "W-202.md");
    const amendBefore = readFileSync(amendPath, "utf8");
    const invalidatingAmend = captureErrors(() => runAmend(
      ["W-202", "--arc", "W-201", "--reason", "move the parent without moving its child", "--sella", "eng-lead", "--studio", amendRoot],
      { now: NOW },
    ));

    const writerRoot = scratch("b5-writer-hierarchy");
    writeManifest(writerRoot);
    const directMissingParent = capture(() => newItem(writerRoot, { kind: "subtask", collegium: "engineering", title: "direct missing parent" }));
    const cliMissingParent = capture(() => runNew(["--kind", "subtask", "--collegium", "engineering", "--title", "CLI missing parent", writerRoot]));

    const specCase = (
      tag: string,
      spec: string,
      prepare: (caseRoot: string) => void,
    ): { refused: boolean; unchanged: boolean; errors: string[] } => {
      const caseRoot = scratch(`b5-new-spec-${tag}`);
      writeManifest(caseRoot);
      prepare(caseRoot);
      const beforeInventory = inventory(caseRoot);
      const result = captureErrors(() => runNew([
        "--kind", "task", "--collegium", "engineering", "--title", `spec containment ${tag}`, "--spec", spec, caseRoot,
      ]));
      return {
        refused: result.value.exitCode !== 0,
        unchanged: JSON.stringify(inventory(caseRoot)) === JSON.stringify(beforeInventory),
        errors: result.errors,
      };
    };
    const missingSpec = specCase("missing", "briefs/missing.md", () => undefined);
    const directorySpec = specCase("directory", "briefs/directory.md", (caseRoot) => mkdirSync(join(caseRoot, "briefs", "directory.md")));
    const symlinkSpec = specCase("symlink-leaf", "briefs/link.md", (caseRoot) => {
      const outside = join(scratch("b5-new-spec-outside"), "outside.md");
      writeFileSync(outside, "outside brief\n");
      symlinkSync(outside, join(caseRoot, "briefs", "link.md"));
    });
    const intermediateSpec = specCase("symlink-directory", "briefs/linked/brief.md", (caseRoot) => {
      const outside = scratch("b5-new-spec-linked-directory");
      writeFileSync(join(outside, "brief.md"), "outside brief\n");
      symlinkSync(outside, join(caseRoot, "briefs", "linked"));
    });
    const wrongDirectorySpec = specCase("wrong-directory", "ci/not-a-brief.md", (caseRoot) => writeFileSync(join(caseRoot, "ci", "not-a-brief.md"), "not a brief\n"));

    const validSpecRoot = scratch("b5-new-spec-valid");
    writeManifest(validSpecRoot);
    writeFileSync(join(validSpecRoot, "briefs", "valid.md"), "# Valid brief\n");
    const validSpec = captureErrors(() => runNew([
      "--kind", "task", "--collegium", "engineering", "--title", "valid contained spec", "--spec", "briefs/valid.md", validSpecRoot,
    ]));
    const validCreated = readdirSync(join(validSpecRoot, "opera")).find((name) => name.endsWith(".md"));

    assert.deepEqual(
      {
        danglingArc: rules(root, "W-005").includes("opus.arc"),
        missingParent: rules(root, "W-006").includes("opus.parent"),
        validInheritedArc: rules(root, "W-102").filter((rule) => rule === "opus.arc" || rule === "opus.parent"),
        selfParent: rules(root, "W-103").includes("opus.parent"),
        nestedParent: rules(root, "W-104").includes("opus.parent"),
        conflictingArc: rules(root, "W-105").includes("opus.arc"),
        hostileParent: rules(root, "W-106").includes("opus.parent"),
        crossOfficinaParent: rules(root, "W-107").includes("opus.parent"),
        parentCycle: rules(root, "W-108").includes("opus.parent") && rules(root, "W-109").includes("opus.parent"),
        invalidatingAmendRefused:
          invalidatingAmend.value.exitCode !== 0 &&
          readFileSync(amendPath, "utf8") === amendBefore &&
          invalidatingAmend.errors.some((line) => /W-203|child|arc/i.test(line)),
        directMissingParentRefused: directMissingParent.ok === false,
        cliMissingParentRefused: cliMissingParent.exitCode !== 0,
        newSpecContainment: {
          missing: missingSpec.refused && missingSpec.unchanged,
          directory: directorySpec.refused && directorySpec.unchanged,
          symlinkLeaf: symlinkSpec.refused && symlinkSpec.unchanged,
          symlinkDirectory: intermediateSpec.refused && intermediateSpec.unchanged,
          wrongDirectory: wrongDirectorySpec.refused && wrongDirectorySpec.unchanged,
          valid:
            validSpec.value.exitCode === 0 &&
            validCreated !== undefined &&
            front(validSpecRoot, validCreated.slice(0, -3))["spec"] === "briefs/valid.md",
        },
      },
      {
        danglingArc: true,
        missingParent: true,
        validInheritedArc: [],
        selfParent: true,
        nestedParent: true,
        conflictingArc: true,
        hostileParent: true,
        crossOfficinaParent: true,
        parentCycle: true,
        invalidatingAmendRefused: true,
        directMissingParentRefused: true,
        cliMissingParentRefused: true,
        newSpecContainment: {
          missing: true,
          directory: true,
          symlinkLeaf: true,
          symlinkDirectory: true,
          wrongDirectory: true,
          valid: true,
        },
      },
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

    const acceptedDates = [
      "0001-01-01T00:00:00Z",
      "2000-02-29T23:59:59.999Z",
      "2024-02-29T12:34:56Z",
      "9999-12-31T23:59:59.000Z",
    ];
    const rejectedDates = [
      "0000-01-01T00:00:00Z",
      "1900-02-29T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T23:60:00Z",
      "2026-01-01T23:59:60Z",
      "2026-01-01T00:00:00+00:00",
      "2026-01-01T00:00:00-00:00",
      "2026-01-01t00:00:00z",
      "2026-01-01T00:00Z",
      "2026-01-01T00:00:00.1Z",
      "2026-01-01T00:00:00.12Z",
      "2026-01-01T00:00:00.1234Z",
      "2026-01-01",
    ];
    const dateRoot = scratch("b6-date-profile");
    writeManifest(dateRoot);
    acceptedDates.forEach((value, index) => writeOpus(dateRoot, `W-${String(300 + index)}`, [
      `title: "accepted date ${index}"`,
      "kind: task",
      "collegium: engineering",
      "state: building",
      `${index % 2 === 0 ? "start" : "start"}: ${index % 2 === 0 ? value : JSON.stringify(value)}`,
      "probationes: {}",
    ]));
    rejectedDates.forEach((value, index) => writeOpus(dateRoot, `W-${String(400 + index)}`, [
      `title: "rejected date ${index}"`,
      "kind: task",
      "collegium: engineering",
      "state: building",
      `start: ${JSON.stringify(value)}`,
      "probationes: {}",
    ]));
    writeOpus(dateRoot, "W-500", [
      'title: "end precedes start"',
      "kind: task",
      "collegium: engineering",
      "state: done",
      "start: 2026-10-02T00:00:00.000Z",
      "end: 2026-10-01T00:00:00.000Z",
      "probationes: {}",
    ]);
    writeOpus(dateRoot, "W-501", [
      'title: "end is forbidden before done"',
      "kind: task",
      "collegium: engineering",
      "state: building",
      "end: 2026-10-01T00:00:00.000Z",
      "probationes: {}",
    ]);

    const badNowRoot = scratch("b6-malformed-now");
    writeManifest(badNowRoot);
    writeFileSync(join(badNowRoot, "briefs", "W-510.md"), "# W-510\n");
    writeOpus(badNowRoot, "W-510", [
      'title: "malformed now must not mutate"',
      "kind: task",
      "collegium: engineering",
      "state: greenlit",
      "probationes: {}",
    ]);
    const badNowPath = join(badNowRoot, "opera", "W-510.md");
    const badNowBefore = readFileSync(badNowPath, "utf8");
    const badNow = capture(() => runReady([
      "W-510", "--sella", "eng-lead", "--studio", badNowRoot, "--now", "2026-10-01T24:00:00Z",
    ]));

    const haltRoot = scratch("b6-halt-resume-reopen");
    writeManifest(haltRoot);
    mkdirSync(join(haltRoot, "decisions"), { recursive: true });
    writeFileSync(join(haltRoot, "briefs", "W-520.md"), "# W-520\n");
    writeFileSync(join(haltRoot, "decisions", "D-900.md"), "# D-900\n\nResume fixture decision.\n");
    writeFileSync(join(haltRoot, "ci", "review-fail.log"), "review failure evidence\n");
    writeOpus(haltRoot, "W-520", [
      'title: "halt resume and redo preserve transition facts"',
      "kind: task",
      "collegium: engineering",
      "state: greenlit",
      "probationes: {}",
    ]);
    const firstStart = new Date("2026-10-01T14:00:00.000Z");
    const resumedAt = new Date("2026-10-01T15:00:00.000Z");
    const firstEnd = new Date("2026-10-01T16:00:00.000Z");
    const secondEnd = new Date("2026-10-01T18:00:00.000Z");
    const firstReady = capture(() => runReady(["W-520", "--sella", "eng-lead", "--studio", haltRoot], { now: firstStart }));
    const halted = capture(() => runHalt([
      "W-520", "--reason", "fixture pause", "--resume-when", "fixture resumes", "--decision", "D-900", "--sella", "eng-lead", "--studio", haltRoot,
    ], { now: new Date("2026-10-01T14:30:00.000Z") }));
    const resumed = capture(() => runReady(["W-520", "--sella", "eng-lead", "--studio", haltRoot], { now: resumedAt }));
    const firstDone = capture(() => runDone(["W-520", "--sella", "eng-lead", "--studio", haltRoot], { now: firstEnd }));
    const reopened = capture(() => runReview([
      "W-520", "--fail", "--evidence", "ci/review-fail.log", "--sella", "qa-lead", "--studio", haltRoot,
    ], { now: new Date("2026-10-01T17:00:00.000Z") }));
    const afterReopen = front(haltRoot, "W-520");
    const redone = capture(() => runDone(["W-520", "--sella", "eng-lead", "--studio", haltRoot], { now: secondEnd }));
    const afterRedo = front(haltRoot, "W-520");

    assert.deepEqual(
      {
        ready: ready.exitCode,
        done: done.exitCode,
        state: data["state"],
        start: data["start"],
        end: data["end"],
        dateProfile: {
          accepted: acceptedDates.map((value) => utcTimestampProblem(value)),
          rejected: rejectedDates.map((value) => utcTimestampProblem(value) !== undefined),
          acceptedDisk: acceptedDates.map((__, index) => rules(dateRoot, `W-${String(300 + index)}`).includes("opus.dates")),
          rejectedDisk: rejectedDates.map((__, index) => rules(dateRoot, `W-${String(400 + index)}`).includes("opus.dates")),
          ordering: rules(dateRoot, "W-500").includes("opus.dates.order"),
          endBeforeDone: rules(dateRoot, "W-501").includes("opus.dates"),
        },
        malformedNowRefused: badNow.exitCode !== 0 && readFileSync(badNowPath, "utf8") === badNowBefore,
        haltResumeReopenRedo: {
          exits: [firstReady.exitCode, halted.exitCode, resumed.exitCode, firstDone.exitCode, reopened.exitCode, redone.exitCode],
          startAfterReopen: afterReopen["start"],
          endAfterReopen: afterReopen["end"],
          stateAfterReopen: afterReopen["state"],
          startAfterRedo: afterRedo["start"],
          endAfterRedo: afterRedo["end"],
          stateAfterRedo: afterRedo["state"],
        },
      },
      {
        ready: 0,
        done: 0,
        state: "done",
        start: started.toISOString(),
        end: ended.toISOString(),
        dateProfile: {
          accepted: acceptedDates.map(() => undefined),
          rejected: rejectedDates.map(() => true),
          acceptedDisk: acceptedDates.map(() => false),
          rejectedDisk: rejectedDates.map(() => true),
          ordering: true,
          endBeforeDone: true,
        },
        malformedNowRefused: true,
        haltResumeReopenRedo: {
          exits: [0, 0, 0, 0, 0, 0],
          startAfterReopen: firstStart.toISOString(),
          endAfterReopen: undefined,
          stateAfterReopen: "building",
          startAfterRedo: firstStart.toISOString(),
          endAfterRedo: secondEnd.toISOString(),
          stateAfterRedo: "done",
        },
      },
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

    const range = (start: number, end = start): number[] => Array.from({ length: end - start + 1 }, (__, index) => start + index);
    const forbiddenCodePoints = [
      ...range(0x0000, 0x001f),
      ...range(0x007f, 0x009f),
      ...range(0x2028, 0x2029),
      ...range(0x00ad),
      ...range(0x0600, 0x0605),
      ...range(0x061c),
      ...range(0x06dd),
      ...range(0x070f),
      ...range(0x0890, 0x0891),
      ...range(0x08e2),
      ...range(0x180e),
      ...range(0x200b, 0x200f),
      ...range(0x202a, 0x202e),
      ...range(0x2060, 0x2064),
      ...range(0x2066, 0x206f),
      ...range(0xfeff),
      ...range(0xfff9, 0xfffb),
      ...range(0x110bd),
      ...range(0x110cd),
      ...range(0x13430, 0x1343f),
      ...range(0x1bca0, 0x1bca3),
      ...range(0x1d173, 0x1d17a),
      ...range(0xe0001),
      ...range(0xe0020, 0xe007f),
    ];
    const controlsRoot = scratch("b7-complete-control-set");
    writeManifest(controlsRoot);
    forbiddenCodePoints.forEach((codePoint, index) => writeOpus(controlsRoot, `W-${String(600 + index)}`, [
      `title: ${JSON.stringify(`before${String.fromCodePoint(codePoint)}after`)}`,
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ]));
    const diskControlsRejected = forbiddenCodePoints.every((__, index) => rules(controlsRoot, `W-${String(600 + index)}`).includes("opus.title"));

    const writerRoot = scratch("b7-complete-writer-controls");
    writeManifest(writerRoot);
    writeOpus(writerRoot, "W-900", [
      'title: "writer control target"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ], "Writer target body remains unchanged.\n");
    const writerTarget = join(writerRoot, "opera", "W-900.md");
    const writerTargetBefore = readFileSync(writerTarget);
    const directControlsRejected = forbiddenCodePoints.every((codePoint) =>
      capture(() => newItem(writerRoot, { kind: "task", collegium: "engineering", title: `before${String.fromCodePoint(codePoint)}after` })).ok === false,
    );
    const cliControlsRejected = forbiddenCodePoints.every((codePoint) =>
      capture(() => runNew(["--kind", "task", "--collegium", "engineering", "--title", `before${String.fromCodePoint(codePoint)}after`, writerRoot])).exitCode !== 0,
    );
    const amendControlsRejected = forbiddenCodePoints.every((codePoint) =>
      capture(() => runAmend([
        "W-900", "--title", `before${String.fromCodePoint(codePoint)}after`, "--reason", "complete control set", "--sella", "eng-lead", "--studio", writerRoot,
      ], { now: NOW })).exitCode !== 0,
    );

    const preserveRoot = scratch("b7-body-byte-preservation");
    writeManifest(preserveRoot);
    const preservePath = join(preserveRoot, "opera", "W-910.md");
    const preservedBody = Buffer.from("\ufeffFirst body line with BOM and CRLF.\r\n\r\n<div>literal HTML remains byte-identical</div>\r\n", "utf8");
    const preserveHeader = Buffer.from(
      "---\nid: W-910\ntitle: body preservation target\nkind: task\ncollegium: engineering\nstate: backlog\nprobationes: {}\n---\n",
      "utf8",
    );
    writeFileSync(preservePath, Buffer.concat([preserveHeader, preservedBody]));
    const preserveAmend = capture(() => runAmend([
      "W-910", "--title", "ordinary Unicode café 東京 remains verbatim", "--reason", "metadata-only amendment", "--sella", "eng-lead", "--studio", preserveRoot,
    ], { now: NOW }));
    const preserveAfter = readFileSync(preservePath);
    const emptyDescriptionPath = writeOpus(preserveRoot, "W-911", [
      'title: "empty description remains legal"',
      "kind: task",
      "collegium: engineering",
      "state: backlog",
      "probationes: {}",
    ], "");
    const preservedFront = front(preserveRoot, "W-910");

    assert.deepEqual(
      {
        diskTitleRule: rules(root, "W-008").includes("opus.title"),
        newItemRefused: direct.ok === false,
        runNewRefused: cli.exitCode !== 0,
        amendRefused: amend.exitCode !== 0,
        creationInventoryUnchanged: JSON.stringify(after) === JSON.stringify(before),
        amendBytesUnchanged: readFileSync(join(root, "opera", "W-009.md"), "utf8") === amendBefore,
        completeControlSet: {
          count: forbiddenCodePoints.length,
          directFunction: forbiddenCodePoints.every((codePoint) => titleProblem(`before${String.fromCodePoint(codePoint)}after`) !== undefined),
          disk: diskControlsRejected,
          newItem: directControlsRejected,
          runNew: cliControlsRejected,
          amend: amendControlsRejected,
          writerBytesUnchanged: readFileSync(writerTarget).equals(writerTargetBefore),
        },
        bodyPreservation: {
          amended: preserveAmend.exitCode,
          exactSuffix: preserveAfter.subarray(preserveAfter.length - preservedBody.length).equals(preservedBody),
          title: preservedFront["title"],
          noSummary: !("summary" in preservedFront),
          noDescription: !("description" in preservedFront),
          emptyDescriptionLegal: !rules(preserveRoot, "W-911").includes("opus.title") && readFileSync(emptyDescriptionPath).subarray(-1).equals(Buffer.from("\n")),
        },
      },
      {
        diskTitleRule: true,
        newItemRefused: true,
        runNewRefused: true,
        amendRefused: true,
        creationInventoryUnchanged: true,
        amendBytesUnchanged: true,
        completeControlSet: {
          count: forbiddenCodePoints.length,
          directFunction: true,
          disk: true,
          newItem: true,
          runNew: true,
          amend: true,
          writerBytesUnchanged: true,
        },
        bodyPreservation: {
          amended: 0,
          exactSuffix: true,
          title: "ordinary Unicode café 東京 remains verbatim",
          noSummary: true,
          noDescription: true,
          emptyDescriptionLegal: true,
        },
      },
    );
  });
}
