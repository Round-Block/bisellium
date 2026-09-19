/**
 * packages/cli/src/rules/process.test.ts — process.tdd rule: a commit
 * that changes source code without a corresponding test change is an
 * advisory. Pure function test — no git, no temp dirs.
 */

import { tddViolation } from "./process.js";

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

process.exit(failed ? 1 : 0);
