# Step 1: Bisellium managed-project integration

Date: 2026-09-26. Status: bounded read-only source audit complete. Research finding, not an implementation or review gate. Governing scope: [investigation handover](bisellium-maps-investigation-handover.md).

## Conclusion

Bisellium already has a per-project adapter interface. MAPS-inspired source navigation should be investigated as a Bisellium capability using or extending that interface, not as an independent system installed on epoch0 or Yan Mo. Existing adapters expose workflow snapshots, not general source retrieval. The existing epoch0 adapter is a scaffold, not a working adoption.

## Integration map

| Concern | Existing mechanism | Source |
| --- | --- | --- |
| Studio to repository | `run` accepts studio and repo arguments; without repo, resolves Git top-level from studio | `packages/commands/src/run.ts:68-75,101-136`; `docs/ADOPTION.md:628-639` |
| Worktrees | Git provider receives repo; worktrees under its `.bisellium/worktrees` | `packages/shim/src/worktree.ts:13-18,53-76` |
| Studio configuration | Workflow, routing, exclusions and integration settings; no repo binding field in inspected manifest interface | `adapters/native/src/index.ts:49-105`; `studio/bisellium.yml:32-45` |
| Certificate scope | `source_excludes` omits sibling-studio/fixture churn from source hash; it is not a source map | `docs/ADOPTION.md:584-612` |
| Task references | Native snapshot reads opera; gate evidence exposes href/certifies; acta can carry evidence links | `adapters/native/src/index.ts:255-287,306-318` |
| Startup context | Deterministic single-studio context with lex, rules, task/handoff, petitions, index, recent acta and providers | `packages/commands/src/context.ts:62-79,93-195` |
| Query | Three question shapes; status returns recorded evidence and handoff. Index refresh is studio ingestion, not external source lookup | `packages/commands/src/query.ts:20-31,75-97,159-237` |
| Project observation | AdapterBase has projectId/lifecycles; SnapshotAdapter supplies snapshot | `packages/schema/src/index.ts:271-302` |
| epoch0 integration | Declares intended board/journal/art sources, but snapshot returns empty sellae/opera and send is unimplemented | `adapters/epoch0/src/index.ts:4-38` |
| Document registry | Scans root README/GLOSSARY and top-level docs markdown, writes `.bisellium/registry.json`; not an external retrieval map | `packages/cli/src/docs.ts:43-78,124-146` |

## Gaps and unknowns

No general source-navigation contract, source-level freshness/conflict result or checkout identity in context/query was found in the inspected interfaces. Gate source certificates are useful existing evidence, but are not document-level freshness guarantees.

No central managed-repository registry or persisted studio-to-many-repositories map was found in the inspected manifest and command surfaces. This is a scoped finding, not an exhaustive absence proof. `docs/STUDIO.md:124-137` explicitly leaves one-studio-per-project versus portfolio operation open. Subsequent Patron clarification: multi-project/multi-repository management is REQUIRED. The source text is an older open question; the precise studio/configuration topology remains to design.

The epoch0 adapter comments describe intended source surfaces; this audit did not check the external files or claim they are currently usable. Yan Mo integration was not established. Source authority and stable entry points for both reference projects remain Step 3 verification work.

## Implications for Step 2

- Reuse adapter project identity and invocation-level repository resolution as candidate integration points.
- Specify a read-only source-reference capability alongside workflow snapshots; do not assume every adapter must implement it or alter Snapshot prematurely.
- Preserve native task/spec/evidence references as first-class inputs.
- Let bounded context/query consume retrieval results; retain project-specific authority rules and disclose checkout scope.
- Keep each individual result scoped to an explicitly selected project/repository, and include cross-project queries in the evaluation. Multi-project support is required; a new central registry format is not presumed necessary.
- Do not build the whole epoch0 workflow adapter merely to test a source-navigation contract. A labeled research fixture can isolate the proposed capability.

## Method, cost and limits

One Terra-low read-only audit. Producer spot-checked the adapter interface, epoch0 stub and open multi-project design question. No code, studio records or reference projects edited; no builds or model-based duplicate reviews. This report relies on source inspection, not an end-to-end managed-project run. Source line references describe the current local checkout and can move.

Next: draft the minimum contract and an evaluation shape using these extension points. No production schema/API decision is signed here.
