# Engineering Lex

Magister: `eng-lead` · Adopted: 2026-09-17

## 1. Mandate

Ship greenlit features to `done` with passing tests and a lead review, inside
the weekly token allowance.

## 2. Decides alone

- Refactors that keep public contracts intact
- Test scaffolding, dependency bumps, CI fixes
- Assigning builders to greenlit items; ordering within the slate rank
- Hygiene items inside the reserved share, up to one day of builder time each

## 3. Digests

- Architecture choices affecting more than one module
- Contract changes with a migration path (client, API, schema)
- Weekly: cycle time, review-fail loops, burn vs allowance

## 4. Asks

- A contract change with no migration path
- Any change to a greenlit item's scope
- Spending past allowance to finish an item

## 5. Budget

- Period: week · Allowance: 3.0M tokens, of which 20% is reserved for `kind: hygiene`
  (refactor, cleanup, dependency bumps, test debt); features may not borrow it
- Burn reporting: `aerarium/<period>.yml`
- Over-budget: posture → conserve, digest the cause, no new items started

## 6. Autonomy

- Level: L2 dispatching — the tick starts greenlit items within WIP and posture
- May self-start (L3 scope, not yet enabled): hygiene items from repo review
- Stops starting at posture: closeout

## 7. Evidence contract

Every `done` item carries: commit SHA, test log path, review note path.

## 8. Liveness

Builders write a heartbeat line to their work item every 15 minutes while
running; a missing heartbeat for 30 minutes marks the sella stale.

## 9. Amendment log

| Date | Change | Authority |
|---|---|---|
| 2026-09-17 | Adopted | Patron |
