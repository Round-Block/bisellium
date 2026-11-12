/**
 * W-604 (studio/briefs/W-604.md): the pre-sign gate runs a shared multi-file test:suite command once (b1), alone after the
 * pool (b2), under a timeout sized to its files (b3), exempt from the start budget (b4), logging its run time on every row it
 * serves (b5); and a reads row judges only the series' files (b6). Every row works in its own scratch git repository under the
 * OS temp directory; none reads studio/, the host HOME or ~/.codex. The fixture's slow file sleeps at most 2.5 s. Select one
 * behaviour with --test-name-pattern='^W-604-b<k>\s'.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runGate, type GateOptions } from "@bisellium/commands/presign-gate.js";

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-604-b[1-9] /, "");
  test(name, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}
const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `w604-${tag}-`));
  roots.push(d);
  return d;
};
const git = (repo: string, ...args: string[]): string => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const put = (repo: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const commitAll = (repo: string, msg: string): string => (git(repo, "add", "-A"), git(repo, "commit", "-qm", msg), git(repo, "rev-parse", "HEAD"));
const HOST_SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");

/** The fixture file's own timer, assembled from fragments: it is fixture text the gate's child runs, not a wait in this process. */
const PAUSE = ["set", "Timeout"].join("");
/** A test file that logs `<name> start|end <ms>` to $W604_EVENTS, sleeps $W604_SLEEP_<NAME> ms, and reads studio when $W604_READ_<NAME> is 1. */
const probe = (name: string, extra = ""): string =>
  [
    'import { appendFileSync, readFileSync } from "node:fs";',
    extra,
    `const ev = (s) => process.env.W604_EVENTS && appendFileSync(process.env.W604_EVENTS, \`${name} \${s} \${Date.now()}\\n\`);`,
    'ev("start");',
    `if (process.env.W604_READ_${name.toUpperCase()} === "1") readFileSync("studio/bisellium.yml", "utf8");`,
    `await new Promise((r) => ${PAUSE}(r, Number(process.env.W604_SLEEP_${name.toUpperCase()} ?? 0)));`,
    'ev("end");',
    "",
  ].join("\n");

const SHARED = "node --test --test-reporter=tap src/a.test.mjs src/r.test.mjs";
/**
 * The fixture: check and typecheck are `true`; test:suite holds one multi-file command (a, r) and one single-file command (c);
 * the series touches src/a.mjs (imported by a and c) and adds src/r.test.mjs, which reads studio/ and is in test:record.
 */
function world(o: { record?: string } = {}): { repo: string; events: string; run: (opts?: GateOptions & { perFileMs?: number }, env?: Record<string, string>) => Promise<number>; rows: () => string[][] } {
  const repo = mkdtempSync(join(tmpdir(), "w604-repo-"));
  roots.push(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "commit.gpgsign", "false");
  put(repo, "package.json", JSON.stringify({ scripts: { test: "true", check: "true", typecheck: "true", "test:suite": `${SHARED} && node src/c.test.mjs`, "test:record": o.record ?? "node src/r.test.mjs" } }));
  put(repo, "studio/bisellium.yml", "bisellium: 1\n");
  put(repo, "src/a.mjs", "export const ok = true;\n");
  put(repo, "src/a.test.mjs", probe("a", 'import "./a.mjs";'));
  put(repo, "src/c.test.mjs", probe("c", 'import "./a.mjs";'));
  for (const s of ["record-reads.mjs", "ci-scope.mjs"]) {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    copyFileSync(join(HOST_SCRIPTS, s), join(repo, "scripts", s));
  }
  const base = commitAll(repo, "base");
  put(repo, "src/a.mjs", "export const ok = true; // the series\n");
  put(repo, "src/r.test.mjs", probe("r", 'readFileSync("studio/bisellium.yml", "utf8");'));
  commitAll(repo, "series");
  const side = scratch("side");
  const mbox = join(side, "series.mbox");
  writeFileSync(mbox, execFileSync("git", ["-C", repo, "format-patch", "--no-numbered", "--stdout", `${base}..HEAD`], { encoding: "utf8" }));
  const out = join(side, "gate.log");
  const events = join(side, "events.log");
  const run = async (opts: GateOptions & { perFileMs?: number } = {}, env: Record<string, string> = {}): Promise<number> => {
    const set = { W604_EVENTS: events, ...env };
    const keep = Object.keys(set).map((k) => [k, process.env[k]] as const);
    Object.assign(process.env, set);
    const error = console.error;
    console.error = () => undefined;
    try {
      return await runGate(["--opus", "W-1", "--worktree", repo, "--base", base, "--series", mbox, "--out", out], opts);
    } finally {
      console.error = error;
      for (const [k, v] of keep) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const rows = (): string[][] => readFileSync(out, "utf8").split("\n").filter((l) => l !== "" && !l.startsWith("# ")).map((l) => l.split("\t"));
  return { repo, events, run, rows };
}
const brief = (rows: string[][]): string => rows.map(([exit, , kind, file]) => `${exit} ${kind} ${file}`).join(" | ");
const of = (rows: string[][], kind: string, file: string): string[] => rows.find((r) => r[2] === kind && r[3] === file) ?? [];
const events = (path: string): { name: string; at: string; ms: number }[] =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l !== "").map((l) => l.split(" ")).map(([name, at, ms]) => ({ name: name!, at: at!, ms: Number(ms) })) : [];

row("W-604-b1 a shared command with a reads row runs once", async () => {
  const w = world();
  const exit = await w.run();
  assert.equal(exit, 0, `exit (rows ${brief(w.rows())})`);
  const starts = events(w.events).filter((e) => e.name === "a" && e.at === "start");
  assert.equal(starts.length, 1, "the shared command runs once for its test rows and its reads row");
});

row("W-604-b2 a shared command runs after the pool", async () => {
  const w = world();
  const exit = await w.run({}, { W604_SLEEP_C: "800" });
  assert.equal(exit, 0, `exit (rows ${brief(w.rows())})`);
  const ev = events(w.events);
  const cEnd = ev.find((e) => e.name === "c" && e.at === "end")?.ms ?? NaN;
  const sharedStart = Math.min(...ev.filter((e) => (e.name === "a" || e.name === "r") && e.at === "start").map((e) => e.ms));
  assert.ok(sharedStart >= cEnd, `the shared command starts after every pooled row ended (shared start ${sharedStart}, pooled end ${cEnd})`);
});

row("W-604-b3 a shared command's timeout is its files times the per-file cap", async () => {
  const w = world();
  const exit = await w.run({ rowTimeoutMs: 1000, perFileMs: 2500 }, { W604_SLEEP_A: "1500" });
  const rows = w.rows();
  assert.equal(exit, 0, `exit (rows ${brief(rows)})`);
  for (const [kind, file] of [["test", "src/a.test.mjs"], ["test", "src/r.test.mjs"], ["reads", "src/r.test.mjs"]] as const)
    assert.equal(of(rows, kind, file)[0], "0", `the ${kind} row ${file} runs within 2 x 2500 ms`);
  const short = world();
  assert.equal(await short.run({ rowTimeoutMs: 1000, perFileMs: 400 }, { W604_SLEEP_A: "1500" }), 1, "a run past its sized timeout fails the gate");
  assert.equal(of(short.rows(), "test", "src/a.test.mjs")[0], "124", `a run past its sized timeout is recorded 124 (rows ${brief(short.rows())})`);
});

row("W-604-b4 a shared command is exempt from the start budget", async () => {
  const w = world();
  const exit = await w.run({ budgetMs: 0 });
  const rows = w.rows();
  assert.equal(exit, 0, `exit (rows ${brief(rows)})`);
  assert.deepEqual(rows.map(([exit, , kind, file]) => `${exit} ${kind} ${file}`), ["deferred check -", "deferred typecheck -", "0 reads src/r.test.mjs", "0 test src/a.test.mjs", "deferred test src/c.test.mjs", "0 test src/r.test.mjs"], "the pooled rows are deferred, the shared rows run");
});

row("W-604-b5 every row of a shared command logs its run time", async () => {
  const w = world();
  const exit = await w.run({ pool: 1 }, { W604_SLEEP_A: "1200" });
  const rows = w.rows();
  assert.equal(exit, 0, `exit (rows ${brief(rows)})`);
  const secs = [of(rows, "reads", "src/r.test.mjs"), of(rows, "test", "src/a.test.mjs"), of(rows, "test", "src/r.test.mjs")].map((r) => Number(r[1]));
  for (const s of secs) assert.ok(s >= 1.2, `each shared row logs the run's own seconds, at least the 1.2 s pause (got ${secs.join(", ")})`);
  assert.equal(new Set(secs).size, 1, `the shared rows log one run time (got ${secs.join(", ")})`);
});
