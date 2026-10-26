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
 * Behaviour 2: a record the screen cannot read, then the Patron's scope, refuse first, whatever the kind (`recordForm`,
 * `reserved`). W-417: so does a parent that is not another opus's id naming a readable record with a native non-ui kind
 * and a lifecycle state. Reads only: the write is runGreenlight's (writes.ts).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { STATES, type Manifest } from "@bisellium/adapter-native";
import type { NativeOpusKind } from "@bisellium/schema";
import { splitFront } from "./frontmatter.js";
import { patronDecisionProblem } from "./lifecycle.js";
import { isNativeOpusKind, OPUS_ID, readContainedRegularFile, titleProblem } from "./opus-model.js";
import { CLASS_TAG, parseVerdictLog } from "./verdict.js";

/** The manifest key naming the Patron's decision that grants auto greenlights (W-403). */
export const AUTO_SETTING = "auto_greenlit_by";
/** A remainder's parent has passed greenlight: open or done. */
const PARENT_STATES = new Set(["greenlit", "building", "verifying", "review", "done"]);
/** W-417: a parent's state is one of the lifecycle's; backlog and halted are valid, though no remainder's parent. */
const LIFECYCLE_STATES: ReadonlySet<string> = new Set(STATES.map((s) => s.id));
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
  // the one boundary every read of an opus record crosses: a parse or a conversion that throws (an unresolved alias, an
  // alias bomb) and a value JSON cannot hold (a cyclic alias) refuse here, so `show` never meets a value it cannot serialize
  let rec: unknown;
  try {
    const doc = parseDocument(split.front);
    if (doc.errors.length > 0) return { why: doc.errors[0]!.message.split("\n")[0] ?? "", absent: false };
    rec = doc.toJS();
  } catch {
    return { why: "its front matter cannot be converted to a record", absent: false };
  }
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) return { why: "its front matter is not a mapping", absent: false };
  try {
    JSON.stringify(rec);
  } catch {
    return { why: "its front matter holds a value that cannot be serialized", absent: false };
  }
  return { rec: rec as Dict };
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

/** W-403 behaviour 2: the words naming what stays the Patron's, matched in a title caseless as a whole token. */
const RESERVED = ["security", "sandbox", "architecture", "branch protection", "branch-protection", "codeowners", "code-owned"];
/** W-403 behaviour 2: the points an auto greenlight may carry (`value:`); anything over 3, or unsized, is the Patron's. */
const AUTO_VALUES = new Set([1, 2, 3]);
/** The tail of a refusal for a record the screen cannot read. */
const UNSCREENED = "only the Patron greenlights a record the screen cannot read";
const namesWord = (title: string, word: string): boolean => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{M}\\p{N}_-])`, "iu").test(title);

/** W-403 behaviour 2: the record's kind, title and parent in the one form the screen and both kinds read, or why not:
 *  a native kind (`isNativeOpusKind`), a title `titleProblem` accepts, and a parent absent or (W-417) an opus id
 *  (`OPUS_ID`) that is not the opus's own. */
function recordForm(id: string, rec: Dict): { kind: NativeOpusKind; title: string; parent: string | undefined } | { problem: string } {
  const kind = rec["kind"];
  if (!isNativeOpusKind(kind)) return { problem: `${id}'s kind is ${show(kind)}, not a native opus kind; ${UNSCREENED}` };
  const title = rec["title"];
  const bad = titleProblem(title);
  if (bad !== undefined || typeof title !== "string") return { problem: `${id}'s ${bad ?? "title must be a nonblank string"}; ${UNSCREENED}` };
  const parent = rec["parent"];
  if (parent !== undefined && (typeof parent !== "string" || !OPUS_ID.test(parent))) return { problem: `${id}'s parent is ${show(parent)}, not an opus id; ${UNSCREENED}` };
  if (parent === id) return { problem: `${id}'s parent is ${id} itself, not another opus; ${UNSCREENED}` };
  return { kind, title, parent };
}

/** The last path segment of each plain pattern in `.github/CODEOWNERS` at the officina's repository HEAD (globs are
 *  skipped). None only for a confirmed non-repository (git's own "not a git repository") or a HEAD whose tree confirms
 *  no such file; every other git result (no git, dubious ownership, a bad config, an unborn HEAD, a file that is not a
 *  regular blob) is an error, and the screen refuses. */
function codeOwnedNames(root: string): string[] | { error: string } {
  const git = (args: string[]): { code: number; out: string; err: string } => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30_000, env: { ...process.env, LC_ALL: "C" } });
    return { code: r.error === undefined && typeof r.status === "number" ? r.status : -1, out: r.stdout ?? "", err: (r.stderr ?? "").split("\n")[0]?.trim() ?? "" };
  };
  const failed = (what: string, r: { code: number; err: string }): { error: string } => ({ error: `git ${what} failed (${r.code === -1 ? "git could not run" : r.err || `exit ${r.code}`})` });
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return top.code === 128 && top.err.startsWith("fatal: not a git repository ") ? [] : failed("rev-parse --show-toplevel", top);
  const tree = git(["ls-tree", "--full-tree", "-z", "HEAD", "--", ".github/CODEOWNERS"]);
  if (tree.code !== 0) return failed("ls-tree HEAD -- .github/CODEOWNERS", tree);
  if (tree.out === "") return [];
  const blob = /^100(?:644|755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t\.github\/CODEOWNERS\0$/.exec(tree.out);
  if (blob === null) return { error: ".github/CODEOWNERS at HEAD is not a regular file" };
  const shown = git(["cat-file", "blob", blob[1]!]);
  if (shown.code !== 0) return failed("cat-file blob .github/CODEOWNERS", shown);
  return shown.out
    .split(/\r?\n/)
    .map((l) => (l.split("#")[0] ?? "").trim().split(/\s+/)[0] ?? "")
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p !== "" && !/[*?[\]!]/.test(p))
    .map((p) => p.slice(p.lastIndexOf("/") + 1));
}

/** W-403 behaviour 2: why the opus's scope stays the Patron's even when it is a remainder or a cause fix, or undefined. */
function reserved(root: string, id: string, form: { kind: NativeOpusKind; title: string; parent: string | undefined }, value: unknown): string | undefined {
  if (form.kind === "ui") return `${id} is kind ui; a ui opus is the Patron's to greenlight`;
  if (typeof value !== "number" || !AUTO_VALUES.has(value)) return `${id}'s value is ${show(value)}, not 1, 2 or 3 points; anything larger, or unsized, is the Patron's`;
  const security = [...form.title.matchAll(CLASS_TOKEN)].map((m) => m[1]!).find((c) => c.startsWith("security×"));
  if (security !== undefined) return `${id}'s title names the security class ${security}; security is the Patron's`;
  const owned = codeOwnedNames(root);
  if (!Array.isArray(owned)) return `${owned.error}, so the code-owned paths cannot be screened`;
  const word = [...RESERVED, ...owned].find((w) => namesWord(form.title, w));
  if (word !== undefined) return `${id}'s title names "${word}"; security, the sandbox, branch protection, architecture and code-owned paths are the Patron's`;
  // W-417: the parent, before both kinds, so no mistyped parent reaches either: a record that exists and reads, with a
  // native kind that is not ui and a lifecycle state (backlog and halted are valid: no remainder's parent, but a cause fix's)
  if (form.parent !== undefined) {
    const read = readRecord(root, form.parent);
    if ("why" in read) return read.absent ? `${id}'s parent ${form.parent} has no record; ${UNSCREENED}` : `${id}'s parent ${form.parent}'s record cannot be read (${read.why}); ${UNSCREENED}`;
    const kind = read.rec["kind"];
    if (!isNativeOpusKind(kind)) return `${id}'s parent ${form.parent}'s kind is ${show(kind)}, not a native opus kind; ${UNSCREENED}`;
    if (kind === "ui") return `${id}'s parent ${form.parent} is kind ui; a ui opus's remainder is the Patron's to greenlight`;
    const state = read.rec["state"];
    if (typeof state !== "string" || !LIFECYCLE_STATES.has(state)) return `${id}'s parent ${form.parent}'s state is ${show(state)}, not a lifecycle state; ${UNSCREENED}`;
  }
  return undefined;
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
  const form = recordForm(id, rec);
  if ("problem" in form) return refuse(form.problem);
  const scope = reserved(root, id, form, rec["value"]);
  if (scope !== undefined) return refuse(scope);
  const a = remainder(root, manifest, rec);
  if ("refuse" in a) return refuse(`${id}'s ${a.refuse}; ${UNJUDGED}`);
  if ("basis" in a) return { decision, basis: a.basis };
  const b = causeFix(root, id, rec["title"]);
  // W-417: a cause fix may carry a parent the screen passed (reserved); the D-061 §4 cut of W-403's spec round 5 is lifted
  if ("basis" in b) return { decision, basis: b.basis };
  return refuse(`${id} is neither a D-061 §4 remainder (${a.why}) nor a D-076 D cause fix (${b.why}), so only the Patron greenlights it`);
}
