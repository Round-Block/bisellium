/**
 * W-398 row b1 (studio/briefs/W-398.md): `scripts/agent-workspace.sh verify` and `verify --inside` only read: a user
 * settings file that differs from the merge is a FAIL line naming what differs, never a write. node:test TAP, selected
 * by `--test-name-pattern='^W-398-b1\s'`. Every fixture (a home, the Patron's clone, an agent clone, a stand-in gh) lives
 * under the OS tmp dir; nothing here reads or writes the real ~/.claude, ~/projects, ~/.local/bin or the agent clone.
 * W-402 rows b1 and b2 (studio/briefs/W-402.md): --check names every wrong-type field, one line each in merge()'s order,
 * never Node's message; selected by `--test-name-pattern='^W-402-b<k>\s'`.
 * W-420 rows b1 and b2 (studio/briefs/W-420.md): verify, verify --inside and setup fail while the agent gh config holds
 * any login but the agent's own; selected by `--test-name-pattern='^W-420-b<k>\s'`.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

test("W-398-b3 behaviour 3: verify compares settings entries by their key paths: a literal dot in a key is never read as nesting, and a wrong type the merge would not refuse is named as one", () => {
  const w = world();
  const patron = realpathSync(join(w.f, "patron"));
  const agent = realpathSync(join(w.f, "agent"));
  const gh = join(w.f, "gh");
  const old = new Date("2001-02-03T04:05:06Z");
  rmSync(join(w.f, ".claude"), { recursive: true, force: true });
  const made = spawnSync(process.execPath, [MERGE, w.settings, patron, gh, agent], { encoding: "utf8" });
  assert.equal(made.status, 0, `the merge CLI writes the fixture's merged file: ${made.stderr}`);
  type Settings = { [k: string]: unknown; sandbox: { [k: string]: unknown }; env: { [k: string]: unknown } };
  const merged = JSON.parse(readFileSync(w.settings, "utf8")) as Settings;
  for (const [what, change, missing] of [
    // the reviewer's case (spec review 2): the entry moved to a top-level key that holds a dot
    ["a dotted top-level key in place of sandbox.enabled", (s: Settings) => { delete s.sandbox["enabled"]; s["sandbox.enabled"] = true; }, "  missing sandbox.enabled: true"],
    ["a dotted top-level key in place of env.GH_CONFIG_DIR", (s: Settings) => { delete s.env["GH_CONFIG_DIR"]; s["env.GH_CONFIG_DIR"] = gh; }, `  missing env.GH_CONFIG_DIR: ${JSON.stringify(gh)}`],
    // the same text from an array element where the merge sets a leaf
    ["an array where sandbox.enabled belongs", (s: Settings) => { s.sandbox["enabled"] = [true]; }, "  missing sandbox.enabled: true"],
    // an array where the merge sets properties: merge() writes them on the array, where no entry shows them
    ["an array where env belongs", (s: Settings) => { (s as Record<string, unknown>)["env"] = []; }, `  ${w.settings}: env is not an object; left untouched`],
    ["an array where permissions belongs", (s: Settings) => { (s as Record<string, unknown>)["permissions"] = []; }, `  ${w.settings}: permissions is not an object; left untouched`],
    // a string where the merge unions an array: merge() would spread it into its characters
    ["a string where sandbox.filesystem.denyRead belongs", (s: Settings) => { (s.sandbox["filesystem"] as Record<string, unknown>)["denyRead"] = "~/.ssh"; }, `  ${w.settings}: sandbox.filesystem.denyRead is not an array; left untouched`],
    ["a string where permissions.deny belongs", (s: Settings) => { ((s as Record<string, unknown>)["permissions"] as Record<string, unknown>)["deny"] = "Read(~/.ssh/**)"; }, `  ${w.settings}: permissions.deny is not an array; left untouched`],
  ] as const) {
    const s = structuredClone(merged);
    change(s);
    const body = `${JSON.stringify(s, null, 2)}\n`;
    put(w.settings, body);
    utimesSync(w.settings, old, old);
    const before = snapshot(w.f);
    const r = w.verify();
    assert.equal(readFileSync(w.settings, "utf8"), body, `${what}: the settings file is byte-identical`);
    assert.deepEqual(snapshot(w.f), before, `${what}: no file under the home changed`);
    assert.deepEqual(settingsBlock(r.out), [`FAIL ${LINE}`, missing], `${what}: the FAIL line names what the merge would change`);
  }
});

/** W-402: the fixture's merged file (written by the merge CLI) as an object, and a run of `--check` alone on a file. */
function mergedWorld(): { w: ReturnType<typeof world>; merged: Json; check: () => { code: number | null; stdout: string; stderr: string } } {
  const w = world();
  const patron = realpathSync(join(w.f, "patron"));
  const agent = realpathSync(join(w.f, "agent"));
  rmSync(join(w.f, ".claude"), { recursive: true, force: true });
  const made = spawnSync(process.execPath, [MERGE, w.settings, patron, join(w.f, "gh"), agent], { encoding: "utf8" });
  assert.equal(made.status, 0, `the merge CLI writes the fixture's merged file: ${made.stderr}`);
  const check = (): { code: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(process.execPath, [MERGE, "--check", w.settings, patron, join(w.f, "gh"), agent], { encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const merged = JSON.parse(readFileSync(w.settings, "utf8")) as Json;
  assert.ok(merged !== null && typeof merged === "object" && !Array.isArray(merged), "the merged file is a JSON object");
  assert.equal(check().code, 0, "the merged file passes --check before any change");
  return { w, merged, check };
}
type Json = { [k: string]: unknown };
/** `s` with `value` at the key-segment path `at` (every parent an object in `s`). */
function setAt(s: Json, at: readonly string[], value: unknown): Json {
  let o = s;
  for (const k of at.slice(0, -1)) o = o[k] as Json;
  o[at.at(-1) ?? ""] = value;
  return s;
}

test("W-402-b1 behaviour 1: a single wrong type at any field the merge reads is named by its key and the type it needs, never by Node's message", () => {
  const { w, merged, check } = mergedWorld();
  const old = new Date("2001-02-03T04:05:06Z");
  const write = (s: Json): string => {
    const body = `${JSON.stringify(s, null, 2)}\n`;
    put(w.settings, body);
    utimesSync(w.settings, old, old);
    return body;
  };

  // the review's field, through verify: merge() throws on a string at env; the FAIL line names env, not Node's message
  const body = write(setAt(structuredClone(merged), ["env"], "bad"));
  const before = snapshot(w.f);
  const r = w.verify();
  assert.deepEqual(settingsBlock(r.out), [`FAIL ${LINE}`, `  ${w.settings}: env is not an object; left untouched`], "a string where env belongs, verify: the FAIL line names env, not Node's message");
  assert.equal(readFileSync(w.settings, "utf8"), body, "a string where env belongs, verify: the settings file is byte-identical");
  assert.deepEqual(snapshot(w.f), before, "a string where env belongs, verify: no file under the home changed");

  // every JSON type that is wrong at each of the seven fields merge() reads, through --check alone: one line, on stdout
  // each wrong value with its name in the assertion text
  type Named = readonly [string, unknown];
  const v = { string: ["a string", "x"], number: ["a number", 1], boolean: ["a boolean", true], null: ["null", null], array: ["an array", []], object: ["an object", {}], mixed: ["an array holding a number", ["/keep", 1]] } satisfies Record<string, Named>;
  const object = [v.string, v.number, v.boolean, v.null, v.array];
  const array = [v.string, v.number, v.boolean, v.object];
  const fields: [string[], string, Named[]][] = [
    [["sandbox"], "an object", object],
    [["sandbox", "filesystem"], "an object", object],
    [["sandbox", "filesystem", "denyWrite"], "an array of strings", [v.string, v.number, v.boolean, v.null, v.object, v.mixed]],
    [["sandbox", "filesystem", "denyRead"], "an array", array],
    [["permissions"], "an object", [v.string, v.number, v.boolean, v.array]],
    [["permissions", "deny"], "an array", array],
    [["env"], "an object", [v.string, v.number, v.boolean, v.array]],
  ];
  for (const [at, type, values] of fields)
    for (const [name, value] of values) {
      const what = `${at.join(".")} as ${name}`;
      const text = write(setAt(structuredClone(merged), at, value));
      const c = check();
      assert.deepEqual([c.code, c.stdout, c.stderr], [1, `${w.settings}: ${at.join(".")} is not ${type}; left untouched\n`, ""], `${what}: --check prints its one line`);
      assert.equal(readFileSync(w.settings, "utf8"), text, `${what}: the settings file is byte-identical`);
    }

  // null where merge() reads `??` is absent, not a wrong type: --check names what the merge would add there, and only that
  const missing = (v: unknown, at: string): string[] =>
    Array.isArray(v) ? v.map((x) => `missing ${at}: ${JSON.stringify(x)}\n`) : v !== null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => missing(x, `${at}.${k}`)) : [`missing ${at}: ${JSON.stringify(v)}\n`];
  for (const at of [["sandbox", "filesystem", "denyRead"], ["permissions"], ["permissions", "deny"], ["env"]]) {
    let added: unknown = merged;
    for (const k of at) added = (added as Json)[k];
    write(setAt(structuredClone(merged), at, null));
    const c = check();
    assert.deepEqual([c.code, c.stdout, c.stderr], [1, missing(added, at.join(".")).join(""), ""], `${at.join(".")} as null: --check prints only missing lines`);
  }
});

test("W-402-b2 behaviour 2: several wrong types at once are each named, one line per field, in the order merge() reads them", () => {
  const { w, merged } = mergedWorld();
  const old = new Date("2001-02-03T04:05:06Z");
  const not = (key: string, type: string): string => `  ${w.settings}: ${key} is not ${type}; left untouched`;
  for (const [what, change, lines] of [
    // the review's case (ci/W-398-spec-4.log #1): merge() throws on env before permissions is named
    ["permissions [] and env a string", (s: Json) => setAt(setAt(s, ["permissions"], []), ["env"], "bad"), [not("permissions", "an object"), not("env", "an object")]],
    ["permissions [] and env []", (s: Json) => setAt(setAt(s, ["permissions"], []), ["env"], []), [not("permissions", "an object"), not("env", "an object")]],
    // the order is merge()'s, not the file's
    ["env a string, written before permissions []", (s: Json) => { const { env: _env, permissions: _permissions, ...rest } = s; return { env: "bad", ...rest, permissions: [] }; }, [not("permissions", "an object"), not("env", "an object")]],
    ["sandbox a string, permissions.deny a string and env a number", (s: Json) => setAt(setAt(setAt(s, ["sandbox"], "x"), ["permissions", "deny"], "Read(~/.ssh/**)"), ["env"], 5), [not("sandbox", "an object"), not("permissions.deny", "an array"), not("env", "an object")]],
    ["sandbox.filesystem an array, permissions a boolean and env an array", (s: Json) => setAt(setAt(setAt(s, ["sandbox", "filesystem"], []), ["permissions"], true), ["env"], []), [not("sandbox.filesystem", "an object"), not("permissions", "an object"), not("env", "an object")]],
    ["denyWrite a string, denyRead a number, permissions.deny an object and env a string", (s: Json) => setAt(setAt(setAt(setAt(s, ["sandbox", "filesystem", "denyWrite"], "/keep"), ["sandbox", "filesystem", "denyRead"], 7), ["permissions", "deny"], {}), ["env"], "bad"), [not("sandbox.filesystem.denyWrite", "an array of strings"), not("sandbox.filesystem.denyRead", "an array"), not("permissions.deny", "an array"), not("env", "an object")]],
    // the wrong types alone are named: a missing entry beside them prints no missing line
    ["permissions [] and env a string, with sandbox.enabled missing", (s: Json) => { delete (s["sandbox"] as Json)["enabled"]; return setAt(setAt(s, ["permissions"], []), ["env"], "bad"); }, [not("permissions", "an object"), not("env", "an object")]],
  ] as const) {
    const body = `${JSON.stringify(change(structuredClone(merged)), null, 2)}\n`;
    put(w.settings, body);
    utimesSync(w.settings, old, old);
    const before = snapshot(w.f);
    const r = w.verify();
    assert.deepEqual(settingsBlock(r.out), [`FAIL ${LINE}`, ...lines], `${what}: the FAIL line names every wrong field in merge()'s order`);
    assert.equal(readFileSync(w.settings, "utf8"), body, `${what}: the settings file is byte-identical`);
    assert.equal(lstatSync(w.settings).mtimeMs, old.getTime(), `${what}: its mtime is unchanged`);
    assert.deepEqual(snapshot(w.f), before, `${what}: no file under the home changed`);
  }
});

// W-420 (studio/briefs/W-420.md): verify, verify --inside and setup fail while the agent gh config ($AGENT_GH) holds any
// login but the agent's own ($AGENT_LOGIN, active on github.com). A stand-in gh answers from fixture files, never the
// network; nothing here reads the real ~/.config/agent-gh. Selected by `--test-name-pattern='^W-420-b<k>\s'`.

/** A token-shaped canary: the stand-in gh puts it in every account and on its stderr; no line the script prints holds it. */
const CANARY = "ghp_W420CANARY000000000000000000000000";
/** gh's ambient auth and host inputs (`gh help environment`, gh 2.101.0) and its forced-terminal inputs, by name. */
const AMBIENT = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_HOST", "GH_FORCE_TTY", "CLICOLOR_FORCE"];
const ghLine = (gh: string): string => `the agent gh config ${gh} holds only the agent's own login, active on github.com`;
/** A path single-quoted for the shell, as the judge prints it. */
const sq = (s: string): string => `'${s.split("'").join("'\\''")}'`;

/** A home (its name holds a space, a quote and a non-ASCII letter) whose agent gh config is `agent gh/`, and a stand-in
 *  gh that logs each call to a file outside the home (its config dir, which of AMBIENT reached it, its
 *  arguments). It answers `auth status --json hosts` with status.json's text, the canary on stderr and status.exit's code;
 *  `auth login` reads its stdin; `api repos/Round-Block/bisellium` prints the repo; every other call fails as a 404 would.
 *  A stand-in git and npm log (outside the home) and fail. The agent clone is a non-empty folder with no .git, so setup's next step refuses. */
function ghWorld(): {
  f: string;
  gh: string;
  status: (body: string, exit?: number) => void;
  hosts: (accounts: Record<string, unknown[]>) => void;
  log: string;
  logs: string;
  run: (args: string[], env?: Record<string, string>, input?: string) => { code: number | null; out: string };
  calls: () => string[];
} {
  const f = join(tmp(), "home ü it's");
  const logs = tmp();
  const log = join(logs, "gh.log");
  const gh = join(f, "agent gh");
  put(join(gh, "hosts.yml"), "# the fixture's config: the stand-in gh never reads it\n");
  put(join(f, "agent", "keep"), "not a clone\n");
  put(
    join(f, "stub", "gh"),
    [
      "#!/bin/sh",
      `printf '%s|%s|%s\\n' "$GH_CONFIG_DIR" "${AMBIENT.map((v) => `\${${v}+${v} }`).join("")}" "$*" >> "$W420_LOG"`,
      'case "$*" in',
      `"auth status --json hosts") cat "$HOME/status.json"; echo "${CANARY} (stderr)" >&2; exit "$(cat "$HOME/status.exit")" ;;`,
      '"auth login --with-token --insecure-storage") cat >/dev/null; exit 0 ;;',
      '"api repos/Round-Block/bisellium --jq .full_name") echo Round-Block/bisellium; exit 0 ;;',
      "esac",
      'echo "HTTP 404: Not Found" >&2',
      "exit 1",
      "",
    ].join("\n"),
    0o755,
  );
  for (const t of ["git", "npm"]) put(join(f, "stub", t), `#!/bin/sh\necho "${t} $*" >> "${join(logs, `${t}.log`)}"\nexit 1\n`, 0o755);
  const status = (body: string, exit = 0): void => {
    put(join(f, "status.json"), body);
    put(join(f, "status.exit"), `${exit}\n`);
  };
  const hosts = (accounts: Record<string, unknown[]>): void => status(`${JSON.stringify({ hosts: accounts })}\n`);
  const run = (args: string[], env: Record<string, string> = {}, input?: string): { code: number | null; out: string } => {
    const r = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      cwd: f,
      input: input ?? "",
      env: {
        PATH: [join(f, "stub"), dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
        HOME: f,
        PATRON_DIR: join(f, "patron"),
        AGENT_DIR: join(f, "agent"),
        AGENT_GH: gh,
        GUARD_BIN: join(f, "bin", "bisellium"),
        OLD_GUARD_DIR: join(f, "old guard"),
        W420_LOG: log,
        // every ambient gh auth, host and forced-terminal input set: the check clears each before gh runs
        GH_TOKEN: CANARY,
        GITHUB_TOKEN: CANARY,
        GH_ENTERPRISE_TOKEN: CANARY,
        GITHUB_ENTERPRISE_TOKEN: CANARY,
        GH_HOST: "ghe.example.com",
        GH_FORCE_TTY: "1",
        CLICOLOR_FORCE: "1",
        ...env,
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const calls = (): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "") : []);
  return { f, gh, status, hosts, log, logs, run, calls };
}

/** One gh account as `gh auth status --json hosts` (gh 2.101.0) lists it, with the canary as a token field gh does not print. */
const account = (gh: string, login: string, active: boolean, host = "github.com"): Record<string, unknown> => ({ active, gitProtocol: "https", host, login, state: "success", tokenSource: `${gh}/hosts.yml`, token: CANARY });

/** The line named `line` and the indented lines under it. */
function block(out: string, line: string): string[] {
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l === `ok ${line}` || l === `FAIL ${line}`);
  if (i < 0) return [];
  const b = [lines[i] ?? ""];
  for (const l of lines.slice(i + 1)) {
    if (!l.startsWith("  ")) break;
    b.push(l);
  }
  return b;
}

test("W-420-b1 behaviour 1: verify and verify --inside fail while the agent gh config holds any login but the agent's own, active on github.com, naming each fix and never a token", () => {
  const w = ghWorld();
  const g = w.gh;
  const LINE = ghLine(g);
  const env = `GH_CONFIG_DIR=${sq(g)}`;
  const stray = (login: string, host = "github.com"): string => `  ${g} holds the login ${login} on ${host}, not the agent's own (bisellium-agent on github.com); log it out: ${env} gh auth logout -h ${host} -u ${login}`;
  const noOwn = `  ${g} holds no login bisellium-agent on github.com; run setup with the agent's token`;
  const form = (why: string): string => `  gh auth status for ${g} is not the form verify reads (${why}); log out every login (${env} gh auth logout) and run setup again`;
  const judge = (what: string, args: string[], expected: string[], extra: Record<string, string> = {}): string => {
    const how = ["verify", ...args].join(" ");
    const before = snapshot(w.f);
    const n = w.calls().length;
    const r = w.run(["verify", ...args], extra);
    assert.deepEqual(block(r.out, LINE), expected, `${what}: ${how}: the line`);
    assert.doesNotMatch(r.out, /W420CANARY/, `${what}: ${how} prints no token`);
    assert.deepEqual(snapshot(w.f), before, `${what}: ${how} writes no file under the home`);
    if (expected[0]?.startsWith("FAIL")) assert.equal(r.code, 1, `${what}: ${how} exits 1`);
    // gh is asked once, in the agent gh config, with none of AMBIENT (each set by run), and never for a token
    assert.deepEqual(
      w.calls().slice(n).filter((c) => c.includes("auth status")),
      [`${g}||auth status --json hosts`],
      `${what}: ${how} asks gh once for the logins, in AGENT_GH, with no ambient gh auth, host or terminal input`,
    );
    return r.out;
  };

  // the agent's own login alone: ok, with no line under it
  w.hosts({ "github.com": [account(g, "bisellium-agent", true)] });
  for (const args of [[], ["--inside"]]) judge("the agent's own login alone", args, [`ok ${LINE}`]);

  // the finding (2026-10-26): the Patron's login stored, inactive, beside the agent's
  w.hosts({ "github.com": [account(g, "bisellium-agent", true), account(g, "edckt", false)] });
  for (const args of [[], ["--inside"]]) judge("a second login, inactive", args, [`FAIL ${LINE}`, stray("edckt")]);
  // the command pastes as it reads: run by sh, it asks gh to log that login out of the agent gh config
  const cmd = stray("edckt").replace(/^.* log it out: /, "");
  const n = w.calls().length;
  spawnSync("sh", ["-c", cmd], { encoding: "utf8", env: { PATH: [join(w.f, "stub"), "/usr/bin", "/bin"].join(":"), HOME: w.f, W420_LOG: w.log } });
  assert.deepEqual(w.calls().slice(n), [`${g}||auth logout -h github.com -u edckt`], "the logout command pastes as it reads");

  // the other forms, each a FAIL naming each fault and its fix (verify; verify --inside runs the same check)
  for (const [what, accounts, expected] of [
    ["the Patron's login alone, active", { "github.com": [account(g, "edckt", true)] }, [stray("edckt"), noOwn]],
    ["the agent's login inactive, another active", { "github.com": [account(g, "bisellium-agent", false), account(g, "edckt", true)] }, [stray("edckt"), `  bisellium-agent is not the active login on github.com; switch to it: ${env} gh auth switch -h github.com -u bisellium-agent`]],
    ["no login", {}, [`  ${g} holds no login; run setup with the agent's token`]],
    ["the agent's login on another host too", { "github.com": [account(g, "bisellium-agent", true)], "ghe.example.com": [account(g, "bisellium-agent", true, "ghe.example.com")] }, [stray("bisellium-agent", "ghe.example.com")]],
    ["the agent's login on another host alone", { "ghe.example.com:8443": [account(g, "bisellium-agent", true, "ghe.example.com:8443")] }, [stray("bisellium-agent", "ghe.example.com:8443"), noOwn]],
    ["the agent's login listed twice", { "github.com": [account(g, "bisellium-agent", true), account(g, "bisellium-agent", false)] }, [`  ${g} lists bisellium-agent on github.com 2 times; log it out (${env} gh auth logout -h github.com -u bisellium-agent) and run setup again`]],
    ["a login in another case", { "github.com": [account(g, "Bisellium-Agent", true)] }, [stray("Bisellium-Agent"), noOwn]],
    ["three logins", { "github.com": [account(g, "bisellium-agent", true), account(g, "edckt", false), account(g, "someone-else", false)] }, [stray("edckt"), stray("someone-else")]],
  ] as const) {
    w.hosts(accounts as Record<string, unknown[]>);
    judge(what, [], [`FAIL ${LINE}`, ...expected]);
  }
  w.hosts({ "github.com": [account(g, "bisellium-agent", false)] });
  judge("the agent's login alone, inactive", ["--inside"], [`FAIL ${LINE}`, `  bisellium-agent is not the active login on github.com; switch to it: ${env} gh auth switch -h github.com -u bisellium-agent`]);

  // gh cannot list the logins (an unreadable or malformed hosts.yml, a gh with no --json): its exit, never its words
  for (const exit of [1, 4]) {
    w.status("", exit);
    judge(`gh exits ${exit}`, [], [`FAIL ${LINE}`, `  gh could not list the logins in ${g} (exit ${exit}); make its hosts.yml readable YAML, or remove ${g} and run setup again`]);
  }
  // gh's output is not the form the judge reads: fails closed, printing no part of it
  const one = (over: Record<string, unknown>): string => `${JSON.stringify({ hosts: { "github.com": [{ ...account(g, "bisellium-agent", true), ...over }] } })}\n`;
  for (const [what, body, why] of [
    ["empty output", "", "not JSON"],
    ["not JSON", `${CANARY}\n`, "not JSON"],
    ["a JSON list", "[]\n", "no hosts object"],
    ["no hosts", "{}\n", "no hosts object"],
    ["hosts a list", '{"hosts":[]}\n', "no hosts object"],
    ["hosts null", '{"hosts":null}\n', "no hosts object"],
    ["a host whose accounts are an object", '{"hosts":{"github.com":{}}}\n', "a host whose accounts are not a list"],
    ["a host name with an underscore", `${JSON.stringify({ hosts: { [CANARY]: [account(g, "bisellium-agent", true)] } })}\n`, "a host that is not a host name"],
    ["a host of 40 hex digits (the legacy token form)", `${JSON.stringify({ hosts: { ["0123456789abcdef0123456789abcdef01234567"]: [account(g, "bisellium-agent", true)] } })}\n`, "a host that is not a host name"],
    ["an account that is not an object", '{"hosts":{"github.com":["bisellium-agent"]}}\n', "an account with no GitHub login"],
    ["an account with no login", one({ login: undefined }), "an account with no GitHub login"],
    ["a login that is not a string", one({ login: 7 }), "an account with no GitHub login"],
    ["a token-shaped login", one({ login: CANARY }), "an account with no GitHub login"],
    ["an empty login", one({ login: "" }), "an account with no GitHub login"],
    ["a login of 40 characters", one({ login: "a".repeat(40) }), "an account with no GitHub login"],
    ["no active flag", one({ active: undefined }), "an account with no active flag"],
    ["an active flag that is a string", one({ active: "true" }), "an account with no active flag"],
  ] as const) {
    w.status(body);
    judge(what, [], [`FAIL ${LINE}`, form(why)]);
  }

  // the agent's own login is the configured one: AGENT_LOGIN names it; a value that is not a login fails closed, unprinted
  w.hosts({ "github.com": [account(g, "other-agent", true)] });
  judge("AGENT_LOGIN other-agent, its login alone", [], [`ok ${LINE}`], { AGENT_LOGIN: "other-agent" });
  judge("the default AGENT_LOGIN, another login alone", [], [`FAIL ${LINE}`, stray("other-agent"), noOwn]);
  judge("AGENT_LOGIN empty, the default", [], [`FAIL ${LINE}`, stray("other-agent"), noOwn], { AGENT_LOGIN: "" });
  judge("AGENT_LOGIN not a login", [], [`FAIL ${LINE}`, "  AGENT_LOGIN is not a GitHub login (letters, digits and hyphens); set it to the agent's own login"], { AGENT_LOGIN: CANARY });
  w.hosts({ "github.com": [account(g, "a".repeat(39), true)] });
  judge("a login of 39 characters, configured", [], [`ok ${LINE}`], { AGENT_LOGIN: "a".repeat(39) });
});
