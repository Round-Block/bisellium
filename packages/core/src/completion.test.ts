/**
 * W-153 rows b1-b3 (studio/briefs/W-153.md): a done opus is dated by its record,
 * the estimate is the remaining points over the three-week pace, a bulk closure
 * is left out and thin history gives no estimate. node:test TAP, selected by
 * `--test-name-pattern=W-153-b<n>`. In-memory fixtures only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMeter, doneAt, estimateFinish } from "./completion.js";

const NOW = new Date("2026-10-06T12:00:00Z");
const milestones = [{ id: "M1", title: "One", weight: 100, exit: { needs: "x" } }];

type Opus = { id: string; state: string; milestone: string; value: number; end?: string; probationes?: Record<string, { at?: string; status?: string }> };
const done = (id: string, value: number, end: string): Opus => ({ id, state: "done", milestone: "M1", value, end });
const open = (id: string, state: string, value: number): Opus => ({ id, state, milestone: "M1", value });

function fixture(): Opus[] {
  return [
    done("W-1", 8, "2026-10-05T10:00:00Z"),
    done("W-2", 8, "2026-10-04T10:00:00Z"),
    done("W-3", 5, "2026-09-30T10:00:00Z"),
    done("W-4", 8, "2026-09-28T10:00:00Z"),
    done("W-5", 3, "2026-09-25T10:00:00Z"),
    done("W-7", 5, "2026-09-20T10:00:00Z"),
    done("W-8", 2, "2026-09-16T10:00:00Z"),
    done("W-10", 1, "2026-09-01T10:00:00Z"),
    { id: "W-6", state: "done", milestone: "M1", value: 3, probationes: { spec: { status: "passed", at: "2026-09-23T09:00:00Z" }, review: { status: "passed", at: "2026-09-24T10:00:00Z" } } },
    { id: "W-9", state: "done", milestone: "M1", value: 3 },
    open("W-11", "backlog", 8),
    open("W-12", "greenlit", 8),
    open("W-13", "building", 8),
    open("W-14", "review", 3),
    open("W-15", "backlog", 1),
    open("W-16", "halted", 8),
  ];
}
const estimate = (opera: Opus[]) => estimateFinish({ meter: computeMeter({ milestones, opera, findings: [] }), opera, now: NOW });

test("W-153-b1 behaviour 1: a done opus is dated by its record, end else its latest gate time", () => {
  assert.equal(doneAt({ end: "2026-10-05T10:00:00Z" }), "2026-10-05T10:00:00.000Z");
  assert.equal(doneAt({ end: new Date("2026-10-05T10:00:00Z") }), "2026-10-05T10:00:00.000Z");
  assert.equal(
    doneAt({ probationes: { spec: { status: "passed", at: "2026-09-23T09:00:00Z" }, review: { status: "passed", at: "2026-09-24T10:00:00Z" }, tests: { status: "passed" } } }),
    "2026-09-24T10:00:00.000Z",
  );
  assert.equal(doneAt({ end: new Date("2026-09-20T00:00:00Z"), probationes: { review: { status: "passed", at: "2026-09-25T10:00:00Z" } } }), "2026-09-20T00:00:00.000Z", "end wins");
  assert.equal(doneAt({ end: "soon", probationes: { review: { status: "passed", at: "2026-09-24T10:00:00Z" } } }), "2026-09-24T10:00:00.000Z");
  assert.equal(doneAt({}), undefined);
});

test("W-153-b2 behaviour 2: the estimate is the remaining points over the three-week mean, ranged by the fastest and slowest week", () => {
  const e = estimate(fixture());
  assert.equal(e.kind, "estimate");
  assert.equal(e.remaining, 28);
  assert.deepEqual(e.weekly, [21, 14, 7]);
  assert.equal(e.days, 14);
  assert.equal(e.low, 10);
  assert.equal(e.high, 28);
  assert.equal(e.finish, "2026-10-20");
  assert.deepEqual(e.bulk, []);
  assert.equal(e.line, "Estimated finish: in about 14 days (10 to 28 days), around 20 Oct 2026, at the pace of the last 3 weeks.");
  const without = fixture().filter((o) => !["W-9", "W-10", "W-16"].includes(o.id));
  assert.deepEqual(estimate(without), e, "W-9, W-10 and the halted W-16 change nothing");
});

test("W-153-b3 behaviour 3: a bulk closure is left out of the pace; thin history or nothing left gives no estimate", () => {
  const burst = (n: number): Opus[] =>
    ["14:05", "14:20", "14:35", "14:50"].slice(0, n).map((t, i) => done(`W-2${i}`, 5, `2026-10-05T${t}:00Z`));

  const four = estimate([...fixture(), ...burst(4)]);
  assert.deepEqual(four.bulk, ["W-20", "W-21", "W-22", "W-23"]);
  assert.deepEqual(four.weekly, [21, 14, 7]);
  assert.equal(four.days, 14);

  const three = estimate([...fixture(), ...burst(3)]);
  assert.deepEqual(three.bulk, []);
  assert.deepEqual(three.weekly, [36, 14, 7]);
  assert.equal(three.days, 11);

  const thin = estimate(fixture().filter((o) => !["W-7", "W-8"].includes(o.id)));
  assert.equal(thin.kind, "none");
  assert.equal(thin.reason, "too-little-history");
  assert.equal(thin.line, "No estimate yet: it needs points done in each of the last 3 weeks.");

  const all = estimate(fixture().map((o) => (["W-11", "W-12", "W-13", "W-14", "W-15"].includes(o.id) ? { ...o, state: "done" } : o)));
  assert.equal(all.kind, "none");
  assert.equal(all.reason, "nothing-left");
  assert.equal(all.remaining, 0);
  assert.equal(all.line, "Nothing left: every planned point is done.");
});

test("W-153-b1 behaviour 1: only a passed gate dates a done opus, never a failed, waived or status-less one", () => {
  const gate = (status: string | undefined, at: string) => ({ ...(status ? { status } : {}), at });
  assert.equal(
    doneAt({ probationes: { review: gate("passed", "2026-09-24T10:00:00Z"), tests: gate("failed", "2026-09-26T10:00:00Z") } }),
    "2026-09-24T10:00:00.000Z",
    "a newer failed gate does not date it",
  );
  assert.equal(doneAt({ probationes: { review: gate("failed", "2026-09-26T10:00:00Z"), qa: gate("waived", "2026-09-27T10:00:00Z"), lint: gate(undefined, "2026-09-28T10:00:00Z") } }), undefined);
  assert.equal(doneAt({ end: "2026-09-20T00:00:00Z", probationes: { review: gate("passed", "2026-09-25T10:00:00Z") } }), "2026-09-20T00:00:00.000Z", "end still wins");
});

test("W-153-b3 behaviour 3: a malformed or unreadable record gives no estimate, never a number", () => {
  const line = "No estimate: an opus record is unreadable or carries no valid points.";
  const bad = (value: unknown, state = "backlog"): Opus[] => [...fixture().filter((o) => o.id !== "W-11"), { id: "W-11", state, milestone: "M1", value } as Opus];
  const run = (opera: Opus[], unreadable?: number) => {
    let got: ReturnType<typeof estimateFinish> | undefined;
    assert.doesNotThrow(() => {
      got = estimateFinish({ meter: computeMeter({ milestones, opera, findings: [] }), opera, now: NOW, ...(unreadable === undefined ? {} : { unreadable }) });
    }, "estimateFinish does not throw");
    return got as ReturnType<typeof estimateFinish>;
  };

  for (const value of ["lots", undefined, null, -3, Number.NaN, "8"]) {
    const e = run(bad(value));
    assert.equal(e.kind, "none", `value ${String(value)} gives no estimate`);
    assert.equal(e.reason, "unreadable-records");
    assert.equal(e.line, line);
  }
  assert.equal(run(bad("lots", "done")).reason, "unreadable-records", "a done opus with a bad value too");
  assert.equal(run(bad("lots", "halted")).kind, "estimate", "a halted opus is not planned, so its value is not read");
  assert.equal(run(fixture(), 1).reason, "unreadable-records", "an unreadable record the reader skipped");
  assert.equal(run(fixture(), 0).kind, "estimate");
  const allDone = fixture().map((o) => (o.state === "backlog" || o.state === "greenlit" || o.state === "building" || o.state === "review" ? { ...o, state: "done" } : o));
  assert.equal(run(allDone, 1).reason, "unreadable-records", "never a false Nothing left");
});

test("W-153-b2 behaviour 2: a non-finite or non-numeric point value never makes a meter field non-finite", () => {
  const opera = [...fixture().filter((o) => o.id !== "W-11"), { id: "W-11", state: "backlog", milestone: "M1", value: Number.POSITIVE_INFINITY }, { id: "W-17", state: "done", milestone: "M1", value: Number.NaN }];
  const meter = computeMeter({ milestones, opera, findings: [] });
  for (const f of [meter.overall, ...meter.rows.flatMap((r) => [r.done, r.planned, r.pct])]) assert.ok(Number.isFinite(f), `${String(f)} is finite`);
});

test("W-153-b3 behaviour 3: a non-finite value on a dated done opus, or a non-finite weight, gives No estimate with every numeric field finite", () => {
  const finite = (e: ReturnType<typeof estimateFinish>): void => {
    for (const [k, v] of Object.entries(e)) {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} is finite`);
    }
    for (const w of e.weekly) assert.ok(Number.isFinite(w), "every weekly field is finite");
  };
  const run = (opera: Opus[], ms = milestones) => {
    let got: ReturnType<typeof estimateFinish> | undefined;
    assert.doesNotThrow(() => {
      got = estimateFinish({ meter: computeMeter({ milestones: ms, opera, findings: [] }), opera, now: NOW });
    });
    return got as ReturnType<typeof estimateFinish>;
  };
  finite(run(fixture()));
  for (const value of [Number.POSITIVE_INFINITY, Number.NaN, -5]) {
    const e = run([...fixture().filter((o) => o.id !== "W-1"), done("W-1", value, "2026-10-05T10:00:00Z")]);
    assert.equal(e.kind, "none", `a dated done ${String(value)}`);
    assert.equal(e.reason, "unreadable-records");
    finite(e);
  }
  const infinite = [{ ...milestones[0]!, weight: Number.POSITIVE_INFINITY }];
  const e = run(fixture(), infinite);
  assert.equal(e.reason, "unreadable-records", "a non-finite weight");
  finite(e);
  const meter = computeMeter({ milestones: infinite, opera: fixture(), findings: [] });
  for (const r of meter.rows) for (const [k, v] of Object.entries(r)) if (typeof v === "number") assert.ok(Number.isFinite(v), `meter row ${k} is finite`);
  assert.ok(Number.isFinite(meter.overall), "overall is finite");
});

/** Every number at any depth of `v` is finite, and nothing is null (JSON writes a non-finite number as null). */
function assertAllFinite(v: unknown, path = "response"): void {
  if (typeof v === "number") assert.ok(Number.isFinite(v), `${path} is finite`);
  else if (v === null) assert.fail(`${path} is null`);
  else if (Array.isArray(v)) v.forEach((x, i) => assertAllFinite(x, `${path}[${i}]`));
  else if (typeof v === "object") for (const [k, x] of Object.entries(v as object)) assertAllFinite(x, `${path}.${k}`);
}

test("W-153-b3 behaviour 3: a value or weight outside the milestone domain gives No estimate, and the whole response stays finite", () => {
  const two = (w1: number, w2: number) => [
    { id: "M1", title: "One", weight: w1, exit: { needs: "x" } },
    { id: "M2", title: "Two", weight: w2, exit: { needs: "x" } },
  ];
  const withOpus = (value: number, state = "backlog"): Opus[] => [...fixture().filter((o) => o.id !== "W-11"), { id: "W-11", state, milestone: "M1", value }];
  const huge = [...fixture(), { id: "W-30", state: "backlog", milestone: "M1", value: 1e308 }, { id: "W-31", state: "backlog", milestone: "M1", value: 1e308 }];
  const cases: [string, Opus[], typeof milestones][] = [
    ["value 0", withOpus(0), two(50, 50)],
    ["value 4", withOpus(4), two(50, 50)],
    ["a done value 4", withOpus(4, "done"), two(50, 50)],
    ["a huge value", huge, two(50, 50)],
    ["a fractional weight", fixture(), two(33.5, 66.5)],
    ["a negative weight", fixture(), two(-10, 110)],
    ["weights totalling 99", fixture(), two(49, 50)],
  ];
  const ok = estimateFinish({ meter: computeMeter({ milestones: two(50, 50), opera: fixture(), findings: [] }), opera: fixture(), now: NOW });
  assert.equal(ok.kind, "estimate", "control: a valid domain has an estimate");
  assertAllFinite({ meter: computeMeter({ milestones: two(50, 50), opera: fixture(), findings: [] }), estimate: ok });
  for (const [what, opera, ms] of cases) {
    const meter = computeMeter({ milestones: ms, opera, findings: [] });
    const estimate = estimateFinish({ meter, opera, now: NOW });
    assert.equal(estimate.kind, "none", what);
    assert.equal(estimate.reason, "unreadable-records", what);
    assertAllFinite({ meter, estimate });
  }
});
