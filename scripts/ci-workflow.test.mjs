/**
 * scripts/ci-workflow.test.mjs — behaviour 11 of the W-019 brief:
 * .github/workflows/ci.yml parses as YAML; its steps include typecheck,
 * lint, format:check, test, and two `check` invocations naming `studio` and
 * `examples/sample-studio` with `--repo .`; the string "verify" appears
 * nowhere in the file. No framework, same house style as
 * scripts/changelog.test.mjs.
 *
 * Target file is an optional argv override so the same assertions can be
 * run red against a deliberately broken fixture and green against the real
 * workflow — default is the real file.
 *
 * Repo-infra change (2026-09-20, GitHub CI gate): `check -- studio` fails on
 * known officina debt (W-028's ruling), so a single `build` job can never be
 * a required status check. The workflow is now two jobs: `gates` (everything
 * `bisellium ci` runs except the studio check — this is the job a branch
 * protection rule can require) and `officina` (`check -- studio` alone, an
 * honest, non-required red). This is a DELIBERATE divergence from
 * `bisellium ci`'s CI_STEPS, which still runs all six steps in one
 * sequential list with `check -- studio` before `check -- sample-studio` —
 * splitting into two parallel jobs moves the studio check out from between
 * `test` and the sample-studio check, so the workflow's `run:` order can no
 * longer equal CI_STEPS' order. What still holds: every CI_STEPS command
 * still runs somewhere, gates' own five steps keep CI_STEPS' relative order
 * for the entries they carry, and officina's one step is exactly the studio
 * entry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const target = resolve(process.argv[2] ?? join(REPO_ROOT, ".github/workflows/ci.yml"));

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(50)} ${detail}`);
  if (!ok) failed++;
};

const raw = readFileSync(target, "utf8");

let doc;
try {
  doc = parseYaml(raw);
  check("parses as YAML", true);
} catch (err) {
  check("parses as YAML", false, String(err));
  process.exit(1);
}

const runLines = Object.values(doc?.jobs ?? {})
  .flatMap((job) => job.steps ?? [])
  .map((step) => step.run)
  .filter((run) => typeof run === "string");

const hasRun = (needle) => runLines.some((line) => line.includes(needle));

check("has a typecheck step", hasRun("typecheck"));
check("has a lint step", hasRun("lint"));
check("has a format:check step", hasRun("format:check"));
check("has a test step", hasRun("npm test") || hasRun("npm run test"));
check(
  "has a check --repo . step naming studio",
  runLines.some(
    (line) =>
      line.includes("check") && line.includes("studio") && !line.includes("sample-studio") && line.includes("--repo ."),
  ),
);
check(
  "has a check --repo . step naming examples/sample-studio",
  runLines.some(
    (line) => line.includes("check") && line.includes("examples/sample-studio") && line.includes("--repo ."),
  ),
);
check("the string 'verify' appears nowhere in the file", !raw.includes("verify"));

// ---------------------------------------------------------------------------
// behaviour 7 of W-031's brief, updated for the 2026-09-20 gates/officina
// split: the step list `bisellium ci` runs (packages/commands/src/ci.ts's
// CI_STEPS) must equal this workflow's own `run:` steps, minus `npm ci` (a
// dependency-install prerequisite, never one of the six) — otherwise local
// CI and the runner can silently disagree about what "green" means. CI_STEPS
// lives in a .ts file; this script runs under plain `node` (no --import
// tsx), and Node's native TS support does not resolve the ".js" specifier ->
// ".ts" file convention every other module here relies on (tsx does) — a
// plain `import()` of ci.ts fails the moment it reaches its own imports.
// Spawning one short-lived `node --import tsx` child that evaluates
// CI_STEPS and prints it as JSON reads the real, single source of truth
// instead of keeping a second copy of the list here that could itself drift
// from ci.ts.
// ---------------------------------------------------------------------------
const CI_TS_URL = `file://${join(REPO_ROOT, "packages", "commands", "src", "ci.ts")}`;
let ciSteps;
try {
  const out = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(CI_TS_URL)}).then(m=>process.stdout.write(JSON.stringify(m.CI_STEPS)))`,
    ],
    { encoding: "utf8", cwd: REPO_ROOT },
  );
  ciSteps = JSON.parse(out);
  check("CI_STEPS reads from packages/commands/src/ci.ts", Array.isArray(ciSteps) && ciSteps.length > 0, out);
} catch (err) {
  ciSteps = [];
  check("CI_STEPS reads from packages/commands/src/ci.ts", false, String(err));
}

// The one CI_STEPS entry that's officina-wide (found by content, same rule
// ci.ts itself uses for CHECK_STUDIO_STEP — never by position, since a
// reorder of CI_STEPS must not silently stop this script from finding it).
const studioStep = ciSteps.find((s) => s.includes("check -- studio") && !s.includes("sample-studio"));
check("CI_STEPS has a 'check -- studio' entry", studioStep !== undefined, JSON.stringify(ciSteps));

check("workflow has exactly two jobs: gates, officina", Object.keys(doc?.jobs ?? {}).join(",") === "gates,officina");

const jobRunSteps = (jobId) =>
  (doc?.jobs?.[jobId]?.steps ?? [])
    .map((step) => step.run)
    .filter((run) => typeof run === "string")
    .filter((line) => !line.startsWith("npm ci"));

const gatesSteps = jobRunSteps("gates");
const officinaSteps = jobRunSteps("officina");

// startsWith, not exact-match, for the npm-ci filter above: `- run: npm ci
// --no-audit` in either job is still the install prerequisite, not a
// seventh CI_STEPS entry — an exact match would raise a false red for it.
// Wrong direction (missing a real drift) is unsafe; this direction only
// costs a stricter match, never a missed one.
const expectedGatesSteps = ciSteps.filter((s) => s !== studioStep);
check(
  "gates job's run: steps equal CI_STEPS minus the studio check, in order",
  JSON.stringify(gatesSteps) === JSON.stringify(expectedGatesSteps),
  `gates: ${JSON.stringify(gatesSteps)}  vs  expected: ${JSON.stringify(expectedGatesSteps)}`,
);
check(
  "officina job's run: steps are exactly the studio check, alone",
  JSON.stringify(officinaSteps) === JSON.stringify([studioStep]),
  `officina: ${JSON.stringify(officinaSteps)}`,
);

// DELIBERATE divergence from bisellium ci (named in the class comment atop
// this file): CI_STEPS itself keeps running all six steps as one sequential
// list, studio-check before sample-studio-check — the two-job split can no
// longer reproduce that exact order, since gates and officina run in
// parallel. This assertion documents the divergence as a known, examined
// fact rather than an unexamined drift: it is expected to be FALSE.
const flatWorkflowSteps = [...gatesSteps, ...officinaSteps];
const trueParityWithCiSteps = JSON.stringify(flatWorkflowSteps) === JSON.stringify(ciSteps);
check(
  "(documented divergence, expected false) gates+officina flattened does NOT reproduce CI_STEPS' order",
  trueParityWithCiSteps === false,
  `flattened: ${JSON.stringify(flatWorkflowSteps)}  vs  CI_STEPS: ${JSON.stringify(ciSteps)}`,
);

// W-050 guards the ci documentation here because this script already owns
// CI_STEPS and the workflow's gates/officina split, so the docs drift with
// those sources instead of silently drifting apart from them.
const VERIFY_LINE = "- `bisellium verify <opus> --studio studio --repo .` (on the opus branch)";
const CI_LINE =
  "- `bisellium ci` (the CI workflow's steps, run locally; `--opus <id> --studio studio` then runs `verify`, on the opus branch)";
const instructionsTemplate = readFileSync(join(REPO_ROOT, "packages/cli/src/instructions.template.md"), "utf8").split(
  /\r?\n/,
);
const verifyLineIndex = instructionsTemplate.indexOf(VERIFY_LINE);
check(
  "instructions template: ci line follows verify line",
  verifyLineIndex !== -1 && instructionsTemplate[verifyLineIndex + 1] === CI_LINE,
);

const claudeInstructions = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8").split(/\r?\n/);
check(
  "CLAUDE.md carries the ci line",
  claudeInstructions.some((line) => line === CI_LINE),
);

const agentInstructions = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8").split(/\r?\n/);
check(
  "AGENTS.md carries the ci line",
  agentInstructions.some((line) => line === CI_LINE),
);

const norm = (s) => s.replace(/\s+/g, " ");
const adoption = readFileSync(join(REPO_ROOT, "docs/ADOPTION.md"), "utf8").split(/\r?\n/);
const adoptionHeadingIndex = adoption.indexOf("## Running ci");
const adoptionSectionEnd =
  adoptionHeadingIndex === -1
    ? adoption.length
    : adoption.findIndex((line, index) => index > adoptionHeadingIndex && line.startsWith("## "));
const section =
  adoptionHeadingIndex === -1
    ? ""
    : norm(
        adoption
          .slice(adoptionHeadingIndex + 1, adoptionSectionEnd === -1 ? adoption.length : adoptionSectionEnd)
          .join(" "),
      );
const previousAdoptionHeading =
  adoptionHeadingIndex === -1
    ? undefined
    : adoption.slice(0, adoptionHeadingIndex).findLast((line) => line.startsWith("## "));
check(
  'ADOPTION.md: "## Running ci" follows "## Running run and verify"',
  adoptionHeadingIndex !== -1 && previousAdoptionHeading === "## Running run and verify",
);

const ciSource = readFileSync(join(REPO_ROOT, "packages/commands/src/ci.ts"), "utf8");
const usageMatch = ciSource.match(/const USAGE = "usage: bisellium ci ([^"]*)";/);
check(
  'ADOPTION "Running ci" shows ci\'s usage',
  usageMatch !== null && section.includes("npm run bisellium -- ci " + usageMatch[1]),
  usageMatch === null ? "USAGE not found in ci.ts" : "",
);

for (const step of ciSteps) {
  check(`ADOPTION "Running ci" names step: ${step}`, section.includes(step));
}

check(
  'ADOPTION "Running ci" names CI_STEPS, ci.ts and this guard',
  section.includes("`CI_STEPS`") &&
    section.includes("`packages/commands/src/ci.ts`") &&
    section.includes("`scripts/ci-workflow.test.mjs`"),
);
check(
  'ADOPTION "Running ci" names the gates and officina jobs',
  section.includes("`gates`") && section.includes("`officina`"),
);

process.exit(failed ? 1 : 0);
