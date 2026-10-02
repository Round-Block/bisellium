# Bisellium MAPS investigation handover

## Resumed 2026-09-28

The Patron resumed after limits reset; account usage was 1% consumed. Builder-sol has fixed both round-1 findings using existing reds, with 37 targeted tests passing and refreshed comparison outputs. Full verification, Terra pre-review and independent Sol-high round 2 remain pending. Prior stop and unfixed descriptions below are historical; consult [the current checkpoint](W-103/CHECKPOINT.md). No reset credit redeemed.

Updated: 2026-09-27. Owner: producer. Status: W-103 building; independent review round 1 FAIL; paused at the requested 2% usage threshold.

## Governing scope correction

MAPS supplies design ideas to Bisellium. The capability belongs inside Bisellium; Bisellium then uses it when operating on managed projects such as epoch0 and Yan Mo. Do not build a separate MAPS system for those projects, a cross-project memory authority, or a standalone lookup product. This supersedes the independent-workspace framing in the earlier research handover.

A separate experimental workspace is optional test infrastructure, not a product requirement. No new project is needed for the present investigation. epoch0 and Yan Mo remain read-only reference instances. Do not install Bisellium, rewrite their workflows, edit their code, or infer current adoption from their presence on disk.

## Multi-project requirement (Patron clarification)

Bisellium can manage more than one project or repository. Treat that as a requirement, not an unresolved product-scope question. The representation of projects, repository membership and studio topology remains a design choice. Every source result must retain project/repository/checkout identity. Cross-project questions are supported in the research scope without mixing authority or facts. The older open question in docs/STUDIO.md is historical evidence of the implementation gap, not a reason to omit this requirement.

## Existing evidence to reuse

- [Research and baseline context](memory-lookup-handover-2026-09-26.md)
- [Raw baseline](lookup-baseline-2026-09-26.json)
- [First retrieval experiment](source-lookup-test-2026-09-26.md)
- [MAPS guide](https://github.com/pavrus117/ai-os-maps-guide)

Findings already established: source lookup needs checkout scope; W-089 evidence exists in its worktree despite missing root links. W-102 retains an obsolete pre-review handoff despite being done. Existing context may include long acta while omitting governing decision references. The first curated retrieval pass returned too much history. No usage-saving percentage or general retrieval capability has been demonstrated.

## Sequential investigation

### Step 1 - Existing managed-project integration

Inspect adoption/configuration, context/query, repository/worktree handling and relevant schema. Record what exists, what is absent, and what remains unverified. Explain how a managed repository is currently associated with a studio; do not assume a central project registry. Deliverable: source-linked integration map and gap list.

### Step 2 - Minimum source-navigation contract

Using Step 1, propose repository/checkout identity, source entry points, authority by question type, source relationships and freshness/conflict signals. Map each to existing Bisellium concepts before proposing new configuration. Facts stay in the managed project. A lookup result should contain references and bounded excerpts, not copied project histories. This is research design, not a signed implementation brief.

### Step 3 - Freeze cases and compare approaches

Prepare five real questions each for Bisellium, epoch0 and Yan Mo: status/next action, policy/authority, design or behavior, evidence, historical/conflicting claim. Tailor questions to project concepts. Verify expected source links before comparison, and hold out some cases from map construction.

Compare existing Bisellium context/query plus ordinary search with a proposed Bisellium source-map-assisted path. If a capability does not exist, label its simulation/prototype explicitly; never present it as an integrated feature. Test task-context sufficiency separately from source discovery. Use temporary fixtures for moved/missing links, conflicts and checkout changes, never mutate reference projects.

### Step 4 - Evaluate evidence and cost

Measure source/answer correctness, appropriate abstention and conflict reporting, files opened, excerpts supplied and tool calls. Record actual usage/time only if available. Account for one-time map creation and maintenance separately. Smaller context that omits governing evidence fails. Character estimates are not billed tokens. Hold model settings and task inputs stable where comparing agent runs; record limitations.

### Step 5 - Recommend one bounded Bisellium change

Select query/context/source validation changes only after results justify them. Deliver a bounded implementation brief or a documented no-build decision. Production implementation must follow Bisellium's existing separate spec/build/review workflow; this research does not waive its gates.

## Usage discipline

Initial account snapshot this turn: 86% of weekly usage consumed, 14% remaining. This is account-wide and can change outside this task. Do not redeem reset credits without explicit user authorization. Do not claim a monetary cost or exact model savings from unavailable accounting.

Prefer deterministic file/Git inspection and reuse earlier findings. At most one bounded lower-tier research dispatch at a time; no duplicate investigations or review fan-out for research notes. Limit requested excerpts and final reports. Do not run builds/full test suites for documentation-only research. Check usage again at a meaningful phase boundary only if further model-heavy work is planned.

## Locations and safety of scope

Bisellium: `/home/edckt/projects/bisellium`.
epoch0: `/home/edckt/projects/epoch0` (reference only).
Yan Mo: `/home/edckt/projects/Yan Mo` (reference only).

Node/npm/git run in WSL. Read AGENTS.md and current session handoff before orchestration; boot the applicable role after context reset. Preserve pre-existing untracked W-101, QA actum and worktrees. No push, merge, workflow rewrite or application code change is part of this research pass.

## Current handover - W-103

This section supersedes earlier progress descriptions. Work is isolated in branch `codex/maps-lookup-experiment`, worktree `/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment`. Saved checkpoint commit: `b9ed56d`; regression-test commit: `55a30e6`. Read [the detailed checkpoint](W-103/CHECKPOINT.md) in that worktree before resuming.

### Completed and evidence limits

- Integration analysis, proposed navigation contract and 15 exploratory cases across Bisellium, epoch0 and Yan Mo are saved. All 22 curated references passed input preflight. These are exploratory cases, not independent holdouts.
- W-103 has a signed brief. A replacement bounded lookup harness was built after rejecting the initial prototype and its inadequate red evidence. Genuine restart reds preceded implementation.
- Both search and routed-source modes ran all 15 cases. Results are provisional: no semantic quality, context sufficiency or billed-usage saving has been demonstrated. The epoch0 board exceeds the signed file-size cap and is explicitly rejected where encountered.
- Reverse exclusion-alias handling was corrected with a genuine regression red. The earlier candidate passed 33 targeted tests and the repository verifier; these results do not certify the subsequent failing regression tests or resolve the review findings.
- Independent Sol-high censor round 1 returned FAIL: `studio/ci/W-103-review-1.log`. W-103 remains building, not done.

### Outstanding blockers

1. Canonical exclusion normalization performs metadata operations before enforcing or charging directory/candidate budgets. Correct the undercount expectation in regression 6 while retaining alias protection.
2. Excerpt file and character limits reset per repository; the signed contract requires one shared output budget across every repository in a case.

Genuine assertion-level reds for both findings were recorded before fixes in `studio/ci/reds/W-103/07.log` and `08.log`, committed at `55a30e6`. The fixes have not been implemented. The current targeted suite intentionally fails; do not recreate the reds or claim the previous green results as current acceptance.

### Next steps after authorized resumption

1. Dispatch one bounded builder-sol session to fix only these two findings using the existing reds and signed brief. Root orchestrates; it does not write implementation, tests or verdicts.
2. Rerun the targeted tests and both comparison modes; refresh reports and counters from actual output. Run the required full verifier against the resulting source tree.
3. Obtain fresh Terra pre-review and independent Sol-high censor review round 2. Record evidence and lifecycle changes through the owning Bisellium CLI. No completion without PASS.
4. Only then assess whether the experiment supports a bounded production proposal; broader quality and context-sufficiency evaluation remains outstanding.

### Usage, authorization and preservation

The last account reading was 98% weekly usage consumed, 2% remaining, reaching the Patron's stop threshold. This is the saved reading, not a new usage check. Further model-heavy work remains paused; this handover update does not resume implementation. No reset credit was redeemed.

The Patron explicitly approved the W-103 full brief/source/tests/report transfer to scoped OpenAI Codex CLI sessions, including Terra pre-review and Sol-high censor; those reviews executed. The earlier approval blocker is resolved. Built-in agent slots were exhausted; bounded CLI role sessions were the fallback. Do not request the same scoped approval again solely because older notes describe it as pending.

No push, merge or reference-project edits occurred. Preserve the root workspace's pre-existing W-101, QA actum and other worktrees. epoch0 and Yan Mo remain read-only reference projects; MAPS integration belongs inside Bisellium. No further broad research is needed before resolving the two concrete findings.
