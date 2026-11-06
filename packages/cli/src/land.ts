/**
 * packages/cli/src/land.ts — W-509: `bisellium land <path>...`, the verb that carries named records to master: a new opus
 * record and its Queue line, a master verify's logs, a handoff refresh, a decision. It runs from the main checkout on
 * master and cuts its commit through a temporary index, so it never switches the checkout, never writes the working
 * tree or the real index before the merge, and leaves every other edit where it is. The head is
 * `records/land-<hash of the paths and their contents>`: the same paths with the same contents are the same head, so
 * running the same command again resumes. Exit 0 once the records are on the local master, 1 at a refusal or a hold,
 * 2 on a usage error.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { openStudio, parseFlags } from "@bisellium/commands/writes.js";
import { clean, git, quoted, readRef, type Ctx } from "./integrate.js";
import { performLanding } from "./next.js";

export const LAND_USAGE = "usage: bisellium land <path>... --title <text> --sella <id> [--body-file <path>] [--past-check <reason>] [--poll-ms <n>] [--max-polls <n>] [--studio <dir>] [--repo <dir>] [--now <iso>]";

const TRUNK = "refs/heads/master";

interface Tree {
  tree: string;
  /** The paths this tree changes against HEAD, sorted. */
  changed: string[];
  /** One `<mode> <type> <oid>\t<path>` entry per changed path the tree still holds. */
  entries: string[];
}

/** The tree HEAD would have with `paths` as the working tree holds them, built in a temporary index; the real index is not read or written. */
function buildTree(repo: string, paths: readonly string[]): Tree | string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-land-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, "index") };
    const run = (args: string[]): { ok: boolean; out: string; why: string } => {
      const r = spawnSync("git", args, { cwd: repo, env, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
      return { ok: r.status === 0 && r.error === undefined, out: r.stdout ?? "", why: clean(r.error?.message ?? (r.stderr ?? "").trim().split("\n")[0] ?? "") || `exit ${r.status}` };
    };
    const read = run(["read-tree", "HEAD"]);
    if (!read.ok) return `git read-tree HEAD failed: ${read.why}`;
    const added = run(["update-index", "--add", "--remove", "--", ...paths]);
    if (!added.ok) return `could not read a named path (each must be a file, or a tracked file that was deleted): ${added.why}`;
    const written = run(["write-tree"]);
    if (!written.ok) return `git write-tree failed: ${written.why}`;
    const tree = written.out.trim();
    const diff = run(["diff-tree", "-r", "--no-renames", "--name-only", "-z", "HEAD", tree]);
    if (!diff.ok) return `git diff-tree failed: ${diff.why}`;
    const changed = diff.out.split("\0").filter((p) => p !== "").sort();
    const listed = changed.length === 0 ? { ok: true, out: "", why: "" } : run(["ls-tree", "-z", tree, "--", ...changed]);
    if (!listed.ok) return `git ls-tree failed: ${listed.why}`;
    return { tree, changed, entries: listed.out.split("\0").filter((e) => e !== "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}




export async function runLand(argv: string[]): Promise<{ exitCode: number }> {
  const usage = (why: string): { exitCode: number } => {
    console.error(`land: ${why}\n${LAND_USAGE}`);
    return { exitCode: 2 };
  };
  const parsed = parseFlags(argv, { valued: ["--title", "--sella", "--body-file", "--past-check", "--poll-ms", "--max-polls", "--studio", "--repo", "--now"] });
  if ("error" in parsed) return usage(parsed.error);
  const { values, positionals } = parsed;
  const paths = [...new Set(positionals)];
  if (paths.length === 0) return usage("name at least one path, relative to the repository's top");
  const oneLine = (flag: string): string | undefined => {
    const v = values.get(flag);
    return v !== undefined && v.trim() !== "" && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : undefined;
  };
  const title = oneLine("--title");
  if (title === undefined) return usage("--title is required: one line of text");
  const sella = oneLine("--sella");
  if (sella === undefined || !/^[a-z][a-z0-9-]*$/.test(sella)) return usage("--sella is required: a sella id");
  const past = oneLine("--past-check");
  if (values.has("--past-check") && past === undefined) return usage("--past-check needs a reason: one line of text");
  const intIn = (flag: string, lo: number, hi: number, dflt: number): number | undefined => {
    const v = values.get(flag);
    if (v === undefined) return dflt;
    return /^[0-9]{1,6}$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : undefined;
  };
  const pollMs = intIn("--poll-ms", 1, 60_000, 20_000);
  const maxPolls = intIn("--max-polls", 1, 1000, 60);
  if (pollMs === undefined || maxPolls === undefined) return usage("--poll-ms takes 1 through 60000 and --max-polls 1 through 1000");
  const repo = resolve(values.get("--repo") ?? ".");
  const body = values.get("--body-file");
  let bodyFile: string | undefined;
  if (body !== undefined) {
    try {
      bodyFile = realpathSync(resolve(body));
      const inside = (root: string): boolean => {
        const rel = relative(realpathSync(root), bodyFile!);
        return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      };
      const st = statSync(bodyFile);
      if (!st.isFile() || st.size > 65_536) return usage("--body-file must be a regular file of at most 64 KiB");
      if (!inside(repo) && !inside(tmpdir())) return usage("--body-file must lie under the repository or the temp directory");
    } catch {
      return usage("--body-file is not readable");
    }
  }
  const gd = git(repo, ["rev-parse", "--git-dir"]);
  const cd = git(repo, ["rev-parse", "--git-common-dir"]);
  if (gd.status !== 0 || cd.status !== 0) return usage(`${repo} is not a git repository`);
  const opened = openStudio(values.get("--studio") ?? join(repo, "studio"));
  if ("error" in opened) return usage(opened.error);
  const studioRel = relative(realpathSync(repo), realpathSync(opened.root)).split("\\").join("/");
  if (studioRel === "" || studioRel.startsWith("..")) return usage("--studio must be a folder inside the repository");
  const known = (opened.manifest as { sellae?: { id?: unknown }[] }).sellae?.some((s) => s.id === sella) === true;
  if (!known) return usage(`--sella ${sella} is not a sella of ${studioRel}/bisellium.yml`);

  const say = (code: number, name: string, lines: string[]): { exitCode: number } => {
    console.log([`land: ${name}`, ...lines].map((l) => clean(l, 1000)).join("\n"));
    return { exitCode: code };
  };
  const refuse = (...lines: string[]): { exitCode: number } => say(1, "refused", lines);

  const built = buildTree(repo, paths);
  if (typeof built === "string") return refuse(`why: ${built}; nothing committed or pushed`);
  if (built.changed.length === 0) return refuse(`why: nothing to land: every named path matches HEAD`);
  const head = `records/land-${createHash("sha256").update(JSON.stringify([built.changed, built.entries])).digest("hex").slice(0, 12)}`;
  const ref = `refs/heads/${head}`;
  const command = `bisellium land ${argv.map((a) => quoted(a)).join(" ")}`;

  const tip = readRef(repo, ref);
  if (tip.kind === "error") return say(1, head, [`why: ${tip.reason}`]);
  let commit = tip.kind === "tip" ? tip.oid : undefined;
  if (commit === undefined) {
    const trailer = `Co-Authored-By: ${sella} (bisellium land) <noreply@anthropic.com>`;
    const made = git(repo, ["commit-tree", built.tree, "-p", "HEAD", "-m", title, ...(bodyFile === undefined ? [] : ["-F", bodyFile]), ...(past === undefined ? [] : ["-m", `Past check: ${past}`]), "-m", trailer]);
    if (made.status !== 0 || made.error !== undefined) return say(1, head, [`why: could not commit the records: ${clean(made.stderr.trim().split("\n")[0] ?? "")}`]);
    commit = made.stdout.trim();
  }
  if (tip.kind !== "tip") {
    const created = git(repo, ["update-ref", ref, commit, ""]);
    if (created.status !== 0 || created.error !== undefined) return say(1, head, [`why: could not create ${head}: ${clean(created.stderr.trim().split("\n")[0] ?? "")}`]);
  }

  const ctx: Ctx = {
    repo,
    id: head.slice("records/".length),
    head,
    wt: repo,
    excludes: [],
    pollMs,
    maxPolls,
    log: (line) => console.log(clean(line, 1000)),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    own: built.changed,
  };
  const result = await performLanding({ repo, studioRel }, ctx, head);
  return say(result.ok ? 0 : 1, `${head} ${result.ok ? "landed" : "held"}`, [`carries: ${built.changed.map((p) => clean(p)).join(", ")}`, ...result.lines]);
}
