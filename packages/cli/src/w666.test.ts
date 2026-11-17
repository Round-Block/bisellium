/**
 * packages/cli/src/w666.test.ts — W-666: a Patron answer carries a signed receipt. Row b1: `answer` takes a Patron answer
 * only with a valid receipt when the officina names Patron keys; b2: `check` refuses a recorded Patron answer whose
 * receipt is missing or invalid; b3: the console's answer route forwards the receipt to `answer`. node:test TAP; a row
 * is selected by `--test-name-pattern='^W-666-b<n>\s'`. Every key is generated here, per run; none is committed. The
 * receipt's signed bytes are written out here, apart from the source, so the wire form is pinned. The fixture is a copy
 * of examples/sample-studio under the OS tmp dir; nothing under studio/ is read or written.
 *
 * Run from the repo root:
 *   node --test-reporter=tap --import tsx packages/cli/src/w666.test.ts
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServer, type StartServerOptions } from "@bisellium/server";
import { parse as parseYaml } from "yaml";
import { runAnswer } from "@bisellium/commands/writes.js";
import { checkStudio } from "./check.js";

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples", "sample-studio");
const NOW = "2026-11-16T03:00:00.000Z";
const DOMAIN = "bisellium-patron-receipt/v1";
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Pair {
  pub: KeyObject;
  priv: KeyObject;
}
const ed = (): Pair => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: publicKey, priv: privateKey };
};
const p256 = (): Pair => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { pub: publicKey, priv: privateKey };
};
const spki = (k: KeyObject): string => k.export({ type: "spki", format: "der" }).toString("base64");
const keyId = (k: KeyObject): string => createHash("sha256").update(k.export({ type: "spki", format: "der" })).digest("hex");
const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

interface Payload {
  v: number;
  petitio: string;
  question: string;
  option: string;
  mode: string;
  charter_gap: boolean;
  nonce: string;
  at: string;
}
interface Receipt {
  payload: Payload;
  key: string;
  sig: string;
}
/** The signed bytes: the domain line, then the payload's fields as one JSON array, in this order. */
const signed = (p: Payload): Buffer => Buffer.from(`${DOMAIN}\n${JSON.stringify([p.v, p.petitio, p.question, p.option, p.mode, p.charter_gap, p.nonce, p.at])}`, "utf8");
function receiptOf(pair: Pair, p: Payload): Receipt {
  const ec = pair.pub.asymmetricKeyType === "ec";
  const sig = ec ? cryptoSign("sha256", signed(p), { key: pair.priv, dsaEncoding: "ieee-p1363" }) : cryptoSign(null, signed(p), pair.priv);
  return { payload: p, key: keyId(pair.pub), sig: sig.toString("base64") };
}

const A1_BODY_RAW = () => readFileSync(join(SAMPLE, "petitiones", "A-1.md"), "utf8");
const bodyOf = (raw: string): string => raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
/** The question digest: sha256 of the petitio's body, front matter excluded, trimmed. */
const A1_QUESTION = (): string => sha(bodyOf(A1_BODY_RAW()).trim());
const payload = (over: Partial<Payload> = {}): Payload => ({
  v: 1,
  petitio: "A-1",
  question: A1_QUESTION(),
  option: "Ship both.",
  mode: "resolve",
  charter_gap: false,
  nonce: randomBytes(16).toString("hex"),
  at: "2026-11-16T02:58:00.000Z",
  ...over,
});

/** A copy of the sample officina whose bisellium.yml names these Patron keys (none: no `patron_receipts` at all). */
function officina(tag: string, keys: KeyObject[] | undefined, extra = ""): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w666-${tag}-`));
  dirs.push(dir);
  cpSync(SAMPLE, dir, { recursive: true });
  if (keys !== undefined)
    appendFileSync(join(dir, "bisellium.yml"), `patron_receipts:\n  keys:\n${keys.map((k) => `    - "${spki(k)}"\n`).join("")}${extra}`);
  return dir;
}
function receiptFile(dir: string, r: unknown): string {
  const path = join(`${dir}-receipts`, `${randomBytes(4).toString("hex")}.json`);
  mkdirSync(dirname(path), { recursive: true });
  dirs.push(dirname(path));
  writeFileSync(path, typeof r === "string" ? r : JSON.stringify(r));
  return path;
}
function answer(args: string[]): { code: number; err: string } {
  const errs: string[] = [];
  const oe = console.error;
  const ol = console.log;
  console.error = (...a: unknown[]) => void errs.push(a.join(" "));
  console.log = () => {};
  try {
    return { code: runAnswer(args).exitCode, err: errs.join("\n") };
  } finally {
    console.error = oe;
    console.log = ol;
  }
}
const timeline = (dir: string): string => (existsSync(join(dir, "timeline", "patron.jsonl")) ? readFileSync(join(dir, "timeline", "patron.jsonl"), "utf8") : "");
const petitio = (dir: string): string => readFileSync(join(dir, "petitiones", "A-1.md"), "utf8");

test("W-666-b1 answer takes a Patron answer only with a valid receipt", () => {
  const patron = ed();
  const agent = ed();
  const dir = officina("b1", [patron.pub]);
  const base = ["--petitio", "A-1", "Ship both.", "--studio", dir, "--now", NOW];
  const refused = (r: { code: number; err: string }, words: string, what: string): void => {
    assert.equal(r.code === 2 && r.err.includes(words), true, what);
    assert.equal(petitio(dir), A1_BODY_RAW(), `${what}, the petitio untouched`);
    assert.equal(timeline(dir), "", `${what}, no timeline line`);
  };

  refused(answer(base), "patron receipt required", "an answer with no receipt is refused by name");
  const good = receiptOf(patron, payload());
  refused(answer([...base, "--receipt", receiptFile(dir, { ...good, sig: randomBytes(64).toString("base64") })]), "patron receipt signature does not verify", "a forged receipt is refused by name");
  refused(answer([...base, "--receipt", receiptFile(dir, { ...good, payload: { ...good.payload, option: "Cut split stacks." } })]), "patron receipt signature does not verify", "an altered receipt is refused by name");
  refused(answer([...base, "--receipt", receiptFile(dir, receiptOf(patron, payload({ option: "Cut split stacks." })))]), "patron receipt is not for this answer: option", "a receipt for another reply is refused by name");
  refused(answer([...base, "--receipt", receiptFile(dir, receiptOf(agent, payload()))]), "patron receipt key is not a Patron key", "an agent-authored receipt is refused by name");
  refused(answer([...base, "--receipt", receiptFile(dir, receiptOf(patron, payload({ at: "2026-11-16T02:40:00.000Z" })))]), "patron receipt time is outside", "a stale receipt is refused by name");
  refused(answer([...base, "--receipt", receiptFile(dir, "{not json")]), "patron receipt is not valid JSON", "an unparseable receipt is refused by name");
  refused(answer([...base, "--receipt", receiptFile(dir, { ...good, payload: { ...good.payload, nonce: "short" } })]), "patron receipt shape: nonce", "a receipt of the wrong shape is refused by name");

  const ok = answer([...base, "--receipt", receiptFile(dir, good)]);
  assert.equal(ok.code, 0, "a valid receipt is accepted");
  const front = parseYaml(petitio(dir).split("---\n")[1]!) as { receipts?: Record<string, unknown> };
  assert.deepEqual(front.receipts, { [NOW]: good }, "a valid receipt is recorded on the petitio under its stamp");
  const line = JSON.parse(timeline(dir).trim()) as { role: string; receipt?: Receipt };
  assert.deepEqual([line.role, line.receipt], ["patron", good], "a valid receipt is copied to the timeline line");

  // the same receipt again, the petitio asked anew: its nonce is spent
  writeFileSync(join(dir, "petitiones", "A-1.md"), A1_BODY_RAW());
  const before = timeline(dir);
  const replay = answer([...base, "--receipt", receiptFile(dir, good)]);
  assert.equal(replay.code === 2 && replay.err.includes("patron receipt nonce already used"), true, "a replayed receipt is refused by name");
  assert.equal(timeline(dir), before, "a replayed receipt writes no timeline line");

  const ec = p256();
  const both = officina("b1-ec", [patron.pub, ec.pub]);
  const ecOk = answer(["--petitio", "A-1", "Ship both.", "--studio", both, "--now", NOW, "--receipt", receiptFile(both, receiptOf(ec, payload()))]);
  assert.equal(ecOk.code, 0, "a P-256 Patron key verifies too");

  const bad = mkdtempSync(join(tmpdir(), "bisellium-w666-bad-"));
  dirs.push(bad);
  cpSync(SAMPLE, bad, { recursive: true });
  appendFileSync(join(bad, "bisellium.yml"), 'patron_receipts:\n  keys:\n    - "bm90IGEga2V5"\n');
  const badKey = answer(["--petitio", "A-1", "Ship both.", "--studio", bad, "--now", NOW, "--receipt", receiptFile(bad, good)]);
  assert.equal(badKey.code === 2 && badKey.err.includes("patron_receipts"), true, "a malformed Patron key list refuses every answer");

  const open = officina("b1-open", undefined);
  assert.equal(answer(["--petitio", "A-1", "Ship both.", "--studio", open, "--now", NOW]).code, 0, "an officina naming no Patron keys answers as before");
});

/** A recorded answer, as `answer` writes it: the petitio resolved, its stamp lines appended, and each receipt recorded in
 *  its front matter under the instant it is keyed by. */
function record(dir: string, stamps: [at: string, reply: string][], receipts: Record<string, unknown>, file = "A-1.md"): void {
  const raw = readFileSync(join(SAMPLE, "petitiones", file), "utf8");
  const front = Object.keys(receipts).length === 0 ? "" : `receipts: ${JSON.stringify(receipts)}\n`;
  const withFront = raw.replace(/\n---\n/, `\n${front}---\n`).replace(/state: \w+/, "state: resolved");
  writeFileSync(join(dir, "petitiones", file), `${withFront}${stamps.map(([at, reply]) => `\n\n[stated] ${at} patron: ${reply}`).join("")}`);
}
const receiptFindings = (dir: string) => checkStudio(dir, new Date(NOW)).findings.filter((f) => f.rule === "patron.receipt");

test("W-666-b2 check refuses a recorded Patron answer without a valid receipt", () => {
  const patron = ed();
  const agent = ed();
  const AT = "2026-11-16T02:59:00.000Z";
  const blocks = (dir: string, words: string, what: string): void => {
    const f = receiptFindings(dir);
    assert.equal(f.some((x) => x.level === "block" && x.message.includes(words)), true, what);
  };

  const valid = officina("b2-valid", [patron.pub]);
  record(valid, [[AT, "Ship both."]], { [AT]: receiptOf(patron, payload()) });
  assert.deepEqual(receiptFindings(valid), [], "a valid recorded receipt raises no finding");

  const none = officina("b2-none", [patron.pub]);
  record(none, [[AT, "Ship both."]], {});
  blocks(none, "carry no receipt", "a recorded answer with no receipt is blocked");

  const forged = officina("b2-forged", [patron.pub]);
  record(forged, [[AT, "Ship both."]], { [AT]: { ...receiptOf(patron, payload()), sig: randomBytes(64).toString("base64") } });
  blocks(forged, "signature does not verify", "a recorded forged receipt is blocked");

  const agentDir = officina("b2-agent", [patron.pub]);
  record(agentDir, [[AT, "Ship both."]], { [AT]: receiptOf(agent, payload()) });
  blocks(agentDir, "key is not a Patron key", "a recorded agent-authored receipt is blocked");

  const altered = officina("b2-altered", [patron.pub]);
  record(altered, [[AT, "Cut split stacks."]], { [AT]: receiptOf(patron, payload()) });
  blocks(altered, "is not for this answer: option", "a recorded answer altered after signing is blocked");

  const replayed = officina("b2-replay", [patron.pub]);
  const once = receiptOf(patron, payload());
  record(replayed, [[AT, "Ship both."], [NOW, "Ship both."]], { [AT]: once, [NOW]: once });
  blocks(replayed, "nonce already used", "a recorded replayed receipt is blocked");

  const stray = officina("b2-stray", [patron.pub]);
  record(stray, [[AT, "Ship both."]], { [AT]: receiptOf(patron, payload()), [NOW]: receiptOf(patron, payload()) });
  blocks(stray, "answers no stamp", "a receipt keyed by no stamp is blocked");

  // the floor: the digest of the unsigned stamps recorded before receipts
  const LEGACY = "2026-11-01T00:00:00.000Z";
  const legacy = sha([`petitiones/A-2.md\t[stated] ${LEGACY} patron: Seasonal events wait.`].sort().join("\n"));
  const floored = officina("b2-floor", [patron.pub], `  floor: "${legacy}"\n`);
  record(floored, [[LEGACY, "Seasonal events wait."]], {}, "A-2.md");
  record(floored, [[AT, "Ship both."]], { [AT]: receiptOf(patron, payload()) });
  assert.deepEqual(receiptFindings(floored), [], "an unsigned stamp under the floor needs no receipt");
  record(floored, [[LEGACY, "Seasonal events start now."]], {}, "A-2.md");
  blocks(floored, "are not the floor", "an unsigned stamp that changed under the floor is blocked");

  const open = officina("b2-open", undefined);
  record(open, [[AT, "Ship both."]], {});
  const f = receiptFindings(open);
  assert.equal(f.length === 1 && f[0]!.level === "advise", true, "an officina naming no Patron keys is told its answers are unsigned");
});

test("W-666-b3 the console's answer route forwards the receipt", async () => {
  const seen: { args: string[]; receipt?: string }[] = [];
  const noop = () => ({ exitCode: 0 });
  const noopAsync = async () => ({ exitCode: 0 });
  const runners: StartServerOptions["runners"] = {
    answer: (args) => {
      const at = args.indexOf("--receipt");
      seen.push({ args, ...(at === -1 ? {} : { receipt: readFileSync(args[at + 1]!, "utf8") }) });
      return { exitCode: 0 };
    },
    greenlight: noop,
    budget: noop,
    handoff: noop,
    talk: noopAsync,
    pause: noopAsync,
    resume: noopAsync,
    delegate: noop,
  };
  const dir = officina("b3", undefined);
  const TOKEN = "test-token-w666";
  const server = await startServer({ studioDir: dir, port: 0, once: true, now: new Date(NOW), token: TOKEN, checkStudio: () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }), runners, listModels: () => Promise.resolve([]) });
  try {
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${server.port}/api/answer`, { method: "POST", headers: { "X-Bisellium-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const receipt = receiptOf(ed(), payload());
    const r = await post({ petitio: "A-1", reply: "Ship both.", receipt });
    assert.equal(r.status, 200);
    assert.deepEqual(seen.length === 1 && seen[0]!.receipt !== undefined ? JSON.parse(seen[0]!.receipt) : undefined, receipt, "the answer route passes the receipt to answer");
    await post({ petitio: "A-1", reply: "Ship both." });
    assert.equal(seen[1]?.args.includes("--receipt"), false, "an answer posted with no receipt passes none");
    const wrong = await post({ petitio: "A-1", reply: "Ship both.", receipt: "a string" });
    assert.equal(wrong.status, 400, "a receipt that is not an object is refused");
  } finally {
    await server.close();
  }
});

// W-666 r3: every recorded-nonce source `answer` reads must read, or the answer is refused before anything is written; a
// source skipped as "spends nothing" would let its receipt be replayed.
/** An officina naming one Patron key, with `source` written into it, answered A-1 with a fresh valid receipt. */
function answerOver(tag: string, source: (dir: string) => void): { dir: string; r: { code: number; err: string } } {
  const patron = ed();
  const dir = officina(tag, [patron.pub]);
  source(dir);
  const r = answer(["--petitio", "A-1", "Ship both.", "--studio", dir, "--now", NOW, "--receipt", receiptFile(dir, receiptOf(patron, payload()))]);
  return { dir, r };
}
const A2 = (dir: string): string => join(dir, "petitiones", "A-2.md");
const A2_RAW = (): string => readFileSync(join(SAMPLE, "petitiones", "A-2.md"), "utf8");

test("W-666-b4 answer refuses when a recorded-nonce source does not read", () => {
  const timelineOf = (text: string) => (d: string): void => {
    mkdirSync(join(d, "timeline"), { recursive: true });
    writeFileSync(join(d, "timeline", "patron.jsonl"), text);
  };
  const { dir, r } = answerOver("b4", timelineOf('{"role":"patron"}\n{not json\n'));
  assert.equal(r.code === 2 && r.err.includes("answer refused: timeline/patron.jsonl line 2 does not parse"), true, "a malformed timeline line refuses the answer");
  assert.equal(petitio(dir), A1_BODY_RAW(), "a malformed timeline line leaves the petitio untouched");
  const shape = answerOver("b4-shape", timelineOf('{"role":"patron","receipt":{"payload":{}}}\n'));
  assert.equal(shape.r.code === 2 && shape.r.err.includes("timeline/patron.jsonl line 1: patron receipt shape"), true, "a timeline receipt of the wrong shape refuses the answer");
  const front = answerOver("b4-front", (d) => writeFileSync(A2(d), "---\nid: A-2\nstate: [unclosed\n---\nA question.\n"));
  assert.equal(front.r.code === 2 && front.r.err.includes("answer refused: petitiones/A-2.md front matter does not parse as a mapping"), true, "a malformed petitio front refuses the answer");
  assert.equal(petitio(front.dir), A1_BODY_RAW(), "a malformed petitio front leaves the petitio untouched");
  const list = answerOver("b4-list", (d) => writeFileSync(A2(d), A2_RAW().replace("\n---\n", "\nreceipts: [one, two]\n---\n")));
  assert.equal(list.r.code === 2 && list.r.err.includes("answer refused: petitiones/A-2.md receipts must be a mapping"), true, "a non-mapping receipts refuses the answer");
  const recorded = answerOver("b4-recorded", (d) => writeFileSync(A2(d), A2_RAW().replace("\n---\n", '\nreceipts: { "2026-11-01T00:00:00.000Z": { key: x } }\n---\n')));
  assert.equal(recorded.r.code === 2 && recorded.r.err.includes("petitiones/A-2.md receipt 2026-11-01T00:00:00.000Z: patron receipt shape"), true, "a recorded receipt of the wrong shape refuses the answer");
});

// Fix round 1 (review-1 #1): the check and the write of one answer are atomic across processes. A lock the officina's
// timeline/ holds names its owner's pid: a live owner keeps a second answer out (it is refused by name, writing nothing),
// a dead owner's lock is taken over.
const LOCK = (dir: string): string => join(dir, "timeline", ".answer.lock");
test("W-666-b4 a second answer is refused while another process holds the answer lock", () => {
  const live = answerOver("b4-lock", (d) => {
    mkdirSync(join(d, "timeline"), { recursive: true });
    writeFileSync(LOCK(d), `${process.pid}\n`);
  });
  assert.equal(live.r.code === 2 && live.r.err.includes("answer refused: another answer is in progress"), true, "a live lock refuses the answer by name");
  assert.equal(petitio(live.dir), A1_BODY_RAW(), "a refused answer leaves the petitio untouched");
  assert.equal(timeline(live.dir), "", "a refused answer writes no timeline line");
  const dead = spawnSync(process.execPath, ["-e", "0"]);
  const stale = answerOver("b4-stale", (d) => {
    mkdirSync(join(d, "timeline"), { recursive: true });
    writeFileSync(LOCK(d), `${dead.pid}\n`);
  });
  assert.equal(stale.r.code, 0, "a dead owner's lock is taken over");
  assert.equal(existsSync(LOCK(stale.dir)), false, "the lock is released when the answer returns");
});

// two processes answer the one petitio with the one receipt, released together: at most one is accepted, the petitio
// holds one stamp and the timeline one line.
test("W-666-b4 two processes replaying one receipt accept at most one", async () => {
  const patron = ed();
  const dir = officina("b4-race", [patron.pub]);
  const receipt = receiptFile(dir, receiptOf(patron, payload()));
  const barrier = join(`${dir}-receipts`, "go");
  const writes = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "commands", "src", "writes.ts");
  const code = `import { existsSync } from "node:fs"; const { runAnswer } = await import(${JSON.stringify(pathToFileURL(writes).href)}); while (!existsSync(${JSON.stringify(barrier)})) {} process.exit(runAnswer(JSON.parse(process.argv[1])).exitCode);`;
  const args = JSON.stringify(["--petitio", "A-1", "Ship both.", "--studio", dir, "--now", NOW, "--receipt", receipt]);
  const run = (): Promise<number> => new Promise((done) => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, args], { stdio: "ignore" }).on("close", (c) => done(c ?? -1)));
  const both = [run(), run()];
  await new Promise((r) => setTimeout(r, 2500));
  writeFileSync(barrier, "");
  const codes = (await Promise.all(both)).sort();
  assert.deepEqual(codes, [0, 2], "two processes replaying one receipt accept at most one");
  assert.equal((petitio(dir).match(/\[stated\]/g) ?? []).length, 1, "the petitio holds one stamp");
  assert.equal(timeline(dir).trim().split("\n").length, 1, "the timeline holds one line");
});

// D-086 A (spec review round 4, finding 1): only an absent timeline is no timeline; one that cannot be read (here `timeline`
// is a file, so lstat of timeline/patron.jsonl fails with ENOTDIR) refuses the answer with the reader's own reason, never
// the generic `answer failed`.
test("W-666-b4 an inaccessible timeline refuses with the reader's reason", () => {
  const { dir, r } = answerOver("b4-inaccessible", (d) => writeFileSync(join(d, "timeline"), "not a directory\n"));
  assert.equal(r.code === 2 && r.err.includes("answer refused: timeline/patron.jsonl:"), true, "an inaccessible timeline gives the reader's refusal");
  assert.equal(r.err.includes("answer failed"), false, "an inaccessible timeline is not the generic answer failed");
  assert.equal(petitio(dir), A1_BODY_RAW(), "an inaccessible timeline leaves the petitio untouched");
});

// W-666 r3: with keys named, a petitio source `check` cannot read blocks; a skipped one could hide an unsigned stamp.
test("W-666-b5 check blocks a petitio source it cannot read", () => {
  const dir = officina("b5", [ed().pub]);
  const outside = `${dir}-outside.md`;
  dirs.push(outside);
  writeFileSync(outside, `${A2_RAW()}\n\n[stated] 2026-11-16T02:59:00.000Z patron: Seasonal events wait.`);
  rmSync(A2(dir));
  symlinkSync(outside, A2(dir));
  const f = receiptFindings(dir);
  assert.equal(f.some((x) => x.level === "block" && x.where === "petitiones/A-2.md" && x.message.includes("is not a contained regular readable file")), true, "a symlinked petitio is blocked");
  const flat = officina("b5-flat", [ed().pub]);
  rmSync(join(flat, "petitiones"), { recursive: true });
  writeFileSync(join(flat, "petitiones"), "not a directory\n");
  assert.equal(receiptFindings(flat).some((x) => x.level === "block" && x.message.includes("petitiones/ is not listable")), true, "an unlistable petitiones directory is blocked");
});

// W-666 r3: the route's two response classes, through the real `answer`: 400 for a body of the wrong shape, and HTTP 200
// `{ ok: false, exitCode: 2, output }` for a verifier refusal; neither writes.
async function serveAnswer(dir: string, fn: (post: (body: unknown) => Promise<Response>) => Promise<void>): Promise<void> {
  const noop = () => ({ exitCode: 0 });
  const noopAsync = async () => ({ exitCode: 0 });
  const runners: StartServerOptions["runners"] = { answer: (args) => runAnswer(args), greenlight: noop, budget: noop, handoff: noop, talk: noopAsync, pause: noopAsync, resume: noopAsync, delegate: noop };
  const TOKEN = "test-token-w666";
  const server = await startServer({ studioDir: dir, port: 0, once: true, now: new Date(NOW), token: TOKEN, checkStudio: () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }), runners, listModels: () => Promise.resolve([]) });
  try {
    await fn((body) => fetch(`http://127.0.0.1:${server.port}/api/answer`, { method: "POST", headers: { "X-Bisellium-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  } finally {
    await server.close();
  }
}

test("W-666-b6 the answer route answers 400 for a body-shape error and 200 ok false for a refusal", async () => {
  const dir = officina("b6", [ed().pub]);
  await serveAnswer(dir, async (post) => {
    const r = await post({ petitio: "A-1", reply: "Ship both.", receipt: "a string" });
    const body = (await r.json()) as { error?: string };
    assert.deepEqual([r.status, body.error], [400, "receipt must be an object"], "a body-shape error answers 400");
    assert.equal(petitio(dir), A1_BODY_RAW(), "a body-shape error writes nothing");
    const refused = await post({ petitio: "A-1", reply: "Ship both.", receipt: receiptOf(ed(), payload()) });
    const out = (await refused.json()) as { ok?: boolean; exitCode?: number; output?: string };
    assert.deepEqual([refused.status, out.ok, out.exitCode, out.output?.includes("answer refused: patron receipt key is not a Patron key")], [200, false, 2, true], "a verifier refusal is HTTP 200 with ok false and exit 2");
    assert.equal(petitio(dir), A1_BODY_RAW(), "a verifier refusal writes nothing");
  });
});
