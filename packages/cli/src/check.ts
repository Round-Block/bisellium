/**
 * `bisellium check` — the validator. A convention exists only if this can
 * fail it. Decided from files alone (hermetic, offline); git-, receipt- and
 * registry-based rules land with the harness shim and the docs registry.
 *
 * Contract: checkStudio never throws. Every distinct condition has its own
 * rule id so hooks, CI and tests can match on it. "block" fails the run;
 * "advise" is reported.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DIGEST_KINDS,
  GATE_KINDS,
  GATE_STATUSES,
  PROVIDER_STATUSES,
  THREAD_STATES,
} from "@bisellium/schema";
import { listMd, readFront, STATES } from "@bisellium/adapter-native";

export type Level = "block" | "advise";
export interface Finding {
  rule: string;
  level: Level;
  where: string;
  message: string;
}
export interface CheckResult {
  root: string;
  now: string;
  ok: boolean;
  /** true when the directory is not a studio at all (exit 2, not 1). */
  notAStudio: boolean;
  blocks: number;
  advisories: number;
  findings: Finding[];
}

const ACTIVE = new Set(["building", "verifying", "review"]);
/** WIP = items a seat is actively working: building + verifying. Review waits on someone else. */
const WIP_STATES = new Set(["building", "verifying"]);
const HANDOFF_KEYS = ["seat", "stage", "next", "blocked_on", "at"];
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

// Defaults table (dossier Part II); overridable via manifest.defaults.
const DEFAULTS = {
  handoff_stale_days: 3,
  halted_stale_days: 7,
  backlog_depth: 20,
  open_asks: 3,
  ask_stale_days: 2,
  daily_stale_days: 1,
  hot_doc_chars: 8000,
};

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const days = (a: Date, b: Date): number => Math.abs(b.getTime() - a.getTime()) / 86_400_000;

/** Dates must be ISO strings (or YAML-parsed Date objects); anything else is rejected, not guessed. */
function isoDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v !== "string" || !ISO.test(v)) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function safeYaml(path: string): { data: Dict | undefined; error?: string } {
  try {
    const text = readFileSync(path, "utf8").replace(/^﻿/, "");
    const v = parseYaml(text);
    if (v === null || v === undefined) return { data: undefined, error: "empty file" };
    if (!isDict(v)) return { data: undefined, error: "top level is not a mapping" };
    return { data: v };
  } catch (e) {
    return { data: undefined, error: (e as Error).message };
  }
}

function safeFront(path: string): { data?: Dict; body: string; raw: string; error?: string } {
  try {
    const fm = readFront<unknown>(path);
    if (!isDict(fm.data)) return { body: fm.body, raw: fm.raw, error: "front matter is not a mapping" };
    return { data: fm.data, body: fm.body, raw: fm.raw };
  } catch (e) {
    return { body: "", raw: "", error: (e as Error).message };
  }
}

function safeList(dir: string): string[] {
  try {
    return listMd(dir);
  } catch {
    return [];
  }
}

export function checkStudio(root: string, now: Date = new Date()): CheckResult {
  const findings: Finding[] = [];
  const add = (rule: string, level: Level, where: string, message: string) =>
    findings.push({ rule, level, where, message });
  const rel = (p: string) => (isAbsolute(p) && p.startsWith(root) ? p.slice(root.length + 1).replace(/\\/g, "/") : p);
  const done = (notAStudio = false): CheckResult => {
    const blocks = findings.filter((f) => f.level === "block").length;
    return { root, now: now.toISOString(), ok: blocks === 0, notAStudio, blocks, advisories: findings.length - blocks, findings };
  };

  // ---- manifest -----------------------------------------------------------
  const manifestPath = join(root, "bisellium.yml");
  if (!existsSync(manifestPath)) {
    add("manifest.present", "block", "bisellium.yml", "manifest missing — not a Bisellium studio");
    return done(true);
  }
  const { data: m, error: mErr } = safeYaml(manifestPath);
  if (!m) {
    add("manifest.parse", "block", "bisellium.yml", `unparseable: ${mErr}`);
    return done(true);
  }

  // shape: validated at runtime, never blind-cast
  if (num(m["bisellium"]) !== 1)
    add("manifest.version", "block", "bisellium.yml", `contract version must be 1 (got ${JSON.stringify(m["bisellium"])})`);
  if (!str(m["studio"])) add("manifest.studio", "block", "bisellium.yml", "studio name missing");
  if (!str(m["owner"])) add("manifest.owner", "advise", "bisellium.yml", 'owner role id missing (defaults to "owner")');
  const owner = str(m["owner"]) ?? "owner";

  const listOf = (key: string): Dict[] => {
    const v = m[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      add("manifest.shape", "block", `bisellium.yml#${key}`, `${key} must be a list`);
      return [];
    }
    return v.filter((x, i) => {
      if (!isDict(x)) add("manifest.shape", "block", `bisellium.yml#${key}[${i}]`, "entry is not a mapping");
      return isDict(x);
    }) as Dict[];
  };
  const departments = listOf("departments");
  const seats = listOf("seats");
  const gates = listOf("gates");

  const uniq = (key: string, rows: Dict[]) => {
    const seen = new Set<string>();
    for (const r of rows) {
      const id = str(r["id"]);
      if (!id) { add("manifest.shape", "block", `bisellium.yml#${key}`, "entry has no string id"); continue; }
      if (seen.has(id)) add("manifest.unique", "block", `bisellium.yml#${key}`, `duplicate id "${id}"`);
      seen.add(id);
    }
    return seen;
  };
  const deptIds = uniq("departments", departments);
  const seatIds = uniq("seats", seats);
  const gateIds = uniq("gates", gates);
  const seatDept = new Map(seats.map((s) => [str(s["id"]) ?? "", str(s["department"]) ?? ""] as const));
  const gateKind = new Map(gates.map((g) => [str(g["id"]) ?? "", str(g["kind"]) ?? ""] as const));
  const leadOf = new Map(departments.map((d) => [str(d["id"]) ?? "", str(d["lead"]) ?? ""] as const));
  const stateIds = new Set(STATES.map((s) => s.id));

  const defaults = { ...DEFAULTS };
  if (m["defaults"] !== undefined) {
    if (!isDict(m["defaults"])) add("manifest.defaults", "block", "bisellium.yml#defaults", "defaults must be a mapping");
    else
      for (const [k, v] of Object.entries(m["defaults"])) {
        if (!(k in DEFAULTS)) add("manifest.defaults", "advise", "bisellium.yml#defaults", `unknown default "${k}"`);
        else if (num(v) === undefined) add("manifest.defaults", "block", "bisellium.yml#defaults", `"${k}" must be a number`);
        else (defaults as Record<string, number>)[k] = v as number;
      }
  }
  const wipLimit = m["wip_limit"] === undefined ? undefined : num(m["wip_limit"]);
  if (m["wip_limit"] !== undefined && wipLimit === undefined)
    add("manifest.shape", "block", "bisellium.yml#wip_limit", "wip_limit must be a number");
  if (wipLimit === undefined) add("wip.declared", "advise", "bisellium.yml", "no wip_limit — WIP is unbounded");

  if (departments.length === 0) add("manifest.departments", "block", "bisellium.yml", "no departments declared");
  for (const d of departments) {
    const id = str(d["id"]) ?? "?";
    const lead = str(d["lead"]);
    if (!lead || !seatIds.has(lead)) add("dept.lead", "block", `bisellium.yml#${id}`, `lead "${lead ?? ""}" is not a declared seat`);
    const fb = str(d["fallback"]);
    if (d["fallback"] !== undefined && (!fb || !seatIds.has(fb)))
      add("dept.fallback", "block", `bisellium.yml#${id}`, `fallback "${fb ?? ""}" is not a declared seat`);
    const charter = str(d["charter"]);
    if (!charter) { add("charter.declared", "advise", `bisellium.yml#${id}`, "department has no charter"); continue; }
    const cp = join(root, charter);
    let text: string | undefined;
    try { text = statSync(cp).isFile() ? readFileSync(cp, "utf8") : undefined; } catch { text = undefined; }
    if (text === undefined) { add("charter.present", "block", charter, `charter declared for ${id} but not a readable file`); continue; }
    for (const section of ["Decides alone", "Digests", "Asks"])
      if (!text.includes(section)) add("charter.sections", "advise", charter, `no "${section}" section`);
  }
  for (const s of seats) {
    const id = str(s["id"]) ?? "?";
    const dep = str(s["department"]);
    if (!dep || !deptIds.has(dep)) add("seat.department", "block", `bisellium.yml#${id}`, `seat department "${dep ?? ""}" not declared`);
  }
  if (gates.length === 0) add("manifest.gates", "advise", "bisellium.yml", "no gates declared — nothing can be verified");
  for (const g of gates) {
    const k = str(g["kind"]) ?? "";
    if (!(GATE_KINDS as readonly string[]).includes(k)) add("gate.kind", "block", `bisellium.yml#${str(g["id"]) ?? "?"}`, `gate kind "${k}" invalid`);
  }
  const automated = gates.filter((g) => g["kind"] === "automated").map((g) => str(g["id"]) ?? "");
  const agentGates = gates.filter((g) => g["kind"] === "agent").map((g) => str(g["id"]) ?? "");
  const humanGates = gates.filter((g) => g["kind"] === "human").map((g) => str(g["id"]) ?? "");

  const checkLink = (rule: string, where: string, href: string, what: string) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href)) return; // external URLs are not verified offline
    let ok = false;
    try { ok = existsSync(join(root, href)); } catch { ok = false; }
    if (!ok) add(rule, "block", where, `${what} "${href}" not found under studio (dead link)`);
  };

  // ---- work items ---------------------------------------------------------
  const backlogByDept = new Map<string, number>();
  let wip = 0;
  const itemIds = new Set<string>();

  const checkHandoff = (where: string, h: unknown, state: string, required: boolean) => {
    if (h === undefined) { if (required) add("handoff.present", "block", where, `active item (${state}) has no handoff`); return; }
    if (!isDict(h)) { add("handoff.shape", "block", where, "handoff is not a mapping"); return; }
    for (const k of HANDOFF_KEYS) if (str(h[k]) === undefined && !(k === "at" && h[k] instanceof Date))
      add("handoff.keys", "block", where, `handoff missing or non-string "${k}"`);
    const seat = str(h["seat"]);
    if (seat && !seatIds.has(seat)) add("handoff.seat", "block", where, `handoff seat "${seat}" not declared`);
    const stage = str(h["stage"]);
    if (stage && stage !== state) add("handoff.stage", "advise", where, `handoff stage "${stage}" ≠ state "${state}"`);
    if (h["at"] !== undefined) {
      const at = isoDate(h["at"]);
      if (!at) add("handoff.at", "block", where, "handoff.at must be an ISO date");
      else if (ACTIVE.has(state) && days(at, now) > defaults.handoff_stale_days)
        add("handoff.stale", "advise", where, `handoff is ${days(at, now).toFixed(1)} days old`);
    }
  };

  for (const p of safeList(join(root, "work"))) {
    const where = rel(p);
    const fm = safeFront(p);
    if (!fm.data) { add("item.parse", "block", where, fm.error ?? "unreadable"); continue; }
    const d = fm.data;
    if (fm.raw.length > defaults.hot_doc_chars)
      add("cap.hot_doc", "advise", where, `${fm.raw.length} chars exceeds hot-tier cap ${defaults.hot_doc_chars}`);

    for (const k of ["id", "title", "kind", "department", "state"]) {
      if (d[k] === undefined) add("item.keys", "block", where, `missing required key "${k}"`);
      else if (!str(d[k])) add("item.keys.type", "block", where, `"${k}" must be a non-empty string`);
    }
    const id = str(d["id"]);
    if (id) {
      if (id !== basename(p, ".md")) add("item.id.filename", "block", where, `id "${id}" does not match filename`);
      if (itemIds.has(id)) add("item.id.duplicate", "block", where, `duplicate id "${id}"`);
      itemIds.add(id);
    }
    const state = str(d["state"]) ?? "";
    if (state && !stateIds.has(state)) add("item.state", "block", where, `unknown state "${state}"`);
    const dept = str(d["department"]);
    if (dept && !deptIds.has(dept)) add("item.department", "block", where, `department "${dept}" not declared`);
    const ownerSeat = str(d["owner"]);
    if (d["owner"] !== undefined) {
      if (!ownerSeat || !seatIds.has(ownerSeat)) add("item.owner", "block", where, `owner "${ownerSeat ?? ""}" is not a declared seat`);
      else if (dept && seatDept.get(ownerSeat) !== dept)
        add("item.owner.department", "advise", where, `owner "${ownerSeat}" belongs to ${seatDept.get(ownerSeat)}, item is ${dept}`);
    }
    if (d["tokens"] !== undefined && num(d["tokens"]) === undefined) add("item.tokens", "advise", where, "tokens is not a number");

    // gates
    const g = d["gates"];
    const status = new Map<string, string>();
    const certifies = new Map<string, string>();
    if (g !== undefined && !isDict(g)) add("gate.shape", "block", where, "gates must be a mapping");
    for (const [gid, gv] of Object.entries(isDict(g) ? g : {})) {
      if (!gateIds.has(gid)) { add("gate.declared", "block", where, `gate "${gid}" not in manifest`); continue; }
      if (!isDict(gv)) { add("gate.shape", "block", where, `gate "${gid}" is not a mapping`); continue; }
      const gs = str(gv["status"]) ?? "";
      if (!(GATE_STATUSES as readonly string[]).includes(gs)) { add("gate.status", "block", where, `gate "${gid}" status "${gs}" invalid`); continue; }
      status.set(gid, gs);
      const ev = gv["evidence"];
      if (gs === "passed" || gs === "failed") {
        if (!str(ev)) add("gate.evidence", "block", where, `gate "${gid}" is ${gs} without evidence`);
        else {
          checkLink("link.dead", where, ev as string, `gate "${gid}" evidence`);
          const c = gv["certifies"];
          if (c === undefined) add("gate.certifies", "advise", where, `gate "${gid}" evidence has no identity (certifies)`);
          else if (!str(c)) add("gate.certifies.type", "block", where, `gate "${gid}" certifies must be a quoted string`);
          else certifies.set(gid, c as string);
        }
      }
      if (gs === "waived") {
        if (gateKind.get(gid) === "automated") add("gate.waived.automated", "block", where, `automated gate "${gid}" cannot be waived`);
        if (!str(gv["reason"])) add("gate.waived.reason", "block", where, `gate "${gid}" waived without a reason`);
      }
    }
    const notPassed = (ids: string[]) => ids.filter((x) => status.get(x) !== "passed" && status.get(x) !== "waived");
    const failedIn = (ids: string[]) => ids.filter((x) => status.get(x) === "failed" || status.get(x) === "stale");

    // state vs evidence: the asserted state must be supportable
    if (state === "review") {
      const a = notPassed(automated);
      if (a.length) add("state.review.automated", "block", where, `state "review" but automated gates not passed: ${a.join(", ")}`);
      const q = notPassed(agentGates.filter((x) => x !== "review"));
      if (q.length) add("state.review.agent", "block", where, `state "review" but agent gates not passed: ${q.join(", ")}`);
      if (status.get("review") === "failed") add("state.review.failed", "block", where, `state "review" with a failed review — item belongs back in building`);
    }
    if (state === "done") {
      const missing = [...notPassed(automated), ...notPassed(agentGates), ...humanGates.filter((x) => status.has(x) && !["passed", "waived"].includes(status.get(x)!))];
      if (missing.length) add("state.done.gates", "block", where, `state "done" but gates not passed: ${missing.join(", ")}`);
      const ids = new Set(certifies.values());
      if (ids.size > 1) add("gate.certifies.mismatch", "advise", where, `gates certify different trees: ${[...ids].join(", ")}`);
    }
    if (state === "verifying" && !automated.some((x) => status.has(x)))
      add("state.verifying.none", "advise", where, `state "verifying" with no automated gate recorded`);
    if (ACTIVE.has(state) && failedIn(automated).length && state === "review")
      add("state.review.automated", "block", where, `state "review" with failed/stale automated gate`);

    checkHandoff(where, d["handoff"], state, ACTIVE.has(state));

    if (state === "halted") {
      for (const k of ["reason", "resume_when"]) if (!str(d[k])) add("halted.exit", "block", where, `halted item missing "${k}"`);
      const at = isoDate(d["halted_at"]) ?? (isDict(d["handoff"]) ? isoDate(d["handoff"]["at"]) : undefined);
      if (!at) add("halted.at", "advise", where, "halted item has no halted_at (age cannot be tracked)");
      else if (days(at, now) > defaults.halted_stale_days) add("halted.stale", "advise", where, `halted for ${days(at, now).toFixed(0)} days`);
    }
    if (WIP_STATES.has(state)) wip++;
    if (state === "backlog" && dept) backlogByDept.set(dept, (backlogByDept.get(dept) ?? 0) + 1);
  }
  if (wipLimit !== undefined && wip > wipLimit) add("wip.cap", "block", "work/", `${wip} items in progress, WIP cap is ${wipLimit}`);
  for (const [dept, n] of backlogByDept)
    if (n > defaults.backlog_depth) add("backlog.depth", "advise", `work/#${dept}`, `${n} backlog items (cap ${defaults.backlog_depth})`);

  // ---- asks ---------------------------------------------------------------
  const openByDept = new Map<string, number>();
  const askIds = new Set<string>();
  for (const p of safeList(join(root, "asks"))) {
    const where = rel(p);
    const fm = safeFront(p);
    if (!fm.data) { add("ask.parse", "block", where, fm.error ?? "unreadable"); continue; }
    const d = fm.data;
    for (const k of ["id", "from", "to", "state"]) {
      if (d[k] === undefined) add("ask.keys", "block", where, `missing "${k}"`);
      else if (!str(d[k])) add("ask.keys.type", "block", where, `"${k}" must be a non-empty string`);
    }
    const id = str(d["id"]);
    if (id) {
      if (id !== basename(p, ".md")) add("ask.id.filename", "block", where, `id "${id}" does not match filename`);
      if (askIds.has(id)) add("ask.id.duplicate", "block", where, `duplicate id "${id}"`);
      askIds.add(id);
    }
    const s = str(d["state"]) ?? "";
    if (!(THREAD_STATES as readonly string[]).includes(s)) add("ask.state", "block", where, `state "${s}" invalid`);
    const from = str(d["from"]);
    const to = str(d["to"]);
    for (const [k, v] of [["from", from], ["to", to]] as const)
      if (v && v !== owner && !seatIds.has(v)) add("ask.party", "block", where, `${k} "${v}" is neither a seat nor the owner`);
    if (s === "needs_you" && to && to !== owner) add("ask.direction", "block", where, `needs_you must be addressed to the owner (to: ${to})`);
    if (s === "awaiting_reply" && from && from !== owner) add("ask.direction", "block", where, `awaiting_reply means the owner asked (from: ${from})`);
    if (d["work"] !== undefined) {
      const w = str(d["work"]);
      if (!w || !itemIds.has(w)) add("ask.work", "block", where, `work item "${w ?? ""}" does not exist`);
    }
    if (s !== "resolved") {
      const dept = from ? seatDept.get(from) : undefined;
      if (dept) openByDept.set(dept, (openByDept.get(dept) ?? 0) + 1);
      if (d["opened"] !== undefined) {
        const opened = isoDate(d["opened"]);
        if (!opened) add("ask.opened", "block", where, "opened must be an ISO date");
        else if (s === "needs_you" && days(opened, now) > defaults.ask_stale_days)
          add("ask.age", "advise", where, `needs you for ${days(opened, now).toFixed(1)} days`);
      } else add("ask.opened", "advise", where, "no opened date (age cannot be tracked)");
    }
  }
  for (const [dept, n] of openByDept)
    if (n > defaults.open_asks) add("ask.cap", "advise", `asks/#${dept}`, `${n} open asks from ${dept} (cap ${defaults.open_asks})`);

  // ---- digest -------------------------------------------------------------
  const latestDaily = new Map<string, Date>();
  for (const p of safeList(join(root, "digest"))) {
    const where = rel(p);
    const fm = safeFront(p);
    if (!fm.data) { add("digest.parse", "block", where, fm.error ?? "unreadable"); continue; }
    const d = fm.data;
    for (const k of ["author", "kind", "title", "at"]) if (d[k] === undefined) add("digest.keys", "block", where, `missing "${k}"`);
    const a = str(d["author"]);
    if (d["author"] !== undefined && (!a || (!seatIds.has(a) && a !== owner))) add("digest.author", "block", where, `author "${a ?? ""}" not a seat`);
    const k = str(d["kind"]) ?? "";
    if (!(DIGEST_KINDS as readonly string[]).includes(k)) add("digest.kind", "block", where, `kind "${k}" invalid`);
    const at = isoDate(d["at"]);
    if (d["at"] !== undefined && !at) add("digest.at", "block", where, "at must be an ISO date");
    if (at && k === "daily" && a) {
      const prev = latestDaily.get(a);
      if (!prev || at > prev) latestDaily.set(a, at);
    }
    const ev = d["evidence"];
    if (ev !== undefined) {
      if (!Array.isArray(ev)) add("digest.evidence", "block", where, "evidence must be a list");
      else for (const e of ev) {
        const href = isDict(e) ? str(e["href"]) : undefined;
        if (!href) add("digest.evidence", "block", where, "evidence entry has no href");
        else checkLink("link.dead", where, href, "digest evidence");
      }
    }
  }
  for (const [dept, lead] of leadOf) {
    const last = latestDaily.get(lead);
    if (!last) add("digest.daily", "advise", `digest/#${dept}`, `lead "${lead}" has no daily digest`);
    else if (days(last, now) > defaults.daily_stale_days) add("digest.daily", "advise", `digest/#${dept}`, `lead "${lead}" last daily ${days(last, now).toFixed(1)} days ago`);
  }

  // ---- budgets: allowances only -------------------------------------------
  const budgetsDir = join(root, "budgets");
  let budgetFiles: string[] = [];
  try { budgetFiles = existsSync(budgetsDir) ? readdirSync(budgetsDir).filter((f) => f.endsWith(".yml")).sort() : []; } catch { budgetFiles = []; }
  if (budgetFiles.length === 0) add("budget.present", "advise", "budgets/", "no budgets — postures will be unknown");
  for (const f of budgetFiles) {
    const where = `budgets/${f}`;
    const { data: b, error } = safeYaml(join(budgetsDir, f));
    if (!b) { add("budget.parse", "block", where, error ?? "unreadable"); continue; }
    const period = str(b["period"]) ?? (num(b["period"]) !== undefined ? String(b["period"]) : undefined);
    if (!period) add("budget.period", "block", where, "period missing");
    else if (period !== basename(f, ".yml")) add("budget.period.filename", "advise", where, `period "${period}" ≠ filename`);
    const ds = b["departments"];
    if (!isDict(ds)) { add("budget.shape", "block", where, "departments must be a mapping"); continue; }
    for (const [dept, v] of Object.entries(ds)) {
      if (!deptIds.has(dept)) add("budget.department", "block", where, `department "${dept}" not declared`);
      if (!isDict(v)) { add("budget.shape", "block", where, `${dept}: entry must be a mapping`); continue; }
      if (Object.keys(v).some((k) => k.startsWith("burn")))
        add("budget.mirror", "block", where, `${dept}: burn is derived, never written (derive, never mirror)`);
      if (num(v["allowance_tokens"]) === undefined && num(v["allowance_hours"]) === undefined)
        add("budget.allowance", "advise", where, `${dept}: no allowance set (posture will be unknown)`);
    }
    for (const dept of deptIds) if (!(dept in ds)) add("budget.missing", "advise", where, `department "${dept}" has no allowance this period`);
  }

  // ---- usage --------------------------------------------------------------
  const usagePath = join(root, "usage.yml");
  if (existsSync(usagePath)) {
    const { data: u, error } = safeYaml(usagePath);
    if (!u) add("usage.parse", "block", "usage.yml", error ?? "unreadable");
    else {
      const ps = u["providers"];
      if (!Array.isArray(ps)) add("usage.shape", "block", "usage.yml", "providers must be a list");
      else for (const p of ps) {
        if (!isDict(p)) { add("usage.shape", "block", "usage.yml", "provider entry is not a mapping"); continue; }
        const pid = str(p["id"]) ?? "?";
        const s = str(p["status"]);
        if (s && !(PROVIDER_STATUSES as readonly string[]).includes(s)) add("usage.status", "block", "usage.yml", `provider ${pid} status "${s}" invalid`);
        const pct = num(p["usage_pct"]);
        if (p["usage_pct"] !== undefined && (pct === undefined || pct < 0 || pct > 100)) add("usage.pct", "block", "usage.yml", `provider ${pid} usage_pct must be 0–100`);
      }
    }
  }

  // ---- stray files in convention dirs -------------------------------------
  for (const dir of ["work", "asks", "digest"]) {
    const full = join(root, dir);
    try {
      if (!existsSync(full)) continue;
      for (const f of readdirSync(full))
        if (!f.endsWith(".md") && statSync(join(full, f)).isFile())
          add("stray.file", "advise", `${dir}/${f}`, "not a markdown file; ignored by every reader");
    } catch { /* unreadable dir: nothing to report beyond what listMd found */ }
  }

  return done();
}

export function formatReport(r: CheckResult, level?: Level): string {
  const lines: string[] = [`check ${r.root}  (now ${r.now})`];
  for (const lv of ["block", "advise"] as const) {
    if (level && lv !== level) continue;
    const fs = r.findings.filter((f) => f.level === lv);
    if (!fs.length) continue;
    lines.push(lv === "block" ? `\nBLOCKING (${fs.length})` : `\nadvisories (${fs.length})`);
    for (const f of fs) lines.push(`  ${f.rule.padEnd(26)} ${f.where.padEnd(30)} ${f.message}`);
  }
  lines.push(`\n${r.ok ? "PASS" : "FAIL"} — ${r.blocks} blocking, ${r.advisories} advisory`);
  return lines.join("\n");
}
