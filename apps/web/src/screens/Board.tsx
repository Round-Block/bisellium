/**
 * apps/web/src/screens/Board.tsx — W-064: the container. Three fetches, the
 * `EventSource` with connect/reconnect reconciliation, drawer selection,
 * keyboard state and scroll restoration. Read-only by Patron decree: this
 * file imports exactly the five read-only fetchers below from `../api.js` —
 * behaviour 5 asserts that clause verbatim, and none of this file, BoardView,
 * BoardDrawer or lib/board.ts ever mentions a write helper (structural half
 * of TARGET-9's pair; behaviours 7-9's mounted request counter is the other).
 *
 * The Board never polls on a timer of its own (Interfaces): reconciliation
 * runs only on the EventSource's own connect/reconnect (`onOpen`), and a
 * relevant frame schedules the same reconciliation through one trailing
 * timer — never a `setInterval`.
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { fetchEvents, fetchInbox, fetchOfficina, fetchOpera, subscribeLive } from "../api.js";
import type { EventRow, InboxResponse, OfficinaResponse, OpusEntry } from "../api.js";
import { BoardView } from "./BoardView.js";
import { BoardDrawer } from "./BoardDrawer.js";
import { boardModel, drawerDetail, boardNeedsRefetch, drawerNeedsRefetch, liveLabel, reconcileReason } from "../lib/board.js";

const EMPTY_OFFICINA: Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit" | "studio"> = {
  studio: "",
  lifecycle: { id: "", states: [] },
  probationes: [],
};

const REFETCH_DEBOUNCE_MS = 30;

interface Selection {
  id: string;
  columnId: string;
}

export function Board(): JSX.Element {
  const [officina, setOfficina] = useState<OfficinaResponse | typeof EMPTY_OFFICINA>(EMPTY_OFFICINA);
  const [opera, setOpera] = useState<OpusEntry[]>([]);
  const [inbox, setInbox] = useState<Pick<InboxResponse, "petitiones">>({ petitiones: [] });
  const [eventsByItem, setEventsByItem] = useState<Record<string, EventRow[]>>({});
  const [selected, setSelected] = useState<Selection | undefined>(undefined);
  const [focusedByColumn, setFocusedByColumn] = useState<Record<string, string | undefined>>({});
  const [connected, setConnected] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | undefined>(undefined);

  const model = boardModel(officina, opera);

  // Refs mirroring state that stable (mount-once) closures need to read.
  const selectedRef = useRef<Selection | undefined>(undefined);
  const modelRef = useRef(model);
  const connRef = useRef<{ connected: boolean; everFetched: boolean }>({ connected: false, everFetched: false });
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollSnapshotRef = useRef<number | undefined>(undefined);
  const pendingFocusRef = useRef<{ columnId: string; cardId: string } | undefined>(undefined);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  function markRefreshed(): void {
    setLastRefreshAt(new Date().toISOString());
  }

  async function fetchDrawerEvents(id: string): Promise<void> {
    const rows = await fetchEvents({ item: id });
    setEventsByItem((prev) => ({ ...prev, [id]: rows }));
  }

  async function fetchBoardOnly(): Promise<void> {
    const [o, ops, ib] = await Promise.all([fetchOfficina(), fetchOpera(), fetchInbox()]);
    setOfficina(o);
    setOpera(ops);
    setInbox(ib);
    markRefreshed();
  }

  async function fullReconcile(selectedId: string | undefined): Promise<void> {
    const tasks: Promise<unknown>[] = [fetchOfficina().then(setOfficina), fetchOpera().then(setOpera), fetchInbox().then(setInbox)];
    if (selectedId !== undefined) tasks.push(fetchDrawerEvents(selectedId));
    await Promise.all(tasks);
    markRefreshed();
  }

  function scheduleBoardRefetch(): void {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = undefined;
      void fetchBoardOnly();
    }, REFETCH_DEBOUNCE_MS);
  }

  // ---- SSE: connect/reconnect reconciliation + frame-driven refetch -------
  useEffect(() => {
    const unsubscribe = subscribeLive({
      onOpen: () => {
        const reason = reconcileReason(connRef.current, { connected: true });
        connRef.current = { connected: true, everFetched: true };
        setConnected(true);
        if (reason) void fullReconcile(selectedRef.current?.id);
      },
      onError: () => {
        connRef.current = { connected: false, everFetched: connRef.current.everFetched };
        setConnected(false);
      },
      onEvent: (e) => {
        if (boardNeedsRefetch(e)) scheduleBoardRefetch();
        const sel = selectedRef.current;
        if (sel !== undefined && drawerNeedsRefetch(e, sel.id)) void fetchDrawerEvents(sel.id);
      },
    });
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      unsubscribe();
    };
    // Mount-once: every handler above reads current state through refs.
  }, []);

  // ---- Removal / column-change while the drawer is open: close it, and
  // restore focus to the nearest remaining card in that column, or the
  // column head if it's now empty. Never document.body. ---------------------
  useEffect(() => {
    const sel = selected;
    if (!sel) return;
    const column = model.columns.find((c) => c.id === sel.columnId);
    const stillThere = column?.cards.some((c) => c.id === sel.id) ?? false;
    if (stillThere) return;
    setSelected(undefined);
    const scrollEl = document.querySelector<HTMLElement>(".board__columns");
    if (scrollEl && scrollSnapshotRef.current !== undefined) scrollEl.scrollLeft = scrollSnapshotRef.current;
    requestAnimationFrame(() => {
      const columnEl = document.querySelector<HTMLElement>(`.board__columns [data-column-id="${sel.columnId}"]`);
      const firstCard = columnEl?.querySelector<HTMLElement>("[data-card-id]");
      if (firstCard) {
        firstCard.focus();
        return;
      }
      const head = columnEl?.querySelector<HTMLElement>(".board__column-head");
      head?.focus();
    });
  }, [model]);

  // ---- Phone: initial visible column is needs_you (non-empty) else
  // in_progress — once, after the first real model lands. ------------------
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current || model.columns.length === 0) return;
    didInitialScroll.current = true;
    if (typeof window === "undefined" || !window.matchMedia?.("(max-width: 599px)").matches) return;
    const needsYou = model.columns.find((c) => c.id === "needs_you");
    const targetId = needsYou && needsYou.cards.length > 0 ? needsYou.id : "in_progress";
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.board__columns [data-column-id="${targetId}"]`)?.scrollIntoView({ inline: "start", block: "nearest" });
    });
  }, [model]);

  // ---- Focus the pending roving-tabindex target after a render, so state
  // updates (React) and imperative focus (DOM) stay in sync. ----------------
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = undefined;
    document.querySelector<HTMLElement>(`.board__columns [data-column-id="${pending.columnId}"] [data-card-id="${pending.cardId}"]`)?.focus();
  }, [focusedByColumn]);

  function focusCard(columnId: string, cardId: string): void {
    pendingFocusRef.current = { columnId, cardId };
    setFocusedByColumn((prev) => ({ ...prev, [columnId]: cardId }));
  }

  function openDrawer(id: string, columnId: string): void {
    const scrollEl = document.querySelector<HTMLElement>(".board__columns");
    scrollSnapshotRef.current = scrollEl?.scrollLeft;
    setSelected({ id, columnId });
    void fetchDrawerEvents(id);
  }

  function closeDrawer(): void {
    const sel = selected;
    setSelected(undefined);
    const scrollEl = document.querySelector<HTMLElement>(".board__columns");
    if (scrollEl && scrollSnapshotRef.current !== undefined) scrollEl.scrollLeft = scrollSnapshotRef.current;
    if (sel) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`.board__columns [data-column-id="${sel.columnId}"] [data-card-id="${sel.id}"]`)?.focus();
      });
    }
  }

  // ---- Keyboard: roving tabindex within a column, cross-column arrows,
  // Enter opens, Esc closes and restores focus. -----------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (!selectedRef.current) return;
        e.preventDefault();
        closeDrawer();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.hasAttribute("data-card-id")) return;
      const columnId = active.getAttribute("data-column-id");
      const cardId = active.getAttribute("data-card-id");
      if (!columnId || !cardId) return;
      const col = modelRef.current.columns.find((c) => c.id === columnId);
      if (!col) return;

      if (e.key === "j" || e.key === "ArrowDown" || e.key === "k" || e.key === "ArrowUp") {
        const ids = col.cards.map((c) => c.id);
        const idx = ids.indexOf(cardId);
        const next = e.key === "j" || e.key === "ArrowDown" ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (next !== idx) {
          e.preventDefault();
          focusCard(columnId, ids[next]!);
        }
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const nonEmpty = modelRef.current.columns.filter((c) => c.cards.length > 0);
        const curIdx = nonEmpty.findIndex((c) => c.id === columnId);
        if (curIdx === -1) return;
        const rowIdx = col.cards.findIndex((c) => c.id === cardId);
        const targetIdx = curIdx + (e.key === "ArrowRight" ? 1 : -1);
        const target = nonEmpty[targetIdx];
        if (!target) return;
        e.preventDefault();
        const row = Math.min(rowIdx, target.cards.length - 1);
        focusCard(target.id, target.cards[row]!.id);
      } else if (e.key === "Enter") {
        e.preventDefault();
        openDrawer(cardId, columnId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Reads current state entirely through refs.
  }, []);

  const detail = selected ? drawerDetail(opera.find((o) => o.id === selected.id) ?? { id: selected.id, title: selected.id, kind: "", collegium: "", sella: "", state: "", tokens: 0, probationes: {}, traditio: undefined }, officina, inbox, eventsByItem[selected.id] ?? []) : undefined;

  return (
    <>
      <BoardView
        studio={officina.studio}
        model={model}
        selectedId={selected?.id}
        focusedByColumn={focusedByColumn}
        onSelectCard={(id, columnId) => openDrawer(id, columnId)}
        liveness={liveLabel({ connected, lastRefreshAt, now: new Date() })}
      />
      <BoardDrawer detail={detail} onClose={closeDrawer} />
    </>
  );
}
