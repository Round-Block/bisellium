/**
 * Tests for `bisellium tick` and `bisellium pause`/`resume` (W-011), against
 * a temp copy of examples/sample-studio. `now` is pinned so cadence
 * ("today's" daily, the current ISO week) never drifts. Most non-dry-run
 * ticks here inject a fake `talk` via `opts.talk`, so they don't depend on
 * builder A's packages/cli/src/talk.ts existing or behaving a particular
 * way. One scenario ("real seam", below) deliberately omits `opts.talk` to
 * exercise tick's real lazy dynamic import of ./talk.js end to end, routed
 * through the offline 'fake' harness profile so it never touches a real
 * vendor CLI.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkStudio } from "./check.js";
import { runPause, runResume } from "./pause.js";
import { computeDue, harnessForSella, runTick, MAX_PROBE_TURNS_PER_RUN, type DueProbe, type TalkCallOptions, type TalkCallResult } from "./tick.js";
import { readManifest } from "@bisellium/adapter-native";
import { gatherCandidates, probeBattery, readModelsRecord, runProbe, type Candidate } from "@bisellium/commands/probe.js";
import type { HarnessProfile, Turn } from "@bisellium/shim";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T14:00:00Z");

/** W-071's own numbered behaviours (1-4) live alongside this file's
 *  pre-existing (W-011) bare-name checks; `--behaviour N` (delegate.test.ts/
 *  probe.test.ts convention) only gates these. */
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail}`);
  if (!ok) failed++;
};
function checkB(behaviour: number, name: string, ok: boolean, detail = ""): void {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  b${behaviour} ${name.padEnd(88)} ${detail}`);
  if (!ok) failed++;
}
function runs(behaviour: number): boolean {
  return only === undefined || only === behaviour;
}

/** Seeds a `models.json` where every seated (model, harness) pair is already
 *  `available` as of `NOW` — so pre-W-071 scenarios (which know nothing
 *  about the probe cadence) see no probe-due item and their assertions stay
 *  exactly what they were before this opus. Behaviour 1-4's own tests
 *  overwrite this file with the specific fixture their case needs. */
function seedFreshModels(dir: string, now: Date): void {
  const manifest = readManifest(dir);
  const seen = new Set<string>();
  const models: unknown[] = [];
  for (const row of manifest.sellae) {
    if (!row.model) continue;
    const harness = harnessForSella(row);
    const key = `${row.model}\u0000${harness}`;
    if (seen.has(key)) continue;
    seen.add(key);
    models.push({ id: row.model, state: "available", harness, probes: [{ harness, state: "available", at: now.toISOString() }] });
  }
  writeFileSync(join(dir, "models.json"), JSON.stringify({ schema: 1, at: now.toISOString(), harnessVersions: {}, models }, null, 2) + "\n");
}

function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-tick-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  seedFreshModels(dir, NOW);
  return dir;
}

/** No live vendor turn, and no dependence on an installed vendor binary, in
 *  any pre-existing (non-probe) scenario (W-071 house rule) — every
 *  `runTick` call spreads this in so neither `codexListModels` nor
 *  `harnessVersions` is ever reached for real. */
const NO_PROBE = { listModels: async () => [], versions: async () => ({}) };

/** Appends extra `codex`-harness sellae to `dir`'s manifest, alongside the
 *  studio's original (already-seeded-fresh, via `freshStudio`) seven — so a
 *  behaviour-1-4 test controls exactly which pairs are probe-due without
 *  disturbing the daily/aerarium fixtures the rest of this file relies on.
 *  Each gets its own single-row `models.json` entry only if the caller adds
 *  one; by default a freshly-added id has no prior probe at all. */
function addCodexSellae(dir: string, ids: string[]): void {
  const manifestPath = join(dir, "bisellium.yml");
  const raw = readFileSync(manifestPath, "utf8");
  const rows = ids.map((id) => `  - { id: ${id}-sella, collegium: engineering, kind: agent, model: ${id}, harness: codex }\n`).join("");
  const patched = raw.replace("sellae:\n", `sellae:\n${rows}`);
  writeFileSync(manifestPath, patched);
}

/** A `codex` harness stub that always succeeds a turn — for the behaviours
 *  that need a real (spend a turn, advance state) probe run, never a real
 *  vendor binary. */
function fakeAvailableProfile(): HarnessProfile {
  return {
    id: "codex",
    tier: 2,
    available: async () => true,
    start: async (): Promise<Turn> => ({ sessionId: "s", reply: "OK", exitCode: 0 }),
    resume: async () => {
      throw new Error("probe must never call resume");
    },
  };
}

/** examples/sample-studio's collegia declare no `autonomy` at all (default
 *  L1) — this forces every row to a given level on disk, for a scenario
 *  that drives the gate through `runTick` (a real manifest read), not just
 *  through an in-memory `Manifest` object like the pre-existing L0 test
 *  above. */
function setAllCollegiaAutonomy(dir: string, level: string): void {
  const manifestPath = join(dir, "bisellium.yml");
  const lines = readFileSync(manifestPath, "utf8").split("\n");
  let inBlock = false;
  const out = lines.map((line) => {
    if (/^collegia:/.test(line)) {
      inBlock = true;
      return line;
    }
    if (inBlock && /^\S/.test(line)) {
      inBlock = false;
      return line;
    }
    if (inBlock && /^\s*-\s*\{.*\}\s*$/.test(line)) return line.replace(/\}\s*$/, `, autonomy: ${level} }`);
    return line;
  });
  writeFileSync(manifestPath, out.join("\n"));
}

/** Captures console.log/error output across an async call, restoring both afterward even on throw. */
async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[]; errs: string[] }> {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => errs.push(a.map(String).join(" "));
  try {
    const result = await fn();
    return { result, logs, errs };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

const fakeTalk = async (opts: TalkCallOptions): Promise<TalkCallResult> => ({
  reply: `${opts.sella} status stable (${opts.harness})\nnothing blocked\nsee you tomorrow`,
});

const dirs: string[] = [];
function track(dir: string): string {
  dirs.push(dir);
  return dir;
}

try {
  // ---- dry-run lists dailies due, nothing else at the pinned clock -------
  {
    const dir = track(freshStudio("dryrun"));
    const { result, logs } = await capture(() => runTick(["--studio", dir, "--dry-run"], { now: NOW, ...NO_PROBE }));
    check("dry-run: exit 0", result.exitCode === 0, `exitCode=${result.exitCode}`);
    for (const sella of ["producer", "eng-lead", "art-lead", "qa-lead"]) {
      check(`dry-run: lists daily due for ${sella}`, logs.some((l) => l.includes("daily") && l.includes(sella)));
    }
    check("dry-run: no aerarium due (current week's file exists)", !logs.some((l) => l.includes("aerarium")));
    check("dry-run: no traditio due (all handoffs fresh)", !logs.some((l) => l.includes("traditio")));
    check(
      "dry-run: no acta files written",
      readdirSync(join(dir, "acta")).filter((f) => f.includes("-daily.md") && !f.startsWith("2026-09-17")).length === 0,
    );
  }

  // ---- harnessForSella: manifest default vs. an explicit override --------
  {
    check("harnessForSella: defaults to claude-code when unset", harnessForSella({}) === "claude-code");
    check("harnessForSella: honors an explicit override", harnessForSella({ harness: "codex" }) === "codex");
  }

  // ---- computeDue directly: L0 collegium is never due ---------------------
  {
    const dir = track(freshStudio("l0"));
    const manifest = readManifest(dir);
    manifest.collegia = manifest.collegia.map((c) => (c.id === "art" ? { ...c, autonomy: "L0" } : c));
    const due = computeDue(dir, manifest, NOW);
    check("computeDue: L0 collegium's magister not due", !due.some((d) => d.kind === "daily" && d.sella === "art-lead"));
    check("computeDue: L1 (default) collegium's magister still due", due.some((d) => d.kind === "daily" && d.sella === "eng-lead"));
  }

  // ---- pause: tick does only the health snapshot, lists nothing ----------
  {
    const dir = track(freshStudio("paused"));
    await capture(() => runPause(["--studio", dir, "--reason", "investigating a bad deploy"], { now: NOW }));
    check("pause: writes PAUSED", existsSync(join(dir, "PAUSED")));

    const before = readdirSync(join(dir, "acta"));
    const { result, logs } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: fakeTalk, ...NO_PROBE }));
    check("paused tick: exit 0 (check passes)", result.exitCode === 0, `exitCode=${result.exitCode}`);
    check(
      "paused tick: prints 'paused since ... : ...'",
      logs.some((l) => l.startsWith("paused since") && l.includes("investigating a bad deploy")),
      logs.join(" | "),
    );
    check("paused tick: no daily due lines printed", !logs.some((l) => l.includes("due: daily")));
    check("paused tick: no new acta written", readdirSync(join(dir, "acta")).length === before.length);
    check("paused tick: no receipt written", !existsSync(join(dir, "receipts", "tick")));
    check("paused tick: still writes health.json", existsSync(join(dir, "health.json")));

    await capture(() => runResume(["--studio", dir]));
    check("resume: removes PAUSED", !existsSync(join(dir, "PAUSED")));
  }

  // ---- health.json shape, including findingsByRule ------------------------
  {
    const dir = track(freshStudio("health"));
    const { result } = await capture(() => runTick(["--studio", dir, "--dry-run"], { now: NOW, ...NO_PROBE }));
    check("health tick: exit 0", result.exitCode === 0);
    const healthPath = join(dir, "health.json");
    check("health.json written", existsSync(healthPath));
    const health = JSON.parse(readFileSync(healthPath, "utf8")) as {
      at: string;
      ok: boolean;
      blocks: number;
      advisories: number;
      findingsByRule: Record<string, number>;
      autonomy: { paused: boolean; since?: string; reason?: string };
      lastTick: string;
      due: unknown[];
    };
    const expected = checkStudio(dir, NOW);
    check("health.json: ok matches check", health.ok === expected.ok, `${health.ok} vs ${expected.ok}`);
    check("health.json: blocks matches check", health.blocks === expected.blocks);
    check("health.json: advisories matches check", health.advisories === expected.advisories);
    check(
      "health.json: findingsByRule counts acta.daily = 5",
      health.findingsByRule["acta.daily"] === 5,
      JSON.stringify(health.findingsByRule),
    );
    check("health.json: autonomy.paused is false", health.autonomy.paused === false);
    check("health.json: due lists 5 dailies", Array.isArray(health.due) && health.due.length === 5, JSON.stringify(health.due));
    check("health.json: lastTick set", health.lastTick === health.at);
  }

  // ---- invalid autonomy value blocks in check ------------------------------
  {
    const dir = track(freshStudio("badautonomy"));
    const manifestPath = join(dir, "bisellium.yml");
    const raw = readFileSync(manifestPath, "utf8");
    const patched = raw.replace(
      "{ id: art, name: Art, magister: art-lead, lex: leges/art.md }",
      "{ id: art, name: Art, magister: art-lead, lex: leges/art.md, autonomy: L9 }",
    );
    check("test setup: manifest actually patched", patched !== raw);
    writeFileSync(manifestPath, patched);
    const r = checkStudio(dir, NOW);
    check(
      "check: invalid collegium.autonomy blocks",
      r.findings.some((f) => f.rule === "collegium.autonomy" && f.level === "block"),
      r.findings.map((f) => f.rule).join(", "),
    );
    check("check: overall not ok", !r.ok);
  }

  // ---- fake talk: non-dry-run writes an acta per due daily -----------------
  {
    const dir = track(freshStudio("write"));
    const before = readdirSync(join(dir, "acta"));
    const { result, logs } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: fakeTalk, ...NO_PROBE }));
    check("write tick: exit 0", result.exitCode === 0, `exitCode=${result.exitCode} logs=${logs.join(" | ")}`);

    const after = readdirSync(join(dir, "acta"));
    const added = after.filter((f) => !before.includes(f));
    check("write tick: one acta per due magister", added.length === 5, added.join(", "));

    const engPath = join(dir, "acta", "2026-09-18-eng-lead-daily.md");
    check("write tick: eng-lead daily written at expected path", existsSync(engPath));
    if (existsSync(engPath)) {
      const text = readFileSync(engPath, "utf8");
      check("write tick: author is eng-lead", /author: ["']?eng-lead/.test(text), text.split("\n")[1]);
      check("write tick: kind is daily", text.includes("kind: daily"));
      check("write tick: evidence points at bisellium.yml (never dead in a clone)", text.includes("href: bisellium.yml"));
      check("write tick: body carries the fake reply", text.includes("status stable"));
      check("write tick: harness defaults to claude-code (sample-studio sets none)", text.includes("(claude-code)"), text);
    }

    check("write tick: receipt written under receipts/tick/", existsSync(join(dir, "receipts", "tick")) && readdirSync(join(dir, "receipts", "tick")).length > 0);

    // Re-running the same tick should find nothing left due (idempotent).
    const { result: second, logs: secondLogs } = await capture(() => runTick(["--studio", dir, "--dry-run"], { now: NOW, ...NO_PROBE }));
    check("write tick: second dry-run has nothing due", second.exitCode === 0 && secondLogs.some((l) => l.includes("nothing due")), secondLogs.join(" | "));
  }

  // ---- tick redacts the daily title/body before writing acta ------------
  {
    const dir = track(freshStudio("redact"));
    const secret = "abcdef0123456789abcdef0123456789";
    const secretTalk = async (opts: TalkCallOptions): Promise<TalkCallResult> => ({
      reply: `deploy token=${secret} status stable\nnothing blocked\nsee you tomorrow`,
    });
    const { result } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: secretTalk, ...NO_PROBE }));
    check("redact: exit 0", result.exitCode === 0, `exitCode=${result.exitCode}`);
    const engPath = join(dir, "acta", "2026-09-18-eng-lead-daily.md");
    check("redact: eng-lead daily written", existsSync(engPath));
    if (existsSync(engPath)) {
      const text = readFileSync(engPath, "utf8");
      check("redact: no raw secret in the acta file", !text.includes(secret), text);
      check("redact: title/body carry the masked form", text.includes("token=***"), text);
    }
  }

  // ---- tick idempotence: a daily whose filename already matches today, even
  // with a corrupt `at`, still counts — no second talk call, no overwrite --
  {
    const dir = track(freshStudio("corrupt-at"));
    const corruptPath = join(dir, "acta", "2026-09-18-eng-lead-daily.md");
    const corruptBody = `---\nauthor: "eng-lead"\nkind: "daily"\ntitle: "already filed"\nat: "not-a-real-date"\n---\nAlready filed today, before tick ran.\n`;
    writeFileSync(corruptPath, corruptBody);

    let talkCalls = 0;
    const countingTalk = async (opts: TalkCallOptions): Promise<TalkCallResult> => {
      talkCalls++;
      return { reply: `${opts.sella} status stable (${opts.harness})\nnothing blocked\nsee you tomorrow` };
    };
    // A corrupt `at` is itself a check.ts blocking finding (acta.at) —
    // independent of tick's own idempotence logic under test here, so this
    // doesn't assert tick's overall exit code, only that it never re-talks
    // to or overwrites the sella whose daily filename already exists today.
    const { logs } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: countingTalk, ...NO_PROBE }));
    check("corrupt-at: eng-lead not called again (file untouched)", readFileSync(corruptPath, "utf8") === corruptBody);
    check("corrupt-at: eng-lead not counted as talked-to", !logs.some((l) => l.includes("eng-lead") && l.startsWith("wrote")));
    check("corrupt-at: the other four magistri were still talked to", talkCalls === 4, String(talkCalls));
  }

  // ---- aerarium due is computed in the manifest's timezone, not UTC ------
  // sample-studio's timezone is Europe/London. 2026-09-20T23:30:00Z is
  // Sunday in UTC (still ISO week 38, matching the committed
  // aerarium/2026-W38.yml) but Monday 2026-09-21 00:30 BST in London — ISO
  // week 39, which has no aerarium file yet and so must be due.
  {
    const dir = track(freshStudio("tz-aerarium"));
    const nearMidnightUTC = new Date("2026-09-20T23:30:00Z");
    const manifest = readManifest(dir);
    check("tz-aerarium: sample-studio timezone is Europe/London", manifest.timezone === "Europe/London", manifest.timezone);
    const due = computeDue(dir, manifest, nearMidnightUTC);
    check(
      "tz-aerarium: 2026-W39 (London-local week) is due",
      due.some((d) => d.kind === "aerarium" && d.period === "2026-W39"),
      JSON.stringify(due.filter((d) => d.kind === "aerarium")),
    );
    check(
      "tz-aerarium: 2026-W38 (UTC week, already on disk) is not due",
      !due.some((d) => d.kind === "aerarium" && d.period === "2026-W38"),
      JSON.stringify(due.filter((d) => d.kind === "aerarium")),
    );
  }

  // ---- real seam: no injected opts.talk — tick must reach the real
  // ./talk.js (talk.ts's exported `talkOnce`) via its lazy dynamic import.
  // Pointed at the 'fake' harness (packages/shim/src/harness/fake.ts, which
  // shells out to the offline packages/shim/test/fake-harness.mjs) so this
  // stays hermetic while still exercising the production code path a real
  // cron'd tick uses. This is the seam the verifier found broken: every
  // other non-dry-run tick above injects `opts.talk` and never touches it.
  {
    const dir = track(freshStudio("realseam"));
    const manifestPath = join(dir, "bisellium.yml");
    const raw = readFileSync(manifestPath, "utf8");
    const patched = raw
      .replace(
        "{ id: producer, collegium: production, kind: orchestrator, model: claude-opus-5 }",
        "{ id: producer, collegium: production, kind: orchestrator, model: claude-opus-5, harness: fake }",
      )
      .replace(
        "{ id: architect, collegium: design, kind: agent, model: claude-opus-5 }",
        "{ id: architect, collegium: design, kind: agent, model: claude-opus-5, harness: fake }",
      )
      .replace(
        "{ id: eng-lead, collegium: engineering, kind: agent, model: claude-opus-5 }",
        "{ id: eng-lead, collegium: engineering, kind: agent, model: claude-opus-5, harness: fake }",
      )
      .replace(
        "{ id: art-lead, collegium: art, kind: agent, model: gpt-6-astra }",
        "{ id: art-lead, collegium: art, kind: agent, model: gpt-6-astra, harness: fake }",
      )
      .replace(
        "{ id: qa-lead, collegium: qa, kind: agent, model: claude-sonnet-5 }",
        "{ id: qa-lead, collegium: qa, kind: agent, model: claude-sonnet-5, harness: fake }",
      );
    // Counts ", harness: fake }" occurrences directly rather than asserting
    // no bare "model: claude-opus-5 }" survives — D-023's tiers (W-065) added
    // a `review` tier holder of exactly that model, unrelated to any sella,
    // which made the old substring-absence check a false negative.
    const harnessFakeCount = (patched.match(/, harness: fake \}/g) ?? []).length;
    check("real seam setup: all five magistri patched to harness: fake", patched !== raw && harnessFakeCount === 5, `${harnessFakeCount}`);
    writeFileSync(manifestPath, patched);
    // Reseed: freshStudio()'s models.json was seeded against the PRE-patch
    // harnesses — refresh it against the now-patched manifest so this
    // scenario's own real (non-injected) `probeBattery` never sees a due
    // pair (harness "fake" has no registered profile; a due pair here
    // would still cost zero turns, but would also reach the REAL
    // `codexListModels`, which `opts.probe` is deliberately not stubbed to
    // avoid — this test's whole point is the real dynamic ./talk.js import).
    seedFreshModels(dir, NOW);

    const before = readdirSync(join(dir, "acta"));
    const { result, errs } = await capture(() => runTick(["--studio", dir], { now: NOW, ...NO_PROBE }));
    check("real seam: exit 0", result.exitCode === 0, `exitCode=${result.exitCode} errs=${errs.join(" | ")}`);

    const after = readdirSync(join(dir, "acta"));
    const added = after.filter((f) => !before.includes(f));
    check("real seam: one acta per due magister actually written", added.length === 5, added.join(", "));

    const engPath = join(dir, "acta", "2026-09-18-eng-lead-daily.md");
    check("real seam: eng-lead daily written at expected path", existsSync(engPath));
    if (existsSync(engPath)) {
      const text = readFileSync(engPath, "utf8");
      check("real seam: body carries the real fake-harness reply", text.includes("FAKE:"), text);
    }
    check(
      "real seam: receipt written under receipts/tick/",
      existsSync(join(dir, "receipts", "tick")) && readdirSync(join(dir, "receipts", "tick")).length > 0,
    );
  }

  // =========================================================================
  // W-071 behaviour 1: computeDue gains a `probe` kind — pure, synchronous,
  // injected, built on W-069's exported readModelsRecord/gatherCandidates,
  // threshold configurable.
  // =========================================================================
  if (runs(1)) {
    const dir = track(freshStudio("w071-b1"));
    addCodexSellae(dir, ["codex-noprobe", "codex-stale", "codex-fresh"]);
    const staleAt = new Date(NOW.getTime() - 10 * 86_400_000).toISOString(); // 10 days > default 7
    const freshAt = new Date(NOW.getTime() - 1 * 86_400_000).toISOString(); // 1 day < default 7
    const rec = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
    rec.models.push(
      { id: "codex-stale", state: "unverified", harness: "codex", probes: [{ harness: "codex", state: "unverified", at: staleAt }] },
      { id: "codex-fresh", state: "unverified", harness: "codex", probes: [{ harness: "codex", state: "unverified", at: freshAt }] },
    );
    writeFileSync(join(dir, "models.json"), JSON.stringify(rec, null, 2) + "\n");
    const manifest = readManifest(dir);

    checkB(
      1,
      "no ProbeInputs (the existing 3-arg call) emits no probe item",
      !computeDue(dir, manifest, NOW).some((d) => d.kind === "probe"),
    );

    const record = readModelsRecord(dir);
    const due = computeDue(dir, manifest, NOW, { listing: [], versions: {}, record });
    const probeItem = due.find((d): d is DueProbe => d.kind === "probe");
    checkB(1, "a pair with no HarnessProbe at all is due", !!probeItem?.models.some((m) => m.id === "codex-noprobe"));
    checkB(1, "a pair whose at is older than the threshold is due", !!probeItem?.models.some((m) => m.id === "codex-stale"));
    checkB(1, "a fresh pair is not due", !probeItem?.models.some((m) => m.id === "codex-fresh"));

    const candidates = gatherCandidates({ studio: dir, listing: [] });
    checkB(
      1,
      "the due set is a subset of gatherCandidates' own union",
      (probeItem?.models ?? []).every((m) => candidates.some((c) => c.id === m.id && c.harness === m.harness)),
    );

    // A declared override, asserted against a value that flips a genuinely
    // fresh pair to due.
    const overridden = { ...manifest, defaults: { ...(manifest.defaults ?? {}), model_probe_stale_days: 0.5 } };
    const dueOverride = computeDue(dir, overridden, NOW, { listing: [], versions: {}, record });
    checkB(
      1,
      "a declared model_probe_stale_days override flips a fresh pair to due",
      !!dueOverride.find((d): d is DueProbe => d.kind === "probe")?.models.some((m) => m.id === "codex-fresh"),
    );

    // runTick's own async gather, formatDue and health.json wiring.
    let listCalled = false;
    let versionsCalled = false;
    const { logs: dryLogs } = await capture(() =>
      runTick(["--studio", dir, "--dry-run"], {
        now: NOW,
        listModels: async () => {
          listCalled = true;
          return [];
        },
        versions: async () => {
          versionsCalled = true;
          return {};
        },
      }),
    );
    checkB(1, "runTick gathers through opts.listModels", listCalled);
    checkB(1, "runTick gathers through opts.versions", versionsCalled);
    checkB(1, "formatDue renders 'due: probe — N pair(s)'", dryLogs.some((l) => /due: probe — 2 pair\(s\)/.test(l)), dryLogs.join(" | "));

    const health = JSON.parse(readFileSync(join(dir, "health.json"), "utf8")) as { due: { kind: string }[] };
    checkB(1, "health.json's due array carries the probe item", health.due.some((d) => d.kind === "probe"), JSON.stringify(health.due));

    // Positive control: a rejecting listing still yields the manifest-derived due pairs.
    const { logs: rejectLogs } = await capture(() =>
      runTick(["--studio", dir, "--dry-run"], {
        now: NOW,
        listModels: async () => {
          throw new Error("listing failed");
        },
        versions: async () => ({}),
      }),
    );
    checkB(1, "a rejecting listing still yields the manifest-derived due pairs", rejectLogs.some((l) => l.includes("due: probe")), rejectLogs.join(" | "));
  }

  // =========================================================================
  // W-071 behaviour 2: the version trigger is per-pair, defined-vs-defined
  // only, and it cannot strand a capped run.
  // =========================================================================
  if (runs(2)) {
    // (a)-(d): four combinations, one small fixture.
    {
      const dir = track(freshStudio("w071-b2-abcd"));
      addCodexSellae(dir, ["codex-v1", "codex-noversion", "codex-noversion-stale"]);
      const fresh = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
      const stale = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
      const rec = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
      rec.models.push(
        { id: "codex-v1", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: fresh, harnessVersion: "1.0.0" }] },
        { id: "codex-noversion", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: fresh }] },
        { id: "codex-noversion-stale", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: stale }] },
      );
      writeFileSync(join(dir, "models.json"), JSON.stringify(rec, null, 2) + "\n");
      const manifest = readManifest(dir);

      // (a) recorded vs live differ -> due though fresh; claude pairs untouched.
      const dueA = computeDue(dir, manifest, NOW, { listing: [], versions: { codex: "2.0.0" }, record: readModelsRecord(dir) });
      const probeA = dueA.find((d): d is DueProbe => d.kind === "probe");
      checkB(2, "(a) recorded-vs-live version differ -> due though at is fresh", !!probeA?.models.some((m) => m.id === "codex-v1"));
      checkB(2, "(a) positive control: the fresh claude-code pairs are not due in the same run", !probeA?.models.some((m) => m.harness === "claude-code"));

      // (b) equal defined versions -> not due; a genuinely stale pair (equal
      // version) still fires via age.
      writeFileSync(
        join(dir, "models.json"),
        JSON.stringify(
          { ...rec, models: rec.models.map((m: { id: string; probes: { harnessVersion?: string }[] }) => (m.id === "codex-noversion-stale" ? { ...m, probes: [{ ...m.probes[0], harnessVersion: "1.0.0" }] } : m)) },
          null,
          2,
        ) + "\n",
      );
      const dueB = computeDue(dir, manifest, NOW, { listing: [], versions: { codex: "1.0.0" }, record: readModelsRecord(dir) });
      const probeB = dueB.find((d): d is DueProbe => d.kind === "probe");
      checkB(2, "(b) equal defined versions -> not due", !probeB?.models.some((m) => m.id === "codex-v1"));
      checkB(2, "(b) positive control: a genuinely stale pair still fires via age even with an equal version", !!probeB?.models.some((m) => m.id === "codex-noversion-stale"));

      // (c) live undefined (call failed) -> never fires.
      const dueC = computeDue(dir, manifest, NOW, { listing: [], versions: {}, record: readModelsRecord(dir) });
      const probeC = dueC.find((d): d is DueProbe => d.kind === "probe");
      checkB(2, "(c) live version undefined -> no version trigger", !probeC?.models.some((m) => m.id === "codex-v1"));

      // ...and the recorded per-pair value survives a battery that never
      // reaches it (unknown harness -> noTurnProbe carries it forward).
      await probeBattery({ studio: dir, now: NOW, only: [{ id: "codex-v1", harness: "codex" }], harnesses: {}, versions: async () => ({}), listModels: async () => [] });
      const survived = JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as { models: { id: string; probes: { harnessVersion?: string }[] }[] };
      const survivedEntry = survived.models.find((m) => m.id === "codex-v1");
      checkB(2, "(c) the recorded per-pair harnessVersion survives the following battery", survivedEntry?.probes?.[0]?.harnessVersion === "1.0.0", JSON.stringify(survivedEntry));

      // (d) no recorded harnessVersion at all -> no version trigger; a
      // genuinely stale such pair is drawn in by AGE instead, not version.
      const dueD = computeDue(dir, manifest, NOW, { listing: [], versions: { codex: "2.0.0" }, record: readModelsRecord(dir) });
      const probeD = dueD.find((d): d is DueProbe => d.kind === "probe");
      checkB(2, "(d) a fresh pair with no recorded harnessVersion is not version-due", !probeD?.models.some((m) => m.id === "codex-noversion"));
    }

    // (e) the stranding interleaving — the heart of the opus.
    {
      const dir = track(freshStudio("w071-b2e"));
      const ids = ["codex-e1", "codex-e2", "codex-e3", "codex-e4", "codex-e5"];
      addCodexSellae(dir, ids);
      const fresh = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
      const rec = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
      for (const id of ids) rec.models.push({ id, state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: fresh, harnessVersion: "1.0.0" }] });
      writeFileSync(join(dir, "models.json"), JSON.stringify(rec, null, 2) + "\n");
      const manifest = readManifest(dir);
      const liveVersions = { codex: "2.0.0" };

      const due1 = computeDue(dir, manifest, NOW, { listing: [], versions: liveVersions, record: readModelsRecord(dir) });
      const probe1 = due1.find((d): d is DueProbe => d.kind === "probe");
      checkB(2, "(e) all 5 version-changed pairs are due despite a fresh at", ids.every((id) => probe1?.models.some((m) => m.id === id)), JSON.stringify(probe1?.models.map((m) => m.id)));

      const run1 = await probeBattery({
        studio: dir,
        now: NOW,
        only: probe1?.models ?? [],
        maxTurns: 2,
        harnesses: { codex: fakeAvailableProfile() },
        versions: async () => liveVersions,
        listModels: async () => [],
      });
      checkB(2, "(e) run one probes 2 and skips 3", run1.turns === 2 && run1.skipped.length === 3, JSON.stringify({ turns: run1.turns, skipped: run1.skipped.map((c) => c.id) }));

      const skippedIds = run1.skipped.map((c) => c.id);
      const due2 = computeDue(dir, manifest, NOW, { listing: [], versions: liveVersions, record: readModelsRecord(dir) });
      const probe2 = due2.find((d): d is DueProbe => d.kind === "probe");
      checkB(
        2,
        "(e) a second computeDue still reports exactly the 3 skipped pairs due — not stranded",
        probe2 !== undefined && probe2.models.length === 3 && skippedIds.every((id) => probe2.models.some((m) => m.id === id)),
        JSON.stringify(probe2?.models.map((m) => m.id)),
      );

      const run2 = await probeBattery({
        studio: dir,
        now: NOW,
        only: probe2?.models ?? [],
        harnesses: { codex: fakeAvailableProfile() },
        versions: async () => liveVersions,
        listModels: async () => [],
      });
      checkB(
        2,
        "(e) run two probes exactly the 3 stranding would have lost",
        run2.skipped.length === 0 && skippedIds.every((id) => run2.record.models.find((m) => m.id === id)?.state === "available"),
        JSON.stringify(run2.skipped),
      );

      const due3 = computeDue(dir, manifest, NOW, { listing: [], versions: liveVersions, record: readModelsRecord(dir) });
      checkB(2, "after a complete battery, a second computeDue yields no probe item", !due3.some((d) => d.kind === "probe"), JSON.stringify(due3));
    }

    // (f) the top-level snapshot is not the trigger.
    {
      const dir = track(freshStudio("w071-b2f"));
      addCodexSellae(dir, ["codex-f1"]);
      const fresh = new Date(NOW.getTime() - 1 * 86_400_000).toISOString();
      const rec = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
      rec.harnessVersions = { codex: "2.0.0" }; // equals live, below
      rec.models.push({ id: "codex-f1", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: fresh, harnessVersion: "1.0.0" }] }); // per-pair differs
      writeFileSync(join(dir, "models.json"), JSON.stringify(rec, null, 2) + "\n");
      const manifest = readManifest(dir);
      const due = computeDue(dir, manifest, NOW, { listing: [], versions: { codex: "2.0.0" }, record: readModelsRecord(dir) });
      const probeItem = due.find((d): d is DueProbe => d.kind === "probe");
      checkB(2, "(f) top-level snapshot equals live but the per-pair evidence differs -> still due", !!probeItem?.models.some((m) => m.id === "codex-f1"));
    }

    // A battery that fails before writing leaves every unprobed pair's
    // harnessVersion — and due-ness — untouched.
    {
      const dir = track(freshStudio("w071-b2-failwrite"));
      addCodexSellae(dir, ["codex-failwrite"]);
      const before = readFileSync(join(dir, "models.json"), "utf8");
      let threw = false;
      try {
        await probeBattery({
          studio: dir,
          now: NOW,
          only: [{ id: "codex-failwrite", harness: "codex" }],
          harnesses: { codex: fakeAvailableProfile() },
          versions: async () => ({}),
          listModels: async () => [],
          fs: {
            writeFileSync: () => {
              throw new Error("disk full");
            },
            renameSync: () => {},
          },
        });
      } catch {
        threw = true;
      }
      const after = readFileSync(join(dir, "models.json"), "utf8");
      checkB(2, "a battery that fails before writing changes nothing on disk", threw && after === before);
      const due = computeDue(dir, readManifest(dir), NOW, { listing: [], versions: {}, record: readModelsRecord(dir) });
      checkB(2, "...and the pair is still armed (never probed, still due)", !!due.find((d): d is DueProbe => d.kind === "probe")?.models.some((m) => m.id === "codex-failwrite"));
    }
  }

  // =========================================================================
  // W-071 behaviour 3 (tick's half — probe.test.ts's own suite carries the
  // battery half): tick always passes MAX_PROBE_TURNS_PER_RUN; runProbe
  // passes none.
  // =========================================================================
  if (runs(3)) {
    {
      const dir = track(freshStudio("w071-b3-tick"));
      addCodexSellae(dir, ["codex-cap-tick"]);
      let receivedMaxTurns: number | undefined;
      let called = 0;
      const { result } = await capture(() =>
        runTick(["--studio", dir], {
          now: NOW,
          ...NO_PROBE,
          // W-072 found this: this studio's own dailies are also due for
          // "now", and this block is the only runTick call in the file that
          // omits `talk`, so without it tick falls back to the real
          // ./talk.js -> claudeCodeProfile.available() -> a real `claude
          // --version` spawn, for every due magister — an accidental vendor
          // turn this test's own point (the probe cap) has nothing to do
          // with. Every other non-real-seam runTick call already injects
          // `talk: fakeTalk`; this one just forgot to.
          talk: fakeTalk,
          probe: async (opts) => {
            called++;
            receivedMaxTurns = opts.maxTurns;
            return { turns: 0, skipped: [], record: { schema: 1, at: NOW.toISOString(), harnessVersions: {}, models: [] } };
          },
        }),
      );
      checkB(3, "tick calls the injected battery exactly once", called === 1, String(called));
      checkB(3, "tick always passes MAX_PROBE_TURNS_PER_RUN as the cap", receivedMaxTurns === MAX_PROBE_TURNS_PER_RUN, String(receivedMaxTurns));
      checkB(3, "tick's own exit code is unaffected", result.exitCode === 0, String(result.exitCode));
    }
    {
      // runProbe passes no cap at all: 13 candidates (one more than
      // MAX_PROBE_TURNS_PER_RUN) all get a turn — an artificial ceiling
      // here would leave one behind.
      const dir = track(freshStudio("w071-b3-runprobe"));
      const ids = Array.from({ length: 13 }, (_, i) => `codex-rp${i}`);
      addCodexSellae(dir, ids);
      const r = await runProbe(["--studio", dir], { harnesses: { codex: fakeAvailableProfile() }, listModels: async () => [], versions: async () => ({}) });
      checkB(3, "runProbe exits 0", r.exitCode === 0, String(r.exitCode));
      const rec = JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as { models: { id: string; state: string }[] };
      const codexEntries = rec.models.filter((m) => ids.includes(m.id));
      checkB(
        3,
        "runProbe passes no cap — all 13 codex candidates get a turn, none left behind",
        codexEntries.length === 13 && codexEntries.every((m) => m.state === "available"),
        JSON.stringify(codexEntries.map((m) => [m.id, m.state])),
      );
    }
  }

  // =========================================================================
  // W-071 behaviour 4: no spend without autonomy; a failing battery never
  // fails the tick.
  // =========================================================================
  if (runs(4)) {
    function b4Dir(tag: string): string {
      const dir = track(freshStudio(tag));
      addCodexSellae(dir, ["codex-b4"]);
      return dir;
    }
    const noopBattery = async () => ({ turns: 0, skipped: [], record: { schema: 1 as const, at: NOW.toISOString(), harnessVersions: {}, models: [] } });

    // Counting stubs (F2, censor round 1): `NO_PROBE`'s stubs prove the
    // gather can't reach a real vendor binary, but say nothing about
    // whether it ran at all — a write-only assertion (models.json
    // untouched, zero battery calls) cannot see three subprocess spawns
    // that happen and are then simply never acted on. These count calls, so
    // the paused/L0 cases below assert SPAWNS are zero, not just writes.
    function countingGather(): {
      listModels: () => Promise<[]>;
      versions: () => Promise<Record<string, never>>;
      counts: { listModels: number; versions: number };
    } {
      const counts = { listModels: 0, versions: 0 };
      return {
        listModels: async () => {
          counts.listModels++;
          return [];
        },
        versions: async () => {
          counts.versions++;
          return {};
        },
        counts,
      };
    }

    // (a) every collegium L0 -> no probe due item, zero battery calls, and
    // — the class write-only assertions can't see — zero gather SPAWNS.
    {
      const dir = b4Dir("w071-b4a");
      setAllCollegiaAutonomy(dir, "L0");
      let called = 0;
      const gather = countingGather();
      await capture(() =>
        runTick(["--studio", dir], { now: NOW, listModels: gather.listModels, versions: gather.versions, probe: async () => { called++; return noopBattery(); } }),
      );
      checkB(4, "(a) L0: zero battery calls", called === 0, String(called));
      checkB(4, "(a) L0: zero gather spawns (listModels)", gather.counts.listModels === 0, String(gather.counts.listModels));
      checkB(4, "(a) L0: zero gather spawns (versions)", gather.counts.versions === 0, String(gather.counts.versions));
      const health = JSON.parse(readFileSync(join(dir, "health.json"), "utf8")) as { due: { kind: string }[] };
      checkB(4, "(a) L0: no probe due item", !health.due.some((d) => d.kind === "probe"), JSON.stringify(health.due));
    }

    // (b) paused -> only the health step, zero battery calls, models.json
    // untouched, and zero gather spawns — the F2 regression: a paused tick
    // used to spawn `codex debug models`, `claude --version` and
    // `codex --version` regardless, which no write-only assertion caught.
    {
      const dir = b4Dir("w071-b4b");
      await capture(() => runPause(["--studio", dir, "--reason", "w071 b4"], { now: NOW }));
      const before = readFileSync(join(dir, "models.json"), "utf8");
      let called = 0;
      const gather = countingGather();
      await capture(() =>
        runTick(["--studio", dir], { now: NOW, listModels: gather.listModels, versions: gather.versions, probe: async () => { called++; return noopBattery(); } }),
      );
      const after = readFileSync(join(dir, "models.json"), "utf8");
      checkB(4, "(b) paused: zero battery calls", called === 0, String(called));
      checkB(4, "(b) paused: zero gather spawns (listModels)", gather.counts.listModels === 0, String(gather.counts.listModels));
      checkB(4, "(b) paused: zero gather spawns (versions)", gather.counts.versions === 0, String(gather.counts.versions));
      checkB(4, "(b) paused: models.json byte-for-byte unchanged", before === after);
      await capture(() => runResume(["--studio", dir]));
    }

    // (c) --dry-run -> due line printed, zero battery calls, no file
    // written — but the gather DOES spawn (positive control: dry-run needs
    // it to print the due line at all; a branch that also skips dry-run's
    // gather would print "nothing due" instead and fail here).
    {
      const dir = b4Dir("w071-b4c");
      const before = readFileSync(join(dir, "models.json"), "utf8");
      let called = 0;
      const gather = countingGather();
      const { logs } = await capture(() =>
        runTick(["--studio", dir, "--dry-run"], { now: NOW, listModels: gather.listModels, versions: gather.versions, probe: async () => { called++; return noopBattery(); } }),
      );
      const after = readFileSync(join(dir, "models.json"), "utf8");
      checkB(4, "(c) dry-run: the due line is printed", logs.some((l) => l.includes("due: probe")), logs.join(" | "));
      checkB(4, "(c) dry-run: zero battery calls", called === 0, String(called));
      checkB(4, "(c) dry-run: models.json untouched", before === after);
      checkB(4, "(c) dry-run positive control: the gather DOES spawn (it needs to, to print the due line)", gather.counts.listModels === 1 && gather.counts.versions === 1, JSON.stringify(gather.counts));
    }

    // (d) an injected battery that throws is reported on stderr; tick still
    // writes its receipt; exit code still comes from the check.
    {
      const dir = b4Dir("w071-b4d");
      const { result, errs } = await capture(() =>
        runTick(["--studio", dir], {
          now: NOW,
          ...NO_PROBE,
          talk: fakeTalk,
          probe: async () => {
            throw new Error("battery exploded");
          },
        }),
      );
      checkB(4, "(d) a failing battery is reported on stderr", errs.some((e) => e.includes("battery exploded")), errs.join(" | "));
      checkB(
        4,
        "(d) tick still writes its receipt",
        existsSync(join(dir, "receipts", "tick")) && readdirSync(join(dir, "receipts", "tick")).length > 0,
      );
      checkB(4, "(d) exit code still comes from the check (0, check passes)", result.exitCode === 0, String(result.exitCode));
    }

    // Positive control for (a)/(b): the same studio at L1 and unpaused
    // calls the battery exactly once with the expected pairs — so an
    // unimplemented branch can't pass three absences — and the gather DOES
    // spawn exactly once each, so (a)/(b)'s zero-spawn assertions aren't
    // vacuously true because the gather never runs at all.
    {
      const dir = b4Dir("w071-b4-positive");
      let calledWith: { only: Candidate[] } | undefined;
      const gather = countingGather();
      const { result } = await capture(() =>
        runTick(["--studio", dir], {
          now: NOW,
          listModels: gather.listModels,
          versions: gather.versions,
          talk: fakeTalk,
          probe: async (opts) => {
            calledWith = opts;
            return noopBattery();
          },
        }),
      );
      checkB(4, "positive control: L1 + unpaused calls the battery exactly once", calledWith !== undefined);
      checkB(4, "positive control: called with the expected due pairs", !!calledWith?.only.some((c) => c.id === "codex-b4"), JSON.stringify(calledWith?.only));
      checkB(4, "positive control: the gather spawns exactly once each (listModels/versions)", gather.counts.listModels === 1 && gather.counts.versions === 1, JSON.stringify(gather.counts));
      checkB(4, "positive control: tick's own exit code is unaffected", result.exitCode === 0, String(result.exitCode));
    }
  }
} finally {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
}

process.exit(failed ? 1 : 0);
