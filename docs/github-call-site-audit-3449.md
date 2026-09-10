# GitHub call-site audit — BuildConsole (issue #3449)

**Date:** 2026-09-10 · **Scope:** `desktop/BuildConsole/` (the WPF app) · **Audited-against commit:** `c31290ce4`

This is the comprehensive, systematic inventory #3449 asked for: every real call site in the
codebase that constructs a `GitHubApiClient` or spawns the `gh` CLI, classified by whether it is
already mirror-backed (safe), by-design live (safe), rare/manual-only (safe per #3449's own risk
definition), or a **real remaining live/bursty gap**. Every row cites `file:line` so another
person can confirm its state by reading the same code.

## How to read this / method

BuildConsole hits GitHub two ways, **both** gated on the one shared #2815 rate-limit circuit
breaker (`Services/GitHubRateLimitCircuit.cs` + `Services/GitHubRateLimitHandler.cs`):
1. **HTTP+PAT** via `new GitHubApiClient(pat)` — its `HttpClient` (constructed fresh per client,
   `GitHubApiClient.cs:299`) installs `GitHubRateLimitHandler`.
2. **`gh` CLI** via `SubprocessRunner.RunAsync("gh", …)` (`SubprocessRunner.cs:194-198`).

The circuit is **reactive** — it only OPENS *after* a rate-limit response, so a burst still trips
it; while open, every live-dependent surface fails visibly (the synthetic 403 → generic error).

**Key finding about the failure mode:** at the moment of a live hit, GitHub's *primary* REST budget
reads `core: 5000/5000, used 0` (`gh api rate_limit`, 2026-09-10). The trips are therefore
GitHub **secondary (burst/concurrency) rate limits**, not primary exhaustion. That is exactly why
an inventory of *bursty* call sites — not "use less of the 5000/hr" — is the right lever. Note also
that a `304 Not Modified` (the ETag path in `GitHubApiClient.GetConditionalAsync`, `:382-418`) is
free of the *primary* limit but is still a real request against the *secondary* budget and still
routes through the circuit.

**Construction count is not the risk.** ~35 `new GitHubApiClient(…)` sites exist, but they share
one static circuit/ETag cache; the risk is **call frequency/burst**, weighted by whether the call
fires automatically (startup/timer/refresh = high) vs on rare explicit user action (= low), and
whether a local `bt_issue_mirror` read (via `GitHubIssueMirror`) could serve it instead.

**The mirror** (`Services/GitHubIssueMirror.cs`, table `bt_issue_mirror`, migration
`lib/db/migrations/manual/2026-09-07-bt-issue-mirror-3113.sql` + #3358 extension) is the
established fix pattern (#3113). Read methods that mean "mirror-backed = safe": `TryGetAsync`,
`GetManyAsync`, `TryGetTitleAsync`, `TryGetByBoardStatusAsync`, `TryGetBoardIssuesAsync`,
`TryGetMilestoneInfosAsync`, `HasUsableDataAsync`, `HasClosedBackfillAsync`. The sync itself
(`MaybeSyncAsync`/`SyncAsync`, driven once per interval from `QueueWatcherService.TickAsync`) is
the one intended batched live read.

**Non-BuildConsole sweep:** the only `gh`/GitHub usage outside `desktop/BuildConsole/` is
`scripts/config-state/fetch-sources.mjs:100,110` — it hits a **different repo**
(`microsoft365dsc`), **unauthenticated** (separate 60/hr budget), on a manual extraction run. It
cannot contribute to this app's authenticated circuit. Cleared. `GitHubApiClient` is a
BuildConsole-only class (`namespace BuildConsole.Services`), so the entire remaining surface is in
`desktop/BuildConsole/`.

---

## TIER 1 — Real remaining gap, HIGH (automatic on startup/refresh, live per-issue burst, mirror-serviceable)

### G1 — LeftSidebar blocked-by/blocking sweep still fires ~528 live per-issue calls on every board load → filed **#3467**
- `Controls/LeftSidebar.xaml.cs:2410` — `EnrichBlockedStatusCoreAsync` calls `client.GetOpenBlockedByAsync(issue.IssueNumber)` **once per open issue** (~528 at current scale; ~257 measured), concurrency-6.
- **Trigger:** fired at the tail of every `PopulateGitTrackerBoardAsync` board load — `EnrichBlockedStatusAsync` at `:2246`. That runs on **startup** (`Initialize`, `:669`), Issues-tab open (`SwitchView`, `:1753`), manual Refresh (`BtnRefreshGitBoard_Click`, `:346`), and every post-write board reload. (No poll timer — the 20s `_pollTimer` at `:678` hits only the local dev server.)
- **Mirror status:** straight LIVE, never migrated. `bt_issue_mirror` already carries `blocked_by_numbers` + `blocking_numbers` + each issue's `state`; `ChatDockService` already resolves the blocked chain from that graph (`ChatDockService.cs:259-312`).
- **Guards present but reactive:** 3-min throttle (`_lastBlockedEnrichUtc`, `:2358`), skip-when-circuit-open (`:2372`, does not advance throttle), and a `StartupGitHubCoordinator` slot (`:2389`). These stagger/limit but do not remove the burst; the code's own comments (#876 `:2310`, #3022 `:2381`) call it "the single biggest GitHub load on a cold start."
- **Companion (same root, same fix):** `Controls/LeftSidebar.xaml.cs:6636` — `LoadIssueRelationshipsAsync` (issue-row **hover**, `MouseEnter :6015` → hover timer `:6436`) fires `GetBlockedByAsync` + `GetBlockingAsync` live per hovered issue; bursts on hover-scan. Also mirror-serviceable.
- **Scope note (honest):** the mirror sync fetches `blocked_by` **only for `blocked`-labeled issues** (`GitHubIssueMirror.cs:113-116`). That matches this project's convention (the `blocked` label is always set alongside a `blocked_by` edge — CLAUDE.md's blocked-label protocol), so the mirror graph *can* serve the sweep; the migration must rely on that convention (an unlabeled issue is treated as unblocked) or widen what the sync captures.

---

## TIER 2 — Real remaining gap, MEDIUM (automatic, live, mirror-serviceable, but small/batched/conditional)

### G2 — Home/editor-panes active-milestone resolution fires a live `GetMilestonesAsync` on a 1-min unconditional timer; never mirror-migrated + two stale comments → filed **#3468**
- `Services/GitHubIssueTimeSeriesService.cs:472` — `ResolveActiveMilestoneAsync` calls `client.GetMilestonesAsync()` **live on every call — no mirror, no service TTL/cache** (unlike its sibling `GetAllIssuesAsync`, which #3359 migrated to the mirror at `:211-224`).
- **Trigger (automatic):** `_editorPanesStatsTimer` — a **1-min, unconditional** `DispatcherTimer` (`MainWindow.xaml.cs:1104-1106`) → `RefreshEditorPanesStatsAsync` (`:4123`, only an in-flight guard, **no visibility gate**) → `EditorPanesStatsService.GetActiveMilestoneStatsAsync` (`:42`) → `ResolveActiveMilestoneAsync`. Also on the Home 10s rollup's burndown path (`HomeView.xaml.cs:200,1187`) and `HomeEtaProjectionService.cs:76`.
- **Distinct from #3359:** #3359 (open) is scoped to the `ListBoardIssuesAsync(All)` issue-set fetch, which *is* migrated. This milestone-count path is a separate live call #3359's fix left untouched. Mirror-serviceable via `GitHubIssueMirror.TryGetMilestoneInfosAsync` (the #3358 read).
- **Two stale comments (findings in themselves):** `MainWindow.xaml.cs:1100-1102` and `EditorPanesStatsService.cs:32-38` both claim `ResolveActiveMilestoneAsync` is "5-minute-TTL cached" / "never issues its own extra GitHub call." The code (`:465-491`) has no cache — it constructs a client and calls `GetMilestonesAsync()` every call.
- **Severity note:** `GetMilestonesAsync` is an ETag conditional GET, so an unchanged read is a cheap 304 (primary-free) — but still a real per-minute request against the secondary budget, and it fully fails (throws → strip hidden) whenever the circuit is open.

### G3 — Batter Up / AI Batter Up auto-refresh on every mirror sync does live batched GitHub work regardless of panel visibility → filed **#3469**
- `Controls/AiBatterUpPanel.xaml.cs:91` / `Controls/BatterUpPanel.xaml.cs:104` — `GitHubIssueMirror.SyncCompleted += OnMirrorSyncCompleted` is subscribed in the **constructor and never removed** (app-lifetime singletons, #3335), so `RefreshAsync()` runs on **every** mirror `SyncCompleted` (every 5-30 min) even when the tab is never opened.
- `RefreshAsync` is mirror-first for the board list (`AiBatterUpQueueService.cs:104`, `BatterUpQueueService.cs:489`) but still makes **live** calls each pass: batched BUILD-comment resolution `BatterUpQueueService.ResolveBuildCommentsAsync` → `BatchGetRecentIssueCommentsAsync` (`AiBatterUpQueueService.cs:64` → `BatterUpQueueService.cs:246`), a closed-sweep `BatchGetProjectItemStatusesAsync` (`BatterUpQueueService.cs:605`), and the end-of-render auto-select → `IssueDetailView.LoadIssue` → `GetIssueAsync` + `GetIssueCommentsAsync` (`AiBatterUpPanel.xaml.cs:279/297`, `BatterUpPanel.xaml.cs:231/570`, `IssueDetailView.xaml.cs:73-75`).
- **Stale comment (finding):** `AiBatterUpPanel.xaml.cs:94-97` claims the sync-driven refresh makes "no new GitHub calls." It makes the batched calls above.
- **Severity note:** already batched + circuit-aware (`BatterUpQueueService.cs:236,580` — the #3347/#3350 de-burst), so this is **not** a burst driver; the real gap is automatic live traffic (and 2× unbatched issue+comments per sync via auto-select) running regardless of whether anyone is looking at the panel. A visibility gate or fuller mirror-service would remove it.

---

## TIER 3 — Manual/user-action only (rare = "safe" per #3449's own risk rule); documented, not filed

These make live reads a mirror could serve, but only on an explicit, infrequent user action — so
they are low-risk and left as future-migration candidates, not filed as gaps. The single biggest
manual burst (BuildChainMap) is called out so Shane can decide.

| file:line | Method / trigger | Live call(s) | Note |
|---|---|---|---|
| `BuildChainMapWindow.xaml.cs:170,192` | `RefreshAsync` on window **open** (`Loaded :90`) / Reset | `BuildChainMapService.BuildAsync` → `GetIssueAsync`, `GetSubIssuesAsync`, per-issue `GetIssueBoardStatusAsync`+`GetIssueCommentsAsync`+`GetBlockedByAsync` (`Services/BuildMap/BuildChainMapService.cs:65,76,108,127-128,194`), bounded `SemaphoreSlim(8)` | **Largest manual burst** — several hundred live calls per open of the map window. Manual-only, but can trip the circuit; strongest candidate to migrate/gate next. |
| `Controls/LeftSidebar.xaml.cs:7172` | "🟢 Done" filter chip click | `ListBoardIssuesAsync(Closed)` + `GetMilestonesAsync` | Heavy live CLOSED walk on one click; mirror has closed backfill (`HasClosedBackfillAsync`/`TryGetBoardIssuesAsync(openOnly:false)`). |
| `Controls/GitDetailView.cs:287,313,596-601` | `LoadEpic`/`LoadIssue` — detail-tab open + `RefreshOpenGitDetailTabs` on **manual** board refresh (`MainWindow.GitDetailTabs.cs:291` ← `MainWindow.xaml.cs:840`) | `GetSubIssuesAsync`, `GetOpenBlockedByAsync`, `GetIssueCommentsAsync`, `GetIssueBoardStatusAsync` | Re-fires per open detail tab on each manual refresh; sub-issues/blockers/board-status mirror-serviceable (comments genuinely live). |
| `Controls/BuildQueuePanel.xaml.cs:5416,5494` | Issue-title warm-up — initial load + manual refresh only (skipped on 5s timer, `:999`) | per-number `gh issue view` | Deduped/cooldown/give-up (#2890/#2817). Mirror `TryGetTitleAsync` exists but this path still uses `gh`. |
| `Controls/BuildQueuePanel.xaml.cs:693` | `SetActiveChatEpic` — chat/tab switch | `GetSubIssuesAsync(bypassCache:true)` | Single epic, user-initiated. |
| `Controls/FocusImmersiveView.xaml.cs:339` | `DrillIntoEpic` — click epic node | `GetSubIssuesAsync` | Single epic, manual. |
| `MainWindow.GitDetailTabs.cs:112` | `OpenGitDetailByNumberAsync` — mention/tab nav | `GetIssueAsync`+`GetSubIssuesAsync` | Cache-first (`:96-101`); live only on miss. |
| `Services/ChatMentionPopupHelper.cs:53` | `#NNN` mention hover | `GetIssueAsync` | Cache-first; single issue on miss. |
| `TestPad/TestPadImportWindow.xaml.cs:98` | Import window open | `SearchIssuesAsync` | One-shot per dialog open, reused. |
| `StaleStateReconcileWindow.cs:65,223,343` | Manual reconcile window open/refresh/migrate | `GetIssueBoardStatusAsync`, `SetIssueStatusByNumberAsync` | Per-row live only when Shane opens it. |
| `Controls/GitDetailView.cs:516`, `Controls/IssueDetailView.xaml.cs:218`, `Controls/LeftSidebar.xaml.cs:2275,5280,5322,6083,6117,6154,6192,6220`, `Services/BuildMap/ChainPersistence.cs:191,196,203,264,310` | Context-menu / dialog **writes** on explicit click | `CreateIssueAsync`, `AddSubIssueAsync`, `SetIssueStateAsync`, `UpdateIssueAsync`, `SetBlockedByAsync`, `RemoveBlockedAsync`, `SetProjectItemStatusAsync`, `AddIssueCommentAsync`, `CloseMilestoneAsync`, `ReprioritizeSubIssueAsync`, `SetIssueStatusByNumberAsync` | Low-volume writes, user-initiated. |

---

## TIER 4 — Deliberately LIVE by design (must not be mirror-backed; safe)

| file:line | What | Why live is correct |
|---|---|---|
| `Services/QueueWatcherService.cs:1940` → `GitHubIssuesService.cs:141` | dispatch/blocker gate `gh issue list --state open` | The fail-closed #1600 blocker gate — a stale read is genuinely unsafe (#3113 explicitly says STAY LIVE). One light call/tick, and only when the forwarded Git-Board snapshot is >60s stale (`:447`). |
| `Services/QueueWatcherService.cs:504` (`MaybeSelfRecoveryProbeAsync`) | `gh issue list` recovery probe | No-ops unless `GitHubRateLimitCircuit.IsTripped` (`:501`); one half-open probe per window (#3011). |
| `Services/QueueWatcherService.cs:2468` (`TrackDispatchAsync`) | `gh api graphql` re-dispatch check | One targeted query per genuinely-fresh build launch. |
| `Services/BoardStatusSync.cs:58` (`Mirror`) | `SetIssueStatusByNumberAsync` write | Board Status move on completion/orphan; low-volume write, staggered via coordinator. |
| `Services/BuildQueuePostgresClient.cs:1294` (scoped) | `GetIssueBoardStatusAsync` | Manual Build Chain Map "just-moved" scoped reconcile (#3113 STAY-LIVE scoped path). |
| `Services/GitHubIssueVerifier.cs:50`, `Services/ScreenshotReviewService.cs:257`, `Services/FalseDoneReconciler.cs` (via `MainWindow.xaml.cs:955`), `Services/IssueDispatchService.cs:60` | single-issue verify / close write / false-done write / dispatch reads | Manual or event-driven, single/low-volume. `IssueDispatchService` via `DispatchPanel.RecheckPendingBuildCommentsAsync` (`MainWindow.xaml.cs:938`) rides the board-refresh cascade but iterates only the usually-empty `_pendingBuildCommentRetries` set — latent, kept in view. |

---

## TIER 5 — Already mirror-backed / batched (safe; the prior night's fixes, confirmed still in place)

| Surface | file:line | Fix |
|---|---|---|
| Git Board tree | `Controls/LeftSidebar.xaml.cs:1928,1951` (`TryGetBoardIssuesAsync`/`TryGetMilestoneInfosAsync`) | #3358 |
| Home issue time-series (issue set) | `Services/GitHubIssueTimeSeriesService.cs:211-224` (`TryGetBoardIssuesAsync(openOnly:false)`) | #3359 (issue-set path only — see G2) |
| Batter Up / AI Batter Up board lists | `BatterUpQueueService.cs:489`, `AiBatterUpQueueService.cs:104` (`TryGetByBoardStatusAsync`) | #3134 |
| Chat dock enrichment + blocked chain | `Services/ChatDockService.cs:169,205,312` | #3113 |
| Issue titles | `Services/GitHubIssuesService.cs:244` (`TryGetTitleAsync`) | #3113 |
| Queue Verifying reconcile | `Services/BuildQueuePostgresClient.cs:1278` (`TryGetAsync`) | #3113 |
| The one batched sync | `Services/QueueWatcherService.cs:998-1000` → `GitHubIssueMirror.MaybeSyncAsync` | #3113/#3337 (incremental) |

No GitHub call sites at all: `GitDoctorView.xaml.cs` (git CLI only), `AssignIssueEpicDialog`,
`EditIssueDialog`, `SetBlockedByDialog` (pure value dialogs), `Services/TestPad/TestPadFeatureMatcher.cs`.

---

## Bottom line

The prior night's reactive fixes closed the big automatic drivers (Git Board tree, Home issue-set,
Batter Up/AI Batter Up board reads, titles, chat dock, closed-sweep batching, the cold-start
stagger). **Three real automatic live gaps remain**, filed as siblings of #1789:

- **G1 / #3467 (HIGH)** — LeftSidebar blocked-by sweep: ~528 live per-issue calls on every board load, never mirror-migrated.
- **G2 / #3468 (MEDIUM)** — active-milestone resolution: live `GetMilestonesAsync` on a 1-min unconditional timer, never mirror-migrated (+ two stale "TTL-cached" comments).
- **G3 / #3469 (MEDIUM)** — Batter Up / AI Batter Up: live batched enrichment on every mirror sync regardless of visibility (+ a stale "no new GitHub calls" comment).

Everything else is mirror-backed, a low-volume write, deliberately-live by design, or rare
manual-only. The largest un-filed item is the **manual-only** BuildChainMap burst (Tier 3) — a
future-migration candidate, not an automatic gap.
