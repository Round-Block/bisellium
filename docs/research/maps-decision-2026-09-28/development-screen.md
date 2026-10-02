# Development screen

Controls replayed successfully: curated 17/17, empty 0/17, and all 39 actual single-anchor mutations detected. Scoring below measures exact positioned-anchor evidence availability, not answer quality.

| Policy | Complete cases | Covered requirements | Supplied UTF-16 units | Lost baseline-complete cases | Qualifies |
|---|---:|---:|---:|---|---|
| baseline | 2/6 | 6/17 | 36000 | — | n/a |
| A | 3/6 | 11/17 | 35747 | E7 | no |
| B | 6/6 | 17/17 | 35749 | none | yes |

## Case results

| Case | Baseline | A | B |
|---|---:|---:|---:|
| B6 | incomplete (0/3) | incomplete (1/3) | complete (3/3) |
| B7 | incomplete (0/3) | incomplete (0/3) | complete (3/3) |
| E6 | complete (3/3) | complete (3/3) | complete (3/3) |
| E7 | complete (3/3) | incomplete (2/3) | complete (3/3) |
| Y6 | incomplete (0/3) | complete (3/3) | complete (3/3) |
| Y7 | incomplete (0/2) | complete (2/2) | complete (2/2) |

## Decision

**advance**. qualifies under frozen development rule No fresh 12-case evaluation or model-answer run is authorized by this result.

The result is scoped to these six frozen cases and these two fixed policies. Equivalent evidence outside the exact anchors was not credited. E7-R3 was evaluated from packet structure only: each policy supplied static repository excerpts and exposed no deployment ledger, startup evidence, or schema-migration rows.

The root is currently `44604163087b7a51c26cb0064c005acd22182ffc`, while the frozen baseline records `f391`. This is a snapshot-identity difference caused by plan-document commits; all 21 admitted source reads matched the frozen per-file SHA-256 values, so the compared source bytes did not drift. Preparation opened those 21 distinct admitted files once each in addition to the baseline retrieval.
