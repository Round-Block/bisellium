#!/usr/bin/env node
/** Host-owned W-125 builder runner. This file is never loaded from candidate code. */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const argv = process.argv.slice(2);
const requestAt = argv.indexOf("--request");
const result = { exitCode: 1, runtime: "uncreated" };
const emit = () => process.stdout.write(`BISELLIUM_HOST_RESULT ${JSON.stringify(result)}\n`);
if (requestAt < 0 || !argv[requestAt + 1]) {
  process.stderr.write("usage: run-builder-host.mjs --request <base64url-json>\n");
  result.exitCode = 2;
  emit();
  process.exit(2);
}

let request;
try {
  request = JSON.parse(Buffer.from(argv[requestAt + 1], "base64url").toString("utf8"));
} catch (error) {
  process.stderr.write(`run-builder-host: invalid request: ${error.message}\n`);
  result.exitCode = 2;
  emit();
  process.exit(2);
}

const OPUS_RE = /^W-[0-9]+$/;
const SELLA_RE = /^[a-z][a-z0-9-]*(?:\.W-[0-9]+)$/;
const GIT_ENV = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/nonexistent",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
};
const git = (cwd, args, options = {}) =>
  spawnSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "filter.lfs.smudge=",
      "-c",
      "filter.lfs.required=false",
      "-c",
      "diff.external=",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, env: GIT_ENV, encoding: "utf8", timeout: 120_000, ...options },
  );
const mustGit = (cwd, args) => {
  const value = git(cwd, args);
  if (value.status !== 0)
    throw new Error(
      `git ${args.join(" ")} failed: ${(value.stderr || value.error?.message || `exit ${value.status}`).trim()}`,
    );
  return value.stdout.trim();
};
const contained = (root, child) => {
  const rel = relative(root, child);
  return !isAbsolute(rel) && rel.split(sep)[0] !== "..";
};
const sourceTree = (repo, ref, excludes) => {
  const normalized = excludes
    .map((value) => value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, ""))
    .filter(Boolean);
  const lines = mustGit(repo, ["ls-tree", "-r", ref]).split("\n");
  const hash = createHash("sha1");
  for (const line of lines) {
    const path = line.slice(line.indexOf("\t") + 1);
    if (!normalized.some((ex) => path === ex || path.startsWith(`${ex}/`))) hash.update(`${line}\n`);
  }
  return hash.digest("hex");
};
const rebaseWorkspaceLinks = (checkout) => {
  for (const parent of ["packages", "adapters", "apps"]) {
    const root = join(checkout, parent);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const workspace = join(root, entry);
      const packageFile = join(workspace, "package.json");
      if (!existsSync(packageFile)) continue;
      const name = JSON.parse(readFileSync(packageFile, "utf8")).name;
      if (typeof name !== "string" || !name.startsWith("@bisellium/")) continue;
      const target = join(checkout, "node_modules", ...name.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      rmSync(target, { recursive: true, force: true });
      symlinkSync(relative(dirname(target), workspace), target, "dir");
    }
  }
};

let runtime;
let lease;
let broker;
let child;
let teardownComplete = false;
let redReplays = [];
try {
  if (!OPUS_RE.test(request.opus) || !SELLA_RE.test(request.sella) || request.sella.split(".").at(-1) !== request.opus)
    throw new Error("invalid or mismatched builder/opus identity");
  const boundary = spawnSync(
    "bwrap",
    [
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--ro-bind",
      "/usr",
      "/usr",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--",
      "/usr/bin/true",
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (boundary.status !== 0)
    throw new Error(
      `outer confinement unavailable: ${(boundary.stderr || boundary.error?.message || `exit ${boundary.status}`).trim()}`,
    );
  const repo = realpathSync(resolve(request.repo));
  const studio = realpathSync(resolve(request.studioRoot));
  if (!contained(repo, studio) || relative(repo, studio).split(sep).join("/") !== request.studioRelative)
    throw new Error("officina translation does not resolve inside repository");
  const branch = `opus/${request.opus}`;
  const baseCommit = mustGit(repo, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
  const toolingCommit = mustGit(repo, ["rev-parse", "--verify", "master^{commit}"]);
  runtime = mkdtempSync(join(tmpdir(), `bisellium-${request.opus}-`));
  result.runtime = runtime;
  for (const name of ["home", "tmp", "cache", "control", "tools", "git-core-mask"])
    mkdirSync(join(runtime, name), { mode: 0o700 });
  writeFileSync(join(runtime, "home", ".npmrc"), "ignore-scripts=true\naudit=false\nfund=false\n");
  writeFileSync(join(runtime, "home", ".npmrc-global"), "ignore-scripts=true\n");
  const leasePath = join(repo, ".bisellium", "leases", request.opus);
  if (request.leaseOwned === true) {
    if (!existsSync(leasePath) || !statSync(leasePath).isDirectory())
      throw new Error("producer lease was not retained through marker persistence");
  } else {
    mkdirSync(dirname(leasePath), { recursive: true });
    mkdirSync(leasePath); // atomic, concurrent producer publication refuses here
  }
  lease = leasePath;

  const clone = join(runtime, "clone");
  const cloned = git(runtime, [
    "clone",
    "--no-local",
    "--no-hardlinks",
    "--dissociate",
    "--single-branch",
    "--branch",
    branch,
    `file://${repo}`,
    clone,
  ]);
  if (cloned.status !== 0) throw new Error(`independent clone failed: ${cloned.stderr.trim()}`);
  mustGit(clone, ["remote", "remove", "origin"]);
  mustGit(clone, ["config", "--local", "gc.auto", "0"]);
  if (!statSync(join(clone, ".git")).isDirectory() || existsSync(join(clone, ".git", "objects", "info", "alternates")))
    throw new Error("clone does not own independent Git metadata/object storage");
  if (mustGit(clone, ["branch", "--show-current"]) !== branch || mustGit(clone, ["rev-parse", "HEAD"]) !== baseCommit)
    throw new Error("clone did not pin the owning branch tip");

  // Dependency preparation is host-side and ends before the network-isolated
  // builder starts. A copy is private; workspace links are rebuilt locally.
  if (existsSync(join(repo, "node_modules"))) {
    cpSync(join(repo, "node_modules"), join(clone, "node_modules"), {
      recursive: true,
      dereference: true,
      verbatimSymlinks: false,
    });
    rebaseWorkspaceLinks(clone);
  }

  const socket = join(runtime, "control", "git.sock");
  const allowedRead = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "ls-tree"]);
  broker = createServer((connection) => {
    let raw = "";
    connection.setEncoding("utf8");
    connection.on("data", (part) => {
      raw += part;
      if (raw.length > 128 * 1024) connection.destroy();
    });
    connection.on("end", () => {
      let response = { status: 2, stdout: "", stderr: "git broker: invalid request\n" };
      try {
        const parsed = JSON.parse(raw);
        const args =
          Array.isArray(parsed.args) && parsed.args.every((arg) => typeof arg === "string") ? parsed.args : [];
        const command = args[0];
        if (
          !command ||
          args.some((arg) => arg === "-c" || arg.startsWith("--git-dir") || arg.startsWith("--work-tree"))
        )
          throw new Error("Git option denied");
        if (command === "bisellium-probe-index") {
          const index = join(runtime, "control", `probe-index-${process.pid}`);
          const env = { ...GIT_ENV, GIT_INDEX_FILE: index };
          const a = git(clone, ["read-tree", "HEAD"], { env });
          const b =
            a.status === 0 ? git(clone, ["hash-object", "-w", "--stdin"], { env, input: "builder probe\n" }) : a;
          response = { status: b.status ?? 1, stdout: b.stdout ?? "", stderr: b.stderr ?? "" };
        } else if (
          allowedRead.has(command) ||
          (command === "branch" && args.length === 2 && args[1] === "--show-current") ||
          command === "add" ||
          command === "commit"
        ) {
          if (
            command === "commit" &&
            args.slice(1).some((arg, index, rest) => arg !== "-m" && rest[index - 1] !== "-m")
          )
            throw new Error("only commit -m <message> is allowed");
          if (command === "add" && args.slice(1).some((arg) => arg.startsWith("-") && arg !== "--all"))
            throw new Error("add option denied");
          const run = git(clone, args, {
            env: {
              ...GIT_ENV,
              GIT_AUTHOR_NAME: request.sella,
              GIT_AUTHOR_EMAIL: `${request.sella}@${request.slug}.bisellium`,
              GIT_COMMITTER_NAME: request.sella,
              GIT_COMMITTER_EMAIL: `${request.sella}@${request.slug}.bisellium`,
            },
          });
          response = {
            status: run.status ?? 1,
            stdout: run.stdout ?? "",
            stderr: run.stderr ?? run.error?.message ?? "",
          };
        } else throw new Error(`Git command denied: ${command}`);
      } catch (error) {
        response.stderr = `git broker: ${error.message}\n`;
      }
      connection.end(JSON.stringify(response));
    });
  });
  await new Promise((ok, fail) => {
    broker.once("error", fail);
    broker.listen(socket, ok);
  });
  chmodSync(socket, 0o600);

  const brokerClient = `#!/usr/bin/env node\nimport net from 'node:net';\nconst s=net.createConnection('/control/git.sock');let r='';s.on('connect',()=>s.end(JSON.stringify({args:process.argv.slice(2)})));s.on('data',x=>r+=x);s.on('end',()=>{const v=JSON.parse(r);process.stdout.write(v.stdout);process.stderr.write(v.stderr);process.exitCode=v.status});s.on('error',e=>{console.error('git broker:',e.message);process.exitCode=2});\n`;
  writeFileSync(join(runtime, "tools", "git"), brokerClient, { mode: 0o555 });

  const probe = fileURLToPath(new URL("./probe-builder-runtime.mjs", import.meta.url));
  const mounts = ["--die-with-parent", "--new-session", "--unshare-all", "--clearenv", "--ro-bind", "/usr", "/usr"];
  for (const lib of ["/lib", "/lib64"]) if (existsSync(lib)) mounts.push("--ro-bind", lib, lib);
  mounts.push(
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--dir",
    "/workspace",
    "--bind",
    clone,
    "/workspace",
    "--ro-bind",
    join(clone, ".git"),
    "/workspace/.git",
    "--ro-bind",
    join(runtime, "tools"),
    "/tools",
    "--bind",
    join(runtime, "control"),
    "/control",
    "--bind",
    join(runtime, "home"),
    "/home/builder",
    "--bind",
    join(runtime, "tmp"),
    "/tmp",
    "--bind",
    join(runtime, "cache"),
    "/cache",
    "--ro-bind",
    probe,
    "/tools/probe-builder-runtime.mjs",
    "--ro-bind",
    "/dev/null",
    "/usr/bin/git",
    "--ro-bind",
    join(runtime, "git-core-mask"),
    "/usr/lib/git-core",
    "--chdir",
    "/workspace",
  );
  const childEnv = {
    PATH: "/tools:/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/builder",
    TMPDIR: "/tmp",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    CI: "1",
    GIT_AUTHOR_NAME: request.sella,
    GIT_AUTHOR_EMAIL: `${request.sella}@${request.slug}.bisellium`,
    GIT_COMMITTER_NAME: request.sella,
    GIT_COMMITTER_EMAIL: `${request.sella}@${request.slug}.bisellium`,
    BISELLIUM_SELLA: request.sella,
    BISELLIUM_STUDIO: request.slug,
    BISELLIUM_SESSION: request.sessionId,
    npm_config_cache: "/cache/npm",
    npm_config_userconfig: "/home/builder/.npmrc",
    npm_config_globalconfig: "/home/builder/.npmrc-global",
    npm_config_registry: "https://registry.npmjs.org",
  };
  for (const [name, value] of Object.entries(childEnv)) mounts.push("--setenv", name, value);
  const opusText = readFileSync(join(studio, "opera", `${request.opus}.md`), "utf8");
  const requireBrowser = /^kind:\s*ui\s*$/m.test(opusText);
  const command = [
    "/usr/bin/node",
    "/tools/probe-builder-runtime.mjs",
    ...(requireBrowser ? ["--require-browser"] : []),
    "--",
    ...request.cmd,
  ];
  child = spawn("bwrap", [...mounts, "--", ...command], {
    env: { PATH: GIT_ENV.PATH },
    stdio: "inherit",
    detached: true,
  });
  const childExit = await new Promise((ok) => {
    child.once("error", (error) => {
      process.stderr.write(`run-builder-host: spawn failed: ${error.message}\n`);
      ok(127);
    });
    child.once("exit", (code, signal) => ok(code ?? (signal === "SIGTERM" ? 143 : 1)));
  });
  result.exitCode = childExit;
  if (childExit !== 0) throw new Error(`confined builder/probe exited ${childExit}`);
  // Revoke the builder before inspecting anything it produced. The PID
  // namespace plus process-group kill covers setsid/double-fork attempts.
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
  await new Promise((ok) => broker.close(ok));
  broker = undefined;

  const finalCommit = mustGit(clone, ["rev-parse", "HEAD"]);
  if (mustGit(clone, ["branch", "--show-current"]) !== branch) throw new Error("builder left the owning branch");
  if (git(clone, ["merge-base", "--is-ancestor", baseCommit, finalCommit]).status !== 0)
    throw new Error("builder tip is not a descendant of pinned base");
  if (mustGit(clone, ["status", "--porcelain"]) !== "") throw new Error("uncommitted builder work is not exportable");
  if (git(clone, ["fsck", "--full", "--no-dangling"]).status !== 0) throw new Error("export object validation failed");
  const brief = join(studio, "briefs", `${request.opus}.md`);
  const owned = new Set();
  if (existsSync(brief)) {
    const section = readFileSync(brief, "utf8").split("## Files owned")[1]?.split(/^## /m)[0] ?? "";
    for (const match of section.matchAll(/^- `([^`]+)`/gm)) owned.add(match[1]);
  }
  const changed =
    finalCommit === baseCommit
      ? []
      : mustGit(clone, ["diff", "--name-only", `${baseCommit}..${finalCommit}`])
          .split("\n")
          .filter(Boolean);
  for (const path of changed) {
    if (
      path.startsWith("studio/") ||
      path.startsWith("examples/") ||
      path === ".gitmodules" ||
      (owned.size && !owned.has(path))
    )
      throw new Error(`export changes unowned/protected path: ${path}`);
  }
  if (finalCommit !== baseCommit) {
    const bundle = join(runtime, "export.bundle");
    mustGit(clone, ["bundle", "create", bundle, `refs/heads/${branch}`]);
    mustGit(repo, ["bundle", "unbundle", bundle]); // imports objects, no ref
    const published = git(repo, ["update-ref", `refs/heads/${branch}`, finalCommit, baseCommit]);
    if (published.status !== 0) throw new Error("owning branch moved concurrently; publication refused");
  }

  // Runtime disposal precedes all producer recomputation.
  rmSync(runtime, { recursive: true, force: true });
  runtime = undefined;
  rmSync(lease, { recursive: true, force: true });
  lease = undefined;
  teardownComplete = true;

  // Recompute every retained red at the clean committed SOURCE identity it
  // names. The log is a claim: only a reachable commit with the same SOURCE
  // hash and a fresh assertion-level failure satisfies it.
  const manifestData = parseYaml(readFileSync(join(studio, "bisellium.yml"), "utf8"));
  const sourceExcludes = [
    request.studioRelative,
    ".bisellium",
    ...(Array.isArray(manifestData.source_excludes) ? manifestData.source_excludes : []),
  ];
  const redDir = join(studio, "ci", "reds", request.opus);
  if (!existsSync(redDir)) throw new Error("producer red replay refused: no recorded reds");
  const redFiles = readdirSync(redDir)
    .filter((name) => /^\d\d\.log$/.test(name))
    .sort();
  if (redFiles.length === 0) throw new Error("producer red replay refused: no numbered reds");
  const history = mustGit(repo, ["rev-list", "--reverse", finalCommit]).split("\n").filter(Boolean);
  const sourceCommits = new Map(history.map((commit) => [`tree:${sourceTree(repo, commit, sourceExcludes)}`, commit]));
  for (const name of redFiles) {
    const text = readFileSync(join(redDir, name), "utf8");
    const behaviour = Number(text.match(/^# behaviour:\s*(\d+)$/m)?.[1]);
    const commandText = text.match(/^# command:\s*(.+)$/m)?.[1];
    const claimedTree = text.match(/^# tree:\s*(tree:[0-9a-f]{40})$/m)?.[1];
    const commit = claimedTree ? sourceCommits.get(claimedTree) : undefined;
    if (!Number.isInteger(behaviour) || !commandText || !claimedTree || !commit)
      throw new Error(`producer red replay refused malformed/unreachable ${name}`);
    const replayRoot = mkdtempSync(join(tmpdir(), `bisellium-red-${request.opus}-${behaviour}-`));
    try {
      const checkout = join(replayRoot, "candidate");
      const clonedRed = git(replayRoot, ["clone", "--no-local", "--no-hardlinks", `file://${repo}`, checkout]);
      if (clonedRed.status !== 0 || git(checkout, ["checkout", "--detach", commit]).status !== 0)
        throw new Error(`red ${behaviour} checkout failed`);
      if (existsSync(join(repo, "node_modules"))) {
        cpSync(join(repo, "node_modules"), join(checkout, "node_modules"), { recursive: true, dereference: true });
        rebaseWorkspaceLinks(checkout);
      }
      const parts = commandText.trim().split(/\s+/);
      const replay = spawnSync(parts[0], parts.slice(1), {
        cwd: checkout,
        env: {
          PATH: GIT_ENV.PATH,
          HOME: join(replayRoot, "home"),
          TMPDIR: replayRoot,
          CI: "1",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          TZ: "UTC",
        },
        encoding: "utf8",
        timeout: 10 * 60_000,
      });
      const output = `${replay.stdout ?? ""}\n${replay.stderr ?? ""}`;
      if (
        replay.status === 0 ||
        !/(?:not ok|AssertionError|ERR_ASSERTION)/.test(output) ||
        /ERR_MODULE_NOT_FOUND|SyntaxError:|command not found|ENOENT|not permitted|permission denied|sandbox/i.test(
          output,
        )
      )
        throw new Error(`red ${behaviour} did not reproduce its assertion failure`);
      process.stdout.write(`producer red ${behaviour} @ ${commit}\n${output}`);
      redReplays.push({ behaviour, commit, sourceTree: claimedTree, command: commandText, assertionFailed: true });
    } finally {
      rmSync(replayRoot, { recursive: true, force: true });
    }
  }

  // Fixed host commands, not candidate package scripts selected at runtime.
  // A fresh no-local checkout ensures candidate tests cannot touch host state.
  const checkRoot = mkdtempSync(join(tmpdir(), `bisellium-check-${request.opus}-`));
  try {
    const candidate = join(checkRoot, "candidate");
    const clonedCandidate = git(checkRoot, [
      "clone",
      "--no-local",
      "--no-hardlinks",
      "--single-branch",
      "--branch",
      branch,
      `file://${repo}`,
      candidate,
    ]);
    if (clonedCandidate.status !== 0) throw new Error(`producer checkout failed: ${clonedCandidate.stderr.trim()}`);
    if (existsSync(join(repo, "node_modules"))) {
      cpSync(join(repo, "node_modules"), join(candidate, "node_modules"), { recursive: true, dereference: true });
      rebaseWorkspaceLinks(candidate);
    }
    const tooling = join(checkRoot, "tooling");
    const clonedTooling = git(checkRoot, ["clone", "--no-local", "--no-hardlinks", `file://${repo}`, tooling]);
    if (clonedTooling.status !== 0 || git(tooling, ["checkout", "--detach", toolingCommit]).status !== 0)
      throw new Error("immutable tooling checkout failed");
    if (existsSync(join(repo, "node_modules"))) {
      cpSync(join(repo, "node_modules"), join(tooling, "node_modules"), { recursive: true, dereference: true });
      rebaseWorkspaceLinks(tooling);
    }
    mkdirSync(join(checkRoot, "home"), { recursive: true });
    mkdirSync(join(checkRoot, "tmp"), { recursive: true });
    const gate = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(tooling, "packages/cli/src/main.ts"),
        "ci",
        "--opus",
        request.opus,
        "--studio",
        join(candidate, request.studioRelative),
        "--repo",
        candidate,
      ],
      {
        cwd: candidate,
        env: {
          PATH: GIT_ENV.PATH,
          HOME: join(checkRoot, "home"),
          TMPDIR: join(checkRoot, "tmp"),
          CI: "1",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          TZ: "UTC",
          NODE_PATH: join(tooling, "node_modules"),
        },
        stdio: "inherit",
        timeout: 60 * 60_000,
      },
    );
    if (gate.status !== 0) throw new Error("producer CI/verify/check recomputation failed");
    const tree = sourceTree(candidate, finalCommit, sourceExcludes);
    result.completion = {
      schema: 1,
      origin: "host-producer",
      opus: request.opus,
      branch,
      builder: request.sella,
      producer: "producer",
      baseCommit,
      finalCommit,
      finalSourceTree: `tree:${tree}`,
      toolingCommit,
      redReplays,
      gates: { ci: true, verify: true, check: true },
      teardownComplete: true,
      completed: true,
    };
    result.exitCode = 0;
  } finally {
    rmSync(checkRoot, { recursive: true, force: true });
  }
} catch (error) {
  process.stderr.write(`run-builder-host: ${error.message}\n`);
  if (result.exitCode === 0) result.exitCode = 1;
} finally {
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  if (broker) await new Promise((ok) => broker.close(ok));
  if (runtime) {
    try {
      rmSync(runtime, { recursive: true, force: false });
    } catch (error) {
      process.stderr.write(`run-builder-host: teardown failed: ${error.message}\n`);
      result.exitCode = 1;
    }
  }
  if (lease) {
    try {
      rmSync(lease, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`run-builder-host: lease cleanup failed: ${error.message}\n`);
      result.exitCode = 1;
    }
  }
  if (!teardownComplete) delete result.completion;
  emit();
}
process.exitCode = result.exitCode;
