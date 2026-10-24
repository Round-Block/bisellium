/**
 * W-370: certify's certificate, carried as a check run on the merge commit, so the done perform reads it through
 * api.github.com alone and never through GitHub's artifact blob host. This file is the one place the check run's shape
 * is written (`certificatePayload`, `publish`) and read (`readCertificate`, imported by packages/cli/src/next.ts).
 *
 * The publisher runs in ci.yml's `certificate` job, from master's tooling, after `certify` succeeded:
 *   node scripts/ci-certificate.mjs --dir <the downloaded certify-<run> artifact>
 * It reads GITHUB_EVENT_NAME, GITHUB_REPOSITORY, GITHUB_SHA and GITHUB_RUN_ID, and posts one completed check run named
 * `certify-certificate` on GITHUB_SHA whose external_id is the run id. Exit 0: posted. Exit 1: the post failed.
 * Exit 2: refused input. It imports node: built-ins only, so the job needs no npm ci.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The check run's name, and the one app whose check run is the certificate (a workflow's GITHUB_TOKEN). */
export const CERTIFICATE_CHECK = "certify-certificate";
export const CERTIFICATE_APP = "github-actions";
/** GitHub's limit on a check run's output.text, counted here in UTF-8 bytes (never more characters than bytes). */
export const TEXT_MAX = 65535;
const RECEIPT_MAX = 1024 * 1024;
const LOG_MAX = 16 * 1024 * 1024;
const TAIL_LINES = 200;
const CERTIFY_LINES_MAX = 64;
const OID_RE = /^[0-9a-f]{40}$/;
/** A run id: at most 15 digits, so it is exact through a double. */
const RUN_RE = /^[1-9][0-9]{0,14}$/;
const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const digestOf = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const isLines = (v, max) =>
  Array.isArray(v) && v.length <= max && v.every((l) => typeof l === "string" && !l.includes("\n"));

/** The check run's output.text: the receipt verbatim, certify's own lines and the log's tail. */
const textOf = (runId, receipt, certify, tail) => JSON.stringify({ schema: 1, run: runId, receipt, certify, tail });

/**
 * The check run to post for CI run `runId` on commit `sha`, from the certify artifact's regular files (`files`: a Map of
 * relative path to bytes): exactly one receipt (a `.json` under a `receipts` segment, UTF-8 JSON) and one certify.log.
 * The tail is the log's last 200 lines, shortened from its oldest line until the text fits TEXT_MAX; the receipt and
 * certify's own lines are never shortened, and a text they alone overfill is refused.
 */
export function certificatePayload({ files, runId, sha }) {
  if (typeof runId !== "string" || !RUN_RE.test(runId)) return { error: "the run id is not a positive integer" };
  if (typeof sha !== "string" || !OID_RE.test(sha)) return { error: "the commit is not a commit id" };
  const rels = [...files.keys()];
  const receipts = rels.filter((r) => r.split("/").includes("receipts") && r.endsWith(".json"));
  const logs = rels.filter((r) => r.split("/").pop() === "certify.log");
  if (receipts.length !== 1 || logs.length !== 1)
    return {
      error: `the artifact holds ${receipts.length} receipt(s) and ${logs.length} certify.log(s), not one of each`,
    };
  const bytes = files.get(receipts[0]);
  const receipt = bytes.toString("utf8");
  if (!Buffer.from(receipt, "utf8").equals(bytes)) return { error: "the receipt is not UTF-8" };
  try {
    JSON.parse(receipt);
  } catch {
    return { error: "the receipt is not JSON" };
  }
  const lines = files.get(logs[0]).toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const certify = lines.filter((l) => l.startsWith("certify: "));
  if (certify.length > CERTIFY_LINES_MAX)
    return { error: `certify.log holds ${certify.length} certify lines, over ${CERTIFY_LINES_MAX}` };
  const run = Number(runId);
  let tail = lines.slice(-TAIL_LINES);
  let text = textOf(run, receipt, certify, tail);
  while (Buffer.byteLength(text, "utf8") > TEXT_MAX && tail.length > 0) {
    tail = tail.slice(1);
    text = textOf(run, receipt, certify, tail);
  }
  if (Buffer.byteLength(text, "utf8") > TEXT_MAX)
    return { error: `the receipt and certify's lines exceed the check run's ${TEXT_MAX}-byte text` };
  return {
    payload: {
      name: CERTIFICATE_CHECK,
      head_sha: sha,
      external_id: runId,
      status: "completed",
      conclusion: "success",
      output: { title: `certify run ${runId}`, summary: `receipt sha256:${digestOf(receipt)}`, text },
    },
  };
}

/**
 * The certificate in a `GET repos/<slug>/commits/<sha>/check-runs?check_name=certify-certificate&filter=all` reply, for
 * CI run `runId` on commit `sha`, or why there is none. The reply must be one complete page holding exactly one check
 * run: a second one (a re-run, or one another writer added) refuses, so a forged check run can deny a certificate but
 * never stand beside certify's. That one must be github-actions', on `sha`, completed with success, name `runId` as its
 * external_id, and carry a schema-1 text for `runId` whose receipt matches the summary's digest.
 */
export function readCertificate(reply, { sha, runId }) {
  if (!isObj(reply) || !Array.isArray(reply.check_runs) || reply.total_count !== reply.check_runs.length)
    return { why: "the check-runs reply is not one complete page" };
  const n = reply.check_runs.length;
  if (n !== 1) return { why: `${n} ${CERTIFICATE_CHECK} check runs name the commit ${sha.slice(0, 12)}` };
  const c = reply.check_runs[0];
  if (!isObj(c) || c.name !== CERTIFICATE_CHECK) return { why: `the check run is not ${CERTIFICATE_CHECK}` };
  if (!Number.isSafeInteger(c.id) || c.id < 1) return { why: "the check run's id is not a positive integer" };
  const app = isObj(c.app) && typeof c.app.slug === "string" ? c.app.slug : "no app";
  if (app !== CERTIFICATE_APP)
    return { why: `the ${CERTIFICATE_CHECK} check run was written by ${app.slice(0, 60)}, not ${CERTIFICATE_APP}` };
  if (c.head_sha !== sha) return { why: `the ${CERTIFICATE_CHECK} check run is not on the commit ${sha.slice(0, 12)}` };
  if (c.external_id !== String(runId))
    return { why: `the ${CERTIFICATE_CHECK} check run does not name CI run ${runId}` };
  if (c.status !== "completed" || c.conclusion !== "success")
    return { why: `the ${CERTIFICATE_CHECK} check run is not completed with success` };
  const text = isObj(c.output) ? c.output.text : undefined;
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > TEXT_MAX)
    return { why: `the ${CERTIFICATE_CHECK} check run carries no certificate text` };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { why: `the ${CERTIFICATE_CHECK} check run's text is not JSON` };
  }
  if (
    !isObj(body) ||
    body.schema !== 1 ||
    body.run !== runId ||
    typeof body.receipt !== "string" ||
    !isLines(body.certify, CERTIFY_LINES_MAX) ||
    !isLines(body.tail, TAIL_LINES)
  )
    return { why: `the ${CERTIFICATE_CHECK} check run's text is not a schema-1 certificate for CI run ${runId}` };
  if (c.output.summary !== `receipt sha256:${digestOf(body.receipt)}`)
    return { why: `the ${CERTIFICATE_CHECK} check run's receipt does not match its digest` };
  return { id: c.id, receipt: Buffer.from(body.receipt, "utf8"), certify: body.certify, tail: body.tail };
}

/** Exactly `--dir <path>`, once, nothing else. */
export function readCertificateArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--dir")
    return { error: "usage: ci-certificate.mjs --dir <artifact directory>" };
  const dir = argv[1];
  if (typeof dir !== "string" || dir === "" || dir.startsWith("--")) return { error: "--dir needs a value" };
  return { dir };
}

/** Every regular file under `dir` (relative path to bytes), or why not: a symbolic link or any other entry type refuses. */
export function readArtifact(dir, rel = "", out = new Map()) {
  let entries;
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return { error: `the artifact directory ${rel === "" ? "" : `${rel} `}cannot be read` };
  }
  for (const e of entries) {
    const p = rel === "" ? e.name : `${rel}/${e.name}`;
    const st = lstatSync(join(dir, p));
    if (st.isDirectory()) {
      const inner = readArtifact(dir, p, out);
      if ("error" in inner) return inner;
    } else if (st.isFile()) {
      if (st.size > LOG_MAX || (p.endsWith(".json") && st.size > RECEIPT_MAX))
        return { error: `the artifact's ${p} is over its size limit` };
      out.set(p, readFileSync(join(dir, p)));
    } else return { error: `the artifact holds ${p}, which is not a regular file` };
  }
  return { files: out };
}

/** Post the certificate for the artifact in `dir`: the exit code (0 posted, 1 the post failed, 2 refused input). */
export function publish({ env, dir, gh, log }) {
  const refuse = (why) => {
    log(`certificate: refused: ${why}`);
    return 2;
  };
  if (env.GITHUB_EVENT_NAME !== "merge_group")
    return refuse(`event ${JSON.stringify(env.GITHUB_EVENT_NAME ?? "")} is not merge_group`);
  const slug = env.GITHUB_REPOSITORY;
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return refuse("GITHUB_REPOSITORY is not a slug");
  const read = readArtifact(dir);
  if ("error" in read) return refuse(read.error);
  const p = certificatePayload({ files: read.files, runId: env.GITHUB_RUN_ID, sha: env.GITHUB_SHA });
  if ("error" in p) return refuse(p.error);
  const r = gh(["api", "--method", "POST", `repos/${slug}/check-runs`, "--input", "-"], JSON.stringify(p.payload));
  if (r.status !== 0) {
    log(`certificate: gh api exited ${r.status}: ${(r.stderr ?? "").trim().split("\n")[0] ?? ""}`);
    return 1;
  }
  log(`certificate: posted ${CERTIFICATE_CHECK} for CI run ${env.GITHUB_RUN_ID} on ${env.GITHUB_SHA}`);
  return 0;
}

function main(argv) {
  const log = (line) => console.log(line);
  const args = readCertificateArgs(argv);
  if ("error" in args) {
    log(`certificate: refused: ${args.error}`);
    return 2;
  }
  const gh = (a, input) => {
    const r = spawnSync("gh", a, { input, encoding: "utf8", timeout: 120_000 });
    return { status: r.status ?? 1, stderr: r.stderr ?? (r.error === undefined ? "" : String(r.error.message)) };
  };
  return publish({ env: process.env, dir: resolve(args.dir), gh, log });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
