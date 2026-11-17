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
 *
 * W-673: it also leaves out every path `recordOnly` (scripts/ci-scope.mjs, the one record-path list: the handoff and the
 * dossier pages) takes as a record outside the officina, so a handoff-only or dossier-only commit moves no certificate.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { recordOnly } from "../../../scripts/ci-scope.mjs";

const TIMEOUT_MS = 30_000;

export function normalizeExclude(dir: string): string {
  let d = dir.replaceAll("\\", "/");
  if (d.startsWith("./")) d = d.slice(2);
  let end = d.length;
  while (end > 0 && d.charCodeAt(end - 1) === 47 /* "/" */) end -= 1;
  return d.slice(0, end);
}

function isUnderExcluded(path: string, excludes: string[]): boolean {
  const p = path.replace(/^"|"$/g, "").replace(/\\/g, "/");
  return excludes.some((ex) => ex.length > 0 && (p === ex || p.startsWith(`${ex}/`)));
}

/**
 * W-673: a record outside every officina, as `recordOnly` reads one path. Its officina clause is `${studio}/`-prefixed;
 * with "" that is "/", which no repo-relative `ls-tree` path opens with, so only its record paths (the handoff, a
 * dossier page) match and the officina stays the caller's exclusion. The path is as `ls-tree` prints it: a name git
 * quotes is not unquoted, the same in the host runner's copy (scripts/run-builder-host.mjs).
 */
const isRecordPath = (path: string): boolean => recordOnly([path], "");

/**
 * sha1 over the lines of `git ls-tree -r <ref>` (mode, type, blob sha, path
 * — exactly what git prints, one line per entry, already path-sorted),
 * excluding any path under one of `excludeDirs` (repo-root-relative, e.g.
 * the studio dir and `.bisellium`) and, W-673, every record path
 * (`isRecordPath`). Deterministic for a given commit + exclusion set, and
 * unaffected by anything that only touches an excluded path or a record.
 */
export function sourceTreeHash(repo: string, excludeDirs: string[], ref = "HEAD"): string {
  const excludes = excludeDirs.map(normalizeExclude).filter((d) => d.length > 0);
  const out = execFileSync("git", ["ls-tree", "-r", ref], { cwd: repo, encoding: "utf8", timeout: TIMEOUT_MS });
  const hash = createHash("sha1");
  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    const path = tab === -1 ? "" : line.slice(tab + 1);
    if (isUnderExcluded(path, excludes) || isRecordPath(path)) continue;
    hash.update(line);
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * W-382: the paths the served screens are built from and captured against: the web app and its server (`apps/`), the
 * fixture officina every served spec copies (`examples/sample-studio/`) and the root package files that pin the
 * bundle's dependencies. `examples/` is outside the SOURCE tree, so a fixture change moves this hash and not `tree:`.
 */
export const SERVED_UI_PATHS: readonly string[] = ["apps", "examples/sample-studio", "package.json", "package-lock.json"];

/**
 * W-382: `sha256:` over the lines of `git ls-tree -r --full-tree <ref> -- <SERVED_UI_PATHS>` (mode, type, blob sha,
 * path, path-sorted, as git prints them): the served UI at a commit. Any change under those paths moves it, and no
 * change elsewhere does. Throws when git cannot read `ref`.
 */
export function servedUiHash(repo: string, ref = "HEAD"): string {
  const out = execFileSync("git", ["ls-tree", "-r", "--full-tree", ref, "--", ...SERVED_UI_PATHS], { cwd: repo, encoding: "utf8", timeout: TIMEOUT_MS });
  return `sha256:${createHash("sha256").update(out).digest("hex")}`;
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
