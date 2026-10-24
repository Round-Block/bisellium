/**
 * packages/cli/src/rules/tests.ts — W-121: `test.sleep`, block. A wall-clock
 * sleep in a tracked test file needs a named seam or an annotated waiver
 * (studio/briefs/W-121.md, "Interfaces"). Seam S2: `root` is the OFFICINA
 * (unused), `opts.repo` the repo root. Never throws; reads, never writes;
 * file contents are data.
 *
 * Unlike rules/evidence.ts, a rule that cannot observe says so: with
 * `opts.repo` present, an unenumerable tree is a finding, because silence
 * would pass every sleep. `[]` only when `opts.repo` is absent.
 *
 * Not a JavaScript parser: one lexical pass splits each line into `code` and
 * `comment` (see `lex`). Regex literals holding a quote or a double slash, and
 * a backtick nested in `${ }`, can desynchronise it (brief, residual 5).
 *
 * W-178 adds `test.rows`, block: with `opts.repo`, no test file at the
 * merge-base of HEAD and master has fewer rows in the working tree unless the
 * change adds one exact record to `test/row-drops.yml` (studio/briefs/W-178.md).
 *
 * W-376 adds `test.one_sided`, block: with `opts.repo`, a line of a tracked test
 * file added or changed since that merge-base holding a one-sided assertion of a
 * string (studio/briefs/W-376.md) needs the whole string asserted, or a
 * `// one-sided: <reason>` annotation.
 *
 * W-392 adds the boundary form to `test.one_sided`: a line of any tracked code
 * file added or changed since that merge-base whose pattern (a regex literal, or
 * a literal first argument of `RegExp(`) bounds a token by a set over part of
 * the alphabet (`\b`, `\w`, an ASCII letter range, a letter property without
 * marks or numbers, or a set built from a substitution) needs a whole set, or
 * the same annotation (studio/briefs/W-392.md).
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Finding, RuleOpts } from "../check.js";

export interface Covered {
  where: string;
  annotation: "seam" | "waiver";
  kind: string;
}
export interface RowDrop {
  path: string;
  drop: number;
  opus: string;
  reason: string;
}
export interface TestScan {
  findings: Finding[];
  sites: string[];
  covered: Covered[];
}

const PACKAGE_JSON = "package.json";
const GIT_WHERE = "git ls-files";
const MERGE_BASE_WHERE = "git merge-base";
const ROW_DROPS = "test/row-drops.yml";
const MASTER_REFS = ["refs/heads/master", "refs/remotes/origin/master"];
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 1024 * 1024;
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const TEST_DIRS = new Set(["test", "tests", "tests-serve", "__tests__", "e2e"]);
const TEST_NAME = /\.(?:test|spec)\.[cm]?[tj]sx?$/;
const WAIVER_KINDS = ["guard", "subject", "fixture", "no-observable"];
const DENY_RECEIVERS = new Set(["test", "sock", "socket", "req", "res", "server"]);
const PRIMITIVE_NAMES = new Set(["setTimeout", "setInterval", "sleep", "waitForTimeout", "Atomics", "wait", "waitAsync", "timers/promises"]);

// ---- sleep-primitive grammar, applied to `code` ---------------------------
const BARE_TIMER = /(?<![\w$])(?<!\.\s*)(?:setTimeout|setInterval)(?![\w$])/;
const MEMBER_TIMER = /(?:\?\.|\.)\s*(?:setTimeout|setInterval)(?![\w$])/g;
const SLEEP = /(?<![\w$])sleep\s*(?:\?\.\s*)?(?:\.\s*(?:call|apply|bind)\s*)?(?:\(|$)/;
const PLAYWRIGHT = /\bwaitForTimeout\b/;
const ATOMICS = /\bAtomics\s*\.\s*wait(?:Async)?\b/;
const TIMERS_PROMISES = /timers\/promises/;
const COMPUTED = /\[\s*["'`](?:setTimeout|setInterval|sleep)["'`]\s*\]/;

// ---- annotation grammar ---------------------------------------------------
const ANNOTATION_START = /^\/\/\s*sleep-/;
const ANNOTATION = /^\/\/\s*sleep-(seam|waiver):\s*(\S+)\s+--\s+(\S.*)$/;
const SEAM_NAME = /^[A-Za-z_/][A-Za-z0-9_./-]{2,}$/;
const NAME_WINDOW = 40;
const MIN_REASON_CHARS = 15;
const MIN_REASON_WORDS = 3;

const block = (where: string, message: string): Finding => ({ rule: "test.sleep", level: "block", where, message });
const rowBlock = (where: string, message: string): Finding => ({ rule: "test.rows", level: "block", where, message });

interface Line {
  code: string;
  comment?: string;
}

/** One deterministic pass; see the file header. State across lines: inside a
 *  block comment, inside a template literal. A `'` or `"` string resets at the
 *  newline. Block-comment spans are blanked out of `code`; string and template
 *  contents stay in it. In a line that begins inside a template literal, a
 *  trimmed text beginning with a double slash is an embedded script's own
 *  comment line (that is where an annotation inside a fixture lives).
 *  W-178: `blankStrings` replaces string and template contents (quotes stay)
 *  with spaces, so `countTestRows` never counts text inside a fixture. */
export function lex(text: string, opts: { blankStrings?: boolean } = {}): Line[] {
  const blank = opts.blankStrings === true;
  const out: Line[] = [];
  let inBlock = false;
  let inTemplate = false;
  for (const raw of text.split(/\r?\n/)) {
    if (inTemplate && raw.trimStart().startsWith("//")) {
      out.push({ code: "", comment: raw.trim() });
      continue;
    }
    let code = "";
    let comment: string | undefined;
    let quote = "";
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]!;
      const n = raw[i + 1];
      if (inBlock) {
        if (c === "*" && n === "/") {
          inBlock = false;
          i++;
          code += "  ";
        } else code += " ";
      } else if (quote !== "" || inTemplate) {
        const closing = quote !== "" ? c === quote : c === "`";
        code += blank && !closing ? " " : c;
        if (c === "\\" && n !== undefined) {
          code += blank ? " " : n;
          i++;
        } else if (closing) {
          quote = "";
          inTemplate = false;
        }
      } else if (c === "/" && n === "*") {
        inBlock = true;
        i++;
        code += "  ";
      } else if (c === "/" && n === "/") {
        comment = raw.slice(i).trim();
        break;
      } else {
        if (c === '"' || c === "'") quote = c;
        else if (c === "`") inTemplate = true;
        code += c;
      }
    }
    out.push(comment === undefined ? { code } : { code, comment });
  }
  return out;
}

/** The first primitive on a `code` line, or undefined. */
function primitiveOf(code: string): string | undefined {
  const bare = BARE_TIMER.exec(code);
  if (bare) return bare[0];
  for (const m of code.matchAll(MEMBER_TIMER)) {
    const before = code.slice(0, m.index).trimEnd();
    const recv = /(?<![\w$.])([\w$]+)$/.exec(before);
    if (!recv || !DENY_RECEIVERS.has(recv[1]!)) return m[0].replace(/^(?:\?\.|\.)\s*/, "");
  }
  if (SLEEP.test(code)) return "sleep";
  const pw = PLAYWRIGHT.exec(code);
  if (pw) return pw[0];
  const at = ATOMICS.exec(code);
  if (at) return at[0].replace(/\s+/g, "");
  if (TIMERS_PROMISES.test(code)) return "timers/promises";
  const computed = COMPUTED.exec(code);
  if (computed) return computed[0];
  return undefined;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

type Verdict = { ok: Covered["annotation"]; kind: string } | { defect: string };

/** Diagnose the site at `idx` with the FIRST failing check, in brief order. */
function judge(lines: Line[], idx: number): Verdict {
  const own = lines[idx]!.comment;
  const prev = lines[idx - 1];
  let comment: string | undefined;
  if (own !== undefined && ANNOTATION_START.test(own)) comment = own;
  else if (prev !== undefined && prev.code.trim() === "" && prev.comment !== undefined && ANNOTATION_START.test(prev.comment)) comment = prev.comment;
  if (comment === undefined)
    return { defect: 'no annotation (wait on a named seam, or add "// sleep-seam: <name> -- <reason>" or "// sleep-waiver: <kind> -- <reason>")' };

  const m = ANNOTATION.exec(comment);
  if (!m) return { defect: 'malformed annotation (expected "// sleep-<seam|waiver>: <name|kind> -- <reason>")' };
  const [, flavour, word, reason] = m as unknown as [string, "seam" | "waiver", string, string];
  if (flavour === "waiver" && !WAIVER_KINDS.includes(word))
    return { defect: `unknown kind "${word}" (expected ${WAIVER_KINDS.join(", ")}; "settle" is not a kind)` };
  if (flavour === "seam") {
    if (!SEAM_NAME.test(word) || PRIMITIVE_NAMES.has(word)) return { defect: `bad name "${word}" (a seam names the observable the wait exits on)` };
    const used = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(word)}(?![A-Za-z0-9_])`);
    let found = false;
    for (let j = Math.max(0, idx - NAME_WINDOW); j <= Math.min(lines.length - 1, idx + NAME_WINDOW) && !found; j++) found = used.test(lines[j]!.code);
    if (!found) return { defect: `name not used: "${word}" does not occur in the code within ${NAME_WINDOW} lines of the site` };
  }
  const text = reason.trim();
  if (text.replace(/\s+/g, "").length < MIN_REASON_CHARS || text.split(/\s+/).length < MIN_REASON_WORDS)
    return { defect: `reason too short (need ${MIN_REASON_CHARS} non-whitespace characters in at least ${MIN_REASON_WORDS} words)` };
  return { ok: flavour, kind: flavour === "seam" ? "seam" : word };
}

/** The paths a root package.json `test*` script names; throws on text that is not JSON. */
function registeredPaths(pkgText: string): Set<string> {
  const registered = new Set<string>();
  const pkg = JSON.parse(pkgText) as { scripts?: unknown };
  const scripts = typeof pkg.scripts === "object" && pkg.scripts !== null ? (pkg.scripts as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(scripts)) {
    if (!key.startsWith("test") || typeof value !== "string") continue;
    for (const token of value.split(/\s+/)) registered.add(token.replace(/^\.\//, ""));
  }
  return registered;
}

/** W-121's test-file classification: a code file named *.test.* or *.spec.*, under a test directory, or registered by a `test*` script. */
export function isTestPath(path: string, registered: ReadonlySet<string>): boolean {
  const segs = path.split("/");
  const name = segs[segs.length - 1]!;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (!EXTENSIONS.has(ext) || segs.includes("node_modules")) return false;
  return TEST_NAME.test(name) || segs.slice(0, -1).some((s) => TEST_DIRS.has(s)) || registered.has(path);
}

/** Repo-relative POSIX paths of the tracked files the rule scans, plus any
 *  observation-failure findings. */
function fileSet(repo: string, findings: Finding[]): string[] {
  let tracked: string[];
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: repo,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    tracked = out.split("\0").filter((p) => p.length > 0);
  } catch (e) {
    const err = e as { stderr?: unknown; message?: string };
    const reason = (typeof err.stderr === "string" && err.stderr.trim()) || err.message || "unknown error";
    findings.push(block(GIT_WHERE, `could not enumerate tracked files (${reason.split("\n")[0]}); the sleep scan did not run`));
    return [];
  }

  // test paths registered by a root package.json `test*` script
  let registered = new Set<string>();
  const pkgPath = join(repo, PACKAGE_JSON);
  if (existsSync(pkgPath)) {
    try {
      registered = registeredPaths(readFileSync(pkgPath, "utf8"));
    } catch {
      findings.push(block(PACKAGE_JSON, "could not parse package.json; registered test paths unknown"));
    }
  }

  return tracked.filter((p) => isTestPath(p, registered));
}

// ---- W-178: the row grammar (brief "Interfaces"), applied to `lex(.., { blankStrings: true })` code
// An identifier character, the one class every pattern below uses: `\w` and `\b` are ASCII-only and read `ñtest(` as `test(`.
const ID = String.raw`[\p{ID_Continue}$\u200c\u200d]`;
const DEFINITION = new RegExp(
  String.raw`^(\s*)(?:export\s+)?(?:(?:async\s+)?function(?!${ID})\s*\*?\s*(${ID}+)\s*\(|(?:const|let|var)\s+(${ID}+)\s*=\s*(?:async\s+)?(?:function(?!${ID})|\([^)]*\)\s*(?::[^=]*)?=>|${ID}+\s*=>))`,
  "u",
);
const REGISTRATION = new RegExp(String.raw`(?<!${ID}|\.)(?:test|it)(?:\s*\.\s*(?:skip|only|todo))?\s*\(`, "gu");
const RUNNERS = new Set(["node:test", "@playwright/test"]);
// An import site, scanned in comment-free code with strings blanked (so never inside a comment, string or template).
// `import` or `require` must be a free identifier: no identifier character, `#` (a private name) or `\u{..}` escape before
// it and no identifier character after it, not a member (`x.require(`, `x?.import(`, `x.#require(`; `...require(` is a spread)
// and not `new require(`. It owns the one module literal it names.
const KEYWORD = new RegExp(String.raw`(?<!${ID}|#|\\u\{[\da-fA-F]+\})(?:import|require)(?!${ID})`, "gu");
const MEMBER_OR_NEW = new RegExp(String.raw`(?:(?<!\.\.)\.|(?<!${ID})new)$`, "u");
const CALL = /\s*\(\s*(["'`])/y; // import("m"), require("m")
const SIDE_EFFECT = /\s*(["'])/y; // import "m"
const TYPE_ONLY = new RegExp(String.raw`\s*type(?!${ID}|,)(?!\s*from(?!${ID}))`, "uy"); // import type ... : erased, loads no runner
const STATIC = new RegExp(String.raw`[\p{ID_Continue}$\u200c\u200d\s,{}*\\]*?(?<!${ID})from\s*(["'])`, "uy"); // import <clause> from "m", the clause over any lines
const AFTER_MODULE = /\s*[,)]/y;

/** The module names imported or required by the free sites of `code`; `plain` is the same text with string contents. */
function importedModules(code: string, plain: string): Set<string> {
  const mods = new Set<string>();
  const at = (re: RegExp, from: number): RegExpExecArray | null => {
    re.lastIndex = from;
    return re.exec(code);
  };
  for (const key of code.matchAll(KEYWORD)) {
    let back = key.index;
    while (back > 0 && /\s/.test(code[back - 1]!)) back--;
    // five code units: `.`, or `new` and the whole (possibly astral) character before it
    if (MEMBER_OR_NEW.test(code.slice(Math.max(0, back - 5), back))) continue;
    const from = key.index + key[0].length;
    const call = at(CALL, from);
    const site = call ?? (key[0] === "require" ? null : (at(SIDE_EFFECT, from) ?? (at(TYPE_ONLY, from) ? null : at(STATIC, from))));
    if (!site) continue;
    const open = from + site[0].length;
    const close = code.indexOf(site[0].at(-1)!, open);
    if (close < 0 || (call && !at(AFTER_MODULE, close + 1))) continue;
    mods.add(plain.slice(open, close));
  }
  return mods;
}
const PRINTS = /console\.(?:log|error)|process\.std(?:out|err)\.write/;
const WRAPPER_ROUNDS = 4;

/** The test rows a file registers, statically: registrations (in a file that imports a runner), PASS/FAIL reporters
 *  and the wrappers that call them, each call weighing its function's rows. Total; see the brief for the limits. */
export function countTestRows(text: string): number {
  const code = lex(text, { blankStrings: true }).map((l) => l.code);
  // comments are gone from both views; `plain` keeps string contents (PASS, FAIL, a module name), `code` blanks them
  const plain = lex(text).map((l) => l.code);
  // the runner is the module of one free import or require site; nothing else on the line takes part
  const runner = [...importedModules(code.join("\n"), plain.join("\n"))].some((m) => RUNNERS.has(m));
  const registrations = (lines: string[]): number => (runner ? lines.reduce((n, l) => n + (l.match(REGISTRATION)?.length ?? 0), 0) : 0);
  const calls = (name: string, lines: string[]): number => {
    const re = new RegExp(String.raw`(?<!${ID}|\.)${escapeRegExp(name)}\s*\(`, "gu");
    return lines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);
  };

  // a body runs from its definition line to the first later line indented at or left of it
  const fns: { name: string; start: number; end: number }[] = [];
  for (let i = 0; i < code.length; i++) {
    const m = DEFINITION.exec(code[i]!);
    if (!m) continue;
    const indent = m[1]!.length;
    let end = i;
    const line = code[i]!;
    const oneLine = /[;,]\s*$/.test(line) || (/=>\s*[^{\s]/.test(line) && !/[({[]\s*$/.test(line));
    if (!oneLine)
      for (let j = i + 1; j < code.length; j++) {
        const next = code[j]!;
        if (next.trim() === "") continue;
        if (next.length - next.trimStart().length <= indent) {
          end = /^\s*[})\]]/.test(next) ? j : j - 1;
          break;
        }
        end = j;
      }
    fns.push({ name: (m[2] ?? m[3])!, start: i, end });
  }

  const weight = new Map<string, number>();
  const reporters = new Set<string>();
  for (const f of fns) {
    const words = plain.slice(f.start, f.end + 1).join("\n");
    if (words.includes("PASS") && words.includes("FAIL") && PRINTS.test(code.slice(f.start, f.end + 1).join("\n"))) {
      weight.set(f.name, 1);
      reporters.add(f.name);
    }
  }
  for (let round = 0; round < WRAPPER_ROUNDS; round++)
    for (const f of fns) {
      if (reporters.has(f.name)) continue;
      const body = [code[f.start]!.replace(DEFINITION, ""), ...code.slice(f.start + 1, f.end + 1)];
      let w = registrations(body);
      for (const [name, wt] of weight) if (name !== f.name) w += calls(name, body) * wt;
      if (w > 0) weight.set(f.name, w);
    }

  // count: registrations and weighted calls outside every weighted function's body
  const inside = new Set<number>();
  for (const f of fns) if (weight.has(f.name)) for (let k = f.start; k <= f.end; k++) inside.add(k);
  const outside = code.map((l, k) => (inside.has(k) ? "" : l));
  let total = registrations(outside);
  for (const [name, wt] of weight) total += calls(name, outside) * wt;
  return total;
}

export function scanTests(_root: string, opts: RuleOpts): TestScan {
  const scan: TestScan = { findings: [], sites: [], covered: [] };
  if (!opts.repo) return scan;
  try {
    for (const rel of fileSet(opts.repo, scan.findings)) {
      const abs = join(opts.repo, rel);
      let text: string;
      try {
        const st = lstatSync(abs);
        if (st.isSymbolicLink()) {
          scan.findings.push(block(rel, "tests are scanned as regular files; track the target as a regular file"));
          continue;
        }
        if (!st.isFile()) continue;
        if (st.size > MAX_BYTES) {
          scan.findings.push(block(rel, "not scanned: over 1 MiB"));
          continue;
        }
        text = readFileSync(abs, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") scan.findings.push(block(rel, `could not read (${(e as Error).message})`));
        continue; // ENOENT: a tracked file deleted in the working tree
      }
      const lines = lex(text);
      for (let i = 0; i < lines.length; i++) {
        const primitive = lines[i]!.code.trim() === "" ? undefined : primitiveOf(lines[i]!.code);
        if (primitive === undefined) continue;
        const where = `${rel}:${i + 1}`;
        scan.sites.push(where);
        const verdict = judge(lines, i);
        if ("defect" in verdict) scan.findings.push(block(where, `"${primitive.trim()}" is a wall-clock wait: ${verdict.defect}`));
        else scan.covered.push({ where, annotation: verdict.ok, kind: verdict.kind });
      }
    }
  } catch (e) {
    scan.findings.push(block(GIT_WHERE, `the sleep scan failed (${(e as Error).message})`));
  }
  return scan;
}

/** Stdout of one git call in `repo`; throws on a non-zero exit. */
function gitOut(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
const reasonOf = (e: unknown): string => {
  const err = e as { stderr?: unknown; message?: string };
  return ((typeof err.stderr === "string" && err.stderr.trim()) || err.message || "unknown error").split("\n")[0]!;
};

/** W-178: the merge-base of HEAD with refs/heads/master, else with refs/remotes/origin/master. */
export function resolveTestBase(repo: string): { base: string } | { error: string } {
  try {
    const ref = MASTER_REFS.find((r) => {
      try {
        gitOut(repo, ["rev-parse", "--verify", "-q", `${r}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    });
    if (ref === undefined) return { error: `no ${MASTER_REFS.join(" or ")}; row counts not compared` };
    const bases = gitOut(repo, ["merge-base", "--all", "HEAD", ref]).trim().split("\n").filter(Boolean);
    if (bases.length !== 1) return { error: `${bases.length} merge-bases of HEAD and ${ref}; row counts not compared` };
    return { base: bases[0]! };
  } catch (e) {
    return { error: `base unresolved (${reasonOf(e)}); row counts not compared` };
  }
}

/** W-178: the records of `test/row-drops.yml` (text undefined: the file is absent). Pure; any malformed
 *  content, extra key, bad or exactly duplicated record is an error. */
export function readRowDrops(text: string | undefined): { drops: RowDrop[] } | { error: string } {
  if (text === undefined) return { drops: [] };
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    return { error: `malformed YAML (${reasonOf(e)})` };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc) || Object.keys(doc).join() !== "drops") return { error: 'the only top-level key is "drops"' };
  const list = (doc as { drops: unknown }).drops;
  if (!Array.isArray(list)) return { error: '"drops" is not a list' };
  const drops: RowDrop[] = [];
  for (const [i, rec] of list.entries()) {
    const at = `record ${i + 1}`;
    if (typeof rec !== "object" || rec === null || Array.isArray(rec) || Object.keys(rec).sort().join() !== "drop,opus,path,reason")
      return { error: `${at} must have exactly path, drop, opus and reason` };
    const { path, drop, opus, reason } = rec as Record<string, unknown>;
    if (typeof path !== "string" || path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return { error: `${at}: path must be repo-relative, without "..", "." or empty segments` };
    if (typeof drop !== "number" || !Number.isInteger(drop) || drop < 1) return { error: `${at}: drop must be an integer of at least 1` };
    if (typeof opus !== "string" || !/^W-\d+$/.test(opus)) return { error: `${at}: opus must be W-<digits>` };
    if (typeof reason !== "string" || reason.replace(/\s+/g, "").length < MIN_REASON_CHARS || reason.trim().split(/\s+/).length < MIN_REASON_WORDS)
      return { error: `${at}: reason too short (need ${MIN_REASON_CHARS} non-whitespace characters in at least ${MIN_REASON_WORDS} words)` };
    if (drops.some((d) => d.path === path && d.drop === drop && d.opus === opus && d.reason === reason)) return { error: `${at} repeats an earlier record` };
    drops.push({ path, drop, opus, reason });
  }
  return { drops };
}

type Candidate = { text: string } | { missing: true } | { error: string };
/** A working-tree file as the sleep scan reads it: regular, at most 1 MiB; a tracked file that is gone is `missing`. */
function readCandidate(repo: string, rel: string): Candidate {
  const abs = join(repo, rel);
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return { error: "tests are counted as regular files; track the target as a regular file" };
    if (!st.isFile()) return { error: "not counted: not a regular file" };
    if (st.size > MAX_BYTES) return { error: "not counted: over 1 MiB" };
    return { text: readFileSync(abs, "utf8") };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    return { error: `could not read (${(e as Error).message})` };
  }
}

/** W-178: `test.rows`, block. Each test file at the merge-base keeps its row count in the working tree. With a
 *  repo only; an unobservable base or file is a finding, never a silent pass. */
export function testRowFindings(repo: string): Finding[] {
  const resolved = resolveTestBase(repo);
  if ("error" in resolved) return [rowBlock(MERGE_BASE_WHERE, resolved.error)];
  const { base } = resolved;
  const findings: Finding[] = [];
  const dropped: { path: string; from: number; to: number }[] = [];
  try {
    const baseFiles = gitOut(repo, ["ls-tree", "-r", "--name-only", "-z", base]).split("\0").filter(Boolean);
    let baseRegistered = new Set<string>();
    if (baseFiles.includes(PACKAGE_JSON)) {
      try {
        baseRegistered = registeredPaths(gitOut(repo, ["show", `${base}:${PACKAGE_JSON}`]));
      } catch {
        return [rowBlock(PACKAGE_JSON, "could not read or parse package.json at the base; registered test paths unknown")];
      }
    }
    let registered = new Set<string>();
    const pkg = readCandidate(repo, PACKAGE_JSON);
    if ("error" in pkg) return [rowBlock(PACKAGE_JSON, `package.json ${pkg.error}; registered test paths unknown`)];
    if ("text" in pkg) {
      try {
        registered = registeredPaths(pkg.text);
      } catch {
        return [rowBlock(PACKAGE_JSON, "could not parse package.json; registered test paths unknown")];
      }
    }
    // the reason file, in the base and in the working tree
    let baseLedger: string | undefined;
    if (baseFiles.includes(ROW_DROPS)) {
      try {
        baseLedger = gitOut(repo, ["show", `${base}:${ROW_DROPS}`]);
      } catch (e) {
        return [rowBlock(ROW_DROPS, `could not read at the base (${reasonOf(e)})`)];
      }
    }
    const ledger = readCandidate(repo, ROW_DROPS);
    if ("error" in ledger) return [rowBlock(ROW_DROPS, ledger.error)];
    const before = readRowDrops(baseLedger);
    if ("error" in before) return [rowBlock(ROW_DROPS, `at the base: ${before.error}`)];
    const after = readRowDrops("text" in ledger ? ledger.text : undefined);
    if ("error" in after) return [rowBlock(ROW_DROPS, after.error)];
    const fresh = after.drops.filter((r) => !before.drops.some((b) => b.path === r.path && b.drop === r.drop && b.opus === r.opus && b.reason === r.reason));

    const candidate = new Set(gitOut(repo, ["ls-files", "-z"]).split("\0").filter((p) => p.length > 0 && isTestPath(p, registered)));

    for (const path of baseFiles.filter((p) => isTestPath(p, baseRegistered))) {
      let from: number;
      try {
        from = countTestRows(gitOut(repo, ["show", `${base}:${path}`]));
      } catch (e) {
        findings.push(rowBlock(path, `could not read at the base (${reasonOf(e)})`));
        continue;
      }
      let to = 0;
      if (candidate.has(path)) {
        const read = readCandidate(repo, path);
        if ("error" in read) {
          findings.push(rowBlock(path, read.error));
          continue;
        }
        if ("text" in read) to = countTestRows(read.text);
      }
      if (to < from) dropped.push({ path, from, to });
    }
    // each drop needs exactly one new record of exactly its size; each new record must match a drop
    for (const { path, from, to } of dropped) {
      const mine = fresh.filter((r) => r.path === path);
      const fell = `row count fell from ${from} to ${to}`;
      if (mine.length === 0) findings.push(rowBlock(path, `${fell}; add one record to ${ROW_DROPS} naming this path with drop ${from - to}`));
      else if (mine.length > 1) findings.push(rowBlock(path, `${fell}; ${mine.length} new records in ${ROW_DROPS} name this path, exactly one is allowed`));
      else if (mine[0]!.drop !== from - to) findings.push(rowBlock(path, `${fell}, but the new record in ${ROW_DROPS} drops ${mine[0]!.drop}; it must drop ${from - to}`));
    }
    for (const r of fresh) if (!dropped.some((d) => d.path === r.path)) findings.push(rowBlock(ROW_DROPS, `the new record for "${r.path}" matches no test file whose row count fell`));
  } catch (e) {
    findings.push(rowBlock(GIT_WHERE, `the row comparison failed (${reasonOf(e)})`));
  }
  return findings;
}

// ---- W-376: `test.one_sided`, block. A test of an output asserts the whole string, never one end of it.
const sidedBlock = (where: string, message: string): Finding => ({ rule: "test.one_sided", level: "block", where, message });
// the boundary before `assert`: no word character or `$` right before it, and no `.` before it past any spaces (a member call)
const MATCH_SITE = /(?<![\w$])(?<!\.\s*)assert\s*\.\s*match\s*\(/g;
const REGEX_LITERAL = /\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+)\/[a-z]*/y;
const REGEXP_CALL = /(?:new\s+)?RegExp\s*\(\s*(?:String\s*\.\s*raw\s*)?(["'`])((?:\\.|(?!\1)[^\\])*)\1/y;
const OK_SITE = /(?<![\w$])(?<!\.\s*)assert(?:\s*\.\s*ok)?\s*\(/g;
const ENDS_CALL = /\.\s*(startsWith|endsWith)\s*\(/;
const SIDED = /^\/\/\s*one-sided:\s*(\S.*)$/;
const SIDED_HOW = 'assert the whole string (assert.equal, or a pattern anchored at both ends), or annotate "// one-sided: <reason>"';

/** In string-blanked code, the index of the comma or closing bracket that ends the argument starting at `from`; -1
 *  when the line ends first. */
function argumentEnd(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const c = code[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/** A pattern source anchored at exactly one end; a `$` after a backslash is read as escaped. */
function sidedPattern(source: string): string | undefined {
  const start = source.startsWith("^");
  const end = /(?<!\\)\$$/.test(source);
  if (start === end) return undefined;
  return start ? "a pattern anchored at its start only" : "a pattern anchored at its end only";
}

/** The one-sided form an assertion on this line makes, from its string-blanked and plain code (same columns). */
function sidedForm(blank: string, plain: string): string | undefined {
  for (const m of blank.matchAll(MATCH_SITE)) {
    const comma = argumentEnd(blank, m.index + m[0].length);
    if (comma < 0 || blank[comma] !== ",") continue;
    let at = comma + 1;
    while (at < plain.length && /\s/.test(plain[at]!)) at++;
    REGEX_LITERAL.lastIndex = at;
    REGEXP_CALL.lastIndex = at;
    const literal = REGEX_LITERAL.exec(plain);
    const call = literal ? null : REGEXP_CALL.exec(plain);
    const form = literal ? sidedPattern(literal[1]!) : call ? sidedPattern(call[2]!) : undefined;
    if (form !== undefined) return form;
  }
  for (const m of blank.matchAll(OK_SITE)) {
    const from = m.index + m[0].length;
    const end = argumentEnd(blank, from);
    const call = ENDS_CALL.exec(blank.slice(from, end < 0 ? undefined : end));
    if (call) return `${call[1]} in an assertion`;
    // W-392: a pattern anchored at one end in the first argument (`/^x/.test(s)`, `new RegExp("^x").test(s)`)
    for (const source of patternsOn(blank.slice(from, end < 0 ? undefined : end), plain.slice(from, end < 0 ? undefined : end))) {
      const form = sidedPattern(source);
      if (form !== undefined) return form;
    }
  }
  return undefined;
}

// ---- W-392: the boundary form. W-381's title regexes bounded a token by an ASCII set, in a source file and outside any
// assertion, so W-376's forms never read them (studio/briefs/W-392.md). Every pattern on the line is read.
const BOUND_HOW = 'bound the token by a set holding \\p{L}, \\p{M} and \\p{N} (or \\p{ID_Continue}) under the u flag, or annotate "// one-sided: <reason>"';
const ASCII_B = "an ASCII word boundary (\\b)";
const ASCII_SET = "a word boundary over ASCII letters only";
const BUILT_SET = "a word boundary built from a substitution";
// a regex literal may open after one of these, or after a keyword; after a name, a `)` or a `]` a slash divides
const REGEX_AFTER = new RegExp(String.raw`(?:^|[(,=:[!&|?{};+\-*%<>~^]|(?<![\p{ID_Continue}$.])(?:return|typeof|case|of|in|void|yield|await|delete|throw|new|else|do))\s*$`, "u");
const REGEXP_SITE = new RegExp(String.raw`(?<![\p{ID_Continue}$.])(?:new\s+)?RegExp\s*\(`, "gu");
const PATTERN_ARG = /\s*(String\s*\.\s*raw\s*)?(["'`])((?:\\.|(?!\2)[^\\])*)\2/y;
const LOOKAROUND = /^\(\?(?:<[!=]|[!=])/;
const LETTER_PROP = /\\p\{(?:L|Letter)\}/;
const MARK_PROP = /\\p\{(?:M|Mark)\}/;
const NUMBER_PROP = /\\p\{(?:N|Number)\}/;
const IDENT_PROP = /\\p\{ID_Continue\}/;
const ASCII_LETTERS = /\\[wW]|\[[^\]]*[A-Za-z]-[A-Za-z]/;

/** The pattern sources on a line, from its string-blanked and plain code (same columns): each regex literal where an
 *  expression may open, and each literal first argument of `RegExp(` or `new RegExp(` (a string's `\\` read as `\`; a
 *  `String.raw` template as written). */
function patternsOn(blank: string, plain: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < blank.length; i++) {
    if (blank[i] !== "/" || !REGEX_AFTER.test(blank.slice(0, i))) continue;
    REGEX_LITERAL.lastIndex = i;
    const m = REGEX_LITERAL.exec(plain);
    if (m === null) continue;
    found.push(m[1]!);
    i += m[0].length - 1;
  }
  for (const m of blank.matchAll(REGEXP_SITE)) {
    PATTERN_ARG.lastIndex = m.index + m[0].length;
    const a = PATTERN_ARG.exec(plain);
    if (a !== null) found.push(a[1] === undefined ? a[3]!.replace(/\\\\/g, "\\") : a[3]!);
  }
  return found;
}

/** In a pattern source, the index of the `)` closing the group whose body opens at `from` (the source's length when
 *  none); escapes, classes and `${…}` substitutions are skipped. */
function groupEnd(source: string, from: number): number {
  let depth = 0;
  let cls = false;
  for (let i = from; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\") i++;
    else if (c === "$" && source[i + 1] === "{") {
      const close = source.indexOf("}", i);
      if (close < 0) return source.length;
      i = close;
    } else if (cls) {
      if (c === "]") cls = false;
    } else if (c === "[") cls = true;
    else if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return source.length;
}

/** A lookaround body's boundary form: undefined when it names no letter, or names the whole set (W-381 brief:75). */
function boundarySet(body: string): string | undefined {
  if (body.includes("${")) return BUILT_SET;
  const letters = LETTER_PROP.test(body);
  const ident = IDENT_PROP.test(body);
  if (!letters && !ident && !ASCII_LETTERS.test(body)) return undefined;
  if (ident || (letters && MARK_PROP.test(body) && NUMBER_PROP.test(body))) return undefined;
  if (!letters) return ASCII_SET;
  const missing = [MARK_PROP.test(body) ? "" : "\\p{M}", NUMBER_PROP.test(body) ? "" : "\\p{N}"].filter((s) => s !== "");
  return `a word boundary without ${missing.join(" and ")}`;
}

/** The first token boundary over part of the alphabet in a pattern source: `\b` or `\B` outside a class, or a
 *  lookaround whose body `boundarySet` judges. */
function boundaryForm(source: string): string | undefined {
  let cls = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\") {
      if (!cls && (source[i + 1] === "b" || source[i + 1] === "B")) return ASCII_B;
      i++;
    } else if (cls) {
      if (c === "]") cls = false;
    } else if (c === "[") cls = true;
    else if (c === "(" && LOOKAROUND.test(source.slice(i, i + 4))) {
      const open = i + (source[i + 2] === "<" ? 4 : 3);
      const form = boundarySet(source.slice(open, groupEnd(source, open)));
      if (form !== undefined) return form;
    }
  }
  return undefined;
}

/** W-392: the boundary form of a line's code (string-blanked and plain), or undefined. */
function boundaryOn(blank: string, plain: string): string | undefined {
  for (const source of patternsOn(blank, plain)) {
    const form = boundaryForm(source);
    if (form !== undefined) return form;
  }
  return undefined;
}
const isBoundaryForm = (form: string): boolean => form.includes("word boundary");

/** A `// one-sided: <reason>` comment on the line, or alone on the line above, with a reason of at least 15
 *  characters in 3 words. */
function sidedWaived(lines: Line[], idx: number): boolean {
  const prev = lines[idx - 1];
  const comments = [lines[idx]!.comment, prev !== undefined && prev.code.trim() === "" ? prev.comment : undefined];
  return comments.some((c) => {
    const reason = c === undefined ? undefined : SIDED.exec(c)?.[1]?.trim();
    return reason !== undefined && reason.replace(/\s+/g, "").length >= MIN_REASON_CHARS && reason.split(/\s+/).length >= MIN_REASON_WORDS;
  });
}

/** W-376: the one-sided assertions on `lines` (1-based) of a test file's text, each with its form; an annotated one
 *  is not listed. Pure. W-392: the boundary form is read on every line; with `test` false (a code file that is not a
 *  test path), only it. */
export function oneSidedSites(text: string, lines: readonly number[], test = true): { line: number; form: string }[] {
  const plain = lex(text);
  const blank = lex(text, { blankStrings: true });
  const sites: { line: number; form: string }[] = [];
  for (const n of lines) {
    const at = n >= 1 && n <= plain.length ? { blank: blank[n - 1]!.code, plain: plain[n - 1]!.code } : undefined;
    const form = at === undefined ? undefined : ((test ? sidedForm(at.blank, at.plain) : undefined) ?? boundaryOn(at.blank, at.plain));
    if (form !== undefined && !sidedWaived(plain, n - 1)) sites.push({ line: n, form });
  }
  return sites;
}

/** The lines of `rel` added or changed in the working tree since `base`, from `git diff --unified=0`'s hunk headers (raw text: --text and --no-textconv keep .gitattributes from hiding or rewriting them). */
function addedLines(repo: string, base: string, rel: string): number[] {
  const diff = gitOut(repo, ["diff", "--text", "--no-textconv", "--no-color", "--no-ext-diff", "--no-renames", "--unified=0", base, "--", `:(literal)${rel}`]);
  const lines: number[] = [];
  // W-334: a line number past 15 digits is past any 1 MiB file, so such a header adds nothing
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d{1,15})(?:,(\d{1,15}))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let k = 0; k < count; k++) lines.push(start + k);
  }
  return lines;
}

/** A tracked code file by W-121's extensions, outside node_modules (W-392: read for the boundary form). */
function isCodePath(path: string): boolean {
  const segs = path.split("/");
  const name = segs[segs.length - 1]!;
  return name.includes(".") && EXTENSIONS.has(name.slice(name.lastIndexOf("."))) && !segs.includes("node_modules");
}

/** W-376: `test.one_sided`, block. Each tracked test file changed since the merge-base (W-178's `resolveTestBase`):
 *  its added and changed lines' one-sided assertions; W-392: each other tracked code file's, the boundary form only. An unresolved base, an unparsable package.json and an unreadable
 *  test file are `test.rows`' and `test.sleep`'s findings, so this rule adds none for them. */
export function oneSidedFindings(repo: string): Finding[] {
  const resolved = resolveTestBase(repo);
  if ("error" in resolved) return [];
  const findings: Finding[] = [];
  try {
    let registered = new Set<string>();
    const pkg = readCandidate(repo, PACKAGE_JSON);
    if ("text" in pkg)
      try {
        registered = registeredPaths(pkg.text);
      } catch {
        // test.rows reports it
      }
    const changed = gitOut(repo, ["diff", "--name-only", "-z", "--no-renames", resolved.base]).split("\0");
    for (const rel of changed.filter((p) => p.length > 0 && isCodePath(p))) {
      const read = readCandidate(repo, rel);
      if (!("text" in read)) continue;
      const sites = oneSidedSites(read.text, addedLines(repo, resolved.base, rel), isTestPath(rel, registered));
      for (const s of sites) findings.push(sidedBlock(`${rel}:${s.line}`, `${s.form}: ${isBoundaryForm(s.form) ? BOUND_HOW : SIDED_HOW}`));
    }
  } catch (e) {
    findings.push(sidedBlock(GIT_WHERE, `the one-sided scan failed (${reasonOf(e)})`));
  }
  return findings;
}

export function checkTests(root: string, opts: RuleOpts): Finding[] {
  const findings = scanTests(root, opts).findings;
  return opts.repo ? [...findings, ...testRowFindings(opts.repo), ...oneSidedFindings(opts.repo)] : findings;
}
