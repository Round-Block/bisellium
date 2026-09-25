/**
 * apps/web/src/screens/BoardDrawer.tsx — W-064: the detail drawer,
 * presentational. `Board.tsx` supplies the `DrawerDetail` (via
 * `lib/board.ts`'s `drawerDetail`) and the close callback.
 */
import type { JSX } from "react";
import type { DrawerDetail } from "../lib/board.js";

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
        <span className="board-drawer__meta">
          {detail.sella}
          {detail.collegium ? ` · ${detail.collegium}` : ""} &middot; {detail.state}
        </span>
      </div>

      {detail.waitingOn && (
        <div className="board-drawer__banner">
          <span className="board-drawer__banner-label">Waiting on you.</span>{" "}
          {detail.waitingOn.petitio ? (
            // The compensating surface the Patron's "Read-only now, Reply as
            // follow-on" decree rests on: a link to the thread, not a write.
            // Inbox has no per-petitio deep link (not owned by this opus —
            // W-073 is where "Reply" itself lands), so this names the
            // screen the thread lives on; the Patron finds it there.
            <a className="board-drawer__banner-text board-drawer__banner-link" href="#/inbox">
              {detail.waitingOn.petitio.subject} &mdash; from {detail.waitingOn.petitio.from}
            </a>
          ) : (
            <span className="board-drawer__banner-text">{detail.waitingOn.name}: no question was asked.</span>
          )}
        </div>
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

      <div className="board-drawer__record">
        <h3 className="board-drawer__section-head">From the officina record</h3>
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
    </div>
  );
}
