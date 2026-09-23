# W-044 threat-model input — codex gpt-5.6-sol, 2026-09-23

Analysis input for the architect's W-044 spec; produced read-only, verified non-empty by the orchestrator. Not the spec.

## 2. Useful minimum and narrowing costs

Recommended CLI surface: exact bare `bisellium` for usage, plus only `context`, `query`, `check`, and—if its subprocess is accepted—`providers`.

| Narrowing | What breaks | Tick daily |
|---|---|---|
| Broad wildcard → four verbs | No lifecycle, dispatch, cross-sella `talk`, verification, or CLI mutation from conversation. `PETITIO:`/`ACTUM:` replies still work. | Still works. |
| Remove `providers` | No live quota probe; cached provider posture remains in context. | Unaffected. |
| Remove `check` | Cannot request current validation findings. | Still writes a daily, with poorer health context. |
| Remove `query` | Loses deterministic status/why answers; model must inspect context/files. | Still works. |
| Remove `context` | Fresh sessions retain their initial bundle, but `resume()` does not inject a newly built bundle. Resumed talk/tick can report stale state. | Fresh daily works; resumed daily freshness breaks. |
| Remove all Bash | The injected “run `bisellium` for usage” instruction becomes impossible. | Works only if fresh context is supplied on every resume. |

Important: `--allowedTools` is not itself a tool restriction; current Claude documentation says it adds no-prompt permissions and directs callers to `--tools` to restrict availability. The boundary therefore also needs restricted configuration, no unattended permission prompts, and MCP denial—not merely four `Bash(...)` strings. [Claude CLI reference](https://code.claude.com/docs/en/cli-usage)

## 3. Explicitly out of scope

- Prompt injection can still cause `ACTUM:` or `PETITIO:` output; `talk.ts` then writes tracked records without Bash.
- Tick intentionally writes `health.json`, receipts, timelines, sessions, and daily acta.
- `providers` still launches fixed third-party code unless restricted to `--source usage`.
- `query --from-index` writes an index.
- Allowed verbs accept caller-selected studio/repo/sella paths, enabling cross-seat or cross-studio reads.
- `Read` and `WebFetch` retain disclosure, exfiltration, and further prompt-injection risk.
- The Codex harness has no equivalent command allowlist in this code; fixing only `claude-code.ts` does not establish a provider-neutral boundary.

## 4. Test shapes

- Export one immutable policy object. Assert exact equality of permitted built-ins and exact equality of Bash verb prefixes for both `start` and `resume`.
- Assert argv includes restrictive mode, an explicit `--tools` set, unattended prompts disabled, and `mcp__*` denied.
- Assert no rule matches the `bisellium` root wildcard; every Bash rule must derive from the four-element read-verb set.
- Test a synthetic future CLI verb is denied automatically. Do not list known dangerous verbs.
- Separately test each admitted verb’s allowed flag forms, especially rejecting `providers --source quota-axi` and `query --from-index` if “read-only” is meant literally.

