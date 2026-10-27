/**
 * packages/cli/src/review-notice.ts — W-418: a PR whose diff touches a code-owned path names those paths, requests
 * the code owners' review, and leaves a notice for the main session, which the guard (guard.ts) hands it once, so the
 * session pushes it to the Patron's phone. Node built-ins and the shared containment helper only (W-423: `ids.js`, itself
 * node built-ins only): the guard imports `takeNotices`, and a hook loads nothing heavy.
 *
 * The screen reads the owners file GitHub reads at the base ref (master), the first of `.github/CODEOWNERS`,
 * `CODEOWNERS` and `docs/CODEOWNERS` it holds, and the diff's paths (`git diff --name-only --no-renames --no-relative
 * -z <base>...<head>`, so both sides of a rename, each from the top). A pattern is matched as GitHub reads a plain one:
 * a leading or inner `/` anchors it at the root, a trailing `/` matches a directory only, a bare name matches that name
 * at any depth; the last matching line names the owners, and a line with none leaves the path unowned. A line this
 * screen does not read (a glob, an escape, a negation, a `#` inside the pattern, a control or non-ASCII space, an empty,
 * `.` or `..` segment) fails the screen, so a path it would own never passes as unowned.
 *
 * `gh` and `git` are spawned by bare name through PATH with argument arrays, never a shell; each step fails closed into
 * a hold that names `resume`, and the steps after it are not run.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ensureRealDirectory, existingRealDirectory } from "@bisellium/commands/ids.js";

/** The owners files GitHub reads for a PR, in the order it looks: the first the base ref holds is the one it uses. */
export const OWNERS_FILES = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"] as const;
/** A PR number as the verb and the notice store take it. */
export const PR_NUMBER = /^[1-9][0-9]{0,8}$/;
/** A PR number as the notice store takes it, written (openPr reads up to 15 digits) and read (takeNotices) alike. */
export const NOTICE_PR = /^[1-9][0-9]{0,14}$/;
const NOTICE_MAX = 4096;
/** A notice line is cut whole to this many characters (at most 1500 bytes), so the guard's 4096-byte bound always admits it. */
const NOTICE_LINE = 500;
const SHOWN = 5;
const GH_MAX_BYTES = 1_048_576;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}
function run(cmd: "git" | "gh", args: string[], cwd: string, timeout = 120_000): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error === undefined ? {} : { error: r.error }) };
}
/** Control characters (C0 and C1, newline included) become one space: a path, a title or a reply is data. */
const strip = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");
const failed = (r: Run): string => (r.error !== undefined ? strip(r.error.message) : strip(r.stderr.trim().split("\n")[0] ?? "").slice(0, 200)) || `exit ${r.status}`;

export interface Screen {
  /** The diff's code-owned paths, sorted. */
  paths: string[];
  /** The owners the last matching line of each code-owned path names, sorted. */
  owners: string[];
  /** The owners file read at the base ref; undefined when it holds none of OWNERS_FILES. */
  file: string | undefined;
}
interface Rule {
  anchored: boolean;
  dir: boolean;
  core: string;
  owners: string[];
}

/** A character no plain pattern holds: a glob (`*`, `?`, `[`), an escape, a `#`, a control, format or space character. */
const UNREAD = /[*?[\\#\p{Cc}\p{Cf}\p{Z}]/u;

/** The rules of an owners file's text, and the lines it does not read (`line <n> is not a plain pattern: <pattern>`).
 *  Pure. A `#` at the start of a line or after a space or tab opens a comment; words split at spaces and tabs, and the
 *  first is the pattern. */
export function readOwners(text: string): { rules: Rule[]; unread: string[] } {
  const rules: Rule[] = [];
  const unread: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const words = line
      .replace(/(^|[ \t])#[\s\S]*$/, "$1")
      .split(/[ \t]+/)
      .filter((w) => w !== "");
    const pattern = words[0];
    if (pattern === undefined) return;
    const core = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (pattern.startsWith("!") || UNREAD.test(pattern) || core.split("/").some((s) => s === "" || s === "." || s === "..")) {
      unread.push(`line ${i + 1} is not a plain pattern: ${strip(pattern)}`);
      return;
    }
    rules.push({ anchored: pattern.startsWith("/") || core.includes("/"), dir: pattern.endsWith("/"), core, owners: words.slice(1) });
  });
  return { rules, unread };
}

function matches(r: Rule, path: string): boolean {
  if (r.anchored) return (!r.dir && path === r.core) || path.startsWith(`${r.core}/`);
  const parts = path.split("/");
  return parts.some((part, k) => part === r.core && (!r.dir || k < parts.length - 1));
}

/** The code-owned paths among `paths` under an owners file's text and their owners, or the lines it does not read: any
 *  such line fails the screen, since a path it owns would otherwise pass as unowned. Pure. */
export function codeOwned(text: string, paths: readonly string[]): { paths: string[]; owners: string[] } | { unread: string[] } {
  const { rules, unread } = readOwners(text);
  if (unread.length > 0) return { unread };
  const owned = new Set<string>();
  const owners = new Set<string>();
  for (const path of paths) {
    const last = rules.filter((r) => matches(r, path)).at(-1);
    if (last === undefined || last.owners.length === 0) continue;
    owned.add(path);
    for (const o of last.owners) owners.add(o);
  }
  return { paths: [...owned].sort(), owners: [...owners].sort() };
}

/** The screen of `<base>...<head>` in the checkout at `cwd`: the owners file GitHub reads at `base`, then the diff's paths. */
export function screenDiff(cwd: string, base: string, head: string): Screen | { error: string } {
  const tree = run("git", ["ls-tree", "--full-tree", "-z", base, "--", ...OWNERS_FILES], cwd);
  if (tree.error !== undefined || tree.status !== 0) return { error: `git ls-tree ${base} -- ${OWNERS_FILES.join(" ")} failed (${failed(tree)})` };
  const entries = new Map(tree.stdout.split("\0").flatMap((e) => (e.includes("\t") ? [[e.slice(e.indexOf("\t") + 1), e.slice(0, e.indexOf("\t"))] as const] : [])));
  const file = OWNERS_FILES.find((f) => entries.has(f));
  if (file === undefined) return { paths: [], owners: [], file: undefined };
  const blob = /^100(?:644|755) blob ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(entries.get(file) ?? "");
  if (blob === null) return { error: `${file} at ${base} is not a regular file` };
  const text = run("git", ["cat-file", "blob", blob[1]!], cwd);
  if (text.error !== undefined || text.status !== 0) return { error: `git cat-file blob ${file} failed (${failed(text)})` };
  const diff = run("git", ["diff", "--name-only", "--no-renames", "--no-relative", "--ignore-submodules=none", "--no-ext-diff", "-z", `${base}...${head}`, "--"], cwd);
  if (diff.error !== undefined || diff.status !== 0) return { error: `git diff ${base}...${head} failed (${failed(diff)})` };
  const owned = codeOwned(text.stdout, diff.stdout.split("\0").filter((p) => p !== ""));
  if ("unread" in owned) return { error: `${file} ${owned.unread[0]}${owned.unread.length > 1 ? ` (and ${owned.unread.length - 1} more)` : ""}` };
  return { ...owned, file };
}

/** The notice's one line: the PR's number, its title (at most 120 characters) and up to five code-owned paths, cut whole
 *  to NOTICE_LINE characters. */
export function noticeText(pr: number, title: string, paths: readonly string[]): string {
  const more = paths.length > SHOWN ? ` and ${paths.length - SHOWN} more` : "";
  return strip(`PR #${pr} needs your review: ${strip(title).trim().slice(0, 120)} (code-owned: ${paths.slice(0, SHOWN).join(", ")}${more})`).slice(0, NOTICE_LINE);
}

/** The absolute Git common directory of the checkout at `cwd`. */
function commonDir(cwd: string, timeout?: number): { path: string } | { error: string } {
  const r = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, timeout);
  const dir = r.stdout.trim();
  if (r.error !== undefined || r.status !== 0 || dir === "" || !isAbsolute(dir)) return { error: failed(r) };
  return { path: dir };
}
/** W-423: the store's levels below the Git common directory, each a real directory the shared containment helper makes
 *  (`ensureRealDirectory`) or proves (`existingRealDirectory`): a symlinked level would send a write or a delete out. */
const NOTICE_LEVELS = ["bisellium", "notice"] as const;

/** Leaves the notice for PR `pr` at `<git common dir>/bisellium/notice/<pr>` (one line, written whole by a rename),
 *  replacing an older one for the same PR. Undefined when written, else why not. */
export function writeNotice(cwd: string, pr: number, text: string): string | undefined {
  const common = commonDir(cwd);
  if ("error" in common) return `git rev-parse --git-common-dir failed (${common.error})`;
  if (!NOTICE_PR.test(String(pr))) return `${pr} is not a PR number the notice store takes`;
  try {
    const dir = ensureRealDirectory(common.path, ...NOTICE_LEVELS);
    const temp = join(dir, `.${pr}.${process.pid}`);
    writeFileSync(temp, `${text}\n`);
    renameSync(temp, join(dir, String(pr)));
    return undefined;
  } catch (e) {
    return strip(e instanceof Error ? e.message : String(e));
  }
}

/** The guard's read (W-418): every notice under the Git common directory of the checkout at `cwd`, in PR order, each
 *  removed as it is taken, so a notice is handed over once. Fail-open: an entry that is not a PR number, not a regular
 *  file (a symlink included), over 4 KiB, or cannot be read or removed is left and not handed; a `cwd` outside a checkout has none. */
export function takeNotices(cwd: string): string[] {
  const common = commonDir(cwd, 1000);
  if ("error" in common) return [];
  let dir: string | undefined;
  let names: string[];
  try {
    dir = existingRealDirectory(common.path, ...NOTICE_LEVELS);
    if (dir === undefined) return [];
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names.filter((n) => NOTICE_PR.test(n)).sort((a, b) => Number(a) - Number(b))) {
    const path = join(dir, name);
    try {
      const st = lstatSync(path);
      if (!st.isFile() || st.size > NOTICE_MAX) continue;
      const text = strip(readFileSync(path, "utf8")).trim();
      unlinkSync(path);
      if (text !== "") out.push(text);
    } catch {
      /* fail open: the entry stays */
    }
  }
  return out;
}

/** An owner `gh pr edit --add-reviewer` takes: `@<login>` or `@<org>/<team>`, without the `@`. */
const REVIEWER = /^@([A-Za-z0-9-]+(?:\/[A-Za-z0-9_.-]+)?)$/;

function readTitle(cwd: string, slug: string, pr: number): string | { error: string } {
  const r = run("gh", ["pr", "view", String(pr), "-R", slug, "--json", "title"], cwd);
  if (r.error !== undefined || r.status !== 0) return { error: `gh pr view failed (${failed(r)})` };
  if (r.stdout.length > GH_MAX_BYTES) return { error: "gh pr view output is over 1 MiB" };
  let v: unknown;
  try {
    v = JSON.parse(r.stdout);
  } catch {
    return { error: "gh pr view returned non-JSON output" };
  }
  const title = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>)["title"] : undefined;
  return typeof title === "string" ? title : { error: "gh pr view returned no string title" };
}

export interface NoticeInput {
  /** A checkout of the repository (the opus worktree, or the main checkout). */
  cwd: string;
  slug: string;
  pr: number;
  /** The ref the owners file is read at and the diff is taken from: master. */
  base: string;
  head: string;
  /** The command that redoes these steps after a hold. */
  resume: string;
}

/** W-418: the code-owned paths of PR `pr`'s diff, its notice and its review request, as printed lines. In order: the
 *  screen, the title (read from GitHub), the notice, then the request; the first that fails holds, naming `resume`. */
export function reviewNotice(o: NoticeInput): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const hold = (why: string): { ok: boolean; lines: string[] } => ({ ok: false, lines: [...lines, `why: ${why}`, `run: ${o.resume}`] });
  const screen = screenDiff(o.cwd, o.base, o.head);
  if ("error" in screen) return hold(`PR #${o.pr}'s code-owned paths could not be screened (${screen.error})`);
  if (screen.paths.length === 0) return { ok: true, lines: [`code-owned: none${screen.file === undefined ? ` (no .github/CODEOWNERS, CODEOWNERS or docs/CODEOWNERS at ${o.base})` : ""}`] };
  lines.push(...screen.paths.map((p) => `code-owned: ${strip(p)}`));
  const title = readTitle(o.cwd, o.slug, o.pr);
  if (typeof title !== "string") return hold(`PR #${o.pr} touches code-owned paths, but its title could not be read (${title.error})`);
  const text = noticeText(o.pr, title, screen.paths);
  const written = writeNotice(o.cwd, o.pr, text);
  if (written !== undefined) return hold(`PR #${o.pr} touches code-owned paths, but its notice could not be written (${written})`);
  lines.push(`notice: ${text}`);
  const requested = screen.owners.flatMap((owner) => REVIEWER.exec(owner)?.[1] ?? []);
  const skipped = screen.owners.filter((owner) => !REVIEWER.test(owner)).map((owner) => `review-request: skipped ${strip(owner)} (not an @login or @org/team)`);
  if (requested.length > 0) {
    const r = run("gh", ["pr", "edit", String(o.pr), "-R", o.slug, "--add-reviewer", requested.join(",")], o.cwd);
    if (r.error !== undefined || r.status !== 0) return hold(`PR #${o.pr} touches code-owned paths, but the review request failed (${failed(r)})`);
  }
  return { ok: true, lines: [...lines, `review-requested: ${requested.length > 0 ? requested.join(", ") : "none"}`, ...skipped] };
}
