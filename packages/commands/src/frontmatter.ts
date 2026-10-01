/**
 * packages/cli/src/frontmatter.ts — the one seam every write command uses to
 * touch a studio markdown file's YAML front matter. Extracted out of
 * verify.ts (the first tool-written change to an opus) so every later write
 * command (verify, handoff, answer, greenlight) shares the exact same
 * discipline: parse the front matter with the yaml Document API and mutate
 * it in place (`.setIn`/`.deleteIn`, never a wholesale replace) so untouched
 * keys, comments and key order survive, and carry the body through
 * byte-for-byte unless a caller explicitly rewrites it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";

export const ISOLATED_BUILDER_RUNTIME = "isolated" as const;

export type BuilderRuntimeObligation =
  | { kind: "legacy" }
  | { kind: "marked" }
  | { kind: "invalid"; error: string };

export interface SplitFrontMatter {
  front: string;
  body: string;
}

/**
 * Front-matter split that keeps the body byte-for-byte — unlike
 * `@bisellium/adapter-native`'s `readFront`, which trims the body.
 */
export function splitFront(raw: string): SplitFrontMatter | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.replace(/^﻿/, ""));
  if (!m) return undefined;
  return { front: m[1] ?? "", body: m[2] ?? "" };
}

function git(cwd: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
}

function markerValue(raw: string, source: string): unknown {
  const split = splitFront(raw);
  if (!split) throw new Error(`${source}: missing front matter`);
  const doc = parseDocument(split.front);
  if (doc.errors.length > 0) throw new Error(`${source}: malformed front matter`);
  const data = doc.toJS() as Record<string, unknown> | null;
  return data?.["builder_runtime"];
}

function repositoryBoundary(path: string): string | undefined {
  let cursor = resolve(dirname(path));
  for (;;) {
    const dotGit = resolve(cursor, ".git");
    if (existsSync(dotGit)) {
      const stat = lstatSync(dotGit);
      if (stat.isFile() || (stat.isDirectory() && existsSync(resolve(dotGit, "HEAD")))) return cursor;
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

/**
 * Classifies the permanent isolated-runtime obligation. A current malformed
 * value always fails closed. For an absent value, reachable record history
 * prevents an out-of-band deletion from restoring legacy admission.
 *
 * A record outside a Git work tree remains a legacy fixture. This preserves
 * the pre-W-125 writer contract for in-memory/temp officinae while deployed
 * native records, which live in a repository, receive the marker semantics.
 */
export function builderRuntimeObligation(path: string): BuilderRuntimeObligation {
  let current: unknown;
  try { current = markerValue(readFileSync(path, "utf8"), path); }
  catch (error) { return { kind: "invalid", error: (error as Error).message }; }
  if (current !== undefined && current !== ISOLATED_BUILDER_RUNTIME)
    return { kind: "invalid", error: `${path}: builder_runtime must be exactly ${ISOLATED_BUILDER_RUNTIME}` };

  if (repositoryBoundary(path) === undefined) return { kind: "legacy" };
  const rootResult = git(dirname(path), ["rev-parse", "--show-toplevel"]);
  if (rootResult.error !== undefined || rootResult.status !== 0)
    return current === ISOLATED_BUILDER_RUNTIME ? { kind: "marked" } : { kind: "legacy" };
  const repo = resolve(String(rootResult.stdout).trim());
  const rel = relative(repo, resolve(path)).split(sep).join("/");
  if (rel === "" || rel.split("/")[0] === "..")
    return { kind: "invalid", error: `${path}: record history is outside the repository` };

  if (current === ISOLATED_BUILDER_RUNTIME) return { kind: "marked" };

  const historyResult = git(repo, ["log", "--full-history", "--format=%H", "HEAD", "--", rel]);
  if (historyResult.error !== undefined || historyResult.status !== 0)
    return { kind: "invalid", error: `${path}: builder_runtime history is unavailable` };
  const commits = String(historyResult.stdout).trim().split("\n").filter(Boolean);
  for (const commit of commits) {
    const shown = git(repo, ["show", `${commit}:${rel}`]);
    if (shown.error !== undefined || shown.status !== 0)
      return { kind: "invalid", error: `${path}: builder_runtime history is incomplete at ${commit}` };
    try {
      if (markerValue(String(shown.stdout), `${commit}:${rel}`) === ISOLATED_BUILDER_RUNTIME)
        return { kind: "invalid", error: `${path}: builder_runtime is missing after its reachable introduction` };
    } catch (error) {
      return { kind: "invalid", error: (error as Error).message };
    }
  }
  return { kind: "legacy" };
}

/**
 * Reads `path`, hands its parsed front matter (a yaml `Document` — mutate it
 * in place, never replace it) and current body to `mutate`, then writes the
 * merged result back. `mutate` returns the new body text, or `undefined` to
 * leave the body exactly as it was (preserved byte-for-byte).
 *
 * Throws if `path` has no `---`-delimited front matter — callers translate
 * that into their own exit code / usage error.
 *
 * `lineWidth: 0` disables yaml's default 80-col reflow, which would
 * otherwise refold any untouched flow-mapping line longer than 80 chars
 * (e.g. a real `traditio` line) into a multi-line block on the first
 * tool-written change to a file — a spurious diff on data this write must
 * not touch.
 */
export function editOpusFrontMatter(
  path: string,
  mutate: (doc: ReturnType<typeof parseDocument>, body: string) => string | undefined,
): void {
  const raw = readFileSync(path, "utf8");
  const split = splitFront(raw);
  if (!split) throw new Error(`${path}: missing front matter`);
  const doc = parseDocument(split.front);
  if (doc.errors.length > 0) throw new Error(`${path}: malformed front matter`);
  const obligation = builderRuntimeObligation(path);
  if (obligation.kind === "invalid") throw new Error(obligation.error);
  const before = doc.get("builder_runtime");
  const newBody = mutate(doc, split.body);
  const after = doc.get("builder_runtime");
  if (after !== undefined && after !== ISOLATED_BUILDER_RUNTIME)
    throw new Error(`${path}: builder_runtime must be exactly ${ISOLATED_BUILDER_RUNTIME}`);
  if (before === ISOLATED_BUILDER_RUNTIME && after !== ISOLATED_BUILDER_RUNTIME)
    throw new Error(`${path}: builder_runtime is immutable`);
  writeFileSync(path, `---\n${doc.toString({ lineWidth: 0 })}---\n${newBody ?? split.body}`);
}

/** Introduces the marker once through the shared immutable writer. */
export function markIsolatedBuilderRuntime(path: string): void {
  editOpusFrontMatter(path, (doc) => {
    doc.set("builder_runtime", ISOLATED_BUILDER_RUNTIME);
    return undefined;
  });
}
