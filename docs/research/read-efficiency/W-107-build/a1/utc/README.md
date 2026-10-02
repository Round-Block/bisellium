# W-107 UTC metadata correction evidence

The safe diagnosis `docs/research/read-efficiency/incident-a1-validation.md`
identified one metadata-only mismatch: ISO UTC `+00:00` was rejected while
literal `Z` passed. The validator now accepts both equivalent zero-offset forms,
rejects nonzero offsets, missing zones, invalid calendar dates and non-string
values, and changes no other predicate.

The pre-correction A1 behavior-8 red is retained as `pre-utc-08.log`, SHA-256
`f6a427c8b751dfe24d1e9eedba298a0bcc5f740dbeb9c5cc35cfa854f596c98b`.
The owning CLI recorded the focused UTC red at `studio/ci/reds/W-107/08.log`,
SHA-256 `dd43891d9eca70542968702c7751aca829a284a144d00860eef5b940a20a38ec`.

Focused UTC/A1 controls, the original offline behavior-8 controls, syntax and
format checks pass. No production test or live model call was repeated because
the change is confined to offline manifest metadata validation.

The regenerated ordinary synthetic fixture uses
`2026-01-02T03:04:05.123456+00:00` and validates with:

- runner `3f65eacedeb535e3c14888031f8cdd7386fdd41fea62fb85717c6d04105d720a`
- registry `cddfb10422ed660a55924adbd91ee6c57f8ac17dae7fd709b6e0f729af371701`
- cases `58545a27561d2b7cf439327a8b8671317a25409eed655d59f0c5ff638affb903`
- key commitment `bf4e073f44ce958876eea9e0dbd3965a5ba6e8dcb472089f880cb42962b2c849`
- manifest `64c63751e278e53fc492b0d57460a261b6855faa3f9b692b6cab771594b25f69`
- seal `173a38d2bf80cc431405f3f1bc1d60394092b282d0306f476bcc51e7f1c168a2`

No hidden input was inspected or changed and no held-out arm was run.
