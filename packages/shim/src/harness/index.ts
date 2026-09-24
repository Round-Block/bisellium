/**
 * @bisellium/shim/harness — the registry `bisellium talk` resolves a
 * sella's `harness` manifest key (default "claude-code") against.
 */
import type { HarnessProfile } from "./types.js";
import { claudeCodeProfile } from "./claude-code.js";
import { codexProfile } from "./codex.js";
import { gitOnlyProfile } from "./git-only.js";
import { fakeProfile } from "./fake.js";

export type { HarnessProfile, HarnessStartOpts, HarnessResumeOpts, Turn, TurnUsage } from "./types.js";
export { USAGE_LIMIT_EXIT_CODE } from "./types.js";
export { claudeCodeProfile } from "./claude-code.js";
export { codexProfile } from "./codex.js";
export { gitOnlyProfile } from "./git-only.js";
export { fakeProfile } from "./fake.js";
export type { ListedModel } from "./catalog.js";
export { codexListModels, harnessVersions } from "./catalog.js";

/** id -> profile, for every harness talk.ts can pick a sella's `harness` against. */
export const HARNESS_PROFILES: Record<string, HarnessProfile> = {
  [claudeCodeProfile.id]: claudeCodeProfile,
  [codexProfile.id]: codexProfile,
  [gitOnlyProfile.id]: gitOnlyProfile,
  [fakeProfile.id]: fakeProfile,
};

export function resolveHarness(id: string): HarnessProfile | undefined {
  return HARNESS_PROFILES[id];
}
