/**
 * packages/cli/src/exits.ts — W-404: milestone progress by exits, not filings. A milestone is met when its exit is
 * met (`milestones.yml`, D-038): an `opus:` exit when that opus's record is `done`, a `rule:` exit when `check` reports
 * no finding of that rule. A `needs:` exit names no opus or rule, so no record meets it (W-281 re-points them), and a
 * milestone with no exit is never met. The share is the weight of the met milestones over every milestone's weight, so
 * filing more opera under a milestone moves nothing. `bisellium milestones` prints the report; `next --all` prints it
 * as one line. Reads only: it writes nothing. See studio/briefs/W-404.md.
 *
 * "On its exit path": the records link opera to an exit two ways only, the exit's own `opus:` and an opus's
 * `parent:` (the opus it was split from). The path is the exit opus and every opus whose parent chain reaches it. An
 * opus's `milestone:` names the milestone it serves, not an exit that waits on it, so it is not read here.
 */
import { lstatSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { listMd, readFront } from "@bisellium/adapter-native";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { openStudio, parseFlags, resolveNow } from "@bisellium/commands/writes.js";
import { parse as parseYaml } from "yaml";
import { checkStudio, ID_RE } from "./check.js";
import { RULE_IDS } from "./rules/ids.js";

const MILESTONES_USAGE = "usage: bisellium milestones [--studio <dir>] [--repo <dir>] [--now <iso>]";
const EXIT_KEYS = ["opus", "rule", "needs"] as const;

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const byId = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

export type Exit = { kind: "opus" | "rule" | "needs"; ref: string } | { kind: "none" };
export interface Declared {
  id: string;
  title: string;
  weight: number;
  exit: Exit;
}
interface Record_ {
  state: string | undefined;
  parent: string | undefined;
}
export interface ExitRow extends Declared {
  met: boolean;
  /** The exit as printed: what it names and what the records say of it. */
  status: string;
  /** The exit opus and every opus whose parent chain reaches it, in id order after the exit opus; empty otherwise. */
  path: { id: string; state: string }[];
}
export type ExitReport = { kind: "absent" } | { kind: "held"; why: string } | { kind: "report"; rows: ExitRow[]; met: number; share: number };

/** The declared milestones, judged for the report alone (check's milestones.shape stays the gate): every problem. */
export function readExits(studio: string): { kind: "absent" } | { kind: "held"; why: string } | { kind: "ok"; milestones: Declared[] } {
  const file = readContainedRegularFile(studio, "milestones.yml", "");
  if ("error" in file) return file.code === "ENOENT" ? { kind: "absent" } : { kind: "held", why: `milestones.yml cannot be read: ${file.error.split("\n")[0]}` };
  let doc: unknown;
  try {
    doc = parseYaml(file.bytes.toString("utf8"));
  } catch (e) {
    return { kind: "held", why: `milestones.yml is malformed: it does not parse: ${(e as Error).message.split("\n")[0]}` };
  }
  const list = isDict(doc) ? doc["milestones"] : undefined;
  if (!Array.isArray(list)) return { kind: "held", why: 'milestones.yml is malformed: it needs a "milestones" list' };
  if (list.length === 0) return { kind: "held", why: "milestones.yml is malformed: it lists no milestone" };
  const problems: string[] = [];
  const seen = new Set<string>();
  const milestones: Declared[] = [];
  list.forEach((m, i) => {
    if (!isDict(m)) return void problems.push(`milestone #${i + 1} is not a mapping`);
    const id = m["id"];
    const name = typeof id === "string" ? `milestone ${id}` : `milestone #${i + 1}`;
    const before = problems.length;
    if (typeof id !== "string" || !ID_RE.test(id)) problems.push(`milestone #${i + 1} id ${JSON.stringify(id) ?? "undefined"} is not a valid id`);
    else if (seen.has(id)) problems.push(`duplicate milestone id "${id}"`);
    else seen.add(id);
    if (!nonEmpty(m["title"])) problems.push(`${name} title must be a non-empty string`);
    const w = m["weight"];
    if (typeof w !== "number" || !Number.isSafeInteger(w) || w <= 0) problems.push(`${name} weight must be a positive integer`);
    const exit = m["exit"];
    const keys = isDict(exit) ? Object.keys(exit) : [];
    const key = EXIT_KEYS.find((k) => k === keys[0]);
    let parsed: Exit = { kind: "none" };
    if (!("exit" in m)) parsed = { kind: "none" };
    else if (!isDict(exit) || keys.length !== 1 || key === undefined || !nonEmpty(exit[key])) problems.push(`${name} exit must be absent or have exactly one of opus | rule | needs, a non-empty string`);
    else parsed = { kind: key, ref: exit[key] as string };
    if (problems.length === before) milestones.push({ id: id as string, title: m["title"] as string, weight: w as number, exit: parsed });
  });
  if (problems.length > 0) return { kind: "held", why: `milestones.yml is malformed: ${problems.join("; ")}` };
  return { kind: "ok", milestones };
}

/** Every opus record under `opera/`, by file id; any record that cannot be read holds the report (it may be on a path). */
function readOpera(studio: string): { kind: "held"; why: string } | { kind: "ok"; opera: Map<string, Record_> } {
  const opera = new Map<string, Record_>();
  const bad: string[] = [];
  for (const file of listMd(join(studio, "opera"))) {
    const id = basename(file).slice(0, -3);
    if (!ID_RE.test(id)) continue;
    try {
      if (!lstatSync(file).isFile()) continue; // never followed: a skipped exit opus reads as no record, so not met
      const data: unknown = readFront<unknown>(file).data;
      if (!isDict(data)) throw new Error("front matter is not a mapping");
      opera.set(id, { state: typeof data["state"] === "string" ? data["state"] : undefined, parent: typeof data["parent"] === "string" ? data["parent"] : undefined });
    } catch (e) {
      bad.push(`opera/${id}.md cannot be read (${(e as Error).message.split("\n")[0]})`);
    }
  }
  return bad.length > 0 ? { kind: "held", why: bad.join("; ") } : { kind: "ok", opera };
}

/** The exit opus and every opus whose parent chain reaches it (each once, so a parent cycle ends). */
function pathOf(exitOpus: string, opera: Map<string, Record_>): { id: string; state: string }[] {
  const children = new Map<string, string[]>();
  for (const [id, r] of opera) if (r.parent !== undefined) children.set(r.parent, [...(children.get(r.parent) ?? []), id]);
  const seen = new Set([exitOpus]);
  const queue = [exitOpus];
  for (let i = 0; i < queue.length; i++) for (const c of children.get(queue[i]!) ?? []) if (!seen.has(c)) (seen.add(c), queue.push(c));
  return [exitOpus, ...[...seen].filter((id) => id !== exitOpus).sort(byId)].map((id) => ({ id, state: opera.get(id)?.state ?? "no state" }));
}

/** The report: each milestone's exit, whether it is met, its path, and the weighted share of exits met. */
export function exitReport(studio: string, repo: string, now: Date): ExitReport {
  const declared = readExits(studio);
  if (declared.kind !== "ok") return declared;
  const read = readOpera(studio);
  if (read.kind === "held") return read;
  const { opera } = read;
  const rules = declared.milestones.some((m) => m.exit.kind === "rule" && RULE_IDS.has(m.exit.ref));
  const findings = rules ? checkStudio(studio, now, { repo }).findings : [];
  const rows = declared.milestones.map((m): ExitRow => {
    const e = m.exit;
    if (e.kind === "opus") {
      const r = opera.get(e.ref);
      if (r === undefined) return { ...m, met: false, status: `opus ${e.ref} (no record)`, path: [] };
      return { ...m, met: r.state === "done", status: `opus ${e.ref} (${r.state ?? "no state"})`, path: pathOf(e.ref, opera) };
    }
    if (e.kind === "rule") {
      if (!RULE_IDS.has(e.ref)) return { ...m, met: false, status: `rule ${e.ref} (not a check rule)`, path: [] };
      const n = findings.filter((f) => f.rule === e.ref).length;
      return { ...m, met: n === 0, status: `rule ${e.ref} (${n === 0 ? "no finding" : n === 1 ? "1 finding" : `${n} findings`})`, path: [] };
    }
    if (e.kind === "needs") return { ...m, met: false, status: `needs: ${e.ref} (no record can meet it)`, path: [] };
    return { ...m, met: false, status: "none stated", path: [] };
  });
  const total = rows.reduce((n, r) => n + r.weight, 0);
  const metWeight = rows.reduce((n, r) => n + (r.met ? r.weight : 0), 0);
  return { kind: "report", rows, met: rows.filter((r) => r.met).length, share: Math.floor((100 * metWeight) / total) };
}

const summary = (r: { rows: ExitRow[]; met: number; share: number }): string => `milestones: ${r.met} of ${r.rows.length} exits met, ${r.share}% by weight`;
const one = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");

/** `bisellium milestones`: the report, one line per milestone after the summary. Exit 0, or 1 when held. */
export function runMilestones(argv: string[]): { exitCode: number } {
  const usage = (msg: string): { exitCode: number } => {
    console.error(`milestones: ${msg}\n${MILESTONES_USAGE}`);
    return { exitCode: 2 };
  };
  const parsed = parseFlags(argv, { valued: ["--studio", "--repo", "--now"] });
  if ("error" in parsed) return usage(parsed.error);
  if (parsed.positionals.length > 0) return usage("takes no positional argument");
  const repo = resolve(parsed.values.get("--repo") ?? ".");
  const opened = openStudio(parsed.values.get("--studio") ?? join(repo, "studio"));
  if ("error" in opened) return usage(opened.error);
  const now = resolveNow(parsed.values.get("--now"), undefined);
  if (now === undefined) return usage("--now must be an ISO date");
  let r: ExitReport;
  try {
    r = exitReport(opened.root, repo, now);
  } catch (e) {
    r = { kind: "held", why: (e as Error).message.split("\n")[0] ?? "" };
  }
  if (r.kind === "absent") {
    console.log("milestones: none: the officina has no milestones.yml");
    return { exitCode: 0 };
  }
  if (r.kind === "held") {
    console.log(one(`milestones: held · why: ${r.why}`));
    return { exitCode: 1 };
  }
  const lines = r.rows.map((m) => `${m.id} ${m.met ? "met" : "open"} · weight ${m.weight} · ${m.title} · exit: ${m.status} · path: ${m.path.length === 0 ? "none" : m.path.map((p) => `${p.id} ${p.state}`).join(", ")}`);
  console.log([summary(r), ...lines].map(one).join("\n"));
  return { exitCode: 0 };
}

/** W-404 behaviour 2: the report as one `next --all` line, undefined when the officina has no milestones.yml. A held
 *  report, or a throw, is a held line. Each milestone is `<id> met|open: <exit>; path <ids>`, the needs text left to the
 *  verb. The caller bounds the line, as every `next --all` line. */
export function milestonesLine(studio: string, repo: string, now: Date): { line: string; held: boolean } | undefined {
  let r: ExitReport;
  try {
    r = exitReport(studio, repo, now);
  } catch (e) {
    return { line: `milestones: held · why: ${(e as Error).message.split("\n")[0]}`, held: true };
  }
  if (r.kind === "absent") return undefined;
  if (r.kind === "held") return { line: `milestones: held · why: ${r.why}`, held: true };
  const exit = (e: Exit): string => (e.kind === "none" ? "no exit" : e.kind === "needs" ? "needs" : `${e.kind} ${e.ref}`);
  const each = r.rows.map((m) => `${m.id} ${m.met ? "met" : "open"}: ${exit(m.exit)}; path ${m.path.length === 0 ? "none" : m.path.map((p) => p.id).join(", ")}`);
  return { line: [summary(r), ...each].join(" · "), held: false };
}
