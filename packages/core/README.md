# @bisellium/core

The local-first heart: an append-only JSONL event log, a snapshot differ that turns consecutive adapter `snapshot()` results into synthetic `workflow.*` events stamped `workflow.time.derived = true`, and a `Store` that appends those events to the log, keeps a per-source in-memory index, and replays the log back into current work-item state. SQLite indexing is not wired in yet (see the `TODO(sqlite)` in `store.ts`); until then the index is rebuilt in memory straight from the log.

The local-first heart: SQLite + JSONL event store, the snapshot differ
(consecutive `snapshot()` results → synthetic `workflow.*` events stamped
`workflow.time.derived = true`), an OTLP/HTTP ingest endpoint, and the one
query API the views read. Views never talk to adapters.

Key invariants:
- every ingested or synthesized event is persisted; "live" is a tail on the log
- ordering: `(source, seq)` within a source, `ts` across sources
- gate results carry evidence identity; staleness is computed, never guessed
