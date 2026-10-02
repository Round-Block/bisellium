# Preparation record

Date: 2026-09-28. Scope: six research-data cases only. No answer trial, scoring, harness change, target-project write, or runtime claim was performed.

## Preparation order

1. Read the reviewed W-103 bindings and the 15 exploratory formulations, then inspect candidate evidence only inside the fixed corpora.
2. Freeze `questions.json` before drafting any private expected facts or curated routes. The frozen question file's SHA-256 was recorded as `79e2c4a7edc8116b026c7a5a0e1d02d629de204e47d5f4e2b7186d8af0136219`.
3. Draft `answer-key.json` from the cited source ranges, including forbidden overclaims and required limitations.
4. Build `route-dataset.json` and `bindings.json` against those unchanged formulations and fixed corpus manifests. The route slices contain source evidence only; they contain no expected-answer text.
5. Validate structure, route coverage, hashes, line ranges, and corpus-list identity without running either retrieval condition.

The formulations are new relative to the original 15, but they are not statistically independent holdouts. They were prepared after prior familiarity with the projects, after the W-103 corpus selection, and with source inspection. Curated routing therefore tests whether prepared evidence is sufficient for an answer, not autonomous route discovery.

## Fixed source identity

The W-103 project corpus lists were copied unchanged.

- `bisellium-main`: root `/home/edckt/projects/bisellium`; HEAD `f391c2945e6af7e1a8cec1de70ca8a05a2a36408`; branch `codex/persistent-workflow`; selected corpus paths checked as tracked-clean.
- `epoch0-main`: root `/home/edckt/projects/epoch0`; HEAD `fdbbb00ea496f6976e2ba5446d1921598cef7045`; branch `master`; selected corpus paths checked as tracked-clean.
- `yan-mo-main`: root `/home/edckt/projects/Yan Mo`; HEAD `dd842eb45017c6021378ce07ea00b5069e6f097c`; branch `main`; selected corpus paths checked as tracked-clean.

The fixed manifests contain 15 Bisellium paths, 4 epoch0 paths, and 4 Yan Mo paths. They are reproduced in `bindings.json`; no corpus path was added, removed, reordered, or substituted.

The corpus is a bounded static snapshot, not a live-system observation. It cannot establish deployed database ledger state, current service behavior, current pull requests, or successful execution merely because a document describes a contract. Case E7 deliberately requires that limitation. Files outside the manifests are unavailable to both retrieval conditions. The epoch0 `docs/program/BOARD.md` exceeds the harness's default per-file byte limit; no new curated reference depends on it. Whole-checkout dirtiness outside selected corpus paths was not measured here.

## Observable preparation counts

Before generated-artifact validation, 22 distinct pre-existing files were explicitly opened or hashed: 4 setup/protocol files, 6 prior W-103 harness/research inputs, and 12 additional fixed-corpus files. Two CLI setup invocations were made: the no-argument usage call and the `builder-sol` context boot. Internal files read by the context command, directory enumeration, metadata probes, and elapsed preparation time were not measured.

The six cases use seven references across six excerpt-bearing source files per full dataset, with no more than one excerpt-bearing file in any case. Each case stays below the protocol caps of four excerpt-bearing files and 6,000 supplied excerpt characters. Exact excerpt-character and source-open counts belong to the later frozen harness outputs, not this preparation record.
