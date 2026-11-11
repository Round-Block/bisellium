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

### 2026-10-29

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-407 | 2653 | 30 | 3 | S1 3 |
| W-454 | 268 | 49 | 1 | S1 1 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-407 | review | 1 | failed | - | tests×tests-that-agree-with-the-bug S1 |
| W-407 | review | 2 | passed | 43 |  |
| W-407 | review | 3 | passed | 115 |  |
| W-407 | spec | 17 | passed | 279 |  |
| W-407 | spec | 18 | passed | 3 |  |
| W-407 | spec | 19 | passed | 2 |  |
| W-407 | spec | 20 | passed | 50 |  |
| W-450 | review | 1 | failed | - | tests×ruled-case-uncovered S1 |
| W-450 | review | 2 | failed | 81 | tests×ruled-case-uncovered S1 |
| W-450 | review | 3 | passed | 68 |  |
| W-450 | spec | 1 | passed | - |  |
| W-450 | spec | 2 | passed | 6 |  |
| W-450 | spec | 3 | passed | 131 |  |
| W-450 | spec | 4 | passed | 10 |  |
| W-454 | review | 1 | failed | - | tests×ruled-case-uncovered S1 |
| W-454 | review | 2 | passed | 123 |  |
| W-454 | spec | 1 | passed | - |  |
| W-454 | spec | 2 | passed | 46 |  |

- LOOP W-450 review: class tests×ruled-case-uncovered, rounds 1-2 (minutes since previous round: r1 -, r2 81)

Classes in more than one opus, 2026-10-15..2026-10-29:
- class review×evidence-backfilled-or-absent seen in 12 opera: W-178, W-179, W-312, W-340, W-341, W-360, W-361, W-366, W-406, W-415, W-417, W-425
- class review×fail-open-on-malformed-records-patched-per-site seen in 7 opera: W-275, W-326, W-337, W-338, W-348, W-403, W-404
- class security×symlink-parent-write-escape seen in 4 opera: W-259, W-274, W-418, W-423
- class spec×fix-opens-new-surface seen in 3 opera: W-310, W-322, W-362
- class spec×input-domain-missing-or-unenforceable seen in 24 opera: W-179, W-274, W-292, W-299, W-305, W-306, W-310, W-312, W-316, W-334, W-337, W-338, W-339, W-340, W-348, W-358, W-362, W-369, W-370, W-376, W-377, W-381, W-403, W-433
- class spec×input-without-named-rejector seen in 5 opera: W-288, W-310, W-328, W-416, W-418
- class spec×promise-unattainable-under-accepted-domain seen in 21 opera: W-241, W-264, W-268, W-274, W-293, W-299, W-302, W-310, W-312, W-326, W-339, W-341, W-348, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425
- class spec×prose-contradiction-under-revision seen in 2 opera: W-241, W-274
- class tests×one-sided-bound-assertion seen in 10 opera: W-310, W-317, W-328, W-330, W-345, W-360, W-369, W-377, W-381, W-392
- class tests×ruled-case-uncovered seen in 12 opera: W-178, W-292, W-322, W-335, W-336, W-337, W-350, W-376, W-404, W-415, W-450, W-454
- class tests×security-boundary-cases-uncovered seen in 3 opera: W-310, W-369, W-379
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-339, W-340

### 2026-10-30

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-408 | 3461 | 1075 | 2 | S1 2, untagged 1 |
| W-409 | 977 | 39 | 3 | S1 3 |
| W-443 | 366 | 34 | 0 |  |
| W-444 | 210 | 40 | 2 | S1 2 |
| W-445 | 572 | 49 | 1 | S1 1 |
| W-446 | 543 | None | 0 |  |
| W-462 | 260 | 30 | 3 | S1 5 |
| W-466 | 80 | 45 | 0 |  |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-409 | review | 1 | failed | - | tests×tests-that-agree-with-the-bug S1 |
| W-409 | review | 2 | passed | 152 |  |
| W-443 | review | 1 | passed | - |  |
| W-443 | spec | 1 | passed | - |  |
| W-443 | spec | 2 | passed | 5 |  |
| W-444 | review | 1 | failed | - | tests×ruled-case-uncovered S1 |
| W-444 | review | 2 | passed | 34 |  |
| W-444 | spec | 1 | passed | - |  |
| W-444 | spec | 2 | failed | 25 | review×fail-open-on-malformed-records-patched-per-site S1 |
| W-444 | spec | 3 | passed | 45 |  |
| W-444 | spec | 4 | passed | 2 |  |
| W-446 | review | 1 | passed | - |  |
| W-446 | spec | 1 | passed | - |  |
| W-446 | spec | 2 | passed | 3 |  |
| W-462 | review | 1 | failed | - | spec×promise-unattainable-under-accepted-domain S1 |
| W-462 | review | 2 | passed | 91 |  |
| W-462 | spec | 3 | passed | 79 |  |
| W-462 | spec | 4 | failed | 3 | mechanism×replay-environment-not-pristine S1 |
| W-463 | review | 1 | failed | - | tests×ruled-case-uncovered S2 |
| W-463 | review | 2 | passed | 145 |  |
| W-463 | spec | 1 | passed | - |  |
| W-463 | spec | 2 | passed | 3 |  |
| W-463 | spec | 3 | passed | 7 | untagged untagged, untagged untagged |
| W-463 | spec | 4 | passed | 125 |  |
| W-463 | spec | 5 | passed | 3 |  |
| W-463 | spec | 6 | passed | 7 |  |
| W-463 | spec | 7 | passed | 136 |  |
| W-463 | spec | 8 | passed | 4 |  |
| W-463 | spec | 9 | passed | 11 |  |
| W-463 | spec | 10 | passed | 94 |  |
| W-463 | spec | 11 | passed | 4 |  |
| W-463 | spec | 12 | passed | 5 |  |
| W-466 | review | 1 | passed | - |  |
| W-466 | spec | 1 | passed | - |  |
| W-466 | spec | 2 | passed | 5 |  |
| W-474 | review | 1 | failed | - | interface×validation-order-masks-errors S1, tests×ruled-case-uncovered S1, tests×ruled-case-uncovered S1 |
| W-474 | review | 2 | failed | 75 | interface×validation-order-masks-errors S1 |
| W-474 | review | 3 | passed | 80 |  |
| W-474 | spec | 1 | passed | - |  |
| W-474 | spec | 2 | passed | 44 |  |
| W-474 | spec | 3 | passed | 129 |  |
| W-474 | spec | 4 | passed | 4 |  |

- LOOP W-474 review: class interface×validation-order-masks-errors, rounds 1-2 (minutes since previous round: r1 -, r2 75)

Classes in more than one opus, 2026-10-16..2026-10-30:
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 2 opera: W-360, W-462
- class review×evidence-backfilled-or-absent seen in 13 opera: W-178, W-179, W-312, W-340, W-341, W-360, W-361, W-366, W-406, W-415, W-417, W-425, W-430
- class review×fail-open-on-malformed-records-patched-per-site seen in 9 opera: W-275, W-326, W-337, W-338, W-348, W-403, W-404, W-430, W-444
- class security×symlink-parent-write-escape seen in 6 opera: W-259, W-274, W-418, W-423, W-430, W-461
- class spec×fix-opens-new-surface seen in 3 opera: W-310, W-322, W-362
- class spec×input-domain-missing-or-unenforceable seen in 28 opera: W-179, W-274, W-292, W-299, W-305, W-306, W-310, W-312, W-316, W-334, W-337, W-338, W-339, W-340, W-348, W-358, W-362, W-369, W-370, W-376, W-377, W-381, W-403, W-409, W-430, W-433, W-445, W-461
- class spec×input-without-named-rejector seen in 5 opera: W-288, W-310, W-328, W-416, W-418
- class spec×promise-unattainable-under-accepted-domain seen in 22 opera: W-241, W-264, W-268, W-274, W-293, W-299, W-302, W-310, W-312, W-326, W-339, W-341, W-348, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425, W-462
- class spec×prose-contradiction-under-revision seen in 2 opera: W-241, W-274
- class tests×one-sided-bound-assertion seen in 10 opera: W-310, W-317, W-328, W-330, W-345, W-360, W-369, W-377, W-381, W-392
- class tests×ruled-case-uncovered seen in 15 opera: W-178, W-292, W-322, W-335, W-336, W-337, W-350, W-376, W-404, W-415, W-444, W-450, W-454, W-463, W-474
- class tests×security-boundary-cases-uncovered seen in 3 opera: W-310, W-369, W-379
- class tests×tests-that-agree-with-the-bug seen in 2 opera: W-407, W-409
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-339, W-340


### 2026-10-31

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-382 | 297 | 0 |  |
| W-468 | 1543 | 7 | S1 7 |
| W-472 | 1308 | 1 | S1 1 |
| W-473 | 472 | 1 | S1 1 |
| W-474 | 869 | 2 | S1 4 |
| W-477 | 305 | 3 | S1 4 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-382 | review | 1 | passed | - |  |
| W-382 | spec | 1 | passed | - |  |
| W-382 | spec | 2 | passed | 5 |  |
| W-382 | spec | 3 | passed | 118 |  |
| W-382 | spec | 4 | passed | 2 |  |
| W-410 | review | 1 | passed | - |  |
| W-410 | spec | 1 | passed | - |  |
| W-410 | spec | 2 | passed | 3 |  |
| W-410 | spec | 3 | passed | 3 | untagged untagged, untagged untagged, untagged untagged |
| W-410 | spec | 4 | passed | 130 |  |
| W-410 | spec | 5 | passed | 3 |  |
| W-410 | spec | 6 | passed | 5 |  |
| W-410 | spec | 7 | passed | 27 |  |
| W-410 | spec | 8 | passed | 1 |  |
| W-410 | spec | 9 | passed | 2 |  |
| W-410 | spec | 10 | passed | 107 |  |
| W-410 | spec | 11 | passed | 5 |  |
| W-410 | spec | 12 | passed | 3 |  |
| W-459 | review | 1 | failed | - | review×shared-log-grammar-rejects-valid-records S1 |
| W-459 | review | 2 | passed | 161 |  |
| W-459 | spec | 1 | passed | - |  |
| W-459 | spec | 2 | failed | 108 | spec×promise-unattainable-under-accepted-domain S1, spec×input-domain-missing-or-unenforceable S1 |
| W-459 | spec | 3 | passed | 18 |  |
| W-459 | spec | 4 | passed | 1 |  |
| W-468 | review | 4 | passed | 1005 |  |
| W-468 | spec | 9 | failed | 617 | review×fail-open-on-malformed-records-patched-per-site S1 |
| W-472 | review | 2 | passed | 651 |  |
| W-473 | review | 1 | passed | - |  |
| W-473 | spec | 1 | passed | - |  |
| W-473 | spec | 2 | failed | 3 | tests×assertion-satisfied-by-the-wrong-cause S1 |
| W-473 | spec | 3 | passed | 4 |  |
| W-473 | spec | 4 | passed | 2 |  |
| W-473 | spec | 5 | passed | 236 |  |
| W-473 | spec | 6 | passed | 7 |  |
| W-477 | review | 1 | failed | - | mechanism×replay-environment-not-pristine S1 |
| W-477 | review | 2 | failed | 41 | mechanism×replay-environment-not-pristine S1, review×evidence-backfilled-or-absent S1 |
| W-477 | review | 3 | passed | 146 |  |
| W-477 | spec | 1 | passed | - |  |
| W-477 | spec | 2 | passed | 4 |  |
| W-477 | spec | 3 | passed | 135 |  |
| W-477 | spec | 4 | failed | 7 | mechanism×replay-environment-not-pristine S1 |
| W-477 | spec | 5 | passed | 7 |  |
| W-477 | spec | 6 | passed | 3 |  |
| W-477 | spec | 7 | passed | 23 |  |
| W-477 | spec | 8 | passed | 2 |  |

- LOOP W-477 review: class mechanism×replay-environment-not-pristine, rounds 1-2 (minutes since previous round: r1 -, r2 41)

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| W-477 | ci/W-477-tests-2b4071d9.log | gate×W-163 | W-163-b6 |

Classes in more than one opus, 2026-10-18..2026-10-31:
- class gate×tests seen in 2 opera: W-340, W-407
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 3 opera: W-360, W-462, W-477
- class review×evidence-backfilled-or-absent seen in 14 opera: W-178, W-179, W-312, W-340, W-341, W-360, W-361, W-366, W-406, W-415, W-417, W-425, W-430, W-477
- class review×fail-open-on-malformed-records-patched-per-site seen in 10 opera: W-275, W-326, W-337, W-338, W-348, W-403, W-404, W-430, W-444, W-468
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec×fix-opens-new-surface seen in 3 opera: W-310, W-322, W-362
- class spec×input-domain-missing-or-unenforceable seen in 25 opera: W-179, W-299, W-305, W-310, W-316, W-334, W-337, W-338, W-339, W-340, W-348, W-358, W-362, W-369, W-370, W-376, W-377, W-381, W-403, W-409, W-430, W-433, W-445, W-459, W-461
- class spec×input-without-named-rejector seen in 5 opera: W-288, W-310, W-328, W-416, W-418
- class spec×promise-unattainable-under-accepted-domain seen in 20 opera: W-241, W-268, W-299, W-310, W-326, W-339, W-341, W-348, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425, W-459, W-462, W-468, W-472
- class tests×one-sided-bound-assertion seen in 10 opera: W-310, W-317, W-328, W-330, W-345, W-360, W-369, W-377, W-381, W-392
- class tests×ruled-case-uncovered seen in 14 opera: W-178, W-322, W-335, W-336, W-337, W-350, W-376, W-404, W-415, W-444, W-450, W-454, W-463, W-474
- class tests×security-boundary-cases-uncovered seen in 3 opera: W-310, W-369, W-379
- class tests×tests-that-agree-with-the-bug seen in 2 opera: W-407, W-409
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-339, W-340

#### Owed cause fixes

- OWED class gate×tests (W-340, W-407): no lesson of it names a greenlit cause-fix opus in addressed_by

### 2026-11-01

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-410 | 981 | 0 |  |
| W-411 | 603 | 0 |  |
| W-452 | 511 | 2 | S1 3 |
| W-459 | 799 | 2 | S1 3 |
| W-463 | 2727 | 1 | S2 1 |
| W-483 | 90 | 0 |  |
| W-489 | 314 | 5 | S1 5 |
| W-491 | 64 | 0 |  |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-411 | review | 1 | passed | - |  |
| W-411 | spec | 1 | passed | - |  |
| W-411 | spec | 2 | passed | 3 |  |
| W-411 | spec | 3 | passed | 102 | untagged untagged, untagged untagged, untagged untagged |
| W-411 | spec | 4 | passed | 18 |  |
| W-411 | spec | 5 | passed | 4 |  |
| W-411 | spec | 6 | passed | 4 | untagged untagged |
| W-411 | spec | 7 | passed | 21 |  |
| W-411 | spec | 8 | passed | 2 |  |
| W-411 | spec | 9 | passed | 11 |  |
| W-452 | review | 1 | failed | - | review×grandfathering-bypassed-on-resume S1 |
| W-452 | review | 2 | passed | 310 |  |
| W-452 | spec | 1 | passed | - |  |
| W-452 | spec | 2 | failed | 5 | spec×input-domain-missing-or-unenforceable S1, spec×promise-unattainable-under-accepted-domain S1 |
| W-452 | spec | 3 | passed | 32 |  |
| W-452 | spec | 4 | passed | 4 |  |
| W-483 | review | 1 | passed | - |  |
| W-483 | spec | 1 | passed | - |  |
| W-483 | spec | 2 | passed | 4 |  |
| W-487 | review | 1 | failed | - | tests×tests-that-agree-with-the-bug S1, tests×one-sided-bound-assertion S1, tests×one-sided-bound-assertion S1 |
| W-487 | review | 2 | failed | 249 | workflow×files-owned-boundary-exceeded S1 |
| W-487 | review | 3 | passed | 98 |  |
| W-487 | spec | 1 | passed | - |  |
| W-487 | spec | 2 | passed | 102 |  |
| W-487 | spec | 3 | passed | 4 | untagged untagged, untagged untagged, untagged untagged |
| W-487 | spec | 4 | passed | 21 |  |
| W-487 | spec | 5 | passed | 3 |  |
| W-487 | spec | 6 | passed | 8 | untagged untagged |
| W-487 | spec | 7 | passed | 7 |  |
| W-487 | spec | 8 | passed | 2 |  |
| W-487 | spec | 9 | passed | 4 |  |
| W-487 | spec | 10 | passed | 14 |  |
| W-487 | spec | 11 | passed | 8 |  |
| W-487 | spec | 12 | passed | 2 |  |
| W-487 | spec | 13 | passed | 394 |  |
| W-487 | spec | 14 | passed | 1 |  |
| W-487 | spec | 15 | passed | 2 |  |
| W-489 | review | 1 | failed | - | spec×promise-unattainable-under-accepted-domain S1 |
| W-489 | review | 2 | failed | 28 | spec×promise-unattainable-under-accepted-domain S1 |
| W-489 | review | 3 | failed | 72 | spec×promise-unattainable-under-accepted-domain S1 |
| W-489 | review | 4 | passed | 37 |  |
| W-489 | spec | 1 | passed | - |  |
| W-489 | spec | 2 | failed | 7 | spec×input-without-named-rejector S1 |
| W-489 | spec | 3 | passed | 169 |  |
| W-489 | spec | 4 | failed | 3 | spec×input-without-named-rejector S1 |
| W-489 | spec | 5 | passed | 66 |  |
| W-491 | review | 1 | passed | - |  |
| W-491 | spec | 1 | passed | - |  |
| W-491 | spec | 2 | passed | 4 |  |
| W-492 | review | 1 | failed | - | review×shared-log-grammar-rejects-valid-records S1 |
| W-492 | review | 2 | passed | 93 |  |
| W-492 | spec | 1 | passed | - |  |
| W-492 | spec | 2 | passed | 3 |  |
| W-494 | review | 1 | passed | - |  |
| W-494 | spec | 1 | passed | - |  |
| W-494 | spec | 2 | passed | 1 |  |
| W-494 | spec | 3 | passed | 3 |  |
| W-494 | spec | 4 | passed | 64 |  |
| W-494 | spec | 5 | passed | 3 |  |
| W-494 | spec | 6 | passed | 52 |  |
| W-494 | spec | 7 | failed | 4 | spec×promise-unattainable-under-accepted-domain untagged |
| W-494 | spec | 8 | passed | 4 |  |
| W-494 | spec | 9 | passed | 1 |  |

- LOOP W-489 review: class spec×promise-unattainable-under-accepted-domain, rounds 1-2 (minutes since previous round: r1 -, r2 28)
- LOOP W-489 review: any class, rounds 1-3 (minutes since previous round: r1 -, r2 28, r3 72)

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| W-463 | ci/W-463-tests-38970776.log | gate×W-339 | W-339-b1 |

Classes in more than one opus, 2026-10-19..2026-11-01:
- class gate×tests seen in 2 opera: W-340, W-407
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 3 opera: W-360, W-462, W-477
- class review×evidence-backfilled-or-absent seen in 12 opera: W-179, W-340, W-341, W-360, W-361, W-366, W-406, W-415, W-417, W-425, W-430, W-477
- class review×fail-open-on-malformed-records-patched-per-site seen in 10 opera: W-275, W-326, W-337, W-338, W-348, W-403, W-404, W-430, W-444, W-468
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec×fix-opens-new-surface seen in 3 opera: W-310, W-322, W-362
- class spec×input-domain-missing-or-unenforceable seen in 25 opera: W-179, W-299, W-305, W-310, W-334, W-337, W-338, W-339, W-340, W-348, W-358, W-362, W-369, W-370, W-376, W-377, W-381, W-403, W-409, W-430, W-433, W-445, W-452, W-459, W-461
- class spec×input-without-named-rejector seen in 6 opera: W-288, W-310, W-328, W-416, W-418, W-489
- class spec×promise-unattainable-under-accepted-domain seen in 23 opera: W-241, W-268, W-299, W-310, W-326, W-339, W-341, W-348, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494
- class tests×one-sided-bound-assertion seen in 11 opera: W-310, W-317, W-328, W-330, W-345, W-360, W-369, W-377, W-381, W-392, W-487
- class tests×ruled-case-uncovered seen in 14 opera: W-178, W-322, W-335, W-336, W-337, W-350, W-376, W-404, W-415, W-444, W-450, W-454, W-463, W-474
- class tests×security-boundary-cases-uncovered seen in 3 opera: W-310, W-369, W-379
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487
- class workflow×files-owned-boundary-exceeded seen in 3 opera: W-339, W-340, W-487

#### Owed cause fixes

- OWED class gate×tests (W-340, W-407): no lesson of it names a greenlit cause-fix opus in addressed_by

### 2026-11-02

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-412 | 455 | 1 | S1 1 |
| W-487 | 1430 | 2 | S1 4 |
| W-492 | 737 | 1 | S1 1 |
| W-493 | 541 | 0 |  |
| W-494 | 706 | 1 | untagged 1 |
| W-495 | 615 | 4 | S1 5 |
| W-497 | 114 | 0 |  |
| W-498 | 364 | 3 | S1 3 |
| W-501 | 618 | 2 | S1 2 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-412 | review | 1 | passed | - |  |
| W-412 | spec | 1 | passed | - |  |
| W-412 | spec | 2 | failed | 4 | ui×reader-disagreement S1 |
| W-412 | spec | 3 | passed | 12 |  |
| W-412 | spec | 4 | passed | 2 |  |
| W-412 | spec | 5 | passed | 3 | untagged untagged |
| W-412 | spec | 6 | passed | 5 |  |
| W-412 | spec | 7 | passed | 2 |  |
| W-412 | spec | 8 | passed | 2 |  |
| W-412 | spec | 9 | passed | 114 |  |
| W-412 | spec | 10 | passed | 2 |  |
| W-412 | spec | 11 | passed | 4 |  |
| W-412 | spec | 12 | passed | 33 |  |
| W-412 | spec | 13 | passed | 2 |  |
| W-412 | spec | 14 | passed | 2 |  |
| W-493 | review | 1 | passed | - |  |
| W-493 | spec | 1 | passed | - |  |
| W-493 | spec | 2 | passed | 4 |  |
| W-493 | spec | 3 | passed | 5 |  |
| W-493 | spec | 4 | passed | 10 |  |
| W-493 | spec | 5 | passed | 2 |  |
| W-493 | spec | 6 | passed | 221 |  |
| W-495 | review | 1 | failed | - | tests×ruled-case-uncovered S1 |
| W-495 | review | 2 | failed | 35 | review×evidence-backfilled-or-absent S1 |
| W-495 | review | 3 | passed | 46 |  |
| W-495 | spec | 1 | passed | - |  |
| W-495 | spec | 2 | failed | 7 | spec×promise-unattainable-under-accepted-domain S1, spec×promise-unattainable-under-accepted-domain S1 |
| W-495 | spec | 3 | passed | 18 |  |
| W-495 | spec | 4 | passed | 226 |  |
| W-495 | spec | 5 | failed | 3 | spec×input-without-named-rejector S1 |
| W-495 | spec | 6 | passed | 220 |  |
| W-497 | review | 1 | passed | - |  |
| W-497 | spec | 1 | passed | - |  |
| W-497 | spec | 2 | passed | 5 |  |
| W-498 | review | 1 | failed | - | mechanism×identity-normalization-not-centralized S1 |
| W-498 | review | 2 | failed | 185 | mechanism×identity-normalization-not-centralized S1 |
| W-498 | review | 3 | passed | 75 |  |
| W-498 | spec | 1 | passed | - |  |
| W-498 | spec | 2 | failed | 6 | spec×promise-unattainable-under-accepted-domain S1 |
| W-498 | spec | 3 | passed | 26 |  |
| W-498 | spec | 4 | passed | 10 |  |
| W-498 | spec | 5 | passed | 214 |  |
| W-498 | spec | 6 | passed | 10 |  |
| W-501 | review | 1 | failed | - | tests×security-boundary-cases-uncovered S1 |
| W-501 | review | 2 | passed | 38 |  |
| W-501 | spec | 1 | passed | - |  |
| W-501 | spec | 2 | failed | 84 | spec×promise-unattainable-under-accepted-domain S1 |
| W-501 | spec | 3 | passed | 26 |  |
| W-501 | spec | 4 | passed | 2 |  |

- LOOP W-498 review: class mechanism×identity-normalization-not-centralized, rounds 1-2 (minutes since previous round: r1 -, r2 185)

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| W-487 | ci/W-487-tests-3263b289.log | gate×W-339 | W-339-b1 |
| W-494 | ci/W-494-tests-bebca299.log | gate×tests |  |

Classes in more than one opus, 2026-10-20..2026-11-02:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 3 opera: W-340, W-407, W-494
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 3 opera: W-360, W-462, W-477
- class review×evidence-backfilled-or-absent seen in 12 opera: W-340, W-341, W-360, W-361, W-366, W-406, W-415, W-417, W-425, W-430, W-477, W-495
- class review×fail-open-on-malformed-records-patched-per-site seen in 10 opera: W-275, W-326, W-337, W-338, W-348, W-403, W-404, W-430, W-444, W-468
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec×fix-opens-new-surface seen in 2 opera: W-310, W-362
- class spec×input-domain-missing-or-unenforceable seen in 24 opera: W-299, W-305, W-310, W-334, W-337, W-338, W-339, W-340, W-348, W-358, W-362, W-369, W-370, W-376, W-377, W-381, W-403, W-409, W-430, W-433, W-445, W-452, W-459, W-461
- class spec×input-without-named-rejector seen in 7 opera: W-288, W-310, W-328, W-416, W-418, W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 26 opera: W-241, W-268, W-299, W-310, W-326, W-339, W-341, W-348, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501
- class tests×one-sided-bound-assertion seen in 11 opera: W-310, W-317, W-328, W-330, W-345, W-360, W-369, W-377, W-381, W-392, W-487
- class tests×ruled-case-uncovered seen in 13 opera: W-335, W-336, W-337, W-350, W-376, W-404, W-415, W-444, W-450, W-454, W-463, W-474, W-495
- class tests×security-boundary-cases-uncovered seen in 4 opera: W-310, W-369, W-379, W-501
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487
- class workflow×files-owned-boundary-exceeded seen in 3 opera: W-339, W-340, W-487

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-340, W-407, W-494): no lesson of it names a greenlit cause-fix opus in addressed_by

### 2026-11-03

| Opus | Cycle min | PR wait min | Failed rounds | Blockers by severity |
|---|---|---|---|---|
| W-333 | 167 | 30 | 1 | S1 1 |
| W-490 | 347 | None | 0 |  |
| W-496 | 562 | 49 | 1 | S1 3 |
| W-499 | 1530 | 71 | 0 |  |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-333 | review | 1 | passed | - |  |
| W-333 | spec | 1 | passed | - |  |
| W-333 | spec | 2 | failed | 7 | spec×promise-unattainable-under-accepted-domain S1 |
| W-333 | spec | 3 | passed | 8 |  |
| W-333 | spec | 4 | passed | 4 |  |
| W-490 | review | 1 | passed | - |  |
| W-490 | review | 2 | passed | 25 |  |
| W-490 | spec | 1 | passed | - |  |
| W-490 | spec | 2 | passed | 5 |  |
| W-496 | review | 1 | failed | - | tests×ruled-case-uncovered S1, tests×ruled-case-uncovered S1, tests×ruled-case-uncovered S1 |
| W-496 | review | 2 | passed | 52 |  |
| W-499 | review | 1 | passed | - |  |
| W-499 | review | 2 | passed | 366 |  |
| W-499 | review | 3 | passed | 39 |  |
| W-499 | spec | 16 | passed | 239 |  |
| W-499 | spec | 17 | passed | 5 |  |
| W-499 | spec | 18 | passed | 4 |  |

- no loop

Classes in more than one opus, 2026-10-20..2026-11-03:
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 3 opera: W-360, W-462, W-477
- class review×evidence-backfilled-or-absent seen in 12 opera: W-340, W-341, W-360, W-361, W-366, W-406, W-415, W-417, W-425, W-430, W-477, W-495
- class review×fail-open-on-malformed-records-patched-per-site seen in 10 opera: W-275, W-326, W-337, W-338, W-348, W-403, W-404, W-430, W-444, W-468
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec×fix-opens-new-surface seen in 2 opera: W-310, W-362
- class spec×input-domain-missing-or-unenforceable seen in 24 opera: W-299, W-305, W-310, W-334, W-337, W-338, W-339, W-340, W-348, W-358, W-362, W-369, W-370, W-376, W-377, W-381, W-403, W-409, W-430, W-433, W-445, W-452, W-459, W-461
- class spec×input-without-named-rejector seen in 7 opera: W-288, W-310, W-328, W-416, W-418, W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 27 opera: W-241, W-268, W-299, W-310, W-326, W-333, W-339, W-341, W-348, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501
- class tests×one-sided-bound-assertion seen in 11 opera: W-310, W-317, W-328, W-330, W-345, W-360, W-369, W-377, W-381, W-392, W-487
- class tests×ruled-case-uncovered seen in 14 opera: W-335, W-336, W-337, W-350, W-376, W-404, W-415, W-444, W-450, W-454, W-463, W-474, W-495, W-496
- class tests×security-boundary-cases-uncovered seen in 4 opera: W-310, W-369, W-379, W-501
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487
- class workflow×files-owned-boundary-exceeded seen in 3 opera: W-339, W-340, W-487

### 2026-11-04

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-364 | 1152 | 2 | S1 2 |
| W-413 | 2733 | 2 | S1 4 |
| W-502 | 611 | 3 | S1 3 |
| W-505 | 370 | 0 |  |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-364 | review | 3 | passed | 521 |  |
| W-364 | review | 4 | passed | 69 |  |
| W-364 | spec | 6 | passed | 602 |  |
| W-364 | spec | 7 | passed | 12 |  |
| W-413 | review | 2 | failed | 1105 | tests×behaviour-selector-mismatches-declared-behaviour S1, review×date-parser-normalizes-impossible-record-date S1, review×evidence-backfilled-or-absent S1 |
| W-413 | review | 3 | passed | 269 |  |
| W-502 | review | 1 | failed | - | review×evidence-backfilled-or-absent S1 |
| W-502 | review | 2 | failed | 170 | spec-gate×self-signed S1 |
| W-502 | review | 3 | passed | 95 |  |
| W-502 | spec | 1 | passed | - |  |
| W-502 | spec | 2 | passed | 84 |  |
| W-502 | spec | 3 | passed | 66 |  |
| W-502 | spec | 4 | passed | 2 |  |
| W-502 | spec | 5 | passed | 109 |  |
| W-502 | spec | 6 | failed | 4 | review×evidence-backfilled-or-absent S1 |
| W-502 | spec | 7 | passed | 129 |  |
| W-502 | spec | 8 | passed | 2 |  |
| W-505 | review | 1 | passed | - |  |
| W-505 | review | 2 | passed | 205 |  |
| W-505 | spec | 1 | passed | - |  |
| W-505 | spec | 2 | passed | 7 |  |

- no loop

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| W-364 | ci/W-364-tests-5c5cc4c3.log | gate×tests |  |
| W-502 | ci/W-502-tests-99961433.log | gate×tests |  |

Classes in more than one opus, 2026-10-22..2026-11-04:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 5 opera: W-340, W-364, W-407, W-494, W-502
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 3 opera: W-360, W-462, W-477
- class review×evidence-backfilled-or-absent seen in 13 opera: W-341, W-360, W-361, W-366, W-406, W-413, W-415, W-417, W-425, W-430, W-477, W-495, W-502
- class review×fail-open-on-malformed-records-patched-per-site seen in 5 opera: W-403, W-404, W-430, W-444, W-468
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec-gate×self-signed seen in 2 opera: W-442, W-502
- class spec×fix-opens-new-surface seen in 2 opera: W-310, W-362
- class spec×input-domain-missing-or-unenforceable seen in 17 opera: W-305, W-310, W-358, W-362, W-369, W-370, W-376, W-377, W-381, W-403, W-409, W-430, W-433, W-445, W-452, W-459, W-461
- class spec×input-without-named-rejector seen in 6 opera: W-310, W-328, W-416, W-418, W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 21 opera: W-310, W-333, W-341, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501
- class tests×one-sided-bound-assertion seen in 9 opera: W-310, W-328, W-345, W-360, W-369, W-377, W-381, W-392, W-487
- class tests×ruled-case-uncovered seen in 11 opera: W-364, W-376, W-404, W-415, W-444, W-450, W-454, W-463, W-474, W-495, W-496
- class tests×security-boundary-cases-uncovered seen in 4 opera: W-310, W-369, W-379, W-501
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-340, W-364, W-407, W-494, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class mechanism×replay-environment-not-pristine (W-360, W-462, W-477): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class spec-gate×self-signed (W-442, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class tests×one-sided-bound-assertion (W-310, W-328, W-345, W-360, W-369, W-377, W-381, W-392, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by

### 2026-11-05

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-298 | 1004 | 3 | S1 6 |
| W-300 | 1123 | 3 | S1 3 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-298 | review | 1 | failed | - | security×terminal-control-injection S1 |
| W-298 | review | 2 | passed | 152 |  |
| W-298 | review | 3 | passed | 163 |  |
| W-298 | spec | 6 | passed | 415 |  |
| W-300 | review | 2 | failed | 569 | review×evidence-backfilled-or-absent S1 |
| W-300 | review | 3 | failed | 461 | review×evidence-backfilled-or-absent S1 |
| W-300 | review | 4 | passed | 13 |  |
| W-300 | spec | 3 | passed | 444 |  |
| W-300 | spec | 4 | passed | 5 |  |
| W-300 | spec | 5 | passed | 152 |  |
| W-300 | spec | 6 | passed | 3 |  |
| W-300 | spec | 7 | passed | 23 |  |
| W-300 | spec | 8 | failed | 4 | review×evidence-backfilled-or-absent S1 |
| W-300 | spec | 9 | passed | 1 |  |
| W-300 | spec | 10 | passed | 2 |  |
| W-300 | spec | 11 | passed | 275 |  |
| W-300 | spec | 12 | passed | 25 |  |
| W-300 | spec | 13 | passed | 129 |  |
| W-300 | spec | 14 | passed | 1 |  |
| W-300 | spec | 15 | passed | 2 |  |

- no loop

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| none | | | |

Classes in more than one opus, 2026-10-23..2026-11-05:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 4 opera: W-364, W-407, W-494, W-502
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 3 opera: W-360, W-462, W-477
- class review×evidence-backfilled-or-absent seen in 12 opera: W-300, W-360, W-366, W-406, W-413, W-415, W-417, W-425, W-430, W-477, W-495, W-502
- class review×fail-open-on-malformed-records-patched-per-site seen in 5 opera: W-403, W-404, W-430, W-444, W-468
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec-gate×self-signed seen in 2 opera: W-442, W-502
- class spec×fix-opens-new-surface seen in 2 opera: W-298, W-362
- class spec×input-domain-missing-or-unenforceable seen in 14 opera: W-298, W-369, W-370, W-376, W-377, W-381, W-403, W-409, W-430, W-433, W-445, W-452, W-459, W-461
- class spec×input-without-named-rejector seen in 5 opera: W-328, W-416, W-418, W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 20 opera: W-298, W-333, W-355, W-369, W-377, W-379, W-398, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501
- class tests×assertion-satisfied-by-the-wrong-cause seen in 2 opera: W-298, W-473
- class tests×one-sided-bound-assertion seen in 8 opera: W-328, W-345, W-360, W-369, W-377, W-381, W-392, W-487
- class tests×ruled-case-uncovered seen in 11 opera: W-364, W-376, W-404, W-415, W-444, W-450, W-454, W-463, W-474, W-495, W-496
- class tests×security-boundary-cases-uncovered seen in 3 opera: W-369, W-379, W-501
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-364, W-407, W-494, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class mechanism×replay-environment-not-pristine (W-360, W-462, W-477): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class spec-gate×self-signed (W-442, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class tests×one-sided-bound-assertion (W-328, W-345, W-360, W-369, W-377, W-381, W-392, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by

### 2026-11-06

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-508 | 1029 | 1 | S1 1 |
| W-509 | 662 | 4 | S1 4 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-508 | review | 2 | passed | 770 |  |
| W-508 | spec | 5 | passed | 920 |  |
| W-508 | spec | 6 | passed | 4 |  |
| W-509 | review | 1 | failed | - | review×write-failure-contract-incomplete S1 |
| W-509 | review | 2 | failed | 79 | review×write-failure-contract-incomplete S1 |
| W-509 | review | 3 | passed | 132 |  |
| W-509 | review | 4 | passed | 56 |  |
| W-509 | review | 5 | passed | 82 |  |
| W-509 | spec | 1 | passed | - |  |
| W-509 | spec | 2 | failed | 7 | spec×promise-unattainable-under-accepted-domain S1 |
| W-509 | spec | 3 | passed | 383 |  |
| W-509 | spec | 4 | failed | 36 | spec×promise-unattainable-under-accepted-domain S1 |
| W-509 | spec | 5 | passed | 161 |  |
| W-523 | spec | 1 | passed | - |  |
| W-523 | spec | 2 | passed | 463 |  |

- LOOP W-509 review: class review×write-failure-contract-incomplete, rounds 1-2 (minutes since previous round: r1 -, r2 79)

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| W-509 | ci/W-509-tests-28f68727.log | gate×tests |  |

Classes in more than one opus, 2026-10-24..2026-11-06:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 5 opera: W-364, W-407, W-494, W-502, W-509
- class interface×validation-order-masks-errors seen in 2 opera: W-379, W-474
- class mechanism×replay-environment-not-pristine seen in 2 opera: W-462, W-477
- class review×evidence-backfilled-or-absent seen in 10 opera: W-300, W-406, W-413, W-415, W-417, W-425, W-430, W-477, W-495, W-502
- class review×fail-open-on-malformed-records-patched-per-site seen in 5 opera: W-403, W-404, W-430, W-444, W-468
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec-gate×self-signed seen in 2 opera: W-442, W-502
- class spec×input-domain-missing-or-unenforceable seen in 10 opera: W-298, W-370, W-403, W-409, W-430, W-433, W-445, W-452, W-459, W-461
- class spec×input-without-named-rejector seen in 4 opera: W-416, W-418, W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 19 opera: W-298, W-333, W-355, W-379, W-398, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501, W-509
- class tests×assertion-satisfied-by-the-wrong-cause seen in 2 opera: W-298, W-473
- class tests×one-sided-bound-assertion seen in 4 opera: W-345, W-381, W-392, W-487
- class tests×ruled-case-uncovered seen in 10 opera: W-364, W-404, W-415, W-444, W-450, W-454, W-463, W-474, W-495, W-496
- class tests×security-boundary-cases-uncovered seen in 2 opera: W-379, W-501
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-487, W-508

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-364, W-407, W-494, W-502, W-509): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class mechanism×replay-environment-not-pristine (W-462, W-477): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class spec-gate×self-signed (W-442, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class tests×one-sided-bound-assertion (W-345, W-381, W-392, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by

### 2026-11-07

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-456 | - | 0 |  |
| W-523 | 539 | 0 |  |
| W-525 | 353 | 4 | S1 9 |
| W-526 | 67 | 0 |  |
| W-527 | - | 0 |  |
| W-530 | 181 | 1 | S1 1 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-523 | review | 1 | passed | - |  |
| W-525 | review | 1 | failed | - | tests×ruled-case-uncovered S1, review×fail-open-on-malformed-records-patched-per-site S1 |
| W-525 | review | 2 | failed | 57 | tests×ruled-case-uncovered S1 |
| W-525 | review | 3 | passed | 62 |  |
| W-525 | spec | 1 | passed | - |  |
| W-525 | spec | 2 | failed | 9 | spec×input-domain-missing-or-unenforceable S1, spec×input-domain-missing-or-unenforceable S1, spec×input-domain-missing-or-unenforceable S1, spec×promise-unattainable-under-accepted-domain S1, spec×promise-unattainable-under-accepted-domain S1 |
| W-525 | spec | 3 | passed | 135 |  |
| W-525 | spec | 4 | passed | 6 |  |
| W-525 | spec | 5 | passed | 104 |  |
| W-525 | spec | 6 | failed | 4 | tests×ruled-case-uncovered S1 |
| W-526 | review | 1 | passed | - |  |
| W-526 | spec | 1 | passed | - |  |
| W-526 | spec | 2 | passed | 7 |  |
| W-528 | review | 1 | passed | - |  |
| W-528 | spec | 1 | passed | - |  |
| W-528 | spec | 2 | passed | 4 |  |
| W-530 | review | 1 | passed | - |  |
| W-530 | spec | 1 | passed | - |  |
| W-530 | spec | 2 | failed | 8 | spec×input-domain-missing-or-unenforceable S1 |
| W-530 | spec | 3 | passed | 34 |  |
| W-530 | spec | 4 | passed | 4 |  |

- LOOP W-525 review: class tests×ruled-case-uncovered, rounds 1-2 (minutes since previous round: r1 -, r2 57)

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| none | | | |

Classes in more than one opus, 2026-10-25..2026-11-07:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 5 opera: W-364, W-407, W-494, W-502, W-509
- class mechanism×replay-environment-not-pristine seen in 2 opera: W-462, W-477
- class review×evidence-backfilled-or-absent seen in 10 opera: W-300, W-406, W-413, W-415, W-417, W-425, W-430, W-477, W-495, W-502
- class review×fail-open-on-malformed-records-patched-per-site seen in 5 opera: W-403, W-430, W-444, W-468, W-525
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-418, W-423, W-430, W-461
- class spec-gate×self-signed seen in 2 opera: W-442, W-502
- class spec×input-domain-missing-or-unenforceable seen in 11 opera: W-298, W-403, W-409, W-430, W-433, W-445, W-452, W-459, W-461, W-525, W-530
- class spec×input-without-named-rejector seen in 4 opera: W-416, W-418, W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 17 opera: W-298, W-333, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501, W-509, W-525
- class tests×assertion-satisfied-by-the-wrong-cause seen in 2 opera: W-298, W-473
- class tests×ruled-case-uncovered seen in 10 opera: W-364, W-415, W-444, W-450, W-454, W-463, W-474, W-495, W-496, W-525
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-487, W-508

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-364, W-407, W-494, W-502, W-509): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class mechanism×replay-environment-not-pristine (W-462, W-477): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class spec-gate×self-signed (W-442, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by

#### Proposed improvements

- Owed spec-gate×self-signed (W-442, W-502): stamp `addressed_by: W-506` on a lesson of the class, so OWED reads the greenlit cause fix that exists (W-506 "high: cause fix, spec-gate×self-signed", greenlit, Queue after W-507); W-506 starts after the freeze (D-178). Evidence: Owed cause fixes above, improvements.md:888, retro-process-1107/answers.md Q4. Owner: design lead.
- Owed mechanism×replay-environment-not-pristine (W-462, W-477): covered by W-464 (greenlit, Queue); stamp `addressed_by: W-464` on a lesson of the class so OWED stops naming it; leads 11-07 found little left of it since D-174 item 5. Evidence: Owed cause fixes above, opera/W-464.md title. Owner: ops-lead.
- Owed gate×tests (W-364, W-407, W-494, W-502, W-509) and gate×W-339 (W-463, W-487): retro classifies a gate failure by the gate script, a bucket and not a cause (all four leads, answers.md Q4), and W-509's row names no failing row (ci/W-509-tests-28f68727.log, improvements.md:861); file a cause-fix opus: `retro --daily` names a gate failure by its failing row's opus and class (FAILING_ROW, packages/cli/src/retro.ts:1187) and leaves an unrowed gate failure out of OWED with a stated line. Owner: eng-lead.
- OWED passes a recurring class whose fix is old: `causeFixes` (packages/cli/src/retro.ts:1352-1370) counts any lesson whose `addressed_by` opus is greenlit or later, so spec×promise-unattainable-under-accepted-domain (17 opera, W-525 spec r2 S1 x2 today) is never owed though W-167/W-196/W-255 are done; file a cause-fix opus: a class recurring after its named fix reached done is owed again (as W-392 did for one-sided-bound by hand). Evidence: answers.md Q4 last line, the W-525 spec row above. Owner: eng-lead.
- spec×promise-unattainable-under-accepted-domain and spec×input-domain-missing-or-unenforceable (W-525 spec r2: 5 S1; W-530 spec r2: 1 S1; W-523 review-1 advisory 2; W-530 spec-4 advisory 1): covered by W-393 (greenlit, folds W-395 and W-394); no new opus. Owner: design lead.
- tests×ruled-case-uncovered (W-525 review LOOP r1-r2, spec r6): covered by W-414 (greenlit, Queue). review×fail-open-on-malformed-records-patched-per-site (W-525 review r1): covered by W-185 (greenlit, Queue). Owner: eng-lead.
- tests×one-sided-bound-assertion (owed 11-06, improvements.md:889): none, because it has left the 14-day window (absent from today's class list) and W-392 (done) is its cause fix; if it returns, stamp `addressed_by: W-392` or file a new fix. Owner: eng-lead.
- W-523 build review advisories 1 and 3 (ci/W-523-review-1.log:14,16, S2): `land` ignores `notice.ok` and arms the queue before the Patron is asked (packages/cli/src/land.ts:110), and a nonzero `gh pr merge` that armed remotely reports `queue: not armed` (packages/cli/src/integrate.ts:1025); not filed (no opus names them); file a fix opus with the two cases the log names as reds. Owner: eng-lead.
- `land` holds when `gh pr checks` runs before any check is reported (#1074; a rerun passed; current-state-until-1107c.md:8): no filed opus covers it (W-386, W-390 are other cases); file a fix opus: no reported check reads as pending and is polled under a bound, never a hold. Owner: eng-lead.
- `bisellium run ... -- ci` exits 0 when ci fails (current-state-until-1107e.md:13): no opus covers it; file a fix opus: `run` exits with its command's status, red first. Owner: eng-lead.
- Producer briefs omit a step `next` or the lex names, a class seen twice (11-07: `next` from a worktree, `--chain` with `--expect`; 11-08: architect for an ops opus, ~170k lost; `next` without `--budget`; ladder brief without `npm ci`, the tsx partial install; a cleanup that deleted cited logs; current-state.md:21, current-state-until-1107e.md:22, -1107d.md): add a kept prompt template studio/prompts/ladder-brief.md (`next` from main only, `--budget 400000` on every `next`, the seat from `next`'s `sella:` line, `npm ci --cache` in a new worktree before gates, never delete a cited log, `--expect` without `--chain`), and a check that a kept brief under the evidence dir carries those lines; W-434 (dispatch prompts as artifacts) stores prompts but does not check them, so file it as a new opus. Owner: ops-lead.
- The W-494 guard counts a finished background run as live, seen twice 11-07 (current-state-until-1107e.md:21, -1107d.md): `liveBackgroundRuns` (packages/cli/src/guard.ts:822-844) ends a run only on a task-notification or a "Successfully stopped task" result, so a run whose notice never lands and whose TaskStop answers "no task found" stays live forever; file a cause-fix opus (lex 11, a class seen twice): a TaskStop result naming the id as not found also ends it, red from a recorded transcript. Owner: ops-lead.
- The W-364 heavy-run guard missed `codex exec` in a script invoked as `$D/run.sh` (current-state.md:17,22): `heavyRun` (packages/cli/src/guard.ts:425-428) refuses an unknown script directory but a path built from an expansion walks as no script; file a fix opus: a script path holding an expansion is refused (fail closed), red with `$D/run.sh`. Owner: ops-lead.
- Cleanup held by a sandbox-pinned empty worktree folder (W-528, twice): covered by W-227 (greenlit, extended 11-08, first in the Queue: bounded rmdir and a guard refusing a cd into .worktrees/). Owner: ops-lead.
- Clerks have no Edit or Bash tool (.claude/agents/clerk.md:4, `tools: Read, Write, Glob, Grep`): every one-line edit is a whole-file Write at 20-40k tokens, and one clerk stopped on a false anchor doubt (current-state.md:23, -1107c.md:8); propose adding Edit to the clerk's tools (a code-owned .claude/ path, the Patron's merge), or say why not; W-532 (boot cut) does not cover it. Owner: ops-lead.
- docs/SESSION-HANDOFF.md:22 writes `check -- studio --repo .`, which a brief copies as `bisellium check -- studio` and `check` refuses (-1107d.md); fix the line to `npm run -s check -- studio --repo .` at the next handoff refresh, the form CLAUDE.md:18 already uses. Owner: ops-lead.
- Cycle time: W-525 ran 353 min, over the 180 stop line, its spec r2 failing 9 min after r1 with 5 S1; none beyond W-393, because the round rows show spec admission, not scheduling, as the cost. Owner: design lead.
- UI, design-quality and security classes: none, because no UI opus ran and no security finding appears in today's rows.

### 2026-11-08

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-227 | 199 | 5 | S1 6 |
| W-528 | 730 | 0 |  |
| W-541 | 313 | 3 | S1 3 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-227 | review | 1 | failed | - | tests×security-boundary-cases-uncovered S1 |
| W-227 | review | 2 | failed | 30 | tests×security-boundary-cases-uncovered S1 |
| W-227 | review | 3 | failed | 48 | tests×security-boundary-cases-uncovered S1 |
| W-227 | review | 4 | passed | 29 |  |
| W-227 | spec | 1 | passed | - |  |
| W-227 | spec | 2 | failed | 5 | spec×input-domain-missing-or-unenforceable S1, spec×promise-unattainable-under-accepted-domain S1 |
| W-227 | spec | 3 | passed | 80 |  |
| W-227 | spec | 4 | failed | 7 | spec×input-domain-missing-or-unenforceable S1 |
| W-227 | spec | 5 | passed | 39 |  |
| W-541 | review | 1 | failed | - | review×evidence-backfilled-or-absent S1 |
| W-541 | review | 2 | passed | 4 |  |
| W-541 | spec | 1 | passed | - |  |
| W-541 | spec | 2 | failed | 7 | review×evidence-backfilled-or-absent S1 |
| W-541 | spec | 3 | passed | 7 |  |
| W-541 | spec | 4 | failed | 8 | review×evidence-backfilled-or-absent S1 |
| W-541 | spec | 5 | passed | 43 |  |
| W-542 | review | 1 | failed | - | tests×ruled-case-uncovered S1, security×symlink-parent-write-escape S1 |
| W-542 | review | 2 | failed | 45 | tests×ruled-case-uncovered S1 |
| W-542 | review | 3 | passed | 42 |  |
| W-542 | spec | 1 | passed | - |  |
| W-542 | spec | 2 | passed | 6 |  |
| W-542 | spec | 3 | passed | 104 |  |
| W-542 | spec | 4 | passed | 4 |  |
| W-543 | spec | 1 | passed | - |  |

- LOOP W-227 review: class tests×security-boundary-cases-uncovered, rounds 1-2 (minutes since previous round: r1 -, r2 30)
- LOOP W-227 review: any class, rounds 1-3 (minutes since previous round: r1 -, r2 30, r3 48)
- LOOP W-542 review: class tests×ruled-case-uncovered, rounds 1-2 (minutes since previous round: r1 -, r2 45)

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| none | | | |

Classes in more than one opus, 2026-10-26..2026-11-08:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 5 opera: W-364, W-407, W-494, W-502, W-509
- class mechanism×replay-environment-not-pristine seen in 2 opera: W-462, W-477
- class review×evidence-backfilled-or-absent seen in 10 opera: W-300, W-413, W-415, W-417, W-425, W-430, W-477, W-495, W-502, W-541
- class review×fail-open-on-malformed-records-patched-per-site seen in 4 opera: W-430, W-444, W-468, W-525
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 5 opera: W-418, W-423, W-430, W-461, W-542
- class spec-gate×self-signed seen in 2 opera: W-442, W-502
- class spec×input-domain-missing-or-unenforceable seen in 11 opera: W-227, W-298, W-409, W-430, W-433, W-445, W-452, W-459, W-461, W-525, W-530
- class spec×input-without-named-rejector seen in 3 opera: W-418, W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 18 opera: W-227, W-298, W-333, W-407, W-417, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501, W-509, W-525
- class tests×assertion-satisfied-by-the-wrong-cause seen in 2 opera: W-298, W-473
- class tests×ruled-case-uncovered seen in 11 opera: W-364, W-415, W-444, W-450, W-454, W-463, W-474, W-495, W-496, W-525, W-542
- class tests×security-boundary-cases-uncovered seen in 2 opera: W-227, W-501
- class tests×tests-that-agree-with-the-bug seen in 3 opera: W-407, W-409, W-487
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-487, W-508

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-364, W-407, W-494, W-502, W-509): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class mechanism×replay-environment-not-pristine (W-462, W-477): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class spec-gate×self-signed (W-442, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by

#### Proposed improvements

- Owed spec-gate×self-signed (W-442, W-502), owed a second day: stamp `addressed_by: W-506` on a lesson of the class (W-506 "high: cause fix, spec-gate×self-signed", greenlit; next or verdict enforces the D-086 rule so a review round is not spent on it); the 11-07 proposal was not landed, so OWED still names it. Owner: design lead. Opus: W-506.
- Owed mechanism×replay-environment-not-pristine (W-462, W-477), owed a second day: stamp `addressed_by: W-464` (greenlit, qa; a check rule, brief-admission rule or prompt template named by the ops lead). Owner: ops-lead. Opus: W-464.
- Owed gate×W-339 (W-463, W-487) and gate×tests (W-364, W-407, W-494, W-502, W-509): the 11-07 filing is W-533 "Retro owes gate failures by row and recurrences" (greenlit): `retro --daily` classes a gate failure by its failing row (FAILING_ROW, packages/cli/src/retro.ts:1187) and states an unrowed one; stamp `addressed_by: W-533` on a lesson of each class. Owner: eng-lead. Opus: W-533.
- check-rule×pin-assertion-unchecked (producer, 11-09): a brief pin whose assertion holds inner quotes passes admission, since PIN (packages/commands/src/brief-admission.ts:144) matches `"…"` up to the first inner quote and checks the truncated text against nothing, and the prototype classifier (packages/cli/src/prototype-replay.ts) never reads pins; admission refuses a pin whose assertion holds an unescaped `"` or is not found verbatim in the named test row, and the prototype classifier checks each pin against its row; reds: an inner-quoted pin, a pin naming text absent from its row. Owner: eng-lead. Opus: file.
- script×review-kit-names-another-opus (producer, 11-09): ~/.bisellium-evidence/spec-review-d076/rn-run.sh:22 hard-codes W-227's worktree path and its round-2 "Earlier spec review" line, so a run for another opus carries W-227's text into the prompt; the kit takes the opus id and round as arguments, derives every path and earlier-round line from studio/ci/<id>-spec-<n>.log, and refuses when its prompt names an opus other than its argument; it retires when W-363 part 2 (the spec-review perform, greenlit) lands. Owner: ops-lead. Opus: W-363 (kit change now, a kept script).
- prompt×earlier-findings-hand-briefed (producer, twice, 11-09): a build verdict's `## Earlier findings` was briefed with more than the previous round's blockers, twice; the review perform writes `## Earlier findings` itself from the previous round's review log blockers only, and verdict refuses an entry not among them; W-329 (backlog) accounts for spec required fixes there but does not generate the section, so file it (or fold into W-329 and greenlight that). Owner: ops-lead. Opus: file.
- workflow×empty-retrigger-commit (producer, 11-09; Patron: no): the guard refuses `git commit --allow-empty` (and `--allow-empty-message`) outside quotes and heredoc bodies, naming a force-push of the real head or a PR reopen; reds: the refused call, an ordinary commit passing; W-378 (backlog) leans on an empty marker commit to order a re-review and drops it in the same opus. Owner: ops-lead. Opus: file.
- tests×ruled-case-uncovered (W-542 review LOOP r1-r2, an empty `agent_id` read as the main thread, packages/cli/src/guard.ts:957; 11 opera): the defect is fixed in W-542 (done); the class is covered by W-414 (high, greenlit: every accepted form of a brief's Input domain gets a row); no new opus. security×symlink-parent-write-escape (W-542 review r1, 5 opera) is not owed today. Owner: eng-lead. Opus: W-414.
- workflow×idle-wait-unfilled (W-542: ~8 h overnight on the code-owner approval, then the merge-queue wait, nothing run beside either; W-528 730 min with 0 failed rounds): covered by W-547 "next names a meanwhile step beside every wait" (greenlit), which also reports idle-wait minutes per opus in this retro and warns on a wait over 15 min with no other record; the code-owner wait itself is the Patron's by design (W-418 notifies, done); none beyond W-547. Owner: ops-lead. Opus: W-547.
- tests×security-boundary-cases-uncovered (W-227 review LOOP r1-r3, S1 x3; W-501): two opera, not owed; none, because W-227 passed at r4 and no third opus shows it; if it recurs, file a cause fix. spec×input-domain-missing-or-unenforceable and spec×promise-unattainable-under-accepted-domain (W-227 spec r2, r4): covered by W-393 (greenlit). Owner: eng-lead (tests), design lead (spec). Opus: W-393.
- UI and design-quality classes: none, because no UI opus ran today.

### 2026-11-09

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-542 | 632 | 2 | S1 3 |
| W-543 | 740 | 3 | S1 6 |
| W-547 | 382 | 4 | S1 13 |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-543 | review | 1 | failed | - | security×symlink-parent-write-escape S1, tests×tests-that-agree-with-the-bug S1 |
| W-543 | review | 2 | passed | 55 |  |
| W-543 | spec | 2 | failed | 558 | interface×validation-order-masks-errors S1, security×symlink-parent-write-escape S1, spec×promise-unattainable-under-accepted-domain S1 |
| W-543 | spec | 3 | passed | 32 |  |
| W-543 | spec | 4 | failed | 7 | security×symlink-parent-write-escape S1 |
| W-543 | spec | 5 | passed | 47 |  |
| W-543 | spec | 6 | passed | 11 |  |
| W-543 | spec | 7 | passed | 3 |  |
| W-547 | review | 1 | failed | - | tests×ruled-case-uncovered S1, interface×validation-order-masks-errors S1 |
| W-547 | review | 2 | failed | 43 | tests×ruled-case-uncovered S1 |
| W-547 | review | 3 | passed | 138 |  |
| W-547 | spec | 1 | passed | - |  |
| W-547 | spec | 2 | failed | 65 | spec×promise-unattainable-under-accepted-domain S1, spec×input-domain-missing-or-unenforceable S1, review×fail-open-on-malformed-records-patched-per-site S1, review×fail-open-on-malformed-records-patched-per-site S1, review×fail-open-on-malformed-records-patched-per-site S1, spec×input-domain-missing-or-unenforceable S1 |
| W-547 | spec | 3 | passed | 50 |  |
| W-547 | spec | 4 | failed | 5 | review×fail-open-on-malformed-records-patched-per-site S1, spec×promise-unattainable-under-accepted-domain S1, spec×input-domain-missing-or-unenforceable S1, spec×input-domain-missing-or-unenforceable S1 |
| W-547 | spec | 5 | passed | 4 |  |
| W-547 | spec | 6 | passed | 119 |  |
| W-547 | spec | 7 | passed | 3 |  |
| W-547 | spec | 8 | passed | 46 |  |
| W-547 | spec | 9 | passed | 5 |  |
| W-558 | review | 1 | failed | - | review×fail-open-on-malformed-records-patched-per-site S1 |
| W-558 | review | 2 | failed | 57 | review×fail-open-on-malformed-records-patched-per-site S1 |
| W-558 | review | 3 | passed | 572 |  |
| W-558 | spec | 1 | passed | - |  |
| W-558 | spec | 2 | failed | 7 | spec×input-domain-missing-or-unenforceable S1 |
| W-558 | spec | 3 | passed | 150 |  |
| W-558 | spec | 4 | passed | 8 |  |
| W-558 | spec | 5 | passed | 33 |  |
| W-558 | spec | 6 | failed | 7 | review×fail-open-on-malformed-records-patched-per-site S1 |
| W-558 | spec | 7 | passed | 47 |  |
| W-558 | spec | 8 | failed | 4 | review×fail-open-on-malformed-records-patched-per-site S1 |

- LOOP W-547 review: class tests×ruled-case-uncovered, rounds 1-2 (minutes since previous round: r1 -, r2 43)
- LOOP W-558 review: class review×fail-open-on-malformed-records-patched-per-site, rounds 1-2 (minutes since previous round: r1 -, r2 57)

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| W-547 | ci/W-547-tests-ca290f55.log | gate×W-530 | W-530-b4 |

Classes in more than one opus, 2026-10-27..2026-11-09:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 5 opera: W-364, W-407, W-494, W-502, W-509
- class interface×validation-order-masks-errors seen in 3 opera: W-474, W-543, W-547
- class mechanism×replay-environment-not-pristine seen in 2 opera: W-462, W-477
- class review×evidence-backfilled-or-absent seen in 8 opera: W-300, W-413, W-425, W-430, W-477, W-495, W-502, W-541
- class review×fail-open-on-malformed-records-patched-per-site seen in 6 opera: W-430, W-444, W-468, W-525, W-547, W-558
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 5 opera: W-423, W-430, W-461, W-542, W-543
- class spec-gate×self-signed seen in 2 opera: W-442, W-502
- class spec×input-domain-missing-or-unenforceable seen in 13 opera: W-227, W-298, W-409, W-430, W-433, W-445, W-452, W-459, W-461, W-525, W-530, W-547, W-558
- class spec×input-without-named-rejector seen in 2 opera: W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 19 opera: W-227, W-298, W-333, W-407, W-425, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501, W-509, W-525, W-543, W-547
- class tests×assertion-satisfied-by-the-wrong-cause seen in 2 opera: W-298, W-473
- class tests×ruled-case-uncovered seen in 11 opera: W-364, W-444, W-450, W-454, W-463, W-474, W-495, W-496, W-525, W-542, W-547
- class tests×security-boundary-cases-uncovered seen in 2 opera: W-227, W-501
- class tests×tests-that-agree-with-the-bug seen in 4 opera: W-407, W-409, W-487, W-543
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-487, W-508

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-364, W-407, W-494, W-502, W-509): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class mechanism×replay-environment-not-pristine (W-462, W-477): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class spec-gate×self-signed (W-442, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by

#### Proposed improvements

- Owed spec-gate×self-signed (W-442, W-502), owed a third day: the 11-07 and 11-08 stamps never landed because the class's one lesson, L-042, names W-080 (halted, so `causeFixes`, packages/cli/src/retro.ts:1354, skips it) and nothing has written studio/lessons/ since #501; a dispatched clerk sets L-042 `addressed_by: "W-506"` (greenlit, "high: cause fix, spec-gate×self-signed"). Owner: design lead. Opus: W-506.
- Owed mechanism×replay-environment-not-pristine (W-462, W-477), a third day: the same gap, L-058 names W-175 (halted); a dispatched clerk sets L-058 `addressed_by: "W-464"` (greenlit, this class's cause fix). Fold the presign meet's call 3 into W-464: the branch perform and the reds replay run `npm ci --cache ~/.bisellium-evidence/npm-cache` in the new worktree, and the replay refuses a worktree with no node_modules, a module resolving outside the worktree, or a lockfile digest unlike the branch's (evidence: W-558 reds 2-5 held because the worktree had no node_modules and the schema resolved to main's, current-state.md:39; presign-meet-1109/collated.md call 3). Owner: ops-lead. Opus: W-464.
- Owed gate×W-339 (W-463, W-487) and gate×tests (W-364, W-407, W-494, W-502, W-509), a third day: no lesson of either class exists (no `gate×` in studio/lessons/), so the stamp proposed 11-07 and 11-08 has nothing to land on. Amend W-533 (greenlit, "Retro owes gate failures by row and recurrences"): `causeFixes` also counts a greenlit-or-later opus whose own front matter names the class it fixes, and an OWED line for a class with no lesson says "no lesson of this class" rather than naming addressed_by; W-533 names both gate classes. Reds: a gate class with only an opus naming it, which is not owed; the same opus halted, which is owed. Owner: eng-lead. Opus: W-533.
- check-rule×pre-sign-gate (presign meet call 1, unanimous): `verdict --phase spec` (every first sign and re-sign, including class loops and amendments) cites a gate log tied to the prototype tree hash that ran `check` and every test file importing a touched module, scripts/*.test.mjs always included, falling back to the full `npm test` when the import walk cannot trace a module; it refuses otherwise. The gate also refuses a prototype diff that touches a path outside the brief's Files owned. Evidence: the W-547 class-loop amendment ran no suite and its unnamed W-530-b4 flip failed ci-opus-4 20 min later (ci/W-547-tests-ca290f55.log, this entry's Gate failures); W-543's r5 re-sign skipped admission (current-state.md:65); W-558's signed prototype failed 7 test.one_sided at ci-opus-1, W-547's 18 (current-state.md:40); the signer skipped plain-node scripts/*.test.mjs (status-slate, current-state.md:41); w547.test.ts held by W-498 stayed outside Files owned until `next` held it after a fix check (current-state.md:22); four unnamed flips (current-state.md:17). W-553 (risk class and budget) does not fit its scope: file its own opus, ranked after W-560. Switch to the full suite if it runs in under ~5-8 min in one slot or the subset misses once in the next two cascades. Owner: eng-lead. Opus: file.
- check-rule×class-census (presign meet call 2, unanimous; W-558's review×fail-open-on-malformed-records-patched-per-site found one site per round across spec r2, build r1, r2, spec r6, r8: the `.bisellium` parent, `receipts/`, `opera/` with an empty queue, the studio root): (i) a fix or amendment brief answering a repeated class tag names a kept census script and its committed output, each instance a row or a stated limit with a follow-on, and admission refuses the handoff otherwise (shape, not completeness), in the pre-sign gate's opus; (ii) the spec and build reviewer prompts say: name every instance found, not the first. The class itself is covered by W-185 (greenlit, one loader per record type; W-558 its first slice). Owner: eng-lead (i), ops-lead (ii). Opus: with the pre-sign gate (file).
- script×blind-codex-verdict (Codex sandbox meet call 3, unanimous): `verdict` and the review and fix-check performs refuse a Codex session whose shell failed or that ran no repository command, recorded failed-to-run, never passed (spec r4 PASS ran web search after "os error 30"; fix-2 "Unable to census", codex-sandbox-meet-1109/W-558-fix-2-void/); the fix-check census parser (next.ts, census read, the meet's next.ts:2927) stops counting "Not determined" as an open path; a Codex upgrade is admitted only by a kept smoke run by a dispatched agent (`codex exec -s read-only` lists and reads a worktree file inside the sandbox; codex-smoke-1109/run.sh, A and B failed on 0.167.0, pin OK on 0.153.4). Reading the session's structure replaces the producer's stop-grep on 'os error 30', which matched prompt quotes (current-state.md:21). Its own opus, high, ranked right after W-558; the D-178 freeze exemption is the Patron's call (qa: ask, not assume). Owner: ops-lead (performs, smoke), eng-lead (parser). Opus: file.
- hook×background-run-stale (W-494 guard kept the finished smoke run b887utfmu live and refused the agent's next run 3 times, then again at ci; current-state.md:20, :24): covered by W-538 "Guard ends runs TaskStop reports not found" (greenlit; `liveBackgroundRuns`, packages/cli/src/guard.ts:970); add the b887utfmu transcript as its red. Owner: ops-lead. Opus: W-538.
- hook×runner-hands-back-mid-run (3 times on 11-09, and a second hand-back refused; current-state.md:50): covered by W-372 (greenlit, the SubagentStop guard holds the hand-back while the agent's own perform runs); add a row for the refused second hand-back (`handsBack`, guard.ts:997, reads only the last tool call). Owner: ops-lead. Opus: W-372.
- hook×double-runner-dispatch (review r3 on W-558: a resumed runner was still acting when a second was dispatched; codex exit 1, empty verdict, nothing recorded; current-state.md:24): the rule now lives only in current-state.md:7 prose; the guard refuses an Agent dispatch of a ladder-runner for an opus while another ladder-runner for that opus has not handed back. Reds: the second dispatch refused, a dispatch after the hand-back allowed. Owner: ops-lead. Opus: file.
- prompt×earlier-findings-when-none-stand (r6b and r9b reissues: the prompt asked for Earlier findings when the previous recorded round, void spec-4, had none standing; current-state.md:7, :22, :34): fold into W-549 "The review perform writes Earlier findings itself" (greenlit): the perform omits the section when the previous recorded round has no standing blocker, and verdict refuses a section that names one when none stand. Owner: ops-lead. Opus: W-549.
- workflow×runner-land-under-timeout (runners ran `land` under `timeout` or a subshell, twice; current-state.md:50): covered by W-537 "A checked template for ladder-runner briefs" (greenlit), whose template states the foreground call with the 600000 ms tool timeout. Owner: ops-lead. Opus: W-537.
- workflow×unlanded-record-blocks-done and handoff-check×in-flight-line (W-555's greenlit-unlanded record blocked another opus's done; handoff-check read every id on the In flight line as in flight; current-state.md:50): no opus covers either; file one: done refuses only on its own opus's records, and handoff-check reads the In flight line's opus ids by their named form, not every id. Owner: eng-lead. Opus: file.
- spec×security-amendment-after-ceiling (W-543 r5: a class-loop security amendment after the two-review ceiling got no spec review, the build review its only judge; current-state.md:63): `next` names a spec review for a re-signed brief whose amendment touches a security row, regardless of the ceiling. Owner: design lead. Opus: file.
- gate×W-530 (W-547, ci/W-547-tests-ca290f55.log, row W-530-b4): one opus, not owed; its cause, an unnamed flip at a re-sign, is covered by the pre-sign gate above. Owner: eng-lead.
- review×fail-open-on-malformed-records-patched-per-site (6 opera), interface×validation-order-masks-errors (3), security×symlink-parent-write-escape (5), tests×tests-that-agree-with-the-bug (4), tests×ruled-case-uncovered (W-547 review LOOP r1-r2): none new, because each has a cause fix named by a lesson (none is owed) and W-185, W-414 stand greenlit for the first and last.
- workflow×session-url-in-commit (runner's commit carried a Claude-Session line, current-state.md:24): none, because the guard already denied it and the retry landed clean.
- UI and design-quality classes: none, because no UI opus ran on 11-09.

### 2026-11-10

| Opus | Cycle min | Failed rounds | Blockers by severity |
|---|---|---|---|
| W-558 | 823 | 5 | S1 5 |
| W-568 | 408 | 0 |  |
| W-571 | 114 | 0 |  |
| W-572 | 496 | 0 |  |

#### Review and spec rounds

| Opus | Phase | Round | Outcome | Min since previous round | Blockers (class severity) |
|---|---|---|---|---|---|
| W-568 | review | 1 | passed | - |  |
| W-568 | spec | 1 | passed | - |  |
| W-568 | spec | 2 | passed | 24 |  |
| W-571 | review | 1 | passed | - |  |
| W-571 | spec | 1 | passed | - |  |
| W-571 | spec | 2 | passed | 5 |  |
| W-572 | review | 1 | passed | - |  |
| W-572 | spec | 1 | passed | - |  |
| W-572 | spec | 2 | passed | 7 |  |
| W-573 | spec | 1 | passed | - |  |

- no loop

#### Gate failures

| Opus | Log | Class | Failing rows |
|---|---|---|---|
| W-558 | ci/W-558-tests-76c99972.log | gate×tests |  |
| W-572 | ci/W-572-tests-8a4f90ae.log | gate×tests |  |

Classes in more than one opus, 2026-10-28..2026-11-10:
- class gate×W-339 seen in 2 opera: W-463, W-487
- class gate×tests seen in 7 opera: W-364, W-407, W-494, W-502, W-509, W-558, W-572
- class interface×validation-order-masks-errors seen in 3 opera: W-474, W-543, W-547
- class mechanism×replay-environment-not-pristine seen in 2 opera: W-462, W-477
- class review×evidence-backfilled-or-absent seen in 7 opera: W-300, W-413, W-430, W-477, W-495, W-502, W-541
- class review×fail-open-on-malformed-records-patched-per-site seen in 6 opera: W-430, W-444, W-468, W-525, W-547, W-558
- class review×shared-log-grammar-rejects-valid-records seen in 2 opera: W-459, W-492
- class security×symlink-parent-write-escape seen in 4 opera: W-430, W-461, W-542, W-543
- class spec-gate×self-signed seen in 2 opera: W-442, W-502
- class spec×input-domain-missing-or-unenforceable seen in 13 opera: W-227, W-298, W-409, W-430, W-433, W-445, W-452, W-459, W-461, W-525, W-530, W-547, W-558
- class spec×input-without-named-rejector seen in 2 opera: W-489, W-495
- class spec×promise-unattainable-under-accepted-domain seen in 18 opera: W-227, W-298, W-333, W-407, W-452, W-459, W-462, W-468, W-472, W-489, W-494, W-495, W-498, W-501, W-509, W-525, W-543, W-547
- class tests×assertion-satisfied-by-the-wrong-cause seen in 2 opera: W-298, W-473
- class tests×ruled-case-uncovered seen in 11 opera: W-364, W-444, W-450, W-454, W-463, W-474, W-495, W-496, W-525, W-542, W-547
- class tests×security-boundary-cases-uncovered seen in 2 opera: W-227, W-501
- class tests×tests-that-agree-with-the-bug seen in 4 opera: W-407, W-409, W-487, W-543
- class workflow×files-owned-boundary-exceeded seen in 2 opera: W-487, W-508

#### Owed cause fixes

- OWED class gate×W-339 (W-463, W-487): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class gate×tests (W-364, W-407, W-494, W-502, W-509, W-558, W-572): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class mechanism×replay-environment-not-pristine (W-462, W-477): no lesson of it names a greenlit cause-fix opus in addressed_by
- OWED class spec-gate×self-signed (W-442, W-502): no lesson of it names a greenlit cause-fix opus in addressed_by

#### Proposed improvements

- Owed spec-gate×self-signed (W-442, W-502) and mechanism×replay-environment-not-pristine (W-462, W-477), a fourth day: the clerk stamps proposed 11-07 to 11-09 never landed (studio/lessons/L-042.md:7 still `addressed_by: "W-080"`, L-058.md:7 still `"W-175"`, both halted, so `causeFixes` skips them); a dispatched clerk sets L-042 to W-506 and L-058 to W-464 (W-564, the npm ci half, is now filed and queued). Because a stamp proposed three days running never landed, it goes in the producer's next records PR as its own named line. Owner: design lead (L-042), ops-lead (L-058). Opus: W-506, W-464.
- Owed gate×tests (now 7 opera: W-558 ci/W-558-tests-76c99972.log, W-572 ci/W-572-tests-8a4f90ae.log, where `node scripts/test-reads.mjs` failed on a new test file) and gate×W-339: still no lesson of either class (no `gate×` lesson in studio/lessons/), so covered by W-533 as amended 11-09 (an opus's own front matter can name the class it fixes). W-563 is gate×tests' cause fix (pre-sign gate; brief behaviour 2's row "a new file that reads studio/ without a test:record entry" covers W-572's miss): W-533 names W-563 for gate×tests. Owner: eng-lead. Opus: W-533, W-563.
- test×certify-gate-timeout (not a flake; current-state.md:8): W-571's and W-568's merge-group certify hit `GATE_TIMEOUT_MS = 30 * 60_000` (packages/pipeline/src/index.ts:56, :224) with no failing assertion; the 14-wide `node --test` batch at package.json:17 took 1279-1376 s and the same tree passed in 21m32s on retry (certify-flake-1111/failures.md). Two lost runs of ~35 min each. File a high cause-fix opus: raise the limit to 60 min, or split the batch so the gate stays under 30, and have the gate log print the slowest files when it times out. Red: a gate command that outlives the limit is reported "timed out", the same command under the new limit passes. Owner: eng-lead. Opus: file (not covered: nothing in studio/opera/ names GATE_TIMEOUT).
- test×W-124-b5-live-process-race (W-572's first certify, run 42838829657: `not ok 77 - W-124 behaviour 5`, packages/cli/src/next-ladder.test.ts:449; fixtures liveChild/zombiePid/deadPid and output mtimes at next-world.test.ts:827-841, run beside 13 other files): file a cause fix that makes b5 deterministic (an injected /proc and pid reader, or the row moved out of the parallel batch). Red: b5 run 20 times under `--test-concurrency=14` with CPU load passes every time. Owner: eng-lead. Opus: file.
- gate×failing-lines-summary-wrong (W-466): the gate summary printed `its last 0 of 0 failing lines` for W-558 (ci/W-558-tests-76c99972.log) and picked the fixture string `existing candidate regression` (packages/commands/src/run.test.ts:569) instead of W-572's `not ok 77` line; the full log stayed in the bwrap cell. File: the summary takes TAP `not ok` lines first, and certify uploads the tests log. Owner: eng-lead. Opus: file.
- check-rule×test-reads-at-sign (W-572 ci-opus-1; current-state.md:28) and the review meet's recommendation (class census at round 1 of spec and build review, pre-sign test-reads gate on the prototype tree; review-article-meet-1111/collated.md §3): covered by W-563 (exempt from D-178, the Patron 11-11; brief behaviours 2, 4 and 5). Owner: eng-lead.
- red×empty-HOME-replay and POISON lacking EROFS (W-562 red 3, W-571's first empty-HOME proof void; current-state.md:36, :51): covered by W-573. Owner: ops-lead.
- hook×end-of-session prompt (endprompt-meet-1110, unanimous route B + C): covered by W-574. Owner: ops-lead.
- hook×Patron-route-question (asked the Patron a question the leads' fallback covered; current-state.md:36): covered by W-572 (done 11-10). Owner: ops-lead.
- script×merge-QUEUE_TIMEOUT-on-failed-check and the long merge variant polling a never-enqueued PR (W-562 PR #1121, 2 h and 50 min lost; current-state.md:51, :68, :69): W-219 states exactly this (stop at the first merge-group rejection naming the failing step; a timeout names the queue state) but is halted. Lift W-219 into W-557's chain or fold its two clauses into W-557 (greenlit), with reds: a removed-for-check PR reports the check name, a WAITING PR is enqueued once checks pass. Owner: ops-lead. Opus: W-557 (fold W-219).
- script×land-502-held (daily retro 11-09's land printed "held" on a GitHub 502 after the merge request and merged anyway; current-state.md:55; `say(... "held" ...)`, packages/cli/src/land.ts:277): file: a gh 5xx on the PR read is retried with a bounded backoff and, if still failing, reported "unknown: re-run land", never "held". Owner: ops-lead. Opus: file.
- eng×superseded-opus-with-branch (W-562 superseded by W-571: `furtherAlongBranches`, packages/cli/src/next.ts:716-727, reads master's record through `laneRecord` and ignores a halt on the branch; D-021 blocks the master halt; the Patron deleted opus/W-562 by hand; current-state.md:36, :40): file: furtherAlongBranches skips a branch whose own tip record is halted or done. That removes the need for an agent branch delete, which the classifier refuses (none further on the classifier, because that is the Patron's settings call). Owner: eng-lead. Opus: file.
- eng×red-re-record-without-failed-review (a void red, here the EROFS-on-/tmp proof, has no verb path to record again outside a fix round; W-468 issues a ticket only in phase fix; current-state.md:36, :40): file: `red` re-records a behaviour whose previous log is void when given a reason, keeping the earlier log and naming it in the new one. Owner: eng-lead. Opus: file.
- eng×split-hint-dead-end (`next` prints `bisellium new --kind <kind> ... --parent <id>`, packages/cli/src/next.ts:1632, pinned by next-spec.test.ts:491, and `new` refuses `--parent` for any kind but subtask; dead end on W-559 and W-562; current-state.md:63): file: the hint drops `--parent` (or names `--kind subtask`) and a test runs the printed command through `new`'s own validation. The filing script that tripped the 8-word title limit (current-state.md:36) is the same class: `new` gains a `--dry-run` that checks title, kind and parent and writes nothing, and filing kits run it first. Owner: eng-lead. Opus: file.
- ops×worktree-admin-held-busy (the sandbox mount pin keeps a worktree's .git/worktrees admin directory busy for the whole session that touched it; the 11-11 dones left 3 "held busy"; current-state.md:16): W-489 (done) clears stale admin dirs only when they are not busy. File: the done perform lists each busy admin dir in a kept file, and `run --reclaim` (or tick) in the next session retries and empties the list; a red row: a listed dir is removed in a later process. Owner: ops-lead. Opus: file.
- hook×backgrounded-subshell (a runner used `( … ) &` once, so no exit file was written; current-state.md:16): guard.test.ts has no row for a subshell group followed by `&`. Add rows: `( cmd ) &` refused in a foreground call, and in a run_in_background call too, since the harness already detaches it and an inner `&` loses the exit code. Owner: ops-lead. Opus: file (or fold into W-537 if its template already pins the background form).
- hook×brief-Write-batched-with-dispatch (twice on 11-10: the r4 brief's Write failed in the same batch as its dispatch, so the runner got a sed-copied branch brief; current-state.md:51, :61): the rule lives only in current-state.md prose. File: the guard refuses an Agent dispatch whose prompt names a brief path that a Write or Edit in this session failed on and has not since succeeded. Red: the failed-then-dispatched case refused, the written-then-dispatched case allowed. Owner: ops-lead. Opus: file.
- prompt×runner-hand-back-after-interim (runner final reports refused twice after an interim report, recovered by SendMessage; current-state.md:28, :51, :65): fold into W-537 (greenlit, checked ladder-runner brief template): the template says one SubagentHandback, last, with no interim report. Owner: ops-lead. Opus: W-537.
- prompt×Earlier-findings-for-advisories (W-562 r4 record refused; current-state.md:62): covered by W-549 (as proposed 11-09). Owner: ops-lead.
- hook×W-494-stale-run (fired 3x on 11-10; current-state.md:51, :67): covered by W-538 (now exempt from D-178). Owner: ops-lead.
- hook×double-runner-dispatch: covered by W-565. Owner: ops-lead.
- prompt×CLAUDE.md-design-magister (the architect seat was asked for the design lead at the review-article meet; current-state.md:9; collated.md first paragraph): CLAUDE.md:81 is generated by `instructions` (packages/cli/src/instructions.ts:53) from studio/bisellium.yml:9, which still says `magister: architect` while studio/leges/design.md:3 names the design lead (D-150 C). File: the design collegium's magister becomes design-lead and `instructions --write` regenerates CLAUDE.md; check that W-452's legacy rule (bisellium.yml:17, "still the design magister for opera started before spec_seats.since") still reads the old signer. Code-owned: Patron approval at land. Owner: design lead. Opus: file.
- workflow×queue-says-length (the producer's `says` text broke queue.shape's 200-char limit; current-state.md:9): none, because queue.shape already refuses it before land and it cost one clerk redo.
- review-system practices from the review-article meet (eval set of past misses, Pre-existing tag, noise by outcome, which layer should have caught it): none now, because the meet put them all after M4 as one study opus (collated.md §1, §3); the producer files that study opus behind M4 so the daily retro's tags have a place to go. Owner: ops-lead (prompts), eng-lead (eval runner).
- review×, spec×, security×, tests× classes in the 14-day list: none new, because no review or spec round failed on 11-10 (the round table has passes only and no loop) and each standing class has a cause fix named by a lesson (none is owed).
- UI and design-quality classes: none, because no UI opus ran on 11-10.
