/**
 * packages/cli/src/rules/evidence.test.ts — W-022: evidence content rules
 * (P-005), and W-084: brief Behaviour-N citations.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkStudio } from "../check.js";
import { checkEvidence, isDuplicateRed, isModuleLoadFailure } from "./evidence.js";
import { RULE_IDS } from "./ids.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
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

// W-084 uses the same 1-3 selector values as the legacy checks above: a red
// command gets its one W-084 behaviour plus a harmless legacy control, while
// the unfiltered suite still runs everything.
const w084Only = only !== undefined && only >= 1 && only <= 3 ? only : undefined;
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
      1,
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
  // unreadable .md entry does not abort the rest of the crawl.
  {
    const dir = freshOfficina("w084-exclusions");
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
    mkdirSync(join(dir, "briefs", "unreadable.md"));
    let findings: ReturnType<typeof citationFindings> = [];
    let threw = false;
    try {
      findings = citationFindings(dir);
    } catch {
      threw = true;
    }
    checkW084(2, "brief.behaviour_citation is registered", RULE_IDS.has("brief.behaviour_citation"));
    checkW084(2, "seven exclusions are silent and unreadable brief is skipped", !threw && findings.length === 0, JSON.stringify(findings));
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
      3,
      "unreferenced brief is reached by checkStudio",
      found.length === 1 && found[0]!.where === "briefs/orphan.md" && found[0]!.message.includes("Behaviour 99"),
      JSON.stringify(found),
    );

    const real = checkStudio(resolve(process.argv[2] ?? ".", "studio"), new Date("2026-09-25T12:00:00Z")).findings.filter(
      (f) => f.rule === "brief.behaviour_citation",
    );
    checkW084(3, "real brief corpus has no out-of-range citation", real.length === 0, JSON.stringify(real));
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
