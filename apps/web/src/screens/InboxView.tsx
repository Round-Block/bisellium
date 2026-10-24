import { useEffect, useRef, type JSX } from "react";
import type { InboxResponse } from "../api.js";
import { canSubmit, type Verb } from "./inboxLogic.js";

export interface InboxViewProps {
  petitiones: InboxResponse["petitiones"];
  opera: InboxResponse["opera"];
  focusIndex: number;
  /** Incremented only by j/k movement, so the selected row receives DOM focus and is revealed without stealing focus on load. */
  focusRequest?: number;
  reason: string;
  /** W-067: one line for a "refused" or "error" WriteResult. `null` when
   *  there's nothing to say — never rendered any other way (no title/style/
   *  href built from it: it's server `output`, i.e. officina content). */
  error?: string | null;
  /** The exact successful record effect, retained across the settling reload. */
  confirmation?: string;
  /** W-341: the screen's visible status line in a loading, read-error or pending state; absent at rest. */
  notice?: string;
  /** True while the selected answer is being recorded. */
  busy?: boolean;
  onReasonChange: (value: string) => void;
  onFocusChange: (index: number) => void;
  onSubmit: (petitioId: string, verb: Verb) => void;
}

const VERBS: { verb: Verb; key: string }[] = [
  { verb: "approve", key: "1" },
  { verb: "decline", key: "2" },
  { verb: "followup", key: "3" },
];

function verbLabel(verb: Verb): string {
  return verb === "followup" ? "follow up" : verb;
}

export function InboxView(props: InboxViewProps): JSX.Element {
  const { petitiones, opera, focusIndex, focusRequest = 0, reason, error, confirmation, notice, busy = false, onReasonChange, onFocusChange, onSubmit } = props;
  const selected = petitiones[focusIndex];
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusRequest === 0) return;
    selectedRowRef.current?.focus({ preventScroll: true });
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusRequest, selected?.id]);

  if (petitiones.length === 0 && opera.length === 0) {
    return (
      <div className="inbox">
        <h1 className="inbox__title">Inbox</h1>
        {confirmation && <p className="inbox__confirmation">{confirmation}</p>}
        <p className="inbox__empty">{notice ?? "Nothing waiting on you"}</p>
      </div>
    );
  }

  return (
    <div className="inbox inbox--split">
      <div className="inbox__list">
        <h1 className="inbox__title">Inbox</h1>
        {confirmation && <p className="inbox__confirmation">{confirmation}</p>}
        {petitiones.map((p, i) => {
          const focused = i === focusIndex;
          const rowClasses = [
            "inbox__row",
            "inbox__row--attention",
            focused ? "inbox__row--focused" : "",
          ].filter(Boolean).join(" ");

          return (
            <button
              key={p.id}
              ref={focused ? selectedRowRef : undefined}
              type="button"
              className={rowClasses}
              data-focused={focused}
              aria-pressed={focused}
              tabIndex={focused ? 0 : -1}
              onClick={() => onFocusChange(i)}
              onFocus={() => onFocusChange(i)}
            >
              <span className="inbox__subject">{p.subject}</span>
              <span className="inbox__sella">{p.from}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="inbox__detail">
          <div className="inbox__detail-header">
            <span className="inbox__detail-opus">{selected.opus}</span>
            <span className="inbox__detail-from">from {selected.from}</span>
          </div>
          <h2 className="inbox__detail-subject">{selected.subject}</h2>
          <div className="inbox__detail-body">
            {selected.body ? (
              <p className="inbox__detail-content">{selected.body}</p>
            ) : (
              <p className="inbox__detail-placeholder">No content provided.</p>
            )}
          </div>
          <div className="inbox__decision-panel">
            {notice !== undefined && <p className="screen-notice">{notice}</p>}
            {error && <p className="inbox__error">{error}</p>}
            <p className="inbox__action-effect">Approve and Decline record this text as a verdict and resolve the petition. Follow up records the text without a verdict, returns it to the asker and keeps it open.</p>
            <input
              className="inbox__input-ratio"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Answer or follow-up text"
            />
            <div className="inbox__action-group">
              {VERBS.map(({ verb, key }) => (
                <button
                  key={verb}
                  type="button"
                  className="inbox__btn-action"
                  disabled={!canSubmit(reason, busy)}
                  onClick={() => onSubmit(selected.id, verb)}
                >
                  <span className="inbox__hotkey">{key}</span>
                  {verbLabel(verb)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
