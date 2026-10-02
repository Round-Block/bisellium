# MAPS lookup investigation: completed with a scoped no-go

Decision: do not integrate either tested lookup method on this evidence. The heading-assisted candidate retrieves more required evidence than the W-103 experimental search baseline, but neither meets the agreed reliability floor. Stop this bounded comparison; keep production behavior unchanged. This is a conclusion about these fixed methods and limits, not a rejection of MAPS ideas or agent memory generally.

## Reproducibility repair completed

W-105 is DONE. The missing historical selector was reconstructed as new retained code, not retroactively recovered. Its output reproduces the original selected passages, order, text, source identities, budgets and omissions. Eight binary64 score leaves differ by at most 3.552713678800501e-15; architect amendment A1 permits at most 4e-15 only on those score fields, without changing ranking. Ten focused tests and official tests/lint/types pass. The independent Sol-high censor passed round 4 after correcting source-identity and baseline-truncation handling. Certified tree: d5f96a6135d00feba89f00acb42aa778023d4ad3. Accepted 23-file implementation freeze: 5ebf97ca3925d7bf2d9a3ad52bb5b9715d12c0a7e36caee42aa2a354e039ee21. Worktree closeout commit: 5efe274.

The research driver is retained in `/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/maps-repair-driver.mjs`, with tests and W-105 evidence beside it. W-103 and W-104 remain completed historical work.

## What the completed comparison shows

| Project | Baseline complete cases | Heading-assisted B complete cases |
|---|---:|---:|
| Bisellium | 0/4 | 1/4 |
| epoch0 | 0/4 | 2/4 |
| Yan Mo | 1/4 | 2/4 |
| Total | 1/12 | 5/12 |

The mandatory floor was 10/12 overall and 3/4 for every project. Both methods fail it. B adds four complete cases and loses none, but the gains do not meet the reliability requirement. Requirement coverage was 4/25 for baseline versus 16/25 for B; anchor coverage 6/49 versus 30/49. Context supplied was 72,000 versus 71,354 UTF-16 units, so the result does not demonstrate material context or account-usage savings. No answer-generation trials ran.

Two different causes matter. For B8, greedy selection used 5,987 units and then omitted a 172-unit adjacent snapshot passage needed alongside the send-result evidence. For E11, the required BOARD.md was 322,573 bytes and could not pass the 262,144-byte file-size limit. Ranking cannot recover a rejected source. At least one sample case was therefore unreachable under the frozen setup, limiting any interpretation as pure ranking quality. The conservative no-go remains the decision for the complete tested setup.

## Validity and recovery limits

The original fresh scoring is INVALID. The low-cost preparer generated 24 malformed multiline end coordinates and overbroad labels; the execution clerk proceeded after the required packet-seal write failed. Its original 1/25 and 0/12 scores are incident records, never effectiveness results. The failure is documented in `execution/incident.md`; post-score preservation is explicitly not a pre-score freeze.

A separate packet-blind Sol context rebuilt labels from the already frozen 12 questions and 25 requirement meanings and the unchanged 23 source files. A second packet-blind Terra context independently checked all meanings and 49 minimal anchors; five incidental spans were trimmed before final approval. Both complete correction diffs are retained. The final corrected key and unchanged packets were then included in a 39-file manifest, verified before exactly one new scoring process per arm. No retrieval, questions, requirement meanings, sources, selector or packets changed.

This is a post hoc, packet-fixed, blind label-correction reanalysis. The independent final assessment accepts it only for a conservative scoped stop decision. It cannot satisfy the original preregistered acceptance gate, justify advancing B, establish universal accuracy, or demonstrate a production memory system. A positive claim would require a genuinely new, properly sealed study; none is authorized or needed to close this negative investigation.

## Durable artifacts and follow-up

- Independent decision: `independent-final-assessment.md`.
- Accepted recovery procedure: `recovery-assessment.md`.
- Final blind labels/validation/diffs: `correction/`.
- Actual once-only recovery script: `run-posthoc-reanalysis.py`.
- Pre-score seal, commands, score files and aggregates: `reanalysis/`.
- Original questions, labels, packets and invalid scores: preserved under `preparation/` and `execution/`.
- Follow-up W-106 is backlog only in the research worktree: enforce label validation and packet sealing so a failed gate stops execution mechanically. No production implementation, push or merge occurred.

Reference repositories remained read-only. Reproduction requires the referenced local source bytes and frozen bindings; absolute WSL paths are recorded. The root checkpoint moved from 13% to 27% account usage consumed during repair/closeout, a coarse shared-account movement rather than exact task billing. No reset was redeemed. The repair and data corrections cost substantially more than intended; there are no further variants or model trials in this study.
