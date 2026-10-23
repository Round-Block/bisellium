/**
 * scripts/agent-settings-merge.test.mjs — `merge()` and the CLI of
 * scripts/agent-settings-merge.mjs, the pure settings merge behind
 * scripts/agent-workspace.sh. node:test, plain node, TAP:
 *   node --test-reporter=tap scripts/agent-settings-merge.test.mjs
 *
 * The module is loaded inside each test (not a static import) so that, while
 * it is absent, every test fails on its own assertion instead of the whole
 * file dying at module load.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "agent-settings-merge.mjs");
const OPTS = { patronDir: "/home/u/proj", agentGh: "/home/u/.config/agent-gh" };

const DENY_READ = ["~/.ssh", "~/.git-credentials", "~/.config/gh"];
const PERM_DENY = [
  "Read(~/.ssh/**)",
  "Read(~/.git-credentials)",
  "Read(~/.config/gh/**)",
  "Edit(//home/u/proj/**)",
  "Write(//home/u/proj/**)",
];

const load = async () => {
  try {
    return await import("./agent-settings-merge.mjs");
  } catch (e) {
    return assert.fail(`scripts/agent-settings-merge.mjs missing: ${e.code}`);
  }
};

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};

const dirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "agent-settings-"));
  dirs.push(d);
  return d;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// argv is <file> <patronDir> <agentGh>; the last two are fixed.
const run = (file) => spawnSync("node", [SCRIPT, file, OPTS.patronDir, OPTS.agentGh], { encoding: "utf8" });

test("merge into {} adds every entry", async () => {
  const { merge } = await load();
  assert.deepEqual(merge({}, OPTS), {
    sandbox: {
      enabled: true,
      filesystem: { denyRead: DENY_READ, denyWrite: ["/home/u/proj"] },
    },
    permissions: { deny: PERM_DENY },
    env: { GH_CONFIG_DIR: OPTS.agentGh },
  });
});

test("merge keeps unrelated keys and turns an explicit sandbox.enabled false on (W-362)", async () => {
  const { merge } = await load();
  const input = {
    model: "opus",
    env: { ANTHROPIC_BASE_URL: "https://x", ANTHROPIC_MODEL: "m" },
    permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm -rf /)"] },
    sandbox: { enabled: false, network: { allowedDomains: ["a.example"] } },
  };
  const out = merge(input, OPTS);
  assert.equal(out.model, "opus");
  assert.deepEqual(out.env, { ...input.env, GH_CONFIG_DIR: OPTS.agentGh });
  assert.deepEqual(out.permissions.allow, ["Bash(ls)"]);
  assert.deepEqual(out.permissions.deny, ["Bash(rm -rf /)", ...PERM_DENY]);
  assert.equal(out.sandbox.enabled, true);
  assert.deepEqual(out.sandbox.network, { allowedDomains: ["a.example"] });
});

test("merge is idempotent", async () => {
  const { merge } = await load();
  const once = merge({ model: "opus", permissions: { allow: ["Bash(ls)"] } }, OPTS);
  assert.deepEqual(merge(once, OPTS), once);
});

test("merge adds no duplicates", async () => {
  const { merge } = await load();
  const out = merge(
    {
      sandbox: { filesystem: { denyRead: ["~/.ssh"], denyWrite: ["/home/u/proj"] } },
      permissions: { deny: ["Read(~/.ssh/**)"] },
    },
    OPTS,
  );
  assert.deepEqual(out.sandbox.filesystem.denyRead, DENY_READ);
  assert.deepEqual(out.sandbox.filesystem.denyWrite, ["/home/u/proj"]);
  assert.deepEqual(out.permissions.deny, PERM_DENY);
});

test("merge returns a new object and leaves a frozen input alone", async () => {
  const { merge } = await load();
  const input = deepFreeze({ env: { A: "1" }, permissions: { deny: ["x"] } });
  const out = merge(input, OPTS);
  assert.notEqual(out, input);
  assert.deepEqual(input, { env: { A: "1" }, permissions: { deny: ["x"] } });
  assert.equal(out.env.GH_CONFIG_DIR, OPTS.agentGh);
});

test("CLI backs the existing file up, then writes the merge", async () => {
  const dir = tmp();
  const file = join(dir, "settings.json");
  const original = JSON.stringify({ model: "opus" });
  writeFileSync(file, original);
  const r = run(file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /~\/\.ssh/);
  const backups = readdirSync(dir).filter((f) => f.startsWith("settings.json.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dir, backups[0]), "utf8"), original);
  const text = readFileSync(file, "utf8");
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.includes('\n  "model": "opus"'));
  const { merge } = await load();
  assert.deepEqual(JSON.parse(text), merge({ model: "opus" }, OPTS));
});

test("CLI creates the file when absent, without a backup", () => {
  const dir = tmp();
  const file = join(dir, "settings.json");
  const r = run(file);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(file));
  assert.deepEqual(readdirSync(dir), ["settings.json"]);
});

test("CLI refuses invalid JSON and leaves everything untouched", () => {
  const dir = tmp();
  const file = join(dir, "settings.json");
  writeFileSync(file, "{ not json");
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.equal(readFileSync(file, "utf8"), "{ not json");
  assert.deepEqual(readdirSync(dir), ["settings.json"]);
});

test("CLI on an already-merged file prints unchanged and writes nothing", async () => {
  const dir = tmp();
  const file = join(dir, "settings.json");
  const { merge } = await load();
  const text = `${JSON.stringify(merge({ model: "opus" }, OPTS), null, 2)}\n`;
  writeFileSync(file, text);
  const r = run(file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /unchanged/);
  assert.equal(readFileSync(file, "utf8"), text);
  assert.deepEqual(readdirSync(dir), ["settings.json"]);
});

// W-362 (studio/briefs/W-362.md): the sandbox is on, and it denies writing the agent clone's source folders
test("W-362-b2 behaviour 2: merge turns the sandbox on and denies writing the agent clone's source folders", async () => {
  const { merge } = await load();
  for (const enabled of [false, "false", 0, null, undefined])
    assert.equal(
      merge({ sandbox: { enabled, network: { allowedDomains: ["a.example"] }, allowUnsandboxedCommands: false } }, OPTS)
        .sandbox.enabled,
      true,
      `sandbox.enabled ${JSON.stringify(enabled)} becomes true`,
    );
  const kept = merge(
    { sandbox: { enabled: false, network: { allowedDomains: ["a.example"] }, allowUnsandboxedCommands: false } },
    OPTS,
  ).sandbox;
  assert.deepEqual(kept.network, { allowedDomains: ["a.example"] }, "other sandbox keys are kept");
  assert.equal(kept.allowUnsandboxedCommands, false);
  const agentDir = "/home/u/agents/bisellium";
  const SOURCE = ["packages", "apps", "adapters", "scripts"].map((d) => `${agentDir}/${d}`);
  const out = merge({ sandbox: { filesystem: { denyWrite: ["/elsewhere"] } } }, { ...OPTS, agentDir });
  assert.deepEqual(
    out.sandbox.filesystem.denyWrite,
    ["/elsewhere", "/home/u/proj", ...SOURCE],
    "the agent clone's source folders are denied",
  );
  assert.deepEqual(merge(out, { ...OPTS, agentDir }), out, "idempotent with agentDir");
  assert.deepEqual(
    merge({}, { ...OPTS, agentDir: `${agentDir}/` }).sandbox.filesystem.denyWrite,
    ["/home/u/proj", ...SOURCE],
    "a trailing slash is not doubled",
  );
  const odd = "/home/u/my agents/it's ü";
  assert.deepEqual(
    merge({}, { ...OPTS, agentDir: odd }).sandbox.filesystem.denyWrite.slice(1),
    ["packages", "apps", "adapters", "scripts"].map((d) => `${odd}/${d}`),
    "a space, a quote and a non-ASCII name are kept as written",
  );
  assert.deepEqual(merge({}, OPTS).sandbox.filesystem.denyWrite, ["/home/u/proj"], "without agentDir: today's deny");
  // the CLI takes the agent clone as a fourth, absolute argument
  const dir = tmp();
  const file = join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ sandbox: { enabled: false } }));
  const r = spawnSync("node", [SCRIPT, file, OPTS.patronDir, OPTS.agentGh, agentDir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^added sandbox\.enabled: true$/m, "the CLI says it turned the sandbox on");
  assert.match(r.stdout, /^added sandbox\.filesystem\.denyWrite: "\/home\/u\/agents\/bisellium\/scripts"$/m);
  assert.deepEqual(
    JSON.parse(readFileSync(file, "utf8")),
    merge({ sandbox: { enabled: false } }, { ...OPTS, agentDir }),
  );
  const before = readFileSync(file, "utf8");
  const rel = spawnSync("node", [SCRIPT, file, OPTS.patronDir, OPTS.agentGh, "agents/bisellium"], { encoding: "utf8" });
  assert.equal(rel.status, 2, "a relative agent clone is refused");
  assert.match(rel.stderr, /must be an absolute path/);
  assert.equal(readFileSync(file, "utf8"), before, "and nothing is written");
});

// W-362 spec-2 finding 2: a malformed settings shape is rejected, never reshaped
test("W-362-b2 behaviour 2: a malformed sandbox shape is refused and nothing is written", async () => {
  const dir = tmp();
  const shapes = [
    { sandbox: { filesystem: { denyWrite: "/keep" } } },
    { sandbox: { filesystem: { denyWrite: ["/keep", 1] } } },
    { sandbox: { filesystem: { denyWrite: { a: "/keep" } } } },
    { sandbox: { filesystem: ["/keep"] } },
    { sandbox: { filesystem: "/keep" } },
    { sandbox: ["/keep"] },
    { sandbox: "/keep" },
  ];
  for (const [i, shape] of shapes.entries()) {
    const file = join(dir, `settings-${i}.json`);
    const text = JSON.stringify(shape);
    writeFileSync(file, text);
    const r = spawnSync("node", [SCRIPT, file, OPTS.patronDir, OPTS.agentGh, "/home/u/agents/bisellium"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, `${text} exits 1: ${r.stdout}${r.stderr}`);
    assert.equal(readFileSync(file, "utf8"), text, `${text} is left unchanged`);
  }
  assert.deepEqual(
    readdirSync(dir).filter((n) => n.includes(".bak-")),
    [],
    "no backup was made",
  );
});
