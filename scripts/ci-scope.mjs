/**
 * W-131: is a diff record-only (officina bookkeeping and the handoff)? CI
 * uses the answer to take the short path on a pull request.
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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function recordOnly(paths) {
  return paths.length > 0 && paths.every((path) => path.startsWith("studio/") || path === "docs/SESSION-HANDOFF.md");
}

/** The problems with `log` (lines `<owner>\t<path>`) against `commands`, sorted; none means exact. */
export function checkReads(log, commands) {
  const problems = [];
  const firstRead = new Map();
  for (const line of log.split("\n").filter(Boolean)) {
    const [owner = "?", rel = ""] = line.split("\t");
    if (owner === "?") problems.push(`unattributed: ${rel}`);
    else if (!firstRead.has(owner)) firstRead.set(owner, rel);
  }
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
          record.scripts["test:record"].split("&&").map((command) => command.trim()),
        );
  for (const problem of problems) console.log(problem);
  if (problems.length > 0) process.exit(1);
  console.log("record_reads=ok");
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [base, head] = process.argv.slice(2);
  let only = false;
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    only = recordOnly(out.split("\n").filter(Boolean));
  } catch {}
  console.log(`record_only=${only}`);
}
