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
  const spent = entry.burn.tokens;
  const allowance = entry.allowance.tokens;
  const valid = Number.isFinite(spent) && spent >= 0 && Number.isFinite(allowance) && allowance > 0;
  let reason = `For ${entry.period}: no valid burn figure is available.`;
  if (valid && spent > allowance) reason = `For ${entry.period}: the token allowance is exceeded by ${fmt(spent - allowance)} tokens.`;
  else if (valid && spent === allowance) reason = `For ${entry.period}: the token allowance is fully spent.`;
  else if (valid) reason = `For ${entry.period}: ${Math.round((spent / allowance) * 100)}% of the token allowance has been spent.`;
  return {
    word: entry.posture,
    reason,
  };
}
