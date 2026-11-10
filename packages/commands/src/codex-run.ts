/**
 * W-571: did a Codex turn run? A reviewer whose shell failed, or that ran no command, read nothing: its verdict is
 * failed-to-run, never passed. The signal is structural and closed: a command event Codex itself wrote, completed with
 * exit code 0, in the turn that gave the verdict. No text of a message, a prompt or a command's output is matched, so a
 * prompt that quotes an error (or a command event) cannot pass or fail a turn.
 */
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

export type TurnRan = { ran: true; commands: number } | { ran: false; why: string };

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const NONE = "it ran no command to exit code 0 in this turn (its shell failed or it ran none)";

/** The `codex exec --json` stream of one turn (start or resume): ran when one top-level `item.completed` event holds a
 *  `command_execution` item with `status` `completed` and `exit_code` 0. A line that is not JSON is skipped, as the adapter does. */
export function execStreamRan(stdout: string): TurnRan {
  let commands = 0;
  for (const line of stdout.split("\n")) {
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isDict(e) || e["type"] !== "item.completed" || !isDict(e["item"])) continue;
    const item = e["item"];
    if (item["type"] === "command_execution" && item["status"] === "completed" && item["exit_code"] === 0) commands++;
  }
  return commands > 0 ? { ran: true, commands } : { ran: false, why: NONE };
}

/** A rollout file (`<codex home>/sessions/YYYY/MM/DD/rollout-<time>-<session>.jsonl`): its last turn is the last
 *  `task_started` event's `turn_id`; ran when an `item_completed` event of that turn holds a `CommandExecution` item with
 *  `status` `completed` and `exit_code` 0. A line that is not a JSON object is an error: Codex wrote every line. */
export function rolloutRan(text: string): TurnRan {
  const events: Record<string, unknown>[] = [];
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  for (const [i, line] of lines.entries()) {
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      return { ran: false, why: `the rollout's line ${i + 1} is not JSON` };
    }
    if (!isDict(e)) return { ran: false, why: `the rollout's line ${i + 1} is not an object` };
    events.push(e);
  }
  const payload = (e: Record<string, unknown>): Record<string, unknown> => (isDict(e["payload"]) ? e["payload"] : {});
  const starts = events.filter((e) => e["type"] === "event_msg" && payload(e)["type"] === "task_started");
  const turn = starts.length === 0 ? undefined : payload(starts[starts.length - 1]!)["turn_id"];
  if (typeof turn !== "string" || turn === "") return { ran: false, why: "the rollout holds no started turn" };
  let commands = 0;
  for (const e of events) {
    const p = payload(e);
    if (e["type"] !== "event_msg" || p["type"] !== "item_completed" || p["turn_id"] !== turn || !isDict(p["item"])) continue;
    const item = p["item"];
    if (item["type"] === "CommandExecution" && item["status"] === "completed" && item["exit_code"] === 0) commands++;
  }
  return commands > 0 ? { ran: true, commands } : { ran: false, why: `${NONE.replace("this turn", `its last turn ${turn}`)}` };
}

/** Codex's own home: `CODEX_HOME` when set, else `<HOME>/.codex`; undefined with neither. */
export function codexHome(env: NodeJS.ProcessEnv): string | undefined {
  const own = env["CODEX_HOME"];
  if (own !== undefined && own !== "") return own;
  const home = env["HOME"];
  return home === undefined || home === "" ? undefined : join(home, ".codex");
}

/** The one rollout of `session` under `<home>/sessions/YYYY/MM/DD/`, judged; every read failure, none or two is not ran.
 *  `session` is matched against file names, never joined into a path. */
export function sessionRan(home: string, session: string): TurnRan {
  const root = join(home, "sessions");
  const found: string[] = [];
  const dirs = (dir: string): string[] | { why: string } => {
    try {
      if (!lstatSync(dir).isDirectory()) return { why: `${dir} is not a real directory` };
      return readdirSync(dir).sort();
    } catch (e) {
      return { why: `${dir} cannot be listed (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` };
    }
  };
  const walk = (dir: string, depth: number): string | undefined => {
    const names = dirs(dir);
    if (!Array.isArray(names)) return names.why;
    for (const n of names) {
      const p = join(dir, n);
      if (depth < 3) {
        if (!/^\d+$/.test(n)) continue;
        const why = walk(p, depth + 1);
        if (why !== undefined) return why;
      } else if (n.startsWith("rollout-") && n.endsWith(`-${session}.jsonl`)) found.push(p);
    }
    return undefined;
  };
  const why = walk(root, 0);
  if (why !== undefined) return { ran: false, why: `no rollout can be read: ${why}` };
  if (found.length !== 1) return { ran: false, why: `${found.length === 0 ? "no" : String(found.length)} rollout file(s) for session ${session} under ${root}` };
  const file = found[0]!;
  try {
    if (!lstatSync(file).isFile()) return { ran: false, why: `${file} is not a regular file` };
    return rolloutRan(readFileSync(file, "utf8"));
  } catch (e) {
    return { ran: false, why: `${file} cannot be read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` };
  }
}

/** A census reply that names itself unrun: its one `## Open` section's only nonblank line begins `Not determined`. */
export function censusUnrun(reply: string): boolean {
  const lines = reply.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const heads = lines.flatMap((l, i) => (/^## Open\s*$/.test(l) ? [i] : []));
  if (heads.length !== 1) return false;
  const rest = lines.slice(heads[0]! + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).map((l) => l.trim()).filter((l) => l !== "");
  return body.length === 1 && /^Not determined(?![\p{L}\p{M}\p{N}])/u.test(body[0]!);
}
