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
import { readContainedRegularFile } from "./opus-model.js";

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

function gitIn(cwd: string, args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** The facts a ticket binds, read from the studio's own checkout: the main checkout, the tickets directory, the studio's place in it, HEAD and the brief. */
function readFacts(studio: string, opus: string): { common: string; main: string; studio: string; head: string; brief: string } | { error: string } {
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
  return { common, main, studio: place, head, brief };
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
