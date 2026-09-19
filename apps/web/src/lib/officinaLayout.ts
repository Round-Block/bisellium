/**
 * apps/web/src/lib/officinaLayout.ts — the Officina screen's fixed section
 * order (brief "Officina screen layout" + DIRECTION.md §4.5: every screen
 * ends, at the bottom of its scroll, with the colophon). The colophon
 * component itself is W-024's (reused here, not reimplemented) — this
 * module only pins where it sits relative to the four data panels, so
 * that placement is testable without a DOM.
 */
export const OFFICINA_SECTIONS = ["fasti", "decreta", "postureAndBurn", "lexStatus", "processHealth", "colophon"] as const;

export type OfficinaSection = (typeof OFFICINA_SECTIONS)[number];

export function officinaSections(): readonly OfficinaSection[] {
  return OFFICINA_SECTIONS;
}
