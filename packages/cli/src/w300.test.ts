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

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const TOKEN = "test-token-w300";
const SAMPLE = join(REPO_ROOT, "examples", "sample-studio");
const noop = (): { exitCode: number } => ({ exitCode: 0 });
const noopAsync = async (): Promise<{ exitCode: number }> => ({ exitCode: 0 });
function serveSample(readLadder?: StartServerOptions["readLadder"], prepare?: (dir: string) => void): ReturnType<typeof startServer> {
  const studioDir = mkdtempSync(join(tmpdir(), "w300-route-"));
  dirs.push(studioDir);
  cpSync(SAMPLE, studioDir, { recursive: true });
  prepare?.(studioDir);
  return startServer({ studioDir, checkStudio: () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }), runners: { answer: noop, greenlight: noop, budget: noop, handoff: noop, talk: noopAsync, pause: noopAsync, resume: noopAsync, delegate: noop }, token: TOKEN, once: true, now: new Date(NOW_ISO), port: 0, ...(readLadder === undefined ? {} : { readLadder }) });
}
const get = async (port: number, path: string, token: string | undefined = TOKEN): Promise<{ status: number; body: Answer }> => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: token === undefined ? {} : { "X-Bisellium-Token": token } });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) as Answer };
  } catch {
    return { status: r.status, body: { text: text.slice(0, 200) } };
  }
};
async function until(done: () => boolean, label: string): Promise<void> {
  // a turn of the event loop at a time, no clock: the fake read's call lands on one of these turns
  for (let i = 0; i < 5_000_000 && !done(); i++) await new Promise((r) => setImmediate(r));
  assert.equal(done(), true, label);
}
const ok = (id: string): Answer => ({ id, read: "ok", step: "review", status: "named", actor: "censor", why: "w", round: 1, health: "no step recorded", pr: null });

test("W-300-b2 behaviour 2: the route serves the injected read, one at a time and never on a Board load; serve injects a child process", { timeout: 300_000 }, async () => {
  const calls: string[] = [];
  const release: (() => void)[] = [];
  const hold = { on: false };
  const fake = (id: string): Promise<never> =>
    new Promise((settle) => {
      calls.push(id);
      const answer = (): void => settle(ok(id) as never);
      if (hold.on) release.push(answer);
      else answer();
    });
  const s = await serveSample(fake);
  try {
    assert.deepEqual(await get(s.port, "/api/opus/W-007/ladder"), { status: 200, body: ok("W-007") }, "a backlog opus is read");
    assert.deepEqual(calls, ["W-007"], "by the injected read");
    assert.equal((await get(s.port, "/api/opus/W-007/ladder", "wrong")).status, 401, "the session token is required");
    assert.equal((await get(s.port, "/api/opus/W-999/ladder")).status, 404, "an unknown opus is 404");
    assert.deepEqual((await get(s.port, "/api/opus/W-001/ladder")).body, { id: "W-001", read: "not-in-flight" }, "a done opus runs no read");
    assert.deepEqual(calls, ["W-007"], "neither the 401, the 404 nor the done opus ran a read");
    assert.equal(typeof (await get(s.port, "/api/opus/W-007")).body["id"], "string", "GET /api/opus/:id still answers");
    calls.length = 0;
    for (const path of ["/api/officina", "/api/opera", "/api/inbox", "/api/events?item=W-007"]) assert.equal((await get(s.port, path)).status, 200, `${path} answers`);
    assert.deepEqual(calls, [], "the Board's reads run no step read");

    hold.on = true;
    const first = get(s.port, "/api/opus/W-007/ladder");
    await until(() => calls.length === 1, "the first read starts");
    const shared = get(s.port, "/api/opus/W-007/ladder");
    const other = get(s.port, "/api/opus/W-006/ladder");
    assert.equal((await get(s.port, "/api/opera")).status, 200, "the Board's reads answer while a step read runs");
    assert.deepEqual(calls, ["W-007"], "one read at a time, and a request for the same opus runs none");
    release.shift()!();
    assert.deepEqual((await first).body, ok("W-007"), "the first answer");
    await until(() => calls.length === 2, "the next read starts when the first ends");
    assert.deepEqual(calls, ["W-007", "W-006"], "a request for the same opus shares the answer: the next read is the other opus's");
    assert.deepEqual((await shared).body, ok("W-007"), "the shared answer");
    release.shift()!();
    assert.deepEqual((await other).body, ok("W-006"), "the other answer");
  } finally {
    await s.close();
  }

  const halted = await serveSample(fake, (dir) => {
    const p = join(dir, "opera", "W-006.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("state: greenlit", "state: halted"));
  });
  hold.on = false;
  calls.length = 0;
  try {
    assert.deepEqual((await get(halted.port, "/api/opus/W-006/ladder")).body, { id: "W-006", read: "not-in-flight" }, "a halted opus runs no read");
    assert.deepEqual(calls, [], "and no read ran");
  } finally {
    await halted.close();
  }

  const none = await serveSample();
  const throwing = await serveSample(() => Promise.reject(new Error("boom")));
  try {
    assert.equal((await get(none.port, "/api/opus/W-007/ladder")).body["read"], "unavailable", "a server with no read injected answers unavailable");
    assert.deepEqual((await get(throwing.port, "/api/opus/W-007/ladder")).body, { id: "W-007", read: "unavailable", why: "boom" }, "a read that rejects answers unavailable");
    assert.equal((await get(throwing.port, "/api/opera")).status, 200, "and the server lives");
  } finally {
    await none.close();
    await throwing.close();
  }

  const { ladderQueue, LADDER_WAITING } = (await import("@bisellium/server")) as unknown as { ladderQueue: (r: (id: string) => Promise<Answer>) => (id: string) => Promise<Answer>; LADDER_WAITING: number };
  assert.equal(LADDER_WAITING, 8, "one running and eight waiting");
  const held: (() => void)[] = [];
  const q = ladderQueue((id) => new Promise((settle) => held.push(() => settle(ok(id)))));
  const taken = Array.from({ length: LADDER_WAITING + 1 }, (_, i) => q(`W-${i}`));
  assert.deepEqual(await Promise.race([q("W-over"), Promise.resolve("still waiting")]), { id: "W-over", read: "unavailable", why: "too many step reads are waiting" }, "past the queue a read answers unavailable at once");
  for (let i = 0; i <= LADDER_WAITING; i++) {
    await until(() => held.length > 0, `read ${i} starts`);
    held.shift()!();
    assert.deepEqual(await taken[i], ok(`W-${i}`), `read ${i} answers`);
  }
  const later = q("W-after");
  await until(() => held.length > 0, "an emptied queue takes reads again");
  held.shift()!();
  assert.deepEqual(await later, ok("W-after"), "and answers them");

  // the wiring: a child process, bounded, whose answer is checked
  const serve = (await import("./serve.js")) as unknown as { readLadderInChild?: (studio: string, id: string, o?: { entry?: string; timeoutMs?: number }) => Promise<Answer>; LADDER_READ_TIMEOUT_MS?: number };
  assert.equal(typeof serve.readLadderInChild, "function", "serve.ts holds the injected read");
  assert.equal(serve.LADDER_READ_TIMEOUT_MS, 15_000, "the bound: 15 s");
  const inChild = serve.readLadderInChild!;
  const w = world("w300-b2-child", "backlog");
  assert.deepEqual(await inChild(w.studio, OPUS), { ...read(w).answer, why: `${OPUS} is in the backlog; only the Patron greenlights` }, "the injected read answers what the read answers");
  const scripts = mkdtempSync(join(tmpdir(), "w300-entry-"));
  dirs.push(scripts);
  const entry = (name: string, body: string): string => {
    const p = join(scripts, `${name}.mjs`);
    writeFileSync(p, body);
    return p;
  };
  const t0 = Date.now();
  assert.deepEqual(await inChild(w.studio, OPUS, { entry: entry("hang", 'import { createServer } from "node:net";\ncreateServer().listen(0);\n'), timeoutMs: 500 }), { id: OPUS, read: "unavailable", why: "the step read took longer than 0.5 s" }, "a read past its bound is killed and says so");
  assert.ok(Date.now() - t0 < 14_000, "the bound holds");
  assert.deepEqual(await inChild(w.studio, OPUS, { entry: entry("garbage", 'console.log("not json");\n') }), { id: OPUS, read: "unavailable", why: "the step read answered nothing readable" }, "output that is not an answer is unavailable");
  assert.deepEqual(await inChild(w.studio, OPUS, { entry: entry("other", 'console.log(JSON.stringify({ id: "W-1", read: "ok" }));\n') }), { id: OPUS, read: "unavailable", why: "the step read answered nothing readable" }, "another opus's answer is unavailable");
  assert.deepEqual(await inChild(w.studio, OPUS, { entry: entry("exit", "process.exit(3);\n") }), { id: OPUS, read: "unavailable", why: "the step read exited 3" }, "a failed child is unavailable");
  const t1 = Date.now();
  assert.deepEqual(await inChild(w.studio, OPUS, { entry: entry("flood", 'import { createServer } from "node:net";\ncreateServer().listen(0);\nprocess.stdout.write("x".repeat(2 * 1024 * 1024));\n') }), { id: OPUS, read: "unavailable", why: "the step read printed too much" }, "a flood says so");
  assert.ok(Date.now() - t1 < 14_000, "a flood is killed");

  // the seams: the server imports no CLI module, and serve loads no ladder at start
  for (const f of readdirSync(join(REPO_ROOT, "apps", "server", "src"))) assert.doesNotMatch(readFileSync(join(REPO_ROOT, "apps", "server", "src", f), "utf8"), /from "@bisellium\/(cli|commands)/, `${f} imports no CLI module`);
  assert.doesNotMatch(readFileSync(join(HERE, "serve.ts"), "utf8"), /from "\.\/(next|ladder-read)\.js"/, "serve.ts never derives in its own process");
});
