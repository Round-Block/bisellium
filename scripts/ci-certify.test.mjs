/**
 * W-168 behaviours 1-2: the merge-group certify job and its script. Rows are
 * selected by name (`--test-name-pattern=W-168-b1`), one failing row set per
 * recorded red. The script is loaded inside each row, never at module top, so
 * a missing file is an assertion failure and not a module-load failure. Every
 * fixture is a scratch repository; nothing here reads the real studio/.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "ci-certify.mjs");
const CI_YML = join(dirname(HERE), ".github", "workflows", "ci.yml");
const workflow = () => parseYaml(readFileSync(CI_YML, "utf8"));
const load = () => import(pathToFileURL(SCRIPT).href);

const roots = [];
const scratch = (tag) => {
  const root = mkdtempSync(join(tmpdir(), `w168-${tag}-`));
  roots.push(root);
  return root;
};
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SHA_BASE = "b".repeat(40);
const SHA_HEAD = "a".repeat(40);
const mergeGroup = (over = {}) => ({
  action: "checks_requested",
  merge_group: {
    head_ref: `refs/heads/gh-readonly-queue/master/pr-7-${SHA_HEAD}`,
    head_sha: SHA_HEAD,
    base_sha: SHA_BASE,
    base_ref: "refs/heads/master",
    ...over,
  },
  repository: { full_name: "Round-Block/bisellium" },
});

/** Spawn the script with an event name and payload; returns the exit status and the joined output. */
function spawnScript(args, eventName, payload) {
  const dir = scratch("spawn");
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify(payload));
  const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args], {
    cwd: dirname(HERE),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: dir,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
    },
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const GOOD_ARGS = (dir) => ["--candidate", dir, "--studio", "studio"];

const STEP9 =
  'node --import tsx scripts/ci-certify.mjs --candidate ../candidate --studio studio 2>&1 | tee "${{ runner.temp }}/certify.log"';

test("W-168-b1 behaviour 1: ci.yml triggers merge_group and carries the certify job exactly", () => {
  const doc = workflow();
  assert.deepEqual(
    doc.on.merge_group,
    { types: ["checks_requested"] },
    "ci.yml triggers merge_group on checks_requested",
  );
  assert.deepEqual(doc.on.push, { branches: ["master"] }, "push stays on master");
  assert.ok("pull_request" in doc.on, "pull_request stays");
  assert.deepEqual(Object.keys(doc.jobs), ["gates", "officina", "web-e2e", "certify"], "four jobs, certify last");

  const job = doc.jobs.certify;
  assert.equal(job.if, "github.event_name == 'merge_group'", "certify runs only on a merge group");
  assert.equal(job["timeout-minutes"], 100);
  assert.deepEqual(job.permissions, { contents: "read", "pull-requests": "read" });
  assert.equal(job["continue-on-error"], undefined, "the job has no continue-on-error");
  const steps = job.steps;
  assert.equal(steps.length, 10, "exactly ten steps");
  assert.ok(
    steps.every((s) => s["continue-on-error"] === undefined),
    "no step has continue-on-error",
  );
  assert.deepEqual(
    steps.map((s, i) => (s.if === undefined ? null : i + 1)).filter((n) => n !== null),
    [10],
    "only step 10 carries an if",
  );
  assert.equal(steps[0].uses, "actions/checkout@v5");
  assert.deepEqual(steps[0].with, { path: "candidate", "fetch-depth": 0 });
  assert.equal(steps[1].uses, "actions/checkout@v5");
  assert.deepEqual(steps[1].with, { path: "tooling", ref: "${{ github.event.merge_group.base_sha }}" });
  assert.equal(steps[2].uses, "actions/setup-node@v5");
  assert.deepEqual(steps[2].with, { "node-version": 25 });
  assert.equal(steps[3].run, "sudo apt-get update && sudo apt-get install -y bubblewrap");
  assert.equal(steps[4].run, "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
  assert.deepEqual([steps[5].run, steps[5]["working-directory"]], ["npm ci", "tooling"]);
  assert.deepEqual([steps[6].run, steps[6]["working-directory"]], ["npm ci", "candidate"]);
  assert.deepEqual(
    [steps[7].run, steps[7]["working-directory"]],
    ["npx playwright install --with-deps chromium", "candidate"],
  );
  assert.equal(steps[8].run, STEP9);
  assert.equal(steps[8]["working-directory"], "tooling");
  assert.equal(steps[8].shell, "bash", "step 9 runs under bash so pipefail applies");
  assert.deepEqual(steps[8].env, { GH_TOKEN: "${{ github.token }}" });
  assert.equal(steps[9].uses, "actions/upload-artifact@v4");
  assert.equal(steps[9].if, "always()");
  assert.equal(steps[9].with.name, "certify-${{ github.run_id }}");
  assert.equal(steps[9].with["if-no-files-found"], "warn");
  assert.deepEqual(steps[9].with.path.split("\n").filter(Boolean), [
    "candidate/studio/receipts/",
    "${{ runner.temp }}/certify.log",
  ]);
  assert.ok(!readFileSync(CI_YML, "utf8").includes("verify"), "the string verify stays out of ci.yml");
});

test("W-168-b1 behaviour 1: readCertifyArgs accepts exactly the two flags once each", async () => {
  assert.ok(existsSync(SCRIPT), "scripts/ci-certify.mjs exists");
  const { readCertifyArgs } = await load();
  assert.deepEqual(readCertifyArgs(["--candidate", "../candidate", "--studio", "studio"]), {
    candidate: "../candidate",
    studio: "studio",
  });
  assert.deepEqual(readCertifyArgs(["--studio", "studio", "--candidate", "c"]), { candidate: "c", studio: "studio" });
  for (const bad of [
    ["--candidate", "c"],
    ["--studio", "studio"],
    [],
    ["--candidate", "c", "--studio", "studio", "--bogus", "x"],
    ["--candidate", "c", "--candidate", "d", "--studio", "studio"],
    ["--candidate", "c", "--studio", "a", "--studio", "b"],
    ["--candidate", "c", "--studio"],
    ["--candidate", "c", "--studio", "studio", "extra"],
  ])
    assert.equal(typeof readCertifyArgs(bad).error, "string", `${JSON.stringify(bad)} is refused with an error`);
});

test("W-168-b1 behaviour 1: the script exits 2 for anything that is not a merge group", () => {
  assert.ok(existsSync(SCRIPT), "scripts/ci-certify.mjs exists");
  const dir = scratch("refuse");
  const refused = [
    ["a pull_request event", GOOD_ARGS(dir), "pull_request", mergeGroup()],
    [
      "a head_ref that is not a queue branch",
      GOOD_ARGS(dir),
      "merge_group",
      mergeGroup({ head_ref: "refs/heads/main" }),
    ],
    ["an unknown flag", [...GOOD_ARGS(dir), "--bogus", "x"], "merge_group", mergeGroup()],
    ["a repeated flag", [...GOOD_ARGS(dir), "--studio", "other"], "merge_group", mergeGroup()],
    ["no --studio", ["--candidate", dir], "merge_group", mergeGroup()],
    ["a short head_sha", GOOD_ARGS(dir), "merge_group", mergeGroup({ head_sha: "abc" })],
    ["a base_ref other than master", GOOD_ARGS(dir), "merge_group", mergeGroup({ base_ref: "refs/heads/main" })],
  ];
  for (const [what, args, name, payload] of refused) {
    const r = spawnScript(args, name, payload);
    assert.equal(r.status, 2, `${what} exits 2\n${r.output}`);
  }
});

test("W-168-b1 behaviour 1: a valid merge group never exits 0 and names itself", () => {
  assert.ok(existsSync(SCRIPT), "scripts/ci-certify.mjs exists");
  const dir = scratch("valid");
  const r = spawnScript(GOOD_ARGS(dir), "merge_group", mergeGroup());
  // Exit 1 until behaviour 2 lands (the job fails closed); behaviour 2's input checks refuse this bare directory with 2.
  assert.ok(r.status === 1 || r.status === 2, `a valid merge group fails closed, got ${r.status}\n${r.output}`);
  assert.match(r.output, /certify:/, "the script names itself");
});

// ---------------------------------------------------------------------------
// behaviour 2: pin the PR head, rebase it onto master, check the tree, run the mint
// ---------------------------------------------------------------------------
const SLUG = "Round-Block/bisellium";
const GIT_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: scratch("home"),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
// certify runs git with the test process's environment: keep it hermetic.
Object.assign(process.env, GIT_ENV);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV }).trim();
const gitOk = (cwd, ...args) => spawnSync("git", args, { cwd, env: GIT_ENV }).status === 0;
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commitAll = (dir, message) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", message);
  return git(dir, "rev-parse", "HEAD");
};
const MANIFEST = "bisellium: 1\nstudio: fixture\nsource_excludes: []\n";

/**
 * A scratch origin with master, a pushed opus/W-900 of two studio-only red-log commits behind refs/pull/7/head,
 * a merge-group commit on the base with the rebased head's whole tree, a candidate at that commit and a tooling
 * clone at the base. `advance` moves master first: "source" (no conflict) or "conflict" (the same red log).
 */
function fixture(tag, o = {}) {
  const root = scratch(tag);
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "master", origin);
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "master");
  git(seed, "remote", "add", "origin", origin);
  put(seed, "studio/bisellium.yml", MANIFEST);
  put(seed, "src.txt", "source\n");
  commitAll(seed, "base");
  git(seed, "push", "-q", "origin", "master");
  git(seed, "checkout", "-q", "-b", "opus/W-900");
  put(seed, "studio/ci/reds/W-900/01.log", "# behaviour: 1\n");
  commitAll(seed, "red one");
  put(seed, "studio/ci/reds/W-900/02.log", "# behaviour: 2\n");
  const head = commitAll(seed, "red two");
  git(seed, "push", "-q", "origin", "opus/W-900");
  git(seed, "push", "-q", "origin", `${head}:refs/pull/7/head`);
  git(seed, "checkout", "-q", "master");
  if (o.advance === "source") put(seed, "src2.txt", "trunk source\n");
  if (o.advance === "conflict") put(seed, "studio/ci/reds/W-900/01.log", "# behaviour: 1 (trunk)\n");
  if (o.advance !== undefined) {
    commitAll(seed, "trunk moves");
    git(seed, "push", "-q", "origin", "master");
  }
  const base = git(seed, "rev-parse", "HEAD");
  git(seed, "checkout", "-q", "--detach", base);
  if (o.advance !== "conflict") git(seed, "checkout", head, "--", "studio/ci/reds");
  if (o.extraStudio) put(seed, "studio/extra.md", "a studio-only difference\n");
  const merged = commitAll(seed, "merge group");
  git(seed, "push", "-q", "origin", `${merged}:refs/heads/queue`);

  const cand = join(root, "candidate");
  mkdirSync(cand);
  git(cand, "init", "-q", "-b", "scratch");
  git(cand, "remote", "add", "origin", `https://github.com/${SLUG}`);
  git(cand, "config", `url.${origin}.insteadOf`, `https://github.com/${SLUG}`);
  git(cand, "fetch", "-q", "origin", "queue");
  git(cand, "checkout", "-q", "--detach", merged);
  const tooling = join(root, "tooling");
  git(root, "clone", "-q", origin, tooling);
  git(tooling, "checkout", "-q", "--detach", base);
  const event = {
    action: "checks_requested",
    merge_group: {
      head_ref: `refs/heads/gh-readonly-queue/master/pr-7-${merged}`,
      head_sha: merged,
      base_sha: base,
      base_ref: "refs/heads/master",
    },
    repository: { full_name: SLUG },
  };
  return { root, origin, seed, cand, tooling, head, base, merged, event };
}

/** certify with an injected gh and mint; returns what it did. */
async function run(fx, over = {}) {
  assert.ok(existsSync(SCRIPT), "scripts/ci-certify.mjs exists");
  const { certify } = await load();
  const minted = [];
  const lines = [];
  const ghCalls = [];
  const pr = {
    number: 7,
    state: "OPEN",
    headRefName: "opus/W-900",
    headRefOid: fx.head,
    baseRefName: "master",
    isCrossRepository: false,
    ...over.pr,
  };
  for (const key of over.dropPr ?? []) delete pr[key];
  const gh =
    over.gh ??
    ((args) => {
      ghCalls.push(args);
      return { status: 0, stdout: JSON.stringify(pr) };
    });
  const mint = (argv, cwd) => {
    minted.push({ argv, cwd });
    return over.mintCode ?? 0;
  };
  const code = await certify({
    eventName: "merge_group",
    event: over.event ?? fx.event,
    candidate: over.candidate ?? fx.cand,
    studio: over.studio ?? "studio",
    tooling: over.tooling ?? fx.tooling,
    gh,
    mint,
    log: (line) => lines.push(line),
  });
  return { code, minted, lines, ghCalls };
}
const out = (r) => r.lines.join("\n");
const withEvent = (fx, patch) => ({
  ...fx.event,
  ...patch.top,
  merge_group: { ...fx.event.merge_group, ...patch.group },
});

test("W-168-b2 behaviour 2: an opus merge group is rebased, tree-checked and minted once with the exact argv", async () => {
  const fx = fixture("b2-valid");
  const r = await run(fx);
  assert.equal(r.code, 0, `a valid opus merge group certifies\n${out(r)}`);
  assert.equal(r.minted.length, 1, "mint is called once");
  assert.deepEqual(r.minted[0].argv, [
    process.execPath,
    "--import",
    "tsx",
    join(fx.tooling, "packages/cli/src/main.ts"),
    "run",
    "--sella",
    "builder",
    "--opus",
    "W-900",
    "--studio",
    join(fx.cand, "studio"),
    "--repo",
    fx.cand,
    "--",
    "true",
  ]);
  assert.equal(r.minted[0].cwd, fx.cand, "mint runs in the candidate");
  assert.deepEqual(r.ghCalls, [
    ["pr", "view", "7", "-R", SLUG, "--json", "number,state,headRefName,headRefOid,baseRefName,isCrossRepository"],
  ]);
  assert.equal(git(fx.cand, "rev-parse", "HEAD^{tree}"), git(fx.cand, "rev-parse", `${fx.merged}^{tree}`));
  assert.equal(git(fx.cand, "symbolic-ref", "HEAD"), "refs/heads/opus/W-900", "the candidate is on the opus branch");
  assert.ok(r.lines.length > 0 && r.lines.every((l) => l.startsWith("certify:")), "every line is a certify: line");
});

test("W-168-b2 behaviour 2: master advanced by a source commit is rebased onto and the tree still matches", async () => {
  const fx = fixture("b2-advanced", { advance: "source" });
  const r = await run(fx);
  assert.equal(r.code, 0, `the rebased head certifies\n${out(r)}`);
  assert.equal(r.minted.length, 1);
  assert.equal(git(fx.cand, "rev-parse", "master"), fx.base, "master is the base");
  assert.ok(gitOk(fx.cand, "merge-base", "--is-ancestor", fx.base, "HEAD"), "the opus commits sit on the base");
  assert.notEqual(git(fx.cand, "rev-parse", "HEAD"), fx.head, "the head was rebased, not reused");
  assert.equal(git(fx.cand, "rev-parse", "HEAD^{tree}"), git(fx.cand, "rev-parse", `${fx.merged}^{tree}`));
});

test("W-168-b2 behaviour 2: a head that is not an opus needs no mint", async () => {
  const fx = fixture("b2-chore");
  const r = await run(fx, { pr: { headRefName: "chore/x" } });
  assert.equal(r.code, 0, `a chore head returns 0\n${out(r)}`);
  assert.equal(r.minted.length, 0, "mint is not called");
  assert.match(out(r), /not an opus; nothing to mint/);
});

test("W-168-b2 behaviour 2: phase A refusals return 2, mint nothing and write no Git state", async () => {
  const refusals = [
    [
      "a repository.full_name that is not a slug",
      (fx) => ({ event: withEvent(fx, { top: { repository: { full_name: "nope" } } }) }),
    ],
    [
      "a repository.full_name other than the origin's",
      (fx) => ({ event: withEvent(fx, { top: { repository: { full_name: "Other/repo" } } }) }),
    ],
    ["an unparseable bisellium.yml", (fx) => (put(fx.cand, "studio/bisellium.yml", "a: [\n"), {})],
    ["a bisellium.yml that is a YAML list", (fx) => (put(fx.cand, "studio/bisellium.yml", "- a\n- b\n"), {})],
    [
      "a scalar source_excludes",
      (fx) => (put(fx.cand, "studio/bisellium.yml", "bisellium: 1\nstudio: fixture\nsource_excludes: x\n"), {}),
    ],
    ["a PR read without a string headRefName", () => ({ dropPr: ["headRefName"] })],
    ["a PR read with a numeric headRefName", () => ({ pr: { headRefName: 7 } })],
    [
      "a candidate HEAD other than head_sha",
      (fx) => ({ event: withEvent(fx, { group: { head_sha: "c".repeat(40) } }) }),
    ],
    ["a tooling HEAD other than base_sha", (fx) => ({ event: withEvent(fx, { group: { base_sha: "c".repeat(40) } }) })],
    ["the candidate equal to the tooling", (fx) => ({ tooling: fx.cand })],
    ["a --studio of ../x", () => ({ studio: "../x" })],
    ["an absolute --studio", (fx) => ({ studio: join(fx.cand, "studio") })],
    [
      "a --studio symlinked out of the candidate",
      (fx) => {
        const outside = join(fx.root, "outside");
        put(outside, "bisellium.yml", MANIFEST);
        symlinkSync(outside, join(fx.cand, "linked"));
        return { studio: "linked" };
      },
    ],
    ["a --studio directory without bisellium.yml", (fx) => (mkdirSync(join(fx.cand, "empty")), { studio: "empty" })],
    ["a gh error", () => ({ gh: () => ({ status: 1, stdout: "" }) })],
    ["a closed PR", () => ({ pr: { state: "CLOSED" } })],
    ["a cross-repository PR", () => ({ pr: { isCrossRepository: true } })],
    ["a base other than master", () => ({ pr: { baseRefName: "develop" } })],
  ];
  for (const [what, arrange] of refusals) {
    const fx = fixture("b2-refuse");
    const over = arrange(fx);
    const snapshot = () =>
      [
        git(fx.cand, "for-each-ref"),
        git(fx.cand, "rev-parse", "HEAD"),
        spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: fx.cand, encoding: "utf8", env: GIT_ENV }).stdout,
      ].join("\n");
    const before = snapshot();
    const r = await run(fx, over);
    assert.equal(r.code, 2, `${what} returns 2\n${out(r)}`);
    assert.equal(r.minted.length, 0, `${what}: mint is not called`);
    assert.equal(snapshot(), before, `${what}: refs and HEAD are byte-identical`);
  }
});

test("W-168-b2 behaviour 2: phase B refusals mint nothing", async () => {
  const mismatch = fixture("b2-pin");
  const pinned = await run(mismatch, { pr: { headRefOid: "d".repeat(40) } });
  assert.equal(pinned.code, 2, `a fetched head other than headRefOid returns 2\n${out(pinned)}`);
  assert.equal(pinned.minted.length, 0);

  const moved = fixture("b2-moved");
  put(moved.seed, "later.txt", "master moved after the group was built\n");
  git(moved.seed, "checkout", "-q", "master");
  commitAll(moved.seed, "later");
  git(moved.seed, "push", "-q", "origin", "master");
  const stale = await run(moved);
  assert.equal(stale.code, 2, `an origin/master other than base_sha returns 2\n${out(stale)}`);
  assert.equal(stale.minted.length, 0);

  const conflict = fixture("b2-conflict", { advance: "conflict" });
  const clash = await run(conflict);
  assert.equal(clash.code, 1, `a conflicting rebase returns 1\n${out(clash)}`);
  assert.equal(clash.minted.length, 0);
  assert.equal(existsSync(join(conflict.cand, ".git", "rebase-merge")), false, "the rebase was aborted");

  const studioOnly = fixture("b2-tree", { extraStudio: true });
  const tree = await run(studioOnly);
  assert.equal(tree.code, 1, `a studio-only tree difference returns 1\n${out(tree)}`);
  assert.equal(tree.minted.length, 0);
});

test("W-168-b2 behaviour 2: a mint that returns 1 makes certify return 1", async () => {
  const fx = fixture("b2-mint");
  const r = await run(fx, { mintCode: 1 });
  assert.equal(r.code, 1, `a failing mint fails certification\n${out(r)}`);
  assert.equal(r.minted.length, 1);
});
