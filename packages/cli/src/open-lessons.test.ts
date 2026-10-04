/**
 * W-085: a sella boots knowing the open lesson classes of its collegium.
 * Rows are `node:test`, named `W-085 behaviour <n>: …`; each red is recorded
 * with --test-name-pattern=W-085.behaviour.<n>: . Fixtures are temp copies of
 * examples/sample-studio; the real studio/ is never read.
 *
 * `openLessons` is loaded by a variable specifier so a missing module is the
 * row's own failed assertion, never a module-load error.
 */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

interface OpenLessonClass {
  class: string;
  lessons: string[];
  cascades: number[];
  latest: string;
  latestAt: string;
  collegia: string[];
  fixInFlight?: { id: string; state: string };
}
type OpenLessons = (root: string) => OpenLessonClass[];

const SAMPLE = join(import.meta.dirname, "..", "..", "..", "examples", "sample-studio");
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function load(): Promise<OpenLessons> {
  const spec = "@bisellium/commands/lessons.js";
  const mod = (await import(spec).catch(() => ({}))) as { openLessons?: OpenLessons };
  assert.equal(typeof mod.openLessons, "function", "openLessons is exported by @bisellium/commands/lessons.js");
  return mod.openLessons!;
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-w085-"));
  made.push(dir);
  cpSync(SAMPLE, dir, { recursive: true });
  mkdirSync(join(dir, "lessons"), { recursive: true });
  mkdirSync(join(dir, "decisions"), { recursive: true });
  return dir;
}
const put = (dir: string, rel: string, front: string[]): void => writeFileSync(join(dir, rel), `---\n${front.join("\n")}\n---\nFixture.\n`);
const pad = (n: number): string => String(n).padStart(3, "0");

interface LessonOpts {
  cls: string;
  at?: string;
  cascade?: number;
  evidence?: string[];
  addressed_by?: string;
}
function lesson(dir: string, n: number, o: LessonOpts): string {
  const id = `L-${pad(n)}`;
  put(dir, `lessons/${id}.md`, [
    `id: ${id}`,
    `at: ${o.at ?? "2026-10-01T00:00:00.000Z"}`,
    `class: ${JSON.stringify(o.cls)}`,
    `evidence: ${JSON.stringify(o.evidence ?? ["opera/W-001.md"])}`,
    ...(o.cascade === undefined ? [] : [`cascade: ${o.cascade}`]),
    ...(o.addressed_by === undefined ? [] : [`addressed_by: ${JSON.stringify(o.addressed_by)}`]),
  ]);
  return id;
}
function opus(dir: string, id: string, o: { collegium: string; state: string; gates?: Record<string, string> }): void {
  const gates = Object.entries(o.gates ?? {}).map(([g, sella]) => `  ${g}: { sella: ${sella}, status: passed }`);
  put(dir, `opera/${id}.md`, [
    `id: ${id}`,
    `title: fixture ${id}`,
    "kind: feature",
    `collegium: ${o.collegium}`,
    `state: ${o.state}`,
    ...(gates.length ? ["probationes:", ...gates] : []),
  ]);
}
const decision = (dir: string, id: string): void =>
  put(dir, `decisions/${id}.md`, [`id: ${id}`, "title: fixture", "at: 2026-10-01", "provenance: patron", "by: patron", "kill_when: never"]);

test("W-085 behaviour 1: openLessons closes and keeps classes correctly", async () => {
  const openLessons = await load();
  const dir = fixture();
  decision(dir, "D-801");
  opus(dir, "W-801", { collegium: "engineering", state: "building" });
  opus(dir, "W-802", { collegium: "engineering", state: "review" });
  lesson(dir, 1, { cls: "closed-by-rule", addressed_by: "opus.red_content" });
  lesson(dir, 2, { cls: "closed-by-decision", addressed_by: "D-801" });
  lesson(dir, 3, { cls: "closed-by-done-opus", addressed_by: "W-001" });
  lesson(dir, 4, { cls: "in-flight", addressed_by: "W-802" });
  lesson(dir, 5, { cls: "in-flight", addressed_by: "W-801" });
  lesson(dir, 6, { cls: "typo-opus", addressed_by: "W-999" });
  lesson(dir, 7, { cls: "typo-decision", addressed_by: "D-999" });
  lesson(dir, 8, { cls: "traversal", addressed_by: "../opera/W-001" });
  lesson(dir, 9, { cls: "unaddressed" });
  writeFileSync(join(dir, "lessons", "L-010.md"), "---\nid: [unterminated\n---\nbroken\n");

  let out: OpenLessonClass[] = [];
  assert.doesNotThrow(() => {
    out = openLessons(dir);
  });
  assert.deepEqual(out.map((c) => c.class).sort(), ["in-flight", "traversal", "typo-decision", "typo-opus", "unaddressed"]);
  const by = (c: string): OpenLessonClass => out.find((x) => x.class === c)!;
  assert.deepEqual(by("in-flight").fixInFlight, { id: "W-801", state: "building" });
  for (const c of ["typo-opus", "typo-decision", "traversal", "unaddressed"]) assert.equal(by(c).fixInFlight, undefined, c);
});

test("W-085 behaviour 2: openLessons ranks by cascades, count, newest at, class", async () => {
  const openLessons = await load();
  const dir = fixture();
  // "recurs": two cascades; its newest lesson is not its highest id
  lesson(dir, 20, { cls: "recurs", cascade: 43, at: "2026-10-01T00:00:00.000Z" });
  lesson(dir, 21, { cls: "recurs", cascade: 41, at: "2026-09-20T00:00:00.000Z" });
  lesson(dir, 22, { cls: "recurs", cascade: 43, at: "2026-09-25T00:00:00.000Z" });
  // "many": one cascade, three lessons, all at the same instant
  for (const n of [30, 31, 32]) lesson(dir, n, { cls: "many", cascade: 42, at: "2026-10-02T00:00:00.000Z" });
  // one lesson each, ranked by newest `at`, then class
  lesson(dir, 40, { cls: "newest", cascade: 42, at: "2026-10-04T00:00:00.000Z" });
  lesson(dir, 41, { cls: "beta", cascade: 42, at: "2026-10-03T00:00:00.000Z" });
  lesson(dir, 42, { cls: "alpha", cascade: 42, at: "2026-10-03T00:00:00.000Z" });
  lesson(dir, 43, { cls: "oldest", cascade: 42, at: "2026-10-01T00:00:00.000Z" });

  const out = openLessons(dir);
  assert.deepEqual(out.map((c) => c.class), ["recurs", "many", "newest", "alpha", "beta", "oldest"]);
  const recurs = out[0]!;
  assert.deepEqual(recurs.lessons, ["L-020", "L-021", "L-022"]);
  assert.deepEqual(recurs.cascades, [41, 43]);
  assert.equal(recurs.latest, "L-020");
  assert.equal(recurs.latestAt, "2026-10-01T00:00:00.000Z");
  assert.equal(out[1]!.latest, "L-032");
  assert.deepEqual(out[1]!.cascades, [42]);
});
