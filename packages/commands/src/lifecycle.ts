/**
 * packages/commands/src/lifecycle.ts — W-020: the seven lifecycle/evidence
 * write commands (`ready`, `done`, `review`, `red`, `halt`, `waive`,
 * `amend`). Replaces the two stopgap scripts (`scripts/opus-ready.ts`,
 * `scripts/opus-close.ts`, both deleted by this opus) and adds the third
 * piece P-001/P-003 decreed: a per-behaviour red store at
 * `<studio>/ci/reds/<opus>/`, written only through `red`. Kept out of
 * main.ts's generic flag table on purpose, same as `verify`/`talk` — each of
 * these parses its own argv.
 *
 * Every front-matter write goes through `editOpusFrontMatter` (merge into
 * the yaml Document, body byte-for-byte) — the same discipline writes.ts's
 * five commands already follow. `ready`/`done`/`review` share writes.ts's
 * plumbing (`parseFlags`, `openStudio`, `safeItemPath`, `readState`,
 * `resolveNow`, `emitEvent`) rather than re-deriving it.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSeq } from "yaml";
import { readFront, resolveSeat, type Manifest } from "@bisellium/adapter-native";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { WF } from "@bisellium/schema";
import { editOpusFrontMatter } from "./frontmatter.js";
import {
  censorSella,
  effectiveProbationes,
  loadNativeRecords,
  readContainedRegularFile,
  titleProblem,
  utcTimestampProblem,
  validateNativeRecord,
  validateRecordReferences,
  validateUiPolicy,
  type NativeRecord,
  type OpusModelProblem,
} from "./opus-model.js";
import {
  emitEvent,
  mintDispatchSella,
  openStudio,
  parseFlags,
  readState,
  recordOwnerRefusal,
  resolveNow,
  safeItemPath,
  type WriteOptions,
  type WriteResult,
} from "./writes.js";

const GIT_TIMEOUT_MS = 30_000;

/** The CLI-wide un-credentialed default (`main.ts:188`'s own
 *  `--sella ?? $BISELLIUM_SELLA ?? "guest"` chain, `CLAUDE.md`,
 *  `.claude/settings.json`'s hook commands): a built-in identity like
 *  `patron`, never a roster row `bisellium init` is obliged to scaffold
 *  (censor W-089 round-1 finding B2 — a freshly-scaffolded officina declares
 *  only `producer`, and `guest` was refused there once this opus added the
 *  roster check below). Never builder-class, so there is nothing to mint. */
const GUEST_SELLA = "guest";

/** Same fallback chain `context`/`hook-event` already use: an explicit
 *  `--sella`, else $BISELLIUM_SELLA, else the "guest" sella every studio
 *  declares. W-089 behaviour 6: roster-aware — the selected name is then
 *  resolved against the manifest (template, instance, or a retired
 *  tombstone all pass; this is an ATTRIBUTION gate, not a live-dispatch one,
 *  so a retired id is accepted here and refused only at the load-bearing
 *  sites in run.ts/writes.ts). An id that resolves to nothing is a usage
 *  error, not a silent write. W-089 behaviour 5 (censor round-1 finding B1):
 *  a resolved LIVE builder-class template is then minted against `opusId`
 *  through `mintDispatchSella` — the same helper writes.ts's handoff/
 *  emit --usage already call (S2) — so `ready`/`done`/`review`/`halt`/
 *  `waive` never write or attribute a bare `builder`/`builder-codex`. */
function resolveSella(flagValue: string | undefined, manifest: Manifest, opusId: string, verb: string): string | { error: string } {
  const sella = flagValue ?? process.env["BISELLIUM_SELLA"] ?? GUEST_SELLA;
  if (sella === GUEST_SELLA) return sella;
  const resolved = resolveSeat(manifest, sella);
  if (!resolved) return { error: `${verb}: unknown sella "${sella}" — not declared in bisellium.yml` };
  const minted = mintDispatchSella(resolved, sella, opusId, verb);
  return "error" in minted ? minted : minted.sella;
}

/** `red`'s own resolver (W-039): a red log is permanent evidence — once its
 *  behaviour is implemented the same red can never be recorded again — so,
 *  unlike `resolveSella`, this never falls back to "guest" on its own.
 *  Returns `undefined` when neither `flagValue` nor `$BISELLIUM_SELLA` names
 *  anyone (W-039's own no-name refusal, kept distinct — the caller checks
 *  this before the roster check below runs). Otherwise (W-089 behaviour 6)
 *  the selected name is resolved against the manifest the same way
 *  `resolveSella` does — a retired tombstone passes (attribution, not
 *  dispatch) and a LIVE builder-class template mints against `opusId`
 *  (behaviour 5, same `mintDispatchSella` call `resolveSella` makes); an id
 *  that resolves to nothing is `{ error }`. Empty and whitespace-only count
 *  as unset in both places; a repeated `--sella` is `parseFlags`' own
 *  last-value-wins (`writes.ts`), not scanned here. Reads `process.env`
 *  once. Not exported: `runRed` and `runAmend` are its only callers, and
 *  keeping it unexported turns an import-shape mistake in a test into a
 *  module-load failure rather than a silently-passing red. */
function namedSella(flagValue: string | undefined, manifest: Manifest, opusId: string, verb: string): string | { error: string } | undefined {
  const envValue = process.env["BISELLIUM_SELLA"];
  let name: string | undefined;
  if (flagValue !== undefined && flagValue.trim() !== "") name = flagValue;
  else if (envValue !== undefined && envValue.trim() !== "") name = envValue;
  if (name === undefined) return undefined;
  if (name === GUEST_SELLA) return name;
  const resolved = resolveSeat(manifest, name);
  if (!resolved) return { error: `${verb}: unknown sella "${name}" — not declared in bisellium.yml` };
  const minted = mintDispatchSella(resolved, name, opusId, verb);
  return "error" in minted ? minted : minted.sella;
}

interface OpusFront {
  id?: unknown;
  kind?: unknown;
  collegium?: unknown;
  state?: unknown;
  probationes?: Record<string, { status?: unknown; evidence?: unknown; certifies?: unknown; reason?: unknown; waived_by?: unknown }>;
  title?: unknown;
  spec?: unknown;
  arc?: unknown;
  parent?: unknown;
  start?: unknown;
  end?: unknown;
  ui_rulings?: unknown;
}

function resolveExactNow(raw: string | undefined, fallback: Date | undefined): Date | undefined {
  if (raw !== undefined && utcTimestampProblem(raw)) return undefined;
  const value = resolveNow(raw, fallback);
  if (!value) return undefined;
  try { return utcTimestampProblem(value.toISOString()) ? undefined : value; }
  catch { return undefined; }
}

function nativePreflight(
  root: string,
  manifest: Manifest,
  opusId: string,
  record: NativeRecord,
  phase: "check" | "ready" | "review" | "done" = "check",
  wholeGraph = false,
): OpusModelProblem[] {
  const loaded = loadNativeRecords(root);
  const problems = loaded.problems.map(({ problem }) => problem);
  const records = new Map(loaded.records);
  records.set(opusId, record);
  // The native checker reports a missing kind on disk, but lifecycle writes
  // predate that field being required.  Preserve those legacy records'
  // transitions while still refusing every supplied non-native kind.  UI
  // policy remains opt-in only through an explicit `kind: ui` below.
  const graphRecords = wholeGraph ? [...records.values()] : [record];
  for (const graphRecord of graphRecords)
    problems.push(
      ...validateNativeRecord(graphRecord, records).filter(
        (problem) => graphRecord.kind !== undefined || problem.rule !== "opus.kind",
      ),
    );
  problems.push(...validateRecordReferences(root, record));
  problems.push(...validateUiPolicy({ root, record, manifest, phase }));
  return problems;
}

function refuseModel(opusId: string, problems: readonly OpusModelProblem[]): boolean {
  const blocking = problems.filter((problem) => problem.level !== "advise");
  if (blocking.length === 0) return false;
  console.error(blocking.map((problem) => `${opusId}: ${problem.rule}: ${problem.message}`).join("\n"));
  return true;
}

function unsafeOpusProblem(root: string, opusId: string): string | undefined {
  const inspected = readContainedRegularFile(root, `opera/${opusId}.md`, "opera");
  return "error" in inspected ? inspected.error : undefined;
}

function uiSourceProblem(root: string, manifest: Manifest, record: NativeRecord): string | undefined {
  if (record.kind !== "ui") return undefined;
  const gates = typeof record.probationes === "object" && record.probationes !== null && !Array.isArray(record.probationes)
    ? (record.probationes as Record<string, unknown>)
    : {};
  const served = typeof gates["served-e2e"] === "object" && gates["served-e2e"] !== null && !Array.isArray(gates["served-e2e"])
    ? (gates["served-e2e"] as Record<string, unknown>)
    : {};
  const expected = typeof served["certifies"] === "string" ? served["certifies"] : undefined;
  try {
    const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS }).trim();
    const studioRel = relative(repo, root);
    if (isAbsolute(studioRel) || studioRel.split(sep)[0] === "..") return "could not establish the current SOURCE tree";
    const exclusions = [studioRel.split(sep).join("/"), ".bisellium", ...(manifest.source_excludes ?? [])];
    if (isDirtyOutside(repo, exclusions)) return "current SOURCE tree is dirty";
    const actual = `tree:${sourceTreeHash(repo, exclusions, "HEAD")}`;
    return expected === actual ? undefined : `served-e2e certifies ${expected ?? "nothing"}, current SOURCE is ${actual}`;
  } catch (error) {
    return `current SOURCE tree is unavailable: ${(error as Error).message}`;
  }
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

  const now = resolveExactNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must match the exact UTC timestamp profile");
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
  const unsafeOpus = unsafeOpusProblem(root, opusId);
  if (unsafeOpus) {
    console.error(`${opusId}: opus.reference: ${unsafeOpus}`);
    return { exitCode: 2 };
  }

  // D-021 (W-033 round-1 A1): right after the record-existence check, before
  // any state/spec check, so a trunk caller gets the ownership message
  // rather than a "not greenlit or halted"/"no spec" refusal.
  const refusal = recordOwnerRefusal(root, opusId);
  if (refusal !== undefined) {
    console.error(refusal);
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
  const containedSpec = readContainedRegularFile(root, specRel, "briefs");
  if ("error" in containedSpec) {
    console.error(`${opusId}: no safe spec at ${specRel} — ${containedSpec.error}`);
    return { exitCode: 2 };
  }

  const sellaResult = resolveSella(values.get("--sella"), manifest, opusId, "ready");
  if (typeof sellaResult !== "string") {
    console.error(sellaResult.error);
    return { exitCode: 2 };
  }
  const sella = sellaResult;
  const hasSpecProbatio = manifest.probationes.some((p) => p.id === "spec");
  const currentFront = readFront<NativeRecord>(opusPath).data;
  const proposed: NativeRecord = {
    ...currentFront,
    spec: specRel,
    start: currentFront.start === undefined ? now.toISOString() : currentFront.start,
  };
  if (refuseModel(opusId, nativePreflight(root, manifest, opusId, proposed, "ready"))) return { exitCode: 1 };

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["spec"], specRel);
    if (hasSpecProbatio) {
      doc.setIn(["probationes", "spec", "sella"], sella);
      doc.setIn(["probationes", "spec", "status"], "passed");
      doc.setIn(["probationes", "spec", "evidence"], specRel);
      doc.setIn(["probationes", "spec", "at"], now.toISOString());
    }
    doc.setIn(["state"], "building");
    if (doc.get("start") === undefined) doc.set("start", now.toISOString());
    // A halt's exit conditions describe a state this opus is no longer in.
    for (const k of ["halted_at", "reason", "resume_when", "halted_by"]) doc.delete(k);
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

  const now = resolveExactNow(values.get("--now"), opts.now);
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
  // D-021 (W-033 round-1 A1): right after the record-existence check, before
  // any state/gate check, so a trunk caller gets the ownership message
  // rather than "not building, verifying or review" or a gate refusal.
  const unsafeDoneOpus = unsafeOpusProblem(root, opusId);
  if (unsafeDoneOpus) {
    console.error(`${opusId}: opus.reference: ${unsafeDoneOpus}`);
    return { exitCode: 2 };
  }
  const refusal = recordOwnerRefusal(root, opusId);
  if (refusal !== undefined) {
    console.error(refusal);
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

  if (refuseModel(opusId, nativePreflight(root, manifest, opusId, front as NativeRecord))) return { exitCode: 1 };
  const proposedDone: NativeRecord = { ...(front as NativeRecord), state: "done", end: now.toISOString() };
  if (refuseModel(opusId, nativePreflight(root, manifest, opusId, proposedDone, "done"))) return { exitCode: 1 };
  const sourceProblem = uiSourceProblem(root, manifest, front as NativeRecord);
  if (sourceProblem) {
    console.error(`${opusId}: opus.ui.e2e: ${sourceProblem}`);
    return { exitCode: 1 };
  }

  const recorded = front.probationes ?? {};
  const missing: string[] = [];
  // Per-gate refusal detail (W-034): the first line ("gates not passed: …")
  // names every refused gate id; this carries the *why* for a waived one —
  // never for an ordinary unrecorded/pending/failed/stale gate, which the
  // first line already explains completely.
  const detail: string[] = [];
  // Honourable human-gate waivers `done` actually honours — named
  // permanently on stdout (never a silent pass): "done (waived: patron by
  // D-900)". A waiver is never rewritten into a `passed`.
  const honoured: { id: string; decision: string }[] = [];
  const effective = effectiveProbationes(front.kind, manifest.probationes);
  if (refuseModel(opusId, effective.problems)) return { exitCode: 1 };
  for (const p of effective.probationes) {
    const rec = recorded[p.id];
    const status = typeof rec?.status === "string" ? rec.status : undefined;
    const certifies = typeof rec?.certifies === "string" ? rec.certifies : undefined;
    if (p.kind === "automated") {
      if (status === "waived") {
        missing.push(p.id);
        detail.push(
          `${p.id}: probatio.waived.automated — no CLI verb writes a waived automated gate; ` +
            `revert the out-of-band write with git, then run "bisellium verify"`,
        );
      } else if (status !== "passed" || !certifies?.startsWith("tree:")) {
        missing.push(p.id);
      }
    } else if (p.kind === "agent") {
      if (status === "waived") {
        missing.push(p.id);
        detail.push(`${p.id}: probatio.waived.agent`);
      } else if (status !== "passed") {
        missing.push(p.id);
      }
    } else if (p.kind === "human") {
      // An unrecorded human gate is not demanded — same asymmetry
      // check.ts's state.done.probationes rule already has.
      if (rec === undefined || status === "passed") continue;
      if (status === "waived") {
        const reason = rec.reason;
        const reasonOk = typeof reason === "string" && reason.trim().length > 0;
        const problem = reasonOk ? patronDecisionProblem(root, manifest, rec.waived_by) : `gate "${p.id}" waived with no reason`;
        if (problem === undefined) honoured.push({ id: p.id, decision: rec.waived_by as string });
        else {
          missing.push(p.id);
          detail.push(`${p.id}: ${problem}`);
        }
      } else {
        missing.push(p.id);
      }
    }
  }
  if (missing.length) {
    console.error([`${opusId}: gates not passed: ${missing.join(", ")}`, ...detail].join("\n"));
    return { exitCode: 1 };
  }

  const doneSellaResult = resolveSella(values.get("--sella"), manifest, opusId, "done");
  if (typeof doneSellaResult !== "string") {
    console.error(doneSellaResult.error);
    return { exitCode: 2 };
  }
  const sella = doneSellaResult;

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["state"], "done");
    doc.setIn(["end"], now.toISOString());
    return undefined;
  });

  emitEvent(root, manifest, "workflow.state_changed", now, {
    [WF.ITEM_ID]: opusId,
    [WF.STATE_FROM]: currentState,
    [WF.STATE_TO]: "done",
    [WF.ACTOR_ROLE]: sella,
  });

  const trace = honoured.length ? ` (waived: ${honoured.map((h) => `${h.id} by ${h.decision}`).join(", ")})` : "";
  console.log(`${opusId}: done${trace}`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 3. review — records a passed or failed review verdict (L-016)
// ---------------------------------------------------------------------------

const REVIEW_USAGE =
  "usage: bisellium review <opus> --pass|--fail --evidence <path> [--round <n>] [--sella <id>] [--model <id>] [--studio <dir>] [--now <iso>]";

export function runReview(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, {
    valued: ["--evidence", "--round", "--sella", "--model", "--studio", "--now"],
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

  const now = resolveExactNow(values.get("--now"), opts.now);
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

  const unsafeReviewOpus = unsafeOpusProblem(root, opusId);
  if (unsafeReviewOpus) {
    console.error(`${opusId}: opus.reference: ${unsafeReviewOpus}`);
    return { exitCode: 2 };
  }
  const refusal = recordOwnerRefusal(root, opusId);
  if (refusal !== undefined) {
    console.error(refusal);
    return { exitCode: 2 };
  }

  const containedEvidence = readContainedRegularFile(root, evidence, "ci");
  if ("error" in containedEvidence) {
    console.error(`${opusId}: --evidence "${evidence}" is unsafe or unreadable: ${containedEvidence.error}`);
    return { exitCode: 2 };
  }

  const currentState = readState(opusPath);
  if (typeof currentState !== "string") {
    console.error(currentState.error);
    return { exitCode: 2 };
  }

  const reviewProbatioId = (manifest as unknown as { review_probatio?: string }).review_probatio ?? "review";
  const reviewSellaResult = resolveSella(values.get("--sella"), manifest, opusId, "review");
  if (typeof reviewSellaResult !== "string") {
    console.error(reviewSellaResult.error);
    return { exitCode: 2 };
  }
  const sella = reviewSellaResult;
  if (pass) {
    const censor = censorSella(manifest);
    if (!censor) {
      console.error("review --pass cannot identify the manifest QA magister censor");
      return { exitCode: 2 };
    }
    if (sella !== censor) {
      console.error(`review --pass must be attributed to the censor ${censor}`);
      return { exitCode: 2 };
    }
  }
  const status = pass ? "passed" : "failed";
  const model = values.get("--model");
  const currentFront = readFront<NativeRecord>(opusPath).data;
  const currentGates =
    typeof currentFront.probationes === "object" && currentFront.probationes !== null && !Array.isArray(currentFront.probationes)
      ? (currentFront.probationes as Record<string, unknown>)
      : {};
  const proposedReview: NativeRecord = {
    ...currentFront,
    state: fail && (currentState === "review" || currentState === "done") ? "building" : currentState,
    ...(fail && currentState === "done" ? { end: undefined } : {}),
    probationes: {
      ...currentGates,
      [reviewProbatioId]: { status, evidence, sella, at: now.toISOString(), ...(model === undefined ? {} : { model }) },
    },
  };
  if (refuseModel(opusId, nativePreflight(root, manifest, opusId, proposedReview, pass ? "review" : "check"))) return { exitCode: 1 };
  if (pass) {
    const sourceProblem = uiSourceProblem(root, manifest, proposedReview);
    if (sourceProblem) {
      console.error(`${opusId}: opus.ui.e2e: ${sourceProblem}`);
      return { exitCode: 1 };
    }
  }

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["probationes", reviewProbatioId, "sella"], sella);
    doc.setIn(["probationes", reviewProbatioId, "status"], status);
    doc.setIn(["probationes", reviewProbatioId, "evidence"], evidence);
    doc.setIn(["probationes", reviewProbatioId, "at"], now.toISOString());
    // The model that actually executed the gate (D-014, process.review_tier)
    // — never inferred from the sella id, which is a declaration and can
    // diverge from what really ran (W-028 round 2, A5). Overwritten fully
    // on every recorded round exactly like sella/status/evidence/at above:
    // a round that omits --model must not leave a stale model from a
    // previous round attached to its own verdict.
    if (model !== undefined) doc.setIn(["probationes", reviewProbatioId, "model"], model);
    else doc.deleteIn(["probationes", reviewProbatioId, "model"]);
    // The decree's own return edge: a failed review on an opus in `review`
    // OR `done` sends it back to `building` — no other command can move it
    // there, and without this a `done` opus with a failed gate is stuck
    // forever (state.done.probationes fires and nothing reopens it — the
    // gap cascade 6's round-2 review exposed, F5). An opus already in
    // `building` (or anywhere else) keeps its state; `review` performs no
    // forward transition, that's `done`'s job.
    if (fail && (currentState === "review" || currentState === "done")) {
      doc.setIn(["state"], "building");
      doc.delete("end");
    }
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
  "usage: bisellium red <opus> --behaviour <n> [--sella <id>] [--studio <dir>] [--repo <dir>] [--cwd <dir>] [--now <iso>] -- <cmd…>";

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

/** Walks up from `dir` to the git repo containing it (`git rev-parse
 *  --show-toplevel`), or `undefined` when `dir` is not inside a work tree.
 *  The repo a red's `# tree:` header certifies is the one the wrapped
 *  command actually ran in — never assumed from wherever `--studio` happens
 *  to live (cascade 6 round-3, W-021 B2: a red certified the officina's own
 *  repo while the command it wrapped ran against a different worktree). */
function findGitRoot(dir: string): string | undefined {
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

/** Runs `cmd` (cwd: `--cwd` when given, else the caller's own), collecting
 *  stdout+stderr in the order the OS actually delivers them — real
 *  chronological combination, which is why this (unlike ready/done/review)
 *  has to be async. */
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

  const parsed = parseFlags(before, { valued: ["--behaviour", "--sella", "--studio", "--repo", "--cwd", "--now"] });
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

  const now = resolveExactNow(values.get("--now"), opts.now);
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

  // W-039: refused here, after safeRedsDir and before the tree hash,
  // runCapture and mkdirSync — no command runs and nothing is written for
  // an unattributed red. --sella guest is accepted deliberately: the
  // refusal targets anonymity, not the name guest.
  const namedResult = namedSella(values.get("--sella"), manifest, opusId, "red");
  if (namedResult === undefined) {
    console.error("red: no sella — pass --sella <id> or set $BISELLIUM_SELLA (use --sella guest to record as guest deliberately)");
    return { exitCode: 2 };
  }
  if (typeof namedResult !== "string") {
    console.error(namedResult.error);
    return { exitCode: 2 };
  }
  const sella = namedResult;
  const cwdFlag = values.get("--cwd");
  const execCwd = cwdFlag !== undefined ? resolve(cwdFlag) : process.cwd();

  // Same exclusion set verify.ts computes: the officina itself, .bisellium/,
  // and any manifest source_excludes — so red's own log write is never what
  // makes the tree it just certified "dirty". Only applies when the officina
  // actually lives inside the repo being hashed; a --cwd pointing at an
  // unrelated repo (the usual reason to pass --cwd at all) has nothing of
  // the officina's to exclude.
  function hashRepo(repoDir: string): string {
    try {
      const rel = relative(repoDir, root);
      const rootInside = !isAbsolute(rel) && rel.split(sep)[0] !== "..";
      const excludeDirs = rootInside ? [rel.split(sep).join("/"), ".bisellium", ...(manifest.source_excludes ?? [])] : [];
      const hash = sourceTreeHash(repoDir, excludeDirs, "HEAD");
      const dirty = isDirtyOutside(repoDir, excludeDirs);
      return `${dirty ? "dirty" : "tree"}:${hash}`;
    } catch {
      return "unknown";
    }
  }

  // `--repo` is an explicit override (unchanged): hash that repo, or
  // "unknown" when it isn't one. Without it, the tree a red certifies is
  // the repo containing the directory the command actually runs in — never
  // assumed from wherever `--studio` happens to live (the round-3 false
  // certificate, W-021 B2). With `--cwd` and no repo found there, that is
  // reported as "none" rather than silently falling back to something the
  // caller didn't ask for.
  let treeHeader: string;
  const repoFlag = values.get("--repo");
  if (repoFlag !== undefined) {
    const repo = resolve(repoFlag);
    treeHeader = isGitRepo(repo) ? hashRepo(repo) : "unknown";
  } else {
    const found = findGitRoot(execCwd);
    treeHeader = found === undefined ? (cwdFlag !== undefined ? "none" : "unknown") : hashRepo(found);
  }

  const { exitCode: cmdExit, output } = await runCapture(cmd, execCwd);

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

// ---------------------------------------------------------------------------
// 5. halt — any active state -> halted (W-042). Terminal ("abandon") is a
//    halt whose resume_when is "never" (see the brief's Intent): one verb,
//    one state id, no second terminal id to plumb through six readers.
// ---------------------------------------------------------------------------

const HALT_USAGE =
  "usage: bisellium halt <opus> --reason <text> --resume-when <text> --decision <id> [--sella <id>] [--studio <dir>] [--now <iso>]";

export function runHalt(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--reason", "--resume-when", "--decision", "--sella", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${HALT_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(HALT_USAGE);
    return { exitCode: 2 };
  }

  const reason = values.get("--reason");
  const resumeWhen = values.get("--resume-when");
  const decisionId = values.get("--decision");
  if (!reason || !resumeWhen || !decisionId) {
    console.error(HALT_USAGE);
    return { exitCode: 2 };
  }

  const now = resolveExactNow(values.get("--now"), opts.now);
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
  const unsafeHaltOpus = unsafeOpusProblem(root, opusId);
  if (unsafeHaltOpus) {
    console.error(`${opusId}: opus.reference: ${unsafeHaltOpus}`);
    return { exitCode: 2 };
  }

  // D-021 (W-033 round-1 A1): right after the record-existence check, before
  // any state check, so a trunk caller gets the ownership message rather
  // than "already halted"/"already done".
  const refusal = recordOwnerRefusal(root, opusId);
  if (refusal !== undefined) {
    console.error(refusal);
    return { exitCode: 2 };
  }

  const currentState = readState(opusPath);
  if (typeof currentState !== "string") {
    console.error(currentState.error);
    return { exitCode: 2 };
  }
  // Mirrors describeLifecycle's own transition table (every state but
  // `done` can reach `halted`), plus re-halting refused outright: it would
  // silently overwrite a recorded reason/decision with a new one, and
  // amending a halt in place is out of scope (see the brief).
  if (currentState === "done" || currentState === "halted") {
    console.error(`${opusId} is already ${currentState} — halt refused`);
    return { exitCode: 2 };
  }

  // D-008 containment via the shared helper — `--decision` is an id, not a
  // caller-supplied path, so this is safeItemPath (like --opus above), never
  // a fresh join() or ready's isContained (which is for paths).
  const decisionPath = safeItemPath(join(root, "decisions"), decisionId);
  if (typeof decisionPath !== "string" || !existsSync(decisionPath)) {
    console.error(`${opusId}: --decision "${decisionId}" not found under decisions/`);
    return { exitCode: 2 };
  }
  const containedDecision = readContainedRegularFile(root, `decisions/${decisionId}.md`, "decisions");
  if ("error" in containedDecision) {
    console.error(`${opusId}: --decision "${decisionId}" is unsafe: ${containedDecision.error}`);
    return { exitCode: 2 };
  }

  const haltSellaResult = resolveSella(values.get("--sella"), manifest, opusId, "halt");
  if (typeof haltSellaResult !== "string") {
    console.error(haltSellaResult.error);
    return { exitCode: 2 };
  }
  const sella = haltSellaResult;

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["state"], "halted");
    doc.setIn(["halted_at"], now.toISOString());
    doc.setIn(["reason"], reason);
    doc.setIn(["resume_when"], resumeWhen);
    doc.setIn(["halted_by"], decisionId);
    return undefined;
  });

  emitEvent(root, manifest, "workflow.state_changed", now, {
    [WF.ITEM_ID]: opusId,
    [WF.STATE_FROM]: currentState,
    [WF.STATE_TO]: "halted",
    [WF.ACTOR_ROLE]: sella,
  });

  console.log(`${opusId}: state=halted by=${decisionId}`);
  return { exitCode: 0 };
}

/**
 * Whether `decisionId` names an honourable Patron decision: a non-empty
 * string that `safeItemPath` resolves under `<root>/decisions` to a file
 * that exists, whose front matter parses, and whose `by` equals
 * `manifest.patron ?? "patron"`. Never throws — every failure comes back as
 * a problem string naming the decision id (or "waived_by" when there is no
 * usable id at all). The one predicate `runWaive` (step 9) and `runDone`'s
 * human-gate branch both call (studio/briefs/W-034.md, "One predicate, two
 * callers") — never re-derived at either call site.
 */
function patronDecisionProblem(root: string, manifest: Manifest, decisionId: unknown): string | undefined {
  if (typeof decisionId !== "string" || decisionId.trim().length === 0) return `waived_by is missing or not a string`;
  const decisionPath = safeItemPath(join(root, "decisions"), decisionId);
  if (typeof decisionPath !== "string" || !existsSync(decisionPath)) return `decision "${decisionId}" not found`;
  const contained = readContainedRegularFile(root, `decisions/${decisionId}.md`, "decisions");
  if ("error" in contained) return `decision "${decisionId}" is unsafe: ${contained.error}`;
  let data: Record<string, unknown>;
  try {
    data = readFront<Record<string, unknown>>(decisionPath).data;
  } catch {
    return `decision "${decisionId}" could not be read`;
  }
  const by = data["by"];
  if (typeof by !== "string" || by.length === 0) return `decision "${decisionId}" has no "by"`;
  const patronId = manifest.patron ?? "patron";
  if (by !== patronId) return `decision "${decisionId}" is by "${by}", not patron "${patronId}"`;
  return undefined;
}

// ---------------------------------------------------------------------------
// 6. waive — building|verifying|review: an honourable Patron waiver on a
//    kind: human gate only (W-034). The one writer of `status: waived`;
//    `runDone`'s human branch above is the one reader that trusts it.
// ---------------------------------------------------------------------------

const WAIVE_USAGE =
  "usage: bisellium waive <opus> --gate <id> --reason <text> --decision <id> [--sella <id>] [--studio <dir>] [--now <iso>]";

export function runWaive(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--gate", "--reason", "--decision", "--sella", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${WAIVE_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  const gateId = values.get("--gate");
  const reason = values.get("--reason");
  const decisionId = values.get("--decision");
  if (!opusId || !gateId || !reason || !reason.trim() || !decisionId) {
    console.error(WAIVE_USAGE);
    return { exitCode: 2 };
  }

  const now = resolveExactNow(values.get("--now"), opts.now);
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
  const unsafeWaiveOpus = unsafeOpusProblem(root, opusId);
  if (unsafeWaiveOpus) {
    console.error(`${opusId}: opus.reference: ${unsafeWaiveOpus}`);
    return { exitCode: 2 };
  }

  // D-021 (W-033 round-1 A1): right after the record-existence check, before
  // any state/gate/decision check, so a trunk caller gets the ownership
  // message rather than a deeper refusal (opus behaviour 7).
  const refusal = recordOwnerRefusal(root, opusId);
  if (refusal !== undefined) {
    console.error(refusal);
    return { exitCode: 2 };
  }

  const currentState = readState(opusPath);
  if (typeof currentState !== "string") {
    console.error(currentState.error);
    return { exitCode: 2 };
  }
  if (!DONE_FROM_STATES.has(currentState)) {
    console.error(`${opusId} is not building, verifying or review (state: ${currentState || "?"})`);
    return { exitCode: 2 };
  }

  const probatio = manifest.probationes.find((p) => p.id === gateId);
  if (!probatio) {
    console.error(`${opusId}: gate "${gateId}" not declared`);
    return { exitCode: 2 };
  }
  if (probatio.kind === "automated") {
    console.error(`${opusId}: gate "${gateId}" cannot be waived (probatio.waived.automated)`);
    return { exitCode: 2 };
  }
  if (probatio.kind === "agent") {
    console.error(`${opusId}: gate "${gateId}" cannot be waived (probatio.waived.agent)`);
    return { exitCode: 2 };
  }

  const front = readFront<OpusFront>(opusPath).data;
  const rec = (front.probationes ?? {})[gateId];
  const currentStatus = typeof rec?.status === "string" ? rec.status : undefined;
  if (currentStatus === "passed" || currentStatus === "failed" || currentStatus === "waived") {
    console.error(`${opusId}: gate "${gateId}" is already ${currentStatus}`);
    return { exitCode: 2 };
  }

  const problem = patronDecisionProblem(root, manifest, decisionId);
  if (problem !== undefined) {
    console.error(`${opusId}: ${problem}`);
    return { exitCode: 2 };
  }

  const waiveSellaResult = resolveSella(values.get("--sella"), manifest, opusId, "waive");
  if (typeof waiveSellaResult !== "string") {
    console.error(waiveSellaResult.error);
    return { exitCode: 2 };
  }
  const sella = waiveSellaResult;

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["probationes", gateId, "status"], "waived");
    doc.setIn(["probationes", gateId, "reason"], reason);
    doc.setIn(["probationes", gateId, "waived_by"], decisionId);
    doc.setIn(["probationes", gateId, "sella"], sella);
    doc.setIn(["probationes", gateId, "at"], now.toISOString());
    return undefined;
  });

  emitEvent(root, manifest, "workflow.gate_evaluated", now, {
    [WF.ITEM_ID]: opusId,
    [WF.GATE_ID]: gateId,
    [WF.GATE_STATUS]: "waived",
    [WF.GATE_EVIDENCE]: `decisions/${decisionId}.md`,
    [WF.ACTOR_ROLE]: sella,
  });

  console.log(`${opusId}: ${gateId} waived by ${decisionId}`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 7. amend — retitle or re-point an opus record's `spec:`, the one CLI path
//    for a descriptive field (W-062). Works in ANY state, done and halted
//    included: nothing here is a lifecycle transition, so there is no state
//    gate to weaken or duplicate. `state`/`probationes`/`traditio`/`id` are
//    evidence or identity, never amendable — refused by name below.
// ---------------------------------------------------------------------------

const AMEND_USAGE = "usage: bisellium amend <opus> [--title <text>] [--spec <path>] [--arc <id>] [--parent <id>] [--ui-ruling <decision-id>] --reason <text> [--sella <id>] [--studio <dir>] [--now <iso>]";

/** Never-amendable fields, refused by name before argv is even parsed (an
 *  exact-arg scan, so `--title "--state"` is also refused — harmless, since
 *  refusing a title that is literally a flag name costs nothing). Each names
 *  the verb that actually owns the field, so the refusal sends the caller
 *  somewhere real (D-016) rather than just closing a door. */
const NOT_AMENDABLE: [string, string][] = [
  ["--state", "state is lifecycle, not description — use greenlight/ready/done/halt, or review --fail to reopen"],
  ["--probationes", "a gate is evidence — it is produced by verify/review/waive, never amended"],
  ["--traditio", "a handoff records what happened at a moment — use handoff"],
  ["--id", "an id must equal its filename — that is a rename, not an amendment"],
];

/** Thrown only from inside the `editOpusFrontMatter` callback below, when a
 *  pre-existing `amendments:` key is not a YAML sequence (a scalar, a
 *  mapping, or an alias to something else — land 9, finding 11: the
 *  predicate runs on the Document node, not the parsed data, because an
 *  alias-backed sequence resolves through `parse()` to a real array while
 *  the Document keeps an unresolved `Alias` that `doc.addIn` rejects).
 *  Caught by name in `runAmend` alone and translated to exit 2; anything
 *  else the callback throws is a real bug and re-thrown untouched —
 *  `editOpusFrontMatter` only writes after the callback returns, so a throw
 *  from inside it leaves the file untouched either way. */
class AmendShapeError extends Error {}

export function runAmend(args: string[], opts: WriteOptions = {}): WriteResult {
  // Never-amendable fields, refused by name before argv is even parsed
  // (D-016 — the refusal is the point) and therefore before the D-021
  // ownership guard below: an exact-arg scan, so `--title "--state"` is also
  // refused (harmless). A never-amendable flag is wrong on every ref, so
  // sending a trunk caller to switch checkouts first would send them to do
  // work that changes nothing.
  for (const [flag, why] of NOT_AMENDABLE) {
    if (args.includes(flag)) {
      console.error(`amend: ${flag} is not amendable — ${why}`);
      return { exitCode: 2 };
    }
  }

  const parsed = parseFlags(args, { valued: ["--title", "--spec", "--arc", "--parent", "--ui-ruling", "--reason", "--sella", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${AMEND_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(AMEND_USAGE);
    return { exitCode: 2 };
  }

  const titleFlag = values.get("--title");
  const specFlag = values.get("--spec");
  const arcFlag = values.get("--arc");
  const parentFlag = values.get("--parent");
  const rulingFlag = values.get("--ui-ruling");
  if (titleFlag === undefined && specFlag === undefined && arcFlag === undefined && parentFlag === undefined && rulingFlag === undefined) {
    console.error(AMEND_USAGE);
    return { exitCode: 2 };
  }

  // W-040's rule, verbatim: the reason is the feature. Stored as given
  // (never trimmed) — only its emptiness is judged, the same asymmetry
  // --title gets below.
  const reason = values.get("--reason");
  if (reason === undefined || reason.trim() === "") {
    console.error(`amend: --reason is required and must be non-empty\n${AMEND_USAGE}`);
    return { exitCode: 2 };
  }

  // check.ts:432 requires a non-empty title — refused here at the source
  // rather than leaving it to a later opus.keys finding.
  const amendTitleProblem = titleFlag === undefined ? undefined : titleProblem(titleFlag);
  if (amendTitleProblem) {
    console.error(`amend: --title ${amendTitleProblem}`);
    return { exitCode: 2 };
  }

  // Land 8: an explicit --sella that is empty or whitespace is an assertion
  // of anonymity, not an omission, and is refused outright — never silently
  // written as a blank id that path.id.unvalidated would then block.
  const sellaFlag = values.get("--sella");
  if (sellaFlag !== undefined && sellaFlag.trim() === "") {
    console.error(`amend: --sella must not be blank — omit it to fall back to $BISELLIUM_SELLA or "guest"`);
    return { exitCode: 2 };
  }

  const now = resolveExactNow(values.get("--now"), opts.now);
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
  const unsafeAmendOpus = unsafeOpusProblem(root, opusId);
  if (unsafeAmendOpus) {
    console.error(`${opusId}: opus.reference: ${unsafeAmendOpus}`);
    return { exitCode: 2 };
  }

  // D-021, right after the record-existence check — the five siblings' own
  // ordering (the never-amendable scan above already ran, deliberately
  // ahead of this: see its own comment).
  const refusal = recordOwnerRefusal(root, opusId);
  if (refusal !== undefined) {
    console.error(refusal);
    return { exitCode: 2 };
  }

  const current = readFront<OpusFront>(opusPath).data;
  const currentTitle = typeof current.title === "string" ? current.title : undefined;
  const currentSpec = typeof current.spec === "string" ? current.spec : undefined;
  const currentArc = typeof current.arc === "string" ? current.arc : undefined;
  const currentParent = typeof current.parent === "string" ? current.parent : undefined;
  const currentRulings = Array.isArray(current.ui_rulings) ? current.ui_rulings.filter((value): value is string => typeof value === "string") : [];

  let specRel: string | undefined;
  if (specFlag !== undefined) {
    // --spec is an officina-relative path, and only that (land 10): reject
    // absolute first (even one that happens to sit inside the officina —
    // isContained alone would pass it, since resolve(root, "/abs") returns
    // the absolute path unchanged), then containment (D-008), then
    // existence, then "realpath is the path" (rev 3, finding 12): anchored
    // on the officina's own realpath so a symlinked $TMPDIR/home doesn't
    // reject everything. This subsumes rev 2's escape check (a symlink
    // pointing outside the officina is refused for being a symlink, before
    // its target's containment is even a question) and additionally catches
    // a symlink anywhere earlier in the path, not just the final component.
    if (isAbsolute(specFlag)) {
      console.error(`${opusId}: --spec "${specFlag}" must be officina-relative, not absolute`);
      return { exitCode: 2 };
    }
    if (!isContained(root, specFlag)) {
      console.error(`${opusId}: --spec "${specFlag}" resolves outside the officina (D-008) — refused`);
      return { exitCode: 2 };
    }
    const abs = join(root, specFlag);
    if (!existsSync(abs)) {
      console.error(`${opusId}: no spec at ${specFlag} — not ready`);
      return { exitCode: 2 };
    }
    const rootReal = realpathSync(root);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch (e) {
      console.error(`${opusId}: --spec "${specFlag}" could not be resolved: ${(e as Error).message}`);
      return { exitCode: 2 };
    }
    if (real !== join(rootReal, specFlag)) {
      console.error(`${opusId}: --spec "${specFlag}" reaches its target through a symlink — refused`);
      return { exitCode: 2 };
    }
    // Land 7: creating spec: from absent is not an amendment — "new
    // --spec"/"new --brief" and "ready" own the first value.
    if (currentSpec === undefined) {
      console.error(`amend: ${opusId} has no spec: to amend — the first pointer is written by "new --spec"/"new --brief" or by "ready"`);
      return { exitCode: 2 };
    }
    // Land 3: spec is compared by canonical resolved target, not string
    // equality — "briefs/W-1.md" and "./briefs/W-1.md" name one document,
    // and recording an amendment between them would fabricate a change that
    // never happened.
    if (resolve(root, specFlag) === resolve(root, currentSpec)) {
      console.error(`${opusId}: --spec "${specFlag}" names the same document as the current spec: — nothing to amend`);
      return { exitCode: 2 };
    }
    specRel = specFlag;
  }

  // Land 3: title is compared as an exact scalar — leading/trailing
  // whitespace is a real change to a displayed field.
  if (titleFlag !== undefined && currentTitle === titleFlag) {
    console.error(`${opusId}: --title is identical to the current title — nothing to amend`);
    return { exitCode: 2 };
  }
  if (arcFlag !== undefined && currentArc === arcFlag) {
    console.error(`${opusId}: --arc is identical to the current arc — nothing to amend`);
    return { exitCode: 2 };
  }
  if (parentFlag !== undefined && currentParent === parentFlag) {
    console.error(`${opusId}: --parent is identical to the current parent — nothing to amend`);
    return { exitCode: 2 };
  }
  if (rulingFlag !== undefined && currentRulings.includes(rulingFlag)) {
    console.error(`${opusId}: --ui-ruling ${rulingFlag} is already present — nothing to amend`);
    return { exitCode: 2 };
  }

  const proposedAmend: NativeRecord = {
    ...(current as NativeRecord),
    ...(titleFlag === undefined ? {} : { title: titleFlag }),
    ...(specRel === undefined ? {} : { spec: specRel }),
    ...(arcFlag === undefined ? {} : { arc: arcFlag }),
    ...(parentFlag === undefined ? {} : { parent: parentFlag }),
    ...(rulingFlag === undefined ? {} : { ui_rulings: [...currentRulings, rulingFlag] }),
  };
  if (refuseModel(opusId, nativePreflight(root, manifest, opusId, proposedAmend, "check", true))) return { exitCode: 1 };

  // Land 8: `namedSella` treats a blank $BISELLIUM_SELLA as unset (an
  // explicit blank --sella was already refused above), falling back to
  // "guest" here — the fallback chain the spec calls for, with no third
  // helper. W-089 behaviour 6: an explicitly-named but undeclared id is
  // still refused before any write.
  const amendNamedResult = namedSella(sellaFlag, manifest, opusId, "amend");
  if (typeof amendNamedResult !== "string" && amendNamedResult !== undefined) {
    console.error(amendNamedResult.error);
    return { exitCode: 2 };
  }
  const sella = amendNamedResult ?? "guest";

  // Both flags in one call append one entry per changed field, title first,
  // then spec, regardless of flag order — the record is deterministic
  // regardless of argv order.
  const fields: { field: "title" | "spec" | "arc" | "parent" | "ui_rulings"; value: unknown; superseded: unknown }[] = [];
  if (titleFlag !== undefined) fields.push({ field: "title", value: titleFlag, superseded: currentTitle ?? "" });
  if (specRel !== undefined) fields.push({ field: "spec", value: specRel, superseded: currentSpec ?? "" });
  if (arcFlag !== undefined) fields.push({ field: "arc", value: arcFlag, superseded: currentArc ?? "" });
  if (parentFlag !== undefined) fields.push({ field: "parent", value: parentFlag, superseded: currentParent ?? "" });
  if (rulingFlag !== undefined) fields.push({ field: "ui_rulings", value: [...currentRulings, rulingFlag], superseded: currentRulings });

  try {
    editOpusFrontMatter(opusPath, (doc) => {
      // Land 9 (finding 11 in rev 3): the preflight inspects the Document
      // node, not the parsed data — `isSeq` is false for an Alias, a
      // Scalar and a YAMLMap alike, which is what a bare `Array.isArray`
      // check on the resolved view would miss for an alias-backed sequence.
      const node = doc.getIn(["amendments"], true);
      if (node !== undefined && !isSeq(node)) {
        const kind = node === null ? "null" : (node as { constructor?: { name?: string } }).constructor?.name ?? typeof node;
        throw new AmendShapeError(`amend: ${opusId} amendments: is a ${kind}, not a sequence — refused`);
      }
      // `doc.addIn` needs the sequence to already be there; created through
      // the Document API (never string-splicing the front matter) only on
      // the first amendment.
      if (node === undefined) doc.setIn(["amendments"], doc.createNode([]));

      for (const f of fields) {
        doc.setIn([f.field], f.value);
        doc.addIn(["amendments"], { at: now.toISOString(), sella, field: f.field, reason, superseded: f.superseded });
      }
      return undefined;
    });
  } catch (e) {
    if (e instanceof AmendShapeError) {
      console.error(e.message);
      return { exitCode: 2 };
    }
    throw e;
  }

  // One workflow.item_amended per amended field (bare "field"/"reason"
  // attrs, the precedent is greenlight's bare "reason" — writes.ts:808). No
  // workflow.state_changed: nothing changed state. Not appended to the
  // Patron timeline — an architect retitling an opus is not a Patron act,
  // and the record's own amendments list is the permanent, shared home.
  for (const f of fields) {
    emitEvent(root, manifest, "workflow.item_amended", now, {
      [WF.ITEM_ID]: opusId,
      [WF.ACTOR_ROLE]: sella,
      field: f.field,
      reason,
    });
  }

  console.log(`${opusId}: amended ${fields.map((f) => f.field).join(", ")}`);
  return { exitCode: 0 };
}
