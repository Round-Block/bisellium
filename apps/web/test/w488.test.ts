import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { startServer, type StartServerOptions } from "@bisellium/server";

const ROOT = resolve(import.meta.dirname, "../../..");
const MODULE = join(ROOT, "packages/commands/src/ui-capture-comments.ts");
const PNG_SOURCE = join(ROOT, "studio/ci/shots/W-499/board-390.png");
const SAMPLE_STUDIO = join(ROOT, "examples/sample-studio");
const TREE = `tree:${"1".repeat(40)}`;
const TOKEN = "w488-comment-token";

const NOOP_RUNNERS: StartServerOptions["runners"] = {
  answer: () => ({ exitCode: 0 }),
  greenlight: () => ({ exitCode: 0 }),
  budget: () => ({ exitCode: 0 }),
  handoff: () => ({ exitCode: 0 }),
  talk: async () => ({ exitCode: 0 }),
  pause: async () => ({ exitCode: 0 }),
  resume: async () => ({ exitCode: 0 }),
  delegate: () => ({ exitCode: 0 }),
};

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

test("W-488-b3 behaviour 3: three injected local routes preserve bounded capture bindings", () => {
  const api = readFileSync(join(ROOT, "apps/web/src/api.ts"), "utf8");
  const http = readFileSync(join(ROOT, "apps/server/src/http.ts"), "utf8");
  const serve = readFileSync(join(ROOT, "packages/cli/src/serve.ts"), "utf8");
  assert.match(api, /export function fetchUiCaptureSets/, "the browser-facing API can read bounded capture metadata");
  assert.match(api, /export async function fetchUiCaptureImage/, "image requests encode only the selected opus and manifest image name");
  assert.match(api, /export function submitUiCaptureComment/, "comment writes use the authenticated JSON helper");
  assert.match(http, /\/api\/ui-capture-sets/, "the existing local server exposes capture metadata");
  assert.match(http, /\/api\/ui-capture-image\//, "the existing local server serves only an image from that manifest");
  assert.match(http, /\/api\/ui-capture-comment/, "the existing local server accepts one bounded pin");
  assert.match(serve, /readUiCaptureReview/, "serve injects the current checkout's bounded metadata reader");
  assert.match(serve, /readUiCaptureImage/, "serve injects the manifest-bound immutable image reader");
  assert.match(serve, /appendUiCaptureComment/, "serve injects the append-only comment writer");
});

test("W-488-b3 served: pins the comment route's auth before timeline append", async () => {
  const root = mkdtempSync(join(tmpdir(), "w488-served-"));
  cpSync(SAMPLE_STUDIO, root, { recursive: true });
  mkdirSync(join(root, "briefs"), { recursive: true });
  mkdirSync(join(root, "opera"), { recursive: true });
  const shots = join(root, "ci/shots/W-1");
  mkdirSync(shots, { recursive: true });
  cpSync(PNG_SOURCE, join(shots, "board-390.png"));
  const image = readFileSync(join(shots, "board-390.png"));
  writeFileSync(join(shots, "manifest.txt"), `shots: 1 ci/shots/W-1\nshot: board-390.png 390x900 ${image.length}\n`);
  writeFileSync(join(root, "briefs/W-1.md"), "# W-1\n\nCapture fixture.\n");
  writeFileSync(
    join(root, "opera/W-1.md"),
    `---\nid: "W-1"\ntitle: "Capture W-1"\nkind: "ui"\nstate: review\nspec: "briefs/W-1.md"\nprobationes:\n  served-e2e:\n    status: passed\n    certifies: ${TREE}\n    at: 2026-11-13T01:02:03.000Z\n---\n`,
  );

  const { appendUiCaptureComment, readUiCaptureImage, readUiCaptureSets } = await captureModule();
  const listed = readUiCaptureSets(root, TREE);
  assert.ok("sets" in listed, "the served fixture has one current capture set");
  const set = listed.sets[0]!;
  const shot = set.shots[0]!;
  const body = {
    author: "patron",
    opus: set.opus,
    tree: set.tree,
    designDigest: set.designDigest,
    manifestSha256: set.manifestSha256,
    image: shot.name,
    imageSha256: shot.sha256,
    viewport: { width: shot.width, height: shot.height },
    selector: ".board__card",
    state: "settled",
    pin: { x: 0.5, y: 0.5 },
    body: "A valid comment must not append without route auth.",
  };
  const timeline = join(root, "timeline/patron.jsonl");
  const before = existsSync(timeline) ? readFileSync(timeline, "utf8") : "";
  const server = await startServer({
    studioDir: root,
    port: 0,
    once: true,
    now: new Date("2026-11-13T02:03:04.000Z"),
    token: TOKEN,
    checkStudio: () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }),
    runners: NOOP_RUNNERS,
    listModels: () => Promise.resolve([]),
    captureReview: {
      read: () => readUiCaptureSets(root, TREE),
      image: (opus, name) => readUiCaptureImage(root, TREE, opus, name),
      comment: (input) => appendUiCaptureComment(root, TREE, input as Parameters<typeof appendUiCaptureComment>[2]),
    },
  });
  const endpoint = `http://127.0.0.1:${server.port}/api/ui-capture-comment`;
  try {
    const missingToken = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(missingToken.status, 401, "a valid comment without X-Bisellium-Token is refused");
    assert.equal(existsSync(timeline) ? readFileSync(timeline, "utf8") : "", before, "the missing-token refusal appends no timeline line");

    const foreignOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bisellium-token": TOKEN, origin: "https://foreign.example" },
      body: JSON.stringify(body),
    });
    assert.equal(foreignOrigin.status, 403, "a valid comment from a foreign Origin is refused");
    assert.equal(existsSync(timeline) ? readFileSync(timeline, "utf8") : "", before, "the foreign-origin refusal appends no timeline line");
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("W-488-b4 behaviour 4: only comments bound to the reviewed capture set feed the one review gate", async () => {
  const packetPath = join(ROOT, "scripts/review-packet.mjs");
  const source = readFileSync(packetPath, "utf8");
  assert.match(source, /ui-comments\.txt/, "the existing build-review packet receives bounded capture comments");
  assert.match(source, /readUiCaptureReview/, "review reuses the capture-set binding reader instead of trusting browser data");
  assert.match(source, /selectedSet\.current/, "a capture from an older tree cannot feed the current review");
  const { captureCommentFact } = await import(pathToFileURL(packetPath).href) as { captureCommentFact: (comments: unknown[]) => string };
  assert.equal(captureCommentFact([]), "Capture comments bound to this served set: 0\nNo capture comments.\n", "zero comments is explicit");
  const comments = [
    { id: "UC-1", author: "patron", image: "board-1280.png", viewport: { width: 1280, height: 900 }, selector: ".board__card", state: "settled", pin: { x: 0.25, y: 0.5 }, body: "First note." },
    { id: "UC-2", author: "design-lead", image: "board-390.png", viewport: { width: 390, height: 900 }, selector: "#board", state: "phone", pin: { x: 0.75, y: 0.2 }, body: "Second note." },
  ];
  const text = captureCommentFact(comments);
  assert.match(text, /^Capture comments bound to this served set: 2$/m, "many comments are counted once");
  assert.match(text, /^1\. Patron — board-1280\.png — 1280x900 — \.board__card — settled — pin 25%,50%\nFirst note\.$/m, "one comment carries every visual binding");
  assert.match(text, /^2\. Design lead — board-390\.png — 390x900 — #board — phone — pin 75%,20%\nSecond note\.$/m, "comments keep append order");

  const { appendUiCaptureComment, readUiCaptureComments, readUiCaptureSets } = await captureModule();
  const root = fixture();
  try {
    const listed = readUiCaptureSets(root, TREE);
    assert.ok("sets" in listed);
    const set = listed.sets[0]!;
    const shot = set.shots[0]!;
    const written = appendUiCaptureComment(root, TREE, {
      author: "patron", opus: set.opus, tree: set.tree, designDigest: set.designDigest, manifestSha256: set.manifestSha256,
      image: shot.name, imageSha256: shot.sha256, viewport: { width: shot.width, height: shot.height },
      selector: ".board__card", state: "settled", pin: { x: 0.5, y: 0.5 }, body: "Bound to these image bytes.",
    }, { now: new Date("2026-11-13T04:05:06.000Z"), id: "UC-image" });
    assert.equal(written.ok, true);
    const changed = { ...set, shots: [{ ...shot, sha256: "f".repeat(64) }] };
    assert.deepEqual(readUiCaptureComments(root, changed), { comments: [] }, "a comment whose image hash no longer matches is left out of review");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
