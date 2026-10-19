/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseFrontMatter } from "@bisellium/adapter-native";
import { parseVerdictLog } from "@bisellium/commands/verdict.js";
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
  const v1 = verdict(1, "failed", "1. blocking: fixture defect at brief:1. check: none: fixture");
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
  assert.equal(verdict(b, 1, "failed", "1. blocking: fixture defect at brief:1. check: none: fixture").status, 0);
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
  assert.equal(verdict(m, 1, "failed", "1. blocking: fixture defect at brief:1. check: none: fixture").status, 2, "no ticket yet: the verdict is refused");
  forge(m, "verdict-build", 1);
  assert.equal(verdict(m, 1, "failed", "1. blocking: fixture defect at brief:1. check: none: fixture").status, 0);
  editRecord(m, "wt", (doc) => doc.setIn(["probationes", "review"], { status: "maybe", sella: "qa-lead", evidence: `ci/${OPUS}-review-1.log` }));
  commit(m.wt, "test: a malformed gate");
  const om = next(m, [OPUS, ...BUDGET]);
  expectStep(om, "review", "held", "a malformed gate holds as on master");
  assert.equal(lastLine(om), "ticket: none", ran("a hold issues none", om));

  // without the key: the censor is dispatched for round 2, and the stale gate holds, as on master
  const p = world("w233-b4-plain", "build");
  assert.equal(verdict(p, 1, "failed", "1. blocking: fixture defect at brief:1. check: none: fixture").status, 0);
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
  specHeld(specNext(t), "a deleted record holds", /stale handover/);
  writeFileSync(rec, "---\nstate: [unclosed\n---\n");
  specHeld(specNext(t), "an unparsable record holds", /stale handover/);
  writeFileSync(rec, text);
  architectOrder(specNext(t), 3, "the restored record admits the order again");
});
