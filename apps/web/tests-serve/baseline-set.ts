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

export function baselineSetState(root: string): "absent" | "complete" {
  const present = BASELINE_FILES.filter((file) => existsSync(join(root, file)));
  if (present.length === 0) return "absent";
  if (present.length === BASELINE_FILES.length) return "complete";
  const missing = BASELINE_FILES.filter((file) => !present.includes(file));
  throw new Error(`partial screenshot baseline set: present [${present.join(", ")}], missing [${missing.join(", ")}]`);
}
