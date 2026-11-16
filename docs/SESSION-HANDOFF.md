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

**D-181 is the plan, as D-182 changes its lanes and D-183, D-187, D-188 its head.**

Ranked lists, lanes, halted, cut, deferred: studio/queue.yml (W-333). Order by cycle minutes saved, D-039 highs first. D-223: two engineering lanes (E1, E2) and two ui lanes (UI1, UI2).

Greenlit (until `process.handoff.queue` reads queue.yml): W-074 W-157 W-169 W-183 W-185 W-242 W-245 W-254 W-261 W-280 W-281 W-283 W-289 W-290 W-301 W-304 W-308 W-331 W-332 W-349 W-363 W-372 W-374 W-375 W-380 W-383 W-393 W-394 W-395 W-399 W-400 W-401 W-414 W-429 W-431 W-432 W-434 W-439 W-440 W-453 W-455 W-458 W-460 W-464 W-467 W-469 W-470 W-471 W-476 W-478 W-480 W-616 W-617 W-618 W-619 W-620 W-621 W-622 W-520 W-521 W-522 W-623 W-624 W-625 W-626 W-627 W-628 W-629 W-630 W-631 W-632 W-633.

Also: W-286 W-291 W-324 W-356 W-378 W-391 W-437 W-481 W-482 W-488 W-500 W-503 W-504 W-506 W-507 W-510 W-511 W-513 W-514 W-516 W-518 W-519 W-529 W-531 W-532 W-533 W-534 W-535 W-536 W-537 W-538 W-539 W-540 W-544 W-545 W-546 W-548 W-549 W-550 W-551 W-553 W-554 W-555 W-556 W-557 W-559 W-560 W-561 W-564 W-565 W-566 W-567 W-569 W-570 W-574 W-575 W-576 W-577 W-578 W-579 W-580 W-581 W-582 W-583 W-584 W-585 W-586 W-587 W-588 W-590 W-591 W-592 W-593 W-594 W-595 W-596 W-597 W-598 W-599 W-600 W-601 W-602 W-603 W-605 W-606 W-607 W-609 W-610 W-611 W-612 W-613 W-614 W-615 W-644.

Also, filed 11-14..11-16 (studio/queue.yml): W-646 W-649 W-650 W-651 W-652 W-653 W-654 W-656 W-657 W-658 W-659 W-663 W-667 W-668 W-670 W-671 W-672 W-673 W-675 W-676 W-677 W-678 W-679 W-680.

Also, 11-16: D-212, D-213, D-215 (W-467 re-specced while W-503 parks) landed; D-216 (auto-greenlight widens to small non-ui engineering/ops/process opera), D-217 (console adopts whole themes) and D-218 (W-488 re-approved at tree 51f8690d) landed #1268; W-674 (Dracula spec audit and console-wide steps) filed #1266.

D-193 replaces D-178: D-223 closes E3; process opera take E1/E2 by rank. D-174's items 3-7 keep 2026-11-17. W-506 waits in the process lane. D-201: W-595 after W-610. D-204: E2 and UI2 open.

Lanes now:
- E1 W-666 (signed Patron receipt) branched (opus/W-666); then W-668 pt C, W-673.
- E2 W-645 done (#1281, #1282); E2 takes the next non-overlapping opus by rank.
- E3 closed (D-223, Patron 11-16); W-665 (ui build review screenshots) waits for E1/E2 by rank.
- UI1 W-503 halted by D-222 (W-675 first), W-467 re-signs after W-675, W-662 held.
- UI2 W-675 (Dracula theme layer): spec round 2 signed (brief 41351a90, untracked in main); next Opus UI spec review round 3, then ui-lead (Astra) input.
- Retro lane RT1, owner qa-lead (Patron 11-16): until W-682's host cron lands, every boot re-arms the session cron (CronCreate "4 9 * * *", prompt in daily-retro-lane-meet-1116/collated.md Q3); W-681, W-682 filed and greenlit (the Patron 11-16).
- W-673 (cert tree excludes the handoff): meet w673-meet-1116 ruled 3/3; Codex spec review with 5 named items next; lands after W-645.
- W-555 not signed (no lane); W-646 carries D-213 cap wording.
W-250 (duplicate hosted suite cut), W-636 (next reads branch records); older filings: studio/queue.yml.

Off the ladder: until W-622: `git clone --local` plus `git -C <clone> fetch origin master:master`. W-507 halted (D-181, D-206), tag archive/W-507.

Lanes by file overlap (D-192); meets ~/.bisellium-evidence/*-meet-11*/. Sessions 21-30 meets and gaps 56-98: ~/.bisellium-evidence/current-state.md.
Session 35: W-669 merged #1275; W-645 fix r3 check 3 open; W-675 r2 signed; W-673 meet; signer meet + Patron rulings.
Session 36: W-669 done (checkpoint row 246); rules audit (rules-audit-1116/: census s1-s3; eng + design meets); decisions owed: W-673 D-129 B departure, signer rulings.
Next: rules audit collate -> W-645 r4 per ruling -> W-675 UI spec review r3 -> W-673 Codex spec review -> decisions records PR (code-owner) -> file opera per audit rulings.

Unruled notes: top NOW of ~/.bisellium-evidence/current-state.md; older gaps: current-state-until-1106.md there. Research is its own lane. Codex stays the one gate (D-066 C).