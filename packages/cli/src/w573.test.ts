/**
 * W-573 (studio/briefs/W-573.md): a red is recorded only where certify would replay it. Rows are named
 * `W-573-b<n> behaviour <n>: …` and selected with `--test-name-pattern='^W-573-b<n>\s'`.
 * b1: certify's classifier (scripts/replay-accept.mjs) reads a read-only-mount throw as an environment failure.
 * No row reads studio/, the host's HOME or ~/.codex; every scratch path is under os.tmpdir().
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyReplay } from "../../../scripts/replay-accept.mjs";

/** A one-test TAP report whose failing block carries `code` and `error` as node:test prints them. */
const tap = (code: string, error: string): string =>
  [
    "TAP version 13",
    "# Subtest: W-900-b3 behaviour 3: a scratch officina",
    "not ok 1 - W-900-b3 behaviour 3: a scratch officina",
    "  ---",
    "  duration_ms: 3.1",
    "  type: 'test'",
    "  failureType: 'testCodeFailure'",
    `  error: '${error}'`,
    `  code: '${code}'`,
    "  ...",
    "1..1",
    "# fail 1",
    "",
  ].join("\n");

test("W-573-b1 behaviour 1: a throw from a read-only mount is an environment failure, not an assertion red", () => {
  // the 11-10 b3 rows: mkdtemp under a read-only /tmp, the test's own error, no assertion
  const thrown = classifyReplay({ status: 1, output: tap("EROFS", "EROFS: read-only file system, mkdtemp '/tmp/w562-b3-XXXXXX'") });
  assert.equal(thrown.accepted, false, "a read-only mount's throw is refused");
  assert.equal(thrown.reason, "the output names an environment failure (EROFS)", "named as an environment failure");
});

test("W-573-b1 behaviour 1: the message alone, in any case, is an environment failure", () => {
  const message = classifyReplay({ status: 1, output: tap("ERR_UNKNOWN", "Read-Only File System at open") });
  assert.equal(message.accepted, false, "the message without its code is refused");
  const shell = classifyReplay({ status: 1, output: "touch: cannot touch '/tmp/x': Read-only file system\nnot ok 1 - x\n" });
  assert.equal(shell.accepted, false, "a shell's message beside a failure is refused");
  const code = classifyReplay({ status: 1, output: "Error: EROFS\nAssertionError: x\n" });
  assert.equal(code.accepted, false, "the code alone is refused");
});

test("W-573-b1 behaviour 1: an assertion red is still accepted, its own message included", () => {
  assert.equal(classifyReplay({ status: 1, output: tap("ERR_ASSERTION", "1 !== 2") }).accepted, true, "a plain assertion red");
  // outsideOwnFailure: the one failing ERR_ASSERTION block is the test's own, as an ENOENT inside it is today
  assert.equal(classifyReplay({ status: 1, output: tap("ERR_ASSERTION", "expected EROFS: read-only file system") }).accepted, true, "an assertion whose own message names the mount");
  assert.equal(classifyReplay({ status: 1, output: tap("ERR_ASSERTION", "a missing file, ENOENT") }).accepted, true, "ENOENT inside the assertion, as before");
});
