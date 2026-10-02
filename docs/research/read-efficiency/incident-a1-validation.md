# W-107 A1 validation diagnosis

Runner SHA-256: `a95ebaa61c584e81cc13130f57eb5f490e842046bde3e81f0626fe49504fff3a`.
The unchanged authoritative manifest is INVALID / MANIFEST under that runner.
No held-out model trial ran.

## Complete blocking mismatch

Field: `snapshot-manifest.json.preparedAt`. Type: string. Value:
`2026-09-28T14:18:29.124410+00:00`.

The public signed schema requires an ISO UTC string. This value is ISO UTC:
`+00:00` is the zero UTC offset. The validator at line 1109 additionally
requires a literal terminal `Z`. That representation restriction was never
signed. It is a validator mismatch, not malformed preparation metadata.
The preparation field is already a valid nonempty string under A1.

All remaining current validator predicates were evaluated, not inferred from
the first failure: a diagnostic manifest copy replaced only trailing +00:00
with Z, preserving the exact instant and every other value, and ran the same
freeze-validate tool against the unchanged registry, cases, key and snapshots.
The complete validator returned VALID, errorCodes empty, exit 0. Consequently
there are no other actual-input rejection predicates in this runner after
removing this representation mismatch. This does not replace independent
semantic answer review or prove checks the validator does not implement.

## Safe synthetic requirement

In the ordinary synthetic fixture, use preparedAt
`2026-01-02T03:04:05.123456+00:00`: expect VALID when all other checks pass.
The equivalent `2026-01-02T03:04:05.123456Z` must also pass. Continue rejecting
nonzero offsets, missing timezone, malformed dates and non-string values.
Do not relax any other schema or acceptance gate. Separate builder owns this
product change; the architect changed no product code.

## Evidence and preservation

The private evaluation directory retains:
- `diagnose-a1-metadata.py`: exact retained diagnostic commands.
- `prevalidation-original/snapshot-manifest.json` and its SHA-256 file:
  exact original manifest backup.
- `diagnostic-z-manifest.json`: diagnostic copy only, not authoritative input.
- `validation-diagnostic-z.json`: full validator VALID receipt for that copy.
- `diagnostic-z-execution.json`: exact invocation, runner hash and exit/output.

Hashes of the authoritative registry, cases, key and manifest were checked
before/after and are identical. The original manifest remains unchanged, as
do questions, source bytes, facts, qualifications, anchors and all prior failed
receipts. No data correction or spec amendment is needed. After a separate
builder fixes the UTC representation check, an authorized offline operator
must validate the original inputs into a new receipt. The diagnostic VALID
receipt alone does not authorize trials on the still-rejected original manifest.
