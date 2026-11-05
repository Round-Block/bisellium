import { useEffect, useState } from "react";
import { fetchInbox, fetchOfficina, fetchOpera, type InboxResponse, type OfficinaResponse, type OpusEntry } from "../api.js";
import { attentionCollection, attentionTotal, type AttentionRow } from "../lib/board.js";
import { homeAskText, homeNeeds } from "../lib/home.js";
import { READY, type ScreenStatus } from "../lib/screenState.js";

interface HomeAttentionData {
  officina: OfficinaResponse;
  opera: OpusEntry[];
  inbox: InboxResponse;
}

export interface HomeProps {
  onStatus?: (status: ScreenStatus) => void;
  onNeedsYouCount?: (count: number) => void;
  onAttentionLoaded?: () => void;
}

function destination(item: AttentionRow): string {
  return item.destination === "board" && item.boardEntry ? `#/board/${encodeURIComponent(item.id)}` : "#/inbox";
}

export function Home({ onStatus, onNeedsYouCount, onAttentionLoaded }: HomeProps = {}) {
  const [data, setData] = useState<HomeAttentionData>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    onStatus?.({ state: "loading", text: "Loading home…" });
    Promise.all([fetchOfficina(), fetchOpera(), fetchInbox({ shared: true })]).then(([officina, opera, inbox]) => {
      if (!active) return;
      setData({ officina, opera, inbox });
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
  const attention = data ? attentionCollection(data.officina, data.opera, data.inbox) : [];
  const groups = homeNeeds(attention);
  return (
    <div className="home">
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
      </section>}
    </div>
  );
}
