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

process.exit(failed ? 1 : 0);
