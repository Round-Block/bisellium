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
- Records dates are UTC; Patron reads times in SGT (UTC+8). The trial (lex §7) counts from the opus after W-292.
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review `studio/prompts/spec-review.md`, run by spec-review-d076/rn-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w433.py (row 168; one script per row); daily retro `npm run -s bisellium -- retro --daily --studio studio`; usage usage/usage-reading.sh <label>, when wanted; UI Codex via codex-passes/ui-run.sh.
7. Use `npm run -s bisellium --` (`bisellium` on PATH is stale). `next` cleanup on a sandbox-held empty folder names it for the Patron and still deletes the branches (W-227); never a hand delete. After a stray `cd` into `.worktrees/`, start a new process, never `/clear`. The producer's working notes are in `~/.bisellium-evidence/current-state.md`, overwritten each refresh (notes, not a record; D-109 ended with W-333).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

**D-181 is the plan, as D-182 changes its lanes and D-183, D-187 and D-188 its head (Patron 2026-11-05, 11-06, 11-07). Read them first. File through `land`: the `check` rule that a UI brief names the signed composition it follows, with every difference ruled by the Patron, and check how a general-purpose agent's edit of this file got past W-290. Audit: ~/.bisellium-evidence/audit-1105/fable/audit.md.**

Ranked lists, lanes, halted, cut, deferred: studio/queue.yml (W-333). Order by cycle minutes saved, D-039 highs first; a new high starts after one in flight. Lanes: one until W-512 lands (D-182).

Greenlit on master, named here until `process.handoff.queue` reads studio/queue.yml: W-074 W-157 W-169 W-183 W-185 W-242 W-245 W-254 W-261 W-280 W-281 W-283 W-289 W-290 W-301 W-304 W-308 W-331 W-332 W-349 W-363 W-372 W-374 W-375 W-380 W-383 W-393 W-394 W-395 W-399 W-400 W-401 W-414 W-429 W-431 W-432 W-434 W-439 W-440 W-453 W-455 W-458 W-460 W-464 W-467 W-469 W-470 W-471 W-476 W-478 W-480 W-616 W-617 W-618 W-619.

Greenlit on master, continued: W-286 W-291 W-324 W-356 W-378 W-391 W-437 W-481 W-482 W-488 W-500 W-503 W-504 W-506 W-507 W-510 W-511 W-512 W-513 W-514 W-516 W-518 W-519 W-529 W-531 W-532 W-533 W-534 W-535 W-536 W-537 W-538 W-539 W-540 W-544 W-545 W-546 W-548 W-549 W-550 W-551 W-553 W-554 W-555 W-556 W-557 W-559 W-560 W-561 W-564 W-565 W-566 W-567 W-569 W-570 W-574 W-575 W-576 W-577 W-578 W-579 W-580 W-581 W-582 W-583 W-584 W-585 W-586 W-587 W-588 W-590 W-591 W-592 W-593 W-594 W-595 W-596 W-597 W-598 W-599 W-600 W-601 W-602 W-603 W-605 W-606 W-607 W-609 W-610 W-611 W-612 W-613 W-614 W-615.

D-193 replaces D-178: no per-opus exemptions; queue entries are product (M4 path) or process; after W-512, E1 and E2 take product, E3 is the one process lane (W-595 enforces). D-174's items 3 to 7 keep their 2026-11-17 date. W-506 (W-502's cause fix) waits in the process lane.

In flight: W-451 merged (#1045), done once its master verify runs. W-608 done (#1169). W-610: spec r2 failed 2 S1; architect revising (W-610-spec/architect-rev2-brief.md), re-sign, Codex r3, branch; PR waits on the Patron (bisellium.yml, build-review.md, lex).

Greenlit ahead of build: W-503 Home is HELD for the Patron's four calls in ~/.bisellium-evidence/W-503-spec/compare-1105.md, section 4: the spec drifted from the signed round-6 Home D-175 keeps. Branched (opus/W-503); one required build fix stands (ci/W-503-spec-8.log #1, uncommitted in .worktrees/W-503 only: keep it). No W-503 step before they answer; D-181 restores the signed screens and puts Home after W-301.

Filed 11-08/12: W-533 to W-615. Next: studio/queue.yml order (D-192: lanes by file overlap, `next_ts: true` is E1; retags wait for W-593). The next spec may be drafted during a build (spec-ahead-meet-1109/). Meets: ~/.bisellium-evidence/*-meet-11*/. Leads-settled calls need no Patron (D-189).

Design-collegium questions go to design-lead (design.md:3; CLAUDE.md's Roles line names it as spec signer since W-589).

Next session, in order (D-194): W-610, W-615 (its cause fix), W-551 (drafted; D-195 line, sign in main), W-613, W-512, W-531, then studio/queue.yml. One draft ahead per lane (1109 d). State: ~/.bisellium-evidence/current-state.md.

Unruled notes, read first: top NOW of ~/.bisellium-evidence/current-state.md; talk-a2a-1106/combined.md beside it. Meets filed: W-562, W-563, W-564.

D-189: a Patron-waiting call goes to the relevant leads' meet; their recommendation is the default, vetoable at the next summary, never the producer's alone. Lex: W-525 (#1079, production.md §7).

D-186: greenlighting goes. W-524 waits for M4. Daily retro (D-188, lex 9 step 7): after 00:00Z, ladder-runner runs, fresh QA lead proposes, ladder-runner lands.

Open gaps and W-508's done-step lessons: "Added 11-06" lines of ~/.bisellium-evidence/current-state-until-1106.md; read before any done step.

W-510, after W-522, repairs talk, then the five leads' debate on which changes need a human-approved PR (brief ~/.bisellium-evidence/pr-debate-1106/brief-r1.md, two rounds, through talk).

D-184: W-520, after W-531 (studio/queue.yml order), in the process lane, taking over W-380 (folded in its Queue line). Do not use `prune-scratch.sh`. D-185: after it, W-521 and W-522; a diagnosed flake in a file an opus does not touch gets its own opus.

W-507 W-298's remainder: built, gated, on opus/W-507, parked until after M4 (D-181).

Claude usage hold: ~98% (Patron 2026-11-05).

Research is its own lane (Patron 2026-11-05); none runs alongside work under D-182's one lane without their word. W-500 Runs screen waits for MVP (Patron 2026-11-05).

Off-ladder work and recommendations reaching the Patron ungated get the relevant lead's read first; ladder builds keep Codex as their one gate (D-066 C).
W-073, W-438 and W-136 stay halted until M4's exit passes (D-193).

W-467 has not started: it follows W-503 in the Queue and takes W-451's Home palette. W-434 also links prototype hash, design digest, source tree, captures and reviews (design lead 11-01).
