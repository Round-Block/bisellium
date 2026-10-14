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

0. **Rulings applied (D-064, PR #471):** 16 opera halted, 15 titles amended, W-268 filed (certify
   rules, after W-243); the retro rides the done PR (W-251 keeps the process cap only). **Step tickets
   are now required:** every record write follows a `next` call for that step; the session scripts in
   `~/.bisellium-evidence` (`record-review.sh`, `spec-review-*.sh`, review `r*-run.sh`) must call
   `next` first. The orchestrator dispatches a ladder-runner subagent per opus and a clerk for
   records (W-267 enforces later).
1. Done this week: W-221, W-233 part 1, W-240, W-253, W-246 (retros filed).
2. **W-265** (host red replay ignores environment words inside the failing test's own
   assertion block; Patron approved design + Defaults after a Fable audit) is built at aeeb15e8
   in `.worktrees/W-265` (gates green). Next: mint (`npm run -s bisellium -- run --sella builder
   --opus W-265 --studio studio --repo . -- true` from the worktree), Codex build review (model:
   `~/.bisellium-evidence/W-246-review/r1-run.sh`), PR, merge, done, retro, checkpoint.
   Then **W-255** (light brief; built, review not yet run): rebase `opus/W-255` onto master,
   re-mint from its worktree (red 2 then accepted), fix `~/.bisellium-evidence/W-255-review/r1-run.sh`
   (backticks in its "Look hardest" item 3 were eaten: restore `bisellium red` and `xbisellium`),
   review, PR (needs the Patron: ADOPTION.md, leges). Then **W-260** (spec landed): branch, build.
   W-246 done (#462); W-266 now rides W-229.
   Use `npm run -s bisellium --`: the `bisellium` on PATH runs `~/projects/bisellium-guard` (stale).
   Kept scripts: `~/.bisellium-evidence/{spec-review-first,spec-review-later,retro-triage}.sh`,
   `retro-adjust.py`, `record-review.sh`, `chore-pr.sh`; a worktree needs `cp -a ../../node_modules`.
   Running at refresh (Patron 2026-10-14): Fable lessons→checks pass
   (`~/.bisellium-evidence/lessons-to-checks/report.md`) and Astra's W-223 draft
   (`~/.bisellium-evidence/W-223-draft/W-223-draft.md`); bring both to the Patron.
   W-265 spec logs 1–4 sit untracked: commit them with its done record.
3. **W-233** is done; its part 2 is W-267 (the dispatch guard) and W-268 (the certify rules, after W-243).
4. **W-241** part 1 spec passed (untracked), Patron-approved.
5. Rulings: D-064 (backlog audit), D-063 (audit choices), D-061 (24 opera halted, lex §7); `audit-rulings/apply-d06{1,3,4}.sh`.
- Checkpoint after every opus: a Haiku agent adds the history rows, runs `build.sh` and
  republishes Status and the dossier (lex §7); last one #465 (cascade 77, W-246).
- `cleanup` on a read-only `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable):
  https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Ranked (Patron 2026-10-13, D-061: in flight, audit cuts, milestone exits, lanes later; one lane
until W-169 lands). Older items: `studio/acta/2026-10-09-queue-review.md`.

1. Audit cuts, re-ranked by the ops speed audit (Patron 2026-10-14;
   `~/.bisellium-evidence/ops-speed-audit/report.md`): W-265 — the host's red replay judges
   environment words outside the failing test's own assertion (building; unblocks W-255), then W-098 (reuses its TAP-block parser); W-255 — a light brief by the
   architect's marker (built; mint waits on W-265); W-260 — build verdicts reconcile after rulings (greenlit
   by the spec-review cap's retro; spec passed, landed); W-252 — the spec-round counter refuses malformed history (built as W-185's verdict-log loader in @bisellium/schema)
   (greenlit by the same retro);
   W-206 + W-214 as one opus — spec in the opus PR (spec phase, handoff and re-spec), retro in
   the done PR (D-064 B); W-257 — handoff and checkpoint edits ride the done
   PR; W-267 — the dispatch guard: the orchestrator session cannot run ladder writes itself; W-250 — ci.yml runs `bisellium ci` once, records-only pushes take the short path;
   W-259 — check each tree once, certify is the single mint (pipeline: design to the Patron
   before branch); W-258 — the builder self-reviews once before the first build review;
   W-247 — drop the handoff Resume point and its review; W-223 — the Status page shows the
   ranked queue in plain words (Patron 2026-10-14: an exception to the freeze); W-243 —
   certify judges the diff, not the branch name (D-039 high), then W-268 — the certify rules; W-251 — process work capped (the retro half is dropped); W-254 — delete talk and the dailies.
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
6. Multi-lane prep: W-178, W-179, W-182, W-183, then W-169 (switches lanes on); W-263 becomes
   W-169's subtask after W-257; W-261 after W-169, W-183 and
   W-219, narrowed to Patron-reply, verdict, certificate, merge and dependency waits.
7. The rest as ranked 2026-10-11/12 (acta `2026-10-11-patron-queue-review`), halted ids
   dropped: W-219, W-228, W-227 (high), W-230, W-138, W-217; W-210, W-213; W-208;
   W-081; W-173, W-174, W-195, W-165, W-190, W-198; W-158,
   W-133, W-115, W-116, W-154, W-091, W-090, W-143, W-144, W-157, W-145, W-136, W-146,
   W-160, W-135; W-040, W-051, W-094; W-175, W-176; W-216.

Greenlit, not yet ranked: W-070, W-113, W-147, W-151; W-269, W-270, W-271, W-272, W-273 — the five lessons-to-checks checks (D-065), in its rank order.

## Open Patron choices
- The 2026-10-11 audit (four rule breaks, eight gaps in 25 commits), `~/.bisellium-evidence/design-notes-1011/`.
