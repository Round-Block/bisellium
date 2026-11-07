/**
 * W-525 rows b1 and b2 (studio/briefs/W-525.md): `bisellium lift` undoes a halt under a Patron's ruling that names the opus
 * and is dated after the halt (b1); `bisellium conclude` closes a research record, off the build ladder, with its report in
 * acta/ and no gate asked (b2). b3 is in next-ladder.test.ts, on next's own fixture. node:test TAP, selected by
 * `--test-name-pattern='^W-525-b<k>\s'`. Each row builds its own officina under the OS tmp dir and runs the real CLI entry;
 * nothing here reads or writes `studio/` or `examples/`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";
import { owedRetros } from "./retro.js";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "main.ts");
const TSX = import.meta.resolve("tsx");
const NOW = "2026-11-07T09:00:00.000Z";
const HALTED_AT = "2026-11-03T15:01:49.155Z";
// no name in the environment: `--sella` is read as given
const { BISELLIUM_SELLA: _unset, ...ENV } = process.env;
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
type Dict = Record<string, unknown>;

const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const MANIFEST = [
  "bisellium: 1",
  "studio: w525",
  "patron: patron",
  "collegia:",
  "  - { id: production, name: Production, magister: producer }",
  "  - { id: engineering, name: Engineering, magister: eng-lead }",
  "sellae:",
  "  - { id: producer, collegium: production, kind: agent }",
  "  - { id: eng-lead, collegium: engineering, kind: agent }",
  "probationes:",
  "  - { id: tests, name: Tests, kind: automated, command: 'true' }",
  "  - { id: review, name: Review, kind: agent }",
  "wip_limit: 4",
  "retro: { since: 2026-01-01T00:00:00Z }",
  "",
].join("\n");
const MILESTONES = "milestones:\n  - { id: M1, title: One, weight: 100, exit: { needs: a thing } }\n";
const QUEUE = "queues:\n  engineering:\n    lanes: { E1: ~ }\n    next:\n      - { opus: W-7, says: ranked }\nhalted:\n  - { opus: W-8, says: listed halted }\ndeferred:\n  - { opus: W-9, says: listed deferred }\n";
const decision = (id: string, f: { by?: string; at?: string; names?: string; more?: string[] } = {}): string =>
  [`---`, `id: "${id}"`, `title: "a ruling"`, `at: ${f.at ?? "2026-11-06T15:05:00Z"}`, "provenance: stated", `by: ${f.by ?? "patron"}`, 'kill_when: "never"', ...(f.more ?? []), "---", "", `## Ruling`, "", `It moves ${f.names ?? "W-7"}.`, ""].join("\n");

/** An opus record: halted by D-1 at HALTED_AT, mapped to M1, unless `f` says otherwise; a null drops the key. */
function opusText(id: string, f: Dict = {}): string {
  const fields: Dict = { id, title: `fixture ${id}`, kind: "feature", collegium: "engineering", state: "halted", probationes: {}, milestone: "M1", value: 2, halted_at: HALTED_AT, reason: "not ranked", resume_when: "the freeze ends", halted_by: "D-1", ...f };
  const lines = Object.entries(fields).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\nBody of ${id}.\n`;
}

interface World {
  studio: string;
  opus: (id: string, f?: Dict) => void;
  run: (...args: string[]) => { code: number; out: string; err: string };
  /** as `run`, with no `--now` of its own */
  bare: (...args: string[]) => { code: number; out: string; err: string };
  text: (id: string) => string;
  front: (id: string) => Dict;
  events: () => Dict[];
  blocks: (id: string) => string[];
}
function world(o: { queue?: string | null; milestones?: string | null } = {}): World {
  const repo = join(mkdtempSync(join(tmpdir(), "w525-")), "repo");
  made.push(dirname(repo));
  mkdirSync(repo);
  const studio = join(repo, "studio");
  assert.equal(initStudio(studio, { now: new Date(NOW) }).root, studio, "fixture: initStudio");
  writeFileSync(join(studio, "bisellium.yml"), MANIFEST);
  if (o.milestones !== null) writeFileSync(join(studio, "milestones.yml"), o.milestones ?? MILESTONES);
  if (o.queue !== null) writeFileSync(join(studio, "queue.yml"), o.queue ?? QUEUE);
  put(join(studio, "decisions", "D-1.md"), decision("D-1", { at: "2026-11-03T15:05:00Z", names: "W-1" }));
  put(join(studio, "decisions", "D-2.md"), decision("D-2"));
  const path = (id: string): string => join(studio, "opera", `${id}.md`);
  // readQueue asks that every id it lists has a record
  for (const id of ["W-7", "W-8", "W-9"]) put(path(id), opusText(id));
  const w: World = {
    studio,
    opus: (id, f) => put(path(id), opusText(id, f)),
    run: (...args) => {
      const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args, "--studio", studio, "--now", NOW], { cwd: repo, encoding: "utf8", env: ENV, timeout: 120_000 });
      return { code: r.status ?? -1, out: r.stdout.trim(), err: r.stderr.trim() };
    },
    bare: (...args) => {
      const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args, "--studio", studio], { cwd: repo, encoding: "utf8", env: ENV, timeout: 120_000 });
      return { code: r.status ?? -1, out: r.stdout.trim(), err: r.stderr.trim() };
    },
    text: (id) => readFileSync(path(id), "utf8"),
    front: (id) => parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(readFileSync(path(id), "utf8"))![1]!) as Dict,
    events: () => {
      const p = join(studio, ".bisellium", "events.jsonl");
      return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Dict) : [];
    },
    blocks: (id) => checkStudio(studio, new Date(NOW)).findings.filter((x) => x.level === "block" && x.where === `opera/${id}.md`).map((x) => x.rule),
  };
  return w;
}

const LIFT = ["--reason", "the ruling lifts it", "--decision", "D-2", "--sella", "producer"];
// what openStudio's parse lets through and a seat or event reader would throw on: both verbs share the refusal
const BAD_MANIFESTS: [string, string][] = [
  ["a scalar manifest", "nope\n"],
  ["a scalar sellae", MANIFEST.replace(/sellae:\n(?: {2}- .*\n)+/, "sellae: nope\n")],
  ["a mapping sellae", MANIFEST.replace(/sellae:\n(?: {2}- .*\n)+/, "sellae: { producer: { collegium: production } }\n")],
  ["a null seat", MANIFEST.replace(/sellae:\n(?: {2}- .*\n)+/, "sellae:\n  - ~\n  - { id: producer, collegium: production, kind: agent }\n")],
  ["no sellae", MANIFEST.replace(/sellae:\n(?: {2}- .*\n)+/, "")],
  ["no studio", MANIFEST.replace("studio: w525\n", "")],
  ["a studio that is no string", MANIFEST.replace("studio: w525\n", "studio: 7\n")],
  ["a blank studio", MANIFEST.replace("studio: w525\n", "studio: '  '\n")],
];

test("W-525-b1 behaviour 1: lift undoes a halt under a Patron's ruling that names the opus, dated after the halt, and refuses anything else, writing nothing", { timeout: 600_000 }, () => {
  const w = world();
  w.opus("W-7");
  const before = w.text("W-7");
  const r = w.run("lift", "W-7", ...LIFT);
  const front = w.front("W-7");
  assert.equal(front["state"], "greenlit", `a lift moves a halted record to greenlit: ${JSON.stringify(r)}`);
  assert.deepEqual([r.code, r.out, r.err], [0, "W-7: state=greenlit lifted by=D-2", ""], "the verb says what it did");
  assert.deepEqual(["halted_at", "reason", "resume_when", "halted_by"].filter((k) => front[k] !== undefined), [], "the four halt fields are gone");
  assert.deepEqual(
    front["amendments"],
    [{ at: NOW, sella: "producer", field: "halt", reason: "the ruling lifts it", decision: "D-2", superseded: `halted ${HALTED_AT} by D-1: not ranked; resume when: the freeze ends` }],
    "the row says who, when, why, against what and what it undid",
  );
  assert.deepEqual(
    w.events().map((e) => [e["name"], (e["attrs"] as Dict)["workflow.state.from"], (e["attrs"] as Dict)["workflow.state.to"], (e["attrs"] as Dict)["workflow.item.id"]]),
    [["workflow.state_changed", "halted", "greenlit", "W-7"]],
    "one state event, from halted to greenlit",
  );
  assert.equal(existsSync(join(w.studio, "timeline", "patron.jsonl")), false, "no Patron timeline line");
  assert.equal(w.text("W-7").split("\n---\n")[1], before.split("\n---\n")[1], "the body is byte-identical");
  assert.deepEqual(w.blocks("W-7"), [], "a lifted record is no block of its own");

  // a second halt and lift keep the first row
  assert.equal(w.run("halt", "W-7", "--reason", "again", "--resume-when", "later", "--decision", "D-1", "--sella", "producer").code, 0, "fixture: a real halt");
  put(join(w.studio, "decisions", "D-3.md"), decision("D-3", { at: "2026-11-08T00:00:00Z" }));
  const again = spawnSync(process.execPath, ["--import", TSX, MAIN, "lift", "W-7", "--reason", "again lifted", "--decision", "D-3", "--sella", "producer", "--studio", w.studio, "--now", "2026-11-08T01:00:00.000Z"], { encoding: "utf8", cwd: dirname(w.studio) });
  assert.equal(again.status, 0, `a real halt lifts again: ${again.stderr}`);
  assert.deepEqual((w.front("W-7")["amendments"] as Dict[]).map((a) => a["decision"]), ["D-2", "D-3"], "a second lift appends a second row");

  // past ready: back to building, as ready's own test reads it
  const past = world();
  past.opus("W-7", { start: "2026-10-01T00:00:00Z" });
  past.run("lift", "W-7", ...LIFT);
  assert.equal(past.front("W-7")["state"], "building", "a record with a start goes back to building");
  assert.equal(past.front("W-7")["start"], "2026-10-01T00:00:00Z", "its start is kept");
  const runtime = world();
  runtime.opus("W-7", { builder_runtime: "isolated" });
  runtime.run("lift", "W-7", ...LIFT);
  assert.equal(runtime.front("W-7")["state"], "building", "a record with a builder_runtime goes back to building");

  // the classifying rule for a terminal halt: the forms it recognises, and a longer word it does not
  for (const [label, resume] of [["a bare never", "never"], ["never with a colon", "never: W-58 carries this scope"], ["never with a semicolon", "never; W-40 carries it"], ["never with a dash", "never — see D-19"], ["Never, capitalised", "Never"], ["never, leading space", " never"], ["never-ending (the limit)", "never-ending"]] as const) {
    const t = world();
    t.opus("W-7", { resume_when: resume });
    const was = t.text("W-7");
    const out = t.run("lift", "W-7", ...LIFT);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, /W-7: lift refused: its halt is terminal/, `says why: ${label}`);
    assert.equal(t.text("W-7"), was, `writes nothing: ${label}`);
  }
  const decree = world();
  decree.opus("W-7");
  put(join(decree.studio, "decisions", "D-2.md"), decision("D-2").replace("## Ruling", "## Decree"));
  assert.equal(decree.run("lift", "W-7", ...LIFT).code, 0, "a ## Decree section is a ruling");
  // the heading's domain: a whole line, ended by LF or CRLF
  for (const [label, text] of [["## Ruling, CRLF throughout", decision("D-2").replace(/\n/g, "\r\n")], ["## Decree, CRLF throughout", decision("D-2").replace("## Ruling", "## Decree").replace(/\n/g, "\r\n")]] as const) {
    const t = world();
    t.opus("W-7");
    put(join(t.studio, "decisions", "D-2.md"), text);
    assert.equal(t.run("lift", "W-7", ...LIFT).code, 0, `a ruling: ${label}`);
  }
  const longer = world();
  longer.opus("W-7", { resume_when: "nevertheless, when the Patron asks" });
  assert.equal(longer.run("lift", "W-7", ...LIFT).code, 0, "a longer word opening with never is no terminal halt");

  // the ruling: a halt older decisions cannot lift, so a freeze's record stays put (D-178)
  const rulings: [string, string, RegExp][] = [
    ["by another seat", decision("D-9", { by: "qa-lead" }), /is by "qa-lead", not patron "patron"/],
    ["that does not name it", decision("D-9", { names: "W-70" }), /does not name W-7 in its ruling/],
    ["naming it only above its ruling", decision("D-9", { names: "W-70" }).replace("## Ruling", "There is still no verb (W-7).\n\n## Ruling"), /does not name W-7 in its ruling/],
    ["with no ruling section", decision("D-9").replace("## Ruling", "## Context"), /holds no ## Ruling section/],
    ["with a deeper heading", decision("D-9").replace("## Ruling", "### Ruling"), /holds no ## Ruling section/],
    ["with a longer heading", decision("D-9").replace("## Ruling", "## Rulings"), /holds no ## Ruling section/],
    ["naming it in a heading inside its front matter", decision("D-9", { names: "W-70", more: ["## Ruling W-7"] }), /does not name W-7 in its ruling/],
    ["with the heading `## Ruling:`", decision("D-9").replace("## Ruling", "## Ruling:"), /holds no ## Ruling section/],
    ["with the heading `## Ruling W-7`", decision("D-9").replace("## Ruling", "## Ruling W-7"), /holds no ## Ruling section/],
    ["with the heading `## Ruling-x`", decision("D-9").replace("## Ruling", "## Ruling-x"), /holds no ## Ruling section/],
    ["with the heading `##Ruling`", decision("D-9").replace("## Ruling", "##Ruling"), /holds no ## Ruling section/],
    ["with a blank after the heading", decision("D-9").replace("## Ruling", "## Ruling "), /holds no ## Ruling section/],
    ["with a tab after the heading", decision("D-9").replace("## Ruling", "## Ruling\t"), /holds no ## Ruling section/],
    ["with the heading after a lone CR", decision("D-9", { names: "W-70" }).replace("\n## Ruling\n", "W-7 above.\r## Ruling\nW-7\n"), /holds no ## Ruling section/],
    ["with the heading after a U+2028", decision("D-9", { names: "W-70" }).replace("\n## Ruling\n", "W-7 above.\u2028## Ruling\nW-7\n"), /holds no ## Ruling section/],
    ["with the heading ended by a lone CR", decision("D-9", { names: "W-70" }).replace("## Ruling\n", "## Ruling\rW-7\n"), /holds no ## Ruling section/],
    ["with `## Ruling` ended by U+2028", decision("D-9").replace("## Ruling\n", "## Ruling\u2028"), /holds no ## Ruling section/],
    ["with `## Ruling` ended by U+2029", decision("D-9").replace("## Ruling\n", "## Ruling\u2029"), /holds no ## Ruling section/],
    ["with `## Ruling` ended by a double CR", decision("D-9").replace("## Ruling\n", "## Ruling\r\r\n"), /holds no ## Ruling section/],
    ["with `## Decree` ended by U+2028", decision("D-9").replace("## Ruling\n", "## Decree\u2028"), /holds no ## Ruling section/],
    ["with `## Decree` ended by U+2029", decision("D-9").replace("## Ruling\n", "## Decree\u2029"), /holds no ## Ruling section/],
    ["with `## Decree` ended by a double CR", decision("D-9").replace("## Ruling\n", "## Decree\r\r\n"), /holds no ## Ruling section/],
    ["with no by", decision("D-9").replace("by: patron\n", ""), /has no "by"/],
    ["with no at", decision("D-9").replace(/^at: .*\n/m, ""), /decision "D-9" at must be a string/],
    ["with a loose at", decision("D-9").replace(/^at: .*\n/m, "at: yesterday\n"), /decision "D-9" at must match/],
    ["that cannot be parsed", "---\nby: [oops\n---\n## Ruling\n\nW-7\n", /could not be read/],
    ["older than the halt", decision("D-9", { at: "2026-10-01T00:00:00Z" }), /not after the halt/],
    ["dated at the halt", decision("D-9", { at: HALTED_AT }), /not after the halt/],
  ];
  for (const [label, text, says] of rulings) {
    const t = world();
    t.opus("W-7");
    put(join(t.studio, "decisions", "D-9.md"), text);
    const was = t.text("W-7");
    const out = t.run("lift", "W-7", "--reason", "x", "--decision", "D-9", "--sella", "producer");
    assert.equal(out.code, 2, `refused: a decision ${label}`);
    assert.match(out.err, says, `says why: a decision ${label}`);
    assert.equal(t.text("W-7"), was, `writes nothing: a decision ${label}`);
    assert.equal(t.events().length, 0, `no event: a decision ${label}`);
  }
  const frozen = world();
  frozen.opus("W-7");
  const frozenWas = frozen.text("W-7");
  assert.equal(frozen.run("lift", "W-7", "--reason", "x", "--decision", "D-1", "--sella", "producer").code, 2, "refused: the decision that halted it, which does not name it");
  assert.equal(frozen.text("W-7"), frozenWas, "writes nothing: the decision that halted it");
  const absent = frozen.run("lift", "W-7", "--reason", "x", "--decision", "D-404", "--sella", "producer");
  assert.equal(absent.code, 2, "refused: an unknown decision");
  assert.match(absent.err, /decision "D-404" not found/, "says why: an unknown decision");

  // the record's own state and clock
  const shapes: [string, Dict, RegExp][] = [
    ["not halted", { state: "greenlit" }, /it is not halted \(state: greenlit\)/],
    ["no halted_at", { halted_at: null }, /halted_at is not an exact UTC time/],
    ["a loose halted_at", { halted_at: "yesterday" }, /halted_at is not an exact UTC time/],
    ["no milestone", { milestone: null }, /no declared milestone and value/],
    ["an undeclared milestone", { milestone: "M9" }, /no declared milestone and value/],
    ["a value off the scale", { value: 4 }, /no declared milestone and value/],
    ["amendments that are no list", { amendments: "x" }, /amendments: is not a sequence/],
    ["amendments that are a mapping", { amendments: { field: "halt" } }, /amendments: is not a sequence/],
    ["a row that is no mapping", { amendments: ["x"] }, /amendments\[0\] is not a mapping/],
    ["a halt row with no decision", { amendments: [{ at: NOW, field: "halt" }] }, /amendments\[0\] \(field: halt\) has no decision id/],
    ["a halt row with a loose at", { amendments: [{ at: "yesterday", field: "halt", decision: "D-1" }] }, /amendments\[0\] \(field: halt\) has no exact UTC at/],
    ["a halt with no reason", { reason: null }, /its reason is missing or blank/],
    ["a halt with a non-string reason", { reason: 7 }, /its reason is missing or blank/],
    ["a halt with a blank reason", { reason: "  " }, /its reason is missing or blank/],
    ["a halt with no resume_when", { resume_when: null }, /its resume_when is missing or blank/],
    ["a halt with a non-string resume_when", { resume_when: false }, /its resume_when is missing or blank/],
    ["a halt with a blank resume_when", { resume_when: "" }, /its resume_when is missing or blank/],
    ["a halt with no halted_by", { halted_by: null }, /its halted_by is missing or blank/],
    ["a halt with a non-string halted_by", { halted_by: 12 }, /its halted_by is missing or blank/],
    ["a halt with a blank halted_by", { halted_by: " " }, /its halted_by is missing or blank/],
  ];
  for (const [label, f, says] of shapes) {
    const t = world();
    t.opus("W-7", f);
    const was = t.text("W-7");
    const out = t.run("lift", "W-7", ...LIFT);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, says, `says why: ${label}`);
    assert.equal(t.text("W-7"), was, `writes nothing: ${label}`);
  }

  // the Queue moves first: an unranked record is not put back (D-174 item 2)
  for (const [label, id, says] of [["unranked in the Queue", "W-70", /W-70 is not ranked in queue\.yml: rank it/], ["under the Queue's halted list", "W-8", /W-8 is not ranked in queue\.yml \(it is under halted\)/], ["under the Queue's deferred list", "W-9", /W-9 is not ranked in queue\.yml \(it is under deferred\)/]] as const) {
    const t = world();
    t.opus(id);
    put(join(t.studio, "decisions", "D-2.md"), decision("D-2", { names: id }));
    const was = t.text(id);
    const out = t.run("lift", id, ...LIFT);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, says, `says why: ${label}`);
    assert.equal(t.text(id), was, `writes nothing: ${label}`);
  }
  const dirQueue = world({ queue: null });
  dirQueue.opus("W-7");
  mkdirSync(join(dirQueue.studio, "queue.yml"));
  const dirOut = dirQueue.run("lift", "W-7", ...LIFT);
  assert.equal(dirOut.code, 2, "refused: an unreadable Queue");
  assert.match(dirOut.err, /queue\.yml cannot be read/, "says why: an unreadable Queue");
  const badMilestones = world({ milestones: "milestones: [oops\n" });
  badMilestones.opus("W-7");
  assert.equal(badMilestones.run("lift", "W-7", ...LIFT).code, 2, "refused: a malformed milestones.yml");
  const badQueue = world({ queue: "queues: nope\n" });
  badQueue.opus("W-7");
  const badOut = badQueue.run("lift", "W-7", ...LIFT);
  assert.equal(badOut.code, 2, "refused: a malformed Queue");
  assert.match(badOut.err, /queue\.yml is malformed/, "says why: a malformed Queue");
  const noQueue = world({ queue: null });
  noQueue.opus("W-7");
  assert.equal(noQueue.run("lift", "W-7", ...LIFT).code, 0, "no queue.yml asks no rank");
  const noMilestones = world({ milestones: null });
  noMilestones.opus("W-7", { milestone: null, value: null });
  assert.equal(noMilestones.run("lift", "W-7", ...LIFT).code, 0, "no milestones.yml asks no milestone");

  // usage
  const u = world();
  u.opus("W-7");
  const was = u.text("W-7");
  const named = ["--sella", "producer"];
  for (const [label, args] of [["no reason", ["lift", "W-7", "--decision", "D-2", ...named]], ["a blank reason", ["lift", "W-7", "--reason", "  ", "--decision", "D-2", ...named]], ["no decision", ["lift", "W-7", "--reason", "x", ...named]], ["no opus", ["lift", "--reason", "x", "--decision", "D-2", ...named]], ["an unknown flag", ["lift", "W-7", "--reason", "x", "--decision", "D-2", "--force", "y", ...named]], ["an unknown opus", ["lift", "W-70", "--reason", "x", "--decision", "D-2", ...named]], ["an unknown sella", ["lift", "W-7", "--reason", "x", "--decision", "D-2", "--sella", "nobody"]], ["no sella", ["lift", "W-7", "--reason", "x", "--decision", "D-2"]], ["a path for an id", ["lift", "../W-7", "--reason", "x", "--decision", "D-2", ...named]]] as const) {
    assert.equal(u.run(...args).code, 2, `refused: ${label}`);
    assert.equal(u.text("W-7"), was, `writes nothing: ${label}`);
  }

  const twoIds = u.run("lift", "W-7", "W-8", ...LIFT);
  assert.deepEqual([twoIds.code, /W-8/.test(twoIds.err)], [2, true], "refused: two opus ids, naming the extra one");
  assert.equal(u.text("W-7"), was, "writes nothing: two opus ids");
  const blankDecision = u.run("lift", "W-7", "--reason", "x", "--decision", "  ", ...named);
  assert.deepEqual([blankDecision.code, /^usage: bisellium lift/.test(blankDecision.err)], [2, true], "refused: a blank decision");
  const looseNow = u.bare("lift", "W-7", ...LIFT, "--now", "2026-11-07");
  assert.deepEqual([looseNow.code, looseNow.err], [2, "--now must be an ISO date"], "refused: a loose --now");
  assert.equal(u.text("W-7"), was, "writes nothing: a blank decision or a loose --now");

  // the manifest: a shape openStudio's parse lets through is refused, never thrown
  for (const [label, text] of BAD_MANIFESTS) {
    const t = world();
    t.opus("W-7");
    writeFileSync(join(t.studio, "bisellium.yml"), text);
    const before = t.text("W-7");
    const out = t.run("lift", "W-7", ...LIFT);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, /bisellium\.yml: it/, `says why: ${label}`);
    assert.equal(t.text("W-7"), before, `writes nothing: ${label}`);
  }
  const noManifest = world();
  noManifest.opus("W-7");
  rmSync(join(noManifest.studio, "bisellium.yml"));
  assert.equal(noManifest.run("lift", "W-7", ...LIFT).code, 2, "refused: no manifest");

  const listed = world();
  put(join(listed.studio, "opera", "W-7.md"), "---\n- a list\n---\n");
  const listedOut = listed.run("lift", "W-7", ...LIFT);
  assert.deepEqual([listedOut.code, listedOut.err], [2, "W-7: its record is not a mapping"], "refused: a record that is no mapping");

  const garbled = world();
  put(join(garbled.studio, "opera", "W-7.md"), "---\nid: [oops\n---\n");
  const garbledOut = garbled.run("lift", "W-7", ...LIFT);
  assert.deepEqual([garbledOut.code, garbledOut.out], [2, ""], "refused: an unreadable record");
  assert.equal(garbled.text("W-7"), "---\nid: [oops\n---\n", "writes nothing: an unreadable record");

  // decision.invoked_after_kill reads the row, as it reads halted_by
  const killed = world();
  killed.opus("W-7");
  put(join(killed.studio, "decisions", "D-2.md"), decision("D-2", { more: ["killed_at: 2026-11-07T00:00:00Z", "killed_by: decisions/D-1.md"] }));
  assert.equal(killed.run("lift", "W-7", ...LIFT).code, 0, "fixture: the verb, like halt, leaves a killed decision to check");
  assert.deepEqual(checkStudio(killed.studio, new Date(NOW)).findings.filter((x) => x.rule === "decision.invoked_after_kill").map((x) => x.where), ["opera/W-7.md"], "a lift citing a killed decision blocks");
  const live = world();
  live.opus("W-7");
  put(join(live.studio, "decisions", "D-2.md"), decision("D-2", { more: ["killed_at: 2026-11-08T00:00:00Z", "killed_by: decisions/D-1.md"] }));
  live.run("lift", "W-7", ...LIFT);
  assert.deepEqual(checkStudio(live.studio, new Date(NOW)).findings.filter((x) => x.rule === "decision.invoked_after_kill"), [], "a lift before the kill does not");

  // check reads the same list by the same reader: a shape that could hide a killed decision blocks, and none is skipped
  const open = { state: "greenlit", halted_at: null, reason: null, resume_when: null, halted_by: null };
  const rows: [string, unknown, RegExp][] = [
    ["amendments that are no list", "x", /amendments: is not a sequence/],
    ["amendments that are a mapping", { field: "halt", decision: "D-2", at: NOW }, /amendments: is not a sequence/],
    ["a null amendments", "NULL", /amendments: is not a sequence/],
    ["a row that is no mapping", [7], /amendments\[0\] is not a mapping/],
    ["a halt row with no decision", [{ at: NOW, field: "halt" }], /amendments\[0\] \(field: halt\) has no decision id/],
    ["a halt row with a blank decision", [{ at: NOW, field: "halt", decision: " " }], /amendments\[0\] \(field: halt\) has no decision id/],
    ["a halt row with a non-string decision", [{ at: NOW, field: "halt", decision: 2 }], /amendments\[0\] \(field: halt\) has no decision id/],
    ["a halt row with a loose at", [{ at: "yesterday", field: "halt", decision: "D-2" }], /amendments\[0\] \(field: halt\) has no exact UTC at/],
    ["a halt row with no at", [{ field: "halt", decision: "D-2" }], /amendments\[0\] \(field: halt\) has no exact UTC at/],
  ];
  for (const [label, amendments, says] of rows) {
    const t = world();
    t.opus("W-7", { ...open, amendments: amendments === "NULL" ? "x" : amendments });
    if (amendments === "NULL") writeFileSync(join(t.studio, "opera", "W-7.md"), t.text("W-7").replace('amendments: "x"', "amendments:"));
    const found = checkStudio(t.studio, new Date(NOW)).findings.filter((x) => x.rule === "decision.invoked_after_kill" && x.where === "opera/W-7.md");
    assert.equal(found.length, 1, `check: ${label}`);
    assert.equal(found[0]!.level, "block", `check blocks: ${label}`);
    assert.match(found[0]!.message, says, `check says why: ${label}`);
  }
  const other = world();
  other.opus("W-7", { ...open, amendments: [{ at: "yesterday", field: "title", from: "a", to: "b" }, { at: NOW, sella: "producer", field: "halt", reason: "x", decision: "D-2", superseded: "y" }] });
  assert.deepEqual(checkStudio(other.studio, new Date(NOW)).findings.filter((x) => x.rule === "decision.invoked_after_kill"), [], "check: another field's row asks no decision, and a well-formed halt row passes");
});

const CONCLUDE = ["--decision", "D-2", "--sella", "producer"];
const REPORT = "# The study\n\nIt found a thing.\n";

test("W-525-b2 behaviour 2: conclude closes a research record off the build ladder, with its report in acta/, no gate asked and no retro owed, and refuses anything else, writing nothing", { timeout: 600_000 }, () => {
  const researched = (f: Dict = {}): World & { from: string } => {
    const w = world();
    w.opus("W-7", { kind: "research", state: "greenlit", halted_at: null, reason: null, resume_when: null, halted_by: null, ...f });
    const from = join(dirname(w.studio), "report.md");
    writeFileSync(from, REPORT);
    return Object.assign(w, { from });
  };
  const w = researched();
  const before = w.text("W-7");
  const r = w.run("conclude", "W-7", "--from", w.from, ...CONCLUDE);
  const front = w.front("W-7");
  assert.equal(front["state"], "done", `a concluded record is done: ${JSON.stringify(r)}`);
  const rel = "acta/2026-11-07-report-W-7.md";
  assert.deepEqual([r.code, r.out, r.err], [0, `W-7: done report=${rel} by=D-2`, ""], "the verb says what it did");
  assert.deepEqual([front["end"], front["report"], front["concluded_by"], front["start"]], [NOW, rel, "D-2", undefined], "the record names its end, report and ruling, and has no start");
  assert.equal(w.text("W-7").split("\n---\n")[1], before.split("\n---\n")[1], "the body is byte-identical");
  const text = readFileSync(join(w.studio, rel), "utf8");
  assert.deepEqual(parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(text)![1]!), { author: "producer", kind: "consultation", title: "Report W-7", at: NOW, opus: "W-7" }, "the report's head");
  assert.equal(text.split("\n---\n")[1], REPORT, "the report's bytes follow its head");
  assert.deepEqual(
    w.events().map((e) => [e["name"], (e["attrs"] as Dict)["workflow.state.from"], (e["attrs"] as Dict)["workflow.state.to"]]),
    [["workflow.state_changed", "greenlit", "done"]],
    "one state event, from greenlit to done",
  );
  assert.deepEqual(w.blocks("W-7"), [], "check asks no gate of a concluded record");
  assert.deepEqual(checkStudio(w.studio, new Date(NOW)).findings.filter((x) => x.where === rel && x.level === "block").map((x) => x.rule), [], "the report passes acta's rules");
  assert.deepEqual(owedRetros(w.studio), { owed: [] }, "a concluded record owes no retro");

  // from backlog too: W-527 sits there, and a ruling names it
  const backlog = researched({ state: "backlog" });
  assert.equal(backlog.run("conclude", "W-7", "--from", backlog.from, ...CONCLUDE).code, 0, "a backlog study concludes");
  assert.equal(backlog.front("W-7")["state"], "done", "a backlog study is done");

  // what the verb refuses
  const refusals: [string, Dict, RegExp][] = [
    ["another kind", { kind: "feature" }, /its kind is feature, not research/],
    ["halted", { state: "halted" }, /it is halted, not backlog or greenlit: lift it first/],
    ["building", { state: "building" }, /it is building, not backlog or greenlit/],
    ["done", { state: "done" }, /it is done, not backlog or greenlit/],
    ["a start", { start: "2026-10-01T00:00:00Z" }, /it has taken the build ladder/],
    ["a builder_runtime", { builder_runtime: "isolated" }, /it has taken the build ladder/],
    ["no milestone", { milestone: null }, /no declared milestone and value/],
  ];
  for (const [label, f, says] of refusals) {
    const t = researched(f);
    const was = t.text("W-7");
    const out = t.run("conclude", "W-7", "--from", t.from, ...CONCLUDE);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, says, `says why: ${label}`);
    assert.equal(t.text("W-7"), was, `writes nothing: ${label}`);
    assert.equal(existsSync(join(t.studio, rel)), false, `no report: ${label}`);
  }
  const rulings: [string, string, RegExp][] = [
    ["a decision by another seat", decision("D-2", { by: "qa-lead" }), /is by "qa-lead", not patron "patron"/],
    ["a decision that does not name it", decision("D-2", { names: "W-70" }), /does not name W-7 in its ruling/],
    ["a decision with the heading `## Ruling:`", decision("D-2").replace("## Ruling", "## Ruling:"), /holds no ## Ruling section/],
    ["a decision with the heading `## Ruling W-7`", decision("D-2").replace("## Ruling", "## Ruling W-7"), /holds no ## Ruling section/],
    ["a decision with the heading `## Ruling-x`", decision("D-2").replace("## Ruling", "## Ruling-x"), /holds no ## Ruling section/],
    ["a decision with the heading `##Ruling`", decision("D-2").replace("## Ruling", "##Ruling"), /holds no ## Ruling section/],
    ["a decision with a blank after the heading", decision("D-2").replace("## Ruling", "## Ruling "), /holds no ## Ruling section/],
    ["a decision with the heading after a lone CR", decision("D-2", { names: "W-70" }).replace("\n## Ruling\n", "W-7 above.\r## Ruling\nW-7\n"), /holds no ## Ruling section/],
    ["a decision with the heading after a U+2028", decision("D-2", { names: "W-70" }).replace("\n## Ruling\n", "W-7 above.\u2028## Ruling\nW-7\n"), /holds no ## Ruling section/],
    ["a decision with `## Ruling` ended by U+2028", decision("D-2").replace("## Ruling\n", "## Ruling\u2028"), /holds no ## Ruling section/],
    ["a decision with `## Ruling` ended by U+2029", decision("D-2").replace("## Ruling\n", "## Ruling\u2029"), /holds no ## Ruling section/],
    ["a decision with `## Ruling` ended by a double CR", decision("D-2").replace("## Ruling\n", "## Ruling\r\r\n"), /holds no ## Ruling section/],
    ["a decision with `## Decree` ended by U+2028", decision("D-2").replace("## Ruling\n", "## Decree\u2028"), /holds no ## Ruling section/],
    ["a decision with `## Decree` ended by U+2029", decision("D-2").replace("## Ruling\n", "## Decree\u2029"), /holds no ## Ruling section/],
    ["a decision with `## Decree` ended by a double CR", decision("D-2").replace("## Ruling\n", "## Decree\r\r\n"), /holds no ## Ruling section/],
  ];
  for (const [label, d, says] of rulings) {
    const t = researched();
    put(join(t.studio, "decisions", "D-2.md"), d);
    const out = t.run("conclude", "W-7", "--from", t.from, ...CONCLUDE);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, says, `says why: ${label}`);
    assert.equal(t.front("W-7")["state"], "greenlit", `writes nothing: ${label}`);
    assert.equal(existsSync(join(t.studio, rel)), false, `no report: ${label}`);
  }
  const froms: [string, (t: World & { from: string }) => string, RegExp][] = [
    ["an empty report", (t) => (writeFileSync(t.from, " \n\n"), t.from), /is empty/],
    ["a missing report", (t) => `${t.from}.gone`, /cannot be read/],
    ["a directory for a report", (t) => dirname(t.from), /is not a regular file/],
    ["a symlink for a report", (t) => (symlinkSync(t.from, `${t.from}.link`), `${t.from}.link`), /is not a regular file/],
  ];
  for (const [label, make, says] of froms) {
    const t = researched();
    const out = t.run("conclude", "W-7", "--from", make(t), ...CONCLUDE);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, says, `says why: ${label}`);
    assert.equal(t.front("W-7")["state"], "greenlit", `writes nothing: ${label}`);
  }
  const linked = researched();
  symlinkSync(join(dirname(linked.studio), "elsewhere.md"), join(linked.studio, rel));
  assert.equal(linked.run("conclude", "W-7", "--from", linked.from, ...CONCLUDE).code, 2, "refused: a symlink at the report's name");
  assert.equal(existsSync(join(dirname(linked.studio), "elsewhere.md")), false, "nothing is written through a symlink at the report's name");
  for (const [label, text] of BAD_MANIFESTS) {
    const t = researched();
    writeFileSync(join(t.studio, "bisellium.yml"), text);
    const out = t.run("conclude", "W-7", "--from", t.from, ...CONCLUDE);
    assert.equal(out.code, 2, `refused: ${label}`);
    assert.match(out.err, /bisellium\.yml: it/, `says why: ${label}`);
    assert.equal(t.front("W-7")["state"], "greenlit", `writes nothing: ${label}`);
    assert.equal(existsSync(join(t.studio, rel)), false, `no report: ${label}`);
  }
  const taken = researched();
  put(join(taken.studio, rel), "already here\n");
  const takenOut = taken.run("conclude", "W-7", "--from", taken.from, ...CONCLUDE);
  assert.equal(takenOut.code, 2, "refused: a report already at that name");
  assert.equal(readFileSync(join(taken.studio, rel), "utf8"), "already here\n", "an existing report is not overwritten");
  assert.equal(taken.front("W-7")["state"], "greenlit", "writes nothing: a report already at that name");
  const decreed = researched();
  put(join(decreed.studio, "decisions", "D-2.md"), decision("D-2").replace("## Ruling", "## Decree"));
  assert.equal(decreed.run("conclude", "W-7", "--from", decreed.from, ...CONCLUDE).code, 0, "a ## Decree section is a ruling");
  for (const [label, text] of [["## Ruling, CRLF throughout", decision("D-2").replace(/\n/g, "\r\n")], ["## Decree, CRLF throughout", decision("D-2").replace("## Ruling", "## Decree").replace(/\n/g, "\r\n")]] as const) {
    const t = researched();
    put(join(t.studio, "decisions", "D-2.md"), text);
    assert.equal(t.run("conclude", "W-7", "--from", t.from, ...CONCLUDE).code, 0, `a ruling: ${label}`);
  }
  const two = researched();
  const twoOut = two.run("conclude", "W-7", "W-8", "--from", two.from, ...CONCLUDE);
  assert.deepEqual([twoOut.code, /W-8/.test(twoOut.err)], [2, true], "refused: two opus ids, naming the extra one");
  assert.equal(two.front("W-7")["state"], "greenlit", "writes nothing: two opus ids");
  assert.equal(existsSync(join(two.studio, rel)), false, "no report: two opus ids");
  const u = researched();
  for (const [label, args] of [["no --from", ["conclude", "W-7", ...CONCLUDE]], ["no decision", ["conclude", "W-7", "--from", u.from, "--sella", "producer"]], ["no sella", ["conclude", "W-7", "--from", u.from, "--decision", "D-2"]], ["a sella not declared", ["conclude", "W-7", "--from", u.from, "--decision", "D-2", "--sella", "guest"]]] as const) {
    assert.equal(u.run(...args).code, 2, `refused: ${label}`);
    assert.equal(u.front("W-7")["state"], "greenlit", `writes nothing: ${label}`);
  }

  // what check and owedRetros ask of a record no verb wrote, or one edited since: one classifier, one validator
  const HEAD = (opus: string): string => `---\nauthor: producer\nkind: consultation\ntitle: x\nat: "${NOW}"\nopus: ${opus}\n---\nx\n`;
  const reads: [string, Dict, (t: World) => void, string[]][] = [
    ["a report outside acta", { report: "briefs/W-7.md", concluded_by: "D-2" }, (t) => put(join(t.studio, "briefs", "W-7.md"), HEAD("W-7")), ["research.report"]],
    ["no report", { concluded_by: "D-2" }, () => undefined, ["research.report"]],
    ["a blank report", { report: " ", concluded_by: "D-2" }, () => undefined, ["research.report"]],
    ["a report that is no string", { report: 7, concluded_by: "D-2" }, () => undefined, ["research.report"]],
    ["a blank concluded_by", { report: "acta/mine.md", concluded_by: " " }, (t) => put(join(t.studio, "acta", "mine.md"), HEAD("W-7")), ["research.report"]],
    ["a concluded_by that is no string", { report: "acta/mine.md", concluded_by: 7 }, (t) => put(join(t.studio, "acta", "mine.md"), HEAD("W-7")), ["research.report"]],
    ["a concluded_by naming no decision", { report: "acta/mine.md", concluded_by: "D-404" }, (t) => put(join(t.studio, "acta", "mine.md"), HEAD("W-7")), ["research.report"]],
    ["a report that is not there", { report: "acta/gone.md", concluded_by: "D-2" }, () => undefined, ["research.report"]],
    ["a report for another opus", { report: "acta/other.md", concluded_by: "D-2" }, (t) => put(join(t.studio, "acta", "other.md"), `---\nauthor: producer\nkind: consultation\ntitle: x\nat: "${NOW}"\nopus: W-70\n---\nx\n`), ["research.report"]],
    ["a ruling by another seat", { report: "acta/mine.md", concluded_by: "D-9" }, (t) => { put(join(t.studio, "acta", "mine.md"), `---\nauthor: producer\nkind: consultation\ntitle: x\nat: "${NOW}"\nopus: W-7\n---\nx\n`); put(join(t.studio, "decisions", "D-9.md"), decision("D-9", { by: "qa-lead" })); }, ["research.report"]],
    ["no ruling: the gates apply", { report: "acta/mine.md" }, (t) => put(join(t.studio, "acta", "mine.md"), `---\nauthor: producer\nkind: consultation\ntitle: x\nat: "${NOW}"\nopus: W-7\n---\nx\n`), ["state.done.probationes"]],
  ];
  for (const [label, f, setup, want] of reads) {
    const t = world();
    t.opus("W-7", { kind: "research", state: "done", end: NOW, halted_at: null, reason: null, resume_when: null, halted_by: null, ...f });
    setup(t);
    assert.deepEqual(t.blocks("W-7").filter((x) => want.includes(x) || x === "research.report" || x === "state.done.probationes"), want, `check: ${label}`);
    const owes = owedRetros(t.studio);
    if (want.includes("research.report")) assert.match((owes as { error?: string }).error ?? "", /opera\/W-7\.md: its conclusion is not valid/, `owedRetros: ${label}`);
    else assert.deepEqual(owes, { owed: ["W-7"] }, `owedRetros: ${label}`);
  }
  const blankReport = world();
  blankReport.opus("W-7", { kind: "research", state: "done", end: NOW, report: " ", concluded_by: "D-2", halted_at: null, reason: null, resume_when: null, halted_by: null });
  assert.match(checkStudio(blankReport.studio, new Date(NOW)).findings.find((x) => x.rule === "research.report")?.message ?? "", /is not a path under acta/, "check says why: a blank report");
  const blankBy = world();
  put(join(blankBy.studio, "acta", "mine.md"), HEAD("W-7"));
  blankBy.opus("W-7", { kind: "research", state: "done", end: NOW, report: "acta/mine.md", concluded_by: " ", halted_at: null, reason: null, resume_when: null, halted_by: null });
  assert.match(checkStudio(blankBy.studio, new Date(NOW)).findings.find((x) => x.rule === "research.report")?.message ?? "", /concluded_by " " is not a decision id/, "check says why: a blank concluded_by");
  // an officina with no retro setting owes nothing, and still agrees with check about a conclusion
  const unset = world();
  writeFileSync(join(unset.studio, "bisellium.yml"), MANIFEST.replace(/retro: .*\n/, ""));
  put(join(unset.studio, "opera", "W-70.md"), "---\nid: [oops\n---\n");
  assert.deepEqual(owedRetros(unset.studio), { owed: [] }, "no retro setting owes nothing and reads no other record");
  unset.opus("W-7", { kind: "research", state: "done", end: NOW, report: "acta/gone.md", concluded_by: "D-2", halted_at: null, reason: null, resume_when: null, halted_by: null });
  assert.match((owedRetros(unset.studio) as { error?: string }).error ?? "", /its conclusion is not valid/, "owedRetros: a bad conclusion with no retro setting");
  const runtimed = world();
  runtimed.opus("W-7", { kind: "research", state: "done", builder_runtime: "isolated", end: NOW, report: "acta/x.md", concluded_by: "D-2", halted_at: null, reason: null, resume_when: null, halted_by: null });
  assert.equal(runtimed.blocks("W-7").includes("state.done.probationes"), true, "check: a research record with a builder_runtime keeps its gates");
  assert.deepEqual((owedRetros(runtimed.studio) as { owed: string[] }).owed, ["W-7"], "a research record with a builder_runtime owes its retro");
  const killed = researched();
  put(join(killed.studio, "decisions", "D-2.md"), decision("D-2", { more: ["killed_at: 2026-11-07T00:00:00Z", "killed_by: decisions/D-1.md"] }));
  assert.equal(killed.run("conclude", "W-7", "--from", killed.from, ...CONCLUDE).code, 0, "fixture: the verb, like halt, leaves a killed decision to check");
  assert.deepEqual(checkStudio(killed.studio, new Date(NOW)).findings.filter((x) => x.rule === "decision.invoked_after_kill").map((x) => x.where), ["opera/W-7.md"], "a conclusion citing a killed decision blocks");
  const live = researched();
  put(join(live.studio, "decisions", "D-2.md"), decision("D-2", { more: ["killed_at: 2026-11-08T00:00:00Z", "killed_by: decisions/D-1.md"] }));
  live.run("conclude", "W-7", "--from", live.from, ...CONCLUDE);
  assert.deepEqual(checkStudio(live.studio, new Date(NOW)).findings.filter((x) => x.rule === "decision.invoked_after_kill"), [], "a conclusion before the kill does not");
  const started = world();
  started.opus("W-7", { kind: "research", state: "done", start: "2026-10-01T00:00:00Z", end: NOW, report: "acta/x.md", concluded_by: "D-2", halted_at: null, reason: null, resume_when: null, halted_by: null });
  assert.equal(started.blocks("W-7").includes("state.done.probationes"), true, "check: a research record that took the ladder keeps its gates");
  assert.deepEqual((owedRetros(started.studio) as { owed: string[] }).owed, ["W-7"], "a research record that took the ladder owes its retro");
  const feature = world();
  feature.opus("W-7", { kind: "feature", state: "done", end: NOW, report: "acta/x.md", concluded_by: "D-2", halted_at: null, reason: null, resume_when: null, halted_by: null });
  assert.equal(feature.blocks("W-7").includes("state.done.probationes"), true, "check: concluded_by on any other kind buys nothing");
  assert.deepEqual((owedRetros(feature.studio) as { owed: string[] }).owed, ["W-7"], "any other kind owes its retro");
});
