/**
 * packages/commands/src/presign-gate.ts — W-563 (presign-meet-1109 call 1, D-189; ladder-time-meet-1111 call 2): the cheap
 * gates a spec signature owes.
 *
 * `gateRows` names, from a git tree and its base, the rows the architect's signature owes: the officina check, typecheck,
 * one `reads` row per test file the series adds, and one `test` row per test file the series adds or changes and per test
 * file that directly imports a touched path. `runGate` (the runner, `node --import tsx <this file>`) runs them pooled in a
 * clean scratch worktree at the series' own tree, each under a timeout, within a budget (a row not started by then is
 * logged `deferred`, deferred to `ci --opus`), and always writes the log; `gateLogProblems` is `verdict --phase spec`'s
 * reading of that log: it runs nothing, it checks the log is the runner's at the prototype's tree with every owed row
 * passed or deferred.
 *
 * ponytail: the walk is one textual import edge deep. A transitive importer, a test that spawns or names a touched file, a
 * non-literal dynamic import and a playwright or vitest spec under apps/ or docs/ are no rows; `ci --opus` stays the full judge.
 */
export interface GateRow {
  kind: "check" | "typecheck" | "test" | "reads";
  file?: string;
  command: string;
}
/** W-563 red stub: no rows yet. */
export function gateRows(_repo: string, _base: string, _tree: string): GateRow[] | { error: string } {
  return [];
}
