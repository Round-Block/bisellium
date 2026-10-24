/**
 * W-398 row b1 (studio/briefs/W-398.md): `scripts/agent-workspace.sh verify` and `verify --inside` only read: a user
 * settings file that differs from the merge is a FAIL line naming what differs, never a write. node:test TAP, selected
 * by `--test-name-pattern='^W-398-b1\s'`. Every fixture (a home, the Patron's clone, an agent clone, a stand-in gh) lives
 * under the OS tmp dir; nothing here reads or writes the real ~/.claude, ~/projects, ~/.local/bin or the agent clone.
 * W-402 rows b1 and b2 (studio/briefs/W-402.md): --check names every wrong-type field, one line each in merge()'s order,
 * never Node's message; selected by `--test-name-pattern='^W-402-b<k>\s'`.
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
