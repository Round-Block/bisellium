/**
 * packages/commands/src/lessons.ts — W-085: the one reader of "open" lesson
 * classes. A class is closed when some lesson of it names, in `addressed_by`,
 * a rule id, a decision on disk or a done opus (W-035); every other class is
 * open. Ids read from files are only looked up in the listings already read,
 * never joined into a path. Never throws: an unreadable studio returns `[]`
 * and an unreadable lesson is skipped.
 */
import { basename, join } from "node:path";
import { listMd, readFront, readManifest, resolveSeat } from "@bisellium/adapter-native";
import { instant } from "@bisellium/schema";

export interface OpenLessonClass {
  class: string;
  /** lesson ids of the class, ascending */
  lessons: string[];
  /** distinct `cascade` values, ascending */
  cascades: number[];
  /** id of the lesson with the newest `at` (tie: the higher id) */
  latest: string;
  /** that lesson's `at`, ISO */
  latestAt: string;
  /** attributed collegium ids, sorted */
  collegia: string[];
  fixInFlight?: { id: string; state: string };
}

type Front = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
/** A rule id is dotted `noun.attribute`; a path ("../opera/W-001") is not one. */
const RULE_SHAPE = /^[A-Za-z][\w-]*(\.[\w-]+)+$/;

/** `at` reads as a Date when unquoted in YAML, a string when quoted. */
function iso(v: unknown): string {
  return instant(v)?.toISOString() ?? "";
}

function front(path: string): Front | undefined {
  try {
    const d = readFront<Front>(path).data;
    return typeof d === "object" && d !== null && !Array.isArray(d) ? d : undefined;
  } catch {
    return undefined;
  }
}

export function openLessons(root: string): OpenLessonClass[] {
  try {
    const manifest = readManifest(root);
    const declared = (manifest.collegia ?? []).map((c) => c.id);
    const opera = new Map<string, string | undefined>();
    // opus id -> its own collegium plus the collegium of every gate sella
    const paid = new Map<string, Set<string>>();
    for (const p of listMd(join(root, "opera"))) {
      const d = front(p);
      if (!d) continue;
      const id = basename(p, ".md");
      opera.set(id, str(d["state"]));
      const set = new Set<string>();
      const own = str(d["collegium"]);
      if (own) set.add(own);
      const gates = d["probationes"];
      if (typeof gates === "object" && gates !== null)
        for (const g of Object.values(gates)) {
          const sella = typeof g === "object" && g !== null ? str((g as Front)["sella"]) : undefined;
          const c = sella && resolveSeat(manifest, sella)?.seat.collegium;
          if (c) set.add(c);
        }
      paid.set(id, set);
    }
    const decisions = new Set(listMd(join(root, "decisions")).map((p) => basename(p, ".md")));

    interface Acc {
      lessons: string[];
      cascades: Set<number>;
      collegia: Set<string>;
      latest: { id: string; at: string };
      closed: boolean;
      inFlight?: { id: string; state: string };
    }
    const classes = new Map<string, Acc>();
    for (const p of listMd(join(root, "lessons"))) {
      const d = front(p);
      const cls = d && str(d["class"]);
      if (!d || !cls) continue;
      const id = basename(p, ".md");
      const at = iso(d["at"]);
      const acc = classes.get(cls) ?? { lessons: [], cascades: new Set<number>(), collegia: new Set<string>(), latest: { id, at }, closed: false };
      classes.set(cls, acc);
      acc.lessons.push(id);
      if (typeof d["cascade"] === "number" && Number.isFinite(d["cascade"])) acc.cascades.add(d["cascade"]);
      // newest `at` wins; a tie goes to the higher id
      if (at > acc.latest.at || (at === acc.latest.at && id > acc.latest.id)) acc.latest = { id, at };
      const named = (Array.isArray(d["evidence"]) ? d["evidence"] : [])
        .flatMap((h) => (typeof h === "string" ? (h.match(/\bW-\d+\b/g) ?? []) : []))
        .filter((w) => paid.has(w));
      // evidence that names no existing opus counts for every collegium
      for (const c of named.length ? named.flatMap((w) => [...paid.get(w)!]) : declared) acc.collegia.add(c);
      const v = str(d["addressed_by"]);
      if (v === undefined) continue;
      if (opera.has(v)) {
        const state = opera.get(v) ?? "";
        if (state === "done") acc.closed = true;
        else if (acc.inFlight === undefined || v < acc.inFlight.id) acc.inFlight = { id: v, state };
      } else if (RULE_SHAPE.test(v) || decisions.has(v)) acc.closed = true;
    }
    return [...classes]
      .filter(([, a]) => !a.closed)
      .map(([cls, a]) => ({
        class: cls,
        lessons: a.lessons.sort(),
        cascades: [...a.cascades].sort((x, y) => x - y),
        latest: a.latest.id,
        latestAt: a.latest.at,
        collegia: [...a.collegia].sort(),
        ...(a.inFlight === undefined ? {} : { fixInFlight: a.inFlight }),
      }))
      .sort(
        (a, b) =>
          b.cascades.length - a.cascades.length ||
          b.lessons.length - a.lessons.length ||
          (a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0) ||
          (a.class < b.class ? -1 : a.class > b.class ? 1 : 0),
      );
  } catch {
    return [];
  }
}
