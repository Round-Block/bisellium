import { needsYouVisible } from "../lib/nav.js";
import "./w025.css";

export interface SidebarProps {
  route: string;
  needsYouCount: number;
}

export function Sidebar({ route, needsYouCount }: SidebarProps) {
  return (
    <nav className="sidebar">
      <span className="sidebar__wordmark">Bisellium</span>
      <a className={`sidebar__link${route !== "officina" ? " sidebar__link--active" : ""}`} href="#/inbox">
        <span className="sidebar__link-text">Inbox</span>
        {needsYouVisible(needsYouCount) && <span className="sidebar__badge">{needsYouCount}</span>}
      </a>
      <a className={`sidebar__link${route === "officina" ? " sidebar__link--active" : ""}`} href="#/officina">
        <span className="sidebar__link-text">Officina</span>
      </a>
      <div className="sidebar__bottom">
        <span className="sidebar__meta">studio/</span>
      </div>
    </nav>
  );
}
