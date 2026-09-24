/**
 * scripts/backlog-page.test.mjs — the 9 behaviours of studio/briefs/W-041.md.
 * No framework, same house style as scripts/changelog.test.mjs; the
 * behaviour-number filter follows packages/cli/src/ci.test.ts's `only`
 * pattern so `bisellium red` can record one assertion-level failure per
 * behaviour.
 *
 * Every behaviour builds its own fixture officina (and fixture handoff)
 * under the OS tmp dir, except behaviour 8, which reads the real
 * docs/SESSION-HANDOFF.md. Neither studio/ nor examples/sample-studio is
 * written.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findGuardViolations, readOfficina, renderBacklogPage } from "./backlog-page.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const SCRIPT = join(HERE, "backlog-page.mjs");

let failed = 0;
const only = process.argv[2] !== undefined ? Number(process.argv[2]) : undefined;
function check(behaviour, name, ok, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  [${behaviour}] ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const DEFAULT_GATES = ["tests", "lint", "types", "spec", "review"];

function scaffoldStudio(dir, gateIds = DEFAULT_GATES) {
  writeFile(
    join(dir, "bisellium.yml"),
    `bisellium: 1\nstudio: Fixture\nprobationes:\n${gateIds.map((id) => `  - { id: ${id}, name: ${id} }`).join("\n")}\n`,
  );
}

function opusFixture(dir, { id, title = id, collegium = "engineering", state, probationes = "{}", extra = "" }) {
  writeFile(
    join(dir, "opera", `${id}.md`),
    `---\nid: "${id}"\ntitle: "${title}"\nkind: "task"\ncollegium: "${collegium}"\nstate: ${state}\nprobationes: ${probationes}\n${extra}---\n`,
  );
}

function petitioFixture(dir, { id, opus, quoted = true, state = "needs_you" }) {
  const opusLine = opus === undefined ? "" : quoted ? `opus: "${opus}"\n` : `opus: ${opus}\n`;
  writeFile(
    join(dir, "petitiones", `${id}.md`),
    `---\nid: "${id}"\nfrom: guest\nto: patron\nstate: ${state}\n${opusLine}---\nbody\n`,
  );
}

function decisionFixture(dir, { id, title = id, killWhen }) {
  const killLine = killWhen === undefined ? "" : `kill_when: "${killWhen}"\n`;
  writeFile(
    join(dir, "decisions", `${id}.md`),
    `---\nid: "${id}"\ntitle: "${title}"\nat: 2026-01-01T00:00:00Z\nby: architect\n${killLine}---\nbody\n`,
  );
}

/** A ranking acta the generator only ever links to (findLatestRankingActa
 *  matches `*-ranking.md`; content is never parsed). */
function rankingActaFixture(dir, filename) {
  writeFile(join(dir, "acta", filename), `---\nkind: daily\nauthor: architect\n---\nranking body\n`);
}

/** Escapes a string for embedding in a double-quoted YAML scalar, so a
 *  hostile fixture value (a literal `"` or `\`) still parses as one field —
 *  behaviour 6's attribute-escaping test needs this; opusFixture's naive
 *  `"${id}"` interpolation would otherwise corrupt the front matter itself. */
function yamlDq(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `bisellium-backlog-${prefix}-`));
}

/** Recursive snapshot of a directory as relative-path -> content, for
 *  asserting a run touched nothing inside it (behaviour 9). */
function snapshotDir(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  const walk = (d, prefix) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.set(rel, readFileSync(full, "utf8"));
    }
  };
  walk(dir, "");
  return out;
}

function snapshotsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function runCli(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

// ---------------------------------------------------------------------------
// behaviour 1: grouping
// ---------------------------------------------------------------------------
{
  const dir = tmp("b1");
  try {
    scaffoldStudio(dir);
    opusFixture(dir, { id: "W-001", state: "backlog" });
    opusFixture(dir, { id: "W-002", state: "greenlit" });
    opusFixture(dir, { id: "W-003", state: "building" });
    opusFixture(dir, {
      id: "W-004",
      state: "halted",
      extra: `halted_at: 2026-01-01T00:00:00Z\nhalted_by: D-999\nresume_when: "never"\n`,
    });
    opusFixture(dir, { id: "W-005", state: "done" });
    rankingActaFixture(dir, "2026-09-24-ranking.md");

    const officina = readOfficina(dir);
    const outPath = join(dir, "out.html");
    const html = renderBacklogPage({ ...officina, outPath });

    check(1, "greenlit opus appears", html.includes('data-id="W-002"'));
    check(1, "building opus appears", html.includes('data-id="W-003"'));
    check(1, "backlog opus appears", html.includes('data-id="W-001"'));
    check(1, "halted opus appears", html.includes('data-id="W-004"'));
    check(1, "done opus never appears", !html.includes('data-id="W-005"'));

    const inFlightSection = html.indexOf(">In flight<");
    const backlogSection = html.indexOf(">Backlog<");
    const w002 = html.indexOf('data-id="W-002"');
    const w003 = html.indexOf('data-id="W-003"');
    const w001 = html.indexOf('data-id="W-001"');
    const w004 = html.indexOf('data-id="W-004"');
    check(
      1,
      "greenlit + building render under In flight, backlog + halted render under Backlog",
      inFlightSection < w002 &&
        w002 < backlogSection &&
        inFlightSection < w003 &&
        w003 < backlogSection &&
        w001 > backlogSection &&
        w004 > backlogSection,
    );

    // D-021: the In-flight table must state it shows this checkout's trunk
    // view, verbatim, not silently pass off `greenlit` as live state.
    check(
      1,
      "the In-flight table carries the D-021 trunk-view caption",
      html.includes(
        "State as recorded in this checkout&rsquo;s officina. On the trunk, per D-021, an opus being built still reads",
      ),
    );

    // The revisit-trigger footnote is the whole reason `rank:` stays out of
    // scope (see studio/briefs/W-041.md, "Ordering").
    check(
      1,
      "the revisit-trigger footnote is present",
      html.includes(
        "If a hand-written ordering of these items appears anywhere outside an acta twice more, <code>rank:</code> has earned its opus.",
      ),
    );

    // The page never ranks; it links the latest ranking acta as the source
    // of record for order.
    check(
      1,
      "the latest ranking acta is linked as the source of record for order",
      html.includes('href="acta/2026-09-24-ranking.md"') && html.includes(">2026-09-24-ranking<"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 2: "blocked on"
// ---------------------------------------------------------------------------
{
  const dir = tmp("b2");
  try {
    scaffoldStudio(dir);
    opusFixture(dir, {
      id: "W-010",
      state: "backlog",
      extra: `traditio:\n  sella: producer\n  stage: building\n  blocked_on: "needs W-005"\n  at: 2026-01-01T00:00:00Z\n`,
    });
    petitioFixture(dir, { id: "P-001", opus: "W-010", quoted: true, state: "needs_you" });
    petitioFixture(dir, { id: "P-002", opus: "W-010", quoted: false, state: "awaiting_reply" });
    petitioFixture(dir, { id: "P-003", opus: "W-010", quoted: true, state: "resolved" });

    opusFixture(dir, {
      id: "W-020",
      state: "halted",
      extra: `traditio:\n  sella: producer\n  stage: building\n  blocked_on: "stale text should not show"\n  at: 2026-01-01T00:00:00Z\nhalted_at: 2026-01-01T00:00:00Z\nhalted_by: D-099\nresume_when: "test resume"\n`,
    });

    // `bisellium handoff` writes the literal sentinel "none" when
    // --blocked-on is omitted — that is "no blocker recorded", not a
    // blocker named "none" (studio/ci/W-041-review-1.log, B2).
    opusFixture(dir, {
      id: "W-030",
      state: "backlog",
      extra: `traditio:\n  sella: producer\n  stage: building\n  blocked_on: "none"\n  at: 2026-01-01T00:00:00Z\n`,
    });
    opusFixture(dir, {
      id: "W-031",
      state: "backlog",
      extra: `traditio:\n  sella: producer\n  stage: building\n  blocked_on: "none"\n  at: 2026-01-01T00:00:00Z\n`,
    });
    petitioFixture(dir, { id: "P-040", opus: "W-031", quoted: true, state: "needs_you" });

    const officina = readOfficina(dir);
    const html = renderBacklogPage({ ...officina, outPath: join(dir, "out.html") });

    check(2, "quoted-opus open petitio appears", html.includes("P-001 (needs_you)"));
    check(2, "bare-opus open petitio appears", html.includes("P-002 (awaiting_reply)"));
    check(2, "traditio.blocked_on appears alongside petitiones", html.includes("needs W-005"));
    check(2, "resolved petitio does not appear", !html.includes("P-003"));
    check(2, "halted opus shows halted_by", html.includes("D-099"));
    check(2, "halted opus shows resume_when", html.includes("test resume"));
    check(2, "halted opus's stale traditio.blocked_on is not shown", !html.includes("stale text should not show"));

    const row = (id) => {
      const start = html.indexOf(`data-id="${id}"`);
      return html.slice(start, html.indexOf("</tr>", start));
    };
    check(
      2,
      "blocked_on: none with no open petitio renders an em dash, not the word none",
      row("W-030").includes(">—<") && !/\bnone\b/i.test(row("W-030")),
    );
    check(
      2,
      "blocked_on: none with an open petitio shows only the petitio, not the word none",
      row("W-031").includes("P-040 (needs_you)") && !/\bnone\b/i.test(row("W-031")),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 3: gates
// ---------------------------------------------------------------------------
{
  const dir = tmp("b3");
  try {
    scaffoldStudio(dir); // 5 declared gates
    opusFixture(dir, {
      id: "W-030",
      state: "backlog",
      probationes:
        "{ tests: { status: passed }, lint: { status: passed }, types: { status: waived }, spec: { status: failed } }",
    });
    const officina = readOfficina(dir);
    const html = renderBacklogPage({ ...officina, outPath: join(dir, "out.html") });
    check(3, "passed/declared counts only passed gates", html.includes("2/5"));
    check(3, "a waived gate is called out and not counted as passed", html.includes("1 waived"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 4: ordering — id-descending, halted after backlog, deterministic
// ---------------------------------------------------------------------------
{
  const dir = tmp("b4");
  try {
    scaffoldStudio(dir);
    opusFixture(dir, { id: "W-001", state: "backlog" });
    opusFixture(dir, { id: "W-002", state: "backlog" });
    opusFixture(dir, {
      id: "W-004",
      state: "halted",
      extra: `halted_at: 2026-01-01T00:00:00Z\nhalted_by: D-999\nresume_when: "never"\n`,
    });
    opusFixture(dir, {
      id: "W-005",
      state: "halted",
      extra: `halted_at: 2026-01-01T00:00:00Z\nhalted_by: D-999\nresume_when: "never"\n`,
    });

    const officina = readOfficina(dir);
    const html = renderBacklogPage({ ...officina, outPath: join(dir, "out.html") });
    const pos = (id) => html.indexOf(`data-id="${id}"`);
    check(
      4,
      "id-descending within backlog, halted rows after backlog rows",
      pos("W-002") < pos("W-001") && pos("W-001") < pos("W-005") && pos("W-005") < pos("W-004"),
      JSON.stringify({ "W-002": pos("W-002"), "W-001": pos("W-001"), "W-005": pos("W-005"), "W-004": pos("W-004") }),
    );

    const html2 = renderBacklogPage({ ...readOfficina(dir), outPath: join(dir, "out.html") });
    check(4, "identical input renders byte-identical output (in-process)", html === html2);

    const out1 = join(dir, "run1.html");
    const out2 = join(dir, "run2.html");
    const handoff = join(dir, "handoff.md");
    writeFile(handoff, "# handoff\nnothing rotten here.\n");
    runCli(["--studio", dir, "--out", out1, "--handoff", handoff]);
    runCli(["--studio", dir, "--out", out2, "--handoff", handoff]);
    check(
      4,
      "two CLI runs on identical input are byte-identical on disk",
      readFileSync(out1, "utf8") === readFileSync(out2, "utf8"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 5: decisions
// ---------------------------------------------------------------------------
{
  const dir = tmp("b5");
  try {
    scaffoldStudio(dir);
    decisionFixture(dir, { id: "D-001", title: "Has a kill_when", killWhen: "never" });
    decisionFixture(dir, { id: "D-002", title: "Missing kill_when" }); // no kill_when field at all

    let html;
    let threw = false;
    try {
      const officina = readOfficina(dir);
      html = renderBacklogPage({ ...officina, outPath: join(dir, "out.html") });
    } catch {
      threw = true;
    }
    check(5, "a decision missing kill_when renders instead of throwing", !threw);
    check(5, "decision with kill_when renders it", Boolean(html) && html.includes("never"));
    check(
      5,
      "both decisions render",
      Boolean(html) && html.includes('data-id="D-001"') && html.includes('data-id="D-002"'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 6: escaping
// ---------------------------------------------------------------------------
{
  const dir = tmp("b6");
  try {
    scaffoldStudio(dir);
    opusFixture(dir, { id: "W-060", title: "<script>alert(1)</script> & co", state: "backlog" });
    opusFixture(dir, {
      id: "W-061",
      state: "halted",
      extra: `halted_at: 2026-01-01T00:00:00Z\nhalted_by: D-999\nresume_when: "<img src=x> & friends"\n`,
    });
    decisionFixture(dir, { id: "D-001", title: "d", killWhen: "<b>bold</b> & stuff" });

    const officina = readOfficina(dir);
    const html = renderBacklogPage({ ...officina, outPath: join(dir, "out.html") });

    check(6, "title markup is escaped, not injected", !html.includes("<script>") && html.includes("&lt;script&gt;"));
    check(6, "title ampersand is escaped", html.includes("&amp; co"));
    check(6, "resume_when markup is escaped", !html.includes("<img src=x>") && html.includes("&lt;img src=x&gt;"));
    check(6, "kill_when markup is escaped", !html.includes("<b>bold</b>") && html.includes("&lt;b&gt;bold&lt;/b&gt;"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// GHAS js/incomplete-html-attribute-sanitization (esc() missed `"`, feeding
// data-id and the ranking href): a hostile id/title reaches both an
// attribute context (data-id, on the very same row) and a text context (the
// title cell). opusFixture's naive `"${id}"` interpolation can't carry a
// literal `"`, so this fixture is written directly with proper YAML escaping.
{
  const dir = tmp("b6esc");
  try {
    scaffoldStudio(dir);
    const hostile = `W-069"><script>alert(1)</script>`;
    writeFile(
      join(dir, "opera", "W-069.md"),
      `---\nid: "${yamlDq(hostile)}"\ntitle: "${yamlDq(hostile)}"\nkind: "task"\ncollegium: "engineering"\nstate: backlog\nprobationes: {}\n---\n`,
    );

    const officina = readOfficina(dir);
    const html = renderBacklogPage({ ...officina, outPath: join(dir, "out.html") });

    check(
      6,
      "a hostile id cannot break out of the data-id attribute",
      !html.includes(`data-id="${hostile}"`) && !html.includes('data-id="W-069">'),
    );
    check(
      6,
      "the attribute-context quote and markup are escaped",
      html.includes('data-id="W-069&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'),
    );
    check(
      6,
      "the same hostile value in text content (the title cell) is escaped, not injected",
      !html.includes("<script>alert(1)</script>") && html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 7: the guard fires
// ---------------------------------------------------------------------------
{
  const dir = tmp("b7");
  try {
    scaffoldStudio(dir);
    opusFixture(dir, { id: "W-070", state: "backlog" });

    const headingHandoff = join(dir, "heading-handoff.md");
    writeFile(headingHandoff, "# Session handoff\n\n### Backlog\n\n1. something\n");
    const outA = join(dir, "outA.html");
    writeFile(outA, "PRE-EXISTING-CONTENT");
    let failedA = false;
    try {
      runCli(["--studio", dir, "--out", outA, "--handoff", headingHandoff]);
    } catch {
      failedA = true;
    }
    check(7, "a slate heading makes the generator exit non-zero", failedA);
    check(
      7,
      "--out is not modified when the heading guard fires (a pre-existing file survives byte-for-byte)",
      readFileSync(outA, "utf8") === "PRE-EXISTING-CONTENT",
    );

    const newOperaHandoff = join(dir, "new-opera-handoff.md");
    writeFile(newOperaHandoff, "# Session handoff\n\n### New opera opened, none started\n\n- W-070\n");
    const outC = join(dir, "outC.html");
    let failedC = false;
    try {
      runCli(["--studio", dir, "--out", outC, "--handoff", newOperaHandoff]);
    } catch {
      failedC = true;
    }
    check(7, "the 'New opera' slate heading makes the generator exit non-zero", failedC);
    check(7, "--out is not created when the 'New opera' heading guard fires", !existsSync(outC));

    const chainHandoff = join(dir, "chain-handoff.md");
    writeFile(chainHandoff, "Ranked order: W-001 ->\nW-002 -> W-003 next up.\n");
    const outB = join(dir, "outB.html");
    let failedB = false;
    try {
      runCli(["--studio", dir, "--out", outB, "--handoff", chainHandoff]);
    } catch {
      failedB = true;
    }
    check(7, "a ranked chain wrapped across two lines makes the generator exit non-zero", failedB);
    check(7, "--out is not created when the chain guard fires", !existsSync(outB));

    // Every real chain in the handoff uses the Unicode arrow, not ASCII
    // "->" (studio/ci/W-041-review-1.log, B1 worst instance: M7).
    const arrowChainHandoff = join(dir, "arrow-chain-handoff.md");
    writeFile(arrowChainHandoff, "The architect ranking: W-041 →\nW-039 → W-038 next.\n");
    const outD = join(dir, "outD.html");
    let failedD = false;
    try {
      runCli(["--studio", dir, "--out", outD, "--handoff", arrowChainHandoff]);
    } catch {
      failedD = true;
    }
    check(7, "a ranked chain using the Unicode → arrow makes the generator exit non-zero", failedD);
    check(7, "--out is not created when the → chain guard fires", !existsSync(outD));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// behaviour 8: the real handoff passes the guard
// ---------------------------------------------------------------------------
{
  const realHandoffPath = join(REPO_ROOT, "docs/SESSION-HANDOFF.md");
  const text = readFileSync(realHandoffPath, "utf8");
  const violations = findGuardViolations(text);
  check(
    8,
    "docs/SESSION-HANDOFF.md carries no slate heading and no ranked chain",
    violations.length === 0,
    JSON.stringify(violations),
  );
}

// ---------------------------------------------------------------------------
// behaviour 9: write scope
// ---------------------------------------------------------------------------
{
  const dir = tmp("b9");
  try {
    scaffoldStudio(dir);
    opusFixture(dir, { id: "W-090", state: "backlog" });
    const handoff = join(dir, "handoff.md");
    writeFile(handoff, "# handoff\nnothing rotten here.\n");
    const outDir = tmp("b9-out");
    const out = join(outDir, "backlog-body.html");

    const before = snapshotDir(dir);
    const outDirBefore = snapshotDir(outDir);
    runCli(["--studio", dir, "--out", out, "--handoff", handoff]);
    const after = snapshotDir(dir);

    check(9, "nothing inside --studio is written", snapshotsEqual(before, after));
    check(9, "--out itself was written", existsSync(out));
    const outDirAfter = snapshotDir(outDir);
    const onlyOutChanged = outDirAfter.size === outDirBefore.size + 1 && outDirAfter.has("backlog-body.html");
    check(9, "nothing outside --out was written", onlyOutChanged, JSON.stringify([...outDirAfter.keys()]));
    rmSync(outDir, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
