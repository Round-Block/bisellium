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

1. Read lex `studio/leges/production.md` §1-§8 and §10-§11; SessionStart injects §9 and runbook once `bisellium` is at master.
2. Run: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium -- next --all --studio studio --repo .` (read-only); `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles. A dispatched `ladder-runner` runs every record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) verbatim, never main thread. Engineering: Sonnet builders (background), Opus 5.5 architect, Codex `gpt-5.6-sol` review (D-066 C, D-072). `kind: ui`: Codex Sol drafts and signs, Opus 5.5 reviews spec, Codex `gpt-5.6-terra` builds, a fresh Sol session reviews build (D-091 A, D-099). `clerk` edits text only.
4. Known traps until filed:
- Standing (W-323 pattern): split a certify host-runner change out and land it first; the mint runs from the opus worktree with `--studio studio --repo .`.
- `next` holds a signature or red on a stale handover: `bisellium handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` included, needs a `next` before it at the same head. Sign findings as `n. advisory — … — check: …` or `No findings`. Until filed: `ready` does not check a red's pin equals its first failure or the ledger kill.
- A ui master `verify` runs from a writable worktree on `verify/<id>-<date>` at master, logs landed by a records PR; `verify` refuses a dirty tree; 3 heavy-job slots on trial; no master move during it. Until W-483 (source_excludes): a handoff edit moves its tree, so land it before the verify starts and make none before its done. A UI ruling's design_digest is the opus's current digest (`currentDesign`), never a review log's.
- A new opus record lands in the same PR as its Queue line. Prompts with backticks go in a kept file, never an unquoted heredoc.
- Records PRs: `check -- studio --repo .` before pushing (new opus: milestone; greenlit: Queue line); push with `git push origin HEAD:<branch>`; `--auto` without `--squash`, then confirm isInMergeQueue; a queued branch cannot be pushed: dequeue first; push-notify the Patron at every wait.
- Until W-239: the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` after a merged `.claude/` change; restore what a failed pull applied.
- Code-owner review gates PRs on `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`; a push dismisses approval: `gh pr edit <n> --add-reviewer edckt`.
- A build verdict's `## Earlier findings` names only the previous round's findings; a Ruling never pairs with it (the same session reissues). Spec review: two rounds. A fresh reviewer or ui-lead session needs `--session-reason`; a ui-lead verdict after a revise needs `## Earlier findings` lines (W-410-spec/ui-input-6-reissue.sh, run by a ladder-runner). A subagent refused on a kept record script stops and reports.
- `--expect pr --body-file` takes a file under the repo or `$TMPDIR`; `--expect spec` is two performs; evidence script copies carry the `next` calls. Tracked edits in main block the spec and merge performs: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`, drop by tag. Never ff master by hand in the main checkout; performs' guard sync moves it.
- Merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`; the ladder-runner enqueues with `--max-polls 2`; the orchestrator waits on isInMergeQueue until W-372 (a queued PR shows no auto-merge request).
- Publish refused for a newer live version: read the live page, merge, publish; status republish reads the whole saved live page (until W-283). Done reads certify's certificate from its check run (W-370, W-396); with none, falls back to the artifact host, named once if refused (no wildcard or settings edit).
- Dispatch: a Codex UI builder gets `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'` until W-371, edits only, and a ladder-runner commits, takes `next`, records each red. `worktree add -b` needs `--no-track`; a subagent stays in turn while its background run goes.
5. Standing until their opus lands:
- D-085 F rides the fix census and daily retro.
- Records dates are UTC; Patron reads times in SGT (UTC+8). The trial (lex §7) counts from the opus after W-292.
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review `studio/prompts/spec-review.md`, run by spec-review-d076/r2-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w433.py (row 168; one script per row); daily retro python3 -I retro-daily/retro.py . <date> --append (evidence paths under ~/.bisellium-evidence/); usage usage/usage-reading.sh <label>, each reply; UI Codex via codex-passes/ui-run.sh.
7. Use `npm run -s bisellium --` (`bisellium` on PATH is stale). `next` cleanup busy on `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).
8. Until W-333's `studio/queue.yml` lands (D-077 B), lane state lives in `~/.bisellium-evidence/current-state.md`, overwritten each refresh (D-109).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Order by cycle minutes saved, D-039 highs first; a high filed since starts after one in flight. Lanes: two Engineering, two UI (D-137). Halted: W-239 (D-106 D), W-435.

Engineering, one ranked list (D-111; `next.ts` items one at a time):
In flight (lane state: ~/.bisellium-evidence/current-state.md): W-463 done (#948), W-410 done (#946); E1 W-452 built, review round 1's fix (studio/bisellium.yml only) is not seen by next: waits on W-491; E2 W-483 building from its prototype (W-486 deferred).
1. W-491 — a failed review's fix in the officina manifest counts as a fix commit; unblocks W-452's review round 2 (Patron 11-01) (high) `next.ts`; 2. W-452 — seats per D-150 C: one design lead, engineering signs its own specs; kind ui retired, re-tag; design-lead UI rulings count (D-150 C) (high); 3. W-483 — handoff into source_excludes (then a one-line bisellium.yml records PR while no opus is between branch and done)
4. W-489 — worktrees reclaimed when their opus or PR ends (Patron 11-01); 5. W-490 — handoff traps checked against open opera, capped (Patron 11-01)
6. W-364 — main-thread heavy runs and dossier writes refused: verify and ci --opus outside a bisellium run, the main thread's dossier writes and codex exec (W-290; Patron 11-01, folded)
7. W-333 — the queue as a record, `studio/queue.yml`, auto-claiming idle lanes (W-478 folded) (high) `next.ts`
8. W-393 — one spec admission table checked at signing (W-395, W-394, W-481 folded) (high); 9. W-458 — done finishes a merged rung: one trunk step (W-469 and "a held done requests the guard sync" folded); 10. W-363 — one stage executor: spec review, fix round, build-before-review as performs (W-480, W-482, W-470 folded) `next.ts`
11. W-476 — cause fix, validation-order-masks-errors (high); 12. W-471 — a failing gate's log keeps its real failure; 13. W-455 — the containment helper refuses a symlinked final file
14. W-414 — cause fix, ruled-case-uncovered (high); 15. W-460 — cause fix, tests-that-agree-with-the-bug (high); 16. W-464 — replay-environment-not-pristine
17. W-185 — records checked once, at load: cause fix, fail-open-on-malformed-records (high) `next.ts`; 18. W-383 — security-boundary test fix; 19. W-431 — verb dead ends; 20. W-432 — verb dead ends
21. W-429 — petitio length limits; 22. W-261 — woken orchestration; 23. W-434 — dispatch prompts as artifacts; 24. W-254 — delete talk and tick daily branch; 25. W-349 — flaky row W-279-b3
26. W-399 — record verb sella check; 27. W-242 — hook-set code; 28. W-372 — agent waits on background perform; 29. W-400 — CLAUDE.md, AGENTS.md code-owned
30. W-401 — sessions receipt provider; 31. W-245 — provider-agnostic closing step; 32. W-227 — cleanup with removed-worktree metadata `next.ts`; 33. W-283 — Status page served; 34. W-374 — next --all in-flight only `next.ts`
35. W-375 — context serves lex without §9, §12; 36. W-380 — prune old evidence; 37. W-331 — next.ts split `next.ts`; 38. W-183 — heavy-job slots `next.ts`
39. W-169 — lane claims `next.ts`; 40. W-332 — step tickets `next.ts`; 41. W-308 — opus timeline `next.ts`; 42. W-304 — seats read live, console MVP; 43. W-298 — petitio verb; 44. W-280 — Inbox newItem fail-open; 45. W-301 — console writes via auto-merge PR
Cut (Patron 11-01, workflow review): W-436, W-465, W-457, W-405. Deferred: W-484 (docs-drift lint folded in), W-485, W-486, W-479, W-371, W-456. W-434 also links prototype hash, design digest, source tree, captures and reviews (design lead 11-01). To file: a decision replacing D-076 D's opus-per-class with a class registry and cost threshold.

UI, one ranked list (D-111; order D-090 B; models D-091, D-099; `kind: ui` at start, D-088 E, except W-338):
1. W-487 — the Inbox lists every waiting ask, badges tally (D-151, supersedes D-135)
2. W-411; 3. W-412; 4. W-413; 5. W-451 — Home: gates passed a0d5d440; data W-439, W-440; 6. W-467 (Officina on Home's palette); 7. W-453 (D-128 D)
8. W-074 — greenlight and decline from the Board drawer, with W-289's refusal (Patron-only, high) and a `halt` route (D-080 E)
9. W-300 — the drawer shows `next`'s read-only step, actor, round and health
10. W-488 — comment on served UI captures (design lead 11-01)

W-281 rides any records PR. Backlog: W-427 (severity colours), W-438 (plain-English labels, after W-408), W-385 to W-391, W-397.

Later: every other opus record, re-ranked under D-083 A (last ranked list: history at 0553f97c). Greenlit (same history): W-040 W-045 W-051 W-068 W-070 W-073 W-078 W-081 W-090 W-091 W-093 W-094 W-098 W-099 W-113 W-115 W-116 W-118 W-133 W-135 W-136 W-138 W-143 W-144 W-145 W-146 W-147 W-149 W-150 W-151 W-154 W-157 W-158 W-159 W-160 W-165 W-172 W-173 W-174 W-175 W-176 W-190 W-195 W-198 W-208 W-210 W-217 W-219 W-228 W-229 W-230 W-238 W-248 W-249 W-250 W-251 W-252 W-260 W-269 W-270 W-271 W-272 W-273 W-276 W-278 W-282 W-296.

