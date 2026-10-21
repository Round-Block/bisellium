import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ",
  "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS",
  "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc",
  "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak",
  "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
] as const;

export interface FontAsset {
  path: string;
  family: string;
  tableFamily: string;
  style: "normal";
  weight: number;
  licence: string;
}

export const FONT_ASSETS: readonly FontAsset[] = [
  { path: "bricolage-grotesque/BricolageGrotesque-SemiBold.woff2", family: "Bricolage Grotesque", tableFamily: "Bricolage Grotesque 96pt ExtraBold", style: "normal", weight: 600, licence: "bricolage-grotesque/OFL.txt" },
  { path: "bricolage-grotesque/BricolageGrotesque-Bold.woff2", family: "Bricolage Grotesque", tableFamily: "Bricolage Grotesque 96pt ExtraBold", style: "normal", weight: 700, licence: "bricolage-grotesque/OFL.txt" },
  { path: "instrument-sans/InstrumentSans-Regular.woff2", family: "Instrument Sans", tableFamily: "Instrument Sans", style: "normal", weight: 400, licence: "instrument-sans/OFL.txt" },
  { path: "instrument-sans/InstrumentSans-Medium.woff2", family: "Instrument Sans", tableFamily: "Instrument Sans", style: "normal", weight: 500, licence: "instrument-sans/OFL.txt" },
  { path: "ibm-plex-mono/IBMPlexMono-Regular.woff2", family: "IBM Plex Mono", tableFamily: "IBM Plex Mono", style: "normal", weight: 400, licence: "ibm-plex-mono/OFL.txt" },
] as const;

function u16(bytes: Uint8Array, at: number): number {
  if (at + 2 > bytes.length) throw new Error("truncated uint16");
  return (bytes[at]! << 8) | bytes[at + 1]!;
}

function u32(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) throw new Error("truncated uint32");
  return bytes[at]! * 0x1000000 + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
}

function fixed16(bytes: Uint8Array, at: number): number {
  const raw = u32(bytes, at);
  return (raw > 0x7fffffff ? raw - 0x100000000 : raw) / 0x10000;
}

function base128(bytes: Uint8Array, cursor: { at: number }): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[cursor.at++];
    if (byte === undefined || (i === 0 && byte === 0x80)) throw new Error("invalid UIntBase128");
    if (value & 0xfe000000) throw new Error("UIntBase128 overflow");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("UIntBase128 is longer than five bytes");
}

function decodeName(bytes: Uint8Array, platform: number): string {
  if (platform === 0 || platform === 3) {
    if (bytes.length % 2 !== 0) throw new Error("odd UTF-16BE font name");
    let value = "";
    for (let i = 0; i < bytes.length; i += 2) value += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return value;
  }
  return new TextDecoder("latin1").decode(bytes);
}

function familyName(table: Uint8Array): string {
  const count = u16(table, 2);
  const strings = u16(table, 4);
  const candidates: { priority: number; value: string }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const platform = u16(table, at);
    const language = u16(table, at + 4);
    const nameId = u16(table, at + 6);
    const length = u16(table, at + 8);
    const offset = u16(table, at + 10);
    if (nameId !== 1 && nameId !== 16) continue;
    const raw = table.subarray(strings + offset, strings + offset + length);
    if (raw.length !== length) throw new Error("truncated font name");
    const value = decodeName(raw, platform).replace(/\0/g, "").trim();
    if (value !== "") candidates.push({ priority: (nameId === 16 ? 0 : 2) + (language === 0x409 ? 0 : 1), value });
  }
  candidates.sort((a, b) => a.priority - b.priority);
  if (candidates[0] === undefined) throw new Error("font has no family name");
  return candidates[0].value;
}

/** Reads untransformed `name`, `OS/2` and optional variable `fvar` tables from
 * the decompressed WOFF2 stream. Their own values, rather than CSS declarations
 * or file names, authenticate the family and supported baseline weight. */
export function readWoff2Identity(input: Uint8Array): { family: string; weight: number; weightRange?: readonly [number, number] } {
  if (input.length < 48 || new TextDecoder("latin1").decode(input.subarray(0, 4)) !== "wOF2") throw new Error("not a WOFF2 font");
  if (u32(input, 8) !== input.length) throw new Error("WOFF2 length does not match the file");
  const tableCount = u16(input, 12);
  const compressedLength = u32(input, 20);
  const cursor = { at: 48 };
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < tableCount; i++) {
    const flags = input[cursor.at++];
    if (flags === undefined) throw new Error("truncated WOFF2 directory");
    const tagIndex = flags & 0x3f;
    const tag = tagIndex === 0x3f
      ? new TextDecoder("latin1").decode(input.subarray(cursor.at, (cursor.at += 4)))
      : TAGS[tagIndex];
    if (tag === undefined || tag.length !== 4) throw new Error("invalid WOFF2 table tag");
    const originalLength = base128(input, cursor);
    const version = flags >>> 6;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const length = transformed ? base128(input, cursor) : originalLength;
    entries.push({ tag, length });
  }
  const compressed = input.subarray(cursor.at, cursor.at + compressedLength);
  if (compressed.length !== compressedLength) throw new Error("truncated WOFF2 compressed stream");
  const tables = brotliDecompressSync(compressed);
  let offset = 0;
  let name: Uint8Array | undefined;
  let os2: Uint8Array | undefined;
  let fvar: Uint8Array | undefined;
  for (const entry of entries) {
    const bytes = tables.subarray(offset, offset + entry.length);
    if (bytes.length !== entry.length) throw new Error(`truncated ${entry.tag} table`);
    if (entry.tag === "name") name = bytes;
    if (entry.tag === "OS/2") os2 = bytes;
    if (entry.tag === "fvar") fvar = bytes;
    offset += entry.length;
  }
  if (name === undefined || os2 === undefined || os2.length < 6) throw new Error("font needs name and OS/2 tables");
  const identity: { family: string; weight: number; weightRange?: readonly [number, number] } = {
    family: familyName(name),
    weight: u16(os2, 4),
  };
  if (fvar !== undefined) {
    const axesOffset = u16(fvar, 4);
    const axisCount = u16(fvar, 8);
    const axisSize = u16(fvar, 10);
    if (axisSize < 20) throw new Error("invalid fvar axis size");
    for (let i = 0; i < axisCount; i++) {
      const at = axesOffset + i * axisSize;
      const tag = new TextDecoder("latin1").decode(fvar.subarray(at, at + 4));
      if (tag === "wght") identity.weightRange = [fixed16(fvar, at + 4), fixed16(fvar, at + 12)];
    }
  }
  return identity;
}

export function expectFontAssets(root: string): void {
  const licences = new Set<string>();
  for (const asset of FONT_ASSETS) {
    const actual = readWoff2Identity(readFileSync(join(root, asset.path)));
    assert.equal(actual.family, asset.tableFamily, `${asset.path}: font-table family`);
    if (actual.weightRange === undefined) {
      assert.equal(actual.weight, asset.weight, `${asset.path}: static OS/2 weight`);
    } else {
      assert.ok(asset.weight >= actual.weightRange[0] && asset.weight <= actual.weightRange[1], `${asset.path}: ${asset.weight} is within fvar wght ${actual.weightRange.join("-")}`);
    }
    licences.add(asset.licence);
  }
  for (const licence of licences) {
    assert.match(readFileSync(join(root, licence), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/i, `${licence}: SIL OFL 1.1`);
  }
}
