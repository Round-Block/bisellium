---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

Current state only, after CLAUDE.md. Rules: `studio/leges/production.md`, read whole (the SessionStart hook injects it; a preview is not a read).

## Boot (every fresh session, before any dispatch)

1. Read all of `studio/leges/production.md` (§7-§11; §9 step 0 says who runs each step). The step-by-step runbook (the exact command per step and what `next` prints before it) is served by `npm run -s bisellium -- context --sella producer studio` (W-267 part 1, the ladder-runner agent and runbook, merged #488); `~/.bisellium-evidence/orchestrator-onboarding/ladder.md` stays as background only. The Patron's installed `bisellium` (`~/projects/bisellium-guard`) must be updated to master for the session hooks to show the runbook.
2. Run, read-only: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium` (flag shapes); `npm run -s bisellium -- next <id> --budget 400000 --studio studio --repo .` for each opus in flight; `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles (D-066 A). The orchestrator runs every ladder record write itself through the allowlisted `npm run -s bisellium --` verbs and `scripts/*.sh`; it dispatches builders (Sonnet, background), the architect (Opus 5.5) and Codex reviewers (`gpt-5.6-sol`, the single review gate, D-066 C); `clerk` (no Bash) edits text only. A `ladder-runner` agent exists (`.claude/agents/ladder-runner.md`) and the Claude `censor` agent is gone; the live trial passed 2026-10-16 (a dispatched ladder-runner ran `next` and the W-206 branch perform with no refusal), so W-267 part 2 is filed greenlit as W-292 (the dispatch hook: only a dispatched ladder-runner runs record writes; a runner-recorded verdict and the auto-mode allow test come before its branch); until it lands the orchestrator still runs record writes itself (D-066 A).
4. Known traps until their filings land: long runs (npm test, mints, verify) go in their own Bash call with `run_in_background: true`; `&`, nohup and setsid die when the call returns and a PreToolUse hook refuses them (#497; `.claude/agents/builder.md`, #498). A merged `.claude/` change cannot be pulled by an agent session (the sandbox mounts `.claude/` read-only; a failed pull leaves the commit's other files applied: restore them): the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` (W-239). A build verdict's `## Earlier findings` may name only the previous round's own findings; spec review is capped at two rounds (D-061 §4; the lex text is stale until W-278). a subagent running a kept record script is refused by the auto-mode classifier; stop and report, never ask for an allow rule or retry with another agent. Every record write needs a `next` run just before it at the same head (step tickets), including the builder's `red` (tell the builder; the kept builder brief still forbids `next`). `next --perform --expect pr --body-file` takes a file under the repo or `$TMPDIR` only: copy the kept body there first. `next --perform --expect spec` and `--expect done` are each two performs (commit, then land); the spec landing leaves earlier round logs untracked, add them to the next records commit. `--expect done` refuses without a tracked handoff edit. The evidence copies of the kept scripts carry the `next` calls (`record-review.sh` passes `--budget`); the `scripts/` copies lack them until W-274. A spec's "stale handover" hold can mask an invalid architect signature (W-275): sign with findings lines `n. advisory — … — check: …` or `No findings`, since `verdict` accepts prose findings on a passed spec but `next` refuses them. Uncommitted tracked edits in the main checkout stop the spec and merge performs from fast-forwarding master: set them aside with a tagged `git stash push -m <tag> -- <paths>`, rerun the perform, `git stash apply <sha>`, drop by tag. A merge perform that prints `QUEUE_TIMEOUT` while the PR is still queued is rerun with `--poll-ms 20000 --max-polls 150`. Code-owner review gates only PRs touching `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs` (auto-merge is always safe; pushing dismisses an approval). An Artifact publish refused for a newer live version is a version conflict, not a permission refusal: read the live page, merge, publish (the dossier republished this way on 2026-10-15). The Status page's live version carries edits the build lacks, so its republish needs the Patron until W-283 serves the page. A red's selector must hold no whitespace (`red` refuses it; use `'^W-<id>-b<n>\s'`). A red must fail by assertion, never ENOENT or module-not-found (the host replay refuses it). The mint runs from the opus worktree with `--studio studio --repo .`. After pushing to a code-owner PR, re-request the Patron's review (`gh pr edit <n> --add-reviewer edckt`). Never merge master into an opus branch: certify replays the branch onto master and a merge commit re-conflicts; rebase instead (W-243 refuses it). A queued PR shows no auto-merge request: check `isInMergeQueue` (gh api graphql) before touching it. If an approved PR sits CLEAN and `isInMergeQueue` is false, toggle `gh pr merge <n> --disable-auto` then `--auto`; records PRs use `gh pr merge --auto` without `--squash`. A brief cannot be amended mid-build (`next` judges the spec on master, and D-021 blocks master writes while `opus/<id>` exists): the Patron renames the branch and the opus is rebuilt (W-206 fixes it).

## Resume point (2026-10-16)

0. **Rulings applied:** D-064 (PR #471; step tickets required: every record write follows a `next` call for that step; the retro rides the done PR). **D-066** (2026-10-15; records PR merged, #478): the orchestrator runs record writes itself until W-267; W-267 widened and high; Codex Sol is the one review gate; workflow definitions move into the repo; the onboarding filings approved. `~/.bisellium-evidence/audit-rulings/apply-d066.sh` filed them as W-274 to W-278 (Queue item 0). **D-071** (2026-10-16): CLI first, then the console; one measure (orchestrator hand steps per opus, ~25 on W-293, target under 8) and a stop rule (lex §7); W-243 second; W-274 becomes the review perform (the later-round rule folded in); W-297 moves after it; the queue record (W-299), the petitio verb (W-298), the step drawer (W-300) and console writes (W-301) filed under M4; the dossier republish leaves done; two opera halted (`~/.bisellium-evidence/lead-arch-1016/book-of-work.md`). **D-070** (2026-10-16): no per-opus retro; reviewers tag each finding's class and a class seen before is fixed at its cause in the fix round (W-297 enforces; until then check a failing verdict's classes with `~/.bisellium-evidence/lesson-census/census.py`); W-213 and W-287 halted. **D-069** (2026-10-16): the queue re-ranked speed first; the 197-lesson census mapped (`~/.bisellium-evidence/lesson-census/`); W-294 (lead agents) and W-295 (architecture-page gate) deferred to the backlog, veto-able; W-296 filed. **D-068** (2026-10-16, #493): the 2026-10-11 audit closed. **D-067** (2026-10-15; the backlog-alignment pass applied, records PR #483 merged): W-279 builds second; W-277 folds into W-274, W-257 into W-214 (both halted); four opera filed greenlit (W-280 to W-283, Queue items 1-2), four to backlog (W-284 to W-287). **D-067 re-ranked by the Patron 2026-10-15** (Fable lanes-ops report `~/.bisellium-evidence/lanes-ops-fable/report.md`): W-206 + W-214 (the spec rides in the opus PR, so a brief can be amended mid-build; one records PR at done) move up to right after W-279; a second build lane is decided after the runner trial (W-183, the timeout and wait fixes, then W-169, switching lanes on, stay in Queue 6 until then).
1. **W-255** (light brief) done (#477, done PR #481; retro L-183 to L-187): round 1's advisory answered by two coverage-only test rows (no red), round 2 passed. **W-276** spec landed (#479): a delta on W-241 part 1's builder-brief template, so the build order is W-241 part 1, then W-276, then W-260. **W-267 part 1** done (#488, #492). **W-279** (the mint runs each gate once) done (#489, done #495, checkpoint 81 #496; certify refused a branch carrying a merge commit: never merge master into an opus branch). **D-068** (#493) closed the 2026-10-11 audit: W-289 and W-290 filed high, W-291 to the backlog, W-268 widened. **W-206 part 1** (a brief amended mid-build is re-signed and reviewed on the opus branch) done (#499; spec #494 on its round-5 signature under the two-round cap; build review rounds 1-2 failed with six findings, round 3 passed; verify passed on master; retro and fold-ins on the done PR). Checkpoint 82 done (#502). **W-293** (W-206 part 2: the first spec rides the opus PR, spec/<id> retired) done (#507; spec on its round-5 signature under the two-round cap; build review round 1 failed on an ignored spec log, round 2 passed; verify passed on master; no retro, D-070). **Temporary Ops team** (Patron 2026-10-16, until W-241 part 1): an Opus 5.5 ops-lead from `~/.bisellium-evidence/ops-team/ops-lead.md`, a Sonnet ops builder, Codex review; it shipped the background-run fix (#497 hook, #498 builder rule); the durable runner script and step health across sandboxes are folded into W-183 (W-206's done). Next, in order (D-071, CLI first): W-243 (certify judges the diff, not the branch name) → W-214 (one records PR at done) → W-241 part 1 (the prompt templates) → W-274 (a review round is one `next` perform; the stderr trace line rides it) → W-292 (the runner's dispatch hook) → W-290 (the orchestrator cannot write source); the full order is the Queue's Now list. A Codex draft of W-275's spec waits in `~/.bisellium-evidence/W-275-draft/` (re-check it after W-260). Until W-276 lands, every builder brief adds by hand: run `next` from the worktree before each `red`, and the long-run rule above. The tick was skipped after each done (108 due, none since D-064; the Patron may veto). W-266 rides W-229.
2. Use `npm run -s bisellium --`: the `bisellium` on PATH runs `~/projects/bisellium-guard` (stale). Kept scripts (run output stays here, definitions move to the repo under D-066 D): `~/.bisellium-evidence/{spec-review-first,spec-review-later,land-spec,opus-start,opus-done,review-packet,review-receipt,record-review,censor,retro-triage,chore-pr}.sh`, `retro-adjust.py`, `W-265-review/r1-run.sh` (review-round template), `checkpoint-w265.py` (checkpoint template); a worktree needs `cp -a ../../node_modules`.
   `handoff-check.mjs` misreads D-064's grouped Queue: its "Resume point names W-nnn next, but the Queue does not list it" lines are false; `next --expect done` runs the real rule (W-186) instead.
3. Rulings: D-064 (backlog audit), D-063 (audit choices), D-061 (24 opera halted, lex §7); `audit-rulings/apply-d06{1,3,4,6}.sh`.
- Audits done 2026-10-14 (read-only, Fable): `~/.bisellium-evidence/fable-{improvements,cleanliness,efficiency}/report.md`. Their backlog-alignment pass is applied as D-067 (`~/.bisellium-evidence/backlog-alignment-1015/report.md`). Its items are mapped in D-067 (filed W-279 to W-287, folded into W-179, W-183, W-248, W-249, W-250); the timeout lesson is now a W-183 behaviour.
- 22 stale worktrees under .worktrees/; check each for unpushed work before removal.
- Checkpoint after every opus: the orchestrator runs a kept `checkpoint-<id>.py` (model: `~/.bisellium-evidence/checkpoint-w279.py`; a subagent running it is refused until W-274), `build.sh`, a records PR; the dossier is republished at cascade checkpoints only, by a Haiku agent (D-071, lex §7); the Status page waits for the Patron (Boot item 4). Last one cascade 81 (W-279, #496).
- `cleanup` on a read-only `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Ranked CLI first (D-071, Patron 2026-10-16, on `~/.bisellium-evidence/lead-arch-1016/book-of-work.md`; earlier: D-069, D-070,
D-067); one lane, no second until the console MVP lands. Block exit (lex §7): two consecutive opera pass the trial (no
hand-run evidence scripts, no required handoff edits, review independence kept, safe restart after an interruption);
early stop if the hand-step count (baseline ~25 per opus, target under 8) is not under 15 after W-214, W-274 and W-292,
or at two calendar weeks. Older items: `studio/acta/2026-10-09-queue-review.md`.

Now, one builds at a time:
1. Done: the first spec rides the opus PR, spec/<id> retired (#507)
2. W-243 — certify mints by what the diff changes, never by branch name; `pr` refuses a merge commit (high, D-039)
3. W-214 — one records PR at done; the handoff and checkpoint ride the done commit
4. W-241 part 1 — the prompt templates in `studio/prompts/` (specced)
5. W-274 — a review round is one `next --perform`: packet, prompt, Codex through the harness adapter, verdict and review; ride-along: the stderr trace line in `next.test.ts`'s helper
   recorded with the ticket, one commit; the bash copies and per-opus runners deleted; carries the later-round pass/fail rule (high)
6. W-292 — only a dispatched runner writes ladder records and chains mint, review, PR and merge; one background call per perform (`.claude/`: Patron merges)
7. W-290 — the orchestrator session cannot write source or tests; same hook and Patron merge as W-292 (high)
8. W-275 — `next` names two-perform rungs and body-file roots; `verdict` refuses a signature `next` cannot read (high)
9. W-259 — certify is the single mint, done records it, no host mint before review, no local verify (design approved, D-071 E)
10. W-247 — drop the handoff Resume point and its Codex review
11. W-299 — the queue is a record: `rank` writes `studio/queue.yml`; `next`, the Board and `status-page.mjs` read it; the handoff Queue section goes
12. W-297 — reviewer class tags enforced by `verdict` and `next` (D-070); trial opus 1
13. W-283 — the Status page served, not republished (its `.github` change is the Patron's); trial opus 2
14. W-268 — the certify rules: the merge queue refuses writes `next` never ticketed (high); trial opus if 12-13 had no interrupted run

Next, the console MVP (after the block, same functions):
15. W-280 — Inbox and `newItem` fail-open fixes
16. W-298 — a `petitio` verb to the Patron; `next` holds on an open one
17. W-074 — greenlight and decline from the Board drawer, carrying W-289's refusal (greenlight is the Patron's alone, high) and a `halt` route
18. W-300 — the drawer shows `next`'s read-only step, actor, round and health
19. W-301 — console writes commit and land by auto-merge PR, with a cross-process write lock
W-281 — milestone exits that can be met — rides any records PR.

Later (ranked by value; group descriptions stand for the ids in them):
- Speed experiments (W-258 first): W-258 — the builder self-reviews once before handing off; W-178 — the test-row count check, then W-179 —
  the slowest test file split; W-276 — the builder brief under step tickets; W-260 — build verdicts reconcile after rulings; W-250 — ci.yml runs `bisellium ci` once.
- High block remainder: W-296 — one typed boundary for tracked writes; the lessons-to-checks checks W-269, W-270, W-271, W-272, W-273 (D-065).
- Records hygiene, small, no hand steps saved: W-278 (the review gate named once; rides any records PR), W-098, W-252, W-251 (after W-297), W-254,
  W-238, W-239, W-229, W-172, W-219, W-228, W-227, W-230, W-217, W-210, W-173, W-174, W-165, W-190, W-198, W-195, W-208, W-081, W-138.
- Cleanup chain: W-245 part 1 — census of every provider coupling (the Patron approves the design) → W-248 — dead verbs and packages →
  W-249 — lighter tests → W-282 — the dead-code sweep → W-285 — one helper each.
- Dependencies and the arc: W-068 — task dependencies (copy `~/.bisellium-evidence/partial-specs/W-068.md` to `studio/briefs/W-068.md`, add
  `Red order: one at a time`, re-sign, spec review), then the W-118 split (M3's exit); a slice "execute and resume one opus" is filed only if the trial's interruption case fails.
- Milestone exits: W-045 + W-185 — atomic writes, records checked at load (M2); W-099 + W-093 — realpath anchor, security review on every change (M8);
  W-149 + W-150 — outside-adapter test and guide (M9); W-159 — model per seat, after W-245 (M6); W-157 — the decide verb.
- Console screens, M5 and later (after the MVP): W-073, W-078, W-113, W-116, W-090, W-091, W-092, W-145, W-146, W-147, W-148, W-202, W-136, W-143,
  W-144, W-154, W-158, W-160, W-040, W-051, W-094, W-115, W-133, W-175, W-176, W-216, W-264, W-286.
- Adopters and remote, not on the path: W-135, W-284, W-288, W-291, W-070, W-151.
- Deferred or held: W-182, W-183, W-169, W-261, W-263 (a second lane, D-071 L); W-231 (orchestrator self-refresh, after the W-118 split);
  W-242 (held until the measure retires); W-294, W-295 stay in the backlog (D-069 C).

## Open Patron choices
- None (the 2026-10-11 audit closed by D-068).
