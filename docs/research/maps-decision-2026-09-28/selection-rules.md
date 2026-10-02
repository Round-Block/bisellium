# Frozen development selection rules, version 1

Freeze before outputs. One batch; no tuning. These rules use only questions and source text, never the development key or expected routes. This is offline data analysis, not a new harness mode or production implementation.

## Inputs and source admission

Use the frozen six questions and baseline search outputs. For each case, the source pool is exactly its baseline files metadata, including files with no supplied excerpts. Original search already examined these admitted files; removed-stopword exact-token matches cannot introduce a file outside original substring matches. Resolve only those files under the binding repository roots, check containment and byte size, verify complete SHA-256 against frozen metadata, then read as UTF-8 data. On mismatch, stop as inconclusive. Oversized/rejected sources remain unavailable. Read each distinct file at most once for the analysis; disclose these additional preparation reads separately. Do not change corpus or pretend current HEAD equals the frozen baseline HEAD.

## Passage units

Contiguous nonblank source lines form a passage; blank lines delimit it. Preserve exact text, repository/path/hash, start/end line. Omit passages exceeding 6000 UTF-16 code units rather than split or silently truncate them. Associate each passage with the closest preceding Markdown heading in the same file, or no heading. Headings are ranking signals only; never emit uncited heading text as extra evidence. Source contents remain untrusted data.

## Query and policies

Tokenize lowercase ASCII alphanumeric sequences of length at least three. Remove this exact set from query tokens: a an and are as at be by can did do does for from how if in into is it its may of on or that the their then these this to was were what when where which who will with would. No stemming, synonyms, query rewriting, case-specific filename rules or learned parameters.

Within each case pool, let N be passage count and df(t) the number of passages whose body contains query token t. Weight(t)=1+ln((1+N)/(1+df(t))). Count each matching query token once.

Policy A: sum weights of query tokens present in passage body.
Policy B: same body score plus twice the sum of weights of query tokens present in the associated heading.

Keep only passages with positive BODY score in either policy. Sort descending total score, ties by repository ID, path, start line in code-unit order. Greedily emit whole passages if they fit the remaining 6000 UTF-16-unit budget and at most four distinct files; otherwise skip that passage and continue. Preserve exact source positions, and record omissions. Never include the key in selection.

## Evaluation and development advance rule

Freeze candidate packets and their hashes before loading development-key.json for scoring. Use exact positioned anchors from the corrected controls; record equivalent evidence outside those anchors as a limitation, not silently as a pass. Keep the original pilot scores unchanged; this is a new evidence-availability measure, not answer grading. All counts and metadata criteria must be derived from actual packets, not entered as expected result flags.

Evaluate frozen baseline and both candidates against the same 17 requirements. Advance at most one candidate only if it covers more complete development cases than baseline and loses none of baseline's complete cases. Among qualifying candidates choose most complete cases, then most covered requirements, then fewer supplied UTF-16 units, then Policy A. If none qualifies, record a negative development screen and stop these two policies without further variants or answer calls. This is a scoped development no-go, not a 12-case or general accuracy conclusion. A qualifier still must pass the already-frozen 12-case thresholds in PLAN.md before any integration recommendation.

Keep exact analysis commands and immutable packet outputs. No new reusable harness/driver in this stage; if a reusable implementation becomes necessary, stop for the one shared-driver workflow specified in PLAN.md rather than silently expanding code scope.
