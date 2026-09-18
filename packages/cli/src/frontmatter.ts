/**
 * packages/cli/src/frontmatter.ts — moved to @bisellium/commands (W-016, cascade-4
 * review: the cli/server dependency cycle). This file is a one-line
 * subpath re-export shim so every existing "./frontmatter.js" import in this
 * directory (main.ts, other cli modules, tests) keeps working unchanged.
 */
export * from "@bisellium/commands/frontmatter.js";
