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
packages/core             JSONL event log, snapshot differ, SQLite index + query API, Store
packages/shim             worktree seam, run receipts, harness profiles (claude-code/codex/git-only/fake), Claude Code hooks profile
adapters/native           reads an Bisellium directory into a Snapshot
adapters/epoch0           reference external project (deferred; read-only)
apps/server               localhost HTTP + SSE surface over a studio (`bisellium serve`)
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
8. `packages/core` — done: JSONL event log, snapshot differ (`diffSnapshots`), a per-source-seq `Store` that persists a snapshot cache (`.bisellium/snapshots/<source>.json`) and feeds a SQLite index (`.bisellium/index/index.db`, `node:sqlite`), and a query API (`opera`/`opus`/`needsYou`/`burn`/`timeline`/`events`/`stats`) mirroring `packages/cli`'s file-based `answer()` shapes. `bisellium query` gains `--from-index` to answer from the index instead of re-reading every file, falling back to files whenever the index is missing, locked or corrupt. A corrupt log line or index db file is recovered from, never fatal (matches the file-based readers' own degrade-don't-throw discipline).
9. `apps/web` — Inbox and Studio first, then Board with drawer, Digest, Agents.
10. Tauri wrapper: tray + native needs-you notifications.
11. External adapters: a markdown/git project (snapshot) — done; harness hooks (events) — first profile done:
    - `apps/server` (`bisellium serve`): a localhost-only HTTP + SSE server over a studio — `GET /api/{officina,opera,opus/:id,inbox,acta,aerarium,providers,health,timeline/:sella,events,receipts}`, `GET /api/live` (SSE), and the Patron/sella write routes (`answer`/`greenlight`/`budget`/`handoff`/`talk`/`pause`/`resume`) reusing `packages/cli`'s write functions under a per-server write lock. Writes are refused from anything but 127.0.0.1.
    - `packages/shim`'s `claude-code` hooks profile: `bisellium hooks print --harness claude-code --sella <id>` prints the `.claude/settings.json` block to paste in (SessionStart → `bisellium context` + `bisellium hook-event start`; PreCompact → `bisellium context`; Stop → `hook-event stop`; PostToolUse (Write|Edit) → `hook-event tool`; SubagentStart intentionally left unwired). `bisellium hook-event <start|stop|tool|compact>` is the actual hook target: reads its payload from stdin, never blocks the harness (always exits 0, at most one stderr line), and rejects a path-shaped `session_id`/`--sella` rather than joining untrusted harness input straight into a receipt path. `bisellium hooks check` / `check`'s `hook.dead` rule report per-sella hook liveness from those receipts.

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

Cascade 4 landed item 8 (`packages/core`'s SQLite index + query API, `bisellium
query --from-index`), a localhost HTTP + SSE server (`apps/server`, `bisellium
serve`) over a studio, and item 11's first harness-hooks profile
(`packages/shim`'s `claude-code` profile plus `bisellium hooks`/`hook-event`,
wired into `main.ts`) — `typecheck`, `npm test` and `check` green on both
`examples/sample-studio` and `studio`. `apps/server` reads through its own
thin per-source ingest (not `packages/core`'s `Store` directly — the two
converged on the same on-disk contract, `EVENTS_LOG_REL`/`SNAPSHOTS_DIR_REL`,
rather than a shared class, so the two builds that landed in the same window
never had to block on each other's `Store` signature). Carried forward:
`apps/web` (item 9) hasn't started, so `apps/server`'s API is exercised today
via curl/tests and its own built-in route-index page, not a real UI; item 7's
two gaps above still stand.

Cascade 4b landed the instructions layer (item 11: `CLAUDE.md`/`AGENTS.md`/
`GLOSSARY.md` rendered from one template + the manifest, `checkInstructions`,
the `.claude/` hook profile, subagents and slash commands — W-017) and the
process-as-data layer (a Design collegium, `studio/briefs/*`,
`studio/decisions/*`, `bisellium new --spec/--brief`, `bisellium retro` and
its lesson/petitio/pruning-candidate machinery, `rules/{lex,process}.ts` —
W-018), both now actually wired into `main.ts`/`check.ts` and committed —
`typecheck`, `npm test` and `check` are green on both `examples/sample-studio`
and `studio`, and `bisellium` now has a real `bin` entry
(`packages/cli/bin/bisellium.mjs`). Cascade sizing is data too (D-012, backed
by `cascades/sizing.json`) and a cascade's usage is a retrospectio input
(D-013): `bisellium emit --usage` records real per-agent spend, and
`bisellium retro`'s optional `usage` input adds a "Usage" section to the
acta it drafts (totals, checking/building ratio, tokens per opus, trend vs.
the previous retro, posture from the current aerarium).

What's still halted, honestly (`studio/opera/W-01{6,8,9}.md` carry the
detail): W-016 (server/core correctness — the `@bisellium/commands`
workspace move, the SQLite index as `apps/server`'s read path, and
write-route auth were never built) and W-019 (repo hygiene — no eslint
config, no CI, no docs registry, no `CONTRIBUTING.md`) landed nothing on
disk; their halts from cascade 4b's own retro (worktree fragmentation, no
persistent bookkeeping) no longer apply — the tree is committed now — but
the underlying work itself still doesn't exist. W-019's absence is also why
W-017 and W-018, despite each meeting its own brief's acceptance criteria in
full, cannot reach `state: done`: `studio/bisellium.yml` declares `lint`
(`npm run -s lint`) as a studio-wide automated probatio, no lint script
exists anywhere in this repo, and `check.ts` blocks `done` while any
automated gate is unpassed (automated gates can't be waived). This pass
deliberately did not invent an eslint config from scratch to paper over
that — picking one is W-019's call, not a wiring/greening pass's.

Acceptance: the console renders the sample studio and an external adapter with
zero adapter-specific code outside the drawer's extension slot; replay
reproduces the live view; removing one adapter leaves the other untouched.
