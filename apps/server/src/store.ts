/**
 * apps/server/src/store.ts — apps/server's `Store` **is** `@bisellium/core`'s
 * `Store` (W-016, cascade-4 review). It used to re-implement its own JSONL
 * append / snapshot-diff / per-source-seq bookkeeping against the same
 * `events.jsonl` `@bisellium/core`'s Store already owns — which meant the
 * SQLite index (W-013) a running server never touched was dead code, and
 * `.bisellium/index/index.db` never existed for a served studio.
 *
 * `Store` here subclasses `@bisellium/core`'s `Store` directly: `ingestOnce()`
 * diffs one fresh `SnapshotAdapter` snapshot through the parent's real
 * `ingest(snapshot, ctx)` (log append, persisted snapshot, SQLite index
 * apply, and — since core's Store is now an `EventEmitter` too — the single
 * `"event"` emission the SSE route subscribes to). `.query` is therefore
 * the real `Index` (`store.query.opera()` etc.), unchanged from core.
 *
 * `.api` is a SEPARATE facade, deliberately not named `.query`, so it can
 * never shadow the Index's own same-named methods: every existing HTTP
 * route's response shape (officina, opus front matter, needs-you, acta,
 * aerarium, provider posture, health, timeline-as-jsonl, receipts) is
 * unchanged from before this rewrite, still built by re-reading the
 * studio's files on demand through `@bisellium/adapter-native` — nothing
 * here is cached across calls, so a concurrent CLI write is visible on the
 * next request with no invalidation logic, same as before.
 *
 * apps/server must never import `@bisellium/cli` or `@bisellium/commands`
 * (that was cascade-4's actual dependency cycle) — `checkStudio` is passed
 * into `.api.health()` by the caller (apps/server/src/http.ts, itself handed
 * it via `StartServerOptions.checkStudio`, injected by
 * packages/cli/src/serve.ts) rather than imported here. Pause-state and the
 * cadence "due" list are small enough to read/compute directly against the
 * studio's own files instead of reaching for packages/cli/src/{pause,tick}.ts.
 */
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { GantryEvent, SnapshotAdapter } from "@bisellium/schema";
import { computeMeter, EVENTS_LOG_REL, estimateFinish, readLog, Store as CoreStore } from "@bisellium/core";
import { createBiselliumAdapter, isoWeek, listMd, readFront, readManifest, readMilestones, resolveSeat, snapshotDir, type Manifest } from "@bisellium/adapter-native";
import { BranchRecordReader, type BranchRecordsStatus, type Overlay } from "./branchRecords.js";

/** This server's own ingestion source id, stamped as `workflow.source` on
 *  every event it appends — distinct from "cli" (packages/commands/writes.ts's
 *  emit/Patron writes) so the two never fight over the same per-source seq. */
const INGEST_SOURCE = "server";

export interface StoreOptions {
  studioDir: string;
  /** Pinned clock, for reproducible query results in tests — every query
   *  that needs "now" uses this instant repeatedly rather than sampling the
   *  real clock mid-run, same convention as every other command's `--now`. */
  now?: Date;
  /** providerStatus() runs quota-axi (a live subprocess) only when true. */
  live?: boolean;
  /** W-129: the wall-clock bound on every read-only git call (and file open) of the branch-record refresh. */
  branchGitTimeoutMs?: number;
}

interface OpusFrontMatter {
  id: string;
  title?: string;
  kind?: string;
  collegium?: string;
  sella?: string;
  state: string;
  probationes?: Record<string, unknown>;
  tokens?: number;
  traditio?: Record<string, unknown>;
  [key: string]: unknown;
}

function safeId(id: string): boolean {
  return id.length > 0 && !/[\\/]/.test(id) && id !== "." && id !== "..";
}

const OPUS_BODY_LIMIT_BYTES = 64 * 1024;
const OPUS_FRONT_MATTER_LIMIT_BYTES = 64 * 1024;
const OPUS_BODY_TRUNCATION_MARKER = "\n\n[Record body truncated at 64 KiB.]";

function bodyOffset(raw: Buffer): number | undefined {
  const bomBytes = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? 3 : 0;
  const lfOpening = Buffer.from("---\n");
  const crlfOpening = Buffer.from("---\r\n");
  let openingLength: number;
  if (raw.subarray(bomBytes, bomBytes + lfOpening.length).equals(lfOpening)) openingLength = lfOpening.length;
  else if (raw.subarray(bomBytes, bomBytes + crlfOpening.length).equals(crlfOpening)) openingLength = crlfOpening.length;
  else return undefined;

  const searchFrom = bomBytes + openingLength - 1;
  const endings = [Buffer.from("\n---\n"), Buffer.from("\r\n---\r\n")]
    .map((delimiter) => ({ delimiter, index: raw.indexOf(delimiter, searchFrom) }))
    .filter((candidate) => candidate.index !== -1)
    .sort((a, b) => a.index - b.index);
  const ending = endings[0];
  return ending ? ending.index + ending.delimiter.length : undefined;
}

/**
 * Read an opus body without `readFront`'s whitespace-wide `.trim()`. Bodies
 * through 64 KiB preserve every authored byte; larger bodies carry a visible
 * truncation marker. A conventional final line ending is file framing and is
 * removed only from an otherwise complete body.
 */
function readOpusBody(studioDir: string, id: string): string {
  const root = resolve(studioDir);
  const dir = join(root, "opera");
  let fd: number | undefined;
  try {
    // Match the established W-084/W-089 non-following read pattern. Every
    // traversed component is lstat'd, the final entry must be a directory-
    // enumerated regular file, and O_NOFOLLOW + fstat close the replacement
    // race at open time. The id is compared with an entry name and is never
    // interpolated into a path, so this server does not duplicate the shared
    // commands safeItemPath helper (which its production graph may not import).
    if (!lstatSync(root).isDirectory() || !lstatSync(dir).isDirectory()) return "";
    const entry = readdirSync(dir, { withFileTypes: true }).find(
      (candidate) => candidate.isFile() && candidate.name.endsWith(".md") && candidate.name.slice(0, -3) === id,
    );
    if (!entry) return "";
    const path = join(dir, entry.name);
    if (!lstatSync(path).isFile()) return "";
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (!opened.isFile()) return "";

    const header = Buffer.alloc(Math.min(opened.size, OPUS_FRONT_MATTER_LIMIT_BYTES));
    const headerBytes = readSync(fd, header, 0, header.length, 0);
    const offset = bodyOffset(header.subarray(0, headerBytes));
    if (offset === undefined) return "";

    const available = Math.max(0, opened.size - offset);
    const bodyBuffer = Buffer.alloc(Math.min(available, OPUS_BODY_LIMIT_BYTES + 2));
    const bytesRead = readSync(fd, bodyBuffer, 0, bodyBuffer.length, offset);
    const bodyBytes = bodyBuffer.subarray(0, bytesRead);
    const onlyFramingLf = available === OPUS_BODY_LIMIT_BYTES + 1 && bodyBytes[OPUS_BODY_LIMIT_BYTES] === 0x0a;
    const onlyFramingCrlf =
      available === OPUS_BODY_LIMIT_BYTES + 2 &&
      bodyBytes[OPUS_BODY_LIMIT_BYTES] === 0x0d &&
      bodyBytes[OPUS_BODY_LIMIT_BYTES + 1] === 0x0a;
    const truncated = available > OPUS_BODY_LIMIT_BYTES && !onlyFramingLf && !onlyFramingCrlf;
    if (truncated) {
      const decoder = new StringDecoder("utf8");
      return decoder.write(bodyBytes.subarray(0, OPUS_BODY_LIMIT_BYTES)) + OPUS_BODY_TRUNCATION_MARKER;
    }
    return bodyBytes.toString("utf8").replace(/\r?\n$/, "");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The body read has already failed or completed; closing cannot
        // change the honest empty/truncated response selected above.
      }
    }
  }
}

/** An overlay body with `readOpusBody`'s 64 KiB cap and truncation marker. */
function capBody(body: string): string {
  const bytes = Buffer.from(body, "utf8");
  if (bytes.length <= OPUS_BODY_LIMIT_BYTES) return body;
  return new StringDecoder("utf8").write(bytes.subarray(0, OPUS_BODY_LIMIT_BYTES)) + OPUS_BODY_TRUNCATION_MARKER;
}

export type CheckStudioFn = (root: string, now?: Date) => { ok: boolean; blocks: number; advisories: number; findings: unknown[] };

/** `<studio>/PAUSED` — same shape packages/commands/pause.ts's
 *  `readPauseState` reads, duplicated here (not imported: that file lives in
 *  a package apps/server must never depend on) because it's five lines
 *  against one well-known file, not worth a cross-package seam for. */
function readPausedAt(studioDir: string): { paused: boolean; at?: string; reason?: string } {
  const p = join(studioDir, "PAUSED");
  if (!existsSync(p)) return { paused: false };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { at?: unknown; reason?: unknown };
    return {
      paused: true,
      at: typeof raw.at === "string" ? raw.at : undefined,
      reason: typeof raw.reason === "string" && raw.reason.length > 0 ? raw.reason : undefined,
    };
  } catch {
    return { paused: true };
  }
}

// ponytail: a trimmed stand-in for packages/cli/src/tick.ts's computeDue
// (aerarium + traditio only, UTC isoWeek instead of tick's timezone-aware
// one) — importing the real thing would mean importing @bisellium/cli,
// which is exactly the dependency cycle this cascade removes. Nothing in
// this brief tests /api/health's `due` contents; upgrade to the real
// computation (shared from somewhere apps/server may depend on) if that
// ever changes.
function computeDueSummary(studioDir: string, manifest: Manifest, now: Date, overlay?: Overlay): { kind: string; id: string }[] {
  const due: { kind: string; id: string }[] = [];
  const activeCollegia = manifest.collegia.filter((c) => (c.autonomy ?? "L1") !== "L0");
  if (activeCollegia.length === 0) return due;

  const period = isoWeek(now);
  if (!existsSync(join(studioDir, "aerarium", `${period}.yml`))) due.push({ kind: "aerarium", id: period });

  const activeCollegiumIds = new Set(activeCollegia.map((c) => c.id));
  for (const p of listMd(join(studioDir, "opera"))) {
    try {
      const disk = readFront<{ id?: unknown; collegium?: unknown; traditio?: unknown }>(p).data;
      // W-129: a branch-owned record's handoff is the live one, not the trunk's frozen copy.
      const data = (typeof disk.id === "string" ? overlay?.get(disk.id)?.data : undefined) ?? disk;
      if (typeof data.id !== "string" || typeof data.collegium !== "string" || !activeCollegiumIds.has(data.collegium)) continue;
      const traditio = data.traditio;
      const at = typeof traditio === "object" && traditio !== null ? (traditio as Record<string, unknown>)["at"] : undefined;
      const atDate = typeof at === "string" ? new Date(at) : undefined;
      if (!atDate || Number.isNaN(atDate.getTime())) continue;
      const ageDays = (now.getTime() - atDate.getTime()) / 86_400_000;
      if (ageDays > 3) due.push({ kind: "traditio", id: data.id });
    } catch {
      // unreadable opus: skip, same degradation check.ts's safeList takes
    }
  }
  return due;
}

// ---------------------------------------------------------------------------
// W-065: `<studio>/models.json` — the probe-battery opus's record (never
// written here; this is a reader only, same shape/place as health.json).
// ---------------------------------------------------------------------------

export type ModelState = "available" | "unavailable" | "unverified";
export interface ModelRecordEntry {
  id: string;
  harness?: string;
  state: ModelState;
  vendorDiagnostic?: string;
}

/** Advisory data, never instructions (standing rule): an absent or
 *  unparseable file degrades to `undefined` rather than throwing — the
 *  `/api/officina` route never blocks on bookkeeping it did not write.
 *  Malformed individual entries are skipped rather than failing the whole
 *  read, same tolerance `readUsageProviders` already uses. */
function readModelsRecord(studioDir: string): ModelRecordEntry[] | undefined {
  const path = join(studioDir, "models.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
    if (!Array.isArray(parsed.models)) return undefined;
    const states = new Set(["available", "unavailable", "unverified"]);
    const models: ModelRecordEntry[] = [];
    for (const raw of parsed.models) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r["id"] !== "string" || typeof r["state"] !== "string" || !states.has(r["state"])) continue;
      models.push({
        id: r["id"],
        state: r["state"] as ModelState,
        harness: typeof r["harness"] === "string" ? r["harness"] : undefined,
        vendorDiagnostic: typeof r["vendorDiagnostic"] === "string" ? r["vendorDiagnostic"] : undefined,
      });
    }
    return models;
  } catch {
    return undefined;
  }
}

/** W-077: `tick` writes `due` as `{kind, sella|period|opus|models}`; the declared shape is `{kind, id}`. */
function namedDue(due: unknown): { kind: string; id: string }[] {
  if (!Array.isArray(due)) return [];
  const field: Record<string, string> = Object.assign(Object.create(null), { daily: "sella", aerarium: "period", traditio: "opus" });
  return due.map((raw: unknown) => {
    const item = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const kind = typeof item["kind"] === "string" ? item["kind"] : "unknown";
    const named = field[kind] === undefined ? undefined : item[field[kind]!];
    if (typeof item["id"] === "string") return { kind, id: item["id"] };
    if (typeof named === "string") return { kind, id: named };
    if (kind === "probe" && Array.isArray(item["models"])) return { kind, id: `${item["models"].length} pair(s)` };
    return { kind, id: "unknown" };
  });
}

export class Store extends CoreStore {
  readonly projectId: string;
  private readonly live: boolean;
  private readonly fixedNow?: Date;
  private readonly adapter: SnapshotAdapter;
  /** W-129: opus-branch records read once per poll (a Map, so an id such as `constructor` is harmless) and replaced
   *  atomically; requests only read it. */
  private overlay: Overlay = new Map();
  private branchRecords: BranchRecordsStatus = { status: "ok", dropped: [] };
  private readonly branchReader: BranchRecordReader;

  constructor(opts: StoreOptions) {
    super({ studioDir: opts.studioDir });
    this.live = opts.live ?? false;
    this.fixedNow = opts.now;
    this.branchReader = new BranchRecordReader(this.studioDir, opts.branchGitTimeoutMs);
    this.adapter = createBiselliumAdapter(this.studioDir, undefined, { live: this.live, overlay: (id) => this.overlay.get(id) });
    this.projectId = this.adapter.projectId;
  }

  /** The one place a request-side snapshot is built, so every route sees the same branch-owned records. */
  private snap(now: Date = this.now()) {
    return snapshotDir(this.studioDir, this.projectId, now, (id) => this.overlay.get(id));
  }

  private now(): Date {
    return this.fixedNow ?? new Date();
  }

  private manifest(): Manifest {
    return readManifest(this.studioDir);
  }

  private modelsRecord(): ModelRecordEntry[] | undefined {
    return readModelsRecord(this.studioDir);
  }

  /** Sella id, or the manifest's patron id — the set of ids the timeline/
   *  receipts routes accept before answering 404 for anything else. */
  private knownParty(id: string): boolean {
    const m = this.manifest();
    return id === (m.patron ?? "patron") || resolveSeat(m, id) !== undefined;
  }

  sellaExists(id: string): boolean {
    return this.knownParty(id);
  }

  /** Diffs one fresh snapshot into the shared log + SQLite index (via
   *  `@bisellium/core`'s `Store.ingest`, which also emits `"event"` for the
   *  HTTP layer's SSE route) under this server's own source id. Returns the
   *  events just appended (empty when nothing changed). */
  async ingestOnce(): Promise<GantryEvent[]> {
    const refreshed = await this.branchReader.refresh();
    this.overlay = refreshed.overlay;
    this.branchRecords = refreshed.status;
    const now = this.now();
    const manifest = this.manifest();
    const humanGates = new Set(manifest.probationes.filter((g) => g.kind === "human").map((g) => g.id));
    const snapshot = await this.adapter.snapshot();
    return this.ingest(snapshot, { source: INGEST_SOURCE, ts: now.toISOString(), projectId: this.projectId, humanGates });
  }

  /** The HTTP layer's read model — every existing route's exact response
   *  shape, kept off `.query` (the real Index) on purpose; see file header. */
  readonly api = {
    officina: (): {
      studio: string;
      patron: string;
      collegia: { id: string; name: string; magister: string; fallback?: string; autonomy: string }[];
      sellae: Manifest["sellae"];
      probationes: Manifest["probationes"];
      wip_limit?: number;
      tiers?: Manifest["tiers"];
      munera?: Manifest["munera"];
      models?: ModelRecordEntry[];
      lifecycle: { id: string; states: { id: string; name: string; phase: string }[] };
      branchRecords: BranchRecordsStatus;
    } => {
      const m = this.manifest();
      // From this.adapter.describeLifecycles()[0] — id and states only.
      // Transitions are not the Board's business and `gates` would
      // duplicate this route's existing `probationes` (W-064 Interfaces).
      const lc = this.adapter.describeLifecycles()[0];
      return {
        studio: m.studio,
        patron: m.patron ?? "patron",
        collegia: m.collegia.map((c) => ({
          id: c.id,
          name: c.name,
          magister: c.magister,
          fallback: c.fallback,
          autonomy: c.autonomy ?? "L1",
        })),
        sellae: m.sellae,
        probationes: m.probationes,
        wip_limit: m.wip_limit,
        tiers: m.tiers,
        munera: m.munera,
        models: this.modelsRecord(),
        lifecycle: { id: lc?.id ?? "", states: (lc?.states ?? []).map((s) => ({ id: s.id, name: s.name, phase: s.phase })) },
        branchRecords: this.branchRecords,
      };
    },

    opera: (filters: { state?: string; collegium?: string } = {}) => {
      const snap = this.snap();
      return snap.opera
        .filter((w) => (filters.state ? w.state === filters.state : true))
        .filter((w) => (filters.collegium ? w.meta["collegium"] === filters.collegium : true))
        .map((w) => ({
          id: w.id,
          title: w.meta["title"],
          body: this.overlay.has(w.id) ? capBody(this.overlay.get(w.id)!.body) : readOpusBody(this.studioDir, w.id),
          kind: w.kind,
          collegium: w.meta["collegium"],
          sella: w.meta["sella"],
          state: w.state,
          tokens: w.meta["tokens"],
          probationes: w.probationes,
          traditio: w.meta["traditio"],
        }));
    },

    /** Front matter + body + probationes + traditio for one opus, straight
     *  off disk (not the trimmed adapter Opus) — `undefined` for an unknown
     *  or unsafe id, which the HTTP layer turns into 404 {error}. */
    opus: (id: string): { id: string; frontMatter: OpusFrontMatter; body: string; probationes: Record<string, unknown>; traditio: unknown } | undefined => {
      if (!safeId(id)) return undefined;
      const owned = this.overlay.get(id);
      if (owned !== undefined) {
        const front = owned.data as OpusFrontMatter;
        return { id: front.id, frontMatter: front, body: owned.body, probationes: front.probationes ?? {}, traditio: front.traditio };
      }
      const path = join(this.studioDir, "opera", `${id}.md`);
      if (!existsSync(path)) return undefined;
      try {
        const fm = readFront<OpusFrontMatter>(path);
        return {
          id: fm.data.id,
          frontMatter: fm.data,
          body: fm.body,
          probationes: fm.data.probationes ?? {},
          traditio: fm.data.traditio,
        };
      } catch {
        return undefined;
      }
    },

    /** ADOPTION.md: "a pending gate of kind human is what needs you means". */
    needsYou: () => {
      const now = this.now();
      const manifest = this.manifest();
      const humanGates = new Set(manifest.probationes.filter((g) => g.kind === "human").map((g) => g.id));
      const snap = this.snap(now);
      const opera = snap.opera
        .filter((w) => Object.entries(w.probationes).some(([gid, g]) => humanGates.has(gid) && g.status === "pending"))
        .map((w) => ({ id: w.id, title: w.meta["title"], collegium: w.meta["collegium"], sella: w.meta["sella"], traditio: w.meta["traditio"] }));
      const petitiones = (snap.petitiones ?? [])
        .filter((p) => p.state === "needs_you")
        .map((p) => ({ id: p.id, opus: p.opusId, from: p.openedBy, subject: p.subject, body: p.body }));
      return { opera, petitiones };
    },

    acta: (days = 7) => {
      const now = this.now();
      const snap = this.snap(now);
      const cutoffMs = Math.max(0, days) * 86_400_000;
      return (snap.acta ?? [])
        .filter((a) => {
          const at = new Date(a.at);
          return !Number.isNaN(at.getTime()) && now.getTime() - at.getTime() <= cutoffMs;
        })
        .map((a) => ({ id: a.id, author: a.authorRoleId, kind: a.kind, title: a.title, at: a.at, evidence: a.evidence }));
    },

    /** Allowance + derived burn + posture per collegium — never a
     *  self-declared figure (docs/ADOPTION.md: burn is derived, never
     *  mirrored). */
    aerarium: (period?: string) => {
      const now = this.now();
      const snap = this.snap(now);
      const target = period ?? isoWeek(now);
      return (snap.stipendia ?? [])
        .filter((s) => s.period === target)
        .map((s) => ({ collegium: s.collegiumId, period: s.period, allowance: s.allowance, burn: s.burn, posture: s.posture }));
    },

    providers: async (live = false) => {
      const adapter = live === this.live ? this.adapter : createBiselliumAdapter(this.studioDir, this.projectId, { live });
      return (await adapter.providerStatus?.()) ?? [];
    },

    /** `<studio>/health.json` if `bisellium tick` has already written one,
     *  else a fresh `checkStudio` summary computed on the spot — `checkStudio`
     *  is injected (StartServerOptions), never imported: apps/server must
     *  not depend on @bisellium/cli. */
    health: (checkStudio: CheckStudioFn): unknown => {
      const healthPath = join(this.studioDir, "health.json");
      if (existsSync(healthPath)) {
        try {
          const file = JSON.parse(readFileSync(healthPath, "utf8")) as Record<string, unknown>;
          return { ...file, due: namedDue(file["due"]) };
        } catch {
          // corrupt health.json: fall through to a fresh summary below
        }
      }
      const now = this.now();
      const manifest = this.manifest();
      const result = checkStudio(this.studioDir, now);
      const findingsByRule: Record<string, number> = {};
      for (const f of result.findings as { rule: string }[]) findingsByRule[f.rule] = (findingsByRule[f.rule] ?? 0) + 1;
      const pause = readPausedAt(this.studioDir);
      const due = computeDueSummary(this.studioDir, manifest, now, this.overlay);
      const autonomy: { paused: boolean; since?: string; reason?: string } = { paused: pause.paused };
      if (pause.paused && pause.at) autonomy.since = pause.at;
      if (pause.paused && pause.reason) autonomy.reason = pause.reason;
      return {
        at: now.toISOString(),
        ok: result.ok,
        blocks: result.blocks,
        advisories: result.advisories,
        findingsByRule,
        autonomy,
        lastTick: now.toISOString(),
        due,
      };
    },

    /** W-153: the completion meter and the estimated finish, read from the trunk's own records on disk (no branch
     *  overlay), as the Status page does. `checkStudio` runs once, and only when a milestone's exit is a `rule`.
     *  Both fields are null when `milestones.yml` is absent; one that does not parse throws. */
    completion: (checkStudio: CheckStudioFn): unknown => {
      const milestones = readMilestones(this.studioDir);
      if (milestones === undefined) return { meter: null, estimate: null };
      const opera: Record<string, unknown>[] = [];
      let unreadable = 0; // a record the reader cannot read is unknown work: the estimate then fails closed
      for (const file of listMd(join(this.studioDir, "opera"))) {
        try {
          const { data } = readFront<Record<string, unknown>>(file);
          if (typeof data["id"] === "string") opera.push(data);
          else unreadable++;
        } catch {
          unreadable++;
        }
      }
      const rule = milestones.some((m) => (m.exit as { rule?: unknown } | undefined)?.rule !== undefined);
      const findings = rule ? (checkStudio(this.studioDir, this.now()).findings as { rule?: unknown }[]) : [];
      const meter = computeMeter({ milestones: milestones as never, opera, findings });
      return { meter, estimate: estimateFinish({ meter, opera, now: this.now(), unreadable }) };
    },

    /** `<studio>/timeline/<sella>.jsonl` (talk chatter) or
     *  `timeline/patron.jsonl` (Patron write log). */
    timeline: (sella: string, limit?: number): Record<string, unknown>[] => {
      if (!safeId(sella)) return [];
      const path = join(this.studioDir, "timeline", `${sella}.jsonl`);
      if (!existsSync(path)) return [];
      const entries: Record<string, unknown>[] = [];
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          // corrupt line: skip, same degradation @bisellium/core's readLog uses
        }
      }
      return limit !== undefined ? entries.slice(-limit) : entries;
    },

    /** Every event in the SQLite index, with a stable `seq` (the Store's own
     *  monotonic counter — W-016 behaviour 4, never a re-derived
     *  `log.length`), optionally only those after `since` and capped at
     *  `limit`. */
    /** `item` reads a FRESH `events.jsonl` (never the Index — the survey:
     *  the Index misses every event appended by another writer for the life
     *  of the process). Ascending, same ordering as the unfiltered path;
     *  `limit` here means the LAST N (a drawer wants an item's recent
     *  history), then returned ascending — `Index.timeline`'s own
     *  `out.slice(Math.max(0, out.length - limit))` is the in-house
     *  precedent. These rows carry no `seq`: they never touched the Index. */
    events: (opts: { since?: number; limit?: number; item?: string } = {}): (GantryEvent & { seq?: number })[] => {
      if (opts.item !== undefined) {
        const { events } = readLog(join(this.studioDir, EVENTS_LOG_REL));
        const filtered = events.filter((e) => e.attrs["workflow.item.id"] === opts.item);
        return opts.limit !== undefined ? filtered.slice(Math.max(0, filtered.length - opts.limit)) : filtered;
      }
      return this.query.events(opts.since, opts.limit ?? Number.MAX_SAFE_INTEGER);
    },

    receipts: (sella?: string): Record<string, unknown>[] => {
      const dir = join(this.studioDir, "receipts");
      if (!existsSync(dir)) return [];
      let sellaDirs: string[];
      if (sella !== undefined) {
        sellaDirs = safeId(sella) ? [sella] : [];
      } else {
        try {
          sellaDirs = readdirSync(dir).filter((f) => {
            try {
              return statSync(join(dir, f)).isDirectory();
            } catch {
              return false;
            }
          });
        } catch {
          sellaDirs = [];
        }
      }
      const out: Record<string, unknown>[] = [];
      for (const s of sellaDirs) {
        const sDir = join(dir, s);
        let files: string[] = [];
        try {
          files = readdirSync(sDir).filter((f) => f.endsWith(".json"));
        } catch {
          continue;
        }
        for (const f of files) {
          try {
            out.push(JSON.parse(readFileSync(join(sDir, f), "utf8")) as Record<string, unknown>);
          } catch {
            // corrupt receipt: skip, same degradation check.ts's receipt.shape rule reports separately
          }
        }
      }
      return out;
    },
  };
}

export type { Manifest };
