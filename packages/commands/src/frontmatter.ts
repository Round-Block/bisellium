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
import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";

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
  const newBody = mutate(doc, split.body);
  writeFileSync(path, `---\n${doc.toString({ lineWidth: 0 })}---\n${newBody ?? split.body}`);
}
