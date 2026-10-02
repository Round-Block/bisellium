# MAPS evidence-sufficiency pilot: six fresh formulations

2026-09-28. Completed research pilot; no production change or adoption claim.

## Outcome

Prepared source routes supplied better factual coverage than the existing lexical-search baseline in this small pilot. They did not establish automatic route discovery, general accuracy or usage savings. The independent Sol-high assessment found no material unsupported claim, but neither condition satisfied every requirement of the frozen strict rubric.

| Measure | Curated routes (A) | Lexical search (B) |
| --- | ---: | ---: |
| Questions | 6 | 6 |
| Complete required-fact coverage | 4 | 1 |
| Partial required-fact coverage | 2 | 2 |
| No required-fact coverage | 0 | 3 |
| Supported citations | 6 | 6 |
| Material unsupported claims | 0 | 0 |
| All strict sufficiency requirements satisfied | 0 | 0 |
| Supplied excerpt characters | 7,917 | 35,999 |
| Source opens | 6 | 44 |
| Source bytes read | 182,159 | 382,956 |
| Omitted excerpt ranges | 0 | 985 |
| Rejected candidates | 0 | 2 |

These are observed counts from one run per condition, not estimates of general success rates or billed tokens. Source-read cost excludes curator setup and maintenance. Preparation separately records 22 distinct pre-existing files explicitly opened or hashed; internal context reads and elapsed preparation time were unmeasured. Route output has six case-file occurrences across five unique repository/path pairs; the preparation record's six excerpt-bearing files is a per-case total, not six distinct files.

## What failed and what did not

The assessor identified retrieval cap/order omissions in search cases B6, B7, Y6 and Y7. In the Yan Mo questions, earlier CLAUDE.md matches consumed nearly the entire character cap before the decisive workflow/spec passages were supplied. Complete candidate scanning did not imply sufficient returned context. Search E6 received the needed facts; E7 mixed an output-boundary omission with facts the model failed to mention.

Curated packets contained all keyed source ranges. Their two partial answers omitted requested or keyed details despite having evidence. Five curated answers and five search answers also omitted caveats that the private key treated as required, such as a policy document not establishing the state of a particular execution or build. Both correctly declined to infer a live deployment's migration ledger for E7. Missing a caveat is not the same as asserting an unsupported fact; the assessor found zero material unsupported claims.

The strict score remains 0/6 for each condition. We have not relaxed or rescored the key after observing answers. Some mandatory caveats concerned particular instances that the policy questions did not explicitly ask about. A future preregistered rubric should distinguish requested facts, genuine epistemic risk and optional boilerplate before running any new answers. The independent assessment found the keyed sources valid and no unscorable case, while recommending prospective clarification of caveat requirements.

## Method and limitations

Six new formulations, two per project, were frozen before the private key and routes. Source inspection and the earlier fixed-corpus selection influenced preparation, so these are not statistically independent holdouts. Both modes reused the unchanged reviewed W-103 harness, identical corpus manifests, default scan limits and per-case output caps of four files and 6,000 characters. References were prepared manually from the expected sources: this is a curated evidence upper bound, not a working topic-to-route selector.

Two fresh Luna-low contexts answered separately using identical instructions and only their own packets. They could not intentionally consult the private key under the assigned task. This is instruction-level isolation, not a filesystem access-control proof. No answer retries or corrections occurred. A separate Sol-high context assessed the frozen results against sources and the fixed rubric. Its first dispatch encountered model capacity; the same assessment was retried without altering answer inputs. Producer saved the assessor's exact returned text after its artifact-write tooling failed.

This compares bounded lexical evidence against prepared evidence, not ordinary autonomous agent browsing or an integrated Bisellium memory system. All same-condition questions shared one answer context. There were no model-performance replicates and no deployment observation. Both search rejections are the oversized epoch0 board, not source-project edits.

## Bounded next step

Prepare one small signed follow-on experiment: improve evidence selection under the same cap so an early broad file cannot consume all available context, and require a concise required-facts/unknowns check before returning an answer. Treat those as separate factors rather than assuming better routing alone fixes answer omissions. Freeze a clarified rubric and new questions first; include a modest independent replication after the selection change. Compare against this unchanged baseline, report map preparation separately, and do not expand to embeddings, a global memory authority or game workflow ingestion.

Any implementation uses separate specification, builder and review roles. The capability belongs inside Bisellium; epoch0 and Yan Mo remain managed reference projects with no direct MAPS installation. Production integration is not authorized by this research score alone.

## Reproducible evidence

- [Frozen protocol](protocol.md), [questions](questions.json), [preparation](preparation.md), [private key](answer-key.json).
- [Retrieval command arguments](retrieval-commands.json), [bindings](bindings.json), [route dataset](route-dataset.json), [raw search](search-results.json), [raw routes](route-results.json), [metrics](retrieval-metrics.json).
- [Packet A](packet-A.json), [packet B](packet-B.json), [identical answer instructions](answer-instructions.txt), [answer run record](answer-run-record.json).
- [Frozen answers A](answers-A.json), [frozen answers B](answers-B.json), [independent assessment](assessment.md), [assessment rows](assessment.json), [input hashes](frozen-input-hashes.json).

Raw retrieval commands emit JSON on stdout. Packet preparation removes the retrieval-mode label and captured-hash comparison, includes only files with supplied excerpts, and retains only the corresponding prefix of each file's ranges list. Both conditions preserve identical provenance/coverage/metrics fields. Packet A is route; packet B is search. The last supplied range can be partially excerpted at the character cap; range endpoints do not prove unseen text was supplied.
