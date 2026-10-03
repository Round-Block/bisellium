/**
 * W-132: the Git broker's transport. Host-side, transport only: it creates two
 * named pipes in the host-owned, read-only /control mount (`git-request`,
 * `git-reply`, mode 0600), reads newline-delimited `{ id, args }` frames off the
 * first, hands `args` to the `serve` callback and writes `{ id, status, stdout,
 * stderr }` back on the second. Policy (the verb allowlist, the environment,
 * the path mask) stays in scripts/run-builder-host.mjs and arrives as `serve`;
 * this module parses only the frames the cell writes into the pipe it can open
 * and never acts on anything else it finds there.
 *
 * Trust: the cell is untrusted and may write anything to `git-request` or never
 * drain `git-reply`. Two containment choices follow, and they are not Git ones:
 *
 *  - Framing is bounded. A frame over 128 KiB, a frame that is not JSON, an
 *    `args` that is not an array of strings or a missing `id` is answered with a
 *    `status: 2` error frame and never reaches `serve`. A request never
 *    terminated by a newline is discarded at the cap, so it cannot grow the
 *    buffer without limit.
 *  - Replies are one frame, never a queue. `git-reply` is `O_NONBLOCK` and is
 *    written with `writeSync` from an offset: a short write is normal (a big
 *    reply is resumed from where it stopped; a frame is never torn). When the
 *    pipe is full (a cell that never reads) the unwritten remainder is kept and
 *    the host stops reading requests until it is delivered, retrying from an
 *    `unref`ed timer. A blocking write would stop the event loop and a queue
 *    would grow host memory without bound; this buys a live loop and bounded
 *    memory at the price of a reply the deaf cell was never going to read. The
 *    stall reaches the cell as its own client deadline, as a crashed client
 *    already does. A flooding cell only fills the `git-request` kernel buffer.
 *
 * Both pipes are opened O_RDWR so neither end ever sees EOF, and the request
 * pipe is read with non-blocking `readSync` from the same `unref`ed timer. No
 * libuv handle and no threadpool request is ever left pending, so `close()`
 * (clear the timer, close both descriptors) lets the process exit.
 */
import { spawnSync } from "node:child_process";
import { closeSync, constants, openSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

const CAP = 128 * 1024; // the largest request frame (the cap the old socket path used)
const CHUNK = 64 * 1024; // one read off the request pipe
const POLL_MS = 5; // request pipe idle cadence
const RETRY_MS = 10; // reply retry cadence while a remainder is held
const WORK = 16; // reads plus frames per timer tick, so a flood cannot starve the host's event loop

const REJECT = {
  big: "request frame too large",
  json: "request frame is not JSON",
  id: "request frame has no id",
  args: "request args must be an array of strings",
};
const isErrno = (error, code) => error !== null && typeof error === "object" && error.code === code;

/** Create the pipe pair in `controlDir`; `serve(args)` is synchronous and returns `{ status, stdout, stderr }`. */
export function openCellChannel(controlDir, serve) {
  const requestPath = join(controlDir, "git-request");
  const replyPath = join(controlDir, "git-reply");
  for (const path of [requestPath, replyPath]) {
    // mkfifo sets the mode exactly (no umask); a fixed PATH so the ambient one cannot plant a `mkfifo`.
    const made = spawnSync("mkfifo", ["-m", "600", path], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" });
    if (made.status !== 0)
      throw new Error(`git broker: mkfifo failed: ${(made.stderr || made.error?.message || "").trim()}`);
  }
  const requestFd = openSync(requestPath, constants.O_RDWR | constants.O_NONBLOCK);
  const replyFd = openSync(replyPath, constants.O_RDWR | constants.O_NONBLOCK);

  let closed = false;
  let timer;
  // One buffer for the life of the channel (no per-read allocation): bytes [start, end) are read and not yet
  // framed, at most one frame's cap plus the chunk that completes it.
  const inbox = Buffer.allocUnsafe(CAP + CHUNK);
  let start = 0;
  let end = 0;
  let discarding = false; // inside an oversize frame: drop everything up to its newline
  let held; // the one undelivered reply frame, or undefined
  let heldAt = 0;

  /** True once the held frame is fully written. EAGAIN or a zero write keeps the remainder. */
  const deliver = () => {
    while (held !== undefined) {
      let wrote;
      try {
        wrote = writeSync(replyFd, held, heldAt, held.length - heldAt);
      } catch (error) {
        if (isErrno(error, "EAGAIN")) return false;
        wrote = held.length - heldAt; // unwritable for any other reason: drop the frame; the cell's own deadline fires
      }
      if (wrote === 0) return false;
      heldAt += wrote;
      if (heldAt >= held.length) held = undefined;
    }
    return true;
  };
  const reply = (frame) => {
    held = Buffer.from(`${JSON.stringify(frame)}\n`);
    heldAt = 0;
    deliver();
  };
  const reject = (id, why) =>
    reply({ ...(id === undefined ? {} : { id }), status: 2, stdout: "", stderr: `git broker: ${why}\n` });

  const handle = (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return reject(undefined, REJECT.json);
    }
    if (typeof frame !== "object" || frame === null || typeof frame.id !== "string")
      return reject(undefined, REJECT.id);
    if (!Array.isArray(frame.args) || !frame.args.every((arg) => typeof arg === "string"))
      return reject(frame.id, REJECT.args);
    let served;
    try {
      served = serve(frame.args);
    } catch (error) {
      served = {
        status: 2,
        stdout: "",
        stderr: `git broker: ${error instanceof Error ? error.message : "serve failed"}\n`,
      };
    }
    reply({ id: frame.id, status: served.status, stdout: served.stdout, stderr: served.stderr });
  };

  const arm = (ms) => {
    if (closed || timer !== undefined) return;
    timer = setTimeout(step, ms);
    timer.unref(); // never the reason the host stays alive
  };
  const step = () => {
    timer = undefined;
    if (closed) return;
    if (held !== undefined && !deliver()) return arm(RETRY_MS); // request pipe stays unread until the frame is out
    for (let work = 0; work < WORK; work++) {
      const size = inbox.subarray(start, end).indexOf(10);
      if (size < 0) {
        if (end - start > CAP) {
          if (!discarding) reject(undefined, REJECT.big);
          discarding = true;
          start = end = 0;
          if (held !== undefined) return arm(RETRY_MS);
        }
        if (start > 0) {
          inbox.copyWithin(0, start, end);
          end -= start;
          start = 0;
        }
        let got = 0;
        try {
          got = readSync(requestFd, inbox, end, inbox.length - end, null);
        } catch {
          // EAGAIN is the empty pipe; any other error is treated the same, so a timer callback never throws
        }
        if (got === 0) return arm(POLL_MS);
        end += got;
        continue;
      }
      const from = start;
      start += size + 1;
      if (discarding)
        discarding = false; // the newline that ends an oversize frame; the frame itself was answered
      else if (size > CAP) reject(undefined, REJECT.big);
      else handle(inbox.toString("utf8", from, from + size));
      if (held !== undefined) return arm(RETRY_MS);
    }
    arm(0);
  };
  arm(0);

  return {
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      timer = undefined;
      held = undefined;
      start = end = 0;
      closeSync(requestFd);
      closeSync(replyFd);
    },
  };
}
