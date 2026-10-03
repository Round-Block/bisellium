/**
 * apps/web/tests-serve/global-setup.ts — W-110. playwright.serve.config.ts's
 * globalSetup: the served specs drive the BUILT apps/web/dist, and nothing
 * else in the served path builds it, so every entry point into the config
 * (the gate or a bare `playwright test --config=...`) builds first. Not a
 * spec: it does not match playwright's default testMatch.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// apps/web/tests-serve -> apps/web -> apps -> repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `npm --workspace @bisellium/web run build` from the repo root; an outDir builds there instead of into the repo. */
export function webBuildCommand(outDir?: string): { cmd: string; args: string[]; cwd: string } {
  const args = ["--workspace", "@bisellium/web", "run", "build"];
  if (outDir !== undefined) args.push("--", "--outDir", outDir);
  return { cmd: "npm", args, cwd: REPO_ROOT };
}

export default function globalSetup(): void {
  const { cmd, args, cwd } = webBuildCommand();
  const run = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (run.status !== 0) throw new Error(`web build failed (${run.error?.message ?? `exit ${run.status}`}); refusing to run the served specs on a stale or absent bundle`);
}
