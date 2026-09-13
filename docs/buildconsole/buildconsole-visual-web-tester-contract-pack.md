# BuildConsole Visual Web Tester & Visual Test Tracker — Design Contract Pack

> **Notice for UI Designers (e.g., Claude Design, Figma, Design Tools)**
> This document is the authoritative specification for the **Visual Web Tester** (implemented as `VisualTestTrackerWindow` and its companion diagnostic services) in **BuildConsole**.
> Every field, status string, enum value, color token, button, tooltip, keyboard shortcut, diagnostic drawer, and interaction documented below was extracted directly from the working C#/.NET 8 WPF codebase under `desktop/BuildConsole/` — cited to exact `file:line` references.
>
> You have **full creative freedom over visual appearance** (layout density, typography hierarchy, card styling, HUD glassmorphism, micro-animations, and aesthetic treatments).
> You have **zero freedom over what data exists**: every field, telemetry counter, severity level, diagnostic signal, and export format is backed by real runtime code. Do not invent fields or fabricate placeholder data. If a signal is not available, it renders honestly as `0`, `--`, or an empty state.

---

## 1. Scope & Mental Model

The **Visual Web Tester** (`VisualTestTrackerWindow`) is an interactive, developer-grade quality assurance and visual telemetry HUD built into BuildConsole. It floats over or docks beside live web applications running inside Microsoft WebView2 (such as the Customer Portal, Admin Panel, MSP Console, and Marketing sites).

```
  ┌───────────────────────────────────────────────────────────────────────┐
  │                           LIVE WEB APPLICATION                         │
  │               (WebView2: Portal, Admin, MSP Console, etc.)            │
  └───────────────────────────────────────────────────────────────────────┘
                                     ▲
                     DOM / CDP / Telemetry / Actions
                                     ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │                 VISUAL WEB TESTER (FLOATING HUD WINDOW)               │
  │  ┌─────────────────────────────────────────────────────────────────┐  │
  │  │ Header Strip: Drag · Title · API Helper · Pin · HUD · Mini · ✕  │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ HUD Options Drawer: Opacity (30%-100%) · Auto-Hide on Idle     │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Session Strip: Pulse · Route · Copy URL · Timer · End & Sync    │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Composer: Auto-Save · Severity · Notes Tabs · MD · Tags · Repro │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Telemetry Strip: Errors · Net · Perf · Events · a11y · DOM · CDP│  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Action Strip: Full Shot · Region · HUD Shot · Diff · Inspect    │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Diagnostic Drawers: DOM Inspector · a11y · Mutations · Runner   │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Staged Screenshots Bar: Thumbnail Strip & Removal               │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Save Action: [ 💾 Save Bug Entry (Ctrl+Enter) ] · [ Clear ]     │  │
  │  ├─────────────────────────────────────────────────────────────────┤  │
  │  │ Bug List Section: Filter (All/Open/Resolved) · Export to /Bugs/ │  │
  │  └─────────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────────────┘
                                     │
                     Export Artifacts & Git Sync
                                     ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │           LOCAL REPOSITORY ARTIFACTS (/Bugs/<Area>/<SessionId>/)      │
  │           - Structured JSON documents & Markdown summaries            │
  │           - PNG screenshot attachments & region crops                 │
  │           - Console error stacks, network HAR logs, repro steps       │
  │           - Auto-committed & pushed to Git for Claude/Agent ingestion │
  └───────────────────────────────────────────────────────────────────────┘
```

### Core Responsibilities
1. **Live Route & Session Auditing**: Tracks the currently active web route (`PagePath`), base URL, page title, session duration, and "confirmed clean" verification status.
2. **Crash-Safe Keystroke Auto-Save**: All composer drafts (notes, steps, expected vs. actual, severity, tags) persist across route changes, window minimizes, or application crashes into a debounced local store (`drafts.json`).
3. **Automated Diagnostic Attachment Collection**: When an issue is logged, the engine automatically packages:
   - Full-page or region-cropped screenshots.
   - Captured browser console logs, warnings, and unhandled exceptions with full stack traces.
   - Network failure logs (HTTP 4xx/5xx, timing durations, payload sizes).
   - Core Web Vitals and performance signals (Page Load, TTFB, DOMContentLoaded, LCP, FCP).
   - Automated reproduction event breadcrumbs (user clicks, inputs, submits, navigations).
4. **Developer Tools & In-Page Inspection Drawers**:
   - **DOM Inspector**: Inspect elements live via Chrome DevTools Protocol (CDP), copy unique CSS selectors or OuterHTML, and paste directly into reproduction steps.
   - **Accessibility (a11y) Auditor**: Scans the page for WCAG 2.1 AA violations (missing alt text, color contrast ratios, ARIA attribute misuse) with visual in-page badge overlays.
   - **DOM Mutation Tracker**: Real-time recording of dynamic DOM modifications with snapshot baselines.
   - **DevTools Command & Network Runner**: Execute JavaScript snippets with history and recall, or fire raw HTTP/curl/fetch requests inheriting the page's authenticated session cookies.
5. **Session Finalization & Agentic Git Sync**: Concludes test sessions, bundles all artifacts into `/Bugs/<Area>/<SessionId>/`, and commits/pushes to Git for agentic pairing.

---

## 2. File & Component Index

| Component / Service | File Path | Role |
| :--- | :--- | :--- |
| **Visual Tester Window** | `desktop/BuildConsole/VisualTestTrackerWindow.xaml` | Primary XAML shell, HUD drawer, composer, telemetry badges, diagnostic drawers, and bug list. |
| **Window Code-Behind** | `desktop/BuildConsole/VisualTestTrackerWindow.xaml.cs` | Controller logic, event handling, keyboard shortcuts, WebView2 integration, and timer loops. |
| **Entry Model & Markdown Engine** | `desktop/BuildConsole/Services/VisualTestTrackerEntry.cs` | Data models for bug entries, console logs, network failures, reproduction steps, and GitHub/Jira Markdown generator. |
| **Session Model & Store** | `desktop/BuildConsole/Services/VisualTestTrackerSession.cs` | Session state, elapsed duration timers, and `%AppData%` session persistence. |
| **Screenshot Capture Engine** | `desktop/BuildConsole/Services/VisualTestTrackerCapture.cs` | Browser-level `CoreWebView2.CapturePreviewAsync` for full-page and region captures without OS freezing. |
| **Export & Git Sync Engine** | `desktop/BuildConsole/Services/VisualTestTrackerExportService.cs` | Area detection (ports 5173-5177), JSON serialization, file copying, and Git commit & push. |
| **Draft Store** | `desktop/BuildConsole/Services/VisualTestTrackerDraftStore.cs` | Crash-safe keystroke auto-save persistence (`drafts.json`). |
| **Telemetry & CDP Service** | `desktop/BuildConsole/Services/VisualTestTrackerTelemetry.cs` | Chrome DevTools Protocol hooks for console logging, network interception, performance timing, and breadcrumbs. |
| **API Helper Window** | `desktop/BuildConsole/ApiHelperWindow.xaml(.cs)` | Companion dialog for generating test accounts, seed data, and executing page automation. |
| **Region Crop Overlay** | `desktop/BuildConsole/RegionSelectOverlayWindow.xaml(.cs)` | Transparent fullscreen canvas for interactive rectangular screen snips. |
| **Visual Diff Window** | `desktop/BuildConsole/VisualDiffWindow.xaml(.cs)` | Side-by-side, swipe slider, and diff heatmap viewer comparing baseline screenshots. |
| **Session History Dialog** | `desktop/BuildConsole/SessionHistoryDialog.xaml(.cs)` | Historical audit log viewer for previous test runs. |

---

## 3. Window Shell, HUD Ergonomics & Geometry

### 3.1 Dimensions & Window Properties
Cited from `VisualTestTrackerWindow.xaml:1-20`:
- **Default Width**: `490px` (Resizable from `MinWidth="380"`)
- **Default Height**: `720px` (Resizable down to `MinHeight="110"` in Mini mode)
- **Window Style**: `WindowStyle="None"`, `AllowsTransparency="True"`, `ResizeMode="CanResizeWithGrip"`
- **Window Behavior**: `Topmost="True"`, `ShowInTaskbar="False"` (operates as a persistent floating diagnostic HUD)
- **Container Styling**: Border `CornerRadius="6"`, Background `{StaticResource MantleBrush}`, Border `{StaticResource Surface0Brush}`

### 3.2 Global Keyboard Shortcuts
Cited from `VisualTestTrackerWindow.xaml.cs:Window_PreviewKeyDown`:
| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **Ctrl + Enter** | Save Bug Entry | Validates notes/draft and commits the bug entry to the active page store. |
| **Ctrl + Shift + P** | Cycle Pin Corner | Cycles floating HUD docking: `TopRight` → `BottomRight` → `BottomLeft` → `TopLeft` → `None`. |
| **Ctrl + Shift + M** | Toggle Mini Mode | Toggles between compact 110px floating mini-bar and full workspace. |
| **Ctrl + Shift + U** | Copy Page URL | Copies the active WebView2 page URL to clipboard. |
| **Ctrl + Shift + F** | Full-Page Screenshot | Captures full scrollable height of the active WebView2 page. |
| **Ctrl + Shift + S** | Region Screenshot | Launches region select overlay for a targeted snip. |
| **Ctrl + Shift + W** | Capture HUD / Window | Captures the full WPF application window including active HUD overlays. |
| **Ctrl + Shift + I** | Toggle DOM Inspector | Launches in-page element picker via CDP. |
| **Ctrl + Shift + C** | Copy Console Errors | Copies all captured JavaScript errors, unhandled rejections, and stack traces. |

---

## 4. Header Strip & HUD Options Drawer

### 4.1 Header Strip Controls (`VisualTestTrackerWindow.xaml:30-103`)
Located in Grid Row 0, styled with Background `{StaticResource CrustBrush}` and `CornerRadius="6,6,0,0"`.

| Element | Name | Visual Appearance | Function / Tooltip |
| :--- | :--- | :--- | :--- |
| **App Icon** | — | `📷` (FontSize 13) | Visual Web Tester brand glyph. |
| **Title** | — | `Visual Test Tracker` (SemiBold 12pt) | Window title and primary drag handle (`MouseLeftButtonDown`). |
| **API Helper** | `BtnApiHelper` | `⚡ API Helper` (AccentBrush) | Opens `ApiHelperWindow` to seed test users, bypass logins, and fire dev endpoints. |
| **Pin Corner** | `BtnPinCorner` | `📌 Pin` | Cycles HUD screen anchor (`TopRight`, `BottomRight`, `BottomLeft`, `TopLeft`, `None`). |
| **HUD Options** | `BtnHudOptions` | `🎛 HUD` | Toggles the HUD Options Drawer (Row 1). |
| **Mini Toggle** | `BtnToggleCollapse` | `▲ Mini` (or `▼ Full`) | Toggles compact floating HUD mode (`_isCollapsed`). |
| **Close** | `BtnClose` | `✕` | Closes the floating window. |

### 4.2 HUD Options Drawer (`VisualTestTrackerWindow.xaml:106-143`)
Collapsible drawer in Grid Row 1 for adjusting opacity and idle behaviors:
- **Opacity Slider** (`SliderOpacity`): Range `0.3` to `1.0` (30% to 100%, default `1.0`). Adjusts window opacity to prevent obscuring the web application underneath. Smart hover behavior automatically restores 100% opacity when the mouse enters the window (`Window_MouseEnter`).
- **Opacity Readout** (`TxtOpacityPercent`): Real-time percentage display in monospace (`100%`).
- **Auto-Hide Checkbox** (`ChkAutoHide`): `"Auto-hide when idle"`. When checked, dims the HUD to 20% opacity after 3 seconds of mouse inactivity; wakes up immediately on hover.

---

## 5. Session Indicator & Route Strip

Located in Grid Row 2 (`VisualTestTrackerWindow.xaml:145-267`), Background `{StaticResource Surface0Brush}`.

### 5.1 Top Row Controls
- **Session Pulse Dot** (`SessionPulseDot`): `8×8` ellipse.
  - 🟢 Green (`{StaticResource StatusSuccessBrush}`) when active page tracking is connected.
  - 🟡 Amber (`{StaticResource StatusWarningBrush}`) when idle or disconnected.
- **Route Display** (`SessionIndicatorText`): Monospace font (`Consolas`, 11pt, SemiBold). Displays active route (e.g., `/portal/dashboard`, `/login`, `/admin/users`) or `"No tracked tab active — navigate a watched tab"`.
- **Copy URL** (`BtnCopyUrl`): `🔗` button. Copies current URL to clipboard.
- **Stopwatch Timer** (`BtnToggleTimerMode` / `SessionTimerText`): Displays elapsed time (`⏱ 00:00`). Clicking toggles between **Page Time** (time on current route) and **Session Time** (cumulative test session duration).
- **End Session & Sync** (`BtnEndSessionSync`): `🚀 End Session & Sync` (Bold AccentBrush). Finalizes the session, packages all artifacts under `/Bugs/<ProductName>/<SessionId>/`, and commits & pushes to Git.
- **New Session** (`BtnNewSession`): `▶ New Session`. Archives active session and initializes a clean testing session.
- **Session History** (`BtnSessionHistory`): `📜 History`. Opens the session audit dialog.
- **Clear Session** (`BtnClearSession`): `🧹 Clear`. Resets current draft fields, staged screenshots, and telemetry buffers.

### 5.2 Status Flags & Inline Banner
- **Good Checkbox** (`GoodCheckBox`): `"Good (confirmed clean)"`. Marks the current route as verified with zero defects. Disabled when unaddressed bug entries exist for the page.
- **Auto-Clear Checkbox** (`ChkAutoClear`): `"Auto-clear on new session"`. Automatically wipes draft text when transitioning sessions.
- **Inline Message** (`InlineMessage`): Transient status readout for auto-save notifications and clipboard confirmations.

---

## 6. Draft & Bug Entry Composer

Located in `MainWorkspaceGrid` Row 0 (`VisualTestTrackerWindow.xaml:276-555`), Background `{StaticResource BaseBrush}`.

### 6.1 Composer Header & Severity Selector
- **Section Label**: `"LOG ISSUE / BUG ENTRY"` (Bold 10pt AccentBrush).
- **Auto-Save Indicator** (`AutoSaveIndicator`): Displays `"✓ Saved"` (or `"Saving..."` during debounce). Confirms persistence to `drafts.json`.
- **Severity Dropdown** (`CmbSeverity`):
  | Severity | Code Value | Typical Use Case |
  | :--- | :--- | :--- |
  | **Blocker** | `Blocker` | System crash, blank screen, data loss, build halt. |
  | **Critical** | `Critical` | Core flow broken (auth failure, payment error). |
  | **Bug** | `Bug` | Standard defect (default selection). |
  | **UI Glitch** | `UI Glitch` | Alignment error, font clipping, color mismatch. |
  | **Functional** | `Functional` | Minor feature anomaly, non-blocking logic flaw. |
  | **Low** | `Low` | Polish recommendation, cosmetic tweak. |

### 6.2 Notes Scoping & Markdown Toolbar
- **Notes Mode Switcher**:
  - `BtnTabNotesPage`: `📄 Page Notes` — Scoped strictly to the active URL/route.
  - `BtnTabNotesGlobal`: `🌐 Global Notes` — Cross-cutting scratchpad shared across all pages and sessions.
- **Markdown Quick Format Bar**:
  - `B`: Bold (`**text**`)
  - `I`: Italic (`*text*`)
  - `` ` ``: Inline code (`` `code` ``)
  - `•`: Bullet list (`- item`)
  - `🔗`: Markdown hyperlink (`[title](url)`)
  - `👁` (`BtnTogglePreview`): Toggles live formatted Markdown preview.
- **Auto-Link Checkbox** (`AutoLinkShotsCheckBox`): `"Auto-link shots"`. When checked, capturing a screenshot automatically appends `![screenshot](<path>)` directly into the Notes editor.
- **Notes Editor** (`NotesBox`): Multiline text box supporting full GitHub Flavored Markdown. Keystroke-debounced auto-save.
- **Markdown Preview Container** (`NotesPreviewContainer`): Live rendering panel displayed when preview mode is toggled.

### 6.3 Tags & Categorization
- **Tags Input** (`TagsBox`): Comma-separated tags (e.g., `Auth, Checkout, Navigation`).
- **Quick Tag Chips**: Single-click buttons that append standard hashtags:
  - `+ #Auth`
  - `+ #UI`
  - `+ #API`
  - `+ #Checkout`
  - `+ #Performance`
  - `+ #Form`

### 6.4 Structured Diagnostic Fields (Collapsible Expander)
Under `DetailsExpander` (`VisualTestTrackerWindow.xaml:421-497`):
- **Steps to Reproduce** (`StepsBox`): Numbered step-by-step reproduction guide.
  - `+ Add Step` (`BtnAddStep`): Automatically computes and appends the next step number (`1. `, `2. `, etc.).
  - `📥 Import Auto Steps` (`BtnImportAutoSteps`): Converts recorded user clicks, key inputs, and form submissions from the telemetry buffer into editable reproduction steps.
- **Expected Behavior** (`ExpectedBox`): Multi-line field describing intended behavior.
- **Actual Behavior** (`ActualBox`): Multi-line field describing observed anomaly.

---

## 7. Live Telemetry & Screenshot Action Strip

### 7.1 Real-Time Telemetry Badges (`VisualTestTrackerWindow.xaml:500-555`)
Presents continuous live diagnostics captured from WebView2:
- `TelemetryConsoleBadge`: `🔴 N errors` — Count of JavaScript runtime exceptions and console errors.
- `BtnCopyConsoleErrors`: `📋 Errors` — One-click copy of all console error messages with stack traces.
- `TelemetryNetworkBadge`: `⚡ N net fail` — Count of HTTP 4xx/5xx network responses or dropped requests.
- `TelemetryPerfBadge`: `⏱ Nms` — Page load time and Largest Contentful Paint (LCP).
- `TelemetryEventsBadge`: `👣 N events` — Count of tracked user interaction breadcrumbs.
- `BtnA11yAudit`: `♿ a11y (N)` — Count of WCAG accessibility violations; opens the a11y drawer.
- `BtnDomChanges`: `⚡ DOM Δ (N)` — Count of active DOM mutations; opens mutation drawer.
- `BtnDevToolsRunner`: `💻 Runner` — Opens the DevTools JavaScript & API runner drawer.
- `TelemetryCdpBadge`: `🌐 CDP Active` — Confirms Chrome DevTools Protocol session is attached.
- `TelemetryEnvBadge`: `Auto-Metadata Ready` — Confirms auto-collection of URL, OS, Viewport, and User Agent on save.

### 7.2 Screenshot & Visual Action Buttons (`VisualTestTrackerWindow.xaml:558-610`)
Five primary diagnostic triggers:
1. `BtnCaptureFull` (`📷 Full`): Captures full scrollable page height via `CapturePreviewAsync`.
2. `BtnCaptureRegion` (`✂ Region`): Opens fullscreen dimmed canvas (`RegionSelectOverlayWindow`) allowing rectangular click-and-drag selection.
3. `BtnCaptureWpfWindow` (`🪟 HUD`): Captures the complete desktop application window including all active HUD overlays.
4. `BtnVisualDiff` (`⚖️ Diff`): Launches `VisualDiffWindow` for comparing current screenshots against baselines (side-by-side, swipe split slider, difference heatmap).
5. `BtnInspectDom` (`🔍 Inspect`): Launches the interactive in-page element picker.

---

## 8. Diagnostic & Inspection Drawers (Deep Dives)

### 8.1 DOM Inspector Drawer (`VisualTestTrackerWindow.xaml:613-715`)
Activated via `BtnInspectDom` or `Ctrl+Shift+I`. Allows inspecting live DOM elements inside WebView2:
- **Header**: Element Tag (`TxtDomElementTag`, e.g., `<BUTTON>`), Element Dimensions (`TxtDomDimensions`, e.g., `120 × 36 px`), Accessibility Badge (`TxtDomA11yBadge`, e.g., `♿ a11y: OK` or `⚠ missing-alt`), and `🔍 Pick Another` button.
- **Selector Field** (`TxtDomSelector`): Read-only unique CSS selector. Includes `📋 Sel` (copy selector) and `📋 Copy Both` (copies selector + outer HTML).
- **OuterHTML Field** (`TxtDomOuterHtml`): Sanitized HTML snippet of the selected element. Includes `📋 HTML` copy button.
- **Integration Actions**:
  - `BtnInsertDomToSteps`: `+ Add to Repro Steps` — Formats element action (e.g., `Click button "Sign In" (button.primary-btn)`) directly into the Steps to Reproduce field.
  - `BtnInsertDomToNotes`: `+ Add to Notes` — Appends element selector and HTML blockquote into Notes.

### 8.2 Accessibility Audit Drawer (`VisualTestTrackerWindow.xaml:718-771`)
Activated via `BtnA11yAudit`. Runs an in-page WCAG 2.1 AA compliance audit:
- **Summary Count** (`TxtA11ySummaryCounts`): e.g., `4 Issues (2 Critical, 2 Warning)`.
- **Category Filter Chips**:
  - `All`
  - `Missing Alt (N)`: Images and SVGs lacking `alt` or `aria-label`.
  - `Contrast (N)`: Text elements with color contrast ratio below 4.5:1 (normal) or 3:1 (large text).
  - `ARIA (N)`: Invalid ARIA roles, unreferenced `aria-labelledby`, or broken focus traps.
- **Violations List** (`A11yIssuesContainer`): Scrollable list of violations showing selector, offending value, and recommended remediation.
- **Action Buttons**:
  - `BtnAddA11yToBug`: `+ Add to Bug Report` — Injects detected violations into the active bug draft.
  - `BtnToggleA11yMarkers`: `👁️ Markers` — Injects high-visibility visual callout badges directly onto offending elements in the live web page.
  - `BtnRescanA11y`: `🔄 Rescan` — Re-runs the compliance scan.

### 8.3 DOM Mutation Tracker Drawer (`VisualTestTrackerWindow.xaml:774-812`)
Activated via `BtnDomChanges`. Tracks live dynamic modifications to the DOM tree:
- **Summary Count** (`TxtDomChangesSummary`): e.g., `12 mutations`.
- **Snapshot Controls**:
  - `BtnDomTakeSnapshot`: `📸 Baseline Snapshot` — Freezes current DOM state as baseline.
  - `BtnDomDiffSnapshot`: `🔍 Diff Snapshot` — Computes DOM tree additions, removals, and attribute mutations since baseline.
  - `BtnClearDomChanges`: `🗑️ Clear` — Resets mutation buffer.
- **Action Button**: `BtnAddDomChangesToSteps` (`+ Add Mutations to Repro Steps`) — Translates mutation log into reproduction breadcrumbs.

### 8.4 DevTools Command & Network Runner Drawer (`VisualTestTrackerWindow.xaml:815-1073`)
Activated via `BtnDevToolsRunner`. Provides developer console and API testing shortcuts without needing to open the bulky Chromium DevTools window (native DevTools remains available via `🛠 Full DevTools` button):

#### Tab 1: JS Console Runner (`PanelConsoleRunner`)
- **Preset Dropdown** (`CboConsolePresets`): Common inspection snippets (e.g., `Dump localStorage`, `Clear cookies`, `Log form values`, `Inspect React state`).
- **Command Input** (`TxtConsoleCommand`): Monospace script editor. Supports history traversal via `Up` / `Down` arrow keys.
- **Run Button** (`BtnRunConsoleCommand`): `▶ Run Command (Enter)`. Executes snippet in the page context.

#### Tab 2: Network / API Runner (`PanelNetworkRunner`)
- **Method Selector** (`CboApiMethod`): `Auto` (default), `GET`, `POST`, `PUT`, `DELETE`, `PATCH`.
- **Snippet Input** (`TxtApiSnippet`): Auto-detects raw URLs (`https://...`), endpoint paths (`/api/v1/...`), JavaScript `fetch()` calls, or pasted `curl` commands (auto-converts curl into native fetch).
- **JSON Payload Box** (`TxtApiPayload`): Optional JSON body for POST/PUT requests.
- **Execute Button** (`BtnExecuteApi`): `▶ Execute API Call`. Fires the request directly within the page context, ensuring it inherits active session cookies, CSRF tokens, and CORS permissions.

#### Result Viewer & Attachment
- **Result Tabs**: `Console` · `JSON` (pretty-printed) · `Raw` · `Headers` · `Timing`.
- **Attach Button** (`BtnAttachResultToBug`): `📎 Attach Result to Bug Report` — Appends command output, HTTP status code, headers, and response payload to the active bug report draft.

---

## 9. Staged Screenshots & Composer Submission

### 9.1 Staged Screenshots Bar (`VisualTestTrackerWindow.xaml:1077-1088`)
- Container: `StagedScreenshotsContainer`, Background `{StaticResource Surface0Brush}`. Visible only when attachments exist.
- Thumbnail Panel: `StagedThumbnailsPanel` (horizontal scrolling strip).
- Each staged item renders:
  - Thumbnail preview (`Image`, max height 48px).
  - File name label (e.g., `full-20260913-160530.png`).
  - Delete button (`✕`) to unstage before saving.

### 9.2 Commit Actions (`VisualTestTrackerWindow.xaml:1091-1114`)
- **Save Bug Entry** (`BtnSaveEntry`): `💾 Save Bug Entry (Ctrl+Enter)` (PrimaryButton style). Validates that notes or attachments exist, packages all auto-collected metadata and telemetry, saves the entry, and resets the composer.
- **Clear Draft** (`BtnClearDraft`): `Clear`. Resets composer inputs and clears staged screenshots.

---

## 10. Bug List & Export Pipeline

Located in `MainWorkspaceGrid` Row 1 (`VisualTestTrackerWindow.xaml:1118-1184`).

### 10.1 List Header & Filter Controls
- **Header Label** (`BugCountHeader`): e.g., `BUG LIST (3)`.
- **Filter Buttons**:
  - `All` (`BtnFilterAll`)
  - `Open` (`BtnFilterOpen`)
  - `Resolved` (`BtnFilterResolved`)

### 10.2 Bug Card Anatomy
Each item in `BugListPanel` renders as an individual card with the following structure:
- **Header Row**:
  - Status Pill: `Open` (amber/blue) or `Resolved` (green).
  - Severity Badge: e.g., `BLOCKER` (red), `CRITICAL` (orange), `BUG` (yellow), `UI GLITCH` (cyan).
  - Relative Timestamp: e.g., `2 mins ago` (Tooltip: `2026-09-13 16:04:12`).
- **Title / Summary**: First line of Notes or explicit Title.
- **Tags**: Chip list (e.g., `#Auth`, `#UI`).
- **Screenshot Strip**: Small clickable thumbnails that open the full image.
- **Card Actions**:
  - `Resolve / Reopen`: Flips entry status.
  - `Copy MD`: Copies this single bug as Markdown.
  - `Delete`: Prompts confirmation and removes entry.

### 10.3 Export Actions (`VisualTestTrackerWindow.xaml:1152-1166`)
- **Export to /Bugs/** (`BtnExportJson`): `📦 Export to /Bugs/` (AccentBrush). Exports all bug entries on the current page to the repository root `/Bugs/<Area>/` directory.
  - **Auto-Area Detection** (`VisualTestTrackerExportService.cs:54-70`):
    - Port `5175` → `Portal`
    - Port `5173` → `Marketing`
    - Port `5174` → `Admin-Panel`
    - Port `5177` → `MSP_Console`
    - Port `5176` → `MSP_Marketing`
    - Fallback: `Website` or `General`
  - Output files:
    - `<EntryUuid>.json`: Full structured JSON contract.
    - `<EntryUuid>.md`: Formatted Markdown report.
    - Bundled screenshot files copied alongside the JSON.
- **Copy Report** (`BtnCopyAllMarkdown`): `📋 Copy Report`. Combines all entries for the active page into a single comprehensive Markdown document copied to the clipboard.

---

## 11. Data Contracts & JSON Schemas

### 11.1 Bug Entry Schema (`VisualTestTrackerEntry.cs`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VisualTestTrackerEntry",
  "type": "object",
  "required": ["Id", "EntryUuid", "BaseUrl", "PagePath", "Severity", "Status", "CreatedAt"],
  "properties": {
    "Id": { "type": "integer" },
    "EntryUuid": { "type": "string", "description": "32-char lowercase hex GUID" },
    "PageId": { "type": "integer" },
    "BaseUrl": { "type": "string", "example": "http://localhost:5175" },
    "PagePath": { "type": "string", "example": "/portal/invoices" },
    "Title": { "type": "string" },
    "Notes": { "type": "string", "description": "User notes with Markdown support" },
    "StepsToReproduce": { "type": "string" },
    "ExpectedBehavior": { "type": "string" },
    "ActualBehavior": { "type": "string" },
    "Severity": { 
      "type": "string", 
      "enum": ["Blocker", "Critical", "Bug", "UI Glitch", "Functional", "Low"] 
    },
    "Status": { 
      "type": "string", 
      "enum": ["Open", "Resolved"] 
    },
    "Tags": { 
      "type": "array", 
      "items": { "type": "string" } 
    },
    "CurrentUrl": { "type": "string" },
    "PageTitle": { "type": "string" },
    "BrowserVersion": { "type": "string", "example": "WebView2 128.0.2792.89" },
    "OsVersion": { "type": "string", "example": "Microsoft Windows NT 10.0.22631.0" },
    "WindowSize": { "type": "string", "example": "1920x1080" },
    "ViewportSize": { "type": "string", "example": "1440x900" },
    "UserAgent": { "type": "string" },
    "Performance": {
      "type": "object",
      "properties": {
        "PageLoadTimeMs": { "type": "number" },
        "DnsTimeMs": { "type": "number" },
        "TcpTimeMs": { "type": "number" },
        "TtfbMs": { "type": "number" },
        "DomContentLoadedMs": { "type": "number" },
        "FirstContentfulPaintMs": { "type": ["number", "null"] },
        "LargestContentfulPaintMs": { "type": ["number", "null"] },
        "ScriptErrorCount": { "type": "integer" }
      }
    },
    "ScreenshotPaths": {
      "type": "array",
      "items": { "type": "string" }
    },
    "ConsoleLogs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "Level": { "type": "string", "enum": ["error", "warn", "info", "log", "exception", "unhandledrejection"] },
          "Message": { "type": "string" },
          "StackTrace": { "type": "string" },
          "Timestamp": { "type": "string" }
        }
      }
    },
    "NetworkFailures": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "Method": { "type": "string" },
          "Url": { "type": "string" },
          "Status": { "type": "integer" },
          "StatusText": { "type": "string" },
          "DurationMs": { "type": "number" },
          "PayloadSize": { "type": "string" },
          "Timestamp": { "type": "string" },
          "Failed": { "type": "boolean" }
        }
      }
    },
    "ReproductionEvents": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "ActionType": { "type": "string", "enum": ["CLICK", "BUTTON_PRESS", "INPUT", "NAVIGATE", "SUBMIT", "DOM_MUTATION"] },
          "Selector": { "type": "string" },
          "OuterHtml": { "type": "string" },
          "Details": { "type": "string" },
          "Timestamp": { "type": "string" }
        }
      }
    },
    "CreatedAt": { "type": "string", "format": "date-time" },
    "UpdatedAt": { "type": "string", "format": "date-time" }
  }
}
```

### 11.2 Session Schema (`VisualTestTrackerSession.cs`)

```json
{
  "SessionId": "4a7f28c19b0242a8b3d685e109d73fc0",
  "BaseUrl": "http://localhost:5175",
  "PagePath": "/portal/billing",
  "StartedAt": "2026-09-13T15:30:00.000Z",
  "EndedAt": null,
  "AccumulatedSeconds": 642.5,
  "BugsLoggedCount": 2,
  "TelemetryEventsCount": 47,
  "IsCleanConfirmed": false,
  "IsActive": true,
  "LastActiveAt": "2026-09-13T15:40:42.500Z"
}
```

---

## 12. Design Tokens & Theme References

Every color referenced in the Visual Web Tester is mapped directly to `Themes/Colors.xaml` and `Themes/DarkTheme.xaml`:

| Token / Key | Hex Code | Semantic Role in Visual Web Tester |
| :--- | :--- | :--- |
| `MantleBrush` | `#CC161B22` | Window shell background (semi-transparent dark). |
| `CrustBrush` | `#CC0D1117` | Header strip and nested code runner background. |
| `BaseBrush` | `#661C2128` | Composer background and scrollable container backgrounds. |
| `Surface0Brush` | `#30363D` | Borders, dividers, session strip background, and inactive tabs. |
| `Surface1Brush` | `#484F58` | Control borders, slider tracks, and hover outlines. |
| `TextBrush` / `TextPrimaryBrush` | `#E6EDF3` | Primary body text, titles, and editor inputs. |
| `Subtext0Brush` | `#8B949E` | Section sub-headers, counts, and metadata labels. |
| `Subtext1Brush` | `#7D8590` | Placeholder text, shortcuts hints, and disabled buttons. |
| `AccentBrush` / `AccentColor` | `#7C8CF0` | Primary CTA buttons, brand badges, and active tab highlights. |
| `StatusSuccessBrush` | `#8FC496` | Active session pulse dot, resolved badges, and clean indicators. |
| `StatusErrorBrush` | `#DC8A8A` | Blocker/Critical severity badges, console error counts, error alerts. |
| `StatusWarningBrush` | `#D4A56C` | Network failure badges, warning severity, and copy error buttons. |
| `StatusRunningBrush` | `#79B3C8` | In-flight API indicator and telemetry timers. |
| `BlueBrush` | `#58A6FF` | Link buttons, selector copy actions, and informational icons. |

---

## 13. Instructions for Design Tools (e.g. Claude Design, Figma)

When creating designs based on this contract pack:
1. **Maintain HUD Hierarchy**: The header and session indicator must remain compact and scannable so that the user never loses context of which page is under test.
2. **Prioritize the Composer**: The composer is the primary working surface. The Notes input, Markdown shortcuts, and Action buttons (`Capture`, `Inspect`, `Diff`) must feel fast, direct, and distraction-free.
3. **Keep Drawers Collapsible**: The four diagnostic drawers (DOM Inspector, a11y Audit, DOM Changes, DevTools Runner) are powerful secondary tools that should open smoothly without breaking the overall window layout.
4. **Preserve Contrast**: Use the curated Catppuccin / GitHub Dark tokens above to maintain high readability across transparent overlays against bright or dark web applications.
