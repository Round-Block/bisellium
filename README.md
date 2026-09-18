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
6. Integrations behind the seams — partial:
   - `bisellium providers` (quota-axi live telemetry, composited with `usage.yml`) — done.
   - `bisellium run` (worktree acquire/release + receipts) — done against git worktrees; a `treehouseProvider` seam exists and is picked up automatically when `treehouse` is on `PATH`, but the installed CLI (v1.8.0) doesn't accept `run`'s `--base` yet, so pass `--no-worktree` or omit `--base` on a machine with treehouse installed until that's reconciled.
   - `bisellium verify` (gate evidence from an actual command run, written back into an opus) — done via a local pipeline; the `no-mistakes` merge-blocking pipeline has no non-interactive "validate and report per-probatio" entry point yet, so it's a documented stub that always defers to the local runner.
   - Null fallbacks throughout: the sample and `studio` run fully without any of quota-axi, treehouse or no-mistakes installed.
7. Harness shim + direct line + tick — mostly done:
   - `bisellium talk` (a direct line to one sella over a `claude-code`/`codex`/`git-only` harness profile, a deterministic-query fast path, resumable sessions, timeline + petitio/acta escalation) — done.
   - `bisellium tick` (L1 scheduled autonomy: `check` + `health.json` always, due dailies/aerarium/traditio for `autonomy: L1+` collegia, dailies actually written via `talk`) — done.
   - `bisellium pause` / `bisellium resume` (the manual brake: `tick` skips cadence work while paused; `run`/`talk` proceed with a one-line warning) — done.
   - Patron and sella write commands (`handoff`, `emit`, `answer`, `greenlight`, `budget`) — done, wired into the CLI with tests.
   - Not yet: firstmate as the L2 dispatcher; a sella's manifest `model` isn't passed through to its harness CLI yet, so every seat talks on the vendor's default model. ← current
8. `packages/core` — partially done: JSONL event log and snapshot differ (`diffSnapshots`) landed with an in-memory `Store`; burn derivation and a query API over the store are not yet built there (query today is `packages/cli`'s file-based `answer()`, not a core API).
9. `apps/web` — Inbox and Studio first, then Board with drawer, Digest, Agents.
10. Tauri wrapper: tray + native needs-you notifications.
11. External adapters: a markdown/git project (snapshot), harness hooks (events).

Cascade 1b hardened items 1–5 and 8 (review-flagged first-hour CLI friction and
`packages/core` correctness fixes) and renamed the contract's product-facing
vocabulary to Latin (see Vocabulary above).

Cascade 2 landed item 6 (`providers`, `run`, `verify`, wired into the CLI with
tests, `typecheck` and `check` green on both `examples/sample-studio` and
`studio`) with the caveats noted above; it did not advance past item 7, which
remains current.

Cascade 3 landed the rest of item 7's CLI surface — `talk`, `tick` (L1),
`pause`/`resume`, and the Patron/sella write commands — all wired into
`main.ts` with `typecheck`, `npm test` and `check` green on both
`examples/sample-studio` and `studio`; item 7's two remaining gaps (firstmate
as the L2 dispatcher, and passing a sella's `model` through to its harness
CLI) are noted above and carry forward.

Acceptance: the console renders the sample studio and an external adapter with
zero adapter-specific code outside the drawer's extension slot; replay
reproduces the live view; removing one adapter leaves the other untouched.
