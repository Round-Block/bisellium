# W-107 delivered source-body byte attribution

This offline audit attributes the 12 frozen transcripts to logical UTF-8 source-body bytes and response residuals. The script joins each body record by repository, path, SHA-256 and line span to the frozen answer key. A line inside any keyed span is counted as keyed-anchor body; another line in a file with keyed spans is counted as non-keyed body in a keyed file; other source files form the third body class. The response residual is transcript response bytes minus logical body bytes, so it contains serialized JSON escaping and structure, orientation/non-source content, errors, and any other text without a mapped source body.

| Arm | Transcript response total | Keyed-anchor bodies | Other lines in keyed files | Other source-file bodies | Response residual |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 237,951 | 16,539 | 73,297 | 1,944 | 146,171 |
| Candidate | 243,194 | 16,080 | 69,530 | 1,643 | 155,941 |

Both rows reconcile exactly to the W-107 report totals, with zero unmappable body spans. Keyed anchors are only a lower bound on necessary evidence: surrounding or otherwise unkeyed text may be needed to interpret an answer, and non-keyed bytes are not automatically waste. Residual bytes are not all overhead that can be removed; JSON structure and orientation carry information, while only part of the residual is error metadata.

For the candidate, the transcript exposes 12 production calls (all `locate`) with 684 response bytes and no source body; the retained tool-contract audit records all 12 as `INVALID_INPUT`. The 17 fallback calls delivered 178,866 response bytes, comprising 87,253 logical source-body bytes and 91,613 residual bytes. The remaining 63,644 bytes are from six `orient` responses. This splits the candidate source bodies: 16,080 keyed-anchor bytes and 71,173 other source-body bytes were delivered through fallback. Baseline's 23 calls were the bounded-read tools and delivered all 91,780 source-body bytes. Per-run response totals, event tools/statuses, category counts, top files, and call counts are in the JSON.

The largest source-response files by logical body bytes were:

| Rank | Baseline | Bytes | Candidate | Bytes |
| ---: | --- | ---: | --- | ---: |
| 1 | `epoch0-main/docs/program/BOARD.md` | 54,697 | `epoch0-main/docs/program/BOARD.md` | 37,524 |
| 2 | `bisellium-main/docs/ADOPTION.md` | 6,429 | `epoch0-main/docs/program/PRODUCT.md` | 15,009 |
| 3 | `epoch0-main/docs/program/PRODUCT.md` | 5,455 | `bisellium-main/docs/ADOPTION.md` | 7,768 |
| 4 | `bisellium-main/studio/decisions/D-014.md` | 5,377 | `bisellium-main/studio/decisions/D-014.md` | 6,383 |
| 5 | `yan-mo-main/docs/vertical-slice-spec.md` | 5,098 | `yan-mo-main/docs/vertical-slice-spec.md` | 5,086 |

The frozen run records also report 865,860 baseline input tokens (696,576 cached; 169,284 uncached) and 1,235,212 candidate input tokens (1,011,200 cached; 224,012 uncached), across 23 and 35 calls respectively. These are separate model-usage measures and are not source-byte equivalents; this descriptive audit makes no causal claim about the difference.

Reproduce with `python3 docs/research/read-efficiency-next-2026-09-29/source-byte-attribution.py --output docs/research/read-efficiency-next-2026-09-29/source-byte-attribution.json`. The script exits nonzero on a transcript-byte mismatch, line-span mapping failure, aggregate mismatch, or failure to reconcile to 237,951 / 243,194.
