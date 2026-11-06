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
3. Roles. A dispatched `ladder-runner` runs every record write (`next --perform`, `verdict`, `review`, `red`, `ready`, `done`, `branch`, `merge`) verbatim, never main thread. Engineering: Sonnet builders (background), Opus 5.5 architect, Codex `gpt-5.6-sol` review (D-066 C, D-072). `kind: ui`: Codex Sol drafts and signs, Opus 5.5 reviews spec, Codex `gpt-5.6-terra` builds, and `next` names the build reviewer (D-150 C). `clerk` edits text only.
4. Known traps (each line opens `Standing:` or `Until W-<n>:`, the opus that retires it; at most 12; `check` refuses a line whose opus is done):
- Standing: split a certify host-runner change out and land it first (W-323 pattern); the mint runs from the opus worktree with `--studio studio --repo .`.
- Standing: `next` holds a signature or red on a stale handover: `npm run -s bisellium -- handoff --opus <id> --sella producer --next … --studio <worktree>/studio`, commit the record. Every record write, the builder's `red` included, needs a `next` before it at the same head. Sign findings as `n. advisory — … — check: …` or `No findings`.
- Standing: a ui master `verify` runs from a writable worktree on `verify/<id>-<date>` at master, logs landed by a records PR, with the kept kit ~/.bisellium-evidence/ui-verify-1104/run.sh <opus> <base> <tag>, by a ladder-runner (it runs verify in a `bisellium run` session inside the verify worktree, as W-364 requires) — pointing it at main's studio writes failed records into main; `verify` refuses a dirty tree; 3 heavy-job slots on trial; no master move during it. A UI ruling's design_digest is the opus's current digest (`currentDesign`), never a review log's.
- Standing: records PRs have no CLI verb and the Patron denied the raw route (2026-11-05): land none until the verb lands or they rule; a handoff edit rides a done commit. Old route, unused: a new opus record lands in the same PR as its Queue line; `check -- studio --repo .` before pushing (new opus: milestone; greenlit: Queue line); push with `git push origin HEAD:<branch>`; `--auto` without `--squash`, then confirm isInMergeQueue; a queued branch cannot be pushed: dequeue first; push-notify the Patron at every wait. Prompts with backticks go in a kept file, never an unquoted heredoc.
- Standing: the Patron runs `git -C ~/agents/bisellium pull --ff-only origin master` after a merged `.claude/` change; restore what a failed pull applied.
- Standing: code-owner review gates PRs on `.github/`, `.claude/`, `studio/leges/`, `studio/decisions/`, `studio/bisellium.yml`, `studio/prompts/`, `docs/ADOPTION.md`, `scripts/ci-certify.mjs`; a push dismisses approval: `gh pr edit <n> --add-reviewer edckt`.
- Standing: a build verdict's `## Earlier findings` names only the previous round's findings; a Ruling never pairs with it (the same session reissues). Spec review: two rounds. A fresh reviewer or ui-lead session needs `--session-reason`; a ui-lead verdict after a revise needs `## Earlier findings` lines (W-410-spec/ui-input-6-reissue.sh, run by a ladder-runner). A subagent refused on a kept record script stops and reports.
- Standing: `--expect pr --body-file` takes a file under the repo or `$TMPDIR`; `--expect spec` is two performs; evidence script copies carry the `next` calls. Tracked edits in main block the spec and merge performs: `git stash push -m <tag> -- <paths>`, rerun, `git stash apply <sha>`, drop by tag. When `next` names `git -C <main> pull --ff-only origin master` (a clean main), run it; otherwise performs' guard sync moves master; a spec review run while another lane's perform has stashed main reviews the scaffold (W-499 r14 void): run spec reviews only when no perform is stashing main.
- Until W-372: the orchestrator waits on isInMergeQueue (a queued PR shows no auto-merge request); a merge perform printing `QUEUE_TIMEOUT` with the PR still queued reruns with `--poll-ms 20000 --max-polls 150`; the ladder-runner enqueues with `--max-polls 2`.
- Until W-283: publish refused for a newer live version: read the live page, merge, publish; status republish reads the whole saved live page. Done reads certify's certificate from its check run (W-370, W-396); with none, falls back to the artifact host, named once if refused (no wildcard or settings edit).
- Until W-371: a Codex UI builder gets `-c 'sandbox_workspace_write.writable_roots=["<evidence dir>"]'`, edits only, and a ladder-runner commits, takes `next`, records each red. `worktree add -b` needs `--no-track`; a subagent stays in turn while its background run goes.
- Standing: a Codex UI builder runs `codex-passes/ui-run.sh` directly: the confined `bisellium run` host cannot see ~/.bisellium-evidence. A Claude reviewer run by `claude -p` in the sandbox cannot be resumed: a shape refusal is reissued by a fresh session with `--session-reason`.
5. Standing until their opus lands:
- D-085 F rides the fix census and daily retro.
- Records dates are UTC; Patron reads times in SGT (UTC+8). The trial (lex §7) counts from the opus after W-292.
6. Kept models: architect brief ~/.bisellium-evidence/architect-dispatch-model.md; builder brief `studio/prompts/builder-brief.md` (filled model builder-brief-model.md); spec review `studio/prompts/spec-review.md`, run by spec-review-d076/r2-run.sh <ID> (no prior packet: W-241-specreview/r8/run.sh); checkpoint row checkpoint-w433.py (row 168; one script per row); daily retro `npm run -s bisellium -- retro --daily --studio studio` (evidence paths under ~/.bisellium-evidence/); usage usage/usage-reading.sh <label>, each reply; UI Codex via codex-passes/ui-run.sh.
7. Use `npm run -s bisellium --` (`bisellium` on PATH is stale). `next` cleanup busy on `.git/worktrees/<name>/`: delete its `HEAD`, rerun (W-227). The lanes are in studio/queue.yml; the producer's working notes are in `~/.bisellium-evidence/current-state.md`, overwritten each refresh (notes, not a record; D-109 ended with W-333).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

**D-181 is the plan and order, ahead of every lane (Patron 2026-11-05). Read it first. File these through W-509's verb once it lands: the guard rule refusing raw landing, with a warning when the Patron's clone is behind master; `next` refusing out-of-order starts; the settings verbs. Also file the `check` rule that a UI brief names the signed composition it follows, with every difference ruled by the Patron, and check how a general-purpose agent's edit of this file got past W-290. Audit: ~/.bisellium-evidence/audit-1105/fable/audit.md.**

Ranked lists, lanes, halted, cut and deferred: studio/queue.yml (W-333). Order by cycle minutes saved, D-039 highs first; a high filed since starts after one in flight. Lanes: two Engineering, two UI (D-137).

Greenlit on master, named here until `process.handoff.queue` reads studio/queue.yml: W-074 W-169 W-183 W-185 W-227 W-242 W-245 W-254 W-261 W-280 W-281 W-283 W-289 W-290 W-301 W-304 W-308 W-331 W-332 W-349 W-363 W-372 W-374 W-375 W-380 W-383 W-393 W-394 W-395 W-399 W-400 W-401 W-414 W-429 W-431 W-432 W-434 W-439 W-440 W-453 W-455 W-458 W-460 W-464 W-467 W-469 W-470 W-471 W-476 W-478 W-480 W-481 W-482 W-488 W-500 W-503 W-504 W-506 W-507 W-508 W-509.

D-178: no new process opus starts until M4's exit passes (D-177); product opera are exempt. D-174's items 3 to 7 keep their 2026-11-17 date. W-506 (the cause fix W-502's hold asks for) is filed greenlit and starts when the freeze ends.

In flight (notes: ~/.bisellium-evidence/current-state.md): W-451 work links: merged (#1045), next done, after its master verify reruns on a quiet host.

Ahead of the build, greenlit: W-503 Home is HELD for the Patron's four calls in ~/.bisellium-evidence/W-503-spec/compare-1105.md, section 4: the spec drifted from the signed round-6 Home that D-175 says stands. It is branched (opus/W-503); one required build fix stands (ci/W-503-spec-8.log #1). Do no W-503 step before they answer; the producer's default is to restore the signed composition. D-181 restores the signed screens and puts Home after W-301.

W-508 a shown reply: held: its review failed on the handoff it carried (ci/W-508-review-1.log on opus/W-508), and that branch still holds the two carried commits; its fate is decided after W-509. W-507 W-298's remainder: built, gates passed, on opus/W-507, parked until after M4 (D-181). W-509 a CLI verb lands a records PR: filed, next its spec.

Open problem: `bisellium tick` exited 1, all five sella dailies failed with "No conversation found with session ID"; diagnose (W-300-build/rebase-1105/tick.out). To file: a brief for a UI spec must name the signed composition it follows, so the drift is not repeated.

The Claude usage hold is ~98% (Patron 2026-11-05).

Research is its own lane, apart from the work lanes (Patron 2026-11-05). W-500 Runs screen is deferred until after MVP (Patron 2026-11-05); its status, their calls and the research are in its record.

W-073, W-438 and W-136 stay halted until the freeze ends (D-178). W-508 (a shown reply is never sent back, so no reply reaches the Patron twice) is exempt from the freeze on the Patron's word, 2026-11-05.

W-467 has not started: it follows W-503 in the Queue and takes the palette of W-451's Home. W-434 also links prototype hash, design digest, source tree, captures and reviews (design lead 11-01). To file: a decision replacing D-076 D's opus-per-class with a class registry and cost threshold. Also: a change so that `process.handoff.queue` reads studio/queue.yml, after which the id line above goes.

W-281 rides any records PR. Halted: W-427 (severity colours). Backlog: W-385 to W-391, W-397.

Later: every other opus record, re-ranked under D-083 A (last ranked list: history at 0553f97c). Greenlit (same history): none.
