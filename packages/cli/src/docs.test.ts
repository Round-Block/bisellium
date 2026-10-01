/**
 * packages/cli/src/docs.test.ts — behaviours 6-10 of the W-019 brief:
 * `doc.fields` / `doc.link` (rules/docs.ts) and `buildRegistry` / `runDocs`
 * (docs.ts), against fixture repos and the real repo. No framework, same
 * house style as check.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { checkDocs } from "./rules/docs.js";
import { buildRegistry, runDocs } from "./docs.js";

const repo = resolve(process.argv[2] ?? ".");
const NOW = new Date("2026-09-19T10:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-docs-${tag}-`));
  dirs.push(dir);
  return dir;
}

const MANIFEST = { patron: "patron", sellae: [{ id: "eng-lead", collegium: "engineering" }, { id: "producer", collegium: "production" }] };
const FULL_FRONT = { kind: "guide", owner: "eng-lead", tier: "reference", review: "2026-12-01", kill: "never, this is a fixture" };

function writeFrontMatter(dir: string, relPath: string, fields: Record<string, unknown>, body = "\nbody text\n"): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  const front = Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(full, `---\n${front}\n---\n${body}`);
}

try {
  // ---- behaviour 7: the real repo, checked as check.ts would call it -------
  {
    const manifestRaw = readFileSync(join(repo, "studio", "bisellium.yml"), "utf8");
    const manifest = parseYaml(manifestRaw);
    const findings = checkDocs(join(repo, "studio"), { now: NOW, repo, manifest });
    check("real repo: checkDocs finds nothing at now=2026-09-19T10:00:00Z", findings.length === 0, JSON.stringify(findings));

    const noRepo = checkDocs(join(repo, "studio"), { now: NOW });
    check("checkDocs returns [] when opts.repo is omitted", Array.isArray(noRepo) && noRepo.length === 0);
  }

  // ---- behaviour 10: no docs/, no README/GLOSSARY — [] and never throws --
  {
    const dir = freshDir("empty");
    let threw = false;
    let findings: unknown[] = [];
    try {
      findings = checkDocs(dir, { now: NOW, repo: dir });
    } catch {
      threw = true;
    }
    check("empty repo root: checkDocs never throws", !threw);
    check("empty repo root: checkDocs returns []", findings.length === 0, JSON.stringify(findings));
  }

  // ---- behaviour 6: doc.fields -------------------------------------------
  {
    const dir = freshDir("fields-kind");
    writeFrontMatter(dir, "docs/TEST.md", { ...FULL_FRONT, kind: "not-a-real-kind" });
    const r1 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("unknown kind: doc.fields advises", r1.some((f) => f.rule === "doc.fields" && f.message.includes("unregistered kind")), JSON.stringify(r1));

    writeFrontMatter(dir, "docs/TEST.md", FULL_FRONT);
    const r2 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("fixed kind: clears", !r2.some((f) => f.message.includes("unregistered kind")), JSON.stringify(r2));
  }
  {
    const dir = freshDir("fields-owner");
    writeFrontMatter(dir, "docs/TEST.md", { ...FULL_FRONT, owner: "not-a-sella" });
    const r1 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("owner not declared: doc.fields advises", r1.some((f) => f.rule === "doc.fields" && f.message.includes("not a declared sella")), JSON.stringify(r1));

    writeFrontMatter(dir, "docs/TEST.md", { ...FULL_FRONT, owner: "patron" });
    const r2 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("owner is the patron literal: clears", !r2.some((f) => f.message.includes("not a declared sella")), JSON.stringify(r2));
  }
  for (const key of ["kind", "owner", "tier", "review", "kill"] as const) {
    const dir = freshDir(`fields-missing-${key}`);
    const partial = { ...FULL_FRONT };
    delete (partial as Record<string, unknown>)[key];
    writeFrontMatter(dir, "docs/TEST.md", partial);
    const r1 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check(`missing "${key}": doc.fields advises`, r1.some((f) => f.rule === "doc.fields" && f.message.includes(`missing front-matter key "${key}"`)), JSON.stringify(r1));

    writeFrontMatter(dir, "docs/TEST.md", FULL_FRONT);
    const r2 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check(`missing "${key}": clears once fixed`, !r2.some((f) => f.message.includes(`missing front-matter key "${key}"`)), JSON.stringify(r2));
  }
  {
    const dir = freshDir("fields-review");
    writeFrontMatter(dir, "docs/TEST.md", { ...FULL_FRONT, review: "2020-01-01" });
    const r1 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("review before now: doc.fields advises", r1.some((f) => f.rule === "doc.fields" && f.message.includes("is before now")), JSON.stringify(r1));

    writeFrontMatter(dir, "docs/TEST.md", { ...FULL_FRONT, review: "2030-01-01" });
    const r2 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("review after now: clears", !r2.some((f) => f.message.includes("is before now")), JSON.stringify(r2));
  }

  // ---- behaviour 8: doc.link ----------------------------------------------
  {
    const dir = freshDir("link-dead");
    writeFrontMatter(dir, "docs/TEST.md", FULL_FRONT, "\nSee [missing](./NOPE.md) for more.\n");
    const r1 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("dead relative link: doc.link advises", r1.some((f) => f.rule === "doc.link" && f.message.includes("NOPE.md")), JSON.stringify(r1));

    writeFileSync(join(dir, "docs", "NOPE.md"), "# now it exists\n");
    const r2 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("link resolves once the target exists: clears", !r2.some((f) => f.rule === "doc.link"), JSON.stringify(r2));
  }
  {
    const dir = freshDir("link-ignored");
    writeFrontMatter(
      dir,
      "docs/TEST.md",
      FULL_FRONT,
      "\nSee [ext](https://example.com/nope), [secure](http://x), and [anchor](#section) here.\n",
    );
    const r1 = checkDocs(dir, { now: NOW, repo: dir, manifest: MANIFEST });
    check("http(s) and bare-anchor links are ignored", !r1.some((f) => f.rule === "doc.link"), JSON.stringify(r1));
  }

  // ---- behaviour 9: bisellium docs registry --------------------------------
  {
    const dir = freshDir("registry");
    writeFrontMatter(dir, "docs/A.md", FULL_FRONT);
    writeFrontMatter(dir, "docs/B.md", FULL_FRONT);
    writeFileSync(join(dir, "README.md"), "# no front matter here\n");

    const iso = "2026-09-19T10:00:00.000Z";
    const r1 = runDocs(["registry", "--repo", dir, "--now", iso]);
    check("docs registry: exits 0", r1.exitCode === 0);
    const registryPath = join(dir, ".bisellium", "registry.json");
    check("docs registry: writes .bisellium/registry.json", existsSync(registryPath));
    const first = readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(first);
    check("docs registry: one entry per registered doc", parsed.docs.length === 2, JSON.stringify(parsed.docs));
    check("docs registry: at matches --now", parsed.at === iso, parsed.at);

    runDocs(["registry", "--repo", dir, "--now", iso]);
    const second = readFileSync(registryPath, "utf8");
    check("docs registry: two runs at the same --now are byte-identical", first === second);

    // buildRegistry directly, cross-checked against the CLI's own write.
    const direct = buildRegistry(dir, new Date(iso));
    check("buildRegistry matches what runDocs wrote", JSON.stringify(direct) === JSON.stringify(parsed));
  }

  // ---- W-089 behaviour 10: the builder agent's boot line names no --sella
  // — the CLI's own `--sella ?? $BISELLIUM_SELLA ?? "guest"` chain supplies
  // the dispatched instance (or "guest"); a literal or shell-expanded flag
  // both strand an unset-env boot with an empty bundle (census F). --------
  {
    const bootFile = resolve(repo, ".claude/agents/builder.md");
    const bootText = readFileSync(bootFile, "utf8");
    const bootLine = bootText.split("\n").find((l) => l.startsWith("run: bisellium context"));
    check("builder.md: has a 'run: bisellium context' boot line", bootLine !== undefined, bootText);
    check('builder.md: the boot line is exactly "run: bisellium context studio"', bootLine === "run: bisellium context studio", JSON.stringify(bootLine));
    check("builder.md: the boot line names no --sella flag", !(bootLine ?? "").includes("--sella"), JSON.stringify(bootLine));
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
