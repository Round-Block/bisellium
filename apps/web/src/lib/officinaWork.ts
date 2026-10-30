import type { BoardModel, CardRow } from "./board.js";

export const OFFICINA_WORK_GROUPS = ["review", "building", "blocked"] as const;
export type OfficinaWorkGroupId = (typeof OFFICINA_WORK_GROUPS)[number];
export interface OfficinaWorkRow extends CardRow { note?: string }
export interface OfficinaWorkGroup { id: OfficinaWorkGroupId; label: string; rows: OfficinaWorkRow[] }

const LABELS: Record<OfficinaWorkGroupId, string> = {
  review: "Review",
  building: "Building",
  blocked: "Blocked",
};

export function officinaWorkGroups(model: BoardModel): OfficinaWorkGroup[] {
  const grouped = new Map<OfficinaWorkGroupId, OfficinaWorkRow[]>(OFFICINA_WORK_GROUPS.map((id) => [id, []]));
  const seen = new Set<string>();
  for (const column of model.columns) {
    if (column.id === "needs_you" || column.id === "planned" || column.id === "done") continue;
    for (const card of column.cards) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      const group: OfficinaWorkGroupId = column.id === "halted"
        ? "blocked"
        : column.id === "verifying" || column.id === "awaiting_review"
          ? "review"
          : "building";
      const pending = card.gates.find((gate) => gate.status === "pending");
      const pendingLabel = pending?.id.replace(/_/g, " ");
      const note = pendingLabel && pendingLabel !== group ? `${pendingLabel} pending` : card.sella ? `${card.sella} next` : undefined;
      grouped.get(group)!.push({ ...card, note });
    }
  }
  return OFFICINA_WORK_GROUPS.map((id) => ({ id, label: LABELS[id], rows: grouped.get(id)! }));
}
