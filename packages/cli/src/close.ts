import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFront } from "@bisellium/adapter-native";
import { runDone } from "./lifecycle.js";

interface CloseResult {
  ok: boolean;
  error?: string;
}

// Matches DONE_FROM_STATES in packages/commands/src/lifecycle.ts — runDone
// rejects anything else one step later, so closeChecks must agree exactly.
const CLOSEABLE = new Set(["building", "verifying", "review"]);

export function closeChecks(studio: string, opusId: string): CloseResult {
  const opusPath = join(resolve(studio), "opera", `${opusId}.md`);
  if (!existsSync(opusPath)) return { ok: false, error: `opus ${opusId} not found` };

  let data: Record<string, unknown>;
  try {
    const fm = readFront<Record<string, unknown>>(opusPath);
    data = fm.data;
  } catch {
    return { ok: false, error: `opus ${opusId} unreadable` };
  }

  const state = typeof data["state"] === "string" ? data["state"] : undefined;
  if (!state) return { ok: false, error: `opus ${opusId} has no state` };
  if (state === "done") return { ok: false, error: `opus ${opusId} is already done` };
  if (!CLOSEABLE.has(state)) return { ok: false, error: `opus ${opusId} is in state "${state}" — must be building, verifying, or review` };

  return { ok: true };
}

export function executeClose(studio: string, opusId: string): CloseResult {
  const validation = closeChecks(studio, opusId);
  if (!validation.ok) return validation;

  const doneResult = runDone([opusId, "--studio", studio]);
  if (doneResult.exitCode !== 0) return { ok: false, error: `done failed (exit ${doneResult.exitCode})` };

  return { ok: true };
}

function rebuildDossier(repo: string): boolean {
  const buildScript = join(repo, "docs", "design", "dossier", "build.sh");
  if (!existsSync(buildScript)) return true;
  const r = spawnSync("bash", [buildScript], {
    cwd: join(repo, "docs", "design", "dossier"),
    encoding: "utf8",
    timeout: 30_000,
  });
  return r.status === 0;
}

const CLOSE_USAGE = "usage: bisellium close <opus-id> --studio <dir> [--repo <dir>]";

export function runClose(args: string[]): { exitCode: number } {
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) { values.set(a, args[++i] ?? ""); continue; }
    positionals.push(a);
  }

  const opusId = positionals[0];
  if (!opusId) { console.error(CLOSE_USAGE); return { exitCode: 2 }; }

  const studio = resolve(values.get("--studio") ?? ".");
  const repo = resolve(values.get("--repo") ?? ".");

  const result = executeClose(studio, opusId);
  if (!result.ok) { console.error(result.error); return { exitCode: 1 }; }

  if (!rebuildDossier(repo)) {
    console.error(`${opusId} closed, but dossier rebuild failed — run docs/design/dossier/build.sh manually`);
    return { exitCode: 1 };
  }
  console.log(`${opusId} closed — dossier rebuilt`);
  return { exitCode: 0 };
}
