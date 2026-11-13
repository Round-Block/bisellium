import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../../..");
const MODULE = join(ROOT, "packages/commands/src/ui-capture-comments.ts");
const PNG_SOURCE = join(ROOT, "studio/ci/shots/W-499/board-390.png");
const TREE = `tree:${"1".repeat(40)}`;

function fixture(opera: string[] = ["W-1"]): string {
  const root = mkdtempSync(join(tmpdir(), "w488-"));
  mkdirSync(join(root, "opera"));
  mkdirSync(join(root, "briefs"));
  mkdirSync(join(root, "ci/shots"), { recursive: true });
  for (const id of opera) {
    const shots = join(root, "ci/shots", id);
    mkdirSync(shots);
    cpSync(PNG_SOURCE, join(shots, "board-390.png"));
    const bytes = readFileSync(join(shots, "board-390.png"));
    writeFileSync(join(shots, "manifest.txt"), `shots: 1 ci/shots/${id}\nshot: board-390.png 390x900 ${bytes.length}\n`);
    writeFileSync(join(root, "briefs", `${id}.md`), `# ${id}\n\nCapture fixture.\n`);
    writeFileSync(
      join(root, "opera", `${id}.md`),
      `---\nid: "${id}"\ntitle: "Capture ${id}"\nkind: "ui"\nstate: review\nspec: "briefs/${id}.md"\nprobationes:\n  served-e2e:\n    status: passed\n    certifies: ${TREE}\n    at: 2026-11-13T01:02:03.000Z\n---\n`,
    );
  }
  return root;
}

async function captureModule(): Promise<typeof import("../../../packages/commands/src/ui-capture-comments.js")> {
  return import(pathToFileURL(MODULE).href) as Promise<typeof import("../../../packages/commands/src/ui-capture-comments.js")>;
}

test("W-488-b1 behaviour 1: the browser lists only bounded capture manifests with their certified source tree", async () => {
  assert.equal(existsSync(MODULE), true, "the existing served-e2e manifest has one bounded capture-set reader");
  const { readUiCaptureSets } = await captureModule();
  const empty = fixture([]);
  const many = fixture(["W-1", "W-2"]);
  try {
    assert.deepEqual(readUiCaptureSets(empty, TREE), { sets: [] }, "no manifest is an honest empty set");
    const read = readUiCaptureSets(many, `tree:${"2".repeat(40)}`);
    assert.ok("sets" in read, "two valid manifests read");
    assert.deepEqual(read.sets.map((set) => set.opus), ["W-1", "W-2"], "sets are stable by opus id");
    assert.equal(read.sets[0]?.tree, TREE, "the set uses the served-e2e certificate, not the browser's checkout");
    assert.equal(read.sets[0]?.current, false, "a capture from an older source tree is named as older");
    assert.equal(read.sets[0]?.shots[0]?.name, "board-390.png", "the existing manifest names the image");
    assert.equal(read.sets[0]?.shots[0]?.sha256, createHash("sha256").update(readFileSync(join(many, "ci/shots/W-1/board-390.png"))).digest("hex"), "image bytes are bound by hash");
    assert.match(read.sets[0]?.designDigest ?? "", /^sha256:[0-9a-f]{64}$/, "the current design digest travels beside the capture tree");

    writeFileSync(join(many, "ci/shots/W-2/manifest.txt"), "not a manifest\n");
    const refused = readUiCaptureSets(many, TREE);
    assert.ok("problems" in refused, "one malformed declared set fails the whole listing closed");
    assert.match(refused.problems.join("\n"), /W-2: served-e2e screenshot manifest has no header/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(many, { recursive: true, force: true });
  }
});

test("W-488-b2 behaviour 2: a pin appends one bounded comment bound to selector viewport state and image bytes", async () => {
  const source = readFileSync(MODULE, "utf8");
  assert.match(source, /export function appendUiCaptureComment/, "the capture browser has one append-only bounded comment writer");
  const { appendUiCaptureComment, readUiCaptureComments, readUiCaptureSets } = await captureModule();
  const root = fixture();
  try {
    const listed = readUiCaptureSets(root, TREE);
    assert.ok("sets" in listed);
    const set = listed.sets[0]!;
    assert.deepEqual(readUiCaptureComments(root, set), { comments: [] }, "zero comments stays an explicit empty list");
    const first = appendUiCaptureComment(
      root,
      TREE,
      {
        author: "patron",
        opus: set.opus,
        tree: set.tree,
        designDigest: set.designDigest,
        manifestSha256: set.manifestSha256,
        image: "board-390.png",
        imageSha256: set.shots[0]!.sha256,
        viewport: { width: 390, height: 900 },
        selector: '[data-card-id="W-004"]',
        state: "sidebar collapsed",
        pin: { x: 0.25, y: 0.5 },
        body: "Keep the reason with the card.",
      },
      { now: new Date("2026-11-13T02:03:04.000Z"), id: "UC-1" },
    );
    assert.equal(first.ok, true, "one valid pin is appended");
    const second = appendUiCaptureComment(
      root,
      TREE,
      {
        author: "design-lead",
        opus: set.opus,
        tree: set.tree,
        designDigest: set.designDigest,
        manifestSha256: set.manifestSha256,
        image: "board-390.png",
        imageSha256: set.shots[0]!.sha256,
        viewport: { width: 390, height: 900 },
        selector: ".board__card-title",
        state: "settled",
        pin: { x: 1, y: 0 },
        body: "This title needs one more complete line.",
      },
      { now: new Date("2026-11-13T02:04:05.000Z"), id: "UC-2" },
    );
    assert.equal(second.ok, true, "many comments append independently");
    const comments = readUiCaptureComments(root, set);
    assert.ok("comments" in comments);
    assert.equal(comments.comments.length, 2, "one and many are counted from valid records");
    assert.deepEqual(
      comments.comments[0],
      {
        version: 1,
        kind: "ui_capture_comment",
        id: "UC-1",
        at: "2026-11-13T02:03:04.000Z",
        author: "patron",
        opus: "W-1",
        tree: TREE,
        designDigest: set.designDigest,
        manifestSha256: set.manifestSha256,
        image: "board-390.png",
        imageSha256: set.shots[0]!.sha256,
        viewport: { width: 390, height: 900 },
        selector: '[data-card-id="W-004"]',
        state: "sidebar collapsed",
        pin: { x: 0.25, y: 0.5 },
        body: "Keep the reason with the card.",
      },
      "the record carries every binding in plain data",
    );
    const stale = appendUiCaptureComment(root, `tree:${"3".repeat(40)}`, { ...first.record!, body: "stale tab" });
    assert.deepEqual(stale, { ok: false, error: "capture set changed; reload before commenting" }, "an older tab cannot append onto a different set");
    const huge = appendUiCaptureComment(root, TREE, { ...first.record!, body: "x".repeat(1001) });
    assert.deepEqual(huge, { ok: false, error: "comment must be 1 to 1000 characters without control characters" }, "the comment body is bounded");
    const timeline = join(root, "timeline/patron.jsonl");
    writeFileSync(timeline, readFileSync(timeline, "utf8") + '{"kind":"ui_capture_comment"\n');
    const malformed = readUiCaptureComments(root, set);
    assert.ok("problems" in malformed, "an unparseable line naming a capture comment fails closed");
    assert.match(malformed.problems.join("\n"), /capture comment line 3: record is not valid JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
