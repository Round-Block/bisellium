/**
 * W-153 row b5 (studio/briefs/W-153.md): `GET /api/completion` serves the same
 * meter and estimate the Status page computes, from the trunk's own records.
 * node:test TAP, selected by `--test-name-pattern=W-153-b5`. The fixture is a
 * copy of examples/sample-studio under the OS tmp dir.
 *
 * Run from the repo root:
 *   node --test-reporter=tap --import tsx apps/server/test/completion.test.ts --test-name-pattern=W-153-b5
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { computeMeter, estimateFinish } from "@bisellium/core";
import { startServer, type StartServerOptions } from "../src/index.js";
import { Store } from "../src/store.js";

process.env["NODE_ENV"] = "test";

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples", "sample-studio");
const NOW = new Date("2026-10-06T12:00:00Z");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const noopRunners: StartServerOptions["runners"] = {
  answer: () => ({ exitCode: 0 }),
  greenlight: () => ({ exitCode: 0 }),
  budget: () => ({ exitCode: 0 }),
  handoff: () => ({ exitCode: 0 }),
  talk: async () => ({ exitCode: 0 }),
  pause: async () => ({ exitCode: 0 }),
  resume: async () => ({ exitCode: 0 }),
  delegate: () => ({ exitCode: 0 }),
};

interface Rec { id: string; state: string; value: number; end?: string; gates?: string[] }
const rec = (id: string, state: string, value: number, end?: string): Rec => ({ id, state, value, ...(end ? { end } : {}) });
const RECORDS: Rec[] = [
  rec("W-1", "done", 8, "2026-10-05T10:00:00Z"),
  rec("W-2", "done", 8, "2026-10-04T10:00:00Z"),
  rec("W-3", "done", 5, "2026-09-30T10:00:00Z"),
  rec("W-4", "done", 8, "2026-09-28T10:00:00Z"),
  rec("W-5", "done", 3, "2026-09-25T10:00:00Z"),
  rec("W-7", "done", 5, "2026-09-20T10:00:00Z"),
  rec("W-8", "done", 2, "2026-09-16T10:00:00Z"),
  rec("W-10", "done", 1, "2026-09-01T10:00:00Z"),
  { ...rec("W-6", "done", 3), gates: ["2026-09-23T09:00:00Z", "2026-09-24T10:00:00Z"] },
  rec("W-9", "done", 3),
  rec("W-11", "backlog", 8),
  rec("W-12", "greenlit", 8),
  rec("W-13", "building", 8),
  rec("W-14", "review", 3),
  rec("W-15", "backlog", 1),
  rec("W-16", "halted", 8),
];

function front(r: Rec): string {
  const gates = (r.gates ?? []).map((at, i) => `  g${i}: { status: passed, at: "${at}" }\n`).join("");
  return [
    "---", `id: ${r.id}`, `title: Row ${r.id}`, "kind: feature", "collegium: engineering", `state: ${r.state}`,
    "milestone: M1", `value: ${r.value}`, ...(r.end ? [`end: "${r.end}"`] : []),
    ...(gates ? ["probationes:", gates.trimEnd()] : []), "---", "", "",
  ].join("\n");
}

function studio(exit: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-w153-b5-"));
  dirs.push(dir);
  cpSync(SAMPLE, dir, { recursive: true });
  writeFileSync(join(dir, "milestones.yml"), `milestones:\n  - { id: M1, title: "One", weight: 100, exit: ${exit} }\n`);
  for (const r of RECORDS) writeFileSync(join(dir, "opera", `${r.id}.md`), front(r));
  return dir;
}

async function serve(studioDir: string, checkStudio: StartServerOptions["checkStudio"]) {
  const server = await startServer({ studioDir, checkStudio, runners: noopRunners, token: "w153", once: true, now: NOW, port: 0 });
  return { server, get: (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`) };
}

test("W-153-b5 behaviour 5: GET /api/completion serves the same meter and estimate from the records", async () => {
  const studioDir = studio("{ needs: x }");
  let checked = 0;
  const stub: StartServerOptions["checkStudio"] = () => {
    checked++;
    return { ok: true, blocks: 0, advisories: 0, findings: [] };
  };
  const { server, get } = await serve(studioDir, stub);
  try {
    const res = await get("/api/completion");
    assert.equal(res.status, 200);
    const opera = RECORDS.map((r) => ({
      id: r.id, state: r.state, milestone: "M1", value: r.value,
      ...(r.end ? { end: r.end } : {}),
      ...(r.gates ? { probationes: Object.fromEntries(r.gates.map((at, i) => [`g${i}`, { status: "passed", at }])) } : {}),
    }));
    const milestones = [{ id: "M1", title: "One", weight: 100, exit: { needs: "x" } }];
    const meter = computeMeter({ milestones, opera, findings: [] });
    const estimate = estimateFinish({ meter, opera, now: NOW });
    assert.equal(estimate.days, 14);
    assert.deepEqual(await res.json(), JSON.parse(JSON.stringify({ meter, estimate })));
    assert.equal(checked, 0, "checkStudio is not called for a non-rule exit");

    const ruled = studio("{ rule: lesson.recurrent }");
    let ruleChecked = 0;
    const finding = { rule: "lesson.recurrent" };
    const store = new Store({ studioDir: ruled, now: NOW });
    const body = store.api.completion(() => {
      ruleChecked++;
      return { ok: false, blocks: 1, advisories: 0, findings: [finding] };
    }) as { meter: { rows: { id: string; met: boolean }[] } };
    assert.equal(ruleChecked, 1);
    assert.equal(body.meter.rows.find((r) => r.id === "M1")?.met, false);

    unlinkSync(join(studioDir, "milestones.yml"));
    assert.deepEqual(await (await get("/api/completion")).json(), { meter: null, estimate: null });
  } finally {
    await server.close();
  }
});

test("W-153-b5 behaviour 5: an unreadable or non-numeric opus record gives no estimate, never a number", () => {
  const line = "No estimate: an opus record is unreadable or carries no valid points.";
  const nope = (): { ok: boolean; blocks: number; advisories: number; findings: unknown[] } => ({ ok: true, blocks: 0, advisories: 0, findings: [] });
  const ask = (dir: string) => new Store({ studioDir: dir, now: NOW }).api.completion(nope) as { meter: unknown; estimate: { kind: string; reason?: string; line: string } };

  const clean = ask(studio("{ needs: x }"));
  assert.equal(clean.estimate.kind, "estimate", "control: the clean fixture has an estimate");

  const unreadable = studio("{ needs: x }");
  writeFileSync(join(unreadable, "opera", "W-99.md"), "no front matter in this record\n");
  const a = ask(unreadable);
  assert.equal(a.estimate.kind, "none");
  assert.equal(a.estimate.reason, "unreadable-records");
  assert.equal(a.estimate.line, line);

  const broken = studio("{ needs: x }");
  writeFileSync(join(broken, "opera", "W-98.md"), "---\nid: [unclosed\n---\n");
  assert.equal(ask(broken).estimate.reason, "unreadable-records", "a front matter that does not parse");

  const lots = studio("{ needs: x }");
  writeFileSync(join(lots, "opera", "W-11.md"), front({ id: "W-11", state: "backlog", value: 8 }).replace("value: 8", "value: lots"));
  const c = ask(lots);
  assert.equal(c.estimate.kind, "none");
  assert.equal(c.estimate.reason, "unreadable-records");
  assert.ok(c.meter !== null, "the meter is still served");
});

test("W-153-b5 behaviour 5: a non-finite point value never reaches the served meter as null", async () => {
  const dir = studio("{ needs: x }");
  writeFileSync(join(dir, "opera", "W-11.md"), front({ id: "W-11", state: "backlog", value: 8 }).replace("value: 8", "value: .inf"));
  const { server, get } = await serve(dir, () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }));
  try {
    const body = (await (await get("/api/completion")).json()) as { meter: { overall: unknown; rows: Record<string, unknown>[] }; estimate: { kind: string; reason?: string } };
    assert.equal(body.estimate.kind, "none");
    assert.equal(body.estimate.reason, "unreadable-records");
    const fields = [body.meter.overall, ...body.meter.rows.flatMap((r) => [r["done"], r["planned"], r["pct"]])];
    for (const f of fields) assert.ok(typeof f === "number" && Number.isFinite(f), `meter field ${String(f)} is a finite number`);
  } finally {
    await server.close();
  }
});

test("W-153-b5 behaviour 5: a dated done opus with a non-finite value serves No estimate with every numeric field finite", async () => {
  const dir = studio("{ needs: x }");
  writeFileSync(join(dir, "opera", "W-1.md"), front({ id: "W-1", state: "done", value: 8, end: "2026-10-05T10:00:00Z" }).replace("value: 8", "value: .inf"));
  const { server, get } = await serve(dir, () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }));
  try {
    const body = (await (await get("/api/completion")).json()) as { estimate: Record<string, unknown> & { weekly: unknown[] } };
    assert.equal(body.estimate["kind"], "none");
    assert.equal(body.estimate["reason"], "unreadable-records");
    for (const [k, v] of Object.entries(body.estimate)) if (typeof v === "number" || v === null) assert.ok(typeof v === "number" && Number.isFinite(v), `estimate.${k} is finite`);
    for (const w of body.estimate.weekly) assert.ok(typeof w === "number" && Number.isFinite(w), "every weekly field is finite");
  } finally {
    await server.close();
  }
});

test("W-153-b5 behaviour 5: a non-finite milestone weight serves No estimate with every meter row finite", async () => {
  const dir = studio("{ needs: x }");
  writeFileSync(join(dir, "milestones.yml"), 'milestones:\n  - { id: M1, title: "One", weight: .inf, exit: { needs: x } }\n');
  const { server, get } = await serve(dir, () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }));
  try {
    const body = (await (await get("/api/completion")).json()) as { meter: { overall: unknown; rows: Record<string, unknown>[] }; estimate: { reason?: string } };
    assert.equal(body.estimate.reason, "unreadable-records");
    for (const r of body.meter.rows) for (const [k, v] of Object.entries(r)) if (typeof v === "number" || v === null) assert.ok(typeof v === "number" && Number.isFinite(v), `meter row ${k} is finite`);
    assert.ok(typeof body.meter.overall === "number" && Number.isFinite(body.meter.overall));
  } finally {
    await server.close();
  }
});

test("W-153-b5 behaviour 5: a value or weight outside the milestone domain serves No estimate, and the whole body stays finite", async () => {
  const finite = (v: unknown, path: string): void => {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `${path} is finite`);
    else if (v === null) assert.fail(`${path} is null`);
    else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${path}[${i}]`));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as object)) finite(x, `${path}.${k}`);
  };
  const ms = (w1: number, w2: number): string =>
    `milestones:\n  - { id: M1, title: "One", weight: ${w1}, exit: { needs: x } }\n  - { id: M2, title: "Two", weight: ${w2}, exit: { needs: x } }\n`;
  const setValue = (id: string, state: string, value: string) => (d: string) =>
    writeFileSync(join(d, "opera", `${id}.md`), front({ id, state, value: 8 }).replace("value: 8", `value: ${value}`));
  const cases: [string, (d: string) => void][] = [
    ["value 0", setValue("W-11", "backlog", "0")],
    ["value 4", setValue("W-11", "backlog", "4")],
    ["a huge value", (d) => (setValue("W-30", "backlog", "1e308")(d), setValue("W-31", "backlog", "1e308")(d))],
    ["a fractional weight", (d) => writeFileSync(join(d, "milestones.yml"), ms(33.5, 66.5))],
    ["a negative weight", (d) => writeFileSync(join(d, "milestones.yml"), ms(-10, 110))],
    ["weights totalling 99", (d) => writeFileSync(join(d, "milestones.yml"), ms(49, 50))],
  ];
  for (const [what, mutate] of cases) {
    const dir = studio("{ needs: x }");
    writeFileSync(join(dir, "milestones.yml"), ms(50, 50));
    mutate(dir);
    const { server, get } = await serve(dir, () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }));
    try {
      const body = (await (await get("/api/completion")).json()) as { estimate: { kind: string; reason?: string } };
      assert.equal(body.estimate.kind, "none", what);
      assert.equal(body.estimate.reason, "unreadable-records", what);
      finite(body, what);
    } finally {
      await server.close();
    }
  }
});
