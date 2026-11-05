/**
 * apps/server/src/ladder.ts — W-300: the data the Board drawer's step line reads (W-500's Runs screen reads the same), and
 * the queue in front of the injected read. One read runs at a time, a request for an opus already waiting shares that
 * answer, and a full queue answers `unavailable` at once. The read itself is injected by packages/cli/src/serve.ts; this
 * package imports no CLI module.
 */
export type LadderRead =
  | {
      id: string;
      read: "ok";
      /** `next`'s rung, as `next` names it. */
      step: string;
      status: "named" | "held" | "complete";
      /** Who acts next; `patron` is the only actor the drawer colours. */
      actor: string;
      why: string;
      /** The rung's round (a dispatch order's, or the review record's), or null where the rung has none. */
      round: number | null;
      /** The text after `health: ` in `next`'s report. */
      health: string;
      /** Where the rung names a PR; `url` is null when its repository is not a plain `owner/name`. */
      pr: { number: number; url: string | null } | null;
    }
  | { id: string; read: "unavailable"; why: string }
  /** A done or halted opus: no read runs. */
  | { id: string; read: "not-in-flight" };

/** One read running and this many waiting; past that, `unavailable` at once. */
export const LADDER_WAITING = 8;

export function ladderQueue(read: (id: string) => Promise<LadderRead>, waiting: number = LADDER_WAITING): (id: string) => Promise<LadderRead> {
  const pending = new Map<string, Promise<LadderRead>>();
  let tail: Promise<unknown> = Promise.resolve();
  return (id) => {
    const joined = pending.get(id);
    if (joined !== undefined) return joined;
    if (pending.size > waiting) return Promise.resolve({ id, read: "unavailable", why: "too many step reads are waiting" });
    const run = tail
      .then(() => read(id))
      .catch((e: unknown): LadderRead => ({ id, read: "unavailable", why: e instanceof Error ? e.message : String(e) }))
      .finally(() => pending.delete(id));
    pending.set(id, run);
    tail = run;
    return run;
  };
}
