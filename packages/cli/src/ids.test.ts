/**
 * W-101 focused red suite.  Select exactly one numbered behaviour with
 * `--behaviour N`; omitting the selector runs all seven for test:suite.
 * Every repository, ref, worktree and officina made here lives below a
 * fresh OS temporary directory.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import ts from "typescript";
import type { HarnessProfile, Turn } from "@bisellium/shim";
import { newItem, runNew } from "./new.js";
import { draftRetro, type RetroInput } from "./retro.js";
import { runTalk } from "./talk.js";
import { createNextRecord } from "@bisellium/commands/ids.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 7)) {
  console.error("ids.test.ts: --behaviour must be an integer from 1 through 7");
  process.exit(2);
}
const repoArg = argv.find((arg, i) => arg !== "--behaviour" && (i === 0 || argv[i - 1] !== "--behaviour"));
const repo = resolve(repoArg ?? ".");
const mainPath = join(repo, "packages", "cli", "src", "main.ts");
const tsxImport = import.meta.resolve("tsx");

let failed = 0;
function runs(n: number): boolean {
  return only === undefined || only === n;
}
function check(n: number, name: string, ok: boolean, detail = ""): void {
  if (!runs(n)) return;
  console.log(`${ok ? "PASS" : "FAIL"}  b${n} ${name.padEnd(88)} ${detail}`);
  if (!ok) failed++;
}

const roots: string[] = [];
function scratch(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `w101-ids-${tag}-`));
  roots.push(root);
  return root;
}
process.on("exit", () => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.  All paths are private mkdtemp roots.
    }
  }
});

function executableOnPath(name: string): string {
  for (const entry of (process.env["PATH"] ?? "").split(delimiter)) {
    const candidate = join(entry, name);
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error(`${name} not found on PATH`);
}
const realGit = executableOnPath("git");

function git(cwd: string, args: string[]): string {
  return execFileSync(realGit, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeManifest(studio: string): void {
  mkdirSync(studio, { recursive: true });
  writeFileSync(
    join(studio, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-101 fixture",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: eng-lead, collegium: engineering, kind: agent, harness: fake }",
      "  - { id: qa-lead, collegium: qa, kind: agent, harness: fake }",
      "probationes: []",
      "wip_limit: 20",
      "",
    ].join("\n"),
  );
}

function record(studio: string, directory: "opera" | "lessons" | "petitiones", id: string, body?: string): string {
  const dir = join(studio, directory);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.md`);
  writeFileSync(path, body ?? `---\nid: ${JSON.stringify(id)}\n---\n${id}\n`);
  return path;
}

function initRepo(tag: string, studioRel = "studio"): { root: string; studio: string } {
  const root = scratch(tag);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "W-101 Test"]);
  git(root, ["config", "user.email", "w101@example.invalid"]);
  const studio = join(root, ...studioRel.split("/"));
  writeManifest(studio);
  return { root, studio };
}

function commitAll(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function branchRecord(
  root: string,
  studioRel: string,
  branch: string,
  directory: "opera" | "lessons" | "petitiones",
  id: string,
  body?: string,
): string {
  git(root, ["switch", "main"]);
  git(root, ["switch", "-c", branch]);
  record(join(root, ...studioRel.split("/")), directory, id, body);
  const commit = commitAll(root, `${branch} ${id}`);
  git(root, ["switch", "main"]);
  return commit;
}

function rawTreeRecord(root: string, studioDirectory: string, branch: string, id: string): void {
  const fixturePath = join(root, `.raw-${branch}`);
  writeFileSync(fixturePath, "raw tree fixture\n");
  const blob = git(root, ["hash-object", "-w", fixturePath]);
  const treeObject = (mode: string, name: string, oid: string): string => {
    writeFileSync(fixturePath, Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")]));
    return git(root, ["hash-object", "-w", "-t", "tree", fixturePath]);
  };
  const records = treeObject("100644", `${id}.md`, blob);
  const studio = treeObject("40000", "opera", records);
  const tree = treeObject("40000", studioDirectory, studio);
  const commit = git(root, ["commit-tree", tree, "-p", "HEAD", "-m", `${branch} ${id}`]);
  git(root, ["update-ref", `refs/heads/${branch}`, commit]);
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
let cliRun = 0;
async function spawnCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  const output = scratch(`cli-output-${++cliRun}`);
  const stdoutPath = join(output, "stdout");
  const stderrPath = join(output, "stderr");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const child = spawn(process.execPath, ["--import", tsxImport, mainPath, ...args], {
    cwd: options.cwd ?? repo,
    env: options.env ?? process.env,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  return await new Promise<RunResult>((resolveRun, reject) => {
    child.once("error", reject);
    child.once("close", (status) =>
      resolveRun({ status, stdout: readFileSync(stdoutPath, "utf8"), stderr: readFileSync(stderrPath, "utf8") }),
    );
  });
}

function captureConsole<T>(fn: () => T): { value: T; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const oldLog = console.log;
  const oldError = console.error;
  console.log = (...parts: unknown[]) => stdout.push(parts.map(String).join(" "));
  console.error = (...parts: unknown[]) => stderr.push(parts.map(String).join(" "));
  try {
    return { value: fn(), stdout, stderr };
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
}

// ---------------------------------------------------------------------------
// Behaviour 1 — every local branch, remote-tracking ref and dirty tree.
// ---------------------------------------------------------------------------

interface RefRow {
  name: string;
  localA: number;
  localB: number;
  remote: number;
  dirty: number;
  expected: number;
}

function refFixture(tag: string, row: RefRow): { root: string; studio: string; sentinel: string } {
  const { root, studio } = initRepo(tag);
  const sentinel = record(studio, "opera", "W-004", '---\nid: "W-999"\n---\nfilename wins\n');
  record(studio, "opera", "P-777");
  writeFileSync(join(studio, "opera", "W-900.txt"), "not markdown\n");
  mkdirSync(join(studio, "opera", "nested"), { recursive: true });
  writeFileSync(join(studio, "opera", "nested", "W-888.md"), "nested\n");
  commitAll(root, "baseline");
  branchRecord(root, "studio", "local-a", "opera", `W-${String(row.localA).padStart(3, "0")}`);
  branchRecord(root, "studio", "local-b", "opera", `W-${String(row.localB).padStart(3, "0")}`);
  const remoteCommit = branchRecord(root, "studio", "remote-seed", "opera", `W-${String(row.remote).padStart(3, "0")}`);
  git(root, ["update-ref", "refs/remotes/origin/queued", remoteCommit]);
  git(root, ["branch", "-D", "remote-seed"]);
  if (row.dirty > 4) record(studio, "opera", `W-${String(row.dirty).padStart(3, "0")}`);
  return { root, studio, sentinel };
}

if (runs(1)) {
  const rows: RefRow[] = [
    { name: "first local branch decisive", localA: 9, localB: 7, remote: 8, dirty: 2, expected: 10 },
    { name: "second local branch decisive", localA: 7, localB: 11, remote: 8, dirty: 2, expected: 12 },
    { name: "remote-tracking ref decisive", localA: 7, localB: 8, remote: 13, dirty: 2, expected: 14 },
    { name: "dirty tree pins W-109 -> W-110", localA: 7, localB: 8, remote: 9, dirty: 109, expected: 110 },
  ];
  const problems: string[] = [];
  for (const row of rows) {
    for (const caller of ["newItem", "runNew"] as const) {
      const fixture = refFixture(`b1-${row.name.replaceAll(" ", "-")}-${caller}`, row);
      const before = readFileSync(fixture.sentinel, "utf8");
      const beforeFiles = new Set(readdirSync(join(fixture.studio, "opera")));
      let id: string | undefined;
      if (caller === "newItem") {
        id = newItem(fixture.studio, { kind: "task", collegium: "engineering", title: `${row.name} newItem` }).id;
      } else {
        const captured = captureConsole(() =>
          runNew(["--kind", "task", "--collegium", "engineering", "--title", `${row.name} runNew`, fixture.studio]),
        );
        id = captured.stdout.at(-1);
      }
      const expectedId = `W-${String(row.expected).padStart(3, "0")}`;
      const target = join(fixture.studio, "opera", `${expectedId}.md`);
      const raw = existsSync(target) ? readFileSync(target, "utf8") : "";
      const added = readdirSync(join(fixture.studio, "opera")).filter((name) => !beforeFiles.has(name));
      if (
        id !== expectedId ||
        !raw.includes(`id: ${JSON.stringify(expectedId)}`) ||
        readFileSync(fixture.sentinel, "utf8") !== before ||
        JSON.stringify(added) !== JSON.stringify([`${expectedId}.md`])
      ) {
        problems.push(
          `${row.name}/${caller}: expected=${expectedId} actual=${String(id)} target=${existsSync(target)} sentinel=${readFileSync(fixture.sentinel, "utf8") === before} added=${JSON.stringify(added)}`,
        );
      }
    }
  }
  check(1, "newItem and runNew allocate max-plus-one from each ref source and the dirty tree", problems.length === 0, problems.join(" | "));

  const pathnameFixture = initRepo("b1-nul-pathnames");
  record(pathnameFixture.studio, "opera", "W-009");
  commitAll(pathnameFixture.root, "baseline nine");
  git(pathnameFixture.root, ["switch", "-c", "hostile-pathnames"]);
  writeFileSync(join(pathnameFixture.studio, "opera", "W-999999.md\nsuffix"), "not an id filename\n");
  const nested = join(pathnameFixture.studio, "opera", "nested\nstudio", "opera");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "W-888888.md"), "nested\n");
  commitAll(pathnameFixture.root, "newline pathnames");
  git(pathnameFixture.root, ["switch", "main"]);
  const pathnameResult = newItem(pathnameFixture.studio, {
    kind: "task",
    collegium: "engineering",
    title: "NUL-only pathname parsing",
  });
  check(
    1,
    "ls-tree -z treats newlines as pathname bytes and still excludes nested records",
    pathnameResult.ok && pathnameResult.id === "W-010",
    JSON.stringify(pathnameResult),
  );

  const numericProblems: string[] = [];
  for (const [name, invalid] of [
    ["infinity", "9".repeat(309)],
    ["unsafe-integer", "9007199254740992"],
  ] as const) {
    const fixture = initRepo(`b1-${name}`);
    record(fixture.studio, "opera", "W-004");
    commitAll(fixture.root, "numeric baseline");
    rawTreeRecord(fixture.root, "studio", `${name}-suffix`, `W-${invalid}`);
    const result = newItem(fixture.studio, {
      kind: "task",
      collegium: "engineering",
      title: `${name} suffix`,
    });
    if (!result.ok || result.id !== "W-005") numericProblems.push(`${name}=${JSON.stringify(result)}`);
  }
  check(
    1,
    "suffixes over nine digits are ignored instead of minting Infinity or unsafe integers",
    numericProblems.length === 0,
    numericProblems.join(" | "),
  );
}

// ---------------------------------------------------------------------------
// Behaviour 2 — retro/talk observable allocation plus five-row source census.
// ---------------------------------------------------------------------------

function retroRefFixture(tag: string): { root: string; studio: string } {
  const { root, studio } = initRepo(tag);
  writeFileSync(join(studio, "evidence.log"), "evidence\n");
  record(
    studio,
    "lessons",
    "L-001",
    '---\nid: "L-001"\nat: 2026-09-01T00:00:00Z\nclass: "recurring"\nevidence: ["evidence.log"]\ncascade: 1\n---\nold\n',
  );
  commitAll(root, "baseline");
  branchRecord(root, "studio", "lesson-high", "lessons", "L-020");
  const remoteCommit = branchRecord(root, "studio", "petitio-seed", "petitiones", "P-030");
  git(root, ["update-ref", "refs/remotes/origin/petition", remoteCommit]);
  git(root, ["branch", "-D", "petitio-seed"]);
  return { root, studio };
}

function functionName(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    current = current.parent;
  }
  return "<module>";
}

function idSeamCalls(rel: string): string[] {
  const path = join(repo, ...rel.split("/"));
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "@bisellium/commands/ids.js") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if ((specifier.propertyName ?? specifier.name).text === "createNextRecord") direct.add(specifier.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const calls: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const matches =
        (ts.isIdentifier(expression) && direct.has(expression.text)) ||
        (ts.isPropertyAccessExpression(expression) &&
          expression.name.text === "createNextRecord" &&
          ts.isIdentifier(expression.expression) &&
          namespaces.has(expression.expression.text));
      if (matches) calls.push(`${rel}:${functionName(node)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

if (runs(2)) {
  const problems: string[] = [];
  const retroFixture = retroRefFixture("b2-retro");
  const retroInput: RetroInput = {
    verifierIssues: 0,
    reviewFindings: [{ class: "recurring", where: "fixture", evidence: ["evidence.log"] }],
    agents: [],
    tests: 1,
    fixRounds: 0,
    mutationsCaught: 0,
  };
  const drafted = draftRetro(retroFixture.studio, 2, retroInput, new Date("2026-10-01T00:00:00Z"));
  if (drafted.lessons[0]?.path !== "lessons/L-021.md") problems.push(`draftRetro lesson=${drafted.lessons[0]?.path}`);
  if (drafted.petitiones[0] !== "petitiones/P-031.md") problems.push(`draftRetro petitio=${drafted.petitiones[0]}`);

  const talkFixture = retroRefFixture("b2-talk");
  const fake: HarnessProfile = {
    id: "fake",
    tier: 1,
    available: async () => true,
    start: async (): Promise<Turn> => ({ sessionId: "w101", reply: "PETITIO: ref-aware escalation", exitCode: 0 }),
    resume: async (): Promise<Turn> => ({ sessionId: "w101", reply: "PETITIO: ref-aware escalation", exitCode: 0 }),
  };
  const talked = await (async () => {
    const logs: string[] = [];
    const old = console.log;
    console.log = (...parts: unknown[]) => logs.push(parts.map(String).join(" "));
    try {
      const result = await runTalk(
        ["--sella", "eng-lead", "--harness", "fake", "--model-only", "--studio", talkFixture.studio, "escalate"],
        { harnesses: { fake } },
      );
      return { result, logs };
    } finally {
      console.log = old;
    }
  })();
  if (talked.result.exitCode !== 0 || !talked.logs.includes("petitio P-031 opened")) problems.push(`talk=${JSON.stringify(talked)}`);

  const actualCalls = [
    ...idSeamCalls("packages/cli/src/new.ts"),
    ...idSeamCalls("packages/cli/src/retro.ts"),
    ...idSeamCalls("packages/commands/src/talk.ts"),
  ];
  const expectedCalls = [
    "packages/cli/src/new.ts:newItem",
    "packages/cli/src/new.ts:runNew",
    "packages/cli/src/retro.ts:draftRetro",
    "packages/cli/src/retro.ts:draftRetro",
    "packages/commands/src/talk.ts:openPetitio",
  ];
  if (JSON.stringify(actualCalls) !== JSON.stringify(expectedCalls)) {
    problems.push(`source census expected=${JSON.stringify(expectedCalls)} actual=${JSON.stringify(actualCalls)}`);
  }
  const newSource = readFileSync(join(repo, "packages/cli/src/new.ts"), "utf8");
  const retroSource = readFileSync(join(repo, "packages/cli/src/retro.ts"), "utf8");
  const talkSource = readFileSync(join(repo, "packages/commands/src/talk.ts"), "utf8");
  if (/const\s+ID_RE\s*=/.test(newSource) || /function\s+nextId\s*\(/.test(retroSource) || /PETITIO_ID_RE/.test(talkSource)) {
    problems.push("old local max scanner remains");
  }
  check(2, "all five allocator rows use the shared ids seam and observe off-branch maxima", problems.length === 0, problems.join(" | "));
}

// ---------------------------------------------------------------------------
// Behaviour 3 — warned local-only fallback and non-Git filesystem errors.
// ---------------------------------------------------------------------------

function localStudio(tag: string): string {
  const root = scratch(tag);
  const studio = join(root, "officina");
  writeManifest(studio);
  record(studio, "opera", "W-004");
  return studio;
}

function fakeGitDir(tag: string): string {
  const dir = scratch(`fake-git-${tag}`);
  const script = join(dir, "git");
  writeFileSync(
    script,
    `#!${process.execPath}\n` +
      `const fs = require("node:fs");\n` +
      `const args = process.argv.slice(2);\n` +
      `const mode = process.env.W101_GIT_MODE || "";\n` +
      `const root = process.env.W101_GIT_ROOT || "";\n` +
      `if (args.includes("rev-parse")) { if (mode === "discovery") process.exit(41); console.log(root); process.exit(0); }\n` +
      `if (args.includes("for-each-ref")) { if (mode === "refs") process.exit(42); console.log("refs/heads/high\\nrefs/remotes/origin/high"); process.exit(0); }\n` +
      `if (args.includes("ls-tree")) { const p = process.env.W101_GIT_COUNT; let n = 0; try { n = Number(fs.readFileSync(p, "utf8")); } catch {} fs.writeFileSync(p, String(n + 1)); if (mode === "tree" && n > 0) process.exit(43); process.stdout.write((process.env.W101_GIT_TREE_ENTRY || "officina/opera/W-099.md") + "\\0"); process.exit(0); }\n` +
      `process.exit(44);\n`,
  );
  chmodSync(script, 0o755);
  return dir;
}

function warnedLocalOnly(result: RunResult): boolean {
  return result.status === 0 && result.stdout.trim() === "W-005" && /git|ref/i.test(result.stderr) && /local[^\n]*only|only[^\n]*local/i.test(result.stderr);
}

if (runs(3)) {
  const problems: string[] = [];
  const outside = localStudio("b3-nonrepo");
  const nonRepo = await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", "nonrepo", outside]);
  if (!warnedLocalOnly(nonRepo)) problems.push(`non-repo=${JSON.stringify(nonRepo)}`);

  const directStudio = localStudio("b3-direct-result");
  const direct = newItem(directStudio, { kind: "task", collegium: "engineering", title: "direct result contract" });
  if (!direct.ok || direct.id !== "W-005" || direct.message !== "W-005") problems.push(`newItem result=${JSON.stringify(direct)}`);

  const relativeStudio = localStudio("b3-relative-root");
  const relativeRoot = relative(repo, relativeStudio);
  const relativeCreated = createNextRecord(relativeRoot, "lessons", "L", (id) => `${id}\n`);
  check(
    3,
    "direct createNextRecord with a relative officina returns the absolute created path",
    isAbsolute(relativeCreated.path) && existsSync(relativeCreated.path) && relativeCreated.id === "L-001",
    JSON.stringify(relativeCreated),
  );

  const noGitStudio = localStudio("b3-no-git");
  const emptyPath = scratch("b3-empty-path");
  const noGit = await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", "no git", noGitStudio], {
    env: { ...process.env, PATH: emptyPath },
  });
  if (!warnedLocalOnly(noGit)) problems.push(`no-git=${JSON.stringify(noGit)}`);

  for (const mode of ["discovery", "refs", "tree"] as const) {
    const studio = localStudio(`b3-${mode}`);
    const fakeDir = fakeGitDir(mode);
    const count = join(dirname(studio), `${mode}.count`);
    const result = await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", mode, studio], {
      env: { ...process.env, PATH: `${fakeDir}${delimiter}${process.env["PATH"] ?? ""}`, W101_GIT_MODE: mode, W101_GIT_ROOT: dirname(studio), W101_GIT_COUNT: count },
    });
    if (!warnedLocalOnly(result) || existsSync(join(studio, "opera", "W-100.md"))) problems.push(`${mode}=${JSON.stringify(result)}`);
  }

  const fsRoot = scratch("b3-filesystem");
  const fsStudio = join(fsRoot, "officina");
  writeManifest(fsStudio);
  writeFileSync(join(fsStudio, "opera"), "not a directory\n");
  const fsError = await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", "fs", fsStudio]);
  if (fsError.status !== 1 || !/new failed:/i.test(fsError.stderr) || /local[^\n]*only/i.test(fsError.stderr)) {
    problems.push(`filesystem=${JSON.stringify(fsError)}`);
  }

  const literal = initRepo("b3-literal-pathspec", ":officina");
  record(literal.studio, "opera", "W-001");
  commitAll(literal.root, "literal baseline");
  branchRecord(literal.root, ":officina", "literal-high", "opera", "W-012");
  const literalResult = newItem(literal.studio, { kind: "task", collegium: "engineering", title: "literal pathspec" });

  const replaced = initRepo("b3-replace-object");
  record(replaced.studio, "opera", "W-001");
  const replacedMain = commitAll(replaced.root, "replace baseline");
  git(replaced.root, ["switch", "-c", "replacement-source"]);
  record(replaced.studio, "opera", "W-777");
  const replacementCommit = commitAll(replaced.root, "replacement poison");
  git(replaced.root, ["switch", "main"]);
  git(replaced.root, ["branch", "-D", "replacement-source"]);
  git(replaced.root, ["replace", replacedMain, replacementCommit]);
  const replacedResult = newItem(replaced.studio, { kind: "task", collegium: "engineering", title: "ignore replacements" });
  check(
    3,
    "Git paths are literal and replacement objects cannot poison the ref maximum",
    literalResult.ok && literalResult.id === "W-013" && replacedResult.ok && replacedResult.id === "W-002",
    JSON.stringify({ literalResult, replacedResult }),
  );
  check(3, "Git failures warn and discard partial refs; filesystem failures retain caller errors", problems.length === 0, problems.join(" | "));
}

// ---------------------------------------------------------------------------
// Behaviour 4 — cached remote-tracking refs, no implicit network operation.
// ---------------------------------------------------------------------------

function makeGitSpy(tag: string, log: string): string {
  const dir = scratch(`git-spy-${tag}`);
  const script = join(dir, "git");
  writeFileSync(
    script,
      `#!${process.execPath}\n` +
      `const fs = require("node:fs"); const cp = require("node:child_process");\n` +
      `fs.appendFileSync(process.env.W101_GIT_LOG, JSON.stringify({ args: process.argv.slice(2), noLazyFetch: process.env.GIT_NO_LAZY_FETCH }) + "\\n");\n` +
      `const r = cp.spawnSync(process.env.W101_REAL_GIT, process.argv.slice(2), { stdio: "inherit" });\n` +
      `process.exit(r.status === null ? 127 : r.status);\n`,
  );
  chmodSync(script, 0o755);
  void log;
  return dir;
}

if (runs(4)) {
  const root = scratch("b4");
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  const clone = join(root, "clone");
  mkdirSync(seed);
  git(root, ["init", "--bare", origin]);
  git(seed, ["init", "-b", "main"]);
  git(seed, ["config", "user.name", "W-101 Test"]);
  git(seed, ["config", "user.email", "w101@example.invalid"]);
  writeManifest(join(seed, "studio"));
  record(join(seed, "studio"), "opera", "W-001");
  commitAll(seed, "baseline");
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "-u", "origin", "main"]);
  git(origin, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(seed, ["switch", "-c", "queued"]);
  record(join(seed, "studio"), "opera", "W-005");
  commitAll(seed, "cached five");
  git(seed, ["push", "-u", "origin", "queued"]);
  git(root, ["clone", origin, clone]);

  record(join(seed, "studio"), "opera", "W-009");
  commitAll(seed, "server-only nine");
  git(seed, ["push", "origin", "queued"]);
  git(clone, ["remote", "set-url", "origin", join(root, "guaranteed-unreachable.git")]);

  const log = join(root, "git.log");
  const spy = makeGitSpy("b4", log);
  const first = await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", "cached", join(clone, "studio")], {
    env: { ...process.env, PATH: `${spy}${delimiter}${process.env["PATH"] ?? ""}`, W101_GIT_LOG: log, W101_REAL_GIT: realGit },
  });
  const invocations = existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; noLazyFetch?: string })
    : [];
  const commands = invocations.map(({ args }) => args);
  const flat = commands.map((parts) => parts.join(" ")).join("\n");
  const forbidden = /(^|\s)(fetch|pull|push|clone|ls-remote)(\s|$)/m.test(flat);
  const lazyFetchDisabled = invocations.length > 0 && invocations.every(({ noLazyFetch }) => noLazyFetch === "1");

  git(clone, ["remote", "set-url", "origin", origin]);
  git(clone, ["fetch", "origin"]); // Explicit test setup, never allocator behavior.
  const second = await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", "after explicit fetch", join(clone, "studio")]);
  check(
    4,
    "cached origin W-005 yields W-006 without network; explicit fetch of W-009 yields W-010",
    first.status === 0 && first.stdout.trim() === "W-006" && flat.includes("for-each-ref") && flat.includes("ls-tree") && !forbidden && lazyFetchDisabled && second.status === 0 && second.stdout.trim() === "W-010",
    JSON.stringify({ first, invocations, forbidden, lazyFetchDisabled, second }),
  );
}

// ---------------------------------------------------------------------------
// Behaviour 5 — deterministic two-process race and direct EEXIST collision.
// ---------------------------------------------------------------------------

function spawnNewChild(studio: string, title: string, barrier: string, brief = false): { child: ChildProcess; done: Promise<RunResult> } {
  const args = ["--import", tsxImport, mainPath, "new", "--kind", "task", "--collegium", "engineering", "--title", title];
  if (brief) args.push("--brief");
  args.push(studio);
  const token = title.replace(/[^a-z0-9]+/gi, "-");
  const stdoutPath = join(barrier, `${token}.stdout`);
  const stderrPath = join(barrier, `${token}.stderr`);
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env: { ...process.env, BISELLIUM_IDS_TEST_BARRIER_DIR: barrier },
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  const done = new Promise<RunResult>((resolveDone, reject) => {
    child.once("error", reject);
    child.once("close", (status) =>
      resolveDone({
        status,
        stdout: readFileSync(stdoutPath, "utf8"),
        stderr: readFileSync(stderrPath, "utf8"),
      }),
    );
  });
  return { child, done };
}

async function readyFiles(barrier: string, count: number, children: ChildProcess[]): Promise<string[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const files = readdirSync(barrier).filter((name) => name.endsWith(".ready"));
    if (files.length >= count) return files.sort();
    if (children.some((child) => child.exitCode !== null)) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  for (const child of children) child.kill("SIGKILL");
  throw new Error(`timed out waiting for ${count} ready files in ${barrier}`);
}

if (runs(5)) {
  const problems: string[] = [];
  const raceRoot = scratch("b5-race");
  const raceStudio = join(raceRoot, "studio");
  const raceBarrier = join(raceRoot, "barrier");
  writeManifest(raceStudio);
  mkdirSync(raceBarrier);
  const alpha = spawnNewChild(raceStudio, "alpha title", raceBarrier);
  const beta = spawnNewChild(raceStudio, "beta title", raceBarrier);
  const ready = await readyFiles(raceBarrier, 2, [alpha.child, beta.child]);
  const candidates = ready.map((name) => readFileSync(join(raceBarrier, name), "utf8"));
  check(5, "barrier observes both processes inside the same-candidate race window", new Set(candidates).size === 1, JSON.stringify(candidates));
  writeFileSync(join(raceBarrier, "release"), "go\n");
  const raced = await Promise.all([alpha.done, beta.done]);
  const ids = raced.map((result) => result.stdout.trim()).sort();
  const files = existsSync(join(raceStudio, "opera")) ? readdirSync(join(raceStudio, "opera")).filter((name) => /^W-\d+\.md$/.test(name)).sort() : [];
  const bodies = files.map((name) => readFileSync(join(raceStudio, "opera", name), "utf8")).join("\n");
  if (
    raced.some((result) => result.status !== 0) ||
    JSON.stringify(ids) !== JSON.stringify(["W-001", "W-002"]) ||
    JSON.stringify(files) !== JSON.stringify(["W-001.md", "W-002.md"]) ||
    !bodies.includes("alpha title") ||
    !bodies.includes("beta title")
  ) {
    problems.push(`race=${JSON.stringify({ raced, ids, files, bodies })}`);
  }

  const collisionRoot = scratch("b5-collision");
  const collisionStudio = join(collisionRoot, "studio");
  const collisionBarrier = join(collisionRoot, "barrier");
  writeManifest(collisionStudio);
  mkdirSync(collisionBarrier);
  const child = spawnNewChild(collisionStudio, "collision child", collisionBarrier);
  await readyFiles(collisionBarrier, 1, [child.child]);
  const sentinel = record(collisionStudio, "opera", "W-001", "pre-existing collision\n");
  writeFileSync(join(collisionBarrier, "release"), "go\n");
  const collided = await child.done;
  if (collided.status !== 0 || collided.stdout.trim() !== "W-002" || readFileSync(sentinel, "utf8") !== "pre-existing collision\n" || !existsSync(join(collisionStudio, "opera", "W-002.md"))) {
    problems.push(`direct collision=${JSON.stringify(collided)} sentinel=${JSON.stringify(readFileSync(sentinel, "utf8"))}`);
  }

  const floodRoot = scratch("b5-flood");
  const floodStudio = join(floodRoot, "studio");
  const floodBarrier = join(floodRoot, "barrier");
  writeManifest(floodStudio);
  mkdirSync(floodBarrier);
  const flood = spawnNewChild(floodStudio, "bounded collision flood", floodBarrier);
  await readyFiles(floodBarrier, 1, [flood.child]);
  for (let candidate = 1; candidate <= 101; candidate++) {
    record(floodStudio, "opera", `W-${String(candidate).padStart(3, "0")}`, "collision flood\n");
  }
  writeFileSync(join(floodBarrier, "release"), "go\n");
  const flooded = await flood.done;
  check(
    5,
    "allocator stops with a clear error after 100 consecutive EEXIST collisions",
    flooded.status === 1 &&
      flooded.stdout === "" &&
      /100.*collision|collision.*100|retry.*100/i.test(flooded.stderr) &&
      !existsSync(join(floodStudio, "opera", "W-102.md")),
    JSON.stringify(flooded),
  );
  check(5, "exclusive create gives two writers distinct files and retries a direct EEXIST", problems.length === 0, problems.join(" | "));
}

// ---------------------------------------------------------------------------
// Behaviour 6 — repository-relative officina, symlink and linked worktree.
// ---------------------------------------------------------------------------

function dualStudioRepo(tag: string): { root: string; studio: string; sample: string } {
  const root = scratch(tag);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "W-101 Test"]);
  git(root, ["config", "user.email", "w101@example.invalid"]);
  const studio = join(root, "studio");
  const sample = join(root, "examples", "sample-studio");
  writeManifest(studio);
  writeManifest(sample);
  record(studio, "opera", "W-001");
  record(sample, "opera", "W-007");
  commitAll(root, "two officinae");
  branchRecord(root, "examples/sample-studio", "sample-high", "opera", "W-012");
  branchRecord(root, "studio", "studio-high", "opera", "W-999");
  return { root, studio, sample };
}

async function fileBoth(sample: string, studio: string, cwd: string): Promise<{ sample: RunResult; studio: RunResult }> {
  return {
    sample: await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", "sample", sample], { cwd }),
    studio: await spawnCli(["new", "--kind", "task", "--collegium", "engineering", "--title", "real", studio], { cwd }),
  };
}

if (runs(6)) {
  const problems: string[] = [];
  const normal = dualStudioRepo("b6-normal");
  const unrelated = scratch("b6-unrelated");
  const normalResult = await fileBoth(normal.sample, normal.studio, unrelated);
  if (normalResult.sample.stdout.trim() !== "W-013" || normalResult.studio.stdout.trim() !== "W-1000") problems.push(`normal=${JSON.stringify(normalResult)}`);

  const symlinked = dualStudioRepo("b6-symlink");
  const aliasRoot = scratch("b6-alias");
  const sampleAlias = join(aliasRoot, "sample-alias");
  const studioAlias = join(aliasRoot, "studio-alias");
  symlinkSync(symlinked.sample, sampleAlias, "dir");
  symlinkSync(symlinked.studio, studioAlias, "dir");
  const aliasResult = await fileBoth(sampleAlias, studioAlias, unrelated);
  if (aliasResult.sample.stdout.trim() !== "W-013" || aliasResult.studio.stdout.trim() !== "W-1000") problems.push(`symlink=${JSON.stringify(aliasResult)}`);

  const recordLinkRoot = scratch("b6-record-directory-link");
  const recordLinkStudio = join(recordLinkRoot, "studio");
  const outsideRecords = join(recordLinkRoot, "outside-opera");
  writeManifest(recordLinkStudio);
  mkdirSync(outsideRecords);
  writeFileSync(join(outsideRecords, "W-500.md"), "outside sentinel\n");
  symlinkSync(outsideRecords, join(recordLinkStudio, "opera"), "dir");
  const recordLinkResult = await spawnCli(
    ["new", "--kind", "task", "--collegium", "engineering", "--title", "reject record link", recordLinkStudio],
  );
  check(
    6,
    "physical officina rejects a symlinked record directory without writing through it",
    recordLinkResult.status === 1 &&
      /real directory|symbolic link|symlink/i.test(recordLinkResult.stderr) &&
      !existsSync(join(outsideRecords, "W-501.md")),
    JSON.stringify(recordLinkResult),
  );

  const linked = dualStudioRepo("b6-linked");
  const linkedRoot = scratch("b6-linked-target");
  const worktree = join(linkedRoot, "worktree");
  git(linked.root, ["worktree", "add", "-b", "linked-fixture", worktree, "main"]);
  const linkedResult = await fileBoth(join(worktree, "examples", "sample-studio"), join(worktree, "studio"), unrelated);
  if (linkedResult.sample.stdout.trim() !== "W-013" || linkedResult.studio.stdout.trim() !== "W-1000") problems.push(`linked=${JSON.stringify(linkedResult)}`);
  check(6, "sample and real officinae stay isolated through aliases, linked worktrees and unrelated cwd", problems.length === 0, problems.join(" | "));
}

// ---------------------------------------------------------------------------
// Behaviour 7 — retro recurrence regression and --brief collision rollback.
// ---------------------------------------------------------------------------

if (runs(7)) {
  const problems: string[] = [];
  const root = scratch("b7-retro");
  const studio = join(root, "studio");
  writeManifest(studio);
  writeFileSync(join(studio, "evidence.log"), "evidence\n");
  for (const [index, cls] of ["alpha", "beta", "gamma"].entries()) {
    const id = `L-${String(index + 1).padStart(3, "0")}`;
    record(
      studio,
      "lessons",
      id,
      `---\nid: ${JSON.stringify(id)}\nat: 2026-09-01T00:00:00Z\nclass: ${JSON.stringify(cls)}\nevidence: ["evidence.log"]\ncascade: 1\n---\nold\n`,
    );
  }
  const historyBefore = ["L-001", "L-002", "L-003"].map((id) => readFileSync(join(studio, "lessons", `${id}.md`), "utf8"));
  const input: RetroInput = {
    verifierIssues: 0,
    reviewFindings: ["alpha", "beta", "gamma"].map((cls) => ({ class: cls, where: "fixture", evidence: ["evidence.log"] })),
    agents: [],
    tests: 1,
    fixRounds: 0,
    mutationsCaught: 0,
  };
  const retro = draftRetro(studio, 2, input, new Date("2026-10-01T00:00:00Z"));
  const lessonIds = retro.lessons.map(({ path }) => /L-\d+/.exec(path)?.[0]);
  const petitioIds = retro.petitiones.map((path) => /P-\d+/.exec(path)?.[0]);
  const recurrenceOnce = ["alpha", "beta", "gamma"].every((cls) => (retro.markdown.match(new RegExp(`"${cls}" recurs across cascades 1, 2`, "g")) ?? []).length === 1);
  const historyAfter = ["L-001", "L-002", "L-003"].map((id) => readFileSync(join(studio, "lessons", `${id}.md`), "utf8"));
  if (
    JSON.stringify(lessonIds) !== JSON.stringify(["L-004", "L-005", "L-006"]) ||
    JSON.stringify(petitioIds) !== JSON.stringify(["P-001", "P-002", "P-003"]) ||
    !recurrenceOnce ||
    JSON.stringify(historyAfter) !== JSON.stringify(historyBefore)
  ) {
    problems.push(`retro=${JSON.stringify({ lessonIds, petitioIds, recurrenceOnce, historyUnchanged: JSON.stringify(historyAfter) === JSON.stringify(historyBefore) })}`);
  }

  const collisionRoot = scratch("b7-brief");
  const collisionStudio = join(collisionRoot, "studio");
  const barrier = join(collisionRoot, "barrier");
  writeManifest(collisionStudio);
  mkdirSync(barrier);
  const child = spawnNewChild(collisionStudio, "must not overwrite brief", barrier, true);
  const ready = await readyFiles(barrier, 1, [child.child]);
  const id = readFileSync(join(barrier, ready[0]!), "utf8");
  const briefPath = join(collisionStudio, "briefs", `${id}.md`);
  mkdirSync(dirname(briefPath), { recursive: true });
  const originalBrief = "pre-existing companion brief\n";
  writeFileSync(briefPath, originalBrief);
  writeFileSync(join(barrier, "release"), "go\n");
  const result = await child.done;
  const opusPath = join(collisionStudio, "opera", `${id}.md`);
  if (result.status !== 1 || readFileSync(briefPath, "utf8") !== originalBrief || existsSync(opusPath)) {
    problems.push(`brief collision=${JSON.stringify(result)} brief=${JSON.stringify(readFileSync(briefPath, "utf8"))} opus=${existsSync(opusPath)}`);
  }
  check(7, "retro keeps consecutive recurrence semantics and --brief refuses/rolls back collision", problems.length === 0, problems.join(" | "));
}

process.exit(failed ? 1 : 0);
