import { useEffect, useState, type JSX } from "react";
import { fetchInbox, submitAnswer, type InboxResponse } from "../api.js";
import { InboxView } from "./InboxView.js";
import { buildReply, moveFocus, resolveVerbAction, type Verb } from "./inboxLogic.js";

const EMPTY: InboxResponse = { opera: [], petitiones: [] };

const DEV_DATA: InboxResponse = {
  opera: [],
  petitiones: [
    {
      id: "P-008", opus: "W-026", from: "architect",
      subject: "Approve visual hierarchy pass for Officina screen",
      body: "The W-026 visual pass restructures the Officina screen from a single-column document layout to a sidebar + grid dashboard. Changes include pie charts for burn posture, side-by-side panels for Engine and Integrity, and responsive breakpoints at 899px and 599px. All DIRECTION.md constraints are satisfied except the pie charts override the no-gauges rule per Patron instruction. Recommend approval — the layout matches the Claude desktop / Linear / Vercel reference pattern.",
    },
    {
      id: "P-009", opus: "W-024", from: "builder-a",
      subject: "Review inbox keyboard navigation edge case",
      body: "When the inbox has exactly one petitio and the user presses 'k' (move up), focusIndex wraps to -1 on the next render before the clamp in moveFocus catches it. This causes a brief flash of no-selection state. Proposed fix: clamp focusIndex to [0, length-1] inside the state setter callback rather than in moveFocus. The fix is two lines in Inbox.tsx. No test changes needed — the existing inboxLogic tests already cover the boundary, but the React state update order wasn't exercised.",
    },
    {
      id: "P-010", opus: "W-025", from: "censor",
      subject: "Confirm gate-ladder mark alignment at 3px gaps",
      body: "QA found that gate-ladder marks render at 3px height with a 2px border-radius, which on non-retina displays can produce a visible rounding artifact — the bottom-left pixel appears clipped. This only affects the half-height variant (waived gates). Options: (A) reduce border-radius to 1px for half-height marks only, (B) increase mark height to 4px, or (C) accept the artifact as imperceptible at normal zoom. Recommending option A — smallest change, no layout shift.",
    },
  ],
};

export function Inbox(): JSX.Element {
  const [data, setData] = useState<InboxResponse>(EMPTY);
  const [focusIndex, setFocusIndex] = useState(0);
  const [reason, setReason] = useState("");

  const demo = location.search.includes("demo");

  useEffect(() => {
    if (demo) { setData(DEV_DATA); return; }
    fetchInbox()
      .then(setData)
      .catch(() => setData(DEV_DATA));
  }, []);

  const petitiones = data.petitiones;
  const focusedId = petitiones[focusIndex]?.id;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "j" || e.key === "k") {
        setFocusIndex((i) => moveFocus(i, petitiones.length, e.key as "j" | "k"));
        return;
      }
      const action = resolveVerbAction(e.key, focusedId ?? null, focusedId, reason);
      if (action) submit(action.petitioId, action.verb);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [petitiones.length, focusedId, reason]);

  function submit(petitioId: string, verb: Verb): void {
    void submitAnswer(petitioId, buildReply(verb, reason));
    setReason("");
  }

  return (
    <InboxView
      petitiones={data.petitiones}
      opera={data.opera}
      focusIndex={focusIndex}
      reason={reason}
      onReasonChange={setReason}
      onSubmit={submit}
    />
  );
}
