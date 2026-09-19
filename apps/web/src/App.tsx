/**
 * apps/web/src/App.tsx — co-owned with W-024 (routing and nav). W-024
 * owns the Inbox screen at the default hash route; W-025 (this pass)
 * adds `/#/officina`, hash-route switching, and the `<Nav>` wrapper
 * without removing W-024's route. `../lib/route.ts` carries the pure
 * hash-parsing logic (testable without a DOM); this file only wires it to
 * `window.location.hash` and picks a screen.
 *
 * `./screens/Inbox.js` is W-024's file — not in this worktree yet (cascade
 * 7 runs W-024 and W-025 in separate builder worktrees, per D-012); it
 * lands on merge.
 */
import { useEffect, useState } from "react";
import { parseRoute } from "./lib/route.js";
import { Nav } from "./components/Nav.js";
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
    // Nav's needs-you badge: petitiones.length from /api/inbox (brief §Nav).
    fetchInbox()
      .then((r) => setNeedsYouCount(r.petitiones.length))
      .catch(() => undefined);
  }, []);

  const route = parseRoute(hash);

  return (
    <>
      <Nav needsYouCount={needsYouCount} />
      {route === "officina" ? <Officina /> : <Inbox />}
    </>
  );
}
