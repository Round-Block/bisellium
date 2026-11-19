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
