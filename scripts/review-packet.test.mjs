/**
 * W-215 behaviour 4: `scripts/review-packet.mjs` gives a later review round its delta, its facts and its prompt.
 * Rows are `node:test`, named `W-215-b4 …`; each red is recorded with `--test-name-pattern=W-215-b4`. Every row builds
 * its own git repository and officina under the OS tmp dir; nothing here writes in `studio/`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPacket } from "./review-packet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const SCRIPT = join(HERE, "review-packet.mjs");
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const MANIFEST = [
  "bisellium: 1",
  "studio: w215",
  "patron: patron",
  "collegia:",
  "  - { id: design, name: Design, magister: architect }",
  "  - { id: engineering, name: Engineering, magister: eng-lead }",
  "  - { id: qa, name: QA, magister: qa-lead }",
  "sellae:",
  "  - { id: architect, collegium: design, kind: agent }",
  "  - { id: eng-lead, collegium: engineering, kind: agent }",
  "  - { id: qa-lead, collegium: qa, kind: agent }",
  "  - { id: spec-reviewer, collegium: qa, kind: agent, model: gpt-5.6-sol, harness: codex }",
  "probationes:",
  "  - { id: spec, name: Spec, kind: agent }",
  "  - { id: review, name: Review, kind: agent }",
  "wip_limit: 10",
  "",
].join("\n");
const TEMPLATE =
  "Round <ROUND> of <ID>. Previous round: <PREVIOUS>. Packet: <PACKET>.\nJudge delta.diff only. Number each earlier finding <k>.\n";
const HANDOFF = [
  "# Handoff",
  "",
  "## Queue",
  "",
  "- W-1 is queued",
  "",
  "## Resume point (2026-10-11)",
  "",
  "Next: W-1",
  "",
].join("\n");
const BRIEF = "# W-1\n\nThe brief.\n\n## Intent\n\nOne line.\n";

const git = (cwd, args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const blob = (text) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");

/** A sessioned review log, header block and `No findings` body, as the verdict writer would record it. */
function sessioned(opus, kind, round, sella, session, phase = kind === "review" ? "build" : kind) {
  return [
    `# opus: ${opus}`,
    `# phase: ${phase}`,
    `# round: ${round}`,
    `# sella: ${sella}`,
    "# outcome: passed",
    `# session: ${session}`,
    "# at: 2026-10-11T00:00:00.000Z",
    "",
    "## Findings",
    "No findings",
    "",
  ].join("\n");
}

/** A git repo holding docs/SESSION-HANDOFF.md and an officina `studio/` with opera W-1 and W-2, committed. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w215-packet-"));
  made.push(root);
  const repo = join(root, "repo");
  const studio = join(repo, "studio");
  const packets = join(root, "packets");
  mkdirSync(packets);
  git(root, ["init", "-q", "-b", "master", repo]);
  put(studio, "bisellium.yml", MANIFEST);
  for (const id of ["W-1", "W-2"]) {
    put(
      studio,
      `opera/${id}.md`,
      `---\nid: ${id}\ntitle: ${id} fixture\nkind: opus\ncollegium: engineering\nstate: greenlit\nprobationes: {}\nspec: briefs/${id}.md\n---\n`,
    );
    put(studio, `briefs/${id}.md`, BRIEF.replace("W-1", id));
  }
  put(studio, "prompts/later-round.md", TEMPLATE);
  put(repo, "docs/SESSION-HANDOFF.md", HANDOFF);
  put(repo, "src/a.txt", "first line\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixture"]);
  const run = (args) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const packet = (phase, opus, round, sella, extra = []) =>
    run([
      "--phase",
      phase,
      "--opus",
      opus,
      "--round",
      String(round),
      "--sella",
      sella,
      "--studio",
      studio,
      "--repo",
      repo,
      "--packets",
      packets,
      ...extra,
    ]);
  const read = (round, name) => readFileSync(join(packets, `r${round}`, name), "utf8");
  const has = (round, name) => existsSync(join(packets, `r${round}`, name));
  return { root, repo, studio, packets, git: (...a) => git(repo, a), put, packet, read, has, run };
}
/** every path under a directory, sorted: "writes nothing" is a comparison of two of these */
const tree = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? [`${relative(base, join(dir, e.name))}/`, ...tree(join(dir, e.name), base)]
        : [relative(base, join(dir, e.name))],
    )
    .sort();

test("W-215-b4 behaviour 4: a spec round with no sessioned predecessor gets its subject and facts, no delta", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  const r = w.packet("spec", "W-1", 2, "spec-reviewer");
  assert.equal(r.status, 0, r.err);
  assert.equal(w.read(2, "subject"), readFileSync(join(w.studio, "briefs/W-1.md"), "utf8"), "subject is the brief");
  const facts = w.read(2, "facts.txt");
  assert.match(facts, /^== next W-1$/m);
  assert.match(facts, /^== brief admission W-1$/m);
  assert.match(facts, /^exit \d+$/m);
  assert.equal(w.has(2, "delta.diff"), false, "no predecessor, no delta");
  assert.equal(w.has(2, "prompt.md"), false, "no predecessor, no later-round prompt");
});

test("W-215-b4 behaviour 4: a later spec round gets the change since the sessioned predecessor, and its prompt", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  assert.equal(w.packet("spec", "W-1", 2, "spec-reviewer").status, 0, "round 2 packet");
  w.put(
    w.studio,
    "ci/W-1-spec-2.log",
    sessioned("W-1", "spec", 2, "spec-reviewer", "s-1").replace(
      "# outcome: passed",
      `# outcome: passed\n# brief: briefs/W-1.md blob:${blob(BRIEF)}`,
    ),
  );
  writeFileSync(join(w.studio, "briefs/W-1.md"), `${BRIEF}\nAn added line.\n`);
  const r = w.packet("spec", "W-1", 4, "spec-reviewer");
  assert.equal(r.status, 0, r.err);
  const delta = w.read(4, "delta.diff");
  assert.match(delta, /^\+An added line\.$/m, "the delta holds the edit");
  assert.doesNotMatch(delta, /^\+The brief\.$/m, "and only the edit");
  const prompt = w.read(4, "prompt.md");
  assert.match(prompt, /ci\/W-1-spec-2\.log/, "the prompt names the previous round's log");
  assert.ok(prompt.includes(join(w.packets, "r4")), "and the packet");
  assert.doesNotMatch(prompt, /<(ID|ROUND|PREVIOUS|PACKET)>/, "no slot is left");
  assert.match(prompt, /<k>/, "other <…> text is left as written");
  assert.match(prompt, /Round 4 of W-1/);
  assert.match(w.read(4, "facts.txt"), /^== next W-1$/m);
});

test("W-215-b4 behaviour 4: a handoff round diffs against HEAD and states facts for the opera on added lines only", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  writeFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), `${HANDOFF}Also W-2 is next.\n`);
  const r = w.packet("handoff", "W-1", 1, "qa-lead");
  assert.equal(r.status, 0, r.err);
  assert.equal(
    w.read(1, "subject"),
    readFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), "utf8"),
    "subject is the handoff",
  );
  assert.match(w.read(1, "delta.diff"), /^\+Also W-2 is next\.$/m, "the delta is against HEAD");
  const facts = w.read(1, "facts.txt");
  assert.match(facts, /^== sessionHandoffFindings$/m);
  assert.match(facts, /^== next W-2$/m, "W-2 is on an added line");
  assert.match(facts, /^== brief admission W-2$/m);
  assert.doesNotMatch(facts, /^== next W-1$/m, "W-1 is on unchanged lines only");
  assert.equal(w.has(1, "prompt.md"), false, "no sessioned predecessor, no later-round prompt");
});

test("W-215-b4 behaviour 4: a build round diffs from the commit that added the previous log, outside the officina", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  w.put(w.studio, "ci/W-1-review-1.log", sessioned("W-1", "review", 1, "qa-lead", "c-1"));
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "review 1");
  writeFileSync(join(w.repo, "src/a.txt"), "first line\nchanged line\n");
  writeFileSync(join(w.studio, "briefs/W-1.md"), `${BRIEF}\nA brief edit.\n`);
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "after review 1");
  const r = w.packet("build", "W-1", 2, "qa-lead");
  assert.equal(r.status, 0, r.err);
  const delta = w.read(2, "delta.diff");
  assert.match(delta, /^\+changed line$/m, "the source change is in the delta");
  assert.doesNotMatch(delta, /A brief edit|studio\//, "the officina is excluded");
  assert.equal(w.has(2, "subject"), false, "a build packet has no subject");
  assert.match(w.read(2, "prompt.md"), /ci\/W-1-review-1\.log/, "the prompt names the previous round's log");
  assert.match(w.read(2, "facts.txt"), /^== next W-1$/m);
});

test("W-215-b4 behaviour 4: a bad request exits 2 and writes nothing", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const refused = (name, w, run) => {
    const before = tree(w.packets);
    const r = run();
    assert.equal(r.status, 2, `${name}: exit ${r.status}\n${r.err}`);
    assert.deepEqual(tree(w.packets), before, `${name}: nothing is written`);
  };
  const w = world();
  mkdirSync(join(w.packets, "r2"));
  refused("an existing r2", w, () => w.packet("spec", "W-1", 2, "spec-reviewer"));
  refused("an unknown phase", w, () => w.packet("nope", "W-1", 3, "spec-reviewer"));
  refused("round 0", w, () => w.packet("spec", "W-1", 0, "spec-reviewer"));
  refused("a hostile opus id", w, () => w.packet("spec", "../W-1", 3, "spec-reviewer"));

  const noSubject = world();
  noSubject.put(noSubject.studio, "ci/W-1-spec-2.log", sessioned("W-1", "spec", 2, "spec-reviewer", "s-1"));
  refused("a sessioned predecessor with no packet subject", noSubject, () =>
    noSubject.packet("spec", "W-1", 4, "spec-reviewer"),
  );

  const noTemplate = world();
  assert.equal(noTemplate.packet("spec", "W-1", 2, "spec-reviewer").status, 0);
  noTemplate.put(noTemplate.studio, "ci/W-1-spec-2.log", sessioned("W-1", "spec", 2, "spec-reviewer", "s-1"));
  rmSync(join(noTemplate.studio, "prompts/later-round.md"));
  refused("a missing later-round template", noTemplate, () => noTemplate.packet("spec", "W-1", 4, "spec-reviewer"));

  const bare = world();
  const plain = join(bare.root, "plain");
  mkdirSync(plain);
  refused("no git repository", bare, () =>
    bare.run([
      "--phase",
      "spec",
      "--opus",
      "W-1",
      "--round",
      "2",
      "--sella",
      "spec-reviewer",
      "--studio",
      bare.studio,
      "--repo",
      plain,
      "--packets",
      bare.packets,
    ]),
  );
});

test("W-215-b4 behaviour 4: a --packets at or under --studio exits 2 and writes nothing", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  mkdirSync(join(w.studio, "packets"));
  symlinkSync(w.studio, join(w.root, "alias"));
  const args = (packets) => [
    "--phase",
    "spec",
    "--opus",
    "W-1",
    "--round",
    "2",
    "--sella",
    "spec-reviewer",
    "--studio",
    w.studio,
    "--repo",
    w.repo,
    "--packets",
    packets,
  ];
  for (const [name, packets] of [
    ["the studio itself", w.studio],
    ["a directory under the studio", join(w.studio, "packets")],
    ["a symlink to the studio", join(w.root, "alias")],
  ]) {
    const before = tree(w.studio);
    const r = w.run(args(packets));
    assert.equal(r.status, 2, `${name}: exit ${r.status}\n${r.err}`);
    assert.deepEqual(tree(w.studio), before, `${name}: nothing is written`);
  }
  assert.equal(w.run(args(w.packets)).status, 0, "a --packets outside the studio still works");
});

test("W-314-b1 behaviour 1: buildPacket reads prompts/later-round.md from promptStudio, defaulting to studio, and refuses what is not a template", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  w.put(w.studio, "ci/W-1-review-1.log", sessioned("W-1", "review", 1, "qa-lead", "c-1"));
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "review 1");
  const build = (promptStudio) =>
    buildPacket({
      phase: "build",
      opus: "W-1",
      round: 2,
      sella: "qa-lead",
      studio: w.studio,
      repo: w.repo,
      packets: w.packets,
      ...(promptStudio === undefined ? {} : { promptStudio }),
    });
  const promptStudio = (name, files) => {
    const dir = join(w.root, name);
    for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
    return dir;
  };
  assert.match(build().files.get("prompt.md") ?? "", /^Round 2 of W-1\./, "absent: the template is studio's");
  const other = promptStudio("other", {
    "prompts/later-round.md": TEMPLATE.replace("Round <ROUND>", "Other round <ROUND>"),
  });
  assert.match(
    build(other).files.get("prompt.md") ?? "",
    /^Other round 2 of W-1\./,
    "given: the template is promptStudio's",
  );
  const refusal = /prompts\/later-round\.md: /;
  assert.throws(() => build(join(w.root, "nowhere")), refusal, "a studio with no template");
  const outside = promptStudio("outside", { "elsewhere/later-round.md": TEMPLATE });
  mkdirSync(join(w.root, "escaping"));
  symlinkSync(join(outside, "elsewhere"), join(w.root, "escaping", "prompts"));
  assert.throws(() => build(join(w.root, "escaping")), refusal, "a prompts directory that escapes the studio");
  const linked = promptStudio("linked", { "elsewhere/later-round.md": TEMPLATE });
  mkdirSync(join(linked, "prompts"));
  symlinkSync(join(linked, "elsewhere/later-round.md"), join(linked, "prompts/later-round.md"));
  assert.throws(() => build(linked), refusal, "a symlinked template");
  const directory = promptStudio("directory", {});
  mkdirSync(join(directory, "prompts/later-round.md"), { recursive: true });
  assert.throws(() => build(directory), refusal, "a template that is not a regular file");
  const missing = promptStudio("missing", { "prompts/later-round.md": TEMPLATE.replace("<PACKET>", "") });
  assert.throws(() => build(missing), /prompts\/later-round\.md lacks the slot <PACKET>/, "a template missing a slot");
});

test("W-215-r1-3 studio containment: a studio whose name merely starts with `..` is inside the repo", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  const dotted = join(w.repo, "..studio");
  renameSync(w.studio, dotted);
  const r = w.run([
    "--phase",
    "spec",
    "--opus",
    "W-1",
    "--round",
    "1",
    "--sella",
    "spec-reviewer",
    "--studio",
    dotted,
    "--repo",
    w.repo,
    "--packets",
    w.packets,
  ]);
  assert.equal(r.status, 0, r.err);
  assert.ok(w.has(1, "subject"), "the packet is written");
});
