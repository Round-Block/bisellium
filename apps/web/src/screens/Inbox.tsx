import { useEffect, useState, type JSX } from "react";
import { fetchInbox, submitAnswer, type InboxResponse } from "../api.js";
import { InboxView } from "./InboxView.js";
import { buildReply, moveFocus, nextExpanded, resolveVerbAction, type Verb } from "./inboxLogic.js";

const EMPTY: InboxResponse = { opera: [], petitiones: [] };

/** apps/web/src/screens/Inbox.tsx — the stateful half: fetches
 * `/api/inbox` and the studio path, wires `apps/web/src/screens/
 * inboxLogic.ts`'s pure functions to a roving-tabindex keyboard model
 * (DIRECTION.md §5), and renders `InboxView`. */
export function Inbox(): JSX.Element {
  const [data, setData] = useState<InboxResponse>(EMPTY);
  const [focusIndex, setFocusIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [studioPath, setStudioPath] = useState("");

  useEffect(() => {
    fetchInbox()
      .then(setData)
      .catch(() => undefined);
    // `/api/officina` isn't part of api.ts's W-024 exports (fetchInbox,
    // submitAnswer only — see api.ts's header comment); read directly
    // here for the colophon's studio path.
    fetch("/api/officina")
      .then((res) => res.json() as Promise<{ studio?: unknown }>)
      .then((body) => {
        if (typeof body.studio === "string") setStudioPath(body.studio);
      })
      .catch(() => undefined);
  }, []);

  const petitiones = data.petitiones;
  const focusedId = petitiones[focusIndex]?.id;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "j" || e.key === "k") {
        setFocusIndex((i) => moveFocus(i, petitiones.length, e.key as "j" | "k"));
        return;
      }
      if (e.key === "Enter" || e.key === "Escape") {
        setExpandedId((prev) => nextExpanded(prev, focusedId, e.key));
        return;
      }
      const action = resolveVerbAction(e.key, expandedId, focusedId, reason);
      if (action) submit(action.petitioId, action.verb);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [petitiones.length, focusedId, expandedId, reason]);

  function submit(petitioId: string, verb: Verb): void {
    void submitAnswer(petitioId, buildReply(verb, reason));
    setExpandedId(null);
    setReason("");
  }

  return (
    <InboxView
      petitiones={data.petitiones}
      opera={data.opera}
      focusIndex={focusIndex}
      expandedId={expandedId}
      reason={reason}
      studioPath={studioPath}
      onReasonChange={setReason}
      onSubmit={submit}
    />
  );
}
