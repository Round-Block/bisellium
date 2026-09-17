# @atrium/core (not yet implemented — build-order step 4)

The local-first heart: SQLite + JSONL event store, the snapshot differ
(consecutive `snapshot()` results → synthetic `workflow.*` events stamped
`workflow.time.derived = true`), an OTLP/HTTP ingest endpoint, and the one
query API the views read. Views never talk to adapters.

Key invariants:
- every ingested or synthesized event is persisted; "live" is a tail on the log
- ordering: `(source, seq)` within a source, `ts` across sources
- gate results carry evidence identity; staleness is computed, never guessed
