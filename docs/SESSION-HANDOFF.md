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

1. Read lex `studio/leges/production.md` §1-§8 and §10-§11; the SessionStart hook injects §9 and its runbook once the Patron's installed `bisellium` is at master.
2. Run: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium -- next --all --studio studio --repo .` (read-only); `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles. A dispatched `ladder-runner` runs every ladder record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) verbatim, never the main thread. Engineering: Sonnet builders (background), Opus 5.5 architect, Codex `gpt-5.6-sol` review (D-066 C, D-072). `kind: ui`: Codex Sol drafts and signs, Opus 5.5 reviews the spec, Codex `gpt-5.6-terra` builds, a fresh Sol session reviews the build (D-091 A, D-099). `clerk` edits text only.
4. Known traps until filed:
- Standing (W-323 pattern): a change to certify's host runner is judged by the old runner at its own merge, so split it out and land it first. The mint runs from the opus worktree with `--studio studio --repo .`.
- `next` holds a signature or red on a stale handover: `bisellium handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` too, needs a `next` just before it at the same head (tell the builder; its brief forbids `next`). Sign findings as `n. advisory — … — check: …` or `No findings`.
- A ui opus's master `verify` runs from a writable worktree on a `verify/<id>-<date>` branch at master (the main checkout is EROFS for app paths), its logs landed by a records PR; done then needs a Patron ruling on master's tree (D-116 for W-406) until W-382. `verify` refuses a dirty tree. Heavy-job slots: 3 on trial (Patron 10-29); no master move during a verify.
- A new opus record lands in the same PR as its Queue line. Prompts with backticks go in a kept file, never an unquoted heredoc.
- Records PRs: run `check -- studio --repo .` before pushing (a new opus needs a milestone; a greenlit one its Queue line); push with `git push origin HEAD:<branch>` (read-only config lock); after `gh pr merge --auto` confirm isInMergeQueue; a queued branch cannot be pushed: dequeue first. Push-notify the Patron at every wait on them (W-418 covers PR reviews only). The clerk has Read and Write only.
- An agent session cannot pull a merged `.claude/` change (read-only mount; restore what a failed pull applied): the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` (W-239). Code-owner review gates PRs touching `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`; a push dismisses approval; re-request the Patron's review (`gh pr edit <n> --add-reviewer edckt`).
- A build verdict's `## Earlier findings` may name only the previous round's own findings; spec review is capped at two rounds (D-061 §4). A subagent refused on a kept record script by the auto-mode classifier stops and reports; no retry via another agent. A Ruling cannot pair with an Earlier-findings line: the same session reissues its verdict.
- `--expect pr --body-file` takes a file under the repo or `$TMPDIR` only. `--expect spec` is two performs. The evidence copies of kept scripts carry the `next` calls; `scripts/` lacks them. Uncommitted tracked edits in the main checkout block the spec and merge performs' fast-forward: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`, drop by tag.
- A merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`. A queued PR shows no auto-merge request: check `isInMergeQueue` (gh api graphql) before touching it. Records PRs use `--auto` without `--squash`.
- A publish refused for a newer live version is a version conflict: read the live page, merge, publish. Status republish: read the whole saved live page first (until W-283). Done reads certify's certificate from its check run (W-370, W-396); with none, it falls back to the artifact host, named once if refused (no wildcard or settings edit, D-106 C).
- Merge: the ladder-runner enqueues with `--max-polls 2`; the orchestrator waits on isInMergeQueue until W-372. Codex UI builders get `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'` until W-371 lands (D-106 D).
- Never ff master by hand in the main checkout (read-only packages/ breaks it half-way); the performs' guard sync moves it (no tracked edits or colliding untracked files).
- A UI ruling counts only if dated after the served-e2e capture (W-382); a master move voids both. `worktree add -b` needs `--no-track`. A subagent stays in turn while its background run goes.
5. Standing until their opus lands:
- D-085 F rides the fix census and the daily retro.
- Records dates are UTC; the Patron reads times in SGT (UTC+8). The trial (lex §7) counts from the first opus after W-292.
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review `studio/prompts/spec-review.md`, run by spec-review-d076/r2-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w433.py (row 168; one script per row); daily retro python3 -I retro-daily/retro.py . <date> --append (paths under ~/.bisellium-evidence/); usage usage/usage-reading.sh <label>, each reply; UI Codex via codex-passes/ui-run.sh.
7. Use `npm run -s bisellium --` (the `bisellium` on PATH is stale). The `next` cleanup step busy on `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).
8. Until W-333's `studio/queue.yml` lands (D-077 B), lane state lives in `~/.bisellium-evidence/current-state.md`, overwritten each refresh (D-109).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Order by cycle minutes saved, D-039 highs first; a high filed since starts after the one in flight. Lanes: two Engineering, two UI (D-137). Halted: W-239 (D-106 D), W-435.

Engineering, one ranked list (D-111; `next.ts` items one at a time):
In flight: E1 W-477 (first); W-468 fix 3; W-474 PR #920; W-472 PR #921 (Patron merges); UI1 W-463 verify.
1. W-468 — a fix round records its red: next issues a red ticket in phase fix (high; Patron 10-30)
2. W-382 — done accepts the branch's UI ruling when master moved under the queue (Patron 10-31) `next.ts`
3. W-459 — daily retro enforced and automated: reads failing gate logs too (Patron 10-31); 4. W-363 — spec review as one next perform (Patron 10-31) `next.ts`; 5. W-482 — a fix round as one next perform: fills and dispatches the builder brief (Patron 10-31); 6. W-333 — the queue as a record, `studio/queue.yml`: one opus per entry, numbered from 1 (D-136, high; Patron 10-31: ranked up) `next.ts`
7. W-473 — a red's recorded failing assertion equals the brief's declared one (D-076 D high); 8. W-476 — cause fix for interface×validation-order-masks-errors (D-076 D high)
9. W-469 — a spec-stage stale handover needs no hand step: next records the handoff, the guard sync moves master
10. W-470 — a verdict whose named session is an earlier orchestrator's records a fresh one without a hand --session-reason
11. W-471 — a failing gate's log keeps its real failure: nested ci fixture output hid W-408's 10-30 tests failure; 12. W-478 — idle-lane check; 13. W-479 — outside-advisory filing path; 14. W-480 — next builds a fix round before review; 15. W-481 — spec signature carries the fixture census (Patron 10-31)
16. W-452 — collegium names the owning lead; kind ui retired (D-128), then re-tag
17. W-455 — symlink cause fix: the containment helper refuses a symlinked final file (10-29)
18. W-465 — drain before handover; no new task past 250k (10-30)
19. W-436 — open items live in records, not memory or chat (10-28)
20. W-458 — done finishes a merged rung; 21. W-457 — builder for an untouched owned file
22. W-371 — one provider-neutral sandbox row per seat, composed by `bisellium run`; Codex first (10-29)
23. W-456 — test-pool research, ops
24. W-414 — cause fix for tests×ruled-case-uncovered (D-076 D high)
25. W-394 — cause fix for review×evidence-backfilled-or-absent (D-076 D high)
26. W-395 — cause fix for spec×promise-unattainable-under-accepted-domain (D-076 D high)
27. W-460 — cause fix for tests×tests-that-agree-with-the-bug (D-076 D high)
28. W-464 — for mechanism×replay-environment-not-pristine
29. W-393 — cause fix for spec×input-domain-missing-or-unenforceable (D-076 D high)
30. W-185 — records checked once, at load: cause fix for review×fail-open-on-malformed-records-patched-per-site (D-076 D high) `next.ts`
31. W-383 — security-boundary test fix; 32. W-405 — pr refuses kind: ui until screen approval `next.ts`; 33. W-431 — verb dead ends; 34. W-432 — verb dead ends; 35. W-429 — petitio length limits
36. W-261 — woken orchestration; 37. W-434 — dispatch prompts as artifacts; 38. W-254 — delete talk and tick daily branch; 39. W-349 — flaky row W-279-b3; 40. W-399 — record verb sella check
41. W-364 — verify refuses outside bisellium run (W-290); 42. W-242 — hook-set code; 43. W-372 — agent waits on background perform; 44. W-400 — CLAUDE.md, AGENTS.md code-owned; 45. W-401 — sessions receipt provider
46. W-245 — provider-agnostic closing step; 47. W-227 — cleanup with removed-worktree metadata `next.ts`; 48. W-283 — Status page served; 49. W-374 — next --all in-flight only `next.ts`; 50. W-375 — context serves lex without §9, §12
51. W-380 — prune old evidence; 52. W-331 — next.ts split `next.ts`; 53. W-183 — heavy-job slots `next.ts`; 54. W-169 — lane claims `next.ts`
55. W-332 — step tickets `next.ts`; 56. W-308 — opus timeline `next.ts`; 57. W-304 — seats read live, console MVP; 58. W-298 — petitio verb; 59. W-280 — Inbox newItem fail-open
60. W-301 — console writes via auto-merge PR

UI, one ranked list (D-111; order D-090 B; models D-091, D-099; `kind: ui` at start, D-088 E, except W-338):
1. W-463 — Board asks stand out (merged #911; done waits on a master verify and ruling)
2. W-472 — short task titles (at most 8 words), the long text in a description the Board drawer shows (Patron 10-30)
3. W-410
4. W-411
5. W-412
6. W-413
7. W-451 — Home: gates passed a0d5d440; data W-439, W-440
8. W-467 (Officina on Home's palette)
9. W-453 (D-128 D)
10. W-074 — greenlight and decline from the Board drawer, with W-289's refusal (Patron-only, high) and a `halt` route (D-080 E)
11. W-300 — the drawer shows `next`'s read-only step, actor, round and health

W-281 rides any records PR. Backlog: W-427 (severity colours), W-438 (plain-English labels, after W-408), W-385 to W-391, W-397.

Later: every other opus record, re-ranked under D-083 A (last ranked list: history at 0553f97c). Greenlit (same history): W-040 W-045 W-051 W-068 W-070 W-073 W-078 W-081 W-090 W-091 W-093 W-094 W-098 W-099 W-113 W-115 W-116 W-118 W-133 W-135 W-136 W-138 W-143 W-144 W-145 W-146 W-147 W-149 W-150 W-151 W-154 W-157 W-158 W-159 W-160 W-165 W-172 W-173 W-174 W-175 W-176 W-190 W-195 W-198 W-208 W-210 W-217 W-219 W-228 W-229 W-230 W-238 W-248 W-249 W-250 W-251 W-252 W-260 W-269 W-270 W-271 W-272 W-273 W-276 W-278 W-282 W-296.
