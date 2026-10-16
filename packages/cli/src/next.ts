/**
 * packages/cli/src/next.ts — W-124: `bisellium next <opus>`, the cascade order
 * as a verb. From the record and its evidence alone it derives the ONE legal
 * next step of the thirteen-rung ladder (`STEPS`), names it (exact command or
 * dispatch order) or, with `--perform`, performs it, and refuses to skip.
 *
 * Read-only unless `--perform` or `--track` is given (W-233: in a studio that sets
 * `step_tickets: required`, report mode and `--perform` also write or delete the
 * pending ticket under `<git common dir>/bisellium/tickets/`). Trunk-side evidence (the
 * brief, spec log, `done`, checkpoint) is read from the COMMITTED `refs/heads/
 * master` with `git show`; opus-branch evidence from the opus's registered
 * worktree `<repo>/.worktrees/<id>` (or the branch ref when it has none). It
 * runs from the repository's main checkout. The PR rungs live in
 * `integrate.ts`; the merge predicate in `@bisellium/commands/trunk.js`.
 *
 * Step health is computed from evidence only: a verb-written marker under
 * `<repo>/.bisellium/steps/`, the marker pid's `/proc/<pid>/stat` start time
 * (a reused pid reads dead) and the output file's mtime against the clock.
 * Anything it cannot prove (an unreadable or unparseable `/proc` entry) is
 * `unknown`, which is `held`, never `dead`. `BISELLIUM_TEST_PROC` replaces
 * `/proc` for EVERY health read (including the verb's own `/proc/self/stat`),
 * honoured only when `BISELLIUM_TEST_CLOCK=1` is also set; so is `--now`.
 */
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseFrontMatter, readManifest, resolveSeat, type Manifest } from "@bisellium/adapter-native";
import { sourceTreeHash } from "@bisellium/shim";
import { admitCurrentRunReceipt } from "@bisellium/commands/builder-run.js";
import { censorSella, effectiveProbationes, inspectUiDesignInput, readContainedRegularFile, type NativeRecord } from "@bisellium/commands/opus-model.js";
import { readBriefForm, readBriefLimit, readRedOrder } from "@bisellium/commands/brief-admission.js";
import { briefAdmissionProblems } from "@bisellium/commands/lifecycle.js";
import { SESSION_ID, buildReviewDrift, parseVerdictLog, readBuildReviewConfig, readBuildRounds, readSourceExcludes, readWorktreeManifest, type BuildReviewConfig, type BuildReviewRound } from "@bisellium/commands/verdict.js";
import { actionFacts, readStepTickets, setPendingTicket, type TicketAction } from "@bisellium/commands/ticket.js";
import { mintDispatchSella, openStudio, parseFlags, safeItemPath } from "@bisellium/commands/writes.js";
import { createOpusBranch } from "./branch.js";
import { ID_RE } from "./check.js";
import { clean, cleanup, dirtyHold, git, identifyPr, landHead, MIN_CHECKS, mergeGate, mergeRefusal, openPr, opusWorktree, quoted, readTip, settleMerged, touched, trackedChanges, type Ctx, type TipRead, type Pr, type PrRead, type StepResult } from "./integrate.js";
import { runDone, runReady } from "./lifecycle.js";
import { owedRetros } from "./retro.js";
import { checkEvidence, countBehaviours, isModuleLoadFailure, parseLogHeader } from "./rules/evidence.js";
import { handoffInputs, sessionHandoffFindings } from "./rules/process.js";
import { instant } from "@bisellium/schema";

export { MIN_CHECKS };

export const STEPS = ["greenlight", "spec", "branch", "ready", "reds", "build", "review", "pr", "merge", "cleanup", "done", "retro", "checkpoint"] as const;
export type Step = (typeof STEPS)[number];
export const DISPATCH_TOKEN_CAP = 500_000;
/** Seconds of output silence after which a live step reads stalled (`dead`). */
export const STEP_SILENCE_SECONDS: Record<Step, number> = {
  greenlight: 120,
  spec: 1800,
  branch: 120,
  ready: 120,
  reds: 1800,
  build: 1800,
  review: 1800,
  pr: 300,
  merge: 120,
  cleanup: 120,
  done: 120,
  retro: 1800,
  checkpoint: 120,
};

const NEXT_USAGE =
  "usage: bisellium next <opus> [--perform] [--expect <step>] [--budget <tokens>] [--title <text> --body-file <path>] [--poll-ms <n>] [--max-polls <n>] [--studio <dir>] [--repo <dir>] [--now <iso>]\n" +
  "       bisellium next <opus> --track <step> --pid <n> --output <path> [--studio <dir>] [--repo <dir>] [--now <iso>]";

const TRUNK = "refs/heads/master";
const HANDOFF = "docs/SESSION-HANDOFF.md";
const PERFORMABLE = new Set<Step>(["branch", "ready", "pr", "merge", "cleanup", "done", "spec"]);
const SECTIONS = ["Intent", "Files owned", "Interfaces", "Behaviours to test", "Acceptance", "Out of scope"];
const LIGHT_SECTIONS = ["Intent", "Files owned", "Behaviours to test", "Acceptance"];
const PAST_READY = new Set(["building", "verifying", "review", "done"]);
/** W-162: the one model the spec reviewer may be. Another codex model is not close enough. */
const REVIEWER_MODEL = "gpt-5.6-sol";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const one = (text: string): string => text.replace(/\s+/g, " ").trim();
const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const recordRel = (id: string): string => `opera/${id}.md`;
const briefRel = (id: string): string => `briefs/${id}.md`;
const pad = (n: number): string => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// evidence sources
// ---------------------------------------------------------------------------

/** A studio-relative reader: the committed trunk, an opus branch ref, or a checked-out worktree. */
interface Src {
  read(rel: string): string | undefined;
  list(dir: string): string[];
}
const badRel = (rel: string): boolean => rel === "" || isAbsolute(rel) || rel.split("/").some((p) => p === "" || p === "." || p === "..");

function gitSrc(repo: string, ref: string, studioRel: string): Src {
  return {
    read: (rel) => {
      if (badRel(rel)) return undefined;
      const r = git(repo, ["show", `${ref}:${studioRel}/${rel}`]);
      return r.status === 0 ? r.stdout : undefined;
    },
    list: (dir) => {
      if (badRel(dir)) return [];
      const r = git(repo, ["ls-tree", "--name-only", ref, `${studioRel}/${dir}/`]);
      return r.status === 0 ? r.stdout.split("\n").filter(Boolean).map((p) => p.slice(p.lastIndexOf("/") + 1)) : [];
    },
  };
}
function fsSrc(root: string): Src {
  return {
    read: (rel) => {
      if (badRel(rel)) return undefined;
      const c = readContainedRegularFile(root, rel, rel.split("/")[0]!);
      return "error" in c ? undefined : c.bytes.toString("utf8");
    },
    list: (dir) => {
      if (badRel(dir)) return [];
      try {
        return readdirSync(join(root, dir));
      } catch {
        return [];
      }
    },
  };
}
function recordOf(src: Src | undefined, id: string): Dict | undefined {
  const text = src?.read(recordRel(id));
  if (text === undefined) return undefined;
  try {
    const data = parseFrontMatter<unknown>(text, recordRel(id)).data;
    return isDict(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

interface SpecReviewer {
  sella: string;
  model: typeof REVIEWER_MODEL;
  design: string;
}
/** Where the ordered architect/reviewer sequence of a source stands (only with a reviewer configured). */
type SpecGate = { kind: "signature" } | { kind: "review"; signature: string; brief: string } | { kind: "failed"; review: string; failed: string[] } | { kind: "ready"; review: string } | { kind: "split"; failed: string[] } | { kind: "invalid" };
interface SpecEvidence {
  ok: boolean;
  why: string;
  sella?: string;
  log?: string;
  maxRound: number;
  anyLog: boolean;
  gate?: SpecGate;
}

/** Every row of a manifest list with this id: a domain that says "exactly one" counts them, never takes the first. */
const declared = (list: unknown, id: string): Dict[] => (Array.isArray(list) ? list : []).filter((r): r is Dict => isDict(r) && r["id"] === id);

/**
 * W-162: the one reader of `bisellium.yml#spec_reviewer`. Absent keeps today's ladder; anything else must name one
 * declared, live codex agent on exactly `gpt-5.6-sol` who is not the design magister, or `next` holds at `spec`.
 * The trunk record's state says whether the gate still applies: `greenlit` yes, a PAST_READY state passed it at `ready`.
 */
export function readSpecReviewer(manifest: Manifest, rec: Dict): { reviewer: SpecReviewer | undefined } | { error: string } {
  const m: unknown = manifest;
  // a studio with no readable manifest object declares no setting: today's ladder
  if (!isDict(m) || !("spec_reviewer" in m)) return { reviewer: undefined };
  const bad = (why: string): { error: string } => ({ error: `bisellium.yml#spec_reviewer: ${why}` });
  const sella = str(m["spec_reviewer"]);
  if (sella === undefined) return bad("must be the id of one declared seat (a non-empty string)");
  const rows = declared(m["sellae"], sella);
  const row = rows[0];
  if (row === undefined) return bad(`${sella} is not a declared seat`);
  if (rows.length > 1) return bad(`${sella} is declared ${rows.length} times; the reviewer must be one seat`);
  if (row["retired"] !== undefined && row["retired"] !== false) return bad(`${sella} is retired; the reviewer must be a live seat`);
  if (row["kind"] !== "agent") return bad(`${sella} must be kind: agent`);
  if (row["harness"] !== "codex") return bad(`${sella} must be on the codex harness`);
  if (row["model"] !== REVIEWER_MODEL) return bad(`${sella} must declare model ${REVIEWER_MODEL}, exactly`);
  const designs = declared(m["collegia"], "design");
  if (designs.length > 1) return bad(`the design collegium is declared ${designs.length} times; exactly one row names the magister`);
  const magister = str(designs[0]?.["magister"]);
  if (magister === undefined) return bad("the design collegium declares no magister to sign the spec");
  if (magister === sella) return bad(`${sella} is the design magister; the reviewer must be another seat`);
  const state = str(rec["state"]);
  if (state !== undefined && PAST_READY.has(state)) return { reviewer: undefined };
  if (state !== "greenlit") return bad(`the trunk record's state ${state ?? "(absent)"} is outside the gate's domain`);
  if (rec["kind"] === "ui") return bad("a kind: ui opus cannot take a spec review yet: the spec-phase verdict writer reserves every UI verdict for ui-lead, and authoritativeUiInput reads the highest spec log as the UI input");
  return { reviewer: { sella, model: REVIEWER_MODEL, design: magister } };
}

/** The brief with the six design-lex sections AND a passing architect spec log; with a reviewer, that signature then awaits its review. */
function specEvidence(src: Src | undefined, id: string, design: string, reviewer: SpecReviewer | undefined, admit: (brief: string) => string[]): SpecEvidence {
  return reviewer === undefined ? signedSpec(src, id, design, admit) : reviewedSpec(src, id, reviewer, admit);
}

const hasSections = (brief: string, names: string[]): boolean => names.every((s) => new RegExp(`^##\\s+${esc(s)}\\s*$`, "im").test(brief));

/**
 * W-255 (D-063 §4): why a brief fails the signature gates' sections, or undefined. A brief marked `Brief: light` needs the four
 * light sections and `admit`'s problems (a declared limit, admission, the Red order line); anything else is full and needs the
 * six. A marker that `readBriefForm` refuses is that error, never a full brief.
 */
function specSectionsProblem(brief: string | undefined, rel: string, admit: (brief: string) => string[]): string | undefined {
  const full = `${rel} is missing or lacks the six design-lex sections`;
  if (brief === undefined) return full;
  const form = readBriefForm(brief);
  if ("error" in form) return `${rel} ${form.error}`;
  if (!form.light) return hasSections(brief, SECTIONS) ? undefined : full;
  if (!hasSections(brief, LIGHT_SECTIONS)) return `${rel} lacks the four light-brief sections`;
  const problems = admit(brief);
  return problems.length > 0 ? `${rel} ${problems.join("; ")}` : undefined;
}

/** W-255: what a light brief must also satisfy, built once per derivation: the declared limit and `ready`'s admission, then the Red order line. */
function lightAdmission(f: Facts): (brief: string) => string[] {
  return (brief) => {
    const limit = readBriefLimit(f.manifest.brief_behaviour_limit);
    if ("error" in limit) return [limit.error];
    if (limit.limit === undefined) return ['"Brief: light" needs a declared brief_behaviour_limit (W-264)'];
    const order = readRedOrder(brief);
    return [
      ...briefAdmissionProblems(f.studioAbs, f.manifest, f.id, brief, limit.limit),
      ...("error" in order ? [order.error] : order.declared ? [] : ['declares no red order; add the line "Red order: one at a time"']),
    ];
  };
}

/** The git blob sha1 of a brief's text as a source returns it, encoded as UTF-8: the W-126 pin. */
const blobOf = (text: string): string => {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
};
type Parsed = Exclude<ReturnType<typeof parseVerdictLog>, { error: string }>;
/** What every spec log must be, signature or review: exactly one of each required header, this phase, round, sella and brief blob. */
function specLogProblem(p: Parsed, rel: string, round: number, sella: string, brief: string, required: string[]): string | undefined {
  const bad = (why: string): string => `${rel}: ${why}`;
  const once = (key: string): string | undefined => (p.headers.get(key)?.length === 1 ? p.headers.get(key)![0] : undefined);
  for (const key of [...required, "brief"]) if (p.headers.get(key)?.length !== 1) return bad(`the header "# ${key}:" must appear exactly once`);
  if (once("phase") !== "spec") return bad("the header \"# phase:\" must be spec");
  if (once("round") !== String(round)) return bad(`the header "# round:" must equal the filename's round ${round}`);
  if (once("sella") !== sella) return bad(`the header "# sella:" must be ${sella}`);
  if (once("brief") !== brief) return bad(`the header "# brief:" must be "${brief}" (the brief changed, or this log names another one)`);
  return undefined;
}
const standingBlocker = (p: Parsed): boolean => p.findings.some((f) => f.blocking);

/** An architect signature: strict syntax, the design magister, exactly `passed`, no standing blocker. */
function readSpecSignature(text: string, id: string, round: number, design: string, brief: string, rel: string): { round: number; log: string } | { error: string } {
  const p = parseVerdictLog(text, id, rel);
  if ("error" in p) return p;
  const problem = specLogProblem(p, rel, round, design, brief, ["phase", "round", "sella", "outcome"]);
  if (problem !== undefined) return { error: problem };
  if (p.headers.get("outcome")![0] !== "passed") return { error: `${rel}: a signature's outcome must be exactly passed` };
  if (standingBlocker(p)) return { error: `${rel}: a signature records a standing blocking finding` };
  return { round, log: rel };
}

/** A spec review: strict syntax, the configured reviewer and exact model, `passed` or `failed`, findings that agree with it. */
function readSpecReview(text: string, id: string, round: number, reviewer: SpecReviewer, brief: string, rel: string): { round: number; log: string; outcome: "passed" | "failed" } | { error: string } {
  const p = parseVerdictLog(text, id, rel);
  if ("error" in p) return p;
  const problem = specLogProblem(p, rel, round, reviewer.sella, brief, ["phase", "round", "sella", "model", "outcome"]);
  if (problem !== undefined) return { error: problem };
  if (p.headers.get("model")![0] !== reviewer.model) return { error: `${rel}: the header "# model:" must be ${reviewer.model}, exactly` };
  const outcome = p.headers.get("outcome")![0];
  if (outcome !== "passed" && outcome !== "failed") return { error: `${rel}: a review's outcome must be exactly passed or failed` };
  if (outcome === "passed" && standingBlocker(p)) return { error: `${rel}: outcome passed beside a standing blocking finding` };
  if (outcome === "failed" && !standingBlocker(p)) return { error: `${rel}: outcome failed with no blocking finding` };
  const unchecked = p.findings.find((f) => !/\bcheck: \S/.test(f.text));
  if (unchecked !== undefined) return { error: `${rel}: finding ${unchecked.n} names no check ("check: <value>")` };
  return { round, log: rel, outcome };
}

/**
 * The reviewer-configured reading of one source (W-162): every `<id>-spec-` entry is judged, the newest valid
 * architect signature naming the current brief anchors the sequence, and every log above it must be that
 * signature's one valid review. Logs at or below the anchor are history: only their names were checked.
 */
/** The `# brief:` value a spec log carries once, which `readSpecReview` and `readSpecSignature` judge the log against. */
function ownBrief(text: string, id: string, rel: string): string {
  const p = parseVerdictLog(text, id, rel);
  return "error" in p ? "" : (p.headers.get("brief")?.length === 1 ? p.headers.get("brief")![0]! : "");
}

/**
 * D-061 §4: the failed spec reviews counted since the newest re-spec (D-063 §7), ascending. The count begins above the newer of
 * the newest passed review and the newest signature that stood by the split: one with two failed reviews below it, followed by
 * another signature. The newest signature never ends the count. Each log is read by the strict readers against its own brief.
 */
function failedSpecReviews(read: { n: number; rel: string; text: string | undefined }[], id: string, reviewer: SpecReviewer): string[] {
  const signed = read.map((l) => l.text !== undefined && !("error" in readSpecSignature(l.text, id, l.n, reviewer.design, ownBrief(l.text, id, l.rel), l.rel)));
  let failed: string[] = [];
  read.forEach((l, i) => {
    if (l.text === undefined) return;
    if (signed[i]) {
      if (failed.length >= 2 && signed[i + 1] === true) failed = [];
      return;
    }
    const r = readSpecReview(l.text, id, l.n, reviewer, ownBrief(l.text, id, l.rel), l.rel);
    if ("error" in r) return;
    if (r.outcome === "passed") failed = [];
    else failed.push(l.rel);
  });
  return failed;
}

function reviewedSpec(src: Src | undefined, id: string, reviewer: SpecReviewer, admit: (brief: string) => string[]): SpecEvidence {
  if (src === undefined) return { ok: false, why: "no signed spec on the committed trunk", maxRound: 0, anyLog: false, gate: { kind: "signature" } };
  const names = src.list("ci").filter((name) => name.startsWith(`${id}-spec-`));
  const logs: { n: number; rel: string }[] = [];
  let badName: string | undefined;
  for (const name of names) {
    const m = new RegExp(`^${esc(id)}-spec-([1-9][0-9]*)\\.log$`).exec(name);
    if (m === null) badName ??= name;
    else logs.push({ n: Number(m[1]), rel: `ci/${name}` });
  }
  logs.sort((a, b) => a.n - b.n);
  const result = (why: string, gate: SpecGate): SpecEvidence => ({ ok: false, why, maxRound: Math.max(0, ...logs.map((l) => l.n)), anyLog: names.length > 0, gate });
  if (badName !== undefined) return result(`ci/${badName}: a spec log is named ${id}-spec-<n>.log, n a positive integer with no leading zero`, { kind: "invalid" });
  const brief = src.read(briefRel(id));
  const sections = specSectionsProblem(brief, briefRel(id), admit);
  if (brief === undefined || sections !== undefined) return result(sections ?? "", { kind: "signature" });
  const expected = `${briefRel(id)} blob:${blobOf(brief)}`;
  const read = logs.map((l) => ({ ...l, text: src.read(l.rel) }));
  const anchor = [...read].reverse().find((l) => l.text !== undefined && !("error" in readSpecSignature(l.text, id, l.n, reviewer.design, expected, l.rel)));
  if (anchor === undefined) return result(`no ${reviewer.design} signature names the current ${briefRel(id)} (ci/${id}-spec-<n>.log, phase spec, passed)`, { kind: "signature" });
  const above = read.filter((l) => l.n > anchor.n);
  const reviews: { round: number; log: string; outcome: "passed" | "failed" }[] = [];
  for (const l of above) {
    const r = l.text === undefined ? { error: `${l.rel} is unreadable` } : readSpecReview(l.text, id, l.n, reviewer, expected, l.rel);
    if ("error" in r) return result(r.error, { kind: "invalid" });
    reviews.push(r);
  }
  const signed = (gate: SpecGate, why: string): SpecEvidence => ({ ...result(why, gate), sella: reviewer.design, log: anchor.rel });
  const review = reviews[0];
  const failed = failedSpecReviews(read, id, reviewer);
  if (review === undefined && failed.length >= 2) return { ...signed({ kind: "split", failed }, `${briefRel(id)}, ${anchor.rel} stand without a third review (D-061 §4)`), ok: true };
  if (review === undefined) return signed({ kind: "review", signature: anchor.rel, brief }, `${anchor.rel} is signed and awaits the spec review`);
  if (reviews.length > 1) return result(`${reviews[1]!.log} is a second reviewer verdict after ${anchor.rel} with no signature between them; a newer signature must come first`, { kind: "invalid" });
  if (review.outcome === "failed") return signed({ kind: "failed", review: review.log, failed }, `${review.log} failed ${anchor.rel}; the architect revises and signs again`);
  return { ...signed({ kind: "ready", review: review.log }, `${briefRel(id)}, ${anchor.rel} and ${review.log} are the signed, reviewed spec`), ok: true };
}
function signedSpec(src: Src | undefined, id: string, design: string, admit: (brief: string) => string[]): SpecEvidence {
  const none: SpecEvidence = { ok: false, why: "no signed spec on the committed trunk", maxRound: 0, anyLog: false };
  if (src === undefined) return none;
  const brief = src.read(briefRel(id));
  const sections = specSectionsProblem(brief, briefRel(id), admit);
  let maxRound = 0;
  let anyLog = false;
  let best: { n: number; sella: string; log: string } | undefined;
  for (const name of src.list("ci")) {
    const m = new RegExp(`^${esc(id)}-spec-([1-9][0-9]*)\\.log$`).exec(name);
    if (m === null) continue;
    anyLog = true;
    const n = Number(m[1]);
    maxRound = Math.max(maxRound, n);
    const h = parseLogHeader(src.read(`ci/${name}`) ?? "");
    if (h.get("phase") === "spec" && h.get("opus") === id && h.get("sella") === design && (h.get("outcome") ?? "").startsWith("passed") && (best === undefined || n > best.n)) best = { n, sella: design, log: `ci/${name}` };
  }
  if (sections !== undefined) return { ...none, why: sections, maxRound, anyLog };
  if (best === undefined) return { ...none, why: `no passing ${design} spec log (ci/${id}-spec-<n>.log with phase spec)`, maxRound, anyLog };
  return { ok: true, why: `${briefRel(id)} and ${best.log} are on the trunk`, sella: best.sella, log: best.log, maxRound, anyLog };
}

// ---------------------------------------------------------------------------
// facts
// ---------------------------------------------------------------------------

type PrClass =
  | { kind: "held"; reason: string }
  | { kind: "none" }
  | { kind: "open"; pr: Pr }
  | { kind: "open-stale"; pr: Pr }
  | { kind: "settled"; pr: Pr }
  | { kind: "behind"; pr: Pr; reason: string }
  | { kind: "unrelated"; pr: Pr; reason: string };

export interface Facts {
  id: string;
  repo: string;
  studioRel: string;
  studioAbs: string;
  excludes: string[];
  design: string;
  tip: string | undefined;
  /** The tip as read: an unreadable ref is an error, never an absent branch. */
  tipRead?: TipRead;
  wt: { dir: string; studio: string; usable: boolean };
  trunk: Src | undefined;
  trunkRecord: Dict | undefined;
  /** the oldest master commit that reads the record `done` also changed docs/SESSION-HANDOFF.md */
  checkpointed(): boolean;
  /** every automated probatio has a `tree:` certificate on the trunk record or the main checkout's record */
  certified(): boolean;
  branch: Src | undefined;
  branchRecord: Dict | undefined;
  specBranch: Src | undefined;
  choreDone: boolean;
  handoff: string | undefined;
  residue: boolean;
  /** the branch has been pushed (a remote-tracking ref exists), so a PR may exist */
  pushed: boolean;
  manifest: Manifest;
  curTree(): string | undefined;
  /** W-167: the review configuration and every strictly read build-review round, or why they cannot be read (held, never zero rounds) */
  buildRounds(): { config: BuildReviewConfig; rounds: BuildReviewRound[] } | { error: string };
  receipt(): { ok: true } | { ok: false; error: string } | undefined;
  redFindings(): string[];
  uiSpecProblems(): string[];
  uiReviewProblems(): string[];
  /** the authoritative ui-lead input (`ci/<id>-spec-<n>.log`) of a kind: ui opus whose branch carries a valid one */
  uiReviewInput(): string | undefined;
  pr(): PrClass;
  /** the retros owed (D-039 §1), or why the `retro` setting cannot be read; the one reader is `owedRetros` */
  owed(): { owed: string[] } | { error: string };
  /** newest `# at:` among the opus's reds and review logs, in ms */
  evidenceAt(): number;
  /** W-206: why the worktree's ci/ cannot be listed (absent is no problem) */
  wtCiProblem(): string | undefined;
  /** W-206: the worktree's changed paths (porcelain, untracked included), split into the brief and spec logs, and the rest */
  wtChanges(): { spec: string[]; other: string[]; bad: string[] } | { error: string };
}

function memo<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}
/** The automated gates an opus must certify: the manifest's, plus a UI opus's implicit `served-e2e` (W-096), as `verify` and `check` count them. */
const automatedGates = (manifest: Manifest, rec: Dict | undefined): string[] =>
  effectiveProbationes(rec?.["kind"], manifest.probationes)
    .probationes.filter((p) => p.kind === "automated")
    .map((p) => p.id);
type Certificate = { ok: true; stage: string[] } | { ok: false; why: string };
/**
 * The certificates a done commit carries. The WORKING record is the one committed, so it alone is judged; the
 * gates are those of the stricter of its kind and the trunk's (a `ui` -> `opus` drift keeps `served-e2e`). Each
 * gate must be `passed` at the merged trunk's own source tree, and its recorded evidence must be a readable
 * regular file named `ci/<id>-<gate>-<hex>.log` that git tracks or can stage. `stage` lists the untracked ones.
 * Anything missing, unreadable or unlistable is a refusal, never an omission.
 */
function certificate(repo: string, studioRel: string, studioAbs: string, excludes: string[], manifest: Manifest, trunkRecord: Dict | undefined, id: string): Certificate {
  let want: string;
  try {
    want = `tree:${sourceTreeHash(repo, excludes, TRUNK)}`;
  } catch {
    return { ok: false, why: "could not hash the trunk's source tree" };
  }
  const rec = recordOf(fsSrc(studioAbs), id);
  const gates = [...new Set([...automatedGates(manifest, rec), ...automatedGates(manifest, trunkRecord)])];
  const stage: string[] = [];
  for (const gate of gates) {
    const g = isDict(rec?.["probationes"]) ? rec["probationes"][gate] : undefined;
    if (!isDict(g) || g["status"] !== "passed" || g["certifies"] !== want) return { ok: false, why: `${gate} is not passed at the trunk's source tree` };
    const evidence = str(g["evidence"]);
    if (evidence === undefined || !new RegExp(`^ci/${esc(id)}-${esc(gate)}-[0-9a-f]+\\.log$`).test(evidence)) return { ok: false, why: `${gate} records no evidence of the form ci/${id}-${gate}-<hex>.log` };
    if ("error" in readContainedRegularFile(studioAbs, evidence, "ci")) return { ok: false, why: `${gate}'s evidence ${evidence} is not a readable regular file` };
    const rel = `${studioRel}/${evidence}`;
    const tracked = git(repo, ["ls-files", "-z", "--", rel]);
    if (tracked.status !== 0) return { ok: false, why: `could not list ${rel}` };
    if (tracked.stdout !== "") continue;
    const fresh = git(repo, ["ls-files", "--others", "--exclude-standard", "-z", "--", rel]);
    if (fresh.status !== 0) return { ok: false, why: `could not list ${rel}` };
    if (fresh.stdout === "") return { ok: false, why: `${gate}'s evidence ${rel} is neither tracked nor stageable` };
    stage.push(rel);
  }
  return { ok: true, stage };
}
const refExists = (repo: string, ref: string): boolean => git(repo, ["show-ref", "--verify", "-q", ref]).status === 0;

export function gather(repo: string, studioAbs: string, id: string): Facts {
  const manifest = readManifest(studioAbs);
  const realRepo = realpathSync(repo);
  const studioRel = relative(realRepo, realpathSync(studioAbs)).split("\\").join("/");
  // W-166: only the validated list is spread; `runNext` holds on a malformed one before it gets here.
  const declaredExcludes = readSourceExcludes(manifest);
  const excludes = [studioRel, ".bisellium", ...("excludes" in declaredExcludes ? declaredExcludes.excludes : [])];
  const design = manifest.collegia.find((c) => c.id === "design")?.magister ?? "architect";
  const branchRef = `refs/heads/opus/${id}`;
  const tipRead = readTip(repo, id);
  const tip = tipRead.kind === "tip" ? tipRead.oid : undefined;
  const { dir, entry } = opusWorktree(repo, id);
  const usable = entry !== undefined && entry.branch === branchRef && !entry.prunable && statSafe(dir);
  const wt = { dir, studio: join(dir, studioRel), usable };
  const trunk = refExists(repo, "refs/heads/master") ? gitSrc(repo, "refs/heads/master", studioRel) : undefined;
  const branch = usable ? fsSrc(wt.studio) : tip !== undefined ? gitSrc(repo, branchRef, studioRel) : undefined;
  const trunkRecord = recordOf(trunk, id);
  const branchRecord = recordOf(branch, id);
  const remoteTracking = refExists(repo, `refs/remotes/origin/opus/${id}`);
  const choreRef = `refs/heads/chore/done-${id}`;
  const choreDone = trunkRecord?.["state"] !== "done" && refExists(repo, choreRef) && recordOf(gitSrc(repo, choreRef, studioRel), id)?.["state"] === "done";
  const handoff = (() => {
    const r = git(repo, ["show", "refs/heads/master:docs/SESSION-HANDOFF.md"]);
    return r.status === 0 ? r.stdout : undefined;
  })();
  const facts: Facts = {
    id,
    repo,
    studioRel,
    studioAbs,
    excludes,
    design,
    tip,
    tipRead,
    wt,
    trunk,
    trunkRecord,
    branch,
    branchRecord,
    checkpointed: memo(() => {
      const log = git(repo, ["log", "--reverse", "--format=%H", TRUNK, "--", `${studioRel}/${recordRel(id)}`]);
      for (const c of log.stdout.split("\n").filter(Boolean)) {
        if (recordOf(gitSrc(repo, c, studioRel), id)?.["state"] !== "done") continue;
        return git(repo, ["show", "--first-parent", "--format=", "--name-only", c, "--", HANDOFF]).stdout.trim() !== "";
      }
      return false;
    }),
    certified: memo(() => certificate(repo, studioRel, studioAbs, excludes, manifest, trunkRecord, id).ok),
    specBranch: refExists(repo, `refs/heads/spec/${id}`) ? gitSrc(repo, `refs/heads/spec/${id}`, studioRel) : undefined,
    choreDone,
    handoff,
    residue: tip !== undefined || entry !== undefined || remoteTracking,
    pushed: remoteTracking,
    manifest,
    curTree: memo(() => {
      if (tip === undefined) return undefined;
      try {
        return `tree:${sourceTreeHash(repo, excludes, branchRef)}`;
      } catch {
        return undefined;
      }
    }),
    buildRounds: memo(() => {
      const worktree = readWorktreeManifest(wt.studio);
      if ("error" in worktree) return worktree;
      const drift = buildReviewDrift(manifest, worktree.manifest);
      if (drift !== undefined) return { error: drift };
      const config = readBuildReviewConfig(manifest);
      if ("error" in config) return config;
      const read = readBuildRounds(wt.studio, id, config.config);
      return "error" in read ? read : { config: config.config, rounds: read.rounds };
    }),
    receipt: memo(() => (usable ? trackedOnly(() => admitCurrentRunReceipt(wt.studio, id)) : undefined)),
    redFindings: memo(() => {
      if (!usable) return [];
      try {
        return checkEvidence(wt.studio, { now: new Date(), repo: wt.dir })
          .filter((x) => x.level === "block" && x.rule.startsWith("opus.red_") && (x.where.includes(id) || x.where.includes(`reds/${id}`)))
          .map((x) => `${x.rule}: ${x.message}`);
      } catch {
        return [];
      }
    }),
    uiSpecProblems: memo(() => uiProblems(branchRecord ?? trunkRecord, studioAbs)),
    uiReviewProblems: memo(() => (usable ? uiProblems(branchRecord, wt.studio) : [])),
    uiReviewInput: memo(() => (usable ? uiInput(branchRecord, wt.studio) : undefined)),
    pr: memo((): PrClass => classify(repo, tipRead, identifyPr(repo, `opus/${id}`))),
    owed: memo(() => owedRetros(studioAbs)),
    wtCiProblem: memo(() => {
      try {
        readdirSync(join(wt.studio, "ci"));
        return undefined;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        return code === "ENOENT" ? undefined : `ci/ of ${join(".worktrees", id, studioRel)} cannot be listed (${code ?? "error"})`;
      }
    }),
    wtChanges: memo(() => {
      const r = git(wt.dir, ["status", "--porcelain", "-z", "--untracked-files=all"]);
      if (r.status !== 0 || r.error !== undefined) return { error: `git status failed in ${wt.dir}` };
      const brief = `${studioRel}/${briefRel(id)}`;
      const record = `${studioRel}/${recordRel(id)}`;
      const specLog = new RegExp(`^${esc(studioRel)}/ci/${esc(id)}-spec-[1-9][0-9]*\\.log$`);
      const out = { spec: [] as string[], other: [] as string[], bad: [] as string[] };
      const fields = r.stdout.split("\0");
      for (let i = 0; i < fields.length; i++) {
        const entry = fields[i]!;
        if (entry.length < 4) continue;
        const xy = entry.slice(0, 2);
        const path = entry.slice(3);
        // -z prints a rename or copy as "XY to\0from\0"
        const from = /[RC]/.test(xy) ? fields[++i] : undefined;
        // the opus record may only be modified: a deletion, type change, rename or copy of it is named with its status, so the perform refuses it
        if (![path, from].some((p) => p !== undefined && (p === brief || specLog.test(p)))) out.other.push(path === record && !/^[ M][ M]$/.test(xy) ? `${path} (${xy.trim()})` : path);
        else if (from === undefined && (path === brief ? /^[ M][ M]$/.test(xy) : /^(\?\?|A[ M])$/.test(xy))) out.spec.push(path);
        else out.bad.push(path);
      }
      return out;
    }),
    evidenceAt: memo(() => {
      const times: number[] = [];
      for (const name of branch?.list(`ci/reds/${id}`) ?? []) times.push(instant(parseLogHeader(branch?.read(`ci/reds/${id}/${name}`) ?? "").get("at"))?.getTime() ?? Number.NaN);
      for (const { name } of reviewLogs(branch, id)) times.push(instant(parseLogHeader(branch?.read(`ci/${name}`) ?? "").get("at"))?.getTime() ?? Number.NaN);
      return Math.max(0, ...times.filter((t) => !Number.isNaN(t)));
    }),
  };
  return facts;
}

/**
 * "Dirty" is tracked changes only (an untracked file never makes a tree dirty). The reused
 * receipt admission asks `git status --porcelain`, which counts untracked files; git's own
 * `status.showUntrackedFiles=no` (set for this process's children only, for the duration of the
 * call) gives it the tracked-only definition without reimplementing or editing the admission.
 */
function trackedOnly<T>(fn: () => T): T {
  const keys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"] as const;
  const saved = keys.map((k) => process.env[k]);
  if (saved[0] !== undefined) return fn();
  process.env["GIT_CONFIG_COUNT"] = "1";
  process.env["GIT_CONFIG_KEY_0"] = "status.showUntrackedFiles";
  process.env["GIT_CONFIG_VALUE_0"] = "no";
  try {
    return fn();
  } finally {
    for (const k of keys) delete process.env[k];
  }
}

function uiProblems(rec: Dict | undefined, root: string): string[] {
  if (rec?.["kind"] !== "ui") return [];
  try {
    return inspectUiDesignInput(root, rec as NativeRecord).problems;
  } catch (e) {
    return [(e as Error).message];
  }
}

function uiInput(rec: Dict | undefined, root: string): string | undefined {
  if (rec?.["kind"] !== "ui") return undefined;
  try {
    return inspectUiDesignInput(root, rec as NativeRecord).input?.relative;
  } catch {
    return undefined;
  }
}

function reviewLogs(src: Src | undefined, id: string): { n: number; name: string }[] {
  return (src?.list("ci") ?? []).flatMap((name) => {
    const m = new RegExp(`^${esc(id)}-review-([1-9][0-9]*)\\.log$`).exec(name);
    return m === null ? [] : [{ n: Number(m[1]), name }];
  });
}

/**
 * W-215: the reviewer session `sella` last recorded for `id` in `kind` logs ("spec" or "review"): the `# session:` header of
 * its newest log, or undefined when it has none, the newest log records none, or the id is not a session token.
 */
function reviewSession(src: Src | undefined, id: string, kind: "spec" | "review", sella: string): string | undefined {
  let newest: { n: number; session: string | undefined } | undefined;
  for (const name of src?.list("ci") ?? []) {
    const m = new RegExp(`^${esc(id)}-${kind}-([1-9][0-9]*)\\.log$`).exec(name);
    if (m === null || (newest !== undefined && Number(m[1]) < newest.n)) continue;
    const h = parseLogHeader(src?.read(`ci/${name}`) ?? "");
    if (h.get("sella") === sella) newest = { n: Number(m[1]), session: h.get("session") };
  }
  return newest?.session !== undefined && SESSION_ID.test(newest.session) ? newest.session : undefined;
}

function statSafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function classify(repo: string, tipRead: TipRead, read: PrRead): PrClass {
  const tip = tipRead.kind === "tip" ? tipRead.oid : undefined;
  if (read.kind === "held") return { kind: "held", reason: read.reason };
  if (read.kind === "none") return { kind: "none" };
  const pr = read.pr;
  if (pr.state === "OPEN") return tip !== undefined && pr.headRefOid === tip ? { kind: "open", pr } : { kind: "open-stale", pr };
  if (pr.state !== "MERGED") return { kind: "none" };
  const s = settleMerged(repo, pr, tipRead);
  // an unverifiable head is left at `merge`: its perform fetches the opus ref and re-checks (or holds naming the oid)
  return s.kind === "settled" ? { kind: "settled", pr } : { kind: s.kind === "unverifiable" ? "behind" : s.kind, pr, reason: s.reason };
}

// ---------------------------------------------------------------------------
// the ladder
// ---------------------------------------------------------------------------

interface Order {
  role: string;
  sella: string;
  /** W-085: the command that prints this sella's boot bundle, for a harness that cannot run it. */
  boot: string;
  phase: string;
  inputs: string[];
  command: string;
  round?: number;
  resume: boolean;
  budget?: number;
  extra: [string, string][];
}
export interface Derived {
  step: Step;
  status: "named" | "held" | "complete";
  actor: string;
  why: string;
  command?: string;
  order?: Order;
  pr?: Pr;
  /** what `--perform` does at this rung, where the rung has more than one reading */
  act?: "verify" | "commit" | "commit-opus" | "land";
  /** W-233: the action a step ticket would authorise at this derivation (only `refreshTicket` reads it) */
  ticket?: { action: TicketAction; round: number };
  extra: [string, string][];
}

/** The one legal next step, from facts alone (the only I/O is the lazy `pr()` read). */
export function deriveNext(f: Facts): Derived {
  const { id } = f;
  const rec = f.branchRecord ?? f.trunkRecord ?? {};
  const named = (step: Step, actor: string, why: string, command?: string, extra: [string, string][] = [], pr?: Pr): Derived => ({ step, status: "named", actor, why, ...(command === undefined ? {} : { command }), ...(pr === undefined ? {} : { pr }), extra });
  const hold = (step: Step, why: string): Derived => ({ step, status: "held", actor: "producer", why, extra: [] });

  if (f.trunkRecord?.["state"] === "done") return afterDone(f);

  // 1 greenlight
  const state = str(rec["state"]);
  if (rec["declined"] !== undefined && rec["declined"] !== null && rec["declined"] !== false) return hold("greenlight", `${id} is declined (${one(String(rec["declined"]))}); nothing to build`);
  if (f.tipRead?.kind === "error") return hold("branch", f.tipRead.reason);
  if (state === "halted") return hold("greenlight", `${id} is halted; resume it before the cascade continues`);
  if (state === undefined) return hold("greenlight", `${recordRel(id)} carries no state`);
  if (state === "backlog") return named("greenlight", "patron", `${id} is in the backlog; only the Patron greenlights`, `bisellium greenlight ${id} --studio ${f.studioRel}`);

  // 2 spec (the committed trunk)
  const gate = readSpecReviewer(f.manifest, f.trunkRecord ?? {});
  if ("error" in gate) return hold("spec", gate.error);
  const reviewer = gate.reviewer;
  const admit = lightAdmission(f);
  // W-206: once opus/<id> exists the branch owns the spec (D-021): it is judged there, and every order names its worktree
  // ponytail: only with a reviewer; without one signedSpec pins no brief, so an amendment never un-passes the spec (today's rung)
  const onOpus = f.tip !== undefined && reviewer !== undefined;
  // W-206: the worktree's uncommitted spec work is read first, whatever the committed evidence says: a new log that is not a valid
  // signature or review must hold before the sequence is judged, or an unanchored malformed one would only order another round
  const changed = onOpus && f.wt.usable ? f.wtChanges() : undefined;
  if (changed !== undefined && reviewer !== undefined) {
    if ("error" in changed) return hold("spec", changed.error);
    if (changed.bad.length > 0) return hold("spec", `${changed.bad.join(", ")}: the brief may only be edited and a spec log only added on opus/${id}; restore the committed one`);
    // every new spec log, history included, must pass the strict readers against the brief it names
    const loose = changed.spec.find((p) => {
      const m = /(?:^|\/)(ci\/[^/]+-spec-([1-9][0-9]*)\.log)$/.exec(p);
      if (m === null) return false;
      const [, rel, n] = m as unknown as [string, string, string];
      const text = f.branch?.read(rel);
      if (text === undefined) return true;
      const brief = ownBrief(text, id, rel);
      // ponytail: the pin's shape only; an intermediate brief is never in Git, so which blob it names is not checked
      if (!new RegExp(`^${esc(briefRel(id))} blob:[0-9a-f]{40}$`).test(brief)) return true;
      return "error" in readSpecSignature(text, id, Number(n), reviewer.design, brief, rel) && "error" in readSpecReview(text, id, Number(n), reviewer, brief, rel);
    });
    if (loose !== undefined) return hold("spec", `${loose} is not a valid signature or spec review`);
  }
  // an unlistable worktree ci/ cannot carry the spec, so the committed branch is judged instead: once it has passed, the later rungs'
  // worktree handling is unchanged (the review rung holds on the same ci/); until then nothing can be ordered
  const ciProblem = onOpus && f.wt.usable ? f.wtCiProblem() : undefined;
  const committed = ciProblem === undefined ? undefined : specEvidence(gitSrc(f.repo, `refs/heads/opus/${id}`, f.studioRel), id, f.design, reviewer, admit);
  if (ciProblem !== undefined && !committed!.ok) return hold("spec", ciProblem);
  // pending spec work (an edited brief or a new log) cannot be judged beside an unlistable ci/: only an unchanged worktree goes on
  if (ciProblem !== undefined && changed !== undefined && !("error" in changed) && changed.spec.length > 0) return hold("spec", `${ciProblem}; the spec work pending in the worktree is not committed`);
  const spec = committed ?? specEvidence(onOpus ? f.branch : f.trunk, id, f.design, reviewer, admit);
  const ui = spec.ok ? f.uiSpecProblems() : [];
  if (onOpus && !spec.ok) {
    if (!f.wt.usable) return hold("spec", `${spec.why}; ${join(".worktrees", id)} is not a usable worktree on opus/${id}, so no spec write is ordered`);
    if (spec.gate !== undefined) return specOrder(f, reviewer, spec, spec.maxRound, join(".worktrees", id, f.studioRel), f.branch);
    return hold("spec", spec.why);
  }
  if (changed !== undefined && !("error" in changed) && changed.spec.length > 0) return { ...named("spec", "producer", `the signed spec on opus/${id} is not committed (${changed.spec.length} path(s))`, `bisellium next ${id} --perform --expect spec`), act: "commit-opus" };
  if (!spec.ok || ui.length > 0) {
    const onBranch = specEvidence(f.specBranch, id, f.design, reviewer, admit);
    if (!spec.ok && onBranch.ok) return { ...named("spec", "producer", `spec signed on spec/${id}, not on master`, `bisellium next ${id} --perform --expect spec`), act: "land" };
    // a spec/<id> branch cannot take a review (performSpecCommit refuses an existing branch): never land it, name it
    if (reviewer !== undefined && !spec.ok && f.specBranch !== undefined) return hold("spec", `spec/${id} exists but does not carry a signed spec with a passed review; it cannot take one, so it is not landed`);
    // no spec/<id> at all: the architect may have left the signed spec uncommitted in the main checkout
    const tree = !spec.ok && f.specBranch === undefined ? specEvidence(fsSrc(f.studioAbs), id, f.design, reviewer, admit) : undefined;
    if (tree?.ok) return { ...named("spec", "producer", "spec signed in the working tree, not committed", `bisellium next ${id} --perform --expect spec`), act: "commit" };
    if (reviewer !== undefined && tree?.gate !== undefined) return specOrder(f, reviewer, tree, Math.max(spec.maxRound, tree.maxRound));
    return dispatch(f, "spec", spec.ok ? ui.join("; ") : spec.why, { phase: "spec", round: spec.maxRound + 1, resume: spec.anyLog, inputs: [briefRel(id)] });
  }

  // 3 branch: the PR is read early only when the branch or its worktree cannot carry the evidence,
  // or when the branch has been pushed (only then can a PR exist, and a MERGED one settles the rungs
  // up to merge by reachability, so a merged opus never walks back to `branch` or to a stale receipt)
  let settled = false;
  if (f.tip === undefined || !f.wt.usable || f.pushed) {
    const p = f.pr();
    if (p.kind === "held") return hold(f.tip === undefined ? "branch" : "pr", p.reason);
    if (p.kind === "settled") settled = true;
    else if (p.kind === "behind") return { ...named("merge", "producer", p.reason, `bisellium next ${id} --perform --expect merge`, [], p.pr), ticket: { action: "merge", round: 0 } };
    else if (f.tip === undefined) {
      // D-039 §1: no new opus starts while a retro is owed
      const owing = retroHold(f);
      if (owing !== undefined) return hold("branch", owing);
      return { ...named("branch", "producer", `refs/heads/opus/${id} does not exist`, `bisellium next ${id} --perform --expect branch`), ticket: { action: "branch", round: 0 } };
    }
  }

  if (!settled) {
    const b = f.branchRecord;
    if (b === undefined) return hold("ready", `${recordRel(id)} cannot be read on opus/${id}`);
    // 4 ready
    if (!(PAST_READY.has(str(b["state"]) ?? "") && isDict(b["probationes"]) && isDict(b["probationes"]["spec"]) && b["probationes"]["spec"]["status"] === "passed")) {
      const where = f.wt.usable ? join(".worktrees", id, f.studioRel) : f.studioRel;
      return { ...named("ready", "producer", `${id} is ${str(b["state"]) ?? "unstated"} and the spec gate is not recorded passed on the branch`, `bisellium ready ${id} --sella ${spec.sella ?? f.design} --studio ${where}`, [["attributed", `${spec.sella ?? f.design} (signed ${spec.log})`]]), ticket: { action: "ready", round: 0 } };
    }
    if (b["builder_runtime"] !== "isolated") return hold("ready", `${id} is past ready but its record carries no builder_runtime marker (a legacy record is outside the ladder)`);

    // 5 reds
    const bs = f.branch!;
    const n = countBehaviours(bs.read(briefRel(id)) ?? f.trunk?.read(briefRel(id)) ?? "");
    if (n === 0) return hold("reds", `${briefRel(id)} declares no numbered behaviours`);
    const missing: number[] = [];
    for (let k = 1; k <= n; k++) {
      const text = bs.read(`ci/reds/${id}/${pad(k)}.log`);
      const h = parseLogHeader(text ?? "");
      const exit = h.get("exit") ?? "";
      if (text === undefined || !/^-?\d+$/.test(exit) || exit === "0" || (h.get("tree") ?? "").startsWith("dirty:") || isModuleLoadFailure(text)) missing.push(k);
    }
    const findings = f.redFindings();
    if (missing.length > 0 || findings.length > 0)
      return dispatch(f, "reds", missing.length > 0 ? `no usable red for behaviour(s) ${missing.join(", ")} (a dirty-tree, module-load or exit-0 red counts as missing)` : findings.join("; "), {
        phase: "1",
        resume: bs.list(`ci/reds/${id}`).length > 0,
        inputs: [briefRel(id)],
        extra: [["missing", missing.join(",") || "(none; see why)"]],
        ...(missing.length > 0 ? { behaviour: { from: missing[0]!, through: n } } : {}),
      });

    // 6 build
    if (!f.wt.usable) return hold("build", `${join(".worktrees", id)} is not a worktree on opus/${id}; run: git worktree add .worktrees/${id} opus/${id}`);
    // W-167: the review configuration, the round history, the cited gate and the current tree are read strictly before any order
    const read = f.buildRounds();
    if ("error" in read) return hold("review", read.error);
    const cur = f.curTree();
    if (cur === undefined) return hold("review", `the current source tree of opus/${id} cannot be computed, so no review round can be judged current`);
    // W-233: in a ticketed studio a recorded verdict the gate does not cite yet is recorded by `review`, not re-dispatched or held
    const tickets = readStepTickets(f.manifest);
    if ("error" in tickets) return hold("review", `bisellium.yml#step_tickets is malformed (${tickets.error})`);
    const gate = reviewGate(f, b, read, tickets.required);
    if (gate !== undefined && "error" in gate) return hold("review", gate.error);
    if (gate !== undefined && "unrecorded" in gate) {
      const n = gate.unrecorded.n;
      const censor = censorSella(f.manifest) ?? "qa-lead";
      const studio = f.wt.usable ? join(".worktrees", id, f.studioRel) : f.studioRel;
      return { ...named("review", "producer", `build-review round ${n} is recorded but the review gate does not cite it`, `bisellium review ${id} --pass|--fail --evidence ci/${id}-review-${n}.log --round ${n} --sella ${censor} --studio ${studio}`), ticket: { action: "review", round: n } };
    }
    // W-206: a round is current at this tree and, when it pins one, at the brief a verdict would pin now
    const specRel = str(b["spec"]);
    const specText = specRel === undefined ? undefined : bs.read(specRel);
    const pin = specRel === undefined || specText === undefined ? undefined : `${one(specRel)} blob:${blobOf(specText)}`;
    const current = (g: Gate): boolean => g.tree === cur && (g.brief === undefined || g.brief === pin);
    const failedNow = gate !== undefined && gate.status === "failed" && current(gate);
    const boundary = failedNow ? boundaryExtra(id, read.rounds.find((r) => r.n === gate.round)) : [];
    const receipt = f.receipt();
    if ((receipt !== undefined && !receipt.ok) || failedNow)
      return dispatch(f, "build", failedNow ? `review round ${gate?.round} failed at this tree` : receipt !== undefined && !receipt.ok ? receipt.error : "no admissible run receipt", {
        phase: failedNow ? "fix" : "2",
        resume: str(b["run_receipt"]) !== undefined || reviewRounds(f).length > 0,
        inputs: [briefRel(id), ...(failedNow && gate?.evidence !== undefined ? [gate.evidence] : [])],
        extra: boundary,
      });

    // 7 review
    const uiBranch = f.uiReviewProblems();
    if (!(gate !== undefined && gate.status === "passed" && current(gate)) || uiBranch.length > 0) {
      const rounds = reviewRounds(f);
      const uiIn = f.uiReviewInput();
      const session = reviewSession(f.branch, id, "review", censorSella(f.manifest) ?? "qa-lead");
      return dispatch(f, "review", uiBranch.length > 0 ? uiBranch.join("; ") : gate === undefined ? "no review gate is recorded" : gate.tree === cur ? `review round ${gate.round} ${gate.status} against an older brief` : gate.status === "passed" ? `review round ${gate.round} passed an older tree` : `review round ${gate.round} ${gate.status} at an older tree`, {
        phase: "review",
        round: Math.max(0, ...rounds.map((r) => r.n)) + 1,
        resume: rounds.length > 0,
        inputs: [briefRel(id), ...(uiIn === undefined ? [] : [uiIn]), ...rounds.map((r) => `ci/${r.name}`), `ci/reds/${id}/`],
        ...(uiIn === undefined ? {} : { uiInput: uiIn }),
        ...(session === undefined ? {} : { session }),
        extra: session === undefined ? [] : [["session", session]],
      });
    }

    // 8 pr, 9 merge
    const p = f.pr();
    if (p.kind === "held") return hold("pr", p.reason);
    if (p.kind === "open") return { ...named("merge", "producer", `PR #${p.pr.number} is OPEN on the local tip ${p.pr.headRefOid.slice(0, 12)}`, `bisellium next ${id} --perform --expect merge`, [], p.pr), ticket: { action: "merge", round: 0 } };
    if (p.kind === "behind") return { ...named("merge", "producer", p.reason, `bisellium next ${id} --perform --expect merge`, [], p.pr), ticket: { action: "merge", round: 0 } };
    if (p.kind !== "settled")
      return named(
        "pr",
        "producer",
        p.kind === "open-stale" ? `PR #${p.pr.number} is OPEN but not on the local tip` : p.kind === "unrelated" ? `a MERGED PR settles nothing: ${p.reason}` : "review is met and no PR exists for the head",
        `bisellium next ${id} --perform --expect pr --title "<title>" --body-file <path>`,
        [],
        p.kind === "open-stale" ? p.pr : undefined,
      );
  }

  // 10 cleanup, 11 done
  if (f.residue) return named("cleanup", "producer", `${id} is MERGED and fetched; its local branch, worktree or remote-tracking branch remain`, `bisellium next ${id} --perform --expect cleanup`);
  if (f.choreDone) return { ...named("done", "producer", `done committed on chore/done-${id}, not on master`, `bisellium next ${id} --perform --expect done`), act: "land" };
  if (!f.certified()) return { ...named("done", "producer", `${id} is MERGED, fetched and cleaned up; no automated certificate is recorded`, `bisellium verify ${id} --studio ${f.studioRel} --repo .`), act: "verify" };
  return { ...named("done", "producer", `${id} is MERGED, fetched and cleaned up; the trunk record is not done`, `bisellium next ${id} --perform --expect done`), ticket: { action: "done", round: 0 } };
}

/** The order a reviewer-configured spec step names, from the source that holds the newest signature. */
function specOrder(f: Facts, reviewer: SpecReviewer, ev: SpecEvidence, maxRound: number, studio = f.studioRel, src: Src | undefined = fsSrc(f.studioAbs)): Derived {
  const { id } = f;
  const round = maxRound + 1;
  if (ev.gate?.kind === "failed") {
    // D-061 §4: a second failed review since the newest re-spec ends review; the remainder is filed as a new opus
    const ended = ev.gate.failed.length >= 2;
    return dispatch(f, "spec", ended ? `${ev.gate.failed.join(" and ")} failed; D-061 §4: no third review: the producer files the remainder as a new opus, then the architect cuts the brief to what passed and signs` : ev.why, {
      phase: "spec",
      round,
      studio,
      resume: ev.anyLog,
      inputs: [briefRel(id), ev.gate.review],
      ...(ended ? { extra: [["split", `bisellium new --kind <kind> --collegium <collegium> --title <the remainder> --parent ${id} ${f.studioRel}`]] as [string, string][] } : {}),
    });
  }
  if (ev.gate?.kind === "invalid") return { step: "spec", status: "held", actor: "producer", why: ev.why, extra: [] };
  if (ev.gate?.kind === "review") {
    // W-196: a signed brief that fails admission goes back to the architect, never to the reviewer.
    const limit = readBriefLimit(f.manifest.brief_behaviour_limit);
    if ("error" in limit) return { step: "spec", status: "held", actor: "producer", why: `brief.admission: ${limit.error}`, extra: [] };
    const problems = limit.limit === undefined ? [] : briefAdmissionProblems(f.studioAbs, f.manifest, id, ev.gate.brief, limit.limit);
    if (problems.length > 0) return dispatch(f, "spec", `brief.admission: ${problems.join("; ")}`, { phase: "spec", round, studio, resume: ev.anyLog, inputs: [briefRel(id), ev.gate.signature] });
    const session = reviewSession(src, id, "spec", reviewer.sella);
    return dispatch(f, "spec", ev.why, { phase: "spec", round, studio, resume: false, inputs: [briefRel(id), ev.gate.signature], reviewer, extra: [["model", reviewer.model], ...(session === undefined ? [] : [["session", session] as [string, string]])], ...(session === undefined ? {} : { session }) });
  }
  return dispatch(f, "spec", ev.why, { phase: "spec", round, studio, resume: ev.anyLog, inputs: [briefRel(id)] });
}

/** Why a new opus may not start: a retro is owed, or the setting that says so cannot be read. */
function retroHold(f: Facts): string | undefined {
  const owed = f.owed();
  if ("error" in owed) return `the retro setting cannot be read: ${owed.error}`;
  return owed.owed.length > 0 ? `retro owed: ${owed.owed.join(", ")}; file them before a new opus starts` : undefined;
}

/** The checkpoint rides the done commit: complete once the commit that made the record `done` also changed the handoff. */
function afterDone(f: Facts): Derived {
  const { id } = f;
  const owed = f.owed();
  if ("error" in owed) return { step: "retro", status: "held", actor: "producer", why: `the retro setting cannot be read: ${owed.error}`, extra: [] };
  if (owed.owed.includes(id))
    return {
      step: "retro",
      status: "named",
      actor: "producer",
      why: `${id} is done on the trunk; its retro is not filed`,
      command: `bisellium retro --opus ${id} --from <triage.json> --studio ${f.studioRel}`,
      extra: [],
    };
  if (f.handoff === undefined) return { step: "checkpoint", status: "complete", actor: "producer", why: "the trunk record is done and master has no handoff", extra: [] };
  if (f.checkpointed()) return { step: "checkpoint", status: "complete", actor: "producer", why: `the trunk record is done and its done commit changed ${HANDOFF}`, extra: [] };
  return {
    step: "checkpoint",
    status: "named",
    actor: "producer",
    why: `${id} is done on the trunk; the commit that made it done did not change ${HANDOFF}`,
    command: `update ${HANDOFF}, the progress row and the masthead for ${id}, then republish`,
    extra: [],
  };
}

/** The lowest-numbered standing blocker that names a class (L-069): the whole word `class` or `classes`. */
const classBlocker = (round: BuildReviewRound | undefined) => round?.blockers.filter((b) => /\bclass(?:es)?\b/i.test(b.text)).sort((a, b) => a.n - b.n)[0];

/** The order's `boundary` line when the failed round names a class blocker, else nothing. */
function boundaryExtra(id: string, round: BuildReviewRound | undefined): [string, string][] {
  const blocker = classBlocker(round);
  return round === undefined || blocker === undefined
    ? []
    : [["boundary", `${round.log} finding ${blocker.n} is a class: fix it with one check at the input boundary named by the brief's Input domain, which every path reads, not a patch at the cited site (L-069)`]];
}

interface Gate {
  status: string;
  evidence: string | undefined;
  tree: string | undefined;
  round: number | undefined;
  brief: string | undefined;
}
/** The recorded review gate, cross-checked against the strictly read rounds: absent is no decided review, anything else must agree with its log. */
function reviewGate(f: Facts, rec: Dict, read: { config: BuildReviewConfig; rounds: BuildReviewRound[] }, tickets: boolean): Gate | undefined | { error: string } | { unrecorded: BuildReviewRound } {
  const { reviewId, censor } = read.config;
  const g = isDict(rec["probationes"]) ? rec["probationes"][reviewId] : undefined;
  // W-233: with step tickets, the newest verdict not yet cited (no gate, or a gate citing an older round) is the `review` substep
  const newest = read.rounds[read.rounds.length - 1];
  if (g === undefined) return tickets && newest !== undefined ? { unrecorded: newest } : undefined;
  const bad = (why: string): { error: string } => ({ error: `${recordRel(f.id)}#probationes.${reviewId}: ${why}` });
  if (!isDict(g)) return bad("the gate must be a mapping");
  if (g["status"] !== "passed" && g["status"] !== "failed") return bad("status must be exactly passed or failed");
  const evidence = str(g["evidence"]);
  const round = read.rounds.find((r) => r.log === evidence);
  if (round === undefined) return bad(`evidence ${evidence === undefined ? "(absent)" : evidence} names no read build-review log`);
  if (round !== newest) return tickets && newest !== undefined ? { unrecorded: newest } : bad(`evidence ${round.log} is not the newest build-review log, ${newest?.log}`);
  if (g["sella"] !== censor) return bad(`sella must be the censor ${censor}`);
  if (g["status"] !== round.outcome) return bad(`status ${g["status"]} disagrees with ${round.log}, which ${round.outcome}`);
  return { status: g["status"], evidence, tree: round.tree, round: round.n, brief: round.brief };
}
const reviewRounds = (f: Facts): { n: number; name: string }[] => reviewLogs(f.branch, f.id);

// ---------------------------------------------------------------------------
// dispatch orders and the context cap
// ---------------------------------------------------------------------------

function dispatch(f: Facts, step: "spec" | "reds" | "build" | "review", why: string, o: { phase: string; round?: number; resume: boolean; inputs: string[]; extra?: [string, string][]; uiInput?: string; reviewer?: SpecReviewer; session?: string; behaviour?: { from: number; through: number }; studio?: string }): Derived {
  const { id, manifest } = f;
  const studioRel = o.studio ?? f.studioRel;
  const builder = (() => {
    const resolved = resolveSeat(manifest, "builder");
    const minted = resolved === undefined ? undefined : mintDispatchSella(resolved, "builder", id, "next");
    return minted !== undefined && "sella" in minted ? minted.sella : "builder";
  })();
  const censor = censorSella(manifest) ?? "qa-lead";
  const inputs = [...o.inputs, ...(o.reviewer === undefined ? [`${recordRel(id)}#traditio`] : [])];
  let role: string;
  let sella: string;
  let command: string;
  if (step === "spec" && o.reviewer !== undefined) {
    role = "spec-reviewer";
    sella = o.reviewer.sella;
    command = [
      o.session === undefined ? `dispatch ${sella} (${o.reviewer.model}) to review the signed spec once, on two questions only (D-046):` : `resume ${sella}'s session ${o.session} (${o.reviewer.model}) with the packet's prompt, on the same two questions (D-046):`,
      "1. does its Input domain name every record the opus reads, with one rejecting function that fails closed?",
      "2. can every promise be guaranteed, or does it state its limit?",
      'Record findings under ## Findings, each ending "check: …", or write "No findings".',
      packetLine("spec", id, o.round, sella, studioRel),
      disputeLine(studioRel),
      `Record with: bisellium verdict ${id} --round ${o.round} --sella ${sella} --model ${o.reviewer.model} --outcome <passed|failed> --phase spec --from <file> --studio ${studioRel} --session ${o.session ?? SESSION_PLACEHOLDER}`,
    ].join("\n");
  } else if (step === "spec") {
    role = "architect";
    sella = f.design;
    command = `dispatch ${sella} to sign the spec for ${id}; close out with: bisellium verdict ${id} --round ${o.round} --sella ${sella} --outcome passed --phase spec --studio ${studioRel}`;
  } else if (step === "reds") {
    role = "builder";
    sella = builder;
    // W-166 (D-036): one behaviour at a time; with none missing, the finding is the work and only the last two lines remain.
    const head = `dispatch ${sella} (phase 1, one behaviour at a time, D-036), in .worktrees/${id}`;
    const closing = [
      "If red refuses, finish the earlier behaviour it names; never re-record a red at the tip.",
      "A red recorded on the wrong tree is re-recorded with --cwd in a detached worktree at the commit it belongs on, after the branch's last rebase, and its log committed at the tip; never rewrite history.",
    ];
    command =
      o.behaviour === undefined
        ? [`${head}, to resolve: ${why}`, ...closing].join("\n")
        : [
            `${head}, from behaviour ${o.behaviour.from} through ${o.behaviour.through}, for each in turn:`,
            "1. commit the behaviour's test, its rows failing;",
            `2. from .worktrees/${id}: bisellium red ${id} --behaviour <b> --sella ${sella} --studio ${studioRel} -- <cmd…>`,
            "3. commit the red log alone (studio files only), before any implementation;",
            "4. implement the behaviour until its rows and every earlier behaviour's rows pass, and commit.",
            ...closing,
          ].join("\n");
  } else if (step === "build") {
    role = "builder";
    sella = builder;
    command = `dispatch ${sella} (phase ${o.phase === "fix" ? "fix" : "2"}) through the host seam: bisellium run --sella builder --opus ${id} --studio ${studioRel} -- <builder command…>`;
  } else {
    role = "censor";
    sella = censor;
    command = `${o.session === undefined ? `dispatch ${sella}` : `resume ${sella}'s session ${o.session} with the packet's prompt`}; ${packetLine("build", id, o.round, sella, studioRel)}; ${disputeLine(studioRel)}; record the transcript with: bisellium verdict ${id} --round ${o.round} --sella ${sella} --outcome <passed|failed>${o.uiInput === undefined ? "" : ` --ui-input ${o.uiInput}`} --studio ${studioRel} --session ${o.session ?? SESSION_PLACEHOLDER}; close out with: bisellium review ${id} --pass|--fail --evidence ci/${id}-review-${o.round}.log --round ${o.round} --sella ${sella} --studio ${studioRel}. Use the word class in a blocker that recurs across sites (L-069).`;
  }
  const actor = step === "review" ? "censor" : step === "spec" ? (o.reviewer === undefined ? "architect" : "spec-reviewer") : "builder";
  // W-233: the verb a dispatched session closes out with; a build session records none, and a reds order with only findings names no behaviour
  const ticket: Derived["ticket"] =
    step === "spec" && o.round !== undefined ? { action: "verdict-spec", round: o.round } : step === "reds" && o.behaviour !== undefined ? { action: "red", round: o.behaviour.from } : step === "review" && o.round !== undefined ? { action: "verdict-build", round: o.round } : undefined;
  return {
    step,
    status: "named",
    actor,
    why,
    extra: [],
    ...(ticket === undefined ? {} : { ticket }),
    order: { role, sella, boot: `bisellium context --sella ${sella} --studio ${studioRel}`, phase: o.phase, inputs, command, ...(o.round === undefined ? {} : { round: o.round }), resume: o.resume, extra: o.extra ?? [] },
  };
}

const SESSION_PLACEHOLDER = "<the session id the reviewer prints>";
/** W-215: the packet the reviewer is given before a round (delta, facts, prompt); `<packet dir>` is the caller's to choose. */
const packetLine = (phase: "spec" | "build", id: string, round: number | undefined, sella: string, studioRel: string): string =>
  `Packet first: node --import tsx scripts/review-packet.mjs --phase ${phase} --opus ${id} --round ${round} --sella ${sella} --studio ${studioRel} --repo . --packets <packet dir>`;
const disputeLine = (studioRel: string): string =>
  `If the author disputes a finding with evidence, send ${studioRel}/prompts/rebuttal.md and the author's ## Rebuttal into the same session and record the reviewer's ## Ruling in the same verdict.`;

/** The cap, the declaration and the handover: a dispatch order needs all three. */
function gateDispatch(d: Derived, f: Facts, budget: number | undefined): Derived {
  if (d.status !== "named" || d.order === undefined) return d;
  const refuse = (why: string): Derived => ({ step: d.step, status: "held", actor: d.actor, why, extra: [] });
  if (budget === undefined) return refuse("dispatch budget undeclared");
  if (budget > DISPATCH_TOKEN_CAP) return refuse(`budget ${budget} exceeds DISPATCH_TOKEN_CAP ${DISPATCH_TOKEN_CAP}`);
  if (d.order.resume) {
    const t = (f.branchRecord ?? f.trunkRecord)?.["traditio"];
    const at = isDict(t) ? (instant(t["at"])?.getTime() ?? Number.NaN) : Number.NaN;
    if (Number.isNaN(at)) return refuse("stale handover: run bisellium handoff first (the record carries no traditio)");
    if (at < f.evidenceAt()) return refuse(`stale handover: run bisellium handoff first (traditio at ${new Date(at).toISOString()} predates the newest red or review log)`);
  }
  return { ...d, order: { ...d.order, budget } };
}

// ---------------------------------------------------------------------------
// step health
// ---------------------------------------------------------------------------

interface Marker {
  schema: 1;
  opus: string;
  step: Step;
  pid: number;
  start_ticks: number;
  started: string;
  output: string;
  budget_seconds: number;
  writer: "perform" | "track";
}
interface Ident {
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
}
interface MarkerRead {
  path: string;
  marker?: Marker;
  invalid?: string;
  ident?: Ident;
}
interface Env {
  repo: string;
  procRoot: string;
  nowMs: number;
}
type ProcRead = { kind: "absent" } | { kind: "unknown"; reason: string } | { kind: "ok"; state: string; ticks: number };

const markerPath = (repo: string, id: string): string => join(repo, ".bisellium", "steps", `${id}.json`);

function parseMarker(text: string, id: string): Marker | string {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return "the marker is not JSON";
  }
  if (!isDict(m)) return "the marker is not an object";
  const posInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
  if (m["schema"] !== 1 || m["opus"] !== id) return "the marker has another schema or opus";
  if (typeof m["step"] !== "string" || !(STEPS as readonly string[]).includes(m["step"])) return "the marker names an unknown step";
  if (!posInt(m["pid"], 2) || !posInt(m["start_ticks"], 1) || !posInt(m["budget_seconds"], 1) || m["budget_seconds"] > 86_400) return "the marker has an invalid pid, start_ticks or budget_seconds";
  if (typeof m["started"] !== "string" || typeof m["output"] !== "string" || !/^steps\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m["output"])) return "the marker has an invalid started or output";
  if (m["writer"] !== "perform" && m["writer"] !== "track") return "the marker has an invalid writer";
  return m as unknown as Marker;
}

function readMarker(repo: string, id: string): MarkerRead | undefined {
  const path = markerPath(repo, id);
  let st;
  try {
    st = lstatSync(path, { bigint: true });
  } catch {
    return undefined;
  }
  const ident: Ident = { ino: st.ino, size: st.size, mtimeNs: st.mtimeNs };
  if (!st.isFile()) return { path, ident, invalid: "the marker is not a regular file" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return { path, ident, invalid: `the marker is unreadable (${(e as NodeJS.ErrnoException).code ?? "error"})` };
  }
  const m = parseMarker(text, id);
  return typeof m === "string" ? { path, ident, invalid: m } : { path, ident, marker: m };
}

/** `/proc/<pid>/stat`: absent (ENOENT) is a proven absence; a failed or unparseable read is `unknown`, never dead. */
function readProc(root: string, pid: number | "self"): ProcRead {
  let text: string;
  try {
    text = readFileSync(`${root}/${pid}/stat`, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT" && pid !== "self" ? { kind: "absent" } : { kind: "unknown", reason: code ?? "unreadable" };
  }
  const close = text.lastIndexOf(")");
  if (close === -1) return { kind: "unknown", reason: "unparseable stat: no closing parenthesis" };
  const rest = text.slice(close + 1).trim().split(/\s+/);
  const state = rest[0];
  const ticks = rest[19];
  if (rest.length < 20) return { kind: "unknown", reason: "unparseable stat: too few fields" };
  if (state === undefined || !/^[A-Za-z]$/.test(state)) return { kind: "unknown", reason: "unparseable stat: the state is not one letter" };
  if (ticks === undefined || !/^[1-9][0-9]*$/.test(ticks)) return { kind: "unknown", reason: "unparseable stat: field 22 is not a positive integer" };
  return { kind: "ok", state, ticks: Number(ticks) };
}

/** Last 4096 bytes of the contained output file, never interpreted. */
function readOutput(repo: string, rel: string): { mtimeMs: number; last?: string } | { error: string } {
  try {
    const abs = join(repo, ".bisellium", rel);
    if (lstatSync(join(repo, ".bisellium")).isSymbolicLink() || lstatSync(dirname(abs)).isSymbolicLink()) return { error: "a symlink on the output path" };
    const fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) return { error: "the output is not a regular file" };
      const len = Math.min(st.size, 4096);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, st.size - len);
      const line = buf.toString("utf8").split(/\r?\n/).filter((l) => l.trim() !== "").pop();
      const last = line === undefined ? undefined : line.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 200);
      return { mtimeMs: st.mtimeMs, ...(last === undefined ? {} : { last }) };
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    return { error: (e as NodeJS.ErrnoException).code ?? (e as Error).message };
  }
}

type Health =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "finished"; step: Step }
  | { kind: "stale" }
  | { kind: "running"; m: Marker; ageS: number; last?: string }
  | { kind: "dead"; m?: Marker; reason: string; ageS?: number; last?: string; stalled?: boolean }
  | { kind: "unknown"; reason: string }
  | { kind: "anomaly"; ageS: number };

function assess(read: MarkerRead | undefined, derived: Step, env: Env): Health {
  if (read === undefined) return { kind: "none" };
  if (read.marker === undefined) return { kind: "invalid", reason: read.invalid ?? "the marker is invalid" };
  const m = read.marker;
  const order = STEPS.indexOf(m.step) - STEPS.indexOf(derived);
  if (order < 0) return { kind: "finished", step: m.step };
  if (order > 0) return { kind: "stale" };
  const out = readOutput(env.repo, m.output);
  const ageS = "error" in out ? undefined : Math.floor((env.nowMs - out.mtimeMs) / 1000);
  const seen = "error" in out ? {} : { ...(ageS === undefined ? {} : { ageS }), ...(out.last === undefined ? {} : { last: out.last }) };
  const dead = (reason: string, stalled = false): Health => ({ kind: "dead", m, reason, ...seen, ...(stalled ? { stalled } : {}) });
  const p = readProc(env.procRoot, m.pid);
  if (p.kind === "unknown") return { kind: "unknown", reason: p.reason };
  if (p.kind === "absent") return dead(`pid ${m.pid} is gone`);
  if (p.state === "Z") return dead(`pid ${m.pid} is a zombie`);
  if (p.ticks !== m.start_ticks) return dead(`pid ${m.pid} was reused (start time ${p.ticks}, the marker recorded ${m.start_ticks})`);
  if ("error" in out) return dead(`output ${m.output} is missing or unreadable (${out.error})`);
  const age = Math.floor((env.nowMs - out.mtimeMs) / 1000);
  if (age < -5) return { kind: "anomaly", ageS: age };
  const clamped = Math.max(0, age);
  if (clamped > m.budget_seconds) return dead(`stalled: no output for ${clamped}s (budget ${m.budget_seconds}s); pid ${m.pid} is still alive and was not killed`, true);
  return { kind: "running", m, ageS: clamped, ...(out.last === undefined ? {} : { last: out.last }) };
}

function newMarker(id: string, step: Step, writer: Marker["writer"], pid: number, ticks: number, output: string, nowMs: number, pollMs: number): Marker {
  const base = STEP_SILENCE_SECONDS[step];
  return { schema: 1, opus: id, step, pid, start_ticks: ticks, started: new Date(nowMs).toISOString(), output, budget_seconds: step === "merge" ? Math.max(base, Math.ceil((6 * pollMs) / 1000)) : base, writer };
}

/** Unlink the marker only if unchanged since it was read, then create exclusively; any surprise refuses. */
function installMarker(read: MarkerRead | undefined, path: string, marker: Marker): string | undefined {
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (read?.ident !== undefined) {
      let now;
      try {
        now = lstatSync(path, { bigint: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (now !== undefined) {
        if (now.ino !== read.ident.ino || now.size !== read.ident.size || now.mtimeNs !== read.ident.mtimeNs) return "the marker changed since it was read; takeover refused";
        unlinkSync(path);
      }
    }
    writeFileSync(path, `${JSON.stringify(marker)}\n`, { flag: "wx" });
    return undefined;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EEXIST" ? "another writer created the marker first; takeover refused" : `could not write the marker: ${(e as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

interface Args {
  id: string;
  perform: boolean;
  expect?: Step;
  budget?: number;
  title?: string;
  bodyFile?: string;
  pollMs: number;
  maxPolls: number;
  repo: string;
  studio: string;
  nowMs: number;
  testClock: boolean;
  track?: { step: Step; pid: string; output: string };
}
const isStep = (v: string): v is Step => (STEPS as readonly string[]).includes(v);

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args | { error: string } {
  const parsed = parseFlags(argv, { valued: ["--expect", "--budget", "--title", "--body-file", "--poll-ms", "--max-polls", "--studio", "--repo", "--now", "--track", "--pid", "--output"], boolean: ["--perform"] });
  if ("error" in parsed) return { error: parsed.error };
  const { values, flags, positionals } = parsed;
  const id = positionals[0];
  if (id === undefined || positionals.length !== 1) return { error: "exactly one <opus> is required" };
  if (!ID_RE.test(id)) return { error: `invalid opus id "${id}"` };
  const testClock = env["BISELLIUM_TEST_CLOCK"] === "1";
  const intIn = (flag: string, lo: number, hi: number, dflt: number): number | string => {
    const v = values.get(flag);
    if (v === undefined) return dflt;
    return /^[0-9]{1,6}$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : `${flag} must be an integer from ${lo} through ${hi}`;
  };
  const pollMs = intIn("--poll-ms", 1, 60_000, 20_000);
  const maxPolls = intIn("--max-polls", 1, 1000, 60);
  if (typeof pollMs === "string") return { error: pollMs };
  if (typeof maxPolls === "string") return { error: maxPolls };
  const a: Args = { id, perform: flags.has("--perform"), pollMs, maxPolls, repo: resolve(values.get("--repo") ?? "."), studio: "", nowMs: Date.now(), testClock };
  a.studio = resolve(values.get("--studio") ?? join(a.repo, "studio"));
  const budget = values.get("--budget");
  if (budget !== undefined) {
    if (!/^[1-9][0-9]{0,9}$/.test(budget)) return { error: "--budget must be a positive integer of at most ten digits" };
    a.budget = Number(budget);
  }
  const expect = values.get("--expect");
  if (expect !== undefined) {
    if (!isStep(expect)) return { error: `--expect must name one of: ${STEPS.join(", ")}` };
    a.expect = expect;
  }
  const title = values.get("--title");
  if (title !== undefined) {
    if (title.length > 256 || /[\r\n]/.test(title)) return { error: "--title must be at most 256 characters with no line break" };
    a.title = title;
  }
  const body = values.get("--body-file");
  if (body !== undefined) {
    try {
      const abs = resolve(body);
      const real = realpathSync(abs);
      const st = statSync(real);
      const inside = (root: string): boolean => {
        const rel = relative(realpathSync(root), real);
        return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      };
      if (!st.isFile() || st.size > 65_536) return { error: "--body-file must be a regular file of at most 64 KiB" };
      if (!inside(a.repo) && !inside(tmpdir())) return { error: "--body-file must lie under the repository or the temp directory" };
      a.bodyFile = real;
    } catch {
      return { error: "--body-file is not readable" };
    }
  }
  const now = values.get("--now");
  if (now !== undefined) {
    if (!testClock) return { error: "--now is accepted only when BISELLIUM_TEST_CLOCK=1" };
    const t = instant(now);
    if (!t) return { error: "--now must be an ISO date" };
    a.nowMs = t.getTime();
  }
  const track = values.get("--track");
  if (track !== undefined) {
    if (!isStep(track) || track === "greenlight" || track === "checkpoint") return { error: "--track must name a step other than greenlight and checkpoint" };
    const pid = values.get("--pid");
    const output = values.get("--output");
    if (pid === undefined || output === undefined) return { error: "--track needs --pid and --output" };
    if (a.perform) return { error: "--track and --perform are mutually exclusive" };
    a.track = { step: track, pid, output };
  } else if (values.has("--pid") || values.has("--output")) return { error: "--pid and --output are for --track" };
  return a;
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

function capture(fn: () => { exitCode: number }): { exit: number; out: string[]; err: string[] } {
  const log = console.log;
  const error = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...a: unknown[]): void => void out.push(a.join(" "));
  console.error = (...a: unknown[]): void => void err.push(a.join(" "));
  try {
    return { exit: fn().exitCode, out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}
const heldResult = (why: string, ...lines: string[]): StepResult => ({ ok: false, lines: [`why: ${why}`, ...lines] });

function performBranch(f: Facts): StepResult {
  const { repo, id, wt } = f;
  const head = git(repo, ["symbolic-ref", "-q", "HEAD"]).stdout.trim();
  if (head !== "refs/heads/master") return heldResult(`refusing: HEAD is ${head === "" ? "detached" : head}, not the master branch`);
  if (git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== git(repo, ["rev-parse", "refs/heads/master"]).stdout.trim()) return heldResult("refusing: HEAD is not at the master tip");
  const dirty = dirtyHold(repo);
  if (dirty !== undefined) return dirty;
  try {
    lstatSync(wt.dir);
    return heldResult(`refusing: ${wt.dir} already exists and is not a registered worktree for opus/${id}`);
  } catch {
    /* absent: the expected case */
  }
  const made = createOpusBranch(repo, id);
  if (!made.ok) return heldResult(made.error ?? "could not create the branch");
  const added = git(repo, ["worktree", "add", "-q", wt.dir, `opus/${id}`]);
  if (added.status !== 0) {
    git(repo, ["update-ref", "-d", `refs/heads/opus/${id}`, git(repo, ["rev-parse", "refs/heads/master"]).stdout.trim()]);
    return heldResult(`git worktree add failed: ${one(added.stderr)}`);
  }
  return { ok: true, lines: [`branch: opus/${id}`, `worktree: ${wt.dir}`] };
}

/** Switch the main checkout back to master: the reason it could not, or `undefined` once HEAD is master. */
function switchBack(repo: string): string | undefined {
  const r = git(repo, ["switch", "-q", "master"]);
  if (r.status !== 0) return one(r.stderr) || `exit ${r.status}`;
  return git(repo, ["symbolic-ref", "-q", "HEAD"]).stdout.trim() === "refs/heads/master" ? undefined : "HEAD is not master after the switch";
}

/**
 * Roll the main checkout back to master after a failed commit on `branch`. The staged paths are unstaged first, and
 * only a fully restored checkout switches and drops the branch: a failed restore stays on the branch, keeps it and
 * returns the recovery text. `undefined` means master is restored.
 */
function rollback(repo: string, branch: string, base: string, staged: string[], drop: boolean): string | undefined {
  if (staged.length > 0) {
    const r = git(repo, ["restore", "-q", "--staged", "--", ...staged]);
    if (r.status !== 0) return `could not unstage (${one(r.stderr) || `exit ${r.status}`}); HEAD stays on ${branch}, which is kept; run: git -C ${quoted(repo)} restore --staged -- ${staged.map(quoted).join(" ")} && git -C ${quoted(repo)} switch master`;
  }
  const back = switchBack(repo);
  if (back !== undefined) return `could not switch back to master (${back}); HEAD is ${branch}: git -C ${quoted(repo)} switch master`;
  if (drop) git(repo, ["update-ref", "-d", `refs/heads/${branch}`, base]);
  return undefined;
}

/** The spec signed in the main checkout, committed onto `spec/<id>`: only the brief and the spec log, nothing else moves. */
function performSpecCommit(f: Facts): StepResult {
  const { repo, id } = f;
  const head = `spec/${id}`;
  const symbolic = git(repo, ["symbolic-ref", "-q", "HEAD"]).stdout.trim();
  if (symbolic !== "refs/heads/master") return heldResult(`refusing: HEAD is ${symbolic === "" ? "detached" : symbolic}, not the master branch`);
  if (git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== git(repo, ["rev-parse", TRUNK]).stdout.trim()) return heldResult("refusing: HEAD is not at the master tip");
  if (refExists(repo, `refs/heads/${head}`)) return heldResult(`refusing: ${head} already exists`);
  const gate = readSpecReviewer(f.manifest, f.trunkRecord ?? {});
  if ("error" in gate) return heldResult(`refusing: ${gate.error}`);
  const spec = specEvidence(fsSrc(f.studioAbs), id, f.design, gate.reviewer, lightAdmission(f));
  if (!spec.ok || spec.log === undefined) return heldResult(`refusing: ${spec.why}`);
  // exactly the brief, the newest signature and (with a reviewer) its one passed review: history stays where it is
  const paths = [briefRel(id), spec.log, ...(spec.gate?.kind === "ready" ? [spec.gate.review] : []), ...(spec.gate?.kind === "split" ? spec.gate.failed : [])].map((p) => `${f.studioRel}/${p}`);
  const base = git(repo, ["rev-parse", TRUNK]).stdout.trim();
  const switched = git(repo, ["switch", "-q", "-c", head]);
  if (switched.status !== 0) return heldResult(`could not create ${head}: ${one(switched.stderr)}`);
  const staged = git(repo, ["add", "--", ...paths]);
  const committed = staged.status === 0 ? git(repo, ["commit", "-q", "-m", `spec(${id}): signed`, "-m", `Co-Authored-By: ${spec.sella ?? f.design} (bisellium next) <noreply@anthropic.com>`, "--", ...paths]) : staged;
  if (committed.status !== 0) {
    const stuck = rollback(repo, head, base, paths, true);
    return heldResult(`could not commit the spec: ${one(committed.stderr)}${stuck === undefined ? "" : `; ${stuck}`}`);
  }
  const back = switchBack(repo);
  if (back !== undefined) return heldResult(`the spec is committed on ${head}, but the main checkout could not switch back to master (${back}); run: git -C ${repo} switch master`);
  return { ok: true, lines: [`branch: ${head}`, `commit: ${git(repo, ["rev-parse", "--short", `refs/heads/${head}`]).stdout.trim()}`] };
}

/** W-206: the signed spec on opus/<id>, committed in its worktree: the brief, every changed spec log and the record, nothing else. */
function performOpusSpecCommit(f: Facts): StepResult {
  const { id, wt } = f;
  if (!wt.usable) return heldResult(`refusing: ${wt.dir} is not a usable worktree on opus/${id}`);
  const changed = f.wtChanges();
  if ("error" in changed) return heldResult(`refusing: ${changed.error}`);
  if (changed.bad.length > 0) return heldResult(`refusing: ${changed.bad.slice(0, 5).map((p) => clean(p)).join(", ")} renamed, removed or rewritten`);
  const record = `${f.studioRel}/${recordRel(id)}`;
  const other = changed.other.filter((p) => p !== record);
  if (other.length > 0) return heldResult(`refusing: ${other.slice(0, 5).map((p) => clean(p)).join(", ")} changed beside the spec; commit or set it aside first`);
  if (changed.spec.length === 0) return heldResult("refusing: no spec change to commit");
  const paths = [...changed.spec, ...changed.other];
  const staged = git(wt.dir, ["add", "--", ...paths]);
  const committed = staged.status === 0 ? git(wt.dir, ["commit", "-q", "-m", `spec(${id}): re-signed on opus/${id}`, "-m", `Co-Authored-By: ${f.design} (bisellium next) <noreply@anthropic.com>`, "--", ...paths]) : staged;
  // ponytail: a failure leaves only these allowed paths staged; the re-derivation names the same commit again
  if (committed.status !== 0) return heldResult(`could not commit the spec on opus/${id}: ${one(committed.stderr)}`);
  return { ok: true, lines: [`branch: opus/${id}`] };
}

/** A landing head may change the officina and `docs/` only: anything else is refused before the push. */
async function performLanding(f: Facts, ctx: Ctx, head: string): Promise<StepResult> {
  const diff = git(f.repo, ["diff", "--name-only", "-z", `${TRUNK}...refs/heads/${head}`]);
  if (diff.status !== 0) return heldResult(`refusing: could not read what ${head} changes: ${one(diff.stderr)}`);
  const outside = diff.stdout.split("\0").filter((p) => p !== "" && !p.startsWith(`${f.studioRel}/`) && !p.startsWith("docs/"));
  if (outside.length > 0) return heldResult(`refusing: ${head} changes ${outside.slice(0, 5).map((p) => clean(p)).join(", ")}, outside the officina and docs/; nothing pushed`);
  return landHead({ ...ctx, head });
}

function performReady(f: Facts, d: Derived): StepResult {
  const sella = d.extra.find(([k]) => k === "attributed")?.[1]?.split(" ")[0] ?? f.design;
  const cap = capture(() => runReady([f.id, "--sella", sella, "--studio", f.wt.usable ? f.wt.studio : f.studioAbs]));
  const text = [...cap.err, ...cap.out].map(one).filter(Boolean);
  return cap.exit === 0 ? { ok: true, lines: cap.out.map((l) => `ready: ${one(l)}`) } : heldResult(text[0] ?? `ready exited ${cap.exit}`, ...text.slice(1, 6).map((l) => `ready: ${l}`));
}

/** W-186: a hold when the real studio's working-tree handoff is stale with this opus done. Reads only; `performDone` is unchanged. */
function handoffHold(f: Facts): StepResult | undefined {
  if (f.studioRel !== "studio") return undefined;
  const held = (findings: { rule: string; where: string; message: string }[]): StepResult =>
    heldResult("refusing: docs/SESSION-HANDOFF.md is stale; fix it, then re-run", ...findings.map((x) => `handoff: ${x.rule} ${x.where}: ${clean(x.message)}`));
  const input = (message: string): StepResult => held([{ rule: "process.handoff.input", where: HANDOFF, message }]);
  const read = handoffInputs(f.repo, f.studioAbs);
  if (read.kind === "error") return input(read.reason);
  if (read.kind === "absent") {
    // no working-tree handoff: only a master that keeps one is a problem
    const tree = git(f.repo, ["ls-tree", "-z", "--name-only", TRUNK, "--", HANDOFF]);
    if (tree.error !== undefined || tree.status !== 0) return input(`master's tree cannot be read: ${tree.error?.message ?? tree.stderr}`);
    return tree.stdout === "" ? undefined : input(`${HANDOFF} is deleted in the working tree, but master keeps it`);
  }
  read.opera.set(f.id, { state: "done", end: new Date().toISOString() });
  const findings = sessionHandoffFindings(read.text, read.opera);
  return findings.length === 0 ? undefined : held(findings);
}

function performDone(f: Facts, d: Derived): StepResult {
  const { repo, id } = f;
  const chore = `chore/done-${id}`;
  if (git(repo, ["symbolic-ref", "-q", "HEAD"]).stdout.trim() !== "refs/heads/master") return heldResult("refusing: done is performed from the main checkout on master");
  // the record, tracked `docs/` changes and verify's certificates may ride along; any other tracked change refuses
  const only = `${f.studioRel}/${recordRel(id)}`;
  const rides = (path: string): boolean => path === only || path.startsWith("docs/");
  const dirty = dirtyHold(repo, rides);
  if (dirty !== undefined) return dirty;
  if (d.act === "verify") return heldResult(`refusing: no automated certificate is recorded; run: ${d.command ?? ""}`);
  if (f.handoff !== undefined) {
    const changes = trackedChanges(repo);
    if (typeof changes === "string" || !changes.some((c) => c.path === HANDOFF)) return heldResult(`refusing: the checkpoint rides the done commit, and ${HANDOFF} has no tracked change; edit it, then re-run`);
  }
  const why = mergeRefusal(repo, id);
  if (why !== undefined) return heldResult(`refusing: ${why}`);
  if (refExists(repo, `refs/heads/${chore}`)) return heldResult(`refusing: ${chore} already exists`);
  const base = git(repo, ["rev-parse", "refs/heads/master"]).stdout.trim();
  const switched = git(repo, ["switch", "-q", "-c", chore]);
  if (switched.status !== 0) return heldResult(`could not create ${chore}: ${one(switched.stderr)}`);
  /** Every failure after the branch was cut ends the same way: see `rollback`; the branch is dropped unless it is kept for inspection. */
  const unwind = (reason: string, staged: string[] = [], drop = true): StepResult => {
    const stuck = rollback(repo, chore, base, staged, drop);
    return heldResult(stuck === undefined ? reason : `${reason}; ${stuck}`);
  };
  const cap = capture(() => runDone([id, "--sella", "producer", "--studio", f.studioAbs], { mergeRefusal }));
  if (cap.exit !== 0) {
    const text = [...cap.err, ...cap.out].map(one).filter(Boolean);
    const r = unwind(text[0] ?? `done exited ${cap.exit}`);
    return { ok: false, lines: [...r.lines, ...text.slice(1, 6).map((l) => `done: ${l}`)] };
  }
  const changes = trackedChanges(repo);
  const changed = typeof changes === "string" ? [] : changes.flatMap(touched);
  if (typeof changes === "string" || changed.some((p) => !rides(p))) {
    const r = unwind(`done changed tracked paths other than ${only} and docs/; nothing committed, ${chore} left for inspection`, [], false);
    return { ok: false, lines: [...r.lines, ...changed.map((p) => `changed: ${p}`)] };
  }
  // verify's certificates are new files: exactly the evidence each automated gate recorded, validated again on the record to be committed
  const cert = certificate(repo, f.studioRel, f.studioAbs, f.excludes, f.manifest, f.trunkRecord, id);
  if (!cert.ok) return unwind(`refusing: the certificate is not committable: ${cert.why}`);
  const stage = [...new Set([only, ...changed, ...cert.stage])];
  const staged = git(repo, ["add", "--", ...stage]);
  const committed = staged.status === 0 ? git(repo, ["commit", "-q", "-m", `chore(studio): mark ${id} done`, "-m", "Co-Authored-By: producer (bisellium next) <noreply@anthropic.com>"]) : staged;
  if (committed.status !== 0) return unwind(`could not commit the done record: ${one(committed.stderr)}`, stage);
  const sha = git(repo, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const back = switchBack(repo);
  if (back !== undefined) return heldResult(`the done record is committed on ${chore} (${sha}), but the main checkout could not switch back to master (${back}); run: git -C ${repo} switch master`);
  return { ok: true, lines: [`branch: ${chore}`, `commit: ${sha}`, ...cap.out.map((l) => `done: ${one(l)}`)] };
}

// ---------------------------------------------------------------------------
// the verb
// ---------------------------------------------------------------------------

/** W-233: the studio each ticketed action writes in: the main checkout, or else the opus's worktree when it is usable. */
const MAIN_ACTIONS = new Set<TicketAction>(["branch", "merge", "done"]);

/**
 * W-233: in a studio that sets `step_tickets: required`, write the ticket for the action `d` names (replacing any
 * earlier one) or delete the pending one when `d` holds, is complete, names the Patron or names no covered verb.
 * Returns the lines to print, the last `ticket: …`; none when the studio does not require tickets.
 */
function refreshTicket(f: Facts, d: Derived, nowMs: number): string[] {
  const setting = readStepTickets(f.manifest);
  if ("error" in setting || !setting.required) return [];
  const none = (...why: string[]): string[] => {
    const bad = setPendingTicket(f.studioAbs, f.id, undefined);
    // fail closed: a stale ticket that could not be deleted is held, never reported as none
    return bad === undefined ? [...why, "ticket: none"] : [...why, `ticket: held, ${bad}`];
  };
  const t = d.status === "named" && d.actor !== "patron" ? d.ticket : undefined;
  if (t === undefined) return none();
  const where = MAIN_ACTIONS.has(t.action) || !f.wt.usable ? f.studioAbs : f.wt.studio;
  const facts = actionFacts(where, f.id);
  if ("error" in facts) return none(`ticket-error: ${facts.error}`);
  const written = setPendingTicket(where, f.id, { opus: f.id, step: d.step, action: t.action, round: t.round, actor: d.actor, studio: facts.studio, head: facts.head, brief: facts.brief, at: new Date(nowMs).toISOString() });
  return written === undefined ? [`ticket: ${t.action} round ${t.round}`] : none(`ticket-error: ${written}`);
}

function render(id: string, d: Derived, f: Facts, status: string): string[] {
  const out = [`next: ${id} ${d.step} ${status}`, `actor: ${d.actor}`, `why: ${one(d.why)}`];
  if (f.tip !== undefined) out.push(`head: opus/${id} ${f.tip.slice(0, 12)}`);
  for (const [k, v] of d.extra) out.push(`${k}: ${one(v)}`);
  if (d.order !== undefined && d.status === "named") {
    const o = d.order;
    out.push(`role: ${o.role}`, `sella: ${o.sella}`, `boot: ${o.boot}`, `budget_tokens: ${o.budget ?? ""}`, `phase: ${o.phase}`);
    if (o.round !== undefined) out.push(`round: ${o.round}`);
    for (const [k, v] of o.extra) out.push(`${k}: ${one(v)}`);
    out.push(`inputs: ${o.inputs.map((x) => clean(x)).join(", ")}`, `command: ${one(o.command)}`);
  } else if (d.command !== undefined && d.status === "named") out.push(`command: ${one(d.command)}`);
  return out;
}

export async function runNext(argv: string[]): Promise<{ exitCode: number }> {
  const usage = (msg: string): { exitCode: number } => {
    console.error(`${msg}\n${NEXT_USAGE}`);
    return { exitCode: 2 };
  };
  const a = parseArgs(argv, process.env);
  if ("error" in a) return usage(a.error);
  const { id, repo } = a;

  const gd = git(repo, ["rev-parse", "--git-dir"]);
  const cd = git(repo, ["rev-parse", "--git-common-dir"]);
  if (gd.status !== 0 || cd.status !== 0) return usage(`${repo} is not a git repository`);
  if (resolve(repo, gd.stdout.trim()) !== resolve(repo, cd.stdout.trim())) return usage(`${repo} is a linked worktree; run next from the repository's main checkout`);
  const opened = openStudio(a.studio);
  if ("error" in opened) return usage(opened.error);
  const opusPath = safeItemPath(join(opened.root, "opera"), id);
  if (typeof opusPath !== "string") return usage(`invalid opus id "${id}"`);
  const rel = relative(realpathSync(repo), realpathSync(opened.root));
  if (rel.startsWith("..") || isAbsolute(rel)) return usage(`--studio ${opened.root} is outside the repository`);

  // W-166: one validator for every reader of source_excludes (brief:108). A malformed value holds here, before
  // `gather`, `deriveNext` (and its lazy gh reads), --track, markers, perform or dispatch: nothing is derived, so
  // the held line carries no step. `gather` reads the same value through the same validator and spreads only a valid list.
  const declaredExcludes = readSourceExcludes(opened.manifest);
  if ("error" in declaredExcludes) {
    console.log(`next: ${id} held\nwhy: ${clean(`bisellium.yml#source_excludes is malformed (${declaredExcludes.error})`, 1000)}`);
    return { exitCode: 1 };
  }

  // W-233: the same hold for a malformed step_tickets, before `gather` and every derivation
  const ticketSetting = readStepTickets(opened.manifest);
  if ("error" in ticketSetting) {
    console.log(`next: ${id} held\nwhy: ${clean(`bisellium.yml#step_tickets is malformed (${ticketSetting.error})`, 1000)}`);
    return { exitCode: 1 };
  }

  let f = gather(repo, opened.root, id);
  if (f.trunkRecord === undefined && f.branchRecord === undefined) return usage(`unknown opus: ${id}`);
  const env: Env = { repo, procRoot: a.testClock && process.env["BISELLIUM_TEST_PROC"] ? process.env["BISELLIUM_TEST_PROC"] : "/proc", nowMs: a.nowMs };
  const derive = (facts: Facts): Derived => gateDispatch(deriveNext(facts), facts, a.budget);

  const say = (code: number, lines: string[]): { exitCode: number } => {
    // the one choke point: every printed line loses its controls (a newline included) and is bounded
    console.log(lines.map((l) => clean(l, 1000)).join("\n"));
    return { exitCode: code };
  };
  const refusal = (d: Derived): { exitCode: number } =>
    say(1, [`next: ${id} ${d.step} held`, `why: refusing: next step for ${id} is ${d.step}, not ${a.expect}`, ...(d.status === "held" ? [`detail: ${one(d.why)}`] : [])]);
  const resume = (d: Derived): string => (d.status === "named" ? one(d.order?.command ?? d.command ?? d.why) : `${d.step} is held: ${one(d.why)}`);

  try {
    const d1 = derive(f);

    // --track: register a step the orchestrator launched itself (an unverified attestation)
    if (a.track !== undefined) {
      const t = a.track;
      const refuse = (why: string): { exitCode: number } => say(1, [`next: ${id} ${t.step} held`, `why: --track refused: ${why}`]);
      if (t.step !== d1.step) return refuse(`${t.step} is not the derived rung (${d1.step})`);
      if (!/^[0-9]+$/.test(t.pid) || Number(t.pid) < 2 || !Number.isSafeInteger(Number(t.pid))) return refuse("--pid must be an integer greater than 1");
      const pid = Number(t.pid);
      if (pid === process.pid || pid === process.ppid) return refuse("--pid names next itself or its parent");
      const read = readMarker(repo, id);
      const h = assess(read, d1.step, env);
      if (h.kind === "running" || h.kind === "unknown" || h.kind === "anomaly") return refuse(h.kind === "running" ? `step ${h.m.step} is running, pid ${h.m.pid}` : `the existing marker's health is ${h.kind}`);
      const p = readProc(env.procRoot, pid);
      if (p.kind !== "ok" || p.state === "Z") return refuse(p.kind === "ok" ? `pid ${pid} is a zombie` : p.kind === "absent" ? `pid ${pid} has no /proc entry` : `pid ${pid}'s /proc entry is ${p.reason}`);
      if (isAbsolute(t.output) || t.output.split("/").some((s) => s === ".." || s === "." || s === "") || !t.output.startsWith("steps/")) return refuse("--output must be a plain path under .bisellium/steps/");
      const contained = readContainedRegularFile(join(repo, ".bisellium"), t.output, "steps");
      if ("error" in contained) return refuse(`--output is not a contained regular file (${contained.error})`);
      const marker = newMarker(id, t.step, "track", pid, p.ticks, t.output, env.nowMs, a.pollMs);
      const bad = installMarker(read, markerPath(repo, id), marker);
      if (bad !== undefined) return refuse(bad);
      return say(0, [`next: ${id} ${t.step} running`, `health: tracked pid ${pid} (writer track, an unverified attestation)`, `output: ${t.output}`]);
    }

    const performable = (d: Derived): boolean => a.perform && d.status === "named" && PERFORMABLE.has(d.step) && (d.step !== "spec" || d.act !== undefined);
    // a `pr` that must be created needs --title and --body-file; without them it only names the command
    const needsText = (d: Derived): boolean => d.step === "pr" && d.pr === undefined && (a.title === undefined || a.bodyFile === undefined);

    // ---- report mode (also --perform on a rung that is only named) ----
    if (!performable(d1)) {
      // W-233: the ticket is refreshed from the ungated derivation, before the --expect check
      const tickets = refreshTicket(f, deriveNext(f), a.nowMs);
      const sayT = (code: number, lines: string[]): { exitCode: number } => say(code, [...lines, ...tickets]);
      if (a.expect !== undefined && a.expect !== d1.step) return refusal(d1);
      const h = assess(readMarker(repo, id), d1.step, env);
      const lines = (status: string): string[] => render(id, d1, f, status);
      switch (h.kind) {
        case "running":
          return sayT(0, [`next: ${id} ${d1.step} running`, `health: running (pid ${h.m.pid}, writer ${h.m.writer}, last output ${h.ageS}s ago)`, ...(h.last === undefined ? [] : [`last-output: ${JSON.stringify(h.last)}`])]);
        case "dead":
          return sayT(1, [`next: ${id} ${d1.step} dead`, `health: dead (${h.reason})`, ...(h.m === undefined ? [] : [`pid: ${h.m.pid}`]), ...(h.ageS === undefined ? [] : [`age: ${h.ageS}s`]), ...(h.last === undefined ? [] : [`last-output: ${JSON.stringify(h.last)}`]), `resume: ${resume(d1)}`]);
        case "invalid":
          return sayT(1, [`next: ${id} ${d1.step} dead`, `health: dead (invalid marker: ${h.reason})`, `resume: ${resume(d1)}`]);
        case "unknown":
          return sayT(1, [`next: ${id} ${d1.step} held`, `health: unknown (${h.reason})`, "why: step health cannot be proven; nothing is performed and the marker is untouched"]);
        case "anomaly":
          return sayT(1, [`next: ${id} ${d1.step} held`, `health: clock anomaly (output mtime is ${-h.ageS}s in the future)`, "why: the output mtime is ahead of the clock; nothing is performed"]);
        default: {
          const note = h.kind === "none" ? "no step recorded" : h.kind === "finished" ? `finished ${h.step}` : "stale marker (evidence regressed)";
          const status = d1.status === "named" ? "named" : d1.status;
          return sayT(d1.status === "held" ? 1 : 0, [...lines(status), `health: ${note}`]);
        }
      }
    }

    // ---- --perform on a performable rung: take the marker, re-derive, check --expect, act once ----
    if (a.expect !== undefined && a.expect !== d1.step) return refusal(d1);
    const read = readMarker(repo, id);
    const h = assess(read, d1.step, env);
    if (h.kind === "running") return say(1, [`next: ${id} ${d1.step} held`, `why: step ${h.m.step} is running, pid ${h.m.pid}`]);
    if (h.kind === "unknown") return say(1, [`next: ${id} ${d1.step} held`, `health: unknown (${h.reason})`, "why: the existing marker's health cannot be proven; nothing is performed"]);
    if (h.kind === "anomaly") return say(1, [`next: ${id} ${d1.step} held`, `health: clock anomaly (output mtime is ${-h.ageS}s in the future)`, "why: nothing is performed"]);
    const own = readProc(env.procRoot, "self");
    if (own.kind !== "ok") return say(1, [`next: ${id} ${d1.step} held`, `why: the verb cannot read its own /proc start time (${own.kind === "absent" ? "absent" : own.reason}); nothing is performed`]);
    const outputRel = `steps/${id}.log`;
    const marker = newMarker(id, d1.step, "perform", process.pid, own.ticks, outputRel, env.nowMs, a.pollMs);
    const taken = installMarker(read, markerPath(repo, id), marker);
    if (taken !== undefined) return say(1, [`next: ${id} ${d1.step} held`, `why: ${taken}`]);
    const ours = readFileSync(markerPath(repo, id), "utf8");
    const log = (line: string): void => {
      try {
        appendFileSync(join(repo, ".bisellium", outputRel), `${new Date().toISOString()} ${one(line)}\n`);
      } catch {
        /* the log is a health aid, never a reason to fail the step */
      }
    };
    log(`take ${d1.step}`);
    try {
      f = gather(repo, opened.root, id);
      const d2 = derive(f);
      if (a.expect !== undefined && a.expect !== d2.step) return refusal(d2);
      if (!performable(d2) || needsText(d2)) return say(d2.status === "held" ? 1 : 0, render(id, d2, f, d2.status));
      // W-233: the ticket for the rung being performed, so `ready` and `done` consume it as a direct call would; the others take none
      for (const l of refreshTicket(f, deriveNext(f), a.nowMs)) log(l);
      const note = read === undefined ? [] : [`health: took over the ${read.marker?.step ?? "invalid"} marker (${h.kind === "dead" ? h.reason : h.kind === "invalid" ? h.reason : h.kind})`];
      const ctx: Ctx = { repo, id, head: `opus/${id}`, wt: f.wt.dir, excludes: f.excludes, pollMs: a.pollMs, maxPolls: a.maxPolls, log, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
      let result: StepResult;
      switch (d2.step) {
        case "branch":
          result = performBranch(f);
          break;
        case "ready":
          result = performReady(f, d2);
          break;
        case "spec":
          result = d2.act === "land" ? await performLanding(f, ctx, `spec/${id}`) : d2.act === "commit-opus" ? performOpusSpecCommit(f) : performSpecCommit(f);
          break;
        case "pr":
          result = openPr(ctx, d2.pr, a.title, a.bodyFile);
          break;
        case "merge":
          result = d2.pr === undefined ? heldResult("no identified PR to merge") : await mergeGate(ctx, d2.pr);
          break;
        case "cleanup":
          result = cleanup(ctx);
          break;
        default:
          result = d2.act === "land" ? await performLanding(f, ctx, `chore/done-${id}`) : (handoffHold(f) ?? performDone(f, d2));
      }
      log(`${d2.step} ${result.ok ? "performed" : "held"}`);
      f = gather(repo, opened.root, id);
      const d3 = deriveNext(f);
      for (const l of refreshTicket(f, d3, a.nowMs)) log(l);
      const after = [`next-step: ${d3.step}`, ...(d3.status === "held" ? [`next-why: ${one(d3.why)}`] : [])];
      return say(result.ok ? 0 : 1, [`next: ${id} ${d2.step} ${result.ok ? "performed" : "held"}`, ...result.lines, ...note, ...after]);
    } finally {
      try {
        if (readFileSync(markerPath(repo, id), "utf8") === ours) unlinkSync(markerPath(repo, id));
      } catch {
        /* already gone */
      }
    }
  } catch (e) {
    console.error(`next: ${id} failed: ${clean((e as Error).message)}`);
    return { exitCode: 1 };
  }
}
