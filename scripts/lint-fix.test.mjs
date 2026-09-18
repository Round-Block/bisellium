/**
 * scripts/lint-fix.test.mjs — behaviour 3 of the W-019 brief:
 * `scripts/lint-fix.mjs` is idempotent — a second run changes no file. No
 * framework, same house style as scripts/changelog.test.mjs.
 *
 * The script under test hardcodes `npx eslint . --fix` against its own
 * `process.cwd()`, so the fixture is a directory *inside* this repo (not
 * under the system tmpdir) — ESLint's flat-config lookup walks up parent
 * directories, and a fixture outside the repo tree could not resolve
 * `eslint`/`typescript-eslint` from this repo's node_modules at all. The
 * fixture carries its own eslint.config.mjs (found before the walk-up would
 * ever reach the root config) enabling a genuinely auto-fixable core rule,
 * so the test proves --fix both changes a file AND converges — not just
 * that a no-op script never touches anything.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const SCRIPT = join(HERE, "lint-fix.mjs");

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(50)} ${detail}`);
  if (!ok) failed++;
};

const FIXTURE_CONFIG = `export default [{ rules: { semi: ["error", "always"] } }];\n`;
const BEFORE = `const answer = 42\n`;

// mkdtemp *inside* the repo, not tmpdir() — see file header.
const dir = mkdtempSync(join(REPO_ROOT, ".lint-fix-test-"));
try {
  writeFileSync(join(dir, "eslint.config.mjs"), FIXTURE_CONFIG);
  writeFileSync(join(dir, "bad.js"), BEFORE);

  execFileSync(process.execPath, [SCRIPT], { cwd: dir, stdio: "pipe" });
  const afterRun1 = readFileSync(join(dir, "bad.js"), "utf8");
  check("run 1 actually fixed the missing semicolon", afterRun1 === `const answer = 42;\n`, JSON.stringify(afterRun1));

  execFileSync(process.execPath, [SCRIPT], { cwd: dir, stdio: "pipe" });
  const afterRun2 = readFileSync(join(dir, "bad.js"), "utf8");
  check("run 2 changed nothing (idempotent)", afterRun2 === afterRun1, JSON.stringify(afterRun2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
