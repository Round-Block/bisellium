/**
 * W-648 (clone-tests-meet-1114 c): `bisellium run --cwd <dir>` runs a command in the opus's own worktree. `--cwd` is
 * accepted only with `--opus <id>` and only when <dir> resolves (realpath) to `<repo>/.worktrees/<id>`, an existing
 * directory; then no worktree is leased and no confined clone is built (the builder-class `--no-worktree` refusal lets
 * the run through) and the child runs with that directory as its cwd. Every refusal exits 2 before any receipt or child.
 *
 * The fixture's temporary root holds a space, a quote and a non-ASCII letter, so every row runs on such a path.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { WorktreeProvider } from "@bisellium/shim";

const NOW = new Date("2026-11-14T00:00:00.000Z");
const OPUS = "W-901";
const OTHER = "W-902";

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  repo: string;
  studio: string;
  /** `<repo>/.worktrees/<OPUS>`, real (created unless `worktree: false`) */
  worktree: string;
  /** the file the probe child writes its cwd into */
  probe: string;
}

function fixture(o: { worktree?: boolean } = {}): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "w648 'ü'-")));
  roots.push(root);
  const repo = join(root, "repo");
  const studio = join(repo, "studio");
  mkdirSync(join(studio, "opera"), { recursive: true });
  writeFileSync(
    join(studio, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-648 fixture",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: eng-lead, collegium: engineering, kind: agent }",
      "  - { id: builder, collegium: engineering, kind: agent }",
      "probationes: []",
      "",
    ].join("\n"),
  );
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "master"]);
  git(["config", "user.name", "W-648 Test"]);
  git(["config", "user.email", "w648@example.invalid"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "test: W-648 fixture"]);
  const worktree = join(repo, ".worktrees", OPUS);
  if (o.worktree !== false) mkdirSync(worktree, { recursive: true });
  mkdirSync(join(repo, ".worktrees", OTHER), { recursive: true });
  return { root, repo, studio, worktree, probe: join(root, "probe.txt") };
}

/** A provider that fails the row if a worktree is ever leased. */
const NO_LEASE: WorktreeProvider = {
  id: "w648-no-lease",
  acquire: () => {
    throw new Error("W-648: no worktree is leased with --cwd");
  },
} as unknown as WorktreeProvider;

async function run(args: string[]): Promise<{ exitCode: number; errors: string[] }> {
  const { runCommand } = await import("./run.js");
  const oldError = console.error;
  const oldLog = console.log;
  const errors: string[] = [];
  console.error = (...parts: unknown[]) => void errors.push(parts.map(String).join(" "));
  console.log = (...parts: unknown[]) => void errors.push(parts.map(String).join(" "));
  try {
    const r = await runCommand(args, { now: NOW, provider: NO_LEASE });
    return { exitCode: r.exitCode, errors };
  } finally {
    console.error = oldError;
    console.log = oldLog;
  }
}

/** The probe child: writes its own cwd to `file`. */
const probeCmd = (file: string): string[] => ["node", "-e", "require('node:fs').writeFileSync(process.argv[1], process.cwd())", file];
const args = (f: Fixture, sella: string, extra: string[], repo = f.repo): string[] => ["--sella", sella, "--studio", f.studio, "--repo", repo, ...extra, "--", ...probeCmd(f.probe)];
const receipts = (f: Fixture): string[] => {
  const dir = join(f.studio, "receipts");
  return existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((n) => n.endsWith(".json")) : [];
};

/** A refusal: exit 2, the message, no child, no receipt. */
async function refused(f: Fixture, sella: string, extra: string[], message: RegExp, what: string): Promise<void> {
  const r = await run(args(f, sella, extra));
  assert.match(r.errors.join("\n"), message, `${what}: the refusal names why`);
  assert.equal(r.exitCode, 2, `${what}: exits 2`);
  assert.equal(existsSync(f.probe), false, `${what}: the child does not run`);
  assert.deepEqual(receipts(f), [], `${what}: no receipt is written`);
}

test("W-648-b1 behaviour 1: run --opus <id> --cwd <repo>/.worktrees/<id> runs the child in that worktree", async () => {
  const f = fixture();
  // a builder-class sella with --no-worktree: the refusal lets it through, no confined clone, the child's cwd is the worktree
  const b = await run(args(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", f.worktree]));
  assert.equal(b.exitCode, 0, `a builder run with --cwd exits 0: ${b.errors.join(" | ")}`);
  assert.equal(readFileSync(f.probe, "utf8"), f.worktree, "a builder run with --cwd: the child's cwd is the opus worktree");
  assert.equal(receipts(f).length, 1, "a builder run with --cwd writes one receipt");
  const [receipt] = receipts(f);
  assert.equal(receipt?.split("/")[0], `builder.${OPUS}`, "the receipt is the minted builder instance's");
  assert.equal(JSON.parse(readFileSync(join(f.studio, "receipts", receipt!), "utf8")).cwd, f.worktree, "the receipt records the worktree as cwd");
  rmSync(f.probe);
  rmSync(join(f.studio, "receipts"), { recursive: true });

  // without --no-worktree: --cwd alone leases nothing (NO_LEASE throws if asked)
  const plain = await run(args(f, "eng-lead", ["--opus", OPUS, "--cwd", f.worktree]));
  assert.equal(plain.exitCode, 0, `a non-builder run with --cwd exits 0 and leases no worktree: ${plain.errors.join(" | ")}`);
  assert.equal(readFileSync(f.probe, "utf8"), f.worktree, "a non-builder run with --cwd: the child's cwd is the opus worktree");
  rmSync(f.probe);

  // a path that resolves to it: through a symlinked parent of the repository (--repo and --cwd both), and with ".."
  const alias = join(f.root, "alias");
  symlinkSync(f.repo, alias);
  const viaLink = await run(args(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", join(alias, ".worktrees", OPUS)], alias));
  assert.equal(viaLink.exitCode, 0, `a symlinked parent: exits 0: ${viaLink.errors.join(" | ")}`);
  assert.equal(readFileSync(f.probe, "utf8"), f.worktree, "a symlinked parent: the child's cwd is the real worktree");
  rmSync(f.probe);
  const dotted = await run(args(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", `${f.repo}/.worktrees/${OTHER}/../${OPUS}`]));
  assert.equal(dotted.exitCode, 0, `a dot-dot path that resolves to the worktree: exits 0: ${dotted.errors.join(" | ")}`);
  assert.equal(readFileSync(f.probe, "utf8"), f.worktree, "a dot-dot path that resolves to the worktree: the child's cwd is the worktree");
});


test("W-648-b2 behaviour 2: --cwd without --opus is refused", async () => {
  const f = fixture();
  await refused(f, "eng-lead", ["--cwd", f.worktree], /--cwd needs --opus <id>/, "--cwd without --opus");
});


test("W-648-b3 behaviour 3: --cwd naming any other directory is refused", async () => {
  const f = fixture();
  const not = /--cwd .* is not .*\.worktrees\/W-901/;
  await refused(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", join(f.repo, ".worktrees", OTHER)], not, "another opus's worktree");
  await refused(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", f.repo], not, "the main checkout");
  await refused(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", `${f.worktree}/../..`], not, "a dot-dot escape");
  mkdirSync(join(f.worktree, "sub"));
  await refused(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", join(f.worktree, "sub")], not, "a directory inside the worktree");
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(f.repo, ".worktrees", "escape"));
  await refused(f, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", join(f.repo, ".worktrees", "escape")], not, "a symlink escaping the worktree");
  // the worktree itself a symlink to elsewhere: its realpath is not <repo>/.worktrees/<id>
  const g = fixture({ worktree: false });
  const away = join(g.root, "away");
  mkdirSync(away);
  symlinkSync(away, g.worktree);
  await refused(g, "builder", ["--opus", OPUS, "--no-worktree", "--cwd", g.worktree], /--cwd .* is not .*\.worktrees\/W-901/, "a symlinked worktree");
  // an opus id that is not one path segment names no worktree
  await refused(f, "eng-lead", ["--opus", "..", "--cwd", f.repo], /--cwd: invalid id/, "an opus id of two dots");
});

