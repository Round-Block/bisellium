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
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { readInput } from "@bisellium/schema";
import { parse as parseYaml } from "yaml";
import { ID_RE } from "./check.js";
import { walkReal, walkStudio } from "./inputs.js";

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

/**
 * The record ids under `opera/` (a file `<id>.md`), `opera/` walked with `walkReal` before it is listed (W-558, review
 * round 6): absent (ENOENT) is no records; a symlink, a non-directory or an unreadable `opera/` is an error, never an
 * empty set, whether or not the queue names an opus.
 */
function recordIds(studio: string): { kind: "ok"; ids: Set<string> } | { kind: "error"; why: string } {
  const walked = walkReal(studio, "opera");
  if (walked.kind === "absent") return { kind: "ok", ids: new Set() };
  if (walked.kind === "error") return walked;
  try {
    return { kind: "ok", ids: new Set(readdirSync(join(studio, "opera")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))) };
  } catch (e) {
    return { kind: "error", why: `opera cannot be read (${(e as NodeJS.ErrnoException).code ?? "error"})` };
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
export function readQueue(studio: string, base?: string): QueueRead {
  // W-558 (r1 fix): the studio and its components below any checkout `base` are real directories (the one walk, `walkStudio`)
  const below = walkStudio(studio, base);
  if (below.kind === "absent") return { kind: "absent" };
  if (below.kind === "error") return { kind: "held", why: below.why, problems: [below.why] };
  // W-558: the one fail-closed read: absent is ENOENT only, every other read failure holds
  const read = readInput(QUEUE_FILE, () => readContainedRegularFile(studio, QUEUE_FILE, ""), (bytes) => bytes);
  if (read.kind === "absent") return { kind: "absent" };
  if (read.kind === "error") return { kind: "held", why: read.why, problems: [read.why] };
  const file = { bytes: read.value };
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
  if (records.kind === "error") problems.push(records.why);
  else {
    const named = new Set([...listed.keys(), ...holder.keys()]);
    for (const opus of named) if (!records.ids.has(opus)) problems.push(`${opus} has no record in opera/`);
  }

  if (problems.length > 0) return held();
  return { kind: "ok", file: { queues, ...lists } };
}

/** W-525: why the Queue refuses a lift: it asks that the opus be ranked in a queue's `next` first, so a lift never puts back an unranked record (D-174 item 2). No queue.yml asks nothing. */
export function liftQueueRefusal(studio: string, opus: string): string | undefined {
  const read = readQueue(studio);
  if (read.kind === "absent") return undefined;
  if (read.kind === "held") return read.why;
  if (read.file.queues.some((q) => q.next.some((e) => e.opus === opus))) return undefined;
  const listed = (["halted", "cut", "deferred"] as const).find((l) => read.file[l].some((e) => e.opus === opus));
  return `${opus} is not ranked in ${QUEUE_FILE}${listed === undefined ? "" : ` (it is under ${listed})`}: rank it in a queue's next first`;
}

/** The states an idle lane may take an entry in: the ones `next --all` lists (greenlit up to review). */
const TAKEABLE = new Set(["greenlit", "building", "verifying", "review"]);
/** A lane whose opus is in one of these holds nothing: the lane is idle. */
const RELEASED = new Set(["done", "halted"]);

/** W-512: one lane as the queue reads it: the opus it holds (busy), or the entry it takes (idle), and each entry passed over. */
interface LaneTake {
  queue: string;
  lane: string;
  /** The lane's own opus when it is busy (not done or halted). */
  busy?: string;
  /** The idle lane's own opus, done or halted, if any. */
  released?: string;
  take?: { opus: string; rank: number };
  skipped: string[];
}

/** W-333, W-512: the lanes' takes, the one computation `laneLines` prints and `lanePlan` orders starts by (see `laneLines`). */
function laneTakes(file: QueueFile, stateOf: (opus: string) => string | undefined): LaneTake[] {
  const state = (opus: string): string => stateOf(opus) ?? "no state";
  const nextTs = new Set(file.queues.flatMap((q) => q.next.filter((e) => e.nextTs).map((e) => e.opus)));
  const held = new Map<string, string>();
  let nextTsBy: string | undefined;
  const hold = (opus: string, why: string, lane: string): void => {
    held.set(opus, why);
    if (nextTs.has(opus) && nextTsBy === undefined) nextTsBy = `${lane}'s ${opus}`;
  };
  const busy = (opus: string | undefined): opus is string => opus !== undefined && !RELEASED.has(state(opus));
  for (const q of file.queues) for (const [lane, opus] of q.lanes) if (busy(opus)) hold(opus, `in ${lane}`, lane);
  const out: LaneTake[] = [];
  for (const q of file.queues)
    for (const [lane, opus] of q.lanes) {
      if (busy(opus)) {
        out.push({ queue: q.id, lane, busy: opus, skipped: [] });
        continue;
      }
      const skipped: string[] = [];
      let take: LaneTake["take"];
      for (const [i, e] of q.next.entries()) {
        const s = state(e.opus);
        const why = held.get(e.opus) ?? (!TAKEABLE.has(s) ? s : e.nextTs && nextTsBy !== undefined ? `next.ts with ${nextTsBy}` : undefined);
        if (why !== undefined) {
          skipped.push(`${e.opus} (#${i + 1}): ${why}`);
          continue;
        }
        take = { opus: e.opus, rank: i + 1 };
        hold(e.opus, `taken by ${lane}`, lane);
        break;
      }
      out.push({ queue: q.id, lane, ...(opus === undefined ? {} : { released: opus }), ...(take === undefined ? {} : { take }), skipped });
    }
  return out;
}

/**
 * W-333 (W-478 folded): one line per lane, by queue in file order. A lane holding an opus that is not done or halted
 * is busy: `lane: <queue> <lane> · <opus> <state>`. Any other lane is idle and names the entry it would take: the
 * highest entry of its own queue's `next` that no lane holds or takes before it, whose record is greenlit up to review,
 * and that is not marked `next_ts` while another lane holds or takes a `next_ts` opus (one `next.ts` opus at a time).
 * Busy lanes are read first, then idle lanes in file order, each idle lane's take holding its entry for the lanes after
 * it. Every entry passed over above the take is named with its reason; a skipped entry keeps its place (nothing is
 * reordered or written). `stateOf` reads an opus record's state (undefined: none).
 */
export function laneLines(file: QueueFile, stateOf: (opus: string) => string | undefined): string[] {
  const state = (opus: string): string => stateOf(opus) ?? "no state";
  return laneTakes(file, stateOf).map((t) => {
    const head = `lane: ${t.queue} ${t.lane}`;
    if (t.busy !== undefined) return `${head} · ${t.busy} ${state(t.busy)}`;
    const idle = t.released === undefined ? "idle" : `idle (${t.released} ${state(t.released)})`;
    return [head, idle, t.take === undefined ? "nothing to take" : `takes ${t.take.opus} (#${t.take.rank})`, ...(t.skipped.length > 0 ? [`skipped ${t.skipped.join(", ")}`] : [])].join(" · ");
  });
}

/** W-512: a lane's place in the start order: the opus it holds or takes now, and the entry it takes once that one is done (its spec ahead). */
export interface LanePlan {
  queue: string;
  lane: string;
  now?: { opus: string; busy: boolean; state: string; rank?: number };
  ahead?: { opus: string; rank: number };
}

/**
 * W-512: the lanes' start order, read as `laneLines` reads them (one computation, `laneTakes`): each lane's `now` is the
 * opus it holds or, idle, the entry it takes; its `ahead` is the entry it would take were every lane's `now` done (one
 * ahead, never two). `stateOf` may throw: the caller turns that into a refusal, never a skipped entry.
 */
export function lanePlan(file: QueueFile, stateOf: (opus: string) => string | undefined): LanePlan[] {
  const first = laneTakes(file, stateOf);
  const nows = new Set(first.map((t) => t.busy ?? t.take?.opus).filter((o): o is string => o !== undefined));
  const then = laneTakes(file, (o) => (nows.has(o) ? "done" : stateOf(o)));
  return first.map((t, i) => {
    const opus = t.busy ?? t.take?.opus;
    const after = then[i]?.take;
    return {
      queue: t.queue,
      lane: t.lane,
      ...(opus === undefined ? {} : { now: { opus, busy: t.busy !== undefined, state: stateOf(opus) ?? "no state", ...(t.take === undefined ? {} : { rank: t.take.rank }) } }),
      ...(after === undefined ? {} : { ahead: after }),
    };
  });
}

/** W-512: where an opus stands in the start order: a lane's `now` (it may branch), a lane's `ahead` (its spec only), or refused (why). */
/** W-512 (W-592's lane-start half): another lane's now, held or taken: the lane an opus in flight is named by in an overlap hold. */
export interface LaneHeld {
  opus: string;
  lane: string;
}

export type StartOrder = { kind: "free" } | { kind: "now"; lane: string; held: LaneHeld[] } | { kind: "ahead"; lane: string; why: string } | { kind: "refused"; why: string };

/**
 * W-512 (D-181, D-182, D-194): whether `id` may start. No queue.yml orders nothing (`free`); a held queue, an unranked
 * opus or a state read that throws refuses (fail closed). A lane's `now` may take every rung; a lane's `ahead` may take
 * its spec rung only; any other opus is refused. The why names the opus's rank, each lane's now and ahead, and the one
 * way past: a landed re-rank of queue.yml (D-181 item 8).
 */
export function startOrder(read: QueueRead, id: string, stateOf: (opus: string) => string | undefined): StartOrder {
  if (read.kind === "absent") return { kind: "free" };
  if (read.kind === "held") return { kind: "refused", why: `no start is ordered while ${read.why}` };
  const q = read.file.queues.find((x) => x.next.some((e) => e.opus === id));
  if (q === undefined) {
    const into = read.file.queues.flatMap((x) => x.next).find((e) => e.folded.includes(id))?.opus;
    const listed = (["halted", "cut", "deferred"] as const).find((l) => read.file[l].some((e) => e.opus === id || e.folded.includes(id)));
    const where = into !== undefined ? ` (it is folded into ${into})` : listed === undefined ? "" : ` (it is under ${listed})`;
    return { kind: "refused", why: `${id} is not ranked in ${QUEUE_FILE}${where}: rank it in a queue's next and land that edit before it starts` };
  }
  // a lane's own opus or take is judged on the lanes' first pass alone: an entry ranked below it never holds its start
  let plan: LanePlan[];
  try {
    const takes = laneTakes(read.file, stateOf);
    const now = takes.find((t) => (t.busy ?? t.take?.opus) === id);
    // every other lane's now, held or taken, in every queue (spec r2 S1: a take branched while its lane is still ~ is that lane's):
    // the branch rung names their lanes when it reads the Files owned of every opus in flight
    if (now !== undefined) return { kind: "now", lane: now.lane, held: takes.flatMap((t) => { const o = t.busy ?? t.take?.opus; return t !== now && o !== undefined ? [{ opus: o, lane: t.lane }] : []; }) };
    plan = lanePlan(read.file, stateOf);
  } catch (e) {
    return { kind: "refused", why: `the queue order cannot be read: ${(e as Error).message.split("\n")[0]}` };
  }
  const rank = q.next.findIndex((e) => e.opus === id) + 1;
  const lanes = plan
    .filter((p) => p.queue === q.id)
    .map((p) => [`${p.lane} ${p.now === undefined ? "takes nothing" : p.now.busy ? `holds ${p.now.opus} (${p.now.state})` : `takes ${p.now.opus} (#${p.now.rank})`}`, ...(p.ahead === undefined ? [] : [`ahead ${p.ahead.opus} (#${p.ahead.rank})`])].join(", "))
    .join("; ");
  const way = "to start it now, rank it higher in queue.yml and land that edit";
  const ahead = plan.find((p) => p.ahead?.opus === id);
  if (ahead !== undefined) return { kind: "ahead", lane: ahead.lane, why: `${id} is #${rank} in queue ${q.id}, the spec ahead of lane ${ahead.lane}: its spec may be signed, and it branches when the lane takes it: ${lanes}; ${way}` };
  return { kind: "refused", why: `${id} is #${rank} in queue ${q.id} and no lane takes it: ${lanes}; ${way}` };
}
