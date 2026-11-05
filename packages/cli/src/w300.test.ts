/**
 * packages/cli/src/w300.test.ts — W-300 (D-071 G): one opus's next step as plain data, with nothing written (row b1), and
 * the route that serves it through a read `serve.ts` injects (row b2). node:test TAP, selected by
 * `--test-name-pattern='^W-300-b<n>\s'`. The worlds are next-world's, under the OS tmp dir with a temporary HOME; the read
 * runs as the child process serve runs. Nothing here reads or writes the real officina.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import { startServer, type StartServerOptions } from "@bisellium/server";
import { BUDGET, HERE, advanceOrigin, NOW_ISO, NOW_MS, OPUS, PR_NUMBER, REPO_ROOT, SLUG, TSX, type World, envFor, git, markerPath, next, openList, putMarker, putOutput, scenario, stepsDir, tickOf, ticketed, world } from "./next-world.test.js";

const READ = join(HERE, "ladder-read.ts");
type Answer = Record<string, unknown>;

function read(w: World, id: string = OPUS, studio: string = w.studio): { status: number | null; answer: Answer; raw: string } {
  assert.equal(existsSync(READ), true, "the read exists as a file serve can run");
  const r = spawnSync(process.execPath, ["--import", TSX, READ, studio, id, NOW_ISO], { cwd: w.repo, env: envFor(w, {}), encoding: "utf8", timeout: 120_000 });
  let answer: Answer = {};
  try {
    answer = JSON.parse(r.stdout) as Answer;
  } catch {
    /* the assertions below name it */
  }
  return { status: r.status, answer, raw: `${r.stdout}${r.stderr.slice(0, 600)}` };
}

/** Every path under the world but the stub's call log: bytes and mtime, so a rewrite of the same bytes shows too. */
function snapshot(w: World): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      // the gh stub's own call log and state, neither of them the read's
      if (p === w.log || p === `${w.scn}.state`) continue;
      const st = lstatSync(p);
      if (e.isDirectory()) {
        out.set(relative(w.root, p), "dir");
        walk(p);
      } else if (e.isFile()) {
        // git freshens the mtime of an object it would have written anew (Limits): there the bytes are the whole claim
        const stamp = relative(w.root, p).includes(".git/objects/") ? "" : `${st.mtimeMs} `;
        out.set(relative(w.root, p), `${stamp}${createHash("sha256").update(readFileSync(p)).digest("hex")}`);
      }
      else out.set(relative(w.root, p), `link ${st.mtimeMs}`);
    }
  };
  walk(w.root);
  return out;
}
function changed(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();
}

/** The report's own fields, for the read to agree with. */
function report(w: World): { step: string; status: string; actor: string; why: string; health: string } {
  const o = next(w, [OPUS, ...BUDGET]);
  const field = (k: string): string => o.out.split("\n").find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2) ?? "";
  const first = /^next: \S+ (\S+) (\S+)$/.exec(o.out.split("\n")[0] ?? "");
  return { step: first?.[1] ?? "", status: first?.[2] ?? "", actor: field("actor"), why: field("why"), health: field("health") };
}
function agrees(w: World, label: string): void {
  const got = read(w).answer;
  const want = report(w);
  // a running, dead or held-on-health report prints the step and the health, and no actor or why
  assert.deepEqual(want.actor === "" ? { step: got["step"], health: got["health"] } : { step: got["step"], status: got["status"], actor: got["actor"], why: got["why"], health: got["health"] }, want.actor === "" ? { step: want.step, health: want.health } : want, `${label}: the read says what next says`);
}

test("W-300-b1 behaviour 1: the read answers next's own step as plain data and writes nothing", { timeout: 600_000 }, async () => {
  // the shape, whole
  const backlog = world("w300-b1-backlog", "backlog");
  const b = read(backlog);
  assert.equal(b.status, 0, `the read exits 0: ${b.raw}`);
  assert.deepEqual(b.answer, { id: OPUS, read: "ok", step: "greenlight", status: "named", actor: "patron", why: `${OPUS} is in the backlog; only the Patron greenlights`, round: null, health: "no step recorded", pr: null }, "a backlog opus: the whole shape, and the Patron acts");

  // the round
  const build = world("w300-b1-build", "build");
  assert.deepEqual([read(build).answer["step"], read(build).answer["round"]], ["review", 1], "the review rung names its round");
  const ready = world("w300-b1-ready", "ready");
  ticketed(ready);
  assert.deepEqual([read(ready).answer["step"], read(ready).answer["round"]], ["reds", null], "a red ticket's number is a behaviour, never a round");

  // the PR
  const merge = world("w300-b1-pr", "review", { prRequired: true });
  scenario(merge, { list: openList(merge) });
  const held = read(merge).answer;
  assert.equal(held["step"], "merge", `an open PR's rung\n${JSON.stringify(held)}`);
  assert.deepEqual(held["pr"], { number: PR_NUMBER, url: `https://github.com/${SLUG}/pull/${PR_NUMBER}` }, "an open PR comes with its number and link");
  const { oneLine, prOf } = (await import("./ladder-read.js")) as { oneLine: (text: string) => string; prOf: (d: { pr?: { number: number; repo: string } }) => unknown };
  assert.deepEqual([oneLine(" a\n\t b\u0007c "), oneLine("x".repeat(1500)).length], ["a b c", 1000], "a why is one line, its controls gone, cut at 1000");
  assert.deepEqual(prOf({ pr: { number: 7, repo: "acme/widgets" } }), { number: 7, url: "https://github.com/acme/widgets/pull/7" }, "an owner/name repository gives a link");
  assert.deepEqual(prOf({ pr: { number: 7, repo: 'javascript:alert(1)//"x' } }), { number: 7, url: null }, "any other repository gives the number and no link");
  assert.equal(prOf({}), null, "a rung that names no PR gives null");

  // parity with next's report, rung by rung and marker by marker
  agrees(backlog, "backlog");
  agrees(world("w300-b1-spec", "greenlight"), "the spec rung");
  agrees(build, "the review rung");
  agrees(merge, "the merge rung");
  const silent = world("w300-b1-silent", "reds", { automated: true });
  const evidence = join(silent.home, ".bisellium-evidence", OPUS);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, "old.log"), "old\n");
  const old = new Date(NOW_MS - 3_600_000);
  utimesSync(join(evidence, "old.log"), old, old);
  for (const f of walkFiles(join(silent.repo, ".worktrees"))) utimesSync(f, old, old);
  const stalled = read(silent).answer;
  // one-sided: the rest of the line names a scratch path and an age
  assert.match(String(stalled["health"]), /^stalled \(no step recorded; newest file /, `a silent order reads stalled\n${JSON.stringify(stalled)}`);
  agrees(silent, "a silent dispatch order");
  const marked = world("w300-b1-marker", "reds", { automated: true });
  mkdirSync(stepsDir(marked), { recursive: true });
  writeFileSync(markerPath(marked), "{ this is not json");
  // one-sided: the rest of the line is the marker reader's own reason
  assert.match(String(read(marked).answer["health"]), /^dead \(invalid marker: /, "an invalid marker reads dead");
  agrees(marked, "an invalid marker");
  rmSync(markerPath(marked));
  putMarker(marked, { step: "build", pid: process.pid, start_ticks: tickOf(process.pid) });
  putOutput(marked, "working\n", 10);
  // one-sided: the rest of the line names a live pid and an age
  assert.match(String(read(marked).answer["health"]), /^running \(pid /, "a live marker reads running");
  agrees(marked, "a running step");
  putMarker(marked, { step: "reds", pid: process.pid, start_ticks: tickOf(process.pid) });
  assert.equal(read(marked).answer["health"], "finished reds", "an earlier rung's marker reads finished");
  agrees(marked, "a finished step");
  putMarker(marked, { step: "review", pid: process.pid, start_ticks: tickOf(process.pid) });
  assert.equal(read(marked).answer["health"], "stale marker (evidence regressed)", "a later rung's marker reads stale");
  agrees(marked, "a stale marker");

  // nothing written: every file under the repository, its .git and HOME, bytes and mtime, on rungs a report writes on
  for (const [tag, stage] of [["greenlight", "greenlight"], ["ready", "ready"], ["build", "build"], ["review", "review"]] as const) {
    const w = world(`w300-b1-writes-${tag}`, stage, { prRequired: true });
    ticketed(w);
    // the trunk moved, so the review rung's merge check builds a tree the object store has never held
    if (tag === "build") {
      advanceOrigin(w, "elsewhere.txt", "moved\n");
      git(w.repo, ["fetch", "-q", "origin", "master:refs/remotes/origin/master"]);
    }
    // a tracked file touched, same bytes: any `git status` that may refresh the index would rewrite it
    for (const dir of [w.repo, ...(existsSync(w.wt) ? [w.wt] : [])]) utimesSync(join(dir, "README.md"), new Date(NOW_MS), new Date(NOW_MS));
    const before = snapshot(w);
    assert.equal(read(w).status, 0, `${tag}: the read exits 0`);
    assert.deepEqual(changed(before, snapshot(w)), [], `${tag}: the read writes nothing under the repository or HOME`);
  }
  const ticket = world("w300-b1-ticket", "ready");
  ticketed(ticket);
  const quiet = snapshot(ticket);
  assert.equal(read(ticket).status, 0, "the read exits 0 on a ticketed rung");
  assert.deepEqual(changed(quiet, snapshot(ticket)), [], "no ticket is written");
  next(ticket, [OPUS, ...BUDGET]);
  const wrote = changed(quiet, snapshot(ticket));
  assert.ok(wrote.some((p) => p.includes("tickets")), `a report on the same world does write its ticket, so the row can see one: ${wrote.join(", ")}`);

  // before the dispatch gate: a session past the wind-down holds next's order and not the read, whose HOME stays as it was
  const hot = world("w300-b1-hot", "reds", { automated: true });
  const usage = join(hot.home, ".bisellium-evidence", "usage");
  mkdirSync(usage, { recursive: true });
  writeFileSync(join(usage, "claude-latest.json"), JSON.stringify({ at: NOW_ISO, ctx: { current_usage: { input_tokens: 310_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }));
  const cool = snapshot(hot);
  const named = read(hot).answer;
  assert.deepEqual([named["step"], named["status"]], ["build", "named"], "the read answers before the dispatch gate");
  assert.deepEqual(changed(cool, snapshot(hot)), [], "and takes no usage reading");
  assert.equal(report(hot).status, "held", "next itself holds that order, so the row can see the gate");

  // what cannot be read says so, exit 0
  const unavailable = (o: { status: number | null; answer: Answer; raw: string }, match: RegExp, label: string): void => {
    assert.equal(o.status, 0, `${label}: exit 0: ${o.raw}`);
    assert.equal(o.answer["read"], "unavailable", `${label}: unavailable: ${o.raw}`);
    assert.match(String(o.answer["why"]), match, `${label}: says why`);
  };
  unavailable(read(backlog, "W-999"), /unknown opus: W-999/, "an unknown opus");
  unavailable(read(backlog, "../W-900"), /invalid opus id/, "an invalid id");
  unavailable(read(backlog, OPUS, join(backlog.root, "nowhere")), /./, "a studio that cannot be opened");
  const bare = mkdtempSync(join(tmpdir(), "w300-bare-"));
  cpSync(backlog.studio, bare, { recursive: true });
  unavailable(read(backlog, OPUS, bare), /not in a git repository/, "a studio in no repository");
  rmSync(bare, { recursive: true, force: true });
  const linked = join(backlog.root, "linked");
  git(backlog.repo, ["worktree", "add", "-q", "--detach", linked]);
  unavailable(read(backlog, OPUS, join(linked, "studio")), /linked worktree/, "a linked worktree");
  const badExcludes = world("w300-b1-bad-excludes", "backlog");
  const manifest = join(badExcludes.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(/^source_excludes:.*\n(?:[ \t]*- .*\n)*/m, "source_excludes: 7\n"));
  unavailable(read(badExcludes), /source_excludes is malformed/, "a malformed source_excludes");
  const badTickets = world("w300-b1-bad-tickets", "backlog");
  appendFileSync(join(badTickets.studio, "bisellium.yml"), "step_tickets: sometimes\n");
  unavailable(read(badTickets), /step_tickets is malformed/, "a malformed step_tickets");
});

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === ".git" || e.name === "node_modules") return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walkFiles(p) : e.isFile() ? [p] : [];
  });
}
