---
author: "qa-lead"
kind: daily
title: "I have what I need from the opus records and review logs. There's no file-writing tool in this session and shell access "
at: "2026-10-20T12:58:45.679Z"
evidence:
  - { label: health, href: bisellium.yml }
---
I have what I need from the opus records and review logs. There's no file-writing tool in this session and shell access was partly denied, so here's the text instead of a saved file.

---
author: "qa-lead"
kind: daily
title: "**Acta diurna — collegium QA (the Censor), a.d. XIII Kal. Nov. MMXXVI (2026-10-20)**"
at: "2026-10-20T13:00:00.000Z"
evidence:
  - { label: health, href: bisellium.yml }
---
**Acta diurna — collegium QA (the Censor), a.d. XIII Kal. Nov. MMXXVI (2026-10-20)**

1. **Nine passed in 16 rounds:** W-241, W-297 and W-313 passed on round 1. W-288, W-299, W-317, W-330 and W-335 passed on round 2. W-334 passed on round 3 (`ci/W-334-review-3.log`).
2. **Classes that came back:** `tests×one-sided-bound-assertion` was found three times today: S1 in round 1 of W-317 and W-330, and again as an advisory S3 in W-330 round 2. W-334, which fixes its cause, is now done. `tests×ruled-case-uncovered` was found in W-299 r1 and W-335 r1, and W-336 is filed high for it. `mechanism×********` was found in both W-334 r1 and r2.
3. **Budget and gaps:** there's no `aerarium/2026-W43.yml`, so this week's use against the 0.5M allowance can't be reported (§5). W-288's review logs carry no `[class:]` tag, which W-329 (backlog) would make a hard refusal.

---

To file it, save it as `acta/2026-10-20-qa-lead-daily.md` and commit it. Some things I couldn't confirm:
- **Round counts:** taken from the review evidence file names (`review-N.log`) in each opus record. They match the eng-lead's count of 16.
- **W-288:** my search found no class tag in its logs, but I didn't open the files to confirm.
- **The `at:` timestamp:** I put that in myself.
