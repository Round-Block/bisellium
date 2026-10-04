/**
 * W-131: is a diff record-only (officina bookkeeping and the handoff)? CI
 * uses the answer to take the short path on a pull request.
 *
 *   node scripts/ci-scope.mjs <base> <head>   prints record_only=true|false
 *
 * Always exits 0; a git failure prints record_only=false, so the failure
 * falls back to the full run.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function recordOnly(paths) {
  return paths.length > 0 && paths.every((path) => path.startsWith("studio/") || path === "docs/SESSION-HANDOFF.md");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [base, head] = process.argv.slice(2);
  let only = false;
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    only = recordOnly(out.split("\n").filter(Boolean));
  } catch {}
  console.log(`record_only=${only}`);
}
