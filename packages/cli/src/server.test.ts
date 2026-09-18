/**
 * packages/cli/src/server.test.ts — W-016 (cascade-4 review): `bisellium
 * serve`'s own wiring, not apps/server's HTTP surface (that's
 * apps/server/test/server.test.ts, which drives `startServer` directly with
 * fakes/real @bisellium/commands functions it supplies itself). This file
 * checks that `runServe` (packages/cli/src/serve.ts) supplies the REAL
 * `checkStudio` (./check.js) and the REAL write commands
 * (@bisellium/commands) — the two things apps/server can no longer import
 * for itself — and generates/prints a write-auth token end to end through
 * the actual CLI entry point.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runServe } from "./serve.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-19T10:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-cli-serve-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

/** Captures the "listening on http://127.0.0.1:<port>" line runServe prints
 *  at start — RunServeResult itself only carries exitCode/token/close (the
 *  port is @bisellium/server's own concern, not the CLI wrapper's), so this
 *  is how a caller of the CLI (an operator reading the log, or this test)
 *  finds it. */
async function runServeCapturingPort(args: string[], now: Date): Promise<{ result: Awaited<ReturnType<typeof runServe>>; port: number }> {
  const origLog = console.log;
  let printed = "";
  console.log = (...a: unknown[]) => {
    printed += a.map(String).join(" ") + "\n";
  };
  let result: Awaited<ReturnType<typeof runServe>>;
  try {
    result = await runServe(args, { now });
  } finally {
    console.log = origLog;
  }
  const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(printed);
  return { result, port: m ? Number(m[1]) : -1 };
}

async function main(): Promise<void> {
  const dir = freshStudio("main");
  process.env["NODE_ENV"] = "test";

  const { result: started, port } = await runServeCapturingPort(["--studio", dir, "--port", "0", "--once"], NOW);
  try {
    check("runServe: exitCode 0", started.exitCode === 0, String(started.exitCode));
    check("runServe: a write-auth token is generated", typeof started.token === "string" && started.token.length >= 16, String(started.token));
    check("runServe: the printed 'listening on' line carries the actual port", port > 0, String(port));

    const base = `http://127.0.0.1:${port}`;

    // ---- checkStudio is the real one (./check.js), not a stub: /api/health
    // reflects an actual check run against this studio. ---------------------
    {
      const res = await fetch(`${base}/api/health`);
      const body = (await res.json()) as { ok?: boolean; blocks?: number; advisories?: number; findingsByRule?: unknown };
      check("serve wiring: /api/health 200", res.status === 200, String(res.status));
      check(
        "serve wiring: /api/health reflects a real checkStudio run (ok/blocks/advisories present)",
        typeof body.ok === "boolean" && typeof body.blocks === "number" && typeof body.advisories === "number",
        JSON.stringify(body),
      );
    }

    // ---- writes require the real generated token; the real @bisellium/
    // commands runGreenlight actually mutates the opus on disk. --------------
    {
      const noToken = await fetch(`${base}/api/greenlight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opus: "W-007" }),
      });
      check("serve wiring: a write with no token is refused (401)", noToken.status === 401, String(noToken.status));

      const withToken = await fetch(`${base}/api/greenlight`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bisellium-token": started.token! },
        body: JSON.stringify({ opus: "W-007" }),
      });
      const body = (await withToken.json()) as { ok?: boolean; exitCode?: number };
      check("serve wiring: a write with the real token succeeds (200, exitCode 0)", withToken.status === 200 && body.ok === true && body.exitCode === 0, JSON.stringify(body));

      const raw = readFileSync(join(dir, "opera", "W-007.md"), "utf8");
      check("serve wiring: the real runGreenlight actually mutated the opus on disk", /state:\s*greenlit/.test(raw), raw.slice(0, 200));
    }
  } finally {
    await started.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    process.exit(failed ? 1 : 0);
  });
