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

- **W-166** is done, retro filed, pages republished (checkpoint row 61).
  **Next: the Queue below, from item 1** (ladder from step 1).
- Rulings of 2026-10-08 are recorded in D-047..D-049 and the actas 2026-10-08-meta-retro
  and -lesson-audit; new opera W-169..W-192 (W-171, W-172, W-177, W-185,
  W-186 greenlit).
- `.git/worktrees/{W-167,loop-state,cascade-loop}` cannot be pruned
  (sandbox mounts); harmless.

## Concurrency readiness

Left before more than one lane (policy: production lex §11): W-168 and
W-169 (W-169 still in backlog: the Patron greenlights and slots it at the
queue review);
alongside W-178..W-183 and W-093.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable; check for external saves first):
  https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Order of record: `studio/acta/2026-10-05-ranking.md`.

1. W-168 — GitHub CI certifies the merge result (merge queue, master-pinned
   workflow, attested receipt), so a rebase needs no local re-mint (Patron,
   2026-10-08; research in `~/.bisellium-evidence/research-remint/`).
2. W-185 — records checked once at load (D-049, Patron 2026-10-08;
   architecture; the architect specs it).
3. W-186 — a stale handoff is refused (check rule and done-step refusal;
   small).
4. W-172, W-171 — high-severity fixes:
   Date.now polling caught by test.sleep; spec input tables name real
   rejectors.
5. W-068 — task dependencies (the earlier signed
   brief is `~/.bisellium-evidence/partial-specs/W-068.md`: copy it to
   `studio/briefs/W-068.md`, add `Red order: one at a time` (W-166), have
   the architect re-sign it with `verdict --phase spec`, then the spec
   review).
6. W-081, W-099 — high-severity security fixes; W-093 (security review on
   every change).
7. W-158, W-133, W-115, W-117 then W-116, the Seats pass (W-154, W-091,
   W-090), W-143, W-144, W-157, W-145, W-136, W-146, W-160, W-135, then the
   medium and low fixes in `studio/acta/2026-10-06-backlog-triage.md`
   (W-038, W-040, W-045, W-051, W-058, W-066, W-073, W-074, W-080, W-083,
   W-086, W-094, W-098).

Also greenlit, not yet ranked (order them at the queue review): W-070, W-078,
W-113, W-118 (greenlit for its split only: after W-160 and W-068 the
architect splits it and the Patron greenlights each piece), W-147, W-149, W-150, W-151, W-159.

Greenlit 2026-10-08, to be slotted at the Patron's queue review: W-177. Filed to backlog the same day, also for that
review: W-169, W-170, W-173..W-176, W-178..W-184, W-187..W-192.

Not greenlit: W-148, W-155, W-092, W-138, W-122, W-164, W-165 (`review
--fail` without a fresh receipt).

## Open Patron choices

- W-122 or W-138: they measure usage two ways; the Patron picks one
  path, and W-138 is rescoped around it (it also depends on W-136); see
  `studio/acta/2026-10-05-ranking.md` lines 113-116. Both are in backlog.
