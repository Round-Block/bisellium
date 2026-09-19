import type { JSX } from "react";
import type { InboxResponse } from "../api.js";
import { Colophon } from "../components/Colophon.js";
import { canSubmit, type Verb } from "./inboxLogic.js";

/** apps/web/src/screens/InboxView.tsx — the Inbox's presentational half:
 * pure props in, markup out, no fetch/effects/keyboard listeners (those
 * live in `Inbox.tsx`). Exported so behaviours 4, 9 and 10 are testable
 * with `react-dom/server`'s `renderToStaticMarkup` against plain data,
 * without a DOM. */

export interface InboxViewProps {
  petitiones: InboxResponse["petitiones"];
  opera: InboxResponse["opera"];
  focusIndex: number;
  expandedId: string | null;
  reason: string;
  studioPath: string;
  onReasonChange: (value: string) => void;
  onSubmit: (petitioId: string, verb: Verb) => void;
}

const VERBS: Verb[] = ["approve", "defer", "decline", "delegate"];

export function InboxView(props: InboxViewProps): JSX.Element {
  const { petitiones, opera, focusIndex, expandedId, reason, studioPath, onReasonChange, onSubmit } = props;

  if (petitiones.length === 0 && opera.length === 0) {
    return (
      <div>
        <p>Nothing waiting on you</p>
        <Colophon studioPath={studioPath} />
      </div>
    );
  }

  return (
    <div>
      {petitiones.map((p, i) => {
        const expanded = expandedId === p.id;
        return (
          <div key={p.id} data-focused={i === focusIndex} style={expanded ? undefined : rowStyle}>
            <span style={subjectStyle}>{p.subject}</span>
            <span style={sellaStyle}>{p.from}</span>
            {expanded && (
              <div>
                <p>{p.subject}</p>
                <input value={reason} onChange={(e) => onReasonChange(e.target.value)} placeholder="reason" />
                {VERBS.map((verb) => (
                  <button key={verb} type="button" disabled={!canSubmit(reason)} onClick={() => onSubmit(p.id, verb)}>
                    {verb}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Colophon studioPath={studioPath} />
    </div>
  );
}

// DIRECTION.md §6 (Inbox): 40px row, amber 2px left rule, title at 13/18,
// sella id in mono 12.
const rowStyle = { height: "40px", borderLeft: "2px solid var(--amber)" };
const subjectStyle = { fontSize: "13px", lineHeight: "18px" };
const sellaStyle = { fontFamily: "var(--font-mono)", fontSize: "12px" };
