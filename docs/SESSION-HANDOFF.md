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

## Resume point (2026-10-08, session refresh)

- **W-166** (a recorded red certifies the tree its brief names) is done
  (PR 347; checkpoint row 61). Four build-review rounds, the fourth granted
  by the Patron (D-048). **Next: its retro** (ladder 7; `next` holds new
  work until filed), then republish Status and the dossier with a **Haiku
  subagent** (production lex §7), then **W-168**.
- Hold every PR while an opus sits between a passing review and its merge
  (a docs PR forced W-166's second mint).
- Decided today (Patron): D-047 and its audit (every lesson names a fix,
  a decline or obsolete; acta 2026-10-08-lesson-audit); D-049 / W-185
  (records checked once at load; queued after W-168; architecture). Filed:
  W-169 (lanes under one orchestrator), W-170, W-171, W-172 (greenlit,
  high), W-173..W-184 (W-177 greenlit). Meta-retro: acta
  2026-10-08-meta-retro and https://claude.ai/artifact/VkM85if6j7eiucAKcCCzgV.
- Spec reviews use `studio/prompts/spec-review.md`. Before any re-review
  the producer checks the fix's census (lex §9 step 4; W-184 enforces).
  When a brief contradicts itself, take its literal, stricter reading.
- `.git/worktrees/{W-167,loop-state,cascade-loop}` cannot be pruned
  (sandbox mounts; "Device or resource busy"); harmless.

## Concurrency readiness (Patron, 2026-10-08)

One lane until these land: W-168 (CI certifies the merge result, no less
than the local mint), W-169 (lanes under one orchestrator: file-overlap
refusal, a handoff section per lane, retro hold scoped).
Alongside: W-178 (test count never drops), W-179 (faster next.test.ts, no
row cut), W-180 (no-vendor flake fixed at cause), W-181 (checkpoint pages
generated from records), W-182 (smoke suite on a free port), W-093
(security review per change), W-183 (a host queue for heavy jobs, so n lanes share one machine). One orchestrator for all lanes; step scripts print one-line results. Checked fine: lesson ids (ref-aware
allocator), the vendor-sentinel lock (per worktree), the served e2e port.

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

1. W-168 — GitHub CI certifies the merge result (merge queue, master-pinned
   workflow, attested receipt), so a rebase needs no local re-mint (Patron,
   2026-10-08; research in `~/.bisellium-evidence/research-remint/`).
2. W-185 — records checked once at load (D-049, Patron 2026-10-08;
   architecture; the architect specs it).
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
  runs check without `--repo` and reports a false blocking problem;
  `next --perform --expect spec` stages only the newest signature and review
  log, dropping every earlier spec round (W-167 rounds 1-8 and W-166 rounds
  1-12 had to be committed by hand, PRs 321 and this one); `verify` refuses
  once the checkpoint's `docs/` edits exist, so verify before writing them.
