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
