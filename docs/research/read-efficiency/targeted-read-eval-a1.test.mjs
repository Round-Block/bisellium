import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(process.argv[2] ?? "."),
  runner = resolve(repo, "docs/research/read-efficiency/targeted-read-eval.mjs"),
  temp = mkdtempSync(join(tmpdir(), "w107-a1-test-")),
  data = join(temp, "data");
let failed = 0,
  sequence = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  b8/A1 ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
}
function run(args) {
  return spawnSync(process.execPath, [runner, ...args], { cwd: repo, encoding: "utf8" });
}
function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function put(name, value) {
  const path = join(temp, `${sequence++}-${name}`);
  writeFileSync(path, JSON.stringify(value) + "\n");
  return path;
}
function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
try {
  const built = run(["fixture-build", "--output", data]),
    paths = {
      registry: join(data, "registry.json"),
      cases: join(data, "cases.json"),
      key: join(data, "answer-key.json"),
      manifest: join(data, "snapshot-manifest.json"),
    };
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  function validate(overrides = {}) {
    return run([
      "freeze-validate",
      "--data-root",
      data,
      "--registry",
      overrides.registry ?? paths.registry,
      "--cases",
      overrides.cases ?? paths.cases,
      "--key",
      overrides.key ?? paths.key,
      "--manifest",
      overrides.manifest ?? paths.manifest,
      "--output",
      join(temp, `receipt-${sequence++}.json`),
    ]);
  }
  function manifestMutation(name, mutate) {
    const value = json(paths.manifest);
    mutate(value);
    return validate({ manifest: put(name, value) });
  }
  function keyMutation(name, mutate) {
    const value = json(paths.key),
      manifest = json(paths.manifest);
    mutate(value);
    const key = put(name, value);
    manifest.artifacts["answer-key.json"] = hash(key);
    return validate({ key, manifest: put(`${name}-manifest`, manifest) });
  }

  const scalar = manifestMutation("scalar-preparation.json", (x) => {
    x.preparation = "Synthetic preparation; not yet independently validated.";
  });
  check("nonempty scalar preparation validates", scalar.status === 0, scalar.stdout + scalar.stderr);

  const invalidPreparations = [
    manifestMutation("empty-preparation.json", (x) => (x.preparation = "")),
    manifestMutation("object-preparation.json", (x) => (x.preparation = { status: "synthetic" })),
    manifestMutation("array-preparation.json", (x) => (x.preparation = ["synthetic"])),
    manifestMutation("null-preparation.json", (x) => (x.preparation = null)),
    manifestMutation("omitted-preparation.json", (x) => delete x.preparation),
  ];
  check(
    "empty/object/array/null/omitted preparation fail closed",
    invalidPreparations.every((x) => x.status !== 0),
    invalidPreparations.map((x) => x.status).join(","),
  );

  const duplicateAnchor = keyMutation("duplicate-anchor.json", (x) => {
    x.cases[0].anchors.push(structuredClone(x.cases[0].anchors[0]));
  });
  check("duplicate anchor identity is rejected", duplicateAnchor.status !== 0, duplicateAnchor.stdout);

  const foreignAnchor = keyMutation("foreign-anchor.json", (x) => {
    x.cases[0].anchors[0] = structuredClone(x.cases[2].anchors[0]);
  });
  check("anchor must belong to its owning case project", foreignAnchor.status !== 0, foreignAnchor.stdout);

  const falseOversized = keyMutation("false-oversized.json", (x) => {
    for (const item of x.cases) item.coverage = item.coverage.filter((v) => v !== "oversized-document");
    x.cases.find((item) => item.id === "epoch0-local").coverage.push("oversized-document");
  });
  check(
    "oversized coverage requires a cited file over 4096 code points",
    falseOversized.status !== 0,
    falseOversized.stdout,
  );

  const registry = json(paths.registry),
    cases = json(paths.cases),
    key = json(paths.key),
    manifest = json(paths.manifest),
    rename = new Map([
      ["bisellium", "invented-one"],
      ["epoch0", "invented-two"],
      ["yan-mo", "invented-three"],
    ]);
  for (const item of registry.projects) item.id = rename.get(item.id);
  for (const item of cases.cases) {
    item.project = rename.get(item.project);
    item.orientation.project = rename.get(item.orientation.project);
  }
  for (const item of key.cases) for (const anchor of item.anchors) anchor.project = rename.get(anchor.project);
  for (const item of manifest.files) item.project = rename.get(item.project);
  const inventedRegistry = put("invented-registry.json", registry),
    inventedCases = put("invented-cases.json", cases),
    inventedKey = put("invented-key.json", key);
  manifest.artifacts["registry.json"] = hash(inventedRegistry);
  manifest.artifacts["cases.json"] = hash(inventedCases);
  manifest.artifacts["answer-key.json"] = hash(inventedKey);
  const invented = validate({
    registry: inventedRegistry,
    cases: inventedCases,
    key: inventedKey,
    manifest: put("invented-manifest.json", manifest),
  });
  check("registry requires the three named evaluation projects", invented.status !== 0, invented.stdout);

  const zeroOffsetTime = manifestMutation("zero-offset-time.json", (x) => {
      x.preparedAt = "2026-01-02T03:04:05.123456+00:00";
    }),
    zTime = manifestMutation("z-time.json", (x) => {
      x.preparedAt = "2026-01-02T03:04:05.123456Z";
    });
  check(
    "preparedAt accepts equivalent Z and +00:00 UTC forms",
    zeroOffsetTime.status === 0 && zTime.status === 0,
    `${zeroOffsetTime.stdout}${zeroOffsetTime.stderr}${zTime.stdout}${zTime.stderr}`,
  );
  const invalidTimes = [
    manifestMutation("positive-offset-time.json", (x) => (x.preparedAt = "2026-01-02T03:05:05.123456+00:01")),
    manifestMutation("negative-offset-time.json", (x) => (x.preparedAt = "2026-01-01T22:04:05.123456-05:00")),
    manifestMutation("missing-zone-time.json", (x) => (x.preparedAt = "2026-01-02T03:04:05.123456")),
    manifestMutation("invalid-date-time.json", (x) => (x.preparedAt = "2026-02-30T03:04:05.123456Z")),
    manifestMutation("non-string-time.json", (x) => (x.preparedAt = null)),
  ];
  check(
    "preparedAt rejects nonzero offsets, missing zones, invalid dates and non-strings",
    invalidTimes.every((x) => x.status !== 0),
    invalidTimes.map((x) => x.status).join(","),
  );

  const traversal = manifestMutation("lexical-traversal.json", (x) => {
    const item = x.files.find((f) => f.project === "bisellium" && f.path === "doc.md");
    item.snapshotPath = "source/bisellium/../bisellium/doc.md";
  });
  check("lexically traversing snapshotPath is rejected", traversal.status !== 0, traversal.stdout);

  symlinkSync(join(data, "source", "bisellium", "doc.md"), join(data, "source", "linked-doc.md"));
  const symlink = manifestMutation("symlink-snapshot.json", (x) => {
    const item = x.files.find((f) => f.project === "bisellium" && f.path === "doc.md");
    item.snapshotPath = "source/linked-doc.md";
  });
  check("symlink snapshotPath is rejected even when target is in root", symlink.status !== 0, symlink.stdout);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
