/**
 * packages/commands/src/web-build.ts — W-461: the web bundle build certify's replay runs at every red commit
 * (`scripts/run-builder-host.mjs`, in the replay cell), run while a series is made: by `red` at the commit it records
 * on, and by the reds perform at each implementation commit. The command, the bundle it must leave and the failure
 * line are certify's own (`scripts/host-cells.mjs`: WEB_BUILD, WEB_BUNDLE, prepFailure), imported, never copied, so
 * the two cannot drift; the condition is certify's too: the checkout carries `apps/web/package.json`.
 *
 * It builds in place, at a clean HEAD: the caller has checked the tree. The prior bundle file is removed first, so a
 * stale one from an earlier build never stands in for this commit's. It never throws: a workspace that cannot be
 * inspected, a prior bundle path that cannot be removed (a directory, a permission) and any subprocess failure are each
 * `ok: false`, so `red` refuses and the perform holds instead of exiting through an exception.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { WEB_BUILD, WEB_BUNDLE, prepFailure } from "../../../scripts/host-cells.mjs";

/** certify's own bound on one replay preparation build */
export const WEB_BUILD_TIMEOUT_MS = 10 * 60_000;

/** `exit`, `spawn` and `bundle` are certify's kinds; `inspect` and `cleanup` are this checkout's, which certify's fresh clone never meets. */
export type WebBuildKind = "exit" | "spawn" | "bundle" | "inspect" | "cleanup";
export interface WebBuildFailed {
  kind: WebBuildKind;
  status: number | null;
  /** the error code (or message) behind `inspect`, `cleanup` or a `spawn` */
  detail?: string;
}
export interface WebBuildRefused extends WebBuildFailed {
  carried: true;
  ok: false;
  /** the last 4096 characters of the build's stdout and stderr; empty when it never ran */
  tail: string;
}
export type WebBuild = { carried: false } | { carried: true; ok: true } | WebBuildRefused;

const why = (e: unknown): string => (e as NodeJS.ErrnoException | undefined)?.code ?? (e instanceof Error ? e.message : String(e));
const MANIFEST = ["apps", "web", "package.json"] as const;

/** Build the web bundle at `root` as certify's replay does; `carried: false` when the checkout has no web workspace. Never throws. */
export function webBuild(root: string): WebBuild {
  const failed = (kind: WebBuildKind, status: number | null, tail: string, detail?: string): WebBuildRefused => ({ carried: true, ok: false, kind, status, tail, ...(detail === undefined ? {} : { detail }) });
  try {
    statSync(join(root, ...MANIFEST));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { carried: false };
    return failed("inspect", null, "", why(e));
  }
  const bundle = join(root, ...WEB_BUNDLE);
  try {
    rmSync(bundle, { force: true });
  } catch (e) {
    return failed("cleanup", null, "", why(e));
  }
  try {
    const r = spawnSync(WEB_BUILD[0]!, WEB_BUILD.slice(1), { cwd: root, encoding: "utf8", timeout: WEB_BUILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.slice(-4096);
    if (r.error !== undefined) return failed("spawn", r.status, tail, why(r.error));
    if (r.status !== 0) return failed("exit", r.status, tail);
    if (!existsSync(bundle)) return failed("bundle", 0, tail);
    return { carried: true, ok: true };
  } catch (e) {
    return failed("spawn", null, "", why(e));
  }
}

/** The failure without certify's red prefix, for a commit no red sits on. */
export function webBuildReason(b: WebBuildFailed): string {
  if (b.kind === "inspect") return `${MANIFEST.join("/")} cannot be inspected (${b.detail ?? "error"})`;
  if (b.kind === "cleanup") return `the prior ${WEB_BUNDLE.join("/")} cannot be removed (${b.detail ?? "error"})`;
  return prepFailure(0, b.kind, b.status).replace(/^red 0 replay preparation failed: /, "");
}

/** certify's own preparation line for red `behaviour`, as `run-builder-host.mjs` prints it; the same prefix for this checkout's two kinds. */
export function webBuildFailure(behaviour: number, b: WebBuildFailed): string {
  return b.kind === "inspect" || b.kind === "cleanup" ? `red ${behaviour} replay preparation failed: ${webBuildReason(b)}` : prepFailure(behaviour, b.kind, b.status);
}
