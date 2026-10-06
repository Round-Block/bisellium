import { useEffect, useState } from "react";
import { fetchActa, fetchAerarium, fetchCompletion, fetchHealth, fetchOfficina } from "../api.js";
import type { AerariumEntry, CompletionResponse, HealthResponse, OfficinaResponse } from "../api.js";
import { formatPosture } from "../lib/posture.js";
import { healthStamp, integritySummary } from "../lib/officinaTruth.js";
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

const DEV_COMPLETION: CompletionResponse = {
  meter: {
    rows: [
      { id: "M1", title: "Build process, first version", weight: 10, done: 18, planned: 20, met: false, pct: 90 },
      { id: "M2", title: "Records you can trust", weight: 10, done: 6, planned: 24, met: false, pct: 25 },
    ],
    overall: 11.5,
  },
  estimate: { kind: "estimate", line: "Estimated finish: in about 14 days (10 to 28 days), around 20 Oct 2026, at the pace of the last 3 weeks." },
};

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

export interface OfficinaViewProps {
  aerarium: AerariumEntry[] | "failed" | undefined; // undefined = not loaded yet
  health: HealthResponse | "failed" | undefined;
  completion?: CompletionResponse | "failed"; // undefined = loading
  acta: ActaEntry[];
  now: Date;
}

/** The two health panels share one loading/failed copy; a loaded health gets the as-of stamp. */
function healthState(health: OfficinaViewProps["health"]): React.ReactNode {
  if (health === undefined) return <p className="officina__loading">Loading health…</p>;
  if (health === "failed") return <p className="officina__empty">Could not load health.</p>;
  return undefined;
}

const pct1 = (n: number): string => `${n.toFixed(1)}%`;

function Bar({ pct }: { pct: number }) {
  return (
    <div className="officina__bar">
      <div className="officina__bar-fill" style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
    </div>
  );
}

/** W-153: overall %, the estimate line verbatim, one row per milestone. */
function CompletionPanel({ completion }: { completion: OfficinaViewProps["completion"] }) {
  if (completion === undefined) return <p className="officina__loading">Loading completion…</p>;
  if (completion === "failed") return <p className="officina__empty">Could not load completion.</p>;
  if (completion.meter === null) return <p className="officina__empty">No milestone records</p>;
  return (
    <>
      <p className="officina__completion-overall">Overall {pct1(completion.meter.overall)}</p>
      <Bar pct={completion.meter.overall} />
      {completion.estimate && <p className="officina__completion-estimate">{completion.estimate.line}</p>}
      <div className="officina__completion-rows">
        {completion.meter.rows.map((r) => (
          <div key={r.id} className="officina__completion-row">
            <span className="officina__completion-id">{r.id}</span>
            <span className="officina__completion-title">{r.title}</span>
            <span className="officina__completion-points">{r.done}/{r.planned}</span>
            <span className="officina__completion-pct">{pct1(r.pct)}</span>
            <Bar pct={r.pct} />
          </div>
        ))}
      </div>
    </>
  );
}

export function Officina() {
  const [, setOfficina] = useState<OfficinaResponse>();
  const [aerarium, setAerarium] = useState<OfficinaViewProps["aerarium"]>();
  const [health, setHealth] = useState<OfficinaViewProps["health"]>();
  const [acta, setActa] = useState<ActaEntry[]>([]);
  const [completion, setCompletion] = useState<OfficinaViewProps["completion"]>();

  const demo = location.search.includes("demo");

  useEffect(() => {
    if (demo) {
      setAerarium(DEV_AERARIUM);
      setHealth(DEV_HEALTH);
      setActa(DEV_ACTA);
      setCompletion(DEV_COMPLETION);
      return;
    }
    fetchOfficina().then(setOfficina).catch(() => undefined);
    fetchAerarium().then(setAerarium).catch(() => setAerarium("failed"));
    fetchHealth().then(setHealth).catch(() => setHealth("failed"));
    fetchActa().then(setActa).catch(() => undefined);
    fetchCompletion().then(setCompletion).catch(() => setCompletion("failed"));
  }, [demo]);

  return <OfficinaView aerarium={aerarium} health={health} completion={completion} acta={acta} now={new Date()} />;
}

export function OfficinaView({ aerarium, health, completion, acta, now }: OfficinaViewProps) {
  const loaded = typeof health === "object" ? health : undefined;
  const summary = loaded ? integritySummary(loaded) : undefined;
  const asOf = loaded && <p className="officina__as-of">{healthStamp(loaded.at, now)}</p>;
  return (
    <div className="officina">
      <div className="officina__header">
        <h1 className="officina__title">Officina</h1>
      </div>

      <FastiStrip acta={acta} today={now} />

      <section className="officina__panel panel--completion">
        <h2 className="officina__panel-heading">Completion</h2>
        <CompletionPanel completion={completion} />
      </section>

      {/* Top row: Status (full width) */}
      <section className="officina__panel panel--status-wide">
        <h2 className="officina__panel-heading">Posture and burn</h2>
        {aerarium === undefined && <p className="officina__loading">Loading budget allocations…</p>}
        {aerarium === "failed" && <p className="officina__empty">Could not load budget allocations.</p>}
        {Array.isArray(aerarium) && aerarium.length === 0 && (
          <>
            <p className="officina__empty">No budget allocation is recorded for this week. Burn and posture are unavailable.</p>
            <p className="officina__empty">Set one with bisellium budget.</p>
          </>
        )}
        {Array.isArray(aerarium) && aerarium.length > 0 && (
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
        )}
      </section>

      {/* Bottom row: Pending actions (span 6) + Integrity (span 6) */}
      <section className="officina__panel panel--engine">
        <div className="officina__panel-header">
          <h2 className="officina__panel-heading">Pending actions</h2>
          {loaded && <span className="officina__count">{loaded.due.length}</span>}
        </div>
        {healthState(health)}
        {loaded && (
          <>
            {asOf}
            {loaded.due.length === 0 && <p className="officina__empty">Nothing pending.</p>}
            <div className="officina__table officina__table--zebra">
              {loaded.due.map((d, i) => (
                <div key={`${d.kind}:${d.id}:${i}`} className="officina__row">
                  <span className="officina__value-mono">{d.id}</span>
                  <span className="officina__label-secondary">{d.kind}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="officina__panel panel--integrity">
        <h2 className="officina__panel-heading">Contract integrity</h2>
        {healthState(health)}
        {summary && (
          <>
            {asOf}
            <p className="officina__integrity-summary">
              <span>{summary.stops}</span> <span>{summary.warns}</span>
            </p>
            <p className="officina__label">All findings by area</p>
            <div className="officina__table officina__table--zebra">
              {summary.rows.map((r) => (
                <details key={r.family} className="officina__row" title={r.rules.join(", ")}>
                  <summary>
                    <span className="officina__label">{r.label}</span>
                    <span className="officina__value-mono">{fmt(r.count)}</span>
                  </summary>
                  <p className="officina__rule-ids">{r.rules.join(", ")}</p>
                </details>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
