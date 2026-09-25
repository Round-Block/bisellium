import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { openStudio, parseFlags, recordOwnerRefusal, resolveNow, safeItemPath, type WriteOptions, type WriteResult } from "./writes.js";

export const VERDICT_USAGE =
  "usage: bisellium verdict <opus> --round <n> --sella <id> --outcome <text> [--phase spec|build] [--model <id>] [--from <path>] [--studio <dir>] [--now <iso>]";

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
    valued: ["--round", "--sella", "--outcome", "--phase", "--model", "--from", "--studio", "--now"],
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

  const now = resolveNow(values.get("--now"), opts.now);
  if (now === undefined) {
    console.error("--now must be an ISO date");
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
