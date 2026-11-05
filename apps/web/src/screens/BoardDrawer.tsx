/**
 * apps/web/src/screens/BoardDrawer.tsx — W-064: the detail drawer,
 * presentational. `Board.tsx` supplies the `DrawerDetail` (via
 * `lib/board.ts`'s `drawerDetail`) and the close callback.
 */
import type { JSX } from "react";
import type { DrawerDetail } from "../lib/board.js";
import { BoardDrawerLadder } from "./BoardDrawerLadder.js";

export interface BoardDrawerProps {
  detail: DrawerDetail | undefined;
  onClose: () => void;
}

export function BoardDrawer({ detail, onClose }: BoardDrawerProps): JSX.Element | null {
  if (!detail) return null;

  return (
    <div className="board-drawer" role="dialog" aria-label={detail.title}>
      <div className="board-drawer__header">
        <button type="button" className="board-drawer__close" onClick={onClose} aria-label="close">
          &times;
        </button>
        <span className="board-drawer__id">{detail.id}</span>
        <h2 className="board-drawer__title">{detail.title}</h2>
        <BoardDrawerLadder id={detail.id} refresh={detail.events.length} />
        <span className="board-drawer__meta">
          {detail.sella}
          {detail.collegium ? ` · ${detail.collegium}` : ""} &middot; {detail.state}
        </span>
      </div>

      <div className="board-drawer__record">
        <h3 className="board-drawer__section-head">From the officina record</h3>
        <div className="board-drawer__record-body">{detail.body.length > 0 ? detail.body : "No record body."}</div>
        {detail.tokensDeclared !== undefined && (
          <div className="board-drawer__record-row">
            <span className="board-drawer__record-label">tokens (declared)</span>
            <span className="board-drawer__record-value">{detail.tokensDeclared}</span>
          </div>
        )}
        {detail.tokensBySella.length > 0 && (
          <div className="board-drawer__record-row">
            <span className="board-drawer__record-label">tokens (event-derived, possibly incomplete)</span>
            <span className="board-drawer__record-value">{detail.tokensBySella.map((t) => `${t.sella}: ${t.tokens}`).join(", ")}</span>
          </div>
        )}
        {detail.record.map((r) => (
          <div key={r.label} className="board-drawer__record-row">
            <span className="board-drawer__record-label">{r.label}</span>
            <span className="board-drawer__record-value">{r.value}</span>
          </div>
        ))}
      </div>

      {detail.waitingOn && (
        <div className="board-drawer__banner">
          <span className="board-drawer__banner-label">Waiting on you</span> &mdash; {" "}
          {detail.waitingOn.petitio ? (
            <a className="board-drawer__banner-text board-drawer__banner-link" href="#/inbox">
              Go to Inbox
            </a>
          ) : (
            <span className="board-drawer__banner-text">no question recorded.</span>
          )}
        </div>
      )}

      {detail.waitingReasons !== undefined && (
        <section className="board-drawer__reasons">
          <h3 className="board-drawer__section-head">Why it waits</h3>
          {detail.waitingReasons.length > 0 ? (
            <ul className="board-drawer__reason-list">
              {detail.waitingReasons.map((reason, index) => (
                <li key={index} className="board-drawer__reason">
                  {reason.text}{reason.from ? <> &mdash; from {reason.from}</> : null}
                </li>
              ))}
            </ul>
          ) : <p className="board-drawer__waiting-empty">No waiting reason recorded.</p>}
        </section>
      )}

      {detail.waitingEvidence !== undefined && (
        <section className="board-drawer__waiting-evidence-list">
          <h3 className="board-drawer__section-head">Evidence</h3>
          {detail.waitingEvidence.length > 0 ? detail.waitingEvidence.map((evidence) => (
            <div key={evidence.gate} className="board-drawer__evidence-binding">
              <h4 className="board-drawer__evidence-name">{evidence.label}</h4>
              <dl className="board-drawer__evidence-facts">
                <div>
                  <dt>Reviewed revision</dt>
                  <dd title={evidence.revision}>{evidence.revision ?? "Not recorded."}</dd>
                </div>
                <div>
                  <dt>Gate result</dt>
                  <dd>{evidence.gate} &middot; {evidence.status}</dd>
                </div>
                <div>
                  <dt>Decision record</dt>
                  <dd>{evidence.record
                    ? <a className="board-drawer__waiting-evidence" href={evidence.record}>{evidence.record}</a>
                    : "Not recorded."}</dd>
                </div>
              </dl>
            </div>
          )) : <p className="board-drawer__waiting-empty">No evidence recorded.</p>}
        </section>
      )}

      <div className="board-drawer__gates">
        <h3 className="board-drawer__section-head">Gate ladder</h3>
        {detail.gates.map((g) => (
          <div key={g.id} className="board-drawer__gate-row">
            <span className="board-drawer__gate-name">
              {g.name}
              {g.human && <span className="board-drawer__gate-human"> &middot; human gate</span>}
            </span>
            <span className="board-drawer__gate-status">{g.status}</span>
            {g.evidence && (
              <a className="board-drawer__gate-evidence" href={g.evidence}>
                {g.evidence}
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="board-drawer__events">
        <h3 className="board-drawer__section-head">Events</h3>
        {detail.events.map((e, i) => (
          <div key={i} className="board-drawer__event">
            <span className="board-drawer__event-at">{e.at}</span>
            <span className="board-drawer__event-summary">{e.summary}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
