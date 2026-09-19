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
// behaviour 7 of W-031's brief: the step list `bisellium ci` runs
// (packages/commands/src/ci.ts's CI_STEPS) must equal this workflow's own
// `run:` steps, minus `npm ci` (a dependency-install prerequisite, never one
// of the six) — otherwise local CI and the runner can silently disagree
// about what "green" means. CI_STEPS lives in a .ts file; this script runs
// under plain `node` (no --import tsx), and Node's native TS support does
// not resolve the ".js" specifier -> ".ts" file convention every other
// module here relies on (tsx does) — a plain `import()` of ci.ts fails the
// moment it reaches its own imports. Spawning one short-lived
// `node --import tsx` child that evaluates CI_STEPS and prints it as JSON
// reads the real, single source of truth instead of keeping a second copy
// of the list here that could itself drift from ci.ts.
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

// startsWith, not exact-match: `- run: npm ci --no-audit` in ci.yml is still
// the install prerequisite, not a seventh CI_STEPS entry — an exact match
// would raise a false red for it. Wrong direction (missing a real drift) is
// unsafe; this direction only costs a stricter match, never a missed one.
const workflowRunSteps = runLines.filter((line) => !line.startsWith("npm ci"));
check(
  "bisellium ci's CI_STEPS matches this workflow's run: steps (minus npm ci)",
  JSON.stringify(ciSteps) === JSON.stringify(workflowRunSteps),
  `ci.ts: ${JSON.stringify(ciSteps)}  vs  workflow: ${JSON.stringify(workflowRunSteps)}`,
);

process.exit(failed ? 1 : 0);
