/**
 * packages/cli/src/w298.test.ts — W-298 (D-071 G, D-080 D): `bisellium petitio` files a sella's question to the Patron
 * in the records, and `next` holds an opus while a petitio that names it is open. node:test TAP, selected by
 * `--test-name-pattern='^W-298-b<n>\s'`. Every row builds its own world under the OS tmp dir and runs the CLI as a
 * subprocess; nothing here reads or writes the real officina.
 */
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseFrontMatter, snapshotDir } from "@bisellium/adapter-native";
import { checkStudio } from "./check.js";
import { BUDGET, MAIN, NOW_ISO, OPUS, SETUP_ENV, TSX, World, expectStep, git, gitYesNo, next, put, ran, verb, world } from "./next-world.test.js";

const run = (w: World, args: string[], env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> => spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd: w.repo, env: { ...SETUP_ENV, HOME: w.home, ...env }, encoding: "utf8", timeout: 120_000 });
const petitio = (w: World, args: string[], studio = w.studio): SpawnSyncReturns<string> => run(w, ["petitio", ...args, "--studio", studio, "--now", NOW_ISO]);
const listing = (w: World): string[] => (existsSync(join(w.studio, "petitiones")) ? readdirSync(join(w.studio, "petitiones")).sort() : []);
interface Front { id: string; from: string; to: string; state: string; opened: string; subject: string; opus?: string }
const read = (w: World, id: string): { data: Front; body: string } => parseFrontMatter<Front>(readFileSync(join(w.studio, "petitiones", `${id}.md`), "utf8"), id);

test("W-298-b1 behaviour 1: petitio files a sella's question to the Patron in the records, and refuses what check would block", { timeout: 300_000 }, () => {
  const w = world("w298-b1", "backlog");
  const SUBJECT = 'Which "default": ça va?';
  const BODY = 'He said "yes": ça va\n---\nThe second paragraph, every word of it.';
  const first = petitio(w, ["--from", "builder", "--subject", SUBJECT, "--opus", OPUS, BODY]);
  assert.equal(first.status, 0, `the verb files a petitio and exits 0\n--- ${first.stderr}${first.stdout}`);
  assert.equal(first.stdout.trim(), `P-001: ${SUBJECT}`, "the verb prints the new id and the subject");
  const one = read(w, "P-001");
  assert.deepEqual(one.data, { id: "P-001", from: "builder", to: "patron", state: "needs_you", opened: NOW_ISO, subject: SUBJECT, opus: OPUS }, "the record carries the parties, the state, the time, the subject and the opus");
  assert.equal(one.body, BODY, "the body is written verbatim");
  const second = petitio(w, ["--from", "eng-lead.2", "--subject", "No opus", "A question about no one opus."]);
  assert.equal(second.status, 0, `a second filing exits 0\n--- ${second.stderr}`);
  const two = read(w, "P-002");
  assert.equal(two.data.id, "P-002", "the next filing takes the next free id");
  assert.equal("opus" in two.data, false, "without --opus the record names no opus");
  assert.equal(two.data.from, "eng-lead", "an instance of a seat files as the seat");
  assert.deepEqual(checkStudio(w.studio, new Date(NOW_ISO)).findings.filter((x) => x.rule.startsWith("petitio.")), [], "the records check green: no petitio finding, advisory or blocking");
  const row = snapshotDir(w.studio, "w298", new Date(NOW_ISO)).petitiones?.find((p) => p.id === "P-001");
  assert.deepEqual({ subject: row?.subject, opus: row?.opusId, body: row?.body, state: row?.state }, { subject: SUBJECT, opus: OPUS, body: BODY, state: "needs_you" }, "the Inbox's reader carries the subject, the opus and the body");
  const plain = join(w.root, "plain");
  put(plain, "bisellium.yml", readFileSync(join(w.studio, "bisellium.yml"), "utf8"));
  assert.equal(petitio(w, ["--from", "builder", "--subject", "s", "body"], plain).status, 0, "an officina outside git files as any other");

  git(w.repo, ["worktree", "add", "-q", "-b", "linked", join(w.root, "linked")]);
  const manifest = join(w.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("probationes:", "  - { id: old-hand, collegium: engineering, kind: agent, retired: true }\nprobationes:"));
  const refused = (label: string, args: string[], reason: RegExp, studio = w.studio, env: NodeJS.ProcessEnv = {}): void => {
    const before = listing(w);
    const r = run(w, ["petitio", ...args, "--studio", studio], env);
    assert.equal(r.status, 2, `${label}\n--- exit ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, reason, label);
    assert.deepEqual(listing(w), before, label);
  };
  refused("no sender", ["--subject", "s", "body"], /^usage: bisellium petitio .*\n$/);
  refused("no subject", ["--from", "builder", "body"], /^usage: bisellium petitio .*\n$/);
  refused("no body", ["--from", "builder", "--subject", "s"], /^usage: bisellium petitio .*\n$/);
  refused("a blank subject", ["--from", "builder", "--subject", "   ", "body"], /^usage: bisellium petitio .*\n$/);
  refused("a two-line subject", ["--from", "builder", "--subject", "a\nb", "body"], /--subject must be one line/);
  refused("an undeclared sella", ["--from", "nobody", "--subject", "s", "body"], /unknown sella "nobody"/);
  refused("the Patron as the sender", ["--from", "patron", "--subject", "s", "body"], /unknown sella "patron"/);
  refused("a retired seat", ["--from", "old-hand", "--subject", "s", "body"], /retired/);
  refused("an unknown opus", ["--from", "builder", "--subject", "s", "--opus", "W-1", "body"], /unknown opus: W-1/);
  refused("an opus that climbs out", ["--from", "builder", "--subject", "s", "--opus", "../W-900", "body"], /unknown opus/);
  mkdirSync(join(w.studio, "opera", "W-801.md"));
  refused("an opus record that is a directory", ["--from", "builder", "--subject", "s", "--opus", "W-801", "body"], /unknown opus: W-801/);
  symlinkSync(join(w.studio, "opera", `${OPUS}.md`), join(w.studio, "opera", "W-802.md"));
  refused("an opus record that is a symlink", ["--from", "builder", "--subject", "s", "--opus", "W-802", "body"], /unknown opus: W-802/);
  put(w.studio, "opera/W-803.md", "no front matter here\n");
  refused("an opus record with no front matter", ["--from", "builder", "--subject", "s", "--opus", "W-803", "body"], /unknown opus: W-803/);
  put(w.studio, "opera/W-804.md", "---\n- a list\n---\n");
  refused("an opus record that is not a map", ["--from", "builder", "--subject", "s", "--opus", "W-804", "body"], /unknown opus: W-804/);
  put(w.studio, "opera/W-805.md", "---\nid: W-1\n---\n");
  refused("an opus record carrying another id", ["--from", "builder", "--subject", "s", "--opus", "W-805", "body"], /unknown opus: W-805/);
  refused("a time that is not one", ["--from", "builder", "--subject", "s", "--now", "soon", "body"], /--now must be an ISO date/);
  refused("a recipient flag", ["--from", "builder", "--subject", "s", "--to", "eng-lead", "body"], /unknown flag "--to"/);
  refused("a state flag", ["--from", "builder", "--subject", "s", "--state", "resolved", "body"], /unknown flag "--state"/);
  refused("a directory that is no officina", ["--from", "builder", "--subject", "s", "body"], /not a studio/, w.home);
  refused("a linked worktree", ["--from", "builder", "--subject", "s", "body"], /linked worktree/, join(w.root, "linked", "studio"));
  assert.equal(existsSync(join(w.root, "linked", "studio", "petitiones")), false, "a linked worktree gets no petitio");
  git(w.repo, ["worktree", "add", "-q", "-b", "broken", join(w.root, "broken")]);
  rmSync(join(w.repo, ".git", "worktrees", "broken"), { recursive: true });
  refused("a linked worktree whose admin directory is gone", ["--from", "builder", "--subject", "s", "body"], /git cannot tell/, join(w.root, "broken", "studio"));
  put(w.root, "fakebin/git", "#!/bin/sh\nexit 1\n");
  chmodSync(join(w.root, "fakebin", "git"), 0o755);
  refused("a git that cannot answer", ["--from", "builder", "--subject", "s", "body"], /git cannot tell/, w.studio, { PATH: join(w.root, "fakebin") });

  const good = readFileSync(manifest, "utf8");
  const under = (text: string, label: string, args: string[], reason: RegExp): void => {
    writeFileSync(manifest, text);
    refused(label, args, reason);
    writeFileSync(manifest, good);
  };
  const SEND = ["--from", "builder", "--subject", "s", "body"];
  under("- a\n- b\n", "a manifest that is not a mapping", SEND, /it is not a mapping/);
  under(good.replace("patron: patron", 'patron: "  "'), "a blank patron", SEND, /patron must be a nonblank id/);
  under(good.replace(/sellae:\n(  - .*\n)+/, "sellae: {}\n"), "sellae that is not a list", SEND, /sellae must be a list/);
  under(good.replace("sellae:\n", "sellae:\n  - { collegium: engineering }\n"), "a seat with no id", SEND, /sellae must be mappings with unique ids/);
  under(good.replace("sellae:\n", "sellae:\n  - { id: builder, collegium: engineering }\n"), "two seats with one id", SEND, /sellae must be mappings with unique ids/);
  under(good.replace("sellae:\n", 'sellae:\n  - { id: odd-hand, collegium: engineering, retired: "no" }\n'), "a retired that is no boolean", SEND, /retired must be a boolean/);
  const declared = good.replace("sellae:\n", "sellae:\n  - { id: patron, collegium: engineering, kind: agent }\n");
  under(declared, "the Patron declared as a seat", ["--from", "patron", "--subject", "s", "body"], /"patron" is the Patron/);
  under(declared, "an instance of the Patron's seat", ["--from", "patron.2", "--subject", "s", "body"], /"patron\.2" is the Patron/);
});
