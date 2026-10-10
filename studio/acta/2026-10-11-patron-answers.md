---
id: "2026-10-11-patron-answers"
title: Patron answers — W-208 Defaults, W-214/W-215 greenlights, review targets
kind: decision
author: producer
at: 2026-10-10T16:04:03Z
---
# Patron answers, 2026-10-11

## W-208 (the Ops collegium): Defaults 1-4, asked after spec review round 16 passed

1. Split: W-208 ships the collegium, seat, lex and the moves; per-step times are a follow-on (filed W-218).
2. Records land in two PRs: PR A before the build (this PR), PR B after the merge (`ops-moves.mjs`).
3. `tick --studio studio` runs once per opus at the retro step (production lex §9 step 7).
4. `ops-lead` sits on `claude-opus-5-5`; the Ops allowance is 1,000,000 tokens a week (`aerarium/2026-W41.yml`).

Defaults 5 (the `budget --tokens` fix as its own opus) is a filing, not a question: W-217, backlog.

## Greenlights

- W-214 — the retro rides in the done PR (one records PR per finished opus).
- W-215 — widened from the handoff review to every review loop (persistent reviewer, judge changed lines, code-computed facts, author rebuttal before a round fails).

Each states a measured result. Baseline (`~/.bisellium-evidence/W-215-baseline/rounds.py`, run 2026-10-11): spec reviews 65 rounds over 15 opera, 42 failed (65%), mean 4.3, max 12; build reviews 205 rounds over 88 opera, 41 with a `failed` outcome header (about 62, ~30%, counting every FAIL form in older logs), mean 2.3, max 8; the W-205 handoff took 15 review rounds; 2 records PRs per finished opus. Preliminary targets, Patron-approved: mean spec reviews ≤ 2, build ≤ 1.5, a handoff review in one round plus at most one rebuttal, no finding later reversed, 1 records PR per finished opus. The retro of each reports the measured before and after.

## Filed

- W-216 — agents ask each other through the petitio (sella to sella); backlog, for the Patron to greenlight.

## Correction, 2026-10-11

The build figure first given to the Patron, "144 failed (70%)", was the producer's arithmetic error (a tally that also summed the script's summary lines); the W-215 architect caught it. Corrected above. The spec figure (42 of 65) stands.
