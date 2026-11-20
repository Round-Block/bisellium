---
author: qa-lead
kind: decision
title: "Retro input, sessions 74-75 and the W-503/W-504 audits"
at: 2026-11-20T13:57:14Z
---

Purpose: the daily retro's input of owed retro points from sessions 74-75, plus the W-503 and W-504 audit prevention items, so they need not be carried in session notes or the audit files again.

## Session 74

Retro s74 (hhhh)-(jjjj):
(hhhh) a clerk cannot write opera bodies (W-542): an opus body change goes by `amend`'s --title/--reason.
(iiii) a red recorded during a concurrent served/full run can fail on a stale served UI: run served reds alone; next counts it usable, no verb re-records.
(jjjj) give the Patron the full next-session prompt, never a one-line patch to an earlier one; the '170k' line came from s73's handoff prompt, not a rule.

## Session 75

Retro s75 (kkkk)-(oooo):
(kkkk) a kept red line must quote '--test-name-pattern=^...\s' (zsh drops the backslash; red refused as a pass).
(llll) never wrap land in a timeout shorter than its polls.
(mmmm) a clerk has no clock: give it the measured UTC time.
(nnnn) new opera rank by value against the queue, never placed by dependency alone (Patron s75).
(oooo) a ui opus needs ci --opus before its build review packet (until W-665).

## W-504 audit prevention items

Source: `/home/edckt/.bisellium-evidence/w504-audit-1120/audit.md`, "Root causes, ranked by time lost".

1. Dependency wait (~15-16 days): file a dependent opus only once its base is branch-stable, or spec-ahead right after the scope ruling and recut the prototype on the base's merged tree.
2. Process/record-tool refusal (~17h39m): the signer runs the exact authoritative verdict and full `next` admission in a disposable clone, and admission returns every defect at once.
3. Orchestration error (several fragmented hours): generate record-kit commands from `next`'s own output and validate the complete kit, through its handoff, in a dry clone before dispatch.
4. Review loop (~6h20m): get the reviewer's and the ui-lead's input on the same signed revision before sending one consolidated correction back, instead of a round per seat.
5. Environment (~1h36m, current blocker): served-test setup refuses when any workspace package resolves outside the current worktree; each worktree gets its own install and build output.
6. Prototype/base drift: before `ready`, the signed prototype series must apply cleanly to the exact branch base, or be recut; an earlier dependency's head is never portable evidence.

## W-503 audit prevention items

Source: `/home/edckt/.bisellium-evidence/w503-audit-1120/audit.md`, "Root causes ranked by time lost" and "Prevention".

a. Signed visual-baseline rule (root cause 1, ~184h, the dominant cause): any later prototype pixel/layout delta from a signed baseline needs a cited ruling and an automated signed-image/diff check before re-signing.
b. Delta review for certified no-scope amendments (root cause 4): a design-lead-certified nonvisual, no-scope amendment should stand on its passed or design-keeping review's digest, not force a full three-seat pass again; already landed as rule `spec.delta_review` (D-245/D-246, W-699).
c. Recorder preflight (root cause 4): dry-run the exact verdict, round, Earlier-findings, session-reason, header and evidence-digest shape in a disposable clone before dispatching a reviewer or a red recording.
d. Packet guard (root cause 5): a review-packet script that exits non-zero must stop before any reviewer model call runs.
e. CI parity with the merge-group policy (root cause 3): run the merge-group-only policy gate, with its real cwd and browser/build order, before build review and the PR, not only inside merge-queue certify.
f. One heavy-suite lock + stale-lock cleanup (root cause 5): one heavy suite runs at a time, and a stale lock (for example `.bisellium/vendor-sentinel.lock`) is cleaned up automatically, not by a session noticing and removing it by hand.

Owner: qa-lead files each as a lesson or folds it per D-234 at the next daily retro; then this file's points are closed.

## Closed

All points above closed 2026-11-20T13:57:14Z by the producer, filed as lessons L-246 through L-265 (see each lesson's `addressed_by` or Fix line for its disposition). No open point remains.
