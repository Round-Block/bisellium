---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

Current state only, after CLAUDE.md. Rules: lex `production.md`.

## Boot (every fresh session, before any dispatch)

1. Read lex `studio/leges/production.md` §1-§8 and §10-§11; SessionStart injects §9 and runbook once `bisellium` is at master.
2. Run: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium -- next --all --studio studio --repo .` (read-only); `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles. A dispatched `ladder-runner` runs every record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) verbatim; the guard (W-364) refuses main-thread ladder writes; lex §9 step 0's writes use one too (lex fix owed). Engineering: Sonnet builders (background), Opus 5.5 architect, Codex `gpt-5.6-sol` review (D-066 C, D-072). `kind: ui`: Codex Sol drafts and signs, Opus 5.5 reviews spec, Codex `gpt-5.6-terra` builds, and `next` names the build reviewer (D-150 C). `clerk` edits text only.
4. Known traps (each line opens `Standing:` or `Until W-<n>:`, the opus that retires it; at most 12; `check` refuses a line whose opus is done):
- Until W-631: build-review prints no model/prompt; `run --sella builder --opus` fails ci (fresh clone: no node_modules/audit network/master ref): run `run --sella producer --no-worktree … ci --opus <id>` after `npm ci --cache ~/.bisellium-evidence/npm-cache` in the clone; a branch-only opus's packet/verdict/review print main's studio (use the clone's); a runner's write passes the classifier only if its command is in the brief.
- Standing: `next` holds a signature or red on a stale handover (a certify host-runner change lands first, W-323): `npm run -s bisellium -- handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` included, needs a `next` before it at the same head. Spec signatures list findings as `n. advisory — … — check: …` or `No findings`.
- Standing: a ui master `verify` runs from a writable worktree on `verify/<id>-<date>` at master, logs landed by a records PR, with the kept kit ~/.bisellium-evidence/ui-verify-1104/run.sh <opus> <base> <tag>, by a ladder-runner (in a `bisellium run` session, per W-364); main's studio would take failed records; `verify` refuses a dirty tree; 3 heavy-job slots on trial; no master move during it. A UI ruling's design_digest is the opus's current digest (`currentDesign`), never a review log's.
- Standing: records land by `npm run -s bisellium -- land <path>... --title <text> --sella producer` from main on master (W-509, docs/NEXT.md), by a ladder-runner. A code-owned path in it: `land` arms the queue and the Patron's approval sends it in (W-523); a rerun after the merge absorbs the files. A new opus record lands with its Queue line; `npm run -s check -- studio --repo .` first. Push-notify the Patron at every wait. Prompts with backticks go in a kept file.
- Standing: the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` after a merged `.claude/` change; restore what a failed pull applied. Code-owner review gates `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`, `scripts/ci-certificate.mjs`; a push dismisses approval: `gh pr edit <n> --add-reviewer edckt`.
- Standing: a build verdict's `## Earlier findings` names only the previous round's findings; a Ruling never pairs with it (the same session reissues). Spec review: ≤2 rounds. A fresh reviewer or ui-lead session needs `--session-reason`; a ui-lead verdict after a revise needs `## Earlier findings` lines (W-410-spec/ui-input-6-reissue.sh, by a ladder-runner). A subagent refused on a kept record script stops, reports.
- Standing: `--expect pr --body-file` takes a file under the repo or `$TMPDIR`; `--expect spec` is two performs; Tracked edits in main block the spec and merge performs: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`; drop a stash only by sha, after a kept script shows its changes in tree/master (Patron 11-14). No tracked record edit left in main: the guard's master sync refuses over it (gap 103); land it now. When `next` names `git -C <main> pull --ff-only origin master`, run it; no spec review while a perform stashes main (it reviews the scaffold, W-499 r14 void).
- Until W-372: the orchestrator waits on isInMergeQueue (a queued PR shows no auto-merge request); a merge perform printing `QUEUE_TIMEOUT` on a still-queued PR reruns with `--poll-ms 20000 --max-polls 150`; the ladder-runner enqueues with `--max-polls 2`.
- Until W-283: publish refused for a newer live version: read the live page, merge, publish; status republish reads the whole saved live page. Done reads certify's certificate from its check run (W-370, W-396); with none, uses the artifact host, named once if refused (no wildcard or settings edit).
- Until W-371: a Codex UI builder gets `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'`, edits only, and a ladder-runner commits, takes `next`, records each red. `worktree add -b` needs `--no-track`; a subagent stays in turn while its background run goes.
- Standing: a Codex UI builder runs `codex-passes/ui-run.sh` directly; a sandboxed `claude -p` reviewer cannot be resumed: reissue a shape refusal in a fresh session with `--session-reason`. A brief spells every record write `npm run -s bisellium -- …`, never the bare `bisellium` (soft_deny, gap 71); run ~/.bisellium-evidence/declared-reds-check.mts <brief> <id> before any sign (gap 70). A Codex workspace-write run from the Claude sandbox needs `-c sandbox_workspace_write.exclude_slash_tmp=true` (gap 104: /tmp read-only, bwrap fails "Can't mkdir /tmp/.git"); read-only runs need nothing.
- Standing: refresh runs all day (D-211, timer every 30 min, cap 4 per 6 h); a timer-started session never waits on the Patron: write the ask in current-state.md, push once per wait, go on with independent lanes; never decide a Patron-only call.
5. Standing until their opus lands:
- D-085 F rides the fix census and daily retro.
- Records dates are UTC; Patron reads SGT (UTC+8).
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review `studio/prompts/spec-review.md`, run by spec-review-d076/rn-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w608.py (row 236); daily retro `npm run -s bisellium -- retro --daily --studio studio`; usage usage/usage-reading.sh <label>; UI Codex codex-passes/ui-run.sh.
7. Use `npm run -s bisellium --` (`bisellium` on PATH is stale). `next` cleanup on a sandbox-held empty folder names it for the Patron, still deletes the branches (W-227); never hand delete. After a stray `cd` into `.worktrees/`, start a new process, not `/clear`. Notes: `~/.bisellium-evidence/current-state.md`.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

**D-234 (End state v1) is the plan: 19 kept opera ranked by v1 walk step; everything else deferred (studio/queue.yml).**

Ranked lists, lanes, halted, cut, deferred: studio/queue.yml. Tracked number (D-234): v1 walk 1/9 steps green on master (S1, Home opens in the served e2e; a hand count until W-576's skeleton lands).

Filing rule from now on (D-234): a lesson by default; fold a point into a kept opus's brief if it touches that opus's files; file its own opus only if it blocks a kept opus, its lesson class recurs 3+ times, or the Patron asks.

Process slot order (D-234, D-245, one at a time): W-699 (path check at sign, brief delta rule, verdict --check) -> W-697 (a passed-review opus goes to PR on light gates) -> W-372 (an agent waits for its own background run) -> W-557 (merge, cleanup and done run as one chain).

D-233: the interim rule stands (its rank part is superseded for W-183/W-529/W-250, which the keep list defers) — full-suite runs (ci --opus, verify, the host mint) wait on one host lock at a time; UI lanes never pause.

Lanes now:
- Open for a leads' meet (ops-lead): handoff goes stale when a running task ends after it's written (Patron, 11-19); see current-state.md s61.
- E1 W-531: spec r9 passed, No findings, recorded 56d176fe; next: `next W-531 --perform --expect build` (.worktrees/W-531), full ci --opus (producer --no-worktree), Codex build review r1.
- E2 W-699 (path check, delta rule, verdict --check, stale-gate, D-246): r2 signed, not recorded; design-lead BLOCKED b5 (w699-b5-check-1119/design-lead.md); next: Opus architect r3 (b5 fixes, delta-rule off switch: bisellium.yml key `next` reads +check row), design-lead re-checks; record kit (dry), branch; D-245-247 ride it; code-owned (Patron merges); W-697 rebases after.
- UI1 W-503: build review r1 passed (3 advisories), recorded f07cc2e3; PR awaits Patron's ruling (11-19); on word, clerk writes ruling, .worktrees/W-503/studio, amend --ui-ruling, commit, next.
- UI2 W-504: pre-sign gate r2 passed; Codex Sol ui-architect signed (W-504-spec/sign-r1/signature-r1.md, brief-r1.md diff: Status line only); next: record kit (dry) copies brief-r1.md to studio/briefs/W-504.md, records spec r1, branch.
- DR runs from its own clone (session cron 09:04 SGT).

Also, 11-17 (greenlit by the Patron, session 46, D-234): W-284 (init yields a studio that can run an opus). W-051 (branch/merge use the repo's default branch, not hardcoded master) lifted from halted.
Greenlit (until `process.handoff.queue` reads queue.yml): W-074 W-157 W-169 W-183 W-185 W-242 W-245 W-254 W-261 W-280 W-281 W-283 W-289 W-290 W-301 W-304 W-308 W-331 W-332 W-349 W-363 W-372 W-374 W-375 W-380 W-383 W-393 W-394 W-395 W-399 W-400 W-401 W-414 W-429 W-431 W-432 W-434 W-439 W-440 W-453 W-455 W-458 W-460 W-464 W-467 W-469 W-470 W-471 W-476 W-478 W-480 W-616 W-617 W-618 W-619 W-620 W-621 W-622 W-520 W-521 W-522 W-623 W-624 W-625 W-626 W-627 W-628 W-629 W-630 W-631 W-632 W-633.
Also: W-286 W-291 W-324 W-356 W-378 W-391 W-437 W-481 W-482 W-488 W-500 W-503 W-504 W-506 W-507 W-510 W-511 W-513 W-514 W-516 W-518 W-519 W-529 W-531 W-532 W-533 W-534 W-535 W-536 W-537 W-538 W-539 W-540 W-544 W-545 W-546 W-548 W-549 W-550 W-551 W-553 W-554 W-555 W-556 W-557 W-559 W-560 W-561 W-564 W-565 W-566 W-567 W-569 W-570 W-574 W-575 W-576 W-577 W-578 W-579 W-580 W-581 W-582 W-583 W-584 W-585 W-586 W-587 W-588 W-590 W-591 W-592 W-593 W-594 W-595 W-596 W-597 W-598 W-599 W-600 W-601 W-602 W-603 W-605 W-606 W-607 W-609 W-610 W-611 W-612 W-613 W-614 W-615 W-644.
Also: W-636 (next reads branch records), W-662 (ui, held after W-503), W-665 (ui build review screenshots), W-681 and W-682 (both the DR lane's opera).
Also, filed 11-14..11-16 (studio/queue.yml): W-646 W-649 W-650 W-651 W-652 W-653 W-654 W-656 W-657 W-658 W-659 W-663 W-667 W-668 W-670 W-671 W-672 W-673 W-675 W-676 W-677 W-678 W-679 W-680.
Also, 11-17 (greenlit by the Patron, session 39): W-683 W-684 W-685 W-686. W-687 (DR independence) filed session 40; D-226, D-227 (DR lane, workflow) land with it.
Also, 11-17 (greenlit by the Patron, session 42): W-687 W-688 W-689 W-690 W-691 W-692 W-693 W-694 W-695.
Also, 11-17 (greenlit by the Patron, sessions 43-44): W-696 W-697. W-698 is filed, held.

Research is its own lane. Codex stays the one gate (D-066 C). Unruled notes: top NOW of ~/.bisellium-evidence/current-state.md; older gaps: current-state-until-1106.md there.
