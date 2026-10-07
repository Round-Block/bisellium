import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { ensureRealDirectory } from "./ids.js";
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
  "usage: bisellium verdict <opus> --round <n> --sella <id> --outcome <text> [--phase spec|build] [--model <id>] [--from <path>] [--dispatch-prompt <ci-path>] [--ui-input <ci-path>] [--studio <dir>] [--now <iso>]";

export interface VerdictOptions extends WriteOptions {
  stdin?: Buffer;
}

const GIT_TIMEOUT_MS = 30_000;
const BODY_CAP = 8192;

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
  "outcome",
  "submitted_outcome",
  "at",
  "tree",
  "brief",
  "converted",
  "dispatch_prompt",
  "ui_input",
  "design_digest",
] as const;
const headerLine = (name: (typeof VERDICT_HEADERS)[number], value: string | number): string => `# ${name}: ${value}`;

/** A header value is one line: CR and LF in spec- or error-derived text are written as the two characters `\r` and `\n`. */
const oneLine = (text: string): string => text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");

/** The ways a citation can name the declared brief: a bare `brief`, or any path ending in `briefs/<name>.md`. */
const CITATION = /(?<![\w./-])(brief|\/?(?:[\w.-]+\/)*briefs\/[\w.-]+\.md):([1-9]\d*)(?!\d)/g;

/**
 * W-126: a blocking finding keeps its severity only when it cites a line of the opus's declared brief; the rest are
 * recorded as advisory. Grammar only — it never judges, promotes, adds or drops a finding, nor edits the body.
 */
export function reconcileFindings(
  body: string,
  outcome: string,
  brief: { spec: string; repoSpec?: string; text: string } | { error: string },
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
  if (blocking.length > 0 && converted.length === blocking.length && /^(?:verdict:\s*)?fail(?:ed)?\b/i.test(outcome.trim()))
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
}

/**
 * One recorded log's text, judged RAW: no line is stripped, trimmed or interpreted before it is judged. The header block
 * is the lines before the first empty line, each exactly `# key: value`. In the body the one `## Findings` section
 * (ends at the next `## ` line) holds empty lines, the exact line `No findings`, or lines of the finding grammar,
 * and nothing else: a fence, comment, heading, indented or otherwise dressed line is out of domain and the whole
 * log is unreadable. This is the only parser of a verdict log, in the retro and in `next`'s spec-review gate (W-162).
 */
export function parseVerdictLog(text: string, id: string, rel: string): { headers: Map<string, string[]>; findings: RecordedFinding[] } | Refusal {
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
  if (section.length === 1 && section[0] === "No findings") return { headers, findings: [] };
  if (section.length === 0) return { error: `${rel}: "## Findings" holds neither "No findings" nor numbered findings` };
  const findings: RecordedFinding[] = [];
  for (const line of section) {
    if (!FINDING_LINE.test(line)) return { error: `${rel}: line under "## Findings" out of domain (want "<n>. blocking|advisory …", or "No findings" alone): ${line.slice(0, 60)}` };
    const n = Number(/^\d+/.exec(line)![0]);
    if (findings.some((f) => f.n === n)) return { error: `${rel}: finding ${n} is numbered twice` };
    const text = line.replace(/^\d+\. /, "");
    findings.push({ log: rel, n, text, blocking: /^\**blocking\b/i.test(text) });
  }
  const converted = headers.get("converted");
  if (converted !== undefined) {
    if (converted.length !== 1) return { error: `${rel}: more than one "# converted:" header` };
    // "<n> (<reason>)", joined by "; ": every piece closed, every n a blocking finding of this log
    const pieces = converted[0]!.split(/; (?=[1-9]\d* \()/);
    for (const piece of pieces) {
      const m = /^([1-9]\d*) \((.+)\)$/.exec(piece);
      const f = m ? findings.find((x) => x.n === Number(m[1])) : undefined;
      if (!m || !f?.blocking) return { error: `${rel}: "# converted:" is not a list of "<n> (<reason>)" naming blocking findings of this log: ${piece.slice(0, 60)}` };
      f.blocking = false;
    }
  }
  return { headers, findings };
}


function hasHeaderBreak(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}

/** Records a review transcript under the officina without changing any gate. */
export function runVerdict(args: string[], opts: VerdictOptions = {}): WriteResult {
  const parsed = parseFlags(args, {
    valued: ["--round", "--sella", "--outcome", "--phase", "--model", "--from", "--dispatch-prompt", "--ui-input", "--studio", "--now"],
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
  if (roundRaw === undefined || !/^[1-9]\d*$/.test(roundRaw)) {
    console.error(`--round must be a positive integer\n${VERDICT_USAGE}`);
    return { exitCode: 2 };
  }
  const round = Number(roundRaw);
  if (!Number.isSafeInteger(round)) {
    console.error(`--round must be a positive integer\n${VERDICT_USAGE}`);
    return { exitCode: 2 };
  }

  const phase = values.get("--phase") ?? "build";
  if (phase !== "spec" && phase !== "build") {
    console.error(`--phase must be spec or build\n${VERDICT_USAGE}`);
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
  if (!isUi) {
    const problem = findingsProblem(transcript.toString("utf8"));
    if (problem !== undefined) {
      console.error(problem);
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
    briefHeader = `${briefRel} blob:${createHash("sha1").update(`blob ${read.bytes.length}\0`).update(read.bytes).digest("hex")}`;
  }

  const filenamePhase = phase === "build" ? "review" : "spec";
  const target = join(root, "ci", `${opusId}-${filenamePhase}-${round}.log`);
  if (existsSync(target)) {
    console.error(`${relative(root, target)} already exists — verdict evidence is never overwritten`);
    return { exitCode: 2 };
  }

  const header = [
    headerLine("opus", opusId),
    headerLine("phase", phase),
    headerLine("round", round),
    headerLine("sella", sella),
    ...(model === undefined ? [] : [headerLine("model", model)]),
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

  try {
    ensureRealDirectory(root, "ci");
    writeFileSync(target, Buffer.concat([Buffer.from(`${header}\n\n`), transcript]), { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") console.error(`${relative(root, target)} already exists — verdict evidence is never overwritten`);
    else console.error(`could not write ${relative(root, target)}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

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
  let sourceExcludes: string[] = [];
  if ("source_excludes" in m) {
    const raw = m["source_excludes"];
    if (!Array.isArray(raw) || !raw.every(nonEmpty)) return bad("source_excludes must be a list of non-empty strings, or absent");
    sourceExcludes = raw;
  }
  return { config: { reviewId, censor, sourceExcludes } };
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
    at: Date.parse(once["at"]!),
    tree: once["tree"]!,
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
    const m = /^([1-9]\d*)\.log$/.exec(name.slice(prefix.length));
    if (m === null) return { error: `ci/${name}: a build-review log is named ${prefix}<n>.log, n a positive integer with no leading zero` };
    const rel = `ci/${name}`;
    const file = readContainedRegularFile(root, rel, "ci", LOG_MAX_BYTES);
    if ("error" in file) return { error: `${rel}: ${file.error}` };
    const round = parseBuildReviewLog(file.bytes.toString("utf8"), id, rel, Number(m[1]), config.censor);
    if ("error" in round) return round;
    rounds.push(round);
  }
  return { rounds: rounds.sort((a, b) => a.n - b.n) };
}
