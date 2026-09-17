/**
 * packages/pipeline/test/pipeline.test.ts — W-009 (automated probationes:
 * verify). End to end against a temp git repo containing a studio:
 * `bisellium verify` runs the local pipeline and writes results back into
 * an opus, touching only the automated probationes and leaving every other
 * key and the body byte-for-byte alone. `now` is pinned so nothing here
 * depends on the wall clock.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { initStudio } from "../../cli/src/init.js";
import { newItem } from "../../cli/src/new.js";
import { runVerify } from "../../cli/src/verify.js";
import { checkStudio } from "../../cli/src/check.js";
import { sourceTreeHash } from "../../shim/src/index.js";

const NOW = new Date("2026-09-18T09:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
};

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/** Front-matter split that keeps the body byte-for-byte, same as verify.ts's own. */
function splitFront(raw: string): { front: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.replace(/^﻿/, ""));
  if (!m) throw new Error("missing front matter");
  return { front: m[1] ?? "", body: m[2] ?? "" };
}

const repo = mkdtempSync(join(tmpdir(), "bisellium-pipeline-"));

try {
  const studio = join(repo, "studio");

  // ---- scaffold: init, add automated probationes with commands, one opus ----
  const init = initStudio(studio, { now: NOW });
  check("init: temp studio created", init.ok, init.message);

  const manifestPath = join(studio, "bisellium.yml");
  const manifest = parseYaml(readFileSync(manifestPath, "utf8")) as { probationes: { id: string; name: string; kind: string; command?: string }[] };
  manifest.probationes.push({ id: "tests", name: "Tests", kind: "automated", command: "true" });
  manifest.probationes.push({ id: "lint", name: "Lint", kind: "automated", command: "false" });
  // Re-emit as flow-mapping YAML — a plain YAML.stringify would be equally
  // valid; this just keeps the manifest readable like the rest of the repo's.
  const collegia = 'collegia:\n  - { id: production, name: Production, magister: producer, lex: leges/production.md }\n';
  const sellae = 'sellae:\n  - { id: producer, collegium: production, kind: agent }\n';
  const probationesYaml =
    "probationes:\n" + manifest.probationes.map((p) => `  - { id: ${p.id}, name: ${JSON.stringify(p.name)}, kind: ${p.kind}${p.command !== undefined ? `, command: ${JSON.stringify(p.command)}` : ""} }`).join("\n") + "\n";
  writeFileSync(
    manifestPath,
    `bisellium: 1\nstudio: "studio"\npatron: patron\ntimezone: "UTC"\n${collegia}${sellae}${probationesYaml}wip_limit: 1\n`,
  );

  const created = newItem(studio, { kind: "task", collegium: "production", title: "Verify seam" });
  check("new: opus created", created.ok && created.id === "W-001", created.message);
  const opusPath = join(studio, "opera", "W-001.md");
  const rawBefore = readFileSync(opusPath, "utf8");
  const beforeSplit = splitFront(rawBefore);
  const dataBefore = parseYaml(beforeSplit.front) as Record<string, unknown>;

  // A real source file OUTSIDE the studio dir — without one, this repo's
  // entire tracked tree is the studio, and excluding it (see below) would
  // make every SOURCE tree hash the well-known empty-tree sha1, which
  // wouldn't actually exercise the "a change to a source file trips the
  // dirty guard" property later in this file.
  const srcFile = join(repo, "src.txt");
  const srcContent = "hello\n";
  writeFileSync(srcFile, srcContent);

  // ---- commit the scaffold so the SOURCE tree hash has something to resolve ----
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "init"]);
  // The SOURCE tree hash (@bisellium/shim's sourceTreeHash) excludes the
  // studio dir and .bisellium/ — this is what `verify` certifies against,
  // not `git rev-parse HEAD^{tree}` (which would include the studio's own
  // bookkeeping and so change every time `verify` commits its own writes).
  const expectedTree = sourceTreeHash(repo, ["studio", ".bisellium"]);

  // ---- runVerify: tests ('true') passes, lint ('false') fails ---------------
  const result = await runVerify(["W-001", "--studio", studio, "--repo", repo, "--now", NOW.toISOString()]);
  check("runVerify: exits 1 (lint failed)", result.exitCode === 1, String(result.exitCode));

  const rawAfter = readFileSync(opusPath, "utf8");
  const afterSplit = splitFront(rawAfter);
  const dataAfter = parseYaml(afterSplit.front) as Record<string, unknown>;
  const probationesAfter = dataAfter["probationes"] as Record<string, { status: string; evidence: string; certifies: string }>;

  check("verify: tests passed", probationesAfter["tests"]?.status === "passed", JSON.stringify(probationesAfter["tests"]));
  check("verify: lint failed", probationesAfter["lint"]?.status === "failed", JSON.stringify(probationesAfter["lint"]));
  check(
    "verify: certifies matches git's tree hash",
    probationesAfter["tests"]?.certifies === `tree:${expectedTree}` && probationesAfter["lint"]?.certifies === `tree:${expectedTree}`,
    `expected tree:${expectedTree}, got ${probationesAfter["tests"]?.certifies} / ${probationesAfter["lint"]?.certifies}`,
  );
  const testsEvidence = probationesAfter["tests"] ? join(studio, probationesAfter["tests"].evidence) : "";
  const lintEvidence = probationesAfter["lint"] ? join(studio, probationesAfter["lint"].evidence) : "";
  check("verify: tests evidence file exists", existsSync(testsEvidence), testsEvidence);
  check("verify: lint evidence file exists", existsSync(lintEvidence), lintEvidence);

  // ---- body and every other key are untouched --------------------------------
  check("verify: body unchanged, byte-for-byte", afterSplit.body === beforeSplit.body, JSON.stringify({ before: beforeSplit.body, after: afterSplit.body }));
  const { probationes: _pb, ...restBefore } = dataBefore;
  const { probationes: _pa, ...restAfter } = dataAfter;
  check("verify: keys other than probationes unchanged", JSON.stringify(restBefore) === JSON.stringify(restAfter), `${JSON.stringify(restBefore)} vs ${JSON.stringify(restAfter)}`);

  // ---- checkStudio afterwards has no blocking probatio.* findings ------------
  const afterCheck = checkStudio(studio, NOW, { repo });
  const probatioBlocks = afterCheck.findings.filter((f) => f.level === "block" && f.rule.startsWith("probatio."));
  check("checkStudio: no blocking probatio.* findings", probatioBlocks.length === 0, JSON.stringify(probatioBlocks));

  // ---- verifying twice in a row works ----------------------------------------
  // The first `runVerify` above just wrote opera/W-001.md and ci/*.log —
  // both under the studio dir. Those writes must never make the SOURCE tree
  // "dirty": a second verify, with no --allow-dirty, must succeed exactly
  // like the first, and certify the SAME hash (nothing outside the studio
  // changed in between).
  const secondResult = await runVerify(["W-001", "--studio", studio, "--repo", repo, "--now", NOW.toISOString()]);
  check(
    "verify: running verify again right after itself needs no --allow-dirty",
    secondResult.exitCode === 1,
    String(secondResult.exitCode),
  );
  const afterSecondDoc = parseYaml(splitFront(readFileSync(opusPath, "utf8")).front) as Record<string, unknown>;
  const afterSecondGates = afterSecondDoc["probationes"] as Record<string, { certifies: string }>;
  check(
    "verify: a second run right after the first certifies the same tree:<hash>",
    afterSecondGates["tests"]?.certifies === `tree:${expectedTree}` && afterSecondGates["lint"]?.certifies === `tree:${expectedTree}`,
    JSON.stringify(afterSecondGates),
  );

  // ---- a change under studio/ does not trip the dirty guard ------------------
  const studioScratchFile = join(studio, "scratch-not-a-real-convention-file.txt");
  writeFileSync(studioScratchFile, "just studio bookkeeping, not source\n");
  const studioChangeResult = await runVerify(["W-001", "--studio", studio, "--repo", repo, "--now", NOW.toISOString()]);
  check(
    "verify: an uncommitted change under studio/ does not require --allow-dirty",
    studioChangeResult.exitCode === 1,
    String(studioChangeResult.exitCode),
  );
  rmSync(studioScratchFile, { force: true });

  // ---- merge, don't replace: a waived gate with sibling keys and comments ----
  // survives byte-for-byte except the three tool-written keys; an
  // already-waived gate is never touched (its command is not even run).
  const waivedOpusPath = join(studio, "opera", "W-002.md");
  const waivedFixture = `---
id: W-002
title: Fixture with a waived gate
kind: task
collegium: production
sella: producer
state: building
probationes:
  tests:
    status: waived
    waived_by: producer
    reason: flaky on this sandbox
    note: |
      Known flaky; owner: producer.
      Revisit before ship.
  lint: { status: pending } # will run for real
traditio: { sella: producer, stage: building, next: fix flake, blocked_on: none, at: 2026-09-18T09:00:00Z }
---
Body text, byte-for-byte.
`;
  writeFileSync(waivedOpusPath, waivedFixture);
  const waivedRawBefore = readFileSync(waivedOpusPath, "utf8");

  const waivedResult = await runVerify(["W-002", "--studio", studio, "--repo", repo, "--now", NOW.toISOString()]);
  check("verify (waived fixture): exits 1 (lint still fails)", waivedResult.exitCode === 1, String(waivedResult.exitCode));

  const waivedRawAfter = readFileSync(waivedOpusPath, "utf8");
  check(
    "verify (waived fixture): 'tests' gate untouched byte-for-byte (waived_by/reason/note survive)",
    waivedRawAfter.includes("waived_by: producer") &&
      waivedRawAfter.includes("reason: flaky on this sandbox") &&
      waivedRawAfter.includes("Known flaky; owner: producer.") &&
      /tests:\s*\n\s*status: waived/.test(waivedRawAfter),
    waivedRawAfter,
  );
  check(
    "verify (waived fixture): inline comment on 'lint' survives",
    waivedRawAfter.includes("# will run for real"),
    waivedRawAfter,
  );
  const waivedDoc = parseYaml(splitFront(waivedRawAfter).front) as Record<string, unknown>;
  const waivedGates = waivedDoc["probationes"] as Record<string, { status: string }>;
  check("verify (waived fixture): 'lint' gate actually ran (no longer pending)", waivedGates["lint"]?.status === "failed", JSON.stringify(waivedGates["lint"]));
  check(
    "verify (waived fixture): body unchanged, byte-for-byte",
    splitFront(waivedRawAfter).body === splitFront(waivedRawBefore).body,
  );

  // ---- honest certifies: a change to a SOURCE file trips the dirty guard -----
  // (a change under studio/ was already shown above NOT to trip it.)
  writeFileSync(srcFile, "hello, but edited and never committed\n");
  try {
    const dirtyRefused = await runVerify(["W-001", "--studio", studio, "--repo", repo, "--now", NOW.toISOString()]);
    check("verify: an uncommitted source-file change exits 2 without --allow-dirty", dirtyRefused.exitCode === 2, String(dirtyRefused.exitCode));

    const dirtyAllowed = await runVerify(["W-001", "--studio", studio, "--repo", repo, "--now", NOW.toISOString(), "--allow-dirty"]);
    check("verify --allow-dirty: exits 1 (lint still fails)", dirtyAllowed.exitCode === 1, String(dirtyAllowed.exitCode));
    const afterDirtyDoc = parseYaml(splitFront(readFileSync(opusPath, "utf8")).front) as Record<string, unknown>;
    const afterDirtyGates = afterDirtyDoc["probationes"] as Record<string, { certifies: string }>;
    check(
      "verify --allow-dirty: certifies is dirty:<hash>, never tree:<hash>",
      afterDirtyGates["tests"]?.certifies === `dirty:${expectedTree}` && afterDirtyGates["lint"]?.certifies === `dirty:${expectedTree}`,
      JSON.stringify(afterDirtyGates),
    );
  } finally {
    writeFileSync(srcFile, srcContent);
  }

  // ---- an unparseable sibling opus: verify fails cleanly, never a stack trace ----
  const garbagePath = join(studio, "opera", "garbage.md");
  writeFileSync(garbagePath, "---\nid: [this is not valid yaml\n---\nbody\n");
  const originalConsoleError = console.error;
  let capturedErr = "";
  console.error = (...args: unknown[]) => {
    capturedErr += args.map(String).join(" ") + "\n";
  };
  let garbageResult: { exitCode: number };
  try {
    garbageResult = await runVerify(["W-001", "--studio", studio, "--repo", repo, "--now", NOW.toISOString(), "--allow-dirty"]);
  } finally {
    console.error = originalConsoleError;
    rmSync(garbagePath, { force: true });
  }
  check("verify with garbage sibling opus: exits 2", garbageResult.exitCode === 2, String(garbageResult.exitCode));
  check(
    "verify with garbage sibling opus: no stack trace on stderr",
    !/\n\s*at\s+\S+.*:\d+:\d+/.test(capturedErr) && !capturedErr.includes(".js:"),
    JSON.stringify(capturedErr),
  );
} finally {
  rmSync(repo, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
