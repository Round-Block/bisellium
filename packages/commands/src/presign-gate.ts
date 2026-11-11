/**
 * packages/commands/src/presign-gate.ts — W-563 (presign-meet-1109 call 1, D-189; ladder-time-meet-1111 call 2): the cheap
 * gates a spec signature owes.
 *
 * `gateRows` names, from a git tree and its base, the rows the architect's signature owes: the officina check, typecheck,
 * one `reads` row per test file the series adds, and one `test` row per test file the series adds or changes and per test
 * file that directly imports a touched path. `runGate` (the runner, `node --import tsx <this file>`) runs them pooled in a
 * clean scratch worktree at the series' own tree, each under a timeout, within a budget (a row not started by then is
 * logged `deferred`, deferred to `ci --opus`), and always writes the log; `gateLogProblems` is `verdict --phase spec`'s
 * reading of that log: it runs nothing, it checks the log is the runner's at the prototype's tree with every owed row
 * passed or deferred.
 *
 * ponytail: the walk is one textual import edge deep. A transitive importer, a test that spawns or names a touched file, a
 * non-literal dynamic import and a playwright or vitest spec under apps/ or docs/ are no rows; `ci --opus` stays the full judge.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";

export type RowKind = "check" | "typecheck" | "test" | "reads";
export interface GateRow {
  kind: RowKind;
  /** the test file, for `test` and `reads` rows */
  file?: string;
  command: string;
}
export const CHECK_COMMAND = "npm run -s check -- studio --repo .";
export const TYPECHECK_COMMAND = "npm run -s typecheck";
/** A required test file that no `test:suite` command names: the runner records it as failed (exit 1), never runs it. */
export const UNNAMED = "(no test:suite command names it)";
export const LOG_MAX_BYTES = 1024 * 1024;
/** W-563 r3 (ladder-time-meet-1111 call 2): a row's timeout, the run's budget and the pool's cap. */
export const ROW_TIMEOUT_MS = 600_000;
export const BUDGET_MS = 600_000;
export const POOL_MAX = 8;
const GIT_TIMEOUT_MS = 120_000;
const TEST_FILE = /\.test\.(?:ts|mts|mjs)$/;
const CODE_FILE = /\.(?:ts|mts|cts|mjs|cjs|js)$/;
const UNGATED = /^(?:apps|docs)\//;
// one-sided: `from` and `import(` are ASCII keywords in source text, so an ASCII boundary is the token's own
const FROM = /(?:^|[\s;}])(?:import|export)\s[^;]*?\bfrom\s*["']([^"'\n]+)["']/g;
const BARE = /(?:^|[\s;}])import\s*["']([^"'\n]+)["']/g;
// one-sided: as FROM, an ASCII keyword
const DYNAMIC = /\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;

function git(repo: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): { out: Buffer } | { error: string } {
  const r = spawnSync("git", ["-C", repo, ...args], { input, env: env ?? process.env, maxBuffer: 256 * 1024 * 1024, timeout: GIT_TIMEOUT_MS });
  if (r.error !== undefined || r.status !== 0) return { error: `git ${args[0]} failed: ${(r.stderr?.toString("utf8") ?? r.error?.message ?? "").trim().split("\n")[0] ?? ""}` };
  return { out: r.stdout };
}
const z = (b: Buffer): string[] => b.toString("utf8").split("\0").filter((s) => s !== "");

/** The test:suite `&&`-commands of a package.json text, or an error when it does not parse. */
export function suiteCommands(pkg: string | undefined): string[] | { error: string } {
  try {
    const s = (JSON.parse(pkg ?? "") as { scripts?: Record<string, unknown> }).scripts?.["test:suite"];
    return typeof s === "string" ? s.split("&&").map((c) => c.trim()).filter((c) => c !== "") : [];
  } catch {
    return { error: "package.json does not parse" };
  }
}

/** The repo files a file imports directly (W-563 behaviour 1's forms), resolved against `present`. */
function edges(file: string, text: string, present: Set<string>): string[] {
  const out = new Set<string>();
  const specs = [...text.matchAll(FROM), ...text.matchAll(BARE), ...text.matchAll(DYNAMIC)].map((m) => m[1]!);
  for (const spec of specs) {
    let base: string | undefined;
    if (spec.startsWith("./") || spec.startsWith("../")) base = posix.normalize(posix.join(posix.dirname(file), spec));
    else {
      const ws = /^@bisellium\/([a-z0-9-]+)(?:\/(.+))?$/.exec(spec);
      if (ws !== null) base = `packages/${ws[1]}/src/${ws[2] ?? "index.js"}`;
    }
    if (base === undefined) continue;
    const tries = base.endsWith(".js") ? [base, `${base.slice(0, -3)}.ts`] : base.endsWith(".mjs") ? [base, `${base.slice(0, -4)}.mts`] : [base, `${base}.ts`, `${base}/index.ts`];
    for (const t of tries) if (present.has(t)) out.add(t);
  }
  out.delete(file);
  return [...out];
}

/** The rows owed at a tree, from its file list, a reader of its test files and package.json, and the touched and added paths. */
export function rowsAt(files: string[], read: (path: string) => string | undefined, touched: string[], added: string[]): GateRow[] | { error: string } {
  const present = new Set(files);
  const suite = suiteCommands(read("package.json"));
  if ("error" in suite) return suite;
  const tests = files.filter((f) => TEST_FILE.test(f) && !UNGATED.test(f)).sort();
  const direct = new Map(tests.map((t) => [t, edges(t, read(t) ?? "", present)] as const));
  const imports = (t: string): string[] => direct.get(t) ?? [];
  const named = (f: string): string | undefined => suite.find((c) => c.split(/\s+/).includes(f));
  const touchedSet = new Set(touched);
  // owed: a test file the series adds or changes, or one importing a touched path directly (no closure, no basename edge)
  const owed = new Set(tests.filter((t) => touchedSet.has(t) || imports(t).some((p) => touchedSet.has(p))));
  // a test file no command names that another test file imports is a fixture: its direct importers are its rows
  const fixtures = new Set(tests.filter((t) => named(t) === undefined && tests.some((o) => imports(o).includes(t))));
  for (const t of tests) if (imports(t).some((p) => fixtures.has(p) && owed.has(p))) owed.add(t);
  // a command naming several test files (one `node --test` over a family) runs only the owed files it names, in its own order
  const isTest = (w: string): boolean => present.has(w) && TEST_FILE.test(w);
  const command = (f: string): string => {
    const c = named(f);
    if (c === undefined) return UNNAMED;
    const words = c.split(/\s+/);
    return words.filter(isTest).length < 2 ? c : words.filter((w) => !isTest(w) || (owed.has(w) && !fixtures.has(w))).join(" ");
  };
  const rows: GateRow[] = [{ kind: "check", command: CHECK_COMMAND }, { kind: "typecheck", command: TYPECHECK_COMMAND }];
  for (const a of [...added].sort()) if (TEST_FILE.test(a) && !UNGATED.test(a)) rows.push({ kind: "reads", file: a, command: command(a) });
  for (const t of tests) if (owed.has(t) && !fixtures.has(t)) rows.push({ kind: "test", file: t, command: command(t) });
  return rows;
}

/** W-563 behaviour 1: the rows a signature owes for `tree` against `base`, read from the repo's object store. */
export function gateRows(repo: string, base: string, tree: string): GateRow[] | { error: string } {
  const diff = git(repo, ["diff", "--name-only", "-z", "--no-renames", base, tree]);
  const add = git(repo, ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=A", base, tree]);
  const ls = git(repo, ["ls-tree", "-r", "-z", "--full-tree", tree]);
  if ("error" in diff) return diff;
  if ("error" in add) return add;
  if ("error" in ls) return ls;
  const blobs = new Map<string, string>();
  for (const entry of z(ls.out)) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(entry);
    if (m !== null) blobs.set(m[2]!, m[1]!);
  }
  const wanted = [...blobs.keys()].filter((p) => (TEST_FILE.test(p) && !UNGATED.test(p)) || p === "package.json");
  const cat = git(repo, ["cat-file", "--batch"], wanted.map((p) => blobs.get(p)!).join("\n") + "\n");
  if ("error" in cat) return cat;
  const text = new Map<string, string>();
  let at = 0;
  for (const p of wanted) {
    const nl = cat.out.indexOf(10, at);
    const size = Number(/ blob (\d+)$/.exec(cat.out.subarray(at, nl).toString("utf8"))?.[1] ?? NaN);
    if (!Number.isInteger(size)) return { error: `git cat-file could not read ${p}` };
    text.set(p, cat.out.subarray(nl + 1, nl + 1 + size).toString("utf8"));
    at = nl + 1 + size + 1;
  }
  return rowsAt([...blobs.keys()], (p) => text.get(p), z(diff.out), z(add.out));
}

/** The tree the series makes on `base`, built in a temporary index (never the repo's own), removed after. */
export function treeOfSeries(repo: string, base: string, series: string): { tree: string } | { error: string } {
  let dir: string;
  try {
    dir = mkdtempSync(join(tmpdir(), "presign-gate-"));
  } catch (e) {
    return { error: `a temporary index cannot be made: ${(e as Error).message}` };
  }
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, "index") };
    const steps: [string[], string?][] = [[["read-tree", base]], [["apply", "--cached"], series], [["write-tree"]]];
    let out = "";
    for (const [args, input] of steps) {
      const r = git(repo, args, input, env);
      if ("error" in r) return { error: `the series does not apply to ${base}: ${r.error}` };
      out = r.out.toString("utf8").trim();
    }
    return /^[0-9a-f]{40,64}$/.test(out) ? { tree: out } : { error: "git write-tree printed no tree" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface GateLog {
  id: string;
  base: string;
  series: string;
  tree: string;
  rows: { exit: number | "deferred"; kind: RowKind; file?: string; command: string }[];
}
const HEADS = ["presign-gate", "base", "series", "tree", "started"] as const;
const ROW = /^(0|[1-9][0-9]{0,2}|deferred)\t([0-9]+\.[0-9])\t(check|typecheck|test|reads)\t(-|[^\t]+)\t([^\t]+)$/;

/** The log's grammar (W-563 behaviour 2): the five header lines once each in order, the rows, `# minutes:` last, LF ends. */
export function readGateLog(text: string): GateLog | { error: string } {
  if (text.includes("\r")) return { error: "the log holds a CR" };
  if (!text.endsWith("\n")) return { error: "the log does not end with a newline" };
  const lines = text.slice(0, -1).split("\n");
  const head: string[] = [];
  for (const [i, key] of HEADS.entries()) {
    const m = new RegExp(`^# ${key}: (\\S+)$`).exec(lines[i] ?? "");
    if (m === null) return { error: `line ${i + 1} is not "# ${key}: <value>"` };
    head.push(m[1]!);
  }
  if (!/^[0-9a-f]{40,64}$/.test(head[1]!) || !/^sha256:[0-9a-f]{64}$/.test(head[2]!) || !/^[0-9a-f]{40,64}$/.test(head[3]!)) return { error: "the base, series or tree header is out of form" };
  if (!/^# minutes: [0-9]+\.[0-9]$/.test(lines.at(-1) ?? "")) return { error: 'the last line is not "# minutes: <n.n>"' };
  const rows: GateLog["rows"] = [];
  for (const [i, line] of lines.slice(HEADS.length, -1).entries()) {
    const m = ROW.exec(line);
    if (m === null) return { error: `line ${i + HEADS.length + 1} is not a row "<exit>\\t<seconds>\\t<kind>\\t<file|->\\t<command>"` };
    rows.push({ exit: m[1] === "deferred" ? "deferred" : Number(m[1]), kind: m[3] as RowKind, ...(m[4] === "-" ? {} : { file: m[4]! }), command: m[5]! });
  }
  return { id: head[0]!, base: head[1]!, series: head[2]!.slice("sha256:".length), tree: head[3]!, rows };
}

export interface GateOptions {
  now?: () => Date;
  /** a row still running at this many milliseconds is killed and recorded as failed, exit 124 */
  rowTimeoutMs?: number;
  /** a row not started this many milliseconds after the first is logged `deferred` (deferred to `ci --opus`) */
  budgetMs?: number;
  /** rows run at once: the host's cores, at most POOL_MAX */
  pool?: number;
}

/** One command in the worktree, its process group killed at the timeout: its exit, 124 when it timed out. */
function sh(wt: string, command: string, timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((done) => {
    const child = spawn("sh", ["-c", command], { cwd: wt, stdio: "ignore", env, detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-(child.pid ?? NaN), "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("error", () => (clearTimeout(timer), done(1)));
    child.on("close", (code) => (clearTimeout(timer), done(timedOut ? 124 : (code ?? 1))));
  });
}

async function runRow(wt: string, row: GateRow, scratch: string, n: number, timeoutMs: number): Promise<number> {
  if (row.command === UNNAMED) return 1;
  if (row.kind !== "reads") return sh(wt, row.command, timeoutMs);
  const log = join(scratch, `reads-${n}.log`);
  const env = { ...process.env, NODE_OPTIONS: `--import ${join(wt, "scripts", "record-reads.mjs")}`, BISELLIUM_RECORD_READS: log };
  const run = await sh(wt, row.command, timeoutMs, env);
  if (run !== 0) return run;
  const check = spawnSync("node", [join("scripts", "ci-scope.mjs"), "--check-reads", log], { cwd: wt, encoding: "utf8", timeout: timeoutMs });
  const bad = check.error !== undefined || (check.stdout ?? "").split("\n").some((l) => l.startsWith("unlisted:") || l.startsWith("failed:") || l.startsWith("missing:"));
  return bad ? 1 : 0;
}

/**
 * W-563 behaviour 2: the runner. Exit 2 (no log) unless the worktree is clean at the series' tree; else the rows run pooled,
 * each under its timeout, and a row not started within the budget is `deferred`; the log is always written; exit 1 when a
 * row failed (a timeout included), 0 otherwise (deferred rows do not fail).
 */
export async function runGate(argv: string[], opts: GateOptions = {}): Promise<number> {
  const now = opts.now ?? (() => new Date());
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i]!, argv[i + 1]];
    if (!["--opus", "--worktree", "--base", "--series", "--out"].includes(k) || v === undefined || flags.has(k)) {
      console.error("usage: presign-gate --opus <id> --worktree <dir> --base <sha> --series <mbox> --out <log>");
      return 2;
    }
    flags.set(k, v);
  }
  const [id, wt, base, seriesPath, out] = ["--opus", "--worktree", "--base", "--series", "--out"].map((k) => flags.get(k));
  if (id === undefined || wt === undefined || base === undefined || seriesPath === undefined || out === undefined) {
    console.error("usage: presign-gate --opus <id> --worktree <dir> --base <sha> --series <mbox> --out <log>");
    return 2;
  }
  const refuse = (why: string): number => (console.error(`presign-gate: ${why}`), 2);
  let series: Buffer;
  try {
    series = readFileSync(seriesPath);
  } catch {
    return refuse(`${seriesPath} cannot be read`);
  }
  const status = git(wt, ["status", "--porcelain", "--untracked-files=all"]);
  if ("error" in status) return refuse(status.error);
  if (status.out.length > 0) return refuse(`${wt} is not clean`);
  const head = git(wt, ["rev-parse", "HEAD^{tree}"]);
  const baseSha = git(wt, ["rev-parse", "--verify", `${base}^{commit}`]);
  if ("error" in head) return refuse(head.error);
  if ("error" in baseSha) return refuse(baseSha.error);
  const made = treeOfSeries(wt, base, series.toString("utf8"));
  if ("error" in made) return refuse(made.error);
  const tree = head.out.toString("utf8").trim();
  if (tree !== made.tree) return refuse(`${wt} is at tree ${tree}, and the series makes ${made.tree} on ${base}`);
  const rows = gateRows(wt, base, tree);
  if ("error" in rows) return refuse(rows.error);
  const [timeoutMs, budgetMs] = [opts.rowTimeoutMs ?? ROW_TIMEOUT_MS, opts.budgetMs ?? BUDGET_MS];
  const pool = Math.max(1, Math.min(opts.pool ?? availableParallelism(), POOL_MAX, rows.length));
  const started = now();
  const lines = [
    `# presign-gate: ${id}`,
    `# base: ${baseSha.out.toString("utf8").trim()}`,
    `# series: sha256:${createHash("sha256").update(series).digest("hex")}`,
    `# tree: ${tree}`,
    `# started: ${started.toISOString()}`,
  ];
  const results = rows.map((r) => `deferred\t0.0\t${r.kind}\t${r.file ?? "-"}\t${r.command}`);
  const scratch = mkdtempSync(join(tmpdir(), "presign-gate-reads-"));
  let failed = false;
  let taken = 0;
  const shared = new Map<string, Promise<number>>();
  try {
    const worker = async (): Promise<void> => {
      for (let n = taken++; n < rows.length; n = taken++) {
        // a row not started within the budget stays `deferred`: deferred to `ci --opus`, never a failure
        if (now().getTime() - started.getTime() >= budgetMs) continue;
        const row = rows[n]!;
        const t0 = Date.now();
        // rows sharing one kind and command (a multi-file test:suite command) run it once and share its exit
        const key = `${row.kind}	${row.command}`;
        const run = shared.get(key) ?? runRow(wt, row, scratch, n, timeoutMs);
        shared.set(key, run);
        const exit = await run;
        failed ||= exit !== 0;
        results[n] = `${Math.min(exit, 999)}\t${((Date.now() - t0) / 1000).toFixed(1)}\t${row.kind}\t${row.file ?? "-"}\t${row.command}`;
      }
    };
    await Promise.all(Array.from({ length: pool }, worker));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    lines.push(...results, `# minutes: ${((now().getTime() - started.getTime()) / 60000).toFixed(1)}`);
    writeFileSync(out, `${lines.join("\n")}\n`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void runGate(process.argv.slice(2)).then((code) => process.exit(code));

