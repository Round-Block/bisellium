# W-107 security red-team input

Scope: advisory input to the architect for W-107. This review covers the
production read boundary and live evaluation boundary in
`studio/briefs/W-107.md`, `approved-plan.md`, and
`evaluation-data-schema.md`. It does not sign either gate. No held-out case,
source, answer, key, or key hash was inspected.

The intended boundary is a trusted local registry over cooperative, normally
stable repositories. It need not claim resistance to a hostile actor racing the
filesystem. The following ambiguities still need minimum, testable resolutions
before build.

## 1. Confinement, symlinks, and detected changes

The spec says both that every parent/final path is contained and that detected
concurrent changes refuse output, but it does not define which observation owns
the returned hash and body.

Minimum fix:

- Canonicalize the registered root once per request. Reject malformed relative
  paths before filesystem work. Resolve and check each parent and the final
  target beneath that root, require a regular file, and open the final component
  without following a final symlink where the platform supports it.
- Derive the body, strict UTF-8 validation, line counters, terminal-newline
  state, and full-file SHA-256 from one opened handle and one byte stream.
  Record handle identity/size before and after, then repeat the path containment
  and identity check before releasing the buffered result. A detected rename,
  replacement, truncation, append, parent/final symlink change, or identity
  mismatch refuses the affected source body.
- State the trust limit explicitly: these checks prevent lexical and observed
  canonical escapes and fail closed on detected changes; they do not prove
  hostile descriptor-race resistance. Do not describe repeated `realpath` as
  an atomic sandbox.
- Fix relative-path length/component bounds. State whether one canonical root
  may be registered under multiple project/repository identities. If allowed,
  authorization, orientation, and results remain bound to the exact project and
  repository IDs.
- Return an opaque root identity scoped to project/repository, not the absolute
  host root. Absolute snapshot/control paths must not become model-visible.

## 2. Strict bounded control inputs

Ordinary `JSON.parse` silently accepts duplicate member names, while the draft
only clearly rejects duplicate flags and IDs.

Minimum fix:

- Read registry and request as regular files with the byte ceiling enforced
  before parsing, and decode with fatal UTF-8. Reject devices/FIFOs, invalid
  UTF-8, trailing data, and over-limit input before source or Git observation.
- Reject duplicate JSON member names and unknown fields at every closed-schema
  depth, plus duplicate IDs, non-integer/non-finite numbers, invalid tagged-union
  combinations, and out-of-range values. Last-member-wins parsing is not strict.
- Bound identifier, state, objective/query, root, relative-path, array, and
  nesting sizes within the overall byte caps. Validate the entire selected
  project/repository request before the first source read; a later bad entry
  must not cause partial source disclosure.
- Treat all strings as data. No user value enters a shell, glob, environment
  variable name, Git option, or implicit directory scan.

## 3. Mandatory orientation and digest freshness

An implementation-chosen digest of instruction text alone could be replayed
across objectives, repository subsets, states, or registry aliases.

Minimum fix:

- Define a versioned, domain-separated canonical byte encoding for the digest.
  Bind the project ID, exact compact objective, deterministic selected
  repository-ID set, scoped root identities and state strings, and every
  applicable instruction's registered path, raw-byte SHA-256, and exact UTF-8
  body. Include the registry version/identity needed to prevent alias reuse.
- Define instruction applicability for a multi-repository locate: all project
  repositories or the explicit `repositoryIds` subset. A digest for one set
  never authorizes another.
- On every read/expand, re-observe all instructions for the bound set and
  reconstruct the digest before releasing any item. A changed objective,
  missing/changed/escaped/non-regular/invalid-UTF-8 instruction, or instruction
  budget failure refuses the whole request rather than returning partial items.
- Preflight serialized size. The maximum 64 KiB instruction block plus metadata
  cannot silently overflow the 65,536-byte default result budget. Either it fits
  the caller's result budget or locate returns the fixed bounded refusal.

## 4. Freshness and output/resource accounting

The draft alternates between response characters and serialized UTF-8 bytes,
and “16 failure samples” could be implemented once per output array.

Minimum fix:

- Define the response budget as UTF-8 bytes of the complete compact JSON result,
  measured after final serialization and before emission. The refusal envelope
  also stays below the 131,072-byte hard maximum.
- Keep the section limit in Unicode code points without splitting surrogate
  pairs. Define line numbers by LF, preserve original LF/CRLF and empty lines in
  returned bodies, report terminal newline, and hash raw bytes without newline
  normalization.
- Charge every byte read from the file handle to per-file and request-wide
  observation counters, including bytes consumed only to finish the full-file
  hash. Stop before an operation would exceed a hard bound. Invalid UTF-8 or
  freshness failure releases no body prefix.
- Bound omissions/errors/failure samples in aggregate, or state a separate
  hard bound for each array. Output exhaustion names the exact limit, and every
  unreturned requested range has a bounded omission record or aggregate count;
  no prefix is presented as complete.
- Freeze the two allowed Git argv vectors and the scrubbed environment,
  executable resolution, stdout/stderr caps, timeout/termination behavior, and
  unknown-on-failure rule. No fallback Git command or user-controlled option is
  permitted.

## 5. Mandatory live orientation, fairness, and exact MCP accounting

Prompting the model to call `orient` does not enforce it. “Byte-for-byte”
comparison is also ambiguous if one side is decoded MCP text and the other is a
JSON-escaped event envelope.

Minimum fix:

- Bind each fresh server to one frozen case, arm, registry, snapshots, and
  orientation hash. Its first successful source call is `orient`; a final
  answer without successful orientation is invalid. Count and log every
  orient/search/locate/read/expand/fallback/error/retry attempt. Refuse attempt
  13 before source access, but count its complete model-visible refusal bytes.
- Return each result as one canonical UTF-8 JSON text payload. Append its exact
  pre-framing bytes with call ID, sequence, tool, and status to the server
  transcript. Compare that text with the fully decoded MCP content in Codex
  JSONL, then count its UTF-8 bytes. JSONL escaping/envelopes and MCP framing are
  separate overhead. Missing, duplicated, reordered, truncated, or transformed
  results invalidate the run.
- Baseline `read_file` and candidate `fallback_read_file`, and baseline grep
  and candidate fallback grep, share one observation implementation, output
  schema, metadata, ceilings, and failure behavior; identical requests over the
  same snapshot must produce byte-identical result text. Freeze common prompt,
  orient bytes, tool schemas/descriptions, case order, and alternating arm order
  before results. Candidate locate's approved repeated instruction bodies stay
  charged to candidate.
- Before held-out work, retain a live Unicode/error/usage canary and a synthetic
  bypass-detection canary. Test the verifier with forbidden and unknown event
  fixtures. The JSONL parser is allowlist-based: any command/shell, direct-file,
  web, unregistered/opposite-arm MCP, or unknown tool/event attempt invalidates
  the run even when denied. Model/effort drift, missing completion/usage, and
  transcript mismatch also invalidate it.

## 6. Key isolation, freeze, and rerun invalidation

Process separation is useful only if each stage has a closed input set and
cannot discover neighboring artifacts.

Minimum fix:

- Only the offline pre-trial validator accepts the key before trials, and it
  emits validation status plus frozen artifact hashes, never facts,
  qualifications, anchors, quotes, answers, paths, or derived routes.
  Run/MCP/selection schemas recursively reject key, expected-answer, pass/fail,
  anchor, qualification, and failure-condition fields. They accept explicit
  named inputs only and never glob or inspect a containing directory.
- Keep the key and preparation program outside checkout/run directories,
  registered roots, corpus manifests, MCP configuration, prompts, environment,
  and model-visible errors. The scorer accepts the key only after all 12 answers
  and raw transcripts are frozen and hashed. Read-only sandboxing is detection,
  not proof that the model cannot read arbitrary host paths.
- Freeze and verify before every arm the production reader, runner/server and
  verifier, prompts/tool schemas, exact executable/version/model/effort
  configuration, registry/cases/orientation/order, snapshot hashes, and key
  hash. Output directories are absent from every model-visible root and corpus.
- Define rerunnable infrastructure narrowly: a retained failure before usable
  model output, with identical hashes and no forbidden access, may be rerun.
  A forbidden access attempt is protocol invalidation, not an infrastructure
  rerun. Any actual or possible access to key, opposite-arm data, prior answer,
  or unregistered source invalidates the whole evaluation version and requires
  newly frozen hidden material. Correctness, completeness, citation,
  efficiency, call-cap, or ordinary model failures are never selectively rerun.

If the pinned Codex build does not expose complete MCP result content and the
allowlisted event stream required above, held-out execution stops as
`NO — invalid evidence`. Packet sizes or server-side intent cannot substitute
for evidence of what the model received.
