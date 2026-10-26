/**
 * packages/cli/src/review-request.ts — W-418: `bisellium review-request <pr> [--repo <dir>]`, the `pr` rung's
 * code-owned screen, notice and review request (review-notice.ts) for any open PR into master, one opened by hand (a
 * records PR, `gh pr create`) included. It reads the PR from GitHub, fetches master and the PR's head
 * (`refs/pull/<pr>/head`) from origin, and screens `origin/master...<head>`. Exit 0 when every step ran, 1 at the
 * first refusal or hold, 2 on a usage error.
 */
import { resolve } from "node:path";
import { parseFlags } from "@bisellium/commands/writes.js";
import { clean, git, quoted, repoSlug, sh } from "./integrate.js";
import { PR_NUMBER, reviewNotice } from "./review-notice.js";

export const REVIEW_REQUEST_USAGE = "usage: bisellium review-request <pr> [--repo <dir>]";
const BASE = "refs/remotes/origin/master";
const OID = /^[0-9a-f]{40}$/;
const show = (value: unknown): string => (value === undefined ? "absent" : clean(JSON.stringify(value)));

export function runReviewRequest(argv: string[]): { exitCode: number } {
  const usage = (why: string): { exitCode: number } => {
    console.error(`review-request: ${why}\n${REVIEW_REQUEST_USAGE}`);
    return { exitCode: 2 };
  };
  const parsed = parseFlags(argv, { valued: ["--repo"] });
  if ("error" in parsed) return usage(parsed.error);
  // parseFlags keeps the last of a repeated flag and takes an empty value: either would screen another checkout
  if (argv.filter((a) => a === "--repo").length > 1) return usage("--repo is given more than once");
  if (parsed.values.get("--repo") === "") return usage("--repo needs a non-empty value");
  const arg = parsed.positionals;
  if (arg.length !== 1 || !PR_NUMBER.test(arg[0]!)) return usage("give one PR number");
  const pr = Number(arg[0]);
  const repo = resolve(parsed.values.get("--repo") ?? ".");
  const say = (code: number, lines: string[]): { exitCode: number } => {
    console.log([`review-request: PR #${pr}`, ...lines].map((l) => clean(l, 1000)).join("\n"));
    return { exitCode: code };
  };
  const refuse = (why: string): { exitCode: number } => say(1, [`why: ${why}`]);
  const slug = repoSlug(repo);
  if (!slug.ok) return refuse(slug.reason);
  const v = sh("gh", ["pr", "view", String(pr), "-R", slug.slug, "--json", "number,state,baseRefName,headRefOid"], repo, 1_048_576);
  if (v.error !== undefined || v.status !== 0) return refuse(`gh pr view failed (${clean(v.error?.message ?? v.stderr.trim().split("\n")[0] ?? "") || `exit ${v.status}`})`);
  let view: Record<string, unknown>;
  try {
    const parsedView = JSON.parse(v.stdout) as unknown;
    if (typeof parsedView !== "object" || parsedView === null || Array.isArray(parsedView)) return refuse("gh pr view returned no object");
    view = parsedView as Record<string, unknown>;
  } catch {
    return refuse("gh pr view returned non-JSON output");
  }
  if (view["number"] !== pr) return refuse(`gh pr view returned PR ${show(view["number"])}, not #${pr}`);
  if (view["state"] !== "OPEN") return refuse(`PR #${pr} is ${show(view["state"])}, not OPEN; only an open PR is screened`);
  if (view["baseRefName"] !== "master") return refuse(`PR #${pr}'s base is ${show(view["baseRefName"])}, not master; the screen reads master's owners file`);
  const head = view["headRefOid"];
  if (typeof head !== "string" || !OID.test(head)) return refuse("gh pr view returned no 40-hex headRefOid");
  const master = git(repo, ["fetch", "-q", "--no-tags", "origin", `+refs/heads/master:${BASE}`]);
  if (master.error !== undefined || master.status !== 0) return refuse(`git fetch origin master failed (${clean(master.stderr.trim().split("\n")[0] ?? "") || `exit ${master.status}`})`);
  const fetched = git(repo, ["fetch", "-q", "--no-tags", "origin", `refs/pull/${pr}/head`]);
  if (fetched.error !== undefined || fetched.status !== 0) return refuse(`git fetch origin refs/pull/${pr}/head failed (${clean(fetched.stderr.trim().split("\n")[0] ?? "") || `exit ${fetched.status}`})`);
  const at = git(repo, ["rev-parse", "-q", "--verify", "FETCH_HEAD^{commit}"]).stdout.trim();
  if (at !== head) return refuse(`PR #${pr}'s head on origin is ${at.slice(0, 12) || "unreadable"}, not ${head.slice(0, 12)} as GitHub reported; rerun`);
  const r = reviewNotice({ cwd: repo, slug: slug.slug, pr, base: BASE, head, resume: `bisellium review-request ${pr} --repo ${quoted(repo)}` });
  return say(r.ok ? 0 : 1, r.lines);
}
