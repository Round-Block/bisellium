/**
 * apps/web/src/screens/Officina.tsx — DIRECTION.md §6 "Officina": the
 * fasti strip, then four panels stacked between hairlines (decreta
 * pending, posture and burn, lex status, process health), then the
 * colophon. Panel order is pinned by ../lib/officinaLayout.ts
 * (`OFFICINA_SECTIONS`) and covered by behaviour 10's test — keep this
 * markup's order in sync with that list.
 *
 * `fetchInbox` (decreta pending) is W-024's export on the shared,
 * append-only `../api.js` — present once W-024's build merges into this
 * one; this screen imports it by contract, not by re-implementing it.
 */
import { useEffect, useState } from "react";
// `fetchInbox` is W-024's export on this shared, append-only module — see
// the header note above; it isn't in this worktree's ../api.ts yet.
import { fetchAerarium, fetchActa, fetchHealth, fetchInbox, fetchOfficina } from "../api.js";
import type { AerariumEntry, HealthResponse, OfficinaResponse } from "../api.js";
import type { ActaEntry } from "../lib/fasti.js";
import { formatPosture } from "../lib/posture.js";
import { FastiStrip } from "../components/FastiStrip.js";
import { BurnBar } from "../components/BurnBar.js";
// W-024's component, reused verbatim (DIRECTION.md §4.5).
import { Colophon } from "../components/Colophon.js";

interface Petitio {
  id: string;
  opus: string;
  from: string;
  subject: string;
}

export function Officina() {
  const [officina, setOfficina] = useState<OfficinaResponse>();
  const [aerarium, setAerarium] = useState<AerariumEntry[]>([]);
  const [health, setHealth] = useState<HealthResponse>();
  const [acta, setActa] = useState<ActaEntry[]>([]);
  const [petitiones, setPetitiones] = useState<Petitio[]>([]);

  useEffect(() => {
    fetchOfficina().then(setOfficina).catch(() => undefined);
    fetchAerarium().then(setAerarium).catch(() => undefined);
    fetchHealth().then(setHealth).catch(() => undefined);
    fetchActa(14).then(setActa).catch(() => undefined);
    fetchInbox()
      .then((r) => setPetitiones(r.petitiones))
      .catch(() => undefined);
  }, []);

  return (
    <div className="officina">
      <FastiStrip acta={acta} today={new Date()} />

      <section className="officina__panel">
        <h2 className="officina__panel-heading">Decreta pending</h2>
        <div>{petitiones.length} waiting</div>
        {petitiones.map((p) => (
          <div key={p.id}>{p.subject}</div>
        ))}
      </section>

      <section className="officina__panel">
        <h2 className="officina__panel-heading">Posture and burn</h2>
        {aerarium.map((entry) => {
          const { word, reason } = formatPosture(entry);
          return (
            <div key={entry.collegium}>
              <div className="officina__posture-word">{word}</div>
              <div className="officina__posture-reason">{reason}</div>
              <BurnBar spent={entry.burn.tokens} allowance={entry.allowance.tokens} />
            </div>
          );
        })}
      </section>

      <section className="officina__panel">
        <h2 className="officina__panel-heading">Lex status</h2>
        {health && (
          <>
            <div>blocks: {health.blocks}</div>
            <div>advisories: {health.advisories}</div>
            <ul>
              {Object.entries(health.findingsByRule).map(([rule, count]) => (
                <li key={rule}>
                  {rule}: {count}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="officina__panel">
        <h2 className="officina__panel-heading">Process health</h2>
        {health && (
          <>
            <div>ok: {String(health.ok)}</div>
            <div>autonomy: {health.autonomy.paused ? "paused" : "running"}</div>
            <div>last tick: {health.lastTick}</div>
            <ul>
              {health.due.map((d) => (
                <li key={`${d.kind}:${d.id}`}>
                  {d.kind}: {d.id}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <Colophon studioPath={officina?.studio ?? ""} />
    </div>
  );
}
