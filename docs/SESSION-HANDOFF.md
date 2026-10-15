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

1. Read all of `studio/leges/production.md` (§7-§11; §9 step 0 says who runs each step) and `~/.bisellium-evidence/orchestrator-onboarding/ladder.md`, the step-by-step runbook (the exact command per step and what `next` prints before it) until W-267 serves it from `bisellium context --sella producer studio`.
2. Run, read-only: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium` (flag shapes); `npm run -s bisellium -- next <id> --budget 400000 --studio studio --repo .` for each opus in flight; `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles (D-066 A). The orchestrator runs every ladder record write itself through the allowlisted `npm run -s bisellium --` verbs and `scripts/*.sh`; it dispatches builders (Sonnet, background), the architect (Opus 5.5) and Codex reviewers (`gpt-5.6-sol`, the single review gate, D-066 C); `clerk` (no Bash) edits text only. There is no ladder-runner agent until W-267 lands; never improvise one, and never use the Claude `censor` agent as the gate.
4. Known traps until their filings land: a subagent running a kept record script is refused by the auto-mode classifier; stop and report, never ask for an allow rule or retry with another agent. Every record write needs a `next` run just before it at the same head (step tickets), including the builder's `red` (tell the builder; the kept builder brief still forbids `next`). `next --perform --expect pr --body-file` takes a file under the repo or `$TMPDIR` only: copy the kept body there first. `next --perform --expect spec` and `--expect done` are each two performs (commit, then land); the spec landing leaves earlier round logs untracked, add them to the next records commit. `--expect done` refuses without a tracked handoff edit. The evidence copies of the kept scripts carry the `next` calls (`record-review.sh` passes `--budget`); the `scripts/` copies lack them until W-274. A spec's "stale handover" hold can mask an invalid architect signature (W-275): sign with findings lines `n. advisory — … — check: …` or `No findings`, since `verdict` accepts prose findings on a passed spec but `next` refuses them. Uncommitted tracked edits in the main checkout stop the spec and merge performs from fast-forwarding master: set them aside with a tagged `git stash push -m <tag> -- <paths>`, rerun the perform, `git stash apply <sha>`, drop by tag. A merge perform that prints `QUEUE_TIMEOUT` while the PR is still queued is rerun with `--poll-ms 20000 --max-polls 150`. Code-owner review gates only PRs touching `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs` (auto-merge is always safe; pushing dismisses an approval). A subagent's Artifact publish is refused by the auto-mode classifier ('Unrequested Commit in a Connected App'); the checkpoint republish of the Status page needs the Patron (2026-10-15: the orchestrator republished once by exception) until W-283 serves the page.

## Resume point (2026-10-15)

0. **Rulings applied:** D-064 (PR #471; step tickets required: every record write follows a `next` call for that step; the retro rides the done PR). **D-066** (2026-10-15; records PR merged, #478): the orchestrator runs record writes itself until W-267; W-267 widened and high; Codex Sol is the one review gate; workflow definitions move into the repo; the onboarding filings approved. `~/.bisellium-evidence/audit-rulings/apply-d066.sh` filed them as W-274 to W-278 (Queue item 0). **D-067** (2026-10-15; the backlog-alignment pass applied, records PR pending): W-279 builds second; W-277 folds into W-274, W-257 into W-214 (both halted); four opera filed greenlit (W-280 to W-283, Queue items 1-2), four to backlog (W-284 to W-287).
1. **W-255** (light brief) done (#477, done PR #481; retro L-183 to L-187): round 1's advisory answered by two coverage-only test rows (no red), round 2 passed. **W-276** spec landed (#479): a delta on W-241 part 1's builder-brief template, so the build order is W-241 part 1, then W-276, then W-260. **W-267 part 1** spec landed (#480; the Patron approved part 1's design): the ladder-runner agent file, censor.md deleted, the runbook served by `context --sella producer`; part 2 (the dispatch hook) waits for one live runner trial, deny-only and fail-open; part 3 (the roles check) waits for W-274. This session refreshes at the 350k context cap once D-067's records PR is open; the next session starts W-267 part 1: `branch` needs the Patron's go (it changes `.claude/`). Next, in order (backlog-alignment report §3 item 0): W-267 part 1 build (the ladder-runner agent; touches .claude/: the Patron approves branch and merge) → W-279 (the mint runs each gate once; spec it while W-267 builds) → W-241 part 1 (leads as agents, prompt templates into the repo) → W-276 (builder brief under tickets) → W-260 (build verdicts reconcile after rulings) → W-275 (`next` names two-perform rungs) → W-274 (kept scripts into `scripts/`; carries W-277, the spec landing carrying every round log) → W-243 (certify judges the diff); W-278 (the review gate named once) is a records-only PR the day W-267 part 1 lands; then W-098 (reuses the red replay's TAP parser; one advisory from W-265: `scripts/replay-accept.test.mjs:332`'s doesNotReject row hardcodes `operator: 'doesNotThrow'`). Until W-276 lands, every builder brief must add by hand: run `npm run -s bisellium -- next <id> --budget 400000 --studio <main>/studio --repo <main>` from the worktree just before each `bisellium red` (the kept builder brief still forbids `next`). W-265 is done (#473, #474; retro L-179-L-182). W-266 rides W-229.
2. Use `npm run -s bisellium --`: the `bisellium` on PATH runs `~/projects/bisellium-guard` (stale). Kept scripts (run output stays here, definitions move to the repo under D-066 D): `~/.bisellium-evidence/{spec-review-first,spec-review-later,land-spec,opus-start,opus-done,review-packet,review-receipt,record-review,censor,retro-triage,chore-pr}.sh`, `retro-adjust.py`, `W-265-review/r1-run.sh` (review-round template), `checkpoint-w265.py` (checkpoint template); a worktree needs `cp -a ../../node_modules`.
   `handoff-check.mjs` misreads D-064's grouped Queue: its "Resume point names W-nnn next, but the Queue does not list it" lines are false; `next --expect done` runs the real rule (W-186) instead.
3. Rulings: D-064 (backlog audit), D-063 (audit choices), D-061 (24 opera halted, lex §7); `audit-rulings/apply-d06{1,3,4,6}.sh`.
- Audits done 2026-10-14 (read-only, Fable): `~/.bisellium-evidence/fable-{improvements,cleanliness,efficiency}/report.md`. Their backlog-alignment pass is applied as D-067 (`~/.bisellium-evidence/backlog-alignment-1015/report.md`). Its items are mapped in D-067 (filed W-279 to W-287, folded into W-179, W-183, W-248, W-249, W-250); the timeout lesson is now a W-183 behaviour.
- 22 stale worktrees under .worktrees/ (and .kilo/worktrees/plastic-credit); check each for unpushed work before removal.
- Patron reference (2026-10-15): https://claude.com/resources/articles/the-ai-native-sdlc-playbook
- Checkpoint after every opus: a Haiku agent adds history rows, runs `build.sh`, republishes Status and the dossier (lex §7); last one cascade 79 (W-255).
- `cleanup` on a read-only `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Ranked (Patron 2026-10-13, D-061: in flight, audit cuts, milestone exits, lanes later; one lane
until W-169 lands; re-ranked by D-067). Older items: `studio/acta/2026-10-09-queue-review.md`.

0. High first (D-066, D-067, D-039), one builds at a time: W-267 part 1 — the ladder-runner agent file, the runbook in
   `context --sella producer`, the censor agent retired (build; touches .claude/, so the Patron approves branch and
   merge) → W-279 — the evidence mint runs each gate once and lint skips `.worktrees/` (spec it while W-267 builds; takes
   27 minutes off every later opus) → W-241 part 1 — leads as agents, prompt templates move into `studio/prompts/` (specced,
   landed #476) → W-276 — the builder brief under step tickets (specced) → W-260 — build verdicts reconcile after rulings
   (specced) → W-275 — `next` names two-perform rungs and the handoff refresh, and `verdict` refuses a signature `next`
   cannot read (high) → W-274 — one copy of each kept script in `scripts/` calling `next`, carrying the spec-log fix, the spec landing
   carries every round log (high) → W-243 — certify judges the diff, not the branch name (D-039 high). W-278 — the review
   gate named once — is a records-only PR the day W-267 part 1 lands. W-267 parts 2 and 3 wait (part 2 for a live runner
   trial, part 3 for W-274).
1. W-098 (reuses the red replay's TAP-block parser) → W-206 + W-214 as one opus — spec in the opus PR, retro and handoff
   edits in the done PR (D-064 B; carries the handoff-and-checkpoint-in-done-PR fix) → W-250 — ci.yml runs `bisellium ci` once, records-only pushes take the
   short path → W-258 — the builder self-reviews once before the first build review → W-252 — the spec-round counter
   refuses malformed history → W-247 — drop the handoff Resume point and its review → W-223 — the Status page shows the
   ranked queue in plain words (Patron 2026-10-14: an exception to the freeze) → W-268 — the certify rules → W-259 — check
   each tree once, certify is the single mint (Patron design gate before branch) → W-251 — process work capped (the retro
   half is dropped) → W-254 — delete talk and the dailies. Also: W-280 — the bug pair, Inbox and `newItem` fail-open, slots
   in wherever a builder is idle; W-281 — milestone exits that can be met; W-283 — the Status page served instead of
   republished, after W-250 (its `.github` change is the Patron's).
2. W-245 part 1 — census of every provider coupling (the Patron approves the design) → W-248 — dead verbs and packages
   (W-081's injection note rides it) → W-249 — lighter tests (prettier dropped) → W-282 — the dead-code sweep → W-285 — one
   helper each (backlog; after the sweep) → W-179 — the slowest test file split into parallel-safe pieces.
3. W-068 — task dependencies (copy `~/.bisellium-evidence/partial-specs/W-068.md` to
   `studio/briefs/W-068.md`, add `Red order: one at a time`, re-sign, spec review); then the
   W-118 split (M3's exit; absorbs W-169, W-231, W-241 part 2).
4. Milestone exits: W-045 + W-185 — atomic writes, records checked at load (M2); W-099 +
   W-093 — realpath anchor, security review on every change (M8); W-078, W-074, then W-073 —
   greenlight and reply from the console (M4); W-149 + W-150 — outside-adapter test and
   guide (M9); W-159 — model per seat, after W-245 (M6).
5. W-238 — brief admission refuses a red the host replay cannot run; W-242 — drop the
   PreCompact hook; W-239 — `next`'s merge always fast-forwards master; W-241 part 1 —
   leads as agents (specced, approved, landed #476); W-229, W-172 (high).
6. Multi-lane prep: W-178, W-179, W-182, W-183, then W-169 (switches lanes on); W-263 becomes
   W-169's subtask after W-214; W-261 after W-169, W-183 and
   W-219, narrowed to Patron-reply, verdict, certificate, merge and dependency waits.
7. The rest as ranked 2026-10-11/12 (acta `2026-10-11-patron-queue-review`), halted ids
   dropped: W-219, W-228, W-227 (high), W-230, W-138, W-217; W-210, W-213; W-208;
   W-081; W-173, W-174, W-195, W-165, W-190, W-198; W-158,
   W-133, W-115, W-116, W-154, W-091, W-090, W-143, W-144, W-157, W-145, W-136, W-146,
   W-160, W-135; W-040, W-051, W-094; W-175, W-176; W-216.

Greenlit, not yet ranked: W-070, W-113, W-147, W-151; W-269, W-270, W-271, W-272, W-273 — the five lessons-to-checks checks (D-065), in its rank order.

## Open Patron choices
- The 2026-10-11 audit (four rule breaks, eight gaps in 25 commits), `~/.bisellium-evidence/design-notes-1011/`.
