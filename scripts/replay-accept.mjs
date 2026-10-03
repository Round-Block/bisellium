/**
 * Host-owned W-130 replay classifier. Pure: no fs, no spawn, no environment.
 * Never loaded from candidate code; run-builder-host.mjs reaches it by a
 * relative specifier and nothing copies or binds it into any cell.
 *
 * `status` is the child's exit code (null for a signal); `output` is stdout and
 * stderr concatenated.
 */
const ASSERTION = /(?:not ok|AssertionError|ERR_ASSERTION)/;
const POISON =
  /ERR_MODULE_NOT_FOUND|SyntaxError:|Cannot find module|command not found|ENOENT|not permitted|permission denied|sandbox|browserType\.launch|Executable doesn't exist|No tests found/i;
const PW_BANNER = /^[ \t]*Running \d+ tests? using \d+ workers?\b/m;
// Global: read only through matchAll, which does not mutate it (no lastIndex leak).
const PW_SUMMARY = /^[ \t]*(\d+) failed\b/gm;
const PW_EXPECT = /^[ \t]*(?:Error: )?expect\([a-z]+\)\.[A-Za-z]+\(/m;

/** Was a confined replay a genuine assertion-level reproduction of a red? */
export function classifyReplay({ status, output }) {
  if (status === 0) return { accepted: false, reason: "the command exited 0" };
  // The matched token only, never the surrounding text: a real message embeds an absolute path.
  const poisoned = POISON.exec(output);
  if (poisoned) return { accepted: false, reason: `the output names an environment failure (${poisoned[0]})` };
  // A playwright run is routed before the TAP clause, so no token can skip the count or the matcher.
  const summary = [...output.matchAll(PW_SUMMARY)].at(-1);
  if (summary !== undefined || PW_BANNER.test(output)) {
    if (summary === undefined) return { accepted: false, reason: "playwright printed no failure summary" };
    const failed = Number(summary[1]);
    if (failed !== 1)
      return {
        accepted: false,
        reason: `playwright reported ${failed} failed tests; a behaviour's red is exactly one`,
      };
    if (!PW_EXPECT.test(output))
      return { accepted: false, reason: "playwright's failure is not an expect(...) assertion" };
    return { accepted: true, reason: "assertion-level failure" };
  }
  if (ASSERTION.test(output)) return { accepted: true, reason: "assertion-level failure" };
  return { accepted: false, reason: "no assertion-level failure in the output" };
}
