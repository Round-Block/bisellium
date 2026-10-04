import { NAV_ENTRIES, needsYouVisible } from "../lib/nav.js";
// ponytail: no `import "./w025.css"` here — Officina's FastiStrip already
// pulls it into the one bundle App.tsx statically assembles (both Officina
// and Inbox are always imported, whichever route is live), and dropping the
// redundant copy here is what lets apps/web/test/sidebar.test.ts import this
// component under plain node (tsx has no CSS loader; see W-065).

export interface SidebarProps {
  route: string;
  needsYouCount: number;
}

export function Sidebar({ route, needsYouCount }: SidebarProps) {
  return (
    <nav className="sidebar">
      <span className="sidebar__wordmark">Bisellium</span>
      {NAV_ENTRIES.map((e) => {
        const active = route === e.route;
        const classes = ["sidebar__link", active && "sidebar__link--active"].filter(Boolean).join(" ");
        return (
          <a key={e.route} className={classes} href={e.href} aria-current={active ? "page" : undefined}>
            <span className="sidebar__link-text">{e.label}</span>
            {e.route === "inbox" && needsYouVisible(needsYouCount) && <span className="sidebar__badge">{needsYouCount}</span>}
          </a>
        );
      })}
      <div className="sidebar__bottom">
        <span className="sidebar__meta">studio/</span>
      </div>
    </nav>
  );
}
