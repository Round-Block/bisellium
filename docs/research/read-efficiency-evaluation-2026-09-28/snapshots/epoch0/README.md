# Epoch 0

A gacha RPG. Godot 4 client talks to a FastAPI backend backed by PostgreSQL + Redis.
The backend owns all game logic — the client is presentation + API calls only.

## Structure

| Path | Contents |
|---|---|
| `backend/` | FastAPI service, combat/gacha/progression services, tests, `sim_balance.py` |
| `client/` | Godot 4 / GDScript client (`scripts/`, `scenes/`, `theme/`) |
| `db/migrations/` | Sequential SQL migrations (applied at API startup by a ledger-backed applier — see the Migrations section below) |
| `docs/` | Design specs (e.g. `RELICS.md`) |
| `CLAUDE.md` | Agent operating guide — house rules, project shape, conventions |
| `docs/game/GAME_MECHANICS.md` | Combat formulas, balance tables, mechanic reference |
| `docs/game/CHARACTER_ROSTER.md` | Per-character stat + ability summary (kept in sync manually) |

## Setup

Prerequisites: Docker + Docker Compose.

```bash
cp .env.example .env         # fill in real values; generate a strong SECRET_KEY
docker compose up -d         # starts postgres, redis, api (port 8000)
```

Generate a SECRET_KEY:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## Migrations

Schema + seed data live in `db/migrations/NNN_name.sql`, run in filename
order. The `api` container applies them at startup via
[backend/app/core/migrations.py](backend/app/core/migrations.py) and records
each file in a `schema_migrations` ledger (hash-checked so retroactive edits
to applied migrations fail loudly).

To add a migration:

1. Create `db/migrations/NNN_description.sql` — next sequential number, no gaps.
2. Wrap it in `BEGIN; ... COMMIT;` (all multi-statement migrations do).
3. Restart the API: `docker compose restart api`. The applier picks it up.

**Never edit a migration after it has been applied.** The applier records a
SHA-256 of each file; editing `NNN_*.sql` after it has run will abort the
next startup with a hash mismatch. To amend behavior, write `NNN+1_*.sql`.

To reset the dev DB (wipes all data):

```bash
docker compose down -v
docker compose up -d
```

The applier also creates `epoch0_test` on first run so `pytest` works
without a manual `CREATE DATABASE` step.

## Common commands

```bash
# Run the test suite (must stay green)
docker compose exec api python -m pytest tests/ -x -q

# Run the balance simulator
docker compose exec api python3 sim_balance.py

# Open a psql shell
docker compose exec postgres psql -U epoch0 -d epoch0
```

## Agent workflow (Claude Code)

Skills, hooks, and settings are in `.claude/`. The workflow is:

| Phase | Command / trigger | What happens |
|---|---|---|
| Session start | automatic | Hook injects active task + handoff note into context |
| Context compaction | automatic | PreCompact hook preserves task state; PostCompact hook re-injects it |
| Add a backlog item | `/add-task` | Appends row to `tasks.md`, scaffolds journal dir with type-aware checklist |
| Start a task | `/start-task <slug>` | Creates worktree, scaffolds journal dir (type-aware template), activates task, loads spec/plan, flags parallel candidates |
| File write/edit | automatic | Async hook appends touched paths to `tasks/<slug>/files-touched.txt` |
| Journal check | `/journal status` | Prints active task, unchecked next steps, open questions, handoff |
| Session log | `/journal log` | Prompts for outcome + next step, writes session-log entry and updates handoff |
| Switch focus | `/journal focus <task>` | Changes Current Focus in `tasks.md` |
| Session end | automatic | Stop hook wakes Claude to write a handoff note to `notes.md` |
| Finish a task | `/finish-task` | Runs tests + sim, populates `files-changed.md`, closes journal, creates PR or merges |
| New character | `/new-character` | Design → migration → combat.py registries → CHARACTER_ROSTER.md → tests + sim |

Task state lives in `.claude/skills/journal/tasks.md` (backlog grouped by theme) — read at session start.

Skill files: `.claude/skills/` (journal, start-task, finish-task, add-task, new-character, combat-balance, godot-vfx, blender-character).

## Source of truth (in order of authority)

1. Backend implementation (`combat.py`, `battle.py`, service layer)
2. DB migrations (what's actually seeded/structured)
3. Tests (`backend/tests/`)
4. `docs/game/GAME_MECHANICS.md`, `docs/RELICS.md`
5. `docs/game/CHARACTER_ROSTER.md`
6. `CLAUDE.md`

Read `CLAUDE.md` before making changes.
