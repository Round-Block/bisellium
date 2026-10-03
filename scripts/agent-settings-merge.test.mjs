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

test("merge keeps unrelated keys and an explicit sandbox.enabled", async () => {
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
  assert.equal(out.sandbox.enabled, false);
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
