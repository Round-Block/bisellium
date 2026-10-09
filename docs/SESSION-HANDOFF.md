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

## Resume point (2026-10-09)

- **W-168** is done, retro filed, pages republished (row 62 of
  `docs/design/dossier/progress-body.html`);
  the merge queue is live on master.
  **Next: W-197** (building on `opus/W-197`; review round 1 passed; mint,
  then `pr` and `merge` in queue mode). It is the first opus whose `certify`
  job runs the full mint on a merge group: watch that run. After it merges,
  ask the Patron to turn on code-owner review, then the Queue from item 2.
- `.git/worktrees/{W-167,loop-state,cascade-loop}` cannot be pruned
  (sandbox mounts); harmless.

## Concurrency readiness

Left before more than one lane (production lex §11): W-197, and Queue
item 6 (multi-lane prep, W-169 last); W-093 is item 8.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable; check for external saves first):
  https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

The ranked order, Patron 2026-10-09 (recorded in
`studio/acta/2026-10-09-queue-review.md`).

1. W-197 — `.github/` changes need the Patron's approval (building; after
   merge the Patron turns on code-owner review).
2. W-196 — spec reviews converge in fewer rounds.
3. W-185 — records checked once at load (D-049; the architect specs it).
4. W-186 — a stale handoff is refused.
5. W-172, W-171 — high-severity fixes.
6. Multi-lane prep: W-178, W-180, W-182, W-193, W-181, W-183, then W-169
   (switches lanes on).
7. W-068 — task dependencies (signed brief to restore:
   `~/.bisellium-evidence/partial-specs/W-068.md` → `studio/briefs/W-068.md`,
   add `Red order: one at a time`, architect re-signs, then spec review).
8. W-081, W-099 — security fixes; W-093 (security review on every change).
9. W-173, W-174, W-184, W-195; then W-164, W-165, W-187, W-189, W-190,
   W-191, W-192, W-194, W-198.
10. W-158, W-133, W-115, W-117 then W-116, the Seats pass (W-154, W-091,
    W-090), W-143, W-144, W-157, W-145, W-136, W-146, W-160, W-135, then
    the medium and low fixes W-038, W-040, W-045, W-051, W-058, W-066,
    W-073, W-074, W-080, W-083, W-086, W-094, W-098.

Greenlit, not yet ranked (next queue review): W-070, W-078, W-113,
W-118 (split only, after W-160 and W-068; the Patron greenlights each
piece), W-147, W-149, W-150, W-151,
W-159, W-177.

## Open Patron choices

- W-138 is rescoped around usage read from harness logs (W-122 declined,
  2026-10-09); it also depends on W-136. Its rescope comes to the Patron.
