import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { openStudio, parseFlags, recordOwnerRefusal, resolveNow, safeItemPath, type WriteOptions, type WriteResult } from "./writes.js";
import { readFront } from "@bisellium/adapter-native";
import {
  censorSella,
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

function treeAtCapture(studioRoot: string, sourceExcludes: string[]): string {
  const repo = gitRoot(studioRoot);
  if (repo === undefined) return "unknown";
  try {
    const studioRel = relative(repo, studioRoot);
    if (isAbsolute(studioRel) || studioRel.split(sep)[0] === "..") return "unknown";
    const exclusions = [studioRel.split(sep).join("/"), ".bisellium", ...sourceExcludes];
    const hash = sourceTreeHash(repo, exclusions, "HEAD");
    return `${isDirtyOutside(repo, exclusions) ? "dirty" : "tree"}:${hash}`;
  } catch {
    return "unknown";
  }
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

  const filenamePhase = phase === "build" ? "review" : "spec";
  const target = join(root, "ci", `${opusId}-${filenamePhase}-${round}.log`);
  if (existsSync(target)) {
    console.error(`${relative(root, target)} already exists — verdict evidence is never overwritten`);
    return { exitCode: 2 };
  }

  const header = [
    `# opus: ${opusId}`,
    `# phase: ${phase}`,
    `# round: ${round}`,
    `# sella: ${sella}`,
    ...(model === undefined ? [] : [`# model: ${model}`]),
    `# outcome: ${outcome}`,
    `# at: ${now.toISOString()}`,
    `# tree: ${treeAtCapture(root, manifest.source_excludes ?? [])}`,
    ...(promptHeader === undefined ? [] : [`# dispatch_prompt: ${promptHeader}`]),
    ...(inputHeader === undefined ? [] : [`# ui_input: ${inputHeader}`]),
    ...(uiDigest === undefined ? [] : [`# design_digest: ${uiDigest}`]),
  ].join("\n");

  mkdirSync(dirname(target), { recursive: true });
  try {
    writeFileSync(target, Buffer.concat([Buffer.from(`${header}\n\n`), transcript]), { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") console.error(`${relative(root, target)} already exists — verdict evidence is never overwritten`);
    else console.error(`could not write ${relative(root, target)}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  console.log(`${opusId}: ${phase} verdict round ${round} -> ${relative(root, target).split(sep).join("/")}`);
  return { exitCode: 0 };
}
