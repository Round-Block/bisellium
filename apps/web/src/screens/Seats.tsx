/**
 * apps/web/src/screens/Seats.tsx — W-065: fetch + draft state for the
 * decree surface. No token UI, no 401 handling of its own — `postWrite`
 * (via `submitDelegate`) raises the app-shell's shared TokenPrompt on a
 * 401, screen-agnostic (W-067).
 */
import { useEffect, useRef, useState, type JSX } from "react";
import { fetchModels, fetchOfficina, submitDelegate, type ModelRecordEntry, type OfficinaResponse } from "../api.js";
import { availableModels, munusRows, seatRows, tierRows } from "../lib/delegation.js";
import { SeatsView } from "./SeatsView.js";
import { screenStatus, type ScreenStatus } from "../lib/screenState.js";

// W-064's recorded handoff (Files owned): `lifecycle` is required on
// OfficinaResponse, so this fixture gains a literal — one line, not a
// restructure of this screen.
const EMPTY: OfficinaResponse = { studio: "", patron: "", collegia: [], sellae: [], probationes: [], lifecycle: { id: "", states: [] } };

type Pending = { kind: "seat" | "munus"; id: string; from: string; to: string };

const WRITE_FAILED = "Could not record the change.";

export function Seats({ onStatus }: { onStatus?: (status: ScreenStatus) => void } = {}): JSX.Element {
  const [officina, setOfficina] = useState<OfficinaResponse>(EMPTY);
  const [models, setModels] = useState<ModelRecordEntry[] | undefined>(undefined);
  const [modelsSettled, setModelsSettled] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // W-341: the officina read's outcome and the last write's, as the states matrix names them.
  const [loaded, setLoaded] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [outcome, setOutcome] = useState<"refused" | "error" | undefined>(undefined);
  // A ref, not just the `busy` state: React batches state updates, so two
  // synchronous clicks arriving in the same tick (a real browser dispatches
  // a native click on a not-yet-disabled button faster than a re-render can
  // land) would both still see the stale `busy === false` closure. A ref's
  // `.current` is read and written synchronously, so the second click is
  // blocked before it can ever call submitDelegate.
  const inFlight = useRef(false);

  function reload(): void {
    setModelsSettled(false);
    fetchOfficina()
      .then((o) => {
        setOfficina(o);
        setLoaded(true);
        setReadFailed(false);
      })
      .catch(() => setReadFailed(true));
    // GET /api/models is the merged (live-listing) view — see api.ts's own
    // header. A failed fetch here just leaves `models` at its last value
    // (or undefined, the floor), same "never empties the dropdown" spirit
    // the server route itself follows.
    fetchModels()
      .then(setModels)
      .catch(() => undefined)
      .finally(() => setModelsSettled(true));
  }

  useEffect(() => {
    reload();
  }, []);

  const seats = seatRows(officina);
  const tiers = tierRows(officina);
  const munera = munusRows(officina);
  const rows = availableModels({ sellae: officina.sellae, tiers: officina.tiers, models: models ?? officina.models });

  function currentValue(kind: "seat" | "munus", id: string): string {
    if (kind === "seat") return seats.find((s) => s.id === id)?.model ?? "";
    return munera.find((m) => m.id === id)?.tier ?? "";
  }

  function onDraft(kind: "seat" | "munus", id: string, to: string): void {
    setError(undefined);
    setOutcome(undefined);
    setPending({ kind, id, from: currentValue(kind, id), to });
  }

  function onCancel(): void {
    setPending(undefined);
    setError(undefined);
    setOutcome(undefined);
  }

  function onConfirm(): void {
    if (!pending || inFlight.current) return; // no second request while one is pending
    inFlight.current = true;
    setBusy(true);
    setOutcome(undefined);
    const body = pending.kind === "seat" ? { sella: pending.id, model: pending.to, from: pending.from } : { munus: pending.id, tier: pending.to, from: pending.from };
    void submitDelegate(body).then((result) => {
      inFlight.current = false;
      setBusy(false);
      // "unauthorized" is handled at the app shell (TokenPrompt reopens) —
      // no local handling here, same convention Inbox.tsx already uses.
      if (result.kind === "ok") {
        setPending(undefined);
        setError(undefined);
        reload();
      } else if (result.kind === "refused") {
        // A refusal (e.g. a stale --from) keeps the draft — the Patron sees
        // the conflict and decides, rather than losing what they typed.
        setError(result.output || "refused");
        setOutcome("refused");
      } else if (result.kind === "error") {
        setError("error submitting the change");
        setOutcome("error");
      }
    });
  }

  const status = screenStatus("seats", {
    loaded: loaded && modelsSettled,
    empty: seats.length === 0 && munera.length === 0,
    failed: outcome === "error" ? WRITE_FAILED : readFailed ? true : undefined,
    refused: outcome === "refused" ? (error ?? "") : undefined,
    pending: busy,
  });
  useEffect(() => onStatus?.(status), [status.state, status.text]);

  return (
    <SeatsView
      seats={seats}
      tiers={tiers}
      munera={munera}
      availableModels={rows}
      pending={pending}
      error={error}
      onDraft={onDraft}
      onConfirm={onConfirm}
      onCancel={onCancel}
      busy={busy}
      notice={status.state === "loading" || status.state === "empty" || (status.state === "error" && outcome === undefined) ? status.text : undefined}
    />
  );
}
