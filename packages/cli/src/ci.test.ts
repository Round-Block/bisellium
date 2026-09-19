/**
 * packages/cli/src/ci.test.ts — W-031: `bisellium ci`. Behaviours 1-6 of
 * studio/briefs/W-031.md's spec (behaviour 7, the drift guard, lives in
 * scripts/ci-workflow.test.mjs — it compares ci.ts's CI_STEPS directly
 * against .github/workflows/ci.yml, which has nothing to do with runCi's
 * own runtime behaviour). No framework, same house style as
 * packages/cli/src/close.test.ts.
 *
 * CI_STEPS' six commands are fixed, hardcoded strings (npm run -s
 * typecheck/lint/format:check, npm test, npm run -s check -- <dir> --repo
 * .) — every fixture repo below carries a package.json whose scripts give
 * those exact names something trivial (but observable) to run, rather than
 * the real tsc/eslint/prettier this repo's own package.json wires up.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitWorktreeProvider } from "@bisellium/shim";
import { initStudio } from "./init.js";
import { newItem } from "./new.js";
import { runVerify } from "./verify.js";
import { runCi } from "./ci.js";

let failed = 0;
const only = process.argv[2] !== undefined ? Number(process.argv[2]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function gitInit(dir: string): void {
  git(dir, ["init", "-q", "-b", "master"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
}

function commitAll(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
}

const EXPECTED_ORDER = ["typecheck", "lint", "format:check", "test", "check:studio", "check:examples/sample-studio"];

// Appends its own step label to order.log (npm run's own "-- ARGS" carries
// the two `check` invocations' argument apart, so both land in order.log as
// distinct labels even though they share one npm script) and exits 1 when
// fail-at.txt names that exact label — so a test controls "which of the six
// steps fails" with one file write.
const ORDER_MARKER = `import { appendFileSync, existsSync, readFileSync } from "node:fs";
const label = process.argv[2] === "check" ? \`check:\${process.argv[3]}\` : process.argv[2];
appendFileSync("order.log", \`\${label}\\n\`);
if (existsSync("fail-at.txt") && readFileSync("fail-at.txt", "utf8").trim() === label) process.exit(1);
`;

function writeOrderRepo(dir: string): void {
  writeFileSync(join(dir, "ci-marker.mjs"), ORDER_MARKER);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "ci-order-fixture",
        private: true,
        scripts: {
          typecheck: "node ci-marker.mjs typecheck",
          lint: "node ci-marker.mjs lint",
          "format:check": "node ci-marker.mjs format:check",
          test: "node ci-marker.mjs test",
          check: "node ci-marker.mjs check",
        },
      },
      null,
      2,
    ),
  );
}

function orderLog(dir: string): string[] {
  return existsSync(join(dir, "order.log"))
    ? readFileSync(join(dir, "order.log"), "utf8").trim().split("\n").filter(Boolean)
    : [];
}

// ---------------------------------------------------------------------------
// behaviour 1: runs all six steps in ci.yml's order on a passing tree, exits 0
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "ci-order-"));
  try {
    writeOrderRepo(dir);
    const result = await runCi(["--repo", dir]);
    check(
      1,
      "runs all six steps in order and exits 0",
      result.exitCode === 0 && orderLog(dir).join(",") === EXPECTED_ORDER.join(","),
      JSON.stringify(orderLog(dir)),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 2: stops at the first failing step, names it, exits non-zero
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "ci-stop-"));
  const origError = console.error;
  let stderr = "";
  try {
    writeOrderRepo(dir);
    writeFileSync(join(dir, "fail-at.txt"), "format:check");
    console.error = (msg?: unknown) => {
      stderr += `${String(msg)}\n`;
    };
    const result = await runCi(["--repo", dir]);
    console.error = origError;
    check(
      2,
      "stops at first failing step, names it, exits non-zero",
      result.exitCode !== 0 &&
        orderLog(dir).join(",") === ["typecheck", "lint", "format:check"].join(",") &&
        stderr.includes("format:check"),
      `exit=${result.exitCode} order=${JSON.stringify(orderLog(dir))} stderr=${stderr.trim()}`,
    );
  } finally {
    console.error = origError;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 3: --ref runs against a clean checkout — a dirty working tree
// does not change the result
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "ci-ref-clean-"));
  try {
    writeOrderRepo(dir);
    gitInit(dir);
    commitAll(dir, "init (passing)");
    // Dirty the working tree in a way that would fail step 1 if a run ever
    // touched it — never committed, so --ref's clean checkout never sees it.
    writeFileSync(join(dir, "fail-at.txt"), "typecheck");

    const refResult = await runCi(["--repo", dir, "--ref", "HEAD"], {
      provider: gitWorktreeProvider,
      installDeps: () => {},
    });
    const dirtyResult = await runCi(["--repo", dir]);

    check(
      3,
      "--ref ignores a dirty working tree; the working tree itself still fails",
      refResult.exitCode === 0 && dirtyResult.exitCode !== 0,
      `ref=${refResult.exitCode} workingTree=${dirtyResult.exitCode}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 4: --ref against a ref whose packages/ differs from the working
// tree produces the ref's result, not the working tree's — the real
// node_modules resolution trap, proven with a genuine `npm ci` (no
// installDeps override): a workspace package resolved through a symlink
// farm borrowed from the parent checkout, or through a skipped install,
// would see the WORKING TREE's edit instead.
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "ci-ref-trap-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "ci-trap-fixture",
          private: true,
          workspaces: ["packages/*"],
          scripts: {
            typecheck: "node -e \"process.exit(0)\"",
            lint: "node -e \"process.exit(0)\"",
            "format:check": "node -e \"process.exit(0)\"",
            test: "node -e \"process.exit(require('@fixture/foo').value===1?0:1)\"",
            check: "node -e \"process.exit(0)\"",
          },
        },
        null,
        2,
      ),
    );
    mkdirSync(join(dir, "packages", "foo"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "foo", "package.json"),
      JSON.stringify({ name: "@fixture/foo", version: "1.0.0", main: "index.js" }),
    );
    writeFileSync(join(dir, "packages", "foo", "index.js"), "module.exports = { value: 1 };\n");

    // `npm ci` refuses to run without a committed lockfile — generate one
    // before the ref commit, same as any real workspace repo would carry.
    const setupCache = mkdtempSync(join(tmpdir(), "ci-trap-setup-cache-"));
    const lockGen = spawnSync("npm", ["install", "--package-lock-only", "--cache", setupCache], { cwd: dir, encoding: "utf8" });
    if (lockGen.status !== 0) throw new Error(`fixture setup: npm install --package-lock-only failed: ${lockGen.stderr}`);

    gitInit(dir);
    commitAll(dir, "ref: foo=1");
    const ref = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();

    // A developer's already-set-up working tree: real node_modules,
    // workspace-linked, from when packages/foo still exported 1.
    const setup = spawnSync("npm", ["ci", "--no-audit", "--no-fund", "--cache", setupCache], { cwd: dir, encoding: "utf8" });
    if (setup.status !== 0) throw new Error(`fixture setup: npm ci failed: ${setup.stderr}`);
    rmSync(setupCache, { recursive: true, force: true });

    // Now edit packages/ WITHOUT committing — exactly the trap.
    writeFileSync(join(dir, "packages", "foo", "index.js"), "module.exports = { value: 2 };\n");

    const refResult = await runCi(["--repo", dir, "--ref", ref], { provider: gitWorktreeProvider });
    const workingTreeResult = await runCi(["--repo", dir]);

    check(
      4,
      "--ref tests the ref's packages/, not the working tree's",
      refResult.exitCode === 0 && workingTreeResult.exitCode !== 0,
      `ref=${refResult.exitCode} workingTree=${workingTreeResult.exitCode}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// shared fixture for behaviours 5 and 6: a repo whose six CI_STEPS all pass,
// plus a studio (elsewhere entirely — never a subdirectory of `repo`, so
// neither studio's own writes nor the other's presence can flip the other's
// dirty-tree check) with one opus and automated tests/lint/types
// probationes.
// ---------------------------------------------------------------------------
function makeCiRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ci-opus-repo-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "ci-opus-fixture",
        private: true,
        scripts: {
          typecheck: "node -e \"process.exit(0)\"",
          lint: "node -e \"process.exit(0)\"",
          "format:check": "node -e \"process.exit(0)\"",
          test: "node -e \"process.exit(0)\"",
          check: "node -e \"process.exit(0)\"",
        },
      },
      null,
      2,
    ),
  );
  gitInit(dir);
  commitAll(dir, "init");
  return dir;
}

function makeCiStudio(): string {
  const dir = mkdtempSync(join(tmpdir(), "ci-opus-studio-"));
  const init = initStudio(dir, { now: new Date("2026-09-19T00:00:00Z") });
  if (!init.ok) throw new Error(`initStudio failed: ${init.message}`);
  const manifestPath = join(dir, "bisellium.yml");
  const manifest = readFileSync(manifestPath, "utf8");
  // Insert into the probationes list initStudio already wrote, rather than
  // appending after wip_limit — appending blindly would land the new list
  // entries after a scalar key and produce invalid YAML.
  const marker = "probationes:\n  - { id: patron, name: Patron call, kind: human }\n";
  if (!manifest.includes(marker)) throw new Error(`initStudio's manifest template changed — update this fixture:\n${manifest}`);
  writeFileSync(
    manifestPath,
    manifest.replace(
      marker,
      `${marker}  - { id: tests, name: Tests, kind: automated, command: "true" }\n` +
        `  - { id: lint, name: Lint, kind: automated, command: "true" }\n` +
        `  - { id: types, name: Typecheck, kind: automated, command: "true" }\n`,
    ),
  );
  const created = newItem(dir, { kind: "task", collegium: "production", title: "ci opus" });
  if (!created.ok || !created.id) throw new Error(`newItem failed: ${created.message}`);
  return dir;
}

function cpDir(src: string, dest: string): void {
  const r = spawnSync("cp", ["-R", src, dest], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cp -R ${src} ${dest} failed: ${r.stderr}`);
}

// ---------------------------------------------------------------------------
// behaviour 5: --opus <id> records gate certificates identical to what
// verify would record for the same tree — proven by running each through a
// separate (but byte-identical, pre-copy) studio and diffing the result,
// not just by trusting that ci.ts calls runVerify.
// ---------------------------------------------------------------------------
{
  const repo = makeCiRepo();
  const studioSrc = makeCiStudio();
  const studioA = `${studioSrc}-a`;
  const studioB = `${studioSrc}-b`;
  try {
    cpDir(studioSrc, studioA);
    cpDir(studioSrc, studioB);

    const ciResult = await runCi(["--repo", repo, "--studio", studioA, "--opus", "W-001"]);
    const verifyResult = await runVerify(["W-001", "--repo", repo, "--studio", studioB, "--allow-dirty"]);

    const opusA = readFileSync(join(studioA, "opera", "W-001.md"), "utf8");
    const opusB = readFileSync(join(studioB, "opera", "W-001.md"), "utf8");

    check(
      5,
      "--opus records certificates identical to verify's for the same tree",
      ciResult.exitCode === 0 && verifyResult.exitCode === 0 && opusA === opusB,
      opusA === opusB ? "identical" : `A:\n${opusA}\n---\nB:\n${opusB}`,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(studioSrc, { recursive: true, force: true });
    rmSync(studioA, { recursive: true, force: true });
    rmSync(studioB, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 6: without --opus, no officina bookkeeping is written at all
// ---------------------------------------------------------------------------
{
  const repo = makeCiRepo();
  const studio = makeCiStudio();
  try {
    const opusPath = join(studio, "opera", "W-001.md");
    const before = readFileSync(opusPath, "utf8");

    const result = await runCi(["--repo", repo, "--studio", studio]);

    const after = readFileSync(opusPath, "utf8");
    check(
      6,
      "without --opus, exits 0 and writes no officina bookkeeping",
      result.exitCode === 0 && after === before && !existsSync(join(studio, "ci")),
      `exit=${result.exitCode} opusChanged=${after !== before} ciDirExists=${existsSync(join(studio, "ci"))}`,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
