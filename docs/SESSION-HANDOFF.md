---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

Current state only, after CLAUDE.md; rules and environment: `studio/leges/production.md`.

## Resume point (2026-10-13)

0. **W-240** (mints fail since W-236: offline CI cannot run `npm audit`; fix `ci --offline`):
   spec landed (#438), re-signed for red order (round 4 passed); builder on opus/W-240. Patron
   2026-10-13: one-time exception, W-240 lands without its own receipt (decision; waive that gate).
1. **W-221** (pipe-hidden exits): round 5 failed; re-specced under D-059. Built at aa038dc1,
   gates and npm test green (`W-221-build/respec/`); `next` names the builder step (stale
   receipt): the mint `run --sella builder --opus W-221 -- true`, failing until W-240 lands;
   then review round 6 by `~/.bisellium-evidence/W-221-review/r5-run.sh` adapted.
2. **W-236** merged (#436), verified on master; `done` lands with this handoff; retro owed.
3. **W-233**: spec landed (#439), all ten Defaults accepted (Patron 2026-10-13); after
   W-240 lands: D-057 re-check against W-236 and W-240 (ci.ts, ci.yml), then `branch`.
- Dispatch guard: a CLI verb in W-233 part 2 (`docs/design/next-handoff-notes.md`).
- `cleanup` on a read-only `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).

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

1. W-221 — a gate's exit hidden by a pipe in kept scripts (D-039: high, top; re-specced);
   W-233 — the ladder is enforced, not remembered (D-039: high; spec landed);
   W-240 — receipt mints work again (`ci --offline`; D-039 high, blocks all mints);
   W-238 — brief admission refuses a red the host replay cannot run; W-237 — a review
   finding carries its replacement text, applied verbatim it closes (both: fewer spec-review
   rounds, Patron 2026-10-13); W-239 — `next`'s merge always fast-forwards master (Patron);
   then W-229 — verdict refuses a signature next cannot read (D-039, Patron).
1b. W-225, W-219, W-228, W-227 (high), then W-220, W-138, W-222, W-217, W-224
    (acta `2026-10-11-patron-queue-review`).

2a. In this order (the briefs require it): W-210 — CI refuses a merge path that
    skips the queue (the second pin the Patron asked for);
    W-212 — CI docs checked against ci.yml (QA now, Ops after W-208);
    W-213 — the retro reads wins, time, cost and slips from a per-opus step ledger
    and escalates a lesson class seen three times (Patron 2026-10-11).
3. W-208 — set up the Ops collegium (D-055; its brief's PR A, then PR B's moves).
4. W-204 — next stops holding a build review after three failed rounds (the Patron
   reconsiders before it builds: that hold caught W-221 on 2026-10-11).
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

- Leads as real agents (Patron 2026-10-11: eng-lead and qa-lead): the architect's
  design and its six questions, `~/.bisellium-evidence/leads-design/design.md`.
- The 2026-10-11 audit (four rule breaks, eight gaps in 25 commits), `~/.bisellium-evidence/design-notes-1011/`.
- W-230 (impeccable's detector in CI): backlog; the Patron greenlights it, then a
  spec waits for approval of its design and Defaults.
- W-231 (interactive self-refresh): filed, not greenlit until tested
  (`~/.bisellium-evidence/W-231-draft/design-notes.md`).
