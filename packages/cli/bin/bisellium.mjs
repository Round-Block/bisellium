#!/usr/bin/env node
// Thin bin shim so `bisellium` resolves via node_modules/.bin once this
// package is installed — the CLI itself is TypeScript
// (packages/cli/src/main.ts), so this execs it through tsx rather than
// requiring a build step. Resolves tsx's own CLI entry via node's normal
// package resolution (createRequire) so it works regardless of where npm
// hoists the tsx devDependency in this workspace.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const mainTs = join(here, "..", "src", "main.ts");
const require = createRequire(import.meta.url);

let tsxCli;
try {
  tsxCli = require.resolve("tsx/cli");
} catch {
  console.error("bisellium: tsx is not installed — run `npm install` at the repo root first");
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, mainTs, ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
