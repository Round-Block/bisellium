/**
 * apps/web/src/lib/delegation.ts — W-065 behaviour 3: pure resolvers over
 * D-023's two decree records (`sellae[].model`, `tiers`/`munera`) plus the
 * probe record (`OfficinaResponse.models`, from `<studio>/models.json`,
 * merged with a live vendor listing server-side before it reaches here —
 * see studio/briefs/W-065.md "GET /api/models"). Nothing here dispatches on
 * either decree (W-065's own honest claim); this module only renders what
 * the records already say.
 */
import type { MunusEntry, OfficinaResponse, TierEntry } from "../api.js";

export interface SeatRow {
  id: string;
  collegium: string;
  kind: string;
  model?: string;
  harness?: string;
}

export interface TierRow {
  id: string;
  model?: string;
}

export interface MunusRow {
  id: string;
  tier: string;
  model?: string;
  tierKnown: boolean;
}

export type ModelState = "available" | "unavailable" | "unverified";

export interface ModelRow {
  id: string;
  state: ModelState;
  harness?: string;
  /** W-046 behaviour 7's surface, reused verbatim — the vendor's own words on
   *  a failed probe. Present only when state is "unavailable". */
  vendorDiagnostic?: string;
  /** True when this model is seated; such a row is selectable whatever its
   *  state, so a seat can always render its own value. */
  seated: boolean;
}

export function seatRows(o: Pick<OfficinaResponse, "sellae">): SeatRow[] {
  return (o.sellae ?? []).map((s) => ({
    id: s.id,
    collegium: s.collegium,
    kind: s.kind ?? "agent",
    model: s.model,
    harness: s.harness,
  }));
}

export function tierRows(o: Pick<OfficinaResponse, "tiers">): TierRow[] {
  return (o.tiers ?? []).map((t) => ({ id: t.id, model: t.model }));
}

export function munusRows(o: Pick<OfficinaResponse, "tiers" | "munera">): MunusRow[] {
  const tierModel = new Map((o.tiers ?? []).map((t) => [t.id, t.model] as const));
  return (o.munera ?? []).map((m) => {
    const tierKnown = tierModel.has(m.tier);
    return { id: m.id, tier: m.tier, model: tierKnown ? tierModel.get(m.tier) : undefined, tierKnown };
  });
}

/**
 * Renders the probe record (`o.models`, already merged with any live vendor
 * listing upstream — see the file header); it never probes and never
 * dispatches. The manifest's own records are then layered on top so the
 * control this feeds can never be asked to render a value it doesn't offer:
 *
 * - a seated model (`sellae[].model`) is always present with `seated: true`,
 *   whatever the record does or doesn't say about it;
 * - a declared tier's holder (`tiers[].model`) is always present too — a
 *   tier's model is a valid dropdown choice per the Patron's decree even
 *   before any sella is reseated onto it — but is not marked `seated`
 *   (nothing SEATS it; a tier holds it);
 * - anything else comes straight from the record, unmodified.
 *
 * `ponytail:` "attested" models (`gen_ai.request.model` from the event log)
 * are not folded in here — this function's own inputs (sellae/tiers/models)
 * carry no event-log data, and a browser module has no business reading
 * `events.jsonl` itself. If a future opus wants the event log's models
 * offered too, the natural seam is GET /api/models baking them into the
 * record it returns, not this function reaching further than its signature
 * allows.
 */
export function availableModels(o: Pick<OfficinaResponse, "sellae" | "tiers" | "models">): ModelRow[] {
  const rows = new Map<string, ModelRow>();

  for (const m of o.models ?? []) {
    rows.set(m.id, { id: m.id, state: m.state, harness: m.harness, vendorDiagnostic: m.vendorDiagnostic, seated: false });
  }

  for (const t of o.tiers ?? []) {
    if (t.model && !rows.has(t.model)) rows.set(t.model, { id: t.model, state: "unverified", seated: false });
  }

  for (const s of o.sellae ?? []) {
    if (!s.model) continue;
    const existing = rows.get(s.model);
    rows.set(s.model, { ...(existing ?? { id: s.model, state: "unverified" }), seated: true });
  }

  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Re-exported so callers importing only from this module don't also need
// api.js for the two manifest record shapes.
export type { MunusEntry, TierEntry };
