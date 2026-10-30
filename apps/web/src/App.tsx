import { useEffect, useState } from "react";
import { parseRoute } from "./lib/route.js";
import { Sidebar } from "./components/Sidebar.js";
import { Officina } from "./screens/Officina.js";
import { Inbox } from "./screens/Inbox.js";
import { Seats } from "./screens/Seats.js";
import { Board } from "./screens/Board.js";
import { TokenPrompt } from "./components/TokenPrompt.js";
import { fetchInbox, fetchOfficina, fetchOpera, hasToken, setUnauthorizedListener } from "./api.js";
import { READY, type ScreenStatus } from "./lib/screenState.js";
import { boardModel, needsYouTotal } from "./lib/board.js";

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export const SIDEBAR_STORAGE_KEY = "bisellium.sidebar";

function initialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Storage can be denied or unavailable; the in-memory expanded fallback remains usable.
  }
}

function initialWideSidebar(): boolean {
  return typeof window === "undefined" || window.matchMedia("(min-width: 960px)").matches;
}

export function App() {
  const [hash, setHash] = useState(currentHash());
  const [needsYouCount, setNeedsYouCount] = useState(0);
  const [boardWaitingCount, setBoardWaitingCount] = useState(0);
  const [tokenPromptOpen, setTokenPromptOpen] = useState(!hasToken());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [wideSidebar, setWideSidebar] = useState(initialWideSidebar);
  const [overlayOpen, setOverlayOpen] = useState(false);
  // W-341: the active screen reports its one status here; the shell owns the one live region, so it is never
  // remounted by a screen's own layout changes and announces every state change.
  const [status, setStatus] = useState<ScreenStatus>(READY);
  const route = parseRoute(hash);

  // Only the user's toggle at >=960px writes the preference (brief:21): never a mount, a reload or the narrow overlay.
  const toggleWideSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    persistSidebarCollapsed(next);
  };

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
    const query = window.matchMedia("(min-width: 960px)");
    const onChange = (event: MediaQueryListEvent) => {
      setWideSidebar(event.matches);
      setOverlayOpen(false);
    };
    setWideSidebar(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (location.search.includes("demo")) {
      setNeedsYouCount(3);
      return;
    }
    let active = true;
    fetchInbox({ shared: true })
      .then((inbox) => {
        if (active && route !== "inbox") setNeedsYouCount(needsYouTotal(inbox));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [route]);

  useEffect(() => {
    if (location.search.includes("demo")) {
      setBoardWaitingCount(2);
      return;
    }
    // While Board is mounted its reconciled model is authoritative. An
    // off-screen shell snapshot is cancelled on navigation, so it cannot
    // overwrite a newer count reported through onWaitingCount.
    if (route === "board") return;
    let active = true;
    Promise.all([fetchOfficina(), fetchOpera(), fetchInbox({ shared: true })])
      .then(([officina, opera, inbox]) => {
        if (active) setBoardWaitingCount(boardModel(officina, opera, inbox).waiting.length);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [route, needsYouCount]);

  return (
    <div className={[
      "shell",
      wideSidebar && sidebarCollapsed && "shell--sidebar-collapsed",
      !wideSidebar && overlayOpen && "shell--overlay-open",
    ].filter(Boolean).join(" ")}>
      {tokenPromptOpen && <TokenPrompt onSubmit={() => setTokenPromptOpen(false)} />}
      <Sidebar
        route={route}
        needsYouCount={needsYouCount}
        boardWaitingCount={boardWaitingCount}
        collapsed={wideSidebar ? sidebarCollapsed : !overlayOpen}
        overlay={!wideSidebar}
        overlayOpen={overlayOpen}
        onToggle={() => wideSidebar
          ? toggleWideSidebar()
          : setOverlayOpen((value) => !value)}
        onNavigate={() => {
          if (!wideSidebar) setOverlayOpen(false);
        }}
      />
      {/* W-341: focusable, so a keyboard user can scroll it at phone width (axe scrollable-region-focusable). */}
      <main className="shell__main" tabIndex={0}>
        {route === "officina" ? <Officina onStatus={setStatus} /> : route === "seats" ? <Seats onStatus={setStatus} /> : route === "board" ? <Board onStatus={setStatus} onWaitingCount={setBoardWaitingCount} /> : <Inbox onStatus={setStatus} onNeedsYouCount={setNeedsYouCount} />}
      </main>
      <div className="shell__status" role="status" aria-live="polite" data-state={status.state}>
        {status.text}
      </div>
    </div>
  );
}
