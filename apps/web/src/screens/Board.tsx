/**
 * apps/web/src/screens/Board.tsx — W-064: the container. Three fetches, the
 * `EventSource` with connect/reconnect reconciliation, drawer selection,
 * keyboard state and scroll restoration. Read-only by Patron decree: this
 * file imports exactly the five read-only fetchers below from `../api.js` —
 * behaviour 5 asserts that clause verbatim, and none of this file, BoardView,
 * BoardDrawer or lib/board.ts ever mentions a write helper (structural half
 * of TARGET-9's pair; behaviours 7-9's mounted request counter is the other).
 *
 * SKELETON STATE, committed per P-013's remedy (the Patron refused D-024's
 * waiver a second time): behaviours 7-9's reds are re-recorded from this
 * exact committed tree, so their logs carry a real tree hash, not `dirty:`.
 * The import clause is final (a source-text contract, checked statically by
 * behaviour 5); the container's actual fetch/SSE/keyboard wiring is
 * implemented in the commit that follows the three reds.
 */
import { useState, type JSX } from "react";
import { fetchEvents, fetchInbox, fetchOfficina, fetchOpera, subscribeLive } from "../api.js";
import { BoardView } from "./BoardView.js";
import { BoardDrawer } from "./BoardDrawer.js";
import { boardModel } from "../lib/board.js";

export function Board(): JSX.Element {
  const [model] = useState(() => boardModel({ lifecycle: { id: "", states: [] }, probationes: [] }, []));
  // ponytail: skeleton wiring only — fetchOfficina/fetchOpera/fetchInbox/
  // fetchEvents/subscribeLive are referenced so the import clause is exactly
  // what behaviour 5 checks, before the real container (behaviours 7-9) is
  // implemented.
  void fetchOfficina;
  void fetchOpera;
  void fetchInbox;
  void fetchEvents;
  void subscribeLive;
  return (
    <>
      <BoardView studio="" model={model} focusedByColumn={{}} onSelectCard={() => undefined} />
      <BoardDrawer detail={undefined} onClose={() => undefined} />
    </>
  );
}
