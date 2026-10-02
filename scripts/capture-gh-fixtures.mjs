#!/usr/bin/env node
// W-124: capture the real `gh` --json shapes that packages/cli/src/next.test.ts
// replays through its stub `gh`. Read-only: it only runs `gh repo view`,
// `gh pr list`, `gh pr view`, `gh pr checks` and a GET `gh api`. Needs `gh`
// credentials, so the producer runs it; the builder runtime has none.
//
//   node scripts/capture-gh-fixtures.mjs [--repo <owner/name>] [--prs 150,151,152]
//
// Writes packages/cli/src/fixtures/gh/*.json plus provenance.json (argv, gh
// --version, UTC capture time, repo, PR numbers). Re-run to regenerate; never
// edit a fixture by hand.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "cli", "src", "fixtures", "gh");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

const gh = (args) => {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
  return { argv: ["gh", ...args], exit: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

const slug =
  flag("--repo") ??
  JSON.parse(execFileSync("gh", ["repo", "view", "--json", "nameWithOwner"], { encoding: "utf8" })).nameWithOwner;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) throw new Error(`bad repo slug ${slug}`);
const prs = flag("--prs", "150,151,152")
  .split(",")
  .map((n) => Number(n));
if (!prs.every((n) => Number.isInteger(n) && n > 0)) throw new Error("--prs must be positive integers");

// The exact field list the verb reads (brief revision 3, "PR identity").
const LIST_FIELDS =
  "number,state,mergeStateStatus,headRefName,headRefOid,baseRefName,isCrossRepository,headRepositoryOwner,headRepository,mergeCommit";
const VIEW_FIELDS = "number,state,mergeStateStatus,headRefName,headRefOid,baseRefName,mergeCommit";

const captures = [];
const save = (file, result, parse = true) => {
  let body = result.stdout;
  if (parse) {
    try {
      body = `${JSON.stringify(JSON.parse(result.stdout), null, 2)}\n`;
    } catch {
      // keep the raw bytes: an unparseable reply is itself evidence
    }
  }
  writeFileSync(join(OUT, file), body);
  captures.push({
    file,
    argv: result.argv,
    exit: result.exit,
    ...(result.stderr ? { stderr: result.stderr.slice(0, 500) } : {}),
  });
};

mkdirSync(OUT, { recursive: true });
save("repo-view.json", gh(["repo", "view", "--json", "nameWithOwner"]));
for (const n of prs) {
  save(`pr-view-${n}.json`, gh(["pr", "view", String(n), "-R", slug, "--json", VIEW_FIELDS]));
}
// One list per head family: an opus PR, a spec PR, a chore PR.
const heads = new Map();
for (const n of prs) {
  const view = JSON.parse(gh(["pr", "view", String(n), "-R", slug, "--json", "headRefName"]).stdout);
  heads.set(n, view.headRefName);
}
for (const [n, head] of heads) {
  save(
    `pr-list-${n}.json`,
    gh(["pr", "list", "-R", slug, "--head", head, "--state", "all", "--limit", "20", "--json", LIST_FIELDS]),
  );
}
const checksPr = prs[prs.length - 1];
save("pr-checks.json", gh(["pr", "checks", String(checksPr), "-R", slug, "--json", "name,bucket,state"]));
save("code-scanning-alerts.json", gh(["api", `repos/${slug}/code-scanning/alerts?state=open&per_page=100`]));

writeFileSync(
  join(OUT, "provenance.json"),
  `${JSON.stringify(
    {
      tool: "scripts/capture-gh-fixtures.mjs",
      ghVersion: execFileSync("gh", ["--version"], { encoding: "utf8" }).split("\n")[0],
      capturedAt: new Date().toISOString(),
      repo: slug,
      prNumbers: prs,
      checksPr,
      heads: Object.fromEntries(heads),
      captures,
    },
    null,
    2,
  )}\n`,
);
console.log(`captured ${captures.length} fixtures for ${slug} PRs ${prs.join(",")} into ${OUT}`);
