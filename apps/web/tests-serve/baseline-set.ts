import { existsSync } from "node:fs";
import { join } from "node:path";

export const BASELINE_BOOTSTRAP_REASON =
  "W-350 bootstrap: no screenshot baseline set is committed; a follow-up opus owns the reviewed runner artifact";

export const BASELINE_FILES = [
  "inbox-1280.png",
  "board-1280.png",
  "seats-1280.png",
  "officina-1280.png",
  "inbox-390.png",
  "board-390.png",
  "seats-390.png",
  "officina-390.png",
  "rendering-environment.json",
] as const;

export interface BaselineSource {
  eventName: "workflow_dispatch";
  ref: "refs/heads/master";
  sha: string;
}

export function readBaselineWriteSource(
  refresh = process.env["BISELLIUM_UPDATE_SCREENSHOTS"],
  githubActions = process.env["GITHUB_ACTIONS"],
  eventName = process.env["GITHUB_EVENT_NAME"],
  ref = process.env["GITHUB_REF"],
  sha = process.env["GITHUB_SHA"],
): BaselineSource | undefined {
  if (refresh === undefined || refresh === "0") return undefined;
  if (refresh !== "1") throw new Error("BISELLIUM_UPDATE_SCREENSHOTS must be absent, 0 or 1");
  if (githubActions !== "true") throw new Error("screenshot baselines may be written only by GitHub Actions");
  if (eventName !== "workflow_dispatch") throw new Error("screenshot baseline refresh requires workflow_dispatch");
  if (ref !== "refs/heads/master") throw new Error("screenshot baseline refresh requires refs/heads/master");
  if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) throw new Error("screenshot baseline refresh requires a 40-character lowercase GITHUB_SHA");
  return { eventName, ref, sha };
}

export function readBaselineSource(value: unknown): BaselineSource {
  if (typeof value !== "object" || value === null) throw new Error("baseline provenance is missing");
  const source = value as Record<string, unknown>;
  if (source["eventName"] !== "workflow_dispatch") throw new Error("baseline provenance requires workflow_dispatch");
  if (source["ref"] !== "refs/heads/master") throw new Error("baseline provenance requires refs/heads/master");
  if (typeof source["sha"] !== "string" || !/^[0-9a-f]{40}$/.test(source["sha"]))
    throw new Error("baseline provenance requires a 40-character lowercase commit sha");
  if (Object.keys(source).sort().join(",") !== "eventName,ref,sha") throw new Error("baseline provenance has unexpected fields");
  return { eventName: "workflow_dispatch", ref: "refs/heads/master", sha: source["sha"] };
}

export function baselineSetState(root: string): "absent" | "complete" {
  const present = BASELINE_FILES.filter((file) => existsSync(join(root, file)));
  if (present.length === 0) return "absent";
  if (present.length === BASELINE_FILES.length) return "complete";
  const missing = BASELINE_FILES.filter((file) => !present.includes(file));
  throw new Error(`partial screenshot baseline set: present [${present.join(", ")}], missing [${missing.join(", ")}]`);
}
