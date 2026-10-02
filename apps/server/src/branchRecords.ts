/**
 * apps/server/src/branchRecords.ts — W-129: serve reads branch-owned records.
 *
 * D-021: while `opus/<id>` exists the branch owns the record and the trunk copy is frozen at the fork point. Once
 * per poll (never per request) this module refreshes an in-memory overlay of those records, read-only, through
 * `git` spawned asynchronously with a hard timeout:
 *
 *  - the BASE of every entry is the committed tip, `git cat-file blob <objectname>:<studio>/opera/<id>.md`, parsed
 *    and validated before it is believed;
 *  - when a worktree has the branch checked out, its file is a LIVE read, limited to `state` (and only to the three
 *    active states), `traditio` and `heartbeat`. A builder writes that file, so it is opened through
 *    `readBoundedRegular` (a regular file only, FIFO-proof, bounded, contained) and never trusted for gates,
 *    tokens, title or body.
 *
 * Nothing here writes, fetches, checks out or takes an index lock, and the overlay can replace a trunk record but
 * never create one. Every `reason` that reaches the page or a terminal is one of the fixed codes below: never an
 * error message, a YAML message or a path (those quote record text).
 */
import { execFile } from "node:child_process";
import { constants, existsSync, realpathSync } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { parseFrontMatter, validateOpusFront } from "@bisellium/adapter-native";

export type DropReason = "no-front-matter" | "id-mismatch" | "invalid-shape" | "too-large" | "unreadable" | "parse-error";
export type StatusReason = "git-timeout" | "git-error" | "git-missing";
export interface BranchRecordsStatus {
  status: "ok" | "partial" | "stale" | "unavailable" | "off";
  failures?: number;
  reason?: StatusReason;
  capped?: number;
  liveRejected?: number;
  dropped: { id: string; reason: DropReason }[];
}
export type OverlayEntry = { data: Record<string, unknown>; body: string };
export type Overlay = Map<string, OverlayEntry>;

export const STATUS_PREFIX = "bisellium serve: branch records ";
export const DEFAULT_GIT_TIMEOUT_MS = 5000;
const MAX_CANDIDATES = 32;
const CONCURRENCY = 8;
const MAX_FAILURES = 6;
const RECORD_LIMIT = 64 * 1024;
const GIT_FILE_LIMIT = 4 * 1024;
const LISTING_BUFFER = 4 * 1024 * 1024;
const BLOB_BUFFER = 128 * 1024;
const BRANCH_PREFIX = "refs/heads/opus/";
const OPUS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LIVE_STATES = new Set(["building", "verifying", "review"]);
/** `<id>.md`, for an id already bound by {@link OPUS_ID} (no separator can reach a path). */
const recordFile = (id: string): string => id + ".md";
const LIVE_KEYS = ["state", "traditio", "heartbeat"] as const;

// ---------------------------------------------------------------------------
// the shared opener: the only way this module opens a file the builder controls
// ---------------------------------------------------------------------------
export type Refusal = "not-regular" | "changed" | "escapes" | "too-large" | "timeout" | "unreadable";
export interface OpenerOptions {
  /** Test-only: called between the `lstat` and the `open`, so a row can swap the file exactly there. */
  afterLstat?: () => void | Promise<void>;
  /** Overrides the wall-clock timer (default {@link DEFAULT_GIT_TIMEOUT_MS}). */
  timeoutMs?: number;
}

/**
 * `lstat` must say a regular file; `open` is `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (so a FIFO or a device cannot park
 * it); `fstat` on the fd must say a regular file with the `lstat`'s dev/ino; the realpath of `/proc/self/fd/<n>` must
 * lie under `root`; at most `maxBytes` + 1 bytes are read (the `fstat` size is not trusted). The whole sequence races
 * a wall-clock timer, and the fd is closed in a `finally` on every path, including a lost race.
 */
export async function readBoundedRegular(
  path: string,
  root: string,
  maxBytes: number,
  opts: OpenerOptions = {},
): Promise<{ text: string } | { refused: Refusal }> {
  const work = (async (): Promise<{ text: string } | { refused: Refusal }> => {
    let fh: FileHandle | undefined;
    try {
      const before = await lstat(path);
      if (!before.isFile()) return { refused: "not-regular" };
      await opts.afterLstat?.();
      fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const opened = await fh.stat();
      if (!opened.isFile()) return { refused: "not-regular" };
      if (opened.dev !== before.dev || opened.ino !== before.ino) return { refused: "changed" };
      const real = await realpath(`/proc/self/fd/${fh.fd}`);
      const rel = relative(await realpath(root), real);
      if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return { refused: "escapes" };
      const buffer = Buffer.alloc(maxBytes + 1);
      let total = 0;
      while (total <= maxBytes) {
        const { bytesRead } = await fh.read(buffer, total, maxBytes + 1 - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > maxBytes) return { refused: "too-large" };
      return { text: buffer.subarray(0, total).toString("utf8") };
    } catch (e) {
      return { refused: (e as NodeJS.ErrnoException).code === "ELOOP" ? "changed" : "unreadable" };
    } finally {
      await fh?.close().catch(() => undefined);
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ refused: Refusal }>((done) => {
    timer = setTimeout(() => done({ refused: "timeout" }), opts.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// read-only git
// ---------------------------------------------------------------------------
type GitResult = { ok: true; stdout: string } | { ok: false; reason: StatusReason | "too-large"; code?: number; stderr: string };

/** A scrubbed environment: no GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR/GIT_CONFIG*, no optional locks. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR)$/.test(k) || k.startsWith("GIT_CONFIG")) continue;
    env[k] = v;
  }
  return { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
}

function git(args: string[], cwd: string, timeoutMs: number, maxBuffer: number): Promise<GitResult> {
  return new Promise((done) => {
    execFile("git", args, { cwd, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer, env: gitEnv(), encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) return done({ ok: true, stdout });
      const e = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
      if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return done({ ok: false, reason: "too-large", stderr });
      if (e.code === "ENOENT") return done({ ok: false, reason: "git-missing", stderr });
      if (e.killed === true || e.signal === "SIGKILL") return done({ ok: false, reason: "git-timeout", stderr });
      const exit = (error as { code?: unknown }).code;
      done({ ok: false, reason: "git-error", code: typeof exit === "number" ? exit : undefined, stderr: String(stderr) });
    });
  });
}

/** `map` with at most `limit` in flight, results in input order. */
async function pooled<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++;
        out[at] = await fn(items[at]!);
      }
    }),
  );
  return out;
}

/** `git worktree list --porcelain -z`: branch ref -> worktree path (detached and bare entries have no branch). */
function parseWorktrees(stdout: string): Map<string, string> {
  const byBranch = new Map<string, string>();
  let path: string | undefined;
  for (const field of stdout.split("\0")) {
    if (field === "") {
      path = undefined;
      continue;
    }
    if (field.startsWith("worktree ")) path = field.slice("worktree ".length);
    else if (field.startsWith("branch ") && path !== undefined) byBranch.set(field.slice("branch ".length), path);
  }
  return byBranch;
}

const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
};

// ---------------------------------------------------------------------------
// the reader
// ---------------------------------------------------------------------------
interface Repo {
  top: string;
  commonDir: string;
  studioRel: string;
}
interface Candidate {
  id: string;
  sha: string;
  worktree?: string;
}

export class BranchRecordReader {
  private off = false;
  private repo?: Repo;
  private failures = 0;
  private overlay: Overlay = new Map();
  private lastKey = "ok|";

  constructor(
    private readonly studioDir: string,
    private readonly gitTimeoutMs: number = DEFAULT_GIT_TIMEOUT_MS,
  ) {}

  /** One refresh. Never throws: a failure keeps the last good overlay (stale) and is reported in the status. */
  async refresh(): Promise<{ overlay: Overlay; status: BranchRecordsStatus }> {
    let result: { overlay: Overlay; status: BranchRecordsStatus };
    try {
      result = await this.run();
    } catch {
      result = this.failed("git-error");
    }
    this.report(result.status);
    return result;
  }

  private failed(reason: StatusReason): { overlay: Overlay; status: BranchRecordsStatus } {
    this.failures++;
    if (this.failures >= MAX_FAILURES) this.overlay = new Map();
    const status: BranchRecordsStatus["status"] = this.failures >= MAX_FAILURES ? "unavailable" : "stale";
    return { overlay: this.overlay, status: { status, failures: this.failures, reason, dropped: [] } };
  }

  private async run(): Promise<{ overlay: Overlay; status: BranchRecordsStatus }> {
    if (this.off) return { overlay: new Map(), status: { status: "off", dropped: [] } };
    const timeout = this.gitTimeoutMs;

    if (this.repo === undefined) {
      const probe = await git(["rev-parse", "--show-toplevel", "--git-common-dir"], this.studioDir, timeout, LISTING_BUFFER);
      if (!probe.ok) {
        if (probe.reason === "git-error" && probe.code === 128 && /not a git repository/i.test(probe.stderr)) {
          this.off = true;
          return { overlay: new Map(), status: { status: "off", dropped: [] } };
        }
        this.failures++;
        return { overlay: new Map(), status: { status: "unavailable", failures: this.failures, reason: probe.reason === "too-large" ? "git-error" : probe.reason, dropped: [] } };
      }
      const [top, common] = probe.stdout.split("\n");
      if (!top || !common) return this.failed("git-error");
      const realTop = realpathSync(top);
      this.repo = {
        top: realTop,
        commonDir: realpathSync(resolve(this.studioDir, common)),
        studioRel: relative(realTop, realpathSync(this.studioDir)).split("\\").join("/"),
      };
    }
    const repo = this.repo;

    const [refs, trees] = await Promise.all([
      git(["for-each-ref", "--sort=-committerdate", "--format=%(objectname)%00%(refname)", BRANCH_PREFIX], repo.top, timeout, LISTING_BUFFER),
      git(["worktree", "list", "--porcelain", "-z"], repo.top, timeout, LISTING_BUFFER),
    ]);
    const bad = !refs.ok ? refs : !trees.ok ? trees : undefined;
    if (bad !== undefined || !refs.ok || !trees.ok) return this.failed(bad === undefined || bad.reason === "too-large" ? "git-error" : bad.reason);
    this.failures = 0;

    const worktrees = parseWorktrees(trees.stdout);
    const found: Candidate[] = [];
    for (const line of refs.stdout.split("\n")) {
      const [sha, ref] = line.split("\0");
      if (!sha || !ref || !ref.startsWith(BRANCH_PREFIX)) continue;
      const id = ref.slice(BRANCH_PREFIX.length);
      if (!OPUS_ID.test(id) || !existsSync(join(this.studioDir, "opera", recordFile(id)))) continue;
      found.push({ id, sha, worktree: worktrees.get(ref) });
    }
    // Worktree-backed first, then newest commit first (for-each-ref already sorted by committer date).
    const ordered = [...found.filter((c) => c.worktree !== undefined), ...found.filter((c) => c.worktree === undefined)];
    const read = ordered.slice(0, MAX_CANDIDATES);
    const capped = ordered.length - read.length;

    const dropped: BranchRecordsStatus["dropped"] = [];
    let liveRejected = 0;
    const overlay: Overlay = new Map();
    const entries = await pooled(read, CONCURRENCY, (c) => this.readCandidate(repo, c));
    for (let i = 0; i < read.length; i++) {
      const entry = entries[i]!;
      if ("dropped" in entry) dropped.push({ id: read[i]!.id, reason: entry.dropped });
      else {
        overlay.set(read[i]!.id, entry.entry);
        if (entry.liveRejected) liveRejected++;
      }
    }
    this.overlay = overlay;
    const status: BranchRecordsStatus = { status: dropped.length > 0 || capped > 0 ? "partial" : "ok", dropped, liveRejected };
    if (capped > 0) status.capped = capped;
    return { overlay, status };
  }

  /** The committed tip is the base; a passing live read may change only state/traditio/heartbeat. */
  private async readCandidate(repo: Repo, c: Candidate): Promise<{ entry: OverlayEntry; liveRejected: boolean } | { dropped: DropReason }> {
    const rel = posix.join(repo.studioRel, "opera", recordFile(c.id));
    const blob = await git(["cat-file", "blob", `${c.sha}:${rel}`], repo.top, this.gitTimeoutMs, BLOB_BUFFER);
    if (!blob.ok) return { dropped: blob.reason === "too-large" ? "too-large" : "unreadable" };
    if (Buffer.byteLength(blob.stdout) > RECORD_LIMIT) return { dropped: "too-large" };
    const base = parseRecord(blob.stdout, c.id);
    if ("dropped" in base) return base;
    if (c.worktree === undefined) return { entry: base.entry, liveRejected: false };

    const live = await this.readLive(repo, c, rel);
    if (live === undefined) return { entry: base.entry, liveRejected: true };
    const data = { ...base.entry.data };
    for (const key of LIVE_KEYS) if (live[key] !== undefined) data[key] = live[key];
    return { entry: { data, body: base.entry.body }, liveRejected: false };
  }

  private async readLive(repo: Repo, c: Candidate, rel: string): Promise<Record<string, unknown> | undefined> {
    const wt = c.worktree!;
    const opts = { timeoutMs: this.gitTimeoutMs };
    try {
      // The worktree must prove it belongs to this repository: its .git points into <common-dir>/worktrees/, and
      // that admin directory names this very worktree back.
      const pointer = await readBoundedRegular(join(wt, ".git"), wt, GIT_FILE_LIMIT, opts);
      if (!("text" in pointer)) return undefined;
      const target = /^gitdir: (.+?)\r?\n?$/.exec(pointer.text)?.[1];
      if (target === undefined) return undefined;
      const admin = realpathSync(resolve(wt, target));
      const adminRoot = join(repo.commonDir, "worktrees");
      if (!isInside(adminRoot, admin)) return undefined;
      const back = await readBoundedRegular(join(admin, "gitdir"), adminRoot, GIT_FILE_LIMIT, opts);
      if (!("text" in back)) return undefined;
      const named = resolve(admin, back.text.trim());
      if (!named.endsWith("/.git") || realpathSync(named.slice(0, -"/.git".length)) !== realpathSync(wt)) return undefined;

      const record = await readBoundedRegular(join(wt, rel), wt, RECORD_LIMIT, opts);
      if (!("text" in record)) return undefined;
      const parsed = parseRecord(record.text, c.id);
      if ("dropped" in parsed) return undefined;
      return LIVE_STATES.has(String(parsed.entry.data["state"])) ? parsed.entry.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** One stderr line when the status or reason changes: a fixed prefix then JSON, so nothing record-derived is raw. */
  private report(s: BranchRecordsStatus): void {
    if (s.status === "off") return;
    const key = `${s.status}|${s.reason ?? ""}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const line = JSON.stringify({ status: s.status, reason: s.reason, failures: s.failures, capped: s.capped, liveRejected: s.liveRejected, dropped: s.dropped });
    process.stderr.write(`${STATUS_PREFIX}${line}\n`);
  }
}

/** Parse and validate one record text; the id must be the branch's. Reasons are fixed codes only. */
function parseRecord(text: string, id: string): { entry: OverlayEntry } | { dropped: DropReason } {
  if (!/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.test(text)) return { dropped: "no-front-matter" };
  let parsed: { data: unknown; body: string };
  try {
    parsed = parseFrontMatter<unknown>(text);
  } catch {
    return { dropped: "parse-error" };
  }
  const data = parsed.data;
  if (typeof data !== "object" || data === null || (data as Record<string, unknown>)["id"] !== id) return { dropped: "id-mismatch" };
  if (validateOpusFront(data) !== undefined) return { dropped: "invalid-shape" };
  return { entry: { data: data as Record<string, unknown>, body: parsed.body } };
}
