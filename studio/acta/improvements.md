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
| W-259 | 218 | 27 | 2 | S1 1, untagged 1 |
| W-264 | 296 | 19 | 2 | untagged 11 |
| W-274 | 162 | 25 | 2 | untagged 10 |
| W-292 | 511 | 24 | 1 | S1 2 |
| W-306 | 206 | 33 | 2 | untagged 5 |

### 2026-10-18

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-312 | 579 | 48 | 2 | S1 2, untagged 1 |
| W-314 | 98 | 24 | 0 |  |
| W-315 | 158 | 30 | 0 |  |
| W-316 | 205 | 24 | 1 | S1 1 |
| W-319 | 66 | 31 | 0 |  |

### 2026-10-19

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-178 | 11689 | 324 | 8 | S1 1, untagged 8 |
| W-322 | 173 | 34 | 2 | S2 2, untagged 1 |
| W-323 | 139 | 24 | 0 |  |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-178 | review | 3 | failed | 47 | tests×ruled-case-uncovered untagged |
| W-178 | review | 4 | failed | 76 | tests×ruled-case-uncovered untagged |
| W-178 | review | 5 | failed | 108 | tests×ruled-case-uncovered untagged |
| W-178 | review | 6 | passed | 11 |  |
| W-178 | review | 7 | passed | 23 |  |
| W-178 | review | 8 | passed | 230 |  |
| W-178 | spec | 11 | passed | 288 |  |
| W-178 | spec | 12 | passed | 5 |  |
| W-178 | spec | 13 | passed | 7 |  |
| W-178 | spec | 14 | passed | 5 |  |
| W-178 | spec | 15 | passed | 231 |  |
| W-178 | spec | 16 | passed | 3 |  |
| W-322 | review | 1 | failed | - | tests×ruled-case-uncovered S2, tests×ruled-case-uncovered S2 |
| W-322 | review | 2 | failed | 32 | spec×fix-opens-new-surface untagged |
| W-322 | review | 3 | passed | 49 |  |
| W-322 | spec | 1 | passed | - |  |
| W-322 | spec | 2 | passed | 5 |  |
| W-323 | review | 1 | passed | - |  |
| W-323 | spec | 1 | passed | - |  |
| W-323 | spec | 2 | passed | 6 |  |

- LOOP W-178 review: class tests×ruled-case-uncovered, rounds 1-4 (minutes since previous round: r1 -, r2 26, r3 47, r4 76)
- LOOP W-178 review: any class, rounds 1-5 (minutes since previous round: r1 -, r2 26, r3 47, r4 76, r5 108)

Classes in more than one opus, 2026-10-05..2026-10-19:
- class review×evidence-backfilled-or-absent seen in 2 opera: W-178, W-312
- class security×symlink-parent-write-escape seen in 2 opera: W-259, W-274
- class spec×input-domain-missing-or-unenforceable seen in 5 opera: W-274, W-292, W-306, W-312, W-316
- class spec×promise-unattainable-under-accepted-domain seen in 5 opera: W-264, W-274, W-293, W-302, W-312
- class tests×ruled-case-uncovered seen in 3 opera: W-178, W-292, W-322

### 2026-10-20

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-241 | 9904 | 21 | 2 | untagged 5 |
| W-268 | 232 | 19 | 1 | S1 1 |
| W-288 | 140 | 76 | 2 | S1 2 |
| W-297 | 121 | 19 | 1 | S1 1 |
| W-299 | 178 | 70 | 1 | S1 2 |
| W-313 | 107 | 30 | 0 |  |
| W-317 | 90 | 19 | 1 | S1 1 |
| W-330 | 84 | 19 | 1 | S1 1 |
| W-334 | 298 | 29 | 4 | S1 8 |
| W-335 | 200 | 19 | 1 | S1 1 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-241 | review | 1 | passed | - |  |
| W-241 | spec | 5 | passed | 9785 |  |
| W-241 | spec | 6 | failed | 6 | spec×prose-contradiction-under-revision untagged, spec×promise-unattainable-under-accepted-domain untagged, spec×promise-unattainable-under-accepted-domain untagged |
| W-241 | spec | 7 | passed | 4 |  |
| W-241 | spec | 8 | passed | 2 |  |
| W-268 | review | 1 | passed | - |  |
| W-268 | spec | 1 | passed | - |  |
| W-268 | spec | 2 | failed | 94 | spec×promise-unattainable-under-accepted-domain S1 |
| W-268 | spec | 3 | passed | 11 |  |
| W-268 | spec | 4 | passed | 3 |  |
| W-268 | spec | 5 | passed | 48 |  |
| W-268 | spec | 6 | passed | 29 |  |
| W-288 | review | 1 | passed | - |  |
| W-288 | review | 2 | passed | 56 |  |
| W-288 | spec | 1 | passed | - |  |
| W-288 | spec | 2 | failed | 7 | spec×input-without-named-rejector S1 |
| W-288 | spec | 3 | passed | 17 |  |
| W-288 | spec | 4 | failed | 3 | spec×input-without-named-rejector S1 |
| W-297 | review | 1 | passed | - |  |
| W-299 | review | 1 | passed | - |  |
| W-299 | review | 2 | passed | 16 |  |
| W-299 | spec | 1 | passed | - |  |
| W-299 | spec | 2 | failed | 6 | spec×input-domain-missing-or-unenforceable S1, spec×promise-unattainable-under-accepted-domain S1 |
| W-299 | spec | 3 | passed | 16 |  |
| W-299 | spec | 4 | passed | 29 |  |
| W-313 | review | 1 | passed | - |  |
| W-317 | review | 1 | failed | - | tests×one-sided-bound-assertion S1 |
| W-317 | review | 2 | passed | 18 |  |
| W-317 | spec | 1 | passed | - |  |
| W-317 | spec | 2 | passed | 5 |  |
| W-330 | review | 1 | failed | - | tests×one-sided-bound-assertion S1 |
| W-330 | review | 2 | passed | 25 |  |
| W-330 | spec | 1 | passed | - |  |
| W-330 | spec | 2 | passed | 6 |  |
| W-334 | review | 1 | failed | - | mechanism×cycle-guard-not-propagated S1, mechanism×regex-metadata-counted-as-digits S1, mechanism×shadowed-global-treated-as-builtin S1 |
| W-334 | review | 2 | failed | 26 | mechanism×shadowed-global-treated-as-builtin S1 |
| W-334 | review | 3 | passed | 33 |  |
| W-334 | spec | 1 | passed | - |  |
| W-334 | spec | 2 | failed | 10 | spec×input-domain-missing-or-unenforceable S1, spec×input-domain-missing-or-unenforceable S1, spec×input-domain-missing-or-unenforceable S1 |
| W-334 | spec | 3 | passed | 31 |  |
| W-334 | spec | 4 | failed | 8 | spec×input-domain-missing-or-unenforceable S1 |
| W-334 | spec | 5 | passed | 191 |  |
| W-335 | review | 1 | failed | - | tests×ruled-case-uncovered S1 |
| W-335 | review | 2 | passed | 22 |  |
| W-335 | spec | 1 | passed | - |  |
| W-335 | spec | 2 | passed | 8 |  |
| W-335 | spec | 3 | passed | 120 |  |
| W-335 | spec | 4 | passed | 4 |  |

- LOOP W-334 review: class mechanism×shadowed-global-treated-as-builtin, rounds 1-2 (minutes since previous round: r1 -, r2 26)

Classes in more than one opus, 2026-10-06..2026-10-20:
- class review×evidence-backfilled-or-absent seen in 3 opera: W-178, W-179, W-312
- class security×symlink-parent-write-escape seen in 2 opera: W-259, W-274
- class spec×input-domain-missing-or-unenforceable seen in 8 opera: W-179, W-274, W-292, W-299, W-306, W-312, W-316, W-334
- class spec×promise-unattainable-under-accepted-domain seen in 8 opera: W-241, W-264, W-268, W-274, W-293, W-299, W-302, W-312
- class spec×prose-contradiction-under-revision seen in 2 opera: W-241, W-274
- class tests×one-sided-bound-assertion seen in 2 opera: W-317, W-330
- class tests×ruled-case-uncovered seen in 4 opera: W-178, W-292, W-322, W-335

### 2026-10-24

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| none done | | | | |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| none | | | | | |

- no loop

Classes in more than one opus, 2026-10-10..2026-10-24:
- class review×evidence-backfilled-or-absent seen in 8 opera: W-178, W-179, W-312, W-340, W-341, W-360, W-361, W-366
- class review×fail-open-on-malformed-records-patched-per-site seen in 5 opera: W-275, W-326, W-337, W-338, W-348
- class security×symlink-parent-write-escape seen in 2 opera: W-259, W-274
- class spec×fix-opens-new-surface seen in 3 opera: W-310, W-322, W-362
- class spec×input-domain-missing-or-unenforceable seen in 20 opera: W-179, W-274, W-292, W-299, W-305, W-306, W-310, W-312, W-316, W-334, W-337, W-338, W-339, W-340, W-348, W-358, W-362, W-369, W-376, W-377
- class spec×input-without-named-rejector seen in 3 opera: W-288, W-310, W-328
- class spec×promise-unattainable-under-accepted-domain seen in 15 opera: W-241, W-264, W-268, W-274, W-293, W-299, W-302, W-310, W-312, W-326, W-339, W-341, W-348, W-369, W-377
- class spec×prose-contradiction-under-revision seen in 2 opera: W-241, W-274
- class tests×one-sided-bound-assertion seen in 7 opera: W-310, W-317, W-328, W-330, W-360, W-369, W-377
- class tests×ruled-case-uncovered seen in 8 opera: W-178, W-292, W-322, W-335, W-336, W-337, W-350, W-376
- class tests×security-boundary-cases-uncovered seen in 2 opera: W-310, W-369
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-339, W-340
