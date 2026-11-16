/**
 * packages/commands/src/red-tree.ts — W-645 (mechanism×red-certifies-wrong-tree): why a red's output fails in the tree it
 * ran in rather than at its behaviour. `red` records nothing for such an output, and a prototyped brief's spec signature
 * refuses a cited red log that holds one (`redReplayProblems`). Text in, a reason or undefined out.
 */

/** The served harness's startup failure, as `startServed` and `board.spec.ts` word it: `serve exited (<code>) before printing port/token`. */
const SERVE_EXITED = /(?<![\p{L}\p{M}\p{N}_])serve exited \([^)\r\n]*\) before printing port\/token(?![\p{L}\p{M}\p{N}_])/u;

/** Why `output` (a red command's stdout and stderr) certifies the tree rather than the behaviour, or undefined: it carries
 *  `ERR_MODULE_NOT_FOUND` anywhere (a failing row's own message included); it carries the harness's
 *  `serve exited (<code>) before printing port/token`. A row that tests these patterns must not print
 *  them, or its own red is refused. */
export function wrongTreeRed(output: string): string | undefined {
  if (output.includes("ERR_MODULE_NOT_FOUND")) return "names a module that did not load (Node's module-not-found error): the red fails in the tree, not at the behaviour";
  if (SERVE_EXITED.test(output)) return 'carries the served harness\'s exit line (its server exited before printing a port and token): the served row\'s server never started';
  return undefined;
}
