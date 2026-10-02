#!/usr/bin/env python3
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path("/home/edckt/projects/bisellium")
FRESH = ROOT / "docs/research/maps-fresh-2026-09-28"
OUT = FRESH / "reanalysis"
WORKTREE = ROOT / ".worktrees/maps-lookup-experiment"
DRIVER = WORKTREE / "docs/research/maps-repair-driver.mjs"
HARNESS = WORKTREE / "docs/research/bisellium-maps-harness.mjs"
ACCEPTED_MANIFEST = WORKTREE / "docs/research/W-105/pre-preparation-manifest-R3.json"
ACCEPTED_MANIFEST_SHA256 = "5ebf97ca3925d7bf2d9a3ad52bb5b9715d12c0a7e36caee42aa2a354e039ee21"
PRESERVATION = FRESH / "execution/post-score-preservation.json"
SOURCE_FREEZE = FRESH / "preparation/question-source-freeze.json"
QUESTIONS = FRESH / "preparation/questions.json"
ORIGINAL_KEY = FRESH / "preparation/hidden-key.json"
CORRECTED_KEY = FRESH / "correction/corrected-key.json"
ORIGINAL_DIFF = FRESH / "correction/original-to-corrected-key.diff"
V1_FINAL_DIFF = FRESH / "correction/correction-v1-to-final.diff"
BASELINE_PACKETS = FRESH / "execution/baseline-packets.json"
POLICY_PACKETS = FRESH / "execution/policy-B-packets.json"
NODE = "/home/linuxbrew/.linuxbrew/bin/node"

def fail(message):
    raise RuntimeError(message)

def load(path):
    return json.loads(path.read_text())

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def check_file(path, expected_hash, expected_bytes=None, label=None):
    actual_hash = sha256(path)
    actual_bytes = path.stat().st_size
    if actual_hash != expected_hash or (expected_bytes is not None and actual_bytes != expected_bytes):
        fail(f"{label or path} seal mismatch")
    return {"path": str(path), "sha256": actual_hash, "bytes": actual_bytes}

def write_exclusive(path, value):
    text = value if isinstance(value, str) else json.dumps(value, indent=2) + "\n"
    with path.open("x", encoding="utf-8") as stream:
        stream.write(text)

def command_text(parts):
    return shlex.join([str(part) for part in parts])

def captured_process(label, argv):
    stdout_path = OUT / f"{label}.stdout.log"
    stderr_path = OUT / f"{label}.stderr.log"
    environment = dict(os.environ)
    environment["PATH"] = "/home/linuxbrew/.linuxbrew/bin:/usr/bin:/bin"
    with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
        result = subprocess.run([str(x) for x in argv], cwd=ROOT, env=environment, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, check=False)
    if result.returncode != 0:
        fail(f"{label} exited {result.returncode}; no retry is permitted")
    return {"command": command_text(argv), "stdout": str(stdout_path), "stderr": str(stderr_path), "exitCode": result.returncode}

def utf16_units(text):
    return len(text.encode("utf-16-le")) // 2

def supplied_utf16(packet, arm):
    rows = packet["results"] if arm == "baseline" else packet["cases"]
    result = []
    for row in rows:
        if arm == "baseline":
            units = sum(utf16_units(excerpt) for repository in row.get("repositories", []) for file in repository.get("files", []) for excerpt in file.get("excerpts", []))
        else:
            units = sum(utf16_units(selected["text"]) for selected in row.get("selected", []))
        result.append({"id": row["id"], "project": row["project"], "utf16Units": units})
    return result

def score_aggregate(score):
    by_project = {}
    for case in score["cases"]:
        item = by_project.setdefault(case["project"], {"cases": 0, "requirements": 0, "coveredRequirements": 0, "completeCases": 0, "anchors": 0, "coveredAnchors": 0})
        item["cases"] += 1
        item["requirements"] += len(case["requirements"])
        item["coveredRequirements"] += sum(bool(requirement["covered"]) for requirement in case["requirements"])
        item["completeCases"] += int(bool(case["complete"]))
        for requirement in case["requirements"]:
            item["anchors"] += len(requirement["anchors"])
            item["coveredAnchors"] += sum(bool(anchor["covered"]) for anchor in requirement["anchors"])
    return by_project

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corrected-key-sha256", required=True)
    parser.add_argument("--validator-receipt", required=True)
    parser.add_argument("--validator-receipt-sha256", required=True)
    parser.add_argument("--release", required=True)
    args = parser.parse_args()
    for name, value in [("corrected key", args.corrected_key_sha256), ("validator receipt", args.validator_receipt_sha256)]:
        if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
            fail(f"{name} hash must be lowercase SHA-256")
    if args.release != "RELEASE":
        fail("explicit --release RELEASE is required")
    receipt = Path(args.validator_receipt).resolve()
    if FRESH.resolve() not in receipt.parents:
        fail("validator receipt must remain under the frozen fresh-run directory")
    OUT.mkdir(parents=False, exist_ok=False)

    preservation = load(PRESERVATION)
    if preservation.get("stage") != "post_score_preservation_only" or preservation.get("notAPreScoreFreeze") is not True:
        fail("preservation disclosure changed")
    listed = set()
    execution_checks = []
    execution_dir = FRESH / "execution"
    for item in preservation["files"]:
        path = Path(item["path"]).resolve()
        if path.parent != execution_dir or path.suffix != ".json" or path == PRESERVATION:
            fail("invalid preservation member")
        listed.add(path)
        execution_checks.append(check_file(path, item["sha256"], item["bytes"], f"preserved {path.name}"))
    actual_execution_json = {path.resolve() for path in execution_dir.glob("*.json") if path.resolve() != PRESERVATION.resolve()}
    if actual_execution_json != listed:
        fail("preservation list does not exactly cover original execution JSON except its own seal")

    source_freeze = load(SOURCE_FREEZE)
    if Path(source_freeze["questionsPath"]).resolve() != QUESTIONS:
        fail("question freeze path mismatch")
    question_check = check_file(QUESTIONS, source_freeze["questionsSha256"], label="questions")
    source_checks = [check_file(Path(item["root"]) / item["path"], item["fileSha256"], label=f"source {item['repository']}/{item['path']}") for item in source_freeze["files"]]
    if len(source_checks) != 23:
        fail("expected exactly 23 frozen source files")
    accepted_manifest_check = check_file(ACCEPTED_MANIFEST, ACCEPTED_MANIFEST_SHA256, label="accepted W-105 manifest")
    accepted = load(ACCEPTED_MANIFEST)
    accepted_by_path = {Path(item["path"]).resolve(): item for item in accepted["files"]}
    driver_check = check_file(DRIVER, accepted_by_path[DRIVER.resolve()]["sha256"], accepted_by_path[DRIVER.resolve()]["bytes"], "accepted driver")
    harness_check = check_file(HARNESS, accepted_by_path[HARNESS.resolve()]["sha256"], accepted_by_path[HARNESS.resolve()]["bytes"], "accepted harness")
    corrected_key_check = check_file(CORRECTED_KEY, args.corrected_key_sha256, label="corrected key")
    receipt_check = check_file(receipt, args.validator_receipt_sha256, label="validator receipt")
    receipt_text = receipt.read_text()
    if args.corrected_key_sha256 not in receipt_text or "No remaining semantic findings" not in receipt_text or "49 anchors" not in receipt_text or "23 frozen sources" not in receipt_text:
        fail("validator receipt does not release this exact corrected key")

    node_runtime = subprocess.run([NODE, "--version"], check=True, capture_output=True, text=True).stdout.strip()
    baseline_score_args = [NODE, DRIVER, "score", "--packets", BASELINE_PACKETS, "--key", CORRECTED_KEY, "--key-sha256", args.corrected_key_sha256, "--output-root", OUT, "--output", "baseline-score-corrected.json"]
    policy_score_args = [NODE, DRIVER, "score", "--packets", POLICY_PACKETS, "--key", CORRECTED_KEY, "--key-sha256", args.corrected_key_sha256, "--output-root", OUT, "--output", "policy-B-score-corrected.json"]
    freeze_args = [NODE, DRIVER, "freeze", "--descriptor", OUT / "freeze-descriptor.json", "--output-root", OUT, "--output", "pre-score-manifest.json"]
    verify_args = [NODE, DRIVER, "verify-freeze", "--manifest", OUT / "pre-score-manifest.json", "--output-root", OUT, "--output", "pre-score-verification.json"]
    commands = {
        "invocation": command_text([sys.executable, *sys.argv]),
        "freeze": command_text(freeze_args),
        "verifyFreeze": command_text(verify_args),
        "baselineScore": command_text(baseline_score_args),
        "policyBScore": command_text(policy_score_args),
    }
    preflight = {
        "version": 1, "valid": True, "pythonRuntime": sys.version.split()[0], "nodeRuntime": node_runtime,
        "preservationDisclosure": {"stage": preservation["stage"], "notAPreScoreFreeze": preservation["notAPreScoreFreeze"]},
        "executionChecks": execution_checks, "questionCheck": question_check, "sourceChecks": source_checks,
        "acceptedManifestCheck": accepted_manifest_check, "driverCheck": driver_check, "harnessCheck": harness_check,
        "correctedKeyCheck": corrected_key_check, "validatorReceiptCheck": receipt_check,
    }
    write_exclusive(OUT / "preflight.json", preflight)
    write_exclusive(OUT / "execution-plan.json", {"version": 1, "pythonRuntime": sys.version.split()[0], "nodeRuntime": node_runtime, "commands": commands, "noRetrieval": True, "packetFilesUnchanged": True, "scoreProcessesAllowedOnceEach": True})

    freeze_files = [
        ("operational-replay-script", Path(__file__)), ("preflight", OUT / "preflight.json"), ("execution-plan", OUT / "execution-plan.json"),
        ("corrected-key", CORRECTED_KEY), ("invalid-original-key-retained", ORIGINAL_KEY), ("frozen-questions", QUESTIONS), ("question-source-freeze", SOURCE_FREEZE),
        ("original-to-corrected-key-diff", ORIGINAL_DIFF), ("correction-v1-to-final-diff", V1_FINAL_DIFF), ("independent-validator-receipt", receipt),
        ("accepted-W105-driver", DRIVER), ("reviewed-W103-harness", HARNESS), ("accepted-W105-manifest-R3", ACCEPTED_MANIFEST),
        ("post-score-preservation-disclosure", PRESERVATION), ("unchanged-baseline-packets", BASELINE_PACKETS), ("unchanged-policy-B-packets", POLICY_PACKETS),
    ]
    freeze_files.extend((f"frozen-source:{item['repository']}/{item['path']}", Path(item["root"]) / item["path"]) for item in source_freeze["files"])
    descriptor = {"version": 1, "commands": list(commands.values()), "files": [{"role": role, "path": str(path.resolve())} for role, path in freeze_files]}
    write_exclusive(OUT / "freeze-descriptor.json", descriptor)
    freeze_result = captured_process("freeze", freeze_args)
    verify_result = captured_process("verify-freeze", verify_args)
    verification = load(OUT / "pre-score-verification.json")
    if verification.get("valid") is not True:
        fail("pre-score freeze verification did not pass")

    write_exclusive(OUT / "scoring-started.json", {"version": 1, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "correctedKeySha256": args.corrected_key_sha256, "commands": [commands["baselineScore"], commands["policyBScore"]], "retryPermitted": False})
    baseline_run = captured_process("baseline-score", baseline_score_args)
    policy_run = captured_process("policy-B-score", policy_score_args)
    baseline_score = load(OUT / "baseline-score-corrected.json")
    policy_score = load(OUT / "policy-B-score-corrected.json")
    baseline_by_id = {item["id"]: item for item in baseline_score["cases"]}
    lost_baseline_cases = [item["id"] for item in policy_score["cases"] if baseline_by_id[item["id"]]["complete"] and not item["complete"]]
    advanced_over_baseline_cases = [item["id"] for item in policy_score["cases"] if not baseline_by_id[item["id"]]["complete"] and item["complete"]]
    baseline_utf16 = supplied_utf16(load(BASELINE_PACKETS), "baseline")
    policy_utf16 = supplied_utf16(load(POLICY_PACKETS), "policy")
    def totals(score):
        return {name: score[name] for name in ["coveredRequirements", "totalRequirements", "coveredAnchors", "totalAnchors", "completeCases"]}
    aggregate = {
        "version": 1, "pythonRuntime": sys.version.split()[0], "nodeRuntime": node_runtime, "correctedKeySha256": args.corrected_key_sha256,
        "scores": {"baseline": {"totals": totals(baseline_score), "byProject": score_aggregate(baseline_score)}, "policyB": {"totals": totals(policy_score), "byProject": score_aggregate(policy_score)}},
        "lostBaselineCases": lost_baseline_cases, "advancedOverBaselineCases": advanced_over_baseline_cases,
        "suppliedUtf16": {"baseline": {"total": sum(item["utf16Units"] for item in baseline_utf16), "cases": baseline_utf16}, "policyB": {"total": sum(item["utf16Units"] for item in policy_utf16), "cases": policy_utf16}},
        "processes": {"freeze": freeze_result, "verifyFreeze": verify_result, "baselineScore": baseline_run, "policyBScore": policy_run},
        "interpretation": "mechanical aggregate only; no verdict",
    }
    write_exclusive(OUT / "mechanical-aggregate.json", aggregate)
    output_names = ["baseline-score-corrected.json", "policy-B-score-corrected.json", "mechanical-aggregate.json"]
    write_exclusive(OUT / "post-score-output-hashes.json", {"version": 1, "files": [{"path": str(OUT / name), "sha256": sha256(OUT / name), "bytes": (OUT / name).stat().st_size} for name in output_names]})

if __name__ == "__main__":
    main()
