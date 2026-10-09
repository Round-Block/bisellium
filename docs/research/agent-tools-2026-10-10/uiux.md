# UI/UX of four agent tools, read against bisellium's console (2026-10-10)

Scope: screens and behaviour only. Mechanism was covered in
`agent-tools-2026-10-10.md`. Nothing was cloned or run.

Evidence labels used below:
- IMAGE = I looked at the screenshot or GIF frame myself.
- CODE/DOC = inferred from file names, specs or README text, not seen.
- ALT-TEXT ONLY = the README describes a screenshot I could not fetch. GitHub
  "user-attachments" images redirect to an S3 host outside the allowed list, so
  five Coral screenshots (changed-files with diff, message board, activity
  timeline, launch dialog, analytics tables) were not viewed. For Coral's
  analytics I did see the phone version (IMAGE) and read the README caption.

Read first, from the repo: `docs/design/DIRECTION.md` (there is no `docs/DIRECTION.md`;
the binding file is under `docs/design/`), and `studio/opera/W-202.md`.

## 1. cdknorow/coral (web + phone dashboard, shared board)

Screens
- Desktop workspace (IMAGE: dash.webp still): top tabs Agents / Chats /
  Workflows / Jobs / Analytics / Docs. Left sidebar: teams as groups
  (name + count), each agent a two-line row (name, then its current task in
  italics), green dot for live. Centre: the selected agent's chat. Right: a
  tab strip with icon tabs (chat, files, tasks "335/357", queue, trend); the
  tasks tab is a long table: tick, priority, "board", owner role, title.
- Phone client (IMAGE: mobile.png, four phone frames): Live Sessions (teams
  and agents with "5 UNREAD" and "SLEEPING" tags), Agent chat (tool steps
  folded to "5 steps exec_command"), Changed files ("29 FILES CHANGED
  +1542 -175 vs HEAD~1", per-file +/- numerals, starred files, inline diff),
  Analytics (input/output/cache tokens, requests, total cost, burn rate
  "$40.23/hr", cumulative spend chart, by-model table).
- Board, history, scheduler, workflows, cost dashboard (CODE/DOC: templates
  `live_session.html`, `message_board.html`, `history_session.html`,
  `workflows.html`, `cost_dashboard.html`; scheduler.css).
- Launch dialog with three choices: AI Agent, Agent Team, Terminal
  (ALT-TEXT ONLY).

Patterns worth noting
1. Two-line agent row: name plus what it is doing right now. The list reads as
   "who is on what" without opening anything (IMAGE). Works because the second
   line is the current task, not a status word.
2. Phone client is a deliberately narrow product, not a shrunken desktop. Their
   own spec (`specs/MOBILE_APP_SIMPLIFICATION`, CODE/DOC) lists three jobs:
   live agents, group chat with input, one agent's conversation with input.
   They admit the first mobile build cloned the desktop views and rewrote it
   for that reason. Also: permission prompts can be answered from the phone,
   and Slack/Discord/webhook pings fire when an agent needs input or is idle
   (README).
3. One cost number cut four ways: by model, team, branch, agent, with a
   per-agent cumulative popover (ALT-TEXT ONLY for the page; the phone shows
   the by-model table, IMAGE). Works because the cuts all add up to the same
   total, so you can drill from any cut.
4. Changed-files list with per-file +/- numerals and "versus main" selector;
   the diff opens beside the chat rather than replacing it (IMAGE on phone;
   README caption for desktop).

What not to copy: the analytics page is a row of stat tiles each with a
sparkline plus a gradient area chart (IMAGE). That is exactly the KPI-strip
look DIRECTION.md bans.

## 2. Whq02/MercuryCLI (session board, TUI)

Screens (IMAGE: three frames of `session-board.gif`, 1280x720)
- "Session concourse": a coordinator chat on the left, a session table top
  right, a mirrored chat of the selected session below it, a one-line
  composer, a bottom status line ("3 live, 1 needs you, 3/30 seats"), a key
  hint line that only lists the moves available right now.
- Home, focused chat, boot screens (breadcrumb "BOOT > CONCOURSE > FOCUSED
  CHAT"); `Shift+arrows` moves between screens (README).

Patterns worth noting
1. A pinned "NEEDS YOU" band above everything, one row per item: what, the
   reason in plain words ("asks to run Edit - allow?"), age, and the verbs on
   the right ("answer & resume | open session | dismiss"). Amber is used for
   this and nothing else (IMAGE). Works because the reason is on the row; you
   decide without opening anything. A crashed session also lands here with its
   reason until released (README).
2. The session table is grouped by what you must do, not by project: NEEDS YOU,
   READY TO REVIEW, WORKING, each with a count, columns STATUS & TITLE,
   PROJECT, NOW, AGE. NOW is the live one-line activity (IMAGE). Works because
   the grouping is the triage.
3. The table row selected shows its transcript below, live, with the keys
   (`Enter` into it, `i` interrupt, `p` pause, `/` filter, `space` mark)
   printed on the bottom line (IMAGE). Master-detail without leaving the list.
4. Empty and in-between states are plain: "select a session to mirror its
   chat", "no session selected - the coordinator panel starts one" (IMAGE).
   Nothing celebrates.

## 3. Nightbr/factorai (Tauri desktop, terminals, routines, search)

Screens (IMAGE: sessions, routines, search, changes; graph only by alt-text)
- Shell: tab strip on top (one tab per open session, with a corner dot), left
  sidebar tree of Project groups > Projects > Sessions with a status dot per
  session, session search box at the top of the sidebar, terminal in the
  centre. (Routes: index, project, search, session; CODE.)
- Project page with Sessions / Routines tabs. Routines list: title, "Every
  day at 2:00, next Tomorrow 2:00", "Last run 9h ago", play / edit / delete /
  enable switch; a disabled routine shows the word "disabled" (IMAGE).
- Search results: one row per hit, project chip, session title, a role tag
  (assistant / user), and a one-line snippet around the match; "4 results"
  top right (IMAGE).
- Changes panel: Merge changes first (a conflict, marked C), then Staged,
  then Changes, each file with +N -N and an M/A/U letter; the diff opens in
  the middle column with the terminal beside it (IMAGE). Graph tab: branch
  and tags with a commit's changed files (alt-text only).

Patterns worth noting
1. Status dot per session in the sidebar: green working, amber waiting, grey
   stopped; the dot also rides on the tab and on the project avatar, so the
   state is visible with the sidebar collapsed (IMAGE). Works because it is
   repeated at three levels, but colour is the only cue.
2. Transcript search that returns the sentence, not the session: grouped by
   session, with who said it and the matching line (IMAGE). Cheap because
   they index in place with SQLite FTS5 (first-pass doc).
3. Merge conflicts listed above staged files, so the thing that blocks you
   is the first row (IMAGE).
4. Schedules shown as sentences ("Every Monday at 9:30, next Mon 9:30, Last
   run 4d ago") with an off state that is a word, not a greyed row (IMAGE).

## 4. S1gil0/lookingglass (TUI)

Screens (IMAGE: ex1; ex2/ex3 not opened beyond their README captions)
- One scrolling transcript. Each tool call is a banded block: "tool read
  [done]", "tool run_agents [running]". A parallel-agents block lists each
  worker with status and duration (00:00:18), its output summary and findings
  as nested lines. Plan checklist at the end ("Task plan 4/4 complete").
- Bottom status line: model, agent, "ctx:62%/128.0k", mode.
- A terminal-app wrapper shows connection chrome (Reconnect, SFTP, Ports,
  Unpin); that is the host terminal, not Looking Glass.

Patterns worth noting
1. Every action is a row with state in square brackets and a duration; the
   whole run is an audit list you can scan top to bottom (IMAGE).
2. Parallel workers shown as a small table of goal / model / status /
   duration, then findings underneath (IMAGE). Short and readable.
3. A one-line status footer with the budget that matters (context used of
   limit) (IMAGE). Low value for bisellium (no live chat), noted for the
   "colophon" idea only.

## For bisellium's console

Constraints I read from DIRECTION.md that shape everything below: no
sparklines, donuts, gauges, KPI card strips, trend arrows or heatmap cells
(section 7); amber is "waiting on a human, and nothing else, ever" and one
amber region per screen plus the nav count (section 3); at most 3 semantic
colours; state must not rely on colour alone; no pills, no emoji status; "Needs-you
is not a floating pill: it is the first column, pinned left" (section 6, Board);
Inbox is a 40px-row queue with no preview pane; ⌘K is the only palette; no
density toggle; no spinners; drawer, never modal.

Ranked ideas (user-facing behaviour, where it lands, fit, effort):

1. **The "needs you" strip is one row per item with the reason on the row.**
   The Patron sees, above the sectors, each thing waiting on them as a single
   line: the ask in words ("W-141 spec: signature needed", "W-188 review:
   Chaos finding, your call"), the asker's sella id, and an age number; Enter
   opens the Inbox item. From Mercury's pinned band.
   - Lands: W-202 "needs you" strip (the Inbox stays its own screen).
   - Fit: honours §6 Inbox "amber 2px left rule if it is yours, title at 13/18,
     asker's sella id in mono 12, age as a right-aligned mono numeral that
     escalates in weight (500 to 700) with age, never in colour", and "the
     empty state is the resting state: one line, 'Nothing waiting on you'".
     Do NOT copy Mercury's inline "answer & resume / dismiss" verbs: that
     would breach §4.4 ("a decision without a reason cannot be submitted") and
     the batch-confirm ban. Translation: the strip shows, the Inbox decides.
   - Effort: small. Data is the Inbox that already exists (`GET /api/inbox`).

2. **In-flight work is grouped by who must move next, with a "now" cell.**
   A short list under the strip: groups "Waiting on you", "In review",
   "Building", "Blocked", each with a count, rows showing opus id, title, the
   current step in words (from the latest event), and age in step. From
   Mercury's concourse table. This is W-202's WIP and per-step time made
   readable at a glance, and it answers "who is stuck where" with no chart.
   - Lands: W-202 flow sector (WIP) and its click-through to the Board.
   - Fit: honours §4.1 (gate ladder column so items align) and §3 "32px rows,
     mono numerals, right-aligned". Group heads in sentence case at 13/500,
     not all-caps (§3 "No all-caps labels"). Amber only on the group that is
     the Patron's; "In review" is the censor's, so it stays ink. Don't use
     Mercury's glyph-per-status (ban on status glyphs/emoji).
   - Effort: small to medium (reads events.jsonl and opera states).

3. **Cost is one total cut four ways, as tables that all add up.**
   Cost sector shows total spend, then the same total by provider, by opus,
   by step (spec / build / review / rework), each row clicking down to the
   opus or the receipts it came from; the numbers in each cut sum to the
   same figure. From Coral's by-model/team/branch/agent view.
   - Lands: W-202 cost sector, feeding Officina's burn panel (W-138's data).
   - Fit: partly violates. Coral's version is stat tiles + sparklines + area
     chart: §7 bans "Sparklines, donuts, gauges, KPI card strips, trend
     arrows". Ledger translation: right-aligned mono numerals, and the §6
     Officina burn idiom ("two mono numerals and a 4px rule filled to the
     spent fraction, ink under allowance, amber past it"). A day-by-day
     cumulative becomes a table of dated rows, not a curve. Note amber past
     allowance means "waiting on a human" only if the Patron must act; say so
     in the row or leave ink.
   - Effort: medium (depends on W-138's attribution).

4. **One search box over the records, answering with the sentence.**
   ⌘K finds text across opera, acta, decisions, lessons and CI logs and
   returns rows: id, record kind, one line of context around the match, date.
   Enter opens the record in the drawer. From factorai's transcript search.
   - Lands: global ⌘K; each W-202 sector's "down to the source records"
     drill ends here too.
   - Fit: honours §5 "⌘K is the only palette" and "Drawer, never modal";
     rows are tables (§3), ids in mono. Avoid factorai's coloured project
     avatars (§7 "Per-project colour dots").
   - Effort: medium (the console already has a SQLite index
     `.bisellium/index/index.db`; add FTS5 over records). Large if it must
     index CI logs.

5. **An opus drawer that lists its steps with durations, and its files.**
   Opening an opus shows a table of each step (spec, each review round, build,
   CI, certify, queue wait) with duration, then the files changed against
   master with +N -N numerals, conflicts first. From Looking Glass's
   row-per-action-with-duration list, Coral's activity timeline (ALT-TEXT
   ONLY) and factorai's Changes panel (merge conflicts on top).
   - Lands: the drill-down under W-202's flow, quality and reliability
     sectors; same drawer the Board uses.
   - Fit: honours §5 "the drawer's waterfall bar says it legibly" and the 2px
     verdigris bar for work in progress; +N -N in ink and mono, not green and
     red (§3 ok/bad "inside a gate mark only"). A conflict row gets the bad
     gate mark plus a shape, not a red badge.
   - Effort: medium.

6. **Stuck work is flagged with a reason and an age, not a colour.**
   An opus whose dependency is done but has not started, or that has had no
   new event for N hours, appears in the strip or flow list as "no movement
   for 3h" with who owns it. From Coral's board-health monitor (reminds at 30
   min, escalates at 60) and Mercury's "crashed stays NEEDS YOU with reason".
   - Lands: W-202 strip (if the Patron owns it) or the flow sector's Blocked
     group (if a sella does).
   - Fit: fine if shown as words plus a mono numeral (§6 "a deferral's reason
     travels with the item... not a yellow dot"). Amber only when the move is
     the Patron's (§3). Needs a "stale" rule so it is not decoration.
   - Effort: small (a check rule or a console-side age threshold; the first
     pass proposed the tick side).

7. **Cadence panel: when each routine last ran and next runs.**
   A panel lists the studio's recurring work (daily, tick, retro, CI cron,
   merge-queue sweep) as a sentence: "Dailies: last run 9h ago, next 02:00",
   with disabled shown as the word "paused". From factorai's Routines list.
   Read-only; the console never runs them.
   - Lands: Officina process-health panel, and W-202's reliability sector.
   - Fit: honours §6 Officina "panels stacked between hairlines, no boxes".
     Reject the on/off switches and play buttons: console POSTs are a small
     fixed set, and a toggle is a persisted preference. The Officina "pause
     brake" is the one verdigris-filled button.
   - Effort: small.

8. **A phone view with three jobs: what needs me, what is moving, answer.**
   On a narrow screen the console opens straight on the strip and the Inbox;
   an item opens full width with the verbs and the reason field; a fourth
   line shows the posture word. Everything else is desktop. A webhook (or
   push) fires when a new item lands in "needs you". From Coral's phone spec
   ("a narrow, fast client... not a compressed version of the desktop").
   - Lands: Inbox + the W-202 strip at small widths.
   - Fit: DIRECTION.md says nothing about phones: that is a gap to rule on,
     not a violation. §3 ban on density toggles means one layout reflowed, not
     a mode. Touch targets 44px (Coral's style guide). A notification keeps
     the "authority never transits a model" principle if it is a plain
     deterministic ping that links to the Inbox. The decision still needs the
     reason (§4.4), so the phone cannot be a one-tap approve.
   - Effort: medium (responsive pass + token handling; the server already
     requires `X-Bisellium-Token`).

## Things seen that DIRECTION.md already rules out

- Stat tiles with sparklines and a gradient area chart (Coral analytics).
- Coloured status dots as the only cue, and coloured per-project avatars
  (factorai sidebar).
- Toggle switches and per-row icon buttons (factorai Routines).
- Green/red +/- text for diffs (all three UIs).
- Coral's tab strips with pills/badges; Mercury's glyph status icons.

## Notes for the Patron

- W-202's own wording ("Studio BI", "metric", "dashboard") sits against
  DIRECTION.md section 1 ("Nothing here is a 'metric', nothing is a KPI").
  Ideas 1-7 are written to survive that: every number is a row that clicks
  down to a record. The spec should say "ledger totals" and drop "dashboard"
  in the UI.
- The screen map (section 8) has no home screen; W-202 adds one. Section 8
  says moving a touchpoint is a lex change. Adding a first view moves none,
  but the map and the Board's "Needs-you is the first column" line should
  say how the strip and that column differ.
- Not viewed: five Coral screenshots (see top). Ask if you want them fetched
  by adding the S3 host to the allowed list.
