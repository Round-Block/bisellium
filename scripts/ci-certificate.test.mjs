/**
 * W-370 behaviours 2-3: certify's certificate as a check run; W-396 behaviours 1-2: the ci.yml job that posts it. Rows are selected by name
 * (`--test-name-pattern='^W-370-b2\s'`), one row per recorded red. The script is loaded inside each row, never at
 * module top, so a missing file or export is an assertion failure and not a module-load failure. Every fixture is a
 * scratch directory; nothing here reads the real studio/, calls gh or touches the network. W-396's rows read the real
 * .github/workflows/ci.yml and .github/CODEOWNERS, and run the job's guard scripts with bash in a scratch directory.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "ci-certificate.mjs");
const load = async () => {
  assert.ok(existsSync(SCRIPT), "scripts/ci-certificate.mjs exists");
  return import(pathToFileURL(SCRIPT).href);
};

const roots = [];
const scratch = (tag) => {
  const root = mkdtempSync(join(tmpdir(), `w370-${tag}-`));
  roots.push(root);
  return root;
};
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const RUN = 4545;
const SLUG = "Round-Block/bisellium";
const RECEIPT = JSON.stringify({
  harness: "run",
  exitCode: 0,
  completion: { schema: 1, opus: "W-1", finalSourceTree: `tree:${"c".repeat(40)}` },
});
const LOG =
  "certify: merge group for PR #7\ncertify: rebasing opus/W-1 onto bbbbbbbbbbbb\ncertify: running the mint\ntests: passed\ncertify: the mint exited 0\n";
const CERTIFY_LINES = [
  "certify: merge group for PR #7",
  "certify: rebasing opus/W-1 onto bbbbbbbbbbbb",
  "certify: running the mint",
  "certify: the mint exited 0",
];
const LOG_LINES = LOG.split("\n").slice(0, -1);
const digest = (text) => `receipt sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** A certify-certificate check run as GitHub returns it, from the wire shape; `o` overrides a field. */
function run(o = {}) {
  const receipt = o.receipt ?? RECEIPT;
  const text =
    o.text ??
    JSON.stringify({
      schema: o.schema ?? 1,
      run: o.textRun ?? RUN,
      receipt,
      certify: o.certify ?? CERTIFY_LINES,
      tail: o.tail ?? LOG_LINES,
    });
  const c = {
    id: o.id ?? 777,
    name: o.name ?? "certify-certificate",
    head_sha: o.head_sha ?? SHA,
    external_id: o.external_id ?? String(RUN),
    status: o.status ?? "completed",
    conclusion: o.conclusion === undefined ? "success" : o.conclusion,
    app: o.app === null ? null : { slug: o.app ?? "github-actions" },
    output: { title: `certify run ${RUN}`, summary: o.summary ?? digest(receipt), text },
  };
  return c;
}
const page = (...runs) => ({ total_count: runs.length, check_runs: runs });

/** A scratch artifact directory holding `files` (relative path to text). */
function artifact(files) {
  const dir = scratch("artifact");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}
const ARTIFACT = {
  "bisellium/bisellium/candidate/studio/receipts/builder.W-1/r.json": RECEIPT,
  "_temp/certify.log": LOG,
};
const ENV = { GITHUB_EVENT_NAME: "merge_group", GITHUB_REPOSITORY: SLUG, GITHUB_SHA: SHA, GITHUB_RUN_ID: String(RUN) };

test("W-370-b2 behaviour 2: readCertificate fails closed on a missing, doubled, foreign, mismatched or altered check run, and accepts certify's own", async () => {
  const mod = await load();
  assert.equal(typeof mod.readCertificate, "function", "readCertificate is exported");
  const at = { sha: SHA, runId: RUN };
  const refused = (row, reply, why) => {
    const r = mod.readCertificate(reply, at);
    assert.ok(r !== null && typeof r === "object" && "why" in r, `${row}: refused`);
    assert.match(r.why, why, `${row}: the reason`);
  };
  // who wrote it: only a workflow's GITHUB_TOKEN (the github-actions app)
  refused("another app's check run", page(run({ app: "some-app" })), /written by some-app, not github-actions/);
  refused("a check run with no app", page(run({ app: null })), /written by no app, not github-actions/);
  // what it certifies: this commit, this run, finished with success
  refused("a check run on another commit", page(run({ head_sha: OTHER })), /is not on the commit a{12}/);
  refused("a check run naming another run", page(run({ external_id: "4546" })), /does not name CI run 4545/);
  refused(
    "a check run in progress",
    page(run({ status: "in_progress", conclusion: null })),
    /is not completed with success/,
  );
  refused("a failed check run", page(run({ conclusion: "failure" })), /is not completed with success/);
  // what it carries: a schema-1 text for this run whose receipt matches the summary's digest
  refused(
    "an altered receipt",
    page(run({ receipt: RECEIPT.replace("W-1", "W-2"), summary: digest(RECEIPT) })),
    /receipt does not match its digest/,
  );
  refused("a text for another run", page(run({ textRun: 4546 })), /not a schema-1 certificate for CI run 4545/);
  refused("a schema-2 text", page(run({ schema: 2 })), /not a schema-1 certificate/);
  refused(
    "a line holding a newline",
    page(run({ certify: ["certify: the mint exited 0\ncertify: x"] })),
    /not a schema-1 certificate/,
  );
  refused("a text that is not JSON", page(run({ text: "{" })), /text is not JSON/);
  refused("an oversize text", page(run({ text: "x".repeat(65536) })), /carries no certificate text/);
  refused("another check's name", page(run({ name: "certify" })), /is not certify-certificate/);
  refused("a check run id that is not a positive integer", page(run({ id: 0 })), /id is not a positive integer/);
  // how many: exactly one on one complete page
  refused("two check runs", page(run(), run({ id: 778 })), /2 certify-certificate check runs name the commit a{12}/);
  refused("no check run", page(), /0 certify-certificate check runs name the commit a{12}/);
  refused("a partial page", { total_count: 101, check_runs: [run()] }, /not one complete page/);
  refused("no reply", null, /not one complete page/);
  // certify's own
  const ok = mod.readCertificate(page(run()), at);
  assert.ok(!("why" in ok), `certify's own check run is accepted: ${JSON.stringify(ok)}`);
  assert.equal(ok.id, 777, "its id");
  assert.ok(Buffer.isBuffer(ok.receipt) && ok.receipt.toString("utf8") === RECEIPT, "its receipt, verbatim");
  assert.deepEqual(ok.certify, CERTIFY_LINES, "certify's lines");
  assert.deepEqual(ok.tail, LOG_LINES, "the log's tail");
});

test("W-370-b3 behaviour 3: the publisher posts the certificate the reader accepts, from exactly one receipt and one certify.log, and refuses anything else", async () => {
  const mod = await load();
  for (const name of ["certificatePayload", "readArtifact", "readCertificateArgs", "publish"])
    assert.equal(typeof mod[name], "function", `${name} is exported`);
  const posts = [];
  const lines = [];
  const gh = (status) => (a, input) => {
    posts.push({ a, input });
    return { status, stderr: status === 0 ? "" : "HTTP 403: Resource not accessible by integration\n" };
  };
  const publish = (env, dir, status = 0) => mod.publish({ env, dir, gh: gh(status), log: (l) => lines.push(l) });

  // posted: one POST of the check run, on stdin, and the reader accepts what GitHub would return
  assert.equal(publish(ENV, artifact(ARTIFACT)), 0, "posted: exit 0");
  assert.equal(posts.length, 1, "one post");
  assert.deepEqual(
    posts[0].a,
    ["api", "--method", "POST", `repos/${SLUG}/check-runs`, "--input", "-"],
    "the post names the repository's check runs and reads its body from stdin",
  );
  const payload = JSON.parse(posts[0].input);
  assert.deepEqual(
    { ...payload, output: { ...payload.output, text: undefined } },
    {
      name: "certify-certificate",
      head_sha: SHA,
      external_id: String(RUN),
      status: "completed",
      conclusion: "success",
      output: { title: `certify run ${RUN}`, summary: digest(RECEIPT), text: undefined },
    },
    "the check run's fields",
  );
  assert.deepEqual(
    JSON.parse(payload.output.text),
    { schema: 1, run: RUN, receipt: RECEIPT, certify: CERTIFY_LINES, tail: LOG_LINES },
    "the text: the receipt, certify's lines, the tail",
  );
  const back = mod.readCertificate(page({ ...payload, id: 5, app: { slug: "github-actions" } }), {
    sha: SHA,
    runId: RUN,
  });
  assert.ok(!("why" in back), `the reader accepts the posted check run: ${JSON.stringify(back)}`);
  assert.equal(back.receipt.toString("utf8"), RECEIPT, "the round trip keeps the receipt verbatim");

  // a long log: the tail is cut from its oldest line to fit 65535 bytes; the receipt and certify's lines stay whole
  const long = `${LOG}${Array.from({ length: 300 }, (_, i) => `line ${i} ${"y".repeat(400)}`).join("\n")}\n`;
  const big = mod.certificatePayload({
    files: new Map([
      ["receipts/r.json", Buffer.from(RECEIPT)],
      ["certify.log", Buffer.from(long)],
    ]),
    runId: String(RUN),
    sha: SHA,
  });
  assert.ok(!("error" in big), `a long log is posted: ${JSON.stringify(big.error)}`);
  const bigText = big.payload.output.text;
  assert.ok(Buffer.byteLength(bigText, "utf8") <= 65535, "the text fits 65535 bytes");
  const bigBody = JSON.parse(bigText);
  assert.ok(bigBody.tail.length > 0 && bigBody.tail.length < 200, "the tail is shortened");
  assert.equal(bigBody.tail.at(-1), `line 299 ${"y".repeat(400)}`, "the tail keeps the newest line");
  assert.deepEqual(
    [bigBody.receipt, bigBody.certify],
    [RECEIPT, CERTIFY_LINES],
    "the receipt and certify's lines are whole",
  );
  const huge = mod.certificatePayload({
    files: new Map([
      ["receipts/r.json", Buffer.from(JSON.stringify({ pad: "z".repeat(70000) }))],
      ["certify.log", Buffer.from(LOG)],
    ]),
    runId: String(RUN),
    sha: SHA,
  });
  assert.match(
    huge.error ?? "",
    /exceed the check run's 65535-byte text/,
    "a receipt that overfills the text is refused",
  );

  // refused input: exit 2 and no post
  const refusedRow = (row, env, files, why, link) => {
    posts.length = 0;
    lines.length = 0;
    const dir = artifact(files);
    if (link) symlinkSync("/etc/hostname", join(dir, link));
    assert.equal(publish(env, dir), 2, `${row}: exit 2`);
    assert.equal(posts.length, 0, `${row}: nothing posted`);
    assert.match(lines.join("\n"), why, `${row}: the reason`);
  };
  refusedRow("a push event", { ...ENV, GITHUB_EVENT_NAME: "push" }, ARTIFACT, /event "push" is not merge_group/);
  refusedRow(
    "a repository that is not a slug",
    { ...ENV, GITHUB_REPOSITORY: "a/b/c" },
    ARTIFACT,
    /GITHUB_REPOSITORY is not a slug/,
  );
  refusedRow(
    "a run id of 16 digits",
    { ...ENV, GITHUB_RUN_ID: "1234567890123456" },
    ARTIFACT,
    /the run id is not a positive integer/,
  );
  refusedRow("a commit that is not an id", { ...ENV, GITHUB_SHA: "HEAD" }, ARTIFACT, /the commit is not a commit id/);
  refusedRow(
    "two receipts",
    ENV,
    { ...ARTIFACT, "receipts/x/s.json": RECEIPT },
    /holds 2 receipt\(s\) and 1 certify\.log\(s\)/,
  );
  refusedRow("no certify.log", ENV, { "receipts/r.json": RECEIPT }, /holds 1 receipt\(s\) and 0 certify\.log\(s\)/);
  refusedRow(
    "a receipt that is not JSON",
    ENV,
    { "receipts/r.json": "{", "certify.log": LOG },
    /the receipt is not JSON/,
  );
  refusedRow("a symbolic link in the artifact", ENV, ARTIFACT, /holds link, which is not a regular file/, "link");
  refusedRow("an empty artifact", ENV, {}, /holds 0 receipt\(s\) and 0 certify\.log\(s\)/);
  for (const argv of [[], ["--dir"], ["--dir", "x", "--dir", "y"], ["--out", "x"], ["--dir", "--x"]])
    assert.ok("error" in mod.readCertificateArgs(argv), `the arguments ${JSON.stringify(argv)} are refused`);
  assert.deepEqual(mod.readCertificateArgs(["--dir", "/tmp/a"]), { dir: "/tmp/a" }, "exactly --dir <path>");

  // a failed post: exit 1, and the reason is logged
  posts.length = 0;
  lines.length = 0;
  assert.equal(publish(ENV, artifact(ARTIFACT), 1), 1, "a failed post: exit 1");
  assert.match(lines.join("\n"), /certificate: gh api exited 1: HTTP 403/, "a failed post: the reason");
});

// ---------------------------------------------------------------------------
// W-396: the ci.yml `certificate` job that runs the publisher above, and its base guards
// ---------------------------------------------------------------------------
const CI_YML = join(dirname(HERE), ".github", "workflows", "ci.yml");
const CODEOWNERS = join(dirname(HERE), ".github", "CODEOWNERS");
const BASE_SHA_EXPR = "${{ github.event.merge_group.base_sha }}";
const GUARD_BASE = "Refuse a merge-group base that is not a commit id";
const GUARD_HEAD = "Refuse a tooling checkout that is not the merge-group base";
const isGuard = (step) => step.name === GUARD_BASE || step.name === GUARD_HEAD;
/** A `shell: bash` step's script, run as GitHub runs it (`bash --noprofile --norc -eo pipefail {0}`) in `cwd`. */
const runStep = (step, cwd, env) => {
  const file = join(cwd, ".step.sh");
  writeFileSync(file, step.run);
  return spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", file], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
};

test("W-396-b1 behaviour 1: ci.yml carries the certificate job after certify, with a token that reads contents and writes check runs and nothing more, publishing master's script; no other job can write a check run, and CODEOWNERS names the publisher", () => {
  const raw = readFileSync(CI_YML, "utf8");
  const doc = parseYaml(raw);
  assert.deepEqual(
    Object.keys(doc.jobs),
    ["gates", "officina", "web-e2e", "certify", "certificate"],
    "five jobs, certificate last",
  );
  const job = doc.jobs.certificate;
  assert.deepEqual(
    {
      needs: job.needs,
      if: job.if,
      runsOn: job["runs-on"],
      timeout: job["timeout-minutes"],
      permissions: job.permissions,
      continueOnError: job["continue-on-error"],
    },
    {
      needs: "certify",
      if: "github.event_name == 'merge_group'",
      runsOn: "ubuntu-24.04",
      timeout: 10,
      permissions: { contents: "read", checks: "write" },
      continueOnError: undefined,
    },
    "the certificate job runs after certify on a merge group, with a token that reads contents (its checkout needs it) and writes check runs, nothing more",
  );
  assert.deepEqual(
    job.steps.filter((step) => !isGuard(step)),
    [
      {
        uses: "actions/checkout@v5",
        with: { path: "tooling", ref: BASE_SHA_EXPR, "persist-credentials": false },
      },
      { uses: "actions/download-artifact@v7", with: { name: "certify-${{ github.run_id }}", path: "certify" } },
      { uses: "actions/setup-node@v5", with: { "node-version": 25 } },
      {
        if: "hashFiles('certify/**/receipts/**/*.json') != ''",
        run: "node tooling/scripts/ci-certificate.mjs --dir certify",
        env: { GH_TOKEN: "${{ github.token }}" },
      },
    ],
    "beside its guards, four steps: master's tooling without a stored credential, certify's artifact, node, and master's publisher when the artifact holds a receipt",
  );
  assert.deepEqual(doc.permissions, { contents: "read" }, "the workflow's default token stays read-only");
  assert.deepEqual(
    doc.jobs.certify.permissions,
    { contents: "read", "pull-requests": "read" },
    "certify's token gains nothing",
  );
  const writers = Object.entries(doc.jobs).filter(
    ([, j]) => typeof j.permissions === "string" || Object.values(j.permissions ?? {}).includes("write"),
  );
  assert.deepEqual(
    writers.map(([id]) => id),
    ["certificate"],
    "no other job's token can write anything, a check run included",
  );
  assert.equal(
    doc.jobs.certify.steps.at(-1).with.name,
    "certify-${{ github.run_id }}",
    "certify still uploads the artifact the certificate job reads",
  );
  assert.ok(!raw.includes("verify"), "the string verify stays out of ci.yml");
  const owners = readFileSync(CODEOWNERS, "utf8").split("\n");
  assert.ok(
    owners.some((l) => /^\/scripts\/ci-certificate\.mjs\s+@edckt$/.test(l)),
    "CODEOWNERS names the publisher",
  );
});

