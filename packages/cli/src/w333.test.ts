/**
 * W-333 rows b1 and b2 (studio/briefs/W-333.md): the queue is a record. `studio/queue.yml` holds one ranked list per
 * queue with the lanes that share it; `queue.shape` judges it (b1) and `next --all` prints one line per lane, by queue,
 * an idle lane naming the entry it would take (b2, W-478 folded). node:test TAP, one test() per behaviour, selected by
 * `--test-name-pattern='^W-333-b<k>\s'`. Every row builds its own officina under the OS tmp dir and writes nothing in
 * studio/ or examples/; no row imports the module under test, so a red is the row's own failed assertion.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";

delete process.env["BISELLIUM_SELLA"];

const NOW = new Date("2026-11-03T12:00:00Z");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function officina(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w333-${tag}-`));
  dirs.push(dir);
  const init = initStudio(dir, { now: NOW });
  assert.ok(init.root, init.message);
  return dir;
}

function opus(dir: string, id: string, state: string): void {
  mkdirSync(join(dir, "opera"), { recursive: true });
  writeFileSync(join(dir, "opera", `${id}.md`), `---\nid: ${id}\ntitle: ${id} fixture\nkind: feature\ncollegium: production\nstate: ${state}\n---\nbody\n`);
}

const queueShape = (dir: string, yaml: string): string[] => {
  writeFileSync(join(dir, "queue.yml"), yaml);
  return checkStudio(dir, NOW)
    .findings.filter((f) => f.rule === "queue.shape")
    .map((f) => `${f.level} ${f.where} ${f.message}`);
};

/** The handoff's Queue as a record: two queues, their lanes, a folded id, a next.ts marker, halted, cut and deferred. */
const VALID = `queues:
  engineering:
    lanes: { E1: W-1, E2: ~ }
    next:
      - { opus: W-1, says: "main-thread heavy runs refused" }
      - { opus: W-2, says: "the queue as a record", folded: [W-9], next_ts: true }
      - { opus: W-3, says: "one spec admission table" }
  ui:
    lanes: { UI1: W-4, UI2: ~ }
    next:
      - { opus: W-4, says: "Board drawer keeps Planned in place" }
halted:
  - { opus: W-5, says: "held for a ruling" }
cut:
  - { opus: W-6, says: "cut in the workflow review" }
deferred: []
`;

// ---------------------------------------------------------------------------
// Behaviour 1: queue.shape judges studio/queue.yml (D-077 B): each problem one blocking finding, inert while absent
// ---------------------------------------------------------------------------
test("W-333-b1 behaviour 1: queue.shape judges studio/queue.yml, one blocking finding per problem, none while it is absent", () => {
  const dir = officina("b1");
  for (const [id, state] of [["W-1", "building"], ["W-2", "greenlit"], ["W-3", "greenlit"], ["W-4", "review"], ["W-5", "halted"], ["W-6", "backlog"], ["W-9", "greenlit"]] as const) opus(dir, id, state);

  const twice = queueShape(dir, VALID.replace('      - { opus: W-3, says: "one spec admission table" }\n', '      - { opus: W-3, says: "one spec admission table" }\n      - { opus: W-3, says: "again" }\n'));
  assert.deepEqual(twice, ["block queue.yml W-3 is listed twice: queue engineering next and queue engineering next"], "an opus listed twice yields one blocking queue.shape finding at queue.yml");

  assert.deepEqual(queueShape(dir, VALID), [], "the handoff's Queue as a record yields no queue.shape finding");
  rmSync(join(dir, "queue.yml"));
  assert.deepEqual(
    checkStudio(dir, NOW).findings.filter((f) => f.rule === "queue.shape"),
    [],
    "no queue.yml yields none",
  );

  // each problem, alone, is named
  const cases: [string, string, string][] = [
    ["a file that does not parse", "queues: [\n", "it does not parse: "],
    ["an unknown top-level key", `${VALID}later: []\n`, 'unknown key "later" (allowed: queues, halted, cut, deferred)'],
    ["no queues", "halted: []\n", 'it needs a "queues" mapping of at least one queue'],
    ["a queue id with a capital", VALID.replace("  ui:\n", "  UI:\n"), 'queue id "UI" must be lower-case letters, digits and hyphens'],
    ["a queue without lanes", VALID.replace("    lanes: { UI1: W-4, UI2: ~ }\n", "").replace('      - { opus: W-4, says: "Board drawer keeps Planned in place" }\n', ""), "queue ui lanes must be a mapping of at least one lane"],
    ["a lane holding a non-id", VALID.replace("E2: ~", "E2: [W-3]"), 'queue engineering lane E2 holds ["W-3"], not an opus id or ~'],
    ["a queue without next", VALID.replace("    lanes: { UI1: W-4, UI2: ~ }\n    next:\n", "    lanes: { UI1: ~ }\n    later:\n"), "queue ui next must be a list"],
    ["an entry with an unknown key", VALID.replace('says: "one spec admission table"', 'says: "one spec admission table", rank: 3'), 'queue engineering next entry #3 has unknown key "rank" (allowed: opus, says, folded, next_ts)'],
    ["an entry without says", VALID.replace('{ opus: W-3, says: "one spec admission table" }', "{ opus: W-3 }"), "queue engineering next W-3 says must be one non-empty line of at most 200 characters"],
    ["a says of two lines", VALID.replace('says: "one spec admission table"', 'says: "one\\nspec"'), "queue engineering next W-3 says must be one non-empty line of at most 200 characters"],
    ["a folded that is not a list of ids", VALID.replace("folded: [W-9]", "folded: W-9"), "queue engineering next W-2 folded must be a list of opus ids"],
    ["a next_ts that is not a boolean", VALID.replace("next_ts: true", 'next_ts: "yes"'), "queue engineering next W-2 next_ts must be true or false"],
    ["a folded id also listed", VALID.replace("deferred: []", 'deferred:\n  - { opus: W-9, says: "later" }'), "W-9 is listed twice: queue engineering next (folded into W-2) and deferred"],
    ["a lane named in two queues", VALID.replace("UI2: ~", "E2: ~"), "lane E2 is named in queue engineering and queue ui"],
    ["two lanes holding one opus", VALID.replace("E2: ~", "E2: W-1"), "W-1 is held by lane E1 and lane E2"],
    ["a lane holding an opus of another queue", VALID.replace("UI2: ~", "UI2: W-3"), "lane UI2 holds W-3, which is not an entry of queue ui next"],
    ["two lanes holding next_ts entries", VALID.replace("E2: ~", "E2: W-2").replace('{ opus: W-1, says: "main-thread heavy runs refused" }', '{ opus: W-1, says: "main-thread heavy runs refused", next_ts: true }'), "more than one lane holds a next_ts entry: E1 (W-1), E2 (W-2); one next.ts opus is in flight at a time"],
    ["an opus with no record", VALID.replace("deferred: []", 'deferred:\n  - { opus: W-77, says: "not filed" }'), "W-77 has no record in opera/"],
  ];
  for (const [what, yaml, message] of cases) {
    const found = queueShape(dir, yaml);
    assert.ok(
      found.some((f) => f.startsWith("block queue.yml ") && f.includes(message)),
      `${what}: a blocking queue.shape finding naming "${message}"; got ${JSON.stringify(found)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Behaviour 2: next --all prints one line per lane, by queue; an idle lane names the entry it would take (W-478)
// ---------------------------------------------------------------------------
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "main.ts");
const TSX = import.meta.resolve("tsx");

/** A git repository holding an init officina at `studio/` whose opera are committed: the shape `next --all` reads. */
function laneWorld(states: [string, string][]): { repo: string; studio: string } {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w333-b2-"));
  dirs.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (...args: string[]): void => {
    const r = spawnSync("git", ["-c", "user.name=w333", "-c", "user.email=w333@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q", "-b", "master");
  const studio = join(repo, "studio");
  const init = initStudio(studio, { now: NOW });
  assert.ok(init.root, init.message);
  for (const [id, state] of states) opus(studio, id, state);
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return { repo, studio };
}

function nextAll(w: { repo: string; studio: string }, home: string): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "next", "--all", "--studio", w.studio, "--repo", w.repo], { cwd: w.repo, encoding: "utf8", timeout: 300_000, env: { ...process.env, BISELLIUM_SELLA: "", HOME: home } });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Every file under `dir` (its .git included), path and bytes: two equal snapshots mean nothing was written. */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}\n${readFileSync(p, "base64")}`);
    }
  };
  walk(dir);
  return out.join("\n");
}

const laneOut = (out: string): string[] => out.split("\n").filter((l) => /^(lane|queue): /.test(l));

const LANES = `queues:
  engineering:
    lanes: { E1: W-1, E2: ~ }
    next:
      - { opus: W-1, says: "holds next.ts", next_ts: true }
      - { opus: W-2, says: "also next.ts", next_ts: true }
      - { opus: W-3, says: "done already" }
      - { opus: W-4, says: "free" }
  ui:
    lanes: { UI1: W-5, UI2: ~, UI3: ~ }
    next:
      - { opus: W-5, says: "done, so UI1 is idle" }
      - { opus: W-6, says: "first free" }
      - { opus: W-7, says: "second free" }
`;

test("W-333-b2 behaviour 2: next --all prints one line per lane by queue, an idle lane naming the highest entry it could start, and writes nothing", { timeout: 900_000 }, () => {
  const w = laneWorld([["W-1", "greenlit"], ["W-2", "greenlit"], ["W-3", "done"], ["W-4", "greenlit"], ["W-5", "done"], ["W-6", "greenlit"], ["W-7", "greenlit"]]);
  const home = mkdtempSync(join(tmpdir(), "w333-home-"));
  dirs.push(home);
  writeFileSync(join(w.studio, "queue.yml"), LANES);

  const before = snapshot(w.repo);
  const r = nextAll(w, home);
  assert.deepEqual(
    laneOut(r.out),
    [
      "lane: engineering E1 · W-1 greenlit",
      "lane: engineering E2 · idle · takes W-4 (#4) · skipped W-1 (#1): in E1, W-2 (#2): next.ts with E1's W-1, W-3 (#3): done",
      "lane: ui UI1 · idle (W-5 done) · takes W-6 (#2) · skipped W-5 (#1): done",
      "lane: ui UI2 · idle · takes W-7 (#3) · skipped W-5 (#1): done, W-6 (#2): taken by UI1",
      "lane: ui UI3 · idle · nothing to take · skipped W-5 (#1): done, W-6 (#2): taken by UI1, W-7 (#3): taken by UI2",
    ],
    "the lane lines, by queue",
  );
  const order = r.out
    .trimEnd()
    .split("\n")
    .map((l) => l.split(":")[0])
    .filter((k, i, a) => k !== a[i - 1]);
  assert.deepEqual(order, ["next", "lane", "codex", "open"], "the lane lines follow every opus line, before the Codex line and the open count");
  assert.equal(r.status, 0, `an idle lane is reported, not failed: exit 0 (${r.err})`);
  assert.equal(snapshot(w.repo), before, "next --all writes nothing: every file under the repository, .git included, is byte-identical");

  // E1's opus is done: its lane takes the skipped next.ts entry at its own place, and E2 still takes W-4
  writeFileSync(join(w.studio, "opera", "W-1.md"), readFileSync(join(w.studio, "opera", "W-1.md"), "utf8").replace("state: greenlit", "state: done"));
  assert.deepEqual(
    laneOut(nextAll(w, home).out).slice(0, 2),
    [
      "lane: engineering E1 · idle (W-1 done) · takes W-2 (#2) · skipped W-1 (#1): done",
      "lane: engineering E2 · idle · takes W-4 (#4) · skipped W-1 (#1): done, W-2 (#2): taken by E1, W-3 (#3): done",
    ],
    "a skipped entry keeps its place: once the next.ts opus is done, the first idle lane takes it",
  );

  // malformed: a held line, and the run exits 1 after every line
  writeFileSync(join(w.studio, "queue.yml"), LANES.replace("UI2: ~", "UI2: W-3"));
  const held = nextAll(w, home);
  assert.deepEqual(laneOut(held.out), ["queue: held · why: queue.yml is malformed: lane UI2 holds W-3, which is not an entry of queue ui next"], "a malformed queue.yml: the held line alone");
  assert.equal(held.status, 1, "a malformed queue.yml: exit 1");

  // absent: no line, as before W-333
  rmSync(join(w.studio, "queue.yml"));
  const absent = nextAll(w, home);
  assert.deepEqual(laneOut(absent.out), [], "no queue.yml: no lane line");
  assert.equal(absent.status, 0, "no queue.yml: exit 0");
});
