import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { ensureRealDirectory } from "./ids.js";
import { openStudio, parseFlags, recordOwnerRefusal, resolveNow, safeItemPath, type WriteOptions, type WriteResult } from "./writes.js";
import { readFront } from "@bisellium/adapter-native";
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
