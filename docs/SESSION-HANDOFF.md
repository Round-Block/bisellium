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

1. **W-240** (#441) and **W-221** (#442): merged and verified on master; `done` lands with this
   handoff; retros owed (W-221: six build rounds before the D-059 re-spec).
2. **W-236** done (#440); retro filed (L-152..L-159; W-244 to backlog: exercise a changed
   CI step list in the host recomputation before merge, the class that broke every mint).
3. **W-233** part 1: building on opus/W-233 (D-057 re-check: branch as is). b1-b3 built,
   reds 01-03; a fresh builder on b4, b5, docs and gates
   (`~/.bisellium-evidence/W-233-build/handover-b4.md`). After it: re-sign brief:179's
   b3 subcase sentence (architect ruling `W-233-build/b3-ruling.md`), one spec review round.
4. **W-241** part 1: spec passed (`ci/W-241-spec-4.log`, untracked until landed); the Patron
   approved the split, the template names and blocking (2026-10-13).
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

Order set by the Patron 2026-10-13: in flight, then fewer rounds, then lanes.

1. W-233 — the ladder is enforced, not remembered (D-039 high; spec landed);
   W-243 — certify judges the diff, not the branch name (D-039 high; uncertified path).
2. W-238 — brief admission refuses a red the host replay cannot run; W-237 — a review
   finding carries its replacement text, applied verbatim it closes.
3. W-242 — drop the PreCompact hook (no compaction); W-239 — `next`'s merge always
   fast-forwards master.
4. Multi-lane prep: W-178, W-179, W-180, W-182, W-193, W-181, W-183, W-093
   (security review on every change), then W-169 (switches lanes on). Designs
   approved; every Default answered.
5. W-241 — leads as agents, prompts versioned (part 1 specced, approved); W-231 —
   the orchestrator refreshes itself by handoff.
6. W-229 — verdict refuses a signature next cannot read (D-039, Patron);
   W-225, W-219, W-228, W-227 (high), then W-220, W-138, W-222, W-217, W-224
   (acta `2026-10-11-patron-queue-review`).
7. In this order (the briefs require it): W-210 — CI refuses a merge path that skips
   the queue; W-212 — CI docs checked against ci.yml; W-213 — the retro reads a
   per-opus step ledger and escalates a class seen three times (Patron 2026-10-11).
8. W-208 — set up the Ops collegium (D-055; PR A, then PR B's moves); W-204 — next
   stops holding a build review after three failed rounds (Patron reconsiders first);
   W-223 — Status page shows the queue; W-206 — the spec rides in the opus's PR
   (D-054); W-214 — the retro rides in the done PR; W-207 — verify reuses the
   queue's certificate (D-054); W-201 — the mutation check gates build review (D-052).
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
