# W-108 source adapter preflight

Outcome: **REFUSED  zero model spawns**.

The five deterministic behaviours pass. The installed Codex configuration parser accepted the frozen feature disables, but its no-model debugger did not expose an explicit effective tool inventory. That cannot prove shell, file, web, and ambient tools were absent, so the live canary was not started.

## Commands

- Deterministic: `/home/linuxbrew/.linuxbrew/Cellar/node/25.9.0_2/bin/node --import tsx /home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/read-efficiency/source-adapter-preflight.test.mjs /home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment`
- Configuration preflight: `/home/linuxbrew/.linuxbrew/lib/node_modules/@openai/codex/bin/codex.js debug prompt-input -c model="gpt-5.6-luna" -c model_reasoning_effort="low" -c mcp_servers.w108_source.command="/home/linuxbrew/.linuxbrew/Cellar/node/25.9.0_2/bin/node" -c mcp_servers.w108_source.args=["/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/read-efficiency/source-adapter-preflight.mjs","mcp-server","--registry","/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/read-efficiency/fixtures/W-108/registry.json","--transcript","/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/read-efficiency/W-108-preflight/runtime/config-server-transcript.jsonl","--freeze","/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/read-efficiency/W-108-preflight/runtime/preflight-freeze.json"] -c mcp_servers.w108_source.env={} --disable apps --disable artifact --disable browser_use --disable browser_use_external --disable browser_use_full_cdp_access --disable code_mode_host --disable computer_use --disable goals --disable hooks --disable image_generation --disable in_app_browser --disable multi_agent --disable plugin_sharing --disable plugins --disable shell_snapshot --disable shell_snapshot_v2 --disable shell_tool --disable skill_env_var_dependency_prompt --disable skill_mcp_dependency_install --disable skill_search --disable sleep_tool --disable standalone_web_search --disable tool_call_mcp_elicitation --disable tool_suggest --disable unified_exec --disable view_image --disable workspace_dependencies Use only the w108_source tools. Call orient first, then locate and read to find the requested public synthetic fact. Reply with the fact and its exact source.md:<line> citation. Do not guess or use any other tool.`
- Frozen live command: retained in `live-command.json`; executed: false.

## Frozen identities

- Driver SHA-256: `a1a04ddf2ee37545ae1c691aabac551edda80be8ee8a0e9afa1025fb6cbcc2e1`
- Test SHA-256: `9d8188d74f6f72acb7cbd9eafcfc8f3983fb4ae35685320bd026fd0761fe132c`
- Production source SHA-256: `5c094ca69e67bfefc85ac029bf1e8d7cc548725497aedcdb629fc8c2ecdd35e1`
- Registry SHA-256: `8b41927615fd30ae43059a1c0c30cdcd15109597fe40c28678c8741f580cd599`
- AGENTS.md SHA-256: `7a4a63ce80fd4dd9386c711315abd2b4c593019792ce5e4f5a722cba6da3f3f5`
- source.md SHA-256: `12a1e83fd32ce73c2bdf80054228a09aede061b67c1a9d4099fde5f5dc3e358c`
- Codex: `codex-cli 0.153.4`, SHA-256 `61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70`
- Node: `v25.9.0`, SHA-256 `446ae94fa7a47882d568a4923d1b3a42c40e0cfaadec7f7873d514f18408ce83`

## Result

- Deterministic behaviours: 1, 2, 3, 4, 5  PASS
- Configuration preflight: REFUSED (`EFFECTIVE_TOOL_INVENTORY_UNPROVEN`)
- Model usage: none
- Tool calls: 0
- Tool-result bytes: 0
- Server transcript SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- Model events SHA-256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Limits

This is a usability feasibility preflight only. It makes no adoption, answer-quality, token, subscription, byte-efficiency, or savings claim. The refusal authorizes no canary retry, tuning run, multi-project trial, held-out trial, or larger evaluation.
