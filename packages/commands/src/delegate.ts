/**
 * packages/commands/src/delegate.ts — W-065: `bisellium delegate`, the
 * CLI half of D-023's two decree records (`sellae[].model`,
 * `tiers`/`munera`). Same discipline `greenlight`/`budget` (writes.ts)
 * already use: one read of the manifest, a whitelist of supported YAML
 * forms refused-without-write, the write + Patron-timeline append (no
 * workflow.* event — see the ruling at the write step below) inside one
 * `try`, best-effort rollback from the pre-read bytes on any
 * throw — except that here a *restore* failure is distinguished (exit 4)
 * from an ordinary write failure (exit 2), per the brief's stated ceiling.
 *
 * `runDelegate` performs exactly one read of the manifest: the document
 * validated is the document mutated is the bytes restored (no second
 * snapshot) — this is what makes `--from` a real precondition rather than
 * a race with itself.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAlias, parseDocument, visit } from "yaml";
import { resolveSeat, retiredDispatchMessage } from "@bisellium/adapter-native";
import { appendPatronTimeline, openStudio, parseFlags, resolveNow, type WriteOptions, type WriteResult } from "./writes.js";

const DELEGATE_USAGE =
  "usage: bisellium delegate --sella <id> --model <model> [--from <current>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium delegate --munus <id> --tier <tier>   [--from <current>] [--studio <dir>] [--now <iso>]";

export { DELEGATE_USAGE };

/** Counts every anchor and every alias anywhere in the document — a whole-
 *  document scan, not "an alias on the path to the target": a node reached
 *  through an anchor elsewhere in the tree can still be mutated collaterally
 *  (ui-lead pass 2, finding 4 — reproduced in the brief's own probe). A
 *  nonzero count refuses the whole document. */
function countAnchorsAndAliases(doc: ReturnType<typeof parseDocument>): number {
  let n = 0;
  visit(doc, (_key, node) => {
    if (isAlias(node)) {
      n++;
      return;
    }
    if (node && typeof node === "object" && "anchor" in node && (node as { anchor?: string }).anchor) n++;
  });
  return n;
}

/** A merge key (`<<`) is an ordinary-looking mapping key this library's
 *  default parsing does NOT resolve into inheritance — what a naive
 *  round-trip writes back would not mean what the source meant. Detected
 *  independently of the anchor/alias scan: a merge value need not be an
 *  alias (`<<: { x: 1 }` is legal YAML), so this cannot rely on that count
 *  alone. */
function hasMergeKey(doc: ReturnType<typeof parseDocument>): boolean {
  let found = false;
  visit(doc, {
    Pair(_key, pair) {
      const k = pair.key;
      if (k && typeof k === "object" && "value" in k && (k as { value?: unknown }).value === "<<") found = true;
    },
  });
  return found;
}

interface Target {
  kind: "sella";
  id: string;
  field: "model";
  value: string;
}
interface MunusTarget {
  kind: "munus";
  id: string;
  field: "tier";
  value: string;
}

export function runDelegate(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--sella", "--model", "--munus", "--tier", "--from", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${DELEGATE_USAGE}`);
    return { exitCode: 2 };
  }
  const { values } = parsed;
  const sella = values.get("--sella");
  const model = values.get("--model");
  const munus = values.get("--munus");
  const tier = values.get("--tier");
  const from = values.get("--from");

  const sellaShape = sella !== undefined || model !== undefined;
  const munusShape = munus !== undefined || tier !== undefined;
  if (sellaShape && munusShape) {
    console.error(`delegate accepts exactly one shape, not both\n${DELEGATE_USAGE}`);
    return { exitCode: 2 };
  }
  if (sellaShape && (sella === undefined || model === undefined)) {
    console.error(DELEGATE_USAGE);
    return { exitCode: 2 };
  }
  if (munusShape && (munus === undefined || tier === undefined)) {
    console.error(DELEGATE_USAGE);
    return { exitCode: 2 };
  }
  if (!sellaShape && !munusShape) {
    console.error(DELEGATE_USAGE);
    return { exitCode: 2 };
  }

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;
  const manifestPath = join(root, "bisellium.yml");

  // Exactly one read. Every later step uses `before`: the document
  // validated is the document mutated is the bytes restored.
  let before: string;
  try {
    before = readFileSync(manifestPath, "utf8");
  } catch (e) {
    console.error(`could not read ${manifestPath}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }
  const crlf = before.includes("\r\n");

  // ---- Supported-forms whitelist — refused, without writing, before the
  // target is even resolved. Document-level malformation (multiple
  // documents, a duplicate key, any other parse error) is NOT re-checked
  // here: `openStudio` above already parsed these exact bytes with the same
  // library and would have refused them first (ruling 2026-09-25, censor
  // round 1 finding A) — a second guard for bytes that can never reach this
  // line is dead code that looks like a test but isn't. `delegate` owns only
  // what survives `openStudio`: shared nodes (anchors/aliases) and merge
  // keys, neither of which `openStudio` treats as an error. ------------------
  const doc = parseDocument(before);
  if (countAnchorsAndAliases(doc) > 0) {
    console.error(`${manifestPath}: anchors and aliases are not a supported form for delegate — a shared node cannot be edited field-by-field without collateral changes`);
    return { exitCode: 2 };
  }
  if (hasMergeKey(doc)) {
    console.error(`${manifestPath}: a merge key ("<<") is not a supported form for delegate — default YAML parsing does not resolve it into inheritance`);
    return { exitCode: 2 };
  }

  // ---- Resolve the target. -------------------------------------------------
  let target: Target | MunusTarget;
  let currentValue: string | undefined;
  if (sellaShape) {
    // W-089 behaviours 3/6: an instance id (`builder.W-089`) resolves to its
    // TEMPLATE row — `delegate` edits a template, it never mints or writes a
    // row named after an instance — and a retired live target is refused,
    // same posture as the three group-A dispatch sites.
    const resolved = resolveSeat(manifest, sella!);
    if (!resolved) {
      console.error(`unknown sella "${sella}" — not declared in bisellium.yml`);
      return { exitCode: 2 };
    }
    if (resolved.seat.retired) {
      console.error(retiredDispatchMessage(manifest, resolved.seat));
      return { exitCode: 2 };
    }
    const row = resolved.seat;
    currentValue = row.model;
    target = { kind: "sella", id: row.id, field: "model", value: model! };
  } else {
    const row = (manifest.munera ?? []).find((m) => m.id === munus);
    if (!row) {
      console.error(`unknown munus "${munus}" — not declared in bisellium.yml`);
      return { exitCode: 2 };
    }
    if (!(manifest.tiers ?? []).some((t) => t.id === tier)) {
      console.error(`unknown tier "${tier}" — not declared in bisellium.yml`);
      return { exitCode: 2 };
    }
    currentValue = row.tier;
    target = { kind: "munus", id: munus!, field: "tier", value: tier! };
  }

  // ---- The --from precondition: closes the stale-DRAFT window (the console
  // reading a value, then a Patron confirming minutes later) — not a
  // compare-and-set across processes. See "A narrowed claim". ---------------
  if (from !== undefined && from !== (currentValue ?? "")) {
    console.error(`${target.kind} "${target.id}": --from "${from}" does not match the current value "${currentValue ?? ""}"`);
    return { exitCode: 3 };
  }

  // ---- Write + timeline, together; roll the manifest back from `before` on
  // any throw. A failure of the restore ITSELF is a distinct, stated ceiling
  // (exit 4), not swallowed into the ordinary failure path.
  //
  // Neither shape emits a workflow.* event (amended 2026-09-25, censor round
  // 1 finding D — the phantom opera_state row): `workflow.actor_assigned`
  // means "this actor was assigned to this item"; a delegate write assigns
  // no actor to any item, seat or munus alike, so emitting it invented a row
  // in every view keyed on actor assignment for work nobody did. The record
  // of the decree is the Patron timeline line below, which both shapes
  // write; configuration is read live (`/api/officina` re-reads the
  // manifest on every call), so no event is needed to make the change
  // visible. --------------------------------------------------------------
  try {
    if (target.kind === "sella") {
      doc.setIn(["sellae", (manifest.sellae ?? []).findIndex((s) => s.id === target.id), "model"], target.value);
    } else {
      doc.setIn(["munera", (manifest.munera ?? []).findIndex((m) => m.id === target.id), "tier"], target.value);
    }
    let after = doc.toString({ lineWidth: 0 });
    if (crlf) after = after.replace(/\r?\n/g, "\r\n");
    writeFileSync(manifestPath, after);

    appendPatronTimeline(root, {
      at: now.toISOString(),
      action: "delegate",
      target: target.kind === "sella" ? { sella: target.id } : { munus: target.id },
      from: currentValue ?? null,
      to: target.value,
    });
  } catch (e) {
    try {
      writeFileSync(manifestPath, before);
    } catch (restoreError) {
      console.error(
        `delegate failed (${(e as Error).message}) AND the manifest restore itself failed (${(restoreError as Error).message}) — ` +
          `${manifestPath} may be left changed or partially written; check it by hand`,
      );
      return { exitCode: 4 };
    }
    console.error(`delegate failed: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  console.log(`${target.kind} "${target.id}": ${target.field} ${currentValue ?? "(unset)"} -> ${target.value}`);
  return { exitCode: 0 };
}
