/**
 * W-130 behaviours 1, 2, 3 and 5: the pure host module `scripts/host-cells.mjs`
 * (browser cache resolution, the read-only /browsers mount, both cell
 * descriptors, the fixed web build argv and the preparation messages) and the
 * runner's source-level wiring to it and to `scripts/replay-accept.mjs`.
 * Plain node: no runner launch, no socket, no bwrap, no browser, no network, no
 * node_modules. Select one numbered behaviour with `--behaviour N` for N in 1,
 * 2, 3, 5 (behaviour 4 lives in replay-accept.test.mjs); omitting it runs all.
 * node:test TAP, one test() per behaviour.
 *
 * The modules under test are loaded dynamically so that their absence is one
 * assertion failure, not a module-load error (a missing red).
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && ![1, 2, 3, 5].includes(only)) {
  console.error("host-cells.test.mjs: --behaviour must be one of 1, 2, 3, 5");
  process.exit(2);
}
const runs = (behaviour) => only === undefined || only === behaviour;

const roots = [];
const scratch = (tag) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `w130-${tag}-`)));
  roots.push(root);
  return root;
};
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const RUNNER = new URL("../scripts/run-builder-host.mjs", import.meta.url);
const ACCEPT = new URL("../scripts/replay-accept.mjs", import.meta.url);
const BROWSER_ENV = "PLAYWRIGHT_BROWSERS_PATH";

// W-125's own cell shapes, as literals: the browser entry is the only thing
// W-130 may add, so everything else is pinned to these.
const BUILDER_ENV_NAMES = [
  "BISELLIUM_SELLA",
  "BISELLIUM_SESSION",
  "BISELLIUM_STUDIO",
  "CI",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_NAME",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
  "npm_config_cache",
  "npm_config_globalconfig",
  "npm_config_registry",
  "npm_config_userconfig",
];
const builderEnv = () => ({
  PATH: "/tools:/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/builder",
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: "UTC",
  CI: "1",
  GIT_AUTHOR_NAME: "builder.W-1",
  GIT_AUTHOR_EMAIL: "builder.W-1@slug.bisellium",
  GIT_COMMITTER_NAME: "builder.W-1",
  GIT_COMMITTER_EMAIL: "builder.W-1@slug.bisellium",
  BISELLIUM_SELLA: "builder.W-1",
  BISELLIUM_STUDIO: "slug",
  BISELLIUM_SESSION: "session-1",
  npm_config_cache: "/cache/npm",
  npm_config_userconfig: "/home/builder/.npmrc",
  npm_config_globalconfig: "/home/builder/.npmrc-global",
  npm_config_registry: "https://registry.npmjs.org",
});
const ETC = [
  ["/h/etc/passwd", "/etc/passwd"],
  ["/h/etc/group", "/etc/group"],
];
const builderPaths = (browsers) => ({
  clone: "/h/runtime/clone",
  runtime: "/h/runtime",
  etc: ETC,
  sella: "builder.W-1",
  slug: "slug",
  session: "session-1",
  browsers,
});
const replayPaths = (browsers) => ({
  checkout: "/h/red/candidate",
  root: "/h/red",
  etc: ETC,
  nodeBin: "/n/bin",
  browsers,
});
const BUILDER_BINDS = [
  ["/h/runtime/clone", "/workspace"],
  ["/h/runtime/home", "/home/builder"],
  ["/h/runtime/tmp", "/tmp"],
  ["/h/runtime/cache", "/cache"],
];
const BUILDER_RO = [
  ["/h/runtime/clone/.git", "/workspace/.git"],
  ["/h/runtime/tools", "/tools"],
  ["/h/runtime/control", "/control"],
  ["/dev/null", "/usr/bin/git"],
  ["/h/runtime/git-core-mask", "/usr/lib/git-core"],
  ...ETC,
];
const REPLAY_BINDS = [
  ["/h/red/candidate", "/candidate"],
  ["/h/red/home", "/home/builder"],
  ["/h/red/tmp", "/tmp"],
];
const REPLAY_ENV = {
  PATH: "/n/bin:/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/builder",
  TMPDIR: "/tmp",
  CI: "1",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: "UTC",
};
const without = (object, name) => Object.fromEntries(Object.entries(object).filter(([key]) => key !== name));
const occurrences = (text, pattern) => (text.match(pattern) ?? []).length;
// Not assert.match: a failed match prints the whole runner source, and a replay
// of this red would then be refused for the environment words that source holds.
const sourceHas = (text, pattern, message) => assert.ok(pattern.test(text), message);

if (runs(1)) {
  test("W-130 behaviour 1: the browser cache resolves from the host's own environment, under guards", async () => {
    // (a) Genuine red: the module does not exist yet, as one assertion.
    const mod = await import("./host-cells.mjs").catch(() => undefined);
    assert.ok(mod?.browserCache, "1(a): scripts/host-cells.mjs exports browserCache");

    const base = scratch("b1");
    const real = join(base, "real");
    mkdirSync(real);
    const link = join(base, "link");
    symlinkSync(real, link, "dir");
    const other = join(base, "other");
    mkdirSync(other);
    const homeWith = join(base, "home-with");
    mkdirSync(join(homeWith, ".cache", "ms-playwright"), { recursive: true });
    const homeWithout = join(base, "home-without");
    mkdirSync(homeWithout);

    // (b) an absolute named directory resolves to its realpath, not the given path.
    const resolved = mod.browserCache({ [BROWSER_ENV]: link }, homeWithout);
    assert.notEqual(
      resolved,
      link,
      "1(b): the symlinked path and its realpath differ, so the row cannot pass by accident",
    );
    assert.equal(resolved, realpathSync(real), "1(b): an absolute named directory resolves to its realpath");

    // (c) the named directory wins over the home-derived default.
    assert.equal(
      mod.browserCache({ [BROWSER_ENV]: other }, homeWith),
      other,
      "1(c): a named directory wins over the home default",
    );

    // (d) absent from env: the home default when it is a directory, undefined otherwise.
    assert.equal(
      mod.browserCache({}, homeWith),
      realpathSync(join(homeWith, ".cache", "ms-playwright")),
      "1(d): absent from env, the answer is <home>/.cache/ms-playwright",
    );
    assert.equal(mod.browserCache({}, homeWithout), undefined, "1(d): absent from env and no home cache is undefined");

    // (e) four guards, four messages.
    const aFile = join(base, "a-file");
    writeFileSync(aFile, "x");
    assert.equal(
      mod.browserCache({ [BROWSER_ENV]: "relative/dir" }, homeWithout),
      undefined,
      "1(e): a relative value is ignored",
    );
    assert.equal(
      mod.browserCache({ [BROWSER_ENV]: aFile }, homeWithout),
      undefined,
      "1(e): a value naming a file is refused",
    );
    assert.equal(
      mod.browserCache({ [BROWSER_ENV]: join(base, "missing") }, homeWithout),
      undefined,
      "1(e): a value naming nothing is refused",
    );
    assert.equal(mod.browserCache({ [BROWSER_ENV]: "" }, homeWithout), undefined, "1(e): an empty string is refused");

    // (f) touches nothing else: no mutation, and never process.env.
    const frozen = Object.freeze({ [BROWSER_ENV]: other });
    assert.equal(mod.browserCache(frozen, homeWithout), other, "1(f): a frozen env is read without mutation");
    assert.deepEqual({ ...frozen }, { [BROWSER_ENV]: other }, "1(f): the env is unchanged after the call");
    const decoy = join(base, "decoy");
    mkdirSync(decoy);
    const had = Object.hasOwn(process.env, BROWSER_ENV);
    const old = process.env[BROWSER_ENV];
    process.env[BROWSER_ENV] = decoy;
    try {
      assert.equal(
        mod.browserCache({}, homeWithout),
        undefined,
        "1(f): process.env is never read: a decoy there does not resolve",
      );
      assert.equal(
        mod.browserCache({}, homeWith),
        realpathSync(join(homeWith, ".cache", "ms-playwright")),
        "1(f): process.env is never read: a decoy there does not win",
      );
    } finally {
      if (had) process.env[BROWSER_ENV] = old;
      else delete process.env[BROWSER_ENV];
    }
  });
}

if (runs(2)) {
  test("W-130 behaviour 2: the read-only mount and the one new environment name reach both cell descriptors", async () => {
    // (a) Genuine red: the module does not exist yet, as one assertion.
    const mod = await import("./host-cells.mjs").catch(() => undefined);
    assert.ok(mod?.browserMounts, "2(a): scripts/host-cells.mjs exports browserMounts");
    assert.ok(mod.builderCell, "2(a): scripts/host-cells.mjs exports builderCell");
    assert.ok(mod.replayCell, "2(a): scripts/host-cells.mjs exports replayCell");
    const PW = "/h/playwright";

    // (b) exactly one read-only entry and one name; empty-but-present when undefined.
    const mounted = mod.browserMounts(PW);
    assert.deepEqual(mounted.roBinds, [[PW, "/browsers"]], "2(b): exactly one read-only entry");
    assert.deepEqual(mounted.env, { [BROWSER_ENV]: "/browsers" }, "2(b): exactly one environment name");
    const unmounted = mod.browserMounts(undefined);
    assert.deepEqual(unmounted.roBinds, [], "2(b): no cache, no read-only entry");
    assert.deepEqual(unmounted.env, {}, "2(b): no cache, no environment name");
    assert.equal(typeof unmounted.log, "string", "2(b): the shape is present when undefined, never undefined");

    // (c) both descriptors carry it read-only: in roBinds exactly once, never in binds.
    const builder = mod.builderCell(builderPaths(PW));
    const replay = mod.replayCell(replayPaths(PW));
    for (const [name, cell] of [
      ["builderCell", builder],
      ["replayCell", replay],
    ]) {
      assert.equal(
        occurrences(JSON.stringify(cell.roBinds), /"\/browsers"/g),
        1,
        `2(c): ${name} binds /browsers read-only exactly once`,
      );
      assert.deepEqual(
        cell.roBinds.filter(([from]) => from === PW),
        [[PW, "/browsers"]],
        `2(c): ${name} roBinds carries [resolved, /browsers]`,
      );
      assert.equal(
        cell.binds.some(([, to]) => to === "/browsers"),
        false,
        `2(c): ${name} never binds /browsers writable`,
      );
    }

    // (d) the environment-name count and the name set, builder 19/18, replay 7+1.
    const absent = mod.builderCell(builderPaths(undefined));
    assert.equal(
      Object.keys(builder.env).length,
      19,
      "2(d): builderCell has 19 environment names with a resolved cache",
    );
    assert.equal(Object.keys(absent.env).length, 18, "2(d): builderCell has 18 environment names without a cache");
    assert.deepEqual(
      Object.keys(builder.env).sort(),
      [...BUILDER_ENV_NAMES, BROWSER_ENV].sort(),
      "2(d): the 19 are W-125's 18 plus the browsers path",
    );
    assert.deepEqual(Object.keys(absent.env).sort(), [...BUILDER_ENV_NAMES].sort(), "2(d): the 18 are W-125's own 18");
    assert.equal(builder.env[BROWSER_ENV], "/browsers", "2(d): the builder's browsers path is the fixed cell path");
    const replayAbsent = mod.replayCell(replayPaths(undefined));
    assert.deepEqual(
      Object.keys(replay.env).sort(),
      [...Object.keys(REPLAY_ENV), BROWSER_ENV].sort(),
      "2(d): replayCell's env is W-125's seven plus the browsers path",
    );
    assert.deepEqual(
      Object.keys(replayAbsent.env).sort(),
      Object.keys(REPLAY_ENV).sort(),
      "2(d): replayCell without a cache is W-125's seven",
    );

    // (e) nothing else moves: binds, chdir, other roBinds and env values equal W-125's literals.
    assert.deepEqual(builder.binds, BUILDER_BINDS, "2(e): builderCell binds are W-125's");
    assert.equal(builder.chdir, "/workspace", "2(e): builderCell chdir is W-125's");
    assert.deepEqual(
      builder.roBinds.filter(([, to]) => to !== "/browsers"),
      BUILDER_RO,
      "2(e): builderCell's other roBinds are W-125's",
    );
    assert.deepEqual(
      without(builder.env, BROWSER_ENV),
      builderEnv(),
      "2(e): builderCell's other env values are W-125's",
    );
    assert.deepEqual(absent.roBinds, BUILDER_RO, "2(e): builderCell without a cache is exactly W-125's roBinds");
    assert.deepEqual(replay.binds, REPLAY_BINDS, "2(e): replayCell binds are W-125's");
    assert.equal(replay.chdir, "/candidate", "2(e): replayCell chdir is W-125's");
    assert.deepEqual(
      replay.roBinds.filter(([, to]) => to !== "/browsers"),
      ETC,
      "2(e): replayCell's other roBinds are the private etc",
    );
    assert.deepEqual(without(replay.env, BROWSER_ENV), REPLAY_ENV, "2(e): replayCell's other env values are W-125's");
    assert.deepEqual(replayAbsent.roBinds, ETC, "2(e): replayCell without a cache is exactly W-125's roBinds");

    // (f) exactly one of the two log lines.
    const present = mod.browserMounts(PW).log;
    const none = mod.browserMounts(undefined).log;
    assert.match(
      present,
      /browser cache bound read-only at \/browsers from /,
      "2(f): the resolved case names the read-only bind",
    );
    assert.ok(present.includes(PW), "2(f): the resolved case names the resolved path");
    assert.match(none, /no playwright browser cache found/, "2(f): the absent case says so");
    assert.equal(
      /no playwright browser cache found/.test(present),
      false,
      "2(f): the resolved case never carries the absent line",
    );
    assert.equal(
      /browser cache bound read-only/.test(none),
      false,
      "2(f): the absent case never carries the resolved line",
    );
  });
}

// The transcripts of behaviour 4, inline, for 3(d)'s disjointness property.
const BANNER_1 = "Running 1 test using 1 worker\n";
const MATCHER =
  "  1) [chromium] > walk.spec.ts:10:1 > the walk\n\n    Error: expect(locator).toHaveCount(expected) failed\n\n";
const TRANSCRIPTS = [
  "TAP version 13\nnot ok 1 - a behaviour\n  ---\n  duration_ms: 3\n  ...\n1..1\n# fail 1\n",
  "AssertionError [ERR_ASSERTION]: boom\n",
  `${BANNER_1}\n${MATCHER}  1 failed\n`,
  `${BANNER_1}\n${MATCHER}  3 failed\n`,
  `${BANNER_1}\n${MATCHER}  3 failed\nnot ok 1 - setup\n`,
  `${BANNER_1}\n${MATCHER}  1 failed\nAssertionError [ERR_ASSERTION]: spawned server\n`,
  `${BANNER_1}\n${MATCHER}  2 failed\n\n${MATCHER}  1 failed\n`,
  "Running 1 test using 1 worker\n\n  Error: browserType.launch: Executable doesn't exist at /a/b/c\n\n  1 failed\n",
  "Running 1 test using 1 worker\n\n  Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/\n\n  1 failed\n",
  BANNER_1,
  `${BANNER_1}\n  1 passed (2s)\n`,
  "Error: No tests found.\n",
  "not ok 1 - x\nCannot find module './x.js'\n",
  "not ok 1 - x\nENOENT: no such file\n",
  "TAP version 13\nnot ok 1 - x\n# fail 1\n1 failed\n",
  "",
];

if (runs(3)) {
  test("W-130 behaviour 3: replay preparation's command is fixed and its failures are a disjoint message class", async () => {
    // (a) Genuine red: the module does not exist yet, as one assertion.
    const mod = await import("./host-cells.mjs").catch(() => undefined);
    assert.ok(mod?.WEB_BUILD, "3(a): scripts/host-cells.mjs exports WEB_BUILD");
    assert.ok(mod.WEB_BUNDLE, "3(a): scripts/host-cells.mjs exports WEB_BUNDLE");
    assert.ok(mod.prepFailure, "3(a): scripts/host-cells.mjs exports prepFailure");

    // (b) the argv is a literal, and the bundle path is the one the build must leave.
    assert.deepEqual(
      mod.WEB_BUILD,
      ["npm", "--workspace", "@bisellium/web", "run", "build"],
      "3(b): WEB_BUILD is the fixed literal argv",
    );
    assert.equal(
      mod.WEB_BUNDLE.join("/"),
      "apps/web/dist/index.html",
      "3(b): WEB_BUNDLE names apps/web/dist/index.html",
    );

    // (c) three messages, each prefixed and each naming its own cause.
    const exited = mod.prepFailure(7, "exit", 3);
    const spawned = mod.prepFailure(7, "spawn");
    const bundled = mod.prepFailure(7, "bundle");
    for (const [name, message] of [
      ["exit", exited],
      ["spawn", spawned],
      ["bundle", bundled],
    ])
      assert.match(
        message,
        /^red 7 replay preparation failed: /,
        `3(c): the ${name} message carries the preparation prefix and the behaviour`,
      );
    assert.match(exited, /web bundle build exited 3/, "3(c): a nonzero exit names its status");
    assert.match(spawned, /web bundle build could not be spawned/, "3(c): a spawn failure names itself");
    assert.ok(bundled.includes("apps/web/dist/index.html"), "3(c): the absent bundle names apps/web/dist/index.html");
    assert.equal(new Set([exited, spawned, bundled]).size, 3, "3(c): the three messages are distinct");

    // (d) the two message classes are disjoint, as a property over the whole table.
    const accept = await import("./replay-accept.mjs").catch(() => undefined);
    assert.ok(accept?.classifyReplay, "3(d): scripts/replay-accept.mjs exports classifyReplay");
    for (const message of [exited, spawned, bundled])
      assert.equal(
        /did not reproduce its assertion failure/.test(message),
        false,
        `3(d): a preparation message is never a refused red: ${message}`,
      );
    for (const output of TRANSCRIPTS)
      for (const status of [0, 1, null]) {
        const { reason } = accept.classifyReplay({ status, output });
        assert.equal(
          /replay preparation failed/.test(reason),
          false,
          `3(d): a classifier reason is never a preparation failure: ${reason}`,
        );
      }

    // (e) the build step's descriptor is the replay's own.
    const replayA = mod.replayCell(replayPaths("/h/playwright"));
    const replayB = mod.replayCell(replayPaths("/h/playwright"));
    assert.deepEqual(replayA, replayB, "3(e): replayCell is deterministic for one input");
    const runner = readFileSync(RUNNER, "utf8");
    assert.equal(
      occurrences(runner, /const cell = replayCell\(/g),
      1,
      "3(e): the runner builds one const cell from replayCell",
    );
    assert.equal(occurrences(runner, /\.\.\.cell\b/g), 2, "3(e): the runner spreads that one cell exactly twice");
    sourceHas(
      runner,
      /sandboxArgs\(\{\s*\.\.\.cell,\s*cmd:\s*WEB_BUILD\s*\}\)/,
      "3(e): the build is launched through the replay's own cell",
    );
    sourceHas(
      runner,
      /sandboxArgs\(\{\s*\.\.\.cell,\s*cmd:\s*commandText\b/,
      "3(e): the replay is launched through the same cell",
    );

    // (f) the build is attempted only behind a fixed host path, never a candidate script name.
    assert.ok(
      runner.includes('existsSync(join(checkout, "apps", "web", "package.json"))'),
      "3(f): the build is gated on the fixed apps/web/package.json path",
    );
    assert.equal(
      /\.scripts\b|\["scripts"\]/.test(runner),
      false,
      "3(f): the runner reads no script name from a candidate package.json",
    );
  });
}

if (runs(5)) {
  test("W-130 behaviour 5: the runner is wired to both modules, and keeps nothing of what they replaced", () => {
    const runner = readFileSync(RUNNER, "utf8");

    // (a) passes today: the W-125 anchors this opus must not disturb are still there.
    for (const anchor of ["bisellium-probe-index", "validateGitArgs", "teardownAll", "bundle", "unbundle"])
      assert.ok(runner.includes(anchor), `5(a): the runner still contains the W-125 anchor ${anchor}`);

    // (b) Genuine red: classifyReplay is imported, and the inline predicate is gone.
    sourceHas(
      runner,
      /import\s*\{[^}]*\bclassifyReplay\b[^}]*\}\s*from\s*"\.\/replay-accept\.mjs"/,
      "5(b): the runner imports classifyReplay from ./replay-accept.mjs",
    );
    assert.equal(
      runner.includes("not ok|AssertionError|ERR_ASSERTION"),
      false,
      "5(b): the inline acceptance regex is gone from the runner",
    );
    assert.equal(
      runner.includes("ERR_MODULE_NOT_FOUND"),
      false,
      "5(b): the inline poison list is gone from the runner",
    );
    assert.equal(runner.includes("permission denied"), false, "5(b): no poison literal survives in the runner");

    // (c) the call is the specified one, and the reason reaches the thrown message.
    sourceHas(
      runner,
      /classifyReplay\(\{\s*status: replay\.status,\s*output\s*\}\)/,
      "5(c): the runner calls classifyReplay({ status, output })",
    );
    sourceHas(
      runner,
      /did not reproduce its assertion failure: \$\{verdict\.reason\}/,
      "5(c): the thrown message interpolates verdict.reason",
    );

    // (d) the cell helpers come from host-cells.mjs; the runner keeps no second copy.
    const imported = runner.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/host-cells\.mjs"/)?.[1] ?? "";
    for (const name of [
      "browserCache",
      "browserMounts",
      "builderCell",
      "replayCell",
      "WEB_BUILD",
      "WEB_BUNDLE",
      "prepFailure",
    ])
      assert.match(imported, new RegExp(`\\b${name}\\b`), `5(d): the runner imports ${name} from ./host-cells.mjs`);
    assert.equal(
      occurrences(runner, /PLAYWRIGHT_BROWSERS_PATH/g),
      0,
      "5(d): the runner carries the browsers variable zero times",
    );
    assert.equal(
      runner.includes("ms-playwright"),
      false,
      "5(d): the runner carries no second copy of the cache resolution",
    );
    for (const name of ["browserMounts", "builderCell", "replayCell"])
      assert.ok(occurrences(runner, new RegExp(`\\b${name}\\(`, "g")) >= 1, `5(d): the runner calls ${name}`);

    // (e) the log line reaches stderr from the runner, exactly once.
    assert.equal(
      occurrences(runner, /process\.stderr\.write\([^;]*\.log\b/g),
      1,
      "5(e): the runner writes the mounts' log to stderr exactly once",
    );

    // (f) no .exec()/.test() on the global summary regex survives anywhere.
    assert.ok(existsSync(ACCEPT), "5(f): scripts/replay-accept.mjs exists");
    const accept = readFileSync(ACCEPT, "utf8");
    assert.equal(
      /PW_SUMMARY\.(?:exec|test)\(/.test(runner),
      false,
      "5(f): the runner never execs or tests the global summary regex",
    );
    assert.equal(
      /PW_SUMMARY\.(?:exec|test)\(/.test(accept),
      false,
      "5(f): replay-accept.mjs never execs or tests the global summary regex",
    );
  });
}
