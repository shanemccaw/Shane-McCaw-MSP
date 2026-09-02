# The Claude Chat Document — WPF Handoff

This README covers **one document type only**: the Claude chat page, the thing you get
when you open a chat tab (`TabKind.Chat`). In the mockup that is the tab titled
**Build Console** — open **`Shell Skeleton v2.html`** in this folder and it is the tab
already selected on load (internal id `bc-1096`, context bar reads `#1202`).

Phase 1 called it "the Claude chat pane" and described roughly a transcript and a text
box. Phase 2 skipped it. Since then it has become the densest surface in the app: five
bands, a shared right-hand tool rail with **eleven** dockable tools, a cross-epic
question round trip, and a per-tab draft model. All of that is specified below.

The visual target is the mockup markup and its inline `style="…"` attributes. Ignore the
`<x-dc>` wrapper and the `<script type="text/x-dc">` block. **Port the numbers, not the
vibe.** Colours come from `App Shell v2 Color Palette.html`; this document only uses
tints of colours already in it.

One important note on palette: **the chat document is the only surface that is warm.**
The rest of the shell is the cool slate family (`#0d1117` / `#161b22` / `#21262d`). The
chat transcript, its breadcrumb bar, its composer and every tool panel in its rail use
the warm Claude family (`#1e1e1c` / `#1a1a19` / `#232320` / `#302f2d` / accent
`#d97757`). The context bar at the very top is the exception — it stays cool, because it
belongs to the shell, not to Claude. Do not "harmonise" these.

---

## 1. Anatomy

Top to bottom, the chat document is five bands. Only band 3 and band 4 scroll.

| # | Band | Height | Background | Scrolls |
|---|---|---|---|---|
| 1 | Context bar (shell-owned) | content, wraps | `#12151c` + progress fill | no |
| 2 | Breadcrumb / Share bar (Claude-owned) | 40px | `#1a1a19` | no |
| 3 | Transcript | fills | `#1e1e1c` | yes, vertical |
| 4 | Tool rail (right of transcript) | fills, 280px wide | `#232320` | yes, per panel |
| 5 | Composer | content | `#1a1a19` | no |

Bands 3 and 4 sit side by side inside one flex row. The rail is a *sibling* of the
transcript, not an overlay — opening it narrows the transcript, it never covers text.

```
┌──────────────────────────────────────────────────────────────┐
│ 1  #1202 · 4 verifying · 2 in-flight … 40,197/300k ctx  ⌸⚒⧉ │  cool
├──────────────────────────────────────────────────────────────┤
│ 2  ▤ Shane McCaw SaaS / 1202 Build Console ⌄        📄 Share │  warm
├────────────────────────────────────────┬─────────────────────┤
│ 3  transcript, 700px column, centred   │ 4  tool rail 280px  │
│                                        │    (one tool)       │
├────────────────────────────────────────┴─────────────────────┤
│ 5  ⊕ [ Write a message… ]                        🎤 ⌄        │
│    Claude is AI and can make mistakes.   Sonnet 5  Medium    │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Band 1 — Context bar

A wrapping flex row, `padding:8px 14px`, `gap:8px 10px`, on `#12151c` with a
`border-bottom:1px solid #21262d`.

**The fill.** Behind the row, an absolutely positioned bar pinned `left/top/bottom:0`,
width = context-used percentage, `opacity:.16`, with a `1.5px` right border in the same
colour, `transition:width .3s`. It is a background gauge, not a widget — the row content
sits above it at `z-index:1`.

| Element | Detail |
|---|---|
| `#1202` | 17px, 800, mono, `#fde047`. Click → opens the left panel on **Epics**, expanded to this chat's epic. This is the epic the chat is *assigned to*. |
| divider | 1px × 16px `#262c36` |
| `N verifying` | 11px `#8fa7c4` |
| `N in-flight` | 11px `#6a8fb5` |
| `N queued` | 11px `#8b949e` |
| `N blocked` | 11px `#e8746f` |
| `N/M complete` | 11px 700 `#7fb08a` |
| divider | |
| `P` pill | plan tier, 10px 700, `#1e2233` bg, `#2e344e` border, `#8fa7c4` text |
| `40,197 / 300k ctx` | 11px mono; colour tracks the same percentage as the fill |
| **Start New Chat** | appears **only at ≥75%**. 26px, `#e8746f`, text `#1a0d0d`, 800. Opens a fresh chat tab on the same epic. |
| `Messages: N` | 10.5px, count in `#c9d1d9` 700 |
| `Active: 0d 1h 43m` | wall time since the session started |
| ⌸ list-checks | toggles **Detected in this chat**. Colour `#c2c0bc` idle → `#e6edf3` open. Carries a 6px `#d97757` dot when undismissed items exist and the panel is closed. |
| ⚒ wrench | opens the **tool menu** (§5). Always `#e2984a`, always carries a 6px `#e2984a` dot. |
| ⧉ picture-in-picture-2 | opens **Claude Floaty** (§8) |

**Context maths (as mocked).** `used = round(sum(len(message.text) + len(message.code)) * 0.28) + 40000`,
against a 300,000 budget. The 40k is fixed overhead (system prompt + attached docs).
Thresholds: `<60%` blue `#6a8fb5`, `60–79%` amber `#e2b039`, `≥80%` red `#e8746f`;
the Start-New-Chat button appears at `≥75%`.

Replace the 0.28-per-character estimate with a real tokeniser count when the service can
supply one, but **keep the two-part shape** (fixed overhead + conversation) — the whole
point is that a chat starts at 13% before you type anything.

**Layout rule that has already bitten us twice:** this band must **not** clip its
children (`overflow:visible`) and must carry `position:relative; z-index:40`. The wrench
menu is a child of it and drops 309px below its 60px box. It is also *not* allowed to
position that menu with fixed coordinates — see §5.

---

## 3. Band 2 — Breadcrumb / Share bar

40px, `#1a1a19`, `border-bottom:1px solid #302f2d`, `padding:10px 18px`, `gap:10px`.

`▤ panel-left 16px #c2c0bc` · `Shane McCaw SaaS` 13px `#c2c0bc` · `/` `#5a5955` ·
**`1202 Build Console`** 13px 500 `#ece9e4`, underlined in `#5a5955` at 3px offset,
clickable (same target as `#1202` above) · `⌄ chevron-down 13px #8a8985` · spacer ·
`📄 file-text 17px` · **Share** pill (12.5px 600, `#302f2d`, `border-radius:99px`,
`padding:6px 14px`).

This band is deliberately a near-replica of claude.ai's own chrome. It is what makes the
document read as "a Claude chat living in our shell" rather than "our chat client".
Share is **inert in the mockup** (`cursor:default`) — wire it to the claude.ai share URL
for the mapped conversation, or hide it if the WebView2 host owns sharing.

---

## 4. Band 3 — Transcript

- Column: `max-width:700px`, centred (`margin:0 auto`), `padding:0 24px`, `gap:22px`
  between messages, `padding-top:28px` on the scroller.
- **Claude turns**: no bubble. Plain text on the page background, `font-size:15px`,
  `line-height:1.65`, `white-space:pre-wrap`, **serif** (`ui-serif, Georgia, 'Times New
  Roman', serif`), colour `#dedbd5`.
- **Your turns**: right-aligned bubble, `#2a2a27`, `border-radius:14px`,
  `padding:12px 16px`, same serif stack, colour `#ece9e4`, capped at ~80% column width.
- **Inline code chip**: `#2a2a27`, `border-radius:5px`, `padding:2px 7px`, mono 13px,
  `#d97757`, dotted underline `#6b4d40` at 3px offset, `margin-top:10px`,
  `display:inline-block`, `white-space:pre-wrap`.
- **Scroll-to-bottom affordance**: 34px circle, `#2a2a27`, `1px #3a3a37` border,
  `arrow-down` glyph, `position:sticky; bottom:14px`, centred, `z-index:5`. In the mockup
  it is decorative; make it real (jump to newest, hide when already at bottom).
- The serif face is intentional and non-negotiable — it is the single strongest signal
  that this pane is Claude's output and not our UI copy.

**Message contract.**

```csharp
record ChatMessage(string Author, string Time, string Text, string? Code);
// Author: "You" | "Claude". Time: short local time, e.g. "2:41 PM".
// Code: optional single inline code chip rendered under the text.
```

The mockup renders a linear list with no avatars, no timestamps in the row, no
per-message actions. If you add copy/retry affordances, they belong on hover inside the
message column, never in a persistent gutter — the 700px measure is load-bearing.

---

## 5. The tool menu (wrench)

A 190px popup, `#232320`, `1px #35342f`, `border-radius:8px`,
`box-shadow:0 10px 24px rgba(0,0,0,.5)`, `padding:5px`, rows `7px 8px`, 11.5px 600
`#ece9e4`, hover `#2f2f2b`. Each row is a 13px lucide glyph in the tool's colour plus a
label.

**Positioning — do this and nothing else:** the popup is a child of a
`position:relative` wrapper around the wrench glyph and is placed
`position:absolute; top:calc(100% + 7px); right:0; z-index:60`. It must not be
positioned from measured screen coordinates (we shipped that twice: once it flew to the
window's left edge, once it was clipped to 2px of height by an `overflow:hidden`
ancestor). No ancestor between the popup and the transcript row may clip.

Order and identity, top to bottom:

| Tool | id | Icon | Colour | Panel |
|---|---|---|---|---|
| Log Peek | `logs` | activity | `#7fb08a` | §6.4 |
| API Runner | `api-local` | zap | `#c084fc` | §6.3 |
| Graph Read | `api-read` | zap | `#00b4d8` | §6.3 |
| Graph Write | `api-write` | zap | `#e2593f` | §6.3 |
| Git Doctor | `gitdoctor` | git-branch | `#e2593f` | §6.2 |
| **Git Map** | `gitmap` | columns | `#6a8fb5` | §6.5 |
| **Repo Health** | `health` | scan-eye | `#e0a879` | §6.6 |
| SQL Runner | `sql` | database | `#38bdf8` | §6.7 |
| PowerShell | `ps` | terminal-square | `#4f8ff0` | §6.8 |
| Terminal | `terminal` | terminal | `#6ee7b7` | §6.8 |
| JSON Viewer | `json` | braces | `#c084fc` | §6.9 |
| Windows File Browser | `files` | folder-tree | `#7dc4f5` | §6.10 |

Picking a tool sets `ChatToolOpen = id`, closes the menu, and **closes the Detected
panel** — the rail holds exactly one thing.

---

## 6. Band 4 — The tool rail

One container, `flex-basis:280px` when anything is open and `0px` when nothing is
(animate the basis; the transcript reflows). Background `#232320`, left border
`1px #302f2d`.

**Every panel shares one header:** 36px tall, `padding:0 12px`, `gap:8px`,
`border-bottom:1px solid #302f2d` — a 13px glyph in the tool colour, the tool name at
12px 700 `#ece9e4` with `flex:1`, an optional `maximize-2` 12px `#7a7975` that opens the
full document version of the tool in a tab, and a `×` (15px `#7a7975` → `#ece9e4`).

**Every panel's body** is a `flex:1; min-height:0; overflow-y:auto` column. Sections
inside it are `flex:none` — a `flex:1` child inside a scrolling column collapses to 0 and
paints under the footer (we shipped that bug on Repo Health; don't repeat it).

Standard controls inside panels: primary action buttons are 26px, `#d97757`, text
`#1a0f0a`, 700, `border-radius:5px`; secondary are transparent with `1px #3d3b37` and
`#c2c0bc` text; inputs are `#0d0f10` with `1px #302f2d`, mono 10–10.5px.

**Every panel ends in the same verb: it writes into the composer.** The rail never sends
a message on your behalf — it fills the box and lets you read it first. That rule is what
makes the tools safe to click mid-conversation.

### 6.1 Detected in this chat (the ⌸ panel, not in the wrench menu)

Header glyph `list-checks` `#c2c0bc`, title "Detected in this chat".

Body is two kinds of card:

**Grouped detections** — collapsible boxes (`1px #35342f`, header `#232320`, body
`#1e1e1c`) with a chevron, label, and a count pill (`#1a1a19`, `border-radius:99px`).
Two group bodies exist:
- *Verifying / landed builds*: a 3-column grid of `#NNNN` chips (`#2a2a27`, `1px #3a3a37`,
  `#d97757`, mono 10.5px 700) plus one action — **Inject "Landed" via DOM Injector**
  (`#d97757` pill with a `terminal` glyph). This types into the claude.ai composer via
  the DOM injector rather than our own message pipe.
- *Claude asks / commitments*: rows of kind-tagged lines, then two actions — **Ask Claude
  to summarize** (`#302f2d`) and **Simulate check-in** (`#d97757`).

**Loose items** — `#232320` card, `1px #35342f`, a type chip, a timestamp
(`#7a7975`, right-aligned), the detected text at 11.5px, then **Promote to Queue**
(`#d97757`) and **Dismiss** (text button `#a6a4a0`).

Empty state: centred italic 11px `#7a7975`, *"Nothing caught yet — keep talking."*

Dismissals are per item and persist for the session; the ⌸ dot only lights when at least
one undismissed item exists **and** the panel is closed.

```csharp
record Detection(string Id, DetectionKind Kind, string Text, DateTime At, int[] Issues);
enum DetectionKind { Task, Todo, GitIssue, Commitment, Question }
```

### 6.2 Git Doctor

Header `git-branch` `#e2593f`, `maximize-2` → full Git Doctor document.

1. **Summary** (`flex:none`, `border-bottom`): headline at 11px 700, then
   `branch · ahead/behind` in 9px mono `#7a7975`. Then the big red button —
   **Fix My Git Nightmare** (30px, `#e2593f`, text `#1a0f0a`, 800, `zap` glyph) with a
   centred 8.5px `#7a7975` sub-line under it.
2. **Findings** list: one row each — a severity dot, the title (ellipsised), a severity
   chip. Rows are clickable (selects the finding in the full document).
3. **Claude bridge**: label `CLAUDE BRIDGE` (9px 800 `#7a7975`) with **send findings**
   (`#d97757` text button) on the right; a 3-row mono textarea placeholdered
   *"Paste Claude's commands…"*; **Extract commands** (secondary, 24px).
4. **Plan** (after extraction): checkbox rows of parsed commands in mono, each toggleable,
   then **Run N approved** (`#d97757`, 26px).
5. **Run log**: `max-height:140px` scroller, mono 9.5px `#9fd0a9`, `white-space:pre-wrap`.

The bridge is the interesting half: Claude answers in prose with fenced commands, you
paste the reply back, we parse commands out, you approve individually, we run them.
Nothing runs unapproved.

### 6.3 API Runner / Graph Read / Graph Write

One panel, three modes. Header glyph is always `zap`; colour and title come from the
mode (`#c084fc` local, `#00b4d8` Graph read, `#e2593f` Graph write). `maximize-2` opens
the matching full explorer.

- **Auth row**: a token-state pill; for Graph modes the tenant label; for local mode a
  `lock` button that opens a 238px **Autofill Gated Profile** popup (rows of user + tier
  chip, and a `+ Add or manage accounts` link into Settings); then **Get token** /
  **Refresh token** (24px `#4f8ff0`, text `#0d1117`).
- **Search endpoints** input (mono 10px).
- **Endpoint list**: `max-height:184px` scroller; each row a method chip + path in mono,
  clickable to select.
- **Selected endpoint**: method chip + full path.
- **Write safety** (write mode only): a two-button segmented control, **DRY RUN** /
  **LIVE**, on `#0d0f10`. Dry run is the default and must stay the default on every
  panel open — never remember LIVE across sessions.
- **Send** + a 26px copy icon button.
- **Response**: status chip (green/amber/red by outcome, with a distinct tone for
  *denied* and for *dry*), `ms · size` meta, a `max-height:150px` mono body, then
  **Paste response into the chat**.
- Empty state, italic: *"Run it here and paste the result straight into the message you
  are writing."*

### 6.4 Log Peek

Header `activity` `#9fd0a9`, `maximize-2` → full Log Viewer.

- **Mode row**: `COLD` / `BURST` / `LIVE` (24px each, mono 9.5px 800). Cold is grey and
  not streaming; burst is amber and counts down in seconds (`30s`, `29s`, … then falls
  back to cold by itself); live is green and tails continuously. The label of the burst
  button *becomes* the countdown while it runs.
- **Source chips**: horizontally scrolling row, one per log source, on/off.
- **Search this log** input (mono 11px).
- **Rows**: selectable lines — a selection box, a level chip, the message. Multi-select
  is the point: you pick 3 lines, not a whole file.
- **Footer**: **Send N lines to chat** (`#d97757`, `flex:1`) + a copy button. The
  composer receives them fenced as ` ```log `.
- Empty state: *"No lines retained for this source yet. Flip to BURST for 30 s to pull
  some in."*

Cold-by-default is deliberate: an always-live tail in a chat pane burns context and CPU
for no reason. Streaming is something you ask for, in bursts.

### 6.5 Git Map (mini)

Header `columns` `#6a8fb5`, `maximize-2` → the full Git Map document.

This is the epic-scoped digest of the Git Map. **Chats are assigned to an epic**, so this
panel is organised by epic, not by product.

1. **Pending cross-epic questions** (§7) — zero or more cards, above everything.
2. **Focus build** card (green, `rgba(127,176,138,.08)` on `1px #2f5238`): the
   `FOCUS BUILD` label, `#num`, the feature name, its product as a sub-line, a progress
   bar + `9/15`, then `6 left` · `2 bugs` · **send to chat**.
3. **Started and dropped** card (red, `#1d1211` on `1px #4a2320`): count in the label,
   then up to three rows — product dot, feature name, `closed/total`, and the builds-since
   figure as `19b` in red 800 mono. Clicking a row opens that feature's epic below.
4. **Epics list**, headed `EPICS · THIS CHAT IS ON #1202 BUILD CONSOLE`. The chat's own
   epic **sorts first**, is expanded by default, carries a `THIS CHAT` tag
   (`rgba(217,119,87,.16)` on `1px #5c3a2c`, `#d97757`) and a `1px #3d2b22` outline.
   Every row: product dot, `EPIC: Name`, its product as an 8.5px sub-line, a red stalled
   count if any, `closed/total`, chevron.
5. **Non-current epics** additionally get two text actions under the row:
   **Go to chat** (`#7c8cf0`, message-square) and **Go with a question** (`#d97757`,
   alert-circle) — see §7.
6. **Expanded epic** → its features as cards (`#0d0f10`, `1px #26262a`, 2px left border
   in the state colour): name + state pill, progress bar + fraction, then
   `#2200 · 0 builds ago` (red past the stall threshold) and two actions — **focus**
   (`#7fb08a`, makes it the focus build) and **send** (`#d97757`, writes what is left
   into the composer as a bulleted list with issue numbers and why each is open).

The mini panel and the full Git Map must read the **same** feature/epic data. They
disagreed once during design (Log Viewer filed under two different epics one click
apart) and it destroyed trust in both views instantly. Single-source it.

### 6.6 Repo Health

Header `scan-eye` `#e0a879`.

1. **Scan line**: `scan 2026-09-02 08:42 · 60 findings`, 9px mono `#7a7975`.
2. **Rule counters**: four equal tinted tiles — Depth `#e8746f`, Naming `#e2b039`,
   Stale `#d4a03c`, Orphan `#a374ea` — each a count over an 8px uppercase label.
3. **Open list**, headed `OPEN · N` with **pick next 5** (`#d97757`) on the right. Each
   row: a 13px checkbox, a rule pill, `#num`, the title. **Cap the selection at five.**
   Rows already sent read `In chat` and drop to `opacity:.5`, not clickable.
4. **Footer**: **Send N to this chat** (28px, `#d97757` when armed, dead grey when
   nothing is selected) plus a note — *"Evidence travels with them: chains, matched
   paths, parent state."*

Sending writes a markdown work order into the composer: one bullet per finding with its
rule and its real evidence (the depth chain, the matched dead path, the closed parent),
and a closing instruction that depth/naming may be fixed directly while stale references
must be reported, not closed.

### 6.7 SQL Runner

Header `database` `#38bdf8`. A gutter-numbered mono editor (`#0d0f10`, line numbers in
`#4a4945`, 4 rows, resizable), **Execute ▶** (`#0e2744` / `#7dc4f5`), then results:
Table/JSON tab pair, a `N rows` count, a bordered table (headers `#7dc4f5`, mono 9.5px)
or a `max-height:220px` pretty-printed JSON block in `#9fd0a9`, **Copy CSV** /
**Copy JSON**, and **Send result to chat box →**.

### 6.8 PowerShell and Terminal

Identical panels, different prompt and colour: `PS>` `#4f8ff0` / `$` `#6ee7b7`. A
`min-height:80px` mono output area (`#0d0f10`, command echoed in the prompt colour,
output in `#9fd0a9`, `pre-wrap`), an input row, Enter to run. Idle text:
*"Session ready. Type a command below."* Both sessions persist per chat tab while the
tab lives.

### 6.9 JSON Viewer

Header `braces` `#c084fc`. A 6-row paste textarea, **Prettify ▶** (`#2e1f45` /
`#dcc6f5`), an error line in `#fb7185` on invalid input, then the formatted output
(`max-height:220px`, `#9fd0a9`) and **Copy JSON**. Seeded with a small object so the
panel is never blank on first open.

### 6.10 Windows File Browser

Header `folder-tree` `#7dc4f5`. An indented tree (12px glyph, 10.5px name, indent by
depth), folders expand in place. Selecting a file shows its full path in mono
(`word-break:break-all`) with **Copy Path**. Read-only by design — this exists so you can
hand Claude an exact path, not to edit files.

---

## 7. The cross-epic question round trip

The problem, in the user's words: Claude in one chat swears a capability does not exist.
It does — it was built in a different epic's chat weeks ago. Today that costs a manual
hunt through chats, a copy, and a paste back.

The flow, as built:

1. In the Git Map panel, on any epic that is **not** this chat's epic, press
   **Go with a question**.
2. A 7px-radius box opens under that row (`#0d0f10`, `1px #3d3b37`) headed
   `ASK THAT CHAT`: a 3-row textarea, three tappable presets, and
   **Take it to that chat** (`#d97757`, full width, 26px).
   Presets as mocked:
   - *"Does this already exist? Show me the closed issues and the evidence."*
   - *"Is there a monitoring API on this side? Where does it live?"*
   - *"What is actually left open here?"*
3. Pressing it: opens (or selects) the destination epic's chat tab, **writes the question
   into that tab's composer** stamped `**Question from #1202 Build Console**` with a
   trailing `_Answer here, then take it back to #1202._`, and records a pending question.
4. The pending question renders as a card at the top of the Git Map panel — amber,
   `WAITING ON THAT CHAT`, the epic, the question text, **Bring the answer back**, and
   `open that chat`.
5. **Bring the answer back** captures the answer (in the mockup it is synthesised from
   the panel's own data — the feature that covers it, its closed/total, its last build,
   and either "every issue on it is closed" or the specific issues still open). The card
   turns green, `ANSWER READY`, and shows the evidence.
6. **Paste answer into this chat** appends `**Answer from #1485 Portal**`, the original
   question as a blockquote, and the answer **into the origin tab's composer**, switches
   you back to that tab, and clears the card.

Real implementation note: step 5 should read the destination chat's last assistant turn
(the DOM injector already reads the claude.ai transcript) rather than synthesising. If it
cannot, keep the button and let the user paste — the card's job is to hold the return
address so the trip does not get lost.

```csharp
record CrossEpicQuestion(
    string Id,
    int    ToEpic,   string ToEpicName,
    int    FromEpic, string FromEpicName,
    string FromTabId,          // the return address — required
    string Question,
    QuestionState State,       // Asked | Answered
    string? Answer);
```

---

## 8. Per-tab composer drafts

**This is a correctness requirement, not a nicety.** Every tool in the rail writes into
the composer, and the cross-epic flow writes into a *different tab's* composer. A single
global draft string breaks both: the question follows you home and the answer stays
behind.

- Drafts are keyed by tab id: `Dictionary<string, string> ChatDrafts`.
- The composer binds to `ChatDrafts[ActiveTabId]`.
- Every "send to chat" appends to the **active** tab's draft, separated by a blank line.
- The cross-epic flow writes explicitly to the destination / origin tab id.
- Sending a message clears only that tab's draft.

**Composer chrome.** `max-width:700px` centred; a pill (`#2a2a27`, `1px #3a3a37`,
`border-radius:26px`, `padding:8px 10px 8px 16px`) holding a `plus` glyph, an
auto-growing textarea (`min-height:22px`, `max-height:120px`, 14px, no border), a `mic`
glyph and a send chevron. Enter sends, Shift+Enter newlines. Under the pill, an 11px
`#7a7975` row: *"Claude is AI and can make mistakes. Please double-check responses."* on
the left; `Sonnet 5  Medium` on the right with the model name in `#ece9e4` 600.

---

## 9. Inspector states

The chat document can be taken over by the visual inspector:

- **warning** — a centred pill floats 20px from the top of the transcript
  (`rgba(42,42,39,.92)`, `1px #3a3a37`, `border-radius:99px`, amber alert-triangle):
  *"Inspector will ask Claude a question in 5s…"*. `pointer-events:none`.
- **blocking** — the composer band is covered by `rgba(20,20,18,.88)` with a 1px blur, a
  36px pulsing `terminal` medallion in `#d97757`, *"Inspector is asking Claude a
  question…"* and *"You'll get control back once Claude responds"*.

Only the composer is blocked. The transcript stays readable and the rail stays usable.

---

## 10. Claude Floaty

The ⧉ button pops the chat into an always-on-top mini window (tray title
`[#1202] New Chat`, icon `bot`, colour `#d97757`). It carries its own seeded transcript,
its own message list, and the same detection list as the ⌸ panel. Minimising parks it in
the floaty tray; restoring brings it back. Full spec lives with the floaty system, not
here — what matters for this document is that the button exists in band 1 and that the
floaty and the tab show the *same conversation*.

---

## 11. State model

| Field | Type | Notes |
|---|---|---|
| `ChatMessages` | `List<ChatMessage>` | per chat |
| `ChatDrafts` | `Dictionary<string,string>` | keyed by tab id (§8) |
| `ChatSessionStart` | `DateTime` | drives `Active: 0d 1h 43m` |
| `ChatToolOpen` | `string?` | one of the eleven ids, or null |
| `DomReaderOpen` | `bool` | mutually exclusive with `ChatToolOpen` |
| `DomReaderDismissed` | `HashSet<string>` | |
| `ToolboxMenuOpen` | `bool` | |
| `InspectorPhase` | `None \| Warning \| Blocking` | |
| `GmEpic` | `int?` | expanded epic in the Git Map panel; defaults to the chat's epic |
| `GmState` | `Dictionary<int,string>` | feature state overrides (focus/parked) |
| `GmQuestions` | `List<CrossEpicQuestion>` | §7 |
| `GmAskEpic` / `GmAskText` | `int?` / `string` | open ask box + its text |
| `RhSelection` | `List<string>` | Repo Health picks, max 5 |
| `RhState` | `Dictionary<string,string>` | finding → `In chat` etc. |
| per-tool session state | | log mode/sources/query, api mode/token/search/selection/dry-run, sql query/view/results, ps + terminal logs, json input/output, file tree expansion + selection |

Everything above is **per chat tab** except the log-viewer service state, which is global
(one tail, many viewers).

The chat's epic is **derived from the tab**, not stored twice: parse it from the tab's
subtitle (`#1485 Portal`) or, better, put `EpicNumber` on `TabDef` and read that. The
mockup originally hardcoded `1202` and the panel then lied about which chat you were in
as soon as you switched tabs.

---

## 12. Acceptance checklist

- [ ] Context bar wraps instead of overlapping at 900px; nothing clips.
- [ ] Wrench menu opens under the wrench, fully visible, clickable, at every window size.
- [ ] Exactly one rail panel open at a time; ⌸ and the wrench tools close each other.
- [ ] Opening/closing the rail reflows the transcript; it never overlays text.
- [ ] Every panel's sections stay `flex:none` — no zero-height lists, no rows under footers.
- [ ] Every "send to chat" lands in the composer of the tab you are on, appended with a
      blank line, never auto-sent.
- [ ] Switching tabs preserves each tab's draft independently.
- [ ] Cross-epic question: lands in the destination composer only; the answer lands in the
      origin composer only; the card clears after paste.
- [ ] "This chat" in the Git Map panel follows the active tab's epic.
- [ ] Repo Health selection caps at 5; sent findings dim and cannot be re-picked.
- [ ] Graph Write opens on DRY RUN every time.
- [ ] Log Peek opens COLD; BURST self-terminates back to COLD.
- [ ] Context percentage, colour, and the Start-New-Chat button all cross their
      thresholds together (75% / 80%).
- [ ] Transcript stays serif; the rail and chrome stay sans.
- [ ] Inspector *blocking* covers only the composer.

---

## 13. Open questions for you

1. **Share** — real claude.ai share link, or drop the pill?
2. **Answer capture** in §7 step 5 — can the DOM injector read the last assistant turn of
   another chat tab, or does the user paste?
3. **Token counting** — is a real tokeniser available to replace the 0.28/char estimate?
4. **Tool persistence** — should the rail's open tool be remembered per chat across app
   restarts? (Tool belts already persist per tab; this is the same question one level down.)
5. **Terminal/PowerShell scope** — real sessions, or scripted responses only? The panel is
   trivially the most dangerous thing in the document.
