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

1. Read lex `studio/leges/production.md` §1-§8 and §10-§11; the SessionStart hook injects §9 and its runbook, but only once the Patron's installed `bisellium` is at master.
2. Run: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium -- next --all --studio studio --repo .` (read-only); `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles. A dispatched `ladder-runner` runs every ladder record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) verbatim, never the main thread. Engineering: Sonnet builders (background), the Opus 5.5 architect, Codex `gpt-5.6-sol` review (D-066 C, D-072). `kind: ui`: Codex Sol drafts and signs, Claude Opus 5.5 reviews the spec, Codex `gpt-5.6-terra` builds, a fresh Sol session reviews the build (D-091 A, D-099). `clerk` edits text only.
4. Known traps until their filings land:
- Standing (W-323 pattern): a change to certify's host runner is judged by the old runner at its own merge, so split it out and land it first. The mint runs from the opus worktree with `--studio studio --repo .`.
- `next` holds a signature or red on a stale handover: `bisellium handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` too, needs a `next` just before it at the same head (tell the builder; its brief forbids `next`). Sign findings as `n. advisory — … — check: …` or `No findings`.
- A ui opus's master `verify` runs from a writable worktree on a `verify/<id>-<date>` branch at master (the main checkout is read-only for app paths: EROFS), its logs landed by a records PR; done then needs a Patron ruling on master's tree (D-116 for W-406) until W-382. `verify` refuses a dirty tree. One heavy job at a time (D-075 F): during a verify, no master move.
- A new opus record lands in the same PR as its Queue line. Prompts with backticks go in a kept file, never an unquoted heredoc.
- Records PRs: run `check -- studio --repo .` before pushing (a new opus needs a milestone; a greenlit one its Queue line); push with `git push origin HEAD:<branch>` (read-only config lock); after `gh pr merge --auto` confirm isInMergeQueue; a queued branch cannot be pushed: dequeue first. Push-notify the Patron at every wait on them (W-418 covers PR reviews only). The clerk has Read and Write only.
- An agent session cannot pull a merged `.claude/` change (read-only mount; restore what a failed pull applied): the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` (W-239). Code-owner review gates PRs touching `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`; a push dismisses approval; re-request the Patron's review (`gh pr edit <n> --add-reviewer edckt`).
- A build verdict's `## Earlier findings` may name only the previous round's own findings; spec review is capped at two rounds (D-061 §4). A subagent running a kept record script is refused by the auto-mode classifier: stop and report, no retry via another agent. A Ruling cannot pair with an Earlier-findings line: the same session reissues its verdict.
- `--expect pr --body-file` takes a file under the repo or `$TMPDIR` only. `--expect spec` is two performs. The evidence copies of kept scripts carry the `next` calls; `scripts/` lacks them. Uncommitted tracked edits in the main checkout block the spec and merge performs' fast-forward: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`, drop by tag.
- A merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`. A queued PR shows no auto-merge request: check `isInMergeQueue` (gh api graphql) before touching it. Records PRs use `--auto` without `--squash`.
- A publish refused for a newer live version is a version conflict, not a permission refusal: read the live page, merge, publish. Status republish: Read all of the saved live page first (until W-283). Done reads certify's certificate from its check run (W-370, W-396); a merge commit without one falls back to the artifact host, named once if refused (never a wildcard or a settings edit, D-106 C).
- Merge: the ladder-runner enqueues with `--max-polls 2`; the orchestrator waits on isInMergeQueue until W-372. Codex UI builders get `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'` until W-371 lands (D-106 D).
5. Standing until their opus lands:
- D-085 F rides the fix census and the daily retro.
- Records dates are UTC; the Patron reads times in SGT (UTC+8). The trial (lex §7) counts from the first opus after W-292.
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review prompt `studio/prompts/spec-review.md`; spec review spec-review-d076/r2-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w406.py (row 156; a new script per row); daily retro python3 -I retro-daily/retro.py . <date> --append (paths under ~/.bisellium-evidence/); usage usage/usage-reading.sh <label>, each ladder step.
7. Use `npm run -s bisellium --` (the `bisellium` on PATH is stale). The `next` cleanup step busy on `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).
8. Until W-333's `studio/queue.yml` lands (D-077 B), lane state lives in `~/.bisellium-evidence/current-state.md`, overwritten at each refresh (D-109).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Order by cycle minutes saved, D-039 highs first; a high filed since starts after the one in flight. Lanes: one Engineering, two UI (Patron 2026-10-27: push the Codex-heavy UI streams; was one each from 10-24), each taking its queue's top. Halted: W-239 (D-106 D).

Engineering, one ranked list (D-111; `next.ts` items one at a time):
0. W-436 — hard rule (Patron 10-28): every open item lives in a record (petitio, opus, Queue), never memory or chat; enforced by a Stop hook and the handoff check (high)
2. W-426 — UI prompts judge sense and who ruled a DIRECTION rule (high; gates passed 10-28, review next; studio/prompts/: Patron merges). Then W-429 — petitio length limits (subject ≤ 70 characters, ask ≤ 200 words; check refuses longer).
2a. W-431, W-432, W-433 — verb dead ends (10-28): unchanged re-sign, carried open finding, ui-lead revise with a session
3. W-405 — pr refuses a kind: ui opus until the Patron's screen approval is recorded (high; greenlit 10-25) `next.ts`
3a. W-430 — usage in the records: next --perform appends a usage reading (Claude 5h/week, Codex week, context %) at each ladder step; checkpoint rows print each opus's plan cost (Patron greenlit 10-27) `next.ts`
3b. W-261 — woken orchestration (D-126 1: the overrun study's first cause)
3c. W-434 — dispatch prompts as project artifacts, scrubbed (D-126 2)
4. W-414 — cause fix for repeat class tests×ruled-case-uncovered (D-076 D high; W-404's review r1; greenlit 10-25)
5. W-383 — cause fix for repeat class tests×security-boundary-cases-uncovered (D-076 D high)
6. W-393 — cause fix for repeat class spec×input-domain-missing-or-unenforceable (D-076 D high)
7. W-185 — records checked once, at load: cause fix for review×fail-open-on-malformed-records-patched-per-site (D-076 D high) `next.ts`
8. W-394 — cause fix for repeat class review×evidence-backfilled-or-absent (D-076 D high)
9. W-395 — cause fix for repeat class spec×promise-unattainable-under-accepted-domain (D-076 D high)
10. W-349 — flaky row W-279-b3 failed twice in the merge queue: print its capture, then fix the cause (D-039 high)
11. W-399 — a record verb refuses a write whose sella is not its ticket's actor (high)
12. W-371 — one provider-neutral sandbox row per seat, composed by `bisellium run`; Codex first (high)
13. W-364 — the CLI half first: verify and ci --opus refuse outside a `bisellium run` session (D-039 high; carries W-290; Defaults to the Patron before branch)
14. W-242 — the hook-set code cuts W-310 left at spec (no .claude/ change)
15. W-372 — a dispatched agent waits for its long background perform (D-106 D)
16. W-400 — CLAUDE.md and AGENTS.md code-owned; a stale render blocks the merge queue
17. W-401 — every launched session receipts its provider, model and containment policy
18. W-245 — provider-agnostic closing step: delete the duplicates, assert parity in a test
19. W-227 — cleanup finishes when the sandbox keeps a removed worktree's metadata (high) `next.ts`
20. W-382 — done accepts the branch's UI ruling when master moved under the queue `next.ts`
21. W-333 — the queue as a record, `studio/queue.yml` `next.ts`
22. W-283 — the Status page served, not republished (Patron yes; `.github` change: Patron's)
23. W-374 — next --all prints only opera in flight; --everything keeps the full list `next.ts`
24. W-375 — context serves the lex without §9 and §12 (boot trim)
25. W-363 — W-309's remainder: spec review runs through next; the chain refreshes the handoff `next.ts`
26. W-380 — prune old evidence to small text (Patron yes)
27. W-331 — `next.ts` split by region, no behaviour change `next.ts`
28. W-183 — heavy-job slots `next.ts`
29. W-169 — lane claims, the second lane (D-075 F; D-087 C) `next.ts`
30. W-332 — step tickets close the retired dispatch guard's gap `next.ts`
31. W-308 — the opus timeline stamped in the record; read-only `next <id> --timeline` `next.ts`
32. W-304 — seats read live from one settings store, no PR to take effect (D-074) — the console MVP starts here
33. W-298 — the `petitio` verb to the Patron; `next` holds on an open one
34. W-280 — Inbox and `newItem` fail-open fixes (`newItem` half)
36. W-301 — console writes commit and land by auto-merge PR, with a cross-process write lock

UI, one ranked list (D-111; order D-090 B; models D-091, D-099; `kind: ui` at start, D-088 E, except W-338):
1. W-407 — Inbox: revision g and its 1.21:1 shade approved (10-28); re-sign r13, Opus review, Astra, branch, Terra. Then W-408 — stays the Officina detail page (no fasti or stamps, live, Health markers); Sol revision d drops the opening-page parts; after W-407. Then the Board's five: W-409 W-410 W-411 W-412 W-413.
1a. W-435 — Home, the landing page (10-28): layout research first (Claude Haiku, Codex Luna), options to the Patron. P-023 (Inbox): plain-English labels.
2. W-074 — greenlight and decline from the Board drawer, with W-289's refusal (Patron-only, high) and a `halt` route (D-080 E); then W-300 — the drawer shows `next`'s read-only step, actor, round and health. W-281 rides any records PR. Backlog: W-427 (severity colours, after W-407), W-385 to W-391, W-397.
Later: every other opus record, re-ranked under D-083 A (last ranked list: history at 0553f97c). Greenlit (same history): W-040 W-045 W-051 W-068 W-070 W-073 W-078 W-081 W-090 W-091 W-093 W-094 W-098 W-099 W-113 W-115 W-116 W-118 W-133 W-135 W-136 W-138 W-143 W-144 W-145 W-146 W-147 W-149 W-150 W-151 W-154 W-157 W-158 W-159 W-160 W-165 W-172 W-173 W-174 W-175 W-176 W-190 W-195 W-198 W-208 W-210 W-217 W-219 W-228 W-229 W-230 W-238 W-248 W-249 W-250 W-251 W-252 W-254 W-260 W-269 W-270 W-271 W-272 W-273 W-276 W-278 W-282 W-296.
