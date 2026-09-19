/**
 * apps/web/src/lib/gateLadder.ts — pure layout/mapping math behind
 * GateLadder (DIRECTION.md §4.1). Kept apart from the component so it's
 * testable without a DOM or a built app.
 */
export type GateStatus = "passed" | "pending" | "failed" | "human_passed" | "waived";

export interface Gate {
  id: string;
  status: GateStatus;
  blocker?: string;
}

export type MarkKind = "filled" | "hollow" | "bad-diagonal" | "ok-filled" | "half-height";

/** 6px mark + 3px gap per gate, minus the trailing gap. Four gates = 33px
 *  (DIRECTION.md §4.1). */
export function gateLadderWidth(gateCount: number): number {
  return gateCount <= 0 ? 0 : gateCount * 9 - 3;
}

const MARK_KIND: Record<GateStatus, MarkKind> = {
  passed: "filled",
  pending: "hollow",
  failed: "bad-diagonal",
  human_passed: "ok-filled",
  waived: "half-height",
};

export function markKind(status: GateStatus): MarkKind {
  return MARK_KIND[status];
}

export function gateTitle(gate: Gate): string {
  return gate.blocker ? `${gate.id}: ${gate.blocker}` : gate.id;
}
