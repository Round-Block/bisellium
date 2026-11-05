/**
 * apps/web/src/screens/BoardDrawerLadder.tsx — W-300: one line under the drawer's title: the opus's next step, its actor,
 * round and health, then why, read from `GET /api/opus/:id/ladder` when the drawer opens and whenever its events change.
 * Amber only when the actor is the Patron. Read only: its one fetcher is `fetchLadder`.
 */
import { useEffect, useState, type JSX } from "react";
import { fetchLadder, type LadderRead } from "../api.js";

export function ladderText(read: Extract<LadderRead, { read: "ok" }>): string {
  return [`Next: ${read.step}${read.status === "held" ? " (held)" : ""}`, read.actor, ...(read.round === null ? [] : [`round ${read.round}`]), read.health, read.why].join(" · ");
}

type Shown = LadderRead | "reading" | "failed";

export function BoardDrawerLadder({ id, refresh }: { id: string; refresh: number }): JSX.Element | null {
  const [answer, setAnswer] = useState<{ id: string; shown: Shown } | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetchLadder(id).then(
      (read) => {
        if (live) setAnswer({ id, shown: read });
      },
      () => {
        if (live) setAnswer({ id, shown: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [id, refresh]);
  // the previous answer stays up while this opus's line refreshes; another opus's answer never shows
  const shown: Shown = answer?.id === id ? answer.shown : "reading";
  if (shown === "reading") return <p className="board-drawer__ladder">Reading the next step…</p>;
  if (shown === "failed") return <p className="board-drawer__ladder">Next step not read.</p>;
  if (shown.read === "not-in-flight") return null;
  if (shown.read === "unavailable") {
    const text = `Next step not read: ${shown.why}`;
    return <p className="board-drawer__ladder" title={text}><span className="board-drawer__ladder-text">{text}</span></p>;
  }
  const text = ladderText(shown);
  return (
    <p className={`board-drawer__ladder${shown.actor === "patron" ? " board-drawer__ladder--patron" : ""}`} title={text}>
      <span className="board-drawer__ladder-text">{text}</span>
      {shown.pr !== null && (shown.pr.url === null
        ? <span className="board-drawer__ladder-pr">PR #{shown.pr.number}</span>
        : <a className="board-drawer__ladder-pr" href={shown.pr.url} target="_blank" rel="noreferrer">PR #{shown.pr.number}</a>)}
    </p>
  );
}
