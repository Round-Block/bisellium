/**
 * Append-only JSONL event log. One event per line; the log is never
 * rewritten, only appended to. Ordering within a source is the write order.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GantryEvent } from "@bisellium/schema";

export function appendEvents(path: string, events: GantryEvent[]): void {
  if (events.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(path, lines, "utf8");
}

export function readEvents(path: string): GantryEvent[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const events: GantryEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (i === lines.length - 1) {
      // A crash mid-write can leave the last line truncated; skip it rather
      // than throw. Any earlier malformed line is a real corruption and
      // still throws.
      try {
        events.push(JSON.parse(line) as GantryEvent);
      } catch {
        /* trailing partial line, ignored */
      }
    } else {
      events.push(JSON.parse(line) as GantryEvent);
    }
  }
  return events;
}
