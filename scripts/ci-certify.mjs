/**
 * W-168: the merge queue's certification. Run from the tooling checkout (master's
 * code, checked out at the merge group's base commit):
 *   node --import tsx scripts/ci-certify.mjs --candidate <dir> --studio <rel>
 * It reads GITHUB_EVENT_NAME and GITHUB_EVENT_PATH. Exit 0: certified, or nothing
 * to mint. Exit 1: certification failed. Exit 2: refused input. Neither 1 nor 2
 * mints, and a non-zero exit fails the required `certify` check.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "../adapters/native/src/index.ts";
import { readSourceExcludes } from "../packages/commands/src/verdict.ts";

const QUEUE_REF_RE = /^refs\/heads\/gh-readonly-queue\/master\/pr-([1-9][0-9]*)-[0-9a-f]{40}$/;
const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const OID_RE = /^[0-9a-f]{40}$/;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Exactly `--candidate <dir>` and `--studio <rel>`, once each, nothing else. */
export function readCertifyArgs(argv) {
  const found = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const name = flag === "--candidate" ? "candidate" : flag === "--studio" ? "studio" : undefined;
    if (name === undefined) return { error: `unknown argument ${JSON.stringify(flag)}` };
    if (name in found) return { error: `${flag} given twice` };
    const value = argv[i + 1];
    if (typeof value !== "string" || value === "" || value.startsWith("--")) return { error: `${flag} needs a value` };
    found[name] = value;
  }
  if (found.candidate === undefined) return { error: "--candidate is required" };
  if (found.studio === undefined) return { error: "--studio is required" };
  return { candidate: found.candidate, studio: found.studio };
}

/** The merge-group event, or the reason it is refused. */
function readEvent(eventName, event) {
  if (eventName !== "merge_group") return { error: `event ${JSON.stringify(eventName)} is not merge_group` };
  if (!isObj(event) || event.action !== "checks_requested") return { error: "the event is not checks_requested" };
  const g = event.merge_group;
  if (!isObj(g)) return { error: "the event has no merge_group" };
  const queued = typeof g.head_ref === "string" ? QUEUE_REF_RE.exec(g.head_ref) : null;
  if (queued === null) return { error: "merge_group.head_ref is not a master queue branch" };
  if (typeof g.head_sha !== "string" || !OID_RE.test(g.head_sha))
    return { error: "merge_group.head_sha is not a commit id" };
  if (typeof g.base_sha !== "string" || !OID_RE.test(g.base_sha))
    return { error: "merge_group.base_sha is not a commit id" };
  if (g.base_ref !== "refs/heads/master") return { error: "merge_group.base_ref is not refs/heads/master" };
  const slug = isObj(event.repository) ? event.repository.full_name : undefined;
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return { error: "repository.full_name is not a slug" };
  return { pr: Number(queued[1]), headSha: g.head_sha, baseSha: g.base_sha, slug };
}

/** git in `cwd`: the exit status (1 when it could not run) and trimmed stdout. */
function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000 });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim() };
}

/** The real path of `dir` when it is its own work-tree top level, else undefined. */
function topLevel(dir) {
  try {
    const real = realpathSync(dir);
    const r = git(real, ["rev-parse", "--show-toplevel"]);
    return r.status === 0 && realpathSync(r.stdout) === real ? real : undefined;
  } catch {
    return undefined;
  }
}

/** The real path of the studio when it is a directory strictly inside `top` holding a regular bisellium.yml. */
function studioDir(top, studio) {
  if (
    typeof studio !== "string" ||
    isAbsolute(studio) ||
    studio.split("/").some((s) => s === "" || s === "." || s === "..")
  )
    return undefined;
  try {
    const real = realpathSync(join(top, studio));
    if (
      !real.startsWith(top + sep) ||
      !statSync(real).isDirectory() ||
      !lstatSync(join(real, "bisellium.yml")).isFile()
    )
      return undefined;
    return real;
  } catch {
    return undefined;
  }
}

/** The PR read, or the reason it is refused. */
function readPr(o, ev) {
  const r = o.gh([
    "pr",
    "view",
    String(ev.pr),
    "-R",
    ev.slug,
    "--json",
    "number,state,headRefName,headRefOid,baseRefName,isCrossRepository",
  ]);
  if (r.status !== 0) return { error: `gh pr view exited ${r.status}` };
  let pr;
  try {
    pr = JSON.parse(r.stdout);
  } catch {
    return { error: "gh pr view returned non-JSON output" };
  }
  if (
    !isObj(pr) ||
    pr.number !== ev.pr ||
    pr.state !== "OPEN" ||
    pr.baseRefName !== "master" ||
    pr.isCrossRepository !== false
  )
    return { error: `PR #${ev.pr} is not an open same-repository PR into master` };
  if (typeof pr.headRefOid !== "string" || !OID_RE.test(pr.headRefOid))
    return { error: "headRefOid is not a commit id" };
  if (typeof pr.headRefName !== "string") return { error: "headRefName is not a string" };
  return { headRefName: pr.headRefName, headRefOid: pr.headRefOid };
}

export async function certify(o) {
  const refuse = (why) => {
    o.log(`certify: refused: ${why}`);
    return 2;
  };
  const ev = readEvent(o.eventName, o.event);
  if (ev.error !== undefined) return refuse(ev.error);
  o.log(`certify: merge group for PR #${ev.pr}`);

  // Phase A runs no Git command that writes.
  const candidate = topLevel(o.candidate);
  const tooling = topLevel(o.tooling);
  if (candidate === undefined || tooling === undefined || candidate === tooling)
    return refuse("the candidate and the tooling must be distinct work-tree top levels");
  if (git(candidate, ["rev-parse", "HEAD"]).stdout !== ev.headSha)
    return refuse("the candidate HEAD is not merge_group.head_sha");
  if (git(tooling, ["rev-parse", "HEAD"]).stdout !== ev.baseSha)
    return refuse("the tooling HEAD is not merge_group.base_sha");
  const studio = studioDir(candidate, o.studio);
  if (studio === undefined)
    return refuse("--studio must be a relative directory inside the candidate holding bisellium.yml");
  const url = git(candidate, ["config", "--get", "remote.origin.url"]);
  const origin =
    url.status === 0 ? /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url.stdout) : null;
  if (origin === null || origin[1] !== ev.slug) return refuse("repository.full_name is not the candidate's origin");
  let manifest;
  try {
    manifest = readManifest(studio);
  } catch (e) {
    return refuse(`bisellium.yml does not parse: ${String(e.message).split("\n")[0]}`);
  }
  if (!isObj(manifest)) return refuse("bisellium.yml is not a mapping");
  const excludes = readSourceExcludes(manifest);
  if (excludes.error !== undefined) return refuse(excludes.error);
  const pr = readPr(o, ev);
  if (pr.error !== undefined) return refuse(pr.error);
  const opus = /^opus\/(W-[0-9]+)$/.exec(pr.headRefName);
  if (opus === null) {
    o.log(`certify: PR #${ev.pr} head ${pr.headRefName} is not an opus; nothing to mint`);
    return 0;
  }

  // Phase B moves only the job's disposable candidate checkout.
  o.log(`certify: fetching refs/pull/${ev.pr}/head and master`);
  if (git(candidate, ["fetch", "-q", "origin", `refs/pull/${ev.pr}/head`, "master"]).status !== 0)
    return refuse("git fetch failed");
  if (git(candidate, ["rev-parse", "FETCH_HEAD"]).stdout !== pr.headRefOid)
    return refuse("refs/pull head is not the PR's headRefOid");
  if (git(candidate, ["rev-parse", "refs/remotes/origin/master"]).stdout !== ev.baseSha)
    return refuse("origin/master is not merge_group.base_sha");
  const rebase = ["-c", "user.name=bisellium-ci", "-c", "user.email=ci@bisellium.invalid", "rebase", "-q", "master"];
  if (git(candidate, ["checkout", "-q", "-B", `opus/${opus[1]}`, pr.headRefOid]).status !== 0)
    return refuse("git checkout failed");
  if (git(candidate, ["branch", "-f", "master", ev.baseSha]).status !== 0) return refuse("git branch -f master failed");
  o.log(`certify: rebasing ${pr.headRefName} onto ${ev.baseSha.slice(0, 12)}`);
  if (git(candidate, rebase).status !== 0) {
    git(candidate, ["rebase", "--abort"]);
    o.log("certify: not certified: the PR head conflicts with master; rebase it locally and mint again");
    return 1;
  }
  const rebased = git(candidate, ["rev-parse", "HEAD^{tree}"]);
  const expected = git(candidate, ["rev-parse", `${ev.headSha}^{tree}`]);
  if (rebased.status !== 0 || expected.status !== 0) return refuse("git rev-parse of a tree failed");
  if (rebased.stdout !== expected.stdout) {
    o.log("certify: not certified: the rebased tree is not the merge group's tree");
    return 1;
  }
  o.log("certify: running the mint");
  const argv = [
    process.execPath,
    "--import",
    "tsx",
    join(tooling, "packages/cli/src/main.ts"),
    "run",
    "--sella",
    "builder",
    "--opus",
    opus[1],
    "--studio",
    studio,
    "--repo",
    candidate,
    "--",
    "true",
  ];
  const code = o.mint(argv, candidate);
  o.log(`certify: the mint exited ${code}`);
  return code === 0 ? 0 : 1;
}

function main(argv) {
  const log = (line) => console.log(line);
  const args = readCertifyArgs(argv);
  if (args.error !== undefined) {
    log(`certify: refused: ${args.error}`);
    return 2;
  }
  let event;
  try {
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  } catch {
    log("certify: refused: GITHUB_EVENT_PATH is not a readable JSON file");
    return 2;
  }
  const tooling = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const gh = (a) => {
    const r = spawnSync("gh", a, { encoding: "utf8", timeout: 120_000 });
    return { status: r.status ?? 1, stdout: r.stdout ?? "" };
  };
  const mint = (a, cwd) => spawnSync(a[0], a.slice(1), { cwd, stdio: "inherit" }).status ?? 1;
  return certify({ eventName: process.env.GITHUB_EVENT_NAME ?? "", event, ...args, tooling, gh, mint, log });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
