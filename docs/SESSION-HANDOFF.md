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

## Resume point (2026-10-10)

- W-196 is done (PR 390): review round 1 passed, CodeQL then held the merge on
  two ReDoS alerts; a security fix round (three regexes made linear) passed
  round 2. Checkpoint row 67. Retro filed (L-125..L-128, no new opus).
- **Next:** W-205 (CI once per merge). Revision 4 (citations only, ADOPTION.md
  lines shifted) passed spec review round 8 and is on master; `branch` next.
- W-209 (checkpoint pages count as records): spec signed on master (rev 3).
  Before its build the producer lands a records PR adding the eight-page
  `source_excludes` list (its Default 2; exact YAML in its Interfaces), after
  W-205 is done. Its ci-scope.mjs header line 2 and ADOPTION's W-203
  paragraph are re-reviewed against W-205 first (D-057 §3); its stage C row
  count becomes 17.
- Patron 2026-10-10: Ops changes are architecture (lex §7). W-205 and W-209
  approved as specced; follow-ups W-210 (CI refuses a merge path outside the
  queue) and W-211 (the source_excludes list is pinned) filed and greenlit.
  W-208 (Ops collegium) is in spec revision; its Defaults go to the Patron.
- W-204's brief now fails admission (no read citation; two bare `always`):
  the architect revises it before it branches.
- A queue review is owed: it places W-202 (the ledger opening page) after
  W-136 and W-138, as the Patron ruled 2026-10-10.
- `.git/worktrees/{W-167,W-196,loop-state,cascade-loop}` cannot be pruned
  (sandbox mounts); harmless.

## Concurrency readiness

Left before more than one lane (production lex §11, read strictly: it
names W-093 alongside W-178 to W-183): Queue's multi-lane prep item
(W-169 last) and W-093; work stays on one lane until both land.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable):
  https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

The ranked order, Patron 2026-10-09 (recorded in
`studio/acta/2026-10-09-queue-review.md`). Items 1-8 were added or moved
since (D-052 to D-056), slotted by the producer as a default the Patron
may veto. One-line descriptions of items 9-15 are in that acta.

1. W-205 — CI runs once per merge, in the queue (D-054; moved to first
   2026-10-10: the Patron named the repeated CI runs the priority for cadence).
2. W-209 — checkpoint pages count as records, so done and retro PRs take the
   fast CI path (Patron 2026-10-10).
2a. W-210, W-211 — the two pins the Patron asked for with W-205 and W-209;
    W-212 — CI docs checked against ci.yml (QA now, Ops after W-208);
    W-213 — the retro reads beyond the review findings (wins, time, cost, slips).
3. W-208 — set up the Ops collegium (D-055).
4. W-200 — set up the Chaos collegium (D-052; the architect specs it).
5. W-204 — next stops holding a build review after three failed rounds.
6. W-206 — the signed spec rides in the opus's own PR (D-054).
7. W-207 — verify after merge reuses the queue's certificate (D-054).
8. W-201 — the mutation check gates build review (D-052).
9. W-185 — records checked once at load (D-049; the architect specs it).
10. W-172, W-171 — high-severity fixes.
11. Multi-lane prep: W-178, W-179, W-180, W-182, W-193, W-181, W-183, then W-169
   (switches lanes on, once W-093 has landed).
12. W-068 — task dependencies (signed brief to restore:
   `~/.bisellium-evidence/partial-specs/W-068.md` → `studio/briefs/W-068.md`,
   add `Red order: one at a time`, architect re-signs, then spec review).
13. W-081, W-099 — security fixes; W-093 (security review on every change).
14. W-173, W-174, W-184, W-195; then W-164, W-165, W-187, W-189, W-190,
    W-191, W-192, W-194, W-198.
15. W-158, W-133, W-115, W-117 then W-116, the Seats pass (W-154, W-091,
    W-090), W-143, W-144, W-157, W-145, W-136, W-146, W-160, W-135, then
    the medium and low fixes W-038, W-040, W-045, W-051, W-058, W-066,
    W-073, W-074, W-080, W-083, W-086, W-094, W-098.

Greenlit, not yet ranked (next queue review): W-070, W-078, W-113,
W-118 (split only, after W-160 and W-068; the Patron greenlights each
piece), W-147, W-149, W-150, W-151,
W-159, W-177.

## Open Patron choices

None.
