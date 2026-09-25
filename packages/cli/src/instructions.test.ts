/**
 * Tests for `bisellium instructions` (W-017): CLAUDE.md/AGENTS.md/GLOSSARY.md
 * render from the manifest, deterministically, under the 6,000-character
 * cap; `instructions.present` / `cap.instructions` / `instructions.stale`
 * advise correctly; the `.claude/` artifacts are structurally sound. `now`
 * is pinned (dossier convention) though the render itself must carry no
 * timestamps regardless of `now`.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderInstructions, runInstructions } from "./instructions.js";
import { checkInstructions } from "./rules/instructions.js";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";

const repo = resolve(process.argv[2] ?? ".");
const NOW = new Date("2026-09-18T20:00:00Z");
const CAP = 6000;

let failed = 0;
const report = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
  if (!ok) failed++;
};

function withTempCopy<T>(srcDir: string, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-instructions-"));
  try {
    cpSync(srcDir, dir, { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Captures console.log/console.error lines during `fn`, restoring both afterward. */
function captureConsole<T>(fn: () => T): { result: T; logs: string[]; errs: string[] } {
  const logs: string[] = [];
  const errs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errs.push(args.map(String).join(" "));
  try {
    const result = fn();
    return { result, logs, errs };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

// ---------------------------------------------------------------------------
// 1. renderInstructions is deterministic: byte-identical across calls, no
//    timestamps, no absolute paths.
// ---------------------------------------------------------------------------
{
  const a = renderInstructions(join(repo, "studio"), { now: NOW });
  const b = renderInstructions(join(repo, "studio"), { now: NOW });
  const identical = a.claude === b.claude && a.agents === b.agents && a.glossary === b.glossary;
  report("render.deterministic", identical, identical ? "byte-identical across two calls" : "differed between calls");

  const later = renderInstructions(join(repo, "studio"), { now: new Date("2030-01-01T00:00:00Z") });
  const sameAcrossNow = later.claude === a.claude && later.agents === a.agents && later.glossary === a.glossary;
  report("render.no-timestamps", sameAcrossNow, sameAcrossNow ? "unaffected by `now`" : "content changed with `now`");

  const all = [a.claude, a.agents, a.glossary].join("\n");
  const leaked = all.includes(repo) || /[A-Za-z]:\\/.test(all) || /\/home\/[a-z]+\//.test(all) || all.includes(tmpdir());
  report("render.no-absolute-paths", !leaked, leaked ? "leaked an absolute path" : "clean");
}

// ---------------------------------------------------------------------------
// 2. both officinae render under the 6,000-character cap.
// ---------------------------------------------------------------------------
for (const officina of ["studio", "examples/sample-studio"]) {
  const r = renderInstructions(join(repo, officina), { now: NOW });
  const sizes = { claude: r.claude.length, agents: r.agents.length, glossary: r.glossary.length };
  const ok = sizes.claude < CAP && sizes.agents < CAP && sizes.glossary < CAP;
  report(`render.under-cap[${officina}]`, ok, JSON.stringify(sizes));
}

// ---------------------------------------------------------------------------
// 3. reading the manifest: a new collegium changes the rendered roles section.
// ---------------------------------------------------------------------------
withTempCopy(join(repo, "studio"), (dir) => {
  const before = renderInstructions(dir, { now: NOW });
  const manifestPath = join(dir, "bisellium.yml");
  const manifest = readFileSync(manifestPath, "utf8");
  const patched = manifest.replace(
    /(collegia:\n(?:  - .*\n)+)/,
    (m) => `${m}  - { id: design, name: Design, magister: design-lead, lex: leges/design.md }\n`,
  );
  const changedSource = patched !== manifest;
  report("render.manifest-edit-applies", changedSource, changedSource ? "collegia block patched" : "regex did not match bisellium.yml's collegia block");
  writeFileSync(manifestPath, patched, "utf8");
  const after = renderInstructions(dir, { now: NOW });
  const changed = after.claude !== before.claude && after.claude.includes("design");
  report("render.reads-manifest", changed, changed ? "roles section reflects the added collegium" : "render unchanged after manifest edit");
});

// ---------------------------------------------------------------------------
// 4. `bisellium instructions` argv behaviour.
// ---------------------------------------------------------------------------
withTempCopy(join(repo, "studio"), (dir) => {
  const printed = captureConsole(() => runInstructions(["--studio", dir], { now: NOW }));
  report("run.print.exit0", printed.result.exitCode === 0, `exitCode ${printed.result.exitCode}`);
  const printedAll = printed.logs.join("\n");
  const gotAll =
    printedAll.includes("Standing rules") && printedAll.includes("Glossary") && !existsSync(join(dir, "CLAUDE.md"));
  report("run.print.stdout-all-three-writes-nothing", gotAll, gotAll ? "printed and nothing written" : printedAll.slice(0, 200));

  const written = runInstructions(["--studio", dir, "--repo", dir, "--write"], { now: NOW });
  report("run.write.exit0", written.exitCode === 0, `exitCode ${written.exitCode}`);
  const allWritten = existsSync(join(dir, "CLAUDE.md")) && existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "GLOSSARY.md"));
  report("run.write.writes-three-files", allWritten, allWritten ? "CLAUDE.md, AGENTS.md, GLOSSARY.md written" : "missing a file");

  const bad = captureConsole(() => runInstructions(["--bogus"], { now: NOW }));
  const usageOk = bad.result.exitCode === 2 && bad.errs.some((l) => /usage/i.test(l));
  report("run.unknown-flag.exit2-usage", usageOk, `exitCode ${bad.result.exitCode}, stderr: ${bad.errs.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// 5. `bisellium init` writes CLAUDE.md and AGENTS.md; the fresh studio
//    passes check with zero blocking findings.
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-init-instructions-"));
  try {
    const init = initStudio(dir, { now: NOW });
    report("init.ok", init.ok, init.ok ? "created" : init.message);
    const wrote = existsSync(join(dir, "CLAUDE.md")) && existsSync(join(dir, "AGENTS.md"));
    report("init.writes-claude-and-agents", wrote, wrote ? "both written" : "missing a file");
    const checked = checkStudio(dir, NOW);
    report("init.check.zero-blocking", checked.ok, checked.ok ? "0 blocking" : JSON.stringify(checked.findings.filter((f) => f.level === "block")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. instructions.present.
// ---------------------------------------------------------------------------
{
  const none = checkInstructions(join(repo, "studio"), { now: NOW });
  report("check.absent-repo.returns-empty", none.length === 0, JSON.stringify(none));
}
withTempCopy(join(repo, "studio"), (dir) => {
  const missing = checkInstructions(dir, { now: NOW, repo: dir });
  const fired = missing.some((f) => f.rule === "instructions.present");
  report("check.present.fires-when-neither-file", fired, JSON.stringify(missing.map((f) => f.rule)));

  writeFileSync(join(dir, "AGENTS.md"), "placeholder", "utf8");
  const oneExists = checkInstructions(dir, { now: NOW, repo: dir });
  const cleared = !oneExists.some((f) => f.rule === "instructions.present");
  report("check.present.clears-when-one-exists", cleared, JSON.stringify(oneExists.map((f) => f.rule)));
});

// ---------------------------------------------------------------------------
// 7. cap.instructions.
// ---------------------------------------------------------------------------
withTempCopy(join(repo, "studio"), (dir) => {
  writeFileSync(join(dir, "CLAUDE.md"), "x".repeat(CAP + 1), "utf8");
  writeFileSync(join(dir, "AGENTS.md"), renderInstructions(dir, { now: NOW }).agents, "utf8");
  writeFileSync(join(dir, "GLOSSARY.md"), renderInstructions(dir, { now: NOW }).glossary, "utf8");
  const over = checkInstructions(dir, { now: NOW, repo: dir });
  const overFinding = over.find((f) => f.rule === "cap.instructions");
  const firesOver = overFinding !== undefined && overFinding.message.includes("CLAUDE.md") && /\d/.test(overFinding.message);
  report("check.cap.fires-over-cap", firesOver, JSON.stringify(over.filter((f) => f.rule === "cap.instructions")));

  writeFileSync(join(dir, "CLAUDE.md"), renderInstructions(dir, { now: NOW }).claude, "utf8");
  const under = checkInstructions(dir, { now: NOW, repo: dir });
  const clearsUnder = !under.some((f) => f.rule === "cap.instructions");
  report("check.cap.clears-under-cap", clearsUnder, JSON.stringify(under.filter((f) => f.rule === "cap.instructions")));
});

// ---------------------------------------------------------------------------
// 8. instructions.stale.
// ---------------------------------------------------------------------------
withTempCopy(join(repo, "studio"), (dir) => {
  writeFileSync(join(dir, "CLAUDE.md"), "stale content", "utf8");
  const stale = checkInstructions(dir, { now: NOW, repo: dir });
  const staleFires = stale.some((f) => f.rule === "instructions.stale");
  report("check.stale.fires-on-mismatch", staleFires, JSON.stringify(stale.map((f) => f.rule)));

  runInstructions(["--studio", dir, "--repo", dir, "--write"], { now: NOW });
  const fresh = checkInstructions(dir, { now: NOW, repo: dir });
  const staleClears = !fresh.some((f) => f.rule === "instructions.stale");
  report("check.stale.clears-after-write", staleClears, JSON.stringify(fresh.map((f) => f.rule)));
});

// ---------------------------------------------------------------------------
// 9. .claude/settings.json structure.
// ---------------------------------------------------------------------------
{
  const settingsPath = join(repo, ".claude", "settings.json");
  const exists = existsSync(settingsPath);
  report("settings.exists", exists, settingsPath);
  if (exists) {
    let parsed: unknown;
    let parseOk = true;
    try {
      parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (e) {
      parseOk = false;
      parsed = undefined;
      report("settings.parses", false, (e as Error).message);
    }
    if (parseOk) {
      report("settings.parses", true, "ok");
      const obj = parsed as Record<string, unknown>;
      const hooks = obj["hooks"] as Record<string, unknown> | undefined;
      const keys = hooks ? Object.keys(hooks).sort() : [];
      const wantKeys = ["PostToolUse", "PreCompact", "SessionStart", "Stop"].sort();
      report("settings.hook-keys", JSON.stringify(keys) === JSON.stringify(wantKeys), JSON.stringify(keys));

      const allCommands: string[] = [];
      const allTimeouts: number[] = [];
      let postToolUseMatcher: string | undefined;
      for (const [name, groups] of Object.entries(hooks ?? {})) {
        for (const g of groups as { matcher?: string; hooks: { command: string; timeout: number }[] }[]) {
          if (name === "PostToolUse") postToolUseMatcher = g.matcher;
          for (const h of g.hooks) {
            allCommands.push(h.command);
            allTimeouts.push(h.timeout);
          }
        }
      }
      report("settings.timeouts-all-2", allTimeouts.length > 0 && allTimeouts.every((t) => t === 2), JSON.stringify(allTimeouts));
      report(
        "settings.commands-carry-studio-no-sella",
        allCommands.length > 0 && allCommands.every((c) => c.includes("--studio studio") && !c.includes("--sella")),
        JSON.stringify(allCommands),
      );
      report("settings.posttooluse-matcher", postToolUseMatcher === "Write|Edit", String(postToolUseMatcher));
      const perms = obj["permissions"] as { allow?: string[] } | undefined;
      report("settings.permissions-allow-workflow", !!perms?.allow?.includes("Workflow"), JSON.stringify(perms));
    }
  }
}

// ---------------------------------------------------------------------------
// 10. .claude/agents/*.md.
// ---------------------------------------------------------------------------
{
  const agentsDir = join(repo, ".claude", "agents");
  const wanted = ["builder", "censor", "architect", "clerk"];
  for (const name of wanted) {
    const p = join(agentsDir, `${name}.md`);
    const exists = existsSync(p);
    report(`agent.${name}.exists`, exists, p);
    if (!exists) continue;
    const text = readFileSync(p, "utf8");
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    const front = fmMatch?.[1] ?? "";
    const hasModel = /^model:/m.test(front);
    const hasTools = /^tools:/m.test(front);
    report(`agent.${name}.front-matter`, hasModel && hasTools, front.slice(0, 200));
    const hasLex = /@studio\/leges\/[a-z-]+\.md/.test(text);
    // W-089 behaviour 10: the builder agent's own boot line omits --sella
    // entirely (census F — a literal or shell-expanded flag both strand an
    // unset-env boot with an empty bundle) so the CLI's own
    // `--sella ?? $BISELLIUM_SELLA ?? "guest"` chain supplies the dispatched
    // instance. A fixed-seat agent (architect/censor/clerk) still names its
    // own sella explicitly — both forms are a valid boot line here.
    const hasContextLine = /bisellium context(?: --sella [\w-]+)? studio/.test(text);
    report(`agent.${name}.body`, hasLex && hasContextLine, hasLex ? (hasContextLine ? "ok" : "missing context line") : "missing lex reference");
  }
}

// ---------------------------------------------------------------------------
// 11. .claude/commands/*.md.
// ---------------------------------------------------------------------------
{
  const commandsDir = join(repo, ".claude", "commands");
  const table: Record<string, string> = {
    check: "bisellium check studio --repo .",
    verify: "bisellium verify <opus> --studio studio --repo .",
    talk: "bisellium talk --sella <id> --studio studio <message>",
    tick: "bisellium tick --studio studio",
  };
  for (const [name, invocation] of Object.entries(table)) {
    const p = join(commandsDir, `${name}.md`);
    const exists = existsSync(p);
    report(`command.${name}.exists`, exists, p);
    if (!exists) continue;
    const text = readFileSync(p, "utf8");
    report(`command.${name}.invocation`, text.includes(invocation), text);
  }
  // retro does not exist until W-018 lands (Seam S9) — exempted here, named for the record.
  const retroPath = join(commandsDir, "retro.md");
  if (existsSync(retroPath)) {
    const text = readFileSync(retroPath, "utf8");
    report("command.retro.invocation", text.includes("bisellium retro --cascade"), text);
  } else {
    report("command.retro.exempted(W-018)", true, "retro.md not required until W-018 lands");
  }
  const files = existsSync(commandsDir) ? readdirSync(commandsDir) : [];
  report("commands.dir.listing", true, JSON.stringify(files));
}

process.exit(failed ? 1 : 0);
