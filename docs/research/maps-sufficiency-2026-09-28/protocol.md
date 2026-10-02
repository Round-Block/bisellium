# MAPS evidence-sufficiency pilot protocol

Date: 2026-09-28. Status: frozen before answer trials. Research only; W-103 remains completed and its implementation is unchanged.

## Question and scope

Can a small bounded packet of retrieved source evidence support a correct, cited answer to six new question formulations, two each from Bisellium, epoch0 and Yan Mo? MAPS-inspired navigation belongs inside Bisellium, which manages the reference projects. Neither reference project is modified.

Reuse the reviewed W-103 harness and its fixed project corpus manifests. A separate Sol drafting context prepares questions before its answer key and curated routes. Existing-source familiarity and previous corpus selection mean these are fresh formulations, not independently sampled or statistically held-out cases. Curated routing uses source inspection: it tests sufficiency of selected evidence, not autonomous route discovery.

## Two conditions

Run deterministic lexical search and curated routes on the same six questions with identical limits: default scan limits, at most 4 excerpt-bearing files and 6,000 excerpt characters per case. Preserve complete raw harness results. Give each answer runner only question/project/id, cited source excerpts, and explicit coverage/failure/truncation information. Remove captured expected hashes and private answer-key content. Both packets retain equivalent metadata fields and neutral condition labels.

Use two separate fresh Luna-low contexts, one per condition, with identical instructions. Each answers all six questions using only its packet, cites supplied references, explicitly identifies missing evidence, and does not read project files, search or inspect the private key. One run per condition: do not retry bad answers or improve packets after observing scores. Conditions are separated to avoid answer contamination; all same-condition cases share a context, a limitation. Model settings must match. This pilot does not compare unaided agent browsing or production map discovery.

## Assessment fixed in advance

A separate Sol-high assessment receives both frozen answer outputs, packets and private key after answers are saved. For each question and condition record: required-fact coverage (complete/partial/none); citation support (supported/partial/unsupported); unsupported material claim (yes/no); required uncertainty (satisfied/missed/not applicable); and sufficient (yes only if all required facts or required abstentions are supported, citations are supported, and no unsupported material claim occurs). Separate retrieval omission from answer-generation error. If the key is ambiguous or wrong, flag the case unscorable with reasons; do not silently amend it to favor a condition. This is a research assessment, not a new implementation review gate.

## Cost and reporting

Reuse the frozen inputs, record actual source bytes/opens, supplied excerpt characters and packet sizes, and disclose preparation/maintenance separately. Account-usage percentages are coarse shared measurements, not per-arm billing. No token, cost, general accuracy or subscription-savings claim from this tiny pilot. No full repository builds for research-data-only work. End with observed limitations and a bounded next-action recommendation; production work still needs a separate signed brief and normal workflow.
