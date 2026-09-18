/**
 * @bisellium/shim — run receipts ("hooks leave receipts"). One JSON file per
 * run session at <studio>/receipts/<sella>/<sessionId>.json, written at
 * start and rewritten at exit. `bisellium check` reads these files directly
 * (packages/cli/src/check.ts: receipt.shape, sella.stale) — this module owns
 * writing them, not validating them.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { redact } from "./redact.js";

export interface Receipt {
  sella: string;
  sessionId: string;
  startedAt: string;
  cwd: string;
  cmd: string[];
  /** "run" for `bisellium run`; a harness profile id (e.g. "claude-code",
   *  "codex", "fake") for `bisellium talk`. */
  harness: string;
  endedAt?: string;
  exitCode?: number;
  durationMs?: number;
}

// A counter folded in with the pid keeps sessionIds unique even across
// several runCommand calls sharing the same `now` (as tests do).
let counter = 0;

/** `<startedAt ISO compact>-<4 hex>`, e.g. "20260918T090000000Z-1a2b". */
export function makeSessionId(startedAt: Date): string {
  const compact = startedAt.toISOString().replace(/[^0-9A-Za-z]/g, "");
  const n = (process.pid + counter++) >>> 0;
  const hex = (n & 0xffff).toString(16).padStart(4, "0");
  return `${compact}-${hex}`;
}

export function receiptPath(studio: string, sella: string, sessionId: string): string {
  return join(resolve(studio), "receipts", sella, `${sessionId}.json`);
}

/** Writes the start-of-run receipt and returns its path. `harness` defaults
 *  to "run" (bisellium run's own receipts); `bisellium talk` passes the
 *  profile id it actually used. */
export function writeReceiptStart(
  studio: string,
  fields: Pick<Receipt, "sella" | "sessionId" | "startedAt" | "cwd" | "cmd"> & Partial<Pick<Receipt, "harness">>,
): string {
  const path = receiptPath(studio, fields.sella, fields.sessionId);
  mkdirSync(dirname(path), { recursive: true });
  // cmd is echoed verbatim by whoever ran `bisellium run`/`bisellium talk`
  // — it may well contain a token/key/secret/password passed as
  // `--flag=value` or on a Bearer header; mask those before they land on disk.
  const receipt: Receipt = { ...fields, cmd: fields.cmd.map((arg) => redact(arg)), harness: fields.harness ?? "run" };
  writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n");
  return path;
}

/** Rewrites the receipt at `path` with the exit-time fields, keeping the rest. */
export function writeReceiptEnd(path: string, patch: { endedAt: string; exitCode: number; durationMs: number }): void {
  let existing: Partial<Receipt> = {};
  try {
    existing = JSON.parse(readFileSync(path, "utf8")) as Partial<Receipt>;
  } catch {
    // Best effort: if the start receipt is unreadable, still leave a
    // complete-enough record behind rather than throwing out of runCommand.
  }
  const receipt = { ...existing, ...patch };
  writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n");
}
