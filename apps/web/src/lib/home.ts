import type { AttentionRow } from "./board.js";

export interface HomeNeedGroup {
  id: "greenlights" | "human_gates" | "inbox_decisions" | "questions";
  label: string;
  items: AttentionRow[];
}

/** Red-stage seam: behaviour 2 replaces the empty grouping with D-151's collection. */
export function homeNeeds(_attention: readonly AttentionRow[]): HomeNeedGroup[] {
  return [];
}
