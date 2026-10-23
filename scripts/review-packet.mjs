/**
 * W-215: the packet a review round is given: the subject, the change since the reviewer's previous round, the facts
 * computed from code, and the later-round prompt. Run from a bisellium checkout:
 *   node --import tsx scripts/review-packet.mjs --phase spec|build|handoff --opus <id> --round <n> --sella <id> --studio <dir> --repo <dir> --packets <dir>
 * It writes <packets>/r<n>/, computing everything before creating it. Exit 0, or 2 with nothing written.
 */
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontMatter } from "@bisellium/adapter-native";
import { briefAdmissionProblems } from "../packages/commands/src/lifecycle.ts";
import { readBriefLimit, ruledCases } from "../packages/commands/src/brief-admission.ts";
import { isNativeOpusKind, readContainedRegularFile, readServedShots } from "../packages/commands/src/opus-model.ts";
import { readSequence } from "../packages/commands/src/verdict.ts";
import { openStudio, safeItemPath } from "../packages/commands/src/writes.ts";
import { handoffInputs, sessionHandoffFindings } from "../packages/cli/src/rules/process.ts";
import { resolveTestBase } from "../packages/cli/src/rules/tests.ts";

const CHECKOUT = dirname(dirname(fileURLToPath(import.meta.url)));
const MAIN = join(CHECKOUT, "packages/cli/src/main.ts");
const PHASES = ["spec", "build", "handoff"];
const FLAGS = ["--phase", "--opus", "--round", "--sella", "--studio", "--repo", "--packets"];
const MAX_BYTES = 4 * 1024 * 1024;
const SLOTS = ["ID", "ROUND", "PREVIOUS", "PACKET", "UI", "STUDIO"];
const HANDOFF_REL = "docs/SESSION-HANDOFF.md";
const UI_REVIEW_SHOTS = [
  [
    "inbox-1280.png",
    1280,
    "desktop",
    "navigation, selected work, detail hierarchy, reason input and the four record actions",
  ],
  ["board-1280.png", 1280, "desktop", "column hierarchy, card density, gate marks, status and horizontal composition"],
  ["seats-1280.png", 1280, "desktop", "seat grouping, model controls, labels, density and pending-change affordances"],
  [
    "officina-1280.png",
    1280,
    "desktop",
    "completion, posture, pending-action and integrity panels, provenance and scan order",
  ],
  [
    "inbox-390.png",
    390,
    "phone",
    "responsive navigation, queue legibility, selection and absence of clipped or unreachable controls",
  ],
  ["board-390.png", 390, "phone", "responsive columns, card identity, overflow cues and reachable status information"],
  ["seats-390.png", 390, "phone", "responsive grouping, control labels, touch spacing and horizontal overflow"],
  ["officina-390.png", 390, "phone", "panel order, dense values, wrapping, provenance and vertical scanning"],
];
const USAGE = `usage: node --import tsx scripts/review-packet.mjs ${FLAGS.map((f) => `${f} <${f.slice(2)}>`).join(" ")}`;

/** Thrown for every refusal; `main` prints it and exits 2 with nothing written. */
class Refused extends Error {}
const refuse = (why) => {
  throw new Refused(why);
};

/** Exactly the seven flags, once each; every value is judged before anything is read. */
export function parsePacketArgs(argv) {
  const got = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!FLAGS.includes(flag)) refuse(`unknown argument ${JSON.stringify(flag)}\n${USAGE}`);
    if (got.has(flag)) refuse(`${flag} given twice`);
    if (argv[i + 1] === undefined) refuse(`${flag} needs a value`);
    got.set(flag, argv[i + 1]);
  }
  for (const flag of FLAGS) if (!got.has(flag)) refuse(`${flag} is required\n${USAGE}`);
  const phase = got.get("--phase");
  if (!PHASES.includes(phase)) refuse(`--phase must be spec, build or handoff`);
  const opus = got.get("--opus");
  if (opus.startsWith("-") || typeof safeItemPath("/", opus) !== "string")
    refuse(`--opus ${JSON.stringify(opus)} is not an opus id`);
  const round = got.get("--round");
  if (!/^[1-9]\d{0,8}$/.test(round)) refuse("--round must be a positive integer");
  const sella = got.get("--sella");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sella)) refuse("--sella must be one token");
  const dirs = {};
  for (const flag of ["--studio", "--repo", "--packets"]) {
    const dir = resolve(got.get(flag));
    if (!isDirectory(dir)) refuse(`${flag} ${JSON.stringify(got.get(flag))} is not a directory`);
    dirs[flag] = dir;
  }
  // the packets are scratch: never the officina's own tree, by real path
  const inside = relative(realpathSync(dirs["--studio"]), realpathSync(dirs["--packets"]));
  if (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
    refuse(`--packets ${JSON.stringify(got.get("--packets"))} is --studio or under it`);
  return {
    phase,
    opus,
    round: Number(round),
    sella,
    studio: dirs["--studio"],
    repo: dirs["--repo"],
    packets: dirs["--packets"],
  };
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A fixed-argv git run: exit 0 (or 1 where `okCodes` says so), output at most 4 MiB, otherwise a refusal. */
function runGit(cwd, args, okCodes = [0]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_BYTES });
  if (r.error !== undefined || r.status === null || !okCodes.includes(r.status))
    refuse(`git ${args.join(" ")}: ${r.error?.message ?? r.stderr.trim() ?? `exit ${r.status}`}`);
  return r.stdout;
}

/** The fixed ordered image attachments and the text that identifies what the reviewer judges in each one. */
function uiFact(studio, opus) {
  const record = readContainedRegularFile(studio, `opera/${opus}.md`, "opera");
  if ("error" in record) refuse(`opera/${opus}.md: ${record.error}`);
  let data;
  try {
    data = parseFrontMatter(record.bytes.toString("utf8"), `opera/${opus}.md`).data;
  } catch (e) {
    refuse(`opera/${opus}.md: ${e.message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    refuse(`opera/${opus}.md: front matter is not a mapping`);
  if (!isNativeOpusKind(data.kind))
    refuse(`opera/${opus}.md: kind ${JSON.stringify(data.kind)} is not a native opus kind`);
  if (data.kind !== "ui")
    return { text: `UI evidence: not applicable (kind ${JSON.stringify(data.kind)}).\n`, images: [] };
  const served = readServedShots(studio, opus);
  if ("problems" in served) refuse(served.problems.join("; "));
  const byName = new Map(served.shots.map((shot) => [shot.name, shot]));
  const expected = new Set(UI_REVIEW_SHOTS.map(([name]) => name));
  const absent = UI_REVIEW_SHOTS.map(([name]) => name).filter((name) => !byName.has(name));
  const extra = served.shots.map(({ name }) => name).filter((name) => !expected.has(name));
  if (absent.length > 0 || extra.length > 0)
    refuse(
      `UI review screenshots must be exactly ${UI_REVIEW_SHOTS.map(([name]) => name).join(", ")}; missing ${absent.join(", ") || "none"}; unexpected ${extra.join(", ") || "none"}`,
    );
  const images = [];
  const lines = ["Attached UI screenshots in codex -i order (eight files, each at most 4194304 bytes):"];
  for (const [name, width, viewport, judgment] of UI_REVIEW_SHOTS) {
    const shot = byName.get(name);
    if (shot.width !== width || shot.height !== 900)
      refuse(`UI review screenshot ${name} must be ${width}x900, got ${shot.width}x${shot.height}`);
    const path = join(studio, "ci", "shots", opus, name);
    images.push(path);
    lines.push(`${images.length}. ${name} — ${viewport} ${width}x900 — judge ${judgment}.`);
  }
  return { text: `${lines.join("\n")}\n`, images };
}

/** One command's output and exit, as a block of facts.txt. A spawn error, a signal or oversize output is a refusal, never a fact. */
function factOf(name, argv) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd: CHECKOUT, encoding: "utf8", maxBuffer: MAX_BYTES });
  if (r.error !== undefined || r.status === null)
    refuse(`${name}: could not run (${r.error?.message ?? `signal ${r.signal}`})`);
  return [`== ${name}`, argv.join(" "), `${r.stdout}${r.stderr}`.trimEnd(), `exit ${r.status}`, ""].join("\n");
}

/** `template` with the six slots filled in one pass (a value is never re-scanned); a missing slot is a refusal. */
export function fillTemplate(template, values) {
  for (const slot of SLOTS)
    if (!template.includes(`<${slot}>`)) refuse(`prompts/later-round.md lacks the slot <${slot}>`);
  return template.replace(/<(ID|ROUND|PREVIOUS|PACKET|UI|STUDIO)>/g, (_, slot) => values[slot]);
}

/** The previous packet's `subject`: a regular file, never a fallback to the full subject. */
function previousSubject(packets, round) {
  const path = join(packets, `r${round}`, "subject");
  try {
    if (!lstatSync(path).isFile()) refuse(`${path} is not a regular file`);
  } catch (e) {
    if (e instanceof Refused) throw e;
    refuse(`the previous packet has no subject: ${path}`);
  }
  return path;
}

/** A unified diff of two texts, labelled `a/subject` and `b/subject`, through git (exit 1 means they differ). */
function diffTexts(before, after) {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-packet-"));
  try {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    writeFileSync(join(dir, "a", "subject"), before);
    writeFileSync(join(dir, "b", "subject"), after);
    return runGit(dir, ["diff", "--no-index", "--", "a/subject", "b/subject"], [0, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The block for one opus's brief admission: the problems `ready`, `check` and `next` share, or why there are none to state. */
function admissionFact(studio, manifest, id, requireBrief) {
  const lines = [`== brief admission ${id}`, `briefAdmissionProblems(${id})`];
  const brief = readContainedRegularFile(studio, `briefs/${id}.md`, "briefs");
  if ("error" in brief) {
    if (requireBrief) refuse(`briefs/${id}.md cannot be read`);
    lines.push(`briefs/${id}.md cannot be read: no admission to state`);
  } else {
    const limit = readBriefLimit(manifest.brief_behaviour_limit);
    if ("error" in limit) refuse(limit.error);
    const problems =
      limit.limit === undefined
        ? []
        : briefAdmissionProblems(studio, manifest, id, brief.bytes.toString("utf8"), limit.limit);
    lines.push(problems.length === 0 ? "(none)" : problems.join("\n"));
  }
  return [...lines, ""].join("\n");
}

/**
 * W-322: the block naming the brief's ruled cases (`ruledCases`) that no pin of theirs finds in the source diff: the
 * change from the merge-base with master (`resolveTestBase`) to HEAD, outside the officina. A pin is found when one
 * file's added lines hold its row name and, on the same or another added line, its assertion text. No base is stated,
 * not refused.
 */
function pinFact(studio, repo, studioRel, id) {
  const lines = [
    "== ruled cases with no pinning assertion in the diff",
    `ruledCases(briefs/${id}.md) against git diff <merge-base with master> HEAD, outside ${studioRel || "nothing"}`,
  ];
  const brief = readContainedRegularFile(studio, `briefs/${id}.md`, "briefs");
  if ("error" in brief) refuse(`briefs/${id}.md cannot be read`);
  const base = resolveTestBase(repo);
  if ("error" in base) {
    const why = base.error.replace(/; row counts not compared$/, "");
    return [...lines, `no base: ${why}`, ""].join("\n");
  }
  const scope = studioRel === "" ? ["."] : [".", `:(exclude)${studioRel}`];
  const diff = runGit(repo, ["diff", "--no-color", "--no-ext-diff", "--unified=0", base.base, "HEAD", "--", ...scope]);
  const added = [];
  let hunk = false;
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      hunk = false;
      added.push([]);
    } else if (l.startsWith("@@")) hunk = true;
    else if (hunk && l.startsWith("+")) added.at(-1).push(l.slice(1));
  }
  const found = (pin) =>
    added.some((file) => file.some((l) => l.includes(pin.row)) && file.some((l) => l.includes(pin.assertion)));
  // a row's own case comes first; every later case with that row is a line its forms clause cites, even its own
  const rowsSeen = new Set();
  const open = ruledCases(brief.bytes.toString("utf8"))
    .cases.map((c) => {
      const grammar = rowsSeen.has(c.row);
      rowsSeen.add(c.row);
      return { c, grammar };
    })
    .filter(({ c }) => !c.pins.some(found))
    .map(({ c, grammar }) => {
      const what = grammar ? `grammar line of brief:${c.row}` : "Input domain row";
      const pins = c.pins.map((p) => `pinned by \`${p.row}\` "${p.assertion}"`).join(", ");
      const why = pins !== "" ? `${pins}: not in the diff` : c.unpinned && !grammar ? "unpinned" : "no pin";
      return `brief:${c.line} (${what}): ${why}`;
    });
  return [...lines, open.length === 0 ? "(none)" : open.join("\n"), ""].join("\n");
}

// W-353: `next` runs only in the repository's main checkout, so its fact is derived there, whichever checkout the packet reads
const nextFact = (id, studio) =>
  factOf(`next ${id}`, [
    process.execPath,
    "--import",
    "tsx",
    MAIN,
    "next",
    id,
    "--budget",
    "400000",
    "--studio",
    mainStudio(studio),
    "--repo",
    mainTree(studio),
  ]);

/**
 * `studio`'s place in the repository's main work tree, the first entry `git worktree list` gives (W-315): the same
 * path for a studio in the main checkout, and the main checkout's copy for one in a linked worktree.
 */
function mainStudio(studio) {
  const top = runGit(studio, ["rev-parse", "--show-toplevel"]).trim();
  return join(mainTree(studio), relative(realpathSync(top), realpathSync(studio)));
}

/** The repository's main work tree: the first entry `git worktree list` gives, from `dir`. */
function mainTree(dir) {
  const main = /^worktree (.+)$/m.exec(runGit(dir, ["worktree", "list", "--porcelain"]))?.[1];
  if (main === undefined) refuse("git worktree list names no main work tree");
  return main;
}

/**
 * Everything a round is given, computed before `<packets>/r<n>` exists. `promptStudio` is the studio whose
 * `prompts/later-round.md` is read and whose path fills `<STUDIO>`: `next`'s review perform passes the main checkout's
 * (W-314); absent, it is `studio`'s place in the main work tree, so a hand-run packet for a branch never reads the
 * branch's template (W-315).
 */
export function buildPacket(args) {
  const { phase, opus, round, sella, studio, repo, packets } = args;
  const packet = join(packets, `r${round}`);
  try {
    lstatSync(packet);
    refuse(`${packet} already exists`);
  } catch (e) {
    if (e instanceof Refused) throw e;
  }
  runGit(repo, ["rev-parse", "--git-dir"]);
  const opened = openStudio(studio);
  if ("error" in opened) refuse(opened.error);
  const { manifest } = opened;
  const studioUp = relative(realpathSync(repo), realpathSync(studio));
  if (studioUp === ".." || studioUp.startsWith(`..${sep}`) || isAbsolute(studioUp))
    refuse("--studio is outside --repo");
  const studioRel = studioUp.split("\\").join("/");

  const sequence = readSequence(studio, opus, phase, sella);
  if ("error" in sequence) refuse(sequence.error);
  const previous = sequence.last?.session === undefined ? undefined : sequence.last;

  const files = new Map();
  let images = [];
  let subject;
  if (phase === "spec") {
    const brief = readContainedRegularFile(studio, `briefs/${opus}.md`, "briefs");
    if ("error" in brief) refuse(`briefs/${opus}.md: ${brief.error}`);
    subject = brief.bytes.toString("utf8");
  } else if (phase === "handoff") {
    const handoff = readContainedRegularFile(repo, HANDOFF_REL, "docs");
    if ("error" in handoff) refuse(`${HANDOFF_REL}: ${handoff.error}`);
    subject = handoff.bytes.toString("utf8");
  }
  if (subject !== undefined) files.set("subject", subject);
  if (phase === "build") {
    const ui = uiFact(studio, opus);
    files.set("ui.txt", ui.text);
    images = ui.images;
  }

  let delta;
  if (phase === "build") {
    if (previous !== undefined) {
      if (studioRel === "") refuse("--studio is the repository root: the officina cannot be excluded from the delta");
      const base = runGit(repo, [
        "log",
        "-1",
        "--diff-filter=A",
        "--format=%H",
        "--",
        `${studioRel}/${previous.log}`,
      ]).trim();
      if (base === "") refuse(`${previous.log} is not committed: no base for the delta`);
      // the source change, then the officina's (gate logs, brief, record, reds, prompts): every change since that round (W-314)
      delta =
        runGit(repo, ["diff", base, "HEAD", "--", ".", `:(exclude)${studioRel}`]) +
        runGit(repo, ["diff", base, "HEAD", "--", studioRel]);
    }
  } else if (previous !== undefined) {
    delta = diffTexts(readFileSync(previousSubject(packets, previous.round), "utf8"), subject);
  } else if (phase === "handoff") {
    delta = diffTexts(runGit(repo, ["show", `HEAD:${HANDOFF_REL}`]), subject);
  }
  if (delta !== undefined) files.set("delta.diff", delta);

  const facts = [];
  if (phase === "handoff") {
    const inputs = handoffInputs(repo, studio);
    if (inputs.kind !== "ok") refuse(inputs.kind === "absent" ? `${HANDOFF_REL} is absent` : inputs.reason);
    const findings = sessionHandoffFindings(inputs.text, inputs.opera);
    facts.push(
      [
        "== sessionHandoffFindings",
        "sessionHandoffFindings(handoffInputs)",
        findings.length === 0 ? "(none)" : findings.map((f) => `${f.rule} ${f.where}: ${f.message}`).join("\n"),
        "",
      ].join("\n"),
    );
    const added = (delta ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const ids = [...new Set(added.flatMap((l) => l.match(/\bW-\d+\b/g) ?? []))];
    for (const id of ids) facts.push(nextFact(id, studio), admissionFact(studio, manifest, id, false));
  } else {
    facts.push(nextFact(opus, studio), admissionFact(studio, manifest, opus, true));
    if (phase === "build") facts.push(pinFact(studio, repo, studioRel, opus));
  }
  files.set("facts.txt", facts.join("\n"));

  if (previous !== undefined) {
    const promptStudio = args.promptStudio ?? mainStudio(studio);
    const template = readContainedRegularFile(promptStudio, "prompts/later-round.md", "prompts");
    if ("error" in template) refuse(`prompts/later-round.md: ${template.error}`);
    files.set(
      "prompt.md",
      fillTemplate(template.bytes.toString("utf8"), {
        ID: opus,
        ROUND: String(round),
        PREVIOUS: previous.log,
        PACKET: packet,
        UI:
          phase === "build" && images.length > 0
            ? `Read \`${packet}/ui.txt\`; it names the eight current desktop and phone screenshots attached to this turn, in attachment order, and states what to judge in each. Inspect every image. Include a nonblank \`## UI input disposition\` section after Findings, stating how the authoritative ui-lead input and the attached images affected the verdict.`
            : "",
        STUDIO: promptStudio,
      }),
    );
  }
  return { packet, files, images };
}

function main(argv) {
  try {
    const { packet, files } = buildPacket(parsePacketArgs(argv));
    mkdirSync(packet);
    try {
      for (const [name, text] of files) writeFileSync(join(packet, name), text, { flag: "wx" });
    } catch (e) {
      rmSync(packet, { recursive: true, force: true });
      refuse(`could not write ${packet}: ${e.message}`);
    }
    console.log(`${packet}: ${[...files.keys()].join(", ")}`);
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`review-packet: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
