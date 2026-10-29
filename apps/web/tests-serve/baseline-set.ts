import { existsSync } from "node:fs";
import { join } from "node:path";
import { NAV_ENTRIES } from "../src/lib/nav.js";

export const BASELINE_BOOTSTRAP_REASON =
  "W-350 bootstrap: no screenshot baseline set is committed; a follow-up opus owns the reviewed runner artifact";

/** W-454: the baseline widths, desktop then phone: screenshots.spec.ts's `VIEWPORTS` (W-350). */
export const BASELINE_WIDTHS = [1280, 390] as const;

/** W-454: one baseline per route at each width, desktop first, then the rendering identity. */
export function baselineFiles(entries: readonly { route: string }[]): string[] {
  return [...BASELINE_WIDTHS.flatMap((width) => entries.map(({ route }) => `${route}-${width}.png`)), "rendering-environment.json"];
}

/** W-454: the committed baseline set is the live navigation table's, so a new rail entry needs no second edit. */
export const BASELINE_FILES: readonly string[] = baselineFiles(NAV_ENTRIES);

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
