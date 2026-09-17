/**
 * packages/cli/src/providers.ts — `bisellium providers` command logic
 * (W-007). Not wired into main.ts here — the integrator owns main.ts's
 * dispatch/flags table; this exports runProviders(args, opts) for that wire-up.
 *
 * usage: bisellium providers [dir] [--source auto|usage|quota-axi] [--json] [--now <iso>]
 * Exit codes: 0 pass · 2 bad --source.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Provider } from "@bisellium/schema";
import { compositeSource, quotaAxiSource, usageYamlSource } from "@bisellium/providers";

export type ProvidersSource = "auto" | "usage" | "quota-axi";
const SOURCES: ProvidersSource[] = ["auto", "usage", "quota-axi"];

export interface RunProvidersOpts {
  source?: string;
  json?: boolean;
  now?: Date;
}

export interface RunProvidersResult {
  stdout: string;
  exitCode: number;
}

const USAGE = "usage: bisellium providers [dir] [--source auto|usage|quota-axi] [--json] [--now <iso>]";

function formatLine(p: Provider): string {
  const segments = [p.id, `${p.usagePct}%`, p.status, `resets ${p.resetAt ?? "—"}`];
  if (p.note) segments.push(p.note);
  return segments.join(" · ");
}

export async function runProviders(args: string[], opts: RunProvidersOpts = {}): Promise<RunProvidersResult> {
  const sourceFlag = opts.source ?? "auto";
  if (!SOURCES.includes(sourceFlag as ProvidersSource)) {
    return { stdout: `--source must be auto, usage or quota-axi\n${USAGE}`, exitCode: 2 };
  }
  const source = sourceFlag as ProvidersSource;
  const root = resolve(args[0] ?? ".");
  // Consistent with check/run/verify: a misspelled or non-studio directory
  // is a usage error, not a quiet zero-provider success.
  if (!existsSync(join(root, "bisellium.yml"))) {
    return { stdout: `not a studio: ${root}`, exitCode: 2 };
  }
  const now = opts.now ?? new Date();

  const yaml = usageYamlSource(root);
  const axi = quotaAxiSource({});
  const read =
    source === "usage" ? yaml.read({ now }) : source === "quota-axi" ? axi.read({ now }) : compositeSource([axi, yaml]).read({ now });

  const { providers, note } = await read;

  // `--source quota-axi` is an explicit request for the live tool — if it's
  // absent/unauthenticated/unusable, that's an honest failure (exit 1 with
  // the one-line reason), not a quiet empty success. `auto` (the default)
  // is expected to degrade to usage.yml silently — never fails on this.
  if (source === "quota-axi" && providers.length === 0 && note) {
    return { stdout: note, exitCode: 1 };
  }

  if (opts.json) {
    return { stdout: JSON.stringify({ providers, note }, null, 2), exitCode: 0 };
  }
  const lines = providers.map(formatLine);
  const stdout = note ? [...lines, `note: ${note}`].join("\n") : lines.join("\n");
  return { stdout, exitCode: 0 };
}
