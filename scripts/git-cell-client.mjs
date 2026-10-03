#!/usr/bin/env node
/**
 * W-132: the `git` the builder cell runs (copied by the runner to /tools/git,
 * mode 0555, in the read-only /tools bind). It forwards its argv to the host's
 * Git broker over the two named pipes the host created in /control and prints
 * what the broker answers. No socket and no network module: the pipes are reached by
 * path, so a `git` spawned from any depth of the agent's own process tree
 * reaches the host (an inherited descriptor would not survive a process that
 * did not map it).
 *
 * Each call: take the mutex, write one `{ id, args }` frame to git-request,
 * read frames from git-reply until one carries its own `id` or the deadline
 * passes, release. All I/O is synchronous: the client is a short-lived process
 * with no event loop to keep alive.
 *
 * The mutex and the `id` are cell-side correctness, not host security. A
 * builder that breaks its mutex, drains git-reply or forges reply frames
 * confuses only its own processes: the host never reads git-reply and never
 * acts on anything but an allowlisted request. Do not mistake either for a
 * trust boundary.
 *
 * BISELLIUM_GIT_CONTROL is never set inside the cell, so the probe's
 * environment allowlist is unchanged. A cell that sets it for its own children
 * only redirects its own `git` at its own fake broker and loses Git entirely:
 * /usr/bin/git is bound to /dev/null.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const control = process.env.BISELLIUM_GIT_CONTROL ?? "/control";
const LOCK_MS = 200_000; // a held mutex outlives the longest call (the host's git timeout is 120 s), so only a crash expires it
const CALL_MS = 150_000; // the whole write-and-wait, longer than the host's own git timeout
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const lock = join(tmpdir(), "bisellium-git.lock");
/** An atomic mkdir; a lock whose owner is gone (crashed client) is moved aside, so it never wedges the cell. */
const acquire = () => {
  for (const until = Date.now() + LOCK_MS; Date.now() < until; nap(5)) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), `${process.pid}\n`);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") return false;
    }
    try {
      const owner = Number(readFileSync(join(lock, "pid"), "utf8"));
      if (Number.isInteger(owner) && owner > 0) process.kill(owner, 0);
    } catch (error) {
      if (error?.code === "ESRCH") {
        try {
          renameSync(lock, `${lock}.stale-${process.pid}`); // atomic: one waiter wins
          rmSync(`${lock}.stale-${process.pid}`, { recursive: true, force: true });
        } catch {}
      }
    }
  }
  return false;
};

/** Returns `{ status, stdout, stderr }` for this call; never throws. */
const call = (args) => {
  const failed = (why) => ({ status: 2, stdout: "", stderr: `git broker: ${why}\n` });
  const id = `${process.pid}-${randomUUID()}`;
  const deadline = Date.now() + CALL_MS;
  let request;
  let reply;
  try {
    // Non-blocking, so a full pipe or an absent host is a refusal inside the deadline, never an unbounded wait.
    request = openSync(join(control, "git-request"), constants.O_WRONLY | constants.O_NONBLOCK);
    reply = openSync(join(control, "git-reply"), constants.O_RDONLY | constants.O_NONBLOCK);
    const bytes = Buffer.from(`${JSON.stringify({ id, args })}\n`);
    for (let at = 0; at < bytes.length;) {
      try {
        at += writeSync(request, bytes, at, bytes.length - at);
      } catch (error) {
        if (error?.code !== "EAGAIN") throw error;
        if (Date.now() > deadline) return failed("request not accepted (deadline)");
        nap(5);
      }
    }
    let parts = []; // the unfinished line, as buffers: linear however large the reply
    for (let delay = 1; Date.now() < deadline;) {
      let got;
      try {
        const buffer = Buffer.allocUnsafe(65536);
        got = buffer.subarray(0, readSync(reply, buffer, 0, buffer.length, null));
      } catch (error) {
        if (error?.code !== "EAGAIN") throw error;
        nap(delay);
        delay = Math.min(delay * 2, 10);
        continue;
      }
      if (got.length === 0) return failed("channel closed");
      delay = 1;
      for (let end = got.indexOf(10); end >= 0; end = got.indexOf(10)) {
        const line = Buffer.concat([...parts, got.subarray(0, end)]).toString("utf8");
        parts = [];
        got = got.subarray(end + 1);
        try {
          const frame = JSON.parse(line);
          if (frame?.id === id)
            return { status: frame.status ?? 1, stdout: frame.stdout ?? "", stderr: frame.stderr ?? "" };
        } catch {} // another caller's or a forged line: not ours
      }
      parts.push(got);
    }
    return failed("no reply (deadline)");
  } catch (error) {
    return failed(error instanceof Error ? error.message : "unreachable");
  } finally {
    for (const fd of [request, reply]) if (fd !== undefined) closeSync(fd);
  }
};

const held = acquire();
const answer = held
  ? call(process.argv.slice(2))
  : { status: 2, stdout: "", stderr: "git broker: busy (lock deadline)\n" };
if (held) rmSync(lock, { recursive: true, force: true });
process.stdout.write(answer.stdout);
process.stderr.write(answer.stderr);
process.exitCode = answer.status;
