/**
 * W-131 behaviours 5-7: the CI scope script and the workflow that uses it.
 * Rows are selected by name (`--test-name-pattern=W-131.behaviour.N:`), one
 * failing row per recorded red. The script is imported inside its row so a
 * missing file is an assertion failure, not a module-load failure.
 *
 * W-139 adds the `test:record` rows (`--test-name-pattern=W-139.behaviour.N:`).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "ci-scope.mjs");
const CI_YML = join(dirname(HERE), ".github", "workflows", "ci.yml");
const workflow = () => parseYaml(readFileSync(CI_YML, "utf8"));
const FULL = "steps.scope.outputs.record_only != 'true'";
const SHORT = "steps.scope.outputs.record_only == 'true'";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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

test("W-131 behaviour 6: ci.yml pushes only master and gates every full-path step on the scope", () => {
  const doc = workflow();
  assert.deepEqual(doc.on.push?.branches, ["master"], "push names only master");
  assert.notEqual(doc.on.pull_request, undefined, "pull_request still triggers");
  for (const job of ["gates", "web-e2e"]) {
    const steps = doc.jobs[job].steps;
    const scopeSteps = steps.filter((step) => step.id === "scope");
    assert.equal(scopeSteps.length, 1, `${job} has one id: scope step`);
    assert.match(
      scopeSteps[0].run,
      /^node scripts\/ci-scope\.mjs .*>> "?\$GITHUB_OUTPUT"?$/,
      `${job}'s scope step appends to $GITHUB_OUTPUT`,
    );
    assert.equal(
      scopeSteps[0].if,
      "github.event_name == 'pull_request'",
      `${job}'s scope step runs only on a pull request`,
    );
    for (const step of steps.filter(
      (s) => typeof s.run === "string" && s.id !== "scope" && s.run !== "npm ci" && s.if !== SHORT,
    ))
      assert.equal(step.if, FULL, `${job}: "${step.run}" carries the full-path guard`);
  }
  const short = doc.jobs.gates.steps.filter((step) => step.if === SHORT);
  assert.equal(short.length, 1, "gates has exactly one record-only step");
  assert.equal(short[0].run, "npm run -s check -- studio --repo .", "and it is the studio check");
  assert.equal(
    doc.jobs["web-e2e"].steps.filter((step) => step.if === SHORT).length,
    0,
    "web-e2e has no record-only step",
  );
});

test("W-131 behaviour 7: gates installs bubblewrap and lifts the userns restriction before npm test, with the live-row guard on", () => {
  const steps = workflow().jobs.gates.steps;
  const runs = steps.map((step) => step.run);
  const npmTest = runs.indexOf("npm test");
  assert.notEqual(npmTest, -1, "gates runs npm test");
  const bwrap = runs.findIndex(
    (run) => typeof run === "string" && run.includes("apt-get install") && run.includes("bubblewrap"),
  );
  assert.notEqual(bwrap, -1, "gates installs bubblewrap");
  const sysctl = runs.indexOf("sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
  assert.notEqual(sysctl, -1, "gates lifts the AppArmor userns restriction");
  assert.ok(bwrap < npmTest && sysctl < npmTest, "both run before npm test");
  assert.equal(steps[npmTest].env?.BISELLIUM_REQUIRE_LIVE_ROWS, "1", "npm test requires the live rows");
});

test("W-131 round 2 finding 2: a rename across the record-only boundary is not record-only", () => {
  const repo = mkdtempSync(join(tmpdir(), "w131-scope-rename-"));
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "fixture@example.invalid");
    git(repo, "config", "user.name", "Fixture");
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "docs"));
    const body = "the same line\n".repeat(20);
    writeFileSync(join(repo, "src", "a.ts"), body);
    writeFileSync(join(repo, "docs", "b.md"), body + "other\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "base");
    const base = git(repo, "rev-parse", "HEAD");
    mkdirSync(join(repo, "studio"));
    git(repo, "mv", "src/a.ts", "studio/a.ts");
    git(repo, "commit", "-qm", "source into studio");
    assert.equal(
      scope(repo, base, "HEAD").stdout,
      "record_only=false\n",
      "source renamed into studio/ is not record-only",
    );
    const second = git(repo, "rev-parse", "HEAD");
    git(repo, "mv", "docs/b.md", "docs/SESSION-HANDOFF.md");
    git(repo, "commit", "-qm", "doc onto the handoff");
    assert.equal(
      scope(repo, second, "HEAD").stdout,
      "record_only=false\n",
      "a doc renamed onto the handoff is not record-only",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("W-131 round 3 finding 2: a deleted source copied into studio/ and the handoff is not record-only", () => {
  const repo = mkdtempSync(join(tmpdir(), "w131-scope-copy-"));
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "fixture@example.invalid");
    git(repo, "config", "user.name", "Fixture");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "c.ts"), "the same line\n".repeat(20));
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "base");
    const base = git(repo, "rev-parse", "HEAD");
    const moved = readFileSync(join(repo, "src", "c.ts"), "utf8");
    git(repo, "rm", "-q", "src/c.ts");
    mkdirSync(join(repo, "studio"));
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "studio", "c.ts"), moved);
    writeFileSync(join(repo, "docs", "SESSION-HANDOFF.md"), moved);
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "source deleted, content materialized into both allowed places");
    const result = scope(repo, base, "HEAD");
    assert.equal(
      result.stdout,
      "record_only=false\n",
      "the deleted source path counts, so the diff is not record-only",
    );
    assert.equal(result.status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const REPO = dirname(HERE);
const pkgScripts = () => JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;
const andSplit = (script) => script.split("&&").map((command) => command.trim());

test("W-139 behaviour 1: test:record is a duplicate-free, cd-free subset of test:suite", () => {
  const scripts = pkgScripts();
  assert.equal(typeof scripts["test:record"], "string", "package.json has a test:record script");
  assert.notEqual(scripts["test:record"].trim(), "", "test:record is non-empty");
  const suite = andSplit(scripts["test:suite"]);
  const record = andSplit(scripts["test:record"]);
  for (const command of record) {
    assert.ok(suite.includes(command), `"${command}" is a verbatim member of test:suite`);
    assert.doesNotMatch(command, /\bcd\b|[()]/, `"${command}" has no cd and no parenthesis`);
  }
  assert.equal(new Set(record).size, record.length, "test:record has no duplicates");
});
