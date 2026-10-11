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

Build lane:
1. **W-221** (pipe-hidden exits), `opus/W-221` at 7ee7e677 (`.worktrees/W-221`):
   mint a receipt, then build review round 4 in the resumed censor session
   (`--session` in ci/W-221-review-3.log). Rounds 1-3 failed (round 2 recorded
   passed: its blocker cited no brief line). Packet: `scripts/review-packet.mjs
   --round 4` plus the r1 packet's files in `~/.bisellium-evidence/W-221-review/`;
   fix-round reds are kept in `W-221-build/r{1,2,3}fix/` (`red` would overwrite
   01.log, W-225). Until W-221 merges, record reviews by hand with `--session`;
   after, a records PR repoints the lex and this file to its `scripts/`.
2. **W-229** (signed): a D-057 re-review after W-221 merges (both edit ADOPTION),
   then `branch`. Then Queue 1b, whose items still need specs.
- A reviewer verdict refused for format (an `## Earlier findings` line without
  `- `, or naming a non-standing blocker) is reissued in the same session.
- Reviewer sessions: `~/.bisellium-evidence/W-<id>-specreview/r*/session.log`
  (`multilane-spec/{review,resume}.sh` there run and resume them).
- `cleanup` fails on the sandbox's read-only `.git/worktrees/<name>/`: delete its
  `HEAD`, rerun `cleanup`; the Patron prunes outside the sandbox (W-227).

## Concurrency readiness

One lane until Queue 8 lands (the multi-lane prep, W-169 last).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable):
  https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Ranked. Item descriptions for the older items:
`studio/acta/2026-10-09-queue-review.md`.

1. W-221 — a gate's exit hidden by a pipe in kept scripts (D-039: high, top);
   then W-229 — verdict refuses a signature next cannot read (D-039, Patron).
1b. W-225, W-219, W-228, W-227 (high), then W-220, W-138, W-222, W-217, W-224
    (acta `2026-10-11-patron-queue-review`).

2a. In this order (the briefs require it): W-210 — CI refuses a merge path that
    skips the queue (the second pin the Patron asked for);
    W-212 — CI docs checked against ci.yml (QA now, Ops after W-208);
    W-213 — the retro reads wins, time, cost and slips from a per-opus step ledger
    and escalates a lesson class seen three times (Patron 2026-10-11).
3. W-208 — set up the Ops collegium (D-055; its brief's PR A, then PR B's moves).
4. W-204 — next stops holding a build review after three failed rounds.
5. W-223 — the Status page shows the ranked queue (Patron 2026-10-11).
   W-206 — the signed spec rides in the opus's own PR (D-054); W-214 — the
   retro rides in the done PR (Patron 2026-10-11).
6. W-207 — verify after merge reuses the queue's certificate (D-054).
7. W-201 — the mutation check gates build review (D-052).
8. Multi-lane prep: W-178, W-179, W-180, W-182, W-193, W-181, W-183, W-093
   (security review on every change), then W-169 (switches lanes on). Designs
   approved; every Default answered.
9. W-200 — set up the Chaos collegium (D-052; the architect specs it).
10. W-185 — records checked once at load (D-049; the architect specs it).
11. W-172, W-171 — high-severity fixes.
12. W-068 — task dependencies: copy `~/.bisellium-evidence/partial-specs/W-068.md` to
   `studio/briefs/W-068.md`, add `Red order: one at a time`, re-sign, spec review.
13. W-081, W-099 — security fixes.
14. W-173, W-174, W-184, W-195; then W-164, W-165, W-187, W-189, W-190,
    W-191, W-192, W-194, W-198.
15. W-158, W-133, W-115, W-117 then W-116, the Seats pass (W-154, W-091,
    W-090), W-143, W-144, W-157, W-145, W-136, W-146, W-160, W-135, then
    the medium and low fixes W-038, W-040, W-045, W-051, W-058, W-066,
    W-073, W-074, W-080, W-083, W-086, W-094, W-098; then W-175, W-176.

Greenlit, not yet ranked (next queue review): W-070, W-078, W-113, W-118 (split
only, after W-160 and W-068; each piece greenlit), W-147, W-149, W-150, W-151, W-159, W-177.

## Open Patron choices

- W-230 (impeccable's detector in CI): needs a spec, then the Patron's approval.
- W-231 (interactive self-refresh): filed, not greenlit until tested
  (`~/.bisellium-evidence/W-231-draft/design-notes.md`).
- Deferred: W-216 until W-169; W-218 with W-213; W-202, W-148 after W-230.
