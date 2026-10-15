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
4. Known traps until their filings land: a subagent running a kept record script is refused by the auto-mode classifier; stop and report, never ask for an allow rule or retry with another agent. Every record write needs a `next` run just before it at the same head (step tickets), including the builder's `red` (tell the builder; the kept builder brief still forbids `next`). `next --perform --expect pr --body-file` takes a file under the repo or `$TMPDIR` only: copy the kept body there first. `next --perform --expect spec` and `--expect done` are each two performs (commit, then land); the spec landing leaves earlier round logs untracked, add them to the next records commit. `--expect done` refuses without a tracked handoff edit. The evidence copies of the five kept scripts carry the `next` calls; `scripts/` copies lack them until the D-066 D filing lands.

## Resume point (2026-10-15)

0. **Rulings applied:** D-064 (PR #471; step tickets required: every record write follows a `next` call for that step; the retro rides the done PR). **D-066** (2026-10-15, records PR pending): the orchestrator runs record writes itself until W-267; W-267 widened and high; Codex Sol is the one review gate; workflow definitions move into the repo; the onboarding filings approved. `~/.bisellium-evidence/audit-rulings/apply-d066.sh` filed them as W-274 to W-278 (Queue item 0).
1. **W-265** done (#473, #474; retro L-179-L-182). **W-255** (light brief) built, review round 1 passed (recorded by the Patron by hand), PR #477 open and held by the Patron (auto-merge off; `next` from the main checkout says `merge dead`: rerun `next W-255 --perform --expect merge` once the hold lifts; it touches ADOPTION.md, leges, the spec-review prompt). Next: **W-255** merge, cleanup, done + retro, checkpoint; then Queue item 0 in its order (W-267 first: its design to the Patron before branch; then W-274 to W-278); **W-260** (spec landed: `branch`, the first build under step tickets) builds only after W-276; then **W-098** (one advisory from W-265: `scripts/replay-accept.test.mjs:332`'s doesNotReject row hardcodes `operator: 'doesNotThrow'`). **W-241 part 1** spec landed (#476); its `studio/ci/W-241-spec-{1,2}.log` ride D-066's records PR. W-266 rides W-229.
2. Use `npm run -s bisellium --`: the `bisellium` on PATH runs `~/projects/bisellium-guard` (stale). Kept scripts (run output stays here, definitions move to the repo under D-066 D): `~/.bisellium-evidence/{spec-review-first,spec-review-later,land-spec,opus-start,opus-done,review-packet,review-receipt,record-review,censor,retro-triage,chore-pr}.sh`, `retro-adjust.py`, `W-265-review/r1-run.sh` (review-round template), `checkpoint-w265.py` (checkpoint template); a worktree needs `cp -a ../../node_modules`.
   `handoff-check.mjs` misreads D-064's grouped Queue: its "Resume point names W-nnn next, but the Queue does not list it" lines are false; `next --expect done` runs the real rule (W-186) instead.
3. Rulings: D-064 (backlog audit), D-063 (audit choices), D-061 (24 opera halted, lex §7); `audit-rulings/apply-d06{1,3,4,6}.sh`.
- Audits done 2026-10-14 (read-only, Fable): `~/.bisellium-evidence/fable-{improvements,cleanliness,efficiency}/report.md`. Next: a backlog-alignment pass over the three against each other and the backlog (overlaps seen: the ESLint .worktrees ignore in cleanliness #1 and efficiency #5; the Inbox fail-open in improvements #6 and cleanliness), ending in a filing list for the Patron. Producer's set: mint runs each gate once; ESLint ignores .worktrees/; newItem skips validateRecordReferences + Inbox invents petitiones; milestone needs: exits evaluated; init yields a runnable studio; deletions into W-248/W-254, the next.test.ts split into W-249 (the "ladder prompts/scripts into the repo" item is now D-066 D). The timeout lesson (verify 11 -> 30 min under audit load; never run heavy read-only work during a mint or verify) has no retro slot: it goes in that filing list as a guard opus.
- 22 stale worktrees under .worktrees/ (and .kilo/worktrees/plastic-credit); check each for unpushed work before removal.
- Patron reference (2026-10-15): https://claude.com/resources/articles/the-ai-native-sdlc-playbook
- Checkpoint after every opus: a Haiku agent adds history rows, runs `build.sh`, republishes Status and the dossier (lex §7); last one cascade 78 (W-265).
- `cleanup` on a read-only `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Ranked (Patron 2026-10-13, D-061: in flight, audit cuts, milestone exits, lanes later; one lane
until W-169 lands). Older items: `studio/acta/2026-10-09-queue-review.md`.

0. High (D-066, D-039), after W-255 closes: W-267 — the dispatch guard, widened: the ladder-runner agent file, the
   runbook in `context --sella producer`, a check rule for undefined roles, the censor agent retired (Patron's design gate
   before branch); then the D-066 filings (`~/.bisellium-evidence/orchestrator-onboarding/filing.md`): W-274 — one
   copy of each kept script in `scripts/` calling `next`, high; W-275 — `next` names two-perform rungs and the handoff
   refresh; W-276 — the builder brief under tickets (before W-260's build); W-277 — the spec landing carries every round
   log, high; W-278 — the review gate named once.
1. Audit cuts, re-ranked by the ops speed audit (Patron 2026-10-14;
   `~/.bisellium-evidence/ops-speed-audit/report.md`): W-098 (reuses the red replay's TAP-block parser);
   W-255 — a light brief by the architect's marker (built, reviewed; PR #477 held); W-260 — build verdicts reconcile after rulings (greenlit
   by the spec-review cap's retro; spec passed, landed); W-252 — the spec-round counter refuses malformed history (built as W-185's verdict-log loader in @bisellium/schema)
   (greenlit by the same retro);
   W-206 + W-214 as one opus — spec in the opus PR (spec phase, handoff and re-spec), retro in
   the done PR (D-064 B); W-257 — handoff and checkpoint edits ride the done
   PR; W-250 — ci.yml runs `bisellium ci` once, records-only pushes take the short path;
   W-259 — check each tree once, certify is the single mint (pipeline: design to the Patron
   before branch); W-258 — the builder self-reviews once before the first build review;
   W-247 — drop the handoff Resume point and its review; W-223 — the Status page shows the
   ranked queue in plain words (Patron 2026-10-14: an exception to the freeze); W-243 —
   certify judges the diff, not the branch name (D-039 high), then W-268 — the certify rules; W-251 — process work capped (the retro half is dropped); W-254 — delete talk and the dailies.
2. W-245 part 1 — census of every provider coupling (the Patron approves the design); then
   W-248 — dead verbs and packages (W-081's injection note rides it), W-249 — lighter tests.
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
   W-169's subtask after W-257; W-261 after W-169, W-183 and
   W-219, narrowed to Patron-reply, verdict, certificate, merge and dependency waits.
7. The rest as ranked 2026-10-11/12 (acta `2026-10-11-patron-queue-review`), halted ids
   dropped: W-219, W-228, W-227 (high), W-230, W-138, W-217; W-210, W-213; W-208;
   W-081; W-173, W-174, W-195, W-165, W-190, W-198; W-158,
   W-133, W-115, W-116, W-154, W-091, W-090, W-143, W-144, W-157, W-145, W-136, W-146,
   W-160, W-135; W-040, W-051, W-094; W-175, W-176; W-216.

Greenlit, not yet ranked: W-070, W-113, W-147, W-151; W-269, W-270, W-271, W-272, W-273 — the five lessons-to-checks checks (D-065), in its rank order.

## Open Patron choices
- The 2026-10-11 audit (four rule breaks, eight gaps in 25 commits), `~/.bisellium-evidence/design-notes-1011/`.
