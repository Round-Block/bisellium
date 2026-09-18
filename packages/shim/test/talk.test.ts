/**
 * packages/shim/test/talk.test.ts — W-010 (`bisellium talk`, harness
 * profiles). Every scenario here drives the 'fake' profile (or the
 * always-available-but-refusing 'git-only' one) against a temp copy of
 * examples/sample-studio — never a real `claude`/`codex` call.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTalk } from "../../cli/src/talk.js";
import { checkStudio } from "../../cli/src/check.js";
import { fakeProfile, gitOnlyProfile } from "../src/index.js";
import type { HarnessProfile } from "../src/index.js";

const NOW = new Date("2026-09-18T14:00:00Z");
const SAMPLE = resolve("examples/sample-studio");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

function freshStudio(): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-talk-"));
  cpSync(SAMPLE, dir, { recursive: true });
  return dir;
}

/** Wraps a profile so a test can assert whether it was actually invoked —
 *  stronger than inferring non-invocation from the absence of side effects. */
function countingProfile(base: HarnessProfile): { profile: HarnessProfile; calls: { start: number; resume: number } } {
  const calls = { start: 0, resume: 0 };
  const profile: HarnessProfile = {
    id: base.id,
    tier: base.tier,
    available: () => base.available(),
    start: async (o) => {
      calls.start++;
      return base.start(o);
    },
    resume: async (o) => {
      calls.resume++;
      return base.resume(o);
    },
  };
  return { profile, calls };
}

async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[]; errs: string[] }> {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errs.push(args.map(String).join(" "));
  try {
    const result = await fn();
    return { result, logs, errs };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// ---- 1. a deterministic query is answered from files, never a harness ------

{
  const studio = freshStudio();
  try {
    const { profile, calls } = countingProfile(fakeProfile);
    const { result, logs } = await captureLogs(() =>
      runTalk(["--sella", "eng-lead", "--studio", studio, "--harness", "fake", "what is blocked on me"], {
        harnesses: { fake: profile },
      }),
    );
    check("query path: exits 0", result.exitCode === 0, String(result.exitCode));
    check("query path: printed with 'query · ' prefix", logs.some((l) => l.startsWith("query · ")), JSON.stringify(logs));
    check("query path: never called the harness", calls.start === 0 && calls.resume === 0, JSON.stringify(calls));
    check("query path: no session file written", !existsSync(join(studio, "sessions", "eng-lead.json")));
    check("query path: no timeline file written", !existsSync(join(studio, "timeline", "eng-lead.jsonl")));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---- 2–4: a free-form conversation on one studio, in sequence --------------

{
  const studio = freshStudio();
  try {
    // ---- 2. free-form message invokes the fake, persists everything -------
    const { result, logs } = await captureLogs(() =>
      runTalk(["--sella", "eng-lead", "--studio", studio, "--harness", "fake", "please give a status update"], {
        harnesses: { fake: fakeProfile },
      }),
    );
    check("free-form: exits 0", result.exitCode === 0, String(result.exitCode));
    check("free-form: prints the FAKE reply", logs.some((l) => l === "FAKE: PLEASE GIVE A STATUS UPDATE"), JSON.stringify(logs));

    const sessionPath = join(studio, "sessions", "eng-lead.json");
    check("free-form: session file written", existsSync(sessionPath));
    const session = JSON.parse(readFileSync(sessionPath, "utf8")) as { harness: string; sessionId: string; turns: number };
    check("free-form: session harness is fake", session.harness === "fake", session.harness);
    check("free-form: session turns is 1", session.turns === 1, String(session.turns));
    const firstSessionId = session.sessionId;
    check("free-form: session has a sessionId", typeof firstSessionId === "string" && firstSessionId.length > 0);

    const timelinePath = join(studio, "timeline", "eng-lead.jsonl");
    check("free-form: timeline file written", existsSync(timelinePath));
    const entries = readJsonl(timelinePath) as { direction: string; text: string; sessionId: string }[];
    check("free-form: timeline has exactly two entries", entries.length === 2, String(entries.length));
    check(
      "free-form: first entry is 'in' with the message",
      entries[0]?.direction === "in" && entries[0]?.text === "please give a status update",
      JSON.stringify(entries[0]),
    );
    check(
      "free-form: second entry is 'out' with the reply",
      entries[1]?.direction === "out" && entries[1]?.text === "FAKE: PLEASE GIVE A STATUS UPDATE",
      JSON.stringify(entries[1]),
    );

    const receiptDir = join(studio, "receipts", "eng-lead");
    check("free-form: receipt dir written", existsSync(receiptDir));
    const receiptFiles = existsSync(receiptDir) ? readdirSync(receiptDir).filter((f) => f.endsWith(".json")) : [];
    check("free-form: exactly one receipt", receiptFiles.length === 1, JSON.stringify(receiptFiles));
    if (receiptFiles[0]) {
      const receipt = JSON.parse(readFileSync(join(receiptDir, receiptFiles[0]), "utf8")) as { harness: string; sella: string };
      check("free-form: receipt harness is fake", receipt.harness === "fake", receipt.harness);
      check("free-form: receipt sella is eng-lead", receipt.sella === "eng-lead", receipt.sella);
    }

    // ---- 3. a second message resumes (same sessionId) ---------------------
    const { result: result2 } = await captureLogs(() =>
      runTalk(["--sella", "eng-lead", "--studio", studio, "--harness", "fake", "another update please"], {
        harnesses: { fake: fakeProfile },
      }),
    );
    check("resume: exits 0", result2.exitCode === 0, String(result2.exitCode));
    const session2 = JSON.parse(readFileSync(sessionPath, "utf8")) as { sessionId: string; turns: number };
    check("resume: sessionId unchanged", session2.sessionId === firstSessionId, `${session2.sessionId} vs ${firstSessionId}`);
    check("resume: turns is 2", session2.turns === 2, String(session2.turns));
    check("resume: timeline now has four entries", readJsonl(timelinePath).length === 4, String(readJsonl(timelinePath).length));

    // ---- 4. a PETITIO: line opens a petitio that passes checkStudio -------
    // The fake profile always upper-cases the whole message — embedding a
    // newline before "petitio:" is what puts "PETITIO:" at the START of its
    // own line in the reply, exactly what talk.ts's escalation scan matches.
    const { result: result3, logs: logs3 } = await captureLogs(() =>
      runTalk(
        ["--sella", "eng-lead", "--studio", studio, "--harness", "fake", "status update\npetitio: need a scope call"],
        { harnesses: { fake: fakeProfile } },
      ),
    );
    check("petitio: exits 0", result3.exitCode === 0, String(result3.exitCode));
    check("petitio: prints 'petitio P-001 opened'", logs3.includes("petitio P-001 opened"), JSON.stringify(logs3));
    check("petitio: P-001.md written", existsSync(join(studio, "petitiones", "P-001.md")));

    const checkResult = checkStudio(studio, NOW);
    const blocking = checkResult.findings.filter((f) => f.level === "block");
    check("petitio: checkStudio has no blocking findings", blocking.length === 0, JSON.stringify(blocking));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---- 4.5. secrets in the message and the reply are redacted before they --
// ---- land in the timeline (they already were in the receipt) -------------

{
  const studio = freshStudio();
  try {
    const secret = "abcdef0123456789abcdef0123456789";
    const { result } = await captureLogs(() =>
      runTalk(
        ["--sella", "eng-lead", "--studio", studio, "--harness", "fake", `deploy with token=${secret} please`],
        { harnesses: { fake: fakeProfile } },
      ),
    );
    check("redaction: exits 0", result.exitCode === 0, String(result.exitCode));

    const timelinePath = join(studio, "timeline", "eng-lead.jsonl");
    const entries = readJsonl(timelinePath) as { direction: string; text: string }[];
    const inText = entries[0]?.text ?? "";
    const outText = entries[1]?.text ?? "";
    check("redaction: 'in' entry has no raw secret", !inText.includes(secret), inText);
    check("redaction: 'in' entry is masked", inText.includes("token=***"), inText);
    check("redaction: 'out' entry has no raw secret", !outText.includes(secret.toUpperCase()), outText);
    check("redaction: 'out' entry is masked", outText.toUpperCase().includes("TOKEN=***"), outText);

    const receiptDir = join(studio, "receipts", "eng-lead");
    const receiptFiles = existsSync(receiptDir) ? readdirSync(receiptDir).filter((f) => f.endsWith(".json")) : [];
    if (receiptFiles[0]) {
      const receipt = JSON.parse(readFileSync(join(receiptDir, receiptFiles[0]), "utf8")) as { cmd: string[] };
      check("redaction: receipt still masked too", !receipt.cmd.some((c) => c.includes(secret)), JSON.stringify(receipt.cmd));
    }
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---- 5. unknown sella -> 2 --------------------------------------------------

{
  const studio = freshStudio();
  try {
    const { result } = await captureLogs(() =>
      runTalk(["--sella", "nobody", "--studio", studio, "--harness", "fake", "hello"], { harnesses: { fake: fakeProfile } }),
    );
    check("unknown sella: exits 2", result.exitCode === 2, String(result.exitCode));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---- 6. --harness git-only -> 2 --------------------------------------------

{
  const studio = freshStudio();
  try {
    const { result } = await captureLogs(() =>
      runTalk(["--sella", "eng-lead", "--studio", studio, "--harness", "git-only", "please give a status update"], {
        harnesses: { "git-only": gitOnlyProfile },
      }),
    );
    check("git-only: exits 2", result.exitCode === 2, String(result.exitCode));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
