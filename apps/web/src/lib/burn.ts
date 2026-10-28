/**
 * apps/web/src/lib/burn.ts — one fail-closed classifier behind BurnBar.
 */
export interface BurnMeasure {
  spent: number;
  allowance: number;
  fraction: number;
  over: boolean;
  overBy: number;
  state: "normal" | "approaching" | "spent" | "over";
  severity: "normal" | "high" | "blocking";
}

export const BUDGET_APPROACHING_FRACTION = 0.8;

export function burnMeasure(spent: unknown, allowance: unknown): BurnMeasure | undefined {
  if (typeof spent !== "number" || !Number.isFinite(spent) || spent < 0) return undefined;
  if (typeof allowance !== "number" || !Number.isFinite(allowance) || allowance <= 0) return undefined;
  const ratio = spent / allowance;
  const over = spent > allowance;
  const state = over ? "over" : spent === allowance ? "spent" : ratio >= BUDGET_APPROACHING_FRACTION ? "approaching" : "normal";
  return {
    spent,
    allowance,
    fraction: Math.min(ratio, 1),
    over,
    overBy: Math.max(spent - allowance, 0),
    state,
    severity: state === "over" ? "blocking" : state === "normal" ? "normal" : "high",
  };
}
