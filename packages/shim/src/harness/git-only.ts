/**
 * @bisellium/shim/harness — 'git-only', tier 3: a sella whose collegium has
 * no vendor CLI wired up at all (docs/STUDIO.md §10: not every seat needs
 * one). Always "available" — there's nothing to probe — but talking to it
 * is a contradiction in terms, so start/resume refuse rather than silently
 * degrading to a fake conversation.
 */
import type { HarnessProfile, HarnessResumeOpts, HarnessStartOpts, Turn } from "./types.js";

export const gitOnlyProfile: HarnessProfile = {
  id: "git-only",
  tier: 3,

  async available(): Promise<boolean> {
    return true;
  },

  async start(_opts: HarnessStartOpts): Promise<Turn> {
    throw new Error("git-only harness cannot talk");
  },

  async resume(_opts: HarnessResumeOpts): Promise<Turn> {
    throw new Error("git-only harness cannot talk");
  },
};
