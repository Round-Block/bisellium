/**
 * scripts/w030-usage-guard-mutation.mjs — mutation record for W-030
 * behaviour 7: packages/commands/src/usage.test.ts's coverage-count
 * assertion (`seen === 30`) must fail when usage constants stop parsing.
 *
 * Reproduces review round 2's M13: every *_USAGE constant EXCEPT
 * pause.ts's and lifecycle.ts's (whose lines are also caught, separately,
 * by cli.test.ts's literal comparisons — leaving them intact is what made
 * M13 the decisive mutation rather than M11's "every constant vanishes")
 * gets a `: string` annotation inserted between its name and `=`. That
 * annotation is invalid for `extractUsageConstants`'s
 * `const\s+([A-Z][A-Z0-9_]*)\s*=` regex — the exact blind spot round 2
 * found — so each annotated constant silently drops out of the scan.
 *
 * Mutates real source files on disk, runs usage.test.ts against them,
 * then reverts every file to its original bytes in a `finally` — the tree
 * this leaves behind is unmutated regardless of how the test run exits.
 * Exits with usage.test.ts's own exit code, so wrapping this script with
 * `bisellium red` records a red only when the assertion actually failed
 * under the mutation (red refuses to record a command that exited 0).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const abs = (p) => join(repoRoot, p);

// 14 files, 21 constants — pause.ts and lifecycle.ts deliberately excluded.
const targets = [
  ["packages/cli/src/branch.ts", ["BRANCH_USAGE", "MERGE_USAGE"]],
  ["packages/cli/src/close.ts", ["CLOSE_USAGE"]],
  ["packages/cli/src/docs.ts", ["USAGE"]],
  ["packages/cli/src/hooks.ts", ["HOOKS_USAGE", "HOOK_EVENT_USAGE"]],
  ["packages/cli/src/instructions.ts", ["USAGE"]],
  ["packages/cli/src/new.ts", ["NEW_USAGE"]],
  ["packages/cli/src/providers.ts", ["USAGE"]],
  ["packages/cli/src/prune.ts", ["PRUNE_USAGE"]],
  ["packages/cli/src/retro.ts", ["RETRO_USAGE"]],
  ["packages/cli/src/serve.ts", ["USAGE"]],
  ["packages/cli/src/tick.ts", ["USAGE"]],
  ["packages/commands/src/run.ts", ["USAGE"]],
  ["packages/commands/src/talk.ts", ["USAGE"]],
  ["packages/commands/src/verify.ts", ["USAGE"]],
  [
    "packages/commands/src/writes.ts",
    ["HANDOFF_USAGE", "EMIT_USAGE", "ANSWER_USAGE", "GREENLIGHT_USAGE", "BUDGET_USAGE"],
  ],
];

const originals = new Map();

function mutate() {
  for (const [rel, names] of targets) {
    const path = abs(rel);
    const src = readFileSync(path, "utf8");
    originals.set(path, src);
    let mutated = src;
    for (const name of names) {
      const re = new RegExp(`const ${name}(\\s*)=`);
      if (!re.test(mutated)) throw new Error(`mutation target not found: ${rel}:${name}`);
      mutated = mutated.replace(re, `const ${name}: string$1=`);
    }
    writeFileSync(path, mutated);
  }
}

function revert() {
  for (const [path, src] of originals) writeFileSync(path, src);
}

let testExit = 1;
try {
  mutate();
  try {
    const out = execFileSync("node", ["--import", "tsx", abs("packages/commands/src/usage.test.ts"), repoRoot], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    process.stdout.write(out);
    testExit = 0;
  } catch (err) {
    process.stdout.write(err.stdout ?? "");
    process.stderr.write(err.stderr ?? "");
    testExit = typeof err.status === "number" ? err.status : 1;
  }
} finally {
  revert();
  try {
    execFileSync("git", ["diff", "--quiet", "--", ...targets.map(([rel]) => rel)], { cwd: repoRoot });
  } catch {
    console.error("w030-usage-guard-mutation: revert left the tree dirty — fix before trusting this record");
    process.exitCode = 1;
    throw new Error("revert did not restore original bytes");
  }
}

console.log(
  `\n[mutation] usage.test.ts exited ${testExit} under M13 (21 constants annotated, pause.ts/lifecycle.ts intact)`,
);
process.exit(testExit);
