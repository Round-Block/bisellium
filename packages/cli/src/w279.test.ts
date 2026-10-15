/**
 * W-279: `ci --opus` hands a step to `verify` only when `verify` will run it, a
 * failing `verify` gate prints its log tail, and lint/format ignore foreign
 * worktree roots. Rows are named `W-279-b<n> behaviour <n>: …` and selected with
 * `--test-name-pattern='^W-279-b<n> '`. node:test TAP. The fixtures are scratch
 * git repos and studios under os.tmpdir(); no timers, sleeps or polling.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parse } from "yaml";
import { initStudio } from "./init.js";
import { newItem } from "./new.js";
import { runCi } from "./ci.js";

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function commitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "master"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "fixture"]);
}

const MARKER_PROBATIONES = "probationes:\n  - { id: patron, name: Patron call, kind: human }\n";

/** A studio outside `repo`, whose one opus carries the given automated probationes (a YAML flow list body). */
function writeStudio(automated: string[], title: string): { studio: string; id: string } {
  const studio = tmp("w279-studio-");
  const init = initStudio(studio, { now: new Date("2026-09-19T00:00:00Z") });
  if (!init.ok) throw new Error(`initStudio failed: ${init.message}`);
  const manifestPath = join(studio, "bisellium.yml");
  const manifest = readFileSync(manifestPath, "utf8");
  if (!manifest.includes(MARKER_PROBATIONES)) throw new Error(`initStudio's manifest template changed:\n${manifest}`);
  const rows = automated.map((a) => `  - ${a}\n`).join("");
  writeFileSync(manifestPath, manifest.replace(MARKER_PROBATIONES, `${MARKER_PROBATIONES}${rows}`));
  const created = newItem(studio, { kind: "task", collegium: "production", title });
  if (!created.ok || !created.id) throw new Error(`newItem failed: ${created.message}`);
  return { studio, id: created.id };
}

const ORDER_MARKER = `import { appendFileSync } from "node:fs";
const label = process.argv[2] === "check" ? \`check:\${process.argv[3]}\` : process.argv[2];
appendFileSync("order.log", \`\${label}\\n\`);
`;

function orderRepo(): string {
  const dir = tmp("w279-repo-");
  writeFileSync(join(dir, "ci-marker.mjs"), ORDER_MARKER);
  writeFileSync(join(dir, ".gitignore"), "order.log\n");
  const scripts = Object.fromEntries(
    ["audit", "typecheck", "lint", "format:check", "test", "check"].map((s) => [s, `node ci-marker.mjs ${s}`]),
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "w279-fixture", private: true, scripts }, null, 2));
  commitRepo(dir);
  return dir;
}

const THREE_GATES = [
  '{ id: tests, name: Tests, kind: automated, command: "npm test -s" }',
  '{ id: lint, name: Lint, kind: automated, command: "npm run -s lint" }',
  '{ id: types, name: Typecheck, kind: automated, command: "npm run -s typecheck" }',
];

function orderLog(repo: string): string[] {
  return readFileSync(join(repo, "order.log"), "utf8").trim().split("\n").filter(Boolean);
}

function gateRecord(studio: string, id: string, gate: string): Record<string, unknown> {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(studio, "opera", `${id}.md`), "utf8"));
  const record = parse(front?.[1] ?? "") as { probationes?: Record<string, Record<string, unknown>> };
  return record.probationes?.[gate] ?? {};
}

const LOOP_ONLY = ["audit", "format:check", "check:studio", "check:examples/sample-studio"];

test("W-279-b1 behaviour 1: ci --opus drops no applicable CI_STEPS command and runs each once when the Promise's stability and uniqueness conditions hold", async () => {
  // (a) every moved step runs once, as a verify gate
  {
    const repo = orderRepo();
    const { studio, id } = writeStudio(THREE_GATES, "w279 a");
    const result = await runCi(["--repo", repo, "--studio", studio, "--opus", id]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(orderLog(repo), [...LOOP_ONLY, "test", "lint", "typecheck"]);
    for (const gate of ["tests", "lint", "types"]) {
      const record = gateRecord(studio, id, gate);
      assert.equal(record["status"], "passed", gate);
      assert.match(String(record["certifies"]), /^tree:/, gate);
    }
  }
  // (b) a waived tests gate keeps its step in the loop
  {
    const repo = orderRepo();
    const { studio, id } = writeStudio(THREE_GATES, "w279 b");
    const opusPath = join(studio, "opera", `${id}.md`);
    const text = readFileSync(opusPath, "utf8");
    assert.ok(text.includes("probationes: {}"), text);
    writeFileSync(opusPath, text.replace("probationes: {}", "probationes:\n  tests:\n    status: waived"));
    const result = await runCi(["--repo", repo, "--studio", studio, "--opus", id]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(orderLog(repo), ["audit", "format:check", "test", "check:studio", "check:examples/sample-studio", "lint", "typecheck"]);
    assert.equal(gateRecord(studio, id, "tests")["status"], "waived");
  }
  // (c) a second gate with the same normalised command runs on its own; the loop adds no third
  {
    const repo = orderRepo();
    const gates = [...THREE_GATES, '{ id: tests-again, name: Tests again, kind: automated, command: "npm test" }'];
    const { studio, id } = writeStudio(gates, "w279 c");
    const result = await runCi(["--repo", repo, "--studio", studio, "--opus", id]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(orderLog(repo), [...LOOP_ONLY, "test", "lint", "typecheck", "test"]);
  }
});
