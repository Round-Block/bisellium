---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

What a fresh orchestrating session must know that the code does not say.
Read after CLAUDE.md. Keep it short; move anything durable into a lex, a
decision or a check rule and delete it here.

## Resume point (2026-10-07)

- **W-167** (review loop stops at three failed rounds; the Patron's OK buys
  one more; a whole-class blocker is fixed at the input boundary) is built,
  not reviewed. Worktree `.worktrees/W-167`, branch `opus/W-167` (unpushed):
  tests d953417, reds 1-5 f6aa506, build 3ebdd67..abfe5ac (b1-b5, docs, fix).
  Full `npm test` exit 0; gates under `~/.bisellium-evidence/W-167-build/`
  all 0 except `check-studio.exit` 1 (compare with `check-studio-master.log`).
  The phase-2 builder's final report was lost (its call was cut off when the
  Patron sent a message), so audit before review: gate logs,
  `accept/`, `accept/next-test-removed-lines.txt` (4 test lines removed:
  justify or restore), and phase 1's notes: it dropped the brief's
  "unreadable `ci/`" hold row from b1's test, and recorded all five reds on
  the test commit (W-162 recorded them one behaviour at a time; check each
  red is genuine). Next: audit, `handoff`, Codex review round 1 (ladder 4).
- Run long builder dispatches in the background, so a Patron message does
  not land on a running foreground call.
- Codex runs inside the Bash sandbox with `allowed_domains`
  `api.openai.com`, `chatgpt.com`, `auth.openai.com`; never unsandboxed.
- `next` asks for a handoff before it names the architect after a failed
  spec review ("stale handover"); dispatch the architect directly instead
  of writing a handoff onto master's record.

## Standing instructions (Patron)

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
  Status page and the dossier, with a spend line per provider.
- Never relay a mid-turn Patron message into a running agent.
- epoch0 (`~/projects/epoch0`) is a reference instance only; never modify it.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture (republish after `docs/ARCHITECTURE.md` changes):
  https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable; check for external saves first):
  https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f
- A publish refused for an unviewed live version: diff it against the last
  committed build; if only generated data differs, read it in full and
  publish again.

## Environment

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
  (no git, node servers or browsers inside it).

## Opus ladder

`npm run -s bisellium -- next <id> --budget 400000 --studio studio --repo .`
names each step; `--perform --expect <step>` does it. From a worktree, pass
the main checkout's absolute `--studio`/`--repo`.

1. **Spec:** Codex `gpt-5.6-sol` drafts (D-027; prompt
   `~/.bisellium-evidence/W-167-draft/prompt.md`); the Opus architect checks
   it against the code and signs (`verdict --phase spec`), uncommitted.
   Tell the architect to name every existing test fixture or assertion the
   change breaks: W-162's builder stopped twice on that.
2. **Spec review (D-046, W-162):** `next` orders it. Codex `gpt-5.6-sol`,
   prompt `~/.bisellium-evidence/W-167-specreview/r1/prompt.md`; record with
   `verdict <id> --round <n> --sella spec-reviewer --model gpt-5.6-sol --outcome <passed|failed> --phase spec --from <$TMPDIR copy>`.
   Any brief edit needs a new signature and review. On pass, `next` lands it.
3. **Build:** `branch`, real `npm ci --cache ~/.bisellium-evidence/npm-cache`
   in the worktree, `ready` (commit), then a Sonnet builder (brief model:
   `~/.bisellium-evidence/W-162-build/builder-brief.md`): reds recorded one
   behaviour at a time on the commit of the previous behaviour, build, gates,
   one full `npm test`. Record `handoff` before the review packet. A fresh
   builder past ~250k.
4. **Review:** Codex `gpt-5.6-sol`, prompt modelled on
   `~/.bisellium-evidence/W-162-review/r1/prompt.md`; packet
   `review-packet.sh <id> <round> [<prev-verdict-commit>]`; run
   `censor.sh <id> <round>`; record `record-review.sh <id> <round> <passed|failed>`
   (a failed round records only the verdict log; W-165). Three failed rounds,
   then ask the Patron.
5. **Merge:** rebase if master moved; refresh `handoff`; mint once from the
   worktree (bare `npm run -s bisellium -- run --sella builder --opus <id> --studio studio --repo . -- true`,
   ~15 min); `review-receipt.sh`; record the pass; `pr`; wait for CI; `merge`;
   `cleanup`.
6. **Done:** `verify <id>` on master (~11 min); checkpoint script;
   `next --perform --expect done` twice (commit, then land).
7. **Retro:** Codex `gpt-5.6-terra` triage (prompt
   `~/.bisellium-evidence/retro-triage-W-162/prompt.md`), adjust with a kept
   script if needed, `retro --opus <id> --from <file>`, map any new opus to a
   milestone (`amend --milestone --value`), land in a records PR.

`.claude/` changes stop merge/branch/done for the Patron's command.

## Models

Specs: Codex `gpt-5.6-sol` drafts, Claude Opus 5.5 architect signs. Spec
review, build review, security: Codex `gpt-5.6-sol` high. Builds: Claude
Sonnet 5.5. UI layouts at spec: `gpt-6-astra` medium. Triage: Codex
`gpt-5.6-terra`. Security fixes are mandatory (D-044).

## Queue

Order of record: `studio/acta/2026-10-05-ranking.md`. Every new opus gets a
milestone (`amend <id> --milestone <M> --value <n>`).

1. W-167 (in spec, above).
2. W-166 — a recorded failing test must come from the code state its brief
   names (high; L-085).
3. W-068 — task dependencies (signed spec in
   `~/.bisellium-evidence/partial-specs/`; copy into `studio/`, then the
   spec review).
4. W-081, W-099 — high-severity security fixes.
5. W-158, W-133, W-115, W-117 then W-116, the Seats pass (W-154, W-091,
   W-090), W-143, W-144, W-157, W-145, W-136, W-146, W-160, W-135, then the
   medium and low fixes in `studio/acta/2026-10-06-backlog-triage.md`.

Not greenlit: W-148, W-155, W-092, W-138, W-122, W-164, W-165 (`review
--fail` without a fresh receipt).

## Open items

- Follow-ons from W-162: UI opera hold at spec while the spec reviewer is
  set (the verdict writer reserves UI spec verdicts for ui-lead); `next`'s
  stale-handover hold after a failed spec review.
- To file: a faster `packages/cli/src/next.test.ts` (most of the suite's
  ~11 min); evidence commits and the review packet as a verb; `/api/health`
  runs check without `--repo` and reports a false blocking problem.
