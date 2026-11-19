/**
 * packages/cli/src/w531.test.ts — W-531 (D-241): the role contract. node:test TAP, selected by
 * `--test-name-pattern=^W-531-b<n>\s`. Rows b1-b3 build their officinae with `bisellium init` under the OS tmp dir and
 * rewrite only the fixture's own bisellium.yml; nothing here reads or writes the real officina.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as native from "@bisellium/adapter-native";
import * as verdict from "@bisellium/commands/verdict.js";
import { checkStudio } from "./check.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const MAIN = join(HERE, "main.ts");
const NOW = new Date("2026-11-21T00:00:00Z");
const AFTER = "2027-03-01T00:00:00Z";

/** The fixture's rows: canonical seats, one retired tombstone, and the alias table (the switch). */
const ROWS = `collegia:
  - { id: production, name: Production, magister: production-lead, lex: leges/production.md }
  - { id: engineering, name: Engineering, magister: engineering-lead, lex: leges/engineering.md }
sellae:
  - { id: production-lead, collegium: production, kind: agent }
  - { id: production-guest, collegium: production, kind: human }
  - { id: engineering-lead, collegium: engineering, kind: agent }
  - { id: engineering-architect, collegium: engineering, kind: agent }
  - { id: engineering-builder, collegium: engineering, kind: agent, model: claude-sonnet-5 }
  - { id: engineering-builder-codex, collegium: engineering, kind: agent, harness: codex }
  - { id: engineering-reviewer-builder, collegium: engineering, kind: agent }
  - { id: builder-a, collegium: engineering, kind: agent, retired: true }
`;
const ALIASES = `sella_aliases:
  since: 2026-11-20T00:00:00Z
  live_until: 2027-02-18T00:00:00Z
  ids: { producer: production-lead, architect: engineering-architect, eng-lead: engineering-lead, guest: production-guest, builder-codex: { to: engineering-builder, model: gpt-5.6-sol, harness: codex } }
`;
const HEAD = `bisellium: 1\nstudio: "w531"\npatron: patron\ntimezone: "UTC"\n`;
const TAIL = `probationes:\n  - { id: patron, name: Patron call, kind: human }\nwip_limit: 1\n`;

function cli(args: string[], env: Record<string, string> = {}): { status: number | null; out: string; err: string } {
  const base: Record<string, string | undefined> = { ...process.env, ...env };
  if (env["BISELLIUM_SELLA"] === undefined) delete base["BISELLIUM_SELLA"];
  const r = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...args], { cwd: REPO, encoding: "utf8", timeout: 120_000, env: base });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

/** A fresh officina from `bisellium init`, its manifest replaced by `body` (HEAD + body + TAIL). */
function officina(name: string, body: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), `w531-${name}-`)), "s");
  const r = cli(["init", dir, "--now", "2026-11-19T00:00:00Z"]);
  assert.equal(r.status, 0, `init exits 0: ${r.err}`);
  copyFileSync(join(dir, "leges", "production.md"), join(dir, "leges", "engineering.md"));
  writeFileSync(join(dir, "bisellium.yml"), HEAD + body + TAIL);
  return dir;
}

const findings = (dir: string, rule: string): string[] =>
  checkStudio(dir, NOW).findings.filter((f) => f.rule === rule && f.level === "block").map((f) => f.message);

test("W-531-b1 behaviour 1: the alias table and the name rule are checked", () => {
  // the table: each refusal on its own fixture
  const declared = officina("b1-declared", ROWS + ALIASES.replace("guest: production-guest", "guest: production-guest, engineering-lead: production-lead"));
  assert.equal(findings(declared, "manifest.aliases").some((m) => m.includes('"engineering-lead" is a declared sella')), true, "an alias whose old id is a declared row blocks");
  const ghost = officina("b1-ghost", ROWS + ALIASES.replace("guest: production-guest", "guest: production-ghost"));
  assert.equal(findings(ghost, "manifest.aliases").some((m) => m.includes('alias "guest" must name a live declared sella')), true, "an alias to an undeclared seat blocks");
  const retired = officina("b1-retired", ROWS + ALIASES.replace("guest: production-guest", "guest: builder-a"));
  assert.equal(findings(retired, "manifest.aliases").some((m) => m.includes('alias "guest" must name a live declared sella')), true, "an alias to a retired tombstone blocks");
  const dotted = officina("b1-dotted", ROWS + ALIASES.replace("guest: production-guest", "guest: production-guest, builder.W-1: engineering-builder-codex"));
  assert.equal(findings(dotted, "manifest.aliases").some((m) => m.includes('alias "builder.W-1" must be a plain sella id')), true, "an alias that is an instance id blocks");
  const notMap = officina("b1-notmap", ROWS + "sella_aliases:\n  since: 2026-11-20T00:00:00Z\n  ids: [producer]\n");
  assert.equal(findings(notMap, "manifest.aliases").some((m) => m.includes("ids must be a mapping")), true, "ids that are not a mapping block");
  const noSince = officina("b1-nosince", ROWS + ALIASES.replace("  since: 2026-11-20T00:00:00Z\n", ""));
  assert.equal(findings(noSince, "manifest.aliases").some((m) => m.includes("since must be an ISO instant")), true, "a table with no since blocks");
  const impossible = officina("b1-impossible", ROWS + ALIASES.replace("live_until: 2027-02-18T00:00:00Z", "live_until: 2027-02-30T00:00:00Z"));
  assert.equal(findings(impossible, "manifest.aliases").some((m) => m.includes("live_until must be an ISO instant after since")), true, "an impossible live_until blocks");
  assert.throws(() => native.readManifest(impossible), /bisellium\.yml#sella_aliases is refused: live_until must be an ISO instant/, "readManifest refuses a refused table, for every runtime reader");
  const offset = officina("b1-offset", ROWS + ALIASES.replace("since: 2026-11-20T00:00:00Z", 'since: "2026-11-20T08:00:00+08:00"'));
  assert.equal(findings(offset, "manifest.aliases").some((m) => m.includes("since must be an ISO instant")), true, "a non-normalized since blocks");
  const upper = officina("b1-upper", ROWS.replace("sellae:\n", "  - { id: QA_Team, name: QA, magister: engineering-lead, lex: leges/engineering.md }\nsellae:\n  - { id: QA_Team-reviewer, collegium: QA_Team, kind: agent }\n") + ALIASES);
  assert.equal(findings(upper, "sella.name").some((m) => m.includes('collegium "QA_Team" is not lower-case words')), true, "a non-lower-case collegium blocks");
  const early = officina("b1-early", ROWS + ALIASES.replace("live_until: 2027-02-18T00:00:00Z", "live_until: 2026-11-19T00:00:00Z"));
  assert.equal(findings(early, "manifest.aliases").some((m) => m.includes("live_until must be an ISO instant after since")), true, "a live_until before since blocks");

  const badEntry = officina("b1-entry", ROWS + ALIASES.replace("model: gpt-5.6-sol, harness: codex", 'model: "", harness: codex'));
  assert.equal(findings(badEntry, "manifest.aliases").some((m) => m.includes('alias "builder-codex" must be a sella id or { to, model?, harness? }')), true, "an entry with an empty model blocks");
  const extraKey = officina("b1-extra", ROWS + ALIASES.replace("harness: codex }", "harness: codex, tier: high }"));
  assert.equal(findings(extraKey, "manifest.aliases").some((m) => m.includes('alias "builder-codex" must be a sella id or { to, model?, harness? }')), true, "an entry with an unknown key blocks");
  const lastOpus = officina("b1-last", ROWS + ALIASES.replace("  ids:", "  last_opus: 7\n  ids:"));
  assert.equal(findings(lastOpus, "manifest.aliases").some((m) => m.includes("last_opus must be an opus id")), true, "a last_opus that is no opus id blocks");

  // the name rule, under the switch
  const clean = officina("b1-clean", ROWS + ALIASES);
  assert.deepEqual([...findings(clean, "manifest.aliases"), ...findings(clean, "sella.name")], [], "the contract's own fixture is clean: canonical rows, a qualifier, a retired tombstone exempt");
  const old = officina("b1-old", ROWS.replace("engineering-architect", "architect") + ALIASES.replace("architect: engineering-architect, ", ""));
  assert.equal(findings(old, "sella.name").some((m) => m.startsWith('sella "architect" is not {collegium}-{role}')), true, "a live row named outside the rule blocks");
  const wrongCollegium = officina("b1-wrongcol", ROWS.replace("{ id: production-guest, collegium: production", "{ id: engineering-guest, collegium: production") + ALIASES.replace("guest: production-guest", "guest: engineering-guest"));
  assert.equal(findings(wrongCollegium, "sella.name").some((m) => m.startsWith('sella "engineering-guest" is not {collegium}-{role}')), true, "a row whose prefix is another collegium blocks");
  const unknownRole = officina("b1-role", ROWS.replace("engineering-builder-codex", "engineering-docs") + ALIASES);
  assert.equal(findings(unknownRole, "sella.name").some((m) => m.startsWith('sella "engineering-docs" is not')), true, "a role outside the vocabulary blocks");
  const emptyQualifier = officina("b1-q", ROWS.replace("engineering-builder-codex", "engineering-builder-") + ALIASES);
  assert.equal(findings(emptyQualifier, "sella.name").some((m) => m.startsWith('sella "engineering-builder-" is not')), true, "an empty qualifier blocks");
  const off = officina("b1-off", ROWS.replace("engineering-architect", "architect"));
  assert.deepEqual(findings(off, "sella.name"), [], "no sella_aliases: the switch is off and no name is refused");
});

test("W-531-b2 behaviour 2: an old id resolves to its canonical seat, forever, through the one resolver", () => {
  const dir = officina("b2", ROWS + ALIASES);
  const m = native.readManifest(dir);
  const r = native.resolveSeat(m, "architect");
  assert.equal(r?.seat.id, "engineering-architect", "an old id resolves to its canonical row");
  assert.equal((r as { alias?: string } | undefined)?.alias, "architect", "the resolution says which old id named it");
  assert.equal(native.resolveSeat(m, "engineering-architect")?.seat.id, "engineering-architect", "a canonical id resolves as before");
  assert.equal((native.resolveSeat(m, "engineering-architect") as { alias?: string } | undefined)?.alias, undefined, "a canonical id carries no alias");
  const inst = native.resolveSeat(m, "eng-lead.W-001");
  assert.deepEqual([inst?.seat.id, inst?.instance], ["engineering-lead", "W-001"], "an old id's instance resolves to the canonical seat's instance");
  assert.equal(native.resolveSeat(m, "ghost"), undefined, "an id neither declared nor aliased resolves to nothing");
  assert.equal(native.resolveSeat(m, "builder-a")?.seat.retired, true, "a retired tombstone still resolves as itself");
  const canonical = (native as unknown as { canonicalSella?: (m: unknown, id: string) => string }).canonicalSella;
  const same = (native as unknown as { sameSella?: (m: unknown, a: string, b: string) => boolean }).sameSella;
  assert.equal(typeof canonical, "function", "canonicalSella is exported");
  assert.equal(typeof same, "function", "sameSella is exported");
  assert.equal(canonical!(m, "producer"), "production-lead", "canonicalSella names the canonical seat");
  assert.equal(canonical!(m, "eng-lead.W-001"), "engineering-lead.W-001", "canonicalSella keeps the instance");
  assert.equal(canonical!(m, "ghost"), "ghost", "canonicalSella leaves an unresolved id as written");
  assert.equal(same!(m, "architect", "engineering-architect"), true, "an old id and its canonical id are the same seat");
  assert.equal(same!(m, "architect", "engineering-lead"), false, "two seats are not the same seat");

  // a record written before the cutover, naming an old id, stays blocking-clean
  writeFileSync(join(dir, "opera", "W-001.md"), `---\nid: "W-001"\ntitle: "t"\nkind: "feature"\ncollegium: "engineering"\nstate: backlog\nprobationes: {}\ntraditio:\n  sella: architect\n  stage: backlog\n  next: x\n  blocked_on: none\n  at: 2026-11-19T00:00:00.000Z\n---\n`);
  assert.deepEqual(findings(dir, "traditio.sella"), [], "a handoff naming an old id stays declared");
  const r2 = checkStudio(dir, NOW);
  assert.equal(r2.blocks, 0, `the officina stays blocking-clean: ${r2.findings.filter((f) => f.level === "block").map((f) => `${f.rule}: ${f.message}`).join("; ")}`);
});

test("W-531-b3 behaviour 3: a write names the canonical seat; an old id's live use warns, then is refused", () => {
  const dir = officina("b3", ROWS + ALIASES);
  const made = cli(["new", "--kind", "feature", "--collegium", "engineering", "--title", "t", dir]);
  assert.equal(made.status, 0, `new exits 0: ${made.err}`);
  const h = cli(["handoff", "--opus", "W-001", "--sella", "architect", "--next", "draft", "--studio", dir, "--now", NOW.toISOString()]);
  assert.equal(h.status, 0, `a handoff under an old id is accepted while old ids are live: ${h.err}`);
  assert.match(readFileSync(join(dir, "opera", "W-001.md"), "utf8"), /traditio:\n {2}sella: engineering-architect\n/, "the handoff records the canonical id");
  assert.match(h.err, /sella "architect" is now "engineering-architect"/, "the handoff says the id moved");
  const a = cli(["amend", "W-001", "--title", "t2", "--reason", "r", "--sella", "eng-lead", "--studio", dir, "--now", NOW.toISOString()]);
  assert.equal(a.status, 0, `an amendment under an old id is accepted: ${a.err}`);
  assert.match(readFileSync(join(dir, "opera", "W-001.md"), "utf8"), /- at: [^\n]+\n {4}sella: engineering-lead\n/, "the amendment records the canonical id");
  const same = cli(["handoff", "--opus", "W-001", "--sella", "engineering-architect", "--next", "draft", "--studio", dir, "--now", NOW.toISOString()]);
  assert.equal(same.status, 0, `a canonical id is accepted: ${same.err}`);
  assert.doesNotMatch(same.err, /is now/, "a canonical id draws no notice");
  const late = cli(["handoff", "--opus", "W-001", "--sella", "architect", "--next", "draft", "--studio", dir, "--now", AFTER]);
  assert.equal(late.status, 2, "after live_until an old id's live use is refused");
  assert.match(late.err, /sella "architect" is now "engineering-architect": old ids are read-only since 2027-02-18T00:00:00Z/, "the refusal names the canonical id");
  const ctx = cli(["context", "--sella", "architect", dir, "--now", AFTER]);
  assert.equal(ctx.status, 1, "booting as an old id after live_until exits 1");
  assert.match(ctx.err, /sella "architect" is now "engineering-architect"/, "booting as an old id after live_until is refused with the reason");
  // an old id that ran on another model never runs silently on the canonical row's: refused, inside the window too
  // a refused table refuses every runtime reader before any write, a canonical id included
  const refused = officina("b3-refused", ROWS + ALIASES.replace("live_until: 2027-02-18T00:00:00Z", "live_until: 2027-02-30T00:00:00Z"));
  assert.equal(cli(["new", "--kind", "feature", "--collegium", "engineering", "--title", "t", refused]).status, 0, "new on the refused fixture exits 0 before any table read matters");
  const before = readFileSync(join(refused, "opera", "W-001.md"), "utf8");
  const r = cli(["handoff", "--opus", "W-001", "--sella", "engineering-architect", "--next", "draft", "--studio", refused, "--now", NOW.toISOString()]);
  assert.equal(r.status, 2, "a verb on a refused table exits 2");
  assert.match(r.err, /sella_aliases is refused/, "a verb refuses a refused table before any write");
  assert.equal(readFileSync(join(refused, "opera", "W-001.md"), "utf8"), before, "nothing is written under a refused table");
  const codex = cli(["handoff", "--opus", "W-001", "--sella", "builder-codex.W-001", "--next", "build", "--studio", dir, "--now", NOW.toISOString()]);
  assert.equal(codex.status, 2, "a Codex build's old id is refused live while old ids are live");
  assert.match(codex.err, /sella "builder-codex" is now "engineering-builder", which runs claude-sonnet-5 on claude-code, not gpt-5.6-sol on codex/, "the refusal names both routings");
  // the window is extended while a pre-cutover opus is in flight, and check names it before the expiry
  const ext = officina("b3-ext", ROWS + ALIASES.replace("  ids:", "  last_opus: W-001\n  ids:"));
  assert.equal(cli(["new", "--kind", "feature", "--collegium", "engineering", "--title", "t", ext]).status, 0, "new exits 0");
  const rec = join(ext, "opera", "W-001.md");
  writeFileSync(rec, readFileSync(rec, "utf8").replace("state: backlog", "state: greenlit"));
  const kept = cli(["handoff", "--opus", "W-001", "--sella", "architect", "--next", "draft", "--studio", ext, "--now", AFTER]);
  assert.equal(kept.status, 0, `past live_until an old id stays live while a pre-cutover opus is open: ${kept.err}`);
  assert.match(kept.err, /old ids stay live past 2027-02-18T00:00:00Z while pre-cutover opera are open \(W-001\)/, "the notice names the open opus");
  const soon = checkStudio(ext, new Date("2027-02-10T00:00:00Z")).findings.filter((f) => f.rule === "manifest.aliases.window");
  assert.deepEqual(soon.map((f) => f.message), ["old ids stay live past 2027-02-18T00:00:00Z while these pre-cutover opera are open: W-001"], "check names the open pre-cutover opera before the expiry");
  assert.deepEqual(checkStudio(ext, new Date("2026-12-01T00:00:00Z")).findings.filter((f) => f.rule === "manifest.aliases.window"), [], "check is silent long before the expiry");
  writeFileSync(rec, readFileSync(rec, "utf8").replace("state: greenlit", "state: done"));
  assert.equal(cli(["handoff", "--opus", "W-001", "--sella", "architect", "--next", "draft", "--studio", ext, "--now", AFTER]).status, 2, "once no pre-cutover opus is open, an old id is refused");
  // history stays readable after the window: the check reads the old id still
  writeFileSync(join(dir, "opera", "W-002.md"), `---\nid: "W-002"\ntitle: "t"\nkind: "feature"\ncollegium: "engineering"\nstate: backlog\nprobationes: {}\ntraditio:\n  sella: architect\n  stage: backlog\n  next: x\n  blocked_on: none\n  at: 2026-11-19T00:00:00.000Z\n---\n`);
  assert.deepEqual(checkStudio(dir, new Date(AFTER)).findings.filter((f) => f.rule === "traditio.sella"), [], "after live_until an old id still reads");
});

