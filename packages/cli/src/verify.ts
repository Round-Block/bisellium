/**
 * `bisellium verify <opus-id>` — runs each automated probatio's command
 * (packages/pipeline) against the current tree and writes the outcome back
 * into that opus's front matter. This is the first tool-written change to
 * an opus: it may write ONLY the automated probationes' status/evidence/
 * certifies, preserving every other key (order included) and the body
 * byte-for-byte. Kept out of main.ts on purpose — wired in by the
 * integrator alongside the other builders' commands.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { readManifest, snapshotDir } from "@bisellium/adapter-native";
import { localPipeline, selectPipeline, type GateRunResult, type MergePipeline } from "@bisellium/pipeline";

export interface RunVerifyOptions {
  /** Override pipeline selection — mainly for tests. Defaults to selectPipeline(). */
  pipeline?: MergePipeline;
}

export interface RunVerifyResult {
  exitCode: number;
}

const USAGE = "usage: bisellium verify <opus-id> [--studio <dir>] [--repo <dir>] [--commit <ref>] [--now <iso>]";

interface ParsedArgs {
  id?: string;
  studio: string;
  repo?: string;
  commit: string;
  now: Date;
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let id: string | undefined;
  let studio = ".";
  let repo: string | undefined;
  let commit = "HEAD";
  let now = new Date();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--studio" || a === "--repo" || a === "--commit" || a === "--now") {
      const v = args[++i];
      if (v === undefined) return { error: `${a} needs a value\n${USAGE}` };
      if (a === "--studio") studio = v;
      else if (a === "--repo") repo = v;
      else if (a === "--commit") commit = v;
      else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return { error: `--now must be an ISO date\n${USAGE}` };
        now = d;
      }
      continue;
    }
    if (a.startsWith("--")) return { error: `flag ${a} not allowed for "verify"\n${USAGE}` };
    if (id !== undefined) return { error: `unexpected argument "${a}"\n${USAGE}` };
    id = a;
  }
  return { id, studio, repo, commit, now };
}

function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

/** Front-matter split that keeps the body byte-for-byte — unlike
 *  `@bisellium/adapter-native`'s readFront, which trims the body. */
function splitFront(raw: string): { front: string; body: string } | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.replace(/^﻿/, ""));
  if (!m) return undefined;
  return { front: m[1] ?? "", body: m[2] ?? "" };
}

export async function runVerify(args: string[], opts: RunVerifyOptions = {}): Promise<RunVerifyResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    console.error(parsed.error);
    return { exitCode: 2 };
  }
  const { id: opusId, commit, now } = parsed;
  if (!opusId) {
    console.error(USAGE);
    return { exitCode: 2 };
  }

  const studioDir = resolve(parsed.studio);
  const manifestPath = join(studioDir, "bisellium.yml");
  if (!existsSync(manifestPath)) {
    console.error(`${manifestPath} not found — not a studio`);
    return { exitCode: 2 };
  }

  let manifest: ReturnType<typeof readManifest>;
  try {
    manifest = readManifest(studioDir);
  } catch (e) {
    console.error(`${manifestPath} unparseable — not a studio: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  const opusPath = join(studioDir, "opera", `${opusId}.md`);
  if (!existsSync(opusPath)) {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }

  const repo = resolve(parsed.repo ?? (isGitRepo(resolve(studioDir, "..")) ? resolve(studioDir, "..") : process.cwd()));
  let treeHash: string;
  try {
    treeHash = execFileSync("git", ["rev-parse", `${commit}^{tree}`], { cwd: repo, encoding: "utf8" }).trim();
  } catch (e) {
    console.error(`could not resolve tree for "${commit}" in ${repo}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  const commands: Record<string, string> = {};
  for (const p of manifest.probationes) if (p.kind === "automated" && p.command) commands[p.id] = p.command;

  const snap = snapshotDir(studioDir, "verify", now);
  const opus = snap.opera.find((o) => o.id === opusId);
  if (!opus) {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }

  const logDir = join(studioDir, "ci");
  const runOpts = { opus, repo, commands, treeHash, logDir, now, studioDir };
  const pipeline = opts.pipeline ?? selectPipeline();
  let results: Record<string, GateRunResult>;
  try {
    results = await pipeline.run(runOpts);
  } catch {
    // MergePipeline's contract: an unusable pipeline throws rather than
    // half-run — fall back to the local runner so `verify` still completes.
    results = await localPipeline.run(runOpts);
  }

  const raw = readFileSync(opusPath, "utf8");
  const split = splitFront(raw);
  if (!split) {
    console.error(`${opusPath}: missing front matter`);
    return { exitCode: 2 };
  }
  const doc = parseDocument(split.front);
  for (const [gateId, r] of Object.entries(results)) {
    doc.setIn(["probationes", gateId], { status: r.status, evidence: r.evidence, certifies: r.certifies });
  }
  // lineWidth: 0 disables yaml's default 80-col reflow — otherwise any
  // untouched flow-mapping line longer than 80 chars (e.g. a real traditio
  // line) gets refolded into a multi-line block on the first tool-written
  // change to an opus, producing a spurious diff on data this write must
  // not touch (spec: "preserving all other front matter").
  writeFileSync(opusPath, `---\n${doc.toString({ lineWidth: 0 })}---\n${split.body}`);

  let anyFailed = false;
  for (const [gateId, r] of Object.entries(results)) {
    console.log(`${gateId}: ${r.status}  ${r.evidence}`);
    if (r.status === "failed") anyFailed = true;
  }

  return { exitCode: anyFailed ? 1 : 0 };
}
