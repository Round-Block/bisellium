/**
 * packages/cli/src/w298.test.ts — W-298 (D-071 G, D-080 D): `bisellium petitio` files a sella's question to the Patron
 * in the records, and `next` holds an opus while a petitio that names it is open. node:test TAP, selected by
 * `--test-name-pattern='^W-298-b<n>\s'`. Every row builds its own world under the OS tmp dir and runs the CLI as a
 * subprocess; nothing here reads or writes the real officina.
 */
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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
  const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
  const ctl = petitio(w, ["--from", "builder", "--subject", "red \u001b[31mALERT\u0007 \u009b0m end", "body"]);
  assert.equal(ctl.status, 0, `an admitted control-bearing subject files and exits 0\n--- ${ctl.stderr}${ctl.stdout}`);
  assert.equal(read(w, "P-003").data.subject, "red \u001b[31mALERT\u0007 \u009b0m end", "the record keeps the control-bearing subject exactly");
  assert.doesNotMatch(ctl.stdout, CONTROL, "stdout carries no raw C0 or C1 control");
  assert.match(ctl.stdout, /^P-003: red .*ALERT.* end\n$/, "the printed line still names the id and the subject's text");
  for (const [label, args] of [["--from", ["--from", "no\u001bbody", "--subject", "s", "body"]], ["--opus", ["--from", "builder", "--subject", "s", "--opus", "W-\u001b9", "body"]], ["an unknown flag", ["--from", "builder", "--\u001bbogus", "body"]]] as const) {
    const bad = petitio(w, [...args]);
    assert.equal(bad.status, 2, `${label} with a control is refused\n--- ${bad.stderr}${bad.stdout}`);
    assert.doesNotMatch(bad.stderr, CONTROL, `${label}: stderr carries no raw control`);
  }

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

test("W-298-b2 behaviour 2: next names the Patron and holds while a petitio naming the opus is open, and reads what it cannot read as a hold", { timeout: 600_000 }, () => {
  const w = world("w298-b2", "reds", { automated: true });
  const SEAM = { env: { BISELLIUM_TEST_SILENCE_ENTRIES: "0" } };
  const named = (label: string): void => {
    const r = next(w, [OPUS, ...BUDGET]);
    expectStep(r, "build", "named", label);
    assert.equal(r.status, 0, ran(label, r));
  };
  const holds = (label: string, actor: string, why: RegExp): void => {
    const r = next(w, [OPUS, ...BUDGET]);
    assert.equal(r.first, `next: ${OPUS} build held`, ran(label, r));
    assert.equal(r.status, 1, ran(label, r));
    assert.equal(r.kv.get("actor"), actor, label);
    assert.match(r.kv.get("why") ?? "", why, label);
  };
  const file = (id: string, state: string, opus: string, to = "patron"): void => put(w.studio, `petitiones/${id}.md`, `---\nid: ${id}\nfrom: builder\nto: ${to}\nstate: ${state}\nopus: ${opus}\n---\nbody\n`);

  named("no petitiones directory holds nothing");
  const open = next(w, [OPUS, ...BUDGET], SEAM);
  assert.match(open.kv.get("health") ?? "", /silence not judged/, "the dispatch order reads its silence before a petitio is filed");

  verb(w.repo, ["petitio", "--from", "builder", "--subject", "Which default?", "--opus", OPUS, "--studio", w.studio, "--now", NOW_ISO, "The whole question."]);
  const held = next(w, [OPUS, ...BUDGET], SEAM);
  assert.equal(held.first, `next: ${OPUS} build held`, ran("an open petitio holds the opus at its own rung", held));
  assert.equal(held.status, 1, ran("a held opus exits 1", held));
  assert.equal(held.kv.get("actor"), "patron", "next names the Patron as the actor");
  assert.equal(held.kv.get("why"), `P-001 asks the Patron: Which default?; answer in the Inbox, or: bisellium answer --petitio P-001 <reply…> --studio studio`, "the why names the petitio, its subject and how to answer");
  assert.equal(held.kv.get("underlying"), open.kv.get("why"), "the rung it would otherwise name stays visible");
  assert.equal(held.kv.has("command"), false, "a held opus gets no order");
  assert.equal(held.kv.get("health"), "no step recorded", "a held opus reads no silence: it waits on the Patron");

  const all = next(w, ["--all"], { clock: false });
  assert.equal(all.status, 1, ran("next --all exits 1 on a held opus", all));
  assert.match(all.out, new RegExp(`^next: ${OPUS} build held · actor: patron · why: P-001 asks the Patron: Which default\\?; answer in the Inbox, or: bisellium answer --petitio P-001 <reply…> --studio studio · traditio: .*$`, "m"), "next --all prints the same hold");

  verb(w.repo, ["answer", "--petitio", "P-001", "--ask-back", "Which one do you recommend?", "--studio", w.studio, "--now", NOW_ISO]);
  holds("a Patron's question back holds on the sella it asks", "builder", /^P-001: the Patron asked back; builder replies$/);
  verb(w.repo, ["answer", "--petitio", "P-001", "Take the first.", "--studio", w.studio, "--now", NOW_ISO]);
  named("the answer lifts the hold");

  file("P-30", "needs_you", "W-901");
  named("a petitio naming another opus holds nothing");
  verb(w.repo, ["petitio", "--from", "builder", "--subject", "No opus", "--studio", w.studio, "--now", NOW_ISO, "A question about no one opus."]);
  named("a petitio naming no opus holds nothing");
  put(w.studio, "petitiones/notes.txt", "not a record\n");
  named("a file that is no record is not read");

  file("P-10", "needs_you", OPUS);
  file("P-9", "awaiting_reply", OPUS, "builder");
  holds("two open petitiones are named in id order, the Patron first among actors", "patron", /^P-9: the Patron asked back; builder replies; P-10 asks the Patron; answer in the Inbox, or: bisellium answer --petitio P-10 <reply…> --studio studio$/);
  file("P-9", "resolved", OPUS);
  file("P-10", "resolved", OPUS);
  named("a resolved petitio holds nothing");

  file("P-11", "closed", OPUS);
  holds("a state no reader knows holds, on the producer", "producer", /^petitiones\/P-11\.md: state "closed" is no petitio state$/);
  file("P-11", "closed", "W-901");
  named("an unknown state on another opus is not this opus's hold");
  file("P-11", "resolved", OPUS);
  put(w.studio, "petitiones/P-12.md", `---\nid: P-1\nfrom: builder\nto: patron\nstate: needs_you\nopus: ${OPUS}\n---\nbody\n`);
  holds("an id that is not its filename holds, on the producer", "producer", /^petitiones\/P-12\.md: id "P-1" does not match its filename$/);
  put(w.studio, "petitiones/P-12.md", `---\nid: P-12\nfrom: builder\nto: patron\nstate: needs_you\nopus: ${OPUS}\nsubject: "  "\n---\nbody\n`);
  holds("a blank subject holds, on the producer", "producer", /^petitiones\/P-12\.md: subject must be a nonblank string$/);
  put(w.studio, "petitiones/P-12.md", `---\nid: P-12\nfrom: builder\nto: patron\nstate: needs_you\nopus: ${OPUS}\nsubject: 7\n---\nbody\n`);
  holds("a subject that is no string holds, on the producer", "producer", /^petitiones\/P-12\.md: subject must be a nonblank string$/);
  file("P-12", "needs_you", OPUS, "builder");
  holds("a question addressed past the Patron holds, on the producer", "producer", /^petitiones\/P-12\.md: needs_you must be addressed to the patron, not "builder"$/);
  file("P-12", "awaiting_reply", OPUS, "nobody");
  holds("an ask-back to no declared sella holds, on the producer", "producer", /^petitiones\/P-12\.md: to "nobody" is no declared sella$/);
  put(w.studio, "petitiones/P-12.md", `---\nid: P-12\nfrom: patron\nstate: awaiting_reply\nopus: ${OPUS}\n---\nbody\n`);
  holds("an ask-back to no one holds on the producer", "producer", /^P-12: the Patron asked back; producer replies$/);
  put(w.studio, "petitiones/P-12.md", `---\nid: P-1\nfrom: builder\nto: nobody\nstate: resolved\nopus: ${OPUS}\nsubject: "  "\n---\nbody\n`);
  named("a resolved record's other fields are not read");
  put(w.studio, "petitiones/P-12.md", `---\nid: P-1\nfrom: builder\nto: nobody\nstate: needs_you\nopus: W-901\n---\nbody\n`);
  named("another opus's fields are not this opus's hold");
  unlinkSync(join(w.studio, "petitiones", "P-12.md"));
  put(w.studio, "petitiones/P-11.md", "no front matter here\n");
  holds("a record with no front matter holds, on the producer", "producer", /^petitiones\/P-11\.md cannot be read: .*missing front matter$/);
  put(w.studio, "petitiones/P-11.md", "---\n- a list\n---\nbody\n");
  holds("a record that is not a map holds, on the producer", "producer", /^petitiones\/P-11\.md cannot be read: its front matter is not a map$/);
  unlinkSync(join(w.studio, "petitiones", "P-11.md"));
  mkdirSync(join(w.studio, "petitiones", "P-11.md"));
  holds("a record that is a directory holds, on the producer", "producer", /^petitiones\/P-11\.md cannot be read: .*$/);
  rmdirSync(join(w.studio, "petitiones", "P-11.md"));
  named("the hold lifts when the bad record is gone");
  renameSync(join(w.studio, "petitiones"), join(w.studio, "petitiones-real"));
  symlinkSync(join(w.studio, "petitiones-real"), join(w.studio, "petitiones"));
  holds("a symlinked petitiones directory holds, on the producer", "producer", /^petitiones\/ cannot be listed: .*$/);

  const p = world("w298-b2p", "spec");
  expectStep(next(p, [OPUS]), "branch", "named", "the perform world starts at branch");
  verb(p.repo, ["petitio", "--from", "builder", "--subject", "Before the branch", "--opus", OPUS, "--studio", p.studio, "--now", NOW_ISO, "body"]);
  const refused = next(p, [OPUS, "--perform"]);
  assert.equal(refused.first, `next: ${OPUS} branch held`, ran("--perform on a held opus performs nothing", refused));
  assert.equal(gitYesNo(p.repo, ["rev-parse", "-q", "--verify", `refs/heads/opus/${OPUS}`]), false, "--perform on a held opus makes no branch");
  verb(p.repo, ["answer", "--petitio", "P-001", "go", "--studio", p.studio, "--now", NOW_ISO]);
  const performed = next(p, [OPUS, "--perform"]);
  assert.equal(performed.first, `next: ${OPUS} branch performed`, ran("--perform runs once the petitio is answered", performed));

  const d = world("w298-b2d", "done");
  const before = next(d, [OPUS]);
  verb(d.repo, ["petitio", "--from", "builder", "--subject", "After it was done", "--opus", OPUS, "--studio", d.studio, "--now", NOW_ISO, "body"]);
  const after = next(d, [OPUS]);
  assert.deepEqual([after.first, after.status, after.kv.get("actor")], [before.first, before.status, before.kv.get("actor")], "a done opus is not held: its retro and checkpoint go on");
  put(d.studio, "petitiones/P-002.md", "no front matter here\n");
  assert.equal(next(d, [OPUS]).first, before.first, "a done opus reads no petitio at all");
});
