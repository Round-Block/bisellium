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
import { spawnSync } from "node:child_process";
import { posix } from "node:path";

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

export interface GateOptions {
  now?: () => Date;
  rowTimeoutMs?: number;
  budgetMs?: number;
  pool?: number;
}
/** W-563 red stub: the runner runs nothing yet. */
export async function runGate(_argv: string[], _opts: GateOptions = {}): Promise<number> {
  return 0;
}
