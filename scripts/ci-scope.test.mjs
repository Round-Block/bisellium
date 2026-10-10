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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "ci-scope.mjs");
const CI_YML = join(dirname(HERE), ".github", "workflows", "ci.yml");
const workflow = () => parseYaml(readFileSync(CI_YML, "utf8"));
const FULL = "steps.scope.outputs.record_only != 'true'";
const SHORT = "steps.scope.outputs.record_only == 'true'";
/** W-205: the full-path steps that also skip on a pull request. */
const NOT_PR = "github.event_name != 'pull_request'";
const DEFERRED = `${NOT_PR} && ${FULL}`;
const MERGE_GROUP = "github.event_name == 'merge_group'";

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
    assert.equal(scopeSteps[0].if, MERGE_GROUP, `${job}'s scope step runs on a merge group`);
    for (const step of steps.filter(
      (s) => typeof s.run === "string" && s.id !== "scope" && s.run !== "npm ci" && s.if !== SHORT,
    ))
      assert.equal(
        step.if,
        ["npm run -s typecheck", "npm run -s lint"].includes(step.run) ? FULL : DEFERRED,
        `${job}: "${step.run}" carries the full-path guard`,
      );
  }
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
const line = (owner, rel) => `${owner}\t${rel}\n`;
/** A well-formed log: the root process started, its reads, the root ended. */
const complete = (...rows) => `#start\tp1\troot\n${rows.join("")}#end\tp1\n`;
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

test("W-139 behaviour 2: gates' record-only steps are the studio check then test:record, and web-e2e has none", () => {
  const doc = workflow();
  assert.deepEqual(
    doc.jobs.gates.steps.filter((step) => step.if === SHORT).map((step) => step.run),
    ["npm run -s check -- studio --repo .", "npm run -s test:record"],
    "gates' record-only steps, in order",
  );
  assert.equal(
    doc.jobs["web-e2e"].steps.filter((step) => step.if === SHORT).length,
    0,
    "web-e2e has no record-only step",
  );
});

test("W-139 behaviour 3: the preload records reads of the record-only set, nothing else, and stays invisible", () => {
  const preload = join(HERE, "record-reads.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "w139-probe-"));
  try {
    const probe = join(tmp, "probe.test.mjs");
    const child = `require("node:fs").existsSync(${JSON.stringify(join(REPO, "studio", "w139-child"))})`;
    writeFileSync(
      probe,
      [
        `import { existsSync, readFileSync, realpathSync } from "node:fs";`,
        `import { readFile } from "node:fs/promises";`,
        `import { spawnSync } from "node:child_process";`,
        `existsSync(${JSON.stringify(join(REPO, "studio", "w139-probe-absent"))});`,
        `await readFile(${JSON.stringify(join(REPO, "docs", "SESSION-HANDOFF.md"))});`,
        `readFileSync(${JSON.stringify(join(REPO, "docs", "ADOPTION.md"))});`,
        `existsSync(${JSON.stringify(join(tmp, "studio", "x"))});`,
        `spawnSync(process.execPath, ["-e", ${JSON.stringify(child)}], { cwd: ${JSON.stringify(tmp)}, stdio: "ignore" });`,
        `console.log(typeof realpathSync.native);`,
      ].join("\n"),
    );
    const log = join(tmp, "reads.log");
    const run = (extra) => {
      const env = { ...process.env, NODE_OPTIONS: `--import ${preload}`, ...extra };
      delete env.BISELLIUM_RECORD_OWNER;
      if (!extra.BISELLIUM_RECORD_READS) delete env.BISELLIUM_RECORD_READS;
      return spawnSync(process.execPath, [probe], { cwd: tmp, env, encoding: "utf8" });
    };
    const owner = relative(REPO, probe).split("\\").join("/");
    const printed = run({ BISELLIUM_RECORD_READS: log });
    const lines = existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\n")
          .filter((entry) => entry && !entry.startsWith("#"))
          .sort()
      : [];
    assert.deepEqual(
      lines,
      [`${owner}\tdocs/SESSION-HANDOFF.md`, `${owner}\tstudio/w139-child`, `${owner}\tstudio/w139-probe-absent`],
      "exactly the three in-set reads, each owned by the probe",
    );
    assert.equal(printed.stdout.trim(), "function", "realpathSync.native survives the wrappers");
    rmSync(log, { force: true });
    run({});
    assert.equal(existsSync(log), false, "without BISELLIUM_RECORD_READS the preload writes no log");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("W-139 behaviour 4: checkReads names unattributed, unlisted and unread, and the CLI fails closed", async () => {
  const mod = await import("./ci-scope.mjs").catch(() => ({}));
  assert.equal(typeof mod.checkReads, "function", "scripts/ci-scope.mjs exports checkReads");
  const commands = ["node a.test.mjs .", "node --import tsx b/c.test.ts"];
  const exact = [line("a.test.mjs", "studio/x"), line("b/c.test.ts", "docs/SESSION-HANDOFF.md")];
  assert.deepEqual(mod.checkReads(complete(...exact), commands), [], "an exact log has no problems");
  assert.deepEqual(mod.checkReads(complete(...exact, line("?", "studio/y")), commands), ["unattributed: studio/y"]);
  assert.deepEqual(
    mod.checkReads(complete(...exact, line("d.test.mjs", "studio/z"), line("d.test.mjs", "studio/w")), commands),
    ["unlisted: d.test.mjs (read studio/z)"],
  );
  assert.deepEqual(mod.checkReads(complete(line("a.test.mjs", "studio/x")), commands), [
    "unread: node --import tsx b/c.test.ts",
  ]);

  const record = andSplit(pkgScripts()["test:record"] ?? "");
  const owners = record.map((command) => command.split(/\s+/).find((token) => /\.test\.[cm]?[jt]s$/.test(token)));
  const dir = mkdtempSync(join(tmpdir(), "w139-check-"));
  try {
    const log = join(dir, "reads.log");
    const run = (path) => scope(dir, "--check-reads", path);
    const absent = run(log);
    assert.equal(absent.stdout, `missing: ${log}\n`, "an absent log is named");
    assert.equal(absent.status, 1, "and fails closed");
    writeFileSync(log, complete(...owners.map((owner) => line(owner, "studio/x"))));
    const ok = run(log);
    assert.equal(ok.stdout, "record_reads=ok\n");
    assert.equal(ok.status, 0);
    writeFileSync(log, complete(...owners.map((owner) => line(owner, "studio/x")), line("?", "studio/y")));
    const bad = run(log);
    assert.equal(bad.stdout, "unattributed: studio/y\n");
    assert.equal(bad.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W-139 behaviour 5: gates' npm test records reads and the guard step right after it checks them", () => {
  const steps = workflow().jobs.gates.steps;
  const npmTest = steps.findIndex((step) => step.run === "npm test");
  assert.notEqual(npmTest, -1, "gates runs npm test");
  assert.deepEqual(
    steps[npmTest]?.env,
    {
      BISELLIUM_REQUIRE_LIVE_ROWS: "1",
      NODE_OPTIONS: "--import ${{ github.workspace }}/scripts/record-reads.mjs",
      BISELLIUM_RECORD_READS: "${{ runner.temp }}/record-reads.log",
    },
    "npm test's env holds the two recording keys beside the live-row guard",
  );
  const guard = "node scripts/ci-scope.mjs --check-reads ${{ runner.temp }}/record-reads.log";
  assert.equal(steps[npmTest + 1]?.run, guard, "the step right after npm test is the guard");
  assert.equal(steps[npmTest + 1]?.if, DEFERRED, "and it runs on the full path, off the pull request");
  const parity = join(HERE, "ci-workflow.test.mjs");
  assert.ok(readFileSync(parity, "utf8").includes(guard), "ci-workflow.test.mjs names the guard step");
  assert.equal(spawnSync(process.execPath, [parity], { encoding: "utf8" }).status, 0, "and still passes");
});

test("W-139 round 1 finding 1: the guard rejects a log with no completion evidence", async () => {
  const mod = await import("./ci-scope.mjs").catch(() => ({}));
  assert.equal(typeof mod.checkReads, "function", "scripts/ci-scope.mjs exports checkReads");
  const commands = ["node a.test.mjs"];
  const read = line("a.test.mjs", "studio/x");
  for (const [name, log] of [
    ["an empty log", ""],
    ["owner lines with no markers", read],
    ["a log with no final newline", complete(read).slice(0, -1)],
    ["a root that never ended", `#start\tp1\troot\n${read}`],
    ["a tail-truncated end marker", `#start\tp1\troot\n${read}#end\tp1`],
    ["a run with no root", `#start\tp1\n${read}#end\tp1\n`],
    ["two roots", `${complete(read)}#start\tp2\troot\n#end\tp2\n`],
    ["an end with no start", `${complete(read)}#end\tp9\n`],
    ["a process that failed to write", `${complete(read)}#fail\tp2\n`],
    ["a malformed line", `${complete(read)}garbage\n`],
  ])
    assert.notDeepEqual(mod.checkReads(log, commands), [], `${name} is a problem`);
  assert.deepEqual(mod.checkReads(complete(read), commands), [], "a rooted, ended log passes");
  assert.deepEqual(
    mod.checkReads(complete(`#start\tp2\n`, read), commands),
    [],
    "a non-root process killed before its exit handler ran is not a problem",
  );
  const dir = mkdtempSync(join(tmpdir(), "w139-integrity-"));
  try {
    const path = join(dir, "reads.log");
    const owners = andSplit(pkgScripts()["test:record"] ?? "").map((command) =>
      command.split(/\s+/).find((token) => /\.test\.[cm]?[jt]s$/.test(token)),
    );
    writeFileSync(path, owners.map((owner) => line(owner, "studio/x")).join(""));
    const bare = scope(dir, "--check-reads", path);
    assert.equal(bare.status, 1, "the CLI fails an owners-only log");
    writeFileSync(path, "");
    assert.equal(scope(dir, "--check-reads", path).status, 1, "and an empty one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W-139 round 1 finding 1: the preload ends its log and is loud when it cannot write", async () => {
  const preload = join(HERE, "record-reads.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "w139-writer-"));
  try {
    const probe = join(tmp, "probe.test.mjs");
    const studioRead = `existsSync(${JSON.stringify(join(REPO, "studio", "w139-probe-absent"))});`;
    writeFileSync(
      probe,
      [
        `import { chmodSync, existsSync } from "node:fs";`,
        `if (process.env.W139_CHMOD) chmodSync(process.env.BISELLIUM_RECORD_READS, 0o444);`,
        studioRead,
        `import { spawnSync } from "node:child_process";`,
        `spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });`,
      ].join("\n"),
    );
    const run = (log, extra = {}) => {
      const env = { ...process.env, NODE_OPTIONS: `--import ${preload}`, BISELLIUM_RECORD_READS: log, ...extra };
      delete env.BISELLIUM_RECORD_OWNER;
      delete env.BISELLIUM_RECORD_ROOT;
      return spawnSync(process.execPath, [probe], { cwd: tmp, env, encoding: "utf8" });
    };
    const owner = relative(REPO, probe).split("\\").join("/");
    const good = join(tmp, "good.log");
    assert.equal(run(good).status, 0, "a writable log is silent and exits 0");
    const text = existsSync(good) ? readFileSync(good, "utf8") : "";
    assert.match(text, /^#start\t([^\t\n]+)\troot\n[^]*#end\t\1\n$/, "the log opens and closes the root process");
    assert.equal(text.split("\troot\n").length - 1, 1, "and a child it spawns is not a second root");
    const { checkReads } = await import("./ci-scope.mjs");
    assert.deepEqual(checkReads(text, [`node ${owner}`]), [], "and the guard accepts it");

    const locked = join(tmp, "locked.log");
    const refused = run(locked, { W139_CHMOD: "1" });
    assert.notEqual(refused.status, 0, "an append the process cannot write makes it exit non-zero");
    assert.match(refused.stderr, /record-reads/, "and says why on stderr");
    assert.notDeepEqual(
      checkReads(existsSync(locked) ? readFileSync(locked, "utf8") : "", [`node ${owner}`]),
      [],
      "and the half-written log fails the guard",
    );

    const dirLog = join(tmp, "dir.log");
    mkdirSync(dirLog);
    assert.notEqual(run(dirLog).status, 0, "a log path that cannot be written at all exits non-zero");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("W-139 round 2 finding 1: a process that cannot record a read never makes it, and the guard fails on <log>.fail", () => {
  const preload = join(HERE, "record-reads.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "w139-record-first-"));
  try {
    const target = join(REPO, "studio", "bisellium.yml");
    const child = `console.log("read-happened", require("node:fs").existsSync(${JSON.stringify(target)}));`;
    const probe = join(tmp, "probe.test.mjs");
    writeFileSync(
      probe,
      [
        `import { chmodSync } from "node:fs";`,
        `import { spawnSync } from "node:child_process";`,
        `chmodSync(process.env.BISELLIUM_RECORD_READS, 0o444);`,
        `const r = spawnSync(process.execPath, ["-e", ${JSON.stringify(child)}], { encoding: "utf8" });`,
        `console.log(JSON.stringify({ status: r.status, signal: r.signal, out: r.stdout, err: r.stderr }));`,
      ].join("\n"),
    );
    const log = join(tmp, "reads.log");
    const env = { ...process.env, NODE_OPTIONS: `--import ${preload}`, BISELLIUM_RECORD_READS: log };
    delete env.BISELLIUM_RECORD_OWNER;
    delete env.BISELLIUM_RECORD_ROOT;
    const ran = spawnSync(process.execPath, [probe], { cwd: tmp, env, encoding: "utf8" });
    const result = JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "{}");
    assert.equal(result.out, "", "the child's read never happened: its call did not return");
    assert.ok(result.signal === "SIGABRT" || result.status !== 0, "the child died before the read");
    assert.match(result.err, /record-reads/, "and said why on stderr");
    assert.equal(existsSync(`${log}.fail`), true, "it left the sibling <log>.fail marker");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("W-139 round 2 finding 1: the guard CLI fails when <log>.fail exists beside an otherwise exact log", () => {
  const dir = mkdtempSync(join(tmpdir(), "w139-failmark-"));
  try {
    const path = join(dir, "reads.log");
    const owners = andSplit(pkgScripts()["test:record"] ?? "").map((command) =>
      command.split(/\s+/).find((token) => /\.test\.[cm]?[jt]s$/.test(token)),
    );
    writeFileSync(path, complete(...owners.map((owner) => line(owner, "studio/x"))));
    assert.equal(scope(dir, "--check-reads", path).stdout, "record_reads=ok\n", "the exact log passes alone");
    writeFileSync(`${path}.fail`, "p2\n");
    const marked = scope(dir, "--check-reads", path);
    assert.equal(marked.status, 1, "a <log>.fail marker fails the guard");
    assert.match(marked.stdout, /failed: .*reads\.log\.fail/, "and names it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("W-203-b1 behaviour 1: merge groups classify against their base", async () => {
  const mod = await import("./ci-scope.mjs").catch(() => ({}));
  const doc = workflow();
  assert.deepEqual(Object.keys(doc.on).sort(), ["merge_group", "pull_request", "push"], "the trigger set");
  assert.deepEqual(doc.on.push?.branches, ["master"], "push names only master");
  for (const job of ["gates", "web-e2e"]) {
    const scopeSteps = doc.jobs[job].steps.filter((step) => step.id === "scope");
    assert.equal(scopeSteps.length, 1, `${job} has one id: scope step`);
    assert.equal(scopeSteps[0].if, MERGE_GROUP, `${job}'s scope step runs on a merge group`);
    assert.deepEqual(
      scopeSteps[0].env,
      { BASE_SHA: "${{ github.event.merge_group.base_sha }}" },
      `${job}'s scope step takes the merge group's base`,
    );
    assert.equal(
      scopeSteps[0].run,
      'node scripts/ci-scope.mjs "$BASE_SHA" HEAD >> "$GITHUB_OUTPUT"',
      `${job}'s scope step classifies against $BASE_SHA`,
    );
  }
  for (const job of ["officina", "certify"]) {
    assert.ok(!JSON.stringify(doc.jobs[job].if ?? "").includes("steps.scope"), `${job} has no scope condition`);
    for (const step of doc.jobs[job].steps) {
      assert.notEqual(step.id, "scope", `${job} has no id: scope step`);
      assert.ok(!JSON.stringify(step.if ?? "").includes("steps.scope"), `${job} reads no scope output`);
    }
  }
  assert.equal(typeof mod.scopeOf, "function", "scripts/ci-scope.mjs exports scopeOf");

  const repo = mkdtempSync(join(tmpdir(), "w203-scope-"));
  try {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "fixture@example.invalid");
    git(repo, "config", "user.name", "Fixture");
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "a.txt"), "a\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "base");
    const base = git(repo, "rev-parse", "HEAD");
    mkdirSync(join(repo, "studio"));
    writeFileSync(join(repo, "studio", "n.md"), "n\n");
    writeFileSync(join(repo, "docs", "SESSION-HANDOFF.md"), "h\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "group one: records only");
    const first = scope(repo, base, "HEAD");
    assert.equal(first.stdout, "record_only=true\n", "a records-only group commit is record-only against its base");
    assert.equal(first.status, 0);
    const groupOne = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "a.txt"), "b\n");
    git(repo, "commit", "-qam", "group two: one source path");
    const mixed = scope(repo, base, "HEAD");
    assert.equal(
      mixed.stdout,
      "record_only=false\n",
      "records then source against the earlier base is not record-only",
    );
    assert.equal(mixed.status, 0);
    assert.equal(
      scope(repo, groupOne, "HEAD").stdout,
      "record_only=false\n",
      "the source commit alone is not record-only",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("W-205-b1 behaviour 1: a pull request runs setup, typecheck and lint; merge-group and push steps are today's", () => {
  const doc = workflow();
  assert.deepEqual(Object.keys(doc.on).sort(), ["merge_group", "pull_request", "push"], "the trigger set");
  assert.deepEqual(doc.on.push?.branches, ["master"], "push names only master");
  assert.deepEqual(doc.on.merge_group?.types, ["checks_requested"], "merge_group on checks_requested");
  assert.deepEqual(Object.keys(doc.jobs), ["gates", "officina", "web-e2e", "certify"], "the four required jobs");
  for (const [name, job] of Object.entries(doc.jobs)) {
    assert.equal(job.if, name === "certify" ? MERGE_GROUP : undefined, `${name}'s job-level if`);
    assert.equal(job["continue-on-error"], undefined, `${name} has no job-level continue-on-error`);
    for (const step of job.steps)
      assert.equal(step["continue-on-error"], undefined, `${name}: no step continue-on-error`);
  }
  const table = (name) =>
    doc.jobs[name].steps.map((step) => [step.id === "scope" ? "scope" : (step.run ?? step.uses), step.if ?? null]);
  const SCOPE = ["scope", MERGE_GROUP];
  assert.deepEqual(
    table("gates"),
    [
      ["actions/checkout@v5", null],
      ["actions/setup-node@v5", null],
      ["npm ci", null],
      SCOPE,
      ["npm run -s typecheck", FULL],
      ["npm run -s lint", FULL],
      ["npm run -s format:check", DEFERRED],
      ["sudo apt-get update && sudo apt-get install -y bubblewrap", DEFERRED],
      ["sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0", DEFERRED],
      ["npm test", DEFERRED],
      ["node scripts/ci-scope.mjs --check-reads ${{ runner.temp }}/record-reads.log", DEFERRED],
      ["npm run -s check -- examples/sample-studio --repo .", DEFERRED],
      ["npm run -s check -- studio --repo .", SHORT],
      ["npm run -s test:record", SHORT],
    ],
    "gates: setup, then typecheck and lint on a pull request; the rest only off it",
  );
  assert.deepEqual(
    table("officina"),
    [
      ["actions/checkout@v5", NOT_PR],
      ["actions/setup-node@v5", NOT_PR],
      ["npm ci", NOT_PR],
      ["npm run -s check -- studio --repo .", NOT_PR],
    ],
    "officina: every step skips on a pull request, so the job succeeds without work",
  );
  assert.deepEqual(
    table("web-e2e"),
    [
      ["actions/checkout@v5", NOT_PR],
      ["actions/setup-node@v5", NOT_PR],
      ["npm ci", NOT_PR],
      SCOPE,
      ["rm -rf apps/web/dist", DEFERRED],
      ["npm run -s build --workspace @bisellium/web", DEFERRED],
      ["npx playwright install --with-deps chromium", DEFERRED],
      ["npm run -s test:serve --workspace @bisellium/web", DEFERRED],
    ],
    "web-e2e: every step skips on a pull request",
  );
  for (const job of ["gates", "web-e2e"]) {
    const scope = doc.jobs[job].steps.find((step) => step.id === "scope");
    assert.deepEqual(scope?.env, { BASE_SHA: "${{ github.event.merge_group.base_sha }}" }, `${job}'s scope base`);
  }
});
