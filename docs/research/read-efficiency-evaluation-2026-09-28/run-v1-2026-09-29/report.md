# W-107 targeted-read implementation: NO adoption

Completed evaluation and independent decision: 2026-09-29. This is the producer's summary of the sole censor's returned assessment, not a separate review verdict.

## Decision

Do not adopt this version as Bisellium's read-consumption solution. The implementation exists on `codex/read-efficiency` in `.worktrees/maps-lookup-experiment`; it is unmerged and opt-in. Official censor gate: FAIL. W-107 remains building with an explicit blocked/no-adoption handoff; it is not falsely marked done. No further tuning or replacement trials are authorized under this evaluation version.

## Observed outcome

| Measure | Existing bounded reads | Targeted reader | Required result |
| --- | ---: | ---: | --- |
| Complete, qualified, cited answers | 2/6 | 3/6 | Both 6/6 |
| Delivered source-response bytes | 237,951 | 243,194 | Candidate at most 166,565.7 bytes |
| Source-access calls | 23 | 35 | At most 12 per task |

Candidate source-response text increased **2.2034%**, instead of falling at least 30%. Calls increased **52.17%**. All twelve completed runs had valid delivery audits and stayed within the per-task call cap. The independent censor found their stated claims factual, cited and unsupported-claim-free, but seven answers omitted required facts or qualifications.

| Project | Baseline bytes | Candidate bytes | No-increase gate |
| --- | ---: | ---: | --- |
| Bisellium | 56,817 | 61,543 | FAIL |
| epoch0 | 120,061 | 125,326 | FAIL |
| Yan Mo | 61,073 | 56,325 | PASS |

The earlier 93% reduction was a known-section packet-size observation. It excluded an actual task-solving comparison. These live runs include orientation, discovery, expansions, response metadata, errors and fallbacks, and therefore do not reproduce that preliminary saving.

## Implementation and checks

Built a strict opt-in `bisellium source` locate/read/expand interface with explicit project/repository registration, source identity and hashes, bounded exact text, heading context, orientation validation, controlled expansion and confinement. Added a standard-library evaluation runner, source-response logging, frozen-input validation, audit/review packaging and deterministic aggregation. Repeat suppression and a durable source-memory system were not implemented or tested.

Eight genuine recorded reds, focused tests, full repository tests, typecheck and lint passed. Live Unicode/error-delivery and forbidden-tool canaries passed. The censor independently reproduced tests, typecheck and lint (three lint warnings, no errors). Product review was bounded because acceptance already failed; no exhaustive approval is implied.

Reviewed source tree: `0e4c3f0d931539b3c6096f34cedbabd7763b98d1`. Current official verdict bookkeeping commit: `2c90e30`; source reader/runner did not change after the evaluation freeze. The worktree's CLI-owned receipt is `studio/ci/W-107-review-1.log`.

## Evidence limitation

The executing clerk initially encountered a reported pre-output ordinal-1 `ENOENT` and retried after creating the parent directory. It did not preserve the original failure and command as a contemporaneous file record. Later session-transcript recovery is explicitly labelled as retrospective and does not prove identical-retry provenance. The censor therefore also classifies the evidence as invalid under the agreed retention rule. No historical receipt was fabricated and no trial was rerun to improve the result.

Pretrial manifest-validator defects were corrected with recorded regressions before any held-out model run: provenance/status was a string rather than an object, and UTC `+00:00` is equivalent to `Z`. Original held-out questions, source snapshots and answer key stayed unchanged. Original rejected validation receipts are retained.

## Interpretation and limits

The tested implementation does not meet the agreed adoption criteria. This does not establish that all targeted reading, all memory systems, or other models fail. These are six fixed tasks and one run per arm using `gpt-5.6-luna` at low effort. Baseline also failed completeness, so neither approach demonstrated reliable task completion here. Omissions alone do not identify whether the cause was missing retrieval or answer synthesis; that causal question was not separately tested.

The deterministic helper reports `implementation failure` because its semantic gate fails first. That label is not proof of a production-code defect. The censor additionally records insufficient savings and invalid evidence. Observed byte counts are not subscription or monetary savings; provider-token observations are retained separately. No general efficiency or safety claim is warranted.

## Authoritative evidence

- [Censor's exact assessment](censor/review.md) and [exact answer verdicts](censor/answer-verdicts.json)
- [Deterministic decision](decision.json)
- [Final mechanical prereview](pre-censor-prereview.md)
- [Retrospective retry limitation](retry-evidence-limitation.md)
- [Frozen implementation/input manifest](freeze.json), [run list](runs.json), and [retained execution commands](commands.txt)
- [Anonymous review packet](review/review-packet.json) and [scoring package](review/scoring-package.json)
- [Current certification command/output](certification/verify.log)

Retain the implementation and raw evidence for inspection. Keep the already-shortened handover and ordinary bounded reads. Any new design or trial needs a separately specified scope and fresh evaluation; this no-go must not be relabelled as a success.
