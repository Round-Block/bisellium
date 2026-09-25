/**
 * packages/cli/src/rules/evidence.ts — P-001 items 2 and 3 (decreed
 * 2026-09-19): `opus.untracked` and `opus.red_evidence`, block. Seam S2:
 * `root` is the OFFICINA, `opts.repo` the repo root (present only with
 * `--repo`). Never throws; [] for a directory with no `bisellium.yml`.
 *
 * `opus.untracked` needs one git call for the whole rule (`git ls-files
 * --others --exclude-standard`, cwd `opts.repo`) — a rule that can't observe
 * (no repo, no git, a timeout) says nothing rather than guessing.
 *
 * `opus.red_evidence` reads W-020's `ci/reds/<id>/<NN>.log` contract
 * (declared verbatim in both briefs) but never writes it — that's
 * `bisellium red`'s job alone.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readFront } from "@bisellium/adapter-native";
import type { Finding, RuleOpts } from "../check.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

const ACTIVE = new Set(["building", "verifying", "review"]);
const TIMEOUT_MS = 30_000;

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
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** repo-relative POSIX path of `absPath` under `repo`, or undefined when it
 *  doesn't resolve inside `repo` — the resolved-path relation, not a
 *  string-prefix test. */
function repoRelative(repo: string, absPath: string): string | undefined {
  const rel = relative(repo, absPath);
  if (isAbsolute(rel)) return undefined;
  if (rel.split(sep)[0] === "..") return undefined;
  return rel.split(sep).join("/");
}

/** `git ls-files --others --exclude-standard` in `repo`, as a Set of
 *  repo-relative POSIX paths — undefined when git isn't available, `repo`
 *  isn't a repository, or the command fails or times out. */
function untrackedFiles(repo: string): Set<string> | undefined {
  try {
    const out = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: repo,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    return new Set(out.split("\n").filter((l) => l.length > 0));
  } catch {
    return undefined;
  }
}

function checkUntracked(root: string, opts: RuleOpts): Finding[] {
  if (!opts.repo) return [];
  const untracked = untrackedFiles(opts.repo);
  if (!untracked) return [];

  const findings: Finding[] = [];
  for (const p of safeList(join(root, "opera"))) {
    const d = safeFront(p);
    if (!d) continue;
    const state = str(d["state"]);
    if (!state || !ACTIVE.has(state)) continue;

    const operaRel = repoRelative(opts.repo, p);
    if (operaRel && untracked.has(operaRel))
      findings.push({ rule: "opus.untracked", level: "block", where: operaRel, message: `"${operaRel}" is untracked` });

    const spec = str(d["spec"]);
    if (spec) {
      const briefRel = repoRelative(opts.repo, resolve(root, spec));
      if (briefRel && untracked.has(briefRel))
        findings.push({
          rule: "opus.untracked",
          level: "block",
          where: operaRel ?? p,
          message: `brief "${briefRel}" is untracked`,
        });
    }
  }
  return findings;
}

/** Exported for the test: N = the count of the ordered list directly under
 *  "## Behaviours to test" in a brief. Items match `^\s{0,3}\d+\.\s`;
 *  continuation lines, nested/indented items, bullet lists, and anything
 *  inside a fenced code block or after the next `^## ` heading don't count. */
export function countBehaviours(briefText: string): number {
  const lines = briefText.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## Behaviours to test");
  if (start === -1) return 0;

  let count = 0;
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^## /.test(line)) break;
    if (/^\s{0,3}\d+\.\s/.test(line)) count++;
  }
  return count;
}

/** The leading `# key: value` header lines of a red log (W-020's contract),
 *  stopping at the first non-header line. */
function parseLogHeader(text: string): Map<string, string> {
  const header = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^#\s*([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!m) break;
    header.set(m[1]!.toLowerCase(), (m[2] ?? "").trim());
  }
  return header;
}

function stripHeader(text: string): string {
  const lines = text.split(/\r?\n/);
  const firstNonHeader = lines.findIndex((l) => !/^#\s*[A-Za-z_]+:/.test(l));
  return (firstNonHeader === -1 ? [] : lines.slice(firstNonHeader)).join("\n").trim();
}

export function isDuplicateRed(a: string, b: string): boolean {
  const bodyA = stripHeader(a);
  const bodyB = stripHeader(b);
  return bodyA.length > 0 && bodyA === bodyB;
}

const MODULE_LOAD_RE = /ERR_MODULE_NOT_FOUND|SyntaxError:.*does not provide an export named/;

export function isModuleLoadFailure(text: string): boolean {
  return MODULE_LOAD_RE.test(text);
}

function checkRedEvidence(root: string): Finding[] {
  const redsDir = join(root, "ci", "reds");
  if (!existsSync(redsDir)) return [];

  const findings: Finding[] = [];
  for (const p of safeList(join(root, "opera"))) {
    const d = safeFront(p);
    if (!d) continue;
    const state = str(d["state"]);
    if (!state || !ACTIVE.has(state)) continue;
    const id = str(d["id"]);
    const spec = str(d["spec"]);
    if (!id || !spec) continue;

    const briefAbs = resolve(root, spec);
    const briefRel = relative(root, briefAbs);
    if (isAbsolute(briefRel) || briefRel.split(sep)[0] === "..") continue; // must resolve inside the officina

    let briefText: string;
    try {
      briefText = readFileSync(briefAbs, "utf8");
    } catch {
      continue;
    }

    const where = relative(root, p).split(sep).join("/");
    const n = countBehaviours(briefText);
    if (n === 0) {
      findings.push({
        rule: "opus.red_evidence",
        level: "advise",
        where,
        message: "brief lists no numbered behaviours — nothing to prove",
      });
      continue;
    }

    const missing: number[] = [];
    const notRed: number[] = [];
    const moduleLoad: number[] = [];
    const logTexts = new Map<number, string>();
    for (let nn = 1; nn <= n; nn++) {
      const logPath = join(redsDir, id, `${String(nn).padStart(2, "0")}.log`);
      if (!existsSync(logPath)) {
        missing.push(nn);
        continue;
      }
      let logText: string;
      try {
        logText = readFileSync(logPath, "utf8");
      } catch {
        missing.push(nn);
        continue;
      }
      logTexts.set(nn, logText);
      const exit = parseLogHeader(logText).get("exit");
      if (exit === undefined || !/^-?\d+$/.test(exit) || exit === "0") notRed.push(nn);
      if (isModuleLoadFailure(logText)) moduleLoad.push(nn);
    }

    // P-005 part 2: module-load failure is not assertion-level
    if (moduleLoad.length)
      findings.push({
        rule: "opus.red_content",
        level: "advise",
        where,
        message: `red(s) for behaviour(s) ${moduleLoad.join(", ")} are module-load failures, not assertion-level`,
      });

    // P-005 part 1: duplicate reds (byte-identical after header strip)
    const texts = [...logTexts.entries()];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        if (isDuplicateRed(texts[i]![1], texts[j]![1])) {
          findings.push({
            rule: "opus.red_content",
            level: "block",
            where,
            message: `red logs for behaviours ${texts[i]![0]} and ${texts[j]![0]} are identical after header strip`,
          });
        }
      }
    }

    if (missing.length)
      findings.push({
        rule: "opus.red_evidence",
        level: "block",
        where,
        message: `missing red log(s) for behaviour(s) ${missing.join(", ")}`,
      });
    if (notRed.length)
      findings.push({
        rule: "opus.red_evidence",
        level: "block",
        where,
        message: `red log(s) for behaviour(s) ${notRed.join(", ")} record a passing run, not a red`,
      });

    // W-039: opus.red_sella (advise). logTexts is already scoped to this
    // opus's in-contract behaviours 1..n — an off-contract file (e.g.
    // close-bugs-red.log) was never read into it. A log names no one when
    // its header has no `sella` key, or the trimmed value is empty or
    // "guest" (the anonymity this rule flags, not the name itself).
    const noSella: string[] = [];
    for (const [nn, logText] of logTexts) {
      const sella = parseLogHeader(logText).get("sella")?.trim();
      if (sella === undefined || sella === "" || sella === "guest") noSella.push(`${String(nn).padStart(2, "0")}.log`);
    }
    if (noSella.length)
      findings.push({
        rule: "opus.red_sella",
        level: "advise",
        where: `ci/reds/${id}/`,
        message: `${noSella.length} red log(s) record no sella: ${noSella.join(", ")}`,
      });
  }
  return findings;
}

/** Remove the three contexts which carry examples rather than live
 * citations. Fence tracking deliberately mirrors countBehaviours: only a
 * backtick fence marker at Markdown's top three indentation columns toggles
 * the fenced region. Inline code may use any matching backtick-run length;
 * an unmatched delimiter is prose, not a span. */
function citationProse(briefText: string): string {
  const prose: string[] = [];
  let inFence = false;
  for (const line of briefText.split(/\r?\n/)) {
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) prose.push(line);
  }
  return prose
    .join("\n")
    .replace(/(`+)[\s\S]*?\1/g, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "");
}

function checkBehaviourCitations(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const p of safeList(join(root, "briefs"))) {
    let briefText: string;
    try {
      briefText = readFileSync(p, "utf8");
    } catch {
      continue;
    }

    const declared = countBehaviours(briefText);
    if (declared === 0) continue;
    for (const match of citationProse(briefText).matchAll(/\bBehaviour (\d+)\b/g)) {
      const cited = Number(match[1]);
      if (cited <= declared) continue;
      findings.push({
        rule: "brief.behaviour_citation",
        level: "block",
        where: relative(root, p).split(sep).join("/"),
        message: `brief cites Behaviour ${cited} but declares ${declared} behaviours`,
      });
    }
  }
  return findings;
}

export function checkEvidence(root: string, opts: RuleOpts): Finding[] {
  if (!existsSync(join(root, "bisellium.yml"))) return [];
  return [...checkUntracked(root, opts), ...checkRedEvidence(root), ...checkBehaviourCitations(root)];
}
