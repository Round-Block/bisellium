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

1. **W-221** done (#444). **W-240** merged (#441): `next` names `done` (an agent cannot waive
   its review gate under D-060; done lands on the merged, verified tree).
2. **W-233** part 1: review round 1 failed (two findings); fix round built at f5252b04, gates
   and npm test green (`W-233-build/r1fix/`). To do: mint; review round 2 resuming censor session
   01a1351a-e2a3-7c03-8d41-3dedd964a2f1, flagging the new `ticket: held` form (not in the brief).
3. **W-241** part 1 spec passed (untracked), Patron-approved.
4. **Audits ruled (D-061):** 25 opera halted (`audit-rulings/apply-d061.sh`), lex §7 amended,
   W-251 filed; the Queue below is the new order.
- `cleanup` on a read-only `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).

## Concurrency readiness

One lane until the multi-lane prep lands (Queue item 7, W-169 last).

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

Order set by the Patron 2026-10-13 (D-061): in flight, then the audit cuts, then the
milestone exits; lanes later.

1. In flight: W-233 — the ladder is enforced, not remembered (D-039 high; part 1 in review).
2. Audit cuts: W-246 — spec review blocks only on substance, changed lines only, two-round
   cap; W-247 — drop the handoff Resume point and its review;
   W-250 — ci.yml runs `bisellium ci` once, verdict writes the gate; W-243 — certify judges the diff, not the branch name (D-039 high); W-206 + W-207
   + W-214 as one opus — spec in the opus PR, done reads certify's receipt, retro in the done
   PR; W-251 — process work capped, weekly retro.
3. W-245 part 1 — census of every provider coupling (the Patron approves the design); then
   W-248 — dead verbs and packages (W-081's injection note rides it), W-249 — lighter tests.
4. W-068 — task dependencies (copy `~/.bisellium-evidence/partial-specs/W-068.md` to
   `studio/briefs/W-068.md`, add `Red order: one at a time`, re-sign, spec review); then the
   W-118 split (M3's exit; absorbs W-169, W-231, W-241 part 2).
5. Milestone exits: W-045 + W-185 — atomic writes, records checked at load (M2); W-099 +
   W-093 — realpath anchor, security review on every change (M8); W-078, W-074, then W-073 —
   greenlight and reply from the console (M4); W-149 + W-150 — outside-adapter test and
   guide (M9); W-159 — model per seat, after W-245 (M6).
6. W-238 — brief admission refuses a red the host replay cannot run; W-242 — drop the
   PreCompact hook; W-239 — `next`'s merge always fast-forwards master; W-241 part 1 —
   leads as agents (specced, approved); W-229, W-172 (high).
7. Multi-lane prep: W-178, W-179, W-180, W-182, W-183, then W-169 (switches lanes on).
8. The rest as ranked 2026-10-11/12 (acta `2026-10-11-patron-queue-review`), halted ids
   dropped: W-225, W-219, W-228, W-227 (high), W-138, W-217, W-224; W-210, W-213; W-208,
   W-223; W-081; W-173, W-174, W-195, W-165, W-190, W-191, W-192, W-194, W-198; W-158,
   W-133, W-115, W-116, W-154, W-091, W-090, W-143, W-144, W-157, W-145, W-136, W-146,
   W-160, W-135; W-038, W-040, W-051, W-058, W-066, W-080, W-086, W-094, W-098; W-175, W-176.

Greenlit, not yet ranked: W-070, W-113, W-147, W-151.

## Open Patron choices
- Still open from the audit (`overengineering-audit/report.md`): hooks (C1), `talk` and its
  harnesses (C7), ~45 check rules on unused records (P6), a lighter brief template (P8).
- The 2026-10-11 audit (four rule breaks, eight gaps in 25 commits), `~/.bisellium-evidence/design-notes-1011/`.
- W-230 (impeccable's detector in CI): backlog; the Patron greenlights it, then a
  spec waits for approval of its design and Defaults.
