---
id: "2026-10-08-lesson-audit"
title: "Audit of the 45 lessons D-047 stamped as history"
kind: consultation
author: qa-lead
at: 2026-10-08T11:49:39Z
---
Asked by the Patron, 2026-10-08 ("we need to audit the 45"). Drafted by Codex `gpt-5.6-sol` from the current code
(`~/.bisellium-evidence/meta-retro/audit/`: prompt.md, audit.json, session.log); two live verdicts spot-checked by the
producer; stamps applied by the kept script restamp.mjs. Verdicts: 24 closed, 1 obsolete, 20 live.
A lesson still stamped D-047 is either audited closed or obsolete (named below), or live and pending the Patron (14).

| Lesson | Class | Verdict | Stamped | Evidence or fix |
|---|---|---|---|---|
| L-003 | review×no-builder-isolation | closed | W-125 | A builder can no longer run through this command without the required repository isolation. |
| L-006 | spec×spec-error-by-orchestrator | live | W-169 | carried by W-169. Concurrent briefs can still claim overlapping Files owned boundaries, and backlog opus W-169 carries the required overlap refusal. |
| L-010 | review×no-builder-isolation | closed | W-125 | The command now blocks the unisolated builder execution described by the lesson. |
| L-015 | mechanism×opus-lifecycle-transition-no-cli | closed | D-047 | Supported CLI verbs now perform the lifecycle transitions instead of requiring manual bookkeeping. |
| L-016 | mechanism×review-evidence-path-not-updatable | closed | D-047 | The review command now records the evidence path through the supported lifecycle mechanism. |
| L-018 | mechanism×partial-env-filter-false-red | closed | D-047 | Partial filtering can no longer leave an internally inconsistent Git configuration that produces this false failure. |
| L-020 | process×insurance-clause-fired | closed | D-047 | The check now distinguishes the permitted repository-root link from an actual officina escape. |
| L-023 | review×self-certified-close-rejected | live | D-047 | new: Require every build review gate and verdict to name the manifest QA censor (medium). runReview still permits the builder identity to certify its own work, and packages/commands/src/lifecycle.test.ts:3165-3166 preserves that behavior. |
| L-024 | workflow×dispatch-before-brief | live | W-068 | carried by W-068. The workflow still lacks enforced task dependencies that prevent dispatch before a prerequisite brief lands, which greenlit opus W-068 carries. |
| L-025 | workflow×reviewer-renumbers-stale-round | closed | D-047 | A reviewer can no longer renumber from stale local state or replace an existing round verdict. |
| L-026 | docs×architecture-graph-not-regenerated | live | D-047 | new: Make architecture graph drift a failing generated-document check (low). The architecture generator can print a graph, but no check compares its output with the committed document. |
| L-027 | mechanism×usage-not-emitted-for-opera | live | D-047 | new: Emit and require opus-attributed usage for every dispatched agent turn (medium). runEmit exists in packages/commands/src/writes.ts:529-571, but dispatch does not invoke it automatically and no rule rejects missing usage. |
| L-028 | process×handoff-missing-before-close | live | D-047 | new: Refuse completion until the opus has a current handoff (medium). runDone does not require a traditio, while the traditio.present check applies only to active states. |
| L-029 | process×mutation-testing-skipped | live | D-047 | new: Require recorded mutation evidence before the review gate can pass (medium). The review gate can still pass without evidence that the relevant assertions were challenged by mutations. |
| L-030 | mechanism×vendor-spend-unmetered | live | W-081 | carried by W-081. Provider usage still lacks a pinned reviewed reader, which greenlit opus W-081 explicitly carries. |
| L-031 | process×background-jobs-not-reaped | live | D-047 | new: Make the task harness reject redundant polling wait loops for jobs it already monitors (medium). The current tracking mechanism does not prevent manually launched pgrep or sleep polling loops from outliving or duplicating harness monitoring. |
| L-032 | spec×wire-attribute-reused-off-semantics | closed | D-047 | Delegation no longer writes the wire attribute with the incorrect semantics. |
| L-033 | tests×assertion-satisfied-by-the-wrong-cause | closed | D-047 | The affected refusal tests now prove the intended rejection cause instead of accepting any failure. |
| L-034 | tests×one-sided-bound-assertion | live | D-047 | carried by W-138. The original assertions were repaired, but no class-wide control prevents another lower-only bound, and backlog opus W-138 carries this recurring finding class. |
| L-035 | tests×wall-clock-sleep-for-a-missing-seam | closed | W-121 | The original raw sleep is gone and the rule catches the same primitive if reintroduced. |
| L-039 | environment×sandbox-forces-proxy-evidence | closed | W-125 | Proxy-executed evidence must now be backed by a host-certified receipt before review can pass. |
| L-040 | mechanism×unpinned-by-test | closed | W-079 | The specific guards that were previously unpinned now have tests that fail if their behavior disappears. |
| L-041 | process×insurance-clause-fired | closed | W-120 | The checker now rejects a decision invoked after its owning work was killed. |
| L-042 | spec-gate×self-signed | live | W-080 | carried by W-080. A self-signed specification gate remains possible, and greenlit opus W-080 carries the detector. |
| L-043 | architecture×containment-helper-duplicated | closed | D-047 | Duplicated containment behavior is now inventoried and tested against the shared implementation. |
| L-044 | design×indirection-duplicates-source-of-truth | live | W-117 | carried by W-117. Tier and seat records still duplicate authority, and greenlit opus W-117 carries their removal. |
| L-045 | mechanism×id-allocation-local-tree-only | closed | W-101 | ID allocation now considers repository-wide refs instead of only the local working tree. |
| L-046 | mechanism×identity-normalization-not-centralized | closed | W-089 | Identity normalization now flows through shared functions rather than divergent call-site logic. |
| L-047 | mechanism×served-suite-does-not-rebuild-bundle | closed | W-110 | The served suite now rebuilds the bundle before testing it. |
| L-048 | research×claimed-metric-without-enforced-methodology | obsolete | D-047 | The claimed metric and the workflow that depended on it were abandoned rather than retained as current studio evidence. |
| L-049 | review×security-boundary-found-after-censor-pass | live | W-093 | carried by W-093. Security-boundary review is still not guaranteed before the ordinary censor pass, and greenlit opus W-093 carries per-PR security review. |
| L-050 | tests×wall-clock-sleep-for-a-missing-seam | closed | W-121 | The affected test is synchronized on an explicit event instead of elapsed wall-clock time. |
| L-051 | workflow×failure-report-not-actionable | closed | W-130 | Preparation failures now expose enough causal output to act on without rerunning blindly. |
| L-052 | workflow×files-owned-boundary-exceeded | closed | W-125 | A builder export that exceeds its Files owned boundary is now blocked before acceptance. |
| L-053 | design×indirection-duplicates-source-of-truth | live | D-047 | carried by W-138. host-cells.mjs and run-builder-host.mjs still derive runtime paths separately, and backlog opus W-138 carries this recurring duplication class. |
| L-054 | interface×validation-order-masks-errors | closed | W-131 | An oversized body can no longer mask the more specific invalid-flag error. |
| L-055 | mechanism×evidence-prune-candidate-collision | closed | W-131 | Evidence pruning no longer mistakes those logs for disposable candidates. |
| L-056 | mechanism×post-image-only-change-classification | closed | W-131 | Change classification now evaluates paths without Git rename pairing hiding the pre-image. |
| L-058 | mechanism×replay-environment-not-pristine | live | D-047 | new: Reset the replay cell's private HOME after web bundle preparation before replaying the recorded command (medium). scripts/run-builder-host.mjs:743-764 reuses the preparation HOME for replay, so package tooling can leave state that changes the replay result. |
| L-059 | mechanism×served-suite-does-not-rebuild-bundle | closed | W-110 | The suite can no longer silently exercise a stale served bundle. |
| L-060 | mechanism×unpinned-by-test | live | D-047 | carried by W-138. The no-not-ok-title guard at scripts/run-builder-host.mjs:715-717 still lacks a direct regression test, and backlog opus W-138 carries this recurring class. |
| L-061 | process×insurance-clause-fired | live | D-047 | new: Detect Date.now-based wall-clock waits in tracked tests under test.sleep (high). The test.sleep grammar in packages/cli/src/rules/tests.ts:41-50 does not recognize Date.now polling, so the insurance check can still be routed around. |
| L-065 | spec×runtime-dependency-undocumented | live | D-047 | new: Declare coreutils mkfifo as a host runtime dependency for the Git broker (medium). scripts/git-broker.mjs:58-61 spawns mkfifo, but the host runtime contract does not declare that dependency. |
| L-066 | tests×one-sided-bound-assertion | live | D-047 | carried by W-138. The affected census assertion is now exact, but no class-wide control prevents another one-sided bound, and backlog opus W-138 carries the recurring class. |
| L-068 | tests×wall-clock-sleep-for-a-missing-seam | live | D-047 | carried by W-138. The local Date.now wait was removed, but test.sleep still cannot detect that form of polling and backlog opus W-138 carries the scanner-bypass class. |
