/**
 * packages/cli/src/rules/process.ts — W-018 (2/4): decisions and lessons as
 * data. `decisions/D-nnn.md` and `lessons/L-nnn.md` are markdown with front
 * matter, same discipline as `opera/` and `petitiones/`. Contract for both
 * shapes lives in docs/ADOPTION.md.
 *
 * Seam S2: `checkProcess(root, opts)` never throws and returns `[]` for a
 * directory that isn't a Bisellium officina at all (no `bisellium.yml`) —
 * `root` is always the OFFICINA, never the repo root.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { listMd, parseFrontMatter, readFront, STATES } from "@bisellium/adapter-native";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { instant } from "@bisellium/schema";
import type { Finding, Level, RuleOpts } from "../check.js";
import { owedRetros } from "../retro.js";
import { RULE_IDS } from "./ids.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

// W-120: `killed_by` may only point into these officina directories.
const KILL_RECORD_DIRS = ["acta", "ci", "decisions", "lessons", "opera", "petitiones"];

const PROVENANCE = ["stated", "observed", "inferred", "suggested"] as const;

type AddressedKind = "opus" | "rule" | "decision";

function safeFront(path: string): Dict | undefined {
  try {
    const fm = readFront<unknown>(path);
    return isDict(fm.data) ? fm.data : undefined;
  } catch {
    return undefined;
  }
}

function safeList(dir: string): string[] {
  try {
    return listMd(dir);
  } catch {
    return [];
  }
}

const isExternal = (href: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(href);

const isSource = (f: string): boolean => /\.(tsx?|jsx?)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && !/\.css$/.test(f);
const isTest = (f: string): boolean => /\.test\.(tsx?|jsx?)$/.test(f);

export function tddViolation(files: string[]): boolean {
  const hasSource = files.some(isSource);
  const hasTest = files.some(isTest);
  return hasSource && !hasTest;
}

const isOpera = (f: string): boolean => /opera\//.test(f);
const isCheckpoint = (f: string): boolean => f === "docs/SESSION-HANDOFF.md" || f.includes("dossier/progress-body.html") || f.includes("dossier/body.html");

export function checkpointStale(files: string[]): boolean {
  return files.some(isOpera) && !files.some(isCheckpoint);
}

function gateField(probationes: unknown, gate: string, key: string): string | undefined {
  if (!isDict(probationes)) return undefined;
  const g = probationes[gate];
  return isDict(g) ? str(g[key]) : undefined;
}

function gateSella(probationes: unknown, gate: string): string | undefined {
  return gateField(probationes, gate, "sella");
}

/** process.cascade (advise): the same sella recorded for both the "spec"
 *  (builder's job) and "review" (censor's job) gates on one opus — one
 *  context built and reviewed its own work, the cascade model D-014 warns
 *  against (Sonnet 5 builds, Opus 5 for opus-tier roles). */
export function sameSellaBuiltAndReviewed(probationes: unknown): boolean {
  const spec = gateSella(probationes, "spec");
  const review = gateSella(probationes, "review");
  return spec !== undefined && review !== undefined && spec === review;
}

const isOpusTier = (model: string): boolean => /opus/i.test(model);

/** process.review_tier (advise): D-014 requires opus-tier models on review
 *  gates. Reads the `model` field `bisellium review --model <id>` writes
 *  onto the review gate itself — the model that actually ran the gate —
 *  rather than the sella id recorded there. A sella id is a declaration;
 *  checking it against `bisellium.yml`'s own declared binding (the previous
 *  shape of this rule) is a declaration checked against a declaration, and
 *  it was silent on the incident it was written for: the gate recorded
 *  `sella: eng-lead` (bound to claude-opus-5) while the review actually ran
 *  on the `censor` subagent under Sonnet 5 — a sella not even declared in
 *  the manifest. `model:` records what ran, so it is checkable directly.
 *
 *  Absent `model:` (every review gate recorded before this field existed)
 *  ADVISES rather than staying silent. The alternative — silent until each
 *  old gate is individually re-recorded — reproduces exactly the failure
 *  this rule exists to end: D-014 was already being violated with zero
 *  findings on the live officina, and a silent default would keep every
 *  pre-existing under-tier review invisible indefinitely. Advisory level
 *  (never blocking) keeps the cost of surfacing them to noise, not a stuck
 *  gate. */
export function reviewTierAdvisory(probationes: unknown): string | undefined {
  const sella = gateSella(probationes, "review");
  if (!sella) return undefined;
  const model = gateField(probationes, "review", "model");
  if (model === undefined) {
    return `review gate (sella "${sella}") has no recorded model — re-record with "bisellium review --model <id>" to verify tier`;
  }
  if (isOpusTier(model)) return undefined;
  return `review sella "${sella}" ran on ${model}, not an opus-tier model`;
}

export function checkProcess(root: string, _opts: RuleOpts): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, level: Level, where: string, message: string) => findings.push({ rule, level, where, message });

  // Never throws, and a non-officina yields no findings at all — same
  // contract as checkStudio itself, just scoped to this rule module.
  if (!existsSync(join(root, "bisellium.yml"))) return findings;

  const rel = (p: string) => (p.startsWith(root) ? p.slice(root.length + 1).replace(/\\/g, "/") : p);

  // ---- decisions/D-nnn.md --------------------------------------------------
  // decisionIds: hoisted here (not a new directory read) so lesson.addressed_by
  // and lesson.recurrent, evaluated later, can resolve a decision target —
  // existence on disk is what counts, so a decision is registered even when
  // its own shape is otherwise invalid.
  const decisionIds = new Set<string>();
  // W-120: decisions whose recorded kill is well-formed, for decision.invoked_after_kill.
  const killed = new Map<string, { at: Date; by: string }>();
  for (const p of safeList(join(root, "decisions"))) {
    const where = rel(p);
    decisionIds.add(basename(p, ".md"));
    const data = safeFront(p);
    if (!data) { add("decision.shape", "block", where, "unreadable, or front matter is not a mapping"); continue; }

    for (const k of ["id", "title", "at", "provenance", "by", "kill_when"]) {
      if (data[k] === undefined) add("decision.shape", "block", where, `missing required key "${k}"`);
    }
    const id = str(data["id"]);
    if (id && id !== basename(p, ".md")) add("decision.shape", "block", where, `id "${id}" does not match filename`);
    if (id !== undefined && data["id"] !== undefined && !str(data["id"]))
      add("decision.shape", "block", where, `"id" must be a non-empty string`);

    if (data["provenance"] !== undefined) {
      const provenance = data["provenance"];
      if (!str(provenance) || !(PROVENANCE as readonly string[]).includes(provenance as string))
        add("decision.shape", "block", where, `unknown provenance "${String(provenance)}"`);
    }
    if (data["at"] !== undefined && !str(data["at"]) && !(data["at"] instanceof Date))
      add("decision.shape", "block", where, `"at" must be an ISO date`);
    if (data["title"] !== undefined && !str(data["title"])) add("decision.shape", "block", where, `"title" must be a non-empty string`);
    if (data["by"] !== undefined && !str(data["by"])) add("decision.shape", "block", where, `"by" must be a non-empty string`);
    if (data["supersedes"] !== undefined && !str(data["supersedes"]))
      add("decision.shape", "block", where, `"supersedes" must be a non-empty string`);

    // W-120: killed_at / killed_by, both optional, judged together.
    const killedAt = data["killed_at"];
    const killedBy = data["killed_by"];
    if (killedAt !== undefined || killedBy !== undefined) {
      if (killedAt === undefined || killedBy === undefined) {
        add("decision.shape", "block", where, `"${killedAt === undefined ? "killed_at" : "killed_by"}" is missing — killed_at and killed_by are written together`);
      } else {
        let ok = true;
        const at = instant(killedAt);
        if (!at) { ok = false; add("decision.shape", "block", where, `"killed_at" must be an ISO date`); }
        const decided = instant(data["at"]);
        if (at && !decided) { ok = false; add("decision.shape", "block", where, `"at" is not a readable date, so "killed_at" cannot be judged against it`); }
        if (at && decided && at < decided) { ok = false; add("decision.shape", "block", where, `"killed_at" is earlier than the decision's own "at"`); }
        const first = typeof killedBy === "string" ? killedBy.split(/[\\/]/)[0] ?? "" : "";
        if (typeof killedBy !== "string" || !KILL_RECORD_DIRS.includes(first) || "error" in readContainedRegularFile(root, killedBy, first)) {
          ok = false;
          add("decision.shape", "block", where, `"killed_by" must name an existing officina file under ${KILL_RECORD_DIRS.join(", ")}`);
        }
        if (ok && at && typeof killedBy === "string") killed.set(basename(p, ".md"), { at, by: killedBy });
      }
    }

    // decision.kill: a decision with no kill condition is a belief.
    const killWhen = data["kill_when"];
    if (data["kill_when"] !== undefined) {
      if (!str(killWhen)) add("decision.kill", "block", where, `"kill_when" must be a non-empty string`);
    } else if (data["id"] !== undefined) {
      // missing entirely is already reported once by decision.shape above;
      // decision.kill still fires so the empty-belief condition is caught
      // by its own, dedicated rule id regardless of what else is wrong.
      add("decision.kill", "block", where, `kill_when missing — a decision with no kill condition is a belief`);
    }
  }

  // ---- lessons/L-nnn.md -----------------------------------------------------
  // class -> cascade number -> set of lesson ids that reported it, for
  // lesson.recurrent below.
  const byClassCascade = new Map<string, Map<number, Set<string>>>();

  // addressedClaims: one entry per lesson whose front matter has
  // addressed_by !== undefined, for lesson.addressed_by below. claimsByClass:
  // class -> the non-empty string addressed_by values, in lesson-file order,
  // for lesson.recurrent's three-way resolution. This loop only collects —
  // it runs before the opera loop, which is what resolveAddressedBy needs
  // for an "opus" target, so both new behaviours are evaluated after it.
  const addressedClaims: { where: string; value: unknown }[] = [];
  const claimsByClass = new Map<string, string[]>();

  for (const p of safeList(join(root, "lessons"))) {
    const where = rel(p);
    const data = safeFront(p);
    if (!data) { add("lesson.shape", "block", where, "unreadable, or front matter is not a mapping"); continue; }

    for (const k of ["id", "at", "class", "evidence"]) {
      if (data[k] === undefined) add("lesson.shape", "block", where, `missing required key "${k}"`);
    }
    const id = str(data["id"]);
    if (id && id !== basename(p, ".md")) add("lesson.shape", "block", where, `id "${id}" does not match filename`);
    if (data["class"] !== undefined && !str(data["class"])) add("lesson.shape", "block", where, `"class" must be a non-empty string`);
    if (data["at"] !== undefined && !str(data["at"]) && !(data["at"] instanceof Date))
      add("lesson.shape", "block", where, `"at" must be an ISO date`);

    // lesson.evidence: required and non-empty (also the exact contract
    // draftRetro enforces before it will ever write a lesson stub).
    const ev = data["evidence"];
    if (ev === undefined) {
      add("lesson.evidence", "block", where, `evidence missing — an empty or dead evidence list is never enough`);
    } else if (!Array.isArray(ev) || ev.length === 0) {
      add("lesson.evidence", "block", where, `evidence must be a non-empty list`);
    } else {
      for (const href of ev) {
        if (typeof href !== "string" || href.length === 0) {
          add("lesson.evidence", "block", where, "evidence entry must be a non-empty string href");
          continue;
        }
        if (isExternal(href)) continue; // external URLs are not verified offline
        let ok = false;
        try { ok = existsSync(join(root, href)); } catch { ok = false; }
        if (!ok) add("lesson.evidence", "block", where, `evidence "${href}" not found under studio (dead link)`);
      }
    }

    if (data["addressed_by"] !== undefined) addressedClaims.push({ where, value: data["addressed_by"] });
    // lesson.unfixed (advise, D-039 §3): every lesson names its fix.
    else add("lesson.unfixed", "advise", where, `${basename(p, ".md")} names no fix (addressed_by)`);

    const cls = str(data["class"]);
    const ab = str(data["addressed_by"]);
    if (cls && ab) {
      if (!claimsByClass.has(cls)) claimsByClass.set(cls, []);
      claimsByClass.get(cls)!.push(ab);
    }

    const cascade = data["cascade"];
    if (cls && typeof cascade === "number" && Number.isFinite(cascade)) {
      if (!byClassCascade.has(cls)) byClassCascade.set(cls, new Map());
      const byCascade = byClassCascade.get(cls)!;
      if (!byCascade.has(cascade)) byCascade.set(cascade, new Set());
      byCascade.get(cascade)!.add(id ?? where);
    }
  }

  // ---- opera/*.md probationes (process.cascade, process.review_tier) ------
  // Shape errors (bad gate mappings etc.) are check.ts's job; these rules
  // only ask whether a readable opus's recorded review gate looks right.
  // operaStates: hoisted here (state, keyed by the canonical filename id) so
  // resolveAddressedBy below can recognise an "opus" target — the lessons
  // loop above only collects, since it runs before this one.
  const operaStates = new Map<string, string | undefined>();
  const opusEnds = new Map<string, { where: string; end: unknown }>();
  for (const p of safeList(join(root, "opera"))) {
    const where = rel(p);
    const data = safeFront(p);
    if (!data) continue;
    operaStates.set(basename(p, ".md"), str(data["state"]));
    opusEnds.set(basename(p, ".md"), { where, end: data["end"] });
    if (sameSellaBuiltAndReviewed(data["probationes"])) {
      const sella = gateSella(data["probationes"], "spec");
      add("process.cascade", "advise", where, `sella "${sella}" recorded for both spec and review — one context built and reviewed its own work`);
    }
    const tierMsg = reviewTierAdvisory(data["probationes"]);
    if (tierMsg) add("process.review_tier", "advise", where, tierMsg);

    // W-120 decision.invoked_after_kill: a halt or a gate waiver citing a decision at or after its recorded kill.
    const invoke = (label: string, cited: unknown, at: unknown) => {
      if (cited === undefined) return; // only an absent key is silent; an explicit null is malformed
      if (!str(cited)) {
        // fail closed: a citation that is not a decision id string could be any decision
        add("decision.invoked_after_kill", "block", where, `${label} is not a decision id string (${JSON.stringify(cited)}); a malformed citation cannot be shown to avoid a killed decision`);
        return;
      }
      const id = cited as string;
      const k = killed.get(id);
      if (!k) return;
      const t = instant(at);
      if (t && t < k.at) return;
      add("decision.invoked_after_kill", "block", where, `${label} ${id} at ${t ? t.toISOString() : "(no time)"} invokes a decision killed at ${k.at.toISOString()} (${k.by}); a fired clause is not an excuse`);
    };
    invoke("halted_by", data["halted_by"], data["halted_at"]);
    if (isDict(data["probationes"])) {
      for (const [gate, g] of Object.entries(data["probationes"])) {
        if (isDict(g)) invoke(`gate "${gate}" waived_by`, g["waived_by"], g["at"]);
      }
    }
  }

  // retro.overdue (advise, D-039 §1): a done opus owes its retro. `owedRetros` is the one reader of the setting and
  // of retro-filed status; its error is check.ts's manifest.shape block, so here it adds nothing.
  const owed = owedRetros(root);
  if ("owed" in owed)
    for (const id of owed.owed) {
      const at = opusEnds.get(id);
      if (at) add("retro.overdue", "advise", at.where, `${id} is done (${String(at.end)}) and its retro is not filed: bisellium retro --opus ${id} --from <triage.json>`);
    }

  // resolveAddressedBy: first match wins, in that fixed order. The three id
  // spaces are disjoint in practice (bisellium new / draftRetro allocate
  // W-nnn/D-nnn/L-nnn/P-nnn, and every rule id contains a "."), so there is
  // no ambiguity to detect or report — a second finding for one condition.
  function resolveAddressedBy(v: string): AddressedKind | undefined {
    if (operaStates.has(v)) return "opus";
    if (RULE_IDS.has(v)) return "rule";
    if (decisionIds.has(v)) return "decision";
    return undefined;
  }

  // lesson.addressed_by (block): validates whenever the key is present,
  // regardless of whether the lesson's class is recurrent — a key that does
  // not resolve is wrong on a one-off class too.
  for (const { where, value } of addressedClaims) {
    if (typeof value !== "string" || value.length === 0) {
      add("lesson.addressed_by", "block", where, `"addressed_by" must be a non-empty string`);
      continue;
    }
    if (resolveAddressedBy(value) === undefined) {
      add("lesson.addressed_by", "block", where, `addressed_by "${value}" names no opus, rule id, or decision`);
    }
  }

  // lesson.recurrent (advise): a class appearing in >=2 distinct cascade
  // values across >=2 distinct lesson entries — a single lesson can't be
  // "recurrent" on its own, and a class re-filed twice in the same cascade
  // isn't recurrence, it's duplication. Three-way: silent once some claim
  // for the class resolves to a rule, a decision, or a done opus; otherwise
  // in-flight (naming the lexicographically smallest not-done opus) or
  // unaddressed. A value that does not resolve at all counts as addressing
  // nothing — a typo must not be able to buy silence.
  for (const [cls, byCascade] of byClassCascade) {
    if (byCascade.size < 2) continue;
    const entries = new Set<string>();
    for (const s of byCascade.values()) for (const x of s) entries.add(x);
    if (entries.size < 2) continue;

    let silent = false;
    let inflightOpus: string | undefined;
    for (const v of claimsByClass.get(cls) ?? []) {
      const kind = resolveAddressedBy(v);
      if (kind === "rule" || kind === "decision") { silent = true; break; }
      if (kind === "opus") {
        if (operaStates.get(v) === "done") { silent = true; break; }
        if (inflightOpus === undefined || v < inflightOpus) inflightOpus = v;
      }
    }
    if (silent) continue;

    const prefix = `class "${cls}" recurs across ${byCascade.size} cascades (${[...entries].sort().join(", ")})`;
    if (inflightOpus !== undefined) {
      add("lesson.recurrent", "advise", "lessons/", `${prefix} — addressed by ${inflightOpus} (${operaStates.get(inflightOpus) ?? "unknown"}), not yet done`);
    } else {
      add("lesson.recurrent", "advise", "lessons/", `${prefix} — no lesson names what addresses it`);
    }
  }

  if (_opts.repo) {
    try {
      const raw = execSync("git diff --name-only HEAD~1 HEAD", {
        cwd: _opts.repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const files = raw.trim().split("\n").filter(Boolean);
      if (tddViolation(files)) {
        add("process.tdd", "advise", "HEAD", "last commit changed source code without a corresponding test change");
      }
      if (checkpointStale(files)) {
        add("process.checkpoint", "advise", "HEAD", "last commit changed opera without updating SESSION-HANDOFF.md or dossier progress");
      }
    } catch {
      // no git, shallow clone, or initial commit — process.tdd and
      // process.checkpoint can't be evaluated; say so instead of swallowing
      // it (this used to leak the underlying `git` fatal to inherited
      // stderr in CI, since execSync default-inherits stdio — now piped and
      // discarded above).
      add(
        "process.history",
        "advise",
        "HEAD",
        "git history unavailable (shallow clone or no git) — process.tdd and process.checkpoint not evaluated",
      );
    }
  }

  return findings;
}

// ---- W-186: the session handoff ---------------------------------------------
const HANDOFF_REL = "docs/SESSION-HANDOFF.md";
const STATE_IDS: ReadonlySet<string> = new Set(STATES.map((s) => s.id));
const ID_TOKEN = /\bW-\d+\b/g;

export interface HandoffOpus {
  state: string;
  end?: unknown;
}
export type HandoffInputs = { kind: "error"; reason: string } | { kind: "absent"; opera: Map<string, HandoffOpus> } | { kind: "ok"; text: string; opera: Map<string, HandoffOpus> };

/** W-186: every <studio>/opera/*.md, then <repo>/docs/SESSION-HANDOFF.md, read fail-closed; never throws. */
export function handoffInputs(repo: string, studio: string): HandoffInputs {
  const opera = new Map<string, HandoffOpus>();
  let names: string[];
  try {
    names = readdirSync(join(studio, "opera"));
  } catch (e) {
    return { kind: "error", reason: `opera/ cannot be listed: ${(e as Error).message}` };
  }
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const file = `opera/${name}`;
    const read = readContainedRegularFile(studio, file, "opera");
    if ("error" in read) return { kind: "error", reason: `${file} cannot be read: ${read.error}` };
    let data: unknown;
    try {
      data = parseFrontMatter<unknown>(read.bytes.toString("utf8"), file).data;
    } catch (e) {
      return { kind: "error", reason: `${file} does not parse: ${(e as Error).message}` };
    }
    if (!isDict(data)) return { kind: "error", reason: `${file}: front matter is not a mapping` };
    const state = data["state"];
    if (typeof state !== "string" || !STATE_IDS.has(state)) return { kind: "error", reason: `${file}: state is not a lifecycle state` };
    opera.set(name.slice(0, -3), { state, end: data["end"] });
  }
  const read = readContainedRegularFile(repo, HANDOFF_REL, "docs");
  if ("error" in read) return read.code === "ENOENT" ? { kind: "absent", opera } : { kind: "error", reason: `${HANDOFF_REL} cannot be read: ${read.error}` };
  return { kind: "ok", text: read.bytes.toString("utf8"), opera };
}

/** The lines (0-based) strictly between the heading at `from` and the next line starting `## `. */
function sectionOf(lines: string[], from: number): number[] {
  const out: number[] = [];
  for (let i = from + 1; i < lines.length && !lines[i]!.startsWith("## "); i++) out.push(i);
  return out;
}

/** W-186: every `block` finding for one handoff text against the opera, keyed by filename id. Pure; never throws. */
export function sessionHandoffFindings(text: string, opera: ReadonlyMap<string, HandoffOpus>): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, line: number | undefined, message: string): void => {
    findings.push({ rule, level: "block", where: line === undefined ? HANDOFF_REL : `${HANDOFF_REL}:${line}`, message });
  };
  const lines = text.split("\n");
  const headings = (re: RegExp): number[] => lines.flatMap((l, i) => (re.test(l) ? [i] : []));
  const queueAt = headings(/^## Queue\s*$/);
  const resumeAt = headings(/^## Resume point/);
  const stateOf = (id: string): string | undefined => opera.get(id)?.state;

  let headed = true;
  if (queueAt.length !== 1) {
    headed = false;
    add("process.handoff.input", queueAt[1] === undefined ? undefined : queueAt[1] + 1, queueAt.length === 0 ? "no ## Queue heading" : "more than one ## Queue heading");
  }
  let resumeDate = "";
  if (resumeAt.length !== 1) {
    headed = false;
    add("process.handoff.input", resumeAt[1] === undefined ? undefined : resumeAt[1] + 1, resumeAt.length === 0 ? "no ## Resume point heading" : "more than one ## Resume point heading");
  } else {
    const m = /^## Resume point \((\d{4})-(\d{2})-(\d{2})\)\s*$/.exec(lines[resumeAt[0]!]!);
    resumeDate = m === null ? "" : `${m[1]}-${m[2]}-${m[3]}`;
    // a real calendar date: it survives a Date.UTC round trip
    if (m === null || new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) !== resumeDate) {
      headed = false;
      add("process.handoff.input", resumeAt[0]! + 1, "the Resume heading must be ## Resume point (YYYY-MM-DD) with a real date");
    }
  }

  if (headed) {
    // Queue: every id token in the section; a done or halted one is stale, and every greenlit opus must be named
    const queued = new Set<string>();
    for (const i of sectionOf(lines, queueAt[0]!)) {
      for (const id of lines[i]!.match(ID_TOKEN) ?? []) {
        if (queued.has(id)) continue;
        queued.add(id);
        const state = stateOf(id);
        if (state === undefined) add("process.handoff.input", i + 1, `${id} has no record`);
        else if (state === "done" || state === "halted") add("process.handoff.queue", i + 1, `the Queue names ${id}, which is ${state}`);
      }
    }
    for (const id of [...opera.keys()].sort()) if (opera.get(id)!.state === "greenlit" && !queued.has(id)) add("process.handoff.queue", undefined, `${id} is greenlit and the Queue does not name it`);

    // Resume: the Next field, status claims about a done opus, and the date
    const resume = sectionOf(lines, resumeAt[0]!);
    const seen = new Set<string>();
    for (let k = 0; k < resume.length; k++) {
      if (!/^(- )?(\*\*)?Next\b[^:\n]*:/.test(lines[resume[k]!]!)) continue;
      let end = k;
      while (end + 1 < resume.length && /^\s+\S/.test(lines[resume[end + 1]!]!)) end++;
      for (const i of resume.slice(k, end + 1)) {
        for (const id of lines[i]!.match(ID_TOKEN) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const state = stateOf(id);
          if (state === undefined) add("process.handoff.input", i + 1, `${id} has no record`);
          else if (state === "done" || state === "halted") add("process.handoff.resume", i + 1, `Next names ${id}, which is ${state}`);
          else if (!queued.has(id)) add("process.handoff.resume", i + 1, `Next names ${id}, which the Queue does not name`);
        }
      }
      k = end;
    }
    for (const i of resume) {
      for (const m of lines[i]!.matchAll(/\*\*(W-\d+)\*\*[^.\n]*\b(is building|in review|waits? to merge)/g)) {
        const id = m[1]!;
        const state = stateOf(id);
        if (state === undefined) add("process.handoff.input", i + 1, `${id} has no record`);
        else if (state === "done") add("process.handoff.resume", i + 1, `${id} is claimed ${m[2]}, but it is done`);
      }
    }
    let newest = "";
    for (const o of opera.values()) {
      const at = o.state === "done" ? instant(o.end) : undefined;
      if (at !== undefined && at.toISOString().slice(0, 10) > newest) newest = at.toISOString().slice(0, 10);
    }
    if (newest !== "" && resumeDate < newest) add("process.handoff.resume", resumeAt[0]! + 1, `the Resume date ${resumeDate} is earlier than ${newest}, the day the newest opus was done`);
  }

  // Whole file: relative references and the line cap
  lines.forEach((l, i) => {
    if (/\bthis (one|PR)\b|\babove\)/i.test(l)) add("process.handoff.reference", i + 1, "a relative reference (this one, this PR, above) is stale once the file moves on");
  });
  if (lines.length > 100) add("process.handoff.lines", undefined, `${lines.length} lines; the cap is 100`);
  return findings;
}

/** W-186: an S2 rule module: [] unless `opts.repo` is set and `resolve(root) === resolve(opts.repo, "studio")`. */
export function checkSessionHandoff(root: string, opts: RuleOpts): Finding[] {
  if (opts.repo === undefined || resolve(root) !== resolve(opts.repo, "studio")) return [];
  const read = handoffInputs(opts.repo, root);
  if (read.kind === "error") return [{ rule: "process.handoff.input", level: "block", where: HANDOFF_REL, message: read.reason }];
  return read.kind === "absent" ? [] : sessionHandoffFindings(read.text, read.opera);
}
