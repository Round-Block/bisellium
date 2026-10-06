/**
 * W-152 row b6 (studio/briefs/W-152.md): `docs.dossier.shrink`. node:test TAP,
 * selected by `--test-name-pattern=W-152-b6`. Every case builds its own
 * throwaway git repo under the OS tmp dir; nothing in studio/ or examples/.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkStudio, type Finding } from "../check.js";
import { initStudio } from "../init.js";

const NOW = new Date("2026-10-06T12:00:00Z");
const MARKER = "<!-- dossier-shrink-ok: rewrite -->";
const BODY = "docs/design/dossier/body.html";
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();
const sized = (n: number, head = ""): string => head + "x".repeat(n - head.length);
const put = (repo: string, rel: string, text: string): void => {
  mkdirSync(join(repo, rel, ".."), { recursive: true });
  writeFileSync(join(repo, rel), text);
};

/** A repo with a 70 000-byte body.html and a progress-body.html committed;
 *  `origin/master` points at that commit unless `origin` is false. The
 *  officina lives in `studio/`. Returns the base's short oid too. */
function fixture(opts: { baseBody?: string; origin?: boolean } = {}): { repo: string; officina: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), "bisellium-w152-b6-"));
  dirs.push(repo);
  git(repo, "init", "-q", "-b", "master");
  const officina = join(repo, "studio");
  assert.ok(initStudio(officina, { now: NOW }).root);
  put(repo, BODY, opts.baseBody ?? sized(70_000));
  put(repo, "docs/design/dossier/progress-body.html", sized(5_000));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  if (opts.origin !== false) git(repo, "update-ref", "refs/remotes/origin/master", "HEAD");
  git(repo, "checkout", "-q", "-b", "feature");
  return { repo, officina, base: git(repo, "rev-parse", "--short", "HEAD") };
}

const shrink = (officina: string, repo: string): Finding[] =>
  checkStudio(officina, NOW, { repo }).findings.filter((f) => f.rule === "docs.dossier.shrink");

test("W-152-b6 behaviour 6: a dossier source that loses more than half its bytes fails check", () => {
  const cut = fixture();
  put(cut.repo, BODY, sized(2_400));
  const found = shrink(cut.officina, cut.repo);
  assert.equal(found.length, 1, "one docs.dossier.shrink finding");
  assert.equal(found[0]?.level, "block");
  assert.equal(found[0]?.where, BODY);
  assert.match(found[0]?.message ?? "", /70000/);
  assert.match(found[0]?.message ?? "", /2400/);
  assert.ok((found[0]?.message ?? "").includes(cut.base), "the message names the base's short oid");

  const sixty = fixture();
  put(sixty.repo, BODY, sized(42_000));
  assert.deepEqual(shrink(sixty.officina, sixty.repo), [], "a cut to 60% yields nothing");

  const gone = fixture();
  unlinkSync(join(gone.repo, BODY));
  assert.deepEqual(shrink(gone.officina, gone.repo), [], "a deleted source yields nothing");

  const fresh = fixture();
  put(fresh.repo, "docs/design/dossier/status-body.html", sized(100));
  assert.deepEqual(shrink(fresh.officina, fresh.repo), [], "a new source yields nothing");

  const marked = fixture();
  put(marked.repo, BODY, sized(2_400, MARKER));
  assert.deepEqual(shrink(marked.officina, marked.repo), [], "the marker excuses the cut");

  const inBase = fixture({ baseBody: sized(70_000, MARKER) });
  put(inBase.repo, BODY, sized(2_400, MARKER));
  assert.equal(shrink(inBase.officina, inBase.repo).length, 1, "a marker already in the baseline does not excuse the cut");

  const noRemote = fixture({ origin: false });
  put(noRemote.repo, BODY, sized(2_400));
  assert.equal(shrink(noRemote.officina, noRemote.repo).length, 1, "with no origin/master an uncommitted cut is measured against HEAD");
});
