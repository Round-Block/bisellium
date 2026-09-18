/**
 * packages/commands/src/lifecycle.ts — W-020: the four lifecycle/evidence
 * write commands (`ready`, `done`, `review`, `red`). Replaces the two
 * stopgap scripts (`scripts/opus-ready.ts`, `scripts/opus-close.ts`, both
 * deleted by this opus) and adds the third piece P-001/P-003 decreed: a
 * per-behaviour red store at `<studio>/ci/reds/<opus>/`, written only
 * through `red`. Kept out of main.ts's generic flag table on purpose, same
 * as `verify`/`talk` — each of these parses its own argv.
 *
 * Every front-matter write goes through `editOpusFrontMatter` (merge into
 * the yaml Document, body byte-for-byte) — the same discipline writes.ts's
 * five commands already follow. `ready`/`done`/`review` share writes.ts's
 * plumbing (`parseFlags`, `openStudio`, `safeItemPath`, `readState`,
 * `resolveNow`, `emitEvent`) rather than re-deriving it.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readFront } from "@bisellium/adapter-native";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { WF } from "@bisellium/schema";
import { editOpusFrontMatter } from "./frontmatter.js";
import {
  emitEvent,
  openStudio,
  parseFlags,
  readState,
  resolveNow,
  safeItemPath,
  type WriteOptions,
  type WriteResult,
} from "./writes.js";

const GIT_TIMEOUT_MS = 30_000;

/** Same fallback chain `context`/`hook-event` already use: an explicit
 *  `--sella`, else $BISELLIUM_SELLA, else the "guest" sella every studio
 *  declares. */
function resolveSella(flagValue: string | undefined): string {
  return flagValue ?? process.env["BISELLIUM_SELLA"] ?? "guest";
}

interface OpusFront {
  state?: unknown;
  probationes?: Record<string, { status?: unknown; evidence?: unknown; certifies?: unknown }>;
}

/** True when `relPath` resolved against `root` stays inside it — D-008's
 *  resolved-path relation (`relative()`, first segment check), never a
 *  `startsWith`/`join()`-only test. Shared by `ready --spec` and
 *  `review --evidence`, the two ids-into-paths this opus itself writes. */
function isContained(root: string, relPath: string): boolean {
  const rel = relative(root, resolve(root, relPath));
  if (isAbsolute(rel)) return false;
  return rel.split(sep)[0] !== "..";
}

// ---------------------------------------------------------------------------
// 1. ready — greenlit|halted -> building (scripts/opus-ready.ts, plus the event)
// ---------------------------------------------------------------------------

const READY_USAGE = "usage: bisellium ready <opus> [--spec <path>] [--sella <id>] [--studio <dir>] [--now <iso>]";

export function runReady(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--spec", "--sella", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${READY_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(READY_USAGE);
    return { exitCode: 2 };
  }

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
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

  const currentState = readState(opusPath);
  if (typeof currentState !== "string") {
    console.error(currentState.error);
    return { exitCode: 2 };
  }
  if (currentState !== "greenlit" && currentState !== "halted") {
    console.error(`${opusId} is not greenlit or halted (state: ${currentState || "?"})`);
    return { exitCode: 2 };
  }

  const specRel = values.get("--spec") ?? `briefs/${opusId}.md`;
  if (!isContained(root, specRel)) {
    console.error(`${opusId}: --spec "${specRel}" resolves outside the officina (D-008) — refused`);
    return { exitCode: 2 };
  }
  if (!existsSync(join(root, specRel))) {
    console.error(`${opusId}: no spec at ${specRel} — not ready`);
    return { exitCode: 2 };
  }

  const sella = resolveSella(values.get("--sella"));
  const hasSpecProbatio = manifest.probationes.some((p) => p.id === "spec");

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["spec"], specRel);
    if (hasSpecProbatio) {
      doc.setIn(["probationes", "spec", "sella"], sella);
      doc.setIn(["probationes", "spec", "status"], "passed");
      doc.setIn(["probationes", "spec", "evidence"], specRel);
      doc.setIn(["probationes", "spec", "at"], now.toISOString());
    }
    doc.setIn(["state"], "building");
    // A halt's exit conditions describe a state this opus is no longer in.
    for (const k of ["halted_at", "reason", "resume_when"]) doc.delete(k);
    return undefined;
  });

  emitEvent(root, manifest, "workflow.state_changed", now, {
    [WF.ITEM_ID]: opusId,
    [WF.STATE_FROM]: currentState,
    [WF.STATE_TO]: "building",
    [WF.ACTOR_ROLE]: sella,
  });

  console.log(`${opusId}: spec=${specRel} state=building`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 2. done — building|verifying|review -> done (scripts/opus-close.ts, plus the event)
// ---------------------------------------------------------------------------

const DONE_USAGE = "usage: bisellium done <opus> [--sella <id>] [--studio <dir>] [--now <iso>]";
const DONE_FROM_STATES = new Set(["building", "verifying", "review"]);

export function runDone(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--sella", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${DONE_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(DONE_USAGE);
    return { exitCode: 2 };
  }

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
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

  // Read off disk with readFront, never a regex over raw YAML (that was
  // opus-close.ts's own shortcut, and the reason it's deleted).
  const front = readFront<OpusFront>(opusPath).data;
  const currentState = typeof front.state === "string" ? front.state : "";
  // Not one of the three states this write accepts from: same "any other
  // current state is a refusal" shape ready's greenlit/halted guard uses.
  if (!DONE_FROM_STATES.has(currentState)) {
    console.error(`${opusId} is not building, verifying or review (state: ${currentState || "?"})`);
    return { exitCode: 2 };
  }

  const recorded = front.probationes ?? {};
  const missing: string[] = [];
  for (const p of manifest.probationes) {
    const rec = recorded[p.id];
    const status = typeof rec?.status === "string" ? rec.status : undefined;
    const certifies = typeof rec?.certifies === "string" ? rec.certifies : undefined;
    if (p.kind === "automated") {
      if (status !== "passed" || !certifies?.startsWith("tree:")) missing.push(p.id);
    } else if (p.kind === "agent") {
      if (status !== "passed" && status !== "waived") missing.push(p.id);
    } else if (p.kind === "human") {
      // An unrecorded human gate is not demanded — same asymmetry
      // check.ts's state.done.probationes rule already has.
      if (rec !== undefined && status !== "passed" && status !== "waived") missing.push(p.id);
    }
  }
  if (missing.length) {
    console.error(`${opusId}: gates not passed: ${missing.join(", ")}`);
    return { exitCode: 1 };
  }

  const sella = resolveSella(values.get("--sella"));

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["state"], "done");
    return undefined;
  });

  emitEvent(root, manifest, "workflow.state_changed", now, {
    [WF.ITEM_ID]: opusId,
    [WF.STATE_FROM]: currentState,
    [WF.STATE_TO]: "done",
    [WF.ACTOR_ROLE]: sella,
  });

  console.log(`${opusId}: done`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 3. review — records a passed or failed review verdict (L-016)
// ---------------------------------------------------------------------------

const REVIEW_USAGE =
  "usage: bisellium review <opus> --pass|--fail --evidence <path> [--round <n>] [--sella <id>] [--studio <dir>] [--now <iso>]";

export function runReview(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, {
    valued: ["--evidence", "--round", "--sella", "--studio", "--now"],
    boolean: ["--pass", "--fail"],
  });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${REVIEW_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, flags, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(REVIEW_USAGE);
    return { exitCode: 2 };
  }

  const pass = flags.has("--pass");
  const fail = flags.has("--fail");
  if (pass === fail) {
    console.error(`exactly one of --pass/--fail is required\n${REVIEW_USAGE}`);
    return { exitCode: 2 };
  }

  const evidence = values.get("--evidence");
  if (!evidence) {
    console.error(REVIEW_USAGE);
    return { exitCode: 2 };
  }

  let round: number | undefined;
  if (values.has("--round")) {
    round = Number(values.get("--round"));
    if (!Number.isFinite(round) || !Number.isInteger(round)) {
      console.error("--round must be an integer");
      return { exitCode: 2 };
    }
  }

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
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

  if (!isContained(root, evidence)) {
    console.error(`${opusId}: --evidence "${evidence}" resolves outside the officina (D-008) — refused`);
    return { exitCode: 2 };
  }
  if (!existsSync(join(root, evidence))) {
    console.error(`--evidence "${evidence}" not found under studio`);
    return { exitCode: 2 };
  }

  const currentState = readState(opusPath);
  if (typeof currentState !== "string") {
    console.error(currentState.error);
    return { exitCode: 2 };
  }

  const reviewProbatioId = (manifest as unknown as { review_probatio?: string }).review_probatio ?? "review";
  const sella = resolveSella(values.get("--sella"));
  const status = pass ? "passed" : "failed";

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["probationes", reviewProbatioId, "sella"], sella);
    doc.setIn(["probationes", reviewProbatioId, "status"], status);
    doc.setIn(["probationes", reviewProbatioId, "evidence"], evidence);
    doc.setIn(["probationes", reviewProbatioId, "at"], now.toISOString());
    // The decree's own return edge: a failed review on an opus in `review`
    // OR `done` sends it back to `building` — no other command can move it
    // there, and without this a `done` opus with a failed gate is stuck
    // forever (state.done.probationes fires and nothing reopens it — the
    // gap cascade 6's round-2 review exposed, F5). An opus already in
    // `building` (or anywhere else) keeps its state; `review` performs no
    // forward transition, that's `done`'s job.
    if (fail && (currentState === "review" || currentState === "done")) doc.setIn(["state"], "building");
    return undefined;
  });

  const attrs: Record<string, string | number | boolean> = {
    [WF.ITEM_ID]: opusId,
    [WF.GATE_ID]: reviewProbatioId,
    [WF.GATE_STATUS]: status,
    [WF.GATE_EVIDENCE]: evidence,
    [WF.ACTOR_ROLE]: sella,
  };
  if (round !== undefined) attrs[WF.REVIEW_ROUND] = round;
  emitEvent(root, manifest, "workflow.gate_evaluated", now, attrs);

  console.log(`${opusId}: review ${status} (${evidence})`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 4. red — the per-behaviour evidence store, the seam with W-021
// ---------------------------------------------------------------------------

const RED_USAGE =
  "usage: bisellium red <opus> --behaviour <n> [--sella <id>] [--studio <dir>] [--repo <dir>] [--now <iso>] -- <cmd…>";

function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Same containment idiom as writes.ts's `safeItemPath`, applied to a
 * directory (`<studio>/ci/reds/<opus>/`) instead of an `<id>.md` file — an
 * opus id with a path separator or a `..` segment is rejected outright, and
 * `dirname(dir) !== resolvedBase` is defense in depth against `join()`'s own
 * normalization ever surprising us (resolved-path relation, never `startsWith`).
 */
function safeRedsDir(studioRoot: string, opusId: string): string | { error: string } {
  if (!opusId || /[\\/]/.test(opusId) || opusId === "." || opusId === "..") return { error: `invalid opus id "${opusId}"` };
  const base = resolve(join(studioRoot, "ci", "reds"));
  const dir = join(base, opusId);
  if (dirname(dir) !== base) return { error: `invalid opus id "${opusId}"` };
  return dir;
}

/** Runs `cmd` (cwd: the caller's own), collecting stdout+stderr in the order
 *  the OS actually delivers them — real chronological combination, which is
 *  why this (unlike ready/done/review) has to be async. */
function runCapture(cmd: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((done) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", (err) => done({ exitCode: 1, output: output + `\n[red] failed to run command: ${(err as Error).message}\n` }));
    child.on("close", (code) => done({ exitCode: code ?? 1, output }));
  });
}

export async function runRed(args: string[], opts: WriteOptions = {}): Promise<WriteResult> {
  if (args.length === 0) {
    console.error(RED_USAGE);
    return { exitCode: 2 };
  }
  const sepIdx = args.indexOf("--");
  if (sepIdx === -1) {
    console.error(`missing "--" separator before the command\n${RED_USAGE}`);
    return { exitCode: 2 };
  }
  const before = args.slice(0, sepIdx);
  const cmd = args.slice(sepIdx + 1);
  if (cmd.length === 0) {
    console.error(`empty command after "--"\n${RED_USAGE}`);
    return { exitCode: 2 };
  }

  const parsed = parseFlags(before, { valued: ["--behaviour", "--sella", "--studio", "--repo", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${RED_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(RED_USAGE);
    return { exitCode: 2 };
  }

  const behaviourRaw = values.get("--behaviour");
  if (behaviourRaw === undefined || !/^\d+$/.test(behaviourRaw) || Number(behaviourRaw) < 1) {
    console.error(`--behaviour must be a positive integer\n${RED_USAGE}`);
    return { exitCode: 2 };
  }
  const behaviour = Number(behaviourRaw);

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;

  const redsDir = safeRedsDir(root, opusId);
  if (typeof redsDir !== "string") {
    console.error(redsDir.error);
    return { exitCode: 2 };
  }

  const sella = resolveSella(values.get("--sella"));
  const repo = resolve(values.get("--repo") ?? (isGitRepo(resolve(root, "..")) ? resolve(root, "..") : process.cwd()));

  let treeHeader = "unknown";
  if (isGitRepo(repo)) {
    try {
      // Same exclusion set verify.ts computes: the officina itself,
      // .bisellium/, and any manifest source_excludes — so red's own log
      // write is never what makes the tree it just certified "dirty".
      const excludeDirs = [relative(repo, root).split(sep).join("/"), ".bisellium", ...(manifest.source_excludes ?? [])];
      const hash = sourceTreeHash(repo, excludeDirs, "HEAD");
      const dirty = isDirtyOutside(repo, excludeDirs);
      treeHeader = `${dirty ? "dirty" : "tree"}:${hash}`;
    } catch {
      treeHeader = "unknown";
    }
  }

  const { exitCode: cmdExit, output } = await runCapture(cmd, process.cwd());

  if (cmdExit === 0) {
    console.error(`red: command exited 0 — that command passed, nothing recorded`);
    return { exitCode: 1 };
  }

  mkdirSync(redsDir, { recursive: true });
  const nn = String(behaviour).padStart(2, "0");
  const logPath = join(redsDir, `${nn}.log`);
  const header = [
    `# behaviour: ${behaviour}`,
    `# command: ${cmd.join(" ")}`,
    `# exit: ${cmdExit}`,
    `# at: ${now.toISOString()}`,
    `# sella: ${sella}`,
    `# tree: ${treeHeader}`,
  ].join("\n");
  writeFileSync(logPath, `${header}\n\n${output}`);

  console.log(`${opusId}: red recorded for behaviour ${behaviour} -> ci/reds/${opusId}/${nn}.log`);
  return { exitCode: 0 };
}
