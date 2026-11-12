/**
 * W-512 rows (studio/briefs/W-512.md): `next` refuses to start an opus out of its queue order. node:test TAP, selected
 * by `--test-name-pattern='^W-512-b<n>\s'`. Every fixture is a next-world fixture (a repository under the OS tmp dir, a
 * stub gh, a temp HOME); no row reads `studio/` or the host HOME.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
