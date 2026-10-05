/**
 * W-126: a blocking verdict finding cites a line of the opus's declared brief,
 * or the writer records it as advisory. Behaviours 1-3 drive `runVerdict`,
 * behaviour 4 `runReview`, both in-process on a minimal officina. Select one
 * with `--test-name-pattern=behaviour.<n>`. node:test TAP, one describe per
 * behaviour. No timers, no polling.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { parseVerdictHeader } from "@bisellium/commands/opus-model.js";
import { runVerdict } from "./verdict.js";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Ten lines, newline-terminated, line 4 blank. */
const BRIEF = `${Array.from({ length: 10 }, (_, i) => (i === 3 ? "" : `brief line ${i + 1}`)).join("\n")}\n`;

interface Options {
  /** The opus's `spec:` value; `false` omits the key. */
  spec?: string | false;
  /** Write briefs/W-300.md. */
  brief?: boolean;
  state?: string;
  /** Put the officina in a `studio/` directory of a git repository. */
  git?: boolean;
}

function studio(o: Options = {}): string {
  const { spec = "briefs/W-300.md", brief = true, state = "building", git = false } = o;
  const base = mkdtempSync(join(tmpdir(), "bisellium-w126-"));
  roots.push(base);
  const root = git ? join(base, "studio") : base;
  if (git) {
    mkdirSync(root);
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "fixture@example.invalid"], ["config", "user.name", "Fixture"]])
      execFileSync("git", args, { cwd: base, stdio: "ignore" });
    writeFileSync(join(base, "source.txt"), "clean\n");
  }
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-126 citation",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: qa-lead, collegium: engineering, kind: agent }",
      "probationes:",
      "  - { id: review, name: Review, kind: agent }",
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(root, "opera"));
  writeFileSync(
    join(root, "opera", "W-300.md"),
    `---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: engineering\nstate: ${state}\n${spec === false ? "" : `spec: ${spec}\n`}probationes: {}\n---\n`,
  );
  if (brief) {
    mkdirSync(join(root, "briefs"));
    writeFileSync(join(root, "briefs", "W-300.md"), BRIEF);
  }
  if (git) {
    execFileSync("git", ["add", "."], { cwd: base, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: base, stdio: "ignore" });
  }
  return root;
}

function capture<T>(run: () => T): { result: T; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const [log, error] = [console.log, console.error];
  console.log = (...args: unknown[]) => void (stdout += `${args.map(String).join(" ")}\n`);
  console.error = (...args: unknown[]) => void (stderr += `${args.map(String).join(" ")}\n`);
  try {
    return { result: run(), stdout, stderr };
  } finally {
    [console.log, console.error] = [log, error];
  }
}

interface Recorded {
  exitCode: number;
  stdout: string;
  stderr: string;
  header: Map<string, string>;
  /** The header's keys in file order. */
  keys: string[];
  /** The bytes after the header's blank line. */
  body: string;
}

function verdict(dir: string, body: string, outcome = "passed", extra: string[] = []): Recorded {
  const input = join(dir, "input.md");
  writeFileSync(input, body);
  const { result, stdout, stderr } = capture(() =>
    runVerdict(["W-300", "--round", "1", "--sella", "qa-lead", "--outcome", outcome, "--from", input, "--studio", dir, ...extra], { now: NOW }),
  );
  const phase = extra.includes("spec") ? "spec" : "review";
  const log = join(dir, "ci", `W-300-${phase}-1.log`);
  const raw = existsSync(log) ? readFileSync(log, "utf8") : "";
  const parsed = parseVerdictHeader(raw);
  return { exitCode: result.exitCode, stdout, stderr, header: parsed.values, keys: [...parsed.values.keys()], body: raw.slice(raw.indexOf("\n\n") + 2) };
}

/** A findings-shaped body: one numbered line per entry, each ending in a check. */
function findings(...lines: string[]): string {
  return `## Findings\n${lines.map((line, i) => `${i + 1}. ${line} — check: none: x`).join("\n")}\n`;
}

const BLOB = `blob:${createHash("sha1").update(`blob ${Buffer.byteLength(BRIEF)}\0`).update(BRIEF).digest("hex")}`;

describe("behaviour 1", () => {
  test("a blocking finding that cites no brief line is recorded as advisory, with its reason", () => {
    const body = findings(
      "blocking — packages/x.ts:3 the writer drops a line",
      "advisory — the usage line is long",
      "BLOCKING — brief:2 the first behaviour is missing",
      "**Blocking** — briefs/W-300.md:5 the second behaviour is missing",
    );
    const dir = studio();
    const r = verdict(dir, body);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("brief"), `briefs/W-300.md ${BLOB}`);
    assert.equal(r.header.get("converted"), "1 (cites no line of briefs/W-300.md)");
    assert.equal(r.header.get("outcome"), "passed");
    assert.equal(r.header.has("submitted_outcome"), false);
    assert.deepEqual(r.keys.slice(-3), ["tree", "brief", "converted"]);
    assert.equal(r.body, body, "body exact");
    assert.match(r.stdout, /^W-300: finding 1 recorded as advisory: cites no line of briefs\/W-300\.md$/m);
  });

  test("a body with only advisory findings gets # brief: and no # converted:", () => {
    const r = verdict(studio(), findings("advisory — packages/x.ts:3 a nit", "advisory — another"));
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("brief"), `briefs/W-300.md ${BLOB}`);
    assert.equal(r.header.has("converted"), false);
  });

  test("the same four-finding body in the spec phase gets neither line", () => {
    const body = findings("blocking — packages/x.ts:3 a", "advisory — b", "BLOCKING — brief:2 c", "**Blocking** — briefs/W-300.md:5 d");
    const r = verdict(studio(), body, "passed", ["--phase", "spec"]);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.has("brief"), false);
    assert.equal(r.header.has("converted"), false);
  });
});
