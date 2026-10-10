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

## Resume point (2026-10-11)

- **W-215** (review loops converge) is built on `opus/W-215` (`.worktrees/W-215`,
  clean at e6b17493; builder report and evidence `~/.bisellium-evidence/W-215-build/`).
  Revision 3 (two build-found gaps) is signed as spec round 8 there, uncommitted;
  round 9 (Codex session 01a126b2-7335-7da2-86f9-8c58544962ae) failed, recorded
  there. Next: the architect's revision 4, resumed review; then a builder.
- **W-211** (pin `source_excludes`): spec passed, Defaults answered; builds after W-215.
- **W-210, W-212** (CI pins): spec round 4 failed (narrower promise limits);
  revision 3 next, by an architect in `.worktrees/ci-pins-spec` (uncommitted;
  `~/.bisellium-evidence/W-21{0,2}-spec/`), then resume each reviewer's session
  (ids in `~/.bisellium-evidence/W-21{0,2}-specreview/r2/session.log`).
- **W-208** (Ops collegium): branches after W-215 and W-211; PR B after merge.
- Until W-215 lands, later review rounds resume the reviewer's Codex session
  (`codex exec resume <id>`) and take the author's rebuttal before recording.
- W-204: spec passed (round 6), then W-196's admission rules failed it (3).
- Queue review owed: W-202 (ledger page) below W-136 (item 15) and W-138.

## Concurrency readiness

Left before more than one lane (production lex §11 names W-169 and
W-197 as the gates, W-197 landed, and, read strictly, W-093 alongside W-178
to W-183): Queue's multi-lane prep item
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

2a. W-210 — CI refuses a merge path that skips the queue; W-211 — a test
    pins the `source_excludes` list (the two pins the Patron asked for);
    W-212 — CI docs checked against ci.yml (QA now, Ops after W-208);
    W-213 — the retro reads beyond the review findings (wins, time, cost, slips).
3. W-208 — set up the Ops collegium (D-055).
4. W-200 — set up the Chaos collegium (D-052; the architect specs it).
2b. W-215 — review loops converge (resumed reviewer, rebuttal, measured
    targets; Patron 2026-10-11).
5. W-204 — next stops holding a build review after three failed rounds.
6. W-206 — the signed spec rides in the opus's own PR (D-054); W-214 — the
   retro rides in the done PR (Patron 2026-10-11).
7. W-207 — verify after merge reuses the queue's certificate (D-054).
8. W-201 — the mutation check gates build review (D-052).
9. W-185 — records checked once at load (D-049; the architect specs it).
10. W-172, W-171 — high-severity fixes.
11. Multi-lane prep: W-178, W-179, W-180, W-182, W-193, W-181, W-183, then W-169
   (switches lanes on; it waits for W-093, item 13, to land first).
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

- Greenlight W-216 (agents ask each other through the petitio), or let W-215
  ship its rebuttal on plain session resume first? Asked 2026-10-11.
- At the owed queue review: greenlight and rank W-138, W-202, W-217 (budget
  --tokens fix), W-218 (Ops per-step times), W-219 (next waits for the merge-group
  run), W-220 (one-step re-review record), and W-175, W-176 (2026-10-08 lesson audit).
