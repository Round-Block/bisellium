/**
 * W-512 rows (studio/briefs/W-512.md): `next` refuses to start an opus out of its queue order. node:test TAP, selected
 * by `--test-name-pattern='^W-512-b<n>\s'`. Every fixture is a next-world fixture (a repository under the OS tmp dir, a
 * stub gh, a temp HOME); no row reads `studio/` or the host HOME.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { aheadIn } from "./meanwhile.js";
import { lanePlan, startOrder } from "./queue.js";
import { BUDGET, MAIN, OPUS, SETUP_ENV, TSX, type World, commit, next, put, ran, world } from "./next-world.test.js";

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

test("W-512-b4 behaviour 4: next --all prints an order hold as queued and does not fail the run on it", () => {
  const w = world("w512-b4", "greenlight");
  records(w, { "W-901": "greenlit", "W-902": "greenlit" });
  queue(w, "E1: W-901", ["W-901", "W-902", OPUS]);
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "next", "--all", "--studio", w.studio, "--repo", w.repo], { cwd: w.repo, encoding: "utf8", timeout: 300_000, env: { ...process.env, BISELLIUM_SELLA: "", HOME: w.home } });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith(`next: ${OPUS} `)) ?? "";
  assert.equal(line, `next: ${OPUS} spec queued · actor: producer · why: ${OPUS} is #3 in queue engineering and no lane takes it: E1 holds W-901 (greenlit), ahead W-902 (#2); to start it now, rank it higher in queue.yml and land that edit · traditio: none`, `the out-of-order opus is queued, not held\n${r.stdout}${r.stderr}`);
  assert.equal((r.stdout ?? "").split("\n").find((l) => l.startsWith("next: W-902 ")), "next: W-902 spec named · actor: architect · why: briefs/W-902.md is missing or lacks the six design-lex sections · traditio: none", `the spec ahead is still named\n${r.stdout}`);
  assert.equal(r.status, 0, `an order hold alone does not fail next --all\n${r.stdout}${r.stderr}`);
});

/** The fix-round rows (build review round 1, S1): a lane's take is decided in rank order and stops at the target, so a lower entry's bad state never refuses a higher take. W-901 below has a record whose state is outside the lifecycle (queuedState throws; the queue still loads). */
const ALL_LINE = (w: World): { out: string; line: string } => {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "next", "--all", "--studio", w.studio, "--repo", w.repo], { cwd: w.repo, encoding: "utf8", timeout: 300_000, env: { ...process.env, BISELLIUM_SELLA: "", HOME: w.home } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { out, line: (r.stdout ?? "").split("\n").find((l) => l.startsWith(`next: ${OPUS} `)) ?? "" };
};

test("W-512-b1 fix round: two idle lanes, the first take is named in next, in --perform and in next --all while a lower entry has an invalid state", () => {
  const w = world("w512-fix-take", "spec");
  records(w, { "W-901": "sideways" });
  queue(w, "E1: ~, E2: ~", [OPUS, "W-901"]);
  const direct = next(w, [OPUS, ...BUDGET]);
  assert.equal(direct.first, `next: ${OPUS} branch named`, ran("E1 takes this entry; E2's read of the unreadable W-901 never refuses it", direct));
  const performed = next(w, [OPUS, "--perform", ...BUDGET]);
  assert.equal(performed.first, `next: ${OPUS} branch performed`, ran("--perform decides the take the same way", performed));
  const all = ALL_LINE(w);
  assert.match(all.line, new RegExp(`^next: ${OPUS} \\w+ named .*$`), `next --all names a step for the first take (the branch is already performed), never a refusal for W-901's record\n${all.out}`);
});

test("W-512-b1 fix round: lanePlan reads a lane's ahead only up to the target's lane, so a later lane's unreadable entry never refuses the spec ahead", () => {
  const w = world("w512-fix-plan", "greenlight");
  records(w, { "W-902": "greenlit", "W-903": "greenlit", "W-904": "sideways" });
  queue(w, "E1: ~, E2: ~", ["W-902", "W-903", OPUS, "W-904"]);
  const ahead = next(w, [OPUS, ...BUDGET]);
  assert.equal(ahead.first, `next: ${OPUS} spec named`, ran("this entry is E1's spec ahead; E2's walk past it reaches W-904 only after the target", ahead));
  assert.equal(ahead.kv.get("role"), "architect", ran("the architect is ordered", ahead));
  const file = { queues: [{ id: "e", lanes: [["E1", undefined], ["E2", undefined]] as [string, string | undefined][], next: ["W-902", "W-903", OPUS, "W-904"].map((opus) => ({ opus, says: "", folded: [], nextTs: false })) }], halted: [], cut: [], deferred: [] };
  const stateOf = (o: string): string => { if (o === "W-904") throw new Error("the queued record opera/W-904.md cannot be read (ENOENT)"); return "greenlit"; };
  assert.equal(startOrder({ kind: "ok", file }, OPUS, stateOf).kind, "ahead", "startOrder: the spec ahead is decided before E2's walk reaches W-904");
  const bad = startOrder({ kind: "ok", file }, "W-904", stateOf);
  assert.equal(bad.kind === "refused" ? bad.why : "", "the queue order cannot be read: the queued record opera/W-904.md cannot be read (ENOENT)", "the unreadable entry itself still refuses, loudly (fail closed)");
});

test("W-512-b1 fix round: the lane lines and the spec ahead (aheadOf) never read past what they name", () => {
  const w = world("w512-fix-lines", "spec");
  records(w, { "W-901": "sideways" });
  queue(w, "E1: ~, E2: ~", [OPUS, "W-901"]);
  const all = ALL_LINE(w);
  assert.match(all.out, /lane: engineering E1 · idle · takes /, `the lane lines name E1's take with W-901's state invalid\n${all.out}`);
  assert.match(all.out, /lane: engineering E2 · idle · nothing to take · skipped W-900 \(#1\): taken by E1, W-901 \(#2\): sideways/, `E2's line names the entry with an invalid state, never a failure\n${all.out}`);
  const file = { queues: [{ id: "e", lanes: [["E1", "W-1"]] as [string, string | undefined][], next: ["W-1", "W-2", "W-3"].map((opus) => ({ opus, says: "", folded: [], nextTs: false })) }], halted: [], cut: [], deferred: [] };
  const read: string[] = [];
  const found = aheadIn({ kind: "ok" as const, file }, "W-1", (o) => { read.push(o); if (o === "W-3") throw new Error("the queued record opera/W-3.md cannot be read (ENOENT)"); return "greenlit"; }, () => ({ step: "spec", status: "named", actor: "architect", why: "", extra: [], order: { role: "architect" } }) as never);
  assert.deepEqual(found, { ahead: { opus: "W-2", spec: "draft" } }, "the spec ahead is the first takeable entry; a lower entry's state is never needed");
  assert.equal(read.includes("W-3"), false, "W-3's state is not read once W-2 is the ahead");
});

/** The lane-walk rows (build review round 2, Lane walk): a read before the start is decided refuses it; a read after it drops that one lane, which keeps its slot. */
const entries = (ids: string[]) => ids.map((opus) => ({ opus, says: "", folded: [], nextTs: false }));
const BAD = "W-904";
const unreadable = (o: string): string => { if (o === BAD) throw new Error("the queued record opera/W-904.md cannot be read (ENOENT)"); return "greenlit"; };
const CANNOT = "the queue order cannot be read: the queued record opera/W-904.md cannot be read (ENOENT)";

test("W-512-b1 lane walk: a lane field's own unreadable opus refuses every start", () => {
  const file = { queues: [{ id: "e", lanes: [["E1", BAD], ["E2", undefined]] as [string, string | undefined][], next: entries([OPUS, "W-902"]) }], halted: [], cut: [], deferred: [] };
  for (const id of [OPUS, "W-902"]) {
    const r = startOrder({ kind: "ok", file }, id, unreadable);
    assert.equal(r.kind === "refused" ? r.why : r.kind, CANNOT, `${id}: a lane's own unreadable opus refuses every start`);
  }
});

test("W-512-b1 lane walk: an unreadable entry above the target refuses it", () => {
  const file = { queues: [{ id: "e", lanes: [["E1", undefined]] as [string, string | undefined][], next: entries([BAD, OPUS]) }], halted: [], cut: [], deferred: [] };
  const r = startOrder({ kind: "ok", file }, OPUS, unreadable);
  assert.equal(r.kind === "refused" ? r.why : r.kind, CANNOT, "the entry above the target is read before the target is decided");
});

test("W-512-b1 lane walk: an unreadable entry in an earlier queue's lane refuses it", () => {
  const file = { queues: [{ id: "u", lanes: [["UI1", undefined]] as [string, string | undefined][], next: entries([BAD]) }, { id: "e", lanes: [["E1", undefined]] as [string, string | undefined][], next: entries([OPUS]) }], halted: [], cut: [], deferred: [] };
  const r = startOrder({ kind: "ok", file }, OPUS, unreadable);
  assert.equal(r.kind === "refused" ? r.why : r.kind, CANNOT, "a lane walked before the target's lane is read before the target is decided");
});

test("W-512-b1 lane walk: a lane dropped on the ahead pass names no ahead, and no other lane's moves into it", () => {
  const file = { queues: [{ id: "e", lanes: [["E1", undefined], ["E2", undefined]] as [string, string | undefined][], next: entries(["W-910", "W-911", OPUS, BAD]) }, { id: "u", lanes: [["UI1", undefined]] as [string, string | undefined][], next: entries(["W-920", "W-921"]) }], halted: [], cut: [], deferred: [] };
  const r = startOrder({ kind: "ok", file }, OPUS, unreadable);
  assert.equal(r.kind, "ahead", "the target is E1's ahead, decided before E2's ahead pass reads the unreadable entry");
  assert.match(r.kind === "ahead" ? r.why : "", new RegExp(`: E1 takes W-910 \\(#1\\), ahead ${OPUS} \\(#3\\); E2 takes W-911 \\(#2\\); to start it now`), "the why names E2 with no ahead");
  const plan = lanePlan(file, unreadable, OPUS);
  assert.deepEqual(plan.map((p) => [p.lane, p.ahead?.opus]), [["E1", OPUS], ["E2", undefined], ["UI1", "W-921"]], "UI1 keeps its own ahead: the dropped lane keeps its slot");
});

test("W-512-b3 lane walk: a lane dropped after the target is decided drops only itself: E3 is still named", () => {
  const w = world("w512-b3d", "spec");
  records(w, { "W-902": "building", [BAD]: "sideways" });
  queue(w, "E1: ~, E2: ~, E3: W-902", [OPUS, BAD, "W-902"]);
  put(w.studio, "briefs/W-902.md", `# W-902\n\n## Files owned\n\n- \`docs/\`\n\n## Interfaces\n\nNone.\n`);
  commit(w.repo, "studio: W-902 brief");
  const b = spawnSync("git", ["branch", "-f", "opus/W-902"], { cwd: w.repo, encoding: "utf8" });
  assert.equal(b.status, 0, `git branch opus/W-902\n${b.stderr}`);
  const held = next(w, [OPUS, ...BUDGET]);
  assert.equal(held.first, `next: ${OPUS} branch held`, ran("E1 takes the target; E2's walk reaches the unreadable entry, and E3's opus in flight still holds it", held));
  assert.equal(held.kv.get("why"), `${OPUS}'s Files owned overlap with an opus in flight: W-902 in lane E3: \`docs/ADOPTION.md\`; it branches when that opus is done or halted, or when a lead ranks an entry that does not overlap above it and lands that edit (D-192, W-592)`, ran("the why names W-902 in lane E3", held));
});

/** W-633: commit `text` as opera/W-901.md on opus/W-901 alone (undefined: remove it there), as `halt` and `lift` write the branch's record (D-021); master and the main checkout are untouched. */
function onBranch(w: World, text: string | undefined): void {
  const env = { ...SETUP_ENV, GIT_INDEX_FILE: join(w.root, "w633.index") };
  const g = (args: string[], input?: string): string => {
    const r = spawnSync("git", args, { cwd: w.repo, env, encoding: "utf8", ...(input === undefined ? {} : { input }) });
    assert.equal(r.status, 0, `fixture git ${args.join(" ")}\n${r.stderr}`);
    return r.stdout.trim();
  };
  const path = `${relative(w.repo, w.studio)}/opera/W-901.md`;
  g(["read-tree", "opus/W-901"]);
  if (text === undefined) g(["update-index", "--force-remove", "--", path]);
  else g(["update-index", "--add", "--cacheinfo", `100644,${g(["hash-object", "-w", "--stdin"], text)},${path}`]);
  const tree = g(["write-tree"]);
  g(["update-ref", "refs/heads/opus/W-901", g(["commit-tree", tree, "-p", "opus/W-901", "-m", "studio: W-901's record on its branch"])]);
}

test("W-633-b1 behaviour 1: an opus halted on its branch releases its files; its branch record is read fail closed", () => {
  const w = world("w633-b1", "spec");
  records(w, { "W-901": "building" });
  queue(w, "E1: W-901, E2: ~", ["W-901", OPUS]);
  inFlight(w, ["docs/"]);
  const overlap = `${OPUS}'s Files owned overlap with an opus in flight: W-901 in lane E1: \`docs/ADOPTION.md\`; it branches when that opus is done or halted, or when a lead ranks an entry that does not overlap above it and lands that edit (D-192, W-592)`;
  onBranch(w, rec("W-901", "halted"));
  const released = next(w, [OPUS, ...BUDGET]);
  assert.equal(released.first, `next: ${OPUS} branch named`, ran("halted on its branch alone (master's record still building): W-901 releases its files", released));
  onBranch(w, rec("W-901", "building"));
  const lifted = next(w, [OPUS, ...BUDGET]);
  assert.equal(lifted.first, `next: ${OPUS} branch held`, ran("lifted on its branch: W-901 holds its files again", lifted));
  assert.equal(lifted.kv.get("why"), overlap, ran("lifted: the why names the overlap", lifted));
  onBranch(w, "no front matter\n");
  const malformed = next(w, [OPUS, ...BUDGET]);
  assert.equal(malformed.first, `next: ${OPUS} branch held`, ran("a branch record outside the record domain holds (fail closed)", malformed));
  assert.equal(malformed.kv.get("why"), `opera/W-901.md on refs/heads/opus/W-901 has no front matter, so W-901's Files owned cannot be checked against ${OPUS}'s (W-633)`, ran("malformed: the why names the record, the ref and the reason", malformed));
  onBranch(w, undefined);
  const absent = next(w, [OPUS, ...BUDGET]);
  assert.equal(absent.first, `next: ${OPUS} branch held`, ran("no record on the branch holds (fail closed)", absent));
  assert.equal(absent.kv.get("why"), `opera/W-901.md is not a readable blob on refs/heads/opus/W-901, so W-901's Files owned cannot be checked against ${OPUS}'s (W-633)`, ran("absent: the why names the record and the ref", absent));
});
