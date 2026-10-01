#!/usr/bin/env python3
"""Read-only W-125 evidence census; run from any directory with Python 3.

Review counts use only the final post-`tokens used` answer, avoiding the
transcript's repeated tool output and draft verdict. A missing citation means
no literal briefs/W-NNN.md:LINE within that numbered finding; it does not
mean that the finding lacks substantive grounds. Causal/scope classification
requires reading the cited evidence and is intentionally not inferred here.
"""

from pathlib import Path
import re


REPO = Path(__file__).resolve().parents[1]
REVIEWS = [("W-096", 5), ("W-101", 3), ("W-087", 3)]
FINDING = re.compile(r"^\s*\d+\.\s*(?:\*\*)?(BLOCKING|ADVISORY)\b", re.I | re.M)
CITATION = re.compile(r"briefs/W-\d+\.md:\d+")
REFUSALS = {
    "spawnSync EPERM": re.compile(r"spawnSync[^\n]{0,160}?\bEPERM\b"),
    "index.lock": re.compile(r"index\.lock[^\n]{0,160}"),
}


def label(path):
    return str(path.relative_to(REPO)) if path.is_relative_to(REPO) else str(path)


def review_census():
    total_blockers = total_uncited = rounds_uncited = rounds_failed = 0
    print("FINAL-ANSWER FINDING CENSUS")
    for opus, rounds in REVIEWS:
        for round_number in range(1, rounds + 1):
            path = REPO / f"studio/ci/{opus}-review-{round_number}.log"
            source = path.read_text()
            marker = "tokens used\n"
            offset = source.rfind(marker)
            if offset < 0:
                raise ValueError(f"{path}: missing final-answer marker")
            offset += len(marker)
            answer = source[offset:]
            findings = list(FINDING.finditer(answer))
            blockers = uncited = 0
            anchors = []
            for index, match in enumerate(findings):
                if match.group(1).upper() != "BLOCKING":
                    continue
                end = findings[index + 1].start() if index + 1 < len(findings) else len(answer)
                finding = answer[match.start():end]
                # Match leading whitespace can include a blank separator line.
                line_offset = match.start() + len(finding) - len(finding.lstrip())
                line = source.count("\n", 0, offset + line_offset) + 1
                citations = sorted(set(CITATION.findall(finding)))
                blockers += 1
                uncited += not citations
                anchors.append(f"  {label(path)}:{line}: " + (", ".join(citations) or "NO literal brief-line citation"))
            print(f"{label(path)}: blockers={blockers}, uncited={uncited}")
            print("\n".join(anchors)) if anchors else None
            total_blockers += blockers
            total_uncited += uncited
            rounds_uncited += uncited > 0
            rounds_failed += blockers > 0
    print(f"TOTAL rounds={sum(n for _, n in REVIEWS)}, rounds_with_blockers={rounds_failed}, "
          f"blockers={total_blockers}, uncited_blockers={total_uncited}, "
          f"rounds_with_uncited_blockers={rounds_uncited}")


def refusal_census():
    print("\nLITERAL REFUSAL/LOCK SEARCH (bounded excerpts; matches may quote earlier output)")
    for root in [REPO / "studio/ci", Path.home() / ".bisellium-evidence"]:
        if not root.exists():
            print(f"{root}: unavailable")
            continue
        matches = {name: [] for name in REFUSALS}
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            for number, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
                for name, pattern in REFUSALS.items():
                    match = pattern.search(line)
                    if match:
                        excerpt = line[max(0, match.start() - 45):match.end() + 45]
                        matches[name].append((path, number, excerpt[:250]))
        for name, rows in matches.items():
            print(f"{label(root)}: {name}: matching_lines={len(rows)}, files={len({row[0] for row in rows})}")
            # Prefer the three requested opera when selecting example anchors.
            rows.sort(key=lambda row: (not any(opus.lower().replace('-', '') in row[0].name.lower().replace('-', '') for opus, _ in REVIEWS), str(row[0]), row[1]))
            emitted_per_file = {}
            emitted = 0
            for path, number, excerpt in rows:
                if emitted_per_file.get(path, 0) >= 2:
                    continue
                print(f"  {label(path)}:{number}: {excerpt}")
                emitted_per_file[path] = emitted_per_file.get(path, 0) + 1
                emitted += 1
                if emitted == 20:
                    break


if __name__ == "__main__":
    review_census()
    refusal_census()
