/**
 * packages/cli/src/probe.ts — moved to @bisellium/commands (same pattern as
 * delegate.ts/usage.ts/talk.ts — W-016). One-line subpath re-export shim so
 * main.ts's "./probe.js" import keeps working unchanged.
 */
export * from "@bisellium/commands/probe.js";
