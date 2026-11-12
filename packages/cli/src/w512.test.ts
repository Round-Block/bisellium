/**
 * W-512 rows (studio/briefs/W-512.md): `next` refuses to start an opus out of its queue order. node:test TAP, selected
 * by `--test-name-pattern='^W-512-b<n>\s'`. Every fixture is a next-world fixture (a repository under the OS tmp dir, a
 * stub gh, a temp HOME); no row reads `studio/` or the host HOME.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BUDGET, OPUS, type World, commit, next, put, ran, world } from "./next-world.test.js";

const rec = (id: string, state: string): string => `---\nid: "${id}"\ntitle: "queued ${id}"\nkind: "feature"\ncollegium: "engineering"\nstate: ${state}\nprobationes: {}\n---\nqueued\n`;
/** A queue.yml with one engineering queue: `lanes` (`E1: W-901` form) and the ranked entries (`W-901!` marks next_ts), committed unless `dirty`. */
function queue(w: World, lanes: string, ranked: string[], o: { dirty?: boolean } = {}): void {
  const entry = (x: string): string => (x.endsWith("!") ? `      - { opus: ${x.slice(0, -1)}, says: "ranked", next_ts: true }\n` : `      - { opus: ${x}, says: "ranked" }\n`);
  put(w.studio, "queue.yml", `queues:\n  engineering:\n    lanes: { ${lanes} }\n    next:\n${ranked.map(entry).join("")}halted: []\ncut: []\ndeferred: []\n`);
  if (o.dirty !== true) commit(w.repo, "studio: W-512 queue");
}
function records(w: World, states: Record<string, string>): void {
  for (const [id, state] of Object.entries(states)) put(w.studio, `opera/${id}.md`, rec(id, state));
  commit(w.repo, "studio: W-512 records");
}

test("W-512-b1 behaviour 1: branch is named only for a lane's opus; the spec ahead holds at branch and names the way past", () => {
  const w = world("w512-b1a", "spec");
  records(w, { "W-901": "greenlit", "W-902": "greenlit" });
  queue(w, "E1: W-901", ["W-901", OPUS, "W-902"]);
  const held = next(w, [OPUS, ...BUDGET]);
  assert.equal(held.first, `next: ${OPUS} branch held`, ran("a signed spec ranked behind the lane's opus holds at branch", held));
  assert.equal(held.kv.get("why"), `${OPUS} is #2 in queue engineering, the spec ahead of lane E1: its spec may be signed, and it branches when the lane takes it: E1 holds W-901 (greenlit), ahead ${OPUS} (#2); to start it now, rank it higher in queue.yml and land that edit`, ran("the spec ahead names its rank, the lane and the one way past, and holds at branch", held));
  assert.notEqual(held.status, 0, ran("a held start exits non-zero", held));
  records(w, { "W-901": "done" });
  const take = next(w, [OPUS, ...BUDGET]);
  assert.equal(take.first, `next: ${OPUS} branch named`, ran("once the lane's opus is done the lane takes the next entry, and branch is named", take));
});

test("W-512-b1 behaviour 1: an idle lane takes the highest entry, and a lower one holds at branch", () => {
  const w = world("w512-b1b", "spec");
  records(w, { "W-902": "greenlit" });
  queue(w, "E1: ~", ["W-902", OPUS]);
  const behind = next(w, [OPUS, ...BUDGET]);
  assert.equal(behind.first, `next: ${OPUS} branch held`, ran("an idle lane takes the highest entry, not this one", behind));
  assert.equal(behind.kv.get("why"), `${OPUS} is #2 in queue engineering, the spec ahead of lane E1: its spec may be signed, and it branches when the lane takes it: E1 takes W-902 (#1), ahead ${OPUS} (#2); to start it now, rank it higher in queue.yml and land that edit`, ran("the why names the lane's take", behind));
  queue(w, "E1: ~", [OPUS, "W-902"]);
  assert.equal(next(w, [OPUS, ...BUDGET]).first, `next: ${OPUS} branch named`, "a landed re-rank is the way past: the first entry starts");
});

test("W-512-b1 behaviour 1: an entry skipped for another lane's next.ts opus keeps its place and is taken before the entries below it", () => {
  const w = world("w512-b1c", "spec");
  records(w, { "W-901": "building", "W-902": "greenlit", "W-903": "greenlit" });
  queue(w, "E1: W-901, E2: ~", ["W-901!", `${OPUS}!`, "W-902", "W-903"]);
  const skipped = next(w, [OPUS, ...BUDGET]);
  assert.equal(skipped.first, `next: ${OPUS} branch held`, ran("E2 skips the next.ts entry while E1 holds a next.ts opus, so it does not branch", skipped));
  assert.equal(skipped.kv.get("why"), `${OPUS} is #2 in queue engineering, the spec ahead of lane E1: its spec may be signed, and it branches when the lane takes it: E1 holds W-901 (building), ahead ${OPUS} (#2); E2 takes W-902 (#3), ahead W-903 (#4); to start it now, rank it higher in queue.yml and land that edit`, ran("the skipped entry is still E1's spec ahead, above W-903", skipped));
  const before = readFileSync(join(w.studio, "queue.yml"), "utf8");
  records(w, { "W-901": "done" });
  const kept = next(w, [OPUS, ...BUDGET]);
  assert.equal(kept.first, `next: ${OPUS} branch named`, ran("the skipped entry keeps its place: E1 takes it, not W-903", kept));
  assert.equal(readFileSync(join(w.studio, "queue.yml"), "utf8"), before, "nothing reorders or writes queue.yml");
});

test("W-512-b1 behaviour 1: the order fails closed: an unranked opus, an uncommitted queue.yml edit and a malformed queue.yml hold the start", () => {
  const w = world("w512-b1d", "spec");
  records(w, { "W-902": "greenlit" });
  queue(w, "E1: ~", ["W-902"]);
  const unranked = next(w, [OPUS, ...BUDGET]);
  assert.equal(unranked.first, `next: ${OPUS} branch held`, ran("an unranked opus holds", unranked));
  assert.equal(unranked.kv.get("why"), `${OPUS} is not ranked in queue.yml: rank it in a queue's next and land that edit before it starts`, ran("the why names the way in", unranked));
  queue(w, "E1: ~", [OPUS, "W-902"], { dirty: true });
  const dirty = next(w, [OPUS, ...BUDGET]);
  assert.equal(dirty.first, `next: ${OPUS} branch held`, ran("an uncommitted queue.yml edit holds every start", dirty));
  assert.equal(dirty.kv.get("why"), "studio/queue.yml has an edit that is not committed; a start obeys the landed order: land it first", ran("the why names the edit", dirty));
  commit(w.repo, "studio: W-512 queue");
  assert.equal(next(w, [OPUS, ...BUDGET]).first, `next: ${OPUS} branch named`, "the committed edit is the order: the first entry starts");
  put(w.studio, "queue.yml", "queues: [not, a, mapping]\n");
  commit(w.repo, "studio: a malformed queue");
  const bad = next(w, [OPUS, ...BUDGET]);
  assert.equal(bad.first, `next: ${OPUS} branch held`, ran("a malformed queue.yml holds the start, never fails open", bad));
  // one-sided: the rest is readQueue's own problem text, pinned by W-333's and W-558's rows
  assert.match(bad.kv.get("why") ?? "", /^no start is ordered while queue\.yml is malformed: /, ran("the why names the queue's problem", bad));
});

test("W-512-b2 behaviour 2: the spec rung starts only for a lane's opus or the one entry ahead of it, never two ahead", () => {
  const w = world("w512-b2", "greenlight");
  records(w, { "W-901": "greenlit", "W-902": "greenlit" });
  queue(w, "E1: W-901", ["W-901", "W-902", OPUS]);
  const two = next(w, [OPUS, ...BUDGET]);
  assert.equal(two.first, `next: ${OPUS} spec held`, ran("two entries behind the lane's opus, no spec is ordered", two));
  assert.equal(two.kv.get("why"), `${OPUS} is #3 in queue engineering and no lane takes it: E1 holds W-901 (greenlit), ahead W-902 (#2); to start it now, rank it higher in queue.yml and land that edit`, ran("the why names the lane's opus and its spec ahead", two));
  assert.equal(two.kv.get("role"), undefined, ran("and no architect is dispatched", two));
  queue(w, "E1: W-901", ["W-901", OPUS, "W-902"]);
  const ahead = next(w, [OPUS, ...BUDGET]);
  assert.equal(ahead.first, `next: ${OPUS} spec named`, ran("the one entry ahead of the lane's opus may take its spec", ahead));
  assert.equal(ahead.kv.get("role"), "architect", ran("the architect is ordered", ahead));
  records(w, { "W-901": "halted" });
  queue(w, "E1: W-901", ["W-901", "W-902", OPUS]);
  const after = next(w, [OPUS, ...BUDGET]);
  assert.equal(after.first, `next: ${OPUS} spec named`, ran("with the lane's opus halted, the lane takes W-902 and this entry is its spec ahead", after));
});

/** W-901's brief, owning `spans`, committed on master and pointed at by opus/W-901 (or, with `spans` undefined, no brief on it). */
function inFlight(w: World, spans: string[] | undefined): void {
  if (spans === undefined) rmSync(join(w.studio, "briefs", "W-901.md"), { force: true });
  else put(w.studio, "briefs/W-901.md", `# W-901\n\n## Files owned\n\n${spans.map((x) => `- \`${x}\`\n`).join("")}\n## Interfaces\n\nNone.\n`);
  commit(w.repo, "studio: W-901 brief");
  const r = spawnSync("git", ["branch", "-f", "opus/W-901"], { cwd: w.repo, encoding: "utf8" });
  assert.equal(r.status, 0, `git branch opus/W-901\n${r.stderr}`);
}

test("W-512-b3 behaviour 3: branch holds while its Files owned overlap with an opus in flight in another lane, naming both and the paths", () => {
  const w = world("w512-b3a", "spec");
  records(w, { "W-901": "building" });
  queue(w, "E1: W-901, E2: ~", ["W-901", OPUS]);
  inFlight(w, ["docs/", "other.txt"]);
  const held = next(w, [OPUS, ...BUDGET]);
  assert.equal(held.first, `next: ${OPUS} branch held`, ran("E2's take overlaps W-901, in flight in E1, so it does not branch", held));
  assert.equal(held.kv.get("why"), `${OPUS}'s Files owned overlap with an opus in flight: W-901 in lane E1: \`docs/ADOPTION.md\`; it branches when that opus is done or halted, or when a lead ranks an entry that does not overlap above it and lands that edit (D-192, W-592)`, ran("the why names both opera, the lane and the overlapping path (a folder span meets a file in it)", held));
  records(w, { "W-901": "done" });
  assert.equal(next(w, [OPUS, ...BUDGET]).first, `next: ${OPUS} branch named`, "once W-901 is done, the lane's opus branches");
});

test("W-512-b3 behaviour 3: only an opus with an opus branch is in flight; its brief is read fail closed; no shared path branches", () => {
  const w = world("w512-b3b", "spec");
  records(w, { "W-901": "greenlit" });
  queue(w, "E1: W-901, E2: ~", ["W-901", OPUS]);
  assert.equal(next(w, [OPUS, ...BUDGET]).first, `next: ${OPUS} branch named`, "W-901 has no opus branch: not yet in flight, so nothing is read (it is checked when it branches)");
  inFlight(w, undefined);
  const blind = next(w, [OPUS, ...BUDGET]);
  assert.equal(blind.first, `next: ${OPUS} branch held`, ran("opus/W-901 holds no brief: the overlap cannot be read, so the branch holds", blind));
  assert.equal(blind.kv.get("why"), `briefs/W-901.md is not a readable blob on refs/heads/opus/W-901, so its Files owned cannot be checked against ${OPUS}'s (W-592)`, ran("the why names the unreadable brief", blind));
  inFlight(w, ["other.txt"]);
  assert.equal(next(w, [OPUS, ...BUDGET]).first, `next: ${OPUS} branch named`, "no shared path: the lane's opus branches beside W-901");
});

test("W-512-b3 behaviour 3: an opus is in flight by its opus branch, whatever queue.yml's lane field says", () => {
  const w = world("w512-b3c", "spec");
  records(w, { "W-901": "greenlit" });
  queue(w, "E1: ~, E2: ~", ["W-901", OPUS]);
  inFlight(w, ["docs/"]);
  const taken = next(w, [OPUS, ...BUDGET]);
  assert.equal(taken.first, `next: ${OPUS} branch held`, ran("E1 takes W-901, branched while its lane is still ~: E2's take does not branch", taken));
  assert.equal(taken.kv.get("why"), `${OPUS}'s Files owned overlap with an opus in flight: W-901 in lane E1: \`docs/ADOPTION.md\`; it branches when that opus is done or halted, or when a lead ranks an entry that does not overlap above it and lands that edit (D-192, W-592)`, ran("the why names E1, the lane that takes W-901", taken));
  queue(w, "E1: ~", [OPUS, "W-901"]);
  const unnamed = next(w, [OPUS, ...BUDGET]);
  assert.equal(unnamed.first, `next: ${OPUS} branch held`, ran("W-901, in flight but ranked below E1's take, is no lane's now and is still read", unnamed));
  assert.equal(unnamed.kv.get("why"), `${OPUS}'s Files owned overlap with an opus in flight: W-901 in no lane: \`docs/ADOPTION.md\`; it branches when that opus is done or halted, or when a lead ranks an entry that does not overlap above it and lands that edit (D-192, W-592)`, ran("the why says W-901 is in no lane", unnamed));
});
