#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path

BASE = Path("/home/edckt/projects/bisellium/docs/research/maps-fresh-2026-09-28")
FROZEN_FACTS = BASE / "correction/frozen-facts.json"
QUESTIONS = BASE / "preparation/questions.json"
SOURCE_FREEZE = BASE / "preparation/question-source-freeze.json"
OUTPUT = BASE / "correction/corrected-key.json"
VALIDATION = BASE / "correction/validation.json"
NOTES = BASE / "correction/notes.md"

# Each tuple is (frozen relative source path, exact minimal source text).
EVIDENCE = {
    "B8-R1": (
        "What does the current epoch0 snapshot adapter actually return",
        [("adapters/epoch0/src/index.ts", 'return { sellae: [], opera: [] };')],
    ),
    "B8-R2": (
        "what does its send operation report",
        [("adapters/epoch0/src/index.ts", "delivered: false"),
            ("adapters/epoch0/src/index.ts", "not implemented")],
    ),
    "B9-R1": (
        "What evidence must every done engineering item carry",
        [("studio/leges/engineering.md", "Every `done` item carries: test log path, review note path, and the recorded\nred for every behaviour its spec listed (check: lesson.evidence).")],
    ),
    "B9-R2": (
        "what posture follows when the weekly allowance is exceeded",
        [("studio/leges/engineering.md", "Over-budget: posture → conserve, digest the cause, no new items started")],
    ),
    "B10-R1": (
        "Which model and effort does the corrected active censor assignment use",
        [("studio/decisions/D-014.md", "the active censor assignment in the\npreceding amendment is corrected to `gpt-5.6-sol` at high reasoning effort.")],
    ),
    "B10-R2": (
        "what independence constraints remain explicit",
        [
            ("studio/decisions/D-014.md", "The censor remains independent, read-only and the\nsole review gate."),
            ("studio/decisions/D-014.md", "Historical Astra and Opus review records remain accepted;\nthis prospective correction rewrites or re-signs none of them."),
        ],
    ),
    "B11-R1": (
        "recorded states of W-089 and W-102",
        [("studio/opera/W-089.md", "state: greenlit")],
    ),
    "B11-R2": (
        "recorded states of W-089 and W-102",
        [
            ("studio/opera/W-102.md", "state: done"),
            ("studio/opera/W-102.md", "spec: { sella: architect, status: passed"),
            ("studio/opera/W-102.md", "tests: { status: passed"),
            ("studio/opera/W-102.md", "lint: { status: passed"),
            ("studio/opera/W-102.md", "types: { status: passed"),
            ("studio/opera/W-102.md", "review: { sella: qa-lead, status: passed"),
        ],
    ),
    "E8-R1": (
        "Which source surfaces are authoritative for project task state",
        [("AGENTS.md", "1. Backend implementation (`backend/app/services/combat/*`, `battle.py`)\n2. DB migrations (what is actually seeded)\n3. Tests (`backend/tests/`)\n4. `docs/game/GAME_MECHANICS.md`, then `docs/game/CHARACTER_ROSTER.md`")],
    ),
    "E8-R2": (
        "what rule prevents editing an applied migration",
        [
            ("README.md", "Create `db/migrations/NNN_description.sql` — next sequential number, no gaps."),
            ("README.md", "**Never edit a migration after it has been applied.**")
        ],
    ),
    "E9-R1": (
        "Which two battle-state constructors must stay mirrored, what test guards them",
        [("AGENTS.md", "**Parallel battle-state paths**: `battle.py:start_session` (production)\n  and `backend/sim/progression/combat_adapter.py:build_battle_state`\n  (sim) construct state independently. A change to one MUST be mirrored\n  in the other; `backend/tests/combat/test_combat_adapter_mechanics.py`\n  is the differential guard.")],
    ),
    "E9-R2": (
        "how are registry ability values interpreted",
        [("AGENTS.md", "**Registry = maxed end-state**: character ability values in the combat\n  registries are the MAXED values; fresh values = maxed − Σ(upgrade\n  rungs).")],
    ),
    "E10-R1": (
        "What is the current status of M2 and M3",
        [
            ("docs/program/PROGRAM.md", "M2 — World & Story | DONE"),
            ("docs/program/PROGRAM.md", '| M3 — Art at Scale | live, not "pending" |'),
        ],
    ),
    "E10-R2": (
        "which ladder now controls work ordering",
        [("docs/program/PROGRAM.md", "The M-ladder above stays as the phase map (it still correctly describes\neach milestone's SCOPE), but the ORDER work happens in is the P1-P5\nPlayable Ladder: P1 \"It feels like a game\" → P2 \"It looks like our\nworld\" → P3 \"Characters at scale\" → P4 \"It's a live game\" → P5 \"It's\nin your hands anywhere.\"")],
    ),
    "E11-R1": (
        "Which durable board states exist around scheduled and done",
        [("docs/program/BOARD.md", "BOARD.md stores DURABLE states only:"),
            ("docs/program/BOARD.md", "→ `scheduled`"),
            ("docs/program/BOARD.md", "→ `done`")],
    ),
    "E11-R2": (
        "how is in-train status determined",
        [
            ("docs/program/BOARD.md", "**\"in-train\" is NEVER a stored state.** It is DERIVED live from\n`git worktree list` + `gh pr list` — `scripts/train_status.sh` computes\nit on demand"),
            ("docs/program/BOARD.md", "A row a train has picked up stays\n`scheduled` in storage; `start_train.sh --board-id <ID>` annotates it\n(\"started `<date>`, see worktree\") rather than changing its state"),
        ],
    ),
    "Y8-R1": (
        "What are Yan Mo’s rules for randomness",
        [
            ("CLAUDE.md", "**No RNG in anything read or answered.** Required by the perfect-reading fantasy. No crit/dodge/damage variance; enemy behavior, tells, and outcomes are **pure functions of state**; difficulty scales the *read-window*, never randomness."),
            ("CLAUDE.md", "**Configurational variety** — selection among *challenge-equivalent* options (e.g., which arena fixture activates) — may draw from a **seeded deterministic stream** in sim state (same seed → same fight; goldens hold)."),
        ],
    ),
    "Y8-R2": (
        "managed resources",
        [("CLAUDE.md", "Keep the managed-resource count low — **HP · enemy Poise (势) · heal charges · one qi meter.**")],
    ),
    "Y8-R3": (
        "deliberate mercy",
        [("CLAUDE.md", "**Mercy is deliberate.** Standard enemies have **no HP** — every kill is a held 击 (tap = subdue / hold = kill). No accidental kills. **Ink = witness/mercy, blood = force; the ratio on the page is the record** (and the Mercy axis of the ending).")],
    ),
    "Y9-R1": (
        "What build gates precede content expansion",
        [("docs/dev-workflow.md", "E0 tech foundation\nE1 combat vertical slice ─────────► [ GATE: VALIDATE FUN ]   is the reading-combat fun?  (you + 2–3 fresh players)\n                                    only pass this before spending on anything below\n[ TONE PROBE ]  a thin E6 slice ──► does the melancholy reading-descent land emotionally?\nE2 enemies · E3 progression\nE5 Biome 1 end-to-end ────────────► [ GATE: MEASURE COST ]   what does ONE full biome actually cost to build?\n                                    → informed go/no-go on the other ten\nthen: E10 content · E7 Avici · E8 meta · E9 art/audio (in parallel)")],
    ),
    "Y9-R2": (
        "what is the required per-feature implementation and verification loop",
        [
            ("docs/dev-workflow.md", "0. **Ground** *(added 2026-07-27, from a real miss)* — **before authoring content in a domain that has a reference doc, read it.**"),
            ("docs/dev-workflow.md", "1. **Spec** — if it isn't already specced, `superpowers:brainstorming` → a design doc."),
            ("docs/dev-workflow.md", "2. **Plan** — `superpowers:writing-plans` → an ordered, reviewable task list"),
            ("docs/dev-workflow.md", "3. **Implement** — `superpowers:executing-plans` + `superpowers:subagent-driven-development`"),
            ("docs/dev-workflow.md", "Inside each unit: `superpowers:test-driven-development` — the golden test first, then the code (§3)."),
            ("docs/dev-workflow.md", "4. **Verify** — `superpowers:verification-before-completion`: actually run it and observe behavior"),
            ("docs/dev-workflow.md", "5. **Review** — two lenses, both before merge: `superpowers:requesting-code-review` (correctness) **+ `ponytail-review` (over-engineering — what to delete)**."),
            ("docs/dev-workflow.md", "6. **Commit** — small, focused commits on a feature branch; PR for anything non-trivial."),
        ],
    ),
    "Y10-R1": (
        "What does the E1 slice include",
        [
            ("docs/vertical-slice-spec.md", "ARENA       one grey-box plate (pure grey-box, no art)"),
            ("docs/vertical-slice-spec.md", "PLAYER KIT  jiàn verbs 点 / 刺 / 格 / 截  ·  dodge-read (the perfect-read flurry)  ·  击 (tap / hold)\n            HP + 1 heal charge  ·  qi meter (earned-by-reading)  ·  2 abilities: Shout (space) + Displacement (an opener)\n            ONE soul-sight, PASSIVE — surface-penetration possessed from spawn (canon correction 2026-07-25: sights are never toggled; the fairness floor — is the raw feint fair without it? — is validated via sim-state config + tests, not a player toggle)"),
            ("docs/vertical-slice-spec.md", "ENEMIES     3 archetypes — REGULAR (base timing/direction) · FEINTER (the read-that-lies) · CONSCRIPT (fearful → mercy)\n            + 1 Sergeant boss (a Poise + HP duel; renamed from \"Captain\" at A8 — it is a BossTemplate, not the CAPTAIN archetype).  All fought individually — no guard crowds in the slice."),
            ("docs/vertical-slice-spec.md", "SYSTEMS     Tell/read  ·  deterministic BehaviorPolicy  ·  Poise (势, poise-only for standard enemies)\n            击 gate (tap/hold) + mercy tally  ·  fearful gesture-resolution (the Conscript)  ·\n            qi earn/spend  ·  perceive() (one filter)"),
        ],
    ),
    "Y10-R2": (
        "which major systems are explicitly out of scope",
        [("docs/vertical-slice-spec.md", "traversal / platforming · puzzles · soul-encounter narrative · other biomes · animation & art polish · cutscenes · save/load · menus · the full 9 abilities · difficulty tiers · Assist Mode · **阵势 guard-crowds / crowd-击 (→ E2)** · progression / leveling · the ending-matrix UI.")],
    ),
    "Y11-R1": (
        "What are the E1 success criteria for the read, mercy, and determinism loop",
        [("docs/vertical-slice-spec.md", "1. A new player learns to **deflect (格) on the tell**, and it feels satisfying, not twitchy.\n2. The **perfect-read dodge** (flurry) reads as *clarity*, not reflex — the time-slow lands, the opening feels *earned*.\n3. Breaking **Poise → 击** is a clear, weighty beat; **tap vs. hold** (subdue vs. kill) feels like a real choice.\n4. The **Feinter** teaches \"don't react to the surface\" without feeling *unfair*.\n5. The **Conscript** makes not-killing feel like the natural, low-friction path.\n6. **Qi-earned-by-reading** is *felt* — playing well visibly funds your abilities.\n7. Determinism is invisible-but-trusted — the same attack always reads the same way; nothing feels random.\n8. **Hesitation feels like a choice** — letting the 击 window pass (enemy recovers partial Poise) reads as a real, weighted decision, not a punish.")],
    ),
    "Y11-R2": (
        "what evidence defines completion",
        [
            ("docs/vertical-slice-spec.md", "All eight criteria demonstrably true in a playable Normal build (judged by you + 2–3 fresh players), with the debug harness confirming **deterministic behavior** (same inputs → same enemy actions)."),
            ("docs/vertical-slice-spec.md", "Then capture the tuning numbers the slice revealed (Poise / qi / HP / window values) back into `open-questions.md`."),
        ],
    ),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utf16_units(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def locate(source: str, exact: str) -> tuple[int, int, int, int]:
    count = source.count(exact)
    if count != 1:
        raise ValueError(f"expected one occurrence, found {count}: {exact[:80]!r}")
    start = source.index(exact)
    end = start + len(exact)
    start_line = source.count("\n", 0, start) + 1
    start_line_offset = source.rfind("\n", 0, start) + 1
    end_line = source.count("\n", 0, end) + 1
    end_line_offset = source.rfind("\n", 0, end) + 1
    return (
        start_line,
        utf16_units(source[start_line_offset:start]) + 1,
        end_line,
        utf16_units(source[end_line_offset:end]) + 1,
    )


def extract(anchor: dict, source: str) -> str:
    lines = source.splitlines(keepends=True)
    start_line = anchor["startLine"]
    end_line = anchor["endLine"]
    if start_line < 1 or end_line < start_line or end_line > len(lines):
        return ""
    selected = "".join(lines[start_line - 1:end_line])
    selected_lines = selected.splitlines(keepends=True)

    def cp_index_for_utf16(text: str, one_based: int) -> int | None:
        target = one_based - 1
        units = 0
        for index, char in enumerate(text):
            if units == target:
                return index
            units += utf16_units(char)
            if units > target:
                return None
        return len(text) if units == target else None

    start_cp = cp_index_for_utf16(selected_lines[0].rstrip("\r\n"), anchor["startCharacter"])
    end_cp = cp_index_for_utf16(selected_lines[-1].rstrip("\r\n"), anchor["endCharacterExclusive"])
    if start_cp is None or end_cp is None:
        return ""
    if len(selected_lines) == 1:
        return selected_lines[0].rstrip("\r\n")[start_cp:end_cp]
    return selected_lines[0][start_cp:] + "".join(selected_lines[1:-1]) + selected_lines[-1].rstrip("\r\n")[:end_cp]


def build():
    frozen = json.loads(FROZEN_FACTS.read_text(encoding="utf-8"))
    questions = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    freeze = json.loads(SOURCE_FREEZE.read_text(encoding="utf-8"))
    frozen_files = {(item["project"], item["path"]): item for item in freeze["files"]}
    source_cache = {}
    hash_results = []
    for item in freeze["files"]:
        path = Path(item["root"]) / item["path"]
        actual = sha256(path)
        hash_results.append(actual == item["fileSha256"])
        source_cache[(item["project"], item["path"])] = path.read_bytes().decode("utf-8")
    if not all(hash_results):
        raise ValueError("one or more frozen source hashes changed")

    cases = []
    anchor_ids = []
    for case in frozen["cases"]:
        required = []
        for requirement in case["requirements"]:
            req_id = requirement["id"]
            clause, selections = EVIDENCE[req_id]
            anchors = []
            for number, (rel_path, exact) in enumerate(selections, 1):
                identity = frozen_files[(case["project"], rel_path)]
                source = source_cache[(case["project"], rel_path)]
                start_line, start_char, end_line, end_char = locate(source, exact)
                anchor_id = f"{req_id}-A{number}"
                anchor_ids.append(anchor_id)
                anchors.append({
                    "id": anchor_id,
                    "type": "sourceText",
                    "repository": identity["repository"],
                    "path": identity["path"],
                    "fileSha256": identity["fileSha256"],
                    "startLine": start_line,
                    "startCharacter": start_char,
                    "endLine": end_line,
                    "endCharacterExclusive": end_char,
                    "exactText": exact,
                })
            required.append({
                "id": req_id,
                "essentialRequestedFact": requirement["essentialRequestedFact"],
                "questionClause": clause,
                "satisfactionRule": "all minimal anchors",
                "evidenceAnchors": anchors,
                "alternativeEquivalentAnchors": [],
            })
        cases.append({
            "id": case["id"],
            "project": case["project"],
            "question": case["question"],
            "requiredEvidence": required,
        })

    key = {
        "version": 2,
        "state": "blind_correction_before_reanalysis",
        "inputs": {
            "questions": {
                "path": str(QUESTIONS),
                "sha256": sha256(QUESTIONS),
            }
        },
        "cases": cases,
    }
    OUTPUT.write_text(json.dumps(key, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    output_case_map = {case["id"]: case for case in key["cases"]}
    frozen_case_map = {case["id"]: case for case in frozen["cases"]}
    output_reqs = [req for case in key["cases"] for req in case["requiredEvidence"]]
    frozen_reqs = [req for case in frozen["cases"] for req in case["requirements"]]
    anchors = [anchor for req in output_reqs for anchor in req["evidenceAnchors"]]
    identities = {(item["repository"], item["path"], item["fileSha256"]): item for item in freeze["files"]}

    checks = {}
    checks["questionsSha256MatchesFreeze"] = sha256(QUESTIONS) == freeze["questionsSha256"]
    checks["questionsPayloadMatchesFrozenFacts"] = questions == frozen["questions"]
    checks["allFrozenSourceHashesMatch"] = all(hash_results)
    checks["caseCountIs12"] = len(key["cases"]) == 12 == len(frozen["cases"])
    checks["requirementCountIs25"] = len(output_reqs) == 25 == len(frozen_reqs)
    checks["caseIdentityProjectQuestionPreserved"] = all(
        case_id in output_case_map
        and {field: output_case_map[case_id][field] for field in ("id", "project", "question")}
        == {field: frozen_case[field] for field in ("id", "project", "question")}
        for case_id, frozen_case in frozen_case_map.items()
    )
    frozen_req_map = {req["id"]: req for req in frozen_reqs}
    output_req_map = {req["id"]: req for req in output_reqs}
    checks["requirementIdsAndFactsPreserved"] = set(frozen_req_map) == set(output_req_map) and all(
        output_req_map[req_id]["essentialRequestedFact"] == frozen_req["essentialRequestedFact"]
        for req_id, frozen_req in frozen_req_map.items()
    )
    checks["allQuestionClausesAreExactSubstrings"] = all(
        req["questionClause"] in output_case_map[req["id"].split("-R", 1)[0]]["question"]
        for req in output_reqs
    )
    checks["allRequirementsHaveEvidence"] = all(req["evidenceAnchors"] for req in output_reqs)
    checks["allSatisfactionRulesExact"] = all(req["satisfactionRule"] == "all minimal anchors" for req in output_reqs)
    checks["allAlternativeEquivalentAnchorsEmpty"] = all(req["alternativeEquivalentAnchors"] == [] for req in output_reqs)
    checks["anchorIdsUnique"] = len(anchor_ids) == len(set(anchor_ids))
    required_anchor_fields = {
        "id", "type", "repository", "path", "fileSha256", "startLine", "startCharacter",
        "endLine", "endCharacterExclusive", "exactText"
    }
    checks["anchorSchemaExact"] = all(set(anchor) == required_anchor_fields and anchor["type"] == "sourceText" for anchor in anchors)
    checks["allAnchorsUseFrozenIdentities"] = all(
        (anchor["repository"], anchor["path"], anchor["fileSha256"]) in identities for anchor in anchors
    )
    coordinate_results = []
    coordinate_positive = []
    end_character_on_end_line = []
    for anchor in anchors:
        identity = identities[(anchor["repository"], anchor["path"], anchor["fileSha256"])]
        source = source_cache[(identity["project"], identity["path"])]
        coordinate_results.append(extract(anchor, source) == anchor["exactText"])
        coordinate_positive.append(all(anchor[name] >= 1 for name in ("startLine", "startCharacter", "endLine", "endCharacterExclusive")))
        end_line_text = source.splitlines()[anchor["endLine"] - 1]
        end_character_on_end_line.append(anchor["endCharacterExclusive"] <= utf16_units(end_line_text) + 1)
    checks["allCoordinatesExtractExactText"] = all(coordinate_results)
    checks["allCoordinatesOneBasedPositive"] = all(coordinate_positive)
    checks["allEndCharactersReferToEndLine"] = all(end_character_on_end_line)
    checks["keyVersionAndStateExact"] = key["version"] == 2 and key["state"] == "blind_correction_before_reanalysis"
    checks["inputQuestionsPathAbsoluteAndExact"] = Path(key["inputs"]["questions"]["path"]).is_absolute() and key["inputs"]["questions"]["path"] == freeze["questionsPath"]
    checks["inputQuestionsHashActual"] = key["inputs"]["questions"]["sha256"] == sha256(QUESTIONS)

    validation = {
        "version": 1,
        "valid": all(checks.values()),
        "checks": checks,
        "counts": {
            "cases": len(key["cases"]),
            "requirements": len(output_reqs),
            "anchors": len(anchors),
            "frozenSources": len(freeze["files"]),
        },
        "artifacts": {
            "correctedKey": str(OUTPUT),
            "correctedKeySha256": sha256(OUTPUT),
            "generator": str(Path(__file__).resolve()),
        },
    }
    VALIDATION.write_text(json.dumps(validation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not validation["valid"]:
        raise SystemExit(1)

    NOTES.write_text(
        "# Blind correction notes\n\n"
        "- Built from the frozen facts, questions, source-freeze identities, and the exact 23 frozen source files only.\n"
        "- Preserved all 12 case identities/questions and all 25 requirement IDs/facts exactly.\n"
        "- Evidence spans use one-based lines and one-based UTF-16 code-unit columns; endCharacterExclusive is measured on endLine.\n"
        "- Separated non-contiguous necessary facts into distinct required anchors, applied the second blind validator’s five strict-minimality trims, and left alternativeEquivalentAnchors empty.\n"
        "- No packets were scored and no study outcomes were inspected or inferred.\n"
        "- The labels establish source support for the frozen facts only; a second blind validator remains responsible for independent label inspection before scoring.\n",
        encoding="utf-8",
    )
    print(json.dumps(validation, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    build()
