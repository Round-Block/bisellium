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
3. Roles. A dispatched `ladder-runner` runs every ladder record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) with the exact command, never the main thread. Builders: Sonnet, background. Architect: Opus 5.5. Codex `gpt-5.6-sol` is the single review gate (D-066 C). `clerk` edits text only.
4. Known traps until their filings land:
- A fix to how the host mint sets up its candidate clone cannot reach its own merge (certify runs master's host runner): split it out, land it first (W-178/W-323). The mint runs from the opus worktree with `--studio studio --repo .`.
- `next` holds a signature or red on a stale handover: `bisellium handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` too, needs a `next` just before it at the same head (tell the builder; its brief forbids `next`). A spec's "stale handover" hold can mask an invalid architect signature (W-275): sign findings as `n. advisory — … — check: …` or `No findings`; `next` refuses the prose `verdict` accepts.
- A ui opus's master `verify` rewrites its committed `studio/ci/<id>-*-<tree8>.log` (W-318, halted): copy them aside, `git restore` them, then run the done perform. `verify` refuses a dirty tree: write checkpoint and handoff edits after it passes. One heavy job at a time (D-075 F): a verify beside a full test run times out; during a verify, no untracked opus record and no master move.
- A new opus record lands in the same PR as its Queue line. A records PR may change only `studio/`, the handoff and the dossier (W-243). Prompts with backticks go in a kept file, never an unquoted heredoc.
- An agent session cannot pull a merged `.claude/` change (read-only mount; restore what a failed pull applied): the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` (W-239). Code-owner review gates only PRs touching `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`; pushing dismisses an approval, so re-request the Patron's review (`gh pr edit <n> --add-reviewer edckt`).
- A build verdict's `## Earlier findings` may name only the previous round's own findings; spec review is capped at two rounds (D-061 §4). A subagent running a kept record script is refused by the auto-mode classifier: stop and report, no retry via another agent.
- `--expect pr --body-file` takes a file under the repo or `$TMPDIR` only. `--expect spec` is two performs; the landing leaves earlier round logs untracked: add them to the next records commit. Evidence copies of the kept scripts carry the `next` calls; the `scripts/` copy still lacks them. Uncommitted tracked edits in the main checkout block the spec and merge performs' fast-forward: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`, drop by tag.
- A merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`. A queued PR shows no auto-merge request: check `isInMergeQueue` (gh api graphql) before touching it. An approved PR sitting CLEAN with `isInMergeQueue` false: `gh pr merge <n> --disable-auto` then `--auto`; records PRs use `--auto` without `--squash`.
- An Artifact publish refused for a newer live version is a version conflict, not a permission refusal: read the live page, merge, publish. The Status page's live version carries edits the build lacks: its republish needs the Patron until W-283. An evidence-only fix under `studio/ci/` needs one empty marker commit naming it before next orders the re-review, until W-378. A done perform refused on GitHub's artifact host reruns once with exactly the host named, never a wildcard or a settings edit, until W-370 lands (D-106 C).
- A ladder-runner runs a land or merge perform in the foreground until W-372 lands (D-106 D). Codex UI builders get `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'` until W-371 lands (D-106 D). Since W-362 a source merge needs the Patron's printed `merge --ff-only` until W-369; a ui opus's pr waits for the Patron's yes until W-377.
5. Standing until their opus lands:
- D-085 F rides the fix census and the daily retro; D-076 E's architect line ("unchanged code gets a stated limit, not a guarantee") stays in every architect dispatch.
- Until `next`'s stall line is in the installed `bisellium`, watch each dispatch with `~/.bisellium-evidence/watch-silence.sh <min> <dirs>` under Monitor.
- Records dates are UTC; the Patron reads times in SGT (UTC+8). The trial (lex §7) counts from the first opus after W-299 part 1.
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief builder-brief-model.md; spec review spec-review-d076/r2-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w268.py (row 113, copy to a new script per row); daily retro python3 -I retro-daily/retro.py . <date> --append (paths under ~/.bisellium-evidence/).
7. Use `npm run -s bisellium --` (the `bisellium` on PATH is a stale install). `cleanup` busy on `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227).
8. Lane state lives in `~/.bisellium-evidence/current-state.md`, overwritten at each refresh.

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

Two engineering lanes and two UI lanes (Patron 2026-10-22), each taking from the top of its list.
Order by cycle minutes saved, D-039 highs first; a high opus filed since starts right after the one in flight.
Lanes per D-106 E. Halted: W-239 (D-106 D).

Lane A (guard, scripts, hooks, run; no next.ts):
A1. W-369 — the Patron's installed guard syncs the agent clone to the fetched master (high; D-106 D, F; design to the Patron before branch)
A2. W-379 — W-369's split-off half: the guard runs from the Patron's clone at master (high; design to the Patron before branch)
A3. W-376 — a check rule blocks one-sided assertions on spelled-out strings (D-076 D; high)
A4. W-349 — the flaky row W-279-b3 failed in the merge queue twice: print what it captured, then fix the cause (D-039 high)
A5. W-364 — the main thread runs only what next names: the guard refuses heavy runs and shell writes into the records (D-039 high; greenlit; carries W-290's remainder; Defaults to the Patron before branch)
A6. W-372 — a dispatched agent waits for its own long background perform (D-106 D; follows W-369)
A7. W-242 — the hook-set code cuts W-310 left at spec (greenlit; no .claude/ change)
A8. W-371 — `bisellium run` composes a Codex seat's sandbox from the manifest (D-106 D)
A9. W-283 — the Status page served, not republished (Patron yes; its `.github` change is the Patron's)
A10. W-375 — context serves the lex without §9 and §12, so boot needs no whole-lex read (boot trim)
Lane B (next.ts, one at a time; D-039 highs first):
B1. W-377 — a ui opus's pr waits for the Patron's ruling on the branch's screenshots (high; Patron 2026-10-23)
B2. W-227 — cleanup finishes when the sandbox keeps a removed worktree's metadata (high)
B3. W-370 — certify's certificate read through the GitHub API, not an artifact (high)
B4. W-333 — the queue as a record, `studio/queue.yml` (greenlit; promoted 2026-10-23 (boot trim))
B5. W-374 — next --all prints only opera in flight; --everything keeps the full list (boot trim)
B6. W-363 — W-309's remainder: the spec-review perform through next, and the chain refreshes the handoff after its review
B7. W-331 — `next.ts` split by region, no behaviour change
B8. W-183 — heavy-job slots
B9. W-169 — lane claims, the second lane (D-075 F; design approved by D-087 C)
B10. W-332 — step tickets close the retired dispatch guard's gap (greenlit)
B11. W-308 — the opus timeline stamped in the record; read-only `next <id> --timeline`
Then the console MVP's server side (after the block):
10. W-304 — seats read live from one settings store, no PR to take effect (D-074)
11. W-298 — the `petitio` verb to the Patron; `next` holds on an open one
12. W-280 — Inbox and `newItem` fail-open fixes (its `newItem` half; the Inbox half is W-345's: narrow at spec)
13. W-261 — woken orchestration: the cascade loop waits on a GitHub event, one fresh session per wake (D-087 F; changes `scripts/cascade-loop.sh`, the Patron's folder)
14. W-301 — console writes commit and land by auto-merge PR, with a cross-process write lock
UI queue, two lanes (order D-090 B; models D-091, D-099; every opus `kind: ui` at start, D-088 E, except W-338):
1. W-366 — Dracula's cyan, pink, purple and yellow as accent colours (greenlit, D-103): the Patron approved the colours 2026-10-23; then verify on master and done
2. W-360 — W-350 part 3, redo first (Patron 2026-10-22, D-099 E), after W-361: screenshot baselines with a frozen clock, captured after each screen's data loads; the Patron approves the four screens (greenlit, high; waits for W-366's done)
3. W-355 — W-348 part 2: `next` reads the spec pairing and kind from the record that owns the spec evidence, failing closed on a bad owner record (backlog: awaits greenlight)
4. W-350 — screenshot baselines with production fonts, two stages (D-097): waits for W-360 and then the Patron's approval of the recaptured shots (D-099 E)
5. W-345 — Inbox truth and safety: shortcuts ignore keys typed in a field, one submission at a time, the reason bound to its petition, no invented petitions on a failed read, answer pane reachable at phone width, defer and delegate made distinct or removed
6. W-074 — greenlight and decline from the Board drawer, carrying W-289's refusal (greenlight is the Patron's alone, high) and a `halt` route (D-080 E)
7. W-300 — the drawer shows `next`'s read-only step, actor, round and health
W-281 — milestone exits that can be met — rides any records PR.

Later: every opus record not named above, re-ranked under D-083 A; the last ranked Later list is in this file's history at 0553f97c.
Later, greenlit (ranked in this file's history at 0553f97c): W-040 W-045 W-051 W-068 W-070 W-073 W-078 W-081 W-090 W-091 W-093 W-094 W-098 W-099 W-113 W-115 W-116 W-118 W-133 W-135 W-136 W-138 W-143 W-144 W-145 W-146 W-147 W-149 W-150 W-151 W-154 W-157 W-158 W-159 W-160 W-165 W-172 W-173 W-174 W-175 W-176 W-185 W-190 W-195 W-198 W-208 W-210 W-217 W-219 W-228 W-229 W-230 W-238 W-245 W-248 W-249 W-250 W-251 W-252 W-254 W-260 W-269 W-270 W-271 W-272 W-273 W-276 W-278 W-282 W-296.

## Open Patron choices

Asked 2026-10-20, nothing filed, not to be rushed:
1. The cycle overruns' root causes (D-088 G), reported in `~/.bisellium-evidence/overrun-study-1020/report.md`; awaiting the Patron's ruling.
2. Agent prompts as project artifacts: a design for committing each opus's dispatch prompts and kept models, with a scrub rule (the remote is public).
3. Live agent monitoring in the console: W-136 is the plan; re-check it against W-242.
