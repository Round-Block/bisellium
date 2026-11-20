import { useEffect, useState } from "react";
import { fetchCompletion, fetchHealth, fetchInbox, fetchOfficina, fetchOpera, type CompletionResponse, type HealthResponse, type InboxResponse, type OfficinaResponse, type OpusEntry } from "../api.js";
import { attentionCollection, attentionTotal, type AttentionRow } from "../lib/board.js";
import { homeAskText, homeCompletion, homeNeeds, homeSummary } from "../lib/home.js";
import { READY, type ScreenStatus } from "../lib/screenState.js";

interface HomeAttentionData {
  officina: OfficinaResponse;
  opera: OpusEntry[];
  inbox: InboxResponse;
  health: HealthResponse;
}

export interface HomeProps {
  onStatus?: (status: ScreenStatus) => void;
  onNeedsYouCount?: (count: number) => void;
  onAttentionLoaded?: () => void;
}

function destination(item: AttentionRow): string {
  return item.destination === "board" && item.boardEntry ? `#/board/${encodeURIComponent(item.id)}` : "#/inbox";
}

function Cue({ severity }: { severity: "blocking" | "high" | "normal" }) {
  return <span className={`severity-cue severity-cue--${severity}`} aria-hidden="true" />;
}

export function Home({ onStatus, onNeedsYouCount, onAttentionLoaded }: HomeProps = {}) {
  const [data, setData] = useState<HomeAttentionData>();
  const [completion, setCompletion] = useState<CompletionResponse | "failed">();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    onStatus?.({ state: "loading", text: "Loading home…" });
    Promise.all([fetchOfficina(), fetchOpera(), fetchInbox({ shared: true }), fetchHealth()]).then(([officina, opera, inbox, health]) => {
      if (!active) return;
      setData({ officina, opera, inbox, health });
      setFailed(false);
      const attention = attentionCollection(officina, opera, inbox);
      onNeedsYouCount?.(attentionTotal(attention));
      onAttentionLoaded?.();
      onStatus?.(READY);
    }).catch(() => {
      if (!active) return;
      setFailed(true);
      onStatus?.({ state: "error", text: "Could not load home." });
    });
    return () => { active = false; };
  }, [onStatus, onNeedsYouCount, onAttentionLoaded]);
  useEffect(() => {
    let active = true;
    fetchCompletion().then((value) => { if (active) setCompletion(value); }).catch(() => { if (active) setCompletion("failed"); });
    return () => { active = false; };
  }, []);
  const attention = data ? attentionCollection(data.officina, data.opera, data.inbox) : [];
  const groups = homeNeeds(attention);
  const summary = data ? homeSummary(data.officina, data.opera, data.health) : undefined;
  const wipTotal = summary?.wip.reduce((total, row) => total + row.count, 0) ?? 0;
  const completionModel = typeof completion === "object" && completion.meter ? homeCompletion(completion.meter) : undefined;
  return (
    <div className="home" data-completion-settled={completion !== undefined}>
      <header className="home__header">
        <h1 className="home__title">Home</h1>
        <p className="home__lede">What needs you and what is moving.</p>
      </header>
      {failed && <p className="screen-notice">Could not load home.</p>}
      {data && <section className="home__row home__row--attention">
        <article className="home-card home-card--needs">
          <header className="home-card__head">
            <div><h2>Needs you</h2><p>Greenlights, human gates, Inbox decisions and questions</p></div>
          </header>
          {groups.length === 0 ? <p className="home-card__empty">Nothing waiting on you</p> : <div className="home-needs">
            {groups.map((group) => <section className="home-needs__group" data-need-kind={group.id} key={group.id}>
              <h3>{group.label}</h3>
              {group.items.map((item) => <a className="home-needs__item" data-attention-key={item.attentionKey} href={destination(item)} key={item.attentionKey}>
                <span className="home-needs__id">{item.id}</span>
                <strong>{item.title}</strong>
                <span className="home-needs__open">Open</span>
                <span className="home-needs__ask">{homeAskText(item)}</span>
              </a>)}
            </section>)}
          </div>}
        </article>
        {summary && <aside className="home__tiles" aria-label="Stuck and Health">
          <article className="home-tile" data-tile="stuck">
            <div className="home-tile__head"><h2>Stuck</h2><Cue severity={summary.stuck.cue} /></div>
            <strong className="home-tile__value">{summary.stuck.count}</strong>
            <div className="home-tile__foot"><span>Work items with failed gates</span><a href="#/board">Board</a></div>
          </article>
          <article className="home-tile" data-tile="health">
            <div className="home-tile__head"><h2>Health</h2><Cue severity={summary.health.cue} /></div>
            <strong className="home-tile__value">{summary.health.count}</strong>
            <div className="home-tile__foot"><span>{summary.health.detail}</span><a href="#/officina">Details</a></div>
          </article>
        </aside>}
      </section>}
      {summary && summary.wip.length > 0 && <section className="home__row home__row--work">
        <article className="home-card home-card--wip">
          <header className="home-card__head"><div><h2>Work in progress</h2><p>Active Board work by phase</p></div><a href="#/board">Board</a></header>
          <div className="home-wip">
            {summary.wip.map((row) => <div className="home-wip__row" key={row.id}>
              <span>{row.label}</span>
              <span className="home-wip__bar" aria-hidden="true"><span style={{ width: `${row.count / wipTotal * 100}%` }} /></span>
              <strong>{row.count}</strong>
            </div>)}
          </div>
        </article>
      </section>}
      {completion === undefined && <p className="home-completion-status">Loading completion…</p>}
      {completion === "failed" && <p className="home-completion-status">Could not load completion.</p>}
      {typeof completion === "object" && completion.meter === null && <p className="home-completion-status">No completion record is available.</p>}
      {completionModel && <section className="home__row home__row--outcome">
        <article className="home-card home-card--completion">
          <header className="home-card__head"><div><h2>Completion</h2><p>Planned work completed by milestone</p></div><strong className="home-completion__overall">{completionModel.overall}%</strong></header>
          <div className="home-completion">
            {completionModel.rows.map((row) => <section className="home-completion__group" key={row.id}>
              <div className="home-completion__label"><h3>{row.title}</h3><span className="home-completion__count">{row.done} of {row.planned} done</span></div>
              <div className="home-completion__units" aria-label={`${row.title}: ${row.done} of ${row.planned} done`}>
                {Array.from({ length: row.planned }, (_, index) => <span className={`home-completion__unit${index < row.done ? " home-completion__unit--done" : ""}`} aria-hidden="true" key={index} />)}
              </div>
            </section>)}
          </div>
        </article>
      </section>}
    </div>
  );
}
