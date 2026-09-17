/**
 * Append-only JSONL event log. One event per line; the log is never
 * rewritten, only appended to. Ordering within a source is the write order.
 */
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname } from "node:path";
import type { GantryEvent } from "@bisellium/schema";

export interface ReadLogResult {
  events: GantryEvent[];
  skipped: number;
}

/**
 * True if the file at `path` is empty, missing, or already ends with a
 * newline. Reads only the last byte (stat + a single-byte read), never the
 * whole file, so this stays cheap on a large log.
 */
function endsWithNewline(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return true; // no file yet — nothing to separate our append from
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] === 0x0a; // "\n"
  } finally {
    closeSync(fd);
  }
}

export function appendEvents(path: string, events: GantryEvent[]): void {
  if (events.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  // A prior write can leave the file without a trailing newline (e.g. a
  // crash mid-write, or a line hand-edited in place) — guard the join so we
  // never concatenate onto the previous line.
  const prefix = endsWithNewline(path) ? "" : "\n";
  const lines = prefix + events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(path, lines, "utf8");
}

/**
 * Reads every line of the log, skipping any that fail to parse — a crash
 * mid-write, a hand edit, whatever — rather than throwing. `skipped` is the
 * count of lines dropped, so a caller can surface (and count) corruption
 * instead of silently losing it.
 */
export function readLog(path: string): ReadLogResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { events: [], skipped: 0 };
  }
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const events: GantryEvent[] = [];
  let skipped = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as GantryEvent);
    } catch {
      skipped++;
    }
  }
  return { events, skipped };
}

/** Compatibility wrapper over {@link readLog} for callers that only want
 *  the events and are content to have corrupt lines silently dropped. */
export function readEvents(path: string): GantryEvent[] {
  return readLog(path).events;
}
