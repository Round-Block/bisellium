/**
 * @bisellium/shim/hooks — receipt-based liveness for the harness hooks
 * profile (W-015). `bisellium hooks check` and `bisellium check`'s
 * `hook.dead` rule share this exact logic (not two re-implementations of
 * the same idea): a sella whose effective harness is "claude-code" (the
 * manifest default — see adapter-native's Manifest.sellae[].harness) is
 * expected to leave a harness:"claude-code" receipt (written by
 * `bisellium hook-event start`) among its most recent sessions. If none of
 * the last few receipts were hook-written, the SessionStart/Stop hooks are
 * presumably not wired in .claude/settings.json (or that sella hasn't run
 * through Claude Code yet) — advisory only, never a block: this can't tell
 * "never configured" apart from "no session yet today".
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const HOOK_HARNESS_ID = "claude-code";
/** How many of a sella's most recent receipts (any harness) are inspected
 *  for a hook-written one before calling it dead — documented default. */
export const HOOK_DEAD_RECENT_RECEIPTS = 3;

export interface ReceiptSummary {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  harness: string;
}

export interface HookReceiptStatus {
  sella: string;
  /** The sella's effective harness: its manifest value, or "claude-code" when absent. */
  harness: string;
  /** Up to HOOK_DEAD_RECENT_RECEIPTS receipts, most recent (`startedAt`) first. */
  recent: ReceiptSummary[];
  lastReceipt?: ReceiptSummary;
  /** true only when `harness` is "claude-code" and none of `recent` carry a
   *  harness:"claude-code" receipt (i.e. no hook ever ran `hook-event start`). */
  dead: boolean;
}

function readSellaReceipts(studio: string, sella: string): ReceiptSummary[] {
  const dir = join(resolve(studio), "receipts", sella);
  let files: string[] = [];
  try {
    files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  } catch {
    files = [];
  }
  const out: ReceiptSummary[] = [];
  for (const f of files) {
    const p = join(dir, f);
    try {
      if (!statSync(p).isFile()) continue;
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const sessionId = typeof raw["sessionId"] === "string" ? raw["sessionId"] : undefined;
      const startedAt = typeof raw["startedAt"] === "string" ? raw["startedAt"] : undefined;
      if (!sessionId || !startedAt) continue; // shape check.ts's own receipt.shape rule already covers
      out.push({
        sessionId,
        startedAt,
        endedAt: typeof raw["endedAt"] === "string" ? raw["endedAt"] : undefined,
        harness: typeof raw["harness"] === "string" ? raw["harness"] : "",
      });
    } catch {
      // Unreadable/corrupt receipt — check.ts's receipt.shape rule reports
      // it; this liveness check just skips it rather than throwing.
    }
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return out;
}

export function hookReceiptStatuses(studio: string, sellae: { id: string; harness?: string }[]): HookReceiptStatus[] {
  return sellae.map((s) => {
    const harness = s.harness ?? HOOK_HARNESS_ID;
    const all = readSellaReceipts(studio, s.id);
    const recent = all.slice(0, HOOK_DEAD_RECENT_RECEIPTS);
    const dead = harness === HOOK_HARNESS_ID && !recent.some((r) => r.harness === HOOK_HARNESS_ID);
    return { sella: s.id, harness, recent, lastReceipt: all[0], dead };
  });
}
