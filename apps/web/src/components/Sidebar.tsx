import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { NAV_ENTRIES, needsYouVisible } from "../lib/nav.js";
// ponytail: no `import "./w025.css"` here — Officina's FastiStrip already
// pulls it into the one bundle App.tsx statically assembles (both Officina
// and Inbox are always imported, whichever route is live), and dropping the
// redundant copy here is what lets apps/web/test/sidebar.test.ts import this
// component under plain node (tsx has no CSS loader; see W-065).

export interface SidebarProps {
  route: string;
  needsYouCount: number;
  collapsed?: boolean;
  overlay?: boolean;
  overlayOpen?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}

type IconName = "panel" | "inbox" | "board" | "seats" | "officina";

function SidebarIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    panel: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
    inbox: <><path d="M4 5h16v14H4z" /><path d="M4 14h5l2 2h2l2-2h5" /></>,
    board: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="14" rx="1" /></>,
    seats: <><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20v-2a5 5 0 0 1 10 0v2M14 20v-1.5a4 4 0 0 1 7 0V20" /></>,
    officina: <><path d="M4 20V9l5 3V8l5 3V4h6v16z" /><path d="M8 20v-3h3v3M15 8h5" /></>,
  };
  return <svg className="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Sidebar({ route, needsYouCount, collapsed = false, overlay = false, overlayOpen = false, onToggle = () => undefined, onNavigate = () => undefined }: SidebarProps) {
  const visibleInboxCount = collapsed && needsYouCount > 9 ? "9+" : needsYouCount;
  const afterRender = (action: () => void) => window.requestAnimationFrame(action);
  const toggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const nav = button.closest(".sidebar");
    onToggle();
    if (!overlay) return;
    afterRender(() => overlayOpen
      ? button.focus()
      : nav?.querySelector<HTMLAnchorElement>(".sidebar__link")?.focus());
  };
  const dismiss = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    const button = event.currentTarget.closest(".sidebar")?.querySelector<HTMLButtonElement>(".sidebar__toggle");
    onNavigate();
    if (overlay) afterRender(() => button?.focus());
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!overlayOpen || event.key !== "Escape") return;
    const button = event.currentTarget.querySelector<HTMLButtonElement>(".sidebar__toggle");
    onToggle();
    afterRender(() => button?.focus());
  };

  return (
    <nav id="console-sidebar" className="sidebar" aria-label="Console navigation" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="sidebar__toggle"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        aria-controls="sidebar-links"
        onClick={toggle}
      >
        <SidebarIcon name="panel" />
      </button>
      <div id="sidebar-links" className="sidebar__links">
      {NAV_ENTRIES.map((e) => {
        const active = route === e.route;
        const classes = ["sidebar__link", active && "sidebar__link--active"].filter(Boolean).join(" ");
        const inboxCountLabel = e.route === "inbox" && needsYouVisible(needsYouCount) ? `Inbox ${needsYouCount}` : undefined;
        return (
          <a key={e.route} className={classes} href={e.href} title={collapsed ? e.label : undefined} aria-label={inboxCountLabel ?? (collapsed ? e.label : undefined)} aria-current={active ? "page" : undefined} onClick={dismiss}>
            <SidebarIcon name={e.route as Exclude<IconName, "panel">} />
            <span className="sidebar__link-text">{e.label}</span>
            {e.route === "inbox" && needsYouVisible(needsYouCount) && " "}
            {e.route === "inbox" && needsYouVisible(needsYouCount) && <span className={["sidebar__badge", collapsed && "sidebar__badge--dot"].filter(Boolean).join(" ")} role="img" aria-label={`Inbox, ${needsYouCount} needs you`}>{visibleInboxCount}</span>}
          </a>
        );
      })}
      </div>
      {!collapsed && !overlay && (
        <div className="sidebar__bottom">
          <span className="sidebar__meta">studio/</span>
        </div>
      )}
    </nav>
  );
}
