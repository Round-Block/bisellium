# W-107 A1 correction evidence

Signed amendment: `studio/briefs/W-107-A1.md`, SHA-256
`e0feea39982db7573346eac460701313ebb2f56e13c77762ec4956ead7b3aa22`.

The original behavior-8 red was copied byte-for-byte before the owning CLI
recorded the A1 assertion red. `pre-a1-08.log` has SHA-256
`e81a67d6c76f3a5c3a23c2247a4222ce2f00e90080faca5d3cb313d5f335e191`.
The current CLI-owned `studio/ci/reds/W-107/08.log` has SHA-256
`f6a427c8b751dfe24d1e9eedba298a0bcc5f740dbeb9c5cc35cfa854f596c98b`.
`preserve-red-evidence.py` is the retained mechanical copy step.

The focused A1 test covers scalar preparation and rejection of empty, object,
array, null and omitted values; duplicate and foreign-project anchors; proof of
oversized coverage; the three named projects; UTC `preparedAt`; lexical
traversal; and in-root symlinks. It passes after the bounded validator change.

The scalar-preparation runner required fresh pretrial controls; these hashes are historical after the later UTC metadata-only correction. The Luna-low live canary
under `canary/` passed exact Unicode, error, call-id and terminal-usage checks:

- runner `a95ebaa61c584e81cc13130f57eb5f490e842046bde3e81f0626fe49504fff3a`
- canary manifest `16f7e6a7f917beae2d2af26453f5e941b8e154bfe4394c9ca158c9d94bcd0d21`
- JSONL `4952594aa273c099551e19b1a6fc41af191657f0ab2907bd6769e3e2b3b4c812`
- transcript `de2c2c1b6b75017ad66406c420690cfdba0b667712e3754e73e86c74af9eb570`

The new scalar-preparation synthetic inputs validated with registry
`f33b91ce02bad9d7dcba7a3bcf599b47d9c4d23823f0b887b4061b392f0b40d1`,
cases `58545a27561d2b7cf439327a8b8671317a25409eed655d59f0c5ff638affb903`,
key commitment `bf4e073f44ce958876eea9e0dbd3965a5ba6e8dcb472089f880cb42962b2c849`
and manifest `08d31c256cfba599a9d8e96e322a7cd322e9df2de0f129b99f1cd7d77c72182c`.
The resulting historical A1 synthetic seal is
`f85e57ac9b092e10a1dd950fca11af95b0a2cf9725e3357e4020ed927f70d5ed`.
No held-out data was inspected and no held-out model arm was run here.
