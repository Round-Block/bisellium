/**
 * packages/commands/src/delegate.test.ts — W-065 behaviours 4-7:
 * `bisellium delegate`'s manifest mutation (parameterized over fixed
 * fixtures and the live studio/bisellium.yml), the supported-forms
 * whitelist (refusals write nothing, and a positive case so a
 * refuse-everything stub cannot pass), the `--from` precondition, and
 * attribution/rollback (including the rollback's own failure).
 *
 * Repo path at argv[2], behaviour at argv[3] — same convention
 * apps/web/src/lib/*.test.ts uses.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { runDelegate } from "./delegate.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const realManifest = resolve(repo, "studio", "bisellium.yml");
const fixturesDir = resolve(repo, "packages", "commands", "test", "fixtures");
const MAIN_TS = join(repo, "packages", "cli", "src", "main.ts");
const NOW = new Date("2026-09-24T12:00:00Z");

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
}

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `w065-delegate-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}
/** A minimal "studio" that is just a manifest file — `openStudio` needs
 *  nothing else for `delegate`, which never touches opera/petitiones/. */
function freshManifestOnly(tag: string, content: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), `w065-delegate-${tag}-`));
  writeFileSync(join(dir, "bisellium.yml"), content);
  dirs.push(dir);
  return dir;
}
function freshFixture(tag: string, fixtureName: string): string {
  return freshManifestOnly(tag, readFileSync(join(fixturesDir, fixtureName)));
}

function timelineLines(dir: string): Record<string, unknown>[] {
  const path = join(dir, "timeline", "patron.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function isCRLF(text: string): boolean {
  return text.includes("\r\n") && text.split("\n").every((line) => line === "" || line.endsWith("\r"));
}

/** Every refusal case: nonzero exit, manifest bytes unchanged, timeline
 *  length unchanged, AND a distinctive fragment of the message naming the
 *  layer that actually refused it (amended brief, ruling A.4/behaviour 5 —
 *  an incidental crash that happens to exit non-zero must never satisfy
 *  this: it is caught here by requiring the specific expected wording, not
 *  just a truthy exit code). `console.error` is captured for the duration
 *  of the call so the fragment can be asserted against what was actually
 *  printed, not re-derived from the exit code alone. */
function assertRefused(behaviour: number, label: string, dir: string, args: string[], expectedMessageFragment: string): void {
  const manifestPath = join(dir, "bisellium.yml");
  const before = readFileSync(manifestPath);
  const timelineBefore = timelineLines(dir).length;

  const origError = console.error;
  let stderr = "";
  console.error = (...parts: unknown[]) => {
    stderr += parts.map(String).join(" ") + "\n";
  };
  let r: { exitCode: number };
  try {
    r = runDelegate(args, { now: NOW });
  } finally {
    console.error = origError;
  }

  check(behaviour, `${label}: refused (nonzero exit)`, r.exitCode !== 0, String(r.exitCode));
  check(behaviour, `${label}: message names the refusing layer ("${expectedMessageFragment}")`, stderr.includes(expectedMessageFragment), stderr);
  const after = readFileSync(manifestPath);
  check(behaviour, `${label}: manifest bytes unchanged`, Buffer.compare(before, after) === 0);
  check(behaviour, `${label}: timeline length unchanged`, timelineLines(dir).length === timelineBefore, String(timelineLines(dir).length));
}

process.on("exit", () => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

// ---------------------------------------------------------------------------
// Behaviour 4: manifest mutation, parameterized over both targets, on fixed
// fixtures and on a temp copy of the live studio/bisellium.yml.
// ---------------------------------------------------------------------------
for (const fixtureName of ["manifest-flow.yml", "manifest-block.yml", "manifest-crlf.yml"]) {
  const crlfFixture = fixtureName === "manifest-crlf.yml";

  // --sella builder-a --model <new>
  {
    const dir = freshFixture(`4-sella-${fixtureName}`, fixtureName);
    const manifestPath = join(dir, "bisellium.yml");
    const before = readFileSync(manifestPath, "utf8");
    const r = runDelegate(["--sella", "builder-a", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
    check(4, `${fixtureName}: --sella exit 0`, r.exitCode === 0, String(r.exitCode));
    const after = readFileSync(manifestPath, "utf8");

    // Exactly the target field changed, computed as a single substitution on
    // the committed fixture (the model value is only ever written once, so
    // this IS "the same bytes with only the target field changed").
    const expected = before.replace("model: claude-sonnet-5", "model: gpt-5.6-sol");
    check(4, `${fixtureName}: --sella output matches the fixture with only the target field changed`, after === expected, after);

    const beforeParsed = parseYaml(before) as Record<string, unknown>;
    const afterParsed = parseYaml(after) as Record<string, unknown>;
    (beforeParsed["sellae"] as { id: string; model?: string }[]).find((s) => s.id === "builder-a")!.model = "gpt-5.6-sol";
    check(4, `${fixtureName}: --sella parse(after) deep-equals parse(before) with only the target changed`, JSON.stringify(afterParsed) === JSON.stringify(beforeParsed));

    if (crlfFixture) check(4, `${fixtureName}: --sella output round-trips as CRLF`, isCRLF(after), JSON.stringify(after.slice(0, 40)));

    // A second identical run is byte-identical.
    const r2 = runDelegate(["--sella", "builder-a", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
    const after2 = readFileSync(manifestPath, "utf8");
    check(4, `${fixtureName}: --sella a second identical run exits 0`, r2.exitCode === 0, String(r2.exitCode));
    check(4, `${fixtureName}: --sella a second identical run is byte-identical`, after2 === after);
  }

  // --munus audit --tier high
  {
    const dir = freshFixture(`4-munus-${fixtureName}`, fixtureName);
    const manifestPath = join(dir, "bisellium.yml");
    const before = readFileSync(manifestPath, "utf8");
    const r = runDelegate(["--munus", "audit", "--tier", "high", "--studio", dir], { now: NOW });
    check(4, `${fixtureName}: --munus exit 0`, r.exitCode === 0, String(r.exitCode));
    const after = readFileSync(manifestPath, "utf8");

    const expected = before.replace("tier: mid", "tier: high");
    check(4, `${fixtureName}: --munus output matches the fixture with only the target field changed`, after === expected, after);

    const beforeParsed = parseYaml(before) as Record<string, unknown>;
    const afterParsed = parseYaml(after) as Record<string, unknown>;
    (beforeParsed["munera"] as { id: string; tier: string }[]).find((m) => m.id === "audit")!.tier = "high";
    check(4, `${fixtureName}: --munus parse(after) deep-equals parse(before) with only the target changed`, JSON.stringify(afterParsed) === JSON.stringify(beforeParsed));

    if (crlfFixture) check(4, `${fixtureName}: --munus output round-trips as CRLF`, isCRLF(after), JSON.stringify(after.slice(0, 40)));

    const r2 = runDelegate(["--munus", "audit", "--tier", "high", "--studio", dir], { now: NOW });
    const after2 = readFileSync(manifestPath, "utf8");
    check(4, `${fixtureName}: --munus a second identical run exits 0`, r2.exitCode === 0, String(r2.exitCode));
    check(4, `${fixtureName}: --munus a second identical run is byte-identical`, after2 === after);
  }
}

// On a temp copy of the live studio/bisellium.yml as shipped: exit 0,
// semantic deep-equality with only the target changed, and a one-line
// textual diff (holds because this opus normalizes the shipped manifests).
{
  const dir = freshManifestOnly("4-live", readFileSync(realManifest));
  const manifestPath = join(dir, "bisellium.yml");
  const before = readFileSync(manifestPath, "utf8");
  const r = runDelegate(["--sella", "builder", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
  check(4, "live studio/bisellium.yml: --sella exit 0", r.exitCode === 0, String(r.exitCode));
  const after = readFileSync(manifestPath, "utf8");

  const beforeParsed = parseYaml(before) as Record<string, unknown>;
  const afterParsed = parseYaml(after) as Record<string, unknown>;
  (beforeParsed["sellae"] as { id: string; model?: string }[]).find((s) => s.id === "builder")!.model = "gpt-5.6-sol";
  check(4, "live studio/bisellium.yml: parse(after) deep-equals parse(before) with only the target changed", JSON.stringify(afterParsed) === JSON.stringify(beforeParsed));

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const diffLines = beforeLines.length === afterLines.length ? beforeLines.filter((l, i) => l !== afterLines[i]).length : Infinity;
  check(4, "live studio/bisellium.yml: exactly a one-line textual diff", diffLines === 1, String(diffLines));
}

// ---------------------------------------------------------------------------
// Behaviour 5: refusals write nothing, and each names the layer that
// refused it (amended brief, ruling A.4). `openStudio`'s three document-
// level forms all refuse with its own "unparseable — not a studio" message;
// `delegate`'s own two forms (shared nodes; a merge key with no alias) each
// refuse with their own distinctive message — a positive case closes the
// loop so a refuse-everything stub cannot pass.
// ---------------------------------------------------------------------------
const UNPARSEABLE = "unparseable — not a studio";

{
  const dir = freshStudio("5-refusals");
  assertRefused(5, "no flags", dir, [], "usage: bisellium delegate");
  assertRefused(5, "--sella without --model", dir, ["--sella", "builder-1", "--studio", dir], "usage: bisellium delegate");
  assertRefused(5, "both shapes", dir, ["--sella", "builder-1", "--model", "x", "--munus", "audit", "--tier", "mid", "--studio", dir], "accepts exactly one shape, not both");
  assertRefused(5, "unknown sella", dir, ["--sella", "nonexistent", "--model", "x", "--studio", dir], 'unknown sella "nonexistent"');
  assertRefused(5, "unknown munus", dir, ["--munus", "nonexistent", "--tier", "mid", "--studio", dir], 'unknown munus "nonexistent"');
  assertRefused(5, "unknown tier", dir, ["--munus", "audit", "--tier", "nonexistent", "--studio", dir], 'unknown tier "nonexistent"');
}

// -- openStudio's forms: refused upstream of delegate's own whitelist, each
// with openStudio's "unparseable — not a studio" wording, never a delegate
// message (ruling 2026-09-25: delegate no longer re-checks these at all). --
{
  const dir = freshManifestOnly("5-parse-error", "sellae: [\n  - this is not valid yaml: [[[\n");
  assertRefused(5, "manifest with parse errors (openStudio)", dir, ["--sella", "builder-1", "--model", "x", "--studio", dir], UNPARSEABLE);
}

{
  const dir = freshManifestOnly("5-dup-key", "sellae:\n  - { id: builder-1, collegium: engineering, model: x }\nsellae:\n  - { id: builder-2, collegium: engineering, model: y }\n");
  assertRefused(5, "manifest with a DUPLICATE_KEY (openStudio)", dir, ["--sella", "builder-1", "--model", "x", "--studio", dir], UNPARSEABLE);
}

{
  const dir = freshManifestOnly("5-multi-doc", "sellae:\n  - { id: builder-1, collegium: engineering, model: x }\n---\nfoo: bar\n");
  assertRefused(5, "a multi-document manifest (openStudio)", dir, ["--sella", "builder-1", "--model", "x", "--studio", dir], UNPARSEABLE);
}

// -- delegate's own forms. ---------------------------------------------------
{
  // A merge key WITH an alias: the anchor/alias scan fires first (the
  // amended brief's own table), so this refuses with the anchor/alias
  // message, not the merge-key one.
  const dir = freshManifestOnly(
    "5-merge-key-with-alias",
    "defaults: &def\n  model: x\nsellae:\n  - { id: builder-1, collegium: engineering, <<: *def }\n",
  );
  assertRefused(5, "manifest containing a merge key with an alias (anchor scan fires first)", dir, ["--sella", "builder-1", "--model", "y", "--studio", dir], "anchors and aliases are not a supported form");
}

{
  // A merge key with NO alias anywhere in the document (`<<: { ... }`) —
  // legal YAML, parses cleanly, carries no anchor, and reaches delegate
  // because nothing upstream rejects it and the anchor scan cannot catch
  // it. This is the merge-key check's own red: with the anchor scan alone,
  // this fixture would succeed and silently accept a form the brief refuses.
  const dir = freshManifestOnly(
    "5-merge-key-no-alias",
    "studio: Fixture\nsellae:\n  - { id: builder-1, collegium: engineering, model: x, <<: { extra: 1 } }\n",
  );
  assertRefused(5, "manifest containing a merge key with no alias in the document", dir, ["--sella", "builder-1", "--model", "y", "--studio", dir], 'a merge key ("<<")');
}

{
  // Anchor on the TARGET itself; alias on an unrelated key — the exact probe
  // that broke revision 2's path-restricted rule.
  const dir = freshManifestOnly(
    "5-anchor-alias",
    "sellae:\n  - &sa { id: builder-1, collegium: engineering, model: x }\nbackup: *sa\n",
  );
  assertRefused(5, "manifest with an anchor on the target and an alias elsewhere", dir, ["--sella", "builder-1", "--model", "y", "--studio", dir], "anchors and aliases are not a supported form");
}

// Positive cases: one ordinary manifest, and one with an empty `munera:`,
// both succeed.
{
  const dir = freshStudio("5-positive-ordinary");
  const r = runDelegate(["--sella", "builder", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
  check(5, "an ordinary manifest succeeds", r.exitCode === 0, String(r.exitCode));
}
{
  const dir = freshManifestOnly(
    "5-positive-empty-munera",
    "studio: Fixture\nsellae:\n  - { id: builder, collegium: engineering, model: x }\nmunera:\n",
  );
  const r = runDelegate(["--sella", "builder", "--model", "y", "--studio", dir], { now: NOW });
  check(5, "a manifest with an empty munera: succeeds", r.exitCode === 0, String(r.exitCode));
}

// ---------------------------------------------------------------------------
// Behaviour 6: the --from precondition.
// ---------------------------------------------------------------------------
{
  const dir = freshStudio("6-from-match");
  const r = runDelegate(["--sella", "builder", "--model", "gpt-5.6-sol", "--from", "claude-sonnet-5", "--studio", dir], { now: NOW });
  check(6, "--from matching succeeds", r.exitCode === 0, String(r.exitCode));
}
{
  const dir = freshStudio("6-from-mismatch");
  const manifestPath = join(dir, "bisellium.yml");
  const before = readFileSync(manifestPath);
  const timelineBefore = timelineLines(dir).length;
  const r = runDelegate(["--sella", "builder", "--model", "gpt-5.6-sol", "--from", "not-the-current-value", "--studio", dir], { now: NOW });
  check(6, "--from not matching exits non-zero", r.exitCode !== 0, String(r.exitCode));
  const after = readFileSync(manifestPath);
  check(6, "--from not matching: manifest bytes unchanged", Buffer.compare(before, after) === 0);
  check(6, "--from not matching: timeline length unchanged", timelineLines(dir).length === timelineBefore);
}
{
  const dir = freshStudio("6-from-omitted");
  const r = runDelegate(["--sella", "builder", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
  check(6, "--from omitted succeeds (it is optional)", r.exitCode === 0, String(r.exitCode));
}

// ---------------------------------------------------------------------------
// Behaviour 7: attribution, rollback, and the rollback's own failure.
// ---------------------------------------------------------------------------

// Attribution runs through main.ts (not runDelegate directly), so a
// force-patron mutation in main.ts is detectable.
function spawnMain(args: string[], env: Record<string, string | undefined>): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", MAIN_TS, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

{
  const dir = freshStudio("7-attribution-patron");
  const r = spawnMain(["delegate", "--sella", "builder", "--model", "gpt-5.6-sol", "--studio", dir, "--now", NOW.toISOString()], { BISELLIUM_ROLE: "patron" });
  check(7, "attribution: exits 0 under BISELLIUM_ROLE=patron", r.status === 0, `status=${r.status} stderr=${r.stderr}`);
  const lines = timelineLines(dir);
  check(7, "attribution: exactly one timeline line", lines.length === 1, String(lines.length));
  check(7, 'attribution: role is "patron"', lines[0]?.["role"] === "patron", JSON.stringify(lines[0]));
  check(7, "attribution: names the target/from/to", lines[0]?.["to"] === "gpt-5.6-sol" && lines[0]?.["from"] === "claude-sonnet-5", JSON.stringify(lines[0]));
}

{
  const dir = freshStudio("7-attribution-producer");
  const r = spawnMain(["delegate", "--sella", "builder", "--model", "gpt-5.6-sol", "--studio", dir, "--now", NOW.toISOString()], { BISELLIUM_ROLE: "producer" });
  check(7, "attribution: exits 0 under BISELLIUM_ROLE=producer (main.ts does not force patron)", r.status === 0, `status=${r.status} stderr=${r.stderr}`);
  const lines = timelineLines(dir);
  check(7, 'attribution: acting role "producer" is recorded faithfully, not laundered to patron', lines[0]?.["role"] === "producer", JSON.stringify(lines[0]));
}

// Rollback: timeline/ unwritable -> exit 2, manifest byte-identical.
{
  const dir = freshStudio("7-rollback");
  const manifestPath = join(dir, "bisellium.yml");
  const before = readFileSync(manifestPath);
  const timelineDir = join(dir, "timeline");
  mkdirSync(timelineDir, { recursive: true });
  chmodSync(timelineDir, 0o000);
  try {
    const r = runDelegate(["--sella", "builder", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
    check(7, "rollback: timeline/ unwritable -> exit 2", r.exitCode === 2, String(r.exitCode));
    const after = readFileSync(manifestPath);
    check(7, "rollback: manifest byte-identical after a failed write", Buffer.compare(before, after) === 0);
  } finally {
    chmodSync(timelineDir, 0o755);
  }
}

// Rollback's own failure: the manifest is made read-only BEFORE delegate
// ever runs (reconciled 2026-09-25, censor round 1 finding E — the old
// comment here narrated "read-only after the first write", but a single
// synchronous writeFileSync gives no seam to interject between a successful
// write and the restore attempt; making the manifest unwritable from the
// start fails the FIRST write for the same reason it then fails the
// restore, which is the only way this scenario is reachable at all with the
// current write shape). timeline/ is left writable — no assertion here
// depends on it being otherwise, so chmod'ing it was vestigial noise.
{
  const dir = freshStudio("7-rollback-failure");
  const manifestPath = join(dir, "bisellium.yml");
  chmodSync(manifestPath, 0o444);
  const origError = console.error;
  let stderr = "";
  console.error = (...parts: unknown[]) => {
    stderr += parts.map(String).join(" ") + "\n";
  };
  try {
    const r = runDelegate(["--sella", "builder", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
    check(7, "rollback failure: a DIFFERENT exit code (4)", r.exitCode === 4, String(r.exitCode));
    check(7, "rollback failure: message names the manifest as possibly inconsistent", stderr.includes("may be left changed or partially written"), stderr);
  } finally {
    console.error = origError;
    chmodSync(manifestPath, 0o644);
  }
}

// ---------------------------------------------------------------------------
// W-089 behaviours 3/6: delegate resolves a template-instance sella id to
// the template row, and refuses a retired live target.
// ---------------------------------------------------------------------------
{
  const dir = freshFixture("w089-instance", "manifest-seat-template.yml");
  const manifestPath = join(dir, "bisellium.yml");
  const before = readFileSync(manifestPath, "utf8");
  const r = runDelegate(["--sella", "builder.W-100", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
  check(8, "w089 b3: an instance id targets the resolved template row — exits 0", r.exitCode === 0, String(r.exitCode));
  const after = readFileSync(manifestPath, "utf8");
  const afterParsed = parseYaml(after) as { sellae: { id: string; model?: string }[] };
  check(8, "w089 b3: the TEMPLATE row's model changed, not a new row", afterParsed.sellae.find((s) => s.id === "builder")?.model === "gpt-5.6-sol", JSON.stringify(afterParsed.sellae));
  check(8, "w089 b3: no new row named after the instance was created", !afterParsed.sellae.some((s) => s.id === "builder.W-100"), JSON.stringify(afterParsed.sellae));
  check(8, "w089 b3: manifest bytes otherwise match the fixture with only the target field changed", after === before.replace("model: claude-sonnet-5", "model: gpt-5.6-sol"), after);
}
{
  const dir = freshFixture("w089-retired", "manifest-seat-template.yml");
  const manifestPath = join(dir, "bisellium.yml");
  const before = readFileSync(manifestPath, "utf8");
  const r = runDelegate(["--sella", "builder-a", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
  check(8, "w089 b6: delegate refuses a retired live target", r.exitCode === 2, String(r.exitCode));
  check(8, "w089 b6: manifest untouched on refusal", readFileSync(manifestPath, "utf8") === before);
}

process.exit(failed ? 1 : 0);
