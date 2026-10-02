/**
 * W-121 focused red suite: the `test.sleep` rule and its repairs. Select
 * exactly one numbered behaviour with `--behaviour N` (1..5); omitting the
 * selector runs all five. node:test TAP, one test() per behaviour, modelled on
 * W-124's next.test.ts.
 *
 * Reds are assertion-level, never a load error. Behaviours 1-3 drive the
 * existing `checkStudio` and `main.ts check`; behaviour 4 imports the existing
 * `scripts/no-vendor.mjs` and passes an option it ignores today; behaviour 5
 * reads files and uses the existing `RULE_IDS`. The rule module itself
 * (`tests.ts`) is loaded dynamically, only for the `covered` / `sites` rows, so
 * its absence is an assertion and not an import failure.
 *
 * This file is itself a scanned test file: every primitive name and every
 * annotation prefix below is assembled from fragments, and the fixtures are
 * built from arrays of strings, so the scan never counts a fixture as a site.
 * Keep it that way (no regex literal holding a quote or a double slash either:
 * the lexical pass is not a parser).
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkStudio, type Finding } from "../check.js";
import { initStudio } from "../init.js";
import { RULE_IDS } from "./ids.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 5)) {
  console.error("tests.test.ts: --behaviour must be an integer from 1 through 5");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

// The cap constants are literals HERE, never imported from the rule (brief,
// "Waiver caps are counted by the rule's parser"). Raising one needs an
// architect ruling recorded in the brief's revision table.
const WAIVER_CAP = 18;
const GUARD_CAP = 9;
const NO_OBSERVABLE_CAP = 5;
const SEAM_CAP = 6;
const WAIVER_KINDS = ["guard", "subject", "fixture", "no-observable"];

// primitive names and annotation prefixes, assembled from fragments
const T = "set" + "Timeout";
const I = "set" + "Interval";
const S = "sl" + "eep";
const PW = "wait" + "ForTimeout";
const AW = "Atomics" + ".wait";
const TP = "timers" + "/promises";
const SEAM = "// sleep" + "-seam: ";
const WAIVER = "// sleep" + "-waiver: ";
const BT = "`";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main.ts");
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const NV_PATH = join(REPO_ROOT, "scripts", "no-vendor.mjs");
const NV_TEST_PATH = join(REPO_ROOT, "scripts", "no-vendor.test.mjs");
const TSX = import.meta.resolve("tsx");
const TESTS_MODULE = new URL("./tests.ts", import.meta.url).href;
const NOW = new Date("2026-10-02T12:00:00.000Z");

// ---------------------------------------------------------------------------
// scratch, git, fixture repos
// ---------------------------------------------------------------------------
const roots: string[] = [];
function scratch(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `w121-${tag}-`));
  roots.push(root);
  return root;
}
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"] ?? "/usr/bin:/bin",
  HOME: scratch("home"),
  LANG: "C.UTF-8",
  TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "W-121 Test",
  GIT_AUTHOR_EMAIL: "w121@example.invalid",
  GIT_COMMITTER_NAME: "W-121 Test",
  GIT_COMMITTER_EMAIL: "w121@example.invalid",
};
function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.stderr}${r.stdout}`);
}
function put(dir: string, rel: string, text: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

interface Tree {
  files?: Record<string, string>;
  links?: Record<string, string>;
  untracked?: Record<string, string>;
}
/** A committed git repository (tracked files and symlinks), then any untracked files. */
function mkRepo(tag: string, tree: Tree): string {
  const repo = scratch(tag);
  git(repo, ["init", "-q"]);
  for (const [rel, text] of Object.entries(tree.files ?? {})) put(repo, rel, text);
  for (const [rel, target] of Object.entries(tree.links ?? {})) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    symlinkSync(target, join(repo, rel));
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "--allow-empty", "-m", "fixture"]);
  for (const [rel, text] of Object.entries(tree.untracked ?? {})) put(repo, rel, text);
  return repo;
}

let officinaDir: string | undefined;
/** A valid, empty officina directory (separate from the repo): `check` passes on it. */
function officina(): string {
  if (officinaDir === undefined) {
    officinaDir = scratch("officina");
    const init = initStudio(officinaDir, { now: NOW });
    assert.ok(init.ok, `fixture officina: ${init.message}`);
  }
  return officinaDir;
}
const code = (lines: string[]): string => lines.join("\n") + "\n";
const sleepOnly = (findings: Finding[]): Finding[] => findings.filter((f) => f.rule === "test.sleep");
function sleepFindings(repo: string): Finding[] {
  return sleepOnly(checkStudio(officina(), NOW, { repo }).findings);
}
const wheres = (findings: Finding[]): string[] => findings.map((f) => f.where).sort();
const text = (findings: Finding[]): string => findings.map((f) => f.message).join(" | ").toLowerCase();

// the rule module, loaded dynamically so its absence is an assertion
interface Covered {
  where: string;
  annotation: "seam" | "waiver";
  kind: string;
}
interface ScanResult {
  findings: Finding[];
  sites: string[];
  covered: Covered[];
}
type ScanFn = (root: string, opts: { now: Date; repo?: string }) => ScanResult;
let scanLoad: Promise<{ fn?: ScanFn; error?: string }> | undefined;
function loadScan(): Promise<{ fn?: ScanFn; error?: string }> {
  scanLoad ??= import(TESTS_MODULE).then(
    (m: { scanTests?: ScanFn }) => ({ fn: m.scanTests }),
    (e: unknown) => ({ error: String(e) }),
  );
  return scanLoad;
}

// one fixture repo holding many small test files; per-file lookups afterwards
interface Probe {
  all: Finding[];
  scanned: boolean;
  find(file: string): Finding[];
  coveredIn(file: string): Covered[];
  sitesIn(file: string): string[];
}
async function probe(files: Record<string, string[]>, tree: Tree = {}): Promise<Probe> {
  const body: Record<string, string> = { ...(tree.files ?? {}) };
  for (const [name, lines] of Object.entries(files)) body[name] = code(lines);
  const repo = mkRepo("probe", { ...tree, files: body });
  const all = sleepFindings(repo);
  const loaded = await loadScan();
  const scan = loaded.fn ? loaded.fn(officina(), { now: NOW, repo }) : undefined;
  const inFile = (where: string, file: string): boolean => where === file || where.startsWith(`${file}:`);
  return {
    all,
    scanned: scan !== undefined,
    find: (file) => all.filter((f) => inFile(f.where, file)),
    coveredIn: (file) => (scan?.covered ?? []).filter((c) => inFile(c.where, file)),
    sitesIn: (file) => (scan?.sites ?? []).filter((s) => inFile(s, file)),
  };
}

const SITE = `await new Promise((r) => ${T}(r, 5));`;
const READY = "const ready = true;";
function layoutOf(layout: "above" | "trailing", pre: string[], ann?: string): { lines: string[]; site: number } {
  const lines = [...pre];
  if (ann !== undefined && layout === "above") lines.push(ann);
  lines.push(ann !== undefined && layout === "trailing" ? `${SITE} ${ann}` : SITE);
  return { lines, site: lines.length };
}

/** Exactly one blocking test.sleep finding at `file:line` (or at `file` when line is omitted). */
function exactlyOne(findings: Finding[], file: string, line: number | undefined, label: string): Finding {
  assert.equal(findings.length, 1, `${label}: expected exactly one test.sleep finding, got ${findings.length} (${wheres(findings).join(", ")})`);
  const f = findings[0]!;
  assert.equal(f.rule, "test.sleep", `${label}: rule`);
  assert.equal(f.level, "block", `${label}: level`);
  assert.equal(f.where, line === undefined ? file : `${file}:${line}`, `${label}: where`);
  return f;
}

// ---------------------------------------------------------------------------
// Behaviour 1
// ---------------------------------------------------------------------------
if (runs(1)) {
  test("W-121 behaviour 1: an unannotated sleep in a scanned test file is a blocking test.sleep finding, and only there", { timeout: 600_000 }, async () => {
    // Genuine red: the rule does not exist, so the first fixture yields no finding.
    const first = await probe({ "x.test.ts": [SITE] });
    exactlyOne(first.all, "x.test.ts", 1, "row 1: a bare timer in x.test.ts");

    // each primitive family, one finding per line
    const families: Array<[string, string]> = [
      ["bare timer", SITE],
      ["interval", `const h = ${I}(() => {}, 5);`],
      ["member timer on an arbitrary receiver", `foo.${T}(() => {}, 5);`],
      ["sleep", `await ${S}(5);`],
      ["playwright", `await page.${PW}(100);`],
      ["atomics", `${AW}(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);`],
      ["timers-promises import", `import * as tp from "node:${TP}";`],
      ["computed", `globalThis["${T}"](() => {}, 5);`],
    ];
    const bypasses: Array<[string, string[]]> = [
      ["block comment before the timer", [`/* c */ ${T}(() => {}, 5);`]],
      ["globalThis receiver", [`globalThis.${T}(() => {}, 5);`]],
      ["global receiver", [`global.${T}(() => {}, 5);`]],
      ["window receiver", [`window.${T}(() => {}, 5);`]],
      ["timers receiver", [`timers.${T}(() => {}, 5);`]],
      ["member sleep", [`h.${S}(5);`]],
      [".call", [`${T}.call(null, () => {}, 5);`]],
      [".apply", [`${T}.apply(null, [() => {}, 5]);`]],
      ["optional call", [`${T}?.(() => {}, 5);`]],
      ["name ending a line, paren on the next", [`await new Promise((r) => ${T}`, "  (r, 5));"]],
      ["promisify", [`const w = promisify(${T});`]],
      ["computed member call", [`x["${T}"](() => {}, 5);`]],
    ];
    const rows: Array<[string, string[]]> = [...families.map(([label, line]): [string, string[]] => [label, [line]]), ...bypasses];
    const lines: string[] = [];
    const expected: string[] = [];
    for (const [, row] of rows) {
      expected.push(`fam.test.ts:${lines.length + 1}`);
      lines.push(...row, "");
    }
    const fam = await probe({ "fam.test.ts": lines });
    assert.deepEqual(wheres(fam.all), expected.sort(), `families and bypasses: one finding per row, in order: ${rows.map((r) => r[0]).join("; ")}`);
    for (const f of fam.all) {
      assert.equal(f.rule, "test.sleep");
      assert.equal(f.level, "block");
    }

    // scanned locations, and what yields none
    const scanned = ["a.spec.ts", "tests-serve/h.ts", "test/t.ts", "tests/t.ts", "__tests__/t.ts", "e2e/t.ts", "scripts/q.test.mjs", "test/fixtures/f.mjs", "fixtures/g.test.mjs", "suite.ts", "reg.ts"];
    const files: Record<string, string> = {};
    for (const rel of scanned) files[rel] = code([SITE]);
    files["package.json"] = JSON.stringify({ scripts: { "test:suite": "node --import tsx suite.ts && node ./reg.ts", build: "node built.ts" } });
    files["built.ts"] = code([SITE]);
    files["src/x.ts"] = code([SITE]);
    files["node_modules/pkg/x.test.ts"] = code([SITE]);
    files["old.test.sh"] = code([SITE]);
    files["c1.test.ts"] = code([`// ${SITE}`]);
    files["c2.test.ts"] = code(["/* open", SITE, "close */", "const kept = 1;"]);
    files["trail.test.ts"] = code([`run(); // ${T}(x)`]);
    files["deny.test.ts"] = code(["test", "sock", "socket", "req", "res", "server"].map((r) => `${r}.${T}(30_000);`));
    files["two.test.ts"] = code([`${T}(a, 1); ${I}(b, 2);`]);
    const where = mkRepo("places", { files, untracked: { "u.test.ts": code([SITE]) } });
    const got = wheres(sleepFindings(where));
    assert.deepEqual(got, [...scanned.map((rel) => `${rel}:1`), "two.test.ts:1"].sort(), "scanned set: every registered/named/directory file is flagged once; comments, spans, deny-listed receivers, node_modules, unregistered src, untracked and unsupported extensions are not; two primitives on one line is one finding");

    // file-level findings
    const big = mkRepo("filelevel", {
      files: { "real.test.ts": "const a = 1;\n", "big.test.ts": "// " + "x".repeat(1_100_000) + "\n" },
      links: { "link.test.ts": "real.test.ts" },
    });
    const fl = sleepFindings(big);
    assert.deepEqual(wheres(fl), ["big.test.ts", "link.test.ts"], "a symlinked test file and a file over 1 MiB are each one file-level finding");
    for (const f of fl) assert.equal(f.level, "block");
    assert.match(fl.find((f) => f.where === "link.test.ts")!.message, /regular file/i, "symlink message");
    assert.match(fl.find((f) => f.where === "big.test.ts")!.message, /1 MiB/, "oversize message");

    // observation failures are findings, not silence
    assert.deepEqual(sleepOnly(checkStudio(officina(), NOW).findings), [], "opts.repo absent yields no test.sleep finding");
    const nonGit = scratch("nongit");
    const ceiling = process.env["GIT_CEILING_DIRECTORIES"];
    process.env["GIT_CEILING_DIRECTORIES"] = dirname(nonGit);
    let notRepo: Finding[];
    try {
      notRepo = sleepFindings(nonGit);
    } finally {
      if (ceiling === undefined) delete process.env["GIT_CEILING_DIRECTORIES"];
      else process.env["GIT_CEILING_DIRECTORIES"] = ceiling;
    }
    const nr = exactlyOne(notRepo, "git ls-files", undefined, "a directory that is not a git repository");
    assert.match(nr.message, /could not enumerate/i);
    const badPkg = sleepFindings(mkRepo("badpkg", { files: { "package.json": "{ not json", "ok.test.ts": "const a = 1;\n" } }));
    assert.equal(badPkg.length, 1, `a package.json that does not parse is exactly one finding, got ${wheres(badPkg).join(", ")}`);
    assert.equal(badPkg[0]!.level, "block");
    assert.match(badPkg[0]!.message, /package\.json/);
  });
}

// ---------------------------------------------------------------------------
// Behaviour 2
// ---------------------------------------------------------------------------
interface Defect {
  id: string;
  pre: string[];
  ann: string;
  phrase: string;
}
const DEFECTS: Defect[] = [
  { id: "name-absent", pre: [], ann: `${SEAM}quiescence -- poll cadence of the helper`, phrase: "name not used" },
  { id: "name-substring", pre: ["const already = 1;"], ann: `${SEAM}ready -- poll cadence of the helper`, phrase: "name not used" },
  { id: "name-short", pre: ["const ab = 1;"], ann: `${SEAM}ab -- poll cadence of the helper`, phrase: "bad name" },
  { id: "name-primitive", pre: [], ann: `${SEAM}${T} -- poll cadence of the helper`, phrase: "bad name" },
  { id: "reason-14-chars", pre: [READY], ann: `${SEAM}ready -- aaaa bbbb cccccc`, phrase: "reason too short" },
  { id: "reason-padded", pre: [READY], ann: `${SEAM}ready -- a${" ".repeat(30)}b${" ".repeat(30)}c`, phrase: "reason too short" },
  { id: "reason-2-words", pre: [READY], ann: `${SEAM}ready -- supercalifragilistic expialidocious`, phrase: "reason too short" },
  { id: "kind-settle", pre: [], ann: `${WAIVER}settle -- let it settle for a moment`, phrase: "unknown kind" },
  { id: "kind-unknown", pre: [], ann: `${WAIVER}bogus -- a perfectly long reason here`, phrase: "unknown kind" },
  { id: "malformed", pre: [], ann: `${WAIVER}guard`, phrase: "malformed annotation" },
];

if (runs(2)) {
  test("W-121 behaviour 2: the annotation grammar admits exactly what the brief says", { timeout: 600_000 }, async () => {
    // rejection rows, each with an unannotated twin
    const files: Record<string, string[]> = {};
    const where: Array<{ defect: Defect; layout: "above" | "trailing"; file: string; site: number }> = [];
    for (const d of DEFECTS) {
      files[`twin-${d.id}.test.ts`] = layoutOf("above", d.pre).lines;
      for (const layout of ["above", "trailing"] as const) {
        const lay = layoutOf(layout, d.pre, d.ann);
        const file = `rej-${d.id}-${layout}.test.ts`;
        files[file] = lay.lines;
        where.push({ defect: d, layout, file, site: lay.site });
      }
    }
    // placement rows: an annotation that exists but does not cover the site
    const placements: Record<string, string[]> = {
      "place-two-above": [READY, `${SEAM}ready -- poll cadence of the helper`, "", SITE],
      "place-block-comment": [READY, "/* sleep-waiver: guard -- a reason long enough */", SITE],
      "place-code-line": [READY, `const a = 1; ${SEAM}ready -- poll cadence of the helper`, SITE],
      "place-in-string": [READY, `${T}(r, 5, "x ${WAIVER}guard -- a reason long enough");`],
    };
    for (const [name, lines] of Object.entries(placements)) files[`${name}.test.ts`] = lines;
    const p = await probe(files);

    for (const d of DEFECTS) {
      const twin = `twin-${d.id}.test.ts`;
      const tf = exactlyOne(p.find(twin), twin, d.pre.length + 1, `${d.id}: unannotated twin`);
      assert.match(tf.message.toLowerCase(), /no annotation/, `${d.id}: the twin reports no annotation`);
    }
    for (const w of where) {
      const label = `${w.defect.id} (${w.layout})`;
      const f = exactlyOne(p.find(w.file), w.file, w.site, label);
      const message = f.message.toLowerCase();
      assert.ok(message.includes(w.defect.phrase), `${label}: message names "${w.defect.phrase}", got: ${f.message}`);
      assert.ok(!message.includes("no annotation"), `${label}: a different defect from the twin, got: ${f.message}`);
    }
    for (const name of Object.keys(placements)) {
      const file = `${name}.test.ts`;
      const site = (placements[name] ?? []).length;
      const f = exactlyOne(p.find(file), file, name === "place-in-string" ? 2 : site, name);
      assert.match(f.message.toLowerCase(), /no annotation/, `${name}: an annotation that is not a comment on the site or a comment-only line directly above covers nothing`);
    }
    assert.ok(p.scanned, "scanTests is exported by rules/tests.ts");
    for (const w of where) assert.deepEqual(p.coveredIn(w.file), [], `${w.defect.id} (${w.layout}): a rejected annotation is not in covered`);
    for (const name of Object.keys(placements)) assert.deepEqual(p.coveredIn(`${name}.test.ts`), [], `${name}: not in covered`);
    for (const w of where) assert.deepEqual(p.sitesIn(w.file), [`${w.file}:${w.site}`], `${w.defect.id} (${w.layout}): a rejected site is still in sites`);

    // acceptance rows
    const ok: Record<string, string[]> = {};
    const expect: Record<string, { site: number; annotation: "seam" | "waiver"; kind: string }> = {};
    const accept = (file: string, lines: string[], site: number, annotation: "seam" | "waiver", kind: string): void => {
      ok[file] = lines;
      expect[file] = { site, annotation, kind };
    };
    for (const layout of ["above", "trailing"] as const) {
      const lay = layoutOf(layout, [READY], `${SEAM}ready -- poll cadence of the helper`);
      accept(`pos-seam-${layout}.test.ts`, lay.lines, lay.site, "seam", "seam");
    }
    for (const kind of WAIVER_KINDS) {
      const lay = layoutOf("above", [], `${WAIVER}${kind} -- a perfectly long reason here`);
      accept(`pos-kind-${kind}.test.ts`, lay.lines, lay.site, "waiver", kind);
    }
    const edge = layoutOf("above", [READY], `${SEAM}ready -- abcde fghij klmno`);
    accept("pos-reason-15.test.ts", edge.lines, edge.site, "seam", "seam");
    const filler = (n: number): string[] => Array.from({ length: n }, (_, i) => `const f${i} = ${i};`);
    const far = [READY, ...filler(38), `${SEAM}ready -- poll cadence of the helper`, SITE];
    accept("pos-name-40-before.test.ts", far, far.length, "seam", "seam");
    const after40 = [`${SEAM}ready -- poll cadence of the helper`, SITE, ...filler(39), READY];
    accept("pos-name-40-after.test.ts", after40, 2, "seam", "seam");
    const tpl = [`const cmd = ${BT}`, `  ${WAIVER}guard -- the embedded script socket guard`, `  ${T}(() => {}, 5000);`, `${BT};`];
    accept("pos-template.test.ts", tpl, 3, "waiver", "guard");
    const pp = await probe(ok);
    for (const [file, e] of Object.entries(expect)) {
      assert.deepEqual(pp.find(file), [], `${file}: a valid annotation covers the site (no finding)`);
      assert.deepEqual(pp.coveredIn(file), [{ where: `${file}:${e.site}`, annotation: e.annotation, kind: e.kind }], `${file}: exactly one covered entry`);
      assert.deepEqual(pp.sitesIn(file), [`${file}:${e.site}`], `${file}: the covered site is in sites`);
    }

    // the name must be within 40 lines either side: 41 before is rejected
    const tooFar = [READY, ...filler(39), `${SEAM}ready -- poll cadence of the helper`, SITE];
    // a trailing annotation text inside a template line is content, not a comment
    const tplTrail = [`const cmd = ${BT}`, `  ${T}(() => {}, 5000); ${WAIVER}guard -- the embedded script socket guard`, `${BT};`];
    // two adjacent sites need two annotations
    const adjacentOne = [`${WAIVER}guard -- a perfectly long reason here`, SITE, SITE];
    const adjacentTwo = [`${WAIVER}guard -- a perfectly long reason here`, SITE, `${WAIVER}fixture -- another perfectly long reason`, SITE];
    // an annotation with no site beneath it
    const noSite = ["const a = 1;", `${WAIVER}guard -- a perfectly long reason here`, "const b = 2;"];
    const q = await probe({
      "neg-name-41-before.test.ts": tooFar,
      "neg-template-trailing.test.ts": tplTrail,
      "adj-one.test.ts": adjacentOne,
      "adj-two.test.ts": adjacentTwo,
      "no-site.test.ts": noSite,
    });
    const far41 = exactlyOne(q.find("neg-name-41-before.test.ts"), "neg-name-41-before.test.ts", tooFar.length, "name 41 lines away");
    assert.ok(far41.message.toLowerCase().includes("name not used"), `name 41 lines away is "name not used", got: ${far41.message}`);
    const tt = exactlyOne(q.find("neg-template-trailing.test.ts"), "neg-template-trailing.test.ts", 2, "trailing annotation inside a template line");
    assert.match(tt.message.toLowerCase(), /no annotation/);
    exactlyOne(q.find("adj-one.test.ts"), "adj-one.test.ts", 3, "two adjacent sites, one annotation");
    assert.deepEqual(q.coveredIn("adj-one.test.ts"), [{ where: "adj-one.test.ts:2", annotation: "waiver", kind: "guard" }], "adj-one: only the first site is covered");
    assert.deepEqual(q.find("adj-two.test.ts"), [], "two adjacent sites, two annotations");
    assert.deepEqual(q.coveredIn("adj-two.test.ts").map((c) => `${c.where} ${c.kind}`), ["adj-two.test.ts:2 guard", "adj-two.test.ts:4 fixture"], "adj-two: one covered entry per validly annotated site");
    assert.deepEqual(q.find("no-site.test.ts"), [], "an annotation with no site beneath it yields nothing");
    assert.deepEqual(q.coveredIn("no-site.test.ts"), [], "an annotation with no site is absent from covered");
    assert.deepEqual(q.sitesIn("no-site.test.ts"), []);
  });
}

// ---------------------------------------------------------------------------
// Behaviour 3
// ---------------------------------------------------------------------------
function cli(args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd: scratch("cwd"), encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

if (runs(3)) {
  test("W-121 behaviour 3: the rule is wired and blocks from the CLI", { timeout: 600_000 }, () => {
    // Genuine red: today the id is not registered.
    assert.ok(RULE_IDS.has("test.sleep"), "RULE_IDS registers test.sleep");

    const bad = mkRepo("cli-bad", { files: { "x.test.ts": code([SITE]) } });
    const annotated = mkRepo("cli-ann", { files: { "x.test.ts": code([`${WAIVER}guard -- a perfectly long reason here`, SITE]) } });
    const clean = mkRepo("cli-clean", { files: { "x.test.ts": code(["const a = 1;"]) } });
    const off = officina();

    const control = cli(["check", off, "--repo", clean]);
    assert.equal(control.status, 0, `control: a clean fixture exits 0\n${control.out}`);
    const blocked = cli(["check", off, "--repo", bad]);
    assert.equal(blocked.status, 1, `the unannotated fixture exits 1\n${blocked.out}`);
    assert.ok(blocked.out.includes("test.sleep"), `output names the rule\n${blocked.out}`);
    assert.ok(blocked.out.includes("x.test.ts:1"), `output names path:line\n${blocked.out}`);
    const passes = cli(["check", off, "--repo", annotated]);
    assert.equal(passes.status, 0, `the annotated fixture exits 0\n${passes.out}`);
    assert.ok(!passes.out.includes("test.sleep"), "no test.sleep line for the annotated fixture");
    const noRepo = cli(["check", off]);
    assert.equal(noRepo.status, 0, `without --repo the rule does not run\n${noRepo.out}`);
    const lvl = cli(["check", off, "--repo", bad, "--level", "block"]);
    assert.ok(lvl.out.includes("test.sleep") && lvl.out.includes("x.test.ts:1"), `--level block lists the finding\n${lvl.out}`);

    // the RULE_IDS drift guard stays green
    const drift = spawnSync(process.execPath, ["--import", TSX, join(HERE, "lex.test.ts"), "."], { cwd: REPO_ROOT, encoding: "utf8", timeout: 300_000 });
    assert.equal(drift.status, 0, `rules/lex.test.ts (the drift guard) passes\n${drift.stdout}${drift.stderr}`);
  });
}

// ---------------------------------------------------------------------------
// Behaviour 4
// ---------------------------------------------------------------------------
interface NvMod {
  runOnce(opts: Record<string, unknown>): { exitCode: number; log: string[] };
}
type Scenario = "pass" | "fail" | "violation" | "throw" | "refused";
type HookKind = "record" | "throw" | "string" | "object" | "none";
interface Obs {
  calls: number;
  lockAtCall: boolean[];
  lockAfter: boolean;
  threw: unknown;
  result: { exitCode: number; log: string[] } | undefined;
}
const BOOM = "w121 hook boom";

function quiet<R>(fn: () => R): R {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}
function nvFixture(tag: string): { dir: string; shadowDir: string; lockPath: string; logPath: string } {
  const dir = scratch(`nv-${tag}`);
  const shadowDir = join(dir, "test", "bin");
  mkdirSync(shadowDir, { recursive: true });
  for (const name of ["claude", "codex"]) {
    cpSync(join(REPO_ROOT, "test", "bin", name), join(shadowDir, name));
    chmodSync(join(shadowDir, name), 0o755);
  }
  return { dir, shadowDir, lockPath: join(dir, ".bisellium", "vendor-sentinel.lock"), logPath: join(dir, ".bisellium", "vendor-violations.log") };
}
function observe(mod: NvMod, scenario: Scenario, hook: HookKind = "record"): Obs {
  const fx = nvFixture(`${scenario}-${hook}`);
  let suiteCommand = 'node -e "process.exit(0)"';
  if (scenario === "fail") suiteCommand = 'node -e "process.exit(1)"';
  if (scenario === "violation") suiteCommand = `node -e ${JSON.stringify(`require('fs').appendFileSync(${JSON.stringify(fx.logPath)}, 'v\\n')`)}`;
  mkdirSync(dirname(fx.lockPath), { recursive: true });
  if (scenario === "throw") mkdirSync(fx.logPath, { recursive: true }); // logPath is a directory: clearLog throws
  if (scenario === "refused") writeFileSync(fx.lockPath, JSON.stringify({ pid: 424242, startedAt: "2020-01-01T00:00:00.000Z" }));
  const obs: Obs = { calls: 0, lockAtCall: [], lockAfter: false, threw: undefined, result: undefined };
  let beforeRelease: unknown;
  if (hook === "string") beforeRelease = "not a function";
  else if (hook === "object") beforeRelease = {};
  else if (hook === "record" || hook === "throw") {
    beforeRelease = () => {
      obs.calls++;
      obs.lockAtCall.push(existsSync(fx.lockPath));
      if (hook === "throw") throw new Error(BOOM);
    };
  }
  try {
    obs.result = quiet(() => mod.runOnce({ repoRoot: fx.dir, shadowDir: fx.shadowDir, lockPath: fx.lockPath, logPath: fx.logPath, suiteCommand, beforeRelease }));
  } catch (e) {
    obs.threw = e;
  }
  obs.lockAfter = existsSync(fx.lockPath);
  return obs;
}
/** The hook was called once, with the lock present, and the lock is gone afterwards. */
const healthy = (o: Obs): boolean => o.calls === 1 && o.lockAtCall[0] === true && !o.lockAfter;

if (runs(4)) {
  test("W-121 behaviour 4: the no-vendor lock-holder exposes a seam, and the seam sees a held lock", { timeout: 900_000 }, async () => {
    const real = (await import(pathToFileURL(NV_PATH).href)) as NvMod;

    // Genuine red: the option is ignored today, so calls === 1 fails first.
    const seen: Record<string, Obs> = {};
    for (const s of ["pass", "fail", "violation", "throw"] as const) {
      const o = observe(real, s);
      seen[s] = o;
      assert.equal(o.calls, 1, `${s} path: beforeRelease is called exactly once`);
      assert.deepEqual(o.lockAtCall, [true], `${s} path: the lock file exists at the call`);
      assert.equal(o.lockAfter, false, `${s} path: the lock is absent after runOnce returns`);
    }
    assert.equal(seen["pass"]!.result?.exitCode, 0, "pass path exit code unchanged");
    assert.equal(seen["fail"]!.result?.exitCode, 1, "failing-suite path exit code unchanged");
    assert.equal(seen["violation"]!.result?.exitCode, 1, "violation path exit code unchanged");
    assert.ok(seen["violation"]!.result?.log.includes("v"), "violation path still reports the violation");
    assert.ok(seen["throw"]!.threw !== undefined, "throw path actually threw (test validity)");

    const refused = observe(real, "refused");
    assert.equal(refused.calls, 0, "refusal path: the hook is not called (the lock is another run's)");
    assert.equal(refused.lockAfter, true, "refusal path: the other run's lock is untouched");
    assert.equal(refused.result?.exitCode, 1, "refusal path: refused");

    for (const s of ["pass", "violation"] as const) {
      const thrown = observe(real, s, "throw");
      assert.equal(thrown.calls, 1, `throwing hook (${s}): called once`);
      assert.ok(thrown.threw instanceof Error && thrown.threw.message === BOOM, `throwing hook (${s}): the hook's error propagates out of runOnce`);
      assert.equal(thrown.lockAfter, false, `throwing hook (${s}): the lock is absent afterwards`);
      for (const kind of ["string", "object"] as const) {
        const base = observe(real, s, "none");
        const ignored = observe(real, s, kind);
        assert.equal(ignored.threw, undefined, `non-function hook (${kind}, ${s}): ignored`);
        assert.deepEqual(ignored.result, base.result, `non-function hook (${kind}, ${s}): same result as without it`);
        assert.equal(ignored.lockAfter, false, `non-function hook (${kind}, ${s}): lock absent`);
      }
    }

    // production callers do not pass the hook
    const src = readFileSync(NV_PATH, "utf8");
    const at = src.indexOf("runOnce({ repoRoot: REPO_ROOT");
    assert.ok(at >= 0, "main() calls runOnce({ repoRoot: REPO_ROOT");
    const callText = src.slice(at, src.indexOf("});", at) + 3);
    assert.ok(!callText.includes("beforeRelease"), `main()'s runOnce call names no hook: ${callText}`);

    // mutants of the script are detected
    const mutate = async (tag: string, edit: (s: string) => string): Promise<NvMod> => {
      const out = edit(src);
      assert.notEqual(out, src, `${tag}: the mutation applied`);
      const dir = scratch(`mutant-${tag}`);
      mkdirSync(join(dir, "scripts"));
      writeFileSync(join(dir, "scripts", "no-vendor.mjs"), out);
      return (await import(pathToFileURL(join(dir, "scripts", "no-vendor.mjs")).href)) as NvMod;
    };
    const releaseEarly = await mutate("release-early", (s) => s.replace("const snapshot = readLogLines(logPath);", "releaseLock(lockPath);\n    const snapshot = readLogLines(logPath);"));
    const hookAfter = await mutate("hook-after", (s) =>
      `${s.replace("export function runOnce(opts) {", "function runOnceInner(opts) {")}\nexport function runOnce(opts) {\n  const r = runOnceInner({ ...opts, beforeRelease: undefined });\n  if (typeof opts.beforeRelease === 'function') opts.beforeRelease();\n  return r;\n}\n`,
    );
    for (const s of ["pass", "violation"] as const) {
      assert.ok(healthy(observe(real, s)), `the real script is healthy on the ${s} path`);
      assert.ok(!healthy(observe(releaseEarly, s)), `mutant: releaseLock moved before the snapshot is detected on the ${s} path`);
      assert.ok(!healthy(observe(hookAfter, s)), `mutant: the hook after releaseLock is detected on the ${s} path`);
    }

    // the rewritten live-offender test, as a child
    const child = spawnSync(process.execPath, [NV_TEST_PATH, "9"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 300_000 });
    assert.equal(child.status, 0, `scripts/no-vendor.test.mjs 9 exits 0\n${child.stdout}${child.stderr}`);
    assert.match(child.stdout, /^PASS\s+\[9\] row 3/m, `a PASS line for row 3\n${child.stdout}`);
  });
}

// ---------------------------------------------------------------------------
// Behaviour 5
// ---------------------------------------------------------------------------
if (runs(5)) {
  test("W-121 behaviour 5: the tree passes its own rule, row 3 is repaired rather than waived and bounded, and waivers cannot creep", { timeout: 600_000 }, async () => {
    const nv = readFileSync(NV_TEST_PATH, "utf8");
    const start = nv.indexOf('lockFixture("b9-3")');
    const end = nv.indexOf("// Row 4", start);
    assert.ok(start >= 0 && end > start, "found the row-3 block (b9-3 up to the Row 4 comment)");
    const row3 = nv.slice(start, end);

    // Genuine red: row 3 still polls with a timer today.
    assert.ok(!row3.includes(T) && !row3.includes(I), "row 3 has no timer: it is repaired with a seam, not annotated");

    // the deadline is the child_process option, and it works on this platform with events only
    const at = row3.indexOf("spawn(");
    assert.ok(at >= 0, "row 3 spawns A with spawn(");
    const spawnCall = row3.slice(at, row3.indexOf(");", at));
    assert.match(spawnCall, /timeout:\s*[0-9][0-9_]*/, "the spawn options carry a numeric timeout");
    assert.match(spawnCall, /killSignal:\s*["']SIGKILL["']/, "the spawn options carry killSignal SIGKILL");
    const blocked = spawn(process.execPath, ["-e", "require('fs').readFileSync(0)"], { stdio: ["pipe", "ignore", "ignore"], timeout: 500, killSignal: "SIGKILL" });
    const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => {
      blocked.on("error", reject);
      blocked.on("exit", (_code, sig) => resolve(sig));
    });
    assert.equal(signal, "SIGKILL", "a child blocked on stdin is killed by the kernel-level deadline");

    // the tree passes its own rule, and the waivers are bounded by parser-counted caps
    assert.ok(RULE_IDS.has("test.sleep"), "RULE_IDS registers test.sleep, so zero findings is not vacuous");
    const loaded = await loadScan();
    assert.ok(loaded.fn, `rules/tests.ts exports scanTests (${loaded.error ?? "loaded"})`);
    const scan = loaded.fn(join(REPO_ROOT, "studio"), { now: NOW, repo: REPO_ROOT });
    assert.deepEqual(scan.findings, [], "the real repository has zero test.sleep findings");
    assert.ok(scan.sites.length > 0, "the scan sees the annotated sites");
    assert.deepEqual(scan.sites.filter((s) => s.startsWith("scripts/no-vendor.test.mjs:")), [], "no site remains in scripts/no-vendor.test.mjs");
    assert.deepEqual(scan.covered.filter((c) => c.where.startsWith("scripts/no-vendor.test.mjs:")), [], "no covering annotation in scripts/no-vendor.test.mjs");
    const waivers = scan.covered.filter((c) => c.annotation === "waiver");
    const seams = scan.covered.filter((c) => c.annotation === "seam");
    assert.ok(waivers.length <= WAIVER_CAP, `waivers ${waivers.length} <= ${WAIVER_CAP}`);
    assert.ok(waivers.filter((c) => c.kind === "guard").length <= GUARD_CAP, `guard waivers <= ${GUARD_CAP}`);
    assert.ok(waivers.filter((c) => c.kind === "no-observable").length <= NO_OBSERVABLE_CAP, `no-observable waivers <= ${NO_OBSERVABLE_CAP}`);
    assert.ok(seams.length <= SEAM_CAP, `seams ${seams.length} <= ${SEAM_CAP}`);
    for (const c of waivers) assert.ok(WAIVER_KINDS.includes(c.kind), `${c.where}: waiver kind ${c.kind} is one of the four`);
    const coveredWhere = new Set(scan.covered.map((c) => c.where));
    for (const s of scan.sites) assert.ok(coveredWhere.has(s), `${s}: every site has a covering annotation`);

    // this file is in the scanned set (tracked, named *.test.ts) and clean
    const self = "packages/cli/src/rules/tests.test.ts";
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", self], { cwd: REPO_ROOT, env: GIT_ENV, encoding: "utf8" });
    assert.equal(tracked.status, 0, `${self} is tracked (an untracked test file is unseen)`);
    assert.deepEqual(scan.sites.filter((s) => s.startsWith(`${self}:`)), [], "this file has no site: its fixtures are assembled from fragments");
  });
}
