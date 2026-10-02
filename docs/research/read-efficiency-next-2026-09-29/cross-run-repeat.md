# Cross-run repeated source-body audit

This offline audit replays the frozen runs.json order and counts UTF-8 bytes for exact source lines already delivered in an earlier distinct run of the same project and arm. Identity requires project and arm stream, repository, path, SHA-256, absolute source line, and exact line text. Lines repeated only within the current run are classified separately and are not counted as cross-run repeats. All 12 runs mapped with zero failures.

The cross-run count is an optimistic upper bound for warm-session suppression: it assumes a later run could reuse every matching line at no receipt or context cost. It is not a billed-token saving or a correctness result; cold sessions still need the content.

| Project | Arm | Cross-run repeated body bytes | Read bytes | Upper bound of read bytes |
| --- | --- | ---: | ---: | ---: |
| bisellium | baseline | 502 | 56,817 | 0.88% |
| bisellium | candidate | 147 | 61,543 | 0.24% |
| epoch0 | baseline | 6,297 | 120,061 | 5.24% |
| epoch0 | candidate | 1,070 | 125,326 | 0.85% |
| yan-mo | baseline | 782 | 61,073 | 1.28% |
| yan-mo | candidate | 202 | 56,325 | 0.36% |
| **All projects** | **baseline** | **7,581** | **237,951** | **3.19%** |
| **All projects** | **candidate** | **1,419** | **243,194** | **0.58%** |

Frozen run order, with within-run repeats shown for distinction:

| Ordinal | Project / case | Arm | Within-run repeated bytes | Across-run repeated bytes |
| ---: | --- | --- | ---: | ---: |
| 1 | bisellium / B8 | baseline | 633 | 0 |
| 2 | bisellium / B8 | candidate | 308 | 0 |
| 3 | bisellium / B9 | candidate | 1,403 | 147 |
| 4 | bisellium / B9 | baseline | 1,384 | 502 |
| 5 | epoch0 / E8 | baseline | 2,006 | 0 |
| 6 | epoch0 / E8 | candidate | 698 | 0 |
| 7 | epoch0 / E9 | candidate | 965 | 1,070 |
| 8 | epoch0 / E9 | baseline | 771 | 6,297 |
| 9 | yan-mo / Y8 | baseline | 695 | 0 |
| 10 | yan-mo / Y8 | candidate | 281 | 0 |
| 11 | yan-mo / Y9 | candidate | 650 | 202 |
| 12 | yan-mo / Y9 | baseline | 0 | 782 |

The within-run totals (baseline 5,489; candidate 4,305 bytes) agree with the existing within-run audit (repeat-body.json). The per-run counts and calculation inputs are retained in cross-run-repeat.json; rerun with python3 cross-run-repeat-audit.py --output cross-run-repeat.json.
