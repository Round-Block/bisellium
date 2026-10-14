/**
 * W-130 behaviour 4: the replay classifier accepts a playwright assertion
 * failure and names every near miss. `classifyReplay` over a table of inline
 * canned transcripts: no runner, no bwrap, no playwright, no browser, no
 * filesystem, no network. Select the numbered behaviour with `--behaviour 4`
 * (the only one); omitting the selector runs it. node:test TAP, one test().
 * W-265-b1 and W-265-b2 (the failing test's own block is not scanned for
 * environment words) run only without the selector; select them by name.
 *
 * The module under test is loaded dynamically so that its absence is one
 * assertion failure, not a module-load error (a missing red).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && only !== 4) {
  console.error("replay-accept.test.mjs: --behaviour must be 4");
  process.exit(2);
}

const BANNER_1 = "Running 1 test using 1 worker\n";
const BANNER_3 = "Running 3 tests using 1 worker\n";
const MATCHER_LOCATOR = [
  "  1) [chromium] > walk.spec.ts:10:1 > the walk",
  "",
  "    Error: expect(locator).toHaveCount(expected) failed",
  "",
  "    Locator: locator('.row')",
  "    Expected: 2",
  "    Received: 0",
  "",
].join("\n");
const MATCHER_GREATER = [
  "  1) [chromium] > walk.spec.ts:20:1 > the count",
  "",
  "    expect(received).toBeGreaterThan(expected)",
  "",
  "    Expected: > 0",
  "    Received:   0",
  "",
].join("\n");
const PW_ONE = `${BANNER_1}\n${MATCHER_LOCATOR}\n  1 failed\n    [chromium] > walk.spec.ts:10:1 > the walk\n`;
const PW_GREATER = `${BANNER_1}\n${MATCHER_GREATER}\n  1 failed\n    [chromium] > walk.spec.ts:20:1 > the count\n`;
const PW_THREE = `${BANNER_3}\n${MATCHER_LOCATOR}\n  3 failed\n    [chromium] > walk.spec.ts:10:1 > one\n    [chromium] > walk.spec.ts:20:1 > two\n    [chromium] > walk.spec.ts:30:1 > three\n`;
const TAP_ONE = "TAP version 13\nnot ok 1 - a behaviour\n  ---\n  duration_ms: 3\n  ...\n1..1\n# fail 1\n";
const TAP_ERR =
  "TAP version 13\nnot ok 1 - a behaviour\n  ---\n  error: 'AssertionError [ERR_ASSERTION]: nope'\n  ...\n# fail 1\n";
const MISSING_BROWSER =
  "Running 1 test using 1 worker\n\n  Error: browserType.launch: Executable doesn't exist at /a/b/c\n\n  1 failed\n";
const GOTO_REFUSED =
  "Running 1 test using 1 worker\n\n  1) [chromium] > walk.spec.ts:10:1 > the walk\n\n    Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/\n\n  1 failed\n";
const CODE_FRAME = '  >  4 |   await expect(page.locator(".x")).toHaveText("y");\n';

test("W-130 behaviour 4: the classifier accepts a playwright assertion failure and names every near miss", async () => {
  // (a) Genuine red: the module does not exist yet, as one assertion.
  const mod = await import("./replay-accept.mjs").catch(() => undefined);
  assert.ok(mod?.classifyReplay, "4(a): scripts/replay-accept.mjs exports classifyReplay");
  const classify = (output, status = 1) => mod.classifyReplay({ status, output });
  const accepted = (v, why) => {
    assert.equal(v.accepted, true, `${why}: ${v.reason}`);
    assert.equal(v.reason, "assertion-level failure", `${why}: reason`);
  };
  const refused = (v, pattern, why) => {
    assert.equal(v.accepted, false, `${why}: must be refused`);
    assert.match(v.reason, pattern, `${why}: reason`);
  };

  // (b) today's two accepted shapes, unchanged.
  accepted(classify(TAP_ONE), "4(b) not ok at status 1");
  accepted(classify("AssertionError [ERR_ASSERTION]: boom\n"), "4(b) AssertionError at status 1");

  // (c) a real playwright expect(...) failure.
  accepted(classify(PW_ONE), "4(c) toHaveCount failure");
  accepted(classify(PW_GREATER), "4(c) toBeGreaterThan failure");

  // (d) status 0 is refused whatever the output.
  refused(classify(PW_ONE, 0), /the command exited 0/, "4(d) playwright output at status 0");
  refused(classify(TAP_ONE, 0), /the command exited 0/, "4(d) TAP output at status 0");

  // (e) a missing browser is named, and the reason carries no path.
  const missing = classify(MISSING_BROWSER);
  refused(missing, /browserType\.launch/, "4(e) missing browser");
  assert.equal(missing.reason.includes("/"), false, `4(e): the reason contains no path: ${missing.reason}`);

  // (f) environment failures are named.
  refused(classify("Error: No tests found.\n"), /No tests found/, "4(f) no tests found");
  refused(classify("not ok 1 - x\nCannot find module './x.js'\n"), /Cannot find module/, "4(f) module not found");
  refused(classify("not ok 1 - x\nENOENT: no such file\n"), /ENOENT/, "4(f) ENOENT");

  // (g) a multi-test failure is not one behaviour's red.
  refused(classify(PW_THREE), /3 failed tests/, "4(g) three failures");

  // (h) a playwright API error is not an assertion.
  refused(classify(GOTO_REFUSED), /not an expect\(\.\.\.\) assertion/, "4(h) page.goto error");

  // (i) a code-frame echo cannot accidentally trip the matcher clause.
  refused(
    classify(`${BANNER_1}\n${CODE_FRAME}\n  Error: browserType.launch: nope\n\n  1 failed\n`),
    /browserType\.launch/,
    "4(i) code-frame echo with a launch failure",
  );
  refused(
    classify(`${BANNER_1}\n${CODE_FRAME}\n  Error: page.goto: net::ERR_X\n\n  1 failed\n`),
    /not an expect\(\.\.\.\) assertion/,
    "4(i) code-frame echo with a goto failure",
  );

  // (j) the LAST summary is read, as a retry prints it.
  accepted(
    classify(`${BANNER_1}\n${MATCHER_LOCATOR}\n  2 failed\n\n${MATCHER_LOCATOR}\n  1 failed\n`),
    "4(j) retry summaries",
  );

  // (k) the routing clause: no token can skip the count.
  refused(classify(`${PW_THREE}\nnot ok 1 - setup\n`), /3 failed tests/, "4(k) three failures plus an echoed not ok");
  refused(
    classify(`${PW_THREE}\nAssertionError [ERR_ASSERTION]: harness teardown\n`),
    /3 failed tests/,
    "4(k) three failures plus an AssertionError",
  );
  accepted(
    classify(`${PW_ONE}\nAssertionError [ERR_ASSERTION]: spawned server\n`),
    "4(k) one failure plus a server AssertionError",
  );

  // (l) a playwright run that never summarised a failure is not a red.
  refused(classify(BANNER_1), /playwright printed no failure summary/, "4(l) banner only");
  refused(
    classify(`${BANNER_1}\n  1 passed (2s)\n`),
    /playwright printed no failure summary/,
    "4(l) passing run at a nonzero status",
  );

  // (m) TAP keeps today's path; a line-start `1 failed` is the one verdict moved.
  accepted(
    classify(TAP_ERR.replace("'AssertionError [ERR_ASSERTION]: nope'", "1 failed")),
    "4(m) TAP with an indented non-line-start 1 failed",
  );
  refused(
    classify(`${TAP_ONE}1 failed\n`),
    /not an expect\(\.\.\.\) assertion/,
    "4(m) TAP printing 1 failed at line start",
  );

  // (n) pure: no mutation, and no lastIndex leak from the global summary regex.
  const frozen = Object.freeze({ status: 1, output: PW_ONE });
  const first = mod.classifyReplay(frozen);
  const second = mod.classifyReplay(frozen);
  assert.equal(second.reason, first.reason, "4(n): the same frozen input answers the same reason");
  assert.equal(Object.isFrozen(frozen), true, "4(n): the input is still frozen after the call");
  const table = [
    TAP_ONE,
    PW_ONE,
    PW_GREATER,
    PW_THREE,
    MISSING_BROWSER,
    GOTO_REFUSED,
    BANNER_1,
    `${PW_THREE}\nnot ok 1 - setup\n`,
    `${PW_ONE}\nAssertionError [ERR_ASSERTION]: spawned server\n`,
    `${BANNER_1}\n${MATCHER_LOCATOR}\n  2 failed\n\n${MATCHER_LOCATOR}\n  1 failed\n`,
    "Error: No tests found.\n",
  ];
  const verdicts = () => table.map((output) => JSON.stringify(classify(output)));
  assert.deepEqual(verdicts(), verdicts(), "4(n): every verdict is identical on a second pass over the table");
});

if (only === undefined) {
  const WORDS = [
    "ERR_MODULE_NOT_FOUND",
    "SyntaxError:",
    "Cannot find module",
    "command not found",
    "ENOENT",
    "not permitted",
    "permission denied",
    "sandbox",
    "browserType.launch",
    "Executable doesn't exist",
    "No tests found",
  ];
  // node's TAP shape for one failing assertion; the output is stdout, "\n", then empty stderr.
  const controlLines = (word) => [
    "TAP version 13",
    `# Subtest: a ${word} test`,
    `not ok 1 - a ${word} test`,
    "  ---",
    "  duration_ms: 1",
    "  failureType: 'testCodeFailure'",
    "  error: |-",
    `    expected ${word}`,
    "  code: 'ERR_ASSERTION'",
    "  name: 'AssertionError'",
    "  ...",
    "1..1",
    "# fail 1",
  ];
  const render = (lines, stderr = "") => `${lines.join("\n")}\n\n${stderr}`;
  const CONTROL = (word) => render(controlLines(word));
  // W-255's red 2 (studio/ci/reds/W-255/02.log on opus/W-255), paths shortened.
  const W255_RED_2 = [
    "TAP version 13",
    "# Subtest: W-255-b2 behaviour 2: security, sandbox, branch-protection and pipeline work cannot be light",
    "not ok 1 - W-255-b2 behaviour 2: security, sandbox, branch-protection and pipeline work cannot be light",
    "  ---",
    "  duration_ms: 6.650044",
    "  type: 'test'",
    "  location: '/candidate/packages/cli/src/brief-admission.test.ts:27:5890'",
    "  failureType: 'testCodeFailure'",
    "  error: |-",
    "    family token security",
    "    + actual - expected",
    "    ",
    "    + []",
    "    - [",
    '    -   \'a light brief is not for security, sandbox, branch-protection or pipeline work (D-063 §4): decree family "lane-security-x" names "security"; use the full template\'',
    "    - ]",
    "    ",
    "  code: 'ERR_ASSERTION'",
    "  name: 'AssertionError'",
    "  expected:",
    "    0: 'a light brief is not for security, sandbox, branch-protection or pipeline work (D-063 §4)'",
    "  actual:",
    "  operator: 'deepStrictEqual'",
    "  stack: |-",
    "    TestContext.<anonymous> (/candidate/packages/cli/src/brief-admission.test.ts:809:12)",
    "    Test.runInAsyncScope (node:async_hooks:226:14)",
    "    Test.run (node:internal/test_runner/test:1201:25)",
    "  ...",
    "1..1",
    "# tests 1",
    "# suites 0",
    "# pass 0",
    "# fail 1",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "# duration_ms 14.936286",
  ];

  test("W-265-b1 behaviour 1: an environment word inside the one failing test's own block does not refuse the red", async () => {
    const { classifyReplay } = await import("./replay-accept.mjs");
    const v = classifyReplay({ status: 1, output: render(W255_RED_2) });
    assert.equal(v.accepted, true, "expected accepted replay");
    assert.equal(v.reason, "assertion-level failure", "W-255 red 2: reason");
    for (const word of WORDS) {
      for (const status of [1, null]) {
        const ok = classifyReplay({ status, output: CONTROL(word) });
        assert.equal(ok.accepted, true, `${word} at status ${status}: ${ok.reason}`);
        assert.equal(ok.reason, "assertion-level failure", `${word} at status ${status}: reason`);
      }
      const zero = classifyReplay({ status: 0, output: CONTROL(word) });
      assert.equal(zero.accepted, false, `${word} at status 0: must be refused`);
      assert.match(zero.reason, /the command exited 0/, `${word} at status 0: reason`);
      const base = controlLines(word);
      const at = (needle) => base.indexOf(needle);
      const closer = at("  ...");
      const perturbed = {
        "before the heading": [base[0], word, ...base.slice(1)],
        "after the closer": [...base.slice(0, closer + 1), word, ...base.slice(closer + 1)],
        "in appended stderr": base,
        "in a passing block": [
          ...base.slice(0, closer + 1),
          "# Subtest: a passing test",
          `ok 2 - a ${word} passing test`,
          "  ---",
          "  duration_ms: 1",
          "  ...",
          ...base.slice(closer + 1),
        ],
        "a line between the headings": [base[0], base[1], `# note ${word}`, ...base.slice(2)],
        "mismatched names": [base[0], `# Subtest: other ${word}`, ...base.slice(2)],
        "a TODO suffix": [base[0], base[1], `${base[2]} # TODO`, ...base.slice(3)],
        "no opening delimiter": base.filter((l) => l !== "  ---"),
        "no closer": base.filter((l) => l !== "  ..."),
        "an unindented body line": base.map((l) => (l === "  duration_ms: 1" ? "duration_ms: 1" : l)),
        "a second root not ok": [...base.slice(0, closer + 1), "not ok 2 - second", ...base.slice(closer + 1)],
        "nested under a parent": [
          base[0],
          "# Subtest: parent",
          ...base.slice(1, closer + 1).map((l) => `    ${l}`),
          "not ok 1 - parent",
          "  ---",
          "  failureType: 'subtestsFailed'",
          "  error: '1 subtest failed'",
          "  code: 'ERR_TEST_FAILURE'",
          "  ...",
          ...base.slice(closer + 1),
        ],
      };
      for (const [why, lines] of Object.entries(perturbed)) {
        const output = why === "in appended stderr" ? render(lines, `${word}\n`) : render(lines);
        const bad = classifyReplay({ status: 1, output });
        assert.equal(bad.accepted, false, `${word} ${why}: must be refused`);
        assert.ok(
          bad.reason.toLowerCase().includes(word.toLowerCase()),
          `${word} ${why}: reason names it: ${bad.reason}`,
        );
      }
      const pw = classifyReplay({ status: 1, output: `${BANNER_1}${CONTROL(word)}` });
      assert.equal(pw.accepted, false, `${word} with a playwright banner: must be refused`);
      assert.ok(
        pw.reason.toLowerCase().includes(word.toLowerCase()),
        `${word} with a playwright banner: reason names it`,
      );
    }
  });
}
