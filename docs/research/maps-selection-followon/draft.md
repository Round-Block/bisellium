# MAPS selection follow-on: draft experiment

Date: 2026-09-28. Proposal; the controlling implementation contract is `studio/briefs/W-104.md`, including its exact queue, trust-boundary and frozen recovery rules. W-103 and the frozen six-case pilot, packets, answers, assessment, and scores remain unchanged.

## Decision

Test one additive experimental `search-diverse` mode in the W-103 research harness. Keep lexical matching, corpus manifests, scan limits, repository/path ordering, provenance, failures, and existing `search` and `route` modes unchanged. Change only how already-found ranges receive the output budget.

The unchanged harness cannot test this fairly through data alone. It sorts repository IDs and corpus paths internally, then spends the shared excerpt budget while visiting files. Reordering `corpusFiles` is inert. Artificially splitting a checkout changes accounting and still permits a broad first file to consume the cap. Excluding root guides or using curated routes injects knowledge of desired sources. A narrow code change is required.

## One selection policy

Scan and match exactly as `search` does, but buffer matches until the bounded scan finishes.

1. Select the first distinct matching files in existing repository-ID/path order, up to `excerptFiles` (four here).
2. Allocate excerpts in cycles. Every selected file with an un-emitted range gets one turn before any file gets another.
3. A turn may emit the next range prefix up to `floor(remaining characters / remaining turns in this cycle)`. Short ranges leave capacity for later cycles. Count an oversized range's unseen suffix as omitted and do not resume it under a misleading locator.
4. Repeat over files with later ranges until 6,000 characters are supplied or no range remains. Each file's excerpts retain ordered prefix-correspondence with its ranges.

With four files and 6,000 characters, an oversized first range receives at most 1,500 characters in cycle one. Add no ranker, stemming, embedding, map hint, or answer-key input.

## Replay and cheap stop

Reuse the exact six questions, bindings, manifests, checkouts, scan caps, and four-file/6,000-character caps from `maps-sufficiency-2026-09-28`. They are development cases because their failures and keyed sources are known. First reproduce the frozen baseline with `search`; run `search-diverse` twice and require byte-identical JSON.

Assess retrieval only after outputs are frozen. Check B6/B7/Y6/Y7 for previously missing keyed evidence, E6 for retained coverage, and E7 for filename-order recovery while keeping its prior model omission separate. The selector, fixtures, and expected deterministic JSON contain no captured reference excerpt, route, keyed filename/hash, answer, or per-case tuning.

If no prior retrieval-failure case recovers keyed evidence, or E6 loses keyed evidence, save a deterministic negative report and stop. Do not run model answers. If retrieval clears the gate, freeze neutral packets; any matched model trial is outside this cheap experiment and needs separate scope authorization and preregistration. This cap does not imply that ongoing research was denied. Report selection recovery separately from answer omissions. Make no validation, general accuracy, token, cost, savings, or adoption claim.

## Candidate boundary

Owned implementation files are the existing harness/test, at most one retained mechanical replay/comparison script, and new evidence under `docs/research/W-104/`. No production package, target repository, dependency, embedding, global memory authority, independent helper framework, or frozen pilot artifact changes.

Before implementation, record separate assertion-level reds for: fair turns under an oversized first range with truthful range/excerpt and omitted-count evidence; repeated-run determinism from existing order only; and new-mode poison-field isolation. Unchanged pinned `search`/`route` behavior and invalid mode/limit failures are green regression checks, with no manufactured red. Specification, build, and review remain separate dispatches.
