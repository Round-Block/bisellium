/**
 * packages/cli/src/rules/process.test.ts — process.tdd rule: a commit
 * that changes source code without a corresponding test change is an
 * advisory. Pure function test — no git, no temp dirs.
 */

import { tddViolation, checkpointStale, sameSellaBuiltAndReviewed } from "./process.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

// behaviour 1: source change with no test change is a violation
{
  const files = ["apps/web/src/screens/Officina.tsx", "apps/web/src/components/w025.css"];
  check(1, "source-only commit is a violation", tddViolation(files) === true, String(tddViolation(files)));
}

// behaviour 2: source change with a test change is not a violation
{
  const files = ["apps/web/src/screens/Officina.tsx", "apps/web/test/inboxview.test.ts"];
  check(2, "source + test commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 3: test-only change is not a violation
{
  const files = ["apps/web/test/inboxview.test.ts", "apps/web/src/lib/posture.test.ts"];
  check(3, "test-only commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 4: non-code changes (docs, config, css-only) are not violations
{
  const files = ["docs/SESSION-HANDOFF.md", "package.json", "README.md"];
  check(4, "docs/config-only commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 5: .test.ts inline in src/ counts as a test
{
  const files = ["packages/cli/src/check.ts", "packages/cli/src/check.test.ts"];
  check(5, "inline .test.ts counts as test coverage", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 6: empty file list is not a violation
{
  check(6, "empty commit is not a violation", tddViolation([]) === false, String(tddViolation([])));
}

// behaviour 7: css-only changes are not violations (styling, not logic)
{
  const files = ["apps/web/src/components/w025.css"];
  check(7, "css-only commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 8: opera changed without handoff is stale
{
  const files = ["studio/opera/W-026.md", "packages/cli/src/branch.ts"];
  check(8, "opera changed without handoff is stale", checkpointStale(files) === true, String(checkpointStale(files)));
}

// behaviour 9: opera and handoff both changed is not stale
{
  const files = ["studio/opera/W-026.md", "docs/SESSION-HANDOFF.md", "packages/cli/src/branch.ts"];
  check(9, "opera + handoff is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 10: only handoff changed is not stale
{
  const files = ["docs/SESSION-HANDOFF.md"];
  check(10, "handoff-only is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 11: docs-only commit (no opera) is not stale
{
  const files = ["docs/ARCHITECTURE.md", "README.md"];
  check(11, "docs-only is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 12: empty file list is not stale
{
  check(12, "empty is not stale", checkpointStale([]) === false, String(checkpointStale([])));
}

// behaviour 13: progress page counts as checkpoint update
{
  const files = ["studio/opera/W-026.md", "docs/design/dossier/progress-body.html"];
  check(13, "opera + progress page is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 14: same sella on spec and review gates fires
{
  const probationes = { spec: { sella: "sonnet-5", status: "passed" }, review: { sella: "sonnet-5", status: "passed" } };
  check(14, "same sella on spec and review fires", sameSellaBuiltAndReviewed(probationes) === true, String(sameSellaBuiltAndReviewed(probationes)));
}

// behaviour 15: different sellae on spec and review does not fire
{
  const probationes = { spec: { sella: "sonnet-5", status: "passed" }, review: { sella: "opus-4-6", status: "passed" } };
  check(15, "different sellae does not fire", sameSellaBuiltAndReviewed(probationes) === false, String(sameSellaBuiltAndReviewed(probationes)));
}

// behaviour 16: only one gate recorded does not fire
{
  const probationes = { spec: { sella: "sonnet-5", status: "passed" } };
  check(16, "only one gate recorded does not fire", sameSellaBuiltAndReviewed(probationes) === false, String(sameSellaBuiltAndReviewed(probationes)));
}

// behaviour 17: no probationes does not fire
{
  check(17, "no probationes does not fire", sameSellaBuiltAndReviewed(undefined) === false, String(sameSellaBuiltAndReviewed(undefined)));
}

process.exit(failed ? 1 : 0);
