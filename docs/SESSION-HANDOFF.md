---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

Current state only, after CLAUDE.md. Rules: `studio/leges/production.md`, read whole (the SessionStart hook injects it; a preview is not a read).

## Boot (every fresh session, before any dispatch)

1. Read all of `studio/leges/production.md` (§7-§11; §9 step 0 says who runs each step). The step-by-step runbook (the exact command per step and what `next` prints before it) is served by `npm run -s bisellium -- context --sella producer studio` (W-267 part 1, the ladder-runner agent and runbook, merged #488); `~/.bisellium-evidence/orchestrator-onboarding/ladder.md` stays as background only. The Patron's installed `bisellium` (`~/projects/bisellium-guard`) must be updated to master for the session hooks to show the runbook.
2. Run, read-only: `bash scripts/agent-workspace.sh verify --inside`; `npm run -s bisellium` (flag shapes); `npm run -s bisellium -- next <id> --budget 400000 --studio studio --repo .` for each opus in flight; `git status --short`; `node ~/.bisellium-evidence/handoff-check.mjs .`.
3. Roles (D-066 A). The orchestrator runs every ladder record write itself through the allowlisted `npm run -s bisellium --` verbs and `scripts/*.sh`; it dispatches builders (Sonnet, background), the architect (Opus 5.5) and Codex reviewers (`gpt-5.6-sol`, the single review gate, D-066 C); `clerk` (no Bash) edits text only. A `ladder-runner` agent exists (`.claude/agents/ladder-runner.md`) and the Claude `censor` agent is gone; the live trial passed 2026-10-16 (a dispatched ladder-runner ran `next` and the W-206 branch perform with no refusal), so W-267 part 2 is filed greenlit as W-310 (the dispatch hook: only a dispatched ladder-runner runs record writes; a runner-recorded verdict and the auto-mode allow test come before its branch; W-292 part 1, the chain, is done); until it lands the orchestrator still runs record writes itself (D-066 A).
4. Known traps until their filings land: `verify` refuses a dirty tree (uncommitted docs edits): write the checkpoint and handoff edits after it passes. One heavy job at a time on this host (npm test, mint, verify; D-075 F): a verify beside a builder's full test run times out, and a killed run leaves `.bisellium/vendor-sentinel.lock` (remove it before rerunning); a verify's tests read the real studio, so no untracked opus record and no master move during one. A new opus record lands in the same PR as the Queue line that names it (#532/#533 deadlocked otherwise). A records PR may change only `studio/`, the handoff and the dossier (W-243 certify refused `.claude/` in #536). gh run logs need `XDG_CACHE_HOME=$TMPDIR/ghcache`. long runs (npm test, mints, verify) go in their own Bash call with `run_in_background: true`; `&`, nohup and setsid die when the call returns and a PreToolUse hook refuses them (#497; `.claude/agents/builder.md`, #498). A merged `.claude/` change cannot be pulled by an agent session (the sandbox mounts `.claude/` read-only; a failed pull leaves the commit's other files applied: restore them): the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` (W-239). A build verdict's `## Earlier findings` may name only the previous round's own findings; spec review is capped at two rounds (D-061 §4; the lex text is stale until W-278). a subagent running a kept record script is refused by the auto-mode classifier; stop and report, never ask for an allow rule or retry with another agent. Every record write needs a `next` run just before it at the same head (step tickets), including the builder's `red` (tell the builder; the kept builder brief still forbids `next`). `next --perform --expect pr --body-file` takes a file under the repo or `$TMPDIR` only: copy the kept body there first. `next --perform --expect spec` and `--expect done` are each two performs (commit, then land); the spec landing leaves earlier round logs untracked, add them to the next records commit. `--expect done` refuses without a tracked handoff edit. The evidence copies of the kept scripts carry the `next` calls (`record-review.sh` passes `--budget`); the `scripts/` copies lack them until W-309. A spec's "stale handover" hold can mask an invalid architect signature (W-275): sign with findings lines `n. advisory — … — check: …` or `No findings`, since `verdict` accepts prose findings on a passed spec but `next` refuses them. Uncommitted tracked edits in the main checkout stop the spec and merge performs from fast-forwarding master: set them aside with a tagged `git stash push -m <tag> -- <paths>`, rerun the perform, `git stash apply <sha>`, drop by tag. A merge perform that prints `QUEUE_TIMEOUT` while the PR is still queued is rerun with `--poll-ms 20000 --max-polls 150`. Code-owner review gates only PRs touching `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs` (auto-merge is always safe; pushing dismisses an approval). An Artifact publish refused for a newer live version is a version conflict, not a permission refusal: read the live page, merge, publish (the dossier republished this way on 2026-10-15). The Status page's live version carries edits the build lacks, so its republish needs the Patron until W-283 serves the page. A red's selector must hold no whitespace (`red` refuses it; use `'^W-<id>-b<n>\s'`). A red must fail by assertion, never ENOENT or module-not-found (the host replay refuses it). The mint runs from the opus worktree with `--studio studio --repo .`. After pushing to a code-owner PR, re-request the Patron's review (`gh pr edit <n> --add-reviewer edckt`). Never merge master into an opus branch: certify replays the branch onto master and a merge commit re-conflicts; rebase instead (`pr` refuses it). A queued PR shows no auto-merge request: check `isInMergeQueue` (gh api graphql) before touching it. If an approved PR sits CLEAN and `isInMergeQueue` is false, toggle `gh pr merge <n> --disable-auto` then `--auto`; records PRs use `gh pr merge --auto` without `--squash`. A brief cannot be amended mid-build (`next` judges the spec on master, and D-021 blocks master writes while `opus/<id>` exists): the Patron renames the branch and the opus is rebuilt (W-206 fixes it).

## Resume point (2026-10-17)

0. **Rulings in force:** D-077 (work state is a git record; W-299 absorbs the Resume-point cut and a read-only `next --all`; W-308 the timeline; no OTel now); D-076 (only S1 real defects, security gaps and missing evidence block; a second spec review only after a design-changing S1; cause fixes only on an S1 recurrence; daily retro into `studio/acta/improvements.md`; the architect line "unchanged code gets a stated limit, not a guarantee" goes in every architect dispatch until W-310); D-075 (cycle minutes are the measure, D-073's hand-step count a secondary line; one heavy job at a time on this host; one builder per opus); D-074 (seats are live settings, W-304); D-072 (the Opus architect drafts specs); D-066 A (the orchestrator runs record writes until W-310).
1. **State:** W-259 part 1 is done (#544, #546): the done rung records the merge queue's certify certificate, holding to the full `verify` on any mismatch. W-292 part 1's done lands on chore/done-W-292 with checkpoint row 92, after `verify W-292` passed on master 92bc62c3 in 24 min with the cache warmed (W-259 changed source after W-292's merge, so its certify did not count). W-259's parts 2 (review accepts the builder's gate logs, no pre-review mint) and 3 (gate progress lines) are filed greenlit as W-312 and W-313. W-259's cycle was about 200 min, over D-075's 180, so the Queue was re-ranked (Patron 2026-10-17). The suite takes ~39 min here, over the 30-minute gate cap of the host mint and `verify`, because `main.ts`'s `process.exit` truncates tsx's cache writes and the sandbox's /tmp is read-only (`~/.bisellium-evidence/fable-suite-1017/report.md`); W-311 fixes both and is next. Until it lands, a mint or verify here needs the Patron to warm the cache from the checkout it runs in, outside the sandbox: `node --import tsx -e "process.exit=(c)=>{process.exitCode=c}; await import('./packages/cli/src/main.ts')"`. The ladder per opus: architect spec (its signature carries a `Promise ledger:` line, W-306) → spec review (`~/.bisellium-evidence/spec-review-d076/r2-run.sh <ID>`; a second round resumes that session, model `~/.bisellium-evidence/W-259-specreview/r4-run.sh`) → branch, `npm ci --cache ~/.bisellium-evidence/npm-cache`, ready, Sonnet builder (brief model `~/.bisellium-evidence/W-259-build/builder-brief.md`) → `next <id> --perform --chain` in one background call (mint, review round, pr) → the Patron queues → merge, cleanup → done with the checkpoint row (a new row script copied from the newest one, `~/.bisellium-evidence/checkpoint-w292b.py` (row 92), with the next row number) and this file's edit in one commit → daily retro `python3 -I ~/.bisellium-evidence/retro-daily/retro.py . <date> --append`.
2. Use `npm run -s bisellium --` (the `bisellium` on PATH runs a stale install). `cleanup` busy on `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227). Many worktrees under `.worktrees/` are stale: check each for unpushed work before removal. Older audits and rulings: `studio/decisions/`, `~/.bisellium-evidence/{fable-efficiency,review-audit-1017,speed-1017,state-tracker-1017}/`.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Improvements tracker: `studio/acta/improvements.md`, updated by the daily retro (D-076 F). Ranked by minutes saved (D-075, Patron 2026-10-17, on `~/.bisellium-evidence/speed-1017/report.md`; earlier: D-071, D-069,
D-070, D-067). Block exit (lex §7): two consecutive opera after the chain (#540) pass the trial, one of them carrying a failed review round (cycle under 150 min from the first spec
signature to done, no hand-run evidence scripts, no required handoff edits, review independence kept, safe restart after an
interruption); early stop if a cycle is over 180 min after the chain (#540), or at two calendar weeks. One builder per opus; a second lane
after the chain (#540) and W-179. Older items: `studio/acta/2026-10-09-queue-review.md`.

Now, one builds at a time (one lane until W-169):
1. W-311 — test runs reuse tsx's compile cache: the CLI exits by `process.exitCode` (not `process.exit`, which truncates the cache writes) and the hand-built test envs pass TMPDIR; suite ~39 to ~22 min here; Patron 2026-10-17: next
2. W-312 — build review accepts the builder's gate logs for the exact tree; the pre-review mint leaves the chain and lex §9 (−25 min per opus; `studio/leges/`: Patron merges)
3. W-179 — `next.test.ts` split by behaviour group so the suite runs in parallel pieces, with W-178 (the test-row count check) first (−60 to −70 min per opus)
4. W-299 — the queue is a record: `studio/queue.yml`, read by `next`, the Board and the status page; absorbs the Resume-point cut (no handoff Resume point, no required handoff edit at done) and a read-only `next --all` (D-077 B)
5. W-313 — verify, ci and the mint print each gate's start, end and a per-minute progress line
6. W-308 — the opus timeline: greenlight, branch, merge and PR times stamped in the record; read-only `next <id> --timeline` and `--all`; retires elapsed.mjs and retro.py's reconstruction (D-077 C)
7. W-258 — the builder self-reviews once before handing off (−25 min average)
8. W-305 — fast lane: a one-behaviour light brief signed by the architect goes to branch with no Codex spec round (D-075 D)
9. W-182 → W-183 (slot wrapper and waiting line only) → W-169 — a second lane (D-075 F; heavy-job slots 1, then 2 after W-179)
10. W-309 — the review-perform remainder (#538's brief, parts 2-6): spec-review rounds and the fix check as performs, the hand scripts and evidence copies deleted (the trial needs none), done through certified(), the CODEOWNERS re-request, the later-round pass/fail rule; split at spec; also the ADOPTION ordering sentence #540's review flagged
11. W-241 part 1 — the prompt templates in `studio/prompts/` (specced)
12. W-310 — the chain's remainder (#540's brief, parts 2, 3, 5, 6): the PreToolUse dispatch hook (only a dispatched runner writes ladder records), its settings entry, check rule and probe, the Bash PostToolUse logger and shell-call count, and D-076 E's architect line (`.claude/`: Patron merges); W-290 is the second guard in the same hook
13. W-290 — the orchestrator session cannot write source or tests; same hook and Patron merge as W-310 (high)
14. W-275 — `next` names two-perform rungs and body-file roots; `verdict` refuses a signature `next` cannot read (high)
15. W-297 — reviewer class tags enforced by `verdict` and `next` (D-070); trial opus 1
16. W-283 — the Status page served, not republished (its `.github` change is the Patron's); trial opus 2
17. W-268 — the certify rules: the merge queue refuses writes `next` never ticketed (high); trial opus if W-297 and W-283 had no interrupted run

Next, the console MVP (after the block, same functions):
18. W-304 — seats read live from one settings store (a file now, a database later), no PR to take effect (D-074)
19. W-280 — Inbox and `newItem` fail-open fixes
20. W-298 — a `petitio` verb to the Patron; `next` holds on an open one
21. W-074 — greenlight and decline from the Board drawer, carrying W-289's refusal (greenlight is the Patron's alone, high) and a `halt` route
22. W-300 — the drawer shows `next`'s read-only step, actor, round and health
23. W-301 — console writes commit and land by auto-merge PR, with a cross-process write lock
W-281 — milestone exits that can be met — rides any records PR.

Later (ranked by value; group descriptions stand for the ids in them):
- Speed experiments: W-276 — the builder brief under step tickets; W-260 — build verdicts reconcile after rulings; W-250 — ci.yml runs `bisellium ci` once.
- High block remainder: W-296 — one typed boundary for tracked writes; the lessons-to-checks checks W-269, W-270, W-271, W-272, W-273 (D-065).
- Records hygiene, small, no hand steps saved: W-278 (the review gate named once; rides any records PR), W-098, W-252, W-251 (after W-297), W-254,
  W-238, W-239, W-229, W-172, W-219, W-228, W-227, W-230, W-217, W-210, W-173, W-174, W-165, W-190, W-198, W-195, W-208, W-081, W-138.
- Cleanup chain: W-245 part 1 — census of every provider coupling (the Patron approves the design) → W-248 — dead verbs and packages →
  W-249 — lighter tests → W-282 — the dead-code sweep → W-285 — one helper each.
- Dependencies and the arc: W-068 — task dependencies (copy `~/.bisellium-evidence/partial-specs/W-068.md` to `studio/briefs/W-068.md`, add
  `Red order: one at a time`, re-sign, spec review), then the W-118 split (M3's exit); a slice "execute and resume one opus" is filed only if the trial's interruption case fails.
- Milestone exits: W-045 + W-185 — atomic writes, records checked at load (M2); W-099 + W-093 — realpath anchor, security review on every change (M8);
  W-149 + W-150 — outside-adapter test and guide (M9); W-159 — model per seat, after W-245 (M6); W-157 — the decide verb.
- Console screens, M5 and later (after the MVP): W-073, W-078, W-113, W-116, W-090, W-091, W-092, W-145, W-146, W-147, W-148, W-202, W-136, W-143,
  W-144, W-154, W-158, W-160, W-040, W-051, W-094, W-115, W-133, W-175, W-176, W-216, W-286.
- Adopters and remote, not on the path: an OTLP exporter of the existing OTel-style events (D-077 D); W-135, W-284, W-288, W-291, W-070, W-151.
- Deferred or held: W-261, W-263 (more lanes, after W-169); W-231 (orchestrator self-refresh, after the W-118 split);
  W-242 (held until the measure retires); W-294, W-295 stay in the backlog (D-069 C).

## Open Patron choices
- None (the 2026-10-11 audit closed by D-068).
