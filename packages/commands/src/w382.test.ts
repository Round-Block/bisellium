/**
 * W-382 rows (studio/briefs/W-382.md): a Patron ruling on a kind: ui opus's branch screens carries to master's tree when
 * the served UI is unchanged, instead of a second ruling on the same screens. node:test TAP, selected by
 * `--test-name-pattern='^W-382-b<n>\s'`. Every row works in fixture repositories and officinae under the OS tmp dir;
 * nothing reads or writes the real repository's `studio/`, `examples/` or the evidence folders.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { after, test } from "node:test";
import * as shim from "@bisellium/shim";
import * as model from "./opus-model.js";
import { runVerify } from "./verify.js";
import { runDone } from "./lifecycle.js";

const NOW = "2026-10-31T09:00:00.000Z";
const dirs: string[] = [];
const tmp = (tag: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w382-${tag}-`)));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=w382", "-c", "user.email=w382@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
const put = (root: string, rel: string, text: string | Buffer): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const commitAll = (repo: string, message: string): string => {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", message);
  return git(repo, "rev-parse", "HEAD");
};
/** The served UI hash computed here, independently of the code under test: sha256 over git's own listing. */
const expectedUi = (repo: string, ref = "HEAD"): string =>
  `sha256:${createHash("sha256").update(execFileSync("git", ["ls-tree", "-r", "--full-tree", ref, "--", "apps", "examples/sample-studio", "package.json", "package-lock.json"], { cwd: repo, encoding: "utf8" })).digest("hex")}`;

/** A fixture repository: served UI paths, paths outside them, and (with `studio`) an officina under `studio/`. */
function fixtureRepo(tag: string): string {
  const repo = tmp(tag);
  git(repo, "init", "-q", "-b", "master");
  put(repo, "apps/web/src/a.tsx", "export const a = 1;\n");
  put(repo, "apps/server/src/s.ts", "export const s = 1;\n");
  put(repo, "examples/sample-studio/bisellium.yml", "bisellium: 1\n");
  put(repo, "examples/other/x.md", "x\n");
  put(repo, "package.json", "{}\n");
  put(repo, "package-lock.json", "{}\n");
  put(repo, "packages/cli/src/c.ts", "export const c = 1;\n");
  put(repo, "docs/d.md", "d\n");
  commitAll(repo, "c0");
  return repo;
}

const VALID_UI_BODY = [
  "## Findings",
  "No findings",
  "The navigation hierarchy remains legible across every supported viewport.",
  "## Recommendation",
  "The interface treatment preserves clear emphasis and predictable interaction order.",
  "Verdict: passed",
  "",
].join("\n");

// One real 1280x900 grayscale PNG for the screenshot manifest the served-e2e policy re-verifies.
const PNG = ((): Buffer => {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = (table[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1280, 0);
  ihdr.writeUInt32BE(900, 4);
  ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(900 * 1281))), chunk("IEND", Buffer.alloc(0))]);
})();

const ID = "W-910";
const TITLE = "the carried ruling fixture opus";
const UI_A = `sha256:${"a".repeat(64)}`;
const UI_B = `sha256:${"b".repeat(64)}`;
const TREE_B = `tree:${"b".repeat(40)}`; // the ruled branch tree
const TREE_M = `tree:${"c".repeat(40)}`; // master's tree after the merge

/** A served-e2e log as verify writes one: the header, then a blank line, then the command's output. */
const servedLog = (tree: string, header: string[], output = "  ok served suite"): string =>
  [`certifies: ${tree}`, "command: node scripts/served-e2e.mjs", "exit code: 0", ...header, "", output, ""].join("\n");
const logName = (tree: string): string => `ci/${ID}-served-e2e-${tree.slice(5, 13)}.log`;

interface UiOfficina {
  root: string;
  digest: string;
}

/**
 * A ui officina whose record passes the done policy except for its ruling: ui-lead input at 10:00, review at 10:30, the
 * current served-e2e run at `served` (default TREE_M) at 11:00 with its log naming UI_A at 11:00, the branch run's log at
 * TREE_B naming UI_A at 09:30, and the ruling D-901 on TREE_B at 09:45 (`ruling` overrides its front matter lines).
 */
function uiOfficina(tag: string, opts: { root?: string; served?: string; state?: string; ruling?: string[]; current?: string; branch?: string | null } = {}): UiOfficina {
  const root = opts.root ?? tmp(tag);
  const served = opts.served ?? TREE_M;
  for (const d of ["opera", "briefs", "ci", "decisions"]) mkdirSync(join(root, d), { recursive: true });
  put(root, "bisellium.yml", [
    "bisellium: 1",
    "studio: W-382 fixture",
    "patron: patron",
    "collegia:",
    "  - { id: design, name: Design, magister: ui-lead }",
    "  - { id: qa, name: QA, magister: qa-lead }",
    "sellae:",
    "  - { id: ui-lead, collegium: design, kind: agent, harness: fake }",
    "  - { id: qa-lead, collegium: qa, kind: agent, harness: fake }",
    "probationes:",
    "  - { id: review, name: Review, kind: agent }",
    "wip_limit: 20",
    "",
  ].join("\n"));
  put(root, `briefs/${ID}.md`, `# ${ID}\n\nCarried ruling fixture.\n`);
  const digest = model.designDigest(TITLE, readFileSync(join(root, "briefs", `${ID}.md`)));
  put(root, `ci/${ID}-prompt-1.md`, "retained dispatch context uses wholly separate planning vocabulary for the assigned design review");
  put(root, `ci/${ID}-spec-1.log`, [`# opus: ${ID}`, "# phase: spec", "# round: 1", "# sella: ui-lead", "# outcome: passed", "# at: 2026-10-31T08:00:00.000Z", `# design_digest: ${digest}`, `# dispatch_prompt: ci/${ID}-prompt-1.md`, "", VALID_UI_BODY].join("\n"));
  put(root, `ci/${ID}-review-1.log`, [`# opus: ${ID}`, "# phase: build", "# round: 1", "# sella: qa-lead", "# outcome: passed", "# at: 2026-10-31T08:30:00.000Z", `# ui_input: ci/${ID}-spec-1.log`, `# design_digest: ${digest}`, "", "## UI input disposition", "The cited UI input was considered in the sole censor review.", ""].join("\n"));
  put(root, logName(served), opts.current ?? servedLog(served, [`served-ui: ${UI_A}`, "served-at: 2026-10-31T11:00:00.000Z"]));
  if (opts.branch !== null) put(root, logName(TREE_B), opts.branch ?? servedLog(TREE_B, [`served-ui: ${UI_A}`, "served-at: 2026-10-31T09:30:00.000Z"]));
  put(root, `ci/shots/${ID}/board.png`, PNG);
  put(root, `ci/shots/${ID}/manifest.txt`, [`shots: 1 ci/shots/${ID}`, `shot: board.png 1280x900 ${PNG.length}`, ""].join("\n"));
  const ruling = new Map<string, string>([
    ["id", "D-901"], ["by", "patron"], ["provenance", "stated"], ["title", "the branch screens are approved"], ["kill_when", "when the served UI changes"],
    ["opus", ID], ["certifies", TREE_B], ["design_digest", digest], ["at", "2026-10-31T09:45:00.000Z"],
  ]);
  for (const line of opts.ruling ?? []) ruling.set(line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2));
  put(root, "decisions/D-901.md", ["---", ...[...ruling].map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "---", "", "The Patron approved these screens.", ""].join("\n"));
  put(root, `opera/${ID}.md`, [
    "---",
    `id: "${ID}"`,
    `title: "${TITLE}"`,
    "kind: ui",
    "collegium: design",
    `state: ${opts.state ?? "verifying"}`,
    `spec: briefs/${ID}.md`,
    "ui_rulings: [D-901]",
    "probationes:",
    "  review:",
    "    status: passed",
    `    evidence: ci/${ID}-review-1.log`,
    "    sella: qa-lead",
    "    at: 2026-10-31T08:30:00.000Z",
    "  served-e2e:",
    "    status: passed",
    `    evidence: ${logName(served)}`,
    `    certifies: ${served}`,
    "    at: 2026-10-31T11:00:00.000Z",
    "---",
    "Fixture description.",
    "",
  ].join("\n"));
  return { root, digest };
}

/** The opus.ui.rulings messages the done policy returns for the fixture's record. */
function rulingProblems(root: string, phase: "done" | "check" = "done"): string[] {
  const front = model.loadNativeRecords(root).records.get(ID);
  assert.ok(front !== undefined, "the fixture record parses");
  const manifest = { collegia: [{ id: "design", name: "Design", magister: "ui-lead" }, { id: "qa", name: "QA", magister: "qa-lead" }], sellae: [{ id: "ui-lead", collegium: "design", kind: "agent" }, { id: "qa-lead", collegium: "qa", kind: "agent" }], probationes: [{ id: "review", name: "Review", kind: "agent" }] };
  return model
    .validateUiPolicy({ root, record: front, manifest: manifest as never, phase, id: ID })
    .filter((p) => p.rule === "opus.ui.rulings" && p.level !== "advise")
    .map((p) => p.message);
}

test("W-382-b1 behaviour 1: servedUiHash hashes the served UI paths at a commit: a change under them moves it, a change elsewhere does not", () => {
  const hash = (shim as Record<string, unknown>)["servedUiHash"];
  assert.equal(typeof hash, "function", "servedUiHash is exported by @bisellium/shim");
  const servedUiHash = hash as (repo: string, ref?: string) => string;
  assert.deepEqual((shim as Record<string, unknown>)["SERVED_UI_PATHS"], ["apps", "examples/sample-studio", "package.json", "package-lock.json"], "the served UI paths are apps, the fixture officina and the root package files");
  const repo = fixtureRepo("b1");
  const c0 = git(repo, "rev-parse", "HEAD");
  const h0 = servedUiHash(repo);
  assert.match(h0, /^sha256:[0-9a-f]{64}$/, "the hash is sha256: and 64 hex digits");
  assert.equal(h0, expectedUi(repo), "the hash is sha256 over git ls-tree -r --full-tree of the served UI paths");
  for (const rel of ["packages/cli/src/c.ts", "docs/d.md", "examples/other/x.md", "studio/opera/W-1.md", "apps.md"]) {
    put(repo, rel, `changed ${rel}\n`);
    commitAll(repo, `outside ${rel}`);
    assert.equal(servedUiHash(repo), h0, `a change to ${rel}, outside the served UI paths, keeps the hash`);
  }
  let last = h0;
  for (const rel of ["apps/web/src/a.tsx", "apps/server/src/s.ts", "apps/web/src/new.css", "examples/sample-studio/bisellium.yml", "package.json", "package-lock.json"]) {
    put(repo, rel, `changed ${rel}\n`);
    commitAll(repo, `inside ${rel}`);
    const next = servedUiHash(repo);
    assert.notEqual(next, last, `a change to ${rel} moves the hash`);
    assert.equal(next, expectedUi(repo), `after ${rel} the hash is still git's listing`);
    last = next;
  }
  chmodSync(join(repo, "apps/web/src/a.tsx"), 0o755);
  commitAll(repo, "mode");
  assert.notEqual(servedUiHash(repo), last, "a mode change under the served UI paths moves the hash");
  git(repo, "rm", "-q", "apps/web/src/new.css");
  commitAll(repo, "delete");
  assert.equal(servedUiHash(repo), expectedUi(repo), "a deleted file under the served UI paths is gone from the hash");
  assert.equal(servedUiHash(repo, c0), h0, "the hash reads the ref given, not the working tree");
  let threw = false;
  try {
    servedUiHash(repo, "no-such-ref");
  } catch {
    threw = true;
  }
  assert.ok(threw, "a ref git cannot read throws");
});

test("W-382-b2 behaviour 2: a clean verify's served-e2e log names the served UI and its run time in its header, and no other log or dirty run does", async () => {
  const repo = fixtureRepo("b2");
  put(repo, "studio/bisellium.yml", [
    "bisellium: 1",
    "studio: W-382 verify fixture",
    "patron: patron",
    "collegia:",
    "  - { id: design, name: Design, magister: ui-lead }",
    "sellae:",
    "  - { id: ui-lead, collegium: design, kind: agent, harness: fake }",
    "probationes:",
    "  - { id: tests, name: Tests, kind: automated, command: \"true\" }",
    "wip_limit: 20",
    "",
  ].join("\n"));
  put(repo, `studio/opera/${ID}.md`, ["---", `id: "${ID}"`, `title: "${TITLE}"`, "kind: ui", "collegium: design", "state: building", "probationes: {}", "---", "Fixture.", ""].join("\n"));
  mkdirSync(join(repo, "studio", "ci"), { recursive: true });
  commitAll(repo, "studio");
  const studio = join(repo, "studio");
  // the served command's own output forges a header line: it must land after the blank line, never in the header
  const forged = "printf 'served-ui: forged\\nserved-at: forged\\n'";
  const header = (rel: string): string[] => {
    const text = readFileSync(join(studio, rel), "utf8");
    return text.slice(0, text.indexOf("\n\n")).split("\n");
  };
  const quiet = console.log;
  console.log = () => undefined;
  let clean: Awaited<ReturnType<typeof runVerify>>;
  try {
    clean = await runVerify([ID, "--studio", studio, "--repo", repo, "--now", NOW], { commandOverride: { "served-e2e": forged } });
  } finally {
    console.log = quiet;
  }
  assert.equal(clean.exitCode, 0, "the clean verify passes");
  const record = model.loadNativeRecords(studio).records.get(ID) as { probationes: Record<string, { evidence: string; certifies: string; at: string }> };
  const gate = record.probationes["served-e2e"]!;
  assert.deepEqual(
    header(gate.evidence),
    [`certifies: ${gate.certifies}`, `command: ${forged}`, "exit code: 0", `served-ui: ${expectedUi(repo)}`, `served-at: ${NOW}`],
    "a clean run's served-e2e log header names the served UI at the certified commit and the run time",
  );
  assert.equal(gate.at, NOW, "the header's served-at is the gate's recorded at");
  assert.ok(readFileSync(join(studio, gate.evidence), "utf8").includes("\n\nserved-ui: forged\nserved-at: forged\n"), "the command's forged line stays in the output, after the blank line");
  assert.deepEqual(header(record.probationes["tests"]!.evidence), [`certifies: ${record.probationes["tests"]!.certifies}`, "command: true", "exit code: 0"], "another gate's log names no served UI");
  put(repo, "apps/web/src/a.tsx", "export const a = 2;\n");
  console.log = () => undefined;
  const oldError = console.error;
  console.error = () => undefined;
  let dirty: Awaited<ReturnType<typeof runVerify>>;
  try {
    dirty = await runVerify([ID, "--studio", studio, "--repo", repo, "--now", NOW, "--allow-dirty"], { commandOverride: { "served-e2e": "true" } });
  } finally {
    console.log = quiet;
    console.error = oldError;
  }
  assert.equal(dirty.exitCode, 0, "the dirty verify passes");
  const dirtyGate = (model.loadNativeRecords(studio).records.get(ID) as { probationes: Record<string, { evidence: string; certifies: string }> }).probationes["served-e2e"]!;
  assert.deepEqual(header(dirtyGate.evidence), [`certifies: ${dirtyGate.certifies}`, "command: true", "exit code: 0"], "a dirty run's served-e2e log names no served UI");
});
