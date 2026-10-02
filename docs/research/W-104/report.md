# W-104 source-diverse replay

This deterministic experiment replays six known development cases. It is not held-out validation and makes no answer-quality, accuracy, cost, savings, or adoption claim. No answer-generation model was called for this deterministic replay; drafting, implementation and review use the normal separate roles.

## Result

The cheap gate **did not pass**. The negative result ends the experiment; no model trial was run.

The baseline reproduced byte-for-byte. Two search-diverse runs and the forbidden-field poison run were byte-identical. Retrieval received only case id, project, question, bindings, manifests, checkouts, and limits; the frozen evaluator key entered only the post-output evaluation stage.

| Span | Baseline units | Diverse units | Baseline whole span | Diverse whole span |
|---|---:|---:|---|---|
| B6:bisellium-main:docs/ADOPTION.md:87-99 | 0/12 | 0/12 | no | no |
| B7:bisellium-main:docs/ADOPTION.md:581-610 | 0/28 | 0/28 | no | no |
| E6:epoch0-main:AGENTS.md:29-31 | 3/3 | 3/3 | yes | yes |
| E6:epoch0-main:AGENTS.md:51-65 | 12/15 | 12/15 | no | no |
| E7:epoch0-main:README.md:33-49 | 11/13 | 11/13 | no | no |
| Y6:yan-mo-main:docs/dev-workflow.md:69-89 | 0/18 | 0/18 | no | no |
| Y7:yan-mo-main:docs/vertical-slice-spec.md:36-47 | 0/8 | 4/8 | no | no |

Line-unit gains: 4; losses: 0. E6 baseline-covered unit losses: no. E7 literal `filename order` is wrapped across two frozen source lines; both retain exact full-line coverage semantics. Line coverage: line 35 baseline=true, diverse=true; line 36 baseline=false, diverse=false. Partial line changes do not satisfy the gate. The conservative full-span proxy can miss useful partial recovery and cannot establish requested-fact coverage or answer sufficiency.

## Retrieval measures

| Measure | Baseline search | Search-diverse |
|---|---:|---:|
| cases | 6 | 6 |
| repositories | 6 | 6 |
| directories | 66 | 66 |
| candidates | 202 | 202 |
| opens | 44 | 44 |
| bytes | 382956 | 382956 |
| retrievedFiles | 41 | 41 |
| suppliedFiles | 10 | 22 |
| suppliedCharactersUtf16 | 36000 | 36000 |
| omissions | 985 | 943 |
| failures | 2 | 2 |
| incomplete | 0 | 0 |

Effective limits were {"directories":128,"files":512,"opens":128,"bytes":8388608,"fileBytes":262144,"excerptFiles":4,"excerptCharacters":6000}. Supplied characters use JavaScript UTF-16 `String.length`/`slice`, as the harness does. The earlier pilot's producer-side 35,999-character total used Python code-point length, so that historical unit difference is not evidence or budget drift. Coverage/incompleteness, omissions, failures, opens, and bytes above come directly from the harness output.

## Frozen hashes

Inputs:

- `route-dataset.json`: `dc013b89360bfa0429057ae059695361f35c5798c8960675d1e61f4a6729bfbf`
- `bindings.json`: `1db1a587e1befe0e76174e14cf647dbab49191ea0471d7c6686c94d2290c74f6`
- `answer-key.json`: `3aa6b52306ad95b511bf9b06ab2f9099e64e06e043d81a58e616f5a4d9585083`
- `route-results.json`: `8b063b433c67c433e4cce83a13cf6299d2d4bff4d762ccb6e6124dac7f984a68`
- `search-results.json`: `028d2e66b363005b2569568c00c1e10986344f33a7f36256a5c2cd2638abc9fc`

Outputs:

- `evaluator-key.json`: `e3b2a42936605fec5ebbde06e8a02e6d9c1eeee7157648e446866f9e62e63f52`
- `frozen-input-hashes.json`: `6b0fb06577097d74dbaaf9b90be26f8691b2736583fc71a4bbf24ba7413087e4`
- `search-diverse-results.json`: `49d3eed923e37642099dcf3972ef31478b267e291e3be14113a77006cc45fa72`
- `search-diverse-repeat.json`: `49d3eed923e37642099dcf3972ef31478b267e291e3be14113a77006cc45fa72`
- `replay-status.json`: `ef20f096b3f47719e940eee1be51245ab581166294cab3ca967a88d6ee79d4f5`
- `comparison.json`: `5d5ffb8d9f6b70b18b178184c7840f09309d040d6a050e59a7d1d465a4de2ef1`

## Provenance

- B6: bisellium-main @ f391c2945e6af7e1a8cec1de70ca8a05a2a36408 (codex/persistent-workflow; dirty=false; gitCalls=3)
- B7: bisellium-main @ f391c2945e6af7e1a8cec1de70ca8a05a2a36408 (codex/persistent-workflow; dirty=false; gitCalls=3)
- E6: epoch0-main @ fdbbb00ea496f6976e2ba5446d1921598cef7045 (master; dirty=false; gitCalls=3)
- E7: epoch0-main @ fdbbb00ea496f6976e2ba5446d1921598cef7045 (master; dirty=false; gitCalls=3)
- Y6: yan-mo-main @ dd842eb45017c6021378ce07ea00b5069e6f097c (main; dirty=false; gitCalls=3)
- Y7: yan-mo-main @ dd842eb45017c6021378ce07ea00b5069e6f097c (main; dirty=false; gitCalls=3)
