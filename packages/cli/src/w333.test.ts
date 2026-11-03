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
