import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontMatter } from "@bisellium/adapter-native";
import { currentDesign, readContainedRegularFile, readServedShots, type NativeRecord } from "./opus-model.js";

const SET_MAX = 64;
const OPUS = /^W-[0-9]+$/;
const TREE = /^tree:[0-9a-f]{40}$/;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;

export interface UiCaptureShot {
  name: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export interface UiCaptureSet {
  opus: string;
  title: string;
  tree: string;
  current: boolean;
  capturedAt: string;
  designDigest: string;
  manifestSha256: string;
  shots: UiCaptureShot[];
}

export type UiCaptureSetsRead = { sets: UiCaptureSet[] } | { problems: string[] };

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function captureSet(root: string, opus: string, currentTree: string): UiCaptureSet | { problem: string } {
  const recordFile = readContainedRegularFile(root, `opera/${opus}.md`, "opera");
  if ("error" in recordFile) return { problem: `opus record is unsafe or unreadable: ${recordFile.error}` };
  let record: NativeRecord;
  try {
    record = parseFrontMatter(recordFile.bytes.toString("utf8"), `opera/${opus}.md`).data as NativeRecord;
  } catch (error) {
    return { problem: `opus record is unparseable: ${(error as Error).message}` };
  }
  if (record.id !== opus || record.kind !== "ui" || typeof record.title !== "string")
    return { problem: "capture set requires the matching kind ui opus record and string title" };
  const gates = typeof record.probationes === "object" && record.probationes !== null && !Array.isArray(record.probationes)
    ? record.probationes as Record<string, unknown>
    : {};
  const served = typeof gates["served-e2e"] === "object" && gates["served-e2e"] !== null && !Array.isArray(gates["served-e2e"])
    ? gates["served-e2e"] as Record<string, unknown>
    : {};
  const tree = served["certifies"];
  const capturedAt = served["at"];
  if (served["status"] !== "passed" || typeof tree !== "string" || !TREE.test(tree) || typeof capturedAt !== "string" || !UTC.test(capturedAt))
    return { problem: "capture set requires a passed served-e2e gate with a clean tree certificate and timestamp" };
  const design = currentDesign(root, record, opus);
  if (design.digest === undefined) return { problem: design.error ?? "capture set has no current design digest" };
  const manifest = readContainedRegularFile(root, `ci/shots/${opus}/manifest.txt`, "ci", 8 * 1024);
  if ("error" in manifest) return { problem: `served-e2e screenshot manifest is unsafe or unreadable: ${manifest.error}` };
  const shots = readServedShots(root, opus);
  if ("problems" in shots) return { problem: shots.problems.join("; ") };
  return {
    opus,
    title: record.title,
    tree,
    current: tree === currentTree,
    capturedAt,
    designDigest: design.digest,
    manifestSha256: sha256(manifest.bytes),
    shots: shots.shots.map((shot) => ({
      name: shot.name,
      width: shot.width,
      height: shot.height,
      bytes: shot.bytes.length,
      sha256: sha256(shot.bytes),
    })),
  };
}

/** The existing served-e2e directories, re-read through the same bounded manifest/image reader as check. */
export function readUiCaptureSets(root: string, currentTree: string): UiCaptureSetsRead {
  if (!TREE.test(currentTree)) return { problems: ["current source tree must be a clean tree certificate"] };
  let names: string[];
  try {
    names = readdirSync(join(root, "ci", "shots")).filter((name) => OPUS.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sets: [] };
    return { problems: ["served-e2e capture directory is unreadable"] };
  }
  if (names.length > SET_MAX) return { problems: [`served-e2e capture directory declares more than ${SET_MAX} capture sets`] };
  const sets: UiCaptureSet[] = [];
  const problems: string[] = [];
  for (const opus of names) {
    const read = captureSet(root, opus, currentTree);
    if ("problem" in read) problems.push(`${opus}: ${read.problem}`);
    else sets.push(read);
  }
  return problems.length > 0 ? { problems } : { sets };
}

