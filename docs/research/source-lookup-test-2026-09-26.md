# Source lookup experiment: 2026-09-26

Research retrieval test, not an implemented CLI feature, automated regression suite, or censor verdict. See [research handover](memory-lookup-handover-2026-09-26.md) and [existing baseline](lookup-baseline-2026-09-26.json).

## Method

One bounded Sol-low read-only audit followed explicit, curated file routes. The producer checked relevant excerpts and followed up the W-089 checkout ambiguity with Git metadata and its known worktree's task record. No evidence log bodies were opened; linked brief/review files were checked for existence. No application code, workflow configuration or studio records changed.

## Findings

| Question | Sources (one-based lines at the recorded checkout) | Answer and limitation |
| --- | --- | --- |
| Current censor? | `.codex/agents/censor.toml:3-5`; `studio/bisellium.yml:21,57,69` | Sol high; manifest supplies model/tier, TOML supplies effort. |
| W-089 brief and review? | Root `studio/opera/W-089.md:6-7`; W-089 worktree `studio/opera/W-089.md:6-7,14` | Root is greenlit with no gate links. The opus worktree records done and links `briefs/W-089.md` and `ci/W-089-review-4.log`; both exist relative to that worktree's studio. Missing here must not be reported as missing everywhere. |
| W-102 handoff current? | `studio/opera/W-102.md:6-14` | Task is done; stored building/pre-review handoff at 08:06:36Z predates passed review at 08:18:11Z. Display as an earlier recorded handoff, not the current next action. |
| Why Sol despite older Astra/Opus text? | `studio/decisions/D-014.md:60-90`; `docs/SESSION-HANDOFF.md:98-107` | Explicit Patron correction at D-014:84-90 supersedes the preceding censor assignment prospectively. Historical reviews remain accepted. The whole decision is not historical; paragraph order alone is not a general precedence rule. |
| Which checkout? | Git branch, HEAD, tree and tracked status | Root: `codex/persistent-workflow`, HEAD `f391c2945e6af7e1a8cec1de70ca8a05a2a36408`, tree `ba50159c8dc2996a08ff0a8503222e57897bb307`. W-089: `opus/W-089`, HEAD `80e24cdd5d03636ed4483c4dc5003f654c786b9a`. Tracked status clean at inspection; root has pre-existing and newly created untracked files. |

W-089 source root: `.worktrees/W-089/studio/`. Its recorded completed gates describe that branch; this experiment does not certify its code, mergeability or current test health.

## Efficiency observations

The agent opened seven named files including mandatory AGENTS.md. Its first pass displayed about 31,356 source/snippet characters (excluding line-label overhead and Git output), because its filters selected excessive historical text. That misses the intended compactness target.

The producer narrowed the same six task/policy files to explicit ranges: censor TOML 1-5; manifest 18-23 and 50-70; W-089 opus 1-8; W-102 opus 1-15; D-014 60-90; session handoff 98-107. Those numbered excerpts total 5,682 characters. This is an observed excerpt-size refinement, not a token-cost comparison with the original query baseline. Files were loaded in full by the selection code; model-visible excerpts and filesystem bytes are different measures. Git worktree metadata and the additional W-089 record were extra reading, excluded from that figure. They were needed to resolve the cross-checkout ambiguity.

No elapsed agent-time comparison, billed-token total or subscription savings was measured. Curated routes already know the relevant files and cannot establish general search quality. The existing query baseline handles different question shapes, so claiming a percentage improvement would be misleading.

## Decision

The experiment supports source lookup as a useful next feature, with two required refinements: bounded excerpts and explicit checkout scope. Four initial routes answered their scoped questions; the W-089 route needed a worktree follow-up to locate the requested evidence. Do not call the initial single-checkout attempt a five-for-five success.

A small future implementation should:

1. Resolve a task record, its explicit brief/evidence paths and checkout identity.
2. If links are absent locally, state that limitation and offer explicitly identified matching worktrees without silently mixing branch facts.
3. Return policy settings and governing amendment references; surface disagreement rather than guessing precedence.
4. Label old handoffs against current lifecycle evidence.
5. Cap excerpts and make expansion deliberate. Validate paths and missing references deterministically.

These are acceptance candidates for a signed brief, not authorization to bypass Bisellium's implementation/review gates. No new lookup command has been shipped by this experiment.
