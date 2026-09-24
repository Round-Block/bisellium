#!/usr/bin/env node
/**
 * scripts/w041-mutation-check.mjs — mutation EVIDENCE + red-recording helper
 * for W-041 round-2 (studio/ci/W-041-review-1.log: B1's six untested
 * instances, B2's "none" sentinel, and the GHAS escaper advisory). Same
 * shape as scripts/w044-mutation-check.mjs: apply one named mutation to
 * scripts/backlog-page.mjs, run the test (or record a red through
 * `bisellium red`), restore the original bytes in a `finally` regardless of
 * outcome, and confirm the tree is clean afterward.
 *
 * Usage:
 *   node scripts/w041-mutation-check.mjs <mutation> [--record]
 *
 * <mutation> is one of MUTATIONS' keys below. Each names the finding it
 * demonstrates and the behaviour it targets. Without --record this runs
 * `node scripts/backlog-page.test.mjs <behaviour>` directly. With --record
 * it instead runs `bisellium red W-041 --behaviour <behaviour> --sella
 * builder-a --studio studio --repo .` so the failure becomes the opus's
 * recorded red for that behaviour — the mutation name and finding it
 * demonstrates are printed before the run and live in this file, which is
 * the provenance for the recorded log's otherwise-bare `# command:` header.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "scripts/backlog-page.mjs";
const abs = join(repoRoot, TARGET);

const MUTATIONS = {
  "m2-caption": {
    behaviour: 1,
    label: "B1(c): the D-021 in-flight caption is deleted",
    from: '<p class="mock-caption">State as recorded in this checkout&rsquo;s officina. On the trunk, per D-021, an opus being built still reads <code>greenlit</code> &mdash; its live state is on <code>opus/&lt;id&gt;</code>.</p>\n',
    to: "",
  },
  "m4-footnote": {
    behaviour: 1,
    label: "B1(d): the revisit-trigger footnote is deleted",
    from: '<p class="footnote">If a hand-written ordering of these items appears anywhere outside an acta twice more, <code>rank:</code> has earned its opus.</p>\n\n',
    to: "",
  },
  "m5-ranking-link": {
    behaviour: 1,
    label: "B1(e): the ranking-acta link is suppressed",
    from: "  const rankingLink =\n    rankingActa && outPath",
    to: "  const rankingLink =\n    false && rankingActa && outPath",
  },
  "m6-heading-alt": {
    behaviour: 7,
    label: "B1(b): the 'New opera' heading alternative is dropped from the guard",
    from: "const SLATE_HEADING_RE = /^#+\\s*(Backlog|New opera\\b.*)\\s*$/i;",
    to: "const SLATE_HEADING_RE = /^#+\\s*(Backlog)\\s*$/i;",
  },
  "m7-chain-arrow": {
    behaviour: 7,
    label: "B1(a) worst instance: the Unicode → chain alternative is dropped from the guard",
    from: "const RANKED_CHAIN_RE = /W-\\d{3}\\s*(?:→|->)\\s*W-\\d{3}\\s*(?:→|->)\\s*W-\\d{3}/g;",
    to: "const RANKED_CHAIN_RE = /W-\\d{3}\\s*(?:->)\\s*W-\\d{3}\\s*(?:->)\\s*W-\\d{3}/g;",
  },
  "out-not-modified": {
    behaviour: 7,
    label: "B1(f): the guard logs a violation but no longer stops the write",
    from: "    for (const v of violations) console.error(`  line ${v.line}: ${v.kind}: ${v.text}`);\n    process.exit(1);\n  }\n",
    to: "    for (const v of violations) console.error(`  line ${v.line}: ${v.kind}: ${v.text}`);\n  }\n",
  },
  "blocked-on-none": {
    behaviour: 2,
    label: 'B2: the handoff\'s "none" sentinel renders as the literal word none',
    from: 'if (blockedOn !== undefined && blockedOn !== null && String(blockedOn).trim() !== "" && blockedOn !== "none")',
    to: 'if (blockedOn !== undefined && blockedOn !== null && String(blockedOn).trim() !== "")',
  },
  "esc-quote": {
    behaviour: 6,
    label: "GHAS js/incomplete-html-attribute-sanitization: esc() does not escape a quote",
    from: '    .replace(/>/g, "&gt;")\n    .replace(/"/g, "&quot;")\n    .replace(/\'/g, "&#39;");',
    to: '    .replace(/>/g, "&gt;");',
  },
};

const [mutationName, ...rest] = process.argv.slice(2);
const record = rest.includes("--record");
const mutation = MUTATIONS[mutationName];
if (!mutation) {
  console.error(
    `usage: node scripts/w041-mutation-check.mjs <mutation> [--record]\nknown mutations: ${Object.keys(MUTATIONS).join(", ")}`,
  );
  process.exit(2);
}

function diffTarget(label) {
  console.log(`\n== ${label}: git diff -- ${TARGET} ==`);
  execFileSync("git", ["--no-pager", "diff", "--", TARGET], { cwd: repoRoot, stdio: "inherit" });
}

const original = readFileSync(abs, "utf8");
if (!original.includes(mutation.from)) {
  throw new Error(`mutation anchor not found in ${TARGET} for "${mutationName}" — has the source moved?`);
}

console.log(`[mutation] ${mutationName}: ${mutation.label}`);
diffTarget("before mutation");
writeFileSync(abs, original.replace(mutation.from, mutation.to));
diffTarget(`${mutationName} applied`);

let exit = 1;
try {
  const args = record
    ? [
        "--import",
        "tsx",
        join(repoRoot, "packages/cli/src/main.ts"),
        "red",
        "W-041",
        "--behaviour",
        String(mutation.behaviour),
        "--sella",
        "builder-a",
        "--studio",
        "studio",
        "--repo",
        ".",
        "--",
        "node",
        "scripts/backlog-page.test.mjs",
        String(mutation.behaviour),
      ]
    : [join(repoRoot, "scripts/backlog-page.test.mjs"), String(mutation.behaviour)];
  const out = execFileSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
  process.stdout.write(out);
  exit = 0;
} catch (err) {
  process.stdout.write(err.stdout ?? "");
  process.stderr.write(err.stderr ?? "");
  exit = typeof err.status === "number" ? err.status : 1;
} finally {
  writeFileSync(abs, original);
  diffTarget("reverted (diff against HEAD is the builder's own pending, unrelated fixes — not this mutation)");
  // Compare against the in-memory pre-mutation snapshot, not `git diff`:
  // TARGET already carries this opus's own uncommitted fixes (B2, the
  // escaper), so `git diff --quiet` would never be clean here regardless of
  // whether the mutation reverted cleanly.
  if (readFileSync(abs, "utf8") !== original) {
    console.error(`w041-mutation-check: revert left ${TARGET} not byte-identical to its pre-mutation state`);
    process.exitCode = 1;
    throw new Error("revert did not restore original bytes");
  }
}

console.log(
  `\n[mutation] ${mutationName} (behaviour ${mutation.behaviour}, ${record ? "recorded via bisellium red" : "plain test run"}) exited ${exit}`,
);
process.exit(exit);
