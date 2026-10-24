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
import { createHash } from "node:crypto";

/** The check run's name, and the one app whose check run is the certificate (a workflow's GITHUB_TOKEN). */
export const CERTIFICATE_CHECK = "certify-certificate";
export const CERTIFICATE_APP = "github-actions";
/** GitHub's limit on a check run's output.text, counted here in UTF-8 bytes (never more characters than bytes). */
export const TEXT_MAX = 65535;
const TAIL_LINES = 200;
const CERTIFY_LINES_MAX = 64;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const digestOf = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const isLines = (v, max) =>
  Array.isArray(v) && v.length <= max && v.every((l) => typeof l === "string" && !l.includes("\n"));

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
