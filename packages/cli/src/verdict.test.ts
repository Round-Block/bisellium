import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { sourceTreeHash } from "@bisellium/shim";
import { draftRetro, type RetroInput } from "./retro.js";
import { runVerdict } from "./verdict.js";

const only = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
let failed = 0;
const check = (behaviour: number, name: string, ok: boolean, detail = ""): void => {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(76)} ${detail}`);
  if (!ok) failed++;
};
const skip = (behaviour: number, name: string, detail = ""): void => {
  if (only !== undefined && only !== behaviour) return;
  console.log(`SKIP  ${name.padEnd(76)} ${detail}`);
};

const roots: string[] = [];
const NOW = new Date("2026-09-25T12:34:56.000Z");

function studio(tag: string, ids: string[] = ["W-200"]): string {
  const root = mkdtempSync(join(tmpdir(), `bisellium-verdict-${tag}-`));
  roots.push(root);
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      `studio: Verdict ${tag}`,
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: builder-sol, collegium: engineering, kind: agent }",
      "probationes:",
      "  - { id: spec, name: Spec, kind: agent }",
      "  - { id: review, name: Review, kind: agent }",
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(root, "opera"));
  for (const id of ids) {
    writeFileSync(
      join(root, "opera", `${id}.md`),
      [
        "---",
        `id: ${JSON.stringify(id)}`,
        `title: ${JSON.stringify(`Verdict ${id}`)}`,
        "kind: feature",
        "collegium: engineering",
        "state: building",
        "probationes:",
        "  spec: { status: passed, evidence: briefs/spec.md }",
        "  review: { status: pending }",
        "---",
        "Body remains byte-identical.",
        "",
      ].join("\n"),
    );
  }
  return root;
}

function captureErrors<T>(fn: () => T): { result: T; stderr: string } {
  let stderr = "";
  const old = console.error;
  console.error = (...args: unknown[]) => {
    stderr += args.map(String).join(" ") + "\n";
  };
  try {
    return { result: fn(), stderr };
  } finally {
    console.error = old;
  }
}

function files(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.set(`${relative(root, path)}/`, Buffer.from("directory"));
        walk(path);
      }
      else if (entry.isFile()) out.set(relative(root, path), readFileSync(path));
      else out.set(relative(root, path), Buffer.from(`special:${lstatSync(path).mode}`));
    }
  };
  walk(root);
  return out;
}

function sameFiles(a: Map<string, Buffer>, b: Map<string, Buffer>): boolean {
  if (a.size !== b.size) return false;
  for (const [path, bytes] of a) if (!b.get(path)?.equals(bytes)) return false;
  return true;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitStudio(tag: string, ids: string[]): { repo: string; studio: string } {
  const repo = mkdtempSync(join(tmpdir(), `bisellium-verdict-git-${tag}-`));
  roots.push(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "user.name", "Fixture");
  const inner = join(repo, "studio");
  mkdirSync(inner);
  writeFileSync(
    join(inner, "bisellium.yml"),
    [
      "bisellium: 1",
      `studio: Git Verdict ${tag}`,
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: builder-sol, collegium: engineering, kind: agent }",
      "probationes:",
      "  - { id: review, name: Review, kind: agent }",
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(inner, "opera"));
  for (const id of ids)
    writeFileSync(
      join(inner, "opera", `${id}.md`),
      `---\nid: ${id}\ntitle: ${id}\nkind: feature\ncollegium: engineering\nstate: building\nprobationes: {}\n---\n`,
    );
  writeFileSync(join(repo, "source.txt"), "clean\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "fixture");
  return { repo, studio: inner };
}

try {
  if (only === undefined || only === 1) {
    const dir = studio("write", ["W-201", "W-202"]);
    const outside = join(tmpdir(), `bisellium-verdict-source-${process.pid}.txt`);
    const body = Buffer.from("outside transcript\r\nsecond line\n\u0000tail");
    writeFileSync(outside, body);
    roots.push(outside);
    const from = runVerdict(
      ["W-201", "--phase", "spec", "--round", "3", "--sella", "qa-lead", "--model", "gpt-5.6-sol", "--outcome", "AMEND-FIRST (5 lands / 4 held)", "--from", outside, "--studio", dir],
      { now: NOW },
    );
    const path = join(dir, "ci", "W-201-spec-3.log");
    check(1, "b1: an external --from regular file succeeds", from.exitCode === 0 && existsSync(path), String(from.exitCode));
    const raw = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
    const marker = Buffer.from("\n\n");
    const split = raw.indexOf(marker);
    const header = split >= 0 ? raw.subarray(0, split).toString("utf8") : "";
    check(
      1,
      "b1: provenance header is complete and transcript bytes are exact",
      header.includes("# opus: W-201") &&
        header.includes("# phase: spec") &&
        header.includes("# round: 3") &&
        header.includes("# sella: qa-lead") &&
        header.includes("# model: gpt-5.6-sol") &&
        header.includes("# outcome: AMEND-FIRST (5 lands / 4 held)") &&
        header.includes(`# at: ${NOW.toISOString()}`) &&
        /^# tree: .+$/m.test(header) &&
        split >= 0 &&
        raw.subarray(split + marker.length).equals(body),
      raw.toString("utf8"),
    );
    const stdinBody = Buffer.from("stdin transcript\n");
    const stdin = runVerdict(["W-202", "--phase", "spec", "--round", "3", "--sella", "qa-lead", "--outcome", "DISPATCH", "--studio", dir], {
      now: NOW,
      stdin: stdinBody,
    });
    const stdinRaw = existsSync(join(dir, "ci", "W-202-spec-3.log")) ? readFileSync(join(dir, "ci", "W-202-spec-3.log")) : Buffer.alloc(0);
    check(1, "b1: stdin without --from writes the same shape", stdin.exitCode === 0 && stdinRaw.subarray(stdinRaw.indexOf(marker) + 2).equals(stdinBody));
  }

  if (only === undefined || only === 2) {
    const dir = studio("names", ["W-210", "W-211", "W-212"]);
    const input = join(dir, "input.log");
    writeFileSync(input, "verdict\n");
    const explicit = runVerdict(["W-210", "--phase", "build", "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", input, "--studio", dir], { now: NOW });
    const implicit = runVerdict(["W-211", "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", input, "--studio", dir], { now: NOW });
    const spec = runVerdict(["W-212", "--phase", "spec", "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", input, "--studio", dir], { now: NOW });
    check(
      2,
      "b2: build/default spell review literally and spec cannot collide",
      explicit.exitCode === 0 &&
        implicit.exitCode === 0 &&
        spec.exitCode === 0 &&
        existsSync(join(dir, "ci", "W-210-review-1.log")) &&
        existsSync(join(dir, "ci", "W-211-review-1.log")) &&
        existsSync(join(dir, "ci", "W-212-spec-1.log")) &&
        !existsSync(join(dir, "ci", "W-212-review-1.log")),
    );
  }

  if (only === undefined || only === 3) {
    const forgedOpus = "W-226\n# opus: FORGED";
    const plain = studio("header-lines", ["W-219", "W-222", "W-223", "W-224", "W-225", forgedOpus]);
    const plainSource = join(plain, "source.log");
    writeFileSync(plainSource, "body\n");
    const omitted = runVerdict(["W-219", "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", plainSource, "--studio", plain], { now: NOW });
    const omittedRaw = existsSync(join(plain, "ci", "W-219-review-1.log")) ? readFileSync(join(plain, "ci", "W-219-review-1.log"), "utf8") : "";
    check(3, "b3: omitted model leaves no model header", omitted.exitCode === 0 && !/^# model:/m.test(omittedRaw) && /^# tree: .+$/m.test(omittedRaw), omittedRaw);
    for (const [id, flag, value] of [
      ["W-222", "--outcome", "PASS\n# opus: FORGED"],
      ["W-223", "--sella", "qa\rlead"],
      ["W-224", "--model", "model\n# tree: forged"],
    ] as const) {
      const args = [id, "--round", "1", "--sella", "qa-lead", "--model", "model", "--outcome", "PASS", "--from", plainSource, "--studio", plain];
      args[args.indexOf(flag) + 1] = value;
      const result = runVerdict(args, { now: NOW });
      check(3, `b3: ${flag} rejects CR/LF`, result.exitCode === 2 && !existsSync(join(plain, "ci", `${id}-review-1.log`)), String(result.exitCode));
    }
    const forgedOpusResult = runVerdict(
      [forgedOpus, "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", plainSource, "--studio", plain],
      { now: NOW },
    );
    check(
      3,
      "b3: <opus> rejects CR/LF",
      forgedOpusResult.exitCode === 2 && !existsSync(join(plain, "ci", `${forgedOpus}-review-1.log`)),
      String(forgedOpusResult.exitCode),
    );
    const blankModel = runVerdict(
      ["W-225", "--round", "1", "--sella", "qa-lead", "--model", "   ", "--outcome", "PASS", "--from", plainSource, "--studio", plain],
      { now: NOW },
    );
    check(3, "b3: an explicitly blank model never creates an empty model header", blankModel.exitCode === 2 && !existsSync(join(plain, "ci", "W-225-review-1.log")));
    try {
      const { repo, studio: dir } = gitStudio("headers", ["W-220", "W-221"]);
      const outside = join(repo, "outside.log");
      writeFileSync(outside, "body\n");
      git(repo, "add", "outside.log");
      git(repo, "commit", "-qm", "input");
      const expectedClean = `tree:${sourceTreeHash(repo, ["studio", ".bisellium"], "HEAD")}`;
      const clean = runVerdict(["W-220", "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", outside, "--studio", dir], { now: NOW });
      const cleanRaw = existsSync(join(dir, "ci", "W-220-review-1.log")) ? readFileSync(join(dir, "ci", "W-220-review-1.log"), "utf8") : "";
      check(3, "b3: clean tree names the repository containing --studio", clean.exitCode === 0 && cleanRaw.includes(`# tree: ${expectedClean}`), cleanRaw);
      writeFileSync(join(repo, "source.txt"), "dirty\n");
      const expectedDirty = `dirty:${sourceTreeHash(repo, ["studio", ".bisellium"], "HEAD")}`;
      const dirty = runVerdict(["W-221", "--round", "1", "--sella", "qa-lead", "--model", "gpt-5.6-sol", "--outcome", "PASS", "--from", outside, "--studio", dir], { now: NOW });
      const dirtyRaw = existsSync(join(dir, "ci", "W-221-review-1.log")) ? readFileSync(join(dir, "ci", "W-221-review-1.log"), "utf8") : "";
      check(3, "b3: dirty tree keeps the same capture-time hash spelling", dirty.exitCode === 0 && dirtyRaw.includes(`# tree: ${expectedDirty}`), dirtyRaw);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      // Codex's restricted subprocess sandbox can refuse a nested `git`
      // spawn even though the repository command itself is valid. The
      // unsandboxed suite exercises both exact hashes; keep the local run
      // usable while making every other header assertion unconditional.
      if (err.code === "EPERM") skip(3, "b3: git-backed exact tree assertions (sandbox only)", err.message);
      else check(3, "b3: git-backed exact tree fixture succeeds", false, err.message);
    }
  }

  if (only === undefined || only === 4) {
    const dir = studio("evidence-only", ["W-230"]);
    mkdirSync(join(dir, ".bisellium"));
    mkdirSync(join(dir, "timeline"));
    writeFileSync(join(dir, ".bisellium", "events.jsonl"), '{"existing":true}\n');
    writeFileSync(join(dir, "timeline", "qa-lead.jsonl"), '{"existing":true}\n');
    const source = join(dir, "source.log");
    writeFileSync(source, "finding\n");
    const opusPath = join(dir, "opera", "W-230.md");
    const opusBefore = readFileSync(opusPath);
    const eventsBefore = readFileSync(join(dir, ".bisellium", "events.jsonl"));
    const timelineBefore = files(join(dir, "timeline"));
    const result = runVerdict(["W-230", "--phase", "spec", "--round", "1", "--sella", "qa-lead", "--outcome", "AMEND", "--from", source, "--studio", dir], { now: NOW });
    check(
      4,
      "b4: success writes evidence but leaves opus, gates, state, events and timeline byte-identical",
      result.exitCode === 0 &&
        existsSync(join(dir, "ci", "W-230-spec-1.log")) &&
        readFileSync(opusPath).equals(opusBefore) &&
        readFileSync(join(dir, ".bisellium", "events.jsonl")).equals(eventsBefore) &&
        sameFiles(files(join(dir, "timeline")), timelineBefore),
    );
  }

  if (only === undefined || only === 5) {
    const dir = studio("refusals", ["W-240", "W-241", "W-242", "W-243", "W-244", "W-245", "W-246", "W-247", "W-248", "W-249", "W-250", "W-251", "W-252"]);
    const source = join(dir, "source.log");
    writeFileSync(source, "body\n");
    const fifo = join(dir, "source.fifo");
    let fifoAvailable = true;
    let fifoSkipDetail = "";
    try {
      execFileSync("mkfifo", [fifo]);
    } catch (e) {
      // The managed sandbox can return EPERM after creating the FIFO.
      fifoAvailable = existsSync(fifo);
      if (!fifoAvailable) fifoSkipDetail = (e as Error).message;
    }
    if (!fifoAvailable) skip(5, "b5: FIFO refusal row unavailable in sandbox", fifoSkipDetail);
    mkdirSync(join(dir, "ci"));
    writeFileSync(join(dir, "ci", "W-251-review-2.log"), "old evidence\n");
    const base = (id: string): string[] => [id, "--round", "2", "--sella", "qa-lead", "--outcome", "PASS", "--from", source, "--studio", dir];
    const rows: { label: string; args: string[]; stdin?: Buffer }[] = [
      { label: "unknown opus", args: base("W-999") },
      { label: "round absent", args: base("W-240").filter((_, i, a) => i !== a.indexOf("--round") && i !== a.indexOf("--round") + 1) },
      ...["0", "-1", "abc", "r1"].map((round, i) => ({ label: `round ${round}`, args: base(`W-${241 + i}`).map((v, n, a) => (n === a.indexOf("--round") + 1 ? round : v)) })),
      { label: "bad phase", args: [...base("W-245"), "--phase", "build-ish"] },
      { label: "outcome absent", args: base("W-246").filter((_, i, a) => i !== a.indexOf("--outcome") && i !== a.indexOf("--outcome") + 1) },
      { label: "outcome blank", args: base("W-247").map((v, i, a) => (i === a.indexOf("--outcome") + 1 ? "   " : v)) },
      { label: "missing from", args: base("W-248").map((v, i, a) => (i === a.indexOf("--from") + 1 ? join(dir, "absent.log") : v)) },
      ...(fifoAvailable ? [{ label: "FIFO", args: base("W-249").map((v, i, a) => (i === a.indexOf("--from") + 1 ? fifo : v)) }] : []),
      { label: "empty stdin", args: base("W-250").filter((_, i, a) => i !== a.indexOf("--from") && i !== a.indexOf("--from") + 1), stdin: Buffer.alloc(0) },
      { label: "blank sella", args: base("W-252").map((v, i, a) => (i === a.indexOf("--sella") + 1 ? "   " : v)) },
      { label: "existing target", args: base("W-251") },
    ];
    for (const row of rows) {
      const before = files(dir);
      const result = runVerdict(row.args, { now: NOW, ...(row.stdin ? { stdin: row.stdin } : {}) });
      check(5, `b5: ${row.label} exits 2 and writes nothing`, result.exitCode === 2 && sameFiles(before, files(dir)), String(result.exitCode));
    }

    // row 11 (W-082): verdict <opus> ../W-777. Both a file outside opera/
    // and an in-directory collision exist, so the safeItemPath refusal—not
    // mere absence—must win without changing either sentinel or writing
    // verdict evidence.
    {
      const sentinel = readFileSync(join(dir, "opera", "W-240.md"));
      const outsidePath = join(dir, "W-777.md");
      const insidePath = join(dir, "opera", "W-777.md");
      writeFileSync(outsidePath, sentinel);
      writeFileSync(insidePath, sentinel);
      const outsideBefore = readFileSync(outsidePath);
      const insideBefore = readFileSync(insidePath);

      const { result, stderr } = captureErrors(() => runVerdict(base("../W-777"), { now: NOW }));

      check(5, "row11 verdict: exits 2", result.exitCode === 2, String(result.exitCode));
      check(5, "row11 verdict: stderr names unknown opus ../W-777", stderr.includes("unknown opus: ../W-777"), stderr);
      check(5, "row11 verdict: outside sentinel byte-identical", readFileSync(outsidePath).equals(outsideBefore));
      check(5, "row11 verdict: in-directory collision record byte-identical", readFileSync(insidePath).equals(insideBefore));
      check(5, "row11 verdict: no evidence written", !existsSync(join(dir, "W-777-review-2.log")));
    }

    const outside = join(tmpdir(), `bisellium-verdict-positive-${process.pid}.log`);
    roots.push(outside);
    writeFileSync(outside, "external evidence\n");
    const positive = runVerdict(base("W-252").map((v, i, a) => (i === a.indexOf("--from") + 1 ? outside : v)), { now: NOW });
    check(5, "b5: outside-officina regular file is the positive control", positive.exitCode === 0 && existsSync(join(dir, "ci", "W-252-review-2.log")), String(positive.exitCode));
    const roundTwoBefore = readFileSync(join(dir, "ci", "W-251-review-2.log"));
    const nextRound = runVerdict(base("W-251").map((v, i, a) => (i === a.indexOf("--round") + 1 ? "3" : v)), { now: NOW });
    check(
      5,
      "b5: round 3 gets its own file and never erases round 2",
      nextRound.exitCode === 0 &&
        existsSync(join(dir, "ci", "W-251-review-3.log")) &&
        readFileSync(join(dir, "ci", "W-251-review-2.log")).equals(roundTwoBefore),
      String(nextRound.exitCode),
    );
    check(5, "b5: historical W-024-review-r1.log remains untouched and is not producible", !existsSync(join(dir, "ci", "W-024-review-r1.log")));

    try {
      const owned = gitStudio("ownership", ["W-260"]);
      const ownedSource = join(owned.repo, "evidence.log");
      writeFileSync(ownedSource, "finding\n");
      git(owned.repo, "add", "evidence.log");
      git(owned.repo, "commit", "-qm", "evidence");
      git(owned.repo, "checkout", "-qb", "opus/W-OTHER");
      const refusal = captureErrors(() =>
        runVerdict(["W-260", "--sella", "qa-lead", "--from", ownedSource, "--studio", owned.studio], { now: NOW }),
      );
      check(
        5,
        "b5: D-021 ownership fires before missing round/outcome validation",
        refusal.result.exitCode === 2 && refusal.stderr.includes("D-021") && !refusal.stderr.includes("--round") && !refusal.stderr.includes("--outcome"),
        refusal.stderr,
      );
    } catch (e) {
      check(5, "b5: git-backed D-021 fixture is available", false, (e as Error).message);
    }
  }

  if (only === undefined || only === 6) {
    const dir = studio("retro", ["W-270"]);
    const source = join(tmpdir(), `bisellium-verdict-retro-${process.pid}.log`);
    roots.push(source);
    writeFileSync(source, "spec review finding\n");
    const verdict = runVerdict(["W-270", "--phase", "spec", "--round", "1", "--sella", "qa-lead", "--outcome", "AMEND", "--from", source, "--studio", dir], { now: NOW });
    const input: RetroInput = {
      verifierIssues: 0,
      reviewFindings: [{ class: "spec-verdict-gap", where: "brief", evidence: ["ci/W-270-spec-1.log"] }],
      agents: [],
      tests: 1,
      fixRounds: 0,
      mutationsCaught: 0,
    };
    let first: ReturnType<typeof draftRetro> | undefined;
    let second: ReturnType<typeof draftRetro> | undefined;
    let error = "";
    try {
      first = draftRetro(dir, 1, input, NOW);
      second = draftRetro(dir, 2, input, new Date("2026-09-26T12:34:56.000Z"));
    } catch (e) {
      error = (e as Error).message;
    }
    check(
      6,
      "b6: verdict spec evidence is citable and recurrence sees the class",
      verdict.exitCode === 0 && first?.lessons.length === 1 && second?.lessons.length === 1 && second.markdown.includes('"spec-verdict-gap" recurs across cascades 1, 2'),
      error || second?.markdown || "no retro",
    );
  }
} finally {
  for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
