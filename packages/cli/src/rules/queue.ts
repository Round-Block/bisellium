/**
 * packages/cli/src/rules/queue.ts — W-333: `queue.shape`, block. The officina's `queue.yml` (the engineering and UI
 * queues, their lanes and ranked entries, and the halted, cut and deferred lists) is judged by the one reader
 * `next --all` reads it with (`readQueue`, queue.ts): each problem is one finding. Inert while the file is absent.
 * Seam S2: `root` is the OFFICINA; reads only; never throws.
 */
import type { Finding, RuleOpts } from "../check.js";
import { QUEUE_FILE, readQueue } from "../queue.js";

export function checkQueue(root: string, _opts: RuleOpts): Finding[] {
  const read = readQueue(root);
  return read.kind === "held" ? read.problems.map((message) => ({ rule: "queue.shape", level: "block", where: QUEUE_FILE, message })) : [];
}
