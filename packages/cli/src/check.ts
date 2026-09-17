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
  ACTUM_KINDS,
  PROBATIO_KINDS,
  PROBATIO_STATUSES,
  PROVIDER_STATUSES,
  PETITIO_STATES,
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
/** WIP = items a sella is actively working: building + verifying. Review waits on someone else. */
const WIP_STATES = new Set(["building", "verifying"]);
const TRADITIO_KEYS = ["sella", "stage", "next", "blocked_on", "at"];
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
/** Signed elapsed days from `a` to `b`, clamped at 0 — a future `a` (relative
 *  to `b`) reads as fresh (0 days old), never as stale via an absolute value. */
const days = (a: Date, b: Date): number => Math.max(0, (b.getTime() - a.getTime()) / 86_400_000);

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
  if (!str(m["patron"])) add("manifest.patron", "advise", "bisellium.yml", 'patron role id missing (defaults to "patron")');
  const patron = str(m["patron"]) ?? "patron";
  const reviewProbatioId = str(m["review_probatio"]) ?? "review";

  if (m["timezone"] !== undefined) {
    if (!str(m["timezone"])) add("manifest.timezone", "block", "bisellium.yml", "timezone must be a string");
    else {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: m["timezone"] as string });
      } catch {
        add("manifest.timezone", "block", "bisellium.yml", `timezone "${m["timezone"] as string}" is not a valid IANA zone`);
      }
    }
  }

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
  const collegia = listOf("collegia");
  const sellae = listOf("sellae");
  const probationes = listOf("probationes");

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
  const collegiumIds = uniq("collegia", collegia);
  const sellaIds = uniq("sellae", sellae);
  const probatioIds = uniq("probationes", probationes);
  const sellaCollegium = new Map(sellae.map((s) => [str(s["id"]) ?? "", str(s["collegium"]) ?? ""] as const));
  const probatioKind = new Map(probationes.map((g) => [str(g["id"]) ?? "", str(g["kind"]) ?? ""] as const));
  const magisterOf = new Map(collegia.map((d) => [str(d["id"]) ?? "", str(d["magister"]) ?? ""] as const));
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

  if (collegia.length === 0) add("manifest.collegia", "block", "bisellium.yml", "no collegia declared");
  for (const d of collegia) {
    const id = str(d["id"]) ?? "?";
    const magister = str(d["magister"]);
    if (!magister || !sellaIds.has(magister)) add("collegium.magister", "block", `bisellium.yml#${id}`, `magister "${magister ?? ""}" is not a declared sella`);
    const fb = str(d["fallback"]);
    if (d["fallback"] !== undefined && (!fb || !sellaIds.has(fb)))
      add("collegium.fallback", "block", `bisellium.yml#${id}`, `fallback "${fb ?? ""}" is not a declared sella`);
    const lex = str(d["lex"]);
    if (!lex) { add("lex.declared", "advise", `bisellium.yml#${id}`, "collegium has no lex"); continue; }
    const cp = join(root, lex);
    let text: string | undefined;
    try { text = statSync(cp).isFile() ? readFileSync(cp, "utf8") : undefined; } catch { text = undefined; }
    if (text === undefined) { add("lex.present", "block", lex, `lex declared for ${id} but not a readable file`); continue; }
    for (const section of ["Decides alone", "Digests", "Asks"])
      if (!text.includes(section)) add("lex.sections", "advise", lex, `no "${section}" section`);
  }
  for (const s of sellae) {
    const id = str(s["id"]) ?? "?";
    const col = str(s["collegium"]);
    if (!col || !collegiumIds.has(col)) add("sella.collegium", "block", `bisellium.yml#${id}`, `sella collegium "${col ?? ""}" not declared`);
  }
  if (probationes.length === 0) add("manifest.probationes", "advise", "bisellium.yml", "no probationes declared — nothing can be verified");
  for (const g of probationes) {
    const k = str(g["kind"]) ?? "";
    if (!(PROBATIO_KINDS as readonly string[]).includes(k)) add("probatio.kind", "block", `bisellium.yml#${str(g["id"]) ?? "?"}`, `gate kind "${k}" invalid`);
  }
  const automated = probationes.filter((g) => g["kind"] === "automated").map((g) => str(g["id"]) ?? "");
  const agentGates = probationes.filter((g) => g["kind"] === "agent").map((g) => str(g["id"]) ?? "");
  const humanGates = probationes.filter((g) => g["kind"] === "human").map((g) => str(g["id"]) ?? "");

  const checkLink = (rule: string, where: string, href: string, what: string) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href)) return; // external URLs are not verified offline
    let ok = false;
    try { ok = existsSync(join(root, href)); } catch { ok = false; }
    if (!ok) add(rule, "block", where, `${what} "${href}" not found under studio (dead link)`);
  };

  // ---- opera ---------------------------------------------------------------
  const backlogByCollegium = new Map<string, number>();
  let wip = 0;
  const itemIds = new Set<string>();

  const checkTraditio = (where: string, h: unknown, state: string, required: boolean) => {
    if (h === undefined) { if (required) add("traditio.present", "block", where, `active item (${state}) has no handoff`); return; }
    if (!isDict(h)) { add("traditio.shape", "block", where, "handoff is not a mapping"); return; }
    for (const k of TRADITIO_KEYS) if (str(h[k]) === undefined && !(k === "at" && h[k] instanceof Date))
      add("traditio.keys", "block", where, `handoff missing or non-string "${k}"`);
    const sella = str(h["sella"]);
    if (sella && !sellaIds.has(sella)) add("traditio.sella", "block", where, `handoff sella "${sella}" not declared`);
    const stage = str(h["stage"]);
    if (stage && stage !== state) add("traditio.stage", "advise", where, `handoff stage "${stage}" ≠ state "${state}"`);
    if (h["at"] !== undefined) {
      const at = isoDate(h["at"]);
      if (!at) add("traditio.at", "block", where, "handoff.at must be an ISO date");
      else if (ACTIVE.has(state) && days(at, now) > defaults.handoff_stale_days)
        add("traditio.stale", "advise", where, `handoff is ${days(at, now).toFixed(1)} days old`);
    }
  };

  for (const p of safeList(join(root, "opera"))) {
    const where = rel(p);
    const fm = safeFront(p);
    if (!fm.data) { add("opus.parse", "block", where, fm.error ?? "unreadable"); continue; }
    const d = fm.data;
    if (fm.raw.length > defaults.hot_doc_chars)
      add("cap.hot_doc", "advise", where, `${fm.raw.length} chars exceeds hot-tier cap ${defaults.hot_doc_chars}`);

    for (const k of ["id", "title", "kind", "collegium", "state"]) {
      if (d[k] === undefined) add("opus.keys", "block", where, `missing required key "${k}"`);
      else if (!str(d[k])) add("opus.keys.type", "block", where, `"${k}" must be a non-empty string`);
    }
    const id = str(d["id"]);
    if (id) {
      if (id !== basename(p, ".md")) add("opus.id.filename", "block", where, `id "${id}" does not match filename`);
      if (itemIds.has(id)) add("opus.id.duplicate", "block", where, `duplicate id "${id}"`);
      itemIds.add(id);
    }
    const state = str(d["state"]) ?? "";
    if (state && !stateIds.has(state)) add("opus.state", "block", where, `unknown state "${state}"`);
    const collegium = str(d["collegium"]);
    if (collegium && !collegiumIds.has(collegium)) add("opus.collegium", "block", where, `collegium "${collegium}" not declared`);
    const sellaId = str(d["sella"]);
    if (d["sella"] !== undefined) {
      if (!sellaId || !sellaIds.has(sellaId)) add("opus.sella", "block", where, `sella "${sellaId ?? ""}" is not a declared sella`);
      else if (collegium && sellaCollegium.get(sellaId) !== collegium)
        add("opus.sella.collegium", "advise", where, `sella "${sellaId}" belongs to ${sellaCollegium.get(sellaId)}, item is ${collegium}`);
    }
    if (d["tokens"] !== undefined && num(d["tokens"]) === undefined) add("opus.tokens", "advise", where, "tokens is not a number");

    // gates
    const g = d["probationes"];
    const status = new Map<string, string>();
    const certifies = new Map<string, string>();
    if (g !== undefined && !isDict(g)) add("probatio.shape", "block", where, "gates must be a mapping");
    for (const [gid, gv] of Object.entries(isDict(g) ? g : {})) {
      if (!probatioIds.has(gid)) { add("probatio.declared", "block", where, `gate "${gid}" not in manifest`); continue; }
      if (!isDict(gv)) { add("probatio.shape", "block", where, `gate "${gid}" is not a mapping`); continue; }
      const gs = str(gv["status"]) ?? "";
      if (!(PROBATIO_STATUSES as readonly string[]).includes(gs)) { add("probatio.status", "block", where, `gate "${gid}" status "${gs}" invalid`); continue; }
      status.set(gid, gs);
      const ev = gv["evidence"];
      if (gs === "passed" || gs === "failed") {
        if (!str(ev)) add("probatio.evidence", "block", where, `gate "${gid}" is ${gs} without evidence`);
        else {
          checkLink("link.dead", where, ev as string, `gate "${gid}" evidence`);
          const c = gv["certifies"];
          if (c === undefined) add("probatio.certifies", "advise", where, `gate "${gid}" evidence has no identity (certifies)`);
          else if (!str(c)) add("probatio.certifies.type", "block", where, `gate "${gid}" certifies must be a quoted string`);
          else certifies.set(gid, c as string);
        }
      }
      if (gs === "waived") {
        if (probatioKind.get(gid) === "automated") add("probatio.waived.automated", "block", where, `automated gate "${gid}" cannot be waived`);
        if (!str(gv["reason"])) add("probatio.waived.reason", "block", where, `gate "${gid}" waived without a reason`);
      }
    }
    const notPassed = (ids: string[]) => ids.filter((x) => status.get(x) !== "passed" && status.get(x) !== "waived");

    // state vs evidence: the asserted state must be supportable
    if (state === "review") {
      const a = notPassed(automated);
      if (a.length) add("state.review.automated", "block", where, `state "review" but automated gates not passed: ${a.join(", ")}`);
      const q = notPassed(agentGates.filter((x) => x !== reviewProbatioId));
      if (q.length) add("state.review.agent", "block", where, `state "review" but agent gates not passed: ${q.join(", ")}`);
      if (status.get(reviewProbatioId) === "failed") add("state.review.failed", "block", where, `state "review" with a failed review — item belongs back in building`);
    }
    if (state === "done") {
      const missing = [...notPassed(automated), ...notPassed(agentGates), ...humanGates.filter((x) => status.has(x) && !["passed", "waived"].includes(status.get(x)!))];
      if (missing.length) add("state.done.probationes", "block", where, `state "done" but gates not passed: ${missing.join(", ")}`);
      const ids = new Set(certifies.values());
      if (ids.size > 1) add("probatio.certifies.mismatch", "advise", where, `gates certify different trees: ${[...ids].join(", ")}`);
    }
    if (state === "verifying" && !automated.some((x) => status.has(x)))
      add("state.verifying.none", "advise", where, `state "verifying" with no automated gate recorded`);

    checkTraditio(where, d["traditio"], state, ACTIVE.has(state));

    if (state === "halted") {
      for (const k of ["reason", "resume_when"]) if (!str(d[k])) add("halted.exit", "block", where, `halted item missing "${k}"`);
      const at = isoDate(d["halted_at"]) ?? (isDict(d["traditio"]) ? isoDate((d["traditio"] as Dict)["at"]) : undefined);
      if (!at) add("halted.at", "block", where, "halted item has no halted_at (age cannot be tracked)");
      else if (days(at, now) > defaults.halted_stale_days) add("halted.stale", "advise", where, `halted for ${days(at, now).toFixed(0)} days`);
    }
    if (WIP_STATES.has(state)) wip++;
    if (state === "backlog" && collegium) backlogByCollegium.set(collegium, (backlogByCollegium.get(collegium) ?? 0) + 1);
  }
  if (wipLimit !== undefined && wip > wipLimit) add("wip.cap", "block", "opera/", `${wip} items in progress, WIP cap is ${wipLimit}`);
  for (const [collegium, n] of backlogByCollegium)
    if (n > defaults.backlog_depth) add("backlog.depth", "advise", `opera/#${collegium}`, `${n} backlog items (cap ${defaults.backlog_depth})`);

  // ---- petitiones -----------------------------------------------------------
  const openByCollegium = new Map<string, number>();
  const petitioIds = new Set<string>();
  for (const p of safeList(join(root, "petitiones"))) {
    const where = rel(p);
    const fm = safeFront(p);
    if (!fm.data) { add("petitio.parse", "block", where, fm.error ?? "unreadable"); continue; }
    const d = fm.data;
    for (const k of ["id", "from", "to", "state"]) {
      if (d[k] === undefined) add("petitio.keys", "block", where, `missing "${k}"`);
      else if (!str(d[k])) add("petitio.keys.type", "block", where, `"${k}" must be a non-empty string`);
    }
    const id = str(d["id"]);
    if (id) {
      if (id !== basename(p, ".md")) add("petitio.id.filename", "block", where, `id "${id}" does not match filename`);
      if (petitioIds.has(id)) add("petitio.id.duplicate", "block", where, `duplicate id "${id}"`);
      petitioIds.add(id);
    }
    const s = str(d["state"]) ?? "";
    if (!(PETITIO_STATES as readonly string[]).includes(s)) add("petitio.state", "block", where, `state "${s}" invalid`);
    const from = str(d["from"]);
    const to = str(d["to"]);
    for (const [k, v] of [["from", from], ["to", to]] as const)
      if (v && v !== patron && !sellaIds.has(v)) add("petitio.party", "block", where, `${k} "${v}" is neither a sella nor the patron`);
    if (s === "needs_you" && to && to !== patron) add("petitio.direction", "block", where, `needs_you must be addressed to the patron (to: ${to})`);
    if (s === "awaiting_reply" && from && from !== patron) add("petitio.direction", "block", where, `awaiting_reply means the patron asked (from: ${from})`);
    if (d["opus"] !== undefined) {
      const w = str(d["opus"]);
      if (!w || !itemIds.has(w)) add("petitio.opus", "block", where, `opus "${w ?? ""}" does not exist`);
    }
    if (s !== "resolved") {
      const collegium = from ? sellaCollegium.get(from) : undefined;
      if (collegium) openByCollegium.set(collegium, (openByCollegium.get(collegium) ?? 0) + 1);
      if (d["opened"] !== undefined) {
        const opened = isoDate(d["opened"]);
        if (!opened) add("petitio.opened", "block", where, "opened must be an ISO date");
        else if (s === "needs_you" && days(opened, now) > defaults.ask_stale_days)
          add("petitio.age", "advise", where, `needs you for ${days(opened, now).toFixed(1)} days`);
      } else add("petitio.opened", "advise", where, "no opened date (age cannot be tracked)");
    }
  }
  for (const [collegium, n] of openByCollegium)
    if (n > defaults.open_asks) add("petitio.cap", "advise", `petitiones/#${collegium}`, `${n} open asks from ${collegium} (cap ${defaults.open_asks})`);

  // ---- acta -----------------------------------------------------------------
  const latestDaily = new Map<string, Date>();
  for (const p of safeList(join(root, "acta"))) {
    const where = rel(p);
    const fm = safeFront(p);
    if (!fm.data) { add("acta.parse", "block", where, fm.error ?? "unreadable"); continue; }
    const d = fm.data;
    for (const k of ["author", "kind", "title", "at"]) if (d[k] === undefined) add("acta.keys", "block", where, `missing "${k}"`);
    const a = str(d["author"]);
    if (d["author"] !== undefined && (!a || (!sellaIds.has(a) && a !== patron))) add("acta.author", "block", where, `author "${a ?? ""}" not a sella`);
    const k = str(d["kind"]) ?? "";
    if (!(ACTUM_KINDS as readonly string[]).includes(k)) add("acta.kind", "block", where, `kind "${k}" invalid`);
    const at = isoDate(d["at"]);
    if (d["at"] !== undefined && !at) add("acta.at", "block", where, "at must be an ISO date");
    if (at && k === "daily" && a) {
      const prev = latestDaily.get(a);
      if (!prev || at > prev) latestDaily.set(a, at);
    }
    const ev = d["evidence"];
    if (ev !== undefined) {
      if (!Array.isArray(ev)) add("acta.evidence", "block", where, "evidence must be a list");
      else for (const e of ev) {
        const href = isDict(e) ? str(e["href"]) : undefined;
        if (!href) add("acta.evidence", "block", where, "evidence entry has no href");
        else checkLink("link.dead", where, href, "digest evidence");
      }
    }
  }
  for (const [collegium, magister] of magisterOf) {
    const last = latestDaily.get(magister);
    if (!last) add("acta.daily", "advise", `acta/#${collegium}`, `magister "${magister}" has no daily acta`);
    else if (days(last, now) > defaults.daily_stale_days) add("acta.daily", "advise", `acta/#${collegium}`, `magister "${magister}" last daily ${days(last, now).toFixed(1)} days ago`);
  }

  // ---- aerarium: allowances only -------------------------------------------
  const aerariumDir = join(root, "aerarium");
  let aerariumFiles: string[] = [];
  try { aerariumFiles = existsSync(aerariumDir) ? readdirSync(aerariumDir).filter((f) => f.endsWith(".yml")).sort() : []; } catch { aerariumFiles = []; }
  if (aerariumFiles.length === 0) add("aerarium.present", "advise", "aerarium/", "no aerarium — postures will be unknown");
  for (const f of aerariumFiles) {
    const where = `aerarium/${f}`;
    const { data: b, error } = safeYaml(join(aerariumDir, f));
    if (!b) { add("aerarium.parse", "block", where, error ?? "unreadable"); continue; }
    const period = str(b["period"]) ?? (num(b["period"]) !== undefined ? String(b["period"]) : undefined);
    if (!period) add("aerarium.period", "block", where, "period missing");
    else if (period !== basename(f, ".yml")) add("aerarium.period.filename", "advise", where, `period "${period}" ≠ filename`);
    const cs = b["collegia"];
    if (!isDict(cs)) { add("aerarium.shape", "block", where, "collegia must be a mapping"); continue; }
    for (const [collegium, v] of Object.entries(cs)) {
      if (!collegiumIds.has(collegium)) add("aerarium.collegium", "block", where, `collegium "${collegium}" not declared`);
      if (!isDict(v)) { add("aerarium.shape", "block", where, `${collegium}: entry must be a mapping`); continue; }
      if (Object.keys(v).some((k) => k.startsWith("burn")))
        add("aerarium.mirror", "block", where, `${collegium}: burn is derived, never written (derive, never mirror)`);
      if (num(v["stipendium_tokens"]) === undefined && num(v["stipendium_hours"]) === undefined)
        add("aerarium.stipendium", "advise", where, `${collegium}: no allowance set (posture will be unknown)`);
    }
    for (const collegium of collegiumIds) if (!(collegium in cs)) add("aerarium.missing", "advise", where, `collegium "${collegium}" has no allowance this period`);
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
  for (const dir of ["opera", "petitiones", "acta"]) {
    const full = join(root, dir);
    try {
      if (!existsSync(full)) continue;
      for (const f of readdirSync(full))
        if (f !== ".gitkeep" && !f.endsWith(".md") && statSync(join(full, f)).isFile())
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
