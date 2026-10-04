/**
 * W-131 behaviours 5-7: the CI scope script and the workflow that uses it.
 * Rows are selected by name (`--test-name-pattern=W-131.behaviour.N:`), one
 * failing row per recorded red. The script is imported inside its row so a
 * missing file is an assertion failure, not a module-load failure.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "ci-scope.mjs");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const scope = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });

test("W-131 behaviour 5: recordOnly is true only for studio/ and the handoff, and the CLI fails closed", async () => {
  const mod = await import("./ci-scope.mjs").catch(() => ({}));
  assert.equal(typeof mod.recordOnly, "function", "scripts/ci-scope.mjs exports recordOnly");
  for (const paths of [["studio/opera/W-131.md"], ["docs/SESSION-HANDOFF.md"], ["studio/a", "docs/SESSION-HANDOFF.md"]])
    assert.equal(mod.recordOnly(paths), true, `${paths.join(",")} is record-only`);
  for (const paths of [[], ["studiox/a"], ["docs/ADOPTION.md"], ["studio/a", "packages/x.ts"]])
    assert.equal(mod.recordOnly(paths), false, `${JSON.stringify(paths)} is not record-only`);

  const repo = mkdtempSync(join(tmpdir(), "w131-scope-"));
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "fixture@example.invalid");
    git(repo, "config", "user.name", "Fixture");
    writeFileSync(join(repo, "a.txt"), "a\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "base");
    const base = git(repo, "rev-parse", "HEAD");
    mkdirSync(join(repo, "studio"));
    writeFileSync(join(repo, "studio", "n.md"), "n\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "record");
    const only = scope(repo, base, "HEAD");
    assert.equal(only.stdout, "record_only=true\n");
    assert.equal(only.status, 0);
    writeFileSync(join(repo, "a.txt"), "b\n");
    git(repo, "commit", "-qam", "source");
    assert.equal(scope(repo, base, "HEAD").stdout, "record_only=false\n");
    const unknown = scope(repo, "no-such-ref", "HEAD");
    assert.equal(unknown.stdout, "record_only=false\n", "an unknown base ref fails closed");
    assert.equal(unknown.status, 0, "and still exits 0");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
