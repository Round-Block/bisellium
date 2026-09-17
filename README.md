# Bisellium

One application, two halves:

- **The studio model** — an agent organization patterned on a product team.
  A collegium is *lex + aerarium + acta*; the Patron touches only
  greenlight, aerarium allocation, taste calls, and lex changes.
  Conventions, not a runtime: agents keep running in their own toolchains.
- **The console and reference harness** — the pipeline view over that studio (and any other source), plus a direct line to each department lead via the vendor CLIs:
  Board · Inbox · Swimlane · Agents · Digest · Studio · Graph. Boards are
  projections derived from reality, never human data entry.

Design history (under the console's former working name, Gantry):
[research + spec dossier](https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c) ·
[UI design canvas](https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f).

## Layout

```
docs/STUDIO.md            the organization model
docs/LEX_TEMPLATE.md      per-collegium lex
docs/ADOPTION.md          what an Bisellium-compliant project directory contains
examples/sample-studio    a complete instance — the app runs on this alone
packages/schema           the contract: entities, lifecycles, workflow.* attributes
packages/core             JSONL event log, snapshot differ, in-memory store (burn derivation + query API next)
adapters/native           reads an Bisellium directory into a Snapshot
adapters/epoch0           reference external project (deferred; read-only)
apps/web                  React UI (next)
```

Vocabulary: the product-facing contract (manifest keys, file front matter,
CLI flags, check rule ids) uses Latin names — Patron, Collegium, Sella, Lex,
Acta, Petitio, Opus, Probatio, Traditio, Aerarium, Stipendium — mapped to
their English equivalents in `docs/ADOPTION.md`. The wire-level `workflow.*`
attributes and lifecycle state ids stay English.

Try it:

```bash
npm install && npm run snapshot -- examples/sample-studio
```

## Principles

1. Nobody updates a card — the board is derived; the one write path is answering.
2. Opinionated over configurable — lifecycles are declared in code.
3. Evidence is two clicks from the red X — gate results carry evidence with identity.
4. Attention is an inbox with strict admission — asks only; digests are a separate feed.
5. Limits are routing state — who is hot, when it resets.
6. Certificates go stale honestly — a result certifies a specific commit.
7. Collegia are added only when a class of decision keeps escalating.

## Build order

1. Schema — done.
2. Native adapter over the adoption contract — done.
3. `bisellium check` — done.
4. `bisellium init` / `bisellium new` — done.
5. `bisellium context` / `bisellium query` — done (deterministic, offline; live in `packages/cli`, over the same files `check` reads).
6. Integrations behind the seams: treehouse (worktrees under `run`), no-mistakes (merge-blocking pipeline → gate evidence), quota-axi (`cli` provider status), axi output conventions; null fallbacks so the sample runs without them. ← current
7. Harness shim + direct line + tick: `run`, `talk`, `tick`/`pause`; firstmate evaluated as the L2 dispatcher.
8. `packages/core` — partially done: JSONL event log and snapshot differ (`diffSnapshots`) landed with an in-memory `Store`; burn derivation and a query API over the store are not yet built there (query today is `packages/cli`'s file-based `answer()`, not a core API).
9. `apps/web` — Inbox and Studio first, then Board with drawer, Digest, Agents.
10. Tauri wrapper: tray + native needs-you notifications.
11. External adapters: a markdown/git project (snapshot), harness hooks (events).

Cascade 1b hardened items 1–5 and 8 (review-flagged first-hour CLI friction and
`packages/core` correctness fixes) and renamed the contract's product-facing
vocabulary to Latin (see Vocabulary above); it did not advance past item 6,
which remains current.

Acceptance: the console renders the sample studio and an external adapter with
zero adapter-specific code outside the drawer's extension slot; replay
reproduces the live view; removing one adapter leaves the other untouched.
