/**
 * packages/cli/src/ci.ts — moved to @bisellium/commands (same pattern as
 * verify.ts/run.ts/lifecycle.ts, W-016/W-020). One-line subpath re-export
 * shim so "./ci.js" keeps working for main.ts and the test.
 */
export * from "@bisellium/commands/ci.js";
