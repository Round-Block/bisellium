/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, appendFileSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { admitCurrentRunReceipt } from "@bisellium/commands/builder-run.js";
import { takeNotices } from "./review-notice.js";
import { BRANCH, Json, OPUS, Out, PR_NUMBER, QUEUE_CONTEXTS, QUEUE_RULES, REPO_ROOT, Reply, SETUP_ENV, SLUG, SlotValue, T, World, advanceOrigin, cand, cli, commit, expectHeld, expectStep, ghCalls, ghMerges, git, gitq, landMerge, mergedList, modeLine, mutating, next, openList, outLines, performMerge, performPr, pushed, put, queueWorld, ran, remoteBranchExists, reviewed, scenario, scratch, sourceTree, tipOf, unmatched, viewOf, world, writeReceipt } from "./next-world.test.js";

/** W-199: the queue binding is a file under the Git common directory (read through the fixture `git`, which throws on a failed read). */
const bindingPath = (w: World): string => join(git(w.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "bisellium", "queue", encodeURIComponent(BRANCH));
const rulesWith = (edit: (rules: Json[]) => Json[]): SlotValue => ({ stdout: edit(structuredClone(QUEUE_RULES)) });
const queueParams = (rules: Json[]): Json => rules.find((r) => r["type"] === "merge_queue")!["parameters"] as Json;
const checksRule = (rules: Json[]): Json => rules.find((r) => r["type"] === "required_status_checks")!["parameters"] as Json;
const bound = (w: World): string => readFileSync(bindingPath(w), "utf8");

/** Fixed copy of gh 2.101.0's `pr view --json` "Available fields" output; the offline row cannot ask gh for it. */
const GH_2_101_PR_VIEW_FIELDS = new Set([
  "additions",
  "assignees",
  "author",
  "autoMergeRequest",
  "baseRefName",
  "baseRefOid",
  "body",
  "changedFiles",
  "closed",
  "closedAt",
  "closingIssuesReferences",
  "comments",
  "commits",
  "createdAt",
  "deletions",
  "files",
  "fullDatabaseId",
  "headRefName",
  "headRefOid",
  "headRepository",
  "headRepositoryOwner",
  "id",
  "isCrossRepository",
  "isDraft",
  "labels",
  "latestReviews",
  "maintainerCanModify",
  "mergeCommit",
  "mergeStateStatus",
  "mergeable",
  "mergedAt",
  "mergedBy",
  "milestone",
  "number",
  "potentialMergeCommit",
  "projectCards",
  "projectItems",
  "reactionGroups",
  "reviewDecision",
  "reviewRequests",
  "reviews",
  "state",
  "statusCheckRollup",
  "title",
  "updatedAt",
  "url",
]);

test("W-168-b3 behaviour 3: in queue mode pr binds and pushes the reviewed head without a rebase and the ladder names merge (W-199-b1)", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-queue", { stdout: QUEUE_RULES });
  const head = tipOf(w);
  const o = performPr(w);
  assert.deepEqual(mutating(w), ["git fetch master:master", "git push --force-with-lease", "gh pr create"], ran("queue-mode pr never rebases", o));
  assert.equal(o.status, 0, ran("queue-mode pr exits 0", o));
  assert.equal(o.out.split("\n")[1], "mode: merge-queue", ran("the mode line is the first line of the result", o));
  assert.equal(git(w.origin, ["rev-parse", `refs/heads/${BRANCH}`]), head, "the pushed head is the reviewed head");
  assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, true, "the receipt is still admitted");
  assert.equal(bound(w), `${head}\n`, "the queue binding holds the pushed head");
  assert.deepEqual(unmatched(w), [], "no unexpected gh call");
  const rulesRead = ghCalls(w).filter((a) => a[0] === "api");
  assert.deepEqual(rulesRead, [["api", `repos/${SLUG}/rules/branches/master?per_page=100`]], "one rules read");
  expectStep(next(w, [OPUS]), "merge", "named", "the ladder goes on to merge, not build");
});

test("W-168-b3 behaviour 3: a binding that cannot be written holds the queue-mode pr before any push (W-199-b1)", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-lock", { stdout: QUEUE_RULES });
  const blocker = join(w.repo, ".git", "bisellium");
  writeFileSync(blocker, "a regular file where the binding directory belongs\n");
  const o = performPr(w);
  assert.deepEqual(mutating(w), ["git fetch master:master"], ran("no push when the binding cannot be written", o));
  assert.equal(o.status, 1, ran("held", o));
  assert.equal(remoteBranchExists(w), false, "nothing was pushed");
  assert.equal(o.out.split("\n")[1], "mode: merge-queue", ran("the mode line precedes the why", o));
  const why = o.out.split("\n").find((l) => l.startsWith("why:"));
  assert.ok(why?.startsWith("why: cannot write the queue binding ") && why.includes("bisellium/queue/opus%2FW-900"), ran("the why names the binding file", o));
  assert.equal(lstatSync(blocker).isFile(), true, "the blocking file is untouched");
});

test("W-168-b3 behaviour 3: a direct-mode pr after a queue-mode pr pushes and unsets the binding (W-199-b1)", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-unset", { stdout: QUEUE_RULES }, false);
  const first = performPr(w);
  assert.equal(first.status, 0, ran("queue-mode pr", first));
  const old = bound(w).trim();
  assert.notEqual(old, "", "the binding is set");
  put(w.wtStudio, "notes.md", "bookkeeping line\nmore bookkeeping\n");
  commit(w.wt, "studio: bookkeeping after the push");
  scenario(w, { list: openList(w, { state: "OPEN", oid: old }) });
  const o = performPr(w);
  assert.deepEqual(mutating(w), ["git fetch master:master", "git rebase", "git push --force-with-lease"], ran("direct-mode pr rebases and pushes", o));
  assert.equal(o.out.split("\n")[1], "mode: direct", ran("the mode line", o));
  assert.equal(lstatSync(bindingPath(w), { throwIfNoEntry: false }), undefined, "the binding is gone after the push");
  assert.equal(git(w.origin, ["rev-parse", `refs/heads/${BRANCH}`]), tipOf(w), "the new tip was pushed");
});

test("W-199-b1 behaviour 1: a direct-mode pr holds before the rebase when the binding cannot be read", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w199-b1-unreadable", { stdout: [] });
  writeFileSync(join(w.repo, ".git", "bisellium"), "a regular file where the binding directory belongs\n");
  const before = tipOf(w);
  const o = performPr(w);
  assert.equal(o.status, 1, ran("held", o));
  const why = o.out.split("\n").find((l) => l.startsWith("why:"));
  assert.ok(why?.startsWith("why: cannot read the queue binding:"), ran("the why", o));
  assert.equal(tipOf(w), before, "no rebase");
  assert.equal(remoteBranchExists(w), false, "nothing was pushed");
});

test("W-199-b1 behaviour 1: a direct-mode pr that pushed but cannot remove the binding holds before gh pr create", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w199-b1-undeletable", { stdout: [] }, false);
  mkdirSync(bindingPath(w), { recursive: true });
  const o = performPr(w);
  assert.equal(o.status, 1, ran("held", o));
  const why = o.out.split("\n").find((l) => l.startsWith("why:"));
  assert.ok(why?.startsWith("why: pushed, but the queue binding "), ran("the why", o));
  assert.equal(git(w.origin, ["rev-parse", `refs/heads/${BRANCH}`]), tipOf(w), "the head was pushed");
  assert.equal(lstatSync(bindingPath(w)).isDirectory(), true, "the obstacle is still there");
  assert.equal(existsSync(join(w.root, "created.flag")), false, "no gh pr create");
});

/** Each reply is direct mode: today's rebase and hold, the mode line, no queue call. */
function expectDirect(variants: [string, SlotValue][]): void {
  for (const [row, rules] of variants) {
    const w = reviewed(`w168-b3-direct-${row.replace(/\W+/g, "-")}`, { mainOnMaster: false });
    advanceOrigin(w, "trunk.txt", "a new trunk file changes the SOURCE tree\n");
    scenario(w, { rules });
    const o = performPr(w);
    assert.deepEqual(mutating(w), ["git fetch master:master", "git rebase"], ran(`${row}: today's rebase and hold`, o));
    assert.equal(modeLine(o), "mode: direct", ran(`${row}: mode: direct`, o));
    assert.match(o.out, /\bbuild\b/, ran(`${row}: re-derives build`, o));
    assert.deepEqual(unmatched(w), [], `${row}: no unexpected gh call`);
  }
}

test("W-168-b3 behaviour 3: any reply short of the full setup is direct mode and keeps today's calls", { timeout: 3_600_000 }, () => {
  const drop = (key: string) => (rules: Json[]): Json[] => {
    delete queueParams(rules)[key];
    return rules;
  };
  const variants: [string, SlotValue][] = [
    ["no merge-queue rule", rulesWith((r) => r.filter((x) => x["type"] !== "merge_queue"))],
    ["a second merge-queue entry", rulesWith((r) => [...r, structuredClone(r.find((x) => x["type"] === "merge_queue")!)])],
    ["max_entries_to_build 4", rulesWith((r) => ((queueParams(r)["max_entries_to_build"] = 4), r))],
    ["merge_method MERGE", rulesWith((r) => ((queueParams(r)["merge_method"] = "MERGE"), r))],
    ["a wait of 5 minutes", rulesWith((r) => ((queueParams(r)["min_entries_to_merge_wait_minutes"] = 5), r))],
    ["grouping HEADGREEN", rulesWith((r) => ((queueParams(r)["grouping_strategy"] = "HEADGREEN"), r))],
    ["a 60 minute timeout", rulesWith((r) => ((queueParams(r)["check_response_timeout_minutes"] = 60), r))],
    ["a removed parameter", rulesWith(drop("max_entries_to_merge"))],
    ["an extra parameter", rulesWith((r) => ((queueParams(r)["extra"] = true), r))],
    ["no required-checks rule", rulesWith((r) => r.filter((x) => x["type"] !== "required_status_checks"))],
    ...QUEUE_CONTEXTS.map((context): [string, SlotValue] => [
      `${context} missing`,
      rulesWith((r) => {
        const p = checksRule(r);
        p["required_status_checks"] = (p["required_status_checks"] as Json[]).filter((c) => c["context"] !== context);
        return r;
      }),
    ]),
    [
      "certify without an integration_id",
      rulesWith((r) => {
        delete (checksRule(r)["required_status_checks"] as Json[]).find((c) => c["context"] === "certify")!["integration_id"];
        return r;
      }),
    ],
    [
      "gates with another integration_id",
      rulesWith((r) => {
        (checksRule(r)["required_status_checks"] as Json[]).find((c) => c["context"] === "gates")!["integration_id"] = 1234;
        return r;
      }),
    ],
    ["a strict second required-checks rule", rulesWith((r) => [...r, { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [] } }])],
    ["100 entries", rulesWith((r) => [...r, ...Array.from({ length: 100 - r.length }, () => ({ type: "deletion" }))])],
    ["a gh exit 1", { exit: 1, stderr: "HTTP 500" }],
    ["a non-array reply", { stdout: { message: "Not Found" } }],
  ];
  expectDirect(variants);
});

test("W-168-b3 behaviour 3: a malformed part anywhere in the reply is direct mode, never filtered out", { timeout: 3_600_000 }, () => {
  const addCheck = (member: unknown) => (rules: Json[]): Json[] => {
    const list = checksRule(rules)["required_status_checks"] as unknown[];
    list.unshift(member);
    return rules;
  };
  expectDirect([
    ["a null required-status-check member", rulesWith(addCheck(null))],
    ["a string required-status-check member", rulesWith(addCheck("gates"))],
    ["a member with a non-string context", rulesWith(addCheck({ context: 7, integration_id: 15368 }))],
    ["a member with a non-numeric integration_id", rulesWith(addCheck({ context: "extra", integration_id: "15368" }))],
    [
      "a second required-checks rule whose list is not an array",
      rulesWith((r) => [...r, { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: "gates" } }]),
    ],
    ["a null rule entry beside the valid ones", rulesWith((r) => [...r, null as unknown as Json])],
    ["a rule entry with a non-string type beside the valid ones", rulesWith((r) => [...r, { type: 5 }])],
    ["a rule whose parameters are not an object", rulesWith((r) => [...r, { type: "deletion", parameters: "x" }])],
    ["a required-checks rule without a boolean strict flag", rulesWith((r) => ((checksRule(r)["strict_required_status_checks_policy"] = "false"), r))],
  ]);
});

test("W-168-b3 behaviour 3: a tracked change holds pr with today's lines and no mode line", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w168-b3-dirty", { stdout: QUEUE_RULES });
  appendFileSync(join(w.wtStudio, "notes.md"), "uncommitted bookkeeping edit\n");
  const o = performPr(w);
  expectHeld(o, "a tracked change holds");
  assert.equal(modeLine(o), undefined, ran("no mode line before the mode read", o));
  assert.deepEqual(mutating(w), [], "nothing was fetched or pushed");
});

const CONFLICT_WHY = `why: PR #${PR_NUMBER} conflicts with master; rebase ${BRANCH} and resolve it there: that changes the SOURCE tree and needs its gates (bisellium ci --opus) and review again`;
const lineAfter = (o: Out, prefix: string): string | undefined => o.out.split("\n").find((l) => l.startsWith(prefix));

test("W-168-b4 behaviour 4: in queue mode merge enqueues once and never updates the branch", { timeout: 3_600_000 }, () => {
  const w = pushed("w168-b4-behind");
  const flag = join(w.root, "merged.flag");
  const m = landMerge(w, false);
  scenario(w, {
    rules: { stdout: QUEUE_RULES },
    list: openList(w),
    view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m })) }] }] },
    merge: { replies: [{ stdout: "", touch: flag }] },
  });
  const o = performMerge(w);
  assert.deepEqual(mutating(w), ["gh pr merge --squash --auto", "git fetch master:master"], ran("a BEHIND PR is enqueued, never updated", o));
  assert.match(o.out, /state=MERGED/, ran("and lands", o));
  assert.equal(o.out.split("\n")[1], "mode: merge-queue", ran("the mode line comes first", o));
  assert.equal(ghCalls(w).filter((a) => a[0] === "api" && a[1] === `repos/${SLUG}/rules/branches/master?per_page=100`).length, 2, "the rules are read, then read again just before the merge call");
  assert.deepEqual(unmatched(w), [], "no unexpected gh call");
});

test("W-168-b4 behaviour 4: a queued CLEAN PR gets no second merge call", { timeout: 3_600_000 }, () => {
  const w = pushed("w168-b4-clean");
  scenario(w, { rules: { stdout: QUEUE_RULES }, list: openList(w), view: { stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) } });
  const o = performMerge(w);
  assert.equal(ghMerges(w).length, 1, ran("exactly one gh pr merge call", o));
  assert.deepEqual(mutating(w), ["gh pr merge --squash --auto"], "no direct merge and no update-branch");
  assert.match(o.out, /state=QUEUE_TIMEOUT/, ran("and the poll runs out", o));
});

test("W-351-b1 behaviour 1: every fixed pr view field is accepted by gh 2.101.0", { timeout: 3_600_000 }, () => {
  const w = pushed("w351-b1-view-fields");
  scenario(w, { rules: { stdout: QUEUE_RULES }, list: openList(w), view: { stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) } });
  const o = performMerge(w);
  const reads = ghCalls(w).filter((a) => a[0] === "pr" && a[1] === "view");
  assert.ok(reads.length > 0, ran("the merge performed a fixed pr view read", o));
  for (const read of reads) {
    const at = read.indexOf("--json");
    assert.notEqual(at, -1, ran("the fixed view names its JSON fields", o));
    const fields = (read[at + 1] ?? "").split(",");
    assert.deepEqual(
      fields.filter((field) => !GH_2_101_PR_VIEW_FIELDS.has(field)),
      [],
      ran("every fixed pr view field is accepted by gh 2.101.0", o),
    );
  }
});

test("W-347-b1 behaviour 1: a CLEAN PR outside the merge queue has auto-merge re-armed once", { timeout: 3_600_000 }, () => {
  const w = pushed("w347-b1-clean-not-queued");
  const rearmed = join(w.root, "rearmed.flag");
  const m = landMerge(w, false);
  scenario(w, {
    rules: { stdout: QUEUE_RULES },
    list: openList(w),
    view: {
      replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) }],
      alts: [{ ifExists: rearmed, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m })) }] }],
    },
    queue: { stdout: { data: { repository: { pullRequest: { isInMergeQueue: false } } } } },
    merge: { replies: [{ stdout: "" }, { stdout: "" }, { stdout: "", touch: rearmed }] },
  });
  const o = performMerge(w);
  assert.match(o.out, /state=MERGED/, ran("the re-armed PR enters the queue and lands", o));
  assert.deepEqual(mutating(w), ["gh pr merge --squash --auto", "gh pr merge --disable-auto", "gh pr merge --squash --auto", "git fetch master:master"], ran("auto-merge is disabled then enabled once", o));
  const merges = ghMerges(w);
  assert.equal(merges[1]?.includes("--disable-auto"), true, ran("the middle call disables auto-merge", o));
  assert.equal(merges[1]?.includes("--squash"), false, ran("the disable call carries no merge method", o));
  assert.equal(merges[2]?.[merges[2]!.indexOf("--match-head-commit") + 1], tipOf(w), ran("the enabling call pins the reviewed head", o));
  assert.deepEqual(unmatched(w), [], "the fixture saw every gh call");
});

test("W-351-b2 behaviour 2: queue membership is read through GraphQL and an unreadable answer holds", { timeout: 3_600_000 }, () => {
  const variants: [string, SlotValue][] = [
    ["a missing pull request", { stdout: { data: { repository: { pullRequest: null } } } }],
    ["text instead of a boolean", { stdout: { data: { repository: { pullRequest: { isInMergeQueue: "false" } } } } }],
    ["a GraphQL command failure", { exit: 1, stderr: "graphql denied" }],
  ];
  for (const [label, queue] of variants) {
    const w = pushed(`w351-b2-${label.replaceAll(" ", "-")}`);
    scenario(w, {
      rules: { stdout: QUEUE_RULES },
      list: openList(w),
      view: { stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) },
      queue,
    });
    const o = performMerge(w);
    assert.equal(o.status, 1, ran(`${label}: the merge holds`, o));
    assert.match(o.out, /queue membership unreadable after the merge was requested; auto-merge was not re-armed/, ran(`${label}: the hold states the closed failure`, o));
    assert.deepEqual(mutating(w), ["gh pr merge --squash --auto"], ran(`${label}: no recovery write follows the unreadable answer`, o));
    const reads = ghCalls(w).filter((a) => a[0] === "api" && a[1] === "graphql");
    assert.equal(reads.length, 1, ran(`${label}: membership is read once`, o));
    const [owner, name] = SLUG.split("/");
    assert.ok(reads[0]?.includes(`owner=${owner}`), ran(`${label}: the owner is a GraphQL variable`, o));
    assert.ok(reads[0]?.includes(`name=${name}`), ran(`${label}: the repository name is a GraphQL variable`, o));
    assert.ok(reads[0]?.includes(`number=${PR_NUMBER}`), ran(`${label}: the PR number is a GraphQL variable`, o));
    assert.deepEqual(unmatched(w), [], `${label}: the fixture saw every gh call`);
  }
});

test("W-168-b4 behaviour 4: a DIRTY PR holds as a conflict in queue mode", { timeout: 3_600_000 }, () => {
  const before = pushed("w168-b4-dirty");
  scenario(before, { rules: { stdout: QUEUE_RULES }, list: openList(before), view: { stdout: viewOf(cand(before, { state: "OPEN", mss: "DIRTY" })) } });
  const o = performMerge(before);
  assert.deepEqual(mutating(before), [], ran("a DIRTY PR is never merged or updated", o));
  assert.match(o.out, /state=CONFLICT/, ran("state=CONFLICT", o));
  assert.ok(o.out.split("\n").includes(CONFLICT_WHY), ran("with the conflict why", o));
  assert.equal(o.status, 1);

  const after = pushed("w168-b4-dirty-after");
  const flag = join(after.root, "merged.flag");
  scenario(after, {
    rules: { stdout: QUEUE_RULES },
    list: openList(after),
    view: { replies: [{ stdout: viewOf(cand(after, { state: "OPEN" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(after, { state: "OPEN", mss: "DIRTY" })) }] }] },
    merge: { replies: [{ stdout: "", touch: flag }] },
  });
  const o2 = performMerge(after);
  assert.deepEqual(mutating(after), ["gh pr merge --squash --auto"], ran("one merge call, then the hold", o2));
  assert.match(o2.out, /state=CONFLICT/, ran("a PR that turns DIRTY after the request holds", o2));
  assert.ok(o2.out.split("\n").includes(CONFLICT_WHY), ran("with the conflict why", o2));
});

test("W-168-b4 behaviour 4: a changed setup at the recheck holds with nothing enqueued", { timeout: 3_600_000 }, () => {
  const w = pushed("w168-b4-recheck");
  scenario(w, { rules: { replies: [{ stdout: QUEUE_RULES }, { stdout: [] }] }, list: openList(w) });
  const o = performMerge(w);
  assert.deepEqual(mutating(w), [], ran("no gh write after the setup changed", o));
  assert.ok(o.out.includes("why: master's merge-queue setup changed while the merge step ran; nothing was enqueued"), ran("the why", o));
  assert.equal(o.out.split("\n")[1], "mode: merge-queue");
  assert.equal(o.status, 1);
});

/** W-199: a direct-mode merge of a PR whose binding is present or unreadable holds with W-168's why, before any gh write. */
function expectBoundHold(w: World, row: string): void {
  const updated = join(w.root, "updated.flag");
  const flag = join(w.root, "merged.flag");
  scenario(w, { rules: { stdout: [] }, list: openList(w), update: { stdout: "", touch: updated }, merge: { replies: [{ stdout: "", touch: flag }] } });
  const o = performMerge(w);
  assert.deepEqual(mutating(w), [], ran(`${row}: a PR pushed for the queue is held when the queue is gone`, o));
  assert.equal(o.out.split("\n")[1], "mode: direct", ran(`${row}: the mode line`, o));
  assert.ok(
    o.out.includes(`why: PR #${PR_NUMBER} was pushed for the merge queue without a rebase, and master no longer enforces the queue; rebase ${BRANCH} onto master, which changes the SOURCE tree and needs its gates (bisellium ci --opus) and review again`),
    ran(`${row}: the why`, o),
  );
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  assert.equal(ghMerges(w).length, 0, `${row}: no gh pr merge`);
  assert.equal(existsSync(flag) || existsSync(updated), false, `${row}: no gh write reached the stub`);
  assert.ok(
    ghCalls(w).some((a) => a.length === 2 && a[0] === "api" && a[1] === `repos/${SLUG}/rules/branches/master?per_page=100`),
    `${row}: the rules were read`,
  );
}

test("W-168-b4 behaviour 4: in direct mode a bound PR holds and an unbound one keeps today's calls (W-199-b2)", { timeout: 3_600_000 }, () => {
  const bound = pushed("w168-b4-bound");
  const file = bindingPath(bound);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${tipOf(bound)}\n`);
  expectBoundHold(bound, "bound");

  const w = pushed("w168-b4-unbound");
  const updated = join(w.root, "updated.flag");
  const flag = join(w.root, "merged.flag");
  const m = landMerge(w, false);
  scenario(w, {
    list: openList(w),
    view: {
      replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }],
      alts: [
        { ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m })) }] },
        { ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) }] },
      ],
    },
    update: { stdout: "", touch: updated },
    merge: { replies: [{ stdout: "", touch: flag }] },
  });
  const o2 = performMerge(w);
  assert.deepEqual(mutating(w), ["gh pr update-branch", "gh pr merge --squash --auto", "git fetch master:master"], ran("direct mode with no binding updates a BEHIND PR", o2));
  assert.equal(o2.out.split("\n")[1], "mode: direct", ran("the mode line", o2));

  const merged = pushed("w168-b4-merged");
  const mergedM = landMerge(merged, false);
  scenario(merged, { rules: { stdout: QUEUE_RULES }, list: mergedList(merged, { merge: mergedM }) });
  const o3 = performMerge(merged);
  assert.match(o3.out, /state=MERGED/, ran("an already-MERGED PR lands", o3));
  assert.equal(lineAfter(o3, "mode:"), undefined, ran("and reads no mode", o3));
});

test("W-199-b2 behaviour 2: a direct-mode merge holds a PR whose binding cannot be read", { timeout: 3_600_000 }, () => {
  const w = pushed("w199-b2-unreadable");
  writeFileSync(join(w.repo, ".git", "bisellium"), "a regular file where the binding directory belongs\n");
  expectBoundHold(w, "unreadable");
});

// ---------------------------------------------------------------------------
// W-197 behaviour 1: `.github/` is a Patron path for every existing Patron hold
// ---------------------------------------------------------------------------
const CI_YML = ".github/workflows/ci.yml";
/** What a hold must leave byte-identical, read only through the fixture `git` (it throws on a failed read) and `readFileSync`. */
const frozenGithub = (w: World): string =>
  [git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["ls-files", "-s"]), git(w.repo, ["status", "--porcelain"]), readFileSync(join(w.repo, CI_YML), "utf8")].join("\n--\n");

test("W-197-b1 behaviour 1: .github/ is a Patron path for every existing Patron hold", { timeout: 1_800_000 }, () => {
  // merge: the reviewed merge commit changes a .github/ path
  const w = reviewed(
    "w197-b1-merge",
    { github: true },
    (x) => {
      put(x.wt, CI_YML, "name: ci v2\n");
      commit(x.wt, `feat(${OPUS}): workflow change`);
      writeReceipt(x, "current");
    },
    true,
  );
  const m = landMerge(w, false);
  scenario(w, { list: mergedList(w, { merge: m }) });
  expectStep(next(w, [OPUS]), "merge", "named", "the world sits at merge");
  const before = frozenGithub(w);
  const held = performMerge(w);
  expectHeld(held, "merge: held");
  assert.equal(frozenGithub(w), before, ran("merge: nothing is mutated (HEAD, master, index, status, ci.yml bytes)", held));
  const lines = outLines(held);
  const why = lines.findIndex((l) => l === `why: refusing: incoming paths belong to the Patron (${CI_YML}); the main checkout is untouched`);
  assert.notEqual(why, -1, ran("merge: the why line names the .github/ path", held));
  assert.equal(lines[why - 1], `state=MERGED_NOT_FETCHED`, ran("merge: the state line precedes the why line", held));
  assert.equal(lines[why + 1], `patron: git -C ${w.repo} merge --ff-only ${m}`, ran("merge: the patron line follows the why line", held));
  // the Patron runs that exact line, and next moves on
  const [bin, ...args] = lines[why + 1]!.slice("patron: ".length).split(" ");
  assert.equal(bin, "git");
  git(w.root, args);
  expectStep(next(w, [OPUS]), "cleanup", "named", "after the Patron's command next derives cleanup");

  // branch and done: a tracked edit to a .github/ path holds the rung and prints the Patron's checkout line
  const dirtyRow = (row: string, o: Out, w2: World, was: string): void => {
    expectHeld(o, row);
    assert.equal(frozenGithub(w2), was, ran(`${row}: nothing is mutated`, o));
    const ls = outLines(o);
    const at = ls.indexOf("why: refusing: the working tree has tracked changes");
    assert.notEqual(at, -1, ran(`${row}: the why line`, o));
    assert.ok(ls.indexOf(`dirty: M ${CI_YML}`) > at, ran(`${row}: the dirty line follows the why line`, o));
    assert.ok(ls.indexOf(`patron: git -C ${w2.repo} checkout -- ${CI_YML}`) > at, ran(`${row}: the patron checkout line`, o));
  };
  const b = world("w197-b1-branch", "spec", { github: true });
  appendFileSync(join(b.repo, CI_YML), "edit\n");
  const bBefore = frozenGithub(b);
  dirtyRow("branch", next(b, [OPUS, "--perform", "--expect", "branch"]), b, bBefore);
  assert.equal(git(b.repo, ["for-each-ref", "--format=%(refname)", `refs/heads/${BRANCH}`]), "", "branch: no branch was cut");
  const d = world("w197-b1-done", "cleanup", { github: true });
  scenario(d, { list: mergedList(d) });
  appendFileSync(join(d.repo, CI_YML), "edit\n");
  const dBefore = frozenGithub(d);
  dirtyRow("done", next(d, [OPUS, "--perform", "--expect", "done"]), d, dBefore);
  assert.equal(git(d.repo, ["for-each-ref", "--format=%(refname)", `refs/heads/chore/done-${OPUS}`]), "", "done: no chore branch was made");

  // renames: out of .github/ restores the original from HEAD, into .github/ takes the destination out of the index
  const out = world("w197-b1-rename-out", "spec", { github: true });
  git(out.repo, ["mv", CI_YML, "docs/ci.yml"]);
  const outHeld = next(out, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(outHeld, "branch with a staged rename out of .github/");
  assert.ok(outLines(outHeld).includes(`patron: git -C ${out.repo} checkout HEAD -- ${CI_YML}`), ran("rename out: checkout HEAD of the original", outHeld));
  const into = world("w197-b1-rename-into", "spec", { github: true });
  git(into.repo, ["mv", "README.md", ".github/readme.md"]);
  const intoHeld = next(into, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(intoHeld, "branch with a staged rename into .github/");
  assert.ok(outLines(intoHeld).includes(`patron: git -C ${into.repo} rm --cached -q -- .github/readme.md`), ran("rename into: rm --cached of the destination", intoHeld));
});

// ---------------------------------------------------------------------------
// W-197 behaviour 2: the GitHub owner rule covers .github/, itself included
// ---------------------------------------------------------------------------
test("W-197-b2 behaviour 2: .github/CODEOWNERS names @edckt for /.github/, itself included", () => {
  const path = join(REPO_ROOT, ".github/CODEOWNERS");
  assert.ok(existsSync(path), ".github/CODEOWNERS exists");
  assert.equal(readFileSync(path, "utf8"), "# Patron-only surfaces: a PR touching these needs the Patron's review.\n/.github/                 @edckt\n/scripts/ci-certify.mjs   @edckt\n/scripts/ci-certificate.mjs @edckt\n/.claude/                 @edckt\n/studio/leges/            @edckt\n/studio/decisions/        @edckt\n/studio/bisellium.yml     @edckt\n/studio/prompts/          @edckt\n/docs/ADOPTION.md         @edckt\n");
});

// ---------------------------------------------------------------------------
// W-197 pin: the code-owner setting does not change the merge-queue mode
// ---------------------------------------------------------------------------
/** Master's active rules as the live reply read on 2026-10-09, with the two booleans the Patron's setup turns on. */
const LIVE_RULES_WITH_OWNER_REVIEW: Json[] = [{"type": "deletion", "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "non_fast_forward", "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "pull_request", "parameters": {"required_approving_review_count": 0, "dismiss_stale_reviews_on_push": true, "required_reviewers": [], "require_code_owner_review": true, "dismissal_restriction": {"enabled": false, "allowed_actors": []}, "require_last_push_approval": false, "required_review_thread_resolution": true, "require_extra_approval_for_unattributed_changes": true, "allowed_merge_methods": ["merge", "squash", "rebase"]}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false, "do_not_enforce_on_create": false, "required_status_checks": [{"context": "gates", "integration_id": 15368}, {"context": "officina", "integration_id": 15368}, {"context": "web-e2e", "integration_id": 15368}, {"context": "certify", "integration_id": 15368}]}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "code_scanning", "parameters": {"code_scanning_tools": [{"tool": "CodeQL", "security_alerts_threshold": "medium_or_higher", "alerts_threshold": "errors_and_warnings"}]}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "code_quality", "parameters": {"severity": "errors"}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}, {"type": "merge_queue", "parameters": {"merge_method": "SQUASH", "max_entries_to_build": 1, "min_entries_to_merge": 1, "max_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0, "grouping_strategy": "ALLGREEN", "check_response_timeout_minutes": 120}, "ruleset_source_type": "Repository", "ruleset_source": "Round-Block/bisellium", "ruleset_id": 23720000}];

test("W-197 pin: the pull_request rule's code-owner and stale-review booleans leave the mode merge-queue", { timeout: 3_600_000 }, () => {
  const w = queueWorld("w197-pin", { stdout: LIVE_RULES_WITH_OWNER_REVIEW });
  const o = performPr(w);
  assert.equal(modeLine(o), "mode: merge-queue", ran("the mode line", o));
});

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// W-384: the opus merge step's first auto-merge call on a PR that is already merged
// ---------------------------------------------------------------------------
test("W-384-b2 behaviour 2: the merge step counts a PR as landed when arming auto-merge fails and one fresh read shows it MERGED on its pinned head, and keeps the failure for any other read", { timeout: 3_600_000 }, () => {
  const ALREADY = "GraphQL: Pull request is already merged (enablePullRequestAutoMerge)";
  /** A queue-mode PR whose first `pr merge` exits 1 and raises the flag; every `pr view` after the flag answers `after`. */
  const armFails = (tag: string, after: (w: World, m: string) => Reply): { w: World; m: string } => {
    const w = pushed(tag);
    const flag = join(w.root, "armed.flag");
    const m = landMerge(w, false);
    scenario(w, {
      rules: { stdout: QUEUE_RULES },
      list: openList(w),
      view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN" })) }], alts: [{ ifExists: flag, replies: [after(w, m)] }] },
      merge: { replies: [{ exit: 1, stderr: `${ALREADY}\n`, touch: flag }] },
    });
    return { w, m };
  };
  const viewsAfterMerge = (w: World): number => {
    const gh = ghCalls(w);
    const at = gh.findIndex((a) => a[0] === "pr" && a[1] === "merge");
    return gh.slice(at + 1).filter((a) => a[0] === "pr" && a[1] === "view").length;
  };

  // MERGED on the pinned head: landed, its merge commit fetched into master
  const { w, m } = armFails("w384-b2-merged", (x, mm) => ({ stdout: viewOf(cand(x, { state: "MERGED", merge: mm })) }));
  const o = performMerge(w);
  assert.equal(o.status, 0, ran("an already-merged PR is landed: exit 0", o));
  assert.match(o.out, new RegExp(`^merge: gh pr merge --squash --auto failed \\(${escapeRegExp(ALREADY)}\\); PR #${PR_NUMBER} reads MERGED at its pinned head ${tipOf(w).slice(0, 12)}$`, "m"), ran("the failed call and the merged read are both named", o));
  assert.match(o.out, /^state=MERGED$/m, ran("state=MERGED", o));
  assert.deepEqual(mutating(w), ["gh pr merge --squash --auto", "git fetch master:master"], ran("one merge call, then the trunk fetch", o));
  assert.equal(viewsAfterMerge(w), 1, ran("exactly one fresh pr view after the failed call", o));
  assert.equal(git(w.repo, ["rev-parse", "master"]), m, ran("master holds the merge commit", o));
  assert.deepEqual(unmatched(w), [], "the fixture saw every gh call");

  // every other read keeps the call's own failure, unchanged, and fetches nothing
  const other = "0123456789abcdef0123456789abcdef01234567";
  const variants: [string, (x: World, mm: string) => Reply][] = [
    ["a PR that still reads OPEN", (x) => ({ stdout: viewOf(cand(x, { state: "OPEN", mss: "CLEAN" })) })],
    ["a PR MERGED on another head", (x, mm) => ({ stdout: viewOf(cand(x, { state: "MERGED", merge: mm, oid: other })) })],
    ["a MERGED PR of another head branch", (x, mm) => ({ stdout: viewOf(cand(x, { state: "MERGED", merge: mm, head: "opus/W-901" })) })],
    ["a CLOSED PR", (x) => ({ stdout: viewOf(cand(x, { state: "CLOSED" })) })],
    ["a MERGED PR with no merge commit", (x) => ({ stdout: viewOf(cand(x, { state: "MERGED", merge: null })) })],
    ["a MERGED PR with an all-zero merge commit", (x) => ({ stdout: viewOf(cand(x, { state: "MERGED", merge: "0".repeat(40) })) })],
    ["a failed read", () => ({ exit: 1, stderr: "HTTP 502: Bad Gateway\n" })],
  ];
  for (const [label, after] of variants) {
    const { w: x } = armFails(`w384-b2-${label.replaceAll(" ", "-")}`, after);
    const before = git(x.repo, ["rev-parse", "master"]);
    const kept = performMerge(x);
    assert.equal(kept.status, 1, ran(`${label}: the merge holds`, kept));
    assert.deepEqual(outLines(kept).filter((l) => l.startsWith("state=") || l.startsWith("why:")), ["state=MERGE_FAILED", `why: ${ALREADY}`], ran(`${label}: the failure is the call's own, unchanged`, kept));
    assert.deepEqual(mutating(x), ["gh pr merge --squash --auto"], ran(`${label}: nothing is fetched`, kept));
    assert.equal(viewsAfterMerge(x), 1, ran(`${label}: exactly one fresh pr view`, kept));
    assert.equal(git(x.repo, ["rev-parse", "master"]), before, `${label}: master did not move`);
  }

  // MERGED on the pinned head, but its merge commit is not on origin: landed's own checks hold, nothing reads MERGED
  const { w: gone } = armFails("w384-b2-not-on-origin", (x) => ({ stdout: viewOf(cand(x, { state: "MERGED", merge: other })) }));
  const unfetched = performMerge(gone);
  assert.equal(unfetched.status, 1, ran("a merge commit that cannot be fetched holds", unfetched));
  assert.doesNotMatch(unfetched.out, /^state=MERGED$/m, ran("and never reads state=MERGED", unfetched));
});

// ---------------------------------------------------------------------------
// W-418 (studio/briefs/W-418.md): a PR that touches a code-owned path names the paths, leaves a notice for the Patron
// and requests the code owners' review. Shared by rows b1 (review-request) and b2 (the pr rung).
// ---------------------------------------------------------------------------
const W418_TITLE = "W-900: notify the Patron";
/** Master's owners file in the W-418 rows: anchored, directory, bare-name and owner-less lines, an email owner. */
const W418_OWNERS = [
  "# fixture owners",
  "/.github/                 @patron",
  "/docs/                    @writer",
  "/docs/ADOPTION.md         @patron @org/leads",
  "/docs/public/",
  "leges/                    @patron",
  "owners.txt                @patron  # an inline comment",
  "/vendor/                  someone@example.com",
  "",
].join("\n");
/** Each form of an owners line the screen does not read: a glob (`*`, `?`, `[`), an escape, a negation, a bare `/`, an
 *  empty, `.` or `..` segment, a `#` inside the pattern, a control and a non-ASCII space. */
const W418_UNREAD = ["*.secret", "doc?.md", "[ab].md", "docs\\x.md", "!keep.md", "/", "docs/./x", "docs/../x", "docs//x", "docs/a#b", "docs/\u0007x", "docs/ x"];
const w418Notice = (w: World, pr: number): string => join(git(w.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "bisellium", "notice", String(pr));
const w418Read = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
const w418Edits = (w: World): string[][] => ghCalls(w).filter((a) => a[0] === "pr" && a[1] === "edit");
const w418Views = (w: World): string[][] => ghCalls(w).filter((a) => a[0] === "pr" && a[1] === "view");
/** The opus branch's code-owned and unowned changes (a rename out of .github/; a space, a quote, non-ASCII and a newline in
 *  a name; a symlink), committed with a current receipt. */
function w418Touch(w: World): void {
  git(w.wt, ["mv", ".github/workflows/ci.yml", "ci-moved.yml"]);
  for (const rel of [".github/workflows/new.yml", "docs/ADOPTION.md", "docs/ADOPTION.md.bak", "docs/a b'\"é.md", "docs/new\nline.md", "docs/public/index.md", "pkg/leges/x.md", "lib/leges", "pkg/owners.txt", "vendor/lib.js", "a.secret", "src/plain.ts"]) put(w.wt, rel, `${rel}\n`);
  symlinkSync("../src/plain.ts", join(w.wt, "docs", "link"));
  commit(w.wt, "feat: touch code-owned and unowned paths");
  writeReceipt(w, "current");
}
/** A side clone of the world's origin that moves master: each file written, or removed when null, in one pushed commit. */
function w418Master(w: World): (files: Record<string, string | null>) => void {
  const side = join(scratch("w418-master"), "c");
  git(dirname(side), ["clone", "-q", w.origin, side]);
  return (files) => {
    for (const [rel, text] of Object.entries(files)) {
      if (text === null) git(side, ["rm", "-q", "-r", "--", rel]);
      else {
        rmSync(join(side, rel), { recursive: true, force: true });
        put(side, rel, text);
      }
    }
    commit(side, "chore: master's owners files");
    git(side, ["push", "-q", "origin", "HEAD:refs/heads/master"]);
  };
}
const W418_PATHS = [".github/workflows/ci.yml", ".github/workflows/new.yml", "docs/ADOPTION.md", "docs/ADOPTION.md.bak", "docs/a b'\"é.md", "docs/link", "docs/new line.md", "pkg/leges/x.md", "pkg/owners.txt", "vendor/lib.js"];
const W418_TEXT = `PR #901 needs your review: ${W418_TITLE} (code-owned: .github/workflows/ci.yml, .github/workflows/new.yml, docs/ADOPTION.md, docs/ADOPTION.md.bak, docs/a b'"é.md and 5 more)`;

test("W-418-b1 behaviour 1: review-request screens an open PR's head against master's owners file, leaves the notice and requests review", { timeout: 3_600_000 }, () => {
  const w = reviewed("w418-b1", { mainOnMaster: false, github: true }, w418Touch, true);
  const master = w418Master(w);
  // .github/CODEOWNERS is the one read: CODEOWNERS and docs/CODEOWNERS, which would own src/plain.ts, are not
  master({ ".github/CODEOWNERS": W418_OWNERS, CODEOWNERS: "/src/ @patron\n", "docs/CODEOWNERS": "/src/ @patron\n" });
  const head = tipOf(w);
  git(w.origin, ["update-ref", "refs/pull/901/head", head]);
  const view = (o: Json = {}): Reply => ({ stdout: { number: 901, state: "OPEN", baseRefName: "master", headRefOid: head, ...o } });
  const title: Reply = { stdout: { title: W418_TITLE } };
  const notice = w418Notice(w, 901);
  const request = (args: string[], views: Reply[], edit: Reply = { stdout: "" }, env: Record<string, string> = {}): Out => {
    scenario(w, { view: { replies: views }, edit });
    try {
      rmSync(notice, { force: true });
    } catch {
      /* the notice directory is a file in the row that blocks it */
    }
    return cli(w, ["review-request", ...args], w.repo, env);
  };
  const lines = (o: Out): string[] => o.out.split("\n").filter((l) => l !== "");
  const resume = `run: bisellium review-request 901 --repo ${w.repo}`;
  const one = (p: string): string => `PR #901 needs your review: ${W418_TITLE} (code-owned: ${p})`;
  const whole = ["review-request: PR #901", ...W418_PATHS.map((p) => `code-owned: ${p}`), `notice: ${W418_TEXT}`, "review-requested: org/leads, patron, writer", "review-request: skipped someone@example.com (not an @login or @org/team)"];

  // the screen: every pattern form, a rename's old side, a newline in a name; the notice and the request
  const o = request(["901"], [view(), title]);
  assert.deepEqual(lines(o), whole, ran("the code-owned paths, the notice and the request", o));
  assert.equal(o.status, 0, ran("exit 0", o));
  assert.equal(w418Read(notice), `${W418_TEXT}\n`, "the notice is left under the Git common directory");
  assert.deepEqual(w418Edits(w), [["pr", "edit", "901", "-R", SLUG, "--add-reviewer", "org/leads,patron,writer"]], "one review request names every @owner");
  assert.deepEqual(w418Views(w), [["pr", "view", "901", "-R", SLUG, "--json", "number,state,baseRefName,headRefOid"], ["pr", "view", "901", "-R", SLUG, "--json", "title"]], "the PR and then its title are read");
  for (const read of w418Views(w)) assert.deepEqual(read[read.indexOf("--json") + 1]!.split(",").filter((f) => !GH_2_101_PR_VIEW_FIELDS.has(f)), [], "every view field is gh 2.101.0's");
  assert.deepEqual(unmatched(w), [], "no unexpected gh call");

  // a --repo inside the checkout, under a git config that makes a plain diff relative to it: every path is still read
  const sub = request(["901", "--repo", w.studio], [view(), title], { stdout: "" }, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "diff.relative", GIT_CONFIG_VALUE_0: "true" });
  assert.deepEqual([sub.status, lines(sub)], [0, whole], ran("a --repo inside the checkout, under diff.relative", sub));

  // a PR touching no code-owned path: none, and nothing left or requested
  const side = join(scratch("w418-b1-side"), "c");
  git(dirname(side), ["clone", "-q", w.origin, side]);
  put(side, "src/only.ts", "only\n");
  commit(side, "feat: an unowned change");
  git(side, ["push", "-q", "origin", "HEAD:refs/pull/902/head"]);
  const plain = git(side, ["rev-parse", "HEAD"]);
  const none = request(["902"], [{ stdout: { number: 902, state: "OPEN", baseRefName: "master", headRefOid: plain } }]);
  assert.deepEqual(lines(none), ["review-request: PR #902", "code-owned: none"], ran("no code-owned path", none));
  assert.equal(none.status, 0, ran("exit 0", none));
  assert.equal(w418Read(w418Notice(w, 902)), undefined, "no notice");
  assert.deepEqual([w418Edits(w), w418Views(w).length], [[], 1], "no request, no title read");

  // a PR touching six long code-owned paths: the notice line is cut whole to 500 characters, within the guard's 4096 bytes
  const long = [0, 1, 2, 3, 4, 5].map((i) => `docs/${"n".repeat(200)}-${i}.md`);
  for (const rel of long) put(side, rel, "long\n");
  commit(side, "docs: six long names");
  git(side, ["push", "-q", "origin", "HEAD:refs/pull/904/head"]);
  const longText = `PR #904 needs your review: ${W418_TITLE} (code-owned: ${long.slice(0, 5).join(", ")} and 1 more)`.slice(0, 500);
  const cut = request(["904"], [{ stdout: { number: 904, state: "OPEN", baseRefName: "master", headRefOid: git(side, ["rev-parse", "HEAD"]) } }, title]);
  assert.deepEqual(
    [cut.status, lines(cut), w418Read(w418Notice(w, 904)), longText.length],
    [0, ["review-request: PR #904", ...long.map((p) => `code-owned: ${p}`), `notice: ${longText}`, "review-requested: writer"], `${longText}\n`, 500],
    ran("a long notice is cut to 500 characters", cut),
  );

  // usage errors: exit 2, nothing read
  const bare = scratch("w418-b1-bare");
  for (const [label, args, why] of [
    ["usage: no operand", [], "give one PR number"],
    ["usage: abc", ["abc"], "give one PR number"],
    ["usage: 0", ["0"], "give one PR number"],
    ["usage: 901 902", ["901", "902"], "give one PR number"],
    ["usage: --repo", ["--repo"], "--repo needs a value"],
    ["usage: --opus 901", ["--opus", "901"], 'unknown flag "--opus"'],
    ["usage: duplicate --repo", ["901", "--repo", w.repo, "--repo", bare], "--repo is given more than once"],
    ["usage: empty --repo", ["901", "--repo", ""], "--repo needs a non-empty value"],
  ] as const) {
    const u = request([...args], [view()]);
    assert.deepEqual([u.status, u.err.split("\n")[0], u.err.split("\n")[1]], [2, `review-request: ${why}`, "usage: bisellium review-request <pr> [--repo <dir>]"], ran(label, u));
    assert.deepEqual(ghCalls(w), [], `${label}: no gh call`);
  }

  // refusals before the screen: exit 1, one why, nothing left or requested
  const refused = (label: string, args: string[], views: Reply[], why: string): void => {
    const r = request(args, views);
    assert.deepEqual([r.status, lines(r)], [1, [`review-request: PR #${args[0]}`, `why: ${why}`]], ran(label, r));
    assert.deepEqual([w418Read(notice), w418Edits(w)], [undefined, []], `${label}: nothing left or requested`);
  };
  refused("a merged PR", ["901"], [view({ state: "MERGED" })], 'PR #901 is "MERGED", not OPEN; only an open PR is screened');
  refused("a PR with no state", ["901"], [view({ state: undefined })], "PR #901 is absent, not OPEN; only an open PR is screened");
  refused("a base other than master", ["901"], [view({ baseRefName: "develop" })], `PR #901's base is "develop", not master; the screen reads master's owners file`);
  refused("another PR's view", ["901"], [view({ number: 902 })], "gh pr view returned PR 902, not #901");
  refused("a failing view", ["901"], [{ exit: 1, stderr: "HTTP 404: Not Found\n" }], "gh pr view failed (HTTP 404: Not Found)");
  refused("a non-JSON view", ["901"], [{ stdout: "not json" }], "gh pr view returned non-JSON output");
  refused("a view that is not an object", ["901"], [{ stdout: [1] }], "gh pr view returned no object");
  refused("a malformed head", ["901"], [view({ headRefOid: "abc" })], "gh pr view returned no 40-hex headRefOid");
  refused("a head GitHub moved", ["901"], [view({ headRefOid: "1".repeat(40) })], `PR #901's head on origin is ${head.slice(0, 12)}, not 111111111111 as GitHub reported; rerun`);
  refused("no pull ref on origin", ["903"], [{ stdout: { number: 903, state: "OPEN", baseRefName: "master", headRefOid: head } }], "git fetch origin refs/pull/903/head failed (fatal: couldn't find remote ref refs/pull/903/head)");
  const outside = request(["901", "--repo", bare], [view()]);
  // git words the rest of this line by environment (a mount point in a sandbox cell), so only its stable prefix is asserted
  const outsideWhy = "why: git fetch origin master failed (fatal: not a git repository";
  assert.deepEqual([outside.status, lines(outside)[1]?.slice(0, outsideWhy.length)], [1, outsideWhy], ran("a --repo outside a checkout", outside));

  // holds after the screen: exit 1, the steps after the failing one not run, the resume line
  const held = (label: string, views: Reply[], edit: Reply, tail: string[], left: string | undefined, edits: number): void => {
    const r = request(["901"], views, edit);
    assert.deepEqual([r.status, lines(r)], [1, ["review-request: PR #901", ...W418_PATHS.map((p) => `code-owned: ${p}`), ...tail, resume]], ran(label, r));
    assert.deepEqual([w418Read(notice), w418Edits(w).length], [left, edits], `${label}: what is left and requested`);
  };
  held("a failing title read", [view(), { exit: 1, stderr: "HTTP 502\n" }], { stdout: "" }, ["why: PR #901 touches code-owned paths, but its title could not be read (gh pr view failed (HTTP 502))"], undefined, 0);
  held("a title that is not a string", [view(), { stdout: { title: 7 } }], { stdout: "" }, ["why: PR #901 touches code-owned paths, but its title could not be read (gh pr view returned no string title)"], undefined, 0);
  held("a failing review request", [view(), title], { exit: 1, stderr: "could not request reviewer: 'writer' not found\n" }, [`notice: ${W418_TEXT}`, "why: PR #901 touches code-owned paths, but the review request failed (could not request reviewer: 'writer' not found)"], `${W418_TEXT}\n`, 1);
  rmSync(dirname(notice), { recursive: true, force: true });
  mkdirSync(dirname(dirname(notice)), { recursive: true });
  writeFileSync(dirname(notice), "a file where the notice directory belongs\n");
  held("a notice that cannot be written", [view(), title], { stdout: "" }, [`why: PR #901 touches code-owned paths, but its notice could not be written (record directory must be a real directory, not a symbolic link: ${dirname(notice)})`], undefined, 0);
  rmSync(dirname(notice), { force: true });

  // fix round 1: a symlinked <common>/bisellium or <common>/bisellium/notice holds, and nothing is written outside it
  const bis = dirname(dirname(notice));
  const away = scratch("w418-b1-away");
  rmSync(bis, { recursive: true, force: true });
  symlinkSync(away, bis);
  held("a symlinked bisellium directory", [view(), title], { stdout: "" }, [`why: PR #901 touches code-owned paths, but its notice could not be written (record directory must be a real directory, not a symbolic link: ${bis})`], undefined, 0);
  assert.deepEqual(readdirSync(away), [], "nothing is written outside through the bisellium link");
  rmSync(bis);
  mkdirSync(bis);
  symlinkSync(away, dirname(notice));
  held("a symlinked notice directory", [view(), title], { stdout: "" }, [`why: PR #901 touches code-owned paths, but its notice could not be written (record directory must be a real directory, not a symbolic link: ${dirname(notice)})`], undefined, 0);
  assert.deepEqual(readdirSync(away), [], "nothing is written outside through the notice link");
  rmSync(bis, { recursive: true, force: true });

  // the owners file GitHub reads: with no .github/CODEOWNERS, the root's before docs/'s, then docs/'s alone
  master({ ".github/CODEOWNERS": null, CODEOWNERS: "/src/ @patron\n", "docs/CODEOWNERS": "/vendor/ @writer\n" });
  const root = request(["901"], [view(), title]);
  assert.deepEqual([root.status, lines(root)], [0, ["review-request: PR #901", "code-owned: src/plain.ts", `notice: ${one("src/plain.ts")}`, "review-requested: patron"]], ran("an owners file at the root is read before docs/'s", root));
  master({ CODEOWNERS: null });
  const docs = request(["901"], [view(), title]);
  assert.deepEqual([docs.status, lines(docs)], [0, ["review-request: PR #901", "code-owned: vendor/lib.js", `notice: ${one("vendor/lib.js")}`, "review-requested: writer"]], ran("docs/CODEOWNERS is read when it is the only one", docs));

  // an owners line the screen does not read holds before the title, the notice or the request: never a silent pass
  const unreadHold = (o: Out, why: string): void => {
    assert.deepEqual([o.status, lines(o)], [1, ["review-request: PR #901", `why: PR #901's code-owned paths could not be screened (.github/CODEOWNERS line 9 is not a plain pattern: ${why})`, resume]], ran("an unread owners line holds", o));
    assert.deepEqual([w418Read(notice), w418Edits(w), w418Views(w).length], [undefined, [], 1], "an unread owners line holds: nothing left, requested or read after the screen");
  };
  for (const form of W418_UNREAD) {
    master({ ".github/CODEOWNERS": `${W418_OWNERS}${form}  @patron\n` });
    unreadHold(request(["901"], [view(), title]), form.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " "));
  }
  master({ ".github/CODEOWNERS": `${W418_OWNERS}*.secret  @patron\n!keep.md  @patron\n` });
  unreadHold(request(["901"], [view(), title]), "*.secret (and 1 more)");

  // an owners file at master that is not a regular file: the screen holds before anything else
  master({ ".github/CODEOWNERS": null, ".github/CODEOWNERS/inner": "/.github/ @patron\n" });
  const dir = request(["901"], [view(), title]);
  assert.deepEqual(
    [dir.status, lines(dir)],
    [1, ["review-request: PR #901", "why: PR #901's code-owned paths could not be screened (.github/CODEOWNERS at refs/remotes/origin/master is not a regular file)", resume]],
    ran("an owners directory", dir),
  );
  assert.deepEqual([w418Read(notice), w418Edits(w), w418Views(w).length], [undefined, [], 1], "nothing left, requested or read after the screen");
});

/** A queue-mode, review-met world whose opus branch touches docs/ADOPTION.md and src/plain.ts, with master's owners
 *  file naming docs/ADOPTION.md, and a PR that appears once `gh pr create` ran. */
function w418PrWorld(tag: string, edit: Reply = { stdout: "" }, pr: number = PR_NUMBER): World {
  const touch = (w: World): void => {
    put(w.wt, "docs/ADOPTION.md", "adoption\n");
    put(w.wt, "src/plain.ts", "plain\n");
    commit(w.wt, "feat: touch a code-owned path");
    writeReceipt(w, "current");
  };
  const w = queueWorld(tag, { stdout: QUEUE_RULES }, true, touch);
  advanceOrigin(w, ".github/CODEOWNERS", "# fixture owners\n/docs/ADOPTION.md @patron\n");
  const created = join(w.root, "created.flag");
  scenario(w, {
    rules: { stdout: QUEUE_RULES },
    list: { replies: [{ stdout: [] }], alts: [{ ifExists: created, replies: [{ stdout: [cand(w, { state: "OPEN", number: pr })] }] }] },
    create: { stdout: `https://github.com/${SLUG}/pull/${pr}\n`, touch: created },
    view: { stdout: { title: W418_TITLE } },
    edit,
  });
  return w;
}
/** The result lines after `PR=<n> base=… head=…`, up to the `next-step:` line. */
const w418After = (o: Out): string[] => {
  const all = o.out.split("\n");
  const at = all.findIndex((l) => l.startsWith("PR="));
  const end = all.findIndex((l) => l.startsWith("next-step:"));
  return at === -1 ? [] : all.slice(at + 1, end === -1 ? undefined : end);
};
const W418_ONE = `PR #${PR_NUMBER} needs your review: ${W418_TITLE} (code-owned: docs/ADOPTION.md)`;

test("W-418-b2 behaviour 2: the pr rung screens the pushed head it opens or updates a PR on, leaves the notice and requests review", { timeout: 3_600_000 }, () => {
  const w = w418PrWorld("w418-b2-owned");
  const notice = w418Notice(w, PR_NUMBER);
  const o = performPr(w);
  assert.deepEqual(w418After(o), ["code-owned: docs/ADOPTION.md", `notice: ${W418_ONE}`, "review-requested: patron"], ran("a created PR: the code-owned path, the notice and the request", o));
  assert.equal(o.status, 0, ran("performed", o));
  assert.equal(w418Read(notice), `${W418_ONE}\n`, "the notice is left under the Git common directory");
  assert.deepEqual(w418Edits(w), [["pr", "edit", String(PR_NUMBER), "-R", SLUG, "--add-reviewer", "patron"]], "one review request");
  assert.deepEqual(w418Views(w), [["pr", "view", String(PR_NUMBER), "-R", SLUG, "--json", "title"]], "the title is read from GitHub");
  assert.deepEqual(unmatched(w), [], "no unexpected gh call");

  // an update of the open PR: pushed again, screened again, no second PR
  const old = tipOf(w);
  put(w.wtStudio, "notes.md", "bookkeeping line\nmore bookkeeping\n");
  commit(w.wt, "studio: bookkeeping after the push");
  rmSync(notice, { force: true });
  scenario(w, { rules: { stdout: QUEUE_RULES }, list: openList(w, { state: "OPEN", oid: old }), view: { stdout: { title: W418_TITLE } } });
  const u = performPr(w);
  assert.deepEqual(w418After(u), ["code-owned: docs/ADOPTION.md", `notice: ${W418_ONE}`, "review-requested: patron"], ran("an updated PR: screened again", u));
  assert.equal(u.status, 0, ran("performed", u));
  assert.deepEqual([mutating(w), w418Edits(w).length, w418Read(notice)], [["git fetch master:master", "git push --force-with-lease"], 1, `${W418_ONE}\n`], ran("pushed, no PR created, requested and left again", u));

  // no owners file at master: none, nothing read, left or requested
  const plain = queueWorld("w418-b2-none", { stdout: QUEUE_RULES });
  const p = performPr(plain);
  assert.deepEqual(w418After(p), ["code-owned: none (no .github/CODEOWNERS, CODEOWNERS or docs/CODEOWNERS at refs/heads/master)"], ran("no owners file", p));
  assert.equal(p.status, 0, ran("performed", p));
  assert.deepEqual([w418Read(w418Notice(plain, PR_NUMBER)), w418Edits(plain), w418Views(plain)], [undefined, [], []], "nothing left, requested or read");

  // fix round 1: a 13-digit PR number is written by the rung, and is the number takeNotices (the guard) hands over
  const big = 1234567890123;
  const bw = w418PrWorld("w418-b2-big", { stdout: "" }, big);
  const bo = performPr(bw);
  const bigText = `PR #${big} needs your review: ${W418_TITLE} (code-owned: docs/ADOPTION.md)`;
  assert.deepEqual(w418After(bo), ["code-owned: docs/ADOPTION.md", `notice: ${bigText}`, "review-requested: patron"], ran("a large PR number: the notice and the request", bo));
  assert.equal(w418Read(w418Notice(bw, big)), `${bigText}\n`, "the large number's notice is left");
  assert.deepEqual(takeNotices(bw.repo), [bigText], "takeNotices hands the large number's notice over");

  // a held large number names a resume that works: review-request takes nine digits, so the pr rung is rerun
  const bh = w418PrWorld("w418-b2-bigheld", { exit: 1, stderr: "could not request reviewer\n" }, big);
  const bho = performPr(bh);
  assert.deepEqual(
    w418After(bho),
    ["code-owned: docs/ADOPTION.md", `notice: ${bigText}`, `why: PR #${big} touches code-owned paths, but the review request failed (could not request reviewer)`, `run: bisellium next ${OPUS} --perform --expect pr --title "<title>" --body-file <a file> (review-request takes a PR number of at most nine digits)`],
    ran("a held 13-digit PR names the pr rung as its resume", bho),
  );

  // a failing review request: held after the push and the PR, the notice left, the resume line
  const f = w418PrWorld("w418-b2-fails", { exit: 1, stderr: "could not request reviewer\n" });
  const h = performPr(f);
  assert.deepEqual(
    w418After(h),
    ["code-owned: docs/ADOPTION.md", `notice: ${W418_ONE}`, "why: PR #901 touches code-owned paths, but the review request failed (could not request reviewer)", `run: bisellium review-request ${PR_NUMBER} --repo ${f.repo}`],
    ran("a failing request holds", h),
  );
  assert.deepEqual([h.status, h.first], [1, `next: ${OPUS} pr held`], ran("held, exit 1", h));
  assert.deepEqual([mutating(f), w418Read(w418Notice(f, PR_NUMBER))], [["git fetch master:master", "git push --force-with-lease", "gh pr create"], `${W418_ONE}\n`], "the PR was opened and the notice left");
});

// ---------------------------------------------------------------------------
// W-423 rows b1-b2 (studio/briefs/W-423.md): the queue binding is written, probed and removed only through real
// directories below the Git common directory (the shared containment helper, packages/commands/src/ids.ts); a symlinked
// level holds the pr before anything is written, pushed or removed outside it.
// ---------------------------------------------------------------------------
const w423Common = (w: World): string => git(w.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
const W423_REFUSED = "record directory must be a real directory, not a symbolic link: ";
const w423Why = (o: Out): string | undefined => o.out.split("\n").find((l) => l.startsWith("why:"));
/** Links `<common>/bisellium` (level `bisellium`) or `<common>/bisellium/queue` (level `queue`) to `away`; the refused level's real path. */
function w423Link(common: string, level: "bisellium" | "queue", away: string): string {
  if (level === "queue") mkdirSync(join(common, "bisellium"));
  const levels = level === "bisellium" ? ["bisellium"] : ["bisellium", "queue"];
  symlinkSync(away, join(common, ...levels));
  return join(realpathSync(common), ...levels);
}

test("W-423-b1 behaviour 1: a queue-mode pr writes its binding only through real directories below the Git common directory, and a symlinked level holds before the push", { timeout: 3_600_000 }, () => {
  for (const level of ["bisellium", "queue"] as const) {
    const w = queueWorld(`w423-b1-${level}`, { stdout: QUEUE_RULES });
    const common = w423Common(w);
    const away = scratch(`w423-b1-away-${level}`);
    const refused = w423Link(common, level, away);
    const o = performPr(w);
    assert.deepEqual(mutating(w), ["git fetch master:master"], ran(`a symlinked ${level} level: no push`, o));
    assert.deepEqual([o.status, w423Why(o)], [1, `why: cannot write the queue binding ${join(common, "bisellium", "queue", "opus%2FW-900")}: ${W423_REFUSED}${refused}`], ran(`a symlinked ${level} level: held, naming the level`, o));
    assert.deepEqual(readdirSync(away), [], `a symlinked ${level} level: nothing is written outside the Git common directory`);
    assert.equal(remoteBranchExists(w), false, `a symlinked ${level} level: nothing was pushed`);
  }
  const w = queueWorld("w423-b1-real", { stdout: QUEUE_RULES });
  const head = tipOf(w);
  const o = performPr(w);
  assert.equal(o.status, 0, ran("real directories: the queue-mode pr is performed", o));
  assert.equal(bound(w), `${head}\n`, "real directories: the binding holds the pushed head");
});

test("W-423-b2 behaviour 2: a direct-mode pr probes and removes its binding only through real directories below the Git common directory, and a symlinked level holds before the rebase", { timeout: 3_600_000 }, () => {
  for (const level of ["bisellium", "queue"] as const) {
    const w = queueWorld(`w423-b2-${level}`, { stdout: [] }, false);
    const common = w423Common(w);
    const away = scratch(`w423-b2-away-${level}`);
    const outside = join(away, ...(level === "bisellium" ? ["queue"] : []), "opus%2FW-900");
    mkdirSync(dirname(outside), { recursive: true });
    writeFileSync(outside, "an outside binding\n");
    const refused = w423Link(common, level, away);
    const before = tipOf(w);
    const o = performPr(w);
    assert.deepEqual(mutating(w), ["git fetch master:master"], ran(`a symlinked ${level} level: no rebase, no push`, o));
    assert.deepEqual([o.status, w423Why(o)], [1, `why: cannot read the queue binding: ${W423_REFUSED}${refused}`], ran(`a symlinked ${level} level: held before the rebase, naming the level`, o));
    assert.equal(readFileSync(outside, "utf8"), "an outside binding\n", `a symlinked ${level} level: the outside binding is not removed`);
    assert.deepEqual([tipOf(w), remoteBranchExists(w)], [before, false], `a symlinked ${level} level: no rebase and nothing pushed`);
  }
});

// ---------------------------------------------------------------------------
// W-462 rows b1-b3 (studio/briefs/W-462.md): a reviewed PR head that the opus branch rewrites with its tree kept is a
// rewrite: never pushed by the pr rung, checked commit by commit and red by red, pushed by the Patron alone with a lease
// on the reviewed head, then rebound and its review requested again before merge requeues it.
// ---------------------------------------------------------------------------
const W462_ROW = "w462.test.mjs";
/** a fixture test that fails until impl.txt exists: each behaviour's red is a real assertion failure */
const W462_ROWS = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { existsSync } from "node:fs";',
  'for (const n of [1, 2]) test(`W-900-b${n} fixture: the implementation is present`, () => assert.equal(existsSync("impl.txt"), true));',
  "",
].join("\n");
const W462_BUILD = ['import { mkdirSync, writeFileSync } from "node:fs";', 'await import("./src/main.mjs");', 'mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });', 'writeFileSync(new URL("./dist/index.html", import.meta.url), "<!doctype html>\\n");', ""].join("\n");
const w462Short = (oid: string): string => oid.slice(0, 12);
/** The opus series a builder leaves: a web workspace and a failing row, real reds recorded at that commit, then the implementation. */
function w462Series(w: World): void {
  put(w.wt, ".gitignore", `${readFileSync(join(w.wt, ".gitignore"), "utf8")}dist/\n`);
  put(w.wt, "package.json", `${JSON.stringify({ name: "w462-fixture", private: true, workspaces: ["apps/web"] }, null, 2)}\n`);
  put(w.wt, "apps/web/package.json", `${JSON.stringify({ name: "@bisellium/web", private: true, type: "module", scripts: { build: "node build.mjs" } }, null, 2)}\n`);
  put(w.wt, "apps/web/build.mjs", W462_BUILD);
  put(w.wt, "apps/web/src/main.mjs", "export {};\n");
  put(w.wt, "docs/ADOPTION.md", "adoption\n");
  put(w.wt, W462_ROW, W462_ROWS);
  commit(w.wt, `test(${OPUS}): rows, red`);
  const tree = sourceTree(w.wt);
  for (let n = 1; n <= w.behaviours; n++)
    put(w.wt, `studio/ci/reds/${OPUS}/${String(n).padStart(2, "0")}.log`, [`# behaviour: ${n}`, `# command: node --test-reporter=tap --test-name-pattern=^W-900-b${n}\\s ${W462_ROW}`, "# exit: 1", `# at: ${T.reds}`, `# sella: builder.${OPUS}`, `# tree: ${tree}`, "", "TAP version 13", `not ok 1 - W-900-b${n} fixture: the implementation is present`, "  ---", "  code: 'ERR_ASSERTION'", "  ...", ""].join("\n"));
  commit(w.wt, `studio(${OPUS}): reds at the row commit`);
  put(w.wt, "impl.txt", "the implementation\n");
  commit(w.wt, `feat(${OPUS}): the implementation`);
  writeReceipt(w, "current");
}
/** A queue-mode world whose reviewed head is pushed and its PR opened by the pr rung; the main checkout owns origin/master. */
function w462World(tag: string): { w: World; reviewed: string } {
  const w = queueWorld(tag, { stdout: QUEUE_RULES }, true, w462Series);
  advanceOrigin(w, ".github/CODEOWNERS", "# fixture owners\n/docs/ADOPTION.md @patron\n");
  const created = join(w.root, "created.flag");
  scenario(w, {
    rules: { stdout: QUEUE_RULES },
    list: { replies: [{ stdout: [] }], alts: [{ ifExists: created, replies: [{ stdout: [cand(w, { state: "OPEN" })] }] }] },
    create: { stdout: `https://github.com/${SLUG}/pull/${PR_NUMBER}\n`, touch: created },
    view: { stdout: { title: W418_TITLE } },
  });
  const first = performPr(w);
  assert.equal(first.status, 0, ran("the reviewed head is pushed and its PR opened", first));
  rmSync(w.log, { force: true });
  return { w, reviewed: tipOf(w) };
}
/** Move opus/W-900 to `oid` in its worktree, as a series repair does. */
const w462Move = (w: World, oid: string): void => void git(w.wt, ["reset", "-q", "--hard", oid]);
/** A new history ending at `tree` (default: the reviewed tree), its last commit on `parent`. */
const w462Commit = (w: World, parent: string, message: string, tree: string): string => git(w.repo, ["commit-tree", tree, "-p", parent, "-m", message]);
const w462Tree = (w: World, ref: string): string => git(w.repo, ["rev-parse", `${ref}^{tree}`]);
const w462Patron = (o: Out): string[] => outLines(o).filter((l) => l.startsWith("patron: "));
const w462Why = (o: Out): string | undefined => outLines(o).find((l) => l.startsWith("why: "));
const w462Origin = (w: World): string => git(w.origin, ["rev-parse", `refs/heads/${BRANCH}`]);
/** The tree of `ref` with `path` holding `text`, written through a scratch index (nothing checked out moves). */
function w462Mutate(w: World, ref: string, path: string, text: string): string {
  const env = { ...SETUP_ENV, GIT_INDEX_FILE: join(scratch("w462-index"), "index") };
  const run = (args: string[], input?: string): string => {
    const r = spawnSync("git", args, { cwd: w.repo, env, encoding: "utf8", ...(input === undefined ? {} : { input }) });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  run(["read-tree", ref]);
  const blob = run(["hash-object", "-w", "--stdin"], text);
  run(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
  return run(["write-tree"]);
}

test("W-462-b1 behaviour 1: a PR head the opus branch rewrites with its tree kept is a rewrite, and the pr rung never pushes it", { timeout: 600_000 }, () => {
  const { w, reviewed } = w462World("w462-b1");
  const tree = w462Tree(w, reviewed);
  const head = w462Commit(w, `${reviewed}~1`, `feat(${OPUS}): the implementation (rewritten)`, tree);
  w462Move(w, head);

  // (a) the rung names the rewrite, the reviewed head and the kept tree
  const o = next(w, [OPUS]);
  expectStep(o, "pr", "named", "a rewrite is the pr rung");
  assert.equal(o.kv.get("rewrite"), `PR #${PR_NUMBER} ${w462Short(reviewed)} -> ${BRANCH} ${w462Short(head)}, tree ${w462Short(tree)}`, ran("the rung names the rewrite, the reviewed head and the kept tree", o));

  // (b) the perform pushes nothing and asks the Patron once, for the one leased push
  const p = performPr(w);
  assert.deepEqual([p.status, p.first, mutating(w), w462Origin(w)], [1, `next: ${OPUS} pr held`, [], reviewed], ran("the reviewed head is not replaced", p));
  assert.deepEqual(w462Patron(p), [`patron: git -C ${w.wt} push --force-with-lease=refs/heads/${BRANCH}:${reviewed} origin ${head}:refs/heads/${BRANCH}`], ran("the Patron's one leased push", p));

  // (c) origin moved off the reviewed head: held, nothing checked or pushed
  const side = join(scratch("w462-b1-side"), "c");
  git(dirname(side), ["clone", "-q", "-b", BRANCH, w.origin, side]);
  put(side, "notes.txt", "a push from elsewhere\n");
  commit(side, "chore: someone else pushed");
  git(side, ["push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`]);
  const moved = w462Origin(w);
  const m = performPr(w);
  assert.deepEqual([m.status, w462Why(m), w462Patron(m), w462Origin(w)], [1, `why: origin's ${BRANCH} is ${w462Short(moved)}, not PR #${PR_NUMBER}'s reviewed head ${w462Short(reviewed)}; nothing checked or pushed`, [], moved], ran("origin moved off the reviewed head", m));
  git(side, ["push", "-q", "--force", "origin", `${reviewed}:refs/heads/${BRANCH}`]);

  // (d) a rewrite that changes the record tree but not the source: held, a rewrite keeps the reviewed tree
  put(w.wtStudio, "notes.md", "a record line the reviewed head does not carry\n");
  commit(w.wt, `studio(${OPUS}): a note after the rewrite`);
  const d = next(w, [OPUS]);
  assert.deepEqual([d.first, w462Why(d)], [`next: ${OPUS} pr held`, `why: ${BRANCH} ${w462Short(tipOf(w))} rewrites PR #${PR_NUMBER}'s reviewed head ${w462Short(reviewed)} and changes its tree outside the source: a rewrite keeps the reviewed tree (W-462); commit the record after the Patron's push`], ran("a changed record tree is held", d));

  // (e) a long worktree path: the Patron's one command is printed whole, never cut at the output bound
  const tmp = process.env["TMPDIR"];
  const deep = join(scratch("w462-b1-deep"), ...["a", "b", "c", "d"].map((c) => c.repeat(200)));
  mkdirSync(deep, { recursive: true });
  process.env["TMPDIR"] = deep;
  let long: ReturnType<typeof w462World>;
  try {
    long = w462World("w462-b1-long");
  } finally {
    if (tmp === undefined) delete process.env["TMPDIR"];
    else process.env["TMPDIR"] = tmp;
  }
  const longTree = w462Tree(long.w, long.reviewed);
  const longHead = w462Commit(long.w, `${long.reviewed}~1`, `feat(${OPUS}): the implementation (rewritten)`, longTree);
  w462Move(long.w, longHead);
  const e = performPr(long.w);
  const plain = `patron: git -C ${long.w.wt} push --force-with-lease=refs/heads/${BRANCH}:${long.reviewed} origin ${longHead}:refs/heads/${BRANCH}`;
  assert.ok(plain.length > 1000, `the fixture's command is over the output bound (${plain.length})`);
  assert.deepEqual(w462Patron(e), [plain], ran("a long worktree path leaves the Patron's command whole", e));
});

test("W-462-b2 behaviour 2: the rewrite perform builds every commit and replays every red as certify does before it asks the Patron", { timeout: 600_000 }, () => {
  const { w, reviewed } = w462World("w462-b2");
  const tree = w462Tree(w, reviewed);
  const rowCommit = git(w.repo, ["rev-list", "-1", `--grep=^test(${OPUS}): rows, red$`, reviewed]);
  const back = (row: string): void => assert.deepEqual([gitq(w.wt, ["symbolic-ref", "-q", "HEAD"]), git(w.wt, ["rev-parse", "HEAD"])], [`refs/heads/${BRANCH}`, tipOf(w)], `${row}: the worktree is back on ${BRANCH}`);

  // (a) a commit of the new history that does not build: held at it, nothing pushed
  const broken = w462Commit(w, `${reviewed}~1`, "chore: a commit that does not build", w462Mutate(w, `${reviewed}~1`, "apps/web/src/main.mjs", 'import "./missing.mjs";\n'));
  const head1 = w462Commit(w, broken, `feat(${OPUS}): the implementation (rewritten)`, tree);
  w462Move(w, head1);
  const a = performPr(w);
  assert.deepEqual([a.status, w462Why(a), w462Patron(a), w462Origin(w)], [1, `why: commit ${w462Short(broken)} does not build: web bundle build exited 1; certify's replay would refuse a red on it; nothing pushed`, [], reviewed], ran("a commit that does not build holds the rewrite", a));
  back("after a build hold");

  // (b) a history in which a red no longer fails at the commit certify replays it at: held at that red
  const squashed = w462Commit(w, `${rowCommit}~1`, `test(${OPUS}): rows and implementation`, w462Mutate(w, rowCommit, "impl.txt", "the implementation\n"));
  const head2 = w462Commit(w, squashed, `studio(${OPUS}): reds (rewritten)`, tree);
  w462Move(w, head2);
  const b = performPr(w);
  assert.deepEqual([b.status, w462Why(b), w462Patron(b)], [1, `why: red 1 did not reproduce its assertion failure at ${w462Short(head2)}: the command exited 0; nothing pushed`, []], ran("a red that does not replay holds the rewrite", b));
  back("after a replay hold");

  // (c) a history that builds at every commit and replays every red: the Patron is asked, with what was checked
  const head3 = w462Commit(w, `${reviewed}~1`, `feat(${OPUS}): the implementation (rewritten)`, tree);
  w462Move(w, head3);
  const c = performPr(w);
  const built = git(w.repo, ["rev-list", "--count", head3, "^refs/remotes/origin/master"]);
  assert.equal(c.kv.get("rewrite"), `${BRANCH} ${w462Short(head3)} keeps PR #${PR_NUMBER}'s reviewed tree ${w462Short(tree)} over a new history (${built} commit(s) build, ${w.behaviours} red(s) replay)`, ran("every commit built and every red replayed", c));
  assert.deepEqual([c.status, w462Patron(c), w462Origin(w)], [1, [`patron: git -C ${w.wt} push --force-with-lease=refs/heads/${BRANCH}:${reviewed} origin ${head3}:refs/heads/${BRANCH}`], reviewed], ran("then the Patron is asked for the leased push, and nothing is pushed", c));
  back("after the checks");

  // the checks run in place, so they start from a clean worktree, and a build or replay that leaves a change is refused
  const pristine = (row: string): void => assert.equal(git(w.wt, ["status", "--porcelain=v1", "--untracked-files=all"]), "", `${row}: the worktree is clean`);
  /** a new history whose middle commit's build also runs `extra`; the head keeps the reviewed tree */
  const sideEffect = (what: string, extra: string): [string, string] => {
    const c = w462Commit(w, `${reviewed}~1`, `chore: a build that ${what}`, w462Mutate(w, `${reviewed}~1`, "apps/web/build.mjs", `${W462_BUILD}${extra}`));
    const h = w462Commit(w, c, `feat(${OPUS}): the implementation (rewritten)`, tree);
    w462Move(w, h);
    return [c, h];
  };

  // (d) an untracked path before the checks: held, nothing checked
  put(w.wt, "scratch.txt", "an untracked file\n");
  const d = performPr(w);
  assert.deepEqual([d.status, w462Why(d), w462Patron(d)], [1, `why: refusing: ${w.wt} holds untracked path(s) scratch.txt; the checks build and replay in place, from a clean worktree: move them aside, then rerun; nothing checked or pushed`, []], ran("an untracked path before the checks holds the rewrite", d));
  rmSync(join(w.wt, "scratch.txt"));

  // (e) a build that writes a tracked path: held at it, the change undone
  const [tracked] = sideEffect("writes a tracked path", 'writeFileSync(new URL("../../docs/ADOPTION.md", import.meta.url), "changed by a build\\n");\n');
  const e = performPr(w);
  assert.deepEqual([e.status, w462Why(e), w462Patron(e), w462Origin(w)], [1, `why: the build of ${w462Short(tracked)} left the worktree changed (docs/ADOPTION.md), cleaned; certify builds and replays in a fresh clone; nothing pushed`, [], reviewed], ran("a build that writes a tracked path holds the rewrite", e));
  back("after a tracked write");
  pristine("after a tracked write");

  // (f) a build that leaves an untracked path: held at it, the path removed
  const [untracked] = sideEffect("leaves an untracked path", 'writeFileSync(new URL("./stray.txt", import.meta.url), "left by a build\\n");\n');
  const f = performPr(w);
  assert.deepEqual([f.status, w462Why(f), w462Patron(f), w462Origin(w)], [1, `why: the build of ${w462Short(untracked)} left the worktree changed (apps/web/stray.txt), cleaned; certify builds and replays in a fresh clone; nothing pushed`, [], reviewed], ran("a build that leaves an untracked path holds the rewrite", f));
  back("after an untracked write");
  pristine("after an untracked write");

  // (e2) a build that writes a tracked path and then fails: held at the build, the change undone, the branch restored
  const [failTracked] = sideEffect("writes a tracked path, then fails", 'writeFileSync(new URL("../../docs/ADOPTION.md", import.meta.url), "changed by a failing build\\n");\nprocess.exit(1);\n');
  const e2 = performPr(w);
  const e2Why = w462Why(e2) ?? "";
  assert.deepEqual([e2.status, e2Why.startsWith(`why: commit ${w462Short(failTracked)} does not build: web bundle build exited 1;`), e2Why.includes("docs/ADOPTION.md"), w462Patron(e2), w462Origin(w)], [1, true, true, [], reviewed], ran("a failing build that writes a tracked path holds the rewrite", e2));
  back("after a failing build's tracked write");
  pristine("after a failing build's tracked write");

  // (f2) a build that leaves an untracked path and then fails: likewise
  const [failUntracked] = sideEffect("leaves an untracked path, then fails", 'writeFileSync(new URL("./stray.txt", import.meta.url), "left by a failing build\\n");\nprocess.exit(1);\n');
  const f2 = performPr(w);
  const f2Why = w462Why(f2) ?? "";
  assert.deepEqual([f2.status, f2Why.startsWith(`why: commit ${w462Short(failUntracked)} does not build: web bundle build exited 1;`), f2Why.includes("apps/web/stray.txt"), w462Patron(f2), w462Origin(w)], [1, true, true, [], reviewed], ran("a failing build that leaves an untracked path holds the rewrite", f2));
  back("after a failing build's untracked write");
  pristine("after a failing build's untracked write");

  // (g) every check passes, but the worktree cannot be put back on the branch: no Patron command
  const [, lostHead] = sideEffect("loses the branch", `import { execFileSync } from "node:child_process";\nexecFileSync("git", ["update-ref", "-d", "refs/heads/${BRANCH}"]);\n`);
  const g = performPr(w);
  const gWhy = w462Why(g) ?? "";
  assert.deepEqual(
    [g.status, gWhy.startsWith(`why: the worktree ${w.wt} could not be put back on ${BRANCH} at ${w462Short(lostHead)} clean (git checkout ${BRANCH} failed: `), gWhy.endsWith("): put it back by hand, then rerun; nothing pushed"), w462Patron(g), w462Origin(w)],
    [1, true, true, [], reviewed],
    ran("a worktree that cannot be put back holds the rewrite", g),
  );
});

/** how many times a `next --perform` reads master's rules before the step's own read, when the binding is neither absent nor the PR head */
const W462_DERIVE_READS = 3;
test("W-462-b3 behaviour 3: after the Patron's leased push the rung rebinds the head and requests review again, then merge requeues it", { timeout: 600_000 }, () => {
  const { w, reviewed } = w462World("w462-b3");
  const tree = w462Tree(w, reviewed);
  const head = w462Commit(w, `${reviewed}~1`, `feat(${OPUS}): the implementation (rewritten)`, tree);
  w462Move(w, head);
  const p = performPr(w);
  const [line] = w462Patron(p);
  assert.ok(line !== undefined, ran("the Patron is asked", p));

  // the Patron runs the printed command; its lease is on the reviewed head
  const pushedNow = spawnSync("sh", ["-c", line.slice("patron: ".length)], { encoding: "utf8", env: SETUP_ENV });
  assert.deepEqual([pushedNow.status, w462Origin(w)], [0, head], `the Patron's command pushes the new head over the reviewed one\n${pushedNow.stderr}`);
  const notice = w418Notice(w, PR_NUMBER);
  rmSync(notice, { force: true });
  const rebindScenario = (edit: SlotValue, rules: SlotValue = { stdout: QUEUE_RULES }): void =>
    scenario(w, { rules, list: openList(w, { state: "OPEN", oid: head }), view: { stdout: { title: W418_TITLE } }, edit });
  const binding = (): string | undefined => w418Read(bindingPath(w));
  rebindScenario({ exit: 1, stderr: "HTTP 502: bad gateway\n" });

  // the rung rebinds before merge
  const o = next(w, [OPUS]);
  expectStep(o, "pr", "named", "a head pushed outside the rung is rebound before merge");
  assert.equal(o.kv.get("rebind"), `${w462Short(reviewed)} -> ${w462Short(head)}`, ran("the rebind names the old and the pushed head", o));

  // a review request that fails leaves the old binding, so the rung stays at rebind
  const failed = performPr(w);
  assert.deepEqual(
    [failed.status, w462Why(failed), outLines(failed).includes(`run: bisellium next ${OPUS} --perform --expect pr`), binding()],
    [1, `why: PR #${PR_NUMBER} touches code-owned paths, but the review request failed (HTTP 502: bad gateway)`, true, `${reviewed}\n`],
    ran("a failed review request leaves the old binding", failed),
  );
  expectStep(next(w, [OPUS]), "pr", "named", "after a failed review request the rung is still the rebind");

  rmSync(w.log, { force: true });
  rmSync(notice, { force: true });
  rebindScenario({ stdout: "" });
  const r = performPr(w);
  const W462_ONE = `PR #${PR_NUMBER} needs your review: ${W418_TITLE} (code-owned: docs/ADOPTION.md)`;
  assert.deepEqual(outLines(r).slice(1, 5), [`rebound: PR #${PR_NUMBER} ${w462Short(head)}`, "code-owned: docs/ADOPTION.md", `notice: ${W462_ONE}`, "review-requested: patron"], ran("rebound, the notice left and the review requested again", r));
  assert.deepEqual([r.status, mutating(w), w418Edits(w), w418Read(notice)], [0, ["git fetch master:master"], [["pr", "edit", String(PR_NUMBER), "-R", SLUG, "--add-reviewer", "patron"]], `${W462_ONE}\n`], ran("one review request, no push", r));
  assert.equal(binding(), `${head}\n`, "the queue binding holds the pushed head");

  // merge requeues the head that was checked
  expectStep(next(w, [OPUS]), "merge", "named", "then merge, which arms the queue on the pushed head");

  // in queue mode a binding that is not one commit id and a newline is never taken for the PR head: next holds
  const forms: [string, () => void, string][] = [
    ["malformed", () => writeFileSync(bindingPath(w), "not a commit id\n"), "it does not hold one commit id and a newline"],
    ["over-bound", () => writeFileSync(bindingPath(w), `${head}\n${"x".repeat(5000)}`), "target exceeds 4096 bytes"],
    [
      "symlinked",
      () => {
        const real = join(scratch("w462-b3-link"), "binding");
        writeFileSync(real, `${head}\n`);
        rmSync(bindingPath(w), { force: true });
        symlinkSync(real, bindingPath(w));
      },
      "path reaches its target through a symlink",
    ],
  ];
  for (const [form, make, reason] of forms) {
    make();
    const h = next(w, [OPUS]);
    assert.deepEqual([h.first, w462Why(h)], [`next: ${OPUS} merge held`, `why: PR #${PR_NUMBER} is OPEN on the local tip, but the queue binding of ${BRANCH} cannot be read (${reason}); it names the head pushed for the merge queue, so nothing is merged or rebound: inspect it by hand`], ran(`a ${form} queue binding holds`, h));
    rmSync(bindingPath(w), { force: true });
  }

  // a direct-mode caller with a stale binding is not rebound: merge, whose direct-mode hold reads the binding (W-199-b2)
  writeFileSync(bindingPath(w), `${reviewed}\n`);
  rmSync(w.log, { force: true });
  rebindScenario({ stdout: "" }, { stdout: [] });
  const dn = next(w, [OPUS]);
  expectStep(dn, "merge", "named", "a direct-mode caller is not rebound");
  const dm = performMerge(w);
  assert.deepEqual([dm.status, mutating(w), w418Edits(w), binding()], [1, [], [], `${reviewed}\n`], ran("a direct-mode merge holds the stale binding and writes nothing", dm));

  // master's merge mode read differently by the derivation and the perform: neither writes past the queue
  // (the derivation reads the rules W462_DERIVE_READS times in a perform before the step's own read)
  const flip = (first: Json[], then: Json[]): SlotValue => ({ replies: [...Array.from({ length: W462_DERIVE_READS }, () => ({ stdout: first })), { stdout: then }] });
  rmSync(w.log, { force: true });
  rebindScenario({ stdout: "" }, flip([], QUEUE_RULES));
  const qm = performMerge(w);
  assert.deepEqual(
    [qm.status, w462Why(qm), mutating(w), binding()],
    [1, `why: the queue binding of ${BRANCH} names ${w462Short(reviewed)}, not PR #${PR_NUMBER}'s head ${w462Short(head)}; nothing was enqueued: rerun bisellium next ${OPUS}`, [], `${reviewed}\n`],
    ran("a queue-mode merge never arms a head its binding does not name", qm),
  );
  rmSync(w.log, { force: true });
  rebindScenario({ stdout: "" }, flip(QUEUE_RULES, []));
  const dr = performPr(w);
  assert.deepEqual(
    [dr.status, w462Why(dr), mutating(w), w418Edits(w), binding()],
    [1, `why: master does not enforce the merge queue now; nothing rebound or requested: rerun bisellium next ${OPUS}`, [], [], `${reviewed}\n`],
    ran("a rebind in direct mode writes and requests nothing", dr),
  );
});
