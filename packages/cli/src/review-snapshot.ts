/**
 * packages/cli/src/review-snapshot.ts — W-702 (D-250): the review snapshot `bisellium review-request` leaves for each PR
 * that waits on its code owners, at `<git common dir>/bisellium/review-requests/<number>.json`, which the uncredentialed
 * console server reads (apps/server/src/reviewRequests.ts) and projects as GET /api/inbox's `reviewRequests` member.
 *
 * The facts come from one `gh api graphql` read of the PR (its number, state, base, head, title, URL, opening time, its
 * last 100 reviews and its head commit's first 100 check contexts with whether each is required), so every fact is of
 * one moment. Each is checked before anything is written: a reply that is not that PR, open, on master, at the head the
 * screen read, with this repository's github.com URL and complete pages, is no snapshot (fail closed), and the shape
 * shared with the server (`reviewRequestShape`, @bisellium/schema) must hold the result. The file is written whole to a
 * temporary name beside it and renamed over the old one, in a directory the shared containment helper makes or proves.
 * Node built-ins, the schema and the containment helper only, besides the spawn helper review-request already uses.
 */
import { lstatSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureRealDirectory, existingRealDirectory } from "@bisellium/commands/ids.js";
import { instant, REVIEW_REQUEST_LEVELS, REVIEW_REQUEST_MAX_BYTES, type ReviewRequest, reviewRequestFile, reviewRequestShape, reviewRequestState } from "@bisellium/schema";
import { clean, sh } from "./integrate.js";
import { commonDir, type Screen } from "./review-notice.js";

/** The one read of a PR's review facts: GitHub's GraphQL API, through the `gh` login review-request already uses. */
export const REVIEW_FACTS_QUERY =
  "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number state baseRefName headRefOid title url createdAt " +
  "reviews(last:100){pageInfo{hasPreviousPage} nodes{state submittedAt author{login} commit{oid}}} " +
  "commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{__typename " +
  "... on CheckRun{name status conclusion isRequired(pullRequestNumber:$number)} ... on StatusContext{context state isRequired(pullRequestNumber:$number)}}}}}}}}}}";

const GH_MAX_BYTES = 1_048_576;
/** An owner's opinions, as land's owner review reads them (integrate.ts readOwnerReview): a comment is none. */
const OPINIONS = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
const RUN_PENDING = new Set(["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"]);
const RUN_PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const RUN_FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const STATUS_OF: Readonly<Record<string, "pending" | "passed" | "failed">> = { SUCCESS: "passed", PENDING: "pending", EXPECTED: "pending", FAILURE: "failed", ERROR: "failed" };
const LOGIN = /^@([A-Za-z0-9-]+)$/;
const OID = /^[0-9a-f]{40}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** Control characters (C0 and C1) become one space, as the review notice prints a path or a title. */
const strip = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");

export interface FactsInput {
  cwd: string;
  /** The repository's `<owner>/<name>`, as repoSlug reads it. */
  slug: string;
  pr: number;
  /** The head the screen read, which GitHub reported and origin holds. */
  head: string;
  screen: Screen;
  now: Date;
}

/** W-702: PR `pr`'s review facts as a snapshot, from one GraphQL read, or why not. Fails closed on any fact out of its domain. */
export function readReviewFacts(o: FactsInput): { request: ReviewRequest } | { error: string } {
  const slash = o.slug.indexOf("/");
  const r = sh("gh", ["api", "graphql", "-f", `query=${REVIEW_FACTS_QUERY}`, "-F", `owner=${o.slug.slice(0, slash)}`, "-F", `name=${o.slug.slice(slash + 1)}`, "-F", `number=${o.pr}`], o.cwd, GH_MAX_BYTES);
  if (r.error !== undefined) return { error: `gh api graphql failed: ${clean(r.error.message)}` };
  if (r.status !== 0) return { error: `gh api graphql exited ${r.status}: ${clean(r.stderr.trim().split("\n")[0] ?? "")}` };
  let reply: unknown;
  try {
    reply = JSON.parse(r.stdout);
  } catch {
    return { error: "gh api graphql returned non-JSON output" };
  }
  return reviewRequestOf(reply, o);
}

/** W-702: the snapshot a GraphQL reply makes, or the first fact out of its domain. Pure. */
export function reviewRequestOf(reply: unknown, o: Omit<FactsInput, "cwd">): { request: ReviewRequest } | { error: string } {
  const data = isObj(reply) ? reply["data"] : undefined;
  const repository = isObj(data) ? data["repository"] : undefined;
  const p = isObj(repository) ? repository["pullRequest"] : undefined;
  if (!isObj(p)) return { error: "gh api graphql returned no data.repository.pullRequest" };
  if (p["number"] !== o.pr) return { error: `gh api graphql returned PR ${clean(JSON.stringify(p["number"]) ?? "absent")}, not #${o.pr}` };
  if (p["state"] !== "OPEN") return { error: `PR #${o.pr} is ${clean(JSON.stringify(p["state"]) ?? "absent")}, not OPEN` };
  if (p["baseRefName"] !== "master") return { error: `PR #${o.pr}'s base is not master` };
  if (p["headRefOid"] !== o.head) return { error: `PR #${o.pr}'s head moved from ${o.head.slice(0, 12)} while its facts were read; rerun` };
  const url = `https://github.com/${o.slug}/pull/${o.pr}`;
  if (p["url"] !== url) return { error: `PR #${o.pr}'s URL is not ${url}` };
  if (typeof p["title"] !== "string") return { error: `PR #${o.pr} has no string title` };
  // reviews: each owner's latest opinion
  const reviews = p["reviews"];
  const nodes = isObj(reviews) ? reviews["nodes"] : undefined;
  const page = isObj(reviews) ? reviews["pageInfo"] : undefined;
  if (!Array.isArray(nodes) || !isObj(page) || page["hasPreviousPage"] !== false) return { error: `PR #${o.pr}'s reviews are not one complete page of at most 100` };
  const logins = o.screen.owners.flatMap((owner) => LOGIN.exec(owner)?.[1]?.toLowerCase() ?? []);
  const others = o.screen.owners.filter((owner) => !LOGIN.test(owner));
  const latest = new Map<string, { state: string; oid: string; at: number }>();
  for (const n of nodes) {
    const author = isObj(n) && isObj(n["author"]) ? n["author"]["login"] : undefined;
    if (!isObj(n) || typeof author !== "string" || !logins.includes(author.toLowerCase()) || n["state"] === "PENDING") continue;
    const oid = isObj(n["commit"]) ? n["commit"]["oid"] : undefined;
    const at = instant(n["submittedAt"])?.getTime();
    if (typeof n["state"] !== "string" || typeof oid !== "string" || !OID.test(oid) || at === undefined) return { error: `PR #${o.pr} has a review by ${clean(author)} with no state, commit or time` };
    if (!OPINIONS.has(n["state"])) continue;
    const before = latest.get(author.toLowerCase());
    if (before === undefined || at >= before.at) latest.set(author.toLowerCase(), { state: n["state"], oid, at });
  }
  const approved = logins.length > 0 && others.length === 0 && logins.every((l) => latest.get(l)?.state === "APPROVED" && latest.get(l)?.oid === o.head);
  const earlier = [...latest.values()].filter((v) => v.state === "APPROVED" && v.oid !== o.head).sort((a, b) => b.at - a.at)[0];
  const approvalHead = approved ? o.head : earlier?.oid;
  // checks: the head commit's required contexts
  const commits = p["commits"];
  const last = isObj(commits) && Array.isArray(commits["nodes"]) ? commits["nodes"].at(-1) : undefined;
  const commit = isObj(last) ? last["commit"] : undefined;
  if (!isObj(commit) || commit["oid"] !== o.head) return { error: `PR #${o.pr}'s last commit is not its head ${o.head.slice(0, 12)}` };
  const rollup = commit["statusCheckRollup"];
  const contexts = isObj(rollup) ? rollup["contexts"] : undefined;
  if (rollup !== null && (!isObj(contexts) || !Array.isArray(contexts["nodes"]) || !isObj(contexts["pageInfo"]) || contexts["pageInfo"]["hasNextPage"] !== false))
    return { error: `PR #${o.pr}'s checks are not one complete page of at most 100` };
  const checks: ReviewRequest["checks"] = [];
  for (const c of isObj(contexts) && Array.isArray(contexts["nodes"]) ? contexts["nodes"] : []) {
    const kind = isObj(c) ? c["__typename"] : undefined;
    if (!isObj(c) || typeof c["isRequired"] !== "boolean" || (kind !== "CheckRun" && kind !== "StatusContext")) return { error: `PR #${o.pr} has a check that is neither a check run nor a status with a required flag` };
    const name = kind === "CheckRun" ? c["name"] : c["context"];
    const status =
      kind === "StatusContext"
        ? STATUS_OF[String(c["state"])]
        : c["status"] === "COMPLETED"
          ? RUN_PASSED.has(String(c["conclusion"]))
            ? "passed"
            : RUN_FAILED.has(String(c["conclusion"]))
              ? "failed"
              : undefined
          : RUN_PENDING.has(String(c["status"]))
            ? "pending"
            : undefined;
    if (typeof name !== "string" || status === undefined) return { error: `PR #${o.pr} has a check with no name or an unknown status` };
    if (c["isRequired"]) checks.push({ name: strip(name), status });
  }
  const owners = o.screen.owners.map(strip);
  const n = o.screen.paths.length;
  const draft = {
    schema: "bisellium.review-request/1",
    number: o.pr,
    title: strip(p["title"]).slice(0, 1024),
    url,
    reason: `Changes ${n} code-owned path${n === 1 ? "" : "s"} owned by ${owners.join(", ")}`.slice(0, 1024),
    protectedPaths: [...new Set(o.screen.paths.map(strip))],
    checks,
    openedAt: p["createdAt"],
    observedAt: o.now.toISOString(),
    head: o.head,
    ...(approvalHead === undefined ? {} : { approvalHead }),
    forge: "github",
    state: reviewRequestState(o.head, approvalHead, checks),
  };
  try {
    return { request: reviewRequestShape(draft) };
  } catch (e) {
    return { error: `PR #${o.pr}'s facts make no snapshot (${clean(e instanceof Error ? e.message : String(e))})` };
  }
}

/** W-702: writes PR `r.number`'s snapshot under the Git common directory of the checkout at `cwd`, whole, by a rename over
 *  the old one. Undefined when written, else why not; nothing is left at the temporary name. */
export function writeReviewSnapshot(cwd: string, r: ReviewRequest): string | undefined {
  const common = commonDir(cwd);
  if ("error" in common) return `git rev-parse --git-common-dir failed (${common.error})`;
  const text = reviewRequestFile(reviewRequestShape(JSON.parse(reviewRequestFile(r)) as unknown));
  if (Buffer.byteLength(text) > REVIEW_REQUEST_MAX_BYTES) return `the snapshot is over ${REVIEW_REQUEST_MAX_BYTES} bytes`;
  let temp: string | undefined;
  try {
    const dir = ensureRealDirectory(common.path, ...REVIEW_REQUEST_LEVELS);
    temp = join(dir, `.${r.number}.${process.pid}`);
    writeFileSync(temp, text, { flag: "wx" });
    renameSync(temp, join(dir, `${r.number}.json`));
    return undefined;
  } catch (e) {
    if (temp !== undefined)
      try {
        unlinkSync(temp);
      } catch {
        /* nothing was left, or it cannot be removed: the reader skips a dot name */
      }
    return clean(e instanceof Error ? e.message : String(e));
  }
}

/** W-702 retention: removes PR `pr`'s snapshot, when there is one, under the Git common directory of the checkout at `cwd`.
 *  A symlinked level refuses; the entry itself is unlinked, never followed. */
export function dropReviewSnapshot(cwd: string, pr: number): { removed: boolean } | { error: string } {
  const common = commonDir(cwd);
  if ("error" in common) return { error: `git rev-parse --git-common-dir failed (${common.error})` };
  try {
    const dir = existingRealDirectory(common.path, ...REVIEW_REQUEST_LEVELS);
    if (dir === undefined) return { removed: false };
    const path = join(dir, `${pr}.json`);
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return { removed: false };
    unlinkSync(path);
    return { removed: true };
  } catch (e) {
    return { error: clean(e instanceof Error ? e.message : String(e)) };
  }
}
