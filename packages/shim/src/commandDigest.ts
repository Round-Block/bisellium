/**
 * @bisellium/shim — the one binding of a gate log to the exact commands that produced it (W-610 for the light log; the
 * cause-fix opus extends it to every full gate log). A log's line 2 is `command: sha256:<64 hex>`, the SHA-256 of the
 * JSON array of the commands in run order: a collision-resistant encoding, so `["a ; b"]` and `["a", "b"]` differ, and a command
 * that spans lines never moves line 3 (`exit code: <n>`). It is our own metadata, never passed through `redact`.
 */
import { createHash } from "node:crypto";

/** `sha256:<64 hex>` of the JSON array `commands`, in order. */
export function commandDigest(commands: readonly string[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(commands)).digest("hex")}`;
}

/** A gate log's line 2 for `commands`. */
export const commandLine = (commands: readonly string[]): string => `command: ${commandDigest(commands)}`;

/** Whether a log's line 2 binds exactly `commands`. */
export const bindsCommands = (line: string | undefined, commands: readonly string[]): boolean => line === commandLine(commands);
