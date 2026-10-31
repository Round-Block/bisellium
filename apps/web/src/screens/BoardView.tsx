/**
 * apps/web/src/screens/BoardView.tsx — W-064: the Board's presentational
 * half. Props in, markup out — `Board.tsx` holds fetch, SSE, selection and
 * keyboard state. The phone column-name strip is a self-contained DOM
 * affordance (scroll a column into view) rather than app state, so it lives
 * here rather than being threaded up through Board.tsx.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { formatWaitingAge, type BoardModel, type CardRow } from "../lib/board.js";
import { GateLadder } from "../components/GateLadder.js";
import { Colophon } from "../components/Colophon.js";

export interface BoardViewProps {
  studio: string;
  model: BoardModel;
  /** True only while the drawer reduces this mounted Board to a zero-width
   *  track; removes its concealed controls from sequential focus. */
  inert?: boolean;
  selectedId?: string;
  /** Roving tabindex: exactly one card per column carries tabIndex 0. */
  focusedByColumn: Record<string, string | undefined>;
  onSelectCard: (id: string, columnId: string) => void;
  /** Connection state and last successful refresh, already formatted by
   *  `lib/board.ts`'s `liveLabel`; this belongs to the header, not a footer. */
  liveness?: string;
  /** W-129: one plain sentence when serve could not read every branch record (`branchNote`). */
  branchNote?: string;
  generatedAt?: string;
  /** W-341: the screen's visible status line in a loading, empty or error state; absent at rest. */
  notice?: string;
}

const UNAVAILABLE_REASON = "one officina per serve process; no project registry exists to detect or add one";

function cardClassName(card: CardRow): string {
  // Ruling: on a card that is both blocked and needs-you, only "bad" shows
  // (DIRECTION §3: at most one amber region, and a failure outranks a wait).
  const state = card.blocked ? "board__card--bad" : card.needsYou ? "board__card--amber" : "";
  return ["board__card", card.needsYou && "board__card--waiting", state].filter(Boolean).join(" ");
}

function askKindLabel(ask: NonNullable<CardRow["asks"]>[number]): string {
  return ask.kind === "greenlight"
    ? "Greenlight"
    : ask.kind === "inbox"
      ? ask.count === 1 ? "Inbox decision" : `${ask.count} Inbox decisions`
      : "Human gate";
}

function WaitingFacts({ card, compact = false }: { card: CardRow; compact?: boolean }): JSX.Element {
  const asks = card.asks?.map(askKindLabel).join(", ") ?? "Waiting on you";
  const owner = card.sella || "Unassigned";
  return (
    <>
      <span className="board__waiting-head">
        <span className={compact ? "board__waiting-id" : "board__card-id"}>{card.id}</span>
        <span className="board__waiting-age">{formatWaitingAge(card.waitingSince, Date.now())}</span>
      </span>
      <span className={compact ? "board__waiting-title" : "board__card-title"} title={card.title}>{card.title}</span>
      <span className="board__waiting-handoff">
        <span className="board__waiting-owner">
          <small>OWNER</small>
          <b className="board__waiting-owner-value">{owner}</b>
        </span>
        <span className="board__waiting-arrow" aria-hidden="true">→</span>
        <span className="board__waiting-next">
          <small>NEXT</small>
          <b className="board__waiting-next-value">{card.nextActor ?? "Unassigned"}</b>
        </span>
      </span>
      <span className="board__waiting-ask">
        <small>ASK</small>
        <span className="board__waiting-ask-value">{asks}</span>
      </span>
    </>
  );
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
      {card.needsYou ? <WaitingFacts card={card} /> : <>
        <span className="board__card-id">{card.id}</span>
        <span className="board__card-title" title={card.title}>{card.title}</span>
        <span className="board__card-meta">
          {card.sella && <span className="board__card-sella">{card.sella}</span>}
          <span className="board__card-state">{card.state}</span>
        </span>
      </>}
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
    </div>
  );
}

function WaitingStrip({ waiting, columns, onSelectCard }: {
  waiting: CardRow[];
  columns: BoardModel["columns"];
  onSelectCard: (id: string, columnId: string) => void;
}): JSX.Element {
  const itemsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const updateScrollCue = useCallback(() => {
    const items = itemsRef.current;
    setCanScrollRight(items !== null && items.scrollLeft + items.clientWidth < items.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollCue();
    const items = itemsRef.current;
    if (!items) return;
    const observer = new ResizeObserver(updateScrollCue);
    observer.observe(items);
    window.addEventListener("resize", updateScrollCue);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScrollCue);
    };
  }, [updateScrollCue, waiting.length]);

  const showMore = (): void => {
    const items = itemsRef.current;
    if (!items) return;
    const moreButton = moreRef.current;
    const distance = items.clientWidth * 0.9;
    const reachesEnd = items.scrollLeft + items.clientWidth + distance >= items.scrollWidth - 1;
    items.scrollBy({ left: distance, behavior: "auto" });
    if (reachesEnd && document.activeElement === moreButton) {
      requestAnimationFrame(() => items.querySelector<HTMLButtonElement>(".board__waiting-item:last-child")?.focus());
    }
  };

  const revealFocusedWaitingItem = (item: HTMLButtonElement): void => {
    const items = itemsRef.current;
    const chevron = items?.parentElement?.querySelector<HTMLElement>(".board__waiting-more");
    if (!items || !chevron) return;
    const itemRight = item.getBoundingClientRect().right;
    const chevronLeft = chevron.getBoundingClientRect().left;
    if (itemRight > chevronLeft) {
      items.scrollBy({ left: itemRight - chevronLeft + 2, behavior: "auto" });
      updateScrollCue();
    }
  };

  return (
    <aside className={`board__waiting${waiting.length === 0 ? " board__waiting--empty" : ""}`} aria-label="Waiting on you">
      <div className="board__waiting-label">
        <span>Waiting on you</span>
        <strong>{waiting.length}</strong>
      </div>
      {waiting.length > 0 && <div className={`board__waiting-rail${canScrollRight ? " board__waiting-rail--more" : ""}`}>
        <div ref={itemsRef} className="board__waiting-items" onScroll={updateScrollCue}>
          {waiting.map((card) => {
            const columnId = columns.find((column) => column.cards.some(({ id }) => id === card.id))?.id;
            return (
              <button
                key={card.id}
                type="button"
                className="board__waiting-item"
                data-waiting-id={card.id}
                onClick={() => onSelectCard(card.id, columnId ?? "unplaced")}
                onFocus={(event) => revealFocusedWaitingItem(event.currentTarget)}
              >
                <WaitingFacts card={card} compact />
              </button>
            );
          })}
        </div>
        {canScrollRight && <button ref={moreRef} type="button" className="board__waiting-more" aria-label="Show more waiting asks" onClick={showMore}>
          <span aria-hidden="true">›</span>
        </button>}
      </div>}
    </aside>
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

export function BoardView({ studio, model, inert, selectedId, focusedByColumn, onSelectCard, liveness, branchNote, generatedAt, notice }: BoardViewProps): JSX.Element {
  return (
    <div className="board" inert={inert || undefined}>
      <div className="board__header">
        <h1 className="board__title">Board</h1>
        <div className="board__project-select-wrap">
          <select className="board__project-select" disabled aria-label="project" value={studio} onChange={() => undefined}>
            <option value={studio}>{studio}</option>
          </select>
          <span className="board__project-select-reason">{UNAVAILABLE_REASON}</span>
        </div>
        {liveness !== undefined && <div className="board__liveness">{liveness}</div>}
      </div>
      {notice !== undefined && <p className="screen-notice board__notice">{notice}</p>}
      {branchNote !== undefined && <p className="board__branch-note">{branchNote}</p>}
      <WaitingStrip waiting={model.waiting} columns={model.columns} onSelectCard={onSelectCard} />
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
      <div className="board__scroll-cue" aria-hidden="true">
        <div className="board__scroll-cue-thumb" />
      </div>
      <Colophon studioPath={studio} generatedAt={generatedAt} />
    </div>
  );
}
