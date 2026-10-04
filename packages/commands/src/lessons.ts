/**
 * packages/commands/src/lessons.ts — W-085: the one reader of "open" lesson
 * classes. A class is closed when some lesson of it names, in `addressed_by`,
 * a rule id, a decision on disk or a done opus (W-035); every other class is
 * open. Ids read from files are only looked up in the listings already read,
 * never joined into a path. Never throws: an unreadable studio returns `[]`
 * and an unreadable lesson is skipped.
 */
import { basename, join } from "node:path";
import { listMd, readFront, readManifest } from "@bisellium/adapter-native";

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
  const d = v instanceof Date ? v : new Date(typeof v === "string" ? v : Number.NaN);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
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
    readManifest(root);
    const opera = new Map<string, string | undefined>();
    for (const p of listMd(join(root, "opera"))) {
      const d = front(p);
      if (d) opera.set(basename(p, ".md"), str(d["state"]));
    }
    const decisions = new Set(listMd(join(root, "decisions")).map((p) => basename(p, ".md")));

    interface Acc {
      lessons: string[];
      cascades: Set<number>;
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
      const acc = classes.get(cls) ?? { lessons: [], cascades: new Set<number>(), latest: { id, at }, closed: false };
      classes.set(cls, acc);
      acc.lessons.push(id);
      if (typeof d["cascade"] === "number" && Number.isFinite(d["cascade"])) acc.cascades.add(d["cascade"]);
      // newest `at` wins; a tie goes to the higher id
      if (at > acc.latest.at || (at === acc.latest.at && id > acc.latest.id)) acc.latest = { id, at };
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
        // ponytail: filled by behaviour 3
        collegia: [],
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
