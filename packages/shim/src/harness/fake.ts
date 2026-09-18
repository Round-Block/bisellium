/**
 * @bisellium/shim/harness — 'fake', the profile every test in this repo
 * drives instead of a real vendor CLI (docs/ADOPTION.md talk section). It
 * shells out to packages/shim/test/fake-harness.mjs, the same shape a real
 * profile does (subprocess, stdin, one JSON object back), so talk.ts's
 * plumbing is exercised end to end without ever touching `claude`/`codex`.
 *
 * The script always mints a fresh session_id; `resume()` here is what
 * actually keeps the session pinned, the same way a resumed real CLI call
 * would report back the id it was given rather than a new one.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { HarnessProfile, HarnessResumeOpts, HarnessStartOpts, Turn } from "./types.js";

const SCRIPT = fileURLToPath(new URL("../../test/fake-harness.mjs", import.meta.url));
const TIMEOUT_MS = 30_000;

interface FakeOutput {
  session_id?: string;
  result?: string;
  model?: string;
  usage?: { input?: number; output?: number };
}

function runFakeScript(opts: { cwd: string; env: NodeJS.ProcessEnv; message: string }): Promise<{ parsed?: FakeOutput; stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [SCRIPT], { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { parsed?: FakeOutput; stdout: string; stderr: string; exitCode: number | null }) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ stdout, stderr, exitCode: 1 });
    }, TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", () => {
      clearTimeout(timer);
      finish({ stdout, stderr, exitCode: 127 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed: FakeOutput | undefined;
      try {
        const v: unknown = JSON.parse(stdout.trim());
        if (typeof v === "object" && v !== null) parsed = v as FakeOutput;
      } catch {
        parsed = undefined;
      }
      finish({ parsed, stdout, stderr, exitCode: code });
    });

    child.stdin.write(opts.message);
    child.stdin.end();
  });
}

export const fakeProfile: HarnessProfile = {
  id: "fake",
  tier: 1,

  async available(): Promise<boolean> {
    return true;
  },

  async start(opts: HarnessStartOpts): Promise<Turn> {
    const r = await runFakeScript({ cwd: opts.cwd, env: opts.env, message: opts.message });
    if (!r.parsed) return { sessionId: "", reply: "", exitCode: r.exitCode ?? 1, raw: { stdout: r.stdout, stderr: r.stderr } };
    return {
      sessionId: r.parsed.session_id ?? "",
      reply: r.parsed.result ?? "",
      model: r.parsed.model,
      usage: r.parsed.usage,
      raw: r.parsed,
      exitCode: 0,
    };
  },

  async resume(opts: HarnessResumeOpts): Promise<Turn> {
    const r = await runFakeScript({ cwd: opts.cwd, env: opts.env, message: opts.message });
    if (!r.parsed) return { sessionId: opts.sessionId, reply: "", exitCode: r.exitCode ?? 1, raw: { stdout: r.stdout, stderr: r.stderr } };
    // A real resumed CLI reports back the same session it was given —
    // pin opts.sessionId rather than the fresh id the script always mints.
    return {
      sessionId: opts.sessionId,
      reply: r.parsed.result ?? "",
      model: r.parsed.model,
      usage: r.parsed.usage,
      raw: r.parsed,
      exitCode: 0,
    };
  },
};
