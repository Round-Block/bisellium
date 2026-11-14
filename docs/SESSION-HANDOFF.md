---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

Current state only, after CLAUDE.md. Rules: `studio/leges/production.md`.

## Boot (every fresh session, before any dispatch)

1. Read lex `studio/leges/production.md` §1-§8 and §10-§11; SessionStart injects §9 and runbook once `bisellium` is at master.
2. Run: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium -- next --all --studio studio --repo .` (read-only); `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles. A dispatched `ladder-runner` runs every record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) verbatim; the guard (W-364) refuses main-thread ladder writes; lex §9 step 0's writes go through a ladder-runner (lex fix owed). Engineering: Sonnet builders (background), Opus 5.5 architect, Codex `gpt-5.6-sol` review (D-066 C, D-072). `kind: ui`: Codex Sol drafts and signs, Opus 5.5 reviews spec, Codex `gpt-5.6-terra` builds, and `next` names the build reviewer (D-150 C). `clerk` edits text only.
4. Known traps (each line opens `Standing:` or `Until W-<n>:`, the opus that retires it; at most 12; `check` refuses a line whose opus is done):
- Until W-631: build-review prints no model/prompt; `run --sella builder --opus` fails ci (fresh clone: no node_modules/audit network/master ref): run `run --sella producer --no-worktree … ci --opus <id>` after `npm ci --cache ~/.bisellium-evidence/npm-cache` in the clone; a branch-only opus's packet/verdict/review print main's studio (use the clone's); a runner's write passes the classifier only if its command is in the brief file (gaps.md).
- Standing: `next` holds a signature or red on a stale handover (a certify host-runner change lands first, W-323 pattern): `npm run -s bisellium -- handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` included, needs a `next` before it at the same head. Spec signatures list findings as `n. advisory — … — check: …` or `No findings`.
- Standing: a ui master `verify` runs from a writable worktree on `verify/<id>-<date>` at master, logs landed by a records PR, with the kept kit ~/.bisellium-evidence/ui-verify-1104/run.sh <opus> <base> <tag>, by a ladder-runner (in a `bisellium run` session, as W-364 requires) — main's studio would take failed records; `verify` refuses a dirty tree; 3 heavy-job slots on trial; no master move during it. A UI ruling's design_digest is the opus's current digest (`currentDesign`), never a review log's.
- Standing: records land by `npm run -s bisellium -- land <path>... --title <text> --sella producer` from main on master (W-509, docs/NEXT.md), by a ladder-runner. A code-owned path in it: `land` arms the queue and the Patron's approval sends it in (W-523); a rerun after the merge absorbs the files. A new opus record lands with its Queue line; `npm run -s check -- studio --repo .` first. Push-notify the Patron at every wait. Prompts with backticks go in a kept file.
- Standing: the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` after a merged `.claude/` change; restore what a failed pull applied. Code-owner review gates PRs on `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`, `scripts/ci-certificate.mjs`; a push dismisses approval: `gh pr edit <n> --add-reviewer edckt`.
- Standing: a build verdict's `## Earlier findings` names only the previous round's findings; a Ruling never pairs with it (the same session reissues). Spec review: ≤2 rounds. A fresh reviewer or ui-lead session needs `--session-reason`; a ui-lead verdict after a revise needs `## Earlier findings` lines (W-410-spec/ui-input-6-reissue.sh, run by a ladder-runner). A subagent refused on a kept record script stops and reports.
- Standing: `--expect pr --body-file` takes a file under the repo or `$TMPDIR`; `--expect spec` is two performs; Tracked edits in main block the spec and merge performs: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`; drop a stash only by sha, after a kept script shows its changes in the tree or on master (Patron 11-14). Land a branchless opus's handoff promptly. When `next` names `git -C <main> pull --ff-only origin master`, run it; run no spec review while a perform stashes main (it reviews the scaffold, W-499 r14 void).
- Until W-372: the orchestrator waits on isInMergeQueue (a queued PR shows no auto-merge request); a merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`; the ladder-runner enqueues with `--max-polls 2`.
- Until W-283: publish refused for a newer live version: read the live page, merge, publish; status republish reads the whole saved live page. Done reads certify's certificate from its check run (W-370, W-396); with none, falls back to the artifact host, named once if refused (no wildcard or settings edit).
- Until W-371: a Codex UI builder gets `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'`, edits only, and a ladder-runner commits, takes `next`, records each red. `worktree add -b` needs `--no-track`; a subagent stays in turn while its background run goes.
- Standing: a Codex UI builder runs `codex-passes/ui-run.sh` directly (the confined `bisellium run` host cannot see ~/.bisellium-evidence). A sandboxed `claude -p` reviewer cannot be resumed: reissue a shape refusal in a fresh session with `--session-reason`.
5. Standing until their opus lands:
- D-085 F rides the fix census and daily retro.
- Records dates are UTC; Patron reads SGT (UTC+8).
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review `studio/prompts/spec-review.md`, run by spec-review-d076/rn-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w608.py (row 236); daily retro `npm run -s bisellium -- retro --daily --studio studio`; usage usage/usage-reading.sh <label>; UI Codex codex-passes/ui-run.sh.
7. Use `npm run -s bisellium --` (`bisellium` on PATH is stale). `next` cleanup on a sandbox-held empty folder names it for the Patron and still deletes the branches (W-227); never a hand delete. After a stray `cd` into `.worktrees/`, start a new process, never `/clear`. Working notes: `~/.bisellium-evidence/current-state.md`.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

**D-181 is the plan, as D-182 changes its lanes and D-183, D-187 and D-188 its head. File through `land`: the `check` rule that a UI brief names the signed composition it follows, every difference Patron-ruled; check how a general-purpose agent's edit of this file got past W-290. Audit: ~/.bisellium-evidence/audit-1105/fable/audit.md.**

Ranked lists, lanes, halted, cut, deferred: studio/queue.yml (W-333). Order by cycle minutes saved, D-039 highs first; a new high starts after one in flight. D-194 governs opening E2/E3 (D-201, below).

Greenlit on master (until `process.handoff.queue` reads studio/queue.yml): W-074 W-157 W-169 W-183 W-185 W-242 W-245 W-254 W-261 W-280 W-281 W-283 W-289 W-290 W-301 W-304 W-308 W-331 W-332 W-349 W-363 W-372 W-374 W-375 W-380 W-383 W-393 W-394 W-395 W-399 W-400 W-401 W-414 W-429 W-431 W-432 W-434 W-439 W-440 W-453 W-455 W-458 W-460 W-464 W-467 W-469 W-470 W-471 W-476 W-478 W-480 W-616 W-617 W-618 W-619 W-620 W-621 W-622 W-520 W-521 W-522 W-623 W-624 W-625 W-626 W-627 W-628 W-629 W-630 W-631 W-632 W-633.

Greenlit on master, continued: W-286 W-291 W-324 W-356 W-378 W-391 W-437 W-481 W-482 W-488 W-500 W-503 W-504 W-506 W-507 W-510 W-511 W-513 W-514 W-516 W-518 W-519 W-529 W-531 W-532 W-533 W-534 W-535 W-536 W-537 W-538 W-539 W-540 W-544 W-545 W-546 W-548 W-549 W-550 W-551 W-553 W-554 W-555 W-556 W-557 W-559 W-560 W-561 W-564 W-565 W-566 W-567 W-569 W-570 W-574 W-575 W-576 W-577 W-578 W-579 W-580 W-581 W-582 W-583 W-584 W-585 W-586 W-587 W-588 W-590 W-591 W-592 W-593 W-594 W-595 W-596 W-597 W-598 W-599 W-600 W-601 W-602 W-603 W-605 W-606 W-607 W-609 W-610 W-611 W-612 W-613 W-614 W-615 W-644.

Greenlit on master, filed 11-14: W-645 W-646 W-647 W-648; filed 11-15: W-649 W-650 W-651.

D-193 replaces D-178: entries are product (M4 path) or process; E1 and E2 take product, E3 is the process lane (W-595 enforces). D-174's items 3-7 keep 2026-11-17. W-506 waits in the process lane.

D-201 (Patron 11-13): keep D-194's one ranked list; W-595 after W-610. D-204: E2 and UI2 open now.

Lanes now:
- E1 W-610 (light build review before the full ci): PR #1226 approved, but the merge queue removed it 3x: w610.test.ts:348 fails only in the merge group. Leads w610-mergefail-meet-1114: test-only fix e6c79cce (literal pathspec, messages print got). Its full ci failed on W-310-b1 (guard test, passed in s17; w610 rows passed): diagnose first, then rerun ci, push by the pr perform and check the remote head (gap 49), Patron re-approval, merge.
- E2 W-280 (served build drops the ?demo Inbox): spec signed r1, Codex r2 PASSED (3 advisories for the builder); next: branch perform (no overlap).
- E3 W-648 (bisellium run --cwd, the opus's own worktree, only with --opus): spec r2 failed, architect r3 signed, Codex r4 PASSED (ci/W-648-spec-4.log); branch held by overlap with W-610 until it merges, then spec perform, reds, build.
- E3 waiting: W-644 (qa-lead seat on Codex Sol) takes E3 back first when W-610 merges. W-645 (red admission refuses a wrong-tree red): signed r1; next: Codex spec review (kit W-645-specreview/, ladder-brief-114).
- UI W-503 (Home screen): unchanged; green rows wait on W-648.
- UI W-488: unchanged.
W-633 (the overlap-hold fix) merged (#1214). W-250 (merge group's duplicate hosted suite cut; lifted, retitled). Filed 11-13: W-634 (research: context budget, retrieval index), W-635 (check flags finished opera in a queue), W-636 (next reads opus state from branch records). Filed 11-14: W-639, W-640, W-641, W-642 (D-207, D-061 §4), W-643.

Off the ladder: until W-622 (local-clone checkouts): `git clone --local` plus `git -C <clone> fetch origin master:master`; a locked worktree moves aside to .worktrees/<id>; each commit: `git -C <main> fetch <clone> opus/<id>` then `update-ref`. W-507 halted (D-181, D-206), tag archive/W-507.

Lanes by file overlap (D-192); meets ~/.bisellium-evidence/*-meet-11*/; leads-settled calls skip Patron.

Session 18: Meets main-edits-meet-1114 (all five; Patron stash ruling), w610-mergefail-meet-1114. Records #1228. Gaps 49-50. Research A: W-610 actual full ci 6.99 GB peak, swap 2.65 GB, load 12.7, no OOM.
Next session first: W-310-b1 failure in W-610's ci (diagnose), then W-610 ci, push, merge; W-645 spec review; W-280 branch; file the branchless-handoff opus and W-645's two follow-ups; the stash-check script.

Unruled notes: top NOW of current-state.md; talk-a2a-1106/combined.md.

Open gaps, W-508 lessons: ~/.bisellium-evidence/current-state-until-1106.md; read before any done step.
W-510, after W-522 (detail: queue.yml): ~/.bisellium-evidence/pr-debate-1106/brief-r1.md.

Research is its own lane, never alongside D-182's lane unasked.

Off-ladder work to the Patron gets a lead's read first; ladder builds keep Codex as the one gate (D-066 C).
W-467 follows W-503, takes W-451's Home palette. W-434 links prototype hash, design digest, source tree, captures, reviews.
