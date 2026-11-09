/**
 * packages/schema/src/read.ts — W-558: the one fail-closed read every lock input goes through. A read is `absent` only
 * when the reader reports file-not-found (`ENOENT`); every other read failure, and every value the shape function
 * rejects (it throws), is an `error` the caller propagates; only a value the shape accepts is `valid`. Pure: the caller
 * supplies the reader (a contained read, never a raw join) and the shape, so this module touches no file system.
 * See studio/briefs/W-558.md.
 */

/** What a lock input reads as: absent (file-not-found only), valid, or an error naming the input and why. */
export type InputRead<T> = { kind: "absent" } | { kind: "valid"; value: T } | { kind: "error"; why: string };

/** One read: the bytes, or the reader's error and its errno code (`ENOENT` alone is absence). */
export type RawRead<B> = { bytes: B } | { error: string; code?: string };

/** W-558: read `label` through `read`, judge it with `shape` (which throws on a value outside the input's domain). */
export function readInput<B, T>(label: string, read: () => RawRead<B>, shape: (bytes: B) => T): InputRead<T> {
  let raw: RawRead<B>;
  try {
    raw = read();
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "error", why: `${label} cannot be read (${typeof code === "string" ? code : firstLine(e)})` };
  }
  if ("error" in raw) return raw.code === "ENOENT" ? { kind: "absent" } : { kind: "error", why: `${label} cannot be read (${raw.code ?? firstLine(raw.error)})` };
  try {
    return { kind: "valid", value: shape(raw.bytes) };
  } catch (e) {
    return { kind: "error", why: `${label} ${firstLine(e)}` };
  }
}

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
