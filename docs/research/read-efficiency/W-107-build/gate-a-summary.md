# W-107 Gate A build summary

- Signed brief SHA-256: `018dc802447a7c08552cf78b28fa165ffdd9b2b41050ff66c663b93652aab4a1`.
- Eight assertion-level reds retained under `studio/ci/reds/W-107/01.log` through `08.log` (CLI reports them as `ci/reds/...`).
- Production focused behaviors 1-6: PASS.
- Live Unicode/error/result/usage canary: PASS; pre-output approval failure retained separately.
- Live forbidden-shell bypass detection canary: PASS.
- Freeze validator plus eight negative controls: PASS.
- Twelve-arm offline synthetic aggregation control: PASS.
- Synthetic closed-schema validation and implementation freeze: PASS.
- Synthetic declared one-arm model execution and transcript audit: PASS.
- Historical pre-A1 synthetic seal: `f8aa0a7208c5dbf30030cba2888858ad98bbe3ba035d0f08c26c374b44b97cba`; audited run: `448b17a848b2fafb29e5ff9ee3d2dfa8c4d5cd8ce285c08b0c38bb7b5c8bfea3`.
- Repository full test suite: PASS.
- Repository typecheck: PASS.

The final focused suites and typecheck were rerun after formatting; the full suite passed before the formatting-only pass. No held-out input or key was read and no held-out model trial was run in this build context.

## A1 revision

- Signed amendment SHA-256: `e0feea39982db7573346eac460701313ebb2f56e13c77762ec4956ead7b3aa22`.
- A1 focused scalar/schema/confinement controls: PASS.
- Prior behavior-8 red preserved; A1 red recorded through the owning CLI.
- Fresh pinned Luna-low Unicode/error/usage canary: PASS.
- Fresh scalar-preparation synthetic validation and seal: PASS.
- Historical scalar-A1 runner SHA-256: `a95ebaa61c584e81cc13130f57eb5f490e842046bde3e81f0626fe49504fff3a`.
- Historical scalar-A1 synthetic seal: `f85e57ac9b092e10a1dd950fca11af95b0a2cf9725e3357e4020ed927f70d5ed`.
- Most recent model-protocol canary manifest: `16f7e6a7f917beae2d2af26453f5e941b8e154bfe4394c9ca158c9d94bcd0d21`; the later change is offline metadata validation only.
- A1 focused tests, official typecheck and full repository suite: PASS.
- No held-out data was inspected and no held-out arm was run.

## UTC metadata correction

- `Z` and `+00:00` UTC equivalence regression: PASS.
- Nonzero offsets, missing zones, invalid dates and non-string timestamps: rejected.
- Original behavior-8 offline controls, syntax and formatting: PASS.
- Current runner SHA-256: `3f65eacedeb535e3c14888031f8cdd7386fdd41fea62fb85717c6d04105d720a`.
- Current `+00:00` synthetic seal: `173a38d2bf80cc431405f3f1bc1d60394092b282d0306f476bcc51e7f1c168a2`.
- No hidden input was inspected or changed, no model call was made, and no held-out arm ran.
