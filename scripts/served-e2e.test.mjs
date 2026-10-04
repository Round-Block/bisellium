/**
 * scripts/served-e2e.test.mjs — W-110 behaviour 5: `scripts/served-e2e.mjs`
 * runs the walk once, in a cleared shots directory, and writes the manifest
 * file. node:test TAP; `--behaviour 5` selects the one test. Plain node (no
 * tsx): the script is spawned the way `node` will run it, with a stub `npm`
 * first on PATH that records its argv and BISELLIUM_SHOTS_DIR and writes the
 * PNGs a row asks for. `redact` is imported from its own source file, which
 * has no imports and so loads under plain node.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { redact } from "../packages/shim/src/redact.ts";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && only !== 5) {
  console.error("served-e2e.test.mjs: --behaviour must be 5");
  process.exit(2);
}

const SCRIPT = fileURLToPath(new URL("./served-e2e.mjs", import.meta.url));

const dirs = [];
function scratch(tag) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w110-${tag}-`)));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// The stub `npm`: logs its argv (one element per line) and BISELLIUM_SHOTS_DIR, writes the
// PNGs named in STUB_PNGS (a JSON array of [name, width, height]) into BISELLIUM_SHOTS_DIR,
// and exits with STUB_EXIT.
const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const lines = process.argv.slice(2);
lines.push("SHOTS_DIR=" + (process.env.BISELLIUM_SHOTS_DIR ?? ""));
lines.push("---");
fs.appendFileSync(process.env.STUB_LOG, lines.join("\\n") + "\\n");
const dir = process.env.BISELLIUM_SHOTS_DIR;
for (const [name, w, h] of JSON.parse(process.env.STUB_PNGS ?? "[]")) {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "latin1");
  png.writeUInt32BE(w, 16);
  png.writeUInt32BE(h, 20);
  fs.writeFileSync(path.join(dir, name), png);
}
process.exit(Number(process.env.STUB_EXIT ?? 0));
`;

/** Runs served-e2e.mjs with the stub npm; `env` entries set to undefined are removed. */
function runScript(tag, env, { exit = 0, pngs = [], plant } = {}) {
  const work = scratch(tag);
  const bin = join(work, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npm"), STUB);
  chmodSync(join(bin, "npm"), 0o755);
  const log = join(work, "stub.log");
  const childEnv = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    STUB_LOG: log,
    STUB_EXIT: String(exit),
    STUB_PNGS: JSON.stringify(pngs),
  };
  delete childEnv.BISELLIUM_OPUS;
  delete childEnv.BISELLIUM_STUDIO_DIR;
  delete childEnv.BISELLIUM_SHOTS_DIR;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  if (plant) plant();
  const r = spawnSync(process.execPath, [SCRIPT], { env: childEnv, encoding: "utf8" });
  const logged = existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => l !== "")
    : [];
  const invocations = [];
  let cur = [];
  for (const l of logged) {
    if (l === "---") {
      invocations.push(cur);
      cur = [];
    } else cur.push(l);
  }
  const shotsDirs = invocations.map((inv) =>
    (inv.find((l) => l.startsWith("SHOTS_DIR=")) ?? "").slice("SHOTS_DIR=".length),
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", invocations, shotsDirs };
}

const manifestLines = (stdout) => stdout.split("\n").filter((l) => /^shots?:/.test(l));
const longestRun = (line) => Math.max(0, ...(line.match(/[A-Za-z0-9+/_-]+/g) ?? []).map((m) => m.length));

if (only === undefined || only === 5) {
  test("W-110 behaviour 5: served-e2e.mjs runs the walk once, in a cleared shots directory, and writes the manifest file", () => {
    // (a) passes today: the child's exit code is the script's.
    const ok = runScript("a0", {}, { exit: 0 });
    assert.equal(ok.status, 0, "(a) stub exiting 0 gives script exit 0");
    const bad = runScript("a3", {}, { exit: 3 });
    assert.equal(bad.status, 3, "(a) stub exiting 3 gives script exit 3");

    // (b) passes today: the walk is `npm --workspace @bisellium/web run test:serve`.
    const wanted = ["--workspace", "@bisellium/web", "run", "test:serve"];
    const flat = ok.invocations.map((inv) => inv.join("\n"));
    assert.ok(
      flat.some((inv) => inv.includes(wanted.join("\n"))),
      `(b) one logged npm invocation carries ${wanted.join(" ")} in order`,
    );

    // (c) Genuine red: the manifest file, its text, the stdout echo and the shots dir variable.
    const studio = scratch("c-studio");
    const c = runScript(
      "c",
      { BISELLIUM_OPUS: "W-X", BISELLIUM_STUDIO_DIR: studio },
      {
        pngs: [
          ["board.png", 1280, 900],
          ["inbox.png", 1280, 1024],
        ],
      },
    );
    const manifestPath = join(studio, "ci", "shots", "W-X", "manifest.txt");
    const manifestText = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : undefined;
    assert.ok(manifestText, "(c) <studio>/ci/shots/W-X/manifest.txt exists");
    const size = (n) => statSync(join(studio, "ci", "shots", "W-X", n)).size;
    const expected = [
      "shots: 2 ci/shots/W-X",
      `shot: board.png 1280x900 ${size("board.png")}`,
      `shot: inbox.png 1280x1024 ${size("inbox.png")}`,
    ];
    assert.deepEqual(
      manifestText.split("\n").filter((l) => l !== ""),
      expected,
      "(c) manifest.txt holds exactly the header and the two shot lines",
    );
    assert.deepEqual(manifestLines(c.stdout), expected, "(c) stdout echoes the same three lines");
    assert.deepEqual(
      c.shotsDirs,
      [join(studio, "ci", "shots", "W-X")],
      "(c) BISELLIUM_SHOTS_DIR is <studio>/ci/shots/W-X",
    );

    // (d) a previous run's files are cleared, and nothing stale is passed off as this run's.
    const dStudio = scratch("d-studio");
    const dDir = join(dStudio, "ci", "shots", "W-X");
    const d = runScript(
      "d",
      { BISELLIUM_OPUS: "W-X", BISELLIUM_STUDIO_DIR: dStudio },
      {
        pngs: [["board.png", 1280, 900]],
        plant: () => {
          mkdirSync(dDir, { recursive: true });
          writeFileSync(join(dDir, "stale.png"), "stale");
          writeFileSync(join(dDir, "manifest.txt"), "PLANTED STALE MANIFEST\n");
        },
      },
    );
    assert.equal(existsSync(join(dDir, "stale.png")), false, "(d) the planted stale.png is gone");
    const dManifest = existsSync(join(dDir, "manifest.txt")) ? readFileSync(join(dDir, "manifest.txt"), "utf8") : "";
    assert.ok(!dManifest.includes("PLANTED STALE MANIFEST"), "(d) the planted manifest.txt is gone");
    assert.ok(
      !dManifest.includes("stale.png") && !d.stdout.includes("stale.png"),
      "(d) stale.png appears in no manifest line",
    );

    // (e) a green walk with no screenshot is a failure and writes no manifest.
    const eStudio = scratch("e-studio");
    const eDir = join(eStudio, "ci", "shots", "W-X");
    const e = runScript(
      "e",
      { BISELLIUM_OPUS: "W-X", BISELLIUM_STUDIO_DIR: eStudio },
      {
        plant: () => {
          mkdirSync(eDir, { recursive: true });
          writeFileSync(join(eDir, "manifest.txt"), "PLANTED STALE MANIFEST\n");
        },
      },
    );
    assert.notEqual(e.status, 0, "(e) exit is nonzero when the stub exits 0 but writes no PNG");
    assert.equal(existsSync(join(eDir, "manifest.txt")), false, "(e) no manifest.txt is left behind");

    // (f) no environment: a bare manual run makes no evidence claim.
    const fStudio = scratch("f-studio");
    const f = runScript("f", {}, { exit: 5 });
    assert.equal(f.status, 5, "(f) the exit code is still the child's");
    assert.ok(
      (f.shotsDirs[0] ?? "").endsWith("apps/web/test-results/shots"),
      "(f) BISELLIUM_SHOTS_DIR ends apps/web/test-results/shots",
    );
    assert.deepEqual(manifestLines(f.stdout), ["shots: none"], "(f) stdout's only manifest output is `shots: none`");
    assert.deepEqual(readdirSync(fStudio), [], "(f) nothing is written under a studio dir");

    // (g) the redact boundary, at the limit.
    const id22 = "a".repeat(22);
    const name22 = "abcdefghijklmnopqrstuv";
    assert.equal(name22.length, 22);
    const gStudio = scratch("g-studio");
    const g = runScript(
      "g",
      { BISELLIUM_OPUS: id22, BISELLIUM_STUDIO_DIR: gStudio },
      { pngs: [[`${name22}.png`, 1280, 900]] },
    );
    const gManifest = join(gStudio, "ci", "shots", id22, "manifest.txt");
    assert.ok(existsSync(gManifest), "(g) a manifest is written for a 22-character id and name");
    const lines = [...readFileSync(gManifest, "utf8").split("\n"), ...manifestLines(g.stdout)].filter((l) => l !== "");
    assert.ok(lines.length >= 4, "(g) the manifest and stdout carry the header and the shot line each");
    for (const l of lines) assert.equal(redact(l), l, `(g) redact leaves ${JSON.stringify(l)} unchanged`);
    assert.equal(Math.max(...lines.map(longestRun)), 31, "(g) the longest [A-Za-z0-9+/_-] run in any line is 31");
    const control = `shots: 2 ci/shots/${"a".repeat(23)}`;
    assert.notEqual(redact(control), control, "(g) negative control: a 23-character id is changed by redact");

    // (h) exactly one npm is spawned.
    assert.equal(c.invocations.length, 1, "(h) exactly one npm invocation");

    // (i) an id that fails the grammar is treated as absent.
    for (const [label, id] of [
      ["../escape", "../escape"],
      ["23 chars", "b".repeat(23)],
    ]) {
      const iStudio = scratch("i-studio");
      const i = runScript("i", { BISELLIUM_OPUS: id, BISELLIUM_STUDIO_DIR: iStudio });
      assert.ok(
        (i.shotsDirs[0] ?? "").endsWith("apps/web/test-results/shots"),
        `(i) ${label}: the shots directory is the test-results one`,
      );
      assert.deepEqual(manifestLines(i.stdout), ["shots: none"], `(i) ${label}: the output is \`shots: none\``);
      assert.deepEqual(readdirSync(iStudio), [], `(i) ${label}: nothing is written under the studio`);
    }

    // (j) a malformed shot name, and 65 shots, each fail with no manifest.
    const names65 = Array.from({ length: 65 }, (_, n) => [`s${String(n).padStart(2, "0")}.png`, 1280, 900]);
    for (const [label, pngs] of [
      ["a malformed name", [["Bad_Name.png", 1280, 900]]],
      ["65 shots", names65],
    ]) {
      const jStudio = scratch("j-studio");
      const j = runScript("j", { BISELLIUM_OPUS: "W-X", BISELLIUM_STUDIO_DIR: jStudio }, { pngs });
      assert.notEqual(j.status, 0, `(j) ${label}: the script exits nonzero`);
      assert.equal(
        existsSync(join(jStudio, "ci", "shots", "W-X", "manifest.txt")),
        false,
        `(j) ${label}: no manifest.txt is written`,
      );
    }

    // (k) a symlink on the path from the studio to the shots directory is refused before anything is
    // cleared, created or written: the external target is untouched and the walk never starts.
    for (const [label, linkAt] of [
      ["ci", ["ci"]],
      ["ci/shots", ["ci", "shots"]],
      ["ci/shots/W-X", ["ci", "shots", "W-X"]],
    ]) {
      const kStudio = scratch("k-studio");
      const outside = scratch("k-outside");
      const rel = linkAt.join("/");
      // The external tree mirrors what the script would clear: <outside>/<rest>/keep.png (+ W-X for a shorter link).
      const rest = ["ci", "shots", "W-X"].slice(linkAt.length);
      const victim = join(outside, ...rest);
      mkdirSync(victim, { recursive: true });
      writeFileSync(join(victim, "keep.png"), "keep");
      const before = readdirSync(outside, { recursive: true }).sort();
      const k = runScript(
        "k",
        { BISELLIUM_OPUS: "W-X", BISELLIUM_STUDIO_DIR: kStudio },
        {
          pngs: [["board.png", 1280, 900]],
          plant: () => {
            mkdirSync(join(kStudio, ...linkAt.slice(0, -1)), { recursive: true });
            symlinkSync(outside, join(kStudio, rel));
          },
        },
      );
      assert.notEqual(k.status, 0, `(k) a symlinked ${label} makes the script exit nonzero`);
      assert.equal(k.invocations.length, 0, `(k) a symlinked ${label}: the walk is never started`);
      assert.equal(existsSync(join(victim, "keep.png")), true, `(k) a symlinked ${label}: the external file survives`);
      assert.deepEqual(
        readdirSync(outside, { recursive: true }).sort(),
        before,
        `(k) a symlinked ${label}: nothing is added to or removed from the external tree`,
      );
    }
  });
}
