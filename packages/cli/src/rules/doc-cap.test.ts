/**
 * W-288 rows b1-b3 (studio/briefs/W-288.md): doc.cap and the docs/ADOPTION.md split. node:test TAP, selected by
 * `--test-name-pattern='^W-288-b<n>\s'`. b1 and b2 build their own repo under the OS tmp dir; b3 reads this repo's docs/ and runs the move script.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkDocs } from "./docs.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const text = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i + 1}\n`).join("");
/** A repo holding `files` (repo-relative path to content). */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-w288-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
const caps = (dir: string, docCaps: unknown): string[] =>
  checkDocs(dir, { now: NOW, repo: dir, manifest: docCaps === undefined ? {} : { doc_caps: docCaps } })
    .filter((f) => f.rule === "doc.cap")
    .map((f) => `${f.level} ${f.where}: ${f.message}`);

test("W-288-b1 behaviour 1: doc.cap blocks a top-level docs/*.md over its cap, the file's own or the default", () => {
  const files = { "docs/A.md": text(5), "docs/BIG.md": text(10), "README.md": text(50), "docs/design/deep.md": text(50) };
  const policy = { default: 5, "docs/BIG.md": 10 };
  assert.deepEqual(caps(repo(files), policy), [], "every doc at its cap: no finding");
  assert.deepEqual(
    caps(repo({ ...files, "docs/A.md": text(6) }), policy),
    ["block docs/A.md: 6 lines, over its cap of 5 (bisellium.yml doc_caps); cut it, or raise its cap in bisellium.yml"],
    "one line over the default: one block at the doc",
  );
  assert.deepEqual(
    caps(repo({ ...files, "docs/BIG.md": text(11) }), policy),
    ["block docs/BIG.md: 11 lines, over its cap of 10 (bisellium.yml doc_caps); cut it, or raise its cap in bisellium.yml"],
    "one line over its own cap: one block at the doc",
  );
  assert.deepEqual(
    caps(repo({ ...files, "docs/A.md": "---\nkind: guide\n---\nx\ny\nz\n" }), policy),
    ["block docs/A.md: 6 lines, over its cap of 5 (bisellium.yml doc_caps); cut it, or raise its cap in bisellium.yml"],
    "front matter lines count",
  );
  assert.deepEqual(caps(repo({ ...files, "docs/A.md": `${text(5)}tail` }), policy).length, 1, "an unterminated last line counts");
  assert.deepEqual(caps(repo({ ...files, "docs/A.md": text(99) }), undefined), [], "no doc_caps key: no rule");
  assert.deepEqual(checkDocs("x", { now: NOW, manifest: { doc_caps: policy } }), [], "no --repo: no rule");
});
