#!/usr/bin/env node
/**
 * scripts/backlog-page.mjs — W-041: the slate rendered from the officina,
 * never from prose. Reads studio/opera/*.md, studio/petitiones/*.md and
 * studio/decisions/*.md (front matter only — never brief prose, never
 * `reason`/`resume_when` for meaning) and renders three tables into
 * docs/design/dossier/backlog-body.html: in-flight opera, backlog
 * (including halted), and standing constraints (decisions). It links the
 * latest ranking acta as the source of record for order; it never ranks
 * and never writes one. See studio/briefs/W-041.md.
 *
 * The single-source guard: before writing anything, this refuses (exit 1,
 * naming line numbers) if the handoff still carries a slate heading or a
 * hand-written ranked chain of three or more opus ids — the two shapes of
 * rot this opus replaces. `build.sh` runs this from docs/design/dossier/,
 * so defaults resolve against the repo root (this file's own `..`), never
 * the cwd; explicit flags resolve against the cwd.
 *
 * Usage: node scripts/backlog-page.mjs [--studio <dir>] [--out <path>] [--handoff <path>]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const IN_FLIGHT_STATES = new Set(["greenlit", "building", "verifying", "review"]);

export function parseArgs(argv) {
  const values = {
    studio: join(REPO_ROOT, "studio"),
    out: join(REPO_ROOT, "docs/design/dossier/backlog-body.html"),
    handoff: join(REPO_ROOT, "docs/SESSION-HANDOFF.md"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--studio") values.studio = resolve(argv[++i]);
    else if (a === "--out") values.out = resolve(argv[++i]);
    else if (a === "--handoff") values.handoff = resolve(argv[++i]);
    else throw new Error(`backlog-page: unknown flag "${a}"`);
  }
  return values;
}

// ---------------------------------------------------------------------------
// Front matter — same split as scripts/sweep-traditio-stage.mjs. Front
// matter only; brief prose and `reason`/`resume_when` are never parsed for
// meaning, only carried through as opaque strings.
// ---------------------------------------------------------------------------

function readFrontMatter(path) {
  const text = readFileSync(path, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return undefined;
  try {
    return parseYaml(m[1]);
  } catch {
    return undefined;
  }
}

function readAllFrontMatter(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFrontMatter(join(dir, f)))
    .filter((d) => d !== undefined && typeof d === "object");
}

/** Newest `*-ranking.md` acta by filename — dated filenames sort
 *  chronologically, so the lexicographically last one is the latest. */
function findLatestRankingActa(studioDir) {
  const dir = join(studioDir, "acta");
  if (!existsSync(dir)) return undefined;
  const candidates = readdirSync(dir)
    .filter((f) => /-ranking\.md$/.test(f))
    .sort();
  const file = candidates[candidates.length - 1];
  if (!file) return undefined;
  return { id: file.replace(/\.md$/, ""), path: join(dir, file) };
}

export function readOfficina(studioDir) {
  const manifest = parseYaml(readFileSync(join(studioDir, "bisellium.yml"), "utf8"));
  const declaredGates = Array.isArray(manifest?.probationes) ? manifest.probationes.length : 0;

  const opera = readAllFrontMatter(join(studioDir, "opera")).filter((o) => typeof o.id === "string");

  const petitiones = readAllFrontMatter(join(studioDir, "petitiones"));
  const openPetitionsByOpus = new Map();
  for (const p of petitiones) {
    if (p.state === "resolved") continue;
    if (p.opus === undefined || p.opus === null) continue;
    const opusId = String(p.opus);
    const list = openPetitionsByOpus.get(opusId) ?? [];
    list.push({ id: String(p.id), state: String(p.state) });
    openPetitionsByOpus.set(opusId, list);
  }

  const decisions = readAllFrontMatter(join(studioDir, "decisions")).filter((d) => typeof d.id === "string");

  const rankingActa = findLatestRankingActa(studioDir);

  return { opera, declaredGates, openPetitionsByOpus, decisions, rankingActa };
}

// ---------------------------------------------------------------------------
// Rendering — pure, no I/O beyond what the caller already read.
// ---------------------------------------------------------------------------

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const byIdDesc = (a, b) => String(b.id).localeCompare(String(a.id));
const byIdAsc = (a, b) => String(a.id).localeCompare(String(b.id));

function gatesCell(opus, declaredGates) {
  const probationes = opus.probationes && typeof opus.probationes === "object" ? opus.probationes : {};
  const entries = Object.values(probationes).filter((p) => p && typeof p === "object");
  const passed = entries.filter((p) => p.status === "passed").length;
  const waived = entries.filter((p) => p.status === "waived").length;
  return waived > 0 ? `${passed}/${declaredGates} · ${waived} waived` : `${passed}/${declaredGates}`;
}

function blockedOnCell(opus, openPetitionsByOpus) {
  if (opus.state === "halted") {
    const parts = [];
    if (opus.halted_by !== undefined && opus.halted_by !== null) parts.push(String(opus.halted_by));
    if (opus.resume_when !== undefined && opus.resume_when !== null) parts.push(String(opus.resume_when));
    return parts.length ? parts.join(" — ") : "—";
  }
  const parts = [];
  const blockedOn = opus?.traditio?.blocked_on;
  // `bisellium handoff` writes the literal sentinel "none" when --blocked-on
  // is omitted (packages/commands/src/writes.ts). That is the CLI's "no
  // blocker recorded" value, not a blocker named "none" — treat it the same
  // as absent so the cell reads an em dash (or just the open petitiones)
  // instead of the word "none".
  if (blockedOn !== undefined && blockedOn !== null && String(blockedOn).trim() !== "" && blockedOn !== "none")
    parts.push(String(blockedOn));
  for (const p of openPetitionsByOpus.get(opus.id) ?? []) parts.push(`${p.id} (${p.state})`);
  return parts.length ? parts.join("; ") : "—";
}

function opusRow(opus, declaredGates, openPetitionsByOpus) {
  return `        <tr data-id="${esc(opus.id)}"><td>${esc(opus.id)}</td><td>${esc(opus.title)}</td><td>${esc(opus.collegium)}</td><td>${esc(opus.state)}</td><td>${esc(blockedOnCell(opus, openPetitionsByOpus))}</td><td>${esc(gatesCell(opus, declaredGates))}</td></tr>`;
}

function decisionRow(d) {
  return `        <tr data-id="${esc(d.id)}"><td>${esc(d.id)}</td><td>${esc(d.title)}</td><td>${esc(d.kill_when ?? "—")}</td></tr>`;
}

export function renderBacklogPage({ opera, declaredGates, openPetitionsByOpus, decisions, rankingActa, outPath }) {
  const inFlight = opera.filter((o) => IN_FLIGHT_STATES.has(o.state)).sort(byIdDesc);
  const backlog = opera.filter((o) => o.state === "backlog").sort(byIdDesc);
  const halted = opera.filter((o) => o.state === "halted").sort(byIdDesc);
  const backlogGroup = [...backlog, ...halted];
  const decisionsSorted = [...decisions].sort(byIdAsc);

  const rankingLink =
    rankingActa && outPath
      ? `<p class="mock-caption">Ranking: <a href="${esc(relative(dirname(outPath), rankingActa.path))}">${esc(rankingActa.id)}</a> is the source of record for the slate's order; this page shows the inputs a ranking is made from and does not rank.</p>\n\n`
      : "";

  return `<div class="wrap">

<header class="masthead">
  <p class="eyebrow">Agent studio &middot; the slate</p>
  <h1>Bisellium Backlog</h1>
  <p class="thesis">Generated from the officina's own front matter &mdash; opera, petitiones, decisions &mdash; never from prose. A <code>done</code> opus never appears here; that is the <a href="bisellium-progress.html">progress page</a>'s history.</p>
</header>

${rankingLink}<section>
<h2>In flight</h2>
<p class="mock-caption">State as recorded in this checkout&rsquo;s officina. On the trunk, per D-021, an opus being built still reads <code>greenlit</code> &mdash; its live state is on <code>opus/&lt;id&gt;</code>.</p>
<div class="table-scroll">
    <table>
      <thead><tr><th>Id</th><th>Title</th><th>Collegium</th><th>State</th><th>Blocked on</th><th>Gates</th></tr></thead>
      <tbody>
${inFlight.map((o) => opusRow(o, declaredGates, openPetitionsByOpus)).join("\n")}
      </tbody>
    </table>
  </div>
</section>

<section>
<h2>Backlog</h2>
<div class="table-scroll">
    <table>
      <thead><tr><th>Id</th><th>Title</th><th>Collegium</th><th>State</th><th>Blocked on</th><th>Gates</th></tr></thead>
      <tbody>
${backlogGroup.map((o) => opusRow(o, declaredGates, openPetitionsByOpus)).join("\n")}
      </tbody>
    </table>
  </div>
</section>

<section>
<h2>Standing constraints</h2>
<div class="table-scroll">
    <table>
      <thead><tr><th>Id</th><th>Title</th><th>Kill when</th></tr></thead>
      <tbody>
${decisionsSorted.map((d) => decisionRow(d)).join("\n")}
      </tbody>
    </table>
  </div>
</section>

<p class="footnote">If a hand-written ordering of these items appears anywhere outside an acta twice more, <code>rank:</code> has earned its opus.</p>

</div>
`;
}

// ---------------------------------------------------------------------------
// The single-source guard.
// ---------------------------------------------------------------------------

const SLATE_HEADING_RE = /^#+\s*(Backlog|New opera\b.*)\s*$/i;
const RANKED_CHAIN_RE = /W-\d{3}\s*(?:→|->)\s*W-\d{3}\s*(?:→|->)\s*W-\d{3}/g;

/** Line number (1-based) of a character offset into `text`. */
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}

/** Every hit of either guard pattern in `text`, each naming its line
 *  number, in document order. Pure — no I/O, so it is directly testable
 *  against a fixture string. */
export function findGuardViolations(text) {
  const violations = [];

  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (SLATE_HEADING_RE.test(line)) violations.push({ kind: "slate-heading", line: i + 1, text: line.trim() });
  });

  let m;
  RANKED_CHAIN_RE.lastIndex = 0;
  while ((m = RANKED_CHAIN_RE.exec(text))) {
    violations.push({ kind: "ranked-chain", line: lineOf(text, m.index), text: m[0].replace(/\s+/g, " ") });
  }

  return violations;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const handoffText = readFileSync(args.handoff, "utf8");
  const violations = findGuardViolations(handoffText);
  if (violations.length > 0) {
    console.error(
      `backlog-page: ${args.handoff} still carries hand-written slate state; refusing to write ${args.out}:`,
    );
    for (const v of violations) console.error(`  line ${v.line}: ${v.kind}: ${v.text}`);
    process.exit(1);
  }

  const officina = readOfficina(args.studio);
  const html = renderBacklogPage({ ...officina, outPath: args.out });
  writeFileSync(args.out, html);
  console.log(`backlog-page: wrote ${args.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
