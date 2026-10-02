# W-109 public source-tool canary

This directory retains the one-attempt public canary evidence. Deterministic
tests do not invoke a vendor model. The producer runs the live attempt only
after mechanical pre-review.

The runner imports W-108's fixture identity, exact Codex argv, MCP server and
semantic verifier. It freezes the installed executable identities, stages only
the current user's mode-0600 `auth.json` in a private temporary home, then
creates `attempt-marker.json` immediately before its single spawn. A PASS means
only that this client/model/version completed the public fixture with exactly
`orient -> locate -> read`; it does not prove tool isolation or read savings.

The live command is intentionally explicit:

```text
node --import tsx docs/research/read-efficiency/W-109-public-canary.mjs run \
  --repo <absolute-checkout> \
  --registry <absolute-checkout>/docs/research/read-efficiency/fixtures/W-108/registry.json \
  --evidence <absolute-checkout>/docs/research/read-efficiency/W-109-public-canary/evidence \
  --cwd <absolute-empty-read-only-cwd> \
  --runtime-parent <absolute-owner-mode-0700-temporary-parent> \
  --auth <absolute-current-user-codex-home>/auth.json \
  --codex <absolute-codex-executable> \
  --node <absolute-node-executable>
```

After PASS or FAIL, do not retry, tune, resume or reuse the marker. A hard crash
can leave credentials in the private runtime. `cleanup-only` may remove that
runtime after it verifies the mode-0600 marker, its freeze hash, owner, mode and
containment beneath the named parent:

```text
node --import tsx docs/research/read-efficiency/W-109-public-canary.mjs cleanup-only \
  --marker <absolute-evidence>/attempt-marker.json \
  --runtime-parent <absolute-owner-mode-0700-temporary-parent>
```

Cleanup never removes the attempt marker, writes a result or starts a model.
