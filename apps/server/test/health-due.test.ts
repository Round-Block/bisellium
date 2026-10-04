/**
 * W-077 behaviour 3: `/api/health` names every due item. A tick-written
 * `health.json` carries `due` as `{kind, sella}`, `{kind, period}`, `{kind, opus}`
 * and `{kind, models}`; the Store's read path maps it onto the declared
 * `{kind, id}` shape and never writes the file. Select the behaviour with
 * `--behaviour 3`; omitting the selector runs it too. node:test TAP.
 *
 * Run from the repo root:
 *   node --test-reporter=tap --import tsx apps/server/test/health-due.test.ts --behaviour 3
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && only !== 3) {
  console.error("health-due.test.ts: --behaviour must be 3");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(HERE, "..", "..", "..", "examples", "sample-studio");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

if (only === undefined || only === 3) {
  test("W-077 behaviour 3: /api/health names every due item", () => {
    const studioDir = mkdtempSync(join(tmpdir(), "bisellium-w077-3-"));
    dirs.push(studioDir);
    cpSync(SAMPLE, studioDir, { recursive: true });
    const at = "2026-09-25T09:35:43.947Z";
    const file = JSON.stringify({
      at,
      ok: false,
      blocks: 1,
      advisories: 3,
      findingsByRule: {},
      autonomy: { paused: false },
      lastTick: at,
      due: [
        { kind: "daily", sella: "producer" },
        { kind: "aerarium", period: "2026-W39" },
        { kind: "traditio", opus: "W-002" },
        { kind: "probe", models: [{}, {}] },
        { kind: "x" },
        { kind: "traditio", id: "W-003" },
      ],
    });
    const path = join(studioDir, "health.json");
    writeFileSync(path, file);
    let checked = 0;
    const stub = (): { ok: boolean; blocks: number; advisories: number; findings: unknown[] } => {
      checked++;
      return { ok: true, blocks: 0, advisories: 0, findings: [] };
    };
    const store = new Store({ studioDir, now: new Date("2026-10-04T22:05:54Z") });
    const got = store.api.health(stub) as { at: string; due: unknown[] };
    assert.deepEqual(got.due, [
      { kind: "daily", id: "producer" },
      { kind: "aerarium", id: "2026-W39" },
      { kind: "traditio", id: "W-002" },
      { kind: "probe", id: "2 pair(s)" },
      { kind: "x", id: "unknown" },
      { kind: "traditio", id: "W-003" },
    ]);
    assert.equal(got.at, at, "at is the file's own");
    assert.equal(checked, 0, "the stub checkStudio is never called while the file parses");
    assert.equal(readFileSync(path, "utf8"), file, "the file's bytes are unchanged");

    writeFileSync(path, JSON.stringify({ at, ok: true, blocks: 0, advisories: 0, findingsByRule: {}, autonomy: { paused: false }, lastTick: at, due: "nope" }));
    assert.deepEqual((store.api.health(stub) as { due: unknown }).due, [], "a non-array due becomes []");
    assert.equal(checked, 0);
  });
}
