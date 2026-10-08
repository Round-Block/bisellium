/**
 * W-168: the merge queue's certification. Run from the tooling checkout (master's
 * code, checked out at the merge group's base commit):
 *   node --import tsx scripts/ci-certify.mjs --candidate <dir> --studio <rel>
 * It reads GITHUB_EVENT_NAME and GITHUB_EVENT_PATH. Exit 0: certified, or nothing
 * to mint. Exit 1: certification failed. Exit 2: refused input. Neither 1 nor 2
 * mints, and a non-zero exit fails the required `certify` check.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUEUE_REF_RE = /^refs\/heads\/gh-readonly-queue\/master\/pr-([1-9][0-9]*)-[0-9a-f]{40}$/;
const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const OID_RE = /^[0-9a-f]{40}$/;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Exactly `--candidate <dir>` and `--studio <rel>`, once each, nothing else. */
export function readCertifyArgs(argv) {
  const found = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const name = flag === "--candidate" ? "candidate" : flag === "--studio" ? "studio" : undefined;
    if (name === undefined) return { error: `unknown argument ${JSON.stringify(flag)}` };
    if (name in found) return { error: `${flag} given twice` };
    const value = argv[i + 1];
    if (typeof value !== "string" || value === "" || value.startsWith("--")) return { error: `${flag} needs a value` };
    found[name] = value;
  }
  if (found.candidate === undefined) return { error: "--candidate is required" };
  if (found.studio === undefined) return { error: "--studio is required" };
  return { candidate: found.candidate, studio: found.studio };
}

/** The merge-group event, or the reason it is refused. */
function readEvent(eventName, event) {
  if (eventName !== "merge_group") return { error: `event ${JSON.stringify(eventName)} is not merge_group` };
  if (!isObj(event) || event.action !== "checks_requested") return { error: "the event is not checks_requested" };
  const g = event.merge_group;
  if (!isObj(g)) return { error: "the event has no merge_group" };
  const queued = typeof g.head_ref === "string" ? QUEUE_REF_RE.exec(g.head_ref) : null;
  if (queued === null) return { error: "merge_group.head_ref is not a master queue branch" };
  if (typeof g.head_sha !== "string" || !OID_RE.test(g.head_sha))
    return { error: "merge_group.head_sha is not a commit id" };
  if (typeof g.base_sha !== "string" || !OID_RE.test(g.base_sha))
    return { error: "merge_group.base_sha is not a commit id" };
  if (g.base_ref !== "refs/heads/master") return { error: "merge_group.base_ref is not refs/heads/master" };
  const slug = isObj(event.repository) ? event.repository.full_name : undefined;
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return { error: "repository.full_name is not a slug" };
  return { pr: Number(queued[1]), headSha: g.head_sha, baseSha: g.base_sha, slug };
}

export async function certify(o) {
  const refuse = (why) => {
    o.log(`certify: refused: ${why}`);
    return 2;
  };
  const ev = readEvent(o.eventName, o.event);
  if (ev.error !== undefined) return refuse(ev.error);
  o.log(`certify: merge group for PR #${ev.pr}`);
  // ponytail: behaviour 2 adds the candidate, PR and rebase checks and the mint; until then a valid group fails closed.
  o.log("certify: not certified: the certification steps are not in this script yet");
  return 1;
}

function main(argv) {
  const log = (line) => console.log(line);
  const args = readCertifyArgs(argv);
  if (args.error !== undefined) {
    log(`certify: refused: ${args.error}`);
    return 2;
  }
  let event;
  try {
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  } catch {
    log("certify: refused: GITHUB_EVENT_PATH is not a readable JSON file");
    return 2;
  }
  const tooling = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const gh = (a) => {
    const r = spawnSync("gh", a, { encoding: "utf8", timeout: 120_000 });
    return { status: r.status ?? 1, stdout: r.stdout ?? "" };
  };
  const mint = (a, cwd) => spawnSync(a[0], a.slice(1), { cwd, stdio: "inherit" }).status ?? 1;
  return certify({ eventName: process.env.GITHUB_EVENT_NAME ?? "", event, ...args, tooling, gh, mint, log });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
