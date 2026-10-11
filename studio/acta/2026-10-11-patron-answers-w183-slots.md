---
id: "2026-10-11-patron-answers-w183-slots"
title: Patron answers — W-183's slot count is per machine
kind: decision
author: producer
at: 2026-10-11T05:46:14Z
---
# W-183: the heavy-job slot count is set per machine

Asked after spec review round 8 (the title still named bisellium.yml). The Patron noted the right number depends on where bisellium runs (a cloud host differs from a laptop). A committed file gives every checkout the same number; an environment variable is set per machine. Chosen: `BISELLIUM_HEAVY_JOB_SLOTS`, unset means 1, 1-64 accepted, anything else refused. W-183's title amended. The rest of W-183's design and Defaults still wait for the Patron before `branch`.
