#!/usr/bin/env node
/**
 * Host-owned W-125 builder runner. This file is never loaded from candidate code.
 *
 * Trust map: this process and the brief/studio it reads are the host. The
 * builder, the red replays and the producer gates all execute candidate code,
 * so each of them runs inside the same bwrap confinement (new user/pid/net/ipc
 * namespaces, cleared environment, read-only host tooling, private writable
 * directories). The result the parent trusts is written to a file the parent
 * created in a directory no sandbox can see; nothing on stdout is ever parsed.
 * Host modules, read from this checkout and never from candidate code:
 * host-cells.mjs, replay-accept.mjs, git-broker.mjs and
 * packages/commands/src/brief-admission.ts (the one behaviour counter).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { constants as osConstants, homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { openCellChannel } from "./git-broker.mjs";
import {
  WEB_BUILD,
  WEB_BUNDLE,
  browserCache,
  browserMounts,
  builderCell,
  prepFailure,
  replayCell,
} from "./host-cells.mjs";
import { classifyReplay } from "./replay-accept.mjs";
import { countBehaviours } from "../packages/commands/src/brief-admission.ts";

const argv = process.argv.slice(2);
const requestAt = argv.indexOf("--request");
const result = { exitCode: 1, runtime: "uncreated" };
let resultFile;
/** Atomic; callable at any point so a runner that dies still leaves its runtime path. */
const flush = () => {
  if (resultFile === undefined) return;
  try {
    writeFileSync(`${resultFile}.tmp`, JSON.stringify(result));
    renameSync(`${resultFile}.tmp`, resultFile);
  } catch (error) {
    process.stderr.write(`run-builder-host: result file unwritable: ${error.message}\n`);
  }
};
const die = (message) => {
  process.stderr.write(`run-builder-host: ${message}\n`);
  result.exitCode = 2;
  flush();
  process.exit(2);
};
if (requestAt < 0 || !argv[requestAt + 1]) die("usage: run-builder-host.mjs --request <base64url-json>");

let request;
try {
  request = JSON.parse(Buffer.from(argv[requestAt + 1], "base64url").toString("utf8"));
} catch (error) {
  die(`invalid request: ${error.message}`);
}
if (typeof request.resultFile !== "string" || !isAbsolute(request.resultFile))
  die("request.resultFile must be an absolute path");
resultFile = request.resultFile;

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
// Passed as `-c`, so they also travel to any child git (GIT_CONFIG_PARAMETERS)
// and win over an embedded repository's own config.
const GIT_LOCKDOWN = [
  "core.hooksPath=/dev/null",
  "core.fsmonitor=false",
  "filter.lfs.smudge=",
  "filter.lfs.required=false",
  "diff.external=",
  "diff.ignoreSubmodules=all",
  "commit.gpgsign=false",
  "gc.auto=0",
  "maintenance.auto=false",
];
const git = (cwd, args, options = {}) =>
  spawnSync("git", [...GIT_LOCKDOWN.flatMap((value) => ["-c", value]), ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
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

/** A dependency copy must resolve entirely inside its checkout, never at the host's tree or a parent's. */
const assertSelfContained = (checkout) => {
  const modules = join(checkout, "node_modules");
  for (const entry of readdirSync(modules, { recursive: true, withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const link = join(entry.parentPath, entry.name);
    if (!contained(checkout, resolve(dirname(link), readlinkSync(link))))
      throw new Error(`dependency link escapes the checkout: ${relative(checkout, link).split(sep).join("/")}`);
  }
};

// ---------------------------------------------------------------------------
// Confinement. One argument builder serves the precheck, the builder, the red
// replays and the producer gates, so none of them can drift to a weaker shape.
// ---------------------------------------------------------------------------
const NODE = realpathSync(process.execPath);
const NODE_BIN = dirname(NODE);
// Host-owned: resolved from the host's own environment, never from the request, the red log or the candidate.
const BROWSERS = browserCache(process.env, homedir());
process.stderr.write(`run-builder-host: ${browserMounts(BROWSERS).log}\n`);
/** The tree the host's Node and its shared libraries live in, when outside /usr (brew, nvm, /opt). */
const nodeRoot = () => {
  if (NODE.startsWith("/usr/")) return undefined;
  const cellar = NODE.indexOf("/Cellar/");
  const root = cellar > 0 ? NODE.slice(0, cellar) : dirname(NODE_BIN);
  return root.split("/").length > 2 ? root : undefined;
};
const systemMounts = () => {
  const args = ["--ro-bind", "/usr", "/usr"];
  // usr-merged hosts keep /bin /sbin /lib /lib64 as symlinks into /usr: recreate
  // the link; elsewhere bind the real directory read-only.
  for (const dir of ["/bin", "/sbin", "/lib", "/lib64"]) {
    let entry;
    try {
      entry = lstatSync(dir);
    } catch {
      continue;
    }
    if (entry.isSymbolicLink()) args.push("--symlink", readlinkSync(dir), dir);
    else args.push("--ro-bind", dir, dir);
  }
  const root = nodeRoot();
  if (root !== undefined) args.push("--ro-bind", root, root);
  return args;
};
/** A private /etc with just enough identity for os.userInfo(); never the host's. */
const etcFor = (dir) => {
  const etc = join(dir, "etc");
  mkdirSync(etc, { recursive: true, mode: 0o700 });
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  writeFileSync(join(etc, "passwd"), `builder:x:${uid}:${gid}::/home/builder:/bin/sh\n`);
  writeFileSync(join(etc, "group"), `builder:x:${gid}:\n`);
  return [
    [join(etc, "passwd"), "/etc/passwd"],
    [join(etc, "group"), "/etc/group"],
  ];
};
/**
 * binds: writable host dirs; roBinds: read-only. Order matters: roBinds follow
 * binds so a read-only file can overlay a writable directory (.git in the clone).
 */
const sandboxArgs = ({ binds = [], roBinds = [], chdir, env, cmd }) => [
  "--die-with-parent",
  "--new-session",
  "--unshare-all",
  "--clearenv",
  ...systemMounts(),
  "--proc",
  "/proc",
  "--dev",
  "/dev",
  ...binds.flatMap(([from, to]) => ["--bind", from, to]),
  ...roBinds.flatMap(([from, to]) => ["--ro-bind", from, to]),
  "--remount-ro",
  "/", // the tmpfs root itself: nothing outside the binds is writable
  ...(chdir ? ["--chdir", chdir] : []),
  ...Object.entries(env).flatMap(([name, value]) => ["--setenv", name, value]),
  "--",
  ...cmd,
];

// ---------------------------------------------------------------------------
// Process and teardown bookkeeping, shared with the signal handlers.
// ---------------------------------------------------------------------------
const children = new Set();
const scratchDirs = new Set();
let runtime;
let lease;
let broker;
let teardownComplete = false;
const killGroup = (child) => {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
};
const scratch = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.add(dir);
  return dir;
};
const removeScratch = (dir) => {
  rmSync(dir, { recursive: true, force: true });
  scratchDirs.delete(dir);
};
const teardownAll = () => {
  for (const child of children) killGroup(child);
  children.clear();
  try {
    broker?.close();
  } catch {}
  broker = undefined;
  let failed = false;
  for (const dir of [runtime, ...scratchDirs].filter(Boolean)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`run-builder-host: teardown failed for ${dir}: ${error.message}\n`);
      failed = true;
    }
  }
  scratchDirs.clear();
  if (!failed) runtime = undefined;
  if (lease) {
    try {
      rmSync(lease, { recursive: true, force: true });
      lease = undefined;
    } catch (error) {
      process.stderr.write(`run-builder-host: lease cleanup failed: ${error.message}\n`);
      failed = true;
    }
  }
  return !failed;
};
let terminating = false;
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    if (terminating) return;
    terminating = true;
    teardownAll();
    result.exitCode = 128 + (osConstants.signals[signal] ?? 15);
    result.error = `terminated by ${signal}`;
    delete result.completion;
    flush();
    process.exit(result.exitCode);
  });
}

/** Async spawn in its own process group, output optionally captured. */
const launch = (command, args, { capture = false, timeout, ...options } = {}) =>
  new Promise((done) => {
    const child = spawn(command, args, { detached: true, ...options });
    children.add(child);
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (part) => (stdout = (stdout + part).slice(-4 * 1024 * 1024)));
      child.stderr.on("data", (part) => (stderr = (stderr + part).slice(-4 * 1024 * 1024)));
    }
    const timer = timeout ? setTimeout(() => killGroup(child), timeout) : undefined;
    const finish = (value) => {
      clearTimeout(timer);
      killGroup(child); // descendants that outlived the leader die with its group
      children.delete(child);
      done({ stdout, stderr, ...value });
    };
    child.once("error", (error) => finish({ status: null, error }));
    child.once("exit", (code, signal) => finish({ status: code, signal }));
  });

// ---------------------------------------------------------------------------
// The Git broker: exact per-verb option allowlist, default deny.
// ---------------------------------------------------------------------------
const REV = String.raw`(?:HEAD|[0-9a-f]{4,40}|opus/W-[0-9]+)(?:[~^][0-9]*)*`;
const REV_ONLY = new RegExp(`^${REV}$`);
const REV_RANGE = new RegExp(`^${REV}(?:\\.{2,3}${REV})?$`);
const re = (...alternatives) => new RegExp(`^(?:${alternatives.join("|")})$`);
const FORMAT = /^--(?:format|pretty)=(?![\s\S]*%G)[^\0]*$/;
const DIFF_OPTS = [
  re(
    "--cached|--staged|--stat|--numstat|--shortstat|--name-only|--name-status|--summary|--raw|-p|--patch|--no-patch|-s",
    "--no-color|--color=never|--no-renames|--no-ext-diff|--no-textconv|-z|--check|--exit-code|--quiet|--minimal",
    "--histogram|--patience|-w|--ignore-all-space|--ignore-space-change|--ignore-space-at-eol|--ignore-blank-lines",
    "--full-index|--abbrev(?:=[0-9]+)?|--diff-filter=[ACDMRTUXB]+|-U[0-9]+|--unified=[0-9]+|-M[0-9]*%?|--find-renames(?:=[0-9]+%?)?",
  ),
];
const LOG_OPTS = [
  ...DIFF_OPTS,
  re(
    "--oneline|--decorate|--no-decorate|--graph|--reverse|--first-parent|--no-merges|--merges|--follow",
    "--abbrev-commit|--no-abbrev-commit|--date=(?:iso|iso-strict|short|relative|unix|raw)",
    "--max-count=[0-9]+|--skip=[0-9]+|-n[0-9]+|-[0-9]+",
  ),
  FORMAT,
];
const VERBS = {
  status: {
    opts: [
      re(
        "-s|--short|-b|--branch|--porcelain(?:=v[12])?|-z|--no-renames|-u(?:no|normal|all)|--untracked-files=(?:no|normal|all)|--ignored",
      ),
    ],
    paths: true,
  },
  diff: { opts: DIFF_OPTS, revs: true, paths: true },
  log: { opts: LOG_OPTS, revs: true, paths: true },
  show: { opts: LOG_OPTS, revs: true, paths: true },
  "rev-parse": {
    opts: [
      re(
        "--verify|--short(?:=[0-9]+)?|--abbrev-ref|--symbolic-full-name|--show-toplevel|--is-inside-work-tree|--show-prefix|--show-cdup|--is-bare-repository|-q|--quiet",
      ),
    ],
    revs: true,
  },
  "ls-files": {
    opts: [
      re(
        "-z|-c|--cached|-o|--others|-m|--modified|-d|--deleted|-s|--stage|--exclude-standard|--full-name|--error-unmatch|-t|--eol",
      ),
    ],
    paths: true,
  },
  "ls-tree": {
    opts: [re("-r|-t|-l|--long|-d|--name-only|--object-only|-z|--full-name|--full-tree|--abbrev(?:=[0-9]+)?")],
    revs: true,
    paths: true,
  },
  add: { opts: [re("-A|--all|-u|--update|-N|--intent-to-add|-n|--dry-run|-v|--verbose")], paths: true },
};
/** A repository-relative path: never absolute, never climbing, never git's own, never pathspec magic. */
const safePath = (value) =>
  value !== "" &&
  !value.includes("\0") &&
  !value.includes("\\") &&
  !/^[-:/~]/.test(value) &&
  !value.split("/").some((part) => part === ".." || part.toLowerCase() === ".git");
const validateGitArgs = (args) => {
  const [verb, ...rest] = args;
  if (typeof verb !== "string" || verb.startsWith("-")) throw new Error("Git option denied before a verb");
  if (verb === "commit") {
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-m" && i + 1 < rest.length) i++;
      else if (!["-a", "--all", "--allow-empty", "-q", "--quiet"].includes(rest[i]))
        throw new Error(`Git option denied: ${rest[i]}`);
    }
    if (!rest.includes("-m")) throw new Error("commit requires -m <message>");
    return;
  }
  if (verb === "branch") {
    if (rest.length === 1 && rest[0] === "--show-current") return;
    throw new Error("only branch --show-current is allowed");
  }
  const spec = VERBS[verb];
  if (spec === undefined) throw new Error(`Git command denied: ${verb}`);
  let afterDashes = false;
  for (const arg of rest) {
    if (afterDashes) {
      if (!safePath(arg)) throw new Error(`Git path denied: ${arg}`);
    } else if (arg === "--") afterDashes = true;
    else if (arg.startsWith("-")) {
      if (!spec.opts.some((allowed) => allowed.test(arg))) throw new Error(`Git option denied: ${arg}`);
    } else if (spec.revs && REV_RANGE.test(arg)) continue;
    else if (spec.revs && arg.includes(":")) {
      const at = arg.indexOf(":");
      if (!(at === 0 || REV_ONLY.test(arg.slice(0, at))) || !safePath(arg.slice(at + 1)))
        throw new Error(`Git revision path denied: ${arg}`);
    } else if (!(spec.paths && safePath(arg))) throw new Error(`Git argument denied: ${arg}`);
  }
};

// ---------------------------------------------------------------------------
// Brief-derived expectations (host data; the candidate cannot touch the studio).
// ---------------------------------------------------------------------------
const filesOwned = (briefText) => {
  const section = briefText.split(/^## Files owned\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  return new Set([...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]));
};

const redReplays = [];
let finalCommit;
try {
  if (!OPUS_RE.test(request.opus) || !SELLA_RE.test(request.sella) || request.sella.split(".").at(-1) !== request.opus)
    throw new Error("invalid or mismatched builder/opus identity");

  const precheckDir = scratch("bisellium-precheck-");
  const precheck = await launch(
    "bwrap",
    sandboxArgs({
      roBinds: etcFor(precheckDir),
      env: { PATH: `${NODE_BIN}:/usr/bin:/bin` },
      cmd: [NODE, "-e", "process.exit(0)"],
    }),
    { capture: true, timeout: 20_000, env: { PATH: GIT_ENV.PATH } },
  );
  removeScratch(precheckDir);
  if (precheck.status !== 0)
    throw new Error(
      `outer confinement unavailable: ${(precheck.stderr || precheck.error?.message || `exit ${precheck.status}`).trim()}`,
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
  flush(); // from here a SIGKILLed runner still tells its parent what to delete
  for (const name of ["home", "tmp", "cache", "control", "probe", "tools", "git-core-mask"])
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
    writeFileSync(join(leasePath, "pid"), `${process.pid}\n`);
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
  // `remote remove` leaves a dangling origin/HEAD symref that fails fsck.
  rmSync(join(clone, ".git", "refs", "remotes"), { recursive: true, force: true });
  mustGit(clone, ["config", "--local", "gc.auto", "0"]);
  if (!statSync(join(clone, ".git")).isDirectory() || existsSync(join(clone, ".git", "objects", "info", "alternates")))
    throw new Error("clone does not own independent Git metadata/object storage");
  if (mustGit(clone, ["branch", "--show-current"]) !== branch || mustGit(clone, ["rev-parse", "HEAD"]) !== baseCommit)
    throw new Error("clone did not pin the owning branch tip");

  // Dependency preparation is host-side and ends before the network-isolated
  // builder starts. A copy is private; workspace links are rebuilt locally.
  const hostModules = join(repo, "node_modules");
  const copyModules = (into) => {
    if (!existsSync(hostModules)) return;
    // Links are copied AS WRITTEN: npm's are relative, so they keep pointing inside the copy.
    // (dereference:true would rewrite them to absolute host paths, i.e. back at the caller's tree.)
    cpSync(realpathSync(hostModules), join(into, "node_modules"), { recursive: true, verbatimSymlinks: true });
    rebaseWorkspaceLinks(into);
    assertSelfContained(into);
  };
  copyModules(clone);

  const controlDir = join(runtime, "control");
  const brokerEnv = {
    ...GIT_ENV,
    GIT_AUTHOR_NAME: request.sella,
    GIT_AUTHOR_EMAIL: `${request.sella}@${request.slug}.bisellium`,
    GIT_COMMITTER_NAME: request.sella,
    GIT_COMMITTER_EMAIL: `${request.sella}@${request.slug}.bisellium`,
  };
  // Policy lives here, in the host runner; scripts/git-broker.mjs is the transport (named pipes in
  // /control) and only calls this with a validated array of strings.
  const serve = (args) => {
    try {
      if (args[0] === "bisellium-probe-index" && args.length === 1) {
        // `probe/` is never bound into the sandbox: host git must not write through a name the builder can plant.
        const index = join(runtime, "probe", "index");
        const env = { ...GIT_ENV, GIT_INDEX_FILE: index };
        const read = git(clone, ["read-tree", "HEAD"], { env });
        const wrote =
          read.status === 0 ? git(clone, ["hash-object", "-w", "--stdin"], { env, input: "builder probe\n" }) : read;
        return { status: wrote.status ?? 1, stdout: wrote.stdout ?? "", stderr: wrote.stderr ?? "" };
      }
      validateGitArgs(args);
      const run = git(clone, args, { env: brokerEnv });
      // The sandbox sees its clone as /workspace; never leak the host path.
      const mask = (text) => (text ?? "").replaceAll(clone, "/workspace");
      return { status: run.status ?? 1, stdout: mask(run.stdout), stderr: mask(run.stderr || run.error?.message) };
    } catch (error) {
      return { status: 2, stdout: "", stderr: `git broker: ${error.message}\n` };
    }
  };
  broker = openCellChannel(controlDir, serve);

  // Host-owned read-only tools: the cell's `git` (the broker's client), the host's Node, the probe.
  const tools = join(runtime, "tools");
  copyFileSync(fileURLToPath(new URL("./git-cell-client.mjs", import.meta.url)), join(tools, "git"));
  chmodSync(join(tools, "git"), 0o555);
  for (const name of ["node", "npm", "npx"])
    if (existsSync(join(NODE_BIN, name))) symlinkSync(join(NODE_BIN, name), join(tools, name));
  copyFileSync(
    fileURLToPath(new URL("./probe-builder-runtime.mjs", import.meta.url)),
    join(tools, "probe-builder-runtime.mjs"),
  );

  const opusText = readFileSync(join(studio, "opera", `${request.opus}.md`), "utf8");
  const requireBrowser = /^kind:\s*ui\s*$/m.test(opusText);
  const built = await launch(
    "bwrap",
    sandboxArgs({
      ...builderCell({
        clone,
        runtime,
        etc: etcFor(runtime),
        sella: request.sella,
        slug: request.slug,
        session: request.sessionId,
        browsers: BROWSERS,
      }),
      cmd: [
        NODE,
        "/tools/probe-builder-runtime.mjs",
        ...(requireBrowser ? ["--require-browser"] : []),
        "--",
        ...request.cmd,
      ],
    }),
    { env: { PATH: GIT_ENV.PATH }, stdio: "inherit" },
  );
  if (built.error) process.stderr.write(`run-builder-host: spawn failed: ${built.error.message}\n`);
  const childExit = built.status ?? (built.error ? 127 : built.signal === "SIGTERM" ? 143 : 1);
  result.exitCode = childExit;
  if (childExit !== 0) throw new Error(`confined builder/probe exited ${childExit}`);
  // Revoke the builder before inspecting anything it produced. The PID
  // namespace plus process-group kill covers setsid/double-fork attempts.
  broker.close();
  broker = undefined;

  finalCommit = mustGit(clone, ["rev-parse", "HEAD"]);
  if (mustGit(clone, ["branch", "--show-current"]) !== branch) throw new Error("builder left the owning branch");
  if (mustGit(clone, ["for-each-ref", "--format=%(refname)"]) !== `refs/heads/${branch}`)
    throw new Error("builder created or kept refs other than the owning branch");
  if (git(clone, ["merge-base", "--is-ancestor", baseCommit, finalCommit]).status !== 0)
    throw new Error("builder tip is not a descendant of pinned base");
  if (mustGit(clone, ["status", "--porcelain"]) !== "") throw new Error("uncommitted builder work is not exportable");
  const fsck = git(clone, ["fsck", "--full", "--no-dangling"]);
  if (fsck.status !== 0)
    throw new Error(
      `export object validation failed: ${(fsck.stderr || fsck.error?.message || `exit ${fsck.status}`).trim()}`,
    );

  // Ownership comes from the HOST brief and fails closed without a list.
  const briefPath = join(studio, "briefs", `${request.opus}.md`);
  if (!existsSync(briefPath))
    throw new Error(`brief declares no Files owned list (no brief at briefs/${request.opus}.md); export refused`);
  const briefText = readFileSync(briefPath, "utf8");
  const owned = filesOwned(briefText);
  if (owned.size === 0) throw new Error("brief declares no Files owned list; export refused");
  const behaviours = countBehaviours(briefText);
  if (behaviours === 0) throw new Error("brief lists no numbered behaviours; there is nothing to replay");
  const protectedPrefixes = ["studio/", "examples/", ".bisellium/", `${request.studioRelative}/`];
  // Every commit is checked on its own (a smuggle that a later commit reverts
  // still ships in history), without rename detection so a deletion cannot
  // hide as the source half of a rename.
  const exported =
    finalCommit === baseCommit
      ? []
      : mustGit(clone, ["rev-list", "--reverse", `${baseCommit}..${finalCommit}`]).split("\n");
  for (const commit of exported) {
    const raw = git(clone, [
      "diff-tree",
      "-r",
      "-m",
      "--root",
      "--no-commit-id",
      "--raw",
      "-z",
      "--no-renames",
      "--no-abbrev",
      commit,
    ]);
    if (raw.status !== 0) throw new Error(`export validation could not list ${commit}`);
    const tokens = raw.stdout.split("\0").filter((token, index, all) => token !== "" || index < all.length - 1);
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const entry = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])$/.exec(tokens[i]);
      const path = tokens[i + 1];
      if (!entry) throw new Error(`export validation could not parse a change in ${commit}`);
      if (path === ".gitmodules" || protectedPrefixes.some((prefix) => path.startsWith(prefix)) || !owned.has(path))
        throw new Error(`export changes unowned/protected path: ${path}`);
      if (entry[2] === "120000" || entry[2] === "160000" || entry[1] === "120000" || entry[1] === "160000")
        throw new Error(`export contains a symlink or gitlink at ${path}`);
    }
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
  // hash and a fresh assertion-level failure satisfies it. A rebase moves that
  // hash, so a well-formed claim that matches no commit is re-identified by the
  // log's own commit (W-134, below). Every numbered behaviour must have one.
  const manifestData = parseYaml(readFileSync(join(studio, "bisellium.yml"), "utf8"));
  const sourceExcludes = [
    request.studioRelative,
    ".bisellium",
    ...(Array.isArray(manifestData.source_excludes) ? manifestData.source_excludes : []),
  ];
  const redDir = join(studio, "ci", "reds", request.opus);
  const redFiles = existsSync(redDir)
    ? readdirSync(redDir)
        .filter((name) => /^\d\d\.log$/.test(name))
        .sort()
    : [];
  for (let n = 1; n <= behaviours; n++)
    if (!redFiles.includes(`${String(n).padStart(2, "0")}.log`)) throw new Error(`no recorded red for behaviour ${n}`);
  const history = mustGit(repo, ["rev-list", "--reverse", finalCommit]).split("\n").filter(Boolean);
  const sourceCommits = new Map(history.map((commit) => [`tree:${sourceTree(repo, commit, sourceExcludes)}`, commit]));
  const seen = new Set();
  // W-134: the rebased pre-change commit is the unique commit on the branch that
  // introduced the exact bytes of this log at its own path, and it carries no
  // source of its own (its source tree is its first parent's). Zero, several or a
  // source-carrying commit refuses; there is no nearest or newest tiebreak.
  const identifyRebased = (name, behaviour, text) => {
    const refuse = (why) => new Error(`producer red replay refused ${name}: behaviour ${behaviour}: ${why}`);
    const log = readFileSync(join(redDir, name));
    const blob = createHash("sha1").update(`blob ${log.length}\0`).update(log).digest("hex");
    const parentOf = new Map(
      mustGit(repo, ["rev-list", "--parents", finalCommit])
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" ")),
    );
    const logRel = `${request.studioRelative}/ci/reds/${request.opus}/${name}`;
    const commits = [...parentOf.keys()];
    const shown = git(repo, ["cat-file", "--batch-check"], { input: commits.map((c) => `${c}:${logRel}\n`).join("") });
    if (shown.status !== 0) throw refuse("the branch's history could not be read");
    const answers = shown.stdout.split("\n");
    const blobAt = new Map(commits.map((c, i) => [c, answers[i].split(" ")[0]]));
    const introduced = commits.filter((c) => blobAt.get(c) === blob && blobAt.get(parentOf.get(c)) !== blob);
    if (introduced.length === 0) throw refuse("no commit on the branch introduced its recorded bytes");
    if (introduced.length > 1) throw refuse(`${introduced.length} commits introduced its recorded bytes`);
    const [commit] = introduced;
    const parent = parentOf.get(commit);
    if (parent === undefined || sourceTree(repo, commit, sourceExcludes) !== sourceTree(repo, parent, sourceExcludes))
      throw refuse(`identifying commit ${commit} carries source`);
    const titles = [...text.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1].replace(/\r$/, ""));
    if (titles.length === 0) throw refuse("its recorded log has no not-ok title to re-attest");
    return { commit, titles };
  };
  for (const name of redFiles) {
    const text = readFileSync(join(redDir, name), "utf8");
    const behaviour = Number(text.match(/^# behaviour:\s*(\d+)$/m)?.[1]);
    const commandText = text.match(/^# command:\s*(.+)$/m)?.[1];
    const claimedTree = text.match(/^# tree:\s*(tree:[0-9a-f]{40})$/m)?.[1];
    let commit = claimedTree ? sourceCommits.get(claimedTree) : undefined;
    if (
      !Number.isInteger(behaviour) ||
      behaviour !== Number(name.slice(0, 2)) ||
      behaviour > behaviours ||
      seen.has(behaviour)
    )
      throw new Error(`producer red replay refused ${name}: behaviour header does not match a declared behaviour`);
    seen.add(behaviour);
    if (!commandText || !claimedTree) throw new Error(`producer red replay refused malformed/unreachable ${name}`);
    let titles;
    if (commit === undefined) ({ commit, titles } = identifyRebased(name, behaviour, text));
    const replayRoot = scratch(`bisellium-red-${request.opus}-${behaviour}-`);
    try {
      const checkout = join(replayRoot, "candidate");
      const clonedRed = git(replayRoot, ["clone", "--no-local", "--no-hardlinks", `file://${repo}`, checkout]);
      if (clonedRed.status !== 0 || git(checkout, ["checkout", "--detach", commit]).status !== 0)
        throw new Error(`red ${behaviour} checkout failed`);
      copyModules(checkout);
      for (const dir of ["home", "tmp"]) mkdirSync(join(replayRoot, dir), { mode: 0o700 });
      const cell = replayCell({
        checkout,
        root: replayRoot,
        etc: etcFor(replayRoot),
        nodeBin: NODE_BIN,
        browsers: BROWSERS,
      });
      // The web bundle is built here, in the replay's own cell, only when the checkout carries the web workspace.
      if (existsSync(join(checkout, "apps", "web", "package.json"))) {
        const build = await launch("bwrap", sandboxArgs({ ...cell, cmd: WEB_BUILD }), {
          capture: true,
          timeout: 10 * 60_000,
          env: { PATH: GIT_ENV.PATH },
        });
        if (build.error || build.status !== 0) {
          process.stderr.write(`${(build.stdout + "\n" + build.stderr).slice(-4096)}\n`);
          throw new Error(prepFailure(behaviour, build.error ? "spawn" : "exit", build.status));
        }
        if (!existsSync(join(checkout, ...WEB_BUNDLE))) throw new Error(prepFailure(behaviour, "bundle"));
      }
      const replay = await launch("bwrap", sandboxArgs({ ...cell, cmd: commandText.trim().split(/\s+/) }), {
        capture: true,
        timeout: 10 * 60_000,
        env: { PATH: GIT_ENV.PATH },
      });
      const output = `${replay.stdout}\n${replay.stderr}`;
      const verdict = classifyReplay({ status: replay.status, output });
      if (!verdict.accepted)
        throw new Error(`red ${behaviour} did not reproduce its assertion failure at ${commit}: ${verdict.reason}`);
      // After a rebase the tree no longer vouches for identity: the replay must show every recorded failure.
      const printed = new Set(
        output.split("\n").map((line) => /^not ok \d+ - (.*)$/.exec(line.replace(/\r$/, ""))?.[1]),
      );
      if (titles !== undefined && !titles.every((title) => printed.has(title)))
        throw new Error(`red ${behaviour} did not reproduce its recorded failure at ${commit}`);
      process.stdout.write(`producer red ${behaviour} @ ${commit}\n${output}`);
      redReplays.push({
        behaviour,
        commit,
        sourceTree: claimedTree,
        replayedTree: `tree:${sourceTree(repo, commit, sourceExcludes)}`,
        command: commandText,
        assertionFailed: true,
      });
    } finally {
      removeScratch(replayRoot);
    }
  }

  // Fixed host commands, not candidate package scripts selected at runtime,
  // against a fresh checkout of the exported tip, confined like the builder.
  const checkRoot = scratch(`bisellium-check-${request.opus}-`);
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
    if (mustGit(candidate, ["rev-parse", "HEAD"]) !== finalCommit)
      throw new Error("producer checkout is not the exported tip");
    copyModules(candidate);
    const tooling = join(checkRoot, "tooling");
    const clonedTooling = git(checkRoot, ["clone", "--no-local", "--no-hardlinks", `file://${repo}`, tooling]);
    if (clonedTooling.status !== 0 || git(tooling, ["checkout", "--detach", toolingCommit]).status !== 0)
      throw new Error("immutable tooling checkout failed");
    copyModules(tooling);
    for (const dir of ["home", "tmp"]) mkdirSync(join(checkRoot, dir), { mode: 0o700 });
    const gate = await launch(
      "bwrap",
      sandboxArgs({
        binds: [
          [candidate, "/candidate"],
          [join(checkRoot, "home"), "/home/builder"],
          [join(checkRoot, "tmp"), "/tmp"],
        ],
        roBinds: [[tooling, "/tooling"], ...etcFor(checkRoot)],
        chdir: "/candidate",
        env: {
          PATH: `${NODE_BIN}:/usr/local/bin:/usr/bin:/bin`,
          HOME: "/home/builder",
          TMPDIR: "/tmp",
          CI: "1",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          TZ: "UTC",
          NODE_PATH: "/tooling/node_modules",
        },
        cmd: [
          NODE,
          "--import",
          "tsx",
          "/tooling/packages/cli/src/main.ts",
          "ci",
          "--opus",
          request.opus,
          "--studio",
          `/candidate/${request.studioRelative}`,
          "--repo",
          "/candidate",
        ],
      }),
      { env: { PATH: GIT_ENV.PATH }, stdio: ["ignore", "inherit", "inherit"], timeout: 60 * 60_000 },
    );
    if (gate.status !== 0) throw new Error("producer CI/verify/check recomputation failed");
    // Identity comes from the host repo, never from the checkout candidate code just ran in.
    const tree = sourceTree(repo, finalCommit, sourceExcludes);
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
    removeScratch(checkRoot);
  }
} catch (error) {
  process.stderr.write(`run-builder-host: ${error.message}\n`);
  if (result.exitCode === 0) result.exitCode = 1;
} finally {
  if (!teardownAll()) result.exitCode = 1;
  if (!teardownComplete) delete result.completion;
  flush();
}
process.exitCode = result.exitCode;
