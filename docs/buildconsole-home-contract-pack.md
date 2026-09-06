# BuildConsole — Home Dashboard Contract Pack

> **For UI Designers (e.g. Claude Design).**
> This document is the authoritative specification for the **Home dashboard** surface of the
> BuildConsole desktop app (`desktop/BuildConsole/Controls/HomeView.xaml` + `HomeView.xaml.cs`).
> It is the child of Feature **#3013** (BuildConsole Contract Packs) covering item 4 of that
> feature's index — the Home dashboard — under issue **#3017**.
>
> **Extracted, not authored.** Every control, data field, status vocabulary, and interaction
> below was confirmed by reading the real code on `main`. Nothing here is aspirational: where a
> card fails closed to an honest empty state, that is documented as the real behavior, not a
> placeholder to design away.
>
> You have **full creative freedom over visual appearance** (layout, grouping, spacing,
> typography, the dark aesthetic). You have **zero freedom over what data exists.** Every number
> on this surface comes from a real service call listed in §3 — no field may be invented, and a
> value the service cannot supply must render as its real honest empty/`--` state, never as `0`
> or a fabricated figure.

---

## 1. What the Home dashboard is

`HomeView` is a WPF `UserControl` rendered as the **Home** tab in BuildConsole's center document
workspace (the same pane grid that hosts chat tabs, the Git Board, Batter Up, etc.). It is the
single-user operator's landing/glance surface: a self-refreshing dashboard that rolls up

- **where you left off** (remembered chat tabs from the last session),
- **what is running right now** (live build queue), plus stuck-build clearing,
- **real progress analytics** for the active GitHub milestone — Scope & Completion (burn-up),
  Open/Close Rate (crossing), Projected Completion (per-Epic + milestone ETA), and a per-Epic
  Burndown picker,
- **operational health** — a live 6-row System Health & Tiers panel and a Pending Migrations
  scanner,
- **fast launchers** (New Issue, Build Watch, Test Runner, Replit, Git Board, Settings, Deploy),
  a Focus Epic hero, a What's New commit feed, and a playful animal-companion mascot.

The class doc summarizes its intent verbatim: *"ADHD-Friendly Multi-Column Home Dashboard.
Provides zero-overwhelm glanceability, quick jump-in workflows, live focus tracking, and a
playful animal companion (Microsoft Clarity style)."* (`HomeView.xaml.cs:31-35`).

The whole surface is a single vertical `ScrollViewer` (`Padding="24,18,24,28"`, content
`MaxWidth="1340"`) over a `BaseBrush` background (`HomeView.xaml:123-125`).

### Design source note

This is real, **shipped, working** code today — not one of the retired portal-v2 fixtures. It is
also part of the surface Epic **#1202**'s Shell Redesign will eventually re-home (see the master
`docs/buildconsole-contract-pack.md`), but nothing in that redesign has landed; the layout here is
what renders now.

---

## 2. Layout skeleton

The body is a hero row followed by a **three-column grid** (`HomeView.xaml:130-899`).

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ HERO ROW                                                                            │
│  🚀 "Good {morning|afternoon|evening}, Shane!"        [➕ New Issue][🖥️ Build Watch] │
│     One clear step at a time. …                        [🧪 Test Runner][🌐 Replit]   │
├──────────────────────────┬──────────────────────────┬───────────────────────────────┤
│ COLUMN 1 (340–440px)     │ COLUMN 2 (340–460px)     │ COLUMN 3 (290–360px, fixed 320)│
│  🎯 ACTIVE FOCUS EPIC    │  🛠️ QUICK ACTIONS (2×2)  │  🦊 Mascot companion card       │
│  📈 PROJECTED COMPLETION │  📈 SCOPE & COMPLETION   │  🌟 FOCUS MOMENTUM (pts / %)    │
│  ▶ RUNNING NOW           │  📉 EPIC BURNDOWN        │  📊 BOARD GLANCE                │
│  🕘 RECENT CHATS         │  ✨ What's New (collapsed)│  🏥 SYSTEM HEALTH & TIERS (×6)  │
│  🔀 OPEN/CLOSE RATE      │                          │  🗄️ PENDING MIGRATIONS          │
└──────────────────────────┴──────────────────────────┴───────────────────────────────┘
```

Column definitions: `Col0 = * (Min340,Max440)`, `Col1 = 20px spacer`, `Col2 = * (Min340,Max460)`,
`Col3 = 20px spacer`, `Col4 = 320 (Min290,Max360)` (`HomeView.xaml:180-191`).

### Decorative mascots (real, animated, non-interactive)

Several cards carry hand-drawn vector critters (WPF `Canvas`/`Polygon`/`Ellipse`, no image
assets):
- **Peeking fox** over the top edge of the Active Focus card (`PeekFoxTranslate`, `xaml:201-223`).
- **Scout bird with megaphone** over the Running Now card (`BirdTranslate`, `xaml:329-346`).
- **Hero fox** in the mascot companion card, with a breathing/bounce/wiggle animation
  (`FoxTranslate` + `FoxRotate`, `xaml:605-639`), driven on click (§5).

These are pure decoration — `IsHitTestVisible="False"` on the peeking ones — and carry no data.
The master contract pack notes the Shell Redesign de-scopes mascots (#2021/#2014); they are still
present and functional here. A design may keep or drop them at its discretion; they bind to nothing.

---

## 3. Data sources — the real backing services

Every dynamic number on this surface comes from one of these. The host (`MainWindow`) owns the
service calls and pushes data in through `HomeView`'s public render methods; a handful of cards
fetch their own data directly. **All of them fail closed** — an unreachable GitHub / DB / no-PAT
state renders an honest reason string, never a fabricated value.

| Card / value | Backing service | Shape | Fetch trigger |
|---|---|---|---|
| Active Focus Epic, Focus Momentum pts/% | `FocusModeService.Instance` (singleton) | `IsActive`, `ActiveMilestoneTitle`, `ActiveMilestoneNumber`, `Points`, `Progress` (`FocusProgress`) | `StateChanged` event → `UpdateFocusState()` |
| Projected Completion (per-Epic + milestone ETA) | `HomeEtaProjectionService.ComputeAsync(force)` | `HomeEtaProjection` → `EtaProjectionRow[]` | Home tab open (cache), ⟳ button (force) |
| Scope & Completion (burn-up) | `GitHubIssueTimeSeriesService.GetActiveMilestoneSeriesAsync(force)` | `IssueTimeSeries` → `IssueTimeSeriesPoint[]` | 10s rollup tick (cache), ⟳ (force) |
| Open/Close Rate (crossing) | same `GetActiveMilestoneSeriesAsync` (shared #2711 series) | `IssueTimeSeries` | 10s rollup tick, ⟳ |
| Epic Burndown picker | `GetOpenEpicsAsync(force)` + `GetEpicSeriesAsync(epic, force)` | `EpicOption[]`, `IssueTimeSeries` | tab open, picker change, ⟳ |
| Running Now | `QueueItem[]` (live build queue) pushed via `RenderRunning` | `QueueItem` | 10s rollup tick |
| Recent Chats | `PersistedChatTab[]` pushed via `RenderLeftOff` | `PersistedChatTab` | tab open / session restore |
| What's New | `VersionInfo` (`GetCommitsRange`, `GetCurrentBuild`, `Format`) | `string[]` commit titles | `RenderWhatsNew`, pager buttons |
| Board Glance (Active Epics / Open Issues / Active Milestones) | `LeftSidebar.CurrentBoardIssues` + `CurrentMilestones` pushed via `RenderDashboardState` | counts | 10s rollup tick |
| Claude Status dot/label | `UpdateClaudeStatus(text, isOperational)` exists but is **not currently called by the host** — the row shows its static default (see §4.12) | string + bool | none today |
| System Health & Tiers (6 rows) | `SystemHealthService.RunFullHealthCheckAsync(api)` | `SystemHealthReport` | 30s internal timer + ⟳ |
| Pending Migrations | `LocalSqlExecutor.ExecuteAsync(api, "SELECT filename FROM simulator_migration_runs")` + disk scan of `lib/db/migrations/manual/*.sql` | filename set diff | tab open / every rollup / ⟳ |

### 3.1 `IssueTimeSeries` / `IssueTimeSeriesPoint` (Git #2711) — the shared analytics foundation

`GitHubIssueTimeSeriesService` fetches every repo issue once (open + closed, with real
`createdAt`/`closedAt`), caches it with a **5-minute TTL** (`CacheTtl`), and reduces it into a
real per-day series. It is the single source three charts read (`GitHubIssueTimeSeriesService.cs:53-99`,
`147-175`).

`IssueTimeSeriesPoint` (`:15-38`):
| Field | Meaning |
|---|---|
| `Date` (`DateOnly`, UTC) | the calendar day |
| `Opened` (int) | issues in scope opened that day (real `created_at`) |
| `Closed` (int) | issues in scope closed that day (real `closed_at`) |
| `OpenCount` (int) | running open-count at end of day (cumulative opened − closed) — trends **up** with growing scope, not a burndown |
| `ClosedCumulative` (int) | running total closed — the "Completed" burn-up line |
| `CumulativeOpened` (int) | running total opened — the "Total Scope" burn-up line |

`IssueTimeSeries` (`:53-99`):
| Field | Meaning |
|---|---|
| `ScopeLabel` (string) | e.g. `"v1.1 - Monitoring & Launch Control"` — used as the card's scope subtitle |
| `HasEnoughData` (bool) | **the fail-closed gate** — false ⇒ render `Reason`, never a curve |
| `Reason` (string?) | honest reason when not enough data (GitHub unreachable / too little history) |
| `Points` (`IssueTimeSeriesPoint[]`) | oldest-first, contiguous (gap days carry forward — real "nothing happened", not interpolation) |
| `FirstDate` / `LastDate` (`DateOnly?`) | span ends |
| `TotalIssues`, `CurrentOpen`, `CurrentClosed` (int) | scope totals |
| `DistinctActivityDays`, `SpanDays` (int) | used by the trust gate |

Trust thresholds: `MinSpanDays = 2`, `MinActivityDays = 2` (`:166-170`). A scope that fails either
returns `IssueTimeSeries.NotEnough(label, reason, …)`.

**Active milestone resolution** (`ResolveActiveMilestoneAsync`, `:435-461`): among *open*
milestones, the one with the most total (open + closed) real issues — read off GitHub's own
milestone counts, never a label. Returns null (→ honest empty) when no PAT is configured, GitHub
is unreachable, or no open milestone has issues.

### 3.2 `HomeEtaProjection` / `EtaProjectionRow` (Git #2714)

`HomeEtaProjectionService.ComputeAsync(force)` (`HomeEtaProjectionService.cs:72`) returns:

`HomeEtaProjection` (`:40-48`):
| Field | Meaning |
|---|---|
| `Available` (bool) | false ⇒ render `UnavailableReason`, never a fabricated date |
| `UnavailableReason` (string?) | honest reason when unavailable |
| `MilestoneTitle` (string) | active milestone title |
| `Milestone` (`EtaProjectionRow?`) | the milestone-level projected release date |
| `Epics` (`EtaProjectionRow[]`) | one row per open Epic in the active milestone |
| `GeneratedUtc` (DateTime) | when computed (shown as "updated h:mm tt") |

`EtaProjectionRow` (`:13-32`): `Number`, `Title`, `TotalIssues`, `ClosedIssues`, `HasEta` (bool —
true only if the projection cleared its confidence gates), `ProjectedUtc` (`DateTime?`),
`IssuesPerDay` (double, fitted close pace), `Reason` (string? — why no ETA), `AllClosed` (bool).

Each date is fit from real GitHub close history with the same discipline the Focus bar uses; a
scope with too little history shows a reason, never a date.

### 3.3 `SystemHealthReport` (SystemHealthService)

`RunFullHealthCheckAsync(api)` runs 6 live checks in parallel (`SystemHealthService.cs:110-125`)
and returns `SystemHealthReport` (`:70-92`):

| Row | Field | Type | Notes |
|---|---|---|---|
| Local Dev Server | `DevServer` | `ComponentHealth` | reachability + latency |
| Database (API Pipe) | `Database` | `ComponentHealth` | via `LocalSqlExecutor` pipe |
| #92 Coordination Mutex | `Mutex` | `MutexHealth` | `IsHeld`, `OwnerPid`, `OwnerAlive`, `IsSuspicious`, `HeldDuration` |
| Agent Worktrees | `OrphanedWorktrees` | `WorktreeHealth` | `InspectedCount`, `ActiveCount`, `OrphanedCount`, `OrphanedPaths` |
| Stranded Branches (vs main) | `StrandedBranches` | `StrandedBranchHealth` | `InspectedCount`, `CleanCount`, `StrandedCount` (Git #1447) |
| Staging (Replit SSH) | `SshStaging` | `ComponentHealth` | `IsConfigured` gates whether it counts |

`ComponentHealth` (`:20-29`): `Name`, `Status` (`HealthStatus`), `Summary`, `Details`,
`LatencyMs`, `IsConfigured`, `IsHealthy` (computed: `Healthy || NotConfigured`).

`HealthStatus` enum (`:11-18`): **`Healthy`, `Degraded`, `Unhealthy`, `NotConfigured`,
`Unknown`** — the full vocabulary; each maps to a badge color/label in §6.

`AllHealthy` (`:80-84`) is a computed rollup: DevServer healthy **and** Database healthy **and**
Mutex not suspicious **and** zero orphaned worktrees **and** (SSH healthy or not configured).
**Stranded branches are deliberately excluded** from `AllHealthy` — up to ~8 concurrent agents are
legitimately "ahead of main" at once, so the row surfaces the count but does not flip the overall
pill red (`:73-79`).

### 3.4 Focus state (`FocusModeService` / `FocusProgress`)

`FocusModeService.Instance` (singleton, `FocusModeService.cs:67-77`): `IsActive`,
`ActiveMilestoneNumber` (`int?`), `ActiveMilestoneTitle`, `Points` (int), `Progress`
(`FocusProgress`), and a `StateChanged` event (`:146`).

`FocusProgress` (`FocusModels.cs:67-82`): `MilestoneNumber`, `MilestoneTitle`, `Closed`, `Total`,
`Percent` (computed `Closed*100/Total`, 0 when `Total==0`), `Points`, `HasEta`, `Eta`,
`IssuesPerDay`, `EtaReason`.

### 3.5 `QueueItem` (Running Now) and `PersistedChatTab` (Recent Chats)

`QueueItem` (`BuildTrackerApiClient.cs:13`) — the fields Home reads: `Id`, `Title`,
`GithubNumber` (`int?`), `UpdatedAt` (`DateTimeOffset?`). (`QueueItem` is the full build-queue row;
the rest is out of Home's scope.)

`PersistedChatTab` (`BuildConsoleSettings.cs:67-77`): `Title`, `ClaudeUrl`, `IssueGithubNumber`
(`int?`), `PaneIndex` (int), `SavedAt` (DateTime).

`GitBoardIssue` (`BuildTrackerApiClient.cs`): Home reads `IsEpic` (bool) and `IsClosed` for its
Board Glance counts. `GitMilestone[]` count feeds the "Active Milestones" tile.

---

## 4. Card-by-card contract

### 4.1 Hero row (`xaml:130-174`)
- **Greeting** `GreetingText` — set at construction from local hour: `<12` → "Good morning",
  `<17` → "Good afternoon", else "Good evening", always suffixed `, Shane!`
  (`HomeView.xaml.cs:104-114`). `MotivationSubtext` is a static line.
- **Fast action badges** (`QuickActionTile` style): **➕ New Issue**, **🖥️ Build Watch**,
  **🧪 Test Runner**, **🌐 Replit** — each raises a host event (§5).

### 4.2 Active Focus Epic (`FocusHeroCard`, `xaml:198-271`)
Blue-glowing hero card. Bound entirely to `FocusModeService` via `UpdateFocusState()`
(`HomeView.xaml.cs:151-187`):
- **Active:** title = `ActiveMilestoneTitle`; points pill = `{Points} pts`; progress text =
  `"{pct}% completed ({closed}/{total} issues)"`; the `FocusProgressBar` width animates to
  `min(260, 260*pct/100)`; **⛶ Immersive** and **View Tab** buttons show.
- **Inactive:** title = "No milestone in active focus"; text = "Pick a milestone in Git Board to
  engage focus"; border reverts to `Surface1Brush`; bar width 0; pills read `0 pts` / `--`;
  Immersive button hides.
- Buttons: **⛶ Immersive** → `ImmersiveFocusRequested`; **View Tab** →
  `MilestoneDetailRequested(ActiveMilestoneNumber)` (only fires when a number is set).

### 4.3 Projected Completion (`xaml:273-324`, render `HomeView.xaml.cs:509-564`)
- Header count `EtaEpicCountText` = `"(N epics · M dated)"` or `"(no open epics)"`.
- **⟳** `BtnRefreshEta` → `RefreshEtaProjectionsAsync(force:true)`. A single in-flight compute is
  enforced (`_etaLoadInFlight`) so the button can't stack on tab-open.
- **Milestone card** (`EtaMilestoneCard`, collapsed until available): title, a green projected
  date (`FormatProjectedDate`), and a sub line
  `"{closed}/{total} closed · {perDay}/day · {relative span}"`. When no ETA: date shows
  `"✓ done"` (green, if `AllClosed`) or `"—"` with the reason.
- **Per-Epic rows** (`EtaEpicList`, built by `BuildEtaEpicRow`, `:566-642`): each is a
  `Surface0` row — `#{number} {title}` + right-aligned green date + sub line; no-ETA rows show
  `—`/`✓ done` + reason. Tooltip states the pace or the honest reason.
- **Empty/error:** `EtaEmpty` shows `UnavailableReason` or, on exception, `"Couldn't load
  projections: {message}"` (logged to `git-board.data`). Footer `EtaGeneratedText` = "Fit from
  real GitHub close history · updated {time}".
- `FormatProjectedDate` (`:646-650`): "MMM d" this year, "MMM d, yyyy" otherwise.
  `FormatEtaSpan` (`:653-661`): "in ~Nh" / "in ~N days" / "in ~N.N months" / "due now".

### 4.4 Running Now (`xaml:326-364`, render `HomeView.xaml.cs:431-467`)
- Header count `RunningCountText` = `"(N)"` or `"(N · M stuck)"`.
- Each build is a `HomeRow` built by `BuildRow`: icon **▶** (peach `#F2CA63`) when live, **⚠**
  (red `#EE99A0`) when stale; title = build title (or "(untitled build)"); sub =
  `"{ref} · running ({age}) · click to watch"` or, when stale,
  `"{ref} · stuck ({age}) · click to clear"`.
- **Staleness** = `UpdatedAt` ≥ **60 minutes** old, or null (`StaleRunningMinutes`,
  `IsRunningStale` `:663-667`). Stale rows get a red border and an inline **✕** clear button
  (`onClear` → `ClearStuckItemRequested`). Row click → `RunningItemClicked` (open chat / watch).
- `StuckPhrase` (`:669-676`) formats age as `Nm ago` / `Nh ago` / `Nd ago`.
- Empty: `RunningEmpty` "No active builds running right now."

### 4.5 Recent Chats ("Where you left off", `xaml:366-390`, render `:397-419`)
- Header count `LeftOffCountText` = `"(N)"`; **Reopen All** button shows only when `count > 1`
  (Git #2707) → `ReopenAllRequested(full list)`.
- Each remembered tab is a `HomeRow`: 🕘 icon, title (or "(untitled chat)"), sub =
  `"[#issue · ] pane {n} · {SavedAt local MMM d, h:mm tt}"`. Row click →
  `ResumeChatRequested(tab)`. Rows with no `ClaudeUrl` still render (host skips honestly).
- The list sits in its own `ScrollViewer MaxHeight=320` (full remembered list, no cap — #2707).
- Empty: `LeftOffEmpty` "No recent chats from your last session."

### 4.6 Open/Close Rate crossing chart (`OpenCloseRateCard`, `xaml:392-429`, `:1428-1600`)
- Two hand-drawn `Polyline`s on `OpenCloseRateCanvas` (height 120): **Opened/day**
  (`PeachBrush`) and **Closed/day** (`GreenBrush`), oldest→newest, from the shared #2711 series.
  Legend dots in the header; scope subtitle = `series.ScopeLabel`.
- A **crossover marker** (outlined green dot) is placed on the most recent real day the Closed
  line caught up to/passed the Opened line while the prior day was still behind — a real sign
  change, never guessed (`:1570-1588`).
- Summary line (`:1494-1503`): trailing-window (≤7 real days) totals →
  "closing faster than opening…" 📉 / "opening faster than closing…" 📈 / "same real pace",
  prefixed `"{CurrentOpen} open now — …"`.
- **⟳** `BtnRefreshOpenCloseRate` → force refetch. Empty/`!HasEnoughData` →
  `OpenCloseRateEmptyText` shows `Reason` (default "Loading real open/close history…").
- Redraws on `SizeChanged` (points are computed against actual canvas pixels).

### 4.7 Quick Actions (`xaml:437-468`)
2×2 `UniformGrid` of `QuickActionTile` buttons: **💬 New Epic Chat** (→ `NewIssueRequested`),
**⚡ Rebuild & Deploy** (→ `DeployRequested`), **📋 Git Board** (→ `GitBoardRequested`),
**⚙️ Settings** (→ `SettingsRequested`).

### 4.8 Scope & Completion burn-up (`BurndownCard`, `xaml:470-511`, `:1159-1325`)
- Two `Polyline`s on `BurndownCanvas` (height 120): **Total Scope** (`LavenderBrush`,
  `CumulativeOpened`) and **Completed** (`GreenBrush`, `ClosedCumulative`), with a **10%-opacity
  filled area between them = the real remaining-work gap** (`DrawBurndownCanvas`, `:1256-1323`).
  Last point of each line gets a 7px dot.
- Header legend + scope subtitle = `series.ScopeLabel`.
- Summary (`:1228-1234`): `"{closed}/{total} closed · {remaining} remaining (scope grew from {a}
  to {b} since {FirstDate})"`.
- **⟳** `BtnRefreshBurndown` → force. Empty/`!HasEnoughData` → `BurndownEmptyText` shows
  `Reason` (default "Loading real open-issue history…"). Redraws on `SizeChanged`.
- This card was the #2712 single-line "burndown", replaced by the #2721 two-line burn-up because a
  growing-scope milestone's open-count can only trend up.

### 4.9 Epic Burndown picker (`EpicBurndownCard`, `xaml:513-555`, `:1327-1426`)
- A **`ComboBox` `EpicPicker`** (`DisplayMemberPath="Title"`) populated from
  `GetOpenEpicsAsync` — **every real open Epic**, deliberately including internal-tooling Epics
  **#1202 / #1095** so their own burndown is viewable (self-rollup, #2776). Default selection =
  the Epic with the most real open work (`OrderByDescending(OpenRealWork)`).
- Selecting an Epic → `GetEpicSeriesAsync(number)` → the **same** `DrawBurndownCanvas` renderer
  (Total Scope vs Completed) on `EpicBurndownCanvas`. Same legend, summary, empty-state, and
  `SizeChanged` redraw as §4.8.
- **⟳** `BtnRefreshEpicBurndown` → force. Empty list → honest message "no real open Epics found
  (no GitHub PAT configured, GitHub unreachable, or no open Epic exists)."

### 4.10 What's New (`WhatsNewSection`, collapsed by default, `xaml:557-589`, `:216-390`)
- Collapsible `ToggleButton` tile (`WhatsNewTile`) with a summary count; expands `WhatsNewContent`.
- Content is a paged commit feed from `VersionInfo.GetCommitsRange(skip, take)` run off-thread;
  page 0 shows either "Since Last Look" (when `currentBuild > lastSeenBuild`) or "Page 1".
  **◀ Older / Newer ▶** buttons page through history. Version label = `Build v{Major}.{Minor}.{n}`.
- Each change is a bullet (`BuildBullet`, `:368-390`) in mauve `#C6A0F6`.
- Section stays `Collapsed` until `RenderWhatsNew(...)` is called by the host.

### 4.11 Mascot companion (`MascotCard`, `xaml:596-653`, `:116-148`)
- Hero fox vector with a breathing/idle animation. A **16-second timer** occasionally (40%
  chance/tick) rolls the speech bubble `MascotQuoteText` to a new line from a 7-quote array
  (`MascotQuotes`, `:69-78`).
- Click → bounce (`BounceEase`) + wiggle (`SineEase`) animation and an immediate quote roll
  (`MascotCard_Click`, `:130-148`). Purely motivational; binds to no data.

### 4.12 Focus Momentum (`xaml:655-704`)
- **🏆 Points** `StatPointsValue` and **🎯 Milestone** `StatMilestonePercent` — both driven by
  `UpdateFocusState()` (points and `Percent`; `--` when inactive).
- **Claude Status** row: `ClaudeStatusDot` (green `GreenBrush` / red `RedBrush`) + `ClaudeStatusLabel`.
  `UpdateClaudeStatus(text, isOperational)` (`:678-684`) can drive it, but **the host does not
  currently call it** (no call site anywhere in `desktop/BuildConsole`), so today this row always
  shows its static XAML default — green dot + "Operational". A designer should treat this as a
  wired-but-idle slot, not a live signal, unless/until the host starts pushing status.

### 4.13 Board Glance (`xaml:706-723`)
Three rows from `RenderDashboardState` (`:190-214`): **Active Epics** = `count(IsEpic)`, **Open
Issues** = `count(!IsClosed)`, **Active Milestones** = `milestones.Count`. All three default to
`--` until data arrives (never `0`).

### 4.14 System Health & Tiers (`SystemHealthCard`, `xaml:725-871`, `:895-1157`)
- **Overall pill** `OverallHealthPill`: `AllHealthy` → green `"🟢 ALL HEALTHY"` on `#1E3A2F`;
  else peach `"⚠️ ATTENTION NEEDED"` on `#3E2723`; during a check "Checking…" (yellow); on
  exception "Check Failed" (red, logged to `system.health`).
- **⟳** `BtnRefreshHealth` re-runs the check. A **30-second `DispatcherTimer`** auto-refreshes
  (`InitializeHealthMonitor`, `:901-909`).
- **6 rows** (`RowDevServer`, `RowDatabase`, `RowMutex`, `RowWorktrees`, `RowStrandedBranches`,
  `RowSsh`), each: icon, name, a `SummaryText`, and a status badge. Mutex/Worktrees/Stranded
  have bespoke badge text (see §6). Two rows carry **contextual action buttons that appear only
  when needed**: **🧹 Clean** on Worktrees (when `OrphanedCount > 0` → `SweepWorktreesAsync`) and
  **🔀 Recheck** on Stranded Branches (when `StrandedCount > 0`; read-only re-sweep — never
  deletes/merges, Git #1466).
- **Row click** → opens the collapsible **Diagnostics drawer** (`HealthDiagnosticsBox`) with a
  read-only monospace dump of that component's real fields (`RowHealth_Click`, `:1090-1150`). ✕
  closes it.

### 4.15 Pending Migrations (`PendingMigrationsCard`, `xaml:873-896`, `:767-893`)
- Scans `lib/db/migrations/manual/*.sql` on disk and diffs against the real
  `simulator_migration_runs` table (via `LocalSqlExecutor` over the app's DB pipe). Any filename
  not recorded there is **pending**.
- Header count `PendingMigrationsCountText` = `"(N)"` / `"(?)"` on error. Each pending file is a
  🧩 row (yellow `#F9E2AF`): filename + "not recorded · click to load into SQL Runner"; click →
  `OpenMigrationInSqlRunnerRequested(fullPath)` (host opens it in the AvalonEdit SQL Runner).
- Empty (all recorded): "🎉 All manual migrations are recorded — nothing pending." Failure states
  show the real reason in peach (repo root not found, dir missing, DB read failed, etc.).
- Re-scans on tab open, on **every** 10s rollup (`RenderDashboardState` calls
  `RefreshPendingMigrations`), and on **⟳**. A single in-flight scan is enforced.

---

## 5. Host integration — public methods & events

`HomeView` is a pure view: `MainWindow` owns all data and wiring. It is **not declared in XAML** —
it is created imperatively in `MainWindow.OpenHomeTab()` (`MainWindow.xaml.cs:3674-3759`), held in
the single field `_homeView`, and inserted as the **first tab of the primary pane** `EditorTabs`
(re-selected, not duplicated, if already open across any of the four panes). It is opened once at
launch (`:1076`) and re-openable from the command palette; on tab close `_homeView` is nulled
(`:5609-5611`). Two directions:

### 5.1 Host → view (public methods the host calls to push data)
| Method | Host call site(s) | Data source |
|---|---|---|
| `InitializeHealthMonitor(api)` | `:3691` (once at construction) | `_buildTrackerApi`; starts the 30s health timer |
| `RenderLeftOff(tabs)` | `:3766` (first paint only) | `_chatTabsAtLaunch` = persisted `BuildConsoleSettings.OpenChatTabs` snapshot |
| `RenderDashboardState(issues, milestones)` | `:3767` (first paint), `:838` (manual full git refresh), `:4251` (10s tick) | `LeftSidebar.CurrentBoardIssues` + `CurrentMilestones`; also fires Pending Migrations + all 3 chart cache-reads |
| `RenderRunning(running)` | `:4250` (10s tick only) | queue filtered to `Status=="running"` ordered by `UpdatedAt`, from `_queueDb.GetQueueAsync()` (fallback `_buildTrackerApi.GetQueueAsync()`) |
| `RenderWhatsNew(…)` | `:3776` (first paint, if ready), `:3837` (after `InitWhatsNewAsync` computes off-thread) | `VersionInfo.GetNewCommitTitles(LastSeenBuild)` |
| `UpdateFocusState()` | `:3768`, `:4252`, and auto on `FocusModeService.StateChanged` | `FocusModeService.Instance` |
| `RefreshEtaProjectionsAsync(force:false)` | `:3772` (first paint only, fire-and-forget) | `HomeEtaProjectionService` (5-min cache) |
| `RefreshBurndown` / `RefreshOpenCloseRateChart` / `RefreshEpicBurndownCard` / `RefreshPendingMigrations` | self-triggered inside `RenderDashboardState` each tick + per-card ⟳ | as §3 |
| `UpdateClaudeStatus` | **no host call site** — idle (see §4.12) | — |
| `RenderEtaProjection` | not host-called — internal to `RefreshEtaProjectionsAsync` only | — |

### 5.2 View → host (events the host subscribes)
All 14 are subscribed once inline in `OpenHomeTab` (`MainWindow.xaml.cs:3692-3725`); none are
explicitly unsubscribed (the whole view is discarded on tab close).

| Event | Payload | Raised by | Host action |
|---|---|---|---|
| `ResumeChatRequested` | `PersistedChatTab` | Recent Chats row click | `Home_ResumeChatRequested` (reopen chat tab) |
| `ReopenAllRequested` | `IReadOnlyList<PersistedChatTab>` | Reopen All (#2707) | `Home_ReopenAllRequested` (reopen each in order) |
| `RunningItemClicked` | `HomeQueueClick` (`GithubNumber`, `Title`, `QueueItemId`) | Running Now row click | `OpenChatForIssue(n)` when a number is set |
| `ClearStuckItemRequested` | `HomeStuckItemClear` (`QueueItemId`, `GithubNumber`, `Title`) | stale-row ✕ | `CancelQueueItemAsync(id)` → `RefreshHomeRollupAsync(force:true)` |
| `NewIssueRequested` | — | ➕ New Issue / 💬 New Epic Chat | `LeftSidebar.CreateNewIssueAsync()` |
| `BuildWatchRequested` | — | 🖥️ Build Watch | `ToggleBuildWatch()` |
| `TestRunnerRequested` | — | 🧪 Test Runner | `EnsureTestRunnerWindow().Show()` |
| `ReplitRequested` | — | 🌐 Replit | `OpenOrFocusReplitWorkspaceTabInternal()` |
| `ImmersiveFocusRequested` | — | ⛶ Immersive | `FocusModeService.Instance.EnterImmersive()` |
| `DeployRequested` | — | ⚡ Rebuild & Deploy | `TriggerUpdateAsync(forceDeploy:true)` |
| `GitBoardRequested` | — | 📋 Git Board | `ActivityBar.SelectGitBoard()` |
| `SettingsRequested` | — | ⚙️ Settings | `OpenSettingsTab()` |
| `MilestoneDetailRequested` | `int` (milestone number) | View Tab | `OpenMilestoneDetailTab(m)` (looked up in `CurrentMilestones`) |
| `OpenMigrationInSqlRunnerRequested` | `string` (full .sql path) | pending-migration row click | `OpenSqlRunnerTab()` + `SetSqlQuery(File.ReadAllText(path))` |

### 5.3 Refresh cadence (real, layered)
- **`_homeRollupTimer`** — a `DispatcherTimer`, **10-second** interval, started at launch
  (`MainWindow.xaml.cs:1083-1085`). Each tick → `RefreshHomeRollupAsync(force:false)`, which
  re-renders Running + Board Glance (and the cache-read chart refreshes). It **no-ops when
  `_homeView == null`** (Home tab closed) and skips re-render when the running-set signature is
  unchanged (anti-flicker).
- **GitHub cost discipline:** the `gh` open-issue fetch + board reconciliation runs **only on
  `force:true`** — i.e. Home tab open (`:3777`) and clear-stuck (`:3702`). The 10s tick never
  hits GitHub; it refreshes only the local build queue. The three GitHub charts read the shared
  5-min #2711 cache.
- **Health timer:** a separate **30-second** `DispatcherTimer` inside `HomeView` itself
  (`InitializeHealthMonitor`). **Mascot:** a **16-second** timer inside `HomeView`.

### 5.4 Lifecycle
Constructor (`:80-102`) sets the greeting, starts the mascot timer, subscribes
`FocusModeService.StateChanged`, and calls `InitializeHealthMonitor(null)` (the real API client is
supplied later at `:3691`). `Unloaded` unsubscribes `StateChanged` and stops the mascot + health
timers.

---

## 6. Status vocabularies & badge colors

**`HealthStatus` → badge** (`SetStatusBadge`, `:1005-1035`):
| Status | Badge bg | Text | Text color |
|---|---|---|---|
| `Healthy` | `#1E3A2F` | custom (e.g. latency `123ms`) or "OK" | `GreenBrush` |
| `Degraded` | `#3E2E1E` | custom (e.g. "2 ORPHANED") or "WARN" | `YellowBrush` |
| `Unhealthy` | `#3E1E1E` | custom or "ERROR" | `RedBrush` |
| `NotConfigured` | `#2A2B3D` | custom or "NOT SET" | `Subtext0Brush` |
| `Unknown` (default) | `#2A2B3D` | "UNKNOWN" | `Subtext1Brush` |

**Mutex badge** (special, `:957-971`): not held → green "IDLE"; suspicious/stuck → red "STUCK";
else blue "ACTIVE" on `#1E2A3A`. **Worktrees:** `OrphanedCount>0` → yellow "{N} ORPHANED" (+ Clean
button) else green "CLEAN". **Stranded:** `StrandedCount>0` → yellow "{N} STRANDED" (+ Recheck)
else green "CLEAN".

**Running-build states:** live = ▶ peach `#F2CA63`; stale (≥60 min) = ⚠ red `#EE99A0` + border +
✕ clear.

**Chart empty states** are all first-class: every chart card ships an `…EmptyText` element that
shows a real reason (not-enough-history, GitHub unreachable, no PAT) instead of a curve.

---

## 7. Palette (theme resources, dark — Catppuccin-Mocha-derived)

Cards use `StaticResource` brushes from `Themes/DarkTheme.xaml` / `Themes/Colors.xaml`. A design
should treat these as the semantic palette, not literal hexes to hardcode:

| Resource | Hex | Use |
|---|---|---|
| `BaseBrush` | `#661C2128` (α) | page background |
| `Surface0Brush` | `#313244` | inner rows / tiles |
| `Surface1Brush` | `#45475A` | borders / hover fill |
| `CardSheenBrush` | vertical dark gradient | `HomeCard` background |
| `FocusCardSheenBrush` | vertical gradient | Active Focus card |
| `TextBrush` | `#C9D1D9` | primary text |
| `Subtext0Brush` / `Subtext1Brush` | `#8B949E` | secondary / muted text |
| `BlueBrush` (AccentColor) | `#7C8CF0` | focus accent, hover borders |
| `GreenBrush` | `#A6E3A1` | completed/closed lines, healthy, dates |
| `LavenderBrush` | `#B4BEFE` | Total Scope line |
| `PeachBrush` | `#FAB387` | opened/day line, warnings |
| `YellowBrush` | `#F9E2AF` | points, degraded |
| `RedBrush` | `#F38BA8` | unhealthy, offline |
| `MauveBrush` | `#CBA6F7` | mascot card border |
| `StatusSuccessBrush` | `#8FC496` | health OK dots |

Effects: `SoftCardShadow`, `SoftRowShadow` (drop shadows), `BlueGlowSoft`/`GreenGlowSoft` (glows).
Card corner radius 12, inner rows 8. Card style `HomeCard`, row style `HomeRow`, tile styles
`QuickActionTile` / `QuietTile` (`xaml:11-120`).

**No emoji rule note:** the live code uses emoji glyphs as inline icons throughout (🚀 🎯 📈 🔀 📉
🏥 🗄️ 🦊 etc.). This is the real current implementation. A redesign following the project's
lucide-react/no-emoji convention would substitute real icons; they are recorded here as the real
present state, not a recommendation to keep emoji.

---

## 8. Real behavior notes for a designer

- **Everything fails closed.** There is no fake data path anywhere on this surface. Every chart
  and projection has a real, code-backed empty state carrying a real reason string. Design the
  empty states as first-class — they render often (no PAT, GitHub unreachable, thin history, a
  brand-new milestone).
- **Refresh cadence is real and layered:** a 10-second host rollup drives Board Glance / Running /
  the three GitHub charts (all cache-reads off the 5-min #2711 TTL); a 30-second internal timer
  drives System Health; the mascot rolls every 16s; every ⟳ button forces its own fetch.
- **`--` vs `0`:** Board Glance and the Focus milestone % start at `--` and only ever show a real
  number — never a placeholder `0`. Preserve that distinction.
- **Contextual buttons appear only when actionable:** Reopen All (>1 chat), 🧹 Clean (orphaned
  worktrees), 🔀 Recheck (stranded branches), the stale ✕ (stuck build) — all hidden otherwise.
- **The Epic Burndown picker intentionally lists internal-tooling epics** (#1202/#1095) that other
  surfaces hide — this is deliberate (#2776), not a leak.

---

*Contract pack for issue #3017 (child of Feature #3013). Every citation is against
`desktop/BuildConsole/Controls/HomeView.xaml(.cs)` and its backing services on `main` at build
time. Read-only extraction — no product code, schema, or UI was changed to produce this document.*
