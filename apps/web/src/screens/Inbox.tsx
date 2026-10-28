import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { fetchInbox, submitAnswer, type InboxResponse } from "../api.js";
import { InboxView } from "./InboxView.js";
import {
  answerOptions,
  buildReply,
  isTextEntryTarget,
  moveFocus,
  recordedEffect,
  reconcileFocusIndex,
  reasonForPetition,
  resolveVerbAction,
  withReasonForPetition,
  decodeInboxReadSet,
  encodeInboxReadSet,
  INBOX_READ_STORAGE_KEY,
  type Verb,
} from "./inboxLogic.js";
import { screenStatus, type ScreenStatus } from "../lib/screenState.js";
import { useVisibleRefresh } from "../lib/useVisibleRefresh.js";

const EMPTY: InboxResponse = { opera: [], petitiones: [] };

const DEV_DATA: InboxResponse = {
  opera: [],
  petitiones: [
    {
      id: "P-008", opus: "W-026", from: "architect",
      opened: Date.UTC(2026, 9, 27, 8),
      subject: "Approve the Outlook-style Inbox decision layout",
      body: "The Inbox now keeps the needs-you list beside an independently scrolling reading pane on wide screens, then changes to list and full-screen detail navigation below 840px. Review the [design direction](docs/design/DIRECTION.md) and [served evidence](https://example.test/W-407). Recommend approval.",
    },
    {
      id: "P-009", opus: "W-024", from: "builder-a",
      opened: Date.UTC(2026, 9, 25, 8),
      subject: "Review inbox keyboard navigation edge case",
      body: "When the inbox has exactly one petitio and the user presses 'k' (move up), focusIndex wraps to -1 on the next render before the clamp in moveFocus catches it. This causes a brief flash of no-selection state. Proposed fix: clamp focusIndex to [0, length-1] inside the state setter callback rather than in moveFocus. The fix is two lines in Inbox.tsx. No test changes needed — the existing inboxLogic tests already cover the boundary, but the React state update order wasn't exercised.",
    },
    {
      id: "P-010", opus: "W-025", from: "censor",
      opened: Date.UTC(2026, 9, 20, 8),
      subject: "Confirm gate-ladder mark alignment at 3px gaps",
      body: "QA found that gate-ladder marks render at 3px height with a 2px border-radius, which on non-retina displays can produce a visible rounding artifact — the bottom-left pixel appears clipped. This only affects the half-height variant (waived gates). Options: (A) reduce border-radius to 1px for half-height marks only, (B) increase mark height to 4px, or (C) accept the artifact as imperceptible at normal zoom. Recommending option A — smallest change, no layout shift.",
    },
  ],
};

const WRITE_FAILED = "Could not send the answer.";

export function Inbox({ onStatus, onNeedsYouCount }: { onStatus?: (status: ScreenStatus) => void; onNeedsYouCount?: (count: number) => void } = {}): JSX.Element {
  const [data, setData] = useState<InboxResponse>(EMPTY);
  const [focusIndex, setFocusIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  // W-341: the read and write outcomes the states matrix names. A failed read never invents petitions.
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [detachedPetition, setDetachedPetition] = useState<InboxResponse["petitiones"][number] | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [outcome, setOutcome] = useState<"refused" | "error" | undefined>(undefined);
  const [readPetitionIds, setReadPetitionIds] = useState<Set<string>>(() => {
    try { return decodeInboxReadSet(localStorage.getItem(INBOX_READ_STORAGE_KEY)); }
    catch { return new Set(); }
  });

  const demo = location.search.includes("demo");
  const dataRef = useRef(data);
  const focusIndexRef = useRef(focusIndex);
  const expandedIdRef = useRef(expandedId);
  const detachedPetitionRef = useRef(detachedPetition);
  const hasSuccessfulLoadRef = useRef(false);
  const refreshingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const onNeedsYouCountRef = useRef(onNeedsYouCount);
  const refreshIntentRef = useRef<{ preferredIndex: number; reopenDetail: boolean; reveal: boolean } | null>(null);
  dataRef.current = data;
  focusIndexRef.current = focusIndex;
  expandedIdRef.current = expandedId;
  detachedPetitionRef.current = detachedPetition;
  onNeedsYouCountRef.current = onNeedsYouCount;

  const refreshInbox = useCallback((): void => {
    if (refreshingRef.current) {
      if (refreshIntentRef.current !== null) pendingRefreshRef.current = true;
      return;
    }
    refreshingRef.current = true;
    const intent = refreshIntentRef.current;
    refreshIntentRef.current = null;
    const settle = (d: InboxResponse): void => {
      const current = dataRef.current.petitiones;
      const currentIndex = focusIndexRef.current;
      const currentPetition = detachedPetitionRef.current ?? current[currentIndex];
      const currentId = currentPetition?.id;
      const retainedIndex = currentId === undefined ? -1 : d.petitiones.findIndex((petitio) => petitio.id === currentId);
      const keepDetached = intent === null && refreshIntentRef.current === null && currentPetition !== undefined && retainedIndex < 0;
      const nextIndex = retainedIndex >= 0
        ? retainedIndex
        : reconcileFocusIndex(intent?.preferredIndex ?? currentIndex, d.petitiones.length);
      const detailWasOpen = intent?.reopenDetail ?? expandedIdRef.current !== null;
      setData(d);
      setFocusIndex(nextIndex);
      setDetachedPetition(keepDetached ? currentPetition : null);
      setExpandedId(detailWasOpen ? (keepDetached ? currentPetition.id : (d.petitiones[nextIndex]?.id ?? null)) : null);
      if (intent?.reveal && d.petitiones.length > 0) setFocusRequest((request) => request + 1);
      onNeedsYouCountRef.current?.(d.petitiones.length);
      hasSuccessfulLoadRef.current = true;
      setLoaded(true);
      setReadFailed(false);
    };
    if (demo) {
      settle(DEV_DATA);
      refreshingRef.current = false;
      return;
    }
    void fetchInbox()
      .then((d) => {
        settle(d);
      })
      .catch(() => {
        if (!hasSuccessfulLoadRef.current) setData(EMPTY);
        setLoaded(true);
        setReadFailed(true);
      })
      .finally(() => {
        refreshingRef.current = false;
        if (pendingRefreshRef.current || refreshIntentRef.current !== null) {
          pendingRefreshRef.current = false;
          refreshInbox();
        }
      });
  }, [demo]);

  useVisibleRefresh(refreshInbox);

  const petitiones = data.petitiones;
  const focusedId = petitiones[focusIndex]?.id;
  const decisionId = detachedPetition?.id ?? focusedId;
  const reason = reasonForPetition(reasons, decisionId);
  const decisionUnavailable = detachedPetition !== null;

  function chooseIndex(index: number): void {
    setDetachedPetition(null);
    setFocusIndex(index);
  }

  function markRead(petitioId: string): void {
    setReadPetitionIds((current) => {
      const next = new Set(current).add(petitioId);
      try {
        localStorage.setItem(INBOX_READ_STORAGE_KEY, encodeInboxReadSet(next));
        return next;
      } catch {
        return new Set();
      }
    });
  }

  useEffect(() => {
    if (!decisionUnavailable && focusedId !== undefined && window.matchMedia("(min-width: 840px)").matches) markRead(focusedId);
  }, [focusedId, decisionUnavailable]);

  useEffect(() => {
    setFocusIndex((index) => reconcileFocusIndex(index, petitiones.length));
  }, [petitiones.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (isTextEntryTarget(e.target)) return;
      if (e.key === "j" || e.key === "k") {
        setDetachedPetition(null);
        setFocusIndex((i) => {
          const next = moveFocus(i, petitiones.length, e.key as "j" | "k");
          if (expandedId !== null) setExpandedId(petitiones[next]?.id ?? null);
          if (window.matchMedia("(min-width: 840px)").matches && petitiones[next] !== undefined) markRead(petitiones[next]!.id);
          return next;
        });
        setFocusRequest((request) => request + 1);
        return;
      }
      if (e.key === "Enter" && focusedId !== undefined) {
        markRead(focusedId);
        setExpandedId(focusedId);
        return;
      }
      if (e.key === "Escape") {
        const target = e.target as { closest?: (selector: string) => Element | null } | null;
        if (typeof target?.closest === "function" && target.closest(".sidebar") !== null) return;
        if (expandedId === null) return;
        setExpandedId(null);
        setFocusRequest((request) => request + 1);
        return;
      }
      const decisionVisible = !decisionUnavailable && (window.matchMedia("(min-width: 840px)").matches || expandedId !== null);
      const action = resolveVerbAction(e.key, decisionVisible ? (focusedId ?? null) : null, focusedId, reason);
      if (action) submit(action.petitioId, action.verb);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [petitiones, focusedId, expandedId, reason, decisionUnavailable]);

  function submit(petitioId: string, verb: Verb): void {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    setConfirmation(undefined);
    setOutcome(undefined);
    setSending(true);
    void submitAnswer(petitioId, buildReply(verb, reason), answerOptions(verb)).then((result) => {
      sendingRef.current = false;
      setSending(false);
      // "unauthorized" is handled at the app shell (TokenPrompt reopens) —
      // no local handling here. "ok"/"refused"/"error" are this screen's.
      if (result.kind === "ok") {
        setReasons((current) => withReasonForPetition(current, petitioId, ""));
        setConfirmation(recordedEffect(verb, petitioId));
        if (!demo) {
          refreshIntentRef.current = { preferredIndex: focusIndex, reopenDetail: expandedId !== null, reveal: true };
          refreshInbox();
        }
      } else if (result.kind === "refused") {
        setError(result.output || "refused");
        setOutcome("refused");
      } else if (result.kind === "error") {
        setError("error submitting the answer");
        setOutcome("error");
      }
    });
  }

  const status = screenStatus("inbox", {
    loaded,
    empty: data.petitiones.length === 0 && data.opera.length === 0,
    failed: outcome === "error" ? WRITE_FAILED : readFailed ? true : undefined,
    refused: outcome === "refused" ? (error ?? "") : undefined,
    pending: sending,
  });
  const reportedStatus = confirmation !== undefined && (status.state === "ready" || status.state === "empty") ? { state: "ready" as const, text: confirmation } : status;
  useEffect(() => onStatus?.(reportedStatus), [reportedStatus.state, reportedStatus.text]);

  return (
    <InboxView
      petitiones={data.petitiones}
      opera={data.opera}
      focusIndex={focusIndex}
      expandedId={expandedId}
      focusRequest={focusRequest}
      reason={reason}
      error={error}
      confirmation={confirmation}
      notice={status.state === "loading" || status.state === "pending" || (status.state === "error" && outcome === undefined) ? status.text : undefined}
      busy={sending}
      readPetitionIds={readPetitionIds}
      detachedPetition={detachedPetition}
      decisionUnavailable={decisionUnavailable}
      onReasonChange={(value) => {
        if (decisionId !== undefined) setReasons((current) => withReasonForPetition(current, decisionId, value));
      }}
      onFocusChange={chooseIndex}
      onExpandChange={setExpandedId}
      onRead={markRead}
      onReturnToList={() => setFocusRequest((request) => request + 1)}
      onSubmit={submit}
    />
  );
}
