import type { Lifecycle } from "@gantry/schema";

/**
 * epoch0 declares TWO lifecycles in one project.
 *
 * Sources of truth (read 2026-09-10):
 *  - docs/program/WORKFLOW.md §3 Train Lifecycle + BOARD.md states
 *    (backlogged/validated/scheduled/done/rejected; in-train is DERIVED,
 *    never stored — computed from `git worktree list` + `gh pr list`)
 *  - docs/art/ART_WORKFLOW.md §4 Lifecycle and state transitions
 */

export const trainLifecycle: Lifecycle = {
  id: "epoch0-train",
  states: [
    { id: "backlogged", name: "Backlogged", phase: "backlog" },
    { id: "validated", name: "Validated", phase: "backlog" },
    { id: "scheduled", name: "Scheduled", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "qa-ci-gate", name: "QA / CI gate", phase: "verifying" },
    { id: "final-review", name: "Final review", phase: "awaiting_review" },
    { id: "done", name: "Merged", phase: "done" },
    { id: "rejected", name: "Rejected (duplicate)", phase: "done" },
  ],
  transitions: [
    { from: "backlogged", to: "scheduled" },
    { from: "validated", to: "scheduled" },
    { from: "scheduled", to: "building" },
    { from: "building", to: "qa-ci-gate" },
    { from: "qa-ci-gate", to: "building" }, // fix loop
    { from: "qa-ci-gate", to: "final-review" },
    { from: "final-review", to: "building" }, // FAIL → fix loop
    { from: "final-review", to: "done" },
    { from: "scheduled", to: "rejected" },
  ],
  gates: [
    { id: "pytest", name: "Serial test suite", kind: "automated", requiredForState: "final-review" },
    { id: "gdscript", name: "GDScript scenarios", kind: "automated", requiredForState: "final-review" },
    { id: "sim", name: "Balance sim", kind: "automated", requiredForState: "final-review" },
    { id: "qa-verdict", name: "QA verdict (sol)", kind: "agent", requiredForState: "final-review" },
    { id: "final-review", name: "Consolidated final review (sol)", kind: "agent", requiredForState: "done" },
    { id: "owner-decision", name: "Owner decision", kind: "human" }, // hard stops only
  ],
  // WORKFLOW.md §7.4: 2 concurrent non-art work streams (the art lane is
  // separate and uncapped by this number).
  wipLimit: 2,
};

export const artLifecycle: Lifecycle = {
  id: "epoch0-art-batch",
  states: [
    { id: "queued", name: "Queued", phase: "backlog" },
    { id: "briefed", name: "Briefed", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "accepted", name: "Accepted (Astra)", phase: "verifying" },
    { id: "validating", name: "Validating (V1)", phase: "awaiting_review" },
    { id: "delivered", name: "Delivered", phase: "done" },
    { id: "integrated", name: "Integrated", phase: "done" },
    { id: "parked", name: "Parked", phase: "halted" },
    { id: "rejected", name: "Rejected", phase: "done" },
    { id: "superseded", name: "Superseded", phase: "done" },
  ],
  transitions: [
    { from: "queued", to: "briefed" },
    { from: "briefed", to: "building" },
    { from: "building", to: "verifying" },
    { from: "verifying", to: "building" }, // repair rounds (capped: 1 + 2)
    { from: "verifying", to: "accepted" },
    { from: "accepted", to: "validating" },
    { from: "validating", to: "verifying" }, // RETURN
    { from: "validating", to: "delivered" },
    { from: "delivered", to: "integrated" },
  ],
  gates: [
    { id: "v0-intake", name: "V0 intake (consumer contract)", kind: "agent", requiredForState: "building" },
    { id: "evidence", name: "Evidence contract (§6 checks)", kind: "automated", requiredForState: "accepted" },
    { id: "acceptance", name: "Astra acceptance", kind: "agent", requiredForState: "validating" },
    { id: "v1-validation", name: "Controller V1 validation", kind: "agent", requiredForState: "delivered" },
    // Note: NO human gate — taste gates became consultation digests
    // (ART_WORKFLOW §1/§8, owner ruling 2026-09-10). Owner "asks" arrive as
    // threads only when the answer changes a material direction.
  ],
};

export const lifecycles = [trainLifecycle, artLifecycle];
