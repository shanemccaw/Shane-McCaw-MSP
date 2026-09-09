# BuildConsole Queue Contract Pack — Batter Up / AI Batter Up / Build Queue Panel

> **Notice for UI Designers (e.g., Claude Design)**
> This document is the authoritative specification for three BuildConsole desktop surfaces: the
> **Batter Up** panel, the **AI Batter Up** panel, and the **Build Queue** panel. Every field,
> status string, colour, control, tooltip, and interaction below was extracted by reading the real
> C#/.NET 8 WPF code under `desktop/BuildConsole/` — not from memory, not from the intended design.
> Where a value is a literal in the code (a pill caption, a tooltip, a status string) it is quoted
> verbatim.
>
> You have **full creative freedom over visual appearance** (layout, spacing, typography, card vs
> list, micro-interactions, the dark aesthetic). You have **zero freedom over what data exists**.
> Do not invent a status value, a badge, or a capability that has no backing code here. A missing
> value renders as unavailable (`--`) or an honest empty state — never as a fabricated placeholder.

> **Provenance / verification.** Written for GitHub issue #3015 (sub-issue of #3013,
> `Feature: BuildConsole Contract Packs`). Confirmed against the working tree at the commit recorded
> in `build-journal/3015.md`. Citations are `path:line`. This describes **what is built and working
> now**; a handful of clearly-marked forward references (e.g. #2030 chain-highlight) name landing
> anchors that are deliberately *not* yet built.

---

## 1. Scope & Mental Model

These three surfaces are the front end of BuildConsole's build pipeline. All three render GitHub
issues (or `bt_build_queue` rows) as **cards**, and all three funnel into the **same** launch
pipeline — `BuildQueuePostgresClient.QueueBuildAsync` — rather than owning parallel launch logic.

| Surface | File | What it is | Feeds |
| :--- | :--- | :--- | :--- |
| **Batter Up** | `Controls/BatterUpPanel.xaml(.cs)` | Human-curated launch queue — open issues whose project-board **Status = "Batter Up"**. Reads each item's `BUILD:` comment and either lists it (gated) or auto-queues it (free flow). | `BuildQueuePostgresClient.QueueBuildAsync` (via `BatterUpQueueService`) |
| **AI Batter Up** | `Controls/AiBatterUpPanel.xaml(.cs)` | Agent-filed-findings review queue — open issues with **Status = "AI Batter Up"** awaiting Shane's Yes/No. The one human gate in the #1708 design. | Board Status only (Yes → "Batter Up"); **never** queues directly |
| **Build Queue** | `Controls/BuildQueuePanel.xaml(.cs)` (+ `.QueuePause.cs`, `.NewBuildPaste.cs`) | The live queue itself — every `bt_build_queue` row rendered as a status-coloured card in a DAG, with per-card actions, progress, and a global pause. | Launches/parks/cancels rows via `BuildQueuePostgresClient` + `QueueWatcherService` |

**Board Status is the router.** CLAUDE.md's routing rule sends new agent findings to **"AI Batter
Up"**; Shane's Yes promotes them to **"Batter Up"**; Batter Up's own refresh queues them into
`bt_build_queue`; the Build Queue panel then renders and runs them. The three panels are stages of
one conveyor, not three independent lists.

**Manual-refresh-only (Git #2900).** None of the three panels polls on a timer. All three refill
only on an explicit refresh — the Build Queue header's single shared refresh icon
(`BtnRefreshGitHubTiles`) drives a `LeftSidebar.PopulateGitTrackerBoard(forceFresh: true)` fetch
whose completion fires `LeftSidebar.BoardRefreshCompleted`, which the wiring in `MainWindow.xaml.cs`
cascades to `BatterUpPanel.RefreshAsync()` and `AiBatterUpPanel.RefreshAsync()`
(`MainWindow.xaml.cs:921-922`; `Controls/BuildQueuePanel.xaml.cs:6404-6415`). There is one shared
refresh button, not one per panel.

---

## 2. Shared Foundations

All three panels reuse the same card-building primitives, which live as `static`/`internal` helpers
on `BuildQueuePanel` so Batter Up and AI Batter Up render in the identical visual language:

| Primitive | Signature / citation | What it produces |
| :--- | :--- | :--- |
| Card shell | `BuildGenericCardShell(bool isBlocked)` — `Controls/BuildQueuePanel.xaml.cs:6372` | The rounded (`CornerRadius=6`) bordered `Border` every generic card sits in. Blocked → dark maroon (`#1E1822` bg / `#5A2A34` border); normal → dark slate (`#181825` bg / `#313244` border). |
| Status pill | `BuildStatusPill(string text, Color bg, Color border, Color fg)` — used at `BatterUpPanel.xaml.cs:539`, `AiBatterUpPanel.xaml.cs:313` | Small rounded caption chip; the top-left state indicator on every card. |
| Card mascot (generic) | `CreateGenericCardMascot(int seed, CritterMood mood, bool isBlocked=false)` — `Controls/BuildQueuePanel.xaml.cs:6243` | A small vector critter (fox etc.) whose mood matches the card state. `seed` = issue number, so the same issue always draws the same critter. |
| Card mascot (queue) | `CreateQueueCardMascot(QueueItem item, InteractiveInputState? state)` — `Controls/BuildQueuePanel.xaml.cs:6073` | The richer queue-card variant (15-variant pool) that also reacts to live interactive/waiting state. |
| Mood enum | `enum CritterMood { Normal, Running, WaitingForInput, Blocked, Done, Failed, Verifying }` — `Controls/BuildQueuePanel.xaml.cs:5600` | The mascot mood vocabulary. |
| Issue-ref format | `LocalBuildId.FormatRef(int)` — `Services/LocalBuildId.cs:84`; `FormatIssueRef` in the queue panel | GitHub issues render `#<n>`; local (`--notGit`) builds carry a negative number and render `local #<letters>` (base-26). |

**Agent-mode read-only gate.** When BuildConsole runs as a passive UI-automation agent shell
(`AppMode.IsAgent`, `Services/AppMode.cs:31`), board-mutating controls are disabled but stay
visible — e.g. AI Batter Up's Yes/No both disable with tooltip "Agent mode — board decisions are
disabled" (`AiBatterUpPanel.xaml.cs:401-407`). Designs must accommodate a fully-rendered but
read-only state.

**Hosting.** Batter Up and AI Batter Up are **document tabs** (not docked panels), opened/focused
from two title-bar buttons with live count badges (`TopBatterUpCount` / `TopAiBatterUpCount`), each
holding a single persistent panel instance so state survives close/reopen
(`MainWindow.BatterUpTabs.cs:40-52,60-78,103-170`). The Build Queue panel is the docked right-hand
column.

---

## 3. Batter Up Panel

`Controls/BatterUpPanel.xaml` · `Controls/BatterUpPanel.xaml.cs` · service `Services/BatterUpQueueService.cs` · row model `Services.BatterUpRow`

### 3.1 Layout

A three-column grid (`BatterUpPanel.xaml:64-188`):

- **Left (`1*`, min 240px)** — header row + scrolling card list (`RowsList` inside `RowsScroller`).
- **Splitter (`Auto`, 4px)** — `GridSplitter`.
- **Right (`2*`, min 320px)** — `IssueDetailView DetailPane`, showing the real GitHub description +
  comments of whichever card is selected; its actions sidebar is swapped for the linked-chat column
  (`ShowChatInsteadOfActions = true`, `BatterUpPanel.xaml.cs:80`).

### 3.2 Header controls (`BatterUpPanel.xaml:94-157`)

| Control | x:Name | Behaviour |
| :--- | :--- | :--- |
| Title | — | "⚾ Batter Up" |
| Count / mode | `TxtCount` | `(N) · gated` or `— none · gated` / `... · free flow`; appends ` · N tracked, hidden` when items are suppressed (`BatterUpPanel.xaml.cs:365-371`). |
| Search box | `TxtFilter` (in `FilterBoxHost`) | Display-only substring filter over `#`/title; box shown only when rows exist (`BatterUpPanel.xaml.cs:115-122`). |
| Sort by state | `BtnSortByState` | Groups rows: Ready → Blocked → Failed/Canceled → No-BUILD-comment (`StatePriority`, `BatterUpPanel.xaml.cs:130-142`). |
| Free-flow gate | `BtnFreeFlow` | Persisted toggle. **Green "▶ Free flow"** = auto-queue eligible rows each refresh; **peach "⏸ Gated"** (default) = list only, queue by hand (`BatterUpPanel.xaml.cs:100-111,204-220`). This is a **different** gate from the global Build Queue pause — it stops rows *entering* the queue, not *launching* out of it. |

There is **no per-panel refresh button** — refresh is the shared Build Queue header icon
(`BatterUpPanel.xaml:77-93`).

### 3.3 Data source

`BatterUpQueueService.RefreshAsync` (gated) / `RefreshAndAutoQueueAsync` (free flow),
`Services/BatterUpQueueService.cs:171,388`. Each refresh:

1. **Sweeps** closed issues still sitting in "Batter Up" to "Done" (`SweepClosedIssuesAsync`, line 288).
2. Reads open board items via `GitHubApiClient.GetBatterUpIssuesAsync()` (board option `09b1927f`).
3. For each: parses its most-recent `BUILD:` comment (`ParseBuildComment`, line 94 — reads
   `model=`/`effort=`/`buildSet=` header tokens, an optional `Posted:` line, and the prompt body),
   reads real GitHub `blocked_by` dependencies, and splits blockers into open / satisfied-by-verified-
   DONE-bookend / genuinely-blocking (`BlockingNumbers`, Git #2225).
4. Checks `BuildQueuePostgresClient.FindDedupCandidateAsync` — an item already live in the queue is
   **hidden** (counted in the suppressed total); an item whose queue row **died** (failed/canceled
   with no work landed) **reappears** carrying that terminal status for re-queue (Git #1997).

`Services.BatterUpRow` (`BatterUpQueueService.cs:13-63`) fields: `Number`, `Title`, `HtmlUrl`,
`Model`, `Effort`, `BuildSet`, `Posted`, `Prompt`, `HasBuildComment`, `BlockedByNumbers`,
`OpenBlockedByNumbers`, `SatisfiedByBookendNumbers`, `BlockingNumbers`, `IsBlocked`,
`AlreadyTracked`, `JustAutoQueued`, `TrackedTerminalStatus`, `TrackedTerminalRowId`.

### 3.4 Card anatomy & row states (`BuildBatterUpCard`, `BatterUpPanel.xaml.cs:397-516`)

Top row = status pill + peach issue-number badge. Then wrapped title. Then a detail line:
`<model|default model> / <effort|default effort>  ·  buildSet=<x>` when a `BUILD:` comment exists,
else `no BUILD: comment — not auto-queued`. Blocked rows add a peach `waiting on #N, #M` line built
from `BlockingNumbers` (genuinely-still-blocking only). A `Queue` footer button (§3.5). A generic
mascot on the right (mood Blocked / Done / Normal). Clicking anywhere but the button selects the
card into `DetailPane`.

**Status pill vocabulary** (`BuildStatusPill`, `BatterUpPanel.xaml.cs:536-559`):

| Pill | Condition |
| :--- | :--- |
| `NO BUILD` (grey) | no `BUILD:` comment yet |
| `🔒 BLOCKED` (pink) | genuinely blocking dependency open |
| `↺ CANCELED` / `↺ FAILED` (red) | reappeared dead queue row (`TrackedTerminalStatus`) |
| `✨ QUEUED` (green) | just auto-queued this pass |
| `TRACKED` (blue) | already has a live queue row |
| `⏳ UP NEXT` (grey) | ready, nothing else applies |

### 3.5 Actions

- **Queue** (`QueueRowManuallyAsync`, `BatterUpPanel.xaml.cs:229-269`) — queues one row through
  `BatterUpQueueService.QueueRowAsync` → `BuildQueuePostgresClient.QueueBuildAsync`. Disabled with a
  tooltip when the row has no `BUILD:` comment. Double-click guarded twice (button disable + dedup
  re-check). A reappeared dead row re-queues its exact row (`allowRequeueTerminal`) rather than
  duplicating. On success the button reads "Queued ✓" and the sibling Build Queue panel repaints via
  the `RowsAutoQueued` event.
- **Free-flow auto-queue** — when the gate is on, `RefreshAndAutoQueueAsync` queues every eligible
  row and drops it from the list; blocked rows are queued unchanged (they wait behind the #1600
  launch gate). A failing build never auto-loops (free flow passes no `allowRequeueTerminal`).

### 3.6 Empty / error states (`BatterUpPanel.xaml.cs:296-351`)

No PAT → `TxtEmpty` "No GitHub PAT configured — set one in Settings." · circuit-breaker
short-circuit → self-recovering "GitHub is rate-limiting BuildConsole right now — this will recover
automatically in ~Ns (Git #2815)…" · other error → "Couldn't read Batter Up: <msg>" · zero rows →
inline `— none · <mode>` in `TxtCount` (no separate empty block).

---

## 4. AI Batter Up Panel

`Controls/AiBatterUpPanel.xaml` · `Controls/AiBatterUpPanel.xaml.cs` · service `Services/AiBatterUpQueueService.cs` · row model `Services.AiBatterUpRow`

### 4.1 Layout

Same 1*/splitter/2* grid and `IssueDetailView DetailPane` (chat column on) as Batter Up
(`AiBatterUpPanel.xaml:32-135`).

### 4.2 Header controls (`AiBatterUpPanel.xaml:57-102`)

| Control | x:Name | Behaviour |
| :--- | :--- | :--- |
| Title | — | "🔍 AI Batter Up" |
| Count | `TxtCount` | `(N)` or `— none open` |
| Search box | `TxtFilter` (in `FilterBoxHost`) | Display-only; searches issue `#` (and title as fallback); shown only when rows exist. |

No free-flow toggle, no sort — this panel only reviews.

### 4.3 Data source

`AiBatterUpQueueService.RefreshAsync` (`Services/AiBatterUpQueueService.cs:46`): sweeps closed
"AI Batter Up" issues to Done, reads open items via `GitHubApiClient.GetAiBatterUpIssuesAsync()`
(board option `a0296971`), parses each item's `BUILD:` comment read-only (usually absent for a raw
finding). Rows sorted **highest issue number first** in the panel (`AiBatterUpPanel.xaml.cs:163`).

`Services.AiBatterUpRow` (`AiBatterUpQueueService.cs:12-22`): `Number`, `Title`, `HtmlUrl`,
`ItemId` (the project-item node id, needed for the status mutation), `Model`, `Effort`, `BuildSet`,
`HasBuildComment`.

### 4.4 Card anatomy (`BuildAiBatterUpCard`, `AiBatterUpPanel.xaml.cs:306-431`)

Fixed amber pill **"❓ AWAITING REVIEW"** + issue-number badge; title; a detail line
(`<model> / <effort> · buildSet=<x>` or `no BUILD: comment yet`); a **Yes / No** footer; a generic
mascot with mood `WaitingForInput`. Click-to-select loads `DetailPane`.

### 4.5 Actions (`ApplyDecisionAsync`, `AiBatterUpPanel.xaml.cs:269-296`)

- **Yes** → `AiBatterUpQueueService.PromoteToBatterUpAsync` → sets Status to plain "Batter Up"
  (option `09b1927f`). **It never launches or queues anything** — #1709's Batter Up panel picks the
  promoted item up on its own next refresh. Dark fill, green border/text.
- **No** → `DemoteToBacklogAsync` → sets Status to "Backlog" (option `63cc47c8`). Dark, borderless.
- Either decision removes the item from this queue, so a refresh drops its row. Both buttons disable
  during the in-flight mutation; a failure surfaces a `MessageBox` and re-enables them.
- **Agent mode** disables both (§2).

### 4.6 Empty / error states

Identical shape to Batter Up: no-PAT / circuit-open / generic-error text in `TxtEmpty`, zero rows
inline as `— none open` (`AiBatterUpPanel.xaml.cs:120-172`).

---

## 5. Build Queue Panel

`Controls/BuildQueuePanel.xaml` (700 lines) · `Controls/BuildQueuePanel.xaml.cs` (~6.5k lines) ·
partials `BuildQueuePanel.QueuePause.cs`, `BuildQueuePanel.NewBuildPaste.cs`.

Docked right-hand column, `MinWidth=220`, collapsible/pinnable. A single outer `ScrollViewer` scrolls
the whole panel (Git #1634) — the card list itself has no independent scroll region.

### 5.1 Header (`BuildQueuePanel.xaml:69-207`)

Left: blue `QueueDot` + "BUILD QUEUE". Right, a row of `IconButton`s:

| Button | x:Name | Action | Backing |
| :--- | :--- | :--- | :--- |
| Recover session-limit builds | `BtnRecoverSessionLimit` | Scans the last hour of build logs for "hit your session limit" and resumes any that hit it | `SessionLimitAutoRestartService.ManualRecoverFromLogsAsync` |
| Board reconcile | `BtnBoardReconcile` | Opens the cleanup window reconciling local Verifying/Parked/Crashed rows against the real GitHub board (Git #2136) | — |
| Paste new build | `BtnNewBuildFromPaste` | Raises `NewBuildPasteRequested`; MainWindow opens `EditBuildPromptDialog` with the same `--model/--effort/--title/--buildSet/--account/--blocked-by/--notGit` header parsing (`BuildQueuePanel.NewBuildPaste.cs:27-30`) | `EditBuildPromptDialog` |
| Pause / Running toggle | `BtnPauseQueue` (`PauseQueueIcon`/`PauseQueueLabel`) | Global queue pause — new items don't **start** (running builds keep going); queuing still works. Peach "Paused" vs green "Running" (`BuildQueuePanel.QueuePause.cs:29-63`) | `QueueWatcherService.SetPaused` |
| Refresh (shared) | `BtnRefreshGitHubTiles` | THE single shared refresh — Git board + Batter Up + AI Batter Up + milestones + focus + GitHub tiles; only completes its toast once every panel has actually repainted (Git #2976) | `FullGitRefreshRequested` → board fetch cascade |
| Pin / collapse | `BtnPinQueue` (`PinQueueIcon`) | Toggles pinned/collapsed; raises `PinToggled` | — |

### 5.2 Build-Set Rollup (`BuildSetRollupSection`, `BuildQueuePanel.xaml:209-281`)

Collapsible per-`buildSet` status summary, docked above the queue, hidden when no build set has live
activity. Header "BUILD SETS"; a drill-down "clear" affordance (`BuildSetRollupClearText`); activity
filter chips **All / Running / Verifying** (`RollupFilterChip*`, only narrow which rollup rows show).
Rows populated in code-behind (`RenderBuildSetRollup`); the list is capped at `MaxHeight=180` and
scrolls internally so it can never push the real queue off-screen (Git #2179). Clicking a rollup row
drills the queue graph to that set, composing (AND) with the filter combo + search.

### 5.3 Queue status counts + next-to-run peek (`BuildQueuePanel.xaml:305-377`)

`QueueStatusBorder` shows four **reconciled** counts (Git #1862):
`In queue: N  ·  Blocked: N  ·  Up next: N  ·  Verifying: N` (`QueueStatusCountsText`) plus a
`(N active)` running readout (`QueueActiveSlotsText`). Clicking opens `QueueNextPopup` — "NEXT TO
RUN", the next five builds in genuine claim order via `BuildQueuePostgresClient.PeekNextAsync(5, _openIssues)`
(`BuildQueuePanel.xaml.cs:1319-1338`), captioned "Real claim order — a read-only peek, claims nothing."
Counts computed by `ComputeQueueStatusCounts` (`:1235`): `In queue = queued + limit-paused`. Before the
first board refresh the Blocked count is **provisional**, shown as `N*` (muted) with tooltip "Blocked
count is provisional — waiting for the first Git Board refresh…"; once live it appends "blockers last
checked <ago>" (`:1270-1293`).

### 5.4 Crash/orphan recovery banner (`OrphanRecoveryBanner`, `BuildQueuePanel.xaml:379-421`)

Red banner shown only when builds were orphaned by a crash/restart (`status=="failed" && ExitCode==-2`).
`OrphanRecoveryText` shows the count; `BtnRecoverOrphans` ("♻ Recover All") resumes each (Resume
Session where a session id was captured, else Retry); right-click → "✓ Mark All Recovered (Dismiss)".

### 5.5 Filter + search (`BuildQueuePanel.xaml:423-517`)

`QueueFilterCombo` (default index 0 = Running) with tags: **Running** (running + verifying),
**Queued** (queued + limit-paused), **Running & Queued**, **Verifying**, **Crashed**
(`failed && ExitCode==-2`), **Parked**, **Capped**, **External**, **Done**, **Canceled**, **Tests**,
**All** (mapping in `ApplyFilter`, `BuildQueuePanel.xaml.cs:1434-1493`). `QueueSearchBox` is a
submit-on-Enter substring filter on GitHub number (Git #2028), layering (AND) on top of the combo.
On broad "All" with an empty search the list shows the placeholder "Type a build number to search."
(`QueueBroadFilterPlaceholderText`) rather than rendering every card. A non-reflowing
`BuildSetFilterWarningPopup` warns when a dispatch/search result is hidden by an active build-set filter.

### 5.6 The queue graph & card container (`BuildQueuePanel.xaml:553-591`)

`QueueGraphContainer` = a `QueueGraphCanvas` (DAG lane connectors / Bézier edges / status node dots)
column beside `QueueCardsHost` (the stack of build cards). `RenderQueue` rebuilds `QueueCardsHost`
every pass (`BuildQueuePanel.xaml.cs:1722`).

**Empty / offline states** (`QueueEmptyText`, `BuildQueuePanel.xaml.cs:1766-1905`): per filter —
"Nothing running." / "Nothing queued." / "Nothing crashed." / "Nothing done yet." / "Nothing
canceled." / "Queue is empty." (each gets a build-set suffix when a set filter is active); search
with no match → "No queued item matches #<search>."; broad "All" with empty search →
"Type a build number to search."; not configured → "Not connected — set apiBaseUrl/ingestToken…";
API error → "Couldn't reach the API: <msg>". When running off the HTTP cache, an in-card banner
reads "⚠ Offline — showing cached queue from <time>".

Below the queue sit two further sections and two collapsed-by-default quiet tiles: **Issues in this
chat's epic** (`ChatEpicIssuesSection`, visible only when the active tab is a chat linked to an epic,
with All/Open/Closed chips), and the currently-hidden **In-Flight** / **Sessions** tiles
(`BuildQueuePanel.xaml:595-693`, both `Visibility="Collapsed"` per Shane 2026-08-28 to give the
queue more height; wiring retained). A `CritterLoungeControl` docks at the bottom.

### 5.7 Data source & refresh (`BuildQueuePanel.xaml.cs:304-339, 819-876`)

`Initialize(BuildTrackerApiClient api, QueueWatcherService? watcher, BuildQueuePostgresClient? db,
SessionLimitAutoRestartService? sessionLimitAutoRestart)`. `RefreshAsync` reads the queue from the
**direct local DB** `BuildQueuePostgresClient.GetQueueAsync()` when a `db` client is present,
otherwise from the HTTP fallback `BuildTrackerApiClient.GetQueueCachedAsync()` (which can return
stale-cache data surfaced via `SyncError` "…showing cached data from … — dev server unreachable").
Refresh is **manual-only** (Git #2900 removed the old 10s/15s `DispatcherTimer`s). Each refresh:
diffs a signature, re-renders the graph + rollup, updates status counts, updates the orphan banner,
raises `CappedCountChanged` (drives the title-bar capped count), and kicks background issue-title
fetches. The pause state lives in `QueueWatcherService` (in-memory, per-app-instance).

### 5.8 Build status vocabulary — the card's authoritative states

Status strings live on `QueueItem.Status` (`Services/BuildTrackerApiClient.cs:13-64`). Grouping
helpers: `IsActiveStatus` = `queued | parked | running | capped | verifying | limit-paused | external`
(`BuildQueuePostgresClient.cs:569`); `IsTerminalStatus` = `done | failed | canceled` (line 577).
The card's pill, border, and background colour are chosen per state in `BuildQueueCard`
(`BuildQueuePanel.xaml.cs:3274-3595`):

| Card state | Pill caption (verbatim) | Accent | Meaning |
| :--- | :--- | :--- | :--- |
| Waiting for input | `❓ ASK QUESTION` | amber `#F9E2AF` | The running session is asking a question. |
| Paused (per-build) | `⏸ PAUSED` | peach `#FAB387` | In `PausedBuildIds`; won't be claimed. |
| Running | `▶ RUNNING` | blue `#89B4FA` | Actively executing. |
| Verifying | `🔎 VERIFYING` | teal `#74C7EC` | Session exited 0; waiting for its GitHub issue to close before Done. |
| Done | `✨ DONE` | green `#A6E3A1` | Completed and confirmed. |
| Failed | `✕ FAILED` | pink `#F38BA8` | Non-zero exit; `-2` = orphaned by crash/restart (shows resume/retry detail line). |
| Limit-paused | `⏸ LIMIT — AUTO-RESTARTS` | blue `#89B4FA` | Hit session limit; auto-requeues ~10min after the parsed reset. |
| Parked | `📥 PARKED` | grey `#6C7086` | Staging area (Git #1638) — never auto-claimed; un-park to queue. |
| Capped | `CAPPED — ABOVE SONNET HIGH` | peach `#FAB387` | Conservation Cap on + model/effort exceeds Sonnet High (Git #1989). |
| External | `🚀 EXTERNAL` | blue `#89B4FA` | "Send to Builder" launch — outside the 8-slot cap, not watcher-claimable. |
| Superseded | `↩ REPLIED → #N` | mauve `#CBA6F7` | Resolved by a Reply/resume; session taken over by build `SupersededById` (Git #2119). |
| Up next | `⏳ UP NEXT` | grey | Queued, all blockers clear. |
| Blocked | `🔒 BLOCKED` | pink `#F38BA8` | A genuinely-open blocker holds it (see `LiveBlockedBy`). |
| Restart (pseudo) | `🔄 RESTART` + `💤` | mauve `#CBA6F7` | A separate `BuildRestartCard` (`:3175`) for a row queued for restart, waiting for its build set to finish (not dependency-blocked). |

`SupersededStatus` and `VerifyingStatus`/`CappedStatus`/`LimitPausedStatus` are the code constants
behind these strings (`BuildQueuePostgresClient`, `AccountCapPolicy.CappedStatus="capped"`,
`SessionLimitAutoRestartService.LimitPausedStatus`). Terminal set for build-set completion checks is
`{ done, failed, canceled }` (`PriorityTerminalStatuses`, `:887`); `IsActiveStatus`/`IsTerminalStatus`
(`BuildQueuePostgresClient.cs:569,577`) are the queue-client grouping helpers.

**Mini-map dots.** Alongside the cards, the DAG canvas draws per-node status dots
(`CreateGraphNodeDot`, `:2400`) with their own per-status tooltips — the same state vocabulary as the
cards (waiting / running / paused / blocked / verifying / done / failed / restart / up-next).

### 5.9 Card badges (top row, after the pill) — `BuildQueuePanel.xaml.cs:3597-3736`

| Badge | Condition | Content |
| :--- | :--- | :--- |
| Issue-number badge | `GithubNumber != null` | `#<n>` / `local #<letters>` (peach) |
| Model · effort badge | any model/effort present | short form only, e.g. `Sonnet · High` (`ShortModelName`/`ShortEffortName`, `:4167`) — never the full model id |
| Capped-reason badge | status == capped | `⚠ Opus + xhigh effort` etc. (which half of `ExceedsSonnetHigh` tripped) |
| "blocks N" badge | this build blocks downstream builds | `⛓ blocks N`; the top bottleneck (`blockCount == max`) turns pink/bold "Critical path" |
| Chat badge | `OriginatingChatId`/`ChatUrl` present | `💬 Chat`; click opens/focuses the linked chat tab |

### 5.10 Progress bubbles (`BuildProgressBubbleRow`, `BuildQueuePanel.xaml.cs:3907-3972`)

A compact row of small step bubbles (14×5px, `CornerRadius=2.5`), **one per `BuildProgressReport.Total`**,
built from the same live `BuildProgressTracker.GetProgress(item.Id)` data Build Watch renders. Bubbles
before the current step render **filled green**; the current step renders **active yellow**; remaining
render **empty**. Tooltip: `Step/Total (Percent%) — <CurrentLabel>`. A build that never called
`reportProgress` (`report == null || Total <= 0`) collapses the row entirely — **no fake bar**. The row
self-subscribes to `BuildProgressTracker.ProgressChanged` for live updates without a full card rebuild.

(This is the per-card mirror of the same `reportProgress` mechanism CLAUDE.md mandates — the
`step/total/label` a build reports via `scripts/report-progress.mjs`.)

### 5.11 Epic-name chip (`BuildEpicChipRow`, `BuildQueuePanel.xaml.cs:3855-3892`)

A small `◆ <Epic title>` chip rendered right after the progress row, resolved on-demand via the
`ResolveEpicForIssue` delegate (MainWindow wires it to LeftSidebar's real ancestor-walk). Returns
**null → renders no row at all** when the item has no GitHub number, the delegate isn't wired, or the
issue has no resolvable Epic ancestor — never a placeholder Epic name. Title trimmed to 42 chars.
Clicking activates/reopens that Epic's chat tab via `EpicChipClicked` (Git #2801).

### 5.12 Blocker ghost cards (`BuildBlockerGhostCard`, `BuildQueuePanel.xaml.cs:4058-4138`)

For a `queued` card with genuinely-open blockers (`LiveBlockedBy(node)`, filtered against the live
`_openIssues` set so badge and text never disagree — Git #2070), each blocker renders as a dimmed
(`Opacity=0.68`) maroon ghost/placeholder card (Git #2062) showing the blocker's **real** short
status (`GhostStatusLabel` — same RUNNING/BLOCKED/DONE/… vocabulary as the mini-map dots) + issue ref
+ real GitHub title. If the blocker is itself a live node in this render, the ghost is clickable and
jumps to that node; otherwise it shows "○ OPEN" and, until the background title fetch lands, the bare
ref + italic "(fetching title…)" — **never an invented title**.

### 5.13 Other card elements

- **Mascot** — `CreateQueueCardMascot(item, interactiveState)` on the right of every card
  (`BuildQueuePanel.xaml.cs:3803-3809`); a 42×36 critter picked from a 15-variant pool by
  `abs((GithubNumber ?? Id) % 15)`, its mood + glow set by status, with small overlay badges: `🔒`
  blocked, `💬` waiting-for-input, `🔎` verifying, `✨` done, `🩹` failed (`:6073-6229`). The
  `CritterLoungeControl` at the panel bottom auto-hides when ≥3 queue items are shown (`:6478`).
- **Log-exists dot** — a quiet 6px teal dot top-right when a real log file exists for the queue id
  (`BuildLogExistenceCache.HasLog`, Git #1876) — a diagnostic "this genuinely started running"
  signal, batched to one directory listing per poll (`:3811-3833`).
- **Selection** — clicking a card selects it (blue 1.8px border) and raises `TaskSelected` with
  epic/status/waiting-on details (`SelectNode`, `:3974-4002`).

### 5.14 Per-card actions — right-click context menu (`BuildCardContextMenu`, `BuildQueuePanel.xaml.cs:4386`)

The menu is **status-aware** — items appear per state. Full inventory (verbatim headers, cited):

| Menu item | Appears for | Line |
| :--- | :--- | :--- |
| `💬 Open Originating Chat` | has originating chat | `:4390` |
| `📋 Open Build Log` | any | `:4399` |
| `✓ Mark Complete (Hide)` | any | `:4403` → `_db.MarkCompleteAsync(id,0)` |
| `💬 Reply… (resume this session with a message)` | completed w/ session | `:4437` (marks original `superseded`, `SupersededById`) |
| `⏵ Resume (unstick after network loss)` | running | `:4490` |
| `⏹ Stop` | running | `:4501` |
| `🅿️ Park (blocked on something else)` | running | `:4529` |
| `⏸ Pause Build` / `▶ Allow Build` | running/queued | `:4565` (toggles `PausedBuildIds`) |
| `🚀 Run Now` | queued | `:4584` |
| `⚡ Start Now` | queued | `:4622` |
| `🅿️ Park` | queued | `:4648` |
| `✕ Cancel` | queued | `:4675` |
| `▶ Resume Now (skip the wait)` | limit-paused | `:4713` |
| `🅿️ Park` / `✕ Cancel Build` | limit-paused | `:4743`/`:4770` |
| `▶ Un-park (send to queue)` | parked | `:4807` |
| `✕ Cancel` | parked | `:4834` |
| `Run at Full Model` | capped | `:4867` (spends headroom) |
| `Cancel` | capped | `:4902` |
| `📜 Tail Log` | failed/running | `:4935` |
| `▶ Resume Session (crash recovery)` | failed w/ session | `:4952` |
| `🔄 Retry (start over)` | failed | `:4980` |
| `🔗 Open Git #<n>` / `(side-by-side)` | has GitHub number | `:5010`/`:5014` |
| `🔤 Local Build IDs…` | any | `:5022` |

Build-set rollup rows have their own menu: `⭐ Mark as Priority`, `🔒 Build Only This Set` /
`🔓 Clear Exclusive Mode`, `💬 Open Originating Chat`, filter/expand/`🗑 Remove Entire Set (→ Backlog)`
(`:2544-3093`). Session tiles carry `✕ Close Session` (`:409`).

Board-mutating actions mirror the GitHub board via `SyncGitHubParkStatus` → `BoardStatusSync.Mirror`
(`:4199`): Park → `ParkOptionId`, Un-park → `BatterUpPromoteOptionId`, Remove Set → `BacklogOptionId`.
The same actions are also exposed as **public quick-action wrappers** for the Git Board's hover
popover (Git #2061): `QuickDispatchAsync`, `QuickCancelOrStopAsync`, `QuickRetryAsync`,
`QuickReplyAsync`, `QuickOpenChat` (`:4245-4384`). There is **no in-panel edit-prompt and no
drag-reorder** — ordering is derived by dependency/status (`OrderByDependency`, `:1683`), and new/edit
prompts route out via `NewBuildPasteRequested` to MainWindow's `EditBuildPromptDialog`.

### 5.15 Conservation cap & account routing

Conservation Cap (`AccountCapPolicy`, `Services/AccountCapPolicy.cs`): when the cap toggle is on, a
build whose model/effort exceeds Sonnet High (`ExceedsSonnetHigh` — Opus, Fable, or above-High
effort) is parked as `capped` rather than launched; the title-bar Drain action releases everything
capped, and a card's `Run at Full Model` overrides one. Account routing: `QueueItem.Account`
(`primary`/`secondary`) selects which Claude account the launched build runs against (secondary =
overflow via `CLAUDE_CONFIG_DIR`); it is set at dispatch via the `--account` flag / the Edit dialog,
not on the card.

---

## 6. Board-Status Option ID Reference

The project board is `PVT_kwHOEiBDdc4BeoiY`, Status field `PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0`
(`Services/GitHubApiClient.cs:1069,1096`). Single-select option ids used by these panels:

| Status | Option id | Used by |
| :--- | :--- | :--- |
| Batter Up | `09b1927f` | Batter Up read; AI Batter Up "Yes" (`BatterUpPromoteOptionId`) |
| AI Batter Up | `a0296971` | AI Batter Up read |
| Backlog | `63cc47c8` | AI Batter Up "No" |
| Park | `19cfa11c` | queue park |
| Verifying | `1ac1c7b2` | completion → verifying |
| Crashed | `6c8640a8` | crash reconcile |
| Done | `0003ae3b` | closed-issue auto-sweep |
| Ask Shane | `404998bb` | — |

---

## 7. Cross-References

- Broader shell inventory: `docs/buildconsole/buildconsole-contract-pack.md`.
- The three panels all terminate at `BuildQueuePostgresClient.QueueBuildAsync`; the #1600 fail-closed
  watcher (`GetNextAsync`) governs whether a queued, blocked item actually launches.
- Forward anchors named but **not** built: #2030 (click-to-highlight dependency chain, ghost-card
  `Tag` markers already placed), Epic #1788 / #2108–#2111 (Dynamic Build Queue Map).
