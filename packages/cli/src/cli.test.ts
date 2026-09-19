/**
 * cli.test.ts — spawns the real CLI process (not the library functions
 * directly) and asserts exit codes and key output lines, so a bug in
 * main.ts's own argv handling or exit-code wiring can't hide behind unit
 * tests that call buildContext/answer/etc. in-process (W-004).
 *
 * `now` is pinned so age-derived text never drifts.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { USAGE } from "./usage.js";

const repo = resolve(process.argv[2] ?? ".");
const NOW = "2026-09-17T15:00:00Z";
const MAIN = "packages/cli/src/main.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(42)} ${detail}`);
  if (!ok) failed++;
};

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  const r = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...args], { cwd: repo, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A JS stack trace frame looks like "    at fn (file:line:col)" — never emit one to the user. */
const looksLikeStackTrace = (s: string): boolean => /\n\s*at\s+\S+.*:\d+:\d+/.test(s) || /^\s*at\s+\S+.*:\d+:\d+/.test(s);

const nonStudio = mkdtempSync(join(tmpdir(), "bisellium-cli-nonstudio-"));

try {
  // ---- check ----------------------------------------------------------------
  {
    const r = run(["check", nonStudio, "--now", NOW]);
    check("check: non-studio dir exits 2", r.status === 2, `status=${r.status}`);
  }

  // ---- query ------------------------------------------------------------------
  {
    const r = run(["query", "burn", "examples/sample-studio", "--now", NOW]);
    check(
      "query burn: sample-studio exits 0, mentions engineering",
      r.status === 0 && r.stdout.includes("engineering"),
      `status=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 120))}`,
    );
  }
  {
    const r = run(["query", "burn", nonStudio, "--now", NOW]);
    check(
      "query: non-studio dir exits 2, no stack trace",
      r.status === 2 && !looksLikeStackTrace(r.stderr) && !looksLikeStackTrace(r.stdout),
      `status=${r.status} stderr=${JSON.stringify(r.stderr)}`,
    );
  }
  // --from-index (W-013's index-backed answer path) must actually be
  // reachable from a user typing `bisellium query ... --from-index`, not
  // just from a library caller passing {fromIndex: true} directly.
  {
    const r = run(["query", "status W-002", "examples/sample-studio", "--now", NOW, "--from-index"]);
    check(
      "query --from-index: main.ts accepts the flag and exits 0",
      r.status === 0 && !/not allowed for/.test(r.stderr),
      `status=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 120))} stderr=${JSON.stringify(r.stderr)}`,
    );
  }

  // ---- hooks / hook-event: W-015's CLI surfaces dispatched via main.ts -------
  {
    const r = run(["hooks", "print", "--harness", "claude-code", "--sella", "eng-lead", "--studio", "examples/sample-studio"]);
    check("hooks print: dispatched through main.ts, exits 0", r.status === 0, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
    const parsesAsJson = (() => {
      try {
        JSON.parse(r.stdout);
        return true;
      } catch {
        return false;
      }
    })();
    check("hooks print: stdout is the hooks JSON block", parsesAsJson, r.stdout.slice(0, 200));
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "bisellium-cli-hookevent-"));
    try {
      cpSync("examples/sample-studio", dir, { recursive: true });
      const r = spawnSync(process.execPath, ["--import", "tsx", MAIN, "hook-event", "start", "--sella", "builder-1", "--studio", dir], {
        cwd: repo,
        encoding: "utf8",
        input: JSON.stringify({ session_id: "cli-wiring-test" }),
      });
      check("hook-event start: dispatched through main.ts, exits 0", r.status === 0, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
      const receiptFile = join(dir, "receipts", "builder-1", "cli-wiring-test.json");
      check("hook-event start: receipt written under the studio dir", existsSync(receiptFile), receiptFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- context ------------------------------------------------------------------
  {
    const r = run(["context", "--sella", "nobody", "examples/sample-studio", "--now", NOW]);
    check("context: unknown sella exits 1", r.status === 1, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }
  {
    const r = run(["context", "--sella", "builder-1", "--max-tokens", "300", "examples/sample-studio", "--now", NOW]);
    const truncIdx = r.stdout.indexOf("truncated:");
    const tokensIdx = r.stdout.indexOf("tokens:");
    check(
      "context: builder-1 max-tokens=300 exits 0, 'truncated:' before 'tokens:'",
      r.status === 0 && truncIdx !== -1 && tokensIdx !== -1 && truncIdx < tokensIdx,
      `status=${r.status} truncIdx=${truncIdx} tokensIdx=${tokensIdx}`,
    );
  }

  // ---- init + new: '=' inside a flag value round-trips -----------------------
  {
    const dir = mkdtempSync(join(tmpdir(), "bisellium-cli-init-"));
    try {
      const init = run(["init", dir, "--now", NOW]);
      check("init: temp dir exits 0", init.status === 0, `status=${init.status} stdout=${init.stdout}`);

      const title = "a=b: ship it";
      const newRun = run(["new", "--kind", "task", "--collegium", "production", `--title=${title}`, dir]);
      check("new: '--title=a=b: ship it' exits 0", newRun.status === 0, `status=${newRun.status} stderr=${newRun.stderr}`);

      const itemPath = join(dir, "opera", "W-001.md");
      const raw = readFileSync(itemPath, "utf8");
      check(
        "new: title with embedded '=' preserved verbatim",
        raw.includes(`title: ${JSON.stringify(title)}`),
        `raw=${JSON.stringify(raw)}`,
      );

      // A freshly-initialized studio must stay at 0 blocking / 0 advisory —
      // pins the property that init's seeded acta entry and .gitkeep-free
      // dirs are meant to guarantee. Any advisory that isn't aerarium-related
      // (a reintroduced .gitkeep, a dropped seeded acta entry, etc.) must
      // fail this.
      const afterInit = run(["check", dir, "--now", NOW]);
      const passLine = /PASS — 0 blocking, 0 advisory/.test(afterInit.stdout);
      const advisoryRuleIds = [...afterInit.stdout.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]);
      const nonAerariumRuleIds = advisoryRuleIds.filter((id) => !id!.startsWith("aerarium."));
      check(
        "check after init: 0 blocking, 0 advisory (no non-aerarium rule ids)",
        afterInit.status === 0 && passLine && nonAerariumRuleIds.length === 0,
        `status=${afterInit.status} nonAerariumRuleIds=${JSON.stringify(nonAerariumRuleIds)} stdout=${JSON.stringify(afterInit.stdout)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- new: not-a-studio ------------------------------------------------------
  {
    const r = run(["new", "--kind", "task", "--collegium", "production", "--title", "X", nonStudio]);
    check("new: non-studio dir exits 2", r.status === 2, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }

  // ---- unknown flag -------------------------------------------------------------
  {
    const r = run(["check", "examples/sample-studio", "--bogus"]);
    check("unknown flag exits 2", r.status === 2, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }

  // ---- per-command flag sets: a flag valid elsewhere must not silently no-op ----
  {
    const r = run(["check", "examples/sample-studio", "--sella", "builder-1", "--now", NOW]);
    check("check: --sella (a context-only flag) exits 2, not 0", r.status === 2, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }
  {
    const r = run(["query", "burn", "examples/sample-studio", "--level", "block", "--now", NOW]);
    check("query: --level (a check-only flag) exits 2", r.status === 2, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }

  // ---- --json is boolean: only --json / --json=true enable it ----------------
  {
    const r = run(["check", "examples/sample-studio", "--now", NOW, "--json=false"]);
    check(
      "check: --json=false does NOT enable JSON output",
      r.status === 0 && !r.stdout.trimStart().startsWith("{"),
      `status=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 40))}`,
    );
  }
  {
    const r = run(["check", "examples/sample-studio", "--now", NOW, "--json=true"]);
    check(
      "check: --json=true enables JSON output",
      r.status === 0 && r.stdout.trimStart().startsWith("{"),
      `status=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 40))}`,
    );
  }
  {
    const r = run(["check", "examples/sample-studio", "--now", NOW, "--json=maybe"]);
    check("check: --json=maybe exits 2", r.status === 2, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }
} finally {
  rmSync(nonStudio, { recursive: true, force: true });
}

// ---- serve: dispatched through main.ts, actually serves, dies on SIGTERM ---
// Spawned (not spawnSync) because the process never exits on its own — it's
// a long-running HTTP server, same as an operator would run it. `--port 0`
// picks a random free port so parallel test runs never collide.
async function testServeWiring(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-cli-serve-"));
  cpSync("examples/sample-studio", dir, { recursive: true });
  try {
    const child = spawn(process.execPath, ["--import", "tsx", MAIN, "serve", "--studio", dir, "--port", "0", "--once", "--now", NOW], {
      cwd: repo,
    });
    let stdout = "";
    let stderrBuf = "";
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderrBuf += c.toString()));

    const port = await new Promise<number | undefined>((resolvePort) => {
      const timer = setTimeout(() => resolvePort(undefined), 10_000);
      const tryMatch = () => {
        const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
        if (m) {
          clearTimeout(timer);
          resolvePort(Number(m[1]));
        }
      };
      child.stdout?.on("data", tryMatch);
      tryMatch();
    });
    check(
      "serve: dispatched through main.ts, prints its listening line",
      port !== undefined,
      `stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderrBuf)}`,
    );

    if (port !== undefined) {
      const officina = await fetch(`http://127.0.0.1:${port}/api/officina`);
      check("serve: GET /api/officina responds 200", officina.status === 200, String(officina.status));

      const inbox = await fetch(`http://127.0.0.1:${port}/api/inbox`);
      check("serve: GET /api/inbox responds 200", inbox.status === 200, String(inbox.status));

      const aerarium = await fetch(`http://127.0.0.1:${port}/api/aerarium`);
      check("serve: GET /api/aerarium responds 200", aerarium.status === 200, String(aerarium.status));

      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      check("serve: GET /api/health responds 200", health.status === 200, String(health.status));

      // This child was NOT given NODE_ENV=test, so the test-only manual
      // poll hook must refuse it, same as production.
      const poll = await fetch(`http://127.0.0.1:${port}/api/_poll`, { method: "POST" });
      check("serve: POST /api/_poll refused outside NODE_ENV=test", poll.status === 404, String(poll.status));
    }

    child.kill("SIGTERM");
    const exitedCleanly = await new Promise<boolean>((resolveExit) => {
      const timer = setTimeout(() => resolveExit(false), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveExit(true);
      });
    });
    check("serve: SIGTERM stops it (main.ts's runServeUntilStopped)", exitedCleanly, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await testServeWiring();

// ---- usage banner reachable from every error path (W-030 behaviour 6) -----
// main.ts's own comment table (FLAGS_BY_COMMAND) documents which commands
// route through the generic flag parser; these four are the paths that fall
// out the bottom of main() rather than into a command handler — the ones
// that matter for "does a wrong invocation ever get told the right shapes".
{
  const r = run([]);
  check("no args: prints banner, exits 2", r.status === 2 && r.stderr.includes(USAGE), `status=${r.status}`);
}
{
  const r = run(["wibble"]);
  check("unknown command: prints banner, exits 2", r.status === 2 && r.stderr.includes(USAGE), `status=${r.status}`);
}
{
  const r = run(["check", "--nope"]);
  check("unknown flag: prints banner, exits 2", r.status === 2 && r.stderr.includes(USAGE), `status=${r.status}`);
}
{
  const r = run(["--help"]);
  check("--help: prints banner, exits 2", r.status === 2 && r.stderr.includes(USAGE), `status=${r.status}`);
}

process.exit(failed ? 1 : 0);
