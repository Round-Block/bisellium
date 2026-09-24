/**
 * @bisellium/shim — worktree seam + run receipts (W-008).
 */
export type { AcquiredWorktree, WorktreeProvider, ReclaimResult } from "./worktree.js";
export { gitWorktreeProvider, treehouseProvider, selectProvider, reclaimWorktrees } from "./worktree.js";
export type { Receipt } from "./receipts.js";
export { makeSessionId, receiptPath, writeReceiptStart, writeReceiptEnd } from "./receipts.js";
export { redact, filterEnv } from "./redact.js";
export { sourceTreeHash, isDirtyOutside } from "./sourceTree.js";
export type { HarnessProfile, HarnessStartOpts, HarnessResumeOpts, Turn, TurnUsage, ListedModel } from "./harness/index.js";
export {
  USAGE_LIMIT_EXIT_CODE,
  DEFAULT_HARNESS,
  HARNESS_PROFILES,
  resolveHarness,
  claudeCodeProfile,
  codexProfile,
  gitOnlyProfile,
  fakeProfile,
  codexListModels,
  harnessVersions,
} from "./harness/index.js";
export { CLAUDE_CODE_HOOK_NAMES, claudeCodeHooksBlock, readJsonFromStream, hookReceiptStatuses, HOOK_HARNESS_ID, HOOK_DEAD_RECENT_RECEIPTS } from "./hooks/index.js";
export type { ClaudeCodeHooksOpts, ClaudeCodeHooksBlock, ReadPayloadResult, HookReceiptStatus, ReceiptSummary } from "./hooks/index.js";
