import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFront } from "@bisellium/adapter-native";

interface CloseResult {
  ok: boolean;
  error?: string;
}

const CLOSEABLE = new Set(["building", "reviewing", "greenlit"]);

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
  if (!CLOSEABLE.has(state)) return { ok: false, error: `opus ${opusId} is in state "${state}" — must be building, reviewing, or greenlit` };

  return { ok: true };
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
  const result = closeChecks(studio, opusId);
  if (!result.ok) { console.error(result.error); return { exitCode: 1 }; }

  console.log(`${opusId} ready to close — update handoff, rebuild dossier, then bisellium done ${opusId}`);
  return { exitCode: 0 };
}
