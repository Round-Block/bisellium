/**
 * One-time Revision 7 bootstrap for the already-building W-096 branch.
 *
 * This is intentionally narrower than `bisellium branch`: it neither creates
 * nor switches branches.  It proves that the existing historical branch is
 * the exceptional branch described by the brief, then writes its fixed
 * reviewed branch point through the same guarded front-matter writer.
 * Tests may set BISELLIUM_W096_BOOTSTRAP_EXPECTED_BASE to a temporary
 * repository's branch point.  That test-only override is otherwise inert;
 * production keeps the fixed reviewed commit below.
 */
import { spawnSync } from "node:child_process";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontMatter } from "@bisellium/adapter-native";
import { editOpusFrontMatter } from "@bisellium/commands/frontmatter.js";
import {
  readContainedRegularFile,
  recordWith,
  validateProtectedRecords,
  type NativeRecord,
} from "@bisellium/commands/opus-model.js";

export const W096_BOOTSTRAP_BASELINE = "0935d518d576f5e1cf81079d631b8b10a5d76742";
const EXPECTED_BASELINE = process.env["BISELLIUM_W096_BOOTSTRAP_EXPECTED_BASE"] ?? W096_BOOTSTRAP_BASELINE;
const RECORD_REL = "studio/opera/W-096.md";
const EXPECTED_UNPINNED_HISTORY_PROBLEM = "baseline_commit has no verifiable first introduction in record history";

export interface BootstrapResult {
  ok: boolean;
  error?: string;
}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

function git(repo: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: 30_000 });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function gitFailure(result: GitResult, fallback: string): string {
  return result.stderr.trim() || fallback;
}

/**
 * Validate every prerequisite before the guarded writer is entered.  A false
 * result therefore always leaves the W-096 record byte-identical.
 */
export function bootstrapW096Baseline(repoArg: string, studioArg: string): BootstrapResult {
  const repo = resolve(repoArg);
  const studio = resolve(studioArg);
  if (relative(repo, studio).split(sep).join("/") !== "studio")
    return { ok: false, error: "W-096 bootstrap requires the real studio at <repo>/studio" };

  const branch = git(repo, ["branch", "--show-current"]);
  if (branch.status !== 0) return { ok: false, error: gitFailure(branch, "could not determine the owning branch") };
  if (branch.stdout.trim() !== "opus/W-096")
    return { ok: false, error: "W-096 bootstrap requires the owning branch opus/W-096" };

  const clean = git(repo, ["status", "--porcelain", "--untracked-files=normal"]);
  if (clean.status !== 0) return { ok: false, error: gitFailure(clean, "could not determine checkout cleanliness") };
  if (clean.stdout !== "") return { ok: false, error: "W-096 bootstrap requires a clean checkout" };

  const recordPath = resolve(studio, "opera", "W-096.md");
  let record: NativeRecord;
  try {
    const contained = readContainedRegularFile(studio, "opera/W-096.md", "opera");
    if ("error" in contained)
      return { ok: false, error: `could not safely read the real W-096 record: ${contained.error}` };
    const data: unknown = parseFrontMatter<unknown>(contained.bytes.toString("utf8"), recordPath).data;
    if (data === null || typeof data !== "object" || Array.isArray(data))
      return { ok: false, error: "studio/opera/W-096.md does not contain a record mapping" };
    record = data as NativeRecord;
  } catch (error) {
    return { ok: false, error: `could not read the real W-096 record: ${(error as Error).message}` };
  }
  if (record.id !== "W-096") return { ok: false, error: "studio/opera/W-096.md is not the real W-096 record" };
  if (record["baseline_commit"] !== undefined)
    return { ok: false, error: "W-096 baseline_commit is already present and immutable" };

  const shallow = git(repo, ["rev-parse", "--is-shallow-repository"]);
  if (shallow.status !== 0 || shallow.stdout.trim() !== "false")
    return { ok: false, error: gitFailure(shallow, "W-096 record history is unavailable or incomplete") };

  const history = git(repo, ["log", "--format=%H", "HEAD", "--", RECORD_REL]);
  const commits = history.stdout.trim().split("\n").filter(Boolean);
  if (history.status !== 0 || commits.length === 0)
    return { ok: false, error: gitFailure(history, "W-096 record history is unavailable") };
  for (const commit of commits) {
    const historical = git(repo, ["show", `${commit}:${RECORD_REL}`]);
    if (historical.status !== 0)
      return { ok: false, error: gitFailure(historical, `W-096 record history is unavailable at ${commit}`) };
    let historicalRecord: NativeRecord;
    try {
      const data: unknown = parseFrontMatter<unknown>(historical.stdout, `${commit}:${RECORD_REL}`).data;
      if (data === null || typeof data !== "object" || Array.isArray(data))
        return { ok: false, error: `W-096 record history is not a mapping at ${commit}` };
      historicalRecord = data as NativeRecord;
    } catch (error) {
      return { ok: false, error: `W-096 record history is unreadable at ${commit}: ${(error as Error).message}` };
    }
    if (historicalRecord["baseline_commit"] !== undefined)
      return { ok: false, error: `W-096 baseline_commit was already introduced at ${commit}` };
  }

  for (const ref of [`${EXPECTED_BASELINE}^{commit}`, "HEAD^{commit}", "origin/master^{commit}"]) {
    const exists = git(repo, ["cat-file", "-e", ref]);
    if (exists.status !== 0)
      return { ok: false, error: gitFailure(exists, `required history or ref ${ref} is unavailable`) };
  }

  const mergeBase = git(repo, ["merge-base", "--all", "HEAD", "origin/master"]);
  const bases = mergeBase.stdout.trim().split("\n").filter(Boolean);
  if (mergeBase.status !== 0)
    return { ok: false, error: gitFailure(mergeBase, "could not resolve the W-096 merge-base") };
  if (bases.length !== 1 || bases[0] !== EXPECTED_BASELINE)
    return {
      ok: false,
      error: `W-096 bootstrap requires the unique merge-base ${EXPECTED_BASELINE} (got ${bases.join(", ") || "none"})`,
    };

  for (const ref of ["HEAD", "origin/master"]) {
    const ancestor = git(repo, ["merge-base", "--is-ancestor", EXPECTED_BASELINE, ref]);
    if (ancestor.status !== 0) return { ok: false, error: `${EXPECTED_BASELINE} is not a verified ancestor of ${ref}` };
  }

  // validateProtectedRecords is the ordinary check/verify policy seam.  The
  // synthetic pin lets it compare the fixed baseline against both HEAD and
  // the working tree before any write.  The one expected history diagnostic
  // is precisely what this bootstrap is authorized to repair; all other
  // diagnostics remain blocking.
  const preservation = validateProtectedRecords(
    repo,
    studio,
    recordWith(record, { baseline_commit: EXPECTED_BASELINE }),
  );
  if (preservation.problems.length !== 1 || preservation.problems[0] !== EXPECTED_UNPINNED_HISTORY_PROBLEM) {
    return {
      ok: false,
      error: `protected-record comparison failed: ${preservation.problems.join("; ") || "expected an unpinned history"}`,
    };
  }

  try {
    editOpusFrontMatter(recordPath, (doc) => {
      doc.set("baseline_commit", EXPECTED_BASELINE);
      return undefined;
    });
  } catch (error) {
    return { ok: false, error: `could not write W-096 baseline_commit: ${(error as Error).message}` };
  }
  return { ok: true };
}

function parseArgs(args: string[]): { repo: string; studio: string } | { error: string } {
  let repo = process.cwd();
  let studio: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== "--repo" && arg !== "--studio") return { error: `unknown argument: ${arg ?? ""}` };
    const value = args[++i];
    if (value === undefined) return { error: `${arg} requires a value` };
    if (arg === "--repo") repo = value;
    else studio = value;
  }
  return { repo, studio: studio ?? resolve(repo, "studio") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exitCode = 2;
  } else {
    const result = bootstrapW096Baseline(parsed.repo, parsed.studio);
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
    } else {
      console.log(`baseline_commit=${EXPECTED_BASELINE}`);
    }
  }
}
