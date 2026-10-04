/**
 * W-096's native-officina model and policy seam.
 *
 * This module is intentionally read-only.  Writers call it before mutation;
 * `check` translates its structured problems to findings; `verify` reuses the
 * same effective-gate and pinned-baseline predicates.  External adapters keep
 * their permissive `Opus.kind: string` contract.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import { NATIVE_OPUS_KINDS, type NativeOpusKind } from "@bisellium/schema";
import type { Manifest } from "@bisellium/adapter-native";
import { splitFront } from "./frontmatter.js";

export type OpusModelRule =
  | "opus.kind"
  | "opus.title"
  | "opus.arc"
  | "opus.parent"
  | "opus.dates"
  | "opus.dates.order"
  | "opus.reference"
  | "opus.ui.route"
  | "opus.ui.design"
  | "opus.ui.e2e"
  | "opus.ui.rulings"
  | "opus.records_unchanged";

export interface OpusModelProblem {
  rule: OpusModelRule;
  message: string;
  level?: "block" | "advise";
}

export type NativeRecord = Record<string, unknown> & {
  id?: unknown;
  title?: unknown;
  kind?: unknown;
  state?: unknown;
  spec?: unknown;
  arc?: unknown;
  parent?: unknown;
  start?: unknown;
  end?: unknown;
  ui_rulings?: unknown;
  probationes?: unknown;
};

export interface NativeRecordEntry {
  path: string;
  data: NativeRecord;
}

const OPUS_ID = /^W-[0-9]+$/;
const DECISION_ID = /^D-[0-9]{3,}$/;
const TREE_CERTIFICATE = /^tree:[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UTC_PROFILE = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{3}))?Z$/;

export const PROMPT_SHINGLE_WORDS = 4;
export const PROMPT_MAX_OVERLAP = 0.3;
export const PROMPT_MIN_NOVEL_SHINGLES = 12;

const NATIVE_KIND_SET = new Set<string>(NATIVE_OPUS_KINDS);

export function isNativeOpusKind(value: unknown): value is NativeOpusKind {
  return typeof value === "string" && NATIVE_KIND_SET.has(value);
}

/** D-014's sole review gate is the magister of the manifest's QA collegium. */
export function censorSella(manifest: Pick<Manifest, "collegia">): string | undefined {
  const qa = manifest.collegia.find((collegium) => collegium.id === "qa");
  return typeof qa?.magister === "string" && qa.magister.length > 0 ? qa.magister : undefined;
}

/** Frozen W-096 set, deliberately independent of the runtime's Unicode data. */
export function titleProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return "title must be a nonblank string";
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (
      cp <= 0x1f ||
      (cp >= 0x7f && cp <= 0x9f) ||
      cp === 0x2028 ||
      cp === 0x2029 ||
      cp === 0x00ad ||
      (cp >= 0x0600 && cp <= 0x0605) ||
      cp === 0x061c ||
      cp === 0x06dd ||
      cp === 0x070f ||
      (cp >= 0x0890 && cp <= 0x0891) ||
      cp === 0x08e2 ||
      cp === 0x180e ||
      (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2060 && cp <= 0x2064) ||
      (cp >= 0x2066 && cp <= 0x206f) ||
      cp === 0xfeff ||
      (cp >= 0xfff9 && cp <= 0xfffb) ||
      cp === 0x110bd ||
      cp === 0x110cd ||
      (cp >= 0x13430 && cp <= 0x1343f) ||
      (cp >= 0x1bca0 && cp <= 0x1bca3) ||
      (cp >= 0x1d173 && cp <= 0x1d17a) ||
      cp === 0xe0001 ||
      (cp >= 0xe0020 && cp <= 0xe007f)
    )
      return `title contains forbidden control U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return undefined;
}

function leap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function utcTimestampProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return "must be a string in the exact UTC timestamp profile";
  const match = UTC_PROFILE.exec(value);
  if (!match) return "must match YYYY-MM-DDTHH:MM:SS[.sss]Z";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0) return "year 0000 is not valid";
  const lengths = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > lengths[month - 1]!) return "date is not a real Gregorian calendar day";
  return undefined;
}

export function exactUtcTimestamp(date: Date): string {
  return date.toISOString();
}

function instant(value: string): number {
  // The caller has already applied UTC_PROFILE and Gregorian validation.
  // Date.parse is used only for ordering, including years 0001-0099 (which
  // Date.UTC's numeric overload incorrectly biases into the 1900s).
  return Date.parse(value);
}

/** Validate kind/title/date/hierarchy from already-parsed native records. */
export function validateNativeRecord(record: NativeRecord, records: ReadonlyMap<string, NativeRecord> = new Map()): OpusModelProblem[] {
  const problems: OpusModelProblem[] = [];
  if (!isNativeOpusKind(record.kind)) problems.push({ rule: "opus.kind", message: `kind ${JSON.stringify(record.kind)} is not a native opus kind` });
  const title = titleProblem(record.title);
  if (title) problems.push({ rule: "opus.title", message: title });

  const startProblem = record.start === undefined ? undefined : utcTimestampProblem(record.start);
  const endProblem = record.end === undefined ? undefined : utcTimestampProblem(record.end);
  if (startProblem) problems.push({ rule: "opus.dates", message: `start ${startProblem}` });
  if (endProblem) problems.push({ rule: "opus.dates", message: `end ${endProblem}` });
  if (record.end !== undefined && record.state !== "done") problems.push({ rule: "opus.dates", message: "end is valid only when state is done" });
  if (!startProblem && !endProblem && typeof record.start === "string" && typeof record.end === "string" && instant(record.end) < instant(record.start))
    problems.push({ rule: "opus.dates.order", message: "end precedes start" });

  const id = typeof record.id === "string" ? record.id : undefined;
  const kind = isNativeOpusKind(record.kind) ? record.kind : undefined;
  const arc = record.arc;
  const parent = record.parent;
  if (record.ui_rulings !== undefined && kind !== "ui")
    problems.push({ rule: "opus.ui.rulings", message: "ui_rulings is permitted only on ui records" });

  if (kind === "arc") {
    if (arc !== undefined) problems.push({ rule: "opus.arc", message: "an arc cannot itself name an arc" });
    if (parent !== undefined) problems.push({ rule: "opus.parent", message: "an arc cannot name a parent" });
  } else if (arc !== undefined) {
    if (typeof arc !== "string" || !OPUS_ID.test(arc)) problems.push({ rule: "opus.arc", message: "arc must be a local opus id" });
    else {
      const target = records.get(arc);
      if (!target) problems.push({ rule: "opus.arc", message: `arc ${arc} does not resolve in this officina` });
      else if (target.kind !== "arc") problems.push({ rule: "opus.arc", message: `arc ${arc} does not name an arc record` });
      if (arc === id) problems.push({ rule: "opus.arc", message: "an opus cannot be its own arc" });
    }
  }

  if (kind === "subtask") {
    if (typeof parent !== "string" || !OPUS_ID.test(parent)) problems.push({ rule: "opus.parent", message: "a subtask requires a local parent opus id" });
    else {
      const target = records.get(parent);
      if (!target) problems.push({ rule: "opus.parent", message: `parent ${parent} does not resolve in this officina` });
      else if (target.kind === "arc" || target.kind === "subtask") problems.push({ rule: "opus.parent", message: `parent ${parent} must be a non-arc, non-subtask opus` });
      else {
        const parentArc = typeof target.arc === "string" ? target.arc : undefined;
        if (arc !== undefined && arc !== parentArc)
          problems.push({ rule: "opus.arc", message: parentArc ? `subtask arc must equal its parent's arc ${parentArc}` : "subtask cannot introduce an arc its parent does not have" });
      }
      if (parent === id) problems.push({ rule: "opus.parent", message: "a subtask cannot be its own parent" });
    }
  } else if (parent !== undefined) {
    problems.push({ rule: "opus.parent", message: "parent is permitted only on subtask records" });
  }
  return problems;
}

export interface ContainedFile {
  absolute: string;
  relative: string;
  bytes: Buffer;
  mode: number;
}

/**
 * Resolve a studio-relative regular file without following a symlink in any
 * path component. `expectedDir` is the required first component.
 */
export function readContainedRegularFile(root: string, relPath: string, expectedDir: string): ContainedFile | { error: string; code?: string } {
  if (typeof relPath !== "string" || relPath.length === 0 || isAbsolute(relPath)) return { error: "path must be a nonempty officina-relative string" };
  try {
    const rootReal = realpathSync(resolve(root));
    const lexical = resolve(rootReal, relPath);
    const rel = relative(rootReal, lexical);
    const parts = rel.split(sep);
    if (isAbsolute(rel) || parts[0] === ".." || parts[0] !== expectedDir) return { error: `path must remain under ${expectedDir}/` };
    let cursor = rootReal;
    for (const part of parts) {
      cursor = join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) return { error: "path reaches its target through a symlink" };
    }
    const parentReal = realpathSync(resolve(lexical, ".."));
    const parentRel = relative(rootReal, parentReal);
    if (isAbsolute(parentRel) || parentRel.split(sep)[0] === ".." || parentRel.split(sep)[0] !== expectedDir)
      return { error: `real parent escapes ${expectedDir}/` };
    const fd = openSync(lexical, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile()) return { error: "target is not a regular file" };
      const real = realpathSync(lexical);
      const realRel = relative(rootReal, real);
      if (isAbsolute(realRel) || realRel.split(sep)[0] === ".." || realRel.split(sep)[0] !== expectedDir)
        return { error: `real target escapes ${expectedDir}/` };
      return { absolute: lexical, relative: parts.join("/"), bytes: readFileSync(fd), mode: opened.mode };
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { error: (error as Error).message, ...(code === undefined ? {} : { code }) };
  }
}

export interface LoadedNativeRecords {
  entries: NativeRecordEntry[];
  records: Map<string, NativeRecord>;
  problems: { where: string; problem: OpusModelProblem }[];
}

export function loadNativeRecords(root: string): LoadedNativeRecords {
  const entries: NativeRecordEntry[] = [];
  const records = new Map<string, NativeRecord>();
  const problems: LoadedNativeRecords["problems"] = [];
  let names: string[] = [];
  try {
    names = readdirSync(join(root, "opera")).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return { entries, records, problems };
  }
  for (const name of names) {
    const rel = `opera/${name}`;
    const contained = readContainedRegularFile(root, rel, "opera");
    if ("error" in contained) {
      problems.push({ where: rel, problem: { rule: "opus.reference", message: contained.error } });
      continue;
    }
    const split = splitFront(contained.bytes.toString("utf8"));
    if (!split) continue;
    const doc = parseDocument(split.front);
    if (doc.errors.length) continue;
    const value = doc.toJS() as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const data = value as NativeRecord;
    for (const field of ["start", "end"] as const) {
      if (data[field] === undefined) continue;
      const node = doc.get(field, true);
      if (!isScalar(node) || typeof node.value !== "string")
        problems.push({ where: rel, problem: { rule: "opus.dates", message: `${field} must be a direct YAML string scalar` } });
    }
    entries.push({ path: contained.relative, data });
    if (typeof data.id === "string") records.set(data.id, data);
  }
  return { entries, records, problems };
}

export interface EffectiveProbatio {
  id: string;
  name: string;
  kind: string;
  command?: string;
  since?: unknown;
}

export function effectiveProbationes(kind: unknown, declared: readonly EffectiveProbatio[]): { probationes: EffectiveProbatio[]; problems: OpusModelProblem[] } {
  const probationes = declared.map((gate) => ({ ...gate }));
  const problems: OpusModelProblem[] = [];
  if (kind !== "ui") return { probationes, problems };
  const existing = probationes.find((gate) => gate.id === "served-e2e");
  if (existing) {
    if (existing.kind !== "automated" || existing.command !== "node scripts/served-e2e.mjs")
      problems.push({ rule: "opus.ui.e2e", message: 'manifest gate "served-e2e" must be automated with command "node scripts/served-e2e.mjs"' });
  } else {
    probationes.push({ id: "served-e2e", name: "Served e2e", kind: "automated", command: "node scripts/served-e2e.mjs" });
  }
  return { probationes, problems };
}

/**
 * W-129: is the review gate's failure still current? Fails closed: `true` (the
 * failure blocks) whenever the review gate is `failed`, unless the failure is
 * PROVEN to be of an older tree. `record` is the raw front matter as it is on
 * disk (check) or as it will be after this run's write (verify). The proof
 * needs all of: a non-empty `automatedIds`, a review log read through the
 * containment helper whose verdict header names this opus once and carries one
 * well-formed `tree:` value, every automated gate certifying a well-formed
 * `tree:` of its own, and none of those equal to the log's. `false` for a gate
 * that is not `failed`.
 */
export function reviewFailedAtCertifiedTree(
  root: string,
  record: Record<string, unknown>,
  ctx: { reviewId: string; automatedIds: readonly string[] },
): boolean {
  const gates = record["probationes"];
  if (typeof gates !== "object" || gates === null || Array.isArray(gates)) return false;
  const gate = (gates as Record<string, unknown>)[ctx.reviewId];
  if (typeof gate !== "object" || gate === null || (gate as Record<string, unknown>)["status"] !== "failed") return false;
  if (ctx.automatedIds.length === 0 || typeof record["id"] !== "string") return true;
  const evidence = (gate as Record<string, unknown>)["evidence"];
  if (typeof evidence !== "string") return true;
  const log = readContainedRegularFile(root, evidence, "ci");
  if ("error" in log) return true;
  const text = log.bytes.toString("utf8");
  const header = parseVerdictHeader(text);
  if (header.duplicates.includes("tree") || header.duplicates.includes("opus")) return true;
  if (header.values.get("opus") !== record["id"]) return true;
  const logged = header.values.get("tree");
  if (logged === undefined || !TREE_CERTIFICATE.test(logged)) return true;
  // The ladder (next.ts) reads the header with a looser parser. A line the strict header stopped at that the loose
  // one would still read could carry a later `tree`: not a proof, so the failure stands.
  const stoppedAt = text.split(/\r?\n/)[header.values.size + header.duplicates.length];
  if (stoppedAt !== undefined && /^#\s*[A-Za-z_]+:/.test(stoppedAt)) return true;
  for (const id of ctx.automatedIds) {
    const own = (gates as Record<string, unknown>)[id];
    const certifies = typeof own === "object" && own !== null ? (own as Record<string, unknown>)["certifies"] : undefined;
    if (typeof certifies !== "string" || !TREE_CERTIFICATE.test(certifies) || certifies === logged) return true;
  }
  return false;
}

export function designDigest(title: string, briefBytes: Buffer): string {
  const domain = Buffer.from("W-096/ui-design/v1\0", "ascii");
  const titleBytes = Buffer.from(title, "utf8");
  const length = (n: number): Buffer => {
    const out = Buffer.alloc(8);
    out.writeBigUInt64BE(BigInt(n));
    return out;
  };
  return `sha256:${createHash("sha256").update(domain).update(length(titleBytes.length)).update(titleBytes).update(length(briefBytes.length)).update(briefBytes).digest("hex")}`;
}

/**
 * Unicode 17 default full folding after NFKC.  Node 25 embeds Unicode 17
 * simple/default casing; the explicit C/F exceptions below are the mappings
 * that differ from ordinary lowercase after compatibility normalization.
 * Unmapped code points map to themselves and Turkic T mappings are excluded.
 */
const FULL_FOLD_SEED = new Map<string, string>([
  ["ß", "ss"], ["ẞ", "ss"], ["İ", "i\u0307"], ["ı", "ı"], ["ſ", "s"], ["ς", "σ"],
  ["ŉ", "ʼn"], ["ǰ", "j\u030c"], ["ΐ", "ι\u0308\u0301"], ["ΰ", "υ\u0308\u0301"],
  ["և", "եւ"], ["և", "եւ"], ["ﬓ", "մն"], ["ﬔ", "մե"], ["ﬕ", "մի"], ["ﬖ", "վն"], ["ﬗ", "մխ"],
  ["ᾀ", "ἀι"], ["ᾁ", "ἁι"], ["ᾂ", "ἂι"], ["ᾃ", "ἃι"], ["ᾄ", "ἄι"], ["ᾅ", "ἅι"], ["ᾆ", "ἆι"], ["ᾇ", "ἇι"],
  ["ᾐ", "ἠι"], ["ᾑ", "ἡι"], ["ᾒ", "ἢι"], ["ᾓ", "ἣι"], ["ᾔ", "ἤι"], ["ᾕ", "ἥι"], ["ᾖ", "ἦι"], ["ᾗ", "ἧι"],
  ["ᾠ", "ὠι"], ["ᾡ", "ὡι"], ["ᾢ", "ὢι"], ["ᾣ", "ὣι"], ["ᾤ", "ὤι"], ["ᾥ", "ὥι"], ["ᾦ", "ὦι"], ["ᾧ", "ὧι"],
  ["ᾳ", "αι"], ["ῃ", "ηι"], ["ῳ", "ωι"], ["ῒ", "ι\u0308\u0300"], ["ΐ", "ι\u0308\u0301"], ["ῢ", "υ\u0308\u0300"], ["ΰ", "υ\u0308\u0301"],
]);

// Compact code-point form of every Unicode 17 C/F mapping which differs
// from Unicode 17 default lowercase. The remaining C mappings are exactly
// Node 25's Unicode-17 lowercase mapping; S and Turkic T rows are excluded.
const FULL_FOLD_EXCEPTION_DATA =
  "B5=3BC;DF=73,73;149=2BC,6E;17F=73;1F0=6A,30C;345=3B9;390=3B9,308,301;3B0=3C5,308,301;3C2=3C3;3D0=3B2;3D1=3B8;3D5=3C6;3D6=3C0;3F0=3BA;3F1=3C1;3F5=3B5;587=565,582;13A0=13A0;13A1=13A1;13A2=13A2;13A3=13A3;13A4=13A4;13A5=13A5;13A6=13A6;13A7=13A7;13A8=13A8;13A9=13A9;13AA=13AA;13AB=13AB;13AC=13AC;13AD=13AD;13AE=13AE;13AF=13AF;13B0=13B0;13B1=13B1;13B2=13B2;13B3=13B3;13B4=13B4;13B5=13B5;13B6=13B6;13B7=13B7;13B8=13B8;13B9=13B9;13BA=13BA;13BB=13BB;13BC=13BC;13BD=13BD;13BE=13BE;13BF=13BF;13C0=13C0;13C1=13C1;13C2=13C2;13C3=13C3;13C4=13C4;13C5=13C5;13C6=13C6;13C7=13C7;13C8=13C8;13C9=13C9;13CA=13CA;13CB=13CB;13CC=13CC;13CD=13CD;13CE=13CE;13CF=13CF;13D0=13D0;13D1=13D1;13D2=13D2;13D3=13D3;13D4=13D4;13D5=13D5;13D6=13D6;13D7=13D7;13D8=13D8;13D9=13D9;13DA=13DA;13DB=13DB;13DC=13DC;13DD=13DD;13DE=13DE;13DF=13DF;13E0=13E0;13E1=13E1;13E2=13E2;13E3=13E3;13E4=13E4;13E5=13E5;13E6=13E6;13E7=13E7;13E8=13E8;13E9=13E9;13EA=13EA;13EB=13EB;13EC=13EC;13ED=13ED;13EE=13EE;13EF=13EF;13F0=13F0;13F1=13F1;13F2=13F2;13F3=13F3;13F4=13F4;13F5=13F5;13F8=13F0;13F9=13F1;13FA=13F2;13FB=13F3;13FC=13F4;13FD=13F5;1C80=432;1C81=434;1C82=43E;1C83=441;1C84=442;1C85=442;1C86=44A;1C87=463;1C88=A64B;1E96=68,331;1E97=74,308;1E98=77,30A;1E99=79,30A;1E9A=61,2BE;1E9B=1E61;1E9E=73,73;1F50=3C5,313;1F52=3C5,313,300;1F54=3C5,313,301;1F56=3C5,313,342;1F80=1F00,3B9;1F81=1F01,3B9;1F82=1F02,3B9;1F83=1F03,3B9;1F84=1F04,3B9;1F85=1F05,3B9;1F86=1F06,3B9;1F87=1F07,3B9;1F88=1F00,3B9;1F89=1F01,3B9;1F8A=1F02,3B9;1F8B=1F03,3B9;1F8C=1F04,3B9;1F8D=1F05,3B9;1F8E=1F06,3B9;1F8F=1F07,3B9;1F90=1F20,3B9;1F91=1F21,3B9;1F92=1F22,3B9;1F93=1F23,3B9;1F94=1F24,3B9;1F95=1F25,3B9;1F96=1F26,3B9;1F97=1F27,3B9;1F98=1F20,3B9;1F99=1F21,3B9;1F9A=1F22,3B9;1F9B=1F23,3B9;1F9C=1F24,3B9;1F9D=1F25,3B9;1F9E=1F26,3B9;1F9F=1F27,3B9;1FA0=1F60,3B9;1FA1=1F61,3B9;1FA2=1F62,3B9;1FA3=1F63,3B9;1FA4=1F64,3B9;1FA5=1F65,3B9;1FA6=1F66,3B9;1FA7=1F67,3B9;1FA8=1F60,3B9;1FA9=1F61,3B9;1FAA=1F62,3B9;1FAB=1F63,3B9;1FAC=1F64,3B9;1FAD=1F65,3B9;1FAE=1F66,3B9;1FAF=1F67,3B9;1FB2=1F70,3B9;1FB3=3B1,3B9;1FB4=3AC,3B9;1FB6=3B1,342;1FB7=3B1,342,3B9;1FBC=3B1,3B9;1FBE=3B9;1FC2=1F74,3B9;1FC3=3B7,3B9;1FC4=3AE,3B9;1FC6=3B7,342;1FC7=3B7,342,3B9;1FCC=3B7,3B9;1FD2=3B9,308,300;1FD3=3B9,308,301;1FD6=3B9,342;1FD7=3B9,308,342;1FE2=3C5,308,300;1FE3=3C5,308,301;1FE4=3C1,313;1FE6=3C5,342;1FE7=3C5,308,342;1FF2=1F7C,3B9;1FF3=3C9,3B9;1FF4=3CE,3B9;1FF6=3C9,342;1FF7=3C9,342,3B9;1FFC=3C9,3B9;AB70=13A0;AB71=13A1;AB72=13A2;AB73=13A3;AB74=13A4;AB75=13A5;AB76=13A6;AB77=13A7;AB78=13A8;AB79=13A9;AB7A=13AA;AB7B=13AB;AB7C=13AC;AB7D=13AD;AB7E=13AE;AB7F=13AF;AB80=13B0;AB81=13B1;AB82=13B2;AB83=13B3;AB84=13B4;AB85=13B5;AB86=13B6;AB87=13B7;AB88=13B8;AB89=13B9;AB8A=13BA;AB8B=13BB;AB8C=13BC;AB8D=13BD;AB8E=13BE;AB8F=13BF;AB90=13C0;AB91=13C1;AB92=13C2;AB93=13C3;AB94=13C4;AB95=13C5;AB96=13C6;AB97=13C7;AB98=13C8;AB99=13C9;AB9A=13CA;AB9B=13CB;AB9C=13CC;AB9D=13CD;AB9E=13CE;AB9F=13CF;ABA0=13D0;ABA1=13D1;ABA2=13D2;ABA3=13D3;ABA4=13D4;ABA5=13D5;ABA6=13D6;ABA7=13D7;ABA8=13D8;ABA9=13D9;ABAA=13DA;ABAB=13DB;ABAC=13DC;ABAD=13DD;ABAE=13DE;ABAF=13DF;ABB0=13E0;ABB1=13E1;ABB2=13E2;ABB3=13E3;ABB4=13E4;ABB5=13E5;ABB6=13E6;ABB7=13E7;ABB8=13E8;ABB9=13E9;ABBA=13EA;ABBB=13EB;ABBC=13EC;ABBD=13ED;ABBE=13EE;ABBF=13EF;FB00=66,66;FB01=66,69;FB02=66,6C;FB03=66,66,69;FB04=66,66,6C;FB05=73,74;FB06=73,74;FB13=574,576;FB14=574,565;FB15=574,56B;FB16=57E,576;FB17=574,56D";
const FULL_FOLD_EXCEPTIONS = new Map<string, string>([
  ...FULL_FOLD_SEED,
  ...FULL_FOLD_EXCEPTION_DATA.split(";").map((row) => {
    const [source, targets] = row.split("=") as [string, string];
    return [String.fromCodePoint(Number.parseInt(source, 16)), String.fromCodePoint(...targets.split(",").map((cp) => Number.parseInt(cp, 16)))] as const;
  }),
]);

export function fullCaseFold(value: string): string {
  let out = "";
  for (const char of value.normalize("NFKC")) out += FULL_FOLD_EXCEPTIONS.get(char) ?? char.toLowerCase();
  return out;
}

export function normalizedWords(value: string): string[] {
  return fullCaseFold(value)
    .replace(/^\s*[1-9][0-9]*\.\s+/gmu, "")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/\p{P}/gu, " ")
    .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

export function shingles(words: readonly string[], width = PROMPT_SHINGLE_WORDS): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i + width <= words.length; i++) result.add(words.slice(i, i + width).join(" "));
  return result;
}

export interface PromptComparison {
  transcript: number;
  prompt: number;
  shared: number;
  novel: number;
  accepted: boolean;
}

export function comparePrompt(transcriptText: string, promptText: string): PromptComparison {
  const transcript = shingles(normalizedWords(transcriptText));
  const prompt = shingles(normalizedWords(promptText));
  let shared = 0;
  for (const value of transcript) if (prompt.has(value)) shared++;
  const novel = transcript.size - shared;
  return {
    transcript: transcript.size,
    prompt: prompt.size,
    shared,
    novel,
    accepted: transcript.size > 0 && 10 * shared <= 3 * transcript.size && novel >= PROMPT_MIN_NOVEL_SHINGLES,
  };
}

interface ParsedHeader {
  values: Map<string, string>;
  duplicates: string[];
  body: string;
}

export function parseVerdictHeader(text: string): ParsedHeader {
  const lines = text.split(/\r?\n/);
  const values = new Map<string, string>();
  const duplicates: string[] = [];
  let at = 0;
  for (; at < lines.length; at++) {
    const match = /^# ([a-z_]+): (.*)$/.exec(lines[at]!);
    if (!match) break;
    if (values.has(match[1]!)) duplicates.push(match[1]!);
    else values.set(match[1]!, match[2]!);
  }
  while (at < lines.length && lines[at] === "") at++;
  return { values, duplicates, body: lines.slice(at).join("\n") };
}

const PLACEHOLDERS = new Set(["tbd", "todo", "pending", "placeholder", "n/a", "...", "insert findings", "insert recommendation"]);

export function contentLines(markdown: string): { headings: { level: number; name: string; line: number }[]; lines: { text: string; section?: string }[] } {
  const headings: { level: number; name: string; line: number }[] = [];
  const lines: { text: string; section?: string }[] = [];
  let fence: string | undefined;
  let comment = false;
  let section: string | undefined;
  const sourceLines = markdown.split(/\r?\n/);
  for (let index = 0; index < sourceLines.length; index++) {
    const raw = sourceLines[index]!;
    const trimmed = raw.trim();
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else {
        const close = new RegExp(`^${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
        if (close.test(trimmed)) fence = undefined;
      }
      continue;
    }
    if (fence) continue;
    let line = raw;
    if (comment) {
      const end = line.indexOf("-->");
      if (end === -1) continue;
      line = line.slice(end + 3);
      comment = false;
    }
    while (line.includes("<!--")) {
      const start = line.indexOf("<!--");
      const end = line.indexOf("-->", start + 4);
      if (end === -1) {
        line = line.slice(0, start);
        comment = true;
        break;
      }
      line = line.slice(0, start) + line.slice(end + 3);
    }
    const next = sourceLines[index + 1];
    const setext = next === undefined ? undefined : /^\s{0,3}(=+|-+)\s*$/.exec(next);
    if (line.trim() !== "" && setext) {
      const level = setext[1]![0] === "=" ? 1 : 2;
      const name = line.trim();
      headings.push({ level, name, line: index });
      section = level === 2 ? name : undefined;
      index++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim());
    if (heading) {
      const name = heading[2]!.trim();
      const level = heading[1]!.length;
      headings.push({ level, name, line: index });
      if (level <= 2) section = level === 2 ? name : undefined;
      continue;
    }
    if (line.trim() !== "") lines.push({ text: line.trim(), section });
  }
  return { headings, lines };
}

function hasPlaceholder(text: string): boolean {
  const folded = fullCaseFold(text.trim());
  if (PLACEHOLDERS.has(folded)) return true;
  const boundary = "[^\\p{L}\\p{M}\\p{N}]";
  return new RegExp(
    `(?:^|${boundary})(?:tbd|todo|pending|placeholder|n\\s*\\/\\s*a|\\.\\.\\.|insert\\s+findings|insert\\s+recommendation)(?=$|${boundary})`,
    "u",
  ).test(folded);
}

export function substantiveUiTranscript(body: string, outcome: string, prompt?: string): string[] {
  const problems: string[] = [];
  const parsed = contentLines(body);
  const findingsHeadings = parsed.headings.filter((heading) => heading.level === 2 && heading.name === "Findings");
  const recommendationHeadings = parsed.headings.filter((heading) => heading.level === 2 && heading.name === "Recommendation");
  if (findingsHeadings.length !== 1) problems.push("transcript must contain exactly one ## Findings section");
  if (recommendationHeadings.length !== 1) problems.push("transcript must contain exactly one ## Recommendation section");
  const findings = parsed.lines.filter((line) => line.section === "Findings");
  const recommendation = parsed.lines.filter((line) => line.section === "Recommendation");
  const numbered = findings.filter((line) => /^[1-9][0-9]*\. \S.*$/.test(line.text));
  const noFindings = findings.filter((line) => line.text === "No findings");
  if (numbered.length === 0 && noFindings.length === 0) problems.push("Findings needs a numbered finding or exact No findings line");
  const verdicts = recommendation.filter((line) => /^Verdict: (passed|failed|revise)$/.test(line.text));
  if (verdicts.length !== 1) problems.push("Recommendation needs exactly one exact Verdict line");
  else if (verdicts[0]!.text !== `Verdict: ${outcome}`) problems.push("Recommendation verdict does not match the outcome header");
  if (!/^(passed|failed|revise)$/.test(outcome)) problems.push("outcome must be passed, failed or revise");
  const all = [...findings, ...recommendation];
  if (all.length < 4) problems.push("transcript needs at least four nonblank, non-heading body lines");
  const structural = (line: string): boolean => line === "No findings" || /^Verdict: (passed|failed|revise)$/.test(line);
  const explanatory = all.filter((line) => !structural(line.text) && !/^[1-9][0-9]*\. \S.*$/.test(line.text));
  if (explanatory.length < 2) problems.push("transcript needs at least two explanatory lines");
  for (const line of [...explanatory, ...numbered]) {
    const content = line.text.replace(/^[1-9][0-9]*\.\s+/, "");
    if (content.replace(/\s/g, "").length < 20) problems.push("each explanatory line and numbered finding needs 20 non-whitespace characters");
    if (hasPlaceholder(content)) problems.push("placeholder content is not substantive");
  }
  for (const line of all) if (hasPlaceholder(line.text)) problems.push("placeholder content is not substantive");
  const retained = all
    .map((line) => line.text)
    .filter((line) => !structural(line))
    .map((line) => line.replace(/^[1-9][0-9]*\.\s+/, ""))
    .join(" ");
  if (prompt !== undefined) {
    const comparison = comparePrompt(retained, prompt);
    if (!comparison.accepted)
      problems.push(`dispatch-prompt comparison rejected (${comparison.shared}/${comparison.transcript} shared; ${comparison.novel} novel distinct shingles)`);
  }
  return [...new Set(problems)];
}

export interface UiPolicyContext {
  root: string;
  record: NativeRecord;
  manifest: Pick<Manifest, "collegia" | "sellae" | "probationes"> & { review_probatio?: unknown };
  phase: "check" | "ready" | "review" | "done";
}

export function validateRecordReferences(root: string, record: NativeRecord): OpusModelProblem[] {
  // A non-UI done opus is historical: no lifecycle policy reads its current
  // brief again, just as the legacy active-spec rule does not revisit it.
  // UI is different because done policy recomputes the design digest from
  // the current brief, so that reference remains live and must stay bounded.
  if (record.state === "done" && record.kind !== "ui") return [];
  if (record.spec === undefined) return [];
  if (typeof record.spec !== "string") return [{ rule: "opus.reference", message: "spec must be a contained brief path" }];
  const brief = readContainedRegularFile(root, record.spec, "briefs");
  return "error" in brief ? [{ rule: "opus.reference", message: `spec is unsafe or unreadable: ${brief.error}` }] : [];
}

interface UiInput {
  relative: string;
  header: ParsedHeader;
  round: number;
  at: string;
  digest: string;
}

function currentDesign(root: string, record: NativeRecord): { digest?: string; error?: string } {
  if (typeof record.title !== "string") return { error: "UI design digest requires a string title" };
  if (typeof record.spec !== "string") return { error: "UI design digest requires a current spec pointer" };
  const brief = readContainedRegularFile(root, record.spec, "briefs");
  if ("error" in brief) return { error: `current brief is unsafe or unreadable: ${brief.error}` };
  return { digest: designDigest(record.title, brief.bytes) };
}

function authoritativeUiInput(root: string, record: NativeRecord, expectedDigest: string): { input?: UiInput; problems: string[] } {
  const id = typeof record.id === "string" ? record.id : "";
  const candidates: { relative: string; round: number }[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(join(root, "ci"));
  } catch {
    return { problems: ["ci/ is unreadable; no ui-lead input can be established"] };
  }
  const pattern = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-spec-([1-9][0-9]*)\\.log$`);
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    candidates.push({ relative: `ci/${name}`, round: Number(match[1]) });
  }
  if (candidates.length === 0) return { problems: ["no ui-lead spec input exists"] };
  candidates.sort((a, b) => b.round - a.round);
  const latest = candidates[0]!;
  const file = readContainedRegularFile(root, latest.relative, "ci");
  if ("error" in file) return { problems: [`latest UI spec round is unsafe or unreadable: ${file.error}`] };
  const h = parseVerdictHeader(file.bytes.toString("utf8"));
  const problems: string[] = [];
  if (h.duplicates.length) problems.push(`duplicate verdict header key(s): ${h.duplicates.join(", ")}`);
  if (h.values.get("opus") !== id || h.values.get("phase") !== "spec" || h.values.get("round") !== String(latest.round) || h.values.get("sella") !== "ui-lead")
    problems.push("latest ui-lead verdict header does not match its opus, phase, round and sella");
  const outcome = h.values.get("outcome") ?? "";
  const at = h.values.get("at") ?? "";
  if (utcTimestampProblem(at)) problems.push("latest ui-lead verdict has an invalid timestamp");
  const digest = h.values.get("design_digest") ?? "";
  if (!DIGEST.test(digest) || digest !== expectedDigest) problems.push("latest ui-lead verdict has a missing, malformed or stale design_digest");
  const promptRel = h.values.get("dispatch_prompt");
  if (!promptRel) problems.push("latest ui-lead verdict has no dispatch_prompt header");
  let prompt: string | undefined;
  if (promptRel) {
    const file = readContainedRegularFile(root, promptRel, "ci");
    if ("error" in file) problems.push(`dispatch prompt is unsafe or unreadable: ${file.error}`);
    else prompt = file.bytes.toString("utf8");
  }
  problems.push(...substantiveUiTranscript(h.body, outcome, prompt));
  if (problems.length) return { problems };
  return { input: { relative: latest.relative, header: h, round: latest.round, at, digest }, problems };
}

export function inspectUiDesignInput(root: string, record: NativeRecord): {
  digest?: string;
  input?: { relative: string; round: number; at: string };
  problems: string[];
} {
  const design = currentDesign(root, record);
  if (!design.digest) return { problems: [design.error ?? "current design could not be read"] };
  const inspected = authoritativeUiInput(root, record, design.digest);
  return {
    digest: design.digest,
    input: inspected.input ? { relative: inspected.input.relative, round: inspected.input.round, at: inspected.input.at } : undefined,
    problems: inspected.problems,
  };
}

function validateServed(root: string, record: NativeRecord): { at?: string; tree?: string; problems: string[] } {
  const gates = typeof record.probationes === "object" && record.probationes !== null && !Array.isArray(record.probationes) ? (record.probationes as Record<string, unknown>) : {};
  const value = gates["served-e2e"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { problems: ["served-e2e has no recorded result"] };
  const gate = value as Record<string, unknown>;
  const problems: string[] = [];
  if (gate["status"] !== "passed") problems.push("served-e2e must be passed and cannot be waived");
  const certifies = typeof gate["certifies"] === "string" ? gate["certifies"] : undefined;
  if (!certifies || !TREE_CERTIFICATE.test(certifies)) problems.push("served-e2e needs a clean tree certificate");
  const at = typeof gate["at"] === "string" ? gate["at"] : undefined;
  if (!at || utcTimestampProblem(at)) problems.push("served-e2e needs an exact run timestamp");
  const evidence = typeof gate["evidence"] === "string" ? gate["evidence"] : undefined;
  if (!evidence) problems.push("served-e2e needs an evidence log");
  else {
    const log = readContainedRegularFile(root, evidence, "ci");
    if ("error" in log) problems.push(`served-e2e evidence is unsafe or unreadable: ${log.error}`);
    else {
      const text = log.bytes.toString("utf8");
      if (!certifies || !text.includes(`certifies: ${certifies}`)) problems.push("served-e2e evidence does not corroborate its certificate");
      if (!text.includes("command: node scripts/served-e2e.mjs")) problems.push("served-e2e evidence does not corroborate the reserved command");
      if (!/^exit code: 0\s*$/m.test(text)) problems.push("served-e2e evidence does not record a successful run");
    }
  }
  return { at, tree: certifies, problems };
}

function reviewIdentity(
  root: string,
  gate: Record<string, unknown>,
  censor: string | undefined,
): { header?: ReturnType<typeof parseVerdictHeader>; problems: string[] } {
  const problems: string[] = [];
  if (!censor) problems.push("review gate cannot identify the manifest QA magister censor");
  else if (gate["sella"] !== censor) problems.push(`review gate sella must be the censor ${censor}`);
  const evidence = typeof gate["evidence"] === "string" ? gate["evidence"] : "";
  const file = readContainedRegularFile(root, evidence, "ci");
  if ("error" in file) return { problems: [...problems, `review evidence is unsafe or unreadable: ${file.error}`] };
  const header = parseVerdictHeader(file.bytes.toString("utf8"));
  if (header.duplicates.length) problems.push("review evidence contains duplicate header keys");
  if (censor && header.values.get("sella") !== censor) problems.push(`review evidence header sella must be the censor ${censor}`);
  return { header, problems };
}

function reviewCitation(
  input: UiInput,
  expectedDigest: string,
  header: ReturnType<typeof parseVerdictHeader>,
): string[] {
  const problems: string[] = [];
  if (header.values.get("ui_input") !== input.relative) problems.push("review evidence does not cite the current ui-lead input");
  if (header.values.get("design_digest") !== expectedDigest) problems.push("review evidence design_digest is missing or stale");
  const sections = contentLines(header.body);
  const dispositionHeads = sections.headings.filter((heading) => heading.level === 2 && heading.name === "UI input disposition");
  const disposition = sections.lines.filter((line) => line.section === "UI input disposition");
  if (dispositionHeads.length !== 1 || disposition.length === 0) problems.push("review evidence needs one nonblank ## UI input disposition section");
  return problems;
}

interface RulingResult {
  valid: boolean;
  current: boolean;
  problem?: string;
}

function ruling(root: string, record: NativeRecord, decisionId: string, digest: string, inputAt?: string, servedAt?: string, servedTree?: string): RulingResult {
  if (!DECISION_ID.test(decisionId)) return { valid: false, current: false, problem: `${decisionId} is not a decision id` };
  const file = readContainedRegularFile(root, `decisions/${decisionId}.md`, "decisions");
  if ("error" in file) return { valid: false, current: false, problem: `${decisionId} is unsafe or unreadable: ${file.error}` };
  const split = splitFront(file.bytes.toString("utf8"));
  if (!split) return { valid: false, current: false, problem: `${decisionId} has no front matter` };
  const doc = parseDocument(split.front, { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) return { valid: false, current: false, problem: `${decisionId} has malformed or duplicate-key front matter` };
  const scalar = (key: string): string | undefined => {
    const node = doc.get(key, true);
    return isScalar(node) && typeof node.value === "string" ? node.value : undefined;
  };
  const values = {
    id: scalar("id"), by: scalar("by"), provenance: scalar("provenance"), title: scalar("title"), kill_when: scalar("kill_when"),
    opus: scalar("opus"), certifies: scalar("certifies"), design_digest: scalar("design_digest"), at: scalar("at"),
  };
  if (values.id !== decisionId || values.by !== "patron" || values.provenance !== "stated" || !values.title?.trim() || !values.kill_when?.trim() || values.opus !== record.id || !values.certifies || !TREE_CERTIFICATE.test(values.certifies) || !values.design_digest || !DIGEST.test(values.design_digest) || !values.at || utcTimestampProblem(values.at) || split.body.trim() === "")
    return { valid: false, current: false, problem: `${decisionId} is not a structured Patron UI ruling for this opus` };
  const current =
    inputAt !== undefined &&
    servedAt !== undefined &&
    servedTree !== undefined &&
    values.certifies === servedTree &&
    values.design_digest === digest &&
    instant(values.at) >= Math.max(instant(inputAt), instant(servedAt));
  return { valid: true, current };
}

export function validateUiPolicy(context: UiPolicyContext): OpusModelProblem[] {
  const { root, record, manifest, phase } = context;
  if (record.kind !== "ui") return [];
  const problems: OpusModelProblem[] = [];
  const state = typeof record.state === "string" ? record.state : "";
  const needsInput = phase === "ready" || phase === "done" || ["building", "verifying", "review", "done"].includes(state) || (state === "halted" && record.start !== undefined);
  const id = typeof record.id === "string" ? record.id : "";
  let hasInputCandidate = false;
  try {
    const pattern = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-spec-[1-9][0-9]*\\.log$`);
    hasInputCandidate = readdirSync(join(root, "ci")).some((name) => pattern.test(name));
  } catch { /* an early-state record does not require ci/ to exist */ }
  const recordedGates = typeof record.probationes === "object" && record.probationes !== null && !Array.isArray(record.probationes)
    ? (record.probationes as Record<string, unknown>)
    : {};
  const reviewId = typeof manifest.review_probatio === "string" && manifest.review_probatio.length > 0 ? manifest.review_probatio : "review";
  const censor = censorSella(manifest);
  const reviewGate = typeof recordedGates[reviewId] === "object" && recordedGates[reviewId] !== null && !Array.isArray(recordedGates[reviewId])
    ? (recordedGates[reviewId] as Record<string, unknown>)
    : {};
  const reviewStatus = reviewGate["status"];
  const validateDesign = needsInput || hasInputCandidate || record.ui_rulings !== undefined || reviewStatus === "passed" || reviewStatus === "failed";
  const needsRoute = needsInput || hasInputCandidate;
  const uiSeat = manifest.sellae.find((seat) => seat.id === "ui-lead");
  if (needsRoute && (!uiSeat || uiSeat.retired === true || uiSeat.collegium !== "design"))
    problems.push({ rule: "opus.ui.route", message: "ui-lead must be a live design-collegium seat" });
  problems.push(...effectiveProbationes("ui", manifest.probationes).problems);
  const design = validateDesign ? currentDesign(root, record) : {};
  let input: ReturnType<typeof authoritativeUiInput> = { problems: [] };
  if (validateDesign && !design.digest) {
    problems.push({ rule: "opus.ui.design", message: design.error ?? "current design could not be read" });
  } else if (design.digest) input = authoritativeUiInput(root, record, design.digest);
  const addPolicyProblem = (rule: "opus.ui.design" | "opus.ui.e2e" | "opus.ui.rulings", message: string): void => {
    if (/unsafe|unreadable|symlink|regular file/i.test(message)) problems.push({ rule: "opus.reference", message });
    problems.push({ rule, message });
  };
  if (needsInput || input.input || input.problems.some((problem) => !problem.startsWith("no ui-lead")))
    for (const message of input.problems) addPolicyProblem("opus.ui.design", message);
  const served = validateServed(root, record);
  const needsServed = phase === "review" || phase === "done" || state === "review" || state === "done";
  if (needsServed) for (const message of served.problems) addPolicyProblem("opus.ui.e2e", message);
  const review = reviewStatus === "passed" || reviewStatus === "failed" ? reviewIdentity(root, reviewGate, censor) : undefined;
  if (review) for (const message of review.problems) addPolicyProblem("opus.ui.design", message);
  const needsPassedReview = phase === "done" || state === "done" || reviewStatus === "passed";
  if (needsPassedReview) {
    if (typeof recordedGates[reviewId] !== "object" || recordedGates[reviewId] === null || Array.isArray(recordedGates[reviewId]))
      addPolicyProblem("opus.ui.design", "passed UI review evidence is missing");
    else if (reviewStatus !== "passed") addPolicyProblem("opus.ui.design", "UI completion needs the sole review gate passed");
    else if (input.input && design.digest && review?.header)
      for (const message of reviewCitation(input.input, design.digest, review.header)) addPolicyProblem("opus.ui.design", message);
  }

  const refs = record.ui_rulings;
  if (refs !== undefined && (!Array.isArray(refs) || refs.length === 0 || refs.some((value) => typeof value !== "string") || new Set(refs as unknown[]).size !== refs.length))
    problems.push({ rule: "opus.ui.rulings", message: "ui_rulings must be a sequence of distinct decision-id strings" });
  const ids = Array.isArray(refs) && refs.every((value) => typeof value === "string") ? (refs as string[]) : [];
  let current = false;
  let valid = 0;
  if (design.digest) {
    for (const id of ids) {
      const result = ruling(root, record, id, design.digest, input.input?.at, served.at, served.tree);
      if (!result.valid) addPolicyProblem("opus.ui.rulings", result.problem!);
      else {
        valid++;
        if (result.current) current = true;
      }
    }
  } else {
    for (const id of ids) if (!DECISION_ID.test(id)) problems.push({ rule: "opus.ui.rulings", message: `${id} is not a decision id` });
  }
  if (phase === "done" || state === "done") {
    if (ids.length === 0) problems.push({ rule: "opus.ui.rulings", message: "UI completion requires at least one Patron ruling" });
    else if (!current) problems.push({ rule: "opus.ui.rulings", message: "no Patron ruling matches the current served tree and design digest at a sufficiently recent time" });
  } else if (valid > 0 && !current) {
    problems.push({ rule: "opus.ui.rulings", level: "advise", message: "supplied UI rulings are stale for the current design or served tree" });
  }
  return problems;
}

export function validateStudioNativeModel(
  root: string,
  manifest: Pick<Manifest, "collegia" | "sellae" | "probationes">,
): { where: string; problem: OpusModelProblem }[] {
  const loaded = loadNativeRecords(root);
  const out = [...loaded.problems];
  for (const entry of loaded.entries) {
    for (const problem of validateNativeRecord(entry.data, loaded.records)) out.push({ where: entry.path, problem });
    for (const problem of validateRecordReferences(root, entry.data)) out.push({ where: entry.path, problem });
    for (const problem of validateUiPolicy({ root, record: entry.data, manifest, phase: "check" })) out.push({ where: entry.path, problem });
  }
  return out;
}

function git(repo: string, args: string[], encoding: BufferEncoding = "utf8"): string {
  return execFileSync("git", args, { cwd: repo, encoding, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).toString();
}

function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: repo, stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

export interface ProtectedRecordsResult {
  ok: boolean;
  baseline?: string;
  protectedPaths: string[];
  problems: string[];
}

function compareProtectedRecordContentsAtBaseline(
  repo: string,
  baseline: string,
  protectedPaths: string[],
  problems: string[],
): void {
  const tree = git(repo, ["ls-tree", "-r", "-z", "--full-tree", baseline, "--", "studio/opera", "examples/sample-studio/opera"]);
  for (const row of tree.split("\0")) {
    if (!row) continue;
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(row);
    if (!match) continue;
    const path = match[4]!;
    if (!/^(?:studio\/opera|examples\/sample-studio\/opera)\/[^/]+\.md$/.test(path) || path === "studio/opera/W-096.md") continue;
    protectedPaths.push(path);
    if (match[2] !== "blob" || (match[1] !== "100644" && match[1] !== "100755")) {
      problems.push(`${path}: baseline entry is not a regular file`);
      continue;
    }
    const baselineBytes = execFileSync("git", ["show", `${baseline}:${path}`], { cwd: repo, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }) as Buffer;
    const headRow = git(repo, ["ls-tree", "HEAD", "--", path]).trim();
    const head = /^(\d+) blob ([0-9a-f]+)\t/.exec(headRow);
    if (!head || head[1] !== match[1]) { problems.push(`${path}: missing, renamed, non-regular or mode-changed at HEAD`); continue; }
    const headBytes = execFileSync("git", ["show", `HEAD:${path}`], { cwd: repo, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }) as Buffer;
    if (!baselineBytes.equals(headBytes)) problems.push(`${path}: bytes differ from baseline at HEAD`);
    const working = readContainedRegularFile(repo, path, path.split("/")[0]!);
    if ("error" in working) problems.push(`${path}: working-tree entry is unsafe or unreadable: ${working.error}`);
    else {
      const mode = working.mode & 0o111 ? "100755" : "100644";
      if (mode !== match[1]) problems.push(`${path}: working-tree mode differs from baseline`);
      if (!baselineBytes.equals(working.bytes)) problems.push(`${path}: working-tree bytes differ from baseline`);
    }
  }
}

/**
 * Compare the protected record bytes and modes at HEAD and in the working
 * tree with an explicitly supplied baseline.  This is the W-096 bootstrap's
 * pre-write comparison; immutable-pin history belongs to post-commit
 * validateProtectedRecords instead.
 */
export function compareProtectedRecordContents(repoArg: string, studioRoot: string, baseline: string): ProtectedRecordsResult {
  const repo = resolve(repoArg);
  const protectedPaths: string[] = [];
  const problems: string[] = [];
  try {
    const repoReal = realpathSync(repo);
    const studioReal = realpathSync(studioRoot);
    if (relative(repoReal, studioReal).split(sep).join("/") !== "studio")
      throw new Error("repository identity does not contain the selected native studio at studio/");
    if (!/^[0-9a-f]{40}$/.test(baseline))
      return { ok: false, protectedPaths, problems: ["baseline_commit is missing or is not a full lowercase commit id"] };
    git(repo, ["cat-file", "-e", `${baseline}^{commit}`]);
    compareProtectedRecordContentsAtBaseline(repo, baseline, protectedPaths, problems);
    protectedPaths.sort();
    return { ok: problems.length === 0, baseline, protectedPaths, problems };
  } catch (error) {
    problems.push(`preservation is unverifiable: ${(error as Error).message}`);
    return { ok: false, protectedPaths, problems };
  }
}

/** W-096 immutable reviewed-trunk record comparison. */
export function validateProtectedRecords(repoArg: string, studioRoot: string, record?: NativeRecord): ProtectedRecordsResult {
  const repo = resolve(repoArg);
  const protectedPaths: string[] = [];
  const problems: string[] = [];
  let current = record;
  try {
    const repoReal = realpathSync(repo);
    const studioReal = realpathSync(studioRoot);
    if (relative(repoReal, studioReal).split(sep).join("/") !== "studio")
      throw new Error("repository identity does not contain the selected native studio at studio/");
    if (!current) {
      const contained = readContainedRegularFile(studioRoot, "opera/W-096.md", "opera");
      if ("error" in contained) throw new Error(`W-096 record is unsafe or unreadable: ${contained.error}`);
      const split = splitFront(contained.bytes.toString("utf8"));
      current = split ? (parseDocument(split.front).toJS() as NativeRecord) : undefined;
    }
    const baseline = typeof current?.["baseline_commit"] === "string" ? (current["baseline_commit"] as string) : undefined;
    if (!baseline || !/^[0-9a-f]{40}$/.test(baseline)) return { ok: false, protectedPaths, problems: ["baseline_commit is missing or is not a full lowercase commit id"] };
    git(repo, ["cat-file", "-e", `${baseline}^{commit}`]);
    git(repo, ["cat-file", "-e", "origin/master^{commit}"]);
    const shallow = git(repo, ["rev-parse", "--is-shallow-repository"]).trim();
    if (shallow !== "false") throw new Error("repository history is shallow or incomplete");
    if (!isAncestor(repo, baseline, "origin/master")) problems.push("baseline_commit is not an ancestor of origin/master");
    if (!isAncestor(repo, baseline, "HEAD")) problems.push("baseline_commit is not an ancestor of HEAD");

    const studioRel = relative(repo, resolve(studioRoot)).split(sep).join("/");
    if (studioRel !== "studio") problems.push("W-096 preservation requires the native studio at repo path studio/");
    const recordPath = "studio/opera/W-096.md";
    const history = git(repo, ["log", "--full-history", "--format=%H", "HEAD", "--", recordPath]).trim().split("\n").filter(Boolean);
    let recordedPin = false;
    const conflictingPins = new Set<string>();
    for (const commit of history) {
      const entry = git(repo, ["ls-tree", commit, "--", recordPath]).trim();
      if (entry === "") continue;
      let raw: string;
      try { raw = git(repo, ["show", `${commit}:${recordPath}`]); }
      catch (error) { throw new Error(`record history is incomplete at ${commit}: ${(error as Error).message}`); }
      const split = splitFront(raw);
      if (!split) throw new Error(`record history is malformed at ${commit}`);
      const historical = parseDocument(split.front);
      if (historical.errors.length) throw new Error(`record history is malformed at ${commit}`);
      const data = historical.toJS() as NativeRecord;
      if (typeof data["baseline_commit"] === "string") {
        recordedPin = true;
        if (data["baseline_commit"] !== baseline) conflictingPins.add(data["baseline_commit"] as string);
      }
    }
    if (!recordedPin) problems.push("baseline_commit has no verifiable introduction in record history");
    if (conflictingPins.size > 0)
      problems.push(`baseline_commit conflicts with reachable record history (${[...conflictingPins].sort().join(", ")})`);

    compareProtectedRecordContentsAtBaseline(repo, baseline, protectedPaths, problems);
    protectedPaths.sort();
    return { ok: problems.length === 0, baseline, protectedPaths, problems };
  } catch (error) {
    problems.push(`preservation is unverifiable: ${(error as Error).message}`);
    return { ok: false, protectedPaths, problems };
  }
}

export function currentBranch(repo: string): string | undefined {
  try { return git(resolve(repo), ["branch", "--show-current"]).trim() || undefined; } catch { return undefined; }
}

export function recordWith(record: NativeRecord, changes: Record<string, unknown>): NativeRecord {
  return { ...record, ...changes };
}
