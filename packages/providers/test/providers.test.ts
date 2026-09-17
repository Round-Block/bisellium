/**
 * Tests for @bisellium/providers (W-007). `parsed fixture` exercises the
 * quota-axi JSON→Provider mapping without a subprocess; the "definitely-not-
 * a-binary" case exercises the real spawn path against a binary that can't
 * exist, so the never-throws contract is real, not assumed.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Provider } from "@bisellium/schema";
import { compositeSource, quotaAxiSource, usageYamlSource } from "../src/index.js";

const repo = resolve(process.argv[2] ?? ".");
const NOW = new Date("2026-09-18T09:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
};

// The mapping logic lives inside quotaAxiSource's closure (parses stdout from
// the configured command). To test it against the fixture without depending
// on quota-axi being installed, point `command` at a tiny cat-alike script
// (fixtures/print-fixture.mjs) so the exact same code path — spawn → stdout →
// JSON.parse → mapProvider — is exercised end to end, not just the parsing
// helper in isolation.
async function readFixture(): Promise<{ providers: Provider[]; note?: string }> {
  const printer = join(import.meta.dirname, "fixtures", "print-fixture.mjs");
  const fixture = join(import.meta.dirname, "fixtures", "quota-axi.json");
  const source = quotaAxiSource({ command: `${process.execPath} ${printer} ${fixture}` });
  return source.read({ now: NOW });
}

async function main() {
  // ---- quota-axi: fixture parsing -------------------------------------------
  {
    const { providers, note } = await readFixture();
    check("fixture: no top-level note (well-formed JSON)", note === undefined, `note=${JSON.stringify(note)}`);

    const codex = providers.find((p) => p.id === "codex");
    check("fixture: codex present", codex !== undefined);
    check(
      "fixture: codex status limited",
      codex?.status === "limited",
      `status=${codex?.status} usagePct=${codex?.usagePct}`,
    );
    check("fixture: codex has resetAt", typeof codex?.resetAt === "string" && codex.resetAt.length > 0, `resetAt=${codex?.resetAt}`);
    check("fixture: codex resetAt matches the weekly window", codex?.resetAt === "2026-09-20T23:39:48.000Z", `resetAt=${codex?.resetAt}`);

    const claude = providers.find((p) => p.id === "claude");
    check("fixture: claude present", claude !== undefined);
    check(
      "fixture: claude has a numeric usagePct",
      typeof claude?.usagePct === "number" && Number.isFinite(claude.usagePct),
      `usagePct=${JSON.stringify(claude?.usagePct)}`,
    );
    check("fixture: claude status unknown (unauthenticated in the fixture)", claude?.status === "unknown", `status=${claude?.status}`);
  }

  // ---- quota-axi: missing binary never throws --------------------------------
  {
    const source = quotaAxiSource({ command: "definitely-not-a-binary", timeoutMs: 5_000 });
    let threw = false;
    let result: { providers: Provider[]; note?: string } | undefined;
    try {
      result = await source.read({ now: NOW });
    } catch {
      threw = true;
    }
    check("quota-axi: missing binary does not throw", !threw);
    check("quota-axi: missing binary returns empty providers", result !== undefined && result.providers.length === 0);
    check(
      "quota-axi: missing binary returns a note",
      typeof result?.note === "string" && result.note.startsWith("quota-axi unavailable:"),
      `note=${JSON.stringify(result?.note)}`,
    );
  }

  // ---- usage.yml: examples/sample-studio -------------------------------------
  {
    const root = join(repo, "examples", "sample-studio");
    const source = usageYamlSource(root);
    const { providers, note } = await source.read({ now: NOW });
    check("usage.yml: sample-studio returns 2 providers", providers.length === 2, `count=${providers.length}`);
    check("usage.yml: note is 'observed'", note === "observed", `note=${JSON.stringify(note)}`);
    check(
      "usage.yml: has claude and codex",
      providers.some((p) => p.id === "claude") && providers.some((p) => p.id === "codex"),
      `ids=${providers.map((p) => p.id).join(",")}`,
    );
  }

  // ---- usage.yml: tolerant of malformed entries, like quota-axi's parsing ---
  {
    const dir = mkdtempSync(join(tmpdir(), "bisellium-providers-usage-"));
    try {
      writeFileSync(
        join(dir, "usage.yml"),
        "providers:\n  - {}\n  - { id: \"\", usage_pct: 50 }\n  - { id: bad-pct, usage_pct: 150 }\n  - { id: ok, usage_pct: 42 }\n",
      );
      const { providers, note } = await usageYamlSource(dir).read({ now: NOW });
      check("usage.yml malformed: only the well-formed entry is returned", providers.length === 1 && providers[0]?.id === "ok", JSON.stringify(providers));
      check(
        "usage.yml malformed: prints nothing for the bad entries, plus a note",
        typeof note === "string" && note.includes("skipped") && !note.includes("observed"),
        `note=${JSON.stringify(note)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- compositeSource: live wins, notes tagged with source id ---------------
  {
    const root = join(repo, "examples", "sample-studio");
    // A fake live source: claude only, disagreeing with usage.yml's claude
    // (81%) so the "live wins" assertion is unambiguous either way.
    const live = {
      id: "quota-axi",
      async read() {
        return { providers: [{ id: "claude", usagePct: 42, status: "conserve" as const, note: "live reading" }] };
      },
    };
    const composite = compositeSource([live, usageYamlSource(root)]);
    const { providers } = await composite.read({ now: NOW });

    const claude = providers.find((p) => p.id === "claude");
    check("composite: live source's claude value wins over usage.yml's", claude?.usagePct === 42, `usagePct=${claude?.usagePct}`);
    check(
      "composite: claude note is tagged with the live source id",
      claude?.note === "quota-axi: live reading",
      `note=${JSON.stringify(claude?.note)}`,
    );

    const codex = providers.find((p) => p.id === "codex");
    check("composite: codex falls back to usage.yml (live source had none)", codex !== undefined);
    check(
      "composite: codex note is tagged with the usage.yml source id",
      codex?.note?.startsWith("usage.yml: ") === true,
      `note=${JSON.stringify(codex?.note)}`,
    );
  }

  process.exit(failed ? 1 : 0);
}

main();
