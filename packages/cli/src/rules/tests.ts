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
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, RuleOpts } from "../check.js";

export interface Covered {
  where: string;
  annotation: "seam" | "waiver";
  kind: string;
}
export interface TestScan {
  findings: Finding[];
  sites: string[];
  covered: Covered[];
}

const PACKAGE_JSON = "package.json";
const GIT_WHERE = "git ls-files";
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

interface Line {
  code: string;
  comment?: string;
}

/** One deterministic pass; see the file header. State across lines: inside a
 *  block comment, inside a template literal. A `'` or `"` string resets at the
 *  newline. Block-comment spans are blanked out of `code`; string and template
 *  contents stay in it. In a line that begins inside a template literal, a
 *  trimmed text beginning with a double slash is an embedded script's own
 *  comment line (that is where an annotation inside a fixture lives). */
export function lex(text: string): Line[] {
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
        code += c;
        if (c === "\\" && n !== undefined) {
          code += n;
          i++;
        } else if (quote !== "" ? c === quote : c === "`") {
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
  const registered = new Set<string>();
  const pkgPath = join(repo, PACKAGE_JSON);
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: unknown };
      const scripts = typeof pkg.scripts === "object" && pkg.scripts !== null ? (pkg.scripts as Record<string, unknown>) : {};
      for (const [key, value] of Object.entries(scripts)) {
        if (!key.startsWith("test") || typeof value !== "string") continue;
        for (const token of value.split(/\s+/)) registered.add(token.replace(/^\.\//, ""));
      }
    } catch {
      findings.push(block(PACKAGE_JSON, "could not parse package.json; registered test paths unknown"));
    }
  }

  return tracked.filter((p) => {
    const segs = p.split("/");
    const name = segs[segs.length - 1]!;
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
    if (!EXTENSIONS.has(ext) || segs.includes("node_modules")) return false;
    return TEST_NAME.test(name) || segs.slice(0, -1).some((s) => TEST_DIRS.has(s)) || registered.has(p);
  });
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

export function checkTests(root: string, opts: RuleOpts): Finding[] {
  return scanTests(root, opts).findings;
}
