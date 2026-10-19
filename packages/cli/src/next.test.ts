/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * W-124 behaviour 3 and its TERMINALS table stay here: ladder-followon.test.ts (W-128 behaviour 2) reads this file.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BODY, BRANCH, HERE, MAIN, MIN_CHECKS, OID_UNFETCHED, OPUS, Out, PR_NUMBER, REPO_ROOT, SETUP_ENV, SLUG, SlotName, SlotValue, TITLE, TSX, World, advanceOrigin, advanceSource, branchExists, cand, check, expectHeld, expectStep, ghCalls, ghMerges, git, gitCalls, gitOk, greens, headOf, landMerge, mergedList, mutating, next, openList, performMerge, performPr, pushed, ran, remoteBranchExists, reviewed, runs, scenario, scratch, tipOf, unmatched, viewOf, world } from "./next-world.test.js";

/** An open PR on the tip whose merge lands (and reads back MERGED) once `gh pr merge` has been called. */
function landing(w: World, extra: Partial<Record<SlotName, SlotValue>> = {}): string {
  const flag = join(w.root, "merged.flag");
  const m = w.mergeOid ?? landMerge(w, false);
  scenario(w, {
    list: openList(w),
    view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m })) }] }] },
    merge: { replies: [{ stdout: "", touch: flag }] },
    ...extra,
  });
  return flag;
}
const performCleanup = (w: World): Out => next(w, [OPUS, "--perform", "--expect", "cleanup"]);
/** The terminal state a performed rung reports. */
function terminal(o: Out): string {
  const text = o.out + o.err;
  const states = [...text.matchAll(/state=([A-Z_]+)/g)];
  if (states.length) return states[states.length - 1]![1]!;
  if (/refusing|held/i.test(text)) return "REFUSED";
  if (new RegExp(`\\b${PR_NUMBER}\\b`).test(text)) return "CREATED";
  return "?";
}
const callIndex = (w: World, pred: (a: string[]) => boolean): number => gitCalls(w).findIndex(pred);

type TerminalName = "CHECKS_FAILED" | "GHAS_STOP" | "MERGE_FAILED" | "MERGED" | "QUEUE_REJECTED" | "CONFLICT" | "dirty tree" | "on master" | "CREATED";
const TERMINALS: { name: TerminalName; kind: "merge" | "pr"; terminal: string; calls: string[] }[] = [
  { name: "CHECKS_FAILED", kind: "merge", terminal: "CHECKS_FAILED", calls: [] },
  { name: "GHAS_STOP", kind: "merge", terminal: "GHAS_STOP", calls: [] },
  { name: "MERGE_FAILED", kind: "merge", terminal: "MERGE_FAILED", calls: ["gh pr merge --squash --auto"] },
  { name: "MERGED", kind: "merge", terminal: "MERGED", calls: ["gh pr merge --squash --auto", "git fetch master:master"] },
  { name: "QUEUE_REJECTED", kind: "merge", terminal: "QUEUE_REJECTED", calls: ["gh pr merge --squash --auto"] },
  { name: "CONFLICT", kind: "pr", terminal: "CONFLICT", calls: ["git fetch master:master", "git rebase", "git rebase --abort"] },
  { name: "dirty tree", kind: "pr", terminal: "REFUSED", calls: [] },
  { name: "on master", kind: "pr", terminal: "REFUSED", calls: [] },
  { name: "CREATED", kind: "pr", terminal: "CREATED", calls: ["git fetch master:master", "git rebase", "git push --force-with-lease", "gh pr create"] },
];
/** A fresh world for one terminal-state scenario. */
function terminalWorld(name: TerminalName): World {
  const tag = `b3-terminal-${name.replace(/\W+/g, "-")}`;
  switch (name) {
    case "CHECKS_FAILED": {
      const w = pushed(tag);
      scenario(w, { list: openList(w), checks: { stdout: [...greens(MIN_CHECKS), check("lint", "fail")] } });
      return w;
    }
    case "GHAS_STOP": {
      const w = pushed(tag);
      scenario(w, { list: openList(w), alerts: { stdout: [{ number: 1, state: "open" }] } });
      return w;
    }
    case "MERGE_FAILED": {
      const w = pushed(tag);
      scenario(w, { list: openList(w), merge: { exit: 1, stderr: "merge refused" } });
      return w;
    }
    case "MERGED": {
      const w = pushed(tag);
      landing(w);
      return w;
    }
    case "QUEUE_REJECTED": {
      const w = pushed(tag);
      const flag = join(w.root, "merged.flag");
      scenario(w, {
        list: openList(w),
        view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN" })) }], alts: [{ ifExists: flag, replies: [{ stdout: viewOf(cand(w, { state: "CLOSED" })) }] }] },
        merge: { replies: [{ stdout: "", touch: flag }] },
      });
      return w;
    }
    case "CONFLICT": {
      const w = reviewed(tag, { mainOnMaster: false }, (x) => advanceSource(x));
      advanceOrigin(w, "source.txt", "candidate source\ntrunk change\n");
      return w;
    }
    case "dirty tree": {
      const w = reviewed(tag, { mainOnMaster: false });
      appendFileSync(join(w.wtStudio, "notes.md"), "uncommitted bookkeeping edit\n");
      return w;
    }
    case "on master": {
      const w = reviewed(tag, { mainOnMaster: false });
      git(w.wt, ["switch", "-q", "master"]);
      return w;
    }
    case "CREATED":
      return reviewed(tag, { mainOnMaster: false });
  }
}

if (runs(3)) {
  test("W-124 behaviour 3: pr, merge and cleanup run in order and fail closed on gh", { timeout: 3_600_000 }, () => {
    // the verb's own terminal line, from a scenario that never sleeps
    const first = pushed("b3-first");
    scenario(first, { list: openList(first), merge: { exit: 1, stderr: "merge refused" } });
    const firstOut = performMerge(first);
    assert.match(firstOut.out, /state=MERGE_FAILED/, ran("a performed merge prints state=MERGE_FAILED", firstOut));
    assert.equal(firstOut.status, 1, ran("MERGE_FAILED exits 1", firstOut));

    // reads: fixed --json field lists, never -q or text greps; -R <slug> and --match-head-commit are the declared divergences
    const reads = pushed("b3-reads");
    landing(reads);
    const readsOut = performMerge(reads);
    assert.match(readsOut.out, /state=MERGED/, ran("the landing scenario merges", readsOut));
    assert.deepEqual(unmatched(reads), [], "the verb made no gh call the scenario did not expect");
    const gh = ghCalls(reads);
    assert.ok(gh.length > 0 && gh.filter((a) => a[0] !== "repo" && a[0] !== "api").every((a) => a.includes("-R") && a[a.indexOf("-R") + 1] === SLUG), "-R <slug> is pinned on every gh call that accepts it");
    for (const a of gh) assert.ok(!a.includes("-q") && !a.includes("--jq") && !a.includes("--template"), `no -q/--jq read: gh ${a.join(" ")}`);
    const list = gh.find((a) => a[0] === "pr" && a[1] === "list");
    assert.match(list?.[list.indexOf("--json") + 1] ?? "", /headRefOid/, "pr list reads a fixed --json field list");
    const checksCall = gh.find((a) => a[0] === "pr" && a[1] === "checks");
    assert.equal(checksCall?.[checksCall.indexOf("--json") + 1], "name,bucket,state", "pr checks reads --json name,bucket,state");
    assert.ok(gh.some((a) => a[0] === "api" && a.some((x) => x.startsWith(`repos/${SLUG}/code-scanning/alerts`))), "GHAS alerts come from gh api repos/<slug>/code-scanning/alerts");
    const mergeCall = ghMerges(reads)[0];
    assert.ok(mergeCall?.includes("--squash") && mergeCall.includes("--auto"), "the first merge is --squash --auto");
    assert.equal(mergeCall?.[mergeCall.indexOf("--match-head-commit") + 1], headOf(reads), "gh pr merge pins --match-head-commit <headRefOid>");
    assert.deepEqual(mutating(reads), ["gh pr merge --squash --auto", "git fetch master:master"], "MERGED is reported only after the merge and the trunk fetch");
    assert.equal(gitOk(reads.repo, ["merge-base", "--is-ancestor", reads.mergeOid!, "refs/heads/master"]), true, "the local trunk contains the merge commit");

    // terminal states: the verb reaches each one through its ordered mutating calls and no unexpected gh call
    for (const p of TERMINALS) {
      const b = terminalWorld(p.name);
      const v = p.kind === "merge" ? performMerge(b) : performPr(b);
      assert.equal(terminal(v), p.terminal, ran(`terminal ${p.name}: verb terminal state`, v));
      assert.deepEqual(mutating(b), p.calls, `terminal ${p.name}: the verb's ordered mutating calls`);
      assert.deepEqual(unmatched(b), [], `terminal ${p.name}: the verb made no unexpected gh call`);
    }

    // pr: what the verb creates and how
    const created = terminalWorld("CREATED");
    performPr(created);
    const createCall = ghCalls(created).find((a) => a[0] === "pr" && a[1] === "create") ?? [];
    assert.ok(createCall.includes("-R"), "gh pr create is pinned to -R <slug>");
    assert.equal(createCall[createCall.indexOf("--base") + 1], "master", "gh pr create --base master");
    assert.equal(createCall[createCall.indexOf("--head") + 1], BRANCH, "gh pr create --head opus/<id>");
    assert.equal(createCall[createCall.indexOf("--title") + 1], TITLE);
    assert.equal(createCall[createCall.indexOf("--body-file") + 1], BODY);
    const push = gitCalls(created).find((a) => a[0] === "push" && a.some((x) => x.startsWith("--force-with-lease"))) ?? [];
    assert.ok(push.includes(BRANCH), "the branch is pushed with --force-with-lease");
    const namedOnly = terminalWorld("CREATED");
    const named = performPr(namedOnly, []);
    expectStep(named, "pr", "named", "without --title and --body-file pr only names the command");
    assert.equal(named.status, 0, ran("named pr exit", named));
    assert.ok(named.kv.has("command"), ran("and prints the command", named));
    assert.deepEqual(mutating(namedOnly), [], "nothing is fetched, rebased, pushed or created");

    const reuse = reviewed("b3-reuse", { mainOnMaster: false });
    scenario(reuse, { list: openList(reuse, { state: "OPEN", oid: "8".repeat(40) }) });
    performPr(reuse);
    assert.deepEqual(mutating(reuse), ["git fetch master:master", "git rebase", "git push --force-with-lease"], "an existing OPEN PR is reused, never duplicated");

    const moved = reviewed("b3-rebase-source", { mainOnMaster: false });
    advanceOrigin(moved, "trunk.txt", "a new trunk file changes the SOURCE tree\n");
    const movedOut = performPr(moved);
    assert.deepEqual(mutating(moved), ["git fetch master:master", "git rebase"], "a rebase that changes the SOURCE tree stops before push and PR");
    assert.match(movedOut.out, /\bbuild\b/, ran("and re-derives (build)", movedOut));

    // merge: update when BEHIND, queue rejection/timeout, HEAD_MOVED, direct merge only when CLEAN
    const behind = pushed("b3-behind");
    const updated = join(behind.root, "updated.flag");
    const behindFlag = join(behind.root, "merged.flag");
    const behindM = landMerge(behind, false);
    scenario(behind, {
      list: openList(behind),
      view: {
        replies: [{ stdout: viewOf(cand(behind, { state: "OPEN", mss: "BEHIND" })) }],
        alts: [
          { ifExists: behindFlag, replies: [{ stdout: viewOf(cand(behind, { state: "MERGED", merge: behindM })) }] },
          { ifExists: updated, replies: [{ stdout: viewOf(cand(behind, { state: "OPEN", mss: "CLEAN" })) }] },
        ],
      },
      update: { stdout: "", touch: updated },
      merge: { replies: [{ stdout: "", touch: behindFlag }] },
    });
    performMerge(behind);
    assert.deepEqual(mutating(behind), ["gh pr update-branch", "gh pr merge --squash --auto", "git fetch master:master"], "gh pr update-branch when BEHIND, before the merge");

    const queuedBehind = pushed("b3-queued-behind");
    const queuedMerged = join(queuedBehind.root, "merged.flag");
    const queuedUpdated = join(queuedBehind.root, "updated.flag");
    const queuedM = landMerge(queuedBehind, false);
    scenario(queuedBehind, {
      list: openList(queuedBehind),
      view: {
        replies: [{ stdout: viewOf(cand(queuedBehind, { state: "OPEN" })) }],
        alts: [
          { ifExists: queuedUpdated, replies: [{ stdout: viewOf(cand(queuedBehind, { state: "MERGED", merge: queuedM })) }] },
          { ifExists: queuedMerged, replies: [{ stdout: viewOf(cand(queuedBehind, { state: "OPEN", mss: "BEHIND" })) }] },
        ],
      },
      update: { stdout: "", touch: queuedUpdated },
      merge: { replies: [{ stdout: "", touch: queuedMerged }] },
    });
    performMerge(queuedBehind);
    assert.deepEqual(mutating(queuedBehind), ["gh pr merge --squash --auto", "gh pr update-branch", "git fetch master:master"], "an update when BEHIND while queued");

    const direct = pushed("b3-direct");
    const directFlag = join(direct.root, "merged.flag");
    const directM = landMerge(direct, false);
    scenario(direct, {
      list: openList(direct),
      view: { replies: [{ stdout: viewOf(cand(direct, { state: "OPEN", mss: "CLEAN" })) }], alts: [{ ifExists: directFlag, replies: [{ stdout: viewOf(cand(direct, { state: "MERGED", merge: directM })) }] }] },
      merge: { replies: [{ stdout: "" }, { stdout: "", touch: directFlag }] },
    });
    performMerge(direct);
    assert.deepEqual(mutating(direct), ["gh pr merge --squash --auto", "gh pr merge --squash", "git fetch master:master"], "a direct merge follows only when CLEAN with every check pass");
    const directCall = ghMerges(direct)[1] ?? [];
    assert.equal(directCall[directCall.indexOf("--match-head-commit") + 1], headOf(direct), "the direct merge also pins --match-head-commit");

    const blocked = pushed("b3-blocked");
    scenario(blocked, { list: openList(blocked), view: { stdout: viewOf(cand(blocked, { state: "OPEN", mss: "BLOCKED" })) } });
    const blockedOut = performMerge(blocked);
    assert.match(blockedOut.out, /state=QUEUE_TIMEOUT/, ran("a BLOCKED green PR waits and ends QUEUE_TIMEOUT (a BLOCKED PR is never merged directly)", blockedOut));
    assert.deepEqual(mutating(blocked), ["gh pr merge --squash --auto"], "BLOCKED is never merged directly");

    const movedHead = pushed("b3-head-moved");
    const movedFlag = join(movedHead.root, "merged.flag");
    scenario(movedHead, {
      list: openList(movedHead),
      view: { replies: [{ stdout: viewOf(cand(movedHead, { state: "OPEN" })) }], alts: [{ ifExists: movedFlag, replies: [{ stdout: viewOf(cand(movedHead, { state: "OPEN", oid: "7".repeat(40) })) }] }] },
      merge: { replies: [{ stdout: "", touch: movedFlag }] },
    });
    const movedHeadOut = performMerge(movedHead);
    assert.match(movedHeadOut.out, /state=HEAD_MOVED/, ran("a head that moves from the pinned oid is HEAD_MOVED", movedHeadOut));
    assert.deepEqual(mutating(movedHead), ["gh pr merge --squash --auto"], "nothing more is done after HEAD_MOVED");

    // merge refusals: GHAS (alerts, API error, non-array), too few passing checks, skipping/cancel not counted
    const refuse = (row: string, over: Partial<Record<SlotName, SlotValue>>, state?: RegExp): void => {
      const w = pushed(`b3-refuse-${row.replace(/\W+/g, "-")}`);
      scenario(w, { list: openList(w), ...over });
      const o = performMerge(w);
      assert.equal(o.status, 1, ran(`merge refuses: ${row}`, o));
      if (state) assert.match(o.out, state, ran(`${row}: terminal state`, o));
      assert.deepEqual(mutating(w), [], `${row}: no mutating call`);
    };
    refuse("an API error on the GHAS read", { alerts: { exit: 1, stderr: "HTTP 403" } }, /state=GHAS_STOP/);
    refuse("a non-array reply on the GHAS read", { alerts: { stdout: { message: "Not Found" } } }, /state=GHAS_STOP/);
    refuse("fewer than MIN_CHECKS passing checks", { checks: { stdout: greens(MIN_CHECKS - 1) } });
    refuse("skipping and cancel checks do not count toward MIN_CHECKS", {
      checks: { stdout: [...greens(MIN_CHECKS - 1), check("s1", "skipping"), check("s2", "skipping"), check("c1", "cancel")] },
    });

    // a passed check named pending-review is not pending (the bucket decides, never the name)
    const pendingName = pushed("b3-pending-name");
    landing(pendingName, { checks: { stdout: [...greens(MIN_CHECKS), check("pending-review", "pass")] } });
    const pendingOut = performMerge(pendingName);
    assert.match(pendingOut.out, /state=MERGED/, ran("a check NAMED pending-review that passed does not block the merge", pendingOut));

    // an untracked file does not refuse pr (only tracked changes count as dirty)
    const untracked = reviewed("b3-untracked", { mainOnMaster: false });
    writeFileSync(join(untracked.wt, "scratch.txt"), "untracked\n");
    performPr(untracked);
    assert.ok(mutating(untracked).includes("gh pr create"), "an untracked file does not refuse pr");

    // a PR already MERGED: only the fetch and the re-check
    const merged = pushed("b3-already-merged");
    const mergedM = landMerge(merged, false);
    scenario(merged, { list: mergedList(merged, { merge: mergedM }) });
    const mergedOut = performMerge(merged);
    assert.match(mergedOut.out, /state=MERGED/, ran("an already-MERGED PR prints state=MERGED after the fetch and re-check", mergedOut));
    assert.deepEqual(mutating(merged), ["git fetch master:master"], "no update-branch and no merge for a MERGED PR");
    assert.deepEqual(gitCalls(merged).filter((a) => a[0] === "branch" || (a[0] === "worktree" && a[1] === "add")), [], "and no branch creation");
    const stuck = pushed("b3-merged-not-contained");
    scenario(stuck, { list: mergedList(stuck, { merge: OID_UNFETCHED }) });
    const stuckOut = performMerge(stuck);
    expectHeld(stuckOut, "a merge commit still not contained after the fetch");
    assert.ok(stuckOut.out.includes(OID_UNFETCHED.slice(0, 12)), ran("held names the merge commit", stuckOut));
    assert.equal(ghMerges(stuck).length, 0, "and issues no merge");

    // fail closed: one row per mode, each held, exit 1, zero mutating calls
    const fc = pushed("b3-failclosed");
    const good = cand(fc, { state: "OPEN" });
    const pad = "x".repeat(1_100_000);
    const modes: [string, Partial<Record<SlotName, SlotValue>>][] = [
      ["gh exits non-zero (pr list)", { list: { stdout: "", stderr: "HTTP 502", exit: 3 } }],
      ["empty output (pr list)", { list: { stdout: "" } }],
      ["non-JSON (pr list)", { list: { stdout: "<html>bad gateway</html>" } }],
      ["a missing required field (pr list)", { list: { stdout: [cand(fc, { state: "OPEN", drop: ["headRefOid"] })] } }],
      ["an unknown state (pr list)", { list: { stdout: [cand(fc, { state: "WEIRD" as "OPEN" })] } }],
      ["an unknown mergeStateStatus (pr list)", { list: { stdout: [cand(fc, { state: "OPEN", mss: "WOBBLY" })] } }],
      ["output over 1 MiB (pr list)", { list: { stdout: [good, { pad }] } }],
      ["gh exits non-zero (pr checks)", { checks: { stdout: "", stderr: "HTTP 502", exit: 3 } }],
      ["empty output (pr checks)", { checks: { stdout: "" } }],
      ["non-JSON (pr checks)", { checks: { stdout: "no checks reported" } }],
      ["a missing required field (pr checks)", { checks: { stdout: [...greens().slice(0, 5), { name: "no-bucket", state: "SUCCESS" }] } }],
      ["an unknown bucket (pr checks)", { checks: { stdout: [...greens().slice(0, 5), check("odd", "weird")] } }],
      ["output over 1 MiB (pr checks)", { checks: { stdout: [...greens(), { name: "pad", bucket: "pass", state: "SUCCESS", pad }] } }],
      ["an empty check list (pr checks)", { checks: { stdout: [] } }],
    ];
    for (const [mode, over] of modes) {
      scenario(fc, { list: { stdout: [good] }, ...over });
      const o = performMerge(fc);
      expectHeld(o, `fail closed: ${mode}`);
      assert.deepEqual(mutating(fc), [], `fail closed: ${mode}: zero mutating calls`);
    }

    // cleanup: deletions in order, each after a fresh MERGED read
    const cleanupWorld = (tag: string): World => {
      const w = world(tag, "merge", { mainOnMaster: false });
      scenario(w, { list: mergedList(w), view: { stdout: viewOf(cand(w, { state: "MERGED" })) } });
      return w;
    };
    const outcome = (o: Out, what: RegExp): string => {
      const line = o.out.split("\n").find((l) => what.test(l) && /(ran|skipped \(absent\)|held)/.test(l));
      return /\b(ran|skipped \(absent\)|held)(?!\w)/.exec(line ?? "")?.[1] ?? "(not reported)";
    };
    const WORKTREE = /worktree/i;
    const LOCAL = /^\s*(local )?branch/i;
    const REMOTE = /remote/i;
    const gone = (w: World): void => {
      assert.equal(existsSync(w.wt), false, "the worktree is gone");
      assert.equal(branchExists(w), false, "the local branch is gone");
      assert.equal(remoteBranchExists(w), false, "the remote branch is gone");
    };
    const full = cleanupWorld("b3-cleanup-full");
    const fullTip = tipOf(full);
    const fullOut = performCleanup(full);
    expectStep(fullOut, "cleanup", "performed", "cleanup performed");
    gone(full);
    assert.deepEqual([outcome(fullOut, WORKTREE), outcome(fullOut, LOCAL), outcome(fullOut, REMOTE)], ["ran", "ran", "ran"], ran("every deletion is reported", fullOut));
    const order = [
      callIndex(full, (a) => a[0] === "worktree" && a[1] === "remove"),
      callIndex(full, (a) => a[0] === "update-ref" && a[1] === "-d" && a.includes(`refs/heads/${BRANCH}`)),
      callIndex(full, (a) => a[0] === "push" && a.includes("--delete")),
    ];
    assert.ok(order[0]! >= 0 && order[0]! < order[1]! && order[1]! < order[2]!, `worktree, then branch, then remote: ${order.join(",")}`);
    const removal = gitCalls(full)[order[0]!] ?? [];
    assert.ok(!removal.includes("--force") && removal.includes("--") && removal.includes(full.wt), "git worktree remove -- <path>, never --force");
    assert.ok(gitCalls(full)[order[1]!]?.includes(fullTip), "update-ref -d is a compare-and-swap on the tip");
    assert.ok(gitCalls(full)[order[2]!]?.includes(`--force-with-lease=refs/heads/${BRANCH}:${headOf(full)}`), "the remote delete is leased on the merged headRefOid");

    // a flip to OPEN between the re-reads stops the later deletions
    const flipped2 = world("b3-cleanup-flip", "merge", { mainOnMaster: false });
    const open = [cand(flipped2, { state: "OPEN" })];
    scenario(flipped2, {
      list: { replies: [{ stdout: [cand(flipped2, { state: "MERGED" })] }], alts: [{ ifMissing: flipped2.wt, replies: [{ stdout: open }] }] },
      view: { replies: [{ stdout: viewOf(cand(flipped2, { state: "MERGED" })) }], alts: [{ ifMissing: flipped2.wt, replies: [{ stdout: viewOf(open[0]!) }] }] },
    });
    const flippedOut = performCleanup(flipped2);
    assert.equal(flippedOut.status, 1, ran("a flipped PR holds", flippedOut));
    assert.equal(existsSync(flipped2.wt), false, "the first deletion ran");
    assert.equal(branchExists(flipped2), true, "the later deletions did not (branch)");
    assert.equal(remoteBranchExists(flipped2), true, "the later deletions did not (remote)");

    // nothing is touched for a dirty worktree, a branch ahead of the merge, an OPEN PR, a CLOSED-unmerged PR
    const untouched = (w: World, row: string): void => {
      assert.equal(existsSync(w.wt), true, `${row}: worktree untouched`);
      assert.equal(branchExists(w), true, `${row}: branch untouched`);
      assert.equal(remoteBranchExists(w), true, `${row}: remote untouched`);
    };
    const dirty = cleanupWorld("b3-cleanup-dirty");
    appendFileSync(join(dirty.wt, "source.txt"), "uncommitted\n");
    const dirtyOut = performCleanup(dirty);
    assert.equal(dirtyOut.status, 1, ran("a dirty worktree holds", dirtyOut));
    untouched(dirty, "dirty worktree");
    const ahead = world("b3-cleanup-ahead", "merge", { mainOnMaster: false });
    const mergedTip = tipOf(ahead);
    advanceSource(ahead, false);
    scenario(ahead, { list: mergedList(ahead, { oid: mergedTip }), view: { stdout: viewOf(cand(ahead, { state: "MERGED", oid: mergedTip })) } });
    const aheadOut = performCleanup(ahead);
    assert.equal(aheadOut.status, 1, ran("a local branch ahead of the merged PR holds", aheadOut));
    untouched(ahead, "branch ahead of the merge");
    const openPr = cleanupWorld("b3-cleanup-open");
    scenario(openPr, { list: openList(openPr) });
    assert.equal(performCleanup(openPr).status, 1, "an OPEN PR is not cleaned up (the PR 127 shape)");
    untouched(openPr, "OPEN PR");
    const closedPr = cleanupWorld("b3-cleanup-closed");
    scenario(closedPr, { list: { stdout: [cand(closedPr, { state: "CLOSED" })] } });
    assert.equal(performCleanup(closedPr).status, 1, "a CLOSED-unmerged PR is not cleaned up");
    untouched(closedPr, "CLOSED-unmerged PR");

    // idempotent resume after an interrupted cleanup
    const r1 = cleanupWorld("b3-resume-1");
    git(r1.repo, ["worktree", "remove", "--force", r1.wt]);
    const r1Out = performCleanup(r1);
    gone(r1);
    assert.deepEqual([outcome(r1Out, WORKTREE), outcome(r1Out, LOCAL), outcome(r1Out, REMOTE)], ["skipped (absent)", "ran", "ran"], ran("worktree removed, branch present", r1Out));
    const r2 = cleanupWorld("b3-resume-2");
    git(r2.repo, ["worktree", "remove", "--force", r2.wt]);
    git(r2.repo, ["branch", "-D", BRANCH]);
    const r2Out = performCleanup(r2);
    gone(r2);
    assert.deepEqual([outcome(r2Out, WORKTREE), outcome(r2Out, LOCAL), outcome(r2Out, REMOTE)], ["skipped (absent)", "skipped (absent)", "ran"], ran("worktree and branch gone, remote present", r2Out));
    const r3 = cleanupWorld("b3-resume-3");
    rmSync(r3.wt, { recursive: true, force: true });
    const r3Out = performCleanup(r3);
    assert.equal(r3Out.status, 0, ran("a worktree directory deleted by hand is pruned", r3Out));
    gone(r3);
    assert.ok(callIndex(r3, (a) => a[0] === "worktree" && a[1] === "prune") >= 0, "git worktree prune ran for the prunable entry");
    assert.ok(gitCalls(r3).every((a) => !(a[0] === "worktree" && a.includes("--force"))), "and never --force");
    const r4 = world("b3-resume-4", "cleanup");
    scenario(r4, { list: mergedList(r4) });
    expectStep(next(r4, [OPUS]), "done", "named", "worktree, branch and remote all gone: the rung is met and the step is done");
    const r5 = cleanupWorld("b3-resume-5");
    git(r5.repo, ["worktree", "remove", "--force", r5.wt]);
    mkdirSync(r5.wt, { recursive: true });
    writeFileSync(join(r5.wt, "keep.txt"), "not a worktree\n");
    const r5Out = performCleanup(r5);
    assert.equal(r5Out.status, 1, ran("a directory that is not the registered worktree is held", r5Out));
    assert.equal(readFileSync(join(r5.wt, "keep.txt"), "utf8"), "not a worktree\n", "and left untouched");
    assert.equal(branchExists(r5), true, "the branch is left alone too");
  });
}

// ---------------------------------------------------------------------------
// round-1 fix pass (censor findings 1-2, sec-lead findings 1-3): each row is its
// own test so every red shows by itself
// ---------------------------------------------------------------------------
const lines = (o: Out): string[] => o.out.split("\n");
const CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
/** A parentless commit with the opus tree: known locally, never a descendant of the reviewed head. */
const strangerCommit = (w: World): string => git(w.repo, ["commit-tree", git(w.repo, ["rev-parse", `${tipOf(w)}^{tree}`]), "-m", "not descended from the reviewed head"]);
/** A commit on top of the opus tip, pushed over the origin's opus branch (what `update-branch` would produce). */
function pushChild(w: World): string {
  const child = git(w.repo, ["commit-tree", git(w.repo, ["rev-parse", `${tipOf(w)}^{tree}`]), "-p", tipOf(w), "-m", "update-branch merge"]);
  git(w.repo, ["push", "-q", "origin", `${child}:refs/heads/${BRANCH}`]);
  return child;
}

if (runs(3)) {
  test("W-124 behaviour 3 (round-1 fix C): a BEHIND PR on another head than the reviewed pin is HEAD_MOVED with nothing mutated", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-different");
    scenario(w, { list: openList(w), view: { stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND", oid: "7".repeat(40) })) } });
    const o = performMerge(w);
    assert.match(o.out, /state=HEAD_MOVED/, ran("a BEHIND view on another oid is HEAD_MOVED", o));
    assert.equal(o.status, 1, ran("HEAD_MOVED exits 1", o));
    assert.deepEqual(mutating(w), [], "no update-branch and no merge call");
  });

  test("W-124 behaviour 3 (round-1 fix C): a head after update-branch that does not descend from the pin is HEAD_MOVED", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-diverged");
    const stranger = strangerCommit(w);
    git(w.repo, ["push", "-q", "--force", "origin", `${stranger}:refs/heads/${BRANCH}`]);
    const updated = join(w.root, "updated.flag");
    scenario(w, {
      list: openList(w),
      view: { replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }], alts: [{ ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN", oid: stranger })) }] }] },
      update: { stdout: "", touch: updated },
    });
    const o = performMerge(w);
    assert.match(o.out, /state=HEAD_MOVED/, ran("an unrelated post-update head is HEAD_MOVED", o));
    assert.deepEqual(mutating(w), ["gh pr update-branch"], "the new head is never adopted: no merge call");
  });

  test("W-124 behaviour 3 (round-1 fix C): a head that moved while queued and does not descend from the pin is HEAD_MOVED", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-queued");
    const stranger = strangerCommit(w);
    git(w.repo, ["push", "-q", "--force", "origin", `${stranger}:refs/heads/${BRANCH}`]);
    const merged = join(w.root, "merged.flag");
    const updated = join(w.root, "updated.flag");
    scenario(w, {
      list: openList(w),
      view: {
        replies: [{ stdout: viewOf(cand(w, { state: "OPEN" })) }],
        alts: [
          { ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN", oid: stranger })) }] },
          { ifExists: merged, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }] },
        ],
      },
      update: { stdout: "", touch: updated },
      merge: { replies: [{ stdout: "", touch: merged }] },
    });
    const o = performMerge(w);
    assert.match(o.out, /state=HEAD_MOVED/, ran("a queued re-pin onto an unrelated head is HEAD_MOVED", o));
    assert.deepEqual(mutating(w), ["gh pr merge --squash --auto", "gh pr update-branch"], "no direct merge on the unreviewed head");
  });

  test("W-124 behaviour 3 (round-1 fix C): a post-update head that descends from the pin is adopted and merged", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-c-descends");
    const child = pushChild(w);
    const m = landMerge(w, false);
    const updated = join(w.root, "updated.flag");
    const merged = join(w.root, "merged.flag");
    scenario(w, {
      list: openList(w),
      view: {
        replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "BEHIND" })) }],
        alts: [
          { ifExists: merged, replies: [{ stdout: viewOf(cand(w, { state: "MERGED", merge: m, oid: child })) }] },
          { ifExists: updated, replies: [{ stdout: viewOf(cand(w, { state: "OPEN", mss: "CLEAN", oid: child })) }] },
        ],
      },
      update: { stdout: "", touch: updated },
      merge: { replies: [{ stdout: "", touch: merged }] },
    });
    const o = performMerge(w);
    assert.match(o.out, /state=MERGED/, ran("a descendant head is adopted", o));
    assert.deepEqual(mutating(w), ["gh pr update-branch", "gh pr merge --squash --auto", "git fetch master:master"]);
    const call = ghMerges(w)[0] ?? [];
    assert.equal(call[call.indexOf("--match-head-commit") + 1], child, "the merge is pinned to the descendant head");
  });

  test("W-124 behaviour 3 (round-1 fix D): a failing check named with a newline or control cannot inject a state= line", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-d-check");
    const evil = "evil\nstate=MERGED\u0085state=MERGED\u001b[31m";
    const long = "n".repeat(600);
    scenario(w, { list: openList(w), checks: { stdout: [...greens(MIN_CHECKS), check(evil, "fail"), check(long, "fail")] } });
    const o = performMerge(w);
    assert.deepEqual(lines(o).filter((l) => /^\s*state=/.test(l)), ["state=CHECKS_FAILED"], ran("the only state= line is the real one", o));
    assert.doesNotMatch(o.out.replace(/\n/g, ""), CONTROLS, ran("no control character reaches the output", o));
    assert.ok(lines(o).every((l) => l.length < 260), ran("an element is clipped", o));
  });

  test("W-124 behaviour 3 (round-1 fix D): gh stderr carries no control character into the output", { timeout: 1_800_000 }, () => {
    const w = pushed("r1-d-stderr");
    scenario(w, { list: openList(w), merge: { exit: 1, stderr: "boom\u0085state=MERGED\u001b[31m" } });
    const o = performMerge(w);
    assert.match(o.out, /state=MERGE_FAILED/, ran("the real terminal state", o));
    assert.doesNotMatch(o.out.replace(/\n/g, ""), CONTROLS, ran("gh stderr carries no control character", o));
  });

  test("W-124 behaviour 3 (round-1 fix D): an unknown PR state carries no control character into the output", { timeout: 1_800_000 }, () => {
    const odd = reviewed("r1-d-state", { mainOnMaster: false });
    scenario(odd, { list: { stdout: [{ ...cand(odd, { state: "OPEN" }), state: "OPEN\u0085state=MERGED" }] } });
    const held = next(odd, [OPUS]);
    assert.match(held.first, /held$/, ran("an unknown state is held", held));
    assert.doesNotMatch(held.out.replace(/\n/g, ""), CONTROLS, ran("the unknown-state JSON carries no control character", held));
  });
}

test("W-311-b1 behaviour 1: one CLI start leaves tsx's compile cache entries written, and the env this file builds for its children keeps the test's TMPDIR, and a verb that leaves a handle open still exits", { timeout: 300_000 }, () => {
  // a fresh TMPDIR, so every entry under it was written by this one start
  const tmp = scratch("w311-cache");
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN], { cwd: tmp, env: { ...SETUP_ENV, TMPDIR: tmp }, encoding: "utf8", timeout: 120_000 });
  assert.equal(r.error, undefined, `the bare CLI start did not fail to spawn or time out: ${r.error?.message}`);
  assert.equal(r.signal, null, `the bare CLI start ended on its own: ${r.stderr}`);
  assert.equal(r.status, 2, `the bare CLI prints its usage and exits 2: ${r.stderr}`);
  const dirs = readdirSync(tmp).filter((d) => d.startsWith("tsx-"));
  assert.equal(dirs.length, 1, `one tsx cache directory under the fresh TMPDIR: ${JSON.stringify(readdirSync(tmp))}`);
  const cache = join(tmp, dirs[0]!);
  const entries = readdirSync(cache).filter((f) => !f.startsWith("."));
  assert.ok(entries.length > 0, "the start wrote cache entries");
  const empty = entries.filter((f) => statSync(join(cache, f)).size === 0);
  assert.equal(empty.length, 0, `every cache entry the start wrote is non-empty: ${empty.length} of ${entries.length} are empty`);
  // SETUP_ENV is every git and CLI child's env in this file: without TMPDIR a child's cache goes to /tmp,
  // which the Claude sandbox mounts read-only
  assert.equal(SETUP_ENV["TMPDIR"], tmpdir(), "SETUP_ENV carries the test process's TMPDIR");
  // a handle a verb leaves open past main(): hook-event's payload reader on a stdin that never ends, a FIFO
  // this process holds open for writing; the CLI still exits, with the code main() returned
  const fifo = join(tmp, "stdin.fifo");
  execFileSync("mkfifo", [fifo]);
  assert.ok(statSync(fifo).isFIFO(), "the stdin the row holds open is a FIFO");
  const fd = openSync(fifo, "r+");
  try {
    const h = spawnSync(process.execPath, ["--import", TSX, MAIN, "hook-event", "tool", "--sella", "guest", "--studio", tmp], { cwd: tmp, env: SETUP_ENV, stdio: [fd, "pipe", "pipe"], encoding: "utf8", timeout: 30_000 });
    assert.equal(h.error, undefined, `hook-event did not fail to spawn or time out: ${h.error?.message}`);
    assert.equal(h.signal, null, `hook-event on a stdin that never ends exits on its own: ${h.stderr}`);
    assert.equal(h.status, 0, `hook-event exits 0: ${h.stderr}`);
    assert.match(h.stderr, /^hook-event tool: timed out after 2000ms reading hook payload from stdin$/m, "the payload read timed out");
  } finally {
    closeSync(fd);
  }
});

// ---------------------------------------------------------------------------
// W-179: the next rows live in several files; test:suite runs them all, once, side by side
// ---------------------------------------------------------------------------
test("W-179-b1 behaviour 1: test:suite runs every next row file once, side by side, in one node --test call", () => {
  const suite = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts["test:suite"]!;
  // the seven declared row files (studio/briefs/W-179.md): a next*.test.ts beside this one, or a test file importing the shared fixture, is one of them
  const declared = ["next-branch", "next-done", "next-ladder", "next-queue", "next-review", "next-spec", "next"].map((f) => `packages/cli/src/${f}.test.ts`);
  const found = readdirSync(HERE)
    .filter((f) => f.endsWith(".test.ts") && f !== "next-world.test.ts" && (f.startsWith("next") || readFileSync(join(HERE, f), "utf8").includes('from "./next-world.test.js"')))
    .sort()
    .map((f) => `packages/cli/src/${f}`);
  assert.deepEqual(found, declared, "the next rows live in exactly the seven declared files");
  for (const f of declared) assert.ok(lstatSync(join(REPO_ROOT, f)).isFile(), `${f} is a regular file, not a link`);
  const segments = suite.split("&&").map((s) => s.trim().split(/\s+/));
  const runners = segments.filter((words) => words.some((w) => w.includes("packages/cli/src/next")));
  assert.equal(runners.length, 1, `one test:suite segment names the next files: ${JSON.stringify(runners.map((w) => w.join(" ")))}`);
  assert.deepEqual(runners[0]!.slice(0, 6), ["node", "--test", `--test-concurrency=${declared.length}`, "--test-reporter=tap", "--import", "tsx"], "it is one node --test call running every file at once, with TAP");
  assert.deepEqual(runners[0]!.slice(6), declared, "it names each next row file once, in path order, and nothing else");
});
