/**
 * @bisellium/shim/harness — the direct-line seam `bisellium talk` drives
 * (W-010). A HarnessProfile wraps one vendor CLI (or a stub) behind one
 * start/resume contract so talk.ts never special-cases which vendor a
 * sella's collegium happens to run on.
 */
export interface TurnUsage {
  input?: number;
  output?: number;
}

/** One request/response exchange with a harness. `exitCode` is the
 *  process-level outcome: 0 ok, 3 a vendor-reported usage limit (reply is
 *  '', the error text lives in `raw`), anything else an honest failure. */
export interface Turn {
  sessionId: string;
  reply: string;
  model?: string;
  usage?: TurnUsage;
  /** The vendor CLI's own parsed (or, failing that, raw) output — kept for
   *  diagnostics; never assumed to have a particular shape by callers. */
  raw?: unknown;
  exitCode: number;
}

export interface HarnessStartOpts {
  cwd: string;
  sella: string;
  systemPrompt: string;
  message: string;
  /** W-049: the parent env a vendor profile projects through the harness
   *  allowlist (`harness/env.ts`'s `harnessEnv`) before it ever reaches a
   *  vendor spawn — not "the env the child gets" outright. The `fake`
   *  profile is the one exception: its test double reads test flags
   *  (e.g. `BISELLIUM_FAKE_MODE`) straight out of this field in-process,
   *  since it never spawns a vendor binary for the allowlist to guard. */
  env: NodeJS.ProcessEnv;
}

export interface HarnessResumeOpts {
  cwd: string;
  sella: string;
  sessionId: string;
  message: string;
  /** See HarnessStartOpts.env. */
  env: NodeJS.ProcessEnv;
}

export interface HarnessProfile {
  id: string;
  /** 1 = first-party subscription CLI, 2 = secondary vendor CLI, 3 = cannot talk at all (git-only). */
  tier: 1 | 2 | 3;
  available(): Promise<boolean>;
  start(opts: HarnessStartOpts): Promise<Turn>;
  resume(opts: HarnessResumeOpts): Promise<Turn>;
}

/** A Turn at this exitCode means the vendor reported a usage/rate limit —
 *  talk.ts maps it to posture "limited", never to a generic failure. */
export const USAGE_LIMIT_EXIT_CODE = 3;
