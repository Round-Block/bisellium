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
 * The log fails closed. A process brackets its lines with `#start\t<id>` and
 * `#end\t<id>\t<count>`; the guard rejects a log with a start but no end, a
 * count that does not match, or a final line without its newline. A write the
 * process cannot make is loud, never swallowed: it says so on stderr, writes
 * no end marker, and exits non-zero (70) unless it already failed.
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
  let written = 0;
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
      process.stderr.write(`record-reads: ${error?.message ?? error}\n`);
    } catch {}
  };
  emit(`#start\t${id}\n`);
  process.on("exit", (code) => {
    if (!failed) emit(`#end\t${id}\t${written}\n`);
    if (failed && !code) process.exitCode = 70;
  });
  const note = (path) => {
    try {
      const text =
        typeof path === "string"
          ? path
          : path instanceof URL
            ? fileURLToPath(path)
            : Buffer.isBuffer(path)
              ? path.toString()
              : null;
      if (text === null) return;
      const rel = relative(repo, resolve(text)).split("\\").join("/");
      if ((rel !== "studio" && !recordOnly([rel])) || seen.has(rel)) return;
      seen.add(rel);
      if (emit(`${owner}\t${rel}\n`)) written++;
    } catch (error) {
      fail(error);
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
