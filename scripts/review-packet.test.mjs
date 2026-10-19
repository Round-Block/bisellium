/**
 * W-215 behaviour 4: `scripts/review-packet.mjs` gives a later review round its delta, its facts and its prompt.
 * Rows are `node:test`, named `W-215-b4 …`; each red is recorded with `--test-name-pattern=W-215-b4`. Every row builds
 * its own git repository and officina under the OS tmp dir; nothing here writes in `studio/`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
  "Round <ROUND> of <ID>. Previous round: <PREVIOUS>. Packet: <PACKET>. Lessons: <STUDIO>/lessons/.\nJudge delta.diff only. Number each earlier finding <k>.\n";
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

/** True only for a missing path (ENOENT): any other lstat error (a permission, a loop) is rethrown, never read as absence. */
const absentPath = (path) => {
  try {
    lstatSync(path);
    return false;
  } catch (e) {
    if (e.code === "ENOENT") return true;
    throw e;
  }
};

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

test("W-215-b4 behaviour 4: a build round diffs from the commit that added the previous log", () => {
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
  assert.match(delta, /^\+A brief edit\.$/m, "the officina's change follows it (W-314)");
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

test("W-314-b2 behaviour 2: a build round's delta carries the officina's change since the previous log, after the source change", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  w.put(w.studio, "ci/W-1-review-1.log", sessioned("W-1", "review", 1, "qa-lead", "c-1"));
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "review 1");
  // a studio-only fix: a gate log and a brief edit, no source change
  w.put(w.studio, "ci/W-1-tests-0123abcd.log", "certifies: tree:0123abcd\ncommand: node -e 0\nexit code: 0\n");
  writeFileSync(join(w.studio, "briefs/W-1.md"), `${BRIEF}\nA brief fix.\n`);
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "a studio-only fix");
  const r = w.packet("build", "W-1", 2, "qa-lead");
  assert.equal(r.status, 0, r.err);
  const delta = w.read(2, "delta.diff");
  assert.match(delta, /^\+A brief fix\.$/m, "a studio-only fix: the brief edit is in the delta");
  assert.match(
    delta,
    /^\+\+\+ b\/studio\/ci\/W-1-tests-0123abcd\.log$/m,
    "a studio-only fix: the new gate log is in the delta",
  );
  assert.doesNotMatch(delta, /W-1-review-1\.log/, "the previous round's own log is the base, not the delta");
  // a source change beside it: the source diff comes first, the officina's after, though `tools/` sorts after `studio/`
  w.put(w.repo, "tools/late.txt", "a source fix\n");
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "a source fix");
  const r3 = w.packet("build", "W-1", 3, "qa-lead");
  assert.equal(r3.status, 0, r3.err);
  const both = w.read(3, "delta.diff");
  const source = both.indexOf("+a source fix");
  assert.ok(source >= 0 && source < both.indexOf("+A brief fix."), `the source change, then the officina's:\n${both}`);
});

test("W-315-b2 behaviour 2: a hand-run later-round packet for a linked worktree's studio reads later-round.md from the main work tree and fills <STUDIO> with it", () => {
  assert.ok(existsSync(SCRIPT), "scripts/review-packet.mjs exists");
  const w = world();
  const main = "Round <ROUND> of <ID>. Previous round: <PREVIOUS>. Packet: <PACKET>. Lessons: <STUDIO>/lessons/.\n";
  w.put(w.studio, "prompts/later-round.md", main);
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "the main checkout's template");
  // the opus branch in a linked worktree rewrites its own copy; the packet is run from the main checkout, as `next` orders
  const wt = join(w.repo, ".worktrees", "W-1");
  w.git("worktree", "add", "-q", "-b", "opus/W-1", wt);
  const branchStudio = join(wt, "studio");
  w.put(branchStudio, "prompts/later-round.md", main.replace("Round <ROUND>", "The branch's own round <ROUND>"));
  git(wt, ["add", "-A"]);
  git(wt, ["commit", "-q", "-m", "the branch's template"]);
  const args = (round) => [
    "--phase",
    "spec",
    "--opus",
    "W-1",
    "--round",
    String(round),
    "--sella",
    "spec-reviewer",
    "--studio",
    branchStudio,
    "--repo",
    w.repo,
    "--packets",
    w.packets,
  ];
  const packet = (round) => w.run(args(round));
  assert.equal(packet(2).status, 0, "round 2 packet");
  w.put(
    branchStudio,
    "ci/W-1-spec-2.log",
    sessioned("W-1", "spec", 2, "spec-reviewer", "s-1").replace(
      "# outcome: passed",
      `# outcome: passed\n# brief: briefs/W-1.md blob:${blob(BRIEF)}`,
    ),
  );
  const r = packet(4);
  assert.equal(r.status, 0, r.err);
  const prompt = w.read(4, "prompt.md");
  assert.match(prompt, /^Round 4 of W-1\./, `the main work tree's template, not the branch's:\n${prompt}`);
  assert.equal(
    prompt,
    `Round 4 of W-1. Previous round: ci/W-1-spec-2.log. Packet: ${join(w.packets, "r4")}. Lessons: ${realpathSync(w.studio)}/lessons/.\n`,
    "every slot filled, <STUDIO> the main checkout's studio",
  );

  // buildPacket directly: an absent promptStudio is studio's place in the main work tree, a given one is used as given
  const build = (round, promptStudio) =>
    buildPacket({
      phase: "spec",
      opus: "W-1",
      round,
      sella: "spec-reviewer",
      studio: branchStudio,
      repo: w.repo,
      packets: w.packets,
      ...(promptStudio === undefined ? {} : { promptStudio }),
    });
  assert.match(build(5).files.get("prompt.md") ?? "", /^Round 5 of W-1\./, "absent: the main work tree's template");
  const given = build(5, branchStudio).files.get("prompt.md") ?? "";
  assert.ok(given.startsWith("The branch's own round 5"), "given: promptStudio's template");
  assert.ok(given.includes(`Lessons: ${branchStudio}/lessons/.`), "given: <STUDIO> is promptStudio as given");

  // the main work tree's copy is read as it stands, and judged like any template
  const mainTemplate = join(w.studio, "prompts/later-round.md");
  const refusal = /prompts\/later-round\.md: /;
  writeFileSync(mainTemplate, main.replace(" Lessons: <STUDIO>/lessons/.", ""));
  assert.throws(() => build(5), /prompts\/later-round\.md lacks the slot <STUDIO>/, "a main template without <STUDIO>");
  rmSync(mainTemplate);
  assert.throws(() => build(5), refusal, "no template in the main work tree");
  symlinkSync(join(branchStudio, "prompts/later-round.md"), mainTemplate);
  assert.throws(() => build(5), refusal, "a symlinked main template");
  rmSync(mainTemplate);
  mkdirSync(mainTemplate);
  assert.throws(() => build(5), refusal, "a main template that is not a regular file");
  rmSync(join(w.studio, "prompts"), { recursive: true });
  symlinkSync(join(branchStudio, "prompts"), join(w.studio, "prompts"));
  assert.throws(() => build(5), refusal, "a main prompts directory that is a symlink");

  // the CLI: a refusal exits 2, any other throw exits 1, both before the packet directory exists
  const refused = packet(6);
  assert.equal(refused.status, 2, refused.err);
  assert.match(
    refused.err,
    /^review-packet: prompts\/later-round\.md: /,
    "a main work tree without a template refuses",
  );
  assert.equal(absentPath(join(w.packets, "r6")), true, "a refusal writes no packet directory");
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const withGit = (name, body, round) => {
    const bin = join(w.root, name);
    put(bin, "git", `#!/bin/sh\n${body}\nexec ${realGit} "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const r = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args(round)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    return { status: r.status, err: r.stderr };
  };
  const noMain = withGit("git-no-main", '[ "$1" = worktree ] && exit 0', 7);
  assert.equal(noMain.status, 2, noMain.err);
  assert.match(noMain.err, /^review-packet: git worktree list names no main work tree$/m, "no worktree line refuses");
  assert.equal(absentPath(join(w.packets, "r7")), true, "no worktree line writes no packet directory");
  const noTop = withGit(
    "git-no-top",
    '[ "$1" = rev-parse ] && [ "$2" = --show-toplevel ] && { echo /w315/no/such/top; exit 0; }',
    8,
  );
  assert.equal(noTop.status, 1, noTop.err);
  assert.doesNotMatch(noTop.err, /^review-packet: /m, "an unrefused throw is not reported as a refusal");
  assert.equal(absentPath(join(w.packets, "r8")), true, "a thrown error writes no packet directory");
});

test("W-322-b3 behaviour 3: a build packet's facts list the ruled cases no pin of theirs finds in the source diff", () => {
  const w = world();
  // brief lines: 6 to 10 the Input domain rows, 12 the grammar line row 10 cites
  const brief = [
    "# W-1",
    "## Input domain",
    "A rejection fails closed.",
    "| Record | Valid domain | Rejected by |",
    "|---|---|---|",
    '| a | a string | `f`: exit 2, pinned by `W-1-b1` "first pin" |',
    '| b | a string | `g`: exit 2, pinned by `W-1-b1` "second pin" |',
    "| c | its step | runner: `gates` fails; unpinned |",
    "| d | a string | `h`: exit 2 |",
    '| e | any text; recognises brief:12; every other form is a limit | `k`: never errors, pinned by `W-1-b2` "grammar row" |',
    "## Interfaces",
    '- one form, pinned by `W-1-b2` "grammar form"',
    "",
  ].join("\n");
  w.put(w.studio, "briefs/W-1.md", brief);
  // on master: a test holding row 7's pin, unchanged on the branch
  w.put(w.repo, "src/old.test.mjs", 'test("W-1-b1", () => assert.equal(x, "second pin"));\n');
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "brief and an old test");
  w.git("checkout", "-q", "-b", "opus/W-1");
  w.put(w.repo, "src/a.test.mjs", 'test("W-1-b1 behaviour 1", () => {\n  assert.equal(x, "first pin");\n});\n');
  w.put(w.repo, "src/b.test.mjs", 'test("W-1-b9", () => assert.equal(y, "second pin"));\n');
  w.put(w.repo, "src/c.test.mjs", 'test("W-1-b2 behaviour 2", () => assert.equal(z, "grammar row"));\n');
  w.put(w.studio, "notes.md", 'W-1-b2 "grammar form" in the officina, not the source\n');
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "the opus");
  const r = w.packet("build", "W-1", 1, "qa-lead");
  assert.equal(r.status, 0, r.err);
  const facts = w.read(1, "facts.txt");
  assert.match(facts, /^== ruled cases with no pinning assertion in the diff$/m, "the build facts carry the block");
  const block = facts.slice(facts.indexOf("== ruled cases with no pinning assertion in the diff"));
  assert.equal(
    block,
    [
      "== ruled cases with no pinning assertion in the diff",
      "ruledCases(briefs/W-1.md) against git diff <merge-base with master> HEAD, outside studio",
      'brief:7 (Input domain row): pinned by `W-1-b1` "second pin": not in the diff',
      "brief:8 (Input domain row): unpinned",
      "brief:9 (Input domain row): no pin",
      'brief:12 (grammar line of brief:10): pinned by `W-1-b2` "grammar form": not in the diff',
      "",
    ].join("\n"),
    "rows 6 and 10 are found; the others are listed in brief order",
  );

  // a row whose forms clause cites its own line: its row case first, then the same line as a grammar line
  w.put(
    w.studio,
    "briefs/W-1.md",
    [
      "# W-1",
      "## Input domain",
      "A rejection fails closed.",
      "| Record | Valid domain | Rejected by |",
      "|---|---|---|",
      '| e | any text; recognises brief:6; every other form is a limit | `k`: never errors, pinned by `W-1-b2` "self pin" |',
      "",
    ].join("\n"),
  );
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "a self-citing row");
  const self = w.packet("build", "W-1", 5, "qa-lead");
  assert.equal(self.status, 0, self.err);
  assert.ok(
    w
      .read(5, "facts.txt")
      .endsWith(
        [
          'brief:6 (Input domain row): pinned by `W-1-b2` "self pin": not in the diff',
          'brief:6 (grammar line of brief:6): pinned by `W-1-b2` "self pin": not in the diff',
          "",
        ].join("\n"),
      ),
    "a self-cited row is listed as a grammar line after its row, in case order",
  );

  // a brief with no ruled case states none; a spec packet carries no such block
  w.put(w.studio, "briefs/W-1.md", BRIEF);
  w.git("add", "-A");
  w.git("commit", "-q", "-m", "no rows");
  const none = w.packet("build", "W-1", 2, "qa-lead");
  assert.equal(none.status, 0, none.err);
  assert.match(
    w.read(2, "facts.txt"),
    /^== ruled cases with no pinning assertion in the diff\n.*\n\(none\)\n$/m,
    "no case: (none)",
  );
  const spec = w.packet("spec", "W-1", 3, "spec-reviewer");
  assert.equal(spec.status, 0, spec.err);
  assert.doesNotMatch(w.read(3, "facts.txt"), /ruled cases/, "a spec packet has no pin block");

  // no master: the base is stated, not refused
  w.git("branch", "-q", "-m", "master", "trunk");
  const nobase = w.packet("build", "W-1", 4, "qa-lead");
  assert.equal(nobase.status, 0, nobase.err);
  assert.match(
    w.read(4, "facts.txt"),
    /^== ruled cases with no pinning assertion in the diff\n.*\nno base: no refs\/heads\/master or refs\/remotes\/origin\/master$/m,
    "no master ref is stated in the block",
  );
});
