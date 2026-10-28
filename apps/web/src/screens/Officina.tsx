import React, { useCallback, useEffect, useState } from "react";
import { fetchAerarium, fetchHealth, fetchOfficina, fetchOpera, submitPause, submitResume } from "../api.js";
import type { AerariumEntry, HealthResponse, OfficinaResponse, OpusEntry } from "../api.js";
import { boardModel } from "../lib/board.js";
import { officinaWorkGroups } from "../lib/officinaWork.js";
import { formatPosture } from "../lib/posture.js";
import { integritySummary } from "../lib/officinaTruth.js";
import { useVisibleRefresh } from "../lib/useVisibleRefresh.js";
import { BurnBar } from "../components/BurnBar.js";
import { screenStatus, type ScreenStatus } from "../lib/screenState.js";

const DEV_AERARIUM: AerariumEntry[] = [
  { collegium: "engineering", period: "2026-W44", allowance: { tokens: 3_000_000 }, burn: { tokens: 1_880_000 }, posture: "conserve" },
  { collegium: "production", period: "2026-W44", allowance: { tokens: 500_000 }, burn: { tokens: 650_000 }, posture: "closeout" },
];
const DEV_HEALTH: HealthResponse = {
  at: "2026-10-28T00:00:00Z", ok: false, blocks: 1, advisories: 3,
  findingsByRule: { "traditio.stage": 2, "opus.untracked": 1 }, autonomy: { paused: false },
  lastTick: "2026-10-28T00:00:00Z", due: [{ kind: "daily", id: "producer" }, { kind: "traditio", id: "W-408" }],
};
const DEV_OFFICINA: OfficinaResponse = {
  studio: "studio", patron: "patron", collegia: [], sellae: [], probationes: [{ id: "patron", kind: "human" }], wip_limit: 4,
  lifecycle: { id: "opus", states: [
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "spec_review", name: "Spec review", phase: "awaiting_review" },
    { id: "blocked", name: "Blocked", phase: "halted" },
    { id: "done", name: "Done", phase: "done" },
  ] },
};
const opus = (id: string, state: string, pending?: string): OpusEntry => ({
  id, title: `${id} officina work`, body: "", kind: "ui", collegium: "engineering", sella: "builder", state, tokens: 0,
  probationes: pending ? { [pending]: { status: "pending" } } : {}, traditio: undefined,
});
const DEV_OPERA = [opus("W-408", "building", "patron"), opus("W-407", "spec_review"), opus("W-415", "building", "ci"), opus("W-406", "blocked")];

type ReadState<T> = T | "failed" | undefined;
type Severity = "blocking" | "high" | "normal" | "low";

function SeverityCue({ level }: { level: Severity }) {
  return <span className={`severity-cue severity-cue--${level}`} aria-hidden="true" />;
}

export interface OfficinaViewProps {
  aerarium: ReadState<AerariumEntry[]>;
  health: ReadState<HealthResponse>;
  officina: ReadState<OfficinaResponse>;
  opera: ReadState<OpusEntry[]>;
  brakePending?: boolean;
  brakeMessage?: string;
  onBrake?: () => void;
}

export function Officina({ onStatus }: { onStatus?: (status: ScreenStatus) => void } = {}) {
  const [aerarium, setAerarium] = useState<OfficinaViewProps["aerarium"]>();
  const [health, setHealth] = useState<OfficinaViewProps["health"]>();
  const [officina, setOfficina] = useState<OfficinaViewProps["officina"]>();
  const [opera, setOpera] = useState<OfficinaViewProps["opera"]>();
  const [brakePending, setBrakePending] = useState(false);
  const [brakeMessage, setBrakeMessage] = useState<string>();
  const demo = location.search.includes("demo");

  const refresh = useCallback(() => {
    if (demo) {
      setAerarium(DEV_AERARIUM); setHealth(DEV_HEALTH); setOfficina(DEV_OFFICINA); setOpera(DEV_OPERA);
      return;
    }
    fetchAerarium().then(setAerarium).catch(() => setAerarium("failed"));
    fetchHealth().then(setHealth).catch(() => setHealth("failed"));
    fetchOfficina().then(setOfficina).catch(() => setOfficina("failed"));
    fetchOpera().then(setOpera).catch(() => setOpera("failed"));
  }, [demo]);
  useVisibleRefresh(refresh);

  const parts = [aerarium, health, officina, opera];
  const status = screenStatus("officina", {
    loaded: parts.every((part) => part !== undefined),
    failed: parts.includes("failed") || undefined,
    empty: Array.isArray(aerarium) && aerarium.length === 0 && Array.isArray(opera) && opera.length === 0
      && typeof health === "object" && health.blocks === 0 && health.advisories === 0 && health.due.length === 0,
  });
  useEffect(() => onStatus?.(status), [status.state, status.text]);

  const toggleBrake = async () => {
    if (typeof health !== "object" || brakePending) return;
    const paused = health.autonomy.paused;
    setBrakePending(true); setBrakeMessage(undefined);
    const result = paused ? await submitResume() : await submitPause();
    setBrakePending(false);
    if (result.kind === "ok") setHealth({ ...health, autonomy: paused ? { paused: false } : { paused: true } });
    else setBrakeMessage(result.kind === "refused" && result.output ? result.output : "The brake did not change. Try again.");
  };

  return <OfficinaView aerarium={aerarium} health={health} officina={officina} opera={opera} brakePending={brakePending} brakeMessage={brakeMessage} onBrake={() => void toggleBrake()} />;
}

export function OfficinaView({ aerarium, health, officina, opera, brakePending = false, brakeMessage, onBrake }: OfficinaViewProps) {
  const work = typeof officina === "object" && Array.isArray(opera) ? officinaWorkGroups(boardModel(officina, opera)) : undefined;
  const loadedHealth = typeof health === "object" ? health : undefined;
  const integrity = loadedHealth ? integritySummary(loadedHealth) : undefined;

  return (
    <div className="officina">
      <header className="officina__header"><h1 className="officina__title">Officina</h1><p className="officina__lede">Work, spend and operating health in detail.</p></header>

      <section className="officina__panel panel--work">
        <h2 className="officina__panel-heading">Work in flight</h2>
        <p className="officina__unit">Active opera grouped by lifecycle phase; each row names who moves next.</p>
        {(officina === undefined || opera === undefined) && <p className="officina__loading">Loading work in flight…</p>}
        {(officina === "failed" || opera === "failed") && <p className="officina__empty">Could not load work in flight.</p>}
        {work && work.every((group) => group.rows.length === 0) && <p className="officina__empty">Nothing in flight.</p>}
        {work && work.some((group) => group.rows.length > 0) && <div className="officina__work-groups">{work.map((group) => (
          <div key={group.id} className="officina__work-group" data-group={group.id}>
            <h3>{group.label}<span>{group.rows.length}</span></h3>
            {group.rows.length === 0 ? <p className="officina__quiet">None</p> : group.rows.map((row) => <div key={row.id} className="officina__row officina__work-row"><span className="officina__value-mono">{row.id}</span><span>{row.title}</span>{row.note && <span className="officina__work-note">{row.note}</span>}</div>)}
          </div>
        ))}</div>}
      </section>

      <section className="officina__panel panel--budget">
        <h2 className="officina__panel-heading">Budget</h2>
        <p className="officina__unit">Current token budget by collegium.</p>
        {aerarium === undefined && <p className="officina__loading">Loading budget allocations…</p>}
        {aerarium === "failed" && <p className="officina__empty">Could not load budget allocations.</p>}
        {Array.isArray(aerarium) && aerarium.length === 0 && <p className="officina__empty">No budget allocation is recorded for this week. Spend and posture are unavailable.</p>}
        {Array.isArray(aerarium) && aerarium.length > 0 && <div className="officina__budget-rows">{aerarium.map((entry) => { const { word, reason } = formatPosture(entry); return (
          <div key={entry.collegium} className="officina__budget-row"><span className="officina__collegium-name">{entry.collegium}</span><BurnBar spent={entry.burn.tokens} allowance={entry.allowance.tokens} /><div className="officina__posture-text"><span className="officina__posture-word">{word}</span><span className="officina__posture-reason">{reason}</span></div></div>
        ); })}</div>}
      </section>

      <section className="officina__panel panel--health">
        <h2 className="officina__panel-heading">Health</h2>
        <p className="officina__unit">Current lex and process detail.</p>
        {health === undefined && <p className="officina__loading">Loading health…</p>}
        {health === "failed" && <p className="officina__empty">Could not load health.</p>}
        {loadedHealth && integrity && <div className="officina__health-rows">
          <details className="officina__health-row panel--lex"><summary><span>Lex status</span><span className="officina__severity-summary">{loadedHealth.blocks === 0 && loadedHealth.advisories === 0 ? <span><SeverityCue level="normal" />Normal</span> : <>{loadedHealth.blocks > 0 && <span><SeverityCue level="blocking" />{loadedHealth.blocks.toLocaleString()} blocking</span>}{loadedHealth.advisories > 0 && <span><SeverityCue level="high" />{loadedHealth.advisories.toLocaleString()} high</span>}</>}</span></summary><div className="officina__health-detail"><p className="officina__health-copy">{integrity.stops} {integrity.warns}</p>{integrity.rows.length > 0 && <p className="officina__health-copy">Severity is available only in aggregate.</p>}{integrity.rows.length === 0 && <p>No findings.</p>}{integrity.rows.map((row) => <p key={row.family} className="officina__rule-family"><span>{row.label}</span><span>{row.count}</span></p>)}</div></details>
          <details className="officina__health-row panel--process"><summary><span>Process health</span><span className="officina__severity-summary"><span><SeverityCue level={loadedHealth.due.length > 0 ? "low" : "normal"} />{loadedHealth.due.length > 0 ? `${loadedHealth.due.length.toLocaleString()} low due` : "Normal"}</span></span></summary><div className="officina__health-detail"><p className="officina__brake-explanation">New pieces of work do not start; work already running carries on.</p><div className="officina__brake-row"><div className="officina__brake-state"><span>New work</span><strong>{loadedHealth.autonomy.paused ? "Stopped" : "Running"}</strong></div><button type="button" className="officina__brake" disabled={brakePending} onClick={onBrake}>{brakePending ? "Changing…" : loadedHealth.autonomy.paused ? "Resume new work" : "Stop new work"}</button></div>{brakeMessage && <p className="officina__write-error">{brakeMessage}</p>}{loadedHealth.due.length === 0 ? <p>Nothing pending.</p> : loadedHealth.due.map((due, index) => <p key={`${due.kind}:${due.id}:${index}`} className="officina__process-row"><span className="officina__value-mono">{due.id}</span><span className="officina__severity-label"><SeverityCue level="low" />{due.kind}</span></p>)}</div></details>
        </div>}
      </section>
    </div>
  );
}
