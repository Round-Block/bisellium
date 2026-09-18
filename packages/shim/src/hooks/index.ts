/**
 * @bisellium/shim/hooks — barrel for the harness-hooks profile (W-015).
 */
export { CLAUDE_CODE_HOOK_NAMES, claudeCodeHooksBlock } from "./claude-code.js";
export type { ClaudeCodeHooksOpts, ClaudeCodeHooksBlock } from "./claude-code.js";
export { readJsonFromStream } from "./stdin.js";
export type { ReadPayloadResult } from "./stdin.js";
export { hookReceiptStatuses, HOOK_HARNESS_ID, HOOK_DEAD_RECENT_RECEIPTS } from "./receiptStatus.js";
export type { HookReceiptStatus, ReceiptSummary } from "./receiptStatus.js";
