import * as React from "react";
import { useState, type JSX } from "react";
import type { InboxResponse } from "../api.js";
import type { Verb } from "./inboxLogic.js";

export interface InboxViewProps {
  petitiones: InboxResponse["petitiones"];
  opera: InboxResponse["opera"];
  focusIndex: number;
  focusRequest?: number;
  reason: string;
  error?: string | null;
  confirmation?: string;
  notice?: string;
  busy?: boolean;
  onReasonChange: (value: string) => void;
  onFocusChange: (index: number) => void;
  onSubmit: (petitioId: string, verb: Verb) => void;
}

export function InboxView({ petitiones, focusIndex, confirmation, notice, onFocusChange }: InboxViewProps): JSX.Element {
  const [detailOpen, setDetailOpen] = useState(false);
  const selected = petitiones[focusIndex];
  if (petitiones.length === 0) return <div className="inbox"><h1 className="inbox__title">Inbox</h1><p className="inbox__empty">{notice ?? "Nothing waiting on you"}</p></div>;
  return <div className="inbox">
    <h1 className="inbox__title">Inbox</h1>
    {confirmation && <p className="inbox__confirmation">{confirmation}</p>}
    <div className={["inbox__workspace", detailOpen && "inbox__workspace--detail"].filter(Boolean).join(" ")}>
      <div className="inbox__mobile-header">
        <button type="button" className="inbox__back" aria-label="Back to Inbox" onClick={() => setDetailOpen(false)}><span aria-hidden="true">←</span> Back</button>
        <h1 className="inbox__mobile-title">Inbox</h1>
      </div>
      <section className="inbox__list-pane" aria-label="Needs your decision">
        <div className="inbox__queue" role="listbox" aria-label="Needs your decision">
          {petitiones.map((p, index) => <button key={p.id} type="button" role="option" aria-selected={index === focusIndex} tabIndex={index === focusIndex ? 0 : -1} className="inbox__item inbox__row" onClick={() => { onFocusChange(index); setDetailOpen(true); }}><span className="inbox__subject">{p.subject}</span><span className="inbox__sella">{p.from}</span></button>)}
        </div>
      </section>
      <section className="inbox__reading-pane" aria-label="Selected decision">
        {selected && <div className="inbox__expansion">
          <div className="inbox__reading-scroll"><div className="inbox__reading"><h2 className="inbox__expanded-subject">{selected.subject}</h2><div className="inbox__ask"><p>{selected.body || "No content provided."}</p></div></div></div>
          <div className="inbox__action-bar"><div className="inbox__action-bar-inner"><label className="inbox__ratio-label">Ratio decidendi</label><input className="inbox__input-ratio" /><div className="inbox__decision-panel" /></div></div>
        </div>}
      </section>
    </div>
  </div>;
}
