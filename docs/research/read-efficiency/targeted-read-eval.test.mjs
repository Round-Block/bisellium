import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const repo = resolve(process.argv[2] ?? "."),
  runner = resolve(repo, "docs/research/read-efficiency/targeted-read-eval.mjs"),
  only = Number(process.argv[3] ?? "0");
let failed = 0;
function check(b, name, ok, detail = "") {
  if (only !== 0 && only !== b) return;
  console.log(`${ok ? "PASS" : "FAIL"}  b${b} ${name.padEnd(82)} ${detail}`);
  if (!ok) failed++;
}
function run(args) {
  return spawnSync(process.execPath, [runner, ...args], { cwd: repo, encoding: "utf8" });
}
if (only === 0 || only === 7) {
  const p = run(["self-test", "--behaviour", "7"]);
  let data;
  try {
    data = JSON.parse(p.stdout.trim());
  } catch {}
  check(
    7,
    "live runner canary verifies Unicode/error/call-id delivery and terminal usage",
    p.status === 0 &&
      data?.canary?.unicode === true &&
      data?.canary?.errors === true &&
      data?.canary?.callIdentity === true &&
      data?.canary?.usage === true,
    JSON.stringify({ status: p.status, data, stderr: p.stderr }),
  );
  check(
    7,
    "bypass and thirteenth-call controls fail closed",
    data?.canary?.bypassDetected === true && data?.canary?.call13Refused === true,
    JSON.stringify(data),
  );
}
if (only === 0 || only === 8) {
  const temp = mkdtempSync(join(tmpdir(), "w107-eval-test-")),
    data = join(temp, "data");
  try {
    const built = run(["fixture-build", "--output", data]);
    const paths = {
      registry: join(data, "registry.json"),
      cases: join(data, "cases.json"),
      key: join(data, "answer-key.json"),
      manifest: join(data, "snapshot-manifest.json"),
    };
    let sequence = 0;
    function validate(overrides = {}) {
      const output = join(temp, `receipt-${sequence++}.json`);
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
        output,
      ]);
    }
    const valid = validate();
    check(
      8,
      "generated closed-schema freeze validates",
      built.status === 0 && valid.status === 0,
      valid.stdout + valid.stderr,
    );
    const negatives = [];
    function mutated(name, base, fn) {
      const path = join(temp, name),
        value = JSON.parse(readFileSync(base, "utf8"));
      fn(value);
      writeFileSync(path, JSON.stringify(value) + "\n");
      return path;
    }
    negatives.push(validate({ cases: mutated("five-cases.json", paths.cases, (x) => x.cases.pop()) }));
    negatives.push(
      validate({
        key: mutated("missing-qualification.json", paths.key, (x) => (x.cases[0].requiredQualifications = [])),
      }),
    );
    negatives.push(validate({ key: mutated("invalid-key-id.json", paths.key, (x) => (x.cases[0].id = "missing")) }));
    negatives.push(
      validate({
        manifest: mutated("bad-artifact.json", paths.manifest, (x) => (x.artifacts["cases.json"] = "0".repeat(64))),
      }),
    );
    negatives.push(
      validate({ key: mutated("bad-anchor.json", paths.key, (x) => (x.cases[0].anchors[0].endLine = 99999)) }),
    );
    negatives.push(
      validate({ cases: mutated("leaked-field.json", paths.cases, (x) => (x.cases[0].expectedAnswer = "leak")) }),
    );
    const duplicate = join(temp, "duplicate.json");
    writeFileSync(duplicate, readFileSync(paths.cases, "utf8").replace('{"version":1', '{"version":1,"version":1'));
    negatives.push(validate({ cases: duplicate }));
    const source = join(data, "source", "bisellium", "doc.md"),
      original = readFileSync(source);
    writeFileSync(source, Buffer.concat([original, Buffer.from("drift\n")]));
    negatives.push(validate());
    writeFileSync(source, original);
    check(
      8,
      "eight malformed/key/hash/range/leak/drift controls fail closed",
      negatives.length === 8 && negatives.every((x) => x.status !== 0),
      negatives.map((x) => x.status).join(","),
    );
    const synthetic = join(temp, "synthetic"),
      control = run(["synthetic-controls", "--output", synthetic]);
    const result = JSON.parse(readFileSync(join(synthetic, "synthetic-results.json"), "utf8"));
    check(
      8,
      "12 alternating immutable synthetic arms aggregate deterministically",
      control.status === 0 &&
        result.runs.length === 12 &&
        result.aggregate.immutable === true &&
        result.aggregate.candidateBytes <= result.aggregate.baselineBytes * 0.7,
      JSON.stringify(result.aggregate),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
