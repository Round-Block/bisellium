/**
 * W-403 rows b1 and b2 (studio/briefs/W-403.md): `bisellium greenlight <opus> --auto` greenlights, with no Patron, an
 * opus whose scope is already decided, a D-061 §4 remainder or a D-076 D cause fix, under the Patron's decision
 * `bisellium.yml#auto_greenlit_by` names (b1); the Patron's reserved scope, a record the screen cannot read, and a cause
 * fix that carries a parent (W-417's, the D-061 §4 cut) are refused even for those two kinds (b2).
 * node:test TAP, selected by `--test-name-pattern='^W-403-b<k>\s'`. Each row builds its own officina in a git repository
 * under the OS tmp dir with `initStudio`, drives `runGreenlight` in process and captures its console; nothing here reads
 * or writes `studio/` or `examples/`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { parse as parseYaml } from "yaml";
import { initStudio } from "./init.js";
import { runGreenlight } from "./writes.js";

const NOW = new Date("2026-10-25T09:00:00Z");
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
type Dict = Record<string, unknown>;

const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", ["-c", "init.defaultBranch=master", "-c", "user.name=t", "-c", "user.email=t@t.invalid", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

function manifest(auto: string | undefined): string {
  return [
    "bisellium: 1",
    "studio: w403",
    "patron: patron",
    "collegia:",
    "  - { id: production, name: Production, magister: producer }",
    "  - { id: engineering, name: Engineering, magister: eng-lead }",
    "  - { id: design, name: Design, magister: architect }",
    "  - { id: qa, name: QA, magister: qa-lead }",
    "sellae:",
    "  - { id: producer, collegium: production, kind: agent }",
    "  - { id: eng-lead, collegium: engineering, kind: agent }",
    "  - { id: architect, collegium: design, kind: agent }",
    "  - { id: qa-lead, collegium: qa, kind: agent }",
    "  - { id: spec-reviewer, collegium: qa, kind: agent, harness: codex, model: gpt-5.6-sol }",
    "probationes:",
    "  - { id: patron, name: Patron call, kind: human }",
    "wip_limit: 4",
    "spec_reviewer: spec-reviewer",
    ...(auto === undefined ? [] : [`auto_greenlit_by: ${auto}`]),
    "",
  ].join("\n");
}
const decision = (id: string, by: string): string => `---\nid: "${id}"\ntitle: "auto greenlight"\nat: 2026-10-25T00:00:00Z\nprovenance: stated\nby: ${by}\nkill_when: "never"\n---\nRuled.\n`;
/** An opus record; `title` and `kind` default to a fixture title and subtask, and `null` leaves the field out. */
function opusText(id: string, f: Dict): string {
  const field = (k: string, fallback: unknown): string[] => (f[k] === null ? [] : [`${k}: ${JSON.stringify(f[k] ?? fallback)}`]);
  const lines = [`id: "${id}"`, ...field("title", `fixture ${id}`), ...field("kind", "subtask"), 'collegium: "engineering"', `state: ${String(f["state"] ?? "backlog")}`, "probationes: {}"];
  for (const k of ["parent", "value", "declined"]) if (f[k] !== undefined) lines.push(`${k}: ${JSON.stringify(f[k])}`);
  return `---\n${lines.join("\n")}\n---\nBody of ${id}.\n`;
}
/** A verdict log as the recorder writes it: its headers, then one Findings section. */
function verdictLog(opus: string, kind: "spec" | "review", round: number, sella: string, outcome: string, findings: string[]): string {
  return [`# opus: ${opus}`, `# phase: ${kind === "spec" ? "spec" : "build"}`, `# round: ${round}`, `# sella: ${sella}`, `# outcome: ${outcome}`, "# at: 2026-10-24T10:00:00Z", "", "## Findings", ...(findings.length === 0 ? ["No findings"] : findings.map((f, i) => `${i + 1}. ${f}`)), "", "## Verdict", outcome === "passed" ? "VERDICT: PASS" : "VERDICT: FAIL", ""].join("\n");
}
const S1 = (cls: string): string => `blocking — a.ts:1 the code fails open [severity: S1] [class: ${cls}] — check: a.test.ts`;
/** The parent's spec sequence as next's ladder writes it: signature, failed review, signature, failed review, signature. */
const SPLIT: [number, string, string][] = [
  [1, "architect", "passed"],
  [2, "spec-reviewer", "failed"],
  [3, "architect", "passed"],
  [4, "spec-reviewer", "failed"],
  [5, "architect", "passed"],
];

interface World {
  repo: string;
  studio: string;
  opus: (id: string, f: Dict) => void;
  spec: (opus: string, seq: [number, string, string][]) => void;
  review: (opus: string, round: number, outcome: string, findings: string[]) => void;
  green: (...args: string[]) => { code: number; out: string; err: string };
  front: (id: string) => Dict;
  snapshot: () => Record<string, string>;
}
/** A git repository (CODEOWNERS committed at HEAD; with `git: "no-codeowners"` one empty commit, with
 *  `git: "codeowners-dir"` a directory committed at .github/CODEOWNERS, with `git: "unborn"` no commit, with `git: false`
 *  no repository) whose officina is `studio/`, with the Patron's decision D-1 and, by default, `auto_greenlit_by: D-1`. The
 *  officina's records are untracked, so D-021 allows writes. */
function world(o: { auto?: string | null; git?: boolean | "unborn" | "no-codeowners" | "codeowners-dir" } = {}): World {
  const repo = join(mkdtempSync(join(tmpdir(), "w403-")), "repo");
  made.push(dirname(repo));
  mkdirSync(repo);
  if (o.git !== false) git(repo, "init", "-q");
  if (o.git === undefined || o.git === true) {
    put(join(repo, ".github", "CODEOWNERS"), "# Patron-only\n/.github/ @p\n/studio/leges/ @p\n/docs/ADOPTION.md @p\n*.secret @p\n");
    git(repo, "add", ".github/CODEOWNERS");
    git(repo, "commit", "-q", "-m", "codeowners");
  }
  if (o.git === "no-codeowners") git(repo, "commit", "-q", "--allow-empty", "-m", "empty");
  if (o.git === "codeowners-dir") {
    put(join(repo, ".github", "CODEOWNERS", "inner"), "/.github/ @p\n");
    git(repo, "add", ".github");
    git(repo, "commit", "-q", "-m", "a directory");
  }
  const studio = join(repo, "studio");
  assert.equal(initStudio(studio, { now: NOW }).root, studio, "fixture: initStudio");
  writeFileSync(join(studio, "bisellium.yml"), manifest(o.auto === null ? undefined : (o.auto ?? "D-1")));
  put(join(studio, "decisions", "D-1.md"), decision("D-1", "patron"));
  put(join(studio, "decisions", "D-2.md"), decision("D-2", "producer"));
  const w: World = {
    repo,
    studio,
    opus: (id, f) => put(join(studio, "opera", `${id}.md`), opusText(id, f)),
    spec: (opus, seq) => {
      for (const [n, sella, outcome] of seq) put(join(studio, "ci", `${opus}-spec-${n}.log`), verdictLog(opus, "spec", n, sella, outcome, outcome === "failed" ? [S1("spec×design-gap")] : []));
    },
    review: (opus, round, outcome, findings) => put(join(studio, "ci", `${opus}-review-${round}.log`), verdictLog(opus, "review", round, "qa-lead", outcome, findings)),
    green: (...args) => {
      const out: string[] = [];
      const err: string[] = [];
      const log = console.log;
      const error = console.error;
      console.log = (...a: unknown[]) => void out.push(a.join(" "));
      console.error = (...a: unknown[]) => void err.push(a.join(" "));
      try {
        return { code: runGreenlight([...args, "--studio", studio], { now: NOW }).exitCode, out: out.join("\n"), err: err.join("\n") };
      } finally {
        console.log = log;
        console.error = error;
      }
    },
    front: (id) => {
      const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(studio, "opera", `${id}.md`), "utf8"));
      assert.ok(m !== null, `fixture: opera/${id}.md has front matter`);
      return parseYaml(m[1]!) as Dict;
    },
    snapshot: () => {
      const out: Record<string, string> = {};
      const walk = (d: string): void => {
        for (const n of readdirSync(d).sort()) {
          const p = join(d, n);
          const s = lstatSync(p);
          if (s.isDirectory()) walk(p);
          else out[p.slice(repo.length)] = createHash("sha256").update(readFileSync(p)).digest("hex");
        }
      };
      walk(repo);
      return out;
    },
  };
  return w;
}
const events = (w: World): Dict[] => {
  const p = join(w.studio, ".bisellium", "events.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Dict) : [];
};
const timeline = (w: World): string => {
  const p = join(w.studio, "timeline", "patron.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

/** W-403's records: W-1 a done parent whose spec reviews split it; W-2 its remainder; W-6 and W-7 two done opera whose
 *  failed reviews carry the S1 class tests×ruled-case-uncovered; W-5 the cause fix for it. */
function decided(w: World): void {
  w.opus("W-1", { title: "the parent", kind: "feature", state: "done", value: 3 });
  w.spec("W-1", SPLIT);
  w.opus("W-2", { title: "W-1's remainder, cut at spec (D-061 §4)", parent: "W-1", value: 2 });
  for (const id of ["W-6", "W-7"]) {
    w.opus(id, { title: `reviewed ${id}`, kind: "feature", state: "done", value: 2 });
    w.review(id, 1, "failed", [S1("tests×ruled-case-uncovered")]);
  }
  w.opus("W-5", { title: "high: cause fix for repeat class tests×ruled-case-uncovered (D-076 D)", kind: "feature", value: 2 });
}

test("W-403-b1 behaviour 1: greenlight --auto greenlights a D-061 §4 remainder and a D-076 D cause fix under the Patron's decision, and refuses anything else, writing nothing", () => {
  // 1. the remainder: the record, the event, no Patron timeline line, the one stdout line
  const w = world();
  decided(w);
  const r = w.green("W-2", "--auto");
  assert.deepEqual(
    r,
    { code: 0, out: "W-2: greenlit (auto, D-1: D-061 §4: the remainder of W-1 (done), whose spec reviews ci/W-1-spec-2.log and ci/W-1-spec-4.log failed)", err: "" },
    "a remainder of a split parent: greenlit, naming the decision and the two failed reviews",
  );
  const front = w.front("W-2");
  assert.deepEqual(
    [front["state"], front["greenlit_by"], front["greenlit_basis"]],
    ["greenlit", "D-1", "D-061 §4: the remainder of W-1 (done), whose spec reviews ci/W-1-spec-2.log and ci/W-1-spec-4.log failed"],
    "the record: state greenlit, greenlit_by the decision, greenlit_basis the reason",
  );
  assert.deepEqual(
    events(w).map((e) => [e["name"], (e["attrs"] as Dict)["workflow.item.id"], (e["attrs"] as Dict)["workflow.greenlight"]]),
    [["workflow.greenlight", "W-2", "granted"]],
    "one workflow.greenlight granted event",
  );
  assert.equal(timeline(w), "", "an auto greenlight writes no Patron timeline line");

  // 2. the cause fix
  const c = w.green("W-5", "--auto");
  assert.deepEqual(
    c,
    { code: 0, out: "W-5: greenlit (auto, D-1: D-076 D: a cause fix for tests×ruled-case-uncovered, an S1 class in the failed reviews of 2 opera: W-6, W-7)", err: "" },
    "a cause fix for a class two opera's failed reviews carry: greenlit",
  );
  assert.deepEqual([w.front("W-5")["state"], w.front("W-5")["greenlit_by"]], ["greenlit", "D-1"], "the cause fix's record");

  // 3. refusals: exit 2, the one stderr line, every file under the repository byte-identical
  const refused = (name: string, w: World, args: string[], err: string): void => {
    const before = w.snapshot();
    assert.deepEqual(w.green(...args), { code: 2, out: "", err }, name);
    assert.deepEqual(w.snapshot(), before, `${name}: writes nothing`);
  };
  const n = world();
  decided(n);
  n.opus("W-9", { title: "a new feature", kind: "feature", value: 1 });
  refused("neither kind: refused", n, ["W-9", "--auto"], "W-9: greenlight --auto refused: W-9 is neither a D-061 §4 remainder (it names no parent) nor a D-076 D cause fix (its title names no review class (<area>×<slug>)), so only the Patron greenlights it");
  n.opus("W-4", { title: "a parent reviewed once", kind: "feature", state: "done", value: 2 });
  n.spec("W-4", [[1, "architect", "passed"], [2, "spec-reviewer", "failed"], [3, "architect", "passed"], [4, "spec-reviewer", "passed"], [5, "architect", "passed"], [6, "spec-reviewer", "failed"]]);
  n.opus("W-3", { title: "W-4's part two", parent: "W-4", value: 2 });
  refused(
    "a passed review between two failed ones: no split",
    n,
    ["W-3", "--auto"],
    "W-3: greenlight --auto refused: W-3 is neither a D-061 §4 remainder (its parent W-4 has no two failed spec reviews by spec-reviewer without a passed review between) nor a D-076 D cause fix (its title names no review class (<area>×<slug>)), so only the Patron greenlights it",
  );
  n.opus("W-11", { title: "a parent in the backlog", kind: "feature", state: "backlog", value: 2 });
  n.spec("W-11", SPLIT);
  n.opus("W-10", { title: "W-11's part two", parent: "W-11", value: 2 });
  refused("a parent not yet greenlit", n, ["W-10", "--auto"], "W-10: greenlight --auto refused: W-10 is neither a D-061 §4 remainder (its parent W-11 is backlog, not greenlit or done) nor a D-076 D cause fix (its title names no review class (<area>×<slug>)), so only the Patron greenlights it");
  n.opus("W-12", { title: "an orphan", parent: "W-99", value: 2 });
  refused("a parent with no record", n, ["W-12", "--auto"], "W-12: greenlight --auto refused: W-12 is neither a D-061 §4 remainder (its parent W-99 has no record) nor a D-076 D cause fix (its title names no review class (<area>×<slug>)), so only the Patron greenlights it");
  n.opus("W-14", { title: "a parent split by another seat", kind: "feature", state: "done", value: 2 });
  n.spec("W-14", [[1, "architect", "passed"], [2, "producer", "failed"], [3, "architect", "passed"], [4, "producer", "failed"]]);
  n.opus("W-13", { title: "W-14's part two", parent: "W-14", value: 2 });
  refused(
    "failed reviews by a seat that is not the spec reviewer: no split",
    n,
    ["W-13", "--auto"],
    "W-13: greenlight --auto refused: W-13 is neither a D-061 §4 remainder (its parent W-14 has no two failed spec reviews by spec-reviewer without a passed review between) nor a D-076 D cause fix (its title names no review class (<area>×<slug>)), so only the Patron greenlights it",
  );
  // every spec log of the parent must read, with one # phase: spec, # sella: and # outcome:, and the reviewer's outcome
  // passed or failed: a log it cannot judge between two failed reviews could hide a passed one, so it refuses the opus
  const UNJUDGED = "only the Patron greenlights what the records cannot judge";
  const hidden = (parent: string, child: string, third: (path: string) => void): void => {
    n.opus(parent, { title: `a parent with a log between its failed reviews`, kind: "feature", state: "done", value: 2 });
    n.spec(parent, SPLIT);
    third(join(n.studio, "ci", `${parent}-spec-3.log`));
    n.opus(child, { title: `${parent}'s part two`, parent, value: 2 });
  };
  hidden("W-41", "W-40", (path) => {
    rmSync(path);
    mkdirSync(path);
  });
  refused("an unreadable spec log between two failed reviews: refused", n, ["W-40", "--auto"], `W-40: greenlight --auto refused: W-40's parent W-41's spec log ci/W-41-spec-3.log cannot be read (target is not a regular file); ${UNJUDGED}`);
  hidden("W-43", "W-42", (path) => put(path, "# opus: W-43\n# phase: spec\n# sella: spec-reviewer\n# outcome: passed\n\nVERDICT: PASS\n"));
  refused(
    "an unparsed passed review between two failed reviews: refused",
    n,
    ["W-42", "--auto"],
    `W-42: greenlight --auto refused: W-42's parent W-43's spec log ci/W-43-spec-3.log cannot be read (expected exactly one "## Findings" heading, found 0); ${UNJUDGED}`,
  );
  hidden("W-45", "W-44", (path) => put(path, verdictLog("W-45", "spec", 3, "spec-reviewer", "passed", []).replace("# outcome: passed\n", "# outcome: passed\n# outcome: passed\n")));
  refused(
    "a passed review with two # outcome: headers between two failed reviews: refused",
    n,
    ["W-44", "--auto"],
    `W-44: greenlight --auto refused: W-44's parent W-45's spec log ci/W-45-spec-3.log does not hold exactly one # phase: spec, one # sella: and one # outcome:; ${UNJUDGED}`,
  );
  hidden("W-47", "W-46", (path) => put(path, verdictLog("W-47", "spec", 3, "spec-reviewer", "pased", [])));
  refused(
    "a review by the spec reviewer with an outcome neither passed nor failed: refused",
    n,
    ["W-46", "--auto"],
    `W-46: greenlight --auto refused: W-46's parent W-47's spec review ci/W-47-spec-3.log has outcome "pased", not passed or failed; ${UNJUDGED}`,
  );
  // the census: an S1 class in one opus only, an advisory, an S2 blocker, a passed log and an unparsed log count for nothing
  n.review("W-6", 2, "failed", [S1("tests×lonely"), "advisory — b.ts:2 a nit [severity: S4] [class: tests×soft] — check: none", "blocking — c.ts:3 a false promise [severity: S2] [class: tests×soft] — check: brief"]);
  n.review("W-7", 2, "passed", [S1("tests×soft")]);
  put(join(n.studio, "ci", "W-8-review-1.log"), `# opus: W-8\n# outcome: failed\n\n1. blocking — e.ts:5 [severity: S1] [class: tests×soft] — check: x\n`);
  n.opus("W-15", { title: "cause fix for tests×lonely and tests×soft", kind: "feature", value: 2 });
  refused(
    "a class in one opus, or only on advisories, S2 blockers, passed or unparsed logs: no cause fix",
    n,
    ["W-15", "--auto"],
    "W-15: greenlight --auto refused: W-15 is neither a D-061 §4 remainder (it names no parent) nor a D-076 D cause fix (no class its title names (tests×lonely: 1 opus; tests×soft: 0 opera) recurs as an S1 blocker in the failed reviews of 2 or more opera), so only the Patron greenlights it",
  );
  // the opus's own failed reviews are not another opus's
  n.opus("W-17", { title: "cause fix for tests×self", kind: "feature", value: 2 });
  n.review("W-17", 1, "failed", [S1("tests×self")]);
  n.review("W-6", 3, "failed", [S1("tests×self")]);
  refused(
    "a class in the opus's own reviews and one other opus: no cause fix",
    n,
    ["W-17", "--auto"],
    "W-17: greenlight --auto refused: W-17 is neither a D-061 §4 remainder (it names no parent) nor a D-076 D cause fix (no class its title names (tests×self: 1 opus) recurs as an S1 blocker in the failed reviews of 2 or more opera), so only the Patron greenlights it",
  );
  n.opus("W-16", { title: "W-1's remainder, declined", parent: "W-1", value: 2, declined: "not now" });
  refused("a declined opus", n, ["W-16", "--auto"], 'W-16: greenlight --auto refused: W-16 is declined (declined: "not now"); only the Patron reverses a decline');
  n.opus("W-18", { title: "W-1's remainder, declined: with no reason", parent: "W-1", value: 2, declined: null });
  refused("declined: present with no value is declined too", n, ["W-18", "--auto"], "W-18: greenlight --auto refused: W-18 is declined (declined: null); only the Patron reverses a decline");
  refused("--auto with --decline", n, ["W-2", "--auto", "--decline", "no"], "--auto and --decline cannot be combined\nusage: bisellium greenlight <opus> [--auto | --decline <reason>] [--studio <dir>] [--now <iso>]");
  // the grant: no setting, a decision not the Patron's, no such decision
  const none = world({ auto: null });
  decided(none);
  refused("no auto_greenlit_by: refused", none, ["W-2", "--auto"], "W-2: greenlight --auto refused: bisellium.yml names no auto_greenlit_by decision, so only the Patron greenlights W-2");
  const producer = world({ auto: "D-2" });
  decided(producer);
  refused("a decision by the producer: refused", producer, ["W-2", "--auto"], 'W-2: greenlight --auto refused: bisellium.yml#auto_greenlit_by: decision "D-2" is by "producer", not patron "patron"');
  const missing = world({ auto: "D-404" });
  decided(missing);
  refused("no such decision: refused", missing, ["W-2", "--auto"], 'W-2: greenlight --auto refused: bisellium.yml#auto_greenlit_by: decision "D-404" not found');

  // 4. the Patron's greenlight is unchanged: greenlit, a timeline line, no greenlit_by
  const p = n.green("W-9");
  assert.deepEqual([p.code, p.out], [0, "W-9: greenlit"], "the Patron's greenlight: unchanged");
  assert.deepEqual([n.front("W-9")["state"], n.front("W-9")["greenlit_by"]], ["greenlit", undefined], "the Patron's greenlight writes no greenlit_by");
  assert.equal(JSON.parse(timeline(n).trim())["action"], "greenlight", "the Patron's greenlight writes its timeline line");
});

test("W-403-b2 behaviour 2: greenlight --auto refuses the Patron's reserved scope even for a remainder or a cause fix: kind ui, over 3 points or unsized, a title naming security, the sandbox, branch protection, architecture or a code-owned path, a security class, a ui parent, a record the screen cannot read, and a cause fix that carries a parent (W-417)", () => {
  const w = world();
  decided(w);
  for (const id of ["W-6", "W-7"]) w.review(id, 2, "failed", [S1("security×secret-leaked"), S1("tests×security-boundary-cases-uncovered")]);
  const refused = (name: string, args: string[], err: string, at: World = w): void => {
    const before = at.snapshot();
    assert.deepEqual(at.green(...args), { code: 2, out: "", err }, name);
    assert.deepEqual(at.snapshot(), before, `${name}: writes nothing`);
  };
  const REASON = "security, the sandbox, branch protection, architecture and code-owned paths are the Patron's";
  w.opus("W-20", { title: "W-1's remainder, the screens", kind: "ui", parent: "W-1", value: 2 });
  refused("a kind ui remainder: refused", ["W-20", "--auto"], "W-20: greenlight --auto refused: W-20 is kind ui; a ui opus is the Patron's to greenlight");
  w.opus("W-22", { title: "a ui parent", kind: "ui", state: "done", value: 2 });
  w.spec("W-22", SPLIT);
  w.opus("W-21", { title: "W-22's remainder", parent: "W-22", value: 2 });
  refused("a ui parent's remainder: refused", ["W-21", "--auto"], "W-21: greenlight --auto refused: W-21's parent W-22 is kind ui; a ui opus's remainder is the Patron's to greenlight");
  w.opus("W-23", { title: "W-1's remainder, large", parent: "W-1", value: 5 });
  refused("5 points: refused", ["W-23", "--auto"], "W-23: greenlight --auto refused: W-23's value is 5, not 1, 2 or 3 points; anything larger, or unsized, is the Patron's");
  w.opus("W-24", { title: "W-1's remainder, unsized", parent: "W-1" });
  refused("no value: refused", ["W-24", "--auto"], "W-24: greenlight --auto refused: W-24's value is absent, not 1, 2 or 3 points; anything larger, or unsized, is the Patron's");
  for (const [id, title, word] of [
    ["W-25", "W-1's remainder: the Security half", "security"],
    ["W-26", "W-1's remainder: the sandbox rows", "sandbox"],
    ["W-27", "W-1's remainder: an architecture change", "architecture"],
    ["W-28", "W-1's remainder: branch protection on master", "branch protection"],
    ["W-29", "W-1's remainder: the CODEOWNERS line", "codeowners"],
    ["W-30", "W-1's remainder: edit .github/workflows/ci.yml", ".github"],
    ["W-31", "W-1's remainder: amend studio/leges/production.md", "leges"],
    ["W-32", "W-1's remainder: a paragraph in ADOPTION.md", "ADOPTION.md"],
  ] as const) {
    w.opus(id, { title, parent: "W-1", value: 2 });
    refused(`a title naming ${word}: refused`, [id, "--auto"], `${id}: greenlight --auto refused: ${id}'s title names "${word}"; ${REASON}`);
  }
  w.opus("W-33", { title: "cause fix for security×secret-leaked", kind: "feature", value: 2 });
  refused("a security class: refused", ["W-33", "--auto"], "W-33: greenlight --auto refused: W-33's title names the security class security×secret-leaked; security is the Patron's");
  // a record the screen cannot read refuses before either kind: a kind outside the native kinds, a title titleProblem
  // refuses, a parent that is not an opus id; and a parent whose record cannot be read or has no native kind
  const UNSCREENED = "only the Patron greenlights a record the screen cannot read";
  w.opus("W-35", { title: "W-1's remainder, the screens", kind: ["ui"], parent: "W-1", value: 2 });
  refused("a kind that is not a native kind ([ui]): refused", ["W-35", "--auto"], `W-35: greenlight --auto refused: W-35's kind is ["ui"], not a native opus kind; ${UNSCREENED}`);
  w.opus("W-36", { title: "W-1's remainder, no kind", kind: null, parent: "W-1", value: 2 });
  refused("no kind: refused", ["W-36", "--auto"], `W-36: greenlight --auto refused: W-36's kind is absent, not a native opus kind; ${UNSCREENED}`);
  w.opus("W-37", { title: 42, parent: "W-1", value: 2 });
  refused("a title that is not a string: refused", ["W-37", "--auto"], `W-37: greenlight --auto refused: W-37's title must be a nonblank string; ${UNSCREENED}`);
  w.opus("W-38", { title: "W-1's remainder\u0007", parent: "W-1", value: 2 });
  refused("a title with a control character: refused", ["W-38", "--auto"], `W-38: greenlight --auto refused: W-38's title contains forbidden control U+0007; ${UNSCREENED}`);
  w.opus("W-39", { title: "W-1's remainder, a listed parent", parent: ["W-1"], value: 2 });
  refused("a parent that is not an opus id: refused", ["W-39", "--auto"], `W-39: greenlight --auto refused: W-39's parent is ["W-1"], not an opus id; ${UNSCREENED}`);
  w.opus("W-41", { title: "a parent whose kind is a list", kind: ["ui"], state: "done", value: 2 });
  w.spec("W-41", SPLIT);
  w.opus("W-40", { title: "W-41's remainder", parent: "W-41", value: 2 });
  refused("a parent whose kind is not a native kind ([ui]): refused", ["W-40", "--auto"], `W-40: greenlight --auto refused: W-40's parent W-41's kind is ["ui"], not a native opus kind; ${UNSCREENED}`);
  w.opus("W-43", { title: "a parent with no kind", kind: null, state: "done", value: 2 });
  w.spec("W-43", SPLIT);
  w.opus("W-42", { title: "W-43's remainder", parent: "W-43", value: 2 });
  refused("a parent with no kind: refused", ["W-42", "--auto"], `W-42: greenlight --auto refused: W-42's parent W-43's kind is absent, not a native opus kind; ${UNSCREENED}`);
  put(join(w.studio, "opera", "W-45.md"), "a record with no front matter\n");
  w.spec("W-45", SPLIT);
  w.opus("W-44", { title: "W-45's remainder", parent: "W-45", value: 2 });
  refused("a parent whose record cannot be read: refused", ["W-44", "--auto"], `W-44: greenlight --auto refused: W-44's parent W-45's record cannot be read (it has no front matter); ${UNSCREENED}`);
  w.opus("W-46", { title: "cause fix for tests×ruled-case-uncovered, under a ui parent", kind: "feature", parent: "W-22", value: 2 });
  refused("a cause fix whose parent is kind ui: refused", ["W-46", "--auto"], "W-46: greenlight --auto refused: W-46's parent W-22 is kind ui; a ui opus's remainder is the Patron's to greenlight");
  // the D-061 §4 cut (spec round 5): a cause fix that carries any parent is refused, whatever the parent (W-417 is to check it)
  const PARENTED = "a cause fix that carries a parent waits for W-417, so only the Patron greenlights it";
  w.opus("W-47", { title: "cause fix for tests×ruled-case-uncovered, part of W-6", kind: "feature", parent: "W-6", value: 2 });
  refused(
    "a cause fix that carries a valid parent it is not the remainder of: refused",
    ["W-47", "--auto"],
    `W-47: greenlight --auto refused: W-47 reads as a D-076 D cause fix but carries parent W-6 and is not its D-061 §4 remainder (its parent W-6 has no two failed spec reviews by spec-reviewer without a passed review between); ${PARENTED}`,
  );
  w.opus("W-48", { title: "cause fix for tests×ruled-case-uncovered, a mistyped parent", kind: "feature", parent: "W-99", value: 2 });
  refused(
    "a cause fix whose parent W-99 has no record: refused",
    ["W-48", "--auto"],
    `W-48: greenlight --auto refused: W-48 reads as a D-076 D cause fix but carries parent W-99 and is not its D-061 §4 remainder (its parent W-99 has no record); ${PARENTED}`,
  );
  w.opus("W-50", { title: "a parent whose state is mistyped", kind: "feature", state: "don", value: 2 });
  w.opus("W-49", { title: "cause fix for tests×ruled-case-uncovered, under a parent in state don", kind: "feature", parent: "W-50", value: 2 });
  refused(
    "a cause fix whose parent's state is mistyped (don): refused",
    ["W-49", "--auto"],
    `W-49: greenlight --auto refused: W-49 reads as a D-076 D cause fix but carries parent W-50 and is not its D-061 §4 remainder (its parent W-50 is don, not greenlit or done); ${PARENTED}`,
  );
  // not reserved: a word inside a longer token, a glob pattern, and a recurring class whose slug holds the word
  w.opus("W-34", { title: "cause fix for tests×security-boundary-cases-uncovered, in sandboxed rows and x.secret files", kind: "feature", value: 3 });
  assert.deepEqual(
    w.green("W-34", "--auto"),
    { code: 0, out: "W-34: greenlit (auto, D-1: D-076 D: a cause fix for tests×security-boundary-cases-uncovered, an S1 class in the failed reviews of 2 opera: W-6, W-7)", err: "" },
    "security inside a class slug, sandboxed and a glob's name are not reserved: greenlit",
  );
  // a repository with no CODEOWNERS at HEAD: no path is code-owned
  const bare = world({ git: false });
  decided(bare);
  bare.opus("W-30", { title: "W-1's remainder: edit .github/workflows/ci.yml", parent: "W-1", value: 2 });
  assert.equal(bare.green("W-30", "--auto").code, 0, "no repository, so no CODEOWNERS: .github is not reserved");
  // CODEOWNERS: a git failure refuses; only a confirmed non-repository or a HEAD whose tree has no such file names nothing
  const badConfig = world();
  decided(badConfig);
  writeFileSync(join(badConfig.repo, ".git", "config"), "[core\n");
  refused("git failing (a bad .git/config): refused", ["W-2", "--auto"], "W-2: greenlight --auto refused: git rev-parse --show-toplevel failed (fatal: bad config line 1 in file .git/config), so the code-owned paths cannot be screened", badConfig);
  const unborn = world({ git: "unborn" });
  decided(unborn);
  refused("an unborn HEAD: refused", ["W-2", "--auto"], "W-2: greenlight --auto refused: git ls-tree HEAD -- .github/CODEOWNERS failed (fatal: Not a valid object name HEAD), so the code-owned paths cannot be screened", unborn);
  const dir = world({ git: "codeowners-dir" });
  decided(dir);
  refused("a CODEOWNERS at HEAD that is not a regular file: refused", ["W-2", "--auto"], "W-2: greenlight --auto refused: .github/CODEOWNERS at HEAD is not a regular file, so the code-owned paths cannot be screened", dir);
  const lost = world();
  decided(lost);
  const oid = spawnSync("git", ["rev-parse", "HEAD:.github/CODEOWNERS"], { cwd: lost.repo, encoding: "utf8" }).stdout.trim();
  assert.match(oid, /^[0-9a-f]{40}$/, "fixture: the CODEOWNERS blob's id");
  rmSync(join(lost.repo, ".git", "objects", oid.slice(0, 2), oid.slice(2)));
  refused("a CODEOWNERS blob git cannot read: refused", ["W-2", "--auto"], `W-2: greenlight --auto refused: git cat-file blob .github/CODEOWNERS failed (fatal: git cat-file ${oid}: bad file), so the code-owned paths cannot be screened`, lost);
  const plain = world({ git: "no-codeowners" });
  decided(plain);
  plain.opus("W-30", { title: "W-1's remainder: edit .github/workflows/ci.yml", parent: "W-1", value: 2 });
  assert.equal(plain.green("W-30", "--auto").code, 0, "a HEAD with no CODEOWNERS: .github is not reserved");
  // a record whose YAML parses but cannot be converted or serialized (an unresolved alias, a cyclic alias) refuses at the one
  // read every path goes through, on the opus itself and on its parent, whichever field holds it
  const withLine = (id: string, f: Dict, line: string): void => put(join(w.studio, "opera", `${id}.md`), opusText(id, f).replace("\n---\nBody", `\n${line}\n---\nBody`));
  const CONVERT = "its front matter cannot be converted to a record";
  const CYCLIC = "its front matter holds a value that cannot be serialized";
  withLine("W-51", { title: "W-1's remainder, an unresolved alias", parent: "W-1", value: 2 }, "note: *nowhere");
  refused("an unresolved alias in the opus: refused", ["W-51", "--auto"], `W-51: greenlight --auto refused: opera/W-51.md cannot be read (${CONVERT})`);
  withLine("W-52", { title: "W-1's remainder, a cyclic alias", parent: "W-1", value: 2 }, "note: &loop [*loop]");
  refused("a cyclic alias in the opus: refused", ["W-52", "--auto"], `W-52: greenlight --auto refused: opera/W-52.md cannot be read (${CYCLIC})`);
  withLine("W-53", { title: "W-1's remainder, a cyclic declined", parent: "W-1", value: 2 }, "declined: &loop [*loop]");
  refused("a cyclic alias in declined: refused", ["W-53", "--auto"], `W-53: greenlight --auto refused: opera/W-53.md cannot be read (${CYCLIC})`);
  withLine("W-55", { title: "a parent holding an unresolved alias", kind: "feature", state: "done", value: 2 }, "note: *nowhere");
  w.spec("W-55", SPLIT);
  w.opus("W-54", { title: "W-55's remainder", parent: "W-55", value: 2 });
  refused("an unresolved alias in the parent: refused", ["W-54", "--auto"], `W-54: greenlight --auto refused: W-54's parent W-55's record cannot be read (${CONVERT}); ${UNSCREENED}`);
  withLine("W-57", { title: "a parent holding a cyclic alias", kind: "feature", state: "done", value: 2 }, "note: &loop [*loop]");
  w.spec("W-57", SPLIT);
  w.opus("W-56", { title: "W-57's remainder", parent: "W-57", value: 2 });
  refused("a cyclic alias in the parent: refused", ["W-56", "--auto"], `W-56: greenlight --auto refused: W-56's parent W-57's record cannot be read (${CYCLIC}); ${UNSCREENED}`);
  put(join(w.studio, "opera", "W-59.md"), opusText("W-59", { title: "a parent whose kind is a cyclic alias", state: "done", value: 2 }).replace('kind: "subtask"', "kind: &loop [*loop]"));
  w.spec("W-59", SPLIT);
  w.opus("W-58", { title: "W-59's remainder", parent: "W-59", value: 2 });
  refused("a parent whose kind is a cyclic alias: refused", ["W-58", "--auto"], `W-58: greenlight --auto refused: W-58's parent W-59's record cannot be read (${CYCLIC}); ${UNSCREENED}`);
  // the remainder itself still passes
  assert.equal(w.green("W-2", "--auto").code, 0, "W-2, clear of every reserved form: greenlit");
});
