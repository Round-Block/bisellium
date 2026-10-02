# Bisellium read-efficiency plan

**Outcome (2026-09-29): targeted-read implementation evaluated; NO adoption.** See [final report](read-efficiency-evaluation-2026-09-28/run-v1-2026-09-29/report.md). The proposal below is historical; repeat suppression remains unimplemented.

2026-09-28. Proposed implementation direction, not an approved opus or measured usage saving.

## Decision

Reduce the amount of source text delivered to agents before investing in another ranking experiment. Keep this capability inside Bisellium, serving separate managed projects such as epoch0 and Yan Mo. The completed MAPS heuristic study remains a scoped no-go; this plan does not reopen it.

## Immediate work

Archive the historical tail of SESSION-HANDOFF.md, retaining current instructions and a link to history. Before the archive, history occupied 26,130 of 32,976 characters (79.2%). The retained archival script verifies preservation. This reduces that document's routine read volume, not necessarily account usage by the same percentage.

Use existing role-scoped context and compact structured studio queries before opening full files. Current context defaults to 4,000 estimated tokens, drops whole lower-priority sections, and reports truncation. Indexed queries answer only needs_you, status, and burn; they are not arbitrary source retrieval.

## Smallest useful implementation

1. Define a bounded source-read contract: project/repository/worktree identity, relative path, content hash, section or line range, and an explicit output budget. Return compact locations first; expand requested source sections on demand. Oversized documents must permit bounded section reads instead of whole-file exclusion.
2. Add a consumer receipt tied to an agent context generation. It records exact source sections already delivered. An unchanged body may be omitted only when the consumer confirms it remains available in its current context. A fresh agent, compaction, missing receipt, or changed section requires rehydration. A persisted hash is not retained knowledge.
3. Reuse the current context renderer's prioritization for studio context. Defer semantic retrieval, vector databases, and automatic long summaries until measured failures require them. Do not assume the current index's project_id provides project isolation: its query path currently does not filter on it.
4. Keep independent review independent: reviewers can fetch original evidence, with their own receipts. A builder's summary does not replace review of relevant source.

The first slice should cover one source-document path through this contract, including a large-document case. Broader context integration follows only if that slice passes. Exact CLI/API shapes belong to the architect's signed specification; none are invented here.

## Decisive, inexpensive checks

Use deterministic fixtures and a recorded red; no model-labelled question benchmark.

- Repeated unchanged read with a valid resident receipt: no repeated body, only a compact reference.
- One section changed: return its current content and invalidate its old receipt; unchanged resident sections need no repeated body.
- Cold or compacted context: return requested bodies even if a disk cache exists.
- Identical paths in different projects/worktrees: no cross-project receipt reuse.
- Oversized document: requested bounded section remains available; omissions and limits are explicit.
- Deleted, renamed, stale, or mismatched sources: explicit refresh/failure, never silent reuse.
- A complete scripted task with required source spans: no missing required spans compared with direct reads.

Record actual model-visible bytes delivered, repeated body bytes, first-read and update overhead, omissions/fallbacks, and elapsed time. Proposed acceptance: zero repeated body bytes for unchanged resident reads, exact required-span preservation, and lower total delivered bytes over the scripted repeated-read task including receipt overhead. Report cold-start overhead separately. These are proxy measurements; subscription savings require later observed usage, not a conversion from bytes.

## Delivery order and stop rule

This turn: document the direction and shorten the mandatory handover. No production implementation is started.

Next cascade: bounded architect specification using this plan and the existing context/query code; implementation through the builder, following the repository's separate role and test-first requirements, with Sol-high censor as the sole review gate. Keep briefs narrow and use low-cost roles for mechanical work. Persist exact commands and evidence from the start.

Stop or simplify if receipt overhead erases savings, required source spans are lost, or the active harness cannot reliably signal context residency. In the latter case, ship bounded targeted reads alone; do not simulate memory with stale hashes.

## Code basis

Read-only inventory: packages/commands/src/context.ts (budget and section rendering); packages/commands/src/query.ts (fixed questions and reconciliation); packages/core/src/store.ts (snapshots); packages/core/src/index-db.ts (project_id schema). Existing disk-side snapshots do not by themselves reduce model-visible source text.
