/**
 * packages/commands/src/ticket.ts — W-233: the step ticket. In a studio whose
 * `bisellium.yml` sets `step_tickets: required`, `bisellium next <opus>` writes
 * one ticket naming the action the ladder allows (opus, step, action, round,
 * actor, the studio the action writes in, that checkout's HEAD, the brief's
 * blob, the time), and the ladder's direct writers require it, claim it and
 * copy its line into what they write. The store is
 * `<git common directory>/bisellium/tickets/<opus>.json`: never committed,
 * visible from every worktree, beside W-199's queue binding.
 *
 * The threat model is mistakes, not adversaries (D-045): the file is
 * agent-writable and part 2 makes a missing or mismatched ticket fatal at
 * merge. Every raw `fs` call in this module reads or writes only that
 * directory; the brief is read through `readContainedRegularFile`.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { readContainedRegularFile, utcTimestampProblem } from "./opus-model.js";

export type TicketAction = "verdict-spec" | "verdict-build" | "review" | "red" | "ready" | "done" | "branch" | "merge";
export interface StepTicket {
  opus: string;
  /** a STEPS id */
  step: string;
  action: TicketAction;
  /** verdict round; red behaviour; review evidence round; else 0 */
  round: number;
  /** Derived.actor */
  actor: string;
  /** the action studio, relative to the main checkout, posix, no ".." */
  studio: string;
  /** 40-hex HEAD of the action studio's checkout */
  head: string;
  /** 40-hex git blob of <studio>/briefs/<opus>.md, or "none" when absent */
  brief: string;
  /** exact UTC */
  at: string;
}

const GIT_TIMEOUT_MS = 30_000;
const ACTIONS: readonly string[] = ["verdict-spec", "verdict-build", "review", "red", "ready", "done", "branch", "merge"];
const OPUS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Absent or a non-mapping manifest: not required. "required": required. Anything else: error. */
export function readStepTickets(manifest: unknown): { required: boolean } | { error: string } {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest) || !("step_tickets" in manifest)) return { required: false };
  const value = (manifest as Record<string, unknown>)["step_tickets"];
  return value === "required" ? { required: true } : { error: `step_tickets must be exactly "required", or absent (got ${JSON.stringify(value) ?? String(value)})` };
}

/** One line of JSON, keys in the StepTicket order above. */
export function ticketLine(t: StepTicket): string {
  return JSON.stringify({ opus: t.opus, step: t.step, action: t.action, round: t.round, actor: t.actor, studio: t.studio, head: t.head, brief: t.brief, at: t.at });
}

/** Exactly what `ticketLine` writes: nine typed keys in order, no other whitespace. */
export function parseTicketLine(text: string): StepTicket | { error: string } {
  const bad = (why: string): { error: string } => ({ error: why });
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return bad("not a JSON line");
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return bad("not a JSON object");
  const o = v as Record<string, unknown>;
  const text9 = (k: string): string | undefined => (typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : undefined);
  const { opus, step, action, actor, studio, head, brief, at } = { opus: text9("opus"), step: text9("step"), action: text9("action"), actor: text9("actor"), studio: text9("studio"), head: text9("head"), brief: text9("brief"), at: text9("at") };
  const round = o["round"];
  if (opus === undefined || step === undefined || action === undefined || actor === undefined || studio === undefined || head === undefined || brief === undefined || at === undefined) return bad("a field is missing or not a non-empty string");
  if (!ACTIONS.includes(action)) return bad(`action ${action} is not a ticket action`);
  if (typeof round !== "number" || !Number.isSafeInteger(round) || round < 0) return bad("round must be a non-negative integer");
  if (!/^[0-9a-f]{40}$/.test(head)) return bad("head must be a 40-hex object id");
  if (!/^[0-9a-f]{40}$/.test(brief) && brief !== "none") return bad('brief must be a 40-hex blob or "none"');
  if (studio.startsWith("/") || studio.includes("\\") || studio.split("/").some((p) => p === "" || p === "." || p === "..")) return bad("studio must be a posix path inside the main checkout");
  if (utcTimestampProblem(at) !== undefined) return bad("at must be an exact UTC timestamp");
  const t: StepTicket = { opus, step, action: action as TicketAction, round, actor, studio, head, brief, at };
  return ticketLine(t) === text ? t : bad("not the canonical line (keys in order, no other fields)");
}

function gitIn(cwd: string, args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** The facts a ticket binds, read from the studio's own checkout: the main checkout, the tickets directory, the studio's place in it, HEAD and the brief. */
function readFacts(studio: string, opus: string): { common: string; main: string; prefix: string; studio: string; head: string; brief: string } | { error: string } {
  if (!OPUS_RE.test(opus)) return { error: `invalid opus id "${opus}"` };
  const root = resolve(studio);
  const common = gitIn(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const top = gitIn(root, ["rev-parse", "--show-toplevel"]);
  const prefix = gitIn(root, ["rev-parse", "--show-prefix"]);
  const head = gitIn(root, ["rev-parse", "HEAD"]);
  if (common === undefined || common === "" || top === undefined || top === "" || prefix === undefined || head === undefined) return { error: `${root} is not inside a git checkout with a HEAD` };
  if (!/^[0-9a-f]{40}$/.test(head)) return { error: `HEAD of ${root} is not a full object id` };
  const main = dirname(common);
  const inMain = relative(main, top).split("\\").join("/");
  if (inMain.startsWith("..") || resolve(main, inMain) !== top) return { error: `${top} is not inside ${main}, the parent of its git common directory` };
  const place = [inMain, prefix.replace(/\/$/, "")].filter((p) => p !== "").join("/");
  if (place === "" || place.split("/").some((p) => p === ".." || p === ".")) return { error: `${root} has no place inside ${main}` };
  const read = readContainedRegularFile(root, "briefs/" + opus + ".md", "briefs");
  if ("error" in read && read.code !== "ENOENT") return { error: `the brief of ${opus} is unreadable: ${read.error}` };
  const brief = "error" in read ? "none" : createHash("sha1").update(`blob ${read.bytes.length}\0`).update(read.bytes).digest("hex");
  return { common, main, prefix: prefix.replace(/\/$/, ""), studio: place, head, brief };
}

/** main = dirname of `git rev-parse --path-format=absolute --git-common-dir` run in studio. */
export function actionFacts(studio: string, opus: string): { main: string; studio: string; head: string; brief: string } | { error: string } {
  const facts = readFacts(studio, opus);
  return "error" in facts ? facts : { main: facts.main, studio: facts.studio, head: facts.head, brief: facts.brief };
}

/** The directory the tickets of the repository `studio` lives in are kept in. */
function ticketsDir(common: string): string {
  return join(common, "bisellium", "tickets");
}

/** Write (replace) or, with undefined, delete <common dir>/bisellium/tickets/<opus>.json; the error text, or undefined. */
export function setPendingTicket(studio: string, opus: string, ticket: StepTicket | undefined): string | undefined {
  const facts = readFacts(studio, opus);
  if ("error" in facts) return facts.error;
  const dir = ticketsDir(facts.common);
  const path = join(dir, `${opus}.json`);
  try {
    if (ticket === undefined) {
      try {
        unlinkSync(path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      return undefined;
    }
    mkdirSync(dir, { recursive: true });
    const staged = join(dir, `.${opus}.json.tmp`);
    writeFileSync(staged, `${ticketLine(ticket)}\n`);
    renameSync(staged, path);
    return undefined;
  } catch (e) {
    return `could not ${ticket === undefined ? "delete" : "write"} ${path}: ${(e as Error).message}`;
  }
}

/** A ticket read against a verb: no ticket required, the accepted line and its pending path, or the refusal (one or two lines). */
export function requireTicket(i: { studio: string; manifest: unknown; opus: string; verb: string; action: TicketAction; round: number }): { off: true } | { line: string; path: string } | { refusal: string } {
  const setting = readStepTickets(i.manifest);
  if ("error" in setting) return { refusal: `${i.opus}: ${i.verb} refused: bisellium.yml#step_tickets is malformed (${setting.error})` };
  if (!setting.required) return { off: true };
  const facts = readFacts(i.studio, i.opus);
  const refuse = (reason: string): { refusal: string } => ({
    refusal: `${i.opus}: ${i.verb} refused: no matching next ticket (${reason})\nrun: bisellium next ${i.opus} --studio ${"error" in facts ? i.studio : join(facts.main, facts.prefix)} --repo ${"error" in facts ? "." : facts.main}`,
  });
  if ("error" in facts) return refuse(`facts unreadable: ${facts.error}`);
  const dir = ticketsDir(facts.common);
  const read = readContainedRegularFile(dir, i.opus + ".json", "");
  if ("error" in read) return refuse(read.code === "ENOENT" ? "absent" : "unreadable");
  const text = read.bytes.toString("utf8");
  const t = text.endsWith("\n") ? parseTicketLine(text.slice(0, -1)) : { error: "no trailing newline" };
  if ("error" in t || t.opus !== i.opus) return refuse("unreadable");
  const round = (n: number): string => (n < 0 ? "none" : String(n));
  if (t.action !== i.action) return refuse(`action is ${t.action}, want ${i.action}`);
  if (t.round !== i.round) return refuse(`round is ${t.round}, want ${round(i.round)}`);
  if (t.studio !== facts.studio) return refuse(`studio is ${t.studio}, want ${facts.studio}`);
  if (t.head !== facts.head) return refuse(`head is ${t.head}, want ${facts.head}`);
  if (t.brief !== facts.brief) return refuse(`brief is ${t.brief}, want ${facts.brief}`);
  return { line: ticketLine(t), path: join(dir, i.opus + ".json") };
}
