# BuildConsole Contract Pack — ActivityBar, Settings & App-Wide Chrome

> **Notice for UI Designers (e.g., Claude Design)**
> This document is the authoritative specification for BuildConsole's **app-wide chrome** — the left
> **ActivityBar** rail, the **title bar / top chrome**, the native **Settings** tab, the **Test Pad**
> floaty, and the **Sticky Notes** floaty. Every field, glyph, tooltip, label, colour key, control name,
> and interaction below was extracted by reading the real C#/.NET 8 WPF code under
> `desktop/BuildConsole/` — not from memory, not from the intended design. Where a value is a literal in
> the code (a caption, a tooltip, a status string, a Segoe MDL2 glyph, a brush resource key) it is quoted
> verbatim.
>
> You have **full creative freedom over visual appearance** (layout, spacing, typography, iconography,
> the dark aesthetic, micro-interactions). You have **zero freedom over what exists**: do not invent a
> button, a toggle, a settings category, a note type, or a capability that has no backing code here. A
> value with no data renders as its honest empty state (`--`, a collapsed control, or the literal
> empty-state strings quoted below) — never as a fabricated placeholder.

> **Provenance / verification.** Written for GitHub issue #3019 (sub-issue of #3013,
> `Feature: BuildConsole Contract Packs`). Confirmed against the working tree at the commit recorded in
> `build-journal/3019.md`. Citations are `path:line`, relative to `desktop/BuildConsole/`. This describes
> **what is built and working now**. A handful of clearly-marked forward references (e.g. the Encouragement
> Critter, redesign epics) name deliberately-unbuilt or off-by-default surfaces.

> **Scope boundary — what is documented elsewhere.** The five sibling contract packs under #3013 own their
> own surfaces; this pack does **not** re-document them, it only documents the chrome that opens them:
> - Git Board & Chats Panel (the LeftSidebar tree/filters) → `docs/buildconsole-gitboard-contract-pack.md`
> - Batter Up / AI Batter Up / Build Queue Panel → `docs/buildconsole-queue-contract-pack.md`
> - Chat Document Container → `docs/buildconsole-chatcontainer-contract-pack.md`
> - Home dashboard → covered under #3016
> - Full-page tools: Log Viewer, Git Doctor (full tab), Local Map / Git Map windows → covered under #3018
>
> Where an ActivityBar icon or top-bar control opens one of those, this pack documents the **launcher**
> (glyph, tooltip, what it opens, how) and points at the owning pack for the destination's internals.
> The general BuildConsole pack (`docs/buildconsole-contract-pack.md`) holds the cross-cutting data model
> and status vocabularies.

---

## 1. Palette / shared resource keys

Every colour below is a `StaticResource` brush key (a Catppuccin Mocha dark theme; the General settings
page lists it as `Catppuccin Mocha (Default Dark)`, `SettingsTabView.xaml:509`). Designs may restyle
freely, but the **semantic role** of each key is fixed:

| Brush key | Role in this chrome |
| :--- | :--- |
| `CrustBrush` | Deepest surface — the ActivityBar background, sticky-note header strip, dialog title bars. |
| `MantleBrush` | Panel background — popups, Settings header/nav column, settings cards. |
| `BaseBrush` | Content background — note text box, Settings content area. |
| `Surface0Brush` / `Surface1Brush` | Borders, separators, dividers, chip/input fills. |
| `BorderDividerBrush` | Test Pad / dialog border + divider (the ShaneBuilder-ported surfaces use this key). |
| `TextBrush` / `TextPrimaryBrush` | Primary text. |
| `Subtext0Brush` / `Subtext1Brush` / `TextSecondaryBrush` | Secondary/dim text, hints, empty-state copy. |
| `TextDisabledBrush` | Locked/sent text, pipeline caption. |
| `BlueBrush` | Info accent (Graph icon, Web Tools, "Send to Claude", Question chip, secondary-account state). |
| `GreenBrush` / `StatusSuccessBrush` / `StatusRunningBrush` | Success, "SENT" badge, save-confirmation text, Build Watch icon. |
| `RedBrush` | Destructive / attention (Git Doctor icon, count badges, close-button hover, Bug chip). |
| `PeachBrush` | Warm accent (Replit icon, Settings section headers, Conservation toggle, Idea chip). |
| `MauveBrush` | Secondary accent ([AGENT] marker, Dev Tools/API Runner icons, Customer Portal fixed web tool). |
| `YellowBrush` | shaneapp:// live indicator bolt. |

Segoe MDL2 Assets glyphs are quoted by hex code point throughout (`&#xE8BD;` etc.). Some icons are
literal emoji (`🎯`, `🗺`, `🗂`, `🗒`, `⚾`) rather than MDL2 — those are quoted as emoji, matching the code.

---

## 2. The ActivityBar (left rail)

**File:** `Controls/ActivityBar.xaml(.cs)`. A fixed **48px-wide** vertical `UserControl`
(`ActivityBar.xaml:4`) docked at the far left. Background `CrustBrush`, a 1px right border in
`Surface0Brush` (`ActivityBar.xaml:6-8`). Its children live in a `DockPanel` (`LastChildFill="False"`):
a top `StackPanel` of icons and a bottom `StackPanel` holding only the Settings cog.

Two visual/behavioural button archetypes are used:

- **Workspace `RadioButton`s** — `GroupName="ActivityBar"`, `Style="{StaticResource ActivityBarButton}"`.
  Mutually exclusive; the checked one is the active LeftSidebar view. Checking one raises
  `ActiveViewChanged(Tag)` (`ActivityBar.xaml.cs:52-56`).
- **Plain `Button`s** — `Style="{StaticResource IconButton}"`, `Width=48 Height=44`. Each opens a separate
  window/tab/popup and does **not** participate in the workspace radio group.

### 2.1 Workspace nav icons (top group) — the view router

Each RadioButton's `Tag` is forwarded verbatim to `MainWindow.ActivityBar_ActiveViewChanged`
(`MainWindow.xaml.cs:6664`), which calls `LeftSidebar.SwitchView(view)`. **VS Code behaviour:** clicking
the already-active icon collapses the sidebar to width 0; clicking any icon while collapsed re-expands it
to `DefaultSidebarWidth` (`MainWindow.xaml.cs:6673-6688`).

| Order | `x:Name` | `Tag` | ToolTip (verbatim) | Icon (verbatim) | Opens |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | `BtnChats` | `Chats` | `Chats` | `&#xE8BD;` (MDL2) — **checked by default** (`IsChecked="True"`) | Chats view → chatcontainer / gitboard packs |
| 2 | `BtnExplorer` | `Explorer` | `Explorer` | `&#xE8A5;` | File Explorer view |
| 3 | `BtnSearch` | `Search` | `Search` | `&#xE721;` | Search view |
| 4 | `BtnGit` | `Git` | `Source Control` | inline vector `Path` — VS Code's "source-control" codicon geometry, 24×24, filled from the button's `Foreground` (`ActivityBar.xaml:51-54`; MDL2/Fluent has no git glyph, per the #867 note) | Source Control view |
| 5 | `BtnIssues` | `Issues` | `Git Milestones, Epics & Issues Tracker` | `🎯` (emoji) | Git Board → gitboard pack. Also targeted by `SelectGitBoard()` (`ActivityBar.xaml.cs:50`) |
| 6 | `BtnAutomation` | `Automation` | `UI Automation Suite` | Grid: `&#xE768;` (Play) with `&#xEBE8;` (Bug) badged bottom-right (`ActivityBar.xaml:75-80`) | UI Automation / test-runner view |
| 7 | `BtnGraphApi` | `GraphApi` | `Microsoft Graph API Panel` | `&#xE9A1;` in `BlueBrush` | Microsoft Graph API panel |

The bottom group holds one workspace RadioButton:

| `x:Name` | `Tag` | ToolTip | Icon | Note |
| :-- | :-- | :-- | :-- | :-- |
| `BtnSettings` | `Settings` | `Settings` | `&#xE713;` | When checked, `ActiveViewChanged` **both** opens/focuses the native Settings tab (`OpenSettingsTab()`, `MainWindow.xaml.cs:6670-6671`) and shows the sidebar's Settings category nav. `SelectSettings()` (`ActivityBar.xaml.cs:49`) is the entry point `File > Settings` (`MenuSettings_Click`) also uses. See §4. |

### 2.2 Standalone action buttons (top group, in visual order)

Separators are 1px `Surface0Brush` borders with `Margin="8,6"` between logical groups.

| `x:Name` | ToolTip (verbatim) | Icon | Colour | Action (handler → event) |
| :-- | :-- | :-- | :-- | :-- |
| `BtnGitDoctor` | `Git Doctor — real repo status, diagnostic findings, branch & commit tools` | `&#xE95E;` | `RedBrush` | `GitDoctorRequested` → `OpenGitDoctorTab()` — a full-width Editor **tab**, not a sidebar view (#2809). Internals → full-page-tools pack. |
| *(Replit)* | `Replit Workspace` | `&#xE7B8;` | `PeachBrush` | `QuickNav_Click` with `Tag` = `https://replit.com/@shanemccaw/Shane-McCaw-Consulting` → `QuickNavRequested(url)`. Opens a WebView2 tab with a keep-alive Play/Pause toggle (#821, `MainWindow.xaml.cs:2266-2281`). |
| `BtnWebTools` | `Web Tools` | `&#xE71B;` | `BlueBrush` | `BtnWebTools_Click` → opens the **Web Tools popup** (§2.3). |
| `BtnStickyNotes` | `Sticky Notes (always-on-top floaty)` | `&#x1F5D2;` (🗒) | default | `StickyNotesToggleRequested` → `ToggleStickyNotes()` (§6). |
| `BtnLinkedInComposer` | `LinkedIn Post pre-fill (always-on-top floaty)` | `&#xE71B;` | `BlueBrush` | `LinkedInComposerToggleRequested` → `ToggleLinkedInComposer()` (#973; `MainWindow.LinkedInComposer.cs:25`). |
| `BtnBuildWatch` | `Build Watch — 8-slot live build monitor (floaty)` | `&#xE7F4;` | `GreenBrush` | `BuildWatchToggleRequested` → `ToggleBuildWatch()` — opens `BuildWatchWindow` (#980; `MainWindow.xaml.cs:1837`). Build monitoring internals → queue pack. |
| `BtnBuildChainMap` | `Build Chain Map — Epic → Feature → Issue → blocked_by, live GitHub read/write (maximized)` | `&#x1F5FA;` (🗺) | default | `BuildChainMapRequested` → `OpenBuildChainMap()`. Shows a **Git Map / Local Map** picker first, then opens a maximized window scoped to one Epic (#2483/#2807; `MainWindow.xaml.cs:1876`). Windows → full-page-tools pack. |
| `BtnVisualTestTracker` | `Visual Test Tracker — per-page checkbox/notes + screenshot history (floaty)` | `&#xE722;` | `BlueBrush` | `VisualTestTrackerToggleRequested` → `ToggleVisualTestTracker()` (#1472; `MainWindow.xaml.cs:2039`). |
| `BtnShelf` | `Shelf — tabs set aside & kept alive in the background (right-click a tab → Shelve Tab)` | `&#x1F5C3;` (🗃) + red count badge | default | `ShelfOpenRequested` → `ShowShelf(...)` (§2.4). |

**Retired / moved (do not add):** Admin Center, Customer Portal, and Marketing Site were removed as
standalone rail buttons in #2797 and now live as fixed rows at the top of the Web Tools popup (§2.3). The
#2110 "Build Queue Map" floaty was retired in favour of Build Chain Map (#2483).

### 2.3 Web Tools popup (`WebToolsPopup`)

Anchored `Placement="Right"` off `BtnWebTools`, `StaysOpen="False"`, fade animation, `MinWidth="180"`,
`MantleBrush` background with a `Surface0Brush` 1px border and `CornerRadius="4"` (`ActivityBar.xaml:140-154`).
Rebuilt fresh on every open (so Settings edits show without a restart — `BtnWebTools_Click`,
`ActivityBar.xaml.cs:147`). Contents, top to bottom:

1. **Three fixed rows** (`FixedWebTools`, `ActivityBar.xaml.cs:139-144`) — not user-configurable:
   | Row label | Colour key | URL |
   | :-- | :-- | :-- |
   | `Admin Center` | `PeachBrush` | `http://localhost:5174` |
   | `Customer Portal` | `MauveBrush` | `http://localhost:5175` |
   | `Marketing Site` | `GreenBrush` | `http://localhost:5173` |
   Each row is an `IconButton` (left-aligned, glyph + label). Click → `QuickNavRequested(url)` and closes
   the popup (`FixedWebTool_Click`, `ActivityBar.xaml.cs:310-317`). `ActivityBar_QuickNavRequested` derives
   the tab title/glyph from the URL (`MainWindow.xaml.cs:2268-2274`).
2. **A separator** (1px `Surface0Brush`).
3. **User-configured entries** from `settings.WebTools` (a `List<WebToolEntry>` — fields `Name`, `Url`,
   `Icon`; `BuildConsoleSettings.cs:10-15`). Each row: a `Segoe MDL2 Assets` glyph (the entry's `Icon`,
   `BlueBrush`, 16px) + `Name`. Click → `WebToolRequested((Name, Url))` → `OpenWebTab` (auto-prepends
   `https://` if no scheme; `MainWindow.xaml.cs:2334-2343`). **Favicon enrichment:** for each entry,
   `LoadFaviconAsync` fetches (or reads the on-disk cache via `FaviconCacheService`) the real favicon and
   swaps it in for the glyph once ready; on any failure the glyph stays (`ActivityBar.xaml.cs:253-296`).
4. **Empty state** when `settings.WebTools.Count == 0`: the literal
   `No web tools configured — add some in Settings.` (`ActivityBar.xaml.cs:200`).

Configured entries are managed on the **Web Tools** settings page (§4.9).

### 2.4 Shelf popup (`ShelfPopup`)

Anchored right off `BtnShelf`, `MantleBrush` / `Surface0Brush` border, `MinWidth="220" MaxWidth="340"`,
header caption `🗃 SHELF` in `Subtext0Brush` (`ActivityBar.xaml:256-275`). MainWindow owns the shelved-tab
state and hands the rows to `ShowShelf(IReadOnlyList<UIElement>)` (`ActivityBar.xaml.cs:94-114`). A tab is
shelved via its own right-click context menu → "Shelve Tab"; the tab leaves the bar but keeps running
alive off-screen (reuses the #972/#982 keep-alive; `MainWindow.ShelvedTabs.cs`). Each row restores the tab
live on click.
- **Empty state:** `Nothing shelved. Right-click a tab → Shelve Tab to park it here — it stays alive in the background.` (`ActivityBar.xaml.cs:101`).
- **Count badge** (`ShelfCountBadge`/`ShelfCountText`) on the icon: red pill, hidden at 0, shows `99+` above 99 (`SetShelfCount`, `ActivityBar.xaml.cs:121-125`).

---

## 3. Title bar / top chrome (`MainWindow.xaml`)

`WindowStyle="None"` with a custom `WindowChrome` drag bar; the caption row is a three-column grid. All
interactive controls carry `WindowChrome.IsHitTestVisibleInChrome="True"` so clicks reach them inside the
drag region. Left = title/menu + mode markers; centre = universal search; right = quick-action group +
real caption buttons.

### 3.1 Mode markers (left)
- `[AGENT]` (`AgentModeMarkerText`, `MauveBrush`) — shown when `AppMode.IsAgent`; tooltip
  `Passive agent shell (--agent): no builds are claimed, launched, deployed or tested, and the shaneapp:// pipe is not taken.` (`MainWindow.xaml:260-268`).

### 3.2 Universal search (centre)
- `SearchBorder` / `TitleSearchBox` — `Surface0Brush` pill, `Width=240` (`MinWidth=180`, `MaxWidth=820`),
  `CornerRadius="6"`, 🔍 leading glyph. Placeholder `Search files, issues, chats…`
  (`SearchPlaceholder`, `MainWindow.xaml:303-304`). Trailing `Ctrl+K` hint (`SearchCtrlKHint`).
  Focus/typing opens the grouped `CommandPaletteOverlay` results dropdown; `Ctrl+K` focuses it
  (`MainWindow.xaml:271-327`).

### 3.3 Quick-action group (right, in order)

| Control | Type | States / verbatim text |
| :-- | :-- | :-- |
| `TopShaneAppIndicator` | badge, hidden by default | ⚡ + `RUNNING`; tooltip `shaneapp:// is executing — Click to view live streaming console` (`MainWindow.xaml:338-352`). |
| `TopAccountToggleBorder` | toggle | `Account:` + `Primary`/`Secondary` (`TopAccountToggleText`). Primary = neutral `Surface0Brush`; Secondary = `Surface1Brush` fill + `BlueBrush` border/text. Flips `settings.DefaultAccount` for **new** builds only (per-build `--account` still wins). Tooltips quoted at `MainWindow.xaml.cs:6784-6786`. (#1419) |
| `TopLocationToggleBorder` | toggle | `Location:` + `Home`/`Rental` (`TopLocationToggleText`). Manual only, never auto-detected. Drives `BUILD_NETWORK`, the network header flag, `.pnpmfile.cjs` metered-install refusal, and the version-update deploy override. (#1986) |
| `TopAutomationToggleBorder` | toggle | `Auto:` + `Off`/on + `TopAutomationStatusText`. Green accent when acting on live usage data; fails closed on stale/errored readings. Off by default. (#2003) |
| `TopConservationToggleBorder` | toggle | `Conservation:` + `Off`/on + `TopConservationUsageText` (real weekly usage % + reset countdown). When on, no build above Sonnet High launches — it is **parked** (never silently downgraded). Peach idiom. (#1989) |
| `BtnDrainCapped` | button + count | `Drain` + count (`TopDrainCappedCount`). Releases every capped build back to the queue at its original model/effort and turns Conservation off. Tooltip `Drain: release every capped build back to the queue at its full original model, and turn Conservation off`. Confirms with the real count first. (#1989) |
| *(separator)* | 1px `Surface1Brush`, 18px tall (#1866). | |
| `BtnScreenClip` | button | `&#xE7A8;` `BlueBrush`; tooltip `Screen clip (PrintScreen) - drag a region to the clipboard and disk` (#1866). |
| `BtnBatterUp` | button + count | `⚾` + `TopBatterUpCount` (calm at 0). Tooltip `Batter Up`; `AutomationId="BtnBatterUp"`. Opens the Batter Up document tab → queue pack (#1872). |
| `BtnAiBatterUp` | button + count | `🔍` + `TopAiBatterUpCount`. Tooltip `AI Batter Up`. Opens the AI Batter Up tab → queue pack. |
| *(sidebar toggles)* | 3 buttons | `Toggle Primary Side Bar (Ctrl+B)` `&#xE899;`, `Toggle Panel (Ctrl+\`)` `&#xE90A;`, `Toggle Secondary Side Bar` `&#xE89A;` (`MainWindow.xaml:519-536`). |
| *(Dev Tools)* | button | `Developer Tools` `&#xE7BE;` `MauveBrush`. |
| `TopServicesMenuItem` | menu | Header: status dot (`TopServicesStatusDot`, 🟢) + `Services` + ▾. Per-service items built at startup from `DevServicesManager.KnownServices` (`services.json`, #1782). Fixed items: `▶ Start All Services`, `⏹ Stop All Services`, `⟳ Refresh Services Status` (`MainWindow.xaml:544-573`). |
| *(API Runner)* | button | `API Runner` `&#xEC15;` `MauveBrush`. |
| `BtnMinimize` / `BtnMaximizeRestore` / `BtnCloseWindow` | caption buttons | Real min/max/close (`&#xE921;`/`&#xE922;`/`&#xE8BB;`) — WindowStyle=None removes the OS caption, so these are custom (#894; `MainWindow.xaml:595-604`). Known limitation: no Win11 Snap-Layouts hover flyout. |

A `StatusBar` docks along the bottom (nav dot + status, URL, zoom; `MainWindow.xaml:613+`). It is chrome
shared across every view and is treated as background context here.

---

## 4. Settings tab (`Controls/SettingsTabView.xaml(.cs)`)

### 4.1 Hosting & lifecycle
Settings is a **single Editor tab**, not a dialog. `OpenSettingsTab(category?)`
(`MainWindow.SettingsTab.cs:30`) focuses the tab if already open (dedup key `settings:main`), else builds
it via `AddSettingsTab` — same header/close/context-menu/drag recipe as any Git detail tab. Tab header:
`⚙` + `Settings`, close `✕` tooltip `Close Tab` (`MainWindow.SettingsTab.cs:82-139`). Both the ActivityBar
cog and `File > Settings` route here; the sidebar's Settings category list opens it scrolled to a section
(`ScrollToSection(category)`).

Several settings **live-apply** on save, no restart (wired per tab instance):
`ReplitWatcherSettingsChanged → _replitWatcher.ApplyConfig()` (#902) and
`ScheduleSettingsChanged → _regressionScheduler.ApplyConfig()` (#967) (`MainWindow.SettingsTab.cs:56-58`);
Max-concurrent via `UpdateMaxConcurrentBuildSlots → _queueWatcher.UpdateMaxConcurrent`
(#2122, `MainWindow.SettingsTab.cs:78`); the usage readout and Location toggles refresh their title-bar
UI on save (`SettingsTabView.xaml.cs:123,154`). Encouragement/Pinned-question toggles persist only (take
effect on next launch / next probe). `SelectCategory` (`SettingsTabView.xaml.cs:185-211`) shows exactly one
page and collapses the rest; **the default page on open is Test Environment**.

### 4.2 Layout
Two rows: a header/dashboard bar (`MantleBrush`) over a two-column split — a **230px left category nav**
(`MantleBrush`) and a scrolling **right content area** (`RootScroll`, content `MaxWidth="880"`,
`SettingsTabView.xaml:98-102,264-266`). Each category is a separate `StackPanel` page toggled
Visible/Collapsed by `NavButton_Click` on the nav buttons; only one page is visible at a time
(`PageTestEnvironment` is the default-visible page, `SettingsTabView.xaml:269`).

### 4.3 Header dashboard
Title `Settings & Environment` (⚙, `SettingsTabView.xaml:24`) + subtitle
`Configure test variables, API credentials, automated watchers, and tool integrations.` Below it, a row of
**clickable health pills** (each navigates to its page):

| Pill | Static label | Dynamic text (`x:Name`) | Default |
| :-- | :-- | :-- | :-- |
| Test Variables | `🧪 Test Variables: ` | `TestEnvHealthText` | `Loading...` |
| GitHub PAT | `🔑 GitHub PAT: ` | `GitHubPatHealthText` | `Configured` |
| Zoho API | `☁️ Zoho API: ` | `ZohoTokenHealthText` | `Configured` |
| Replit Watcher | `🔁 Replit Watcher: ` | `ReplitWatcherHealthText` | `Inactive` |

Top-right: a **`Search Settings & Variables`** box (`SettingsSearchBox`, 🔍, filters as you type via
`SettingsSearchBox_TextChanged`, `SettingsTabView.xaml:76-93`).

### 4.4 Left category nav (11 items, in order)
`CATEGORIES` header, then one `IconButton` per page (`Tag` drives `NavButton_Click`):

| Order | `x:Name` | Emoji | Label (verbatim) | Page |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `NavBtnTestEnvironment` | 🧪 | `Test Environment` | §4.5. Carries an alert pill (`TestEnvAlertPill`/`TestEnvAlertCount`, `!`). |
| 2 | `NavBtnCredentials` | 🔑 | `API Credentials` | §4.6 |
| 3 | `NavBtnGeneral` | ⚙ | `General & API` | §4.7 |
| 4 | `NavBtnReplitWatcher` | 🔁 | `Replit Watcher` | §4.8 |
| 5 | `NavBtnScheduledRun` | ⏰ | `Scheduled Runs` | §4.8 |
| 6 | `NavBtnSshRemote` | 🖥️ | `SSH & Remote (Replit)` | §4.10 |
| 7 | `NavBtnWebTools` | 🌐 | `Web Tools` | §4.9 |
| 8 | `NavBtnChatIntegration` | 💬 | `Claude Projects` | §4.11 |
| 9 | `NavBtnBuildSound` | 🔊 | `Sound & Audio` | §4.11 |
| 10 | `NavBtnLinkedIn` | 💼 | `LinkedIn Pre-fill` | §4.11 |
| 11 | `NavBtnUserAccounts` | 👥 | `User Accounts & Tiers` | §4.12 |

Every page is a `MantleBrush` card (`CornerRadius="10"`, `Surface0Brush` border) with a Peach/Blue section
header. Save buttons use `PrimaryButton`; each save writes a `StatusSuccessBrush` confirmation into a
`…SavedText` `TextBlock` (User-Accounts confirmations auto-clear after 3s). Verbatim confirmation strings
(confirmed in `SettingsTabView.xaml.cs`): GitHub PAT `GitHub PAT saved successfully.`, copy
`✓ GitHub PAT copied to clipboard!`; Zoho `Zoho API token saved successfully.`; Max Concurrent (applied)
`✓ Saved and applied live — {value} max concurrent (takes effect on the watcher's next ~10s poll, no restart needed).`;
Location `Saved — Rental (metered). Network-heavy work is now gated.` / `Saved — Home (unmetered).`; Replit
`Watcher settings saved.`; Scheduled `Schedule saved.`; Claude Projects `Project URL saved.`; LinkedIn
`LinkedIn settings saved.`; Sound `Sound preference saved.` / `Reset to bundled default sound.`; SSH
`✓ SSH settings saved ({HH:mm:ss})`, test states `⏳ Testing SSH connection…` → `✓ Connected in {latency}ms ({time})` / `✕ Connection failed: {msg}`.
Test-env card actions also raise `ToastEngine` toasts (`Added`/`Saved`/`Removed`/`Copied`).

**Validation:** Max Concurrent rejects non-numeric or `< 1` with red `Enter a whole number of at least 1.`;
Replit/Scheduled intervals apply only if `>= 1` (else silently unchanged); Add Variable / Add Web Tool
silently no-op on a blank required field; a blank username on User Accounts shows a `Validation Error`
MessageBox `Please enter a username or email.`; a User-Account delete confirms via MessageBox, a Web Tool
remove does not.

### 4.5 Page: Test Environment (`PageTestEnvironment`)
Header `Test Environment Variables` (🧪, Peach). Description:
`Values injected into test manifests resolving {{NAME}} placeholders (e.g. GRAPH_TEST_TENANT_ID, TEST_PORTAL_PASSWORD)…`
Controls:
- `BtnRescanManifests` — `🔄 Rescan Manifests`; `BtnToggleAddVarCard` — `➕ Add Variable` (Primary).
- Automation card: `AutoRunPostBuildTestsCheck` = `⚡ Auto-run matching test manifest when a build finishes deploying`; `AutoRunFullSuiteFallbackCheck` = `⚠️ Run full regression suite if build has no matching issue test (Off by default)`.
- `TestEnvSearchBox` — placeholder `Search variables by name, value, manifest file, or area...`.
- `AddVarCard` (collapsible, hidden by default): `Create New Environment Variable`; `TestEnvVarNameBox`
  (label `Variable Name (e.g. GRAPH_TEST_TENANT_ID)`), `TestEnvVarValueBox` (`Value`); `BtnCancelAddVar`
  (`Cancel`), `BtnAddTestEnvVar` (`Save Variable`).
- `EnvCategoryChipsPanel` (dynamic category filter chips, e.g. `All (N)`, `⚠️ Needs Review (N)`) +
  `TestEnvVarsSettingsList` (dynamic variable cards). Both populated at runtime from real scanned
  manifests — no fixed list. Each variable card (`BuildVariableCard`, `SettingsTabView.xaml.cs:573-822`)
  carries a masked value box + reveal (`👁`/`🔒`, tooltips `Reveal Value`/`Mask Value`), copy (`📋`,
  `Copy to Clipboard`), `Save`, delete (`🗑`, `Delete Variable`), and a status pill `⚠️ NEEDS VALUE` /
  `✅ CONFIGURED`. Empty state: `No test environment variables matched the current filter.` Categories are
  inferred (`InferCategory`): `Microsoft Graph`, `Zoho CRM`, `Auth & Security`, `Billing & Payments`,
  `Mailer`, `AI & Copilot`, `Admin`, `Smoke`, `Observability`, `General`.

### 4.6 Page: API Credentials (`PageCredentials`)
Header `API Tokens & Credentials` (🔑). Subtitle notes tokens are `Stored securely on your local machine.`
Two identical card layouts (`PasswordBox` masked + hidden plain `TextBox` for reveal, plus Reveal/Copy/Save):

| Card | Masked box | Plain box | Reveal | Copy | Save | Saved text |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `GitHub Personal Access Token (PAT)` — "Used for Git Board sync, milestone management, sub-issue links, and closing issues." | `GitHubPatBox` | `GitHubPatPlainBox` | `BtnToggleRevealGitHubPat` (`👁 Reveal`) | `BtnCopyGitHubPat` (`📋 Copy`) | `BtnSaveGitHubPat` (`Save Token`) | `GitHubPatSavedText` |
| `Zoho API Token` — "Used for real Zoho CRM test manifests and automation authentication." | `ZohoApiTokenBox` | `ZohoApiTokenPlainBox` | `BtnToggleRevealZohoToken` | `BtnCopyZohoApiToken` | `BtnSaveZohoApiToken` | `ZohoApiTokenSavedText` |

### 4.7 Page: General & API (`PageGeneral`)
Header `General & Appearance` (⚙). Contains, in order:
- **Read-only endpoints:** `Claude Web Endpoint` = `https://claude.ai`. `Target Environment Base URLs (scripts\build-queue-watcher.config.json)`: `DevBaseUrlDisplay` = `http://localhost:5000` (labelled `🟢 Dev (Local) — hard-locked target for agent (shaneapp://) runs`), `StagingBaseUrlDisplay` (`⚠️ Staging (Replit Dev Deployment)`), `ProductionBaseUrlDisplay` = `https://shanemccaw.com` (`🚨 Production (Live Domain)`). `ApiBaseUrlDisplay` (`Build Tracker API Server (Active Ingest)`, default `(not connected)`) + `ConfigPathText`. All `IsReadOnly="True"`.
- **Max Concurrent Build Slots** (#2122): `MaxConcurrentBox` (width 80) + `BtnSaveMaxConcurrent` (`Save`) + `MaxConcurrentSavedText`. Persists to `scripts\build-queue-watcher.config.json` and applies live on the watcher's next ~10s poll.
- **Color Theme** `ComboBox`: `Catppuccin Mocha (Default Dark)` (selected), `Catppuccin Latte (Light)`, `One Dark Pro`. **Cosmetic only — no `x:Name`, no handler, no persisted field; it does not actually switch theme yet.**
- **Multi-Account Routing (Claude Code)** (#1416): `SecondaryClaudeConfigDirBox` + `BtnSaveSecondaryClaudeConfigDir` (`Save Secondary Account Path`) + `SecondaryClaudeConfigDirSavedText`. Description explains `CLAUDE_CONFIG_DIR` overflow-account routing, sequential only.
- **Location / Metered Connection Gate** (#1986): `LocationModeCombo` — `Home (fibre — unmetered)` / `Rental (capped Verizon — metered)` + `LocationModeSavedText`. Mirrors the title-bar Location toggle.
- **Encouragement Critter** (#1639, off by default): `EncouragementCrittersEnabledCheck` = `🎯 Automatically cheer on milestone progress every 12-24 minutes ("Way to go! Get some ice cream!")`. Note: the manual "Cheer Me Up" menu item always works regardless.
- **Pinned Question Detection** (#2124, off by default): `PinnedQuestionDetectionEnabledCheck` = `📌 Actively probe open floaty chats for outstanding questions` — sends REAL probe messages (10-min cooldown/chat) and consumes real usage.
- **Title Bar** (#2001, off by default): `ShowUsageReadoutCheck` = `🪙 Show token/cost readout in the title bar` — display-only; usage is tracked either way.

### 4.8 Pages: Replit Watcher & Scheduled Runs
- **Replit Watcher** (`PageReplitWatcher`, header `Replit Dev Server Watcher` 🔁): `ReplitWatcherEnabledCheck` (`Enable automated background watcher & auto-wake`), `ReplitWatcherIntervalBox` (`Check interval (minutes)`), `ReplitRunSelectorBox` (`Replit Run Button Selector (CSS)`, falls back to text matching `"Run"`), `ReplitAppUrlBox` (`Deployed App URL (Polled for health)`), `ReplitWorkspaceUrlBox` (`Replit Workspace URL (Dashboard where Run is clicked)`), `BtnSaveReplitWatcher` (`Save Watcher Settings`) + `ReplitWatcherSavedText`. Live-applies (#902).
- **Scheduled Runs** (`PageScheduledRun`, header `Scheduled Unattended Runs` ⏰): `ScheduledRunEnabledCheck` (`Enable scheduled regression runs`), `ScheduledRunIntervalBox` (`Run interval (hours)`), `ScheduledRunPushCheck` (`Push-notify admins when any step fails`), `BtnSaveScheduledRun` (`Save Schedule`) + `ScheduledRunSavedText`. Live-applies (#967). Runs the **full** regression suite; web-push only on failure.

### 4.9 Page: Web Tools (`PageWebTools`)
Header `Web Tools Popout Shortcuts` (🌐). Subtitle:
`Quick-launch URLs accessible from the ActivityBar Web Tools popout.` This edits the same
`settings.WebTools` list rendered in the ActivityBar popup (§2.3).
- `WebToolsSettingsList` — dynamic list of existing entries. Each row is a single line of text
  `{Icon} {Name} — {Url}` (or `{Name} — {Url}` when the icon is blank) with an edit `✏` and a remove `✕`
  button — **no column headers and no tooltips on those two buttons** (`SettingsTabView.xaml.cs:1204-1248`).
  Remove deletes immediately (no confirmation).
- **Add New Web Tool** card: `WebToolIconBox` (label `Emoji`, width 60), `WebToolNameBox` (`Name`),
  `WebToolUrlBox` (`URL`), `BtnAddWebTool` (`Add Web Tool` → `Save Changes` while editing). Requires a
  non-blank Name **and** Url. (`SettingsTabView.xaml:749-775`)
- **Seeded defaults** (`BuildConsoleSettings.cs:432-438`): `LinkedIn` → `https://www.linkedin.com`,
  `Google Analytics` → `https://analytics.google.com`, `Microsoft Clarity` → `https://clarity.microsoft.com`
  (all blank icon), and `Git` → `https://github.com/shanemccaw/Shane-McCaw-MSP` (icon ``). A one-time
  backfill adds the `Git` entry to any older install missing that URL.

### 4.10 Page: SSH & Remote (Replit) (`PageSshRemote`)
Header `SSH & Remote Replit Execution` (🖥️). **Design/UX only — a build session must never invoke `ssh`
or handle the Replit key (Git #1840); this page configures a BuildConsole-internal capability.** Controls:
- SSH key card: `SshKeyPathBox` (`SSH Private Key File Path`) + `BtnBrowseSshKey` (`📁 Browse…`).
- Connection card: `SshHostBox` (`SSH Hostname / Server`, default `ssh.replit.com`), `SshUserBox`
  (`SSH User / Repl Identifier`), `SshRemoteDirBox` (`Remote Working Directory`, default `~/Shane-McCaw-MSP`),
  `UseSshForDeployCheck` (`Use SSH for build-completion and automatic deployments`, checked),
  `UseSshForSqlCheck` (`Use SSH for direct SQL execution / queries`, checked).
- `BtnSaveSshSettings` (`Save SSH Settings`), `BtnTestSshConnection` (`⚡ Test Connection`) + `SshSettingsSavedText`.

> The literal `ssh.replit.com` and `~/Shane-McCaw-MSP` shown in the XAML are placeholder defaults that are
> **overwritten at load** from the persisted `SshHost` (default `ba888680-…picard.replit.dev`) and
> `SshRemoteDir` (default `/home/runner/workspace`) fields (`BuildConsoleSettings.cs:162-165`). Design
> against the persisted values, not the XAML literals.

### 4.11 Pages: Claude Projects, Sound & Audio, LinkedIn Pre-fill
- **Claude Projects** (`PageChatIntegration`, header `Claude Chat & Projects` 💬): `EpicChatProjectUrlBox` (`New Chat Project URL`) + `BtnSaveEpicChatProjectUrl` (`Save Project URL`) + `EpicChatProjectUrlSavedText`. Used when right-clicking an Epic on the Git Board to start a new chat.
- **Sound & Audio** (`PageBuildSound`, header `Build Completion Audio` 🔊): `BuildSoundPathBox` (`Custom Sound File (.mp3 / .wav)`) + `BtnBrowseBuildSound` (`Browse…`); actions `BtnSaveBuildSound` (`Save Audio`), `BtnResetBuildSound` (`Reset Default`), `BtnTestBuildSound` (`▶ Play Test`) + `BuildSoundSavedText`. (Completion sound is separately mutable via the `File` menu's `MuteCompletionSound` item, `MainWindow.xaml.cs:6731`.)
- **LinkedIn Pre-fill** (`PageLinkedIn`, header `LinkedIn Composer Pre-fill` 💼, Blue): `LinkedInComposerSelectorBox` (`LinkedIn Composer Selector (CSS)`, falls back to default Quill container), `LinkedInComposeUrlBox` (`LinkedIn Feed URL`), `BtnSaveLinkedIn` (`Save LinkedIn Config`) + `LinkedInSavedText`.

### 4.12 Page: User Accounts & Tiers (`PageUserAccounts`)
Header `User Accounts & Gating Tiers` (👥, Blue). Manages local `UserAccountEntry` testing profiles
(fields `Id`, `Username`, `Password`, …; `BuildConsoleSettings.cs:18+`).
- `Active Testing Profiles` → `UserAccountsSettingsList` (dynamic).
- Add/Edit card (`UserAccountFormTitle` toggles `Create Gated Test Profile` / edit): `UserAccountUsernameBox`
  (`Username / Email`), `UserAccountPasswordBox` (`Password`), `UserAccountTierBox` (`Gating Tier` ComboBox:
  `Standard`/`Premium`/`Enterprise`/`Admin`), `UserAccountNotesBox` (`Notes / Description`). Buttons
  `BtnSaveUserAccount` (`Add Gated Profile`), `BtnCancelUserAccountEdit` (`Cancel Edit`, hidden until
  editing) + `UserAccountSavedText`.

### 4.13 Persistence (all settings)
`BuildConsoleSettings` serializes to **`%AppData%\BuildConsole\settings.json`** (`SettingsPath`,
`BuildConsoleSettings.cs:755-757`) — outside the repo, never committed. `Load()` is resilient (missing/
corrupt file → defaults; up to 4 retries on transient IO/JSON errors with 25/50/75ms backoff, then a loud
`settings.load` WARNING rather than silently blanking credentials). `Save()` is **atomic** (Git #2770):
writes `settings.json.tmp` then `File.Move(overwrite: true)`, so a crash mid-write can never truncate the
file to zero bytes (`BuildConsoleSettings.cs:863-877`; the old non-atomic `File.WriteAllText` caused
intermittent blank-PAT → GitHub 401s). `WriteIndented` JSON. Field defaults are field initializers on the
model. `LoadCore` also performs two one-time in-place backfills (the `Git` Web Tool entry; seeding two
default User Account profiles) that themselves call `Save()`.

**Not everything persisted is editable here.** Many real settings fields have **no control on this
surface** and are driven from the title bar, build-prompt flags, or edited directly in `settings.json` —
notably `DefaultAccount` (title-bar toggle), `EnforceWorktreeIsolation` (#1371), `InteractiveBuilds`,
`ConservationModeEnabled` / `UsageAutomationEnabled` / `AutoConservation*Percent`, `BatterUpFreeFlow`,
`HideCompletedEpics`, `AutoDeployOnBuildComplete`, the `SessionLimitAutoRestart*` set, `UiStepPoll*`,
`ScreenClip*`, and `BuildCompleteSoundMuted` (that mute lives in the top `Sound` menu, not this page). A
designer should not surface these on the Settings page unless a real control is being added.

---

## 5. Test Pad (`TestPad/`, ported from ShaneBuilder, Feature #2530)

A quick-capture notes surface for testing/QA: file typed observations, group them, and send/copy them into
an active Claude chat. Two always-on-top windows — a **pill** and the **pad** it expands to — plus two
secondary windows (Import, Note Detail). Backed by an in-memory store (`TestPadService`); no persistence to
disk and **no fixture rows**.

### 5.1 The pill (`TestPadPillWindow`)
Always-visible bottom-right floaty, created once at startup via `EnsureTestPadPill()` unless the app is in
agent/quiet-courier mode (`MainWindow.xaml.cs:701-708`). Non-activating, `Topmost`, sized-to-content,
anchored bottom-right (14px offsets). Content: `&#xE70B;` (`BlueBrush`) + `Test Pad` label, plus a red
**unsent-count badge** (`CountBadge`) hidden at 0, `99+` above 99 (`TestPadPillWindow.xaml.cs:48-60`). Click
→ `OnTogglePad` → `ToggleTestPadPad()` shows/hides the pad (`MainWindow.xaml.cs:337-353`).

### 5.2 The pad (`TestPadWindow`)
`Width=320`, borderless, `Topmost`, non-activating, sized-to-height, anchored just above the pill (bottom
offset 60). `PanelBackgroundBrush` rounded card with a drop shadow (`TestPadWindow.xaml:24-28`). Re-renders
live off `TestPadService.NotesChanged`. Sections, top to bottom:

**Header row** — title `Test Pad` + right-aligned actions:
| Control | Text | Visibility | Action |
| :-- | :-- | :-- | :-- |
| `BtnImport` | `Import` | always | tooltip `Import notes from a pasted Notepad file`; opens `TestPadImportWindow` (§5.5). |
| `BtnCopyMarkdown` | `Copy as markdown (N)` (`CopyMarkdownLabel`) | **hidden until ≥1 note checked** | copies checked notes as a markdown block (any sent/unsent mix). Toast `Copied N note(s) as markdown.` |
| `BtnGroupByFeature` | `By feature` | always | tooltip `Group notes by feature`; toggles flat (newest-first) vs grouped-by-Feature; label turns `BlueBrush` when active. |
| `BtnClose` | `&#xE8BB;` | always | hides the pad. |

**Status band** (`StatusBand`) — `Nothing waiting` when the unsent count is 0, else `N waiting to send`
(`RenderStatusBand`, `TestPadWindow.xaml.cs:463-467`). It deliberately does **not** claim a Claude
busy/free state (that ShaneBuilder service wasn't ported).

**Composer** — `EditingBanner` (`Editing note — Enter saves, Esc cancels`, hidden unless editing) over a
single `ComposerBox` (`AcceptsReturn="False"`, 30–90px). **Enter** files a new note (or saves the edit if a
note is loaded); **Esc** cancels back to empty (`ComposerBox_PreviewKeyDown`, `TestPadWindow.xaml.cs:107-119`).
A leading marker char sets the note type (§5.4). Below it, the `TypeChipsControl` (§5.4).

**Notes list** (`NotesHost`) — empty state `No notes yet.` (`EmptyState`). Each row (`BuildRow`,
`TestPadWindow.xaml.cs:311-459`), left to right: a **select checkbox** (`IsSelected`); the note **text**
(ellipsized single line; click loads it back into the composer for edit — unless sent; `EDITED` tag if
`IsEdited`); an **expand** button (a Segoe MDL2 glyph, tooltip `Expand note`) opening the Note
Detail pop-out (§5.6); a green **`SENT`** badge (only when `IsSent`; also sets tooltip `Sent — locked from editing`
and `TextDisabledBrush` text); a **delete** button (tooltip `Delete note`) → `TestPadService.RemoveNote`.

**Send row** — `BtnSendToClaude`, label `Send to Claude` or `Send to Claude (N)` where N is the checked-unsent
count (falling back to total unsent). Dimmed/disabled when nothing is unsent. Tooltip
`Copy the selected (or every unsent) note as a formatted block, ready to paste into Claude's composer`.
On click it formats the target notes (`TestPadSendFormatter`) and **injects them directly into the active
claude.ai chat's composer** via `MainWindow.SendTextToActiveClaudeChatAsync` (#2690) — notes flip to `IsSent`
only in the real success callback; a failed injection leaves them unsent, with a warning toast
(`TestPadWindow.xaml.cs:177-215`). Success toast: `Sent N note(s) — <msg>`.

**Pipeline caption** (`PipelineCaption`, `TextDisabledBrush`, italic): `Note → Claude architects → you approve → prompt + git issue → Batter Up` (`TestPadWindow.xaml:136-141`).

### 5.3 The store (`Services/TestPad/TestPadService.cs`)
Static, thread-safe, never-throws. Newest-first list. `AddNote` inserts at index 0 and stamps context via
`NoteContextStamper` (screen/feature/build number — resolvers may be unwired and degrade each field to
`null`; `NoteContextStamper.cs`). `UpdateNote` marks `IsEdited` and is a no-op on a sent note. `MarkSent`
sets `IsSent` + clears selection. `UnsentCount` drives both badges. All mutations raise `NotesChanged` on
the UI dispatcher.

### 5.4 Note types & type chips
`NoteType` enum + `NoteMarkerParser` (`Services/TestPad/`). A leading marker char (only when it is the very
first non-whitespace char) sets the type and is stripped from the saved body:

| Type | Marker | Chip label | Chip colour | Chip tooltip |
| :-- | :-- | :-- | :-- | :-- |
| `Note` | *(none)* | *(no chip)* | — | default for unmarked text |
| `Bug` | `!` | `! Bug` | `RedBrush` | `Bug — leading ! marker` |
| `Question` | `?` | `? Question` | `BlueBrush` | `Question — leading ? marker` |
| `Idea` | `+` | `+ Idea` | `PeachBrush` | `Idea — leading + marker` |
| `Works` | `.` | `. Works` | `GreenBrush` | `Works — leading . marker` |

`TypeChipsControl` (`TestPad/TypeChipsControl.xaml`) is 4 rounded-pill chips; clicking one inserts/replaces
the leading marker in the composer — identical to typing the punctuation (`TypeChipsControl.xaml.cs:52-64`).

### 5.5 Import from Notepad (`TestPadImportWindow`, #2533)
Custom-chrome modal, `Width=480`, title `Import from Notepad`. Instruction:
`Paste a whole Notepad file below, then Parse. Each blank-line-separated block becomes a note; a leading !/?/+/. still sets its type.`
Stage 1: `PasteBox`. Buttons `Cancel` / `Parse` / `Import` (Import disabled until a parse). Stage 2:
`PreviewHost` list of candidate notes with per-row type-chip correction + multi-select; a `MergeBar` shows
`Merge N up` for the selected rows and `Undo merges` (`BtnUndoMerges`, shown once any row carries a merge).
Import files every checked candidate straight into `TestPadService`. ("Attach shot"/Paste Tray was **not**
ported — that button is absent, not stubbed.)

### 5.6 Note Detail pop-out (`TestPadNoteDetailWindow`, #2698/#2705)
Custom-chrome window (`Width=720 Height=520`), title `Note` + meta. A **Rendered/Raw** toggle
(`BtnRenderedView` default checked / `BtnRawView`): Rendered runs the note through `MarkdownRenderer` (so a
markdown table renders as a real table); Raw shows exact source in a read-only `NoWrap` Consolas box for
copy-paste of wide tables. View-only.

### 5.7 Capture entry points
- **Header/composer** in the pad (above).
- **Right-click a selection in any chat WebView2 → `Send Selection to Test Pad`** (`WireSendSelectionToTestPad`,
  `MainWindow.xaml.cs:7395-7430`) — only offered on a real non-empty selection; captures the selection as
  markdown into a new note and brings the pill forward (`CaptureSelectionToTestPadAsync`, 7437-7465).

---

## 6. Sticky Notes (`StickyNotesWindow.xaml(.cs)`, #937)

A single always-on-top borderless floaty (`Width=300 Height=340`, `MinWidth=200 MinHeight=180`,
`Topmost`, `ShowInTaskbar=False`, `CanResizeWithGrip`). `MantleBrush` rounded card with a `Surface0Brush`
border. Toggled open/closed from the ActivityBar (`ToggleStickyNotes`, `MainWindow.xaml.cs:1794-1823`) — a
second click on the icon closes it. It is **not** owned by MainWindow (#2076 — an owned floaty pulled
MainWindow forward), but auto-closes when MainWindow closes.

Structure (`StickyNotesWindow.xaml`):
- **Header strip** (`HeaderStrip`, `CrustBrush`) — doubles as the drag handle (`DragMove`). 🗒 glyph + title
  `Sticky Notes` + close `✕` (`BtnClose`, tooltip `Close (reopen from the ActivityBar)`).
- **Note box** (`NotesBox`) — multi-line (`AcceptsReturn`/`AcceptsTab`), `BaseBrush`, auto-wrap. Text
  **auto-saves debounced (600ms)** to `settings.StickyNotesText` on every keystroke so an accidental close
  loses nothing (`NotesBox_TextChanged` → `PersistText`, `.cs:81-124`).
- **Inline message** (`InlineMessage`) — one-line status under the note; `GreenBrush` on success, `RedBrush`
  on error; collapsed by default.
- **Send row** — `BtnSend` (`PrimaryButton`), caption `Send to active Claude chat`.

**Send contract:** empty text → inline error `Nothing to send — the note is empty.`. Otherwise it raises
`SendRequested(text)`; MainWindow injects it into the active chat (same `SendTextToActiveClaudeChatAsync`
path) and calls back `ShowInlineMessage(...)` / `ClearNoteText()` — the note **clears after a successful
send** (#937). Position and size persist to `settings.StickyNotes{Left,Top,Width,Height}` (Left/Top `-1`
sentinel = never-positioned → centre; `.cs:47-68,126-140`).

---

## 7. Data sources & honesty rules (summary)

- **Every count is real.** Test Pad badges = `TestPadService.UnsentCount`; Shelf badge = live shelved-tab
  count; Batter Up / AI Batter Up / Drain counts come from each panel's own `CountChanged` event (no new
  polling). None is fabricated; all read 0 as a calm 0, not hidden (except the Test Pad/Shelf badges, which
  hide at 0 by design).
- **Web Tools** are the union of 3 fixed local-site rows (hardcoded, not user data) + the user's
  `settings.WebTools`. Favicons are fetched live, never faked; the glyph is the honest fallback.
- **Settings values** all round-trip through `%AppData%\BuildConsole\settings.json` (§4.13) or
  `scripts\build-queue-watcher.config.json` (max-concurrent, base URLs). Read-only endpoint boxes display
  real config, not editable state.
- **Sticky Notes / Test Pad text** is real in-memory/on-disk user content — never seed text.
- **No emoji-vs-icon substitution freedom:** where the code uses a Segoe MDL2 glyph, keep an icon; where it
  uses an emoji (🎯 🗺 🗂 🗃 ⚾ 🧪 🔑 etc.), that emoji is the current literal — a designer may replace it with
  a lucide-style icon of the same meaning, but must not invent a new meaning.

---

## 8. What is NOT in this pack (pointers)

| Surface reached from this chrome | Owning pack |
| :-- | :-- |
| Chats / Explorer / Search / Git / Issues / Automation / Graph sidebar views | gitboard + chatcontainer packs (#3014-ish) |
| Batter Up / AI Batter Up / Build Queue / Build Watch | `docs/buildconsole-queue-contract-pack.md` |
| Git Doctor full tab, Log Viewer, Local Map / Git Map / Build Chain Map windows | full-page-tools pack (#3018) |
| Home dashboard | #3016 |
| Cross-cutting data model, build/queue status vocabulary | `docs/buildconsole-contract-pack.md` |

The launchers for all of the above (their glyph, tooltip, and open-behaviour) are documented here in §2–§3.
