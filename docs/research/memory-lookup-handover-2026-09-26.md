# Memory and source lookup: research handover

Date: 2026-09-26. Owner: producer. Scope: research and retrieval experiment; no production lookup feature has been implemented.

## Purpose and authority

Reduce repeated discovery and unnecessary model context while preserving Bisellium's existing workflow. Repository files remain authoritative; this document records findings and proposals, not new policy. The Patron requested this handover first, then a source-lookup test, using the cheapest effective approach.

## What we examined

1. Existing GitHub controls and CI/workflow gaps. Required-check app bindings, required checks and branch cleanup were inspected earlier. Those are reliability improvements, separate from memory. This handover does not re-verify live GitHub settings or authorize further changes.
2. Persistent Codex role dispatch, now on the local `codex/persistent-workflow` branch. Roles/configuration and the prospective D-014 amendments preserve separate drafting, implementation and independent review. Current mapping: Astra medium producer/architect; Sol builder/security; Terra pre-review; Sol high censor; Luna clerk. Read the actual role/configuration files before dispatch. Historical evidence retains the model that produced it.
3. The public [MAPS guide](https://github.com/pavrus117/ai-os-maps-guide), researched by Terra medium. It proposes source signposts, a second machine, scheduled routines and a dashboard. It supplies guidance rather than a ready-to-install memory implementation. Its reported token reduction is one personal comparison, not a reliable prediction of Bisellium savings.
4. Bisellium's existing `context` and `query` implementations, examined by a bounded Sol audit, plus deterministic baseline measurements. These already operate over the repository; a new memory database is not a prerequisite.

## Improvements worth using

| Improvement | Fit for Bisellium | Next action |
| --- | --- | --- |
| Short source signposts | Route questions to existing task, brief, evidence, role and policy files | Test five curated routes before implementing general lookup |
| Task-specific context | Avoid loading unrelated work and long retrospective bodies | Reuse successful lookup routes in a later context proposal |
| Source provenance and freshness | Show checkout branch/SHA and distinguish recorded handoff from current lifecycle | Include in the retrieval experiment |
| Link validation | Detect missing or moved source references | Confirm returned paths exist; later consider a deterministic check |
| Deterministic preflight | Find mechanical problems before model review | Reuse current checks and evidence; measure gaps before adding checks |
| Bounded routines | Explicit run/time/model budgets and logs can limit unattended cost | Assess existing tick/budget/usage behavior before adding anything |
| Read-only operational views | Render existing facts with freshness information | Preserve current console/dossier source ownership; defer another dashboard |

Defer VPS synchronization, phone bots, visual memory graphs, embeddings/vector storage and a second task or policy store. They add maintenance without evidence that they solve our immediate lookup problem.

The source-navigation and bounded-routine ideas are adapted from the guide's [Memory](https://github.com/pavrus117/ai-os-maps-guide#card-1-memory) and [Pulse](https://github.com/pavrus117/ai-os-maps-guide#card-3-pulse) sections; the prioritization above is our assessment.

## Measured baseline

Snapshot: 2026-09-26T14:14:37.853Z. Raw measurements: [lookup-baseline-2026-09-26.json](lookup-baseline-2026-09-26.json). Estimated tokens are characters divided by four, rounded up; they are not billed usage.

| Context seat | Requested budget | Estimated output tokens | Dropped sections |
| --- | ---: | ---: | --- |
| producer | 1000 | 709 | decisions |
| producer | 4000 | 1457 | none |
| builder-sol | 1000 | 848 | decisions, collegium index |
| builder-sol | 4000 | 3517 | decisions |
| qa-lead | 1000 | 997 | decisions, collegium index |
| qa-lead | 4000 | 1790 | none |

All six outputs omit the D-014 source path. Context generation took 24-51 ms in this sample. These timings exclude agent reasoning and are not a performance benchmark.

Existing query outcomes:

- `status W-102`: answers with lifecycle and gate links, but also prints an earlier next-step handoff despite the task now being done.
- `where is the current censor model defined`: unknown.
- `where is the spec and review evidence for W-089`: unknown.
- `what is blocked on me`: answers with P-012.

## Existing implementation and gaps

- `packages/commands/src/context.ts`: role lex and standing rules, active work, petitions, collegium index, recent acta and providers. It drops whole sections to meet its budget. Recent decisions come from recent acta, not the governing `studio/decisions/` records. There is no task-specific source bundle.
- `packages/commands/src/query.ts`: three recognized question shapes: needs-you, task status and burn. Status includes gate paths, but does not explain whether a stored handoff is stale. Neither command reports checkout provenance.
- `docs/SESSION-HANDOFF.md`: current mapping coexists with substantial history. A reader needs the source and amendment context, not a heuristic that treats the last paragraph or every decision file as historical.
- `.codex/agents/censor.toml`, `studio/bisellium.yml` and `studio/decisions/D-014.md` answer different parts of the same policy question: dispatch settings, studio binding and governing authority. Cross-check them; report conflicts rather than silently selecting one.

## Source-lookup experiment

This is a curated retrieval test, not a shipped CLI feature or a general search benchmark. The candidate commands `lookup task W-089` and `lookup policy censor` are design examples only; they do not exist yet.

Evaluate:

1. What model and effort does the current censor use?
2. Where are W-089's brief and review evidence?
3. Is W-102's recorded handoff still an actionable next step?
4. Which amendment governs the censor despite older Astra/Opus prose?
5. Which checkout does the answer describe?

For each, record source paths and lines, answer correctness, ambiguity, links checked, files opened and snippet size where available. Prefer direct paths and bounded excerpts. Do not read whole evidence logs merely to locate them. Report curated-route results separately from the existing query baseline; they perform different work. No subscription savings percentage can be inferred from this small test.

Success means all five answers point to valid sources, expose relevant historical/current distinctions, and disclose checkout provenance. A later feature proposal should address arbitrary tasks, missing links, conflicting sources and path containment before implementation. Keep the existing spec/build/review gates for that feature.

## Cost and continuation

Reuse the completed research and baseline. Use one bounded lower-tier source audit plus ordinary file/Git operations for this experiment. No new external search, broad repo scan, parallel duplicate review or automatic implementation cascade is needed for the research deliverables.

Do not disturb pre-existing W-101, the QA daily actum or other worktrees. Do not push or merge as part of this task. Completed experiment: [source-lookup-test-2026-09-26.md](source-lookup-test-2026-09-26.md). The key additional requirement is checkout-aware lookup: W-089 evidence exists in its opus worktree despite absent root links. The first retrieval pass also exposed excessive excerpt size; production lookup should enforce a cap.

## Superseded cross-project framing (historical)

**Scope correction:** the Patron clarified that MAPS-inspired capabilities must be integrated into Bisellium, which then operates on epoch0 and Yan Mo. The standalone lookup-workspace proposal below is superseded. Follow [the corrected investigation handover](bisellium-maps-investigation-handover.md).

Patron direction, 2026-09-26: widen the study to epoch0 and Yan Mo; consider a separate project. Confirmed local roots:

- Bisellium: `/home/edckt/projects/bisellium`
- epoch0: `/home/edckt/projects/epoch0`
- Yan Mo: `/home/edckt/projects/Yan Mo`

Recommendation: a separate research workspace owning evaluation questions, source-routing configuration, measurements and eventually a portable lookup prototype. It should read the three repositories without rewriting their documentation, importing one project's workflow into another, or becoming the authority for their facts. No separate workspace or Codex task has yet been created.

Initial entry-point inspection, not a full project audit:

| Case | Observed structure | What it tests |
| --- | --- | --- |
| Bisellium | Structured opera, gate evidence, decisions, role TOMLs and worktrees | Task/evidence lookup, amendment handling and checkout identity |
| epoch0 | AGENTS points to program WORKFLOW; explicit implementation/migration/test/document precedence for game behavior; separate program and handoff records | Domain-specific authority, temporal workflow rules and code-versus-document claims |
| Yan Mo | CLAUDE document map distinguishes CANON, CONTENT, METHOD, PLAN and LOG; README points into that corpus | Narrative/design lookup and distinguishing committed canon from plans and session notes |

Treat project status statements as dated claims until checked against their named sources. In particular, a README or time-limited contingency paragraph is not enough to infer current project status or active model routing. These inspections establish navigation structure only.

### First shared evaluation

Use five question families per repository (15 cases total): current status/next action; governing workflow or policy; authoritative design/behavior source; supporting implementation/test/review evidence; historical or conflicting claim. Tailor the actual questions and expected sources to each project rather than forcing Bisellium task IDs or gate concepts onto the games.

Freeze each question and expected source references before comparing approaches. Start with existing project navigation plus ordinary path/text search. Compare that with a small curated source map. Only add a generated index or semantic retrieval if this baseline exposes a concrete failure that justifies it.

Record answer/source correctness, inability to answer, checkout SHA and dirty-state scope, links followed, files opened, excerpt characters, and tool calls. Record elapsed time and actual model usage only where available; do not translate characters into subscription savings. Separate one-time map creation/maintenance cost from per-question lookup cost. Include at least one moved/missing reference or conflicting-source case in the eventual repeatable evaluation.

Keep the portable result contract small: repository/checkout, source path and section, bounded excerpt, authority category defined by that project, and freshness/conflict caveats. Do not make a universal precedence rule such as code always wins: implementation, desired design, narrative canon and operational policy answer different questions.

### Cost and implementation boundary

Reuse Bisellium's measurements and use deterministic discovery first. Batch bounded research on the other projects; use a lower model for source finding and reserve orchestration judgment for ambiguous authority. Do not automatically apply Bisellium's entire implementation cascade to a standalone research experiment. Any eventual change inside a source repository must follow that repository's applicable workflow.

Next concrete deliverable for the separate project: a 15-question evaluation manifest with verified expected source links and baseline results, followed by a decision on whether a portable lookup tool is worthwhile. Broader research is authorized; creation of the separate workspace remains a proposal in this handover. No source-project code or policy was changed by this scoping pass.
