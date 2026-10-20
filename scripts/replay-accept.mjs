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
// Global: read only through matchAll, which does not mutate it (no lastIndex leak). W-334: any digit run is a summary,
// and its count is compared as written, never through a double.
const PW_SUMMARY = /^[ \t]*(\d+) failed\b/gm;
const PW_EXPECT = /^[ \t]*(?:Error: )?expect\([a-z]+\)\.[A-Za-z]+\(/m;

/**
 * The output without the one failing test's own TAP block, or the whole output
 * when no such block is recognised (fail closed: nothing is exempted by guess).
 * The block is one root-level `not ok` with its `# Subtest:` heading, `  ---`
 * delimiter and `  ...` closer; every line between the delimiters is indented,
 * with exactly one `  code: 'ERR_ASSERTION'` and one `  error:` line (a thrown
 * error, or an assertion wrapping one, prints a second at the same indent).
 */
function outsideOwnFailure(output) {
  const lines = output.split("\n");
  const failing = lines.flatMap((line, i) => (/^not ok /.test(line) ? [i] : []));
  if (failing.length !== 1) return output;
  const n = failing[0];
  const named = /^not ok [1-9][0-9]* - (.+)$/.exec(lines[n]);
  if (named === null || lines[n - 1] !== `# Subtest: ${named[1]}` || lines[n + 1] !== "  ---") return output;
  const closer = lines.indexOf("  ...", n + 2);
  if (closer === -1) return output;
  const body = lines.slice(n + 2, closer);
  if (!body.every((line) => line.startsWith("  "))) return output;
  const codes = body.filter((line) => line.startsWith("  code:"));
  if (codes.length !== 1 || codes[0] !== "  code: 'ERR_ASSERTION'") return output;
  if (body.filter((line) => line.startsWith("  error:")).length !== 1) return output;
  return [...lines.slice(0, n - 1), ...lines.slice(closer + 1)].join("\n");
}

/** Was a confined replay a genuine assertion-level reproduction of a red? */
export function classifyReplay({ status, output }) {
  if (status === 0) return { accepted: false, reason: "the command exited 0" };
  // A playwright run is routed before the TAP clause, so no token can skip the count or the matcher.
  const summary = [...output.matchAll(PW_SUMMARY)].at(-1);
  if (summary !== undefined || PW_BANNER.test(output)) {
    // The matched token only, never the surrounding text: a real message embeds an absolute path.
    const pwPoisoned = POISON.exec(output);
    if (pwPoisoned) return { accepted: false, reason: `the output names an environment failure (${pwPoisoned[0]})` };
    if (summary === undefined) return { accepted: false, reason: "playwright printed no failure summary" };
    if (summary[1] !== "1")
      return {
        accepted: false,
        reason: `playwright reported ${summary[1]} failed tests; a behaviour's red is exactly one`,
      };
    if (!PW_EXPECT.test(output))
      return { accepted: false, reason: "playwright's failure is not an expect(...) assertion" };
    return { accepted: true, reason: "assertion-level failure" };
  }
  const poisoned = POISON.exec(outsideOwnFailure(output));
  if (poisoned) return { accepted: false, reason: `the output names an environment failure (${poisoned[0]})` };
  if (ASSERTION.test(output)) return { accepted: true, reason: "assertion-level failure" };
  return { accepted: false, reason: "no assertion-level failure in the output" };
}

/**
 * W-334: a recorded red's `# behaviour:` header, read exactly: a line of 1 to 15 digits whose number is the red's
 * two-digit file name (`<nn>.log`), or undefined. A longer run, no header, another file name or another number refuses.
 */
export function readRedBehaviour(text, name) {
  const header = /^# behaviour:\s*([0-9]{1,15})$/m.exec(text);
  const file = /^([0-9]{2})\.log$/.exec(name);
  if (header === null || file === null || Number(header[1]) !== Number(file[1])) return undefined;
  return Number(header[1]);
}
