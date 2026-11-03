/**
 * packages/cli/src/queue.ts — W-333: the queue is a record. `queue.yml` holds one ranked list per queue (engineering,
 * UI; Patron 2026-10-20), each with the lanes that share it (D-089, D-137), plus the halted, cut and deferred lists the
 * handoff's Queue carried by hand. One reader, shared by check's `queue.shape` and `next --all`'s lane lines, so the two
 * never disagree on what the file says. Reads only: it writes nothing. See studio/briefs/W-333.md.
 *
 *   queues:
 *     engineering:
 *       lanes: { E1: W-364, E2: ~ }          # Now: the opus each lane holds, or ~ for none
 *       next:                                 # Next: ranked; a lane takes the highest entry not blocked
 *         - { opus: W-364, says: "main-thread heavy runs refused" }
 *         - { opus: W-333, says: "the queue as a record", folded: [W-478], next_ts: true }
 *   halted: [ { opus: W-239, says: "…" } ]
 *   cut: []
 *   deferred: []
 *
 * Later is every other opus record, as the handoff's Queue said; it is not listed.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { parse as parseYaml } from "yaml";
import { ID_RE } from "./check.js";

export const QUEUE_FILE = "queue.yml";
const TOP_KEYS = ["queues", "halted", "cut", "deferred"] as const;
const QUEUE_KEYS = ["lanes", "next"];
const ENTRY_KEYS = ["opus", "says", "folded", "next_ts"];
const QUEUE_ID = /^[a-z][a-z0-9-]*$/;
const LANE_ID = /^[A-Za-z][A-Za-z0-9]*$/;
const SAYS_MAX = 200;

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v) && !v.includes("..");

export interface QueueEntry {
  opus: string;
  says: string;
  folded: string[];
  /** The opus touches packages/cli/src/next.ts: one such opus in flight at a time. */
  nextTs: boolean;
}
export interface Queue {
  id: string;
  /** Lane id to the opus it holds (undefined: none), in file order. */
  lanes: [string, string | undefined][];
  next: QueueEntry[];
}
export interface QueueFile {
  queues: Queue[];
  halted: QueueEntry[];
  cut: QueueEntry[];
  deferred: QueueEntry[];
}
export type QueueRead = { kind: "absent" } | { kind: "held"; why: string; problems: string[] } | { kind: "ok"; file: QueueFile };

/** The record ids under `opera/` (a file `<id>.md`), never following a symlinked `opera/`; empty when it cannot be read. */
function recordIds(studio: string): Set<string> {
  const dir = join(studio, "opera");
  try {
    if (!lstatSync(dir).isDirectory()) return new Set();
    return new Set(readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));
  } catch {
    return new Set();
  }
}

/** One list of entries, every problem pushed; the entries that are whole are returned. */
function entries(v: unknown, where: string, problems: string[]): QueueEntry[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return void problems.push(`${where} must be a list`), [];
  const out: QueueEntry[] = [];
  v.forEach((e, i) => {
    const at = `${where} entry #${i + 1}`;
    if (!isDict(e)) return void problems.push(`${at} is not a mapping`);
    const before = problems.length;
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) problems.push(`${at} has unknown key "${k}" (allowed: ${ENTRY_KEYS.join(", ")})`);
    const opus = e["opus"];
    if (!isId(opus)) problems.push(`${at} opus ${JSON.stringify(opus) ?? "undefined"} is not an opus id`);
    const name = isId(opus) ? `${where} ${opus}` : at;
    const says = e["says"];
    if (typeof says !== "string" || says.trim() === "" || /[\r\n]/.test(says) || says.length > SAYS_MAX) problems.push(`${name} says must be one non-empty line of at most ${SAYS_MAX} characters`);
    const folded = e["folded"] ?? [];
    if (!Array.isArray(folded) || !folded.every(isId)) problems.push(`${name} folded must be a list of opus ids`);
    const nextTs = e["next_ts"] ?? false;
    if (typeof nextTs !== "boolean") problems.push(`${name} next_ts must be true or false`);
    if (problems.length === before) out.push({ opus: opus as string, says: says as string, folded: folded as string[], nextTs: nextTs as boolean });
  });
  return out;
}

/**
 * The officina's `queue.yml`, judged whole: absent (no file), held (every problem, in file order) or ok. Beyond the
 * shape: an opus is listed once across every list (its folded ids included), a lane is named once across queues, two
 * lanes never hold one opus, a lane's opus is an entry of its own queue's `next`, at most one lane holds a `next_ts`
 * entry, and every opus named has a record.
 */
export function readQueue(studio: string): QueueRead {
  const file = readContainedRegularFile(studio, QUEUE_FILE, "");
  if ("error" in file) {
    if (file.code === "ENOENT") return { kind: "absent" };
    const why = `${QUEUE_FILE} cannot be read: ${file.error.split("\n")[0]}`;
    return { kind: "held", why, problems: [why] };
  }
  const problems: string[] = [];
  const held = (): QueueRead => ({ kind: "held", why: `${QUEUE_FILE} is malformed: ${problems.join("; ")}`, problems });
  let doc: unknown;
  try {
    doc = parseYaml(file.bytes.toString("utf8"));
  } catch (e) {
    problems.push(`it does not parse: ${(e as Error).message.split("\n")[0]}`);
    return held();
  }
  if (!isDict(doc)) return problems.push("it is not a mapping"), held();
  for (const k of Object.keys(doc)) if (!(TOP_KEYS as readonly string[]).includes(k)) problems.push(`unknown key "${k}" (allowed: ${TOP_KEYS.join(", ")})`);
  const qs = doc["queues"];
  const queues: Queue[] = [];
  if (!isDict(qs) || Object.keys(qs).length === 0) problems.push('it needs a "queues" mapping of at least one queue');
  else
    for (const [id, q] of Object.entries(qs)) {
      const at = `queue ${id}`;
      if (!QUEUE_ID.test(id)) problems.push(`queue id "${id}" must be lower-case letters, digits and hyphens`);
      if (!isDict(q)) {
        problems.push(`${at} is not a mapping`);
        continue;
      }
      for (const k of Object.keys(q)) if (!QUEUE_KEYS.includes(k)) problems.push(`${at} has unknown key "${k}" (allowed: ${QUEUE_KEYS.join(", ")})`);
      const lanes: [string, string | undefined][] = [];
      const ls = q["lanes"];
      if (!isDict(ls) || Object.keys(ls).length === 0) problems.push(`${at} lanes must be a mapping of at least one lane`);
      else
        for (const [lane, opus] of Object.entries(ls)) {
          if (!LANE_ID.test(lane)) problems.push(`${at} lane "${lane}" must be a letter then letters and digits`);
          if (opus !== null && !isId(opus)) problems.push(`${at} lane ${lane} holds ${JSON.stringify(opus) ?? "undefined"}, not an opus id or ~`);
          else lanes.push([lane, opus ?? undefined]);
        }
      if (q["next"] === undefined) problems.push(`${at} next must be a list`);
      queues.push({ id, lanes, next: entries(q["next"], `${at} next`, problems) });
    }
  const lists = { halted: entries(doc["halted"], "halted", problems), cut: entries(doc["cut"], "cut", problems), deferred: entries(doc["deferred"], "deferred", problems) };

  // across the file: each opus listed once, each lane named once, each opus held by one lane, held from its own queue
  const listed = new Map<string, string>();
  const list = (opus: string, where: string): void => {
    const first = listed.get(opus);
    if (first !== undefined) problems.push(`${opus} is listed twice: ${first} and ${where}`);
    else listed.set(opus, where);
  };
  const all: [string, QueueEntry[]][] = [...queues.map((q): [string, QueueEntry[]] => [`queue ${q.id} next`, q.next]), ["halted", lists.halted], ["cut", lists.cut], ["deferred", lists.deferred]];
  for (const [where, es] of all)
    for (const e of es) {
      list(e.opus, where);
      for (const f of e.folded) list(f, `${where} (folded into ${e.opus})`);
    }
  const laneOf = new Map<string, string>();
  const holder = new Map<string, string>();
  for (const q of queues)
    for (const [lane, opus] of q.lanes) {
      if (laneOf.has(lane)) problems.push(`lane ${lane} is named in queue ${laneOf.get(lane)} and queue ${q.id}`);
      else laneOf.set(lane, q.id);
      if (opus === undefined) continue;
      if (holder.has(opus)) problems.push(`${opus} is held by lane ${holder.get(opus)} and lane ${lane}`);
      else holder.set(opus, lane);
      if (!q.next.some((e) => e.opus === opus)) problems.push(`lane ${lane} holds ${opus}, which is not an entry of queue ${q.id} next`);
    }
  // one next.ts opus in flight at a time: at most one lane holds an entry marked next_ts
  const nextTsHeld = queues.flatMap((q) => q.lanes.filter(([, opus]) => q.next.some((e) => e.opus === opus && e.nextTs)).map(([lane, opus]) => `${lane} (${opus})`));
  if (nextTsHeld.length > 1) problems.push(`more than one lane holds a next_ts entry: ${nextTsHeld.join(", ")}; one next.ts opus is in flight at a time`);
  const records = recordIds(studio);
  const named = new Set([...listed.keys(), ...holder.keys()]);
  for (const opus of named) if (!records.has(opus)) problems.push(`${opus} has no record in opera/`);

  if (problems.length > 0) return held();
  return { kind: "ok", file: { queues, ...lists } };
}
