/**
 * W-139: a `node --import` preload that logs every fs read of the record-only
 * set (`studio/`, the handoff: `recordOnly()` in ci-scope.mjs) by the process
 * and by every node child that inherits NODE_OPTIONS. On the full CI path
 * `ci-scope.mjs --check-reads` compares the log to `package.json`'s
 * `test:record`, so a new reader cannot land unlisted and a stale entry cannot
 * stay.
 *
 * Inert unless BISELLIUM_RECORD_READS names a log. Each line is
 * `<owner>\t<repo-relative path>`, once per (owner, path) per process; the
 * owner is the nearest enclosing `*.test.*` script (BISELLIUM_RECORD_OWNER,
 * inherited by children), `?` if none. Every wrapper keeps the original's own
 * properties (`realpathSync.native` and friends), so a traced test behaves
 * like an untraced one.
 *
 * The log fails closed, by one invariant: record, then read. A trace row is
 * written synchronously BEFORE the wrapped call runs; if that write fails the
 * process creates a sibling `<log>.fail` marker (a different open, on a
 * different path), says so on stderr and `process.abort()`s, so no untraced
 * read can ever happen and a status swallowed by a parent cannot hide one. The
 * guard fails on `<log>.fail`.
 *
 * The first process of a run (no inherited BISELLIUM_RECORD_ROOT) is the root:
 * it logs `#start\t<id>\troot` and, last, `#end\t<id>`; every other process
 * logs `#start\t<id>` and `#end\t<id>` when its exit handler runs (a child
 * killed by a signal never does, which is safe: what it read was recorded
 * first). The guard rejects a log with no root, a root that never ended (a
 * truncated tail) or a final line without its newline. A failed start or end
 * marker is loud too: `#fail\t<id>`, stderr, and exit 70.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordOnly } from "./ci-scope.mjs";

const OWNER_ENV = "BISELLIUM_RECORD_OWNER";
const SYNC = [
  ...["readFileSync", "readdirSync", "existsSync", "statSync", "lstatSync", "openSync", "opendirSync"],
  ...["createReadStream", "cpSync", "copyFileSync"],
];
const ASYNC = ["readFile", "readdir", "stat", "lstat", "open", "opendir", "cp", "copyFile"];

if (process.env.BISELLIUM_RECORD_READS) {
  const log = resolve(process.env.BISELLIUM_RECORD_READS);
  process.env.BISELLIUM_RECORD_READS = log;
  const repo = dirname(dirname(fileURLToPath(import.meta.url)));
  const script = process.argv[1] ?? "";
  if (/(^|\.)test\.[cm]?[jt]s$/.test(basename(script)))
    process.env[OWNER_ENV] = relative(repo, resolve(script)).split("\\").join("/");
  const owner = process.env[OWNER_ENV] ?? "?";
  const append = fs.appendFileSync;
  const seen = new Set();
  const id = `${process.pid}.${randomUUID()}`;
  let failed = false;
  const emit = (text) => {
    try {
      append(log, text);
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };
  const fail = (error) => {
    if (failed) return;
    failed = true;
    try {
      append(log, `#fail\t${id}\n`);
    } catch {}
    try {
      process.stderr.write(`record-reads: ${error?.message ?? error}\n`);
    } catch {}
  };
  const root = !process.env.BISELLIUM_RECORD_ROOT;
  if (root) process.env.BISELLIUM_RECORD_ROOT = id;
  emit(`#start\t${id}${root ? "\troot" : ""}\n`);
  process.on("exit", (code) => {
    if (!failed) emit(`#end\t${id}\n`);
    if (failed && !code) process.exitCode = 70;
  });
  const pathText = (path) => {
    try {
      if (typeof path === "string") return path;
      if (path instanceof URL) return fileURLToPath(path);
      if (Buffer.isBuffer(path)) return path.toString();
    } catch {} // not a path the original call can read either; it reports its own error
    return null;
  };
  const note = (path) => {
    const text = pathText(path);
    if (text === null) return;
    const rel = relative(repo, resolve(text)).split("\\").join("/");
    if ((rel !== "studio" && !recordOnly([rel])) || seen.has(rel)) return;
    seen.add(rel);
    try {
      append(log, `${owner}\t${rel}\n`);
    } catch (error) {
      try {
        append(`${log}.fail`, `${id}\t${rel}\n`);
      } catch {}
      try {
        process.stderr.write(`record-reads: cannot record a read of ${rel}: ${error?.message ?? error}\n`);
      } catch {}
      process.abort(); // never reach the untraced read
    }
  };
  const wrap = (target, name) => {
    const original = target[name];
    if (typeof original !== "function") return;
    const wrapper = function (path, ...rest) {
      note(path);
      return original.call(this, path, ...rest);
    };
    Object.defineProperties(wrapper, Object.getOwnPropertyDescriptors(original));
    target[name] = wrapper;
  };
  for (const name of SYNC) wrap(fs, name);
  for (const name of ASYNC) {
    wrap(fs, name);
    wrap(fs.promises, name);
  }
  syncBuiltinESMExports();
}
