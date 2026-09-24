/**
 * apps/web/tests-serve/harness.ts — W-067. Not a spec itself: the shared
 * plumbing playwright.serve.config.ts's specs use to stand up a real
 * `bisellium serve` against a throwaway studio and drive the BUILT
 * apps/web/dist against it. No `webServer` block in the config can do this
 * — the write-auth token only ever exists in that process's own stdout
 * (D-023: never baked into the bundle), and a fixed sleep is not a
 * readiness test.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/web/tests-serve -> apps/web -> apps -> repo root.
export const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SAMPLE_STUDIO = join(REPO_ROOT, "examples", "sample-studio");
const MAIN_TS = join(REPO_ROOT, "packages", "cli", "src", "main.ts");
export const WEB_DIST = join(REPO_ROOT, "apps", "web", "dist");

export interface ServedInstance {
  port: number;
  token: string;
  studioDir: string;
  baseURL: string;
  close: () => Promise<void>;
}

/** Polls `GET /api/officina` until it answers 200 — the readiness probe the
 *  brief requires in place of a fixed sleep. */
async function waitForReady(baseURL: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseURL}/api/officina`);
      if (res.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`served instance never became ready at ${baseURL}: ${String(lastErr)}`);
}

/** Spawns a real `bisellium serve` (node --import tsx, never npx tsx)
 *  against a fresh temp copy of examples/sample-studio — these specs write,
 *  so nothing ever points them at studio/ — scrapes the bound port and the
 *  write-auth token off its own stdout, and waits for readiness before
 *  resolving. */
export async function startServed(tag: string): Promise<ServedInstance> {
  const studioDir = mkdtempSync(join(tmpdir(), `bisellium-w067-${tag}-`));
  cpSync(SAMPLE_STUDIO, studioDir, { recursive: true });

  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    ["--import", "tsx", MAIN_TS, "serve", "--studio", studioDir, "--port", "0"],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let port: number | undefined;
  let token: string | undefined;

  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`bisellium serve never printed its port/token within 15s:\n${stdout}`));
    }, 15_000);
    const settle = (fn: () => void): void => {
      clearTimeout(timer);
      fn();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const portMatch = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      const tokenMatch = /write-auth token \(X-Bisellium-Token\): (\S+)/.exec(stdout);
      if (portMatch) port = Number(portMatch[1]);
      if (tokenMatch) token = tokenMatch[1];
      if (port !== undefined && token !== undefined) settle(resolvePromise);
    });
    child.on("error", (e) => settle(() => reject(e)));
    child.on("exit", (code) => {
      if (port === undefined || token === undefined) {
        settle(() => reject(new Error(`bisellium serve exited (${code}) before printing port/token:\n${stdout}`)));
      }
    });
  });

  const baseURL = `http://127.0.0.1:${port}`;
  await waitForReady(baseURL);

  return {
    port: port!,
    token: token!,
    studioDir,
    baseURL,
    close: async () => {
      child.kill();
      await new Promise<void>((r) => {
        if (child.exitCode !== null) {
          r();
          return;
        }
        child.once("exit", () => r());
        setTimeout(r, 2000);
      });
      rmSync(studioDir, { recursive: true, force: true });
    },
  };
}
