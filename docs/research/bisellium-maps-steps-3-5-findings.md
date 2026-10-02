# Steps 3-5: exploratory source cases and next experiment

2026-09-26. This is a research checkpoint, not a shipped feature, model benchmark, signed implementation brief or review verdict. Governing scope: [handover](bisellium-maps-investigation-handover.md). Proposed semantics: [Step 2 contract](bisellium-maps-step-2-contract.md).

## Step 3: grounded source routes

[The captured dataset](bisellium-maps-exploratory-cases.json) contains 15 questions, five per project, with inspected reference ranges, file hashes and expected scoped outcomes. These are exploratory cases: source selection preceded capture, so none is a blind holdout. A bounded Terra-low audit gathered the game-project references; producer spot-checking corrected an overbroad Yan Mo randomness answer.

| Project | Five question topics | Captured excerpt characters | Unique files in captured routes |
| --- | --- | ---: | ---: |
| Bisellium | W-102 state/handoff; censor authority; epoch0 adapter capability; W-089 evidence locality; historical censor amendment | 4650 | 5 |
| epoch0 | queued/in-train state; task versus sequencing authority; independent battle construction paths; done evidence; corrected milestone claims | 7243 | 3 |
| Yan Mo | overview versus live status; canon/workflow routing; seeded configuration exception; visual evidence; passive soul-sight correction | 9410 | 4 |

All captured source paths and line ranges exist. Counts are Python character lengths of unnumbered excerpts, summed per case (including repeated excerpts); they exclude earlier discovery, role instructions, agent/tool overhead and Git output. Unique files are across captured routes per project, not all files opened during investigation. These are not usage savings or a fair comparison with the initial query baseline.

Bisellium checkout was `f391c2945e6af7e1a8cec1de70ca8a05a2a36408`; epoch0 `fdbbb00ea496f6976e2ba5446d1921598cef7045`; Yan Mo `dd842eb45017c6021378ce07ea00b5069e6f097c`. Root inspection assessed tracked status only: Bisellium and epoch0 clean, Yan Mo dirty. The source-finding agent additionally observed Yan Mo's modified game/project.godot and untracked terrain/demo directories. No implementation status is inferred from them. Per-file hashes identify the actual documents captured independent of checkout dirtiness.

## What the routes exposed

- **Bisellium:** task IDs alone are insufficient. W-089 has different records in root and its opus worktree. Older W-102 handoff text is not its current action. The existing epoch0 adapter comments describe a plan while the implementation returns empty data.
- **epoch0:** a board's stored scheduled state does not itself prove a live train. Milestone scope, product sequencing and task state have different authoritative homes. A definition of done is not proof that any particular row satisfies it.
- **Yan Mo:** README's compressed no-RNG statement omits CLAUDE.md's explicit seeded deterministic configuration allowance. A first-pass answer based only on README would overstate the rule. The E1 spec also explicitly corrects soul-sight to passive possession rather than a toggle. Green tests alone are insufficient evidence of visual correctness under its workflow.

Thus a map needs both navigation and the intended question type. It must not merely choose the shortest matching paragraph. A source finding can legitimately return a limitation instead of an answer about live behavior.

## Step 4: evaluation status and honest limits

Completed: source-route grounding, path/range validation, bounded excerpts, file content hashes, scoped checkout observation, source-based inspection of historical/conflicting claims. No source project was modified. No project tests, Godot sessions, PR checks or live workflow observations were run.

Not completed: independent answer scoring, same-question baseline-versus-candidate agent trials, a genuinely held-out dataset, task-context sufficiency trials, fixture-based changed/missing-reference checks, or runtime portfolio lookup. Existing query does not expose these source routes and the epoch0 adapter is a stub. Calling this an end-to-end Bisellium experiment would be false. The present dataset is input to that experiment.

Do not claim 15/15 semantic correctness from 15 valid file ranges. In particular, routes intentionally stop short of live state, actual test PASS, exact task ordering or implemented mechanic correctness. Expected outcomes specify these abstentions. No billed usage measurement was obtained for individual cases.

## Next executable experiment (bounded scope)

Build only a Bisellium research harness behind the proposed optional read-only source capability, under the existing spec/build/review process. Do not install anything in epoch0 or Yan Mo. Use explicit bindings for all three projects in research fixtures; do not prematurely introduce a production registry format.

1. Freeze the 15 exploratory questions and expected evidence; keep expected routes hidden from an independent comparison runner. Label prior exposure and do not rename these blind holdouts.
2. Baseline: current Bisellium context/query where supported, plus ordinary project entry-point navigation/search where needed. Candidate: the same task inputs and model settings with Bisellium-provided source references and bounded reads. Include total discovery effort, not only final excerpts.
3. Test one context-assembly task per project for required evidence coverage and omissions before comparing size.
4. Use temporary fixtures for duplicate local task IDs across projects, selected cross-project results, a project with two repositories and one unavailable, moved reference, dirty source, stale checkout, conflicting authority, unsupported adapter, and path escape. Do not manufacture a real multi-repo example from client/backend folders.
5. Require correct project/repo attribution and no silent fallback across sources in every fixture; partial/unknown is valid when disclosed. Score actual answers independently from path existence. Record discovery/map maintenance separately from repeated lookup cost.

This is the next experimental implementation scope, not permission to bypass gates or a claim the tests have run. Keep production workflow ingestion, live orchestration, schedules, UI, embeddings and full game adapters outside this experiment.

## Step 5: provisional recommendation

Proceed with a narrowly scoped, read-only Bisellium source-reference experiment using the existing adapter interface as its integration point. The grounding shows useful cases across workflow and game projects, and one concrete failure from shallow summary lookup. It does not yet justify shipping a general memory system or promise usage savings.

The lowest-cost responsible next action is a signed brief for that harness, with the dataset above reused as evidence and acceptance inputs. Stop expanding research breadth. Authoring executable harness code or production changes requires a separate builder and the established review gates; none was authored in this pass. A final product recommendation remains contingent on the comparative and failure-case results.
