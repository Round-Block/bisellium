/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { admitCurrentRunReceipt } from "@bisellium/commands/builder-run.js";
import { BRANCH, Json, OPUS, Out, PR_NUMBER, QUEUE_CONTEXTS, QUEUE_RULES, REPO_ROOT, SLUG, SlotValue, World, advanceOrigin, cand, commit, expectHeld, expectStep, ghCalls, ghMerges, git, landMerge, mergedList, modeLine, mutating, next, openList, outLines, performMerge, performPr, pushed, put, queueWorld, ran, remoteBranchExists, reviewed, scenario, tipOf, unmatched, viewOf, world, writeReceipt } from "./next-world.test.js";

/** W-199: the queue binding is a file under the Git common directory (read through the fixture `git`, which throws on a failed read). */
const bindingPath = (w: World): string => join(git(w.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "bisellium", "queue", encodeURIComponent(BRANCH));
const rulesWith = (edit: (rules: Json[]) => Json[]): SlotValue => ({ stdout: edit(structuredClone(QUEUE_RULES)) });
const queueParams = (rules: Json[]): Json => rules.find((r) => r["type"] === "merge_queue")!["parameters"] as Json;
const checksRule = (rules: Json[]): Json => rules.find((r) => r["type"] === "required_status_checks")!["parameters"] as Json;
const bound = (w: World): string => readFileSync(bindingPath(w), "utf8");

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
  assert.equal(readFileSync(path, "utf8"), "# Patron-only surfaces: a PR touching these needs the Patron's review.\n/.github/                 @edckt\n/scripts/ci-certify.mjs   @edckt\n/.claude/                 @edckt\n/studio/leges/            @edckt\n/studio/decisions/        @edckt\n/studio/bisellium.yml     @edckt\n/studio/prompts/          @edckt\n/docs/ADOPTION.md         @edckt\n");
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
