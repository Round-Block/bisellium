import { useEffect, useState } from "react";
import { parseRoute } from "./lib/route.js";
import { Sidebar } from "./components/Sidebar.js";
import { Officina } from "./screens/Officina.js";
import { Inbox } from "./screens/Inbox.js";
import { Seats } from "./screens/Seats.js";
import { Board } from "./screens/Board.js";
import { TokenPrompt } from "./components/TokenPrompt.js";
import { fetchInbox, hasToken, setUnauthorizedListener } from "./api.js";
import { READY, type ScreenStatus } from "./lib/screenState.js";

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function App() {
  const [hash, setHash] = useState(currentHash());
  const [needsYouCount, setNeedsYouCount] = useState(0);
  const [tokenPromptOpen, setTokenPromptOpen] = useState(!hasToken());
  // W-341: the active screen reports its one status here; the shell owns the one live region, so it is never
  // remounted by a screen's own layout changes and announces every state change.
  const [status, setStatus] = useState<ScreenStatus>(READY);

  useEffect(() => {
    // The one 401 path every write shares: raised from wherever the write
    // was issued (Inbox today, W-065's Seats and W-064's Board tomorrow),
    // with no code of their own.
    setUnauthorizedListener(() => setTokenPromptOpen(true));
    return () => setUnauthorizedListener(undefined);
  }, []);

  useEffect(() => {
    const onHashChange = () => setHash(currentHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (location.search.includes("demo")) {
      setNeedsYouCount(3);
      return;
    }
    fetchInbox()
      .then((r) => setNeedsYouCount(r.petitiones.length))
      .catch(() => undefined);
  }, []);

  const route = parseRoute(hash);

  return (
    <div className="shell">
      {tokenPromptOpen && <TokenPrompt onSubmit={() => setTokenPromptOpen(false)} />}
      <Sidebar route={route} needsYouCount={needsYouCount} />
      {/* W-341: focusable, so a keyboard user can scroll it at phone width (axe scrollable-region-focusable). */}
      <main className="shell__main" tabIndex={0}>
        {route === "officina" ? <Officina /> : route === "seats" ? <Seats /> : route === "board" ? <Board /> : <Inbox onStatus={setStatus} />}
      </main>
      <div className="shell__status" role="status" aria-live="polite" data-state={status.state}>
        {status.text}
      </div>
    </div>
  );
}
