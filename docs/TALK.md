---
kind: guide
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the commands it describes are removed or fold back into docs/ADOPTION.md
---

# Reference: talk and probe

Contract: `docs/ADOPTION.md`; where they disagree, the contract wins.

## Running talk

```bash
npm run bisellium -- talk --sella <sella> [--studio <dir>] [--harness <id>] [--model-only] [--now <iso>] <message…>
```

`talk` is the Patron's direct line to one sella, driving its vendor CLI
headless (docs/STUDIO.md §11: `claude -p --resume`, `codex exec --resume`)
through a `@bisellium/shim` `HarnessProfile` — `claude-code` (tier 1),
`codex` (tier 2), or `git-only` (tier 3: always "available", but talking to
it is a contradiction in terms — `start`/`resume` refuse). Which profile a
sella uses is its manifest entry's `harness` key (`sellae[].harness`,
default `claude-code`), overridable per call with `--harness`. The boot
bundle reaches `claude` via `--append-system-prompt-file <tmpfile>` (written
just before the call, deleted right after) rather than as an argv token —
an argv-sized prompt risks the platform's argv length limit and is visible
in `ps`, neither a problem for a file.

A vendor CLI reporting a real usage/rate limit (`Turn.exitCode ===
USAGE_LIMIT_EXIT_CODE`, mapped to `talk`'s exit 3 below) is detected only
from signals a sella's own conversation can't fake by talking ABOUT a
limit: for `claude-code`, the JSON envelope's own `is_error`/`subtype`/
`error` fields, or stderr; for `codex`, stderr or a dedicated `error`-kind
JSONL event. A reply's `result`/`agent_message` text (what the sella
actually said) is never inspected for this — a sella relaying "we hit a
rate limit yesterday" or mentioning "429" must be delivered normally, not
mistaken for the harness itself being limited. `codex`'s event parsing also
reads an `agent_message`/`assistant` reply wrapped in `item.completed`
(`{ type: "item.completed", item: { type: "agent_message", text } }`, a
shape some codex-cli releases use), not just a top-level event.

A question `bisellium query` already answers deterministically (`status
W-<id>`, `burn`, "what is blocked on me") is answered from the studio's
files — printed as `query · <answer>` — without starting or resuming a
harness session at all, unless `--model-only` forces the model path.
Otherwise `talk` builds the sella's boot bundle (the same one `bisellium
context` prints) as the system prompt, starts a session or resumes the last
one recorded for that sella *on the same harness* (`sessions/<sella>.json`:
`harness`, `sessionId`, `startedAt`, `lastAt`, `turns` — switching
`--harness` starts a fresh session rather than resuming under a mismatched
vendor), prints the reply, and appends both sides of the exchange to
`timeline/<sella>.jsonl` (`at`, `sella`, `direction: in|out`, `text`,
`sessionId`, `model`, `usage`). `talk` always runs in the studio root, never
inside a worktree — worktrees are for `run`, which actually changes files;
a conversation doesn't. Every vendor spawn a harness profile makes —
`claude-code`'s and `codex`'s `start`, `resume` and `available()` alike, so
the rule holds even for a bare `--version` probe — hands the child process
only ten env names (`PATH`, `HOME`, `SHELL`, `TMPDIR`, `HTTPS_PROXY`,
`https_proxy`, `HTTP_PROXY`, `http_proxy`, `NO_PROXY`, `no_proxy`), each
copied verbatim from the parent if set (`harnessEnv`,
`packages/shim/src/harness/env.ts` — not a `@bisellium/shim` export).
Everything else is dropped, an endpoint or auth override and a vendor
variable that doesn't exist yet included: a talked session authenticates
only with the vendor login stored under `HOME`, never an ambient
`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` or similar left in the
operator's shell. `run -- <cmd>` is not a harness spawn — it's the
operator's own command, attributed to a sella, and keeps the operator's
env unfiltered.

A harness turn that comes back with no usable `sessionId` (empty or
non-string) is never persisted or resumed against: it's recorded as a fresh
start (`sessions/<sella>.json`'s `sessionId: null`, with a `note` on both of
that turn's `timeline/<sella>.jsonl` entries), and `readSession` treats any
stored record whose `sessionId` isn't a non-empty string the same way — as
if there were no session file at all, so the next call starts fresh again
rather than ever resuming against `""` or `null`.

A conversation is chatter (dossier: STUDIO.md §5) unless it escalates: a
reply line starting `PETITIO: <text>` opens a petitio addressed to the
patron (the next `P-NNN` under `petitiones/`, `from` the sella, `state:
needs_you`) and `talk` prints `petitio P-NNN opened`; a line starting
`ACTUM: <text>` writes a `kind: decision` acta entry authored by the sella.
Everything else in the reply stays in the timeline only — silence (or an
ordinary reply) binds nothing, same as any other acta. Three guards apply
before a line counts as either: it must be **top-level** (`^PETITIO:`/
`^ACTUM:` with no leading whitespace — a line nested under a list or
blockquote never matches), **unfenced** (not inside a ` ``` … ``` ` block —
a sella quoting an example must not accidentally escalate), and **not an
echo**: a line whose trimmed text already appears verbatim in the boot
bundle sent as that turn's system prompt (e.g. a `PETITIO:`-looking line
inside another petitio's body, embedded as context) is content, not a fresh
instruction to escalate, and is skipped. Usage-limit detection itself never
looks at reply text either (below) — only a harness's own envelope/event/
stderr signal ever produces the exit-3 path this section's petitio/decision
logic runs after.

`talk` writes a run receipt exactly like `bisellium run` does
(`receipts/<sella>/<sessionId>.json`), with `harness` set to the profile id
that actually ran instead of `"run"`. Exit codes: 0 ok (including the
deterministic-query fast path) · 1 the harness exited 0 but the reply was
empty — refused as a failure, nothing persisted (session, timeline and
receipt alike; see below) · 2 usage error / not a studio / unknown sella /
unknown or unavailable harness (one-line reason) · 3 the harness reported a
usage/rate limit, printed as `<sella> is limited on <harness>; try again
after <reset if known>` · anything else is the harness's own exit code,
relayed as-is.

**The `claude-code` profile's talk boundary is deny-by-default (W-044).**
Both `start` and `resume` pass `--restricted` (ignores every user/project/
local settings file, confines file tools to the studio root), `--strict-mcp-
config` (no MCP servers), `--permission-mode dontAsk` (anything not
pre-approved is denied, never prompted for), `--tools Read,Grep,Glob,Bash`
(`WebFetch` is not admitted — paired with `Read` it would be the profile's
only egress), and an `--allowedTools` list admitting exactly `Read`, `Grep`,
`Glob`, and seven `Bash(bisellium …)` rules for `context`, `query`, `check`
and the bare `bisellium` usage banner. `providers` is not admitted either —
its default source spawns `npx --yes quota-axi`, a network fetch plus
third-party code that neither `talk` nor `tick`'s unattended daily needs; the
cached provider posture is already in the boot bundle. A `claude` binary
that doesn't recognize `--restricted`/`dontAsk` exits non-zero and `talk`
relays that failure closed, which is intended.

**The decreed model reaches both profiles, and codex gets its own command
policy (W-046).** The model `talk` uses is decreed by the manifest —
`sellae[].model` — and travels from there into whichever profile the sella's
harness resolves to; `talk` itself has no `--model` flag, and no `--model`
flag is ever accepted (models are decreed, per D-020; a per-call override
would be a route around that decree — `--harness` already exists for the
one axis an operator legitimately switches). Nothing is ever read from
`process.env`, a vendor config file, or a session being resumed. On
`claude-code` it is passed as `--model <id>` (ahead of the W-044 policy
flags above — `--allowedTools` is variadic and terminal, so anything added
after it would be silently eaten as a tool name); a `claude` binary that
doesn't recognize the requested model exits non-zero with a parseable
envelope on stdout whose own `result` names the problem (e.g. "There's an
issue with the selected model…") and a separate stderr line
(`[claude-code:unrecognized_model] {…}`) — both useful, both different. On
any failed turn, `talk` relays the exit code **and both** of the vendor's
own captured diagnostics — the envelope's own error text and the vendor's
stderr line, whichever of them exist — joined, bounded, redacted, never
parsed or branched on (behaviour 7) — and nothing stronger, so a sella
whose declared model doesn't belong to its harness stops silently running
on the wrong model and starts failing loudly and readably. On
`codex` it is
passed as `-m <id>`, alongside a module-local command policy applied
identically by `start` and `resume` (`codex exec resume` rejects
`-s`/`--sandbox` on codex-cli 0.153.4, so the sandbox mode travels as
`-c sandbox_mode=read-only` instead, which both spawns accept):
`--ignore-user-config`, `--ignore-rules`, `-c sandbox_mode=read-only`,
`-c model_provider=openai` (passed explicitly because
`--ignore-user-config` drops the config file that used to supply it), and
eight `--disable` feature pairs — `--disable browser_use`, `--disable
browser_use_external`, `--disable browser_use_full_cdp_access`, `--disable
in_app_browser`, `--disable apps`, `--disable plugins`, `--disable
remote_plugin`, `--disable plugin_sharing` — each measured stable and
enabled by default on codex-cli 0.153.4, flipped to `false` by `--disable`.
**That list is the whole achievement on the tool surface — those eight
names, not "no egress."**

**CORRECTED, round 2 (censor F-1): a live vendor-side web fetch/search
channel survives the whole policy, closed by none of the eight `--disable`
names.** Measured under the exact shipped argv, twice, with a hallucination
control: a talked codex session can fetch a live, moving value over the
network (`web.run`) and report it back. The fetch runs vendor-side, so
neither the studio's bubblewrap sandbox nor `sandbox_mode=read-only` touches
it. No egress-closing flag is specified here, because none was probed;
whether one exists is the follow-on's question.

**This is not W-044 parity, and the gap is signed, not hidden: codex's
policy here is not equivalent to the claude profile's.** Five residuals,
carried forward until a build-shaped follow-on opus can close them, egress
first because it is the largest: **egress is open, paired with unbounded
reads — the exact pairing W-044 refused.** `sandbox_mode=read-only` permits
every read the operator can perform, including `~/.codex/auth.json` (a
talked claude session cannot run `cat` at all), and a live web fetch/search
channel survives alongside it; W-044 dropped `WebFetch` from the claude
profile because, in its own words, "paired with `Read` it would be the
profile's only egress" — the codex profile ships with both halves of that
pairing. **No tool allowlist** — claude enumerates what may run; codex
offers only a denylist of eight named features, and a denylist goes stale
the day a new feature ships. **AGENTS.md still loads** — neither the user's
nor the project's is covered by any flag here. **Configuration channels
beyond the user config file are unmeasured** — project, managed, system and
cloud defaults are residual, not proven absent. Codex authenticates only
from the default login location,
`$HOME/.codex/auth.json`; `CODEX_HOME` and `OPENAI_API_KEY` are
deliberately not passed (off W-049's ten-name env allowlist by design), so
a custom config home or an API-key-only login does not work through a
bisellium-spawned codex.

## Running probe

```bash
npm run bisellium -- probe [--studio <dir>] [--model <id> --harness <id>] [--dry-run] [--now <iso>]
```

W-069's battery: one minimal real turn per due `(model, harness)` pair,
recorded in `<studio>/models.json`. `--model`/`--harness` are a pair —
either both or neither; given one without the other the command refuses
before any spend. `--dry-run` reports the candidate pairs it would probe
and writes nothing.

**"Available" means the model can complete a turn — never "it appears in a
vendor listing."** The signed limit, narrowed from `talk`'s own policy:

> `available` means: this model, on this harness, completed one minimal
> turn under `talk`'s permission and tool policy, at the recorded time. It
> does **not** prove the model can carry `talk`'s ~42k-token boot bundle — a
> probe sends `systemPrompt: ""`. A model whose context window or prompt
> handling fails only at that size will be recorded `available` and will
> still fail a real `talk`.

A harness cannot condemn a model without a passing control first (the
lowest-id seated candidate on that harness); a structured 401/403 or a
usage limit stops that harness rather than writing a model-level verdict.
Every write is mark-before-spend (every due pair is durably `unverified`
before any turn) and atomic (temp file + rename), so an interruption can
only ever leave a pair `unverified`, never falsely `available`. `probes[]`
carries one entry per probed harness; `ModelEntry.state` is the optimistic
aggregate W-065's `GET /api/models` already reads — a model available on
*any* harness renders `available`, even if the seat that would actually
run it is on a different, failing harness. `bisellium probe` prints a
warning when one id's harnesses disagree; nothing routes on `models.json`
until the opus that wires dispatch says so.

