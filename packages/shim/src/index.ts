/**
 * @bisellium/shim — worktree seam + run receipts (W-008).
 */
export type { AcquiredWorktree, WorktreeProvider, ReclaimResult } from "./worktree.js";
export { gitWorktreeProvider, treehouseProvider, selectProvider, reclaimWorktrees } from "./worktree.js";
export type { Receipt } from "./receipts.js";
export { makeSessionId, receiptPath, writeReceiptStart, writeReceiptEnd } from "./receipts.js";
export { redact, filterEnv } from "./redact.js";
export { sourceTreeHash, isDirtyOutside } from "./sourceTree.js";
export type { HarnessProfile, HarnessStartOpts, HarnessResumeOpts, Turn, TurnUsage } from "./harness/index.js";
export {
  USAGE_LIMIT_EXIT_CODE,
  HARNESS_PROFILES,
  resolveHarness,
  claudeCodeProfile,
  codexProfile,
  gitOnlyProfile,
  fakeProfile,
} from "./harness/index.js";
