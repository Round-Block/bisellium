/**
 * packages/cli/src/inputs.ts — W-558: the loaders of the lock inputs, each on @bisellium/schema's one fail-closed read
 * (`readInput`): an opus record (`opera/<id>.md`), a step marker (`.bisellium/steps/<id>.json`), the step markers of a
 * main checkout, a run receipt (`receipts/<sella>/<name>.json`); `queue.yml` is read by `readQueue` on the same read.
 * Absent is file-not-found only; every other read failure or a value outside the input's domain is an error the caller
 * propagates. The closed sets are read where they are defined: the lifecycle state ids from @bisellium/adapter-native's
 * `STATES`, the step names from `STEPS` (defined here, re-exported by next.ts). `inputCensus` lists every raw read of
 * these inputs outside the loaders, as a warning. Reads only: it writes nothing. See studio/briefs/W-558.md.
 */
import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { STATES, parseFrontMatter } from "@bisellium/adapter-native";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { readInput, type InputRead } from "@bisellium/schema";

/** Every rung `next` derives and every step a marker may name (moved here from next.ts by W-558; next.ts re-exports it). */
export const STEPS = ["greenlight", "spec", "branch", "ready", "reds", "build", "review", "pr", "merge", "cleanup", "done", "retro", "checkpoint"] as const;
export type Step = (typeof STEPS)[number];

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const STATE_IDS: readonly string[] = STATES.map((s) => s.id);

/** W-558: an opus record's front matter (`rel` is the caller's `opera/<id>.md`): a mapping whose `state` is a lifecycle state id (`STATES`). */
export function loadOpusRecord(studio: string, rel: string, base?: string): InputRead<Dict> {
  const below = walkStudio(studio, base);
  if (below.kind !== "valid") return below;
  return readInput(rel, () => readContainedRegularFile(studio, rel, "opera"), (bytes) => {
    let data: unknown;
    try {
      data = parseFrontMatter<unknown>(bytes.toString("utf8"), rel).data;
    } catch {
      throw new Error("has no front matter");
    }
    if (!isDict(data)) throw new Error("front matter must be a mapping");
    const state = data["state"];
    if (state === undefined) throw new Error("has no state");
    if (typeof state !== "string" || !STATE_IDS.includes(state)) throw new Error(`has state ${JSON.stringify(state)}, not one of ${STATE_IDS.join(", ")}`);
    return data;
  });
}

export interface Marker {
  schema: 1;
  opus: string;
  step: Step;
  pid: number;
  start_ticks: number;
  started: string;
  output: string;
  budget_seconds: number;
  writer: "perform" | "track";
}

const OUTPUT = /^steps\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The marker shape (next.ts's `parseMarker` and meanwhile.ts's marker checks, one domain): the reason a value is outside it, or undefined. A `step` outside `STEPS` is outside it. */
export function markerProblem(m: unknown, id: string): string | undefined {
  if (!isDict(m)) return "is not an object";
  const posInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
  if (m["opus"] !== id) return "names another opus";
  if (typeof m["step"] !== "string" || !(STEPS as readonly string[]).includes(m["step"])) return `names an unknown step ${JSON.stringify(m["step"]) ?? "undefined"} (not one of ${STEPS.join(", ")})`;
  if (!posInt(m["budget_seconds"], 1) || m["budget_seconds"] > 86_400) return "has an invalid budget_seconds";
  if (typeof m["output"] !== "string" || !OUTPUT.test(m["output"])) return "has an invalid output";
  if (m["schema"] !== 1 || !posInt(m["pid"], 2) || !posInt(m["start_ticks"], 1) || typeof m["started"] !== "string" || (m["writer"] !== "perform" && m["writer"] !== "track")) return "has an invalid schema, pid, start_ticks, started or writer";
  return undefined;
}

/**
 * W-558 (r1 fix, one class): the one component walk every loader path goes through. Each component of `rel` below `base`
 * is `lstat`ed in turn: `ENOENT` at the first missing one is absence; a symlink (dangling or empty-target included), a
 * non-directory where a directory goes (or, with `final: "file"`, a non-regular last component), or an unstatable one
 * is an error naming the component. `base` itself (the main checkout) is the trusted root and is not walked.
 */
export function walkReal(base: string, rel: string, final: "directory" | "file" = "directory"): InputRead<true> {
  const parts = rel.split(/[\\/]/).filter((p) => p !== "");
  let at = base;
  let shown = "";
  for (const [i, part] of parts.entries()) {
    at = join(at, part);
    shown = shown === "" ? part : `${shown}/${part}`;
    let st;
    try {
      st = lstatSync(at);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return code === "ENOENT" ? { kind: "absent" } : { kind: "error", why: `${shown} cannot be read (${code ?? "error"})` };
    }
    if (st.isSymbolicLink()) return { kind: "error", why: `${shown} is a symlink, not a real directory` };
    const last = i === parts.length - 1;
    if (last && final === "file") {
      if (!st.isFile()) return { kind: "error", why: `${shown} is not a regular file` };
    } else if (!st.isDirectory()) return { kind: "error", why: `${shown} is not a directory` };
  }
  return { kind: "valid", value: true };
}

/**
 * W-558 (r1 fix): the one walk of a studio path's components, no loader form skipping it: below its checkout `base` when
 * `base` holds the studio, else (no `base`, a studio outside it, or `base` itself) from the studio's own parent, so the
 * studio directory itself is walked: the officina as the root (`check`, `lift`) is no exception. Only `base` (the trusted
 * checkout) or the parent is unwalked; the loaders' own contained read covers everything below the studio.
 */
export function walkStudio(studio: string, base?: string): InputRead<true> {
  const abs = resolve(studio);
  if (base !== undefined) {
    const rel = relative(resolve(base), abs);
    if (rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel)) return walkReal(resolve(base), rel);
  }
  const parent = dirname(abs);
  return parent === abs ? { kind: "valid", value: true } : walkReal(parent, basename(abs));
}

/**
 * W-558 (D-086 A): the `<main>/.bisellium/steps` collection is valid only as real directories reached without a symlink
 * (`walkReal`, `.bisellium` and `steps` both): a genuinely absent one (`ENOENT`) is absence; a symlink (dangling or
 * empty-target included), a non-directory, or an unstatable component is an error.
 */
export function checkCollection(bisellium: string): InputRead<true> {
  return walkReal(dirname(bisellium), `${basename(bisellium)}/steps`);
}

/** W-558: the step marker `<bisellium>/steps/<name>`, `name` ending `.json`, read contained (no symlink, a regular file). */
export function loadMarker(bisellium: string, name: string): InputRead<Marker> {
  const rel = `steps/${name}`;
  const collection = checkCollection(bisellium);
  if (collection.kind !== "valid") return collection;
  return readInput(`the step marker .bisellium/${rel}`, () => readContainedRegularFile(bisellium, rel, "steps"), (bytes) => {
    let m: unknown;
    try {
      m = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("is not JSON");
    }
    const why = markerProblem(m, name.slice(0, -".json".length));
    if (why !== undefined) throw new Error(why);
    return m as Marker;
  });
}

/**
 * W-558: every step marker under `<main>/.bisellium/steps/`: an absent directory is none; the candidates are the `.json`
 * entries, save one a marker that reads valid names as its `output` (W-559: a `.json` output is an output, not a marker);
 * any other candidate that is not a valid marker, and an unlistable directory, is an error.
 */
export function loadMarkers(main: string): InputRead<{ name: string; marker: Marker }[]> {
  const bisellium = join(main, ".bisellium");
  const collection = checkCollection(bisellium);
  if (collection.kind !== "valid") return collection;
  const listed = readInput(".bisellium/steps", () => ({ bytes: readdirSync(join(bisellium, "steps")) }), (names) => names.filter((n) => n.endsWith(".json")).sort());
  if (listed.kind !== "valid") return listed;
  const reads = listed.value.map((name) => ({ name, read: loadMarker(bisellium, name) }));
  const outputs = new Set(reads.flatMap((r) => (r.read.kind === "valid" ? [r.read.value.output] : [])));
  const out: { name: string; marker: Marker }[] = [];
  for (const { name, read } of reads) {
    if (read.kind === "valid") out.push({ name, marker: read.value });
    else if (!outputs.has(`steps/${name}`)) return read.kind === "absent" ? { kind: "error", why: `.bisellium/steps/${name} vanished while it was read` } : read;
  }
  return { kind: "valid", value: out };
}

export interface ReceiptRead {
  cmd: string[];
  endedAt?: unknown;
}

/** W-558: a run receipt `<studio>/receipts/<sella>/<name>`: a JSON object whose `cmd` is a list of strings. */
export function loadReceipt(studio: string, sella: string, name: string, base?: string): InputRead<ReceiptRead> {
  const rel = `receipts/${sella}/${name}`;
  const below = walkStudio(studio, base);
  if (below.kind !== "valid") return below;
  return readInput(join(studio, rel), () => readContainedRegularFile(studio, rel, "receipts"), (bytes) => {
    let r: unknown;
    try {
      r = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("is not JSON");
    }
    if (!isDict(r)) throw new Error("is not an object");
    const cmd = r["cmd"];
    if (!Array.isArray(cmd) || !cmd.every((a): a is string => typeof a === "string")) throw new Error("has no cmd list of strings");
    return { cmd, endedAt: r["endedAt"] };
  });
}

/** The forms `inputCensus` recognises as a raw read of a lock input; every other form is not seen (a stated limit). */
const RAW_FORMS: { re: RegExp; input: string }[] = [
  { re: /readContainedRegularFile\([^;]*"opera"/, input: "an opus record" },
  { re: /readContainedRegularFile\([^;]*"steps"/, input: "a step marker" },
  { re: /readContainedRegularFile\([^;]*"receipts"/, input: "a run receipt" },
  { re: /readContainedRegularFile\([^;]*QUEUE_FILE/, input: "queue.yml" },
  { re: /readFileSync\([^;]*(markerPath\(|receipts|queue\.yml|QUEUE_FILE)/, input: "a lock input" },
  { re: /\.read\(recordRel\(|(?<![\p{L}\p{M}\p{N}])recordOf\(/u, input: "an opus record" },
  { re: /Partial<Receipt>/, input: "a run receipt" },
];

/** W-558: every raw read of a lock input in `text` (the source of `file`), one warning per line: `<file>:<line>: <input> read outside the loaders`. */
export function inputCensus(file: string, text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    const hit = RAW_FORMS.find((f) => f.re.test(line));
    if (hit !== undefined) out.push(`${file}:${i + 1}: ${hit.input} read outside the loaders`);
  });
  return out;
}
