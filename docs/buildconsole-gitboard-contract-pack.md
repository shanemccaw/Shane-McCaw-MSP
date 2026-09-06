# Git Board & Chats Panel (LeftSidebar) — BuildConsole contract pack

**Git #3014**, a sub-issue of **#3013 (Feature: BuildConsole Contract Packs)**, under
**#1791 / Epic #1202 (Build Console)**. Same discipline as Portal's own
`docs/{module}-contract-pack.md` files.

> **Notice for UI Designers (e.g. Claude Design)**
> This documents what is **actually built and working right now** in
> `desktop/BuildConsole/Controls/LeftSidebar.xaml` and `LeftSidebar.xaml.cs` —
> confirmed by reading the real code, cited to `file:line`, not the intended or
> aspirational design and nothing from memory. You have full creative freedom over
> visual appearance. You have **zero freedom over what data exists**: every field,
> colour, badge, enum value and interaction below is backed by real C#/.NET 8 WPF
> logic. Never invent a field, and never render a fabricated placeholder — a value
> with no real backing must read as unavailable, never as a fake row.

All line citations are against the two files above unless another path is given. This
control is the **left sidebar** of BuildConsole's three-column shell; it multiplexes
eight views through one header and `SwitchView` (`.cs:1714`). This pack covers only the
two the issue names — **Git Board** (`IssuesView`) and **Chats** (`ChatsView`) — plus
the **Local/Git Map picker** those feed into. The other six views (Explorer, Search,
Git source control, Settings nav, UI Automation, Graph API) live in the same file but
are out of scope here.

---

## 0. Shell, header, and view multiplexing

The whole control is one `Border` → `DockPanel` (`.xaml:7-10`). A fixed **section
header** strip (`.xaml:13-79`) sits on top of every view and carries:

- `HeaderTitle` (`.xaml:20`) — text set per active view by `SwitchView` (`.cs:1726`):
  `"CHATS"`, `"GIT BOARD"` (for `Issues`), `"UI AUTOMATION"`, `"GRAPH API PANEL"`, else
  the view name upper-cased.
- `ShaneAppIndicator` (`.xaml:28-43`) — a `#33A6E3A1` pill with a running-green dot and
  a live label, shown only while a `shaneapp://` protocol execution is running
  (`OnShaneAppStatusChanged`, `.cs:742`); click opens the live streaming console
  (`.cs:762`).
- Header buttons (`.xaml:48-76`): **New** (`BtnNewItem`, tooltip re-labelled per view at
  `.cs:1729`), **Refresh Git Board** (`BtnRefreshGitBoard`, visible only on the Issues
  view — `.cs:1741`), **Collapse All**, and **Pin/Collapse Panel** (`BtnPinSidebar`,
  toggles `_isPinned`, `.cs:318`).

`SwitchView(view)` (`.cs:1714-1767`) flips exactly one child `Grid` to `Visible` and
the rest to `Collapsed`, then lazy-loads that view's data: `Issues` →
`PopulateGitTrackerBoard()`, `Chats` → `PopulateChatsTree()`.

The sidebar is created with `new LeftSidebar()` (`.cs:701`), then wired by MainWindow via
`Initialize(api, db)` (`.cs:655`), which:
1. `await`s the first board fetch (`PopulateGitTrackerBoardAsync`) so the first Chats
   render doesn't race an empty board (`.cs:669`; the #1362 synthetic-epic backfill needs
   `_lastBoardIssues` populated first);
2. renders Chats + manifests + pinned questions;
3. starts a **20-second `DispatcherTimer`** (`.cs:678`) that **only refreshes Chats**
   (local dev server) and pinned questions — never GitHub. GitHub is fetched **only on
   an explicit user action** (opening the Issues tab or the manual Refresh button); the
   background GitHub poll was removed entirely (`.cs:638-645`, Shane 2026-08-14). The
   timer is suppressed whenever the host window is minimized/hidden (`IsHostWindowVisible`,
   `.cs:648`).

---

## 1. Data sources (real, confirmed)

### 1.1 Git Board — live GitHub

Fetched in `PopulateGitTrackerBoardAsync(forceFresh)` (`.cs:1876`). Requires a GitHub PAT
in settings; with none it clears the tree, zeroes the four stat chips, and shows
`"No GitHub PAT configured — set one in Settings…"` (`.cs:1883-1892`).

| Data | Real call | Notes |
|---|---|---|
| Open issues/epics | `GitHubApiClient.ListBoardIssuesAsync(GitHubIssueState.Open)` (`.cs:1908`) | GraphQL; default board is **OPEN only** — closed issues drop out of view entirely (`.cs:1905-1907`) |
| Milestone open/closed counts | `GetMilestonesThrottledAsync` → `GitHubApiClient.GetMilestonesAsync` (`.cs:1913`, `1832`) | REST; cached **5 min** (`MilestonesCacheTtl`, `.cs:1829`) so the 20s-era poll didn't burn the rate limit |
| Transitive leaf rollups | `GitHubIssueTimeSeriesService.GetAllIssuesAsync()` (`.cs:2131`) | ALL-states set, 5-min TTL cache shared with Home; needed because OPEN-only can't see closed descendants. Best-effort — falls back to native counts |
| Blocked-by dependencies | `EnrichBlockedStatusAsync(pat)` (`.cs:2313`) | Second pass, one REST `blocked_by` call **per open issue**; throttled to once per **3 min** (`BlockedEnrichMinInterval`, `.cs:2287`). The GraphQL board carries no dependency data, so `IsBlocked` is always false at build time and is **reseeded from `_blockedStatusCache`** on every rebuild (`.cs:2311`, `2709`) so the badge survives between sweeps |
| Closed issues (Done view) | `ListBoardIssuesAsync(GitHubIssueState.Closed)` + `GetMilestonesAsync` (`.cs:7130-7131`) | On-demand, only when the 🟢 Done chip is clicked; bypasses the cache |

The **manual Refresh** button (`BtnRefreshGitBoard_Click`, `.cs:346`) is now the primary
GitHub trigger. It calls `RefreshGitBoardWithLoadingFeedbackAsync` (`.cs:372`) which
force-fetches (bypassing the unchanged-signature short-circuit and both caches), awaits
the whole span (fetch + first render + blocked sweep), disables the button, and shows the
**critter loading strip** (`GitRefreshLoadingStrip` / `GitRefreshStripCanvas`,
`.xaml:588-596`) for the real duration.

A cheap JSON **content-signature guard** (`_lastInProgressSignature`, `.cs:2116-2122`)
skips the whole tree repaint when the fetched issue+milestone data is byte-identical to
what's shown, preserving scroll and expanded state (the anti-flash fix, Git #821).

### 1.2 Chats — local dev server / direct Postgres

Fetched in `PopulateChatsTree(forceFresh)` (`.cs:2859`). Requires the Build Tracker API to
be configured (`_api.IsConfigured`, `.cs:2861`) else shows `"Not connected — see Settings"`.

- With a direct Postgres client (`_db`): `_db.GetBoardAsync()` (`.cs:2875`).
- Otherwise: `_api.GetBoardAsync()` (the local dev server's `GET /extension/board`),
  which **falls back to a local cache** when the server is unreachable, returning
  `IsStale=true` + `CachedAtUtc` rather than throwing (`.cs:2885-2891`, Git #931).

The payload is a `BoardResponse` with `Chats` (→ `_lastBoardChats`, `.cs:2919`) and `Epics`
(→ `_chatEpicById` keyed by epic id, `.cs:2920`). A missing `bt_chats.account` column is
surfaced as an explicit "database not ready" message naming the exact migration
(`.cs:2906-2912`, Git #1480), never as a fake account-scoped panel.

Chats has its **own manual Refresh** (`BtnRefreshChats`, `.xaml:138`; handler `.cs:422`)
that force-fetches and repaints. Its own signature guard (`_lastBoardSignature`,
`.cs:2963`) folds in the stale/live flag and the resolvable-epic key set, not just the raw
payload.

---

## 2. Git Board view (`IssuesView`, `.xaml:465-685`)

### 2.1 Fixed top region

- **Stat chips** (`UniformGrid`, `.xaml:469-506`) — four cards, each an emoji + label +
  count, populated live in `RenderIssuesTreeAsync` (`.cs:4997-5000`):
  - 🎯 `IssueStatMilestones` "N Active" (BlueBrush)
  - ⚡ `IssueStatEpics` "N Active" (MauveBrush)
  - 🔥 `IssueStatOpen` "N Pending" (PeachBrush)
  - ✓ `IssueStatClosed` "N Done" (GreenBrush)

  Counts are scoped to the currently-shown milestones (Focus Mode may hard-filter to one,
  §2.7).
- **Issue search box** (`QuickAddIssueBox`, `.xaml:510`) — real GitHub issue search by
  number or title across all states via the Search Issues API (`QuickAddIssueBox_KeyDown`
  `.cs:6954`, `QuickAddIssueBox_TextChanged` `.cs:7015`); matches render as
  `CreateSearchIssueHeader` nodes (`.cs:7035`).
- **Active Working Epic bar** (`ActiveWorkingEpicBar`, `.xaml:514-547`) — a green-tinted
  `#1A2D23` pill with a "LOCATE ➔" chip; shown only when an active epic is set. Text
  `"WORKING: #N — <title>"` (`.cs:5057`). Click → `LocateWorkingEpic()` (`.cs:4761`): walks
  the parent chain, expands every ancestor, selects and `BringIntoView`s the node, and
  plays a scale-pulse animation (§2.7).
- **GATE cards** (`GateCardHost`, `.xaml:556`; built by `RenderGateCards`, `.cs:5492`) —
  see §2.4.
- **Filter chips** (`.xaml:559-573`) — see §2.5.
- **Loading strip** (`GitRefreshLoadingStrip`, `.xaml:588-596`) — 56px critter-crossing
  animation band, shown for the real duration of a manual refresh only.
- **Status-dot legend** (`.xaml:609-628`) — a one-time `WrapPanel` legend, hand-kept in
  sync with `CreateStatusDot` (there is no shared source of truth; `.cs:4869-4878`). Lists:
  Working (solid `StatusRunningBrush`), In Flight (solid `#FAB387`), In Flight ↓
  descendant (hollow `#FAB387` ring), Blocked (solid `#F38BA8`).

### 2.2 The tree (`IssuesTree`, `.xaml:632-642`)

Three real levels, built in `BuildBoardFromGitHub` (`.cs:2667`) and rendered by
`RenderIssuesTreeAsync` (`.cs:4977`):

```
🎯 Milestone  (grouped by GitHub milestone; "No Milestone" pinned last)
   └ ⚡ Epics / ⚡ Issues / ⚡ Shane To-Do   (three fixed buckets per milestone)
        └ issue / epic row  → its sub-issues nested by ParentNumber (recursive)
```

- **Milestones** come from grouping the OPEN issues by `MilestoneTitle` (`.cs:2739`), plus
  a backfill pass that adds every real GitHub milestone with zero open issues so an empty
  or 100%-complete milestone still appears (`.cs:2800-2823`, Git #884). Closed milestones
  are excluded from the OPEN board (`.cs:2809`, Git #925). Sorted alphabetically,
  `"No Milestone"` last (`.cs:2828`).
- **Buckets** are three fixed `GitEpic` objects per milestone (`.cs:2758-2760`), each with a
  hard-coded accent colour:
  - `⚡ Epics` — **`#89B4FA`** (blue) — issues where `IsEpic && !IsTodo`
  - `⚡ Issues` — **`#A6E3A1`** (green) — `!IsEpic && !IsTodo`
  - `⚡ Shane To-Do` — **`#F5C2E7`** (pink) — `IsTodo`

  A bucket only renders if it has issues (`.cs:2761-2763`). Inside a bucket, only
  top-level rows (no in-view parent) are placed at the bucket root; their children nest
  recursively via `PopulateIssueTreeHierarchyAsync` on `ParentNumber` (`.cs:5320-5403`,
  `5741`). The **Shane To-Do bucket is flat** — every to-do shows directly even if it has
  a parent epic (`.cs:5370-5384`).
- **Rows sort newest-first** (`OrderByDescending(i => i.Number)`, `.cs:2700`, `5751`).
- The tree is **collapsed by default**; manual expansions are remembered in
  `_expandedNodeKeys` (keyed by stable string, not TreeViewItem instance, so state
  survives a full rebuild — `.cs:4715`, Git #873). Ancestors of the active working epic
  auto-expand (`_activeEpicAncestorNumbers`, `.cs:5982`).
- Rendering is **chunked across dispatcher frames** (`YieldIssuesTreeChunkAsync`, 40ms
  budget, `.cs:4952`, Git #1679) so a large board (measured 257 issues / 49 epics) doesn't
  block the UI thread; a newer render supersedes an in-progress one via a version stamp.

### 2.3 Issue row anatomy (`CreateIssueHeader`, `.cs:5782-6350`)

A horizontal `StackPanel` per row, left to right:

1. **Priority glyph** (`.cs:5796`): `⚡` for an epic, else `GitIssue.PriorityBadge`
   (`.cs:104`): `🔥` HIGH, `🟡` MED, `🟢` else.
2. **Number pill** (`.cs:5798-5806`): `#NNN` on a `Surface0Brush` rounded border; text is
   **MauveBrush for an epic, PeachBrush for an issue**.
3. **Status dots** (all via `CreateStatusDot`, `.cs:4879`; 9px, solid or hollow ring):
   - **Working** — solid GreenBrush, only on the active working epic row (`.cs:5838`).
   - **In Flight** — solid `#FAB387`, when the issue carries the real `in-flight` GitHub
     label (`.cs:5869`).
   - **In Flight ↓ (descendant)** — hollow `#FAB387` ring, when a sub-issue anywhere
     beneath is in flight but this row isn't (`.cs:5884`).
   - **Blocked** — solid `#F38BA8`, tooltip `"Blocked by #N: <title>"` when known
     (`.cs:5894`).
4. **NO EPIC** badge (`.cs:5849-5862`) — a peach pill with black text, only on a non-epic,
   parent-less, still-open issue. (Kept as text, not a dot — Git #1785.)
5. **Title** (`.cs:5815-5828`): `CharacterEllipsis`, single line. Colour precedence:
   active-epic → GreenBrush; CLOSED → Subtext0Brush + **strikethrough**; `Feature:`-titled
   → LavenderBrush (Git #2789); else TextBrush. Bold for epics/active-epic.
6. **Sub-issue progress pill** (`.cs:5910-5934`) — `"NN% (n/n)"` on any row with real
   sub-issues (`SubIssueCount > 0`), from the transitive rollup. Colour is
   completion-aware: **GreenBrush ≥100%, PeachBrush >0%, Subtext0Brush at 0%**.

The active-epic row is additionally wrapped in a `Border` with a 3px GreenBrush left
accent bar and a `#1AA6E3A1` background tint (`.cs:5952-5964`). Every row gets a
transparent hit-test background and `MouseEnter/Leave` handlers driving the hover popover
(§2.6, `.cs:5971-5973`). Title `MaxWidth`s are computed per-row against the tree's live
width so ellipsis actually engages (`ApplyIssueTitleMaxWidths` + the per-level reserve
constants at `.cs:4849-4865`).

**Milestone header** (`CreateMilestoneHeader`, `.cs:5614`): `🎯 <title>` + optional Working
dot (contains active epic), optional hollow-amber in-flight-descendant dot, a blue
**progress pill** `"NN% (n/n)"` only when the milestone has real counts (`.cs:5642`), and a
mauve **FOCUS** pill when Focus Mode is zoomed into it (`.cs:5670`).

**Epic-bucket header** (`CreateEpicHeader`, `.cs:5704`): the bucket title in the bucket's
hard-coded accent colour (`e.ColorHex`, `.cs:5707`) + a muted `" (N)"` count + the same
Working / in-flight-descendant dots.

### 2.4 GATE cards (`RenderGateCards`, `.cs:5492`)

Any open, top-level (`ParentNumber == null`) issue whose title starts case-sensitively with
`"GATE:"` (`IsGateTitle`, `.cs:5466`) in a shown milestone renders as a prominent card
above the tree: `#1F1A2E` fill, **MauveBrush** border, eyebrow `"GATE · BLOCKS RELEASE"`,
the title with the `GATE:` prefix stripped, and a right-aligned completion fraction from
its transitive sub-issue rollup, falling back to a `- [ ]`/`- [x]` checklist parse of the
body (`ParseChecklist`, `.cs:5473`). Sub-issue GATE issues are deliberately *not* shown as
peer cards (`.cs:5504-5513`, Git #2544). Click opens the gate's detail tab. Collapsed
entirely when there are no open gates in view.

### 2.5 Filters

**Five mutually-exclusive chips** (`.xaml:561-565`) drive `IssueFilter_Click` (`.cs:7108`),
each setting `_currentFilter`:

| Chip | Tag | Behaviour |
|---|---|---|
| All | `All` | Every open milestone/bucket/issue |
| 🔥 Priority | `Priority` | Only rows with `Priority == "HIGH"` (`.cs:5331` etc.) |
| 🎯 Milestones | `Milestones` | Milestone/bucket structure kept even when empty (`.cs:5411`) |
| ⚡ Epics | `Epics` | Bucket kept even when empty (`.cs:5405`) |
| 🟢 Done | `Done` | Fetches the **CLOSED** set on demand and shows it (`.cs:7113-7144`); leaving Done for any other chip reloads the OPEN board (`.cs:7149`) |

The per-filter row rules live in the render loops (`.cs:5329-5396`): non-`Done` filters
skip CLOSED rows; `Done` skips non-CLOSED; `Priority` skips non-HIGH.

**Hide Completed** (`BtnHideCompletedEpics`, `.xaml:572`) is a **separate independent
ON/OFF toggle**, not a sixth chip (`HideCompletedEpicsToggle_Click`, `.cs:7162`). It
composes with whichever chip is active and, when on, drops any top-level Epic (and its
subtree) whose real transitive leaf rollup is 100% closed (`SubIssueCompleted >=
SubIssueCount > 0`, `.cs:5339`), and any `Feature:`-titled node inside the hierarchy that
is likewise fully complete (`.cs:5768`). Its state is **persisted** to
`BuildConsoleSettings.HideCompletedEpics` and restored on construction (`.cs:711`,
`7169-7172`). Its checked look is a GreenBrush border + foreground applied in code
(`ApplyHideCompletedEpicsToggleVisual`, `.cs:7181`).

### 2.6 Row interactions

- **Click** a milestone → `MilestoneTabRequested`; an issue/epic → both `IssueSelected`
  (quick-glance side panel) and `GitDetailTabRequested` (detail tab); a search result or
  raw board issue → the same two events with a synthesized `GitIssue`
  (`IssuesTree_SelectedItemChanged`, `.cs:4646`).
- **Hover** (350ms show / 250ms hide debounce, `.cs:6383`) → `IssueHoverPopup`
  (`.xaml:663-683`), a state-aware card: status pill + title + snippet, **one** contextual
  primary action matching the issue's real build state (Queued→Dispatch, In progress→
  progress bar + Cancel/Stop, Done→Open build, Failed→Retry — `BuildQuickActionArea`,
  `.cs:6724`; dispatched through the `RequestDispatchBuild`/`…CancelOrStop`/`…Retry`/`…Reply`/
  `…OpenBuildChat` delegates MainWindow sets, `.cs:305-314`), plus the full **relationship
  picture** — what blocks it and what it blocks, both directions with real titles
  (`AddRelationshipList` / `LoadIssueRelationshipsAsync`, `.cs:6620`, Git #2081).
- **Right-click** an issue/epic → `ContextMenu` (`.cs:5995-6348`):
  - `✓ Mark Complete (Ready for Review)` / `Remove 'complete' label` — toggles the real
    `complete` GitHub label (`.cs:5998`).
  - `✕ Close Issue` / `↩ Reopen Issue` — real `SetIssueStateAsync`; closing plays a
    chomp/epic critter animation (`.cs:6020-6057`).
  - `✎ Edit…` — `EditIssueDialog` pre-filled from `RawTitle`/`Body`, saves via
    `UpdateIssueAsync` (`.cs:6063`).
  - `🔗 Assign to Epic…` — picker over in-memory epics; `AddSubIssueAsync` (`.cs:6094`).
  - `🚫 Set/Change Blocked By…` — picker; `SetBlockedByAsync`, plays a "Whammy" blocked
    critter (`.cs:6132`).
  - `🔓 Remove Blocker (Unblock)` — only when blocked; `RemoveBlockedAsync`, plays the
    Sparky unblock critter (`.cs:6168`).
  - Chat items (§3.4): `💬 Open Chat` / `➕ New Chat`, and `🔗 Assign Chat to Issue…`
    (`.cs:6207-6336`).
  - `🗄 Load <path> into SQL Runner` — only when the body references a
    `lib/db/migrations/manual/*.sql` path (`SqlPath`, derived by `DeriveSqlPath`
    `.cs:2690`; fires `SqlLoadRequested`, `.cs:6341`).
  - Milestone right-click menu (`.cs:5087-5299`): New Issue / New Epic in this milestone,
    Open/New Chat, Assign Chat to Milestone, New Epic & Assign Loose Issues, 🎉 Close
    Milestone (with a big-party critter).

### 2.7 Focus Mode & the active working epic

Focus Mode (`FocusModeService`) hard-filters the whole board to one milestone: only
milestones matching `IsMilestoneInFocus` are shown, and the stat chips scope to them
(`.cs:4988-5000`). A stale focus (its milestone now 100% complete / closed and gone from
the OPEN board) auto-releases so the board never blanks (`.cs:2154-2162`, Git #1977). The
control re-renders on `FocusModeService.StateChanged` (`.cs:722`, `736`).

The **active working epic** is set by MainWindow via `SetActiveEpicGithubNumber`
(`.cs:4740`), stored in `_activeEpicGithubNumber`. It drives: the green Working dot/title/
accent-bar treatment, ancestor auto-expand, the Active Working Epic bar, and
`LocateWorkingEpic`. `ActiveEpicGithubNumber` (`.cs:4749`) is read publicly by the
Local/Git Map picker (§4).

### 2.8 Critter animations & celebrations

Real, wired to live board deltas (`IssueChompAnimation`, invoked from
`PopulateGitTrackerBoardAsync`): issues closed remotely get "chomped" (`.cs:1997-2027`),
newly-created issues trigger the grumpy "Mo' Work" critter (`.cs:2044-2068`), and a
milestone reaching 100% triggers a parade (`.cs:2080-2095`). Manual close/blocked/unblock
actions play their own animations from the context-menu handlers (§2.6).

---

## 3. Chats view (`ChatsView`, `.xaml:84-177`)

The visible Chats UI is a **card host** (`ChatsHost`, a `StackPanel`, `.xaml:172`); the old
`ChatsTree` `TreeView` is kept hidden only so legacy focus/keyboard references resolve
(`.xaml:171`). Empty state `TxtNoChats` (`.xaml:173`).

### 3.1 Fixed top region

- **Pinned Questions** (`PinnedQuestionsSection`/`-Host`, `.xaml:93-99`) — one card per open
  `chat_pinned_questions` row, each with an inline reply field; sending posts the reply into
  the real originating chat and resolves the pin (`BuildPinnedQuestionCard`, `.cs:493`;
  loaded by `LoadPinnedQuestionsAsync`, `.cs:437`). Collapsed entirely when there are no
  open pins. Today pins are created only via the manual `📌 Pin a Question…` card menu
  (`.cs:3895`) or active detection (`CreatePinnedQuestionsFromDetectionAsync`, `.cs:464`).
- **Search box** (`ChatSearch`, `.xaml:113-134`) — overlay-placeholder "Search chats (title
  or epic)"; live filters via `ChatSearch_TextChanged` → `RenderChatsTree` (`.cs:4328`).
- **Refresh** (`BtnRefreshChats`, `.xaml:138`) — force fetch + repaint (§1.2).
- **Show Archived** (`ChatShowArchived`, `.xaml:153`) — a reversible soft-hide toggle: off
  (default) archived chats are hidden; on, **only** archived chats show (`.cs:3128`,
  `3179`).

### 3.2 Grouping & filtering (`RenderChatsTree`, `.cs:3093`)

Chats are grouped **by their linked epic**. Each chat resolves to an epic via
`GetEpicForChat` (`.cs:4554`): direct `EpicId` → `IssueGithubNumber` (or its parent) →
any `AssociatedIssueNumbers` (or their parents). Unresolved chats fall into an **"Unlinked"**
group pinned last (`.cs:3290`). Groups sort alphabetically (`.cs:3289`).

Resilience: `BackfillSyntheticEpicsFromBoard` (`.cs:2978`) adds any live-board epic missing
from the local `bt_epics` table into `_chatEpicById` under a **negative synthetic id** (read
only for grouping, never written back), so a chat linked to a not-yet-synced epic groups
correctly instead of stranding under Unlinked (Git #1362).

Filters, all composing: **account scope** (title-bar Primary/Secondary toggle,
`.cs:3177`), **archived** (`.cs:3179`), **closed-issue** (`AreAllLinkedIssuesClosed` —
a chat drops out once every GitHub number linked to it is confirmed closed on the real
board, `.cs:3078`, `3180-3186`, fail-open on missing data), and **Focus Mode**. When a
Focus milestone is active, the panel switches to **Milestone→Epic→Chat mode**
(`milestoneMode`, `.cs:3172`): it lists every open epic in that milestone — even zero-chat
ones, so each keeps a "New Chat" affordance — and hangs chats under them by resolved
`epic_id` (`.cs:3234-3267`, Git #2534).

### 3.3 Card layout

- **Summary strip** (`BuildChatsSummaryStrip`, `.cs:3490`) — top at-a-glance line: total
  chats, ⚡ in-progress (YellowBrush), ⏳ waiting-on-you (PeachBrush), and a count-only badge
  for the **other account's** in-progress work (Git #1480). Shown whenever there's anything
  to say (`.cs:3318`).
- **Epic section** (`BuildEpicSection`, `.cs:3358`) — a collapsible header card:
  chevron ▸/▾, an 8×9px **accent colour chip**, the epic title in that accent, a muted chat
  **count badge**, a green `"N open"` sub-issue pill (`.cs:3389-3404`), the `#N` number, an
  **epic progress bar** over real sub-issues (`EpicProgress`, `.cs:3542`) with `"n/m issues
  done"`, and status counters (⚡ in progress / ▶ running / ⏳ waiting / 🕒 last-active from
  `GroupBuildStats`, `.cs:3514`). Body holds the per-chat cards plus a `+ New Chat` /
  `+ Continue in a new chat` button that starts a chat pre-associated to that epic
  (`StartNewEpicChat`, `.cs:4498`). Collapsed by default; a search force-expands matching
  sections; expansion is remembered in `_expandedEpicKeys` (`.cs:3349`).
- **Epic colour** is a **stable per-title hash** into a 6-brush palette
  (`AreaBrushKey`, `.cs:949`: BlueBrush, MauveBrush, GreenBrush, PeachBrush, YellowBrush,
  RedBrush), so an epic keeps its colour session-to-session regardless of which others are
  present. **This is different from the Git Board buckets' three fixed hex colours (§2.2).**
- **Chat card** (`BuildChatCard`, `.cs:3583`):
  - A `MantleBrush` card with a 3px accent left bar (`.cs:3601`). Border/title/icon turn
    **YellowBrush when marked In Progress** (`.cs:3592`, `3616`, `3627`).
  - Row 1: optional ⚡ (in progress) and 🗄 (archived) icons, the title (or `(untitled
    chat)`), and a right-aligned relative time (`RelativeTime`, `.cs:3558`).
  - Row 2 (wrapping chips): **linked-issue pills** — `#N`, title, and a 🟢/🔴 open/closed
    dot resolved against the live board (`.cs:3652-3718`); **mention-only pills** — muted,
    for numbers auto-detected in the chat text but not deliberately linked (`.cs:3725-3752`,
    Git #2066); and **build-status badges** for every linked queue build with a coloured
    status pill — `DONE` renders as **VERIFY** (GreenBrush, meaning "landed, still needs
    verify/close"), plus FAILED/ERROR (RedBrush), BLOCKED (MauveBrush), RUNNING (BlueBrush),
    QUEUED (PeachBrush) (`.cs:3782-3841`).
  - **Click** the card → `ChatSelected` with the chat and its resolved GitHub number
    (`.cs:3849-3855`). Hover tints the card (`.cs:3856`).
- An **offline banner** (`#22FAB387`) is prepended when the board data is a stale cache
  (`.cs:3104-3120`).

### 3.4 Chat linking / assignment (both directions)

- From a **chat card** right-click (`.cs:3859-…`): `⚡ Mark as In Progress` toggle (routed
  through MainWindow's shared resolver, `.cs:3866`), `🪟 Open as Floating Window`
  (`.cs:3885`), `📌 Pin a Question…` (`.cs:3895`), `🔗 Link to Issue/Milestone…`
  (`AssignEpicDialog` over milestones + board issues, `.cs:3986`), and unlink options.
- From a **Git Board issue/epic** right-click (`.cs:6249`): `🔗 Assign Chat to Issue…` —
  `AssignChatToEpicDialog` (can pull the currently-active tab's URL via `GetActiveChatUrl`,
  `.cs:302`), extracts the conversation UUID with a `/chat/<uuid>` regex (`.cs:6263`), and
  persists via `_db.LinkChatToIssueAsync(conversationId, issueNumber, …, resolveLive:
  ResolveLiveBoardIssue)` or the `_api` fallback (`.cs:6276-6293`). Milestone assignment
  uses the same flow but deliberately **without** `resolveLive` (milestone numbers are a
  different namespace, `.cs:5161-5169`).
- `FindChatForIssue(githubNumber)` (`.cs:4613`) is the reverse lookup that decides whether a
  Git Board / milestone node offers "Open Chat" vs "New Chat".
- `New Chat` builds a project URL with a `?bt_prefill=` param (`EpicChatUrlBuilder`) and
  raises `EpicChatRequested` (`.cs:234`) so MainWindow's WebView2 tab replicates the browser
  extension's composer-insert (the extension isn't installed in BuildConsole's WebView2).

---

## 4. The Local / Git Map picker

**Honest scope note:** this picker is **not a control inside `LeftSidebar`**. It lives in
`MainWindow` and is triggered by the **ActivityBar's chain-map icon**
(`ActivityBar.BuildChainMapRequested` → `MainWindow.OpenBuildChainMap`,
`MainWindow.xaml.cs:1226`, `1876`). It is included here because it **consumes the sidebar's
active-epic state** and the issue names it in this surface's scope.

`OpenBuildChainMap` (`MainWindow.xaml.cs:1876-1896`): if either map window is already open it
just re-activates it; otherwise it shows `PromptForMapChoice` (`:1936`) — a small ad-hoc
modal (`"Build Map — which view?"`) with two buttons, **Git Map** (default) and **Local
Map**, plus Cancel.

- **Git Map** → `OpenGitMap` (`:1901`) — opens the maximized `BuildChainMapWindow` scoped to
  an epic. The epic defaults to **`LeftSidebar.ActiveEpicGithubNumber`** (`:1903`) — the
  active working epic from §2.7 — falling back to a prompt when none is set. This is the
  Epic→Feature→Issue→`blocked_by` chain editor (Git #2483).
- **Local Map** → `OpenLocalMap` (`:1919`) — opens `LocalMapWindow`, the live Postgres
  schema-graph canvas (Git #2806); not epic-scoped, so no prompt.

Both are single-instance (open-or-activate) and log open/close to `ActivityLog`.

---

## 5. Real data shapes

`GitIssue` (`.cs:64-110`) — `IssueNumber`, `Title`/`RawTitle`, `Priority`
(HIGH/MED/other → 🔥/🟡/🟢), `Status` (OPEN/CLOSED), `IsEpic`, `IsBlocked` +
`BlockedByNumber`/`BlockedByTitle`, `IsInFlight`, `HasInFlightDescendant`, `IsComplete`,
`HasParentEpic`/`ParentNumber`, `SubIssueCount`/`SubIssueCompleted`/`SubIssuePercent`
(→ `SubIssueProgressStr` "NN% (n/n)"), `SqlPath`, `Labels`, `DatabaseId`.

`GitMilestone` (`.cs:34-53`) — `Title`, `CompletedCount`/`TotalCount` (→ `ProgressStr`
"NN% (n/n)"), `HasRealCounts`, `GithubNumber`, `OpenIssues`/`ClosedIssues`, `State`/
`IsClosed`, `Epics`, `HasInFlightDescendant`.

`GitEpic` (`.cs:55-62`) — `Title`, `ColorHex` (bucket accent), `Issues`,
`HasInFlightDescendant`.

`BoardChat` / `BoardEpic` / `BoardResponse` (Services layer) — chats carry
`ConversationId`, `Title`, `ClaudeUrl`, `EpicId`, `IssueGithubNumber`,
`AssociatedIssueNumbers`, `MentionedIssueNumbers`, `Archived`/`ArchivedAt`, `Account`,
`UpdatedAt`, `Id`.

`QueueItem` (build) statuses observed in rendering: `queued`, `running`, `done`, `failed`/
`error`, `blocked` (`.cs:3782-3810`, `3518-3519`).

---

## 6. Events raised to MainWindow (the real integration contract)

Declared at `.cs:206-296`, `302-314`:
`GraphApiSelected`, `FileSelected`, `ChatSelected (chat, githubNumber?)`,
`EpicChatRequested (url,title,injectPrefill,issueNumber?,issueType,defaultTitle)`,
`IssueSelected (GitIssue)`, `MilestoneTabRequested (GitMilestone)`,
`GitDetailTabRequested (GitIssue)`, `SqlLoadRequested (path)`,
`ChatEpicAssigned` (declared, **never raised yet** — Git #1706, `.cs:256-258`),
`VerifyingIssuesPromoted`, `BoardRefreshCompleted`,
`GitBoardOpenIssuesRefreshed (HashSet<int>)`, `PinToggled (bool)`,
`SettingsCategoryRequested (string)`, `SyncError (string?)`, `WorkspaceChanged`.
Delegates set by MainWindow: `GetActiveChatUrl`, `GetQueueItems`, and the five
`Request*Build` quick-action delegates.

---

## 7. Known-thin / honest gaps (for Design, not to fabricate around)

- The status-dot **legend** (`.xaml:609-628`) and `CreateStatusDot` have **no shared source
  of truth** — they are hand-synced (`.cs:4876`). A redesign should treat the dot semantics
  in §2.1/§2.3 as canonical, not the legend markup.
- "Waiting for input" is deliberately **not** a Git Board dot — that indicator exists only
  on Build Queue cards, keyed to a live build session, with no wiring to a `GitIssue`
  (`.xaml:598-608`).
- `ChatEpicAssigned` is declared but never fired (Git #1706); an open-chat tab's epic
  snapshot only refreshes on tab re-selection.
- Blocked state is **best-effort and can lag up to 3 minutes** (the enrich throttle,
  `.cs:2287`); it is reseeded from cache between sweeps but is never guaranteed live at any
  instant.
- Milestone counts and transitive rollups depend on the ALL-states fetch succeeding; when
  it fails they fall back to GitHub's raw native counts, which are placeholder-inflated
  (`.cs:2682-2688`).

---

*Extraction pack authored against real code at the commit recorded in
`build-journal/3014.md`. Nothing above is invented; every claim is cited to `file:line` in
`desktop/BuildConsole/Controls/LeftSidebar.xaml(.cs)` or `MainWindow.xaml.cs`.*
