/**
 * `bisellium check` — the validator. A convention exists only if this can
 * fail it. Everything here is decided from files alone (hermetic, offline);
 * git- and receipt-based checks land with the harness shim.
 *
 * Levels: "block" fails the run (merge-critical); "advise" is reported.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { listMd, readFront, readManifest, STATES, type Manifest } from "@bisellium/adapter-native";

export type Level = "block" | "advise";
export interface Finding {
  rule: string;
  level: Level;
  where: string;
  message: string;
}
export interface CheckResult {
  ok: boolean;
  blocks: number;
  advisories: number;
  findings: Finding[];
}

const GATE_STATUSES = new Set(["pending", "passed", "failed", "waived", "stale"]);
const GATE_KINDS = new Set(["automated", "agent", "human"]);
const ASK_STATES = new Set(["needs_you", "awaiting_reply", "resolved"]);
const DIGEST_KINDS = new Set(["consultation", "decision", "daily"]);
const PROVIDER_STATUSES = new Set(["ok", "conserve", "closeout", "limited", "unknown"]);
const ACTIVE = new Set(["building", "verifying", "review"]);
const HANDOFF_KEYS = ["seat", "stage", "next", "blocked_on", "at"];

// Defaults table (dossier Part II); overridable via manifest.defaults.
const DEFAULTS = {
  handoff_stale_days: 3,
  halted_stale_days: 7,
  backlog_depth: 20,
  open_asks: 3,
  ask_stale_days: 2,
  hot_doc_chars: 8000,
};

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 86_400_000;
}
function parseDate(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function checkStudio(root: string, now: Date = new Date()): CheckResult {
  const findings: Finding[] = [];
  const add = (rule: string, level: Level, where: string, message: string) =>
    findings.push({ rule, level, where, message });
  const rel = (p: string) => (isAbsolute(p) ? p.slice(root.length + 1) : p);

  // ---- manifest -----------------------------------------------------------
  const manifestPath = join(root, "bisellium.yml");
  if (!existsSync(manifestPath)) {
    add("manifest.present", "block", "bisellium.yml", "manifest missing — not a Bisellium studio");
    return finish(findings);
  }
  let manifest: Manifest;
  try {
    manifest = readManifest(root);
  } catch (e) {
    add("manifest.parse", "block", "bisellium.yml", `unparseable: ${(e as Error).message}`);
    return finish(findings);
  }
  const defaults = { ...DEFAULTS, ...(manifest.defaults ?? {}) };

  if (!Number.isInteger(manifest.bisellium) || manifest.bisellium !== 1)
    add("manifest.version", "block", "bisellium.yml", `contract version must be 1 (got ${String(manifest.bisellium)})`);
  if (!str(manifest.studio)) add("manifest.studio", "block", "bisellium.yml", "studio name missing");
  if (!str(manifest.owner)) add("manifest.owner", "advise", "bisellium.yml", "owner role id missing (defaults to \"owner\")");
  const owner = manifest.owner ?? "owner";

  const departments = Array.isArray(manifest.departments) ? manifest.departments : [];
  const seats = Array.isArray(manifest.seats) ? manifest.seats : [];
  const gates = Array.isArray(manifest.gates) ? manifest.gates : [];
  const deptIds = new Set(departments.map((d) => d.id));
  const seatIds = new Set(seats.map((s) => s.id));
  const seatDept = new Map(seats.map((s) => [s.id, s.department] as const));
  const gateKind = new Map(gates.map((g) => [g.id, g.kind] as const));
  const stateIds = new Set(STATES.map((s) => s.id));

  if (departments.length === 0) add("manifest.departments", "block", "bisellium.yml", "no departments declared");
  for (const d of departments) {
    if (!seatIds.has(d.lead)) add("dept.lead", "block", `bisellium.yml#${d.id}`, `lead "${d.lead}" is not a declared seat`);
    if (d.fallback && !seatIds.has(d.fallback))
      add("dept.fallback", "block", `bisellium.yml#${d.id}`, `fallback "${d.fallback}" is not a declared seat`);
    if (d.charter) {
      const cp = join(root, d.charter);
      if (!existsSync(cp)) add("charter.present", "block", d.charter, `charter declared for ${d.id} but file missing`);
      else {
        const text = readFileSync(cp, "utf8");
        for (const section of ["Decides alone", "Digests", "Asks"])
          if (!text.includes(section)) add("charter.sections", "advise", d.charter, `no "${section}" section`);
      }
    } else add("charter.declared", "advise", `bisellium.yml#${d.id}`, "department has no charter");
  }
  for (const s of seats)
    if (!deptIds.has(s.department))
      add("seat.department", "block", `bisellium.yml#${s.id}`, `seat department "${s.department}" not declared`);
  if (gates.length === 0) add("manifest.gates", "advise", "bisellium.yml", "no gates declared — nothing can be verified");
  for (const g of gates)
    if (!GATE_KINDS.has(g.kind)) add("gate.kind", "block", `bisellium.yml#${g.id}`, `gate kind "${g.kind}" invalid`);

  // ---- work items ---------------------------------------------------------
  const byDeptBacklog = new Map<string, number>();
  let building = 0;
  const itemIds = new Set<string>();
  for (const p of listMd(join(root, "work"))) {
    const where = rel(p);
    let fm: ReturnType<typeof readFront<Dict>>;
    try {
      fm = readFront<Dict>(p);
    } catch (e) {
      add("item.parse", "block", where, (e as Error).message);
      continue;
    }
    const d = fm.data;
    if (fm.raw.length > defaults.hot_doc_chars)
      add("cap.hot_doc", "advise", where, `${fm.raw.length} chars exceeds hot-tier cap ${defaults.hot_doc_chars}`);

    for (const k of ["id", "title", "kind", "department", "state"])
      if (d[k] === undefined) add("item.keys", "block", where, `missing required key "${k}"`);
    const id = str(d["id"]);
    if (id) {
      if (id !== basename(p, ".md")) add("item.id", "block", where, `id "${id}" does not match filename`);
      if (itemIds.has(id)) add("item.id", "block", where, `duplicate id "${id}"`);
      itemIds.add(id);
    }
    const state = str(d["state"]) ?? "";
    if (state && !stateIds.has(state)) add("item.state", "block", where, `unknown state "${state}"`);
    const dept = str(d["department"]);
    if (dept && !deptIds.has(dept)) add("item.department", "block", where, `department "${dept}" not declared`);
    const ownerSeat = str(d["owner"]);
    if (ownerSeat) {
      if (!seatIds.has(ownerSeat)) add("item.owner", "block", where, `owner "${ownerSeat}" is not a declared seat`);
      else if (dept && seatDept.get(ownerSeat) !== dept)
        add("item.owner.department", "advise", where, `owner "${ownerSeat}" belongs to ${seatDept.get(ownerSeat)}, item is ${dept}`);
    }
    if (d["tokens"] !== undefined && num(d["tokens"]) === undefined) add("item.tokens", "advise", where, "tokens is not a number");

    // gates: declared, valid, evidenced
    const g = isDict(d["gates"]) ? d["gates"] : {};
    const status = new Map<string, string>();
    for (const [gid, gv] of Object.entries(g)) {
      if (!gateKind.has(gid)) { add("gate.declared", "block", where, `gate "${gid}" not in manifest`); continue; }
      const gs = isDict(gv) ? str(gv["status"]) ?? "" : "";
      if (!GATE_STATUSES.has(gs)) { add("gate.status", "block", where, `gate "${gid}" status "${gs}" invalid`); continue; }
      status.set(gid, gs);
      if (gs === "passed" || gs === "failed") {
        const ev = isDict(gv) ? str(gv["evidence"]) : undefined;
        if (!ev) add("gate.evidence", "block", where, `gate "${gid}" is ${gs} without evidence`);
        else {
          if (!(isDict(gv) && str(gv["certifies"])))
            add("gate.certifies", "advise", where, `gate "${gid}" evidence has no identity (certifies)`);
          if (!/^[a-z]+:\/\//.test(ev) && !existsSync(join(root, ev)))
            add("evidence.link", "advise", where, `evidence "${ev}" not found under studio`);
        }
      }
    }

    // state vs evidence: asserted state must be supportable
    const automated = gates.filter((x) => x.kind === "automated").map((x) => x.id);
    const agent = gates.filter((x) => x.kind === "agent").map((x) => x.id);
    const human = gates.filter((x) => x.kind === "human").map((x) => x.id);
    const passed = (ids: string[]) => ids.filter((x) => status.get(x) !== "passed" && status.get(x) !== "waived");
    if (state === "review") {
      const missing = passed(automated);
      if (missing.length)
        add("state.evidence", "block", where, `state "review" but automated gates not passed: ${missing.join(", ")}`);
    }
    if (state === "done") {
      const missing = [...passed(automated), ...passed(agent), ...human.filter((x) => status.has(x) && !["passed", "waived"].includes(status.get(x)!))];
      if (missing.length) add("state.evidence", "block", where, `state "done" but gates not passed: ${missing.join(", ")}`);
    }
    if (state === "verifying" && !automated.some((x) => status.has(x)))
      add("state.evidence", "advise", where, `state "verifying" with no automated gate recorded`);

    // handoff on active items
    if (ACTIVE.has(state)) {
      const h = d["handoff"];
      if (!isDict(h)) add("handoff.present", "block", where, `active item (${state}) has no handoff`);
      else {
        for (const k of HANDOFF_KEYS) if (h[k] === undefined) add("handoff.keys", "block", where, `handoff missing "${k}"`);
        const hs = str(h["stage"]);
        if (hs && hs !== state) add("handoff.stage", "advise", where, `handoff stage "${hs}" ≠ state "${state}"`);
        const at = parseDate(h["at"]);
        if (h["at"] !== undefined && !at) add("handoff.at", "block", where, "handoff.at is not a date");
        else if (at && daysBetween(at, now) > defaults.handoff_stale_days)
          add("handoff.stale", "advise", where, `handoff is ${daysBetween(at, now).toFixed(1)} days old`);
        const hseat = str(h["seat"]);
        if (hseat && !seatIds.has(hseat)) add("handoff.seat", "block", where, `handoff seat "${hseat}" not declared`);
      }
    }
    if (state === "halted") {
      for (const k of ["reason", "resume_when"]) if (d[k] === undefined) add("halted.exit", "block", where, `halted item missing "${k}"`);
      const at = parseDate(d["halted_at"]) ?? (isDict(d["handoff"]) ? parseDate(d["handoff"]["at"]) : undefined);
      if (at && daysBetween(at, now) > defaults.halted_stale_days)
        add("halted.stale", "advise", where, `halted for ${daysBetween(at, now).toFixed(0)} days`);
    }
    if (state === "building") building++;
    if (state === "backlog" && dept) byDeptBacklog.set(dept, (byDeptBacklog.get(dept) ?? 0) + 1);
  }
  if (manifest.wip_limit !== undefined && building > manifest.wip_limit)
    add("wip.cap", "block", "work/", `${building} items building, WIP cap is ${manifest.wip_limit}`);
  for (const [dept, n] of byDeptBacklog)
    if (n > defaults.backlog_depth) add("backlog.depth", "advise", `work/#${dept}`, `${n} backlog items (cap ${defaults.backlog_depth})`);

  // ---- asks ---------------------------------------------------------------
  const openByDept = new Map<string, number>();
  for (const p of listMd(join(root, "asks"))) {
    const where = rel(p);
    let d: Dict;
    try { d = readFront<Dict>(p).data; } catch (e) { add("ask.parse", "block", where, (e as Error).message); continue; }
    for (const k of ["id", "from", "to", "state"]) if (d[k] === undefined) add("ask.keys", "block", where, `missing "${k}"`);
    const s = str(d["state"]) ?? "";
    if (!ASK_STATES.has(s)) add("ask.state", "block", where, `state "${s}" invalid`);
    for (const k of ["from", "to"]) {
      const v = str(d[k]);
      if (v && v !== owner && !seatIds.has(v)) add("ask.party", "block", where, `${k} "${v}" is neither a seat nor the owner`);
    }
    const work = str(d["work"]);
    if (work && !itemIds.has(work)) add("ask.work", "block", where, `work item "${work}" does not exist`);
    if (s !== "resolved") {
      const from = str(d["from"]);
      const dept = from ? seatDept.get(from) : undefined;
      if (dept) openByDept.set(dept, (openByDept.get(dept) ?? 0) + 1);
      const opened = parseDate(d["opened"]);
      if (s === "needs_you" && opened && daysBetween(opened, now) > defaults.ask_stale_days)
        add("ask.age", "advise", where, `needs you for ${daysBetween(opened, now).toFixed(1)} days`);
    }
  }
  for (const [dept, n] of openByDept)
    if (n > defaults.open_asks) add("ask.cap", "advise", `asks/#${dept}`, `${n} open asks from ${dept} (cap ${defaults.open_asks})`);

  // ---- digest -------------------------------------------------------------
  for (const p of listMd(join(root, "digest"))) {
    const where = rel(p);
    let d: Dict;
    try { d = readFront<Dict>(p).data; } catch (e) { add("digest.parse", "block", where, (e as Error).message); continue; }
    for (const k of ["author", "kind", "title", "at"]) if (d[k] === undefined) add("digest.keys", "block", where, `missing "${k}"`);
    const a = str(d["author"]);
    if (a && !seatIds.has(a) && a !== owner) add("digest.author", "block", where, `author "${a}" not a seat`);
    const k = str(d["kind"]) ?? "";
    if (!DIGEST_KINDS.has(k)) add("digest.kind", "block", where, `kind "${k}" invalid`);
    if (d["at"] !== undefined && !parseDate(d["at"])) add("digest.at", "block", where, "at is not a date");
  }

  // ---- budgets: allowances only -------------------------------------------
  const budgetsDir = join(root, "budgets");
  if (existsSync(budgetsDir)) {
    for (const f of readdirSync(budgetsDir).filter((f) => f.endsWith(".yml"))) {
      const where = `budgets/${f}`;
      let b: Dict;
      try { b = parseYaml(readFileSync(join(budgetsDir, f), "utf8")) as Dict; } catch (e) { add("budget.parse", "block", where, (e as Error).message); continue; }
      if (!str(b["period"]) && num(b["period"]) === undefined) add("budget.period", "block", where, "period missing");
      const ds = isDict(b["departments"]) ? b["departments"] : {};
      for (const [dept, v] of Object.entries(ds)) {
        if (!deptIds.has(dept)) add("budget.department", "block", where, `department "${dept}" not declared`);
        if (isDict(v)) {
          if (Object.keys(v).some((k) => k.startsWith("burn")))
            add("budget.mirror", "block", where, `${dept}: burn is derived, never written (derive, never mirror)`);
          if (num(v["allowance_tokens"]) === undefined && num(v["allowance_hours"]) === undefined)
            add("budget.allowance", "advise", where, `${dept}: no allowance set (posture will be unknown)`);
        }
      }
    }
  } else add("budget.present", "advise", "budgets/", "no budgets — postures will be unknown");

  // ---- usage --------------------------------------------------------------
  const usagePath = join(root, "usage.yml");
  if (existsSync(usagePath)) {
    try {
      const u = parseYaml(readFileSync(usagePath, "utf8")) as Dict;
      const ps = Array.isArray(u["providers"]) ? (u["providers"] as unknown[]) : [];
      for (const p of ps) {
        if (!isDict(p)) continue;
        const s = str(p["status"]);
        if (s && !PROVIDER_STATUSES.has(s)) add("usage.status", "block", "usage.yml", `provider ${String(p["id"])} status "${s}" invalid`);
        const pct = num(p["usage_pct"]);
        if (pct !== undefined && (pct < 0 || pct > 100)) add("usage.pct", "block", "usage.yml", `provider ${String(p["id"])} usage_pct out of range`);
      }
    } catch (e) { add("usage.parse", "block", "usage.yml", (e as Error).message); }
  }

  // ---- stray files in convention dirs -------------------------------------
  for (const dir of ["work", "asks", "digest"]) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    for (const f of readdirSync(full))
      if (!f.endsWith(".md") && statSync(join(full, f)).isFile())
        add("stray.file", "advise", `${dir}/${f}`, "not a markdown file; ignored by every reader");
  }

  return finish(findings);
}

function finish(findings: Finding[]): CheckResult {
  const blocks = findings.filter((f) => f.level === "block").length;
  return { ok: blocks === 0, blocks, advisories: findings.length - blocks, findings };
}

export function formatReport(root: string, r: CheckResult): string {
  const lines: string[] = [`check ${root}`];
  for (const level of ["block", "advise"] as const) {
    const fs = r.findings.filter((f) => f.level === level);
    if (!fs.length) continue;
    lines.push(level === "block" ? `\nBLOCKING (${fs.length})` : `\nadvisories (${fs.length})`);
    for (const f of fs) lines.push(`  ${f.rule.padEnd(22)} ${f.where.padEnd(28)} ${f.message}`);
  }
  lines.push(`\n${r.ok ? "PASS" : "FAIL"} — ${r.blocks} blocking, ${r.advisories} advisory`);
  return lines.join("\n");
}
