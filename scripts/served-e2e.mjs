#!/usr/bin/env node
// The reserved `served-e2e` gate command (W-096, W-110): runs the served suite once and, when `verify` told it
// which opus and officina it runs for, writes the screenshot manifest the check rule re-verifies.
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_SHOTS = 64;
const OPUS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,21}$/; // 22 characters: the measured `redact` boundary (see the brief)
const SHOT = /^[a-z][a-z0-9-]{0,21}\.png$/;

const opus = process.env.BISELLIUM_OPUS;
const studio = process.env.BISELLIUM_STUDIO_DIR;
const claims = opus !== undefined && studio !== undefined && OPUS.test(opus) && isAbsolute(studio);
const shotsRel = claims ? `ci/shots/${opus}` : undefined;
const shotsDir = claims ? join(studio, shotsRel) : join(repo, "apps", "web", "test-results", "shots");

// No component between the officina and the shots directory may be a symlink: the recursive clear, the child's
// screenshot writes and the manifest write would all follow it out of `<studio>/ci/shots/<opus>/` (checked again
// after the walk, before the directory is listed, read or written).
function refuseSymlinks() {
  if (shotsRel === undefined) return;
  let at = studio;
  const parts = shotsRel.split("/");
  for (const [n, part] of parts.entries()) {
    at = join(at, part);
    let stat;
    try {
      stat = lstatSync(at);
    } catch (error) {
      if (error.code === "ENOENT") return; // nothing below a missing component exists yet
      throw error;
    }
    if (stat.isSymbolicLink()) {
      console.error(`served-e2e: refusing a symlink at ${parts.slice(0, n + 1).join("/")}`);
      process.exit(1);
    }
  }
}
refuseSymlinks();

// A PNG or manifest from a previous run can never be passed off as this run's.
rmSync(shotsDir, { recursive: true, force: true });
mkdirSync(shotsDir, { recursive: true });

// The served config's globalSetup builds the bundle first; this script no longer builds separately.
const run = spawnSync("npm", ["--workspace", "@bisellium/web", "run", "test:serve"], {
  cwd: repo,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, BISELLIUM_SHOTS_DIR: shotsDir },
});
if (run.error) console.error(run.error.message);
const code = run.status ?? 1;
refuseSymlinks();

const names = readdirSync(shotsDir)
  .filter((name) => name.endsWith(".png"))
  .sort();
if (names.length > MAX_SHOTS || names.some((name) => !SHOT.test(name))) {
  console.error(`served-e2e: ${names.length} screenshots, or a name outside ${SHOT}`);
  process.exit(code || 1);
}
if (shotsRel === undefined) {
  console.log("shots: none"); // a bare manual run makes no evidence claim
  process.exit(code);
}
if (names.length === 0) {
  console.error("served-e2e: the walk produced no screenshot");
  process.exit(code || 1);
}

// The PNG header is read here and again, independently, by the check rule (it re-derives, never trusts).
const lines = [`shots: ${names.length} ${shotsRel}`];
for (const name of names) {
  const bytes = readFileSync(join(shotsDir, name));
  lines.push(`shot: ${name} ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)} ${bytes.length}`);
}
const text = lines.join("\n");
writeFileSync(join(shotsDir, "manifest.txt"), `${text}\n`);
console.log(text);
process.exit(code);
