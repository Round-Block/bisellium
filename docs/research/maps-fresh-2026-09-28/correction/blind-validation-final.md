# Independent packet-blind label validation

Assessor: separate Terra prereviewer. Exact final evidence sheet, recorded before corrected scoring:

Blind delta recheck complete. No remaining semantic findings.

- Final SHA-256: `7ea66bb3527bfd582bb8ad8cb7df0811e2ba11988c3de093a62e1818098ae8f7` — matches.
- v1 SHA-256: `20e51f56ae8ff2a9f87d4feed23f3e9353c8eaa6ebb602daa6922afe7a4ee0b3` — matches.
- Current counts: 12 cases, 25 requirements, 49 anchors, 23 frozen sources.
- All 23 current source hashes match the freeze; all 49 anchor repository/path/hash identities and one-based UTF-16 exact slices match. No mechanical issues.
- v1→v2 diff is limited to the four stated requirements’ `evidenceAnchors`: B8-R2 split into `delivered: false` plus `not implemented`; E8-R2-A2, E10-R1-A1, and E11-R1-A2/A3 were trimmed. All other requirement fields, anchors, and top-level metadata are unchanged.
- The five trimmed areas remain sufficient in source context: B8 proves both delivery and implementation state; E8 proves the applied-migration prohibition and sequential-file condition; E10 names M2 `DONE` and M3 `live`; E11’s durable-state declaration plus ordered `→ scheduled` and `→ done` spans establishes both states.
- Blindness maintained: no packets, outcomes, original hidden key/diff, scores, execution, reports, selection rules, or identities were read.

Read-only command form retained: PowerShell here-string piped to `wsl.exe python3 -`, using `hashlib.sha256` and UTF-16LE code-unit slicing.
