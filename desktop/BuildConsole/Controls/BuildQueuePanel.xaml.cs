using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using Ellipse = System.Windows.Shapes.Ellipse;
using Polygon = System.Windows.Shapes.Polygon;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public class TaskSelectedEventArgs : EventArgs
    {
        public int QueueItemId { get; set; }
        public string Epic { get; set; } = string.Empty;
        public string Task { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string StatusDetails { get; set; } = string.Empty;
        public int? ExitCode { get; set; }

        /// <summary>Git #2689 — true when the selection should also force the bottom log panel
        /// open (explicit right-click "Open Build Log"). False for a plain card click, which
        /// should only select/highlight without popping the panel open.</summary>
        public bool OpenLogPanel { get; set; } = false;
    }

    /// <summary>Git #1636 — every item of a Priority build set has just reached a terminal state
    /// for the first time. Carries the build-set name and the full member list (so the subscriber
    /// can resolve "that build set's chat" itself) for the completion toast.</summary>
    public sealed class BuildSetPriorityCompletedEventArgs : EventArgs
    {
        public string BuildSetName { get; }
        public IReadOnlyList<QueueItem> Items { get; }

        public BuildSetPriorityCompletedEventArgs(string buildSetName, IReadOnlyList<QueueItem> items)
        {
            BuildSetName = buildSetName;
            Items = items;
        }
    }

    /// <summary>Git #1893 — the rollup's per-build-set send button was clicked. Carries the
    /// already-formatted "Git #NNNN — landed" list text for that set's real, current Verifying
    /// items, plus a callback to report the send outcome back on that specific row's own status
    /// text. A callback (rather than a persistent named XAML element like SqlDocumentView's
    /// ExecStatus) because rollup rows are rebuilt from scratch on every RenderBuildSetRollup
    /// call (see BuildRollupRow) rather than being long-lived controls.</summary>
    public sealed class SendBuildSetVerifyingEventArgs : EventArgs
    {
        public string BuildSetName { get; }
        public string Text { get; }
        public Action<string, bool> ShowStatus { get; }

        public SendBuildSetVerifyingEventArgs(string buildSetName, string text, Action<string, bool> showStatus)
        {
            BuildSetName = buildSetName;
            Text = text;
            ShowStatus = showStatus;
        }
    }

    /// <summary>
    /// Build Queue panel — visual DAG redesign (#860 reference):
    /// Reads live queue state (GET /extension/queue) and renders a real Canvas-based
    /// connector-line DAG graph. When builds are blocked by others (e.g. Build 6 blocked by
    /// 1, 2, 3, 4), real parent-child visual connector lines and Bézier curves show
    /// exact dependency relationships at a glance across running, up-next, blocked, and done builds.
    /// Preserves Issues in Epic, In-Flight, Sessions, and the Critter Lounge system.
    /// </summary>
    public partial class BuildQueuePanel : UserControl
    {
        public event EventHandler<TaskSelectedEventArgs>? TaskSelected;
        public event EventHandler<bool>? PinToggled;
        /// <summary>Git #3805 — fires whenever the "Build Sets" slide-out is opened/closed, mirroring
        /// PinToggled's own "child control affecting its own parent's outer layout" idiom immediately
        /// above. This panel is docked inside MainWindow's ColQueue, a real fixed-width outer column
        /// (unlike FloatingChatWindow's free-floating DockColumn, which #3785 originally mirrored) —
        /// so re-partitioning BuildSetsColumn internally can only ever squeeze the Queue's own existing
        /// 300px, never actually grow the panel. MainWindow subscribes to this and grows/shrinks
        /// ColQueue.Width by <see cref="BuildSetsPanelWidth"/> in response.</summary>
        public event EventHandler<bool>? BuildSetsPanelToggled;
        /// <summary>Git #815 — mirrors LeftSidebar's SyncError: null on a successful poll, a message on a failed one.</summary>
        public event EventHandler<string?>? SyncError;
        /// <summary>Git #1989 — fires on every RefreshAsync with the current count of rows at
        /// AccountCapPolicy.CappedStatus, so MainWindow's title-bar Drain button count stays live
        /// without a second DB poll — same "own panel refresh feeds a title-bar badge" idiom
        /// BatterUpPanel/AiBatterUpPanel's CountChanged already established (Git #1872).</summary>
        public event EventHandler<int>? CappedCountChanged;
        /// <summary>Git #3864 — fires every time <see cref="UpdateQueueStatusCounts"/> recomputes
        /// the real queue counts, carrying the exact same rendered text/foreground/tooltip this
        /// panel's own <see cref="QueueStatusCountsText"/> just got, so MainWindow can mirror the
        /// identical string into the global status bar without a second computation.</summary>
        public event EventHandler<QueueStatusCountsDisplay>? QueueStatusCountsChanged;
        /// <summary>Git #851 — Opens the chat associated to an in-flight issue.</summary>
        public event EventHandler<int>? IssueChatRequested;
        /// <summary>Opens or focuses the Claude chat that created this Build Queue item.</summary>
        public event EventHandler<QueueItem>? QueueItemChatRequested;
        public event EventHandler<int>? EpicSubIssueClicked;
        /// <summary>Git #2801 — the Epic-name chip (<see cref="BuildEpicChipRow"/>) was clicked;
        /// carries the real resolved <see cref="Services.BoardEpic"/> so MainWindow can activate
        /// that Epic's already-open chat tab, or reopen the last remembered one, per its own
        /// established resolution/reuse logic — this panel has no chat-tab state of its own.</summary>
        public event EventHandler<Services.BoardEpic>? EpicChipClicked;
        /// <summary>Git #1994 — "Open Git #N" card context-menu item: reuses MainWindow's
        /// existing OpenGitDetailByNumberAsync (focus-or-fetch, no second issue-opening path).
        /// Tuple carries the real GitHub number plus whether to open it side-by-side.</summary>
        public event EventHandler<(int Number, bool SideBySide)>? OpenGitIssueRequested;
        /// <summary>Git #3767 — real, partial reversal of #3702/#2976: that single
        /// <c>FullGitRefreshRequested</c> delegate bundled Board + Batter Up + AI Batter Up behind
        /// one combined button, which is exactly the six-subsystem fan-out this issue splits back
        /// apart. <see cref="BoardRefreshRequested"/> is the cheap half — Board diff sync plus the
        /// purely local cascade (chats tree, git status, manifests, dashboard, open detail tabs)
        /// that consumes it — awaited by <see cref="BtnRefreshBoard_Click"/>. It deliberately does
        /// NOT touch Batter Up or AI Batter Up. Single subscriber (MainWindow); assigned with
        /// <c>=</c>, not <c>+=</c>, so the awaited task is the real cascade's, not a multicast's
        /// last return.</summary>
        public Func<System.Threading.Tasks.Task>? BoardRefreshRequested;
        /// <summary>Git #3767 — the other half of the same reversal: a narrow, real
        /// Batter-Up-ONLY refresh, awaited by <see cref="BtnRefreshBatterUp_Click"/>. Deliberately
        /// excludes AI Batter Up, Board, Issues in Epic, In-Flight, and Focus Progress — this is
        /// the cheap, targeted call the automatic queue-claim loop needs to get a fresh Batter Up
        /// read without paying for (or rate-limit-tripping on) the other five subsystems. Single
        /// subscriber (MainWindow); assigned with <c>=</c>, same reasoning as
        /// <see cref="BoardRefreshRequested"/>.</summary>
        public Func<System.Threading.Tasks.Task>? BatterUpOnlyRefreshRequested;
        /// <summary>Git #1636 — fires exactly once, the moment every build in a Priority-marked
        /// build set reaches a terminal state. See <see cref="CheckPriorityBuildSetCompletion"/>.</summary>
        public event EventHandler<BuildSetPriorityCompletedEventArgs>? BuildSetPriorityCompleted;
        /// <summary>Git #1893 — fires when a rollup row's send button is clicked; MainWindow wires
        /// this to the shared SendTextToActiveClaudeChatAsync path (#937), same pattern as
        /// WireSqlRunnerSendToChat (#940).</summary>
        public event EventHandler<SendBuildSetVerifyingEventArgs>? SendBuildSetVerifyingRequested;
        /// <summary>Git #2691 — fires at the end of every successful <see cref="RefreshAsync"/>.
        /// MainWindow/FloatingChatWindow subscribe to re-push mention-span colors for every
        /// currently-tracked #NNN so live queue-state changes (queued → running → verifying)
        /// recolor on-screen mentions even with no chat text mutation to trigger the DOM-mutation
        /// scan.
        ///
        /// The parenthetical that used to sit here — "#2900 — RefreshAsync no longer ticks on its
        /// own; this now fires only on a manual refresh click or the one-time initial load" — went
        /// stale the moment #3074 brought back the 5-second local-only poll timer. It fires on
        /// every one of those ticks too. Git #3801 — and it still does, including on a tick whose
        /// cheap change probe found nothing changed and skipped the fetch/render: that early return
        /// deliberately raises this event anyway, so this contract is exactly what it was before
        /// the probe existed.</summary>
        public event EventHandler? QueueRefreshed;

        /// <summary>Git #3448, narrowed by #3767 — the real, honest Batter Up closed-sweep summary
        /// from the most recent Batter-Up-ONLY refresh, set by MainWindow's
        /// BatterUpOnlyRefreshRequested handler right after it awaits that panel's own refresh.
        /// <see cref="BtnRefreshBatterUp_Click"/> uses this for its completion toast instead of a
        /// generic "Refreshed!" message — AI Batter Up is deliberately excluded, this button never
        /// touches it — null only when BatterUpOnlyRefreshRequested has no subscriber yet (falls
        /// back to the old static text).</summary>
        public string? LastGitSyncSummary { get; set; }

        /// <summary>
        /// Git #2795 — wired once by MainWindow to <c>LeftSidebar.GetEpicForIssueNumber</c> (the
        /// generalized form of GetEpicForChat's own real ancestor-walk resolution). BuildQueuePanel
        /// has no direct issue/epic tree of its own — this is the same "MainWindow owns both panels,
        /// pushes real resolved state into this one" idiom <see cref="ApplyOpenIssueSet"/> already
        /// established for the live open-issue set (Git #1862), except on-demand per card render
        /// rather than a synced snapshot, so it always reads LeftSidebar's current live board state.
        /// Null until MainWindow wires it (cold start) — cards render with no Epic chip, never a
        /// fake one.
        /// </summary>
        public Func<int, Services.BoardEpic?>? ResolveEpicForIssue { get; set; }

        private bool _isPinned = true;

        // Git #3785 — new "Build Sets" slide-out panel to the LEFT of this whole control
        // (BuildSetsColumn/BuildSetsPanelBorder in the XAML). Same GridLength(0)<->fixed-
        // width column toggle FloatingChatWindow's DockColumn/BtnToggleDock (Git #2195)
        // already established for a slide-out side panel, mirrored to open on the left
        // instead of the right. Open/closed state is real, persisted app state
        // (BuildConsoleSettings.BuildSetsPanelOpen), not re-derived each launch.
        private bool _buildSetsPanelOpen;
        /// <summary>Git #3805 — public so MainWindow can grow/shrink ColQueue.Width by exactly this
        /// much when <see cref="BuildSetsPanelToggled"/> fires, instead of duplicating the magic
        /// number.</summary>
        public const double BuildSetsPanelWidth = 240;
        /// <summary>Git #3805 — real current open/closed state, read once by MainWindow right after
        /// subscribing to <see cref="BuildSetsPanelToggled"/> so a restart with the panel left open
        /// (restored from BuildConsoleSettings in the constructor, before MainWindow's own
        /// constructor body — and therefore its event subscription — has run) still widens ColQueue
        /// immediately instead of starting narrow and popping wide on the first toggle.</summary>
        public bool BuildSetsPanelOpen => _buildSetsPanelOpen;

        // Git #3701 — right-pointing while expanded (panel is on the right side of the
        // window, so collapsing it pushes it off to the right); left-pointing while
        // collapsed (re-expanding pulls it back in from the right). Mirrors #3606's
        // left-sidebar chevron convention, mirrored for the opposite side.
        private const string CollapseArrowGlyph = "";
        private const string ExpandArrowGlyph = "";

        private int _refreshGeneration;
        private BuildTrackerApiClient? _api;
        private Services.QueueWatcherService? _watcher;
        private Services.BuildQueuePostgresClient? _db;
        private Services.SessionLimitAutoRestartService? _sessionLimitAutoRestart;
        private List<QueueItem> _lastItems = new();

        // ── Build Matrix drawer — Git #3658. Real per-slot occupancy comes from
        // _watcher.GetRunningBuildIds() (the real _running dictionary backing
        // GetActiveUsageSummary); this dictionary only keeps that admission STABLE
        // across re-renders — a running build keeps its slot number until it stops
        // running, matching ShaneBuilder's own _matrixSlotAssignments behavior — it is
        // not a second source of "who is running."
        private bool _matrixDrawerOpen;
        private readonly Dictionary<int, int> _matrixSlotAssignments = new(); // QueueItem.Id -> slot index (0-based)
        // Git #3689 — the drawer's slot cards, reused across ticks instead of rebuilt (see RenderMatrixDrawer).
        private KeyedSlotCardHost? _matrixSlotCards;
        /// <summary>Git #1862 — the live open-issue set from the last Git Board refresh,
        /// forwarded by MainWindow (same free fetch Build Watch already consumes — no new
        /// `gh` call). Null until the first refresh arrives; a real blocker is only counted
        /// as blocking when this set reports it OPEN, and the DAG's 🔒 BLOCKED / the four
        /// header counts both read from it. On a cold start (still null) blocked-ness is
        /// UNKNOWN — the header falls back to the old declared-blocker heuristic and marks
        /// itself provisional (see <see cref="UpdateQueueStatusCounts"/>).</summary>
        private HashSet<int>? _openIssues;
        /// <summary>Git #3700 — real, live set of issue numbers currently sitting in the board's
        /// "Ask Shane" status, fed by <see cref="ApplyAskShaneSet"/> (MainWindow's
        /// AskShaneMonitorService poll, mirror-driven). Null until the first poll lands — a card's
        /// <see cref="QueueGraphNode.IsAskingShane"/> reads false in that cold-start window rather
        /// than guessing, the same fail-safe shape <see cref="_openIssues"/> uses elsewhere.</summary>
        private HashSet<int>? _askShaneNumbers;
        /// <summary>Git #2107 — when <see cref="_openIssues"/> was last populated, whether by a
        /// Git Board refresh (<see cref="ApplyOpenIssueSet"/>) or this panel's own event-triggered
        /// recheck (<see cref="AutoRecheckOpenIssuesOnTransitionToVerifyingAsync"/>). Surfaced in
        /// the QUEUE header tooltip so "the badge might be stale" is visible even between
        /// transitions, instead of a silent assumption of freshness (issue's suggested option 1).</summary>
        private DateTime? _openIssuesRefreshedUtc;
        /// <summary>Git #2107 — guards <see cref="AutoRecheckOpenIssuesOnTransitionToVerifyingAsync"/>
        /// so an overlapping RefreshAsync tick can't fire a second concurrent `gh` call.</summary>
        private bool _autoRecheckInFlight;
        private string _filter = "Running";
        private readonly HashSet<int> _manuallyHiddenQueueIds = new();
        /// <summary>Git #3612 — the "Done" filter previously had no cap at all and rendered
        /// every historical done row unconditionally (1,894 real rows in the queue DB as of
        /// this fix), freezing the app. Default cap on the number of done rows rendered per
        /// pass; see <see cref="ApplyDoneRecencyCap"/> and <see cref="QueueDoneCapToggleLink_Click"/>.</summary>
        private const int DoneFilterDefaultCap = 150;
        /// <summary>Git #3612 — explicit, deliberate override set by the done-cap banner's
        /// "Show all" link. Reset to false whenever the filter changes away from "Done" so a
        /// stale "show all" doesn't silently carry over the next time Done is reselected.</summary>
        private bool _showAllDone;
        private int _doneFilterTotalCount;
        private int _doneFilterShownCount;
        /// <summary>Git #1834 — set by clicking a row in the build-set rollup summary;
        /// drills the queue graph below down to just that build set. Composes (AND) with
        /// <see cref="_filter"/> and the search box rather than overriding either — see
        /// ApplyFilter. Null = no drill-down active. "Ungrouped" is a valid value here,
        /// matching <see cref="NormalizeBuildSetKey"/>'s bucket name for a null/blank
        /// QueueItem.BuildSet.</summary>
        private string? _buildSetFilter;
        /// <summary>Git #1834 — which rollup rows are showing their expanded per-category
        /// detail. RenderBuildSetRollup now pools its rows via _rollupCards (Git #3834), so a
        /// row whose RollupRowKey is unchanged keeps its own live detail panel across renders —
        /// but this still has to be read from outside a rebuilt row too (a fresh row, and the
        /// chevron click handler's own read at build time), so it stays the source of truth
        /// rather than something inferred from whichever elements happen to still be live.</summary>
        private readonly HashSet<string> _expandedRollupSets = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Git #2693 — "All"/"Running"/"Verifying" activity filter chips next to the
        /// BUILD SETS header. A SEPARATE concept from <see cref="_buildSetFilter"/> above (which
        /// drills the queue graph below down to one chosen set): this only narrows which rollup
        /// rows RenderBuildSetRollup renders, by real activity within each set, composing with
        /// (not replacing) the existing any-activity filter already in orderedKeys.</summary>
        private string _rollupActivityFilter = "all";
        /// <summary>Git #1932 — per-build-set memory of which Verifying issue numbers the rollup's
        /// send (✈) button has already sent, so the same already-reported items don't keep the
        /// button visible/re-sendable forever. In-memory only, deliberately not persisted across
        /// an app restart: a restart means BuildConsole itself is fresh, and Shane re-reading a
        /// "landed" list he already saw in a still-open chat on the next send is a much smaller
        /// cost than a real one going permanently unsent because state loaded stale/wrong across
        /// a restart (e.g. a set renamed/reused between sessions). Keyed by the normalized build
        /// set key (case-insensitive, matching <see cref="_expandedRollupSets"/>).</summary>
        private readonly Dictionary<string, HashSet<int>> _sentVerifyingByBuildSet = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Git #3616 — the real, per-issue answer to "does this Verifying item's own
        /// build-journal bookend actually check out as a genuine, git-verified DONE on
        /// origin/main" (<see cref="DoneBookendVerifier.GetSatisfiedAsync"/>), refreshed
        /// opportunistically off every <see cref="RenderBuildSetRollup"/> call rather than a
        /// timer. A `Verifying` local status has always only meant "the build session finished
        /// and is pending verification" — never "verification actually happened" — so the
        /// rollup's own "landed" send must not trust that status alone. Fails CLOSED like the
        /// verifier itself: an issue absent from this cache (not yet checked, or the last check
        /// came back unsatisfied) is treated as NOT verified — i.e. never eligible to be reported
        /// "landed" — until a real positive lands here.</summary>
        private readonly Dictionary<int, bool> _verifyingBookendSatisfied = new();
        private bool _verifyingBookendRefreshInFlight;
        private const string UngroupedBuildSetKey = "Ungrouped";
        /// <summary>Git #3336 — each real build-set key's resolved top Epic(s), computed from its
        /// members' real GithubNumbers via <see cref="EpicResolver"/> right before every
        /// <see cref="RenderBuildSetRollup"/> call. A set with zero distinct resolved Epics renders
        /// under "No Epic"; more than one distinct Epic (buildSets are built from one Feature/app by
        /// construction, but this is checked, not assumed) renders under "(mixed Epics)" instead of
        /// silently picking one.</summary>
        private Dictionary<string, List<EpicResolver.ResolvedEpic>> _buildSetEpics = new(StringComparer.OrdinalIgnoreCase);
        private int? _selectedQueueItemId;
        private static readonly Dictionary<int, string> _issueTitleCache = new();
        private static readonly HashSet<int> _pendingFetches = new();
        /// <summary>Git #1979 — issue numbers `gh` has confirmed do not resolve to any issue/PR in this repo
        /// (a permanent condition, not a transient network/auth/rate-limit blip). Checked alongside
        /// `_issueTitleCache` so a known-bad number isn't re-queried via `gh issue view` on every refresh.</summary>
        private static readonly HashSet<int> _unresolvableIssueNumbers = new();
        /// <summary>Git #2890 — bounds how many background `gh issue view` title fetches run concurrently.
        /// Before this, <see cref="TriggerBackgroundIssueTitleQueries"/> fired one UNAWAITED, unbounded
        /// `gh` subprocess per uncached number, all at once, on EVERY periodic refresh tick. A large burst
        /// re-tripped the rate-limit circuit, which rejected every call so the cache stayed empty, so the
        /// next tick re-fired the identical full burst — self-perpetuating. Fetches now queue on this
        /// semaphore and run at most <see cref="MaxConcurrentTitleFetches"/> at a time.</summary>
        private const int MaxConcurrentTitleFetches = 3;
        private static readonly System.Threading.SemaphoreSlim _titleFetchConcurrency =
            new(MaxConcurrentTitleFetches, MaxConcurrentTitleFetches);
        /// <summary>Git #2890 — UTC "retry not before" time per issue number whose last title fetch failed
        /// transiently (rate-limit circuit open, `gh` spawn error, etc.). A number here is skipped by
        /// <see cref="TriggerBackgroundIssueTitleQueries"/> until the cooldown elapses. Bounded concurrency
        /// alone is not enough: without this, every failing number would still be re-attempted on every
        /// single refresh tick (just staggered), hammering `gh` for a number that keeps failing.</summary>
        private static readonly Dictionary<int, DateTime> _titleFetchCooldownUntil = new();
        private static readonly TimeSpan TitleFetchRetryCooldown = TimeSpan.FromSeconds(60);
        /// <summary>Git #2817 — consecutive transient-failure count per issue number, since #2890's flat
        /// 60s cooldown still retried a persistently-failing number (e.g. one only ever hit during a
        /// rate-limit storm) forever, once per minute, for as long as it stayed in the warm-up set. After
        /// <see cref="MaxTransientFailuresBeforeGiveUp"/> straight failures the cooldown escalates to
        /// <see cref="TitleFetchGiveUpCooldown"/> instead — a real give-up, not an unbounded retry — while
        /// still self-healing: a later success (e.g. the circuit closes) clears the count immediately.</summary>
        private static readonly Dictionary<int, int> _titleFetchConsecutiveFailures = new();
        private const int MaxTransientFailuresBeforeGiveUp = 5;
        private static readonly TimeSpan TitleFetchGiveUpCooldown = TimeSpan.FromHours(1);

        private const double IssueRowTitleReserve = 50;
        private const double MinIssueRowTitleWidth = 24;
        private readonly List<TextBlock> _inFlightTitleBlocks = new();
        private readonly List<TextBlock> _sessionsTitleBlocks = new();

        // ── Visual DAG Graph Layout Constants (#860 Reference) ───────────────
        private const double QueueGraphLaneWidth = 18;
        private const double QueueGraphDotRadius = 5.5;
        private const double QueueGraphLeftPad = 12;

        private static readonly string[] QueueGraphLaneColors =
        {
            "#89B4FA", // blue
            "#A6E3A1", // green
            "#FAB387", // peach
            "#CBA6F7", // mauve
            "#F5C2E7", // pink
            "#94E2D5", // teal
            "#F38BA8", // red
            "#F9E2AF", // yellow
        };

        private static SolidColorBrush QueueLaneBrush(int column) =>
            new SolidColorBrush((Color)ColorConverter.ConvertFromString(
                QueueGraphLaneColors[((column % QueueGraphLaneColors.Length) + QueueGraphLaneColors.Length) % QueueGraphLaneColors.Length]));

        private static double QueueLaneX(int column) => QueueGraphLeftPad + column * QueueGraphLaneWidth;

        private sealed class QueueGraphNode
        {
            public int Key;
            public string DisplayRef = "";
            public string Title = "";
            public string Status = "queued";
            public bool IsBlocked;
            public bool IsWaitingForInput;
            /// <summary>Git #3700 — this item's real GitHub issue currently sits in the board's
            /// "Ask Shane" status (see <see cref="_askShaneNumbers"/>): a genuine, standing
            /// decision Shane needs to make, not an active mid-build chat prompt (that's
            /// <see cref="IsWaitingForInput"/>). Never gated on this item's own raw queue
            /// status, mirroring #3626's "Blocked" no-gating principle.</summary>
            public bool IsAskingShane;
            public List<int> BlockedBy = new();
            public QueueItem? Item;
            public MainWindow.PersistedQueueDisplayItem? RestartItem;
            public Border? CardElement;
            public int Row;
            public int Column;
            public double CenterY;
            /// <summary>Git build-set nesting — the `--buildSet <name>` value this item was queued
            /// with (QueueItem.BuildSet), or null when ungrouped. Drives header insertion in
            /// RenderQueue and the trunk-line break / cross-set edge styling in RedrawQueueGraph.</summary>
            public string? BuildSet;
        }

        private readonly List<QueueGraphNode> _currentGraphNodes = new();
        // Git #1815 — RenderQueue re-renders the card list on every poll tick whose queue
        // changed and rebuilds any card whose content changed, so without remembering which
        // node Keys were already on screen, a rebuilt card would re-fade-in. Persist the set
        // across renders and only animate a card whose Key genuinely wasn't present last render.
        private HashSet<int> _knownQueueCardKeys = new();
        // Git #3698 — every element RenderQueue puts in QueueCardsHost (cards, build-set
        // containers, the offline banner), pooled across renders by identity + everything it
        // displays. See the comment at RenderQueue's step 5.
        private readonly KeyedCardPool _queueCards = new();
        // Git #3834 — same KeyedCardPool discipline as _queueCards above, applied to
        // RenderBuildSetRollup's Epic-group headers and per-build-set rows: an Epic header or
        // row whose real content is unchanged since the last render is kept (with its pending
        // send-outcome DispatcherTimer, if any, intact) instead of being torn down and rebuilt
        // from scratch on every queue-signature/bookend-satisfaction poll while the panel is open.
        private readonly KeyedCardPool _rollupCards = new();
        private bool _hasRenderedQueueOnce = false;
        private int _currentMaxLanes = 1;

        private void ApplyTitleMaxWidths(ListBox listBox, List<TextBlock> registry)
        {
            var available = listBox.ActualWidth;
            foreach (var block in registry)
            {
                block.MaxWidth = Math.Max(MinIssueRowTitleWidth, available - IssueRowTitleReserve);
            }
        }

        private void InFlightIssuesList_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyTitleMaxWidths(InFlightIssuesList, _inFlightTitleBlocks);
        }

        private void ActiveSessionsList_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyTitleMaxWidths(ActiveSessionsList, _sessionsTitleBlocks);
        }

        public BuildQueuePanel()
        {
            InitializeComponent();

            // Git #3786 — apply the persisted CritterLoungeVisible choice at construction so the
            // very first paint already reflects the last real toggle, not a flash of the default.
            ApplyCritterLoungeVisibility(BuildConsoleSettings.Load().CritterLoungeVisible);

            // Git #3785 — real last-closed state, persisted across restarts (mirrors
            // FloatingChatDockExpanded's #2195 pattern); default false/closed per the
            // issue's own ask for a reasonable first-launch default.
            try { _buildSetsPanelOpen = BuildConsoleSettings.Load().BuildSetsPanelOpen; } catch { }
            ApplyBuildSetsPanelState();
        }

        /// <summary>Called once from MainWindow with the shared API client and optional direct-DB client.</summary>
        public void Initialize(BuildTrackerApiClient api, Services.QueueWatcherService? watcher = null, Services.BuildQueuePostgresClient? db = null, Services.SessionLimitAutoRestartService? sessionLimitAutoRestart = null)
        {
            _api = api;
            _watcher = watcher;
            _db = db;
            _sessionLimitAutoRestart = sessionLimitAutoRestart;

            if (_watcher != null)
            {
                SyncPauseToggleVisual(_watcher.IsPaused);
                _watcher.PausedStateChanged += (paused) => Dispatcher.BeginInvoke(new Action(() => SyncPauseToggleVisual(paused)));
            }

            // Git #1862 — the QUEUE header no longer reads usage/cost (that badge is gone;
            // its persisted history moved to the title bar, #1864). UsageTrackingService is
            // deliberately left recording, untouched — this panel just no longer subscribes.

            // Git #2900 — Shane's explicit real requirement: nothing refreshes/refills/re-checks
            // automatically; everything waits for the manual refresh button. This used to be a
            // recurring 10s DispatcherTimer (_sessionsPollTimer) re-polling active sessions +
            // status counts + rollback state with zero user interaction. Now: one real one-time
            // initial load on tab open, same as RefreshInFlightIssuesAsync below, and otherwise
            // — Git #3767 — RefreshActiveSessionsAsync + the rollback check are genuinely
            // zero-GitHub-cost (local process list / local filesystem read), so they were folded
            // into the new, narrow BtnRefreshBoard_Click (the cheap board-diff button) rather than
            // given up entirely or left orphaned; see that method's own doc comment for the real
            // reasoning. RefreshInFlightIssuesAsync makes a genuine `gh` call, so it deliberately
            // was NOT bundled onto either of the two new narrow buttons — its only real trigger is
            // this initial load, same as before #3702 combined everything.
            _ = RefreshActiveSessionsAsync();
            UpdateQueueStatusCounts();
            DevServerRollbackService.CheckForRollbacks(this);

            _ = RefreshInFlightIssuesAsync("initial load");

            if (!api.IsConfigured)
            {
                QueueGraphContainer.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = "Not connected — set apiBaseUrl/ingestToken in scripts\\build-queue-watcher.config.json (Settings tab has the path).";
                QueueEmptyText.Visibility = Visibility.Visible;
                return;
            }

            // Git #2900 — real root cause: this was a recurring 15s DispatcherTimer calling the
            // SAME RefreshAsync() the manual refresh button uses, automatically, with zero user
            // interaction — the real structural driver of #2890's burst and of Batter Up's
            // automatic refilling (BatterUpPanel/AiBatterUpPanel have no timer of their own; they
            // ride RefreshAsync's QueueRefreshed/BoardRefreshCompleted cascade). Now: one real
            // one-time initial load on tab open. Git #3767 — deliberately NOT bundled onto either
            // of the new narrow BtnRefreshBoard_Click/BtnRefreshBatterUp_Click buttons (that would
            // reintroduce real GitHub cost onto both of the buttons this issue exists to make
            // cheap); its full GitHub-calling work already has plenty of other real triggers
            // elsewhere (build-completion/queue-event handlers in MainWindow), so removing it from
            // the old combined button orphans nothing.
            _ = RefreshAsync();

            // Git #3074 — #2900 removed the whole recurring timer above, but RefreshAsync() does
            // two genuinely different things in one call: a local Postgres re-read of the queue's
            // own status (_db.GetQueueAsync(), free, no rate-limit cost) and a couple of
            // fire-and-forget `gh`-calling side effects gated deep inside it
            // (AutoRecheckOpenIssuesOnTransitionAsync, TriggerBackgroundIssueTitleQueries).
            // Killing the timer entirely also killed the local-only half, so the Queued/Running/
            // Verifying/Done badges never move without a manual refresh. Resume ONLY the local
            // half on a short automatic interval — RefreshAsync(includeGitHubWork: false) skips
            // both `gh`-calling blocks — so the queue display stays live while GitHub-calling work
            // stays exactly where #2900 left it: manual-refresh-only.
            _localQueuePollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _localQueuePollTimer.Tick += async (_, _) =>
            {
                await RefreshAsync(includeGitHubWork: false);
                await UpdateIssueMirrorSyncStatusAsync();
            };
            _localQueuePollTimer.Start();

            _ = UpdateIssueMirrorSyncStatusAsync();
        }

        private DispatcherTimer? _localQueuePollTimer;

        /// <summary>
        /// Git #3254 — Shane: a real, visible display of when the local issue-mirror's (#3113) next
        /// automatic sync will fire, in the Build Queue panel. Rides the existing 5s local-refresh
        /// tick above (no new timer/poll) and reads GitHubIssueMirror's cheap in-memory
        /// IsSyncing/LastAttemptUtc plus two trivial local Postgres reads of the persisted
        /// bt_issue_mirror_sync_state row. Honest about the real in-progress/backoff states rather
        /// than showing a misleading countdown during them.
        ///
        /// Git #3337 — there are now two independently-gated passes (a cheap incremental issue-level
        /// sync and the expensive full board-status walk); this shows whichever is due SOONER
        /// (normally the incremental one), and labels it "next board-status sync" instead of the
        /// generic "next sync" on the (rarer) occasions the full walk is actually the nearer event, so
        /// the display never silently implies a board-status refresh is coming sooner than it is.
        /// </summary>
        private async Task UpdateIssueMirrorSyncStatusAsync()
        {
            try
            {
                if (GitHubIssueMirror.IsSyncing)
                {
                    IssueMirrorSyncText.Text = "Issue mirror: syncing…";
                    IssueMirrorSyncText.Visibility = Visibility.Visible;
                    return;
                }

                var backoffRemaining = GitHubIssueMirror.LastAttemptUtc == DateTime.MinValue
                    ? TimeSpan.Zero
                    : GitHubIssueMirror.FailedAttemptBackoff - (DateTime.UtcNow - GitHubIssueMirror.LastAttemptUtc);

                var (lastFullSyncAt, fullOk, fullNote) = await GitHubIssueMirror.GetSyncStateAsync();

                if (!fullOk && backoffRemaining > TimeSpan.Zero)
                {
                    IssueMirrorSyncText.Text = $"Issue mirror: retrying in {Math.Ceiling(backoffRemaining.TotalSeconds):0}s (last attempt failed)";
                    IssueMirrorSyncText.Visibility = Visibility.Visible;
                    return;
                }

                if (lastFullSyncAt == null)
                {
                    IssueMirrorSyncText.Text = "Issue mirror: never synced yet";
                    IssueMirrorSyncText.Visibility = Visibility.Visible;
                    return;
                }

                var (lastIncrSyncAt, _, _) = await GitHubIssueMirror.GetIncrementalSyncStateAsync();
                var lastAnySyncAt = (lastIncrSyncAt.HasValue && lastIncrSyncAt.Value > lastFullSyncAt.Value)
                    ? lastIncrSyncAt.Value
                    : lastFullSyncAt.Value;

                var nextIncremental = lastAnySyncAt.ToUniversalTime() + GitHubIssueMirror.IncrementalSyncInterval;
                var nextFull = lastFullSyncAt.Value.ToUniversalTime() + GitHubIssueMirror.FullSyncInterval;
                bool fullIsNext = nextFull < nextIncremental;
                var next = fullIsNext ? nextFull : nextIncremental;
                var label = fullIsNext ? "next board-status sync" : "next sync";

                var remaining = next - DateTime.UtcNow;
                IssueMirrorSyncText.Text = remaining > TimeSpan.Zero
                    ? $"Issue mirror: {label} in {FormatCountdown(remaining)}"
                    : "Issue mirror: sync due";
                IssueMirrorSyncText.Visibility = Visibility.Visible;
            }
            catch
            {
                // Best-effort display only — never let this affect the rest of the panel.
                IssueMirrorSyncText.Visibility = Visibility.Collapsed;
            }
        }

        private static string FormatCountdown(TimeSpan remaining)
        {
            var totalSeconds = (int)Math.Ceiling(remaining.TotalSeconds);
            var minutes = totalSeconds / 60;
            var seconds = totalSeconds % 60;
            return minutes > 0 ? $"{minutes}m {seconds}s" : $"{seconds}s";
        }

        private string? _lastSessionsSignature;
        private bool _sessionsRefreshInFlight;

        private async System.Threading.Tasks.Task RefreshActiveSessionsAsync()
        {
            if (_sessionsRefreshInFlight) return;
            _sessionsRefreshInFlight = true;
            try
            {
                List<Services.ClaudeAgentSession> sessions;
                try
                {
                    sessions = await Services.ClaudeAgentsService.ListActiveSessionsWithFallbackAsync();
                }
                catch
                {
                    return;
                }

                var signature = System.Text.Json.JsonSerializer.Serialize(sessions);
                if (signature == _lastSessionsSignature) return;
                _lastSessionsSignature = signature;

                SessionsCountText.Text = $"({sessions.Count})";

                _sessionsTitleBlocks.Clear();
                ActiveSessionsList.Items.Clear();
                if (sessions.Count == 0)
                {
                    ActiveSessionsList.Items.Add(new ListBoxItem { Content = "No active sessions.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                    return;
                }
                foreach (var s in sessions.OrderByDescending(s => s.StartedAt))
                {
                    var elapsed = DateTime.Now - s.StartedAt;
                    string elapsedStr = elapsed.TotalHours >= 1 ? $"{(int)elapsed.TotalHours}h {elapsed.Minutes}m" : $"{(int)elapsed.TotalMinutes}m";
                    var icon = s.Kind switch { "background" => "⚙", "untracked" => "❔", _ => "▶" };
                    var iconColor = s.Kind switch { "background" => "#8F8C88", "untracked" => "#8F8C88", _ => "#F2CA63" };

                    var panel = new StackPanel { Orientation = Orientation.Horizontal };
                    panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconColor)), VerticalAlignment = VerticalAlignment.Center });
                    var textStack = new StackPanel();
                    string title = !string.IsNullOrWhiteSpace(s.Name) ? s.Name
                        : !string.IsNullOrWhiteSpace(s.SessionId) ? s.SessionId[..Math.Min(8, s.SessionId.Length)]
                        : $"claude.exe (untracked)";
                    var titleBlock = new TextBlock { Text = title, FontSize = 12, Foreground = (Brush)Application.Current.FindResource("TextBrush"), TextWrapping = TextWrapping.NoWrap, TextTrimming = TextTrimming.CharacterEllipsis };
                    _sessionsTitleBlocks.Add(titleBlock);
                    textStack.Children.Add(titleBlock);
                    string subtitle = s.Kind == "untracked" ? $"PID {s.Pid}  ·  {elapsedStr} ago" : $"{s.Cwd}  ·  {elapsedStr} ago";
                    textStack.Children.Add(new TextBlock { Text = subtitle, FontSize = 10, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"), TextWrapping = TextWrapping.Wrap });
                    panel.Children.Add(textStack);

                    string tooltip = s.Kind == "untracked"
                        ? $"PID {s.Pid} · seen via Get-Process, not reported by claude agents --json"
                        : $"PID {s.Pid} · {s.Kind} · session {s.SessionId}";
                    if (s.WindowHandle != IntPtr.Zero) tooltip += " · click to bring its window forward";

                    var cm = new ContextMenu();
                    var miClose = new MenuItem { Header = "✕ Close Session" };
                    miClose.Click += (_, _) => CloseSession(s);
                    cm.Items.Add(miClose);

                    ActiveSessionsList.Items.Add(new ListBoxItem { Content = panel, Tag = s, ToolTip = tooltip, ContextMenu = cm, Cursor = s.WindowHandle != IntPtr.Zero ? System.Windows.Input.Cursors.Hand : System.Windows.Input.Cursors.Arrow });
                }
                ApplyTitleMaxWidths(ActiveSessionsList, _sessionsTitleBlocks);
            }
            finally
            {
                _sessionsRefreshInFlight = false;
            }
        }

        private void CloseSession(Services.ClaudeAgentSession s)
        {
            try
            {
                using var proc = System.Diagnostics.Process.GetProcessById(s.Pid);
                proc.Kill(entireProcessTree: true);
                Services.ActivityLog.Log("sessions", $"Closed session: {(string.IsNullOrWhiteSpace(s.Name) ? $"PID {s.Pid}" : s.Name)}");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Close Session", $"Couldn't close session: {ex.Message}");
            }
            _ = RefreshActiveSessionsAsync();
        }

        private void ActiveSessionsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (ActiveSessionsList.SelectedItem is ListBoxItem { Tag: Services.ClaudeAgentSession session })
            {
                Services.ClaudeAgentsService.BringToForeground(session.WindowHandle);
                ActiveSessionsList.SelectedItem = null;
            }
        }

        private string? _lastInFlightSignature;
        private List<Services.GitHubIssueSummary> _lastInFlightIssues = new();

        private async System.Threading.Tasks.Task RefreshInFlightIssuesAsync(string trigger)
        {
            List<Services.GitHubIssueSummary> issues;
            // Git #3022 — the In-Flight tile's initial cold-start load is one of the independent
            // startup GitHub bursts (a `gh issue list --label in-flight` call). Route it through the
            // global cold-start coordinator so it staggers against the other startup subsystems
            // instead of firing alongside them; pure pass-through once the cold-start window elapses,
            // so a mid-session manual refresh is unaffected.
            try { issues = await Services.StartupGitHubCoordinator.RunAsync("In-Flight tile", () => Services.GitHubIssuesService.ListOpenByLabelAsync("in-flight")); }
            catch { ActivityLog.Log("github.manual-refresh", $"In-Flight tile [{trigger}]: gh CLI fetch FAILED"); return; }
            ActivityLog.Log("github.manual-refresh", $"In-Flight tile [{trigger}]: {issues.Count} open in-flight issue(s) via gh CLI");

            var signature = System.Text.Json.JsonSerializer.Serialize(issues);
            if (signature == _lastInFlightSignature) return;
            _lastInFlightSignature = signature;

            _lastInFlightIssues = issues;
            RenderInFlightGrouped(issues);
        }

        private void RenderInFlightGrouped(List<Services.GitHubIssueSummary> issues)
        {
            issues = ApplyIssueFocusFilter(issues);
            InFlightCountText.Text = $"({issues.Count})";

            _inFlightTitleBlocks.Clear();
            InFlightIssuesList.Items.Clear();
            if (issues.Count == 0)
            {
                InFlightIssuesList.Items.Add(new ListBoxItem { Content = "Nothing in-flight and still open.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            var grouped = issues.GroupBy(i => i.Parent?.Number ?? -1)
                                 .OrderByDescending(g => g.Max(i => i.UpdatedAt));
            foreach (var group in grouped)
            {
                string epicTitle = group.Key == -1 ? "No Epic" : (group.First().Parent!.Title);
                var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 2) };
                header.Children.Add(new TextBlock { Text = "◆ ", FontSize = 11, Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"), VerticalAlignment = VerticalAlignment.Center });
                header.Children.Add(new TextBlock { Text = epicTitle, FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"), TextWrapping = TextWrapping.Wrap });
                InFlightIssuesList.Items.Add(new ListBoxItem { Content = header, IsHitTestVisible = false, Focusable = false });

                foreach (var issue in group.OrderByDescending(i => i.UpdatedAt))
                {
                    InFlightIssuesList.Items.Add(BuildIssueRow(issue, "⏳", "#F2CA63", _inFlightTitleBlocks));
                }
            }
            ApplyTitleMaxWidths(InFlightIssuesList, _inFlightTitleBlocks);
        }

        private static List<Services.GitHubIssueSummary> ApplyIssueFocusFilter(List<Services.GitHubIssueSummary> issues)
        {
            var focus = BuildConsole.Services.FocusModeService.Instance;
            return focus.IsActive
                ? issues.Where(i => focus.IsIssueInFocus(i.Number)).ToList()
                : issues;
        }

        private static ListBoxItem BuildIssueRow(Services.GitHubIssueSummary issue, string icon, string iconColorHex, List<TextBlock>? titleRegistry = null)
        {
            string localTime = issue.UpdatedAt.ToLocalTime().ToString("MMM d, h:mm tt");

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconColorHex)), VerticalAlignment = VerticalAlignment.Center });
            var textStack = new StackPanel();
            var titleBlock = new TextBlock { Text = issue.Title, FontSize = 12, Foreground = (Brush)Application.Current.FindResource("TextBrush") };
            if (titleRegistry != null)
            {
                titleBlock.TextWrapping = TextWrapping.NoWrap;
                titleBlock.TextTrimming = TextTrimming.CharacterEllipsis;
                titleRegistry.Add(titleBlock);
            }
            else
            {
                titleBlock.TextWrapping = TextWrapping.Wrap;
            }
            textStack.Children.Add(titleBlock);
            textStack.Children.Add(new TextBlock { Text = $"#{issue.Number}  ·  updated {localTime}", FontSize = 10, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"), TextWrapping = TextWrapping.Wrap });
            panel.Children.Add(textStack);
            return new ListBoxItem { Content = panel, ToolTip = issue.Url, Tag = issue.Number };
        }

        // ── Epic Issues Section ──────────────────────────────────────────────
        // Shane, 2026-08-28: "I need the Issues in Epic panel to hide... don't
        // delete it, I might want it back later." Flip this back to true to
        // restore it — the section, its filter chips, and its list are all
        // still here, just forced Collapsed below regardless of the normal
        // active-epic logic.
        private const bool ShowChatEpicIssuesSection = false;

        private int? _activeChatEpicId;
        private int? _activeChatEpicGithubNumber;
        private string? _activeChatEpicTitle;
        private List<GitHubSubIssue> _lastEpicIssues = new();
        private string _epicFilter = "Open";

        public async void SetActiveChatEpic(int? epicId, int? epicGithubNumber, string? epicTitle, bool force = false)
        {
            if (!force && epicId == _activeChatEpicId) return;
            _activeChatEpicId = epicId;
            _activeChatEpicGithubNumber = epicGithubNumber;
            _activeChatEpicTitle = epicTitle;

            if (!ShowChatEpicIssuesSection || epicId == null)
            {
                ChatEpicIssuesSection.Visibility = Visibility.Collapsed;
                return;
            }

            ChatEpicIssuesHeader.Text = $"ISSUES IN {epicTitle?.ToUpperInvariant() ?? "THIS EPIC"}";
            ChatEpicIssuesSection.Visibility = Visibility.Visible;
            _lastEpicIssues = new();
            ChatEpicIssuesList.Items.Clear();

            if (epicGithubNumber == null)
            {
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = "This epic has no linked GitHub issue.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = "Loading…", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });

            // ── Source 1: GitHub sub-issues REST API ─────────────────────────────
            // bypassCache: true — tab-switch is user-initiated; always go fresh so a
            // stale ETag (from when the epic had 0 sub-issues) can't return empty.
            List<GitHubSubIssue> ghIssues = new();
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                ghIssues = await client.GetSubIssuesAsync(epicGithubNumber.Value, bypassCache: true);
                ActivityLog.Log("build-queue-panel.epic", $"GitHub sub-issues #{epicGithubNumber}: {ghIssues.Count} returned ({ghIssues.Count(i => !IsRealClosed(i.State))} open, {ghIssues.Count(i => IsRealClosed(i.State))} closed).");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue-panel.epic", $"GitHub sub-issues #{epicGithubNumber} FAILED: {ex.Message}");
            }

            if (_activeChatEpicId != epicId) return;

            // Git #3652 — the "internal Build Tracker API" fallback that used to run here
            // (GetIssuesForEpicAsync against bt_issues.epic_id) is disconnected: #3651 moved
            // bt_ tables to BUILD_DATABASE_URL and the api-server route it called now only
            // serves a frozen pre-#3651 copy out of the shared product database — that route
            // now returns an honest 410. GitHub sub-issues is the sole source here now.
            var issues = new List<GitHubSubIssue>(ghIssues);
            ActivityLog.Log("build-queue-panel.epic", $"Total for epic #{epicGithubNumber} (id={epicId}): {issues.Count} issues ({issues.Count(i => !IsRealClosed(i.State))} open, {issues.Count(i => IsRealClosed(i.State))} closed). Filter={_epicFilter}.");

            if (_lastEpicIssues != null && _lastEpicIssues.Count > 0)
            {
                var newlyClosed = _lastEpicIssues
                    .Where(old => !IsRealClosed(old.State))
                    .Where(old => issues.Any(cur => cur.Number == old.Number && IsRealClosed(cur.State)))
                    .ToList();

                if (newlyClosed.Count > 0)
                {
                    int delayMs = 0;
                    foreach (var closedSub in newlyClosed)
                    {
                        int currentDelay = delayMs;
                        string label = $"#{closedSub.Number} {closedSub.Title}";
                        if (currentDelay == 0)
                        {
                            IssueChompAnimation.Play(null, label);
                        }
                        else
                        {
                            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(currentDelay) };
                            timer.Tick += (_, _) =>
                            {
                                timer.Stop();
                                IssueChompAnimation.Play(null, label);
                            };
                            timer.Start();
                        }
                        delayMs += 400;
                    }
                }
            }

            _lastEpicIssues = issues;
            RenderChatEpicIssues();
        }

        public async System.Threading.Tasks.Task RefreshActiveChatEpicIssuesAsync()
        {
            if (_activeChatEpicId.HasValue && _activeChatEpicGithubNumber.HasValue)
            {
                SetActiveChatEpic(_activeChatEpicId, _activeChatEpicGithubNumber, _activeChatEpicTitle, force: true);
            }
            await System.Threading.Tasks.Task.CompletedTask;
        }

        // Git #3767 — this section's own real trigger, now that the old combined refresh button
        // (which used to force-refetch this same section on every click) is gone. A single real
        // GitHub call (GetSubIssuesAsync for one epic), scoped to exactly the section it refreshes.
        private void BtnRefreshChatEpicIssues_Click(object sender, RoutedEventArgs e) => _ = RefreshActiveChatEpicIssuesAsync();

        private static bool IsRealClosed(string? state) =>
            string.Equals(state, "closed", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(state, "completed", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(state, "done", StringComparison.OrdinalIgnoreCase);

        private void RenderChatEpicIssues()
        {
            ChatEpicIssuesList.Items.Clear();
            var filtered = _epicFilter switch
            {
                "Open"   => _lastEpicIssues.Where(i => !IsRealClosed(i.State)).ToList(),
                "Closed" => _lastEpicIssues.Where(i => IsRealClosed(i.State)).ToList(),
                _        => _lastEpicIssues
            };

            if (filtered.Count == 0)
            {
                string emptyLabel = _epicFilter switch
                {
                    "Open"   => "No open issues in this epic.",
                    "Closed" => "No closed issues in this epic.",
                    _        => "No issues in this epic."
                };
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = emptyLabel, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            foreach (var issue in filtered)
            {
                bool closed = IsRealClosed(issue.State);
                var panel = new Grid { Margin = new Thickness(0, 2, 0, 2) };
                panel.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                panel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

                var iconBlock = new TextBlock
                {
                    Text = closed ? "✅ " : "⏳ ",
                    FontSize = 12,
                    Foreground = closed ? (Brush)Application.Current.FindResource("GreenBrush") : (Brush)Application.Current.FindResource("YellowBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 4, 0)
                };
                Grid.SetColumn(iconBlock, 0);
                panel.Children.Add(iconBlock);

                var titleBlock = new TextBlock
                {
                    Text = $"#{issue.Number} {issue.Title}",
                    FontSize = 12,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextWrapping = TextWrapping.NoWrap,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(titleBlock, 1);
                panel.Children.Add(titleBlock);
                var lbi = new ListBoxItem
                {
                    Content = panel,
                    ToolTip = $"#{issue.Number} — Click to open details side-by-side with chat",
                    Cursor = Cursors.Hand
                };
                int capturedNum = issue.Number;
                lbi.PreviewMouseLeftButtonUp += (s, e) =>
                {
                    EpicSubIssueClicked?.Invoke(this, capturedNum);
                };
                ChatEpicIssuesList.Items.Add(lbi);
            }
        }

        private void EpicFilterChip_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not ToggleButton clicked) return;
            foreach (var chip in new[] { ChipEpicAll, ChipEpicOpen, ChipEpicClosed })
            {
                chip.IsChecked = chip == clicked;
            }
            _epicFilter = clicked.Tag as string ?? "Open";
            ActivityLog.Log("build-queue-panel.epic-filter", $"epic issues filter -> {_epicFilter}");
            RenderChatEpicIssues();
        }

        private string? _lastQueueSignature;

        /// <summary>Git #3801 — the cheap server-side change stamp
        /// (<see cref="Services.BuildQueuePostgresClient.GetQueueChangeStampAsync"/>, combined with
        /// the spillover file's own stamp) that was current the last time <see cref="RefreshAsync"/>
        /// actually completed a full pass. An identical stamp on a later local poll tick means
        /// nothing the panel renders from has changed, so that tick skips the whole expensive
        /// middle. Null until the first full pass, and after any pass where the probe itself
        /// failed — both of which correctly force the next tick to do the full work.</summary>
        private string? _lastQueueChangeStamp;

        private string? _lastRestartGroupSignature;
        private bool _queueIsStale;
        private DateTime? _queueCachedAtUtc;

        private Dictionary<int, int> _downstreamBlockCounts = new();
        private int _maxDownstreamBlockCount;

        private static Dictionary<int, int> ComputeDownstreamBlockCounts(List<QueueItem> items)
        {
            var directDependents = new Dictionary<int, List<QueueItem>>();
            foreach (var item in items)
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                foreach (var b in blockers)
                {
                    if (b == 0 || b == item.GithubNumber) continue;
                    if (!directDependents.TryGetValue(b, out var list)) { list = new List<QueueItem>(); directDependents[b] = list; }
                    list.Add(item);
                }
            }

            var counts = new Dictionary<int, int>();
            foreach (var item in items)
            {
                if (!item.GithubNumber.HasValue) { counts[item.Id] = 0; continue; }

                var seenIds = new HashSet<int> { item.Id };
                var expandedNumbers = new HashSet<int>();
                var frontier = new Queue<int>();
                frontier.Enqueue(item.GithubNumber.Value);
                int count = 0;
                while (frontier.Count > 0)
                {
                    int num = frontier.Dequeue();
                    if (!expandedNumbers.Add(num)) continue;
                    if (!directDependents.TryGetValue(num, out var deps)) continue;
                    foreach (var dep in deps)
                    {
                        if (!seenIds.Add(dep.Id)) continue;
                        count++;
                        if (dep.GithubNumber.HasValue) frontier.Enqueue(dep.GithubNumber.Value);
                    }
                }
                counts[item.Id] = count;
            }
            return counts;
        }

        private Dictionary<int, List<QueueItem>> _reverseBlocks = new();

        /// <summary>Git #3601 — the reverse of the forward blocker ghost cards
        /// (<see cref="BuildBlockerGhostCard"/>/<see cref="LiveBlockedBy"/>): for every real
        /// queue item that is a live, currently-open blocker of at least one other real queue
        /// item, the list of those blocked items themselves — same real relationship, just
        /// inverted, and using the exact same live filter (<see cref="LiveBlockedBy"/>, which
        /// already checks a declared blocker against the real <see cref="_openIssues"/> set)
        /// so this list and the forward ghost cards can never disagree about which edges are
        /// still genuinely live. Keyed by the blocker's own GitHub issue number, since
        /// `blocked_by` edges are GitHub-native — an item with no GithubNumber can't be
        /// declared as anyone's blocker.
        ///
        /// Computed against <paramref name="allItems"/> — the FULL, unfiltered queue
        /// (RenderQueue's own <c>rawItems</c> parameter, effectively <see cref="_lastItems"/>)
        /// — not whatever the currently-active status filter narrowed the render to, so a
        /// build's "Blocks:" row is correct even when what it blocks sits under a different
        /// filter. Same reasoning as <see cref="FindLiveNodeForBlocker"/> (#3599).
        ///
        /// Git #3626 — previously gated on the blocked item still being "queued" (mirroring
        /// the forward ghost-card row's own now-removed status gate). Per Shane's explicit
        /// real widening, that gate is gone: no status restriction applies in either
        /// direction. A candidate naturally drops off this list once <see cref="LiveBlockedBy"/>
        /// no longer reports a genuinely-open blocker for it (its blocker closed, or its own
        /// declared blocked_by data cleared) — real data does the filtering, not raw status.</summary>
        private Dictionary<int, List<QueueItem>> ComputeReverseBlocks(List<QueueItem> allItems)
        {
            var result = new Dictionary<int, List<QueueItem>>();
            foreach (var candidate in allItems)
            {
                var node = BuildItemNode(candidate);
                foreach (var blockerNumber in LiveBlockedBy(node))
                {
                    if (!result.TryGetValue(blockerNumber, out var list)) { list = new List<QueueItem>(); result[blockerNumber] = list; }
                    list.Add(candidate);
                }
            }
            return result;
        }

        /// <summary>
        /// Re-reads the queue's real current status and re-renders the panel.
        /// <paramref name="includeGitHubWork"/> (Git #3074) separates the two genuinely different
        /// things this method does in one call: the local Postgres queue re-read
        /// (<c>_db.GetQueueAsync()</c>) plus all in-memory rendering — free, no rate-limit cost,
        /// safe to run on a short automatic interval — versus the couple of fire-and-forget
        /// `gh`-calling side effects gated inside it (<see cref="AutoRecheckOpenIssuesOnTransitionAsync"/>,
        /// <see cref="TriggerBackgroundIssueTitleQueries"/>), which stay manual-refresh-only per
        /// #2900. Defaults to <c>true</c> so every existing manual call site (the refresh button,
        /// post-action re-renders, etc.) is unchanged; only the #3074 local-only poll timer passes
        /// <c>false</c>.
        /// </summary>
        /// <summary>
        /// Git #3801 — the Build Queue panel's render gate: a stable fingerprint of everything the
        /// panel draws the queue from. Replaces the old
        /// <c>JsonSerializer.Serialize(_lastItems)</c> signature, which built a ~4.4 MB JSON string
        /// (an ~8.8 MB UTF-16 allocation, straight onto the Large Object Heap) on the UI thread on
        /// every single pass just to compare it with the previous one.
        ///
        /// Coverage is deliberately identical to what that JSON covered — every public
        /// <see cref="QueueItem"/> field in a fixed order, plus the offline flag and the persisted
        /// "Queued for Restart" items — so this is purely a cost change, not a behaviour change.
        /// <c>OwnerRepo</c> is the one property not fed in explicitly: it is computed from
        /// <c>RepoOwner</c>/<c>RepoName</c>, which are.
        ///
        /// Each field's characters go into the hash directly as their existing UTF-16 bytes (a span
        /// over the live string, no copy), followed by a 0x01 terminator; a null field contributes a
        /// single 0x00 instead, so null and "" stay distinguishable. Nothing larger than the hash
        /// state is allocated at any point.
        ///
        /// Call this from a thread-pool thread, not the dispatcher. That is safe because
        /// <see cref="_lastItems"/> is only ever REPLACED wholesale by <see cref="RefreshAsync"/> —
        /// the list and its items are never mutated in place after
        /// <c>GetQueueAsync</c> builds them — and the caller passes the exact list reference it
        /// hashed rather than re-reading the field.
        /// </summary>
        private static string ComputeQueueSignature(
            List<QueueItem> items,
            bool queueIsStale,
            List<MainWindow.PersistedQueueDisplayItem> persistedRestartItems)
        {
            using var hash = System.Security.Cryptography.IncrementalHash.CreateHash(
                System.Security.Cryptography.HashAlgorithmName.SHA256);

            var nullBytes = new byte[] { 0x00 };
            var fieldBytes = new byte[] { 0x01 };

            void Text(string? value)
            {
                if (value == null) { hash.AppendData(nullBytes); return; }
                if (value.Length > 0)
                    hash.AppendData(System.Runtime.InteropServices.MemoryMarshal.AsBytes(value.AsSpan()));
                hash.AppendData(fieldBytes);
            }
            void Number(long? value) =>
                Text(value?.ToString(System.Globalization.CultureInfo.InvariantCulture));
            void Flag(bool value) => Text(value ? "1" : "0");
            void Moment(DateTimeOffset? value) => Number(value?.UtcTicks);
            void Numbers(IReadOnlyList<int>? value)
            {
                if (value == null) { hash.AppendData(nullBytes); return; }
                foreach (var n in value) Number(n);
                hash.AppendData(fieldBytes);
            }

            Flag(queueIsStale);
            Number(items.Count);
            foreach (var item in items)
            {
                Number(item.Id);
                Text(item.Title);
                Text(item.Prompt);
                Text(item.Model);
                Text(item.Effort);
                Text(item.Cwd);
                Text(item.BuildSet);
                Number(item.GithubNumber);
                Number(item.BlockedByNumber);
                Numbers(item.BlockedByNumbers);
                Text(item.Status);
                Number(item.ExitCode);
                Text(item.SessionId);
                Text(item.ResumeSessionId);
                Text(item.ChatUrl);
                Text(item.OriginatingChatId);
                Moment(item.UpdatedAt);
                Numbers(item.AssociatedIssueNumbers);
                Text(item.Cli);
                Text(item.Account);
                Number(item.BuildPid);
                Moment(item.BuildPidStartedAt);
                Number(item.SupersededById);
                Text(item.RepoOwner);
                Text(item.RepoName);
                Flag(item.Archived);
                Moment(item.ArchivedAt);
                Text(item.Note);
            }

            Number(persistedRestartItems.Count);
            foreach (var restartItem in persistedRestartItems)
            {
                Text(restartItem.Title);
                Number(restartItem.GithubNumber);
            }

            return Convert.ToHexString(hash.GetHashAndReset());
        }

        public async System.Threading.Tasks.Task RefreshAsync(bool includeGitHubWork = true)
        {
            if (_api == null || !_api.IsConfigured) return;

            // ── Git #3801 — cheap change probe, before anything expensive ─────────────────
            // The #3074 local poll timer calls this method every 5 seconds, forever, and every
            // line below used to run unconditionally: a full re-read of all ~2,281 bt_build_queue
            // rows (~4.4 MB, every row's whole prompt included) followed by a
            // JsonSerializer.Serialize of that entire list ON THE UI THREAD — roughly 8.8 MB of
            // UTF-16 Large Object Heap garbage per tick — purely to compare one string against the
            // previous one. Measured against the real local database (10 consecutive 5s samples
            // taken while a build was running) the queue's own data is byte-identical between
            // ticks, so that whole cost bought a string comparison that matched every single time.
            //
            // GetQueueChangeStampAsync answers the same question server-side and returns ~110
            // bytes. An identical stamp means an unchanged queue, so this tick skips the fetch,
            // the signature and both renders. It runs via Task.Run so the Npgsql continuations
            // inside it land on the thread pool rather than on the dispatcher this timer ticks on.
            //
            // Deliberately computed on BOTH paths (poll and manual) but only ALLOWED TO SKIP on
            // the poll path, and always taken BEFORE the fetch below: a stamp read after the fetch
            // could describe data newer than what _lastItems actually holds, which would make the
            // next tick skip over a real change. Taken before, the worst case is the opposite and
            // harmless — one redundant full pass.
            string? changeStamp = null;
            if (_db != null)
            {
                try
                {
                    var dbStamp = await System.Threading.Tasks.Task.Run(() => _db.GetQueueChangeStampAsync());
                    if (dbStamp != null) changeStamp = dbStamp + "~" + MainWindow.GetPersistedQueueFileStamp();
                }
                catch (Exception ex)
                {
                    // A failed probe is never read as "nothing changed" — fall through to the full
                    // unconditional refresh below, exactly as this method behaved before #3801.
                    changeStamp = null;
                    ActivityLog.Log("build-queue-panel", $"queue change probe failed, falling back to full refresh: {ex.Message}");
                }
            }
            if (!includeGitHubWork && changeStamp != null && _lastQueueSignature != null
                && changeStamp == _lastQueueChangeStamp)
            {
                // Nothing the panel renders from moved. Everything skipped below would have
                // recomputed identical results from an identical _lastItems. The cheap,
                // purely-derived tail still runs so RefreshAsync's existing contract for
                // subscribers (status counts, orphan banner, CappedCountChanged, SyncError,
                // QueueRefreshed) is unchanged — only the expensive middle is gone.
                UpdateQueueStatusCounts();
                UpdateOrphanRecoveryBanner();
                CappedCountChanged?.Invoke(this, _lastItems.Count(i => i.Status == Services.AccountCapPolicy.CappedStatus));
                SyncError?.Invoke(this, _queueIsStale
                    ? $"Build Queue: showing cached data from {_queueCachedAtUtc?.ToLocalTime():g} — dev server unreachable"
                    : null);
                QueueRefreshed?.Invoke(this, EventArgs.Empty);
                return;
            }

            int myGeneration = ++_refreshGeneration;
            try
            {
                // Git #2107 — snapshot BEFORE the reassignment below so the auto-recheck call
                // near the bottom of this method can diff old vs. new status per item id.
                var previousItems = _lastItems;
                if (_db != null)
                {
                    // Git #3801 — Task.Run, not a bare await: started from a DispatcherTimer tick
                    // there is a live SynchronizationContext, so every await inside GetQueueAsync
                    // (one per Npgsql read-buffer refill across ~4.4 MB of rows, plus the two
                    // AssociatedIssueNumbers queries) resumes on the UI thread. Launching it on
                    // the thread pool leaves that context behind, so the fetch and the row mapping
                    // happen off the dispatcher and only this await's own continuation returns to it.
                    _lastItems = await System.Threading.Tasks.Task.Run(() => _db.GetQueueAsync());
                    _queueIsStale = false;
                    _queueCachedAtUtc = null;
                }
                else
                {
                    var result = await _api.GetQueueCachedAsync();
                    _lastItems = result.Data;
                    _queueIsStale = result.IsStale;
                    _queueCachedAtUtc = result.CachedAtUtc;
                }
                if (myGeneration != _refreshGeneration) return;
                BuildConsole.Services.NotGitNumberRegistry.SyncFromQueue(_lastItems);
                CheckPriorityBuildSetCompletion(_lastItems);
                CheckExclusiveBuildSetCompletion(_lastItems);
                ReportActiveBuildSets(_lastItems);
                if (includeGitHubWork)
                {
                    // Git #2107 — fire-and-forget: a queue item that just transitioned into
                    // Verifying/Done is the real moment a declared blocker is most likely to have
                    // just closed (this local-DB poll runs regardless; only the `gh` call inside
                    // is gated to fire on a genuine transition, not every tick). Never awaited here
                    // so a slow/unreachable `gh` call can't stall the local queue poll this method
                    // otherwise runs on. Git #3074 — this is genuinely GitHub-calling work, so it's
                    // skipped entirely when the local-only poll timer calls this method.
                    _ = AutoRecheckOpenIssuesOnTransitionAsync(previousItems, _lastItems);
                }

                List<MainWindow.PersistedQueueDisplayItem> persistedRestartItems;
                try { persistedRestartItems = MainWindow.GetPersistedQueueDisplayItems(); }
                catch { persistedRestartItems = new(); }

                // Git #3801 — was:
                //     _queueIsStale + "|" + JsonSerializer.Serialize(_lastItems) + "|" + <the same
                //     for the persisted restart items>
                // i.e. a ~4.4 MB JSON document built on the UI thread on every single pass purely
                // to be compared with the previous one and thrown away. ComputeQueueSignature
                // covers the exact same fields (see its own doc comment) but streams them into a
                // SHA-256 instead of materializing a string, and runs on the thread pool.
                var itemsForSignature = _lastItems;
                bool staleForSignature = _queueIsStale;
                var signature = await System.Threading.Tasks.Task.Run(
                    () => ComputeQueueSignature(itemsForSignature, staleForSignature, persistedRestartItems));
                if (myGeneration != _refreshGeneration) return;
                if (signature != _lastQueueSignature)
                {
                    _lastQueueSignature = signature;
                    RenderQueue(_lastItems);
                    // Git #3336 — resolve each build set's real top Epic(s) from the local mirror
                    // BEFORE rendering, so the rollup below can nest under a real Epic header.
                    _buildSetEpics = await ResolveBuildSetEpicsAsync(_lastItems);
                    // Git #3866 — piggyback the "stay locked as new build sets appear" catch-up
                    // on this same real recompute, no new timer: any build set that now resolves
                    // to a currently-locked Epic and isn't already tracked gets marked Priority.
                    Services.EpicPriorityStore.ApplyLockedEpics(_buildSetEpics);
                    // Git #1834 — independent of _filter (the rollup summarizes the whole real
                    // queue, not just whatever status the combo/DAG is currently showing).
                    RenderBuildSetRollup(_lastItems);
                }
                // Git #3801 — only now, with a full pass genuinely completed against the data this
                // stamp describes, does it become the baseline the next poll tick may skip on. Null
                // here (probe failed, or no local DB) correctly forces that next tick to do the
                // full work rather than skip against a baseline that was never established.
                _lastQueueChangeStamp = changeStamp;
                UpdateQueueStatusCounts();
                UpdateOrphanRecoveryBanner();
                CappedCountChanged?.Invoke(this, _lastItems.Count(i => i.Status == Services.AccountCapPolicy.CappedStatus));
                SyncError?.Invoke(this, _queueIsStale
                    ? $"Build Queue: showing cached data from {_queueCachedAtUtc?.ToLocalTime():g} — dev server unreachable"
                    : null);
                // Git #3074 — per-issue-number `gh issue view` title warm-up is genuinely
                // GitHub-calling work; skip it on the local-only poll timer's tick.
                if (includeGitHubWork) TriggerBackgroundIssueTitleQueries();
                QueueRefreshed?.Invoke(this, EventArgs.Empty);
            }
            catch (Exception ex)
            {
                if (myGeneration != _refreshGeneration) return;
                QueueGraphContainer.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = $"Couldn't reach the API: {ex.Message}";
                QueueEmptyText.Visibility = Visibility.Visible;
                SyncError?.Invoke(this, $"Build Queue: {ex.Message}");
            }
        }

        // Git #3342 — the local done/failed/canceled terminal-status set that used to live here was
        // missing "superseded", which is exactly why the "Build Only This Set" auto-clear below never
        // fired for a set with a superseded member (silently starving the whole queue). Both auto-clear
        // checks now call the single canonical BuildQueuePostgresClient.IsTerminalStatus (which #3342
        // corrected to include superseded), so this definition can never drift from the dispatch gate's
        // again.

        /// <summary>
        /// Git #1636 — the moment every build currently belonging to a Priority-marked build set
        /// has reached a terminal state (done/failed/canceled) for the first time, fires
        /// <see cref="BuildSetPriorityCompleted"/> exactly once and auto-clears that set's
        /// priority flag (a finished wait doesn't need to keep waiting — re-marking is required
        /// for the next wave, per the issue's own stated assumption).
        ///
        /// Deliberately walks the FULL <paramref name="items"/> list from RefreshAsync — not the
        /// filtered list RenderQueue's header loop groups into buildSetBuckets — because the
        /// default "Running" filter drops "done" items entirely; grouping off the filtered view
        /// would mean a finished priority set's bucket goes empty and this would never fire while
        /// Shane is looking at the normal Running tab.
        /// </summary>
        private void CheckPriorityBuildSetCompletion(List<QueueItem> items)
        {
            var prioritySets = Services.BuildSetPriorityStore.AllPrioritySets;
            if (prioritySets.Count == 0) return;

            foreach (var setName in prioritySets)
            {
                var members = items.Where(i => string.Equals((i.BuildSet ?? "").Trim(), setName, StringComparison.OrdinalIgnoreCase)).ToList();
                if (members.Count == 0) continue; // nothing currently known under this name — nothing to declare finished
                if (!members.All(i => Services.BuildQueuePostgresClient.IsTerminalStatus(i.Status))) continue;

                // Clear BEFORE raising: AllPrioritySets is re-read on every RefreshAsync tick, so
                // clearing first guarantees a concurrent/overlapping tick can't observe this set as
                // still-priority and fire a second toast for the same completion.
                Services.BuildSetPriorityStore.SetPriority(setName, false);
                ActivityLog.Log("build-queue-panel.priority",
                    $"Priority build set \"{setName}\" — all {members.Count} member(s) reached a terminal state ({string.Join(", ", members.Select(m => m.Status).Distinct())}). Firing completion notification and auto-clearing priority.");
                BuildSetPriorityCompleted?.Invoke(this, new BuildSetPriorityCompletedEventArgs(setName, members));
            }
        }

        /// <summary>
        /// "Build Only This Set" auto-clear — the moment every build currently belonging to
        /// the exclusive build set has reached a terminal state (done/failed/canceled), lifts
        /// the hold so the queue resumes normal dispatch on its own. Mirrors
        /// <see cref="CheckPriorityBuildSetCompletion"/> exactly, including walking the FULL
        /// <paramref name="items"/> list (not the filtered/grouped view) for the same reason:
        /// the default "Running" filter drops "done" items, so grouping off the filtered view
        /// would mean a finished exclusive set's bucket goes empty and this would never fire.
        /// </summary>
        private void CheckExclusiveBuildSetCompletion(List<QueueItem> items)
        {
            var setName = Services.BuildSetExclusiveStore.ActiveSet;
            if (setName == null) return;

            var members = items.Where(i => string.Equals((i.BuildSet ?? "").Trim(), setName, StringComparison.OrdinalIgnoreCase)).ToList();
            if (members.Count == 0) return; // nothing currently known under this name — nothing to declare finished
            if (!members.All(i => Services.BuildQueuePostgresClient.IsTerminalStatus(i.Status))) return;

            Services.BuildSetExclusiveStore.Clear();
            ActivityLog.Log("build-queue-panel.exclusive",
                $"Exclusive build set \"{setName}\" — all {members.Count} member(s) reached a terminal state ({string.Join(", ", members.Select(m => m.Status).Distinct())}). Auto-clearing exclusive mode; queue resumes normal dispatch.");
            RenderQueue(_lastItems);
        }

        /// <summary>
        /// Crash/orphan recovery — shows/hides the bulk "Recover All" banner based on
        /// how many rows the startup sweep (RecoverOrphanedRunningItemsAsync) marked
        /// failed with the orphan sentinel exit code -2. Called after every RefreshAsync.
        /// </summary>
        private void UpdateOrphanRecoveryBanner()
        {
            if (OrphanRecoveryBanner == null) return;
            int count = _lastItems.Count(IsCrashed);
            if (count == 0)
            {
                OrphanRecoveryBanner.Visibility = Visibility.Collapsed;
                return;
            }
            int resumable = _lastItems.Count(i => IsCrashed(i) && !string.IsNullOrEmpty(i.SessionId));
            OrphanRecoveryText.Text = $"{count} build{(count == 1 ? "" : "s")} orphaned by a crash/restart" +
                (resumable > 0 ? $" ({resumable} resumable)" : "");
            OrphanRecoveryBanner.Visibility = Visibility.Visible;
        }

        /// <summary>
        /// Recovers every currently-orphaned queue item in one click: Resume Session
        /// (--resume, picks up mid-conversation) for any with a captured session id,
        /// plain Retry (restart the original prompt) for the rest. Mirrors exactly what
        /// the per-item "Resume Session"/"Retry" menu actions do, just for all of them
        /// at once — the actual ask behind this feature: Shane's video-driver hard
        /// crash left a whole batch of builds stuck, and recovering them one right-click
        /// at a time was its own separate mess.
        /// </summary>
        private async void BtnRecoverOrphans_Click(object sender, RoutedEventArgs e)
            => await RecoverOrphanedBuildsAsync();

        // Git #3575 — BtnBoardReconcile_Click (and StaleStateReconcileWindow) removed.
        // Git #3573 — BtnRecoverSessionLimit_Click removed: SessionLimitAutoRestartService
        // now runs the exact same ManualRecoverFromLogsAsync sweep automatically on a
        // periodic timer (see its StartPeriodicSweep), so the manual "Recover
        // Session-Limit Builds" button is redundant.

        /// <summary>
        /// <summary>
        /// Git #3826 — same real recovery as <see cref="RecoverOrphanedBuildsAsync"/>, but
        /// returns the real, honest outcome text instead of only toasting it, so the command
        /// palette's own right pane can show the actual result (Git #3826) rather than the
        /// toast being the only place it ever appears.
        /// </summary>
        public async System.Threading.Tasks.Task<string> RecoverOrphanedBuildsWithResultAsync()
        {
            if (_db == null)
            {
                const string msg = "The build-queue database isn't connected, so nothing can be recovered.";
                ToastEngine.Warning("Recover Builds", msg);
                return msg;
            }
            var orphaned = _lastItems.Where(IsCrashed).ToList();
            if (orphaned.Count == 0)
            {
                const string msg = "No crashed/orphaned builds to recover.";
                ToastEngine.Info("Recover Builds", msg);
                return msg;
            }

            BtnRecoverOrphans.IsEnabled = false;
            int resumed = 0, retried = 0, failed = 0;
            var failures = new List<string>();
            try
            {
                foreach (var item in orphaned)
                {
                    try
                    {
                        var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                        string? resumeSessionId = string.IsNullOrEmpty(item.SessionId) ? null : item.SessionId;
                        var recovered = await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, resumeSessionId, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                        await _db.MarkOrphanSupersededByResumeAsync(item.Id, recovered.Id);
                        if (resumeSessionId != null) resumed++; else retried++;
                    }
                    catch (Exception ex)
                    {
                        failed++;
                        string line = $"couldn't re-queue orphaned item #{item.Id} ({item.Title}): {ex.Message}";
                        failures.Add(line);
                        ActivityLog.Log("build-queue", $"Recover All: {line}");
                    }
                }
            }
            finally
            {
                BtnRecoverOrphans.IsEnabled = true;
            }

            string summary = $"{resumed} resumed, {retried} restarted" + (failed > 0 ? $", {failed} failed" : "");
            if (failed > 0) ToastEngine.Warning("Recovered Builds", summary);
            else ToastEngine.Success("Recovered Builds", summary);
            ActivityLog.Log("build-queue", $"Recover All: {summary} (of {orphaned.Count} orphaned).");
            await RefreshAsync();

            return failures.Count == 0 ? summary : summary + "\n" + string.Join("\n", failures);
        }

        /// <summary>
        /// Re-queues every crashed/orphaned build (failed rows carrying the orphan
        /// sweep's -2 sentinel). Public because the Ctrl+K command palette's
        /// "Recover Builds" quick action (Git #3622) runs this same real recovery;
        /// unlike the banner button (only visible when orphans exist), the palette
        /// path can be invoked with nothing to recover, so that case reports
        /// honestly instead of silently no-oping.
        /// </summary>
        public async System.Threading.Tasks.Task RecoverOrphanedBuildsAsync()
            => await RecoverOrphanedBuildsWithResultAsync();

        // Git #3575 — BtnBoardReconcile_Click (and StaleStateReconcileWindow) removed.
        // Git #3573 — BtnRecoverSessionLimit_Click removed: SessionLimitAutoRestartService
        // now runs the exact same ManualRecoverFromLogsAsync sweep automatically on a
        // periodic timer (see its StartPeriodicSweep), so the manual "Recover
        // Session-Limit Builds" button is redundant.

        /// <summary>
        /// Right-click "Mark All Recovered (Dismiss)" — for when Shane doesn't want to
        /// re-queue anything for a given orphaned batch, just wants the warning gone.
        /// Marks each one done (exit 0) via the same MarkCompleteAsync the per-item
        /// "Mark Complete (Hide)" action uses, which is what actually clears the banner
        /// (UpdateOrphanRecoveryBanner counts by ExitCode == -2, not by the hidden-id
        /// set) — a genuine "yes, I've handled this" rather than only hiding it.
        /// </summary>
        private async void DismissAllOrphans_Click(object sender, RoutedEventArgs e)
        {
            if (_db == null) return;
            var orphaned = _lastItems.Where(IsCrashed).ToList();
            if (orphaned.Count == 0) return;

            int dismissed = 0, failed = 0;
            foreach (var item in orphaned)
            {
                try
                {
                    await _db.MarkCompleteAsync(item.Id, 0);
                    _manuallyHiddenQueueIds.Add(item.Id);
                    dismissed++;
                }
                catch (Exception ex)
                {
                    failed++;
                    ActivityLog.Log("build-queue", $"Dismiss All Orphans: couldn't mark #{item.Id} ({item.Title}) recovered: {ex.Message}");
                }
            }

            string summary = $"{dismissed} marked recovered" + (failed > 0 ? $", {failed} failed" : "");
            if (failed > 0) ToastEngine.Warning("Marked Recovered", summary);
            else ToastEngine.Success("Marked Recovered", summary);
            ActivityLog.Log("build-queue", $"Dismiss All Orphans: {summary} (of {orphaned.Count}).");
            await RefreshAsync();
        }

        // ── Queue status counts + next-to-run dropdown (Git #1862) ────────────────
        // Replaces the old token/cost badge (which flipped between a context-window
        // ESTIMATE and a real spend total under one label — see #1862 for why it was
        // unfixable). The persisted usage history it used to show now lives in the
        // title bar (#1864); UsageTrackingService is deliberately left untouched here.

        /// <summary>Git #1862 — the same blocker cleanup RenderQueue's node loop applies:
        /// drop the sentinel 0 and any self-reference.</summary>
        private static List<int> CleanBlockers(QueueItem item)
        {
            var raw = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue
                ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            return raw.Where(b => b != 0 && b != item.GithubNumber).ToList();
        }

        /// <summary>
        /// Git #1862 — is this item genuinely blocked RIGHT NOW? Blocked means it
        /// declares a blocker the live open-issue set (<see cref="_openIssues"/>) reports
        /// still OPEN — not merely that it declares one (the old heuristic, which painted
        /// 🔒 BLOCKED on items whose blocker closed days ago). Until that set arrives
        /// (_openIssues == null, cold start) blocked-ness is UNKNOWN, so we fail safe to
        /// the old declared-blocker behaviour rather than assert a confident "runnable".
        ///
        /// Git #3624 previously gated this to a fixed set of raw statuses (queued,
        /// Verifying, self-blocked canceled/WAITING). Git #3626 removes that gate
        /// entirely, per Shane's explicit real widening: a genuine, currently-open
        /// `blocked_by` edge must surface regardless of the item's own raw status —
        /// nothing about a real blocking relationship is ever hidden behind a status
        /// check. The only thing that actually stops a row from reading BLOCKED now is
        /// real data: no declared blockers, or the declared blocker(s) are no longer in
        /// the live open-issue set.
        /// </summary>
        private bool IsGenuinelyBlocked(QueueItem item, List<int> cleanBlockers)
        {
            if (cleanBlockers.Count == 0) return false;
            if (_openIssues == null) return true; // cold start: provisional-blocked
            return cleanBlockers.Any(b => _openIssues.Contains(b));
        }

        /// <summary>
        /// Git #1862 — forwarded by MainWindow off every Git Board refresh (the same free
        /// open-issue fetch Build Watch already consumes; NO new `gh` call, no new poll).
        /// Stores the set so both the four header counts and the DAG's 🔒 BLOCKED read the
        /// live truth, then redraws so a blocker that just closed drops its lock immediately
        /// instead of waiting for the panel's own 15s poll.
        /// </summary>
        public void ApplyOpenIssueSet(HashSet<int> open)
        {
            if (open == null || open.Count == 0) return; // empty == "couldn't determine", not "all closed"
            _openIssues = open;
            _openIssuesRefreshedUtc = DateTime.UtcNow;
            UpdateQueueStatusCounts();
            try { if (QueueGraphContainer != null) RenderQueue(_lastItems); } catch { }
        }

        /// <summary>Git #3700 — fed by MainWindow's AskShaneMonitorService poll (mirror-driven, no
        /// new GitHub cost of its own here). An empty set IS meaningful here (unlike
        /// <see cref="ApplyOpenIssueSet"/>'s "empty == couldn't determine" guard) — zero items
        /// genuinely in "Ask Shane" is a real, common state, and a card's 🏷 label must clear the
        /// moment its item leaves that status, not stay stuck on a stale non-empty set.</summary>
        public void ApplyAskShaneSet(HashSet<int> askShaneNumbers)
        {
            _askShaneNumbers = askShaneNumbers ?? new HashSet<int>();
            try { if (QueueGraphContainer != null) RenderQueue(_lastItems); } catch { }
        }

        /// <summary>
        /// Git #2107 — confirmed root cause: <see cref="_openIssues"/> is only ever populated by
        /// <see cref="ApplyOpenIssueSet"/>, fed exclusively by Git Board's own manual/tab-open
        /// GitHub fetch (<c>LeftSidebar.GitBoardOpenIssuesRefreshed</c>) — so the 🔒 BLOCKED badge
        /// itself, not just the "waiting on" text #2070 already fixed, can sit stale for an entire
        /// session unless Shane happens to open the Issues tab or click manual refresh. Real
        /// evidence in the issue: #1582 and #2105 both showed 🔒 BLOCKED long after their real
        /// blocker had closed.
        ///
        /// Reintroducing periodic GitHub polling would directly reverse the 2026-08-14
        /// manual-only decision (background polling was killing Shane's git connections — see
        /// memory note buildconsole-github-manual-only-refresh), so this is deliberately
        /// event-triggered instead (the issue's own suggested option 3): a queue item just
        /// transitioning into Verifying or a terminal status is exactly the moment a declared
        /// blocker is most likely to have just closed. On that real transition — never on a
        /// timer — fire ONE lightweight one-shot `gh issue list` call, the same mechanism
        /// BuildWatchWindow's manual "Recheck closures" button already uses
        /// (<see cref="GitHubIssuesService.GetOpenIssueNumbersAsync"/>), not a new poll loop.
        /// </summary>
        private async System.Threading.Tasks.Task AutoRecheckOpenIssuesOnTransitionAsync(List<QueueItem> previous, List<QueueItem> current)
        {
            if (_autoRecheckInFlight) return;

            var previousStatusById = previous.ToDictionary(i => i.Id, i => i.Status);
            bool justTransitioned(QueueItem item) =>
                (item.Status == BuildQueuePostgresClient.VerifyingStatus || item.Status == "done") &&
                (!previousStatusById.TryGetValue(item.Id, out var oldStatus) || oldStatus != item.Status);
            if (!current.Any(justTransitioned)) return;

            _autoRecheckInFlight = true;
            try
            {
                var open = await GitHubIssuesService.GetOpenIssueNumbersAsync(1000);
                if (open.Count == 0) return; // "couldn't determine" — same fail-safe every other consumer uses
                ActivityLog.Log("github",
                    "Build Queue: auto-recheck open issues (Git #2107) — a queue item just transitioned to Verifying/Done, one-shot `gh` call, not a poll.");
                ApplyOpenIssueSet(open);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("github", $"Build Queue auto-recheck FAILED (will retry on the next transition): {ex.Message}");
            }
            finally
            {
                _autoRecheckInFlight = false;
            }
        }

        /// <summary>Git #3864 — the exact rendered text/foreground-key/tooltip
        /// <see cref="UpdateQueueStatusCounts"/> just applied to this panel's own
        /// <see cref="QueueStatusCountsText"/>, carried verbatim to any mirror (e.g. MainWindow's
        /// global status bar) via <see cref="QueueStatusCountsChanged"/> so it can never drift
        /// from the panel's own real display.</summary>
        public readonly struct QueueStatusCountsDisplay
        {
            public string Text { get; init; }
            public bool Provisional { get; init; }
            public string ToolTip { get; init; }
        }

        /// <summary>Git #1862 — the four reconciled buckets shown in the QUEUE header.</summary>
        private readonly struct QueueStatusCounts
        {
            public int InQueue { get; init; }   // queued + limit-paused
            public int Blocked { get; init; }   // non-paused queued with a blocker GitHub reports open
            public int UpNext { get; init; }    // non-paused queued, all blockers closed (real claim candidates)
            public int Verifying { get; init; } // VerifyingStatus rows
            public int ManuallyPaused { get; init; } // queued rows in PausedBuildIds
            public int LimitPaused { get; init; }    // LimitPausedStatus rows
            public bool Provisional { get; init; }   // true on a cold start (no open-issue set yet)

            /// <summary>Git #3520 — every row that is genuinely active/in-progress right now:
            /// InQueue (queued + limit-paused) plus Verifying (a build that finished but whose
            /// GitHub issue hasn't closed yet — still real, active work, not a terminal state).
            /// #3519's live ground-truth query found 12 queued + 1 running + 31 verifying = 44
            /// real active rows while the header's only summable figure (InQueue) read 12 —
            /// Shane read that as "the total" and it silently dropped the 31 verifying rows.
            /// This is the one real total the header should show alongside the breakdown.</summary>
            public int Total => InQueue + Verifying;
        }

        /// <summary>
        /// Git #1862 — computes the four counts straight off <see cref="_lastItems"/> (the
        /// real queue) + <see cref="_openIssues"/> + PausedBuildIds. Among queued rows the
        /// buckets PARTITION with manually-paused taking precedence (paused rows are set
        /// aside exactly as GetNextAsync filters them out before the blocker check), so
        /// Blocked + UpNext + ManuallyPaused + LimitPaused == InQueue by construction — the
        /// reconciliation the badge must never violate. UpNext therefore equals GetNextAsync's
        /// own candidate set (not paused, every blocker closed).
        /// </summary>
        private QueueStatusCounts ComputeQueueStatusCounts()
        {
            var paused = BuildConsoleSettings.Load().PausedBuildIds;
            int blocked = 0, upNext = 0, manuallyPaused = 0, limitPaused = 0, verifying = 0, queued = 0;
            foreach (var item in _lastItems)
            {
                if (item.Status == BuildQueuePostgresClient.VerifyingStatus) { verifying++; continue; }
                if (item.Status == Services.SessionLimitAutoRestartService.LimitPausedStatus) { limitPaused++; continue; }
                if (item.Status != "queued") continue;

                queued++;
                if (paused.Contains(item.Id)) { manuallyPaused++; continue; }
                if (IsGenuinelyBlocked(item, CleanBlockers(item))) blocked++;
                else upNext++;
            }
            return new QueueStatusCounts
            {
                InQueue = queued + limitPaused,
                Blocked = blocked,
                UpNext = upNext,
                Verifying = verifying,
                ManuallyPaused = manuallyPaused,
                LimitPaused = limitPaused,
                Provisional = _openIssues == null && blocked > 0,
            };
        }

        /// <summary>
        /// Git #1862 / #3615 — refreshes the QUEUE header: a single unified readout in the order
        /// Queue → Up Next → Active → Blocked → Verifying → Total. Git #3848 — "Active" is sourced
        /// from RunningCount (the real, complete `_running.Count`, no Interactive filter), not
        /// GetActiveUsageSummary's ActiveBuildCount, which was built for interactive-only token/cost
        /// aggregation and silently excluded any real running non-interactive (batch) build. On a
        /// cold start, before the first Git Board refresh, the Blocked figure is provisional
        /// (computed from declared blockers alone) and is rendered muted with a "*" and an
        /// explanatory tooltip rather than as a confident number.
        /// </summary>
        public void UpdateQueueStatusCounts()
        {
            var c = ComputeQueueStatusCounts();
            var active = _watcher?.RunningCount ?? 0;

            string blockedText = c.Provisional ? $"{c.Blocked}*" : c.Blocked.ToString();
            QueueStatusCountsText.Text =
                $"Queue: {c.InQueue}  ·  Up Next: {c.UpNext}  ·  Active: {active}  ·  Blocked: {blockedText}  ·  Verifying: {c.Verifying}  ·  Total: {c.Total}";

            if (c.Provisional)
            {
                QueueStatusCountsText.Foreground = (Brush)Application.Current.FindResource("Subtext0Brush");
                QueueStatusBorder.ToolTip = "Blocked count is provisional — waiting for the first Git Board refresh to confirm which blockers are still open. Click for the next builds to run.";
            }
            else
            {
                QueueStatusCountsText.Foreground = (Brush)Application.Current.FindResource("TextBrush");
                // Git #2107 — _openIssues (and therefore the 🔒 BLOCKED badge itself) is only as
                // fresh as the last Git Board refresh or auto-recheck; say so plainly rather than
                // implying it's live.
                string freshness = _openIssuesRefreshedUtc.HasValue
                    ? $"blockers last checked {FormatAgo(DateTime.UtcNow - _openIssuesRefreshedUtc.Value)}"
                    : "blockers not yet checked this session";
                QueueStatusBorder.ToolTip = $"Live queue status ({freshness}) — click for the next builds to run, in real claim order.";
            }

            if (QueueNextPopup?.IsOpen == true) _ = RenderNextToRunAsync();
            RenderMatrixDrawer();

            // Git #3864 — mirror this exact, already-computed string into the global status bar.
            QueueStatusCountsChanged?.Invoke(this, new QueueStatusCountsDisplay
            {
                Text = QueueStatusCountsText.Text,
                Provisional = c.Provisional,
                ToolTip = QueueStatusBorder.ToolTip as string ?? string.Empty,
            });
        }

        /// <summary>Git #2107 — human "2h ago" style relative time for the QUEUE header's
        /// blockers-last-checked tooltip. Same rounding convention as LeftSidebar.RelativeTime.</summary>
        private static string FormatAgo(TimeSpan span)
        {
            if (span.TotalSeconds < 45) return "just now";
            if (span.TotalMinutes < 60) return $"{Math.Max(1, (int)span.TotalMinutes)}m ago";
            if (span.TotalHours < 24) return $"{(int)span.TotalHours}h ago";
            return $"{(int)span.TotalDays}d ago";
        }

        private async void QueueStatusBorder_Click(object sender, MouseButtonEventArgs e) => await ToggleQueueStatusPopupAsync();

        /// <summary>Git #3864 — same next-to-run popup this panel's own QueueStatusBorder opens,
        /// exposed so MainWindow's mirrored global status bar segment can reuse it verbatim
        /// instead of duplicating the popup logic.</summary>
        public async Task ToggleQueueStatusPopupAsync()
        {
            QueueNextPopup.IsOpen = !QueueNextPopup.IsOpen;
            if (QueueNextPopup.IsOpen) await RenderNextToRunAsync();
        }

        // ══ Build Matrix — Git #3658. Real salvage of ShaneBuilder's own Build Matrix
        // (Git #2281/#2286/#2287, desktop/ShaneBuilder/MainWindow.BuildMatrixPanel.cs +
        // MainWindow.xaml.cs's _matrixSlotAssignments/RenderMatrixDrawer/MatrixSlotCard),
        // re-implemented against BuildConsole's own real concurrent-build tracking rather
        // than copy-pasted. Slot COUNT is QueueWatcherService.MaxConcurrent (the real
        // configured concurrency cap, default 8 — not hardcoded here). Slot OCCUPANCY is
        // QueueWatcherService.GetRunningBuildIds() — the real _running dictionary backing
        // GetActiveUsageSummary's "(N active)" readout (#3615) — joined against this
        // panel's own already-loaded _lastItems for display fields (title/build
        // set/model/status), the same "real queue list already shown" join ShaneBuilder's
        // own drawer did against _queueItems. No fixture data: with fewer than MaxConcurrent
        // real builds running, idle slots render honestly as idle.

        // Git #3699 — real, immediate safety measure requested by Shane: fully disconnect
        // Build Matrix for now (chip hidden in XAML above, polling/rebuild inert here) while
        // #3698's real, larger RenderQueue animation leak gets fixed, regardless of #3689
        // already having fixed Build Matrix's own leak. NOT a retirement — KeyedSlotCardHost,
        // MatrixSlotCard and the "Tab" send-to-document feature below are left intact. Flip
        // this back to false (and the XAML chip's Visibility back to Visible) to re-enable
        // once the app is confirmed stable again.
        private const bool BuildMatrixDisabled = true;

        private void BtnMatrixChip_Click(object sender, MouseButtonEventArgs e)
        {
            // Git #3825 — CS0162 here is real but not dead code: the compiler proves the code
            // below unreachable BECAUSE BuildMatrixDisabled is a const, but the flag is a
            // deliberate, temporary gate (see its own comment above) meant to flip back to
            // false once the app is confirmed stable — narrowly suppressed, not project-wide.
#pragma warning disable CS0162
            if (BuildMatrixDisabled) return;
            _matrixDrawerOpen = !_matrixDrawerOpen;
            RenderMatrixDrawer();
#pragma warning restore CS0162
        }

        private void RenderMatrixDrawer()
        {
            if (BuildMatrixDisabled)
            {
                if (MatrixDrawer != null) MatrixDrawer.Visibility = Visibility.Collapsed;
                return;
            }
            // Git #3825 — same BuildMatrixDisabled temporary-gate rationale as BtnMatrixChip_Click above.
#pragma warning disable CS0162
            if (MatrixDrawer == null || MatrixChipCount == null) return;
            MatrixDrawer.Visibility = _matrixDrawerOpen ? Visibility.Visible : Visibility.Collapsed;
            if (MatrixChipCaret != null)
                MatrixChipCaret.Text = _matrixDrawerOpen ? "" : ""; // Segoe MDL2 chevron up/down

            int slotCount = Math.Max(1, _watcher?.MaxConcurrent ?? 8);
            var runningIds = _watcher?.GetRunningBuildIds() ?? Array.Empty<int>();
            var runningSet = runningIds.ToHashSet();

            // Free any slot whose build is no longer in the real running set.
            foreach (var staleId in _matrixSlotAssignments.Keys.Where(id => !runningSet.Contains(id)).ToList())
                _matrixSlotAssignments.Remove(staleId);

            // Assign a free slot (lowest index first) to any running build that doesn't have one yet.
            foreach (var id in runningIds)
            {
                if (_matrixSlotAssignments.ContainsKey(id)) continue;
                var taken = _matrixSlotAssignments.Values.ToHashSet();
                for (int slot = 0; slot < slotCount; slot++)
                {
                    if (taken.Contains(slot)) continue;
                    _matrixSlotAssignments[id] = slot;
                    break;
                }
                // If every slot is already taken, this running build simply has no slot to
                // show yet — same "waiting for a slot" honesty ShaneBuilder's own comment
                // documented; it isn't rendered as a phantom 9th slot.
            }

            var idBySlot = _matrixSlotAssignments.ToDictionary(kv => kv.Value, kv => kv.Key);
            var itemsById = _lastItems.ToDictionary(i => i.Id, i => i);

            int occupied = Math.Min(_matrixSlotAssignments.Count, slotCount);
            MatrixSlotSummary.Text = $"{occupied}/{slotCount} slots";
            MatrixChipCount.Text = $"Build Matrix: {occupied}/{slotCount}";

            if (MatrixSlotsHost == null) return;
            _matrixSlotCards ??= new KeyedSlotCardHost(MatrixSlotsHost);
            if (!_matrixDrawerOpen)
            {
                // Git #3689 — collapsed: stop and drop the cards rather than leave up to
                // MaxConcurrent Forever pulse clocks ticking every frame behind a hidden drawer.
                // Re-renders on the next open.
                _matrixSlotCards.Retire();
                return;
            }

            // Git #3689 — this runs on every 5s local-poll tick (via UpdateQueueStatusCounts), and it
            // used to Children.Clear() and rebuild every card each time. Each busy card starts a
            // RepeatBehavior.Forever pulse that nothing ever stopped, so every tick with a busy slot
            // leaked more running animation clocks, without bound — the reported slowdown/crash.
            // Now a slot only gets a new card when what it displays changed, and the host stops the
            // old card's pulse before discarding it. An unchanged busy card keeps its pulse running
            // uninterrupted instead of restarting every tick.
            var slotItems = new QueueItem?[slotCount];
            var keys = new object[slotCount];
            for (int slot = 0; slot < slotCount; slot++)
            {
                slotItems[slot] = idBySlot.TryGetValue(slot, out var itemId) && itemsById.TryGetValue(itemId, out var found)
                    ? found : null;
                keys[slot] = MatrixSlotKey(slot, slotItems[slot]);
            }
            _matrixSlotCards.Reconcile(keys, slot => MatrixSlotCard(slot, slotItems[slot]));
#pragma warning restore CS0162
        }

        /// <summary>Git #3689 — everything <see cref="MatrixSlotCard"/> displays for a slot. Equal keys
        /// on two ticks mean an identical card, so the existing one (and its running pulse) is kept.</summary>
        private sealed record MatrixSlotCardKey(int Slot, int? ItemId, int? GithubNumber, string? Title, string? BuildSet, string? Model, string? Effort, string? Pill);

        private MatrixSlotCardKey MatrixSlotKey(int slotIndex, QueueItem? item) =>
            item == null
                ? new MatrixSlotCardKey(slotIndex, null, null, null, null, null, null, null)
                : new MatrixSlotCardKey(slotIndex, item.Id, item.GithubNumber, item.Title, item.BuildSet, item.Model, item.Effort, MatrixSlotStatusPill(item).Text);

        /// <summary>One slot card — slot number, status pill, real issue#/title, build set + model.
        /// Idle slots render dimmed with none of that, since there's nothing real to show. A busy
        /// slot pulses via a looping opacity animation and is clickable — <see cref="RevealQueueItem"/>
        /// (#3599's real cross-filter navigation) focuses that build in the queue below, exactly the
        /// same "focus the build" behavior ShaneBuilder's own MatrixSlotCard click handler had.</summary>
        private Border MatrixSlotCard(int slotIndex, QueueItem? item)
        {
            bool busy = item != null;
            string pillText = "";
            Color pillBg = default, pillBorder = default, pillFg = Color.FromRgb(0x6C, 0x70, 0x86);
            if (busy) (pillText, pillBg, pillBorder, pillFg) = MatrixSlotStatusPill(item!);
            var accent = pillFg;

            var card = new Border
            {
                Width = 150,
                Margin = new Thickness(0, 0, 6, 6),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Background = busy ? new SolidColorBrush(Color.FromArgb(0x1a, accent.R, accent.G, accent.B)) : (Brush)Application.Current.FindResource("Surface0Brush"),
                BorderBrush = busy ? new SolidColorBrush(Color.FromArgb(0x66, accent.R, accent.G, accent.B)) : (Brush)Application.Current.FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                Opacity = busy ? 1.0 : 0.45,
                Cursor = busy ? Cursors.Hand : Cursors.Arrow
            };

            var stack = new StackPanel();
            stack.Children.Add(new TextBlock
            {
                Text = $"SLOT {slotIndex + 1}",
                FontFamily = new FontFamily("Consolas"),
                FontSize = 9,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)Application.Current.FindResource("Subtext0Brush")
            });

            if (busy)
            {
                stack.Children.Add(BuildStatusPill(pillText, pillBg, pillBorder, pillFg));
                stack.Children.Add(new TextBlock
                {
                    Text = item!.GithubNumber.HasValue ? $"#{item.GithubNumber.Value} {item.Title}" : item.Title,
                    Margin = new Thickness(0, 4, 0, 0),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    FontSize = 10.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush")
                });
                string modelEffort = item.Model != null && item.Effort != null ? $"{item.Model} · {item.Effort}" : (item.Model ?? item.Effort ?? "");
                string subtitle = string.IsNullOrEmpty(modelEffort) ? (item.BuildSet ?? "") : (string.IsNullOrEmpty(item.BuildSet) ? modelEffort : $"{item.BuildSet} · {modelEffort}");
                if (!string.IsNullOrEmpty(subtitle))
                {
                    stack.Children.Add(new TextBlock
                    {
                        Text = subtitle,
                        Margin = new Thickness(0, 2, 0, 0),
                        TextTrimming = TextTrimming.CharacterEllipsis,
                        FontSize = 9,
                        Foreground = (Brush)Application.Current.FindResource("Subtext0Brush")
                    });
                }

                // Running slots pulse — a real looping opacity animation, not a static glow.
                // Git #3689 — started through the card host so its clock is actually stopped when
                // this card is replaced or the drawer collapses (BeginAnimation's clock can't be).
                var pulse = new DoubleAnimation
                {
                    From = 1.0,
                    To = 0.55,
                    Duration = new Duration(TimeSpan.FromSeconds(1.1)),
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever
                };
                KeyedSlotCardHost.BeginOwnedAnimation(card, UIElement.OpacityProperty, pulse);

                var focusId = item.Id;
                card.MouseLeftButtonDown += (s, e) => { e.Handled = true; RevealQueueItem(focusId); };
            }
            else
            {
                stack.Children.Add(new TextBlock
                {
                    Text = "Idle",
                    Margin = new Thickness(0, 4, 0, 0),
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush")
                });
            }

            card.Child = stack;
            return card;
        }

        /// <summary>Real per-slot status label/colors. Prefers the build's live interactive
        /// sub-state (Working/WaitingForInput/Stopped — the same three-state vocabulary
        /// GitDetailView's own chat-pane pill already uses: RUNNING/NEEDS INPUT/PAUSED) when this
        /// instance owns it; falls back to the DB row's own Status for a legacy/foreign/adopted
        /// running build with no live interactive state to read.</summary>
        private (string Text, Color Bg, Color Border, Color Fg) MatrixSlotStatusPill(QueueItem item)
        {
            var state = _watcher?.GetInteractiveState(item.Id);
            if (state == InteractiveInputState.WaitingForInput)
                return ("NEEDS INPUT", Color.FromRgb(0x3A, 0x35, 0x1C), Color.FromRgb(0xF9, 0xE2, 0xAF), Color.FromRgb(0xF9, 0xE2, 0xAF));
            if (state == InteractiveInputState.Stopped)
                return ("PAUSED", Color.FromRgb(0x3A, 0x28, 0x1C), Color.FromRgb(0xFA, 0xB3, 0x87), Color.FromRgb(0xFA, 0xB3, 0x87));
            return ("RUNNING", Color.FromRgb(0x1D, 0x2E, 0x45), Color.FromRgb(0x89, 0xB4, 0xFA), Color.FromRgb(0x89, 0xB4, 0xFA));
        }

        /// <summary>Git #3658 — plain frozen record types for the "Tab" snapshot (same shape
        /// ShaneBuilder's own BuildMatrixSlotSnapshot/BuildMatrixDocSnapshot used).</summary>
        private sealed record BuildMatrixSlotSnapshot(int Number, bool Busy, int? GithubNumber, string? Title, string? BuildSet, string? Model, string? Status);
        private sealed record BuildMatrixDocSnapshot(IReadOnlyList<BuildMatrixSlotSnapshot> Slots, int BusyCount, int SlotCount);

        /// <summary>Freezes the CURRENT real slot state — reads the same _matrixSlotAssignments/
        /// _lastItems the live drawer just rendered from, no second slot-assignment pass.</summary>
        private BuildMatrixDocSnapshot BuildMatrixSnapshotNow()
        {
            int slotCount = Math.Max(1, _watcher?.MaxConcurrent ?? 8);
            var idBySlot = _matrixSlotAssignments.ToDictionary(kv => kv.Value, kv => kv.Key);
            var itemsById = _lastItems.ToDictionary(i => i.Id, i => i);

            var slots = new List<BuildMatrixSlotSnapshot>(slotCount);
            for (int slot = 0; slot < slotCount; slot++)
            {
                QueueItem? item = idBySlot.TryGetValue(slot, out var itemId) && itemsById.TryGetValue(itemId, out var found)
                    ? found : null;
                slots.Add(new BuildMatrixSlotSnapshot(
                    slot + 1, item != null, item?.GithubNumber, item?.Title, item?.BuildSet, item?.Model,
                    item != null ? MatrixSlotStatusPill(item).Text : null));
            }
            return new BuildMatrixDocSnapshot(slots, slots.Count(s => s.Busy), slotCount);
        }

        /// <summary>"Tab" — sends a frozen, read-only snapshot of the current 8 slots to its own
        /// document tab, the same open-or-focus convention MainWindow's other document tabs
        /// (Batter Up, Settings) already use.</summary>
        private void BtnMatrixSendToTab_Click(object sender, RoutedEventArgs e)
        {
            var snapshot = BuildMatrixSnapshotNow();
            if (Application.Current.MainWindow is MainWindow mw)
                mw.OpenBuildMatrixTab(snapshot.Slots.Select(s => (s.Number, s.Busy, s.GithubNumber, s.Title, s.BuildSet, s.Model, s.Status)).ToList(), snapshot.BusyCount, snapshot.SlotCount);
        }

        /// <summary>
        /// Git #1862 — fills the dropdown with the next five builds the watcher would claim,
        /// in genuine claim order, via <see cref="BuildQueuePostgresClient.PeekNextAsync"/> —
        /// a strictly READ-ONLY peek that claims/mutates nothing and reuses the panel's own
        /// <see cref="_openIssues"/> set (no `gh` call). If that set hasn't arrived yet the
        /// peek reports so and we say it honestly instead of showing an order blockers might
        /// still reorder.
        /// </summary>
        private async Task RenderNextToRunAsync()
        {
            QueueNextHost.Children.Clear();

            if (_db == null)
            {
                QueueNextHost.Children.Add(MakeNextInfoText("Not connected to the queue database."));
                return;
            }

            BuildQueuePostgresClient.PeekResult peek;
            try
            {
                peek = await _db.PeekNextAsync(5, _openIssues);
            }
            catch (Exception ex)
            {
                QueueNextHost.Children.Add(MakeNextInfoText($"Couldn't read the queue: {ex.Message}"));
                return;
            }

            if (!peek.BlockerKnowledgeAvailable)
            {
                QueueNextHost.Children.Add(MakeNextInfoText(
                    "Waiting for the first Git Board refresh to confirm issue status before showing claim order."));
                return;
            }

            if (peek.Items.Count == 0)
            {
                QueueNextHost.Children.Add(MakeNextInfoText("Nothing ready to claim — the queue is empty or fully blocked/paused."));
                return;
            }

            int n = 1;
            foreach (var item in peek.Items)
            {
                QueueNextHost.Children.Add(MakeNextRow(n++, item));
            }
        }

        private TextBlock MakeNextInfoText(string text) => new()
        {
            Text = text,
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
            Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
            Margin = new Thickness(0, 2, 0, 2),
        };

        private FrameworkElement MakeNextRow(int ordinal, QueueItem item)
        {
            var row = new DockPanel { LastChildFill = true, Margin = new Thickness(0, 3, 0, 3) };

            var ord = new TextBlock
            {
                Text = $"{ordinal}.",
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                Width = 16,
                VerticalAlignment = VerticalAlignment.Top,
            };
            DockPanel.SetDock(ord, Dock.Left);
            row.Children.Add(ord);

            string refText = item.GithubNumber.HasValue ? FormatIssueRef(item.GithubNumber.Value) : $"#{item.Id}";
            var refBlock = new TextBlock
            {
                Text = refText,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("BlueBrush"),
                Width = 52,
                VerticalAlignment = VerticalAlignment.Top,
            };
            DockPanel.SetDock(refBlock, Dock.Left);
            row.Children.Add(refBlock);

            var stack = new StackPanel();
            stack.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(item.Title) ? "(untitled)" : item.Title.Trim(),
                FontSize = 11,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
            });
            if (!string.IsNullOrWhiteSpace(item.BuildSet))
            {
                // Git #3865 — the preview must show honestly WHY a row claims ahead of an
                // earlier-queued one: BuildSetPriorityStore.IsPriority now actually reorders
                // BuildQueuePostgresClient's real claim scan (SelectClaimCandidatesAsync), so a
                // priority-marked row waiting here is no longer a plain FIFO wait — it needs to
                // look different, not identical, to one.
                bool isPriority = BuildSetPriorityStore.IsPriority(item.BuildSet);
                stack.Children.Add(new TextBlock
                {
                    Text = isPriority ? $"set: {item.BuildSet.Trim()} ★ priority" : $"set: {item.BuildSet.Trim()}",
                    FontSize = 9.5,
                    FontWeight = isPriority ? FontWeights.SemiBold : FontWeights.Normal,
                    Foreground = (Brush)Application.Current.FindResource(isPriority ? "YellowBrush" : "Subtext0Brush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
            }
            row.Children.Add(stack);
            return row;
        }

        private List<QueueItem> ApplyFilter(List<QueueItem> items)
        {
            List<QueueItem> statusFiltered = _filter switch
            {
                // Git #3340 — Shane's real, explicit override of #1829's original combined-status
                // design: at real volume (8 running + 15 verifying at once) folding VerifyingStatus
                // into "Running" made it hard to quickly find genuinely-running builds. He already
                // has a standalone Verifying filter (#1927) for that case, so "Running" now means
                // exactly status == "running", full stop, no exceptions.
                "Running"  => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && i.Status is "running").ToList(),
                // Git #1829 — "Queued" = genuinely not executing right now: real queued rows plus
                // limit-paused (Git #1600 — same practical meaning as queued even though the DB
                // status string differs, waiting to resume later rather than in flight).
                // Git #3599 — a self-blocked "⏳ WAITING" row (supervisory cancel, exit 0) is a
                // real decision on this issue: still an active queue item that self-corrected
                // mid-run, not a dead/canceled one, so it belongs in the normal working filters
                // alongside Queued/RunningAndQueued, not tucked away exclusively under "All" or
                // the dedicated "Canceled" tab (see IsWaitingSelfBlocked).
                // Git #3611 — same treatment for a crashed row (IsCrashed) and a capped row
                // (AccountCapPolicy.CappedStatus): both are active things waiting on Shane, not
                // abandoned work, so removing their dedicated Crashed/Capped tabs means they need
                // to land here instead of disappearing except under "All".
                "Queued"   => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "queued" or Services.SessionLimitAutoRestartService.LimitPausedStatus or Services.AccountCapPolicy.CappedStatus || IsWaitingSelfBlocked(i) || IsCrashed(i))).ToList(),
                // Git #1894 — combined view added back as a third option alongside the split
                // Running/Queued (Git #1829), reusing that pre-#1829 combined "Active" criteria
                // verbatim: queued + running + LimitPausedStatus + VerifyingStatus.
                // Git #3599 — same WAITING inclusion as "Queued" above.
                // Git #3611 — same crashed/capped inclusion as "Queued" above.
                "RunningAndQueued" => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "queued" or "running" or Services.SessionLimitAutoRestartService.LimitPausedStatus or BuildQueuePostgresClient.VerifyingStatus or Services.AccountCapPolicy.CappedStatus || IsWaitingSelfBlocked(i) || IsCrashed(i))).ToList(),
                // Git #1927 — standalone Verifying filter: exactly status == VerifyingStatus,
                // distinct from "Running" above (which folds VerifyingStatus into its broader
                // "in motion" bucket) so a build that's done executing and just waiting on
                // real GitHub-issue verification (Git #1469) is findable on its own.
                "Verifying" => items.Where(i => i.Status == BuildQueuePostgresClient.VerifyingStatus && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #1638 — the Park staging area: a "parked" row is deliberately excluded from
                // Running/Queued above (the watcher's claim query never picks it up either — that's
                // the whole point of a staging spot), so it needs its own filter to be findable at all.
                "Parked"   => items.Where(i => i.Status == "parked" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #1638 — "Send to Builder" tracking rows: never claimable, never in the 8-slot
                // grid, but still real rows that should be findable rather than lost.
                "External" => items.Where(i => i.Status == "external" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                "Done"     => items.Where(i => i.Status == "done" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #3599 — exclusive to a GENUINE cancel now; a self-blocked "⏳ WAITING" row
                // (IsWaitingSelfBlocked) moved to the working filters above per the real decision
                // on this issue. Git #3607 — also excludes a row FalseDoneReconciler has soft-archived
                // (closed-issue or no-issue-at-all canceled rows); it stays a real row in the DB, just
                // out of this default view. Git #3611 adds the dedicated "Archive" filter right below
                // that surfaces exactly these via `i.Archived`.
                "Canceled" => items.Where(i => i.Status == "canceled" && !i.Archived && !IsWaitingSelfBlocked(i) && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #3611 — dedicated Archive filter: exactly the rows #3607's soft-archive
                // reconciler flagged (closed-issue or no-issue-at-all canceled rows). Previously
                // only reachable via "All"; this makes them directly findable.
                "Archive"  => items.Where(i => i.Archived && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                _          => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
            };

            // Git #1834 — build-set drill-down from the rollup summary. Composes with the
            // status filter above (AND, not override) and with the search box, which
            // filters this method's own result again inside RenderQueue.
            List<QueueItem> result = _buildSetFilter == null
                ? statusFiltered
                : statusFiltered.Where(i => string.Equals(NormalizeBuildSetKey(i.BuildSet), _buildSetFilter, StringComparison.OrdinalIgnoreCase)).ToList();

            // Git #3612 — cap applied LAST, after status + build-set narrowing, so a
            // build-set drill-down into Done (already small) is never capped away, and the
            // banner's total/shown counts always describe exactly what's about to render.
            if (_filter == "Done") result = ApplyDoneRecencyCap(result);
            return result;
        }

        /// <summary>Git #3612 — real fix for the confirmed full-app freeze: the "Done" filter had
        /// zero cap anywhere and rendered every historical done row synchronously on the UI
        /// thread in one pass. At real scale (1,894 real done rows in the queue DB as of this
        /// fix) that's thousands of full card + ghost-blocker-resolution builds in one tick.
        /// Caps to the <see cref="DoneFilterDefaultCap"/> most-recently-completed rows (by real
        /// <see cref="QueueItem.UpdatedAt"/> — the same "done {time}" timestamp already shown on
        /// the Completed tile — falling back to Id ordering for the rare row with no timestamp)
        /// unless <see cref="_showAllDone"/> was explicitly set via the banner's "Show all" link.
        /// Records the real total/shown counts RenderQueue's banner reports.</summary>
        private List<QueueItem> ApplyDoneRecencyCap(List<QueueItem> doneItems)
        {
            _doneFilterTotalCount = doneItems.Count;
            if (_showAllDone || doneItems.Count <= DoneFilterDefaultCap)
            {
                _doneFilterShownCount = doneItems.Count;
                return doneItems;
            }

            var capped = doneItems
                .OrderByDescending(i => i.UpdatedAt ?? DateTimeOffset.MinValue)
                .ThenByDescending(i => i.Id)
                .Take(DoneFilterDefaultCap)
                .ToList();
            _doneFilterShownCount = capped.Count;
            return capped;
        }

        /// <summary>Git #1834 — the rollup's bucket key for a QueueItem.BuildSet: a null/blank
        /// value (ungrouped) buckets under the literal "Ungrouped" name rather than being
        /// silently dropped from the rollup.</summary>
        private static string NormalizeBuildSetKey(string? buildSet) =>
            string.IsNullOrWhiteSpace(buildSet) ? UngroupedBuildSetKey : buildSet.Trim();

        /// <summary>Git #1920 — declare to <see cref="Services.BuildSetColorRegistry"/> which
        /// named build sets the queue is currently showing, so it can coordinate a
        /// collision-free accent color per set and free a color once its set drops out of the
        /// queue. "Active/visible" here matches the rollup: a set with any queued / running /
        /// verifying item. The "Ungrouped" pseudo-set is excluded — it draws in Subtext0, not a
        /// palette color, so it never competes for one.</summary>
        private static void ReportActiveBuildSets(List<QueueItem> items)
        {
            var active = items
                .Where(i => i.Status is "queued" or "running"
                             or Services.SessionLimitAutoRestartService.LimitPausedStatus
                             or BuildQueuePostgresClient.VerifyingStatus)
                .Select(i => i.BuildSet)
                .Where(bs => !string.IsNullOrWhiteSpace(bs))
                .Select(bs => bs!.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase);
            Services.BuildSetColorRegistry.ReportActive("queue", active);
        }

        public bool HasActiveQueueItems =>
            _lastItems.Any(i => i.Status is "queued" or "running");

        public IReadOnlyList<QueueItem> CurrentQueueItems => _lastItems;

        public void ReapplyFocusFilter()
        {
            try { if (QueueGraphContainer != null) RenderQueue(_lastItems); } catch { }
            try { RenderInFlightGrouped(_lastInFlightIssues); } catch { }
        }

        public void RevealQueueItem(int id)
        {
            var item = _lastItems.FirstOrDefault(i => i.Id == id);
            if (item == null) return;

            string targetFilter = item.Status switch
            {
                "running"              => "Running",
                // Git #3599 — Git #3340 hardened "Running" to mean exactly status == "running",
                // full stop; a Verifying item is no longer visible under it, so landing here still
                // has to target the real standalone "Verifying" filter or the reveal becomes
                // exactly the no-op-click failure this issue exists to close.
                BuildQueuePostgresClient.VerifyingStatus                                             => "Verifying",
                "queued" or Services.SessionLimitAutoRestartService.LimitPausedStatus                => "Queued",
                // Git #3599 — a self-blocked "⏳ WAITING" row (IsWaitingSelfBlocked) now lives in
                // the "Queued" filter bucket (see ApplyFilter), not "Canceled" — must match here or
                // revealing one would switch to a filter that doesn't actually show it.
                "canceled" when IsWaitingSelfBlocked(item)                                            => "Queued",
                // Git #3611 — Crashed/Capped no longer have dedicated tabs; both now render inside
                // the same "Queued" bucket ApplyFilter puts them in (via IsCrashed/CappedStatus).
                "failed" when IsCrashed(item)                                                         => "Queued",
                "parked"              => "Parked",
                Services.AccountCapPolicy.CappedStatus => "Queued",
                "external"            => "External",
                "done"                => "Done",
                // Git #3611 — an archived canceled row no longer shows under "Canceled" (ApplyFilter
                // excludes i.Archived there); reveal it under the real "Archive" filter instead.
                "canceled" when item.Archived                                                         => "Archive",
                "canceled"            => "Canceled",
                _                     => "All",
            };

            ComboBoxItem? match = null;
            if (QueueFilterCombo != null)
            {
                foreach (var obj in QueueFilterCombo.Items)
                    if (obj is ComboBoxItem ci && (ci.Tag as string) == targetFilter) { match = ci; break; }
            }
            if (match != null && !ReferenceEquals(QueueFilterCombo!.SelectedItem, match))
                QueueFilterCombo.SelectedItem = match;
            else
                _filter = targetFilter;

            if (QueueSearchBox != null && !string.IsNullOrEmpty(QueueSearchBox.Text))
                QueueSearchBox.Text = "";

            if (QueueGraphContainer != null)
                RenderQueue(_lastItems);

            var node = _currentGraphNodes.FirstOrDefault(n => n.Item?.Id == id);
            if (node != null)
            {
                SelectNode(node);
                node.CardElement?.BringIntoView();
            }
        }

        private void QueueFilterCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (QueueFilterCombo.SelectedItem is not ComboBoxItem selected) return;
            _filter = selected.Tag as string ?? "Running";
            // Git #3612 — a stale "show all" from a previous Done visit must never silently
            // carry over; each fresh visit to Done starts back at the safe capped default.
            if (_filter != "Done") _showAllDone = false;
            if (QueueGraphContainer == null) return;

            RenderQueue(_lastItems);
        }

        private string _queueSearch = "";

        // Git #2028 — Shane: even the #1833 debounce still fires mid-type (just delayed
        // until a settled pause). Real requirement is genuine submit-on-Enter — typing
        // "1234" does nothing until Enter is pressed, then it searches exactly once.
        // TextChanged only tracks the raw text (for the placeholder DataTrigger binding);
        // it never itself triggers ApplyFilter/RenderQueue.
        // Git #2680 — the ✕ clear button (Behaviors/SearchTextBoxBehavior.cs) just calls
        // TextBox.Clear(), which raises this handler like any other edit. Every other
        // SearchTextBox site re-filters live on TextChanged, so the shared clear button
        // "just works" there — but QueueSearchBox is deliberately Enter-only (#2028), and
        // without this special case the ✕ (and a manual select-all-delete) left the last
        // Enter-applied filter stuck on screen with an empty box. Only the transition TO
        // empty re-runs the filter immediately; any non-empty text still waits for Enter,
        // preserving #2028's real requirement untouched.
        private void QueueSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            var wasEmpty = string.IsNullOrEmpty(_queueSearch);
            _queueSearch = QueueSearchBox.Text ?? "";
            if (!wasEmpty && _queueSearch.Length == 0)
                RunQueueSearch();
        }

        private void QueueSearchBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter) return;
            RunQueueSearch();
            e.Handled = true;
        }

        /// <summary>Git #2680 — the one real "apply the queue search" path, shared by the
        /// Enter key (KeyDown above), the ✕/select-all-delete empty transition (TextChanged
        /// above), and a programmatic search from Dispatch (<see cref="SearchAndFocus"/>).
        /// Git #3613 — used to also fire <c>ShowBuildSetFilterWarning("Search")</c> (Git #2058)
        /// to explain that a real match while searching could be hidden by the active Build Set
        /// filter. RenderQueue now genuinely bypasses the status/build-set filter while
        /// <see cref="_queueSearch"/> is non-empty (see its own Git #3613 comment), so that class
        /// of "hidden by filter" search miss no longer exists — nothing left to warn about here.</summary>
        private void RunQueueSearch()
        {
            if (QueueGraphContainer == null) return;
            RenderQueue(_lastItems);
        }

        /// <summary>Git #2680 — called from MainWindow's DispatchPanel.Dispatched handler right
        /// alongside the existing RefreshAsync()/NotifyBuildDispatched() calls, so a manual
        /// Dispatch immediately filters the Queue down to the just-dispatched issue and brings
        /// its row into view — no retyping the number Shane just typed above. This is a
        /// programmatic trigger, not user typing, so running the search immediately (rather than
        /// waiting for Enter) does not violate #2028's Enter-only intent for typed input.</summary>
        public void SearchAndFocus(int issueNumber)
        {
            var text = issueNumber.ToString();
            QueueSearchBox.Text = text;
            _queueSearch = text;
            RunQueueSearch();
        }

        private DispatcherTimer? _buildSetFilterWarningTimer;

        /// <summary>Git #2058 — warns that a newly-dispatched build may have landed outside the
        /// currently-active Build Set filter view. Git #3613 removed this method's "Search"
        /// reason/trigger (that class of miss is now genuinely fixed in RenderQueue itself, not
        /// just explained), leaving this as the Dispatch-only warning it started as. No-op when
        /// no Build Set filter is active. Uses the Popup declared in the XAML
        /// (BuildSetFilterWarningPopup) rather than an inline Border, since a Popup renders in
        /// its own overlay layer and genuinely cannot bump/reflow the rest of the panel — the
        /// original issue's explicit requirement.</summary>
        private void ShowBuildSetFilterWarning()
        {
            if (_buildSetFilter == null || BuildSetFilterWarningPopup == null) return;

            BuildSetFilterWarningText.Text = $"New build landed outside the current filter — Build Set: {_buildSetFilter}";
            BuildSetFilterWarningPopup.IsOpen = true;

            _buildSetFilterWarningTimer?.Stop();
            _buildSetFilterWarningTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
            _buildSetFilterWarningTimer.Tick += (s, e) =>
            {
                _buildSetFilterWarningTimer?.Stop();
                BuildSetFilterWarningPopup.IsOpen = false;
            };
            _buildSetFilterWarningTimer.Start();
        }

        /// <summary>Git #2058 — MainWindow calls this after a successful dispatch (DispatchPanel's
        /// own <c>Dispatched</c> event, which only fires on success) so the sibling queue panel can
        /// warn if the item it just queued may be hidden by an active Build Set filter. Public
        /// because DispatchPanel is a separate sibling control with no knowledge of this panel's
        /// private filter state.</summary>
        public void NotifyBuildDispatched() => ShowBuildSetFilterWarning();

        private static List<QueueItem> SortForDisplay(IEnumerable<QueueItem> items) =>
            items
                .OrderByDescending(i => i.GithubNumber.HasValue)
                .ThenByDescending(i => i.GithubNumber ?? 0)
                .ThenByDescending(i => i.Id)
                .ToList();

        // Local (--notGit) builds are stored as a negative github_number; render them by
        // their LETTER id (local #A, local #AB) so they can never be read as a GitHub number.
        private static string FormatIssueRef(int n) => BuildConsole.Services.LocalBuildId.FormatRef(n);

        /// <summary>
        /// Reorders nodes (already in SortForDisplay's preferred order) so every
        /// blocker renders BEFORE its dependents, with each node's direct dependents
        /// placed immediately after it (a DFS, not a plain topological sort) — the
        /// "nested under whatever blocks it" shape Shane described. A node blocked by
        /// several present keys nests under the first one it lists; the rest still get
        /// real connector lines drawn to them (RedrawQueueGraph iterates ALL of
        /// BlockedBy, not just the one used for placement). Root-level items (no
        /// blocker present in this set) keep SortForDisplay's relative order, forming
        /// the trunk sequence. Guards against a blocking cycle (shouldn't happen, but
        /// two items can't be relied on to never reference each other) by tracking
        /// visited keys and appending any leftover nodes rather than recursing forever.
        /// </summary>
        private static List<QueueGraphNode> OrderByDependency(List<QueueGraphNode> nodesInPreferredOrder)
        {
            var byKey = new Dictionary<int, QueueGraphNode>();
            foreach (var n in nodesInPreferredOrder) byKey.TryAdd(n.Key, n);

            var childrenOf = new Dictionary<int, List<QueueGraphNode>>();
            var hasParent = new HashSet<int>();
            foreach (var n in nodesInPreferredOrder)
            {
                int? parentKey = null;
                foreach (var b in n.BlockedBy) { if (byKey.ContainsKey(b)) { parentKey = b; break; } }
                if (parentKey == null) continue;
                hasParent.Add(n.Key);
                if (!childrenOf.TryGetValue(parentKey.Value, out var kids)) { kids = new List<QueueGraphNode>(); childrenOf[parentKey.Value] = kids; }
                kids.Add(n);
            }

            var visited = new HashSet<int>();
            var ordered = new List<QueueGraphNode>();
            void Visit(QueueGraphNode node)
            {
                if (!visited.Add(node.Key)) return;
                ordered.Add(node);
                if (childrenOf.TryGetValue(node.Key, out var kids))
                    foreach (var kid in kids) Visit(kid);
            }

            foreach (var n in nodesInPreferredOrder)
                if (!hasParent.Contains(n.Key)) Visit(n);
            foreach (var n in nodesInPreferredOrder) // cycle safety net — shouldn't fire in practice
                if (!visited.Contains(n.Key)) Visit(n);

            return ordered;
        }

        /// <summary>Git #3599 — the per-item <see cref="QueueGraphNode"/> shape, extracted out of
        /// <see cref="RenderQueue"/>'s build loop so it can also be used to resolve a blocker's
        /// live node against the full, unfiltered queue (<see cref="_lastItems"/>) rather than
        /// only whatever the currently-active status filter happened to render into
        /// <see cref="_currentGraphNodes"/>. Behavior is unchanged for the RenderQueue call site.</summary>
        private QueueGraphNode BuildItemNode(QueueItem item)
        {
            var interactiveState = _watcher?.GetInteractiveState(item.Id);
            bool isWaitingForInput = interactiveState == InteractiveInputState.WaitingForInput;
            var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            var cleanBlockers = blockerList.Where(b => b != 0 && b != item.GithubNumber).ToList();

            return new QueueGraphNode
            {
                Key = item.GithubNumber ?? item.Id,
                DisplayRef = item.GithubNumber.HasValue ? FormatIssueRef(item.GithubNumber.Value) : $"#{item.Id}",
                Title = item.Title,
                Status = item.Status,
                // Git #1862 — blocked means a declared blocker GitHub reports OPEN, not
                // merely one declared (the old heuristic left 🔒 BLOCKED on items whose
                // blocker closed days ago). Cold start (no open-issue set yet) falls back
                // to declared-blocker behaviour, matching the header's provisional count.
                IsBlocked = IsGenuinelyBlocked(item, cleanBlockers),
                IsWaitingForInput = isWaitingForInput,
                // Git #3700 — real board Status membership, not gated on this item's own raw
                // queue status (mirrors #3626's IsBlocked no-gating).
                IsAskingShane = item.GithubNumber.HasValue && (_askShaneNumbers?.Contains(item.GithubNumber.Value) ?? false),
                BlockedBy = cleanBlockers,
                Item = item,
                BuildSet = string.IsNullOrWhiteSpace(item.BuildSet) ? null : item.BuildSet.Trim()
            };
        }

        /// <summary>Git #3521/#3599 — a supervisory self-cancel (a session wired a real
        /// blocked_by edge onto its own issue and exited cleanly, exit code 0): rendered
        /// "⏳ WAITING", not the terminal "🚫 CANCELED" a genuine failed/aborted cancel gets.
        /// Single source of truth for that distinction so the card pill (<see cref="GhostStatusLabel"/>,
        /// the graph dot, <see cref="ApplyFilter"/>'s filter buckets, and <see cref="RevealQueueItem"/>'s
        /// navigation target can never disagree about which bucket a given row falls in.</summary>
        private static bool IsWaitingSelfBlocked(QueueItem item) => item.Status == "canceled" && item.ExitCode == 0;

        /// <summary>Git #1877/#3611 — the orphaned-by-crash set: same criteria
        /// UpdateOrphanRecoveryBanner/BtnRecoverOrphans_Click already use (status=="failed" &&
        /// ExitCode==-2). Single source of truth so <see cref="ApplyFilter"/>'s Queued/
        /// RunningAndQueued buckets, <see cref="RevealQueueItem"/>'s navigation target, and
        /// <see cref="BuildQueueCard"/>'s CRASHED pill can never disagree about which rows are
        /// crashed (Git #3611 removed the dedicated "Crashed" tab that used to be the one place
        /// this criteria lived).</summary>
        private static bool IsCrashed(QueueItem item) => item.Status == "failed" && item.ExitCode == -2;

        /// <summary>Git #3599 — resolves a declared blocker's live queue node against the FULL,
        /// unfiltered queue, not just whatever the currently-active status filter rendered into
        /// <see cref="_currentGraphNodes"/>. Previously a blocker sitting under a different filter
        /// (e.g. viewing "Queued" while the real blocker is "Verifying") came back null here, so
        /// its ghost card rendered as non-clickable — "Open on GitHub — not itself a build in this
        /// queue" — even though it genuinely IS a build in this queue, just filtered out of the
        /// current view. Fast path still prefers an already-rendered node (real CardElement, no
        /// rebuild); only falls through to <see cref="_lastItems"/> when nothing currently on
        /// screen matches.</summary>
        private QueueGraphNode? FindLiveNodeForBlocker(int blockerNumber)
        {
            var visible = _currentGraphNodes.FirstOrDefault(n => n.Key == blockerNumber && (n.Item != null || n.RestartItem != null));
            if (visible != null) return visible;

            var item = _lastItems.FirstOrDefault(i => (i.GithubNumber ?? i.Id) == blockerNumber);
            return item != null ? BuildItemNode(item) : null;
        }

        /// <summary>Git #3612 — shows/hides and words the done-cap banner from the real
        /// counts <see cref="ApplyDoneRecencyCap"/> recorded on the ApplyFilter call that fed
        /// the items RenderQueue is about to draw. Only relevant to the "Done" filter; hidden
        /// for every other filter, and hidden for "Done" too once the total no longer exceeds
        /// the cap (nothing to expand). Also hidden while a search is active — Git #3613 has
        /// an active search bypass ApplyFilter entirely, so _doneFilterTotalCount/ShownCount
        /// would otherwise be stale leftovers from the last non-search render.</summary>
        private void UpdateDoneCapBanner(bool searching)
        {
            if (searching || _filter != "Done" || _doneFilterTotalCount <= DoneFilterDefaultCap)
            {
                QueueDoneCapBanner.Visibility = Visibility.Collapsed;
                return;
            }

            QueueDoneCapBanner.Visibility = Visibility.Visible;
            if (_showAllDone)
            {
                QueueDoneCapText.Text = $"Showing all {_doneFilterTotalCount:N0} done builds.";
                QueueDoneCapToggleLink.Text = "Show recent only";
            }
            else
            {
                QueueDoneCapText.Text = $"Showing the {_doneFilterShownCount:N0} most recently completed of {_doneFilterTotalCount:N0} done builds.";
                QueueDoneCapToggleLink.Text = "Show all (may be slow)";
            }
        }

        private void QueueDoneCapToggleLink_Click(object sender, MouseButtonEventArgs e)
        {
            _showAllDone = !_showAllDone;
            // Git #3613 changed RenderQueue's contract to take the RAW _lastItems and run
            // ApplyFilter internally — every call site passes _lastItems directly now, this
            // one included. Passing an already-ApplyFilter'd list here double-applies the
            // Done cap (ApplyDoneRecencyCap would run twice, the second time over an
            // already-capped 150-item list, silently corrupting _doneFilterTotalCount).
            RenderQueue(_lastItems);
        }

        // ══════════════════════════════════════════════════════════════════════════
        // ── Visual Queue DAG with Canvas-Based Connectors (#860 Reference) ────────
        // ══════════════════════════════════════════════════════════════════════════

        // Git #3613 — takes the RAW, unfiltered queue (_lastItems) now, not a pre-narrowed
        // ApplyFilter(_lastItems) result — the status/build-set narrowing decision moved
        // inside this method (below) so it can be bypassed while a search is active. Every
        // call site was updated to pass _lastItems directly; see the block just below.
        private void RenderQueue(List<QueueItem> rawItems)
        {
            var search = _queueSearch.Trim();
            bool searching = search.Length > 0;

            // Git #3613 — while a search is active, bypass the status filter (_filter) and
            // the build-set filter (_buildSetFilter) entirely: search against the full raw
            // set, only excluding manually-hidden ids (a deliberate Shane-initiated hide, not
            // a status filter) rather than ApplyFilter's status/build-set-narrowed subset. A
            // real match outside the active filter can now actually be found. This replaces
            // the old ShowBuildSetFilterWarning band-aid (Git #2058) for the search trigger —
            // a real match just shows now instead of requiring an explanatory toast about why
            // it doesn't. Neither _filter nor _buildSetFilter's own stored value/dropdown
            // selection is touched here, so clearing the search falls back to the ApplyFilter
            // branch below and naturally restores exactly the view that was active before.
            List<QueueItem> items = search.Length > 0
                ? rawItems.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id)).ToList()
                : ApplyFilter(rawItems);

            // Git #1833 — the broad "All" view (default ApplyFilter case) with an empty
            // search box matches hundreds of items nobody scrolls through; Shane always
            // searches by number directly instead. Skip the whole swimlane/DAG + card
            // build for that specific case and show a placeholder instead. The already-
            // narrow filters (Running/Queued/Parked/etc.) are untouched — they keep
            // rendering their own (small) contents normally with empty search.
            bool isBroadUnsearchedView = !searching && _filter == "All" && _buildSetFilter == null;
            if (isBroadUnsearchedView)
            {
                QueueGraphContainer.Visibility = Visibility.Collapsed;
                // Git #3698 — stop every pooled card's Forever mascot clocks, then drop them.
                _queueCards.RetireAll();
                QueueCardsHost.Children.Clear();
                QueueGraphCanvas.Children.Clear();
                _currentGraphNodes.Clear();
                QueueEmptyText.Visibility = Visibility.Collapsed;
                QueueBroadFilterPlaceholderText.Visibility = Visibility.Visible;
                UpdateCritterLoungeVisibility();
                return;
            }
            QueueBroadFilterPlaceholderText.Visibility = Visibility.Collapsed;
            UpdateDoneCapBanner(searching);

            if (searching)
            {
                items = items
                    .Where(i => i.GithubNumber.HasValue &&
                                i.GithubNumber.Value.ToString().Contains(search))
                    .ToList();
            }

            QueueGraphContainer.Visibility = Visibility.Visible;
            // Git #3698 — no QueueCardsHost.Children.Clear() here any more: this render acquires
            // its elements from _queueCards and places them at the end (see step 5).
            _queueCards.BeginPass();
            var hostChildren = new List<UIElement>();
            _currentGraphNodes.Clear();

            // Git #1815 — snapshot what was known before this rebuild, then start a fresh
            // set to populate as cards are (re)built below.
            var previousKnownQueueCardKeys = _knownQueueCardKeys;
            var thisRenderQueueCardKeys = new HashSet<int>();

            if (_queueIsStale)
            {
                string staleText = $"⚠ Offline — showing cached queue from {_queueCachedAtUtc?.ToLocalTime():MMM d, h:mm tt}";
                hostChildren.Add(_queueCards.Acquire("offline-banner", staleText, () =>
                {
                    var staleBanner = new Border
                    {
                        Background = new SolidColorBrush(Color.FromArgb(0x33, 0xFA, 0xB3, 0x87)),
                        BorderBrush = (Brush)Application.Current.FindResource("StatusWarningBrush"),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(8, 4, 8, 4),
                        Margin = new Thickness(0, 0, 0, 6)
                    };
                    staleBanner.Child = new TextBlock
                    {
                        Text = staleText,
                        FontSize = 10.5,
                        Foreground = (Brush)Application.Current.FindResource("StatusWarningBrush"),
                        TextWrapping = TextWrapping.Wrap
                    };
                    return staleBanner;
                }, out _));
            }

            List<MainWindow.PersistedQueueDisplayItem> pendingRestart;
            try { pendingRestart = MainWindow.GetPersistedQueueDisplayItems(); }
            catch { pendingRestart = new(); }

            var restartRenderSignature = System.Text.Json.JsonSerializer.Serialize(
                pendingRestart.Select(p => new { p.Title, p.GithubNumber }));
            if (restartRenderSignature != _lastRestartGroupSignature)
            {
                _lastRestartGroupSignature = restartRenderSignature;
                MainWindow.LogQueuedForRestartRender(pendingRestart.Count);
            }

            foreach (var p in pendingRestart)
            {
                int key = p.GithubNumber ?? -(Math.Abs(p.Title.GetHashCode()));
                _currentGraphNodes.Add(new QueueGraphNode
                {
                    Key = key,
                    DisplayRef = p.GithubNumber.HasValue ? FormatIssueRef(p.GithubNumber.Value) : "restart",
                    Title = p.Title,
                    Status = "restart",
                    RestartItem = p
                });
            }

            // Git #3617 — against the full unfiltered rawItems, not the filtered `items` above,
            // so the "⛓ blocks N" badge is correct even when a downstream blocked item sits
            // under a different active filter than the one currently rendered. Same fix shape
            // already applied for ComputeReverseBlocks just below (Git #3601) and for the
            // forward blocker ghost cards (Git #3599).
            _downstreamBlockCounts = ComputeDownstreamBlockCounts(rawItems);
            _maxDownstreamBlockCount = _downstreamBlockCounts.Count > 0 ? _downstreamBlockCounts.Values.Max() : 0;
            // Git #3601 — against the full unfiltered rawItems, not the filtered `items` above,
            // so a "Blocks:" row is correct regardless of which filter is currently active.
            _reverseBlocks = ComputeReverseBlocks(rawItems);

            var itemNodes = new List<QueueGraphNode>();
            foreach (var item in SortForDisplay(items))
                itemNodes.Add(BuildItemNode(item));
            // Git-style shape fix — Shane: "Blocked ends up showing above the thing
            // it's blocked [by]... I would think this would be nested under whatever
            // blocks it." SortForDisplay's plain "newest number first" order had no
            // relationship to blocking at all, so a blocked item could land anywhere
            // relative to its blocker, including above it. OrderByDependency reorders
            // (stably, preserving SortForDisplay as the sibling/root order) so a
            // blocker always renders before — and its direct dependents immediately
            // after — it, recursively; a node blocked by several others nests under
            // whichever one it encounters first and still draws real connector lines
            // to the rest (see the BlockedBy loop in RedrawQueueGraph, unchanged).
            //
            // Build-set nesting: ungrouped items (BuildSet == null) keep exactly the
            // behavior above — one OrderByDependency pass over the whole ungrouped set,
            // rendered first. Items sharing a real --buildSet name are pulled out into
            // their own contiguous block per set (first-seen order), each ordered by
            // OrderByDependency independently so blocked-nesting still works WITHIN a
            // set. A group header card is inserted ahead of each block below (step 5).
            // A node blocked by something in a DIFFERENT set still draws a real
            // connector to it (RedrawQueueGraph iterates BlockedBy globally, not
            // per-group) — that edge is styled distinctly to flag the boundary crossing.
            var ungroupedNodes = itemNodes.Where(n => n.BuildSet == null).ToList();
            var buildSetOrder = new List<string>();
            var buildSetBuckets = new Dictionary<string, List<QueueGraphNode>>();
            foreach (var n in itemNodes)
            {
                if (n.BuildSet == null) continue;
                if (!buildSetBuckets.TryGetValue(n.BuildSet, out var bucket))
                {
                    bucket = new List<QueueGraphNode>();
                    buildSetBuckets[n.BuildSet] = bucket;
                    buildSetOrder.Add(n.BuildSet);
                }
                bucket.Add(n);
            }

            // Git #1825 — Shane: an entirely-blocked build set (every node blocked)
            // was rendering above a set with real active work happening, because
            // buildSetOrder above is pure first-seen order with zero awareness of
            // status. Re-sort it (stably — OrderBy preserves first-seen order as the
            // tiebreaker) so any set containing at least one non-blocked/active node
            // renders before a set where every node is blocked. This only reorders
            // which build-set SECTION comes first; OrderByDependency itself and the
            // node order/lane assignment within a single set (#1760) are untouched.
            var orderedBuildSets = buildSetOrder
                .OrderBy(setName => buildSetBuckets[setName].All(n => n.IsBlocked) ? 1 : 0);

            _currentGraphNodes.AddRange(OrderByDependency(ungroupedNodes));
            foreach (var setName in orderedBuildSets)
                _currentGraphNodes.AddRange(OrderByDependency(buildSetBuckets[setName]));

            QueueEmptyText.Visibility = _currentGraphNodes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = searching
                ? $"No queued item matches #{search}."
                : _filter switch
                {
                    "Running"  => "Nothing running.",
                    "Queued"   => "Nothing queued.",
                    "Done"     => "Nothing done yet.",
                    "Canceled" => "Nothing canceled.",
                    // Git #3611 — the new dedicated Archive filter.
                    "Archive"  => "Nothing archived.",
                    _          => "Queue is empty.",
                };
            // Git #1834 — the build-set drill-down composes with the filter above rather than
            // replacing its own empty-state text, so name it too when it's the reason the
            // combined result is empty. Git #3613 — gated on !searching: while searching, the
            // build-set filter is bypassed entirely (see the top of this method), so it is
            // never actually the reason a search comes back empty and must not be named as if
            // it were.
            if (!searching && _buildSetFilter != null && _currentGraphNodes.Count == 0)
                QueueEmptyText.Text += $" (build set \"{_buildSetFilter}\")";

            if (_currentGraphNodes.Count == 0)
            {
                FinishQueueCardPass(hostChildren, null);
                QueueGraphCanvas.Children.Clear();
                UpdateCritterLoungeVisibility();
                return;
            }

            // ── 4. Swimlane Allocation DAG Algorithm (#860, reworked; fork lane reuse
            // added by #1760) ──
            // Nodes now arrive parent-before-child (OrderByDependency above), so by the
            // time a node is processed its blocker's column is already known — no more
            // "reserve this lane for a key I haven't seen yet" trick the old top-down
            // algorithm needed. Root/unblocked items always land in lane 0 and STAY
            // there (TrunkOwner never gets displaced), which is what makes lane 0 the
            // continuous main trunk RedrawQueueGraph draws a solid green line through.
            // A blocked node either continues straight down its (single, first) parent's
            // lane — if it's the first child to claim it — or branches into a fresh lane
            // when a sibling already has (a fork, multiple items freed by one blocker).
            //
            // #1760 — Shane: the DAG's connector lines look tangled/crossing, worse with
            // more builds and more blockers. An off-screen harness (BuildQueuePanel
            // constructed with no Window shown, real synthetic QueueItem sets fed through
            // this exact RenderQueue path) confirmed the cause, and it's worse than the
            // "first available slot may be far from the parent" theory the issue opened
            // with: `lanes[col]` was NEVER set back to null anywhere once a lane was
            // claimed, so `lanes.FindIndex(k => k == null)` could never find anything —
            // every fork (and every non-trunk-continuing child at all, since lane 0 never
            // holds a real key) permanently grabbed a brand-new lane at the far right,
            // monotonically, for the rest of that render. A synthetic queue of 14
            // independent 4-way-fork chains (70 nodes) measured 57 lanes, with forks
            // landing an average of 28.5 lanes from their own parent and only 1 of 56
            // within a single lane of it — exactly the "gets worse with scale" shape
            // Shane described. The fix: track the last row each key is ever claimed as a
            // parent (precomputed below, order-only — doesn't touch column assignment)
            // and free that key's lane the moment its last child has been placed, so a
            // later fork can reuse a nearby freed lane instead of the graph only ever
            // growing wider. Lane 0 (TrunkOwner) is never a real key here, so it can never
            // be freed by this — the trunk stays exactly as before.
            const int TrunkOwner = int.MinValue;

            var seenKeys = new HashSet<int>();
            var effectiveParentByRow = new int?[_currentGraphNodes.Count];
            var lastChildRowForKey = new Dictionary<int, int>();
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                int? pk = null;
                foreach (var b in node.BlockedBy) { if (seenKeys.Contains(b)) { pk = b; break; } }
                effectiveParentByRow[i] = pk;
                if (pk.HasValue) lastChildRowForKey[pk.Value] = i; // last write wins = last row
                seenKeys.Add(node.Key);
            }

            var lanes = new List<int?> { TrunkOwner };
            var columnByKey = new Dictionary<int, int>();
            int maxLaneCount = 1;
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                node.Row = i;

                int? parentKey = effectiveParentByRow[i];
                bool continuesParentLane = false;

                int col;
                if (parentKey == null)
                {
                    col = 0;
                    lanes[0] = TrunkOwner;
                }
                else
                {
                    int parentCol = columnByKey[parentKey.Value];
                    continuesParentLane = parentCol < lanes.Count && lanes[parentCol] == parentKey.Value;
                    if (continuesParentLane)
                    {
                        col = parentCol;
                    }
                    else
                    {
                        // Nearest free lane to the parent's own column, not strictly the
                        // first free lane from the left — a fork should land visually
                        // close to where it branched rather than wherever an unrelated
                        // earlier chain happened to free up first.
                        col = -1;
                        int bestDist = int.MaxValue;
                        for (int li = 0; li < lanes.Count; li++)
                        {
                            if (lanes[li] != null) continue;
                            int dist = Math.Abs(li - parentCol);
                            if (dist < bestDist) { bestDist = dist; col = li; }
                        }
                        if (col < 0) { lanes.Add(null); col = lanes.Count - 1; }
                    }
                    lanes[col] = node.Key;
                }

                node.Column = col;
                columnByKey[node.Key] = col;

                // A lane becomes reusable the moment nothing further will ever need to
                // continue from it. Two cases:
                // (a) this node itself will never have children of its own (a fork leaf —
                //     nothing ever lists it in BlockedBy) — free its own just-claimed lane
                //     right away, so the very next fork can reuse it instead of the graph
                //     only ever growing wider;
                // (b) this node was the last child anything will ever claim from its
                //     parent's lane, AND it didn't inherit that lane by continuing straight
                //     down it (a genuine fork elsewhere) — the parent's lane then has
                //     nothing left pointing at it either, so free that one too.
                // Lane 0 (trunk) is excluded from both — TrunkOwner is never a real key, so
                // it can never appear in BlockedBy and case (b)'s guard leaves it alone.
                if (col != 0 && !lastChildRowForKey.ContainsKey(node.Key))
                {
                    lanes[col] = null;
                }
                if (parentKey.HasValue && !continuesParentLane && lastChildRowForKey[parentKey.Value] == i)
                {
                    int ownerCol = columnByKey[parentKey.Value];
                    if (ownerCol != 0) lanes[ownerCol] = null; // never free the trunk lane
                }

                while (lanes.Count > 1 && lanes[lanes.Count - 1] == null) lanes.RemoveAt(lanes.Count - 1);
                maxLaneCount = Math.Max(maxLaneCount, Math.Max(lanes.Count, col + 1));
            }
            _currentMaxLanes = Math.Max(maxLaneCount, 1);

            // ── 5. Build Cards for QueueCardsHost ──
            // Group headers: _currentGraphNodes is now [restart pseudo-nodes]
            // [ungrouped items][buildSet A items][buildSet B items]... (see step 4
            // above), so a header only needs to fire once per transition INTO a
            // non-null BuildSet — restart/ungrouped nodes never re-trigger it.
            //
            // Git #3698 — this used to QueueCardsHost.Children.Clear() and rebuild every card on
            // every call: each poll tick whose queue signature changed, every Git Board refresh
            // (ApplyOpenIssueSet), every Ask Shane poll (ApplyAskShaneSet), every blocker-title
            // fetch. Every card's mascot starts a RepeatBehavior.Forever float, plus a Forever
            // glow shimmer on a running/blocked card, and nothing ever stopped them: a discarded
            // card's clocks kept ticking every frame until a GC happened to collect it, so every
            // render added one or two more live clocks per card, growing with the queue. Same
            // class #3689 fixed for the Build Matrix
            // drawer's 8 slots, here across the whole queue. Every element now comes from
            // _queueCards (KeyedCardPool, the identity-keyed form of #3689's KeyedSlotCardHost): a
            // card whose QueueCardKey (everything it draws) is unchanged is last render's element,
            // mascot still floating; only a changed card is rebuilt; and every element the pool
            // drops has its owned clocks stopped before it goes.
            string? lastRenderedSet = null;
            List<UIElement>? currentSetChildren = null;
            var setPanels = new List<(Panel Panel, List<UIElement> Children)>();
            var newCards = new List<Border>();
            HashSet<int>? pausedIds = null;
            foreach (var node in _currentGraphNodes)
            {
                if (node.BuildSet != lastRenderedSet)
                {
                    if (node.BuildSet != null)
                    {
                        string setName = node.BuildSet;
                        // Git #1636 — Shane: "waiting on his priority build set... he wants a
                        // critter + distinct border" so a set he's actually waiting on reads
                        // differently at a glance from the rest while he tinkers elsewhere.
                        bool isPriority = Services.BuildSetPriorityStore.IsPriority(setName);
                        // "Build Only This Set" — see Services.BuildSetExclusiveStore. Exclusive
                        // styling wins over Priority's when both happen to be set on the same
                        // build set, since exclusive is the stronger, dispatch-affecting state.
                        bool isExclusive = Services.BuildSetExclusiveStore.IsExclusive(setName);
                        var accentBrush = GetBuildSetBrush(setName);

                        var setContainer = _queueCards.Acquire(("set", setName),
                            new BuildSetContainerKey(setName, isPriority, isExclusive, accentBrush.ToString()),
                            () => BuildBuildSetContainer(setName, isPriority, isExclusive, accentBrush), out _);
                        var parts = (BuildSetContainerParts)setContainer.Tag;
                        hostChildren.Add(setContainer);
                        currentSetChildren = new List<UIElement> { parts.Header };
                        setPanels.Add((parts.Panel, currentSetChildren));
                    }
                    else
                    {
                        currentSetChildren = null;
                    }
                    lastRenderedSet = node.BuildSet;
                }

                // Shane: "why are there like ghosts in the empty queue" — _currentGraphNodes
                // (and its connector lines/dots, drawn later by RedrawQueueGraph) is fully built
                // BEFORE this card-building loop runs. An uncaught exception from any one card
                // used to abort this loop entirely, leaving every node after the failure with a
                // real graph line/dot but no card next to it — exactly that "ghost" look. One
                // bad card must never orphan the rest of the render.
                Border? cardElement = null;
                bool reused = false;
                try
                {
                    if (node.Status == "restart" && node.RestartItem != null)
                    {
                        var restartItem = node.RestartItem;
                        cardElement = _queueCards.Acquire(("restart", node.Key),
                            new RestartCardKey(restartItem.Title, restartItem.GithubNumber),
                            () => BuildRestartCard(restartItem), out reused);
                    }
                    else if (node.Item != null)
                    {
                        pausedIds ??= new HashSet<int>(BuildConsoleSettings.Load().PausedBuildIds);
                        var cardNode = node;
                        cardElement = _queueCards.Acquire(("item", node.Item.Id), QueueCardKeyFor(node, pausedIds),
                            () => BuildQueueCard(cardNode), out reused);
                        if (reused) RefreshReusedQueueCard(cardElement, node);
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.critters", $"Card build failed for {node.DisplayRef} — skipping this card rather than orphaning the rest of the queue render: {ex.Message}");
                    cardElement = null;
                }

                if (cardElement != null)
                {
                    node.CardElement = cardElement;
                    thisRenderQueueCardKeys.Add(node.Key);
                    bool isNewCard = _hasRenderedQueueOnce && !previousKnownQueueCardKeys.Contains(node.Key);

                    if (currentSetChildren != null)
                    {
                        cardElement.Margin = new Thickness(0, 2, 0, 2);
                        currentSetChildren.Add(cardElement);
                    }
                    else
                    {
                        hostChildren.Add(cardElement);
                    }

                    // Grown in once it's actually in the tree (after FinishQueueCardPass below), and
                    // never re-run on a pooled card that is already on screen.
                    if (isNewCard && !reused) newCards.Add(cardElement);
                }
            }

            FinishQueueCardPass(hostChildren, setPanels);
            foreach (var card in newCards) AnimateNewQueueCardIn(card);

            _knownQueueCardKeys = thisRenderQueueCardKeys;
            _hasRenderedQueueOnce = true;

            // ── 6. Trigger Canvas Redraw on Layout ──
            Dispatcher.InvokeAsync(RedrawQueueGraph, DispatcherPriority.Loaded);
            UpdateCritterLoungeVisibility();
        }

        /// <summary>Git #3698 — everything <see cref="BuildQueueCard"/> draws for one queue row, so equal
        /// keys on two renders mean an identical card and the pooled one (mascot clocks and all) is kept.
        /// ItemJson is the whole row, which also keeps every value the card's own click handlers act on
        /// current. Anything BuildQueueCard starts reading has to be added here too, or a change to it
        /// won't reach a card that is otherwise unchanged.</summary>
        private sealed record QueueCardKey(
            string ItemJson,
            bool IsBlocked,
            bool IsWaitingForInput,
            bool IsAskingShane,
            InteractiveInputState? InteractiveState,
            bool IsSelected,
            bool IsPaused,
            int DownstreamBlocks,
            bool IsTopBottleneck,
            string BlockerGhosts,
            string BlocksRow,
            string? EpicChip,
            bool HasLog);

        /// <summary>Git #3698 — everything <see cref="BuildRestartCard"/> draws.</summary>
        private sealed record RestartCardKey(string Title, int? GithubNumber);

        /// <summary>Git #3698 — everything <see cref="BuildBuildSetContainer"/> draws.</summary>
        private sealed record BuildSetContainerKey(string Name, bool IsPriority, bool IsExclusive, string Accent);

        /// <summary>Git #3698 — a build-set container's inner list and header, carried on its Tag so a
        /// pooled container's cards can be re-synced without rebuilding the header.</summary>
        private sealed record BuildSetContainerParts(StackPanel Panel, UIElement Header);

        private QueueCardKey QueueCardKeyFor(QueueGraphNode node, HashSet<int> pausedIds)
        {
            var item = node.Item!;
            _downstreamBlockCounts.TryGetValue(item.Id, out var blockCount);
            string blocksRow = item.GithubNumber.HasValue && _reverseBlocks.TryGetValue(item.GithubNumber.Value, out var blockedItems)
                ? string.Join(";", blockedItems.Select(b => $"{b.Id}|{b.GithubNumber}|{b.Title}"))
                : "";
            var epic = item.GithubNumber.HasValue ? ResolveEpicForIssue?.Invoke(item.GithubNumber.Value) : null;
            return new QueueCardKey(
                System.Text.Json.JsonSerializer.Serialize(item),
                node.IsBlocked,
                node.IsWaitingForInput,
                node.IsAskingShane,
                _watcher?.GetInteractiveState(item.Id),
                _selectedQueueItemId == item.Id,
                pausedIds.Contains(item.Id),
                blockCount,
                blockCount > 0 && blockCount == _maxDownstreamBlockCount && _maxDownstreamBlockCount > 1,
                string.Join(";", LiveBlockedBy(node).Select(BlockerGhostKey)),
                blocksRow,
                epic == null ? null : $"{epic.Id}|{epic.GithubNumber}|{epic.Title}",
                Services.BuildLogExistenceCache.HasLog(item.Id));
        }

        /// <summary>Git #3698 — places this render's pooled elements (the top level, then each build-set
        /// container's own list) and retires every element the render didn't use, stopping its clocks.</summary>
        private void FinishQueueCardPass(List<UIElement> hostChildren, List<(Panel Panel, List<UIElement> Children)>? setPanels)
        {
            KeyedCardPool.SyncChildren(QueueCardsHost, hostChildren);
            if (setPanels != null)
                foreach (var (panel, children) in setPanels) KeyedCardPool.SyncChildren(panel, children);
            _queueCards.EndPass();
        }

        /// <summary>Git #3698 — a pooled card is only rebuilt when its <see cref="QueueCardKey"/> changes,
        /// but its Tag, tooltip and context menu are read at click/hover time rather than drawn, and the
        /// menu reads live watcher state (a session id a running build reveals after its card was built).
        /// Refresh those every render, as fresh as the old full rebuild left them — except while the
        /// tooltip or menu is open, which a replacement would close under the pointer.</summary>
        private void RefreshReusedQueueCard(Border card, QueueGraphNode node)
        {
            var item = node.Item!;
            card.Tag = item;
            if (card.ToolTip is not ToolTip { IsOpen: true }) SetQueueCardTooltip(card, item);
            if (card.ContextMenu is not { IsOpen: true }) card.ContextMenu = BuildCardContextMenu(item, node);
        }

        /// <summary>A build set's group container: accent border (exclusive/priority styling), the header
        /// label, and the inner list the set's own cards go in. Git #3698 — pooled by RenderQueue under
        /// <see cref="BuildSetContainerKey"/>; its Tag carries <see cref="BuildSetContainerParts"/>.</summary>
        private Border BuildBuildSetContainer(string buildSetName, bool isPriority, bool isExclusive, Brush accentBrush)
        {
            var setContainer = new Border
            {
                BorderBrush = isExclusive
                    ? (Brush)Application.Current.FindResource("RedBrush")
                    : isPriority
                        ? (Brush)Application.Current.FindResource("PeachBrush")
                        : (Brush)Application.Current.FindResource("MauveBrush"),
                BorderThickness = new Thickness(isExclusive || isPriority ? 2.5 : 1),
                CornerRadius = new CornerRadius(6),
                Background = isExclusive
                    ? new SolidColorBrush(Color.FromArgb(0x16, 0xF3, 0x8B, 0xA8))
                    : isPriority
                        ? new SolidColorBrush(Color.FromArgb(0x16, 0xFA, 0xB3, 0x87))
                        : new SolidColorBrush(Color.FromArgb(0x0A, 0xCB, 0xA6, 0xF7)),
                Margin = new Thickness(0, 8, 0, 8),
                Padding = new Thickness(8, 6, 8, 6),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                ContextMenu = BuildBuildSetHeaderContextMenu(buildSetName, isPriority)
            };
            var setPanel = new StackPanel { Orientation = Orientation.Vertical };
            setContainer.Child = setPanel;

            var headerLabel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 2, 2, 6) };
            headerLabel.Children.Add(new TextBlock
            {
                Text = "▤ ",
                FontSize = 11,
                Foreground = accentBrush,
                VerticalAlignment = VerticalAlignment.Center
            });
            headerLabel.Children.Add(new TextBlock
            {
                Text = buildSetName.ToUpper(),
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = accentBrush,
                VerticalAlignment = VerticalAlignment.Center,
                ToolTip = $"Build Set \"{buildSetName}\" — merges + restarts together as one wave"
            });
            if (isExclusive)
            {
                headerLabel.Children.Add(new TextBlock
                {
                    Text = " 🔒",
                    FontSize = 12,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)Application.Current.FindResource("RedBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = $"Exclusive — the queue holds every other build set until every build in \"{buildSetName}\" finishes."
                });
            }
            else if (isPriority)
            {
                // Reuses the same "⭐" glyph IssueChompAnimation's milestone parade
                // already decorates a marching mascot with — not a new asset.
                headerLabel.Children.Add(new TextBlock
                {
                    Text = " ⭐",
                    FontSize = 12,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)Application.Current.FindResource("PeachBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = $"Priority — a persistent notification fires the moment every build in \"{buildSetName}\" finishes."
                });
            }
            setPanel.Children.Add(headerLabel);

            setContainer.Tag = new BuildSetContainerParts(setPanel, headerLabel);
            return setContainer;
        }

        /// <summary>
        /// Git #1815 — Shane: new cards "just pop in instantly and shove everything else
        /// out of the way." Reuses UiFadeHelper's opacity fade for the card itself, and
        /// grows the card's own Height from 0 up to its real measured size alongside it
        /// so WPF's normal layout pass naturally reflows the surrounding siblings — no
        /// separate per-sibling slide/position system needed to get the "make room" feel.
        /// Card starts at Height 0 / Opacity 0 before it's ever visible, so there's no
        /// flash of the fully-sized card before the animation begins.
        /// </summary>
        private void AnimateNewQueueCardIn(Border cardElement)
        {
            const double durationMs = 170;

            double measureWidth = QueueCardsHost.ActualWidth > 0 ? QueueCardsHost.ActualWidth : double.PositiveInfinity;
            cardElement.Measure(new Size(measureWidth, double.PositiveInfinity));
            double targetHeight = cardElement.DesiredSize.Height;

            cardElement.Height = 0;
            cardElement.ClipToBounds = true;
            UiFadeHelper.FadeIn(cardElement, durationMs);

            if (targetHeight > 0)
            {
                var heightAnim = new DoubleAnimation(0, targetHeight, TimeSpan.FromMilliseconds(durationMs))
                {
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                };
                heightAnim.Completed += (s, e) =>
                {
                    cardElement.BeginAnimation(FrameworkElement.HeightProperty, null);
                    cardElement.Height = double.NaN;
                    cardElement.ClipToBounds = false;
                };
                cardElement.BeginAnimation(FrameworkElement.HeightProperty, heightAnim);
            }
            else
            {
                // Couldn't get a real measured height (e.g. host not laid out yet) —
                // don't leave the card permanently pinned at Height 0.
                cardElement.Height = double.NaN;
                cardElement.ClipToBounds = false;
            }
        }

        private void QueueCardsHost_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            RedrawQueueGraph();
        }

        private void RedrawQueueGraph()
        {
            if (QueueGraphCanvas == null || _currentGraphNodes.Count == 0)
            {
                if (QueueGraphCanvas != null) QueueGraphCanvas.Children.Clear();
                return;
            }

            QueueGraphCanvas.Children.Clear();

            double graphWidth = QueueGraphLeftPad + _currentMaxLanes * QueueGraphLaneWidth + 4;
            QueueGraphCanvas.Width = graphWidth;
            if (GraphColumn != null) GraphColumn.Width = new GridLength(graphWidth);

            var byKey = new Dictionary<int, QueueGraphNode>();
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                byKey[node.Key] = node;

                if (node.CardElement != null && node.CardElement.IsLoaded && node.CardElement.ActualHeight > 0)
                {
                    try
                    {
                        var pt = node.CardElement.TranslatePoint(new Point(0, node.CardElement.ActualHeight / 2), QueueGraphCanvas);
                        node.CenterY = pt.Y;
                    }
                    catch
                    {
                        node.CenterY = i * 62.0 + 31.0;
                    }
                }
                else
                {
                    node.CenterY = i * 62.0 + 31.0;
                }
            }

            double totalHeight = Math.Max(QueueCardsHost.ActualHeight, _currentGraphNodes.Count * 62.0);
            QueueGraphCanvas.Height = totalHeight;

            // 1. Draw Connectors & Curves first
            // Shane: "Anything without a connection just has a trailing circle at the
            // left of it with no line to anything... I would think this would be a
            // green connection line." Unblocked/root items had no vertical connector
            // at all before (the BlockedBy loop below only fires when BlockedBy is
            // non-empty) — they just floated. Every root now connects to the PREVIOUS
            // root's dot with a solid green line, forming one continuous trunk down
            // lane 0 (git log's main-branch line), and its horizontal branch line to
            // the card is green too instead of the lane-cycled color.
            var trunkGreen = (Brush)Application.Current.FindResource("GreenBrush");
            QueueGraphNode? lastTrunkNode = null;
            foreach (var node in _currentGraphNodes)
            {
                double cx = QueueLaneX(node.Column);
                double cy = node.CenterY;
                bool isTrunk = node.BlockedBy.Count == 0;
                var laneBrush = isTrunk ? trunkGreen : QueueLaneBrush(node.Column);

                var branchLine = new System.Windows.Shapes.Line
                {
                    X1 = cx,
                    Y1 = cy,
                    X2 = graphWidth - 2,
                    Y2 = cy,
                    Stroke = laneBrush,
                    StrokeThickness = 1.5,
                    StrokeDashArray = node.IsBlocked ? new DoubleCollection { 2.5, 2 } : null
                };
                QueueGraphCanvas.Children.Add(branchLine);

                if (isTrunk)
                {
                    // Build-set nesting: don't draw the trunk connector across a group
                    // header — a header sitting between two trunk nodes means they're in
                    // different sets (or one is grouped, one isn't), which should read as
                    // separate sequences, not one continuous line running through the header.
                    if (lastTrunkNode != null && lastTrunkNode.BuildSet == node.BuildSet)
                    {
                        QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Line
                        {
                            X1 = cx, Y1 = lastTrunkNode.CenterY,
                            X2 = cx, Y2 = cy,
                            Stroke = trunkGreen,
                            StrokeThickness = 2.0
                        });
                    }
                    lastTrunkNode = node;
                }

                for (int bi = 0; bi < node.BlockedBy.Count; bi++)
                {
                    int bKey = node.BlockedBy[bi];
                    if (byKey.TryGetValue(bKey, out var parentNode))
                    {
                        double px = QueueLaneX(parentNode.Column);
                        double py = parentNode.CenterY;
                        Brush edgeBrush = QueueLaneBrush(bi == 0 ? node.Column : parentNode.Column);
                        // A real dependency that crosses a group boundary (blocker in a
                        // different --buildSet, or one grouped/one not) still gets a real
                        // connector — just flagged distinctly (mauve + dashed) so it reads
                        // as "reaches outside its own group" rather than an ordinary
                        // same-set edge.
                        bool crossesGroup = parentNode.BuildSet != node.BuildSet;
                        if (crossesGroup) edgeBrush = (Brush)Application.Current.FindResource("MauveBrush");
                        var edgeDash = crossesGroup ? new DoubleCollection { 4, 2 } : null;

                        if (Math.Abs(px - cx) < 0.5)
                        {
                            QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Line
                            {
                                X1 = cx, Y1 = cy,
                                X2 = px, Y2 = py,
                                Stroke = edgeBrush,
                                StrokeThickness = 2.0,
                                StrokeDashArray = edgeDash
                            });
                        }
                        else
                        {
                            double midY = (cy + py) / 2.0;
                            var fig = new PathFigure { StartPoint = new Point(cx, cy) };
                            fig.Segments.Add(new BezierSegment(new Point(cx, midY), new Point(px, midY), new Point(px, py), true));
                            var geo = new PathGeometry();
                            geo.Figures.Add(fig);
                            QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Path
                            {
                                Data = geo,
                                Stroke = edgeBrush,
                                StrokeThickness = 2.0,
                                StrokeDashArray = edgeDash
                            });
                        }
                    }
                    else
                    {
                        QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Line
                        {
                            X1 = cx, Y1 = cy,
                            X2 = cx, Y2 = Math.Max(0, cy - 18),
                            Stroke = laneBrush,
                            StrokeThickness = 1.8,
                            StrokeDashArray = new DoubleCollection { 3, 2 }
                        });
                    }
                }
            }

            // 2. Draw Node Dots on top of lines
            foreach (var node in _currentGraphNodes)
            {
                double cx = QueueLaneX(node.Column);
                double cy = node.CenterY;
                var laneBrush = QueueLaneBrush(node.Column);

                var dot = CreateGraphNodeDot(node, cx, cy, laneBrush);
                Canvas.SetLeft(dot, cx - QueueGraphDotRadius);
                Canvas.SetTop(dot, cy - QueueGraphDotRadius);
                QueueGraphCanvas.Children.Add(dot);
            }
        }

        private UIElement CreateGraphNodeDot(QueueGraphNode node, double cx, double cy, Brush laneBrush)
        {
            var mantle = (Brush)Application.Current.FindResource("MantleBrush");
            var blue = (Brush)Application.Current.FindResource("BlueBrush");
            var green = (Brush)Application.Current.FindResource("StatusSuccessBrush");
            var red = (Brush)Application.Current.FindResource("RedBrush");
            var yellow = (Brush)Application.Current.FindResource("StatusWarningBrush");
            var mauve = (Brush)Application.Current.FindResource("MauveBrush");

            if (node.IsWaitingForInput)
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2 + 2,
                    Height = QueueGraphDotRadius * 2 + 2,
                    Fill = yellow,
                    Stroke = mantle,
                    StrokeThickness = 2,
                    ToolTip = $"❓ Build {node.DisplayRef}\nWaiting for user input",
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF9, 0xE2, 0xAF), BlurRadius = 8, ShadowDepth = 0, Opacity = 0.8 }
                };
                return dot;
            }
            else if (node.Status == "running")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2 + 2,
                    Height = QueueGraphDotRadius * 2 + 2,
                    Fill = blue,
                    Stroke = mantle,
                    StrokeThickness = 2,
                    ToolTip = $"▶ Build {node.DisplayRef} (RUNNING)\nActively executing",
                    Effect = (Effect)Application.Current.FindResource("BlueGlowFaint")
                };
                return dot;
            }
            else if (node.Item != null && BuildConsoleSettings.Load().PausedBuildIds.Contains(node.Item.Id))
            {
                var peach = (Brush)Application.Current.FindResource("PeachBrush");
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2 + 2,
                    Height = QueueGraphDotRadius * 2 + 2,
                    Fill = peach,
                    Stroke = mantle,
                    StrokeThickness = 2,
                    ToolTip = $"⏸ Build {node.DisplayRef} (PAUSED)\nPaused by user",
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xFA, 0xB3, 0x87), BlurRadius = 8, ShadowDepth = 0, Opacity = 0.8 }
                };
                return dot;
            }
            else if (node.IsBlocked)
            {
                string blockerText = string.Join(", ", node.BlockedBy.Select(FormatIssueRef));
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = red,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"🔒 Build {node.DisplayRef} (BLOCKED)\nWaiting on: {blockerText}"
                };
                return dot;
            }
            else if (node.Status == BuildQueuePostgresClient.VerifyingStatus)
            {
                var sapphire = (Brush)Application.Current.FindResource("SapphireBrush");
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = sapphire,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"🔎 Build {node.DisplayRef} (VERIFYING)\nSession done — waiting for its GitHub issue to close"
                };
                return dot;
            }
            else if (node.Status == "done")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = green,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"✨ Build {node.DisplayRef} (DONE)"
                };
                return dot;
            }
            else if (node.Status == "failed")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = (Brush)Application.Current.FindResource("StatusErrorBrush"),
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"✕ Build {node.DisplayRef} (FAILED)"
                };
                return dot;
            }
            else if (node.Status == "restart")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = mauve,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"🔄 Build {node.DisplayRef} (Queued for restart)"
                };
                return dot;
            }
            else if (node.Status == "canceled" && node.Item?.ExitCode == 0)
            {
                // Git #3521 — mirror the card pill's "⏳ WAITING" branch: a supervisory cancel
                // (exit 0, work never landed) is pending re-dispatch, not abandoned. Amber dot,
                // distinct from the gray genuine-cancel dot below.
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"⏳ Build {node.DisplayRef} (WAITING to re-dispatch — supervisory cancel, not lost work; Git #3521)"
                };
                return dot;
            }
            else if (node.Status == "canceled")
            {
                // Git #3514 — mirror the card pill: a canceled build is terminal, not up-next.
                // Without this it fell through to the laneBrush "UP NEXT" dot below (same
                // root-cause fallthrough the card pill had). Git #3521 — supervisory cancels
                // (exit 0) take the amber "WAITING" dot above; this is now only a genuine cancel.
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = new SolidColorBrush(Color.FromRgb(0x58, 0x5B, 0x70)),
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"🚫 Build {node.DisplayRef} (CANCELED)"
                };
                return dot;
            }
            else if (node.Status == "queued")
            {
                // Git #3514 — the up-next lane dot is reachable only for a genuinely queued
                // node now, so an unenumerated status can't be painted as a claim candidate.
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = laneBrush,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"⏳ Build {node.DisplayRef} (UP NEXT)\nReady to run when slot is free"
                };
                return dot;
            }
            else
            {
                // Git #3514 — any other/unexpected status: neutral dot labeled with its real
                // status, never the misleading "UP NEXT".
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = new SolidColorBrush(Color.FromRgb(0x6C, 0x70, 0x86)),
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"Build {node.DisplayRef} ({(node.Status ?? "unknown").ToUpperInvariant()})"
                };
                return dot;
            }
        }

        /// <summary>Group header card for a stack of builds sharing the same --buildSet name.
        /// Purely visual — carries no QueueGraphNode, so it plays no part in blocked-by
        /// connector math; RedrawQueueGraph positions connectors off the real cards only,
        /// via TranslatePoint, which naturally accounts for the extra height this adds.</summary>
        /// <summary>Git #1636 — right-click menu on a build-set group header offering the single
        /// "Mark as Priority" / "Unmark Priority" toggle. Re-renders the queue immediately on click
        /// so the critter + border reflect the new state without waiting for the next poll tick.</summary>
        private ContextMenu BuildBuildSetHeaderContextMenu(string buildSetName, bool isPriority)
        {
            var cm = new ContextMenu();
            var mi = new MenuItem { Header = isPriority ? "☆ Unmark Priority" : "⭐ Mark as Priority" };
            mi.Click += (_, _) =>
            {
                bool newState = !isPriority;
                Services.BuildSetPriorityStore.SetPriority(buildSetName, newState);
                ActivityLog.Log("build-queue-panel.priority", $"Build set \"{buildSetName}\" {(newState ? "marked" : "unmarked")} Priority.");
                RenderQueue(_lastItems);
            };
            cm.Items.Add(mi);

            // "Build Only This Set" — puts the queue dispatcher into an exclusive hold (see
            // Services.BuildSetExclusiveStore / BuildQueuePostgresClient.SelectClaimCandidatesAsync):
            // only members of this build set are eligible to claim a free slot until every
            // member reaches a terminal state (auto-clears) or Shane clears it manually. Only
            // one set can be exclusive at a time, so marking a different one silently replaces it.
            bool isExclusive = Services.BuildSetExclusiveStore.IsExclusive(buildSetName);
            var exclusiveItem = new MenuItem
            {
                Header = isExclusive ? "🔓 Clear Exclusive Mode" : "🔒 Build Only This Set",
                ToolTip = isExclusive
                    ? $"Stop holding every other build set — let the queue resume dispatching normally."
                    : $"Hold every OTHER build set — the queue will only dispatch \"{buildSetName}\" until it finishes."
            };
            exclusiveItem.Click += (_, _) =>
            {
                if (isExclusive)
                {
                    Services.BuildSetExclusiveStore.Clear();
                    ActivityLog.Log("build-queue-panel.exclusive", $"Build set \"{buildSetName}\" — exclusive mode cleared; queue resumes normal dispatch.");
                }
                else
                {
                    Services.BuildSetExclusiveStore.SetExclusive(buildSetName);
                    ActivityLog.Log("build-queue-panel.exclusive", $"Build set \"{buildSetName}\" marked exclusive — queue will hold every other build set until it finishes.");
                }
                RenderQueue(_lastItems);
            };
            cm.Items.Add(exclusiveItem);

            return cm;
        }

        /// <summary>Git #1920 — accent brush for a build set. Delegates to
        /// <see cref="Services.BuildSetColorRegistry"/>, which coordinates a collision-free
        /// color among all currently-active build sets (see <see cref="ReportActiveBuildSets"/>)
        /// rather than the old stateless <c>hash % 10</c> that let two distinct sets collide.</summary>
        public static Brush GetBuildSetBrush(string buildSetName)
            => Services.BuildSetColorRegistry.GetBrush(buildSetName);

        /// <summary>Group header card for a stack of builds sharing the same --buildSet name.
        /// Purely visual — carries no QueueGraphNode, so it plays no part in blocked-by
        /// connector math; RedrawQueueGraph positions connectors off the real cards only,
        /// via TranslatePoint, which naturally accounts for the extra height this adds.</summary>
        private Border BuildBuildSetHeader(string buildSetName)
        {
            var accentBrush = GetBuildSetBrush(buildSetName);
            Color accentColor = Color.FromRgb(0xCB, 0xA6, 0xF7); // Mauve fallback
            if (accentBrush is SolidColorBrush scb)
            {
                accentColor = scb.Color;
            }

            // Git #1920 — past the 10th simultaneously-active build set the palette is
            // exhausted and this set's color may be shared with another. Layer on a secondary
            // differentiator so color isn't the only cue: a dashed accent underline and a
            // "shared color" note. In the normal (≤10 active) case this is false and the header
            // draws exactly as before.
            bool sharedColor = Services.BuildSetColorRegistry.IsColorShared(buildSetName);

            var header = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(0x22, accentColor.R, accentColor.G, accentColor.B)),
                BorderBrush = accentBrush,
                BorderThickness = new Thickness(1, 1, 1, 0),
                CornerRadius = new CornerRadius(4, 4, 0, 0),
                Padding = new Thickness(8, 4, 8, 3),
                Margin = new Thickness(0, 8, 0, 0)
            };
            var stack = new StackPanel { Orientation = Orientation.Vertical };
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(new TextBlock
            {
                Text = sharedColor ? "▦ " : "▤ ",
                FontSize = 11,
                Foreground = accentBrush,
                VerticalAlignment = VerticalAlignment.Center
            });
            string tip = sharedColor
                ? $"Build Set \"{buildSetName}\" — merges + restarts together as one wave. " +
                  "More than 10 build sets are active at once, so its color is shared with " +
                  "another set — read the name, not just the color."
                : $"Build Set \"{buildSetName}\" — merges + restarts together as one wave";
            row.Children.Add(new TextBlock
            {
                Text = buildSetName,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = accentBrush,
                TextWrapping = TextWrapping.Wrap,
                ToolTip = tip
            });
            if (sharedColor)
            {
                row.Children.Add(new TextBlock
                {
                    Text = "  ⚠ shared color",
                    FontSize = 9.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = tip
                });
            }
            stack.Children.Add(row);
            if (sharedColor)
            {
                // Dashed accent underline — a shape-based cue that survives two sets sharing
                // the same solid accent color.
                stack.Children.Add(new System.Windows.Shapes.Rectangle
                {
                    Height = 2,
                    Margin = new Thickness(0, 3, 0, 0),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    Stroke = accentBrush,
                    StrokeThickness = 2,
                    StrokeDashArray = new DoubleCollection(new double[] { 2, 2 })
                });
            }
            header.Child = stack;
            return header;
        }

        /// <summary>
        /// Git #3336 — resolves each real build-set key's top Epic(s) from ONE real member issue
        /// each (buildSets are built from one Feature/app by construction, so every member should
        /// share the same Epic) — but actually checks EVERY member's GithubNumber rather than
        /// assuming, so a set that genuinely spans more than one Epic is caught, not silently
        /// mis-reported. Members with no GithubNumber (e.g. a local <c>--notGit</c> row) don't
        /// contribute a resolvable Epic; a set made up entirely of such rows resolves to zero Epics
        /// ("No Epic"), same honest treatment as a genuinely un-parented issue.
        ///
        /// Git #3872 — a member carrying an explicit <see cref="QueueItem.EpicNumber"/> (its
        /// prompt header's own <c>--epic &lt;N&gt;</c> override, see
        /// <see cref="BuildPromptHeader.ParseEpicNumber"/>) contributes that Epic DIRECTLY, bypassing
        /// the <see cref="EpicResolver"/> parent_number walk entirely for that member — the real
        /// escape hatch for a build whose Epic the local mirror hasn't resolved (or can't) yet.
        /// Real DB inference stays the fallback for every member with no override, unchanged.
        /// </summary>
        private async Task<Dictionary<string, List<EpicResolver.ResolvedEpic>>> ResolveBuildSetEpicsAsync(List<QueueItem> items)
        {
            var byKey = items
                .Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && i.GithubNumber.HasValue)
                .GroupBy(i => NormalizeBuildSetKey(i.BuildSet))
                .ToList();

            var result = new Dictionary<string, List<EpicResolver.ResolvedEpic>>(StringComparer.OrdinalIgnoreCase);
            if (byKey.Count == 0) return result;

            // Git #3872 — only members WITHOUT an explicit override need the mirror-based
            // parent_number walk; a member that declared --epic <N> skips it entirely.
            var needsInference = byKey.SelectMany(g => g.Where(i => !i.EpicNumber.HasValue))
                .Select(i => i.GithubNumber!.Value).Distinct().ToList();

            // Git #3871 — pass a real GitHubApiClient (when a PAT is configured) so a node that dead-ends
            // purely because its own mirrored parent_number is null (the sync-gap case confirmed live for
            // #3864/#3865 — a brand-new or just-closed issue the incremental sync hadn't yet been able to
            // write a parent for) gets one narrow, capped live fallback fetch instead of silently
            // resolving to "No Epic"/"(mixed Epics)". No PAT configured degrades to the original
            // mirror-only behaviour exactly (same as every other GitHub-calling read in this panel).
            var settings = BuildConsoleSettings.Load();
            GitHubApiClient? liveFallbackClient = settings.HasGitHubPat ? new GitHubApiClient(settings.GitHubPat) : null;

            var resolved = new Dictionary<int, EpicResolver.ResolvedEpic>();
            if (needsInference.Count > 0)
            {
                var mirrorRows = await GitHubIssueMirror.GetManyAsync(needsInference);
                resolved = await EpicResolver.ResolveTopEpicsAsync(
                    needsInference.Select(n => (n, mirrorRows.TryGetValue(n, out var m) ? m.ParentNumber : (int?)null)),
                    liveFallbackClient);
            }

            // An explicit override still needs a real title for display — a local mirror lookup
            // only (no live GitHub call from this refresh path); falls back to a bare "#N" label
            // when the mirror has never seen that number, same honest-absence treatment as
            // EpicResolver's own "unknown locally" case.
            var explicitNumbers = byKey.SelectMany(g => g.Where(i => i.EpicNumber.HasValue).Select(i => i.EpicNumber!.Value))
                .Distinct().ToList();
            var explicitMirrorRows = explicitNumbers.Count > 0
                ? await GitHubIssueMirror.GetManyAsync(explicitNumbers)
                : new Dictionary<int, GitHubIssueMirror.MirrorIssue>();

            foreach (var g in byKey)
            {
                var epics = g.Select(i =>
                    {
                        if (i.EpicNumber.HasValue)
                        {
                            var n = i.EpicNumber.Value;
                            var title = explicitMirrorRows.TryGetValue(n, out var m) ? m.Title : $"#{n}";
                            return new EpicResolver.ResolvedEpic { Number = n, Title = title };
                        }
                        return resolved.TryGetValue(i.GithubNumber!.Value, out var e) ? e : null;
                    })
                    .Where(e => e != null)
                    .Cast<EpicResolver.ResolvedEpic>()
                    .GroupBy(e => e.Number)
                    .Select(eg => eg.First())
                    .ToList();
                result[g.Key] = epics;
            }
            return result;
        }

        /// <summary>Git #3336 — the real Epic-header sort/group key for one build-set's rollup row:
        /// rank 0 = a single resolved Epic (sorted by its number), rank 1 = "(mixed: #N, #N, …)" (Git
        /// #3871 — the set's real members resolved to more than one distinct Epic, named explicitly
        /// rather than a bare "(mixed Epics)"), rank 2 = "No Epic" (zero resolvable Epics). Never
        /// silently collapsed into rank 0.</summary>
        private readonly struct BuildSetEpicGroupKey : IEquatable<BuildSetEpicGroupKey>
        {
            public int SortRank { get; init; }
            public int? EpicNumber { get; init; }
            public string Label { get; init; }
            public bool Equals(BuildSetEpicGroupKey other) =>
                SortRank == other.SortRank && EpicNumber == other.EpicNumber && Label == other.Label;
            public override bool Equals(object? obj) => obj is BuildSetEpicGroupKey k && Equals(k);
            public override int GetHashCode() => HashCode.Combine(SortRank, EpicNumber, Label);
        }

        private BuildSetEpicGroupKey DescribeBuildSetEpicGroup(string buildSetKey)
        {
            if (_buildSetEpics.TryGetValue(buildSetKey, out var epics) && epics.Count > 0)
            {
                if (epics.Count == 1)
                    return new BuildSetEpicGroupKey { SortRank = 0, EpicNumber = epics[0].Number, Label = $"#{epics[0].Number} — {epics[0].Title}" };
                // Git #3871 — name which real Epics, instead of a bare, unlabeled "(mixed Epics)" that
                // gave no way to tell a genuine cross-Epic build set from the sync-gap regression this
                // fix closes (both used to render identically). Sorted by number so the same real
                // combination always renders the same label (and therefore groups together) regardless
                // of which order EpicResolver happened to resolve its members in.
                var nums = string.Join(", ", epics.Select(e => e.Number).Distinct().OrderBy(n => n).Select(n => $"#{n}"));
                return new BuildSetEpicGroupKey { SortRank = 1, EpicNumber = null, Label = $"(mixed: {nums})" };
            }
            return new BuildSetEpicGroupKey { SortRank = 2, EpicNumber = null, Label = "No Epic" };
        }

        /// <summary>Git #1932's per-build-set "which Verifying items haven't been sent yet"
        /// computation, factored out so Git #3605's epic-level aggregate button can reuse the
        /// exact same real logic instead of re-deriving it. Never mutates
        /// _sentVerifyingByBuildSet — same "no side effects on render" contract as before.</summary>
        private List<int> GetUnsentVerifying(string buildSetKey, List<int> verifying)
        {
            var alreadySent = _sentVerifyingByBuildSet.TryGetValue(buildSetKey, out var sentSet) ? sentSet : null;
            return alreadySent == null ? verifying : verifying.Where(n => !alreadySent.Contains(n)).ToList();
        }

        /// <summary>Git #3616 — splits a candidate "not-yet-sent Verifying" list into what's
        /// actually eligible to be reported "landed" (a real, cached, git-verified DONE bookend —
        /// see <see cref="_verifyingBookendSatisfied"/>) versus what still genuinely "needs
        /// attention" (Verifying locally, but no verified bookend behind that yet). Absence from
        /// the cache fails closed to "needs attention", never to "landed".</summary>
        private (List<int> Landed, List<int> NeedsAttention) SplitByBookendVerification(List<int> candidates)
        {
            var landed = new List<int>();
            var needsAttention = new List<int>();
            foreach (var n in candidates)
            {
                if (_verifyingBookendSatisfied.TryGetValue(n, out var satisfied) && satisfied) landed.Add(n);
                else needsAttention.Add(n);
            }
            return (landed, needsAttention);
        }

        /// <summary>Git #3616 — kicks a real, background (never-blocking) <see
        /// cref="DoneBookendVerifier.GetSatisfiedAsync"/> check for every Verifying issue number
        /// currently on screen, so the rollup's "landed"/"needs attention" split reflects a
        /// genuine, recently-checked answer instead of guesswork. Safe to call on every render:
        /// the verifier's own per-issue 30s cache means a number checked recently resolves as a
        /// cheap dictionary hit, not a fresh `git` shell. Re-renders once (only if something
        /// actually changed) so a fresh positive shows up without Shane needing to touch anything.</summary>
        private async Task RefreshVerifyingBookendSatisfactionAsync(List<int> verifyingNumbers)
        {
            if (_verifyingBookendRefreshInFlight || verifyingNumbers.Count == 0) return;
            _verifyingBookendRefreshInFlight = true;
            try
            {
                var satisfied = await DoneBookendVerifier.GetSatisfiedAsync(verifyingNumbers);
                bool changed = false;
                foreach (var n in verifyingNumbers)
                {
                    bool isSatisfied = satisfied.Contains(n);
                    if (!_verifyingBookendSatisfied.TryGetValue(n, out var prev) || prev != isSatisfied)
                    {
                        _verifyingBookendSatisfied[n] = isSatisfied;
                        changed = true;
                    }
                }
                if (changed) RenderBuildSetRollup(_lastItems);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue.rollup-send-to-chat",
                    $"Git #3616: bookend-verification refresh failed (fail closed — affected item(s) stay 'needs attention'): {ex.Message}");
            }
            finally
            {
                _verifyingBookendRefreshInFlight = false;
            }
        }

        /// <summary>Git #3336 — a real, bold Epic-group header above a block of build-set rollup
        /// rows. Git #3605 extends this with an aggregate "✈" send button, next to the header
        /// text, that sums the real not-yet-sent Verifying items across every member build set
        /// under this Epic group (<paramref name="unsentByBuildSet"/>, keyed by build-set key) and
        /// sends them all as one combined landed-list through the same
        /// SendBuildSetVerifyingRequested pipeline the per-set button (Git #1893/#1932) already
        /// uses — absent (not disabled) when the aggregate is empty, uniformly across a clean
        /// single-Epic group, "(mixed Epics)", and "No Epic" alike.
        ///
        /// Git #3616 — <paramref name="unsentByBuildSet"/> now carries ONLY items whose bookend
        /// already checked out via <see cref="DoneBookendVerifier"/> (the send button offers
        /// exactly what's real to report "landed"); <paramref name="needsAttentionByBuildSet"/>
        /// carries the rest — still Verifying, no verified bookend yet — surfaced as a distinct,
        /// honestly-labeled "⚠ needs attention" pill instead of being silently folded into the
        /// landed count or silently dropped. The header renders whenever either total is
        /// non-zero, so a group with only needs-attention items (no verified landed items yet)
        /// still shows that pill rather than disappearing.</summary>
        private UIElement BuildEpicGroupHeader(BuildSetEpicGroupKey key, Dictionary<string, List<int>> unsentByBuildSet, Dictionary<string, List<int>> needsAttentionByBuildSet)
        {
            var headerText = new TextBlock
            {
                Text = key.Label,
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center,
            };

            int totalUnsent = unsentByBuildSet.Sum(kv => kv.Value.Count);
            int totalNeedsAttention = needsAttentionByBuildSet.Sum(kv => kv.Value.Count);
            // Git #3866 — the lock toggle renders only for a real, single-epic header (never
            // "(mixed Epics)"/"No Epic"), independent of whether there's anything to send/flag.
            bool showLockButton = key.EpicNumber.HasValue;
            if (totalUnsent == 0 && totalNeedsAttention == 0 && !showLockButton)
            {
                headerText.Margin = new Thickness(2, 10, 0, 4);
                return headerText;
            }

            var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 10, 0, 4) };
            headerRow.Children.Add(headerText);

            Button? sendButton = null;
            if (totalUnsent > 0)
            {
                sendButton = new Button
                {
                    Content = "✈",
                    FontSize = 12,
                    Padding = new Thickness(5, 1, 5, 2),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Cursor = Cursors.Hand,
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    ToolTip = $"Send {totalUnsent} verified, not-yet-sent landed item(s) across all {unsentByBuildSet.Count} build set(s) under \"{key.Label}\" as one combined landed-list to the active chat"
                };
                headerRow.Children.Add(sendButton);
            }

            if (totalNeedsAttention > 0)
            {
                var allNeedsAttentionNumbers = needsAttentionByBuildSet.Values.SelectMany(v => v).OrderBy(n => n).ToList();
                headerRow.Children.Add(new TextBlock
                {
                    Text = $"⚠ {totalNeedsAttention} needs attention",
                    FontSize = 10,
                    Margin = new Thickness(8, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)Application.Current.FindResource("StatusWarningBrush"),
                    ToolTip = $"Verifying, but no verified DONE bookend yet — not reported as landed: {string.Join(", ", allNeedsAttentionNumbers.Select(FormatIssueRef))}"
                });
            }

            // Git #3866 — 🔒/🔓 lock toggle: marks every real build-set name currently resolving
            // to this Epic (via _buildSetEpics) as Priority through the existing
            // BuildSetPriorityStore, and keeps applying to any build set that shows up under this
            // same Epic later (see the ApplyLockedEpics call alongside _buildSetEpics's own
            // recompute). Reflects the epic's real current locked/unlocked state on every render —
            // the header's own pool key (RollupEpicHeaderKey.IsLocked) changes whenever the lock
            // state flips, so this button is never left stale after a click.
            Button? lockButton = null;
            if (showLockButton)
            {
                int epicNumber = key.EpicNumber!.Value;
                bool isLocked = Services.EpicPriorityStore.IsLocked(epicNumber);
                lockButton = new Button
                {
                    Content = isLocked ? "🔒" : "🔓",
                    FontSize = 12,
                    Padding = new Thickness(5, 1, 5, 2),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Cursor = Cursors.Hand,
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Foreground = (Brush)Application.Current.FindResource(isLocked ? "YellowBrush" : "Subtext1Brush"),
                    ToolTip = isLocked
                        ? $"Locked — every build set under \"{key.Label}\" is kept marked Priority. Click to unlock (reverts only the build sets this lock auto-marked)."
                        : $"Lock \"{key.Label}\" — mark every build set currently under this Epic Priority, and keep marking any that show up under it later."
                };
                headerRow.Children.Add(lockButton);
            }

            var statusText = new TextBlock
            {
                FontSize = 10,
                Margin = new Thickness(2, 0, 2, 4),
                TextWrapping = TextWrapping.Wrap,
                Visibility = Visibility.Collapsed
            };

            var wrapper = new StackPanel();
            wrapper.Children.Add(headerRow);
            wrapper.Children.Add(statusText);

            if (sendButton != null)
            {
                sendButton.Click += async (s, e) =>
                {
                    // Git #3605 — snapshot the aggregate at click time, same discipline as the
                    // per-set button (BuildRollupRow) snapshotting its own unsentVerifying before
                    // invoking the async send, so a re-render mid-flight can't change what this
                    // send marks sent.
                    var snapshot = unsentByBuildSet.ToDictionary(kv => kv.Key, kv => kv.Value.ToList(), StringComparer.OrdinalIgnoreCase);
                    var allNumbers = snapshot.Values.SelectMany(v => v).ToList();

                    // Git #3616 — a final, authoritative re-check right at send time (not just the
                    // render-time cache) so a click can never send on a stale answer, even if the
                    // background refresh hasn't caught up to a bookend that just stopped verifying
                    // (e.g. a superseding push). DoneBookendVerifier's own per-issue cache makes
                    // this cheap when nothing has changed.
                    var reverified = await DoneBookendVerifier.GetSatisfiedAsync(allNumbers);
                    var toSend = allNumbers.Where(n => reverified.Contains(n)).ToList();
                    var heldBack = allNumbers.Where(n => !reverified.Contains(n)).ToList();
                    if (toSend.Count == 0)
                    {
                        statusText.Text = $"Nothing sent — {heldBack.Count} item(s) still need attention (no verified DONE bookend yet): {string.Join(", ", heldBack.Select(FormatIssueRef))}";
                        statusText.Foreground = (Brush)Application.Current.FindResource("StatusWarningBrush");
                        statusText.Visibility = Visibility.Visible;
                        return;
                    }

                    string text = string.Join("\n", toSend.Select(n => $"Git {FormatIssueRef(n)} — landed"));
                    ActivityLog.Log("build-queue.rollup-send-to-chat", $"epic-aggregate-send-clicked: {key.Label}, {toSend.Count} verified landed item(s) across {snapshot.Count} build set(s)" + (heldBack.Count > 0 ? $", {heldBack.Count} held back as needs-attention" : ""));
                    SendBuildSetVerifyingRequested?.Invoke(this, new SendBuildSetVerifyingEventArgs(key.Label, text, (msg, isError) =>
                    {
                        bool justSent = false;
                        if (!isError)
                        {
                            // Mark only the genuinely-sent (buildSet, issue) pairs sent — never the
                            // held-back needs-attention ones — across every affected build set, so
                            // both this aggregate button and each individual set's own airplane
                            // correctly read "already sent" afterward, with no double-offering and
                            // no falsely-marked-sent needs-attention item.
                            foreach (var kv in snapshot)
                            {
                                var actuallySent = kv.Value.Where(n => reverified.Contains(n)).ToList();
                                if (actuallySent.Count == 0) continue;
                                if (!_sentVerifyingByBuildSet.TryGetValue(kv.Key, out var sent))
                                {
                                    sent = new HashSet<int>();
                                    _sentVerifyingByBuildSet[kv.Key] = sent;
                                }
                                foreach (var n in actuallySent) sent.Add(n);
                            }
                            justSent = true;
                        }
                        statusText.Text = heldBack.Count > 0 ? $"{msg} ({heldBack.Count} still need attention: {string.Join(", ", heldBack.Select(FormatIssueRef))})" : msg;
                        statusText.Foreground = isError
                            ? (Brush)Application.Current.FindResource("StatusErrorBrush")
                            : (Brush)Application.Current.FindResource("StatusSuccessBrush");
                        statusText.Visibility = Visibility.Visible;
                        // Same deferred-rebuild pattern as the per-set button: let Shane see the
                        // outcome message before RenderBuildSetRollup rebuilds this header out from
                        // under statusText.
                        var hideTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
                        hideTimer.Tick += (ts, te) =>
                        {
                            hideTimer.Stop();
                            if (justSent) RenderBuildSetRollup(_lastItems);
                            else statusText.Visibility = Visibility.Collapsed;
                        };
                        hideTimer.Start();
                    }));
                };
            }

            if (lockButton != null)
            {
                int epicNumber = key.EpicNumber!.Value;
                lockButton.Click += (s, e) =>
                {
                    bool currentlyLocked = Services.EpicPriorityStore.IsLocked(epicNumber);
                    if (currentlyLocked)
                    {
                        Services.EpicPriorityStore.Unlock(epicNumber);
                        ActivityLog.Log("build-queue-panel.epic-lock", $"Epic #{epicNumber} unlocked — reverted the build set(s) this lock had auto-marked Priority.");
                    }
                    else
                    {
                        // Git #3866 — every real build-set name currently resolving to this Epic,
                        // not just the ones with unsent/needs-attention items passed into this
                        // header — a fully-verifying/done build set under the same Epic still
                        // gets locked in.
                        var names = _buildSetEpics
                            .Where(kv => kv.Value.Any(ep => ep.Number == epicNumber))
                            .Select(kv => kv.Key)
                            .ToList();
                        Services.EpicPriorityStore.Lock(epicNumber, names);
                        ActivityLog.Log("build-queue-panel.epic-lock", $"Epic #{epicNumber} locked — marked {names.Count} build set(s) Priority: {string.Join(", ", names)}.");
                    }
                    RenderBuildSetRollup(_lastItems);
                };
            }

            return wrapper;
        }

        /// <summary>Git #1834 — collapsible per-buildSet rollup summary. Re-buckets the real,
        /// current <paramref name="items"/> every call (cheap — a handful of build sets, not the
        /// whole DAG), then pools its Epic-group headers and rows via _rollupCards (Git #3834): a
        /// build set whose real displayed content is unchanged from the last call keeps its
        /// existing UI element (and any pending send-outcome DispatcherTimer on it) instead of
        /// being torn down and rebuilt — measured at 83–803ms/call against a live 41-build-set
        /// queue while the panel was open before this fix. Buckets are "up next"
        /// (queued + limit-paused), "running" (running only) and "verifying"
        /// (BuildQueuePostgresClient.VerifyingStatus) — a finer split than QueueFilterCombo's
        /// own Running/Queued (#1829 folds verifying into Running), because Shane's own example
        /// line names all three separately. A build set whose three counts are all zero is
        /// dropped entirely — done/canceled/parked/external members don't count as "current
        /// activity" — so a set with nothing going on right now never clutters this. Real named
        /// sets sort alphabetically; the null/blank-BuildSet bucket renders last as "Ungrouped",
        /// and only when it too has real activity. The whole section hides itself
        /// (BuildSetRollupSection) when there is nothing to show, so an idle queue doesn't grow
        /// this back into dead space.</summary>
        private void RenderBuildSetRollup(List<QueueItem> items)
        {
            if (BuildSetRollupSection == null || BuildSetRollupList == null) return;

            var buckets = new Dictionary<string, (List<int> upNext, List<int> running, List<int> verifying, List<QueueItem> members)>(StringComparer.OrdinalIgnoreCase);
            var bucketOrder = new List<string>();
            foreach (var item in items)
            {
                if (_manuallyHiddenQueueIds.Contains(item.Id)) continue;
                string key = NormalizeBuildSetKey(item.BuildSet);
                if (!buckets.TryGetValue(key, out var counts))
                {
                    counts = (new List<int>(), new List<int>(), new List<int>(), new List<QueueItem>());
                    buckets[key] = counts;
                    bucketOrder.Add(key);
                }
                int refNum = item.GithubNumber ?? item.Id;
                // Git #3616 — confirmed by direct read: this chain is exact-string-match against
                // VerifyingStatus ("verifying"), and "canceled" is a distinct literal
                // (BuildQueuePostgresClient.IsTerminalStatus lists them separately) that matches
                // none of the three branches below — a canceled row falls through to `else
                // continue` and never reaches counts.verifying (or any bucket at all). No gap
                // found here; left as confirmed-correct rather than changed.
                if (item.Status is "queued" or Services.SessionLimitAutoRestartService.LimitPausedStatus) counts.upNext.Add(refNum);
                else if (item.Status == "running") counts.running.Add(refNum);
                else if (item.Status == BuildQueuePostgresClient.VerifyingStatus) counts.verifying.Add(refNum);
                else continue;
                counts.members.Add(item);
            }

            // Git #3616 — opportunistically refresh the real bookend-verification cache for every
            // Verifying issue number on screen, in the background, before anything below decides
            // what's eligible to be reported "landed". Never blocks this (synchronous) render;
            // a not-yet-checked or not-yet-verified item simply reads as "needs attention" until
            // this completes and triggers one re-render.
            var allVerifyingNumbers = buckets.Values.SelectMany(b => b.verifying).Distinct().ToList();
            if (allVerifyingNumbers.Count > 0) _ = RefreshVerifyingBookendSatisfactionAsync(allVerifyingNumbers);

            // Git #2695 — keep the real UNFILTERED any-activity set (pre-#2693 behavior) separate
            // from the activity-filtered set below. The section's own visibility (header + chips)
            // must gate on the UNFILTERED count only, so a filter that matches zero build sets
            // hides just the rows, never the chips Shane needs to switch back to "All".
            var anyActivityKeys = bucketOrder
                .Where(k => buckets[k].upNext.Count + buckets[k].running.Count + buckets[k].verifying.Count > 0)
                .ToList();

            var orderedKeys = anyActivityKeys
                // Git #2693 — activity filter chips narrow the any-activity set above further:
                // "running" keeps only sets with a real running item, "verifying" only sets with
                // a real verifying item. "all" (default) leaves the any-activity filter as-is.
                .Where(k => _rollupActivityFilter switch
                {
                    "queued" => buckets[k].upNext.Count > 0,
                    "running" => buckets[k].running.Count > 0,
                    "verifying" => buckets[k].verifying.Count > 0,
                    _ => true,
                })
                .OrderBy(k => string.Equals(k, UngroupedBuildSetKey, StringComparison.OrdinalIgnoreCase) ? 1 : 0)
                .ThenBy(k => k, StringComparer.OrdinalIgnoreCase)
                .ToList();

            BuildSetRollupSection.Visibility = anyActivityKeys.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
            BuildSetRollupClearText.Visibility = _buildSetFilter != null ? Visibility.Visible : Visibility.Collapsed;
            BuildSetRollupClearText.Text = _buildSetFilter != null ? $"Showing: {_buildSetFilter} ✕" : "";
            UpdateRollupActivityFilterChipsVisual();

            // Git #3834 — one pass over _rollupCards per render: an Epic header or row whose
            // RollupEpicHeaderKey/RollupRowKey below is unchanged from last render comes back as
            // the same instance (BuildEpicGroupHeader/BuildRollupRow never re-runs for it, so its
            // pending send-outcome DispatcherTimer and expand/collapse state stay exactly as they
            // were); only a build set whose real displayed content changed gets rebuilt. Replaces
            // the old BuildSetRollupList.Children.Clear() + full rebuild every call (Git #1206
            // evidence: 83–803ms per call against a live 41-build-set queue while the panel is
            // open).
            _rollupCards.BeginPass();
            var desired = new List<UIElement>();

            if (orderedKeys.Count == 0 && anyActivityKeys.Count > 0)
            {
                // Git #2695 — real build sets have real activity, just none matches the currently
                // selected filter chip. Say so instead of leaving an unexplained blank list.
                string filterLabel = _rollupActivityFilter switch
                {
                    "queued" => "queued",
                    "running" => "running",
                    "verifying" => "verifying",
                    _ => "matching",
                };
                var emptyMessage = _rollupCards.Acquire("emptyFilterMessage", filterLabel, () => new TextBlock
                {
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    FontStyle = FontStyles.Italic,
                    Margin = new Thickness(2, 4, 0, 4),
                }, out _);
                emptyMessage.Text = $"No build sets currently {filterLabel}";
                desired.Add(emptyMessage);
                KeyedCardPool.SyncChildren(BuildSetRollupList, desired);
                _rollupCards.EndPass();
                return;
            }

            // Git #3336 — nest each build set's rollup row under its resolved top Epic (a real
            // header per Epic — number + title), instead of a flat list. A set with no resolvable
            // Epic still renders, under a real "No Epic" header; a set whose real members resolve to
            // more than one distinct Epic renders under a real "(mixed Epics)" header — never
            // silently dropped or silently collapsed under one guessed Epic.
            var epicGroups = orderedKeys
                .GroupBy(DescribeBuildSetEpicGroup)
                .OrderBy(g => g.Key.SortRank)
                .ThenBy(g => g.Key.EpicNumber ?? int.MaxValue);

            foreach (var epicGroup in epicGroups)
            {
                // Git #3605 — the same real per-set unsent-Verifying computation BuildRollupRow
                // uses below, summed across every member build set under this Epic group, so the
                // aggregate header button offers exactly what the sum of the individual per-set
                // buttons would offer — no double-offering, nothing invented.
                // Git #3616 — further split by real bookend verification: only genuinely-verified
                // items are eligible for the aggregate "landed" send; the rest are counted
                // separately as "needs attention" so the header can surface them honestly instead
                // of silently folding them into (or dropping them from) the landed total.
                var unsentByBuildSet = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
                var needsAttentionByBuildSet = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
                foreach (var key in epicGroup)
                {
                    var unsent = GetUnsentVerifying(key, buckets[key].verifying);
                    var (landed, needsAttention) = SplitByBookendVerification(unsent);
                    if (landed.Count > 0) unsentByBuildSet[key] = landed;
                    if (needsAttention.Count > 0) needsAttentionByBuildSet[key] = needsAttention;
                }

                bool epicIsLocked = epicGroup.Key.EpicNumber.HasValue && Services.EpicPriorityStore.IsLocked(epicGroup.Key.EpicNumber.Value);
                var headerKey = new RollupEpicHeaderKey(epicGroup.Key, RollupSignature(unsentByBuildSet), RollupSignature(needsAttentionByBuildSet), epicIsLocked);
                var header = _rollupCards.Acquire(("epicHeader", epicGroup.Key), headerKey,
                    () => BuildEpicGroupHeader(epicGroup.Key, unsentByBuildSet, needsAttentionByBuildSet), out _);
                desired.Add(header);

                foreach (var key in epicGroup)
                {
                    var counts = buckets[key];
                    bool isSelected = string.Equals(_buildSetFilter, key, StringComparison.OrdinalIgnoreCase);
                    bool isExpanded = _expandedRollupSets.Contains(key);
                    // Git #3616/#1932 — landed/needsAttention were already computed above (same
                    // GetUnsentVerifying + SplitByBookendVerification calls BuildRollupRow makes
                    // internally for this exact key) into unsentByBuildSet/needsAttentionByBuildSet;
                    // reuse them here so the pool key changes exactly when a send or a bookend
                    // satisfaction flip would change this row's own send button/pill — otherwise a
                    // successful send's deferred rebuild (below) would find an unchanged key and
                    // leave the stale, already-sent button on screen.
                    var rowKey = new RollupRowKey(
                        string.Join(",", counts.upNext.OrderBy(n => n)),
                        string.Join(",", counts.running.OrderBy(n => n)),
                        string.Join(",", counts.verifying.OrderBy(n => n)),
                        isSelected,
                        isExpanded,
                        string.Join(";", counts.members.OrderBy(m => m.Id).Select(m => $"{m.Id}|{m.OriginatingChatId}|{m.ChatUrl}")),
                        unsentByBuildSet.TryGetValue(key, out var landedForKey) ? string.Join(",", landedForKey.OrderBy(n => n)) : "",
                        needsAttentionByBuildSet.TryGetValue(key, out var needsAttentionForKey) ? string.Join(",", needsAttentionForKey.OrderBy(n => n)) : "");
                    var row = _rollupCards.Acquire(("row", key), rowKey, () =>
                    {
                        var r = BuildRollupRow(key, counts.upNext, counts.running, counts.verifying, counts.members);
                        if (r is FrameworkElement fe) fe.Margin = new Thickness(fe.Margin.Left + 10, fe.Margin.Top, fe.Margin.Right, fe.Margin.Bottom);
                        return r;
                    }, out _);
                    desired.Add(row);
                }
            }

            KeyedCardPool.SyncChildren(BuildSetRollupList, desired);
            _rollupCards.EndPass();
        }

        /// <summary>Git #3834 — everything <see cref="BuildEpicGroupHeader"/> draws besides the
        /// group key itself: the two send-eligibility buckets, order-independent-safe because
        /// both are keyed dictionaries whose (buildSet, sorted-issue-list) pairs are joined in a
        /// stable order below.</summary>
        private sealed record RollupEpicHeaderKey(BuildSetEpicGroupKey Group, string UnsentSignature, string NeedsAttentionSignature, bool IsLocked);

        /// <summary>Git #3834 — everything <see cref="BuildRollupRow"/> draws for one build set:
        /// its three bucketed issue-number lists, the selected/expanded UI state
        /// (<c>_buildSetFilter</c> / <c>_expandedRollupSets</c>) that changes the row's own
        /// styling and detail visibility without any bucket changing, a real signature of the
        /// current members (id + originating-chat identity) since <see cref="BuildRollupRowContextMenu"/>
        /// reads those off the row's closure-captured <c>members</c> list, and the row's own
        /// landed/needs-attention split (Git #3616/#1932) so a send or a bookend-satisfaction flip
        /// — neither of which changes Verifying itself — still forces this row to rebuild.</summary>
        private sealed record RollupRowKey(string UpNext, string Running, string Verifying, bool IsSelected, bool IsExpanded, string MembersSignature, string LandedSignature, string NeedsAttentionSignature);

        /// <summary>Git #3834 — a stable, order-independent join of a buildSet→issue-numbers
        /// dictionary, for use inside a pool key record above.</summary>
        private static string RollupSignature(Dictionary<string, List<int>> byBuildSet) =>
            string.Join(";", byBuildSet.OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase)
                .Select(kv => $"{kv.Key}:{string.Join(",", kv.Value.OrderBy(n => n))}"));

        /// <summary>Git #2693 — highlights whichever activity filter chip is currently selected,
        /// same accent-tinted-background/border convention as the selected-row highlight in
        /// BuildRollupRow above.</summary>
        private void UpdateRollupActivityFilterChipsVisual()
        {
            if (RollupFilterChipAll == null || RollupFilterChipQueued == null || RollupFilterChipRunning == null || RollupFilterChipVerifying == null) return;

            var blueBrush = (Brush)Application.Current.FindResource("BlueBrush");
            var restBackground = (Brush)Application.Current.FindResource("Surface0Brush");
            var restBorder = (Brush)Application.Current.FindResource("Surface1Brush");
            var restForeground = (Brush)Application.Current.FindResource("Subtext1Brush");
            var blueColor = blueBrush is SolidColorBrush bcb ? bcb.Color : Color.FromRgb(0x3B, 0x82, 0xF6);
            var selectedBackground = new SolidColorBrush(Color.FromArgb(0x33, blueColor.R, blueColor.G, blueColor.B));

            foreach (var chip in new[] { RollupFilterChipAll, RollupFilterChipQueued, RollupFilterChipRunning, RollupFilterChipVerifying })
            {
                bool isSelected = string.Equals((string)chip.Tag, _rollupActivityFilter, StringComparison.OrdinalIgnoreCase);
                chip.Background = isSelected ? selectedBackground : restBackground;
                chip.BorderBrush = isSelected ? blueBrush : restBorder;
                if (chip.Child is TextBlock text) text.Foreground = isSelected ? blueBrush : restForeground;
            }
        }

        /// <summary>Git #2693 — clicking a chip sets the activity filter and re-renders the
        /// rollup live, off the same RenderBuildSetRollup call every other rollup refresh here
        /// already uses.</summary>
        private void RollupActivityFilterChip_Click(object sender, MouseButtonEventArgs e)
        {
            if (sender is not Border { Tag: string filter } border) return;
            _rollupActivityFilter = filter;
            RenderBuildSetRollup(_lastItems);
        }

        /// <summary>One collapsed summary line per build set (Shane's own example format:
        /// "&lt;set&gt; — N up next, M running, K verifying (#1234, #1235)"), with issue numbers
        /// shown next to "verifying" specifically — his stated example, and the most actionable
        /// of the three (session done, waiting on a real GitHub issue close). The chevron on the
        /// right is a SEPARATE click target from the row body: clicking it only expands/collapses
        /// this row's own full per-category breakdown (with numbers for all three counts);
        /// clicking the row body drills the queue graph below down to this build set via
        /// ToggleBuildSetFilter. The two never fight over one click because WPF's ButtonBase
        /// marks its own MouseLeftButtonUp handled before it bubbles to the row's
        /// MouseLeftButtonDown handler (same nested-click pattern the queue cards below already
        /// rely on for their own context-menu buttons).</summary>
        private UIElement BuildRollupRow(string buildSetKey, List<int> upNext, List<int> running, List<int> verifying, List<QueueItem> members)
        {
            bool isUngrouped = string.Equals(buildSetKey, UngroupedBuildSetKey, StringComparison.OrdinalIgnoreCase);
            var accentBrush = isUngrouped ? (Brush)Application.Current.FindResource("Subtext0Brush") : GetBuildSetBrush(buildSetKey);
            var accentColor = accentBrush is SolidColorBrush scb ? scb.Color : Color.FromRgb(0x6C, 0x70, 0x86);
            bool isSelected = string.Equals(_buildSetFilter, buildSetKey, StringComparison.OrdinalIgnoreCase);
            bool isExpanded = _expandedRollupSets.Contains(buildSetKey);

            var wrapper = new StackPanel { Margin = new Thickness(0, 0, 0, 4) };

            var headerBorder = new Border
            {
                Background = isSelected
                    ? new SolidColorBrush(Color.FromArgb(0x33, accentColor.R, accentColor.G, accentColor.B))
                    : (Brush)Application.Current.FindResource("Surface0Brush"),
                BorderBrush = isSelected ? accentBrush : (Brush)Application.Current.FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 5, 6, 5),
                Cursor = Cursors.Hand,
                ToolTip = isSelected
                    ? $"Click to clear the \"{buildSetKey}\" filter on the queue below"
                    : $"Click to filter the queue below down to \"{buildSetKey}\" (combines with the status filter + search box above)"
            };

            var headerGrid = new Grid();
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Git #3813 — the buildSet name used to render in the full-saturation accent
            // color directly, which on a selected row sits on a low-opacity tint of that same
            // accent (same-hue-on-background, the exact pattern #3776 fixed for the Chats
            // panel's epic badges). Keep the name neutral and carry the accent identity in a
            // small dot instead, matching the established Chats-panel dot pattern.
            var summaryRow = new Grid();
            summaryRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            summaryRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var accentDot = new Ellipse
            {
                Width = 7,
                Height = 7,
                Fill = accentBrush,
                Margin = new Thickness(0, 0, 5, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(accentDot, 0);
            summaryRow.Children.Add(accentDot);

            var summaryText = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 11, VerticalAlignment = VerticalAlignment.Center };
            summaryText.Inlines.Add(new System.Windows.Documents.Run($"{buildSetKey} — ") { FontWeight = FontWeights.SemiBold, Foreground = (Brush)Application.Current.FindResource("TextBrush") });
            summaryText.Inlines.Add(new System.Windows.Documents.Run($"{upNext.Count} up next, {running.Count} running, {verifying.Count} verifying")
            {
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush")
            });
            if (verifying.Count > 0)
            {
                summaryText.Inlines.Add(new System.Windows.Documents.Run($" ({string.Join(", ", verifying.Select(FormatIssueRef))})")
                {
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    FontSize = 10.5
                });
            }
            Grid.SetColumn(summaryText, 1);
            summaryRow.Children.Add(summaryText);
            Grid.SetColumn(summaryRow, 0);
            headerGrid.Children.Add(summaryRow);

            // Git #1932 — only the Verifying items this build set hasn't already sent count
            // toward whether the send button shows/what it sends. GetUnsentVerifying never
            // mutates _sentVerifyingByBuildSet — no side effects, so re-rendering this row
            // (RenderBuildSetRollup runs on every refresh) never itself marks anything as sent.
            // (Git #3605 factored this out so the epic-level aggregate header button can reuse it.)
            var unsentVerifying = GetUnsentVerifying(buildSetKey, verifying);

            // Git #3616 — a Verifying item is only eligible for the "landed" send once its own
            // build-journal bookend genuinely checks out (DoneBookendVerifier). Split the
            // not-yet-sent set accordingly: `landedEligible` is what the send button offers;
            // `needsAttention` is the rest — still Verifying, no verified bookend yet — which
            // must be surfaced honestly rather than silently sent or silently hidden.
            var (landedEligible, needsAttention) = SplitByBookendVerification(unsentVerifying);

            // Git #1893/#1932 — "send this set's not-yet-sent Verifying items as a landed-list to
            // the active chat" button. Only rendered when there's something real and NEW to send
            // (#1893 requirement 3, extended by #1932: a build set with zero unsent Verifying
            // items doesn't offer a broken/empty/re-send) — rather than rendering a disabled
            // button, it's simply absent. Git #3616: gated on `landedEligible`, not the raw
            // `unsentVerifying` count, so the button never offers to send an item that hasn't
            // actually verified DONE yet.
            Button? sendButton = null;
            if (landedEligible.Count > 0)
            {
                sendButton = new Button
                {
                    Content = "✈",
                    FontSize = 12,
                    Padding = new Thickness(5, 1, 5, 2),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Cursor = Cursors.Hand,
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    ToolTip = $"Send {buildSetKey}'s {landedEligible.Count} verified, not-yet-sent landed item(s) as a landed-list to the active chat"
                };
                Grid.SetColumn(sendButton, 1);
                headerGrid.Children.Add(sendButton);
            }

            // Git #3616 — a distinct, honestly-labeled "needs attention" pill for Verifying items
            // whose bookend hasn't checked out yet. Always visible when non-empty, independent of
            // whether the send button is also showing, so Shane sees these exist even if he never
            // clicks send.
            if (needsAttention.Count > 0)
            {
                var needsAttentionPill = new TextBlock
                {
                    Text = $"⚠ {needsAttention.Count}",
                    FontSize = 10,
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)Application.Current.FindResource("StatusWarningBrush"),
                    ToolTip = $"{needsAttention.Count} Verifying item(s) with no verified DONE bookend yet — not reported as landed: {string.Join(", ", needsAttention.Select(FormatIssueRef))}"
                };
                Grid.SetColumn(needsAttentionPill, 2);
                headerGrid.Children.Add(needsAttentionPill);
            }

            var chevron = new ToggleButton
            {
                Style = (Style)Application.Current.FindResource("ExpandCollapseToggleStyle"),
                IsChecked = isExpanded,
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0),
                ToolTip = "Expand for the full per-category breakdown"
            };
            Grid.SetColumn(chevron, 3);
            headerGrid.Children.Add(chevron);

            headerBorder.Child = headerGrid;
            wrapper.Children.Add(headerBorder);

            // Git #1893 — brief send-outcome status, same purpose as SqlDocumentView's ExecStatus
            // strip (#940) but scoped to this one row (this whole element is only rebuilt when
            // RollupRowKey changes — Git #3834 — so there's no separately-persistent named
            // element to reuse; it lives and dies with the row itself). Hidden until a send is
            // attempted, then auto-hides itself after a few seconds.
            var statusText = new TextBlock
            {
                FontSize = 10,
                Margin = new Thickness(2, 2, 2, 0),
                TextWrapping = TextWrapping.Wrap,
                Visibility = Visibility.Collapsed
            };
            wrapper.Children.Add(statusText);

            if (sendButton != null)
            {
                sendButton.Click += async (s, e) =>
                {
                    // Git #1932 — snapshot the not-yet-sent set at click time; the closure below
                    // marks exactly these as sent on success, never the row's full `verifying`
                    // list (which may include items an earlier send already reported).
                    // Git #3616 — a final, authoritative DoneBookendVerifier re-check right at
                    // send time (not just the render-time cache that gated the button's own
                    // visibility) so a click can never send on a stale answer. Cheap when nothing
                    // changed — DoneBookendVerifier caches per-issue for 30s.
                    var candidates = unsentVerifying;
                    var reverified = await DoneBookendVerifier.GetSatisfiedAsync(candidates);
                    var toSend = candidates.Where(n => reverified.Contains(n)).ToList();
                    var heldBack = candidates.Where(n => !reverified.Contains(n)).ToList();
                    if (toSend.Count == 0)
                    {
                        statusText.Text = $"Nothing sent — {heldBack.Count} item(s) still need attention (no verified DONE bookend yet): {string.Join(", ", heldBack.Select(FormatIssueRef))}";
                        statusText.Foreground = (Brush)Application.Current.FindResource("StatusWarningBrush");
                        statusText.Visibility = Visibility.Visible;
                        return;
                    }

                    string text = string.Join("\n", toSend.Select(n => $"Git {FormatIssueRef(n)} — landed"));
                    ActivityLog.Log("build-queue.rollup-send-to-chat", $"send-clicked: {buildSetKey}, {toSend.Count} verified landed item(s)" + (heldBack.Count > 0 ? $", {heldBack.Count} held back as needs-attention" : ""));
                    SendBuildSetVerifyingRequested?.Invoke(this, new SendBuildSetVerifyingEventArgs(buildSetKey, text, (msg, isError) =>
                    {
                        bool justSent = false;
                        if (!isError)
                        {
                            // Git #1932 — mark sent immediately on a real successful send (not
                            // deferred to the re-render below), so the button's visibility on the
                            // NEXT render is already correct even if something else triggers a
                            // rebuild before this row's own timer fires. A failed send marks
                            // nothing, leaving the button visible/re-sendable. Git #3616: only
                            // `toSend` (bookend-verified) is ever marked sent — a held-back
                            // needs-attention item stays unsent so it's offered again once it
                            // actually verifies.
                            if (!_sentVerifyingByBuildSet.TryGetValue(buildSetKey, out var sent))
                            {
                                sent = new HashSet<int>();
                                _sentVerifyingByBuildSet[buildSetKey] = sent;
                            }
                            foreach (var n in toSend) sent.Add(n);
                            justSent = true;
                        }
                        statusText.Text = heldBack.Count > 0 ? $"{msg} ({heldBack.Count} still need attention: {string.Join(", ", heldBack.Select(FormatIssueRef))})" : msg;
                        statusText.Foreground = isError
                            ? (Brush)Application.Current.FindResource("StatusErrorBrush")
                            : (Brush)Application.Current.FindResource("StatusSuccessBrush");
                        statusText.Visibility = Visibility.Visible;
                        // Rebuilding this row right now (RenderBuildSetRollup's own re-render,
                        // which — now that "sent" is recorded — computes a different RollupRowKey
                        // for this build set and so genuinely replaces the pooled element, Git
                        // #3834) would destroy statusText before Shane ever sees the outcome
                        // message, since the button's own success/fail feedback is the point.
                        // Defer the rebuild — which is what actually makes the button disappear —
                        // to the same timer that hides the status text, so he sees "Sent" first.
                        var hideTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
                        hideTimer.Tick += (ts, te) =>
                        {
                            hideTimer.Stop();
                            if (justSent) RenderBuildSetRollup(_lastItems);
                            else { statusText.Visibility = Visibility.Collapsed; }
                        };
                        hideTimer.Start();
                    }));
                };
            }

            var detail = new StackPanel
            {
                Margin = new Thickness(10, 4, 4, 0),
                Visibility = isExpanded ? Visibility.Visible : Visibility.Collapsed
            };
            void AddDetailLine(string label, List<int> nums)
            {
                if (nums.Count == 0) return;
                detail.Children.Add(new TextBlock
                {
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 0, 0, 2),
                    Text = $"{label} ({nums.Count}): {string.Join(", ", nums.Select(FormatIssueRef))}"
                });
            }
            AddDetailLine("Up next", upNext);
            AddDetailLine("Running", running);
            AddDetailLine("Verifying", verifying);
            if (detail.Children.Count == 0)
            {
                // Nothing here isn't reachable in practice — a row only renders when at least
                // one bucket is non-empty — but guard anyway rather than show an empty expand.
                detail.Children.Add(new TextBlock
                {
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    Text = "Nothing further to show."
                });
            }
            wrapper.Children.Add(detail);

            headerBorder.MouseLeftButtonDown += (s, e) => ToggleBuildSetFilter(buildSetKey);
            chevron.Click += (s, e) =>
            {
                bool expanded = chevron.IsChecked == true;
                if (expanded) _expandedRollupSets.Add(buildSetKey);
                else _expandedRollupSets.Remove(buildSetKey);
                detail.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
            };

            headerBorder.ContextMenu = BuildRollupRowContextMenu(buildSetKey, members, isSelected, isExpanded);

            return wrapper;
        }

        /// <summary>Git #1999 — right-click menu for a BUILD SETS rollup row. Reuses the exact
        /// same chat-resolution path individual cards use (<see cref="QueueItemChatRequested"/> →
        /// MainWindow's OpenChatForQueueItem) rather than a second one — a build set just has
        /// potentially several distinct originating chats among its members instead of one, so
        /// this only adds the "which chat(s)" step on top, then hands a representative
        /// <see cref="QueueItem"/> to the same event the card menu already raises.</summary>
        private ContextMenu BuildRollupRowContextMenu(string buildSetKey, List<QueueItem> members, bool isSelected, bool isExpanded)
        {
            var cm = new ContextMenu();

            // Distinct originating chats across this set's current members, deduped on
            // OriginatingChatId first (falls back to ChatUrl only when no chat id is set) —
            // same precedence OpenChatForQueueItem itself resolves in. Members with neither
            // are simply not a chat and don't contribute an entry (no invented "Unknown chat" row).
            var chatGroups = new List<(string Key, QueueItem Representative, int Count)>();
            var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in members)
            {
                string? chatKey = !string.IsNullOrWhiteSpace(m.OriginatingChatId) ? m.OriginatingChatId : m.ChatUrl;
                if (string.IsNullOrWhiteSpace(chatKey)) continue;
                if (seen.TryGetValue(chatKey, out var idx))
                {
                    var existing = chatGroups[idx];
                    chatGroups[idx] = (existing.Key, existing.Representative, existing.Count + 1);
                }
                else
                {
                    seen[chatKey] = chatGroups.Count;
                    chatGroups.Add((chatKey, m, 1));
                }
            }

            if (chatGroups.Count == 1)
            {
                var miOpenChat = new MenuItem { Header = "💬 Open Originating Chat" };
                var rep = chatGroups[0].Representative;
                miOpenChat.Click += (_, _) => QueueItemChatRequested?.Invoke(this, rep);
                cm.Items.Add(miOpenChat);
                cm.Items.Add(new Separator());
            }
            else if (chatGroups.Count > 1)
            {
                var chatSubmenu = new MenuItem { Header = "💬 Open Originating Chat" };
                foreach (var (key, rep, count) in chatGroups)
                {
                    // No chat title is resolvable from here (BuildQueuePanel has no chat-list
                    // lookup by conversation id) — label with the real id/url plus how many of
                    // this set's items came from it, per the issue's fallback wording.
                    var miChat = new MenuItem { Header = $"{key} ({count} item{(count == 1 ? "" : "s")})" };
                    var capturedRep = rep;
                    miChat.Click += (_, _) => QueueItemChatRequested?.Invoke(this, capturedRep);
                    chatSubmenu.Items.Add(miChat);
                }
                cm.Items.Add(chatSubmenu);
                cm.Items.Add(new Separator());
            }
            // chatGroups.Count == 0 → omit the entry entirely, matching the card menu's own
            // guard at the OriginatingChatId/ChatUrl check.

            var miFilter = new MenuItem
            {
                Header = isSelected ? $"✕ Clear filter (\"{buildSetKey}\")" : $"Filter queue to \"{buildSetKey}\""
            };
            miFilter.Click += (_, _) => ToggleBuildSetFilter(buildSetKey);
            cm.Items.Add(miFilter);

            var miExpand = new MenuItem { Header = isExpanded ? "▲ Collapse" : "▼ Expand" };
            miExpand.Click += (_, _) =>
            {
                if (isExpanded) _expandedRollupSets.Remove(buildSetKey);
                else _expandedRollupSets.Add(buildSetKey);
                RenderBuildSetRollup(_lastItems);
            };
            cm.Items.Add(miExpand);

            cm.Items.Add(new Separator());

            var miRemoveSet = new MenuItem { Header = "🗑 Remove Entire Set (→ Backlog)" };
            miRemoveSet.Click += async (_, _) => await RemoveBuildSetAsync(buildSetKey, members);
            cm.Items.Add(miRemoveSet);

            return cm;
        }

        /// <summary>Right-click "Remove Entire Set" on a BUILD SETS rollup row — cancels every
        /// member still eligible (queued / limit-paused / parked / capped, same states
        /// <see cref="Services.BuildQueuePostgresClient.CancelAsync"/> already guards on) so the
        /// whole set drops out of the queue at once, then mirrors each canceled member's linked
        /// GitHub issue back to the real board's Backlog column via the same fire-and-forget
        /// <see cref="Services.BoardStatusSync.Mirror"/> primitive Park/Un-park already use — "Git
        /// IS the database" applies here too. A member already running or verifying can't be
        /// safely killed from here (same guard CancelAsync itself enforces) and is deliberately
        /// left alone, not force-canceled and not moved to Backlog out from under an active
        /// build.</summary>
        private async System.Threading.Tasks.Task RemoveBuildSetAsync(string buildSetKey, List<QueueItem> members)
        {
            if (_db == null)
            {
                ToastEngine.Warning("Remove Set", "No direct DB connection — can't remove.");
                return;
            }

            var confirm = MessageBox.Show(
                $"Remove all of build set \"{buildSetKey}\" from the queue?\n\n" +
                $"{members.Count} item(s) will be canceled (anything already running/verifying is left alone), " +
                "and their linked GitHub issues moved back to Backlog.",
                "Remove Entire Set", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            int canceled = 0, skipped = 0;
            foreach (var m in members)
            {
                try
                {
                    if (await _db.CancelAsync(m.Id))
                    {
                        canceled++;
                        Services.BoardStatusSync.Mirror(m.GithubNumber, GitHubApiClient.BacklogOptionId,
                            "Removed from queue (build set)", "build-queue");
                    }
                    else
                    {
                        skipped++; // already running/verifying/terminal — left alone
                    }
                }
                catch (Exception ex)
                {
                    skipped++;
                    ActivityLog.Log("build-queue", $"Remove set \"{buildSetKey}\": couldn't cancel #{m.Id} ({m.Title}): {ex.Message}");
                }
            }

            ActivityLog.Log("build-queue", $"Removed build set \"{buildSetKey}\": {canceled} canceled → Backlog, {skipped} left alone (running/verifying/already terminal).");
            if (canceled > 0)
                ToastEngine.Success("Set Removed", $"\"{buildSetKey}\": {canceled} canceled" + (skipped > 0 ? $", {skipped} left running" : ""));
            else
                ToastEngine.Warning("Remove Set", $"\"{buildSetKey}\": nothing to cancel — all {skipped} item(s) already running/verifying/terminal.");

            await RefreshAsync();
        }

        /// <summary>Git #1834 addendum — click a rollup row to filter the queue graph below
        /// down to that build set; click the same row again (or the header's "Showing: X ✕"
        /// clear affordance) to return to the unfiltered view. Deliberately doesn't touch
        /// _filter or _queueSearch — see ApplyFilter for how the three compose.</summary>
        private void ToggleBuildSetFilter(string buildSetKey)
        {
            _buildSetFilter = string.Equals(_buildSetFilter, buildSetKey, StringComparison.OrdinalIgnoreCase) ? null : buildSetKey;
            if (QueueGraphContainer != null) RenderQueue(_lastItems);
            RenderBuildSetRollup(_lastItems);
        }

        private void BuildSetRollupClear_Click(object sender, MouseButtonEventArgs e)
        {
            _buildSetFilter = null;
            if (QueueGraphContainer != null) RenderQueue(_lastItems);
            RenderBuildSetRollup(_lastItems);
        }

        private Border BuildRestartCard(MainWindow.PersistedQueueDisplayItem p)
        {
            var restartBrush = (Brush)Application.Current.FindResource("MauveBrush");
            var card = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x20, 0x1A, 0x2A)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x5A, 0x48, 0x75)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 2, 0, 3),
                HorizontalAlignment = HorizontalAlignment.Stretch
            };

            var sp = new StackPanel();
            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 2) };
            var badge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x38, 0x2C, 0x4C)),
                BorderBrush = restartBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1.5, 5, 1.5)
            };
            badge.Child = new TextBlock
            {
                Text = "🔄 RESTART",
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                Foreground = restartBrush
            };
            topRow.Children.Add(badge);

            if (p.GithubNumber.HasValue)
            {
                var numBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0)
                };
                numBadge.Child = new TextBlock
                {
                    Text = FormatIssueRef(p.GithubNumber.Value),
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)Application.Current.FindResource("PeachBrush")
                };
                topRow.Children.Add(numBadge);
            }
            sp.Children.Add(topRow);

            var titleBlock = new TextBlock
            {
                Text = p.Title,
                FontSize = 11.5,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 1, 0)
            };
            AttachBubbleTooltip(titleBlock, p.Title);
            sp.Children.Add(titleBlock);

            // ── Git #1640 — critter + 💤 badge, same 2-column layout BuildQueueCard uses.
            // RestartItem (PersistedQueueDisplayItem) carries no Id, only Title + optional
            // GithubNumber, so the stable variant seed is GithubNumber when present, else a
            // stable hash of Title — either way the same restart item always draws the same
            // critter across repaints, never re-randomized.
            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(sp, 0);
            cardGrid.Children.Add(sp);

            int restartSeed = p.GithubNumber ?? p.Title.GetHashCode();
            var mascot = (Canvas)CreateGenericCardMascot(restartSeed, CritterMood.Normal, isBlocked: false);
            var sleepBadge = new Border
            {
                Background = HexBrush("#89B4FA"), // calm sapphire/lavender — distinct from the red 🔒 blocked badge
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(3, 1, 3, 1),
                Effect = new DropShadowEffect { Color = Color.FromRgb(0x89, 0xB4, 0xFA), BlurRadius = 4, ShadowDepth = 0 },
                ToolTip = "Queued for restart — waiting for its build set to finish, not blocked on a dependency"
            };
            sleepBadge.Child = new TextBlock { Text = "💤", FontSize = 9 };
            Canvas.SetLeft(sleepBadge, 22);
            Canvas.SetTop(sleepBadge, -3);
            mascot.Children.Add(sleepBadge);

            Grid.SetColumn(mascot, 1);
            cardGrid.Children.Add(mascot);

            card.Child = cardGrid;
            return card;
        }

        private Border BuildQueueCard(QueueGraphNode node)
        {
            var item = node.Item!;
            bool isWaitingForInput = node.IsWaitingForInput;
            bool isBlocked = node.IsBlocked;
            // Git #3700 — a real, standing decision Shane needs to make (board status), distinct
            // from isWaitingForInput's live mid-build chat prompt. Checked right after it in every
            // priority chain below: the second-most-urgent "needs Shane" signal on the card.
            bool isAskingShane = node.IsAskingShane;
            bool isSelected = _selectedQueueItemId == item.Id;
            bool isPaused = BuildConsoleSettings.Load().PausedBuildIds.Contains(item.Id);

            Color cardBorderColor = isSelected ? Color.FromRgb(0x89, 0xB4, 0xFA) :
                (isWaitingForInput ? Color.FromRgb(0xF9, 0xE2, 0xAF) :
                (isAskingShane ? Color.FromRgb(0xF5, 0xC2, 0xE7) :
                (item.Status == "running" ? Color.FromRgb(0x45, 0x5A, 0x82) :
                (isPaused ? Color.FromRgb(0xFA, 0xB3, 0x87) :
                (isBlocked ? Color.FromRgb(0x5A, 0x2A, 0x34) :
                (item.Status == BuildQueuePostgresClient.VerifyingStatus ? Color.FromRgb(0x2A, 0x4A, 0x5A) :
                (item.Status == "done" ? Color.FromRgb(0x2E, 0x52, 0x3E) :
                (item.Status == "failed" ? Color.FromRgb(0x5A, 0x2A, 0x34) :
                // Git #1638 — "parked" and "external" get their own neutral/informational
                // border so they read as distinct from the plain "up next" default below.
                (item.Status == "parked" ? Color.FromRgb(0x6C, 0x70, 0x86) :
                // Git #1989 — Conservation Cap: peach, the same "flagged, needs a look"
                // accent isPaused already uses above — distinct from the neutral gray
                // "parked" (#1638) gets, since being capped is a decision Shane may want
                // to revisit (override/drain), not just a passive staging spot.
                (item.Status == Services.AccountCapPolicy.CappedStatus ? Color.FromRgb(0xFA, 0xB3, 0x87) :
                (item.Status == "external" ? Color.FromRgb(0x89, 0xB4, 0xFA) :
                Color.FromRgb(0x31, 0x32, 0x44))))))))))));

            Color cardBgColor = isSelected ? Color.FromRgb(0x1B, 0x22, 0x34) :
                (isWaitingForInput ? Color.FromRgb(0x23, 0x1E, 0x18) :
                (isAskingShane ? Color.FromRgb(0x27, 0x1B, 0x24) :
                (item.Status == "running" ? Color.FromRgb(0x15, 0x19, 0x26) :
                (isPaused ? Color.FromRgb(0x2A, 0x20, 0x1A) :
                (isBlocked ? Color.FromRgb(0x1E, 0x18, 0x22) :
                (item.Status == BuildQueuePostgresClient.VerifyingStatus ? Color.FromRgb(0x14, 0x22, 0x28) :
                (item.Status == "done" ? Color.FromRgb(0x14, 0x20, 0x1A) :
                (item.Status == "parked" ? Color.FromRgb(0x1E, 0x1F, 0x2A) :
                (item.Status == Services.AccountCapPolicy.CappedStatus ? Color.FromRgb(0x2A, 0x20, 0x1A) :
                (item.Status == "external" ? Color.FromRgb(0x15, 0x19, 0x26) :
                Color.FromRgb(0x18, 0x18, 0x25)))))))))));

            var card = new Border
            {
                Background = new SolidColorBrush(cardBgColor),
                BorderBrush = new SolidColorBrush(cardBorderColor),
                BorderThickness = new Thickness(isSelected ? 1.8 : (isWaitingForInput || isAskingShane ? 1.5 : 1)),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 2, 0, 3),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Cursor = Cursors.Hand,
                Tag = item
            };

            card.MouseLeftButtonDown += (s, e) =>
            {
                // Git #3698 — a pooled card outlives the render that built it; select the node it
                // belongs to now.
                SelectNode(_currentGraphNodes.FirstOrDefault(n => ReferenceEquals(n.CardElement, card)) ?? node);
            };

            var mainStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            // ── Top Row: Status Badge + Issue # Badge + Critical Path Badge ──
            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };

            Border statusPill;
            if (isWaitingForInput)
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x3E, 0x2C, 0x1A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "❓ ASK QUESTION",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            // Git #3700 — a real board Status of "Ask Shane" always shows this label, regardless
            // of the item's own raw queue status (isPaused/running/blocked/etc. below) — same
            // no-gating principle #3626 established for 🔒 BLOCKED. Checked right after
            // isWaitingForInput: the second-most-urgent "needs Shane" signal, and visually
            // distinct (pink, not the peach ASK QUESTION/PAUSED already use) so the two "needs
            // Shane" cases never look identical on the card.
            else if (isAskingShane)
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x3A, 0x1E, 0x30)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF5, 0xC2, 0xE7)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "❓ NEEDS YOUR INPUT",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF5, 0xC2, 0xE7)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "This issue's real board Status is \"Ask Shane\" — a standing decision is needed."
                };
            }
            else if (isPaused)
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "⏸ PAUSED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (item.Status == "running")
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1D, 0x2E, 0x45)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "▶ RUNNING",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (isBlocked)
            {
                // Git #3624 — a real, currently-open declared blocker overrides whatever the
                // raw status column would otherwise render (Verifying — #3585's incident, or
                // a supervisory self-cancel/WAITING — see IsGenuinelyBlocked). Matches
                // GhostStatusLabel's own priority order (checked before Verifying/canceled)
                // so the headline pill and the inline ghost-card label can never disagree
                // about which bucket a genuinely-blocked row falls in. The "queued" branch
                // below no longer needs its own isBlocked check — this one already caught it.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x3A, 0x1E, 0x26)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "🔒 BLOCKED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "A real, declared blocker is still open on GitHub — see the ghost card below for which issue(s)."
                };
            }
            else if (item.Status == BuildQueuePostgresClient.VerifyingStatus)
            {
                // Git #1469 — session genuinely finished, but its real GitHub issue
                // hasn't closed yet; distinct from DONE so it's obvious this build
                // isn't fully archived/confirmed.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1A, 0x2E, 0x38)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x74, 0xC7, 0xEC)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "🔎 VERIFYING",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x74, 0xC7, 0xEC)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Session exited successfully — waiting for its real GitHub issue to be closed before this is marked Done."
                };
            }
            else if (item.Status == "done")
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1C, 0x35, 0x27)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "✨ DONE",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (IsCrashed(item))
            {
                // Git #3611 — distinct from the generic "✕ FAILED" pill below: this is
                // specifically the orphaned-by-crash subset (Git #1877's own criteria,
                // status=="failed" && ExitCode==-2), now surfaced directly in Queued/
                // "Running & Queued" instead of a dedicated (and rarely-checked) "Crashed"
                // tab — needs its own real, distinct pill so it doesn't read as an ordinary
                // failure Shane can ignore.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x3A, 0x16, 0x16)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xFF, 0x8A, 0x50)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "💥 CRASHED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFF, 0x8A, 0x50)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Orphaned by a crash — waiting to be manually restarted. Right-click for Restart/Recover, or use the ♻ Recover All banner."
                };
            }
            else if (item.Status == "failed")
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x3A, 0x1E, 0x26)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "✕ FAILED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (item.Status == Services.SessionLimitAutoRestartService.LimitPausedStatus)
            {
                // Session-limit auto-restart — parked by a "hit your session limit"
                // message; auto re-queued 10 minutes after the parsed reset.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x2A, 0x3A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "⏸ LIMIT — AUTO-RESTARTS",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (item.Status == "parked")
            {
                // Git #1638 — the Park staging area: deliberately never picked up by
                // GetNextAsync's WHERE status = 'queued' claim query. Neutral gray, not
                // any of the "in the pipeline" colors above, so it reads as staged rather
                // than waiting its turn.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x21, 0x22, 0x2E)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x6C, 0x70, 0x86)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "📥 PARKED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xB4, 0xCD)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Staged, not queued — use Un-park to send it into the real build queue."
                };
            }
            else if (item.Status == Services.AccountCapPolicy.CappedStatus)
            {
                // Git #1989 — Conservation Cap: the toggle was on and this build's
                // model/effort exceeded Sonnet High, so it was parked instead of
                // launched. Peach, not the neutral gray "parked" (#1638) above — a
                // deliberately different, more attention-getting color, since this is
                // real headroom Shane may want to spend via Run at Full Model or Drain,
                // not a passive staging spot he chose himself. Git #3611 — this pill
                // already existed and needed no changes; what changed is where a capped
                // row is now findable (Queued/RunningAndQueued in ApplyFilter) now that
                // the dedicated "Capped" tab is gone.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x2A, 0x20, 0x1A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "CAPPED — ABOVE SONNET HIGH",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Conservation Cap is on and this build's model/effort exceeds Sonnet High — right-click for Run at Full Model, or Drain from the title bar to release everything capped."
                };
            }
            else if (item.Status == "external")
            {
                // Git #1638 — a "Send to Builder" launch: outside the 8-slot cap, never
                // claimed by the watcher. Its real status column (done/failed once
                // scripts/run-claude.ps1 writes the exit code back) still drives the
                // pills above, so this only fires while it's genuinely still running.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x20, 0x30)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "🚀 EXTERNAL",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Launched via Send to Builder — outside the 8-slot cap, not watcher-claimable."
                };
            }
            else if (item.Status == BuildQueuePostgresClient.SupersededStatus)
            {
                // Git #2119 — this row was resolved by a Reply/resume: its session was taken over by
                // a fresh "Reply → …" row (SupersededById). Neutral violet, distinct from the active
                // pipeline colors, so it reads as "handed off, see #N" rather than still-in-flight.
                string replyRef = item.SupersededById.HasValue ? $" → #{item.SupersededById.Value}" : "";
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x24, 0x20, 0x2E)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xCB, 0xA6, 0xF7)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = $"↩ REPLIED{replyRef}",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xCB, 0xA6, 0xF7)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Replied to — its session was resumed under a new build" +
                              (item.SupersededById.HasValue ? $" (queue #{item.SupersededById.Value})." : ".") +
                              " This original row is closed out so it no longer sits in the active queue."
                };
            }
            else if (item.Status == "canceled" && item.ExitCode == 0)
            {
                // Git #3521 — a SUPERVISORY cancel is NOT abandoned work and must not read as "CANCELED"
                // (which Shane rightly reads as "this failed / stopped / was lost"). It is a 'canceled'
                // row with exit_code == 0: the build ran, exited clean, but landed no work because its
                // blocker wasn't done, so the false-done/board reconciler reset it to 'canceled' pending
                // re-dispatch. Once free flow catches it (QueueRowAsync, Git #3521) it auto-re-queues —
                // still-blocked rows wait behind the #1600 gate, blocker-cleared rows launch. So the
                // honest label is "waiting", amber not gray, distinct from both failed's red and a real
                // user-cancel's gray strike below. A user-cancelled queued row that never ran carries
                // exit_code NULL and still renders "🚫 CANCELED" via the branch below.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x33, 0x2A, 0x1E)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "⏳ WAITING",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Waiting to re-dispatch — a supervisory cancel, not lost work. The build exited " +
                              "cleanly but landed no work because its blocker wasn't done yet; it re-queues " +
                              "automatically once free flow catches it (blocked rows wait behind the launch " +
                              "gate, blocker-cleared rows launch). Git #3521."
                };
            }
            else if (item.Status == "canceled")
            {
                // Git #3514 — a canceled build is terminal, NOT up-next. Before this branch
                // existed it fell through to the "UP NEXT" else below and rendered as a genuine
                // claim candidate under the "All" view — while the "Queued" filter and the four
                // summary counts (which correctly key off status == "queued") showed it nowhere.
                // That was the exact divergence #3514 traced: #3471 (status 'canceled') visibly
                // tagged UP NEXT under All, but "In queue: 0 · Up next: 0". Muted gray with a
                // strike icon, deliberately distinct from failed's red — abandoned, not an error.
                // Git #3521 — this is now ONLY a genuine cancel (exit_code != 0, incl. NULL for a
                // queued row cancelled before it ran); supervisory cancels (exit 0) take the
                // "⏳ WAITING" branch above.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x25, 0x25, 0x30)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x58, 0x5B, 0x70)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "🚫 CANCELED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x93, 0x99, 0xB2)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Canceled — a terminal state, not waiting to run. Findable under the Canceled filter."
                };
            }
            else if (item.Status == "queued")
            {
                // Git #3514 — a genuinely queued, non-blocked row is a real claim candidate.
                // Git #3624/#3626 — the "🔒 BLOCKED" case for a queued row is now handled by
                // the shared `else if (isBlocked)` branch above (which fires for ANY status
                // at all — #3626 removed the eligible-status gate entirely), so reaching this
                // branch already means isBlocked is false; no ternary needed here.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x21, 0x22, 0x34)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x6C, 0x70, 0x86)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "⏳ UP NEXT",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xB4, 0xCD)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else
            {
                // Git #3514 — any status not explicitly handled above must NOT masquerade as
                // "UP NEXT". Render the real status string, neutral, so a new/unexpected DB
                // status is visible for what it is instead of being silently mislabeled a
                // claim candidate (the root of #3514: a fallthrough that assumed "everything
                // left is queued").
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x21, 0x22, 0x2E)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x6C, 0x70, 0x86)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = (item.Status ?? "unknown").ToUpperInvariant(),
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x93, 0x99, 0xB2)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "This build's status isn't one of the pipeline states — shown verbatim rather than assumed up-next."
                };
            }
            topRow.Children.Add(statusPill);

            if (item.GithubNumber.HasValue)
            {
                var numBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0)
                };
                numBadge.Child = new TextBlock
                {
                    Text = FormatIssueRef(item.GithubNumber.Value),
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)Application.Current.FindResource("PeachBrush")
                };
                topRow.Children.Add(numBadge);
            }

            // Git #1998 — model/effort badge, always visible in every card state (not gated
            // on Conservation Cap / #1989's toggle): the two values that decide whether a
            // build launches or gets parked shouldn't be hidden the rest of the time, and a
            // card that changes shape when the toggle flips is harder to read than one that
            // doesn't. Short form only ("Sonnet · High") — never the full model id.
            string? shortModel = ShortModelName(item.Model);
            string? shortEffort = ShortEffortName(item.Effort);
            if (shortModel != null || shortEffort != null)
            {
                string modelEffortText = shortModel != null && shortEffort != null
                    ? $"{shortModel} · {shortEffort}"
                    : (shortModel ?? shortEffort)!;
                var modelBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    ToolTip = "Model · effort this build launches (or launched) with"
                };
                modelBadge.Child = new TextBlock
                {
                    Text = modelEffortText,
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xB4, 0xCD))
                };
                topRow.Children.Add(modelBadge);
            }

            // Git #1998 — on a capped card, spell out which half of
            // AccountCapPolicy.ExceedsSonnetHigh actually tripped the gate (Opus, Fable, or
            // xhigh effort) instead of leaving Shane to reconstruct it from a bare status pill.
            // Reuses AccountCapPolicy's own IsOpusModel/IsFableModel/IsAboveHighEffort rather
            // than re-deriving the test. Peach to match the existing capped colour language
            // (#1989) — no new accent.
            if (item.Status == Services.AccountCapPolicy.CappedStatus)
            {
                var reasons = new List<string>();
                if (Services.AccountCapPolicy.IsOpusModel(item.Model)) reasons.Add("Opus");
                if (Services.AccountCapPolicy.IsFableModel(item.Model)) reasons.Add("Fable");
                if (Services.AccountCapPolicy.IsAboveHighEffort(item.Effort)) reasons.Add("xhigh effort");
                string reasonText = reasons.Count > 0 ? string.Join(" + ", reasons) : "unknown";
                var reasonBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x2A, 0x20, 0x1A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    ToolTip = $"Capped because: {reasonText}"
                };
                reasonBadge.Child = new TextBlock
                {
                    Text = $"⚠ {reasonText}",
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87))
                };
                topRow.Children.Add(reasonBadge);
            }

            if (_downstreamBlockCounts.TryGetValue(item.Id, out var blockCount) && blockCount > 0)
            {
                bool isTopBottleneck = blockCount == _maxDownstreamBlockCount && _maxDownstreamBlockCount > 1;
                var blockBadge = new Border
                {
                    Background = new SolidColorBrush(isTopBottleneck ? Color.FromRgb(0x45, 0x1A, 0x24) : Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(isTopBottleneck ? Color.FromRgb(0xF3, 0x8B, 0xA8) : Color.FromRgb(0x6C, 0x70, 0x86)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = isTopBottleneck
                        ? $"Critical path — {blockCount} downstream build(s) are waiting on this."
                        : $"Blocks {blockCount} downstream build(s) in the queue."
                };
                blockBadge.Child = new TextBlock
                {
                    Text = $"⛓ blocks {blockCount}",
                    FontSize = 9.5,
                    FontWeight = isTopBottleneck ? FontWeights.Bold : FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(isTopBottleneck ? Color.FromRgb(0xF3, 0x8B, 0xA8) : Color.FromRgb(0xBA, 0xB4, 0xCD)),
                    VerticalAlignment = VerticalAlignment.Center
                };
                topRow.Children.Add(blockBadge);
            }

            if (!string.IsNullOrWhiteSpace(item.OriginatingChatId) || !string.IsNullOrWhiteSpace(item.ChatUrl))
            {
                var chatBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x20, 0x30)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    Cursor = Cursors.Hand,
                    ToolTip = "Click to open/focus linked chat tab"
                };
                chatBadge.Child = new TextBlock
                {
                    Text = "💬 Chat",
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA))
                };
                chatBadge.MouseLeftButtonDown += (s, e) =>
                {
                    e.Handled = true;
                    QueueItemChatRequested?.Invoke(this, item);
                };
                topRow.Children.Add(chatBadge);
            }

            // Git #3742 — note-icon chip: only rendered when a note actually exists (no
            // empty-state placeholder). Hovering shows the real note text via ToolTip —
            // no dialog reopen needed to read it back.
            if (!string.IsNullOrWhiteSpace(item.Note))
            {
                var noteBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0)
                };
                noteBadge.Child = new TextBlock
                {
                    Text = "📝",
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF))
                };
                AttachBubbleTooltip(noteBadge, item.Note);
                topRow.Children.Add(noteBadge);
            }

            mainStack.Children.Add(topRow);

            // ── Second Row: Title Block ──
            var titleBlock = new TextBlock
            {
                Text = item.Title,
                FontSize = 11.5,
                FontWeight = FontWeights.Normal,
                Foreground = isPaused ? (Brush)Application.Current.FindResource("PeachBrush") : (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 1, 0)
            };
            SetQueueCardTooltip(card, item);
            mainStack.Children.Add(titleBlock);

            // ── Git #2692 — segmented step-bubble progress row ──
            // Reuses the exact same live BuildProgressTracker.GetProgress(item.Id) data
            // ChatSessionPane's RefreshProgress already renders in Build Watch. Fails closed
            // to exactly today's card (no extra row at all) when this build has never called
            // reportProgress — no fake/fixture bar. Subscribed to the same real
            // ProgressChanged event so it updates live without a full card rebuild.
            var progressBubbleRow = BuildProgressBubbleRow(item.Id);
            mainStack.Children.Add(progressBubbleRow);

            // ── Git #2795 — real Epic-name chip, right after the progress bubble row ──
            var epicChipRow = BuildEpicChipRow(item);
            if (epicChipRow != null) mainStack.Children.Add(epicChipRow);

            // ── Third Row: Extra info (blocker ghost cards, exit code) ──
            // Git #2070: gate on the same live-filtered set BuildWaitingOnText renders,
            // not the raw declared list — otherwise this row can render with an empty
            // "waiting on" string once every declared blocker has closed.
            // Git #2062: a bare "waiting on #N" text line left Shane to leave the card and
            // go find #N himself. Each genuinely-open blocker now gets its own real ghost
            // card (BuildBlockerGhostCard) inline instead — the blocker's real title/state,
            // not just its number.
            // Git #3620 — a self-blocked "⏳ WAITING" row (IsWaitingSelfBlocked) has
            // real open blocked_by data too; include it here the same way #3599
            // already folded it into the Queued/Running filter views.
            // Git #3624 — extended to a genuinely-blocked Verifying row (#3585's incident:
            // claimed and ran anyway, still shows a real open blocker).
            // Git #3626 — status gate removed entirely: a real, currently-open blocked_by
            // edge now renders its ghost card(s) regardless of this item's own raw status,
            // so the card's "🔒 BLOCKED" label is never shown without the ghost card(s)
            // naming which real issue(s) it's waiting on.
            if (LiveBlockedBy(node).Count > 0)
            {
                foreach (var blockerNumber in LiveBlockedBy(node))
                {
                    mainStack.Children.Add(BuildBlockerGhostCard(blockerNumber));
                }
            }
            // Git #3601 — reverse of the ghost cards above: this item's own real "Blocks:"
            // row, listing every other real queue item this one currently, genuinely blocks
            // (see ComputeReverseBlocks). Unlike the ghost-card row above, this isn't gated
            // on this item's own status — a running/verifying build routinely blocks a
            // queued one, and that's exactly the case Shane wants surfaced here.
            if (item.GithubNumber.HasValue && _reverseBlocks.TryGetValue(item.GithubNumber.Value, out var blockedItems) && blockedItems.Count > 0)
            {
                mainStack.Children.Add(BuildBlocksRow(blockedItems));
            }
            if (item.Status == "failed" && item.ExitCode.HasValue)
            {
                string orphanDetail = !string.IsNullOrEmpty(item.SessionId)
                    ? "orphaned by app restart/crash — Resume Session picks up where it left off"
                    : "orphaned by app restart/crash — no session captured, use Retry";
                mainStack.Children.Add(new TextBlock
                {
                    Text = item.ExitCode == -2 ? orphanDetail : $"exit code {item.ExitCode}",
                    FontSize = 10,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    Margin = new Thickness(1, 2, 0, 0)
                });
            }

            // ── 2-Column Card Grid (Full Width with Right-Spanning Mascot) ──
            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(mainStack, 0);
            cardGrid.Children.Add(mainStack);

            var interactiveState = _watcher?.GetInteractiveState(item.Id);
            var mascot = CreateQueueCardMascot(item, interactiveState);
            if (mascot != null)
            {
                Grid.SetColumn(mascot, 1);
                cardGrid.Children.Add(mascot);
            }

            // Git #1876 — quiet "a real log file exists for this queue id" dot, top-right
            // corner of the card. Cached/batched via BuildLogExistenceCache so hundreds of
            // cards rendering every poll tick cost one directory listing, not one
            // File.Exists per card. Deliberately unobtrusive — this is a diagnostic signal
            // ("did this genuinely start running"), not a status indicator; the status
            // pill above already owns that job.
            Grid cardOverlay;
            if (Services.BuildLogExistenceCache.HasLog(item.Id))
            {
                cardOverlay = new Grid();
                cardOverlay.Children.Add(cardGrid);
                cardOverlay.Children.Add(new Ellipse
                {
                    Width = 6,
                    Height = 6,
                    Fill = (Brush)Application.Current.FindResource("TealBrush"),
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = new Thickness(0, -4, -4, 0),
                    ToolTip = $"Log file exists — this build genuinely started running.\n{Services.BuildLogExistenceCache.PathFor(item.Id)}"
                });
                card.Child = cardOverlay;
            }
            else
            {
                card.Child = cardGrid;
            }

            // Context Menu
            card.ContextMenu = BuildCardContextMenu(item, node);

            return card;
        }

        /// <summary>
        /// Git #2795 — a small chip, same Border+TextBlock convention as this card's other real
        /// badges (chatBadge, blockBadge above), showing which real top-level Epic <paramref
        /// name="item"/>'s own GitHub issue belongs to. Resolved on-demand via
        /// <see cref="ResolveEpicForIssue"/> (MainWindow wires this to LeftSidebar's real
        /// ancestor-walk resolution — see that delegate's own doc comment). Returns null (renders
        /// nothing — no row at all) when the item carries no GitHub issue number, the delegate
        /// isn't wired yet, or the issue genuinely has no resolvable Epic ancestor (a real
        /// loose/unparented issue) — never a fake/placeholder Epic name.
        /// </summary>
        private FrameworkElement? BuildEpicChipRow(QueueItem item)
        {
            if (!item.GithubNumber.HasValue) return null;
            var epic = ResolveEpicForIssue?.Invoke(item.GithubNumber.Value);
            if (epic == null || string.IsNullOrWhiteSpace(epic.Title)) return null;

            var title = epic.Title.Trim();
            if (title.Length > 42) title = title.Substring(0, 39) + "…";

            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(1, 3, 0, 0) };
            var chip = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x20, 0x30)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x6C, 0x70, 0x86)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1.5, 5, 1.5),
                Cursor = Cursors.Hand,
                ToolTip = (epic.GithubNumber.HasValue ? $"Epic #{epic.GithubNumber}: {epic.Title.Trim()}" : epic.Title.Trim())
                    + "\n\nClick to activate this Epic's open chat tab, or reopen the last one."
            };
            chip.Child = new TextBlock
            {
                Text = $"◆ {title}",
                FontSize = 9.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xB4, 0xCD))
            };
            // Git #2801 — clicking the chip activates/reopens this Epic's chat tab; MainWindow
            // owns the actual open-tabs/persisted-tabs resolution (see EpicChipClicked doc comment).
            chip.MouseLeftButtonDown += (s, e) =>
            {
                e.Handled = true;
                EpicChipClicked?.Invoke(this, epic);
            };
            row.Children.Add(chip);
            return row;
        }

        /// <summary>
        /// Git #2692 — a compact row of small step bubbles, one per <c>BuildProgressReport.Total</c>,
        /// built from the exact same live <see cref="BuildProgressTracker.GetProgress"/> data
        /// <see cref="ChatSessionPane.RefreshProgress"/> already renders in Build Watch. Bubbles
        /// before the current step render full/filled (done), the current in-progress step renders
        /// active (visually distinct from both done and not-yet-started), and remaining steps render
        /// empty/waiting. A build that never calls reportProgress (report null or Total &lt;= 0)
        /// collapses this row entirely — the card looks exactly as it does today, no fake/fixture bar.
        /// Self-subscribes to <see cref="BuildProgressTracker.ProgressChanged"/> for this build's own
        /// id so the bubbles update live without a full card rebuild, same as ChatSessionPane's own
        /// column — and unsubscribes on Unloaded (this row is rebuilt fresh on every RenderQueue pass
        /// anyway, so a stale subscription would just leak, never misfire on the wrong card).
        /// </summary>
        private FrameworkElement BuildProgressBubbleRow(int queueItemId)
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Margin = new Thickness(1, 4, 1, 0),
                Visibility = Visibility.Collapsed
            };

            void Refresh()
            {
                row.Children.Clear();
                var report = BuildProgressTracker.GetProgress(queueItemId);
                if (report == null || report.Total <= 0)
                {
                    row.Visibility = Visibility.Collapsed;
                    return;
                }

                row.Visibility = Visibility.Visible;
                row.ToolTip = string.IsNullOrWhiteSpace(report.CurrentLabel)
                    ? $"{report.Step}/{report.Total} ({report.Percent:0}%)"
                    : $"{report.Step}/{report.Total} ({report.Percent:0}%) — {report.CurrentLabel}";

                for (int i = 1; i <= report.Total; i++)
                {
                    bool isFull = i < report.Step || (report.IsComplete && i <= report.Step);
                    bool isActive = !isFull && i == report.Step;

                    Brush fill = isFull
                        ? (Brush)Application.Current.FindResource("GreenBrush")
                        : (isActive
                            ? (Brush)Application.Current.FindResource("YellowBrush")
                            : (Brush)Application.Current.FindResource("Surface0Brush"));
                    Brush border = isFull
                        ? (Brush)Application.Current.FindResource("GreenBrush")
                        : (isActive
                            ? (Brush)Application.Current.FindResource("YellowBrush")
                            : (Brush)Application.Current.FindResource("Subtext1Brush"));

                    row.Children.Add(new Border
                    {
                        Width = 14,
                        Height = 5,
                        CornerRadius = new CornerRadius(2.5),
                        Background = fill,
                        BorderBrush = border,
                        BorderThickness = new Thickness(1),
                        Margin = new Thickness(0, 0, 3, 0)
                    });
                }
            }

            Refresh();

            void OnProgressChanged(BuildProgressReport report)
            {
                if (report.QueueItemId == queueItemId)
                    Refresh();
            }

            row.Loaded += (_, _) => BuildProgressTracker.ProgressChanged += OnProgressChanged;
            row.Unloaded += (_, _) => BuildProgressTracker.ProgressChanged -= OnProgressChanged;

            return row;
        }

        private void SelectNode(QueueGraphNode node, bool openLogPanel = false)
        {
            if (node.Item == null) return;
            _selectedQueueItemId = node.Item.Id;

            foreach (var n in _currentGraphNodes)
            {
                if (n.CardElement != null && n.Item != null)
                {
                    bool isThis = n.Item.Id == node.Item.Id;
                    n.CardElement.BorderThickness = new Thickness(isThis ? 1.8 : (n.IsWaitingForInput ? 1.5 : 1));
                    if (isThis)
                        n.CardElement.BorderBrush = (Brush)Application.Current.FindResource("BlueBrush");
                }
            }

            TaskSelected?.Invoke(this, new TaskSelectedEventArgs
            {
                QueueItemId = node.Item.Id,
                ExitCode = node.Item.ExitCode,
                Epic = node.Item.GithubNumber.HasValue ? FormatIssueRef(node.Item.GithubNumber.Value) : "",
                Task = node.Item.Title,
                Status = node.Item.Status,
                StatusDetails = LiveBlockedBy(node).Count > 0
                    ? CapitalizeFirst(BuildWaitingOnText(node, node.Item))
                    : "",
                OpenLogPanel = openLogPanel,
            });
        }

        /// <summary>
        /// Git #1600 — "Surface the hold reason in the queue UI: 'waiting on #NNNN
        /// (open)'. A held build must not look Ready or sit silently." Prefers the
        /// watcher's own real, current live-GitHub reason (set by
        /// BuildQueuePostgresClient.GetNextAsync's Step 2 every tick) so the badge
        /// reflects what the dispatch gate actually just decided, not a guess. Falls
        /// back to the plain declared-blocker list (no "(open)"/reachability detail)
        /// when the watcher hasn't evaluated this item yet this pass (e.g. no free
        /// slot that tick) or is running the HTTP-fallback path, which doesn't surface
        /// a reason back to this client.
        /// </summary>
        private string BuildWaitingOnText(QueueGraphNode node, QueueItem? item)
        {
            if (item != null && (_watcher?.HeldBlockerReasons.TryGetValue(item.Id, out var reason) ?? false))
                return reason;
            return $"waiting on {string.Join(", ", LiveBlockedBy(node).Select(FormatIssueRef))}";
        }

        /// <summary>
        /// Git #2070 — <see cref="IsGenuinelyBlocked"/> already filters a node's declared
        /// blockers against the live <see cref="_openIssues"/> set before deciding the
        /// 🔒 BLOCKED badge; <see cref="BuildWaitingOnText"/> was reading <c>node.BlockedBy</c>
        /// (raw declared blockers) directly, so once a blocker closed the badge correctly
        /// cleared but the "waiting on #N" text kept naming the closed issue. Applies the
        /// exact same live filter here so badge and text can never disagree. Cold start
        /// (_openIssues == null) falls back to the raw declared list, matching
        /// IsGenuinelyBlocked's own fail-safe.
        /// </summary>
        private List<int> LiveBlockedBy(QueueGraphNode node)
        {
            if (_openIssues == null) return node.BlockedBy;
            return node.BlockedBy.Where(b => _openIssues.Contains(b)).ToList();
        }

        /// <summary>Git #2062 — typed marker on a ghost blocker card's Tag: the real DOM anchor
        /// #2030's future click-to-highlight dependency chain system attaches to. That system is
        /// NOT built here — this only makes sure every blocked card has a stable, discoverable
        /// element to attach it to later, at every link in the chain, not just the two ends that
        /// happen to already be rendered near each other. IsLiveQueueNode tells that future work
        /// whether this ghost has a real sibling card in the same render to draw a line to.</summary>
        private readonly record struct BlockerGhostTag(int IssueNumber, bool IsLiveQueueNode);

        /// <summary>Git #3698 — what <see cref="BuildBlockerGhostCard"/> draws for one blocker, shared by
        /// the card itself and by <see cref="BlockerGhostKey"/> (part of a pooled card's
        /// <see cref="QueueCardKey"/>) so the two can never disagree about when a ghost card changed.</summary>
        private (QueueGraphNode? LiveNode, string Title, string StatusText, Color StatusColor) BlockerGhostInputs(int blockerNumber)
        {
            var liveNode = FindLiveNodeForBlocker(blockerNumber);
            if (liveNode != null)
            {
                var (liveStatusText, liveStatusColor) = GhostStatusLabel(liveNode);
                return (liveNode, liveNode.Title, liveStatusText, liveStatusColor);
            }

            string? cachedTitle;
            lock (_issueTitleCache) { _issueTitleCache.TryGetValue(blockerNumber, out cachedTitle); }
            return (null, cachedTitle ?? "", "○ OPEN", Color.FromRgb(0xF3, 0x8B, 0xA8));
        }

        private string BlockerGhostKey(int blockerNumber)
        {
            var (liveNode, title, statusText, statusColor) = BlockerGhostInputs(blockerNumber);
            return $"{blockerNumber}|{liveNode != null}|{liveNode?.Item?.Id}|{title}|{statusText}|{statusColor}";
        }

        /// <summary>Git #2062 — a blocked build's declared blocker rendered as a real, dimmed
        /// ghost/placeholder card (not plain "waiting on #N" text). Always built from real data:
        /// if the blocker is itself another node in this same queue render (<see cref="_currentGraphNodes"/>),
        /// its real title + current status (<see cref="GhostStatusLabel"/>, the same vocabulary
        /// <see cref="CreateGraphNodeDot"/> already uses); otherwise the blocker's real GitHub
        /// title via the existing <see cref="_issueTitleCache"/> background-fetch machinery
        /// (<see cref="TriggerBackgroundIssueTitleQueries"/>, extended to also warm blocker
        /// numbers) with an "OPEN" state — LiveBlockedBy already filtered this number down to a
        /// blocker <see cref="_openIssues"/> reports genuinely still open. Never invents a title:
        /// while the background fetch hasn't landed yet, this shows the bare issue ref only.
        /// Git #3600 — a blocker with no live queue row is no longer a dead end either: it's
        /// clickable too, just to a different real action — a distinct blue accent (vs. the
        /// live case's pink) tells the two apart at a glance.
        /// Git #3806 — that click is now pure navigate-or-notify, never a side effect: a primary
        /// click on a non-live ghost card used to attempt a real dispatch directly
        /// (<see cref="DispatchBlockerFromGhostCardAsync"/>), which could silently compose and
        /// send a dispatch-ask message into whatever chat happened to be active with zero
        /// confirmation of which chat that was — confirmed live and confusing. The primary click
        /// now only shows a real <see cref="ToastEngine"/> notice that the blocker has no build
        /// yet and isn't queued; the actual dispatch action moved to a separate, explicit "⚡
        /// Dispatch" control on the card, which still calls
        /// <see cref="DispatchBlockerFromGhostCardAsync"/> unchanged.</summary>
        private Border BuildBlockerGhostCard(int blockerNumber)
        {
            var (liveNode, title, statusText, statusColor) = BlockerGhostInputs(blockerNumber);
            bool isLive = liveNode != null;

            var card = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x1A, 0x14, 0x18)),
                // Git #3600 — blue accent (matches the RUNNING status color already used elsewhere
                // in this file) marks "click will attempt a real dispatch"; the pink accent stays
                // reserved for "click jumps to an already-live card".
                BorderBrush = new SolidColorBrush(isLive
                    ? Color.FromArgb(0x80, 0xF3, 0x8B, 0xA8)
                    : Color.FromArgb(0x80, 0x89, 0xB4, 0xFA)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(6, 3, 6, 3),
                Margin = new Thickness(1, 3, 0, 0),
                Opacity = 0.68,
                Cursor = Cursors.Hand,
                Tag = new BlockerGhostTag(blockerNumber, isLive),
                ToolTip = isLive
                    ? $"🔒 Blocked by {FormatIssueRef(blockerNumber)} — {title}\nClick to jump to its own build card."
                    : $"🔒 Blocked by {FormatIssueRef(blockerNumber)}" + (string.IsNullOrEmpty(title) ? "" : $" — {title}") +
                      "\nNot yet dispatched and not in the queue — click for status. Use the ⚡ Dispatch " +
                      "button to ask the active chat to write a BUILD: comment now."
            };

            var stack = new StackPanel();
            var topRow = new StackPanel { Orientation = Orientation.Horizontal };
            topRow.Children.Add(new TextBlock
            {
                Text = statusText,
                FontSize = 8.5,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(statusColor),
                VerticalAlignment = VerticalAlignment.Center
            });
            topRow.Children.Add(new TextBlock
            {
                Text = " " + FormatIssueRef(blockerNumber),
                FontSize = 8.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                Margin = new Thickness(4, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            });

            if (!isLive)
            {
                // Git #3806 — the one real control that still triggers
                // DispatchBlockerFromGhostCardAsync verbatim. Visually distinct from the rest of
                // the card (its own border/background, its own tooltip) and stops the click here
                // so it never falls through to the card's own navigate-or-notify handler below.
                var dispatchControl = new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(0x40, 0x89, 0xB4, 0xFA)),
                    BorderBrush = new SolidColorBrush(Color.FromArgb(0xA0, 0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 0, 4, 0),
                    Margin = new Thickness(6, 0, 0, 0),
                    Cursor = Cursors.Hand,
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = $"Dispatch {FormatIssueRef(blockerNumber)} — asks the active chat " +
                              "to write and post a BUILD: comment if none exists yet, then queues " +
                              "it. Acts on whichever chat is currently active."
                };
                dispatchControl.Child = new TextBlock
                {
                    Text = "⚡ Dispatch",
                    FontSize = 8,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA))
                };
                dispatchControl.MouseLeftButtonDown += (s, e) =>
                {
                    e.Handled = true;
                    _ = DispatchBlockerFromGhostCardAsync(blockerNumber);
                };
                topRow.Children.Add(dispatchControl);
            }

            stack.Children.Add(topRow);
            stack.Children.Add(new TextBlock
            {
                Text = string.IsNullOrEmpty(title) ? "(fetching title…)" : title,
                FontSize = 9.5,
                FontStyle = string.IsNullOrEmpty(title) ? FontStyles.Italic : FontStyles.Normal,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 1, 0, 0)
            });
            card.Child = stack;

            card.MouseLeftButtonDown += (s, e) =>
            {
                e.Handled = true;
                if (isLive)
                {
                    // Git #3599 — the blocker may not be in the currently-active filter's
                    // rendered set at all (that's exactly why FindLiveNodeForBlocker had to
                    // fall through to _lastItems above). RevealQueueItem already knows how to
                    // switch the active filter to whichever one actually shows this item before
                    // selecting/highlighting it, so navigation always lands somewhere the target
                    // is actually visible instead of a no-op click. Restart pseudo-nodes (no real
                    // Item, only RestartItem) have no queue row to reveal — same no-op they were
                    // before this fix (SelectNode itself no-ops when Item is null).
                    if (liveNode!.Item != null)
                        RevealQueueItem(liveNode.Item.Id);
                }
                else
                {
                    // Git #3806 — primary click is pure navigate-or-notify now: no live queue
                    // row exists for this blocker, so just say so plainly. No text is composed,
                    // no chat is touched, nothing is sent anywhere — that's what the separate
                    // "⚡ Dispatch" control (above) is for.
                    ToastEngine.Info($"Blocker {FormatIssueRef(blockerNumber)}",
                        $"{FormatIssueRef(blockerNumber)} has no build yet and isn't queued.");
                }
            };

            return card;
        }

        /// <summary>Git #3601 — the reverse of <see cref="BuildBlockerGhostCard"/>: a real
        /// "Blocks: #N, #M" row for a build card that itself genuinely blocks one or more
        /// other real queue items (<see cref="ComputeReverseBlocks"/>). Same real interaction
        /// model, reverse direction — each entry is a small clickable pill naming the blocked
        /// item's real issue ref, and clicking it calls <see cref="RevealQueueItem"/> (#3599)
        /// so navigation switches to whichever filter actually shows that item before
        /// selecting/highlighting it, regardless of which filter is currently active. No
        /// navigation logic is reimplemented here.</summary>
        private WrapPanel BuildBlocksRow(List<QueueItem> blockedItems)
        {
            var row = new WrapPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 3, 0, 0) };
            row.Children.Add(new TextBlock
            {
                Text = "🔗 Blocks:",
                FontSize = 9.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 4, 2)
            });

            foreach (var blocked in blockedItems.OrderBy(b => b.GithubNumber ?? b.Id))
            {
                string refText = blocked.GithubNumber.HasValue ? FormatIssueRef(blocked.GithubNumber.Value) : $"#{blocked.Id}";
                var pill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x14, 0x22, 0x28)),
                    BorderBrush = new SolidColorBrush(Color.FromArgb(0x80, 0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(0, 0, 4, 2),
                    Cursor = Cursors.Hand,
                    ToolTip = $"Blocks {refText} — {blocked.Title}\nClick to jump to its build card."
                };
                pill.Child = new TextBlock
                {
                    Text = refText,
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA))
                };
                int targetId = blocked.Id;
                pill.MouseLeftButtonDown += (s, e) =>
                {
                    e.Handled = true;
                    RevealQueueItem(targetId);
                };
                row.Children.Add(pill);
            }

            return row;
        }

        /// <summary>Git #3600 — guards a ghost-card dispatch click against a second click on the
        /// same blocker while the first attempt is still in flight (the real cross-flow race is
        /// already closed by <see cref="BuildQueuePostgresClient.TryClaimDispatchAsync"/> below;
        /// this just stops the same card from firing the whole sequence twice locally).</summary>
        private readonly HashSet<int> _ghostDispatchInFlight = new();

        /// <summary>Git #3600 — a not-yet-dispatched blocker ghost card's real click action: reuse
        /// the exact same "find its own BUILD: comment → claim-before-ask-active-chat if there is
        /// none yet → dedup-check → queue" path <see cref="IssueDispatchService.DispatchAsync"/>
        /// already gives <see cref="DispatchPanel"/> and the Git Board hover popover — no second
        /// dispatch path invented here. Every branch below mirrors DispatchPanel.DispatchAsync's
        /// own switch verbatim; the only real difference is reporting via <see cref="ToastEngine"/>
        /// (this panel has no status line of its own) instead of a status TextBlock. A blocker
        /// whose own blockers are still open is NOT silently no-op'd: IssueDispatchService still
        /// queues it (same fail-closed convention every other dispatch entry point already uses —
        /// a real blocker holds a build after queueing, it doesn't refuse to queue it at all), and
        /// the toast names the real open blocker number(s), which doubles as the honest "why not"
        /// explanation the issue asked for. A genuinely un-dispatchable case (no PAT, issue not
        /// found, GitHub unreachable, no DB, or the active-chat ask itself failing/having nowhere
        /// to go) surfaces as a real toast naming the actual reason — never a silent no-op.</summary>
        private async Task DispatchBlockerFromGhostCardAsync(int blockerNumber)
        {
            if (!_ghostDispatchInFlight.Add(blockerNumber)) return;
            try
            {
                var result = await IssueDispatchService.DispatchAsync(_db, blockerNumber);

                switch (result.Outcome)
                {
                    case DispatchOutcome.NoBuildComment:
                        // Git #3509 — claim BEFORE asking any chat to write+post a BUILD: comment,
                        // the same guard DispatchPanel's own NoBuildComment branch uses, so a click
                        // here can never race a concurrent Dispatch-box/Git-Board-popover ask (or
                        // another ghost-card click elsewhere) targeting the same issue.
                        var claim = _db != null
                            ? await _db.TryClaimDispatchAsync(blockerNumber, "BuildConsole:BuildQueuePanel:GhostCard")
                            : new BuildQueuePostgresClient.DispatchClaimResult { Claimed = true };

                        if (!claim.Claimed)
                        {
                            var heldFor = claim.ExistingClaimedAtUtc.HasValue ? DateTime.UtcNow - claim.ExistingClaimedAtUtc.Value : (TimeSpan?)null;
                            ToastEngine.Info($"Blocker #{blockerNumber}",
                                $"Already being dispatched (claimed by {claim.ExistingClaimedBy ?? "another flow"}" +
                                (heldFor.HasValue ? $", {Math.Max(0, (int)heldFor.Value.TotalMinutes)}m ago" : "") +
                                ") — not asking the active chat again.");
                            ActivityLog.Log("dispatch", $"Ghost-card dispatch #{blockerNumber} — dispatch claim already held by {claim.ExistingClaimedBy ?? "unknown"}; skipped duplicate ask (Git #3509).");
                            return;
                        }

                        ActivityLog.Log("dispatch", $"Ghost-card dispatch #{blockerNumber} \"{result.IssueTitle}\" — no BUILD: comment found, asking active chat.");
                        var mainWindow = Application.Current.MainWindow as MainWindow;
                        string askStatus = mainWindow != null
                            ? await mainWindow.SendToActiveChatAsync(ActiveChatBuildRequestHelper.BuildAskMessage(blockerNumber, result.IssueTitle ?? $"#{blockerNumber}"))
                            : "no-active-chat";

                        var (message, isError) = ActiveChatBuildRequestHelper.DescribeStatus(askStatus, blockerNumber);
                        if (isError) ToastEngine.Warning($"Blocker #{blockerNumber}", message);
                        else ToastEngine.Info($"Blocker #{blockerNumber}", message);
                        ActivityLog.Log("dispatch", $"Ghost-card dispatch #{blockerNumber} — ask-active-chat status: {askStatus}");
                        return;

                    case DispatchOutcome.AlreadyTracked:
                        ToastEngine.Info($"Blocker #{blockerNumber}", result.Message);
                        return;

                    case DispatchOutcome.Queued:
                        ToastEngine.Success($"Blocker #{blockerNumber} queued", result.Message);
                        break;

                    case DispatchOutcome.QueuedButBlocked:
                        ToastEngine.Warning($"Blocker #{blockerNumber} queued, held", result.Message);
                        break;

                    default:
                        // NoPat / GitHubUnreachable / IssueNotFound / NoDb / Failed
                        ToastEngine.Error($"Blocker #{blockerNumber}", result.Message);
                        return;
                }

                await RefreshAsync();
            }
            catch (Exception ex)
            {
                ToastEngine.Error($"Blocker #{blockerNumber}", $"Dispatch failed: {ex.Message}");
                ActivityLog.Log("dispatch", $"Ghost-card dispatch #{blockerNumber} — FAILED: {ex.Message}");
            }
            finally
            {
                _ghostDispatchInFlight.Remove(blockerNumber);
            }
        }

        /// <summary>Git #2062 — short status label + color for a blocker that is itself a live
        /// node in this queue render, mirroring the exact vocabulary <see cref="CreateGraphNodeDot"/>
        /// already uses for these same states (RUNNING/BLOCKED/DONE/etc.) — the ghost card is
        /// showing the same real build, just inline on the blocked card instead of on the
        /// mini-map dot.</summary>
        private (string text, Color color) GhostStatusLabel(QueueGraphNode node)
        {
            if (node.IsWaitingForInput) return ("❓ ASK QUESTION", Color.FromRgb(0xF9, 0xE2, 0xAF));
            // Git #3700 — same no-gating priority as BuildQueueCard's own pill.
            if (node.IsAskingShane) return ("❓ NEEDS YOUR INPUT", Color.FromRgb(0xF5, 0xC2, 0xE7));
            if (node.Status == "running") return ("▶ RUNNING", Color.FromRgb(0x89, 0xB4, 0xFA));
            if (node.Item != null && BuildConsoleSettings.Load().PausedBuildIds.Contains(node.Item.Id))
                return ("⏸ PAUSED", Color.FromRgb(0xFA, 0xB3, 0x87));
            if (node.IsBlocked) return ("🔒 BLOCKED", Color.FromRgb(0xF3, 0x8B, 0xA8));
            if (node.Status == BuildQueuePostgresClient.VerifyingStatus) return ("🔎 VERIFYING", Color.FromRgb(0x74, 0xC7, 0xEC));
            if (node.Status == "done") return ("✨ DONE", Color.FromRgb(0xA6, 0xE3, 0xA1));
            if (node.Status == "failed") return ("✕ FAILED", Color.FromRgb(0xF3, 0x8B, 0xA8));
            if (node.Status == "restart") return ("🔄 RESTART", Color.FromRgb(0xCB, 0xA6, 0xF7));
            // Git #3521 — a supervisory cancel (exit 0, work never landed, pending re-dispatch) is
            // waiting, not abandoned; amber "WAITING" mirrors the queue card's own pill. A genuine
            // cancel (exit_code != 0/NULL) keeps the gray strike below.
            if (node.Status == "canceled" && node.Item?.ExitCode == 0) return ("⏳ WAITING", Color.FromRgb(0xF9, 0xE2, 0xAF));
            // Git #3514 — a canceled blocker is terminal, not up-next; don't let it fall
            // through to the "UP NEXT" label below.
            if (node.Status == "canceled") return ("🚫 CANCELED", Color.FromRgb(0x93, 0x99, 0xB2));
            // Git #3514 — only a genuinely queued ghost is "UP NEXT"; any other status shows
            // verbatim rather than masquerading as a claim candidate.
            if (node.Status == "queued") return ("⏳ UP NEXT", Color.FromRgb(0xBA, 0xB4, 0xCD));
            return ((node.Status ?? "unknown").ToUpperInvariant(), Color.FromRgb(0x93, 0x99, 0xB2));
        }

        private static string CapitalizeFirst(string s) =>
            string.IsNullOrEmpty(s) ? s : char.ToUpperInvariant(s[0]) + s.Substring(1);

        /// <summary>Git #1998 — short display name for a model id ("claude-sonnet-5" → "Sonnet"),
        /// used on the compact queue card badge. Reuses AccountCapPolicy's own Opus/Fable
        /// detection rather than re-deriving it. Null in, null out — a missing model renders as
        /// nothing on the card, never an invented default. An id this doesn't recognize is
        /// returned as-is rather than guessed at.</summary>
        private static string? ShortModelName(string? model)
        {
            if (string.IsNullOrWhiteSpace(model)) return null;
            if (Services.AccountCapPolicy.IsOpusModel(model)) return "Opus";
            if (Services.AccountCapPolicy.IsFableModel(model)) return "Fable";
            if (model.Contains("sonnet", StringComparison.OrdinalIgnoreCase)) return "Sonnet";
            if (model.Contains("haiku", StringComparison.OrdinalIgnoreCase)) return "Haiku";
            return model;
        }

        /// <summary>Git #1998 — short display form for an effort value. "xhigh" stays lowercase
        /// (matches Shane's own "Opus · xhigh" example on #1998); everything else is
        /// capitalized ("high" → "High"). Null in, null out.</summary>
        private static string? ShortEffortName(string? effort)
        {
            if (string.IsNullOrWhiteSpace(effort)) return null;
            return effort.Equals("xhigh", StringComparison.OrdinalIgnoreCase)
                ? "xhigh"
                : char.ToUpperInvariant(effort[0]) + effort.Substring(1).ToLowerInvariant();
        }

        /// <summary>
        /// Shane, 2026-08-30 — mirrors a local Park/Un-park onto the real GitHub Project
        /// board: "Create a new Bucket in Git like the 'Batter Up' called 'Park' and
        /// move the Git issue there... then it pulls it out of the Batter Up queue,
        /// puts it in its own queue away from the build." Fire-and-forget by design
        /// (same shape as UnparkAsync's in-flight/complete label sync) — a slow or
        /// failed GitHub call should never block the local park/un-park it's paired
        /// with, since the local 'parked' status is already the source of truth for
        /// BuildConsole itself. No-op when the item has no linked GitHub issue or no
        /// PAT is configured.
        /// </summary>
        private static void SyncGitHubParkStatus(int? githubNumber, string optionId, string actionLabel)
            // Git #2136 — now delegates to the shared BoardStatusSync.Mirror primitive so Park,
            // Verifying and Crashed all move the board through one code path (no divergent copy of
            // the fire-and-forget/settings/log shape). Behaviour is unchanged for Park.
            => Services.BoardStatusSync.Mirror(githubNumber, optionId, actionLabel, "build-queue");

        /// <summary>
        /// Shane: "All builds no matter their status should be able to be parked" —
        /// the Park item offered on every status that isn't 'running' (which stops a
        /// live process first, see the dedicated running-branch Park above),
        /// 'queued'/'limit-paused' (which have their own Park with slightly different
        /// wording) or 'parked' itself (Un-park is the inverse there). Covers
        /// 'verifying', 'done', 'failed', 'canceled', and 'external' — a build in any
        /// of those states can still be genuinely blocked on something else and worth
        /// staging out of sight until that clears, via <see cref="BuildQueuePostgresClient.ParkAnyAsync"/>.
        /// </summary>
        private MenuItem BuildParkAnyMenuItem(QueueItem item)
        {
            var mi = new MenuItem { Header = "🅿️ Park" };
            mi.Click += async (_, _) =>
            {
                if (_db == null)
                {
                    ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                    return;
                }
                try
                {
                    if (await _db.ParkAnyAsync(item.Id, item.SessionId))
                    {
                        ToastEngine.Success("Parked", $"Staged, not queued: {item.Title}");
                        ActivityLog.Log("build-queue", $"Parked queue item #{item.Id} ({item.Title}), was {item.Status}.");
                        SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                    }
                    else
                        ToastEngine.Warning("Park", $"Already parked: {item.Title}");
                }
                catch (Exception ex)
                {
                    ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                }
                await RefreshAsync();
            };
            return mi;
        }

        #region Git #2061 — quick-action wrappers for the Git Board issue-hover popover
        // Thin public wrappers around the exact same _watcher/_db/_api calls the right-click
        // menu items below use (#2030's confirmed inventory) — LeftSidebar's new issue-hover
        // popover (Controls/LeftSidebar.xaml.cs) calls these via delegate properties MainWindow
        // wires up, rather than duplicating the menu's logic. Kept alongside BuildCardContextMenu
        // so the two stay obviously in sync if either changes.

        /// <summary>Same body as the "⚡ Start Now" menu item below (queued -> dispatch now,
        /// respects the concurrency cap unlike "Run Now").</summary>
        public async System.Threading.Tasks.Task QuickDispatchAsync(QueueItem item)
        {
            if (_watcher == null)
            {
                ToastEngine.Info("Start Now", "The in-app watcher isn't active, so Start Now can't launch locally. The background service will pick it up.");
                return;
            }
            try
            {
                var result = await _watcher.StartNowAsync(item.Id, item.Title);
                if (result.Outcome == Services.QueueWatcherService.StartNowOutcome.Launched)
                    ToastEngine.Success("Start Now", result.Message);
                else
                    ToastEngine.Warning("Start Now", result.Message);
            }
            catch (Exception ex)
            {
                ToastEngine.Warning("Start Now", $"Couldn't launch immediately: {ex.Message}");
            }
            await RefreshAsync();
        }

        /// <summary>Same body as "⏹ Stop" (running) / "✕ Cancel" (queued) below, branched the
        /// same way on item.Status.</summary>
        public async System.Threading.Tasks.Task QuickCancelOrStopAsync(QueueItem item)
        {
            if (item.Status == "running")
            {
                bool stopped = _watcher?.TryStop(item.Id) ?? false;
                _watcher?.ReleaseInteractive(item.Id);
                try
                {
                    if (_db != null)
                        await _db.MarkCompleteAsync(item.Id, -1);
                    else if (_api != null)
                        await _api.MarkQueueItemCompleteAsync(item.Id, -1);
                }
                catch (Exception ex) { ToastEngine.Error("Stop Build", $"Couldn't update database: {ex.Message}"); }
                if (stopped)
                    ToastEngine.Success("Build Stopped", $"Stopped: {item.Title}");
                else
                    ToastEngine.Warning("Build Stopped", $"Marked stopped in DB (no active local process handle): {item.Title}");
            }
            else
            {
                if (_db == null && _api == null)
                {
                    ToastEngine.Warning("Cancel", "Not connected — can't cancel.");
                    return;
                }
                try
                {
                    bool canceled = _db != null
                        ? await _db.CancelAsync(item.Id)
                        : (await _api!.CancelQueueItemAsync(item.Id)).IsSuccessStatusCode;
                    if (canceled)
                        ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                    else
                        ToastEngine.Warning("Cancel", $"Couldn't cancel — it already started running: {item.Title}");
                }
                catch (Exception ex)
                {
                    ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                }
            }
            await RefreshAsync();
        }

        /// <summary>Git #3728 — see <see cref="ResumeOnlyQueueRows"/> for why a reply/continuation
        /// row cannot be "started over" and what the two title prefixes are.</summary>
        private const string ReplyTitlePrefix = ResumeOnlyQueueRows.ReplyTitlePrefix;

        /// <summary>Git #3728 — true when this row's <see cref="QueueItem.Prompt"/> is a
        /// conversational message rather than a standalone build prompt (a "💬 Reply…" row or a
        /// Build Watch "Continue:" row). Such a row means nothing without the session in
        /// <see cref="QueueItem.ResumeSessionId"/> — "Retry" on one must re-deliver the same
        /// message to the same conversation, NOT start a cold session over from a fragment.</summary>
        private static bool IsResumeOnlyRow(QueueItem item) =>
            ResumeOnlyQueueRows.IsResumeOnlyTitle(item.Title);

        /// <summary>Same body as "🔄 Retry (start over)" below. A normal row re-queues with
        /// resumeSessionId: null — a genuine start-over — while a reply row (Git #3728) carries its
        /// session forward, because "start the original prompt over" is incoherent when the prompt
        /// is a chat message. The crash-recovery "▶ Resume Session" variant stays
        /// right-click-menu-only since it's a narrower case than this card's general
        /// Failed -> Retry action.</summary>
        public async System.Threading.Tasks.Task QuickRetryAsync(QueueItem item)
        {
            if (_db == null)
            {
                ToastEngine.Warning("Retry", "No direct DB connection — can't retry.");
                return;
            }
            if (!TryResolveRetryResumeSessionId(item, out string? retryResumeSessionId)) return;
            try
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, retryResumeSessionId, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                ToastEngine.Success("Re-queued", retryResumeSessionId == null
                    ? $"Re-queued: {item.Title}"
                    : $"Re-sending your reply to the same session: {item.Title}");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Retry Failed", $"Couldn't re-queue build: {ex.Message}");
            }
            await RefreshAsync();
        }

        /// <summary>Git #3728 — decides what a Retry of <paramref name="item"/> should resume.
        /// Returns false when the retry must not be queued at all.
        ///
        /// Three cases:
        /// <list type="bullet">
        /// <item>Ordinary row → <c>null</c>: start over from its own self-contained prompt, unchanged.</item>
        /// <item>Resume-only row with a session → that session: re-deliver the same message to the
        /// same conversation, which is the only reading of "retry this reply" that means anything.</item>
        /// <item>Resume-only row with NO session → refuse. This is the already-damaged row produced
        /// by the bug itself (live instances: queue #2382 <c>"Retry"</c>, #462 <c>"retry"</c>,
        /// #480 <c>"try again"</c>). Re-queuing it would mint a second cold session fed the same
        /// fragment; saying so plainly and pointing at the real fix is honest, silently doing it
        /// again is not.</item>
        /// </list></summary>
        private static bool TryResolveRetryResumeSessionId(QueueItem item, out string? resumeSessionId)
        {
            resumeSessionId = null;
            if (!IsResumeOnlyRow(item)) return true;

            if (string.IsNullOrWhiteSpace(item.ResumeSessionId))
            {
                ToastEngine.Warning("Retry",
                    "This row has no session left to resume, so retrying it would just start a " +
                    "fresh session with your message and no conversation. Reply to the original " +
                    "build instead.");
                return false;
            }

            resumeSessionId = item.ResumeSessionId;
            return true;
        }

        /// <summary>Same body as "💬 Reply…" below, minus the modal prompt dialog — the
        /// popover's own inline text box supplies the message directly.</summary>
        public async System.Threading.Tasks.Task QuickReplyAsync(QueueItem item, string message)
        {
            if (_db == null)
            {
                ToastEngine.Warning("Reply", "Not connected (no direct DB) — can't queue a reply.");
                return;
            }
            string? sid = !string.IsNullOrWhiteSpace(item.SessionId) ? item.SessionId : _watcher?.GetSessionId(item.Id);
            if (string.IsNullOrWhiteSpace(sid))
            {
                ToastEngine.Warning("Reply", "No session id captured for this build yet — nothing to resume.");
                return;
            }
            try
            {
                var replyRow = await _db.QueueBuildAsync(
                    ReplyTitlePrefix + item.Title, message, item.Model, item.Effort, item.Cwd,
                    githubNumber: null, blockedByNumbers: null,
                    resumeSessionId: sid, chatUrl: item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                // Git #2119 — resolve the ORIGINAL row so its card doesn't sit stuck showing stale
                // active status forever while the resumed work runs under this new "Reply → …" entry.
                int superseded = await _db.MarkSupersededByReplyAsync(item.Id, replyRow.Id);
                ActivityLog.Log("interactive-build",
                    $"Reply queued for queue #{item.Id} ({item.Title}) — resuming session {sid} with a {message.Length}-char message (via Git Board hover popover). New row #{replyRow.Id}" +
                    (superseded > 0 ? $"; original #{item.Id} marked superseded → #{replyRow.Id}." : $"; original #{item.Id} left as-is (running or already terminal)."));
                ToastEngine.Success("Reply queued", $"Resuming the session for “{item.Title}” with your message.");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Reply Failed", $"Couldn't queue the reply: {ex.Message}");
            }
            await RefreshAsync();
        }

        /// <summary>Same effect as the "💬 Open Originating Chat" menu item / chat badge below.</summary>
        public void QuickOpenChat(QueueItem item) => QueueItemChatRequested?.Invoke(this, item);

        #endregion

        private ContextMenu BuildCardContextMenu(QueueItem item, QueueGraphNode node)
        {
            var cm = new ContextMenu();

            var miOpenChat = new MenuItem { Header = "💬 Open Originating Chat" };
            miOpenChat.Click += (_, _) =>
            {
                QueueItemChatRequested?.Invoke(this, item);
            };
            cm.Items.Add(miOpenChat);

            // Git #2689 — plain click only selects/highlights now; this is the explicit
            // way to force the bottom Build Log panel open for a given card.
            var miOpenBuildLog = new MenuItem { Header = "📋 Open Build Log" };
            miOpenBuildLog.Click += (_, _) => SelectNode(node, openLogPanel: true);
            cm.Items.Add(miOpenBuildLog);

            var miMarkComplete = new MenuItem { Header = "✓ Mark Complete (Hide)" };
            miMarkComplete.Click += async (_, _) =>
            {
                _manuallyHiddenQueueIds.Add(item.Id);
                try
                {
                    if (_db != null)
                        await _db.MarkCompleteAsync(item.Id, 0);
                    else if (_api != null)
                        await _api.MarkQueueItemCompleteAsync(item.Id, 0);
                }
                catch { }
                if (item.Status == "running")
                {
                    _watcher?.TryStop(item.Id);
                }
                _watcher?.ReleaseInteractive(item.Id);
                ActivityLog.Log("build-queue", $"Marked queue item #{item.Id} ({item.Title}) complete & hidden.");
                await RefreshAsync();
            };
            cm.Items.Add(miMarkComplete);

            // Git #3742 — "Add Note…"/"Edit Note…", available for EVERY card regardless of
            // item.Status (no status guard, matching the issue's explicit "any status" ask —
            // Running/Blocked/Waiting/Ask-Shane/Done all get it). Label reflects real current
            // state rather than always saying "Add".
            var miNote = new MenuItem
            {
                Header = string.IsNullOrWhiteSpace(item.Note) ? "📝 Add Note…" : "📝 Edit Note…"
            };
            miNote.Click += async (_, _) =>
            {
                if (_db == null)
                {
                    ToastEngine.Warning("Note", "No direct DB connection — can't save a note.");
                    return;
                }
                string? text = PromptForNoteText(item.Title, item.Note);
                if (text == null) return; // cancelled
                try
                {
                    await _db.SetNoteAsync(item.Id, text);
                    ActivityLog.Log("build-queue", string.IsNullOrWhiteSpace(text)
                        ? $"Cleared note on queue item #{item.Id} ({item.Title})."
                        : $"Saved note on queue item #{item.Id} ({item.Title}).");
                    await RefreshAsync();
                }
                catch (Exception ex)
                {
                    ToastEngine.Error("Note Failed", $"Couldn't save the note: {ex.Message}");
                }
            };
            cm.Items.Add(miNote);
            cm.Items.Add(new Separator());

            // Reply… — send a message to THIS build and resume its exact Claude session with
            // it (claude --resume <session-id> "<your message>"). Available for any build that
            // has a captured session id, whatever its status (running/done/failed) — the escape
            // hatch for when the interactive question-detection misses (e.g. an unrecognized
            // A/B choice) and there is otherwise no way to answer. A live running build's id
            // comes from the watcher; a finished build's from its persisted session_id.
            string? replySessionId = !string.IsNullOrWhiteSpace(item.SessionId)
                ? item.SessionId
                : _watcher?.GetSessionId(item.Id);
            if (!string.IsNullOrWhiteSpace(replySessionId))
            {
                var miReply = new MenuItem { Header = "💬 Reply… (resume this session with a message)" };
                miReply.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Reply", "Not connected (no direct DB) — can't queue a reply.");
                        return;
                    }
                    // Re-resolve at click time — a still-running build may only have revealed
                    // its session id after this menu was built.
                    string? sid = !string.IsNullOrWhiteSpace(item.SessionId)
                        ? item.SessionId
                        : _watcher?.GetSessionId(item.Id);
                    if (string.IsNullOrWhiteSpace(sid))
                    {
                        ToastEngine.Warning("Reply", "No session id captured for this build yet — nothing to resume.");
                        return;
                    }

                    string? message = PromptForReplyMessage(item.Title);
                    if (string.IsNullOrWhiteSpace(message)) return;

                    try
                    {
                        // Fresh row (githubNumber: null) so we never dedupe onto — and re-queue
                        // out from under — a row that may still be running. resumeSessionId makes
                        // the watcher launch `claude --resume <sid> "<message>"`.
                        var replyRow = await _db.QueueBuildAsync(
                            ReplyTitlePrefix + item.Title, message, item.Model, item.Effort, item.Cwd,
                            githubNumber: null, blockedByNumbers: null,
                            resumeSessionId: sid, chatUrl: item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                        // Git #2119 — resolve the ORIGINAL row so its card doesn't sit stuck showing
                        // stale active status forever while the resumed work runs under the new row.
                        int superseded = await _db.MarkSupersededByReplyAsync(item.Id, replyRow.Id);
                        ActivityLog.Log("interactive-build",
                            $"Reply queued for queue #{item.Id} ({item.Title}) — resuming session {sid} with a {message.Length}-char message. New row #{replyRow.Id}" +
                            (superseded > 0 ? $"; original #{item.Id} marked superseded → #{replyRow.Id}." : $"; original #{item.Id} left as-is (running or already terminal)."));
                        ToastEngine.Success("Reply queued", $"Resuming the session for “{item.Title}” with your message.");
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Reply Failed", $"Couldn't queue the reply: {ex.Message}");
                    }
                };
                cm.Items.Add(miReply);
                cm.Items.Add(new Separator());
            }

            if (item.Status == "running")
            {
                if (_watcher?.OwnsInteractive(item.Id) == true)
                {
                    var miResume = new MenuItem { Header = "⏵ Resume (unstick after network loss)" };
                    miResume.Click += async (_, _) =>
                    {
                        if (_watcher == null) return;
                        ActivityLog.Log("interactive-build", $"Resume invoked from Build Queue context menu: {item.Title} (queue #{item.Id})");
                        await _watcher.RequestResumeAsync(item.Id);
                        await RefreshAsync();
                    };
                    cm.Items.Add(miResume);
                }

                var miStop = new MenuItem { Header = "⏹ Stop" };
                miStop.Click += async (_, _) =>
                {
                    bool stopped = _watcher?.TryStop(item.Id) ?? false;
                    _watcher?.ReleaseInteractive(item.Id);
                    try
                    {
                        if (_db != null)
                            await _db.MarkCompleteAsync(item.Id, -1);
                        else if (_api != null)
                            await _api.MarkQueueItemCompleteAsync(item.Id, -1);
                    }
                    catch (Exception ex) { ToastEngine.Error("Stop Build", $"Couldn't update database: {ex.Message}"); }
                    if (stopped)
                        ToastEngine.Success("Build Stopped", $"Stopped: {item.Title}");
                    else
                        ToastEngine.Warning("Build Stopped", $"Marked stopped in DB (no active local process handle): {item.Title}");
                    await RefreshAsync();
                };
                cm.Items.Add(miStop);

                // Shane: "sometimes a build agent decides it cannot continue until
                // something is unblocked" — a real mid-session state, distinct from
                // Stop (marks it failed/canceled, abandons the conversation). Park
                // stops the process but preserves resume_session_id and stages the
                // row in the same 'parked' lot as queued/limit-paused Park, so it's
                // out of the active queue until the blocker clears and Un-park (or
                // "I tell it to build again") resumes the exact session.
                var miParkRunning = new MenuItem { Header = "🅿️ Park (blocked on something else)" };
                miParkRunning.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                        return;
                    }
                    string? sid = !string.IsNullOrWhiteSpace(item.SessionId)
                        ? item.SessionId
                        : _watcher?.GetSessionId(item.Id);
                    _watcher?.TryStop(item.Id);
                    _watcher?.ReleaseInteractive(item.Id);
                    try
                    {
                        if (await _db.ParkRunningAsync(item.Id, sid))
                        {
                            ToastEngine.Success("Parked", $"Stopped and staged for later: {item.Title}");
                            ActivityLog.Log("build-queue", $"Parked running queue item #{item.Id} ({item.Title}) — stopped and staged" +
                                (string.IsNullOrWhiteSpace(sid) ? ", no session id captured so Un-park will start it over." : "; Un-park will resume its session."));
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                        }
                        else
                            ToastEngine.Warning("Park", $"No longer running: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miParkRunning);
            }
            else if (item.Status == "queued")
            {
                bool isItemPaused = BuildConsoleSettings.Load().PausedBuildIds.Contains(item.Id);
                var miPauseBuild = new MenuItem { Header = isItemPaused ? "▶ Allow Build" : "⏸ Pause Build" };
                miPauseBuild.Click += async (_, _) =>
                {
                    var settings = BuildConsoleSettings.Load();
                    if (settings.PausedBuildIds.Contains(item.Id))
                    {
                        settings.PausedBuildIds.Remove(item.Id);
                        ActivityLog.Log("build-queue", $"Allowed build queue item #{item.Id} ({item.Title}) to run");
                    }
                    else
                    {
                        settings.PausedBuildIds.Add(item.Id);
                        ActivityLog.Log("build-queue", $"Paused build queue item #{item.Id} ({item.Title})");
                    }
                    settings.Save();
                    await RefreshAsync();
                };
                cm.Items.Add(miPauseBuild);

                var miRunNow = new MenuItem { Header = "🚀 Run Now" };
                miRunNow.Click += async (_, _) =>
                {
                    if (_watcher == null || _api == null)
                    {
                        ToastEngine.Info("Run Now", "The in-app watcher isn't active, so Run Now can't launch locally. The background service will pick it up.");
                        return;
                    }
                    try
                    {
                        var settings = BuildConsoleSettings.Load();
                        if (settings.PausedBuildIds.Contains(item.Id))
                        {
                            settings.PausedBuildIds.Remove(item.Id);
                            settings.Save();
                        }

                        QueueItem claimed;
                        if (_db != null)
                            claimed = await _db.ForceClaimAsync(item.Id);
                        else
                            claimed = await _api.ForceClaimQueueItemAsync(item.Id);
                        _watcher.ForceLaunch(claimed);
                        ToastEngine.Success("Run Now", $"Launched: {item.Title}");
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Warning("Run Now", $"Couldn't launch immediately: {ex.Message}");
                    }
                };
                cm.Items.Add(miRunNow);

                // Git #1805 — "Start Now": Shane's own click is the explicit override for whatever
                // is holding this ONE row (a real blocked_by dependency, or just poll timing) — but
                // unlike Run Now above, it respects a genuinely full concurrency cap rather than
                // ever exceeding it. See QueueWatcherService.StartNowAsync for the full contract and
                // the watcher-channel logging of exactly what was overridden.
                var miStartNow = new MenuItem { Header = "⚡ Start Now" };
                miStartNow.Click += async (_, _) =>
                {
                    if (_watcher == null)
                    {
                        ToastEngine.Info("Start Now", "The in-app watcher isn't active, so Start Now can't launch locally. The background service will pick it up.");
                        return;
                    }
                    try
                    {
                        var result = await _watcher.StartNowAsync(item.Id, item.Title);
                        if (result.Outcome == Services.QueueWatcherService.StartNowOutcome.Launched)
                            ToastEngine.Success("Start Now", result.Message);
                        else
                            ToastEngine.Warning("Start Now", result.Message);
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Warning("Start Now", $"Couldn't launch immediately: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miStartNow);

                // Git #1832 — the reverse of Un-park: pulls a still-queued item out of
                // the active queue into the parked staging area, only from 'queued'.
                var miPark = new MenuItem { Header = "🅿️ Park" };
                miPark.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                        return;
                    }
                    try
                    {
                        if (await _db.ParkAsync(item.Id))
                        {
                            ToastEngine.Success("Parked", $"Staged, not queued: {item.Title}");
                            ActivityLog.Log("build-queue", $"Parked queue item #{item.Id} ({item.Title}) — no longer queued.");
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                        }
                        else
                            ToastEngine.Warning("Park", $"No longer queued: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miPark);

                var miCancel = new MenuItem { Header = "✕ Cancel" };
                miCancel.Click += async (_, _) =>
                {
                    if (_db == null && _api == null)
                    {
                        ToastEngine.Warning("Cancel", "Not connected — can't cancel.");
                        return;
                    }
                    try
                    {
                        bool canceled;
                        if (_db != null)
                            canceled = await _db.CancelAsync(item.Id);
                        else
                            canceled = (await _api!.CancelQueueItemAsync(item.Id)).IsSuccessStatusCode;

                        if (canceled)
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("build-queue", $"Canceled queue item #{item.Id} ({item.Title}) before it ran.");
                        }
                        else
                        {
                            ToastEngine.Warning("Cancel", $"Couldn't cancel — it already started running: {item.Title}");
                        }
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miCancel);
            }
            else if (item.Status == Services.SessionLimitAutoRestartService.LimitPausedStatus)
            {
                // Session-limit park — normally re-queued automatically after the
                // reset; Resume Now skips the wait for just this build.
                var miResumeNow = new MenuItem { Header = "▶ Resume Now (skip the wait)" };
                miResumeNow.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Resume", "No direct DB connection — can't resume.");
                        return;
                    }
                    try
                    {
                        if (await _db.RequeueLimitPausedAsync(item.Id))
                        {
                            ToastEngine.Success("Resumed", $"Back in the queue: {item.Title}");
                            ActivityLog.Log("session-limit", $"Manually resumed limit-paused queue item #{item.Id} ({item.Title}) ahead of the auto-restart.");
                        }
                        else
                            ToastEngine.Warning("Resume", $"No longer limit-paused: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Resume Failed", $"Couldn't resume: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miResumeNow);

                // Git #1832 — a limit-paused build is genuinely not running either;
                // parking it instead of waiting out the session-limit timer is a
                // reasonable thing to want. See ParkAsync's own doc for the full
                // judgment call.
                var miParkLp = new MenuItem { Header = "🅿️ Park" };
                miParkLp.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                        return;
                    }
                    try
                    {
                        if (await _db.ParkAsync(item.Id))
                        {
                            ToastEngine.Success("Parked", $"Staged, not queued: {item.Title}");
                            ActivityLog.Log("session-limit", $"Parked limit-paused queue item #{item.Id} ({item.Title}) — will NOT auto-restart.");
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                        }
                        else
                            ToastEngine.Warning("Park", $"No longer limit-paused: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miParkLp);

                var miCancelLp = new MenuItem { Header = "✕ Cancel Build" };
                miCancelLp.Click += async (_, _) =>
                {
                    if (_db == null && _api == null)
                    {
                        ToastEngine.Warning("Cancel", "Not connected — can't cancel.");
                        return;
                    }
                    try
                    {
                        bool canceled;
                        if (_db != null)
                            canceled = await _db.CancelAsync(item.Id);
                        else
                            canceled = (await _api!.CancelQueueItemAsync(item.Id)).IsSuccessStatusCode;

                        if (canceled)
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("session-limit", $"Canceled limit-paused queue item #{item.Id} ({item.Title}) — it will NOT auto-restart.");
                        }
                        else
                            ToastEngine.Warning("Cancel", $"Couldn't cancel: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miCancelLp);
            }
            else if (item.Status == "parked")
            {
                // Git #1638 — the required un-park action: flips this ONE row from
                // 'parked' back to 'queued', making it immediately eligible for the
                // normal auto-run pipeline (GetNextAsync's claim query).
                var miUnpark = new MenuItem { Header = "▶ Un-park (send to queue)" };
                miUnpark.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Un-park", "No direct DB connection — can't un-park.");
                        return;
                    }
                    try
                    {
                        if (await _db.UnparkAsync(item.Id))
                        {
                            ToastEngine.Success("Un-parked", $"Back in the queue: {item.Title}");
                            ActivityLog.Log("build-queue", $"Un-parked queue item #{item.Id} ({item.Title}) — now queued.");
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.BatterUpPromoteOptionId, "Un-park");
                        }
                        else
                            ToastEngine.Warning("Un-park", $"No longer parked: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Un-park Failed", $"Couldn't un-park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miUnpark);

                var miCancelParked = new MenuItem { Header = "✕ Cancel" };
                miCancelParked.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Cancel", "No direct DB connection — can't cancel.");
                        return;
                    }
                    try
                    {
                        if (await _db.CancelAsync(item.Id))
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("build-queue", $"Canceled parked queue item #{item.Id} ({item.Title}) without ever queuing it.");
                        }
                        else
                            ToastEngine.Warning("Cancel", $"Couldn't cancel: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miCancelParked);
            }
            else if (item.Status == Services.AccountCapPolicy.CappedStatus)
            {
                // Git #1989 — the override that makes parking acceptable: launches this
                // ONE build at its originally specified model/effort (never substituted —
                // the BUILD: header was never touched by parking). One-shot: the
                // Conservation toggle itself is left exactly as it was, same idiom as the
                // existing right-click overrides (#1805 Start Now, #1641 Build Now).
                var miRunFullModel = new MenuItem { Header = "Run at Full Model" };
                miRunFullModel.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Run at Full Model", "No direct DB connection — can't override.");
                        return;
                    }
                    try
                    {
                        if (!await _db.UncapAsync(item.Id))
                        {
                            ToastEngine.Warning("Run at Full Model", $"No longer capped: {item.Title}");
                            await RefreshAsync();
                            return;
                        }
                        if (_watcher == null)
                        {
                            ToastEngine.Info("Run at Full Model", "The in-app watcher isn't active, so it's back in the queue but won't launch locally. The background service will pick it up.");
                            await RefreshAsync();
                            return;
                        }
                        var claimed = await _db.ForceClaimAsync(item.Id);
                        _watcher.ForceLaunch(claimed);
                        ToastEngine.Success("Run at Full Model", $"Launched at {item.Model ?? "default"}/{item.Effort ?? "default"}: {item.Title}");
                        ActivityLog.Log("build-queue", $"Conservation Cap override: queue #{item.Id} ({item.Title}) launched at its full original model/effort ({item.Model ?? "default"}/{item.Effort ?? "default"}) — one-shot, toggle left unchanged.");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Run at Full Model Failed", $"Couldn't launch: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miRunFullModel);

                var miCancelCapped = new MenuItem { Header = "Cancel" };
                miCancelCapped.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Cancel", "No direct DB connection — can't cancel.");
                        return;
                    }
                    try
                    {
                        if (await _db.CancelAsync(item.Id))
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("build-queue", $"Canceled capped queue item #{item.Id} ({item.Title}) without ever launching it.");
                        }
                        else
                            ToastEngine.Warning("Cancel", $"Couldn't cancel: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miCancelCapped);
            }
            else if (item.Status == "external")
            {
                // Git #1638 — the log-tail viewer promised by the locked "Send to
                // Builder" decision: reuses the same BuildLogPaths.ForQueueItem
                // convention scripts/run-claude.ps1 now redirects real stdout/stderr
                // into, as an ad-hoc standalone viewer (not admitted into the 8-slot
                // Build Watch grid — this build was never a candidate for a slot).
                var miTailLog = new MenuItem { Header = "📜 Tail Log" };
                miTailLog.Click += (_, _) => ExternalLogWindow.ShowFor(item.Id, item.Title);
                cm.Items.Add(miTailLog);

                cm.Items.Add(BuildParkAnyMenuItem(item));
            }
            else
            {
                // Crash/orphan recovery (see BuildQueuePostgresClient.UpdateSessionIdAsync
                // and QueueWatcherService.HandleOutput) — a build that died before it could
                // report completion (app crash, hard reboot mid-run) may still have a real
                // session id captured, in which case the CLI can pick the conversation back
                // up with --resume instead of Retry's plain "start the original prompt over".
                // Only offered when a real session id actually got captured; a build that
                // died before its very first stream-json line has nothing to resume.
                if (!string.IsNullOrEmpty(item.SessionId))
                {
                    var miResumeSession = new MenuItem { Header = "▶ Resume Session (crash recovery)" };
                    miResumeSession.Click += async (_, _) =>
                    {
                        if (_db == null) return;
                        try
                        {
                            var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                            var resumed = await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, item.SessionId, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                            // Git #2120 — resolve the orphaned ORIGINAL (failed, exit_code -2) so it
                            // stops satisfying UpdateOrphanRecoveryBanner/IsCrashed's ExitCode==-2
                            // test forever after being recovered. Same shape as #2119's Reply fix, but
                            // via the orphan-specific transition since MarkSupersededByReplyAsync's
                            // guard deliberately leaves a real `failed` row untouched.
                            int superseded = await _db.MarkOrphanSupersededByResumeAsync(item.Id, resumed.Id);
                            ActivityLog.Log("build-queue",
                                $"Resumed orphaned queue #{item.Id} ({item.Title}) → new row #{resumed.Id}" +
                                (superseded > 0 ? $"; original #{item.Id} marked superseded → #{resumed.Id}." : $"; original #{item.Id} left as-is (not a live orphan sentinel)."));
                            ToastEngine.Success("Resuming", $"Resuming from where it left off: {item.Title}");
                            await RefreshAsync();
                        }
                        catch (Exception ex)
                        {
                            ToastEngine.Error("Resume Failed", $"Couldn't resume: {ex.Message}");
                        }
                    };
                    cm.Items.Add(miResumeSession);
                }

                // Git #3728 — a reply/continuation row cannot be "started over" (its prompt is a
                // chat message, not a build prompt), so it is relabelled and carries its session
                // forward.
                var miRetry = new MenuItem
                {
                    Header = IsResumeOnlyRow(item) ? "🔄 Retry (re-send to the same session)" : "🔄 Retry (start over)"
                };
                miRetry.Click += async (_, _) =>
                {
                    if (_db == null) return;
                    if (!TryResolveRetryResumeSessionId(item, out string? retryResumeSessionId)) return;
                    try
                    {
                        var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                        await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, retryResumeSessionId, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                        ToastEngine.Success("Re-queued", retryResumeSessionId == null
                            ? $"Re-queued: {item.Title}"
                            : $"Re-sending your reply to the same session: {item.Title}");
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Retry Failed", $"Couldn't re-queue build: {ex.Message}");
                    }
                };
                cm.Items.Add(miRetry);

                cm.Items.Add(BuildParkAnyMenuItem(item));
            }

            // Git #1994 — every state falls through to here, so this appears on queued,
            // running, verifying, parked, limit-paused, capped, failed and done cards alike.
            // Hidden (not disabled) for a --notGit local build, whose GithubNumber is either
            // null (never set) or a negative local sentinel (see FormatRef) — neither is a
            // real GitHub issue to open. Reuses MainWindow.OpenGitDetailByNumberAsync, which
            // already focuses an existing tab instead of duplicating it.
            if (item.GithubNumber is int ghNum && ghNum > 0)
            {
                cm.Items.Add(new Separator());
                var miOpenGit = new MenuItem { Header = $"🔗 Open Git #{ghNum}" };
                miOpenGit.Click += (_, _) => OpenGitIssueRequested?.Invoke(this, (ghNum, false));
                cm.Items.Add(miOpenGit);

                var miOpenGitSide = new MenuItem { Header = $"🔗 Open Git #{ghNum} (side-by-side)" };
                miOpenGitSide.Click += (_, _) => OpenGitIssueRequested?.Invoke(this, (ghNum, true));
                cm.Items.Add(miOpenGitSide);
            }

            // Always-available: the local (--notGit) build-id registry — every letter id
            // ever allocated, past and present (see NotGitNumberRegistry).
            cm.Items.Add(new Separator());
            var miLocalIds = new MenuItem { Header = "🔤 Local Build IDs…" };
            miLocalIds.Click += (_, _) => ShowLocalBuildIdsWindow();
            cm.Items.Add(miLocalIds);

            return cm;
        }

        /// <summary>
        /// A real, visible view of the local (--notGit) build-id registry: every letter id
        /// ever allocated, its backing github_number (−ordinal), when it was first seen, and
        /// its provenance. Backed by <see cref="NotGitNumberRegistry.Snapshot"/> so it is
        /// always in sync with what allocation/resolution actually recorded.
        /// </summary>
        private void ShowLocalBuildIdsWindow()
        {
            var entries = NotGitNumberRegistry.Snapshot();

            var win = new Window
            {
                Title = "Local Build IDs  (--notGit letter registry)",
                Width = 560,
                Height = 480,
                Owner = Window.GetWindow(this),
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E)) // Catppuccin base
            };

            var root = new DockPanel { Margin = new Thickness(14) };

            var header = new TextBlock
            {
                Text = entries.Count == 0
                    ? "No local (--notGit) build ids allocated yet."
                    : $"{entries.Count} local build id(s). New --notGit builds are handed the next unused letter automatically.",
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var list = new ListBox
            {
                FontFamily = new FontFamily("Consolas, Cascadia Mono, monospace"),
                FontSize = 12.5,
                Background = new SolidColorBrush(Color.FromRgb(0x18, 0x18, 0x25)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                BorderThickness = new Thickness(0)
            };
            foreach (var e in entries)
            {
                list.Items.Add(new ListBoxItem
                {
                    Content = $"local #{e.Letters,-6}  github_number {(-e.Ordinal),-6}  {e.Note}"
                            + (string.IsNullOrEmpty(e.FirstSeenUtc) ? "" : $"   (first seen {e.FirstSeenUtc})"),
                    Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4))
                });
            }
            root.Children.Add(list);

            win.Content = root;
            win.ShowDialog();
        }

        /// <summary>
        /// Modal input for the Reply action: collects the message to resume a build's session
        /// with. Returns the trimmed text, or null if cancelled/empty. Ctrl+Enter sends.
        /// </summary>
        private string? PromptForReplyMessage(string buildTitle)
        {
            var win = new Window
            {
                Title = "Reply — resume this build's session with a message",
                Width = 540,
                Height = 320,
                Owner = Window.GetWindow(this),
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E))
            };

            var root = new DockPanel { Margin = new Thickness(14) };

            var header = new TextBlock
            {
                Text = $"Message for “{buildTitle}”. It resumes that exact Claude session — "
                     + "claude --resume <session-id> \"<your message>\" — so you can answer a "
                     + "question the build asked (e.g. an A/B choice) even if it wasn't auto-detected.",
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 10, 0, 0)
            };
            DockPanel.SetDock(buttons, Dock.Bottom);

            string? result = null;

            var box = new TextBox
            {
                AcceptsReturn = true,
                TextWrapping = TextWrapping.Wrap,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Background = new SolidColorBrush(Color.FromRgb(0x18, 0x18, 0x25)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                CaretBrush = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8),
                FontSize = 13,
                MinHeight = 120
            };
            box.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Control) != 0)
                {
                    result = box.Text?.Trim();
                    win.DialogResult = !string.IsNullOrEmpty(result);
                }
            };

            var cancel = new Button { Content = "Cancel", Padding = new Thickness(14, 6, 14, 6), IsCancel = true };
            cancel.Click += (_, _) => win.DialogResult = false;

            var send = new Button { Content = "Send Reply  (Ctrl+Enter)", Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(14, 6, 14, 6), IsDefault = true };
            send.Click += (_, _) =>
            {
                result = box.Text?.Trim();
                win.DialogResult = !string.IsNullOrEmpty(result);
            };

            buttons.Children.Add(cancel);
            buttons.Children.Add(send);
            root.Children.Add(buttons);
            root.Children.Add(box); // last child fills the remaining space

            win.Content = root;
            win.Loaded += (_, _) => box.Focus();
            return win.ShowDialog() == true ? result : null;
        }

        /// <summary>
        /// Git #3742 — modal input for the "Add Note…"/"Edit Note…" context-menu item, matching
        /// <see cref="PromptForReplyMessage"/>'s exact shape (same window/box/button chrome) rather
        /// than inventing new dialog chrome. Two real differences from Reply: the box is pre-filled
        /// with <paramref name="existingNote"/> (so editing never starts blank), and Save is allowed
        /// on empty text — clearing an existing note is a legitimate action, not a no-op cancel.
        /// Returns the trimmed text (possibly empty, to clear the note) on Save, or null on Cancel.
        /// </summary>
        private string? PromptForNoteText(string buildTitle, string? existingNote)
        {
            var win = new Window
            {
                Title = "Note",
                Width = 540,
                Height = 320,
                Owner = Window.GetWindow(this),
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E))
            };

            var root = new DockPanel { Margin = new Thickness(14) };

            var header = new TextBlock
            {
                Text = $"Note for “{buildTitle}”. Shown as a small chip on the card; hover the chip "
                     + "to read it back without reopening this dialog. Persists across status "
                     + "changes, including Mark Complete (Hide).",
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 10, 0, 0)
            };
            DockPanel.SetDock(buttons, Dock.Bottom);

            string? result = null;

            var box = new TextBox
            {
                Text = existingNote ?? "",
                AcceptsReturn = true,
                TextWrapping = TextWrapping.Wrap,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Background = new SolidColorBrush(Color.FromRgb(0x18, 0x18, 0x25)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                CaretBrush = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8),
                FontSize = 13,
                MinHeight = 120
            };
            box.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Control) != 0)
                {
                    result = box.Text?.Trim() ?? "";
                    win.DialogResult = true;
                }
            };

            var cancel = new Button { Content = "Cancel", Padding = new Thickness(14, 6, 14, 6), IsCancel = true };
            cancel.Click += (_, _) => win.DialogResult = false;

            var save = new Button { Content = "Save  (Ctrl+Enter)", Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(14, 6, 14, 6), IsDefault = true };
            save.Click += (_, _) =>
            {
                result = box.Text?.Trim() ?? "";
                win.DialogResult = true;
            };

            buttons.Children.Add(cancel);
            buttons.Children.Add(save);
            root.Children.Add(buttons);
            root.Children.Add(box); // last child fills the remaining space

            win.Content = root;
            win.Loaded += (_, _) => { box.Focus(); box.CaretIndex = box.Text.Length; };
            return win.ShowDialog() == true ? result : null;
        }

        // Git #3611 — removed RenderTestsTree()/TestStatusStyle along with the dedicated "Tests"
        // tab: it was never actually a queue-item filter (no QueueItem is ever "marked Tests")
        // — it rendered an unrelated static index of test-manifests/ files against test-results/,
        // decoupled from _lastItems entirely. Confirmed by Shane it's essentially always empty in
        // real use; since there's no real Tests-tagged queue item, there was nothing to fold into
        // the normal Queued/RunningAndQueued view the way Crashed/Capped were.

        private void TriggerBackgroundIssueTitleQueries()
        {
            if (_lastItems == null || _lastItems.Count == 0) return;

            // Git #2817 — GetQueueAsync returns EVERY row ever created (no status filter, no
            // time bound), so without this a done/canceled/failed row from days or weeks ago
            // keeps contributing its own issue number (and its blockers') to this warm-up on
            // every single refresh, forever — the real root cause behind #2133/#2815/#2736
            // being re-queried "every tick with no dedupe/give-up" even after #2890's cooldown
            // capped the damage. A terminal row's own number already has its title from the
            // local `title` column (no `gh` call ever needed for that); nobody is looking at a
            // finished row's blocker ghost card anymore either. Only rows still "in motion"
            // (queued/running/verifying/limit-paused/parked) need their associated numbers'
            // titles kept warm.
            var issueNumbers = _lastItems
                .Where(i => !BuildQueuePostgresClient.IsTerminalStatus(i.Status))
                // Git #2062 — also warm the cache for declared blocker numbers, not just
                // AssociatedIssueNumbers (own issue + linked chat/epic numbers). A blocker that
                // isn't itself a live queue node still needs its real title fetched once so its
                // ghost card (BuildBlockerGhostCard) can show it instead of "(fetching title…)".
                .SelectMany(i => i.AssociatedIssueNumbers.Concat(CleanBlockers(i)))
                .Where(n => n > 0) // Git #1645 — never background-query a non-positive number (a --notGit local build's negative sentinel); it can only fail against `gh`.
                .Distinct()
                .ToList();

            var toFetch = new List<int>();
            foreach (var num in issueNumbers)
            {
                bool alreadyCached;
                bool alreadyPending;
                bool knownUnresolvable;
                bool inRetryCooldown;
                lock (_issueTitleCache)
                {
                    alreadyCached = _issueTitleCache.ContainsKey(num);
                }
                lock (_pendingFetches)
                {
                    alreadyPending = _pendingFetches.Contains(num);
                }
                lock (_unresolvableIssueNumbers)
                {
                    knownUnresolvable = _unresolvableIssueNumbers.Contains(num);
                }
                // Git #2890 — a number whose last fetch failed transiently is on cooldown; skip it so a
                // persistently-failing number isn't re-spawned on the very next tick (and every tick after).
                lock (_titleFetchCooldownUntil)
                {
                    inRetryCooldown = _titleFetchCooldownUntil.TryGetValue(num, out var retryNotBefore)
                                      && DateTime.UtcNow < retryNotBefore;
                }

                if (!alreadyCached && !alreadyPending && !knownUnresolvable && !inRetryCooldown)
                {
                    lock (_pendingFetches)
                    {
                        _pendingFetches.Add(num);
                    }
                    toFetch.Add(num);
                }
            }

            if (toFetch.Count == 0) return;

            // Git #3022 — during a cold start, this warm-up's dozens of individual `gh issue view`
            // calls are one of the independent startup GitHub bursts. Batch the whole batch as ONE
            // coordinated op so it runs AFTER (staggered against) the heavier startup subsystems on
            // the same global gate rather than joining their simultaneous burst. Inside this slot the
            // fetches still run at most #2890's MaxConcurrentTitleFetches at a time. Fire-and-forget
            // (this method is void) — titles are cosmetic ghost-card labels the queue's own refresh
            // keeps warm. Outside the cold-start window it's the unchanged per-number fire-and-forget.
            if (Services.StartupGitHubCoordinator.IsColdStartWindow)
            {
                _ = Services.StartupGitHubCoordinator.RunAsync("issue-title warm-up",
                    () => System.Threading.Tasks.Task.WhenAll(toFetch.Select(FetchAndCacheIssueTitleAsync)));
            }
            else
            {
                foreach (var num in toFetch)
                    _ = FetchAndCacheIssueTitleAsync(num);
            }
        }

        /// <summary>
        /// Git #2817 — the real dedupe/give-up for a number whose title fetch keeps failing
        /// transiently. #2890's flat <see cref="TitleFetchRetryCooldown"/> alone still retried a
        /// persistently-unreachable number every 60s forever; this counts consecutive failures and,
        /// past <see cref="MaxTransientFailuresBeforeGiveUp"/>, escalates the cooldown to
        /// <see cref="TitleFetchGiveUpCooldown"/> instead of the normal 60s — a real give-up rather
        /// than an unbounded per-tick retry, while staying self-healing (a later success resets the
        /// count to zero immediately, see the success branch above).
        /// </summary>
        private static void ApplyEscalatingTitleFetchCooldown(int issueNumber)
        {
            int failures;
            lock (_titleFetchConsecutiveFailures)
            {
                failures = _titleFetchConsecutiveFailures.TryGetValue(issueNumber, out var n) ? n + 1 : 1;
                _titleFetchConsecutiveFailures[issueNumber] = failures;
            }
            var cooldown = failures >= MaxTransientFailuresBeforeGiveUp ? TitleFetchGiveUpCooldown : TitleFetchRetryCooldown;
            lock (_titleFetchCooldownUntil)
            {
                _titleFetchCooldownUntil[issueNumber] = DateTime.UtcNow + cooldown;
            }
            if (failures == MaxTransientFailuresBeforeGiveUp)
            {
                Services.ActivityLog.Log("github",
                    $"gh issue view #{issueNumber} failed {failures} times in a row — giving up for {TitleFetchGiveUpCooldown.TotalMinutes:F0}m instead of retrying every {TitleFetchRetryCooldown.TotalSeconds:F0}s.");
            }
        }

        private async System.Threading.Tasks.Task FetchAndCacheIssueTitleAsync(int issueNumber)
        {
            try
            {
                // Git #2890 — bound real `gh issue view` concurrency. Many uncached numbers no longer each
                // spawn a subprocess simultaneously; they queue on this semaphore and run at most
                // MaxConcurrentTitleFetches at a time, staggering the calls so a large queue can't burst
                // the rate-limit circuit open (which was what kept the cache empty and re-fired the burst).
                await _titleFetchConcurrency.WaitAsync();
                try
                {
                    var result = await Services.GitHubIssuesService.GetIssueTitleAsync(issueNumber);
                    if (result.Title != null)
                    {
                        lock (_issueTitleCache)
                        {
                            _issueTitleCache[issueNumber] = result.Title;
                        }
                        // Git #2890 — succeeded, so drop any prior cooldown for this number.
                        lock (_titleFetchCooldownUntil)
                        {
                            _titleFetchCooldownUntil.Remove(issueNumber);
                        }
                        // Git #2817 — a real success clears the give-up counter immediately, so a
                        // number that failed during a rate-limit storm resumes normal-cadence
                        // retries the moment it actually succeeds, rather than staying escalated.
                        lock (_titleFetchConsecutiveFailures)
                        {
                            _titleFetchConsecutiveFailures.Remove(issueNumber);
                        }
                        _ = Dispatcher.BeginInvoke(new Action(() =>
                        {
                            UpdateTooltipForIssue(issueNumber);
                            // Git #2062 — a blocker ghost card shows "(fetching title…)" until its
                            // real title lands in _issueTitleCache; if this fetch was for a declared
                            // blocker, redraw the queue now so the card picks it up immediately
                            // instead of waiting for the next poll tick.
                            if (_lastItems != null && _lastItems.Any(i => CleanBlockers(i).Contains(issueNumber)))
                            {
                                try { RenderQueue(_lastItems); } catch { }
                            }
                        }));
                    }
                    else if (result.NotFound)
                    {
                        // Git #1979 — `gh` confirmed this number doesn't resolve to anything in this repo.
                        // Cache it hard so it isn't re-spawned as a `gh issue view` process on every refresh.
                        lock (_unresolvableIssueNumbers)
                        {
                            _unresolvableIssueNumbers.Add(issueNumber);
                        }
                    }
                    else
                    {
                        // Transient failure (couldn't start gh, non-zero exit for another reason, bad output,
                        // rate-limit circuit open) — deliberately NOT cached, so it's retried on a later
                        // refresh rather than permanently blanking a real title on a network/auth/rate-limit
                        // blip. Git #2890 — but put it on a retry cooldown so it isn't re-attempted on the
                        // very next tick; bounded concurrency alone would still re-fire every failing number
                        // every single refresh, hammering `gh` while the circuit is open. Git #2817 —
                        // escalate to a real give-up after repeated straight failures instead of retrying
                        // an unreachable number every 60s forever.
                        ApplyEscalatingTitleFetchCooldown(issueNumber);
                    }
                }
                finally
                {
                    _titleFetchConcurrency.Release();
                }
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("github", $"Failed to fetch title for issue #{issueNumber}: {ex.Message}");
                // Git #2890 — an exception is also a transient failure; cooldown it so a broken number
                // isn't re-spawned on every tick. Git #2817 — same escalating give-up as above.
                ApplyEscalatingTitleFetchCooldown(issueNumber);
            }
            finally
            {
                lock (_pendingFetches)
                {
                    _pendingFetches.Remove(issueNumber);
                }
            }
        }

        private void UpdateTooltipForIssue(int issueNumber)
        {
            foreach (var node in _currentGraphNodes)
            {
                if (node.Item != null && node.CardElement != null && node.Item.AssociatedIssueNumbers.Contains(issueNumber))
                {
                    SetQueueCardTooltip(node.CardElement, node.Item);
                }
            }
        }

        private void SetQueueCardTooltip(Border card, QueueItem item)
        {
            var text = GetTooltipText(item);
            if (string.IsNullOrWhiteSpace(text)) return;

            card.ToolTip = new ToolTip
            {
                Style = (Style)Application.Current.FindResource("BubbleToolTip"),
                Content = new TextBlock
                {
                    Text = text,
                    TextWrapping = TextWrapping.Wrap,
                    MaxWidth = 350,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    FontSize = 12,
                },
            };
            ToolTipService.SetInitialShowDelay(card, 250);
            ToolTipService.SetShowDuration(card, 20000);
        }

        private string GetTooltipText(QueueItem item)
        {
            if (item.AssociatedIssueNumbers == null || item.AssociatedIssueNumbers.Count == 0)
            {
                return item.Title; // fallback to the build title
            }

            var sb = new System.Text.StringBuilder();
            
            // Primary issue is the first one
            int primaryNum = item.AssociatedIssueNumbers[0];
            string? primaryTitle = null;
            lock (_issueTitleCache)
            {
                _issueTitleCache.TryGetValue(primaryNum, out primaryTitle);
            }

            if (primaryTitle != null)
            {
                sb.Append($"#{primaryNum}: {primaryTitle}");
            }
            else
            {
                sb.Append($"#{primaryNum}: [Loading title...]");
            }

            if (item.AssociatedIssueNumbers.Count > 1)
            {
                sb.AppendLine();
                sb.AppendLine("Associated Issues:");
                for (int i = 1; i < item.AssociatedIssueNumbers.Count; i++)
                {
                    int num = item.AssociatedIssueNumbers[i];
                    string? title = null;
                    lock (_issueTitleCache)
                    {
                        _issueTitleCache.TryGetValue(num, out title);
                    }
                    if (title != null)
                    {
                        sb.Append($"- #{num}: {title}");
                    }
                    else
                    {
                        sb.Append($"- #{num}: [Loading title...]");
                    }
                    if (i < item.AssociatedIssueNumbers.Count - 1)
                    {
                        sb.AppendLine();
                    }
                }
            }

            return sb.ToString();
        }

        private const int TooltipMaxChars = 80;
        private static void AttachBubbleTooltip(FrameworkElement target, string? title)
        {
            var text = (title ?? string.Empty).Trim();
            if (text.Length == 0) return;
            if (text.Length > TooltipMaxChars)
                text = text.Substring(0, TooltipMaxChars).TrimEnd() + "…";

            target.ToolTip = new ToolTip
            {
                Style = (Style)Application.Current.FindResource("BubbleToolTip"),
                Content = new TextBlock
                {
                    Text = text,
                    TextWrapping = TextWrapping.Wrap,
                    MaxWidth = 296,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    FontSize = 12,
                },
            };
            ToolTipService.SetInitialShowDelay(target, 250);
            ToolTipService.SetShowDuration(target, 20000);
        }

        // ══════════════════════════════════════════════════════════════════════════
        // ── Critter System Vectors & Mascots ──────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════════════

        public enum CritterMood
        {
            Normal,
            Running,
            WaitingForInput,
            Blocked,
            Done,
            Failed,
            Verifying
        }

        private static SolidColorBrush HexBrush(string hex) =>
            new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

        private static Canvas CreateCuteFoxVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(5, 13), new Point(10, 1), new Point(15, 13) }, Fill = HexBrush("#F59E0B") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(7, 12), new Point(10, 4), new Point(13, 12) }, Fill = HexBrush("#FDE68A") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(21, 13), new Point(26, 1), new Point(31, 13) }, Fill = HexBrush("#F59E0B") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(23, 12), new Point(26, 4), new Point(29, 12) }, Fill = HexBrush("#FDE68A") });
            var head = new Ellipse { Width = 26, Height = 19, Fill = HexBrush("#F59E0B") };
            Canvas.SetLeft(head, 5); Canvas.SetTop(head, 8);
            canvas.Children.Add(head);
            var cheekL = new Ellipse { Width = 13, Height = 11, Fill = HexBrush("#FFFBEB") };
            Canvas.SetLeft(cheekL, 4); Canvas.SetTop(cheekL, 14);
            canvas.Children.Add(cheekL);
            var cheekR = new Ellipse { Width = 13, Height = 11, Fill = HexBrush("#FFFBEB") };
            Canvas.SetLeft(cheekR, 19); Canvas.SetTop(cheekR, 14);
            canvas.Children.Add(cheekR);
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(13, 17), new Point(23, 17), new Point(18, 24) }, Fill = HexBrush("#FFFBEB") });
            var nose = new Ellipse { Width = 3.5, Height = 2.5, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.2); Canvas.SetTop(nose, 21.5);
            canvas.Children.Add(nose);

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9,15 Q11.2,18 13.5,15"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22.5,15 Q24.8,18 27,15"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9,16 Q11.2,13 13.5,16"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22.5,16 Q24.8,13 27,16"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeL, 9.5); Canvas.SetTop(eyeL, 13);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 10.5); Canvas.SetTop(eyeLh, 13.5);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeR, 23); Canvas.SetTop(eyeR, 13);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 24); Canvas.SetTop(eyeRh, 13.5);
                canvas.Children.Add(eyeRh);
            }

            var blushL = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.65 };
            Canvas.SetLeft(blushL, 6); Canvas.SetTop(blushL, 17);
            canvas.Children.Add(blushL);
            var blushR = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.65 };
            Canvas.SetLeft(blushR, 25.5); Canvas.SetTop(blushR, 17);
            canvas.Children.Add(blushR);
            return canvas;
        }

        private static Canvas CreateCuteBearVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 7.5, Height = 7.5, Fill = HexBrush("#C7D2FE") };
            Canvas.SetLeft(earL, 5); Canvas.SetTop(earL, 3);
            canvas.Children.Add(earL);
            var earLin = new Ellipse { Width = 4, Height = 4, Fill = HexBrush("#E0E7FF") };
            Canvas.SetLeft(earLin, 6.8); Canvas.SetTop(earLin, 4.8);
            canvas.Children.Add(earLin);
            var earR = new Ellipse { Width = 7.5, Height = 7.5, Fill = HexBrush("#C7D2FE") };
            Canvas.SetLeft(earR, 23.5); Canvas.SetTop(earR, 3);
            canvas.Children.Add(earR);
            var earRin = new Ellipse { Width = 4, Height = 4, Fill = HexBrush("#E0E7FF") };
            Canvas.SetLeft(earRin, 25.2); Canvas.SetTop(earRin, 4.8);
            canvas.Children.Add(earRin);
            var head = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#C7D2FE") };
            Canvas.SetLeft(head, 5); Canvas.SetTop(head, 7);
            canvas.Children.Add(head);
            var snout = new Ellipse { Width = 11, Height = 8, Fill = HexBrush("#E0E7FF") };
            Canvas.SetLeft(snout, 12.5); Canvas.SetTop(snout, 16);
            canvas.Children.Add(snout);
            var nose = new Ellipse { Width = 3.5, Height = 2.5, Fill = HexBrush("#312E81") };
            Canvas.SetLeft(nose, 16.2); Canvas.SetTop(nose, 18);
            canvas.Children.Add(nose);

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M10,14.5 Q12.5,17.5 15,14.5"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M21,14.5 Q23.5,17.5 26,14.5"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Running || mood == CritterMood.WaitingForInput)
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#312E81") };
                Canvas.SetLeft(eyeL, 10.5); Canvas.SetTop(eyeL, 12.5);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.2, Height = 1.2, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 11.5); Canvas.SetTop(eyeLh, 13);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#312E81") };
                Canvas.SetLeft(eyeR, 22); Canvas.SetTop(eyeR, 12.5);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.2, Height = 1.2, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 23); Canvas.SetTop(eyeRh, 13);
                canvas.Children.Add(eyeRh);
            }
            else
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M10,14 Q12.5,16.5 15,14"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.3 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M21,14 Q23.5,16.5 26,14"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.3 });
            }

            var blushL = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.55 };
            Canvas.SetLeft(blushL, 6.5); Canvas.SetTop(blushL, 17);
            canvas.Children.Add(blushL);
            var blushR = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.55 };
            Canvas.SetLeft(blushR, 25); Canvas.SetTop(blushR, 17);
            canvas.Children.Add(blushR);
            return canvas;
        }

        private static Canvas CreateCuteCatVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(5, 13), new Point(9, 2), new Point(14, 13) }, Fill = HexBrush("#D8B4FE") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(7, 12), new Point(9, 5), new Point(12, 12) }, Fill = HexBrush("#F5D0FE") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(22, 13), new Point(27, 2), new Point(31, 13) }, Fill = HexBrush("#D8B4FE") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(24, 12), new Point(27, 5), new Point(29, 12) }, Fill = HexBrush("#F5D0FE") });
            var head = new Ellipse { Width = 25, Height = 19, Fill = HexBrush("#D8B4FE") };
            Canvas.SetLeft(head, 5.5); Canvas.SetTop(head, 8);
            canvas.Children.Add(head);

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9.5,14 Q11.5,17 13.5,14"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22,14 Q24,17 26,14"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9.5,15.5 Q11.5,12.5 13.5,15.5"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22,15.5 Q24,12.5 26,15.5"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeL, 10); Canvas.SetTop(eyeL, 13);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 11); Canvas.SetTop(eyeLh, 13.5);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeR, 22.5); Canvas.SetTop(eyeR, 13);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 23.5); Canvas.SetTop(eyeRh, 13.5);
                canvas.Children.Add(eyeRh);
            }

            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(16.5, 19.5), new Point(19.5, 19.5), new Point(18, 21.5) }, Fill = HexBrush("#F472B6") });
            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M3,18 L8,19 M3,21 L8,21"), Stroke = HexBrush("#C084FC"), StrokeThickness = 0.9 });
            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M28,19 L33,18 M28,21 L33,21"), Stroke = HexBrush("#C084FC"), StrokeThickness = 0.9 });
            return canvas;
        }

        private static Canvas CreateCuteDuckVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var head = new Ellipse { Width = 23, Height = 19, Fill = HexBrush("#F8FAFC") };
            Canvas.SetLeft(head, 6.5); Canvas.SetTop(head, 7);
            canvas.Children.Add(head);
            var cap = new Ellipse { Width = 15, Height = 7, Fill = HexBrush("#3B82F6") };
            Canvas.SetLeft(cap, 10.5); Canvas.SetTop(cap, 2);
            canvas.Children.Add(cap);
            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M18,5 Q22,3 25,6 M18,5 Q22,6 26,9"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.2 });

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M10.5,12 Q12.5,14.5 14.5,12"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.3 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M18.5,12 Q20.5,14.5 22.5,12"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.3 });
            }
            else
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeL, 11); Canvas.SetTop(eyeL, 10);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.3, Height = 1.6, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 12); Canvas.SetTop(eyeLh, 11);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeR, 19); Canvas.SetTop(eyeR, 10);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.3, Height = 1.6, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 20); Canvas.SetTop(eyeRh, 11);
                canvas.Children.Add(eyeRh);
            }

            var beak = new Ellipse { Width = 16, Height = 8, Fill = HexBrush("#F59E0B") };
            Canvas.SetLeft(beak, 10); Canvas.SetTop(beak, 16.5);
            canvas.Children.Add(beak);
            var beakTop = new Ellipse { Width = 10, Height = 4, Fill = HexBrush("#FBBF24") };
            Canvas.SetLeft(beakTop, 13); Canvas.SetTop(beakTop, 17.5);
            canvas.Children.Add(beakTop);
            return canvas;
        }

        private static Canvas CreateCuteBirdVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 21, Height = 17, Fill = HexBrush("#60A5FA") };
            Canvas.SetLeft(body, 7.5); Canvas.SetTop(body, 7.5);
            canvas.Children.Add(body);
            var belly = new Ellipse { Width = 12, Height = 10, Fill = HexBrush("#DBEAFE") };
            Canvas.SetLeft(belly, 11); Canvas.SetTop(belly, 12);
            canvas.Children.Add(belly);
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(7.5, 14), new Point(2, 16), new Point(7.5, 18) }, Fill = HexBrush("#F59E0B") });

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M13,12 Q15,14.5 17,12"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.3 });
            }
            else
            {
                var eye = new Ellipse { Width = 3.5, Height = 3.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eye, 13.5); Canvas.SetTop(eye, 10.5);
                canvas.Children.Add(eye);
                var eyeH = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeH, 14.5); Canvas.SetTop(eyeH, 11.5);
                canvas.Children.Add(eyeH);
            }

            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M18,12 Q25,14 19,20 Z"), Fill = HexBrush("#3B82F6") });
            return canvas;
        }

        // Shane, 2026-08-28: "Yesterday I had Copilot add Critters... they don't work well,
        // I don't see them much and the ones I do see are not cute... 10 good critters that
        // are cute and happy, they close bugs and kill builds." 10 new hand-built Build Queue
        // card mascots at the exact same quality bar/convention as the 5 above (36x30 canvas,
        // mood-aware eyes via the shared helpers below, blush cheeks, one signature
        // accessory) — extends CreateQueueCardMascot's variant pool from 5 to 15 so the same
        // handful of faces don't keep repeating across every card.
        internal static void AddQueueEye(Canvas c, double cx, double cy, Brush color, double w = 3.5, double h = 4.5)
        {
            var eye = new Ellipse { Width = w, Height = h, Fill = color };
            Canvas.SetLeft(eye, cx - w / 2); Canvas.SetTop(eye, cy - h / 2);
            c.Children.Add(eye);
            var hi = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
            Canvas.SetLeft(hi, cx - w / 2 + 1); Canvas.SetTop(hi, cy - h / 2 + 0.6);
            c.Children.Add(hi);
        }

        internal static void AddQueueEyePairMood(Canvas c, CritterMood mood, double lx, double rx, double cy, Brush color)
        {
            if (mood == CritterMood.Blocked)
            {
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{lx - 2},{cy - 1} Q{lx + 0.2},{cy + 2} {lx + 2.5},{cy - 1}"), Stroke = color, StrokeThickness = 1.4 });
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{rx - 2},{cy - 1} Q{rx + 0.2},{cy + 2} {rx + 2.5},{cy - 1}"), Stroke = color, StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{lx - 2},{cy + 1} Q{lx + 0.2},{cy - 2} {lx + 2.5},{cy + 1}"), Stroke = color, StrokeThickness = 1.4 });
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{rx - 2},{cy + 1} Q{rx + 0.2},{cy - 2} {rx + 2.5},{cy + 1}"), Stroke = color, StrokeThickness = 1.4 });
            }
            else
            {
                AddQueueEye(c, lx, cy, color);
                AddQueueEye(c, rx, cy, color);
            }
        }

        internal static void AddQueueBlush(Canvas c, double lx, double rx, double cy, Brush color)
        {
            var bL = new Ellipse { Width = 4.5, Height = 2.5, Fill = color, Opacity = 0.6 };
            Canvas.SetLeft(bL, lx); Canvas.SetTop(bL, cy);
            c.Children.Add(bL);
            var bR = new Ellipse { Width = 4.5, Height = 2.5, Fill = color, Opacity = 0.6 };
            Canvas.SetLeft(bR, rx); Canvas.SetTop(bR, cy);
            c.Children.Add(bR);
        }

        internal static Canvas CreateCutePandaVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 9, Height = 9, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(earL, 3); Canvas.SetTop(earL, 2); c.Children.Add(earL);
            var earR = new Ellipse { Width = 9, Height = 9, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 2); c.Children.Add(earR);
            var head = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#F8FAFC") };
            Canvas.SetLeft(head, 5); Canvas.SetTop(head, 7); c.Children.Add(head);
            var patchL = new Ellipse { Width = 9, Height = 11, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(patchL, 7.5); Canvas.SetTop(patchL, 11); c.Children.Add(patchL);
            var patchR = new Ellipse { Width = 9, Height = 11, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(patchR, 19.5); Canvas.SetTop(patchR, 11); c.Children.Add(patchR);
            AddQueueEyePairMood(c, mood, 12, 24, 16, Brushes.White);
            var nose = new Ellipse { Width = 3, Height = 2.2, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20); c.Children.Add(nose);
            var bamboo = new System.Windows.Shapes.Rectangle { Width = 3, Height = 12, Fill = HexBrush("#A3E635"), RadiusX = 1.5, RadiusY = 1.5 };
            Canvas.SetLeft(bamboo, 30); Canvas.SetTop(bamboo, 12); c.Children.Add(bamboo);
            AddQueueBlush(c, 6.5, 25.5, 18, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteOtterVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 6, Height = 6, Fill = HexBrush("#A87C4F") };
            Canvas.SetLeft(earL, 6); Canvas.SetTop(earL, 5); c.Children.Add(earL);
            var earR = new Ellipse { Width = 6, Height = 6, Fill = HexBrush("#A87C4F") };
            Canvas.SetLeft(earR, 26); Canvas.SetTop(earR, 5); c.Children.Add(earR);
            var head = new Ellipse { Width = 27, Height = 21, Fill = HexBrush("#C79A63") };
            Canvas.SetLeft(head, 4.5); Canvas.SetTop(head, 8); c.Children.Add(head);
            var muzzle = new Ellipse { Width = 15, Height = 11, Fill = HexBrush("#F2E2C8") };
            Canvas.SetLeft(muzzle, 10.5); Canvas.SetTop(muzzle, 16); c.Children.Add(muzzle);
            AddQueueEyePairMood(c, mood, 13, 25, 17, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 4, Height = 3, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
            var shell = new Ellipse { Width = 9, Height = 7, Fill = HexBrush("#94E2D5") };
            Canvas.SetLeft(shell, 14); Canvas.SetTop(shell, 24); c.Children.Add(shell);
            AddQueueBlush(c, 7, 25, 20, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteHedgehogVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            for (int i = 0; i < 5; i++)
                c.Children.Add(new Polygon { Points = new PointCollection { new Point(4 + i * 5.5, 12), new Point(6.5 + i * 5.5, 1), new Point(9 + i * 5.5, 12) }, Fill = HexBrush("#C77B4D") });
            var head = new Ellipse { Width = 24, Height = 19, Fill = HexBrush("#E8A876") };
            Canvas.SetLeft(head, 6); Canvas.SetTop(head, 9); c.Children.Add(head);
            var muzzle = new Ellipse { Width = 12, Height = 8, Fill = HexBrush("#FCEEDD") };
            Canvas.SetLeft(muzzle, 12); Canvas.SetTop(muzzle, 17); c.Children.Add(muzzle);
            AddQueueEyePairMood(c, mood, 16, 26, 17, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 3, Height = 2.4, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20.5); c.Children.Add(nose);
            AddQueueBlush(c, 8, 26, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteOwlVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(9, 8), new Point(6, 0), new Point(13, 6) }, Fill = HexBrush("#5EAA8C") });
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(27, 8), new Point(30, 0), new Point(23, 6) }, Fill = HexBrush("#5EAA8C") });
            var body = new Ellipse { Width = 26, Height = 24, Fill = HexBrush("#7FC4A6") };
            Canvas.SetLeft(body, 5); Canvas.SetTop(body, 5); c.Children.Add(body);
            var faceL = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#F5F0DD") };
            Canvas.SetLeft(faceL, 7); Canvas.SetTop(faceL, 10); c.Children.Add(faceL);
            var faceR = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#F5F0DD") };
            Canvas.SetLeft(faceR, 18); Canvas.SetTop(faceR, 10); c.Children.Add(faceR);
            AddQueueEyePairMood(c, mood, 12.5, 23.5, 16, HexBrush("#1E1E2E"));
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(15.5, 19), new Point(20.5, 19), new Point(18, 23) }, Fill = HexBrush("#F59E0B") });
            return c;
        }

        internal static Canvas CreateCuteSealVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#B8C6DB") };
            Canvas.SetLeft(body, 5); Canvas.SetTop(body, 8); c.Children.Add(body);
            var muzzle = new Ellipse { Width = 13, Height = 9, Fill = HexBrush("#E8EEF6") };
            Canvas.SetLeft(muzzle, 11.5); Canvas.SetTop(muzzle, 16); c.Children.Add(muzzle);
            AddQueueEyePairMood(c, mood, 14, 24, 16, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 3.5, Height = 2.6, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 19); c.Children.Add(nose);
            c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M12,21 L4,19 M12,23 L4,24 M22,21 L30,19 M22,23 L30,24"), Stroke = HexBrush("#8FA3C2"), StrokeThickness = 0.8 });
            var flipper = new Ellipse { Width = 8, Height = 5, Fill = HexBrush("#9FB0CC") };
            Canvas.SetLeft(flipper, 2); Canvas.SetTop(flipper, 22); c.Children.Add(flipper);
            AddQueueBlush(c, 7, 25, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteRaccoonVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#6B6B78") };
            Canvas.SetLeft(earL, 4); Canvas.SetTop(earL, 3); c.Children.Add(earL);
            var earR = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#6B6B78") };
            Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 3); c.Children.Add(earR);
            var head = new Ellipse { Width = 25, Height = 19, Fill = HexBrush("#8E8E9E") };
            Canvas.SetLeft(head, 5.5); Canvas.SetTop(head, 8); c.Children.Add(head);
            var mask = new System.Windows.Shapes.Path { Fill = HexBrush("#33333F"), Data = Geometry.Parse("M8,13 Q18,20 28,13 Q18,18 8,13 Z") };
            c.Children.Add(mask);
            AddQueueEyePairMood(c, mood, 13, 23, 15, Brushes.White);
            var nose = new Ellipse { Width = 3.5, Height = 2.6, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
            c.Children.Add(new System.Windows.Shapes.Rectangle { Width = 4, Height = 3, Fill = HexBrush("#1E1E2E") });
            Canvas.SetLeft(c.Children[c.Children.Count - 1], 15); Canvas.SetTop(c.Children[c.Children.Count - 1], 24);
            c.Children.Add(new System.Windows.Shapes.Rectangle { Width = 4, Height = 3, Fill = HexBrush("#E8E8EE") });
            Canvas.SetLeft(c.Children[c.Children.Count - 1], 19); Canvas.SetTop(c.Children[c.Children.Count - 1], 24);
            return c;
        }

        internal static Canvas CreateCuteHamsterVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#E8B563") };
            Canvas.SetLeft(earL, 4); Canvas.SetTop(earL, 3); c.Children.Add(earL);
            var earR = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#E8B563") };
            Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 3); c.Children.Add(earR);
            var head = new Ellipse { Width = 27, Height = 22, Fill = HexBrush("#F2C77E") };
            Canvas.SetLeft(head, 4.5); Canvas.SetTop(head, 7); c.Children.Add(head);
            var cheekL = new Ellipse { Width = 11, Height = 9, Fill = HexBrush("#FCE3B0") };
            Canvas.SetLeft(cheekL, 2); Canvas.SetTop(cheekL, 16); c.Children.Add(cheekL);
            var cheekR = new Ellipse { Width = 11, Height = 9, Fill = HexBrush("#FCE3B0") };
            Canvas.SetLeft(cheekR, 23); Canvas.SetTop(cheekR, 16); c.Children.Add(cheekR);
            AddQueueEyePairMood(c, mood, 13, 23, 16, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 3, Height = 2.2, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20); c.Children.Add(nose);
            AddQueueBlush(c, 4, 27, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteFrogVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 26, Height = 16, Fill = HexBrush("#7FCB6B") };
            Canvas.SetLeft(body, 5); Canvas.SetTop(body, 13); c.Children.Add(body);
            var bumpL = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#7FCB6B") };
            Canvas.SetLeft(bumpL, 6); Canvas.SetTop(bumpL, 4); c.Children.Add(bumpL);
            var bumpR = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#7FCB6B") };
            Canvas.SetLeft(bumpR, 19); Canvas.SetTop(bumpR, 4); c.Children.Add(bumpR);
            AddQueueEyePairMood(c, mood, 11.5, 24.5, 9, HexBrush("#1E1E2E"));
            var mouth = new System.Windows.Shapes.Path { Stroke = HexBrush("#2B6B1F"), StrokeThickness = 1.3, Data = Geometry.Parse("M12,20 Q18,24 24,20") };
            c.Children.Add(mouth);
            var throatPatch = new Ellipse { Width = 12, Height = 5, Fill = HexBrush("#D9F2CE") };
            Canvas.SetLeft(throatPatch, 12); Canvas.SetTop(throatPatch, 21); c.Children.Add(throatPatch);
            return c;
        }

        internal static Canvas CreateCuteKoalaVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 13, Height = 13, Fill = HexBrush("#9CA3AF") };
            Canvas.SetLeft(earL, 1); Canvas.SetTop(earL, 4); c.Children.Add(earL);
            var earLin = new Ellipse { Width = 7, Height = 7, Fill = HexBrush("#DCE0E6") };
            Canvas.SetLeft(earLin, 4); Canvas.SetTop(earLin, 7); c.Children.Add(earLin);
            var earR = new Ellipse { Width = 13, Height = 13, Fill = HexBrush("#9CA3AF") };
            Canvas.SetLeft(earR, 22); Canvas.SetTop(earR, 4); c.Children.Add(earR);
            var earRin = new Ellipse { Width = 7, Height = 7, Fill = HexBrush("#DCE0E6") };
            Canvas.SetLeft(earRin, 25); Canvas.SetTop(earRin, 7); c.Children.Add(earRin);
            var head = new Ellipse { Width = 24, Height = 20, Fill = HexBrush("#AEB4BF") };
            Canvas.SetLeft(head, 6); Canvas.SetTop(head, 8); c.Children.Add(head);
            AddQueueEyePairMood(c, mood, 14, 22, 16, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 6, Height = 4.5, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 15); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
            AddQueueBlush(c, 7.5, 23, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteChickVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 24, Height = 21, Fill = HexBrush("#FDE047") };
            Canvas.SetLeft(body, 6); Canvas.SetTop(body, 7); c.Children.Add(body);
            var tuft = new System.Windows.Shapes.Path { Fill = HexBrush("#FDE047"), Data = Geometry.Parse("M16,7 Q14,1 18,3 Q20,-1 21,4 Z") };
            c.Children.Add(tuft);
            AddQueueEyePairMood(c, mood, 14, 24, 15, HexBrush("#1E1E2E"));
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(18, 18), new Point(24, 20), new Point(18, 23) }, Fill = HexBrush("#F97316") });
            var wing = new Ellipse { Width = 9, Height = 12, Fill = HexBrush("#FACC15") };
            Canvas.SetLeft(wing, 6); Canvas.SetTop(wing, 13); c.Children.Add(wing);
            AddQueueBlush(c, 8, 24, 18, HexBrush("#F472B6"));
            return c;
        }

        private static UIElement CreateQueueCardMascot(QueueItem item, InteractiveInputState? interactiveState)
        {
            var container = new Canvas
            {
                Width = 42,
                Height = 36,
                Margin = new Thickness(4, 0, 2, 0),
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
                ClipToBounds = false
            };

            var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            bool isBlocked = blockerList.Count > 0 || string.Equals(item.Status, "blocked", StringComparison.OrdinalIgnoreCase);

            CritterMood mood = isBlocked ? CritterMood.Blocked :
                (interactiveState == InteractiveInputState.WaitingForInput) ? CritterMood.WaitingForInput :
                (item.Status == "running") ? CritterMood.Running :
                (item.Status == BuildQueuePostgresClient.VerifyingStatus) ? CritterMood.Verifying :
                (item.Status == "done") ? CritterMood.Done :
                (item.Status == "failed") ? CritterMood.Failed :
                CritterMood.Normal;

            var floatTrans = new TranslateTransform();
            container.RenderTransform = floatTrans;

            var floatAnim = new DoubleAnimation(0, isBlocked ? -0.8 : -1.2, TimeSpan.FromSeconds(isBlocked ? 3.2 : 2.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            // Git #3698 — an owned clock, so whoever discards this card can really stop it
            // (BeginAnimation's clock ticks on every frame until a GC collects the card).
            KeyedSlotCardHost.BeginOwnedAnimation(container, floatTrans, TranslateTransform.YProperty, floatAnim);

            int variant = Math.Abs((item.GithubNumber ?? item.Id) % 15);
            FrameworkElement critter = isBlocked
                ? IssueChompAnimation.BuildRandomBlockedElement(scale: 0.5)
                : (FrameworkElement)(variant switch
                {
                    0 => CreateCuteFoxVector(mood),
                    1 => CreateCuteBearVector(mood),
                    2 => CreateCuteCatVector(mood),
                    3 => CreateCuteDuckVector(mood),
                    4 => CreateCuteBirdVector(mood),
                    5 => CreateCutePandaVector(mood),
                    6 => CreateCuteOtterVector(mood),
                    7 => CreateCuteHedgehogVector(mood),
                    8 => CreateCuteOwlVector(mood),
                    9 => CreateCuteSealVector(mood),
                    10 => CreateCuteRaccoonVector(mood),
                    11 => CreateCuteHamsterVector(mood),
                    12 => CreateCuteFrogVector(mood),
                    13 => CreateCuteKoalaVector(mood),
                    _ => CreateCuteChickVector(mood)
                });

            Canvas.SetLeft(critter, 3);
            Canvas.SetTop(critter, 3);
            container.Children.Add(critter);

            Color glowColor = mood switch
            {
                CritterMood.Blocked => Color.FromRgb(0xF3, 0x8B, 0xA8),
                CritterMood.WaitingForInput => Color.FromRgb(0xF9, 0xE2, 0xAF),
                CritterMood.Running => Color.FromRgb(0x89, 0xB4, 0xFA),
                CritterMood.Verifying => Color.FromRgb(0x74, 0xC7, 0xEC),
                CritterMood.Done => Color.FromRgb(0xA6, 0xE3, 0xA1),
                CritterMood.Failed => Color.FromRgb(0xEB, 0xA0, 0xAC),
                _ => Color.FromRgb(0xCB, 0xA6, 0xF7)
            };

            var glow = new DropShadowEffect
            {
                Color = glowColor,
                BlurRadius = item.Status == "running" ? 10 : (isBlocked ? 7 : 6),
                ShadowDepth = 0,
                Opacity = item.Status == "running" ? 0.65 : 0.38
            };
            critter.Effect = glow;

            if (item.Status == "running" || isBlocked)
            {
                var shimmer = new DoubleAnimation(0.30, isBlocked ? 0.65 : 0.85, TimeSpan.FromSeconds(isBlocked ? 2.8 : 2.2))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                };
                KeyedSlotCardHost.BeginOwnedAnimation(container, glow, DropShadowEffect.OpacityProperty, shimmer);
            }

            if (isBlocked)
            {
                var lockBadge = new Border
                {
                    Background = HexBrush("#F38BA8"),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(3, 1, 3, 1),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF3, 0x8B, 0xA8), BlurRadius = 4, ShadowDepth = 0 }
                };
                lockBadge.Child = new TextBlock { Text = "🔒", FontSize = 9 };
                Canvas.SetLeft(lockBadge, 22);
                Canvas.SetTop(lockBadge, -3);
                container.Children.Add(lockBadge);
            }
            else if (interactiveState == InteractiveInputState.WaitingForInput)
            {
                var badge = new Border
                {
                    Background = HexBrush("#F9E2AF"),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(3, 1, 3, 1),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF5, 0x9E, 0x0B), BlurRadius = 4, ShadowDepth = 0 }
                };
                badge.Child = new TextBlock { Text = "💬", FontSize = 9 };
                Canvas.SetLeft(badge, 22);
                Canvas.SetTop(badge, -3);
                container.Children.Add(badge);
            }
            else if (item.Status == BuildQueuePostgresClient.VerifyingStatus)
            {
                var magnifier = new TextBlock
                {
                    Text = "🔎",
                    FontSize = 10,
                    Foreground = HexBrush("#74C7EC"),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0x74, 0xC7, 0xEC), BlurRadius = 4, ShadowDepth = 0 }
                };
                Canvas.SetLeft(magnifier, 26);
                Canvas.SetTop(magnifier, -2);
                container.Children.Add(magnifier);
            }
            else if (item.Status == "done")
            {
                var sparkle = new TextBlock
                {
                    Text = "✨",
                    FontSize = 10,
                    Foreground = HexBrush("#A6E3A1"),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xA6, 0xE3, 0xA1), BlurRadius = 4, ShadowDepth = 0 }
                };
                Canvas.SetLeft(sparkle, 26);
                Canvas.SetTop(sparkle, -2);
                container.Children.Add(sparkle);
            }
            else if (item.Status == "failed")
            {
                var mark = new TextBlock
                {
                    Text = "🩹",
                    FontSize = 10,
                    Opacity = 0.8
                };
                Canvas.SetLeft(mark, 24);
                Canvas.SetTop(mark, -2);
                container.Children.Add(mark);
            }

            return container;
        }

        /// <summary>
        /// Git #1803 — a lighter-weight sibling of <see cref="CreateQueueCardMascot"/> for
        /// surfaces that don't have a real <see cref="QueueItem"/> to key off (Batter Up /
        /// AI Batter Up read straight off the GitHub project board, not the build queue).
        /// Reuses the exact same critter-vector pool + stable per-item variant selection +
        /// float/glow treatment so those cards carry the identical mascot language as a real
        /// queue card, just driven by a caller-supplied seed (e.g. the issue number) and mood
        /// instead of item.Status/interactiveState.
        /// </summary>
        internal static UIElement CreateGenericCardMascot(int seed, CritterMood mood, bool isBlocked = false)
        {
            var container = new Canvas
            {
                Width = 42,
                Height = 36,
                Margin = new Thickness(4, 0, 2, 0),
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
                ClipToBounds = false
            };

            var floatTrans = new TranslateTransform();
            container.RenderTransform = floatTrans;

            var floatAnim = new DoubleAnimation(0, isBlocked ? -0.8 : -1.2, TimeSpan.FromSeconds(isBlocked ? 3.2 : 2.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            // Git #3698 — an owned clock, so whoever discards this card can really stop it
            // (BeginAnimation's clock ticks on every frame until a GC collects the card).
            KeyedSlotCardHost.BeginOwnedAnimation(container, floatTrans, TranslateTransform.YProperty, floatAnim);

            int variant = Math.Abs(seed % 15);
            FrameworkElement critter = isBlocked
                ? IssueChompAnimation.BuildRandomBlockedElement(scale: 0.5)
                : (FrameworkElement)(variant switch
                {
                    0 => CreateCuteFoxVector(mood),
                    1 => CreateCuteBearVector(mood),
                    2 => CreateCuteCatVector(mood),
                    3 => CreateCuteDuckVector(mood),
                    4 => CreateCuteBirdVector(mood),
                    5 => CreateCutePandaVector(mood),
                    6 => CreateCuteOtterVector(mood),
                    7 => CreateCuteHedgehogVector(mood),
                    8 => CreateCuteOwlVector(mood),
                    9 => CreateCuteSealVector(mood),
                    10 => CreateCuteRaccoonVector(mood),
                    11 => CreateCuteHamsterVector(mood),
                    12 => CreateCuteFrogVector(mood),
                    13 => CreateCuteKoalaVector(mood),
                    _ => CreateCuteChickVector(mood)
                });

            Canvas.SetLeft(critter, 3);
            Canvas.SetTop(critter, 3);
            container.Children.Add(critter);

            Color glowColor = mood switch
            {
                CritterMood.Blocked => Color.FromRgb(0xF3, 0x8B, 0xA8),
                CritterMood.WaitingForInput => Color.FromRgb(0xF9, 0xE2, 0xAF),
                CritterMood.Running => Color.FromRgb(0x89, 0xB4, 0xFA),
                CritterMood.Verifying => Color.FromRgb(0x74, 0xC7, 0xEC),
                CritterMood.Done => Color.FromRgb(0xA6, 0xE3, 0xA1),
                CritterMood.Failed => Color.FromRgb(0xEB, 0xA0, 0xAC),
                _ => Color.FromRgb(0xCB, 0xA6, 0xF7)
            };

            var glow = new DropShadowEffect
            {
                Color = glowColor,
                BlurRadius = isBlocked ? 7 : 6,
                ShadowDepth = 0,
                Opacity = 0.38
            };
            critter.Effect = glow;

            if (isBlocked)
            {
                var shimmer = new DoubleAnimation(0.30, 0.65, TimeSpan.FromSeconds(2.8))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                };
                KeyedSlotCardHost.BeginOwnedAnimation(container, glow, DropShadowEffect.OpacityProperty, shimmer);

                var lockBadge = new Border
                {
                    Background = HexBrush("#F38BA8"),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(3, 1, 3, 1),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF3, 0x8B, 0xA8), BlurRadius = 4, ShadowDepth = 0 }
                };
                lockBadge.Child = new TextBlock { Text = "🔒", FontSize = 9 };
                Canvas.SetLeft(lockBadge, 22);
                Canvas.SetTop(lockBadge, -3);
                container.Children.Add(lockBadge);
            }

            return container;
        }

        /// <summary>
        /// Git #1803 — the same status-pill visual (colored border/background badge,
        /// bold 9.5pt text) <see cref="BuildQueueCard"/> uses for its RUNNING/DONE/BLOCKED/etc.
        /// pills, factored out so Batter Up / AI Batter Up can build pills in the identical
        /// shape for their own statuses without duplicating the Border/TextBlock boilerplate.
        /// </summary>
        internal static Border BuildStatusPill(string text, Color bg, Color border, Color fg, string? tooltip = null)
        {
            var pill = new Border
            {
                Background = new SolidColorBrush(bg),
                BorderBrush = new SolidColorBrush(border),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 1.5, 6, 1.5)
            };
            pill.Child = new TextBlock
            {
                Text = text,
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(fg),
                VerticalAlignment = VerticalAlignment.Center,
                ToolTip = tooltip
            };
            return pill;
        }

        /// <summary>
        /// Git #1803 — the same card shell (border/background treatment, corner radius,
        /// padding, spacing) <see cref="BuildQueueCard"/> uses for its default/blocked
        /// states, factored out so Batter Up / AI Batter Up render the identical card
        /// shape instead of a bare text row.
        /// </summary>
        internal static Border BuildGenericCardShell(bool isBlocked)
        {
            Color borderColor = isBlocked ? Color.FromRgb(0x5A, 0x2A, 0x34) : Color.FromRgb(0x31, 0x32, 0x44);
            Color bgColor = isBlocked ? Color.FromRgb(0x1E, 0x18, 0x22) : Color.FromRgb(0x18, 0x18, 0x25);
            return new Border
            {
                Background = new SolidColorBrush(bgColor),
                BorderBrush = new SolidColorBrush(borderColor),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 2, 0, 3),
                HorizontalAlignment = HorizontalAlignment.Stretch
            };
        }

        private void InFlightIssuesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (InFlightIssuesList.SelectedItem is ListBoxItem { Tag: int githubNumber })
            {
                IssueChatRequested?.Invoke(this, githubNumber);
                InFlightIssuesList.SelectedItem = null;
            }
        }

        // Git #3701 — the always-visible header chevron (left of QueueDot) drives the shared
        // _isPinned/PinToggled toggle. Git #3702 removed the old overflow-menu Pin item this
        // used to stay in sync with — TogglePin() is now this button's only caller.
        private void BtnCollapseQueue_Click(object sender, RoutedEventArgs e) => TogglePin();

        /// <summary>Git #3786 — real, quick show/hide toggle for CritterLoungeControl, persisted
        /// to <c>BuildConsoleSettings.CritterLoungeVisible</c> and applied immediately (no restart
        /// needed).</summary>
        private void BtnToggleCritterLounge_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsoleSettings.Load();
            var nowVisible = !settings.CritterLoungeVisible;
            settings.CritterLoungeVisible = nowVisible;
            settings.Save();
            ApplyCritterLoungeVisibility(nowVisible);
        }

        private void ApplyCritterLoungeVisibility(bool visible)
        {
            CritterLounge.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            ToggleCritterLoungeIcon.Text = visible ? "" : "";
            BtnToggleCritterLounge.ToolTip = visible ? "Hide critter scene" : "Show critter scene";
        }

        private void TogglePin()
        {
            _isPinned = !_isPinned;
            CollapseQueueIcon.Text = _isPinned ? CollapseArrowGlyph : ExpandArrowGlyph;
            PinToggled?.Invoke(this, _isPinned);
        }

        // Git #3785 — "Build Sets" slide-out toggle. Real relocation target for
        // RenderBuildSetRollup's existing output (BuildSetRollupList et al, now living in
        // BuildSetsPanelBorder/Grid.Column="0"), out of the old 180px-capped strip. Purely a
        // local column-width/visibility flip plus a persisted-setting write — no re-render
        // of the rollup itself, since its population logic in RenderBuildSetRollup is
        // completely untouched by this relocation.
        private void BtnToggleBuildSets_Click(object sender, RoutedEventArgs e)
        {
            // Git #3807 — real wall-clock timing of the toggle, from click to the dispatcher
            // going idle again (so it includes the layout/render pass the toggle causes, not
            // just this handler). Logged so a slow toggle in the live app leaves a real number
            // behind instead of an impression.
            var toggleTimer = System.Diagnostics.Stopwatch.StartNew();
            _buildSetsPanelOpen = !_buildSetsPanelOpen;
            ApplyBuildSetsPanelState();
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.BuildSetsPanelOpen = _buildSetsPanelOpen;
                settings.Save();
            }
            catch { /* best-effort persistence — the toggle still works this session either way */ }

            // Git #3805 — tell MainWindow to grow/shrink its own outer ColQueue column;
            // this control has no reach into its own host's layout on its own.
            BuildSetsPanelToggled?.Invoke(this, _buildSetsPanelOpen);

            bool openedNow = _buildSetsPanelOpen;
            double handlerMs = toggleTimer.Elapsed.TotalMilliseconds;
            Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(() =>
                ActivityLog.Log("build-queue.build-sets-panel",
                    $"Git #3807: Build Sets panel {(openedNow ? "opened" : "closed")} — handler {handlerMs:F0}ms, click-to-idle {toggleTimer.Elapsed.TotalMilliseconds:F0}ms (queue content column {QueueContentColumn.ActualWidth:F0}px)")));
        }

        private void ApplyBuildSetsPanelState()
        {
            // Git #3807 — measured cause of the multi-second toggle hang: opening Build Sets
            // re-partitioned this panel's own width, squeezing the Queue content column from
            // 300px to 60px. Every wrapping TextBlock in the queue cards then breaks roughly one
            // character per line, so re-measuring the real card list went from ~0.1s at 260px
            // to ~3.3s at 60px (cards grew to ~19,700px tall), and the open took 4.2-7.1s end to
            // end with a Running & Queued view of the real queue. The non-virtualized rollup
            // StackPanel was measured too and was not the cause (~0.1-0.4s cold, ~1-13ms warm).
            // MainWindow now grows ColQueue to make room (Git #3805), but that only holds while
            // the host actually has the width to give; pinning the Queue column at the width it
            // had before opening means opening Build Sets can never force that reflow, whatever
            // the outer layout does. Too narrow a host now clips instead of hanging.
            QueueContentColumn.MinWidth = _buildSetsPanelOpen
                ? QueueContentColumn.ActualWidth
                : 0;
            BuildSetsColumn.Width = _buildSetsPanelOpen ? new GridLength(BuildSetsPanelWidth) : new GridLength(0);
            BuildSetsPanelBorder.Visibility = _buildSetsPanelOpen ? Visibility.Visible : Visibility.Collapsed;
            ToggleBuildSetsIcon.Foreground = _buildSetsPanelOpen
                ? (Brush)FindResource("BlueBrush")
                : (Brush)FindResource("Subtext1Brush");
            BtnToggleBuildSets.ToolTip = _buildSetsPanelOpen
                ? "Hide Build Sets panel"
                : "Show Build Sets panel";
        }

        // Git #3767 — separate re-entry guards for the two narrow buttons (was one shared
        // _combinedRefreshInFlight guarding the single combined span). Each button now has its
        // own independent in-flight span; clicking one no longer blocks/is blocked by the other.
        private bool _boardRefreshInFlight;
        private bool _batterUpRefreshInFlight;

        private AnimationClock? _refreshBoardSpinClock;
        private AnimationClock? _refreshBatterUpSpinClock;

        // Git #3689 lesson (see KeyedSlotCardHost.BeginOwnedAnimation): BeginAnimation(dp, null)
        // only unhooks the element — a RepeatBehavior.Forever clock keeps ticking every frame
        // until GC happens to collect it. Stop it for real via Controller.Stop() before dropping it.
        private void StartRefreshBoardSpin()
        {
            StopRefreshBoardSpin();
            var spin = new DoubleAnimation(0, 360, TimeSpan.FromSeconds(0.9))
            {
                RepeatBehavior = RepeatBehavior.Forever
            };
            _refreshBoardSpinClock = spin.CreateClock();
            RefreshBoardIconRotate.ApplyAnimationClock(RotateTransform.AngleProperty, _refreshBoardSpinClock);
        }

        private void StopRefreshBoardSpin()
        {
            if (_refreshBoardSpinClock == null) return;
            _refreshBoardSpinClock.Controller?.Stop();
            RefreshBoardIconRotate.ApplyAnimationClock(RotateTransform.AngleProperty, null);
            _refreshBoardSpinClock = null;
        }

        private void StartRefreshBatterUpSpin()
        {
            StopRefreshBatterUpSpin();
            var spin = new DoubleAnimation(0, 360, TimeSpan.FromSeconds(0.9))
            {
                RepeatBehavior = RepeatBehavior.Forever
            };
            _refreshBatterUpSpinClock = spin.CreateClock();
            RefreshBatterUpIconRotate.ApplyAnimationClock(RotateTransform.AngleProperty, _refreshBatterUpSpinClock);
        }

        private void StopRefreshBatterUpSpin()
        {
            if (_refreshBatterUpSpinClock == null) return;
            _refreshBatterUpSpinClock.Controller?.Stop();
            RefreshBatterUpIconRotate.ApplyAnimationClock(RotateTransform.AngleProperty, null);
            _refreshBatterUpSpinClock = null;
        }

        // Git #3767 — real, partial reversal of #3702's combined button. This is the cheap half:
        // Board diff sync ONLY (via BoardRefreshRequested — Board + the purely local cascade that
        // consumes it: chats tree, git status, manifests, dashboard, open detail tabs). Deliberately
        // does NOT touch Batter Up, AI Batter Up, Issues in Epic, In-Flight, or Focus Progress —
        // those were the real GitHub-load contributors that could trip GitHubRateLimitCircuit from
        // one manual click. RefreshActiveSessionsAsync + the dev-server rollback check are folded
        // in here (explicit call, not a silent bundle): both are genuinely zero-GitHub-cost (local
        // process list / local filesystem read respectively), so folding them in adds no rate-limit
        // risk and keeps their #2900 "manual-refresh-only, nothing lost" guarantee intact. Sequential
        // (not parallel) with the local queue re-read, same as the old combined button.
        private async void BtnRefreshBoard_Click(object sender, RoutedEventArgs e)
        {
            if (_boardRefreshInFlight) return;
            _boardRefreshInFlight = true;
            BtnRefreshBoard.IsEnabled = false;
            StartRefreshBoardSpin();
            try
            {
                ActivityLog.Log("github.manual-refresh",
                    "Build Queue panel [manual Board Refresh click]: Board diff sync only, then the local queue re-read (Git #3767 — narrowed from #3702's six-subsystem combined button).");

                var boardRefresh = BoardRefreshRequested;

                // Git #2900/#3767 — zero-GitHub-cost local pieces, folded into this button (see
                // this method's own doc comment for why this button, not the Batter Up one).
                _ = RefreshActiveSessionsAsync();
                DevServerRollbackService.CheckForRollbacks(this);

                // Step 1 — Board diff sync only.
                await (boardRefresh?.Invoke() ?? System.Threading.Tasks.Task.CompletedTask);

                // Step 2 — Queue, only once step 1 above has genuinely finished. Same real local-only
                // Postgres re-read (zero GitHub calls) the old BtnRefreshQueueLocal_Click did.
                await RefreshAsync(includeGitHubWork: false);

                ToastEngine.Success("Git Sync", "Refreshed Git Board!");
            }
            finally
            {
                StopRefreshBoardSpin();
                _boardRefreshInFlight = false;
                BtnRefreshBoard.IsEnabled = true;
            }
        }

        // Git #3767 — the other half of the split: a dedicated, narrow Batter-Up-ONLY refresh.
        // Real, exact reason this exists: the automatic queue-claim loop needs a cheap way to get
        // a fresh Batter Up read without paying for (or rate-limit-tripping via) Board, AI Batter
        // Up, Issues in Epic, In-Flight, or Focus Progress every time. Deliberately excludes AI
        // Batter Up too — this is Batter Up ONLY, per the issue's own exact ask.
        private async void BtnRefreshBatterUp_Click(object sender, RoutedEventArgs e)
        {
            if (_batterUpRefreshInFlight) return;
            _batterUpRefreshInFlight = true;
            BtnRefreshBatterUp.IsEnabled = false;
            StartRefreshBatterUpSpin();
            try
            {
                ActivityLog.Log("github.manual-refresh",
                    "Build Queue panel [manual Batter Up Refresh click]: Batter Up only, then the local queue re-read (Git #3767).");

                var batterUpRefresh = BatterUpOnlyRefreshRequested;

                // Step 1 — Batter Up only.
                await (batterUpRefresh?.Invoke() ?? System.Threading.Tasks.Task.CompletedTask);

                // Step 2 — Queue, only once step 1 above has genuinely finished. Same real local-only
                // Postgres re-read (zero GitHub calls) the old BtnRefreshQueueLocal_Click did.
                await RefreshAsync(includeGitHubWork: false);

                // Git #3448, narrowed by #3767 — report real, honest Batter Up sync status instead
                // of a generic "Refreshed!" message. LastGitSyncSummary was just set above (inside
                // the awaited batterUpRefresh call) from the real closed-sweep result Batter Up's
                // own RefreshAsync landed. Falls back to static text only if
                // BatterUpOnlyRefreshRequested has no subscriber (shouldn't happen once MainWindow
                // wires it, but keeps this button honest either way rather than throwing on a null).
                ToastEngine.Success("Batter Up Sync", string.IsNullOrWhiteSpace(LastGitSyncSummary)
                    ? "Refreshed Batter Up!"
                    : LastGitSyncSummary!);
            }
            finally
            {
                StopRefreshBatterUpSpin();
                _batterUpRefreshInFlight = false;
                BtnRefreshBatterUp.IsEnabled = true;
            }
        }

        /// <summary>
        /// Git #1836 — Shane: the Board refresh triggers the exact same GitHub fetch as Git
        /// Board's own refresh button, but showed no disabled-state feedback of its own while that
        /// fetch (and its critter loading strip, on the Git Board panel) was in flight. MainWindow
        /// — which already owns both this panel and LeftSidebar — calls this around its awaited
        /// LeftSidebar.RefreshGitBoardWithLoadingFeedbackAsync() so BtnRefreshBoard is disabled for
        /// that real span too. Git #3767 repointed this from BtnRefreshCombined to the new,
        /// narrower BtnRefreshBoard — the Batter-Up-only button never triggers this fetch, so it
        /// has no equivalent need for this feedback. Note this can flip IsEnabled back to true
        /// mid-way through BtnRefreshBoard_Click's own Step 2 (local queue re-read) —
        /// _boardRefreshInFlight, not IsEnabled, is the real reentry guard for the whole span.
        /// </summary>
        public void SetGitHubTilesRefreshInProgress(bool inProgress) => BtnRefreshBoard.IsEnabled = !inProgress;

        private void TileInFlight_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileInFlight.IsChecked == true;
            TileInFlightContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileSessions.IsChecked = false;
                TileSessionsContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(InFlightIssuesList, _inFlightTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        private void TileSessions_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileSessions.IsChecked == true;
            TileSessionsContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileInFlight.IsChecked = false;
                TileInFlightContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(ActiveSessionsList, _sessionsTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        /// <summary>
        /// Automatically hides the bottom Critter Lounge animation when the Build Queue is full
        /// (>= 3 items rendered, or any of the collapsible accordion sections are open).
        /// </summary>
        public void UpdateCritterLoungeVisibility()
        {
            if (CritterLounge == null) return;
            int queueItemCount = _currentGraphNodes.Count;
            bool anyAccordionOpen = (TileInFlight?.IsChecked == true) || (TileSessions?.IsChecked == true);
            bool isFull = queueItemCount >= 3 || anyAccordionOpen;
            CritterLounge.Visibility = isFull ? Visibility.Collapsed : Visibility.Visible;
        }

        /// <summary>Safe stub for external callers in MainWindow & DevServerRollbackService.</summary>
        public void AddNeedsAttention(string key, string title, string body, bool isFailure, Action? onOpen, string? details = null)
        {
            ActivityLog.Log("testing.needs-attention", $"Needs attention recorded [{key}] ({title}): {body}");
        }

        /// <summary>Safe stub for external callers in MainWindow.</summary>
        public void ClearNeedsAttention(string key)
        {
            ActivityLog.Log("testing.needs-attention", $"Needs attention cleared [{key}]");
        }
    }
}
