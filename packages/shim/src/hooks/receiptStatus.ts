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
  /** The sella's effective harness: its manifest value, or "claude-code" when absent. Empty when `unknown`. */
  harness: string;
  /** Up to HOOK_DEAD_RECENT_RECEIPTS receipts, most recent (`startedAt`) first. */
  recent: ReceiptSummary[];
  lastReceipt?: ReceiptSummary;
  /** true only when `harness` is "claude-code" and none of `recent` carry a
   *  harness:"claude-code" receipt (i.e. no hook ever ran `hook-event start`).
   *  Always false when `unknown` — never a fabricated verdict. */
  dead: boolean;
  /** W-089 behaviour 3 (censor round-2 finding B3): true when this
   *  `receipts/` subdirectory name resolves to no declared seat at all — an
   *  exact row id, or (via the caller's own resolver) a live/retired row's
   *  instance form. Reported honestly rather than silently dropped or given
   *  a fabricated dead/alive verdict. */
  unknown: boolean;
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

/** Every subdirectory name directly under `<studio>/receipts/` — pure
 *  filesystem listing, no id grammar. A missing `receipts/` dir (a
 *  never-run studio) is empty, not an error. */
function listReceiptDirNames(studio: string): string[] {
  const root = join(resolve(studio), "receipts");
  let names: string[] = [];
  try {
    if (!existsSync(root)) return [];
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * W-089 behaviour 3 (censor round-2 finding B3): `receipts/` is now
 * enumerated, not just mapped from declared row ids — an instance directory
 * (`receipts/builder.W-089/`) used to be invisible here entirely (nothing in
 * `sellae` names it), and an unknown directory (`receipts/ghost.dir/`) was
 * silently ignored rather than reported.
 *
 * Seam S1's escape clause: this package sits below `@bisellium/cli`/
 * `@bisellium/adapter-native` in the dependency graph, so it never
 * re-implements the `<seat>.<instance>` grammar itself. A `receipts/`
 * subdirectory name that isn't an exact declared row id is handed to
 * `resolveDir` — built by the caller from its own `resolveSeat` against its
 * own manifest (both `bisellium hooks check` and `check`'s `hook.dead` rule
 * pass one in, so they can never disagree on what a directory name means).
 * `undefined` means "resolves to nothing declared": reported with
 * `unknown: true`, `harness: ""`, `dead: false` — never a fabricated verdict.
 */
export function hookReceiptStatuses(
  studio: string,
  sellae: { id: string; harness?: string }[],
  resolveDir: (dirName: string) => { harness?: string } | undefined = () => undefined,
): HookReceiptStatus[] {
  const seen = new Set<string>();
  const results: HookReceiptStatus[] = [];

  const emit = (dirName: string, harness: string) => {
    if (seen.has(dirName)) return;
    seen.add(dirName);
    const all = readSellaReceipts(studio, dirName);
    const recent = all.slice(0, HOOK_DEAD_RECENT_RECEIPTS);
    const dead = harness === HOOK_HARNESS_ID && !recent.some((r) => r.harness === HOOK_HARNESS_ID);
    results.push({ sella: dirName, harness, recent, lastReceipt: all[0], dead, unknown: false });
  };

  for (const s of sellae) emit(s.id, s.harness ?? HOOK_HARNESS_ID);

  for (const dirName of listReceiptDirNames(studio)) {
    if (seen.has(dirName)) continue;
    const resolved = resolveDir(dirName);
    if (resolved) {
      emit(dirName, resolved.harness ?? HOOK_HARNESS_ID);
    } else {
      seen.add(dirName);
      results.push({ sella: dirName, harness: "", recent: [], lastReceipt: undefined, dead: false, unknown: true });
    }
  }
  return results;
}
