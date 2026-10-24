---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

Current state only, after CLAUDE.md. Rules: `studio/leges/production.md`.

## Boot (every fresh session, before any dispatch)

1. Read lex `studio/leges/production.md` §1-§8 and §10-§11; the SessionStart hook injects §9 and its runbook. The Patron's installed `bisellium` must be at master for the hook to show it.
2. Run: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium -- next --all --studio studio --repo .` (read-only); `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles. A dispatched `ladder-runner` runs every ladder record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) with the exact command, never the main thread. Engineering: Sonnet builders (background), the Opus 5.5 architect, Codex `gpt-5.6-sol` the review gate (D-066 C, D-072). `kind: ui`: Codex Sol drafts and signs, Claude Opus 5.5 reviews the spec, Codex `gpt-5.6-terra` builds, a fresh Sol session reviews the build (D-091 A, D-099). `clerk` edits text only.
4. Known traps until their filings land:
- Standing (the W-323 pattern): certify runs master's host runner, so a change to that runner is judged by the old one at its own merge: split it out and land it first. The mint runs from the opus worktree with `--studio studio --repo .`.
- `next` holds a signature or red on a stale handover: `bisellium handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` too, needs a `next` just before it at the same head (tell the builder; its brief forbids `next`). Sign findings as `n. advisory — … — check: …` or `No findings`.
- A ui opus's master `verify` rewrites its committed `studio/ci/<id>-*-<tree8>.log` (W-318, halted): copy them aside, `git restore` them, then run the done perform. `verify` refuses a dirty tree: write checkpoint and handoff edits after it passes. One heavy job at a time (D-075 F): a verify beside a full test run times out; during a verify, no untracked opus record and no master move.
- A new opus record lands in the same PR as its Queue line. Prompts with backticks go in a kept file, never an unquoted heredoc.
- An agent session cannot pull a merged `.claude/` change (read-only mount; restore what a failed pull applied): the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` (W-239). Code-owner review gates only PRs touching `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`; pushing dismisses an approval, so re-request the Patron's review (`gh pr edit <n> --add-reviewer edckt`).
- A build verdict's `## Earlier findings` may name only the previous round's own findings; spec review is capped at two rounds (D-061 §4). A subagent running a kept record script is refused by the auto-mode classifier: stop and report, no retry via another agent.
- `--expect pr --body-file` takes a file under the repo or `$TMPDIR` only. `--expect spec` is two performs. Evidence copies of the kept scripts carry the `next` calls; the `scripts/` copy still lacks them. Uncommitted tracked edits in the main checkout block the spec and merge performs' fast-forward: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`, drop by tag.
- A merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`. A queued PR shows no auto-merge request: check `isInMergeQueue` (gh api graphql) before touching it. Records PRs use `--auto` without `--squash`.
- An Artifact publish refused for a newer live version is a version conflict, not a permission refusal: read the live page, merge, publish. The Status page's live version carries edits the build lacks: its republish needs the Patron until W-283. An evidence-only fix under `studio/ci/` needs one empty marker commit naming it before next orders the re-review, until W-378. Until W-370, a done perform refused on GitHub's artifact host reruns once with exactly that host named (never a wildcard or a settings edit, D-106 C); one the auto-mode classifier refuses, the Patron runs with `!`.
- A ladder-runner runs a land or merge perform in the foreground until W-372 lands (D-106 D). Codex UI builders get `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'` until W-371 lands (D-106 D).
5. Standing until their opus lands:
- D-085 F rides the fix census and the daily retro.
- Records dates are UTC; the Patron reads times in SGT (UTC+8). The trial (lex §7) counts from the first opus after W-292.
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review prompt `studio/prompts/spec-review.md`; spec review spec-review-d076/r2-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w268.py (row 113, copy to a new script per row); daily retro python3 -I retro-daily/retro.py . <date> --append (paths under ~/.bisellium-evidence/).
7. Use `npm run -s bisellium --` (the `bisellium` on PATH is a stale install). `cleanup` busy on `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).
8. Until W-333's `studio/queue.yml` lands (D-077 B), lane state lives in `~/.bisellium-evidence/current-state.md`, overwritten at each refresh (D-109).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Order by cycle minutes saved, D-039 highs first; a high filed since starts after the one in flight. Lanes per D-106 E (Patron 2026-10-22): Engineering 1 and 2, UI 1 and 2, each taking from the top. Halted: W-239 (D-106 D).

Engineering 1 (guard, scripts, hooks, run; no next.ts):
E1.1. W-379 — W-369's split-off half: the guard runs from the Patron's clone (high; design to the Patron before branch)
E1.2. W-392 — tests×one-sided-bound-assertion recurs after W-376's cause fix: close the path it missed (D-076 D high; greenlit)
E1.3. W-383 — cause fix for the repeat class tests×security-boundary-cases-uncovered (D-076 D high; greenlit)
E1.4. W-393 — cause fix for the repeat class spec×input-domain-missing-or-unenforceable (41 logs after W-319, W-307; D-076 D high; greenlit)
E1.5. W-394 — cause fix for the repeat class review×evidence-backfilled-or-absent: named evidence is kept-script output, present at review (D-076 D high; greenlit)
E1.6. W-395 — cause fix for the repeat class spec×promise-unattainable-under-accepted-domain: each Promise checked against every Input domain row (D-076 D high; greenlit)
E1.7. W-349 — flaky row W-279-b3 failed twice in the merge queue: print its capture, then fix the cause (D-039 high)
E1.8. W-364 — the guard refuses heavy runs and record shell writes from the main thread (D-039 high; greenlit; carries W-290's remainder; Defaults to the Patron before branch)
E1.9. W-372 — a dispatched agent waits for its long background perform (D-106 D)
E1.10. W-242 — the hook-set code cuts W-310 left at spec (greenlit; no .claude/ change)
E1.11. W-371 — `bisellium run` composes a Codex seat's sandbox from the manifest (D-106 D)
E1.12. W-283 — the Status page served, not republished (Patron yes; `.github` change is the Patron's)
E1.13. W-375 — context serves the lex without §9 and §12 (boot trim)
E1.14. W-380 — prune old evidence to small text (Patron yes)
Engineering 2 (next.ts, one at a time; D-039 highs first):
E2.1. W-370 — certify's certificate read through the GitHub API, not an artifact (high; Patron-promoted 2026-10-24; split at spec round 4, D-061 §4)
E2.2. W-396 — W-370's remainder: the ci.yml certificate job, bound to the trusted base commit (high; greenlit; `.github`, the Patron merges)
E2.3. W-384 — the done land's auto-merge re-arm errors on a merged PR (D-039 high, seen twice; greenlit)
E2.4. W-185 — records checked once, at load: cause fix for review×fail-open-on-malformed-records-patched-per-site (D-076 D high; promoted 2026-10-24)
E2.5. W-227 — cleanup finishes when the sandbox keeps a removed worktree's metadata (high)
E2.6. W-382 — done accepts the branch's UI ruling when master moved under the queue (greenlit)
E2.7. W-333 — the queue as a record, `studio/queue.yml` (greenlit; promoted 2026-10-23)
E2.8. W-374 — next --all prints only opera in flight; --everything keeps the full list (boot trim)
E2.9. W-363 — W-309's remainder: spec review runs through next; the chain refreshes the handoff after review
E2.10. W-331 — `next.ts` split by region, no behaviour change
E2.11. W-183 — heavy-job slots
E2.12. W-169 — lane claims, the second lane (D-075 F; design approved by D-087 C)
E2.13. W-332 — step tickets close the retired dispatch guard's gap (greenlit)
E2.14. W-308 — the opus timeline stamped in the record; read-only `next <id> --timeline`
Then the console MVP (after the block):
10. W-304 — seats read live from one settings store, no PR to take effect (D-074)
11. W-298 — the `petitio` verb to the Patron; `next` holds on an open one
12. W-280 — Inbox and `newItem` fail-open fixes (its `newItem` half; Inbox half is W-345's)
13. W-261 — woken orchestration: the cascade loop waits on a GitHub event, one session per wake (D-087 F; touches the Patron's `scripts/cascade-loop.sh`)
14. W-301 — console writes commit and land by auto-merge PR, with a cross-process write lock
UI 1 and UI 2, one queue, from the top (order D-090 B; models D-091, D-099; `kind: ui` at start, D-088 E, except W-338):
1. W-355 — W-348 part 2: `next` reads the spec pairing and kind from the record owning the spec evidence, failing closed on a bad owner record (backlog: awaits greenlight)
2. W-350 — screenshot baselines with production fonts, two stages (D-097): waits for the Patron's approval of the recaptured shots (D-099 E)
3. W-345 — Inbox truth and safety: shortcuts ignore typed-field keys, one submission at a time, the reason bound to its petition, no invented petitions on a failed read, answer pane reachable at phone width, defer and delegate distinct or removed
4. W-074 — greenlight and decline from the Board drawer, with W-289's refusal (greenlight is the Patron's alone, high) and a `halt` route (D-080 E)
5. W-300 — the drawer shows `next`'s read-only step, actor, round and health
W-281 — milestone exits that can be met — rides any records PR. Backlog, filed 2026-10-24: W-385 to W-391, W-397 (titles in their records).

Later: every other opus record, re-ranked under D-083 A (last ranked list: history at 0553f97c). Later, greenlit (same history): W-040 W-045 W-051 W-068 W-070 W-073 W-078 W-081 W-090 W-091 W-093 W-094 W-098 W-099 W-113 W-115 W-116 W-118 W-133 W-135 W-136 W-138 W-143 W-144 W-145 W-146 W-147 W-149 W-150 W-151 W-154 W-157 W-158 W-159 W-160 W-165 W-172 W-173 W-174 W-175 W-176 W-190 W-195 W-198 W-208 W-210 W-217 W-219 W-228 W-229 W-230 W-238 W-245 W-248 W-249 W-250 W-251 W-252 W-254 W-260 W-269 W-270 W-271 W-272 W-273 W-276 W-278 W-282 W-296.

## Open Patron choices

Asked 2026-10-20, nothing filed, not to be rushed:
1. The cycle overruns' root causes (D-088 G), reported in `~/.bisellium-evidence/overrun-study-1020/report.md`; awaiting the Patron's ruling.
2. Agent prompts as project artifacts: a design for committing each opus's dispatch prompts and kept models, with a scrub rule (the remote is public).
3. Live agent monitoring in the console: W-136 is the plan; re-check it against W-242.
