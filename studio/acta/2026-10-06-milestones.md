---
id: "2026-10-06-milestones"
title: Milestone plan — architect, 2026-10-06 (proposal for the Patron)
kind: daily
author: architect
at: 2026-10-06T09:00:00Z
---

# Milestone plan, 2026-10-06

Approved by the Patron, 2026-10-06 ("ok with the plan"): decision D-038.

A proposal. The Patron sets the weights and approves the milestones; until
then nothing here changes the slate order in `acta/2026-10-05-ranking.md`.

## The Patron's ruling (2026-10-06)

Completion is measured by milestones, not by task count. Each milestone has a
weight; the weights total 100. Each opus is worth 1, 2, 3, 5 or 8 points for
how far it moves its milestone (payoff, not effort). Milestone % = points
done ÷ points planned. Overall % = the weighted sum. A milestone shows 100%
only when its exit check passes; otherwise it stops at 95%.

Sources: the dossier (restored, PR 250), `docs/design/DIRECTION.md`,
`docs/ARCHITECTURE.md`, `docs/ADOPTION.md`, the 2026-10-05 ranking, every
opus record and the decisions.

## Milestones

What is true when each is met, in plain words:

- **M1 Build process, first version** — every change goes spec, failing test
  first, build in an isolated copy, review, evidence tied to the exact code.
  Already met.
- **M2 Records you can trust** — the studio's files, the checker and the
  evidence rules hold up: a broken file damages only itself, a wrong gate can
  be corrected without erasing it, and no evidence can be overwritten.
- **M3 The work runs itself** — once the Patron approves a task, the tool
  takes it to a merged change with no orchestrating chat session.
- **M4 The Patron's desk** — all four of the Patron's decisions (approve work,
  set budgets, rule on a question, change a charter) can be made from the
  console and land in the records.
- **M5 The whole console, live** — all seven screens exist and show what is
  happening right now, without a refresh.
- **M6 Any vendor, any model** — the Patron picks which model holds each
  seat, and a task runs end to end on either Claude or Codex.
- **M7 The studio learns** — every mistake that repeats has a named fix, and
  findings turn into fixes without someone remembering to do it.
- **M8 Safe by construction** — no file path, command or agent output can
  write outside the studio or reach the host; security review runs on every
  change.
- **M9 Works on any project** — setting up a new or existing repo gives it
  the same safety layer and console this repo has, with no hand setup.
- **M10 Away from the desk** — the console runs as a desktop app with
  notifications and can be reached from the Patron's phone, never on a
  public port.

| Id | Milestone | Weight | Exit check |
|---|---|---|---|
| M1 | Build process, first version | 10 | opus W-125 |
| M2 | Records you can trust | 10 | needs: a test that a fresh `init` studio passes check, every bad fixture fails it, and one corrupt record degrades only itself |
| M3 | The work runs itself | 15 | opus W-118 |
| M4 | The Patron's desk | 15 | needs: a browser test that makes all four Patron decisions from the console and finds each in the records |
| M5 | The whole console, live | 10 | needs: a browser test that walks all seven screens and sees an event written by another process appear |
| M6 | Any vendor, any model | 8 | opus W-061 |
| M7 | The studio learns | 10 | rule lesson.recurrent |
| M8 | Safe by construction | 10 | opus W-099 |
| M9 | Works on any project | 8 | needs: the dossier's acceptance test — a fresh repo set up by init, shown in the console beside one outside adapter with no adapter-specific code |
| M10 | Away from the desk | 4 | needs: a desktop build test that raises a native notification when something waits on the Patron |

## Mapping

Every opus that is not halted, once. Halted and not scored: W-023, W-027,
W-028, W-107, W-108, W-109. The nine pieces that had no opus are filed as
W-143..W-151, and the Status page as W-152 (D-038). The eight `outside` rows
are halted under D-038; they stay listed here for their reasons.

| Opus | Milestone | Value | Note |
|---|---|---|---|
| W-008 | M1 | 5 | isolated worktrees, run receipts |
| W-009 | M1 | 5 | verify runs the automated gates |
| W-018 | M1 | 8 | the process as files check can fail |
| W-019 | M1 | 2 | lint, format, CI |
| W-020 | M1 | 5 | ready, done, red |
| W-021 | M1 | 3 | recorded-red rules |
| W-022 | M1 | 2 | red content rules |
| W-031 | M1 | 3 | local CI |
| W-033 | M1 | 2 | branch vs trunk bookkeeping |
| W-034 | M1 | 1 | done honours waivers |
| W-036 | M1 | 1 | CI on a fresh runner |
| W-039 | M1 | 1 | red names its writer |
| W-050 | M1 | 1 | ci documented |
| W-072 | M1 | 2 | tests cannot spend vendor money |
| W-082 | M1 | 2 | spec review on record |
| W-084 | M1 | 2 | brief behaviour citations |
| W-125 | M1 | 8 | builds isolated, review rounds bounded |
| W-126 | M1 | 3 | blocking findings cite the brief |
| W-127 | M1 | 3 | numbered behaviours |
| W-130 | M1 | 2 | replay box takes browser evidence |
| W-131 | M1 | 3 | evidence slimmed |
| W-132 | M1 | 3 | runner over named pipes |
| W-134 | M1 | 2 | red survives a rebase |
| W-139 | M1 | 2 | record-only CI runs real-studio tests |
| W-140 | M1 | 1 | one brief parser for the receipt |
| W-142 | M1 | 2 | verify's gate timeout fits the suite |
| W-001 | M2 | 3 | init, new |
| W-002 | M2 | 3 | context, query |
| W-003 | M2 | 5 | event log and differ |
| W-004 | M2 | 1 | first-hour CLI fixes |
| W-005 | M2 | 2 | core fixes |
| W-006 | M2 | 2 | Latin contract |
| W-012 | M2 | 5 | the write commands |
| W-013 | M2 | 5 | SQLite index, query API |
| W-016 | M2 | 2 | server and core fixes |
| W-030 | M2 | 1 | usage banner |
| W-042 | M2 | 2 | halt and abandon |
| W-062 | M2 | 2 | amend |
| W-079 | M2 | 1 | amend guards pinned |
| W-096 | M2 | 5 | typed kinds, arcs |
| W-101 | M2 | 2 | ids unique across branches |
| W-038 | M2 | 2 | file a question to the Patron by command |
| W-040 | M2 | 2 | correct a wrong gate without erasing it |
| W-045 | M2 | 3 | a corrupt record damages only itself |
| W-048 | M2 | 1 | red commands runnable from the repo |
| W-058 | M2 | 1 | red refuses inactive opera |
| W-080 | M2 | 1 | spec gate names its builder |
| W-086 | M2 | 1 | stale handoff on a closed opus |
| W-097 | M2 | 2 | old evidence archived by command |
| W-098 | M2 | 1 | module-load detector false positive |
| W-100 | M2 | 2 | a fix round's red never erases round one's |
| W-011 | M3 | 3 | tick, pause |
| W-026 | M3 | 5 | per-opus branches and merges |
| W-123 | M3 | 3 | PR hygiene in the verbs |
| W-124 | M3 | 5 | next names the legal next step |
| W-128 | M3 | 2 | ladder follow-ons |
| W-141 | M3 | 5 | next performs every git step |
| W-118 | M3 | 8 | the arc that retires the chat orchestrator |
| W-068 | M3 | 3 | dependencies block starting |
| W-052 | M3 | 2 | run feeds merge |
| W-053 | M3 | 1 | cleanup sees every worktree |
| W-083 | M3 | 3 | orchestrators work in their own copies |
| W-014 | M4 | 5 | serve |
| W-024 | M4 | 8 | web app, Inbox |
| W-025 | M4 | 5 | Officina screen |
| W-029 | M4 | 2 | browser tests |
| W-041 | M4 | 1 | generated backlog page |
| W-064 | M4 | 8 | Board |
| W-067 | M4 | 5 | the console can write |
| W-075 | M4 | 1 | token prompt layout |
| W-076 | M4 | 2 | inbox subject and body |
| W-077 | M4 | 2 | Officina tells the truth |
| W-087 | M4 | 2 | Board readability |
| W-110 | M4 | 3 | every screen walked end to end |
| W-114 | M4 | 3 | a reply reaches the next step |
| W-129 | M4 | 5 | Board shows backlog and in-flight work |
| W-073 | M4 | 3 | reply from the Board |
| W-074 | M4 | 5 | approve work from the Board |
| W-078 | M4 | 3 | a human gate exists so "needs you" can fill |
| W-112 | M4 | 1 | one Board timestamp |
| W-113 | M4 | 2 | Inbox renders the body |
| W-152 | M4 | 3 | the Status page: progress and backlog on one page, mapping checked |
| W-143 | M4 | 3 | set budgets and pull the brake from the console |
| W-144 | M4 | 2 | propose and accept a charter change from the console |
| W-136 | M5 | 8 | live Board, pulse per seat, activity feed |
| W-145 | M5 | 3 | the reports feed |
| W-146 | M5 | 5 | roster, cost, direct line to a seat |
| W-147 | M5 | 3 | who did what when; time blocked on the Patron |
| W-148 | M5 | 1 | topology |
| W-007 | M6 | 3 | provider status |
| W-010 | M6 | 5 | talk to a seat |
| W-015 | M6 | 3 | Claude Code hooks |
| W-046 | M6 | 5 | one opus on both harnesses |
| W-065 | M6 | 5 | pick a model per seat |
| W-069 | M6 | 3 | model probes |
| W-071 | M6 | 2 | probe schedule |
| W-089 | M6 | 3 | seats as templates |
| W-102 | M6 | 2 | Codex role workflow |
| W-061 | M6 | 5 | the tool dispatches a build on either vendor |
| W-117 | M6 | 3 | task type points straight at a seat |
| W-116 | M6 | 1 | Roster shows each seat's live model |
| W-090 | M6 | 1 | model list matches the setup |
| W-091 | M6 | 1 | Seats save button |
| W-092 | M6 | 1 | retired seats shown |
| W-054 | M6 | 1 | talked session can run the CLI |
| W-055 | M6 | 1 | talk records the replying model |
| W-066 | M6 | 2 | talk resume is broken |
| W-035 | M7 | 3 | lessons name their fix |
| W-085 | M7 | 3 | open lessons at boot |
| W-121 | M7 | 2 | a repeated mistake became a rule |
| W-103 | M7 | 1 | memory-lookup research (no-go) |
| W-104 | M7 | 1 | memory-lookup research (no-go) |
| W-105 | M7 | 1 | memory-lookup research (no-go) |
| W-120 | M7 | 2 | a repeated mistake becomes a rule |
| W-137 | M7 | 5 | unfixed lessons and stale retros are flagged |
| W-138 | M7 | 8 | findings counted, weighted by cost, auto-filed |
| W-122 | M7 | 3 | measure what reading code costs |
| W-043 | M7 | 2 | fixes recorded by command |
| W-060 | M7 | 1 | a typo cannot count as a fix |
| W-037 | M8 | 1 | ReDoS fix |
| W-044 | M8 | 3 | talk can only read |
| W-047 | M8 | 2 | path helper tested |
| W-049 | M8 | 2 | no stray credentials reach a session |
| W-057 | M8 | 1 | no stack traces served |
| W-115 | M8 | 3 | symlinked records refused |
| W-133 | M8 | 2 | Git broker memory cap |
| W-059 | M8 | 3 | eight unchecked path joins |
| W-081 | M8 | 2 | provider command injection |
| W-094 | M8 | 1 | test sentinel refuses symlinks |
| W-099 | M8 | 5 | every write anchored in the studio |
| W-093 | M8 | 3 | security review on every PR |
| W-017 | M9 | 3 | generated agent instructions |
| W-135 | M9 | 8 | safety setup part of init |
| W-051 | M9 | 2 | repos whose main branch is not "master" |
| W-149 | M9 | 5 | a second project shown with no special code |
| W-150 | M9 | 2 | how to write an adapter |
| W-070 | M10 | 3 | console from the phone, private network only |
| W-151 | M10 | 5 | desktop wrapper, tray, notifications |
| W-032 | outside | 0 | covered by W-123 (rebased PRs) and W-141 (next opens and lands PRs) |
| W-056 | outside | 0 | test-internal tidy-up; no product effect |
| W-063 | outside | 0 | the Board already shows in-flight work (W-129); this is a second view of it |
| W-088 | outside | 0 | would point a hook at a script agents can edit, against the standing rule |
| W-095 | outside | 0 | done in substance by W-129 under D-035 |
| W-106 | outside | 0 | research lane closed (D-030) |
| W-111 | outside | 0 | research lane closed (D-030); read-efficiency paused (D-032) |
| W-119 | outside | 0 | grooming, no product change; this list is its input |

## Result

Output of `node ~/.bisellium-evidence/milestones/compute.mjs studio/acta/2026-10-06-milestones.md --repo .`,
re-run 2026-10-06 after D-038 (worktree on `6dd5957`, with W-143..W-152 filed,
the eight `outside` opera halted and W-142 mapped to M1):

```
id  milestone                             weight  points    exit  pct
M1  Build process, first version          10      72/74     met   97.3%
M2  Records you can trust                 10      41/57     open  71.9%
M3  The work runs itself                  15      18/40     open  45.0%
M4  The Patron's desk                     15      52/74     open  70.3%
M5  The whole console, live               10      0/20      open  0.0%
M6  Any vendor, any model                 8       31/47     open  66.0%
M7  The studio learns                     10      11/32     open  34.4%
M8  Safe by construction                  10      9/28      open  32.1%
M9  Works on any project                  8       3/20      open  15.0%
M10 Away from the desk                    4       0/8       open  0.0%
overall 47.3% · opera mapped 138 · outside 8 · unfiled rows 0
```

Before D-038 (`a22a629`): overall 48.1%, M1 100.0% (72/72), M4 73.2% (52/71),
nine unfiled rows. M1 shows 97.3% with its exit met because W-142, filed
after the draft, is open.

## Questions for the Patron

Answered by D-038: weights stand; all nine filed; the eight halted; arcs
split at spec time, M3's drop accepted; M7's bar stands.

1. **Weights.** Are these the right weights? The proposal puts the console
   (M4 + M5) at 25 and "the work runs itself" at 15.
2. **Missing work.** Nine pieces of the design have no task yet: the Acta,
   Agents, Swimlane and Graph screens; budget and charter changes from the
   console; the outside-adapter test and guide; the desktop app. File them,
   or drop any (Graph and desktop are the likeliest) from the product?
3. **Halt the eight outside tasks?** W-032, W-056, W-063, W-088, W-095,
   W-106, W-111, W-119.
4. **Big single tasks.** W-118 (the work runs itself) is one task standing
   for a whole arc. When its pieces are filed, M3's planned points grow and
   its % drops. Is that acceptable, or should arcs be split before they are
   scored?
5. **M7's bar.** Is "no repeated mistake without a named fix" (the existing
   `lesson.recurrent` rule clean) the right finish line for learning?
