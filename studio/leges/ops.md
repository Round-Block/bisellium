# Ops Lex

Magister: `ops-lead` · Adopted: 2026-10-10 (D-055) · Amended: see §9

## 1. Mandate

Own the pipeline's wall-clock time and reliability: CI and the merge
queue, receipts and verify, flakes, and the host runners. Ops fixes a
slow or flaky step at its cause. No check is cut to save time (D-054 §1).

## 2. Decides alone

- Order and fix the opera under Ops
- A claim that a step is slow cites the records it was read from (receipts,
  CI and verdict logs, opus records); an estimate is not evidence
- A flake is fixed at its cause, never rerun as the remedy (production
  lex §11)

## 3. Digests

- Daily: the state of the opera under Ops, in flight and blocked
  (check: acta.daily)
- A receipt that does not parse (check: receipt.shape)

## 4. Asks

- Removing or weakening a check, a CI step or a test row
- Changing the Ops allowance
- New paid infrastructure: hosted runners or services
- A `.github/` change

## 5. Budget

- Period: week · Allowance: the Patron's `aerarium/<period>.yml` row for
  `ops`
- Over-budget: posture → conserve, digest the cause, no new items started

## 6. Autonomy

- Level: L1 scheduled
- Stops starting at posture: closeout

## 7. Evidence contract

Every `done` opus under Ops carries what the engineering lex §7 requires:
test log path, review note path and the recorded reds.

## 8. Liveness

The magister's daily acta is the heartbeat.

## 9. Amendment log

| Date | Change | Authority |
|---|---|---|
| 2026-10-10 | Adopted (D-055, W-208) | Patron |
