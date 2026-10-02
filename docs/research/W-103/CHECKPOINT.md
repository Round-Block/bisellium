# W-103 resumed: 2026-09-28

The Patron reports limits reset and authorizes continuation. The account tool confirmed 1% weekly usage consumed (99% remaining); no reset credit was redeemed by this session. A separate builder-sol dispatch fixed the two round-1 findings using existing reds 7/8. All 37 targeted tests pass. Refreshed search counters are 150 directories and 415 candidates; route results are unchanged. Full verification and independent review are next. Review remains FAIL until new verification, Terra pre-review and independent Sol-high round 2. The pause described below is historical.

# W-103 stop checkpoint: 2% usage remaining

Current state supersedes all historical notes below. Independent Sol-high review round 1 is FAIL (`studio/ci/W-103-review-1.log`). Two concrete contract violations remain: canonical exclusion normalization performs uncounted metadata work before budget enforcement; excerpt caps reset per repository instead of being shared by the whole case.

Both findings now have genuine assertion-level regression reds recorded BEFORE fixes: `studio/ci/reds/W-103/07.log` and `08.log`. Test-only commit: `55a30e6`. Implementation has not been changed for these findings. Current targeted suite therefore intentionally contains failing regressions; earlier 33-pass/full-verifier results apply to the earlier candidate, not acceptance of the current tests.

Next exact step: dispatch builder-sol to fix only these findings using existing reds 7/8; correct the erroneous undercount expectation in regression 6 explicitly identified by censor (retain alias protection and assert honest counters). Keep exclusion resolution within actual directory/candidate budgets before operations; share file/character output budgets across all repos of one case. Rerun comparisons and refresh reports if counters change, then targeted/full verification and fresh Terra pre-review + independent Sol-high censor. Do not mark done without that PASS.

User stop threshold has been reached: tool reported 98% weekly use, 2% remaining. No more model sessions until the user authorizes continuation or usage resets. No reset credit redeemed; no push/merge or reference-project changes. W-103 full-payload review transfer was explicitly approved and successfully executed; the earlier approval blocker is resolved.

## Historical checkpoints (superseded)

# W-103 current checkpoint: replacement built, review pending

This section supersedes the historical checkpoint below. The user authorized continuation until 2% account usage remains; most recent tool reading before local final checks was 7% remaining. No reset has been used.

Replacement implementation is complete. The strengthened tests are unchanged; root reproduced 31 targeted test passes with test isolation disabled, then typecheck, lint and targeted formatting passed. The initial prototype and invalid original reds remain explicitly rejected historical artifacts. Five genuine restart reds preceded this replacement build.

Both modes ran 15 cases with refreshed bindings/results. Search read 957,390 bytes with 1,299 omitted excerpts; routes read 90,310 bytes with no output omission. The epoch0 board exceeds the signed 256 KiB cap: 5 search rejections and 2 route rejections. Complete scan means every candidate considered, not every source successfully read. No semantic quality or usage savings conclusion follows.

Next: repository verifier; fresh Terra pre-review; independent Sol-high censor; persist actual verdict and gate evidence through owning CLI. DO NOT mark done or claim review PASS yet.

External review transfer is currently blocked by automatic approval review despite the user's prior W-103 approval. An explicit confirmation naming full brief/source/tests/report and Terra/Sol reviewers is pending. Do not retry that transfer until the confirmation arrives. Local deterministic checks may continue. Files are in isolated branch codex/maps-lookup-experiment; no push/merge or target-project writes.

## Historical test-first checkpoint (superseded current-state statements)

# W-103 continuation checkpoint

Status: intentionally failing test-first checkpoint; NOT complete or reviewed.

Branch: `codex/maps-lookup-experiment`.
Worktree: `/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment`.
User reported 8% account usage remaining; no reset redeemed. Stop new model-heavy work at this checkpoint to conserve it.

## Completed

- Signed brief: `studio/briefs/W-103.md`, separate Astra-medium architect after Sol security red-team. Root mechanically replayed its approved ready command after greenlighting (initial architect attempt was rejected solely because state was backlog).
- Initial Sol prototype and both15case runs were produced. Root full npm test passed and original focused5tests passed, but Terra found actual acceptance defects and insufficient tests.
- Initial red logs were exit-only, not assertion evidence. They are preserved unchanged in `rejected-initial-reds.json`. Do not count them as qualifying.
- Explicit restart: original implementation preserved as non-executable `rejected-prototype.mjs.txt`; current harness is a non-I/O skeleton with stronger tests. This is NOT a reconstruction of purported historical reds.
- Root ran each new behaviour-specific test through the owning red CLI outside the builder sandbox BEFORE replacement implementation. All five current `studio/ci/reds/W-103/01.log` through `05.log` contain AssertionError/ERR_ASSERTION payloads, no TypeError or module-not-found failure.

## Current artifacts and validity

`bindings.json`, `search-results.json`, `route-results.json`, and the original numerical report describe the REJECTED FIRST PROTOTYPE. They are not accepted experiment findings and do not describe the current skeleton. Preserve their historical designation until replaced with actual reviewed reruns; do not infer savings from them.

The current `.test.mjs` is about600lines with five grouped behaviours. Tests are expected to FAIL until Phase B. Use `node --test --test-isolation=none` to obtain useful assertion output in sandboxed Node25 sessions; default isolation previously concealed it. Recorded tests use a behaviour filter. Source and tests are confined to the two owned files.

## Next exact action

Dispatch a separate builder-sol implementation session for Phase B against the signed brief and strengthened tests. The five new reds are already recorded; do not reset them or rerun an artificial stub to backfill evidence. Implement the actual requirements; no production CLI/schema/game-adapter changes or target-project writes. Consult `initial-prereview.txt` for observed defects. The rejected prototype may be inspected as rejected source, never assumed correct.

Run the targeted suite with isolation disabled, required typecheck/full npm test and formatting/lint as appropriate; root may proxy sandbox-blocked commands and commits. Then rerun both15case modes, honestly replacing the historical report/results. Fresh Terra pre-review and independent Sol-high censor are still required, as are normal verifier/gate evidence and final lifecycle advancement. No review PASS has been issued; W-103 remains building.

## Authorization and dispatch

The user explicitly approved scoped W-103 OpenAI Codex CLI sessions after auto-review rejected the transfer under earlier W-102-only approval. Scope covers red-team/signing/implementation/review of this experiment. Built-in collaboration dispatch hit a thread limit. CLI role prompts must explicitly say the session IS the delegated role, not producer, and must not delegate again. Keep dispatches bounded and sequential; no further broad MAPS research.

No reference project was written, no merge/push performed, and no usage reset redeemed. Original pre-existing root W-101/QA actum/worktrees remain untouched.

## Follow-up input preflight

A deterministic check validated all 15 cases and all 22 curated references: each has an unambiguous project/repository binding, an existing contained file, a valid line range, and an unchanged captured SHA-256. No source content drift was found. See `input-preflight.json`.

The historical baseline corpus has two missing entries among 25: epoch0 `package.json` and Yan Mo root `project.godot`. Correct or explicitly justify these in the NEXT run's bindings; do not silently rewrite historical results. Yan Mo's actual project file is under `game/`, but `.godot` is not in the signed corpus extension list, so merely changing its path is not a complete fix. A project overview can provide relevant input without broadening the signed corpus policy. No changes to the harness, original bindings, original results or reference projects were made by this preflight.
