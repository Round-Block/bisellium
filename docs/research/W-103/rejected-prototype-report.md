> HISTORICAL, REJECTED PROTOTYPE RESULTS. These runs precede the failed pre-review and test-first restart. They are not accepted findings or results of the current skeleton. See [CHECKPOINT.md](CHECKPOINT.md).

# W-103 bounded source-lookup experiment

This is an exploratory run over 15 previously inspected cases, not a held-out evaluation. It compares deterministic lexical retrieval with curated retrieval only. It generated no model answers and did not score answer quality.

## Binding and method

`bindings.json` assigns stable IDs to the three supplied roots and lists the effective corpus explicitly. The manifests were prepared from project entrypoints and general project-document categories, independently of the case references and expected answers. The exclusion inventory names the dataset, W-103 brief, harness, tests, binding, and generated outputs; the harness additionally rejects research, brief, report, test, dependency, asset, build, coverage, Git, and worktree path components. Ordering is repository ID, relative-path code-unit order, then line number.

Both runs used the defaults: 128 directories, 512 candidates, 128 opens, 8 MiB total source bytes, 256 KiB per file, 16 excerpt-bearing files, and 16,384 excerpt characters per case/repository. Output caps are separate from scan counters. Preparation and future manifest maintenance are setup costs, separate from lookup counts. No timing was captured as a deterministic metric.

## Observed results

| Mode | Cases | excerpt-bearing file results | opens | bytes read | rejections | omitted excerpts |
|---|---:|---:|---:|---:|---:|---:|
| lexical search | 15 | 101 | 110 | 957,390 | 15 | 1,299 |
| curated route | 15 | 17 | 17 | 90,310 | 2 | 0 |

Every case and repository result reports limits, counters, identity, coverage, failures, and truncation. All scans finished their explicit manifests (`coverage: complete`); this does not mean every listed file was retrievable. Epoch0's `docs/program/BOARD.md` exceeded the 256 KiB per-file limit (five search rejections and two route rejections), and its listed `package.json` was absent (five search rejections). Yan Mo's extensionless `project.godot` was rejected by the text-extension allowlist in each search case. Route case E4 consequently returned no file content. The 1,299 omitted search excerpts are output truncation, not hidden scan exhaustion. All retrieved route files matched their captured SHA-256 values in this run.

The raw deterministic outputs are `search-results.json` and `route-results.json`. These observations support only the mechanics and resource accounting recorded above; they imply no semantic-quality or token/usage-savings conclusion.
