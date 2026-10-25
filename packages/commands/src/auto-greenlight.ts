/**
 * W-403 (D-061 §4, D-076 D; the Patron 2026-10-24/25): `greenlight <opus> --auto`, the greenlight of an opus whose scope
 * is already decided, with no Patron and no daily cap. Two kinds qualify, each read from records other seats' verbs
 * wrote, never from a field the producer types alone:
 *
 * - a D-061 §4 remainder: the opus's `parent:` (written by `new --parent`) is greenlit or done, and the parent's spec logs
 *   under ci/ hold two failed reviews by the configured spec reviewer with no passed review between (the split next
 *   names at spec);
 * - a D-076 D cause fix: a class its title names (`<area>×<slug>`) is the `[class:]` tag of a standing `[severity: S1]`
 *   blocker in the failed review or spec logs of two or more other opera (the census).
 *
 * The title only looks a class up; the census decides. Free text may refuse, never admit. What the records hold but
 * this cannot read or judge (a malformed parent spec log) refuses the opus; what reads and does not qualify is not
 * that kind. The grant is the Patron's decision `bisellium.yml#auto_greenlit_by` names; with none, `--auto` refuses.
 * Reads only: the write is runGreenlight's (writes.ts).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import type { Manifest } from "@bisellium/adapter-native";
import { splitFront } from "./frontmatter.js";
import { patronDecisionProblem } from "./lifecycle.js";
import { readContainedRegularFile } from "./opus-model.js";
import { CLASS_TAG, parseVerdictLog } from "./verdict.js";

/** The manifest key naming the Patron's decision that grants auto greenlights (W-403). */
export const AUTO_SETTING = "auto_greenlit_by";
/** A remainder's parent has passed greenlight: open or done. */
const PARENT_STATES = new Set(["greenlit", "building", "verifying", "review", "done"]);
/** A class token in a title: `<area>×<slug>`, each a lower-case word of letters, digits and hyphens (W-297's tag body). */
const CLASS_TOKEN = /(?<![\p{L}\p{M}\p{N}_-])([a-z0-9][a-z0-9-]*×[a-z0-9][a-z0-9-]*)(?![\p{L}\p{M}\p{N}_-])/gu;
/** A review or spec log of an opus, by name. */
const REVIEW_LOG = /^(.+)-(?:review|spec)-[1-9][0-9]{0,14}\.log$/;
/** The tail of a refusal for a record the verb cannot judge. */
const UNJUDGED = "only the Patron greenlights what the records cannot judge";

type Dict = Record<string, unknown>;
type Parsed = Exclude<ReturnType<typeof parseVerdictLog>, { error: string }>;
export type AutoGrant = { decision: string; basis: string } | { refusal: string };
/** A kind's reading: its basis, or why the opus is not that kind; a remainder may also be one the records cannot judge. */
type Reading = { basis: string } | { why: string };
type Kind = Reading | { refuse: string };
const show = (v: unknown): string => (v === undefined ? "absent" : JSON.stringify(v));

/** One opus record's front matter, read through the contained read: a mapping, or why not. */
function readRecord(root: string, id: string): { rec: Dict } | { why: string; absent: boolean } {
  const file = readContainedRegularFile(root, `opera/${id}.md`, "opera");
  if ("error" in file) return { why: file.error, absent: file.code === "ENOENT" };
  const split = splitFront(file.bytes.toString("utf8"));
  if (split === undefined) return { why: "it has no front matter", absent: false };
  const doc = parseDocument(split.front);
  if (doc.errors.length > 0) return { why: doc.errors[0]!.message.split("\n")[0] ?? "", absent: false };
  const rec: unknown = doc.toJS();
  return typeof rec === "object" && rec !== null && !Array.isArray(rec) ? { rec: rec as Dict } : { why: "its front matter is not a mapping", absent: false };
}

/** The names under ci/ (none when it is absent or cannot be listed: then no log admits anything). */
function ciNames(root: string): string[] {
  try {
    return readdirSync(join(root, "ci")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return [];
  }
}

/** A log `parseVerdictLog` reads, or why it cannot be read. */
function readLog(root: string, name: string, id: string): Parsed | { why: string } {
  const rel = `ci/${name}`;
  const file = readContainedRegularFile(root, rel, "ci");
  if ("error" in file) return { why: file.error };
  const p = parseVerdictLog(file.bytes.toString("utf8"), id, rel);
  return "error" in p ? { why: p.error.startsWith(`${rel}: `) ? p.error.slice(rel.length + 2) : p.error } : p;
}
const header = (p: Parsed, key: string): string | undefined => (p.headers.get(key)?.length === 1 ? p.headers.get(key)![0] : undefined);

/** D-061 §4: the parent is greenlit or done and two of its spec reviews failed with no passed review between. Every
 *  spec log of the parent must read, with exactly one `# phase: spec`, `# sella:` and `# outcome:`, and the reviewer's
 *  outcome passed or failed; any other log refuses the opus, since it could hide a passed review. */
function remainder(root: string, manifest: Manifest, rec: Dict): Kind {
  const parent = rec["parent"];
  if (parent === undefined) return { why: "it names no parent" };
  if (typeof parent !== "string" || parent === "") return { refuse: `parent: is ${show(parent)}, not an opus id` };
  const read = readRecord(root, parent);
  if ("why" in read) return read.absent ? { why: `its parent ${parent} has no record` } : { refuse: `parent ${parent}'s record cannot be read (${read.why})` };
  const state = read.rec["state"];
  if (typeof state !== "string" || !PARENT_STATES.has(state)) return { why: `its parent ${parent} is ${typeof state === "string" ? state : "stateless"}, not greenlit or done` };
  const reviewer = (manifest as unknown as Dict)["spec_reviewer"];
  if (typeof reviewer !== "string" || reviewer === "") return { why: `bisellium.yml names no spec_reviewer, so no spec review of ${parent} can split it` };
  const spec = (n: string): boolean => n.startsWith(`${parent}-spec-`) && /^[1-9][0-9]{0,14}\.log$/.test(n.slice(parent.length + 6));
  let run: string[] = [];
  let split: string[] | undefined;
  for (const name of ciNames(root).filter(spec)) {
    const p = readLog(root, name, parent);
    if ("why" in p) return { refuse: `parent ${parent}'s spec log ci/${name} cannot be read (${p.why})` };
    const [phase, sella, outcome] = [header(p, "phase"), header(p, "sella"), header(p, "outcome")];
    if (phase !== "spec" || sella === undefined || outcome === undefined) return { refuse: `parent ${parent}'s spec log ci/${name} does not hold exactly one # phase: spec, one # sella: and one # outcome:` };
    if (sella !== reviewer) continue;
    if (outcome !== "passed" && outcome !== "failed") return { refuse: `parent ${parent}'s spec review ci/${name} has outcome ${show(outcome)}, not passed or failed` };
    if (outcome === "passed") run = [];
    else run.push(`ci/${name}`);
    if (run.length === 2 && split === undefined) split = run;
  }
  if (split !== undefined) return { basis: `D-061 §4: the remainder of ${parent} (${state}), whose spec reviews ${split[0]} and ${split[1]} failed` };
  return { why: `its parent ${parent} has no two failed spec reviews by ${reviewer} without a passed review between` };
}

/** D-076 D: a class the title names is an S1 blocker's tag in the failed review or spec logs of two or more other opera. */
function causeFix(root: string, id: string, title: unknown): Reading {
  if (typeof title !== "string") return { why: "its title is not a string" };
  const named = [...new Set([...title.matchAll(CLASS_TOKEN)].map((m) => m[1]!))];
  if (named.length === 0) return { why: "its title names no review class (<area>×<slug>)" };
  const seen = new Map<string, Set<string>>(named.map((c) => [c, new Set<string>()]));
  for (const name of ciNames(root)) {
    const m = REVIEW_LOG.exec(name);
    if (m === null || m[1] === id) continue;
    // the census only admits, so a log it cannot read counts for nothing
    const p = readLog(root, name, m[1]!);
    if ("why" in p || header(p, "outcome") !== "failed") continue;
    for (const f of p.findings) {
      if (!f.blocking || !/\[severity: S1\]/.test(f.text)) continue;
      for (const t of f.text.matchAll(CLASS_TAG)) seen.get(t[1]!)?.add(m[1]!);
    }
  }
  const hit = named.find((c) => seen.get(c)!.size >= 2);
  if (hit === undefined) return { why: `no class its title names (${named.map((c) => `${c}: ${seen.get(c)!.size} ${seen.get(c)!.size === 1 ? "opus" : "opera"}`).join("; ")}) recurs as an S1 blocker in the failed reviews of 2 or more opera` };
  const by = [...seen.get(hit)!].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return { basis: `D-076 D: a cause fix for ${hit}, an S1 class in the failed reviews of ${by.length} opera: ${by.slice(0, 5).join(", ")}${by.length > 5 ? ` and ${by.length - 5} more` : ""}` };
}

/** Whether `<id>` may be greenlit without the Patron, and on what basis; the caller has checked the record is in backlog. */
export function autoGrant(root: string, manifest: Manifest, id: string): AutoGrant {
  const refuse = (why: string): AutoGrant => ({ refusal: `${id}: greenlight --auto refused: ${why}` });
  const decision = (manifest as unknown as Dict)[AUTO_SETTING];
  if (decision === undefined) return refuse(`bisellium.yml names no ${AUTO_SETTING} decision, so only the Patron greenlights ${id}`);
  if (typeof decision !== "string" || decision === "") return refuse(`bisellium.yml#${AUTO_SETTING} must be a decision id`);
  const problem = patronDecisionProblem(root, manifest, decision);
  if (problem !== undefined) return refuse(`bisellium.yml#${AUTO_SETTING}: ${problem}`);
  const read = readRecord(root, id);
  if ("why" in read) return refuse(`opera/${id}.md cannot be read (${read.why})`);
  const rec = read.rec;
  if (Object.hasOwn(rec, "declined")) return refuse(`${id} is declined (declined: ${show(rec["declined"])}); only the Patron reverses a decline`);
  const a = remainder(root, manifest, rec);
  if ("refuse" in a) return refuse(`${id}'s ${a.refuse}; ${UNJUDGED}`);
  if ("basis" in a) return { decision, basis: a.basis };
  const b = causeFix(root, id, rec["title"]);
  if ("basis" in b) return { decision, basis: b.basis };
  return refuse(`${id} is neither a D-061 §4 remainder (${a.why}) nor a D-076 D cause fix (${b.why}), so only the Patron greenlights it`);
}
