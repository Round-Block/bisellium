# Bisellium

One application, two halves:

- **The studio model** — an agent organization patterned on a product team.
  A department is *charter + budget + digest*; the Owner touches only
  greenlight, budget allocation, taste calls, and charter changes.
  Conventions, not a runtime: agents keep running in their own toolchains.
- **The console** — the pipeline view over that studio (and any other source):
  Board · Inbox · Swimlane · Agents · Digest · Studio · Graph. Boards are
  projections derived from reality, never human data entry.

Design history (under the console's former working name, Gantry):
[research + spec dossier](https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c) ·
[UI design canvas](https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f).

## Layout

```
docs/STUDIO.md            the organization model
docs/CHARTER_TEMPLATE.md  per-department charter
docs/ADOPTION.md          what an Bisellium-compliant project directory contains
examples/sample-studio    a complete instance — the app runs on this alone
packages/schema           the contract: entities, lifecycles, workflow.* attributes
packages/core             local-first event store, snapshot differ, query API (next)
adapters/native           reads an Bisellium directory into a Snapshot
adapters/epoch0           reference external project (deferred; read-only)
apps/web                  React UI (next)
```

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
7. Departments are added only when a class of decision keeps escalating.

## Build order

1. Schema — done.
2. Native adapter over the adoption contract — done.
3. `packages/core` — store, snapshot differ, query API. ← current
4. `apps/web` — Board first, then Drawer, Inbox, Studio.
5. Tauri wrapper: tray + native needs-you notifications.
6. External adapters: epoch0 (snapshot), Claude Code hooks (events).

Acceptance: the console renders the sample studio and an external adapter with
zero adapter-specific code outside the drawer's extension slot; replay
reproduces the live view; removing one adapter leaves the other untouched.
