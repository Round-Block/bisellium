/**
 * W-571: did a Codex turn run? A reviewer whose shell failed, or that ran no command, read nothing: its verdict is
 * failed-to-run, never passed. The signal is structural and closed: a command event Codex itself wrote, completed with
 * exit code 0, in the turn that gave the verdict. No text of a message, a prompt or a command's output is matched, so a
 * prompt that quotes an error (or a command event) cannot pass or fail a turn.
 */
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export type TurnRan = { ran: true; commands: number } | { ran: false; why: string };

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A rollout is read whole; one larger than this is not judged (the largest of the host's rollouts on 11-10 is 157 MiB). */
const ROLLOUT_MAX_BYTES = 256 * 1024 * 1024;
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

/** Codex's own home: `CODEX_HOME` when it is set, else `<HOME>/.codex`; each, when it is the one read, an absolute path, else
 *  an error (set and empty, relative, or neither set). */
export function codexHome(env: NodeJS.ProcessEnv): { home: string } | { error: string } {
  const own = env["CODEX_HOME"];
  if (own !== undefined) return isAbsolute(own) ? { home: own } : { error: `CODEX_HOME ${JSON.stringify(own)} is not an absolute path` };
  const home = env["HOME"];
  if (home === undefined) return { error: "neither CODEX_HOME nor HOME is set" };
  return isAbsolute(home) ? { home: join(home, ".codex") } : { error: `HOME ${JSON.stringify(home)} is not an absolute path` };
}

/** W-571: the models a manifest seats on the codex harness, or why it cannot say: `sellae` a list of mappings, each `harness`
 *  absent or a string, and each `harness: codex` row's `model` a nonblank string. */
export function codexModels(manifest: unknown): { models: Set<string> } | { error: string } {
  const rows = isDict(manifest) ? manifest["sellae"] : undefined;
  if (!Array.isArray(rows)) return { error: "bisellium.yml#sellae is not a list" };
  const models = new Set<string>();
  for (const [i, row] of rows.entries()) {
    if (!isDict(row)) return { error: `bisellium.yml#sellae[${i}] is not a mapping` };
    const harness = row["harness"];
    if (harness !== undefined && typeof harness !== "string") return { error: `bisellium.yml#sellae[${i}].harness is not a string` };
    if (harness !== "codex") continue;
    const model = row["model"];
    if (typeof model !== "string" || model.trim() === "") return { error: `bisellium.yml#sellae[${i}] is on the codex harness with no model` };
    models.add(model);
  }
  return { models };
}

/** W-571: a caller's own judgment, exactly `{ ran: true, commands: <positive integer> }` or `{ ran: false, why: <nonblank> }`. */
export function validTurnRan(v: unknown): TurnRan | { error: string } {
  const bad = { error: "the caller's turn judgment is not { ran: true, commands: <positive integer> } or { ran: false, why: <nonblank> }" };
  if (!isDict(v)) return bad;
  const keys = Object.keys(v).sort().join(",");
  if (v["ran"] === true && keys === "commands,ran" && Number.isSafeInteger(v["commands"]) && (v["commands"] as number) > 0) return { ran: true, commands: v["commands"] as number };
  if (v["ran"] === false && keys === "ran,why" && typeof v["why"] === "string" && v["why"].trim() !== "") return { ran: false, why: v["why"] };
  return bad;
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
    const st = lstatSync(file);
    if (!st.isFile()) return { ran: false, why: `${file} is not a regular file` };
    if (st.size > ROLLOUT_MAX_BYTES) return { ran: false, why: `${file} is over ${ROLLOUT_MAX_BYTES} bytes` };
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
