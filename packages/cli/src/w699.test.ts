/**
 * W-699 rows (studio/briefs/W-699.md, D-245): the path check at sign (b1), the contract digests a re-signature is read by
 * (b2), `verdict --check` (b3), the 200k handoff at the prompt hook (b4), gate evidence after the newest red (b5) and
 * the D-246 measure in `retro --daily` (b6). node:test TAP, selected by `--test-name-pattern='^W-699-b<n>\s'`. The worlds
 * are next-world's (./next-world.test.ts) and, for b6, a temp officina, under the OS tmp dir.
 */
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BRIEF_REL, NO_FINDINGS, OPUS, T, briefText, direct, put, ran, specLog, world, type World } from "./next-world.test.js";

/** A fixture brief whose Files owned bullets are `owned`, every other section as briefText's. */
const withOwned = (owned: string[]): string => briefText(1).replace(/## Files owned\n\n(?:- .*\n)+/, `## Files owned\n\n${owned.map((o) => `- ${o}`).join("\n")}\n`);
/** The architect's signature, round n, through the real writer, run directly: its result is data. */
const signDirect = (w: World, n: number, extra: string[] = []) => {
  const from = join(w.root, `w699-sign-${n}.md`);
  writeFileSync(from, NO_FINDINGS);
  return direct(w, w.repo, ["verdict", OPUS, "--round", String(n), "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", from, "--studio", w.studio, "--now", T.spec, ...extra]);
};
const logExists = (w: World, n: number): boolean => existsSync(join(w.repo, specLog(n)));

test("W-699-b1 behaviour 1: a signature refuses a Files owned path that is not an existing file, an existing directory ending /, or marked (new)", { timeout: 600_000 }, () => {
  const refused: [string, string, RegExp][] = [
    ["a missing file", "`missing.txt`", /owns `missing\.txt`, which is not an existing file of the repository/],
    ["a missing directory", "`nowhere/`", /owns `nowhere\/`, which is not an existing directory of the repository/],
    ["a file named as a directory", "`source.txt/`", /owns `source\.txt\/`, which is not an existing directory/],
    ["a directory named as a file", "`docs`", /owns `docs`, which is not an existing file/],
    ["a path out of the repository", "`../outside.txt` (new)", /owns `\.\.\/outside\.txt`, which is not a repo-relative path/],
    ["an absolute path", "`/etc/hosts`", /owns `\/etc\/hosts`, which is not a repo-relative path/],
    ["a bullet with no path", "the rest of the tree", /is a Files owned bullet with no path/],
  ];
  for (const [name, bullet, why] of refused) {
    const w = world(`w699-b1-${name.replace(/\W+/g, "-")}`, "greenlight");
    put(w.repo, BRIEF_REL, withOwned(["`source.txt`", bullet]));
    const r = signDirect(w, 1);
    assert.equal(r.status, 2, ran(`${name}: the signature is refused`, r));
    assert.match(r.err, /W-900: brief admission: brief:\d+ /, ran(`${name}: the refusal is admission's`, r));
    assert.match(r.err, why, ran(`${name}: the refusal names the path`, r));
    assert.equal(logExists(w, 1), false, `${name}: no signature log is written`);
  }
  const w = world("w699-b1-admitted", "greenlight");
  put(w.repo, BRIEF_REL, withOwned(["`source.txt`: an existing file", "`./docs/`: an existing directory", "`packages/new.ts` (new): a new file", "`w699 two words.test.ts` (new, a test file)"]));
  const ok = signDirect(w, 1);
  assert.equal(ok.status, 0, ran("an existing file, an existing directory and two (new) paths are admitted", ok));
  assert.equal(logExists(w, 1), true, "the signature log is written");
});
