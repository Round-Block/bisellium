---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

Current state only, after CLAUDE.md; rules and environment: `studio/leges/production.md`.

## Resume point (2026-10-14)

1. **W-221**, **W-233** part 1, **W-240** and **W-253** (#453, D-062 hotfix) done; the weekly
   retro is filed for all four (no new opera, D-061 §5).
2. **W-246** revision 5 landed (#460; round 8 failed on the landed re-spec gap, now W-256;
   round 10 passed); branched, `ready`, builder.W-246 in `.worktrees/W-246` on behaviours 1–3.
   W-252 stays in backlog. `chore-pr.sh` now stops at the first failed merge-group run.
3. **W-233** is done; its part 2 (the dispatch guard, `docs/design/next-handoff-notes.md`) is not
   yet an opus: file it after W-245's census (Queue item 2).
4. **W-241** part 1 spec passed (untracked), Patron-approved.
5. **Audit's open choices ruled (D-063):** W-242 and W-248 widened, W-254 and W-255 filed,
   W-230 greenlit (`audit-rulings/apply-d063.sh`).
6. **Audits ruled (D-061):** 24 opera halted (`audit-rulings/apply-d061.sh`), lex §7 amended,
   W-251 filed; the Queue below is the new order.
- Checkpoint after every opus: a Haiku agent adds the history rows, runs `build.sh` and
  republishes Status and the dossier (lex §7); last one #459 (cascade 76, W-253).
- `cleanup` on a read-only `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).

## Concurrency readiness

One lane until the multi-lane prep lands (Queue item 6, W-169 last).

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

1. Audit cuts, re-ranked by the ops speed audit (Patron 2026-10-14;
   `~/.bisellium-evidence/ops-speed-audit/report.md`): W-246 — spec review blocks only on
   substance, two-round cap (building), with W-255 — a light brief by the architect's marker;
   W-206 + W-207 + W-214 as one opus — spec in the opus PR (absorbs W-256), done reads
   certify's receipt, retro in the done PR; W-257 — handoff and checkpoint edits ride the done
   PR; W-250 — ci.yml runs `bisellium ci` once, records-only pushes take the short path;
   W-259 — check each tree once, certify is the single mint (pipeline: design to the Patron
   before branch); W-258 — the builder self-reviews once before the first build review;
   W-247 — drop the handoff Resume point and its review; W-223 — the Status page shows the
   ranked queue in plain words (Patron 2026-10-14: an exception to the freeze); W-243 —
   certify judges the diff, not the branch name (D-039 high); W-251 — process work capped,
   weekly retro; W-254 — delete talk and the dailies.
2. W-245 part 1 — census of every provider coupling (the Patron approves the design); then
   W-248 — dead verbs and packages (W-081's injection note rides it), W-249 — lighter tests.
3. W-068 — task dependencies (copy `~/.bisellium-evidence/partial-specs/W-068.md` to
   `studio/briefs/W-068.md`, add `Red order: one at a time`, re-sign, spec review); then the
   W-118 split (M3's exit; absorbs W-169, W-231, W-241 part 2).
4. Milestone exits: W-045 + W-185 — atomic writes, records checked at load (M2); W-099 +
   W-093 — realpath anchor, security review on every change (M8); W-078, W-074, then W-073 —
   greenlight and reply from the console (M4); W-149 + W-150 — outside-adapter test and
   guide (M9); W-159 — model per seat, after W-245 (M6).
5. W-238 — brief admission refuses a red the host replay cannot run; W-242 — drop the
   PreCompact hook; W-239 — `next`'s merge always fast-forwards master; W-241 part 1 —
   leads as agents (specced, approved); W-229, W-172 (high).
6. Multi-lane prep: W-178, W-179, W-180, W-182, W-183, then W-169 (switches lanes on).
7. The rest as ranked 2026-10-11/12 (acta `2026-10-11-patron-queue-review`), halted ids
   dropped: W-225, W-219, W-228, W-227 (high), W-230, W-138, W-217, W-224; W-210, W-213; W-208;
   W-081; W-173, W-174, W-195, W-165, W-190, W-191, W-192, W-194, W-198; W-158,
   W-133, W-115, W-116, W-154, W-091, W-090, W-143, W-144, W-157, W-145, W-136, W-146,
   W-160, W-135; W-038, W-040, W-051, W-058, W-066, W-080, W-086, W-094, W-098; W-175, W-176.

Greenlit, not yet ranked: W-070, W-113, W-147, W-151.

## Open Patron choices
- The 2026-10-11 audit (four rule breaks, eight gaps in 25 commits), `~/.bisellium-evidence/design-notes-1011/`.
