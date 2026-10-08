/**
 * W-128 focused red suite: the ladder follow-on (retired scripts, the guarded
 * trunk fast-forward, the checkpoint heading, the landing remedy and the
 * dirty-red warning). Select exactly one numbered behaviour with
 * `--behaviour N` (1..8); omitting the selector runs all eight. node:test TAP,
 * one test() per behaviour, modelled on next.test.ts and answer-carry.test.ts.
 *
 * Behaviours 3-5 call `fetchTrunk` in process against real git fixtures (a bare
 * origin and a clone under os.tmpdir()), with a logging `git` shim first on PATH
 * so every call the function makes is observable. Behaviours 6-7 call
 * `deriveNext` with a hand-built cast `Facts`. Behaviour 8 spawns the real CLI.
 * No timers, sleeps or polling: every spawn is synchronous.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fetchTrunk } from "./integrate.js";
import { deriveNext, type Facts } from "./next.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 8)) {
  console.error("ladder-followon.test.ts: --behaviour must be an integer from 1 through 8");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

// Pre-fix `fetchTrunk(repo)` takes one parameter; the cast keeps this file typechecking in phase 1.
const fetchTrunkT = fetchTrunk as (repo: string, target?: string) => ReturnType<typeof fetchTrunk>;

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "main.ts");
const REPO = join(HERE, "..", "..", "..");
const SAMPLE = join(REPO, "examples", "sample-studio");
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

// ---------------------------------------------------------------------------
// scratch, git helpers, the logging git shim
// ---------------------------------------------------------------------------
const dirs: string[] = [];
function scratch(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w128-${tag}-`)));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

Object.assign(process.env, {
  LC_ALL: "C",
  LANG: "C",
  TZ: "UTC",
  HOME: scratch("home"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "W-128 Test",
  GIT_AUTHOR_EMAIL: "w128@example.invalid",
  GIT_COMMITTER_NAME: "W-128 Test",
  GIT_COMMITTER_EMAIL: "w128@example.invalid",
  GIT_STUB_REAL: REAL_GIT,
});
delete process.env["BISELLIUM_SELLA"];
delete process.env["BISELLIUM_ROLE"];

const BIN = scratch("bin");
writeFileSync(
  join(BIN, "git"),
  `#!/bin/sh\nif [ -n "\${GIT_STUB_LOG:-}" ]; then\n  { printf 'git'; for a in "$@"; do printf '\\037%s' "$a"; done; printf '\\n'; } >> "$GIT_STUB_LOG"\nfi\nexec "$GIT_STUB_REAL" "$@"\n`,
  { mode: 0o755 },
);
process.env["PATH"] = `${BIN}:${process.env["PATH"] ?? "/usr/bin:/bin"}`;

/** Fixture git: the real binary by absolute path, so setup is never logged by the shim. */
function G(cwd: string, args: string[]): string {
  const r = spawnSync(REAL_GIT, args, { cwd, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.stderr}${r.stdout}`);
  return r.stdout.trim();
}
const put = (dir: string, rel: string, text: string): void => {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

// ---------------------------------------------------------------------------
// the origin/clone fixture for behaviours 3-5
// ---------------------------------------------------------------------------
interface Fx {
  dir: string;
  origin: string;
  other: string;
  clone: string;
  log: string;
}
function fixture(tag: string): Fx {
  const dir = scratch(tag);
  const origin = join(dir, "origin.git");
  const other = join(dir, "other");
  const clone = join(dir, "clone");
  G(dir, ["init", "-q", "--bare", "-b", "master", origin]);
  G(dir, ["init", "-q", "-b", "master", other]);
  put(other, "README", "base\n");
  put(other, ".gitignore", "ignored.txt\nnode_modules/\ngen/\nign-sub\n");
  G(other, ["add", "-A"]);
  G(other, ["commit", "-q", "-m", "base"]);
  G(other, ["remote", "add", "origin", origin]);
  G(other, ["push", "-q", "origin", "master"]);
  G(dir, ["clone", "-q", origin, clone]);
  return { dir, origin, other, clone, log: join(dir, "git.log") };
}
/** Commit `files` in the second clone (ignored paths included) and push; returns the new origin tip. */
function pushFrom(fx: Fx, files: Record<string, string>, message: string): string {
  for (const [rel, text] of Object.entries(files)) put(fx.other, rel, text);
  G(fx.other, ["add", "-f", "-A"]);
  G(fx.other, ["commit", "-q", "-m", message]);
  G(fx.other, ["push", "-q", "origin", "master"]);
  return G(fx.other, ["rev-parse", "HEAD"]);
}
function localCommit(fx: Fx, rel: string, text: string): string {
  put(fx.clone, rel, text);
  G(fx.clone, ["add", "-A"]);
  G(fx.clone, ["commit", "-q", "-m", `local ${rel}`]);
  return G(fx.clone, ["rev-parse", "HEAD"]);
}
const master = (fx: Fx): string => G(fx.clone, ["rev-parse", "refs/heads/master"]);

function hashes(dir: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) Object.assign(out, hashes(dir, r));
    else out[r] = createHash("sha256").update(readFileSync(join(dir, r))).digest("hex");
  }
  return out;
}
interface Snap {
  master: string;
  head: string;
  status: string;
  files: Record<string, string>;
}
const snap = (dir: string): Snap => ({
  master: G(dir, ["rev-parse", "refs/heads/master"]),
  head: G(dir, ["symbolic-ref", "-q", "HEAD"]),
  status: G(dir, ["status", "--porcelain"]),
  files: hashes(dir),
});

/** Call fetchTrunk with a fresh shim log and return the calls it made, as argv arrays after `git`. */
function callFetch(fx: Fx, target?: string): { r: ReturnType<typeof fetchTrunk>; calls: string[][] } {
  writeFileSync(fx.log, "");
  process.env["GIT_STUB_LOG"] = fx.log;
  try {
    const r = fetchTrunkT(fx.clone, target);
    return { r, calls: readFileSync(fx.log, "utf8").split("\n").filter(Boolean).map((l) => l.split("\x1f").slice(1)) };
  } finally {
    delete process.env["GIT_STUB_LOG"];
  }
}
/** The git verb of a call, past any leading -c/-C pairs. */
function verbOf(a: string[]): string {
  const rest = [...a];
  while (rest[0] === "-c" || rest[0] === "-C") rest.splice(0, 2);
  return rest[0] ?? "";
}
const merges = (calls: string[][]): string[][] => calls.filter((a) => verbOf(a) === "merge");
const FORBIDDEN_VERBS = new Set(["reset", "pull", "stash", "checkout", "switch", "restore", "clean"]);
const FORBIDDEN_FLAGS = new Set(["--force", "-f", "--update-head-ok"]);

/** A fetchTrunk call that must hold: one non-empty line naming `subs`, and nothing moved or merged. */
function holdCase(label: string, fx: Fx, target: string | undefined, subs: string[], others: string[] = []): string {
  const before = snap(fx.clone);
  const othersBefore = others.map(snap);
  const { r, calls } = callFetch(fx, target);
  assert.equal(r.ok, false, `${label}: fetchTrunk holds`);
  const reason = r.ok ? "" : r.reason;
  const shown = reason.split(fx.dir).join("<fx>");
  assert.ok(reason.length > 0 && !reason.includes("\n"), `${label}: the reason is one non-empty line`);
  for (const sub of subs) assert.ok(reason.includes(sub), `${label}: the reason contains "${sub.split(fx.dir).join("<fx>")}" (reason: ${shown})`);
  const after = snap(fx.clone);
  assert.equal(after.master, before.master, `${label}: refs/heads/master is unmoved`);
  assert.equal(after.head, before.head, `${label}: HEAD is unmoved`);
  assert.equal(after.status, before.status, `${label}: git status --porcelain is unchanged`);
  assert.deepEqual(after.files, before.files, `${label}: every working-tree file (ignored included) is unchanged`);
  others.forEach((o, i) => assert.deepEqual(snap(o), othersBefore[i], `${label}: the other worktree ${i + 1} is untouched`));
  assert.equal(merges(calls).length, 0, `${label}: no merge call was made`);
  return reason;
}
/** A fetchTrunk call that must succeed and leave master at `want`. */
function okCase(label: string, fx: Fx, target: string, want: string): void {
  const { r } = callFetch(fx, target);
  assert.equal(r.ok, true, `${label}: fetchTrunk now returns ok (${r.ok ? "" : r.reason.split(fx.dir).join("<fx>")})`);
  assert.equal(master(fx), want, `${label}: master equals the target`);
}

// ---------------------------------------------------------------------------
// 1. the retired scripts are gone, and nothing live names them
// ---------------------------------------------------------------------------
if (runs(1)) {
  test("W-128 behaviour 1: the retired scripts are gone, and nothing live names them", () => {
    assert.equal(existsSync(join(REPO, "scripts", "open-pr.sh")), false, "1a: scripts/open-pr.sh does not exist on disk");
    assert.equal(existsSync(join(REPO, "scripts", "merge-gate.sh")), false, "1a: scripts/merge-gate.sh does not exist on disk");
    const tracked = spawnSync("git", ["-C", REPO, "ls-files", "--", "scripts/open-pr.sh", "scripts/merge-gate.sh"], { encoding: "utf8" });
    assert.equal(tracked.status, 0, "1b: git ls-files runs");
    assert.equal(tracked.stdout.trim(), "", "1b: neither script is tracked (the deletion is in the index, not just the working copy)");
    const grep = spawnSync(
      "git",
      ["-C", REPO, "grep", "-nE", "open-pr\\.sh|merge-gate\\.sh", "--", ".", ":(exclude)studio", ":(exclude)docs/SESSION-HANDOFF.md", ":(exclude)docs/design/dossier", ":(exclude)packages/cli/src/ladder-followon.test.ts"],
      { encoding: "utf8" },
    );
    assert.equal(grep.status, 1, `1c: git grep for the script names finds nothing (status ${grep.status}); matches:\n${grep.stdout}`);
    assert.equal(grep.stdout, "", "1c: git grep prints nothing");
  });
}

// ---------------------------------------------------------------------------
// 2. the parity pins are gone and the suite still guards what the verb does
// ---------------------------------------------------------------------------
if (runs(2)) {
  test("W-128 behaviour 2: the parity pins are gone and the suite still guards what the verb does", () => {
    const nextTest = readFileSync(join(HERE, "next.test.ts"), "utf8");
    const integrate = readFileSync(join(HERE, "integrate.ts"), "utf8");
    assert.ok(nextTest.includes("W-124 behaviour 3:"), "2a: the W-124 behaviour 3 test is still declared");
    assert.ok(!nextTest.includes("open-pr.sh"), "2b: next.test.ts does not name open-pr.sh");
    assert.ok(!nextTest.includes("merge-gate.sh"), "2b: next.test.ts does not name merge-gate.sh");
    assert.ok(!/\bSCRIPTS\b/.test(nextTest), "2b: next.test.ts has no SCRIPTS word");
    assert.ok(!/parity/i.test(nextTest), "2b: next.test.ts has no parity word");
    assert.ok(!nextTest.includes('spawnSync("bash"'), "2b: next.test.ts spawns no bash");
    const at = nextTest.indexOf("const TERMINALS");
    assert.ok(at !== -1, "2c: next.test.ts declares a TERMINALS table");
    const table = nextTest.slice(at, nextTest.indexOf("];", at));
    const names = [...table.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*\bterminal:[^}]*\bcalls:/g)].map((m) => m[1]);
    assert.deepEqual(names, ["CHECKS_FAILED", "GHAS_STOP", "MERGE_FAILED", "MERGED", "QUEUE_REJECTED", "CONFLICT", "dirty tree", "on master", "CREATED"], "2c: the TERMINALS rows are the nine former rows, each with terminal and calls");
    assert.equal(integrate.split("spawnSync(").length - 1, 1, "2d: integrate.ts has exactly one spawnSync( call");
    assert.ok(!integrate.includes("shell:"), "2d: integrate.ts passes no shell option");
    assert.ok(!integrate.includes('"bash"'), "2d: integrate.ts names no bash");
    assert.ok(!integrate.includes("execSync"), "2d: integrate.ts has no execSync");
    assert.ok(!/(?<![.\w])exec\(/.test(integrate), "2d: integrate.ts has no bare exec( call");
  });
}

// ---------------------------------------------------------------------------
// 3. a current, checked-out master is not a hold
// ---------------------------------------------------------------------------
if (runs(3)) {
  test("W-128 behaviour 3: a current, checked-out master is not a hold", () => {
    const fx = fixture("b3");
    const tip = master(fx);
    const before = snap(fx.clone);
    const control = spawnSync(REAL_GIT, ["fetch", "-q", "origin", "master:master"], { cwd: fx.clone, encoding: "utf8" });
    assert.notEqual(control.status, 0, "3a: git fetch origin master:master into the checked-out master exits non-zero");
    assert.ok(control.stderr.includes("refusing to fetch"), "3a: git itself says refusing to fetch");

    const noTarget = callFetch(fx);
    assert.equal(noTarget.r.ok, true, `3b: fetchTrunk(clone) returns ok (${noTarget.r.ok ? "" : noTarget.r.reason.split(fx.dir).join("<fx>")})`);
    const withTarget = callFetch(fx, tip);
    assert.equal(withTarget.r.ok, true, `3c: fetchTrunk(clone, origin tip) returns ok (${withTarget.r.ok ? "" : withTarget.r.reason.split(fx.dir).join("<fx>")})`);

    const after = snap(fx.clone);
    assert.equal(after.head, "refs/heads/master", "3d: HEAD is still refs/heads/master");
    assert.equal(after.master, before.master, "3d: refs/heads/master is unchanged");
    assert.equal(after.status, before.status, "3d: git status --porcelain is unchanged");
    assert.equal(merges(noTarget.calls).length + merges(withTarget.calls).length, 0, "3d: the shim log holds no merge call");
  });
}

// ---------------------------------------------------------------------------
// 4. a clean, checked-out master that is behind is fast-forwarded to the reviewed commit, and no further
// ---------------------------------------------------------------------------
if (runs(4)) {
  test("W-128 behaviour 4: a clean checked-out master that is behind is fast-forwarded to the reviewed merge commit and no further", () => {
    const fx = fixture("b4");
    const old = master(fx);
    const c1 = pushFrom(fx, { "added.txt": "added by c1\n", README: "base\nchanged by c1\n" }, "c1");
    const c2 = pushFrom(fx, { "c2.txt": "c2\n" }, "c2");
    const remoteTip = G(fx.clone, ["ls-remote", "origin", "master"]).split(/\s+/)[0];
    assert.equal(remoteTip, c2, "4a: control, the origin tip is C2");
    assert.notEqual(master(fx), remoteTip, "4a: control, local master differs from the origin tip (the fixture is behind)");

    const first = callFetch(fx, c1);
    assert.equal(first.r.ok, true, `4b: fetchTrunk(clone, C1) returns ok (${first.r.ok ? "" : first.r.reason.split(fx.dir).join("<fx>")})`);
    assert.equal(master(fx), c1, "4c: refs/heads/master equals C1, not C2");
    assert.equal(G(fx.clone, ["symbolic-ref", "-q", "HEAD"]), "refs/heads/master", "4c: HEAD is still refs/heads/master");
    assert.equal(readFileSync(join(fx.clone, "added.txt"), "utf8"), "added by c1\n", "4c: the added file exists with the pushed content");
    assert.equal(readFileSync(join(fx.clone, "README"), "utf8"), "base\nchanged by c1\n", "4c: the tracked file carries the pushed change");
    assert.equal(G(fx.clone, ["status", "--porcelain"]), "", "4c: git status --porcelain is empty");
    assert.equal(G(fx.clone, ["rev-list", "--count", `${old}..master`]), "1", "4c: exactly one commit was added (a fast-forward, not a rewrite)");

    const mergeCalls = merges(first.calls);
    assert.equal(mergeCalls.length, 1, "4d: exactly one merge call");
    assert.deepEqual(mergeCalls[0], ["-c", "submodule.recurse=false", "merge", "-q", "--ff-only", c1], "4d: the merge argv is the literal reviewed oid with --ff-only");
    const at = first.calls.findIndex((a) => verbOf(a) === "merge");
    assert.deepEqual(first.calls[at - 1], ["symbolic-ref", "-q", "HEAD"], "4d: the call immediately before the merge is symbolic-ref -q HEAD");
    for (const a of first.calls) {
      assert.ok(!FORBIDDEN_VERBS.has(verbOf(a)), `4d: no ${verbOf(a)} call`);
      assert.ok(!a.some((x) => FORBIDDEN_FLAGS.has(x)), `4d: no force flag in git ${a.join(" ")}`);
    }

    const second = callFetch(fx, c1);
    assert.equal(second.r.ok, true, "4e: a second fetchTrunk(clone, C1) returns ok (contained is ok)");
    assert.equal(merges(second.calls).length, 0, "4e: the second call makes no further merge call");
  });
}

// ---------------------------------------------------------------------------
// 5. every case the verb must not repair holds, names why, and succeeds once the obstacle is gone
// ---------------------------------------------------------------------------
if (runs(5)) {
  test("W-128 behaviour 5: every case the verb must not repair holds without moving anything, names why, and succeeds once the obstacle is gone", () => {
    // (a) another worktree holds master
    const a = fixture("b5a");
    const aTip = pushFrom(a, { "c1.txt": "c1\n" }, "c1");
    G(a.clone, ["switch", "-q", "-c", "side"]);
    const mwt = join(a.dir, "mwt");
    G(a.clone, ["worktree", "add", "-q", mwt, "master"]);
    holdCase("5a", a, aTip, [mwt, "pull --ff-only"], [mwt]);

    // (b) origin does not exist
    const b = fixture("b5b");
    G(b.clone, ["remote", "set-url", "origin", join(b.dir, "nope.git")]);
    holdCase("5b", b, master(b), []);

    // (c) no target, behind: the pr rung never moves a checkout
    const c = fixture("b5c");
    pushFrom(c, { "c1.txt": "c1\n" }, "c1");
    holdCase("5c", c, undefined, ["pull --ff-only", c.clone]);

    // (d) behind, a tracked file modified
    const d = fixture("b5d");
    const dTip = pushFrom(d, { "c1.txt": "c1\n" }, "c1");
    writeFileSync(join(d.clone, "README"), "base\nlocal edit\n");
    holdCase("5d", d, dTip, ["uncommitted"]);

    // (e) diverged
    const e = fixture("b5e");
    localCommit(e, "local.txt", "local\n");
    const eTip = pushFrom(e, { "remote.txt": "remote\n" }, "remote");
    holdCase("5e", e, eTip, ["diverged"]);

    // (f) no target, local master ahead of an unmoved origin
    const f = fixture("b5f");
    localCommit(f, "local.txt", "local\n");
    holdCase("5f", f, undefined, ["ahead"]);

    // (g) an ignored file where the incoming commit adds a tracked file
    const g = fixture("b5g");
    const gTip = pushFrom(g, { "ignored.txt": "incoming\n" }, "adds ignored.txt");
    put(g.clone, "ignored.txt", "local data");
    holdCase("5g", g, gTip, ["untracked or ignored", "ignored.txt"]);
    assert.equal(readFileSync(join(g.clone, "ignored.txt"), "utf8"), "local data", "5g: the ignored file's bytes are unchanged");

    // (h) an ignored directory where the incoming commit adds a file of that name
    const h = fixture("b5h");
    const hTip = pushFrom(h, { node_modules: "incoming file\n" }, "adds a node_modules file");
    put(h.clone, "node_modules/dep.js", "local data");
    holdCase("5h", h, hTip, ["untracked or ignored", "node_modules"]);
    assert.equal(readFileSync(join(h.clone, "node_modules", "dep.js"), "utf8"), "local data", "5h: the ignored directory's file is unchanged");

    // (i) a target that is not on origin/master
    const i = fixture("b5i");
    G(i.clone, ["switch", "-q", "-c", "side"]);
    const side = localCommit(i, "side.txt", "side\n");
    G(i.clone, ["switch", "-q", "master"]);
    pushFrom(i, { "c1.txt": "c1\n" }, "c1");
    holdCase("5i", i, side, ["not on origin/master"]);

    // (j) the merge itself fails: an index.lock makes merge --ff-only exit non-zero
    const j = fixture("b5j");
    const jTip = pushFrom(j, { "c1.txt": "c1\n" }, "c1");
    writeFileSync(join(j.clone, ".git", "index.lock"), "");
    const jBefore = snap(j.clone);
    const jr = callFetch(j, jTip).r;
    assert.equal(jr.ok, false, "5j: a failed merge holds");
    const jReason = jr.ok ? "" : jr.reason;
    assert.ok(jReason.includes("may be partly updated"), `5j: the reason says the tree may be partly updated (reason: ${jReason.split(j.dir).join("<fx>")})`);
    assert.ok(jReason.includes("git -C"), "5j: the reason names git -C");
    assert.ok(jReason.includes(j.clone), "5j: the reason names the clone's path");
    assert.equal(master(j), jBefore.master, "5j: refs/heads/master is unmoved");
    assert.equal(G(j.clone, ["symbolic-ref", "-q", "HEAD"]), jBefore.head, "5j: HEAD is unmoved");

    // (k) retry once the obstacle is gone
    G(d.clone, ["checkout", "--", "README"]);
    okCase("5k-d", d, dTip, dTip);
    rmSync(join(g.clone, "ignored.txt"));
    okCase("5k-g", g, gTip, gTip);

    // (l) a nested incoming path under an ignored directory
    const l = fixture("b5l");
    const lTip = pushFrom(l, { "gen/out/x.txt": "incoming\n" }, "adds gen/out/x.txt");
    put(l.clone, "gen/out/x.txt", "local data");
    holdCase("5l", l, lTip, ["untracked or ignored", "gen/out/x.txt"]);
    assert.equal(readFileSync(join(l.clone, "gen", "out", "x.txt"), "utf8"), "local data", "5l: the nested ignored file's bytes are unchanged");
    rmSync(join(l.clone, "gen"), { recursive: true });
    okCase("5l-retry", l, lTip, lTip);

    // (m) a gitlink where an ignored local file sits, with diff.ignoreSubmodules=all in the clone's config
    const m = fixture("b5m");
    G(m.other, ["update-index", "--add", "--cacheinfo", `160000,${G(m.other, ["rev-parse", "HEAD"])},ign-sub`]);
    G(m.other, ["commit", "-q", "-m", "adds a gitlink at ign-sub"]);
    G(m.other, ["push", "-q", "origin", "master"]);
    const mTip = G(m.other, ["rev-parse", "HEAD"]);
    G(m.clone, ["config", "diff.ignoreSubmodules", "all"]);
    put(m.clone, "ign-sub", "local data");
    holdCase("5m", m, mTip, ["untracked or ignored", "ign-sub"]);
    assert.equal(readFileSync(join(m.clone, "ign-sub"), "utf8"), "local data", "5m: the ignored file's bytes are unchanged");
    rmSync(join(m.clone, "ign-sub"));
    okCase("5m-retry", m, mTip, mTip);

    // (n) an annotated-tag oid peels to a commit but is not the reviewed commit itself
    const n = fixture("b5n");
    const nTip = pushFrom(n, { "c1.txt": "c1\n" }, "c1");
    G(n.clone, ["fetch", "-q", "origin"]);
    G(n.clone, ["tag", "-a", "-m", "tag", "t1", nTip]);
    holdCase("5n", n, G(n.clone, ["rev-parse", "refs/tags/t1"]), ["not itself a commit"]);
  });
}

// ---------------------------------------------------------------------------
// 6. the checkpoint rung reads the done commit, not a heading (W-141)
// ---------------------------------------------------------------------------
const checkpoint = (handoff: string | undefined, checkpointed: boolean): ReturnType<typeof deriveNext> =>
  deriveNext({ id: "W-900", trunkRecord: { state: "done" }, handoff, checkpointed: () => checkpointed, owed: () => ({ owed: [] }) } as unknown as Facts);

if (runs(6)) {
  test("W-128 behaviour 6: the checkpoint rung reads whether the done commit changed the handoff", () => {
    const control = checkpoint("# Handoff\n\n- W-900 is done.\n", true);
    assert.equal(control.step, "checkpoint", "6a: the done opus lands on the checkpoint rung");
    assert.equal(control.status, "complete", "6a: a done commit that changed the handoff is complete, heading or not");
    const named = checkpoint("## Where things stand\n\n- W-900 is done.\n", false);
    assert.equal(named.status, "named", "6b: a heading naming W-900 does not complete a done commit that left the handoff unchanged");
    assert.equal(checkpoint(undefined, false).status, "complete", "6c: no handoff on master: complete once the record is done");
  });
}

// ---------------------------------------------------------------------------
// 7. a spec or done that must still land names next's own landing, never the scripts (W-141)
// ---------------------------------------------------------------------------
const mem = (files: Record<string, string>): { read(rel: string): string | undefined; list(dir: string): string[] } => ({
  read: (rel) => files[rel],
  list: (dir) => Object.keys(files).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
});
const BRIEF = ["# W-900", "", ...["Intent", "Files owned", "Interfaces", "Behaviours to test", "Acceptance", "Out of scope"].flatMap((s) => [`## ${s}`, "", "text", ""])].join("\n");
const SPEC_LOG = "# phase: spec\n# opus: W-900\n# sella: architect\n# outcome: passed\n";
const evidence = (): Record<string, string> => ({ "briefs/W-900.md": BRIEF, "ci/W-900-spec-1.log": SPEC_LOG });

if (runs(7)) {
  test("W-128 behaviour 7: a spec or done that must still land is landed by next, never by the scripts", () => {
    const base = { id: "W-900", design: "architect", trunkRecord: { state: "greenlit" }, uiSpecProblems: () => [] as string[] };
    const spec = deriveNext({ ...base, trunk: undefined, specBranch: mem(evidence()) } as unknown as Facts);
    const done = deriveNext({
      ...base,
      trunk: mem(evidence()),
      specBranch: undefined,
      tip: undefined,
      pushed: false,
      pr: () => ({ kind: "settled", pr: {} }),
      residue: false,
      choreDone: true,
      certified: () => true,
    } as unknown as Facts);

    assert.equal(spec.step, "spec", "7a: the spec fixture names the spec rung");
    assert.equal(spec.status, "named", "7a: the spec rung is named");
    assert.equal(spec.actor, "producer", "7a: the spec landing is the producer's");
    assert.match(spec.why, /spec signed on spec\/W-900, not on master/, "7a: the spec why is unchanged");
    assert.equal(done.step, "done", "7b: the done fixture names the done rung");
    assert.equal(done.status, "named", "7b: the done rung is named");
    assert.match(done.why, /done committed on chore\/done-W-900, not on master/, "7b: the done why is unchanged");

    for (const [label, d] of [["spec", spec], ["done", done]] as const) {
      const command = d.command ?? "";
      assert.ok(!command.includes("scripts/"), `7c: the ${label} command does not name scripts/ (${command})`);
      assert.ok(!command.includes("open-pr"), `7c: the ${label} command does not name open-pr`);
      assert.ok(!command.includes("merge-gate"), `7c: the ${label} command does not name merge-gate`);
    }

    // W-141: the landing is the verb's own rung, not a hand script
    assert.equal(spec.command, "bisellium next W-900 --perform --expect spec", "7d: the spec landing is performed by next");
    assert.equal(spec.act, "land", "7d: the spec rung's act is the landing");
    assert.equal(done.command, "bisellium next W-900 --perform --expect done", "7e: the done landing is performed by next");
    assert.equal(done.act, "land", "7e: the done rung's act is the landing");
  });
}

// ---------------------------------------------------------------------------
// 8. `red` says so when it records a dirty-tree identity
// ---------------------------------------------------------------------------
if (runs(8)) {
  test("W-128 behaviour 8: red says so when it records a dirty-tree identity", () => {
    const R = scratch("b8");
    G(R, ["init", "-q", "-b", "master"]);
    put(R, "src/a.txt", "one\n");
    cpSync(SAMPLE, join(R, "studio"), { recursive: true, dereference: true });
    G(R, ["add", "-A"]);
    G(R, ["commit", "-q", "-m", "fixture"]);
    const red = (k: number, exit: 0 | 1): { status: number | null; stdout: string; stderr: string } => {
      const r = spawnSync(
        process.execPath,
        ["--import", import.meta.resolve("tsx"), MAIN, "red", "W-900", "--behaviour", String(k), "--sella", "eng-lead", "--studio", join(R, "studio"), "--repo", R, "--now", "2026-10-02T12:00:00Z", "--", "node", "-e", `process.exit(${exit})`],
        { cwd: R, encoding: "utf8", timeout: 120_000, env: process.env },
      );
      if (r.error) throw r.error;
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const logOf = (k: number): string => join(R, "studio", "ci", "reds", "W-900", `${String(k).padStart(2, "0")}.log`);

    const clean = red(1, 1);
    assert.equal(clean.status, 0, "8a: a clean-tree red exits 0");
    assert.equal(clean.stdout.trim(), "W-900: red recorded for behaviour 1 -> ci/reds/W-900/01.log", "8a: stdout is exactly the recorded line");
    assert.ok((readFileSync(logOf(1), "utf8").split("\n")[5] ?? "").startsWith("# tree: tree:"), "8a: the clean log's header line 6 starts # tree: tree:");
    assert.ok(!clean.stderr.includes("warning"), "8a: no warning on a clean tree");

    writeFileSync(join(R, "src", "a.txt"), "one\ntwo\n");
    const passed = red(2, 0);
    assert.equal(passed.status, 1, "8b: a passing command exits 1");
    assert.ok(!passed.stderr.includes("warning"), "8b: nothing recorded, so no warning");
    assert.equal(existsSync(logOf(2)), false, "8b: 02.log does not exist");

    const dirty = red(3, 1);
    assert.equal(dirty.status, 0, "8c: a dirty-tree red still exits 0");
    assert.equal(dirty.stdout.trim(), "W-900: red recorded for behaviour 3 -> ci/reds/W-900/03.log", "8c: stdout is exactly the recorded line");
    const dirtyLog = readFileSync(logOf(3), "utf8");
    assert.ok((dirtyLog.split("\n")[5] ?? "").startsWith("# tree: dirty:"), "8c: the dirty log's header line 6 starts # tree: dirty:");
    assert.ok(!dirtyLog.includes("warning"), "8c: the log carries no warning");

    const warnings = dirty.stderr.split("\n").filter((l) => l.startsWith("red: warning: "));
    assert.equal(warnings.length, 1, "8d: exactly one stderr line begins red: warning:");
    assert.ok(warnings[0]!.includes("dirty:"), "8d: the warning names dirty:");
    assert.ok(warnings[0]!.includes("commit the tests first"), "8d: the warning says to commit the tests first");
  });
}
