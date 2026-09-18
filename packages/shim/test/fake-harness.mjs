#!/usr/bin/env node
/**
 * packages/shim/test/fake-harness.mjs — the subprocess the 'fake' harness
 * profile (packages/shim/src/harness/fake.ts) drives instead of a real
 * vendor CLI. Every test in this repo that exercises `bisellium talk` goes
 * through this script, never a real `claude`/`codex` call.
 *
 * Reads the message from the first non-flag argv token if one is given,
 * else from stdin (mirroring how the real profiles accept a prompt), and
 * always prints exactly one JSON object to stdout.
 */
import { randomUUID } from "node:crypto";

function readStdin() {
  return new Promise((resolvePromise) => {
    if (process.stdin.isTTY) {
      resolvePromise("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", () => resolvePromise(data));
  });
}

const argMessage = process.argv.slice(2).find((a) => !a.startsWith("--"));
const message = (argMessage ?? (await readStdin())).trim();

process.stdout.write(
  JSON.stringify({
    session_id: randomUUID(),
    result: `FAKE: ${message.toUpperCase()}`,
    model: "fake-1",
    usage: { input: 1, output: 2 },
  }) + "\n",
);
