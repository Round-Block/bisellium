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
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { listMd, readFront } from "@bisellium/adapter-native";
import type { Finding, Level, RuleOpts } from "../check.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

const PROVENANCE = ["stated", "observed", "inferred", "suggested"] as const;

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

export function checkProcess(root: string, _opts: RuleOpts): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, level: Level, where: string, message: string) => findings.push({ rule, level, where, message });

  // Never throws, and a non-officina yields no findings at all — same
  // contract as checkStudio itself, just scoped to this rule module.
  if (!existsSync(join(root, "bisellium.yml"))) return findings;

  const rel = (p: string) => (p.startsWith(root) ? p.slice(root.length + 1).replace(/\\/g, "/") : p);

  // ---- decisions/D-nnn.md --------------------------------------------------
  for (const p of safeList(join(root, "decisions"))) {
    const where = rel(p);
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

    const cls = str(data["class"]);
    const cascade = data["cascade"];
    if (cls && typeof cascade === "number" && Number.isFinite(cascade)) {
      if (!byClassCascade.has(cls)) byClassCascade.set(cls, new Map());
      const byCascade = byClassCascade.get(cls)!;
      if (!byCascade.has(cascade)) byCascade.set(cascade, new Set());
      byCascade.get(cascade)!.add(id ?? where);
    }
  }

  // lesson.recurrent (advise): a class appearing in >=2 distinct cascade
  // values across >=2 distinct lesson entries — a single lesson can't be
  // "recurrent" on its own, and a class re-filed twice in the same cascade
  // isn't recurrence, it's duplication.
  for (const [cls, byCascade] of byClassCascade) {
    if (byCascade.size < 2) continue;
    const entries = new Set<string>();
    for (const s of byCascade.values()) for (const x of s) entries.add(x);
    if (entries.size < 2) continue;
    add(
      "lesson.recurrent",
      "advise",
      "lessons/",
      `class "${cls}" recurs across ${byCascade.size} cascades (${[...entries].sort().join(", ")})`,
    );
  }

  if (_opts.repo) {
    try {
      const raw = execSync("git diff --name-only HEAD~1 HEAD", { cwd: _opts.repo, encoding: "utf8" });
      const files = raw.trim().split("\n").filter(Boolean);
      if (tddViolation(files)) {
        add("process.tdd", "advise", "HEAD", "last commit changed source code without a corresponding test change");
      }
      if (checkpointStale(files)) {
        add("process.checkpoint", "advise", "HEAD", "last commit changed opera without updating SESSION-HANDOFF.md or dossier progress");
      }
    } catch {
      // no git, shallow clone, or initial commit — skip silently
    }
  }

  return findings;
}
