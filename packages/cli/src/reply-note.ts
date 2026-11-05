/**
 * packages/cli/src/reply-note.ts — W-508: the note a main-thread reply's Stop leaves for that session's next turn. A Stop
 * hook runs after the reply is shown, so a reply rule never sends the reply back (the Patron would read it twice): its line
 * is left here and the guard hands it to the model at the session's next UserPromptSubmit, once.
 *
 * A note lives at `<home>/.bisellium-evidence/usage/reply-notes/<session id>`, written whole by a rename; a later note of
 * the session replaces it. A session id outside `SESSION_ID` is not a file name and has no note. The hook runs outside the
 * sandbox and this folder is writable from inside it, so no symlink is followed: the temp file is created exclusively, the
 * rename replaces what is at the note's path, and the read goes through the shared reader.
 */
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureRealDirectory, existingRealDirectory } from "@bisellium/commands/ids.js";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";

const LEVELS = [".bisellium-evidence", "usage", "reply-notes"] as const;
/** A session id as the note store takes it, written and read alike. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** A note is cut to this many characters (at most 4000 bytes), so the read's bound always admits it. */
const NOTE_CHARS = 1000;
const NOTE_MAX = 4096;
/** Whether `session` is a session id the note store takes: the one reading of it, at a Stop's write and at a prompt. */
export const noteSession = (session: unknown): session is string => typeof session === "string" && SESSION_ID.test(session);
/** Control characters (C0 and C1, newline included) become one space: a note's lines are data. */
const strip = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");

/** Leaves `lines` as the note of `session`, replacing an older one. Undefined when written, else why not; never a throw. */
export function leaveReplyNote(home: string, session: unknown, lines: readonly string[]): string | undefined {
  if (!noteSession(session)) return "no session id the note store takes";
  try {
    const dir = ensureRealDirectory(home, ...LEVELS);
    const temp = join(dir, `.${session}.${process.pid}`);
    writeFileSync(temp, [...lines.map(strip).join("\n")].slice(0, NOTE_CHARS).join(""), { flag: "wx" });
    renameSync(temp, join(dir, session));
    return undefined;
  } catch (e) {
    return strip(e instanceof Error ? e.message : String(e));
  }
}

/** The note of `session`, one string per line, removed as it is taken, so it is handed over once. Fail-open: an entry the
 *  shared reader refuses (not a regular file, a symlink included, or over 4 KiB), or that cannot be read or removed, is left
 *  and not handed. */
export function takeReplyNote(home: string, session: unknown): string[] {
  if (!noteSession(session)) return [];
  try {
    const dir = existingRealDirectory(home, ...LEVELS);
    if (dir === undefined) return [];
    const file = readContainedRegularFile(join(home, LEVELS[0]), `${LEVELS[1]}/${LEVELS[2]}/${session}`, LEVELS[1], NOTE_MAX);
    if ("error" in file) return [];
    unlinkSync(join(dir, session));
    return file.bytes.toString("utf8").split("\n").map(strip).filter((l) => l.trim() !== "");
  } catch {
    return [];
  }
}
