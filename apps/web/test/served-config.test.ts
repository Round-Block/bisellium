/**
 * W-110 behaviour 8: the served suite builds the bundle before any spec runs,
 * and nothing builds it twice. node:test TAP; `--behaviour 8` selects the one
 * test. Plain TS (no JSX, no CSS), so it runs from the repo root under
 * `--import tsx`. The module the fix introduces is reached through a
 * tsc-safe dynamic import, after the Genuine red row.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && only !== 8) {
  console.error("served-config.test.ts: --behaviour must be 8");
  process.exit(2);
}

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const REPO_ROOT = resolve(here("../../.."));
const CONFIG = here("../playwright.serve.config.ts");
const SETUP = here("../tests-serve/global-setup.ts");
const DIST_INDEX = join(REPO_ROOT, "apps", "web", "dist", "index.html");

const tmp: string[] = [];
after(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

interface ServeConfig {
  testDir?: string;
  fullyParallel?: boolean;
  reporter?: unknown;
  globalSetup?: unknown;
  projects?: { name?: string }[];
}
interface SetupModule {
  default?: unknown;
  webBuildCommand?: unknown;
}
type BuildCommand = { cmd: string; args: string[]; cwd: string };

if (only === undefined || only === 8) {
  test("W-110 behaviour 8: the served suite builds the bundle before any spec runs, and nothing builds it twice", async () => {
    // (a) passes today: the config's unchanged shape.
    const configSpec = CONFIG;
    const config = ((await import(configSpec)) as { default: ServeConfig }).default;
    assert.equal(config.testDir, "./tests-serve", "(a) testDir is ./tests-serve");
    assert.equal(config.projects?.length, 1, "(a) exactly one project");
    assert.equal(config.projects?.[0]?.name, "chromium", "(a) the project is chromium");
    assert.equal(config.fullyParallel, true, "(a) fullyParallel is true");
    assert.equal(config.reporter, "list", "(a) the reporter is list");

    // (b) Genuine red: the config names a globalSetup module that exports the build.
    assert.equal(config.globalSetup, "./tests-serve/global-setup.ts", "(b) the config's globalSetup is ./tests-serve/global-setup.ts");
    assert.ok(existsSync(SETUP), "(b) apps/web/tests-serve/global-setup.ts exists");
    const setupSpec = SETUP;
    const mod = (await import(setupSpec)) as SetupModule;
    assert.equal(typeof mod.default, "function", "(b) global-setup's default export is a function");
    assert.equal(typeof mod.webBuildCommand, "function", "(b) global-setup exports webBuildCommand");
    const webBuildCommand = mod.webBuildCommand as (outDir?: string) => BuildCommand;

    // (c) the command names npm in the repo root, and an outDir is appended after `--`.
    const plain = webBuildCommand();
    assert.equal(plain.cmd, "npm", "(c) the command is npm");
    const wanted = ["--workspace", "@bisellium/web", "run", "build"];
    assert.ok(plain.args.join("\n").includes(wanted.join("\n")), "(c) argv carries --workspace @bisellium/web run build in order");
    assert.equal(realpathSync(plain.cwd), realpathSync(REPO_ROOT), "(c) cwd is the repo root");
    const out = mkdtempSync(join(tmpdir(), "w110-outdir-"));
    tmp.push(out);
    assert.deepEqual(webBuildCommand(out).args.slice(-3), ["--", "--outDir", out], "(c) an outDir is appended as -- --outDir <dir>");

    // (d) running it into a temp dir yields a usable bundle and writes nothing inside the repo.
    const before = existsSync(DIST_INDEX) ? statSync(DIST_INDEX).mtimeMs : undefined;
    const built = webBuildCommand(out);
    const run = spawnSync(built.cmd, built.args, { cwd: built.cwd, encoding: "utf8" });
    assert.equal(run.status, 0, `(d) the build exits 0 ${run.stderr}`);
    assert.ok(existsSync(join(out, "index.html")), "(d) index.html is written under the temp outDir");
    const html = readFileSync(join(out, "index.html"), "utf8");
    const assets = [...html.matchAll(/["'](\/assets\/[^"']+)["']/g)].map((m) => m[1] as string);
    assert.ok(assets.length > 0, "(d) index.html references at least one /assets/ file");
    for (const a of assets) assert.ok(existsSync(join(out, a)), `(d) ${a} exists under the outDir`);
    const after = existsSync(DIST_INDEX) ? statSync(DIST_INDEX).mtimeMs : undefined;
    assert.equal(after, before, "(d) apps/web/dist/index.html is untouched by the temp-dir build");

    // (e) served-e2e.mjs spawns npm once, for test:serve, and never for build.
    const script = readFileSync(here("../../../scripts/served-e2e.mjs"), "utf8");
    assert.equal((script.match(/\bspawn(?:Sync)?\(/g) ?? []).length, 1, "(e) served-e2e.mjs has exactly one spawn call");
    assert.equal((script.match(/["']npm["']/g) ?? []).length, 1, "(e) served-e2e.mjs names npm once");
    assert.match(script, /["']test:serve["']/, "(e) served-e2e.mjs's argv names test:serve");
    assert.doesNotMatch(script, /["']build["']/, "(e) served-e2e.mjs's argv does not name build");

    // (f) the harness still spawns the real CLI under tsx, never npx.
    const harness = readFileSync(here("../tests-serve/harness.ts"), "utf8");
    assert.match(harness, /process\.execPath/, "(f) harness.ts spawns process.execPath");
    assert.match(harness, /["']--import["'],\s*["']tsx["']/, "(f) harness.ts passes --import tsx");
    assert.match(harness, /packages["'],\s*["']cli["'],\s*["']src["'],\s*["']main\.ts/, "(f) harness.ts runs packages/cli/src/main.ts");
    // The harness's own doc comment says "never npx tsx"; the property is that no code runs it.
    const code = harness.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bnpx\b/, "(f) harness.ts code (comments stripped) contains no npx");
  });
}
