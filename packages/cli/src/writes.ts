/**
 * packages/cli/src/writes.ts — moved to @bisellium/commands (W-016, cascade-4
 * review: the cli/server dependency cycle). This file is a one-line
 * subpath re-export shim so every existing "./writes.js" import in this
 * directory (main.ts, other cli modules, tests) keeps working unchanged.
 */
export * from "@bisellium/commands/writes.js";
