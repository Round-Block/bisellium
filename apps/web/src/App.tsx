import { useEffect, useState } from "react";
import { parseRoute } from "./lib/route.js";
import { Sidebar } from "./components/Sidebar.js";
import { Officina } from "./screens/Officina.js";
import { Inbox } from "./screens/Inbox.js";
import { Seats } from "./screens/Seats.js";
import { TokenPrompt } from "./components/TokenPrompt.js";
import { fetchInbox, hasToken, setUnauthorizedListener } from "./api.js";

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function App() {
  const [hash, setHash] = useState(currentHash());
  const [needsYouCount, setNeedsYouCount] = useState(0);
  const [tokenPromptOpen, setTokenPromptOpen] = useState(!hasToken());

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
      <main className="shell__main">
        {route === "officina" ? <Officina /> : route === "seats" ? <Seats /> : <Inbox />}
      </main>
    </div>
  );
}
