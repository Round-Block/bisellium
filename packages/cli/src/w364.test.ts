/**
 * W-364 rows b1-b5 (studio/briefs/W-364.md): the main thread's heavy runs and record writes refused. node:test TAP,
 * selected by `--test-name-pattern='^W-364-b<n>\s'`. Row b1 spawns the CLI (`main.ts`) with and without a
 * `bisellium run` session; rows b2-b4 feed hook inputs to `runHookEvent(["guard", …])` and read its exit code and
 * stderr; row b5 runs `ci --opus` inside a session on a scratch repo whose steps and gates report the session variables they
 * see. Fixtures live under the OS tmp dir.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runHookEvent } from "./hooks.js";
import { initStudio } from "./init.js";
import { newItem } from "./new.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAIN = join(REPO, "packages/cli/src/main.ts");
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w364-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The guard on one hook input: its exit code and stderr. */
async function guard(input: unknown): Promise<{ code: number; err: string }> {
  const err: string[] = [];
  const keep = console.error;
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    return { code: r.exitCode, err: err.join("\n") };
  } finally {
    console.error = keep;
  }
}
const bash = (command: string, cwd: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
  cwd,
  ...extra,
});
const RUNNER = { agent_id: "a1b2c3", agent_type: "ladder-runner" };
const BUILDER = { agent_id: "b4d5e6", agent_type: "builder" };

/** The CLI run as a subprocess from the repository root with `env` (BISELLIUM_SESSION removed unless `env` sets it): exit code and stderr. */
function cli(args: string[], env: Record<string, string> = {}): { code: number; err: string } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base["BISELLIUM_SESSION"];
  const r = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...args], { cwd: REPO, env: { ...base, ...env }, encoding: "utf8", timeout: 120_000 });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, err: r.stderr };
}
const SESSION_REFUSAL = /runs only inside a bisellium run session \(W-364\)/;

test("W-364-b1 behaviour 1: verify and ci --opus refuse outside a bisellium run session, from any caller", () => {
  const dir = tmp();
  const studio = join(dir, "studio");
  initStudio(studio);
  const verify = cli(["verify", "W-999", "--studio", studio, "--repo", dir]);
  assert.equal(verify.code, 2, "outside a session: verify refused");
  assert.match(verify.err, SESSION_REFUSAL, "verify: the refusal names the session");
  assert.match(verify.err, /bisellium run --sella <seat> --no-worktree --studio studio -- npm run -s bisellium -- verify/, "verify: the refusal names the route");
  const ci = cli(["ci", "--opus", "W-999", "--studio", studio, "--repo", dir]);
  assert.equal(ci.code, 2, "outside a session: ci --opus refused");
  assert.match(ci.err, /`bisellium ci --opus` runs only inside a bisellium run session \(W-364\)/, "ci --opus: the refusal names it");
  assert.match(cli(["verify", "W-999", "--studio", studio], { BISELLIUM_SESSION: "" }).err, SESSION_REFUSAL, "an empty BISELLIUM_SESSION is no session");
  const usage = cli(["verify"]);
  assert.equal(usage.code, 2, "verify with no argument: its usage, exit 2");
  assert.doesNotMatch(usage.err, SESSION_REFUSAL, "verify with no argument keeps its usage line");
  const plain = cli(["ci", "--ref"]);
  assert.doesNotMatch(plain.err, SESSION_REFUSAL, "ci without --opus is not refused");
  const inSession = cli(["verify", "W-999", "--studio", studio, "--repo", dir], { BISELLIUM_SESSION: "s-1" });
  assert.doesNotMatch(inSession.err, SESSION_REFUSAL, "inside a session: verify runs");
  assert.match(inSession.err, /unknown opus: W-999/, "inside a session: verify runs and fails on the unknown opus");
  const ciInSession = cli(["ci", "--opus", "W-999", "--studio", studio, "--repo", dir, "--offline"], { BISELLIUM_SESSION: "s-1" });
  assert.doesNotMatch(ciInSession.err, SESSION_REFUSAL, "inside a session: ci --opus runs");
  assert.match(ciInSession.err, /unknown opus: W-999/, "inside a session: ci --opus runs and fails on the unknown opus");
  const throughRun = cli(["run", "--sella", "producer", "--no-worktree", "--studio", studio, "--", process.execPath, "--import", import.meta.resolve("tsx"), MAIN, "verify", "W-999", "--studio", studio, "--repo", dir]);
  assert.doesNotMatch(throughRun.err, SESSION_REFUSAL, "through bisellium run: verify runs in its session");
  assert.match(throughRun.err, /unknown opus: W-999/, "through bisellium run: verify runs and fails on the unknown opus");
  const runner = readFileSync(join(REPO, "scripts/run-builder-host.mjs"), "utf8");
  assert.match(
    runner,
    /const gateCell = producerCell\([\s\S]*?\);\n\s*\/\/ W-364[^\n]*\n\s*Object\.assign\(gateCell\.env, \{ BISELLIUM_SESSION: request\.sessionId \}\);\n\s*const gate = await launch\(/,
    "the host runner's gates run ci --opus inside its session",
  );
});

const HEAVY = /is a heavy run, run only by a dispatched agent \(W-364\)/;

test("W-364-b2 behaviour 2: the guard refuses the main thread's codex exec, verify and ci --opus runs, directly, through bisellium run or in a script", async () => {
  const dir = tmp();
  const script = join(dir, "census pass.sh");
  writeFileSync(script, "#!/bin/sh\nset -u\ncodex exec -m gpt-5.6-sol -s read-only - < /tmp/p.md\n");
  const refused: [string, string][] = [
    ["bisellium verify W-1 --studio studio --repo .", "verify"],
    ["npm run -s bisellium -- verify W-1 --studio studio --repo . > /tmp/v.log 2>&1; echo $? > /tmp/v.exit", "verify"],
    ["npm run -s bisellium -- ci --opus W-1 --studio studio --repo .", "ci --opus"],
    ["cd /tmp && timeout 3000 npx bisellium ci --opus W-1 --studio studio", "ci --opus"],
    ["codex exec -c model_provider=openai -m gpt-5.6-sol -s read-only --skip-git-repo-check -C . -o /tmp/o.md - < /tmp/p.md", "codex exec"],
    ["codex -c model_reasoning_effort=high exec 'review the diff'", "codex exec"],
    ["codex e 'list the tests'", "codex exec"],
    ["/usr/local/bin/codex exec x", "codex exec"],
    ["bash -c 'codex exec -s read-only x'", "codex exec"],
    [`bash '${script}' W-1`, "codex exec (in"],
    ["bisellium run --sella eng-lead --no-worktree --studio studio -- npm run -s bisellium -- ci --opus W-1 --studio studio --repo .", "ci --opus"],
    ["npm run -s bisellium -- run --sella producer --no-worktree --studio studio -- env FOO=1 bisellium verify W-1 --studio studio", "verify"],
    ["bisellium run --sella eng-lead -- codex exec x", "codex exec"],
  ];
  const first = await guard(bash(refused[0]![0], dir));
  assert.equal(first.code, 2, "main thread refused: bisellium verify W-1 --studio studio --repo .");
  assert.match(first.err, HEAVY, "the refusal names a heavy run and the dispatched agent");
  assert.match(first.err, /`verify`/, "the refusal names the step");
  assert.match(first.err, /bisellium run --sella <seat>/, "the refusal names the session route");
  for (const [c, step] of refused) {
    const r = await guard(bash(c, dir));
    assert.equal(r.code, 2, `main thread refused: ${c}`);
    assert.ok(r.err.includes(`\`${step}`), `the refusal names ${step}: ${c}`);
    for (const who of [RUNNER, BUILDER]) assert.equal((await guard(bash(c, dir, who))).code, 0, `a subagent runs it: ${c}`);
  }
  const allowed = [
    "bisellium ci",
    "npm run -s bisellium -- ci --offline",
    "codex --version",
    "codex login status",
    "echo codex exec",
    "git commit -m 'run codex exec and bisellium verify'",
    "grep -n verify packages/cli/src/main.ts",
    "bisellium run --sella builder --opus W-1 -- claude -p 'build it'",
    "cat > /tmp/p.md <<'EOF'\ncodex exec -m gpt-5.6-sol -s read-only -\nbisellium verify W-1 --studio studio\nnpm run -s bisellium -- ci --opus W-1\nEOF",
    "cat > /tmp/notes.md <<EOF\nLimits: popd\nthen scripts/x.sh runs codex exec\nEOF\necho done",
    "# codex exec in a comment\nls",
  ];
  assert.equal((await guard(bash(allowed[8]!, dir))).code, 0, "a heredoc's text is not read as a command");
  assert.equal((await guard(bash(allowed[9]!, dir))).code, 0, "the 11-03 heredoc runs");
  for (const c of allowed) assert.equal((await guard(bash(c, dir))).code, 0, `allowed: ${c}`);
  const afterDoc = await guard(bash("cat > /tmp/p.md <<'EOF'\nnothing here\nEOF\ncodex exec x", dir));
  assert.equal(afterDoc.code, 2, "a codex exec after a heredoc's terminator is judged");
});

/** A checkout under the OS tmp dir (`.git/HEAD`) with a linked worktree `.worktrees/W-1` (a `.git` file). */
function checkout(): string {
  const root = join(tmp(), "repo");
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/master\n");
  for (const d of ["studio/ci", "studio/opera", "studio/decisions", "studio/briefs", "docs/design/dossier", ".worktrees/W-1/studio/ci", ".worktrees/W-1/docs/design/dossier"])
    mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, ".worktrees/W-1/.git"), "gitdir: ../../.git/worktrees/W-1\n");
  return root;
}
const write = (path: string, cwd: string, extra: Record<string, unknown> = {}, tool = "Write") => ({
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: tool === "NotebookEdit" ? { notebook_path: path } : { file_path: path, content: "x" },
  cwd,
  ...extra,
});

test("W-364-b3 behaviour 3: the guard refuses the main thread's Write, Edit and NotebookEdit under docs/design/dossier/", async () => {
  const root = checkout();
  const dossier = [join(root, "docs/design/dossier/body.html"), join(root, "docs/design/dossier/new page.html"), join(root, ".worktrees/W-1/docs/design/dossier/head.html")];
  const first = await guard(write(dossier[0]!, root));
  assert.equal(first.code, 2, "main thread refused: docs/design/dossier/body.html");
  assert.match(first.err, /does not write the dossier \(docs\/design\/dossier\/body\.html\) \(W-364\): dispatch a subagent/, "the refusal names the dossier and the route");
  assert.equal((await guard(write(dossier[0]!, root, BUILDER))).code, 0, "a subagent writes the dossier");
  for (const p of dossier) {
    assert.equal((await guard(write(p, root))).code, 2, `main thread refused: ${p}`);
    assert.equal((await guard(write(p, root, BUILDER))).code, 0, `a subagent writes ${p}`);
  }
  assert.equal((await guard(write(dossier[0]!, root, {}, "Edit"))).code, 2, "Edit");
  assert.equal((await guard(write(join(root, "docs/design/dossier/x.ipynb"), root, {}, "NotebookEdit"))).code, 2, "NotebookEdit");
  assert.equal((await guard(write("docs/design/dossier/body.html", root))).code, 2, "a relative path against the input's cwd");
  for (const p of [join(root, "docs/design/notes.md"), join(root, "docs/ADOPTION.md"), join(root, "studio/briefs/W-1.md")])
    assert.equal((await guard(write(p, root))).code, 0, `main thread allowed: ${p}`);
});

const RECORD = /does not write `([^`]+)` by shell \(W-364\)/;

test("W-364-b4 behaviour 4: the guard refuses the main thread's shell writes into the records, the handoff and the dossier", async () => {
  const root = checkout();
  const script = join(root, "..", "write log.sh");
  writeFileSync(script, "#!/bin/sh\necho done > studio/ci/W-1-tests.log\n");
  const refused: [string, string][] = [
    ["echo x > studio/ci/W-1-tests.log", "studio/ci/W-1-tests.log"],
    ["npm test >studio/ci/W-1-tests.log 2>&1", "studio/ci/W-1-tests.log"],
    ["cat > studio/opera/W-1.md <<'EOF'\n---\nid: W-1\n---\nEOF", "studio/opera/W-1.md"],
    ["printf '%s\\n' x >> docs/SESSION-HANDOFF.md", "docs/SESSION-HANDOFF.md"],
    ["echo x 2>>studio/decisions/D-9.md", "studio/decisions/D-9.md"],
    ["make &> studio/ci/make.log", "studio/ci/make.log"],
    ["echo x 1> docs/design/dossier/body.html", "docs/design/dossier/body.html"],
    ["tee -a studio/decisions/D-9.md < /tmp/d.md", "studio/decisions/D-9.md"],
    ["cp /tmp/body.html docs/design/dossier/body.html", "docs/design/dossier/body.html"],
    ["mv /tmp/W-1.md studio/opera/", "studio/opera"],
    ["install -m 644 /tmp/x.log studio/ci/x.log", "studio/ci/x.log"],
    ["cp /tmp/x.log studio/ci/x.log > /tmp/cp.out", "studio/ci/x.log"],
    ["cp -t studio/ci /tmp/a.log /tmp/b.log", "studio/ci"],
    ["cp --target-directory=docs/design/dossier /tmp/a.html", "docs/design/dossier"],
    ["tee studio/ci/x.log < /tmp/in", "studio/ci/x.log"],
    ["tee /tmp/copy studio/ci/x.log <<< note", "studio/ci/x.log"],
    ["cp /tmp/a studio/ci/x.log < /tmp/in", "studio/ci/x.log"],
    ["sed -i 's/building/review/' studio/opera/W-1.md", "studio/opera/W-1.md"],
    ["sed -i.bak -e 's/a/b/' docs/SESSION-HANDOFF.md", "docs/SESSION-HANDOFF.md"],
    [`echo x > ${root}/studio/ci/abs.log`, "studio/ci/abs.log"],
    ["cd studio && echo x > ci/rel.log", "studio/ci/rel.log"],
    ["bash -c 'echo x > studio/ci/inner.log'", "studio/ci/inner.log"],
    [`sh '${script}'`, "studio/ci/W-1-tests.log"],
    ["echo x > .worktrees/W-1/studio/ci/W-1-lint.log", "studio/ci/W-1-lint.log"],
  ];
  const first = await guard(bash(refused[0]![0], root));
  assert.equal(first.code, 2, "main thread refused: echo x > studio/ci/W-1-tests.log");
  assert.match(first.err, RECORD, "the refusal names the path written");
  assert.match(first.err, /the bisellium verbs write studio\/ci\/ and studio\/opera\/, a dispatched clerk the decisions and the handoff, a dispatched agent the dossier/, "the refusal names who writes each");
  for (const [c, rel] of refused) {
    const r = await guard(bash(c, root));
    assert.equal(r.code, 2, `main thread refused: ${c}`);
    assert.equal(RECORD.exec(r.err)?.[1]?.replace(/ \(in .*$/, ""), rel, `the refusal names ${rel}: ${c}`);
    assert.equal((await guard(bash(c, root, BUILDER))).code, 0, `a subagent's shell write is not judged: ${c}`);
  }
  const allowed = [
    "cat studio/opera/W-1.md",
    "grep -h tree: studio/ci/*.log > /tmp/out.txt",
    "echo x > studio/briefs/W-1.md",
    "cp studio/ci/W-1-tests.log /tmp/",
    "tee /tmp/copy < studio/ci/W-1-tests.log",
    "tee /tmp/copy <studio/ci/W-1-tests.log",
    "tee /tmp/copy <<< studio/ci/W-1-tests.log",
    "tee /tmp/copy 0< studio/ci/W-1-tests.log",
    "cp /tmp/a /tmp/b < studio/ci/W-1-tests.log",
    "install -m 644 /tmp/a /tmp/b < studio/ci/x.log",
    "sed -i s/a/b/ /tmp/f < studio/ci/W-1-tests.log",
    "sed -n 1,5p studio/opera/W-1.md",
    "sed 's/a/b/' studio/opera/W-1.md > /tmp/o.md",
    "cat > /tmp/note.md <<'EOF'\necho x > studio/ci/W-1-tests.log\nEOF",
    'echo "a > studio/ci/x.log"',
    "echo x >&2",
    "npm test 2>&1 | tail -5",
    "echo x > $EV/studio/ci/x.log",
    `echo x > ${join(tmp(), "studio/ci/x.log")}`,
    "npm run -s bisellium -- handoff --opus W-1 --sella producer --next n --studio studio",
  ];
  for (const c of allowed) assert.equal((await guard(bash(c, root))).code, 0, `allowed: ${c}`);
});

/** A scratch git repo whose CI steps (package.json scripts) and verify gates each run `probe.mjs <name>`, which appends the
 *  name and the run-session variables it sees (`-` for none) to `env.log`. */
function probeRepo(): string {
  const repo = tmp();
  writeFileSync(
    join(repo, "probe.mjs"),
    'import { appendFileSync } from "node:fs";\nconst seen = ["BISELLIUM_SELLA", "BISELLIUM_STUDIO", "BISELLIUM_SESSION"].filter((k) => process.env[k] !== undefined);\nappendFileSync("env.log", `${process.argv[2]} ${seen.join(",") || "-"}\\n`);\n',
  );
  writeFileSync(join(repo, ".gitignore"), "env.log\n");
  const scripts = Object.fromEntries(["audit", "typecheck", "lint", "format:check", "test", "check"].map((s) => [s, `node probe.mjs ${s}`]));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "w364-probe", private: true, scripts }, null, 2));
  for (const args of [["init", "-q", "-b", "master"], ["config", "user.email", "t@t"], ["config", "user.name", "t"], ["add", "-A"], ["commit", "-q", "-m", "fixture"]]) {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: 30_000 });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return repo;
}

test("W-364-b5 behaviour 5: a heavy run admitted inside a session runs its steps and gates outside it", () => {
  const repo = probeRepo();
  const studio = join(tmp(), "studio");
  initStudio(studio);
  const manifest = join(studio, "bisellium.yml");
  const marker = "probationes:\n  - { id: patron, name: Patron call, kind: human }\n";
  const text = readFileSync(manifest, "utf8");
  if (!text.includes(marker)) throw new Error(`initStudio's manifest template changed:\n${text}`);
  const gates = ["tests, name: Tests, kind: automated, command: \"npm test -s\"", "lint, name: Lint, kind: automated, command: \"npm run -s lint\"", "types, name: Typecheck, kind: automated, command: \"npm run -s typecheck\""];
  writeFileSync(manifest, text.replace(marker, `${marker}${gates.map((g) => `  - { id: ${g} }\n`).join("")}`));
  const created = newItem(studio, { kind: "task", collegium: "production", title: "w364 b5" });
  if (!created.ok || !created.id) throw new Error(`newItem failed: ${created.message}`);
  const session = { BISELLIUM_SESSION: "s-5", BISELLIUM_SELLA: "producer", BISELLIUM_STUDIO: "studio" };
  const ci = cli(["ci", "--opus", created.id, "--studio", studio, "--repo", repo], session);
  assert.equal(ci.code, 0, "inside a session: ci --opus runs its steps and gates");
  const lines = readFileSync(join(repo, "env.log"), "utf8").trim().split("\n");
  for (const name of ["audit", "check", "test", "lint", "typecheck"]) assert.ok(lines.some((l) => l.split(" ")[0] === name), `${name} ran`);
  assert.deepEqual(lines.filter((l) => !l.endsWith(" -")), [], "a heavy run's steps and gates start outside the session");
});
