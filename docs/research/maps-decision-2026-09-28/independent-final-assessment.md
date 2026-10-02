# Independent research validity assessment

2026-09-28. Assessor: separate Sol-high censor, maps_final_assessment. Research validity assessment, not an opus code-review gate. Exact returned assessment follows; file references identify the inspected checkpoint.

**VERDICT: INVALID / INCONCLUSIVE.** The current experiment cannot support an effectiveness or adoption decision.

**Finding:** The frozen plan requires the selected candidate’s executable implementation and hash before fresh-case preparation ([PLAN.md](/home/edckt/projects/bisellium/docs/research/maps-decision-2026-09-28/PLAN.md:22)). The sole execution record contains only `<one-off Python Path program>` ([analysis-commands.txt](/home/edckt/projects/bisellium/docs/research/maps-decision-2026-09-28/analysis-commands.txt:17)); the manifest hashes inputs, rules, and packet outputs, but no selector implementation ([selection-output-hashes.json](/home/edckt/projects/bisellium/docs/research/maps-decision-2026-09-28/selection-output-hashes.json:4)). No separate selector or fresh-run readiness artifact exists. No fresh cases began ([status.json](/home/edckt/projects/bisellium/docs/research/maps-decision-2026-09-28/status.json:66)).

The successful curated/empty/mutation controls establish that the evidence evaluator discriminates correctly on existing packets. Packet hashes establish output immutability. Neither check re-executes the selector or establishes that Policy B reproducibly generates `candidate-B.json`; they do not cure the provenance gap.

The six-case development result remains usable only as exploratory evidence about the frozen packets: packet B covered 17/17 positioned-anchor requirements and lost no baseline-complete case. It selected a candidate for fresh evaluation; it did not authorize an effectiveness or integration conclusion ([development-screen.md](/home/edckt/projects/bisellium/docs/research/maps-decision-2026-09-28/development-screen.md:24)).

The cheapest justified conclusion is to stop this bounded experiment on validity grounds and preserve its artifacts. This is **not** a negative retrieval result and must not be reported as evidence that baseline or Policy B fails. Any later attempt would be a restarted evaluation that first retains and hashes an executable selector and verifies it reproduces the frozen development packet before preparing fresh cases.
