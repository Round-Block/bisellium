/**
 * packages/cli/src/rules/evidence.test.ts — W-022: evidence content rules (P-005).
 * Pure function tests for the two new content checks.
 */
import { isDuplicateRed, isModuleLoadFailure } from "./evidence.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

// behaviour 0: identical bodies after header strip are duplicates
{
  const a = "# exit: 1\n# tree: abc\nFAIL  some assertion\n";
  const b = "# exit: 1\n# tree: def\nFAIL  some assertion\n";
  check(0, "same body after header = duplicate", isDuplicateRed(a, b) === true, String(isDuplicateRed(a, b)));
}

// behaviour 1: different bodies are not duplicates
{
  const a = "# exit: 1\nFAIL  assertion one\n";
  const b = "# exit: 1\nFAIL  assertion two\n";
  check(1, "different body = not duplicate", isDuplicateRed(a, b) === false, String(isDuplicateRed(a, b)));
}

// behaviour 2: ERR_MODULE_NOT_FOUND is a module load failure
{
  const body = "# exit: 1\nError [ERR_MODULE_NOT_FOUND]: Cannot find module './branch.js'\n    at finalizeResolution\n";
  check(2, "ERR_MODULE_NOT_FOUND detected", isModuleLoadFailure(body) === true, String(isModuleLoadFailure(body)));
}

// behaviour 3: SyntaxError import is a module load failure
{
  const body = "# exit: 1\nSyntaxError: The requested module './process.js' does not provide an export named 'checkpointStale'\n";
  check(3, "import SyntaxError detected", isModuleLoadFailure(body) === true, String(isModuleLoadFailure(body)));
}

// behaviour 4: real assertion failure is not a module load failure
{
  const body = "# exit: 1\nFAIL  opusBranchName('W-026') === 'opus/W-026'\n";
  check(4, "assertion failure not flagged", isModuleLoadFailure(body) === false, String(isModuleLoadFailure(body)));
}

// behaviour 5: empty body is not a module load failure
{
  check(5, "empty body not flagged", isModuleLoadFailure("") === false, String(isModuleLoadFailure("")));
}

process.exit(failed ? 1 : 0);
