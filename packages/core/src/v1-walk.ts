/**
 * packages/core/src/v1-walk.ts — W-576: End state v1's walk as one table. `WALK` holds the nine steps (S1..S9), each with
 * its owners (the keep-list opera whose sub-steps the step's served case runs, in order) and its pending owners (those
 * whose sub-step is not real yet). The served spec (apps/web/tests-serve/v1-walk.spec.ts) marks a case as an expected
 * failure exactly while `isPending` says so, and k, the number of steps green, is `walkScore`'s. No imports at all, so
 * the bundle, the server, the served spec, the count reader (scripts/v1-walk-count.ts) and a node row all load it.
 *
 * The owner's edit (the seam between W-576 and each kept opus): in one commit the owner makes its sub-step's body real,
 * switches that sub-step's assertions from `pend(` to `expect(`, replaces a placeholder selector with the one it ships
 * and removes its id from its row's `pending`; it changes no other row and no other sub-step. The last S5 owner also
 * sets `barOpus` and commits the bar script's output for that opus. See studio/briefs/W-576.md.
 */

export const STEPS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"] as const;
export type Step = (typeof STEPS)[number];

export interface WalkRow {
  step: Step;
  title: string;
  owners: readonly string[];
  pending: readonly string[];
  /** S5 only, once its row is empty: the done non-ui opus the bar script (scripts/s5-bar.ts, W-308's) re-reads. */
  barOpus?: string;
}

/** The S5 bar script's answer: met for one opus, breached naming the value, or not run naming why. */
export type BarResult = { ok: true; opus: string } | { ok: false; breached: string } | { ok: false; notRun: string };

export const WALK: readonly WalkRow[] = [
  { step: "S1", title: "S1: open the console and land on its first screen", owners: [], pending: [] },
  {
    step: "S2",
    title: "S2: see the work: each lane's in-flight opus, the Needs you count, what is stuck",
    owners: ["W-503", "W-555"],
    pending: ["W-503", "W-555"],
  },
  {
    step: "S3",
    title: "S3: decline or hold an opus from the console, and the write lands on master",
    owners: ["W-074", "W-301"],
    pending: ["W-074", "W-301"],
  },
  {
    step: "S4",
    title: "S4: answer every wait in one signed Inbox (k does not close v1 while a keep-list opus is open)",
    owners: ["W-666", "W-668", "W-667", "W-157", "W-546"],
    pending: ["W-668", "W-667", "W-157", "W-546"],
  },
  {
    step: "S5",
    title: "S5: approved work runs to done by itself, fast",
    owners: ["W-673", "W-697", "W-372", "W-557", "W-308"],
    pending: ["W-697", "W-372", "W-557", "W-308"],
  },
  { step: "S6", title: "S6: watch a build without a reload", owners: ["W-308"], pending: ["W-308"] },
  { step: "S7", title: "S7: see it finished on Home's Completion row", owners: ["W-503", "W-504"], pending: ["W-503", "W-504"] },
  { step: "S8", title: "S8: proof: S2..S7 in one served session, every write on master", owners: [], pending: [] },
  { step: "S9", title: "S9: adopter: init, file one opus, serve it", owners: ["W-284", "W-051"], pending: ["W-284", "W-051"] },
];

const DERIVED_FROM: readonly Step[] = ["S2", "S3", "S4", "S5", "S6", "S7"];

/** Whether a step's case is pending: its own pending list is non-empty; S8 while any of S2..S7 is. */
export function isPending(step: Step, walk: readonly WalkRow[] = WALK): boolean {
  if (step === "S8") return DERIVED_FROM.some((s) => isPending(s, walk));
  return (walk.find((r) => r.step === step)?.pending.length ?? 0) > 0;
}
