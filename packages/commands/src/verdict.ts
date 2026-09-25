import type { WriteOptions, WriteResult } from "./writes.js";

export const VERDICT_USAGE =
  "usage: bisellium verdict <opus> --round <n> --sella <id> --outcome <text> [--phase spec|build] [--model <id>] [--from <path>] [--studio <dir>] [--now <iso>]";

export interface VerdictOptions extends WriteOptions {
  stdin?: Buffer;
}

/** Pre-implementation skeleton: exported, but deliberately writes nothing. */
export function runVerdict(_args: string[], _opts: VerdictOptions = {}): WriteResult {
  return { exitCode: 0 };
}
