/**
 * packages/cli/src/usage.ts — subpath re-export shim for @bisellium/commands
 * (same pattern as verify.ts/talk.ts/context.ts — W-016) so main.ts's
 * "./usage.js" import keeps working unchanged.
 */
export * from "@bisellium/commands/usage.js";
