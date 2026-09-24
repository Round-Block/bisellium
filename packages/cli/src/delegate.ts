/**
 * packages/cli/src/delegate.ts — moved to @bisellium/commands (same pattern
 * as writes.ts/usage.ts/talk.ts — W-016). One-line subpath re-export shim so
 * main.ts's "./delegate.js" import keeps working unchanged.
 */
export * from "@bisellium/commands/delegate.js";
