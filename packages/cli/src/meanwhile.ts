/**
 * packages/cli/src/meanwhile.ts — W-547: whenever `next` names a wait, it names a `meanwhile:` step beside it. The step
 * comes from one ranked table keyed by the kind of wait (`MEANWHILE`), filtered by locks computed from live state
 * (`readLocks`): a perform that writes main (a live merge or done step marker of any opus), a stash pushed into main
 * under a live perform, the heavy-job slots in use (open run receipts of `ci --opus` and `verify`) and the spec ahead
 * (the queue's next entry: drafted at most one ahead, and a signed spec not yet reviewed is still ahead). The table is
 * the leads' overlap meet 2026-11-09 (`~/.bisellium-evidence/overlap-meet-1109/collated.md`). `land` and `retro --daily`
 * refuse while a perform writes main (`mainWriter`), and `next` holds a spec review order while one does or while main
 * is stashed under one. Reads only: it writes nothing. See studio/briefs/W-547.md.
 */
import { lstatSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { HOST_RUN_TIMEOUT_MS } from "@bisellium/commands/builder-run.js";
import { loadMarkers, loadReceipt, walkReal, walkStudio } from "./inputs.js";
import { clean, git } from "./integrate.js";
import type { Derived } from "./next.js";
import type { QueueFile, QueueRead } from "./queue.js";

/** Every kind of wait `next` names. A derivation `waitOf` reads as none of them is no wait: the caller acts next. */
export const WAIT_KINDS = ["merge-queue", "suite", "codex-review", "approval", "agent"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

/** The steps a wait may host, in rank order: the first one owed and not forbidden is the one named. */
export const MEANWHILE_STEPS = ["retro", "spec-review", "spec-draft", "records", "drafts"] as const;
export type MeanwhileStep = (typeof MEANWHILE_STEPS)[number];

/** The heavy-job slots on trial on this host (docs/SESSION-HANDOFF.md); W-183's machine-wide queue replaces this count. */
export const HEAVY_SLOTS = 3;

export interface Row {
  /** What is waited on, in a few words. */
  on: string;
  /** Each step the table forbids during this wait, with the conflict that forbids it. */
  forbids: Partial<Record<MeanwhileStep, string>>;
  /** What no meanwhile step may do during this wait. */
  never: string;
}

/** W-547: the overlap meet's table, one row per wait kind (call a and d, unanimous). */
export const MEANWHILE: Record<WaitKind, Row> = {
  "merge-queue": {
    on: "the merge queue, its checks and CodeQL",
    forbids: {
      retro: "the merge perform fast-forwards main when the PR lands",
      records: "a land moves master under the queue",
      "spec-review": "main moves when the PR lands, so a review reads a moving base",
    },
    never: "no tracked edit in main and no land until the perform exits",
  },
  suite: {
    on: "ci --opus, the one full suite, in the opus worktree",
    forbids: {},
    never: "no edit in the opus worktree or to its Files owned",
  },
  "codex-review": {
    on: "a Codex review",
    forbids: {},
    never: "no edit in the opus worktree or to its Files owned",
  },
  approval: {
    on: "the Patron",
    forbids: {},
    never: "no push to the PR branch, which dismisses an approval",
  },
  agent: {
    on: "a dispatched session (builder, architect or ui-lead)",
    forbids: {},
    never: "no edit to the opus's Files owned or its worktree",
  },
};

const CI_OPUS = /(?<![\p{L}\p{M}\p{N}_])ci --opus(?![\p{L}\p{M}\p{N}_])/u;

/** W-547: the kind of wait a derivation names, or undefined when the caller acts next (a hold that asks a fix, a quick rung). */
export function waitOf(d: Derived): WaitKind | undefined {
  if (d.actor === "patron") return "approval";
  // W-377: a kind: ui opus's pr or merge waits for the Patron's ruling on its screens (the one uncut hold at those rungs)
  if (d.status === "held") return d.uncut === true && (d.step === "pr" || d.step === "merge") ? "approval" : undefined;
  if (d.status !== "named") return undefined;
  const role = d.order?.role;
  if (role === "censor" || role === "spec-reviewer") return "codex-review";
  if (role === "builder" || role === "architect" || role === "ui-lead") return "agent";
  if (d.step === "merge" || (d.step === "done" && d.act === "land")) return "merge-queue";
  if (d.step === "review" && d.act === "fix-check") return "codex-review";
  if ((d.step === "build" && d.actor === "producer" && CI_OPUS.test(d.command ?? "")) || (d.step === "reds" && d.act === "replay") || (d.step === "pr" && d.act === "rewrite")) return "suite";
  return undefined;
}

/** The locks, read from live state. Each is a short phrase naming what holds it, or undefined when it is free. */
export interface Locks {
  /** A perform that writes main: a live merge or done marker, `W-542 merge`. */
  writer?: string;
  /** A stash pushed into main under a live perform, `stash@{0} under W-542 merge`. */
  stash?: string;
  /** Heavy jobs running: open `ci --opus` and `verify` run receipts. */
  heavy: number;
  /** A run receipt that cannot be read or is outside its domain: heavy capacity is unavailable, so no step runs a test. */
  heavyError?: string;
}

/** What `readLocks` returns: the locks, or the read or shape error of a writer or stash input (the caller refuses or holds on it). */
export type LockRead = Locks | { error: string };

/** The spec ahead: the queue's next entry and what its spec needs (`draft`: the architect's; `review`: signed, not reviewed). */
export interface Ahead {
  opus: string;
  spec: "draft" | "review" | undefined;
}

export interface Owed {
  /** The daily retro's day when a step of it is left. */
  retro?: string;
  ahead?: Ahead;
  /** The queue, a queued record or the next entry's derivation cannot be read: nothing is named. */
  aheadError?: string;
  studioRel: string;
}

/** W-547: the steps a wait may host now, ranked, each with the reason it is not the one named; the first with none is named. */
export function meanwhileSteps(kind: WaitKind, locks: Locks, owed: Owed): { step: MeanwhileStep; text: string; not?: string }[] {
  const row = MEANWHILE[kind];
  const s = owed.studioRel;
  const ahead = owed.ahead;
  const slots = locks.heavyError !== undefined ? `heavy-job slots unavailable (${locks.heavyError})` : `${locks.heavy} of ${HEAVY_SLOTS} heavy-job slots in use`;
  const full = locks.heavyError !== undefined || locks.heavy >= HEAVY_SLOTS;
  const steps: { step: MeanwhileStep; text: string; not?: string }[] = [];
  const add = (step: MeanwhileStep, text: string, owing: string | undefined, lock?: string): void => {
    const not = owing ?? row.forbids[step] ?? lock;
    steps.push({ step, text, ...(not === undefined ? {} : { not }) });
  };
  add("retro", `the daily retro of ${owed.retro ?? "the previous day"}: bisellium retro --daily --studio ${s}, the qa-lead's proposals, then its land`, owed.retro === undefined ? "none owed" : undefined, locks.writer === undefined ? undefined : `${locks.writer} writes main`);
  add(
    "spec-review",
    `the Codex review of ${ahead?.opus ?? "the next entry"}'s signed spec: bisellium next ${ahead?.opus ?? "<next>"} --budget <tokens> names it`,
    ahead?.spec === "review" ? undefined : "no signed spec ahead",
    locks.writer !== undefined ? `${locks.writer} writes main` : locks.stash !== undefined ? `main is stashed (${locks.stash})` : undefined,
  );
  add(
    "spec-draft",
    `draft ${ahead?.opus ?? "the next entry"}'s spec in its own scratch worktree (.worktrees/${ahead?.opus ?? "<next>"}-spec)${full ? `, with no test run: ${slots}` : `; single test files only, ${slots}`}`,
    ahead?.spec === "draft" ? undefined : ahead === undefined ? "no next entry in the queue" : ahead.spec === "review" ? `${ahead.opus}'s signed spec is ahead already` : `no spec draft owed by ${ahead.opus}`,
  );
  add("records", `file and land records from main: bisellium land <paths> --title <title> --sella producer --studio ${s}`, undefined, locks.writer === undefined ? undefined : `${locks.writer} writes main`);
  add("drafts", "draft in ~/.bisellium-evidence: a leads' meet, the checkpoint row or the dossier", undefined);
  return steps;
}

/** W-547: the two lines `next` prints beside a wait: the step named, the steps passed over and why, and the locks read. A lock
 *  or queue read error names no step: the wait is held on it, never a recommendation read from a broken input. */
export function meanwhileLines(kind: WaitKind, read: LockRead, owed: Owed): string[] {
  const row = MEANWHILE[kind];
  const error = "error" in read ? read.error : owed.aheadError;
  if (error !== undefined) return [`meanwhile: ${kind} wait on ${row.on}: held: ${error}; no step is named until it reads; ${row.never}`, `meanwhile-locks: unreadable: ${error}`];
  const locks = read as Locks;
  const steps = meanwhileSteps(kind, locks, owed);
  const named = steps.find((x) => x.not === undefined) ?? steps[steps.length - 1]!;
  const passed = steps.filter((x) => x !== named && x.not !== undefined && x.not !== "none owed" && !x.not.startsWith("no ")).map((x) => `${x.step} (${x.not})`);
  return [
    `meanwhile: ${kind} wait on ${row.on}: ${named.step}: ${named.text}; ${row.never}${passed.length === 0 ? "" : `; not now: ${passed.join(", ")}`}`,
    `meanwhile-locks: writer ${locks.writer ?? "none"} · stash ${locks.stash ?? "none"} · heavy ${locks.heavyError === undefined ? `${locks.heavy} of ${HEAVY_SLOTS}` : "unavailable"} · ahead ${owed.ahead === undefined ? "none" : `${owed.ahead.opus} ${owed.ahead.spec ?? "nothing owed"}`}`,
  ];
}

/** W-547: the queue's next entry after `id`: in the queue whose lane holds `id`, the first ranked entry that is not `id`, is in a takeable state and is held by no lane. */
export function nextEntry(file: QueueFile, id: string, stateOf: (opus: string) => string | undefined): string | undefined {
  const takeable = new Set(["greenlit", "building", "verifying", "review"]);
  const q = file.queues.find((x) => x.lanes.some(([, opus]) => opus === id));
  if (q === undefined) return undefined;
  const held = new Set(file.queues.flatMap((x) => x.lanes.map(([, opus]) => opus)).filter((o): o is string => o !== undefined));
  return q.next.find((e) => e.opus !== id && !held.has(e.opus) && takeable.has(stateOf(e.opus) ?? ""))?.opus;
}

/** W-547: what the next entry's derivation says its spec needs: the architect's draft, the Codex review of a signed spec, or neither. */
export function specAhead(d: Derived): Ahead["spec"] {
  if (d.step !== "spec" || d.status !== "named") return undefined;
  if (d.order?.role === "spec-reviewer") return "review";
  return d.order?.role === "architect" ? "draft" : undefined;
}

/** W-547: the spec ahead from the queue read, each queued opus's state and the next entry's derivation. An absent queue is no
 *  entry; a held queue (unreadable or malformed), a state read that throws (an unreadable record, no front matter, no state)
 *  and a derivation that throws are each an error, so the meanwhile line holds instead of naming a step. */
export function aheadIn(queue: QueueRead, id: string, stateOf: (opus: string) => string, derive: (opus: string) => Derived): Pick<Owed, "ahead" | "aheadError"> {
  if (queue.kind === "absent") return {};
  if (queue.kind !== "ok") return { aheadError: queue.why };
  try {
    const opus = nextEntry(queue.file, id, stateOf);
    if (opus === undefined) return {};
    return { ahead: { opus, spec: specAhead(derive(opus)) } };
  } catch (e) {
    return { aheadError: `the spec ahead cannot be read: ${clean(e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e))}` };
  }
}

// ---------------------------------------------------------------------------
// the locks, from live state. One rule for every input (studio/briefs/W-547.md, Input domain): a valid absence (ENOENT of a
// collection, no refs/stash) is no lock; every other read failure or form outside the input's domain is an error, which
// `readLocks` and `mainWriter` return so `land` and `retro --daily` refuse and `next` holds. Receipts alone degrade: an
// error there marks heavy capacity unavailable (no step runs a test), since the slots never refuse or hold a verb.
// ---------------------------------------------------------------------------

type Read<T> = { ok: T } | { error: string };
const code = (e: unknown): string => (e as NodeJS.ErrnoException).code ?? (e as Error).message;
const absent = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === "ENOENT";

/** The main checkout of the repository holding `dir`: the parent of its common git directory. git must exit 0 with an absolute path named `.git`; every other answer (no git, not a repository, a bare or unsupported layout) is an error. */
export function mainCheckout(dir: string): Read<string> {
  const r = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const common = r.stdout.trim();
  if (r.error !== undefined || r.status !== 0) return { error: `the main checkout cannot be found from ${dir}: git rev-parse --git-common-dir ${r.error !== undefined ? r.error.message : `exited ${r.status}`}` };
  if (!isAbsolute(common) || basename(common) !== ".git") return { error: `the main checkout cannot be found from ${dir}: the git common directory ${JSON.stringify(common.slice(0, 200))} is not an absolute path named .git` };
  return { ok: dirname(common) };
}

/** A live step marker: its output written within the marker's own silence budget of `nowMs` (each sandboxed call has its own pid namespace, so a pid proves nothing here). */
interface Live {
  opus: string;
  step: string;
  /** The marker file's mtime: when the perform took the step. */
  sinceMs: number;
}

/** Every live marker under `<main>/.bisellium/steps/` (W-558: `loadMarkers`, whose step is one of `STEPS` and whose `.json` output is no candidate); an absent directory is none; an unreadable output, or one ahead of the clock, is an error. */
function liveMarkers(main: string, nowMs: number): Read<Live[]> {
  const steps = join(main, ".bisellium", "steps");
  const read = loadMarkers(main);
  if (read.kind === "absent") return { ok: [] };
  if (read.kind === "error") return { error: read.why };
  const live: Live[] = [];
  for (const { name, marker } of read.value) {
    const at = `.bisellium/steps/${name}`;
    const { opus, step, output, budget_seconds: budget } = marker;
    let outMs: number;
    let sinceMs: number;
    try {
      const st = lstatSync(join(main, ".bisellium", output));
      if (!st.isFile()) return { error: `the output .bisellium/${output} of ${at} is not a regular file` };
      outMs = st.mtimeMs;
      sinceMs = lstatSync(join(steps, name)).mtimeMs;
    } catch (e) {
      return { error: `the output .bisellium/${output} of ${at} cannot be read (${code(e)})` };
    }
    const age = (nowMs - outMs) / 1000;
    if (age < -5) return { error: `the output .bisellium/${output} of ${at} is ${Math.round(-age)}s ahead of the clock` };
    if (age <= budget) live.push({ opus, step, sinceMs });
  }
  return { ok: live };
}

const writerOf = (live: Live[]): string | undefined => {
  const w = live.find((m) => m.step === "merge" || m.step === "done");
  return w === undefined ? undefined : `${w.opus} ${w.step}`;
};

/** W-547: the perform writing main now, `W-542 merge`: a live merge or done marker of any opus in `dir`'s main checkout; an error when the main checkout or any marker cannot be read (`land` and `retro --daily` refuse on it). */
export function mainWriter(dir: string, nowMs: number): { writer?: string } | { error: string } {
  const main = mainCheckout(dir);
  if ("error" in main) return main;
  const live = liveMarkers(main.ok, nowMs);
  if ("error" in live) return live;
  const writer = writerOf(live.ok);
  return writer === undefined ? {} : { writer };
}

const STASH = /^([0-9]{1,15}) (stash@\{0\})$/;

/** The newest stash entry pushed into the main checkout after a live perform took its step: none with no live perform, or when `git rev-parse -q --verify refs/stash` exits 1 printing nothing on either stream; any other answer, and a reflog read that does not exit 0 with exactly one `<seconds> stash@{0}` line, is an error. */
function stashUnder(main: string, live: Live[]): Read<string | undefined> {
  if (live.length === 0) return { ok: undefined };
  const has = git(main, ["rev-parse", "-q", "--verify", "refs/stash"]);
  if (has.error === undefined && has.status === 1 && has.stdout.trim() === "" && has.stderr.trim() === "") return { ok: undefined };
  if (has.error !== undefined || has.status !== 0) return { error: `refs/stash cannot be read: git rev-parse ${has.error !== undefined ? has.error.message : `exited ${has.status}${has.stderr.trim() === "" ? "" : `: ${clean(has.stderr.trim().split("\n")[0] ?? "")}`}`}` };
  const r = git(main, ["log", "-g", "-1", "--format=%ct %gd", "refs/stash"]);
  const m = r.error === undefined && r.status === 0 ? STASH.exec(r.stdout.trim()) : null;
  if (m === null) return { error: `the stash reflog cannot be read: git log -g ${r.error !== undefined ? r.error.message : r.status !== 0 ? `exited ${r.status}` : "printed no one seconds/name record"}` };
  const atMs = Number(m[1]) * 1000;
  const under = live.find((l) => atMs >= Math.floor(l.sinceMs / 1000) * 1000);
  return { ok: under === undefined ? undefined : `${m[2]} under ${under.opus} ${under.step}` };
}

const isHeavy = (cmd: string[]): boolean => {
  const at = cmd.indexOf("ci");
  return (at !== -1 && cmd.slice(at + 1).includes("--opus")) || cmd.includes("verify");
};

/** Open heavy run receipts under one studio: a receipt with no `endedAt`, written within the host run timeout of `nowMs`. An absent receipts directory counts zero; an unreadable collection or recent receipt, or one outside the receipt domain, is an error. */
function openHeavy(studio: string, nowMs: number, main: string): Read<number> {
  // W-558 (r1 fix): the studio's components below the main checkout are real directories (the one walk, `walkStudio`)
  const below = walkStudio(studio, main);
  if (below.kind === "error") return { error: below.why };
  if (below.kind === "absent") return { ok: 0 };
  let n = 0;
  let sellae: string[];
  try {
    sellae = readdirSync(join(studio, "receipts"));
  } catch (e) {
    return absent(e) ? { ok: 0 } : { error: `${join(studio, "receipts")} cannot be listed (${code(e)})` };
  }
  for (const sella of sellae.sort()) {
    let names: string[];
    try {
      names = readdirSync(join(studio, "receipts", sella));
    } catch (e) {
      return { error: `${join(studio, "receipts", sella)} cannot be listed (${code(e)})` };
    }
    for (const name of names.filter((x) => x.endsWith(".json")).sort()) {
      const at = join(studio, "receipts", sella, name);
      try {
        if (nowMs - statSync(at).mtimeMs > HOST_RUN_TIMEOUT_MS) continue;
      } catch (e) {
        return { error: `the receipt ${at} cannot be read (${code(e)})` };
      }
      // W-558: the receipt loader; a receipt that vanished after its stat is an error, as the stat's own failure is
      const read = loadReceipt(studio, sella, name, main);
      if (read.kind !== "valid") return { error: read.kind === "absent" ? `the receipt ${at} cannot be read (ENOENT)` : `the receipt ${read.why}` };
      if (read.value.endedAt === undefined && isHeavy(read.value.cmd)) n++;
    }
  }
  return { ok: n };
}

/** The heavy slots in use in main's studio and each opus worktree's (`.worktrees/<id>`): an absent `.worktrees` is none. */
function heavyIn(main: string, studioRel: string, nowMs: number): Read<number> {
  const first = openHeavy(join(main, studioRel), nowMs, main);
  if ("error" in first) return first;
  let heavy = first.ok;
  let wts: string[];
  // W-558 (r1 fix): `.worktrees` is a real directory (the one walk); a symlinked one is an error, a missing one none
  const dir = walkReal(main, ".worktrees");
  if (dir.kind === "error") return { error: dir.why };
  try {
    wts = dir.kind === "absent" ? [] : readdirSync(join(main, ".worktrees"));
  } catch (e) {
    if (!absent(e)) return { error: `.worktrees cannot be listed (${code(e)})` };
    wts = [];
  }
  for (const name of wts.filter((x) => /^[A-Z]+-[0-9]+$/.test(x)).sort()) {
    const one = openHeavy(join(main, ".worktrees", name, studioRel), nowMs, main);
    if ("error" in one) return one;
    heavy += one.ok;
  }
  return { ok: heavy };
}

/** W-547: the locks of `repo`'s main checkout at `nowMs`: an error when the main checkout, a marker or the stash cannot be read; a receipt error marks heavy capacity unavailable. */
export function readLocks(repo: string, studioRel: string, nowMs: number): LockRead {
  const main = mainCheckout(repo);
  if ("error" in main) return main;
  const live = liveMarkers(main.ok, nowMs);
  if ("error" in live) return live;
  const stash = stashUnder(main.ok, live.ok);
  if ("error" in stash) return stash;
  const writer = writerOf(live.ok);
  const heavy = heavyIn(main.ok, studioRel, nowMs);
  return {
    ...(writer === undefined ? {} : { writer }),
    ...(stash.ok === undefined ? {} : { stash: stash.ok }),
    ...("error" in heavy ? { heavy: 0, heavyError: heavy.error } : { heavy: heavy.ok }),
  };
}
