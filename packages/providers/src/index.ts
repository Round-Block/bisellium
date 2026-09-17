/**
 * @bisellium/providers — provider status seam (W-007). Sources observed
 * limit telemetry from two places and composes it into the Provider[] the
 * schema (`AdapterBase.providerStatus`) and console expect:
 *
 *  - usage.yml: Patron-declared/observed, read the same way adapters/native
 *    already reads it (docs/ADOPTION.md).
 *  - quota-axi: a live CLI, when installed and authenticated.
 *
 * A source never throws. quota-axi degrades to {providers: [], note} on a
 * missing binary, a timeout, or JSON it can't parse — a flaky or absent
 * external tool must never break `bisellium check`, `bisellium providers`,
 * or SnapshotAdapter#providerStatus().
 */
import { spawn } from "node:child_process";
import type { Provider, ProviderStatus } from "@bisellium/schema";
import { readUsageProviders } from "@bisellium/adapter-native";

export interface ProviderStatusSource {
  /** Source id. compositeSource prefixes every merged Provider.note with it
   *  ("quota-axi: …" / "usage.yml: …") so a console never has to guess where
   *  a number came from. */
  id: string;
  read(opts: { now: Date }): Promise<{ providers: Provider[]; note?: string }>;
}

// ---------------------------------------------------------------------------
// usage.yml — observed, Patron-declared telemetry.
// ---------------------------------------------------------------------------

export function usageYamlSource(root: string): ProviderStatusSource {
  return {
    id: "usage.yml",
    async read() {
      const { providers, notes } = readUsageProviders(root);
      // A malformed entry (e.g. `- {}`) must still be visible somewhere —
      // it produces nothing as a Provider row, so it surfaces as a note
      // instead of vanishing silently.
      return { providers, note: notes.length > 0 ? notes.join("; ") : "observed" };
    },
  };
}

// ---------------------------------------------------------------------------
// quota-axi — live CLI telemetry.
// ---------------------------------------------------------------------------

export interface QuotaAxiOptions {
  /** Shell-split into binary + leading args, e.g. "npx --yes quota-axi". */
  command?: string;
  timeoutMs?: number;
  /** Restricts quota-axi's own --provider filter; omit for all providers. */
  providers?: string[];
}

// Same thresholds as adapters/native's aerarium posture() (docs/ADOPTION.md /
// epoch0 ART_WORKFLOW §10): <60 ok, >=60 conserve, >=85 closeout, >=100 limited.
function statusForUsagePct(usagePct: number): ProviderStatus {
  if (usagePct >= 100) return "limited";
  if (usagePct >= 85) return "closeout";
  if (usagePct >= 60) return "conserve";
  return "ok";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const numOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strOf = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

interface RawWindow {
  id?: unknown;
  resetsAt?: unknown;
  percentRemaining?: unknown;
}
interface RawAvailability {
  scope?: unknown;
  status?: unknown;
  effectivePercentRemaining?: unknown;
  limitingWindowIds?: unknown;
  pace?: unknown;
  runway?: unknown;
}
interface RawProvider {
  provider?: unknown;
  windows?: unknown;
  credits?: unknown;
  state?: unknown;
  quotaSemantics?: unknown;
}

function windowsOf(raw: RawProvider): RawWindow[] {
  return Array.isArray(raw.windows) ? raw.windows.filter(isObj) : [];
}

/** The effectiveAvailability entry scoped to all_models, or the first one. */
function availabilityOf(raw: RawProvider): RawAvailability | undefined {
  const semantics = isObj(raw.quotaSemantics) ? raw.quotaSemantics : undefined;
  const avail = semantics ? semantics["effectiveAvailability"] : undefined;
  if (!Array.isArray(avail)) return undefined;
  const list = avail.filter(isObj) as RawAvailability[];
  return list.find((a) => a.scope === "all_models") ?? list[0];
}

/** The most-constrained window (lowest percentRemaining) with numeric data. */
function tightestWindow(windows: RawWindow[]): { pct: number; resetAt?: string } | undefined {
  let best: { pct: number; resetAt?: string } | undefined;
  for (const w of windows) {
    const pct = numOf(w.percentRemaining);
    if (pct === undefined) continue;
    if (!best || pct < best.pct) best = { pct, resetAt: strOf(w.resetsAt) };
  }
  return best;
}

function resetAtFor(windows: RawWindow[], availability: RawAvailability | undefined): string | undefined {
  const limiting = availability?.limitingWindowIds;
  const limitId = Array.isArray(limiting) ? strOf(limiting[0]) : undefined;
  const byLimit = limitId ? windows.find((w) => w.id === limitId) : undefined;
  return strOf((byLimit ?? windows[0])?.resetsAt);
}

function mapProvider(raw: RawProvider): Provider | undefined {
  const id = strOf(raw.provider);
  if (!id) return undefined;

  const windows = windowsOf(raw);
  const availability = availabilityOf(raw);

  let remainingPct: number | undefined;
  let resetAt: string | undefined;
  if (availability?.status === "known") {
    const pct = numOf(availability.effectivePercentRemaining);
    if (pct !== undefined) {
      remainingPct = pct;
      resetAt = resetAtFor(windows, availability);
    }
  }
  if (remainingPct === undefined) {
    const tightest = tightestWindow(windows);
    if (tightest) {
      remainingPct = tightest.pct;
      resetAt = resetAt ?? tightest.resetAt;
    }
  }

  const credits = isObj(raw.credits) ? raw.credits : undefined;
  const creditsExhausted = credits !== undefined && numOf(credits["remaining"]) === 0 && credits["unlimited"] === false;
  const runway = isObj(availability?.runway) ? availability.runway : undefined;
  const runwayExhausted = runway?.["status"] === "exhausted_now";
  const state = isObj(raw.state) ? raw.state : undefined;
  const stateStatus = state ? strOf(state["status"]) : undefined;
  const explicitExhausted = creditsExhausted || runwayExhausted || stateStatus === "exhausted";

  const haveData = remainingPct !== undefined;
  const usagePct = haveData ? clampPct(100 - remainingPct!) : explicitExhausted ? 100 : 0;

  const status: ProviderStatus = explicitExhausted ? "limited" : haveData ? statusForUsagePct(usagePct) : "unknown";

  const pace = isObj(availability?.pace) ? availability.pace : undefined;
  const paceStatus = pace ? strOf(pace["status"]) : undefined;
  const runwayStatus = runway ? strOf(runway["status"]) : undefined;
  const stateError = state ? strOf(state["error"]) : undefined;

  const noteParts: string[] = [];
  if (paceStatus) noteParts.push(`pace ${paceStatus}`);
  if (runwayStatus) noteParts.push(`runway ${runwayStatus}`);
  if (noteParts.length === 0 && stateError) noteParts.push(stateError);
  else if (noteParts.length === 0 && stateStatus && stateStatus !== "fresh") noteParts.push(stateStatus);

  return { id, usagePct, resetAt, status, note: noteParts.length > 0 ? noteParts.join(", ") : undefined };
}

/** Grace period between SIGTERM and SIGKILL when a probe times out. */
const KILL_GRACE_MS = 5_000;

function runCommand(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { shell: process.platform === "win32" });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    // A quota-axi probe that hangs must never hold the CLI process open —
    // unref it so a timed-out child can't block process exit, and escalate
    // SIGTERM to SIGKILL if it doesn't stop on its own.
    child.unref();

    let out = "";
    let err = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (settled) return; // already rejected on timeout — a late close is a no-op
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err.trim() || `exited with code ${String(code)}`));
      else resolvePromise(out);
    });
  });
}

export function quotaAxiSource(options: QuotaAxiOptions = {}): ProviderStatusSource {
  const command = options.command ?? "npx --yes quota-axi";
  const timeoutMs = options.timeoutMs ?? 60_000;
  const providerFilter = options.providers;

  return {
    id: "quota-axi",
    async read(): Promise<{ providers: Provider[]; note?: string }> {
      const parts = command.split(/\s+/).filter((p) => p.length > 0);
      const bin = parts[0];
      if (!bin) return { providers: [], note: "quota-axi unavailable: empty command" };
      const args = [...parts.slice(1), "--json", "--no-credential-refresh"];
      if (providerFilter && providerFilter.length > 0) args.push("--provider", providerFilter.join(","));

      let stdout: string;
      try {
        stdout = await runCommand(bin, args, timeoutMs);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return { providers: [], note: `quota-axi unavailable: ${reason}` };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return { providers: [], note: "quota-axi unavailable: unparseable JSON" };
      }
      const rawList = isObj(parsed) && Array.isArray(parsed["providers"]) ? (parsed["providers"] as unknown[]) : undefined;
      if (!rawList) return { providers: [], note: "quota-axi unavailable: unexpected JSON shape" };

      const providers = rawList
        .filter(isObj)
        .map((r) => mapProvider(r as RawProvider))
        .filter((p): p is Provider => p !== undefined);
      return { providers };
    },
  };
}

// ---------------------------------------------------------------------------
// compositeSource — per provider id, an earlier (live) source wins; later
// sources (usage.yml) only fill ids the earlier ones didn't report.
// ---------------------------------------------------------------------------

export function compositeSource(sources: ProviderStatusSource[]): ProviderStatusSource {
  return {
    id: "composite",
    async read(opts) {
      const results = await Promise.all(sources.map((s) => s.read(opts)));
      const byId = new Map<string, Provider>();
      const sourceNotes: string[] = [];
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]!;
        const res = results[i]!;
        if (res.note) sourceNotes.push(`${src.id}: ${res.note}`);
        for (const p of res.providers) {
          if (byId.has(p.id)) continue; // an earlier, higher-priority source already reported this id
          byId.set(p.id, { ...p, note: `${src.id}: ${p.note ?? res.note ?? "no detail"}` });
        }
      }
      return { providers: [...byId.values()], note: sourceNotes.length > 0 ? sourceNotes.join("; ") : undefined };
    },
  };
}
