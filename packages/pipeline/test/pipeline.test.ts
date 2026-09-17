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

  // ---- commit the scaffold so `git rev-parse HEAD^{tree}` has something to resolve ----
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "init"]);
  const expectedTree = git(repo, ["rev-parse", "HEAD^{tree}"]).trim();

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

  const waivedResult = await runVerify(["W-002", "--studio", studio, "--repo", repo, "--now", NOW.toISOString(), "--allow-dirty"]);
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

  // ---- honest certifies: a dirty repo refuses, --allow-dirty certifies "dirty:" ----
  const dirtyMarker = join(repo, "dirty-marker.txt");
  writeFileSync(dirtyMarker, "uncommitted\n");
  try {
    const dirtyRefused = await runVerify(["W-001", "--studio", studio, "--repo", repo, "--now", NOW.toISOString()]);
    check("verify: dirty repo without --allow-dirty exits 2", dirtyRefused.exitCode === 2, String(dirtyRefused.exitCode));

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
    rmSync(dirtyMarker, { force: true });
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
