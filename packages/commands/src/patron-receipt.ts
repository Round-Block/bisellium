/**
 * packages/commands/src/patron-receipt.ts — W-666: a Patron answer is authorized by a receipt the Patron signed, never by
 * the role a process claims. A receipt binds one answer: the petitio id, the digest of the question as it stood, the named
 * option (the reply), the mode (resolve or ask-back), the charter-gap flag, a nonce and a time. It verifies against a
 * public key `bisellium.yml` names under `patron_receipts.keys` (a code-owned file: a change to it needs the Patron's
 * review), Ed25519 or ECDSA P-256, by node:crypto alone. The private key and the signer live with the Patron, outside the
 * agent clone and its read set; nothing here signs.
 *
 * Where it is recorded: the petitio's own front matter, `receipts: { <stamp instant>: <receipt> }`, keyed by the instant of
 * the `[stated] <instant> <patron>: <reply>` line the answer appends, so the committed record carries its proof (the
 * timeline is local and gitignored); the timeline line carries a copy.
 *
 * Readers: `runAnswer` (writes.ts, the write path) and the `patron.receipt` rule (packages/cli/src/rules/receipts.ts).
 */
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { instant } from "@bisellium/schema";
import { splitFront } from "./frontmatter.js";
import { readContainedRegularFile } from "./opus-model.js";

/** The first line of the signed bytes: a receipt signs this domain, never a bare payload another protocol could reuse. */
export const RECEIPT_DOMAIN = "bisellium-patron-receipt/v1";
/** How far a receipt's time may sit before the answer it authorizes (and after it: a minute of clock skew). */
export const RECEIPT_WINDOW_MS = 15 * 60_000;
const SKEW_MS = 60_000;
/** A receipt file's most bytes (the write path reads one from a Patron-named path). */
export const RECEIPT_MAX_BYTES = 64 * 1024;

export interface ReceiptPayload {
  v: 1;
  petitio: string;
  question: string;
  option: string;
  mode: "resolve" | "ask-back";
  charter_gap: boolean;
  nonce: string;
  at: string;
}
export interface Receipt {
  payload: ReceiptPayload;
  key: string;
  sig: string;
}
/** What one answer is, as the receipt must bind it. */
export interface AnswerFacts {
  petitio: string;
  question: string;
  option: string;
  mode: "resolve" | "ask-back";
  charter_gap: boolean;
}
export interface ReceiptPolicy {
  keys: Map<string, KeyObject>;
  /** sha256 (hex) of the officina's unsigned Patron stamps as `unsignedDigest` lists them: the answers recorded before receipts. */
  floor?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{32,128}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The digest of a petitio's question: sha256 (hex) of its body, front matter excluded, trimmed, as UTF-8. */
export function questionDigest(body: string): string {
  return createHash("sha256").update(body.trim(), "utf8").digest("hex");
}

/** The bytes a receipt signs: the domain line, then the payload's fields as one JSON array in fixed order. */
export function receiptBytes(p: ReceiptPayload): Buffer {
  return Buffer.from(`${RECEIPT_DOMAIN}\n${JSON.stringify([p.v, p.petitio, p.question, p.option, p.mode, p.charter_gap, p.nonce, p.at])}`, "utf8");
}

/** A key's id: sha256 (hex) of its SPKI DER. */
export function keyId(key: KeyObject): string {
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

/** The officina's receipt policy from its manifest: undefined when `patron_receipts` is absent (no keys named), an error
 *  for any other shape than `{ keys: [<base64 SPKI DER>, …], floor?: <64 lowercase hex> }`, or a key that is not Ed25519
 *  or ECDSA P-256. */
export function readReceiptPolicy(manifest: unknown): ReceiptPolicy | { error: string } | undefined {
  const raw = (manifest as Record<string, unknown> | null | undefined)?.["patron_receipts"];
  if (raw === undefined) return undefined;
  const bad = (why: string) => ({ error: `bisellium.yml patron_receipts ${why}` });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return bad("must be a mapping with a keys list");
  const { keys, floor, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return bad(`has an unknown key: ${Object.keys(rest)[0]}`);
  if (!Array.isArray(keys) || keys.length === 0) return bad("keys must be a non-empty list");
  const map = new Map<string, KeyObject>();
  for (const [i, k] of keys.entries()) {
    if (typeof k !== "string" || k.length === 0 || !BASE64.test(k)) return bad(`keys[${i}] must be a base64 SPKI DER public key`);
    let key: KeyObject;
    try {
      key = createPublicKey({ key: Buffer.from(k, "base64"), format: "der", type: "spki" });
    } catch {
      return bad(`keys[${i}] does not parse as a public key`);
    }
    const ec = key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
    if (key.asymmetricKeyType !== "ed25519" && !ec) return bad(`keys[${i}] is not an Ed25519 or ECDSA P-256 key`);
    map.set(keyId(key), key);
  }
  if (floor === undefined) return { keys: map };
  if (typeof floor !== "string" || !HEX64.test(floor)) return bad("floor must be 64 lowercase hex digits");
  return { keys: map, floor };
}

/** One Patron stamp line of a petitio body: `\n\n[stated] <instant> <patron>: <reply>`, as `runAnswer` appends it. */
export interface Stamp {
  /** the stamp's instant, as written */
  at: string;
  /** the body's offset of the stamp's leading blank line: the question is the body before it */
  index: number;
  /** the stamp line, from `[stated]` to its line's end */
  line: string;
  /** the text after `<patron>: `, to the end of the body */
  rest: string;
}
/** Every Patron stamp of `body`, in order. */
export function patronStamps(body: string, patronId: string): Stamp[] {
  const marker = `\n\n[stated] `;
  const out: Stamp[] = [];
  for (let i = body.indexOf(marker); i !== -1; i = body.indexOf(marker, i + 1)) {
    const after = body.slice(i + 2);
    const m = /^\[stated\] (\S+) /.exec(after);
    if (m === null || !after.startsWith(`${m[0]}${patronId}: `)) continue;
    const head = `${m[0]}${patronId}: `;
    const end = after.indexOf("\n");
    out.push({ at: m[1]!, index: i, line: end === -1 ? after : after.slice(0, end), rest: after.slice(head.length) });
  }
  return out;
}
/** The reply a stamp records, as a receipt's option is compared with it: the option itself when the stamp's text opens with
 *  it and then ends or breaks a line, else the stamp's first line. */
export function stampedReply(stamp: Stamp, option: string): string {
  const r = stamp.rest;
  return r.startsWith(option) && (r.length === option.length || r[option.length] === "\n") ? option : (r.split("\n")[0] ?? "");
}
/** The digest a floor fixes: sha256 (hex) of the unsigned stamps, each `<petitio file>\t<stamp line>`, sorted, one per line. */
export function unsignedDigest(unsigned: readonly string[]): string {
  return createHash("sha256").update([...unsigned].sort().join("\n"), "utf8").digest("hex");
}
/** A petitio front matter's `receipts` mapping (stamp instant to raw receipt): empty when absent, an error when not a mapping. */
export function recordedReceipts(front: unknown): Map<string, unknown> | { error: string } {
  const raw = (front as Record<string, unknown> | null | undefined)?.["receipts"];
  if (raw === undefined) return new Map();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { error: "receipts must be a mapping of stamp instant to receipt" };
  return new Map(Object.entries(raw as Record<string, unknown>));
}

/** A receipt from parsed JSON, or the first field whose shape is wrong. */
export function parseReceipt(raw: unknown): Receipt | { error: string } {
  const bad = (field: string) => ({ error: `patron receipt shape: ${field}` });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return bad("receipt");
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== "key,payload,sig") return bad("receipt keys");
  if (typeof r["key"] !== "string" || !HEX64.test(r["key"])) return bad("key");
  if (typeof r["sig"] !== "string" || r["sig"].length === 0 || !BASE64.test(r["sig"])) return bad("sig");
  const p = r["payload"];
  if (p === null || typeof p !== "object" || Array.isArray(p)) return bad("payload");
  const q = p as Record<string, unknown>;
  if (Object.keys(q).sort().join() !== "at,charter_gap,mode,nonce,option,petitio,question,v") return bad("payload keys");
  if (q["v"] !== 1) return bad("v");
  if (typeof q["petitio"] !== "string" || q["petitio"].length === 0) return bad("petitio");
  if (typeof q["question"] !== "string" || !HEX64.test(q["question"])) return bad("question");
  if (typeof q["option"] !== "string" || q["option"].trim().length === 0) return bad("option");
  if (q["mode"] !== "resolve" && q["mode"] !== "ask-back") return bad("mode");
  if (typeof q["charter_gap"] !== "boolean") return bad("charter_gap");
  if (typeof q["nonce"] !== "string" || !NONCE.test(q["nonce"])) return bad("nonce");
  if (typeof q["at"] !== "string" || !ISO.test(q["at"]) || instant(q["at"])?.toISOString() !== q["at"]) return bad("at");
  return r as unknown as Receipt;
}

/** Why a receipt does not authorize this answer at `now`, or undefined: its key is not a Patron key, its signature does not
 *  verify, its nonce is spent, it binds another answer, or its time is outside the window. In that order. */
export function receiptProblem(receipt: Receipt, policy: ReceiptPolicy, facts: AnswerFacts, now: Date, usedNonces: ReadonlySet<string>): string | undefined {
  const key = policy.keys.get(receipt.key);
  if (key === undefined) return "patron receipt key is not a Patron key";
  const sig = Buffer.from(receipt.sig, "base64");
  let ok = false;
  try {
    ok =
      key.asymmetricKeyType === "ed25519"
        ? cryptoVerify(null, receiptBytes(receipt.payload), key, sig)
        : cryptoVerify("sha256", receiptBytes(receipt.payload), { key, dsaEncoding: "ieee-p1363" }, sig);
  } catch {
    ok = false;
  }
  if (!ok) return "patron receipt signature does not verify";
  if (usedNonces.has(receipt.payload.nonce)) return "patron receipt nonce already used";
  const p = receipt.payload;
  for (const field of ["petitio", "question", "option", "mode", "charter_gap"] as const)
    if (p[field] !== facts[field]) return `patron receipt is not for this answer: ${field}`;
  const at = instant(p.at)?.getTime();
  if (at === undefined || at > now.getTime() + SKEW_MS || now.getTime() - at > RECEIPT_WINDOW_MS) return "patron receipt time is outside the 15-minute window before the answer";
  return undefined;
}

/** One petitio as the receipt readers take it: its officina path, id, body (front matter excluded) and recorded receipts. */
export interface PetitioReceipts {
  where: string;
  id: string;
  body: string;
  receipts: Map<string, unknown>;
}
/** A recorded-receipt source that does not read: its officina path and why. */
export interface SourceProblem {
  where: string;
  message: string;
}
/** W-666 r3: every `.md` entry of `petitiones/`, sorted, read for its stamps and receipts. No source is skipped: a
 *  `petitiones/` that is not a real, listable directory, an entry that is not a contained, regular, readable file, front
 *  matter that is absent, does not parse or is not a mapping, and `receipts` that is not a mapping are each a problem. */
export function readPetitioReceipts(root: string): { records: PetitioReceipts[]; problems: SourceProblem[] } {
  const records: PetitioReceipts[] = [];
  const problems: SourceProblem[] = [];
  let names: string[];
  try {
    const st = lstatSync(join(root, "petitiones"));
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("not a real directory");
    names = readdirSync(join(root, "petitiones")).filter((n) => n.endsWith(".md")).sort();
  } catch (e) {
    return { records, problems: [{ where: "petitiones/", message: `petitiones/ is not listable: ${(e as Error).message}` }] };
  }
  for (const name of names) {
    const where = `petitiones/${name}`;
    const file = readContainedRegularFile(root, where, "petitiones");
    if ("error" in file) {
      problems.push({ where, message: `${where} is not a contained regular readable file: ${file.error}` });
      continue;
    }
    const split = splitFront(file.bytes.toString("utf8"));
    let front: unknown;
    try {
      const doc = split === undefined ? undefined : parseDocument(split.front);
      front = doc === undefined || doc.errors.length > 0 ? undefined : doc.toJS();
    } catch {
      front = undefined;
    }
    if (split === undefined || front === null || typeof front !== "object" || Array.isArray(front)) {
      problems.push({ where, message: `${where} front matter does not parse as a mapping` });
      continue;
    }
    const receipts = recordedReceipts(front);
    if ("error" in receipts) {
      problems.push({ where, message: `${where} ${receipts.error}` });
      continue;
    }
    records.push({ where, id: name.slice(0, -".md".length), body: split.body, receipts });
  }
  return { records, problems };
}

/** W-666 r3: the nonces recorded receipts have spent, in the timeline's JSON lines (`receipt`) and in each petitio's
 *  `receipts`; or the first source that does not read: a timeline line that does not parse or is not an object, and a
 *  recorded receipt (a line's `receipt`, a `receipts` value) of the wrong shape. Nothing is skipped. */
export function spentNonces(timeline: string, records: readonly Pick<PetitioReceipts, "where" | "receipts">[]): Set<string> | { error: string } {
  const out = new Set<string>();
  for (const [i, line] of timeline.split("\n").entries()) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return { error: `timeline/patron.jsonl line ${i + 1} does not parse` };
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return { error: `timeline/patron.jsonl line ${i + 1} is not an object` };
    const raw = (entry as Record<string, unknown>)["receipt"];
    if (raw === undefined) continue;
    const r = parseReceipt(raw);
    if ("error" in r) return { error: `timeline/patron.jsonl line ${i + 1}: ${r.error}` };
    out.add(r.payload.nonce);
  }
  for (const rec of records)
    for (const [at, raw] of rec.receipts) {
      const r = parseReceipt(raw);
      if ("error" in r) return { error: `${rec.where} receipt ${at}: ${r.error}` };
      out.add(r.payload.nonce);
    }
  return out;
}
