#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const DEFAULT_LIMITS = Object.freeze({ directories: 128, files: 512, opens: 128, bytes: 8 * 1024 * 1024, fileBytes: 256 * 1024, excerptFiles: 16, excerptCharacters: 16_384 });
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".toml", ".yaml", ".yml", ".txt", ".py", ".rs", ".go", ".cs", ".gd", ".sh", ".css", ".html", ".svelte", ".vue"]);
const EXCLUDED_COMPONENTS = new Set([".git", "node_modules", "vendor", "assets", ".worktrees", "worktrees", "dist", "build", "coverage", "research", "briefs", "reports", "test", "tests", "__tests__"]);
const GIT_PREFIX = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.untrackedCache=false"];

let gitRunnerForTests;
export function setGitRunnerForTests(runner) { gitRunnerForTests = runner; }
export function resetGitRunnerForTests() { gitRunnerForTests = undefined; }

const fail = message => { throw new Error(message); };
const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const contained = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);

function validRelative(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || value.includes("\\") || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false;
  const components = value.split("/");
  return components.length <= 32 && components.every(component => component && component !== "." && component !== "..") && EXTENSIONS.has(path.posix.extname(value).toLowerCase());
}

function searchExclusion(value, inventory) {
  if (!validRelative(value)) return "invalid, unsupported, or traversal path";
  const components = value.split("/");
  if (components.some(component => EXCLUDED_COMPONENTS.has(component))) return "excluded path component";
  if (/\.(?:test|spec)\./.test(components.at(-1))) return "excluded test filename";
  if (inventory.has(value)) return "excluded inventory path";
  return null;
}

function configuredLimits(input = {}) {
  const output = {};
  for (const [name, maximum] of Object.entries(DEFAULT_LIMITS)) {
    const value = input[name] ?? maximum;
    if (!Number.isInteger(value) || value < 0 || value > maximum) fail(`invalid budget ${name}`);
    output[name] = value;
  }
  return output;
}

function validate(dataset, binding, mode) {
  if (!dataset || !Array.isArray(dataset.cases)) fail("unsupported dataset cases");
  if (dataset.cases.length > 15) fail("dataset exceeds 15 cases");
  if (!binding?.projects || typeof binding.projects !== "object" || Array.isArray(binding.projects)) fail("unsupported binding projects");
  if (!Array.isArray(binding.routes ?? []) || !Array.isArray(binding.exclusions ?? [])) fail("unsupported binding arrays");
  if (!new Set(["search", "search-diverse", "route"]).has(mode)) fail("mode must be search, search-diverse, or route");
  const projects = Object.entries(binding.projects);
  if (projects.length > 16) fail("binding exceeds 16 projects");
  for (const [projectId, project] of projects) {
    if (!Array.isArray(project?.repositories)) fail(`unsupported repositories for ${projectId}`);
    if (project.repositories.length > 8) fail(`project ${projectId} exceeds 8 repositories`);
    const ids = new Set();
    for (const repository of project.repositories) {
      if (typeof repository?.id !== "string" || !repository.id || ids.has(repository.id)) fail(`duplicate repository id in ${projectId}; repository ids must be unique`);
      if (typeof repository.root !== "string" || !Array.isArray(repository.corpusFiles)) fail(`unsupported repository root or corpus for ${projectId}`);
      if (repository.corpusFiles.length > 512) fail(`repository corpus exceeds 512 paths in ${projectId}`);
      ids.add(repository.id);
    }
  }
  for (const item of dataset.cases) {
    if (!binding.projects[item.project]) fail(`unsupported project ${item.project}`);
    if (!Array.isArray(item.references ?? [])) fail(`unsupported references for ${item.id}`);
    if ((item.references ?? []).length > 128) fail(`case ${item.id} exceeds 128 references`);
  }
  if (mode !== "route") return;
  const required = new Set();
  for (const item of dataset.cases) for (let index = 0; index < (item.references ?? []).length; index++) required.add(`${item.project}\0${item.id}\0${index}`);
  const seen = new Set();
  for (const route of binding.routes ?? []) {
    if (!Number.isInteger(route?.reference) || route.reference < 0) fail("invalid route reference: reference must be a non-negative integer");
    const key = `${route.project}\0${route.case}\0${route.reference}`;
    if (seen.has(key)) fail(`duplicate or ambiguous route ${route.project}/${route.case}/${route.reference}`);
    seen.add(key);
    if (!required.has(key)) fail(`unmapped route reference ${route.project}/${route.case}/${route.reference}`);
    const repositories = binding.projects[route.project]?.repositories;
    if (!repositories?.some(repository => repository.id === route.repository)) fail(`unmapped route repository ${route.repository}`);
  }
  for (const key of required) {
    if (!seen.has(key)) {
      const [, caseId, reference] = key.split("\0");
      fail(`unmapped route for case ${caseId} reference ${reference}`);
    }
  }
}

function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  return { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
}

function systemGitRunner(call) {
  return new Promise((resolve, reject) => {
    const child = spawn(call.command, call.args, { cwd: call.cwd, env: call.env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    let stdoutBytes = 0, stderrBytes = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const overflow = code => { child.kill("SIGKILL"); finish(Object.assign(new Error(code), { code })); };
    child.stdout.on("data", chunk => { stdoutBytes += chunk.length; if (stdoutBytes > call.stdoutLimit) overflow("stdout-limit"); else stdout.push(chunk); });
    child.stderr.on("data", chunk => { stderrBytes += chunk.length; if (stderrBytes > call.stderrLimit) overflow("stderr-limit"); else stderr.push(chunk); });
    child.on("error", error => finish(error));
    child.on("close", code => code === 0 ? finish(null, { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }) : finish(Object.assign(new Error(`git exited ${code}`), { code })));
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(Object.assign(new Error("git timeout"), { code: "timeout" })); }, call.timeout);
  });
}

async function gitIdentity(root, selectedPaths) {
  const identity = { head: "unknown", branch: "unknown", dirty: "unknown", dirtyScope: "selected-paths", gitCalls: 0 };
  const runner = gitRunnerForTests ?? systemGitRunner;
  const invoke = async suffix => {
    identity.gitCalls++;
    return runner({ command: "git", args: [...GIT_PREFIX, ...suffix], cwd: root, env: gitEnvironment(), timeout: 2_000, stdoutLimit: 64 * 1024, stderrLimit: 16 * 1024 });
  };
  try {
    identity.head = (await invoke(["rev-parse", "--verify", "HEAD"])).stdout.trim();
    identity.branch = (await invoke(["symbolic-ref", "--short", "-q", "HEAD"])).stdout.trim() || "detached";
    if (selectedPaths.length) {
      const status = await invoke(["status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=all", "--", ...selectedPaths.map(selected => `:(literal)${selected}`)]);
      identity.dirty = status.stdout !== "";
    }
    return identity;
  } catch {
    return { ...identity, head: "unknown", branch: "unknown", dirty: "unknown" };
  }
}

function emptyRepository(repository, limits) {
  return {
    repository: repository.id, root: repository.root, coverage: "complete", limit: null, limits,
    metrics: { directories: 0, candidates: 0, opens: 0, bytes: 0, omittedExcerpts: 0, rejections: 0 }, failures: [], files: [],
    identity: { head: "unknown", branch: "unknown", dirty: "unknown", dirtyScope: "selected-paths", gitCalls: 0 },
  };
}

async function retrieve(repository, candidates, mode, tokens, referencesByPath, limits, inventory, excerptBudget, diverseFiles) {
  const result = emptyRepository(repository, limits);
  const reject = (relative, reason) => { result.metrics.rejections++; if (result.failures.length < 32) result.failures.push({ path: relative, reason }); };
  if (limits.directories === 0) { result.coverage = "incomplete"; result.limit = "directories"; return result; }
  result.metrics.directories++;
  let root;
  try { root = await realpath(repository.root); }
  catch (error) { result.coverage = "unavailable"; reject(".", `repository unavailable: ${error.code ?? error.message}`); return result; }

  const visitedDirectories = new Set(["."]);
  const canonicalInventory = new Set(inventory);
  if (mode !== "route") {
    for (const excluded of [...inventory].sort(lexical)) {
      if (!validRelative(excluded)) continue;
      if (result.metrics.candidates >= limits.files) { result.coverage = "incomplete"; result.limit = "files"; return result; }
      result.metrics.candidates++;
      const parents = [];
      for (let parent = path.posix.dirname(excluded); parent !== "." && !visitedDirectories.has(parent); parent = path.posix.dirname(parent)) parents.push(parent);
      let resolvable = true;
      for (const parent of parents.reverse()) {
        if (result.metrics.directories >= limits.directories) { result.coverage = "incomplete"; result.limit = "directories"; return result; }
        result.metrics.directories++;
        visitedDirectories.add(parent);
        try {
          const canonicalParent = await realpath(path.join(root, parent));
          if (!contained(root, canonicalParent)) { resolvable = false; break; }
        } catch { resolvable = false; break; }
      }
      if (!resolvable) continue;
      try {
        const canonicalExcluded = await realpath(path.join(root, excluded));
        if (contained(root, canonicalExcluded)) canonicalInventory.add(path.relative(root, canonicalExcluded).split(path.sep).join("/"));
      } catch {}
    }
  }

  for (const relative of candidates) {
    if (result.metrics.candidates >= limits.files) { result.coverage = "incomplete"; result.limit = "files"; break; }
    result.metrics.candidates++;
    const lexicalReason = mode !== "route" ? searchExclusion(relative, inventory) : (!validRelative(relative) ? "invalid, unsupported, or traversal path" : null);
    if (lexicalReason) { reject(relative, lexicalReason); continue; }
    const parents = [];
    for (let parent = path.posix.dirname(relative); parent !== "." && !visitedDirectories.has(parent); parent = path.posix.dirname(parent)) parents.push(parent);
    let rejected = false;
    for (const parent of parents.reverse()) {
      if (result.metrics.directories >= limits.directories) { result.coverage = "incomplete"; result.limit = "directories"; rejected = true; break; }
      result.metrics.directories++;
      visitedDirectories.add(parent);
      try {
        const canonicalParent = await realpath(path.join(root, parent));
        if (!contained(root, canonicalParent)) { reject(relative, "parent symlink escape outside root containment"); rejected = true; break; }
      } catch (error) { reject(relative, `parent unavailable: ${error.code ?? error.message}`); rejected = true; break; }
    }
    if (rejected) { if (result.limit) break; continue; }

    let canonical, metadata;
    try {
      canonical = await realpath(path.join(root, relative));
      if (!contained(root, canonical)) { reject(relative, "symlink escape outside root containment"); continue; }
      const canonicalRelative = path.relative(root, canonical).split(path.sep).join("/");
      if (mode !== "route" && searchExclusion(canonicalRelative, canonicalInventory)) { reject(relative, "canonical target excluded; alias rejected"); continue; }
      metadata = await lstat(canonical);
    } catch (error) { reject(relative, `unavailable: ${error.code ?? error.message}`); continue; }
    if (!metadata.isFile()) { reject(relative, "not a regular file"); continue; }
    if (metadata.size > limits.fileBytes) { reject(relative, "oversized file"); continue; }
    if (result.metrics.opens >= limits.opens) { result.coverage = "incomplete"; result.limit = "opens"; break; }
    if (result.metrics.bytes + metadata.size > limits.bytes) { result.coverage = "incomplete"; result.limit = "bytes"; break; }
    result.metrics.opens++;
    let bytes;
    try { bytes = await readFile(canonical); result.metrics.bytes += bytes.length; }
    catch (error) { reject(relative, `read failed: ${error.code ?? error.message}`); continue; }
    let text;
    try { if (bytes.includes(0)) throw new Error("NUL"); text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { reject(relative, "binary, NUL, or invalid UTF-8 input"); continue; }

    const lines = text.split(/\r?\n/), references = referencesByPath.get(relative) ?? [], ranges = [];
    if (mode === "route") {
      for (const reference of references) {
        const start = Math.max(1, Number.isInteger(reference.start) ? reference.start : 1);
        const end = Math.max(start, Number.isInteger(reference.end) ? reference.end : start);
        ranges.push([start, Math.min(lines.length, end)]);
      }
    } else {
      for (let index = 0; index < lines.length; index++) {
        if (!tokens.some(token => lines[index].toLowerCase().includes(token))) continue;
        const number = index + 1, previous = ranges.at(-1);
        if (previous && number === previous[1] + 1) previous[1] = number; else ranges.push([number, number]);
      }
    }
    if (!ranges.length) continue;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (mode === "search-diverse") {
      const file = { path: relative, ranges, excerpts: [], sha256 };
      result.files.push(file);
      diverseFiles.push({ repository: result, file, rangeTexts: ranges.map(([start, end]) => lines.slice(start - 1, end).join("\n")) });
      continue;
    }
    const excerpts = [];
    if (excerptBudget.files < limits.excerptFiles) {
      for (const [start, end] of ranges) {
        const excerpt = lines.slice(start - 1, end).join("\n"), available = Math.max(0, limits.excerptCharacters - excerptBudget.characters);
        if (!available) { result.metrics.omittedExcerpts++; continue; }
        excerpts.push(excerpt.slice(0, available));
        excerptBudget.characters += Math.min(excerpt.length, available);
        if (excerpt.length > available) result.metrics.omittedExcerpts++;
      }
    } else result.metrics.omittedExcerpts += ranges.length;
    if (excerpts.length) excerptBudget.files++;
    result.files.push({ path: relative, ranges, excerpts, sha256, ...(mode === "route" ? { capturedHashMatches: references.every(reference => reference.fileSha256 === sha256) } : {}) });
  }
  result.identity = await gitIdentity(root, result.files.map(file => file.path));
  return result;
}

function allocateDiverseExcerpts(diverseFiles, limits) {
  const selected = diverseFiles.slice(0, limits.excerptFiles).map(item => ({ ...item, queue: item.rangeTexts.map((text, index) => ({ text, index })) }));
  let remainingCharacters = limits.excerptCharacters;
  while (remainingCharacters > 0) {
    const active = selected.filter(item => item.queue.length > 0);
    if (!active.length) break;
    let remainingTurns = active.length;
    for (const item of active) {
      const quota = Math.floor(remainingCharacters / remainingTurns);
      remainingTurns--;
      if (quota === 0) continue;
      const range = item.queue.shift();
      const excerpt = range.text.slice(0, quota);
      if (excerpt.length > 0) {
        item.file.excerpts.push(excerpt);
        remainingCharacters -= excerpt.length;
      }
    }
  }
  for (const item of diverseFiles) {
    for (let index = 0; index < item.rangeTexts.length; index++) {
      if ((item.file.excerpts[index]?.length ?? 0) < item.rangeTexts[index].length) item.repository.metrics.omittedExcerpts++;
    }
  }
}

export async function runExperiment(dataset, binding, mode, inputLimits = {}) {
  const limits = configuredLimits(inputLimits);
  validate(dataset, binding, mode);
  const inventory = new Set(binding.exclusions ?? []);
  const routeMap = new Map((binding.routes ?? []).map(route => [`${route.project}\0${route.case}\0${route.reference}`, route]));
  const results = [];
  for (const item of dataset.cases) {
    const repositories = [], project = binding.projects[item.project];
    const excerptBudget = { files: 0, characters: 0 }, diverseFiles = [];
    const tokens = [...new Set((String(item.question ?? "").match(/[A-Za-z0-9]+/g) ?? []).map(token => token.toLowerCase()).filter(token => token.length >= 3))];
    for (const repository of [...project.repositories].sort((left, right) => lexical(left.id, right.id))) {
      const referencesByPath = new Map();
      let candidates;
      if (mode !== "route") candidates = [...new Set(repository.corpusFiles)].sort(lexical);
      else {
        for (let index = 0; index < (item.references ?? []).length; index++) {
          const reference = item.references[index], route = routeMap.get(`${item.project}\0${item.id}\0${index}`);
          if (route.repository !== repository.id) continue;
          referencesByPath.set(reference.path, [...(referencesByPath.get(reference.path) ?? []), reference]);
        }
        candidates = [...referencesByPath.keys()].sort(lexical);
      }
      repositories.push(await retrieve(repository, candidates, mode, tokens, referencesByPath, limits, inventory, excerptBudget, diverseFiles));
    }
    if (mode === "search-diverse") allocateDiverseExcerpts(diverseFiles, limits);
    results.push({ id: item.id, project: item.project, question: item.question, repositories });
  }
  return { version: 1, mode, limits, results };
}

function readJson(file, label) {
  if (statSync(file).size > MAX_INPUT_BYTES) fail(`${label} JSON input exceeds 1 MiB`);
  const bytes = readFileSync(file);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(argument => {
    const separator = argument.indexOf("=");
    if (!argument.startsWith("--") || separator < 3) fail("arguments must use --name=value");
    return [argument.slice(2, separator), argument.slice(separator + 1)];
  }));
  if (!args.dataset || !args.binding || !args.mode) fail("required: --dataset= --binding= --mode=");
  const dataset = readJson(args.dataset, "dataset"), binding = readJson(args.binding, "binding");
  process.stdout.write(`${JSON.stringify(await runExperiment(dataset, binding, args.mode, args.limits ? JSON.parse(args.limits) : {}))}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(error => { writeSync(2, `${error.message}\n`); process.exitCode = 1; });
