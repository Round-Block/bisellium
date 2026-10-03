#!/usr/bin/env node
/** Capability probe run inside the actual builder namespace, before source work. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const expected = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "CI",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "BISELLIUM_SELLA",
  "BISELLIUM_STUDIO",
  "BISELLIUM_SESSION",
  "npm_config_cache",
  "npm_config_userconfig",
  "npm_config_globalconfig",
  "npm_config_registry",
].sort();
// bwrap --chdir exports PWD into the cleared environment; it is not one of the
// 18 producer-set names, and the cwd itself is asserted below.
delete process.env.PWD;
// W-130: the one optional 19th name, admitted only at the fixed cell path, so a host path cannot enter the cell through it.
const actual = Object.keys(process.env)
  .filter((name) => !(name === "PLAYWRIGHT_BROWSERS_PATH" && process.env[name] === "/browsers"))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify(expected))
  throw new Error(`environment allowlist mismatch: ${actual.join(",")}`);
if (process.cwd() !== "/workspace") throw new Error(`unexpected cwd: ${process.cwd()}`);
for (const name of [
  "SSH_AUTH_SOCK",
  "NODE_OPTIONS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "AWS_ACCESS_KEY_ID",
])
  if (process.env[name]) throw new Error(`credential/proxy variable leaked: ${name}`);

const root = mkdtempSync(join(process.env.TMPDIR, "probe-"));
try {
  const grandchild = join(root, "grandchild.txt");
  const childCode =
    "const{spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['-e',`require('node:fs').writeFileSync(process.argv[1],'ok')`,process.argv[1]]);process.exit(r.status??1)";
  const child = spawnSync(process.execPath, ["-e", childCode, grandchild], { stdio: "inherit", env: process.env });
  if (child.status !== 0 || readFileSync(grandchild, "utf8") !== "ok")
    throw new Error("Node child/grandchild probe failed");

  const branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8", env: process.env });
  if (branch.status !== 0 || !branch.stdout.trim().startsWith("opus/W-"))
    throw new Error(`Git read probe failed: ${branch.stderr}`);
  const index = spawnSync("git", ["bisellium-probe-index"], { encoding: "utf8", env: process.env });
  if (index.status !== 0) throw new Error(`Git scratch-index write probe failed: ${index.stderr}`);

  const temporary = join(root, "private-temp.txt");
  writeFileSync(temporary, "private\n");
  if (readFileSync(temporary, "utf8") !== "private\n") throw new Error("private temp-file probe failed");

  await new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => server.close(ok));
  });

  if (existsSync("package.json") && existsSync("node_modules/@bisellium/shim")) {
    // Resolve from the clone, not from this probe's own (tools) directory.
    const resolved = realpathSync("node_modules/@bisellium/shim");
    if (!resolved.startsWith("/workspace/")) throw new Error(`workspace dependency escaped clone: ${resolved}`);
  }
  if (process.argv.includes("--require-browser")) {
    const browsers = ["chromium", "chromium-browser", "google-chrome"];
    let launched = false;
    for (const browser of browsers) {
      const value = spawnSync(browser, ["--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", "about:blank"], {
        encoding: "utf8",
        timeout: 30_000,
        env: process.env,
      });
      if (!value.error && value.status === 0) {
        launched = true;
        break;
      }
    }
    if (!launched) throw new Error("required browser launch probe failed");
  }
  process.stdout.write(
    `${JSON.stringify({ probe: "ok", branch: branch.stdout.trim(), node: process.version, cwd: process.cwd() })}\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

const sep = process.argv.indexOf("--");
const command = sep < 0 ? [] : process.argv.slice(sep + 1);
if (command.length === 0) throw new Error("probe: missing builder command after --");
const run = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), env: process.env, stdio: "inherit" });
if (run.error) {
  process.stderr.write(`probe: builder spawn failed: ${run.error.message}\n`);
  process.exitCode = 127;
} else process.exitCode = run.status ?? (run.signal === "SIGTERM" ? 143 : 1);
