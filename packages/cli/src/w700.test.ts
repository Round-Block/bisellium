/**
 * W-700 (studio/briefs/W-700.md): lessons name their fix and reach master. Rows b1-b5 build temp officinae with
 * `initStudio` under the OS tmp dir (b3 also a temp git repo for `bisellium ci`); row b6 reads the kept texts under
 * studio/ (bisellium.yml and lex production), so this file is a test:record file. Select one row with
 * --test-name-pattern='^W-700-b1\s'.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { openLessons } from "@bisellium/commands/lessons.js";
import { checkStudio, type Finding } from "./check.js";
import { runCi } from "./ci.js";
import { initStudio } from "./init.js";
import { landable } from "./land.js";
import { draftRetro } from "./retro.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-11-21T00:00:00Z");
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-700-b[1-9] /, "");
  test(name, { timeout: 600_000 }, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}

const put = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
/** A git repo holding an officina at `studio/`; `defaults` is the manifest's defaults line, or none. */
function world(defaults: string | undefined): { repo: string; root: string } {
  const repo = mkdtempSync(join(tmpdir(), "bisellium-w700-"));
  made.push(repo);
  const root = join(repo, "studio");
  initStudio(root, { now: NOW });
  put(
    root,
    "bisellium.yml",
    [
      "bisellium: 1",
      "studio: w700",
      "patron: patron",
      "collegia:",
      "  - { id: production, name: Production, magister: producer }",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: producer, collegium: production, kind: agent }",
      "  - { id: eng-lead, collegium: engineering, kind: agent }",
      "probationes:",
      "  - { id: patron, name: Patron call, kind: human }",
      "wip_limit: 9",
      ...(defaults === undefined ? [] : [defaults]),
      "",
    ].join("\n"),
  );
  git(repo, ["init", "-q", "-b", "master"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "init"]);
  return { repo, root };
}
function lesson(root: string, id: string, at: string, cls: string, addressedBy?: string, cascade?: number): void {
  put(
    root,
    `lessons/${id}.md`,
    `---\nid: "${id}"\nat: ${at}\nclass: "${cls}"\nevidence: ["bisellium.yml"]\n${cascade === undefined ? "" : `cascade: ${cascade}\n`}${addressedBy === undefined ? "" : `addressed_by: ${JSON.stringify(addressedBy)}\n`}---\nFixture.\n`,
  );
}
const findings = (root: string, rule: string, repo?: string): Finding[] => checkStudio(root, NOW, repo === undefined ? {} : { repo }).findings.filter((f) => f.rule === rule);
const at = (fs: Finding[], where: string): Finding | undefined => fs.find((f) => f.where === where);

row("W-700-b1 land carries a lesson", () => {
  assert.equal(landable("studio/lessons/L-1.md", "studio"), true, "a lesson under studio/lessons/ is a landable record");
  assert.equal(landable("studio/lessons/", "studio"), false, "the directory itself is no record");
  assert.equal(landable("studio/opera/W-1.md", "studio"), true, "an opus record still lands");
  assert.equal(landable("studio/briefs/W-1.md", "studio"), false, "a brief rides its opus branch");
  assert.equal(landable("studio/leges/production.md", "studio"), false, "a lex keeps its real PR");
});

