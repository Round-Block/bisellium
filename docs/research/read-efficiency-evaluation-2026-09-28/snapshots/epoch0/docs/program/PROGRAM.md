# Epoch 0 — Prod-Ready Program: Live Status

> Spec: `docs/superpowers/specs/2026-08-25-prod-ready-program-design.md`

## Milestone ladder

| Milestone | Status | Notes |
|---|---|---|
| M0 — Audit & Baseline | DONE (2026-08-26, PR #106) | Gap audit, asset-estate inventory, program state layer, journal restructure, baseline APK, M1 plan. |
| M1 — Legible Core | DONE (2026-08-27) | 5 trains (PR #107-111): deploy hardening, M0 screen fixes, shield visibility, Taste Gate 1 locked, finn/lena/grub 4★ batch (sim-gated), complete battle screen (6 review cycles), balance measured+closed, local LAN hosting (cloud deferred). Remainder re-scopes logged in DECISIONS. |
| M2 — World & Story | DONE (2026-08-27-m2-world-story.md's task list is fully merged; only the M2-close housekeeping task remained, since folded into board-driven work) | Narrative surfaced in-game, FTUE, endgame/retention loop design + build. **[CORRECTED 2026-09-11 reconciliation — see the P-overlay below]** this row previously read "in progress" while every M2-plan task row on BOARD.md was already `done`. |
| M3 — Art at Scale | live, not "pending" | Pipeline bake-off, TASTE GATE 2, batch production of characters/enemies/bosses/environments/VFX. **[CORRECTED 2026-09-11 reconciliation]** this row previously read "pending" — the Cala pilot (`feature/cala-pilot-2`) and the astra status-icon batch (PR #199) have been the live art-track lane for roughly two weeks; see the P-overlay below for how this milestone is being re-sequenced. |
| M4 — Audio | pending | TASTE GATE 3, full soundscape. |
| M5 — Live Service | pending | Event system + timeline, player customization, service hardening, security backlog. |
| M6 — Prod-Ready | pending | Device perf, QA sweeps, settings/QoL, final balance pass. Finish-line build. |

## P-overlay (operative ordering, 2026-09-11)

**`docs/program/PRODUCT.md` is now the operative sequencing authority.**
The M-ladder above stays as the phase map (it still correctly describes
each milestone's SCOPE), but the ORDER work happens in is the P1-P5
Playable Ladder: P1 "It feels like a game" → P2 "It looks like our
world" → P3 "Characters at scale" → P4 "It's a live game" → P5 "It's
in your hands anywhere." See PRODUCT.md §3 for the full ladder and §4
for the exact M↔P mapping table. In short: M2 is done; M3 splits into
P2 (2D portraits/environments/Cala-in-game) then P3 (3D batch
production); M5→P4; M6→P5; M4 (Audio) is not yet placed on the P-ladder
by any ruling found (flagged in PRODUCT.md, not silently ordered).

## Task Board

<!-- board-migration-complete: 2026-08-29; new backlog items go to
     docs/program/BOARD.md, not a table here — scripts/check_process.py
     fails the gate on any new backlog-shaped table below this marker. -->

**All task/backlog state lives in `docs/program/BOARD.md`** — the
"Absorbed Backlog" table that used to live here (49 rows, M0's parked-
program absorption through 2026-08-29's accumulated review findings)
was migrated there wholesale on 2026-08-29 (workflow-canon train), with
provenance and two stale-row corrections noted in BOARD.md's own
"Migration provenance" section. This file keeps milestones, gates, and
strategy — not task-level state.

## Current Work

**[CORRECTED 2026-09-11 reconciliation]** this line named
`docs/superpowers/plans/2026-08-27-m2-world-story.md` while the last
~15 merges have actually been driven by `docs/program/BOARD.md` rows
(PB-084, PB-085, the Tower of Ascension proposal, the art-workflow
canon train), not that plan. Current work is whatever `docs/program/
BOARD.md`'s `scheduled` section names — that board, not this line, is
the live source of truth for in-flight work (see WORKFLOW.md
Canonicity).
