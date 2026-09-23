/**
 * scripts/w044-red02-mutation.mjs — mutation-provenance record for
 * `studio/ci/reds/W-044/02.log`.
 *
 * 02.log is the one red slot in ci/reds/W-044 that is re-captured each
 * review round to demonstrate the round's fix catching the finding it
 * fixes on the installed vendor CLI — 01/03/04.log stay the original
 * pre-implementation TDD reds (brief acceptance: "recorded before the
 * profile changed") and are never touched by this script.
 *
 * Round 1's capture (still readable at `279b6df:studio/ci/reds/W-044/02.log`)
 * recorded F1: a duplicate `--allowedTools` widening (M5). Round 2's
 * capture superseded it for the same F1 fix, but round 2's review
 * (`studio/ci/W-044-review-2.log`, "Red 02") found the mutation had been
 * applied and reverted BY HAND outside the recorded command — the
 * "# mutation-provenance" line inside that capture was hand-written prose
 * describing a mutation the recorded command itself never performed. This
 * script is round 3's remedy: the mutation is applied, diffed, tested and
 * reverted entirely INSIDE the command `bisellium red` records, so the
 * capture is mechanical, not narrated.
 *
 * This capture demonstrates F2 (round 2's blocking finding, the sibling of
 * F1): `checkPolicy`'s old `valuesAfter(argv, "--tools")[0]` read only the
 * FIRST value of the variadic `--tools <tools...>` flag, so a second token
 * appended inside the same group survived undetected on the installed
 * vendor CLI (censor's M10, W-044-review-2.log). The fixed test asserts the
 * whole argv literally, so M10 now fails — in test-file behaviours 1 and 4
 * (`checkPolicy`'s call sites), not behaviour 2 (which only reads
 * `--allowedTools`, unaffected by a `--tools` widening). This script filters
 * to those two behaviours with `BISELLIUM_ONLY_BEHAVIOUR=1,4` so the capture
 * carries only the assertions the mutation actually flips, rather than
 * padding it with unrelated behaviour-2/3 passes. The slot stays `02.log`
 * (hence `bisellium red W-044 --behaviour 2 ...` — the number tags the
 * rotating provenance slot, not which test-file block ran; that mapping is
 * the deliberate, documented reason F2's fix could not be demonstrated
 * behaviour-pure inside this specific slot without corrupting 01.log or
 * 04.log's protected TDD evidence).
 *
 * Mutates `packages/shim/src/harness/claude-code.ts` on disk, runs
 * `talk-boundary.test.ts`, then reverts to the original bytes in a
 * `finally` — the tree this leaves behind is unmutated regardless of how
 * the test run exits. Exits with the test's own exit code, so wrapping this
 * script with `bisellium red` records a red only when the assertion
 * actually failed under the mutation (`red` refuses to record a command
 * that exited 0).
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
    console.error("w044-red02-mutation: revert left packages/shim dirty — fix before trusting this record");
    process.exitCode = 1;
    throw new Error("revert did not restore original bytes");
  }
}

console.log(`\n[mutation] talk-boundary.test.ts (behaviours 1,4) exited ${testExit} under M10`);
process.exit(testExit);
