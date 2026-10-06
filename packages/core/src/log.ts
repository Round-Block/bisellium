/**
 * Append-only JSONL event log. One event per line; the log is never
 * rewritten, only appended to. Ordering within a source is the write order.
 */
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { GantryEvent } from "@bisellium/schema";

export interface ReadLogResult {
  events: GantryEvent[];
  skipped: number;
}

/**
 * Appends events to the log, never through a symlink: the parent must be a real directory and the log is opened
 * O_NOFOLLOW (so a symlinked log, or a directory in its place, refuses). The log is created if missing.
 */
export function appendEvents(path: string, events: GantryEvent[]): void {
  if (events.length === 0) return;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const parent = lstatSync(dir);
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error(`event log parent must be a real directory, not a symbolic link: ${dir}`);
  const fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o666);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`event log must be a regular file: ${path}`);
    // A prior write can leave the file without a trailing newline (e.g. a
    // crash mid-write, or a line hand-edited in place) — guard the join so we
    // never concatenate onto the previous line. Reads only the last byte.
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    const prefix = size === 0 || (readSync(fd, last, 0, 1, size - 1), last[0] === 0x0a) ? "" : "\n";
    writeSync(fd, prefix + events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } finally {
    closeSync(fd);
  }
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
  } catch (e) {
    // Only "no log yet" is benign. Any other fs error (permissions, EISDIR,
    // a corrupt filesystem, …) must throw — silently treating it as "empty"
    // would let a Store restart its seq counter at 0 over live history.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { events: [], skipped: 0 };
    throw e;
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
