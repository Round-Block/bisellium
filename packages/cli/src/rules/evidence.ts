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
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { listMd, parseFrontMatter } from "@bisellium/adapter-native";
import { currentBranch, readContainedRegularFile, validateProtectedRecords } from "@bisellium/commands/opus-model.js";
import type { Finding, RuleOpts } from "../check.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

const ACTIVE = new Set(["building", "verifying", "review"]);
const TIMEOUT_MS = 30_000;

function safeFront(root: string, path: string): Dict | undefined {
  try {
    const rel = relative(root, path).split(sep).join("/");
    const contained = readContainedRegularFile(root, rel, "opera");
    if ("error" in contained) return undefined;
    const fm = parseFrontMatter<unknown>(contained.bytes.toString("utf8"), path);
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
    const d = safeFront(root, p);
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
    const d = safeFront(root, p);
    if (!d) continue;
    const state = str(d["state"]);
    if (!state || !ACTIVE.has(state)) continue;
    const id = str(d["id"]);
    const spec = str(d["spec"]);
    if (!id || !spec) continue;

    const where = relative(root, p).split(sep).join("/");
    const brief = readContainedRegularFile(root, spec, "briefs");
    if ("error" in brief) {
      findings.push({
        rule: "opus.red_evidence",
        level: "block",
        where,
        message: `brief evidence is unsafe or unreadable: ${brief.error}`,
      });
      continue;
    }
    const briefText = brief.bytes.toString("utf8");
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
      const logRel = `ci/reds/${id}/${String(nn).padStart(2, "0")}.log`;
      const log = readContainedRegularFile(root, logRel, "ci");
      if ("error" in log) {
        missing.push(nn);
        continue;
      }
      const logText = log.bytes.toString("utf8");
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

const INVALID_RED_OUTPUT =
  /ERR_MODULE_NOT_FOUND|SyntaxError:|command not found|ENOENT|unknown (?:option|flag)|not permitted|permission denied|operation not permitted|sandbox/i;

/** W-096's seven reds are selectable completed TAP assertion failures. */
export function isW096AssertionRed(text: string, behaviour: number): boolean {
  const header = parseLogHeader(text);
  const command = header.get("command") ?? "";
  const selected = new RegExp(`(?:^|\\s)--behaviour\\s+${behaviour}(?:\\s|$)`).test(command);
  const name = `W-096 behaviour ${behaviour}:`;
  const body = stripHeader(text);
  const exit = header.get("exit") ?? "";
  if (header.get("behaviour") !== String(behaviour) || !/^-?\d+$/.test(exit) || exit === "0" || !selected || INVALID_RED_OUTPUT.test(body)) return false;
  // The TAP stream must be the command's output, not a later quoted/heredoc
  // fixture embedded in shell diagnostics or source text.
  if (!body.startsWith("TAP version 13\n")) return false;
  const statuses = [...body.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)];
  if (statuses.length !== 1 || !statuses[0]![0].startsWith("not ok ") || !statuses[0]![1]!.startsWith(name)) return false;
  const diagnosticStart = body.indexOf("\n  ---\n", statuses[0]!.index);
  const diagnosticEnd = diagnosticStart < 0 ? -1 : body.indexOf("\n  ...", diagnosticStart + 7);
  if (diagnosticStart < 0 || diagnosticEnd < 0 || !/^\s*code: ['"]ERR_ASSERTION['"]\s*$/m.test(body.slice(diagnosticStart, diagnosticEnd))) return false;
  const plan = /^1\.\.(\d+)\s*$/m.exec(body);
  const tests = /^# tests (\d+)\s*$/m.exec(body);
  const failed = /^# fail (\d+)\s*$/m.exec(body);
  const passed = /^# pass (\d+)\s*$/m.exec(body);
  return plan?.[1] === "1" && tests?.[1] === "1" && failed?.[1] === "1" && (passed?.[1] ?? "0") === "0" && !/^ok \d+ -/m.test(body);
}

function checkW096AssertionReds(root: string): Finding[] {
  const path = join(root, "opera", "W-096.md");
  const record = safeFront(root, path);
  const state = record ? str(record["state"]) : undefined;
  if (!state || !new Set(["building", "verifying", "review", "done"]).has(state)) return [];
  const bad: number[] = [];
  for (let behaviour = 1; behaviour <= 7; behaviour++) {
    const log = readContainedRegularFile(root, `ci/reds/W-096/${String(behaviour).padStart(2, "0")}.log`, "ci");
    if ("error" in log || !isW096AssertionRed(log.bytes.toString("utf8"), behaviour)) {
      bad.push(behaviour);
    }
  }
  return bad.length
    ? [{ rule: "opus.red_assertion", level: "block", where: "opera/W-096.md", message: `behaviour red(s) ${bad.join(", ")} are missing or not completed selected Node TAP ERR_ASSERTION failures` }]
    : [];
}

const W096_RECORD_PATH = "studio/opera/W-096.md";

/** Resolve the physical officina which owns W-096 from the pinned record at
 * HEAD and require that the pin's baseline tree contains that same record.
 * The canonical native path remains the fail-closed fallback when the record
 * history itself cannot be inspected; callers must still compare physical
 * paths before applying the gate. */
function w096OwningStudio(repoArg: string): string {
  const repoReal = realpathSync(resolve(repoArg));
  try {
    const raw = execFileSync("git", ["show", `HEAD:${W096_RECORD_PATH}`], {
      cwd: repoReal,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
    const parsed = parseFrontMatter<unknown>(raw, W096_RECORD_PATH);
    const baseline = isDict(parsed.data) ? str(parsed.data["baseline_commit"]) : undefined;
    if (!baseline || !/^[0-9a-f]{40}$/.test(baseline)) throw new Error("the committed W-096 record has no usable baseline pin");
    const entry = execFileSync("git", ["ls-tree", baseline, "--", W096_RECORD_PATH], {
      cwd: repoReal,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    }).trim();
    if (!/^100(?:644|755) blob [0-9a-f]+\tstudio\/opera\/W-096\.md$/.test(entry))
      throw new Error("the pinned baseline tree does not contain the W-096 record");
    return realpathSync(join(repoReal, dirname(dirname(W096_RECORD_PATH))));
  } catch {
    return realpathSync(join(repoReal, "studio"));
  }
}

function checkW096ProtectedRecords(root: string, opts: RuleOpts): Finding[] {
  const record = safeFront(root, join(root, "opera", "W-096.md"));
  const unverifiable = (message: string): Finding[] => [{
    rule: "opus.records_unchanged",
    level: "block",
    where: "opera/W-096.md",
    message: `preservation is unverifiable: ${message}`,
  }];
  if (!opts.repo) return record ? unverifiable("repository context (--repo) is absent") : [];

  let repoReal: string;
  let studioReal: string;
  try {
    repoReal = realpathSync(resolve(opts.repo));
    studioReal = realpathSync(resolve(root));
  } catch {
    return unverifiable("repository or studio identity cannot be resolved");
  }

  // The owning branch is determined from Git's current symbolic branch and
  // must equal the record owner's canonical ref, opus/W-096. Other branches
  // do not replay this opus-specific boundary after the record is merged.
  const branch = currentBranch(opts.repo);
  if (branch === "opus/W-096") {
    let ownerReal: string;
    try { ownerReal = w096OwningStudio(opts.repo); }
    catch { return unverifiable("owning officina identity cannot be resolved"); }
    // Branch identity alone does not make every checked officina the owner.
    // A fixture, sample, or temporary officina remains outside this gate.
    if (studioReal !== ownerReal) return [];
    if (!record) return unverifiable("W-096 record is missing, unsafe, or unreadable on its owning branch");
  } else {
    if (!record) return [];
    if (relative(repoReal, studioReal).split(sep).join("/") !== "studio")
      return unverifiable("selected studio is not the native studio inside the supplied repository");
  }
  if (branch === undefined) return unverifiable("repository identity or current branch is unavailable");
  if (branch !== "opus/W-096") return [];
  const result = validateProtectedRecords(opts.repo, root);
  if (result.ok) return [];
  return result.problems.map((message) => ({ rule: "opus.records_unchanged", level: "block" as const, where: "opera/W-096.md", message }));
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
    .map(stripBacktickSpans)
    .join("\n")
    .replace(/"(?:\\.|[^"\\])*"/g, "");
}

/** The exact replacement performed by /(`+)[^`\n]*?\1/g, without its
 * quadratic backtracking. A full opening run can only close at the next
 * run; when that fails, regexp capture backtracking can only pair ticks
 * within the opening run itself. */
function stripBacktickSpans(text: string): string {
  const runs: { start: number; end: number; length: number }[] = [];
  for (let cursor = 0; cursor < text.length; ) {
    const start = text.indexOf("`", cursor);
    if (start === -1) break;
    let end = start + 1;
    while (text[end] === "`") end++;
    runs.push({ start, end, length: end - start });
    cursor = end;
  }

  let output = "";
  let copyFrom = 0;
  let position = 0;
  let runIndex = 0;
  while (runIndex < runs.length) {
    const run = runs[runIndex]!;
    const start = Math.max(position, run.start);
    if (start >= run.end) {
      runIndex++;
      continue;
    }

    const openingLength = run.end - start;
    const next = runs[runIndex + 1];
    if (next && next.length >= openingLength) {
      output += text.slice(copyFrom, start);
      position = next.start + openingLength;
      copyFrom = position;
      runIndex++;
      continue;
    }

    const selfClosingLength = Math.floor(openingLength / 2);
    if (selfClosingLength === 0) break;
    output += text.slice(copyFrom, start);
    position = start + 2 * selfClosingLength;
    copyFrom = position;
  }
  return output + text.slice(copyFrom);
}

function checkBehaviourCitations(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const p of safeList(join(root, "briefs"))) {
    const rel = relative(root, p).split(sep).join("/");
    const contained = readContainedRegularFile(root, rel, "briefs");
    if ("error" in contained) continue;
    const briefText = contained.bytes.toString("utf8");

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
  return [
    ...checkUntracked(root, opts),
    ...checkRedEvidence(root),
    ...checkW096AssertionReds(root),
    ...checkW096ProtectedRecords(root, opts),
    ...checkBehaviourCitations(root),
  ];
}
