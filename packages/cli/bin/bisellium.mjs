#!/usr/bin/env node
// Thin bin shim so `bisellium` resolves via node_modules/.bin once this
// package is installed — the CLI itself is TypeScript
// (packages/cli/src/main.ts), so this runs it through tsx's loader rather
// than requiring a build step. Uses `node --import <tsx loader>` instead of
// the tsx CLI: the CLI opens an IPC unix socket that OS sandboxes (Claude
// Code's bubblewrap) deny listen() on, while the loader needs none. Resolves
// the loader via node's normal package resolution (createRequire) so it
// works regardless of where npm hoists the tsx devDependency.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const mainTs = join(here, "..", "src", "main.ts");
const require = createRequire(import.meta.url);

let tsxLoader;
try {
  tsxLoader = require.resolve("tsx");
} catch {
  console.error("bisellium: tsx is not installed — run `npm install` at the repo root first");
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", pathToFileURL(tsxLoader).href, mainTs, ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
