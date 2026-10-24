/**
 * W-398 row b1 (studio/briefs/W-398.md): `scripts/agent-workspace.sh verify` and `verify --inside` only read: a user
 * settings file that differs from the merge is a FAIL line naming what differs, never a write. node:test TAP, selected
 * by `--test-name-pattern='^W-398-b1\s'`. Every fixture (a home, the Patron's clone, an agent clone, a stand-in gh) lives
 * under the OS tmp dir; nothing here reads or writes the real ~/.claude, ~/projects, ~/.local/bin or the agent clone.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "agent-workspace.sh");
const MERGE = join(REPO, "scripts", "agent-settings-merge.mjs");
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w398-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function put(path: string, text: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  if (mode !== undefined) chmodSync(path, mode);
}
function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", ["-c", "init.defaultBranch=master", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

/** Every entry under `root`: its type, mode, size, mtime and (a file's) content hash, or (a link's) target. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const s = lstatSync(p);
      const kind = s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : "file";
      const body = kind === "file" ? createHash("sha256").update(readFileSync(p)).digest("hex") : "";
      out[p.slice(root.length)] = `${kind} ${s.mode} ${s.size} ${s.mtimeMs} ${body}`;
      if (kind === "dir") walk(p);
    }
  };
  walk(root);
  return out;
}

/** A home under a directory whose name holds a space, a quote and a non-ASCII letter: the Patron's clone and the agent
 *  clone (both git checkouts with no remote), a stand-in `gh` that refuses every call (no network), and no GUARD_BIN. */
function world(): { f: string; settings: string; verify: (...args: string[]) => { code: number | null; out: string } } {
  const f = join(tmp(), "home ü it's");
  mkdirSync(f);
  git(f, "init", "-q", "patron");
  git(f, "init", "-q", "agent");
  put(join(f, "stub", "gh"), "#!/bin/sh\nexit 1\n", 0o755);
  const verify = (...args: string[]): { code: number | null; out: string } => {
    const r = spawnSync("bash", [SCRIPT, "verify", ...args], {
      encoding: "utf8",
      cwd: f,
      env: { PATH: [join(f, "stub"), dirname(process.execPath), "/usr/bin", "/bin"].join(":"), HOME: f, PATRON_DIR: join(f, "patron"), AGENT_DIR: join(f, "agent"), AGENT_GH: join(f, "gh"), GUARD_BIN: join(f, "bin", "bisellium"), OLD_GUARD_DIR: join(f, "old guard") },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { f, settings: join(f, ".claude", "settings.json"), verify };
}

const LINE = "user settings hold every isolation entry";
/** The settings line and the indented lines under it. */
function settingsBlock(out: string): string[] {
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l.endsWith(` ${LINE}`));
  if (i < 0) return [];
  const block = [lines[i] ?? ""];
  for (const l of lines.slice(i + 1)) {
    if (!l.startsWith("  ")) break;
    block.push(l);
  }
  return block;
}

test("W-398-b1 behaviour 1: verify and verify --inside only read: a user settings file that differs from the merge is a FAIL naming what differs, and no file is written", () => {
  const w = world();
  const patron = realpathSync(join(w.f, "patron"));
  const agent = realpathSync(join(w.f, "agent"));
  const gh = join(w.f, "gh");
  const q = JSON.stringify;
  const old = new Date("2001-02-03T04:05:06Z");
  /** The settings file as `text`, its mtime set in the past, so an unchanged mtime is a real comparison. */
  const write = (text: string): void => {
    put(w.settings, text);
    utimesSync(w.settings, old, old);
  };

  // a file missing entries (and with the sandbox off): verify fails the line, names each missing entry, and writes nothing
  const text = '{\n  "model": "opus",\n  "sandbox": { "enabled": false }\n}\n';
  write(text);
  for (const args of [[], ["--inside"]]) {
    const what = `a differing file, verify ${args.join(" ")}`.trim();
    const before = snapshot(w.f);
    const r = w.verify(...args);
    assert.equal(readFileSync(w.settings, "utf8"), text, `${what}: the settings file is byte-identical`);
    assert.equal(lstatSync(w.settings).mtimeMs, old.getTime(), `${what}: its mtime is unchanged`);
    assert.deepEqual(readdirSync(dirname(w.settings)), ["settings.json"], `${what}: no backup was made`);
    assert.deepEqual(snapshot(w.f), before, `${what}: no file under the home changed`);
    assert.equal(r.code, 1, `${what}: verify exits 1: ${r.out}`);
    assert.deepEqual(
      settingsBlock(r.out),
      [
        `FAIL ${LINE}`,
        "  missing sandbox.enabled: true",
        ...["~/.ssh", "~/.git-credentials", "~/.config/gh"].map((d) => `  missing sandbox.filesystem.denyRead: ${q(d)}`),
        ...[patron, ...["packages", "apps", "adapters", "scripts"].map((d) => `${agent}/${d}`)].map((d) => `  missing sandbox.filesystem.denyWrite: ${q(d)}`),
        ...["Read(~/.ssh/**)", "Read(~/.git-credentials)", "Read(~/.config/gh/**)", `Edit(/${patron}/**)`, `Write(/${patron}/**)`].map((d) => `  missing permissions.deny: ${q(d)}`),
        `  missing env.GH_CONFIG_DIR: ${q(gh)}`,
      ],
      `${what}: the FAIL line names each entry the merge would add`,
    );
  }

  // the other forms of a differing file: each a FAIL naming why, the file and its folder unchanged
  const merged = (): string => {
    rmSync(join(w.f, ".claude"), { recursive: true, force: true });
    const r = spawnSync(process.execPath, [MERGE, w.settings, patron, gh, agent], { encoding: "utf8" });
    assert.equal(r.status, 0, `the merge CLI writes the fixture's merged file: ${r.stderr}`);
    return readFileSync(w.settings, "utf8");
  };
  const repeated = JSON.parse(merged()) as { sandbox: { filesystem: { denyRead: string[] } } };
  repeated.sandbox.filesystem.denyRead.push("~/.ssh");
  for (const [what, body, why] of [
    ["invalid JSON", "{ not json\n", `  ${w.settings} is not valid JSON (an object); left untouched`],
    ["a JSON array", "[]\n", `  ${w.settings} is not valid JSON (an object); left untouched`],
    ["a malformed sandbox shape", '{ "sandbox": { "filesystem": { "denyWrite": "/keep" } } }\n', `  ${w.settings}: sandbox.filesystem.denyWrite is not an array of strings; left untouched`],
    ["a repeated entry", `${JSON.stringify(repeated, null, 2)}\n`, `  ${w.settings} holds every entry, but the merge would rewrite it (a repeated entry)`],
  ] as const) {
    rmSync(join(w.f, ".claude"), { recursive: true, force: true });
    write(body);
    const before = snapshot(w.f);
    const r = w.verify();
    assert.equal(readFileSync(w.settings, "utf8"), body, `${what}: the settings file is byte-identical`);
    assert.equal(lstatSync(w.settings).mtimeMs, old.getTime(), `${what}: its mtime is unchanged`);
    assert.deepEqual(snapshot(w.f), before, `${what}: no file under the home changed`);
    assert.deepEqual(settingsBlock(r.out), [`FAIL ${LINE}`, why], `${what}: the FAIL line names why`);
  }

  // several wrong types at once (W-402 reports each; here the one line is not promised): a FAIL, and nothing is written,
  // whether merge() throws before --check names a type or not
  for (const [what, body] of [
    ["two wrong types at once, merge() throws", '{ "permissions": [], "env": "bad" }\n'],
    ["two wrong types at once, merge() does not throw", '{ "permissions": [], "env": [] }\n'],
  ] as const) {
    rmSync(join(w.f, ".claude"), { recursive: true, force: true });
    write(body);
    const before = snapshot(w.f);
    const r = w.verify();
    assert.equal(readFileSync(w.settings, "utf8"), body, `${what}: the settings file is byte-identical`);
    assert.equal(lstatSync(w.settings).mtimeMs, old.getTime(), `${what}: its mtime is unchanged`);
    assert.deepEqual(snapshot(w.f), before, `${what}: no file under the home changed`);
    assert.equal(settingsBlock(r.out)[0], `FAIL ${LINE}`, `${what}: verify fails the line`);
  }

  // an absent file stays absent (no folder is made); a folder at its path stays an empty folder
  rmSync(join(w.f, ".claude"), { recursive: true, force: true });
  const absent = w.verify();
  assert.equal(readdirSync(w.f).includes(".claude"), false, "an absent file: no ~/.claude was made");
  assert.deepEqual(settingsBlock(absent.out).slice(0, 2), [`FAIL ${LINE}`, `  ${w.settings} does not exist`], "an absent file: the FAIL line says so");
  mkdirSync(w.settings, { recursive: true });
  const folder = w.verify();
  assert.deepEqual(readdirSync(w.settings), [], "a folder at the settings path: it stays empty");
  assert.equal(settingsBlock(folder.out)[0], `FAIL ${LINE}`, "a folder at the settings path: verify fails the line");

  // a merged file passes the line with nothing under it, and is not touched either
  const done = merged();
  utimesSync(w.settings, old, old);
  const before = snapshot(w.f);
  const ok = w.verify("--inside");
  assert.deepEqual(settingsBlock(ok.out), [`ok ${LINE}`], "a merged file: ok, with no line under it");
  assert.equal(readFileSync(w.settings, "utf8"), done, "a merged file: byte-identical");
  assert.deepEqual(snapshot(w.f), before, "a merged file: no file under the home changed");
});
