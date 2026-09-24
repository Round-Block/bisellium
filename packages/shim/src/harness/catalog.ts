/**
 * @bisellium/shim/harness/catalog.ts — W-069: the two vendor-CLI calls that
 * are neither a turn nor a profile method. Hoisted out of
 * apps/server/src/http.ts (Sol finding 6, revision 1's red-team): a second
 * definition of "what codex lists" in a second package is guaranteed drift,
 * and the old definition degraded every failure (missing binary, non-zero
 * exit, unparseable or wrong-shaped JSON) to `[]` — which
 * `createListingCache` then read as `ok: true` and `mergeModelsWithListing`
 * read as "codex listed nothing", silently withdrawing every codex model
 * from a shipped screen. `codexListModels` here REJECTS on every one of
 * those failure modes instead; that is the ONLY change from the moved
 * function — the 5s `execFile` timeout, the `visibility === "list"` filter
 * and the `harness: "codex"` tagging are unchanged. Every caller handles the
 * rejection: `createListingCache`'s existing `catch` already does
 * (apps/server/src/http.ts), and `probeBattery` does per behaviour 8
 * (packages/commands/src/probe.ts).
 *
 * `harnessVersions` is new: each vendor CLI's own `--version` line,
 * trimmed, verbatim, spawned through `harnessEnv(process.env)` (W-049's
 * ten-name allowlist) like every other spawn in this package. A vendor
 * that's absent, fails or times out yields `undefined` for that key —
 * `undefined` means "unknown", never a change; W-071's trigger fires on
 * defined-vs-defined only.
 */
import { execFile } from "node:child_process";
import { harnessEnv } from "./env.js";

export interface ListedModel {
  id: string;
  harness: string;
}

const LIST_TIMEOUT_MS = 5_000;
const VERSION_TIMEOUT_MS = 10_000;

/** `codex debug models` — a local catalog call, no turn, no metered tokens.
 *  REJECTS on any failure (missing binary, non-zero exit, unparseable or
 *  wrong-shaped JSON). It does NOT degrade to `[]`: an empty array is a
 *  truthful "codex listed nothing", and conflating the two is the
 *  false-withdrawal bug this move closes (Sol finding 6). The moved
 *  function's own timeout, filter and tagging are unchanged — the ONLY
 *  change from the original (apps/server/src/http.ts:262-282) is that every
 *  one of these four failure modes now rejects instead of resolving `[]`. */
export function codexListModels(): Promise<ListedModel[]> {
  return new Promise((resolvePromise, reject) => {
    execFile("codex", ["debug", "models"], { timeout: LIST_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { models?: { slug?: unknown; visibility?: unknown }[] };
        if (!Array.isArray(parsed.models)) {
          reject(new Error("codex debug models: response has no models array"));
          return;
        }
        resolvePromise(
          parsed.models
            .filter((m) => m.visibility === "list" && typeof m.slug === "string")
            .map((m) => ({ id: m.slug as string, harness: "codex" })),
        );
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/** Each vendor CLI's `--version` line, trimmed, VERBATIM — never parsed,
 *  never compared as a semver. A vendor that is absent, fails or times out
 *  yields `undefined` for that key. */
export function harnessVersions(): Promise<{ claude?: string; codex?: string }> {
  const one = (bin: string): Promise<string | undefined> =>
    new Promise((resolvePromise) => {
      execFile(bin, ["--version"], { timeout: VERSION_TIMEOUT_MS, env: harnessEnv(process.env) }, (err, stdout) => {
        resolvePromise(err ? undefined : stdout.trim() || undefined);
      });
    });
  return Promise.all([one("claude"), one("codex")]).then(([claude, codex]) => ({ claude, codex }));
}
