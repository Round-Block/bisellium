/**
 * packages/cli/src/rules/evidence.test.ts — W-022: evidence content rules
 * (P-005), and W-084: brief Behaviour-N citations.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkStudio } from "../check.js";
import { checkEvidence, isDuplicateRed, isModuleLoadFailure, isW096AssertionRed } from "./evidence.js";
import { RULE_IDS } from "./ids.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

function skip(behaviour: number, name: string, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`SKIP  ${name.padEnd(60)} ${detail}`);
}

const dirs: string[] = [];
function freshOfficina(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-evidence-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "bisellium.yml"), "bisellium: 1\nstudio: fixture\ncollegia: []\nsellae: []\nprobationes: []\n");
  mkdirSync(join(dir, "briefs"), { recursive: true });
  return dir;
}

function brief(body: string, count = 3): string {
  const behaviours = Array.from({ length: count }, (_, i) => `${i + 1}. Fixture row ${i + 1}.`).join("\n");
  return ["# Fixture", "", body, "", "## Behaviours to test", "", behaviours, ""].join("\n");
}

const citationFindings = (root: string) =>
  checkEvidence(root, { now: new Date("2026-09-25T12:00:00Z") }).filter((f) => f.rule === "brief.behaviour_citation");

// W-022 behaviour 1: identical bodies after header strip are duplicates
{
  const a = "# exit: 1\n# tree: abc\nFAIL  some assertion\n";
  const b = "# exit: 1\n# tree: def\nFAIL  some assertion\n";
  check(1, "same body after header = duplicate", isDuplicateRed(a, b) === true, String(isDuplicateRed(a, b)));
}

// W-022 behaviour 2: different bodies are not duplicates
{
  const a = "# exit: 1\nFAIL  assertion one\n";
  const b = "# exit: 1\nFAIL  assertion two\n";
  check(2, "different body = not duplicate", isDuplicateRed(a, b) === false, String(isDuplicateRed(a, b)));
}

// W-022 behaviour 3: ERR_MODULE_NOT_FOUND is a module load failure
{
  const body = "# exit: 1\nError [ERR_MODULE_NOT_FOUND]: Cannot find module './branch.js'\n    at finalizeResolution\n";
  check(3, "ERR_MODULE_NOT_FOUND detected", isModuleLoadFailure(body) === true, String(isModuleLoadFailure(body)));
}

// W-022 behaviour 4: SyntaxError import is a module load failure
{
  const body = "# exit: 1\nSyntaxError: The requested module './process.js' does not provide an export named 'checkpointStale'\n";
  check(4, "import SyntaxError detected", isModuleLoadFailure(body) === true, String(isModuleLoadFailure(body)));
}

// W-022 behaviour 5: real assertion failure is not a module load failure
{
  const body = "# exit: 1\nFAIL  opusBranchName('W-026') === 'opus/W-026'\n";
  check(5, "assertion failure not flagged", isModuleLoadFailure(body) === false, String(isModuleLoadFailure(body)));
}

// W-022 behaviour 6: empty body is not a module load failure
{
  check(6, "empty body not flagged", isModuleLoadFailure("") === false, String(isModuleLoadFailure("")));
}

// W-096 supplementary assertion-level TAP parser regression.
{
  const valid = [
    "# behaviour: 2",
    "# command: node --test-reporter=tap fixture.test.ts --behaviour 2",
    "# exit: 1",
    "",
    "TAP version 13",
    "not ok 1 - W-096 behaviour 2: fixture",
    "  ---",
    "  code: 'ERR_ASSERTION'",
    "  ...",
    "1..1",
    "# tests 1",
    "# pass 0",
    "# fail 1",
    "",
  ].join("\n");
  check(10, "W-096 completed selected TAP assertion is accepted", isW096AssertionRed(valid, 2));
  const noAssertionCode = valid.replace("  code: 'ERR_ASSERTION'", "  code: 'E_FIXTURE'");
  const multipleTests = valid
    .replace("1..1", "not ok 2 - W-096 behaviour 2: second fixture\n  ---\n  code: 'ERR_ASSERTION'\n  ...\n1..2")
    .replace("# tests 1", "# tests 2")
    .replace("# fail 1", "# fail 2");
  const planMismatch = valid.replace("1..1", "1..2");
  const moduleLoad = `${valid}\nError [ERR_MODULE_NOT_FOUND]: Cannot find module './fixture.js'\n`;
  check(10, "W-096 TAP without ERR_ASSERTION is rejected", !isW096AssertionRed(noAssertionCode, 2));
  check(10, "W-096 multiple-test TAP is rejected", !isW096AssertionRed(multipleTests, 2));
  check(10, "W-096 plan mismatch is rejected", !isW096AssertionRed(planMismatch, 2));
  check(10, "W-096 module-load text cannot masquerade as an assertion red", !isW096AssertionRed(moduleLoad, 2));
}

if (only === 10) {
  for (const root of dirs.reverse()) rmSync(root, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

// W-084 occupies selector rows 7-9 so a focused command does not also run a
// legacy W-022 row. The unfiltered suite still runs everything.
const w084Only = only !== undefined && only >= 7 && only <= 9 ? only : undefined;
function checkW084(behaviour: number, name: string, ok: boolean, detail = "") {
  if (w084Only !== undefined && w084Only !== behaviour) return;
  if (only !== undefined && w084Only === undefined) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

try {
  // W-084 behaviour 1: only the out-of-range self-citation blocks, naming
  // both the cited number and this same brief's declared count.
  {
    const dir = freshOfficina("w084-range");
    writeFileSync(join(dir, "briefs", "out.md"), brief("Behaviour 7 is stale."));
    writeFileSync(join(dir, "briefs", "in.md"), brief("Behaviour 3 is valid."));
    writeFileSync(join(dir, "briefs", "none.md"), "# No numbered behaviours\n\nBehaviour 1 is prose.\n");
    const findings = citationFindings(dir);
    checkW084(
      7,
      "out-of-range citation blocks once and names both numbers",
      findings.length === 1 &&
        findings[0]!.level === "block" &&
        findings[0]!.where === "briefs/out.md" &&
        findings[0]!.message.includes("Behaviour 7") &&
        findings[0]!.message.includes("3 behaviours"),
      JSON.stringify(findings),
    );
  }

  // W-084 behaviour 2: all seven real false-positive shapes are silent, the
  // id exists (so this cannot pass vacuously before implementation), and one
  // unreadable or non-regular .md entry does not abort the rest of the
  // crawl. The FIFO has a writer so a broken implementation fails instead
  // of hanging this test; the writer is killed when the fixed rule skips it.
  {
    const dir = freshOfficina("w084-exclusions");
    const briefsDir = join(dir, "briefs");
    writeFileSync(
      join(dir, "briefs", "constructs.md"),
      brief(
        [
          "| construct | example |",
          "|---|---|",
          "| cross-opus | W-028's behaviours 22-24 |",
          "| partition | behaviours 1-5 |",
          "| refusal | W-999 |",
          '| heading | see "Running talk" |',
          "",
          "```text",
          "Behaviour 9",
          "```",
          "",
          'Historical "Behaviour 13" was fixed.',
          "The literal `Behaviour 9` is fixture text.",
        ].join("\n"),
      ),
    );
    mkdirSync(join(briefsDir, "00-unreadable.md"));
    const outside = join(dir, "outside.md");
    writeFileSync(outside, brief("Behaviour 97 is stale."));
    symlinkSync(outside, join(briefsDir, "01-symlink.md"));
    const fifo = join(briefsDir, "02-fifo.md");
    let fifoAvailable = true;
    let fifoSkipDetail = "";
    try {
      execFileSync("mkfifo", [fifo]);
    } catch (e) {
      // The managed sandbox can return EPERM after creating the FIFO.
      fifoAvailable = existsSync(fifo);
      if (!fifoAvailable) fifoSkipDetail = (e as Error).message;
    }
    if (!fifoAvailable) skip(8, "FIFO citation-crawl row unavailable in sandbox", fifoSkipDetail);
    writeFileSync(join(briefsDir, "zz-later.md"), brief("Behaviour 99 is stale."));
    const fifoWriter = fifoAvailable
      ? spawn(process.execPath, ["-e", "require('node:fs').writeFileSync(process.argv[1], process.argv[2])", fifo, brief("Behaviour 98 is stale.")])
      : undefined;
    let findings: ReturnType<typeof citationFindings> = [];
    let threw = false;
    try {
      findings = citationFindings(dir);
    } catch {
      threw = true;
    } finally {
      fifoWriter?.kill("SIGKILL");
    }
    checkW084(8, "brief.behaviour_citation is registered", RULE_IDS.has("brief.behaviour_citation"));
    checkW084(
      8,
      "unreadable, symlink, and FIFO briefs are skipped; later brief is reached",
      !threw &&
        findings.length === 1 &&
        findings[0]!.where === "briefs/zz-later.md" &&
        findings[0]!.message.includes("Behaviour 99"),
      JSON.stringify(findings),
    );

    const pathological = freshOfficina("w084-pathological");
    writeFileSync(join(pathological, "briefs", "plain.md"), brief(`a${"`".repeat(10_000)} Behaviour 99`));
    writeFileSync(
      join(pathological, "briefs", "quadratic.md"),
      brief(`a${"`".repeat(150_000)}${"x".repeat(150_000)} Behaviour 98`),
    );
    const started = performance.now();
    const pathologicalFindings = citationFindings(pathological);
    const elapsed = performance.now() - started;
    checkW084(
      8,
      "10k backticks and the quadratic shape complete in bounded time",
      elapsed < 200 &&
        pathologicalFindings.length === 2 &&
        pathologicalFindings.some((f) => f.message.includes("Behaviour 98")) &&
        pathologicalFindings.some((f) => f.message.includes("Behaviour 99")),
      `${elapsed.toFixed(1)}ms ${JSON.stringify(pathologicalFindings)}`,
    );
  }

  // W-084 behaviour 3: the positive control is deliberately unreferenced by
  // any opus. Finding it proves an all-brief crawl rather than reuse of the
  // ACTIVE-opus/spec walk in opus.red_evidence.
  {
    const dir = freshOfficina("w084-unreferenced");
    writeFileSync(join(dir, "briefs", "orphan.md"), brief("Behaviour 99 is stale."));
    const found = checkStudio(dir, new Date("2026-09-25T12:00:00Z")).findings.filter(
      (f) => f.rule === "brief.behaviour_citation",
    );
    checkW084(
      9,
      "unreferenced brief is reached by checkStudio",
      found.length === 1 && found[0]!.where === "briefs/orphan.md" && found[0]!.message.includes("Behaviour 99"),
      JSON.stringify(found),
    );

    const real = checkStudio(resolve(process.argv[2] ?? ".", "studio"), new Date("2026-09-25T12:00:00Z")).findings.filter(
      (f) => f.rule === "brief.behaviour_citation",
    );
    checkW084(9, "real brief corpus has no out-of-range citation", real.length === 0, JSON.stringify(real));
  }


  // W-096 pinned-baseline rule: the command-produced first pin is clean,
  // then a one-byte working-tree change to a protected record blocks.
  {
    const repo = mkdtempSync(join(tmpdir(), "bisellium-evidence-w096-git-"));
    dirs.push(repo);
    const root = join(repo, "studio");
    mkdirSync(join(root, "opera"), { recursive: true });
    mkdirSync(join(root, "ci", "reds", "W-096"), { recursive: true });
    writeFileSync(join(root, "bisellium.yml"), "bisellium: 1\nstudio: fixture\ncollegia: []\nsellae: []\nprobationes: []\n");
    writeFileSync(join(root, "opera", "W-095.md"), "---\nid: W-095\ntitle: protected\nkind: task\ncollegium: engineering\nstate: backlog\nprobationes: {}\n---\n");
    writeFileSync(join(root, "opera", "W-096.md"), "---\nid: W-096\ntitle: fixture\nkind: opus\ncollegium: engineering\nstate: building\nprobationes: {}\n---\n");
    execFileSync("git", ["init", "-q", "-b", "master"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "fixture"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repo });
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "reviewed trunk"], { cwd: repo });
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/master", baseline], { cwd: repo });
    execFileSync("git", ["switch", "-qc", "opus/W-096"], { cwd: repo });
    const own = join(root, "opera", "W-096.md");
    writeFileSync(own, readFileSync(own, "utf8").replace("probationes: {}", `baseline_commit: ${baseline}\nprobationes: {}`));
    execFileSync("git", ["add", own], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "pin baseline"], { cwd: repo });
    const clean = checkEvidence(root, { now: new Date("2026-10-01T00:00:00Z"), repo }).filter((finding) => finding.rule === "opus.records_unchanged");
    writeFileSync(join(root, "opera", "W-095.md"), `${readFileSync(join(root, "opera", "W-095.md"), "utf8")}x`);
    const changed = checkEvidence(root, { now: new Date("2026-10-01T00:00:00Z"), repo }).filter((finding) => finding.rule === "opus.records_unchanged");
    check(10, "W-096 preservation rule accepts baseline bytes", clean.length === 0, JSON.stringify(clean));
    check(10, "W-096 preservation rule blocks changed baseline bytes", changed.some((finding) => finding.level === "block"), JSON.stringify(changed));
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
