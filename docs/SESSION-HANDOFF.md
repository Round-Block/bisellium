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
- Standing: split a certify host-runner change out and land it first (W-323 pattern); the mint runs from the opus worktree with `--studio studio --repo .`.
- Standing: `next` holds a signature or red on a stale handover: `npm run -s bisellium -- handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` included, needs a `next` before it at the same head. Spec signatures list findings as `n. advisory — … — check: …` or `No findings`.
- Standing: a ui master `verify` runs from a writable worktree on `verify/<id>-<date>` at master, logs landed by a records PR, with the kept kit ~/.bisellium-evidence/ui-verify-1104/run.sh <opus> <base> <tag>, by a ladder-runner (in a `bisellium run` session, as W-364 requires) — pointing it at main's studio writes failed records into main; `verify` refuses a dirty tree; 3 heavy-job slots on trial; no master move during it. A UI ruling's design_digest is the opus's current digest (`currentDesign`), never a review log's.
- Standing: records land by `npm run -s bisellium -- land <path>... --title <text> --sella producer` from main on master (W-509, docs/NEXT.md), by a ladder-runner. A code-owned path in it: `land` arms the queue and the Patron's approval sends it in (W-523); a rerun after the merge absorbs the files. A new opus record lands with its Queue line; `npm run -s check -- studio --repo .` first. Push-notify the Patron at every wait. Prompts with backticks go in a kept file, never an unquoted heredoc.
- Standing: the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` after a merged `.claude/` change; restore what a failed pull applied.
- Standing: code-owner review gates PRs on `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`, `scripts/ci-certificate.mjs`; a push dismisses approval: `gh pr edit <n> --add-reviewer edckt`.
- Standing: a build verdict's `## Earlier findings` names only the previous round's findings; a Ruling never pairs with it (the same session reissues). Spec review: ≤2 rounds. A fresh reviewer or ui-lead session needs `--session-reason`; a ui-lead verdict after a revise needs `## Earlier findings` lines (W-410-spec/ui-input-6-reissue.sh, run by a ladder-runner). A subagent refused on a kept record script stops and reports.
- Standing: `--expect pr --body-file` takes a file under the repo or `$TMPDIR`; `--expect spec` is two performs; evidence script copies carry the `next` calls. Tracked edits in main block the spec and merge performs: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`, drop by tag. When `next` names `git -C <main> pull --ff-only origin master` (a clean main), run it; otherwise performs' guard sync moves master; a spec review while a perform stashes main reviews the scaffold (W-499 r14 void); run spec reviews only when none does.
- Until W-372: the orchestrator waits on isInMergeQueue (a queued PR shows no auto-merge request); a merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`; the ladder-runner enqueues with `--max-polls 2`.
- Until W-283: publish refused for a newer live version: read the live page, merge, publish; status republish reads the whole saved live page. Done reads certify's certificate from its check run (W-370, W-396); with none, falls back to the artifact host, named once if refused (no wildcard or settings edit).
- Until W-371: a Codex UI builder gets `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'`, edits only, and a ladder-runner commits, takes `next`, records each red. `worktree add -b` needs `--no-track`; a subagent stays in turn while its background run goes.
- Standing: a Codex UI builder runs `codex-passes/ui-run.sh` directly: the confined `bisellium run` host cannot see ~/.bisellium-evidence. A `claude -p` reviewer in the sandbox cannot be resumed: reissue a shape refusal in a fresh session with `--session-reason`.
5. Standing until their opus lands:
- D-085 F rides the fix census and daily retro.
- Records dates are UTC; Patron reads SGT (UTC+8).
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review `studio/prompts/spec-review.md`, run by spec-review-d076/rn-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w608.py (row 236; one script per row); daily retro `npm run -s bisellium -- retro --daily --studio studio`; usage usage/usage-reading.sh <label>, when wanted; UI Codex via codex-passes/ui-run.sh.
7. Use `npm run -s bisellium --` (`bisellium` on PATH is stale). `next` cleanup on a sandbox-held empty folder names it for the Patron and still deletes the branches (W-227); never a hand delete. After a stray `cd` into `.worktrees/`, start a new process, never `/clear`. Working notes: `~/.bisellium-evidence/current-state.md`, overwritten each refresh (D-109 ended with W-333).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

**D-181 is the plan, as D-182 changes its lanes and D-183, D-187 and D-188 its head. Read them first. File through `land`: the `check` rule that a UI brief names the signed composition it follows, every difference ruled by the Patron; and check how a general-purpose agent's edit of this file got past W-290. Audit: ~/.bisellium-evidence/audit-1105/fable/audit.md.**

Ranked lists, lanes, halted, cut, deferred: studio/queue.yml (W-333). Order by cycle minutes saved, D-039 highs first; a new high starts after one in flight. W-512 has landed; D-194 (one ranked list; no new lane before the qa-lead's reading) governs opening E2/E3: the Patron's call on lanes-meet-1113 is open.

Greenlit on master, named here until `process.handoff.queue` reads studio/queue.yml: W-074 W-157 W-169 W-183 W-185 W-242 W-245 W-254 W-261 W-280 W-281 W-283 W-289 W-290 W-301 W-304 W-308 W-331 W-332 W-349 W-363 W-372 W-374 W-375 W-380 W-383 W-393 W-394 W-395 W-399 W-400 W-401 W-414 W-429 W-431 W-432 W-434 W-439 W-440 W-453 W-455 W-458 W-460 W-464 W-467 W-469 W-470 W-471 W-476 W-478 W-480 W-616 W-617 W-618 W-619 W-620 W-621 W-622 W-520 W-521 W-522.

Greenlit on master, continued: W-286 W-291 W-324 W-356 W-378 W-391 W-437 W-481 W-482 W-488 W-500 W-503 W-504 W-506 W-507 W-510 W-511 W-513 W-514 W-516 W-518 W-519 W-529 W-531 W-532 W-533 W-534 W-535 W-536 W-537 W-538 W-539 W-540 W-544 W-545 W-546 W-548 W-549 W-550 W-551 W-553 W-554 W-555 W-556 W-557 W-559 W-560 W-561 W-564 W-565 W-566 W-567 W-569 W-570 W-574 W-575 W-576 W-577 W-578 W-579 W-580 W-581 W-582 W-583 W-584 W-585 W-586 W-587 W-588 W-590 W-591 W-592 W-593 W-594 W-595 W-596 W-597 W-598 W-599 W-600 W-601 W-602 W-603 W-605 W-606 W-607 W-609 W-610 W-611 W-612 W-613 W-614 W-615.

D-193 replaces D-178: no per-opus exemptions; entries are product (M4 path) or process; after W-512, E1 and E2 take product, E3 is the one process lane (W-595 enforces). D-174's items 3 to 7 keep 2026-11-17. W-506 waits in the process lane.

In flight: W-610 (build review before the full ci) at the spec step: r4 on opus/W-610 80ee3c40, signed round 7; Codex spec review r8 failed two S1 (multiline command status; valid gate ids). The architect's r5 was cut off by crashes: fix 2 at spec-scratch/W-610-r4 32ef3913; fix 1 and the round-9 signature owed, resume in a new scratch worktree (W-610-r4-1113/architect-r5-brief.md). W-451 (Home groundwork) at next's done step, record still verifying: master verify passed; PR #1190 (its records and D-200) waits on the Patron.

Off the ladder: W-622 (opus checkouts as local clones) is filed right after W-610: a worktree that exists at a session's start cannot be committed in or removed from it (its .git/worktrees admin directory is read-only; its files stay writable) (~/.bisellium-evidence/worktree-block-meet-1113/producer-probe.md). W-507 stays greenlit on master, parked by D-181.

Greenlit ahead of build: W-503 Home: the Patron's four calls are D-200 (bars, signed colours, Needs you as round 6, blank card fine); the design lead's revision 8 is done (~/.bisellium-evidence/W-503-spec/r8-out.md, signature-r8.md), waiting on the Patron's look at the captures, then onto the branch, sign, and the UI spec review. .worktrees/W-503 was re-created (the old one is .worktrees/W-503-1105).

Filed 11-08/12: W-533 to W-619. Lanes by file overlap (D-192). Meets: ~/.bisellium-evidence/*-meet-11*/; leads-settled calls need no Patron (D-189).

Next session: first move this session's worktrees from the Patron's shell (W-610, verify-W-451-1113), re-add them and copy their uncommitted files; then W-610: the architect's revision 5 (fix 1, sign round 9), the last spec review, build, review, ci, PR, merge; then the 11-12 daily retro (briefs in ~/.bisellium-evidence/retro-1113/), then the queue in studio/queue.yml order. State: ~/.bisellium-evidence/current-state.md.

Unruled notes: top NOW of current-state.md; talk-a2a-1106/combined.md beside it. D-189 (W-525, lex §7): a Patron-waiting call goes to the leads' meet first.

D-186: greenlighting goes. W-524 waits for M4. Daily retro: lex §9 step 7 (D-188).

Open gaps and W-508's done-step lessons: ~/.bisellium-evidence/current-state-until-1106.md ("Added 11-06"); read before any done step.

W-510, after W-522, repairs talk, then the leads' debate on which changes need a human-approved PR (brief ~/.bisellium-evidence/pr-debate-1106/brief-r1.md).

D-184: W-520, after W-531, in the process lane, takes over W-380. Do not use `prune-scratch.sh`. D-185: then W-521 and W-522; a diagnosed flake in a file an opus does not touch gets its own opus.

Research is its own lane; none runs alongside D-182's one lane without the Patron's word. W-500 Runs screen waits for MVP (Patron 2026-11-05).

Off-ladder work reaching the Patron ungated gets the relevant lead's read first; ladder builds keep Codex as their one gate (D-066 C).
W-073, W-438 and W-136 stay halted until M4's exit passes (D-193).

W-467 has not started: it follows W-503 and takes W-451's Home palette. W-434 also links prototype hash, design digest, source tree, captures and reviews.
