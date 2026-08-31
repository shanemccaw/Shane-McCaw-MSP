# BuildConsole UI Contract Pack

> **Notice for UI Designers (e.g., Claude Design)**  
> This document is the single authoritative specification for the BuildConsole desktop user interface. It defines the exact data models, status vocabularies, surface inventory, interaction rules, and system constraints extracted directly from the codebase of `shanemccaw/Shane-McCaw-MSP` under `desktop/BuildConsole/`.  
> 
> As the designer, you have **full creative freedom over the visual appearance** (layout, visual grouping, cards vs lists vs tables, spacing, typography, micro-interactions, dark aesthetic palette). You are replacing the legacy visual interface entirely.  
> 
> However, you have **zero freedom over what data exists**. Every field, enum value, status state, and user capability documented herein represents real backing logic in C#/.NET 8 WPF. You must not invent missing data fields or alter status definitions. A missing value must always render as unavailable (`--`), never as `0`, never as a fake placeholder, and never as an unhandled error state.

---

## 1. What BuildConsole Is

BuildConsole is the author's internal desktop application for dispatching, orchestrating, and monitoring automated Claude Code (and Gemini) AI build agents against GitHub issues in the `shanemccaw/Shane-McCaw-MSP` repository. It is a single-user, single-window Windows WPF desktop tool that runs continuously all day on a primary desktop monitor. It is not customer-facing software; it is a high-throughput developer control deck.

### Mental Model & Core Concepts

- **What a "Build" is**: A build is a single asynchronous background execution of an AI coding agent process (`claude.exe` or `gemini.exe`) running in a git workspace (`desktop/BuildConsole/Services/QueueWatcherService.cs:1`). Each build takes a prompt (usually derived from a GitHub issue title and description), target model (`claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-opus`, `fable`, `gemini-2.5-pro`), effort tier (`low`, `medium`, `high`, `xhigh`), account assignment (`primary` vs `secondary`), and target git directory.
- **The Build Queue**: Managing builds via direct connection to a Neon PostgreSQL database (`desktop/BuildConsole/Services/BuildQueuePostgresClient.cs:59`). The queue enforces concurrency limits (default 8 max concurrent builds, configured via `scripts/build-queue-watcher.config.json`), handles prioritization, tracks active PIDs (`desktop/BuildConsole/Services/BuildTrackerApiClient.cs:48-57`), and manages conservation caps (`desktop/BuildConsole/Services/AccountCapPolicy.cs:35`).
- **How GitHub Issues Drive BuildConsole**: BuildConsole connects directly to GitHub via `gh` CLI and GitHub REST/GraphQL APIs (`desktop/BuildConsole/Services/GitHubApiClient.cs`, `Services/GitHubIssuesService.cs`). GitHub issues drive the entire pipeline across board columns (Batter Up, AI Batter Up, In Progress, Verifying, Done, Backlog, Park). When a build is queued, its `GithubNumber` links the queue item directly to the issue. Upon session completion (exit code 0), the queue item moves to `verifying` while waiting for live GitHub verification or manual closure (`desktop/BuildConsole/Services/BuildQueuePostgresClient.cs:71`).

---

## 2. Surface Inventory

> **Redesign status — read before trusting any single row (reconciled 2026-08-31, Git #2125).**
> A full Shell Redesign is **planned** under Epic **#1202** and its sub-epics — #1787 (Git Board & Chats Panel), #1788 (Build Queue Panel), #2014 (Left Icon Bar), #2015 (Bottom Panel), #2016 (Home Page), #2017 (Shell & Top Bar), #2035 (Global Chat Drawer), #2036 (pinned-question tracking). **Every one of those epics is still OPEN and largely un-built.** Where this document describes redesign decisions (a re-ordered icon bar, a re-homed top bar, Focus Mode as a filter state, the removal of mascot/critter surfaces), those are **planned, not yet implemented** — the current shipped code still matches the pre-redesign inventory below. Rows carrying real, *landed* work from those epics' individual phases are marked **✅ landed**; rows describing surfaces slated for removal but **still live in code** are marked **⚠ slated for removal (not yet implemented)**. Do not treat a planned decision as shipped, and do not delete a still-live surface from a design on the assumption it is already gone.

All UI surfaces in BuildConsole are implemented as WPF Windows, Controls, or Dialogs (`desktop/BuildConsole/*.xaml` and `desktop/BuildConsole/Controls/*.xaml`).

### Surface Categorization & Roles

Surfaces are categorized into **Primary** (used constantly during normal operation) and **Occasional** (opened for specific dialogs, one-off tools, or secondary inspection).

```
+---------------------------------------------------------------------------------------------------+
| MainWindow (Top Title Bar: Account/Location/Conservation Toggles, Search, Buttons)                 |
+-------------------+---------------------------------------------------+---------------------------+
| ActivityBar (48px)| LeftSidebar (260px)                               | BuildQueuePanel (300px)   |
| [Icons:           | - Navigation Tree (Chats, Issues, Milestones,     | - DispatchPanel           |
|  Chat, Board,     |   Dev Services, Web Tools, Pinned, Shelved)       | - Build-Set Rollup Header |
|  Settings, etc.]  | - Filter Search & Quick Actions                   | - Queue Cards Stack       |
|                   +---------------------------------------------------+                           |
|                   | Main Center Workspace (Multi-Pane Tab Grid)       |                           |
|                   | - Pane 1: HomeView / ChatSessionPane / Document   |                           |
|                   | - Pane 2/3/4: Split Tabs (Side-by-Side/Grid)      |                           |
|                   +---------------------------------------------------+                           |
|                   | Bottom Panel (Collapsible GridSplitter)           |                           |
|                   | - Resource Monitors (CPU / RAM)                   |                           |
|                   | - Build Log / Terminal / Service Logs / Output    |                           |
+-------------------+---------------------------------------------------+---------------------------+
| StatusBar (Bottom: Status Dots, Postgres, Deploy, Replit, Claude Usage Meters Primary/Secondary)   |
+---------------------------------------------------------------------------------------------------+
```

> **The diagram above reflects the current, shipped (pre-redesign) shell.** Under Epic **#2017** (Shell & Top Bar, OPEN — not yet built) most of the top-bar contents are slated to be re-homed: Focus Mode moves into the primary bar, `Ctrl+K` becomes a nav command center that absorbs Universal Search, and most status/utility icons relocate. The left rail order is slated to change under **#2014** (see the `ActivityBar` row below). None of that has landed — the layout above is what actually renders today.

#### 1. Main Shell & Layout Containers

| Surface | File Citation | Category | Current Appearance | Purpose & Capabilities | Simultaneous Visibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `MainWindow` | [`MainWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/MainWindow.xaml#L1) | **Primary** | Top-level Borderless Window (`WindowStyle="None"`, `WindowChrome`) | Main application window hosting custom title bar, activity bar, left sidebar, center document tab grid, right build queue panel, bottom logs panel, and bottom status bar. | Must host and display all docked primary panels simultaneously. |
| `LeftSidebar` | [`Controls/LeftSidebar.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/LeftSidebar.xaml#L1) | **Primary** | Docked Left Panel (260px width, collapsible via `Ctrl+B`) | Displays navigation tree: Open Chats, In Progress Issues, Milestones, Dev Services status, Web Tools shortcuts, Pinned tabs, and Shelved tabs. Allows filtering, opening tabs, creating issues, and selecting focus milestones. | Visible alongside Center Workspace and Build Queue. |
| `ActivityBar` | [`Controls/ActivityBar.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/ActivityBar.xaml#L1) | **Primary** | Docked Left Rail (48px width) | Vertical icon strip for switching primary sidebar views (Chats, Git Board, Automation, Services, Settings) and launching popouts. **Planned redesign (#2014, OPEN — not yet built):** a fixed 12-icon order (Chats, Sticky Notes, Batter Up, Build Watch, Git Board, Web, My Company, Source Control, Files, Visual Test Tracker, UI Automation, Settings) with two shelf icons; the current rail still reflects the pre-redesign layout. | Always visible on far left. |
| `FocusModeBar` | [`Controls/FocusModeBar.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/FocusModeBar.xaml#L1) | Occasional | Docked Top Strip (in Focus mode) | Displays active focus milestone title, progress bar, closed issue count, ETA readout, and exit focus button. **Planned change (#2017, OPEN — not yet built):** Focus Mode is to become a filter state on the primary shell/top bar rather than a separate overlay set; this bar still ships in its current form. | Overlays top of workspace during Focus Mode. |
| `FocusImmersiveView` | [`Controls/FocusImmersiveView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/FocusImmersiveView.xaml#L1) | Occasional | Full-screen Immersive Overlay | **⚠ Slated for removal (#2017, OPEN — not yet implemented; still live in code at `MainWindow.FocusImmersive.cs`).** Distraction-free single-milestone view showing milestone stats, progress ETA, and focus suggestions when empty. Redesign retires this entirely in favor of Focus Mode as a filter state on the real shell — do not carry it forward into a new design, but note it is still present and functional today. | Replaces Center Workspace during Immersive Focus. |
| `FocusCharacterLayer` | [`Controls/FocusCharacterLayer.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/FocusCharacterLayer.xaml#L1) | Occasional | Transparent Screen Overlay | **⚠ Slated for removal (mascot de-scope #2021/#2014, OPEN — not yet implemented; still live in code).** Renders animated critter sprites and milestone achievement popups during focus events. | Floats over window. |
| `CritterLoungeControl` | [`Controls/CritterLoungeControl.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/CritterLoungeControl.xaml#L1) | Occasional | Docked / Floating Control | **⚠ Slated for removal (mascot de-scope #2021/#2014, OPEN — not yet implemented).** Still docked at the bottom of `BuildQueuePanel.xaml` and per-card mascots still render on every queue card (`CreateQueueCardMascot`); renders interactive pixel-art critters that react to build completions and user cheers. The redesign removes critters from the Build Queue cards and lounge, but this has **not** landed — treat critters as present today. | Optional overlay or docked panel. |
| `SailorDuckMascotLayer` | [`Controls/SailorDuckMascotLayer.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/SailorDuckMascotLayer.xaml#L1) | Occasional | Full Window Overlay (`ZIndex=15000`) | **⚠ Slated for removal (mascot de-scope #2021/#2014, OPEN — not yet implemented; still live in code).** Animates Donald Duck mascot in sailboat crossing the screen on ambient events and build achievements. | Non-interactive ambient overlay. |
| `SailorDuckWatermarkControl` | [`Controls/SailorDuckWatermarkControl.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/SailorDuckWatermarkControl.xaml#L1) | Occasional | Subtle Background Watermark | **⚠ Slated for removal (mascot de-scope #2021/#2014, OPEN — not yet implemented; still live in code).** Low-opacity mascot watermark rendered in background panels. | Static background element. |
| `StartupLoadingView` | [`Controls/StartupLoadingView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/StartupLoadingView.xaml#L1) | Occasional | Full Window Splash (`ZIndex=20000`) | Displays startup connection progress across GitHub, Queue, Postgres, and Claude usage API before fading out. | Visible only at app launch. |

#### 2. Build Execution & Dispatch

| Surface | File Citation | Category | Current Appearance | Purpose & Capabilities | Simultaneous Visibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `BuildQueuePanel` | [`Controls/BuildQueuePanel.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/BuildQueuePanel.xaml#L1) | **Primary** | Docked Right Panel (300px width, collapsible) | Displays active build queue cards grouped by state (`running`, `queued`, `verifying`, `capped`, `parked`), build-set rollup header, queue pause/resume controls, and card action menus. **✅ Landed since original doc:** a blocked card now renders a real dimmed **ghost/placeholder card** for its blocker (`BuildBlockerGhostCard`, #2062) showing the blocker's real title/state instead of a bare `#N`; the "waiting on #N" text is now live-filtered against the open-issue set so it can no longer disagree with the BLOCKED badge (`LiveBlockedBy`, #2070); a Reply/resume now marks the original row **`superseded`** (linked via `SupersededById`) instead of orphaning it (#2119). **Planned (Epic #1788 + #2108–#2111, OPEN — not yet built):** a Dynamic Build Queue Map (blocker/loop/age visualization). | Visible simultaneously with Center Workspace and Left Sidebar. |
| `DispatchPanel` | [`Controls/DispatchPanel.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/DispatchPanel.xaml#L1) | **Primary** | Docked Header above Build Queue | Quick build prompt input bar, model selector dropdown, effort selector, account toggle, and "Queue Build" button. | Visible at top of right queue column. |
| `BuildWatchWindow` | [`BuildWatchWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/BuildWatchWindow.xaml#L1) | Occasional | Floating Window (Always-on-top option) | Dedicated live monitor for active build sessions showing real-time log output, session timer, and stop/pause controls. | Floats alongside main window. |
| `StreamingConsoleWindow` | [`StreamingConsoleWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/StreamingConsoleWindow.xaml#L1) | Occasional | Floating Window | Displays live stdout/stderr streams from background process executions (e.g. `shaneapp://` protocol commands). | Floats above main window. |
| `BuildLogView` | [`Controls/BuildLogView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/BuildLogView.xaml#L1) | **Primary** | Tab inside Bottom Panel | Real-time auto-scrolling log view for the selected or active build execution stream. | Visible in bottom panel when expanded. |
| `EditBuildPromptDialog` | [`EditBuildPromptDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/EditBuildPromptDialog.xaml#L1) | Occasional | Modal Dialog | Full prompt editor allowing modification of prompt text, model, effort tier, account routing (`primary`/`secondary`), build set name, and target CWD. | Modal overlay. |

#### 3. GitHub Issues & Board Management

| Surface | File Citation | Category | Current Appearance | Purpose & Capabilities | Simultaneous Visibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `HomeView` | [`Controls/HomeView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/HomeView.xaml#L1) | **Primary** | Center Document Tab (Home) | Dashboard showing recent session roll-up ("Where you left off"), Git Board summary tiles, recent commits ("What's New"), and quick action launchers. | Rendered in center editor workspace tab. |
| `BatterUpPanel` | [`Controls/BatterUpPanel.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/BatterUpPanel.xaml#L1) | **Primary** | Center Document Tab (Title Bar button) | Renders human-curated "Batter Up" GitHub issues column with filter toggles (FreeFlow mode), issue cards, and direct queue buttons. | Rendered in center workspace tab. |
| `AiBatterUpPanel` | [`Controls/AiBatterUpPanel.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/AiBatterUpPanel.xaml#L1) | **Primary** | Center Document Tab (Title Bar button) | Renders AI-selected "AI Batter Up" GitHub issues column with status indicators and dispatch action controls. | Rendered in center workspace tab. |
| `IssueDetailView` | [`Controls/IssueDetailView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/IssueDetailView.xaml#L1) | **Primary** | Center / Bottom Panel Tab | Displays full GitHub issue markdown body, comments list, labels, milestone, and comment reply dialog trigger. | Rendered in tab workspace. |
| `NewIssueDialog` | [`NewIssueDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/NewIssueDialog.xaml#L1) | Occasional | Modal Dialog | Form to create a new GitHub issue in `shanemccaw/Shane-McCaw-MSP` with title, body, labels, epic assignment, and milestone. | Modal overlay. |
| `EditIssueDialog` | [`EditIssueDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/EditIssueDialog.xaml#L1) | Occasional | Modal Dialog | Form to edit an existing GitHub issue's title and description body. | Modal overlay. |
| `SetBlockedByDialog` | [`SetBlockedByDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/SetBlockedByDialog.xaml#L1) | Occasional | Modal Dialog | Prompts for comma-separated GitHub issue numbers to set as blockers (`blocked_by`) for a build queue item. | Modal overlay. |
| `AssignEpicDialog` | [`AssignEpicDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/AssignEpicDialog.xaml#L1) | Occasional | Modal Dialog | Dialog to assign an epic to a selected issue. | Modal overlay. |
| `AssignIssueEpicDialog` | [`AssignIssueEpicDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/AssignIssueEpicDialog.xaml#L1) | Occasional | Modal Dialog | Variant dialog to assign epic to issue. | Modal overlay. |
| `AssignChatToEpicDialog` | [`AssignChatToEpicDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/AssignChatToEpicDialog.xaml#L1) | Occasional | Modal Dialog | Dialog to associate a Claude chat conversation with a specific Board Epic. | Modal overlay. |
| `NewChatEpicDialog` | [`NewChatEpicDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/NewChatEpicDialog.xaml#L1) | Occasional | Modal Dialog | Dialog to create a new Epic directly from a chat context. | Modal overlay. |
| `NeedsAttentionDetailDialog` | [`NeedsAttentionDetailDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/NeedsAttentionDetailDialog.xaml#L1) | Occasional | Modal Dialog | Displays details for issues or builds flagged as needing manual developer intervention. | Modal overlay. |

#### 4. Chat & Conversations

| Surface | File Citation | Category | Current Appearance | Purpose & Capabilities | Simultaneous Visibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ChatSessionPane` | [`Controls/ChatSessionPane.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/ChatSessionPane.xaml#L1) | **Primary** | Center Document Tab (Closable Tab) | Embedded `WebView2` browser container loading `https://claude.ai/chat/{uuid}`, with injected custom action buttons (Queue Build, Attach Context, Extract Checklist). | Rendered in center editor workspace tabs. |
| `FloatingChatWindow` | [`FloatingChatWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/FloatingChatWindow.xaml#L1) | Occasional | Floating Window (Always-on-top) | **✅ Landed (Epic #2035 phases 1–2).** AIM-style always-on-top chat floaty opening one or more chats **without switching tabs**, each tab reusing the existing `WebView2` DOM bridge (`Services/FloatingChatBridgeScript.cs`) to send (insert + submit) and scrape the last assistant turn to RichText (#2059 single-chat, #2065 multi-chat tabs). Injects `IssueMentionInjector` so `#NNN` refs underline with the same state-aware hover actions as every other chat surface (#2071/#2080); no longer coupled to `MainWindow` via `Owner` (#2074). Later #2035 phases (side dock, checklist/progress extraction, screenshot paste, OCR, self-purging gallery) are **planned, not yet built.** | Floats over main window. |
| Pinned Questions (pin cards) | [`Controls/LeftSidebar.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/LeftSidebar.xaml#L1), [`Services/PinnedQuestionDetector.cs:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Services/PinnedQuestionDetector.cs#L1) | Occasional | Pin cards near the Chats panel | **✅ Landed (Epic #2036 phases 1–2).** Per-chat "outstanding question for Shane" pins backed by the real `chat_pinned_questions` table (#2104); each card has an inline reply field that resolves the pin by posting the reply into the real chat through the Floating Chat bridge. Active detection (#2105, `PinnedQuestionDetector`) asks each chat on a settled-turn edge whether it has outstanding questions and parses the answer into individual pins — gated by the `PinnedQuestionDetectionEnabled` setting (default off). **Planned (#2124, OPEN — not yet built):** a real Settings UI toggle for that flag, which today is `settings.json`-only. | Rendered near the Chats navigation panel. |
| `ReplyDialog` | [`ReplyDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/ReplyDialog.xaml#L1) | Occasional | Modal Dialog | Prompts for follow-up prompt text to resume an existing Claude Code session (`ResumeSessionId`). | Modal overlay. |
| `RenameTabDialog` | [`RenameTabDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/RenameTabDialog.xaml#L1) | Occasional | Modal Dialog | Text input dialog to set a custom display title for an open editor tab. | Modal overlay. |
| `StickyNotesWindow` | [`StickyNotesWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/StickyNotesWindow.xaml#L1) | Occasional | Floating Window (Always-on-top) | Persistent scratchpad floaty for developer notes, auto-saved to settings, with "Send to Chat" button. | Floats over main window. |

#### 5. Testing & Verification

| Surface | File Citation | Category | Current Appearance | Purpose & Capabilities | Simultaneous Visibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TestRunnerWindow` | [`TestRunnerWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/TestRunnerWindow.xaml#L1) | Occasional | Window / Center Tab | Test execution panel for running automated Playwright/PowerShell test manifests, showing step progress and execution logs. | Can run as separate window or tab. |
| `TestHistoryWindow` | [`TestHistoryWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/TestHistoryWindow.xaml#L1) | Occasional | Window / Center Tab | Displays historical test execution runs, pass/fail streaks, flakiness stats, and detailed step output logs. | Opened via Menu -> Run -> Test History. |
| `VisualTestTrackerWindow` | [`VisualTestTrackerWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/VisualTestTrackerWindow.xaml#L1) | Occasional | Floating Window (Always-on-top) | Watches `WebView2` navigation against configured local dev URLs (e.g. Portal v2) to capture screenshots and track visual regressions. | Floats alongside browser tabs. |
| `ScreenshotGalleryWindow` | [`ScreenshotGalleryWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/ScreenshotGalleryWindow.xaml#L1) | Occasional | Window | Grid gallery view of baseline vs actual screenshots captured during test runs. | Secondary window. |
| `ScreenshotReviewWindow` | [`ScreenshotReviewWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/ScreenshotReviewWindow.xaml#L1) | Occasional | Window | Side-by-side and image diff comparison view to approve or reject visual test diffs. | Secondary window. |
| `ManifestViewerWindow` | [`ManifestViewerWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/ManifestViewerWindow.xaml#L1) | Occasional | Window / Tab | Raw JSON viewer and editor for test manifest files (`test-manifests/*.json`). | Tab or window view. |
| `MissingVariableWindow` | [`MissingVariableWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/MissingVariableWindow.xaml#L1) | Occasional | Modal Dialog | Prompted when a test manifest contains unresolved `{{VARIABLE}}` placeholders, allowing developer to supply values. | Modal overlay. |

#### 6. Developer Tools, Services & Execution

| Surface | File Citation | Category | Current Appearance | Purpose & Capabilities | Simultaneous Visibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TerminalView` | [`Controls/TerminalView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/TerminalView.xaml#L1) | **Primary** | Tab inside Bottom Panel | Interactive PowerShell terminal emulator embedded inside bottom panel. | Bottom panel tab. |
| `ServiceLogView` | [`Controls/ServiceLogView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/ServiceLogView.xaml#L1) | Occasional | Tabs inside Bottom Panel | Tail log viewers for local background microservices (Marketing, Portal, Admin, API Server). | Bottom panel tabs. |
| `DiffView` | [`Controls/DiffView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/DiffView.xaml#L1) | Occasional | Center Workspace Tab | Visual git diff viewer showing side-by-side additions and deletions. | Center workspace tab. |
| `SqlDocumentView` | [`Controls/SqlDocumentView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/SqlDocumentView.xaml#L1) | Occasional | Center Workspace Tab | SQL query editor and result grid execution view for local PostgreSQL database. | Center workspace tab. |
| `GraphApiDocumentView` | [`Controls/GraphApiDocumentView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/GraphApiDocumentView.xaml#L1) | Occasional | Center Workspace Tab | Microsoft Graph API runner and JSON response viewer. | Center workspace tab. |
| `ApiRunnerView` | [`Controls/ApiRunnerView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/ApiRunnerView.xaml#L1) | Occasional | Center Workspace Tab | Postman-style HTTP request runner for local REST endpoints. | Center workspace tab. |
| `ChatMappingsDocumentView` | [`Controls/ChatMappingsDocumentView.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/Controls/ChatMappingsDocumentView.xaml#L1) | Occasional | Center Workspace Tab | Database view of `bt_chats` associations to GitHub issues and epics. | Center workspace tab. |
| `DeviceCodeWindow` | [`DeviceCodeWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/DeviceCodeWindow.xaml#L1) | Occasional | Modal Dialog | OAuth device flow login dialog displaying user verification code and login URL. | Modal overlay. |
| `RegionSelectOverlayWindow` | [`RegionSelectOverlayWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/RegionSelectOverlayWindow.xaml#L1) | Occasional | Full Screen Selection Overlay | Desktop screen capture region drawer triggered by `PrintScreen` or title bar button. | Full screen transparent canvas. |
| `LinkedInComposerWindow` | [`LinkedInComposerWindow.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/LinkedInComposerWindow.xaml#L1) | Occasional | Window | Post composer tool for publishing release notes directly to LinkedIn. | Secondary window. |
| `StagingDeployDialog` | [`StagingDeployDialog.xaml:1`](file:///c:/Source/ShaneMcCawConsulting/Shane-McCaw-MSP/desktop/BuildConsole/StagingDeployDialog.xaml#L1) | Occasional | Modal Dialog | Confirmation dialog for triggering manual staging deployment to Replit/ShanesBuild. | Modal overlay. |

---

## 3. The Data the UI Actually Renders

This section specifies the exact model classes backing the UI surfaces. Every field is documented with its C# name, type, nullability, and empty value semantics.

### 3.1 `QueueItem` Model
Backed by PostgreSQL `bt_build_queue` table (`desktop/BuildConsole/Services/BuildTrackerApiClient.cs:13-58`).

| Field Name | C# Type | Nullable | Meaning of Null / Empty Value |
| :--- | :--- | :--- | :--- |
| `Id` | `int` | No | Primary key ID of the queue item in PostgreSQL (`bt_build_queue.id`). |
| `Title` | `string` | No | Display title for the build card (defaults to `""`). |
| `Prompt` | `string` | No | Full prompt text passed to `claude.exe` or `gemini.exe`. |
| `Model` | `string?` | **Yes** | AI model name (`"claude-3-7-sonnet"`, `"claude-3-opus"`, `"fable"`, etc.). `null` = default model configured in CLI. |
| `Effort` | `string?` | **Yes** | Reasoning effort level (`"low"`, `"medium"`, `"high"`, `"xhigh"`). `null` = default CLI effort. |
| `Cwd` | `string?` | **Yes** | Target workspace directory path. `null` = repo root. |
| `BuildSet` | `string?` | **Yes** | Optional build set grouping tag (e.g. `"header-fixes"`). `null` = un-grouped build. |
| `GithubNumber` | `int?` | **Yes** | Linked GitHub issue number (e.g. `2002`). `null` = standalone build not tied to an issue. |
| `BlockedByNumber` | `int?` | **Yes** | Primary blocking GitHub issue number. `null` = unblocked. |
| `BlockedByNumbers` | `List<int>?` | **Yes** | Full list of blocking issue numbers (`desktop/BuildConsole/Services/BuildTrackerApiClient.cs:26`). `null`/empty = no blockers. |
| `Status` | `string` | No | Build state (`"queued"`, `"running"`, `"verifying"`, `"capped"`, `"parked"`, `"failed"`, `"done"`). Default `"queued"`. |
| `ExitCode` | `int?` | **Yes** | CLI process exit code (`0` = success, `1`/`-2` = failure). `null` = not yet finished or still running. |
| `SessionId` | `string?` | **Yes** | Claude Code conversation UUID captured from stdout stream. `null` = session not yet started or uncaptured. |
| `ResumeSessionId` | `string?` | **Yes** | Session ID to resume (`--resume <id>`). `null` = fresh session launch. |
| `ChatUrl` | `string?` | **Yes** | Source Claude.ai chat URL that dispatched this build. `null` = dispatched from queue/board. |
| `OriginatingChatId` | `string?` | **Yes** | Source conversation UUID. `null` = unlinked to chat tab. |
| `UpdatedAt` | `DateTimeOffset?` | **Yes** | UTC timestamp of last status update. `null` = not available. |
| `AssociatedIssueNumbers` | `List<int>` | No | All linked issue numbers. Default empty list `new()`. |
| `Cli` | `string?` | **Yes** | CLI binary name (`"claude"` vs `"gemini"`). `null` = `"claude"`. |
| `Account` | `string?` | **Yes** | Account routing (`"primary"` vs `"secondary"`). `null`/empty = `"primary"`. |
| `BuildPid` | `int?` | **Yes** | OS Process ID of active `claude.exe` execution (`desktop/BuildConsole/Services/BuildTrackerApiClient.cs:52`). `null` = process not running. |
| `BuildPidStartedAt` | `DateTimeOffset?` | **Yes** | Process creation timestamp for PID safety verification. `null` = no PID stored. |
| `SupersededById` | `int?` | **Yes** | **✅ Landed (#2119).** Set when a Reply/resume spawns a replacement row: the original's `Status` becomes `"superseded"` and this points at the replacement row's id. Non-null iff `Status == "superseded"`. `null` = row was never superseded. |

### 3.2 `GitHubIssueSummary` & `InProgressItem` Models
Backed by `gh` CLI JSON responses and GitHub API (`desktop/BuildConsole/Services/GitHubIssuesService.cs:11-20`, `Services/BuildTrackerApiClient.cs:76-87`).

| Field Name | C# Type | Nullable | Meaning of Null / Empty Value |
| :--- | :--- | :--- | :--- |
| `Number` | `int` | No | GitHub issue number (e.g. `1986`). |
| `Title` | `string` | No | Issue title string. |
| `Url` | `string` | No | Full GitHub issue URL (`https://github.com/shanemccaw/Shane-McCaw-MSP/issues/1986`). |
| `UpdatedAt` | `DateTime` | No | GitHub UTC update timestamp. Must be converted to local time (`.ToLocalTime()`). |
| `Parent` | `GitHubIssueParent?` | **Yes** | Linked parent epic info (`desktop/BuildConsole/Services/GitHubIssuesService.cs:19`). `null` = root issue or epic itself. |
| `Labels` | `List<string>` | No | GitHub label strings attached to issue (e.g. `["in-progress", "batter-up"]`). |
| `IsEpic` | `bool` | No | `true` if issue carries `epic` label or is a parent. |
| `IsTodo` | `bool` | No | `true` if issue carries `todo` / `shane-todo` label. |
| `IsBlocked` | `bool` | No | `true` if issue has open unresolved blockers. |
| `BlockedBy` | `BlockedByInfo?` | **Yes** | Blocker issue metadata. `null` = not blocked. |

### 3.3 `BoardChat` & `BoardEpic` Models
Backed by `bt_chats` and `bt_epics` in PostgreSQL (`desktop/BuildConsole/Services/BuildTrackerApiClient.cs:89-127`).

> **✅ Landed (#2066) — chat mention tracking.** Separate from the deliberate `bt_chat_issues` association table, a new `bt_chat_mentioned_issues` table now ingests **every** `#NNN` a chat produces in its DOM (via the existing `IssueMentionInjector` scan), tracks it live, and auto-removes entries when the referenced issue closes. This is the *incidental-mention* signal driving the Chats panel's live mention list; it is intentionally **not** folded into `bt_chat_issues` (which stays the authoritative Link/Unlink association used for epic resolution).

| Field Name | C# Type | Nullable | Meaning of Null / Empty Value |
| :--- | :--- | :--- | :--- |
| `ConversationId` | `string` | No | Claude.ai conversation UUID. |
| `Title` | `string` | No | Conversation display title. |
| `EpicId` | `int?` | **Yes** | Linked epic ID in `bt_epics`. `null` = unassigned chat. |
| `IssueGithubNumber` | `int?` | **Yes** | Primary linked GitHub issue number. `null` = no single primary issue. |
| `AssociatedIssueNumbers` | `List<int>` | No | All linked issue/epic numbers from `bt_chat_issues`. Default empty list. |
| `ClaudeUrl` | `string` | No | Full URL (`https://claude.ai/chat/<uuid>`). |
| `UpdatedAt` | `DateTime?` | **Yes** | Timestamp of last activity. `null` = unknown. |
| `Archived` | `bool` | No | `true` if soft-hidden from active Chats view. |
| `Account` | `string` | No | Account scope (`"primary"` vs `"secondary"`). Default `"primary"`. |

### 3.4 `ClaudeUsageStatus` Model
Backed by `ClaudeUsageMeterService` polling Anthropic OAuth API (`desktop/BuildConsole/Services/ClaudeUsageMeterService.cs:28-59`).

| Field Name | C# Type | Nullable | Meaning of Null / Empty Value |
| :--- | :--- | :--- | :--- |
| `State` | `ClaudeUsageMeterState` | No | Meter state enum (`Ok`, `Polling`, `Unavailable`, `Error`). |
| `Percent` | `int?` | **Yes** | Session usage percentage (0–100). `null` = **unavailable / unread** (render as `--`, NEVER 0). |
| `ResetTarget` | `DateTime?` | **Yes** | Local DateTime of next session reset. `null` = reset time unknown. |
| `DisplayText` | `string` | No | Pre-formatted status bar string (e.g. `"Claude: 87% used — resets in 1d 4h"`). |
| `ToolTip` | `string` | No | Multiline tooltip detail text. |
| `WeeklyPercent` | `int?` | **Yes** | Primary account Weekly (All Models) usage percentage (0–100). `null` = **unavailable** (`--`). |
| `WeeklyResetTarget` | `DateTime?` | **Yes** | Local DateTime of Primary weekly reset. `null` = unknown. |
| `WeeklyDisplayText` | `string` | No | Status bar string (e.g. `"Claude Weekly (Primary): 93% used"`). |
| `SecondaryConfigured` | `bool` | No | `true` if `SecondaryClaudeConfigDir` is non-empty and directory exists. |
| `SecondaryState` | `ClaudeUsageMeterState` | No | Meter state for Secondary account. |
| `SecondaryWeeklyPercent` | `int?` | **Yes** | Secondary account Weekly usage percentage (0–100). `null` = **unavailable** (`--`). |
| `SecondaryWeeklyResetTarget`| `DateTime?` | **Yes** | Local DateTime of Secondary weekly reset. `null` = unknown. |
| `SecondaryWeeklyDisplayText`| `string` | No | Status bar string (e.g. `"Claude Weekly (Secondary): --"`). |

### 3.5 `BuildConsoleSettings` Model
Persisted locally in `%AppData%\BuildConsole\settings.json` (`desktop/BuildConsole/Services/BuildConsoleSettings.cs:87-300`).

| Property Name | C# Type | Default Value | Description & Constraints |
| :--- | :--- | :--- | :--- |
| `GitHubPat` | `string` | `""` | GitHub Personal Access Token for API calls. |
| `ZohoApiToken` | `string` | `""` | Zoho API authentication token. |
| `EpicChatProjectUrl` | `string` | `""` | Claude project URL used when creating epic chats. |
| `SecondaryClaudeConfigDir` | `string` | `~/.claude-secondary` | Directory path for secondary account credentials (`.credentials.json`). |
| `DefaultAccount` | `string` | `"primary"` | Global account toggle (`"primary"` vs `"secondary"`). |
| `LocationMode` | `string` | `"Home"` | Connection location (`"Home"` = fibre/unmetered, `"Rental"` = capped/metered). |
| `EncouragementCrittersEnabled`| `bool` | `false` | Enables ambient encouragement critter popups. |
| `BuildCompleteSoundMuted` | `bool` | `false` | Suppresses completion audio chime when `true`. |
| `OpenChatTabs` | `List<PersistedChatTab>`| `new()` | Saved open chat tabs restored across app restarts. |
| `TestEnvVars` | `List<TestEnvVar>` | `new()` | Persisted key-value pairs for test runner variables. |
| `StickyNotesText` | `string` | `""` | Content string of floating Sticky Notes tool. |
| `VisualTestTrackerBaseUrls` | `List<string>` | `["localhost:5175/..."]` | Target dev URLs watched for visual screenshot captures. |
| `PinnedQuestionDetectionEnabled` | `bool` | `false` | **✅ Landed (#2105).** Master switch for active pinned-question detection (asking each chat for outstanding questions). Read at `BuildConsoleSettings.cs`. A real Settings-UI toggle for it is **planned (#2124, OPEN — not yet built)**; today the flag is edited in `settings.json` directly. |

> **Related, non-`settings.json` control — Max Concurrent Build Slots (✅ landed #2122).** The queue's max-concurrent limit is **not** a `BuildConsoleSettings` property; it lives in `scripts/build-queue-watcher.config.json` (`BuildTrackerConfig`). #2122 added a real **Settings → General** numeric field + Save that persists to that file via the new `BuildTrackerConfig.Save()` and live-applies to the running `QueueWatcherService` (no restart needed).

---

## 4. Real Vocabularies

### 4.1 Build Queue Statuses
Defined in `desktop/BuildConsole/Services/BuildQueuePostgresClient.cs:71`, `Services/AccountCapPolicy.cs:52`, and `Services/BuildTrackerApiClient.cs:27`.

```
               +----------+
               | queued   |
               +----+-----+
                    |
          +---------+---------+
          |                   |
    [Cap Exceeded]      [Worker Claim]
          |                   |
          v                   v
    +-----------+       +-----------+
    |  capped   |       |  running  |
    +-----+-----+       +-----+-----+
          |                   |
    [Manual Drain]      [Exit Code 0 / Error]
          |                   |
          +---------+---------+
                    |
          +---------+---------+
          |                   |
     (Exit 0)             (Exit != 0)
          |                   |
          v                   v
    +-----------+       +-----------+
    | verifying |       |  failed   |
    +-----+-----+       +-----------+
          |
    [GitHub Issue Closed]
          |
          v
    +-----------+
    |   done    |
    +-----------+
```

| Status Key | Authority Location | Real Meaning | Visual & Operational Rules |
| :--- | :--- | :--- | :--- |
| `queued` | `BuildTrackerApiClient.cs:27` | Build is waiting in database queue to be claimed by worker loop. | Normal pending build item. |
| `running` | `BuildQueuePostgresClient.cs:19` | Build process (`claude.exe`/`gemini.exe`) is actively executing under a live PID (`BuildPid`). | Active animated indicator, shows live process PID. |
| `verifying` | `BuildQueuePostgresClient.cs:71` | Process exited `0` and has a `GithubNumber`. **Stays in active queue** until live GitHub check confirms issue is closed. | Distinct from `done`. MUST remain visible in active queue view! |
| `capped` | `AccountCapPolicy.cs:52` | Claimed off queue but **parked automatically** because Conservation Cap is ON and model/effort exceeds Sonnet High. | **NEVER merge with `parked`**. Can be manually un-capped or drained. |
| `parked` | `AccountCapPolicy.cs:43` | **Manually staged** by developer before auto-run (Git #1638). | **NEVER merge with `capped`**. Represents deliberate manual staging. |
| `failed` | `BuildQueuePostgresClient.cs:19` | Process exited with non-zero code (`1`, `-2`, etc.) or failed to launch. | Red error indicator, retry action available. |
| `done` | `BuildQueuePostgresClient.cs:68` | Final terminal state (issue closed on GitHub, or process exited 0 with no linked GitHub issue). | Archived / moved to completed section. |
| `superseded` | `BuildQueuePostgresClient.cs:87` (`SupersededStatus`) | **✅ Landed (#2119).** A non-terminal-outcome row whose session was taken over by a Reply/resume replacement row (linked via `SupersededById`). Applied only when the original was not already `done`/`failed`/`canceled`/`running`. | Drops out of every active-queue filter (visible only under "All"); card renders "↩ REPLIED → #N" instead of a stale active status. |

> **CRITICAL RULE**: `capped` (conservation cap park) and `parked` (manual staging) are **two completely different statuses with different meanings**. They must NEVER be merged into a single state in design or code!

### 4.2 GitHub Board Statuses

| Column / Board Status | Set By BuildConsole | Set By Human | Description |
| :--- | :---: | :---: | :--- |
| **Batter Up** | No | **Yes** | Human-curated queue of top priority issues ready for build dispatch. |
| **AI Batter Up** | No | **Yes** | AI-selected candidate issues queued for inspection. |
| **In Progress** | **Yes** | No | Set automatically when a build is launched for an issue (`label: in-progress`). |
| **Verifying** | **Yes** | No | Set automatically when build session exits 0 (`label: verifying`). |
| **Done** | **Yes** | **Yes** | Issue closed on GitHub (by human or auto-verify). |
| **Backlog** | No | **Yes** | Open issues not yet scheduled for active work. |
| **Park** | No | **Yes** | Issues intentionally placed on hold. |

### 4.3 Models & Effort Levels

- **Supported CLI Engines**: `claude`, `gemini`.
- **Supported Models**: `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-opus`, `fable`, `gemini-2.5-pro`, `gemini-2.5-flash`.
- **Supported Effort Levels**: `low`, `medium`, `high`, `xhigh`.
- **Account Conservation Gate (`AccountCapPolicy.ExceedsSonnetHigh`)**:
  - `ExceedsSonnetHigh(model, effort)` returns `true` if:
    - Model is **Opus** (`IsOpusModel`), OR
    - Model is **Fable** (`IsFableModel`), OR
    - Effort is **`xhigh`** (`IsAboveHighEffort`).
  - When Conservation Cap is ON (`TopConservationToggleText == "On"`), any build where `ExceedsSonnetHigh` is `true` is automatically set to `capped` status when claimed, rather than launching.

### 4.4 Accounts

- **Primary Account**: Default Claude Code account configuration stored in `~/.claude/`. Uses main subscription token.
- **Secondary Account**: Overflow Claude Code account configuration stored in `SecondaryClaudeConfigDir` (default `~/.claude-secondary/`).
- BuildConsole distinguishes accounts per build item (`QueueItem.Account = "primary" | "secondary"`) and globally via the title bar account toggle (`BuildConsoleSettings.DefaultAccount`).

---

## 5. States Every Surface Must Handle

Every primary surface in the UI must explicitly account for all five standard lifecycle states plus surface-specific domain edge states.

### Standard Lifecycle States

1. **Loading**: Data is currently being fetched via HTTP/DB/CLI. Show a non-blocking activity indicator. Never freeze the UI thread.
2. **Empty**: Query succeeded but returned 0 items. Show a clear, intentional empty state message (e.g. "No queued builds", "No open issues in Batter Up").
3. **Populated**: Normal operating state showing real backing data.
4. **Error**: Network timeout, DB disconnection, 401/403 auth error, or process crash. Show explicit error details and retry controls.
5. **Stale**: Displaying cached data while a background refresh is in flight.

### Surface-Specific Domain Edge States

- **Batter Up Panel when All Items Are Hidden**: Occurs when every issue in Batter Up is already tracked in the active build queue. Must render an informative message: *"All Batter Up items are currently active in the build queue"* (preventing the bug where it rendered as a mysterious empty panel).
- **Build Queue Panel in Conservation Mode**: Occurs when Conservation Cap is enabled and builds are held in `capped` state. Capped items must display a distinct "Capped (Sonnet High limit)" badge and offer a one-click "Drain" or "Override" action.
- **Chat Panel with Missing Account Column**: Occurs when database schema migration `#1480` has not been applied (`AccountColumnMissing = true`). The UI must display an honest *"Database schema update required (account column missing)"* notice instead of silently assuming Primary.
- **Status Bar Usage Meter when Unauthenticated**: Occurs when Anthropic OAuth token is expired or missing. Must render `Claude: --` in muted grey text, NEVER `0%` and NEVER an error popup.

> **MANDATORY DESIGN RULE**: A missing value renders as **unavailable (`--`)** — NEVER as zero, NEVER as an error, and NEVER as a plausible-looking fake placeholder.

---

## 6. Current Visual Language (Historical Reference Only)

> **Context, Not Constraint**: The designer is replacing the visual appearance. This section documents the current theme solely so the designer understands existing colors and past defects.

### Catppuccin Mocha Color Palette (`desktop/BuildConsole/Themes/DarkTheme.xaml:9-33`)

```xaml
<SolidColorBrush x:Key="CrustBrush"    Color="#CC11111B"/>
<SolidColorBrush x:Key="MantleBrush"   Color="#CC181825"/>
<SolidColorBrush x:Key="BaseBrush"     Color="#661E1E2E"/>
<SolidColorBrush x:Key="Surface0Brush" Color="#313244"/>
<SolidColorBrush x:Key="Surface1Brush" Color="#45475A"/>
<SolidColorBrush x:Key="Surface2Brush" Color="#585B70"/>
<SolidColorBrush x:Key="OverlayBrush"  Color="#6C7086"/>
<SolidColorBrush x:Key="TextBrush"     Color="#CDD6F4"/>
<SolidColorBrush x:Key="Subtext0Brush" Color="#BAC2DE"/>
<SolidColorBrush x:Key="Subtext1Brush" Color="#A6ADC8"/>
<SolidColorBrush x:Key="BlueBrush"     Color="#89B4FA"/>
<SolidColorBrush x:Key="MauveBrush"    Color="#CBA6F7"/>
<SolidColorBrush x:Key="GreenBrush"    Color="#A6E3A1"/>
<SolidColorBrush x:Key="RedBrush"      Color="#F38BA8"/>
<SolidColorBrush x:Key="PeachBrush"    Color="#FAB387"/>
<SolidColorBrush x:Key="YellowBrush"   Color="#F9E2AF"/>
<SolidColorBrush x:Key="SkyBrush"       Color="#89DCEB"/>
<SolidColorBrush x:Key="SapphireBrush"  Color="#74C7EC"/>
<SolidColorBrush x:Key="LavenderBrush"  Color="#B4BEFE"/>
<SolidColorBrush x:Key="TealBrush"      Color="#94E2D5"/>
<SolidColorBrush x:Key="PinkBrush"      Color="#F5C2E7"/>
<SolidColorBrush x:Key="FlamingoBrush"  Color="#F2CDCD"/>
<SolidColorBrush x:Key="RosewaterBrush" Color="#F5E0DC"/>
<SolidColorBrush x:Key="MaroonBrush"    Color="#EBA0AC"/>
```

### Binding Visual Constraints

1. **Dark Mode Only**: BuildConsole operates exclusively in dark mode. There is no light theme and none will be added.
2. **No Bright Saturated Fills**: Background containers, toggle buttons, and active rows must use dark muted surfaces (`Surface0Brush` `#313244`, `MantleBrush` `#181825`). Accent colors (`BlueBrush`, `GreenBrush`, `MauveBrush`) belong **strictly on text, icons, and thin borders**.
   - *Historical Defect*: Unstyled WPF controls (like bare `ToggleButton`s) fall back to Windows OS default theme chrome, painting solid bright blue fills over unreadable white text (Git #1809, #1810, #1996). Every control template must be explicitly styled.
3. **Emoji Glyphs**: Emoji glyphs (e.g. ⚾, 🔍, ⚡, 📌, 🟢) currently appear in context menus, status bars, and title bar buttons. The designer may retain, replace, or refine them as desired for this internal developer tool.

---

## 7. Interaction Inventory

These user interaction capabilities are essential features that must survive any visual redesign.

### Context Menus

1. **Build Card Menu** (`BuildQueuePanel.xaml`):
   - *Cancel Build*: Cancels a queued build.
   - *Edit Prompt*: Opens `EditBuildPromptDialog`.
   - *Set Blocked By*: Opens `SetBlockedByDialog`.
   - *Resume Session*: Opens `ReplyDialog` with `ResumeSessionId`.
   - *Switch Account*: Toggles build item between Primary and Secondary accounts.
   - *Un-cap / Release*: Releases a `capped` build to run immediately.
2. **Build-Set Rollup Row Menu** (`BuildQueuePanel.xaml`):
   - *Restart Build-Set*: Re-queues all member builds in a set.
   - *Cancel Build-Set*: Cancels all active builds sharing a `BuildSet` tag.
3. **Git Board Item Menu** (`LeftSidebar.xaml`):
   - *Queue Build*: Immediately dispatches a build for the selected issue.
   - *Edit Issue*: Opens `EditIssueDialog`.
   - *Assign Epic*: Opens `AssignEpicDialog`.
   - *Close Issue*: Closes issue directly on GitHub.
4. **Editor Tab Menu** (`MainWindow.xaml`):
   - *Close Tab*: Closes current tab (`Ctrl+W`).
   - *Close Others / Close All*: Bulk tab management.
   - *Pin Tab*: Pins tab to Pinned Strip bar.
   - *Move to Pane*: Moves tab between Editor Panes 1, 2, 3, or 4.

### Keyboard Shortcuts

- `Ctrl+N`: Open New Chat tab.
- `Ctrl+Tab`: Trigger `TabSwitcherOverlay` (visual open document switcher).
- `Ctrl+B`: Toggle Left Sidebar visibility.
- ``Ctrl+` ``: Toggle Bottom Logs Panel visibility.
- `Ctrl+K`: Focus Title Bar Search Box / Open `CommandPaletteOverlay`.
- `Ctrl+P`: Quick open file / document.
- `Ctrl++` / `Ctrl+-` / `Ctrl+0`: Zoom In, Zoom Out, Reset Zoom on active WebView2 chat.
- `PrintScreen`: Trigger `RegionSelectOverlayWindow` desktop screen clip.

### Drag & Drop & Multi-Pane Docking

- Dragging an editor tab displays `DockGuideOverlay`, allowing the user to drop the tab into Left Split (`SplitH`), Right Split (`SplitH_Right`), Top/Bottom (`SplitV`), or 2x2 Grid (`Grid4`).
- Dragging build cards in `BuildQueuePanel` allows manual queue reordering.

---

## 8. Known UI Debt

The designer must be aware of these documented historical UI defects to avoid repeating past failures:

1. **Unstyled `ToggleButton` Chroming (Git #1809, #1810, #1996)**:
   - *Defect*: Placing a standard `<ToggleButton>` without an explicit `Style="{StaticResource ...}"` caused WPF to use Windows system fallback chrome, turning checked buttons into solid bright neon-blue rectangles with unreadable text.
   - *Requirement*: Every interactive toggle or button must have an explicit control template with dark background surfaces.
2. **Card Density & Title Line Wrapping (Git #1801)**:
   - *Defect*: Unconstrained issue title labels wrapped to 3 or 4 lines inside build cards, causing card heights to balloon from 80px to over 200px and destroying vertical queue density.
   - *Requirement*: Truncate long titles with `TextTrimming="CharacterEllipsis"` and restrict titles to maximum 2 lines.
3. **Silent Content Truncation & Hiding (Git #1784, #1977, #1995, #1997)**:
   - *Defect*: GitHub issue pagination hit page limits silently, dropping issues from view without warning (#1784/#1995). Focus Mode filtering to a 100% complete milestone silently emptied the Git Board (#1977).
   - *Requirement*: Never truncate or filter content silently. If items are hidden, display a clear counter notice (e.g. *"Showing 50 of 180 issues — click to load more"*).
4. **Stale "waiting on #N" text disagreeing with the BLOCKED badge (Git #2070 — ✅ fixed; #2107 open)**:
   - *Defect*: A build card's "waiting on #N" text was built from the raw `BlockedBy` list with no filter against the open-issue set, so it kept naming a blocker that had already closed even after the BLOCKED/UP-NEXT badge (which *was* filtered) correctly updated.
   - *Status*: Fixed by `LiveBlockedBy` applying the same open-issue filter to the text (#2070). A deeper instance — the badge itself going stale because `_openIssues` only refreshes on Git Board manual-refresh/tab-open (the 2026-08-14 no-background-polling policy) — is filed as **#2107** (OPEN) and is a real product tradeoff, not yet resolved.
5. **Dead Wiring / Unhandled Menu Items**:
   - *Defect*: Several top menu items in `MainWindow.xaml` lack C# click handlers:
     - `_File -> Open Session…` (`MainWindow.xaml:136`)
     - `_Edit -> Undo`, `Redo`, `Cut`, `Copy`, `Paste` (`MainWindow.xaml:144-149`)
     - `_Run -> Run Verification` (`MainWindow.xaml:180`)
     - `_Help -> About BuildConsole` (`MainWindow.xaml:204`)
   - *Requirement*: The designer may streamline or remove unhandled placeholder menu items.

---

## 9. Constraints the Designer Must Respect

1. **WPF / XAML Desktop Framework (Not Web)**:
   - BuildConsole is built strictly in C# / XAML (.NET 8 WPF).
   - Layout MUST use WPF primitives (`Grid`, `StackPanel`, `DockPanel`, `ScrollViewer`, `WrapPanel`).
   - Styling MUST use WPF `ResourceDictionary`, `Style`, `ControlTemplate`, and `DataTemplate`. Do not propose CSS, flexbox, or HTML/browser layout idioms.
2. **Desktop Display Profile**:
   - Single-user desktop app running all day on 1080p, 1440p, or 4K monitors (minimum window size `1680x960`, maximized by default).
   - Not responsive, not mobile, not web-hosted.
3. **External Hosting Containers**:
   - `ChatSessionPane` embeds an actual Microsoft `WebView2` browser control loading `claude.ai`. The inner webpage styles are controlled by Anthropic; BuildConsole only styles the WPF wrapper header and injected button toolbar.
   - `TerminalView` and `BuildLogView` embed WPF `TextBox` controls receiving real-time ANSI terminal streams.
4. **Real Operational Data Volumes**:
   - **Queue Depth**: Up to 60+ active/queued build items at once.
   - **GitHub Issue Corpus**: Over 1,700+ issues in `shanemccaw/Shane-McCaw-MSP`.
   - **Build Sets**: Up to 10+ concurrent named build sets.
   - **Concurrency**: Up to 8 concurrent active build executions.
   - Design layouts must comfortably handle these realistic scale numbers without clipping or performance degradation.

---

## 10. What I Could Not Determine

1. **`Unused` / Legacy Replit API Extensions**:
   - Inspected `Services/BuildTrackerApiClient.cs`. Legacy HTTP methods for `/extension/queue/next` remain in code for back-compat alongside the primary `BuildQueuePostgresClient` direct connection. It could not be determined if external Replit scripts still call those HTTP endpoints.
2. **Third-Party WPF Theme Assemblies**:
   - Inspected `BuildConsole.csproj`. The app uses pure custom XAML resource dictionaries (`Themes/DarkTheme.xaml`) and standard WPF controls; no third-party WPF UI libraries (like MaterialDesignInXaml or MahApps.Metro) are referenced.

---
*End of BuildConsole UI Contract Pack (docs/buildconsole-contract-pack.md)*
