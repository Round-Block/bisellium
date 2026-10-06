/**
 * W-137 rows b1-b3: `bisellium retro --opus <id> --from <triage.json>`. Rows are `node:test`,
 * named `W-137-b<n> behaviour <n>: …`; each red is recorded with `--test-name-pattern=W-137-b<n>`.
 * Every row builds its own officina under the OS tmp dir with `initStudio`; nothing here writes in
 * `studio/` or `examples/`. `runRetro` is driven in process, its console output captured.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, test } from "node:test";
import { parse as parseYaml } from "yaml";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";
import { runRetro } from "./retro.js";

const NOW = "2026-10-06T14:00:00Z";
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

type Dict = Record<string, unknown>;

function manifest(retro: string | undefined): string {
  return [
    "bisellium: 1",
    "studio: w137",
    "patron: patron",
    "collegia:",
    "  - { id: production, name: Production, magister: producer }",
    "  - { id: engineering, name: Engineering, magister: eng-lead }",
    "  - { id: qa, name: QA, magister: qa-lead }",
    "sellae:",
    "  - { id: producer, collegium: production, kind: agent }",
    "  - { id: eng-lead, collegium: engineering, kind: agent }",
    "  - { id: qa-lead, collegium: qa, kind: agent }",
    "probationes:",
    "  - { id: patron, name: Patron call, kind: human }",
    "wip_limit: 4",
    ...(retro === undefined ? [] : [`retro: ${retro}`]),
    "",
  ].join("\n");
}

const put = (root: string, rel: string, text: string): void => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};

function log(opus: string, round: number, body: string, extraHeader: string[] = []): string {
  return [`# opus: ${opus}`, "# phase: build", `# round: ${round}`, "# sella: qa-lead", "# outcome: failed", `# at: 2026-10-06T11:00:00Z`, ...extraHeader, "", "## Findings", body, "", "## Verdict", "VERDICT: FAIL", ""].join("\n");
}
const TWO = "1. blocking — a.ts:1 first finding\n2. advisory — b.ts:2 second finding";

interface Fx {
  retro?: string;
  review1?: string;
  review2?: string;
  state?: string;
  /** extra files, officina-relative */
  files?: Record<string, string>;
}
function fixture(o: Fx = {}): string {
  const root = join(mkdtempSync(join(tmpdir(), "bisellium-w137-")), "studio");
  made.push(join(root, ".."));
  assert.equal(initStudio(root, { now: new Date(NOW) }).root, root);
  writeFileSync(join(root, "bisellium.yml"), manifest(o.retro ?? "{ since: 2026-10-06T00:00:00Z, high_greenlit_by: D-1 }"));
  put(root, "decisions/D-1.md", '---\nid: "D-1"\ntitle: "Patron ruling"\nat: 2026-10-06T06:00:00Z\nprovenance: stated\nby: patron\nkill_when: "never"\n---\nRuled.\n');
  const done = (o.state ?? "done") === "done";
  put(
    root,
    "opera/W-1.md",
    `---\nid: "W-1"\ntitle: "fixture"\nkind: "opus"\ncollegium: "engineering"\nstate: ${o.state ?? "done"}\nprobationes: {}\nstart: 2026-10-06T10:00:00Z\n${done ? "end: 2026-10-06T12:00:00Z\n" : ""}---\n`,
  );
  put(root, "ci/W-1-review-1.log", o.review1 ?? log("W-1", 1, TWO));
  put(root, "ci/W-1-review-2.log", o.review2 ?? log("W-1", 2, "No findings"));
  put(root, "ci/reds/W-1/01.log", "# behaviour: 1\n# exit: 1\n\nnot ok 1 - fixture\n");
  for (const [rel, text] of Object.entries(o.files ?? {})) put(root, rel, text);
  return root;
}

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, base) : [relative(base, p)];
  });
}
/** every byte under the officina, so "writes nothing" is a byte comparison. */
const snapshot = (root: string): string =>
  files(root)
    .sort()
    .map((f) => `${f}\0${readFileSync(join(root, f), "utf8")}`)
    .join("\n\0\n");

interface Ran {
  code: number;
  out: string;
  err: string;
}
function retro(root: string, triage: unknown, id = "W-1"): Ran {
  const from = join(root, "..", "triage.json");
  writeFileSync(from, JSON.stringify(triage));
  const out: string[] = [];
  const err: string[] = [];
  const [log0, err0] = [console.log, console.error];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    const { exitCode } = runRetro(["--opus", id, "--from", from, "--studio", root, "--now", NOW]);
    return { code: exitCode, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log0;
    console.error = err0;
  }
}
const ran = (what: string, r: Ran): string => `${what}: exit ${r.code}\n${r.out}\n${r.err}`;

const L1 = "ci/W-1-review-1.log";
const ride = (n: number, cls = "tests×x", fix: unknown = "W-1"): Dict => ({ log: L1, n, class: cls, fix });
const COVER = { findings: [ride(1), ride(2)] };

function refuses(root: string, what: string, triage: unknown): void {
  const before = snapshot(root);
  const r = retro(root, triage);
  assert.equal(r.code, 2, ran(`${what} exits 2`, r));
  assert.ok(r.err.trim().length > 0 && !r.err.trim().includes("\n"), ran(`${what} names one line`, r));
  assert.equal(snapshot(root), before, `${what} leaves the officina byte-identical`);
}

const front = (root: string, rel: string): Dict => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(root, rel), "utf8"));
  return (parseYaml(m![1]!) ?? {}) as Dict;
};
const lessonsOf = (root: string): Dict[] => (existsSync(join(root, "lessons")) ? readdirSync(join(root, "lessons")).sort().map((f) => front(root, `lessons/${f}`)) : []);
const operaIds = (root: string): string[] => readdirSync(join(root, "opera")).map((f) => f.replace(/\.md$/, "")).sort();

test("W-137-b1 behaviour 1: the retro refuses unless every recorded finding is accounted for once", () => {
  const ok = retro(fixture(), COVER);
  assert.equal(ok.code, 0, ran("a triage covering review-1 #1 and #2 exits 0", ok));
  assert.match(ok.out, /acta\/2026-10-06-retro-W-1\.md/, ran("prints the acta path", ok));

  refuses(fixture(), "#2 omitted", { findings: [ride(1)] });
  refuses(fixture(), "#1 listed twice", { findings: [ride(1), ride(1), ride(2)] });
  refuses(fixture(), "review-1 #3, not recorded", { findings: [ride(1), ride(2), ride(3)] });
  refuses(fixture(), "class and not_a_lesson together", { findings: [ride(1), { ...ride(2), not_a_lesson: "dup" }] });
  refuses(fixture(), "an unknown key", { findings: [ride(1), { ...ride(2), why: "x" }] });
  refuses(fixture(), "an unknown top-level key", { findings: [ride(1), ride(2)], extra: true });

  const renamed = fixture();
  renameSync(join(renamed, L1), join(renamed, "ci/W-1-review-01.log"));
  refuses(renamed, "a log renamed W-1-review-01.log", { findings: [ride(1), ride(2)].map((e) => ({ ...e, log: "ci/W-1-review-01.log" })) });

  const other = fixture({ review1: log("W-2", 1, TWO) });
  refuses(other, "a log whose # opus: names W-2", COVER);

  const major = fixture({ review1: log("W-1", 1, "1. major — a.ts:1 first finding\n2. advisory — b.ts:2 second finding") });
  refuses(major, "a finding line 1. major", COVER);

  const red = fixture({ files: { "ci/reds/W-1/1.log": "x\n" } });
  refuses(red, "a red named 1.log", COVER);

  refuses(fixture({ state: "review" }), "an opus in review", COVER);

  const filed = fixture();
  assert.equal(retro(filed, COVER).code, 0, "the first retro files");
  refuses(filed, "a second retro for W-1", COVER);
});

test("W-137-b2 behaviour 2: every lesson names its fix, and the retro stamps it", () => {
  const fix = { title: "add the x row", collegium: "engineering" };
  const root = fixture();
  const r = retro(root, { findings: [ride(1, "tests×x", fix), ride(2, "tests×x", fix)] });
  assert.equal(r.code, 0, ran("a triage with an object fix exits 0", r));
  const opera = operaIds(root).filter((i) => i !== "W-1");
  assert.equal(opera.length, 1, `one new opus: ${opera.join(",")}`);
  const made1 = front(root, `opera/${opera[0]}.md`);
  assert.equal(made1["title"], "add the x row");
  assert.equal(made1["state"], "backlog");
  const lessons = lessonsOf(root);
  assert.equal(lessons.length, 1, "one lesson with addressed_by");
  assert.equal(lessons[0]!["opus"], "W-1");
  assert.equal(lessons[0]!["addressed_by"], opera[0]);
  assert.deepEqual(lessons[0]!["evidence"], [L1]);
  assert.equal(lessons[0]!["class"], "tests×x");
  assert.equal(front(root, "acta/2026-10-06-retro-W-1.md")["opus"], "W-1");

  const nl = fixture();
  assert.equal(retro(nl, { findings: [ride(1, "tests×x", "W-1"), { log: L1, n: 2, not_a_lesson: "dup" }] }).code, 0, "not_a_lesson is accepted");
  assert.equal(lessonsOf(nl).length, 1, "no lesson for the not-a-lesson finding");
  const acta = readFileSync(join(nl, "acta/2026-10-06-retro-W-1.md"), "utf8");
  assert.match(acta, /## Not lessons[\s\S]*ci\/W-1-review-1\.log #2: dup/, "listed under Not lessons");
  assert.equal(front(nl, `lessons/${readdirSync(join(nl, "lessons"))[0]}`)["addressed_by"], "W-1", "a ride-along names the opus itself");

  refuses(fixture(), "a fix that names W-999", { findings: [ride(1, "tests×x", "W-999"), ride(2, "tests×x", "W-999")] });
  refuses(fixture(), "a fix that names lesson.bogus", { findings: [ride(1, "tests×x", "lesson.bogus"), ride(2, "tests×x", "lesson.bogus")] });
  const nope = { title: "add the x row", collegium: "nope" };
  refuses(fixture(), "an object fix with collegium nope", { findings: [ride(1, "tests×x", nope), ride(2, "tests×x", nope)] });
});

test("W-137-b3 behaviour 3: severity is a rule over recorded facts, and a high fix starts greenlit", () => {
  const review1 = log("W-1", 1, "1. blocking — a.ts:1 sec\n2. blocking — b.ts:2 seen\n3. blocking — c.ts:3 plain\n4. advisory — d.ts:4 nit");
  const review2 = log("W-1", 2, "1. blocking — e.ts:5 converted", ["# converted: 1 (cited brief line)"]);
  const seen = '---\nid: "L-1"\nat: 2026-10-01T00:00:00Z\nclass: "tests×seen"\nevidence: ["ci/W-1-review-1.log"]\ncascade: 1\n---\nEarlier.\n';
  const cls = ["security×a", "tests×seen", "tests×plain", "tests×nit", "tests×conv"];
  const fixOf = (c: string): Dict => ({ title: `fix ${c}`, collegium: "engineering" });
  const entries = (): Dict[] => [
    { log: L1, n: 1, class: cls[0], fix: fixOf(cls[0]!) },
    { log: L1, n: 2, class: cls[1], fix: fixOf(cls[1]!) },
    { log: L1, n: 3, class: cls[2], fix: fixOf(cls[2]!) },
    { log: L1, n: 4, class: cls[3], fix: fixOf(cls[3]!) },
    { log: "ci/W-1-review-2.log", n: 1, class: cls[4], fix: fixOf(cls[4]!) },
  ];
  const bySeverity = (root: string): Record<string, unknown> => Object.fromEntries(lessonsOf(root).filter((l) => l["opus"] === "W-1").map((l) => [l["class"] as string, l["severity"]]));
  const stateOfFix = (root: string, c: string): Dict => {
    const lesson = lessonsOf(root).find((l) => l["class"] === c)!;
    return front(root, `opera/${lesson["addressed_by"]}.md`);
  };

  const root = fixture({ review1, review2, files: { "lessons/L-1.md": seen } });
  const r = retro(root, { findings: entries() });
  assert.equal(r.code, 0, ran("the triage exits 0", r));
  const sev = bySeverity(root);
  assert.equal(sev["security×a"], "high", "security×a is high");
  assert.equal(sev["tests×seen"], "high", "a class an existing lesson carries is high");
  assert.equal(sev["tests×plain"], "medium", "a class with a blocking finding is medium");
  assert.equal(sev["tests×nit"], "low", "an advisory-only class is low");
  assert.equal(sev["tests×conv"], "low", "a converted blocking finding is low");
  for (const c of ["security×a", "tests×seen"]) {
    const s = stateOfFix(root, c);
    assert.equal(s["state"], "greenlit", `${c}: the fix opus is greenlit`);
    assert.equal(s["greenlit_by"], "D-1", `${c}: greenlit_by names the decision`);
  }
  for (const c of ["tests×plain", "tests×nit", "tests×conv"]) assert.equal(stateOfFix(root, c)["state"], "backlog", `${c}: the fix stays in backlog`);
  const events = readFileSync(join(root, ".bisellium/events.jsonl"), "utf8").split("\n").filter((l) => l.includes("workflow.greenlight"));
  assert.equal(events.length, 2, "one workflow.greenlight event per started fix");
  assert.ok(events.every((l) => l.includes("granted")), "each is granted");
  assert.match(readFileSync(join(root, "acta/2026-10-06-retro-W-1.md"), "utf8"), /## Fixes started[\s\S]*D-1/, "the acta lists the started fixes");

  const plain = fixture({ retro: "{ since: 2026-10-06T00:00:00Z }", review1, review2, files: { "lessons/L-1.md": seen } });
  assert.equal(retro(plain, { findings: entries() }).code, 0, "without high_greenlit_by the retro still files");
  assert.equal(bySeverity(plain)["security×a"], "high");
  assert.equal(stateOfFix(plain, "security×a")["state"], "backlog", "without high_greenlit_by a high fix stays in backlog");

  const bad = fixture({ retro: "{ since: 2026-10-06T00:00:00Z, high_greenlit_by: D-404 }" });
  const shape = checkStudio(bad, new Date(NOW)).findings.filter((f) => f.rule === "manifest.shape" && f.level === "block");
  assert.ok(shape.some((f) => f.where === "bisellium.yml#retro"), "high_greenlit_by: D-404 is a manifest.shape block");
});

test("W-137-b1 round 2: a hostile id never reaches a path (W-047)", () => {
  const root = fixture();
  // a valid-looking done record one level above opera/, which `../x` would resolve to
  put(root, "x.md", '---\nid: "x"\ntitle: "x"\nkind: "opus"\ncollegium: "engineering"\nstate: done\nprobationes: {}\nend: 2026-10-06T12:00:00Z\n---\n');
  for (const hostile of ["../x", "W-1/../W-1", "..", "W-1\\..\\x"]) {
    const before = snapshot(root);
    const r = retro(root, COVER, hostile);
    assert.equal(r.code, 2, ran(`--opus ${hostile} exits 2`, r));
    assert.equal(snapshot(root), before, `--opus ${hostile} writes nothing`);
  }
  for (const fix of ["../x", "W-1/../W-1", "..", "../acta/x"]) refuses(root, `a fix naming ${fix}`, { findings: [ride(1, "tests×x", fix), ride(2, "tests×x", fix)] });
});

/** A log as `bisellium verdict` writes it, with the pieces a row wants to damage. */
function logWith(o: { header?: string[]; body?: string; findings?: string }): string {
  const header = o.header ?? ["# opus: W-1", "# phase: build", "# round: 1", "# sella: qa-lead", "# outcome: failed", "# at: 2026-10-06T11:00:00Z"];
  return [...header, "", o.body ?? `## Findings\n${o.findings ?? TWO}\n\n## Verdict\nVERDICT: FAIL`, ""].join("\n");
}
const HEAD = ["# opus: W-1", "# phase: build", "# round: 1", "# sella: qa-lead", "# outcome: failed", "# at: 2026-10-06T11:00:00Z"];

test("W-137-b1 round 3: a verdict log is read by one strict parser, or the retro refuses", () => {
  const ok = fixture({ review1: logWith({ header: [...HEAD, "# converted: 1 (cites no line of briefs/W-1.md)"] }) });
  assert.equal(retro(ok, COVER).code, 0, "a log shaped exactly as verdict writes it is accepted");

  const cases: Record<string, string> = {
    "# opus: only in the body, not in the header": logWith({ header: HEAD.slice(1), body: `# opus: W-1\n\n## Findings\n${TWO}\n` }),
    "# opus: twice in the header": logWith({ header: [...HEAD, "# opus: W-1"] }),
    "# converted: inside the Findings section": logWith({ findings: `${TWO}\n# converted: 1 (x)` }),
    "# converted: after the header block": logWith({ body: `## Findings\n${TWO}\n\n# converted: 1 (x)\n` }),
    "a stray prose line under Findings with valid findings": logWith({ findings: `${TWO}\nthe censor also noticed something` }),
    "a malformed tail on # converted:": logWith({ header: [...HEAD, "# converted: 1 (x); junk"] }),
    "an unclosed reason on # converted:": logWith({ header: [...HEAD, "# converted: 1 (cited"] }),
    "# converted: naming an advisory finding": logWith({ header: [...HEAD, "# converted: 2 (x)"] }),
    "# converted: naming a finding that does not exist": logWith({ header: [...HEAD, "# converted: 7 (x)"] }),
    "# converted: twice": logWith({ header: [...HEAD, "# converted: 1 (x)", "# converted: 1 (y)"] }),
    "a header line that is not # key: value": logWith({ header: [...HEAD, "stray header line"] }),
    "No findings beside a numbered finding": logWith({ findings: `No findings\n${TWO}` }),
  };
  for (const [what, text] of Object.entries(cases)) refuses(fixture({ review1: text }), what, COVER);
});

test("W-137-b1 round 3: a symlinked fix, decision or acta parent never reaches outside the officina", () => {
  const outsideOpus = '---\nid: "W-2"\ntitle: "outside"\nkind: "opus"\ncollegium: "engineering"\nstate: backlog\nprobationes: {}\n---\n';
  const outsideDecision = '---\nid: "D-2"\ntitle: "outside"\nat: 2026-10-06T06:00:00Z\nprovenance: stated\nby: patron\nkill_when: "never"\n---\n';
  const link = (root: string, name: string, text: string, rel: string): string => {
    const outside = join(root, "..", name);
    writeFileSync(outside, text);
    symlinkSync(outside, join(root, rel));
    return outside;
  };
  const both = (fix: string): unknown => ({ findings: [ride(1, "tests×x", fix), ride(2, "tests×x", fix)] });

  const a = fixture();
  const outA = link(a, "outside-opus.md", outsideOpus, "opera/W-2.md");
  refuses(a, "a symlinked opera/<fix>.md", both("W-2"));
  assert.equal(readFileSync(outA, "utf8"), outsideOpus, "the file outside is untouched");

  const d = fixture();
  link(d, "outside-decision.md", outsideDecision, "decisions/D-2.md");
  refuses(d, "a symlinked decisions/<fix>.md", both("D-2"));

  const p = fixture();
  const outDir = join(p, "..", "outside-acta");
  mkdirSync(outDir);
  rmSync(join(p, "acta"), { recursive: true });
  symlinkSync(outDir, join(p, "acta"));
  refuses(p, "a symlinked acta/ parent", COVER);
  assert.deepEqual(readdirSync(outDir), [], "nothing was written through the symlink");
});
