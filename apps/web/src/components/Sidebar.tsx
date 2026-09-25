import { needsYouVisible } from "../lib/nav.js";
// ponytail: no `import "./w025.css"` here — Officina's FastiStrip already
// pulls it into the one bundle App.tsx statically assembles (both Officina
// and Inbox are always imported, whichever route is live), and dropping the
// redundant copy here is what lets apps/web/test/sidebar.test.ts import this
// component under plain node (tsx has no CSS loader; see W-065).

export interface SidebarProps {
  route: string;
  needsYouCount: number;
}

// D-023 §1's order. W-064 lands the Board as a live destination.
const ENTRIES: { route: string; href: string; label: string; disabled?: boolean }[] = [
  { route: "inbox", href: "#/inbox", label: "Inbox" },
  { route: "board", href: "#/board", label: "Board" },
  { route: "seats", href: "#/seats", label: "Seats" },
  { route: "officina", href: "#/officina", label: "Officina" },
];

export function Sidebar({ route, needsYouCount }: SidebarProps) {
  return (
    <nav className="sidebar">
      <span className="sidebar__wordmark">Bisellium</span>
      {ENTRIES.map((e) => {
        const active = route === e.route;
        const classes = ["sidebar__link", active && "sidebar__link--active", e.disabled && "sidebar__link--disabled"].filter(Boolean).join(" ");
        return (
          <a
            key={e.route}
            className={classes}
            href={e.href}
            aria-disabled={e.disabled ? "true" : undefined}
            onClick={e.disabled ? (ev) => ev.preventDefault() : undefined}
          >
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
