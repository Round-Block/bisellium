/**
 * packages/commands/src/red-tree.ts — W-645 (mechanism×red-certifies-wrong-tree): why a red's output fails in the tree it
 * ran in rather than at its behaviour. `red` records nothing for such an output, and a prototyped brief's spec signature
 * refuses a cited red log that holds one (`redReplayProblems`). Text in, a reason or undefined out.
 */

/** Why `output` (a red command's stdout and stderr) certifies the tree rather than the behaviour, or undefined: it carries
 *  `ERR_MODULE_NOT_FOUND` anywhere (a failing row's own message included). A row that tests these patterns must not print
 *  them, or its own red is refused. */
export function wrongTreeRed(output: string): string | undefined {
  if (output.includes("ERR_MODULE_NOT_FOUND")) return "names a module that did not load (Node's module-not-found error): the red fails in the tree, not at the behaviour";
  return undefined;
}
