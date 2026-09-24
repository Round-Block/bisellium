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

const EMPTY: OfficinaResponse = { studio: "", patron: "", collegia: [], sellae: [], probationes: [] };

type Pending = { kind: "seat" | "munus"; id: string; from: string; to: string };

export function Seats(): JSX.Element {
  const [officina, setOfficina] = useState<OfficinaResponse>(EMPTY);
  const [models, setModels] = useState<ModelRecordEntry[] | undefined>(undefined);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // A ref, not just the `busy` state: React batches state updates, so two
  // synchronous clicks arriving in the same tick (a real browser dispatches
  // a native click on a not-yet-disabled button faster than a re-render can
  // land) would both still see the stale `busy === false` closure. A ref's
  // `.current` is read and written synchronously, so the second click is
  // blocked before it can ever call submitDelegate.
  const inFlight = useRef(false);

  function reload(): void {
    fetchOfficina()
      .then(setOfficina)
      .catch(() => undefined);
    // GET /api/models is the merged (live-listing) view — see api.ts's own
    // header. A failed fetch here just leaves `models` at its last value
    // (or undefined, the floor), same "never empties the dropdown" spirit
    // the server route itself follows.
    fetchModels()
      .then(setModels)
      .catch(() => undefined);
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
    setPending({ kind, id, from: currentValue(kind, id), to });
  }

  function onCancel(): void {
    setPending(undefined);
    setError(undefined);
  }

  function onConfirm(): void {
    if (!pending || inFlight.current) return; // no second request while one is pending
    inFlight.current = true;
    setBusy(true);
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
      } else if (result.kind === "error") {
        setError("error submitting the change");
      }
    });
  }

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
    />
  );
}
