/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseFrontMatter } from "@bisellium/adapter-native";
import { parseVerdictLog } from "@bisellium/commands/verdict.js";
import { webBuild } from "@bisellium/commands/web-build.js";
import { sourceTreeHash } from "@bisellium/shim";
import { BRANCH, BRIEF_REL, BUDGET, Json, NOW_ISO, OPUS, Out, PROC_ENV, SR, SR_MODEL, T, WT_BRIEF, WT_STUDIO_REL, World, addReview, amend, architectOrder, branchExists, briefPath, briefText, calls, commit, deadPid, direct, editRecord, excludesHeld, expectHeld, expectStep, failingGit, fakeProc, ghCalls, git, gitCalls, handoffAt, landed, liveChild, markerPath, mergedList, mutating, next, put, putBrief, putMarker, putOutput, ran, recordOf, review, reviewHeld, reviewerOrder, scenario, scratch, sign, snap, sourceTree, specHeld, specLog, specNext, srWorld, stagedPaths, stepsDir, tickOf, ticketed, tipOf, touchHandoff, verb, w206World, walk, world, writeReds, writeTranscript, wtSpec } from "./next-world.test.js";


test("W-166-b4 behaviour 4: next orders one behaviour's test, red, log commit and implementation at a time", { timeout: 1_800_000 }, () => {
  const budget = ["--budget", "100000"];
  const none = world("w166-b4-none", "ready");
  handoffAt(none, "wt", T.handoffFresh);
  const first = next(none, [OPUS, ...budget]);
  expectStep(first, "reds", "named", "4a: a world with no reds names reds");
  const order = first.kv.get("command") ?? "";
  assert.match(order, /from behaviour 1 through 2/, ran("4a: the order starts from behaviour 1", first));
  assert.equal(first.kv.get("actor"), "builder", "4a: the actor is the builder");
  assert.equal(first.kv.get("phase"), "1", "4a: phase 1");
  assert.match(order, /from \.worktrees\/W-900: bisellium red W-900 --behaviour <b> /, ran("4a: the red runs from the worktree", first));
  assert.doesNotMatch(order, /--repo/, ran("4a: the red command carries no --repo", first));
  assert.doesNotMatch(order, /reds only, implementation absent/, ran("4a: the old all-reds order is gone", first));
  assert.match(order, /commit the red log alone \(studio files only\), before any implementation/, ran("4a: the log is committed alone before the implementation", first));
  assert.match(order, /detached worktree[^]*never rewrite history/, ran("4a: the correction path is named", first));

  const one = world("w166-b4-one", "ready");
  writeReds(one);
  rmSync(join(one.wtStudio, "ci", "reds", OPUS, "02.log"));
  commit(one.wt, "studio: drop red 2");
  handoffAt(one, "wt", T.handoffFresh);
  const second = next(one, [OPUS, ...budget]);
  expectStep(second, "reds", "named", "4b: 01.log usable and 02.log absent names reds");
  assert.match(second.kv.get("command") ?? "", /from behaviour 2 through 2/, ran("4b: the order starts from behaviour 2", second));
});

test("W-166-b4 behaviour 4: a scalar source_excludes holds next and dispatches nothing", { timeout: 1_800_000 }, () => {
  const w = world("w166-b4-scalar", "ready");
  const manifest = join(w.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", "source_excludes: examples/"));
  commit(w.repo, "studio: scalar source_excludes");
  const o = next(w, [OPUS, "--budget", "100000"]);
  assert.equal(o.status, 1, ran("4c: a scalar source_excludes exits 1", o));
  assert.match(o.out, /why: .*bisellium\.yml#source_excludes/, ran("4c: the why names bisellium.yml#source_excludes", o));
  assert.doesNotMatch(o.out, /^(role|command|phase):/m, ran("4c: no order is dispatched", o));
});

test("W-166-b4 behaviour 4: a malformed source_excludes holds next on every derivation outcome", { timeout: 1_800_000 }, () => {
  const spoil = (w: World, to: string): void => {
    const manifest = join(w.studio, "bisellium.yml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", `source_excludes: ${to}`));
    commit(w.repo, "studio: malformed source_excludes");
  };
  for (const to of ["examples/", "null", '[""]']) {
    // a complete opus must not exit 0
    const done = world(`w166-b4-complete-${to.length}`, "checkpoint");
    spoil(done, to);
    const c = next(done, [OPUS, "--budget", "100000"]);
    assert.equal(c.status, 1, ran(`4d: a complete opus under source_excludes ${to} exits 1`, c));
    assert.equal(c.first.endsWith(" held"), true, ran(`4d: ${to} holds a complete opus`, c));
    assert.match(c.out, /bisellium\.yml#source_excludes/, ran(`4d: ${to} names source_excludes on a complete opus`, c));

    // an already-held rung (no budget declared) names source_excludes, not its own why
    const held = world(`w166-b4-held-${to.length}`, "ready");
    handoffAt(held, "wt", T.handoffFresh);
    spoil(held, to);
    const h = next(held, [OPUS]);
    assert.equal(h.status, 1, ran(`4e: a held rung under source_excludes ${to} exits 1`, h));
    assert.match(h.kv.get("why") ?? h.out, /bisellium\.yml#source_excludes/, ran(`4e: ${to} names source_excludes on a held rung`, h));
    assert.doesNotMatch(h.out, /^(role|command):/m, ran(`4e: ${to} dispatches nothing`, h));
  }
});

test("W-166-b3 behaviour 3: with a usable worktree next surfaces the shared-tree block at reds", { timeout: 1_800_000 }, () => {
  const w = world("w166-b3-shared", "ready");
  appendFileSync(join(w.wt, "studio/briefs/W-900.md"), "\nRed order: one at a time\n");
  writeReds(w);
  handoffAt(w, "wt", T.handoffFresh);
  const o = next(w, [OPUS, "--budget", "100000"]);
  expectStep(o, "reds", "named", "3a: a shared-tree pair in an opted-in opus names reds");
  assert.match(o.kv.get("why") ?? "", /opus\.red_evidence: red logs for behaviours 1 and 2 certify one tree/, ran("3a: the why carries the shared-tree block", o));
});

test("W-166-b4 behaviour 4: a malformed source_excludes is a terminal hold: no track, health or perform replaces it", { timeout: 1_800_000 }, () => {
  const budget = ["--budget", "100000"];
  for (const [n, to] of [["scalar", "examples/"], ["null", "null"], ["empty", '[""]']] as const) {
    const w = world(`w166-b4-terminal-${n}`, "reds");
    const manifest = join(w.studio, "bisellium.yml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", `source_excludes: ${to}`));
    commit(w.repo, "studio: malformed source_excludes");
    // any step: nothing is derived, so no step is compared
    const step = "review";
    const child = liveChild();
    mkdirSync(stepsDir(w), { recursive: true });
    const held = (row: string, o: Out): void => {
      assert.equal(o.status, 1, ran(`${n} ${row}: exit 1`, o));
      assert.match(o.first, /^next: W-900 held$/, ran(`${n} ${row}: the held line`, o));
      assert.match(o.out, /bisellium\.yml#source_excludes/, ran(`${n} ${row}: names source_excludes`, o));
      assert.doesNotMatch(o.out, /^(role|command|health):/m, ran(`${n} ${row}: no order and no health line`, o));
    };

    // (a) --track installs no marker
    writeFileSync(join(stepsDir(w), "w124.log"), "tee\n");
    held("--track", next(w, [OPUS, "--track", step, "--pid", String(child), "--output", "steps/w124.log", ...budget]));
    assert.equal(existsSync(markerPath(w)), false, `${n}: --track wrote no marker`);

    // (b) a live tracked process
    putMarker(w, { step, pid: child, start_ticks: tickOf(child), writer: "track" });
    putOutput(w, "fresh\n", 30);
    held("running", next(w, [OPUS, ...budget]));

    // (c) dead, invalid, unknown and anomaly markers
    putMarker(w, { step, pid: deadPid(), start_ticks: 1234 });
    held("dead", next(w, [OPUS, ...budget]));
    writeFileSync(markerPath(w), "{ this is not json");
    held("invalid", next(w, [OPUS, ...budget]));
    putMarker(w, { step, pid: 4242, start_ticks: 777 });
    held("unknown", next(w, [OPUS, ...budget], { env: PROC_ENV(fakeProc(w, { "4242": "dir" })) }));
    putMarker(w, { step, pid: child, start_ticks: tickOf(child) });
    putOutput(w, "future\n", -3600);
    held("anomaly", next(w, [OPUS, ...budget]));

    // (d) --perform --expect performs nothing and takes no marker
    rmSync(markerPath(w), { force: true });
    held("--perform", next(w, [OPUS, "--perform", "--expect", step, ...budget]));
    assert.equal(existsSync(markerPath(w)), false, `${n}: --perform took no marker`);
    assert.deepEqual(calls(w).filter((c) => c[0] === "gh"), [], `${n}: no gh call was made`);
  }
});

test("W-166-b4 behaviour 4: a malformed source_excludes holds before any derivation, gh or git read", { timeout: 1_800_000 }, () => {
  const spoil = (w: World): void => {
    const manifest = join(w.studio, "bisellium.yml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes: []", "source_excludes: examples/"));
    commit(w.repo, "studio: scalar source_excludes");
  };
  const quiet = (w: World, row: string, o: Out): void => {
    excludesHeld(o, row);
    assert.deepEqual(ghCalls(w), [], `${row}: the gh stub recorded no call`);
    assert.deepEqual(
      gitCalls(w).filter((a) => a[0] !== "rev-parse"),
      [],
      `${row}: no git call beyond the repository checks`,
    );
  };
  const rows: [string, (w: World) => void, World][] = [
    ["5a an absent tip", () => undefined, world("w166-b4-notip", "spec")],
    ["5b an unusable worktree", (w) => rmSync(w.wt, { recursive: true, force: true }), world("w166-b4-nowt", "reds")],
    ["5c a pushed branch", () => undefined, world("w166-b4-pushed", "pr")],
  ];
  for (const [row, prep, w] of rows) {
    prep(w);
    spoil(w);
    rmSync(w.log, { force: true });
    quiet(w, row, next(w, [OPUS, "--budget", "100000"]));
  }
  // 5d: an unknown opus with a malformed value: the hold wins. The id, repository and studio checks come before
  // readSourceExcludes and keep exit 2; "unknown opus" was found only after it (by gather), so it no longer wins.
  const unknown = world("w166-b4-unknown", "spec");
  spoil(unknown);
  rmSync(unknown.log, { force: true });
  const o = next(unknown, ["W-999", "--budget", "100000"]);
  excludesHeld({ ...o, first: o.first.replace("W-999", OPUS) }, "5d an unknown opus");
  assert.equal(o.first, "next: W-999 held", ran("5d: the hold names the asked id", o));
  assert.deepEqual(ghCalls(unknown), [], "5d: no gh call");
});

// ---------------------------------------------------------------------------
// W-233: step tickets. `next` issues one per derivation in a studio whose
// bisellium.yml sets `step_tickets: required`; the ladder's direct writers
// require and consume it. Rows are selectable with --test-name-pattern=W-233-b<n>.
// ---------------------------------------------------------------------------
const ticketDir = (w: World): string => join(w.repo, ".git", "bisellium", "tickets");
const ticketPath = (w: World, name = `${OPUS}.json`): string => join(ticketDir(w), name);
const ticketText = (w: World, name?: string): string => (existsSync(ticketPath(w, name)) ? readFileSync(ticketPath(w, name), "utf8") : "");
const ticketOf = (w: World): Json => JSON.parse(ticketText(w)) as Json;
/** Behaviour n's red log, as writeReds writes one, for this behaviour only. */
function writeRed(w: World, n: number): void {
  put(
    w.wt,
    `studio/ci/reds/${OPUS}/${String(n).padStart(2, "0")}.log`,
    [`# behaviour: ${n}`, `# command: node fixture.test.ts --behaviour ${n}`, "# exit: 1", `# at: ${T.reds}`, "# sella: builder.W-900", `# tree: ${sourceTree(w.wt)}`, "", `TAP version 13\nnot ok 1 - W-900 behaviour ${n}: fixture\n  ---\n  code: 'ERR_ASSERTION'\n  ...\n`, ""].join("\n"),
  );
  commit(w.wt, `studio(${OPUS}): red ${n}`);
}
const lastLine = (o: Out): string => o.out.trimEnd().split("\n").at(-1) ?? "";

test("W-233-b1 behaviour 1: report-mode next issues one ticket per derivation, and none for a hold", { timeout: 1_800_000 }, () => {
  // at branch
  const a = world("w233-b1-branch", "spec");
  ticketed(a);
  const o1 = next(a, [OPUS]);
  assert.ok(existsSync(ticketPath(a)), ran("branch: next writes the ticket", o1));
  expectStep(o1, "branch", "named", "branch");
  const want = { opus: OPUS, step: "branch", action: "branch", round: 0, actor: "producer", studio: "studio", head: git(a.repo, ["rev-parse", "refs/heads/master"]), brief: git(a.repo, ["hash-object", BRIEF_REL]), at: NOW_ISO };
  assert.equal(ticketText(a), `${JSON.stringify(want)}\n`, "one JSON line, keys in order, at the --now instant");
  assert.equal(lastLine(o1), "ticket: branch round 0", ran("the output ends with the ticket line", o1));
  const later = "2026-10-02T12:30:00.000Z";
  const o2 = next(a, [OPUS, "--now", later]);
  assert.equal(ticketText(a), `${JSON.stringify({ ...want, at: later })}\n`, ran("a second call rewrites it with the new --now", o2));

  // at reds: the worktree's studio and HEAD; the next red once the first is committed, also while the handover is stale
  const r = world("w233-b1-reds", "ready");
  ticketed(r);
  const or = next(r, [OPUS, ...BUDGET]);
  assert.equal(lastLine(or), "ticket: red round 1", ran("reds: first missing behaviour", or));
  const base = { opus: OPUS, step: "reds", action: "red", actor: "builder", studio: WT_STUDIO_REL, brief: git(r.wt, ["hash-object", BRIEF_REL]), at: NOW_ISO };
  assert.equal(ticketText(r), `${JSON.stringify({ opus: OPUS, step: "reds", action: "red", round: 1, actor: "builder", studio: WT_STUDIO_REL, head: git(r.wt, ["rev-parse", "HEAD"]), brief: base.brief, at: NOW_ISO })}\n`, "red round 1 at the worktree's HEAD");
  writeRed(r, 1);
  const or2 = next(r, [OPUS, ...BUDGET]);
  expectStep(or2, "reds", "held", "a stale handover holds the order");
  assert.equal(lastLine(or2), "ticket: red round 2", ran("the hold withholds no ticket", or2));
  assert.equal(ticketOf(r)["head"], git(r.wt, ["rev-parse", "HEAD"]), "round 2 is bound to the new head");
  assert.equal(ticketOf(r)["round"], 2);

  // at review
  const b = world("w233-b1-review", "build");
  ticketed(b);
  const ob = next(b, [OPUS, ...BUDGET]);
  expectStep(ob, "review", "named", "review");
  assert.equal(lastLine(ob), "ticket: verdict-build round 1", ran("review", ob));
  assert.deepEqual({ ...ticketOf(b), head: undefined }, { opus: OPUS, step: "review", action: "verdict-build", round: 1, actor: "censor", studio: WT_STUDIO_REL, head: undefined, brief: git(b.wt, ["hash-object", BRIEF_REL]), at: NOW_ISO });

  // a Patron rung and a halted record issue none, and delete one written before
  for (const [tag, build] of [
    ["backlog", () => world("w233-b1-backlog", "backlog")],
    [
      "halted",
      () => {
        const h = world("w233-b1-halted", "spec");
        editRecord(h, "repo", (doc) => doc.setIn(["state"], "halted"));
        commit(h.repo, "test: halted");
        return h;
      },
    ],
  ] as [string, () => World][]) {
    const h = build();
    ticketed(h);
    mkdirSync(ticketDir(h), { recursive: true });
    writeFileSync(ticketPath(h), ticketText(a));
    const oh = next(h, [OPUS]);
    assert.equal(lastLine(oh), "ticket: none", ran(`${tag}: no ticket`, oh));
    assert.equal(existsSync(ticketPath(h)), false, `${tag}: the earlier ticket is deleted`);
  }

  // without the key: no directory, no line
  const plain = world("w233-b1-plain", "spec");
  const op = next(plain, [OPUS]);
  expectStep(op, "branch", "named", "no key");
  assert.equal(existsSync(join(plain.repo, ".git", "bisellium")), false, "no tickets directory");
  assert.equal(/^ticket:/m.test(op.out), false, ran("no ticket line", op));

  // a malformed value holds
  const m = world("w233-b1-malformed", "spec");
  ticketed(m, "yes");
  const om = next(m, [OPUS]);
  assert.equal(om.first, `next: ${OPUS} held`, ran("malformed", om));
  assert.equal(om.status, 1);
  assert.match(om.kv.get("why") ?? "", /^bisellium\.yml#step_tickets is malformed \(/, ran("why", om));
});

test("W-233-b1 actionFacts error: a stale pending ticket is deleted, or next holds naming it; never ticket: none with the file left", { timeout: 1_800_000 }, () => {
  const w = world("w233-b1-facts", "spec");
  ticketed(w);
  const issuedNow = next(w, [OPUS]);
  assert.equal(lastLine(issuedNow), "ticket: branch round 0", ran("a ticket for a main-checkout action", issuedNow));
  const stale = ticketText(w);
  // the brief becomes unreadable, so the facts every ticket binds cannot be read
  const brief = join(w.repo, BRIEF_REL);
  chmodSync(brief, 0o000);
  try {
    const o = next(w, [OPUS]);
    const gone = !existsSync(ticketPath(w));
    const none = lastLine(o) === "ticket: none";
    assert.ok(gone || !none, `the output ends "${lastLine(o)}" while the stale ticket file is left`);
    if (!gone) {
      assert.match(lastLine(o), /^ticket: held/, `the last line is "${lastLine(o)}"`);
      assert.ok(o.out.includes(ticketPath(w)), "the hold names the path");
      assert.equal(ticketText(w), stale, "the file is untouched");
    }
  } finally {
    chmodSync(brief, 0o644);
  }
  // once the facts are readable again nothing revives
  assert.equal(existsSync(ticketPath(w)) && ticketText(w) === stale, false, "the stale ticket is not left to revive");
});
const STEP_OF: Record<string, string> = { "verdict-spec": "spec", "verdict-build": "review", review: "review", red: "reds", ready: "ready", done: "done", branch: "branch", merge: "merge" };
/** A ticket written by hand from facts read independently of `next`; `where` is the checkout the action writes in. */
function forge(w: World, action: string, round: number, over: Json = {}, where: "repo" | "wt" = "wt"): Json {
  const dir = where === "repo" ? w.repo : w.wt;
  const t: Json = {
    opus: OPUS,
    step: STEP_OF[action],
    action,
    round,
    actor: "producer",
    studio: where === "repo" ? "studio" : WT_STUDIO_REL,
    head: git(dir, ["rev-parse", "HEAD"]),
    brief: git(dir, ["hash-object", BRIEF_REL]),
    at: NOW_ISO,
    ...over,
  };
  mkdirSync(ticketDir(w), { recursive: true });
  rmSync(ticketPath(w), { force: true });
  writeFileSync(ticketPath(w), `${JSON.stringify(t)}\n`);
  return t;
}
/** Every file under the tickets directory, by name and content. */
const ticketTree = (w: World): string => (existsSync(ticketDir(w)) ? walk(ticketDir(w)).join("\n") : "");
const mainOf = (w: World): string => dirname(git(w.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
/** The two-line refusal of a covered verb, exactly. */
function refused(o: Out, verb: string, reason: string, w: World, row: string): void {
  assert.equal(o.status, 2, ran(`${row}: exit`, o));
  assert.equal(o.err.trimEnd(), `${OPUS}: ${verb} refused: no matching next ticket (${reason})\nrun: bisellium next ${OPUS} --studio ${mainOf(w)}/studio --repo ${mainOf(w)}`, ran(`${row}: the two lines`, o));
}

test("W-233-b2 behaviour 2: every covered direct verb refuses a missing or mismatched ticket before writing", { timeout: 1_800_000 }, () => {
  const marker = join(scratch("w233-b2-marker"), "red-ran.txt");
  const spec = (): World => {
    const w = world("w233-b2-spec", "greenlight");
    put(w.repo, BRIEF_REL, briefText(w.behaviours));
    return w;
  };
  const withVerdict = (): World => {
    const w = world("w233-b2-review", "build");
    verb(w.wt, ["verdict", OPUS, "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--from", writeTranscript(w, "review-1.md"), "--studio", w.wtStudio, "--now", T.review1]);
    commit(w.wt, `studio(${OPUS}): review 1`);
    return w;
  };
  const rows: { verb: string; world: () => World; cwd: (w: World) => string; args: (w: World) => string[] }[] = [
    { verb: "ready", world: () => world("w233-b2-ready", "branch"), cwd: (w) => w.wt, args: (w) => ["ready", OPUS, "--sella", "architect", "--studio", w.wtStudio, "--now", T.ready] },
    { verb: "verdict", world: spec, cwd: (w) => w.repo, args: (w) => ["verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, "spec.md"), "--studio", w.studio, "--now", T.spec] },
    { verb: "verdict", world: () => world("w233-b2-build", "build"), cwd: (w) => w.wt, args: (w) => ["verdict", OPUS, "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--from", writeTranscript(w, "review-1.md"), "--studio", w.wtStudio, "--now", T.review1] },
    { verb: "review", world: withVerdict, cwd: (w) => w.wt, args: (w) => ["review", OPUS, "--pass", "--evidence", `ci/${OPUS}-review-1.log`, "--round", "1", "--sella", "qa-lead", "--studio", w.wtStudio, "--now", T.review1] },
    { verb: "red", world: () => world("w233-b2-red", "ready"), cwd: (w) => w.wt, args: (w) => ["red", OPUS, "--behaviour", "1", "--sella", "builder.W-900", "--studio", w.wtStudio, "--repo", w.wt, "--now", T.reds, "--", process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(marker)},"x");process.exit(1)`] },
    { verb: "done", world: () => world("w233-b2-done", "cleanup"), cwd: (w) => w.repo, args: (w) => ["done", OPUS, "--sella", "producer", "--studio", w.studio, "--now", T.done] },
    { verb: "branch", world: () => world("w233-b2-branch", "spec"), cwd: (w) => w.repo, args: (w) => ["branch", OPUS, "--studio", w.studio, "--repo", w.repo] },
    { verb: "merge", world: () => world("w233-b2-merge", "spec"), cwd: (w) => w.repo, args: (w) => ["merge", OPUS, "--studio", w.studio, "--repo", w.repo] },
  ];
  for (const row of rows) {
    const w = row.world();
    ticketed(w);
    const before = [snap(w), ticketTree(w)];
    const o = direct(w, row.cwd(w), row.args(w));
    refused(o, row.verb, "absent", w, `${row.verb}: no ticket`);
    assert.deepEqual([snap(w), ticketTree(w)], before, `${row.verb}: the record, ci/, the event log, the refs and the tickets are byte-identical`);
    assert.equal(existsSync(marker), false, "red's command has not run");
  }

  // hand-written tickets against `ready`
  const w = world("w233-b2-mismatch", "branch");
  ticketed(w);
  const ready = (): Out => direct(w, w.wt, ["ready", OPUS, "--sella", "architect", "--studio", w.wtStudio, "--now", T.ready]);
  const untouched = (o: Out, reason: string, row: string): void => {
    const before = [snap(w), ticketTree(w)];
    refused(o, "ready", reason, w, row);
    assert.deepEqual([snap(w), ticketTree(w)], before, `${row}: nothing moved`);
  };
  const good = forge(w, "ready", 0);
  rmSync(ticketPath(w));
  writeFileSync(ticketPath(w), "not json\n");
  untouched(ready(), "unreadable", "a non-JSON line");
  rmSync(ticketPath(w));
  writeFileSync(join(w.root, "elsewhere.json"), `${JSON.stringify(good)}\n`);
  symlinkSync(join(w.root, "elsewhere.json"), ticketPath(w));
  untouched(ready(), "unreadable", "a symlink");
  const head = git(w.wt, ["rev-parse", "HEAD"]);
  const blob = git(w.wt, ["hash-object", BRIEF_REL]);
  const mismatches: [string, Json, string][] = [
    ["action", { action: "red", step: "reds" }, "action is red, want ready"],
    ["round", { round: 1 }, "round is 1, want 0"],
    ["studio", { studio: "studio" }, `studio is studio, want ${WT_STUDIO_REL}`],
    ["head", { head: "0".repeat(40) }, `head is ${"0".repeat(40)}, want ${head}`],
    ["brief", { brief: "1".repeat(40) }, `brief is ${"1".repeat(40)}, want ${blob}`],
  ];
  for (const [name, over, reason] of mismatches) {
    forge(w, "ready", 0, over);
    untouched(ready(), reason, `a ticket for another ${name}`);
  }

  // without the key the same calls behave as on master
  const plain = world("w233-b2-plain", "branch");
  const ok = direct(plain, plain.wt, ["ready", OPUS, "--sella", "architect", "--studio", plain.wtStudio, "--now", T.ready]);
  assert.equal(ok.status, 0, ran("ready without the key", ok));
  assert.match(recordOf(plain, "wt"), /state: "?building/);
  assert.equal(existsSync(join(plain.repo, ".git", "bisellium")), false, "no tickets directory");
  const made = world("w233-b2-plain-branch", "spec");
  const ob = direct(made, made.repo, ["branch", OPUS, "--studio", made.studio, "--repo", made.repo]);
  assert.equal(ob.status, 0, ran("branch without the key", ob));
  assert.equal(branchExists(made), true);
});

test("W-233-b2 cross-checkout: a ticket issued for checkout A is refused for branch and merge given --repo B", { timeout: 1_800_000 }, () => {
  for (const verb of ["branch", "merge"]) {
    const a = world(`w233-b2-xa-${verb}`, "spec");
    const b = world(`w233-b2-xb-${verb}`, "spec");
    ticketed(a);
    ticketed(b);
    forge(a, verb, 0, {}, "repo");
    const before = [snap(a), snap(b), ticketTree(a), ticketTree(b)];
    const o = direct(a, a.repo, [verb, OPUS, "--studio", a.studio, "--repo", b.repo]);
    refused(o, verb, `facts unreadable: --repo ${b.repo} is not the checkout of ${a.studio}`, a, `${verb}: A's ticket, B's repository`);
    assert.deepEqual([snap(a), snap(b), ticketTree(a), ticketTree(b)], before, `${verb}: both checkouts, their refs and both ticket directories are byte-identical`);
    assert.equal(branchExists(b), false, `${verb}: B has no opus branch`);
  }
});

const claimedPath = (w: World): string => ticketPath(w, `${OPUS}.claimed`);
/** The record's `tickets:` list, read through the same front-matter parser the verbs use. */
const recordTickets = (w: World, dir: "repo" | "wt"): unknown => parseFrontMatter<{ tickets?: unknown }>(recordOf(w, dir), "record").data.tickets;
/** The header block of a written log: the lines before its first blank line. */
const headerOf = (path: string): string[] => readFileSync(path, "utf8").split("\n\n")[0]!.split("\n");
/** next issues the ticket at the world's current state; its line is what a covered write must copy. */
function issued(w: World, args: string[] = []): string {
  const o = next(w, [OPUS, ...args]);
  assert.ok(existsSync(ticketPath(w)), ran("next issued a ticket", o));
  return ticketText(w).trimEnd();
}
const consumed = (w: World, row: string): void => {
  assert.equal(existsSync(ticketPath(w)), false, `${row}: the pending ticket is gone`);
  assert.equal(existsSync(claimedPath(w)), false, `${row}: the claimed file is gone`);
};

test("W-233-b3 behaviour 3: a write claims its ticket before writing and copies it; each ticket admits one write", { timeout: 1_800_000 }, () => {
  // a spec signature
  const sp = world("w233-b3-spec", "greenlight");
  put(sp.repo, BRIEF_REL, briefText(sp.behaviours));
  ticketed(sp);
  const specLine = issued(sp);
  const os = direct(sp, sp.repo, ["verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(sp, "spec.md"), "--studio", sp.studio, "--now", T.spec]);
  assert.equal(os.status, 0, ran("the spec verdict", os));
  const specLog = join(sp.studio, "ci", `${OPUS}-spec-1.log`);
  assert.equal(headerOf(specLog).at(-1), `# ticket: ${specLine}`, "the signature's header block ends with the ticket");
  assert.equal("error" in parseVerdictLog(readFileSync(specLog, "utf8"), OPUS, "ci/spec-1.log"), false, "parseVerdictLog accepts it");
  consumed(sp, "spec");

  // a red: a command that exits 0 records nothing and leaves the ticket; a failing one records the line after # tree:
  const rd = world("w233-b3-red", "ready");
  ticketed(rd);
  const redLine = issued(rd);
  const marker = join(rd.root, "red-ran.txt");
  const redArgs = (code: number): string[] => ["red", OPUS, "--behaviour", "1", "--sella", "builder.W-900", "--studio", rd.wtStudio, "--repo", rd.wt, "--now", T.reds, "--", process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(marker)},"x");process.exit(${code})`];
  const before = ticketTree(rd);
  const passing = direct(rd, rd.wt, redArgs(0));
  assert.equal(passing.status, 1, ran("a red whose command exits 0", passing));
  assert.equal(ticketTree(rd), before, "the pending file is byte-identical");
  const failing = direct(rd, rd.wt, redArgs(1));
  assert.equal(failing.status, 0, ran("a failing command is recorded", failing));
  const redHeader = headerOf(join(rd.wtStudio, "ci", "reds", OPUS, "01.log"));
  const treeAt = redHeader.findIndex((l) => l.startsWith("# tree: "));
  assert.equal(redHeader[treeAt + 1], `# ticket: ${redLine}`, "the red's ticket follows # tree:");
  consumed(rd, "red");

  // a build verdict, then review --fail with a ticket, whose repeat finds none
  const b = world("w233-b3-build", "build");
  ticketed(b);
  const buildLine = issued(b, BUDGET);
  const verdict = (round: number, outcome: "passed" | "failed", body: string): Out =>
    direct(b, b.wt, ["verdict", OPUS, "--round", String(round), "--sella", "qa-lead", "--outcome", outcome, "--from", writeTranscript(b, `r${round}.md`, body), "--studio", b.wtStudio, "--now", round === 1 ? T.review1 : T.review2]);
  const review = (round: number, flag: string): Out => direct(b, b.wt, ["review", OPUS, flag, "--evidence", `ci/${OPUS}-review-${round}.log`, "--round", String(round), "--sella", "qa-lead", "--studio", b.wtStudio, "--now", round === 1 ? T.review1 : T.review2]);
  const v1 = verdict(1, "failed", "1. blocking: fixture defect at brief:1 [severity: S1]. check: none: fixture");
  assert.equal(v1.status, 0, ran("the build verdict", v1));
  assert.equal(headerOf(join(b.wtStudio, "ci", `${OPUS}-review-1.log`)).at(-1), `# ticket: ${buildLine}`, "the build verdict's header block ends with the ticket");
  consumed(b, "build verdict");
  const t1 = forge(b, "review", 1);
  const r1 = review(1, "--fail");
  assert.equal(r1.status, 0, ran("review --fail", r1));
  assert.deepEqual(recordTickets(b, "wt"), [JSON.stringify(t1)], "the review entry is the ticket line");
  consumed(b, "review");
  const again = recordOf(b, "wt");
  refused(review(1, "--fail"), "review", "absent", b, "the same review again");
  assert.equal(recordOf(b, "wt"), again, "the record is unchanged");
  // two writes, two entries in order
  forge(b, "verdict-build", 2);
  const t2v = ticketText(b).trimEnd();
  assert.equal(verdict(2, "passed", "No findings").status, 0);
  assert.equal(headerOf(join(b.wtStudio, "ci", `${OPUS}-review-2.log`)).at(-1), `# ticket: ${t2v}`);
  const t2 = forge(b, "review", 2);
  assert.equal(review(2, "--pass").status, 0);
  assert.deepEqual(recordTickets(b, "wt"), [JSON.stringify(t1), JSON.stringify(t2)], "two writes, two entries, in order");

  // ready and done
  const rw = world("w233-b3-ready", "branch");
  ticketed(rw);
  const readyLine = issued(rw);
  const ready = (w: World): Out => direct(w, w.wt, ["ready", OPUS, "--sella", "architect", "--studio", w.wtStudio, "--now", T.ready]);
  assert.equal(ready(rw).status, 0);
  assert.deepEqual(recordTickets(rw, "wt"), [readyLine], "ready appends the ticket");
  consumed(rw, "ready");
  const dn = world("w233-b3-done", "cleanup");
  scenario(dn, { list: mergedList(dn) });
  ticketed(dn);
  const doneLine = issued(dn);
  const od = direct(dn, dn.repo, ["done", OPUS, "--sella", "producer", "--studio", dn.studio, "--now", T.done]);
  assert.equal(od.status, 0, ran("done", od));
  assert.deepEqual(recordTickets(dn, "repo"), [doneLine], "done appends the ticket");
  consumed(dn, "done");

  // a tickets: mapping refuses ready, leaving the record and the pending file
  const bad = world("w233-b3-mapping", "branch");
  editRecord(bad, "wt", (doc) => doc.setIn(["tickets"], { a: 1 }));
  commit(bad.wt, "test: a tickets mapping");
  ticketed(bad);
  issued(bad);
  const snapBad = [recordOf(bad, "wt"), ticketTree(bad)];
  const ob = ready(bad);
  assert.equal(ob.status, 2, ran("ready with a tickets: mapping", ob));
  assert.match(ob.err, /tickets/, ran("the refusal names tickets", ob));
  assert.deepEqual([recordOf(bad, "wt"), ticketTree(bad)], snapBad, "the record and the pending file are untouched");

  // a directory at <opus>.claimed: unclaimable, nothing moves
  const dir = world("w233-b3-claimed-dir", "branch");
  ticketed(dir);
  issued(dir);
  mkdirSync(claimedPath(dir));
  const snapDir = [recordOf(dir, "wt"), readFileSync(ticketPath(dir), "utf8")];
  const odir = ready(dir);
  assert.equal(odir.status, 2, ran("ready over a directory at .claimed", odir));
  assert.match(odir.err.split("\n")[0] ?? "", /^W-900: ready refused: no matching next ticket \(unclaimable: /, ran("unclaimable", odir));
  assert.deepEqual([recordOf(dir, "wt"), readFileSync(ticketPath(dir), "utf8")], snapDir, "the record and the pending file are byte-identical");

  // a hand-written .claimed with nothing pending is not a ticket
  const hand = world("w233-b3-claimed-hand", "branch");
  ticketed(hand);
  const handLine = issued(hand);
  rmSync(ticketPath(hand));
  writeFileSync(claimedPath(hand), `${handLine}\n`);
  refused(ready(hand), "ready", "absent", hand, "a .claimed file holding a matching line");

  // a verdict whose write fails after the claim (a read-only ci/ refuses the exclusive create): the ticket is spent, never pending again
  const col = world("w233-b3-collision", "build");
  ticketed(col);
  forge(col, "verdict-build", 1);
  const colLine = ticketText(col).trimEnd();
  const ci = join(col.wtStudio, "ci");
  const collide = (): Out => direct(col, col.wt, ["verdict", OPUS, "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--from", writeTranscript(col, "c.md"), "--studio", col.wtStudio, "--now", T.review1]);
  if (process.getuid?.() !== 0) {
    chmodSync(ci, 0o500);
    try {
      const oc = collide();
      assert.equal(oc.status, 2, ran("the failed write", oc));
      assert.equal(existsSync(ticketPath(col)), false, ran("the pending path is empty", oc));
      assert.equal(readFileSync(claimedPath(col), "utf8"), `${colLine}\n`, "<opus>.claimed holds the line");
      refused(collide(), "verdict", "absent", col, "a second verdict");
    } finally {
      chmodSync(ci, 0o755);
    }
  }
});

test("W-233-b4 behaviour 4: a recorded verdict that the gate does not cite yet names review, not a new round", { timeout: 1_800_000 }, () => {
  const b = world("w233-b4-substep", "build");
  ticketed(b);
  const verdict = (w: World, round: number, outcome: "passed" | "failed", body: string): Out =>
    direct(w, w.wt, ["verdict", OPUS, "--round", String(round), "--sella", "qa-lead", "--outcome", outcome, "--from", writeTranscript(w, `r${round}.md`, body), "--studio", w.wtStudio, "--now", round === 1 ? T.review1 : T.review2]);
  const reviewV = (w: World, round: number, flag: string): Out => direct(w, w.wt, ["review", OPUS, flag, "--evidence", `ci/${OPUS}-review-${round}.log`, "--round", String(round), "--sella", "qa-lead", "--studio", w.wtStudio, "--now", round === 1 ? T.review1 : T.review2]);
  const command = (round: number): string => `bisellium review ${OPUS} --pass|--fail --evidence ci/${OPUS}-review-${round}.log --round ${round} --sella qa-lead --studio ${WT_STUDIO_REL}`;
  const substep = (w: World, round: number, row: string): void => {
    const o = next(w, [OPUS, ...BUDGET]);
    expectStep(o, "review", "named", row);
    assert.equal(o.kv.get("actor"), "producer", ran(`${row}: actor`, o));
    assert.equal(o.kv.get("command"), command(round), ran(`${row}: the exact review command`, o));
    assert.equal(lastLine(o), `ticket: review round ${round}`, ran(`${row}: ticket`, o));
    assert.equal(ticketOf(w)["action"], "review", `${row}: the ticket authorises review`);
    assert.equal(ticketOf(w)["round"], round);
  };

  issued(b, BUDGET);
  assert.equal(verdict(b, 1, "failed", "1. blocking: fixture defect at brief:1 [severity: S1]. check: none: fixture").status, 0);
  handoffAt(b, "wt", T.handoffFresh);
  substep(b, 1, "verdict 1 recorded, no gate");
  const r1 = reviewV(b, 1, "--fail");
  assert.equal(r1.status, 0, ran("review --fail with the substep's ticket", r1));
  handoffAt(b, "wt", T.handoffFresh);
  const after = next(b, [OPUS, ...BUDGET]);
  expectStep(after, "build", "named", "the gate cites round 1, failed at this tree");
  assert.match(after.out, /^phase:\s*fix$/m, ran("phase fix", after));

  // a fix, then round 2 passed while the gate still cites round 1
  forge(b, "verdict-build", 2);
  assert.equal(verdict(b, 2, "passed", "No findings").status, 0);
  handoffAt(b, "wt", T.handoffFresh);
  substep(b, 2, "verdict 2 recorded, the gate cites round 1");
  const r2 = reviewV(b, 2, "--pass");
  assert.equal(r2.status, 0, ran("review --pass with the substep's ticket", r2));
  const done = next(b, [OPUS, ...BUDGET]);
  assert.notEqual(done.first, `next: ${OPUS} review named`, ran("recorded: no longer review", done));
  assert.notEqual(done.first, `next: ${OPUS} review held`, ran("recorded: not held either", done));

  // another malformed gate state still holds
  const m = world("w233-b4-malformed", "build");
  ticketed(m);
  assert.equal(verdict(m, 1, "failed", "1. blocking: fixture defect at brief:1 [severity: S1]. check: none: fixture").status, 2, "no ticket yet: the verdict is refused");
  forge(m, "verdict-build", 1);
  assert.equal(verdict(m, 1, "failed", "1. blocking: fixture defect at brief:1 [severity: S1]. check: none: fixture").status, 0);
  editRecord(m, "wt", (doc) => doc.setIn(["probationes", "review"], { status: "maybe", sella: "qa-lead", evidence: `ci/${OPUS}-review-1.log` }));
  commit(m.wt, "test: a malformed gate");
  const om = next(m, [OPUS, ...BUDGET]);
  expectStep(om, "review", "held", "a malformed gate holds as on master");
  assert.equal(lastLine(om), "ticket: none", ran("a hold issues none", om));

  // without the key: the censor is dispatched for round 2, and the stale gate holds, as on master
  const p = world("w233-b4-plain", "build");
  assert.equal(verdict(p, 1, "failed", "1. blocking: fixture defect at brief:1 [severity: S1]. check: none: fixture").status, 0);
  handoffAt(p, "wt", T.handoffFresh);
  const op = next(p, [OPUS, ...BUDGET]);
  expectStep(op, "review", "named", "no key: dispatch");
  assert.equal(op.kv.get("round"), "2", ran("no key: round 2", op));
  assert.equal(op.kv.get("actor"), "censor", ran("no key: the censor", op));
  assert.equal(reviewV(p, 1, "--fail").status, 0);
  assert.equal(verdict(p, 2, "passed", "No findings").status, 0);
  handoffAt(p, "wt", T.handoffFresh);
  const oh = next(p, [OPUS, ...BUDGET]);
  expectStep(oh, "review", "held", "no key: the stale gate holds");
  assert.match(oh.kv.get("why") ?? "", /is not the newest build-review log/, ran("no key: why", oh));
});

test("W-233-b5 behaviour 5: next --perform goes through the same tickets", { timeout: 1_800_000 }, () => {
  // ready: issued from the derivation performed, consumed by runReady, and the next derivation's ticket left behind
  const r = world("w233-b5-ready", "branch");
  ticketed(r);
  const wtHead = git(r.wt, ["rev-parse", "HEAD"]);
  const or = next(r, [OPUS, "--perform", "--expect", "ready"]);
  expectStep(or, "ready", "performed", "ready is performed with a ticket");
  const entries = recordTickets(r, "wt") as string[];
  assert.equal(entries.length, 1, "one ticket entry");
  const entry = JSON.parse(entries[0]!) as Json;
  assert.equal(entry["action"], "ready");
  assert.equal(entry["head"], wtHead, "issued at the worktree's HEAD");
  assert.equal(existsSync(claimedPath(r)), false, "the claimed file is gone");
  const left = ticketOf(r);
  assert.equal(left["action"], "red", ran("the ticket left afterwards", or));
  assert.equal(left["round"], 1);

  // done: committed on chore/done-<id> with the done line in tickets:
  const d = world("w233-b5-done", "cleanup");
  scenario(d, { list: mergedList(d) });
  ticketed(d);
  touchHandoff(d);
  const od = next(d, [OPUS, "--perform", "--expect", "done"]);
  expectStep(od, "done", "performed", "done is performed with a ticket");
  const chore = parseFrontMatter<{ tickets?: unknown }>(git(d.repo, ["show", `refs/heads/chore/done-${OPUS}:studio/opera/${OPUS}.md`]), "record").data.tickets;
  assert.equal(Array.isArray(chore) && chore.length, 1, "the done record carries one ticket");
  assert.equal((JSON.parse((chore as string[])[0]!) as Json)["action"], "done");
  assert.equal(existsSync(claimedPath(d)), false, "the claimed file is gone");

  // branch: performed inside next, no ticket consumed; the ready ticket is left
  const b = world("w233-b5-branch", "spec");
  ticketed(b);
  const ob = next(b, [OPUS, "--perform", "--expect", "branch"]);
  expectStep(ob, "branch", "performed", "branch is performed");
  assert.equal(ticketOf(b)["action"], "ready", ran("the ready ticket is left", ob));
  assert.equal(existsSync(claimedPath(b)), false, "nothing was claimed");
});

test("W-206-b1 behaviour 1: an amended in-flight brief returns the ladder to spec on the opus branch, bound to its worktree", { timeout: 1_800_000 }, () => {
  const w = w206World("w206-b1", "review");
  ticketed(w);
  expectStep(next(w, [OPUS, ...BUDGET]), "pr", "named", "unamended: the reviewed opus names pr");
  amend(w);
  commit(w.wt, `studio(${OPUS}): brief amended`);
  const a = next(w, [OPUS, ...BUDGET]);
  architectOrder(a, 3, "an amended branch brief orders the architect at the next branch round");
  assert.match(a.kv.get("boot") ?? "", /--studio \.worktrees\/W-900\/studio$/, ran("the boot names the worktree studio", a));
  assert.match(a.kv.get("command") ?? "", /--round 3 --sella architect --outcome passed --phase spec --studio \.worktrees\/W-900\/studio/, ran("the verdict command names the worktree studio", a));
  assert.deepEqual({ ...ticketOf(w), at: undefined }, { opus: OPUS, step: "spec", action: "verdict-spec", round: 3, actor: "architect", studio: WT_STUDIO_REL, head: git(w.wt, ["rev-parse", "HEAD"]), brief: git(w.wt, ["hash-object", BRIEF_REL]), at: undefined }, "the ticket binds the worktree");
  const main = wtSpec({ ...w, wt: w.repo, wtStudio: w.studio }, 3, "architect", "passed");
  assert.equal(main.status, 2, ran("a main-checkout signature is refused (D-021)", main));
  assert.equal(existsSync(ticketPath(w)), true, "and the ticket stays pending");
  const signed = wtSpec(w, 3, "architect", "passed");
  assert.equal(signed.status, 0, ran("the worktree signature consumes the ticket", signed));
  assert.equal(existsSync(ticketPath(w)), false, "consumed");
  const r = next(w, [OPUS, ...BUDGET]);
  reviewerOrder(r, 4, "the branch signature goes to the reviewer");
  assert.match(r.kv.get("command") ?? "", /--packets .*--studio \.worktrees\/W-900\/studio|--studio \.worktrees\/W-900\/studio .*--packets/, ran("the packet names the worktree studio", r));
  assert.equal(ticketOf(w)["studio"], WT_STUDIO_REL, "the reviewer's ticket binds the worktree");

  const gone = w206World("w206-b1-gone", "review");
  amend(gone);
  commit(gone.wt, `studio(${OPUS}): brief amended`);
  git(gone.repo, ["worktree", "remove", "--force", gone.wt]);
  const h = next(gone, [OPUS, ...BUDGET]);
  expectStep(h, "spec", "held", "with no usable worktree the amended branch spec holds");
  assert.match(h.kv.get("why") ?? "", /not a usable worktree/, ran("why", h));
});

test("W-206-b2 behaviour 2: the spec perform commits the amended brief and every new spec round on opus/<id>", { timeout: 1_800_000 }, () => {
  const w = w206World("w206-b2", "review");
  amend(w);
  assert.equal(wtSpec(w, 3, "architect", "passed").status, 0, "signature 3");
  assert.equal(wtSpec(w, 4, SR, "failed", SR_MODEL).status, 0, "review 4 fails");
  appendFileSync(WT_BRIEF(w), "\nRevised.\n");
  verb(w.wt, ["handoff", "--opus", OPUS, "--sella", "producer", "--next", "re-sign the amended brief", "--studio", w.wtStudio, "--now", "2026-10-02T09:30:00.000Z"]);
  assert.equal(wtSpec(w, 5, "architect", "passed").status, 0, "signature 5");
  assert.equal(wtSpec(w, 6, SR, "passed", SR_MODEL).status, 0, "review 6 passes");
  const named = next(w, [OPUS]);
  expectStep(named, "spec", "named", "a passed branch spec left uncommitted names the spec commit");
  const tip = tipOf(w);
  const master = git(w.repo, ["rev-parse", "master"]);
  const done = next(w, [OPUS, "--perform", "--expect", "spec"]);
  expectStep(done, "spec", "performed", "the perform commits on the opus branch");
  assert.equal(git(w.repo, ["rev-parse", `${BRANCH}^`]), tip, "opus/<id> advances by one commit");
  const logs = [3, 4, 5, 6].map((n) => `studio/ci/${OPUS}-spec-${n}.log`);
  assert.deepEqual(git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", BRANCH]).split("\n").sort(), [...logs, BRIEF_REL, `studio/opera/${OPUS}.md`].sort(), "exactly the brief, rounds 3-6 and the record the handoff changed");
  assert.equal(git(w.repo, ["rev-parse", "master"]), master, "master is unmoved");
  assert.equal(branchExists(w, `spec/${OPUS}`), false, "no spec/<id>");
  assert.deepEqual(mutating(w), [], "no PR is opened or merged and nothing is pushed");

  const dirty = w206World("w206-b2-dirty", "review");
  amend(dirty);
  wtSpec(dirty, 3, "architect", "passed");
  wtSpec(dirty, 4, SR, "passed", SR_MODEL);
  appendFileSync(join(dirty.wt, "source.txt"), "uncommitted source\n");
  const t2 = tipOf(dirty);
  const held = next(dirty, [OPUS, "--perform", "--expect", "spec"]);
  expectStep(held, "spec", "held", "a source change beside the spec refuses the perform");
  assert.equal(tipOf(dirty), t2, "the branch is unmoved");
  assert.equal(git(dirty.wt, ["diff", "--cached", "--name-only"]), "", "nothing is staged");

  const h = w206World("w206-b2-history", "review");
  amend(h);
  assert.equal(wtSpec(h, 3, "architect", "passed").status, 0, "signature 3");
  assert.equal(wtSpec(h, 4, "architect", "passed").status, 0, "signature 4");
  assert.equal(wtSpec(h, 5, SR, "passed", SR_MODEL).status, 0, "review 5");
  const log3 = join(h.wtStudio, "ci", `${OPUS}-spec-3.log`);
  writeFileSync(log3, readFileSync(log3, "utf8").replace(/^# brief: .*$/m, "# brief: garbage"));
  const t3 = tipOf(h);
  const loose = next(h, [OPUS, "--perform", "--expect", "spec"]);
  expectStep(loose, "spec", "held", "a malformed new spec log below the signature holds");
  assert.match(loose.kv.get("why") ?? "", /spec-3\.log/, ran("why names it", loose));
  rmSync(join(h.wtStudio, "ci", `${OPUS}-spec-3.log`));
  git(h.wt, ["mv", `studio/ci/${OPUS}-spec-1.log`, "studio/ci/old.log"]);
  expectStep(next(h, [OPUS, "--perform", "--expect", "spec"]), "spec", "held", "a renamed committed spec log holds");
  git(h.wt, ["mv", "studio/ci/old.log", `studio/ci/${OPUS}-spec-1.log`]);
  appendFileSync(join(h.wtStudio, "ci", `${OPUS}-spec-2.log`), "edited\n");
  expectStep(next(h, [OPUS, "--perform", "--expect", "spec"]), "spec", "held", "an edited committed spec log holds");
  assert.equal(tipOf(h), t3, "the branch is unmoved");
});

test("W-206-b3 behaviour 3: a build review of an older brief is not current", { timeout: 1_800_000 }, () => {
  const w = w206World("w206-b3", "review");
  amend(w);
  wtSpec(w, 3, "architect", "passed");
  wtSpec(w, 4, SR, "passed", SR_MODEL);
  expectStep(next(w, [OPUS, "--perform", "--expect", "spec"]), "spec", "performed", "the amendment is committed");
  handoffAt(w, "wt", "2026-10-02T09:30:00.000Z");
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "review", "named", "a passed review of the older brief orders review, not pr");
  assert.equal(o.kv.get("round"), "2", ran("at the next round", o));
  addReview(w, "passed", 2, T.review2);
  expectStep(next(w, [OPUS, ...BUDGET]), "pr", "named", "a passed review of the current brief restores pr");

  const f = w206World("w206-b3-failed", "review", "failed");
  amend(f);
  wtSpec(f, 3, "architect", "passed");
  wtSpec(f, 4, SR, "passed", SR_MODEL);
  next(f, [OPUS, "--perform", "--expect", "spec"]);
  handoffAt(f, "wt", "2026-10-02T09:30:00.000Z");
  expectStep(next(f, [OPUS, ...BUDGET]), "review", "named", "a failed review of the older brief at this tree orders review, not a build fix");

  const log = join(w.wtStudio, "ci", `${OPUS}-review-2.log`);
  const text = readFileSync(log, "utf8");
  writeFileSync(log, text.replace(/^(# brief: .*)$/m, "$1\n$1"));
  commit(w.wt, "test: a duplicate brief pin");
  expectStep(next(w, [OPUS, ...BUDGET]), "review", "held", "two # brief: headers hold");
});

test("W-206-r1-1 review round 1: a malformed new signature with no anchor holds at spec, never another architect round", { timeout: 1_800_000 }, () => {
  const w = w206World("w206-r1-1", "review");
  amend(w);
  commit(w.wt, `studio(${OPUS}): brief amended`);
  assert.equal(wtSpec(w, 3, "architect", "passed").status, 0, "signature 3");
  const log3 = join(w.wtStudio, "ci", `${OPUS}-spec-3.log`);
  writeFileSync(log3, readFileSync(log3, "utf8").replace(/^# brief: .*$/m, "# brief: garbage"));
  const held = next(w, [OPUS, ...BUDGET]);
  expectStep(held, "spec", "held", "a signature whose # brief: has no pin shape holds");
  assert.equal(held.kv.has("role"), false, ran("no order is named", held));
  assert.match(held.kv.get("why") ?? "", /spec-3\.log/, ran("why names the log", held));
});

test("W-206-r1-2 review round 1: a deleted opus record beside valid spec work holds the perform", { timeout: 1_800_000 }, () => {
  const w = w206World("w206-r1-2", "review");
  amend(w);
  assert.equal(wtSpec(w, 3, "architect", "passed").status, 0, "signature 3");
  assert.equal(wtSpec(w, 4, SR, "passed", SR_MODEL).status, 0, "review 4");
  rmSync(join(w.wtStudio, "opera", `${OPUS}.md`));
  const tip = tipOf(w);
  const held = next(w, [OPUS, "--perform", "--expect", "spec"]);
  expectStep(held, "spec", "held", "a deleted record beside the spec refuses the perform");
  assert.equal(tipOf(w), tip, "the branch is unmoved");
  assert.equal(git(w.wt, ["diff", "--cached", "--name-only"]), "", "nothing is staged");
});

test("W-206-r1-3 review round 1: an unlistable worktree ci/ after the committed spec passed is the later rungs' hold, not spec", { timeout: 1_800_000 }, () => {
  const w = w206World("w206-r1-3", "review");
  const ci = join(w.wt, "studio/ci");
  try {
    chmodSync(ci, 0o100); // traversable but not listable
    reviewHeld(next(w, [OPUS, ...BUDGET]), "the committed spec passed, so the hold is the review rung's", /ci\//);
  } finally {
    chmodSync(ci, 0o755);
  }
});

test("W-206-r2-A review round 2: the shape guard on every new worktree spec log runs before any strict reader in deriveNext", { timeout: 1_800_000 }, () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "next.ts"), "utf8");
  const body = src.slice(src.indexOf("export function deriveNext("), src.indexOf("// 3 branch"));
  const guard = body.indexOf("is not a valid signature or spec review");
  const reader = body.indexOf("specEvidence(");
  assert.ok(guard >= 0 && reader >= 0, "deriveNext holds both the shape guard and a specEvidence read");
  assert.ok(guard < reader, `the guard (offset ${guard}) precedes the first specEvidence read (offset ${reader})`);
});

test("W-206-r2-B review round 2: an unlistable worktree ci/ beside an edited brief holds at spec, never commits the unsigned amendment", { timeout: 1_800_000 }, () => {
  const w = w206World("w206-r2-b", "review");
  amend(w);
  const ci = join(w.wt, "studio/ci");
  const tip = tipOf(w);
  try {
    chmodSync(ci, 0o100); // traversable but not listable
    const held = next(w, [OPUS, ...BUDGET]);
    expectStep(held, "spec", "held", "the edited brief is pending spec work, so an unlistable ci/ holds");
    assert.match(held.kv.get("why") ?? "", /ci\//, ran("why names ci/", held));
    const performed = next(w, [OPUS, "--perform", "--expect", "spec"]);
    expectStep(performed, "spec", "held", "the perform does not commit the amendment");
  } finally {
    chmodSync(ci, 0o755);
  }
  assert.equal(tipOf(w), tip, "the branch is unmoved");
});

// ---------------------------------------------------------------------------
// W-293 (W-206 part 2): the first signed spec is opus/<id>'s first commit; spec/<id> is retired
// ---------------------------------------------------------------------------
/** A failing commit, switch or worktree add of `branch` leaves the main checkout on master with nothing staged. */
const mainUnmoved = (w: World, row: string, o: Out): void => {
  assert.equal(git(w.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", ran(`${row}: HEAD is master`, o));
  assert.equal(stagedPaths(w), "", ran(`${row}: nothing is staged`, o));
};


test("W-293-b1 behaviour 1: before the branch, next judges the spec in the main checkout ahead of the trunk's", { timeout: 1_800_000 }, () => {
  const w = srWorld("w293-b1");
  putBrief(w);
  sign(w, 1);
  review(w, 2, "passed");
  landed(w);
  expectStep(specNext(w), "branch", "named", "a passed spec landed on master names branch");
  appendFileSync(briefPath(w), "\nRe-specified before the branch.\n");
  architectOrder(specNext(w), 3, "an uncommitted re-spec of a landed brief orders the architect, never branch");
  sign(w, 3);
  reviewerOrder(specNext(w), 4, "the uncommitted signature 3 goes to the reviewer");
  review(w, 4, "passed");
  expectStep(specNext(w), "branch", "named", "the uncommitted passed review 4 names branch");

  // a spec/<id> branch is never read or landed: the main checkout's spec decides
  const stale = world("w293-b1-spec-branch", "greenlight", { specOn: "spec-branch" });
  const o = next(stale, [OPUS, ...BUDGET]);
  expectStep(o, "spec", "named", "with no spec in the main checkout the spec rung names the architect");
  assert.equal(o.kv.get("role"), "architect", ran("an architect order", o));
  assert.doesNotMatch(o.out, /spec\/W-900|--perform --expect spec/, ran("spec/<id> is neither named nor landed", o));

  // without a reviewer the landed signature binds the brief it pins: an uncommitted edit that keeps every section voids it
  const plain = world("w293-b1-plain", "spec");
  handoffAt(plain, "repo", T.handoffFresh);
  expectStep(specNext(plain), "branch", "named", "no reviewer: the landed signed spec names branch");
  appendFileSync(briefPath(plain), "\nRe-specified before the branch, every section kept.\n");
  architectOrder(specNext(plain), 2, "no reviewer: an uncommitted re-spec voids the landed signature");
  sign(plain, 2);
  expectStep(specNext(plain), "branch", "named", "no reviewer: the uncommitted signature 2 of the edited brief names branch");
});

test("W-293-b2 behaviour 2: branch commits the main checkout's signed spec as the first commit on opus/<id>", { timeout: 1_800_000 }, () => {
  const w = srWorld("w293-b2");
  putBrief(w);
  sign(w, 1);
  review(w, 2, "failed");
  sign(w, 3);
  review(w, 4, "passed");
  verb(w.repo, ["handoff", "--opus", OPUS, "--sella", "producer", "--next", "branch the reviewed spec", "--studio", w.studio, "--now", T.handoffFresh]);
  writeFileSync(join(w.repo, "scratch.tmp"), "unrelated\n");
  expectStep(next(w, [OPUS]), "branch", "named", "a passed spec in the main checkout names branch");
  const master = git(w.repo, ["rev-parse", "master"]);
  const done = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectStep(done, "branch", "performed", "branch is performed");
  assert.equal(git(w.repo, ["rev-parse", `${BRANCH}^`]), master, "opus/<id> is master plus one commit");
  const logs = [1, 2, 3, 4].map(specLog);
  assert.deepEqual(git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", BRANCH]).split("\n").sort(), [...logs, BRIEF_REL, `studio/opera/${OPUS}.md`].sort(), "exactly the brief, every round and the record the handoff changed");
  assert.equal(git(w.repo, ["rev-parse", "master"]), master, "master is unmoved");
  assert.equal(branchExists(w, `spec/${OPUS}`), false, "no spec/<id>");
  assert.deepEqual(mutating(w), [], "nothing is pushed and no PR is opened");
  assert.equal(git(w.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "HEAD is master");
  assert.equal(git(w.repo, ["status", "--porcelain", "-uall", "--", ".", ":!.worktrees"]), "?? scratch.tmp", "the spec left the main checkout; the unrelated file stays");
  assert.match(recordOf(w, "wt"), /traditio:/, "the worktree's record carries the handoff");
  expectStep(next(w, [OPUS]), "ready", "named", "the spec is judged on the branch: ready follows");

  // an already landed spec cuts the branch at master, with no spec commit
  const old = world("w293-b2-landed", "spec");
  const oldMaster = git(old.repo, ["rev-parse", "master"]);
  expectStep(next(old, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", "a landed spec branches");
  assert.equal(tipOf(old), oldMaster, "opus/<id> is master itself");
  // the stated limit: without a reviewer the committed branch's signature is not bound to the brief, so a committed edit that
  // keeps every section leaves the spec passed (a reviewer re-judges an amended brief on the branch, W-206)
  appendFileSync(join(old.wt, BRIEF_REL), "\nAmended on the branch, every section kept.\n");
  commit(old.wt, `spec(${OPUS}): amend the brief`);
  expectStep(next(old, [OPUS]), "ready", "named", "no reviewer: the amended brief on opus/<id> stays passed (the limit)");

  // a tracked change beside the spec refuses before anything moves
  const dirty = srWorld("w293-b2-dirty");
  putBrief(dirty);
  sign(dirty, 1);
  review(dirty, 2, "passed");
  appendFileSync(join(dirty.repo, "source.txt"), "dirty\n");
  const held = next(dirty, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(held, "a tracked source change refuses branch");
  assert.equal(branchExists(dirty), false, "no branch");
  mainUnmoved(dirty, "dirty", held);
  assert.ok(existsSync(briefPath(dirty)), "the brief stays in the main checkout");

  // a failed add, commit, switch back or branch deletion never reports success; a failed add or commit leaves no branch,
  // and a branch whose deletion failed is named with its recovery
  for (const [tag, needles] of [["add", ["add --"]], ["commit", ["commit -q -m spec(W-900)"]], ["switch", ["switch -q master"]], ["drop", ["commit -q -m spec(W-900)", "update-ref -d"]]] as const) {
    const f = srWorld(`w293-b2-${tag}`);
    putBrief(f);
    sign(f, 1);
    review(f, 2, "passed");
    const o = next(f, [OPUS, "--perform", "--expect", "branch"], { env: { GIT_STUB_REAL: failingGit(`w293-b2-${tag}`, [...needles]) } });
    expectHeld(o, `branch with a failing ${tag}`);
    assert.doesNotMatch(o.out, /^branch: /m, ran(`${tag}: no success line`, o));
    if (tag === "add" || tag === "commit") {
      mainUnmoved(f, tag, o);
      assert.equal(branchExists(f), false, ran(`${tag}: no opus branch is left`, o));
      assert.ok(existsSync(briefPath(f)), "the brief stays in the main checkout");
    } else if (tag === "drop") {
      mainUnmoved(f, tag, o);
      assert.equal(branchExists(f), true, "the undeletable branch is kept");
      assert.match(o.out, /why: .*could not be deleted.*branch -D opus\/W-900/, ran("the why names the kept branch and its recovery", o));
    } else assert.match(o.out, /why: .*switch master/, ran("the why names the recovery", o));
  }

  // an unreadable index after a failed add or commit keeps HEAD on the branch and names the recovery; nothing reports success
  for (const [tag, needles] of [["add", ["add --"]], ["commit", ["commit -q -m spec(W-900)"]]] as const) {
    const x = srWorld(`w293-b2-index-${tag}`);
    putBrief(x);
    sign(x, 1);
    review(x, 2, "passed");
    const o = next(x, [OPUS, "--perform", "--expect", "branch"], { env: { GIT_STUB_REAL: failingGit(`w293-b2-index-${tag}`, [...needles, "diff --cached --name-only -z"]) } });
    expectHeld(o, `branch with a failing ${tag} and an unreadable index`);
    assert.doesNotMatch(o.out, /^branch: /m, ran(`${tag}: no success line`, o));
    assert.match(o.out, /why: .*could not read what is staged.*reset -q.*switch master.*branch -D opus\/W-900/, ran(`${tag}: the why names the recovery`, o));
    assert.equal(git(x.repo, ["symbolic-ref", "HEAD"]), `refs/heads/${BRANCH}`, ran(`${tag}: HEAD stays on the kept branch`, o));
    assert.equal(branchExists(x), true, `${tag}: the branch is kept`);
  }

  // a failed worktree add: a branch carrying the spec commit is kept, a bare cut is dropped, and an undeletable one is named
  const kept = srWorld("w293-b2-wt-kept");
  putBrief(kept);
  sign(kept, 1);
  review(kept, 2, "passed");
  const keptOut = next(kept, [OPUS, "--perform", "--expect", "branch"], { env: { GIT_STUB_REAL: failingGit("w293-b2-wt-kept", ["worktree add"]) } });
  expectHeld(keptOut, "a failing worktree add after the spec commit");
  assert.doesNotMatch(keptOut.out, /^branch: /m, ran("kept: no success line", keptOut));
  assert.match(keptOut.out, /why: .*worktree add failed.*carries the spec and is kept.*worktree add/, ran("kept: the why names git worktree add", keptOut));
  assert.equal(branchExists(kept), true, "kept: the branch carrying the spec stays");
  mainUnmoved(kept, "kept", keptOut);
  for (const [tag, needles, left] of [["bare", ["worktree add"], false], ["bare-undeletable", ["worktree add", "update-ref -d"], true]] as const) {
    const b = world(`w293-b2-wt-${tag}`, "spec");
    const o = next(b, [OPUS, "--perform", "--expect", "branch"], { env: { GIT_STUB_REAL: failingGit(`w293-b2-wt-${tag}`, [...needles]) } });
    expectHeld(o, `a failing worktree add on a bare cut (${tag})`);
    assert.doesNotMatch(o.out, /^branch: /m, ran(`${tag}: no success line`, o));
    assert.equal(branchExists(b), left, ran(`${tag}: the bare cut is ${left ? "kept" : "dropped"}`, o));
    if (left) assert.match(o.out, /why: .*could not be deleted.*branch -D opus\/W-900/, ran(`${tag}: the why names the kept branch`, o));
  }

  // an ignored spec log is read from the filesystem but git status omits it: branch refuses it rather than commit an incomplete spec
  const ign = srWorld("w293-b2-ignored");
  putBrief(ign);
  sign(ign, 1);
  appendFileSync(join(ign.repo, ".git/info/exclude"), `/${specLog(2)}\n`);
  review(ign, 2, "passed");
  expectStep(specNext(ign), "branch", "named", "the ignored passed review is read from the filesystem");
  const refused = next(ign, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(refused, "branch refuses an ignored spec log");
  assert.doesNotMatch(refused.out, /^branch: /m, ran("no success line", refused));
  assert.match(refused.out, /ignored/, ran("the why names the ignored log", refused));
  assert.equal(branchExists(ign), false, "no branch is cut");
  mainUnmoved(ign, "ignored", refused);
  assert.ok(existsSync(briefPath(ign)), "the brief stays in the main checkout");

  // after the branch the same disagreement holds the spec rung and its perform
  const wtIgn = w206World("w293-b2-wt-ignored", "review");
  amend(wtIgn);
  appendFileSync(join(wtIgn.repo, ".git/info/exclude"), `/${specLog(3)}\n`);
  assert.equal(wtSpec(wtIgn, 3, "architect", "passed").status, 0, "signature 3 is written");
  const heldWt = next(wtIgn, [OPUS, ...BUDGET]);
  expectStep(heldWt, "spec", "held", "an ignored worktree spec log holds the spec rung");
  assert.match(heldWt.kv.get("why") ?? "", /ignored/, ran("the why names the ignored log", heldWt));
  expectHeld(next(wtIgn, [OPUS, "--perform", "--expect", "spec"]), "the spec perform refuses an ignored spec log");
});


test("W-293-b3 behaviour 3: before the branch, the dispatch gate reads the handoff in the main checkout", { timeout: 1_800_000 }, () => {
  const w = srWorld("w293-b3", { handoff: false });
  putBrief(w);
  sign(w, 1);
  review(w, 2, "failed");
  specHeld(specNext(w), "no handoff yet", /no traditio/);
  verb(w.repo, ["handoff", "--opus", OPUS, "--sella", "producer", "--next", "revise the brief", "--studio", w.studio, "--now", T.handoffFresh]);
  const o = specNext(w);
  architectOrder(o, 3, "the uncommitted handoff admits the architect's resumed order");
  assert.equal(o.kv.get("budget_tokens"), "100000", ran("the order carries its budget", o));

  // the trunk's fresh handover never stands in for a deleted or unparsable record in the main checkout
  const t = srWorld("w293-b3-trunk");
  putBrief(t);
  sign(t, 1);
  review(t, 2, "failed");
  architectOrder(specNext(t), 3, "the committed handoff admits the order");
  const rec = join(t.repo, "studio/opera", `${OPUS}.md`);
  const text = readFileSync(rec, "utf8");
  rmSync(rec);
  specHeld(specNext(t), "a deleted record holds", /^opera\/W-900\.md in the main checkout \(studio\) is absent or unreadable/);
  writeFileSync(rec, "---\nstate: [unclosed\n---\n");
  specHeld(specNext(t), "an unparsable record holds", /^opera\/W-900\.md in the main checkout \(studio\) is malformed/);
  writeFileSync(rec, text);
  architectOrder(specNext(t), 3, "the restored record admits the order again");
});

// ---------------------------------------------------------------------------
// W-326: the reds and the code are replayed from the architect's signed prototype by `next --perform --expect reds`
// (studio/briefs/W-326.md); a builder only where the replay cannot run, for required fixes and for fix rounds.
// ---------------------------------------------------------------------------
const W326_TEST = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { readFileSync } from "node:fs";',
  'const source = readFileSync(new URL("./source.txt", import.meta.url), "utf8");',
  'test("W-900-b1 fixture behaviour 1", () => assert.match(source, /behaviour 1/));',
  'test("W-900-b2 fixture behaviour 2", () => assert.match(source, /behaviour 2/));',
  "",
].join("\n");
const w326Red = (k: number, quote = "'"): string =>
  `\`bisellium red ${OPUS} --behaviour ${k} --sella builder --studio studio -- node --test-reporter=tap --test-name-pattern=${quote}^W-900-b${k}\\s${quote} w326.test.mjs\``;
/** briefText(2) with a Prototype line, the red order and one Genuine red per behaviour. */
function w326Brief(prototype: string[], quote = "'"): string {
  return briefText(2)
    .replace(`# ${OPUS} fixture brief\n`, `# ${OPUS} fixture brief\n\n${prototype.join("\n")}\n\nRed order: one at a time\n`)
    .replace(/^([12])\. \*\*Fixture behaviour \1\.\*\*$/gm, (_, k: string) => `${k}. **Fixture behaviour ${k}.** **Genuine red:** ${w326Red(Number(k), quote)}`);
}
interface Staged {
  path: string;
  digest: string;
  line: string;
  /** the source tree of the architect's last staged commit */
  tree: string;
}
/** Stage the prototype as commits in `dir` (a test patch, then one implementation per behaviour), cut the series, take them off again. */
function stageSeries(w: World, dir: string, o: { name?: string; passing?: boolean; only?: number; moduleLoad?: boolean; noTest?: boolean } = {}): Staged {
  let base = git(dir, ["rev-parse", "HEAD"]);
  put(dir, "w326.test.mjs", o.passing ? W326_TEST.replace("/behaviour 1/", "/candidate/") : o.moduleLoad ? `import "./w326-absent.mjs";\n${W326_TEST}` : W326_TEST);
  commit(dir, `test(${OPUS}): row b1, red`);
  // a series with no test patch: the rows are committed in the base, outside the series
  if (o.noTest) base = git(dir, ["rev-parse", "HEAD"]);
  for (let k = 1; k <= (o.only ?? 2); k++) {
    appendFileSync(join(dir, "source.txt"), `behaviour ${k}\n`);
    commit(dir, `feat(${OPUS}): behaviour ${k}`);
  }
  const tree = `tree:${sourceTreeHash(dir, ["studio", ".bisellium"], "HEAD")}`;
  const path = join(w.root, o.name ?? "series.mbox");
  writeFileSync(path, `${git(dir, ["format-patch", "--stdout", `${base}..HEAD`])}\n`);
  git(dir, ["reset", "-q", "--hard", base]);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { path, digest, line: `${path} sha256:${digest}`, tree };
}
/** A ready, automated world whose committed brief on opus/<id> names the staged series. */
function w326World(tag: string, o: { tickets?: boolean; lines?: (s: Staged) => string[]; quote?: string; stage?: { passing?: boolean; only?: number; moduleLoad?: boolean; noTest?: boolean } } = {}): { w: World; s: Staged } {
  const w = world(tag, "ready", { automated: true });
  if (o.tickets) ticketed(w);
  const s = stageSeries(w, w.wt, o.stage);
  put(w.wt, BRIEF_REL, w326Brief(o.lines?.(s) ?? [`Prototype: ${s.line}`], o.quote));
  commit(w.wt, `spec(${OPUS}): the prototype line`);
  return { w, s };
}
const subjects = (w: World, n: number): string[] => git(w.wt, ["log", "--format=%s", `-${n}`]).split("\n").reverse();
const redHeader = (w: World, k: number): Map<string, string> =>
  new Map(
    readFileSync(join(w.wtStudio, "ci", "reds", OPUS, `0${k}.log`), "utf8")
      .split("\n\n")[0]!
      .split("\n")
      .map((l) => [l.slice(2, l.indexOf(":")), l.slice(l.indexOf(":") + 2)] as [string, string]),
  );
const performReds = (w: World): Out => next(w, [OPUS, "--perform", "--expect", "reds", ...BUDGET]);
/** The builder's reds order, as before W-326, naming why the prototype was not replayed. */
function builderReds(o: Out, why: RegExp, row: string): void {
  expectStep(o, "reds", "named", row);
  assert.match(o.kv.get("prototype") ?? "", why, ran(`${row}: the order names why the prototype is not replayed`, o));
  assert.equal(o.kv.get("role"), "builder", ran(`${row}: a builder's order`, o));
  assert.equal(o.kv.get("phase"), "1", ran(`${row}: phase 1`, o));
}

test("W-326-b1 behaviour 1: a reds perform replays the signed prototype one behaviour at a time, each red on its own ticket", { timeout: 1_800_000 }, () => {
  const { w, s } = w326World("w326-b1", { tickets: true });
  const before = git(w.wt, ["rev-parse", "HEAD"]);
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "reds", "named", "a signed prototype that applies names the replay");
  assert.equal(o.kv.get("actor"), "producer", ran("the producer performs it", o));
  assert.equal(o.kv.get("command"), `bisellium next ${OPUS} --perform --expect reds`, ran("the command is the reds perform", o));
  assert.equal(o.kv.get("prototype"), s.line, ran("the order names the series and its signed digest", o));
  assert.equal(o.kv.has("role"), false, ran("no builder order", o));
  assert.equal(git(w.wt, ["rev-parse", "HEAD"]), before, "report mode commits nothing");

  const p = performReds(w);
  expectStep(p, "reds", "performed", "the replay is performed");
  assert.equal(p.status, 0, ran("exit 0", p));
  assert.equal(p.kv.get("next-step"), "build", ran("every red is recorded: build follows", p));
  assert.deepEqual(subjects(w, 6), [`spec(${OPUS}): the prototype line`, `test(${OPUS}): row b1, red`, `chore(studio): ${OPUS} red b1`, `feat(${OPUS}): behaviour 1`, `chore(studio): ${OPUS} red b2`, `feat(${OPUS}): behaviour 2`], "test, red, implementation, red, implementation, in order");
  const sha = (back: number): string => git(w.wt, ["rev-parse", `HEAD~${back}`]);
  for (const [k, logCommit, redOn] of [[1, 3, 4], [2, 1, 2]] as const) {
    assert.deepEqual(git(w.wt, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha(logCommit)]).split("\n"), [`studio/ci/reds/${OPUS}/0${k}.log`], `red ${k}'s commit holds its log alone`);
    const h = redHeader(w, k);
    assert.equal(h.get("tree"), `tree:${sourceTreeHash(w.wt, ["studio", ".bisellium"], sha(redOn))}`, `red ${k} certifies the commit before its implementation`);
    assert.equal(h.get("exit"), "1", `red ${k} failed`);
    assert.equal(h.get("sella"), "architect", `red ${k} is recorded under the design sella`);
    assert.equal(h.get("command"), `node --test-reporter=tap --test-name-pattern=^W-900-b${k}\\s w326.test.mjs`, `red ${k} runs the brief's command, its quotes taken off`);
    const t = JSON.parse(h.get("ticket") ?? "{}") as { action?: string; round?: number; head?: string };
    assert.deepEqual([t.action, t.round, t.head], ["red", k, sha(redOn)], `red ${k} carries its own ticket, issued at the commit it records`);
  }
  assert.match(readFileSync(join(w.wtStudio, "ci", "reds", OPUS, "02.log"), "utf8"), /^not ok 1 - W-900-b2 fixture behaviour 2$/m, "red 2 fails by assertion on behaviour 1's commit");
  assert.equal(`tree:${sourceTreeHash(w.wt, ["studio", ".bisellium"], "HEAD")}`, s.tree, "the branch's source is the architect's last staged tree");
  assert.equal(git(w.wt, ["status", "--porcelain"]), "", "the worktree is clean");
});

test("W-326-b2 behaviour 2: a prototype the replay cannot reproduce names the builder and the reason, and a perform that cannot finish holds at its first failed step while keeping completed commits", { timeout: 1_800_000 }, () => {
  // a digest the series does not have
  const bad = w326World("w326-b2-digest", { lines: (s) => [`Prototype: ${s.path} sha256:${"0".repeat(64)}`] });
  const head = git(bad.w.wt, ["rev-parse", "HEAD"]);
  builderReds(next(bad.w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: .*series\\.mbox has sha256 ${bad.s.digest}, not the 0{64} the signed brief names$`), "a digest mismatch");
  expectStep(performReds(bad.w), "reds", "named", "a perform on an unreplayable prototype only names the builder's order");
  assert.equal(git(bad.w.wt, ["rev-parse", "HEAD"]), head, "nothing is committed");
  assert.equal(existsSync(join(bad.w.wtStudio, "ci", "reds")), false, "no red is recorded");

  builderReds(next(w326World("w326-b2-two", { lines: (s) => [`Prototype: ${s.line}`, `Prototype: ${s.line}`] }).w, [OPUS, ...BUDGET]), /^not replayed: the brief has 2 Prototype lines; one only$/, "two Prototype lines");
  builderReds(next(w326World("w326-b2-form", { lines: (s) => [`Prototype: ${s.path} sha1:${s.digest.slice(0, 40)}`] }).w, [OPUS, ...BUDGET]), /^not replayed: the Prototype line ".*" is not "Prototype: <absolute or ~\/ path> sha256:<64 lowercase hex>"$/, "a line in another form");
  builderReds(next(w326World("w326-b2-short", { stage: { only: 1 } }).w, [OPUS, ...BUDGET]), /^not replayed: the series covers behaviours 1 to 1; the brief lists 2$/, "a series short of a behaviour");
  builderReds(next(w326World("w326-b2-notest", { stage: { noTest: true } }).w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: patch 1 \\("feat\\(${OPUS}\\): behaviour 1"\\) is out of order: behaviour 1 wants its test patch first$`), "a series whose first patch is an implementation");
  builderReds(next(w326World("w326-b2-quote", { quote: '"' }).w, [OPUS, ...BUDGET]), /^not replayed: the red command holds "\\"" outside single quotes$/, "a red command a shell would read");

  // master moved under the series: a hunk no longer applies
  const moved = w326World("w326-b2-moved");
  put(moved.w.wt, "source.txt", "master moved this line\n");
  commit(moved.w.wt, "feat: master moved");
  builderReds(next(moved.w, [OPUS, ...BUDGET]), /^not replayed: the series does not apply at the worktree's HEAD: error: patch failed: source\.txt:1$/, "a series that no longer applies");

  // a red already recorded: the replay starts only from no red
  const begun = w326World("w326-b2-begun");
  put(begun.w.wtStudio, `ci/reds/${OPUS}/01.log`, "# behaviour: 1\n# exit: 1\n\nnot ok 1 - x\n");
  commit(begun.w.wt, "studio: a red by hand");
  handoffAt(begun.w, "wt", T.handoffFresh);
  builderReds(next(begun.w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: ci/reds/${OPUS}/ already holds 1 entry; the replay starts only where no red is recorded$`), "a red already recorded");

  // a reds directory that cannot be read as one is not "no red": a file in its place, a symlink out of the officina, no read permission
  const unread = (w: World, what: string, row: string): void => builderReds(next(w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: ci/reds/${OPUS}/ ${what}; whether a red is recorded cannot be read$`), row);
  const asFile = w326World("w326-b2-reds-file");
  put(asFile.w.wtStudio, `ci/reds/${OPUS}`, "not a directory\n");
  unread(asFile.w, "is not a directory", "an unreadable reds directory: a file in its place");
  const linked = w326World("w326-b2-reds-link");
  mkdirSync(join(linked.w.root, "elsewhere"));
  mkdirSync(join(linked.w.wtStudio, "ci", "reds"), { recursive: true });
  symlinkSync(join(linked.w.root, "elsewhere"), join(linked.w.wtStudio, "ci", "reds", OPUS));
  unread(linked.w, "is reached through a symlink", "an unreadable reds directory: a symlink out of the officina");
  if (process.getuid?.() !== 0) {
    const locked = w326World("w326-b2-reds-locked");
    const dir = join(locked.w.wtStudio, "ci", "reds", OPUS);
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o100); // traversable but not listable
    // the builder's order it then derives is held by W-316's silence read of the same directory; the replay is never performed
    const before = git(locked.w.wt, ["rev-parse", "HEAD"]);
    try {
      const o = performReds(locked.w);
      expectStep(o, "reds", "held", "an unreadable reds directory: no read permission");
      assert.equal(git(locked.w.wt, ["rev-parse", "HEAD"]), before, ran("an unreadable reds directory: the perform replays nothing", o));
    } finally {
      chmodSync(dir, 0o755);
    }
  }

  // a first `git am` that fails (an applypatch-msg hook here; a missing committer identity alike) commits nothing,
  // and the attempt marker written before it turns every later order into the builder's: no order loop
  const refused = w326World("w326-b2-am");
  const hooks = join(refused.w.root, "hooks");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "applypatch-msg"), "#!/bin/sh\necho 'applypatch-msg: refused' >&2\nexit 1\n", { mode: 0o755 });
  git(refused.w.wt, ["config", "core.hooksPath", hooks]);
  const at = git(refused.w.wt, ["rev-parse", "HEAD"]);
  const amHeld = performReds(refused.w);
  expectStep(amHeld, "reds", "held", "a first git am failure holds the perform");
  assert.match(amHeld.kv.get("why") ?? "", /^behaviour 1's test patch did not apply: /, ran("the why names the behaviour and the step", amHeld));
  assert.equal(git(refused.w.wt, ["rev-parse", "HEAD"]), at, "nothing is committed");
  builderReds(next(refused.w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: a replay of ${OPUS} was already attempted `), "after a first git am failure the builder's order, not the replay again");
  expectStep(performReds(refused.w), "reds", "named", "a second perform only names the builder's order");
  assert.equal(git(refused.w.wt, ["rev-parse", "HEAD"]), at, "a second perform commits nothing");

  // a test that passes on its own commit: the perform holds on the red, keeps the test commit, and the builder takes over
  const passing = w326World("w326-b2-passing", { stage: { passing: true } });
  const held = performReds(passing.w);
  expectStep(held, "reds", "held", "a red that passes holds the perform");
  assert.equal(held.status, 1, ran("exit 1", held));
  assert.match(held.kv.get("why") ?? "", /^behaviour 1's red was not recorded: red: command exited 0/, ran("the why names the behaviour and the red's refusal", held));
  assert.equal(subjects(passing.w, 1)[0], `test(${OPUS}): row b1, red`, "the test commit stays");
  assert.equal(existsSync(join(passing.w.wtStudio, "ci", "reds", OPUS, "01.log")), false, "no red is recorded");
  builderReds(next(passing.w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: a replay of ${OPUS} was already attempted \\(\\.bisellium/prototype-replay/${OPUS}\\.attempted\\); the replay runs once$`), "after the hold the builder's order");

  // a red that fails by module load is not a red: the perform holds and leaves its log uncommitted for the builder
  const load = w326World("w326-b2-load", { stage: { moduleLoad: true } });
  const unusable = performReds(load.w);
  expectStep(unusable, "reds", "held", "a module-load red holds the perform");
  assert.equal(unusable.kv.get("why"), `behaviour 1's red is not usable (a dirty-tree, module-load or exit-0 red); ci/reds/${OPUS}/01.log is left uncommitted`, ran("the why names the log", unusable));
  assert.equal(git(load.w.wt, ["status", "--porcelain", "-uall"]), `?? studio/ci/reds/${OPUS}/01.log`, "the log is left uncommitted");
  handoffAt(load.w, "wt", NOW_ISO);
  builderReds(next(load.w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: a replay of ${OPUS} was already attempted `), "after a module-load red the builder's order");

  // an unrelated untracked entry passes apply and am, then the red verb holds on it: the test commit stays and the builder takes over
  const stray = w326World("w326-b2-stray");
  put(stray.w.wt, "stray.txt", "unrelated\n");
  const strayHeld = performReds(stray.w);
  expectStep(strayHeld, "reds", "held", "an unrelated untracked entry holds the perform at the red");
  assert.match(strayHeld.kv.get("why") ?? "", /^behaviour 1's red was not recorded: /, ran("the why names the red", strayHeld));
  assert.equal(subjects(stray.w, 1)[0], `test(${OPUS}): row b1, red`, "the test commit stays");
  builderReds(next(stray.w, [OPUS, ...BUDGET]), new RegExp(`^not replayed: a replay of ${OPUS} was already attempted `), "after an unrelated untracked entry the builder's order");
});

test("W-326-b3 behaviour 3: after a replay the gates are the producer's; a builder only for a required fix or reds a builder recorded", { timeout: 1_800_000 }, () => {
  const { w } = w326World("w326-b3");
  expectStep(performReds(w), "reds", "performed", "the replay");
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "build", "named", "after the replay the build rung names the gates");
  assert.equal(o.kv.get("actor"), "producer", ran("the producer runs them", o));
  assert.equal(o.kv.has("role"), false, ran("no builder order", o));
  assert.equal(o.kv.get("replayed"), `every red of ${OPUS} was recorded by the prototype replay`, ran("the order says why", o));
  const command = o.kv.get("command") ?? "";
  assert.match(command, new RegExp(`^from \\.worktrees/${OPUS}: bisellium handoff --opus ${OPUS} --sella producer --next "ready for review" --studio studio, committed \\(studio only\\); then bisellium ci --opus ${OPUS} --studio studio --repo \\. \\(the one full suite, in the background\\); then commit the record and its gate logs`), ran("handoff, then ci --opus, then the gate commit", o));
  assert.match(command, /A ci --opus that exits non-zero is a builder's: dispatch builder \(phase 2\) through the host seam/, ran("a failing suite goes to a builder", o));

  // a red recorded by a builder: the build rung's builder order, as before
  const mixed = w326World("w326-b3-mixed");
  expectStep(performReds(mixed.w), "reds", "performed", "the replay");
  const log2 = join(mixed.w.wtStudio, "ci", "reds", OPUS, "02.log");
  writeFileSync(log2, readFileSync(log2, "utf8").replace("# sella: architect\n", `# sella: builder.${OPUS}\n`));
  commit(mixed.w.wt, "studio: red 2 re-recorded by a builder");
  handoffAt(mixed.w, "wt", T.handoffFresh);
  const m = next(mixed.w, [OPUS, ...BUDGET]);
  expectStep(m, "build", "named", "a builder's red");
  assert.equal(m.kv.get("role"), "builder", ran("the builder's phase 2 order", m));
  assert.equal(m.kv.has("replayed"), false, ran("not a replay", m));

  // a failed spec review whose blockers keep the design (D-086 A): the replay runs, and the required fixes are a builder's
  const KEEPS = "1. blocking brief:7 a script's ratio is rounded [severity: S1] [design: keeps]. check: none: no rule";
  const k = srWorld("w326-b3-keeps");
  const manifest = join(k.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes:", '  - { id: tests, name: Tests, kind: automated, command: "node -e 0" }\nsource_excludes:'));
  commit(k.repo, "studio: an automated gate");
  const ks = stageSeries(k, k.repo);
  // W-443: the signer's spec verdict compares each genuine red's command with the one its cited evidence records
  const kEvidence = join(dirname(k.repo), "w443-evidence");
  mkdirSync(kEvidence, { recursive: true });
  for (const b of [1, 2]) writeFileSync(join(kEvidence, `red-b${b}.out`), `# command: node --test-reporter=tap --test-name-pattern=^W-900-b${b}\\s w326.test.mjs\n\nTAP version 13\n`);
  put(k.repo, BRIEF_REL, w326Brief([`Prototype: ${ks.line}`]).replace(/(\^W-900-b([12])\\s' w326\.test\.mjs`)/g, (span: string, _all: string, b: string) => `${span} (\`${join(kEvidence, `red-b${b}.out`)}\`)`));
  sign(k, 1);
  review(k, 2, "failed", { body: `## Findings\n${KEEPS}\n` });
  landed(k);
  git(k.repo, ["branch", BRANCH]);
  git(k.repo, ["worktree", "add", "-q", k.wt, BRANCH]);
  verb(k.wt, ["ready", OPUS, "--sella", "architect", "--studio", k.wtStudio, "--now", T.ready]);
  commit(k.wt, `studio(${OPUS}): ready`);
  const kr = next(k, [OPUS, ...BUDGET]);
  expectStep(kr, "reds", "named", "keeps: the replay is named");
  assert.equal(kr.kv.get("prototype"), ks.line, ran("keeps: the replay order", kr));
  assert.equal(kr.kv.get("required-fixes"), `ci/${OPUS}-spec-2.log #1`, ran("keeps: the replay order names the required fix", kr));
  expectStep(performReds(k), "reds", "performed", "keeps: the replay");
  handoffAt(k, "wt", T.handoffFresh);
  const kb = next(k, [OPUS, ...BUDGET]);
  expectStep(kb, "build", "named", "keeps: build");
  assert.equal(kb.kv.get("role"), "builder", ran("keeps: the required fix is a builder's", kb));
  assert.equal(kb.kv.get("required-fixes"), `ci/${OPUS}-spec-2.log #1`, ran("keeps: the builder's order names it", kb));
});

// ---------------------------------------------------------------------------
// W-461: every red and implementation commit builds the web bundle certify's replay builds (studio/briefs/W-461.md).
// The fixture's web workspace is a tiny `@bisellium/web` whose `build` script loads `src/main.mjs` and writes
// `dist/index.html`, so `npm --workspace @bisellium/web run build` (certify's WEB_BUILD) fails on an unresolved import
// as vite's does, in well under a second.
// ---------------------------------------------------------------------------
const W461_ROW = "w461.test.mjs";
const W461_ROWS = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { readFileSync } from "node:fs";',
  'const source = readFileSync(new URL("./source.txt", import.meta.url), "utf8");',
  'test("W-900-b1 fixture behaviour 1", () => assert.match(source, /behaviour 1/));',
  'test("W-900-b2 fixture behaviour 2", () => assert.match(source, /behaviour 2/));',
  "",
].join("\n");
const W461_BUILD = [
  'import { mkdirSync, writeFileSync } from "node:fs";',
  'await import("./src/main.mjs");',
  'mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });',
  'writeFileSync(new URL("./dist/index.html", import.meta.url), "<!doctype html>\\n");',
  "",
].join("\n");
const W461_BUNDLE = ["apps", "web", "dist", "index.html"];

/** The fixture's web workspace on the opus branch: it builds while src/main.mjs resolves. */
function w461Web(dir: string, main = "export {};\n"): void {
  put(dir, ".gitignore", `${readFileSync(join(dir, ".gitignore"), "utf8")}dist/\n`);
  put(dir, "package.json", `${JSON.stringify({ name: "w461-fixture", private: true, workspaces: ["apps/web"] }, null, 2)}\n`);
  put(dir, "apps/web/package.json", `${JSON.stringify({ name: "@bisellium/web", private: true, type: "module", scripts: { build: "node build.mjs" } }, null, 2)}\n`);
  put(dir, "apps/web/build.mjs", W461_BUILD);
  put(dir, "apps/web/src/main.mjs", main);
  commit(dir, "chore: the fixture's web workspace");
}
const w461RedCmd = (k: number): string => `\`bisellium red ${OPUS} --behaviour ${k} --sella builder --studio studio -- node --test-reporter=tap --test-name-pattern='^W-900-b${k}\\s' ${W461_ROW}\``;
function w461Brief(prototype: string[]): string {
  return briefText(2)
    .replace(`# ${OPUS} fixture brief\n`, `# ${OPUS} fixture brief\n\n${prototype.join("\n")}${prototype.length > 0 ? "\n\n" : ""}Red order: one at a time\n`)
    .replace(/^([12])\. \*\*Fixture behaviour \1\.\*\*$/gm, (_, k: string) => `${k}. **Fixture behaviour ${k}.** **Genuine red:** ${w461RedCmd(Number(k))}`);
}
const w461Record = (w: World): Out => direct(w, w.wt, ["red", OPUS, "--behaviour", "1", "--sella", "builder", "--studio", w.wtStudio, "--", "node", "--test-reporter=tap", "--test-name-pattern=^W-900-b1\\s", W461_ROW]);
const w461RedLog = (w: World): string => join(w.wtStudio, "ci", "reds", OPUS, "01.log");
const w461Short = (w: World): string => git(w.wt, ["rev-parse", "--short", "HEAD"]);

test("W-461-b1 behaviour 1: a red is recorded only at a commit whose web bundle builds as certify builds it", { timeout: 600_000 }, () => {
  const w = world("w461-b1", "ready");
  w461Web(w.wt, 'import "./lib.mjs";\n');
  put(w.wt, BRIEF_REL, w461Brief([]));
  put(w.wt, W461_ROW, W461_ROWS);
  commit(w.wt, `test(${OPUS}): row b1, red`);

  // (a) the builder's own series: a commit that imports a module only a later commit adds
  const a = w461Record(w);
  assert.equal(a.status, 1, ran("a red at a commit whose web bundle does not build is refused", a));
  assert.match(a.err, new RegExp(`^red: red 1 replay preparation failed: web bundle build exited 1 at ${w461Short(w)}: certify's replay builds the web bundle at this commit and would refuse this red — nothing recorded$`, "m"), ran("the refusal is certify's own preparation line, at the commit", a));
  assert.equal(existsSync(w461RedLog(w)), false, "nothing is recorded");

  // (a2) a prior bundle path that cannot be removed: a directory left where the bundle goes
  mkdirSync(join(w.wt, ...W461_BUNDLE, "left"), { recursive: true });
  const d = w461Record(w);
  assert.ok(d.status === 1 && /^red: red 1 replay preparation failed: the prior apps\/web\/dist\/index\.html cannot be removed \(ERR_FS_EISDIR\) at [0-9a-f]+: certify's replay builds the web bundle at this commit and would refuse this red — nothing recorded$/m.test(d.err), ran("an invalid or unremovable stale bundle is refused without throwing", d));
  assert.equal(existsSync(w461RedLog(w)), false, "nothing is recorded");
  rmSync(join(w.wt, ...W461_BUNDLE), { recursive: true });

  // (b) a build that exits 0 but leaves no bundle, over a stale bundle from an earlier build
  put(w.wt, "apps/web/src/lib.mjs", "export {};\n");
  put(w.wt, "apps/web/build.mjs", 'await import("./src/main.mjs");\n');
  commit(w.wt, `test(${OPUS}): the build writes no bundle`);
  put(w.wt, W461_BUNDLE.join("/"), "<!doctype html>\nstale\n");
  const b = w461Record(w);
  assert.equal(b.status, 1, ran("a build that leaves no bundle is refused, a stale bundle notwithstanding", b));
  assert.match(b.err, /^red: red 1 replay preparation failed: the web bundle build left no apps\/web\/dist\/index\.html at [0-9a-f]+: certify's replay builds the web bundle at this commit and would refuse this red — nothing recorded$/m, ran("the refusal names the missing bundle", b));
  assert.equal(existsSync(w461RedLog(w)), false, "nothing is recorded");

  // (c) the same series once it builds: recorded as before
  put(w.wt, "apps/web/build.mjs", W461_BUILD);
  commit(w.wt, `test(${OPUS}): the build writes its bundle`);
  const c = w461Record(w);
  assert.equal(c.status, 0, ran("a red at a commit that builds is recorded", c));
  assert.match(readFileSync(w461RedLog(w), "utf8"), /^not ok 1 - W-900-b1 fixture behaviour 1$/m, "the recorded red is the row's assertion failure");
  assert.equal(existsSync(join(w.wt, ...W461_BUNDLE)), true, "the build left its bundle");
});

test("W-461-b1 a symlinked dist parent is refused without removing anything", { timeout: 600_000 }, () => {
  // the prior bundle path's parent is a link: the cleanup must not follow it to remove another index.html
  const cases: [string, (root: string, outside: string) => string, (root: string, outside: string) => string][] = [
    ["dist -> . (the tracked apps/web/index.html)", () => ".", (root) => join(root, "apps", "web", "index.html")],
    ["dist -> an outside directory", (_root, outside) => outside, (_root, outside) => join(outside, "index.html")],
  ];
  for (const [label, linkTo, target] of cases) {
    const root = scratch("w461-link");
    const outside = scratch("w461-out");
    put(root, "apps/web/package.json", `${JSON.stringify({ name: "@bisellium/web", private: true, type: "module", scripts: { build: "node build.mjs" } })}\n`);
    put(root, "apps/web/index.html", "<!doctype html>\ntracked\n");
    put(outside, "index.html", "<!doctype html>\noutside\n");
    symlinkSync(linkTo(root, outside), join(root, "apps", "web", "dist"));
    const r = webBuild(root);
    assert.equal(existsSync(target(root, outside)), true, `${label}: the file behind the link is still there`);
    assert.equal(r.carried && !r.ok, true, `${label}: webBuild refuses (ok: false)`);
    assert.equal(r.carried && !r.ok ? r.kind : "", "cleanup", `${label}: the refusal is the cleanup's`);
  }
});

/** A prototype series over the fixture's web workspace: test b1, then one implementation per behaviour, each editing src/main.mjs as `mains` says. */
function w461Stage(w: World, mains: [string, Record<string, string>][]): string {
  const base = git(w.wt, ["rev-parse", "HEAD"]);
  put(w.wt, W461_ROW, W461_ROWS);
  commit(w.wt, `test(${OPUS}): row b1, red`);
  for (const [k, [main, files]] of mains.entries()) {
    writeFileSync(join(w.wt, "source.txt"), `${readFileSync(join(w.wt, "source.txt"), "utf8")}behaviour ${k + 1}\n`);
    put(w.wt, "apps/web/src/main.mjs", main);
    for (const [rel, text] of Object.entries(files)) put(w.wt, rel, text);
    commit(w.wt, `feat(${OPUS}): behaviour ${k + 1}`);
  }
  const path = join(w.root, "series.mbox");
  writeFileSync(path, `${git(w.wt, ["format-patch", "--stdout", `${base}..HEAD`])}\n`);
  git(w.wt, ["reset", "-q", "--hard", base]);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  put(w.wt, BRIEF_REL, w461Brief([`Prototype: ${path} sha256:${digest}`]));
  commit(w.wt, `spec(${OPUS}): the prototype line`);
  return base;
}
const w461Subjects = (w: World, base: string): string[] => git(w.wt, ["log", "--reverse", "--format=%s", `${base}..HEAD`]).split("\n");

test("W-461-b2 behaviour 2: the reds perform builds each implementation commit and holds at the first that does not build", { timeout: 600_000 }, () => {
  // W-408's shape: behaviour 1's implementation imports a module only behaviour 2's adds; the series builds only at its tip
  const w = world("w461-b2", "ready", { automated: true });
  w461Web(w.wt);
  const base = w461Stage(w, [
    ['import "./lib.mjs";\n', {}],
    ['import "./lib.mjs";\n', { "apps/web/src/lib.mjs": "export {};\n" }],
  ]);
  const p = next(w, [OPUS, "--perform", "--expect", "reds", ...BUDGET]);
  expectStep(p, "reds", "held", "a series whose first implementation does not build holds");
  assert.match(p.kv.get("why") ?? "", /^behaviour 1's implementation does not build at [0-9a-f]+: web bundle build exited 1; certify's replay would refuse the series$/, ran("the hold names behaviour 1's implementation and certify's build failure", p));
  assert.deepEqual(w461Subjects(w, base), [`spec(${OPUS}): the prototype line`, `test(${OPUS}): row b1, red`, `chore(studio): ${OPUS} red b1`, `feat(${OPUS}): behaviour 1`], ran("what was committed is kept, and no red is recorded on the commit that does not build", p));

  // the tip, which no red sits on: behaviour 2's implementation imports a module no commit adds
  const t = world("w461-b2-tip", "ready", { automated: true });
  w461Web(t.wt);
  const tbase = w461Stage(t, [
    ["export {};\n", {}],
    ['import "./gone.mjs";\n', {}],
  ]);
  const q = next(t, [OPUS, "--perform", "--expect", "reds", ...BUDGET]);
  expectStep(q, "reds", "held", "a series whose last implementation does not build holds");
  assert.match(q.kv.get("why") ?? "", /^behaviour 2's implementation does not build at [0-9a-f]+: web bundle build exited 1; certify's replay would refuse the series$/, ran("the hold names the tip's implementation", q));
  assert.equal(w461Subjects(t, tbase).length, 6, ran("both reds and both implementations are committed and kept", q));

  // behaviour 1's build leaves a directory where the bundle goes (certify reads it as present); the next build in this
  // checkout, red 2's, cannot remove it: the perform holds, it does not throw
  const c = world("w461-b2-cleanup", "ready", { automated: true });
  w461Web(c.wt);
  w461Stage(c, [
    ["export {};\n", { "apps/web/build.mjs": 'import { mkdirSync } from "node:fs";\nawait import("./src/main.mjs");\nmkdirSync(new URL("./dist/index.html/", import.meta.url), { recursive: true });\n' }],
    ["export {};\n", {}],
  ]);
  const u = next(c, [OPUS, "--perform", "--expect", "reds", ...BUDGET]);
  assert.ok(u.first === `next: ${OPUS} reds held` && /^behaviour 2's red was not recorded: red: red 2 replay preparation failed: the prior apps\/web\/dist\/index\.html cannot be removed \(ERR_FS_EISDIR\) at [0-9a-f]+: certify's replay builds the web bundle at this commit and would refuse this red — nothing recorded$/.test(u.kv.get("why") ?? ""), ran("a bundle path the next build cannot remove holds the perform without throwing", u));

  // the same shape once every implementation builds: performed, as before
  const g = world("w461-b2-good", "ready", { automated: true });
  w461Web(g.wt);
  w461Stage(g, [
    ['import "./lib.mjs";\n', { "apps/web/src/lib.mjs": "export {};\n" }],
    ['import "./lib.mjs";\nimport "./more.mjs";\n', { "apps/web/src/more.mjs": "export {};\n" }],
  ]);
  const r = next(g, [OPUS, "--perform", "--expect", "reds", ...BUDGET]);
  expectStep(r, "reds", "performed", "a series that builds at every commit is performed");
  assert.equal(existsSync(join(g.wt, ...W461_BUNDLE)), true, "the last build left its bundle");
});

// ---------------------------------------------------------------------------
// W-468: a fix round records its red. A failed build round whose standing blocker cites this opus's red log is answered by
// recording that red again on its own ticket, before the fix check (D-086 D)
// ---------------------------------------------------------------------------
const W468_LATER = "2026-10-02T12:10:00.000Z";
const w468Blocker = (cite: string): string => `blocking — ${cite} [severity: S1] the red stops at an earlier assertion than the declared one at brief:1 [class: tests×assertion-satisfied-by-the-wrong-cause] — check: none: fixture`;
/** A build world (two behaviours, reds at 03:00) whose round 1 failed at 06:00 with `body`, a fresh handover, tickets required. */
function w468World(tag: string, body: string): World {
  const w = world(tag, "build");
  addReview(w, "failed", 1, T.review1, body);
  handoffAt(w, "wt", T.handoffFresh);
  ticketed(w);
  return w;
}
/** The fix round's test commit: a source change after the failed round (the cited row now fails at its declared assertion). */
function w468TestFix(w: World): void {
  appendFileSync(join(w.wt, "source.txt"), `the cited row fixed ${Date.now()}\n`);
  commit(w.wt, `test(${OPUS}): the cited row fails at its declared assertion`);
}
/** The red verb run directly on the pending ticket, as the builder runs it; its command fails by exit 1. */
const w468Red = (w: World, k: number, at: string): Out =>
  direct(w, w.wt, ["red", OPUS, "--behaviour", String(k), "--sella", "builder.W-900", "--studio", w.wtStudio, "--repo", w.wt, "--now", at, "--", process.execPath, "-e", "process.exit(1)"]);
function w468ReRed(o: Out, k: number, cited: string, row: string): void {
  expectStep(o, "reds", "named", row);
  assert.equal(o.status, 0, ran(`${row}: exit 0`, o));
  assert.equal(o.kv.get("actor"), "builder", ran(`${row}: the builder's order`, o));
  assert.equal(o.kv.get("phase"), "fix", ran(`${row}: phase fix`, o));
  assert.equal(o.kv.get("re-red"), cited, ran(`${row}: the cited reds`, o));
  assert.equal(lastLine(o), `ticket: red round ${k}`, ran(`${row}: the red ticket names the behaviour`, o));
}

test("W-468-b1 behaviour 1: a failed round citing this opus's red orders that red again on its own ticket, before the fix check", { timeout: 1_800_000 }, () => {
  const w = w468World("w468-b1", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  const o1 = next(w, [OPUS, ...BUDGET]);
  w468ReRed(o1, 2, "ci/reds/W-900/02.log", "the cited red is ordered again");
  assert.equal(o1.kv.get("why"), `review round 1 failed citing the red evidence of behaviour(s) 2, not recorded since ci/${OPUS}-review-1.log; the red is recorded again before the fix check (W-468)`, ran("why", o1));
  assert.equal(o1.kv.get("inputs"), `briefs/${OPUS}.md, ci/${OPUS}-review-1.log, opera/${OPUS}.md#traditio`, ran("the brief and the failed round are inputs", o1));
  assert.deepEqual({ ...ticketOf(w), at: undefined, brief: undefined }, { opus: OPUS, step: "reds", action: "red", round: 2, actor: "builder", studio: WT_STUDIO_REL, head: git(w.wt, ["rev-parse", "HEAD"]), brief: undefined, at: undefined });
  // the test fix commits: the red still comes first, its ticket bound to the new HEAD
  w468TestFix(w);
  const o2 = next(w, [OPUS, ...BUDGET]);
  w468ReRed(o2, 2, "ci/reds/W-900/02.log", "after the test fix the red comes before the fix check");
  assert.equal(ticketOf(w)["head"], git(w.wt, ["rev-parse", "HEAD"]), "the ticket is bound to the fixed HEAD");
  // the red verb takes that ticket and replaces 02.log
  const red = w468Red(w, 2, W468_LATER);
  assert.equal(red.status, 0, ran("the red verb records the red on its ticket", red));
  const header = headerOf(join(w.wtStudio, "ci", "reds", OPUS, "02.log"));
  assert.ok(header.includes(`# at: ${W468_LATER}`), `02.log is replaced by the new red: ${header.join(" | ")}`);
  assert.match(header.find((l) => l.startsWith("# ticket: ")) ?? "", /"action":"red","round":2,/, "the new red carries its red round 2 ticket");
  commit(w.wt, `studio(${OPUS}): red b2 again`);
  // recorded after the round: the fix check follows, as before W-468
  const o3 = next(w, [OPUS, ...BUDGET]);
  expectStep(o3, "review", "named", "a red recorded after the round lets the fix check follow");
  assert.equal(o3.kv.get("why"), "review round 1 failed at an older tree and no fix check of its findings is recorded at this tree (D-086 D)", ran("the fix check", o3));

  // two cited forms, lowest first: a backticked path and a ./ path ending a sentence; a red recorded before the round
  // (here at 03:00, the round at 06:00) is still stale
  const two = w468World("w468-b1-two", `1. ${w468Blocker("`studio/ci/reds/W-900/02.log:5`")}\n2. ${w468Blocker("see ./ci/reds/W-900/01.log.")}`);
  w468ReRed(next(two, [OPUS, ...BUDGET]), 1, "ci/reds/W-900/01.log, ci/reds/W-900/02.log", "two cited reds: behaviour 1 first");
  assert.equal(w468Red(two, 1, T.reds).status, 0, "a red recorded at 03:00");
  commit(two.wt, `studio(${OPUS}): red b1 at 03:00`);
  w468ReRed(next(two, [OPUS, ...BUDGET]), 1, "ci/reds/W-900/01.log, ci/reds/W-900/02.log", "a red not after the round is still stale");
  assert.equal(w468Red(two, 1, W468_LATER).status, 0, "red 1 again, after the round");
  commit(two.wt, `studio(${OPUS}): red b1 again`);
  handoffAt(two, "wt", "2026-10-02T12:20:00.000Z");
  w468ReRed(next(two, [OPUS, ...BUDGET]), 2, "ci/reds/W-900/02.log", "then behaviour 2");

  // forms not read: another opus's log, a number outside 1..n, a glued prefix, a longer name, a .log. suffix, and an advisory
  const none = w468World(
    "w468-b1-none",
    [
      `1. ${w468Blocker("ci/reds/W-901/02.log, ci/reds/W-900/07.log, ci/reds/W-900/00.log, xci/reds/W-900/02.log, ci/reds/W-900/02.logs and ci/reds/W-900/01.log.bak")}`,
      "2. advisory — studio/ci/reds/W-900/02.log:3 the red could say more [severity: S3] — check: none: fixture",
    ].join("\n"),
  );
  const o4 = next(none, [OPUS, ...BUDGET]);
  expectStep(o4, "build", "named", "no recognised citation: the fix order, as before W-468");
  assert.equal(o4.kv.get("phase"), "fix", ran("no recognised citation: phase fix", o4));
  assert.equal(lastLine(o4), "ticket: none", ran("no recognised citation: no red ticket", o4));
});

test("W-468-b2 behaviour 2: the fix round's red order names the restage, the ticket's HEAD, the replaced log and the revert", { timeout: 1_800_000 }, () => {
  const w = w468World("w468-b2", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  const o = next(w, [OPUS, ...BUDGET]);
  w468ReRed(o, 2, "ci/reds/W-900/02.log", "the cited red is ordered again");
  const order = o.kv.get("command") ?? "";
  assert.match(order, /dispatch builder\.W-900 \(phase fix, the cited red recorded again, W-468\), in \.worktrees\/W-900, for behaviour 2:/, ran("the fix round's red order, for the cited behaviour", o));
  assert.match(order, /fix the behaviour's test so its row fails at the assertion the brief declares, and commit it/, ran("the test is fixed first", o));
  assert.match(order, /commit a restage: the behaviour's implementation removed, its fixed test and every other behaviour's code kept/, ran("the restage", o));
  assert.match(order, /from \.worktrees\/W-900: bisellium next W-900 \(the ticket binds this HEAD\), then bisellium red W-900 --behaviour 2 --sella builder\.W-900 --studio studio -- <the brief's Genuine red command>; it replaces ci\/reds\/W-900\/02\.log/, ran("next, then red, replacing 02.log", o));
  assert.match(order, /commit the red log alone \(studio files only\), then git revert the restage/, ran("the log alone, then the revert", o));
  assert.match(order, /certify replays only a commit on opus\/W-900; never rewrite history\./, ran("certify and history", o));
  assert.doesNotMatch(order, /from behaviour 2 through 2/, ran("not the phase 1 order", o));
});

test("W-468-b1 behaviour 1: a cited red whose # at: is not an exact time is ordered again", { timeout: 1_800_000 }, () => {
  const w = w468World("w468-b1-inexact", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  w468ReRed(next(w, [OPUS, ...BUDGET]), 2, "ci/reds/W-900/02.log", "the cited red is ordered");
  assert.equal(w468Red(w, 2, W468_LATER).status, 0, "a red recorded after the round");
  const log = join(w.wtStudio, "ci", "reds", OPUS, "02.log");
  const text = readFileSync(log, "utf8");
  // each form parses as a time after the round (06:00) yet is not an exact timestamp: date-only, zone-less, offset
  for (const at of ["2026-10-03", "2026-10-02T12:10:00", "2026-10-02T12:10:00+00:00", "2026-10-02T20:10:00+08:00"]) {
    writeFileSync(log, text.replace(`# at: ${W468_LATER}`, `# at: ${at}`));
    commit(w.wt, `studio(${OPUS}): red b2 at ${at}`);
    handoffAt(w, "wt", "2026-10-04T00:00:00.000Z");
    w468ReRed(next(w, [OPUS, ...BUDGET]), 2, "ci/reds/W-900/02.log", `an inexact # at: ${at} is stale`);
  }
});

/** W-468-b3: round 1's log pinned by `ticket` (a `# ticket:` line) in place of its `# brief:` line, or by neither, committed. */
function w468Pin(w: World, ticket: string | undefined): void {
  const log = join(w.wtStudio, "ci", `${OPUS}-review-1.log`);
  const text = readFileSync(log, "utf8");
  assert.match(text, /^# brief: briefs\/W-900\.md blob:[0-9a-f]{40}$/m, "round 1 carries a # brief: pin to replace");
  const bare = text.replace(/^# brief: .*\n/m, "");
  writeFileSync(log, ticket === undefined ? bare : bare.replace(/^(# tree: .*)$/m, `$1\n# ticket: ${ticket}`));
  commit(w.wt, `test(${OPUS}): round 1 pinned by ${ticket === undefined ? "nothing" : "its ticket"}`);
}
/** A canonical verdict-build ticket line for round 1 naming `brief`, as `ticketLine` writes it. */
const w468Ticket = (brief: string): string =>
  JSON.stringify({ opus: OPUS, step: "review", action: "verdict-build", round: 1, actor: "censor", studio: WT_STUDIO_REL, head: "0".repeat(40), brief, at: T.review1 });
const w468Blob = (w: World): string => {
  const bytes = readFileSync(WT_BRIEF(w));
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
};
/**
 * W-468-b3: the record made kind: ui with a custom `spec:` (briefs/custom.md: other bytes than briefs/W-900.md, or with `same`
 * its bytes), a ui-lead seat
 * and its UI input recorded through `next` and `verdict`, so the spec gate passes and the build rung is reached.
 */
function w468Custom(w: World, same = false): void {
  writeFileSync(join(w.wtStudio, "briefs", "custom.md"), `${readFileSync(WT_BRIEF(w), "utf8")}${same ? "" : "\nA custom brief.\n"}`);
  editRecord(w, "wt", (doc) => {
    doc.setIn(["kind"], "ui");
    doc.setIn(["spec"], "briefs/custom.md");
  });
  const yml = join(w.wtStudio, "bisellium.yml");
  writeFileSync(yml, readFileSync(yml, "utf8").replace(/^(  - \{ id: architect,.*)$/m, "$1\n  - { id: ui-lead, collegium: design, kind: agent, model: gpt-6-astra, harness: codex }"));
  expectStep(next(w, [OPUS, ...BUDGET]), "spec", "named", "a kind: ui record asks its UI input first");
  put(w.wtStudio, `ci/${OPUS}-ui-prompt-2.md`, "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n");
  const from = join(w.root, "w468-ui-input.md");
  writeFileSync(from, ["## Findings", "No findings", "The navigation relationships remain legible across the complete narrow viewport arrangement.", "## Recommendation", "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.", "Additional original observations cover focus movement responsive density and stable content grouping throughout.", "Verdict: passed", ""].join("\n"));
  const ui = direct(w, w.wt, ["verdict", OPUS, "--round", "2", "--sella", "ui-lead", "--outcome", "passed", "--phase", "spec", "--from", from, "--dispatch-prompt", `ci/${OPUS}-ui-prompt-2.md`, "--studio", w.wtStudio, "--now", T.spec]);
  assert.equal(ui.status, 0, ran("the UI input is recorded", ui));
}
function w468NoReRed(o: Out, row: string): void {
  expectStep(o, "build", "named", row);
  assert.equal(o.kv.get("phase"), "fix", ran(`${row}: phase fix`, o));
  assert.equal(lastLine(o), "ticket: none", ran(`${row}: no red ticket`, o));
}

test("W-468-b3 behaviour 3: only a failed round of the current brief orders its cited red again", { timeout: 1_800_000 }, () => {
  // W-206-b3 with a cited red: round 2 fails citing 01.log against the brief then; the brief is amended and re-signed, so the
  // round's # brief: pin is not the current one: review, as W-206-b3 orders, never a red ticket for the current brief
  const old = w206World("w468-b3-old", "review", "failed");
  addReview(old, "failed", 2, T.review2, `1. ${w468Blocker("studio/ci/reds/W-900/01.log:3")}`);
  amend(old);
  assert.equal(wtSpec(old, 3, "architect", "passed").status, 0, "signature 3");
  assert.equal(wtSpec(old, 4, SR, "passed", SR_MODEL).status, 0, "review 4");
  expectStep(next(old, [OPUS, "--perform", "--expect", "spec"]), "spec", "performed", "the amendment is committed");
  handoffAt(old, "wt", "2026-10-02T09:30:00.000Z");
  const o1 = next(old, [OPUS, ...BUDGET]);
  expectStep(o1, "review", "named", "a round of an older brief citing a red: review, not a re-red");
  assert.equal(o1.kv.has("re-red"), false, ran("a round of an older brief: no re-red line", o1));

  // a round with no # brief: (a kind: ui build round) is read by its one ticket's brief blob
  const tk = w468World("w468-b3-ticket", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  w468Pin(tk, w468Ticket(w468Blob(tk)));
  w468ReRed(next(tk, [OPUS, ...BUDGET]), 2, "ci/reds/W-900/02.log", "a round pinned by its ticket's brief: the cited red is ordered again");

  const other = w468World("w468-b3-other", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  w468Pin(other, w468Ticket("f".repeat(40)));
  w468NoReRed(next(other, [OPUS, ...BUDGET]), "a ticket of another brief: no re-red");

  const bare = w468World("w468-b3-bare", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  w468Pin(bare, undefined);
  w468NoReRed(next(bare, [OPUS, ...BUDGET]), "no brief identity: no re-red");

  // a kind: ui record whose spec: is a custom brief: the ticket hashes briefs/W-900.md, not the brief the round judged, so the
  // fallback does not hold and the existing review path follows (the custom pointer's re-red is W-475)
  const custom = w468World("w468-b3-custom", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  w468Custom(custom);
  w468Pin(custom, w468Ticket(w468Blob(custom)));
  w468NoReRed(next(custom, [OPUS, ...BUDGET]), "a custom spec pointer: no re-red");
  // the same with briefs/custom.md a byte-identical copy: the fallback is the default path's only, whatever bytes it names
  const copy = w468World("w468-b3-copy", `1. ${w468Blocker("studio/ci/reds/W-900/02.log:17")}`);
  w468Custom(copy, true);
  w468Pin(copy, w468Ticket(w468Blob(copy)));
  w468NoReRed(next(copy, [OPUS, ...BUDGET]), "a custom spec pointer to the same bytes: no re-red");
});
