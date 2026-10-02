/**
 * W-129 behaviours 3-9: serve reads branch-owned records. A snapshot-on-poll
 * overlay of `opus/<id>` records over the trunk checkout's `opera/`, hardened
 * against a hostile or half-written worktree file, bounded in git use, and
 * honest about degradation. Select exactly one numbered behaviour with
 * `--behaviour N` (3..9); omitting the selector runs all seven. node:test TAP,
 * one test() per behaviour, modelled on ladder-followon.test.ts.
 *
 * Real git fixtures under os.tmpdir(), a logging `git` shim first on PATH (it
 * appends its argv, one US-separated field per element, and the env facts the
 * rows pin, then `exec`s the real git), and `startServer` in process with
 * `once: true` and `POST /api/_poll`. The shim also injects failures, hangs and
 * holds from a control directory. No timers, sleeps or polling.
 *
 * Every FIFO a row creates (except in 5(j)) is opened O_RDWR by the test before
 * anything can block on it and is released through those same handles in a
 * `finally`, so a failing row ends the process instead of hanging it.
 * `branchRecords.ts` does not exist before the fix: 5(j) reaches it through a
 * tsc-safe dynamic import, after row 5(a).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  constants,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { open as openFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { startServer, type StartServerOptions } from "../src/index.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 3 || only! > 9)) {
  console.error("branch-records.test.ts: --behaviour must be an integer from 3 through 9");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

process.env["NODE_ENV"] = "test";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const SAMPLE = join(REPO, "examples", "sample-studio");
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const NOW = new Date("2026-09-18T17:00:00Z");
const FIXED_DATE = "2026-08-01T00:00:00Z";

// ---------------------------------------------------------------------------
// scratch, the environment, the logging git shim
// ---------------------------------------------------------------------------
const dirs: string[] = [];
function scratch(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w129-${tag}-`)));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

Object.assign(process.env, { LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: scratch("home"), GIT_TERMINAL_PROMPT: "0", STUB_REAL_GIT: REAL_GIT });
for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_CONFIG_COUNT"]) delete process.env[k];
delete process.env["BISELLIUM_SELLA"];

const BIN = scratch("bin");
const SHIM = [
  "#!/bin/sh",
  'verb="$1"',
  'if [ -n "${STUB_GIT_LOG:-}" ]; then',
  "  {",
  "    printf 'git'",
  '    for a in "$@"; do printf \'\\037%s\' "$a"; done',
  '    printf \'\\036%s\\036\' "${GIT_OPTIONAL_LOCKS-unset}"',
  '    if [ -n "${GIT_DIR+x}" ]; then printf D; fi',
  '    if [ -n "${GIT_WORK_TREE+x}" ]; then printf W; fi',
  '    if [ -n "${GIT_INDEX_FILE+x}" ]; then printf I; fi',
  '    if [ -n "${GIT_COMMON_DIR+x}" ]; then printf C; fi',
  '    if [ -n "${GIT_CONFIG_COUNT+x}" ]; then printf K; fi',
  "    printf '\\n'",
  '  } >> "$STUB_GIT_LOG"',
  "fi",
  'if [ -n "${STUB_GIT_CTL:-}" ]; then',
  '  if [ -f "$STUB_GIT_CTL/fail-$verb" ]; then',
  '    echo "stub: injected failure" >&2',
  '    exit "$(cat "$STUB_GIT_CTL/fail-$verb")"',
  "  fi",
  '  if [ -f "$STUB_GIT_CTL/hang-$verb" ]; then',
  '    echo "$$" > "$(cat "$STUB_GIT_CTL/hang-$verb")"',
  "    exec tail -f /dev/null",
  "  fi",
  '  if [ -f "$STUB_GIT_CTL/hold-$verb" ]; then',
  '    { read -r ann; read -r blk; } < "$STUB_GIT_CTL/hold-$verb"',
  '    echo started > "$ann"',
  '    read -r _ < "$blk"',
  "  fi",
  "fi",
  'exec "$STUB_REAL_GIT" "$@"',
  "",
].join("\n");
writeFileSync(join(BIN, "git"), SHIM, { mode: 0o755 });
process.env["PATH"] = `${BIN}:${process.env["PATH"] ?? "/usr/bin:/bin"}`;

interface Shim {
  log: string;
  ctl: string;
  stop: () => void;
}
function useShim(): Shim {
  const dir = scratch("shim");
  const log = join(dir, "git.log");
  const ctl = join(dir, "ctl");
  mkdirSync(ctl);
  writeFileSync(log, "");
  process.env["STUB_GIT_LOG"] = log;
  process.env["STUB_GIT_CTL"] = ctl;
  return {
    log,
    ctl,
    stop: () => {
      delete process.env["STUB_GIT_LOG"];
      delete process.env["STUB_GIT_CTL"];
    },
  };
}
interface Call {
  argv: string[];
  locks: string;
  env: string;
}
function calls(shim: Shim): Call[] {
  return readFileSync(shim.log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [args = "", locks = "", env = ""] = line.split("\x1e");
      return { argv: args.split("\x1f").slice(1), locks, env };
    });
}
const verbCount = (cs: Call[], verb: string): number => cs.filter((c) => c.argv[0] === verb).length;

/** Fixture git: the real binary by absolute path, so setup is never logged by the shim. */
function G(cwd: string, args: string[], env: Record<string, string> = {}): string {
  const clean = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_CONFIG_COUNT"]) delete clean[k];
  const r = spawnSync(REAL_GIT, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...clean,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "W-129 Test",
      GIT_AUTHOR_EMAIL: "w129@example.invalid",
      GIT_COMMITTER_NAME: "W-129 Test",
      GIT_COMMITTER_EMAIL: "w129@example.invalid",
      GIT_AUTHOR_DATE: FIXED_DATE,
      GIT_COMMITTER_DATE: FIXED_DATE,
      ...env,
    },
  });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.stderr}${r.stdout}`);
  return r.stdout.trim();
}

// ---------------------------------------------------------------------------
// record editing and the repo fixture
// ---------------------------------------------------------------------------
/** Replace (or append) one single-line front-matter key. */
function fmSet(text: string, key: string, value: string): string {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("fixture record has no front matter");
  const lines = m[1]!.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  const line = `${key}: ${value}`;
  if (at === -1) lines.push(line);
  else lines[at] = line;
  return `---\n${lines.join("\n")}\n---\n${m[2]}`;
}
const withBody = (text: string, body: string): string => `${/^(---\n[\s\S]*?\n---\n)/.exec(text)![1]}${body}\n`;
const bodyOf = (text: string): string => text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\n$/, "");

interface Repo {
  root: string;
  studio: string;
}
const wtPath = (r: Repo, id: string): string => join(r.root, ".worktrees", id);
const recPath = (dir: string, id: string): string => join(dir, "studio", "opera", `${id}.md`);
const adminOf = (r: Repo, id: string): string => join(r.root, ".git", "worktrees", id);

function candidateRecord(id: string): string {
  return `---\nid: ${id}\ntitle: Candidate ${id}\nkind: feature\ncollegium: engineering\nstate: greenlit\nprobationes: {}\n---\nCandidate ${id}.\n`;
}

/** R on master, R/studio a copy of the sample officina (W-006 greenlit, W-002 building, W-007 backlog). */
function makeRepo(tag: string, extraTrunk: (studio: string) => void = () => undefined): Repo {
  const root = join(scratch(tag), "R");
  mkdirSync(root);
  G(root, ["init", "-q", "-b", "master"]);
  const studio = join(root, "studio");
  cpSync(SAMPLE, studio, { recursive: true });
  rmSync(join(studio, ".bisellium"), { recursive: true, force: true });
  writeFileSync(join(root, ".gitignore"), ".bisellium/\n.worktrees/\n");
  extraTrunk(studio);
  G(root, ["add", "-A"]);
  G(root, ["commit", "-q", "-m", "trunk"]);
  return { root, studio };
}
/** Branch `opus/<id>` from master with `edit` committed to its record; the worktree is kept or removed. */
function addBranch(r: Repo, id: string, edit: (text: string) => string, o: { keep?: boolean; at?: string } = {}): string {
  const wt = wtPath(r, id);
  G(r.root, ["worktree", "add", "-q", "-b", `opus/${id}`, wt, "master"]);
  commitIn(wt, id, edit, o.at);
  if (!o.keep) G(r.root, ["worktree", "remove", "--force", wt]);
  return wt;
}
function commitIn(wt: string, id: string, edit: (text: string) => string, at?: string): void {
  const file = recPath(wt, id);
  writeFileSync(file, edit(readFileSync(file, "utf8")));
  G(wt, ["add", "-A"]);
  G(wt, ["commit", "-q", "-m", `opus ${id}`], at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {});
}
const building = (t: string): string => fmSet(withBody(t, "Branch body marker for the opus."), "state", "building");

/** The usual fixture: W-006 `building` and W-002 `verifying`, both in worktrees. */
function twoBranchRepo(tag: string): Repo {
  const r = makeRepo(tag);
  addBranch(r, "W-006", building, { keep: true });
  addBranch(r, "W-002", (t) => fmSet(t, "state", "verifying"), { keep: true });
  return r;
}

// ---------------------------------------------------------------------------
// the server and its HTTP surface
// ---------------------------------------------------------------------------
const fakeCheckStudio: StartServerOptions["checkStudio"] = () => ({ ok: true, blocks: 0, advisories: 0, findings: [] });
const noopRunners: StartServerOptions["runners"] = {
  answer: () => ({ exitCode: 0 }),
  greenlight: () => ({ exitCode: 0 }),
  budget: () => ({ exitCode: 0 }),
  handoff: () => ({ exitCode: 0 }),
  talk: async () => ({ exitCode: 0 }),
  pause: async () => ({ exitCode: 0 }),
  resume: async () => ({ exitCode: 0 }),
  delegate: () => ({ exitCode: 0 }),
};
const failingListModels: StartServerOptions["listModels"] = () => {
  throw new Error("no route in this test should request GET /api/models");
};

interface Running {
  base: string;
  close: () => Promise<void>;
}
async function start(studioDir: string, extra: Record<string, unknown> = {}): Promise<Running> {
  const server = await startServer({
    studioDir,
    checkStudio: fakeCheckStudio,
    runners: noopRunners,
    listModels: failingListModels,
    token: "w129-token",
    once: true,
    now: NOW,
    port: 0,
    ...extra,
  } as StartServerOptions);
  return { base: `http://127.0.0.1:${server.port}`, close: () => server.close() };
}
interface Json {
  status: number;
  text: string;
  body: any;
}
async function get(run: Running, path: string): Promise<Json> {
  const res = await fetch(run.base + path);
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, text, body };
}
async function poll(run: Running): Promise<{ ok: boolean; ingested: number }> {
  const res = await fetch(`${run.base}/api/_poll`, { method: "POST" });
  return (await res.json()) as { ok: boolean; ingested: number };
}
const opera = async (run: Running): Promise<any[]> => (await get(run, "/api/opera")).body as any[];
const entry = async (run: Running, id: string): Promise<any> => (await opera(run)).find((o) => o.id === id);
const stateOf = async (run: Running, id: string): Promise<string | undefined> => (await entry(run, id))?.state;
const officina = async (run: Running): Promise<any> => (await get(run, "/api/officina")).body;

/** Run `fn` against a server on `studio`, closing it whatever happens. */
async function serving<T>(studio: string, fn: (run: Running) => Promise<T>, extra: Record<string, unknown> = {}): Promise<T> {
  const run = await start(studio, extra);
  try {
    return await fn(run);
  } finally {
    await run.close();
  }
}
function plainStudio(tag: string): string {
  const dir = join(scratch(tag), "plain");
  cpSync(SAMPLE, dir, { recursive: true });
  rmSync(join(dir, ".bisellium"), { recursive: true, force: true });
  return dir;
}

/** An O_RDWR handle on a fresh FIFO, so no open or read of it can park without the test's say-so. */
async function fifo(path: string): Promise<{ fh: Awaited<ReturnType<typeof openFile>>; release: () => Promise<void> }> {
  execFileSync("mkfifo", [path]);
  const fh = await openFile(path, constants.O_RDWR);
  return {
    fh,
    release: async () => {
      try {
        await fh.write("x\n");
      } finally {
        await fh.close();
      }
    },
  };
}

const PREFIX = "bisellium serve: branch records ";
function spyStderr(): { lines: () => string[]; restore: () => void } {
  const original = process.stderr.write.bind(process.stderr) as (...a: unknown[]) => boolean;
  const seen: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (s.startsWith(PREFIX)) {
      seen.push(s);
      return true;
    }
    return original(chunk, ...rest);
  }) as typeof process.stderr.write;
  return {
    lines: () => [...seen],
    restore: () => {
      process.stderr.write = original as unknown as typeof process.stderr.write;
    },
  };
}
const DROP_REASONS = ["no-front-matter", "id-mismatch", "invalid-shape", "too-large", "unreadable", "parse-error"];

// ---------------------------------------------------------------------------
if (runs(3)) {
  test("W-129 behaviour 3: serve shows the branch's live record, not the trunk's stale copy", async () => {
    const repo = makeRepo("b3");
    const baseline = await serving(repo.studio, opera);
    const wt = addBranch(repo, "W-006", building, { keep: true });
    const trunkText = readFileSync(recPath(repo.root, "W-006"), "utf8");
    await serving(repo.studio, async (run) => {
      // (a) control, passes today
      assert.match(readFileSync(recPath(repo.root, "W-006"), "utf8"), /^state: greenlit$/m, "3(a): the trunk file on disk still reads greenlit");
      assert.equal(G(repo.root, ["rev-parse", "--abbrev-ref", "HEAD"]), "master", "3(a): the trunk checkout is on master");

      // (b) Genuine red
      assert.equal(await stateOf(run, "W-006"), "building", "3(b): straight after start W-006 reads the branch's building");

      writeFileSync(recPath(wt, "W-006"), fmSet(readFileSync(recPath(wt, "W-006"), "utf8"), "state", "verifying"));
      await poll(run);

      // (c)
      assert.equal(await stateOf(run, "W-006"), "verifying", "3(c): the uncommitted worktree edit shows after a poll");

      // (d)
      const tipBody = bodyOf(G(repo.root, ["show", "opus/W-006:studio/opera/W-006.md"]));
      const opus = (await get(run, "/api/opus/W-006")).body;
      assert.equal(opus.frontMatter.state, "verifying", "3(d): /api/opus frontMatter.state is verifying");
      assert.equal(opus.body.trim(), tipBody.trim(), "3(d): /api/opus body is the committed tip's body");
      assert.equal((await entry(run, "W-006")).body, tipBody, "3(d): /api/opera body is the committed tip's body");
      assert.notEqual(tipBody, bodyOf(trunkText), "3(d): and it is not the trunk's body");

      // (e)
      const events = (await get(run, "/api/events?item=W-006")).body as any[];
      assert.ok(
        events.some(
          (e) => e.name === "workflow.state_changed" && e.attrs["workflow.state.from"] === "building" && e.attrs["workflow.state.to"] === "verifying",
        ),
        "3(e): the poll appended a state_changed building -> verifying",
      );

      // (f)
      const now = await opera(run);
      for (const id of ["W-002", "W-007"]) {
        assert.deepEqual(now.find((o) => o.id === id), baseline.find((o) => o.id === id), `3(f): ${id} is exactly its trunk value`);
      }
    });
  });
}

if (runs(4)) {
  test("W-129 behaviour 4: a branch with no worktree is read from its committed tip, by object name", async () => {
    const repo = makeRepo("b4");
    addBranch(repo, "W-006", building);
    const shim = useShim();
    try {
      await serving(repo.studio, async (run) => {
        // (a) Genuine red
        assert.equal(await stateOf(run, "W-006"), "building", "4(a): straight after start W-006 reads the branch's building");

        // (b)
        const second = join(repo.root, ".worktrees", "second");
        G(repo.root, ["worktree", "add", "-q", second, "opus/W-006"]);
        commitIn(second, "W-006", (t) => fmSet(t, "state", "review"));
        G(repo.root, ["worktree", "remove", "--force", second]);
        await poll(run);
        assert.equal(await stateOf(run, "W-006"), "review", "4(b): a later commit on the branch shows after a poll");

        // (c)
        const cs = calls(shim);
        const cats = cs.filter((c) => c.argv[0] === "cat-file");
        assert.ok(cats.length >= 1, "4(c): the poll read the branch with cat-file");
        for (const c of cats) {
          assert.equal(c.argv[1], "blob", "4(c): every cat-file reads a blob");
          assert.match(c.argv[2] ?? "", /^[0-9a-f]{40}:studio\/opera\/W-006\.md$/, "4(c): by object name and studio-relative path");
        }
        for (const c of cs) {
          assert.ok(!["show", "checkout", "switch", "fetch", "reset"].includes(c.argv[0] ?? ""), `4(c): no ${c.argv[0]} call`);
          assert.ok(!(c.argv[0] === "worktree" && c.argv[1] === "add"), "4(c): serve never adds a worktree");
        }

        // (d)
        G(repo.root, ["branch", "-D", "opus/W-006"]);
        await poll(run);
        assert.equal(await stateOf(run, "W-006"), "greenlit", "4(d): deleting the branch returns W-006 to the trunk's greenlit");
      });
    } finally {
      shim.stop();
    }
  });
}

if (runs(5)) {
  test("W-129 behaviour 5: a record that is unreadable, hostile or malformed is dropped on its own, and the board keeps working", async () => {
    // (a) control, Genuine red
    const repo = twoBranchRepo("b5");
    const wt6 = wtPath(repo, "W-006");
    const goodText = readFileSync(recPath(wt6, "W-006"), "utf8");
    await serving(repo.studio, async (run) => {
      assert.equal(await stateOf(run, "W-006"), "building", "5(a): W-006 overlay shows building");
      assert.equal(await stateOf(run, "W-002"), "verifying", "5(a): W-002 overlay shows verifying");
      const ids = (await opera(run)).map((o) => o.id);

      // (b) committed variants: no front matter, a mismatched id, over 64 KiB
      const variants: [string, (t: string) => string][] = [
        ["no front matter", () => "just text, no front matter at all\n"],
        ["id W-999", (t) => fmSet(t, "id", "W-999")],
        ["over 64 KiB", (t) => withBody(t, "x".repeat(70 * 1024))],
      ];
      for (const [label, edit] of variants) {
        commitIn(wt6, "W-006", () => edit(goodText));
        await poll(run);
        assert.equal(await stateOf(run, "W-006"), "greenlit", `5(b): committed W-006 with ${label} reads the trunk's greenlit`);
        assert.equal(await stateOf(run, "W-002"), "verifying", `5(b): W-002 still reads verifying after ${label}`);
      }
      commitIn(wt6, "W-006", () => goodText);
      await poll(run);
      assert.equal(await stateOf(run, "W-006"), "building", "5(b): a good committed record is read again");

      // (c) a branch with no trunk record cannot create one
      const junk = join(repo.root, ".worktrees", "W-777");
      G(repo.root, ["worktree", "add", "-q", "-b", "opus/W-777", junk, "master"]);
      writeFileSync(recPath(junk, "W-777"), candidateRecord("W-777").replace("greenlit", "building"));
      G(junk, ["add", "-A"]);
      G(junk, ["commit", "-q", "-m", "W-777"]);
      await poll(run);
      assert.deepEqual((await opera(run)).map((o) => o.id), ids, "5(c): a branch with no trunk record adds no opus");

      // (d) the worktree directory removed while the branch remains
      rmSync(wt6, { recursive: true, force: true });
      await poll(run);
      assert.equal((await get(run, "/api/opera")).status, 200, "5(d): /api/opera answers 200 with the worktree gone");
      assert.equal(await stateOf(run, "W-006"), "building", "5(d): W-006 is served from the committed tip");
    });

    // (e) the worktree file replaced by a symlink to a file outside it
    {
      const r = twoBranchRepo("b5e");
      const outside = join(scratch("b5e-out"), "outside.md");
      writeFileSync(outside, fmSet(goodText, "state", "verifying"));
      const file = recPath(wtPath(r, "W-006"), "W-006");
      rmSync(file);
      symlinkSync(outside, file);
      await serving(r.studio, async (run) => {
        assert.equal(await stateOf(run, "W-006"), "building", "5(e): a symlinked worktree file is not read; the committed tip is served");
      });
    }

    // (f) the worktree file replaced by a FIFO
    {
      const r = twoBranchRepo("b5f");
      const file = recPath(wtPath(r, "W-006"), "W-006");
      rmSync(file);
      const held = await fifo(file);
      try {
        await serving(r.studio, async (run) => {
          await poll(run);
          assert.equal(await stateOf(run, "W-006"), "building", "5(f): a FIFO worktree file is refused; the committed tip is served");
          await poll(run);
          assert.equal(await stateOf(run, "W-006"), "building", "5(f): a second poll also settles");
        });
      } finally {
        await held.release();
      }
    }

    // (g) parseable but malformed records, live first, then committed
    {
      const r = twoBranchRepo("b5g");
      const wt = wtPath(r, "W-006");
      const file = recPath(wt, "W-006");
      const malformed: [string, (t: string) => string][] = [
        ["a null gate", (t) => fmSet(t, "probationes", "{ review: ~ }")],
        ["state an object", (t) => fmSet(t, "state", "{ a: 1 }")],
        ["state bogus", (t) => fmSet(t, "state", "bogus")],
        ["tokens a string", (t) => fmSet(t, "tokens", '"x"')],
        ["probationes a list", (t) => fmSet(t, "probationes", "[ a, b ]")],
        ["a bogus gate status", (t) => fmSet(t, "probationes", "{ tests: { status: bogus } }")],
        ["an object sella", (t) => fmSet(t, "sella", "{ a: 1 }")],
        [
          "an object gate evidence and certifies",
          (t) => fmSet(t, "probationes", "{ tests: { status: passed, evidence: { a: 1 }, certifies: { b: 2 } } }"),
        ],
      ];
      await serving(r.studio, async (run) => {
        const alive = async (label: string): Promise<void> => {
          for (const path of ["/api/opera", "/api/opus/W-006", "/api/inbox", "/api/officina"]) {
            assert.equal((await get(run, path)).status, 200, `5(g): ${path} answers 200 with ${label}`);
          }
          assert.equal(await stateOf(run, "W-002"), "verifying", `5(g): W-002 is intact with ${label}`);
        };
        for (const [label, edit] of malformed) {
          writeFileSync(file, edit(goodText));
          await poll(run);
          assert.equal(await stateOf(run, "W-006"), "building", `5(g): live ${label}: the committed tip is served`);
          await alive(`live ${label}`);
          commitIn(wt, "W-006", edit);
          await poll(run);
          assert.equal(await stateOf(run, "W-006"), "greenlit", `5(g): committed ${label}: the trunk copy is served`);
          await alive(`committed ${label}`);
          commitIn(wt, "W-006", () => goodText);
        }
      });
    }

    // (h) a worktree whose .git does not prove it belongs to the branch
    {
      const r = twoBranchRepo("b5h");
      const wt = wtPath(r, "W-006");
      const gitFile = join(wt, ".git");
      const original = readFileSync(gitFile, "utf8");
      writeFileSync(recPath(wt, "W-006"), fmSet(goodText, "state", "verifying"));
      await serving(r.studio, async (run) => {
        writeFileSync(gitFile, `gitdir: ${join(scratch("b5h-out"), "elsewhere")}\n`);
        await poll(run);
        assert.equal(await stateOf(run, "W-006"), "building", "5(h): a .git pointing outside <common-dir>/worktrees/ is not trusted");
        writeFileSync(gitFile, `gitdir: ${adminOf(r, "W-002")}\n`);
        await poll(run);
        assert.equal(await stateOf(run, "W-006"), "building", "5(h): a .git pointing at another worktree's admin directory is not trusted");
        writeFileSync(gitFile, original);
        await poll(run);
        assert.equal(await stateOf(run, "W-006"), "verifying", "5(h): control: the genuine .git is trusted and the live state shows");
      });
    }

    // (i) the worktree's .git replaced by a FIFO, and by a 10 MB regular file
    {
      const r = twoBranchRepo("b5i");
      const wt = wtPath(r, "W-006");
      const gitFile = join(wt, ".git");
      const original = readFileSync(gitFile, "utf8");
      writeFileSync(recPath(wt, "W-006"), fmSet(goodText, "state", "verifying"));
      await serving(r.studio, async (run) => {
        rmSync(gitFile);
        const held = await fifo(gitFile);
        try {
          await poll(run);
          assert.equal(await stateOf(run, "W-006"), "building", "5(i): a FIFO .git is refused; the committed tip is served");
          assert.ok((await officina(run)).branchRecords?.liveRejected >= 1, "5(i): the FIFO .git counts as a rejected live read");
        } finally {
          await held.release();
        }
        rmSync(gitFile);
        writeFileSync(gitFile, Buffer.alloc(10 * 1024 * 1024, 0x61));
        await poll(run);
        assert.equal(await stateOf(run, "W-006"), "building", "5(i): a 10 MB .git is refused; the committed tip is served");
        assert.ok((await officina(run)).branchRecords?.liveRejected >= 1, "5(i): the 10 MB .git counts as a rejected live read");
        writeFileSync(gitFile, original);
      });
    }

    // (j) the shared opener, called directly
    {
      const spec = "../src/branchRecords.js";
      interface OpenerModule {
        readBoundedRegular(
          path: string,
          root: string,
          maxBytes: number,
          opts?: { afterLstat?: () => void | Promise<void>; timeoutMs?: number },
        ): Promise<{ text: string } | { refused: string }>;
      }
      const mod = (await import(spec)) as OpenerModule;
      const dir = scratch("b5j");
      const file = join(dir, "record.md");

      writeFileSync(file, "hello");
      assert.deepEqual(await mod.readBoundedRegular(file, dir, 1024), { text: "hello" }, "5(j): a regular file under the root is read");
      writeFileSync(file, "x".repeat(2000));
      assert.deepEqual(await mod.readBoundedRegular(file, dir, 1024), { refused: "too-large" }, "5(j): more than maxBytes is refused");

      writeFileSync(file, "a regular file");
      try {
        const result = await mod.readBoundedRegular(file, dir, 1024, {
          timeoutMs: 2000,
          afterLstat: () => {
            rmSync(file);
            execFileSync("mkfifo", [file]);
          },
        });
        assert.deepEqual(result, { refused: "not-regular" }, "5(j): a regular file swapped for a FIFO after the lstat is refused, not parked");
      } finally {
        const release = await openFile(file, constants.O_RDWR);
        await release.close();
      }

      rmSync(file);
      writeFileSync(file, "the original");
      const swapped = await mod.readBoundedRegular(file, dir, 1024, {
        timeoutMs: 2000,
        afterLstat: () => {
          writeFileSync(`${file}.new`, "a different regular file");
          renameSync(`${file}.new`, file);
        },
      });
      assert.deepEqual(swapped, { refused: "changed" }, "5(j): a regular file swapped for another after the lstat is refused as changed");

      const store = readFileSync(join(HERE, "..", "src", "store.ts"), "utf8");
      assert.ok(!/\bafterLstat\b/.test(store), "5(j): store.ts never sets the afterLstat seam");
      assert.ok(!/\btimeoutMs\b/.test(store), "5(j): store.ts never sets the timeoutMs seam");
    }
  });
}

if (runs(6)) {
  test("W-129 behaviour 6: a live, uncommitted read can change only the state, the handoff and the heartbeat", async () => {
    const repo = makeRepo("b6");
    const committed = (t: string): string =>
      fmSet(
        fmSet(
          fmSet(
            fmSet(building(t), "tokens", "100"),
            "title",
            "T",
          ),
          "probationes",
          "{ tests: { status: pending }, review: { status: pending }, patron: { status: passed } }",
        ),
        "kind",
        "feature",
      );
    const wt = addBranch(repo, "W-006", committed, { keep: true });
    const file = recPath(wt, "W-006");
    const good = readFileSync(file, "utf8");
    const trunkBefore = readFileSync(recPath(repo.root, "W-006"), "utf8");
    const live = (edit: (t: string) => string): void => writeFileSync(file, edit(good));
    await serving(repo.studio, async (run) => {
      const base = await entry(run, "W-006");
      const burn = (await get(run, "/api/aerarium")).body;
      const inboxIds = ((await get(run, "/api/inbox")).body.opera as any[]).map((o) => o.id).sort();

      // (a) control, passes today
      live((t) => fmSet(t, "state", "done"));
      assert.equal(readFileSync(recPath(repo.root, "W-006"), "utf8"), trunkBefore, "6(a): the live edit leaves the trunk file on disk unchanged");

      // (b) Genuine red
      await poll(run);
      assert.equal((await entry(run, "W-006"))?.state, "building", "6(b): a live state done shows the committed building");
      const o1 = await officina(run);
      assert.ok(o1.branchRecords, "6(b): /api/officina carries branchRecords");
      assert.equal(o1.branchRecords.liveRejected, 1, "6(b): the refused live read is counted");

      // (c)
      live((t) => fmSet(t, "state", "halted"));
      await poll(run);
      assert.equal(await stateOf(run, "W-006"), "building", "6(c): a live state halted falls back to the committed building");
      live((t) => fmSet(t, "state", "review"));
      await poll(run);
      assert.equal(await stateOf(run, "W-006"), "review", "6(c): a live state review shows");
      live((t) => fmSet(t, "state", "verifying"));
      await poll(run);
      assert.equal(await stateOf(run, "W-006"), "verifying", "6(c): a live state verifying shows");

      // (d)
      live((t) => fmSet(t, "tokens", "1000000000000"));
      await poll(run);
      assert.equal((await entry(run, "W-006")).tokens, 100, "6(d): live tokens are not taken; the committed 100 shows");
      assert.deepEqual((await get(run, "/api/aerarium")).body, burn, "6(d): the aerarium burn is unchanged");

      // (e)
      live((t) => withBody(fmSet(fmSet(fmSet(t, "title", "HIJACKED"), "collegium", "art"), "kind", "ui"), "A live body nobody committed."));
      await poll(run);
      const e = await entry(run, "W-006");
      assert.equal(e.title, base.title, "6(e): the committed title shows");
      assert.equal(e.collegium, base.collegium, "6(e): the committed collegium shows");
      assert.equal(e.kind, base.kind, "6(e): the committed kind shows");
      assert.equal(e.body, base.body, "6(e): the committed body shows");

      // (f) a forged live gate neither shows green nor adds a Needs-you card
      live((t) => fmSet(t, "probationes", "{ tests: { status: pending }, review: { status: pending }, patron: { status: pending } }"));
      await poll(run);
      assert.deepEqual(
        ((await get(run, "/api/inbox")).body.opera as any[]).map((o) => o.id).sort(),
        inboxIds,
        "6(f): a forged live human gate adds no Needs-you card",
      );
      live((t) => fmSet(t, "probationes", "{ tests: { status: passed }, review: { status: passed }, patron: { status: passed } }"));
      await poll(run);
      assert.deepEqual((await entry(run, "W-006")).probationes, base.probationes, "6(f): forged live automated and review gates are not reflected");
      // ... and a forged live pass does not hide a card the committed tip shows
      commitIn(wt, "W-006", (t) => fmSet(t, "probationes", "{ tests: { status: pending }, review: { status: pending }, patron: { status: pending } }"));
      const pendingCommitted = readFileSync(file, "utf8");
      writeFileSync(file, fmSet(pendingCommitted, "probationes", "{ tests: { status: pending }, review: { status: pending }, patron: { status: passed } }"));
      await poll(run);
      assert.ok(
        ((await get(run, "/api/inbox")).body.opera as any[]).some((o) => o.id === "W-006"),
        "6(f): a forged live pass does not hide the committed Needs-you card",
      );

      // (g)
      writeFileSync(file, fmSet(pendingCommitted, "traditio", "{ sella: builder, stage: building, next: live handoff text, blocked_on: none, at: 2026-09-18T10:00:00Z }"));
      await poll(run);
      assert.equal((await get(run, "/api/opus/W-006")).body.frontMatter.traditio.next, "live handoff text", "6(g): a live traditio edit is reflected");
    });
  });
}

if (runs(7)) {
  test("W-129 behaviour 7: no git on any request; a poll makes a bounded number of read-only calls", async () => {
    const repo = makeRepo("b7");
    addBranch(repo, "W-006", building, { keep: true });
    addBranch(repo, "W-002", (t) => fmSet(t, "state", "verifying"));
    const shim = useShim();
    Object.assign(process.env, {
      GIT_DIR: join(repo.root, "nonexistent.git"),
      GIT_WORK_TREE: join(repo.root, "nonexistent-tree"),
      GIT_INDEX_FILE: join(repo.root, "nonexistent-index"),
      GIT_COMMON_DIR: join(repo.root, "nonexistent-common"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "hostile",
    });
    try {
      await serving(repo.studio, async (run) => {
        // (a) passes today
        const before = calls(shim).length;
        for (let i = 0; i < 10; i++) {
          const path = ["/api/opera", "/api/opus/W-006", "/api/inbox", "/api/officina"][i % 4]!;
          assert.equal((await get(run, path)).status, 200, `7(a): ${path} answers 200`);
        }
        assert.equal(calls(shim).length, before, "7(a): ten GETs add no git call");

        // (b) Genuine red
        const mark = calls(shim).length;
        await poll(run);
        const added = calls(shim).slice(mark);
        assert.equal(verbCount(added, "for-each-ref"), 1, "7(b): one poll makes exactly one for-each-ref");
        assert.equal(added.filter((c) => c.argv[0] === "worktree" && c.argv[1] === "list").length, 1, "7(b): and exactly one worktree list");
        assert.equal(verbCount(added, "rev-parse"), 0, "7(b): and no rev-parse");
        assert.equal(verbCount(added, "cat-file"), 2, "7(b): and one cat-file per branch");

        // (c)
        const all = calls(shim);
        for (const c of all) {
          assert.ok(["rev-parse", "for-each-ref", "worktree", "cat-file"].includes(c.argv[0] ?? ""), `7(c): ${c.argv[0]} is in the read-only set`);
          for (const a of c.argv) assert.ok(!["--force", "-f", "--update-head-ok"].includes(a), `7(c): no ${a} argument`);
          assert.equal(c.locks, "0", "7(c): GIT_OPTIONAL_LOCKS is 0 on every call");
          assert.equal(c.env, "", `7(c): no GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR/GIT_CONFIG_* passed through (saw ${c.env})`);
        }
      });
    } finally {
      for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) {
        delete process.env[k];
      }
      shim.stop();
    }

    // (d) a studio that is not inside a git repo
    const plain = plainStudio("b7d");
    const shim2 = useShim();
    try {
      await serving(plain, async (run) => {
        await poll(run);
        await poll(run);
        await poll(run);
        const cs = calls(shim2);
        assert.equal(verbCount(cs, "rev-parse"), 1, "7(d): exactly one rev-parse over start and three polls");
        assert.equal(cs.length, 1, "7(d): and no other git call");
        assert.equal(await stateOf(run, "W-006"), "greenlit", "7(d): trunk values are shown");
      });
    } finally {
      shim2.stop();
    }
  });
}

if (runs(8)) {
  test("W-129 behaviour 8: a hung or slow git never blocks serve", async () => {
    const repo = makeRepo("b8");
    addBranch(repo, "W-006", building, { keep: true });
    const shim = useShim();
    const ann = await fifo(join(shim.ctl, "announce.fifo"));
    const blk = await fifo(join(shim.ctl, "block.fifo"));
    let announced: Promise<unknown> | undefined;
    try {
      await serving(repo.studio, async (run) => {
        const startupGit = verbCount(calls(shim), "for-each-ref");
        writeFileSync(join(shim.ctl, "hold-for-each-ref"), `${join(shim.ctl, "announce.fifo")}\n${join(shim.ctl, "block.fifo")}\n`);
        let settled = false;
        const pending = poll(run).then((r) => {
          settled = true;
          return r;
        });
        announced = ann.fh.read(Buffer.alloc(8), 0, 8, null);

        // (a) Genuine red: the announcement must win the race against the poll's own settlement
        const first = await Promise.race([announced.then(() => "announced"), pending.then(() => "poll-settled")]);
        assert.equal(first, "announced", "8(a): the shim announced itself while the poll was still pending");
        const during = await get(run, "/api/officina");
        assert.equal(during.status, 200, "8(a): /api/officina answers 200 during the hung poll");
        assert.equal(settled, false, "8(a): the poll is provably still pending when /api/officina answered");

        // (c) a second concurrent poll starts no git
        const second = await poll(run);
        assert.equal(second.ingested, 0, "8(c): a second concurrent poll ingests nothing");
        assert.equal(verbCount(calls(shim), "for-each-ref"), startupGit + 1, "8(c): and starts no second for-each-ref");

        rmSync(join(shim.ctl, "hold-for-each-ref"));
        await blk.fh.write("go\n");
        const done = await pending;
        assert.equal(done.ok, true, "8(a): releasing the shim lets the poll settle ok");
      });
    } finally {
      // Whatever the outcome: a byte through each of the test's own handles, then close both.
      const readerDone = Promise.allSettled([announced]);
      await ann.release().catch(() => undefined);
      await blk.release().catch(() => undefined);
      await readerDone;
      shim.stop();
    }

    // (b) a git that never answers is killed at branchGitTimeoutMs
    const shim2 = useShim();
    const pidFile = join(shim2.ctl, "pid");
    try {
      await serving(
        repo.studio,
        async (run) => {
          writeFileSync(join(shim2.ctl, "hang-for-each-ref"), pidFile);
          const r = await poll(run);
          assert.equal(r.ok, true, "8(b): the poll settles ok with a hung git");
          assert.equal((await get(run, "/api/opera")).status, 200, "8(b): /api/opera answers 200");
          const pid = Number(readFileSync(pidFile, "utf8").trim());
          assert.ok(Number.isInteger(pid) && pid > 1, "8(b): the shim recorded its pid");
          let gone = false;
          try {
            process.kill(pid, 0);
          } catch (e) {
            gone = (e as NodeJS.ErrnoException).code === "ESRCH";
          }
          assert.ok(gone, "8(b): the hung git process no longer exists");
        },
        { branchGitTimeoutMs: 200 },
      );
    } finally {
      shim2.stop();
    }
  });
}

if (runs(9)) {
  test("W-129 behaviour 9: degraded branch records are reported, not silently turned into the trunk's stale copy", async () => {
    // (a) healthy, Genuine red
    const repo = makeRepo("b9");
    addBranch(repo, "W-006", building, { keep: true });
    await serving(repo.studio, async (run) => {
      const body = await officina(run);
      assert.ok(body.branchRecords, "9(a): /api/officina carries branchRecords");
      assert.equal(body.branchRecords.status, "ok", "9(a): a healthy overlay is ok");
      assert.deepEqual(body.branchRecords.dropped, [], "9(a): nothing is dropped");
    });

    // (b) a studio outside any git repo
    {
      const spy = spyStderr();
      try {
        await serving(plainStudio("b9b"), async (run) => {
          await poll(run);
          assert.equal((await officina(run)).branchRecords?.status, "off", "9(b): a studio outside git is off");
        });
        assert.deepEqual(spy.lines(), [], "9(b): and writes no stderr line");
      } finally {
        spy.restore();
      }
    }

    // (c) one malformed committed record, with an ESC byte and a newline before the YAML error
    {
      const r = makeRepo("b9c");
      addBranch(r, "W-006", (t) =>
        t.replace("state: greenlit", "state: building\nsecret: top\u001b[31msecret-marker\nbroken: [a, b"),
      );
      const spy = spyStderr();
      try {
        await serving(r.studio, async (run) => {
          const res = await get(run, "/api/officina");
          for (let i = 0; i < 3; i++) await poll(run);
          const again = await get(run, "/api/officina");
          assert.ok(res.body.branchRecords, "9(c): /api/officina carries branchRecords");
          for (const text of [res.text, again.text]) {
            assert.ok(!text.includes("\u001b") && !text.includes("\\u001b"), "9(c): the response carries no ESC byte");
            assert.ok(!text.includes("secret-marker"), "9(c): the response carries none of the record's text");
          }
          assert.equal(again.body.branchRecords.status, "partial", "9(c): one malformed record makes the status partial");
          const dropped = again.body.branchRecords.dropped as { id: string; reason: string }[];
          assert.deepEqual(dropped, [{ id: "W-006", reason: "parse-error" }], "9(c): W-006 is dropped with the parse-error code");
          assert.ok(DROP_REASONS.includes(dropped[0]!.reason), "9(c): the reason is one of the six codes");
          const lines = spy.lines();
          assert.equal(lines.length, 1, "9(c): exactly one stderr line across start and three further polls");
          const line = lines[0]!;
          assert.equal(line.indexOf("\n"), line.length - 1, "9(c): the line has no embedded newline");
          assert.doesNotThrow(() => JSON.parse(line.slice(PREFIX.length)), "9(c): the line is the prefix then JSON");
          assert.ok(!line.includes("\u001b") && !line.includes("secret-marker"), "9(c): the line carries no ESC and none of the record's text");
        });
      } finally {
        spy.restore();
      }
    }

    // (d) thirty-three candidates, thirty junk branches
    {
      const ids = Array.from({ length: 33 }, (_, i) => `C-${String(i + 1).padStart(3, "0")}`);
      const r = makeRepo("b9d", (studio) => {
        for (const id of ids) writeFileSync(join(studio, "opera", `${id}.md`), candidateRecord(id));
      });
      ids.forEach((id, i) =>
        addBranch(r, id, (t) => fmSet(t, "state", "building"), { keep: i === 0, at: `2026-09-01T10:${String(i).padStart(2, "0")}:00Z` }),
      );
      for (let n = 1; n <= 30; n++) G(r.root, ["branch", `opus/junk-${n}`, "master"]);
      const shim = useShim();
      try {
        await serving(r.studio, async (run) => {
          const mark = calls(shim).length;
          await poll(run);
          const cats = calls(shim).slice(mark).filter((c) => c.argv[0] === "cat-file");
          assert.equal(cats.length, 32, "9(d): exactly 32 cat-file calls in one poll");
          const read = new Set(cats.map((c) => /opera\/(C-\d+)\.md$/.exec(c.argv[2] ?? "")?.[1]));
          assert.ok(read.has("C-001"), "9(d): the worktree-backed oldest branch is read");
          assert.ok(!read.has("C-002"), "9(d): the omitted one is the oldest-committed branch with no worktree");
          const branchRecords = (await officina(run)).branchRecords;
          assert.ok(branchRecords, "9(d): /api/officina carries branchRecords");
          assert.equal(branchRecords.status, "partial", "9(d): a capped overlay is partial");
          assert.equal(branchRecords.capped, 1, "9(d): one candidate is capped");
        });
      } finally {
        shim.stop();
      }
    }

    // (e), (f) for-each-ref failing
    {
      const r = makeRepo("b9e");
      addBranch(r, "W-006", building, { keep: true });
      const shim = useShim();
      try {
        await serving(r.studio, async (run) => {
          writeFileSync(join(shim.ctl, "fail-for-each-ref"), "1");
          await poll(run);
          const stale = (await officina(run)).branchRecords;
          assert.equal(await stateOf(run, "W-006"), "building", "9(e): the previous overlay is kept while for-each-ref fails");
          assert.ok(stale, "9(e): /api/officina carries branchRecords");
          assert.equal(stale.status, "stale", "9(e): the status is stale");
          assert.equal(stale.failures, 1, "9(e): one failure is counted");
          assert.equal(stale.reason, "git-error", "9(e): the reason is git-error");
          rmSync(join(shim.ctl, "fail-for-each-ref"));
          await poll(run);
          assert.equal((await officina(run)).branchRecords.status, "ok", "9(e): the next healthy poll returns ok");

          // (f) six consecutive failures clear the overlay
          writeFileSync(join(shim.ctl, "fail-for-each-ref"), "1");
          for (let n = 1; n <= 5; n++) {
            await poll(run);
            assert.equal((await officina(run)).branchRecords.failures, n, `9(f): failure ${n} is counted`);
            assert.equal(await stateOf(run, "W-006"), "building", `9(f): the overlay is kept after failure ${n}`);
          }
          await poll(run);
          assert.equal((await officina(run)).branchRecords.status, "unavailable", "9(f): the sixth failure makes the status unavailable");
          assert.equal(await stateOf(run, "W-006"), "greenlit", "9(f): and clears the overlay to the trunk values");
        });
      } finally {
        shim.stop();
      }
    }

    // (g) rev-parse failing with an exit other than 128 is not for life
    {
      const r = makeRepo("b9g");
      addBranch(r, "W-006", building, { keep: true });
      const shim = useShim();
      try {
        writeFileSync(join(shim.ctl, "fail-rev-parse"), "2");
        await serving(r.studio, async (run) => {
          const down = (await officina(run)).branchRecords;
          assert.ok(down, "9(g): /api/officina carries branchRecords");
          assert.equal(down.status, "unavailable", "9(g): a rev-parse failure is unavailable, not off");
          assert.equal(down.reason, "git-error", "9(g): the reason is git-error");
          rmSync(join(shim.ctl, "fail-rev-parse"));
          await poll(run);
          assert.equal((await officina(run)).branchRecords.status, "ok", "9(g): the next healthy poll recovers");
          assert.equal(await stateOf(run, "W-006"), "building", "9(g): and the overlay is back");
        });
      } finally {
        shim.stop();
      }
    }

    // (h) only branchRecords is new in /api/officina
    {
      const r = makeRepo("b9h");
      addBranch(r, "W-006", building, { keep: true });
      const withGit = await serving(r.studio, officina);
      const without = await serving(plainStudio("b9h"), officina);
      const { branchRecords: gitStatus, ...gitRest } = withGit;
      const { branchRecords: plainStatus, ...plainRest } = without;
      assert.ok(gitStatus && plainStatus, "9(h): both responses carry branchRecords");
      assert.deepEqual(gitRest, plainRest, "9(h): every other key of /api/officina is the pre-change response");
      assert.deepEqual(
        Object.keys(withGit).sort(),
        ["branchRecords", "collegia", "lifecycle", "patron", "probationes", "munera", "sellae", "studio", "tiers", "wip_limit"].sort(),
        "9(h): the key set is the old one plus branchRecords",
      );
    }
  });
}
