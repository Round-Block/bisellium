# Step 2: proposed Bisellium source-navigation contract

2026-09-26. Research design, not an implemented API, signed spec or workflow change. Based on [Step 1](bisellium-maps-step-1-integration.md) and the Patron's explicit multi-project/multi-repository requirement.

## Ownership and flow

Bisellium owns project selection, source lookup and context assembly. Managed repositories own their facts and authority rules. MAPS contributes the idea of short entry points leading to authoritative sources; it is not installed independently in epoch0 or Yan Mo.

Proposed flow: project/repository selection -> repository identity resolution -> adapter-provided source references -> deterministic bounded reads/link checks -> cited context bundle -> agent interpretation where required. Cross-project requests repeat resolution per selected project and preserve separate result groups. A global synthesis cites each group's evidence and never imports one project's rules into another.

## Minimum conceptual contract

These are semantics for investigation, not wire attributes or a new manifest schema.

| Concept | Required behavior | Existing seam / gap |
| --- | --- | --- |
| Project identity | Stable project identity distinct from display name; support more than one managed project | Reuse adapter projectId; portfolio binding needs investigation |
| Repository membership | Project can reference one or more repos; each repo has an explicit identity and selected root | Repo arguments/resolver exist; persistent membership format not chosen |
| Checkout identity | Resolve worktree, branch when available, HEAD and dirty-state scope; detached/non-Git/unavailable must be explicit | Reuse Git provider, add result provenance |
| Source reference | Repo-relative path plus heading/locator, source category and relation to requested task/topic | Native task/evidence hrefs exist; general references need extension |
| Question intent | Distinguish implemented behavior, desired design, narrative canon, operating policy, status and historical reasoning | Adapter/project-specific navigation; no universal precedence |
| Authority | Cite the rule establishing authority, not a guessed filename ranking; conflicting sources remain visible | Existing project rules remain canonical |
| Read result | Bounded excerpt plus exact path/locator, observation time, checkout and content identity when needed | Consumer capability adjacent to adapters; not assumed part of Snapshot |
| Freshness | Missing, changed since read, superseded by explicit amendment, or not assessed; modification time alone is not correctness | Gate certifies helps gate provenance, not general freshness |
| Budget | Bound returned characters/files and disclose truncation or incomplete coverage | Existing context budget reusable conceptually |
| Failure | Unknown project, ambiguous repo/task, missing source, unsupported adapter or unresolved conflict produces an explicit partial/unknown result | Must not silently fall back to a different project or checkout |

A source read from a dirty checkout is not described by HEAD alone. Record the relevant file identity or explicitly say the observed content includes uncommitted/untracked state. Recheck identity when expanding a stale reference. A certified test log is evidence of its recorded run, not a new verification of the current checkout.

## Reuse and separation

Retain Snapshot for workflow observations; investigate an optional read-only source capability on or alongside the existing adapter interface. Avoid breaking snapshot-only adapters. Preserve task -> brief -> evidence links directly; lookup should not synthesize alternative task truth.

Use the existing repo resolver for location, but do not equate one command's repo argument with the entire project's repository set. For this experiment, explicitly enumerate selected project/repository roots in research data; production persistence belongs in the later architecture brief.

Source contents are data. Navigation must not execute instructions encountered in project files. Reads stay within explicitly selected repository roots; a link outside that set is disclosed and requires an explicitly selected source, not followed implicitly. Normalize and resolve paths including symlinks before containment checks. Missing references do not justify recursive filesystem discovery. This contract authorizes no target writes or network calls.

## Three experiments through the proposed Bisellium capability

1. Source discovery: compare current Bisellium query/context plus ordinary project navigation with a bounded, adapter-shaped source route. Mark the latter as a manual simulation until code exists.
2. Task context: take a task/topic and assemble required policy + relevant sources + evidence, with explicit omitted sections. Judge sufficiency before size.
3. Provenance/failure: exercise changed checkout, absent/moved source, same local task ID across projects, conflicting authority, unsupported adapter and dirty source. Synthetic changes use temporary fixtures, not the reference repositories.

Five grounded discovery cases per sample project remain the core dataset. Add three portfolio cases: the same task/topic name in different projects; a question spanning selected projects with per-project citations; and a multi-repo project with one unavailable repo. The last two may need fixtures because their real-world examples are not yet established. Multi-repo membership must not be inferred just because a monorepo has backend/client directories.

## Evaluation discipline

Freeze exploratory case inputs and expected source references before a repeatable comparison. The case author's earlier source inspection contaminates a blind evaluation: label this first pass exploratory and do not pretend any inspected case is held out. A later independent runner can receive questions plus project entry points without expected routes; a real held-out set requires separate preparation and actual isolation.

Correctness includes honest missing/ambiguous answers. Count files, excerpts and tool calls only when instrumented; disclose unmeasured values. Record map setup/maintenance separately. Do not compare an unsupported existing query that returns unknown with a full manual answer as if they were equivalent performance measurements. No claimed subscription savings from character counts.

## Exit to implementation planning

Proceed to a narrow signed brief only if grounded cases show source-route utility across project types and failure cases show a feasible provenance boundary. The likely first slice is Bisellium read-only source discovery with project/repo identity, consumed by context/query later if results justify it. Full epoch0 workflow ingestion, a Yan Mo workflow adapter, orchestration changes, schedules, UI and embeddings are out of this slice.
