# W-107 pre-censor mechanical evidence

Status: evidence pre-review only; no semantic grading or review verdict.

## Verified evidence

- Worktree `codex/read-efficiency` is clean at commit `c819915d3da6dfd4ba6c1ddd6ef88c32f9af72af`.
- The four supplied top-level SHA-256 commitments match: freeze `96f22c5b2c9e5c235e22bf25f81e2eb81098d6284f057aeb29586059084041ac`, run index `7001c8167434e633765cf69e2b56cb252d6ce5522a8999316da2712e00f000a2`, review packet `67fce8eef6c104fca859a8ff2af12f6adda2112c95020a061b54f784a3ce2d1d`, scoring package `a1148cea5edc193a1fc0d53bfd3f12a8f0d0fd98654c0fbfbe83a8d60f9d83bf`.
- Freeze is `FROZEN` with a 12-entry order. Its reader and runner commitments match the current worktree files; its public registry, cases, and snapshot-manifest commitments match the frozen input files.
- The explicit run index contains 12 unique, confined absolute paths. Ordinals are exactly 1–12. Each run is `COMPLETE` with exit `0`; every audit is `VALID`. The scoring package references exactly those 12 run hashes.
- The review packet and scoring package each contain 12 entries; their anonymous identifiers are unique and cross-linked. No answer text was inspected or reproduced.
- Certification records `npm run -s bisellium -- verify W-107 --studio studio --repo .` with exit `0`; its log names refreshed tests, lint, and types certificates for source tree `0e4c3f0d931539b3c6096f34cedbabd7763b98d1`.
- Fresh preflight manifests report a passing canary verification and a successful bypass-canary exit. No model call was made in this pre-review.

## Raw run totals

| Arm | Runs | Source-access calls | Read bytes |
| --- | ---: | ---: | ---: |
| baseline | 6 | 23 | 237,951 |
| candidate | 6 | 35 | 243,194 |

These are raw recorded measurements only. This sheet makes no correctness, adoption, or review conclusion.

## Mechanical blocker

The supplied narrative says ordinal 1 first failed with pre-output `ENOENT` and was retried identically after creating its parent. The retained `commands.txt` records one ordinal-1 `RUN` command and one `AUDIT` command, but contains no `ENOENT`, pre-output failure, retry, or second ordinal-1 command entry. No separate failure record was found under the supplied run output. Therefore the original failure’s retention and the retry’s identity cannot be mechanically verified from the current evidence.

All other checks above passed. A sole-censor round should wait for a retained original-failure command record or an equivalent immutable receipt; this is an evidence-record issue, not a semantic judgment.