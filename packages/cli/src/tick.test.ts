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
import { computeDue, harnessForSella, runTick, type TalkCallOptions, type TalkCallResult } from "./tick.js";
import { readManifest } from "@bisellium/adapter-native";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T14:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail}`);
  if (!ok) failed++;
};

function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-tick-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  return dir;
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
    const { result, logs } = await capture(() => runTick(["--studio", dir, "--dry-run"], { now: NOW }));
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
    const { result, logs } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: fakeTalk }));
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
    const { result } = await capture(() => runTick(["--studio", dir, "--dry-run"], { now: NOW }));
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
    const { result, logs } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: fakeTalk }));
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
    const { result: second, logs: secondLogs } = await capture(() => runTick(["--studio", dir, "--dry-run"], { now: NOW }));
    check("write tick: second dry-run has nothing due", second.exitCode === 0 && secondLogs.some((l) => l.includes("nothing due")), secondLogs.join(" | "));
  }

  // ---- tick redacts the daily title/body before writing acta ------------
  {
    const dir = track(freshStudio("redact"));
    const secret = "abcdef0123456789abcdef0123456789";
    const secretTalk = async (opts: TalkCallOptions): Promise<TalkCallResult> => ({
      reply: `deploy token=${secret} status stable\nnothing blocked\nsee you tomorrow`,
    });
    const { result } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: secretTalk }));
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
    const { logs } = await capture(() => runTick(["--studio", dir], { now: NOW, talk: countingTalk }));
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

    const before = readdirSync(join(dir, "acta"));
    const { result, errs } = await capture(() => runTick(["--studio", dir], { now: NOW }));
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
