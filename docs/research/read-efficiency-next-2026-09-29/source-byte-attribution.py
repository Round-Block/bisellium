#!/usr/bin/env python3
"""Attribute retained W-107 response bytes to keyed source spans and residuals."""
import argparse
import json
from collections import defaultdict
from pathlib import Path

EXPECTED = {"baseline": 237951, "candidate": 243194}

def load(path):
    return json.loads(path.read_text(encoding="utf-8"))

def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)

def source_records(value):
    for item in walk(value):
        body = item.get("body")
        repo, path, sha = (item.get(k) for k in ("repository", "path", "sha256"))
        start, end = item.get("startLine"), item.get("endLine")
        if isinstance(body, str) and all(isinstance(x, str) for x in (repo, path, sha)) and isinstance(start, int) and isinstance(end, int):
            yield item

def body_lines(body):
    parts = body.split("\n")
    return [(part + "\n") for part in parts[:-1]] + ([parts[-1]] if parts[-1] else [])

def merge(intervals):
    out = []
    for start, end in sorted(intervals):
        if out and start <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out

def intersects(intervals, line):
    return any(start <= line <= end for start, end in intervals)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    study = here.parent / "read-efficiency-evaluation-2026-09-28"
    run_root = study / "run-v1-2026-09-29"
    answer_key = load(study / "answer-key.json")
    keyed = defaultdict(list)
    for case in answer_key["cases"]:
        for anchor in case["anchors"]:
            key = (anchor["repository"], anchor["path"], anchor["sha256"])
            keyed[key].append((anchor["startLine"], anchor["endLine"]))
    keyed = {key: merge(ranges) for key, ranges in keyed.items()}
    runs = []
    arm_totals = defaultdict(lambda: defaultdict(int))
    file_totals = defaultdict(int)
    usage_totals = defaultdict(lambda: defaultdict(int))
    for run_path in sorted((run_root / "runs").glob("*/run.json")):
        run = load(run_path)
        categories = defaultdict(int)
        file_bytes = defaultdict(int)
        events = []
        delivery_channels = defaultdict(lambda: defaultdict(int))
        tool_calls = defaultdict(int)
        failures = []
        for lineno, line in enumerate((run_path.parent / "mcp-transcript.jsonl").read_text(encoding="utf-8").splitlines(), 1):
            event = json.loads(line)
            text = event.get("text", "")
            tool = event.get("tool", "unknown")
            tool_calls[tool] += 1
            response_bytes = len(text.encode("utf-8"))
            recorded_bytes = event.get("bytes", response_bytes)
            if recorded_bytes != response_bytes:
                failures.append({"transcriptLine": lineno, "kind": "event-byte-mismatch", "recorded": recorded_bytes, "measured": response_bytes})
            try:
                payload = json.loads(text)
            except (json.JSONDecodeError, TypeError):
                payload = None
            body_total = 0
            if payload is not None:
                for rec in source_records(payload):
                    repo, path, sha = (rec[k] for k in ("repository", "path", "sha256"))
                    start, end = rec["startLine"], rec["endLine"]
                    body = rec["body"]
                    lines = body_lines(body)
                    expected_lines = end - start + 1
                    if end < start or len(lines) != expected_lines:
                        failures.append({"transcriptLine": lineno, "sequence": event.get("sequence"), "kind": "body-line-span-mismatch", "repository": repo, "path": path, "startLine": start, "endLine": end, "bodyLines": len(lines)})
                        categories["unmappableSourceBodyBytes"] += len(body.encode("utf-8"))
                        body_total += len(body.encode("utf-8"))
                        continue
                    key = (repo, path, sha)
                    has_keyed_file = key in keyed
                    for offset, line_body in enumerate(lines):
                        size = len(line_body.encode("utf-8"))
                        source_line = start + offset
                        if intersects(keyed.get(key, []), source_line):
                            bucket = "keyedAnchorBodyBytes"
                        elif has_keyed_file:
                            bucket = "nonKeyedBodyBytesInKeyedFiles"
                        else:
                            bucket = "otherSourceFileBodyBytes"
                        categories[bucket] += size
                        file_bytes[(repo, path)] += size
                        body_total += size
            residual = response_bytes - body_total
            if residual < 0:
                failures.append({"transcriptLine": lineno, "sequence": event.get("sequence"), "kind": "body-exceeds-response", "bodyBytes": body_total, "responseBytes": response_bytes})
            else:
                categories["responseMetadataAndErrorsBytes"] += residual
            events.append({"sequence": event.get("sequence"), "tool": tool, "status": event.get("status"), "responseBytes": response_bytes, "sourceBodyBytes": body_total, "metadataAndErrorBytes": max(0, residual)})
            if tool.startswith("fallback_"):
                channel = "fallback"
            elif tool in ("locate", "read", "expand"):
                channel = "production"
            elif run["arm"] == "baseline":
                channel = "baseline"
            else:
                channel = "other"
            delivery_channels[channel]["calls"] += 1
            delivery_channels[channel]["responseBytes"] += response_bytes
            delivery_channels[channel]["sourceBodyBytes"] += body_total
            delivery_channels[channel]["metadataAndErrorBytes"] += max(0, residual)
        total = sum(e["responseBytes"] for e in events)
        if total != run["readBytes"]:
            failures.append({"kind": "run-total-mismatch", "runReadBytes": run["readBytes"], "eventResponseBytes": total})
        if sum(categories.values()) != total:
            failures.append({"kind": "attribution-total-mismatch", "attributed": sum(categories.values()), "responseBytes": total})
        item = {"ordinal": run["ordinal"], "case": run["case"], "project": run["project"], "arm": run["arm"], "responseBytes": total, "calls": run["calls"], "usage": run.get("usage", {}), "toolCalls": dict(sorted(tool_calls.items())), "deliveryChannels": {k: dict(sorted(v.items())) for k, v in sorted(delivery_channels.items())}, "categories": dict(sorted(categories.items())), "topSourceFiles": [{"repository": repo, "path": path, "bodyBytes": size} for (repo, path), size in sorted(file_bytes.items(), key=lambda pair: (-pair[1], pair[0]))[:5]], "events": events, "mappingFailures": failures}
        runs.append(item)
        for name, value in categories.items():
            arm_totals[run["arm"]][name] += value
        arm_totals[run["arm"]]["responseBytes"] += total
        for file_key, value in file_bytes.items():
            file_totals[(run["arm"], *file_key)] += value
        usage_totals[run["arm"]]["calls"] += run["calls"]
        for usage_key, usage_value in run.get("usage", {}).items():
            if isinstance(usage_value, int):
                usage_totals[run["arm"]][usage_key] += usage_value
        for channel, channel_values in delivery_channels.items():
            for field, value in channel_values.items():
                usage_totals[run["arm"]][f"{channel}.{field}"] += value
    by_arm = {}
    for arm, values in sorted(arm_totals.items()):
        total = values["responseBytes"]
        by_arm[arm] = {"responseBytes": total, "expectedResponseBytes": EXPECTED.get(arm), "reconciles": total == EXPECTED.get(arm), "categories": {k: v for k, v in sorted(values.items()) if k != "responseBytes"}, "callsAndModelUsage": dict(sorted(usage_totals[arm].items())), "topSourceFiles": [{"repository": repo, "path": path, "bodyBytes": size} for (a, repo, path), size in sorted(file_totals.items(), key=lambda pair: (-pair[1], pair[0][1:])) if a == arm][:10]}
    output = {"version": 1, "measure": "logical UTF-8 source body bytes mapped by answer-key file/hash/line; response-byte remainder is metadata, JSON escaping/structure, errors, and any non-source text. Keyed anchors are a lower bound on necessary evidence; other body bytes are not classified as waste.", "sources": {"answerKey": str(study / "answer-key.json"), "runRoot": str(run_root), "runs": len(runs)}, "classification": {"keyedAnchorBodyBytes": "body line is within any answer-key anchor span for the exact repository/path/SHA-256", "nonKeyedBodyBytesInKeyedFiles": "body line is elsewhere in a file that has one or more answer-key anchors", "otherSourceFileBodyBytes": "body line is in a source file without an answer-key anchor", "responseMetadataAndErrorsBytes": "event UTF-8 text bytes less logical source body bytes; includes JSON encoding/structure and any errors or non-source content"}, "byArm": by_arm, "runs": runs}
    rendered = json.dumps(output, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    if any(not item["reconciles"] for item in by_arm.values()) or any(run["mappingFailures"] for run in runs):
        raise SystemExit(1)

if __name__ == "__main__":
    main()
