import type { BoardModel, CardRow } from "./board.js";

export interface OfficinaWorkRow extends CardRow { note?: string }
export interface OfficinaWorkGroup { id: string; label: string; rows: OfficinaWorkRow[] }

export function officinaWorkGroups(_model: BoardModel): OfficinaWorkGroup[] {
  return [];
}
