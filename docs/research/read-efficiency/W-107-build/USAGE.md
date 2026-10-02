# W-107 evaluation commands

Run from the repository root with Node 25+. These commands accept explicit files;
none searches a containing directory. Held-out paths below are placeholders and
must be supplied by the isolated preparer/clerical context.

## UTC metadata correction

The current runner accepts ISO UTC timestamps ending in either `Z` or
`+00:00`; it rejects nonzero offsets, missing zones and invalid calendar dates.
The focused regression command is:

```bash
node docs/research/read-efficiency/targeted-read-eval-a1.test.mjs .
```

An authorized offline operator revalidates the unchanged original inputs with:

```bash
node docs/research/read-efficiency/targeted-read-eval.mjs freeze-validate \
  --data-root <DATA_ROOT> \
  --registry <DATA_ROOT>/registry.json \
  --cases <DATA_ROOT>/cases.json \
  --key <ISOLATED_KEY_PATH> \
  --manifest <DATA_ROOT>/snapshot-manifest.json \
  --output <NEW_OUTPUT_ROOT>/validation.json
```

The current runner SHA-256 is
`3f65eacedeb535e3c14888031f8cdd7386fdd41fea62fb85717c6d04105d720a`.
The current `+00:00` synthetic seal is
`173a38d2bf80cc431405f3f1bc1d60394092b282d0306f476bcc51e7f1c168a2`.
Earlier A1 and pre-A1 seals are historical evidence. Details are in
`W-107-build/a1/utc/README.md`.

## A1 scalar-preparation revision

The signed A1 amendment changes the preparation field to a nonempty string and
pins the existing public validation rules for anchor ownership/uniqueness,
oversized coverage, project names, UTC timestamps and lexical/symlink
confinement. Run its focused synthetic control with:

```bash
node docs/research/read-efficiency/targeted-read-eval-a1.test.mjs .
```

The retained A1 refresh used these exact synthetic-only commands:

```bash
node docs/research/read-efficiency/targeted-read-eval.mjs fixture-build \
  --output docs/research/read-efficiency/W-107-build/a1/synthetic
node docs/research/read-efficiency/targeted-read-eval.mjs freeze-validate \
  --data-root docs/research/read-efficiency/W-107-build/a1/synthetic \
  --registry docs/research/read-efficiency/W-107-build/a1/synthetic/registry.json \
  --cases docs/research/read-efficiency/W-107-build/a1/synthetic/cases.json \
  --key docs/research/read-efficiency/W-107-build/a1/synthetic/answer-key.json \
  --manifest docs/research/read-efficiency/W-107-build/a1/synthetic/snapshot-manifest.json \
  --output docs/research/read-efficiency/W-107-build/a1/synthetic-validation.json
node docs/research/read-efficiency/targeted-read-eval.mjs canary \
  --output docs/research/read-efficiency/W-107-build/a1/canary
node docs/research/read-efficiency/targeted-read-eval.mjs freeze \
  --registry docs/research/read-efficiency/W-107-build/a1/synthetic/registry.json \
  --cases docs/research/read-efficiency/W-107-build/a1/synthetic/cases.json \
  --manifest docs/research/read-efficiency/W-107-build/a1/synthetic/snapshot-manifest.json \
  --validation docs/research/read-efficiency/W-107-build/a1/synthetic-validation.json \
  --key-commitment bf4e073f44ce958876eea9e0dbd3965a5ba6e8dcb472089f880cb42962b2c849 \
  --output docs/research/read-efficiency/W-107-build/a1/synthetic-freeze.json
```

The A1 evidence hashes and preserved pre-amendment red are listed in
`W-107-build/a1/README.md`. The original `W-107-build/synthetic-*` seal and arm
remain immutable pre-A1 evidence; use the A1 runner and a newly validated
receipt/seal for any later held-out execution.

## Gate A and offline synthetic controls

```bash
node --import tsx packages/commands/src/source.test.ts .
node docs/research/read-efficiency/targeted-read-eval.test.mjs .
node docs/research/read-efficiency/targeted-read-eval.mjs fixture-build \
  --output /tmp/w107-synthetic
node docs/research/read-efficiency/targeted-read-eval.mjs freeze-validate \
  --data-root /tmp/w107-synthetic \
  --registry /tmp/w107-synthetic/registry.json \
  --cases /tmp/w107-synthetic/cases.json \
  --key /tmp/w107-synthetic/answer-key.json \
  --manifest /tmp/w107-synthetic/snapshot-manifest.json \
  --output /tmp/w107-synthetic-validation.json
node docs/research/read-efficiency/targeted-read-eval.mjs synthetic-controls \
  --output /tmp/w107-synthetic-results
```

The retained dry run used `W-107-build/synthetic/` and validated these inputs:

- registry `69017e9f02d607aa6c7b5c6073035f3aea356ff15e83bcf5dcc30e393698b44b`
- cases `58545a27561d2b7cf439327a8b8671317a25409eed655d59f0c5ff638affb903`
- key commitment `bf4e073f44ce958876eea9e0dbd3965a5ba6e8dcb472089f880cb42962b2c849`
- snapshot manifest `0415b21df21927003d59d3a57534d47af1fd3454e1ec39ae80bd1c766698dd69`

The fixture registry hash changes when generated in a different absolute output
root; the source bytes, cases and key remain deterministic. Behavior 8 also
runs eight real mutation controls: duplicate members, wrong case count, invalid
key id, missing qualification, bad artifact hash, bad anchor range, leaked key
field and source drift.

## Live controls

```bash
node docs/research/read-efficiency/targeted-read-eval.mjs canary \
  --output <OUTPUT_ROOT>/canary
node docs/research/read-efficiency/targeted-read-eval.mjs bypass-canary \
  --output <OUTPUT_ROOT>/bypass-canary
```

Both use the installed `codex` executable with `--json --ephemeral
--ignore-user-config --ignore-rules --skip-git-repo-check --model
gpt-5.6-luna -c model_reasoning_effort="low" --sandbox read-only`, an empty
working directory and no model substitution. The first failed canary is retained
at `canary-attempt-1-failed/`; it had no usable MCP output. The passing canary
and bypass canary retain raw JSONL, stderr, hashes, usage and command metadata.

## Validate and seal held-out inputs

The offline validator is the only pre-trial command that accepts the key path.
It emits only status, error codes and hashes.

```bash
node docs/research/read-efficiency/targeted-read-eval.mjs freeze-validate \
  --data-root <DATA_ROOT> \
  --registry <DATA_ROOT>/registry.json \
  --cases <DATA_ROOT>/cases.json \
  --key <ISOLATED_KEY_PATH> \
  --manifest <DATA_ROOT>/snapshot-manifest.json \
  --output <OUTPUT_ROOT>/validation.json

node docs/research/read-efficiency/targeted-read-eval.mjs freeze \
  --registry <DATA_ROOT>/registry.json \
  --cases <DATA_ROOT>/cases.json \
  --manifest <DATA_ROOT>/snapshot-manifest.json \
  --validation <OUTPUT_ROOT>/validation.json \
  --key-commitment <64_LOWERCASE_HEX_FROM_VALIDATION> \
  --output <OUTPUT_ROOT>/freeze.json
```

`freeze` refuses a mismatched validation receipt and records hashes of the
production reader, runner, prompt/tool schemas, public inputs, snapshot manifest,
key commitment, exact executables/version/model/effort, six-case order and the
alternating 12-arm order. Re-run `freeze` only before any trial; a runner/source
change after a trial requires new hidden material.

## Execute and audit one declared arm

Run the 12 entries exactly in `freeze.json.order`, each in a fresh output path.
The command accepts no key, expected answer, criteria or opposite-arm input.

```bash
node docs/research/read-efficiency/targeted-read-eval.mjs run-arm \
  --freeze <OUTPUT_ROOT>/freeze.json \
  --registry <DATA_ROOT>/registry.json \
  --cases <DATA_ROOT>/cases.json \
  --case <CASE_ID> --arm <baseline|candidate> --ordinal <1..12> \
  --output <OUTPUT_ROOT>/runs/<ORDINAL>

node docs/research/read-efficiency/targeted-read-eval.mjs audit-run \
  --freeze <OUTPUT_ROOT>/freeze.json \
  --run <OUTPUT_ROOT>/runs/<ORDINAL>/run.json \
  --output <OUTPUT_ROOT>/runs/<ORDINAL>/audit.json
```

`run-arm` fails closed on freeze/model/effort/order drift, unknown JSONL events,
any shell/file/web/other tool item, a non-source MCP server/tool, response
transformation/reordering, missing usage, missing first `orient`, call 13,
nonzero exit or absent final answer. Every delivered result, including errors
and refusals, contributes its complete pre-framing UTF-8 text bytes.

The retained pre-A1 synthetic one-arm proof is `synthetic-run-01/`: baseline,
`bisellium-cross-document`, ordinal 1, eight calls, 11,428 counted source bytes. Its audit is VALID and pins:

- freeze `f8aa0a7208c5dbf30030cba2888858ad98bbe3ba035d0f08c26c374b44b97cba`
- run `448b17a848b2fafb29e5ff9ee3d2dfa8c4d5cd8ce285c08b0c38bb7b5c8bfea3`
- JSONL `65116a86728592b956bdc0a7d5f16923f67098bd34ad7688a45d8f0f853ef47c`
- transcript `d8134bcba93f9214637b522df47468c408913d3bacf73fae92300ba15bed2a3e`

## Assemble review and aggregate

Create `runs.json` explicitly as
`{"version":1,"runs":["/absolute/run-01/run.json",...,"/absolute/run-12/run.json"]}`.
Only after all 12 run manifests and raw artifacts are frozen may the isolated
offline process accept the key again:

```bash
node docs/research/read-efficiency/targeted-read-eval.mjs review-package \
  --freeze <OUTPUT_ROOT>/freeze.json \
  --runs <OUTPUT_ROOT>/runs.json \
  --key <ISOLATED_KEY_PATH> \
  --output <OUTPUT_ROOT>/review
```

Give `review/review-packet.json` to the sole Censor. Its verdict file is closed
JSON: `{"version":1,"answers":[{"anonymousId":"...","correct":true,
"cited":true,"complete":true,"qualifications":true,
"unsupportedClaims":false},...]}`. Then run:

```bash
node docs/research/read-efficiency/targeted-read-eval.mjs aggregate \
  --scoring-package <OUTPUT_ROOT>/review/scoring-package.json \
  --verdicts <CENSOR_VERDICTS.json> \
  --output <OUTPUT_ROOT>/decision.json
```

Aggregation publishes YES only when all 12 semantic verdicts pass, candidate
bytes are at most 70% of baseline in aggregate, and candidate bytes do not
increase for any project. Otherwise it publishes NO with `implementation
failure` or `insufficient savings`. Invalid run/freeze evidence never reaches
aggregation and is reported as invalid evidence by the failed stage.
