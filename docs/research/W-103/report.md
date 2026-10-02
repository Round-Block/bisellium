# W-103 bounded source-lookup experiment

These are exploratory results over 15 previously inspected cases. They are not a held-out evaluation. The comparison is deterministic lexical retrieval versus explicitly curated retrieval; it generates no model answers and scores no answer quality. Setup and corpus-maintenance work are separate from the lookup counters below. No timing or usage-savings conclusion is drawn.

## Effective inputs

The executable input is [`bindings.json`](bindings.json). Repository roots and IDs are explicit. Search used these fixed manifests, in code-unit lexical path order:

- `bisellium-main` (15 paths): `README.md`, `AGENTS.md`, `package.json`, `docs/ADOPTION.md`, `docs/STUDIO.md`, `docs/LEX_TEMPLATE.md`, `packages/cli/src/main.ts`, `packages/cli/src/context.ts`, `packages/core/src/index.ts`, `packages/schema/src/index.ts`, `adapters/epoch0/src/index.ts`, `studio/decisions/D-014.md`, `studio/leges/engineering.md`, `studio/opera/W-089.md`, `studio/opera/W-102.md`.
- `epoch0-main` (4 paths): `README.md`, `AGENTS.md`, `docs/program/PROGRAM.md`, `docs/program/BOARD.md`.
- `yan-mo-main` (4 paths): `README.md`, `CLAUDE.md`, `docs/dev-workflow.md`, `docs/vertical-slice-spec.md`.

The absent epoch0 `package.json` and Yan Mo root `project.godot` were omitted. The latter was not replaced with `game/project.godot`, because `.godot` is outside the signed extension policy. The binding enumerates the dataset, brief, harness files, current outputs, and all W-103 generated/historical artifacts as exclusions; component and filename exclusions are also enforced lexically and canonically.

Scan limits per case/repository were 128 directories, 512 candidates, 128 opens, 8,388,608 bytes total, and 262,144 bytes per file. Output limits shared across every repository in one case were 16 excerpt-bearing files and 16,384 excerpt characters. Search orders repositories by supplied ID, paths by code-unit lexical order, and matches merged adjacent lines. Route orders the same way but reads only explicit `(project, case, reference)` bindings. Search charges each valid exclusion-inventory entry as a candidate and charges its unique parent directories before resolving metadata.

## Actual results

| Measure | Search | Curated route |
|---|---:|---:|
| Cases / repository results | 15 / 15 | 15 / 15 |
| Directories visited | 150 | 38 |
| Candidates examined | 415 | 19 |
| Source opens | 110 | 17 |
| Source bytes read | 957,390 | 90,310 |
| Retrieved files | 101 | 17 |
| Omitted excerpts | 1,299 | 0 |
| Aggregate rejections / sampled failures | 5 / 5 | 2 / 2 |
| Complete / incomplete / unavailable repository results | 15 / 0 / 0 | 15 / 0 / 0 |
| Scan limits reached | 0 | 0 |

All 17 routed files with readable current content matched their captured SHA-256. The two route failures were the same oversized `docs/program/BOARD.md` encountered by E1 and E4. Search encountered that oversized manifest file once in each epoch0 case (five failures). Oversized files were skipped by metadata and were not opened or hashed. “Complete” therefore means the fixed candidate list was fully examined within scan budgets, not that every candidate was retrievable. Search output reached the shared per-case excerpt-character cap while continuing the full bounded scan, producing the 1,299 omitted-excerpt count without changing coverage.

The machine-readable results are [`search-results.json`](search-results.json) and [`route-results.json`](route-results.json). Rejected first-prototype bindings, results, and report remain separately named `rejected-prototype-*` historical artifacts and are not findings from this run.
