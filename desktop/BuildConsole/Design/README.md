# Handoff: Visual Test Tracker — Docked Test Mode Redesign

## Overview
This redesigns BuildConsole's **Visual Test Tracker** — currently a floating WPF window (`VisualTestTrackerWindow`) that sits on top of the WebView2 — into a **docked three-pane Test Mode layout**: a collapsible left "Diagnostics" rail, the WebView2 centered, and a resizable right "Composer" pane. It also redesigns the tool's four spawned windows (API Helper, Visual Diff, Session History, Region Select) as consistent modal/overlay dialogs within the same visual language.

The app-level transition into "Test Mode" (hiding normal chrome, docking these panes around the WebView2) is being built separately in BuildConsole itself — this package only covers the Visual Test Tracker UI and its dialogs.

## About the Design Files
The bundled `Visual Test Tracker.dc.html` is a **design reference built in HTML/React** — a high-fidelity, interactive prototype showing exact layout, spacing, colors, copy, and behavior. It is **not production code to copy in**. The task is to **recreate this design as native WPF (XAML + C#)**, replacing the existing `VisualTestTrackerWindow` and its four companion windows, using BuildConsole's existing brush/style resources (`Themes/Colors.xaml`, `Themes/DarkTheme.xaml`, `IconButton`/`PrimaryButton`/`SecondaryButton`/`ToggleRadioButton` styles) rather than introducing new ones.

Open the `.dc.html` file in a browser to interact with it directly — every control in it is functional (state, not just visuals) so you can click through real flows (start a session, log a bug, pick a DOM element, run a scan, open each dialog) to see exact behavior before implementing.

## Fidelity
**High-fidelity.** Colors, spacing, copy, and interaction states are final. Build pixel-close to this using WPF's existing styles; where WPF layout constraints differ from CSS flex/grid, match the visual result rather than the markup structure.

## What Changed From the Current App
- The floating, always-on-top `VisualTestTrackerWindow` (490×720, draggable, pinnable to a screen corner) is replaced by a **docked right pane** that lives beside the WebView2 in Test Mode — no drag handle, no pin corner, no mini mode, no HUD opacity/auto-hide (opacity/auto-hide controls move into a left-panel section, see below, since the pane no longer floats over the page).
- Everything the tester uses **constantly** (session strip, bug composer, screenshot actions, bug list) moved to the **right pane**.
- Everything used **occasionally** (telemetry badges, DOM Inspector, Accessibility Audit, DOM Mutation tracker, DevTools Runner, HUD Options, the API Helper entry point) moved to a **collapsible left pane**, collapsed to a 48px icon rail by default.
- The center is reserved entirely for the live WebView2.

## Screens / Views

### 1. Left Panel — Diagnostics (collapsed / expanded)
**Purpose:** Houses secondary diagnostic tools so they don't compete with the composer for space; collapses to icons when not in use.

**Layout — collapsed (default), 48px wide:**
- Full height, `background:#0d1117`, `border-right:1px solid #30363D`.
- 34px header strip with just a chevron-right toggle (right-aligned in the 48px rail).
- Vertical icon rail, 32×32px hit targets, gap 3px, centered: DOM Inspector (search icon), Accessibility Audit (scan-eye icon), DOM Mutations (activity icon), DevTools Runner (terminal icon), HUD Options (sliders-horizontal icon), API Helper (zap icon, accent-colored `#7C8CF0`).
- Clicking any diagnostic icon expands the panel to 300px and opens that section. Clicking the API Helper icon opens the API Helper dialog directly (it doesn't expand the panel).

**Layout — expanded, 300px wide:**
- Header strip: "DIAGNOSTICS" label (10px, 800 weight, uppercase, `#8B949E`, letter-spacing .11em) + collapse chevron.
- Telemetry badge row (wraps): pill badges for Errors (red `#DC8A8A`), Net Fail (amber `#D4A56C`), Perf ms (blue `#79B3C8`), Events (gray `#8B949E`), a11y count, DOM Δ count, CDP status — each a 6px-radius pill, 1px tinted border, icon + label, font-size 9.5px/700.
- **Accordion** (border `#21262d`, radius 8px, one section open at a time): DOM Inspector, Accessibility Audit, DOM Mutations, DevTools Runner, HUD Options. Each header row is 8px/9px padding, icon + 11px/700 label + chevron; active row background `#161b22`.
  - **DOM Inspector body:** picked-element readout (tag name monospace, dimensions, a11y badge colored green `#8FC496` if OK or amber `#D4A56C` if flagged), selector string in muted monospace, "Pick Element"/"Pick Another" button (crosshair icon), "+ Add to Repro Steps" / "+ Add to Notes" text links (accent blue `#58A6FF`) once an element is picked.
  - **Accessibility Audit body:** issue count summary line, "Rescan" button, "+ Add to Bug Report" link (accent tinted) that only appears once issues are found.
  - **DOM Mutations body:** mutation count summary, "Baseline Snapshot" + "Diff Snapshot" buttons, "+ Add to Repro Steps" link once mutations are counted.
  - **DevTools Runner body:** monospace command textarea (2 rows) + "Run (Enter)" button, a scrollable command/result history (max 5, command in blue `#79B3C8`, result in green `#8FC496`), "📎 Attach last result to bug" link.
  - **HUD Options body:** Opacity range slider (30–100%) with live percentage readout; "Auto-hide when idle" checkbox.
- Below the accordion: **API Helper** entry row — zap icon in accent color, "API Helper" label (11px/700) + "Opens companion window" caption (9px, `#7D8590`); opens the API Helper dialog.

### 2. Right Panel — Composer, 420px default / 540px widened
**Purpose:** The tester's primary, always-visible working surface.

**Session strip (top, fixed, `border-bottom:1px solid #21262d`):**
- Row 1: 8px status dot (green `#8FC496` when a session is active, amber `#D4A56C` when idle) + route text (monospace 11px, `#8B949E`; reads "No tracked tab active — navigate a watched tab" when idle) + Copy-URL icon button + a panel-width toggle (chevron) that switches the pane between 420px and 540px.
- Row 2: Timer chip (clock icon + "Page/Session 00:00", click toggles which timer is shown) · "End Session & Sync" primary button (accent fill `#7C8CF0`, send icon) · New Session / History / Clear icon buttons (24×24, bordered).
- Row 3: "Good (confirmed clean)" checkbox — **disabled** (grayed, `cursor:not-allowed`) whenever any bug on the page is still Open, matching the source app's rule — and "Auto-clear on new session" checkbox.
- Inline status line (green, 10px) appears transiently below the checkboxes for confirmations ("Bug entry saved", "URL copied", etc.) — equivalent to the source app's `InlineMessage`.

**Composer (scrollable middle):**
- "LOG ISSUE / BUG ENTRY" label (accent, 9.5px/800/uppercase) + "✓ Saved" auto-save indicator, right-aligned.
- Severity `<select>`: Blocker / Critical / Bug (default) / UI Glitch / Functional / Low.
- Page Notes / Global Notes segmented toggle.
- Markdown mini-toolbar (Bold, Italic, Code, Bullet List, Link, Preview-eye) above the notes field.
- **Notes textarea — the primary field.** 8 rows, 12px text, always visible (this is the fix for the earlier cut where notes hid behind a read-only preview toggle — do not replicate that mistake: the editor must stay visible and editable at all times). Pressing Enter on a line that starts with `- ` continues the list with a fresh `- `; pressing Enter again on an empty `- ` line removes it and exits list mode (VS Code / Notion-style continuation).
- When "Preview" is toggled on, a **rendered markdown preview renders below the textarea** (bold/italic/inline-code/links/bullets), not in place of it.
- "Auto-link shots" checkbox.
- Tags text input + 6 quick-tag chips (Auth, UI, API, Checkout, Performance, Form) that append to the tags field on click.
- Collapsed-by-default expander: "Steps to Reproduce · Expected · Actual" — three fields (Steps has its own "+ Add Step" auto-numbering helper) once expanded.
- Screenshot action row: Full / Region / HUD / Diff / Inspect — 5 equal-width buttons, icon + label. "Inspect" jumps focus to the left panel's DOM Inspector section (cross-panel shortcut) rather than duplicating that tool.
- Staged screenshot strip — only rendered when at least one screenshot is staged; each shows a camera icon, filename, and a remove (×) control.

**Bottom-fixed save row:** "Save Bug Entry (Ctrl+Enter)" primary button (disabled state not needed — validation is on click: requires notes text or a staged screenshot) + "Clear" secondary button.

**Bug List — its own collapsible drawer** at the very bottom (not part of the scrolling composer): header "BUG LIST (n)" with chevron; when open shows All/Open/Resolved filter chips, one card per bug (status pill, severity badge — color-coded per severity, relative timestamp, summary text, tag chips, Resolve/Reopen + Copy MD + Delete actions), an empty state ("No bug entries for this page yet.") when there are none, and Export-to-/Bugs/ + Copy-Report buttons.

### 3. Center — WebView2
Just the live web app. No chrome from this tool; a placeholder/backdrop pattern here is prototype-only.

### 4. Spawned Dialog — API Helper
Modal, ~440px wide, centered over the whole window, dark card (`#161b22`, 1px `#30363D` border, 6px radius) with drop shadow. Header strip (`#0d1117`) with zap icon + title + close (×). "Target Page" context strip (`#30363D` background) showing the active route or "No active page connected". Three stacked sections, each its own bordered card (`#0d1117` fill):
1. **Create Test Account (Bypass Payments)** — explanatory line, Email input + "Random" button, Password + Display Name side-by-side, Associated Tenant + RBAC Role selects side-by-side, full-width primary "Create Test Account via API" button.
2. **Page Actions (Active Browser Tab)** — "Fill Login Form" / "Fill & Submit Login" side-by-side, full-width "Direct Login (Bypass Form & Navigate)", "Go to /portal-v2" / "Copy Credentials" side-by-side.
3. **Recent Test Accounts** — header + "Clear" link; list of created accounts (email, tenant, role, relative time) or "No recent test accounts yet." empty state.

### 5. Spawned Dialog — Visual Diff & Screenshot Comparison
Large modal (~1100×760 max, scales to viewport), dark title bar with a page-URL chip and close button. Below it: a **Baseline** selector column (label, Browse…, "⭐ Set Current as Baseline", dropdown) beside a **Current** selector column (label, Browse…, dropdown) — Baseline labeled in accent purple `#7C8CF0`, Current labeled in green `#8FC496` throughout the dialog, matching the source app's color convention for these two roles. Below that: a segmented view-mode control (Side-by-Side / Swipe-Split-Slider / Difference Heatmap) plus a stats badge ("Select a baseline and current screenshot to compare." in the empty state). Main display area fills the remaining height and swaps per mode — side-by-side shows two labeled panes ("BASELINE" / "CURRENT" chips), each an empty state until screenshots are chosen; swipe and heatmap modes show their own empty-state copy. Bottom bar: Zoom slider + %, "Sync Scroll" checkbox, Tolerance slider + %, then "Attach Diff to Bug" (primary), "Copy Summary", "Save Diff Map", "Close".

### 6. Spawned Dialog — Session History & Audit Trail
Modal, 560px wide. Header with history icon + title + close. A 4-column metrics strip (`#30363D` background): Total Sessions (accent), Testing Time, Bugs Found (amber), Confirmed Clean (green) — each an 8px uppercase label over a 14px/800 value. Scrollable session list below: one card per past session (route in monospace, duration + bug count, a "Confirmed clean" pill when applicable) or the empty state "No recorded test sessions yet. As you navigate and test pages, sessions are automatically logged here." Footer: "Copy History (Markdown)" on the left, "Clear All" + primary "Close" on the right.

### 7. Spawned Overlay — Region Select
Full-screen dim overlay (`#00000066`), crosshair cursor, instruction chip top-left ("Drag to select a region — Esc or right-click to cancel"). In the real app this is a live drag-to-draw rectangle; the design shows the drawn state: an accent-bordered, accent-tinted rectangle with "Use This Selection" (primary) and "Cancel" (secondary) buttons anchored just below it. Esc or right-click cancels without staging a screenshot, matching the current `RegionSelectOverlayWindow` behavior.

## Interactions & Behavior
- **Left panel:** collapse/expand is a width transition (48px ⇄ 300px), not a separate window. Accordion sections are mutually exclusive (opening one closes any other that was open).
- **Right panel width:** toggles 420px ⇄ 540px via the header chevron, independent of the left panel.
- **Good checkbox disable rule:** disabled whenever any bug on the current page has status "Open" — carried over verbatim from the existing app's `GoodCheckBox` logic.
- **Session timer:** ticks once per second while a session is active; clicking the timer chip swaps the label between "Page" and "Session" (the two accumulation modes already in `VisualTestTrackerSession`).
- **Ending a session** appends a record (route, duration, bug count, clean flag) to Session History and resets the route/timer — this is how the History dialog gets populated; it is not pre-seeded with fake data.
- **DOM Inspector "Pick Element"** cycles through the currently-picked element's data; "Add to Repro Steps"/"Add to Notes" append formatted text into the corresponding fields and bump the Events telemetry count.
- **Notes markdown toolbar:** Bold/Italic/Code/List/Link buttons insert markdown syntax at the end of the notes text (simplest reliable behavior without a rich-text control); Enter-to-continue-list is handled specially (see Screen 2).
- **Screenshot actions:** Full/HUD stage a screenshot chip immediately; Region opens the fullscreen Region Select overlay first, and only stages a shot when the user confirms "Use This Selection"; Diff and Inspect open their respective dialog/section instead of staging anything.
- **All empty/zero states are intentional**, not placeholders to fill in: errors, net-fail count, and perf ms stay at `0`/`--` until a real WebView2/CDP session supplies them — do not hardcode sample numbers in the WPF rebuild.

## State Management
Carry over the existing services/models as-is; this redesign only changes presentation:
- `VisualTestTrackerSession` — session id, route, elapsed seconds (page vs. session), active flag.
- `VisualTestTrackerEntry` — bug fields (severity, status, notes, steps/expected/actual, tags, screenshots, console logs, network failures, repro events, timestamps) per the schema in the original contract (`Services/VisualTestTrackerEntry.cs`).
- `VisualTestTrackerDraftStore` — debounced autosave of the composer draft; the "✓ Saved" indicator in the header reflects this.
- `VisualTestTrackerTelemetry` — console/network/perf/a11y/mutation counters feeding the left-panel badges.
- New UI-only state for this redesign: left panel expanded/collapsed + active accordion section; right panel width; which of the four dialogs is open.

## Design Tokens
Pulled directly from BuildConsole's existing `Themes/Colors.xaml` (the original contract's token table) — reuse these `StaticResource` brushes, don't hardcode new hex values in XAML:

| Token | Hex | Role |
|---|---|---|
| MantleBrush | `#161B22` | Dialog/card surface |
| CrustBrush | `#0D1117` | Header strips, deepest background |
| BaseBrush | `#1C2128` | Composer background |
| Surface0Brush | `#30363D` | Borders, dividers |
| Surface1Brush | `#484F58` | Input borders, hover outlines |
| TextBrush | `#E6EDF3` | Primary text |
| Subtext0Brush | `#8B949E` | Secondary labels |
| Subtext1Brush | `#7D8590` | Placeholder / muted |
| AccentBrush | `#7C8CF0` | Primary actions, active states |
| StatusSuccessBrush | `#8FC496` | Clean / resolved / "Current" |
| StatusErrorBrush | `#DC8A8A` | Blocker severity, error counts |
| StatusWarningBrush | `#D4A56C` | Critical severity, warnings |
| StatusRunningBrush | `#79B3C8` | Perf badge, running state |
| BlueBrush | `#58A6FF` | Text links |

Typography: Inter (UI text), Consolas (routes, selectors, code, timers). Radii: 5–8px on cards/inputs, 99px (pill) on badges/chips. Spacing follows a 4px base step, consistent with the rest of BuildConsole.

## Assets
No new image assets. Icons are line icons (Lucide-equivalent glyphs) — map to whatever icon set BuildConsole's `Resources/Icons.xaml` already uses; do not introduce a second icon library.

## Files
- `Visual Test Tracker.dc.html` — the full interactive design (open in any browser).
- `screenshots/01-default-collapsed.png` — right panel default state, left panel collapsed.
- `screenshots/02-left-panel-expanded.png` — left panel expanded, Accessibility Audit section open.
- `screenshots/03-api-helper-dialog.png`
- `screenshots/04-visual-diff-dialog.png`
- `screenshots/05-session-history-dialog.png`
- `screenshots/06-region-select-overlay.png`

### Existing WPF files this design replaces
- `BuildConsole/VisualTestTrackerWindow.xaml` + `.xaml.cs` — replace with the docked left/right panel layout (Screens 1–3).
- `BuildConsole/ApiHelperWindow.xaml` + `.xaml.cs` — restyle per Screen 4 (same fields/actions, new chrome).
- `BuildConsole/VisualDiffWindow.xaml` + `.xaml.cs` — restyle per Screen 5.
- `BuildConsole/SessionHistoryDialog.xaml` + `.xaml.cs` — restyle per Screen 6.
- `BuildConsole/RegionSelectOverlayWindow.xaml` + `.xaml.cs` — restyle per Screen 7 (keep its drag-rectangle input logic; only the visual chrome/instruction chip changes).
- Services (unchanged logic, new consumers): `VisualTestTrackerSession.cs`, `VisualTestTrackerEntry.cs`, `VisualTestTrackerDraftStore.cs`, `VisualTestTrackerCapture.cs`, `VisualTestTrackerExportService.cs`, `VisualTestTrackerTelemetry.cs`, `VisualTestTrackerApiClient.cs`, `VisualTestTrackerStore.cs`, `VisualTestTrackerSessionSyncService.cs`.
