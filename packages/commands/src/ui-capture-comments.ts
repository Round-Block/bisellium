import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontMatter } from "@bisellium/adapter-native";
import { currentDesign, readContainedRegularFile, readServedShots, type NativeRecord } from "./opus-model.js";
import { appendPatronTimeline } from "./writes.js";

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

export interface UiCaptureComment {
  version: 1;
  kind: "ui_capture_comment";
  id: string;
  at: string;
  author: "patron" | "design-lead";
  opus: string;
  tree: string;
  designDigest: string;
  manifestSha256: string;
  image: string;
  imageSha256: string;
  viewport: { width: number; height: number };
  selector: string;
  state: string;
  pin: { x: number; y: number };
  body: string;
}

export type UiCaptureCommentInput = Omit<UiCaptureComment, "version" | "kind" | "id" | "at">;
export type UiCaptureCommentsRead = { comments: UiCaptureComment[] } | { problems: string[] };
export type UiCaptureCommentWrite = { ok: true; record: UiCaptureComment } | { ok: false; error: string };
export type UiCaptureReviewRead = { sets: Array<UiCaptureSet & { comments: UiCaptureComment[] }> } | { problems: string[] };

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

const noControls = (value: string): boolean => !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const textIn = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && noControls(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const hexDigest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const unit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function commentProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "comment record must be an object";
  const c = value as Record<string, unknown>;
  if (c["version"] !== 1 || c["kind"] !== "ui_capture_comment") return "comment record has another version or kind";
  if (!textIn(c["id"], 80) || !/^UC-[A-Za-z0-9-]+$/.test(c["id"])) return "comment id is malformed";
  if (typeof c["at"] !== "string" || !UTC.test(c["at"])) return "comment timestamp is malformed";
  if (c["author"] !== "patron" && c["author"] !== "design-lead") return "comment author is not recognised";
  if (typeof c["opus"] !== "string" || !OPUS.test(c["opus"]) || typeof c["tree"] !== "string" || !TREE.test(c["tree"])) return "comment opus or tree is malformed";
  if (!digest(c["designDigest"]) || !hexDigest(c["manifestSha256"]) || !hexDigest(c["imageSha256"])) return "comment digest is malformed";
  if (!textIn(c["image"], 26) || !/^[a-z][a-z0-9-]{0,21}\.png$/.test(c["image"])) return "comment image is malformed";
  const viewport = c["viewport"] as Record<string, unknown> | undefined;
  if (typeof viewport !== "object" || viewport === null || !Number.isInteger(viewport["width"]) || !Number.isInteger(viewport["height"]) || (viewport["width"] as number) < 390 || (viewport["height"] as number) < 600)
    return "comment viewport is malformed";
  const pin = c["pin"] as Record<string, unknown> | undefined;
  if (typeof pin !== "object" || pin === null || !unit(pin["x"]) || !unit(pin["y"])) return "comment pin must be inside the image";
  if (!textIn(c["selector"], 200)) return "selector must be 1 to 200 characters without control characters";
  if (!textIn(c["state"], 80)) return "state must be 1 to 80 characters without control characters";
  if (!textIn(c["body"], 1000)) return "comment must be 1 to 1000 characters without control characters";
  return undefined;
}

function asComment(value: unknown): UiCaptureComment | undefined {
  if (commentProblem(value) !== undefined) return undefined;
  const { role: _role, ...record } = value as UiCaptureComment & { role?: unknown };
  return record;
}

/** Bounded ui_capture_comment lines in the existing Patron timeline; unrelated timeline events are ignored. */
export function readUiCaptureComments(root: string, set: UiCaptureSet): UiCaptureCommentsRead {
  const file = readContainedRegularFile(root, "timeline/patron.jsonl", "timeline", 1024 * 1024);
  if ("error" in file) return file.code === "ENOENT" ? { comments: [] } : { problems: [`capture comment timeline is unsafe or unreadable: ${file.error}`] };
  const lines = file.bytes.toString("utf8").split("\n").filter(Boolean);
  const comments: UiCaptureComment[] = [];
  const problems: string[] = [];
  for (const [index, line] of lines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      if (line.includes('"ui_capture_comment"')) problems.push(`capture comment line ${index + 1}: record is not valid JSON`);
      continue; // another timeline producer owns unrelated malformed history
    }
    if (typeof value !== "object" || value === null || (value as Record<string, unknown>)["kind"] !== "ui_capture_comment") continue;
    const problem = commentProblem(value);
    if (problem !== undefined) {
      problems.push(`capture comment line ${index + 1}: ${problem}`);
      continue;
    }
    const comment = asComment(value)!;
    const shot = set.shots.find((candidate) => candidate.name === comment.image);
    if (comment.opus === set.opus && comment.tree === set.tree && comment.designDigest === set.designDigest && comment.manifestSha256 === set.manifestSha256 && shot?.sha256 === comment.imageSha256)
      comments.push(comment);
  }
  if (comments.length > 256) problems.push("capture set has more than 256 comments");
  return problems.length > 0 ? { problems } : { comments };
}

/** Append one immutable pin only while every capture binding still matches the served-e2e set. */
export function appendUiCaptureComment(
  root: string,
  currentTree: string,
  input: UiCaptureCommentInput,
  opts: { now?: Date; id?: string } = {},
): UiCaptureCommentWrite {
  const read = readUiCaptureSets(root, currentTree);
  if ("problems" in read) return { ok: false, error: read.problems.join("; ") };
  const set = read.sets.find((candidate) => candidate.opus === input.opus);
  if (set === undefined || !set.current || input.tree !== set.tree || input.designDigest !== set.designDigest || input.manifestSha256 !== set.manifestSha256)
    return { ok: false, error: "capture set changed; reload before commenting" };
  const shot = set.shots.find((candidate) => candidate.name === input.image);
  if (shot === undefined || input.imageSha256 !== shot.sha256 || input.viewport.width !== shot.width || input.viewport.height !== shot.height)
    return { ok: false, error: "capture image changed; reload before commenting" };
  const record: UiCaptureComment = {
    version: 1,
    kind: "ui_capture_comment",
    id: opts.id ?? `UC-${randomUUID()}`,
    at: (opts.now ?? new Date()).toISOString(),
    author: input.author,
    opus: input.opus,
    tree: input.tree,
    designDigest: input.designDigest,
    manifestSha256: input.manifestSha256,
    image: input.image,
    imageSha256: input.imageSha256,
    viewport: input.viewport,
    selector: input.selector,
    state: input.state,
    pin: input.pin,
    body: input.body,
  };
  const problem = commentProblem(record);
  if (problem !== undefined) return { ok: false, error: problem };
  const existing = readUiCaptureComments(root, set);
  if ("problems" in existing) return { ok: false, error: existing.problems.join("; ") };
  if (existing.comments.length >= 256) return { ok: false, error: "capture set has 256 comments; no more can be added" };
  appendPatronTimeline(root, { ...record });
  return { ok: true, record };
}

/** Capture sets plus their current bound comments, ready for the local browser and review packet. */
export function readUiCaptureReview(root: string, currentTree: string, opus?: string): UiCaptureReviewRead {
  const read = opus === undefined
    ? readUiCaptureSets(root, currentTree)
    : (() => {
        if (!OPUS.test(opus) || !TREE.test(currentTree)) return { problems: ["capture review needs a valid opus and current source tree"] } satisfies UiCaptureSetsRead;
        const one = captureSet(root, opus, currentTree);
        return "problem" in one ? { problems: [`${opus}: ${one.problem}`] } : { sets: [one] };
      })();
  if ("problems" in read) return read;
  const sets: Array<UiCaptureSet & { comments: UiCaptureComment[] }> = [];
  const problems: string[] = [];
  for (const set of read.sets) {
    const comments = readUiCaptureComments(root, set);
    if ("problems" in comments) problems.push(...comments.problems.map((problem) => `${set.opus}: ${problem}`));
    else sets.push({ ...set, comments: comments.comments });
  }
  return problems.length > 0 ? { problems } : { sets };
}

/** Re-read and return only a PNG named by the selected set's existing manifest. */
export function readUiCaptureImage(
  root: string,
  currentTree: string,
  opus: string,
  name: string,
): { bytes: Buffer } | { error: string } {
  const read = readUiCaptureSets(root, currentTree);
  if ("problems" in read) return { error: read.problems.join("; ") };
  const set = read.sets.find((candidate) => candidate.opus === opus);
  if (set === undefined) return { error: "unknown capture set" };
  const shot = set.shots.find((candidate) => candidate.name === name);
  if (shot === undefined) return { error: "unknown capture image" };
  const file = readContainedRegularFile(root, `ci/shots/${opus}/${name}`, "ci", 4 * 1024 * 1024);
  if ("error" in file || sha256(file.bytes) !== shot.sha256) return { error: "capture image changed; reload" };
  return { bytes: file.bytes };
}
