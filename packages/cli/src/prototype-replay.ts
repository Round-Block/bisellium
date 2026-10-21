/**
 * packages/cli/src/prototype-replay.ts — W-326: the architect's signed prototype, replayed by `next <id> --perform --expect
 * reds` instead of a builder. The brief names the prototype on one line, `Prototype: <path> sha256:<64 hex>`: a
 * `git format-patch --stdout` series of the architect's staged commits, in order, for each behaviour k an optional
 * `test(<id>): row b<k>, red` patch (required for behaviour 1) and then one `feat(<id>): behaviour <k>` patch. The
 * signature pins the brief's blob (W-206), so the digest the replay checks is the one the spec review judged.
 *
 * Everything here reads except `amPatch` (a `git am` in the opus worktree) and `writeAttempt` (the attempt marker). A
 * rejection is a reason (`why`), never a throw: the reds order then names a builder, as before W-326. A record or git
 * state that cannot be read is a reason too, never "nothing there".
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureRealDirectory } from "@bisellium/commands/ids.js";
import { behaviourItems } from "@bisellium/commands/brief-admission.js";
import { countBehaviours } from "./rules/evidence.js";

/** The cap on the series file: a prototype is a few source files, never a vendored tree. */
export const SERIES_MAX_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 60_000;
const ATTEMPT = /^prototype\s*:/i;
const LINE = /^Prototype: ((?:\/|~\/)\S+) sha256:([0-9a-f]{64})$/;
const FROM = /^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001$/;
const SUBJECT = /^Subject: (?:\[PATCH(?: [1-9][0-9]*\/[1-9][0-9]*)?\] )?(.*)$/;
/** The characters a red command word may hold outside single quotes: no shell expansion, quoting or redirection. */
const PLAIN = /^[A-Za-z0-9_./=:@%+,^-]$/;

export interface Prototype {
  /** as the brief names it */
  named: string;
  /** absolute, `~/` expanded */
  path: string;
  digest: string;
}
export interface Patch {
  role: "test" | "feat";
  behaviour: number;
  subject: string;
  /** one format-patch message, from its From line, as `git am` reads it */
  text: string;
}
export interface Replay {
  line: string;
  patches: Patch[];
  /** behaviour k's red command words at index k - 1 */
  argv: string[][];
}

const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const firstLine = (text: string): string => text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
const code = (e: unknown): string => (e as NodeJS.ErrnoException).code ?? "error";

/** Lines outside fenced blocks (a fence line reads as blank). ponytail: HTML comments are read, the brief is the architect's own signed text. */
function unfenced(brief: string): string[] {
  let fence = false;
  return brief.split(/\r?\n/).map((line) => {
    if (/^\s{0,3}```/.test(line)) {
      fence = !fence;
      return "";
    }
    return fence ? "" : line;
  });
}

/** The brief's one Prototype line: none is undefined; two, or one in another form, is an error. */
export function readPrototype(brief: string): Prototype | { error: string } | undefined {
  const attempts = unfenced(brief)
    .map((l) => l.trim())
    .filter((l) => ATTEMPT.test(l));
  if (attempts.length === 0) return undefined;
  if (attempts.length > 1) return { error: `the brief has ${attempts.length} Prototype lines; one only` };
  const m = LINE.exec(attempts[0]!);
  if (m === null) return { error: `the Prototype line "${attempts[0]}" is not "Prototype: <absolute or ~/ path> sha256:<64 lowercase hex>"` };
  const named = m[1]!;
  let path: string;
  try {
    path = named.startsWith("~/") ? join(homedir(), named.slice(2)) : named;
  } catch {
    return { error: `${named}: the home directory cannot be read` };
  }
  return { named, path, digest: m[2]! };
}

/** The series file's text when it is a regular file under the cap whose sha256 is the one the brief names. */
export function loadSeries(p: Prototype): { text: string } | { error: string } {
  let bytes: Buffer;
  try {
    const st = statSync(p.path);
    if (!st.isFile() || st.size > SERIES_MAX_BYTES) return { error: `${p.named} is not a regular file of at most ${SERIES_MAX_BYTES} bytes` };
    bytes = readFileSync(p.path);
  } catch {
    return { error: `${p.named} cannot be read` };
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== p.digest) return { error: `${p.named} has sha256 ${digest}, not the ${p.digest} the signed brief names` };
  return { text: bytes.toString("utf8") };
}

/** The series' patches, when they are exactly behaviours 1..n in order: per behaviour an optional test patch (required for 1), then one feat patch. */
export function readSeries(text: string, id: string, n: number): Patch[] | { error: string } {
  const lines = text.split("\n");
  const starts = lines.flatMap((l, i) => (FROM.test(l) ? [i] : []));
  if (starts[0] !== 0) return { error: "the series does not open with a git format-patch From line" };
  const test = new RegExp(`^test\\(${esc(id)}\\): row b([1-9][0-9]{0,8}), red$`);
  const feat = new RegExp(`^feat\\(${esc(id)}\\): behaviour ([1-9][0-9]{0,8})$`);
  const patches: Patch[] = [];
  for (const [i, start] of starts.entries()) {
    const end = starts[i + 1];
    const body = lines.slice(start, end);
    const blank = body.indexOf("");
    const head = blank === -1 ? body : body.slice(0, blank);
    const at = head.flatMap((l, j) => (l.startsWith("Subject: ") ? [j] : []));
    if (at.length !== 1) return { error: `patch ${i + 1} carries ${at.length} Subject lines, want one` };
    if (/^\s/.test(head[at[0]! + 1] ?? "")) return { error: `patch ${i + 1}'s subject is folded over two lines` };
    const subject = SUBJECT.exec(head[at[0]!]!)![1]!;
    const t = test.exec(subject);
    const f = t === null ? feat.exec(subject) : null;
    if (t === null && f === null) return { error: `patch ${i + 1}'s subject "${subject}" is neither "test(${id}): row b<k>, red" nor "feat(${id}): behaviour <k>"` };
    patches.push({ role: t !== null ? "test" : "feat", behaviour: Number((t ?? f)![1]), subject, text: body.join("\n") + (end === undefined ? "" : "\n") });
  }
  let k = 1;
  let tested = false;
  for (const [i, p] of patches.entries()) {
    const want = p.role === "test" ? !tested && p.behaviour === k : p.behaviour === k && (k > 1 || tested);
    if (!want) return { error: `patch ${i + 1} ("${p.subject}") is out of order: behaviour ${k} wants ${k === 1 && !tested ? "its test patch first" : tested ? "its feat patch" : "its test or feat patch"}` };
    if (p.role === "test") tested = true;
    else {
      k++;
      tested = false;
    }
  }
  if (k !== n + 1) return { error: `the series covers behaviours 1 to ${k - 1}${tested ? ` and behaviour ${k}'s test` : ""}; the brief lists ${n}` };
  return patches;
}

/** The words of a red command: space-separated, single-quoted text taken literally, nothing else a shell would read. */
export function commandWords(text: string): string[] | { error: string } {
  const out: string[] = [];
  let cur = "";
  let word = false;
  let quoted = false;
  for (const ch of text) {
    if (quoted) {
      if (ch === "'") quoted = false;
      else cur += ch;
    } else if (ch === "'") {
      quoted = true;
      word = true;
    } else if (ch === " ") {
      if (word) out.push(cur);
      cur = "";
      word = false;
    } else if (PLAIN.test(ch)) {
      cur += ch;
      word = true;
    } else return { error: `the red command holds ${JSON.stringify(ch)} outside single quotes` };
  }
  if (quoted) return { error: "the red command has an unclosed single quote" };
  if (word) out.push(cur);
  if (out.length === 0 || out.some((w) => w === "" || /\s/.test(w))) return { error: "the red command has an empty word or one holding whitespace" };
  return out;
}

/** Behaviour k's red command: the words after " -- " in its one code span that opens "bisellium red <id> --behaviour <k> ",
 *  read from admission's own items (`behaviourItems`: one parser of the behaviours section, W-140). */
export function redCommand(brief: string, id: string, k: number): string[] | { error: string } {
  const items = behaviourItems(brief);
  const opening = `bisellium red ${id} --behaviour ${k} `;
  const spans = (items[k - 1] ?? []).flatMap((l) => [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)).filter((s) => s.startsWith(opening));
  if (spans.length !== 1) return { error: `behaviour ${k} names ${spans.length} red commands opening "${opening.trim()}", want one` };
  const at = spans[0]!.indexOf(" -- ");
  if (at === -1) return { error: `behaviour ${k}'s red command has no " -- " before its command` };
  return commandWords(spans[0]!.slice(at + 4));
}

/** Whether the whole series applies in order at the worktree's HEAD (`git apply --check --index`, nothing written), or why not. */
export function seriesApplies(wt: string, series: string): string | undefined {
  const r = spawnSync("git", ["apply", "--check", "--index", "-"], { cwd: wt, input: series, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  return r.status === 0 && r.error === undefined ? undefined : firstLine(r.stderr ?? "") || `git apply exited ${r.status}`;
}

/** One patch committed with `git am` (no three-way merge): undefined, or why not after `git am --abort`. */
export function amPatch(wt: string, patch: string): string | undefined {
  const r = spawnSync("git", ["am", "--no-3way", "--quiet"], { cwd: wt, input: patch, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (r.status === 0 && r.error === undefined) return undefined;
  spawnSync("git", ["am", "--abort"], { cwd: wt, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  return firstLine(`${r.stderr ?? ""}\n${r.stdout ?? ""}`) || `git am exited ${r.status}`;
}

/**
 * The names in the worktree's `ci/reds/<id>/`: absent is none; a real directory is listed; anything else (a symlink or a
 * non-directory at any level under the officina, an unreadable level) is an error, never "no red".
 */
export function readReplayReds(studio: string, id: string): string[] | { error: string } {
  const why = (what: string): { error: string } => ({ error: `ci/reds/${id}/ ${what}; whether a red is recorded cannot be read` });
  let cursor: string;
  try {
    cursor = realpathSync(studio);
  } catch (e) {
    return why(`cannot be resolved (${code(e)})`);
  }
  for (const part of ["ci", "reds", id]) {
    cursor = join(cursor, part);
    let st;
    try {
      st = lstatSync(cursor);
    } catch (e) {
      if (code(e) === "ENOENT") return [];
      return why(`cannot be read (${code(e)})`);
    }
    if (st.isSymbolicLink()) return why("is reached through a symlink");
    if (!st.isDirectory()) return why("is not a directory");
  }
  try {
    return readdirSync(cursor);
  } catch (e) {
    return why(`cannot be listed (${code(e)})`);
  }
}

const ATTEMPT_DIR = [".bisellium", "prototype-replay"] as const;

/**
 * Whether the replay of <id> may start: undefined only when no attempt marker is there and one can be created. The perform
 * creates the marker (`writeAttempt`) before any replay commit or officina write; once it has landed, a perform that holds,
 * crashes or is killed leaves the builder's order: the replay runs once per opus. A failure before it lands may leave host
 * bookkeeping (the perform framework's step marker and log, created directories) and may be retried. A marker present, or a
 * level that cannot be read or written, is a reason.
 */
export function readAttempt(repo: string, id: string): string | undefined {
  const rel = `${ATTEMPT_DIR.join("/")}/${id}.attempted`;
  let cursor: string;
  try {
    cursor = realpathSync(repo);
  } catch (e) {
    return `${rel} cannot be read (${code(e)}); whether a replay was attempted is unknown`;
  }
  for (const part of [...ATTEMPT_DIR, `${id}.attempted`]) {
    const parent = cursor;
    cursor = join(cursor, part);
    let st;
    try {
      st = lstatSync(cursor);
    } catch (e) {
      if (code(e) !== "ENOENT") return `${rel} cannot be read (${code(e)}); whether a replay was attempted is unknown`;
      try {
        accessSync(parent, constants.W_OK);
      } catch (w) {
        return `${rel} could not be written (${code(w)}); the replay runs only where its attempt is marked first`;
      }
      return undefined;
    }
    if (part === `${id}.attempted`) return `a replay of ${id} was already attempted (${rel}); the replay runs once`;
    if (st.isSymbolicLink() || !st.isDirectory()) return `${rel} could not be written (${part} is not a real directory); the replay runs only where its attempt is marked first`;
  }
  return undefined;
}

/** The attempt marker, created exclusively under real directories (`ensureRealDirectory`): undefined, or why not. */
export function writeAttempt(repo: string, id: string, text: string): string | undefined {
  try {
    writeFileSync(join(ensureRealDirectory(repo, ...ATTEMPT_DIR), `${id}.attempted`), text, { flag: "wx" });
    return undefined;
  } catch (e) {
    return `the attempt marker ${ATTEMPT_DIR.join("/")}/${id}.attempted could not be written: ${(e as Error).message}`;
  }
}

/**
 * The replay the reds rung may order, or why not; undefined when the brief names no prototype. It needs a usable worktree,
 * no attempt before, no red recorded yet (read, not assumed), the series file at the signed digest, a series in the
 * grammar for the brief's n behaviours, one red command per behaviour, and the whole series applying at the worktree's HEAD.
 */
export function readReplay(brief: string, id: string, wt: { dir: string; studio: string; usable: boolean }, repo: string): Replay | { why: string } | undefined {
  const p = readPrototype(brief);
  if (p === undefined) return undefined;
  if ("error" in p) return { why: p.error };
  if (!wt.usable) return { why: `${wt.dir} is not a usable worktree` };
  const attempted = readAttempt(repo, id);
  if (attempted !== undefined) return { why: attempted };
  const reds = readReplayReds(wt.studio, id);
  if ("error" in reds) return { why: reds.error };
  if (reds.length > 0) return { why: `ci/reds/${id}/ already holds ${reds.length} entr${reds.length === 1 ? "y" : "ies"}; the replay starts only where no red is recorded` };
  const loaded = loadSeries(p);
  if ("error" in loaded) return { why: loaded.error };
  const n = countBehaviours(brief);
  const patches = readSeries(loaded.text, id, n);
  if ("error" in patches) return { why: patches.error };
  const argv: string[][] = [];
  for (let k = 1; k <= n; k++) {
    const words = redCommand(brief, id, k);
    if ("error" in words) return { why: words.error };
    argv.push(words);
  }
  const bad = seriesApplies(wt.dir, loaded.text);
  if (bad !== undefined) return { why: `the series does not apply at the worktree's HEAD: ${bad}` };
  return { line: `${p.named} sha256:${p.digest}`, patches, argv };
}
