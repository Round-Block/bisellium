import type { AttentionRow } from "./board.js";
import type { HealthResponse, OfficinaResponse, OpusEntry } from "../api.js";

export interface HomeNeedGroup {
  id: "greenlights" | "human_gates" | "inbox_decisions" | "questions";
  label: string;
  items: AttentionRow[];
}

const GROUPS: readonly Omit<HomeNeedGroup, "items">[] = [
  { id: "greenlights", label: "Greenlights" },
  { id: "human_gates", label: "Human gates" },
  { id: "inbox_decisions", label: "Inbox decisions" },
  { id: "questions", label: "Questions" },
];

export function homeAskText(item: Pick<AttentionRow, "asks">): string {
  return (item.asks ?? []).map((ask) => ask.kind === "greenlight"
    ? "Greenlight"
    : ask.kind === "human_gate"
      ? "Human gate"
      : ask.count === 1 ? "Inbox decision" : `${ask.count} Inbox decisions`).join(", ");
}

/** D-151's one collection stays unique: a combined opus is assigned to its first Board-owned kind while its row names all asks. */
export function homeNeeds(attention: readonly AttentionRow[]): HomeNeedGroup[] {
  const groups = GROUPS.map((group): HomeNeedGroup => ({ ...group, items: [] }));
  for (const item of attention) {
    const id: HomeNeedGroup["id"] = !item.boardEntry
      ? "questions"
      : item.asks?.some((ask) => ask.kind === "greenlight")
        ? "greenlights"
        : item.asks?.some((ask) => ask.kind === "human_gate")
          ? "human_gates"
          : "inbox_decisions";
    groups.find((group) => group.id === id)!.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

export interface HomeSummary {
  stuck: { count: number; cue: "blocking" | "normal" };
  health: { count: number; cue: "blocking" | "high" | "normal"; detail: string };
  wip: { id: string; label: string; count: number }[];
}

/** Red-stage seam: behaviour 3 replaces this empty summary with record counts. */
export function homeSummary(
  _officina: Pick<OfficinaResponse, "lifecycle">,
  _opera: readonly OpusEntry[],
  _health: HealthResponse,
): HomeSummary {
  return { stuck: { count: 0, cue: "normal" }, health: { count: 0, cue: "normal", detail: "Healthy" }, wip: [] };
}
