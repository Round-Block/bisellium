import type { Snapshot, SnapshotAdapter } from "@bisellium/schema";
import { lifecycles } from "./lifecycles.js";

/**
 * epoch0 snapshot adapter — reads the repo's own state surfaces; writes nothing.
 *
 * Sources (build order):
 *  1. docs/program/BOARD.md         → WorkItems (trains) in stored states
 *  2. `git worktree list` + `gh pr list` → derives in-train states + PR meta
 *     (WORKFLOW.md: "in-train is never stored — it is a DERIVED state")
 *  3. .claude/skills/journal/tasks/task-<slug>/ → gate logs (gate-<sha>.log),
 *     review rounds (reviews/<n>-PASS|FAIL.md), QA verdicts → GateResults
 *     with evidence identity (the SHA in the filename) → `stale` computable
 *  4. docs/art/ART_LEDGER.md        → WorkItems (art batches)
 *  5. docs/art/ART_USAGE.md         → Provider telemetry (observed pools)
 *  6. docs/art/evidence/index.md    → DigestEntries (owner-facing digest)
 */
export function createEpoch0Adapter(repoRoot: string): SnapshotAdapter {
  return {
    style: "snapshot",
    projectId: "epoch0",
    intervalMs: 10_000,
    describeLifecycles: () => lifecycles,

    async snapshot(): Promise<Snapshot> {
      // TODO(build-order-3): parse the surfaces listed above.
      void repoRoot;
      return { actors: [], workItems: [] };
    },

    async send(target, message) {
      // Snapshot source degradation path (dossier: adapter contract):
      // write into the train journal's Handoff/inbox so the Controller
      // absorbs it at its next read ("redirects absorbed as re-planning").
      void target;
      void message;
      return { delivered: false, note: "not implemented — inbox-file degradation planned" };
    },
  };
}
