/**
 * packages/cli/src/ladder-read.ts — W-300 (D-071 G): one opus's next step, as plain data, with nothing written. It answers
 * what `next <opus>` reports before its dispatch gate: no ticket refresh, no usage reading, no marker, no step log. Two
 * things git would write are held off for the read: the opportunistic index refresh (GIT_OPTIONAL_LOCKS=0), since a read
 * must never take a lock a working builder wants, and the loose objects the source-tree hash writes, which go to a scratch
 * object directory that dies with the read (GIT_OBJECT_DIRECTORY, with the repository's as an alternate). Run as a child of `bisellium serve` (serve.ts): `gather` and `deriveNext` block on git and gh, and the
 * server must not. A failed read is an answer (`read: "unavailable"`), never a throw and never a guess.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { readSourceExcludes } from "@bisellium/commands/verdict.js";
import { readStepTickets } from "@bisellium/commands/ticket.js";
import { instant } from "@bisellium/schema";
import { openStudio } from "@bisellium/commands/writes.js";
import type { LadderRead } from "@bisellium/server";
import { ID_RE } from "./check.js";
import { clean, git } from "./integrate.js";
import { assess, derivedStep, gather, readMarker, silence, silenceEntries, type Derived } from "./next.js";
import { dirname, join, resolve } from "node:path";

/** The same bound `next`'s `say` puts on a printed line. */
const LINE = 1000;
export const oneLine = (text: string): string => clean(text.replace(/\s+/g, " ").trim(), LINE);

/** The rung's round: a dispatch order's own, or the round a `review` record names. A `red` ticket's number is a behaviour, never a round. */
function roundOf(d: Derived): number | null {
  if (d.order?.round !== undefined) return d.order.round;
  return d.ticket?.action === "review" ? d.ticket.round : null;
}

/** A link only for an `owner/name` the PR read gave: anything else keeps the number and no link. */
export function prOf(d: Pick<Derived, "pr">): { number: number; url: string | null } | null {
  if (d.pr === undefined) return null;
  const slug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(d.pr.repo) ? d.pr.repo : undefined;
  return { number: d.pr.number, url: slug === undefined ? null : `https://github.com/${slug}/pull/${d.pr.number}` };
}

/** The text after `health: ` that report-mode `next` prints for the same marker and files. */
function healthOf(repo: string, id: string, d: Derived, wtParent: string, nowMs: number, testClock: boolean): string {
  const procRoot = testClock && process.env["BISELLIUM_TEST_PROC"] ? process.env["BISELLIUM_TEST_PROC"] : "/proc";
  const h = assess(readMarker(repo, id), d.step, { repo, procRoot, nowMs });
  switch (h.kind) {
    case "running":
      return `running (${h.pidVisible === false ? `writer ${h.m.writer}, pid ${h.m.pid} is outside this namespace` : `pid ${h.m.pid}, writer ${h.m.writer}`}, last output ${h.ageS}s ago)`;
    case "dead":
      return `dead (${h.reason})`;
    case "invalid":
      return `dead (invalid marker: ${h.reason})`;
    case "unknown":
      return `unknown (${h.reason})`;
    case "anomaly":
      return `clock anomaly (output mtime is ${-h.ageS}s in the future)`;
    case "finished":
      return `finished ${h.step}`;
    case "stale":
      return "stale marker (evidence regressed)";
    default: {
      const quiet = d.order !== undefined ? silence(repo, wtParent, id, nowMs, silenceEntries(testClock)) : undefined;
      if (quiet !== undefined && "unknown" in quiet) return `unknown (dispatch activity cannot be read: ${quiet.unknown})`;
      return quiet?.note ?? "no step recorded";
    }
  }
}

/** The process's git writes nothing to the repository while `read` runs; every git this process spawns inherits it. */
function withoutGitWrites<T>(commonDir: string, read: () => T): T {
  const scratch = mkdtempSync(join(tmpdir(), "bisellium-ladder-"));
  process.env["GIT_OPTIONAL_LOCKS"] = "0";
  process.env["GIT_OBJECT_DIRECTORY"] = scratch;
  process.env["GIT_ALTERNATE_OBJECT_DIRECTORIES"] = join(commonDir, "objects");
  try {
    return read();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function readLadder(studio: string, id: string, nowMs: number, testClock: boolean): LadderRead {
  const unavailable = (why: string): LadderRead => ({ id, read: "unavailable", why: oneLine(why) });
  try {
    if (!ID_RE.test(id)) return unavailable(`invalid opus id "${id}"`);
    const opened = openStudio(studio);
    if ("error" in opened) return unavailable(opened.error);
    const top = git(opened.root, ["rev-parse", "--show-toplevel"]);
    if (top.status !== 0) return unavailable("the officina is not in a git repository");
    const repo = top.stdout.trim();
    const gd = git(repo, ["rev-parse", "--git-dir"]);
    const cd = git(repo, ["rev-parse", "--git-common-dir"]);
    if (gd.status !== 0 || cd.status !== 0) return unavailable(`${repo} is not a git repository`);
    if (resolve(repo, gd.stdout.trim()) !== resolve(repo, cd.stdout.trim())) return unavailable(`${repo} is a linked worktree; next reads from the repository's main checkout`);
    const excludes = readSourceExcludes(opened.manifest);
    if ("error" in excludes) return unavailable(`bisellium.yml#source_excludes is malformed (${excludes.error})`);
    const tickets = readStepTickets(opened.manifest);
    if ("error" in tickets) return unavailable(`bisellium.yml#step_tickets is malformed (${tickets.error})`);
    return withoutGitWrites(resolve(repo, cd.stdout.trim()), () => {
      const f = gather(repo, opened.root, id);
      if (f.trunkRecord === undefined && f.branchRecord === undefined) return unavailable(`unknown opus: ${id}`);
      const d = derivedStep(f);
      return { id, read: "ok", step: d.step, status: d.status, actor: d.actor, why: oneLine(d.why), round: roundOf(d), health: oneLine(healthOf(repo, id, d, dirname(f.wt.dir), nowMs, testClock)), pr: prOf(d) };
    });
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e));
  }
}

// `node ladder-read.ts <studio> <opus> [<now iso>]`: one JSON line, exit 0 whatever it answers. The instant is a test seam, honoured only with BISELLIUM_TEST_CLOCK=1.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [studio, id, at] = process.argv.slice(2);
  const testClock = process.env["BISELLIUM_TEST_CLOCK"] === "1";
  const seam = testClock && at !== undefined ? instant(at) : undefined;
  console.log(JSON.stringify(readLadder(resolve(studio ?? "."), id ?? "", seam === undefined ? Date.now() : seam.getTime(), testClock)));
}
