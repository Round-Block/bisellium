/**
 * packages/cli/src/talk-boundary.test.ts — W-044 (briefs/W-044.md): the talk
 * profile is a permission boundary. `Bash(bisellium *)` used to admit the
 * whole CLI to anything a talked-to sella's harness could be made to run
 * (`run`/`red`'s arbitrary passthrough, the Patron-stamped
 * `answer`/`greenlight`/`budget`, git-moving `branch`/`merge`/`close`); this
 * file is the spec of the fix, written out literally rather than mirroring
 * `claude-code.ts`. It drives a stub `claude` (never the real vendor CLI)
 * that logs argv and never executes anything it's handed — evidence here is
 * string-level, never a working exploit.
 *
 * `BISELLIUM_ONLY_BEHAVIOUR` (comma-separated behaviour numbers) restricts
 * the run to those blocks — the red-capture harness (studio/ci/reds/W-044)
 * invokes this file directly per behaviour, same pattern as
 * lifecycle.test.ts.
 */
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { claudeCodeProfile } from "@bisellium/shim";
import { readManifest } from "@bisellium/adapter-native";
import { runTalk } from "./talk.js";
import { harnessForSella, runTick } from "./tick.js";
import { USAGE } from "./usage.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-23T09:00:00Z");

const only = process.env["BISELLIUM_ONLY_BEHAVIOUR"];
const selected = only ? new Set(only.split(",").map(Number)) : undefined;
const runs = (behaviour: number): boolean => selected === undefined || selected.has(behaviour);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(74)} ${detail}`);
  if (!ok) failed++;
};

// ---------------------------------------------------------------------------
// The expected policy — written out literally (the test is the spec, not a
// mirror of claude-code.ts).
// ---------------------------------------------------------------------------
const EXPECTED_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const EXPECTED_ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(bisellium)",
  "Bash(bisellium context)",
  "Bash(bisellium context *)",
  "Bash(bisellium query)",
  "Bash(bisellium query *)",
  "Bash(bisellium check)",
  "Bash(bisellium check *)",
];
// ---------------------------------------------------------------------------
// argv parsing helpers — a logged argv is a flat string[], flags start with
// "-", and none of this profile's flag *values* (session ids, "dontAsk",
// tool names) do.
// ---------------------------------------------------------------------------

/** Every value from EVERY occurrence of `flag`, concatenated — a repeated
 * variadic flag (`--tools`, `--allowedTools`) merges on the installed vendor
 * CLI, so a caller judging "what does this admit" must see every group, not
 * just the first (F1, W-044 review round 1). */
function valuesAfterAll(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    for (let j = i + 1; j < argv.length && !argv[j]!.startsWith("-"); j++) out.push(argv[j]!);
  }
  return out;
}

/**
 * The conservative Bash-rule matcher (brief: "unrecognized rule shapes count
 * as admitting everything"):
 *  - `Bash(P)` with no `*` admits exactly `P`.
 *  - `Bash(P *)` admits `P` and anything starting with `P ` (a space).
 *  - anything else — bare `Bash`, a `*` in any other position, a `:` form —
 *    admits every command.
 */
function ruleAdmits(rule: string, cmd: string): boolean {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return true; // bare "Bash", or any shape that isn't "Bash(...)"
  const inner = m[1]!;
  if (inner.includes(":")) return true;
  const starIdx = inner.indexOf("*");
  if (starIdx === -1) return cmd === inner;
  if (starIdx === inner.length - 1 && inner[starIdx - 1] === " ") {
    const prefix = inner.slice(0, starIdx - 1);
    return cmd === prefix || cmd.startsWith(`${prefix} `);
  }
  return true; // "*" anywhere else — conservative: admits everything
}

function admits(allowedTools: string[], cmd: string): boolean {
  return allowedTools.filter((t) => t.startsWith("Bash")).some((r) => ruleAdmits(r, cmd));
}

// ---------------------------------------------------------------------------
// Verb universe: harvested from the USAGE banner (first token after
// "bisellium" on each line) plus one verb the CLI does not have.
// ---------------------------------------------------------------------------
function verbsFromUsage(usage: string): string[] {
  const verbs = new Set<string>();
  for (const line of usage.split("\n")) {
    const m = /\bbisellium\s+(\S+)/.exec(line);
    if (m) verbs.add(m[1]!);
  }
  return [...verbs];
}
const VERBS = verbsFromUsage(USAGE);
const FUTURE_VERB = "zz-future-verb";

// ---------------------------------------------------------------------------
// Stub `claude`: exits 0 on --version; on every other call, logs its own
// argv as one JSON line to LOG_PATH, and prints a normal JSON envelope. It
// never executes anything it's handed. LOG_PATH is a literal baked into the
// stub's own source text (W-049 test hardening, A2 also below) — an
// env-carried log path would itself be scrubbed by W-049's harness env
// allowlist, so this stub (like harness-env.test.ts's) never reads one.
// The stub replies with a fixed `session_id: "sess-stub"` (A2), so every
// resume argv this test drives can be checked against that literal rather
// than merely shape-checked.
// ---------------------------------------------------------------------------
const binDir = mkdtempSync(join(tmpdir(), "bisellium-talk-boundary-bin-"));
const LOG_PATH = join(binDir, "log.jsonl");
const CLAUDE_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
appendFileSync(${JSON.stringify(LOG_PATH)}, JSON.stringify(args) + "\\n");
process.stdout.write(JSON.stringify({ session_id: "sess-stub", result: "ack", is_error: false, model: "stub" }) + "\\n");
process.exit(0);
`;

function writeStub(): void {
  const p = join(binDir, "claude");
  writeFileSync(p, CLAUDE_STUB);
  chmodSync(p, 0o755);
}
writeStub();

function envFor(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${binDir}:${process.env["PATH"] ?? ""}` };
}

function readLog(logPath: string): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as string[]);
}

/** Seeds a `models.json` where every seated (model, harness) pair is
 *  already `available` as of `NOW` — W-071's probe cadence otherwise finds
 *  every pair never-probed and adds a `due: probe` item (and a real battery
 *  run) that this file's own assertions (unrelated to the cadence) never
 *  anticipated. Duplicated from tick.test.ts's own helper of the same name
 *  — not a published seam, matching this codebase's per-file small-helper
 *  style. */
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

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-talk-boundary-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  seedFreshModels(dir, NOW);
  dirs.push(dir);
  return dir;
}

/**
 * The full policy tail shared by `start` and `resume` — literal, in the
 * exact order claude-code.ts's POLICY_FLAGS emits it. Round-2 review (F2):
 * a first-VALUE read of a variadic flag (`valuesAfter(argv, "--tools")[0]`)
 * missed a second token appended inside the same `--tools` group; comparing
 * the whole argv literally is the one fix that also catches a stray token
 * after any other flag (F2's siblings, M11–M14).
 */
const POLICY_TAIL = [
  "--restricted",
  "--strict-mcp-config",
  "--permission-mode",
  "dontAsk",
  "--tools",
  EXPECTED_TOOLS.join(","),
  "--allowedTools",
  ...EXPECTED_ALLOWED_TOOLS,
];

/** The exact expected argv. The resume session id in behaviour 1 IS
 *  predictable (the test passes "sess-fixture" itself), and since W-049's
 *  A2 the stub always replies with a fixed "sess-stub", so behaviour 4's
 *  resume ids are predictable too — every resume slot is checked against
 *  its literal below. Only the system-prompt temp file (start, always) is
 *  genuinely unpredictable (mkdtempSync names it), so that slot alone is
 *  read from the actual argv — but only after being shape- and
 *  path-checked (round-3 review F4, W-049's A1): a copied token must not
 *  start with "-", the file must end in "/system-prompt.md", its basename
 *  must be exactly that, its directory must match
 *  `bisellium-sysprompt-XXXXXX`, and its parent must be `os.tmpdir()`.
 *
 *  W-046 test hardening (not a numbered behaviour — see the brief): a model
 *  slot, `["--model", model]` placed right after `--output-format json` and
 *  before everything else, exactly like claude-code.ts emits it. `model` is
 *  omitted for behaviour 1's direct `claudeCodeProfile` calls (which pass no
 *  model) and given `"claude-opus-5"` for behaviour 4's `runTalk`/`runTick`
 *  calls against the fixture (`eng-lead`'s manifest model, W-046). */
function expectedStartArgv(sysPromptFile: string, model?: string): string[] {
  const modelArgs = model ? ["--model", model] : [];
  return ["-p", "--output-format", "json", ...modelArgs, "--append-system-prompt-file", sysPromptFile, ...POLICY_TAIL];
}
function expectedResumeArgv(sessionId: string, model?: string): string[] {
  const modelArgs = model ? ["--model", model] : [];
  return ["-p", "--resume", sessionId, "--output-format", "json", ...modelArgs, ...POLICY_TAIL];
}

/** Behaviour-1 style policy assertion against one logged argv: the argv
 *  deep-equals the literal expected array. `knownResumeId`, when given, is
 *  the literal value the test itself passed as the resume session id (only
 *  behaviour 1 knows this in advance); otherwise the resume id is read from
 *  argv and merely shape-checked, never taken on faith. `model`, when given,
 *  is the literal decreed model this call is expected to carry (W-046 test
 *  hardening) — omitted entirely for a call that passes none. */
function checkPolicy(name: string, argv: string[], form: "start" | "resume", knownResumeId?: string, model?: string): void {
  if (form === "start") {
    const fileIdx = argv.indexOf("--append-system-prompt-file");
    const file = fileIdx !== -1 ? (argv[fileIdx + 1] ?? "") : "";
    check(
      `${name}: start file (--append-system-prompt-file value) is a real system-prompt path, not a copied flag`,
      file.length > 0 && !file.startsWith("-") && file.endsWith("/system-prompt.md"),
      file,
    );
    // W-049's A1: beyond the endsWith check above, pin the whole shape —
    // kills a fixed "/tmp/system-prompt.md" (M24) and a relative
    // "x/system-prompt.md" (M25).
    check(`${name}: start file basename is exactly system-prompt.md`, basename(file) === "system-prompt.md", file);
    check(
      `${name}: start file's directory matches bisellium-sysprompt-XXXXXX`,
      /^bisellium-sysprompt-[A-Za-z0-9]{6}$/.test(basename(dirname(file))),
      basename(dirname(file)),
    );
    check(`${name}: start file's parent directory is os.tmpdir()`, dirname(dirname(file)) === tmpdir(), dirname(dirname(file)));
    const expected = expectedStartArgv(file, model);
    check(`${name}: argv is exactly the start policy`, JSON.stringify(argv) === JSON.stringify(expected), JSON.stringify(argv));
    return;
  }
  const sessionId = argv[2] ?? "";
  if (knownResumeId !== undefined) {
    check(`${name}: resume session id (argv[2]) is the literal fixture, not a copy`, sessionId === knownResumeId, sessionId);
  } else {
    check(`${name}: resume session id (argv[2]) is not a copied flag`, sessionId.length > 0 && !sessionId.startsWith("-"), sessionId);
  }
  const expected = expectedResumeArgv(knownResumeId ?? sessionId, model);
  check(`${name}: argv is exactly the resume policy`, JSON.stringify(argv) === JSON.stringify(expected), JSON.stringify(argv));
}

try {
  // ---- 1: the argv is the policy, on both start and resume ---------------
  if (runs(1)) {
    const before = readLog(LOG_PATH).length;
    const env = envFor();
    await claudeCodeProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "boot", message: "hi", env });
    await claudeCodeProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture", message: "hi again", env });
    const [startArgv, resumeArgv] = readLog(LOG_PATH).slice(before);
    check(
      "behaviour 1: two calls logged (start, resume)",
      startArgv !== undefined && resumeArgv !== undefined,
      JSON.stringify(readLog(LOG_PATH).slice(before)),
    );
    if (startArgv) checkPolicy("behaviour 1 start", startArgv, "start");
    if (resumeArgv) checkPolicy("behaviour 1 resume", resumeArgv, "resume", "sess-fixture");
  }

  // ---- 2: every existing CLI verb outside {context, query, check} denied -
  if (runs(2)) {
    check(
      "behaviour 2 guard: derived verb universe contains run/red/greenlight/answer/budget/talk/tick/providers",
      ["run", "red", "greenlight", "answer", "budget", "talk", "tick", "providers"].every((v) => VERBS.includes(v)),
      VERBS.join(","),
    );
    for (const form of ["start", "resume"] as const) {
      const before = readLog(LOG_PATH).length;
      const env = envFor();
      if (form === "start") await claudeCodeProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "boot", message: "hi", env });
      else await claudeCodeProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture", message: "hi", env });
      const [argv] = readLog(LOG_PATH).slice(before);
      if (!argv) {
        check(`behaviour 2 ${form}: argv logged`, false);
        continue;
      }
      const allowed = valuesAfterAll(argv, "--allowedTools");
      for (const v of VERBS) {
        const expectAdmit = v === "context" || v === "query" || v === "check";
        check(
          `behaviour 2 ${form}: bisellium ${v} ${expectAdmit ? "admitted" : "denied"}`,
          admits(allowed, `bisellium ${v}`) === expectAdmit,
        );
        check(
          `behaviour 2 ${form}: bisellium ${v} --probe x ${expectAdmit ? "admitted" : "denied"}`,
          admits(allowed, `bisellium ${v} --probe x`) === expectAdmit,
        );
      }
      check(`behaviour 2 ${form}: bare bisellium admitted`, admits(allowed, "bisellium"));
    }
  }

  // ---- 3: a verb the CLI does not have yet is denied ----------------------
  if (runs(3)) {
    for (const form of ["start", "resume"] as const) {
      const before = readLog(LOG_PATH).length;
      const env = envFor();
      if (form === "start") await claudeCodeProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "boot", message: "hi", env });
      else await claudeCodeProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture", message: "hi", env });
      const [argv] = readLog(LOG_PATH).slice(before);
      if (!argv) {
        check(`behaviour 3 ${form}: argv logged`, false);
        continue;
      }
      const allowed = valuesAfterAll(argv, "--allowedTools");
      check(`behaviour 3 ${form}: bisellium ${FUTURE_VERB} denied`, !admits(allowed, `bisellium ${FUTURE_VERB}`));
      check(`behaviour 3 ${form}: bisellium ${FUTURE_VERB} --probe x denied`, !admits(allowed, `bisellium ${FUTURE_VERB} --probe x`));
    }
  }

  // ---- 4: both talk entry points carry the policy; tick still writes -----
  if (runs(4)) {
    const dir = freshStudio("b4");
    const before = readLog(LOG_PATH).length;
    const origPath = process.env["PATH"];
    process.env["PATH"] = `${binDir}:${origPath ?? ""}`;
    try {
      const first = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]);
      check("behaviour 4: first runTalk call exit 0", first.exitCode === 0, String(first.exitCode));
      const second = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello again"]);
      check("behaviour 4: second runTalk call exit 0", second.exitCode === 0, String(second.exitCode));

      const talkLog = readLog(LOG_PATH).slice(before);
      check("behaviour 4: two talk calls logged", talkLog.length === 2, String(talkLog.length));
      if (talkLog.length === 2) {
        check("behaviour 4: first call has no --resume (start)", !talkLog[0]!.includes("--resume"));
        check("behaviour 4: second call carries --resume", talkLog[1]!.includes("--resume"));
        // W-046: eng-lead's manifest model (examples/sample-studio) is
        // "claude-opus-5" — both calls are expected to carry it.
        checkPolicy("behaviour 4 talk start", talkLog[0]!, "start", undefined, "claude-opus-5");
        // W-049's A2: the stub's session_id is now the fixed "sess-stub",
        // so this resume argv's id is checked literally, not just shaped.
        checkPolicy("behaviour 4 talk resume", talkLog[1]!, "resume", "sess-stub", "claude-opus-5");
      }

      const beforeActa = readdirSync(join(dir, "acta"));
      const beforeTick = readLog(LOG_PATH).length;
      const tickResult = await runTick(["--studio", dir], { now: NOW, listModels: async () => [], versions: async () => ({}) });
      check("behaviour 4: tick exit 0", tickResult.exitCode === 0, String(tickResult.exitCode));
      const afterActa = readdirSync(join(dir, "acta"));
      const added = afterActa.filter((f) => !beforeActa.includes(f));
      check("behaviour 4: tick writes one daily acta per due magister", added.length === 5, added.join(", "));

      const tickLog = readLog(LOG_PATH).slice(beforeTick);
      check("behaviour 4: tick logged one call per due magister", tickLog.length === 5, String(tickLog.length));
      for (const argv of tickLog) {
        const form = argv.includes("--resume") ? "resume" : "start";
        // W-046: the five magistri don't share one decreed model (producer/
        // architect/eng-lead are claude-opus-5, qa-lead claude-sonnet-5,
        // art-lead gpt-6-astra) — read whichever one this call actually
        // carries and assert it sits in the exact right slot, rather than
        // hardcoding a value that's wrong for four of the five calls. Which
        // literal belongs to which sella is provider-portability.test.ts's
        // job (behaviours 1/2/4/5), not this file's.
        const modelIdx = argv.indexOf("--model");
        const model = modelIdx !== -1 ? argv[modelIdx + 1] : undefined;
        checkPolicy("behaviour 4 tick call", argv, form, form === "resume" ? "sess-stub" : undefined, model);
      }
    } finally {
      if (origPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = origPath;
    }
  }
} finally {
  rmSync(binDir, { recursive: true, force: true });
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
