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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { parseFrontMatter, readFront } from "@bisellium/adapter-native";
import { checkStudio } from "./check.js";
import { createOpusBranch, runBranch } from "./branch.js";
import { runReady, runDone, runAmend, runReview } from "./lifecycle.js";
import { newItem, runNew } from "./new.js";
import { runVerify } from "./verify.js";
import {
  comparePrompt,
  designDigest,
  fullCaseFold,
  substantiveUiTranscript,
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
      },
      {
        exitCode: 1,
        unchanged: true,
        state: "review",
        e2eRule: true,
        reviewWithoutServedRefused: true,
        staleServedBindingRefused: true,
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

    assert.deepEqual(
      {
        unchanged: readFileSync(join(root, "opera", "W-004.md"), "utf8") === before,
        state: front(root, "W-004")["state"],
        rulingRule,
        reviewDoneRefused:
          doneFromReview.exitCode !== 0 && readFileSync(reviewPath, "utf8") === reviewBefore && front(reviewRoot, "W-018")["state"] === "review",
        malformedRulingRule,
      },
      { unchanged: true, state: "done", rulingRule: true, reviewDoneRefused: true, malformedRulingRule: true },
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
