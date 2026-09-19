---
kind: guide
owner: architect
tier: reference
review: 2026-12-01
kill: when a `design.tokens` check rule enforces §3's ladders against the shipped
  stylesheet — then this file becomes history and the rule is cited instead
---

# Design direction

The web console's visual contract. Web I builds to this; a builder's work is
reviewed against it clause by clause. Where a lens in the research conflicts
with another, this file has already decided — the decision and its reason are
inline. The tokens (ink, verdigris, amber, ok, bad, Bricolage Grotesque /
Instrument Sans / IBM Plex Mono) are fixed by the Patron and are not reopened.

## 1. Identity thesis

**Bisellium is an officina's ledger.** It renders who decided what, on what
evidence, and who owes the next move — a Roman guild's book of record, drawn
flat and modern, where every number on screen is an entry someone can be held
to.

**It is not a SaaS dashboard.** Nothing here is a "metric", nothing is a KPI, and
no surface exists to reassure. If a pixel does not carry a fact from the
officina's files, it is deleted.

## 2. The generic diagnosis

Measured in `docs/design/canvas/*.dc.html`. Each is a named pattern to kill.

1. **No type scale.** 11 distinct sizes across six screens, four of them
   half-pixel (10.5 / 11.5 / 12.5 / 13.5). Sizes fitted by eye read as
   [made-up-as-I-went](https://www.orbix.studio/blogs/saas-typography-examples).
2. **No radius decision.** 10 radii in one surface family (3, 4, 6, 7, 8, 9, 10,
   12, 50%, 999px). Indecision rendered.
3. **The shadcn tell.** 21 instances of `box-shadow: 0 1px 2px rgba(22,33,30,.04)`.
   A shadow at 4% opacity is a border that costs a paint —
   [drop-shadow card grids signal no thought](https://dev.to/sangrokjung/stop-your-ai-coding-tool-from-generating-generic-ui-impeccable-design-skill-4g1l).
4. **Card-in-card.** Page `#F6F8F7` → white panel → white card → pill: four
   nesting levels around one line of text. This is
   [everything-a-card](https://www.datadoghq.com/blog/datadog-dashboards/); it
   stutters and it costs the density we need.
5. **Badge rainbow.** 27 pills at `border-radius: 999px`, including `p-amber` on
   a duration ("46m"). Amber spent on a clock is amber that no longer means
   waiting on a human.
6. **Template chrome.** Every card's meta line is an `A · B · C` middle-dot
   string: three facts at identical weight, so none of them is the answer.
7. **Palette sprawl.** 27 hex values, including `#4A6FA5` — a blue whose only
   meaning is "second project". Above the
   [≤3 semantic colors on screen](https://www.setproduct.com/blog/data-table-ui-design)
   threshold by an order of magnitude.
8. **Mono as decoration.** IBM Plex Mono on `~/projects` and on prose labels.
   Mono is for things that must align in a column; using it for flavour throws
   away the one signal it carries.
9. **Chrome outweighs content.** 60px top bar + 22/28 page padding + 14/16 card
   padding: the Board fits ~5 cards per column at 900px. A board that shows five
   items is a screenshot, not a floor.
10. **Anonymous wordmark.** A generic stroked house glyph that belongs to any
    product.

## 3. The system

### Typography

One scale, ratio 1.125 anchored at 13px, rounded to integers. **No half-pixel
sizes. No italics. No all-caps labels. No sixth weight.**

| Role | Family / weight | Size / line-height | Tracking |
|---|---|---|---|
| Display (screen title, once) | Bricolage Grotesque 700 | 30 / 32 | −0.02em |
| Section head | Bricolage Grotesque 600 | 17 / 22 | −0.01em |
| Prose body | Instrument Sans 400 | 15 / 22 | 0 |
| UI default, table cell | Instrument Sans 400 | 13 / 18 | 0 |
| Secondary, dense label | Instrument Sans 400 | 12 / 16 | 0 |
| Micro (counts, ages) | Instrument Sans 500 | 11 / 14 | +0.01em |
| Data | IBM Plex Mono 400, `tabular-nums` | 12 / 18 | 0 |

Weights available: 400, 500, 600 (heads only), 700 (display only). Hierarchy is
carried by weight and color before it is carried by size —
[Stripe's inverse hierarchy](https://www.925studios.co/blog/stripe-dashboard-design-breakdown).

Mono is permitted on exactly four things: opus and sella ids, tree hashes,
numerals (tokens, cost, counts, durations), and file paths. Never on a word that
is not an identifier. Numeric columns are right-aligned with `tabular-nums`; text
is left-aligned. Prose measure ≤ 68ch. Body text is never centred.

Small caps (`font-variant: small-caps`, never `text-transform: uppercase`) appear
in one place: the fasti strip's weekday initials.

### Color

Neutrals do the work. Five of them, replacing the fourteen greys in the mocks:

`ink #16211E` · `ink-2 #4A5654` · `ink-3 #788582` · `rule #DDE3E1` ·
`wash #F4F7F6`. Surfaces are white; panels are separated by rules, not by a
lighter-on-darker sandwich.

- **Verdigris `#0B6E5F`** — identity and interaction: the wordmark, links, the
  focus ring, the current selection. At most **one verdigris fill per screen**
  (the primary action, where one exists). Never a decorative fill, never a tint
  wash.
- **Amber `#B7791F`** — waiting on a human, and nothing else, ever. Budget: one
  amber region per screen plus the nav count. Rendered as a **2px left rule** on
  the row plus the age numeral in amber. Never a pill, never a background, never
  on a duration that is not yours.
- **ok `#2E9E64` / bad `#C64A3A`** — inside a gate mark only, at 6px, and always
  paired with a **shape** difference so the state survives colour blindness
  ([don't rely on colour alone](https://carbondesignsystem.com/patterns/status-indicator-pattern/)).
- Ceiling: **≤3 semantic colours visible at once**. Projects are named, never
  colour-coded — the per-project dot is deleted.

### Space

- **4px base. Permitted gaps: 4, 8, 12, 16, 24, 32, 48.** Nothing else. The
  9/13/14/22/28 values in the mocks are all errors.
- **Two radii: 2px on marks, inputs and controls; 0 on panels and rows.** No
  999px pills anywhere. Circles exist only on avatars.
- **Zero box-shadows in the flat layer.** Shadow exists once, on the drawer:
  `0 0 0 1px var(--rule), 0 16px 48px rgba(22,33,30,.18)`.
- **Hairlines, not boxes.** A panel is a 1px `--rule` top border plus a heading.
  Nesting depth cap is 2 (screen → panel). Anything that wants to be a card
  inside a card becomes a row inside a table.
- **Density targets.** Board: 288px columns, 64px cards, 8px between, ≥12 cards
  visible per column at 900px. Tables: 32px rows, 8px cell padding vertical,
  16px horizontal, ≥20 rows visible. One density, no toggle.
- **Chrome budget.** Nav ≤ 44px, no second toolbar, no breadcrumb bar. Content
  begins within 56px of the viewport top. ≥88% of vertical pixels are content.

## 4. Signature elements

Five ownable components. These are what the console is recognised by.

**4.1 Gate ladder as engraved marks.** Not coloured dots. A fixed-width row of
6×6px marks at 3px gaps sitting on a 1px rule (the rail): filled ink = passed,
hollow 1px outline = pending, `bad` fill with a 1px diagonal = failed, `ok` fill
= a human's own call passed, half-height bar = waived. Width is a function of
gate count, so items sharing a probatio set align vertically down a column and
the column reads as a stack of identical ladders with different fill patterns —
which is exactly what "who is stuck where" looks like. Four gates = 33px.
Hover names the gate and its blocker.

**4.2 The fasti strip.** Officina only, 28px tall, full width, directly under the
nav: 14 day-columns, past through today to forecast. A filled 3px verdigris tick
= a cascade landed; a hollow 3px tick = the officina was open and nothing landed;
nothing at all = a closed day (posture `closeout`, or over allowance). Weekday
initial in 11px small caps beneath. Today is a 1px full-height ink rule, not a
highlight. It is the only graphic on the screen, and it is literally a Roman
calendar of days on which business may be done.

**4.3 Clause number as anchor.** Lex clauses, decisions and check-rule citations
render with the number in a 32px left gutter: mono 12px `ink-3`, right-aligned,
baseline-aligned to the clause's first line, no punctuation, no bold. Body at
15/22 in a 62ch measure. Licensed because the content genuinely is numbered
(leges run §1–§9 and rules cite them). Numbered markers appear **nowhere else**.

**4.4 The decision line.** Every human verdict renders as one 20px line in four
fixed columns: verb (13px/500 ink — `approve` `decline` `defer` `delegate`, a
word, never an icon, never a checkmark), subject (mono 12px, 24ch truncation),
reason (13px `ink-2`, one line, five presets plus free text), timestamp (mono
11px `ink-3`, right). **A decision without a reason cannot be submitted** — the
reason is the product, and it is what makes retro computable
([reason codes as the feedback loop](https://linear.app/now/how-we-built-triage-intelligence)).
A deferral's reason travels with the item, so the Board shows
`deferred · waiting for info`, not a yellow dot.

**4.5 The colophon rule.** Every screen *ends* — at the bottom of its scroll, not
floating — with one hairline and one mono 11px `ink-3` line: source tree hash,
officina path, generated-at, schema version. It is the ledger's imprint. It names
which bytes this view renders, which is what makes `stale` legible without a
badge. It is the only footer in the product.

## 5. Motion and interaction

- **No entrance animation, no page-load sequence.** Nothing moves that a person
  did not move.
- Three transitions exist, all 120ms ease-out: drawer slide-in from the right
  (translateX only — no fade, no scale), row-selection background, disclosure
  height. `prefers-reduced-motion` drops all three to 0ms.
- **No spinner, ever.** Work in progress is a 2px verdigris bar across the top of
  the affected row. Unknown duration means it sits at its last known fraction
  with the elapsed mono numeral beside it; it does not pulse. A stopped clock
  reads as stopped, and that is the honest signal.
- **Drawer, never modal.** Board scroll position is snapshotted on open and
  restored on close; the board stays live behind it.
- **Keyboard first.** Item lists are roving-tabindex listboxes: `j`/`k` move,
  `Enter` opens the drawer, `Esc` closes, `1`/`2`/`3` are approve/defer/decline
  in the Inbox, `⌘K` is the only palette. Shortcuts are printed in the drawer
  footer, not hidden behind a help modal.
- Focus ring: 2px verdigris at 2px offset, on every focusable element, never
  suppressed on a custom control.
- Hover changes background colour only. No lift, no shadow, no scale, no
  border-colour change.

## 6. Per-screen notes

**Inbox** — a queue of decisions, not a mail client. One column at a 720px
measure, left-aligned to the screen title; **no preview pane**, because two panes
invite reading instead of deciding. The focused item is expanded and shows its
ask, its evidence links and the four verbs; every other item is a 40px row —
amber 2px left rule if it is yours, title at 13/18, asker's sella id in mono 12,
age as a right-aligned mono numeral that escalates in *weight* (500 → 700) with
age, never in colour. "You asked" and "For information" sit below a rule,
collapsed, and never carry amber. The empty state is the resting state: one line,
"Nothing waiting on you", then the colophon. No celebration graphic.

**Officina** — the fasti strip, then four panels stacked between hairlines, no
boxes: decreta pending, posture and burn, lex status, process health. Burn is two
mono numerals and a 4px rule filled to the spent fraction — ink under allowance,
amber past it. No donut, no gauge, no sparkline. Posture is the word itself at
17px Bricolage 600 (`closeout`) with its reason beneath at 13px: a posture is a
sentence someone can argue with, not a coloured chip. The pause brake is the one
place a verdigris fill button is allowed.

**Board** — phase columns at 288px; the card is three lines in 64px: gate ladder,
title truncated at two lines (13/18), owner sella id in mono 12. Cards have no
border and no shadow — they are separated by 8px of page and carry a 2px left
rule only when blocked (`bad`) or waiting on you (amber). The column head is two
lines: name + count at 13/500, then a 3px WIP rule filled to count/cap (ink under
cap, amber at cap — a WIP breach is a human's problem) with median dwell time as
a right-aligned mono numeral, so the header names the bottleneck instead of just
labelling the column
([column limit indicators](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout)).
Needs-you is not a floating pill: it is the first column, pinned left, empty on a
good day.

## 8. Screen map

Four Patron touchpoints (STUDIO.md §4) mapped to screens. A structural
change to a screen must preserve the touchpoints it owns; moving a touchpoint
between screens is a lex change (check: design.screen-map).

| Touchpoint | Write | Screen | Surface |
|---|---|---|---|
| **Decretum** | backlog → greenlit / declined | **Board** | fasti strip + decretum queue; greenlight is the Board's verb |
| **Budget allocation** | per-collegium stipendium | **Officina** | posture and burn panel; the Patron sees the allocation and its effect |
| **Arbitrium** | human probatio verdict | **Inbox** | petitio detail pane; approve / defer / decline / delegate with ratio decidendi |
| **Lex change** | amend a collegium's lex | **Officina** | lex status panel; pending amendments surface here |

Screens not owned by a touchpoint:

| Screen | Role |
|---|---|
| **Acta** | read-only feed — consultations, decisions, dailies, evidence |
| **Agents** | roster, per-sella cost, provider limits |
| **Swimlane** | actors × time; the Patron is a lane |
| **Graph** | topology |

## 7. Rejects

Banned as generic or as kitsch. A build containing one of these fails review.

- **Serif body text, parchment, sepia, texture overlays, wax seals, Trajan,
  ornamental borders.** The Latin lives in the vocabulary; in the pixels it is
  costume. (Rejects the classical lens's serif-body move — the token set is the
  Patron's and wins.)
- **Broadsheet pastiche** — justified multi-column prose, rules used as
  decoration. Hairlines here carry structure or they are deleted.
- **The density toggle** (condensed/regular/relaxed). One audience, one density.
  A preference we persist is a decision we refused to make.
- **Status-reflective nav glyphs** (Vercel's move). Our states are per item; a
  nav icon averaging seven items' states says nothing.
- **Concentric status pulse rings** (agent-activity's move 2). Three nested rings
  is a chart the size of a bullet; the drawer's waterfall bar says it legibly.
- **Per-project colour dots and colour-hashed identities.** A colour mapping
  nothing learnable is decoration.
- **Batch-confirm staging in the Inbox** (inbox-attention's move 1). A decision
  not committed when made is a decision you will re-litigate. Commit on the verb;
  offer undo for 10 seconds.
- **Sparklines, donuts, gauges, KPI card strips, trend arrows, heatmap cells.**
- **Emoji as status** (⚠️ 🔴 🟡) anywhere in product chrome.
- **Swimlanes as a Board grouping axis.** Swimlane is its own screen (actors ×
  time); on the Board, gate state is card metadata, not an axis.
- **Gradients, glassmorphism, hover lift, bounce/elastic easing, scroll-triggered
  reveals.**
- **All-caps tracked-out eyebrow labels**, `A · B · C` middle-dot meta strings,
  and `→` appended to link or button text.
