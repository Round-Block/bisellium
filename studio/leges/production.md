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
- **Session hygiene.** Refresh before the context nears 500k, at a clean
  point. The restart loop (`~/projects/bisellium/scripts/cascade-loop.sh`)
  automates fresh sessions; never run it while a session is working.
- **Usage.** At ~87% Claude usage (the Patron reports it) start no new Opus
  work unless the Patron says go; never kill a running agent. Prefer Codex
  for drafting (D-027) and reviews when Claude is tight.
- **Checkpoint after every opus:** a history row (`progress-body.html`) and
  the masthead (`body.html`) by a kept script, `build.sh`, republish the
  Status page and the dossier, with a spend line per provider. A
  general-purpose subagent on Haiku republishes (the publish tool makes it
  read every line of a live page it did not publish, ~135k tokens per pair);
  never the orchestrating session. The architecture page is republished the
  same way after any `docs/ARCHITECTURE.md` change. Every new opus gets a
  milestone (`amend <id> --milestone <M> --value <n>`).
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
names each step; `--perform --expect <step>` does it. From a worktree, pass
the main checkout's absolute `--studio`/`--repo`.

1. **Spec:** written ahead of the build where Files owned overlap no opus in
   flight, in a scratch worktree; changed Files owned are re-reviewed before
   `branch` (D-057). Codex `gpt-5.6-sol` drafts (D-027; prompt
   `~/.bisellium-evidence/W-167-draft/prompt.md`); the Opus architect checks
   it against the code and signs (`verdict --phase spec`), uncommitted.
   Tell the architect to name every existing test fixture or assertion the
   change breaks: W-162's builder stopped twice on that.
2. **Spec review (D-046, W-162):** `next` orders it. Codex `gpt-5.6-sol`,
   prompt `studio/prompts/spec-review.md` (filled per round); record with
   `verdict <id> --round <n> --sella spec-reviewer --model gpt-5.6-sol --outcome <passed|failed> --phase spec --from <$TMPDIR copy>`.
   Any brief edit needs a new signature and review. On pass, `next` lands it.
   Reused, unchanged code is one input judged by its exit, one row per
   unchanged job (D-050); an unchanged line inside a changed function is
   reused code too, unless a promise depends on it (D-054). Only substance
   blocks: a path that fails open or a false promise (D-056). No round cap (D-053).
3. **Build:** `branch`, real `npm ci --cache ~/.bisellium-evidence/npm-cache`
   in the worktree, `ready` (commit), then a Sonnet builder (brief model:
   `~/.bisellium-evidence/W-162-build/builder-brief.md`): reds recorded one
   behaviour at a time on the commit of the previous behaviour, build, gates,
   one full `npm test`. Record `handoff` before the review packet. A fresh
   builder past ~250k; dispatch builders in the background so a Patron
   message cannot cut one off. `next` now orders all reds before any
   implementation (phase 1), which conflicts with one-at-a-time; W-166
   settles it.
4. **Review:** Codex `gpt-5.6-sol`, prompt modelled on
   `~/.bisellium-evidence/W-162-review/r1/prompt.md`; packet
   `review-packet.sh <id> <round> [<prev-verdict-commit>]`; run
   `censor.sh <id> <round>`; record `record-review.sh <id> <round> <passed|failed>`
   (a failed round records only the verdict log; W-165). Before any re-review
   the producer checks the fix's census: every path to the input the blocker
   named is closed (W-184 makes it a hold). No round cap (D-053).
5. **Merge:** refresh `handoff`; mint once from the worktree (bare
   `npm run -s bisellium -- run --sella builder --opus <id> --studio studio --repo . -- true`,
   ~15 min); `review-receipt.sh`; record the pass; `pr`; `merge`; `cleanup`.
   With the merge queue live (W-168; `pr` prints `mode: merge-queue`), `pr`
   pushes the reviewed head without a rebase, `merge` enqueues it, and the
   queue's `certify` job certifies the merge result: a moved master needs no
   rebase and no second mint. In `mode: direct`, rebase if master moved and
   mint after it, as before.
6. **Done:** `verify <id>` on master (~11 min); checkpoint script;
   `next --perform --expect done` twice (commit, then land).
7. **Retro:** Codex `gpt-5.6-terra` triage (prompt
   `~/.bisellium-evidence/retro-triage-W-162/prompt.md`), adjust with a kept
   script if needed, `retro --opus <id> --from <file>`, map any new opus to a
   milestone (`amend --milestone --value`), land in a records PR.

`.claude/` changes stop merge/branch/done for the Patron's command.

## 10. Models

Specs: Codex `gpt-5.6-sol` drafts, Claude Opus 5.5 architect signs. Spec
review, build review, security: Codex `gpt-5.6-sol` high. Builds: Claude
Sonnet 5.5. UI layouts at spec: `gpt-6-astra` medium. Triage: Codex
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
