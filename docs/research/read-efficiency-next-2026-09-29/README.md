# Next read-consumption investigation

W-107 remains a no-go. The broader goal is to reduce repeated source reading for Bisellium-managed projects without losing necessary context.

## Offline spot check

The frozen answer key identifies B8 source lines `docs/ADOPTION.md:400-428`. Baseline run 01 delivered lines 400-440 in transcript sequence 3; candidate run 02 delivered lines 400-490 in sequence 6. Both answers were incomplete in the sole censor verdict.

For E9, the answer-key anchors are `docs/program/PROGRAM.md:17-28` and `docs/program/PRODUCT.md:215-239`. Candidate run 07 delivered PROGRAM 1-53 and PRODUCT 1-228 plus 220-260 in sequences 8-9. Baseline run 08 delivered PROGRAM 1-45 and PRODUCT 160-240 in sequence 5. Both answers were incomplete.

These four runs show that delivery of answer-key anchor lines was insufficient for complete answers. They do not classify all seven omissions or establish that the delivered text was sufficient to interpret every qualification. No new model call was made for this check.

## Next experiment boundary

1. Complete the offline audit across all 12 retained runs, recording delivered/missing/uncertain for each answer-key fact and qualification. This is diagnostic, not a new censor verdict.
2. Specify a separate repeat-read receipt slice. Elide an unchanged body only when the consumer explicitly confirms it remains in its current context; cold starts, compaction, source changes and identity changes require the body again.
3. Test it with deterministic scripted repeated reads first. Require exact source spans, zero omitted unchanged bodies only in confirmed-resident contexts, and lower total delivered bytes including receipt overhead. Record cold-start overhead separately.
4. If those checks pass, evaluate actual task answers and provider usage under a fresh frozen design. Do not infer subscription savings from source bytes alone.

Source of record: [W-107 final report](../read-efficiency-evaluation-2026-09-28/run-v1-2026-09-29/report.md), its frozen answer key and run transcripts. W-107 code remains unmerged and opt-in.

## Completed offline diagnostic (2026-09-29)

The retained [anchor audit](anchor-delivery.json) joins the 12 run hashes to the sole censor verdicts. Eight of twelve runs received every frozen answer-key anchor line, yet five of those eight answers were incomplete. Four runs lacked some anchor lines; two of those answers were still complete. Anchor-line delivery is therefore a diagnostic, not a correctness verdict, and instruction text without line metadata remains outside this mechanical measure.

The retained [repeat-body audit](repeat-body.json) found only 5,489 exact repeated source-line bytes in baseline responses (2.31% of 237,951 bytes) and 4,305 in candidate responses (1.77% of 243,194 bytes). Even free removal of those exact repeated line bodies would fall far short of the prior 30% target on these one-shot tasks. This does not measure a longer workflow with repeated reads or other potential overhead savings.

The retained [tool-contract audit](tool-contract.json) found 12 candidate production calls, all to `locate`, all returning `INVALID_INPUT`; no `read` or `expand` production call succeeded or was attempted. The candidate then made 17 fallback calls whose responses totalled 178,866 bytes. The frozen runner advertised each production tool with `{type:"object",additionalProperties:true}`, so the model received no field-level schema for the strict production request. This identifies a trial-interface failure; it does not establish that a corrected interface would meet the accuracy or byte gates. W-107's NO adoption remains unchanged.

**Next cheapest test:** a fresh, separately scoped typed MCP adapter with a deterministic schema/argument canary, then one live model canary requiring a successful `locate` and `read` without fallback. Stop at that gate if it fails. Only after it passes should a new frozen multi-project answer and byte evaluation be considered. Defer receipt implementation until a workload demonstrates substantial repeated body text or a separate warm-workflow test justifies it.


## W-109 public source canary (2026-09-29)

The one public Luna-low canary failed with `TRANSCRIPT_MISSING`: one model
spawn occurred, but no production tool calls or usage were verified. The
independent Sol-high censor returned FAIL, citing terminal reason-order, the
pipe-grandchild test, and incomplete failure metadata. There was no retry,
adoption, or wider evaluation. W-108 remains FAIL/REFUSED and W-107 remains
NO.

## Cross-run repeat-body audit (2026-09-29)

The retained audit at commit `0d995ca` found 7,581 exact source-line bytes
reused across baseline runs, or 3.19% of 237,951 bytes, and 1,419 bytes
reused across candidate runs, or 0.58% of 243,194 bytes. These are optimistic
ceilings; the existing within-run figures were 2.31% and 1.77%. Receipt
suppression cannot reach the prior 30% target on these tasks, so receipt work
is deferred.

The broader goal remains active. The cheapest useful pivot is evidence
selection and answer completeness through Bisellium's deterministic
context/query seam. This is a direction for a fresh signed scope, not an
implementation-success claim.
