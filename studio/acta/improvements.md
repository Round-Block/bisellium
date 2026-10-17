---
author: producer
kind: daily
title: "Improvements tracker"
at: 2026-10-17T00:00:00Z
---
# Improvements tracker

Every process change since 2026-10-16, its expected saving and what the daily retro measured (D-076 F). The daily retro
(`~/.bisellium-evidence/retro-daily/retro.py`) appends a dated section below the table; the producer updates the
Measured and Status columns from it. Cycle = minutes from the first spec signature to done landed (D-075).

| Change | Decided | Landed | Expected | Measured | Status |
|---|---|---|---|---|---|
| D-074 seats are live settings (W-304 builds it) | 2026-10-17 | not built | no PR per seat change | not yet | queued (console group) |
| D-075 cycle minutes are the measure; one heavy job at a time | 2026-10-17 | PR 526 | speed made visible | baseline: W-302 199 min, W-303 425, W-214 ~495, W-264 ~300 | live |
| W-302 code-owner review covers seats and prompts | 2026-10-16 | PR 521 | safety, no minutes | n/a | done |
| W-303 brief admission refuses a whole-diff promise that forgets records | 2026-10-16 | PR 527 | fewer failed spec rounds | not yet | done |
| W-214 an opus closes in one records PR | 2026-10-17 | PR 530 | 10-15 min per opus | W-214 and W-264 closed with one done PR each | done |
| W-264 brief admission runs with no behaviour limit | 2026-10-17 | PR 531 | product fix (L-186) | n/a | done |
| W-306 architect signature cites a promise ledger | 2026-10-17 | PR 534 | fewer failed spec rounds | W-274 still failed 8 with a ledger | done; warning if 2 more opera fail on wording (D-076 D) |
| W-307 reader ledger | 2026-10-17 | halted | - | - | halted (D-076 D) |
| D-076 only real defects block; second spec review only after a design-changing defect | 2026-10-17 | this PR | ~20 min per opus | not yet | live |
| D-077 work state is a git record; W-299 queue.yml + next --all; W-308 timeline | 2026-10-17 | not built | no session note; cycle minutes from records | not yet | queued |
| W-305 fast lane for one-behaviour light briefs | 2026-10-17 | not built | ~35 min on a trivial opus | not yet | queued |
| W-179 split the slow test file | 2026-10-17 | not built | 60-70 min per opus | not yet | queued |
| W-259 one certify instead of mint plus verify | 2026-10-17 | part 1 done 2026-10-17 (#544, #546) | ~41 min per opus | done records certify, no local verify | parts 2, 3 queued as W-312, W-313 |
| W-292 the runner chains mint, review, PR and merge | 2026-10-17 | part 1 done 2026-10-17 (#540, #547) | 50-70 min idle per opus | used on W-259 and W-311 (mint, review, PR in one call) | remainder queued as W-310 |

## Daily retro

### 2026-10-16

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-302 | 174 | 24 | 1 | untagged 3 |
| W-303 | 425 | 293 | 1 | untagged 1 |

### 2026-10-17

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-214 | 521 | 50 | 0 |  |
| W-264 | 296 | 19 | 2 | untagged 11 |
| W-306 | 206 | 33 | 2 | untagged 5 |

### 2026-10-17

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-214 | 521 | 50 | 0 |  |
| W-259 | 218 | 27 | 2 | S1 1, untagged 1 |
| W-264 | 296 | 19 | 2 | untagged 11 |
| W-274 | 162 | 25 | 2 | untagged 10 |
| W-292 | 511 | 24 | 1 | S1 2 |
| W-306 | 206 | 33 | 2 | untagged 5 |
