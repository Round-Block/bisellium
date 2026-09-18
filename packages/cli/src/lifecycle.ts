/**
 * packages/cli/src/lifecycle.ts — moved to @bisellium/commands (same pattern
 * as writes.ts, W-016). One-line subpath re-export shim so every existing
 * "./lifecycle.js" import in this directory (main.ts, the test) keeps
 * working unchanged.
 */
export * from "@bisellium/commands/lifecycle.js";
