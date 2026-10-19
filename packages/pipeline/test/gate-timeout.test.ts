/**
 * W-142 behaviour 1: the gate timeout is one exported constant with headroom
 * over the slowest measured suite run. node:test TAP; selected by
 * `--test-name-pattern=W-142-b1`.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as pipeline from "../src/index.js";

// The slowest measured suite run: 11 min 09 s locally at master d8bf1fb
// (CI's slowest `npm test` step was 551 s, W-141's PR).
const SLOWEST_SUITE_MS = 669_000;

test("W-142-b1 behaviour 1: the gate timeout has 2x headroom over the slowest suite and stays within an hour", () => {
  const ms = pipeline.GATE_TIMEOUT_MS;
  assert.equal(typeof ms, "number");
  assert.ok(ms >= 2 * SLOWEST_SUITE_MS, `${ms} < ${2 * SLOWEST_SUITE_MS}`);
  assert.ok(ms <= 60 * 60_000, `${ms} > ${60 * 60_000}`);
});

// W-313 behaviour 1 (studio/briefs/W-313.md): a watched run is timed and never silent for long. The child moves on
// only when the test signals it, and the test signals only on the progress line that shows the child's last output.
const W313_CHILD = `process.on("SIGUSR1", () => process.stderr.write("beta \\u001b[31mred\\u001b[0m\\u0007 token=s3cr3t\\n"));
process.on("SIGUSR2", () => process.exit(3));
process.stdout.write("alpha " + process.pid + "\\n");
// sleep-waiver: fixture -- the child keeps itself alive until the test signals it to exit
setInterval(() => {}, 1000);
`;
const ISO = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z`;

test("W-313-b1 behaviour 1: a watched run prints its start, a progress line each interval naming its output size and last line, and its end, with the time", async () => {
  assert.equal(pipeline.PROGRESS_INTERVAL_MS, 60_000, "the progress line comes every minute");
  assert.equal(typeof pipeline.runWatched, "function", "the pipeline exports runWatched");
  const dir = mkdtempSync(join(tmpdir(), "w313-b1-"));
  try {
    const script = join(dir, "child.cjs");
    writeFileSync(script, W313_CHILD);
    const lines: string[] = [];
    const shape = new RegExp(`^L: running \\d+m\\d\\ds at ${ISO}, (\\d+) bytes of output, last line: (.*)$`);
    let pid = 0;
    let sent = 0;
    const write = (l: string): void => {
      lines.push(l);
      const last = shape.exec(l)?.[2] ?? "";
      const alpha = /^alpha (\d+)$/.exec(last);
      if (sent === 0 && alpha) {
        sent = 1;
        pid = Number(alpha[1]);
        process.kill(pid, "SIGUSR1");
      } else if (sent === 1 && last.startsWith("beta")) {
        sent = 2;
        process.kill(pid, "SIGUSR2");
      }
    };
    const r = await pipeline.runWatched(process.execPath, [script], { label: "L", cwd: dir, timeoutMs: 60_000, everyMs: 50, write });
    assert.equal(r.status, 3, "the child's exit status is returned");
    assert.equal(r.timedOut, false);
    assert.match(r.stdout, /^alpha \d+\n$/, "stdout is captured");
    assert.match(r.stderr, /^beta .*token=s3cr3t\n$/, "stderr is captured unredacted, as the gate log's redact then sees it");
    assert.match(lines[0] ?? "", new RegExp(`^L: start ${ISO}$`), `the first line is the start, with the time: ${JSON.stringify(lines)}`);
    assert.match(lines.at(-1) ?? "", new RegExp(`^L: end ${ISO} after \\d+m\\d\\ds, exited 3$`), `the last line is the end, with the time, the elapsed time and the exit: ${JSON.stringify(lines)}`);
    const progress = lines.slice(1, -1);
    for (const l of progress) assert.match(l, shape, "every middle line is a progress line");
    const seen = progress.map((l) => shape.exec(l)!.slice(1, 3));
    const alpha = r.stdout.length;
    const a = seen.findIndex(([n, last]) => Number(n) === alpha && last === r.stdout.trim());
    assert.ok(a !== -1, `a progress line names the output so far and its last line: ${JSON.stringify(seen)}`);
    const b = seen.findIndex(([n, last]) => Number(n) === alpha + Buffer.byteLength(r.stderr) && last === "beta red? token=***");
    assert.ok(b > a, `a later one names the stderr line, escapes dropped, a bell read as ?, a secret redacted: ${JSON.stringify(seen)}`);
    const count = lines.length;

    assert.equal(pipeline.progressLine(`one\r\n${"x ".repeat(150)}\n  \n`), `${"x ".repeat(100)}…`, "a long last line is cut to 200 characters");
    assert.equal(pipeline.progressLine("50%\r60%\r"), "60%", "a carriage return ends a line, as a progress bar redraws it");
    assert.equal(pipeline.progressLine(" \n\r "), undefined, "blank output has no last line");

    const hung: string[] = [];
    const t = await pipeline.runWatched(process.execPath, [script], { label: "H", cwd: dir, timeoutMs: 300, everyMs: 60_000, write: (l) => void hung.push(l) });
    assert.equal(t.timedOut, true, "a run past its timeout is killed");
    assert.equal(t.status, null);
    assert.match(hung.at(-1) ?? "", new RegExp(`^H: end ${ISO} after \\d+m\\d\\ds, timed out after 0\\.005m$`), `the end line says it timed out: ${JSON.stringify(hung)}`);
    assert.equal(lines.length, count, "no progress line after the end, through a later 300 ms run");

    const killed: string[] = [];
    const k = await pipeline.runWatched(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"], { label: "K", cwd: dir, timeoutMs: 60_000, write: (l) => void killed.push(l) });
    assert.equal(k.signal, "SIGKILL");
    assert.match(killed.at(-1) ?? "", /^K: end .* killed by SIGKILL$/, `the end line names the signal: ${JSON.stringify(killed)}`);

    const missing: string[] = [];
    const m = await pipeline.runWatched(join(dir, "no-such-bin"), [], { label: "M", cwd: dir, timeoutMs: 60_000, write: (l) => void missing.push(l) });
    assert.equal(m.error?.code, "ENOENT", "a spawn failure is returned");
    assert.match(missing.at(-1) ?? "", /^M: end .* failed to start: /, `the end line says it failed to start: ${JSON.stringify(missing)}`);

    const marker = join(dir, "spawned");
    for (const label of ["", " L", "L ", "a\nb", "a\u001b[2Jb", "a\u007fb", "a\u0085b", "a\u202eb", "a\u200bb"]) {
      const refused: string[] = [];
      const bad = await pipeline.runWatched(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`], { label, cwd: dir, timeoutMs: 60_000, write: (l) => void refused.push(l) });
      assert.equal(bad.error?.code, "EINVAL", `an invalid label is refused: ${JSON.stringify(label)}`);
      assert.equal(bad.status, null);
      assert.deepEqual(refused, [], `an invalid label is not echoed: ${JSON.stringify(label)}`);
      assert.ok(!existsSync(marker), `an invalid label spawns nothing: ${JSON.stringify(label)}`);
    }

    // a gate that passes its stream cap with a SIGTERM handler still exits 0: the cap error alone must fail the gate
    const loud = join(dir, "loud.cjs");
    writeFileSync(loud, 'process.on("SIGTERM", () => {});\nconst chunk = ("x".repeat(1023) + "\\n").repeat(1024);\nfor (let i = 0; i < 65; i++) process.stdout.write(chunk);\n');
    const logDir = join(dir, "ci");
    const gates = await pipeline.localPipeline.run({ opus: { id: "W-LOUD" } as never, repo: dir, commands: { tests: `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(loud)}` }, treeHash: "0123456789abcdef0123456789abcdef01234567", logDir, now: new Date("2026-10-20T00:00:00Z"), studioDir: dir });
    assert.equal(gates.tests?.status, "failed", "ENOBUFS cannot pass");
    assert.match(readFileSync(join(dir, gates.tests?.evidence ?? "missing"), "utf8"), /ENOBUFS/, "the gate log names the cap error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
