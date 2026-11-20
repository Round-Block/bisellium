/**
 * apps/server/src/reviewRequests.ts — W-702 (D-250): the console's read of the review snapshots `bisellium review-request`
 * writes at `<git common dir>/bisellium/review-requests/<number>.json` (packages/cli/src/review-snapshot.ts).
 *
 * Once per poll, read-only: the server never runs `gh`, follows a review URL or holds a forge token, and spawns nothing
 * here (the Git common directory is the one the branch-record probe already resolved). The projection is all or
 * nothing: every `<number>.json` must be a regular file of at most 64 KiB that `reviewRequestShape` (@bisellium/schema,
 * the writer's own check) holds, under its own number, or the whole `reviewRequests` member is absent and one
 * diagnostic line names why; an empty directory is `[]`; no directory (no snapshot was ever written in this clone),
 * or no repository, is absent and normal. A dot name (a writer's temporary file) and any other name are not snapshots.
 * Every reason is a fixed code and a file name the name grammar bounds: never a message or a path.
 */
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { REVIEW_REQUEST_FILE, REVIEW_REQUEST_LEVELS, REVIEW_REQUEST_MAX_BYTES, REVIEW_REQUEST_MAX_FILES, REVIEW_REQUEST_SCHEMA, type ReviewRequest, reviewRequestShape } from "@bisellium/schema";
import { DEFAULT_GIT_TIMEOUT_MS, readBoundedRegular } from "./branchRecords.js";

export type ReviewRequestsStatus = "ok" | "no-repo" | "none" | "unreadable" | "malformed" | "stale" | "too-many";
export interface ReviewRequestsRead {
  requests?: ReviewRequest[];
  status: ReviewRequestsStatus;
  /** The snapshot file the status names, when one does. */
  file?: string;
}
export const REVIEW_STATUS_PREFIX = "bisellium serve: review requests ";

/** The projection under `commonDir` (undefined: no repository), never throwing. */
export async function readReviewRequests(commonDir: string | undefined, timeoutMs: number = DEFAULT_GIT_TIMEOUT_MS): Promise<ReviewRequestsRead> {
  if (commonDir === undefined) return { status: "no-repo" };
  try {
    let dir = commonDir;
    for (const level of REVIEW_REQUEST_LEVELS) {
      dir = join(dir, level);
      const st = await lstat(dir).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? undefined : Promise.reject(e)));
      if (st === undefined) return { status: "none" };
      if (!st.isDirectory()) return { status: "unreadable" };
    }
    const names = (await readdir(dir)).filter((n) => REVIEW_REQUEST_FILE.test(n));
    if (names.length > REVIEW_REQUEST_MAX_FILES) return { status: "too-many" };
    const requests: ReviewRequest[] = [];
    for (const file of names.sort((a, b) => Number(REVIEW_REQUEST_FILE.exec(a)![1]) - Number(REVIEW_REQUEST_FILE.exec(b)![1]))) {
      const read = await readBoundedRegular(join(dir, file), dir, REVIEW_REQUEST_MAX_BYTES, { timeoutMs });
      if ("refused" in read) return { status: "unreadable", file };
      let value: unknown;
      try {
        value = JSON.parse(read.text);
      } catch {
        return { status: "malformed", file };
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>)["schema"] !== REVIEW_REQUEST_SCHEMA) return { status: "stale", file };
      let request: ReviewRequest;
      try {
        request = reviewRequestShape(value);
      } catch {
        return { status: "malformed", file };
      }
      if (String(request.number) !== REVIEW_REQUEST_FILE.exec(file)![1]) return { status: "malformed", file };
      requests.push(request);
    }
    return { requests, status: "ok" };
  } catch {
    return { status: "unreadable" };
  }
}

/** The per-poll reader: the last projection, and one stderr line whenever an abnormal status changes. */
export class ReviewRequestReader {
  private lastKey = "none|";

  async refresh(commonDir: string | undefined, timeoutMs?: number): Promise<ReviewRequest[] | undefined> {
    const read = await readReviewRequests(commonDir, timeoutMs);
    const key = `${read.status === "no-repo" ? "none" : read.status}|${read.file ?? ""}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      if (read.status !== "no-repo" && read.status !== "none")
        process.stderr.write(`${REVIEW_STATUS_PREFIX}${JSON.stringify({ status: read.status, ...(read.file === undefined ? {} : { file: read.file }), ...(read.requests === undefined ? {} : { count: read.requests.length }) })}\n`);
    }
    return read.requests;
  }
}
