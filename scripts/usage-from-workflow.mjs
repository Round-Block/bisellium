#!/usr/bin/env node
/**
 * scripts/usage-from-workflow.mjs — the documented bridge from a cascade's
 * real spend into the officina (cascades/README.md's "Usage tracking"
 * section spells out why this exists: cascades/cascade.js's script cannot
 * see tokens — only the Claude Code Workflow tool that actually ran the
 * agents can, and its own output is the only place that number lives).
 *
 * Converts a Workflow output file's `workflowProgress.agents` array
 * ({ label, model, tokens, durationMs }) into:
 *   (a) one `bisellium emit --usage <tokens> --opus <id> --sella <id>
 *       --model <model>` command per agent, so each agent's spend lands in
 *       the officina's events.jsonl as a real gen_ai.usage event (and
 *       `burn` derives from it, per D-013 "usage is a retrospectio input");
 *   (b) a retro usage JSON matching packages/cli/src/retro.ts's
 *       RetroInput["usage"] shape, ready for
 *       `bisellium retro --cascade N --from <this file>`.
 *
 * The Workflow tool's own agent record carries a label and a model but not
 * which sella/opus/role that agent was in bisellium's vocabulary — that
 * mapping is cascades/cascade.js's `builders: [{ sella, opus }]` list
 * (the same one a cascade was launched with), supplied here via
 * --builders <path-to-json>: an array of { label, sella, opus, role }.
 * An agent whose label has no matching --builders entry is skipped from
 * the emit commands (nothing to attribute it to) but still counted in the
 * usage JSON's totals/byModel/byRole — a token spent is real even when
 * this script wasn't told who spent it.
 *
 * Never calls `bisellium` itself (mechanical work is a script you run and
 * keep, not one that also reaches into the studio uninvited) — it prints
 * the emit commands for the caller (a human, or the cascade orchestrator)
 * to run, and writes the usage JSON to --out.
 *
 * Usage:
 *   node scripts/usage-from-workflow.mjs <workflow-output.json> \
 *     --builders <builders.json> [--studio <dir>] [--cascade <N>] \
 *     [--out <usage.json>] [--waste-reruns <n>] [--waste-refused <n>] \
 *     [--waste-fix-rounds <n>] [--no-print]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const values = new Map();
  const positionals = [];
  const valued = new Set([
    "--builders",
    "--studio",
    "--cascade",
    "--out",
    "--waste-reruns",
    "--waste-refused",
    "--waste-fix-rounds",
  ]);
  const boolean = new Set(["--no-print"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (boolean.has(a)) {
        values.set(a, "1");
        continue;
      }
      if (!valued.has(a)) {
        throw new Error(`unknown flag "${a}"`);
      }
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      values.set(a, v);
      continue;
    }
    positionals.push(a);
  }
  return { values, positionals };
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

/** Pulls `workflowProgress.agents` out of a Workflow output file — tolerant
 *  of the array living at the top level too, since exact Workflow-tool
 *  output shapes vary by version and this script's only hard requirement
 *  is the { label, model, tokens, durationMs } record shape itself. */
function extractAgents(workflowOutput) {
  const agents = Array.isArray(workflowOutput)
    ? workflowOutput
    : workflowOutput?.workflowProgress?.agents;
  if (!Array.isArray(agents)) {
    throw new Error('workflow output has no "workflowProgress.agents" array (and is not itself an array)');
  }
  for (const a of agents) {
    if (typeof a?.label !== "string" || typeof a?.model !== "string" || typeof a?.tokens !== "number") {
      throw new Error(`agent record missing label/model/tokens: ${JSON.stringify(a)}`);
    }
  }
  return agents;
}

export function buildUsage(workflowOutput, builders, waste) {
  const agentsRaw = extractAgents(workflowOutput);
  const bySellaFor = (label) => builders.find((b) => b.label === label);

  const usageAgents = agentsRaw.map((a) => {
    const b = bySellaFor(a.label);
    return {
      label: b?.sella ?? a.label,
      role: b?.role ?? "unknown",
      model: a.model,
      tokens: a.tokens,
      minutes: typeof a.durationMs === "number" ? Math.round(a.durationMs / 60000) : 0,
    };
  });

  const byModel = {};
  const byRole = {};
  let totalTokens = 0;
  for (const a of usageAgents) {
    totalTokens += a.tokens;
    byModel[a.model] = (byModel[a.model] ?? 0) + a.tokens;
    byRole[a.role] = (byRole[a.role] ?? 0) + a.tokens;
  }

  const emitCommands = agentsRaw
    .map((a) => ({ raw: a, mapped: bySellaFor(a.label) }))
    .filter((x) => x.mapped !== undefined)
    .map(
      (x) =>
        `bisellium emit --usage ${x.raw.tokens} --opus ${x.mapped.opus} --sella ${x.mapped.sella} --model ${x.raw.model}`,
    );

  const usage = {
    agents: usageAgents,
    totalTokens,
    byModel,
    byRole,
    waste: waste ?? { reruns: 0, refused: 0, fixRounds: 0 },
  };

  const skipped = agentsRaw.filter((a) => bySellaFor(a.label) === undefined).map((a) => a.label);

  return { usage, emitCommands, skipped };
}

async function main(argv) {
  const { values, positionals } = parseArgs(argv);
  const workflowPath = positionals[0];
  if (!workflowPath || !values.has("--builders")) {
    console.error(
      "usage: node scripts/usage-from-workflow.mjs <workflow-output.json> --builders <builders.json> " +
        "[--studio <dir>] [--cascade <N>] [--out <usage.json>] " +
        "[--waste-reruns <n>] [--waste-refused <n>] [--waste-fix-rounds <n>] [--no-print]",
    );
    return 2;
  }

  const workflowOutput = readJson(workflowPath);
  const builders = readJson(values.get("--builders"));
  if (!Array.isArray(builders)) throw new Error("--builders must point at a JSON array");

  const waste = {
    reruns: Number(values.get("--waste-reruns") ?? 0),
    refused: Number(values.get("--waste-refused") ?? 0),
    fixRounds: Number(values.get("--waste-fix-rounds") ?? 0),
  };

  const { usage, emitCommands, skipped } = buildUsage(workflowOutput, builders, waste);

  const studio = values.get("--studio") ?? "studio";
  const withStudio = emitCommands.map((c) => `${c} --studio ${studio}`);

  if (!values.has("--no-print")) {
    for (const c of withStudio) console.log(c);
    if (skipped.length) console.error(`# skipped (no --builders match, still counted in usage JSON): ${skipped.join(", ")}`);
  }

  const outPath = values.get("--out");
  if (outPath) {
    writeFileSync(resolve(outPath), `${JSON.stringify(usage, null, 2)}\n`);
    console.error(`wrote ${outPath}`);
  } else {
    console.log(JSON.stringify(usage, null, 2));
  }

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
