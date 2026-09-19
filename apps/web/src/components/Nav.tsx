/**
 * apps/web/src/components/Nav.tsx — 44px nav bar (DIRECTION.md §3 chrome
 * budget): Bisellium wordmark (text, never a logo glyph — §2.10), Inbox
 * and Officina links, and a needs-you count badge. Height constant and
 * badge-visibility logic live in ../lib/nav.ts so they're testable
 * without a DOM.
 */
import { needsYouVisible } from "../lib/nav.js";
import "./w025.css";

export interface NavProps {
  /** petitiones.length from /api/inbox */
  needsYouCount: number;
}

export function Nav({ needsYouCount }: NavProps) {
  return (
    <nav className="nav">
      <span className="nav__wordmark">Bisellium</span>
      <a className="nav__link" href="#/inbox">
        Inbox
      </a>
      <a className="nav__link" href="#/officina">
        Officina
      </a>
      {needsYouVisible(needsYouCount) && <span className="nav__badge">{needsYouCount}</span>}
    </nav>
  );
}
