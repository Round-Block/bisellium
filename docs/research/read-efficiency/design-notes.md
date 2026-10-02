# W-107 design notes

These notes record draft-time feasibility and boundary choices. They are not a
spec signature, implementation evidence, or held-out evaluation artifact.

## Smallest useful production seam

The existing CLI already routes raw per-command argv from
`packages/cli/src/main.ts` into `@bisellium/commands` implementations through
one-line CLI shims. W-107 follows that house shape with one `source` command and
one commands-package module. A strict JSON request keeps batched locations and
future model-tool adaptation out of shell quoting logic. The explicit registry
reuses W-103's strongest proven choices: caller-supplied project/repository
identity, fixed corpus manifests, deterministic order, strict UTF-8, canonical
containment, bounded Git observation and no directory crawl.

The command deliberately has only locate/read/expand. It does not import the
research scripts into production or create a service/index. The evaluation MCP
adapter invokes this real command/library for candidate calls. Its baseline
adapter offers ordinary bounded lexical grep and exact range reads over the
same registry and frozen bytes, so the comparison is live and useful without
forcing whole-file reads.

Orientation uses an explicit digest handshake. Locate supplies exact mandatory
instructions and project state; later reads repeat compact identity and require
the digest. This avoids paying full instruction bodies on every call while
making stale or omitted mandatory context a refusal rather than a silent loss.
Fresh sessions and repeated locate/read operations still return bodies; there
is no stateful suppression.

## Actual Codex feasibility observed on 2026-09-28

The installed executable reports `codex-cli 0.153.4`. Its `exec --help` exposes
`--json`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, explicit
`--model`, `-c model_reasoning_effort=...`, `--sandbox read-only`, and a working
directory override. `codex mcp add --help` confirms stdio MCP servers accept an
explicit command and environment.

A fresh ephemeral, read-only `gpt-5.6-luna` low-effort smoke turn completed and
its JSONL ended with:

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 11110,
    "cached_input_tokens": 8960,
    "cache_write_input_tokens": 0,
    "output_tokens": 7,
    "reasoning_output_tokens": 0
  }
}
```

A second smoke turn made one `pwd` call. JSONL included the actual
`command_execution` completion and `aggregated_output` (`/tmp\n`) before the
answer, demonstrating that tool response text is observable for accounting.
The W-107 MCP response shape still needs its own build-time Unicode/error
canary; held-out runs are blocked unless the server transcript and Codex JSONL
match byte-for-byte.

The local supported-model catalog names `gpt-5.6-luna`. An attempted
`gpt-6-luna` turn failed before model work with HTTP 400: that model id is not
supported for this ChatGPT Codex account. Official OpenAI model guidance lists
GPT-6 Luna as an API model, but API availability does not establish ChatGPT
Codex-account availability. Therefore the experiment pins the locally supported
`gpt-5.6-luna` id at low effort and fails closed on any unavailable model or
fallback; it never aliases Luna names.

Official references consulted:

- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/reasoning

## Delivery and byte accounting

The stdio MCP server writes an append-only transcript of the exact result text
it sends for each real tool call. The runner pairs those call ids with completed
Codex JSONL items. A retained canary proves the client event contains the same
complete text; missing or transformed content invalidates the evaluation rather
than falling back to packet sizes.

Count UTF-8 bytes for all model-visible source-result text: orientation,
discovery metadata, exact bodies, provenance, omissions, errors and candidate
fallbacks. This charges candidate wrapper/provenance overhead. Keep MCP framing,
Codex JSONL envelopes, schemas, common prompt/question, final answer and runner
logs in separately reported overhead columns. Provider token usage is captured
when emitted but cannot replace delivered-response bytes and is not a
subscription-savings measure.

Each task/arm is a new `codex exec --ephemeral` process and a new MCP server.
The server refuses call 13. Both servers support multi-query/multi-range calls.
The baseline has bounded grep/read; the candidate has locate/read/expand and
clearly named baseline-semantic fallbacks. Any command/shell, direct file, web,
opposite-arm or unknown tool event invalidates the run. This fail-closed check
is the practical boundary available through the installed CLI; the draft does
not claim an unverified switch removes built-in shell access.

## Key and source confinement

A run process never accepts a key argument. The frozen key remains outside run working directories, registered corpora, and MCP inputs and is loaded only by the isolated offline validator before trials and scoring after both arms and answers are frozen.
The MCP server sees only the one case's public question/orientation, registry
and frozen source snapshot. Strict schemas reject expected-answer, pass/fail,
anchor and key fields rather than ignoring them.

Production containment is lexical and canonical. Each read verifies registered
project/repository/path identity, every parent, the final regular file, strict
UTF-8, a full current hash within the source-observation ceiling, and a
post-read identity check. Root realpath plus current HEAD/branch and selected
content hashes distinguish worktrees without claiming global cleanliness.
Outdated sources remain visible as sources with current identities; the frozen
question/key decides whether relying on one misses a required qualification.

## Remaining build-time proof points

Before held-out execution, synthetic controls must prove the final stdio MCP
protocol with the pinned Codex version, exact response capture, bypass
detection, output/transcript failure behavior, and the 12-call refusal. If MCP
results are not fully observable or the transcript cannot be kept outside the
model roots, the model evaluation is infeasible in this harness and stops with decision NO (invalid evidence). That is the only unresolved harness fact; model selection, low effort,
ephemeral isolation, read-only sandboxing, command-event visibility and usage
availability were exercised directly.

Architect clarification: read-only sandboxing is not global read confinement.
The pre-trial canary must demonstrate detection of disallowed access; any such
access fails the run closed. Source preparation may precede that canary.
Common orient bytes are identical across arms; candidate production locate
instruction repetition is additional charged read traffic.

## Architect disposition of security advice

All six advisory sections are resolved by the brief's normative version-1
security resolution. Trust is cooperative local repositories, with one-handle
hash/body and detected-change refusal; no hostile-race sandbox claim. Digests,
byte accounting, finite schemas/ceilings, event allowlists and rerun rules are
fixed before build. The schema-only handoff matches architect-prepared data;
independent runner validation, live canaries and all eight recorded reds remain
required. This disposition is specification work, not security test evidence.

## W-107 implementation notes

The production seam is a single commands-package reader. The CLI re-exports it
and only supplies the two control-file paths. Root identity is opaque; the
registry identity and orientation digest use recursively sorted compact JSON.
A request caches a file observation only within that request so instructions,
source hashes and bodies derive from one handle/read, while every later request
re-observes the filesystem. Git is informational and uses only the two signed
read-only argv forms with a scrubbed environment.

The evaluator keeps common orientation separate from production locate so both
arms receive byte-identical task orientation and candidate metadata repetition
is charged. Model-visible MCP result text, rather than transport envelopes, is
the read-byte unit. Raw CLI JSONL and server transcript remain distinct and are
joined by delivery order, tool identity and exact decoded text. The installed
CLI exposes its own item call id and the MCP transport exposes a JSON-RPC id;
both are retained because they are different namespaces.

The first live canary proved that unannotated MCP tools are refused under the
noninteractive policy. The failed run was retained, the tools were truthfully
marked read-only, and the identical model/effort/prompt then passed. A separate
live prompt used the shell once; the runner detected the `command_execution`
item and classified that turn as invalid, proving detection rather than claiming
the tool is disabled.
