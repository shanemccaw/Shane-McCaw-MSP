# App Shell v2 — WPF Design Handoff

This package is for the WPF/C# build of Build Console. It gives you the exact visual
target — not a spec to interpret, a reference to match as closely as WPF allows.

## What's in here

- **`Shell Skeleton v2.html`** — the working HTML/CSS mockup of the whole shell. Open it
  in a browser and click around. Every visual decision (spacing, colors, states,
  hover/pressed behavior, panel transitions, copy) lives in this file. Ignore the
  `<x-dc>`/`<script>` plumbing at the top and bottom — that's just how the mockup runs in
  its design tool. The actual UI is the HTML markup and inline `style="..."` attributes in
  the middle. Every color, padding, radius, and font-size value in there is intentional —
  port the numbers, not just the vibe.
- **`App Shell v2 Color Palette.html`** — every color used in the shell, grouped by role,
  with exact hex values and a suggested `Brush.Category.Name` resource key. Build your
  `ResourceDictionary` from this file directly. Section 10 (Claude Chat Pane) is a
  **separate warm sub-palette** used only inside the embedded Claude webview — don't let
  it leak into the rest of the shell, and don't let the shell's cool navy palette leak
  into it either.

## How to use these

1. Build the `ResourceDictionary` of `SolidColorBrush` resources first, straight from the
   palette doc. Use the suggested keys unless the codebase already has a brush-naming
   convention — then map to that instead, but keep the full 1:1 color coverage.
2. Then rebuild each screen/panel from the HTML, matching spacing and typography as
   closely as WPF's box model allows (`Margin`/`Padding` in pixels map directly to the
   `px` values in the mockup at 96 DPI).
3. Where WPF can't do something CSS does natively (backdrop-blur, CSS gradients used as
   glows, `position: sticky`), approximate with the nearest WPF idiom (see below) rather
   than dropping the effect.

## Key element concepts to replicate

- **Title bar** — fixed 44px height, dark panel background, app icon + name left, a
  "Focus" pill (see below) and search trigger center/right, small toggle chips
  (account / location / conservation mode) right-aligned. In WPF: a `Grid`-based
  `DockPanel` row, fixed `Height="44"`.
- **Left icon rail** — a narrow (46px) vertical strip of icon-only buttons, grouped with
  thin divider lines between groups, each button toggling a side panel. Active state =
  tinted background + colored border, not just an icon color change. In WPF: a
  `ItemsControl`/`ToggleButton` column with a `Style` keyed on `IsChecked`.
- **Collapsible side panels** (Chats / Git / Next Up / Epics) — fixed-width (~276px)
  flyout panels that slide in next to the rail, each with its own scrollable list and a
  header row. Next Up in particular groups issues by epic under "Critical Path" / "Other
  Epics" bands, with per-epic accent rails and a Gate banner that only appears once the
  critical epics are clear.
- **Build Queue panel** (right-docked, ~348px) — collapsible to a 40px icon rail; when
  collapsed, each queued build becomes a small colored icon with a hover flyout showing
  its status + progress bar. Expanded, it's grouped "Build Set" cards (colored header,
  tile icon, task count, chat link) each containing a vertical timeline of build cards
  with connector lines, status badges, and blocked-by chip links.
- **Build detail flyout** — slides out from the *left edge* of the Build Queue panel
  (320px, expandable to fill the document area and retract back). Contains a big red
  "Blocked" banner (only when blocked), an Epic callout, and three collapsible sections:
  Build Output (terminal-style log with `[tool: X]` tags), Description, and Comments
  (each comment collapses to its header row by default — click the row to expand/retract
  the whole body, not a "show more" link).
- **Claude chat pane** — deliberately mimics the real Claude.ai interface: warm
  near-black background (not the shell's navy), serif assistant text with no bubble,
  a dark rounded bubble for the user's own messages, coral inline-code styling, and a
  pill-shaped composer with `+`/mic icons. A context/progress bar sits above it showing
  epic stats and a context-usage fill that shifts blue→amber→red as it fills, revealing
  a "Start New Chat" button past ~75%. A "Detected Items" flyout (grouped, collapsible
  sections) lives inside this same dock.
- **Status bar** (bottom, 23px) — classic Windows/WPF status bar: flat segments,
  full-word labels (not abbreviations), thin vertical separators, monospace counts, a
  resize-grip glyph bottom-right. Hovering a segment slides up a small flyout listing the
  matching builds.
- **Focus nudge pill** (title bar) — shows the day's chosen objective epic. It *grows in
  width* through 6 escalating stages the longer that epic's queue sits quiet (on
  track → 10m → 15m → 30m → 45m → 60m+), each stage warmer in color and glow, the last
  stage widening to fill the space up to the search box and surfacing a non-blocking
  "Hey Shane, want to get back to it?" message with a jump-back link.
- **Inspector check-in flow** — a non-blocking floaty notice appears mid-chat 5 seconds
  before the inspector asks Claude something; 5 seconds later a translucent blur overlay
  locks the composer (matching the Build Queue's own "Paused" overlay treatment) until
  Claude responds.

## WPF approximations for CSS-only effects

| Web concept | WPF approach |
|---|---|
| `backdrop-filter: blur()` | `BlurEffect` on a background layer, or a semi-transparent `Border` if perf-sensitive |
| `box-shadow` glows (nudge pill, gate card) | `DropShadowEffect` with `ShadowDepth="0"` and the same color |
| CSS `transition` on width/color | `Storyboard` `DoubleAnimation`/`ColorAnimation`, same durations (150–500ms) |
| `position: sticky` (scroll-to-bottom button) | Anchor in a `Grid` row outside the `ScrollViewer`, or an `Adorner` |
| Hover flyouts (status bar, collapsed queue icons) | `Popup` with `PlacementMode.Top`, `StaysOpen="False"` |
| Collapsible sections | `Expander` with a custom `ControlTemplate` matching the chevron + header row style |
| Gradient context-bar fill | `LinearGradientBrush` or an animated `Rectangle` width, per the palette's stage colors |

## What not to carry over

- Don't invent new colors — every color in the mockup is in the palette doc. If something
  looks like it's missing, it's a rgba()-derived tint (usually a base color at ~10–20%
  opacity for a fill or badge) — recompute the tint from the base hex, don't guess a new one.
- The Claude chat pane's warm palette stays scoped to that pane only.
