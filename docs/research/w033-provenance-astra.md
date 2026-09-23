# W-033 provenance — independent take, gpt-6-astra, 2026-09-23

One of two adjudicated independent rulings (the other is the Opus architect's D-021). Produced read-only; escalation-tier assignment per D-020 as amended.

- Level: L1 scheduled
- Stops starting at posture: closeout

## 7. Evidence contract

Every spec carries: the opus id it specs, the six sections above, and the
`spec:` front-matter path on the opus it belongs to, set before the opus
moves to `building`.

## 9. Amendment log

| Date | Change | Authority |
|---|---|---|
| 2026-09-18 | Adopted; Design collegium established (W-018) | Patron |
| 2026-09-19 | Architecture doc kept current per cascade; module graph script-generated (check rule ships with W-023) | Patron |
--- end ---

## Standing rules
- Test-first with a recorded red.
- Mechanical work is a script you write, run and keep.
- Evidence is produced, never backfilled.
- Before structural screen changes, verify against the dossier's touchpoint mapping.

## Design index
W-041 · backlog · generated backlog page: the slate rendered from the officina, never from prose
tokens: 668

codex
1. **Ruling.** The opus branch owns the **entire in-flight opus record**, including state, handoff, reviews, certificates, and their committed evidence. Master owns the filed baseline and, after integration, the accepted record. This is a split by lifecycle phase, never by field. The reviewer produces and records the verdict in an isolated worktree based on the opus branch; that original evidence joins the same branch before its PR lands. Separate bookkeeping PRs must not update an in-flight opus. GitHub’s PR requirement establishes the route to master, not ownership: two PRs can still carry competing records. This ruling extends the branch-ref contract already established in [merge](/home/edckt/projects/bisellium/packages/cli/src/branch.ts:87).

2. **Precise invariant.** For opus `O`, let `B = refs/heads/opus/O`. From activation of `B` until its integration or explicit retirement, `B` is the sole publication authority for `O`’s record and evidence. Worktree changes are pending contributions to `B`; they are not a second authority. Master’s copy remains the last accepted snapshot. Every decision about the candidate being shipped reads its record, evidence, source tree, and hash exclusions from the **same resolved candidate commit**. Missing branch data is an error, never permission to consult another checkout.

   `state: done` means the branch’s work has satisfied its gates; it does not transfer authority to master. Integration through the PR does that. A stale branch left after integration does not retain ownership.

3. **Concrete enforcement.** Implement both early refusal and a required integration check:

   - **One write-target guard.** Before any opus mutation or evidence-producing subprocess, resolve the worktree containing `--studio`, its repository, the owning branch, and the expected branch tip. Apply it to `greenlight`, `ready`, `review`, `done`, `halt`, `handoff`, `red`, `verify`, and `ci --opus`, including their underlying callable paths. Refuse master, another opus’s branch, and mismatched source/bookkeeping worktrees. Today, [openStudio](/home/edckt/projects/bisellium/packages/commands/src/writes.ts:126) resolves a directory; [review](/home/edckt/projects/bisellium/packages/commands/src/lifecycle.ts:318) writes into that directory without establishing ownership.

   - **Explicit reviewer contribution.** Permit an isolated reviewer worktree bound to `B` and its captured tip, including detached HEAD. Record the reviewed source hash and original review evidence there. Commit the reviewer’s result and advance `B` through ordinary git, fast-forward only while its expected tip is unchanged. If it moved, refuse publication and reassess the intervening changes. Do not rerun `review` elsewhere merely to reproduce its front matter. Isolation separates actors; it need not create a competing destination.

   - **Blocking `process.opus_provenance` rule in required PR CI.** Compare trusted PR head/base refs. Changes to an existing `opera/O.md` or its evidence namespace must arrive through `opus/O`; reject an unrelated cleanup/review PR touching them. Apply this consistently to existing records, avoiding dependence on a clone’s incomplete list of active branches. Allow initial filing PRs to introduce backlog records without execution evidence; subsequent changes use the owning branch. Fetch the necessary refs/history explicitly and fail closed if unavailable.

   - **Candidate validation at integration.** Required CI must validate the incoming opus even when its state is `done`: check gates, evidence, and certificate freshness against the candidate’s source tree. Existing historical done records remain historical. Reuse that validator in `merge`, resolving and rereading the candidate after any rebase. A local CLI refusal alone cannot protect raw `gh pr merge`.

   These are proposed behaviors, not claims about existing enforcement. They add refusals where provenance matters; staging, committing, pushing, and PR merging remain raw git/gh, consistent with D-016.

4. **What it kills.** It eliminates the structural conflict where master acquires a review while the opus branch acquires lifecycle changes and certificates for the same record. Therefore it retires “take master’s copy, then rerun greenlight/ready/verify/handoff” as routine reconciliation. It also prevents unrelated PRs from quietly replacing an active opus’s truth.

   It does not eliminate source conflicts, concurrent contributions to the same branch, or genuine re-verification after a rebase changes source. Existing divergent records need a one-time migration preserving original evidence. Missing evidence must be produced honestly. The ignored, checkout-local event log cannot become authoritative merely by declaration.

5. **Strongest objection.** Master becomes an incomplete operational board: an active opus can still look like backlog there, while branch ownership complicates dashboards, recovery, and reviewer coordination. Master-authoritative bookkeeping offers one obvious place to look.

   I overrule that objection because every master update here requires another PR, while review evidence originates on the candidate branch. Master authority introduces cross-PR ordering and synchronization between approval, certificates, and the artifact they describe—the problem already costing reconciliation rounds. Provide a read-only board that resolves owning branches and labels their refs and freshness. Pay the complexity in discovery, where stale information can be explicit, rather than in competing writes to the evidence record.
1. **Ruling.** The opus branch owns the **entire in-flight opus record**, including state, handoff, reviews, certificates, and their committed evidence. Master owns the filed baseline and, after integration, the accepted record. This is a split by lifecycle phase, never by field. The reviewer produces and records the verdict in an isolated worktree based on the opus branch; that original evidence joins the same branch before its PR lands. Separate bookkeeping PRs must not update an in-flight opus. GitHub’s PR requirement establishes the route to master, not ownership: two PRs can still carry competing records. This ruling extends the branch-ref contract already established in [merge](/home/edckt/projects/bisellium/packages/cli/src/branch.ts:87).

2. **Precise invariant.** For opus `O`, let `B = refs/heads/opus/O`. From activation of `B` until its integration or explicit retirement, `B` is the sole publication authority for `O`’s record and evidence. Worktree changes are pending contributions to `B`; they are not a second authority. Master’s copy remains the last accepted snapshot. Every decision about the candidate being shipped reads its record, evidence, source tree, and hash exclusions from the **same resolved candidate commit**. Missing branch data is an error, never permission to consult another checkout.

   `state: done` means the branch’s work has satisfied its gates; it does not transfer authority to master. Integration through the PR does that. A stale branch left after integration does not retain ownership.

3. **Concrete enforcement.** Implement both early refusal and a required integration check:

   - **One write-target guard.** Before any opus mutation or evidence-producing subprocess, resolve the worktree containing `--studio`, its repository, the owning branch, and the expected branch tip. Apply it to `greenlight`, `ready`, `review`, `done`, `halt`, `handoff`, `red`, `verify`, and `ci --opus`, including their underlying callable paths. Refuse master, another opus’s branch, and mismatched source/bookkeeping worktrees. Today, [openStudio](/home/edckt/projects/bisellium/packages/commands/src/writes.ts:126) resolves a directory; [review](/home/edckt/projects/bisellium/packages/commands/src/lifecycle.ts:318) writes into that directory without establishing ownership.

   - **Explicit reviewer contribution.** Permit an isolated reviewer worktree bound to `B` and its captured tip, including detached HEAD. Record the reviewed source hash and original review evidence there. Commit the reviewer’s result and advance `B` through ordinary git, fast-forward only while its expected tip is unchanged. If it moved, refuse publication and reassess the intervening changes. Do not rerun `review` elsewhere merely to reproduce its front matter. Isolation separates actors; it need not create a competing destination.

   - **Blocking `process.opus_provenance` rule in required PR CI.** Compare trusted PR head/base refs. Changes to an existing `opera/O.md` or its evidence namespace must arrive through `opus/O`; reject an unrelated cleanup/review PR touching them. Apply this consistently to existing records, avoiding dependence on a clone’s incomplete list of active branches. Allow initial filing PRs to introduce backlog records without execution evidence; subsequent changes use the owning branch. Fetch the necessary refs/history explicitly and fail closed if unavailable.

   - **Candidate validation at integration.** Required CI must validate the incoming opus even when its state is `done`: check gates, evidence, and certificate freshness against the candidate’s source tree. Existing historical done records remain historical. Reuse that validator in `merge`, resolving and rereading the candidate after any rebase. A local CLI refusal alone cannot protect raw `gh pr merge`.

   These are proposed behaviors, not claims about existing enforcement. They add refusals where provenance matters; staging, committing, pushing, and PR merging remain raw git/gh, consistent with D-016.

4. **What it kills.** It eliminates the structural conflict where master acquires a review while the opus branch acquires lifecycle changes and certificates for the same record. Therefore it retires “take master’s copy, then rerun greenlight/ready/verify/handoff” as routine reconciliation. It also prevents unrelated PRs from quietly replacing an active opus’s truth.

   It does not eliminate source conflicts, concurrent contributions to the same branch, or genuine re-verification after a rebase changes source. Existing divergent records need a one-time migration preserving original evidence. Missing evidence must be produced honestly. The ignored, checkout-local event log cannot become authoritative merely by declaration.

5. **Strongest objection.** Master becomes an incomplete operational board: an active opus can still look like backlog there, while branch ownership complicates dashboards, recovery, and reviewer coordination. Master-authoritative bookkeeping offers one obvious place to look.

   I overrule that objection because every master update here requires another PR, while review evidence originates on the candidate branch. Master authority introduces cross-PR ordering and synchronization between approval, certificates, and the artifact they describe—the problem already costing reconciliation rounds. Provide a read-only board that resolves owning branches and labels their refs and freshness. Pay the complexity in discovery, where stale information can be explicit, rather than in competing writes to the evidence record.

