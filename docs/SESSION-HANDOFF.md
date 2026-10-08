---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

What a fresh orchestrating session must know that the code does not say.
Read after CLAUDE.md. Durable rules live in `studio/leges/production.md`;
this file holds only current state. Keep it short; move anything durable
into a lex, a decision or a check rule and delete it here.

Rules, process and environment: studio/leges/production.md.

## Resume point (2026-10-08)

- **W-167** (review loop stops at three failed rounds) merged (#322);
  `verify` and `done` run on branch `chore/done-W-167` in the main checkout.
  Its reds are the original recording: re-recording them at the branch tip
  made the receipt replay them on built code, so they were restored (L-085
  class; W-166 fixes it).
- **W-166** spec: revision 7 signed (round 13), uncommitted in the main
  checkout (`studio/briefs/W-166.md`, `ci/W-166-spec-1..13.log`); Codex spec
  review round 7 next (prompts in `~/.bisellium-evidence/W-166-specreview/`).

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

## Queue

Order of record: `studio/acta/2026-10-05-ranking.md`. Every new opus gets a
milestone (`amend <id> --milestone <M> --value <n>`).

1. W-166 — a recorded failing test must come from the code state its brief
   names (high; L-085; spec review, above).
2. W-168 — GitHub CI certifies the merge result (merge queue, master-pinned
   workflow, attested receipt), so a rebase needs no local re-mint (Patron,
   2026-10-08; research in `~/.bisellium-evidence/research-remint/`).
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
