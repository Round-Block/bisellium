import type { JSX } from "react";

/** apps/web/src/components/Colophon.tsx — signature element 4.5
 * (DIRECTION.md §4.4): every screen ends with one hairline and one mono
 * 11px ink-3 line naming which bytes it renders. Reused by W-025 on every
 * screen it adds. */

export interface ColophonProps {
  /** From `/api/officina` `.studio`. */
  studioPath: string;
  schemaVersion?: string;
  /** From the last event (e.g. `/api/events?limit=1`) when one is
   * available — not fetched by W-024's Inbox, but a later caller may
   * pass it. Truncated to 8 chars and rendered first. */
  treeHash?: string;
  /** ISO timestamp; defaults to render time when the caller has no better
   * source (no endpoint currently returns a snapshot generated-at). */
  generatedAt?: string;
}

export function Colophon({ studioPath, schemaVersion, treeHash, generatedAt }: ColophonProps): JSX.Element {
  const items = [treeHash ? treeHash.slice(0, 8) : undefined, studioPath, generatedAt ?? new Date().toISOString(), schemaVersion].filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );

  return (
    <footer>
      <div style={{ height: "1px", background: "var(--rule)" }} />
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          lineHeight: "14px",
          color: "var(--ink-3)",
        }}
      >
        {items.join(" · ")}
      </div>
    </footer>
  );
}
