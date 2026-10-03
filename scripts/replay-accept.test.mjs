/**
 * W-130 behaviour 4: the replay classifier accepts a playwright assertion
 * failure and names every near miss. `classifyReplay` over a table of inline
 * canned transcripts: no runner, no bwrap, no playwright, no browser, no
 * filesystem, no network. Select the numbered behaviour with `--behaviour 4`
 * (the only one); omitting the selector runs it. node:test TAP, one test().
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
const TAP_ERR = "TAP version 13\nnot ok 1 - a behaviour\n  ---\n  error: 'AssertionError [ERR_ASSERTION]: nope'\n  ...\n# fail 1\n";
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
  accepted(classify(`${BANNER_1}\n${MATCHER_LOCATOR}\n  2 failed\n\n${MATCHER_LOCATOR}\n  1 failed\n`), "4(j) retry summaries");

  // (k) the routing clause: no token can skip the count.
  refused(classify(`${PW_THREE}\nnot ok 1 - setup\n`), /3 failed tests/, "4(k) three failures plus an echoed not ok");
  refused(
    classify(`${PW_THREE}\nAssertionError [ERR_ASSERTION]: harness teardown\n`),
    /3 failed tests/,
    "4(k) three failures plus an AssertionError",
  );
  accepted(classify(`${PW_ONE}\nAssertionError [ERR_ASSERTION]: spawned server\n`), "4(k) one failure plus a server AssertionError");

  // (l) a playwright run that never summarised a failure is not a red.
  refused(classify(BANNER_1), /playwright printed no failure summary/, "4(l) banner only");
  refused(classify(`${BANNER_1}\n  1 passed (2s)\n`), /playwright printed no failure summary/, "4(l) passing run at a nonzero status");

  // (m) TAP keeps today's path; a line-start `1 failed` is the one verdict moved.
  accepted(classify(TAP_ERR.replace("'AssertionError [ERR_ASSERTION]: nope'", "1 failed")), "4(m) TAP with an indented non-line-start 1 failed");
  refused(classify(`${TAP_ONE}1 failed\n`), /not an expect\(\.\.\.\) assertion/, "4(m) TAP printing 1 failed at line start");

  // (n) pure: no mutation, and no lastIndex leak from the global summary regex.
  const frozen = Object.freeze({ status: 1, output: PW_ONE });
  const first = mod.classifyReplay(frozen);
  const second = mod.classifyReplay(frozen);
  assert.equal(second.reason, first.reason, "4(n): the same frozen input answers the same reason");
  assert.equal(Object.isFrozen(frozen), true, "4(n): the input is still frozen after the call");
  const table = [
    TAP_ONE, PW_ONE, PW_GREATER, PW_THREE, MISSING_BROWSER, GOTO_REFUSED, BANNER_1,
    `${PW_THREE}\nnot ok 1 - setup\n`, `${PW_ONE}\nAssertionError [ERR_ASSERTION]: spawned server\n`,
    `${BANNER_1}\n${MATCHER_LOCATOR}\n  2 failed\n\n${MATCHER_LOCATOR}\n  1 failed\n`, "Error: No tests found.\n",
  ];
  const verdicts = () => table.map((output) => JSON.stringify(classify(output)));
  assert.deepEqual(verdicts(), verdicts(), "4(n): every verdict is identical on a second pass over the table");
});
