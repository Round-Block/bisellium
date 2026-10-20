---
kind: guide
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the commands it describes are removed or fold back into docs/ADOPTION.md
---

# Reference: serve

Contract: `docs/ADOPTION.md`; where they disagree, the contract wins.

## Running serve

```bash
npm run bisellium -- serve [--studio <dir>] [--port 4477] [--poll-ms 5000] [--now <iso>] [--once]
```

`apps/server`'s `startServer` (wrapped by the CLI as `bisellium serve`) is a
localhost-only HTTP + SSE surface over one studio: it binds `127.0.0.1`
only, ingests one snapshot at start, and (unless `--once`) polls again every
`--poll-ms`. It shares `EVENTS_LOG_REL`/`SNAPSHOTS_DIR_REL` with
`@bisellium/core`'s `Store` so the two read/append the exact same
`.bisellium/` files, though `apps/server` keeps its own small per-source
(`"server"`) ingest bookkeeping rather than depending on `Store`'s class
directly (see the file header comment on `apps/server/src/store.ts`).
While `opus/<id>` exists the branch owns the record (D-021), so once per poll
(never on a request) serve reads the `opus/*` branches of the checkout it
serves, read-only through bounded `git`, and overlays them on the trunk's
`opera/`: the committed tip supplies the record, and a worktree's uncommitted
file may change only `state` (to `building`, `verifying` or `review`),
`traditio` and `heartbeat`. It can replace a trunk record, never create one,
never writes, and reports a degraded read as `branchRecords` in
`GET /api/officina`. Reads:

```
GET  /api/officina                 the manifest: patron, collegia, sellae, probationes, wip_limit, tiers?, munera?, models?, lifecycle, branchRecords
GET  /api/models                   D-023's model rows: the models.json record, merged with a live vendor listing (W-065)
GET  /api/opera?state=&collegium=  every opus, filterable
GET  /api/opus/:id                 one opus's front matter + body + probationes + traditio
GET  /api/inbox                    needs-you: pending human gates + petitiones needing a reply
GET  /api/acta?days=               digest entries within the last `days` (default 7)
GET  /api/aerarium?period=         allowance + derived burn + posture per collegium
GET  /api/providers?live=          provider status (usage.yml, or live quota-axi with live=1)
GET  /api/health                   health.json if `tick` wrote one, else a fresh check summary; `due` items are `{kind, id}`, and a tick-written `{kind, sella|period|opus|models}` is mapped on read (the file is never rewritten)
GET  /api/completion               `{ meter, estimate }` from the trunk's `milestones.yml` and `opera/*.md` (both `null` without milestone records): the completion meter and the estimated finish, the same sentence the Status page prints
GET  /api/timeline/:sella?limit=   that sella's (or the Patron's) timeline
GET  /api/events?since=&limit=&item=  raw log events, with a stable `seq` a client can resume from; `item=` scopes to one opus
GET  /api/receipts?sella=          receipts, all sellae or one
GET  /api/live                     SSE: `data: <event>` for every newly-ingested event
```

**`GET /api/officina`'s `lifecycle`** (W-064) is `{ id, states }` from the
served adapter's own `describeLifecycles()[0]` — the state→phase map the
Board renders columns from, so no caller hand-copies lifecycle state ids
(CLAUDE.md: "never by hand"). Additive: every pre-existing key is unchanged.

**`GET /api/events`'s real limit/since semantics** (W-064 — never written
down before, and got it wrong twice): an **omitted** `limit` is **unlimited**;
a **supplied** `limit` is clamped into `[1,500]` and returns the **earliest**
matching rows in ascending order; `since` is an **exclusive numeric seq
only** — an ISO-timestamp `since` is silently treated as absent (`num()`
discards any non-finite value), not refused and not resumed from. **`item=`**
scopes the response to one opus, read fresh from `events.jsonl` (never the
Index, which misses anything appended by another writer while the server
runs); its `limit` means the **last** N, returned ascending; it carries no
`seq`; and `item` combined with `since` answers `400` (nothing to resume
from on a path with no seq).

Writes reuse `packages/cli/src/writes.ts`/`talk.ts`/`pause.ts` verbatim (same
validation, same exit codes, `stdout`/`stderr` captured into the JSON
response body) and are refused from anything but `127.0.0.1`:

```
POST /api/answer      {petitio, reply, askBack?, charterGap?}
POST /api/greenlight   {opus, decline?}
POST /api/budget       {period, collegium, tokens, hours?}
POST /api/handoff      {opus, sella, next, stage?, blockedOn?}
POST /api/talk         {sella, message, harness?}
POST /api/pause        {reason?}
POST /api/resume       {}
POST /api/delegate     {sella, model, from?} or {munus, tier, from?}
```

Every write route serializes through one per-server async lock, so two
overlapping writes (e.g. two `/api/talk` calls, which can each take minutes)
queue instead of interleaving through the shared `console.log`/`console.error`
capture. `POST /api/_poll` (manual re-ingest) only answers outside
`NODE_ENV=test` with a 404 — it exists for tests to force a poll
deterministically, never a route a real client should call. `close()` ends
every open `/api/live` connection before closing the HTTP server, so a
connected SSE client never makes shutdown hang.

