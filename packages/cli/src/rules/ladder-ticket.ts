/**
 * `checkLadderTicket` (W-268 part 1) — `ladder.ticket`, block. In an officina whose `bisellium.yml` sets
 * `step_tickets: required`, every covered log of an open opus (greenlit, building, verifying, review) written at or after
 * the officina's first ticket, the earliest time of a log carrying a `# ticket:` line or of a ticket it carries, carries
 * exactly one `# ticket:` line that `parseTicketLine` accepts, naming the log's own opus, action and round, issued no later
 * than the log and after the opus's previous covered log. Covered: a verdict log
 * (`ci/*.log`, `# phase: spec` or `build`) and a red log (`ci/reds/<id>/*.log`). The officina check runs in the merge
 * queue's required `officina` job, so a write `next` never ticketed does not reach master (W-233's wall, judged from the
 * tree, not the diff). A malformed `step_tickets` blocks, as next holds on it. Reads the checked tree only; never throws.
 *
 * W-358 (W-268 part 2): `ladder.ticket` also judges every record's `tickets:` entries, whatever the record's state (an
 * entry exists only since the switch, so there is no history to spare): each is a step ticket line naming the record's
 * opus, the action `ready`, `review` or `done`, round 0 for `ready` and `done`, and for `review` the round of a build
 * verdict log `ci/<opus>-review-<n>.log` of that opus. `ladder.order` (W-233) judges the record sequences: a judged
 * verdict log's round follows its `# at:` within its opus and phase (W-183's late verdict), and a record's entries are in
 * time order.
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { listMd, parseFrontMatter } from "@bisellium/adapter-native";
import { instant } from "@bisellium/schema";
import { utcTimestampProblem, readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { parseTicketLine, readStepTickets, type StepTicket } from "@bisellium/commands/ticket.js";
import type { Finding, RuleOpts } from "../check.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const OPEN = new Set(["greenlit", "building", "verifying", "review"]);
const read = (root: string, rel: string, dir: string): string | undefined => {
  const f = readContainedRegularFile(root, rel, dir);
  return "error" in f ? undefined : f.bytes.toString("utf8");
};
const names = (list: () => string[]): string[] => {
  try {
    return list();
  } catch {
    return [];
  }
};
/** The leading `# key: value` lines, every value kept (a repeated key is not collapsed). */
function header(text: string): Map<string, string[]> {
  const h = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^#\s*([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!m) break;
    const k = m[1]!.toLowerCase();
    h.set(k, [...(h.get(k) ?? []), (m[2] ?? "").trim()]);
  }
  return h;
}
const one = (h: Map<string, string[]>, k: string): string | undefined => (h.get(k)?.length === 1 ? h.get(k)![0] : undefined);
const exact = (v: string | undefined): number | undefined => (v !== undefined && utcTimestampProblem(v) === undefined ? instant(v)?.getTime() : undefined);
const count = (v: string | undefined): number | undefined => (v !== undefined && /^(0|[1-9][0-9]{0,8})$/.test(v) ? Number(v) : undefined);

const ENTRY_ACTIONS = new Set(["ready", "review", "done"]);
/** W-358: one record's `tickets:` entries, each judged alone (`ladder.ticket`); one finding per entry, the first reason found. */
function entryFindings(where: string, id: string, value: unknown, logs: Covered[]): Finding[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ rule: "ladder.ticket", level: "block", where, message: `${id}'s tickets: is not a list of step ticket lines` }];
  const findings: Finding[] = [];
  const entry = (n: number, why: string): void => void findings.push({ rule: "ladder.ticket", level: "block", where, message: `${id}'s tickets: entry ${n} ${why}` });
  value.forEach((v: unknown, i) => {
    const t = typeof v === "string" ? parseTicketLine(v) : { error: "not a string" };
    if ("error" in t) entry(i + 1, `is not a step ticket line (${t.error})`);
    else if (t.opus !== id) entry(i + 1, `names ${t.opus}, want ${id}`);
    else if (!ENTRY_ACTIONS.has(t.action)) entry(i + 1, `is a ${t.action} ticket; a record's tickets: holds only ready, review and done`);
    else if (t.action !== "review" && t.round !== 0) entry(i + 1, `(${t.action}) names round ${t.round}, want round 0`);
    // the named log's own unique # opus:, # phase: and # round: headers must say this opus, build and this round (spec round 2)
    else if (t.action === "review" && !logs.some((l) => l.where === `ci/${id}-review-${t.round}.log` && l.opus === id && l.action === "verdict-build" && l.round === t.round))
      entry(i + 1, `(review) names round ${t.round}, but ci/${id}-review-${t.round}.log is not ${id}'s build verdict log for round ${t.round}`);
  });
  return findings;
}

interface Covered { where: string; opus: string; action: "verdict-spec" | "verdict-build" | "red"; round?: number; at?: number; atText?: string; tickets: string[]; ticket?: StepTicket; issued?: number }

export function checkLadderTicket(root: string, opts: RuleOpts): Finding[] {
  const block = (where: string, message: string): Finding => ({ rule: "ladder.ticket", level: "block", where, message });
  const setting = readStepTickets(opts.manifest);
  if ("error" in setting) return [{ rule: "ladder.ticket", level: "block", where: "bisellium.yml", message: `step_tickets is malformed (${setting.error}): fix the setting; next holds every opus on it` }];
  if (!setting.required) return [];
  const logs: Covered[] = [];
  for (const name of names(() => readdirSync(join(root, "ci")))) {
    if (!name.endsWith(".log")) continue;
    const h = header(read(root, `ci/${name}`, "ci") ?? "");
    const phase = one(h, "phase");
    const opus = one(h, "opus");
    if ((phase !== "spec" && phase !== "build") || opus === undefined) continue;
    logs.push({ where: `ci/${name}`, opus, action: phase === "spec" ? "verdict-spec" : "verdict-build", round: count(one(h, "round")), at: exact(one(h, "at")), atText: one(h, "at"), tickets: h.get("ticket") ?? [] });
  }
  for (const opus of names(() => readdirSync(join(root, "ci", "reds")))) {
    for (const name of names(() => readdirSync(join(root, "ci", "reds", opus)))) {
      if (!name.endsWith(".log")) continue;
      const text = read(root, `ci/reds/${opus}/${name}`, "ci");
      if (text === undefined) continue;
      const h = header(text);
      logs.push({ where: `ci/reds/${opus}/${name}`, opus, action: "red", round: count(one(h, "behaviour")), at: exact(one(h, "at")), atText: one(h, "at"), tickets: h.get("ticket") ?? [] });
    }
  }
  for (const l of logs) {
    const t = l.tickets.length === 1 ? parseTicketLine(l.tickets[0]!) : undefined;
    if (t !== undefined && !("error" in t)) [l.ticket, l.issued] = [t, exact(t.at)];
  }
  // the boundary: the officina's first ticket, the earliest # at: of a log carrying a # ticket: line or `at` of a canonical
  // line it carries, so every log carrying one is at or after it (W-268 r3); a log before it with none predates the switch
  // no candidate time exact (every ticket line noncanonical, every carrying log's # at: inexact): Math.min of nothing is
  // +Infinity, so no exact-time log is at or after it and only logs with an inexact # at: are judged (spec round 4's S2)
  // the records, read once: every record's tickets: entries are judged (W-358), the open ones' logs below (W-268)
  const records = new Map<string, { d: Dict; where: string }>();
  for (const path of names(() => listMd(join(root, "opera")))) {
    const id = basename(path, ".md");
    const text = read(root, `opera/${basename(path)}`, "opera");
    try {
      const d = text === undefined ? undefined : parseFrontMatter<unknown>(text, id).data;
      if (isDict(d)) records.set(id, { d, where: `opera/${basename(path)}` });
    } catch {
      /* an unparseable record is the record rules' */
    }
  }
  const findings: Finding[] = [...records].flatMap(([id, r]) => entryFindings(r.where, id, r.d["tickets"], logs));
  const ticketed = logs.filter((l) => l.tickets.length > 0);
  if (ticketed.length === 0) return findings;
  const first = Math.min(...ticketed.flatMap((l) => [l.at, ...l.tickets.map((s) => parseTicketLine(s)).map((t) => ("error" in t ? undefined : exact(t.at)))]).filter((n): n is number => n !== undefined));
  const open = new Set([...records].filter(([, r]) => OPEN.has(String(r.d["state"]))).map(([id]) => id));
  const covered = logs.filter((l) => open.has(l.opus) && (l.at === undefined || l.at >= first));
  const previous = new Map<string, Covered>();
  for (const l of [...covered].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (a.where < b.where ? -1 : 1))) {
    const want = `${l.opus} ${l.action} round ${l.round ?? "none"}`;
    if (l.at === undefined) findings.push(block(l.where, `${l.opus}'s ${l.action} log has no exact UTC # at: (${l.atText ?? "none"}), so its ticket cannot be judged`));
    else if (l.tickets.length !== 1) findings.push(block(l.where, `carries ${l.tickets.length} # ticket: lines, want exactly one: run bisellium next ${l.opus} before the write`));
    else if (l.ticket === undefined) findings.push(block(l.where, `its # ticket: is not a step ticket line (${(parseTicketLine(l.tickets[0]!) as { error: string }).error})`));
    else if (l.ticket.opus !== l.opus || l.ticket.action !== l.action || l.ticket.round !== l.round) findings.push(block(l.where, `its ticket names ${l.ticket.opus} ${l.ticket.action} round ${l.ticket.round}, want ${want}`));
    else if (l.issued! > l.at) findings.push(block(l.where, `its ticket was issued at ${l.ticket.at}, after the log (${l.atText})`));
    else {
      const prev = previous.get(l.opus);
      if (prev?.at !== undefined && l.issued! <= prev.at) findings.push(block(l.where, `its ticket (${l.ticket.at}) is not after ${l.opus}'s previous covered log ${prev.where} (${prev.atText}): one ticket is spent by one write`));
    }
    if (l.at !== undefined) previous.set(l.opus, l);
  }
  return findings;
}
