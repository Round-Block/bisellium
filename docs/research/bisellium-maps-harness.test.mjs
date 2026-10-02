import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  resetGitRunnerForTests,
  runExperiment,
  setGitRunnerForTests,
} from "./bisellium-maps-harness.mjs";

const execFileAsync = promisify(execFile);
const harness = new URL("./bisellium-maps-harness.mjs", import.meta.url).pathname;
const DEFAULTS = {
  directories: 128,
  files: 512,
  opens: 128,
  bytes: 8 * 1024 * 1024,
  fileBytes: 256 * 1024,
  excerptFiles: 16,
  excerptCharacters: 16_384,
};
const GIT_PREFIX = [
  "--no-optional-locks",
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.untrackedCache=false",
];

const sha256 = value => createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);

async function sandbox(t) {
  const base = await mkdtemp(path.join(tmpdir(), "w103-harness-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

async function put(root, relative, contents) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

function oneCase(overrides = {}) {
  return {
    id: "TASK-1",
    project: "alpha",
    question: "Where is the needle defined?",
    references: [],
    ...overrides,
  };
}

function dataset(...cases) {
  return { cases: cases.length ? cases : [oneCase()] };
}

function binding(projects, routes = [], exclusions = []) {
  return { projects, routes, exclusions };
}

function repository(id, root, corpusFiles) {
  return { id, root, corpusFiles };
}

function installGitMock(t, responder = async call => {
  if (call.args.at(-3) === "rev-parse") return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
  if (call.args.includes("symbolic-ref")) return { stdout: "main\n", stderr: "" };
  return { stdout: "", stderr: "" };
}) {
  const calls = [];
  setGitRunnerForTests(async call => {
    calls.push(structuredClone(call));
    return responder(call, calls.length);
  });
  t.after(resetGitRunnerForTests);
  return calls;
}

function resultRepository(output, caseIndex, repositoryId) {
  return output.results[caseIndex].repositories.find(item => item.repository === repositoryId);
}

async function cli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harness, ...args], options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

test("behaviour 1 scoped identity and retrieval", async t => {
  await t.test("retains same task ID in different projects and binding-supplied repository IDs, including root aliases", async t => {
    const base = await sandbox(t);
    const alpha = path.join(base, "alpha");
    const beta = path.join(base, "beta");
    const alphaAlias = path.join(base, "alpha-alias");
    await put(alpha, "source.md", "needle alpha\n");
    await put(beta, "source.md", "needle beta\n");
    await symlink(alpha, alphaAlias, "dir");
    const input = dataset(
      oneCase({ project: "alpha" }),
      oneCase({ project: "beta" }),
    );
    const bindings = binding({
      alpha: { repositories: [repository("z-real", alpha, ["source.md"]), repository("a-alias", alphaAlias, ["source.md"])] },
      beta: { repositories: [repository("z-real", beta, ["source.md"])] },
    });

    const output = await runExperiment(input, bindings, "search");
    assert.deepEqual(
      output.results.map(item => [item.id, item.project, item.repositories.map(repo => repo.repository)]),
      [["TASK-1", "alpha", ["a-alias", "z-real"]], ["TASK-1", "beta", ["z-real"]]],
      "project scoping and supplied repository IDs must survive duplicate task IDs and canonical-root aliases",
    );
  });

  await t.test("searches every project repository in code-unit order and merges adjacent line hits", async t => {
    const base = await sandbox(t);
    const a = path.join(base, "a");
    const z = path.join(base, "z");
    await put(a, "z.md", "none\nneedle first\nNEEDLE adjacent\nnone\n");
    await put(a, "A.md", "needle uppercase path\n");
    await put(z, "other.ts", "export const needle = true;\n");
    const bindings = binding({ alpha: { repositories: [repository("z", z, ["other.ts"]), repository("a", a, ["z.md", "A.md"])] } });

    const output = await runExperiment(dataset(), bindings, "search");
    assert.deepEqual(output.results[0].repositories.map(repo => repo.repository), ["a", "z"]);
    assert.deepEqual(resultRepository(output, 0, "a").files.map(file => [file.path, file.ranges]), [
      ["A.md", [[1, 1]]],
      ["z.md", [[2, 3]]],
    ]);
  });

  await t.test("tokenizes unique lowercase ASCII alphanumerics of length three or more", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "tokens.txt", "xx only\nABC123 hit\nneedle hit\n");
    const input = dataset(oneCase({ question: "xx ABC123 abc123 NEEDLE needle" }));
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["tokens.txt"])] } });
    const output = await runExperiment(input, bindings, "search");
    assert.deepEqual(output.results[0].repositories[0].files.map(file => file.ranges), [[[2, 3]]]);
  });

  await t.test("route reads only explicitly mapped current files and never falls back to search", async t => {
    const base = await sandbox(t);
    const first = path.join(base, "first");
    const second = path.join(base, "second");
    await put(first, "r.md", "current route source\n");
    await put(second, "search.md", "needle must not become a route fallback\n");
    const input = dataset(oneCase({ references: [{ path: "r.md", start: 1, end: 1, excerpt: "captured poison", fileSha256: "00" }] }));
    const bindings = binding(
      { alpha: { repositories: [repository("first", first, ["r.md"]), repository("second", second, ["search.md"])] } },
      [{ project: "alpha", case: "TASK-1", reference: 0, repository: "first" }],
    );
    const output = await runExperiment(input, bindings, "route");
    assert.deepEqual(resultRepository(output, 0, "first").files.map(file => file.path), ["r.md"]);
    assert.deepEqual(resultRepository(output, 0, "second").files, []);
    assert.deepEqual(resultRepository(output, 0, "first").files.map(file => file.excerpts), [["current route source"]]);
  });

  await t.test("rejects missing, duplicate, cross-project, non-integer, and out-of-range route bindings up front", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "r.md", "route\n");
    const input = dataset(oneCase({ references: [{ path: "r.md" }] }));
    const projects = { alpha: { repositories: [repository("repo", root, ["r.md"])] } };
    const valid = { project: "alpha", case: "TASK-1", reference: 0, repository: "repo" };
    await assert.rejects(runExperiment(input, binding(projects, []), "route"), /unmapped.*TASK-1.*0/i);
    await assert.rejects(runExperiment(input, binding(projects, [valid, valid]), "route"), /duplicate|ambiguous/i);
    await assert.rejects(runExperiment(input, binding(projects, [{ ...valid, repository: "missing" }]), "route"), /unmapped.*repository|missing/i);
    await assert.rejects(runExperiment(input, binding(projects, [{ ...valid, project: "other" }]), "route"), /unmapped|project/i);
    await assert.rejects(runExperiment(input, binding(projects, [{ ...valid, reference: "0" }]), "route"), /reference.*integer|invalid.*reference/i);
    await assert.rejects(runExperiment(input, binding(projects, [{ ...valid, reference: 1 }]), "route"), /reference|unmapped/i);
  });

  await t.test("enforces structural maxima and executes exactly fifteen cases in both modes", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "r.md", "needle\n");
    const cases = Array.from({ length: 15 }, (_, index) => oneCase({ id: `C${index}`, references: [{ path: "r.md", start: 1, end: 1 }] }));
    const projects = { alpha: { repositories: [repository("repo", root, ["r.md"])] } };
    const routes = cases.map((item, reference) => ({ project: "alpha", case: item.id, reference: 0, repository: "repo" }));
    const search = await runExperiment(dataset(...cases), binding(projects, routes), "search");
    const route = await runExperiment(dataset(...cases), binding(projects, routes), "route");
    assert.equal(search.results.length, 15);
    assert.equal(route.results.length, 15);
    await assert.rejects(runExperiment(dataset(...cases, oneCase({ id: "C15" })), binding(projects), "search"), /15.*cases|cases.*15/i);
    const references = Array.from({ length: 129 }, () => ({ path: "r.md" }));
    await assert.rejects(runExperiment(dataset(oneCase({ references })), binding(projects), "route"), /128.*references|references.*128/i);
    const tooManyProjects = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, { repositories: [] }]));
    await assert.rejects(runExperiment(dataset(), binding(tooManyProjects), "search"), /16.*projects|projects.*16/i);
    const tooManyRepositories = Array.from({ length: 9 }, (_, index) => repository(`r${index}`, root, []));
    await assert.rejects(runExperiment(dataset(), binding({ alpha: { repositories: tooManyRepositories } }), "search"), /8.*repositories|repositories.*8/i);
    await assert.rejects(runExperiment(dataset(), binding({ alpha: { repositories: [repository("repo", root, Array(513).fill("r.md"))] } }), "search"), /512.*corpus|corpus.*512/i);
    await assert.rejects(runExperiment(dataset(), binding({ alpha: { repositories: [repository("same", root, []), repository("same", root, [])] } }), "search"), /duplicate.*repository|repository.*unique/i);
    await assert.rejects(runExperiment(dataset(), binding({ alpha: { repositories: [{ id: "repo", root: 42, corpusFiles: [] }] } }), "search"), /root|string|repository/i);
    await assert.rejects(runExperiment(dataset(), binding({ alpha: { repositories: [{ id: "repo", root, corpusFiles: "r.md" }] } }), "search"), /corpus|array|repository/i);
    await assert.rejects(runExperiment(dataset(), binding(projects), "other"), /mode|search|route/i);
  });
});

test("behaviour 2 honest degradation", async t => {
  await t.test("keeps two healthy repositories usable while reporting a missing repository", async t => {
    const base = await sandbox(t);
    const one = path.join(base, "one");
    const two = path.join(base, "two");
    await put(one, "one.md", "needle one\n");
    await put(two, "two.md", "needle two\n");
    const bindings = binding({ alpha: { repositories: [
      repository("one", one, ["one.md"]),
      repository("missing", path.join(base, "missing"), ["lost.md"]),
      repository("two", two, ["two.md"]),
    ] } });
    const output = await runExperiment(dataset(), bindings, "search");
    assert.deepEqual(
      output.results[0].repositories.map(repo => [repo.repository, repo.coverage, repo.files.length]),
      [["missing", "unavailable", 0], ["one", "complete", 1], ["two", "complete", 1]],
      "a missing repository must be explicit without suppressing either healthy repository",
    );
  });

  await t.test("reports missing route files, non-Git roots, and unsupported bindings explicitly", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "plain");
    await mkdir(root);
    const input = dataset(oneCase({ references: [{ path: "moved.md", start: 1 }] }));
    const bindings = binding(
      { alpha: { repositories: [repository("plain", root, [])] } },
      [{ project: "alpha", case: "TASK-1", reference: 0, repository: "plain" }],
    );
    const output = await runExperiment(input, bindings, "route");
    const repo = output.results[0].repositories[0];
    assert.ok(repo.failures.some(failure => failure.path === "moved.md" && /unavailable|missing|ENOENT/i.test(failure.reason)));
    assert.deepEqual({ head: repo.identity.head, branch: repo.identity.branch, dirty: repo.identity.dirty }, { head: "unknown", branch: "unknown", dirty: "unknown" });
    await assert.rejects(runExperiment(dataset(), { projects: { alpha: {} } }, "search"), /unsupported|repositories/i);
    await assert.rejects(runExperiment(dataset(oneCase({ project: "absent" })), bindings, "search"), /unsupported project|absent/i);
  });

  await t.test("uses only the Git allowlist, literal selected paths, scrubbed environment, timeout, and independent output caps", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "dash-[x].md", "needle\n");
    process.env.GIT_DIR = "/poison";
    process.env.GIT_SSH_COMMAND = "poison";
    t.after(() => { delete process.env.GIT_DIR; delete process.env.GIT_SSH_COMMAND; });
    const calls = installGitMock(t);
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["dash-[x].md"])] } });
    const output = await runExperiment(dataset(), bindings, "search");
    const repo = output.results[0].repositories[0];
    assert.equal(repo.identity.gitCalls, 3, "the counter must equal the three calls actually attempted");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(call => call.args), [
      [...GIT_PREFIX, "rev-parse", "--verify", "HEAD"],
      [...GIT_PREFIX, "symbolic-ref", "--short", "-q", "HEAD"],
      [...GIT_PREFIX, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=all", "--", ":(literal)dash-[x].md"],
    ]);
    for (const call of calls) {
      assert.equal(call.command, "git");
      assert.equal(call.cwd, root);
      assert.equal(call.timeout, 2_000);
      assert.equal(call.stdoutLimit, 64 * 1024);
      assert.equal(call.stderrLimit, 16 * 1024);
      assert.equal(call.env.GIT_OPTIONAL_LOCKS, "0");
      assert.equal(call.env.GIT_TERMINAL_PROMPT, "0");
      assert.equal(call.env.GIT_CONFIG_NOSYSTEM, "1");
      assert.equal(call.env.GIT_CONFIG_GLOBAL, "/dev/null");
      assert.equal(Object.hasOwn(call.env, "GIT_DIR"), false);
      assert.equal(Object.hasOwn(call.env, "GIT_SSH_COMMAND"), false);
    }
  });

  await t.test("counts actual attempted calls, omits empty status, and never tries fallback Git commands", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "plain.md", "nothing relevant\n");
    const calls = installGitMock(t, async (_call, number) => {
      if (number === 1) throw Object.assign(new Error("not a repository"), { code: 128 });
      throw new Error("a fallback call was attempted");
    });
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["plain.md"])] } });
    const output = await runExperiment(dataset(), bindings, "search");
    assert.equal(output.results[0].repositories[0].identity.gitCalls, 1);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes("rev-parse"));

    resetGitRunnerForTests();
    const noSelectionCalls = installGitMock(t);
    const noSelection = await runExperiment(dataset(), bindings, "search");
    assert.equal(noSelection.results[0].repositories[0].identity.gitCalls, 2);
    assert.equal(noSelectionCalls.some(call => call.args.includes("status")), false);
  });

  await t.test("discards partial identity independently on timeout, stdout overflow, and stderr overflow", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "source.md", "needle\n");
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["source.md"])] } });
    for (const failure of ["timeout", "stdout-limit", "stderr-limit"]) {
      resetGitRunnerForTests();
      let attempts = 0;
      setGitRunnerForTests(async () => {
        attempts++;
        throw Object.assign(new Error(failure), { code: failure });
      });
      const output = await runExperiment(dataset(), bindings, "search");
      const identity = output.results[0].repositories[0].identity;
      assert.deepEqual([failure, identity.head, identity.branch, identity.dirty, identity.gitCalls, attempts], [failure, "unknown", "unknown", "unknown", 1, 1]);
    }
    resetGitRunnerForTests();
  });
});

test("behaviour 3 freshness and provenance", async t => {
  await t.test("an actual edit changes the observed hash, mismatches the capture, and is dirty while HEAD stays fixed", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await mkdir(root);
    const original = "export const value = 'old';\n";
    const edited = "export const value = 'fresh';\n";
    await put(root, "source.ts", original);
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "w103@example.invalid"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "W103 Fixture"], { cwd: root });
    await execFileAsync("git", ["add", "source.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
    const headBefore = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await writeFile(path.join(root, "source.ts"), edited);
    const input = dataset(oneCase({ references: [{ path: "source.ts", start: 1, end: 1, fileSha256: sha256(original), excerpt: original.trim() }] }));
    const bindings = binding(
      { alpha: { repositories: [repository("repo", root, ["source.ts"])] } },
      [{ project: "alpha", case: "TASK-1", reference: 0, repository: "repo" }],
    );

    const output = await runExperiment(input, bindings, "route");
    const files = output.results[0].repositories.flatMap(repo => repo.files);
    assert.deepEqual(
      files.map(file => [file.path, file.sha256, file.capturedHashMatches]),
      [["source.ts", sha256(edited), false]],
      "route provenance must hash the edited bytes rather than describe them with captured data or HEAD",
    );
    const identity = output.results[0].repositories[0].identity;
    assert.equal(identity.head, headBefore);
    assert.equal(identity.dirty, true);
    assert.equal(identity.dirtyScope, "selected-paths");
    assert.equal(files[0].excerpts[0], edited.trim());
  });

  await t.test("hashes each fully read source once and does not call an oversized file complete", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "exact.txt", "needle");
    await put(root, "large.txt", "needle too large");
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["exact.txt", "large.txt"])] } });
    const output = await runExperiment(dataset(), bindings, "search", { fileBytes: 6 });
    const repo = output.results[0].repositories[0];
    assert.deepEqual(repo.files.map(file => [file.path, file.sha256]), [["exact.txt", sha256("needle")]]);
    assert.ok(repo.failures.some(failure => failure.path === "large.txt" && /oversized/i.test(failure.reason)));
    assert.equal(repo.metrics.opens, 1);
    assert.equal(repo.metrics.bytes, 6);
  });
});

test("behaviour 4 containment and budgets", async t => {
  await t.test("actually reaches and rejects a final symlink escape after an earlier candidate", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    const outside = path.join(base, "outside.md");
    await put(root, "a.md", "needle safe\n");
    await writeFile(outside, "needle escaped\n");
    await symlink(outside, path.join(root, "z-escape.md"));
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["a.md", "z-escape.md"])] } });
    const output = await runExperiment(dataset(), bindings, "search");
    const repo = output.results[0].repositories[0];
    assert.ok(
      repo.failures.some(failure => failure.path === "z-escape.md" && /symlink.*escape|outside.*root|contain/i.test(failure.reason)),
      "the escaping symlink itself must be examined and rejected, not masked by an earlier file budget stop",
    );
    assert.deepEqual(repo.files.map(file => file.path), ["a.md"]);
    assert.equal(repo.metrics.candidates, 2);
  });

  await t.test("rejects intermediate parent escapes, dangling links, absolute/traversal/dot/backslash paths, and excessive path shapes", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    const outside = path.join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await put(outside, "secret.md", "needle\n");
    await symlink(outside, path.join(root, "linked"), "dir");
    await symlink(path.join(base, "absent.md"), path.join(root, "dangling.md"));
    const badPaths = ["linked/secret.md", "dangling.md", "../outside/secret.md", "/etc/passwd", "C:/oracle.md", "a\\b.md", "./dot.md", "a//b.md", ""];
    const longPath = `${"a".repeat(1020)}.md`;
    const deepPath = `${Array(33).fill("d").join("/")}.md`;
    const bindings = binding({ alpha: { repositories: [repository("repo", root, [...badPaths, longPath, deepPath])] } });
    const output = await runExperiment(dataset(), bindings, "search");
    const failures = output.results[0].repositories[0].failures;
    assert.ok(failures.some(failure => failure.path === "linked/secret.md" && /parent.*escape|contain/i.test(failure.reason)));
    for (const badPath of badPaths.slice(1)) assert.ok(failures.some(failure => failure.path === badPath), `missing rejection for ${JSON.stringify(badPath)}`);
    assert.ok(failures.some(failure => failure.path === longPath));
    assert.ok(failures.some(failure => failure.path === deepPath));
  });

  await t.test("applies inventory and component exclusions to lexical and canonical paths, including in-root aliases", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "research/oracle.md", "unique-poison-token\n");
    await put(root, "tests/fixture.md", "unique-poison-token\n");
    await put(root, "unit.test.ts", "unique-poison-token\n");
    await put(root, "generated.md", "unique-poison-token\n");
    await put(root, "safe.md", "safe content\n");
    await symlink(path.join(root, "research/oracle.md"), path.join(root, "oracle-alias.md"));
    const input = dataset(oneCase({ question: "unique poison token" }));
    const corpus = ["research/oracle.md", "tests/fixture.md", "unit.test.ts", "generated.md", "oracle-alias.md", "safe.md"];
    const bindings = binding({ alpha: { repositories: [repository("repo", root, corpus)] } }, [], ["generated.md", "research/oracle.md"]);
    const output = await runExperiment(input, bindings, "search");
    const repo = output.results[0].repositories[0];
    assert.deepEqual(repo.files, [], "excluded oracle bytes must not re-enter through a canonical-path alias");
    assert.ok(repo.failures.some(failure => failure.path === "oracle-alias.md" && /canonical.*excl|excluded.*target|alias/i.test(failure.reason)));
    assert.equal(repo.metrics.rejections, 5);
  });

  await t.test("uses only manifest candidates and rejects unsupported extension, binary, invalid UTF-8, NUL, and non-regular inputs", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "listed.md", "needle listed\n");
    await put(root, "hidden.md", "needle hidden must not be enumerated\n");
    await put(root, "image.png", Buffer.from([1, 2, 3]));
    await put(root, "invalid.txt", Buffer.from([0xc3, 0x28]));
    await put(root, "nul.txt", Buffer.from("needle\0bad"));
    await mkdir(path.join(root, "directory.md"));
    const corpus = ["listed.md", "image.png", "invalid.txt", "nul.txt", "directory.md"];
    const bindings = binding({ alpha: { repositories: [repository("repo", root, corpus)] } });
    const output = await runExperiment(dataset(), bindings, "search");
    const repo = output.results[0].repositories[0];
    assert.deepEqual(repo.files.map(file => file.path), ["listed.md"]);
    assert.equal(repo.files.some(file => file.path === "hidden.md"), false);
    for (const target of ["image.png", "invalid.txt", "nul.txt", "directory.md"]) assert.ok(repo.failures.some(failure => failure.path === target));
  });

  await t.test("lets route read an explicitly mapped research reference without admitting it to search", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "research/curated.md", "needle curated route\n");
    const input = dataset(oneCase({ references: [{ path: "research/curated.md", start: 1, end: 1 }] }));
    const bindings = binding(
      { alpha: { repositories: [repository("repo", root, ["research/curated.md"])] } },
      [{ project: "alpha", case: "TASK-1", reference: 0, repository: "repo" }],
    );
    const search = await runExperiment(input, bindings, "search");
    const route = await runExperiment(input, bindings, "route");
    assert.deepEqual(search.results[0].repositories[0].files, []);
    assert.deepEqual(route.results[0].repositories[0].files.map(file => file.path), ["research/curated.md"]);
  });

  await t.test("enforces every scan budget independently and validates lower bounds and hard maxima before source access", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "absent-root");
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["nested/one.md", "two.md"])] } });
    const maxima = { directories: 128, files: 512, opens: 128, bytes: 8 * 1024 * 1024, fileBytes: 256 * 1024 };
    for (const [name, maximum] of Object.entries(maxima)) {
      await assert.rejects(runExperiment(dataset(), bindings, "search", { [name]: -1 }), new RegExp(`invalid budget ${name}`, "i"));
      await assert.rejects(runExperiment(dataset(), bindings, "search", { [name]: maximum + 1 }), new RegExp(`invalid budget ${name}`, "i"));
      await assert.rejects(runExperiment(dataset(), bindings, "search", { [name]: 1.5 }), new RegExp(`invalid budget ${name}`, "i"));
    }

    const live = path.join(base, "live");
    await put(live, "nested/one.md", "needle one\n");
    await put(live, "two.md", "needle two\n");
    const liveBinding = binding({ alpha: { repositories: [repository("repo", live, ["nested/one.md", "two.md"])] } });
    const probes = [
      ["directories", { directories: 1 }],
      ["files", { files: 1 }],
      ["opens", { opens: 1 }],
      ["bytes", { bytes: Buffer.byteLength("needle one\n") }],
    ];
    for (const [limit, budgets] of probes) {
      const output = await runExperiment(dataset(), liveBinding, "search", budgets);
      const repo = output.results[0].repositories[0];
      assert.equal(repo.coverage, "incomplete", `${limit} exhaustion must disclose incomplete coverage`);
      assert.equal(repo.limit, limit);
      assert.ok(repo.metrics[limit === "files" ? "candidates" : limit] <= budgets[limit]);
    }

    const exact = await runExperiment(dataset(), liveBinding, "search", { directories: 2, files: 2, opens: 2, bytes: 22, fileBytes: 11 });
    assert.equal(exact.results[0].repositories[0].coverage, "complete");
    assert.equal(exact.results[0].repositories[0].files.length, 2);

    const second = path.join(base, "second");
    await put(second, "three.md", "needle three\n");
    const independent = binding({ alpha: { repositories: [repository("one", live, ["two.md"]), repository("two", second, ["three.md"])] } });
    const perRepository = await runExperiment(dataset(), independent, "search", { files: 1, opens: 1 });
    assert.deepEqual(perRepository.results[0].repositories.map(repo => [repo.metrics.candidates, repo.metrics.opens]), [[1, 1], [1, 1]]);
  });

  await t.test("skips oversized files by metadata and counts candidates, failed attempts, opens, and bytes honestly", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "a-large.md", "needle-large");
    await put(root, "b-small.md", "needle");
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["a-large.md", "b-small.md", "missing.md"])] } });
    const output = await runExperiment(dataset(), bindings, "search", { fileBytes: 6 });
    const repo = output.results[0].repositories[0];
    assert.deepEqual(repo.files.map(file => file.path), ["b-small.md"]);
    assert.deepEqual({ candidates: repo.metrics.candidates, opens: repo.metrics.opens, bytes: repo.metrics.bytes }, { candidates: 3, opens: 1, bytes: 6 });
    assert.ok(repo.failures.some(failure => failure.path === "a-large.md" && /oversized/i.test(failure.reason)));
    assert.ok(repo.failures.some(failure => failure.path === "missing.md"));
  });

  await t.test("enforces excerpt-file and character budgets separately while continuing the full scan", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "a.md", "needle-aaaa\n");
    await put(root, "b.md", "needle-bbbb\n");
    await put(root, "c.md", "needle-cccc\n");
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["c.md", "a.md", "b.md"])] } });
    for (const [name, maximum] of [["excerptFiles", 16], ["excerptCharacters", 16_384]]) {
      await assert.rejects(runExperiment(dataset(), bindings, "search", { [name]: -1 }), new RegExp(`invalid budget ${name}`, "i"));
      await assert.rejects(runExperiment(dataset(), bindings, "search", { [name]: maximum + 1 }), new RegExp(`invalid budget ${name}`, "i"));
      await assert.rejects(runExperiment(dataset(), bindings, "search", { [name]: 0.5 }), new RegExp(`invalid budget ${name}`, "i"));
    }
    const output = await runExperiment(dataset(), bindings, "search", { excerptFiles: 1, excerptCharacters: 7 });
    const repo = output.results[0].repositories[0];
    assert.equal(repo.coverage, "complete");
    assert.equal(repo.metrics.candidates, 3, "output truncation must not stop scan work");
    assert.equal(repo.metrics.opens, 3);
    assert.deepEqual(repo.files.map(file => file.path), ["a.md", "b.md", "c.md"]);
    assert.equal(repo.files.flatMap(file => file.excerpts).join("").length, 7);
    assert.ok(repo.metrics.omittedExcerpts >= 2);
  });

  await t.test("caps failure samples at 32 while preserving the aggregate rejection count", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await mkdir(root);
    const missing = Array.from({ length: 40 }, (_, index) => `missing-${String(index).padStart(2, "0")}.md`);
    const bindings = binding({ alpha: { repositories: [repository("repo", root, missing)] } });
    const output = await runExperiment(dataset(), bindings, "search");
    const repo = output.results[0].repositories[0];
    assert.equal(repo.metrics.rejections, 40);
    assert.equal(repo.failures.length, 32);
    assert.deepEqual(repo.failures.map(failure => failure.path), missing.slice(0, 32));
  });

  await t.test("caps each CLI JSON input at one MiB before parsing", async t => {
    const base = await sandbox(t);
    const validDataset = path.join(base, "dataset.json");
    const validBinding = path.join(base, "binding.json");
    const hugeDataset = path.join(base, "huge-dataset.json");
    const hugeBinding = path.join(base, "huge-binding.json");
    await writeFile(validDataset, JSON.stringify(dataset()));
    await writeFile(validBinding, JSON.stringify(binding({ alpha: { repositories: [] } })));
    await writeFile(hugeDataset, "x".repeat(1024 * 1024 + 1));
    await writeFile(hugeBinding, "x".repeat(1024 * 1024 + 1));
    const datasetResult = await cli([`--dataset=${hugeDataset}`, `--binding=${validBinding}`, "--mode=search"]);
    assert.notEqual(datasetResult.code, 0);
    assert.match(datasetResult.stderr, /dataset|JSON input.*1 MiB|1 MiB.*dataset/i);
    const bindingResult = await cli([`--dataset=${validDataset}`, `--binding=${hugeBinding}`, "--mode=search"]);
    assert.notEqual(bindingResult.code, 0);
    assert.match(bindingResult.stderr, /binding|JSON input.*1 MiB|1 MiB.*binding/i);
  });
});

test("behaviour 5 reproducible metrics", async t => {
  await t.test("produces byte-identical ordered retrieval and instrumented counts on repeated fixed runs", async t => {
    const base = await sandbox(t);
    const first = path.join(base, "first");
    const second = path.join(base, "second");
    await put(first, "z.md", "needle z\n");
    await put(first, "a.md", "needle a\n");
    await put(second, "b.md", "needle b\n");
    const bindings = binding({ alpha: { repositories: [repository("z-repo", second, ["b.md"]), repository("a-repo", first, ["z.md", "a.md"])] } });
    const one = await runExperiment(dataset(), bindings, "search");
    const two = await runExperiment(dataset(), bindings, "search");
    assert.deepEqual(
      one.results[0].repositories.map(repo => [repo.repository, repo.files.map(file => file.path), repo.metrics]),
      [
        ["a-repo", ["a.md", "z.md"], { directories: 1, candidates: 2, opens: 2, bytes: 18, omittedExcerpts: 0, rejections: 0 }],
        ["z-repo", ["b.md"], { directories: 1, candidates: 1, opens: 1, bytes: 9, omittedExcerpts: 0, rejections: 0 }],
      ],
      "repeated lookup must expose stable ordering and exact lookup counters",
    );
    assert.equal(JSON.stringify(one), JSON.stringify(two));
  });

  await t.test("search is a deterministic poison oracle for every forbidden case field", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "source.md", "needle real\n");
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["source.md"])] } });
    const clean = dataset();
    const poisoned = clone(clean);
    Object.assign(poisoned.cases[0], {
      references: [{ path: "poison.md", start: 99, end: 100, excerpt: "poison", fileSha256: "f".repeat(64) }],
      expectedOutcome: "poison",
      expectedScopedOutcome: { poison: true },
      measurements: { poison: true },
      measurement: { poison: true },
      checkoutSnapshots: { poison: true },
      checkouts: { poison: true },
      routeResults: [{ poison: true }],
    });
    const cleanOutput = await runExperiment(clean, bindings, "search");
    const poisonedOutput = await runExperiment(poisoned, bindings, "search");
    assert.equal(JSON.stringify(cleanOutput), JSON.stringify(poisonedOutput), "search output and metrics must ignore all oracle-only fields byte-for-byte");
  });

  await t.test("keeps setup and maintenance measures separate from repeated lookup metrics", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "source.md", "needle\n");
    const bindings = binding({ alpha: { repositories: [repository("repo", root, ["source.md"])] } });
    const output = await runExperiment(dataset(), bindings, "search");
    const metrics = output.results[0].repositories[0].metrics;
    assert.deepEqual(Object.keys(metrics).sort(), ["bytes", "candidates", "directories", "omittedExcerpts", "opens", "rejections"]);
    for (const forbidden of ["setup", "maintenance", "inputPreparation", "timing", "elapsed", "duration", "answerQuality", "usageSavings"]) {
      assert.equal(Object.hasOwn(metrics, forbidden), false);
    }
  });
});

test("behaviour 6 canonical exclusion inventory", async t => {
  await t.test("rejects a canonical corpus path excluded through a symlink alias", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "oracle.md", "unique reverse alias poison\n");
    await symlink(path.join(root, "oracle.md"), path.join(root, "excluded-alias.md"));
    const input = dataset(oneCase({ question: "unique reverse alias poison" }));
    const bindings = binding(
      { alpha: { repositories: [repository("repo", root, ["oracle.md"])] } },
      [],
      ["excluded-alias.md"],
    );

    const output = await runExperiment(input, bindings, "search");
    const repo = output.results[0].repositories[0];
    assert.deepEqual(repo.files, [], "an exclusion alias must exclude the same canonical file named by the corpus");
    assert.ok(repo.failures.some(failure => failure.path === "oracle.md" && /excl|alias|inventory/i.test(failure.reason)));
    assert.deepEqual(
      repo.metrics,
      { directories: 1, candidates: 2, opens: 0, bytes: 0, omittedExcerpts: 0, rejections: 1 },
      "canonicalizing exclusion inventory must charge its metadata candidate while preserving alias protection",
    );
  });
});

test("behaviour 7 exclusion inventory resource accounting", async t => {
  await t.test("charges nested exclusion aliases before metadata operations", async t => {
    const base = await sandbox(t);
    const root = path.join(base, "repo");
    await put(root, "oracle.md", "needle\n");
    await mkdir(path.join(root, "nested"));
    await symlink(path.join(root, "oracle.md"), path.join(root, "nested", "excluded-alias.md"));
    const bindings = binding(
      { alpha: { repositories: [repository("repo", root, [])] } },
      [],
      ["nested/excluded-alias.md"],
    );

    for (const [limit, budgets] of [["directories", { directories: 1 }], ["files", { files: 0 }]]) {
      const output = await runExperiment(dataset(), bindings, "search", budgets);
      const repo = output.results[0].repositories[0];
      assert.equal(repo.coverage, "incomplete", `exclusion inventory must disclose ${limit} exhaustion before metadata work`);
      assert.equal(repo.limit, limit);
    }
  });
});

test("behaviour 8 case-wide excerpt budgets", async t => {
  await t.test("shares excerpt-file and character caps across repositories in one case", async t => {
    const base = await sandbox(t);
    const first = path.join(base, "first");
    const second = path.join(base, "second");
    await put(first, "a.md", "needle-aaaa\n");
    await put(second, "b.md", "needle-bbbb\n");
    const bindings = binding({ alpha: { repositories: [
      repository("first", first, ["a.md"]),
      repository("second", second, ["b.md"]),
    ] } });

    const output = await runExperiment(dataset(), bindings, "search", { excerptFiles: 1, excerptCharacters: 7 });
    const repositories = output.results[0].repositories;
    const excerptBearingFiles = repositories.flatMap(repo => repo.files).filter(file => file.excerpts.length > 0);
    const excerptCharacters = excerptBearingFiles.flatMap(file => file.excerpts).join("").length;
    assert.equal(excerptBearingFiles.length, 1, "one case may emit excerpts for at most one file across all repositories");
    assert.equal(excerptCharacters, 7, "one case may emit at most seven excerpt characters across all repositories");
  });
});


async function runSearchDiverse(input, bindings, limits) {
  try {
    return await runExperiment(input, bindings, "search-diverse", limits);
  } catch (error) {
    assert.fail(`search-diverse must complete: ${error instanceof Error ? error.message : String(error)}`);
  }
}

test("W-104 behaviour 1", async t => {
  const base = await sandbox(t);
  const first = path.join(base, "first");
  const second = path.join(base, "second");
  const contents = {
    long: `needle ${"a".repeat(3_000)}`,
    short: "needle short\n",
    multi: `needle first\nseparator\nneedle ${"m".repeat(1_800)}\n`,
    tail: "needle tail\n",
  };
  await put(first, "a-long.md", contents.long);
  await put(first, "b-short.md", contents.short);
  await put(second, "a-multi.md", contents.multi);
  await put(second, "b-tail.md", contents.tail);
  const bindings = binding({ alpha: { repositories: [
    repository("z-repo", second, ["b-tail.md", "a-multi.md"]),
    repository("a-repo", first, ["b-short.md", "a-long.md"]),
  ] } });
  const limits = { excerptFiles: 4, excerptCharacters: 6_000 };

  const output = await runSearchDiverse(dataset(), bindings, limits);
  const repositories = output.results[0].repositories;
  assert.deepEqual(repositories.map(repo => repo.repository), ["a-repo", "z-repo"]);
  assert.deepEqual(
    repositories.flatMap(repo => repo.files.filter(file => file.excerpts.length).map(file => `${repo.repository}:${file.path}`)),
    ["a-repo:a-long.md", "a-repo:b-short.md", "z-repo:a-multi.md", "z-repo:b-tail.md"],
    "the first four distinct files in global repository/path order must all receive a cycle-one turn",
  );
  const long = resultRepository(output, 0, "a-repo").files.find(file => file.path === "a-long.md");
  const multi = resultRepository(output, 0, "z-repo").files.find(file => file.path === "a-multi.md");
  assert.equal(long.excerpts[0].length, 1_500, "the first oversized range may consume only its fair cycle-one quota");
  assert.equal(multi.excerpts.length, 2, "a selected file with another queued range must receive a later-cycle turn");
  for (const repo of repositories) {
    for (const file of repo.files) {
      assert.equal(file.excerpts.some(excerpt => excerpt.length === 0), false, "empty excerpts are forbidden");
      for (let index = 0; index < file.excerpts.length; index++) {
        const [start, end] = file.ranges[index];
        const source = (file.path === "a-long.md" ? contents.long
          : file.path === "b-short.md" ? contents.short
          : file.path === "a-multi.md" ? contents.multi
          : contents.tail).split(/\r?\n/).slice(start - 1, end).join("\n");
        assert.equal(source.startsWith(file.excerpts[index]), true, `${repo.repository}:${file.path} excerpt ${index} must be an ordered range prefix`);
      }
    }
  }
  assert.deepEqual(repositories.map(repo => [repo.repository, repo.metrics.omittedExcerpts]), [["a-repo", 1], ["z-repo", 0]]);

  const zeroFiles = await runSearchDiverse(dataset(), bindings, { excerptFiles: 0, excerptCharacters: 6_000 });
  assert.equal(zeroFiles.results[0].repositories.flatMap(repo => repo.files).flatMap(file => file.excerpts).length, 0);
  assert.deepEqual(zeroFiles.results[0].repositories.map(repo => repo.metrics.omittedExcerpts), [2, 3]);

  const zeroCharacters = await runSearchDiverse(dataset(), bindings, { excerptFiles: 4, excerptCharacters: 0 });
  assert.equal(zeroCharacters.results[0].repositories.flatMap(repo => repo.files).flatMap(file => file.excerpts).length, 0);
  assert.deepEqual(zeroCharacters.results[0].repositories.map(repo => repo.metrics.omittedExcerpts), [2, 3]);

  const low = await runSearchDiverse(dataset(), bindings, { excerptFiles: 4, excerptCharacters: 2 });
  assert.deepEqual(low.results[0].repositories.flatMap(repo => repo.files).flatMap(file => file.excerpts), ["n", "n"]);
  assert.deepEqual(low.results[0].repositories.map(repo => repo.metrics.omittedExcerpts), [2, 3], "quota-zero, truncated, and wholly unserved ranges count once each");
});

test("W-104 behaviour 2", async t => {
  const base = await sandbox(t);
  const first = path.join(base, "first");
  const second = path.join(base, "second");
  await put(first, "a.md", "needle alpha\n");
  await put(first, "z.md", "needle zulu\n");
  await put(second, "b.md", "needle bravo\n");
  const projectsOne = { alpha: { repositories: [
    repository("z-repo", second, ["b.md"]),
    repository("a-repo", first, ["z.md", "a.md"]),
  ] } };
  const projectsTwo = { alpha: { repositories: [
    repository("a-repo", first, ["a.md", "z.md"]),
    repository("z-repo", second, ["b.md"]),
  ] } };
  const limits = { excerptFiles: 2, excerptCharacters: 18 };

  const firstRun = await runSearchDiverse(dataset(), binding(projectsOne), limits);
  const repeated = await runSearchDiverse(dataset(), binding(projectsOne), limits);
  const permuted = await runSearchDiverse(dataset(), binding(projectsTwo), limits);
  assert.equal(JSON.stringify(firstRun), JSON.stringify(repeated), "repeated new-mode outputs must be byte-identical");
  assert.equal(JSON.stringify(firstRun), JSON.stringify(permuted), "manifest permutations must not change selection or metrics");
  assert.deepEqual(
    firstRun.results[0].repositories.flatMap(repo => repo.files.filter(file => file.excerpts.length).map(file => `${repo.repository}:${file.path}`)),
    ["a-repo:a.md", "a-repo:z.md"],
    "selection must use only repository-ID/path code-unit order",
  );
});

test("W-104 behaviour 3", async t => {
  const base = await sandbox(t);
  const root = path.join(base, "repo");
  const outside = path.join(base, "outside.md");
  await put(root, "source.md", "needle real\n");
  await put(root, "research/oracle.md", "needle oracle\n");
  await writeFile(outside, "needle escaped\n");
  await symlink(outside, path.join(root, "escape.md"));
  const calls = installGitMock(t);
  const bindings = binding(
    { alpha: { repositories: [repository("repo", root, ["escape.md", "research/oracle.md", "source.md"])] } },
    [],
    ["research/oracle.md"],
  );
  const clean = dataset();
  const poisoned = clone(clean);
  Object.assign(poisoned.cases[0], {
    references: [{ path: "poison.md", start: 99, end: 100, excerpt: "poison", fileSha256: "f".repeat(64) }],
    capturedHashes: ["f".repeat(64)],
    capturedExcerpts: ["poison"],
    expectedOutcome: "poison",
    expectedOutcomes: ["poison"],
    expectedScopedOutcome: { poison: true },
    measurements: { poison: true },
    measurement: { poison: true },
    checkoutSnapshots: { poison: true },
    checkouts: { poison: true },
    routeResults: [{ poison: true }],
  });

  const cleanOutput = await runSearchDiverse(clean, bindings, { excerptFiles: 1, excerptCharacters: 64 });
  const poisonedOutput = await runSearchDiverse(poisoned, bindings, { excerptFiles: 1, excerptCharacters: 64 });
  assert.equal(JSON.stringify(cleanOutput), JSON.stringify(poisonedOutput), "all forbidden case fields must leave new-mode results and metrics byte-identical");
  const repo = cleanOutput.results[0].repositories[0];
  assert.deepEqual(repo.files.map(file => file.path), ["source.md"]);
  assert.ok(repo.failures.some(failure => failure.path === "escape.md" && /escape|outside|contain/i.test(failure.reason)));
  assert.ok(repo.failures.some(failure => failure.path === "research/oracle.md" && /excl/i.test(failure.reason)));
  assert.deepEqual({ candidates: repo.metrics.candidates, opens: repo.metrics.opens, bytes: repo.metrics.bytes }, { candidates: 4, opens: 1, bytes: 12 });
  assert.equal(calls.length, 6, "each isolated run must use only the inherited three-call Git contract");
  assert.deepEqual(calls.map(call => call.args), [
    [...GIT_PREFIX, "rev-parse", "--verify", "HEAD"],
    [...GIT_PREFIX, "symbolic-ref", "--short", "-q", "HEAD"],
    [...GIT_PREFIX, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=all", "--", ":(literal)source.md"],
    [...GIT_PREFIX, "rev-parse", "--verify", "HEAD"],
    [...GIT_PREFIX, "symbolic-ref", "--short", "-q", "HEAD"],
    [...GIT_PREFIX, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--ignore-submodules=all", "--", ":(literal)source.md"],
  ]);
});
