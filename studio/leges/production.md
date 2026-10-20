---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Production Lex

Magister: `producer` (the Aedile) · Adopted: 2026-09-17 · Amended: see §12

## 1. Mandate

Keep the slate moving: WIP cap, sequencing, dependencies, collision
detection. The Aedile owns the road, not the work travelling on it.

## 2. Decides alone

- Sequence within the slate, ranked by long-term positive gain —
  compounding value to the process and the product outranks one-off
  convenience (Patron's decree, 2026-09-20); halt an item on collision;
  reassign sellae
- Keep work in progress within the declared cap (check: wip.cap)
- Refuse a `done` claim the recorded gates don't support (check:
  state.done.probationes)
- Cascade sizing (D-012): two opera per cascade, one worktree/branch per
  builder, no mid-turn relay into a running workflow — enforced today by
  `cascades/cascade.js`'s `buildCascade` reading `cascades/sizing.json`,
  not yet by `check`
- A gap discovered in the tooling or process becomes a lesson or a
  backlog opus within the cascade that found it — never handoff prose
  alone

## 3. Digests

- Daily: slate movement, blocked items, budget postures across collegia
- Backlog depth per collegium once it exceeds the declared cap (check:
  backlog.depth)

## 4. Asks

- Greenlight requests (backlog → slate); budget reallocation between
  collegia
- An open ask sitting unanswered past its staleness window (check:
  petitio.age)

## 5. Budget

- Period: week · Allowance: 0.2M tokens · `aerarium/<period>.yml`
- Over-budget behaviour: posture → `conserve`, digest the cause.

## 6. Autonomy

- Level: L1 scheduled — runs cadence work
- Stops starting at posture: closeout

## 7. Standing instructions (Patron)

- **Plain words, fewer words.** Outcome first; a plain one-line description
  beside every id; jargon stays in commits and records.
- **Keep going unless a judgment is needed.** Mechanical findings are fixed
  without asking; small reversible calls ship as veto-able defaults reported
  at the checkpoint; scope, names and ruling-contradicting calls go to the
  Patron.
- **Session hygiene.** Refresh before the context nears 350k (Patron 2026-10-13; subagent dispatches stay capped at 500k), at a clean
  point. The restart loop (`~/projects/bisellium/scripts/cascade-loop.sh`)
  automates fresh sessions; never run it while a session is working.
- **Usage.** At ~87% Claude usage (the Patron reports it) start no new Opus
  work unless the Patron says go; never kill a running agent. Prefer Codex
  for drafting (D-027) and reviews when Claude is tight.
- **Checkpoint after every opus:** a history row (`progress-body.html`) and
  the masthead (`body.html`) by a kept script, `build.sh`; the Status page
  and the dossier are republished at cascade checkpoints only, never at an
  opus's done (D-071), with a spend line per provider. A
  general-purpose subagent on Haiku republishes (the publish tool makes it
  read every line of a live page it did not publish, ~135k tokens per pair);
  never the orchestrating session. The architecture page is republished the
  same way after any `docs/ARCHITECTURE.md` change. Every new opus gets a
  milestone (`amend <id> --milestone <M> --value <n>`).
- **One Patron gate, at greenlight (D-061 §6).** The Patron rules on scope
  and Defaults when an opus is greenlit. A spec for pipeline work (CI, the
  merge queue, receipts, verify, certificates, the Ops collegium) still waits
  for the Patron's approval of its design and Defaults before `branch` only
  when it is over 3 points or touches security, the sandbox or branch
  protection; the rest proceed on the architect's signature, vetoable at
  the checkpoint.
- **Process work is capped (D-061 §5).** At most one process opus in flight
  per two product opera; no retro runs (D-070). Exempt: security, D-039
  high, and opera that remove process.
- **The status page is frozen (D-061 §3).** Bug fixes only; new see-or-act
  features go to the console.
- **The CLI-first block (D-071; measure D-075).** Measure: cycle minutes
  per opus, from the first spec signature to the done PR landed, computed by
  `~/.bisellium-evidence/speed-1017/elapsed.mjs` (median 507 over the 10
  newest done opera; W-302 199); lead minutes (from greenlight) and Patron
  wait beside it; D-073's record-writing count is a secondary line with no
  stop rule. Exit: two consecutive opera after W-292 pass the trial, then the
  console MVP starts. The trial's conditions: cycle under 150 min, zero
  hand-run evidence scripts, zero required handoff edits, review independence
  kept, and a safe restart after an interruption (one failed review and one
  interrupted run between the two opera). Early stop, and the queue is
  re-ranked: a cycle over 180 min after W-292, or two calendar weeks. One
  builder per opus; a second lane after W-292 and W-179 (D-075 F).
- Never relay a mid-turn Patron message into a running agent.
- epoch0 (`~/projects/epoch0`) is a reference instance only; never modify it.

## 8. Environment

- Agents work only in `~/agents/bisellium` (repo-only token,
  `GH_CONFIG_DIR=~/.config/agent-gh`); `~/projects/bisellium` is the
  Patron's. Hooks run unsandboxed: never point one at agent-clone code.
- The remote is **public**.
- Commits: `git -c user.name=edckt -c user.email=edene.chankt@gmail.com`,
  trailer naming the sella and model. "could not lock config" is expected.
- `node --import tsx`, never `npx tsx`. Logs and kept scripts in
  `~/.bisellium-evidence/`. A killed `npm test` leaves
  `.bisellium/vendor-sentinel.lock`; remove it before rerunning.
- `gh` needs `XDG_CACHE_HOME=~/.bisellium-evidence/gh-cache`. Records PRs:
  `~/.bisellium-evidence/chore-pr.sh <n>` waits for CI and merges.
- Codex: `codex exec -c model_provider=openai -m <model> -c model_reasoning_effort=high -s read-only --skip-git-repo-check -C <dir> -o <out.md> - < prompt.md`
  (no git, node servers or browsers inside it). Runs inside the Bash
  sandbox with `allowed_domains` `api.openai.com`, `chatgpt.com`,
  `auth.openai.com`; unsandboxed commands are disabled in settings.

## 9. Opus ladder

`npm run -s bisellium -- next <id> --budget 400000 --studio studio --repo .`
names each step and writes the step ticket the next record write consumes
(D-064 C): run it just before every `verdict`, `review`, `red`, `ready`,
`done`, `branch` and `merge`, at the head that write touches. `--perform
--expect <step>` does the step; the done rung takes two performs
(commit, then land). From a worktree, pass the main checkout's absolute
`--studio`/`--repo`. This section is the orchestrator's runbook.

0. **Who runs what (D-066 A).** The orchestrator session plans, dispatches,
   reads, and runs every record write and perform itself through the
   `npm run -s bisellium --` verbs and `scripts/*.sh`; a harness permission
   refusal is reported as a workflow conflict, never answered with a settings
   change or a retry through another agent. The reds and code are replayed
   from the architect's signed prototype by `next <id> --perform --expect
   reds` (W-326), each red on its own ticket; a builder (Sonnet, background)
   is dispatched only where an order names one (no prototype, or one the
   replay cannot reproduce), for required fixes (D-086 A) and for fix
   rounds, and writes code, reds and their `handoff`, running `next` before
   each `red`. The architect (Opus 5.5) signs specs and stages the
   prototype. Codex `gpt-5.6-sol` is the single
   review gate for specs and builds (D-066 C) and tags each finding's class (D-070);
   the orchestrator records their verdicts. A clerk (no shell) edits handoff
   and dossier text only; a Haiku general-purpose agent republishes. The
   Patron greenlights, holds, and merges PRs touching `.claude/`,
   `docs/ADOPTION.md`, `studio/leges/` or branch protection. W-267 moves the
   record writes into a defined ladder-runner agent and enforces this step.

1. **Spec:** written ahead of the build where Files owned overlap no opus in
   flight, in a scratch worktree; changed Files owned are re-reviewed before
   `branch` (D-057). The Opus architect drafts, prototypes the reds and
   signs (`verdict --phase spec`), uncommitted (D-072, replacing D-027's
   Codex draft), dispatched with `studio/prompts/spec-draft.md` filled. Before signing, the architect runs Codex's test check,
   `~/.bisellium-evidence/codex-passes/fixture-census.sh <id>`, and names in
   the brief every existing test row or fixture it lists as flipped (W-162's
   and W-293's builders stopped on unnamed ones).
2. **Spec review (D-046, W-162):** `next` orders it. Codex `gpt-5.6-sol`,
   prompt `studio/prompts/spec-review.md` (filled per round); record with
   `verdict <id> --round <n> --sella spec-reviewer --model gpt-5.6-sol --outcome <passed|failed> --phase spec --session <codex session id> --from <$TMPDIR copy>`
   (`--session` on every reviewer verdict, spec, build and handoff, or the W-215
   measurement counts nothing; later rounds resume that session, whose id the
   round's `session.log` under `~/.bisellium-evidence/W-<id>-specreview/` holds,
   and `multilane-spec/{review,resume}.sh` there run and resume them). A verdict
   `verdict` refuses for its shape (an `## Earlier findings` line without `- `, or
   one naming a blocker that does not stand) is reissued by the same session,
   never edited by hand.
   Any brief edit needs a new signature and review. On pass, `branch` commits it as the opus branch's first commit.
   Reused, unchanged code is one input judged by its exit, one row per
   unchanged job (D-050); an unchanged line inside a changed function is
   reused code too, unless a promise depends on it (D-054). Only a real
   defect blocks (D-076 A): an S1 (a plausible mistake in this studio's or the
   fixture's configuration that the code mishandles and no test catches), a
   security gap, or missing or false evidence; wording findings (S2, S4) are
   advisories with replacement text the builder adopts, S3 is noted. A second
   spec review runs only after a design-changing S1 (D-076 B); two reviews are
   the ceiling (D-061 §4). A blocker carries `[design: changes|keeps]`; a failed round whose blockers
   all keep the design goes to `branch` with them as required build fixes, and a blocker tagged S2-S4 is
   sent back to its reviewer session, never downgraded (D-086).
3. **Build:** `branch`, real `npm ci --cache ~/.bisellium-evidence/npm-cache`
   in the worktree, `ready` (commit), then the reds and code. When the brief's `Prototype:` line names a series at its signed sha256 that applies at the worktree's HEAD and no red is recorded, `next` names `next <id> --perform --expect reds` (W-326): for each behaviour in order it commits the test patch, records the red with its own ticket on that commit and commits the log alone, then commits the implementation; then the orchestrator records `handoff`, runs `npm run -s bisellium -- ci --opus <id> --studio studio --repo .` in the worktree (the one full suite, in the background) and commits the record and its gate logs (`chore(studio): <id> gates`), as the build order names. Otherwise, when the perform holds, when a required fix stands (D-086 A) or when that `ci --opus` exits non-zero, a Sonnet builder (brief:
   `studio/prompts/builder-brief.md`, filled): reds recorded one
   behaviour at a time on the commit of the previous behaviour, build, gates; then, after recording `handoff`, the same `ci --opus`, the record and its gate logs committed. A fresh
   builder past ~250k; dispatch builders in the background so a Patron
   message cannot cut one off. `next` orders the reds one behaviour at a
   time (W-166, D-036); each `red` needs its own `next` ticket first.
4. **Review:** `next` orders review only when the branch record's automated gates passed at the branch's current source tree, with their logs committed (the builder's `ci --opus`, step 3); no host mint runs before review: the merge queue's `certify` is the one mint, and it replays the reds (D-071 E). `next <id> --perform --chain --budget 400000 --title <t> --body-file <f> --studio studio --repo .`, in one background call, runs the review round and the pr. Codex `gpt-5.6-sol`, round-1 prompt
   `studio/prompts/build-review.md`, filled by the perform; packet
   `review-packet.sh <id> <round> [<prev-verdict-commit>]`; run
   `censor.sh <id> <round>`; the orchestrator records with
   `scripts/record-review.sh <id> <round> <passed|failed> <session>` (`next`,
   `verdict`, `next`, `review`, one commit on the opus branch; the evidence
   copy carries the `next` calls until the D-066 D filing lands). Before any re-review
   the producer checks the fix's census: every path to the input the blocker
   named is closed. Codex runs it in a fresh session, never the reviewer's
   (`~/.bisellium-evidence/codex-passes/fix-census.sh <id> <failed-round>`,
   D-072); an open path goes back to the builder, not to review. It is
   advisory input, not a verdict; W-274 moves it into the review perform.
   No round cap (D-053). A fix round stops before its `ci --opus` until the fix check lists no open path (D-086 D). Only a real defect blocks a build round too (D-084, as D-076 A for spec): wrong behaviour on an input inside the brief's stated domain, a security gap, or missing or false evidence; wrong behaviour on a form the brief's limits exclude or do not list is an advisory the architect may add as a limit or a ruled case.
5. **Merge:** refresh `handoff` (the `bisellium handoff` verb, the record's
   traditio; `next` does not ask for it before `pr`, so do it); record the pass; `pr`; `merge`; `cleanup`.
   With the merge queue live (W-168; `pr` prints `mode: merge-queue`), `pr`
   pushes the reviewed head without a rebase, `merge` enqueues it, and the
   queue's `certify` job mints the merge result (it replays the reds and runs the gates): a moved master needs no
   rebase and no second gate run. In `mode: direct` no `certify` runs, so nothing replays the reds before merge: rebase if master moved, and the builder's `ci --opus` and review follow.
6. **Done:** no `verify` after the merge queue's `certify`: the done perform
   records certify's certificate (D-082 B); only a `kind: ui` opus, which
   certify cannot vouch for, runs `verify <id>` on master (~24 min, nothing
   heavy alongside) when `next` names it; a `docs/SESSION-HANDOFF.md`
   edit may ride the done commit and none is required (W-299; the perform
   runs W-186's rule on the handoff); `next --perform --expect done`
   (commits on `chore/done-<id>`); `next --perform --expect done` again
   (lands).
7. **Daily retro (D-076 F).** The reviewer names each finding's class
   (`<area>×<slug>`, an existing class verbatim where one fits) and severity
   (`S1`-`S4`). When a failing verdict names an S1 class seen before, the fix
   round also fixes its cause (a check rule, brief-admission rule, prompt
   template or hook in the same opus) or files a greenlit high opus for the
   class (D-076 D); wording classes recur as advisories. Once a day the
   producer runs `~/.bisellium-evidence/retro-daily/retro.py` and updates
   `studio/acta/improvements.md`. W-297 makes
   `verdict` and `next` enforce it; until then the producer checks a failing
   verdict's classes with `~/.bisellium-evidence/lesson-census/census.py`.
   After done, `npm run -s bisellium -- tick --studio studio`.

`.claude/` changes stop merge/branch/done for the Patron's command.

## 10. Models

Specs: Claude Opus 5.5 architect drafts and signs (D-072). Spec review,
build review, security, the test check at spec and the fix check before a
re-review: Codex `gpt-5.6-sol` high. Builds: replayed from the
architect's signed prototype (W-326); Claude Sonnet 5.5 where the replay
cannot run, for required fixes and for fix rounds. UI layouts at spec: `gpt-6-astra` medium. Triage: Codex
`gpt-5.6-terra`. Security fixes are mandatory (D-044).

## 11. Standing rules

- Every handoff edit passes `node ~/.bisellium-evidence/handoff-check.mjs .`
  (until W-186 makes it a check rule and a done-step refusal), then an
  independent review (`studio/prompts/handoff-review.md`, Codex terra)
  until it is clean, before it is committed (no round cap, D-053); the
  producer never certifies its own handoff.
- When a brief contradicts itself, take its literal, stricter reading and
  record the flip it failed to name; never rule a softer variant (W-166).
- No shortcuts in CI or tests (Patron, 2026-10-08). CI certifies at least
  what the local mint does; a test row is never removed or weakened to save
  time; a flake is fixed at its cause, never rerun as the remedy. W-178's
  check enforces the row count once built.
- Concurrency readiness is the orchestrator's to manage: one lane until
  W-169 and W-197 land (W-168 landed 2026-10-09; with W-178 to W-183 and
  W-093 alongside); then
  any number of lanes under one orchestrator, whose step scripts print
  one-line results so each lane costs little context;
  the handoff tracks what is left.
- A security finding (CodeQL/GHAS alert or security review) is always
  fixed, never dismissed; extra review rounds or receipts it needs are
  pre-approved.
- A high-severity fix (security, data loss, or a mistake class seen twice)
  is filed greenlit and started without asking; report it only at the
  checkpoint (D-039).
- Every PR's GitHub Advanced Security findings (code-scanning alerts plus
  bot review comments) are checked before merge; any new alert on
  PR-introduced code stops the merge for triage — fix it or record an
  explicit accept with reasoning.
- A task counts as done only once its PR is MERGED and local master is
  fetched afterward; rebase standing work on fetched master before opening
  a new PR; cleanup and "done" follow that fetch, never chain on an earlier
  step.
- An "in flight" claim needs an output-file mtime check and a process check
  before being reported, not a summary written from memory.
- Extend an existing mechanism before adding a parallel one for the same
  purpose (D-042).
- Architecture decisions and UI/UX direction stay the Patron's; UI design
  leadership within that direction delegates to the ui-lead Codex seat
  (`gpt-6-astra`), which drafts layouts and defaults at spec.
- Every Opus dispatch runs on Opus 5.5, never Opus 5; override an agent
  file's model pin if it says otherwise.
- Every subagent dispatch targets ≤500k tokens, the same ceiling as the
  orchestrator session.
- Never start a dispatch chain that might run out of budget mid-flight;
  pause and write the resume state instead.
- When usage limits are tight, run one Claude workstream at a time;
  Codex-tier work may run alongside it without serializing.

## 12. Amendment log

| Date | Change | Authority |
|---|---|---|
| 2026-09-17 | Adopted | Patron |
| 2026-09-18 | Rewritten into enforceable clauses; role named as the Aedile (W-018) | Patron |
| 2026-09-19 | Cascade sizing clause added (D-012) | Patron |
| 2026-09-20 | Backlog ranked by long-term positive gain; a found gap owes a lesson or opus, not handoff prose (unmarked) | Patron |
| 2026-10-08 | Session handoff's standing instructions, environment, opus ladder and models folded in; still-true standing rules folded in from memory | Producer |
| 2026-10-08 | Status and dossier republished by a Haiku subagent, never the orchestrator | Patron |
| 2026-10-08 | Spec review prompt checked in with a round-1 completeness clause (meta-retro) | Patron |
| 2026-10-08 | No shortcuts in CI or tests; concurrency readiness owned by the orchestrator | Patron |
| 2026-10-08 | Producer checks a fix round's census before re-review (W-184 enforces) | Patron |
| 2026-10-08 | Hold PRs while an opus awaits merge; a self-contradicting brief is read literally | Patron |
| 2026-10-08 | Handoff edits pass handoff-check.mjs (W-186 enforces) | Patron |
| 2026-10-08 | Handoff reviewed independently before commit; republish and milestone rules moved in from the handoff | Patron |
| 2026-10-09 | Spec review scope and round cap (D-050, D-051); merge step in queue mode; PR hold rule retired (W-168 live) | Patron |
| 2026-10-10 | Review round caps removed (D-053) | Patron |
| 2026-10-10 | Spec review judges only changed lines (D-054); Ops collegium decreed (D-055) | Patron |
| 2026-10-10 | Spec-review findings block only on substance (D-056) | Patron |
| 2026-10-10 | Specs written ahead of the build (D-057) | Patron |
| 2026-10-10 | Receipt minted before review, as `next` requires | Producer |
| 2026-10-10 | Ops changes are architecture: the Patron approves each Ops spec and its Defaults before `branch` | Patron |
| 2026-10-11 | Step 7 runs `tick` once per opus as Ops' cadence (W-208 Defaults 3) | Patron |
| 2026-10-11 | §9 step 5: the receipt is minted from the opus worktree | Producer |
| 2026-10-11 | §9 step 2: reviewer verdicts carry `--session` (W-215 measures only sessioned rounds) | Producer |
| 2026-10-11 | §9 step 2: where reviewer sessions live; a shape-refused verdict is reissued in its session | Producer (handoff review) |
| 2026-10-13 | §7: one Patron gate at greenlight; pre-`branch` Ops approval only over 3 points or for security/sandbox/branch protection (D-061) | Patron |
| 2026-10-13 | §7: process work capped at one per two product opera, weekly retro; status page frozen (D-061) | Patron |
| 2026-10-13 | §7: the orchestrator session refreshes before 350k (was 500k); subagent dispatches stay at 500k | Patron |
| 2026-10-15 | §9: step 0 names who runs each step (the orchestrator records until W-267); tickets, two-perform rungs, the handoff refresh and the done rung's handoff edit named; step 3's W-166 sentence fixed; Codex Sol the one review gate (D-066) | Patron |
| 2026-10-16 | §7, §9: no per-opus retro; reviewer class tags, and a class seen before is fixed at its cause in the fix round (D-070) | Patron |
| 2026-10-16 | §9, §10: the Opus architect drafts specs; Codex runs the test check at spec and the fix check before a re-review (D-072) | Patron |
| 2026-10-16 | §7: D-071's measure redefined as record-writing actions per opus (D-073) | Patron |
| 2026-10-17 | §7: elapsed cycle minutes are the measure; exit under 150, stop over 180; one builder per opus; a second lane after W-292 and W-179 (D-075) | Patron |
| 2026-10-17 | §9 steps 2 and 7: only real defects block; a second spec review only after a design-changing defect; cause fixes on real-defect recurrence; a daily retro and the improvements tracker (D-076) | Patron |
| 2026-10-16 | §7: the CLI-first block's exit (the hand-steps measure and the trial's four conditions); the dossier republish leaves done and stays at cascade checkpoints (D-071) | Patron |
| 2026-10-16 | §9: the first signed spec is `opus/<id>`'s first commit and `spec/<id>` is retired, so the spec rung takes no landing and step 6 no earlier spec logs (W-293) | Producer |
| 2026-10-18 | §9 steps 3 to 5: review needs the builder's `ci --opus` gate logs at the branch's source tree; no host mint before review; `certify` is the one mint (W-312, D-071 E) | Patron |
| 2026-10-18 | §9 step 6: no `verify` on master after `certify` except for a `kind: ui` opus; the done perform records certify's certificate (D-082 B) | Patron |
| 2026-10-19 | §9 step 4: only a real defect blocks a build review round, as for spec (D-084) | Patron |
| 2026-10-19 | §9 steps 2 and 4: a design-keeping spec blocker goes to the build; S2-S4 blockers are reissued; the fix check runs before a fix round's suite (D-086) | Patron |
| 2026-10-20 | §9 step 6: the done rung asks no handoff edit (W-299, D-077 B) | Patron |
| 2026-10-20 | §9 steps 1, 3 and 4: the architect's dispatch, the first builder brief and the round-1 build review are filled from `studio/prompts/` (W-241 part 1) | Patron |
| 2026-10-20 | §9 steps 0 and 3, §10: the reds and code are replayed from the architect's signed prototype by a reds perform; a builder only where the replay cannot run, for required fixes and for fix rounds (W-326) | Patron |
