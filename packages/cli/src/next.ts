/**
 * packages/cli/src/next.ts — W-124: `bisellium next <opus>`, the cascade order
 * as a verb. From the record and its evidence alone it derives the ONE legal
 * next step of the twelve-rung ladder (`STEPS`), names it (exact command or
 * dispatch order) or, with `--perform`, performs it, and refuses to skip.
 *
 * Read-only unless `--perform` or `--track` is given. Trunk-side evidence (the
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
import { appendFileSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseFrontMatter, readManifest, resolveSeat, type Manifest } from "@bisellium/adapter-native";
import { sourceTreeHash } from "@bisellium/shim";
import { admitCurrentRunReceipt } from "@bisellium/commands/builder-run.js";
import { censorSella, inspectUiDesignInput, readContainedRegularFile, type NativeRecord } from "@bisellium/commands/opus-model.js";
import { mintDispatchSella, openStudio, parseFlags, safeItemPath } from "@bisellium/commands/writes.js";
import { createOpusBranch } from "./branch.js";
import { ID_RE } from "./check.js";
import { clean, cleanup, git, identifyPr, localTip, MIN_CHECKS, mergeGate, openPr, opusWorktree, settleMerged, type Ctx, type Pr, type PrRead, type StepResult } from "./integrate.js";
import { runDone, runReady } from "./lifecycle.js";
import { checkEvidence, countBehaviours, isModuleLoadFailure, parseLogHeader } from "./rules/evidence.js";

export { MIN_CHECKS };

export const STEPS = ["greenlight", "spec", "branch", "ready", "reds", "build", "review", "pr", "merge", "cleanup", "done", "checkpoint"] as const;
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
  checkpoint: 120,
};

const NEXT_USAGE =
  "usage: bisellium next <opus> [--perform] [--expect <step>] [--budget <tokens>] [--title <text> --body-file <path>] [--poll-ms <n>] [--max-polls <n>] [--studio <dir>] [--repo <dir>] [--now <iso>]\n" +
  "       bisellium next <opus> --track <step> --pid <n> --output <path> [--studio <dir>] [--repo <dir>] [--now <iso>]";

const PERFORMABLE = new Set<Step>(["branch", "ready", "pr", "merge", "cleanup", "done"]);
const SECTIONS = ["Intent", "Files owned", "Interfaces", "Behaviours to test", "Acceptance", "Out of scope"];
const PAST_READY = new Set(["building", "verifying", "review", "done"]);

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

interface SpecEvidence {
  ok: boolean;
  why: string;
  sella?: string;
  log?: string;
  maxRound: number;
  anyLog: boolean;
}
/** The brief with the six design-lex sections AND a passing architect spec log. */
function specEvidence(src: Src | undefined, id: string, design: string): SpecEvidence {
  const none: SpecEvidence = { ok: false, why: "no signed spec on the committed trunk", maxRound: 0, anyLog: false };
  if (src === undefined) return none;
  const brief = src.read(briefRel(id));
  const sectionsOk = brief !== undefined && SECTIONS.every((s) => new RegExp(`^##\\s+${esc(s)}\\s*$`, "im").test(brief));
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
  if (!sectionsOk) return { ...none, why: `${briefRel(id)} is missing or lacks the six design-lex sections`, maxRound, anyLog };
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
  wt: { dir: string; studio: string; usable: boolean };
  trunk: Src | undefined;
  trunkRecord: Dict | undefined;
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
  receipt(): { ok: true } | { ok: false; error: string } | undefined;
  redFindings(): string[];
  uiSpecProblems(): string[];
  uiReviewProblems(): string[];
  /** the authoritative ui-lead input (`ci/<id>-spec-<n>.log`) of a kind: ui opus whose branch carries a valid one */
  uiReviewInput(): string | undefined;
  pr(): PrClass;
  /** newest `# at:` among the opus's reds and review logs, in ms */
  evidenceAt(): number;
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
const refExists = (repo: string, ref: string): boolean => git(repo, ["show-ref", "--verify", "-q", ref]).status === 0;

export function gather(repo: string, studioAbs: string, id: string): Facts {
  const manifest = readManifest(studioAbs);
  const realRepo = realpathSync(repo);
  const studioRel = relative(realRepo, realpathSync(studioAbs)).split("\\").join("/");
  const excludes = [studioRel, ".bisellium", ...(manifest.source_excludes ?? [])];
  const design = manifest.collegia.find((c) => c.id === "design")?.magister ?? "architect";
  const branchRef = `refs/heads/opus/${id}`;
  const tip = localTip(repo, id);
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
    wt,
    trunk,
    trunkRecord,
    branch,
    branchRecord,
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
    pr: memo((): PrClass => classify(repo, tip, identifyPr(repo, id))),
    evidenceAt: memo(() => {
      const times: number[] = [];
      for (const name of branch?.list(`ci/reds/${id}`) ?? []) times.push(Date.parse(parseLogHeader(branch?.read(`ci/reds/${id}/${name}`) ?? "").get("at") ?? ""));
      for (const { name } of reviewLogs(branch, id)) times.push(Date.parse(parseLogHeader(branch?.read(`ci/${name}`) ?? "").get("at") ?? ""));
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

function statSafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function classify(repo: string, tip: string | undefined, read: PrRead): PrClass {
  if (read.kind === "held") return { kind: "held", reason: read.reason };
  if (read.kind === "none") return { kind: "none" };
  const pr = read.pr;
  if (pr.state === "OPEN") return tip !== undefined && pr.headRefOid === tip ? { kind: "open", pr } : { kind: "open-stale", pr };
  if (pr.state !== "MERGED") return { kind: "none" };
  const s = settleMerged(repo, pr, tip);
  // an unverifiable head is left at `merge`: its perform fetches the opus ref and re-checks (or holds naming the oid)
  return s.kind === "settled" ? { kind: "settled", pr } : { kind: s.kind === "unverifiable" ? "behind" : s.kind, pr, reason: s.reason };
}

// ---------------------------------------------------------------------------
// the ladder
// ---------------------------------------------------------------------------

interface Order {
  role: string;
  sella: string;
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
  extra: [string, string][];
}

/** The plain gh and git landing for a head the `pr` rung does not open; it ends on master so the pull can fast-forward after the squash. */
const landing = (head: string, title: string): string =>
  `git push origin ${head}, then gh pr create --base master --head ${head} --title ${JSON.stringify(title)} --body-file <body-file>, then gh pr merge <pr-number> --squash --auto once its checks pass, then git switch master && git pull --ff-only origin master`;

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
  if (state === "halted") return hold("greenlight", `${id} is halted; resume it before the cascade continues`);
  if (state === undefined) return hold("greenlight", `${recordRel(id)} carries no state`);
  if (state === "backlog") return named("greenlight", "patron", `${id} is in the backlog; only the Patron greenlights`, `bisellium greenlight ${id} --studio ${f.studioRel}`);

  // 2 spec (the committed trunk)
  const spec = specEvidence(f.trunk, id, f.design);
  const ui = spec.ok ? f.uiSpecProblems() : [];
  if (!spec.ok || ui.length > 0) {
    const onBranch = specEvidence(f.specBranch, id, f.design);
    if (!spec.ok && onBranch.ok) return named("spec", "producer", `spec signed on spec/${id}, not on master`, landing(`spec/${id}`, `spec(${id}): signed`));
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
    else if (p.kind === "behind") return named("merge", "producer", p.reason, `bisellium next ${id} --perform --expect merge`, [], p.pr);
    else if (f.tip === undefined) return named("branch", "producer", `refs/heads/opus/${id} does not exist`, `bisellium next ${id} --perform --expect branch`);
  }

  if (!settled) {
    const b = f.branchRecord;
    if (b === undefined) return hold("ready", `${recordRel(id)} cannot be read on opus/${id}`);
    // 4 ready
    if (!(PAST_READY.has(str(b["state"]) ?? "") && isDict(b["probationes"]) && isDict(b["probationes"]["spec"]) && b["probationes"]["spec"]["status"] === "passed")) {
      const where = f.wt.usable ? join(".worktrees", id, f.studioRel) : f.studioRel;
      return named("ready", "producer", `${id} is ${str(b["state"]) ?? "unstated"} and the spec gate is not recorded passed on the branch`, `bisellium ready ${id} --sella ${spec.sella ?? f.design} --studio ${where}`, [["attributed", `${spec.sella ?? f.design} (signed ${spec.log})`]]);
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
      });

    // 6 build
    if (!f.wt.usable) return hold("build", `${join(".worktrees", id)} is not a worktree on opus/${id}; run: git worktree add .worktrees/${id} opus/${id}`);
    const gate = reviewGate(f, b);
    const cur = f.curTree();
    const failedNow = gate !== undefined && gate.status === "failed" && cur !== undefined && gate.tree === cur;
    const receipt = f.receipt();
    if ((receipt !== undefined && !receipt.ok) || failedNow)
      return dispatch(f, "build", failedNow ? `review round ${gate?.round} failed at this tree` : receipt !== undefined && !receipt.ok ? receipt.error : "no admissible run receipt", {
        phase: failedNow ? "fix" : "2",
        resume: str(b["run_receipt"]) !== undefined || reviewRounds(f).length > 0,
        inputs: [briefRel(id), ...(failedNow && gate?.evidence !== undefined ? [gate.evidence] : [])],
      });

    // 7 review
    const uiBranch = f.uiReviewProblems();
    if (!(gate !== undefined && gate.status === "passed" && cur !== undefined && gate.tree === cur) || uiBranch.length > 0) {
      const rounds = reviewRounds(f);
      const uiIn = f.uiReviewInput();
      return dispatch(f, "review", uiBranch.length > 0 ? uiBranch.join("; ") : gate === undefined ? "no review gate is recorded" : gate.status === "passed" ? `review round ${gate.round} passed an older tree` : `review round ${gate.round} ${gate.status} at an older tree`, {
        phase: "review",
        round: Math.max(0, ...rounds.map((r) => r.n)) + 1,
        resume: rounds.length > 0,
        inputs: [briefRel(id), ...(uiIn === undefined ? [] : [uiIn]), ...rounds.map((r) => `ci/${r.name}`), `ci/reds/${id}/`],
        ...(uiIn === undefined ? {} : { uiInput: uiIn }),
      });
    }

    // 8 pr, 9 merge
    const p = f.pr();
    if (p.kind === "held") return hold("pr", p.reason);
    if (p.kind === "open") return named("merge", "producer", `PR #${p.pr.number} is OPEN on the local tip ${p.pr.headRefOid.slice(0, 12)}`, `bisellium next ${id} --perform --expect merge`, [], p.pr);
    if (p.kind === "behind") return named("merge", "producer", p.reason, `bisellium next ${id} --perform --expect merge`, [], p.pr);
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
  if (f.choreDone) return named("done", "producer", `done committed on chore/done-${id}, not on master`, `git switch chore/done-${id} && ${landing(`chore/done-${id}`, `chore(studio): mark ${id} done`)}`);
  return named("done", "producer", `${id} is MERGED, fetched and cleaned up; the trunk record is not done`, `bisellium next ${id} --perform --expect done`);
}

function afterDone(f: Facts): Derived {
  const { id } = f;
  const m = f.handoff === undefined ? null : /^(#{1,6})[ \t]+Where things stand(?:[ \t]+\([^\n)]*\))?[ \t]*$/m.exec(f.handoff);
  let section = "";
  if (f.handoff !== undefined && m !== null) {
    const rest = f.handoff.slice(m.index + m[0].length);
    const stop = new RegExp(`^#{1,${m[1]!.length}}[ \\t]`, "m").exec(rest);
    section = stop === null ? rest : rest.slice(0, stop.index);
  }
  if (section.includes(id)) return { step: "checkpoint", status: "complete", actor: "producer", why: `the trunk record is done and the handoff names ${id}`, extra: [] };
  return {
    step: "checkpoint",
    status: "named",
    actor: "producer",
    why: `${id} is done on the trunk; docs/SESSION-HANDOFF.md "Where things stand" does not name it`,
    command: `update docs/SESSION-HANDOFF.md (Where things stand), the progress row and the masthead for ${id}, then republish`,
    extra: [],
  };
}

interface Gate {
  status: string;
  evidence: string | undefined;
  tree: string | undefined;
  round: number | undefined;
}
function reviewGate(f: Facts, rec: Dict): Gate | undefined {
  const reviewId = str((f.manifest as unknown as { review_probatio?: unknown }).review_probatio) ?? "review";
  const g = isDict(rec["probationes"]) ? rec["probationes"][reviewId] : undefined;
  if (!isDict(g) || typeof g["status"] !== "string") return undefined;
  const evidence = str(g["evidence"]);
  const header = evidence === undefined || f.branch === undefined ? undefined : parseLogHeader(f.branch.read(evidence) ?? "");
  const round = Number(/-review-(\d+)\.log$/.exec(evidence ?? "")?.[1]);
  return { status: g["status"], evidence, tree: header?.get("tree"), round: Number.isNaN(round) ? undefined : round };
}
const reviewRounds = (f: Facts): { n: number; name: string }[] => reviewLogs(f.branch, f.id);

// ---------------------------------------------------------------------------
// dispatch orders and the context cap
// ---------------------------------------------------------------------------

function dispatch(f: Facts, step: "spec" | "reds" | "build" | "review", why: string, o: { phase: string; round?: number; resume: boolean; inputs: string[]; extra?: [string, string][]; uiInput?: string }): Derived {
  const { id, studioRel, manifest } = f;
  const builder = (() => {
    const resolved = resolveSeat(manifest, "builder");
    const minted = resolved === undefined ? undefined : mintDispatchSella(resolved, "builder", id, "next");
    return minted !== undefined && "sella" in minted ? minted.sella : "builder";
  })();
  const censor = censorSella(manifest) ?? "qa-lead";
  const inputs = [...o.inputs, `${recordRel(id)}#traditio`];
  let role: string;
  let sella: string;
  let command: string;
  if (step === "spec") {
    role = "architect";
    sella = f.design;
    command = `dispatch ${sella} to sign the spec for ${id}; close out with: bisellium verdict ${id} --round ${o.round} --sella ${sella} --outcome passed --phase spec --studio ${studioRel}`;
  } else if (step === "reds") {
    role = "builder";
    sella = builder;
    command = `dispatch ${sella} (phase 1, reds only, implementation absent); record each red with: bisellium red ${id} --behaviour <n> --sella ${sella} --studio ${studioRel} --repo . -- <cmd…>`;
  } else if (step === "build") {
    role = "builder";
    sella = builder;
    command = `dispatch ${sella} (phase ${o.phase === "fix" ? "fix" : "2"}) through the host seam: bisellium run --sella builder --opus ${id} --studio ${studioRel} -- <builder command…>`;
  } else {
    role = "censor";
    sella = censor;
    command = `dispatch ${sella}; record the transcript with: bisellium verdict ${id} --round ${o.round} --sella ${sella} --outcome <passed|failed>${o.uiInput === undefined ? "" : ` --ui-input ${o.uiInput}`} --studio ${studioRel}; close out with: bisellium review ${id} --pass|--fail --evidence ci/${id}-review-${o.round}.log --round ${o.round} --sella ${sella} --studio ${studioRel}`;
  }
  const actor = step === "review" ? "censor" : step === "spec" ? "architect" : "builder";
  return {
    step,
    status: "named",
    actor,
    why,
    extra: [],
    order: { role, sella, phase: o.phase, inputs, command, ...(o.round === undefined ? {} : { round: o.round }), resume: o.resume, extra: o.extra ?? [] },
  };
}

/** The cap, the declaration and the handover: a dispatch order needs all three. */
function gateDispatch(d: Derived, f: Facts, budget: number | undefined): Derived {
  if (d.status !== "named" || d.order === undefined) return d;
  const refuse = (why: string): Derived => ({ step: d.step, status: "held", actor: d.actor, why, extra: [] });
  if (budget === undefined) return refuse("dispatch budget undeclared");
  if (budget > DISPATCH_TOKEN_CAP) return refuse(`budget ${budget} exceeds DISPATCH_TOKEN_CAP ${DISPATCH_TOKEN_CAP}`);
  if (d.order.resume) {
    const t = (f.branchRecord ?? f.trunkRecord)?.["traditio"];
    const at = isDict(t) ? Date.parse(String(t["at"])) : Number.NaN;
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
    const t = Date.parse(now);
    if (Number.isNaN(t)) return { error: "--now must be an ISO date" };
    a.nowMs = t;
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
const trackedDirty = (cwd: string): string[] => git(cwd, ["status", "--porcelain", "--untracked-files=no"]).stdout.split("\n").filter(Boolean);

function performBranch(f: Facts): StepResult {
  const { repo, id, wt } = f;
  const head = git(repo, ["symbolic-ref", "-q", "HEAD"]).stdout.trim();
  if (head !== "refs/heads/master") return heldResult(`refusing: HEAD is ${head === "" ? "detached" : head}, not the master branch`);
  if (git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== git(repo, ["rev-parse", "refs/heads/master"]).stdout.trim()) return heldResult("refusing: HEAD is not at the master tip");
  const dirty = trackedDirty(repo);
  if (dirty.length > 0) return heldResult("refusing: the working tree has tracked changes", ...dirty.slice(0, 10).map((l) => `dirty: ${clean(l)}`));
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

function performReady(f: Facts, d: Derived): StepResult {
  const sella = d.extra.find(([k]) => k === "attributed")?.[1]?.split(" ")[0] ?? f.design;
  const cap = capture(() => runReady([f.id, "--sella", sella, "--studio", f.wt.usable ? f.wt.studio : f.studioAbs]));
  const text = [...cap.err, ...cap.out].map(one).filter(Boolean);
  return cap.exit === 0 ? { ok: true, lines: cap.out.map((l) => `ready: ${one(l)}`) } : heldResult(text[0] ?? `ready exited ${cap.exit}`, ...text.slice(1, 6).map((l) => `ready: ${l}`));
}

function performDone(f: Facts): StepResult {
  const { repo, id } = f;
  const chore = `chore/done-${id}`;
  if (git(repo, ["symbolic-ref", "-q", "HEAD"]).stdout.trim() !== "refs/heads/master") return heldResult("refusing: done is performed from the main checkout on master");
  const dirty = trackedDirty(repo);
  if (dirty.length > 0) return heldResult("refusing: the working tree has tracked changes", ...dirty.slice(0, 10).map((l) => `dirty: ${clean(l)}`));
  const read = identifyPr(repo, id);
  if (read.kind === "held") return heldResult(read.reason);
  if (read.kind === "none" || read.pr.state !== "MERGED") return heldResult(`refusing: a fresh read finds no MERGED PR for opus/${id}`);
  const s = settleMerged(repo, read.pr, localTip(repo, id));
  if (s.kind !== "settled") return heldResult(`refusing: ${s.reason}`);
  if (refExists(repo, `refs/heads/${chore}`)) return heldResult(`refusing: ${chore} already exists`);
  const base = git(repo, ["rev-parse", "refs/heads/master"]).stdout.trim();
  const switched = git(repo, ["switch", "-q", "-c", chore]);
  if (switched.status !== 0) return heldResult(`could not create ${chore}: ${one(switched.stderr)}`);
  const back = (): void => {
    git(repo, ["switch", "-q", "master"]);
    git(repo, ["update-ref", "-d", `refs/heads/${chore}`, base]);
  };
  const cap = capture(() => runDone([id, "--sella", "producer", "--studio", f.studioAbs]));
  if (cap.exit !== 0) {
    back();
    const text = [...cap.err, ...cap.out].map(one).filter(Boolean);
    return heldResult(text[0] ?? `done exited ${cap.exit}`, ...text.slice(1, 6).map((l) => `done: ${l}`));
  }
  const only = `${f.studioRel}/${recordRel(id)}`;
  const changed = trackedDirty(repo).map((l) => l.slice(3));
  if (changed.length !== 1 || changed[0] !== only) return heldResult(`done changed tracked paths other than ${only}; nothing committed, ${chore} left for inspection`, ...changed.map((p) => `changed: ${p}`));
  const staged = git(repo, ["add", "--", only]);
  const committed = staged.status === 0 ? git(repo, ["commit", "-q", "-m", `chore(studio): mark ${id} done`, "-m", "Co-Authored-By: producer (bisellium next) <noreply@anthropic.com>"]) : staged;
  if (committed.status !== 0) return heldResult(`could not commit the done record: ${one(committed.stderr)}; ${chore} left for inspection`);
  const sha = git(repo, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  git(repo, ["switch", "-q", "master"]);
  return { ok: true, lines: [`branch: ${chore}`, `commit: ${sha}`, ...cap.out.map((l) => `done: ${one(l)}`)] };
}

// ---------------------------------------------------------------------------
// the verb
// ---------------------------------------------------------------------------

function render(id: string, d: Derived, f: Facts, status: string): string[] {
  const out = [`next: ${id} ${d.step} ${status}`, `actor: ${d.actor}`, `why: ${one(d.why)}`];
  if (f.tip !== undefined) out.push(`head: opus/${id} ${f.tip.slice(0, 12)}`);
  for (const [k, v] of d.extra) out.push(`${k}: ${one(v)}`);
  if (d.order !== undefined && d.status === "named") {
    const o = d.order;
    out.push(`role: ${o.role}`, `sella: ${o.sella}`, `budget_tokens: ${o.budget ?? ""}`, `phase: ${o.phase}`);
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

    const performable = (d: Derived): boolean => a.perform && d.status === "named" && PERFORMABLE.has(d.step);
    // a `pr` that must be created needs --title and --body-file; without them it only names the command
    const needsText = (d: Derived): boolean => d.step === "pr" && d.pr === undefined && (a.title === undefined || a.bodyFile === undefined);

    // ---- report mode (also --perform on a rung that is only named) ----
    if (!performable(d1)) {
      if (a.expect !== undefined && a.expect !== d1.step) return refusal(d1);
      const h = assess(readMarker(repo, id), d1.step, env);
      const lines = (status: string): string[] => render(id, d1, f, status);
      switch (h.kind) {
        case "running":
          return say(0, [`next: ${id} ${d1.step} running`, `health: running (pid ${h.m.pid}, writer ${h.m.writer}, last output ${h.ageS}s ago)`, ...(h.last === undefined ? [] : [`last-output: ${JSON.stringify(h.last)}`])]);
        case "dead":
          return say(1, [`next: ${id} ${d1.step} dead`, `health: dead (${h.reason})`, ...(h.m === undefined ? [] : [`pid: ${h.m.pid}`]), ...(h.ageS === undefined ? [] : [`age: ${h.ageS}s`]), ...(h.last === undefined ? [] : [`last-output: ${JSON.stringify(h.last)}`]), `resume: ${resume(d1)}`]);
        case "invalid":
          return say(1, [`next: ${id} ${d1.step} dead`, `health: dead (invalid marker: ${h.reason})`, `resume: ${resume(d1)}`]);
        case "unknown":
          return say(1, [`next: ${id} ${d1.step} held`, `health: unknown (${h.reason})`, "why: step health cannot be proven; nothing is performed and the marker is untouched"]);
        case "anomaly":
          return say(1, [`next: ${id} ${d1.step} held`, `health: clock anomaly (output mtime is ${-h.ageS}s in the future)`, "why: the output mtime is ahead of the clock; nothing is performed"]);
        default: {
          const note = h.kind === "none" ? "no step recorded" : h.kind === "finished" ? `finished ${h.step}` : "stale marker (evidence regressed)";
          const status = d1.status === "named" ? "named" : d1.status;
          return say(d1.status === "held" ? 1 : 0, [...lines(status), `health: ${note}`]);
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
      const note = read === undefined ? [] : [`health: took over the ${read.marker?.step ?? "invalid"} marker (${h.kind === "dead" ? h.reason : h.kind === "invalid" ? h.reason : h.kind})`];
      const ctx: Ctx = { repo, id, wt: f.wt.dir, excludes: f.excludes, pollMs: a.pollMs, maxPolls: a.maxPolls, log, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
      let result: StepResult;
      switch (d2.step) {
        case "branch":
          result = performBranch(f);
          break;
        case "ready":
          result = performReady(f, d2);
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
          result = performDone(f);
      }
      log(`${d2.step} ${result.ok ? "performed" : "held"}`);
      f = gather(repo, opened.root, id);
      const d3 = deriveNext(f);
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
