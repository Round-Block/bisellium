import { useEffect, useState } from "react";
import { parseRoute } from "./lib/route.js";
import { Sidebar } from "./components/Sidebar.js";
import { Officina } from "./screens/Officina.js";
import { Inbox } from "./screens/Inbox.js";
import { fetchInbox } from "./api.js";

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function App() {
  const [hash, setHash] = useState(currentHash());
  const [needsYouCount, setNeedsYouCount] = useState(0);

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
      <Sidebar route={route} needsYouCount={needsYouCount} />
      <main className="shell__main">
        {route === "officina" ? <Officina /> : <Inbox />}
      </main>
    </div>
  );
}
