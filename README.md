# Gantry

The pipeline view of multi-agent work — states, gates, handoffs — over any
source, including uninstrumented ones. Boards are **projections derived from
reality** (worktrees, PRs, gate logs, agent events), never human data entry.

- Design dossier (research + spec): https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- UI design canvas (6 screens): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Architecture (four layers)

```
adapters/*        event-native (OTLP, hooks) or snapshot-native (markdown, git, gh)
packages/schema   the contract: entities, lifecycles, workflow.* attributes
packages/core     local-first event store (SQLite + JSONL), snapshot differ,
                  OTLP ingest, query API — views never talk to adapters
apps/web          React UI: Board · Inbox · Swimlane · Agents · Digest · Graph
```

Runs as a local server (`localhost`) first; Tauri desktop wrapper (tray +
native notifications for needs-you items) planned once the web app is real.

## Principles (short form — full text in the dossier)

1. Nobody updates a Gantry card — the board is derived, the one write path is answering.
2. Opinionated over configurable — lifecycles are declared by adapters in code.
3. Evidence is two clicks from the red X — every gate result carries an evidence link with identity (hash).
4. Attention is an inbox with strict admission — questions to you and replies to your threads; digests are a separate feed; chatter stays in timelines.
5. Limits are routing state — who is hot, when it resets, what routes where.
6. Certificates go stale honestly — a gate result certifies a specific commit.

## Build order

1. Read prior art (Agent Beacon schema, agent-board, disler's hooks) — done in dossier.
2. `packages/schema` — types + JSON Schema export. ← current
3. `adapters/epoch0` — snapshot adapter: BOARD.md + journal + `gh pr list` + ART_LEDGER.md/ART_USAGE.md.
4. `packages/core` — store, snapshot differ, OTLP ingest, query API.
5. `apps/web` — Board view first, then drawer/inbox.
6. Second adapter (Claude Code hooks) to stress the abstraction.
7. Swimlane (agent-prism), Agents, Digest; Graph last.
8. Command channel (`send()`), Tauri wrapper + notifications.

Acceptance: both adapters render with zero adapter-specific code outside the
extension slot; replay reproduces the live view; deleting one adapter leaves
the other untouched.
