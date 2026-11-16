/**
 * packages/commands/src/red-tree.ts — W-645 (mechanism×red-certifies-wrong-tree): why a red's output fails in the tree it
 * ran in rather than at its behaviour. `red` records nothing for such an output, and a prototyped brief's spec signature
 * refuses a cited red log that holds one (`redReplayProblems`). Text in, a reason or undefined out.
 * The served harness (`apps/web/tests-serve/harness.ts`, `board.spec.ts`) names each server start (`servedAttempt`),
 * prints `servedStart` before it spawns and `servedLine` once that attempt has read its server's port and token; this
 * module is where those lines' text lives, so the writers and the reader share one source.
 */

/** How many served attempts this process has named (`servedAttempt`). */
let attempts = 0;

/** A served attempt's name, fresh per call and unique across the run's worker processes: `<pid>.<count>`. */
export function servedAttempt(): string {
  attempts++;
  return `${process.pid}.${attempts}`;
}

/** The line a served attempt prints before it spawns its `bisellium serve` child. */
export function servedStart(attempt: string): string {
  return `bisellium serve: attempt ${attempt} starting`;
}

/** The line a served attempt prints once its `bisellium serve` child has printed both its port and its write-auth token.
 *  The token itself is never printed. */
export function servedLine(port: number, attempt: string): string {
  return `bisellium serve: attempt ${attempt} listening on port ${port}, write-auth token read`;
}

/** `servedStart`'s and `servedLine`'s forms, each on a line of its own, any leading whitespace (a wrapped run's message is
 *  indented); the attempt is group 1. */
const SERVED_START = /^[ \t]*bisellium serve: attempt (\d+\.\d+) starting[ \t]*\r?$/gm;
const SERVED_READY = /^[ \t]*bisellium serve: attempt (\d+\.\d+) listening on port \d+, write-auth token read[ \t]*\r?$/gm;
/** A served spec's location, as Playwright's list reporter (relative) and a stack frame (absolute) print it: `tests-serve/`,
 *  any number of `/`-terminated segments of any characters but `/` (a space, a colon, a coordinate-shaped `:<line>:<col>`, a parenthesis,
 *  a non-ASCII letter, a line break), and a final `<name>.<spec|test>.<[cm][jt]s[x]>:<line>:<col>` anchored at the location's end:
 *  end of line, `)` (a parenthesised frame) or ` › ` (the list reporter's next column). The coordinate is the rightmost one before
 *  a terminator and the path is everything from `tests-serve/` to it: a coordinate-shaped run inside the path is stem text, so
 *  `a.ts:3:1.spec.ts:7:2` is one spec, and a helper's frame (`helper.ts:12:5 in w900.spec.ts:3:1`) is one served spec too (fail
 *  closed). A path not ending in the spec suffix is no served location. */
const SERVED_SPEC = /(?:^|[\s/])(tests-serve\/(?:[^/]+\/)*[^/]+?\.(?:spec|test)\.[cm]?[jt]sx?:\d+:\d+)(?=[ \t]*\r?$|\)| › )/m;
/** The served harness's startup failure, as `startServed` and `board.spec.ts` word it: `serve exited (<code>) before printing port/token`. */
const SERVE_EXITED = /(?<![\p{L}\p{M}\p{N}_])serve exited \([^)\r\n]*\) before printing port\/token(?![\p{L}\p{M}\p{N}_])/u;

/** Why `output` (a red command's stdout and stderr) certifies the tree rather than the behaviour, or undefined: in this
 *  order, it carries `ERR_MODULE_NOT_FOUND` anywhere (a failing row's own message included); it carries the harness's
 *  `serve exited (<code>) before printing port/token`; it names a served spec and no served attempt's start line; it names
 *  a served spec and an attempt that printed its start and no `servedLine` of its own (the first such, in order). Any other
 *  output is undefined. A row that tests these patterns must not print them, or its own red is refused. */
export function wrongTreeRed(output: string): string | undefined {
  if (output.includes("ERR_MODULE_NOT_FOUND")) return "names a module that did not load (Node's module-not-found error): the red fails in the tree, not at the behaviour";
  if (SERVE_EXITED.test(output)) return 'carries the served harness\'s exit line (its server exited before printing a port and token): the served row\'s server never started';
  const served = SERVED_SPEC.exec(output);
  if (served === null) return undefined;
  const started = [...output.matchAll(SERVED_START)].map((m) => m[1]!);
  const ready = new Set([...output.matchAll(SERVED_READY)].map((m) => m[1]!));
  if (started.length === 0)
    return `names a served spec (${served[1]}) and no served attempt's start and port and token lines ("${servedStart("<id>")}", "${servedLine(0, "<id>").replace("port 0", "port <n>")}"): the served row never read its server's port and token`;
  const unready = started.find((attempt) => !ready.has(attempt));
  if (unready !== undefined)
    return `names a served spec (${served[1]}), and served attempt ${unready} printed its start and no port and token line: that attempt's server never read its port and token`;
  return undefined;
}
