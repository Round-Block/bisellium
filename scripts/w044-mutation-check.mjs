/**
 * scripts/w044-mutation-check.mjs — mutation EVIDENCE for W-044 review logs.
 *
 * Its output belongs in a censor round's review log, never in
 * `ci/reds/W-044/`. Round 3's review (F3) found the opus's own `02.log`
 * carrying a run of THIS script mislabelled as behaviour 2's test-first
 * red, satisfying `opus.red_evidence` for a behaviour it proves nothing
 * about. The remedy restored `02.log` to the genuine pre-implementation
 * behaviour-2 red (`git checkout 279b6df -- studio/ci/reds/W-044/02.log`)
 * and renamed this script off "red02" so its output is never mistaken for
 * a reds slot again. Mutation evidence for a fix is the censor's to
 * gather by charter ("one mutation per opus", engineering lex §2); this
 * script exists only as a convenience the builder can hand the censor,
 * kept under `scripts/`, not under `ci/`.
 *
 * Demonstrates F2 (W-044 review round 2): `checkPolicy`'s old
 * `valuesAfter(argv, "--tools")[0]` read only the FIRST value of the
 * variadic `--tools <tools...>` flag, so a second token appended inside
 * the same group survived undetected on the installed vendor CLI
 * (censor's M10, `W-044-review-2.log`). The fixed test asserts the whole
 * argv literally, so M10 now fails — in test-file behaviours 1 and 4
 * (`checkPolicy`'s call sites), not behaviour 2 (which only reads
 * `--allowedTools`, unaffected by a `--tools` widening). This script
 * filters to those two behaviours with `BISELLIUM_ONLY_BEHAVIOUR=1,4` so
 * the output carries only the assertions the mutation actually flips.
 *
 * Mutates `packages/shim/src/harness/claude-code.ts` on disk, runs
 * `talk-boundary.test.ts`, then reverts to the original bytes in a
 * `finally` — the tree this leaves behind is unmutated regardless of how
 * the test run exits. Exits with the test's own exit code.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "packages/shim/src/harness/claude-code.ts";
const abs = join(repoRoot, TARGET);

const FROM = '"--tools", TOOLS,';
const TO = '"--tools", TOOLS, "WebFetch",';

function diffShim(label) {
  console.log(`\n== ${label}: git diff -- packages/shim ==`);
  try {
    execFileSync("git", ["--no-pager", "diff", "--", "packages/shim"], { cwd: repoRoot, stdio: "inherit" });
  } catch (err) {
    // `git diff` itself exits 0 even with output; a thrown error here means
    // git could not run at all, which the caller should see.
    throw err;
  }
}

const original = readFileSync(abs, "utf8");
if (!original.includes(FROM)) throw new Error(`mutation anchor not found in ${TARGET}: ${FROM}`);

diffShim("before mutation");

writeFileSync(abs, original.replace(FROM, TO));
diffShim("M10 applied (W-044 review round 2, F2: second value token in the --tools group)");

let testExit = 1;
try {
  const out = execFileSync(
    "node",
    ["--import", "tsx", join(repoRoot, "packages/cli/src/talk-boundary.test.ts"), repoRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, BISELLIUM_ONLY_BEHAVIOUR: "1,4" },
    },
  );
  process.stdout.write(out);
  testExit = 0;
} catch (err) {
  process.stdout.write(err.stdout ?? "");
  process.stderr.write(err.stderr ?? "");
  testExit = typeof err.status === "number" ? err.status : 1;
} finally {
  writeFileSync(abs, original);
  diffShim("reverted");
  try {
    execFileSync("git", ["diff", "--quiet", "--", "packages/shim"], { cwd: repoRoot });
  } catch {
    console.error("w044-mutation-check: revert left packages/shim dirty — fix before trusting this record");
    process.exitCode = 1;
    throw new Error("revert did not restore original bytes");
  }
}

console.log(`\n[mutation] talk-boundary.test.ts (behaviours 1,4) exited ${testExit} under M10`);
process.exit(testExit);
