/**
 * packages/commands/src/trunk.ts — W-124: the one "is this merge in the local
 * trunk" predicate. It lives in `packages/commands` (not `packages/cli`) so a
 * later `done` refusal (W-123) can import `@bisellium/commands/trunk.js`
 * without a cli -> commands cycle.
 *
 * The input is hardened before any spawn: the merge commit id must be 40
 * lowercase hex and not all zeros (so it can never be read as an option or a
 * revision expression), the trunk is the fully qualified `TRUNK_REF`, and only
 * `git merge-base --is-ancestor <oid> <TRUNK_REF>` exiting 0 is true. Exit 1 is
 * false; every other exit, a spawn error or a timeout is false with a reason.
 * The caller must already have checked the PR's `baseRefName == master`.
 */
import { spawnSync } from "node:child_process";

/** Trunk is the literal `master`, as in `scripts/open-pr.sh` and `merge-gate.sh`. */
export const TRUNK_REF = "refs/heads/master";

export type TrunkContains = { ok: true } | { ok: false; reason: string };

const OID = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 30_000;

/** True only for a well-formed, non-null commit id (the shape `git` can safely receive). */
export function wellFormedOid(oid: unknown): oid is string {
  return typeof oid === "string" && OID.test(oid) && !/^0+$/.test(oid);
}

export function trunkContainsMerge(repo: string, oid: unknown): TrunkContains {
  if (!wellFormedOid(oid)) return { ok: false, reason: "merge commit id is not a 40-hex, non-zero commit id" };
  const r = spawnSync("git", ["merge-base", "--is-ancestor", oid, TRUNK_REF], { cwd: repo, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (r.error !== undefined) return { ok: false, reason: `git could not run: ${r.error.message}` };
  if (r.status === 0) return { ok: true };
  if (r.status === 1) return { ok: false, reason: `${oid.slice(0, 12)} is not contained in ${TRUNK_REF}` };
  return { ok: false, reason: `git merge-base exited ${r.status ?? "without a status"} for ${oid.slice(0, 12)}` };
}
