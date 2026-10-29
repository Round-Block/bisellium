/**
 * apps/web/tests-serve/tap-reporter.ts — W-450. The served config's second
 * reporter, beside `list`: once the run ends it prints one TAP 13 stream, a
 * `not ok <n> - <title>` line for each test whose final outcome is a failure
 * and an `ok` line for every other. The merge queue's certify replays a
 * rebased red and re-attests it by those `not ok` titles
 * (scripts/run-builder-host.mjs), the grammar a Node TAP red already prints,
 * so a served red can be re-attested. One line per test, read at the end:
 * a retried failure is one `not ok` line however many attempts ran, and a
 * title holds no path, port, duration or attempt number, so the recording
 * and the replay print the same title. Not a spec: it does not match
 * playwright's default testMatch.
 */
import type { FullResult, Reporter, Suite, TestCase } from "@playwright/test/reporter";

/** The test's title path without its empty root: project, file (relative to testDir), describes, title; one line, TAP-escaped. Throws unless every part is a string. */
export function tapTitle(test: TestCase): string {
  const parts: unknown[] = test.titlePath();
  const strings = parts.filter((part): part is string => typeof part === "string");
  if (strings.length !== parts.length) throw new Error("tapTitle: titlePath() holds a part that is not a string");
  return strings
    .filter((part) => part !== "")
    .join(" › ")
    .replace(/[\r\n\v\f\x1c-\x1e\x85\u2028\u2029]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/#/g, "\\#");
}

/** `ok` or `not ok` for a final outcome; `unexpected` is the one failure. Throws outside the four outcomes Playwright names. */
function tapStatus(outcome: string): string {
  switch (outcome) {
    case "unexpected":
      return "not ok";
    case "expected":
    case "flaky":
    case "skipped":
      return "ok";
    default:
      throw new Error(`tapLines: unknown test outcome ${JSON.stringify(outcome)}`);
  }
}

/** The TAP 13 stream for `tests`, in order: `not ok` for a final outcome of `unexpected`, else `ok` (`# SKIP` when skipped). */
export function tapLines(tests: readonly TestCase[]): string[] {
  const lines = ["TAP version 13", `1..${tests.length}`];
  tests.forEach((test, i) => {
    const outcome: string = test.outcome();
    lines.push(`${tapStatus(outcome)} ${i + 1} - ${tapTitle(test)}${outcome === "skipped" ? " # SKIP" : ""}`);
  });
  return lines;
}

export default class TapReporter implements Reporter {
  private root: Suite | undefined;

  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite;
  }

  onEnd(_result: FullResult): void {
    if (this.root === undefined) throw new Error("TapReporter: onEnd ran before onBegin supplied the root suite");
    // a leading newline: whatever `list` wrote last, the stream's lines start at column 0
    process.stdout.write(`\n${tapLines(this.root.allTests()).join("\n")}\n`);
  }

  printsToStdio(): boolean {
    return true;
  }
}
