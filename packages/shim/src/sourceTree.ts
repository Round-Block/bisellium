/**
 * @bisellium/shim — the SOURCE tree identity a probatio's `tree:` certifies.
 *
 * `git rev-parse <ref>^{tree}` is the wrong hash to certify against: it
 * covers the *whole* commit, including the officina's own bookkeeping
 * (opera front matter, ci logs, receipts) under the studio dir and
 * `.bisellium/`. That means (a) `bisellium verify` writing its own result
 * back into an opus and committing it changes the hash every later
 * `verify`/`check` compares against — a certificate goes stale just because
 * `verify` ran — and (b) a dirty tree caused only by that same bookkeeping
 * would wrongly refuse to certify at all.
 *
 * `sourceTreeHash` instead hashes `git ls-tree -r <ref>` with the studio
 * dir and `.bisellium/` excluded, so committing studio bookkeeping never
 * moves it; `isDirtyOutside` is the matching working-tree check, ignoring
 * uncommitted changes under those same paths.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const TIMEOUT_MS = 30_000;

function normalizeExclude(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isUnderExcluded(path: string, excludes: string[]): boolean {
  const p = path.replace(/^"|"$/g, "").replace(/\\/g, "/");
  return excludes.some((ex) => ex.length > 0 && (p === ex || p.startsWith(`${ex}/`)));
}

/**
 * sha1 over the lines of `git ls-tree -r <ref>` (mode, type, blob sha, path
 * — exactly what git prints, one line per entry, already path-sorted),
 * excluding any path under one of `excludeDirs` (repo-root-relative, e.g.
 * the studio dir and `.bisellium`). Deterministic for a given commit +
 * exclusion set, and unaffected by anything that only touches an excluded
 * path.
 */
export function sourceTreeHash(repo: string, excludeDirs: string[], ref = "HEAD"): string {
  const excludes = excludeDirs.map(normalizeExclude).filter((d) => d.length > 0);
  const out = execFileSync("git", ["ls-tree", "-r", ref], { cwd: repo, encoding: "utf8", timeout: TIMEOUT_MS });
  const hash = createHash("sha1");
  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    const path = tab === -1 ? "" : line.slice(tab + 1);
    if (isUnderExcluded(path, excludes)) continue;
    hash.update(line);
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * True when `git status --porcelain` in `repo` reports a change OUTSIDE
 * every path in `excludeDirs` (repo-root-relative). A rename/copy line's
 * "old -> new" is split into both paths — either one being outside an
 * exclusion counts.
 */
export function isDirtyOutside(repo: string, excludeDirs: string[]): boolean {
  const excludes = excludeDirs.map(normalizeExclude).filter((d) => d.length > 0);
  const out = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8", timeout: TIMEOUT_MS });
  const lines = out.split("\n").filter((l) => l.length > 0);
  return lines.some((line) => {
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    const paths = arrow === -1 ? [rest] : [rest.slice(0, arrow), rest.slice(arrow + 4)];
    return paths.some((p) => !isUnderExcluded(p, excludes));
  });
}
