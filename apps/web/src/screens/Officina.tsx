import { useEffect, useState } from "react";
import { fetchAerarium, fetchHealth, fetchOfficina } from "../api.js";
import type { AerariumEntry, HealthResponse, OfficinaResponse } from "../api.js";
import { formatPosture } from "../lib/posture.js";
import { FastiStrip } from "../components/FastiStrip.js";
import type { ActaEntry } from "../lib/fasti.js";

function fmt(n: number): string {
  return n.toLocaleString();
}

function pieColor(ratio: number): string {
  if (ratio < 0.5) return "var(--ok)";
  if (ratio < 0.8) return "var(--amber)";
  return "var(--bad)";
}

function pieStyle(spent: number, allowance: number): React.CSSProperties {
  const ratio = allowance > 0 ? Math.min(spent / allowance, 1) : 0;
  const deg = Math.round(ratio * 360);
  const color = pieColor(ratio);
  return { background: `conic-gradient(${color} 0deg ${deg}deg, var(--rule) ${deg}deg 360deg)` };
}

const DEV_AERARIUM: AerariumEntry[] = [
  { collegium: "production", period: "2026-W38", allowance: { tokens: 200_000 }, burn: { tokens: 47_200 }, posture: "ok" },
  { collegium: "engineering", period: "2026-W38", allowance: { tokens: 3_000_000 }, burn: { tokens: 1_880_000 }, posture: "conserve" },
  { collegium: "qa", period: "2026-W38", allowance: { tokens: 500_000 }, burn: { tokens: 312_000 }, posture: "ok" },
];

const DEV_ACTA: ActaEntry[] = [
  { id: "cascade-7", author: "opus-4.6", kind: "cascade", title: "Cascade 7", at: "2026-09-17T10:00:00Z", evidence: null },
  { id: "cascade-8", author: "opus-4.6", kind: "cascade", title: "Cascade 8", at: "2026-09-18T14:00:00Z", evidence: null },
  { id: "cascade-9", author: "sonnet-5", kind: "cascade", title: "Cascade 9", at: "2026-09-19T09:00:00Z", evidence: null },
];

const DEV_HEALTH: HealthResponse = {
  at: "2026-09-19T14:00:00.000Z",
  ok: false,
  blocks: 0,
  advisories: 4,
  findingsByRule: { "acta.daily": 2, "opus.untracked": 1, "link.dead": 1 },
  autonomy: { paused: false },
  lastTick: "2026-09-19T13:48:22.091Z",
  due: [
    { kind: "retro", id: "cascade-8" },
    { kind: "tick", id: "daily" },
  ],
};

export function Officina() {
  const [, setOfficina] = useState<OfficinaResponse>();
  const [aerarium, setAerarium] = useState<AerariumEntry[]>([]);
  const [health, setHealth] = useState<HealthResponse>();
  const [acta, setActa] = useState<ActaEntry[]>([]);

  const demo = location.search.includes("demo");

  useEffect(() => {
    if (demo) {
      setAerarium(DEV_AERARIUM);
      setHealth(DEV_HEALTH);
      setActa(DEV_ACTA);
      return;
    }
    fetchOfficina().then(setOfficina).catch(() => undefined);
    fetchAerarium().then(setAerarium).catch(() => setAerarium(DEV_AERARIUM));
    fetchHealth().then(setHealth).catch(() => setHealth(DEV_HEALTH));
  }, [demo]);

  return (
    <div className="officina">
      <div className="officina__header">
        <h1 className="officina__title">Officina</h1>
      </div>

      <FastiStrip acta={acta} today={new Date()} />

      {/* Top row: Status (full width) */}
      <section className="officina__panel panel--status-wide">
        <h2 className="officina__panel-heading">System status</h2>
        <div className="officina__grid-3col">
          {aerarium.map((entry) => {
            const { word, reason } = formatPosture(entry);
            return (
              <div key={entry.collegium} className="officina__metric-card">
                <span className="officina__collegium-name">{entry.collegium}</span>
                <div className="officina__posture-row">
                  <div className="officina__pie" style={pieStyle(entry.burn.tokens, entry.allowance.tokens)} />
                  <div className="officina__posture-text">
                    <span className="officina__posture-word">{word}</span>
                    <span className="officina__posture-reason">{reason}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom row: Engine (span 6) + Integrity (span 6) */}
      <section className="officina__panel panel--engine">
        <h2 className="officina__panel-heading">Process engine</h2>
        {health && (
          <>
            <div className="officina__metric-card">
              <span className="officina__metric-label">Engine state</span>
              <span className="officina__value-status">
                {health.autonomy.paused ? "Paused" : "Autonomous"}
              </span>
            </div>
            {health.due.length > 0 && (
              <>
                <div className="officina__panel-header" style={{ marginTop: 12 }}>
                  <span className="officina__label">Pending actions</span>
                  <span className="officina__count">{health.due.length}</span>
                </div>
                <div className="officina__table officina__table--zebra">
                  {health.due.map((d) => (
                    <div key={`${d.kind}:${d.id}`} className="officina__row">
                      <span className="officina__value-mono">{d.id}</span>
                      <span className="officina__label-secondary">{d.kind}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="officina__panel panel--integrity">
        <h2 className="officina__panel-heading">Contract integrity</h2>
        {health && (
          <>
            <div className="officina__grid-2col">
              <div className="officina__metric-card">
                <span className="officina__metric-label">Blocking issues</span>
                <span className="officina__metric-value">{fmt(health.blocks)}</span>
              </div>
              <div className="officina__metric-card">
                <span className="officina__metric-label">Advisory alerts</span>
                <span className="officina__metric-value">{fmt(health.advisories)}</span>
              </div>
            </div>
            {Object.keys(health.findingsByRule).length > 0 && (
              <div className="officina__table officina__table--zebra">
                {Object.entries(health.findingsByRule).map(([rule, count]) => (
                  <div key={rule} className="officina__row">
                    <span className="officina__label">{rule}</span>
                    <span className="officina__value-mono">{fmt(count)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
