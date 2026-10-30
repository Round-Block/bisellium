/**
 * apps/web/src/lib/officinaLayout.ts — the Officina screen's fixed section
 * order for W-408's Officina detail ledger. This module keeps the three
 * ruled sections testable without a DOM.
 */
export const OFFICINA_SECTIONS = ["workInFlight", "budget", "health"] as const;

export type OfficinaSection = (typeof OFFICINA_SECTIONS)[number];

export function officinaSections(): readonly OfficinaSection[] {
  return OFFICINA_SECTIONS;
}
