/**
 * W-610 (studio/briefs/W-610.md): the build review runs on the light gates, before the one full `ci --opus`. After the
 * builder's handoff `next` orders the light gates, which its perform runs and logs at the tree (b1); review is ordered on
 * that log with no full gate log (b2); after a pass, one `ci --opus` at the reviewed tree (b3); pr names reviewed tree =
 * gate tree = tip tree and bookkeeping commits keep it (b4); a source change after a pass orders the light gates and a
 * delta review again, never ci or pr (b5). Rows b1-b5 work in the next-world fixture's scratch repositories under the OS
 * temp directory; b6 (build-review.md and lex production §9 steps 3-4) reads studio/ and lives in w610-texts.test.ts, a
 * test:record file. Select one behaviour with --test-name-pattern='^W-610-b<k>\s'.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUDGET, OPUS, T, type World, advanceSource, addReview, commit, direct, editRecord, expectStep, git, next, ran, sourceTree, verb, world, writeGates, writeTranscript } from "./next-world.test.js";

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-610-b[1-9] /, "");
  test(name, { timeout: 1_800_000 }, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}
const OWN_TESTS = ["w326.test.mjs", "w462.test.mjs"];
const LIGHT_CMDS = ["node -e 0", ...OWN_TESTS.map((f) => `node --test-reporter=tap ${f}`)];
const LIGHT = LIGHT_CMDS.join(" ; ");
const lightRel = (w: World): string => `ci/${OPUS}-light-${sourceTree(w.wt).slice(5, 13)}.log`;
/** An automated world past its reds whose main manifest keeps the light-gate list and whose builder has handed over. */
function handed(tag: string): World {
  const w = world(tag, "reds", { automated: true });
  const manifest = join(w.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes:", 'light_gates:\n  - "node -e 0"\nsource_excludes:'));
  commit(w.repo, "studio: the light-gate list");
  // the fixture brief's own test files (Files owned), each a passing test file, committed as the builder's
  for (const f of OWN_TESTS) writeFileSync(join(w.wt, f), 'import { test } from "node:test";\ntest("own", () => {});\n');
  commit(w.wt, `test(${OPUS}): its own test files`);
  builderHandoff(w, T.handoffFresh);
  return w;
}
/** Replaces the main checkout's light_gates entry (a YAML scalar) and commits it on master. */
function setLightGates(w: World, from: string, to: string): void {
  const manifest = join(w.studio, "bisellium.yml");
  const text = readFileSync(manifest, "utf8");
  assert.ok(text.includes(`light_gates:\n  - ${from}\n`), `the main manifest keeps light_gates ${from}`);
  writeFileSync(manifest, text.replace(`light_gates:\n  - ${from}\n`, `light_gates:\n  - ${to}\n`));
  commit(w.repo, "studio: the light-gate list changes");
}
/** Edits a worktree file under studio/ (`rel`) with `edit` and commits it on the branch. */
function editWt(w: World, rel: string, edit: (text: string) => string): void {
  const path = join(w.wtStudio, rel);
  writeFileSync(path, edit(readFileSync(path, "utf8")));
  commit(w.wt, `studio(${OPUS}): edit ${rel}`);
}
function builderHandoff(w: World, at: string): void {
  verb(w.wt, ["handoff", "--opus", OPUS, "--sella", `builder.${OPUS}`, "--next", "ready for review", "--studio", w.wtStudio, "--now", at]);
  commit(w.wt, `studio(${OPUS}): builder handoff ${at}`);
}
const performLight = (w: World): ReturnType<typeof next> => next(w, [OPUS, "--perform", "--expect", "build", ...BUDGET]);
/** handed, the light gates performed, review round 1 passed with the sec gate, at one tree. */
function passed(tag: string): World {
  const w = handed(tag);
  const p = performLight(w);
  assert.equal(p.status, 0, ran("the light-gates perform exits 0", p));
  addReview(w, "passed", 1, T.review1);
  editRecord(w, "wt", (doc) => doc.setIn(["probationes", "sec"], { status: "passed", sella: "qa-lead", evidence: `ci/${OPUS}-review-1.log`, at: T.review1 }));
  commit(w.wt, `studio(${OPUS}): sec gate`);
  return w;
}

row("W-610-b1 after the builder's handoff next orders the light gates and its perform logs them at the tree", async () => {
  const w = handed("w610-b1");
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "build", "named", "the light gates are a build step");
  assert.equal(o.kv.get("actor"), "producer", ran("a ladder-runner runs them, never the builder", o));
  assert.equal(o.kv.get("light-gates"), LIGHT, ran("the order names the kept list and the brief's own test files", o));
  assert.match(o.kv.get("command") ?? "", new RegExp(`bisellium next ${OPUS} --perform --expect build`), ran("the perform runs them", o));
  const p = performLight(w);
  assert.equal(p.status, 0, ran("the perform exits 0", p));
  const rel = lightRel(w);
  assert.equal(git(w.wt, ["ls-files", "--", `studio/${rel}`]), `studio/${rel}`, ran("the log is committed at the tree", p));
  const text = readFileSync(join(w.wtStudio, rel), "utf8").split("\n");
  const { commandDigest, commandLine } = await import("@bisellium/shim");
  assert.deepEqual(text.slice(0, 3), [`certifies: ${sourceTree(w.wt)}`, commandLine(LIGHT_CMDS), "exit code: 0"], "the log opens as a gate log does, line 2 binding the exact commands");
  // the binding is the shared helper's: injective over the list (a boundary inside a command differs), one line for a multiline command
  assert.match(commandLine(LIGHT_CMDS), /^command: sha256:[0-9a-f]{64}$/, "line 2 is the command digest");
  assert.notEqual(commandDigest(["a ; b"]), commandDigest(["a", "b"]), "a list boundary is part of the binding");
  assert.notEqual(commandDigest(["a", "b"]), commandDigest(["b", "a"]), "the order is part of the binding");
  // a multiline light gate keeps `exit code:` on line 3; the changed list voids the old log, so the light gates are ordered again
  setLightGates(w, '"node -e 0"', '"node -e 0 &&\\n  node -e 0"');
  const again = next(w, [OPUS, ...BUDGET]);
  expectStep(again, "build", "named", "a changed light_gates list orders the light gates again");
  assert.equal(again.kv.has("light-gates"), true, ran("the light gates, not review", again));
  const multi = ["node -e 0 &&\n  node -e 0", ...LIGHT_CMDS.slice(1)];
  const p2 = performLight(w);
  assert.equal(p2.status, 0, ran("the multiline perform exits 0", p2));
  assert.deepEqual(readFileSync(join(w.wtStudio, rel), "utf8").split("\n").slice(0, 3), [`certifies: ${sourceTree(w.wt)}`, commandLine(multi), "exit code: 0"], "a multiline command keeps exit code: on line 3");
  // every write boundary refuses: a symlinked ci/ (ensureRealDirectory), a failed git add, a failed git commit
  const { runLightGates } = await import("@bisellium/commands/light-gates.js");
  const outside = mkdtempSync(join(tmpdir(), "w610-outside-"));
  renameSync(join(w.wtStudio, "ci"), join(w.wtStudio, "ci.real"));
  symlinkSync(outside, join(w.wtStudio, "ci"));
  const linked = runLightGates(w.wtStudio, OPUS, ["node -e 0"]);
  rmSync(join(w.wtStudio, "ci"));
  renameSync(join(w.wtStudio, "ci.real"), join(w.wtStudio, "ci"));
  assert.ok("error" in linked, "a symlinked ci/ refuses the log write");
  assert.deepEqual(readdirSync(outside), [], "nothing is written through the symlink");
  setLightGates(w, '"node -e 0 &&\\n  node -e 0"', '"node -e 0"');
  const lock = git(w.wt, ["rev-parse", "--path-format=absolute", "--git-path", "index.lock"]);
  writeFileSync(lock, "");
  const addFailed = performLight(w);
  rmSync(lock);
  assert.notEqual(addFailed.status, 0, ran("a failed git add refuses the perform", addFailed));
  assert.match(addFailed.out, /could not commit/, ran("the perform names the failed add", addFailed));
  const hooks = join(w.root, "w610-hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  git(w.wt, ["config", "core.hooksPath", hooks]);
  const commitFailed = performLight(w);
  git(w.wt, ["config", "--unset", "core.hooksPath"]);
  assert.notEqual(commitFailed.status, 0, ran("a failed git commit refuses the perform", commitFailed));
  assert.match(commitFailed.out, /could not commit/, ran("the perform names the failed commit", commitFailed));
  assert.equal(existsSync(lock), false, "the fixture's lock is gone");
  // ruled case: a Files owned test path that is not a plain repo-relative path never reaches the shell
  const { lightGateCommands } = await import("@bisellium/commands/light-gates.js");
  const brief = (p: string): string => `## Files owned\n\n- \`${p}\`\n`;
  for (const bad of ["x.test.ts; touch pwned.test.ts", "$(id).test.ts", "../up.test.ts", "/abs.test.ts", "a b.test.ts"])
    assert.ok("error" in lightGateCommands({ light_gates: ["node -e 0"] }, "studio", brief(bad)), `an unsafe test path is refused: ${bad}`);
  assert.deepEqual(lightGateCommands({ light_gates: ["x {studio}"] }, "studio", brief("packages/a/b.test.ts")), ["x studio", "node --test-reporter=tap --import tsx packages/a/b.test.ts"], "a plain path runs");
});

