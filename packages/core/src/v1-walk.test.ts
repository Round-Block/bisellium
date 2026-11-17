/**
 * packages/core/src/v1-walk.test.ts — W-576 (studio/briefs/W-576.md): the walk spec is one case per step, each marked by
 * its row of `WALK` (b1); k is read from the table (b2); the count reader prints k and names S5's failing half (b3). The
 * rows read the repository's own files and temp directories, never studio/. `WALK`, `isPending` and `walkScore` are read
 * through a dynamic namespace import after each row starts, so a missing export is an assertion, not a module load.
 * Select one behaviour with --test-name-pattern='^W-576-b<k>\s'.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SPEC = join(REPO, "apps", "web", "tests-serve", "v1-walk.spec.ts");
const READER = join(REPO, "scripts", "v1-walk-count.ts");
const STEPS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"];

interface Row {
  step: string;
  title: string;
  owners: readonly string[];
  pending: readonly string[];
  barOpus?: string;
}
interface Walk {
  WALK?: readonly Row[];
  isPending?: (step: string, walk?: readonly Row[]) => boolean;
  walkScore?: (walk?: readonly Row[], bar?: unknown) => { green: number; total: number; pending: { step: string; owners: string[] }[]; s5: { table: unknown; bar: unknown } };
}
const load = async (): Promise<Walk> => ((await import("./v1-walk.js").catch(() => ({}))) as Walk);
const copy = (walk: readonly Row[]): Row[] => walk.map((r) => ({ ...r, owners: [...r.owners], pending: [...r.pending] }));
/** `walk` with each named row's pending list emptied (S5 then carries a barOpus, as the table requires). */
const emptied = (walk: readonly Row[], steps: readonly string[]): Row[] =>
  copy(walk).map((r) => (steps.includes(r.step) ? { ...r, pending: [], ...(r.step === "S5" ? { barOpus: "W-900" } : {}) } : r));

/** The spec's cases, in order: the step of each `test("W-576 S<n>: …"` registration and the first statement of its body. */
function cases(spec: string): { step: string; first: string }[] {
  return [...spec.matchAll(/^test\("W-576 (S\d+): [^\n]*\n\s*([^\n]*)/gm)].map((m) => ({ step: m[1]!, first: m[2]!.trim() }));
}
/** The sub-steps of step `s` (its `async function s<n>(` body, to the next top-level `}`): each title's owner and body. */
function subSteps(spec: string, step: string): { owner: string; body: string }[] {
  const m = new RegExp(`^async function ${step.toLowerCase()}\\(.*?^}`, "ms").exec(spec);
  if (m === null) return [];
  const parts = m[0].split(/(?=await test\.step\(|^\s*test\.step\()/m).slice(1);
  return parts.map((p) => ({ owner: /test\.step\("(W-\d+): /.exec(p)?.[1] ?? "?", body: p }));
}

test("W-576-b1 the walk spec is one case per step, each marked by its row", async () => {
  assert.ok(existsSync(SPEC), "the walk spec registers S1..S9 once each, in order: the spec file is absent");
  const spec = readFileSync(SPEC, "utf8");
  const got = cases(spec).map((c) => c.step);
  assert.ok(JSON.stringify(got) === JSON.stringify(STEPS), `the walk spec registers S1..S9 once each, in order: ${got.join(", ")}`);
  const mod = await load();
  assert.ok(Array.isArray(mod.WALK) && typeof mod.isPending === "function", "WALK and isPending are exported");
  const walk = mod.WALK!;
  const isPending = mod.isPending!;
  for (const row of walk) {
    const subs = subSteps(spec, row.step).map((s) => s.owner);
    assert.ok(JSON.stringify(subs) === JSON.stringify(row.owners), `each case's sub-steps are its row's owners, in order: ${row.step} runs ${subs.join(", ") || "none"}`);
  }
  for (const c of cases(spec))
    assert.ok(c.first === `test.fail(marked("${c.step}"), mark("${c.step}"));`, `a case is marked pending exactly when its row lists a pending owner: ${c.step} opens ${c.first}`);
  for (const row of walk.filter((r) => r.step !== "S8")) {
    assert.ok(isPending(row.step, walk) === row.pending.length > 0, `a case is marked pending exactly when its row lists a pending owner: ${row.step}`);
    const flipped = emptied(walk, [row.step]);
    assert.ok(!isPending(row.step, flipped), `a case is marked pending exactly when its row lists a pending owner: ${row.step} emptied`);
  }
  const derived = ["S2", "S3", "S4", "S5", "S6", "S7"];
  assert.ok(!isPending("S8", emptied(walk, derived)), "S8 is pending while any of S2..S7 is: all emptied");
  for (const s of derived)
    assert.ok(isPending("S8", emptied(walk, derived.filter((d) => d !== s)).map((r) => (r.step === s ? { ...r, pending: [r.owners[0]!] } : r))), `S8 is pending while any of S2..S7 is: ${s} pending`);
  for (const row of walk)
    for (const sub of subSteps(spec, row.step)) {
      const pending = row.pending.includes(sub.owner);
      const pends = /(?<![\p{L}\p{M}\p{N}_$])pend\(/u.test(sub.body);
      const expects = /(?<![\p{L}\p{M}\p{N}_$])expect\(/u.test(sub.body);
      assert.ok(pending ? pends && !expects : expects && !pends, `a sub-step uses the pending timeout exactly while its owner is pending: ${row.step} ${sub.owner}`);
    }
  const opera = join(REPO, "examples", "sample-studio", "opera");
  const states = new Set(readdirSync(opera).map((f) => /^state: (\S+)$/m.exec(readFileSync(join(opera, f), "utf8"))?.[1]));
  assert.ok(["building", "review", "verifying"].every((s) => states.has(s)), "the S2 fixture holds active work");
});

test("W-576-b2 k is read from the table", async () => {
  const mod = await load();
  assert.ok(typeof mod.walkScore === "function", "walkScore is exported");
  const walk = mod.WALK!;
  const score = mod.walkScore!;
  const at = score(walk);
  assert.ok(at.green === 1 && at.total === 9, `the count at landing is 1 of 9: ${at.green} of ${at.total}`);
  assert.ok(at.s5.bar === "not run", "the count at landing is 1 of 9: S5's bar is not run");
  const s2to7 = ["S2", "S3", "S4", "S6", "S7"];
  const open = emptied(walk, s2to7);
  assert.ok(score(open).green === 1 + 5, `emptying S2..S7 turns S8 green: S5 still pending, ${score(open).green}`);
  const all = emptied(walk, [...s2to7, "S5"]);
  const green = (bar?: unknown): number => score(all, bar).green;
  assert.ok(green({ ok: true, opus: "W-900" }) === 8, `emptying S2..S7 turns S8 green: ${green({ ok: true, opus: "W-900" })}`);
  assert.ok(green({ ok: false, breached: "cycle minutes 72 > 60" }) === 7, "an empty S5 row counts only with a passing bar: a breach");
  assert.ok(green({ ok: false, notRun: "absent" }) === 7, "an empty S5 row counts only with a passing bar: not run");
  assert.ok(green() === 7, "an empty S5 row counts only with a passing bar: no bar");
  const bad: [string, (w: Row[]) => unknown][] = [
    ["a missing row", (w) => w.slice(0, 8)],
    ["an extra row", (w) => [...w, w[8]!]],
    ["rows out of order", (w) => [w[1]!, w[0]!, ...w.slice(2)]],
    ["a duplicate owner", (w) => w.map((r) => (r.step === "S2" ? { ...r, owners: ["W-503", "W-503"], pending: [] } : r))],
    ["a non-id owner", (w) => w.map((r) => (r.step === "S6" ? { ...r, owners: ["timeline"], pending: [] } : r))],
    ["a pending id not an owner", (w) => w.map((r) => (r.step === "S6" ? { ...r, pending: ["W-999"] } : r))],
    ["pending out of owner order", (w) => w.map((r) => (r.step === "S2" ? { ...r, pending: ["W-555", "W-503"] } : r))],
    ["S8 with owners", (w) => w.map((r) => (r.step === "S8" ? { ...r, owners: ["W-900"] } : r))],
    ["barOpus off S5", (w) => w.map((r) => (r.step === "S6" ? { ...r, barOpus: "W-900" } : r))],
    ["barOpus on a pending S5", (w) => w.map((r) => (r.step === "S5" ? { ...r, barOpus: "W-900" } : r))],
    ["an empty S5 with no barOpus", (w) => w.map((r) => (r.step === "S5" ? { ...r, pending: [] } : r))],
    ["an untitled row", (w) => w.map((r) => (r.step === "S3" ? { ...r, title: " " } : r))],
    ["an unknown field", (w) => w.map((r) => (r.step === "S3" ? { ...r, note: "x" } : r))],
  ];
  for (const [form, make] of bad) {
    let refused = "";
    try {
      score(make(copy(walk)) as Row[]);
    } catch (e) {
      refused = (e as Error).message;
    }
    assert.ok(/^v1 walk: refused: \S.*$/.test(refused), `a malformed table refuses: ${form}`);
  }
});

/** The reader, run as a child in `cwd` (a temp directory: never studio/), with the table at `table` when given. */
function reader(cwd: string, args: string[], table?: unknown): { status: number | null; out: string[] } {
  const env = { ...process.env };
  delete env["BISELLIUM_WALK_TABLE"];
  if (table !== undefined) {
    const path = join(cwd, "table.json");
    writeFileSync(path, typeof table === "string" ? table : JSON.stringify(table));
    env["BISELLIUM_WALK_TABLE"] = path;
  }
  const r = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), READER, ...args], { cwd, env, encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: (r.stdout ?? "").split("\n").filter((l) => l !== "") };
}
/** A stub bar script in `cwd` that prints a line and exits `code`; null removes it. */
function stub(cwd: string, code: number | null): void {
  const path = join(cwd, "scripts", "s5-bar.ts");
  if (code === null) rmSync(path, { force: true });
  else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `console.log("cycle minutes 72 > 60");\nprocess.exit(${code});\n`);
  }
}

test("W-576-b3 the reader prints k and names S5's failing half", async () => {
  assert.ok(existsSync(READER), "the reader prints the count line: scripts/v1-walk-count.ts is absent");
  const mod = await load();
  const cwd = mkdtempSync(join(tmpdir(), "w576-b3-"));
  try {
    const plain = reader(cwd, ["--studio", "studio"]);
    assert.ok(plain.status === 0 && plain.out[0] === "v1 walk: 1 of 9 steps green", `the reader prints the count line: ${plain.status} ${plain.out[0]}`);
    assert.ok(plain.out[1] === "S5: table pending W-697, W-372, W-557, W-308; bar not run: S5's row is pending", `the reader names the failing S5 half: ${plain.out[1]}`);
    const s5empty = emptied(mod.WALK!, ["S5"]);
    stub(cwd, 1);
    const breached = reader(cwd, ["--studio", "studio"], s5empty);
    assert.ok(breached.out[1] === "S5: table empty; bar breached: cycle minutes 72 > 60", `the reader names the failing S5 half: ${breached.out[1]}`);
    stub(cwd, null);
    const absent = reader(cwd, ["--studio", "studio"], s5empty);
    assert.ok(absent.out[1] === "S5: table empty; bar not run: scripts/s5-bar.ts is absent", `the reader names the failing S5 half: ${absent.out[1]}`);
    stub(cwd, 3);
    const other = reader(cwd, ["--studio", "studio"], s5empty);
    assert.ok(other.out[1] === "S5: table empty; bar not run: exit 3", `the reader names the failing S5 half: ${other.out[1]}`);
    stub(cwd, 0);
    const met = reader(cwd, ["--studio", "studio"], s5empty);
    assert.ok(met.status === 0 && met.out[0] === "v1 walk: 2 of 9 steps green" && met.out.length === 1, `the reader names the failing S5 half: met ${met.out.join(" | ")}`);
    const malformed = reader(cwd, ["--studio", "studio"], mod.WALK!.slice(0, 8));
    assert.ok(malformed.status === 2 && /^v1 walk: refused: \S.*$/.test(malformed.out[0] ?? ""), `the reader refuses a malformed table, exit 2: ${malformed.status} ${malformed.out[0]}`);
    const unreadable = reader(cwd, ["--studio", "studio"], "{ not json");
    assert.ok(unreadable.status === 2 && /^v1 walk: refused: BISELLIUM_WALK_TABLE \S.*$/.test(unreadable.out[0] ?? ""), `the reader refuses an unreadable table, exit 2: ${unreadable.status} ${unreadable.out[0]}`);
    for (const args of [[], ["--studio"], ["--studio", "studio", "--opus", "W-1"], ["--repo", "."]]) {
      const r = reader(cwd, args);
      assert.ok(r.status === 2 && r.out.length === 0, `the reader refuses any other argument, exit 2: ${args.join(" ")} -> ${r.status}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
