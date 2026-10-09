/**
 * W-131: is a diff record-only (officina bookkeeping and the handoff)? CI
 * uses the answer to take the short path on a pull request and, W-203, on a
 * merge group (classified against the group's base).
 *
 *   node scripts/ci-scope.mjs <base> <head>   prints record_only=true|false
 *
 * Always exits 0; a git failure prints record_only=false, so the failure
 * falls back to the full run.
 *
 * W-139: `node scripts/ci-scope.mjs --check-reads <log>` compares the log
 * scripts/record-reads.mjs wrote during a full `npm test` to `test:record`,
 * and fails the run (exit 1) when the list is not exact. It fails closed: an
 * absent log is a failure, the opposite of the scope mode.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function recordOnly(paths) {
  return paths.length > 0 && paths.every((path) => path.startsWith("studio/") || path === "docs/SESSION-HANDOFF.md");
}

/** W-203: true only when `git diff <base>...<head>` succeeds and recordOnly accepts its paths; any git failure is false. */
export function scopeOf(base, head) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return recordOnly(out.split("\n").filter(Boolean));
  } catch {
    return false;
  }
}

/**
 * The problems with `log` against `commands`, sorted; none means exact. The log
 * is lines `<owner>\t<path>` between a root process's `#start\t<id>\troot` and
 * `#end\t<id>` (scripts/record-reads.mjs), so an empty, owner-only, truncated or
 * unterminated log is a problem, not a pass. A non-root start with no end is
 * tolerated: a child killed by a signal never runs its exit handler, and what it
 * read was logged as it read.
 */
export function checkReads(log, commands) {
  const problems = [];
  if (commands.length === 0) problems.push("no commands");
  if (log === "") problems.push("empty log");
  else if (!log.endsWith("\n")) problems.push("unterminated log: no final newline");
  const firstRead = new Map();
  const started = new Set();
  const ended = new Set();
  const roots = [];
  for (const line of log.split("\n").filter(Boolean)) {
    const [owner = "", rel, extra] = line.split("\t");
    if (owner === "#start" && rel && (extra === undefined || extra === "root")) {
      started.add(rel);
      if (extra === "root") roots.push(rel);
    } else if (owner === "#end" && rel && extra === undefined) ended.add(rel);
    else if (owner === "#fail" && rel && extra === undefined) problems.push(`failed: ${rel}`);
    else if (owner.startsWith("#") || !owner || !rel || extra !== undefined) problems.push(`malformed: ${line}`);
    else if (owner === "?") problems.push(`unattributed: ${rel}`);
    else if (!firstRead.has(owner)) firstRead.set(owner, rel);
  }
  if (log !== "" && roots.length !== 1) problems.push(`${roots.length} root processes, expected 1`);
  for (const id of roots) if (!ended.has(id)) problems.push(`unterminated root: ${id}`);
  for (const id of ended) if (!started.has(id)) problems.push(`orphan end: ${id}`);
  const tokens = new Set(commands.flatMap((command) => command.split(/\s+/)));
  for (const [owner, rel] of firstRead) if (!tokens.has(owner)) problems.push(`unlisted: ${owner} (read ${rel})`);
  for (const command of commands)
    if (!command.split(/\s+/).some((token) => firstRead.has(token))) problems.push(`unread: ${command}`);
  return [...new Set(problems)].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv[2] === "--check-reads") {
  const path = process.argv[3] ?? "";
  let log;
  try {
    log = readFileSync(path, "utf8");
  } catch {}
  const record = JSON.parse(
    readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "package.json"), "utf8"),
  );
  const problems =
    log === undefined
      ? [`missing: ${path}`]
      : checkReads(
          log,
          (record.scripts?.["test:record"] ?? "")
            .split("&&")
            .map((command) => command.trim())
            .filter(Boolean),
        );
  if (existsSync(`${path}.fail`)) problems.push(`failed: ${path}.fail exists`);
  for (const problem of problems) console.log(problem);
  if (problems.length > 0) process.exit(1);
  console.log("record_reads=ok");
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [base, head] = process.argv.slice(2);
  console.log(`record_only=${scopeOf(base, head)}`);
}
