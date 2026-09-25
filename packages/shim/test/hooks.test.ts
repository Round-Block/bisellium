/**
 * packages/shim/test/hooks.test.ts — W-015 (harness hooks: the Claude Code
 * profile as the event-native adapter). Against temp copies of
 * examples/sample-studio; every stdin payload here is a fake in-memory
 * stream (Readable.from) — never a real `claude` CLI, never real process
 * stdin. `now` is pinned so receipt/event timestamps are reproducible.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { claudeCodeHooksBlock, receiptPath } from "../src/index.js";
import { runHooks, runHookEvent } from "../../cli/src/hooks.js";
import { checkStudio } from "../../cli/src/check.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T17:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-hooks-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

/** A one-shot readable that yields `text` then ends — the stand-in for a
 *  hook's real stdin, which Claude Code writes once and closes. */
function stdinOf(text: string): Readable {
  return Readable.from([text]);
}

/** A directory on PATH holding a fake `bisellium` that echoes its argv,
 *  one element per line wrapped in `[...]` — the same argv-echo technique
 *  the W-015 verifier used to prove the printed hook block is dead on
 *  arrival. Lets a test run a printed command through a real shell
 *  (`bash -c`) without ever invoking the real CLI or a real harness. */
function makeArgvEchoStub(): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-argv-stub-"));
  dirs.push(dir);
  const bin = join(dir, "bisellium");
  writeFileSync(bin, '#!/usr/bin/env bash\nfor a in "$@"; do printf \'[%s]\\n\' "$a"; done\n');
  chmodSync(bin, 0o755);
  return dir;
}

async function capture<T>(fn: () => Promise<T> | T): Promise<{ result: T; logs: string[]; errs: string[] }> {
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

try {
  // ---- 1. hook-event start/stop: writes and closes a receipt --------------
  {
    const dir = freshStudio("start-stop");
    const sella = "builder-1";
    const sessionId = "sess-abc123";

    const startPayload = JSON.stringify({ session_id: sessionId, cwd: dir, hook_event_name: "SessionStart" });
    const started = await runHookEvent(["start", "--sella", sella, "--studio", dir], { now: NOW, stdin: stdinOf(startPayload) });
    check("start: exitCode 0", started.exitCode === 0, String(started.exitCode));

    const path = receiptPath(dir, sella, sessionId);
    check("start: receipt file exists", existsSync(path), path);
    const afterStart = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    check("start: receipt harness is claude-code", afterStart["harness"] === "claude-code", JSON.stringify(afterStart));
    check("start: receipt sessionId from payload", afterStart["sessionId"] === sessionId, JSON.stringify(afterStart));
    check("start: receipt not yet closed", afterStart["endedAt"] === undefined, JSON.stringify(afterStart));

    const stopNow = new Date(NOW.getTime() + 60_000);
    const stopPayload = JSON.stringify({ session_id: sessionId, hook_event_name: "Stop", last_assistant_message: "done" });
    const stopped = await runHookEvent(["stop", "--sella", sella, "--studio", dir], { now: stopNow, stdin: stdinOf(stopPayload) });
    check("stop: exitCode 0", stopped.exitCode === 0, String(stopped.exitCode));

    const afterStop = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    check("stop: receipt closed (endedAt set)", typeof afterStop["endedAt"] === "string", JSON.stringify(afterStop));
    check("stop: durationMs computed from the start receipt", afterStop["durationMs"] === 60_000, JSON.stringify(afterStop));
    check("stop: sella/sessionId survive the rewrite", afterStop["sella"] === sella && afterStop["sessionId"] === sessionId, JSON.stringify(afterStop));
  }

  // ---- 2. hook-event tool: one workflow.* event, file path secrets masked -
  {
    const dir = freshStudio("tool");
    const payload = JSON.stringify({
      session_id: "sess-tool",
      tool_name: "Edit",
      tool_input: { file_path: "/repo/notes.md?token=abcdef1234567890", old_string: "a", new_string: "b" },
    });
    const r = await runHookEvent(["tool", "--sella", "builder-1", "--studio", dir], { now: NOW, stdin: stdinOf(payload) });
    check("tool: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const logPath = join(dir, ".bisellium", "events.jsonl");
    check("tool: events.jsonl written under .bisellium/", existsSync(logPath), logPath);
    const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    check("tool: exactly one event written", lines.length === 1, String(lines.length));
    const event = JSON.parse(lines[0] ?? "{}") as { name: string; attrs: Record<string, unknown> };
    check("tool: event name is workflow.*", event.name.startsWith("workflow."), event.name);
    check("tool: attrs carry the tool name", event.attrs["tool.name"] === "Edit", JSON.stringify(event.attrs));
    const filePath = String(event.attrs["tool.file_path"] ?? "");
    check("tool: file path token= value is masked", filePath.includes("token=***"), filePath);
    check("tool: raw secret value is gone", !filePath.includes("abcdef1234567890"), filePath);
  }

  // ---- 3. malformed payload: exits 0, exactly one stderr line --------------
  {
    const dir = freshStudio("malformed");
    const { result, errs, logs } = await capture(() =>
      runHookEvent(["start", "--sella", "builder-1", "--studio", dir], { now: NOW, stdin: stdinOf("{not valid json") }),
    );
    check("malformed: exitCode 0 (never blocks the harness)", result.exitCode === 0, String(result.exitCode));
    check("malformed: exactly one stderr line", errs.length === 1, JSON.stringify(errs));
    check("malformed: nothing on stdout", logs.length === 0, JSON.stringify(logs));
    check("malformed: no receipt written", !existsSync(join(dir, "receipts", "builder-1")), "");
  }

  // ---- 4. hooks print: valid JSON, all four hook names, the sella ---------
  {
    const { result, logs, errs } = await capture(() => runHooks(["print", "--harness", "claude-code", "--sella", "eng-lead", "--studio", "/studio"]));
    check("print: exitCode 0", result.exitCode === 0, String(result.exitCode));
    check("print: exactly one stdout block", logs.length === 1, String(logs.length));
    check("print: explains, on stderr, that it doesn't write settings.json", errs.length >= 1, JSON.stringify(errs));

    const parsed = JSON.parse(logs[0] ?? "") as { hooks: Record<string, unknown> };
    for (const name of ["SessionStart", "PreCompact", "Stop", "PostToolUse"]) {
      check(`print: hooks.${name} present`, name in parsed.hooks, JSON.stringify(Object.keys(parsed.hooks)));
    }
    check("print: SubagentStart intentionally absent", !("SubagentStart" in parsed.hooks), JSON.stringify(Object.keys(parsed.hooks)));
    check("print: the sella appears in the printed block", JSON.stringify(parsed).includes("eng-lead"), JSON.stringify(parsed));

    // Usage error: unsupported --harness never silently no-ops.
    const bad = runHooks(["print", "--harness", "codex", "--sella", "eng-lead"]);
    check("print: unsupported --harness is a usage error", bad.exitCode === 2, String(bad.exitCode));
  }

  // ---- 5. hooks check: dead with no receipts, alive after hook-event start -
  {
    const dir = freshStudio("check");
    const before = await capture(() => runHooks(["check", "--harness", "claude-code", "--studio", dir]));
    check("check: exitCode 0", before.result.exitCode === 0, String(before.result.exitCode));
    check(
      "check: builder-1 reported dead before any receipt exists",
      before.logs.some((l) => l.includes("builder-1") && l.includes("dead")),
      JSON.stringify(before.logs),
    );

    const startPayload = JSON.stringify({ session_id: "sess-live", cwd: dir });
    const started = await runHookEvent(["start", "--sella", "builder-1", "--studio", dir], { now: NOW, stdin: stdinOf(startPayload) });
    check("check setup: hook-event start succeeded", started.exitCode === 0, String(started.exitCode));

    const after = await capture(() => runHooks(["check", "--harness", "claude-code", "--studio", dir]));
    check(
      "check: builder-1 reported alive after hook-event start",
      after.logs.some((l) => l.includes("builder-1") && l.includes("alive")),
      JSON.stringify(after.logs),
    );
    check(
      "check: an untouched sella (builder-2) is still dead",
      after.logs.some((l) => l.includes("builder-2") && l.includes("dead")),
      JSON.stringify(after.logs),
    );
  }
  // ---- 6. check.ts's own `hook.dead` rule (advise), same shared logic -----
  {
    // A freshly-initialized-style studio (no receipts/ at all yet) must NOT
    // get a hook.dead advisory — this can't yet tell "hooks never wired"
    // apart from "nothing has run through any harness yet".
    const dirClean = freshStudio("check-rule-clean");
    const rClean = checkStudio(dirClean, NOW);
    check(
      "checkStudio: no hook.dead before the studio has any receipts/ at all",
      !rClean.findings.some((f) => f.rule === "hook.dead"),
      JSON.stringify(rClean.findings.filter((f) => f.rule === "hook.dead")),
    );

    // Once the studio has SOME receipt history, a sella still missing a
    // hook receipt among its recent ones is an advisory, never a block.
    const dir = freshStudio("check-rule");
    const started = await runHookEvent(["start", "--sella", "builder-1", "--studio", dir], {
      now: NOW,
      stdin: stdinOf(JSON.stringify({ session_id: "sess-checkrule", cwd: dir })),
    });
    check("check rule setup: hook-event start succeeded", started.exitCode === 0, String(started.exitCode));

    const r = checkStudio(dir, NOW);
    const dead = r.findings.filter((f) => f.rule === "hook.dead");
    check("checkStudio: hook.dead is advise-level, never block", dead.every((f) => f.level === "advise"), JSON.stringify(dead));
    check(
      "checkStudio: builder-2 (never run) flagged hook.dead",
      dead.some((f) => f.where.includes("builder-2")),
      JSON.stringify(dead),
    );
    check(
      "checkStudio: builder-1 (hook-started) NOT flagged hook.dead",
      !dead.some((f) => f.where.includes("receipts/builder-1")),
      JSON.stringify(dead),
    );
  }
  // ---- 7. hooks print: the printed command resolves argv when actually run
  {
    // BLOCKING #1 (verifier): a `NAME="value" ... cmd --flag "$NAME"` prefix
    // on one shell command line expands `$NAME` from the OUTER shell's
    // (unset) environment, not the same-line assignment — so every printed
    // command handed `--sella "$BISELLIUM_SELLA"` resolved to an empty
    // string. Reproduce end to end: print a real block, run its SessionStart
    // command through bash with an argv-echo `bisellium` stand-in on PATH,
    // and check what actually reached argv. Also doubles as the advise #2
    // shell-injection check: sella/studio here carry a single quote, a
    // double quote, `$HOME`, and a backtick — none of that may execute or
    // be dropped, and the literal round-trips exactly.
    const stubDir = makeArgvEchoStub();
    const sella = "builder-1";
    // A fresh, unique sentinel per run (not a fixed shared /tmp path) — a
    // leftover file from an earlier or concurrent run must never turn this
    // into a permanent false FAIL (or, worse, a false PASS after this test
    // itself fails to clean up).
    const pwnedSentinelDir = mkdtempSync(join(tmpdir(), "bisellium-argv-pwn-"));
    dirs.push(pwnedSentinelDir);
    const pwnedSentinel = join(pwnedSentinelDir, "qa-pwned-argv-test");
    const studio = `/tmp/weird "studio's" $HOME \`touch ${pwnedSentinel}\` dir`;
    const { result, logs } = await capture(() =>
      runHooks(["print", "--harness", "claude-code", "--sella", sella, "--studio", studio]),
    );
    check("print(argv): exitCode 0", result.exitCode === 0, String(result.exitCode));

    const parsed = JSON.parse(logs[0] ?? "{}") as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };

    for (const name of ["SessionStart", "PreCompact", "Stop", "PostToolUse"]) {
      const command = parsed.hooks[name]?.[0]?.hooks?.[0]?.command ?? "";
      check(
        `print(argv): ${name} command has no same-line env-var indirection`,
        !/\$BISELLIUM_|BISELLIUM_\w+=/.test(command),
        command,
      );
    }

    const sessionStartCmd = parsed.hooks["SessionStart"]?.[0]?.hooks?.[0]?.command ?? "";
    const run = spawnSync("bash", ["-c", sessionStartCmd], {
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
      encoding: "utf8",
    });
    check("print(argv): stub shell run exited 0", run.status === 0, JSON.stringify({ status: run.status, stderr: run.stderr }));
    const argv = (run.stdout ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(1, -1));
    // W-016: SessionStart's boot-context command moved from "bisellium
    // context" to "bisellium hook-event context" (behaviour 12).
    check("print(argv): subcommand is hook-event context", argv[0] === "hook-event" && argv[1] === "context", JSON.stringify(argv));
    check(
      "print(argv): --sella resolves to the literal sella, not empty",
      argv[argv.indexOf("--sella") + 1] === sella,
      JSON.stringify(argv),
    );
    check(
      "print(argv): --studio resolves to the literal studio, special chars intact",
      argv[argv.indexOf("--studio") + 1] === studio,
      JSON.stringify(argv),
    );
    check(
      "print(argv): backtick/$HOME inside the studio value never executed",
      !existsSync(pwnedSentinel),
      pwnedSentinel,
    );
  }

  // ---- 8. hook-event compact: timeline note written, trigger text redacted
  {
    // BLOCKING #2 (verifier): handleCompact wrote the raw payload `trigger`
    // straight into the timeline text with no redact() call, unlike every
    // other write path (talk.ts, tick.ts, receipts.ts, hook-event tool
    // above). A secret-shaped trigger survived verbatim on disk.
    const dir = freshStudio("compact");
    const sella = "builder-1";
    const secret = "abcdef1234567890abcdef";
    const payload = JSON.stringify({ session_id: `sess-compact-token=${secret}`, trigger: `manual token=${secret}` });
    const r = await runHookEvent(["compact", "--sella", sella, "--studio", dir], { now: NOW, stdin: stdinOf(payload) });
    check("compact: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const path = join(dir, "timeline", `${sella}.jsonl`);
    check("compact: timeline file written", existsSync(path), path);
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    check("compact: exactly one timeline entry", lines.length === 1, String(lines.length));
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    check("compact: kind is compact", entry["kind"] === "compact", JSON.stringify(entry));

    const text = String(entry["text"] ?? "");
    check("compact: trigger token= value is masked", text.includes("token=***"), text);
    check("compact: raw secret value is gone from text", !text.includes(secret), text);

    const sessionIdField = String(entry["sessionId"] ?? "");
    check("compact: sessionId is redacted too", !sessionIdField.includes(secret), sessionIdField);
  }

  // ---- 9. session_id / --sella path traversal never escapes the studio ----
  // session_id is external input (the harness writes the hook payload,
  // handleStart/handleStop pass it straight into receiptPath's join with no
  // validation); --sella is operator-controlled but joined the same way, so
  // the same guard should cover it too. Surplus "../" past the filesystem
  // root just clamps at "/" (Node's path.join), so the escape has to spell
  // the absolute target back out after enough "../" to guarantee reaching
  // root regardless of how deep the studio's own tmp dir happens to be —
  // exactly the shape of the verifier's own repro
  // (`../../../../../../tmp/qa-escape-receipt-397950`).
  // Returns the raw (no ".json") escaping path segment to hand the code
  // under test — receiptPath appends ".json" itself, so baking it into the
  // escape string here would just land one directory entry short (a
  // literal "....json.json" nobody's looking for).
  const escapeToward = (base: string): string => {
    const abs = join(tmpdir(), base);
    const climb = "../".repeat(12); // deeper than any temp studio nests
    return `${climb}${abs.replace(/^[/\\]+/, "")}`;
  };
  {
    const dir = freshStudio("traversal-start");
    const marker = `qa-escape-receipt-${process.pid}-${Date.now()}`;
    const evilSessionId = escapeToward(marker);
    const escapedPath = join(tmpdir(), `${marker}.json`);
    try {
      rmSync(escapedPath, { force: true });
    } catch {
      /* nothing to remove */
    }
    const payload = JSON.stringify({ session_id: evilSessionId, cwd: dir });
    const r = await runHookEvent(["start", "--sella", "builder-1", "--studio", dir], { now: NOW, stdin: stdinOf(payload) });
    check("traversal(start): still exits 0 (never blocks the harness)", r.exitCode === 0, String(r.exitCode));
    check("traversal(start): nothing written outside the studio dir", !existsSync(escapedPath), escapedPath);
    check("traversal(start): no receipt written inside the studio either", !existsSync(join(dir, "receipts")), "");
  }
  {
    const dir = freshStudio("traversal-stop");
    const marker = `qa-escape-receipt-stop-${process.pid}-${Date.now()}`;
    const evilSessionId = escapeToward(marker);
    const escapedPath = join(tmpdir(), `${marker}.json`);
    try {
      rmSync(escapedPath, { force: true });
    } catch {
      /* nothing to remove */
    }
    const payload = JSON.stringify({ session_id: evilSessionId });
    const r = await runHookEvent(["stop", "--sella", "builder-1", "--studio", dir], { now: NOW, stdin: stdinOf(payload) });
    check("traversal(stop): still exits 0 (never blocks the harness)", r.exitCode === 0, String(r.exitCode));
    check("traversal(stop): nothing written outside the studio dir", !existsSync(escapedPath), escapedPath);
  }
  {
    // An overly long session_id must not blow up into a giant stderr line
    // either (ENAMETOOLONG echoing the whole value) — same validation ought
    // to catch it before it ever reaches a path.
    const dir = freshStudio("traversal-long");
    const huge = "x".repeat(200_000);
    const payload = JSON.stringify({ session_id: huge, cwd: dir });
    const { result, errs } = await capture(() =>
      runHookEvent(["start", "--sella", "builder-1", "--studio", dir], { now: NOW, stdin: stdinOf(payload) }),
    );
    check("traversal(long): still exits 0", result.exitCode === 0, String(result.exitCode));
    check("traversal(long): stderr stays short (no echoed 200KB value)", errs.every((e) => e.length < 500), JSON.stringify(errs.map((e) => e.length)));
  }
  {
    // --sella itself is joined the same way (receipts/<sella>/, and
    // timeline/<sella>.jsonl for `compact`) — same containment discipline.
    const dir = freshStudio("traversal-sella");
    const markerDir = `qa-escape-sella-${process.pid}-${Date.now()}`;
    const evilSella = escapeToward(markerDir);
    const escapedDir = join(tmpdir(), markerDir);
    const escapedPath = join(escapedDir, "sess-fine.json");
    try {
      rmSync(escapedDir, { recursive: true, force: true });
    } catch {
      /* nothing to remove */
    }
    const payload = JSON.stringify({ session_id: "sess-fine", cwd: dir });
    const r = await runHookEvent(["start", "--sella", evilSella, "--studio", dir], { now: NOW, stdin: stdinOf(payload) });
    check("traversal(sella): still exits 0", r.exitCode === 0, String(r.exitCode));
    check("traversal(sella): nothing written outside the studio dir", !existsSync(escapedPath) && !existsSync(escapedDir), escapedPath);
  }

  // ---- 10. the printed SessionStart profile itself yields a shape-valid,
  // harness:"claude-code" receipt — not just `hook-event start` called
  // directly. Runs the actual printed command(s) through bash with the
  // argv-echo... no: SessionStart must run hook-event start for real, so
  // this drives runHookEvent the same way the profile's second command
  // would, and checks the result satisfies check.ts's receipt.shape rule
  // and hooks check's "alive" liveness — the two surfaces the previous
  // (context-only) SessionStart wiring left permanently unsatisfiable. ----
  {
    const parsed = claudeCodeHooksBlock({ sella: "builder-1", studio: "/studio" });
    const sessionStartCommands = (parsed.hooks["SessionStart"] as { hooks: { command: string }[] }[])[0]?.hooks.map((h) => h.command) ?? [];
    check(
      "SessionStart: the printed profile also runs hook-event start (not just context)",
      sessionStartCommands.some((c) => c.includes("hook-event start")),
      JSON.stringify(sessionStartCommands),
    );

    const dir = freshStudio("sessionstart-receipt");
    const started = await runHookEvent(["start", "--sella", "builder-1", "--studio", dir], {
      now: NOW,
      stdin: stdinOf(JSON.stringify({ session_id: "sess-real-session-start", cwd: dir })),
    });
    check("SessionStart wiring: hook-event start exits 0", started.exitCode === 0, String(started.exitCode));

    const r = checkStudio(dir, NOW);
    const shapeFindings = r.findings.filter((f) => f.rule === "receipt.shape");
    check("SessionStart wiring: no receipt.shape block finding", shapeFindings.length === 0, JSON.stringify(shapeFindings));

    const statuses = await capture(() => runHooks(["check", "--harness", "claude-code", "--studio", dir]));
    check(
      "SessionStart wiring: hooks check reports builder-1 alive",
      statuses.logs.some((l) => l.includes("builder-1") && l.includes("alive")),
      JSON.stringify(statuses.logs),
    );
  }
  // ---- 11. W-016 behaviour 12: `hook-event context` exits 0 within 2s on a
  // broken studio, a missing studio and a healthy one, and prints the boot
  // bundle on stdout. The printed profile uses `hook-event context` for
  // SessionStart and PreCompact, with every timeout in it 2. -----------------
  {
    const healthy = freshStudio("context-healthy");
    const missing = join(tmpdir(), `bisellium-context-missing-${process.pid}-${Date.now()}`);
    const broken = freshStudio("context-broken");
    writeFileSync(join(broken, "bisellium.yml"), "{not: yaml: [");

    for (const [label, dir] of [["healthy", healthy], ["missing", missing], ["broken", broken]] as const) {
      const t0 = Date.now();
      const { result, logs } = await capture(() =>
        runHookEvent(["context", "--sella", "eng-lead", "--studio", dir], { now: NOW, stdin: stdinOf("{}") }),
      );
      const elapsed = Date.now() - t0;
      check(`context(${label}): exitCode 0`, result.exitCode === 0, String(result.exitCode));
      check(`context(${label}): within 2s`, elapsed < 2000, `${elapsed}ms`);
      check(`context(${label}): something printed on stdout`, logs.length >= 1, JSON.stringify(logs));
    }
    const { logs: healthyLogs } = await capture(() =>
      runHookEvent(["context", "--sella", "eng-lead", "--studio", healthy], { now: NOW, stdin: stdinOf("{}") }),
    );
    check("context(healthy): boot bundle is non-empty", (healthyLogs[0] ?? "").length > 0, JSON.stringify(healthyLogs));

    const block = claudeCodeHooksBlock({ sella: "eng-lead", studio: "studio" });
    const sessionStart = (block.hooks["SessionStart"] as { hooks: { command: string; timeout: number }[] }[])[0]!.hooks;
    const preCompact = (block.hooks["PreCompact"] as { hooks: { command: string; timeout: number }[] }[])[0]!.hooks;
    const stop = (block.hooks["Stop"] as { hooks: { command: string; timeout: number }[] }[])[0]!.hooks;
    const postToolUse = (block.hooks["PostToolUse"] as { hooks: { command: string; timeout: number }[] }[])[0]!.hooks;
    check(
      "print: SessionStart's boot-context command is hook-event context",
      sessionStart.some((h) => h.command.includes("hook-event context")),
      JSON.stringify(sessionStart),
    );
    check(
      "print: PreCompact runs hook-event context",
      preCompact.some((h) => h.command.includes("hook-event context")),
      JSON.stringify(preCompact),
    );
    const allHooks = [...sessionStart, ...preCompact, ...stop, ...postToolUse];
    check("print: every hook's timeout is 2", allHooks.every((h) => h.timeout === 2), JSON.stringify(allHooks.map((h) => h.timeout)));
  }

  // ---- 12. W-016 behaviour 13: hook-event tool never re-parses the whole
  // log (5000 lines, under 300ms, exactly one line appended), and redacts
  // `cwd` the same way `file_path` already is. -------------------------------
  {
    const dir = freshStudio("tool-perf");
    const logPath = join(dir, ".bisellium", "events.jsonl");
    mkdirSync(dirname(logPath), { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(JSON.stringify({ id: `seed:${i}`, name: "workflow.digest", ts: NOW.toISOString(), projectId: "sample-studio", attrs: {} }));
    }
    writeFileSync(logPath, lines.join("\n") + "\n");

    const secret = "abcdef1234567890";
    const payload = JSON.stringify({
      session_id: "sess-tool-perf",
      tool_name: "Write",
      tool_input: { file_path: "/repo/x.md", old_string: "a", new_string: "b" },
      cwd: `/repo/work?token=${secret}`,
    });
    const t0 = Date.now();
    const r = await runHookEvent(["tool", "--sella", "builder-1", "--studio", dir], { now: NOW, stdin: stdinOf(payload) });
    const elapsed = Date.now() - t0;
    check("tool(perf): exitCode 0", r.exitCode === 0, String(r.exitCode));
    check("tool(perf): finishes under 300ms with 5000 existing lines", elapsed < 300, `${elapsed}ms`);

    const after = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    check("tool(perf): exactly one line appended", after.length === 5001, String(after.length));
    const event = JSON.parse(after[after.length - 1] ?? "{}") as { attrs: Record<string, unknown> };
    const cwd = String(event.attrs["tool.cwd"] ?? "");
    check("tool(perf): cwd is present and masked like file_path", cwd.includes("token=***"), cwd);
    check("tool(perf): raw secret value is gone from cwd", !cwd.includes(secret), cwd);
  }

  // ---- 13. W-016 behaviour 14: sella is optional on ClaudeCodeHooksOpts —
  // omitted entirely strips --sella (and its placeholder), never substitutes
  // an empty string; a real sella still carries `--sella 'x'` on every
  // command (the existing profile test, #10 above, already covers that). ----
  {
    const noSella = claudeCodeHooksBlock({ studio: "studio" });
    const flat = JSON.stringify(noSella);
    check("claudeCodeHooksBlock({studio}): no command contains --sella", !flat.includes("--sella"), flat);
    check("claudeCodeHooksBlock({studio}): no leftover __SELLA__ placeholder", !flat.includes("__SELLA__"), flat);

    const withSella = claudeCodeHooksBlock({ sella: "eng-lead", studio: "studio" });
    const sessionStartCmds = (withSella.hooks["SessionStart"] as { hooks: { command: string }[] }[])[0]!.hooks.map((h) => h.command);
    check(
      "claudeCodeHooksBlock({sella}): every SessionStart command carries --sella 'eng-lead'",
      sessionStartCmds.every((c) => c.includes("--sella 'eng-lead'")),
      JSON.stringify(sessionStartCmds),
    );
  }
  // ---- W-089 behaviour 8: process.cascade stops guessing from a prefix —
  // `hooks.ts:378`'s `!sella.startsWith("builder")` becomes a `resolveSeat`
  // lookup. Suppressed only for the two live builder-class templates
  // (behaviour 4); retired, unknown, prefix-only-lookalike and non-builder
  // seats all still warn. A dedicated manifest (not sample-studio) so a
  // `builder-codex` row can be declared. --------------------------------
  {
    const dir = mkdtempSync(join(tmpdir(), "hooks-cascade-"));
    writeFileSync(
      join(dir, "bisellium.yml"),
      `bisellium: 1
studio: Cascade Guard Test Studio
patron: patron
collegia:
  - { id: engineering, name: Engineering, magister: builder }
sellae:
  - { id: builder, collegium: engineering, kind: agent }
  - { id: builder-codex, collegium: engineering, kind: agent, harness: codex }
  - { id: builder-a, collegium: engineering, kind: agent, retired: true }
  - { id: eng-lead, collegium: engineering, kind: agent }
probationes: []
`,
    );
    const toolPayload = (sella: string) => {
      const p = JSON.stringify({ session_id: `sess-${sella}`, tool_name: "Write", tool_input: { file_path: "/repo/src/index.ts" } });
      return runHookEvent(["tool", "--sella", sella, "--studio", dir], { now: NOW, stdin: stdinOf(p) });
    };

    const noWarnCases = ["builder.W-100", "builder-codex.W-100"];
    for (const sella of noWarnCases) {
      const { errs } = await capture(() => toolPayload(sella));
      check(`cascade guard: "${sella}" (live builder-class) writes silently`, errs.length === 0, JSON.stringify(errs));
    }

    const warnCases = ["builder-a", "builder-a.W-100", "builderish", "eng-lead", "ghost"];
    for (const sella of warnCases) {
      const { errs } = await capture(() => toolPayload(sella));
      check(`cascade guard: "${sella}" still warns`, errs.some((e) => e.includes("process.cascade")), JSON.stringify(errs));
    }
  }

  // ---- W-089 behaviour 5: hook-event start/stop/compact refuse a bare
  // builder-class template — no --opus to mint from, so it must already
  // arrive as a minted instance (via $BISELLIUM_SELLA) — before any
  // receipt or timeline write. A non-builder-class sella (including a
  // retired letter) is unaffected. -------------------------------------------
  {
    const dir = freshStudio("w089-b5-hookevent");
    const bareStart = await runHookEvent(["start", "--sella", "builder", "--studio", dir], {
      now: NOW,
      stdin: stdinOf(JSON.stringify({ session_id: "sess-bare" })),
    });
    check("w089 b5: hook-event start on a bare template exits 0 (never blocks the harness)", bareStart.exitCode === 0, String(bareStart.exitCode));
    check("w089 b5: hook-event start on a bare template writes no receipt", !existsSync(join(dir, "receipts", "builder")), "");

    const instanceStart = await runHookEvent(["start", "--sella", "builder.W-300", "--studio", dir], {
      now: NOW,
      stdin: stdinOf(JSON.stringify({ session_id: "sess-instance" })),
    });
    check("w089 b5: hook-event start on a minted instance exits 0", instanceStart.exitCode === 0, String(instanceStart.exitCode));
    check(
      "w089 b5: hook-event start on a minted instance writes its receipt",
      existsSync(receiptPath(dir, "builder.W-300", "sess-instance")),
      "",
    );

    const bareCompact = await runHookEvent(["compact", "--sella", "builder", "--studio", dir], { now: NOW, stdin: stdinOf("{}") });
    check("w089 b5: hook-event compact on a bare template exits 0", bareCompact.exitCode === 0, String(bareCompact.exitCode));
    check(
      "w089 b5: hook-event compact on a bare template writes no timeline",
      !existsSync(join(dir, "timeline", "builder.jsonl")),
      "",
    );

    // Unaffected: a non-builder-class sella, retired letter included.
    const retiredStart = await runHookEvent(["start", "--sella", "builder-1", "--studio", dir], {
      now: NOW,
      stdin: stdinOf(JSON.stringify({ session_id: "sess-retired" })),
    });
    check("w089 b5: hook-event start on a non-builder-class (retired) sella still writes", instanceStart.exitCode === 0 && existsSync(receiptPath(dir, "builder-1", "sess-retired")), String(retiredStart.exitCode));
  }

  // ---- Censor W-089 round-2, finding B3: hookReceiptStatuses enumerates
  // the actual receipts/ directory, not just declared row ids
  // (receiptStatus.ts:74 used to map declared rows straight to
  // receipts/<row.id>/, so an instance directory — receipts/builder.W-089/
  // — was invisible, and an unknown directory — receipts/ghost.dir/ — was
  // silently ignored). Two requirements: an instance directory attributes
  // to its template row's harness with real (not fabricated) liveness; an
  // unknown directory is reported as unknown, never dropped and never given
  // a fabricated dead/alive verdict. Both `hooks check` (hooks.ts) and
  // `check`'s `hook.dead` rule (check.ts) share the one function — both are
  // exercised here so they can't silently disagree. -------------------------
  {
    const dir = freshStudio("w089-b3-receipt-enum");

    // An instance directory: a real hook-written receipt under the live
    // "builder" template's own instance form.
    const instanceStart = await runHookEvent(["start", "--sella", "builder.W-089", "--studio", dir], {
      now: NOW,
      stdin: stdinOf(JSON.stringify({ session_id: "sess-b3-instance", cwd: dir })),
    });
    check("w089 b3 setup: hook-event start on the instance succeeded", instanceStart.exitCode === 0, String(instanceStart.exitCode));

    // An unknown directory: nothing declared resolves "ghost.dir" — not a
    // seat, not an instance of one, just a stray directory under receipts/.
    mkdirSync(join(dir, "receipts", "ghost.dir"), { recursive: true });
    writeFileSync(
      join(dir, "receipts", "ghost.dir", "sess-ghost.json"),
      JSON.stringify({ sella: "ghost.dir", sessionId: "sess-ghost", startedAt: NOW.toISOString(), harness: "claude-code" }),
    );

    const { logs } = await capture(() => runHooks(["check", "--harness", "claude-code", "--studio", dir]));
    check(
      "w089 b3: hooks check attributes the instance directory to builder's harness, alive",
      logs.some((l) => l.includes("builder.W-089") && l.includes("harness=claude-code") && l.includes("alive")),
      JSON.stringify(logs),
    );
    check(
      "w089 b3: hooks check reports the unknown directory as unknown, not dead/alive",
      logs.some((l) => l.includes("ghost.dir") && l.includes("unknown")) &&
        !logs.some((l) => l.includes("ghost.dir") && (l.includes(" dead") || l.includes(" alive"))),
      JSON.stringify(logs),
    );

    const r = checkStudio(dir, NOW);
    const dead = r.findings.filter((f) => f.rule === "hook.dead");
    check(
      "w089 b3: checkStudio does not flag the live instance directory hook.dead",
      !dead.some((f) => f.where.includes("builder.W-089")),
      JSON.stringify(dead),
    );
    const unknownFindings = r.findings.filter((f) => f.rule === "hook.unknown");
    check(
      "w089 b3: checkStudio reports the unknown directory via a dedicated rule, not hook.dead",
      unknownFindings.some((f) => f.where.includes("ghost.dir")) && !dead.some((f) => f.where.includes("ghost.dir")),
      JSON.stringify({ unknownFindings, dead }),
    );
    check("w089 b3: hook.unknown is advisory, never block", unknownFindings.every((f) => f.level === "advise"), JSON.stringify(unknownFindings));
  }

  // ---- Sec-lead W-089 pass: enumeration must not follow a symlinked
  // receipts root, sella directory, or receipt file. The outside receipts
  // are deliberately valid hook receipts: a following implementation calls
  // them alive, while a non-following implementation cannot observe them. --
  {
    const dir = freshStudio("w089-sec-symlinks");
    const outside = mkdtempSync(join(tmpdir(), "bisellium-hooks-w089-sec-outside-"));
    dirs.push(outside);

    const outsideEvil = join(outside, "evil");
    mkdirSync(outsideEvil, { recursive: true });
    writeFileSync(
      join(outsideEvil, "sess-evil.json"),
      JSON.stringify({ sella: "evil", sessionId: "sess-evil", startedAt: NOW.toISOString(), harness: "claude-code" }),
    );
    mkdirSync(join(dir, "receipts"), { recursive: true });
    symlinkSync(outsideEvil, join(dir, "receipts", "evil"));

    const outsideInstance = join(outside, "builder.W-evil");
    mkdirSync(outsideInstance, { recursive: true });
    writeFileSync(
      join(outsideInstance, "sess-seat-link.json"),
      JSON.stringify({ sella: "builder.W-evil", sessionId: "sess-seat-link", startedAt: NOW.toISOString(), harness: "claude-code" }),
    );
    symlinkSync(outsideInstance, join(dir, "receipts", "builder.W-evil"));

    const realInstance = join(dir, "receipts", "builder.W-file-link");
    mkdirSync(realInstance, { recursive: true });
    const outsideReceipt = join(outside, "sess-file-link.json");
    writeFileSync(
      outsideReceipt,
      JSON.stringify({ sella: "builder.W-file-link", sessionId: "sess-file-link", startedAt: NOW.toISOString(), harness: "claude-code" }),
    );
    symlinkSync(outsideReceipt, join(realInstance, "sess-file-link.json"));

    const { logs } = await capture(() => runHooks(["check", "--harness", "claude-code", "--studio", dir]));
    check("w089 security: receipts/evil symlink is not enumerated", !logs.some((line) => line.includes("evil:")), JSON.stringify(logs));
    check(
      "w089 security: symlinked instance directory is not followed",
      !logs.some((line) => line.includes("builder.W-evil")),
      JSON.stringify(logs),
    );
    check(
      "w089 security: symlinked receipt file is not read",
      logs.some((line) => line.includes("builder.W-file-link") && line.includes("last=none") && line.includes("dead")) &&
        !logs.some((line) => line.includes("sess-file-link")),
      JSON.stringify(logs),
    );

    const rootLinkStudio = freshStudio("w089-sec-root-link");
    const linkedRoot = join(outside, "receipts-root");
    mkdirSync(join(linkedRoot, "builder"), { recursive: true });
    writeFileSync(
      join(linkedRoot, "builder", "sess-root-link.json"),
      JSON.stringify({ sella: "builder", sessionId: "sess-root-link", startedAt: NOW.toISOString(), harness: "claude-code" }),
    );
    symlinkSync(linkedRoot, join(rootLinkStudio, "receipts"));
    const { logs: rootLogs } = await capture(() => runHooks(["check", "--harness", "claude-code", "--studio", rootLinkStudio]));
    check(
      "w089 security: symlinked receipts root is not followed",
      rootLogs.some((line) => line.includes("builder:") && line.includes("last=none") && line.includes("dead")) &&
        !rootLogs.some((line) => line.includes("sess-root-link")),
      JSON.stringify(rootLogs),
    );
  }

  // ---- Sec-lead W-089 pass: filesystem names are untrusted diagnostic
  // data. Both plaintext reporting boundaries must strip controls/newlines
  // and cap the rendered label; the status object may retain the raw name. --
  {
    const dir = freshStudio("w089-sec-hostile-name");
    const hostile = `builder.W-hostile\n\u001b[31m-${"x".repeat(180)}`;
    mkdirSync(join(dir, "receipts", hostile), { recursive: true });

    const { logs } = await capture(() => runHooks(["check", "--harness", "claude-code", "--studio", dir]));
    const hookLine = logs.find((line) => line.includes("builder.W-hostile"));
    check(
      "w089 security: hooks check sanitizes hostile enumerated name",
      hookLine !== undefined && !/[\u0000-\u001f\u007f-\u009f]/u.test(hookLine) && hookLine.length <= 220 && hookLine.includes("..."),
      JSON.stringify(hookLine),
    );

    const result = checkStudio(dir, NOW);
    const finding = result.findings.find((row) => row.rule === "hook.dead" && row.where.includes("builder.W-hostile"));
    check(
      "w089 security: check finding sanitizes hostile enumerated name",
      finding !== undefined &&
        !/[\u0000-\u001f\u007f-\u009f]/u.test(`${finding.where}${finding.message}`) &&
        finding.where.length <= 130 &&
        finding.message.length <= 260 &&
        finding.where.includes("..."),
      JSON.stringify(finding),
    );
  }
} finally {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

process.exit(failed ? 1 : 0);
