/**
 * W-168 behaviours 1-2: the merge-group certify job and its script. Rows are
 * selected by name (`--test-name-pattern=W-168-b1`), one failing row set per
 * recorded red. The script is loaded inside each row, never at module top, so
 * a missing file is an assertion failure and not a module-load failure. Every
 * fixture is a scratch repository; nothing here reads the real studio/.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
