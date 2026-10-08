---
id: "2026-10-08-meta-retro"
title: "Meta-retro: did the retro fixes work, and where does the effort go (proposal)"
kind: consultation
author: qa-lead
at: 2026-10-08T10:54:20Z
---
Asked by the Patron, 2026-10-08. Drafted by Codex `gpt-5.6-sol` (read-only) over a dataset built by kept scripts
(`~/.bisellium-evidence/meta-retro/`: `gather.mjs`, `codex-tokens.sh`, `prompt.md`, `session.log`); checked by the producer.
Producer notes: recommendation 7 is already met by PR 330 (a Haiku subagent republishes; the full read is the publish
tool's rule, not ours). The post-D-046 comparison rests on three opera. Recommendations are proposals; none is filed
or greenlit until the Patron slots them with the queue review (W-169 is where they would run).

## Headline

Most landed fixes stopped their exact lesson class, but five missed because they were advisory, narrower than the class, or recorded rather than prevented the failure. The required retro is working prospectively: seven retros produced 20 lessons, all with fixes; however, 60 older lessons still lack `addressed_by`. Effort is dominated by review loops: 4.464M recorded Codex tokens went to build review, while pre-build spec review reduced build-review rounds from 2.76 to 1.67 per opus in a small three-opus sample. The next savings come from stopping specification churn after three rounds, closing defect classes at one boundary, and eliminating receipt re-mints and bookkeeping.

## A. Retro fixes

| Class | Fix | Fix done? | Recurred after? | Verdict (worked / missed: why / too early to tell) |
|---|---|---:|---|---|
| Red certifies wrong tree | W-166 (ordered, tree-correct reds) | No; greenlit | Not applicable | Too early to tell |
| Census misses ordinary bindings | W-163 (safe-helper census) | Yes | No later lesson | Worked |
| Impossible dates normalize | W-163 (strict date parser) | Yes | No later lesson | Worked |
| Evidence absent or backfilled | `opus.red_content` (red-content rule), then W-120 (kill-clause proof) | Yes | L-062 (missing evidence) after the rule; none after W-120 | Missed initially: rule covered bad red content, not absent proof; later fix has held |
| Malformed records patched per site | W-161 (input-domain table) and W-162 (enforced spec review) | Yes | L-086 (loose table parser), L-087 (duplicate seat declarations) | Missed: partial; the enforcing parsers themselves still failed open |
| Unattainable guarantee found late | W-162 (enforced spec review) | Yes | No exact-class recurrence | Too early: adjacent promise defects drove five and seven spec reviews |
| Mechanical work by hand | D-005 (script repeatable transforms) | Yes | L-002 (three hand-maintained copies) | Missed: a prose rule was not mechanically enforced |
| Path traversal from identifiers | `path.id.unvalidated` (identifier containment rule) | Yes | No | Worked |
| Strict date parser rejects low years | W-163 (strict date parser) | Yes | No later lesson | Worked |
| Unredacted tracked writes | D-009 (redact at every write boundary) | Yes | No dated later lesson | Worked in observed data |
| Incomplete write-failure contract | W-137 (required retro command) | Yes | No later lesson | Worked |
| Symlink-parent write escape | W-163 (safe file helpers) | Yes | L-084 (two exempt reads), filed after completion but found before landing | Worked after its own review correction |
| Missing or unenforceable input domain | W-167 (review-round control) | Yes | No independent later lesson | Too early to tell |
| Promise impossible under accepted domain | W-167 (review-round control) | Yes | No independent later lesson | Too early to tell |
| Prose contradiction under revision | W-082 (record spec review) | Yes | L-064 (later contradictory spec) | Missed: wrong place; it recorded recurrence but did not prevent it |
| Stale numeric citations | W-084 (behaviour-citation check) | Yes | No | Worked |
| Derived subject reverses meaning | W-076 (required human subject) | Yes | No | Worked |
| Ruled case lacks a test | W-164 (zero-sum completion test) | No; backlog | No | Too early to tell |
| Security boundary cases uncovered | W-120 (boundary-test additions) | Yes | No | Worked |
| Tests agree with the bug | D-010 (tautology warning and mutation step) | Yes | L-067 (tests still agreed with bug) | Missed: advisory and mutation practice were not enforced |

**Unfixed lessons.** These are the 60 without `addressed_by`:

L-001 (missing evidence); L-002 (hand edit); L-003 (shared checkout); L-004 (path identifiers); L-005 (unsafe tracked write); L-006 (bad orchestrator spec); L-007 (bug-agreeing tests); L-008 (backfilled evidence); L-010 (shared checkout); L-011 (path identifiers); L-012 (unsafe tracked write); L-015 (no lifecycle verb); L-016 (immutable review path); L-017 (missing evidence); L-018 (false red from environment filtering); L-019 (wrong-tree red); L-020 (insurance-rule misfire); L-023 (self-certified close); L-024 (dispatch before brief); L-025 (stale round numbering); L-026 (stale architecture graph); L-027 (usage omitted); L-028 (missing handoff); L-029 (mutation skipped); L-030 (vendor spend unmetered); L-031 (jobs not reaped); L-032 (wire field misused); L-033 (assertion passes for wrong cause); L-034 (one-sided bound); L-035 (sleep hides missing seam); L-039 (sandbox proxy evidence); L-040 (behaviour unpinned); L-041 (insurance-rule misfire); L-042 (self-signed spec); L-043 (duplicate containment helper); L-044 (duplicate source of truth); L-045 (local-only identifier allocation); L-046 (scattered identity normalization); L-047 (served bundle not rebuilt); L-048 (unenforced measurement); L-049 (security boundary found after review); L-050 (sleep hides missing seam); L-051 (unactionable failure); L-052 (file-ownership overrun); L-053 (duplicate source of truth); L-054 (validation order masks errors); L-055 (evidence-prune collision); L-056 (post-image-only classification); L-057 (wrong-tree red); L-058 (dirty replay environment); L-059 (served bundle not rebuilt); L-060 (behaviour unpinned); L-061 (insurance-rule misfire); L-062 (missing evidence); L-063 (symlink escape); L-064 (contradictory revised spec); L-065 (undocumented runtime dependency); L-066 (one-sided bound); L-067 (bug-agreeing tests); L-068 (sleep hides missing seam).

All 60 remain live `lesson.unfixed` advisories under D-039 (required retro and fixes). Fifteen already share a class with a later named fix; 45 lessons across 36 classes have no class-level fix in the ledger. Proposed fix for each: file one migration opus that proves and stamps the existing enforcing rule, decision, or completed opus; when proof fails, it files a scoped fix, after which `lesson.unfixed` becomes blocking.

**D-039 (required retro and fixes) kill condition.** Not triggered by recorded evidence: seven retros produced 20 lessons and eight fix targets, while the fixes consumed multi-round builds and reviews. But the judgment is not auditable because retro-triage and orchestration tokens are not separately recorded; the data supports “no”, not a precise cost ratio.

## B. Efficiency

| Sink | Evidence (numbers) | Cause |
|---|---|---|
| Build review and fix loops | 67 Codex sessions, 4,463,877 tokens. Before D-046 (pre-build spec review): 58 review logs over 21 opera, 2.76 each; after: 5 over 3, 1.67 each. | Defect classes were patched one site per round; W-153 (completion estimate) repeated malformed-input findings through rounds 1–5. |
| Specification review churn | 22 sessions, 994,712 tokens. W-166 (tree-correct reds): 14 logs = 7 reviews; W-167 (round control): 10 logs = 5 reviews. | Broad promises, incomplete input domains, mismatched manifest sources, and feasibility limits were discovered serially. |
| Drafting and re-specification | Three recorded drafts cost 722,712 tokens: W-162 (spec-review enforcement) 116,819; W-166 (tree-correct reds) 402,192; W-167 (round control) 203,701. | Scope was still being discovered in review; W-162 was split only after three failed spec reviews. |
| Receipts, full suites, and re-mints | About 15 minutes per receipt; W-120 (kill-clause enforcement) reached a fourth receipt, and W-163 (safe helpers) had a failed first receipt. | Records landed while review awaited merge, forcing rebases; receipts were minted before the stable merge result. |
| Orchestration and publication | W-141 (automated ladder git steps) measured 16 record-only PRs at about eight commands each: roughly 128 manual commands. Publishing a page pair reads about 135k tokens; orchestration tokens are otherwise unmetered. | Git, records, checkpoints, and publishing remain separate stateful passes with repeated reads and collision windows. |

## Recommendations

1. Extend the three-round hold to spec review: change `next` so round four requires split or Patron ruling. W-166 (tree-correct reds) and W-167 (round control) had six reviews beyond round three; at their 57k-token mean, expected saving is about 344k tokens.
2. Keep D-046 (pre-build spec review), but make each input-table row executable: a `spec.input_boundary` check must resolve the named rejector and a malformed fixture before signature. The observed saving baseline is 1.09 build-review rounds per opus, from 2.76 to 1.67.
3. Add `review.class_closed`: after a class blocker, the next packet must show one boundary check and a census of every instance. W-153 (completion estimate) spent five rounds on one fail-open class; expected saving is up to four re-reviews on a similar opus.
4. Finish W-168 (CI merge-result certificate) and make `next` mint once from the merge result. The measured avoidable cost is at least four extra mints across W-120 (kill-clause enforcement) and W-163 (safe helpers), about 60 minutes.
5. Add a `next` verb hold that queues records-only changes while an opus is between passing review and merge. It removes the rebase class that caused W-120 (kill-clause enforcement) to mint a fourth receipt: at least 15 minutes per collision.
6. File an opus titled “Reconcile the historical lesson ledger and block future unfixed lessons.” Its migration resolves 60 advisories and audits the 36 classes with no named fix.
7. Replace checkpoint rereading with one render-and-publish verb over generated artifacts. Expected saving: about 135k tokens per published page pair.
8. Build W-122 (per-phase source-reading measurement). Claim no direct saving yet; it fills the current zero-event measurement for retro and orchestration cost and makes D-039 (required retro and fixes) testable.

## Limits of this data

Claude spend in history rows is estimated prose, not usage events; orchestration and retro-triage usage are not separated. Codex “runs” count surviving session logs, not review rounds, and missing evidence directories make them lower bounds. Lesson timestamps are filing times, so a finding discovered before landing can appear after the fix’s done time. The post-D-046 (pre-build spec review) comparison has only three completed opera. W-122 (per-phase source-reading measurement), the instrument needed for exact source-reading and retro-cost attribution, remains unbuilt.