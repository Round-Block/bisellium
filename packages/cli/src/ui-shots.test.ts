/**
 * W-110 focused red suite for the screenshot-manifest rule: behaviour 6 (check
 * refuses a `kind: ui` opus at review or done whose served-e2e evidence has no
 * screenshot manifest) and behaviour 7 (a manifest that disagrees with the
 * files on disk is refused and cannot reach outside ci/shots/<id>/). Select
 * one with `--behaviour N` (6..7); omitting the selector runs both. node:test
 * TAP, one test() per behaviour, in the ladder-followon.test.ts mould.
 *
 * Counting convention (behaviour 7): a count is of Findings as checkStudio
 * reports them, rule-and-message pairs. A message matching
 * /unsafe|unreadable|symlink|regular file/i is raised under both opus.ui.e2e
 * and opus.reference (addPolicyProblem), so it counts two; every other message
 * counts one. Only findings whose message starts "served-e2e" are counted.
 *
 * Every fixture is a fresh temporary officina; nothing reads or writes
 * studio/ or examples/sample-studio. The helpers of opus-model.test.ts are
 * file-private, so the W-096 ui furniture is rebuilt here.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { after, test } from "node:test";
import { readFront } from "@bisellium/adapter-native";
import { designDigest } from "@bisellium/commands/opus-model.js";
import { checkStudio } from "./check.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 6 || only! > 7)) {
  console.error("ui-shots.test.ts: --behaviour must be 6 or 7");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;
const NOW = new Date("2026-10-03T12:00:00.000Z");

const roots: string[] = [];
function scratch(tag: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `w110-ui-shots-${tag}-`)));
  roots.push(root);
  return root;
}
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PNG and manifest builders
// ---------------------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
const pngCache = new Map<string, Buffer>();
/** A real, decodable grayscale PNG of the given size (all zero pixels). */
function png(width: number, height: number): Buffer {
  const key = `${width}x${height}`;
  const hit = pngCache.get(key);
  if (hit) return hit;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc(height * (1 + width));
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  pngCache.set(key, out);
  return out;
}

const NAMES = ["board", "inbox", "seats", "officina"];
interface Shot {
  name: string;
  width: number;
  height: number;
  bytes: number;
}
const shotLine = (s: Shot): string => `shot: ${s.name} ${s.width}x${s.height} ${s.bytes}`;
const manifestText = (id: string, shots: Shot[], count = shots.length): string =>
  [`shots: ${count} ci/shots/${id}`, ...shots.map(shotLine), ""].join("\n");

// ---------------------------------------------------------------------------
// the W-096 ui furniture: a ui-lead design seat, a design input log, a served-e2e gate and log
// ---------------------------------------------------------------------------
const VALID_UI_BODY = [
  "## Findings",
  "No findings",
  "The navigation hierarchy remains legible across every supported viewport.",
  "## Recommendation",
  "The interface treatment preserves clear emphasis and predictable interaction order.",
  "Verdict: passed",
  "",
].join("\n");
const TREE = `tree:${"1".repeat(40)}`;

interface Fixture {
  root: string;
  id: string;
  dir: string;
  shots: Shot[];
}

function fixture(
  tag: string,
  opts: { id?: string; kind?: string; state?: string; names?: string[]; manifest?: boolean } = {},
): Fixture {
  const id = opts.id ?? "W-910";
  const root = scratch(tag);
  for (const d of ["opera", "briefs", "ci"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-110 focused fixture",
      "patron: patron",
      "collegia:",
      "  - { id: design, name: Design, magister: ui-lead }",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: ui-lead, collegium: design, kind: agent, harness: fake }",
      "  - { id: architect, collegium: design, kind: agent, harness: fake }",
      "  - { id: eng-lead, collegium: engineering, kind: agent, harness: fake }",
      "  - { id: qa-lead, collegium: qa, kind: agent, harness: fake }",
      "probationes:",
      "  []",
      "wip_limit: 20",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "briefs", `${id}.md`), `# ${id}\n\nScreenshot manifest fixture.\n`);
  writeFileSync(
    join(root, "opera", `${id}.md`),
    [
      "---",
      `id: ${JSON.stringify(id)}`,
      'title: "the shots fixture opus"',
      `kind: ${opts.kind ?? "ui"}`,
      "collegium: design",
      `state: ${opts.state ?? "review"}`,
      `spec: briefs/${id}.md`,
      "probationes:",
      "  served-e2e:",
      "    status: passed",
      "    evidence: ci/served.log",
      `    certifies: ${TREE}`,
      "    at: 2026-10-03T11:15:00.000Z",
      "---",
      "Fixture description.\n",
    ].join("\n"),
  );
  writeFileSync(join(root, "ci", "served.log"), [`certifies: ${TREE}`, "command: node scripts/served-e2e.mjs", "exit code: 0", ""].join("\n"));

  // the design input log, so the record carries the same furniture as the W-096 ui fixtures
  const record = readFront<Record<string, unknown>>(join(root, "opera", `${id}.md`)).data;
  const digest = designDigest(String(record["title"]), readFileSync(join(root, `briefs/${id}.md`)));
  writeFileSync(join(root, "ci", `${id}-prompt-1.md`), "retained dispatch context uses wholly separate planning vocabulary for the assigned design review");
  writeFileSync(
    join(root, "ci", `${id}-spec-1.log`),
    [
      `# opus: ${id}`,
      "# phase: spec",
      "# round: 1",
      "# sella: ui-lead",
      "# outcome: passed",
      "# at: 2026-10-03T11:00:00.000Z",
      `# design_digest: ${digest}`,
      `# dispatch_prompt: ci/${id}-prompt-1.md`,
      "",
      VALID_UI_BODY,
    ].join("\n"),
  );

  // the shots: real PNGs under ci/shots/<id>/ named in a valid manifest.txt
  const dir = join(root, "ci", "shots", id);
  const shots: Shot[] = [];
  if (opts.manifest !== false || opts.names !== undefined) {
    mkdirSync(dir, { recursive: true });
    for (const n of opts.names ?? NAMES.slice(0, 2)) {
      const bytes = png(1280, 900);
      writeFileSync(join(dir, `${n}.png`), bytes);
      shots.push({ name: `${n}.png`, width: 1280, height: 900, bytes: bytes.length });
    }
    if (opts.manifest !== false) writeFileSync(join(dir, "manifest.txt"), manifestText(id, shots));
  }
  return { root, id, dir, shots };
}

const seen = new Set<string>();
/** The served-e2e findings checkStudio reports for the record, as sorted "rule: message" strings. */
function served(f: Fixture): string[] {
  const out: string[] = [];
  for (const finding of checkStudio(f.root, NOW).findings) {
    if (finding.where !== `opera/${f.id}.md`) continue;
    if (finding.rule !== "opus.ui.e2e" && finding.rule !== "opus.reference") continue;
    if (!finding.message.startsWith("served-e2e")) continue;
    seen.add(finding.message);
    out.push(`${finding.rule}: ${finding.message}`);
  }
  return out.sort();
}
const one = (message: string): string[] => [`opus.ui.e2e: ${message}`];
const two = (message: string): string[] => [`opus.reference: ${message}`, `opus.ui.e2e: ${message}`];

// ---------------------------------------------------------------------------
// behaviour 6
// ---------------------------------------------------------------------------
if (runs(6)) {
  test("W-110 behaviour 6: check refuses a kind: ui opus at review or done whose served-e2e evidence has no screenshot manifest", () => {
    // (a) passes today: the valid officina has no served-e2e finding.
    assert.deepEqual(served(fixture("6a")), [], "(a) a valid officina produces no served-e2e finding");

    // (b) passes today: the existing log clauses still fire, and are not short-circuited.
    const failing = fixture("6b");
    const log = join(failing.root, "ci", "served.log");
    writeFileSync(log, readFileSync(log, "utf8").replace("exit code: 0", "exit code: 1"));
    assert.deepEqual(served(failing), one("served-e2e evidence does not record a successful run"), "(b) exit code 1 still gives the existing finding");

    // (c) Genuine red: PNGs in place, manifest.txt deleted.
    const noManifest = fixture("6c");
    rmSync(join(noManifest.dir, "manifest.txt"));
    assert.deepEqual(served(noManifest), one("served-e2e evidence carries no screenshot manifest"), "(c) a deleted manifest gives exactly one finding");

    // (d) the gate is required only from review.
    const building = fixture("6d", { state: "building", manifest: false });
    assert.deepEqual(served(building), [], "(d) a building ui opus with no manifest has no served-e2e finding");

    // (e) a non-ui opus is unaffected.
    const task = fixture("6e", { kind: "task", manifest: false });
    assert.deepEqual(served(task), [], "(e) a kind: task opus with no manifest has no served-e2e finding");

    // (f) a manifest naming another opus's directory: one finding, no entry read.
    const other = fixture("6f", { names: NAMES });
    writeFileSync(join(other.dir, "manifest.txt"), manifestText("W-911", other.shots));
    const otherFindings = served(other);
    assert.deepEqual(otherFindings, one("served-e2e screenshot manifest names another opus's directory"), "(f) one finding naming the directory");
    for (const line of otherFindings) {
      assert.ok(!line.includes(other.root), "(f) the message carries no absolute path");
      assert.ok(!line.includes("IHDR"), "(f) the message carries no PNG byte");
    }

    // (g) an id over 22 characters: one finding naming the limit, no file read.
    const long = fixture("6g", { id: `W-${"1".repeat(21)}`, manifest: false });
    assert.equal(long.id.length, 23, "(g) the id is 23 characters");
    assert.deepEqual(served(long), one("served-e2e screenshot manifest needs an opus id of at most 22 characters"), "(g) one finding naming the 22-character limit");
  });
}

// ---------------------------------------------------------------------------
// behaviour 7
// ---------------------------------------------------------------------------
if (runs(7)) {
  test("W-110 behaviour 7: a screenshot manifest that disagrees with the files on disk is refused and cannot reach outside ci/shots/<id>/", () => {
    const four = (tag: string): Fixture => fixture(tag, { names: NAMES });
    const edit = (f: Fixture, fn: (text: string) => string): void => {
      const path = join(f.dir, "manifest.txt");
      writeFileSync(path, fn(readFileSync(path, "utf8")));
    };

    // (a) passes today: the unmutated officina is clean.
    assert.deepEqual(served(four("7a")), [], "(a) the unmutated four-shot officina has no served-e2e finding");

    // (b) Genuine red: deleting one named PNG gives exactly one finding; the other three still validate.
    const gone = four("7b");
    rmSync(join(gone.dir, "seats.png"));
    assert.deepEqual(served(gone), one("served-e2e screenshot seats.png is missing"), "(b) a deleted PNG gives exactly one 'is missing' finding");

    // (c) five mutations of one shot line's name each give exactly one 'malformed entry'.
    const malformed = "served-e2e screenshot manifest has a malformed entry";
    for (const [label, name] of [["path separator", "a/b.png"], ["dot-dot", ".."], ["upper-case", "Board.png"], ["leading dot", ".board.png"], ["suffix", "board.txt"]] as const) {
      const f = four("7c");
      edit(f, (t) => t.replace("shot: board.png ", `shot: ${name} `));
      assert.deepEqual(served(f), one(malformed), `(c) ${label}: exactly one 'malformed entry'`);
    }

    // (d) a symlinked shot, and a symlinked parent directory, each give two findings.
    const outside = scratch("7d-outside");
    writeFileSync(join(outside, "elsewhere.png"), png(1280, 900));
    const linked = four("7d-file");
    rmSync(join(linked.dir, "seats.png"));
    symlinkSync(join(outside, "elsewhere.png"), join(linked.dir, "seats.png"));
    assert.deepEqual(served(linked), two("served-e2e screenshot seats.png is unsafe or unreadable: path reaches its target through a symlink"), "(d) a symlinked shot gives the e2e and the reference finding");
    const parent = four("7d-dir");
    const real = join(parent.root, "ci", "real-shots");
    renameSync(parent.dir, real);
    symlinkSync(real, parent.dir);
    assert.deepEqual(served(parent), two("served-e2e screenshot manifest is unsafe or unreadable: path reaches its target through a symlink"), "(d) a symlinked parent directory gives the e2e and the reference finding");

    // (e) a byte-length mismatch, and an IHDR mismatch, each give one 'does not match its recorded size'.
    const sizeMessage = "served-e2e screenshot seats.png does not match its recorded size";
    const longer = four("7e-bytes");
    writeFileSync(join(longer.dir, "seats.png"), Buffer.concat([png(1280, 900), Buffer.from([0])]));
    assert.deepEqual(served(longer), one(sizeMessage), "(e) one byte too long gives exactly one size finding");
    const narrow = four("7e-width");
    edit(narrow, (t) => t.replace(/^shot: seats\.png 1280x/m, "shot: seats.png 1279x"));
    assert.deepEqual(served(narrow), one(sizeMessage), "(e) a differing width gives exactly one size finding");

    // (f) a truthful 2x2 PNG is too small.
    const tiny = four("7f");
    const tinyBytes = png(2, 2);
    writeFileSync(join(tiny.dir, "seats.png"), tinyBytes);
    edit(tiny, (t) => t.replace(/^shot: seats\.png .*$/m, `shot: seats.png 2x2 ${tinyBytes.length}`));
    assert.deepEqual(served(tiny), one("served-e2e screenshot seats.png is smaller than 800x600"), "(f) a truthful 2x2 PNG gives exactly one 'smaller' finding");

    // (g) correct dimensions in the line but no PNG signature.
    const notPng = four("7g");
    writeFileSync(join(notPng.dir, "seats.png"), Buffer.alloc(100, 0x78));
    edit(notPng, (t) => t.replace(/^shot: seats\.png .*$/m, "shot: seats.png 1280x900 100"));
    assert.deepEqual(served(notPng), one("served-e2e screenshot seats.png is not a PNG"), "(g) no PNG signature gives exactly one 'is not a PNG' finding");

    // (h) count disagreements and a repeated name: step 3 stops, one finding each.
    const countOff = four("7h-count");
    edit(countOff, (t) => t.replace(/^shots: 4 /m, "shots: 3 "));
    assert.deepEqual(served(countOff), one("served-e2e screenshot manifest count disagrees with its entries"), "(h) header 3 over four lines gives exactly one count finding");
    const empty = four("7h-zero");
    writeFileSync(join(empty.dir, "manifest.txt"), `shots: 0 ci/shots/${empty.id}\n`);
    assert.deepEqual(served(empty), one("served-e2e screenshot manifest count disagrees with its entries"), "(h) header 0 with no lines gives exactly one count finding");
    const repeat = fixture("7h-repeat", { names: ["board", "board"] });
    writeFileSync(join(repeat.dir, "manifest.txt"), manifestText(repeat.id, repeat.shots));
    assert.deepEqual(served(repeat), one("served-e2e screenshot manifest repeats a file name"), "(h) the same file named twice gives exactly one finding");

    // (i) the bounds fire: 65 entries read no PNG; an over-cap PNG is refused by the helper.
    const many = four("7i-many");
    const ghosts: Shot[] = Array.from({ length: 65 }, (_, n) => ({ name: `s${String(n).padStart(2, "0")}.png`, width: 1280, height: 900, bytes: 100 }));
    writeFileSync(join(many.dir, "manifest.txt"), manifestText(many.id, ghosts));
    assert.deepEqual(served(many), one("served-e2e screenshot manifest declares more than 64 screenshots"), "(i) 65 entries give exactly one ceiling finding and read no PNG");
    const fat = four("7i-fat");
    const cap = 4 * 1024 * 1024;
    const fatBytes = Buffer.concat([png(1280, 900), Buffer.alloc(cap + 1 - png(1280, 900).length)]);
    writeFileSync(join(fat.dir, "seats.png"), fatBytes);
    edit(fat, (t) => t.replace(/^shot: seats\.png .*$/m, `shot: seats.png 1280x900 ${fatBytes.length}`));
    assert.equal(statSync(join(fat.dir, "seats.png")).size, cap + 1, "(i) the oversized PNG is exactly SHOT_MAX_BYTES + 1");
    assert.deepEqual(served(fat), two(`served-e2e screenshot seats.png is unsafe or unreadable: target exceeds ${cap} bytes`), "(i) an over-cap PNG gives the e2e and the reference finding; the other three validate");

    // (j) an oversized manifest is refused at step 1; with the PNGs gone, anything read past step 1 would add findings.
    const bigManifest = four("7j");
    const valid = readFileSync(join(bigManifest.dir, "manifest.txt"), "utf8");
    writeFileSync(join(bigManifest.dir, "manifest.txt"), valid + "\n".repeat(8 * 1024 + 1 - valid.length));
    for (const n of NAMES) rmSync(join(bigManifest.dir, `${n}.png`));
    assert.equal(statSync(join(bigManifest.dir, "manifest.txt")).size, 8 * 1024 + 1, "(j) the manifest is exactly MANIFEST_MAX_BYTES + 1");
    assert.deepEqual(served(bigManifest), two("served-e2e screenshot manifest is unsafe or unreadable: target exceeds 8192 bytes"), "(j) an oversized manifest gives the e2e and the reference finding and nothing else");

    // (k) every message produced above is short ASCII with no path-shaped run and no raw bytes.
    assert.ok(seen.size > 0, "(k) the rows above produced messages to inspect");
    for (const message of seen) {
      assert.match(message, /^[\x20-\x7e]{1,160}$/, `(k) ${JSON.stringify(message)} is 1..160 printable ASCII characters`);
      assert.ok(!message.includes("/tmp"), `(k) ${message} does not contain /tmp`);
      assert.ok(!roots.some((r) => message.includes(r)), `(k) ${message} does not contain a fixture path`);
      assert.doesNotMatch(message, /\/[\w.-]+\//, `(k) ${message} contains no path-shaped run`);
      assert.ok(!message.includes("IHDR") && !/^shots?: /m.test(message), `(k) ${message} contains no PNG or manifest text`);
    }
  });
}
