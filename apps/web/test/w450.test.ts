/**
 * W-450 behaviour 1: a served row's failure prints the `not ok` title certify re-attests. node:test TAP; selected by
 * `--test-name-pattern=^W-450-b1\s`. The row runs Playwright on a temp config that spreads the served config
 * (apps/web/playwright.serve.config.ts) and overrides only its test directory, global setup (no bundle is needed: the
 * fixture specs drive no page), retries and output directory, so the reporters under test are the served config's own.
 * Nothing is written inside the repository.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const REPO_ROOT = resolve(here("../../.."));
const CONFIG = here("../playwright.serve.config.ts");
const PLAYWRIGHT_CLI = join(REPO_ROOT, "node_modules", "@playwright", "test", "cli.js");
const PLAYWRIGHT_TEST = join(REPO_ROOT, "node_modules", "@playwright", "test", "index.mjs");
// scripts/run-builder-host.mjs's title grammar, copied: a rebased red's recorded titles and its replay's printed ones.
const REPORTER = here("../tests-serve/tap-reporter.ts");
const HOST_TITLE = /^not ok \d+ - (.*)$/;

type Classify = (input: { status: number | null; output: string }) => { accepted: boolean; reason: string };

const tmp: string[] = [];
after(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

/** Playwright run on the served config's reporters, over one fixture spec; its exit status and stdout+stderr. */
function runServedReporters(spec: string): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "w450-served-"));
  tmp.push(dir);
  // ESM like apps/web (`"type": "module"`), so the served config loads as the module it is
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(dir, "w450-fixture.spec.ts"), spec);
  writeFileSync(
    join(dir, "w450.config.ts"),
    `import served from ${JSON.stringify(CONFIG)};\n` +
      `export default { ...served, testDir: ".", globalSetup: undefined, retries: 1, outputDir: ${JSON.stringify(join(dir, "results"))} };\n`,
  );
  const run = spawnSync(process.execPath, [PLAYWRIGHT_CLI, "test", "--config", join(dir, "w450.config.ts")], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, CI: "", FORCE_COLOR: "0" },
  });
  return { status: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
}

const FIXTURE = [
  `import { expect, test } from ${JSON.stringify(PLAYWRIGHT_TEST)};`,
  `test("W-450 fixture #1 fails on every attempt", () => { expect(1, "the fixture's own assertion").toBe(2); });`,
  `test("W-450 fixture passes", () => { expect(1).toBe(1); });`,
  `test("W-450 fixture fails once, then passes", ({}, info) => { expect(info.retry, "the first attempt fails").toBe(1); });`,
  `test.skip("W-450 fixture is skipped", () => {});`,
  "",
].join("\n");

test("W-450-b1 behaviour 1: a served row's failure prints the not-ok title certify re-attests, once, with no path", async () => {
  const { classifyReplay } = (await import(pathToFileURL(join(REPO_ROOT, "scripts", "replay-accept.mjs")).href)) as {
    classifyReplay: Classify;
  };
  const run = runServedReporters(FIXTURE);
  assert.match(run.output, /^\s*Running 4 tests using \d+ workers?\s*$/m, "Playwright ran the four fixture rows on the served config");
  assert.match(run.output, /^\s*1 failed\s*$/m, "exactly one fixture row failed on its every attempt");
  const lines = run.output.split("\n").map((line) => line.replace(/\r$/, ""));
  const titles = lines.flatMap((line) => HOST_TITLE.exec(line)?.[1] ?? []);
  assert.deepEqual(
    titles,
    ["chromium › w450-fixture.spec.ts › W-450 fixture \\#1 fails on every attempt"],
    "the served run prints the failing row's not-ok title, once though it ran twice, with no path or attempt",
  );
  const status = lines.filter((line) => /^(?:not )?ok \d+ - /.test(line));
  assert.deepEqual(
    status,
    [
      "not ok 1 - chromium › w450-fixture.spec.ts › W-450 fixture \\#1 fails on every attempt",
      "ok 2 - chromium › w450-fixture.spec.ts › W-450 fixture passes",
      "ok 3 - chromium › w450-fixture.spec.ts › W-450 fixture fails once, then passes",
      "ok 4 - chromium › w450-fixture.spec.ts › W-450 fixture is skipped # SKIP",
    ],
    "every other row prints ok, by its final outcome: a pass, a retried pass and a skip",
  );
  assert.ok(lines.includes("TAP version 13") && lines.includes("1..4"), "the stream is TAP 13 with its plan");
  assert.equal(classifyReplay(run).accepted, true, "the replay classifier still reads the list report: one expect failure");

  // the reporter's fail-closed edges (spec review round 2, advisory 2); the file is asserted present before it is imported
  assert.ok(existsSync(REPORTER), "the TAP reporter file exists");
  const reporter = (await import(pathToFileURL(REPORTER).href)) as {
    tapTitle: (test: unknown) => string;
    tapLines: (tests: unknown[]) => string[];
    default: new () => { onBegin(config: unknown, suite: unknown): void; onEnd(result: unknown): void };
  };
  const fake = (titlePath: unknown[], outcome: string): unknown => ({ titlePath: () => titlePath, outcome: () => outcome });
  assert.throws(() => reporter.tapTitle(fake(["", "chromium", 7], "expected")), "tapTitle throws unless titlePath() holds only strings");
  assert.throws(() => reporter.tapLines([fake(["a"], "interrupted")]), "tapLines throws outside expected|unexpected|flaky|skipped");
  assert.deepEqual(
    reporter.tapLines([fake(["a"], "flaky")]).slice(2),
    ["ok 1 - a"],
    "a test unexpected on record but passing on a replay retry is flaky, and prints ok",
  );
  // the host's two readings of a printed line (scripts/run-builder-host.mjs): the recorded log's, by its multiline pattern
  // over the whole text (:716), and the replay's, line by line after a split on LF and one trailing CR dropped (:770-771)
  const hostReads = (printed: string): string[][] => [
    [...`# log\n${printed}\n`.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => (m[1] ?? "").replace(/\r$/, "")),
    `${printed}\n`.split("\n").flatMap((line) => HOST_TITLE.exec(line.replace(/\r$/, ""))?.[1] ?? []),
  ];
  const printedFor = (ch: string): [string[], string[][]] => {
    const printed = reporter.tapLines([fake(["a" + ch + "b"], "unexpected")]).slice(2);
    return [printed, hostReads(printed.join("\n"))];
  };
  // ECMAScript's four line terminators: the host's `.` does not match them and its multiline `^` and `$` break at them
  const FOLDED = [["LF", "\n"], ["CR", "\r"], ["CRLF", "\r\n"], ["LS U+2028", "\u2028"], ["PS U+2029", "\u2029"], ["LF LS CR PS", "\n\u2028\r\u2029"]] as const;
  assert.deepEqual(
    FOLDED.map(([name, ch]) => [name, ...printedFor(ch)]),
    FOLDED.map(([name]) => [name, ["not ok 1 - a b"], [["a b"], ["a b"]]]),
    "a title's run of line terminators, LF, CR, LS or PS, prints as one space, and both host readings read that one line",
  );
  // every other character is one the host's `.` matches, so it is kept as written
  const KEPT = [["NEL U+0085", "\u0085"], ["VT", "\v"], ["FF", "\f"], ["FS", "\x1c"], ["GS", "\x1d"], ["RS", "\x1e"], ["TAB", "\t"], ["NUL", "\0"], ["NBSP U+00A0", "\u00a0"], ["BOM U+FEFF", "\ufeff"]] as const;
  assert.deepEqual(
    KEPT.map(([name, ch]) => [name, ...printedFor(ch)]),
    KEPT.map(([name, ch]) => [name, [`not ok 1 - a${ch}b`], [[`a${ch}b`], [`a${ch}b`]]]),
    "every other character the host's pattern reads, NEL, VT, FF, FS, GS and RS included, prints unchanged and both host readings read it",
  );
  assert.deepEqual(reporter.tapLines([fake(["a\\b#c"], "unexpected")]).slice(2), ["not ok 1 - a\\\\b\\#c"], "backslash and hash are escaped");
  assert.throws(() => new reporter.default().onEnd({ status: "passed" }), "TapReporter.onEnd throws when the root suite is absent");
});
