/**
 * apps/web/src/screens/BoardView.tsx — W-064: the Board's presentational
 * half. Props in, markup out — `Board.tsx` holds fetch, SSE, selection and
 * keyboard state. The phone column-name strip is a self-contained DOM
 * affordance (scroll a column into view) rather than app state, so it lives
 * here rather than being threaded up through Board.tsx.
 */
import type { JSX } from "react";
import type { BoardModel, CardRow } from "../lib/board.js";
import { GateLadder } from "../components/GateLadder.js";
import { Colophon } from "../components/Colophon.js";

export interface BoardViewProps {
  studio: string;
  model: BoardModel;
  selectedId?: string;
  /** Roving tabindex: exactly one card per column carries tabIndex 0. */
  focusedByColumn: Record<string, string | undefined>;
  onSelectCard: (id: string, columnId: string) => void;
  /** Connection state and last successful refresh, already formatted by
   *  `lib/board.ts`'s `liveLabel` — separate from the colophon (ruling 10). */
  liveness?: string;
  generatedAt?: string;
}

const UNAVAILABLE_REASON = "one officina per serve process; no project registry exists to detect or add one";

function cardClassName(card: CardRow): string {
  // Ruling: on a card that is both blocked and needs-you, only "bad" shows
  // (DIRECTION §3: at most one amber region, and a failure outranks a wait).
  const state = card.blocked ? "board__card--bad" : card.needsYou ? "board__card--amber" : "";
  return ["board__card", state].filter(Boolean).join(" ");
}

function Card({
  card,
  columnId,
  selected,
  focused,
  onSelect,
}: {
  card: CardRow;
  columnId: string;
  selected: boolean;
  focused: boolean;
  onSelect: (id: string, columnId: string) => void;
}): JSX.Element {
  return (
    <div
      className={cardClassName(card)}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-column-id={columnId}
      data-card-id={card.id}
      onClick={() => onSelect(card.id, columnId)}
    >
      <GateLadder gates={card.gates} />
      <span className="board__card-title">{card.title}</span>
      <span className="board__card-meta">
        {card.sella && <span className="board__card-sella">{card.sella}</span>}
        <span className="board__card-state">{card.state}</span>
      </span>
    </div>
  );
}

function Column({
  column,
  selectedId,
  focusedByColumn,
  onSelectCard,
}: {
  column: BoardModel["columns"][number];
  selectedId?: string;
  focusedByColumn: Record<string, string | undefined>;
  onSelectCard: (id: string, columnId: string) => void;
}): JSX.Element {
  const focusedId = focusedByColumn[column.id] ?? column.cards[0]?.id;
  const classes = ["board__column", column.pinned && "board__column--pinned"].filter(Boolean).join(" ");
  return (
    <div className={classes} data-column-id={column.id}>
      <div className="board__column-head" tabIndex={-1}>
        <span className="board__column-name">{column.name}</span>
        <span className="board__column-count">{column.cards.length}</span>
      </div>
      {column.cap !== undefined && (
        <div className="board__wip-rule">
          <div
            className={["board__wip-fill", column.atCap && "board__wip-fill--amber"].filter(Boolean).join(" ")}
            style={{ width: `${Math.min(100, (column.cards.length / Math.max(1, column.cap)) * 100)}%` }}
          />
        </div>
      )}
      <div className="board__column-cards" role="listbox" aria-label={column.name}>
        {column.cards.map((card) => (
          <Card key={card.id} card={card} columnId={column.id} selected={card.id === selectedId} focused={card.id === focusedId} onSelect={onSelectCard} />
        ))}
      </div>
      {column.backlogCount !== undefined && column.backlogCount > 0 && <div className="board__backlog-footer">{column.backlogCount} backlogged</div>}
    </div>
  );
}

/** Not a `useRef`: `BoardView` is called as a plain function by the static-
 *  markup tests (behaviour 5/6's own house convention, matching Sidebar/
 *  SeatsView), which never runs inside React's real render pass and so has
 *  no hook dispatcher. A plain DOM query is equivalent here and only ever
 *  runs from a real click in a real browser (mounted, behaviour 9). */
function scrollColumnIntoView(columnId: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(`.board__columns [data-column-id="${columnId}"]`);
  el?.scrollIntoView({ inline: "start", block: "nearest" });
}

export function BoardView({ studio, model, selectedId, focusedByColumn, onSelectCard, liveness, generatedAt }: BoardViewProps): JSX.Element {
  return (
    <div className="board">
      <div className="board__header">
        <h1 className="board__title">Board</h1>
        <div className="board__project-select-wrap">
          <select className="board__project-select" disabled aria-label="project" value={studio} onChange={() => undefined}>
            <option value={studio}>{studio}</option>
          </select>
          <span className="board__project-select-reason">{UNAVAILABLE_REASON}</span>
        </div>
      </div>
      <div className="board__strip">
        {model.columns.map((column) => (
          <button key={column.id} type="button" className="board__strip-item" onClick={() => scrollColumnIntoView(column.id)}>
            {column.name} <span className="board__strip-count">{column.cards.length}</span>
          </button>
        ))}
      </div>
      <div className="board__columns">
        {model.columns.map((column) => (
          <Column key={column.id} column={column} selectedId={selectedId} focusedByColumn={focusedByColumn} onSelectCard={onSelectCard} />
        ))}
      </div>
      {liveness !== undefined && <div className="board__liveness">{liveness}</div>}
      <Colophon studioPath={studio} generatedAt={generatedAt} />
    </div>
  );
}
