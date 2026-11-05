import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { boardOpusHref, parseLocation } from "./lib/route.js";
import { Sidebar } from "./components/Sidebar.js";
import { Officina } from "./screens/Officina.js";
import { Inbox } from "./screens/Inbox.js";
import { Seats } from "./screens/Seats.js";
import { Board } from "./screens/Board.js";
import { TokenPrompt } from "./components/TokenPrompt.js";
import { beginReadMount, fetchInbox, fetchOfficina, fetchOpera, hasToken, rereadAfterTokenSaved, setUnauthorizedListener } from "./api.js";
import { READY, type ScreenStatus } from "./lib/screenState.js";
import { attentionCollection, attentionTotal } from "./lib/board.js";

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
  const [attentionCount, setAttentionCount] = useState(0);
  const [pendingInboxAttention, setPendingInboxAttention] = useState<string | undefined>(undefined);
  const [tokenPromptOpen, setTokenPromptOpen] = useState(!hasToken());
  // W-501: bumped when a token is saved after a refused read, re-mounting the routed screen so it reads again with it.
  const [readEpoch, setReadEpoch] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [wideSidebar, setWideSidebar] = useState(initialWideSidebar);
  const [overlayOpen, setOverlayOpen] = useState(false);
  // W-341: the active screen reports its one status here; the shell owns the one live region, so it is never
  // remounted by a screen's own layout changes and announces every state change.
  const [status, setStatus] = useState<ScreenStatus>(READY);
  const hasMountedAttentionRef = useRef(false);
  const onAttentionLoaded = useCallback(() => {
    hasMountedAttentionRef.current = true;
  }, []);
  const parsedLocation = parseLocation(hash);
  const route = parsedLocation.route;

  const openBoardAttention = (opusId: string): void => {
    const href = boardOpusHref(opusId);
    window.location.hash = href;
    setHash(href);
  };
  const closeBoardDrawerRoute = (): void => {
    window.history.replaceState(window.history.state, "", "#/board");
    setHash(currentHash());
  };
  const openInboxAttention = (attentionKey: string): void => {
    setPendingInboxAttention(attentionKey);
    window.location.hash = "#/inbox";
  };

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

  // W-501: each routed-screen mount (a route or a read epoch) begins with no successful read. A layout effect runs before
  // every passive effect, so this precedes the screen's own reads and the attention read below.
  useLayoutEffect(() => beginReadMount(), [route, readEpoch]);

  useEffect(() => {
    if (location.search.includes("demo")) {
      setAttentionCount(3);
      return;
    }
    if (route === "inbox" || route === "board") return;
    let active = true;
    Promise.all([fetchOfficina(), fetchOpera(), fetchInbox({ shared: true })])
      .then(([officina, opera, inbox]) => {
        if (active) setAttentionCount(attentionTotal(attentionCollection(officina, opera, inbox)));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [route, readEpoch]);

  useEffect(() => {
    if (route === "inbox" || route === "board") hasMountedAttentionRef.current = false;
  }, [route]);

  useEffect(() => {
    if ((route === "inbox" || route === "board") && status.state === "error" && !hasMountedAttentionRef.current) setAttentionCount(0);
  }, [route, status.state]);

  return (
    <div className={[
      "shell",
      wideSidebar && sidebarCollapsed && "shell--sidebar-collapsed",
      !wideSidebar && overlayOpen && "shell--overlay-open",
    ].filter(Boolean).join(" ")}>
      {tokenPromptOpen && (
        <TokenPrompt
          onSubmit={() => {
            setTokenPromptOpen(false);
            if (rereadAfterTokenSaved()) setReadEpoch((n) => n + 1);
          }}
        />
      )}
      <Sidebar
        route={route}
        attentionCount={attentionCount}
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
        <Fragment key={readEpoch}>
        {route === "officina" ? <Officina onStatus={setStatus} /> : route === "seats" ? <Seats onStatus={setStatus} /> : route === "board" ? (
          <Board
            onStatus={setStatus}
            onWaitingCount={setAttentionCount}
            onAttentionLoaded={onAttentionLoaded}
            requestedOpusId={parsedLocation.boardOpusId}
            boardPathError={parsedLocation.boardPathError}
            onDrawerRouteOpen={openBoardAttention}
            onDrawerRouteClose={closeBoardDrawerRoute}
            onOpenInbox={openInboxAttention}
          />
        ) : (
          <Inbox
            onStatus={setStatus}
            onNeedsYouCount={setAttentionCount}
            onAttentionLoaded={onAttentionLoaded}
            onOpenBoard={openBoardAttention}
            initialAttentionKey={pendingInboxAttention}
            onInitialAttentionConsumed={() => setPendingInboxAttention(undefined)}
          />
        )}
        </Fragment>
      </main>
      <div className="shell__status" role="status" aria-live="polite" data-state={status.state}>
        {status.text}
      </div>
    </div>
  );
}
