/**
 * apps/web/src/lib/screenState.ts — W-341 (D-088 F, D-090 B). The console's one states matrix: the seven named
 * states, which of the four screens serves each (and why a screen cannot reach the rest), and the one status a
 * screen reports to the shell's live region. Pure: no React, no fetch, no DOM.
 */

export const SCREEN_STATES = ["loading", "empty", "error", "refused", "stale", "live", "pending"] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

export const SCREENS = ["inbox", "board", "seats", "officina"] as const;
export type Screen = (typeof SCREENS)[number];

/** A served cell carries the copy the screen shows and announces; a cell the screen cannot reach carries the reason. */
export type Cell = { copy: string } | { na: string };

const READ_ONLY = "read-only screen: it sends no write, so nothing can be refused or pending";
const NO_FEED = "no live feed: the screen reads once when it opens; only the Board subscribes to /api/live";

export const STATES_MATRIX: Readonly<Record<Screen, Readonly<Record<ScreenState, Cell>>>> = {
  inbox: {
    loading: { copy: "Loading the inbox…" },
    empty: { copy: "Nothing waiting on you" },
    error: { copy: "Could not load the inbox." },
    refused: { copy: "The answer was refused." },
    stale: { na: NO_FEED },
    live: { na: NO_FEED },
    pending: { copy: "Sending your answer…" },
  },
  board: {
    loading: { copy: "Loading the board…" },
    empty: { copy: "No work items yet." },
    error: { copy: "Could not load the board." },
    refused: { na: READ_ONLY },
    stale: { copy: "Disconnected: the board may be out of date." },
    live: { copy: "Connected: the board updates live." },
    pending: { na: READ_ONLY },
  },
  seats: {
    loading: { copy: "Loading the seats…" },
    empty: { copy: "No seats are declared." },
    error: { copy: "Could not load the seats." },
    refused: { copy: "The change was refused." },
    stale: { na: `${NO_FEED}; a draft made stale under the console is refused on Confirm (W-065)` },
    live: { na: NO_FEED },
    pending: { copy: "Recording the change…" },
  },
  officina: {
    loading: { copy: "Loading the officina…" },
    empty: { copy: "Nothing is recorded yet: no budget, milestones, records or pending actions." },
    error: { copy: "Could not load part of the officina." },
    refused: { na: READ_ONLY },
    stale: { na: `${NO_FEED}; its health panels carry their own as-of stamp (W-077)` },
    live: { na: NO_FEED },
    pending: { na: READ_ONLY },
  },
};

/** Every served cell, in matrix order: the rows the served states suite must drive. */
export function servedCells(): { screen: Screen; state: ScreenState; copy: string }[] {
  return SCREENS.flatMap((screen) =>
    SCREEN_STATES.flatMap((state) => {
      const cell = STATES_MATRIX[screen][state];
      return "copy" in cell ? [{ screen, state, copy: cell.copy }] : [];
    }),
  );
}

/** `ready` is the rest state: loaded, nothing to announce, the region empty. */
export interface ScreenStatus {
  state: ScreenState | "ready";
  text: string;
}

export const READY: ScreenStatus = { state: "ready", text: "" };

export interface StatusInput {
  /** The first read has landed. */
  loaded: boolean;
  /** Loaded, and the screen has no records to show. */
  empty?: boolean;
  /** The last read failed (`true`, the matrix copy) or a write failed (its own copy). */
  failed?: true | string;
  /** The last write was refused; the server's output, possibly empty. */
  refused?: string;
  /** A write is in flight. */
  pending?: boolean;
  /** `undefined`: the screen has no live feed; otherwise whether it is connected. */
  live?: boolean;
}

/** One state by fixed precedence: pending, refused, error, loading, stale, empty, live, then ready. */
export function screenStatus(screen: Screen, input: StatusInput): ScreenStatus {
  const state: ScreenState | "ready" = input.pending
    ? "pending"
    : input.refused !== undefined
      ? "refused"
      : input.failed !== undefined
        ? "error"
        : !input.loaded
          ? "loading"
          : input.live === false
            ? "stale"
            : input.empty
              ? "empty"
              : input.live === true
                ? "live"
                : "ready";
  if (state === "ready") return READY;
  const cell = STATES_MATRIX[screen][state];
  if (!("copy" in cell)) throw new Error(`${screen} cannot be ${state}: ${cell.na}`);
  if (state === "error" && typeof input.failed === "string") return { state, text: input.failed };
  if (state === "refused" && input.refused) return { state, text: `${cell.copy} ${input.refused}` };
  return { state, text: cell.copy };
}
