/**
 * packages/commands/src/prototype-line.ts — W-326's reading of a brief's one `Prototype: <path> sha256:<64 hex>` line and of
 * the series file it names, moved unchanged from packages/cli/src/prototype-replay.ts (which re-exports them) by W-563, so
 * `verdict --phase spec`'s pre-sign gate reads the same line the replay reads.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The cap on the series file: a prototype is a few source files, never a vendored tree. */
export const SERIES_MAX_BYTES = 8 * 1024 * 1024;
const ATTEMPT = /^prototype\s*:/i;
const LINE = /^Prototype: ((?:\/|~\/)\S+) sha256:([0-9a-f]{64})$/;

export interface Prototype {
  /** as the brief names it */
  named: string;
  /** absolute, `~/` expanded */
  path: string;
  digest: string;
}

/** Lines outside fenced blocks (a fence line reads as blank). ponytail: HTML comments are read, the brief is the architect's own signed text. */
function unfenced(brief: string): string[] {
  let fence = false;
  return brief.split(/\r?\n/).map((line) => {
    if (/^\s{0,3}```/.test(line)) {
      fence = !fence;
      return "";
    }
    return fence ? "" : line;
  });
}

/** The brief's one Prototype line: none is undefined; two, or one in another form, is an error. */
export function readPrototype(brief: string): Prototype | { error: string } | undefined {
  const attempts = unfenced(brief)
    .map((l) => l.trim())
    .filter((l) => ATTEMPT.test(l));
  if (attempts.length === 0) return undefined;
  if (attempts.length > 1) return { error: `the brief has ${attempts.length} Prototype lines; one only` };
  const m = LINE.exec(attempts[0]!);
  if (m === null) return { error: `the Prototype line "${attempts[0]}" is not "Prototype: <absolute or ~/ path> sha256:<64 lowercase hex>"` };
  const named = m[1]!;
  let path: string;
  try {
    path = named.startsWith("~/") ? join(homedir(), named.slice(2)) : named;
  } catch {
    return { error: `${named}: the home directory cannot be read` };
  }
  return { named, path, digest: m[2]! };
}

/** The series file's text when it is a regular file under the cap whose sha256 is the one the brief names. */
export function loadSeries(p: Prototype): { text: string } | { error: string } {
  let bytes: Buffer;
  try {
    const st = statSync(p.path);
    if (!st.isFile() || st.size > SERIES_MAX_BYTES) return { error: `${p.named} is not a regular file of at most ${SERIES_MAX_BYTES} bytes` };
    bytes = readFileSync(p.path);
  } catch {
    return { error: `${p.named} cannot be read` };
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== p.digest) return { error: `${p.named} has sha256 ${digest}, not the ${p.digest} the signed brief names` };
  return { text: bytes.toString("utf8") };
}
