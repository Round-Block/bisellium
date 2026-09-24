/**
 * apps/web/src/screens/SeatsView.tsx — W-065: the decree surface's left
 * column (Agents.dc.html), presentational half. Props in, markup out;
 * `Seats.tsx` holds fetch, draft state and the confirm protocol.
 *
 * Layout, per the rulings: heading, the honesty line (covers both cards AND
 * a seat-only manifest), the Delegation card (ruling 2), the roster card,
 * a sticky confirm bar. Draft-and-confirm is scoped to this screen only —
 * `onDraft` never writes; a write happens solely from the confirm bar.
 */
import type { JSX } from "react";
import type { MunusRow, ModelRow, SeatRow, TierRow } from "../lib/delegation.js";

export interface SeatsViewProps {
  seats: SeatRow[];
  /** Declared tiers, not inferable from munera (ui-lead finding 2) — a tier
   *  held by no munus must still be visible in the legend. */
  tiers: TierRow[];
  munera: MunusRow[];
  /** The closed set the model <select> offers. */
  availableModels: ModelRow[];
  pending?: { kind: "seat" | "munus"; id: string; from: string; to: string };
  error?: string;
  onDraft: (kind: "seat" | "munus", id: string, to: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const HONESTY_LINE = "Changes are recorded only. They do not yet affect model dispatch or task routing.";

function modelOptionLabel(m: ModelRow): string {
  if (m.state === "unavailable") return `${m.id} — unavailable (${m.vendorDiagnostic ?? "no reply"})`;
  if (m.state === "unverified") return `${m.id} — unverified`;
  return m.id;
}

function tierHolderLabel(tierId: string, tiers: TierRow[]): string {
  const holder = tiers.find((t) => t.id === tierId)?.model;
  return `${tierId} · ${holder ?? "(no holder)"}`;
}

export function SeatsView(props: SeatsViewProps): JSX.Element {
  const { seats, tiers, munera, availableModels, pending, error, onDraft, onConfirm, onCancel, busy } = props;

  return (
    <div className="seats">
      <h1 className="seats__heading">Seats</h1>
      <p className="seats__honesty">{HONESTY_LINE}</p>

      <section className="seats__card seats__card--delegation" aria-labelledby="seats-delegation-heading">
        <h2 id="seats-delegation-heading" className="seats__card-heading">
          Delegation
        </h2>
        <table className="seats__table">
          <tbody>
            {munera.map((m) => (
              <tr key={m.id} className="seats__row">
                <td className="seats__munus-id">{m.id}</td>
                <td>
                  <select
                    aria-label={`tier for munus ${m.id}`}
                    value={pending?.kind === "munus" && pending.id === m.id ? pending.to : m.tier}
                    disabled={busy}
                    onChange={(e) => onDraft("munus", m.id, e.target.value)}
                  >
                    {!m.tierKnown && (
                      <option value={m.tier} selected disabled>
                        {m.tier} (unresolved)
                      </option>
                    )}
                    {tiers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {tierHolderLabel(t.id, tiers)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="seats__tier-legend">
          {tiers.map((t) => (
            <li key={t.id} className="seats__tier-legend-item">
              {tierHolderLabel(t.id, tiers)}
            </li>
          ))}
        </ul>
      </section>

      <section className="seats__card seats__card--roster" aria-labelledby="seats-roster-heading">
        <h2 id="seats-roster-heading" className="seats__card-heading">
          Roster
        </h2>
        <table className="seats__table">
          <tbody>
            {seats.map((s) => (
              <tr key={s.id} className="seats__row">
                <td className="seats__seat-id">{s.id}</td>
                <td className="seats__seat-collegium">{s.collegium}</td>
                <td className="seats__seat-kind">{s.kind} ·</td>
                <td>
                  {s.kind !== "human" && (
                    <select
                      aria-label={`model for seat ${s.id}`}
                      value={pending?.kind === "seat" && pending.id === s.id ? pending.to : (s.model ?? "")}
                      disabled={busy}
                      onChange={(e) => onDraft("seat", s.id, e.target.value)}
                    >
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id} disabled={m.state !== "available" && !m.seated}>
                          {modelOptionLabel(m)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {pending && (
        <div
          className="seats__confirm-bar"
          role="region"
          aria-label="confirm change"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) onConfirm();
          }}
        >
          <span className="seats__confirm-target">
            {pending.kind === "seat" ? "seat" : "munus"} "{pending.id}"
          </span>
          <span className="seats__confirm-from">{pending.from}</span>
          <span className="seats__confirm-arrow">{"->"}</span>
          <span className="seats__confirm-to">{pending.to}</span>
          <span className="seats__confirm-destination">bisellium.yml</span>
          {error && <span className="seats__confirm-error">{error}</span>}
          <button type="button" className="seats__confirm-btn" disabled={busy} onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" className="seats__cancel-btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
