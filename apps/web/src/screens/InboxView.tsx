import type { JSX } from "react";
import type { InboxResponse } from "../api.js";
import { canSubmit, type Verb } from "./inboxLogic.js";

export interface InboxViewProps {
  petitiones: InboxResponse["petitiones"];
  opera: InboxResponse["opera"];
  focusIndex: number;
  reason: string;
  onReasonChange: (value: string) => void;
  onFocusChange: (index: number) => void;
  onSubmit: (petitioId: string, verb: Verb) => void;
}

const VERBS: { verb: Verb; key: string }[] = [
  { verb: "approve", key: "1" },
  { verb: "defer", key: "2" },
  { verb: "decline", key: "3" },
  { verb: "delegate", key: "4" },
];

export function InboxView(props: InboxViewProps): JSX.Element {
  const { petitiones, opera, focusIndex, reason, onReasonChange, onFocusChange, onSubmit } = props;

  if (petitiones.length === 0 && opera.length === 0) {
    return (
      <div className="inbox">
        <h1 className="inbox__title">Inbox</h1>
        <p className="inbox__empty">Nothing waiting on you</p>
      </div>
    );
  }

  const selected = petitiones[focusIndex];

  return (
    <div className="inbox inbox--split">
      <div className="inbox__list">
        <h1 className="inbox__title">Inbox</h1>
        {petitiones.map((p, i) => {
          const focused = i === focusIndex;
          const rowClasses = [
            "inbox__row",
            "inbox__row--attention",
            focused ? "inbox__row--focused" : "",
          ].filter(Boolean).join(" ");

          return (
            <div key={p.id} className={rowClasses} data-focused={focused} onClick={() => onFocusChange(i)}>
              <span className="inbox__subject">{p.subject}</span>
              <span className="inbox__sella">{p.from}</span>
            </div>
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
            <input
              className="inbox__input-ratio"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Ratio decidendi"
            />
            <div className="inbox__action-group">
              {VERBS.map(({ verb, key }) => (
                <button
                  key={verb}
                  type="button"
                  className="inbox__btn-action"
                  disabled={!canSubmit(reason)}
                  onClick={() => onSubmit(selected.id, verb)}
                >
                  <span className="inbox__hotkey">{key}</span>
                  {verb}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
