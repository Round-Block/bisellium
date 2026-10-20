import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { instant } from "@bisellium/schema";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { inputDomainRows, ruledCases } from "./brief-admission.js";
import { ensureRealDirectory } from "./ids.js";
import { claimPending, releaseClaim, requireTicket } from "./ticket.js";
import { USAGE } from "./usage.js";
import { openStudio, parseFlags, recordOwnerRefusal, resolveNow, safeItemPath, type WriteOptions, type WriteResult } from "./writes.js";
import { isBuilderClassSeat, readFront, readManifest, resolveSeat, type Manifest } from "@bisellium/adapter-native";
import {
  censorSella,
  contentLines,
  designDigest,
  inspectUiDesignInput,
  readContainedRegularFile,
  substantiveUiTranscript,
  utcTimestampProblem,
  type NativeRecord,
} from "./opus-model.js";

export const VERDICT_USAGE =
  "usage: bisellium verdict <opus> --round <n> --sella <id> --outcome <text> [--phase spec|build|handoff] [--model <id>] [--session <id> [--session-reason <text>]] [--from <path>] [--dispatch-prompt <ci-path>] [--ui-input <ci-path>] [--studio <dir>] [--now <iso>]";

export interface VerdictOptions extends WriteOptions {
  stdin?: Buffer;
}

const GIT_TIMEOUT_MS = 30_000;
const BODY_CAP = 8192;
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function gitRoot(dir: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** The officina's path relative to the git root it sits in ("/"-joined), or undefined when it is in no repository. */
function officinaInRepo(studioRoot: string): { repo: string; rel: string } | undefined {
  const repo = gitRoot(studioRoot);
  if (repo === undefined) return undefined;
  const rel = relative(repo, studioRoot);
  if (isAbsolute(rel) || rel.split(sep)[0] === "..") return undefined;
  return { repo, rel: rel.split(sep).join("/") };
}

function treeAtCapture(studioRoot: string, sourceExcludes: string[]): string {
  const where = officinaInRepo(studioRoot);
  if (where === undefined) return "unknown";
  try {
    const exclusions = [where.rel, ".bisellium", ...sourceExcludes];
    const hash = sourceTreeHash(where.repo, exclusions, "HEAD");
    return `${isDirtyOutside(where.repo, exclusions) ? "dirty" : "tree"}:${hash}`;
  } catch {
    return "unknown";
  }
}

/** The findings shape every non-UI verdict body must have, or the first refusal message. */
function findingsProblem(body: string): string | undefined {
  const parsed = contentLines(body);
  const lines = parsed.lines.filter((line) => line.section === "Findings");
  const numbered = lines.filter((line) => /^[1-9]\d*\. \S/.test(line.text));
  const headings = parsed.headings.filter((heading) => heading.level === 2 && heading.name === "Findings");
  if (headings.length !== 1 || (numbered.length === 0 && !lines.some((line) => line.text === "No findings")))
    return 'verdict body needs exactly one "## Findings" section holding numbered findings or the exact line "No findings"';
  const unchecked = numbered.findIndex((line) => !/\bcheck: \S/.test(line.text));
  if (unchecked !== -1)
    return `finding ${/^\d+/.exec(numbered[unchecked]!.text)![0]} names no check — end it with "check: <rule id | test path | none: <missing check>>"`;
  return undefined;
}

/** W-297: a severity tag (D-076 A), whole: `[severity: S1]` to `[severity: S4]`. */
const SEVERITY_TAG = /\[severity: S([1-4])\]/g;
/** W-297: a design tag (D-086 A), whole: `[design: changes]` or `[design: keeps]`. */
const DESIGN_TAG = /\[design: (changes|keeps)\]/g;

/**
 * W-297: why a spec or build verdict's findings cannot be recorded, one problem per finding and rule, in finding order. A finding
 * is a numbered line of the one Findings section (`contentLines`, as `findingsProblem` reads it), blocking when it opens
 * `blocking`. Each tag is read as a whole token anywhere on the line, at most once. A build finding carries one severity tag
 * (D-085 C); a blocking finding tagged S2, S3 or S4 is refused, never downgraded (D-086 C); a blocking spec finding carries one
 * design tag (D-086 A). ponytail: grammar only; whether the tag is right stays the reviewer's.
 */
export function findingTagProblems(body: string, phase: "spec" | "build"): string[] {
  const problems: string[] = [];
  for (const line of contentLines(body).lines) {
    if (line.section !== "Findings" || !/^[1-9]\d*\. \S/.test(line.text)) continue;
    const n = /^\d+/.exec(line.text)![0];
    const blocking = /^[1-9]\d*\. \**blocking\b/i.test(line.text);
    const severities = [...line.text.matchAll(SEVERITY_TAG)].map((m) => m[1]!);
    const designs = [...line.text.matchAll(DESIGN_TAG)];
    if (severities.length > 1) problems.push(`finding ${n} carries ${severities.length} [severity:] tags; one only`);
    else if (phase === "build" && severities.length === 0) problems.push(`finding ${n} has no [severity: S1|S2|S3|S4] tag; every build finding carries one (D-085 C)`);
    else if (blocking && severities[0] !== undefined && severities[0] !== "1")
      problems.push(`finding ${n} is blocking and tagged [severity: S${severities[0]}]; only an S1 blocks: reissue it as advisory, or fix the tag (D-086 C)`);
    if (phase === "spec" && blocking && designs.length !== 1)
      problems.push(`finding ${n} is a blocking spec finding with ${designs.length === 0 ? "no" : designs.length} [design: changes|keeps] tag${designs.length === 0 ? "" : "s"}; it carries exactly one (D-086 A)`);
  }
  return problems;
}

/** W-297: a finding's one design tag, or undefined when it carries none or several (`findingTagProblems` refuses both). */
export function designOf(text: string): "changes" | "keeps" | undefined {
  const tags = [...text.matchAll(DESIGN_TAG)];
  return tags.length === 1 ? (tags[0]![1] as "changes" | "keeps") : undefined;
}

/** W-297: a class tag (D-070 B), whole: `[class: <area>×<slug>]`, each a lower-case word of letters, digits and hyphens. */
export const CLASS_TAG = /\[class: ([a-z0-9][a-z0-9-]*×[a-z0-9][a-z0-9-]*)\]/g;

export interface Conversion {
  /** The finding's number as written. */
  finding: string;
  reason: string;
}

/** Every header name a verdict log carries: the writer emits no other, and `retro --opus` reads no other. */
export const VERDICT_HEADERS = [
  "opus",
  "phase",
  "round",
  "sella",
  "model",
  "session",
  "session_reason",
  "outcome",
  "submitted_outcome",
  "at",
  "tree",
  "brief",
  "converted",
  "dispatch_prompt",
  "ui_input",
  "design_digest",
  "ticket",
] as const;
const headerLine = (name: (typeof VERDICT_HEADERS)[number], value: string | number): string => `# ${name}: ${value}`;

/** A header value is one line: CR and LF in spec- or error-derived text are written as the two characters `\r` and `\n`. */
const oneLine = (text: string): string => text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");

/**
 * The ways a citation can name the declared brief: a bare `brief`, or any path ending in `briefs/<name>.md`.
 * W-334: the line is a whole token of 1 to 15 digits, no word character after it: `brief:2x` cites no line.
 */
const CITATION = /(?<![\w./-])(brief|\/?(?:[\w.-]+\/)*briefs\/[\w.-]+\.md):([1-9]\d{0,14})(?!\w)/g;

/**
 * W-126: a blocking finding keeps its severity only when it cites a line of the opus's declared brief; the rest are
 * recorded as advisory. Grammar only — it never judges, promotes, adds or drops a finding, nor edits the body.
 */
export function reconcileFindings(
  body: string,
  outcome: string,
  brief: { spec: string; repoSpec?: string; text: string } | { error: string },
  /** W-246: a spec review that submits `failed` with no blocker standing (none cited, or none at all) passes too. */
  advisoryPasses = false,
): { converted: Conversion[]; outcome: string; submittedOutcome?: string } {
  const converted: Conversion[] = [];
  const blocking = contentLines(body).lines.filter(
    (line) => line.section === "Findings" && /^[1-9]\d*\. \S/.test(line.text) && /^[1-9]\d*\. \**blocking\b/i.test(line.text),
  );
  const text = "error" in brief ? "" : brief.text;
  const lines = text.split(/\r?\n/);
  if (text.endsWith("\n")) lines.pop();
  for (const line of blocking) {
    const finding = /^\d+/.exec(line.text)![0];
    const citations = [...line.text.matchAll(CITATION)].map((m) => ({ path: m[1]!, n: Number(m[2]) }));
    // The first reason that applies: no brief read, no citation, then the first citation's own defect.
    let reason: string | undefined;
    if ("error" in brief) reason = `the opus declares no readable brief: ${oneLine(brief.error)}`;
    else {
      const valid = (c: { path: string; n: number }): boolean =>
        (c.path === "brief" || c.path === brief.spec || c.path === brief.repoSpec) && c.n <= lines.length && (lines[c.n - 1] ?? "").trim() !== "";
      const first = citations[0];
      if (first === undefined) reason = `cites no line of ${oneLine(brief.spec)}`;
      else if (!citations.some(valid)) {
        if (first.path !== "brief" && first.path !== brief.spec && first.path !== brief.repoSpec)
          reason = `cites ${first.path}, not the declared brief ${oneLine(brief.spec)}`;
        else if (first.n > lines.length) reason = `${oneLine(brief.spec)} has ${lines.length} lines, no line ${first.n}`;
        else reason = `${oneLine(brief.spec)}:${first.n} is blank`;
      }
    }
    if (reason !== undefined) converted.push({ finding, reason });
  }
  // A failure stands exactly when the censor cites a brief line for a blocker: reconcile only when every submitted blocker converted.
  if ((advisoryPasses || blocking.length > 0) && converted.length === blocking.length && /^(?:verdict:\s*)?fail(?:ed)?\b/i.test(outcome.trim()))
    return { converted, outcome: "passed", submittedOutcome: outcome };
  return { converted, outcome };
}

type Refusal = { error: string };
export const LOG_MAX_BYTES = 4_000_000;
// the whole raw line: no carriage return and no comment marker anywhere in it
const FINDING_LINE = /^[1-9]\d*\. \**(blocking|advisory)\b(?![^]*(?:\r|<!--|-->))/i;
// a header line is one of the names the verdict writer emits, its value raw
const HEADER_LINE = new RegExp(`^# (${VERDICT_HEADERS.join("|")}): (.*)$`);

export interface RecordedFinding {
  log: string;
  n: number;
  /** the finding line after its number, whole */
  text: string;
  blocking: boolean;
  /** W-215: ruled withdrawn in the log's own `## Ruling`; it no longer stands */
  withdrawn?: true;
}

/** W-215: one `## Earlier findings` line: the reviewer's account of a standing blocker of its previous round. */
export interface EarlierFinding {
  log: string;
  n: number;
  status: "closed" | "open" | "reversed";
  text: string;
}
/** W-215: one `## Rebuttal` line: the author's evidence against finding `n` of this log. */
export interface Rebuttal {
  n: number;
  text: string;
}
type Parsed = { headers: Map<string, string[]>; findings: RecordedFinding[]; earlier: EarlierFinding[]; rebuttal: Rebuttal[] };

// a CITE: a `path:line` token (`facts.txt:<line>` names a command's output), ended by a non-word character
const CITE = /(?<![\w./-])[\w./-]+:[1-9]\d*(?!\w)/;
const SEPARATOR = "(?:—|-)";

/**
 * W-215: the body sections after `## Findings` that carry a dispute and the earlier-findings account, read only in a log
 * whose header block carries `# session:` (`parseVerdictLog` calls this for no other). Each exact heading
 * appears at most once and runs to the next `## ` line; blank lines are skipped, every other line is in the grammar or the
 * log is out of domain. A withdrawn finding no longer stands. Pure; the findings are changed in place.
 */
function readExchange(body: string[], id: string, rel: string, findings: RecordedFinding[]): { earlier: EarlierFinding[]; rebuttal: Rebuttal[] } | Refusal {
  const sections = new Map<string, string[]>();
  for (let i = 0; i < body.length; i++) {
    const name = ["Rebuttal", "Ruling", "Earlier findings"].find((h) => body[i] === `## ${h}`);
    if (name === undefined) continue;
    if (sections.has(name)) return { error: `${rel}: more than one "## ${name}" heading` };
    const end = body.findIndex((l, j) => j > i && l.startsWith("## "));
    sections.set(name, body.slice(i + 1, end === -1 ? undefined : end).filter((l) => l !== ""));
  }
  const bad = (name: string, line: string, why: string): Refusal => ({ error: `${rel}: line under "## ${name}" out of domain (${why}): ${line.slice(0, 60)}` });
  const known = (n: number): boolean => findings.some((f) => f.n === n);

  const rebuttal: Rebuttal[] = [];
  for (const line of sections.get("Rebuttal") ?? []) {
    const m = /^([1-9]\d{0,14})\. (.+)$/.exec(line);
    if (m === null || !CITE.test(m[2]!)) return bad("Rebuttal", line, 'want "<k>. <evidence holding a file:line>"');
    if (!known(Number(m[1])) || rebuttal.some((r) => r.n === Number(m[1]))) return bad("Rebuttal", line, "<k> is not a finding of this log, or is rebutted twice");
    rebuttal.push({ n: Number(m[1]), text: m[2]! });
  }
  const ruled = new Map<number, "withdrawn" | "upheld">();
  for (const line of sections.get("Ruling") ?? []) {
    if (/^[1-9]\d*\. open\b/.test(line)) return { error: `${rel}: ruling is open (${line.slice(0, 60)}): a dispute the reviewer cannot rule goes to the Patron first; record the Patron's answer as the ruling` };
    const m = new RegExp(`^([1-9]\\d{0,14})\\. (withdrawn|upheld) ${SEPARATOR} (.+)$`).exec(line);
    if (m === null || (m[2] === "upheld" && !CITE.test(m[3]!))) return bad("Ruling", line, 'want "<k>. withdrawn — <why>" or "<k>. upheld — <why holding a file:line>"');
    if (!known(Number(m[1])) || ruled.has(Number(m[1]))) return bad("Ruling", line, "<k> is not a finding of this log, or is ruled twice");
    ruled.set(Number(m[1]), m[2] as "withdrawn" | "upheld");
  }
  const disputed = rebuttal.map((r) => r.n).sort((a, b) => a - b).join(",");
  if (disputed !== [...ruled.keys()].sort((a, b) => a - b).join(",")) return { error: `${rel}: "## Rebuttal" and "## Ruling" must come together and rule the same findings (rebutted: ${disputed || "none"})` };
  for (const f of findings) if (ruled.get(f.n) === "withdrawn") (f.blocking = false), (f.withdrawn = true);

  const earlier: EarlierFinding[] = [];
  const line = new RegExp(`^- (ci/${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(?:spec|review|handoff)-[1-9]\\d*\\.log) #([1-9]\\d{0,14}): (closed|open|reversed) ${SEPARATOR} (.+)$`);
  for (const text of sections.get("Earlier findings") ?? []) {
    const m = line.exec(text);
    if (m === null || (m[3] === "reversed" && !CITE.test(m[4]!))) return bad("Earlier findings", text, 'want "- ci/<opus>-<kind>-<m>.log #<k>: closed|open|reversed — <evidence>", a reversal holding a file:line');
    if (earlier.some((e) => e.log === m[1] && e.n === Number(m[2]))) return bad("Earlier findings", text, "this finding is accounted for twice");
    earlier.push({ log: m[1]!, n: Number(m[2]), status: m[3] as EarlierFinding["status"], text: m[4]! });
  }
  return { earlier, rebuttal };
}

/**
 * One recorded log's text, judged RAW: no line is stripped, trimmed or interpreted before it is judged. The header block
 * is the lines before the first empty line, each exactly `# key: value`. In the body the one `## Findings` section
 * (ends at the next `## ` line) holds empty lines, the exact line `No findings`, or lines of the finding grammar,
 * and nothing else: a fence, comment, heading, indented or otherwise dressed line is out of domain and the whole
 * log is unreadable. This is the only parser of a verdict log, in the retro and in `next`'s spec-review gate (W-162).
 */
export function parseVerdictLog(text: string, id: string, rel: string): Parsed | Refusal {
  const lines = text.split("\n");
  const split = lines.indexOf("");
  if (split === -1) return { error: `${rel}: no blank line ends the header block` };
  const headers = new Map<string, string[]>();
  for (const line of lines.slice(0, split)) {
    const m = HEADER_LINE.exec(line);
    if (!m) return { error: `${rel}: header line out of domain (want "# <a verdict header>: value"): ${line.slice(0, 60)}` };
    headers.set(m[1]!, [...(headers.get(m[1]!) ?? []), m[2]!]);
  }
  const body = lines.slice(split + 1);
  const stray = body.find((l) => /^# [a-z_]+: /.test(l));
  if (stray !== undefined) return { error: `${rel}: a header line outside the header block: ${stray.slice(0, 60)}` };
  if (headers.get("opus")?.length !== 1 || headers.get("opus")![0] !== id) return { error: `${rel}: the header "# opus:" must appear once and equal ${id}` };
  const at = body.reduce<number[]>((n, l, i) => (l === "## Findings" ? [...n, i] : n), []);
  if (at.length !== 1) return { error: `${rel}: expected exactly one "## Findings" heading, found ${at.length}` };
  const rest = body.slice(at[0]! + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const section = (end === -1 ? rest : rest.slice(0, end)).filter((l) => l !== "");
  if (section.length === 0) return { error: `${rel}: "## Findings" holds neither "No findings" nor numbered findings` };
  const findings: RecordedFinding[] = [];
  for (const line of section.length === 1 && section[0] === "No findings" ? [] : section) {
    if (!FINDING_LINE.test(line)) return { error: `${rel}: line under "## Findings" out of domain (want "<n>. blocking|advisory …", or "No findings" alone): ${line.slice(0, 60)}` };
    const n = Number(/^\d+/.exec(line)![0]);
    if (findings.some((f) => f.n === n)) return { error: `${rel}: finding ${n} is numbered twice` };
    const text = line.replace(/^\d+\. /, "");
    findings.push({ log: rel, n, text, blocking: /^\**blocking\b/i.test(text) });
  }
  const converted = headers.get("converted");
  // ponytail: a "No findings" body has nothing to convert; it was never judged against "# converted:" and still is not
  if (converted !== undefined && findings.length > 0) {
    if (converted.length !== 1) return { error: `${rel}: more than one "# converted:" header` };
    // "<n> (<reason>)", joined by "; ": every piece closed, every n a blocking finding of this log
    const pieces = converted[0]!.split(/; (?=[1-9]\d* \()/);
    for (const piece of pieces) {
      const m = /^([1-9]\d{0,14}) \((.+)\)$/.exec(piece);
      const f = m ? findings.find((x) => x.n === Number(m[1])) : undefined;
      if (!m || !f?.blocking) return { error: `${rel}: "# converted:" is not a list of "<n> (<reason>)" naming blocking findings of this log: ${piece.slice(0, 60)}` };
      f.blocking = false;
    }
  }
  // a log without `# session:` predates the exchange: its headings are prose, read as on master
  const exchange = headers.has("session") ? readExchange(body, id, rel, findings) : { earlier: [], rebuttal: [] };
  return "error" in exchange ? exchange : { headers, findings, ...exchange };
}

export type SequencePhase = "spec" | "build" | "handoff";
const LOG_KIND: Record<SequencePhase, string> = { spec: "spec", build: "review", handoff: "handoff" };
/** One log's header block: the lines before the first empty line, the first occurrence of each key. */
function headerBlock(text: string): Map<string, string> {
  const block = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line === "") break;
    const m = /^# ([a-z_]+): (.*)$/.exec(line);
    if (m !== null && !block.has(m[1]!)) block.set(m[1]!, m[2]!);
  }
  return block;
}

export interface SequenceRound {
  round: number;
  /** ci/<opus>-<kind>-<round>.log */
  log: string;
  session?: string;
  /** present when the log carries a session */
  parsed?: Parsed;
}

/**
 * W-215: the last round of a review sequence (one opus, one phase, one sella): the highest-round
 * `ci/<opus>-<spec|review|handoff>-<m>.log` whose header block names `sella`. A sessioned one is parsed
 * strictly. An unreadable entry, or a sessioned one that does not parse, is an error.
 */
export function readSequence(root: string, opus: string, phase: SequencePhase, sella: string): { last: SequenceRound | undefined } | Refusal {
  const contained = safeItemPath(join(root, "ci"), opus);
  if (typeof contained !== "string") return contained;
  let names: string[];
  try {
    names = readdirSync(join(root, "ci"));
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { last: undefined } : { error: `ci/: ${(e as Error).message.split("\n")[0]}` };
  }
  const prefix = `${opus}-${LOG_KIND[phase]}-`;
  let last: { round: number; rel: string; text: string; session: string | undefined } | undefined;
  for (const name of names) {
    const m = name.startsWith(prefix) ? /^([1-9]\d{0,14})\.log$/.exec(name.slice(prefix.length)) : null;
    if (m === null) continue;
    const rel = `ci/${name}`;
    const file = readContainedRegularFile(root, rel, "ci", LOG_MAX_BYTES);
    if ("error" in file) return { error: `${rel}: ${file.error}` };
    const text = file.bytes.toString("utf8");
    const header = headerBlock(text);
    if (header.get("sella") !== sella || (last !== undefined && Number(m[1]) < last.round)) continue;
    last = { round: Number(m[1]), rel, text, session: header.get("session") };
  }
  if (last === undefined) return { last: undefined };
  if (last.session === undefined) return { last: { round: last.round, log: last.rel } };
  const parsed = parseVerdictLog(last.text, opus, last.rel);
  return "error" in parsed ? parsed : { last: { round: last.round, log: last.rel, session: last.session, parsed } };
}

function hasHeaderBreak(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}

/**
 * W-306: the CLI's verbs, read from its usage text so the list has one source. Every nonblank line names exactly one command:
 * one `bisellium <token>`, the token a whole `[a-z][a-z-]*` word; anything else is the error, never a partial list.
 */
export function usageVerbs(usage: string): { verbs: Set<string> } | { error: string } {
  const verbs = new Set<string>();
  const lines = usage.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "") continue;
    const named = [...lines[i]!.matchAll(/(?<![\w./-])bisellium (\S+)/g)].map((m) => m[1]!);
    if (named.length !== 1 || !/^[a-z][a-z-]*$/.test(named[0]!)) return { error: `usage line ${i + 1} does not name exactly one command "bisellium <[a-z][a-z-]*>"` };
    verbs.add(named[0]!);
  }
  return { verbs };
}
const USAGE_VERBS = usageVerbs(USAGE);
const LEDGER_MAX_BYTES = 262_144;
/** W-306: the end of a whole token: not followed by a word, `/`, `~` or `-` character, nor by `.` and a token character */
const TOKEN_END = String.raw`(?![\w/~-]|\.[\w./~-])`;
/** a whole citation token `<name>:<positive integer>`: `NX:20x`, `brief:3.5`, `brief:3-5` and `NX:20/notes` are not citations */
const CITATION_TOKEN = new RegExp(String.raw`(?<![\w./~-])([\w./~-]+):([1-9]\d{0,14})` + TOKEN_END, "g");
/** a whole word by the same boundary: `next.ts` and `src/next` do not name `next`, `scoped-ish` is no status */
const wholeWord = (word: string): RegExp => new RegExp(String.raw`(?<![\w./~-])${word}` + TOKEN_END);
const STATUS = wholeWord("(?:holds|scoped)");
const SCOPED = wholeWord("scoped");

/** W-306: the design collegium's magister: no design row is `architect`; exactly one row needs a nonblank string magister. */
function readDesignMagister(manifest: unknown): { magister: string } | { error: string } {
  const collegia = typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>)["collegia"] : undefined;
  if (!Array.isArray(collegia)) return { error: "bisellium.yml#collegia must be a list" };
  const rows = collegia.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && (r as Record<string, unknown>)["id"] === "design");
  if (rows.length === 0) return { magister: "architect" };
  if (rows.length > 1) return { error: `bisellium.yml#collegia declares the design collegium ${rows.length} times; exactly one row names the magister` };
  const magister = rows[0]!["magister"];
  return typeof magister === "string" && magister.trim() !== "" ? { magister } : { error: "bisellium.yml#collegia: the design row's magister must be a nonblank string" };
}

/**
 * W-306: why an architect's spec signature cannot be recorded. A brief line that names a CLI verb as a whole inline-code span
 * (`ready`, `next`) is a promise line; the signature's raw lines before its one level-2 Findings heading (as `contentLines` finds
 * it) then cite one ledger file, and for each promise line and each verb on it some ledger line holds the whole tokens
 * `brief:<n>` and `<file>:<line>`, the verb and holds or scoped. W-319: so does each Input domain row (a reader), with no verb.
 * W-322: each row also holds a pin (`ruledCases`), or says unpinned and its ledger line is scoped; a row ruling any text
 * or any string lists the forms it recognises, and each grammar line it cites holds a pin. W-336: so does a row whose
 * Valid domain names a path, a command line or an environment value, and its line or a cited line names each hostile form.
 * ponytail: a textual coverage check; whether the cited line really guarantees the promise stays the spec review's.
 */
function promiseLedgerProblems(brief: string, transcript: string, briefRel: string): string[] {
  if ("error" in USAGE_VERBS) return [USAGE_VERBS.error];
  const callers = new Map<number, string[]>();
  brief.split(/\r?\n/).forEach((line, i) => {
    const named = [...new Set([...line.matchAll(/`([^`\r\n]+)`/g)].map((m) => m[1]!.trim()).filter((t) => USAGE_VERBS.verbs.has(t)))];
    if (named.length > 0) callers.set(i + 1, named);
  });
  const rows = inputDomainRows(brief);
  if (callers.size === 0 && rows.length === 0) return [];
  const heading = contentLines(transcript).headings.find((h) => h.level === 2 && h.name === "Findings");
  if (heading === undefined) return ['the signature has no level-2 "Findings" heading'];
  const cites = transcript.split(/\r?\n/).slice(0, heading.line).map((l) => l.trim()).filter((l) => l.startsWith("Promise ledger:"));
  if (cites.length === 0) {
    const why = [
      ...(callers.size > 0 ? [`names a CLI verb in code on lines ${[...callers.keys()].join(", ")}`] : []),
      ...(rows.length > 0 ? [`has Input domain rows on lines ${rows.join(", ")}`] : []),
    ].join(" and ");
    return [`${briefRel} ${why}; cite the promise ledger on one line above "## Findings": "Promise ledger: <absolute path>"`];
  }
  if (cites.length > 1) return [`${cites.length} "Promise ledger:" lines above "## Findings"; one only`];
  const named = cites[0]!.slice("Promise ledger:".length).trim();
  let path: string;
  try {
    path = named.startsWith("~/") ? join(homedir(), named.slice(2)) : named;
  } catch {
    path = ""; // ponytail: os.homedir() throws only with no HOME and no passwd entry; the path is then not absolute
  }
  if (!isAbsolute(path)) return [`"${named}" is not an absolute or ~/ path`];
  let ledger: string[];
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > LEDGER_MAX_BYTES) throw new Error("not a regular file under the cap");
    ledger = readFileSync(path, "utf8").split(/\r?\n/);
  } catch {
    return [`${named} is not a readable regular file`];
  }
  // each ledger line: the brief lines it cites and whether it counts (a non-brief citation and a status)
  const entries = ledger.map((text) => {
    const tokens = [...text.matchAll(CITATION_TOKEN)].map((m) => ({ name: m[1]!, n: Number(m[2]) }));
    const briefs = new Set(tokens.filter((t) => t.name === "brief").map((t) => t.n));
    const counts = STATUS.test(text) && tokens.some((t) => t.name !== "brief" && /[A-Za-z]/.test(t.name));
    return { text, briefs, counts };
  });
  const problems: string[] = [];
  for (const [n, verbs] of callers) {
    const covering = entries.filter((e) => e.counts && e.briefs.has(n));
    for (const v of verbs)
      if (!covering.some((e) => wholeWord(v).test(e.text)))
        problems.push(`brief:${n} names \`${v}\`, and no ledger line cites brief:${n} with ${v}, a <file>:<line> and holds or scoped`);
  }
  for (const n of rows)
    if (!entries.some((e) => e.counts && e.briefs.has(n)))
      problems.push(`brief:${n} is an Input domain row, and no ledger line cites brief:${n} with a <file>:<line> and holds or scoped`);
  const { cases, formless, pathGaps } = ruledCases(brief);
  const PIN_FORM = 'as pinned by `<row>` "<assertion>"';
  const rowsSeen = new Set<number>();
  for (const c of cases) {
    // a row's own case comes first; every later case with that row is a line its forms clause cites, even its own
    const grammar = rowsSeen.has(c.row);
    rowsSeen.add(c.row);
    if (c.pins.length > 0) continue;
    const covering = entries.filter((e) => e.counts && e.briefs.has(c.line));
    if (grammar)
      problems.push(`brief:${c.line} is a grammar line brief:${c.row} recognises, with no pin: name its test row and assertion ${PIN_FORM}`);
    else if (!c.unpinned)
      problems.push(`brief:${c.line} is an Input domain row with no pin: name the test row and assertion that exercise it ${PIN_FORM}, or say unpinned (a stated limit, scoped in the ledger)`);
    else if (covering.length > 0 && !covering.some((e) => SCOPED.test(e.text)))
      problems.push(`brief:${c.line} says unpinned, and no ledger line cites brief:${c.line} as scoped`);
  }
  for (const n of formless)
    problems.push(`brief:${n} rules any text or any string and lists no forms: say "recognises", then the forms (code spans, or brief:<line> citations of the lines that list them), then "every other form" and "limit"`);
  const PATH = "rules a path, a command line or an environment value";
  for (const g of pathGaps) {
    if (g.formless)
      problems.push(`brief:${g.row} ${PATH} and lists no forms: say "recognises", then the forms (code spans, or brief:<line> citations of the lines that list them), then "every other form" and "limit"`);
    if (g.missing.length > 0)
      problems.push(`brief:${g.row} ${PATH} and does not name ${g.missing.join(", ")}: name each by the word space, quote, non-ASCII or symlink, on the row or on a line its forms clause cites, as a recognised form with its pin or as a stated limit`);
  }
  return problems;
}

/** W-215: why a sessioned verdict cannot be recorded, or undefined. `text` is the whole log to be written. */
function sessionedProblem(text: string, id: string, rel: string, outcome: string, recorded: string, previous: Parsed | undefined, previousLog: string | undefined): string | undefined {
  if (outcome !== "passed" && outcome !== "failed") return "a sessioned verdict's outcome is exactly passed or failed";
  const parsed = parseVerdictLog(text, id, rel);
  if ("error" in parsed) return parsed.error;
  const standing = parsed.findings.some((f) => f.blocking);
  if (recorded === "passed" && standing) return `${rel}: outcome passed beside a standing blocking finding`;
  if (recorded === "failed" && !standing) return `${rel}: outcome failed with no standing blocking finding (a withdrawn or converted one does not stand)`;
  if (recorded === "passed" && parsed.earlier.some((e) => e.status === "open")) return `${rel}: an open earlier finding stands, so the round cannot pass`;
  if (previous !== undefined && previousLog !== undefined) {
    const want = previous.findings.filter((f) => f.blocking).map((f) => `${previousLog} #${f.n}`);
    const have = parsed.earlier.map((e) => `${e.log} #${e.n}`);
    const missing = want.find((w) => !have.includes(w));
    if (missing !== undefined) return `${rel}: "## Earlier findings" must account for ${missing}, a standing blocker of the previous round`;
    const extra = have.find((h) => !want.includes(h));
    if (extra !== undefined) return `${rel}: "## Earlier findings" names ${extra}, which is not a standing blocker of the previous round`;
  }
  return undefined;
}

/** Records a review transcript under the officina without changing any gate. */
export function runVerdict(args: string[], opts: VerdictOptions = {}): WriteResult {
  const parsed = parseFlags(args, {
    valued: ["--round", "--sella", "--outcome", "--phase", "--model", "--session", "--session-reason", "--from", "--dispatch-prompt", "--ui-input", "--studio", "--now"],
  });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${VERDICT_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (opusId === undefined || positionals.length !== 1) {
    console.error(VERDICT_USAGE);
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;
  const opusPath = safeItemPath(join(root, "opera"), opusId);
  if (typeof opusPath !== "string" || !existsSync(opusPath)) {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }
  const containedOpus = readContainedRegularFile(root, `opera/${opusId}.md`, "opera");
  if ("error" in containedOpus) {
    console.error(`${opusId}: opus.reference: ${containedOpus.error}`);
    return { exitCode: 2 };
  }

  // D-021 is deliberately the first validation after record existence: a
  // caller on the wrong ref learns who owns the record before learning
  // anything about deeper verdict arguments.
  const ownership = recordOwnerRefusal(root, opusId);
  if (ownership !== undefined) {
    console.error(ownership);
    return { exitCode: 2 };
  }

  const roundRaw = values.get("--round");
  // W-334: at most 15 digits, the grammar every round reader holds, so a double reads it exactly
  if (roundRaw === undefined || !/^[1-9]\d{0,14}$/.test(roundRaw)) {
    console.error(`--round must be a positive integer of at most 15 digits\n${VERDICT_USAGE}`);
    return { exitCode: 2 };
  }
  const round = Number(roundRaw);

  const phase = values.get("--phase") ?? "build";
  if (phase !== "spec" && phase !== "build" && phase !== "handoff") {
    console.error(`--phase must be spec, build or handoff\n${VERDICT_USAGE}`);
    return { exitCode: 2 };
  }

  const outcome = values.get("--outcome");
  if (outcome === undefined || outcome.trim() === "") {
    console.error(`--outcome is required and must be non-blank\n${VERDICT_USAGE}`);
    return { exitCode: 2 };
  }
  const sella = values.get("--sella");
  if (sella === undefined || sella.trim() === "") {
    console.error(`--sella is required and must be non-blank\n${VERDICT_USAGE}`);
    return { exitCode: 2 };
  }
  const model = values.get("--model");
  if (model !== undefined && model.trim() === "") {
    console.error("--model must be non-blank when provided");
    return { exitCode: 2 };
  }
  const session = values.get("--session");
  if (session !== undefined && !SESSION_ID.test(session)) {
    console.error("--session must be one token: letters, digits and . _ : - only, at most 200 characters");
    return { exitCode: 2 };
  }
  const sessionReason = values.get("--session-reason");
  if (sessionReason !== undefined && (sessionReason.trim() === "" || hasHeaderBreak(sessionReason))) {
    console.error("--session-reason must be non-blank and one line");
    return { exitCode: 2 };
  }
  if (sessionReason !== undefined && session === undefined) {
    console.error("--session-reason is valid only beside --session");
    return { exitCode: 2 };
  }
  for (const [flag, value] of [
    ["<opus>", opusId],
    ["--outcome", outcome],
    ["--sella", sella],
    ["--model", model],
  ] as const) {
    if (value !== undefined && hasHeaderBreak(value)) {
      console.error(`${flag} must be a single-line header value`);
      return { exitCode: 2 };
    }
  }

  const nowRaw = values.get("--now");
  const now = nowRaw !== undefined && utcTimestampProblem(nowRaw) ? undefined : resolveNow(nowRaw, opts.now);
  if (now === undefined) {
    console.error("--now must match the exact UTC timestamp profile");
    return { exitCode: 2 };
  }

  let transcript: Buffer;
  const from = values.get("--from");
  if (from !== undefined) {
    const sourcePath = resolve(from);
    try {
      if (!statSync(sourcePath).isFile()) {
        console.error(`--from "${from}" is not a regular file`);
        return { exitCode: 2 };
      }
      transcript = readFileSync(sourcePath);
    } catch (e) {
      console.error(`--from "${from}" could not be read: ${(e as Error).message}`);
      return { exitCode: 2 };
    }
  } else {
    try {
      transcript = opts.stdin ?? readFileSync(0);
    } catch (e) {
      console.error(`stdin could not be read: ${(e as Error).message}`);
      return { exitCode: 2 };
    }
    if (transcript.length === 0) {
      console.error("verdict: --from is absent and stdin is empty");
      return { exitCode: 2 };
    }
  }

  const record = readFront<NativeRecord>(opusPath).data;
  const isUi = record.kind === "ui";
  const dispatchPrompt = values.get("--dispatch-prompt");
  const uiInput = values.get("--ui-input");
  if (!isUi && (dispatchPrompt !== undefined || uiInput !== undefined)) {
    console.error("--dispatch-prompt and --ui-input are UI-only flags");
    return { exitCode: 2 };
  }
  if (phase === "spec" && uiInput !== undefined) {
    console.error("--ui-input is valid only for a build-phase UI verdict");
    return { exitCode: 2 };
  }
  if (phase === "build" && dispatchPrompt !== undefined) {
    console.error("--dispatch-prompt is valid only for a spec-phase UI verdict");
    return { exitCode: 2 };
  }
  if (phase === "handoff" && (dispatchPrompt !== undefined || uiInput !== undefined)) {
    console.error("--dispatch-prompt and --ui-input are not valid for a handoff verdict");
    return { exitCode: 2 };
  }

  if (transcript.length > BODY_CAP) {
    console.error(`verdict body is ${transcript.length} bytes; the cap is ${BODY_CAP} — record findings, not a transcript`);
    return { exitCode: 2 };
  }

  let uiDigest: string | undefined;
  let promptHeader: string | undefined;
  let inputHeader: string | undefined;
  if (isUi && phase === "spec") {
    if (sella !== "ui-lead") {
      console.error("UI spec input must be attributed to ui-lead");
      return { exitCode: 2 };
    }
    if (!/^(passed|failed|revise)$/.test(outcome)) {
      console.error("UI spec outcome must be exactly passed, failed or revise");
      return { exitCode: 2 };
    }
    if (!dispatchPrompt) {
      console.error("UI spec input requires --dispatch-prompt <ci-relative-path>");
      return { exitCode: 2 };
    }
    const prompt = readContainedRegularFile(root, dispatchPrompt, "ci");
    if ("error" in prompt) {
      console.error(`--dispatch-prompt is unsafe or unreadable: ${prompt.error}`);
      return { exitCode: 2 };
    }
    if (typeof record.title !== "string" || typeof record.spec !== "string") {
      console.error("UI spec input requires a string title and current spec pointer");
      return { exitCode: 2 };
    }
    const brief = readContainedRegularFile(root, record.spec, "briefs");
    if ("error" in brief) {
      console.error(`current brief is unsafe or unreadable: ${brief.error}`);
      return { exitCode: 2 };
    }
    uiDigest = designDigest(record.title, brief.bytes);
    const contentProblems = substantiveUiTranscript(transcript.toString("utf8"), outcome, prompt.bytes.toString("utf8"));
    if (contentProblems.length) {
      console.error(contentProblems.map((problem) => `opus.ui.design: ${problem}`).join("\n"));
      return { exitCode: 2 };
    }
    promptHeader = prompt.relative;
  }
  if (!isUi || phase === "handoff") {
    const problem = findingsProblem(transcript.toString("utf8"));
    if (problem !== undefined) {
      console.error(problem);
      return { exitCode: 2 };
    }
  }
  // W-297: a spec or build finding carries the tags D-085 C and D-086 require, before anything is written or claimed
  if (!isUi && phase !== "handoff") {
    const problems = findingTagProblems(transcript.toString("utf8"), phase);
    if (problems.length > 0) {
      console.error(problems.map((p) => `${opusId}: finding tags: ${p}`).join("\n"));
      return { exitCode: 2 };
    }
  }
  if (isUi && phase === "build") {
    const censor = censorSella(manifest);
    if (!censor) {
      console.error("UI build verdict cannot identify the manifest QA magister censor");
      return { exitCode: 2 };
    }
    if (sella !== censor) {
      console.error(`UI build verdict must be attributed to the censor ${censor}`);
      return { exitCode: 2 };
    }
    if (!uiInput) {
      console.error("UI build verdict requires --ui-input <ci-relative-path>");
      return { exitCode: 2 };
    }
    const inspected = inspectUiDesignInput(root, record);
    if (!inspected.digest || !inspected.input || inspected.problems.length) {
      console.error(inspected.problems.map((problem) => `opus.ui.design: ${problem}`).join("\n"));
      return { exitCode: 2 };
    }
    if (uiInput !== inspected.input.relative) {
      console.error(`--ui-input must cite the current authoritative round ${inspected.input.relative}`);
      return { exitCode: 2 };
    }
    const disposition = /(?:^|\n)## UI input disposition\s*\r?\n([\s\S]*?)(?=\r?\n#{1,2}\s|$)/.exec(transcript.toString("utf8"));
    if (!disposition || !disposition[1]!.split(/\r?\n/).some((line) => line.trim() !== "" && !/^\s*<!--/.test(line))) {
      console.error("UI build verdict requires a nonblank ## UI input disposition section");
      return { exitCode: 2 };
    }
    uiDigest = inspected.digest;
    inputHeader = inspected.input.relative;
  }

  let briefHeader: string | undefined;
  let convertedHeader: string | undefined;
  let conversions: Conversion[] = [];
  let recorded = outcome;
  let submitted: string | undefined;
  if (!isUi && phase === "build") {
    const read = typeof record.spec === "string" ? readContainedRegularFile(root, record.spec, "briefs") : { error: "no spec" };
    let brief: Parameters<typeof reconcileFindings>[2] = { error: "no spec" };
    if ("error" in read) brief = { error: read.error };
    else if (typeof record.spec === "string") {
      const where = officinaInRepo(root);
      brief = { spec: record.spec, ...(where === undefined ? {} : { repoSpec: where.rel === "" ? record.spec : `${where.rel}/${record.spec}` }), text: read.bytes.toString("utf8") };
      briefHeader = `${oneLine(record.spec)} blob:${createHash("sha1").update(`blob ${read.bytes.length}\0`).update(read.bytes).digest("hex")}`;
    }
    const reconciled = reconcileFindings(transcript.toString("utf8"), outcome, brief);
    conversions = reconciled.converted;
    recorded = reconciled.outcome;
    submitted = reconciled.submittedOutcome;
    if (conversions.length > 0) convertedHeader = conversions.map((c) => `${c.finding} (${c.reason})`).join("; ");
  }

  if (!isUi && phase === "spec") {
    // W-162: a spec verdict pins the brief it was recorded against, so an edit after it voids it
    // the id is already contained (safeItemPath above): the brief shares the record's file name
    const briefRel = join("briefs", basename(opusPath));
    const read = readContainedRegularFile(root, briefRel, "briefs");
    if ("error" in read) {
      console.error(`${opusId}: the brief ${briefRel} is unreadable, so a spec verdict cannot pin it: ${read.error}`);
      return { exitCode: 2 };
    }
    // W-306: the design magister's signature cites a promise ledger covering every caller the brief names in code
    const design = readDesignMagister(manifest);
    if ("error" in design) {
      console.error(`${opusId}: ${design.error}`);
      return { exitCode: 2 };
    }
    if (sella === design.magister) {
      const problems = promiseLedgerProblems(read.bytes.toString("utf8"), transcript.toString("utf8"), briefRel);
      if (problems.length > 0) {
        console.error(problems.map((p) => `${opusId}: promise ledger: ${p}`).join("\n"));
        return { exitCode: 2 };
      }
    }
    briefHeader = `${briefRel} blob:${createHash("sha1").update(`blob ${read.bytes.length}\0`).update(read.bytes).digest("hex")}`;
    // W-246: as in build, a blocker that cites no line of the pinned brief is advisory, and a failure with none standing passes
    const where = officinaInRepo(root);
    const reconciled = reconcileFindings(transcript.toString("utf8"), outcome, {
      spec: briefRel,
      ...(where === undefined ? {} : { repoSpec: where.rel === "" ? briefRel : `${where.rel}/${briefRel}` }),
      text: read.bytes.toString("utf8"),
    }, true);
    conversions = reconciled.converted;
    recorded = reconciled.outcome;
    submitted = reconciled.submittedOutcome;
    if (conversions.length > 0) convertedHeader = conversions.map((c) => `${c.finding} (${c.reason})`).join("; ");
  }

  // W-215: a sequence (opus, phase, sella) keeps the reviewer session its first sessioned round recorded
  const sequence = readSequence(root, opusId, phase, sella);
  if ("error" in sequence) {
    console.error(sequence.error);
    return { exitCode: 2 };
  }
  const last = sequence.last;
  if (last?.session !== undefined) {
    const problem =
      round <= last.round
        ? `${last.log} records session ${last.session}; the next round of this sequence must be above ${last.round}`
        : session === undefined
          ? `${last.log} records session ${last.session}; a later verdict of the sequence needs --session (the same id, or another with --session-reason)`
          : session !== last.session && sessionReason === undefined
            ? `${last.log} records session ${last.session}; replacing it with ${session} needs --session-reason`
            : session === last.session && sessionReason !== undefined
              ? `--session-reason is valid only when --session differs from ${last.session}, the sequence's recorded session`
              : undefined;
    if (problem !== undefined) {
      console.error(problem);
      return { exitCode: 2 };
    }
  } else if (sessionReason !== undefined) {
    console.error("--session-reason is valid only when --session replaces the sequence's recorded session; this sequence has none");
    return { exitCode: 2 };
  }

  const filenamePhase = LOG_KIND[phase];
  const target = join(root, "ci", `${opusId}-${filenamePhase}-${round}.log`);
  if (existsSync(target)) {
    console.error(`${relative(root, target)} already exists — verdict evidence is never overwritten`);
    return { exitCode: 2 };
  }

  const headerText = (): string =>
    [
      headerLine("opus", opusId),
      headerLine("phase", phase),
      headerLine("round", round),
      headerLine("sella", sella),
      ...(model === undefined ? [] : [headerLine("model", model)]),
      ...(session === undefined ? [] : [headerLine("session", session)]),
      ...(sessionReason === undefined ? [] : [headerLine("session_reason", sessionReason)]),
      headerLine("outcome", recorded),
      ...(submitted === undefined ? [] : [headerLine("submitted_outcome", submitted)]),
      headerLine("at", now.toISOString()),
      headerLine("tree", treeAtCapture(root, manifest.source_excludes ?? [])),
      ...(briefHeader === undefined ? [] : [headerLine("brief", briefHeader)]),
      ...(convertedHeader === undefined ? [] : [headerLine("converted", convertedHeader)]),
      ...(promptHeader === undefined ? [] : [headerLine("dispatch_prompt", promptHeader)]),
      ...(inputHeader === undefined ? [] : [headerLine("ui_input", inputHeader)]),
      ...(uiDigest === undefined ? [] : [headerLine("design_digest", uiDigest)]),
    ].join("\n");
  let header = headerText();

  // W-215: a sessioned verdict is judged whole, before it is written: it parses, its outcome agrees with what stands, and it
  // accounts for every standing blocker of the sequence's previous round
  if (session !== undefined) {
    const rel = relative(root, target).split(sep).join("/");
    // W-246: a spec review is reconciled on its raw lines above, before the session's rulings apply; one submitted `failed`
    // whose every cited blocker a ruling withdrew has nothing standing, so it passes as it does without a session
    if (!isUi && phase === "spec" && recorded === "failed") {
      const read = parseVerdictLog(`${header}\n\n${transcript.toString("utf8")}`, opusId, rel);
      if (!("error" in read) && !read.findings.some((f) => f.blocking) && !read.earlier.some((e) => e.status === "open")) {
        recorded = "passed";
        submitted = outcome;
        header = headerText();
      }
    }
    const problem = sessionedProblem(`${header}\n\n${transcript.toString("utf8")}`, opusId, rel, outcome, recorded, last?.parsed, last?.log);
    if (problem !== undefined) {
      console.error(problem);
      return { exitCode: 2 };
    }
  }

  // W-233: spec and build verdicts need the step ticket of their round (handoff verdicts stay unticketed); its line is the header block's last
  let claim: { claimed?: string } = {};
  if (phase !== "handoff") {
    const ticket = requireTicket({ studio: root, manifest, opus: opusId, verb: "verdict", action: phase === "spec" ? "verdict-spec" : "verdict-build", round });
    if ("refusal" in ticket) {
      console.error(ticket.refusal);
      return { exitCode: 2 };
    }
    const claimed = claimPending(ticket);
    if ("refusal" in claimed) {
      console.error(claimed.refusal);
      return { exitCode: 2 };
    }
    claim = claimed;
    if ("line" in ticket) header = `${header}\n${headerLine("ticket", ticket.line)}`;
  }

  try {
    ensureRealDirectory(root, "ci");
    writeFileSync(target, Buffer.concat([Buffer.from(`${header}\n\n`), transcript]), { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") console.error(`${relative(root, target)} already exists — verdict evidence is never overwritten`);
    else console.error(`could not write ${relative(root, target)}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }
  releaseClaim(claim);

  console.log(`${opusId}: ${phase} verdict round ${round} -> ${relative(root, target).split(sep).join("/")}`);
  for (const c of conversions) console.log(`${opusId}: finding ${c.finding} recorded as advisory: ${c.reason}`);
  if (submitted !== undefined) console.log(`${opusId}: outcome "${submitted}" recorded as passed: no blocking finding cites a line of the brief`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// W-167: the build-review history `next` and `amend` both read. One reader per
// record, each failing closed: an unreadable or out-of-domain record is an
// error, never "no rounds" (D-045: mistakes, not adversaries).
// ---------------------------------------------------------------------------

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";
/** Every row of a manifest list with this id: a domain that says "exactly one" counts them, never takes the first. */
const declared = (list: unknown, id: string): Dict[] => (Array.isArray(list) ? list : []).filter((r): r is Dict => isDict(r) && r["id"] === id);

export interface BuildReviewConfig {
  reviewId: string;
  censor: string;
  sourceExcludes: string[];
}
export interface BuildReviewRound {
  n: number;
  /** ci/<id>-review-<n>.log */
  log: string;
  /** ms, from "# at:" */
  at: number;
  /** "# tree:" */
  tree: string;
  /** W-206: "# brief:", the brief the round was recorded against, when the log carries one */
  brief?: string;
  outcome: "passed" | "failed";
  /** standing, after "# converted:" */
  blockers: RecordedFinding[];
  /** failed, and every standing blocker opens "blocking (security)" (D-044) */
  securityOnly: boolean;
}

/** A round counts toward the cap when it failed and is not security-only (D-046 §2, D-044). */
export const countedFailures = (rounds: readonly BuildReviewRound[]): BuildReviewRound[] => rounds.filter((r) => r.outcome === "failed" && !r.securityOnly);

/**
 * The one reader of the review configuration: `review_probatio` (absent means `review`) names exactly one declared
 * `kind: agent` probatio that is not `spec`; the one `qa` collegium's magister is exactly one declared, live,
 * `kind: agent`, non-builder-class seat (the censor every build log and gate must name); `source_excludes` is absent
 * or a list of non-empty strings, the domain `check`'s `manifest.shape` states.
 */
export function readBuildReviewConfig(manifest: Manifest): { config: BuildReviewConfig } | { error: string } {
  const m: unknown = manifest;
  if (!isDict(m)) return { error: "bisellium.yml: not a mapping" };
  const bad = (why: string): { error: string } => ({ error: `bisellium.yml: ${why}` });
  let reviewId = "review";
  if ("review_probatio" in m) {
    if (!nonEmpty(m["review_probatio"])) return bad("review_probatio must be the id of one declared probatio (a non-empty string), or absent");
    reviewId = m["review_probatio"];
  }
  if (reviewId === "spec") return bad("review_probatio must not be spec: the ready rung reads that gate by name");
  const gates = declared(m["probationes"], reviewId);
  if (gates.length !== 1) return bad(`review_probatio ${reviewId} must be declared exactly once in probationes (found ${gates.length})`);
  if (gates[0]!["kind"] !== "agent") return bad(`review_probatio ${reviewId} must be kind: agent`);
  const qa = declared(m["collegia"], "qa");
  if (qa.length !== 1) return bad(`the qa collegium must be declared exactly once (found ${qa.length})`);
  const censor = qa[0]!["magister"];
  if (!nonEmpty(censor)) return bad("the qa collegium declares no magister to be the censor");
  const seats = declared(m["sellae"], censor);
  if (seats.length !== 1) return bad(`the censor ${censor} must be exactly one declared seat (found ${seats.length})`);
  const seat = seats[0]!;
  if (seat["retired"] !== undefined && seat["retired"] !== false) return bad(`the censor ${censor} is retired; it must be a live seat`);
  if (seat["kind"] !== "agent") return bad(`the censor ${censor} must be kind: agent`);
  if (isBuilderClassSeat(resolveSeat({ sellae: [{ id: censor }] }, censor))) return bad(`the censor ${censor} is builder-class; review and verdict would record a minted instance, not ${censor}`);
  const excluded = readSourceExcludes(manifest);
  if ("error" in excluded) return excluded;
  return { config: { reviewId, censor, sourceExcludes: excluded.excludes } };
}

/** W-166: the one reader of `source_excludes` (moved out of `readBuildReviewConfig`, same message). Absent is
 *  `[]`; a list of non-empty strings is that list; anything else, `null` included, is an error. */
export function readSourceExcludes(manifest: Manifest): { excludes: string[] } | { error: string } {
  const m: unknown = manifest;
  if (!isDict(m) || !("source_excludes" in m)) return { excludes: [] };
  const raw = m["source_excludes"];
  if (!Array.isArray(raw) || !raw.every(nonEmpty)) return { error: "bisellium.yml: source_excludes must be a list of non-empty strings, or absent" };
  return { excludes: raw };
}

/**
 * The keys `next` (from the main checkout's manifest) and the verbs (from the worktree's) must agree on, as one
 * comparable value: `review_probatio`, its `probationes` row, the `qa` collegium row, the censor's `sellae` row,
 * `patron` and `source_excludes`, each raw (absent kept as absent).
 */
export function buildReviewKeys(manifest: Manifest): Record<string, unknown> {
  const m: Dict = isDict(manifest) ? (manifest as unknown as Dict) : {};
  const reviewId = nonEmpty(m["review_probatio"]) ? m["review_probatio"] : "review";
  const qa = declared(m["collegia"], "qa");
  const censor = qa[0]?.["magister"];
  return {
    review_probatio: m["review_probatio"],
    [`probationes.${reviewId}`]: declared(m["probationes"], reviewId),
    "collegia.qa": qa,
    [`sellae.${nonEmpty(censor) ? censor : "(censor)"}`]: nonEmpty(censor) ? declared(m["sellae"], censor) : undefined,
    patron: m["patron"],
    source_excludes: m["source_excludes"],
  };
}

/** The worktree's manifest, read for comparison: any read or parse failure is an error, never an empty manifest. */
export function readWorktreeManifest(studio: string): { manifest: Manifest } | { error: string } {
  try {
    const manifest: unknown = readManifest(studio);
    return isDict(manifest) ? { manifest: manifest as unknown as Manifest } : { error: `${studio}/bisellium.yml: not a mapping` };
  } catch (e) {
    return { error: `${studio}/bisellium.yml: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** The first key the two manifests disagree on, with both values, or undefined when `buildReviewKeys` agrees. */
export function buildReviewDrift(main: Manifest, worktree: Manifest): string | undefined {
  const a = buildReviewKeys(main);
  const b = buildReviewKeys(worktree);
  const show = (v: unknown): string => (v === undefined ? "(absent)" : JSON.stringify(v));
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (show(a[key]) !== show(b[key])) return `bisellium.yml#${key} differs between the main checkout (${show(a[key])}) and the opus worktree (${show(b[key])}); land the change on master first, then rebase the branch`;
  return undefined;
}

/** One build-review log, strictly: the parser's grammar, then this opus's phase, round, censor, time, tree and outcome. */
function parseBuildReviewLog(text: string, id: string, rel: string, n: number, censor: string): BuildReviewRound | { error: string } {
  const p = parseVerdictLog(text, id, rel);
  if ("error" in p) return p;
  const bad = (why: string): { error: string } => ({ error: `${rel}: ${why}` });
  const once: Record<string, string> = {};
  for (const key of ["phase", "round", "sella", "outcome", "at", "tree"]) {
    const values = p.headers.get(key);
    if (values?.length !== 1) return bad(`the header "# ${key}:" must appear exactly once`);
    once[key] = values[0]!;
  }
  if (once["phase"] !== "build") return bad('the header "# phase:" must be build');
  if (once["round"] !== String(n)) return bad(`the header "# round:" must equal the filename's round ${n}`);
  if (once["sella"] !== censor) return bad(`the header "# sella:" must be the censor ${censor}`);
  const brief = p.headers.get("brief") ?? [];
  if (brief.length > 1) return bad('the header "# brief:" must appear at most once');
  const at = utcTimestampProblem(once["at"]);
  if (at !== undefined) return bad(`the header "# at:" ${at}`);
  const verdict = /^(?:verdict:\s*)?(pass(?:ed)?|fail(?:ed)?)\b/i.exec(once["outcome"]!.trim())?.[1];
  if (verdict === undefined) return bad('the header "# outcome:" must be passed or failed');
  const outcome = verdict.toLowerCase().startsWith("pass") ? "passed" : "failed";
  const blockers = p.findings.filter((f) => f.blocking);
  if (outcome === "passed" && blockers.length > 0) return bad("outcome passed beside a standing blocking finding");
  if (outcome === "failed" && blockers.length === 0) return bad("outcome failed with no standing blocking finding");
  return {
    n,
    log: rel,
    at: instant(once["at"])!.getTime(), // utcTimestampProblem passed above, so the instant exists
    tree: once["tree"]!,
    ...(brief[0] === undefined ? {} : { brief: brief[0] }),
    outcome,
    blockers,
    securityOnly: outcome === "failed" && blockers.every((b) => /^\**blocking \(security\)/i.test(b.text)),
  };
}

/**
 * Every `ci/<id>-review-<n>.log` of an officina, sorted by `n`, each read through the contained reader (4 MB cap) and
 * judged by `parseBuildReviewLog`. An unreadable `ci/`, a malformed name or an out-of-domain log is an error.
 */
export function readBuildRounds(root: string, id: string, config: BuildReviewConfig): { rounds: BuildReviewRound[] } | { error: string } {
  let names: string[];
  try {
    names = readdirSync(join(root, "ci"));
  } catch (e) {
    return { error: `ci/: ${(e as Error).message.split("\n")[0]}` };
  }
  const prefix = `${id}-review-`;
  const rounds: BuildReviewRound[] = [];
  for (const name of names.filter((x) => x.startsWith(prefix)).sort()) {
    const m = /^([1-9]\d{0,14})\.log$/.exec(name.slice(prefix.length));
    if (m === null) return { error: `ci/${name}: a build-review log is named ${prefix}<n>.log, n a positive integer of at most 15 digits with no leading zero` };
    const rel = `ci/${name}`;
    const file = readContainedRegularFile(root, rel, "ci", LOG_MAX_BYTES);
    if ("error" in file) return { error: `${rel}: ${file.error}` };
    const round = parseBuildReviewLog(file.bytes.toString("utf8"), id, rel, Number(m[1]), config.censor);
    if ("error" in round) return round;
    rounds.push(round);
  }
  return { rounds: rounds.sort((a, b) => a.n - b.n) };
}
