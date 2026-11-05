import type { AttentionRow } from "./board.js";

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
