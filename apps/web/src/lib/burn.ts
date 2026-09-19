/**
 * apps/web/src/lib/burn.ts — pure fraction/colour math behind BurnBar.
 */
export type BurnColor = "ink" | "amber";

export function burnFraction(spent: number, allowance: number): number {
  if (!allowance || allowance <= 0) return spent > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, spent / allowance));
}

export function burnColor(spent: number, allowance: number): BurnColor {
  return spent >= allowance ? "amber" : "ink";
}
