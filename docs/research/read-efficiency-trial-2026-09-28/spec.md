# Existing-read observation: 2026-09-28

Status: provisional observation protocol, not an opus specification or a signed gate. No opus ID assigned; no implementation or completion claim.

## Intent

Measure delivered UTF-8 text bytes for three fixed, known-file questions using existing whole-file and targeted line reads. Observe one cold pass and one identical repeated pass. This is a convenience sample, not a retrieval benchmark or an account-usage estimate.

## Scope classification

This turn observes existing shell commands only. It creates no measurement program, product change, receipt protocol, cache or new consumer. Keep the exact commands and raw outputs contemporaneously as evidence. AGENTS.md and engineering lex §2 still require mechanical work to be scripted and retained: retain the actual shell command sequence used, rather than reconstructing it afterward. A command transcript is not permission to implement new parsing, measurement or validation logic. The producer dispatches execution separately; architect does not execute or judge results.

There is no explicit research exemption from builder, recorded-red or review requirements for new implementation. If a new measurement program, behavior, test harness or product contract is needed, stop this observation and use a scoped opus with the normal design, test-first, builder and censor gates. Existing commands have no newly implemented behavior requiring a manufactured red. This observation does not claim a passed review gate or a completed opus.

## Files owned

Architect: this spec only. Executor may retain commands, raw stdout/stderr and a short results note in this directory. No source-document edits; no studio bookkeeping writes. Preserve all other changes.

## Interfaces

Work in WSL at the repository root. Use existing `cat`, `grep -n`, `sed -n`, `wc -c`, `sha256sum` and `date`; no installs or new dependencies. Record tool availability and failures. These three paths are supplied equally to both approaches; global file discovery is not tested.

| Case and fixed question | Required exact section | End boundary (excluded) |
|---|---|---|
| `docs/ADOPTION.md`: How is the source-tree certificate calculated, what is excluded, and when are staleness checks active? | `## The SOURCE tree hash` | `## Running run and verify` |
| `studio/leges/design.md`: What makes an opus ready to enter building? | `## 1. Mandate` | `## 2. Decides alone` |
| `studio/leges/engineering.md`: What are the recorded-red, mechanical-work and builder-isolation requirements? | `## 2. Decides alone` | `## 3. Digests` |

Required spans are the complete original UTF-8 sections, including their headings, all paragraphs/bullets, whitespace and trailing blank lines before the end boundary. No summaries substitute for these spans.

## Behaviours to observe

1. Record source hashes before reading. For each pass and case, baseline delivers a path/location header plus the entire file using `cat`.
2. Targeted delivers a path header and the complete output of `grep -n '^## ' <path>` as its discovery step. Use the observed start and next-section line numbers with `sed -n '<start>,<end-minus-one>p' <path>`. Deliver a path/range header and the unmodified excerpt. Do not hardcode previously supplied line numbers or silently discard discovery output.
3. Preserve exactly what would be delivered in separate raw text artifacts for every pass/case/approach; count them with `wc -c`. The executor must actually inspect/deliver the full packets without tool truncation. If tool limits prevent that, report the artifacts as candidate payload sizes rather than actual model-visible delivery.
4. Repeat the same whole-file and discovery-plus-excerpt reads, including bodies and discovery overhead. No remembered locations or hash-only response. Repeated targeted body bytes must equal their first-pass body bytes for unchanged sources.
5. Check the full required sections against baseline text, not just answer keywords. Record source hashes afterward; any changed source invalidates its paired comparison. Preserve failures and fallback output and charge those bytes to the affected approach.

## Acceptance

Report a three-row per-pass table: baseline bytes, targeted discovery/location bytes, targeted body bytes, targeted total and required-span result. Report sums for cold, repeat and both passes, with savings `(baseline - targeted) / baseline`. Separately disclose common measurement/report/tool-wrapper overhead and any unmeasured transport envelope; do not call payload-only counts complete API token usage. Report actual repeated body bytes; they are not zero.

Evidence is sufficient only with unchanged source hashes, complete untruncated packets, exact required-span preservation and a contemporaneous command/output record. Lower targeted total supports using these existing reads for these questions only. Zero or negative savings, missing spans or truncation are findings, not reasons to revise cases after observing results. No independent review verdict is implied.

## Out of scope

Production changes; receipt/residency handling; repeat suppression; compaction; stale-cache recovery; cross-project isolation; arbitrary question answering; semantic ranking; model answer quality; subscription savings; timing performance claims. A hash verifies unchanged bytes, not retained agent knowledge.
