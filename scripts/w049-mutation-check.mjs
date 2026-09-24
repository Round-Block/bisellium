/**
 * scripts/w049-mutation-check.mjs — mutation EVIDENCE for W-049's round-1
 * review (studio/ci/W-049-review-1.log, F1). Judgment 2 found behaviour 4's
 * spawn-map assertions offset/aggregate-based rather than exact per call, so
 * three of the censor's mutations survived the FULL `npm test`:
 *
 *   M13 talk.ts's tick path never resumes (the `existing && ... harnessId`
 *       guard gains `&& params.modelOnly !== undefined`, so a magister
 *       holding a session file still always starts on the tick path).
 *   M14 talk.ts's tick path resumes `sess-w049` for EVERY magister (the
 *       guard becomes `params.modelOnly === undefined || (existing && ...)`,
 *       and the resume call falls back to the literal `"sess-w049"` when no
 *       session exists).
 *   M15 the two `runTalk` calls' per-call counts shift: the first launches
 *       an extra `--version` after its start, the second skips its own
 *       probe — 3 then 1, aggregating to the same 4 the old test only ever
 *       checked in total.
 *
 * The remedy (this opus's fix) makes harness-env.test.ts assert each call's
 * EXACT added record count from a length snapshot taken immediately before
 * that call, and the tick's resume/start split against the count of session
 * files that existed before the tick ran — so each of the three now fails
 * behaviour 4 on its own.
 *
 * Mutates `packages/commands/src/talk.ts` on disk, runs behaviour 4 of
 * harness-env.test.ts, then reverts to the original bytes in a `finally` —
 * the tree this leaves behind is unmutated regardless of how the test run
 * exits. Exits with the test's own exit code (non-zero: `bisellium red`
 * refuses to record a command that exits 0).
 *
 * Usage: node scripts/w049-mutation-check.mjs [M13|M14|M15]  (default M13)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const T = "packages/commands/src/talk.ts";
const abs = join(repoRoot, T);

const MUTATIONS = {
  "M13 tick path never resumes (always starts)": [
    [
      "existing && existing.harness === harnessId",
      "existing && existing.harness === harnessId && params.modelOnly !== undefined",
    ],
  ],
  "M14 tick path resumes sess-w049 for every magister": [
    [
      "existing && existing.harness === harnessId\n",
      "(params.modelOnly === undefined || (existing && existing.harness === harnessId))\n",
    ],
    [
      "sessionId: existing.sessionId, message, env })",
      'sessionId: existing?.sessionId ?? "sess-w049", message, env })',
    ],
  ],
  "M15 per-call count shift across the two runTalk phases (extra launch in call 1, omitted probe in call 2)": [
    [
      "isAvailable = await profile.available();",
      "isAvailable = params.modelOnly && existsSync(sessionPathFor(root, sella)) ? true : await profile.available();",
    ],
    [
      ": await profile.start({ cwd: root, sella, systemPrompt, message, env });",
      ": await profile.start({ cwd: root, sella, systemPrompt, message, env }).then(async (t) => (params.modelOnly ? await profile.available() : undefined, t));",
    ],
  ],
};

const requested = process.argv[2] ?? "M13";
const name = Object.keys(MUTATIONS).find((k) => k.startsWith(requested));
if (!name) throw new Error(`unknown mutation "${requested}" — expected one of M13, M14, M15`);
const edits = MUTATIONS[name];

function diffTalk(label) {
  console.log(`\n== ${label}: git diff -- packages/commands/src/talk.ts ==`);
  execFileSync("git", ["--no-pager", "diff", "--", T], { cwd: repoRoot, stdio: "inherit" });
}

const original = readFileSync(abs, "utf8");
let mutated = original;
for (const [from, to] of edits) {
  const n = mutated.split(from).length - 1;
  if (n !== 1) throw new Error(`${T}: anchor matched ${n}x: ${JSON.stringify(from)}`);
  mutated = mutated.replace(from, to);
}

diffTalk("before mutation");

writeFileSync(abs, mutated);
diffTalk(`${name} applied`);

let testExit = 1;
try {
  const out = execFileSync(
    "node",
    ["--import", "tsx", join(repoRoot, "packages/cli/src/harness-env.test.ts"), repoRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, BISELLIUM_ONLY_BEHAVIOUR: "4" },
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
  diffTalk("reverted");
  try {
    execFileSync("git", ["diff", "--quiet", "--", T], { cwd: repoRoot });
  } catch {
    console.error(
      "w049-mutation-check: revert left packages/commands/src/talk.ts dirty — fix before trusting this record",
    );
    process.exitCode = 1;
    throw new Error("revert did not restore original bytes");
  }
}

console.log(`\n[mutation] harness-env.test.ts (behaviour 4) exited ${testExit} under ${name}`);
if (testExit === 0) {
  console.error(`w049-mutation-check: ${name} SURVIVED — the mutation should have failed behaviour 4`);
  process.exit(1);
}
process.exit(testExit);
