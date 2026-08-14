# Handoff: Claude CLI Chat Screen (WPF)

## Overview
Replacement for the existing Claude CLI chat screen in the WPF app. Same information as
today — session header, assistant turns, tool-call rows, live "running" status, composer —
but restructured as an **inline transcript** (Claude / ChatGPT / Copilot style) instead of
per-message chat bubbles. Legibility was a hard requirement: large body type, high
contrast, no boxed rows.

## About the Design Files
The files in this bundle are **design references created in HTML** (`.dc.html`). They are
prototypes showing intended look and behavior — **not** production code to copy.
The task is to recreate this design in the existing WPF application using its established
patterns: XAML `UserControl`s, existing view models, existing resource dictionaries /
styles. Do not embed a WebView. Do not port the HTML.

Open `Claude CLI Chat.dc.html` in a browser to see the target. `Claude CLI Chat Grid.dc.html`
shows eight instances tiled 4 columns x 2 rows — the layout must survive that tile size.

## Fidelity
**High fidelity.** Colors, type sizes, weights, spacing and states below are final. Match
them. Where a value is given as a range (min → max), it is a fluid value; see *Responsive
behavior*.

## Screen: Chat session pane

**Purpose:** watch an agent session stream, expand tool calls for detail, reply or stop.

**Root layout** — a 3-row `Grid` filling its container:
- Row 0 (Auto): header bar
- Row 1 (\*): transcript, vertically scrollable
- Row 2 (Auto): composer
Root: background `#020617`, 1px border `#1E293B`, corner radius 8, clipped content.
Font family **Inter** throughout (fall back to Segoe UI Variable if Inter is not installed).

### 1. Header bar
Horizontal stack, padding 14,9 (h,v at full size), background `#020617` (95% opaque),
bottom border 1px `rgba(30,41,59,.9)`. Items left to right, gap 12:
1. **Brand tile** 24x24, radius 7, diagonal gradient `#0078D4` → `#00B4D8`, white text "SM", 10px/800.
2. **"Session #3"** — 15px, 600, `#F8FAFC`.
3. **"local #3"** — 13.5px, 400, `#94A3B8`.
4. Vertical divider 1x18, `#1E293B`.
5. **"claude-sonnet-4-5 · 18 turns"** — 13px, 500, `#94A3B8`; ellipsize when cramped.
6. Spacer.
7. **RUNNING pill** — radius full, fill `rgba(37,99,235,.10)`, border 1px `rgba(37,99,235,.25)`,
   padding 10,4; a 6px dot `#60A5FA` with a 3px `rgba(96,165,250,.18)` halo, then label
   "RUNNING" 11.5px/700, letter-spacing .09em, `#A8CCFF`.
   States: RUNNING (blue), IDLE (`#94A3B8` on `rgba(148,163,184,.10)`), ERROR (`#FCA5A5` on
   `rgba(239,68,68,.10)`) — dot stops pulsing when not running.

No icon buttons in the header (deliberately removed).

### 2. Transcript
Scrollable. Content column max width **800px**, centered, horizontal padding 36.
Scrollbar: thin, thumb `#1E293B`, no arrows, overlay style.

**User turn** — vertical stack, padding 0,24 top / 0,26 bottom, bottom border 1px `rgba(30,41,59,.6)`:
- Role line: 20x20 tile radius 5, fill `rgba(148,163,184,.14)`, text "SM" 9px/700 `#CBD5E1`;
  then "YOU" 12px/700, letter-spacing .1em, `#94A3B8`.
- Body: 17.5px, line-height 1.7, `#F8FAFC`, wraps, selectable.
- No bubble, no background fill.

**Assistant turn** — vertical stack, gap 22, padding-top 26:
- Role line: 20x20 tile radius 5, gradient `#0078D4` → `#00B4D8`, 11px white sparkles glyph;
  then "CLAUDE" 12px/700, letter-spacing .1em, `#7DBAFF`.
- Each paragraph: 17.5px, line-height 1.75, `#EEF2F7`, selectable, wraps.
- The streaming paragraph ends with a caret: 8px wide, 0.9em tall, `#60A5FA`, blinking
  1s steps(1) (visible 0–45%).

**Tool-call row** (repeats between paragraphs) — a borderless, transparent button, full
width, padding 0,7, content 14.5px:
- Leading glyph 16x16 `#60A5FA` — wrench for multi-tool rows, file-text for a single Read.
- Title 14.5px/600 `#CBD5E1`: "Ran 8 tools", "Ran Read", "Ran 5 tools", "Ran 2 tools".
- Subtitle, monospace (Menlo/Consolas) 13px `#7C8B9F`: "Glob · Grep · Read",
  "LeftSidebar.xaml", "Grep · Read", "LeftSidebar.xaml.cs", "Grep". Ellipsize.
- Spacer, then a chevron-down 15x15 that **rotates 180° over 180ms** when expanded.
- Hover: all text → `#93C5FD`. Cursor hand. No background change, no border.
- Expanded detail: appears below, margin-top 6, padding 12,8, **left rule 2px
  `rgba(37,99,235,.35)`**, monospace 13.5px line-height 1.7 `#A3B0C2`, one line per tool
  call. Result counts in `#34D399` (success) or `#FBBF24` (zero matches). Overflow lines
  collapse to "+ 5 more" in `#7C8B9F`.

**Live status line** (last item while running) — spinner 14x14 `#60A5FA` rotating 900ms
linear infinite; "running Grep" monospace 15px `#B6C2D2`; separator "·" `#7C8B9F`;
elapsed "4.2s" `#94A3B8`.

### 3. Composer
Top border 1px `rgba(30,41,59,.9)`, background `#020617`/95%, padding 14 top / 12 bottom.
Same 800px centered column, horizontal padding 36.
- **Input shell**: background `#0D1526`, border 1px `#26344A`, radius 10, padding 14 left /
  10 elsewhere; items bottom-aligned, gap 10. Focus: border `#0078D4`.
  - Terminal glyph 15x15 `#64748B`.
  - Multi-line TextBox: transparent, no border, 16.5px, line-height 1.5, text `#E2E8F0`,
    placeholder "Reply to Claude — Shift+Enter for a new line" in `#64748B`;
    auto-grows from 26px to 120px then scrolls.
  - **Stop** button: height 36, padding 14, radius 6, fill `rgba(239,68,68,.08)`,
    border 1px `rgba(239,68,68,.3)`, text `#FCA5A5` 14px/600, 11px square glyph.
    Hover fill `rgba(239,68,68,.16)`. Enabled only while running.
  - **Send** button: height 36, padding 18, radius 6, fill `#0078D4`, white 14px/600,
    trailing arrow-right 13px, drop shadow `0 4 14 rgba(0,120,212,.30)`.
    Hover `#1A8AE0`, pressed `#005A9E`. Disabled: fill `#1E293B`, text `#64748B`, no shadow.
- **Status footer** row, 13px `#8494A8`, gap 18, single line, ellipsized:
  clock glyph + "Running for" with the elapsed run time in monospace `#B6C2D2` (e.g. `12m 47s`,
  ticking every second while RunState is Running); spacer; right-aligned `28.4k / 200k tokens`.

## Interactions & Behavior
- **Tool row click** toggles its own expanded state. Independent per row; no accordion.
  Chevron rotates 180° / 180ms; detail block appears immediately (no height animation needed).
- **Enter** sends, **Shift+Enter** newline. Send is disabled when the box is empty.
- **Stop** cancels the run: RUNNING pill → IDLE, spinner line disappears, caret disappears.
- **Streaming**: new paragraphs and tool rows append at the bottom; auto-scroll to bottom
  only when the user is already within ~40px of the bottom, otherwise leave the scroll
  position alone (do not use forced scroll-into-view).
- **Transitions**: colors 150ms, chevron rotation 180ms, spinner 900ms linear.
  Nothing else animates — no bounce, no scale on press.
- **Hover** = color shift only (text to `#93C5FD`, buttons one step lighter).
- **Focus** = 1px `#0078D4` ring/border.

## Responsive behavior (required — 4x2 tiling)
The pane must stay readable from ~1900px wide down to a **480x530** tile (eight panes in a
4-column, 2-row grid on a 1920x1080 screen). Sizes scale with the pane's own width, not the
window's. In WPF use a `ViewboxSize`-free approach: bind font sizes to pane width via a
converter, or switch a small/large size resource set at a 620px width breakpoint.
Fluid values (min at ~480px wide → max at ~800px+):
- Body text 12.5 → 17.5
- Tool row title 11 → 14.5; tool subtitle/detail mono 10 → 13 / 10.5 → 13.5
- Role labels 9.5 → 12; header session name 12 → 15
- Composer text 12 → 16.5; footer 10 → 13
- Column padding 14 → 36; assistant gap 11 → 22
Nothing may drop below **10px**. Header items ellipsize before they wrap; the RUNNING pill
never shrinks. Below ~560px wide the footer's elapsed label may drop the word "Running for".

## State Management
Per pane view model:
- `SessionLabel`, `LocalLabel`, `ModelLabel`, `TurnCount`
- `RunState` enum { Running, Idle, Error } → drives the pill and Stop/Send enablement
- `Turns`: ordered collection of items, each one of: UserMessage(text),
  AssistantParagraph(text, isStreaming), ToolGroup(title, summary, glyph, IsExpanded, Details[]),
  StatusLine(toolName, elapsedSeconds)
- `Draft` (two-way bound to the TextBox), `CanSend`
- `RunStartedUtc` / `Elapsed` (formatted `Nm Ss`, or `Nh Nm` past an hour), `TokensUsed`, `TokenBudget`
`IsExpanded` lives on the ToolGroup item so expansion survives incoming stream updates.
Use an `ItemsControl` + `DataTemplateSelector` (or `ItemContainerStyle` with implicit
DataTemplates) over `Turns` — one template per item type — inside a `ScrollViewer`,
with virtualization enabled.

## Design Tokens
Colors: canvas `#020617`; chrome `#0A2540`; surface `#0D1526`; border `#1E293B` /
`#26344A` / `rgba(30,41,59,.6-.9)`; primary `#0078D4` (hover `#1A8AE0`, pressed `#005A9E`);
accent `#00B4D8`; accent text `#60A5FA` / `#7DBAFF` / `#A8CCFF` / `#93C5FD`;
text `#F8FAFC` / `#EEF2F7` / `#E2E8F0`; muted `#CBD5E1` / `#B6C2D2` / `#A3B0C2` /
`#94A3B8` / `#8494A8` / `#7C8B9F` / `#64748B`; success `#34D399`; warning `#FBBF24`;
danger `#FCA5A5` on `rgba(239,68,68,.08)`.
Spacing: 4px base — 4, 6, 8, 10, 12, 14, 18, 22, 26, 36.
Radius: 5 (small tiles), 6 (buttons/inputs), 7-8 (brand tile, pane), full (pill).
Shadow: `0 4 14 rgba(0,120,212,.30)` for Send only.
Type: Inter 400/500/600/700/800; monospace Menlo → Consolas for tool detail lines only.
Letter-spacing: -0.02em on the 800-weight brand tile, +0.09/0.1em on uppercase labels.

## Assets
- Icons: **Lucide** (2px stroke) — sparkles, wrench, file-text, chevron-down, loader-2,
  terminal, square, arrow-right, clock. In WPF, use Lucide SVG paths as
  `PathGeometry` resources or a vector icon library; do not use emoji or an icon font.
- Brand mark: the gradient "SM" tile is drawn in XAML (rounded rect + LinearGradientBrush +
  TextBlock), no image asset needed.

## Files
- `Claude CLI Chat.dc.html` — the screen (open in a browser; click tool rows to expand).
- `Claude CLI Chat Grid.dc.html` — 8 panes at 4x2 on 1920x1080, the resize target.
- `_ds/` — design-system tokens/stylesheets the prototypes reference.

## Notes for the implementer
- Replace the existing bubble-based chat view; keep the existing view model surface where
  possible and add the fields listed above.
- The transcript is one continuous flow: separation comes from **type, spacing and a single
  hairline rule between turns**, never from per-message containers.
- Content in the prototype is sample data from a real session; wire it to live data.
