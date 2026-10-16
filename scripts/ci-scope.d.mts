/** W-243: the declarations `packages/cli` imports through; the record list and the diff reader live in ci-scope.mjs. */
export function recordOnly(paths: readonly string[], studio?: string): boolean;
export function diffPaths(cwd: string, base: string, head: string): string[] | undefined;
