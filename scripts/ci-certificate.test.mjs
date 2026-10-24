/**
 * W-370 behaviours 2-3: certify's certificate as a check run (the ci.yml job that posts it is W-396's). Rows are selected by name
 * (`--test-name-pattern='^W-370-b2\s'`), one row per recorded red. The script is loaded inside each row, never at
 * module top, so a missing file or export is an assertion failure and not a module-load failure. Every fixture is a
 * scratch directory; nothing here reads the real studio/, calls gh or touches the network.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

