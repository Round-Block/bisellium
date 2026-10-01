#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(args) {
  const result = spawnSync("npm", args, { cwd: repo, stdio: "inherit", shell: false });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

const build = run(["--workspace", "@bisellium/web", "run", "build"]);
if (build !== 0) process.exit(build);
process.exit(run(["--workspace", "@bisellium/web", "run", "test:serve"]));
