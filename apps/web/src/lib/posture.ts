/**
 * apps/web/src/lib/posture.ts — pure formatting behind the Officina
 * screen's "posture and burn" panel. `AerariumEntry.posture` (the frozen
 * API) is a bare word; the reason sentence beneath it is derived
 * client-side from the same entry's burn/allowance/period, the same three
 * fields packages/cli/src/retro.ts already composes a posture line from.
 */
export interface AerariumEntry {
  collegium: string;
  period: string;
  allowance: { tokens: number };
  burn: { tokens: number };
  posture: string;
}

export interface FormattedPosture {
  word: string;
  reason: string;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export function formatPosture(entry: AerariumEntry): FormattedPosture {
  return {
    word: entry.posture,
    reason: `${fmt(entry.burn.tokens)} / ${fmt(entry.allowance.tokens)} tokens this ${entry.period}`,
  };
}
