using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    public class TabSwitcherCard
    {
        public string Title { get; set; } = string.Empty;
        public string Url { get; set; } = string.Empty;
        public string Glyph { get; set; } = "\uE8BD";
        public string IndexTag { get; set; } = "Tab 1";
        public int TabIndex { get; set; }
    }

    public partial class MainWindow : Window
    {
        // ── Layout constants ───────────────────────────────────────────────────
        private const double DefaultSidebarWidth  = 260;
        private const double DefaultQueueWidth    = 300;
        private const double DefaultBottomHeight  = 240;

        // ── Status dot brushes (frozen) ───────────────────────────────────────
        private static readonly SolidColorBrush DotReady   = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush DotLoading = Frozen(0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush DotError   = Frozen(0xF3, 0x8B, 0xA8);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        // ── Clock ─────────────────────────────────────────────────────────────
        private readonly DispatcherTimer _clockTimer;

        // ── Build Tracker API (shared by BuildQueuePanel + LeftSidebar's Issues board) ──
        private BuildConsole.Services.BuildTrackerApiClient? _buildTrackerApi;
        public BuildConsole.Services.BuildTrackerApiClient? BuildTrackerApi => _buildTrackerApi;
        private BuildConsole.Services.QueueWatcherService? _queueWatcher;
        private BuildConsole.Services.SessionLimitAutoRestartService? _sessionLimitAutoRestart;
        public BuildConsole.Services.QueueWatcherService? QueueWatcher => _queueWatcher;
        private BuildConsole.Services.BuildQueuePostgresClient? _queueDb;
        public BuildConsole.Services.BuildQueuePostgresClient? QueueDb => _queueDb;

        // ── Build completion sound (mute toggle: _Sound menu > Mute Completion Sound) ──
        private readonly BuildConsole.Services.BuildCompletionSoundService _buildSound = new();

        // ── Git #902: Replit idle watcher (background WebView2 + status indicator) ──
        private BuildConsole.Services.ReplitWatcherService? _replitWatcher;

        // ── Claude usage meter (background WebView2 poll of claude.ai/settings/usage) ──
        private BuildConsole.Services.ClaudeUsageMeterService? _usageMeter;

        // ── Claude Online Status (polls Anthropic Statuspage https://status.anthropic.com/api/v2/status.json) ──
        private BuildConsole.Services.ClaudeStatusService? _claudeOnlineService;
        private DispatcherTimer? _claudeOnlineTimer;

        // ── Animated startup loading overlay — honest per-connection progress while the
        //    real launch connections (Build Tracker board / in-flight / queue / deploy +
        //    Claude usage meter) settle; fades to Home once all are done or timed out. ──
        private BuildConsole.Services.StartupConnectivityService? _startupConnectivity;
        // #1882 — guards RunDeferredStartupAsync so ContentRendered only kicks it once.
        private bool _deferredStartupBegun;

        // ── Git #1884: grace-period delay + countdown banner before the auto-queue's
        //    #1883 hard readiness gate actually lifts. Starts counting the moment the app
        //    signals genuine readiness (AllSettled); the queue's launch gate stays closed
        //    until this elapses, "Start now" is clicked, or "Stop" is clicked. ──
        private static readonly TimeSpan AutoQueueGracePeriod = TimeSpan.FromSeconds(90);
        private DispatcherTimer? _autoQueueGraceTimer;
        private DateTime _autoQueueGraceEndUtc;
        private bool _autoQueueGraceResolved;

        // ── Git #967: background scheduled regression-suite runs + on-failure push alert ──
        private BuildConsole.Services.RegressionScheduleService? _regressionScheduler;

        // ── Git #802: chat tabs + their build split panes ───────────────────────
        private class ChatTabState
        {
            public int? GithubNumber;
            public Grid SplitGrid = null!;
            public ColumnDefinition BuildColumn = null!;
            public TextBox BuildOutputBox = null!;
            public TextBlock BuildStatusText = null!;
            public int? TailingQueueItemId;
            public long TailedLength;
            /// <summary>Git #942 — the tab's own claude.ai WebView2 (ChatButtonInjector's script was injected into it); needed so a live button-status push can reach the exact view holding the button.</summary>
            public Microsoft.Web.WebView2.Wpf.WebView2 WebView = null!;
            public Controls.SqlDocumentView? InlineSqlRunner;
            public GridSplitter? SqlSplitter;
            public ColumnDefinition? SqlColumn;
            /// <summary>Git #2548 — the Chat Document Container chrome wrapping this tab's chat body
            /// (the WebView2 split grid lives inside it). Null for a tab opened before this landed.</summary>
            public Controls.ChatDocumentContainer? Container;
            /// <summary>Git #2688 — the handler subscribed to <see cref="Controls.LeftSidebar.BoardRefreshCompleted"/>
            /// so this tab's Detected panel refreshes on the same cascade Batter Up/AI Batter Up already
            /// use (#1813). Kept so <see cref="CloseTab"/> can unsubscribe it and let the container be
            /// collected instead of leaking a handler forever.</summary>
            public EventHandler? DetectedRefreshHandler;
        }
        private readonly Dictionary<TabItem, ChatTabState> _chatTabs = new();

        private class ChatContextMeterState
        {
            public ProgressBar ProgressBar = null!;
            public Border Banner = null!;
            public TextBlock BannerText = null!;
            public Button BannerCloseBtn = null!;
            /// <summary>Git #1470 — "Hand Off Now" button shown only in the critical (red) banner.
            /// Handoff never fires automatically anymore; this is the sole way it fires, on Shane's
            /// own click, so he's never force-navigated away or blocked from reading/opening other chats.</summary>
            public Button HandoffBtn = null!;
            public bool BannerDismissed;
            public double EstimatedTokens;
            public int TurnCount;
            public int HeavyTurnCount;
            public double Cost;
            public double RemainingBuffer;
            /// <summary>Guards against double-firing while a click-triggered handoff is already in flight (not an "already fired" latch — Shane can retry from the button again if one attempt fails).</summary>
            public bool HandoffInProgress;
            /// <summary>Git #1436 — set once the injected scraper (ChatContextMeterScript) reports
            /// sustained zero-turn detection on what otherwise looks like a real populated chat page,
            /// i.e. its selectors likely no longer match claude.ai's current DOM. Latches true so the
            /// warning stays visible even if a later poll happens to find something transiently.</summary>
            public bool SelectorsLikelyStale;
            /// <summary>Git #1628 — the claude.ai conversation id (/chat/&lt;uuid&gt;) this meter is
            /// currently tracking, as reported on the BT_CHAT_STATS payload. Used to clamp/persist the
            /// per-conversation monotonic high-water via <see cref="Services.ChatContextMeterStore"/> so
            /// DOM churn can't drag the bar down and reopening a chat restores its level.</summary>
            public string? ConversationId;
        }

        private readonly Dictionary<Microsoft.Web.WebView2.Wpf.WebView2, ChatContextMeterState> _contextMeters = new();
        /// <summary>Git #942 — queue item id -> last label pushed to that item's injected chat button ("In Progress..."/"Done"/"Failed: Retry"). Populated when BT_QUEUE_BUILD captures a real id; drained by PushChatButtonStatuses the moment an item hits a terminal state (done/failed/canceled) or leaves the queue, so nothing is polled forever. UI-thread only (event handler + DispatcherTimer), so no locking needed.</summary>
        private readonly Dictionary<int, string> _chatButtonStatus = new();
        private DispatcherTimer? _buildTailTimer;

        // ── Git #874 Home screen — native landing tab + real-data roll-up ───────
        private const string HomeTabTag = "home://";
        private BuildConsole.Controls.HomeView? _homeView;
        /// <summary>The persisted open-chat-tabs snapshot loaded ONCE at launch — what the Home "Where you left off" section shows, so it always reflects where the LAST session ended, not this session's live tab state.</summary>
        private List<BuildConsole.Services.PersistedChatTab> _chatTabsAtLaunch = new();
        private DispatcherTimer? _homeRollupTimer;
        // ── Home "What's New" patch-notes (computed ONCE at launch) ───────────────
        // The real commit titles for BuildConsole that landed since the last launch,
        // computed off the UI thread once at startup (VersionInfo.GetNewCommitTitles,
        // reusing the #992 build number) and cached here so re-opening the Home tab
        // re-renders the same set without re-hitting git. LastSeenBuild is advanced to
        // the current build the moment this is computed, so the same changes never show
        // again on the next launch unless newer commits have landed.
        private bool _whatsNewReady;
        private string _whatsNewVersion = "";
        private List<string> _whatsNewTitles = new();
        private int _whatsNewMore;
        private int _whatsNewLastSeen = -1;
        private int _whatsNewCurrent = -1;
        /// <summary>Open-issue-number cache for the Home "Done, waiting for you" section (a `gh` CLI read). Manual-only GitHub (Shane, 2026-08-14): refreshed ONLY on a force roll-up (Home-tab open/refresh), no longer on a ~60s background cadence — the background 10s tick keeps the local-dev-server queue live without touching GitHub.</summary>
        private HashSet<int> _homeOpenIssueNumbers = new();
        /// <summary>Content signature of the last Running/Done render — skips the re-render (and its section-render log) on a 10s tick whose data is identical, same anti-flicker pattern as BuildQueuePanel's _lastQueueSignature.</summary>
        private string? _homeRollupSignature;

        // ── Git #937: always-on-top Sticky Notes floaty ─────────────────────────
        private StickyNotesWindow? _stickyNotes;

        // ── Git #980: floaty 8-slot Build Watch window ──────────────────────────
        private BuildWatchWindow? _buildWatch;

        // ── Git #2483: maximized Build Chain Map window (replaces the old #2110
        //    floaty Build Queue Map in the left-toolbar slot) ─────────────────────
        private BuildChainMapWindow? _buildChainMap;


        // ── Git #1472: floaty Visual Test Tracker window (separate from Sticky Notes) ──
        private VisualTestTrackerWindow? _visualTestTracker;
        // The editor pane (of the four from #893) the user last interacted with —
        // Send targets whatever Claude chat is active THERE. Updated both on tab
        // selection and on keyboard focus entering a pane (clicking into a
        // WebView2 to type doesn't change WPF selection, but it does move focus).
        private TabControl? _activeEditorPane;

        // ── Git #805 / #1421: deploy-status poll (Epic #803 Phase 1) — local git
        // read since #1421, no longer an HTTP call to the local Dev api-server ────
        private DispatcherTimer? _deployStatusTimer;
        private string? _lastSeenDeployCommitHash;

        // ── Git #1886: periodic safety-net save for PersistOpenChatTabs() ────────
        private DispatcherTimer? _persistTabsTimer;

        // ── Git #1417: local PostgreSQL Windows-service status poll ──────────────
        private DispatcherTimer? _postgresStatusTimer;
        private BuildConsole.Services.PostgresServiceStatus? _lastPostgresStatus;

        // ── Epic #803: auto deploy+verify+test on build completion ────────────────
        // The missing automation between "a queue build finished" and "its code is live
        // and tested". On QueueWatcherService.BuildFinished (success) it reuses the exact
        // endpoints trigger-deploy-and-wait.ps1 drives (#911 build-complete + #805
        // deploy-status), then runs the regression sweep and surfaces the result.
        private BuildConsole.Services.PostBuildDeployPipeline? _postBuildDeploy;

        // ── Git #806: test manifest runner (Epic #803 Phase 2) ───────────────────
        private BuildConsole.Services.TestManifest? _loadedManifest;

        // ── Git #898: remote UI-test trigger poll (Epic #803) ────────────────────
        // Claude Code (headless, no GUI) POSTs a run request to the api-server; THIS
        // already-running app is the only thing with a real Windows GUI session that
        // can drive a manifest's WebView2 uiSteps. Same DispatcherTimer poll shape as
        // the build queue watcher (#817) and the deploy-status poll (#805).
        private DispatcherTimer? _testTriggerTimer;
        private bool _testTriggerBusy;
        // Git #1969 — same transition-only logging discipline as BuildTrackerApiClient's
        // own TrackAsync: an unreachable API server should log once on the way down and
        // once on the way back up, not every 5s tick forever.
        private bool _testTriggerPollReachable = true;

        // ── shaneapp://executeSql local protocol listener (SQL trigger) ──────────
        // The counterpart to #898's HTTP test-trigger, but a LOCAL-machine handoff
        // (named pipe) rather than HTTP for the TRIGGER — the SQL itself then runs
        // through the SAME pipe the manual SQL Runner uses (LocalSqlExecutor →
        // BuildTrackerApiClient.ExecuteSqlAsync → POST /api/simulator/sql/execute), not a
        // direct local Postgres connection; a caller lacking BuildConsole's config can't reach it.
        private BuildConsole.Services.ShaneAppProtocol? _shaneAppListener;
        /// <summary>Refuse pathologically large payload files (SQL scripts are tiny — this is a sanity ceiling, not a real limit).</summary>
        private const long ShaneAppMaxPayloadBytes = 2L * 1024 * 1024;

        // ── Git #857: dedicated Test Runner window, replacing the retired bottom
        // "Test Results" tab entirely — reused across runs for the app's lifetime
        // (a new one is only created if none exists yet or Shane closed the last one).
        private TestRunnerWindow? _testRunnerWindow;

        // ── Git #2532 (Feature: Test Pad #2530): always-visible bottom-right pill +
        // the pad it expands to, ported from ShaneBuilder. Created once at startup (real,
        // interactive sessions only — never in --agent/quiet-courier mode) and kept alive for the
        // app's lifetime; MainWindow_Closing below explicitly closes both before the process
        // shuts down (the #2487 lesson — a second top-level window must never keep the process
        // alive past MainWindow closing).
        private BuildConsole.TestPad.TestPadPillWindow? _testPadPill;
        private BuildConsole.TestPad.TestPadWindow? _testPadPad;

        /// <param name="background">True for a single run (Play Test, double-click, shaneapp://runTest,
        /// #898 remote) — the window is parked off-screen (hidden, renderable, no focus steal) and
        /// RunManifestAsync then auto-closes it (clean) or toasts (attention). False for a regression
        /// SWEEP — the window stays on-screen/background so the sweep is watchable and never orphaned.</param>
        private TestRunnerWindow EnsureTestRunnerWindow(bool background)
        {
            if (_testRunnerWindow == null)
            {
                _testRunnerWindow = new TestRunnerWindow();
                _testRunnerWindow.Closed += (_, _) => _testRunnerWindow = null;
                _testRunnerWindow.RetryRequested += TestRunnerWindow_RetryRequested;
                // Set the position/state BEFORE the first Show() (window is ShowActivated="False", so
                // neither path steals focus): a single run flashes nothing onto Shane's main screen
                // ("tests should never interrupt me... Right now the tests take up my main screen"),
                // a sweep comes up visible-but-unfocused.
                if (background) _testRunnerWindow.PrepareForBackgroundRun();
                else _testRunnerWindow.EnsureOnScreenBackground();
                _testRunnerWindow.Show();
            }
            else if (background)
            {
                // Re-park a reused window that a previous "needs attention" run may have left centred.
                _testRunnerWindow.PrepareForBackgroundRun();
            }
            else
            {
                _testRunnerWindow.EnsureOnScreenBackground();
            }
            // Deliberately NO Activate() — no run steals focus. RunManifestAsync brings the window forward
            // itself (via the attention toast's click-through) only when a single run needs attention.
            return _testRunnerWindow;
        }

        // Git #968 (Epic #803): same reused-across-the-app's-lifetime pattern as
        // EnsureTestRunnerWindow — a new one is only created if none exists yet or Shane
        // closed the last one.
        private TestHistoryWindow? _testHistoryWindow;

        /// <summary>issueFilter narrows the window to one manifest's own run history (e.g. opened from the
        /// manifest steps flyout's "History" button); null shows the full unfiltered history across all
        /// manifests (Menu &gt; Run &gt; "Test History…").</summary>
        private TestHistoryWindow EnsureTestHistoryWindow(int? issueFilter = null)
        {
            if (_testHistoryWindow == null)
            {
                _testHistoryWindow = new TestHistoryWindow();
                _testHistoryWindow.Closed += (_, _) => _testHistoryWindow = null;
                _testHistoryWindow.Show();
            }
            _testHistoryWindow.Activate();
            _testHistoryWindow.Refresh(issueFilter);
            return _testHistoryWindow;
        }

        // ── Git #2532 (Feature: Test Pad #2530) — pill + pad, ported from ShaneBuilder ──────────
        /// <summary>Creates the always-visible bottom-right Test Pad pill (idempotent — a no-op if
        /// it already exists) and shows it. The pill's own click toggles <see cref="_testPadPad"/>
        /// open/closed via <see cref="ToggleTestPadPad"/>.</summary>
        private void EnsureTestPadPill()
        {
            if (_testPadPill != null)
            {
                return;
            }

            _testPadPill = new BuildConsole.TestPad.TestPadPillWindow { OnTogglePad = ToggleTestPadPad };
            _testPadPill.Closed += (_, _) => _testPadPill = null;
            _testPadPill.Show();
        }

        private void ToggleTestPadPad()
        {
            if (_testPadPad != null && _testPadPad.IsVisible)
            {
                _testPadPad.Hide();
                return;
            }

            if (_testPadPad == null)
            {
                _testPadPad = new BuildConsole.TestPad.TestPadWindow { OnPadClosed = () => { } };
                _testPadPad.Closed += (_, _) => _testPadPad = null;
            }

            _testPadPad.Show();
            _testPadPad.Activate();
        }

        /// <summary>Git #2532 / the #2487 lesson — the Test Pad pill (and pad) are a second
        /// top-level window, so with <see cref="System.Windows.ShutdownMode.OnExplicitShutdown"/>
        /// (App.xaml) nothing auto-exits the process once MainWindow closes; this explicit
        /// Shutdown() is what actually ends it, closing every other open window (the pill, the pad,
        /// and any of the floaties above still open) along the way.</summary>
        private bool _shuttingDown;

        private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            // Guard against re-entrancy: Application.Shutdown() itself closes every open window
            // (including this one) as part of its own shutdown sequence, which would otherwise
            // fire this handler a second time.
            if (_shuttingDown)
            {
                return;
            }
            _shuttingDown = true;
            System.Windows.Application.Current.Shutdown();
        }

        private void OpenTestHistory_Click(object sender, RoutedEventArgs e)
        {
            EnsureTestHistoryWindow();
        }

        /// <summary>Called from controls (e.g. GitDetailView) to open history filtered to a specific issue.</summary>
        public void EnsureTestHistoryWindowPublic(int? issueFilter = null) => EnsureTestHistoryWindow(issueFilter);

        public MainWindow()
        {
            InitializeComponent();

            // Git #1864 — Shane: "make the search box not so tall... it fits properly."
            // Sized against the window's REAL WindowChrome.CaptionHeight (not a guessed
            // pixel value) so it fits the 36px caption bar cleanly and adapts if that
            // height is ever tuned. See SizeSearchBoxToCaptionHeight for the full sizing.
            SizeSearchBoxToCaptionHeight();

            // Set dark background on XAML background webview so it never flashes white
            ClaudeWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37);

            // Build completion sound mute toggle — reflect the persisted state
            // (%AppData%\BuildConsole\settings.json) in the menu checkmark on launch.
            MuteCompletionSoundMenuItem.IsChecked = BuildConsole.Services.BuildConsoleSettings.Load().BuildCompleteSoundMuted;

            // Git #1419 — title-bar Primary/Secondary account toggle: reflect the persisted
            // global default on launch.
            RefreshTopAccountToggleUi();

            // Git #1989 — title-bar Conservation Cap toggle: reflect the persisted state on
            // launch. A pre-existing settings.json with no ConservationModeEnabled key
            // deserializes that field to its C# default (false) — loads OFF, per spec.
            RefreshTopConservationToggleUi();

            // Git #2003 — title-bar usage-automation toggle: reflect the persisted state on launch.
            // A pre-#2003 settings.json (no UsageAutomationEnabled key) deserializes to false — the
            // feature loads OFF and behaves as the pure manual controls until Shane turns it on.
            RefreshTopAutomationUi();

            // Git #1986 — title-bar Home/Rental location toggle: reflect the persisted
            // LocationMode on launch. A pre-existing settings.json with no LocationMode key
            // deserializes that field to its C# default ("Home") — loads Home/unmetered, per
            // spec (never silently start throttling). No override is ever live at launch.
            RefreshTopLocationToggleUi();

            // Git #934 — Shane: "add a - [DEBUG] if I have the app open in
            // the Debug folder." Checked by the running exe's OWN path
            // (bin\Debug\... vs bin\Release\...), not a `#if DEBUG`
            // compile-time symbol - that answers "was this DLL built in
            // Debug configuration," not "am I actually running the copy
            // that lives in the Debug folder," which is what Shane's own
            // wording is really asking (e.g. catches a stale Debug exe he
            // forgot he had open, even if a fresh Release build exists).
            // Sets both the native window Title (Alt+Tab/taskbar hover
            // still read this even with the custom title bar from #894)
            // and the custom bar's own inline marker.
            if (System.Reflection.Assembly.GetExecutingAssembly().Location
                .IndexOf(System.IO.Path.Combine("bin", "Debug"), StringComparison.OrdinalIgnoreCase) >= 0)
            {
                Title += " - [DEBUG]";
                DebugBuildMarkerText.Visibility = Visibility.Visible;
            }

            // Git #1864 — title-bar usage/cost readout, replacing the old out-of-place
            // active-document label. Set the initial value from GetSnapshot() now (Changed
            // won't have fired yet), then subscribe so it refreshes live off the
            // UsageTrackingService.Changed event (fires off any thread — marshal to the UI
            // thread) — no polling, no new timer. Same subscription pattern as the Build
            // Queue panel's own usage badge (Controls/BuildQueuePanel.xaml.cs).
            UpdateUsageReadout();
            BuildConsole.Services.UsageTrackingService.Changed += () => Dispatcher.BeginInvoke(new Action(UpdateUsageReadout));

            // Git #815 — Shane: "put the startup SSE and api calls in
            // there... so we can just look and see whats happening as its
            // happening in the background. This should be multi-threaded so
            // my app doesnt hang." ActivityLog.Log() never blocks its caller
            // (BeginInvoke onto the UI thread) - safe to call from any
            // background await continuation, which is exactly where every
            // real API call in this app runs.
            BuildConsole.Services.ActivityLog.Attach(Dispatcher);
            BuildConsole.Services.ActivityLog.LineLogged += AppendOutputLog;
            BuildConsole.Services.ActivityLog.Log("startup", "BuildConsole starting…");

            // Git #1838 — passive agent shell (--agent / --dev / BUILDCONSOLE_AGENT=1). Make the
            // mode visible: the title-bar [AGENT] marker (a screenshot then proves which mode ran)
            // and the native window Title (Alt+Tab/taskbar hover read this even with the custom
            // title bar), plus ONE system.core line naming the mode and everything it suppressed.
            if (BuildConsole.Services.AppMode.IsAgent)
            {
                AgentModeMarkerText.Visibility = Visibility.Visible;
                Title += " - [AGENT]";
                BuildConsole.Services.ActivityLog.Log("system.core",
                    $"Launch mode: AGENT (passive shell, selected by {BuildConsole.Services.AppMode.SelectedBy}). " +
                    "Suppressed: queue watcher, session-limit auto-restart, Batter Up auto-queue, " +
                    "Dispatch, post-build deploy pipeline, test-trigger poll, regression scheduler, " +
                    "Replit watcher, usage meter, shaneapp:// pipe listener, AI Batter Up Yes/No. " +
                    "No builds are claimed, launched, deployed or tested and no pipe is taken.");
            }

            // Clock
            _clockTimer = new DispatcherTimer(DispatcherPriority.Background)
            {
                Interval = TimeSpan.FromSeconds(1)
            };
            _clockTimer.Tick += (_, _) => ClockText.Text = DateTime.Now.ToString("HH:mm:ss");
            _clockTimer.Start();
            ClockText.Text = DateTime.Now.ToString("HH:mm:ss");

            InitializeResourceMonitor();

            // Wire mouse and keyboard activity for Sailor Duck mascot idle tracking
            PreviewMouseMove += (_, _) => SailorDuckLayer?.NotifyUserActivity();
            PreviewMouseDown += (_, _) => SailorDuckLayer?.NotifyUserActivity();

            // Initial WebView2 events
            ClaudeWebView.NavigationStarting  += WebView_NavigationStarting;
            ClaudeWebView.NavigationCompleted += WebView_NavigationCompleted;
            ClaudeWebView.SourceChanged       += WebView_SourceChanged;

            // #1882 — Get the animated startup overlay ON SCREEN before any heavy startup
            // work runs. A real cold-start trace showed ~8s of synchronous construction
            // (WebView2 env warmup, queue watcher, panels, Home tab, focus mode…) executing
            // on the UI thread BEFORE the window was ever shown — so the user saw a frozen
            // black window first and the overlay only appeared at the tail end, then
            // dismissed while WebView2/Home were still settling. Fix: wire the overlay's
            // honest rows + events now (cheap; no probes yet), then defer ALL of that heavy
            // work to RunDeferredStartupAsync, kicked off once the first frame has actually
            // rendered (ContentRendered). The overlay paints and animates immediately and
            // stays up — via the shell-ready gate — until the real work below is genuinely
            // done.
            InitializeStartupOverlayShell();
            ContentRendered += MainWindow_FirstRender;
        }

        /// <summary>
        /// #1882 — fires once, after the window's first frame is on screen (so the animated
        /// startup overlay is already painting). Kicks off <see cref="RunDeferredStartupAsync"/>.
        /// </summary>
        private void MainWindow_FirstRender(object? sender, EventArgs e)
        {
            // ContentRendered can fire more than once over a window's lifetime; only the
            // first firing starts up, and we unhook immediately so it can't run twice.
            ContentRendered -= MainWindow_FirstRender;
            if (_deferredStartupBegun) return;
            _deferredStartupBegun = true;
            RunDeferredStartupAsync();
        }

        /// <summary>
        /// #1882 — the heavy startup work, deferred to run AFTER the window's first frame is
        /// on screen so the animated overlay appears first and keeps animating while this
        /// runs. Chunked with Dispatcher yields at natural phase boundaries so the UI thread
        /// stays responsive (the overlay never freezes), and it always calls
        /// <c>MarkShellReady()</c> in the finally — so the overlay dismisses only once this
        /// real work is done, and ALWAYS dismisses even if a step throws.
        /// </summary>
        private async void RunDeferredStartupAsync()
        {
            try
            {
                // Phase 1: Load essential config and API clients first
                var btConfig = BuildConsole.Services.BuildTrackerConfig.Load();
                BuildConsole.Services.ActivityLog.Log("startup", btConfig.IsConfigured
                    ? $"Config loaded: {btConfig.ApiBaseUrl}"
                    : $"Config NOT found/incomplete (checked {BuildConsole.Services.BuildTrackerConfig.FindConfigPath() ?? "scripts\\build-queue-watcher.config.json"}) — panels will show 'Not connected'.");
                _buildTrackerApi = new BuildConsole.Services.BuildTrackerApiClient(btConfig);

                if (_buildTrackerApi.IsConfigured)
                {
                    var repoRootForDb = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                    _queueDb = BuildConsole.Services.BuildQueuePostgresClient.TryCreate(
                        btConfig,
                        repoRootForDb,
                        msg => BuildConsole.Services.ActivityLog.Log("watcher", msg));
                }

                _usageMeter = new BuildConsole.Services.ClaudeUsageMeterService();
                _usageMeter.StatusChanged += UsageMeter_StatusChanged;
                // Git #2003 — when the automation service acts on a poll (engages/releases the cap,
                // or flips active/inactive), repaint the Conservation toggle and the automation
                // status text. Marshal to the UI thread — the event fires from the meter callback.
                BuildConsole.Services.UsageAutomationService.Instance.Changed += () =>
                {
                    if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(new Action(OnAutomationChanged)); return; }
                    OnAutomationChanged();
                };
                if (!BuildConsole.Services.AppMode.IsAgent)
                {
                    _usageMeter.Start();
                }

                _replitWatcher = new BuildConsole.Services.ReplitWatcherService();
                _replitWatcher.StatusChanged += ReplitWatcher_StatusChanged;
                _replitWatcher.OpenVisibleWorkspaceTab = OpenOrFocusReplitWorkspaceTabAsync;
                if (!BuildConsole.Services.AppMode.IsAgent)
                {
                    _replitWatcher.ApplyConfig();
                }

                // KICK OFF STARTUP CONNECTIVITY PROBES IMMEDIATELY ON FRAME 1!
                // This ensures the splash overlay's rows update immediately while background work runs.
                _startupConnectivity?.Start(_buildTrackerApi, _replitWatcher, _queueDb);

                // Yield execution to Dispatcher so the splash overlay paints and animates immediately
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);

                // Phase 2: Build Queue Panel & Queue Watcher
                _ = InitializeClaudeTabAsync();
                BuildQueuePanel.TaskSelected += BuildQueuePanel_TaskSelected;

                if (_buildTrackerApi.IsConfigured)
                {
                    _queueWatcher = new BuildConsole.Services.QueueWatcherService(
                        _buildTrackerApi, _queueDb, btConfig.MaxConcurrent, BuildConsole.Services.BuildTrackerConfig.FindRepoRoot());
                    _queueWatcher.BuildFinished += QueueWatcher_BuildFinished;

                    // Git #1883 — the pickup loop must never claim/launch a queued item until
                    // the app itself is genuinely, fully ready — #1882's real AllSettled signal
                    // (every launch connection AND the "Application shell" row settled), not
                    // just the loading overlay visually dismissing. Wired here, BEFORE
                    // _queueWatcher.Start() is ever called below, so there's no window where a
                    // claim could slip through before this subscription exists. AllSettled may
                    // fire on a background thread, so hop to the UI thread before touching the
                    // #1884 grace-period timer/banner below.
                    //
                    // Git #1884 — genuine readiness no longer lifts the launch gate immediately;
                    // it starts a real grace-period countdown (StartAutoQueueGracePeriod), and
                    // MarkAppReady is only actually called once that countdown elapses, or the
                    // user clicks "Start now"/"Stop" on the banner it shows.
                    if (_startupConnectivity != null)
                        _startupConnectivity.AllSettled += () => Dispatcher.BeginInvoke(new Action(StartAutoQueueGracePeriod));

                    _sessionLimitAutoRestart = new BuildConsole.Services.SessionLimitAutoRestartService(
                        _queueDb, () => _queueWatcher?.SetPaused(false));
                    _queueWatcher.SessionLimitAutoRestart = _sessionLimitAutoRestart;
                    _sessionLimitAutoRestart.LimitPausedResumed += count => Dispatcher.BeginInvoke(() =>
                    {
                        try { _ = BuildQueuePanel.RefreshAsync(); } catch { }
                    });

                    if (!BuildConsole.Services.AppMode.IsAgent)
                    {
                        _ = _sessionLimitAutoRestart.StartAsync();
                        _queueWatcher.Start();
                        StartTestTriggerPoll();

                        string? postBuildRepoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                        if (string.IsNullOrWhiteSpace(postBuildRepoRoot))
                        {
                            BuildConsole.Services.ActivityLog.Log("testing.post-build-deploy",
                                "Repo root unresolved — auto deploy+verify+test pipeline NOT armed this run. Check the repo-root-resolution toast/log.");
                        }
                        else
                        {
                            _postBuildDeploy = new BuildConsole.Services.PostBuildDeployPipeline(
                                postBuildRepoRoot,
                                () => _buildTrackerApi.PostBuildCompleteAsync(),
                                () => _buildTrackerApi.GetDeployStatusAsync(),
                                RunScopedManifestsAsync,
                                SurfacePostBuildDeployOutcome);
                        }
                    }

                    BuildQueuePanel.Initialize(_buildTrackerApi, _queueWatcher, _queueDb, _sessionLimitAutoRestart);
                }
                else
                {
                    BuildQueuePanel.Initialize(_buildTrackerApi, _queueWatcher);
                }

                // Yield to pump UI messages
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);

                // Phase 3: Batter Up & Dispatch Panels
                _batterUpPanel.RowsAutoQueued += (_, _) => { try { _ = BuildQueuePanel.RefreshAsync(); } catch { } };
                _batterUpPanel.Initialize(BuildConsole.Services.AppMode.IsAgent ? null : _queueDb);

                // Git #2058 — alongside the existing best-effort refresh, warn if the item just
                // dispatched may be hidden by an active Build Set filter on the queue panel below.
                // Git #2680 — also auto-search the Queue panel down to the just-dispatched issue
                // number, so Shane doesn't have to retype it below to find the row and Run Now it.
                // Awaits the refresh first so SearchAndFocus filters against the row that was just
                // queued, not against whatever _lastItems held before the dispatch.
                DispatchPanel.Dispatched += async issueNumber =>
                {
                    try
                    {
                        await BuildQueuePanel.RefreshAsync();
                        BuildQueuePanel.NotifyBuildDispatched();
                        BuildQueuePanel.SearchAndFocus(issueNumber);
                    }
                    catch { }
                };
                DispatchPanel.Initialize(BuildConsole.Services.AppMode.IsAgent ? null : _queueDb, _sessionLimitAutoRestart, _queueWatcher);

                _aiBatterUpPanel.Initialize();
                WireBatterUpTitleBarCounts();

                if (!BuildConsole.Services.AppMode.IsAgent)
                {
                    StartShaneAppProtocolListener();
                }
                else if (!string.IsNullOrEmpty(App.PendingProtocolUri))
                {
                    var pendingUri = App.PendingProtocolUri;
                    App.PendingProtocolUri = null;
                    if (App.QuietProtocolCourierLaunch)
                    {
                        // Git #1889 — this cold start's ONLY job was couriering this one payload
                        // (SQL, a test run, a progress report, …) — still never opening the ongoing
                        // pipe listener (agent mode must never be able to intercept a FUTURE URI
                        // meant for the real primary instance), but the URI it was actually launched
                        // WITH must run, not be silently dropped, or every shaneapp:// caller that
                        // races a cold start loses its result. Once it's handled, the process has
                        // nothing left to do — exit rather than leave a parked-off-screen instance
                        // sitting around indefinitely.
                        BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                            "Quiet --dev cold start — handling its one shaneapp:// URI without opening the pipe listener, then exiting.");
                        await HandleShaneAppUriAsync(pendingUri!);
                        System.Windows.Application.Current.Shutdown(0);
                        return;
                    }
                    BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                        $"Agent mode — NOT opening the shaneapp:// pipe listener; dropping pending cold-start URI: {pendingUri}");
                }

                // Git #2532 — the Test Pad pill is an always-visible bottom-right floaty, same
                // "never in agent/quiet-courier mode" gate as the shaneapp:// pipe listener above:
                // a --agent/--dev cold start (screenshot verification, or a one-shot protocol
                // courier) must never pop a second on-screen window Shane didn't ask for.
                if (!BuildConsole.Services.AppMode.IsAgent && !App.QuietProtocolCourierLaunch)
                {
                    EnsureTestPadPill();
                }

                // Yield before heavy sidebar & view initialization
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);

                // Phase 4: Sidebar and Log Views
                LeftSidebar.Initialize(_buildTrackerApi, _queueDb);
                BuildLogView.Initialize(_buildTrackerApi, _queueDb);
                TerminalView.Initialize(_buildTrackerApi);
                MarketingLogView.Initialize("shane-mccaw-consulting", "Marketing", 5173, "artifacts/shane-mccaw-consulting", "🌐");
                PortalLogView.Initialize("portal", "Portal", 5175, "artifacts/portal", "💼");
                AdminLogView.Initialize("admin-panel", "Admin", 5174, "artifacts/admin-panel", "⚙️");
                ApiServerLogView.Initialize("api-server", "API Server", 8080, "artifacts/api-server", "🖥️");

                BuildServicesMenu();
                StartTopServicesPoll();

                // Yield before final schedulers
                await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);

            // Git #967 (Epic #803) — background scheduler for unattended full-suite runs.
            // Reuses the same DispatcherTimer/ApplyConfig pattern as the Replit watcher,
            // injected with the existing full-suite runner (RunRegressionSuiteCollectAsync)
            // and the admin-push alert POST (BuildTrackerApiClient.SendTestAlertAsync).
            // ApplyConfig() arms/disarms per Settings; it's re-applied live when the
            // scheduled-runs settings are saved (SettingsTabView.ScheduleSettingsChanged,
            // wired per tab instance in OpenSettingsTab).
            _regressionScheduler = new BuildConsole.Services.RegressionScheduleService(
                RunRegressionSuiteCollectAsync,
                (title, body, linkPath) =>
                    _buildTrackerApi != null
                        ? _buildTrackerApi.SendTestAlertAsync(title, body, linkPath)
                        : System.Threading.Tasks.Task.FromResult(false));
            // Git #1838 — unattended full-suite runs plus admin alert POSTs. Never in agent mode.
            if (!BuildConsole.Services.AppMode.IsAgent)
            {
                _regressionScheduler.ApplyConfig();
            }

            // Claude Online Status (status.anthropic.com) — polls Anthropic's public Statuspage
            _claudeOnlineService = new BuildConsole.Services.ClaudeStatusService();
            _claudeOnlineService.StatusChanged += ClaudeOnlineService_StatusChanged;
            _claudeOnlineTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
            _claudeOnlineTimer.Tick += async (_, _) => await _claudeOnlineService.CheckStatusAsync();
            _claudeOnlineTimer.Start();
            _ = _claudeOnlineService.CheckStatusAsync();

            // Random Encouragement Critter — strolls across the screen periodically to cheer Shane on with milestone progress!
            // Git #1639 — default OFF; gated behind Settings > General > "Encouragement Critter" checkbox.
            // The manual "Cheer Me Up" menu item (TriggerCheerNow, below) is unaffected and always works.
            if (BuildConsole.Services.BuildConsoleSettings.Load().EncouragementCrittersEnabled)
            {
                BuildConsole.Services.EncouragementService.Instance.Start();
            }

            // Git #815 — surfaces a failed poll as a real, visible signal
            // (status-bar QueueDot/QueueStatusText, previously unused
            // hardcoded XAML) instead of silent inline tree text nobody
            // notices, PLUS every poll's outcome goes to the Output log too.
            LeftSidebar.SyncError += (s, err) => ReportSyncStatus(err);
            BuildQueuePanel.SyncError += (s, err) => ReportSyncStatus(err);
            // Git #1989 — Conservation Cap: the title-bar Drain button's count stays live off
            // BuildQueuePanel's own refresh cycle, same idiom as BtnBatterUp/BtnAiBatterUp's
            // CountChanged (Git #1872) — no second DB poll.
            BuildQueuePanel.CappedCountChanged += (s, count) => TopDrainCappedCount.Text = count.ToString();

            // Git #851 — Shane: "When clicking on an In-Flight Still Open
            // issue, it should open the chat that is associated to that
            // issue." Resolves via LeftSidebar's already-fetched chat/epic
            // data (no separate fetch) and opens/focuses it exactly like
            // clicking the same chat in the Chats tree would.
            // Git #1480 — header "paste a full prompt" button: same dialog + same
            // queue/send handling as the chat-injected Edit Build button, just entered
            // with an empty starting prompt instead of one seeded from a chat message.
            BuildQueuePanel.NewBuildPasteRequested += async (s, e) => await OpenBuildPromptDialogAsync("", null);
            BuildQueuePanel.IssueChatRequested += (s, githubNumber) => OpenChatForIssue(githubNumber);
            BuildQueuePanel.QueueItemChatRequested += (s, item) => OpenChatForQueueItem(item);
            BuildQueuePanel.BuildSetPriorityCompleted += (s, e) => OnBuildSetPriorityCompleted(e);
            // Git #1893 — build-set rollup's "send Verifying items as a landed-list" button,
            // routed through the exact same shared SendTextToActiveClaudeChatAsync path (#937)
            // as WireSqlRunnerSendToChat (#940) below uses for the SQL Runner's own Send to Chat.
            BuildQueuePanel.SendBuildSetVerifyingRequested += async (s, e) =>
                await SendTextToActiveClaudeChatAsync(
                    e.Text,
                    showMessage: (msg, isError) => e.ShowStatus(msg, isError),
                    onInserted: null,
                    logChannel: "build-queue.rollup-send-to-chat",
                    whatSingular: "landed list");
            BuildQueuePanel.EpicSubIssueClicked += async (s, githubNumber) => await OpenGitDetailByNumberAsync(githubNumber, sideBySide: true);
            // Git #2691 — point 3: live queue-state changes (queued → running → verifying) recolor
            // on-screen #NNN mentions even with no chat text mutation, by reusing this same real
            // ~15s poll tick that already updates BuildQueuePanel.CurrentQueueItems — no new
            // polling loop.
            BuildQueuePanel.QueueRefreshed += async (s, e) => await PushLiveMentionColorsAsync();
            // Git #1994 — Build Queue card's "Open Git #N" context-menu item.
            BuildQueuePanel.OpenGitIssueRequested += async (s, req) => await OpenGitDetailByNumberAsync(req.Number, req.SideBySide);
            // Git #1836 — this used to call LeftSidebar.PopulateGitTrackerBoard(forceFresh:
            // true) directly, bypassing the disable-button + critter-strip feedback that
            // Git Board's own refresh button (BtnRefreshGitBoard_Click) shows for the exact
            // same fetch. Both trigger paths now go through the one real implementation,
            // LeftSidebar.RefreshGitBoardWithLoadingFeedbackAsync — awaited here so the
            // strip has genuinely finished before the rest of this cascade runs, and
            // BuildQueuePanel's own button is disabled for that same real span.
            BuildQueuePanel.FullGitRefreshRequested += async (s, e) =>
            {
                BuildQueuePanel.SetGitHubTilesRefreshInProgress(true);
                try
                {
                    await LeftSidebar.RefreshGitBoardWithLoadingFeedbackAsync();
                    LeftSidebar.PopulateChatsTree();
                    LeftSidebar.RefreshGitStatus();
                    LeftSidebar.PopulateManifestsList();
                    if (_homeView != null)
                    {
                        _homeView.RenderDashboardState(LeftSidebar.CurrentBoardIssues, LeftSidebar.CurrentMilestones);
                    }
                    RefreshOpenGitDetailTabs();
                }
                finally
                {
                    BuildQueuePanel.SetGitHubTilesRefreshInProgress(false);
                }
            };

            // Shane, 2026-08-28: "when a build is in Verifying state and then
            // the Git issue behind it is closed, it should change to closed
            // and hide." LeftSidebar's board refresh (triggered by the above
            // FullGitRefreshRequested, or the Git Board's own refresh button)
            // just promoted one or more Verifying rows to Done — redraw the
            // Build Queue panel now so it drops out of the Active view right
            // away instead of waiting for the panel's own next poll.
            LeftSidebar.VerifyingIssuesPromoted += async (s, e) => await BuildQueuePanel.RefreshAsync();

            // Git #1600 — a build must not start while its GitHub blocker is still
            // open, checked live at dispatch time (see BuildQueuePostgresClient.
            // GetNextAsync). This is the other half: once a blocker DOES close, don't
            // make a held build wait out the watcher's own 10s poll — the Git Board
            // refresh above just proved GitHub is reachable, so kick an immediate
            // re-check right now.
            LeftSidebar.BoardRefreshCompleted += (s, e) => _queueWatcher?.RequestImmediateReevaluation();

            // Git #1632 — the eviction/promotion logic in BuildWatchWindow.
            // CheckIssueClosuresAsync (Git #980) already existed and already worked
            // but had zero callers since the 2026-08-14 automatic-poll removal. This
            // is trigger 1 of 2: LeftSidebar's board refresh (Git Board's own manual
            // Refresh button, or app startup) just fetched a real open-issue set for
            // free — forward it into an open Build Watch window (if one exists) so
            // its slots evict/promote off that same fetch, zero incremental `gh`
            // calls. Trigger 2 is BuildWatchWindow's own manual "Recheck closures"
            // title-bar icon, which calls CheckIssueClosuresAsync() directly.
            LeftSidebar.GitBoardOpenIssuesRefreshed += (s, openNumbers) => _buildWatch?.ApplyOpenIssueSet(openNumbers);

            // Git #1862 — the SAME free open-issue set also feeds the QUEUE panel, so its
            // four status counts and the DAG's 🔒 BLOCKED reflect which blockers GitHub
            // actually reports open right now (not merely declared). Zero extra `gh` calls —
            // second consumer of the exact fetch Build Watch already gets above.
            LeftSidebar.GitBoardOpenIssuesRefreshed += (s, openNumbers) => BuildQueuePanel?.ApplyOpenIssueSet(openNumbers);

            // Git #2066 — third consumer of the same free open-issue set: prune any
            // tracked chat-mention (bt_chat_mentioned_issues) whose issue number is no
            // longer in it, i.e. the issue closed in Git since the last board refresh.
            // Same "real close-detection mechanism already used elsewhere" the issue
            // asked for reused, not a second poll invented for this feature.
            LeftSidebar.GitBoardOpenIssuesRefreshed += async (s, openNumbers) =>
            {
                if (_queueDb == null) return;
                try
                {
                    int pruned = await _queueDb.PruneClosedChatIssueMentionsAsync(openNumbers);
                    if (pruned > 0)
                        ActivityLog.Log("chat.issue-mention", $"Pruned {pruned} tracked mention(s) whose issue closed in Git");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("chat.issue-mention", $"Prune-on-close FAILED (will retry next board refresh): {ex.Message}");
                }
            };

            // Git #1813 — same event-piggyback pattern as the two hooks just above:
            // a Git Board refresh (manual button or startup) just proved GitHub is
            // reachable and fetched a fresh open-issue set, so ride that same
            // completion to refresh Batter Up and AI Batter Up too. Git #1890 removed
            // both panels' own 90s auto-poll timer entirely — this cascade is now their
            // only automatic refresh path. Git #1872 — these two panels now live inside
            // MainWindow.BatterUpTabs.cs's hoisted document-tab instances instead of XAML
            // x:Name fields; this cascade must (and does) still reach them while their tab
            // is closed, since a closed tab only detaches the TabItem, not this instance.
            LeftSidebar.BoardRefreshCompleted += async (s, e) => await _batterUpPanel.RefreshAsync();
            LeftSidebar.BoardRefreshCompleted += async (s, e) => await _aiBatterUpPanel.RefreshAsync();

            // Git #2685 — same event-piggyback pattern as the hooks above. A self-blocked session
            // that wrote a real 🛑 BLOCKED bookend and exited cleanly gets marked 'done' by the
            // watcher (its only completion signal), then dedup-locks that issue forever because
            // 'done' is in none of the dedup dead-checks. Ride this same manual board refresh to
            // reconcile every false-done row against its authoritative origin/main bookend: reset it
            // to 'canceled' (re-dispatchable) and move its board Status to Backlog (a conscious
            // re-dispatch, never an auto-relaunch). Fail-soft — a reconcile error never breaks the
            // cascade.
            LeftSidebar.BoardRefreshCompleted += async (s, e) =>
            {
                if (_queueDb == null) return;
                try
                {
                    var settings = Services.BuildConsoleSettings.Load();
                    if (!settings.HasGitHubPat) return;
                    var gh = new Services.GitHubApiClient(settings.GitHubPat);
                    int n = await Services.FalseDoneReconciler.ReconcileAsync(
                        _queueDb, gh, msg => Services.ActivityLog.Log("batter-up", msg));
                    if (n > 0)
                        Services.ActivityLog.Log("batter-up",
                            $"Git #2685 false-done reconcile: {n} false-done row(s) reset to 'canceled' + moved to Backlog this refresh.");
                }
                catch (Exception ex)
                {
                    Services.ActivityLog.Log("batter-up", $"Git #2685 false-done reconcile FAILED: {ex.Message}");
                }
            };

            // Git #802 - Shane: "The Claude chats should open in their own
            // tabs. And if there is a build, that tab should split with the
            // build happening right there in that chats tab." Each chat gets
            // its own WebView2 tab (not the single shared ClaudeWebView
            // anymore); a shared timer watches the queue and splits/unsplits
            // each open chat tab based on whether ITS linked GitHub number has
            // a currently-running queue item ("still go through the queue" —
            // Shane's own answer when asked whether this should bypass it).
            LeftSidebar.ChatSelected += (s, e) => OpenChatTab(e.Chat, e.GithubNumber);

            // Git #922 (Epic #803) — right-click an epic → open its linked Claude
            // chat (InjectPrefill=false, an existing BoardChat.ClaudeUrl) or, if
            // none is linked yet, open the configured New Chat Project URL
            // prefilled with "{PAT}\r\nEpic #N" (InjectPrefill=true) and replicate
            // the extension's composer poll+insert in this WebView2 tab. Uses the
            // same OpenWebTab every other web tab already goes through.
            LeftSidebar.EpicChatRequested += (s, e) =>
                OpenWebTab(e.Url, e.Title, "", injectPrefillPoll: e.InjectPrefill, associateIssueNumber: e.IssueNumber, associateIssueType: e.IssueType, associateDefaultTitle: e.DefaultTitle);

            // Backs "Assign Chat to Epic..."'s "Assign current chat" button.
            // Git #1629 (root cause 1) — this used to resolve ONLY a tab whose Tag
            // was typed BoardChat (i.e. opened through BuildConsole's own
            // OpenChatTab flow), silently returning null for a chat Shane browsed
            // to himself in a plain web tab — exactly the tabs most likely to need
            // assigning, forcing manual URL copy-paste with its wrong/stale-paste
            // failure mode. Now ANY pane's selected tab genuinely showing a
            // claude.ai conversation resolves: live WebView2 source first,
            // BoardChat.ClaudeUrl snapshot as fallback (see TryGetChatUrlForTab).
            // The primary pane wins if several panes have chat tabs selected.
            LeftSidebar.GetActiveChatUrl = () =>
            {
                foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
                {
                    if (pane.SelectedItem is TabItem selected)
                    {
                        var url = TryGetChatUrlForTab(selected);
                        if (url != null) return url;
                    }
                }
                return null;
            };
            LeftSidebar.GetQueueItems = () => BuildQueuePanel.CurrentQueueItems;

            // Git #2061 — Git Board issue-hover popover's quick-action button wires straight
            // through to BuildQueuePanel's Quick*Async wrappers (same _watcher/_db calls the
            // right-click menu's Start Now/Cancel/Stop/Retry/Reply items use — #2030's inventory),
            // same delegate-property wiring pattern as GetQueueItems just above.
            LeftSidebar.RequestDispatchBuild = item => BuildQueuePanel.QuickDispatchAsync(item);
            LeftSidebar.RequestCancelOrStopBuild = item => BuildQueuePanel.QuickCancelOrStopAsync(item);
            LeftSidebar.RequestRetryBuild = item => BuildQueuePanel.QuickRetryAsync(item);
            LeftSidebar.RequestReplyToBuild = (item, message) => BuildQueuePanel.QuickReplyAsync(item, message);
            LeftSidebar.RequestOpenBuildChat = item => BuildQueuePanel.QuickOpenChat(item);

            // Git #840 — clicking an issue now opens (or focuses) the native
            // GitDetailView document tab — the same tab GitDetailTabRequested
            // opens — so there is one source of truth for issue details.
            // The bottom-panel IssueDetailView is no longer driven by issue
            // clicks, eliminating the out-of-sync / duplicate fetch problem.
            LeftSidebar.IssueSelected += (s, issue) =>
            {
                var cached = LeftSidebar.BuildDetailIssue(issue.IssueNumber);
                if (cached != null)
                    OpenGitIssueDetailTab(cached);
                else
                    _ = OpenGitDetailByNumberAsync(issue.IssueNumber);
            };

            // Git #921 (Epic #803) — milestone and epic clicks open document tabs.
            LeftSidebar.MilestoneTabRequested += (s, m) => OpenMilestoneDetailTab(m);
            LeftSidebar.GitDetailTabRequested += (s, issue) => OpenGitIssueDetailTab(issue);

            // Git #954 (Epic #803) — the sidebar's Settings view is a category nav
            // list now; a click opens (or focuses) the native Settings tab scrolled
            // to that section (same opens-or-focuses infra as the #921 detail tabs).
            LeftSidebar.SettingsCategoryRequested += (s, category) => OpenSettingsTab(category);
            LeftSidebar.GraphApiSelected += (s, args) => OpenGraphApiTab(args);
            _buildTailTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _buildTailTimer.Tick += async (_, _) => await PollChatTabBuildStateAsync();
            _buildTailTimer.Start();

            // Git #874 Home screen — capture the persisted open-chat-tabs snapshot
            // ONCE at launch (before this session opens/persists anything over it),
            // pre-load the Replit Workspace tab so it stays alive in memory,
            // open the native Home tab as the default first focused tab, and start the
            // roll-up timer. RefreshHomeRollupAsync no-ops whenever the Home tab
            // isn't open, so there's no steady-state polling cost when it's closed.
            _chatTabsAtLaunch = BuildConsole.Services.BuildConsoleSettings.Load().OpenChatTabs ?? new();
            // Git #1887 — kick off background reopening of every persisted tab NOW, as early
            // in the loading window as possible, so real WebView2 navigation overlaps with
            // the rest of deferred startup below rather than starting only once Shane clicks
            // a tab later. Fire-and-forget on purpose (see ReopenPersistedChatTabsInBackgroundAsync's
            // own doc comment in MainWindow.ChatReopen.cs for why this must never be awaited
            // here / gate MarkShellReady). Same AppMode.IsAgent gate as the usage meter /
            // Replit watcher just below — an agent-launched build session shouldn't spin up
            // real claude.ai page loads any more than it should poll usage or wake Replit.
            if (!BuildConsole.Services.AppMode.IsAgent)
            {
                _ = ReopenPersistedChatTabsInBackgroundAsync();
            }
            // Git #1637 — this used to unconditionally pre-open a VISIBLE "Replit
            // Workspace" tab on every launch (OpenOrFocusReplitWorkspaceTabInternal
            // calls OpenWebTab, which creates a real tab and selects it), briefly
            // flashing it before OpenHomeTab() below re-focused Home. The comment
            // here used to claim this was just pre-warming Replit "in memory," but
            // that's already handled invisibly by _replitWatcher's own hidden
            // ReplitWatcherWebView (Git #902, initialized above ~444) through the
            // same shared WebView2 environment — the visible tab was redundant.
            // Replit now only opens a real tab on genuine user action (ActivityBar
            // button, Home's Replit tile, etc.).
            // #1882 — yield first so the overlay animation keeps ticking across the Home
            // tab build (its board render + What's-New) instead of the UI thread pausing.
            await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);
            OpenHomeTab();
            // "What's New" patch notes — compute the real commit titles since the last
            // launch off the UI thread, then render into the (already-open) Home tab and
            // advance LastSeenBuild so this set won't re-show next launch. Fire-and-forget:
            // OpenHomeTab already painted the rest of the page; this fills in the top
            // section when git returns.
            _ = InitWhatsNewAsync();
            _homeRollupTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _homeRollupTimer.Tick += async (_, _) => await RefreshHomeRollupAsync();
            _homeRollupTimer.Start();

            // Git #805 (Epic #803 Phase 1) / #1421 — "polling, not webhook/SSE...
            // follow the existing pattern." Same 3s DispatcherTimer shape as
            // _buildTailTimer above. #1421 replaced the original HTTP GET
            // /api/internal/deploy-status hit with a direct local git read
            // (LocalDeployStatusService) so this no longer needs the local Dev
            // api-server running at all. A changed commitHash from the last-seen
            // value IS the "deploy complete" signal - no separate push mechanism needed.
            _deployStatusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _deployStatusTimer.Tick += async (_, _) => await PollDeployStatusAsync();
            _deployStatusTimer.Start();

            // Git #1417 — local PostgreSQL Windows-service status: an always-visible
            // status-bar segment (same dot+text convention as Deploy/Replit above),
            // polled independently of SystemHealthService's DB-pipe check since that
            // one goes red whenever the api-server itself is down too. 15s cadence —
            // a Windows service query is cheap, but no need to hammer it every tick.
            _postgresStatusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            _postgresStatusTimer.Tick += async (_, _) => await RefreshPostgresStatusAsync();

            // Git #1886 — PersistOpenChatTabs() is already called on every KNOWN discrete
            // tab-state change (open ~2865, rename ~4314, mark-in-progress ~4403, drag
            // ~7244, dock ~7288), but a crash between one of those events and the next
            // still loses whatever changed in between (a still-open call site that itself
            // doesn't persist, e.g. tab reorder, or a future change site that forgets to
            // call it). Chose a periodic safety-net sweep over a per-change debounce
            // timer: _chatTabs is mutated from many scattered locations across this file,
            // and a periodic sweep bounds the crash-loss window to a fixed interval for
            // ALL of them without requiring every current and future mutation site to
            // remember to call PersistOpenChatTabs() itself. The method is already cheap
            // (small in-memory snapshot + JSON save) and already no-ops safely via its own
            // try/catch, so an unconditional 15s tick is simpler and more robust than
            // tracking a dirty flag across every mutation path.
            _persistTabsTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            _persistTabsTimer.Tick += (_, _) => PersistOpenChatTabs();
            _persistTabsTimer.Start();
            _postgresStatusTimer.Start();
            _ = RefreshPostgresStatusAsync();

            // Version status bar + auto-Update button (see MainWindow.VersionUpdate.cs):
            // live "Current: v{Major}.{Minor}.{build}" vs the build THIS instance was
            // compiled from, with a queue-gated deploy when the running copy is behind.
            InitializeVersionUpdate();

            // Focus Mode (active-milestone global filter + downtime quick-tasks +
            // context save/restore + game layer). All logic lives in FocusModeService
            // and MainWindow.FocusMode.cs — this is the single shell-side entry point.
            // #1882 — one more yield so the overlay breathes before Focus Mode wires in.
            await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);
            InitFocusMode();

            // Git #1934 safety net: if a PRIOR (pre-#1934) blocking build persisted Queue
            // clicks to the spillover file while a version Update was pending, drain and
            // re-queue them now that the Build Tracker client + panels are initialized (see
            // MainWindow.PendingUpdateQueue.cs — the write side is retired; this is the one
            // remaining transitional reader). A cheap no-op once no leftover file exists.
            // Fire-and-forget — never blocks launch.
            _ = ReplayPersistedQueueRequestsOnLaunchAsync();

            // Shane To-Do "Load SQL" -> real GitHub file content into the SQL Runner tab (index 2 in BottomTabs — Build Log, Terminal, SQL Runner, Output).
            LeftSidebar.SqlLoadRequested += (s, path) =>
            {
                var sqlDoc = OpenSqlRunnerTab();
                sqlDoc.LoadFromGitHub(path);
            };

            // "Assign Chat to Epic..." just linked a chat to an epic — if that
            // chat already has an open tab, its TabItem.Tag (a BoardChat
            // SNAPSHOT taken when the tab was opened) never picks up the new
            // EpicId on its own; EditorTabs_SelectionChanged only re-reads the
            // Tag on a TAB SWITCH, so the Build Queue "Issues in Epic" section
            // was stuck stale/hidden until a full app restart rebuilt every
            // tab from a fresh board fetch. Patch the open tab's Tag in place
            // and, if it's the one currently on screen, re-feed the panel now.
            LeftSidebar.ChatEpicAssigned += (s, e) =>
            {
                foreach (var kvp in _chatTabs)
                {
                    if (kvp.Key.Tag is BuildConsole.Services.BoardChat chat && chat.ConversationId == e.ConversationId)
                    {
                        chat.EpicId = e.EpicId;
                        if (EditorTabs.SelectedItem == kvp.Key)
                        {
                            var assignedEpicGithubNumber = LeftSidebar.GetEpicGithubNumber(e.EpicId);
                            BuildQueuePanel.SetActiveChatEpic(
                                e.EpicId,
                                assignedEpicGithubNumber,
                                LeftSidebar.GetEpicTitle(e.EpicId),
                                force: true);
                            LeftSidebar.SetActiveEpicGithubNumber(assignedEpicGithubNumber);
                        }
                        break;
                    }
                }
            };

            // Git #806 (Epic #803 Phase 2) — tracks the manifest last loaded via the
            // Automation sidebar's Load Manifest button for Menu > Run > "Run Tests (Current Issue)".
            LeftSidebar.ManifestLoaded += (s, manifest) => _loadedManifest = manifest;

            // Manifest steps flyout's "History" button — opens Test History filtered to
            // just that manifest's own run history (discoverability fix: TestHistoryWindow
            // otherwise has no per-manifest entry point).
            LeftSidebar.ManifestHistoryRequested += (s, issue) => EnsureTestHistoryWindow(issue);

            // Git #827 — LeftSidebar's Automation sidebar raises these three events, and
            // MainWindow already had correct handlers for all of them, but none were ever
            // subscribed: the Play button (and Start/Stop Recording) did nothing.
            LeftSidebar.PlayTestRequested += LeftSidebar_PlayTestRequested;
            LeftSidebar.DeployToStagingRequested += LeftSidebar_DeployToStagingRequested;
            LeftSidebar.StartRecordingRequested += LeftSidebar_StartRecordingRequested;
            LeftSidebar.StopRecordingRequested += LeftSidebar_StopRecordingRequested;

            // ActivityBar quick navigation
            ActivityBar.QuickNavRequested += ActivityBar_QuickNavRequested;

            // Git #864 — Web Tools popout entry clicked
            ActivityBar.WebToolRequested += ActivityBar_WebToolRequested;

            // Git #937 — Sticky Notes floaty toggle + active-pane focus tracking.
            ActivityBar.StickyNotesToggleRequested += (s, e) => ToggleStickyNotes();
            // Git #973 — LinkedIn post pre-fill floaty toggle (see MainWindow.LinkedInComposer.cs).
            ActivityBar.LinkedInComposerToggleRequested += (s, e) => ToggleLinkedInComposer();
            // Git #980 — floaty 8-slot Build Watch window toggle.
            ActivityBar.BuildWatchToggleRequested += (s, e) => ToggleBuildWatch();
            // Git #1472 — floaty Visual Test Tracker window toggle.
            ActivityBar.VisualTestTrackerToggleRequested += (s, e) => ToggleVisualTestTracker();
            // Git #2110 — floaty live Build Queue Map window toggle.
            ActivityBar.BuildChainMapRequested += (s, e) => OpenBuildChainMap();
            _activeEditorPane = EditorTabs;
            // Clicking into any pane's WebView2 to type moves WPF keyboard focus
            // there without changing tab selection — walk up from the newly
            // focused element to whichever of the four panes contains it, so
            // Send knows which pane Shane is actually working in.
            PreviewGotKeyboardFocus += (s, e) => UpdateActivePaneFromFocus(e.NewFocus as DependencyObject);

            // LeftSidebar file clicks -> Open Viewer tabs
            LeftSidebar.FileSelected += LeftSidebar_FileSelected;

            // Panel Pin / Unpin handlers
            LeftSidebar.PinToggled += (s, isPinned) =>
            {
                ColSidebar.Width = isPinned ? new GridLength(260) : new GridLength(0);
                SidebarSplitter.Visibility = isPinned ? Visibility.Visible : Visibility.Collapsed;
            };

            BuildQueuePanel.PinToggled += (s, isPinned) =>
            {
                ColQueue.Width = isPinned ? new GridLength(300) : new GridLength(0);
            };

            if (EditorTabs.Items.Count > 0 && EditorTabs.Items[0] is TabItem claudeTab)
            {
                AttachTabContextMenu(claudeTab, EditorTabs);
                AttachTabDragHandlers(claudeTab);
            }

            UpdateZoomDisplay();

                // #1882 — everything above is the real startup work. The overlay's network
                // probes were kicked off earlier (right after their services were built);
                // here, in the finally, we signal shell-ready so AllSettled can complete and
                // the overlay fades out — meaning the app is genuinely ready to use.
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("startup", $"deferred startup failed: {ex.Message}");
                BuildConsole.Services.ActivityLog.Log("startup", ex.ToString());
            }
            finally
            {
                // Always mark ready — even on a partial/failed init the overlay must never
                // hang. The service's own global cap is a further backstop.
                _startupConnectivity?.MarkShellReady();
            }
        }

        /// <summary>
        /// Git #1864 — Shane: "you can make the search box not so tall while you are at
        /// it... so it fits properly." SearchBorder previously sized itself off the
        /// TextBox's default height + Padding="8,3", which stood taller than the 36px
        /// caption bar comfortably holds. Reads the window's REAL
        /// WindowChrome.CaptionHeight (set in XAML, already resolvable right after
        /// InitializeComponent — WindowChrome is an attached property applied during
        /// XAML parse, not layout) rather than guessing a pixel value, so the box always
        /// fits the caption bar cleanly even if that height is ever retuned. Leaves 8px
        /// of clearance (4 above, 4 below) inside the bar; XAML's Padding="8,0" plus each
        /// child's own VerticalAlignment="Center" (glyph, placeholder, TextBox via
        /// VerticalContentAlignment, Ctrl+K hint) does the rest — nothing clips at any of
        /// SearchBorder's Width/MinWidth/MaxWidth (240/180/820).
        /// </summary>
        private void SizeSearchBoxToCaptionHeight()
        {
            double captionHeight = System.Windows.Shell.WindowChrome.GetWindowChrome(this)?.CaptionHeight ?? 36;
            SearchBorder.Height = Math.Max(24, captionHeight - 8);
        }

        /// <summary>
        /// Git #1864 — refreshes the title-bar usage readout from
        /// UsageTrackingService.GetSnapshot(). Session figures are the headline (compact
        /// enough for the caption bar); all-time sits in the tooltip. The dollar figure is
        /// labeled an estimate — builds run against two Claude Max 20x subscriptions, so
        /// the CLI's own total_cost_usd is a notional API-equivalent price, not money
        /// actually spent.
        /// </summary>
        private void UpdateUsageReadout()
        {
            var snap = BuildConsole.Services.UsageTrackingService.GetSnapshot();

            UsageReadoutText.Text =
                $"{BuildConsole.Services.UsageFormat.FormatTokens(snap.SessionTokens)} · ~${snap.SessionCostUsd:0.00} est.";

            UsageReadoutTooltipText.Text =
                $"This session: {BuildConsole.Services.UsageFormat.FormatTokens(snap.SessionTokens)} · ~${snap.SessionCostUsd:0.00} est. " +
                $"({snap.SessionBuilds} build{(snap.SessionBuilds == 1 ? "" : "s")})\n" +
                $"All-time: {BuildConsole.Services.UsageFormat.FormatTokens(snap.TotalTokens)} · ~${snap.TotalCostUsd:0.00} est. " +
                $"({snap.TotalBuilds} build{(snap.TotalBuilds == 1 ? "" : "s")})\n" +
                "Estimate only — notional API-equivalent price from the CLI's own usage, not actual spend " +
                "(builds run on Claude Max subscriptions).";

            // Git #2001 — the readout is collapsed by default; this only gates visibility,
            // never the tracking/formatting above. UsageTrackingService keeps recording and this
            // method keeps refreshing the (possibly hidden) text so it's current the instant
            // the Settings toggle brings it back — see RefreshUsageReadoutVisibility.
            RefreshUsageReadoutVisibility();
        }

        /// <summary>Git #2001 — applies the current <c>ShowUsageReadout</c> setting to the
        /// title-bar control's visibility (Collapsed, not Hidden, to actually reclaim the width).
        /// Called after every UpdateUsageReadout refresh, and live from the Settings tab toggle
        /// so the change takes effect immediately without a restart.</summary>
        public void RefreshUsageReadoutVisibility()
        {
            UsageReadoutBorder.Visibility =
                BuildConsole.Services.BuildConsoleSettings.Load().ShowUsageReadout
                    ? Visibility.Visible
                    : Visibility.Collapsed;
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Services.WindowChromeHelper.Setup(this);
            RegisterScreenClipHotkey();
        }

        // ── Git #1866 — desktop screen-clipping tool ──────────────────────────────
        // Title-bar icon + PrintScreen. Two key paths, both needed:
        //   Global: RegisterHotKey(VK_SNAPSHOT) via an HwndSource hook, so PrtScn fires even
        //           when BuildConsole isn't focused. Windows 11's "Use the Print screen key
        //           to open Snipping Tool" claims the key first — RegisterHotKey then returns
        //           false; we log it, toast once, and put the reason in the button tooltip.
        //   In-app: WPF doesn't reliably raise KeyDown for PrtScn (only key-up), so
        //           Window_PreviewKeyUp also handles Key.Snapshot — this covers the focused
        //           case even when the global registration was refused.
        private const int WM_HOTKEY = 0x0312;
        private const int VK_SNAPSHOT = 0x2C;
        private const int SCREEN_CLIP_HOTKEY_ID = 0xB1A6; // arbitrary, app-unique
        private bool _screenClipHotkeyRegistered;
        private HwndSource? _screenClipHwndSource;

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private void RegisterScreenClipHotkey()
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.ScreenClipGlobalHotkeyEnabled)
            {
                ActivityLog.Log(DesktopScreenClipService.Channel,
                    "Screen clip global PrintScreen hotkey disabled in settings — using in-app key-up only.");
                BtnScreenClip.ToolTip = "Screen clip — drag a region to the clipboard and disk. Global PrintScreen is disabled in settings; PrtScn works only when BuildConsole is focused.";
                return;
            }

            var helper = new WindowInteropHelper(this);
            _screenClipHwndSource = HwndSource.FromHwnd(helper.Handle);
            _screenClipHwndSource?.AddHook(ScreenClipWndProc);

            // fsModifiers=0: bare PrintScreen, no modifier.
            _screenClipHotkeyRegistered = RegisterHotKey(helper.Handle, SCREEN_CLIP_HOTKEY_ID, 0, VK_SNAPSHOT);
            if (_screenClipHotkeyRegistered)
            {
                ActivityLog.Log(DesktopScreenClipService.Channel, "Screen clip global PrintScreen hotkey registered.");
                BtnScreenClip.ToolTip = "Screen clip (PrintScreen) — drag a region to the clipboard and disk";
            }
            else
            {
                // Almost always: Windows 11 Snipping Tool already owns PrtScn.
                ActivityLog.Log(DesktopScreenClipService.Channel,
                    "Screen clip global PrintScreen hotkey registration REFUSED (RegisterHotKey returned false) — likely Windows Snipping Tool owns the key. In-app key-up still works when BuildConsole is focused.");
                ToastEngine.Warning("PrintScreen already claimed",
                    "Windows (Snipping Tool) already owns the Print Screen key, so BuildConsole couldn't register it globally. PrtScn still works when BuildConsole is focused; the title-bar icon always works. Turn off \"Use the Print screen key to open Snipping Tool\" in Windows Settings to free it.");
                BtnScreenClip.ToolTip = "Screen clip — drag a region to the clipboard and disk. Global PrintScreen is claimed by Windows Snipping Tool; PrtScn works only when BuildConsole is focused (or free the key in Windows Settings).";
            }
        }

        private IntPtr ScreenClipWndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == WM_HOTKEY && wParam.ToInt32() == SCREEN_CLIP_HOTKEY_ID)
            {
                handled = true;
                DesktopScreenClipService.Capture();
            }
            return IntPtr.Zero;
        }

        private void ScreenClip_Click(object sender, RoutedEventArgs e) => DesktopScreenClipService.Capture();

        protected override void OnClosed(EventArgs e)
        {
            // Git #1866 — release the global PrintScreen hotkey and detach the message hook.
            try
            {
                if (_screenClipHotkeyRegistered)
                {
                    UnregisterHotKey(new WindowInteropHelper(this).Handle, SCREEN_CLIP_HOTKEY_ID);
                    _screenClipHotkeyRegistered = false;
                }
                _screenClipHwndSource?.RemoveHook(ScreenClipWndProc);
            }
            catch { /* best-effort teardown on shutdown */ }

            // Git #1792 — strip the kill-on-close limit from every still-running build's Job Object and
            // release the handles WITHOUT killing the members, so closing BuildConsole never terminates
            // in-progress builds. The #1804 durable-file redirect already lets a build survive the app
            // closing; the per-build Job Object must not undo that (it's scoped to each build's OWN
            // completion, not the app's lifetime). Verified requirement, not assumed.
            try { _queueWatcher?.DetachAllJobsForShutdown(); }
            catch { /* best-effort — a failure here must never block app shutdown */ }

            base.OnClosed(e);
        }

        // ── Git #894: custom title bar caption buttons ──────────────────────────
        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        /// <summary>Git #894 — keeps the maximize/restore button's glyph and tooltip in sync with the real WindowState, including when it changes some OTHER way (double-click the title bar, Aero-snap drag-to-top, Win+Up).</summary>
        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "" : ""; // ChromeRestore / ChromeMaximize
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }

        // ── Window Preview Key Handlers for Ctrl+K and Ctrl+Tab ─────────────────
        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            SailorDuckLayer?.NotifyUserActivity();

            // Ctrl+N: New Chat
            if (e.Key == Key.N && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                MenuNewChat_Click(sender, null!);
                return;
            }

            // Ctrl+Shift+D: Summon Donald the Sailor Duck Mascot
            if (e.Key == Key.D && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control && (Keyboard.Modifiers & ModifierKeys.Shift) == ModifierKeys.Shift)
            {
                e.Handled = true;
                SailorDuckLayer?.SummonMascot();
                ToastEngine.Success("Sailor Duck Mascot", "Quack! Ahoy Captain Shane! ⚓ (Ctrl+Shift+D)");
                return;
            }

            if (e.Key == Key.K && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                ToggleCommandPalette();
            }
            else if (e.Key == Key.Tab && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                bool isReverse = (Keyboard.Modifiers & ModifierKeys.Shift) == ModifierKeys.Shift;
                ShowTabSwitcher(isReverse);
            }
            else if (CommandPaletteOverlay.Visibility == Visibility.Visible)
            {
                if (e.Key == Key.Escape)
                {
                    e.Handled = true;
                    HideCommandPalette();
                }
            }
            else if (TabSwitcherOverlay.Visibility == Visibility.Visible)
            {
                if (e.Key == Key.Escape)
                {
                    e.Handled = true;
                    HideTabSwitcher(confirmSelection: false);
                }
                else if (e.Key == Key.Return)
                {
                    e.Handled = true;
                    HideTabSwitcher(confirmSelection: true);
                }
                else if (e.Key == Key.Down)
                {
                    e.Handled = true;
                    CycleTabSwitcher(forward: true);
                }
                else if (e.Key == Key.Up)
                {
                    e.Handled = true;
                    CycleTabSwitcher(forward: false);
                }
            }
        }

        private void Window_PreviewKeyUp(object sender, KeyEventArgs e)
        {
            if (TabSwitcherOverlay.Visibility == Visibility.Visible)
            {
                if (e.Key == Key.LeftCtrl || e.Key == Key.RightCtrl)
                {
                    HideTabSwitcher(confirmSelection: true);
                }
            }

            // Git #1866 — PrtScn while BuildConsole is focused. WPF only surfaces PrintScreen on
            // key-up, so we handle it here (not KeyDown). Guard against double-firing: when the
            // GLOBAL hotkey is registered it consumes the key before it reaches this window, so we
            // only act on the in-app path when the global registration was refused. (The service's
            // own _overlayOpen guard is a second backstop.)
            if (e.Key == Key.Snapshot && !_screenClipHotkeyRegistered)
            {
                e.Handled = true;
                DesktopScreenClipService.Capture();
            }
        }

        private void ShowTabSwitcher(bool isReverse = false)
        {
            var cards = new System.Collections.Generic.List<TabSwitcherCard>();
            int count = EditorTabs.Items.Count;
            if (count == 0) return;

            for (int i = 0; i < count; i++)
            {
                if (EditorTabs.Items[i] is TabItem item)
                {
                    string url = item.Tag?.ToString() ?? string.Empty;
                    string title = ExtractTabTitle(item);
                    string glyph = ExtractTabGlyph(url);

                    cards.Add(new TabSwitcherCard
                    {
                        Title = title,
                        Url = url,
                        Glyph = glyph,
                        IndexTag = $"Ctrl+{(i + 1) % 10}",
                        TabIndex = i
                    });
                }
            }

            TabSwitcherList.ItemsSource = cards;
            TabSwitcherCountText.Text = $"{count} document{(count == 1 ? "" : "s")}";

            int currentIdx = Math.Max(0, EditorTabs.SelectedIndex);
            int nextIdx = (currentIdx + (isReverse ? -1 : 1) + count) % count;

            // Hide active WebView2 HWND to fix WPF Airspace overlap
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Hidden;

            Services.UiFadeHelper.FadeIn(TabSwitcherOverlay);
            TabSwitcherList.SelectedIndex = nextIdx;

            if (TabSwitcherList.SelectedItem != null)
                TabSwitcherList.ScrollIntoView(TabSwitcherList.SelectedItem);

            // Transfer keyboard focus from WebView2 native HWND to WPF ListBox
            Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
            {
                TabSwitcherList.Focus();
                Keyboard.Focus(TabSwitcherList);
            }));
        }

        private void CycleTabSwitcher(bool forward)
        {
            int count = TabSwitcherList.Items.Count;
            if (count == 0) return;

            int newIdx = (TabSwitcherList.SelectedIndex + (forward ? 1 : -1) + count) % count;
            TabSwitcherList.SelectedIndex = newIdx;
            if (TabSwitcherList.SelectedItem != null)
                TabSwitcherList.ScrollIntoView(TabSwitcherList.SelectedItem);
        }

        private void HideTabSwitcher(bool confirmSelection)
        {
            if (confirmSelection && TabSwitcherList.SelectedItem is TabSwitcherCard card)
            {
                EditorTabs.SelectedIndex = card.TabIndex;
            }

            Services.UiFadeHelper.FadeOut(TabSwitcherOverlay);

            // Restore active WebView2 HWND visibility
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Visible;

            // Return focus to active WebView2
            Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(() =>
            {
                GetActiveWebView()?.Focus();
            }));
        }

        private void OpenTabSwitcher_Click(object sender, RoutedEventArgs e)
        {
            ShowTabSwitcher(isReverse: false);
        }

        private void TabSwitcherOverlay_MouseDown(object sender, MouseButtonEventArgs e)
        {
            HideTabSwitcher(confirmSelection: false);
        }

        private void TabSwitcherCard_MouseDown(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            HideTabSwitcher(confirmSelection: true);
        }

        // Git #1802 — Shane: a chat tab's title already carries a real issue
        // number (`[#1202] Some title`, `#1202 some title`, or a bare `#1212`)
        // whether or not the tab is a tracked BoardChat yet. Parse it out of
        // the real displayed title text so the Working-epic highlight can
        // resolve WITHOUT requiring manual assignment first.
        // Git #2545 — Shane clicked "Hand Off Now" on a real tab titled literally
        // `1202 Build Console` (confirmed as a live bt_chats row) and got "Cannot hand
        // off: chat has no associated epic." That title is a bare leading issue number
        // with NO `#` and NO brackets — a manually-renamed chat (the rename dialog at
        // LeftSidebar accepts free text, so a title that predates or sidesteps the `[#N]`
        // convention is genuinely out there). The original two branches BOTH required a
        // `#`, so a bare `1202` could never match and every handoff-number fallback fell
        // through. Add a third anchored alternative for a bare leading number — still
        // anchored to the start and still requiring a real word boundary after the digits,
        // so it only fires on a title that genuinely LEADS with a standalone number token
        // (not "v1.1 launch" or "10x ideas"). This also lets the #1802/#1905 Working-epic
        // board highlight resolve such a tab, which it likewise couldn't before.
        private static readonly Regex TabTitleIssueNumberRegex = new(@"^\s*(?:\[#(\d+)\]|#(\d+)(?=\s|$)|(\d+)(?=\s|$))", RegexOptions.Compiled);

        // Git #2545 — final last resort, looser than the anchored regex above: a real issue
        // number that isn't at the very START of a (manually-renamed) title, e.g.
        // "Handoff for #1202" or "Build Console 1202". Scans the whole title for the first
        // #?<digits> token that sits on a real boundary (not embedded in a word or a
        // dotted version like 1.1), so "Hand Off Now" can never fall through to "no
        // associated epic" on a tab whose title visibly contains an issue number. Used
        // ONLY where a false guess is recoverable (the handoff toast shows the number) —
        // never as the primary board-highlight resolver.
        private static readonly Regex AnyTitleIssueNumberRegex = new(@"(?<![\w.])#?(\d+)(?=\s|$|\])", RegexOptions.Compiled);

        private static int? ExtractTabTitleIssueNumber(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return null;
            var match = TabTitleIssueNumberRegex.Match(title);
            if (!match.Success) return null;
            var group = match.Groups[1].Success ? match.Groups[1]
                      : match.Groups[2].Success ? match.Groups[2]
                      : match.Groups[3];
            return int.TryParse(group.Value, out var number) && number > 0 ? number : null;
        }

        // Git #2545 — see AnyTitleIssueNumberRegex. Deliberately separate from
        // ExtractTabTitleIssueNumber so the loose whole-title scan is confined to the
        // handoff last-resort and can't silently loosen the board-highlight resolvers.
        private static int? ExtractAnyTitleIssueNumber(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return null;
            var match = AnyTitleIssueNumberRegex.Match(title);
            if (!match.Success) return null;
            return int.TryParse(match.Groups[1].Value, out var number) && number > 0 ? number : null;
        }

        private static string ExtractTabTitle(TabItem tab)
        {
            if (tab.Header is StackPanel sp)
            {
                foreach (var child in sp.Children)
                {
                    if (child is TextBlock tb)
                    {
                        if (tb.FontFamily != null && tb.FontFamily.Source.Contains("Segoe MDL2", StringComparison.OrdinalIgnoreCase))
                            continue;

                        if (!string.IsNullOrWhiteSpace(tb.Text) && tb.Text != "✕")
                            return tb.Text;
                    }
                }
            }
            return tab.Header?.ToString() ?? "Document";
        }

        private static string ExtractTabGlyph(string url)
        {
            return url switch
            {
                var u when u.Contains("5174") || u.Contains("/admin-panel/") => "\uE7EF",
                var u when u.Contains("5175") || u.Contains("/portal/")      => "\uE77B",
                var u when u.Contains("claude.ai")                           => "\uE8BD",
                _                                                            => "\uE774"
            };
        }

        private Microsoft.Web.WebView2.Wpf.WebView2 GetActiveWebView()
        {
            if (EditorTabs.SelectedItem is TabItem ti)
            {
                if (ti.Content is Microsoft.Web.WebView2.Wpf.WebView2 wvDirect)
                    return wvDirect;

                if (ti.Content is Panel panel)
                {
                    foreach (var child in panel.Children)
                    {
                        if (child is Microsoft.Web.WebView2.Wpf.WebView2 wvChild)
                            return wvChild;
                    }
                }
            }
            return ClaudeWebView;
        }

        // ── Git #937: Sticky Notes floaty — toggle, active-pane resolution, Send ──

        private bool IsEditorPane(TabControl tc) =>
            tc == EditorTabs || tc == EditorTabs2 || tc == EditorTabs3 || tc == EditorTabs4;

        /// <summary>Git #937 — keyboard focus just entered some element; if it's inside one of the four editor panes (#893), mark that pane active so Send targets the right one.</summary>
        private void UpdateActivePaneFromFocus(DependencyObject? focused)
        {
            while (focused != null)
            {
                if (focused is TabControl tc && IsEditorPane(tc))
                {
                    _activeEditorPane = tc;
                    return;
                }
                DependencyObject? parent = null;
                if (focused is Visual || focused is System.Windows.Media.Media3D.Visual3D)
                    parent = VisualTreeHelper.GetParent(focused);
                focused = parent ?? LogicalTreeHelper.GetParent(focused);
            }
        }

        private static Microsoft.Web.WebView2.Wpf.WebView2? FindWebView2Recursive(DependencyObject parent)
        {
            if (parent is Microsoft.Web.WebView2.Wpf.WebView2 wv) return wv;
            int childCount = VisualTreeHelper.GetChildrenCount(parent);
            for (int i = 0; i < childCount; i++)
            {
                var child = VisualTreeHelper.GetChild(parent, i);
                var found = FindWebView2Recursive(child);
                if (found != null) return found;
            }
            return null;
        }

        private static Microsoft.Web.WebView2.Wpf.WebView2? WebViewOf(TabItem ti)
        {
            if (ti.Content is DependencyObject depObj)
            {
                return FindWebView2Recursive(depObj);
            }
            return null;
        }

        /// <summary>Git #937 — the WebView2 (and its TabItem) of the currently active pane's selected tab, across all four #893 panes. Falls back to the primary pane if the tracked one was collapsed by a layout change.</summary>
        private (Microsoft.Web.WebView2.Wpf.WebView2? Wv, TabItem? Tab) GetActiveEditorTabWebView()
        {
            var pane = _activeEditorPane;
            if (pane == null || pane.Visibility != Visibility.Visible)
                pane = EditorTabs;
            if (pane.SelectedItem is TabItem ti)
                return (WebViewOf(ti), ti);
            return (null, null);
        }

        /// <summary>Git #937 — opens the always-on-top Sticky Notes floaty, or closes it if already open.</summary>
        private void ToggleStickyNotes()
        {
            if (_stickyNotes != null)
            {
                _stickyNotes.Close(); // Closed handler nulls the ref and logs "close"
                return;
            }

            _stickyNotes = new StickyNotesWindow { Owner = this };
            _stickyNotes.SendRequested += StickyNotes_SendRequested;
            _stickyNotes.Closed += (s, e) =>
            {
                _stickyNotes = null;
                BuildConsole.Services.ActivityLog.Log("sticky-notes", "close");
            };
            _stickyNotes.Show();
            BuildConsole.Services.ActivityLog.Log("sticky-notes", "open");
        }

        /// <summary>
        /// Git #980 — toggles the floaty 8-slot Build Watch window. Same
        /// open-or-close-on-toggle + Owner=this lifecycle as the Sticky Notes
        /// (#937) and LinkedIn (#973) floaties, so it closes cleanly with the app
        /// and never orphans. Passes the shared build-tracker API client so the
        /// window can watch the same queue every other panel reads.
        /// </summary>
        private void ToggleBuildWatch()
        {
            if (_buildWatch != null)
            {
                _buildWatch.Close(); // Closed handler nulls the ref and logs "close"
                return;
            }

            _buildWatch = new BuildWatchWindow(_buildTrackerApi, _queueWatcher, _queueDb) { Owner = this };
            _buildWatch.Closed += (s, e) =>
            {
                _buildWatch = null;
                BuildConsole.Services.ActivityLog.Log("build-watch", "close");
            };
            _buildWatch.Show();
            BuildConsole.Services.ActivityLog.Log("build-watch", "open");
        }

        /// <summary>
        /// Git #2483 — opens the maximized Build Chain Map window (replaces the old #2110
        /// "Build Queue Map" toggle in this toolbar slot — that window/handler audited and
        /// confirmed genuinely functional, but Shane's call in #2473/#2483 is to retire it
        /// in favor of this richer Epic → Feature → Issue → blocked_by editor). Unlike the
        /// old floaty, this is a single maximized top-level window scoped to one Epic — if
        /// one is already open it's brought to front rather than opening a second, and if
        /// none is open we default to whatever Epic Git Board currently has marked
        /// "WORKING", falling back to a quick prompt when nothing is active.
        /// </summary>
        private void OpenBuildChainMap()
        {
            if (_buildChainMap != null)
            {
                if (_buildChainMap.WindowState == WindowState.Minimized) _buildChainMap.WindowState = WindowState.Maximized;
                _buildChainMap.Activate();
                return;
            }

            int? epicNumber = LeftSidebar.ActiveEpicGithubNumber ?? PromptForEpicNumber();
            if (epicNumber == null) return; // Shane cancelled the prompt

            _buildChainMap = new BuildChainMapWindow(epicNumber.Value) { Owner = this, WindowState = WindowState.Maximized };
            _buildChainMap.Closed += (s, e) =>
            {
                _buildChainMap = null;
                BuildConsole.Services.ActivityLog.Log("build-chain-map", "close");
            };
            _buildChainMap.Show();
            BuildConsole.Services.ActivityLog.Log("build-chain-map", $"open epic=#{epicNumber.Value}");
        }

        /// <summary>Git #2483 — minimal inline prompt for the Epic number when Build Chain Map
        /// is opened with no "WORKING" Epic active in Git Board. No dedicated XAML file — just
        /// a label, a numeric TextBox, and OK/Cancel, matching this app's other small ad-hoc dialogs.</summary>
        private int? PromptForEpicNumber()
        {
            var dlg = new Window
            {
                Title = "Build Chain Map — which Epic?",
                Width = 360,
                Height = 150,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                ResizeMode = ResizeMode.NoResize,
                Background = System.Windows.Media.Brushes.White
            };

            var stack = new StackPanel { Margin = new Thickness(16) };
            stack.Children.Add(new TextBlock { Text = "GitHub Epic issue number:", Margin = new Thickness(0, 0, 0, 8) });
            var input = new TextBox { Text = "", FontSize = 14 };
            stack.Children.Add(input);

            var buttonRow = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
            var ok = new Button { Content = "Open", Width = 80, Margin = new Thickness(0, 0, 8, 0), IsDefault = true };
            var cancel = new Button { Content = "Cancel", Width = 80, IsCancel = true };
            buttonRow.Children.Add(ok);
            buttonRow.Children.Add(cancel);
            stack.Children.Add(buttonRow);
            dlg.Content = stack;

            int? result = null;
            ok.Click += (s, e) =>
            {
                if (int.TryParse(input.Text.Trim().TrimStart('#'), out var n) && n > 0)
                {
                    result = n;
                    dlg.DialogResult = true;
                }
            };
            input.Focus();
            dlg.ShowDialog();
            return result;
        }

        /// <summary>
        /// Git #937 — Send clicked. Thin wrapper over the shared
        /// <see cref="SendTextToActiveClaudeChatAsync"/> path (also reused by the
        /// SQL Runner's "Send to Chat" in #940); reports inline through the Sticky
        /// Notes window and clears the note only on a confirmed insert.
        /// </summary>
        private async void StickyNotes_SendRequested(object? sender, string text)
        {
            var win = _stickyNotes;
            if (win == null) return;

            await SendTextToActiveClaudeChatAsync(
                text,
                showMessage: (msg, isError) => win.ShowInlineMessage(msg, isError),
                onInserted: () => win.ClearNoteText(),
                logChannel: "sticky-notes",
                whatSingular: "note");
        }

        /// <summary>Git #1472 — opens the always-on-top Visual Test Tracker floaty, or closes it if
        /// already open. A NEW standalone panel, separate from Sticky Notes (#937) — same
        /// open-or-close-on-toggle + Owner=this lifecycle as every other floaty.</summary>
        private void ToggleVisualTestTracker()
        {
            if (_visualTestTracker != null)
            {
                _visualTestTracker.Close(); // Closed handler nulls the ref and logs "close"
                return;
            }

            _visualTestTracker = new VisualTestTrackerWindow { Owner = this };
            _visualTestTracker.Closed += (s, e) =>
            {
                _visualTestTracker = null;
                BuildConsole.Services.ActivityLog.Log("visual-test-tracker", "close");
            };
            _visualTestTracker.Show();
            BuildConsole.Services.ActivityLog.Log("visual-test-tracker", "open");

            // Prime it with whatever tab is active right now, in case it's already sitting
            // on a watched URL (opening the tracker shouldn't require a fresh navigation).
            UpdateVisualTestTrackerForActiveTab();
        }

        /// <summary>Git #1472 — the watched base URLs the Visual Test Tracker checks navigation
        /// against (BuildConsoleSettings.VisualTestTrackerBaseUrls — configurable, not hardcoded to
        /// portal-v2). Returns the matching base URL (the configured entry, not the full nav URL) if
        /// <paramref name="url"/> contains one of them, else null.</summary>
        private static string? MatchesWatchedVisualTestBaseUrl(string? url)
        {
            if (string.IsNullOrEmpty(url)) return null;
            var bases = BuildConsole.Services.BuildConsoleSettings.Load().VisualTestTrackerBaseUrls;
            foreach (var b in bases)
            {
                if (string.IsNullOrWhiteSpace(b)) continue;
                int idx = url.IndexOf(b, StringComparison.OrdinalIgnoreCase);
                if (idx >= 0) return b;
            }
            return null;
        }

        /// <summary>Git #1472 — on every NavigationCompleted (any tab, any pane — see
        /// WebView_NavigationCompleted), checks whether the navigated tab matches a watched base URL and,
        /// if the Visual Test Tracker floaty is open, feeds it the (webView, baseUrl, pagePath). Filtered so
        /// it never fires for e.g. claude.ai chat tabs — only tabs whose URL actually contains one of the
        /// configured base URLs.</summary>
        private void UpdateVisualTestTrackerForNavigatedTab(Microsoft.Web.WebView2.Wpf.WebView2? webView)
        {
            if (_visualTestTracker == null || webView?.Source == null) return;

            string url = webView.Source.ToString();
            var matchedBase = MatchesWatchedVisualTestBaseUrl(url);
            if (matchedBase == null)
            {
                // Only clear if this navigation happened on the currently-active pane/tab — an
                // unwatched background tab navigating shouldn't blank out the tracker.
                var (activeWv, _) = GetActiveEditorTabWebView();
                if (ReferenceEquals(activeWv, webView))
                    _visualTestTracker.ClearActiveTab();
                return;
            }

            int baseIdx = url.IndexOf(matchedBase, StringComparison.OrdinalIgnoreCase);
            string pagePath = url.Substring(baseIdx + matchedBase.Length);
            if (string.IsNullOrEmpty(pagePath)) pagePath = "/";

            _visualTestTracker.OnTrackedNavigation(webView, matchedBase, pagePath);
        }

        /// <summary>Git #1472 — re-checks the CURRENTLY active tab (not tied to a fresh nav event) against
        /// the watched base URLs. Used when the tracker window is first opened, so it doesn't sit blank
        /// until the next navigation.</summary>
        private void UpdateVisualTestTrackerForActiveTab()
        {
            var (activeWv, _) = GetActiveEditorTabWebView();
            if (activeWv == null)
            {
                _visualTestTracker?.ClearActiveTab();
                return;
            }
            UpdateVisualTestTrackerForNavigatedTab(activeWv);
        }

        /// <summary>
        /// Git #937/#940 — shared: finds the active editor tab across the four
        /// panes, confirms it's a Claude.ai chat (a BoardChat tab, or any tab
        /// currently on a claude.ai URL), and injects <paramref name="text"/> into
        /// its real composer via the #871/#922 technique. Never presses Enter —
        /// Shane reviews and sends himself. Reports every outcome back through
        /// <paramref name="showMessage"/> and invokes <paramref name="onInserted"/>
        /// only on a confirmed insert, so both Sticky Notes (#937) and the SQL
        /// Runner's "Send to Chat" (#940) share one code path instead of
        /// reimplementing the active-tab detection + composer injection twice.
        /// </summary>
        public async System.Threading.Tasks.Task SendTextToActiveClaudeChatAsync(
            string text,
            Action<string, bool> showMessage,
            Action? onInserted,
            string logChannel,
            string whatSingular = "text")
        {
            var (wv, tab) = GetActiveEditorTabWebView();
            if (wv?.CoreWebView2 == null)
            {
                showMessage("No active editor tab to send into — open a Claude.ai chat tab first.", true);
                BuildConsole.Services.ActivityLog.Log(logChannel, "send-failed-no-active-chat: no active editor tab");
                return;
            }

            string url = "";
            try { url = wv.Source?.ToString() ?? ""; } catch { }

            bool isClaudeChat = tab?.Tag is BuildConsole.Services.BoardChat
                                || url.Contains("claude.ai", StringComparison.OrdinalIgnoreCase);
            if (!isClaudeChat)
            {
                showMessage("The active tab isn't a Claude.ai chat — click into a Claude chat tab, then Send.", true);
                BuildConsole.Services.ActivityLog.Log(logChannel, $"send-failed-no-active-chat: active tab is not a Claude chat ({url})");
                return;
            }

            string status;
            try
            {
                string raw = await wv.ExecuteScriptAsync(StickyNotesComposerInsertScript(text)) ?? "";
                status = System.Text.Json.JsonSerializer.Deserialize<string>(raw) ?? "";
            }
            catch (Exception ex)
            {
                status = "error: " + ex.Message;
            }

            if (status == "inserted")
            {
                onInserted?.Invoke();
                showMessage("Sent — review it in the chat and press Enter yourself.", false);
                BuildConsole.Services.ActivityLog.Log(logChannel, $"send: inserted {whatSingular} into active Claude chat ({url})");
            }
            else if (status == "no-composer")
            {
                showMessage("Couldn't find the Claude chat composer on the active tab — is a conversation open?", true);
                BuildConsole.Services.ActivityLog.Log(logChannel, $"send-failed-no-active-chat: composer not found ({url})");
            }
            else
            {
                showMessage("Send failed while inserting into the chat.", true);
                BuildConsole.Services.ActivityLog.Log(logChannel, $"send-failed-no-active-chat: {status} ({url})");
            }
        }

        /// <summary>
        /// Git #940 — routes a SqlDocumentView's "Send to Chat" through the same
        /// shared active-chat injection path (#937). Applied to both the docked
        /// SQL Runner and each .sql file tab; reports the outcome back inline on
        /// the view's own status strip.
        /// </summary>
        private void WireSqlRunnerSendToChat(Controls.SqlDocumentView view)
        {
            view.SendToChatRequested += async (s, text) =>
                await SendTextToActiveClaudeChatAsync(
                    text,
                    showMessage: (msg, isError) => view.ShowSendStatus(msg),
                    onInserted: null,
                    logChannel: "sql-runner.send-to-chat",
                    whatSingular: "SQL results");
        }

        /// <summary>
        /// Git #937 — replicates #922's EpicChatPrefillPollScript composer insert
        /// for an ALREADY-active tab (so no ~15s SPA-boot poll needed). Claude.ai's
        /// composer is a contenteditable ProseMirror div, so the proven write is
        /// execCommand('insertText') + a dispatched InputEvent fallback — the same
        /// technique #871/#922 established (the native value-setter trick from #871
        /// is for &lt;input&gt;/&lt;textarea&gt;; a contenteditable takes this
        /// execCommand path). The note is JSON-encoded into a safe JS string
        /// literal. Appends at the end of whatever's already typed; never presses
        /// Enter. Returns 'inserted' | 'no-composer' | 'error: ...'.
        /// </summary>
        private static string StickyNotesComposerInsertScript(string text)
        {
            string js = System.Text.Json.JsonSerializer.Serialize(text);
            return $@"
(function () {{
  try {{
    var text = {js};
    function findComposer() {{
      var c = Array.prototype.slice.call(document.querySelectorAll('div[contenteditable=""true""]'))
        .filter(function (el) {{ return el.offsetParent !== null; }});
      c.sort(function (a, b) {{ return b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight; }});
      return c[0] || null;
    }}
    var composer = findComposer();
    if (!composer) return 'no-composer';
    composer.focus();
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    var inserted = document.execCommand('insertText', false, text);
    if (!inserted) {{
      range.insertNode(document.createTextNode(text));
      composer.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
    }}
    return 'inserted';
  }} catch (ex) {{
    return 'error: ' + ex.message;
  }}
}})();";
        }

        private void ActivityBar_QuickNavRequested(object? sender, string url)
        {
            var (title, glyph) = url switch
            {
                var u when u.Contains("5174") || u.Contains("/admin-panel/") => ("Admin Center", "\uE7EF"),
                var u when u.Contains("5175") || u.Contains("/portal/")      => ("Customer Portal", "\uE77B"),
                var u when u.Contains("replit.com")                          => ("Replit Workspace", "\uE7B8"),
                _                                                            => ("Marketing Site", "\uE774")
            };
            // Git #821 \u2014 Shane: "I want a play/pause button and when play
            // is on... this page stays alive refreshing every 5 or 10
            // minutes." Replit puts a workspace to sleep after a period of
            // inactivity; a periodic reload keeps it awake. Only the Replit
            // tab gets the toggle - it's the one use case asked for.
            OpenWebTab(url, title, glyph, offerKeepAlive: url.Contains("replit.com"));
        }

        public System.Threading.Tasks.Task<Microsoft.Web.WebView2.Wpf.WebView2?> OpenOrFocusReplitWorkspaceTabAsync()
        {
            if (!Dispatcher.CheckAccess())
            {
                return System.Threading.Tasks.Task.FromResult(Dispatcher.Invoke(OpenOrFocusReplitWorkspaceTabInternal));
            }

            return System.Threading.Tasks.Task.FromResult(OpenOrFocusReplitWorkspaceTabInternal());
        }

        private Microsoft.Web.WebView2.Wpf.WebView2? OpenOrFocusReplitWorkspaceTabInternal()
        {
            var s = BuildConsole.Services.BuildConsoleSettings.Load();
            string url = !string.IsNullOrWhiteSpace(s.ReplitWorkspaceUrl)
                ? s.ReplitWorkspaceUrl
                : "https://replit.com/@shanemccaw/Shane-McCaw-Consulting";

            // Check if already open
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagUrl && (tagUrl.Contains("replit.com") || string.Equals(tagUrl, url, StringComparison.OrdinalIgnoreCase)))
                {
                    EditorTabs.SelectedItem = item;
                    if (item.Content is Grid g)
                    {
                        foreach (var child in g.Children)
                        {
                            if (child is Microsoft.Web.WebView2.Wpf.WebView2 existingWv)
                                return existingWv;
                        }
                    }
                }
            }

            // Open new visible web tab exactly like the ActivityBar button
            OpenWebTab(url, "Replit Workspace", "\uE7B8", offerKeepAlive: true);

            // Return the newly created tab's WebView2
            if (EditorTabs.SelectedItem is TabItem selectedItem && selectedItem.Content is Grid grid)
            {
                foreach (var child in grid.Children)
                {
                    if (child is Microsoft.Web.WebView2.Wpf.WebView2 newWv)
                        return newWv;
                }
            }

            return null;
        }

        /// <summary>Git #864 — a Web Tools popout entry was clicked; opens exactly like a QuickNav icon.</summary>
        private void ActivityBar_WebToolRequested(object? sender, (string Name, string Url) tool)
        {
            var url = tool.Url;
            if (!url.StartsWith("http://") && !url.StartsWith("https://"))
            {
                url = "https://" + url;
            }
            BuildConsole.Services.ActivityLog.Log("web-tools.open", $"{tool.Name} -> {url}");
            OpenWebTab(url, tool.Name, "");
        }

        private void EditorTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            // Git #937 — whichever pane's selection just changed is the one Shane
            // is working in; remember it so Sticky Notes' Send targets it.
            if (e.Source is TabControl changedPane && IsEditorPane(changedPane))
                _activeEditorPane = changedPane;

            // Git #1887 — this tab was opened as a background-reopen placeholder and has a
            // real, already-loading WebView2 parked in ChatReopenPreloadHost; now that it's
            // actually being selected (about to be attached to the live tree), swap that
            // background one in before anything below reads GetActiveWebView()/the tab's
            // content, so Shane sees already-loaded content rather than a fresh navigation.
            if (e.Source is TabControl selectedPane && selectedPane.SelectedItem is TabItem selectedForSwap
                && _pendingReopenSwap.TryGetValue(selectedForSwap, out var pendingConversationId))
            {
                SwapInReopenPreload(selectedForSwap, pendingConversationId);
            }

            if (e.Source == EditorTabs)
            {
                try
                {
                    var wv = GetActiveWebView();
                    UrlStatusText.Text = wv.Source?.ToString() ?? string.Empty;
                    UpdateZoomDisplay();
                }
                catch { }

                // Git #829 — Shane: "I need the right panel to have another
                // section that shows me all the issues assigned to the chat
                // I'm on." Only chat tabs carry a BoardChat as their Tag
                // (OpenChatTab); anything else (a browser tab, a file
                // viewer) clears the section.
                if (EditorTabs.SelectedItem is TabItem selectedTab && selectedTab.Tag is BuildConsole.Services.BoardChat chat)
                {
                    // Git #2548 — refresh this tab's Chat Document Container context bar (epic +
                    // epic-scoped counts + gauge) so it reflects the tab you're actually on.
                    RefreshChatContainerFor(selectedTab);

                    // Git #910 — the real GitHub epic number goes along with the
                    // internal epicId/title so BuildQueuePanel can fetch real sub-issues.
                    // Git #1363 — resolve the chat's epic through the SAME canonical
                    // resolver the Chats panel uses for grouping (LeftSidebar.GetEpicForChat):
                    // it traverses the direct epic_id, the chat's own issue number, its
                    // many-to-many bt_chat_issues associations, AND sub-issue→parent-epic —
                    // so ANY chat that groups under an epic in the Chats panel also lights
                    // up that epic's green "🎯 WORKING" badge on the Git Board. Previously
                    // this block reimplemented a THINNER inline resolver (epic_id + the open
                    // tab's number only), so a chat associated to its epic solely via the
                    // join table grouped correctly yet never highlighted — the "works for
                    // one chat but not another" symptom. (The underlying data gap that first
                    // surfaced this — a real open epic missing from the stale local bt_epics
                    // — was corrected in #1362; this aligns the highlight so it stays
                    // reliable for any chat with a genuine epic association, not just some.)
                    var resolvedEpic = LeftSidebar.GetEpicForChat(chat);

                    // Fallback: if the chat itself doesn't resolve to an epic but the browser
                    // tab is pinned to a specific issue/epic number, try that — preserves the
                    // prior tabState.GithubNumber self-epic behaviour for a generic chat opened
                    // in the context of a specific issue tab.
                    if (resolvedEpic == null)
                    {
                        int? tabGithubNumber = null;
                        if (_chatTabs.TryGetValue(selectedTab, out var tabState))
                        {
                            tabGithubNumber = tabState.GithubNumber;
                        }
                        if (!tabGithubNumber.HasValue)
                        {
                            tabGithubNumber = chat.IssueGithubNumber;
                        }
                        if (tabGithubNumber.HasValue)
                        {
                            resolvedEpic = LeftSidebar.GetEpicByGithubNumber(tabGithubNumber.Value);
                        }
                    }

                    // Git #1802 — last resort: a freshly opened or manually
                    // renamed BoardChat tab may carry the issue number in its
                    // visible title before GetEpicForChat/tabState/chat
                    // tracking catches up. Same title-parsing fallback as the
                    // untracked-tab case below.
                    int? titleFallbackNumber = null;
                    if (resolvedEpic == null)
                    {
                        titleFallbackNumber = ExtractTabTitleIssueNumber(ExtractTabTitle(selectedTab));
                        if (titleFallbackNumber.HasValue)
                        {
                            resolvedEpic = LeftSidebar.GetEpicByGithubNumber(titleFallbackNumber.Value);
                        }
                    }

                    int? epicId = resolvedEpic?.Id;
                    // Git #1905 — #1802's remaining gap: it fed the highlight only
                    // resolvedEpic?.GithubNumber, so a title number that parsed fine but
                    // wasn't in the epics-only cache (_chatEpicById) produced null and
                    // SetActiveEpicGithubNumber(null) CLEARED the Git Board highlight — the
                    // exact "not scoping down to #1202" symptom Shane reported. The board
                    // tree matches the active epic by raw IssueNumber (RenderTree), not by
                    // epics-dict membership, so fall back to the raw parsed number: scope to
                    // [#N] whenever the title carries one, even if GetEpicByGithubNumber missed.
                    int? epicGithubNumber = resolvedEpic?.GithubNumber ?? titleFallbackNumber;
                    string? epicTitle = resolvedEpic?.Title;

                    BuildQueuePanel.SetActiveChatEpic(epicId, epicGithubNumber, epicTitle);
                    // Shane: "I should be able to look at the Git Board Tree
                    // View and know exactly what Epic I'm working" — same
                    // signal, so the Git Board highlight tracks whichever
                    // chat tab is on screen.
                    LeftSidebar.SetActiveEpicGithubNumber(epicGithubNumber);
                }
                else
                {
                    // Git #1802 — this tab isn't a tracked BoardChat (a plain
                    // browser tab, an unassigned/manually opened claude.ai tab,
                    // or a tab predating tracking), but its visible title may
                    // still carry a real issue number — parse it the same way
                    // as the BoardChat last-resort fallback above rather than
                    // unconditionally clearing the highlight.
                    BuildConsole.Services.BoardEpic? untrackedEpic = null;
                    int? untrackedTitleNumber = null;
                    if (EditorTabs.SelectedItem is TabItem untrackedTab)
                    {
                        untrackedTitleNumber = ExtractTabTitleIssueNumber(ExtractTabTitle(untrackedTab));
                        if (untrackedTitleNumber.HasValue)
                        {
                            untrackedEpic = LeftSidebar.GetEpicByGithubNumber(untrackedTitleNumber.Value);
                        }
                    }

                    // Git #1905 — same raw-number fallback as the tracked branch above:
                    // scope the Git Board to the title's number even when it isn't in the
                    // epics-only cache. SetActiveChatEpic is a no-op collapse when epicId is
                    // null (it early-returns), so passing the raw number there is harmless.
                    int? untrackedGithubNumber = untrackedEpic?.GithubNumber ?? untrackedTitleNumber;
                    BuildQueuePanel.SetActiveChatEpic(untrackedEpic?.Id, untrackedGithubNumber, untrackedEpic?.Title);
                    LeftSidebar.SetActiveEpicGithubNumber(untrackedGithubNumber);
                }
            }
        }

        private void LeftSidebar_StartRecordingRequested(object? sender, string targetUrl)
        {
            if (string.IsNullOrWhiteSpace(targetUrl))
            {
                targetUrl = "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/";
            }

            if (!targetUrl.StartsWith("http://") && !targetUrl.StartsWith("https://"))
            {
                targetUrl = "https://" + targetUrl;
            }

            // Automatically open live web browser tab in editor area
            OpenWebTab(targetUrl, "Recorder Browser", "\uE774");

            var wv = GetActiveWebView();
            if (wv != null)
            {
                wv.Loaded += (s, e) => InjectRecorderScript(wv);
                if (wv.CoreWebView2 != null)
                {
                    InjectRecorderScript(wv);
                }
            }
        }

        private void InjectRecorderScript(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            if (wv.CoreWebView2 == null) return;

            wv.WebMessageReceived -= Wv_WebMessageReceived;
            wv.WebMessageReceived += Wv_WebMessageReceived;

            string recorderJs = @"
(function() {
    if (window.__uiRecorderInjected) {
        window.__isRecordingUI = true;
        return;
    }
    window.__uiRecorderInjected = true;
    window.__isRecordingUI = true;

    function getSelector(el) {
        if (!el) return '';
        if (el.id) return '#' + el.id;
        if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name=""' + el.getAttribute('name') + '""]';
        if (el.className && typeof el.className === 'string') {
            let cls = el.className.trim().split(/\s+/).join('.');
            if (cls) return el.tagName.toLowerCase() + '.' + cls;
        }
        return el.tagName.toLowerCase();
    }

    document.addEventListener('click', function(e) {
        if (!window.__isRecordingUI) return;
        let el = e.target;
        let sel = getSelector(el);
        let txt = (el.innerText || el.value || '').trim().substring(0, 40);
        window.chrome.webview.postMessage(JSON.stringify({
            type: 'RECORD_ACTION',
            action: 'click',
            selector: sel,
            tagName: el.tagName.toLowerCase(),
            value: txt
        }));
    }, true);

    document.addEventListener('change', function(e) {
        if (!window.__isRecordingUI) return;
        let el = e.target;
        let sel = getSelector(el);
        window.chrome.webview.postMessage(JSON.stringify({
            type: 'RECORD_ACTION',
            action: 'input',
            selector: sel,
            tagName: el.tagName.toLowerCase(),
            value: el.value
        }));
    }, true);
})();";
            wv.ExecuteScriptAsync(recorderJs);
        }

        private void LeftSidebar_StopRecordingRequested(object? sender, EventArgs e)
        {
            var wv = GetActiveWebView();
            if (wv != null && wv.CoreWebView2 != null)
            {
                wv.ExecuteScriptAsync("window.__isRecordingUI = false;");
            }
        }

        // Git #810 — the manual "Play" button (Automation sidebar) used to open the standalone
        // AutomationRunnerWindow popup, then (post-#857) replayed RecordedSteps directly through
        // UiTestExecutor. But #963 removed the Record button, so RecordedSteps is permanently empty
        // and that uiSteps-only replay ran nothing. Play now hands over the loaded manifest and runs
        // it through the SAME RunManifestAsync pipeline as Menu > Run Tests (Current Issue), the
        // regression sweep, and the #898 remote trigger — full api/graph/postGraphApi/zoho/uiSteps/
        // powerShellVerify coverage with live TestRunnerWindow telemetry (RunManifestAsync already
        // does EnsureTestRunnerWindow/Clear/SetSteps/BeginRun itself), not a recording-only playback.
        private void LeftSidebar_PlayTestRequested(object? sender, (BuildConsole.Services.TestManifest Manifest, BuildConsole.Services.TargetEnvironment TargetEnv) req)
        {
            _ = BuildConsole.Services.TestQueueService.Instance.EnqueueAndRunAsync(
                $"{req.Manifest.Feature} (#{req.Manifest.Issue}) [{req.TargetEnv}]",
                "sidebar-play",
                () => RunManifestAsync(req.Manifest, isRegression: false, targetEnv: req.TargetEnv)
            );
        }

        // "🔄 Retry" in TestRunnerWindow's header — mirrors LeftSidebar_PlayTestRequested exactly, just
        // sourced from the window's own last-run manifest instead of the sidebar's loaded one, so Shane
        // can re-run a failed manifest without re-selecting it.
        private void TestRunnerWindow_RetryRequested(object? sender, (BuildConsole.Services.TestManifest Manifest, BuildConsole.Services.TargetEnvironment TargetEnv) req)
        {
            _ = BuildConsole.Services.TestQueueService.Instance.EnqueueAndRunAsync(
                $"{req.Manifest.Feature} (#{req.Manifest.Issue}) [{req.TargetEnv}]",
                "test-runner-retry",
                () => RunManifestAsync(req.Manifest, isRegression: false, targetEnv: req.TargetEnv)
            );
        }

        private void Wv_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;

                using var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "RECORD_ACTION")
                {
                    string action = root.GetProperty("action").GetString() ?? "click";
                    string selector = root.GetProperty("selector").GetString() ?? "";
                    string tagName = root.GetProperty("tagName").GetString() ?? "div";
                    string val = root.TryGetProperty("value", out var vProp) ? (vProp.GetString() ?? "") : "";

                    Dispatcher.Invoke(() =>
                    {
                        LeftSidebar.RecordAction(action, selector, tagName, val);
                    });
                }
            }
            catch { }
        }

        /// <summary>
        /// Git #922 (Epic #803) — the browser extension's own
        /// tryInsertPrefillFromUrl() content script (content.js), replicated for
        /// injection into BuildConsole's OWN WebView2 tabs, where that extension
        /// isn't installed and never runs. Reads the <c>bt_prefill</c> param
        /// straight off the tab's URL, polls up to ~15s for the real claude.ai
        /// composer (a fresh tab's SPA needs to boot first), inserts the text via
        /// the same execCommand('insertText') the extension's
        /// insertTextIntoComposer() uses (the only write ProseMirror/React
        /// editors actually pick up), then strips the param so a reload/back
        /// doesn't re-insert. Deliberately does NOT replicate the extension's
        /// renameCurrentChat step — Shane presses Enter himself (#922).
        /// </summary>
        /// <summary>Shane, 2026-08-30 — internal (was private) so IssueDetailView's chat
        /// column (Batter Up / AI Batter Up) can reuse this exact poll-and-insert script
        /// on its own embedded WebView2 instead of reimplementing it.</summary>
        internal const string EpicChatPrefillPollScript = @"
(function () {
  try {
    var PARAM = 'bt_prefill';
    var text = new URLSearchParams(window.location.search).get(PARAM);
    if (!text) return 'no-param';
    if (window.__btEpicPrefillRunning) return 'already-running';
    window.__btEpicPrefillRunning = true;
    function findComposer() {
      var c = Array.prototype.slice.call(document.querySelectorAll('div[contenteditable=""true""]'))
        .filter(function (el) { return el.offsetParent !== null; });
      c.sort(function (a, b) { return b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight; });
      return c[0] || null;
    }
    function insertTextIntoComposer(t) {
      var composer = findComposer();
      if (!composer) return false;
      composer.focus();
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      var inserted = document.execCommand('insertText', false, t);
      if (!inserted) {
        range.insertNode(document.createTextNode(t));
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t }));
      }
      return true;
    }
    var attempts = 0;
    var maxAttempts = 30; // ~15s at 500ms — a fresh tab's SPA boot is slower than an already-open one
    function tryInsert() {
      attempts++;
      if (findComposer()) {
        insertTextIntoComposer(text);
        var u = new URL(window.location.href);
        u.searchParams.delete(PARAM);
        history.replaceState(null, '', u.toString());
        window.__btEpicPrefillRunning = false;
        return;
      }
      if (attempts < maxAttempts) setTimeout(tryInsert, 500);
      else window.__btEpicPrefillRunning = false;
    }
    tryInsert();
    return 'started';
  } catch (ex) {
    window.__btEpicPrefillRunning = false;
    return 'error: ' + ex.message;
  }
})();";

        /// <summary>
        /// Git #922 follow-up — the association half of the "New Epic Chat" flow.
        /// The browser extension links a chat to an epic via an explicit numeric
        /// epicId (content.js linkTo → POST /chats/ingest force:true); it recovers
        /// the conversation from the URL with conversationIdFromUrl() (the same
        /// /chat/&lt;uuid&gt; regex). BuildConsole's own WebView2 has no extension,
        /// so this injected watcher plays that role: it reads location.pathname for
        /// the conversation UUID — which claude.ai only mints once the FIRST message
        /// is actually sent — and posts it back to the host the instant it appears
        /// (and only once). It self-polls because sending the message is an SPA
        /// route change (history.pushState), not a document reload, so a document-
        /// created hook alone would miss it. MainWindow's WebMessageReceived handler
        /// then resolves the epic and writes the link (AssociateEpicChatAsync).
        /// </summary>
        private const string EpicChatAssociationWatcherScript = @"
(function () {
  try {
    if (window.__btEpicAssocWatching) return 'already-watching';
    window.__btEpicAssocWatching = true;
    var RE = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    var reported = null;
    function check() {
      var m = (window.location.pathname || '').match(RE);
      if (m && m[1] && m[1] !== reported) {
        reported = m[1];
        try {
          window.chrome.webview.postMessage(JSON.stringify({ type: 'BT_EPIC_CHAT_CONVERSATION', conversationId: m[1] }));
        } catch (e) { /* host bridge not ready — the interval retries */ }
      }
    }
    check();
    setInterval(check, 1000);
    return 'watching';
  } catch (ex) {
    return 'error: ' + ex.message;
  }
})();";

        /// <summary>
        /// Git #922 follow-up — writes the chat→epic link once the injected
        /// <see cref="EpicChatAssociationWatcherScript"/> reports that a "New Epic
        /// Chat" WebView2 session got a real conversation UUID (i.e. Shane actually
        /// sent the prefilled "Epic #N" message). Resolves the epic's internal
        /// bt_epics id from its GitHub number via a live board fetch — GetBoardAsync's
        /// CachedAsync always live-fetches first, only falling back to cache on
        /// failure, so it's current — then POSTs the SAME /chats/ingest force:true the
        /// extension's own "link to this epic" click uses
        /// (<see cref="BuildConsole.Services.BuildTrackerApiClient.LinkChatToEpicAsync"/>),
        /// and refreshes the Chats tree so the chat lands under the epic. Every branch
        /// logs on the git-board.epic-chat channel so a missed association (epic not in
        /// bt_epics, API down, non-2xx) is diagnosable rather than silent.
        /// </summary>
        /// <summary>
        /// Writes the chat→issue/milestone link once the injected
        /// <see cref="EpicChatAssociationWatcherScript"/> reports that a "New Chat"
        /// WebView2 session got a real conversation UUID (i.e. Shane actually
        /// sent the prefilled message). POSTs to /chats/assign-issue,
        /// and refreshes the Chats tree.
        /// </summary>
        private async System.Threading.Tasks.Task AssociateChatWithIssueAsync(string conversationId, int issueNumber, string issueType, string defaultTitle)
        {
            try
            {
                if (_queueDb != null)
                {
                    // Git #2068 — pass LeftSidebar's own live-board resolver (the same
                    // already-fetched _lastBoardIssues its display side reads) so a
                    // not-yet-synced epic/issue self-heals instead of silently leaving
                    // bt_chats.epic_id/issue_id unset.
                    bool resolved = await _queueDb.LinkChatToIssueAsync(conversationId, issueNumber, defaultTitle, resolveLive: LeftSidebar.ResolveLiveBoardIssue);
                    BuildConsole.Services.ActivityLog.Log("git-board.chat", $"associated chat {conversationId} -> {issueType} #{issueNumber} — BoardChat upserted (direct Postgres, epic/issue FK resolved: {resolved}); refreshing Chats panel");
                    try { LeftSidebar.PopulateChatsTree(); } catch { /* refresh is best-effort */ }
                    return;
                }

                if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
                {
                    BuildConsole.Services.ActivityLog.Log("git-board.chat", $"cannot associate chat {conversationId} to {issueType} #{issueNumber}: Build Tracker API not configured");
                    return;
                }

                var resp = await _buildTrackerApi.LinkChatToIssueAsync(conversationId, issueNumber, defaultTitle);
                if (resp.IsSuccessStatusCode)
                {
                    BuildConsole.Services.ActivityLog.Log("git-board.chat", $"associated chat {conversationId} -> {issueType} #{issueNumber} — BoardChat upserted (HTTP {(int)resp.StatusCode}); refreshing Chats panel");
                    try { LeftSidebar.PopulateChatsTree(); } catch { /* refresh is best-effort */ }
                }
                else
                {
                    string body;
                    try { body = await resp.Content.ReadAsStringAsync(); } catch { body = ""; }
                    BuildConsole.Services.ActivityLog.Log("git-board.chat", $"association POST for chat {conversationId} -> {issueType} #{issueNumber} returned HTTP {(int)resp.StatusCode}: {body}");
                }
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("git-board.chat", $"association failed for chat {conversationId} -> {issueType} #{issueNumber}: {ex.Message}");
            }
        }

        public void OpenWebTab(string url, string title, string glyph, bool offerKeepAlive = false, bool injectPrefillPoll = false, int? associateIssueNumber = null, string? associateIssueType = null, string? associateDefaultTitle = null)
        {
            // Deduplicate if already open
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagUrl && string.Equals(tagUrl, url, StringComparison.OrdinalIgnoreCase))
                {
                    EditorTabs.SelectedItem = item;
                    return;
                }
            }

            // Tab header panel
            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            var iconBlock = new TextBlock
            {
                Text = glyph,
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("BlueBrush")
            };

            var titleBlock = new TextBlock
            {
                Text = title,
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
            };

            var closeBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1),
                Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab",
                VerticalAlignment = VerticalAlignment.Center
            };

            headerPanel.Children.Add(iconBlock);
            headerPanel.Children.Add(titleBlock);
            headerPanel.Children.Add(closeBtn);

            // WebView2 content with dark default background
            var wv = new BuildConsole.Controls.ChatSafeWebView2
            {
                DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37)
            };
            wv.NavigationStarting  += WebView_NavigationStarting;
            wv.NavigationCompleted += WebView_NavigationCompleted;
            wv.SourceChanged       += WebView_SourceChanged;

            if (injectPrefillPoll)
            {
                wv.NavigationCompleted += async (s, e) =>
                {
                    if (!e.IsSuccess) return;
                    try { await wv.ExecuteScriptAsync(EpicChatPrefillPollScript); }
                    catch { }
                };
            }

            // Git #1629 — this used an inline pattern missing the UUID's fourth
            // hyphen group (8-4-4-12 instead of 8-4-4-4-12), so it NEVER matched a
            // real conversation URL: initialConversationId stayed null and the
            // watcher guard below couldn't tell the tab's pre-existing conversation
            // from a genuinely new one. Now uses the one shared, correct pattern.
            string? initialConversationId = null;
            var initConvMatch = ClaudeChatUrlRegex.Match(url);
            if (initConvMatch.Success) initialConversationId = initConvMatch.Groups[1].Value;

            bool navigated = false;
            bool epicAssocWired = false;
            bool epicAssociated = false;

            // Browser navigation toolbar bar
            var navBar = new Grid
            {
                Background = (Brush)FindResource("MantleBrush"),
                Height = 36
            };
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Back
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Forward
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Refresh
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // URL Address Box
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Go
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Keep-alive play/pause (only if offerKeepAlive)
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Fill Login

            var btnBack = new Button
            {
                Content = new TextBlock { Text = "\uE72B", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(4, 4, 2, 4), ToolTip = "Back"
            };
            btnBack.Click += (s, e) => { if (wv.CanGoBack) wv.GoBack(); };

            var btnForward = new Button
            {
                Content = new TextBlock { Text = "\uE72A", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(0, 4, 2, 4), ToolTip = "Forward"
            };
            btnForward.Click += (s, e) => { if (wv.CanGoForward) wv.GoForward(); };

            var btnRefresh = new Button
            {
                Content = new TextBlock { Text = "\uE72C", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(0, 4, 6, 4), ToolTip = "Refresh"
            };
            btnRefresh.Click += (s, e) => wv.Reload();

            var urlBox = new TextBox
            {
                Text = url,
                FontSize = 12,
                Height = 26,
                Margin = new Thickness(0, 4, 0, 4),
                Padding = new Thickness(8, 2, 8, 2),
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = (Brush)FindResource("BaseBrush"),
                Foreground = (Brush)FindResource("TextBrush"),
                BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource("Surface0Brush")
            };

            Action navigateUrl = () =>
            {
                string target = urlBox.Text.Trim();
                if (!target.StartsWith("http://") && !target.StartsWith("https://"))
                    target = "https://" + target;
                try { wv.Source = new Uri(target); } catch { }
            };

            urlBox.KeyDown += (s, e) =>
            {
                if (e.Key == System.Windows.Input.Key.Enter) navigateUrl();
            };

            var btnGo = new Button
            {
                Content = new TextBlock { Text = "\uE751", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(4, 4, 4, 4), ToolTip = "Go to URL"
            };
            btnGo.Click += (s, e) => navigateUrl();

            Grid.SetColumn(btnBack, 0);
            Grid.SetColumn(btnForward, 1);
            Grid.SetColumn(btnRefresh, 2);
            Grid.SetColumn(urlBox, 3);
            Grid.SetColumn(btnGo, 4);

            navBar.Children.Add(btnBack);
            navBar.Children.Add(btnForward);
            navBar.Children.Add(btnRefresh);
            navBar.Children.Add(urlBox);
            navBar.Children.Add(btnGo);

            // Git #821 — Shane: "I want a play/pause button and when play
            // is on... this page stays alive refreshing every 5 or 10
            // minutes." Reload (not just navigate) every 10 min while
            // toggled on — Replit puts an idle workspace to sleep, this
            // just keeps traffic hitting it. Timer is per-tab and stops
            // itself when the tab closes so it can't leak/keep running
            // against a WebView2 that no longer exists.
            DispatcherTimer? keepAliveTimer = null;
            if (offerKeepAlive)
            {
                const string playGlyph = "\uE768";
                const string pauseGlyph = "\uE769";
                // Git #833 — "IconButton" is TargetType="Button"; applying it
                // to this ToggleButton threw System.InvalidOperationException
                // ("'Button' TargetType does not match type of element
                // 'ToggleButton'") the instant this tab was opened. Styled
                // inline instead (matching IconButton's own look) rather than
                // a shared Style, since nothing else in the app needs a
                // ToggleButton-flavored icon button yet.
                var btnKeepAlive = new ToggleButton
                {
                    Content = new TextBlock { Text = playGlyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Foreground = (Brush)FindResource("Subtext1Brush"),
                    Width = 28, Height = 28, Margin = new Thickness(0, 4, 4, 4),
                    ToolTip = "Keep alive - auto-reload every 10 minutes while on"
                };
                btnKeepAlive.Checked += (s, e) =>
                {
                    ((TextBlock)btnKeepAlive.Content).Text = pauseGlyph;
                    btnKeepAlive.Background = (Brush)FindResource("Surface0Brush");
                    keepAliveTimer ??= new DispatcherTimer { Interval = TimeSpan.FromMinutes(10) };
                    keepAliveTimer.Tick -= KeepAliveTick;
                    keepAliveTimer.Tick += KeepAliveTick;
                    keepAliveTimer.Start();
                    void KeepAliveTick(object? s2, EventArgs e2)
                    {
                        try { wv.Reload(); } catch { }
                        BuildConsole.Services.ActivityLog.Log("keep-alive", $"Reloaded {url}");
                    }
                };
                btnKeepAlive.Unchecked += (s, e) =>
                {
                    ((TextBlock)btnKeepAlive.Content).Text = playGlyph;
                    btnKeepAlive.Background = Brushes.Transparent;
                    keepAliveTimer?.Stop();
                };
                Grid.SetColumn(btnKeepAlive, 5);
                navBar.Children.Add(btnKeepAlive);
            }

            // Fill Login button — always visible so you can manually trigger the autofill overlay
            // (click handler is wired below, after autofillOverlay and populateAutofillOverlay are declared)
            var btnFillLogin = new Button
            {
                Content = new TextBlock { Text = "\uE72E", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(0, 4, 4, 4), ToolTip = "Fill Login — show autofill profile picker"
            };
            Grid.SetColumn(btnFillLogin, 6);
            navBar.Children.Add(btnFillLogin);


            wv.SourceChanged += (s, e) =>
            {
                urlBox.Text = wv.Source?.ToString() ?? string.Empty;
            };

            var autofillOverlay = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Width = 280,
                Padding = new Thickness(12)
            };

            var overlayStack = new StackPanel();
            
            var headerGrid = new Grid { Margin = new Thickness(0, 0, 0, 8) };
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            
            var headerText = new TextBlock
            {
                Text = "🔑 Autofill Gated Profile",
                FontWeight = FontWeights.Bold,
                FontSize = 12,
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(headerText, 0);
            headerGrid.Children.Add(headerText);
            
            // Declare popup to overlay on top of WebView2 airspace and anchor under btnFillLogin
            var popup = new System.Windows.Controls.Primitives.Popup
            {
                Child = autofillOverlay,
                Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom,
                PlacementTarget = btnFillLogin,
                HorizontalOffset = -252, // Align right edge of 280px popup with right edge of 28px button
                VerticalOffset = 4,
                StaysOpen = false,
                IsOpen = false,
                AllowsTransparency = true,
                PopupAnimation = System.Windows.Controls.Primitives.PopupAnimation.Fade
            };

            var closeOverlayBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(4, 1, 4, 1),
                VerticalAlignment = VerticalAlignment.Center
            };
            closeOverlayBtn.Click += (s, e) => { popup.IsOpen = false; };
            Grid.SetColumn(closeOverlayBtn, 1);
            headerGrid.Children.Add(closeOverlayBtn);
            
            overlayStack.Children.Add(headerGrid);

            var listContainer = new StackPanel();
            overlayStack.Children.Add(listContainer);
            
            autofillOverlay.Child = overlayStack;

            string escapeJs(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");

            Action populateAutofillOverlay = () => { listContainer.Children.Clear(); };
            // Wire up Fill Login button click now that popup and populateAutofillOverlay are in scope
            btnFillLogin.Click += (s, e) =>
            {
                populateAutofillOverlay();
                popup.IsOpen = !popup.IsOpen;
            };
            populateAutofillOverlay = () =>
            {
                listContainer.Children.Clear();
                var settings = BuildConsoleSettings.Load();
                if (settings.UserAccounts == null || settings.UserAccounts.Count == 0)
                {
                    listContainer.Children.Add(new TextBlock
                    {
                        Text = "No user profiles configured in Settings.",
                        FontSize = 10,
                        Foreground = (Brush)FindResource("Subtext1Brush"),
                        TextWrapping = TextWrapping.Wrap,
                        Margin = new Thickness(0, 4, 0, 4)
                    });
                    return;
                }

                foreach (var acc in settings.UserAccounts)
                {
                    var isCurrentlyActive = string.Equals(acc.Id, settings.ActiveUserAccountId, StringComparison.OrdinalIgnoreCase);

                    var btn = new Button
                    {
                        Style = (Style)FindResource("IconButton"),
                        HorizontalContentAlignment = HorizontalAlignment.Stretch,
                        Padding = new Thickness(8, 6, 8, 6),
                        Margin = new Thickness(0, 0, 0, 4)
                    };

                    var btnGrid = new Grid();
                    btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                    var accountText = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                    accountText.Children.Add(new TextBlock
                    {
                        Text = acc.Username,
                        FontSize = 11.5,
                        FontWeight = FontWeights.Bold,
                        Foreground = (Brush)FindResource("TextBrush")
                    });
                    
                    var subText = isCurrentlyActive ? "Active Test Profile" : "";
                    if (!string.IsNullOrWhiteSpace(acc.Notes))
                    {
                        subText += (string.IsNullOrEmpty(subText) ? "" : " — ") + acc.Notes;
                    }
                    if (!string.IsNullOrEmpty(subText))
                    {
                        accountText.Children.Add(new TextBlock
                        {
                            Text = subText,
                            FontSize = 9,
                            Foreground = (Brush)FindResource("Subtext1Brush"),
                            TextTrimming = TextTrimming.CharacterEllipsis
                        });
                    }
                    Grid.SetColumn(accountText, 0);
                    btnGrid.Children.Add(accountText);

                    Brush badgeBg;
                    Brush badgeFg;
                    switch ((acc.AccountTier ?? "").ToUpperInvariant())
                    {
                        case "ADMIN":
                            badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#33F38BA8"));
                            badgeFg = (Brush)FindResource("RedBrush");
                            break;
                        case "ENTERPRISE":
                            badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#33CBA6F7"));
                            badgeFg = (Brush)FindResource("MauveBrush");
                            break;
                        case "PREMIUM":
                            badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3389B4FA"));
                            badgeFg = (Brush)FindResource("BlueBrush");
                            break;
                        default:
                            badgeBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#33A6E3A1"));
                            badgeFg = (Brush)FindResource("GreenBrush");
                            break;
                    }

                    var badge = new Border
                    {
                        Background = badgeBg,
                        BorderBrush = badgeFg,
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(4, 1, 4, 1),
                        VerticalAlignment = VerticalAlignment.Center,
                        Child = new TextBlock
                        {
                            Text = acc.AccountTier,
                            FontSize = 8.5,
                            FontWeight = FontWeights.Bold,
                            Foreground = badgeFg
                        }
                    };
                    Grid.SetColumn(badge, 1);
                    btnGrid.Children.Add(badge);

                    btn.Content = btnGrid;

                    btn.Click += async (s2, e2) =>
                    {
                        popup.IsOpen = false;
                        var encUser = "\"" + escapeJs(acc.Username) + "\"";
                        var encPass = "\"" + escapeJs(acc.Password) + "\"";

                        string fillScript = @"
(function(u, p) {
    try {
        let passEl = document.querySelector('input[type=""password""]');
        if (!passEl) return false;
        
        let userEl = null;
        let inputs = Array.from(document.querySelectorAll('input'));
        let passIdx = inputs.indexOf(passEl);
        if (passIdx > 0) {
            for (let i = passIdx - 1; i >= 0; i--) {
                let type = inputs[i].getAttribute('type') || 'text';
                if (type === 'text' || type === 'email' || type === 'username') {
                    userEl = inputs[i];
                    break;
                }
            }
        }
        
        if (!userEl) {
            userEl = document.querySelector('input[type=""email""], input[type=""text""], input[name*=""user""], input[name*=""login""]');
        }
        
        if (userEl) {
            let proto = window.HTMLInputElement.prototype;
            let nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            nativeSetter.call(userEl, u);
            userEl.dispatchEvent(new Event('input', { bubbles: true }));
            userEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        let proto = window.HTMLInputElement.prototype;
        let nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(passEl, p);
        passEl.dispatchEvent(new Event('input', { bubbles: true }));
        passEl.dispatchEvent(new Event('change', { bubbles: true }));
        
        return true;
    } catch(ex) {
        return false;
    }
})(" + encUser + ", " + encPass + ");";

                        try
                        {
                            await wv.ExecuteScriptAsync(fillScript);
                        }
                        catch { }
                    };

                    listContainer.Children.Add(btn);
                }
            };

            wv.NavigationCompleted += async (s, e) =>
            {
                if (!e.IsSuccess || wv.Source == null) return;
                
                try
                {
                    string checkScript = @"
(function() {
    return document.querySelector('input[type=""password""]') !== null;
})();";
                    string result = await wv.ExecuteScriptAsync(checkScript);
                    if (string.Equals(result, "true", StringComparison.OrdinalIgnoreCase))
                    {
                        populateAutofillOverlay();
                        popup.IsOpen = true;
                    }
                    else
                    {
                        popup.IsOpen = false;
                    }
                }
                catch
                {
                    // Fail-safe
                }
            };

            wv.Loaded += async (s, e) =>
            {
                bool ready = await EnsureWebViewInitializedAsync(wv);

                if (ready && url.Contains("claude.ai", StringComparison.OrdinalIgnoreCase))
                {
                    await InjectBuilderButtonsAsync(wv);
                }

                if (ready && associateIssueNumber.HasValue && !epicAssocWired)
                {
                    epicAssocWired = true;
                    int issueNumber = associateIssueNumber.Value;
                    string issueType = associateIssueType ?? "Issue";
                    string defaultTitle = associateDefaultTitle ?? $"[#{issueNumber}] Chat";
                    wv.CoreWebView2.WebMessageReceived += async (ws, we) =>
                    {
                        if (epicAssociated) return;
                        string raw;
                        try { raw = we.TryGetWebMessageAsString(); }
                        catch { return; }
                        if (string.IsNullOrEmpty(raw) ||
                            raw.IndexOf("BT_EPIC_CHAT_CONVERSATION", StringComparison.Ordinal) < 0) return;
                        var m = System.Text.RegularExpressions.Regex.Match(
                            raw, @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
                        if (!m.Success) return;
                        var conversationId = m.Value;
                        if (!string.IsNullOrEmpty(initialConversationId) &&
                            string.Equals(conversationId, initialConversationId, StringComparison.OrdinalIgnoreCase)) return;
                        epicAssociated = true;
                        await AssociateChatWithIssueAsync(conversationId, issueNumber, issueType, defaultTitle);
                    };
                    try { await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(EpicChatAssociationWatcherScript); }
                    catch { }
                }

                if (ready)
                {
                    wv.CoreWebView2.WebMessageReceived += (ws, we) =>
                    {
                        string msg;
                        try { msg = we.TryGetWebMessageAsString(); }
                        catch { return; }

                        if (msg == "AUTOFILL_PASSWORD_DETECTED")
                        {
                            try
                            {
                                populateAutofillOverlay();
                                popup.IsOpen = true;
                            }
                            catch { }
                        }
                    };

                    string observeScript = @"
(function() {
    function check() {
        if (document.querySelector('input[type=""password""]')) {
            window.chrome.webview.postMessage('AUTOFILL_PASSWORD_DETECTED');
            return true;
        }
        return false;
    }
    if (!check()) {
        const observer = new MutationObserver((mutations, obs) => {
            if (check()) {
                obs.disconnect();
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
})();";
                    try { _ = wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(observeScript); }
                    catch { }
                }

                if (ready && !navigated)
                {
                    navigated = true;
                    wv.CoreWebView2.Navigate(url);
                }
            };

            var wrappedWv = CreateChatContextWrapper(wv);

            var webContainer = new Grid
            {
                Background = (Brush)FindResource("BaseBrush")
            };
            webContainer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            webContainer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            Grid.SetRow(navBar, 0);
            Grid.SetRow(wrappedWv, 1);

            webContainer.Children.Add(navBar);
            webContainer.Children.Add(wrappedWv);
            webContainer.Children.Add(popup);

            var newTab = new TabItem
            {
                Tag = url,
                Header = headerPanel,
                Content = webContainer
            };

            closeBtn.Click += (s, e) =>
            {
                keepAliveTimer?.Stop();
                CloseTab(newTab);
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        // ── Git #802: chat tabs (own WebView2 per chat) + build split pane ──────
        /// <summary>
        /// Builds a fully-wired Claude chat WebView2 for a BoardChat — the exact same
        /// configuration OpenChatTab uses (nav handlers, builder-button injection, and the
        /// Git #852 navigate-once-on-first-Loaded guard). Extracted so the immersive Focus
        /// view (local #47) can host the SAME real chat session in its own centre panel
        /// instead of forcing a normal tab open (which used to exit immersive mode).
        /// </summary>
        public Microsoft.Web.WebView2.Wpf.WebView2 BuildChatWebView(BuildConsole.Services.BoardChat chat)
        {
            var wv = new BuildConsole.Controls.ChatSafeWebView2
            {
                DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37)
            };
            wv.NavigationStarting  += WebView_NavigationStarting;
            wv.NavigationCompleted += WebView_NavigationCompleted;
            wv.SourceChanged       += WebView_SourceChanged;
            // Git #852 — see OpenWebTab's identical fix: Loaded fires again
            // every time this tab becomes active (WPF TabControl detaches/
            // reattaches Content on switch), not just once - `navigated`
            // stops the chat from reloading itself back to its landing URL
            // every time Shane switches back to it.
            bool navigated = false;
            wv.Loaded += async (s, e) =>
            {
                await InjectBuilderButtonsAsync(wv);
                if (!navigated && wv.CoreWebView2 != null)
                {
                    navigated = true;
                    wv.CoreWebView2.Navigate(chat.ClaudeUrl);
                }
            };
            return wv;
        }

        /// <param name="selectTab">Git #1636 — false opens/creates the tab as a background tab:
        /// added to <see cref="EditorTabs"/>.Items but never assigned to SelectedItem, and an
        /// already-open match is left focused wherever it currently is. Defaults true so every
        /// pre-existing caller keeps today's always-select behavior unchanged.</param>
        public void OpenChatTab(BuildConsole.Services.BoardChat chat, int? githubNumber, bool selectTab = true)
        {
            // Dedupe on the chat's own id, not the URL - a chat's ClaudeUrl
            // doesn't change, so this is equivalent, but keeps the intent clear.
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Key.Tag is BuildConsole.Services.BoardChat existing &&
                    existing.ConversationId == chat.ConversationId)
                {
                    if (selectTab) EditorTabs.SelectedItem = kvp.Key;
                    return;
                }
            }

            var headerPanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            headerPanel.Children.Add(new TextBlock
            {
                Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("BlueBrush")
            });
            // Git #2534 — for any chat with a real epic_id, force the tab title to
            // "[#<epic github number>] <Epic Name>", regardless of the chat's own title or
            // the claude.ai page title. The epic-linked format always wins (req 6);
            // GetEpicForChat resolves EpicId directly as its first resolution path.
            // Only the DISPLAY title is forced — state.GithubNumber below is left as the
            // caller's value so per-chat build matching (which keys on the leaf issue,
            // not the epic) keeps working for a sub-issue chat that also carries an epic.
            BuildConsole.Services.BoardEpic? forcedEpic =
                chat.EpicId.HasValue ? LeftSidebar?.GetEpicForChat(chat) : null;
            string headerTitle = forcedEpic?.GithubNumber != null
                ? $"[#{forcedEpic.GithubNumber.Value}] {forcedEpic.Title}"
                : (githubNumber.HasValue ? $"[#{githubNumber.Value}] {chat.Title}" : chat.Title);
            // Git #2079 — prefix with the linked Git issue number so the tab header
            // reads "[#N] Title" (matches the [#N]/#N formats ExtractTabTitleIssueNumber
            // already parses back out at ~line 1368 for the #1802 epic-highlight fallback).
            headerPanel.Children.Add(new TextBlock
            {
                Text = headerTitle,
                FontSize = 13, Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)FindResource("TextBrush")
            });

            var boltBtn = new Button
            {
                Content = "⚡",
                Style = (Style)FindResource("IconButton"),
                FontSize = 11,
                Padding = new Thickness(2, 0, 2, 0),
                Margin = new Thickness(0, 0, 2, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Cursor = Cursors.Hand
            };
            void UpdateBoltAppearance()
            {
                bool inProgress = BuildConsole.Services.FocusModeService.Instance.IsChatInProgress(chat.ConversationId);
                boltBtn.Foreground = inProgress ? (Brush)FindResource("YellowBrush") : (Brush)FindResource("Subtext0Brush");
                boltBtn.ToolTip = inProgress
                    ? "In Progress (Active in Focus Mode) — click to unmark"
                    : "Mark as In Progress (keep accessible in Focus Mode)";
            }
            UpdateBoltAppearance();
            // Git #2663 — resolve the chat this tab REALLY shows now (live WebView2 URL),
            // not the cached BoardChat snapshot, so marking a tab that has navigated to a
            // new conversation stores the right chat. `boltTab` is assigned to the real
            // TabItem once it's constructed below (this closure runs only on click).
            TabItem? boltTab = null;
            boltBtn.Click += (s, e) =>
            {
                ToggleChatInProgressResolved(boltTab, chat.ConversationId, chat.Title, chat.ClaudeUrl);
                UpdateBoltAppearance();
            };
            headerPanel.Children.Add(boltBtn);

            var closeBtn = new Button
            {
                Content = "✕", Style = (Style)FindResource("IconButton"), FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1), Margin = new Thickness(2, 0, 0, 0),
                ToolTip = "Close Tab", VerticalAlignment = VerticalAlignment.Center
            };
            headerPanel.Children.Add(closeBtn);

            // Git #1887 — a genuine user-driven open (selectTab true, about to be attached
            // to the live visual tree immediately below) reuses an already-loading/loaded
            // background preload for this exact conversation if one exists, instead of
            // starting a brand-new navigation. A background reopen call itself
            // (selectTab: false) never takes it here — see the _pendingReopenSwap branch
            // below, which defers the swap until this placeholder tab is actually selected.
            Microsoft.Web.WebView2.Wpf.WebView2 wv;
            FrameworkElement wrappedWv;
            if (selectTab && TryTakeReopenPreload(chat.ConversationId, out var preloadedWv, out var preloadedWrapped))
            {
                wv = preloadedWv;
                wrappedWv = preloadedWrapped;
            }
            else
            {
                wv = BuildChatWebView(chat);
                wrappedWv = CreateChatContextWrapper(wv);
            }

            // Split grid: chat WebView2 in column 0, build output pane in
            // column 1 (starts collapsed - PollChatTabBuildStateAsync opens it
            // the moment a matching queue item goes 'running', closes it again
            // once that item finishes).
            var splitGrid = new Grid();
            var col0 = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
            var buildCol = new ColumnDefinition { Width = new GridLength(0) };
            splitGrid.ColumnDefinitions.Add(col0);
            splitGrid.ColumnDefinitions.Add(buildCol);
            Grid.SetColumn(wrappedWv, 0);
            splitGrid.Children.Add(wrappedWv);

            var buildPane = new Grid { Background = (Brush)FindResource("MantleBrush") };
            buildPane.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            buildPane.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var buildHeader = new Border
            {
                Background = (Brush)FindResource("CrustBrush"), Padding = new Thickness(8, 5, 8, 5),
                BorderBrush = (Brush)FindResource("Surface0Brush"), BorderThickness = new Thickness(0, 0, 0, 1)
            };
            var buildStatusText = new TextBlock
            {
                Text = "Build running…", FontSize = 11, FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("PeachBrush")
            };
            buildHeader.Child = buildStatusText;
            var buildOutputBox = new TextBox
            {
                IsReadOnly = true, Style = (Style)TryFindResource("TerminalOutputBox"),
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto
            };
            Grid.SetRow(buildHeader, 0);
            Grid.SetRow(buildOutputBox, 1);
            buildPane.Children.Add(buildHeader);
            buildPane.Children.Add(buildOutputBox);

            var buildPaneSplitter = new GridSplitter { Width = 4, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Stretch };
            Grid.SetColumn(buildPane, 1);
            Grid.SetColumn(buildPaneSplitter, 1);
            splitGrid.Children.Add(buildPaneSplitter);
            splitGrid.Children.Add(buildPane);

            // Git #2548 — wrap the live chat body (WebView2 split grid) in the Chat Document
            // Container: the 5-band native chrome (context bar / breadcrumb / tool rail / composer /
            // Inspector states). The split grid stays intact inside it, so build-pane polling, the
            // context meter and the inline SQL runner all keep working against state.SplitGrid.
            var container = new Controls.ChatDocumentContainer(chat, this, wv);
            container.SetBody(splitGrid);

            var newTab = new TabItem { Tag = chat, Header = headerPanel, Content = container };
            boltTab = newTab; // Git #2663 — the bolt handler above resolves live off THIS tab
            var state = new ChatTabState
            {
                GithubNumber = githubNumber,
                SplitGrid = splitGrid,
                BuildColumn = buildCol,
                BuildOutputBox = buildOutputBox,
                BuildStatusText = buildStatusText,
                WebView = wv, // Git #942 — target for live chat-button status pushes
                Container = container
            };
            _chatTabs[newTab] = state;

            // Git #2688 — wire this tab's Detected dock into the same BoardRefreshCompleted cascade
            // (#1813) already driving BatterUpPanel/AiBatterUpPanel, so a closed issue drops out of
            // an already-open chat's Detected panel on the app's main manual refresh instead of only
            // on the panel's own hidden per-tab refresh icon (RailRefresh_Click) or first open.
            EventHandler detectedRefreshHandler = async (s, e) => await container.RefreshDetectedAsync();
            state.DetectedRefreshHandler = detectedRefreshHandler;
            if (LeftSidebar != null) LeftSidebar.BoardRefreshCompleted += detectedRefreshHandler;

            closeBtn.Click += (s, e) => CloseTab(newTab);

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);
            EditorTabs.Items.Add(newTab);
            if (selectTab)
            {
                EditorTabs.SelectedItem = newTab;
            }
            else if (_reopenPreloadedWebViews.ContainsKey(chat.ConversationId ?? ""))
            {
                // Git #1887 — this background-opened placeholder has a matching background
                // preload still loading in ChatReopenPreloadHost. Remember to swap it in the
                // moment this tab is actually selected (EditorTabs_SelectionChanged) instead
                // of now, since un-parking it while nothing is selected would detach it from
                // the live visual tree and risk tearing its CoreWebView2 down.
                _pendingReopenSwap[newTab] = chat.ConversationId!;
            }
            PersistOpenChatTabs(); // Git #874 — remember this chat (BoardChat identity + pane) for next launch's Home roll-up
        }

        // ── Git #874 Home screen ────────────────────────────────────────────────

        /// <summary>
        /// Git #874 — opens (or focuses) the native Home tab. Replaces the old
        /// hardcoded, non-closable claude.ai tab: this one is created through the
        /// same closable-tab infrastructure (own ✕, drag/context-menu handlers) as
        /// every other tab and inserted as the default FIRST tab of the primary
        /// pane. Also re-openable from the command palette. First paint renders
        /// "Where you left off" from the launch snapshot and kicks a live roll-up
        /// refresh for the Running/Done sections.
        /// </summary>
        public void OpenHomeTab()
        {
            // Dedupe across all four editor panes (it can be dragged like any tab).
            foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
            {
                foreach (TabItem existing in pane.Items)
                {
                    if (existing.Tag as string == HomeTabTag)
                    {
                        pane.SelectedItem = existing;
                        BuildConsole.Services.ActivityLog.Log("home-screen", "Home tab focused (already open)");
                        return;
                    }
                }
            }

            var home = new BuildConsole.Controls.HomeView();
            home.InitializeHealthMonitor(_buildTrackerApi);
            home.ResumeChatRequested += Home_ResumeChatRequested;
            home.RunningItemClicked  += (s, c) => { if (c.GithubNumber is int n) OpenChatForIssue(n); };
            home.DoneItemClicked     += (s, c) =>
            {
                if (c.GithubNumber.HasValue && c.GithubNumber.Value < 0)
                {
                    var logPath = BuildConsole.Services.BuildLogPaths.ForQueueItem(c.QueueItemId);
                    if (System.IO.File.Exists(logPath))
                    {
                        OpenFileTab(logPath);
                    }
                    else
                    {
                        ToastEngine.Warning("Open Log", $"Build log file not found.");
                    }
                }
                else if (c.GithubNumber.HasValue)
                {
                    _ = OpenGitDetailByNumberAsync(c.GithubNumber.Value);
                }
            };
            // Clear a stale/orphaned "Running now" row — cancel the queue item (same
            // DELETE queue/{id} the Build Queue panel's right-click Cancel uses), then refresh.
            home.ClearStuckItemRequested += async (s, c) =>
            {
                if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured) return;
                try { await _buildTrackerApi.CancelQueueItemAsync(c.QueueItemId); }
                catch { /* best-effort — a failed cancel just leaves the row, never crashes the glance screen */ }
                await RefreshHomeRollupAsync(force: true);
            };
            home.DoneRefreshRequested += async (s, e) => await RefreshHomeRollupAsync(force: true);

            // Fast actions & dashboard navigation
            home.NewIssueRequested += (s, e) => _ = LeftSidebar.CreateNewIssueAsync();
            home.BuildWatchRequested += (s, e) => ToggleBuildWatch();
            home.TestRunnerRequested += (s, e) => EnsureTestRunnerWindow(background: false).Show();
            home.ReplitRequested += (s, e) => OpenOrFocusReplitWorkspaceTabInternal();
            home.ImmersiveFocusRequested += (s, e) => BuildConsole.Services.FocusModeService.Instance.EnterImmersive();
            home.DeployRequested += async (s, e) => await TriggerUpdateAsync(forceDeploy: true);
            home.GitBoardRequested += (s, e) => ActivityBar.SelectGitBoard();
            home.SettingsRequested += (s, e) => OpenSettingsTab();
            home.IssueDetailRequested += (s, issue) =>
            {
                var gitIssue = new BuildConsole.Controls.GitIssue
                {
                    IssueNumber = issue.Number,
                    Title = issue.Title,
                    RawTitle = issue.Title,
                    Status = issue.State,
                    Body = issue.Body,
                    DatabaseId = issue.DatabaseId,
                    IsEpic = issue.IsEpic,
                    IsComplete = issue.IsComplete,
                    HasParentEpic = issue.ParentNumber.HasValue,
                };
                OpenGitIssueDetailTab(gitIssue);
            };
            home.MilestoneDetailRequested += (s, milestoneNum) =>
            {
                var m = LeftSidebar.CurrentMilestones.FirstOrDefault(m => m.GithubNumber == milestoneNum);
                if (m != null) OpenMilestoneDetailTab(m);
            };
            // Pending Migrations panel → open/focus the #939 SQL Runner and load the
            // clicked migration file's real full contents for manual review + execution.
            home.OpenMigrationInSqlRunnerRequested += (s, path) =>
            {
                var sqlDoc = OpenSqlRunnerTab();
                try { sqlDoc.SetSqlQuery(File.ReadAllText(path)); }
                catch (Exception ex) { sqlDoc.ShowSendStatus($"Couldn't load {Path.GetFileName(path)}: {ex.Message}"); }
            };

            _homeView = home;

            var headerPanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            headerPanel.Children.Add(new TextBlock
            {
                Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12, // Home glyph
                Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("BlueBrush")
            });
            headerPanel.Children.Add(new TextBlock
            {
                Text = "Home", FontSize = 13, Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)FindResource("TextBrush")
            });
            var closeBtn = new Button
            {
                Content = "✕", Style = (Style)FindResource("IconButton"), FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1), Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab", VerticalAlignment = VerticalAlignment.Center
            };
            headerPanel.Children.Add(closeBtn);

            var tab = new TabItem { Tag = HomeTabTag, Header = headerPanel, Content = home };
            closeBtn.Click += (s, e) =>
            {
                CloseTab(tab);
                BuildConsole.Services.ActivityLog.Log("home-screen", "Home tab closed");
            };

            AttachTabContextMenu(tab, EditorTabs);
            AttachTabDragHandlers(tab);
            EditorTabs.Items.Insert(0, tab);
            EditorTabs.SelectedItem = tab;

            BuildConsole.Services.ActivityLog.Log("home-screen", "Home tab opened");

            // First paint: "Where you left off" from the launch snapshot; the live
            // Running/Done sections from the shared queue data (force = refresh the
            // open-issue set immediately rather than waiting for the 60s guard).
            home.RenderLeftOff(_chatTabsAtLaunch);
            home.RenderDashboardState(LeftSidebar.CurrentBoardIssues, LeftSidebar.CurrentMilestones);
            home.UpdateFocusState();
            // Re-render the "What's New" section from the launch-time cache (no-op /
            // stays collapsed until InitWhatsNewAsync has computed it, or when there's
            // nothing new). Reopening Home mid-session shows the same set.
            if (_whatsNewReady) home.RenderWhatsNew(_whatsNewVersion, _whatsNewTitles, _whatsNewMore, _whatsNewLastSeen, _whatsNewCurrent);
            _ = RefreshHomeRollupAsync(force: true);
        }

        /// <summary>
        /// Computes the Home "What's New" patch-notes ONCE at launch: the real
        /// first-line commit titles for BuildConsole that landed since the last launch,
        /// reusing the SAME #992 git-commit-count build number (VersionInfo.RunningBuild)
        /// as the version indicator — no second versioning system. A "last seen build" is
        /// persisted in BuildConsoleSettings; when the running build is ahead of it we
        /// fetch the intervening commit subjects (off the UI thread), render them, and
        /// advance last-seen to the current build so the same set never shows twice.
        /// First-ever launch (sentinel LastSeenBuild == -1) silently seeds the baseline
        /// instead of replaying all history.
        /// </summary>
        private async System.Threading.Tasks.Task InitWhatsNewAsync()
        {
            try
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                int current = BuildConsole.Services.VersionInfo.RunningBuild;
                int lastSeen = settings.LastSeenBuild;

                if (lastSeen < 0)
                {
                    lastSeen = current;
                    settings.LastSeenBuild = current;
                    settings.Save();
                }

                _whatsNewLastSeen = lastSeen;
                _whatsNewCurrent = current;

                List<string> titles;
                if (current > lastSeen)
                {
                    // Fetch all commits in the new range (up to 200 to avoid arbitrary 15 truncation)
                    titles = await System.Threading.Tasks.Task.Run(
                        () => BuildConsole.Services.VersionInfo.GetNewCommitTitles(lastSeen, 200));
                }
                else
                {
                    // No new changes, fetch Page 0 of history (latest 15 commits)
                    titles = await System.Threading.Tasks.Task.Run(
                        () => BuildConsole.Services.VersionInfo.GetCommitsRange(0, 15));
                }

                _whatsNewTitles = titles;
                _whatsNewVersion = BuildConsole.Services.VersionInfo.Format(current);
                _whatsNewMore = 0;
                _whatsNewReady = true;

                if (current > lastSeen)
                {
                    // Advance last-seen now (once computed) so this set won't re-show next launch.
                    settings.LastSeenBuild = current;
                    settings.Save();
                }

                // Render into the Home tab if it's currently open (it is at launch).
                if (_homeView != null)
                    _homeView.RenderWhatsNew(_whatsNewVersion, _whatsNewTitles, _whatsNewMore, _whatsNewLastSeen, _whatsNewCurrent);
            }
            catch { /* pure display feature — never let a git/settings hiccup disturb launch */ }
        }

        /// <summary>
        /// Git #851/#874 — resolve the chat linked to a GitHub issue (via
        /// LeftSidebar's already-fetched board data) and open/focus its tab.
        /// Shared by the Build Queue panel's In-Flight rows (#851) and the Home
        /// screen's Running/Done rows (#874) — one path, reusing OpenChatTab.
        /// </summary>
        private void OpenChatForIssue(int githubNumber)
        {
            var chat = LeftSidebar.FindChatForIssue(githubNumber);
            if (chat == null)
            {
                ToastEngine.Warning("Open Chat", $"No chat linked to #{githubNumber} yet.");
                return;
            }
            OpenChatTab(chat, githubNumber);
        }

        /// <param name="selectTab">Git #1636 — when false, a newly-created tab is added to
        /// <see cref="EditorTabs"/> but never focused, and an already-open tab is left exactly
        /// where it is (not jumped to) — the "background tab, never navigating away" behavior the
        /// Priority Build Set completion toast's chat link needs. Every existing caller omits this
        /// and keeps the original always-select behavior.</param>
        private void OpenChatForQueueItem(BuildConsole.Services.QueueItem item, bool selectTab = true)
        {
            // 0. Try resolving by OriginatingChatId
            if (!string.IsNullOrWhiteSpace(item.OriginatingChatId))
            {
                var matchByConv = LeftSidebar.CurrentBoardChats?.FirstOrDefault(c =>
                    string.Equals(c.ConversationId, item.OriginatingChatId, StringComparison.OrdinalIgnoreCase));
                if (matchByConv != null)
                {
                    OpenChatTab(matchByConv, item.GithubNumber ?? matchByConv.IssueGithubNumber, selectTab);
                    return;
                }
            }

            // 1. Try resolving chat URL from ChatUrlStore
            string? url = BuildConsole.Services.ChatUrlStore.GetChatUrl(item.Id, item.GithubNumber);
            if (string.IsNullOrWhiteSpace(url))
            {
                url = item.ChatUrl;
            }

            if (!string.IsNullOrWhiteSpace(url))
            {
                OpenChatUrl(url, item.Title, item.GithubNumber, selectTab);
                return;
            }

            // 2. Fall back to resolving chat by GitHub issue number via LeftSidebar
            if (item.GithubNumber.HasValue)
            {
                var chat = LeftSidebar.FindChatForIssue(item.GithubNumber.Value);
                if (chat != null)
                {
                    OpenChatTab(chat, item.GithubNumber.Value, selectTab);
                    return;
                }
            }

            // 3. Fall back to search for matching title in LeftSidebar's board chats
            var fallbackChat = LeftSidebar.CurrentBoardChats?.FirstOrDefault(c =>
                (item.GithubNumber.HasValue && c.IssueGithubNumber == item.GithubNumber.Value) ||
                (!string.IsNullOrEmpty(c.Title) && item.Title.Contains(c.Title, StringComparison.OrdinalIgnoreCase)));
            if (fallbackChat != null)
            {
                OpenChatTab(fallbackChat, item.GithubNumber ?? fallbackChat.IssueGithubNumber, selectTab);
                return;
            }

            ToastEngine.Warning("Open Chat", $"No Claude chat found for build '{item.Title}'.");
        }

        /// <summary>Git #1636 — resolves and opens the given build set's most-recently-active
        /// chat's tab in the background (never selecting it / never navigating Shane away from
        /// whatever he's currently looking at). "Most recently active" = the member with the
        /// latest UpdatedAt, per the issue's stated assumption for sets spanning several chats.</summary>
        public void OpenBuildSetChatInBackground(IReadOnlyList<BuildConsole.Services.QueueItem> members)
        {
            var candidate = members
                .OrderByDescending(i => i.UpdatedAt ?? DateTimeOffset.MinValue)
                .FirstOrDefault();
            if (candidate == null) return;
            OpenChatForQueueItem(candidate, selectTab: false);
        }

        private void OnBuildSetPriorityCompleted(BuildConsole.Controls.BuildSetPriorityCompletedEventArgs e)
        {
            ToastEngine.ShowPersistent(
                "⭐ Priority build set finished",
                $"“{e.BuildSetName}” — every build has reached a terminal state. Click to open its chat.",
                ToastKind.Success,
                onClick: () => OpenBuildSetChatInBackground(e.Items));
        }

        public void OpenChatUrl(string url, string? title = null, int? githubNumber = null, bool selectTab = true)
        {
            if (string.IsNullOrWhiteSpace(url)) return;
            url = url.Trim();
            string convId = ExtractConversationId(url);

            // 1. If tab is already open in any pane, activate and focus it (unless selectTab is
            // false — Git #1636's background-tab open must leave an already-open tab right where
            // it is too, not just skip re-selecting a freshly-created one).
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Key.Tag is BuildConsole.Services.BoardChat existing &&
                    (existing.ConversationId == convId || (!string.IsNullOrEmpty(existing.ClaudeUrl) && existing.ClaudeUrl.TrimEnd('/') == url.TrimEnd('/'))))
                {
                    if (selectTab)
                    {
                        var parentTabControl = kvp.Key.Parent as TabControl ?? EditorTabs;
                        parentTabControl.SelectedItem = kvp.Key;
                    }
                    return;
                }
            }

            // 2. Check if LeftSidebar already knows this chat
            var knownChat = LeftSidebar.CurrentBoardChats?.FirstOrDefault(c => c.ConversationId == convId || (!string.IsNullOrEmpty(c.ClaudeUrl) && c.ClaudeUrl.TrimEnd('/') == url.TrimEnd('/')));
            if (knownChat != null)
            {
                OpenChatTab(knownChat, githubNumber ?? knownChat.IssueGithubNumber, selectTab);
                return;
            }

            // 3. Create fresh BoardChat instance and open tab
            var newChat = new BuildConsole.Services.BoardChat
            {
                ConversationId = convId,
                Title = title ?? (githubNumber.HasValue ? $"#{githubNumber.Value} Chat" : "Claude Chat"),
                ClaudeUrl = url,
                IssueGithubNumber = githubNumber
            };
            OpenChatTab(newChat, githubNumber, selectTab);
        }

        private static string ExtractConversationId(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return Guid.NewGuid().ToString();
            try
            {
                var uri = new Uri(url);
                var segments = uri.AbsolutePath.Trim('/').Split('/');
                var last = segments.LastOrDefault();
                if (!string.IsNullOrWhiteSpace(last) && last != "chat")
                {
                    return last;
                }
            }
            catch { }
            return Guid.NewGuid().ToString();
        }

        public FrameworkElement BuildChatWebViewWrapped(BuildConsole.Services.BoardChat chat)
        {
            var wv = BuildChatWebView(chat);
            return CreateChatContextWrapper(wv);
        }

        /// <summary>
        /// Local #47 — resolve the Claude chat linked to a child issue and return a
        /// ready-to-host chat WebView2 wrapper for the immersive Focus view's OWN centre panel.
        /// Returns null (and toasts) when no chat is linked yet, so the immersive view can
        /// fall back to its own calm empty state. Crucially this does NOT touch the normal
        /// tab bar and does NOT exit immersive mode — that exit-then-open-in-main-tabs
        /// behaviour (via OpenChatForIssue) was the whole bug this fixes.
        /// </summary>
        public FrameworkElement? BuildImmersiveChatView(int githubNumber)
        {
            var chat = LeftSidebar.FindChatForIssue(githubNumber);
            if (chat == null)
            {
                ToastEngine.Warning("Open Chat", $"No chat linked to #{githubNumber} yet.");
                return null;
            }
            var wv = BuildChatWebView(chat);
            return CreateChatContextWrapper(wv);
        }

        /// <summary>Git #874 — "Where you left off" click: reconstruct the BoardChat identity from the persisted snapshot and open/focus it through the same OpenChatTab path (dedupes on ConversationId).</summary>
        private void Home_ResumeChatRequested(object? sender, BuildConsole.Services.PersistedChatTab p)
        {
            if (string.IsNullOrWhiteSpace(p.ClaudeUrl))
            {
                ToastEngine.Warning("Resume Chat", $"That saved chat has no Claude URL to reopen.\n\n\"{p.Title}\"");
                return;
            }
            var chat = new BuildConsole.Services.BoardChat
            {
                ConversationId = p.ConversationId,
                Title = p.Title,
                ClaudeUrl = p.ClaudeUrl,
                EpicId = p.EpicId,
                IssueGithubNumber = p.IssueGithubNumber,
            };
            OpenChatTab(chat, p.IssueGithubNumber);
        }

        /// <summary>
        /// Git #874 — feeds the Home view's live sections from the SAME source the
        /// Build Queue panel uses: the shared BuildTrackerApiClient queue (Running)
        /// and GitHubIssuesService open-issue awareness (Done, waiting for you). No
        /// second Build Queue is built — this reuses the one shared client. Gated on
        /// the Home tab actually being open, so a closed Home costs nothing; the
        /// open-issue set is refreshed on the panel's own ~60s cadence, not per tick.
        /// </summary>
        private async System.Threading.Tasks.Task RefreshHomeRollupAsync(bool force = false)
        {
            var home = _homeView;
            if (home == null) return; // Home tab closed — nothing to refresh

            List<BuildConsole.Services.QueueItem> running;
            List<BuildConsole.Services.QueueItem> doneWaiting;

            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
            {
                running = new();
                doneWaiting = new();
            }
            else
            {
                List<BuildConsole.Services.QueueItem> queue;
                try
                {
                    if (_queueDb != null)
                    {
                        queue = await _queueDb.GetQueueAsync();
                    }
                    else
                    {
                        queue = await _buildTrackerApi.GetQueueAsync();
                    }
                }
                catch { return; } // best-effort — keep whatever's already rendered

                // Manual-only GitHub (Shane, 2026-08-14): "Done, waiting for you"
                // needs the open-issue set (a `gh` CLI call). This USED to auto-
                // refresh every ~60s the whole time the Home tab was open — real,
                // recurring GitHub traffic on the shared 5,000/hr limit ("this app
                // is killing my git connections"). It now fetches ONLY on a force
                // refresh: opening the Home tab (OpenHomeTab passes force:true)
                // re-syncs it once, and that's the manual trigger for now. The
                // background 10s roll-up tick (force:false) still keeps the live
                // Running list fresh from the LOCAL dev-server queue, but no longer
                // touches GitHub. Logged on github.manual-refresh (attributable).
                if (force)
                {
                    try
                    {
                        _homeOpenIssueNumbers = await BuildConsole.Services.GitHubIssuesService.GetOpenIssueNumbersAsync();
                        BuildConsole.Services.ActivityLog.Log("github.manual-refresh",
                            $"Home 'Done, waiting for you' [Home-tab open/refresh]: {_homeOpenIssueNumbers.Count} open issue number(s) via gh CLI");

                        // Git #1469 — same manual-refresh moment promotes every queue row
                        // sitting in Verifying whose real GitHub issue has now closed to
                        // real Done. Reuses the open-issue set just fetched above — no
                        // extra `gh` call.
                        if (_queueDb != null)
                        {
                            var promoted = await _queueDb.PromoteVerifyingToDoneAsync(_homeOpenIssueNumbers);
                            if (promoted.Count > 0)
                            {
                                BuildConsole.Services.ActivityLog.Log("github.manual-refresh",
                                    $"Verifying → Done [Home-tab open/refresh]: {promoted.Count} queue item(s) — " +
                                    string.Join(", ", promoted.Select(p => $"#{p.Id} (GH #{p.GithubNumber})")));
                            }

                            // Git #2136 / #2486 — same manual-refresh moment reconciles any pre-
                            // dispatch row (Verifying AND still-queued) whose REAL board Status
                            // column moved (Shane parked / crashed / marked Done, or pulled a queued
                            // item back to Backlog). Git is the database; this is the #1867 fix.
                            await BuildConsole.Services.BoardStatusSync.ReconcileQueueAgainstBoardAsync(_queueDb, "Home-tab refresh");
                        }
                    }
                    catch { /* keep the last-known open-issue set */ }
                }

                if (_homeView != home) return; // tab closed/replaced while awaiting

                running = queue
                    .Where(i => i.Status == "running")
                    .OrderByDescending(i => i.UpdatedAt)
                    .ToList();
                doneWaiting = queue
                    .Where(i => i.Status == "done" && i.GithubNumber.HasValue && _homeOpenIssueNumbers.Contains(i.GithubNumber.Value))
                    .OrderByDescending(i => i.UpdatedAt)
                    .ToList();
            }

            // Skip the re-render (and its section-render logging) when nothing
            // changed since the last tick — same anti-flicker guard the panel uses.
            var signature = System.Text.Json.JsonSerializer.Serialize(new
            {
                r = running.Select(i => new { i.Id, i.Status, i.UpdatedAt }),
                d = doneWaiting.Select(i => new { i.Id, i.GithubNumber, i.UpdatedAt }),
            });
            if (!force && signature == _homeRollupSignature) return;
            _homeRollupSignature = signature;

            home.RenderRunning(running);
            home.RenderDoneWaiting(doneWaiting);
            home.RenderDashboardState(LeftSidebar.CurrentBoardIssues, LeftSidebar.CurrentMilestones);
            home.UpdateFocusState();
        }

        /// <summary>
        /// Git #874 — snapshots every open chat tab (real BoardChat identity + which
        /// of the four panes it's in) into BuildConsoleSettings, so next launch's
        /// Home "Where you left off" can reference it. Tracking only — nothing is
        /// auto-reopened. Called whenever a chat tab opens/closes or a tab is dragged
        /// between panes.
        /// </summary>
        private void PersistOpenChatTabs()
        {
            try
            {
                var panes = new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 };
                var list = new List<BuildConsole.Services.PersistedChatTab>();
                foreach (var (tab, state) in _chatTabs)
                {
                    if (tab.Tag is not BuildConsole.Services.BoardChat chat) continue;
                    int paneIndex = System.Array.IndexOf(panes, tab.Parent as TabControl);
                    if (paneIndex < 0) paneIndex = 0;
                    list.Add(new BuildConsole.Services.PersistedChatTab
                    {
                        ConversationId = chat.ConversationId,
                        Title = chat.Title,
                        ClaudeUrl = chat.ClaudeUrl,
                        EpicId = chat.EpicId,
                        IssueGithubNumber = state.GithubNumber ?? chat.IssueGithubNumber,
                        PaneIndex = paneIndex,
                        SavedAt = DateTime.Now,
                    });
                }
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                settings.OpenChatTabs = list;
                settings.Save();
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("home-screen", $"Persist open chat tabs failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Git #802 - polls the real queue (same endpoint BuildQueuePanel
        /// already polls) and, for every open chat tab, opens/updates/closes
        /// its build split pane based on whether a queue item with a matching
        /// githubNumber is running. Tails scripts/build-queue-watcher.ps1's
        /// per-item log file (BuildLogPaths.ForQueueItem) rather than spawning
        /// anything itself - the build stays entirely the queue/watcher's.
        /// </summary>
        private async System.Threading.Tasks.Task PollChatTabBuildStateAsync()
        {
            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured) return;
            // Git #942 — also run when there are no chat tabs but injected
            // buttons in the main Claude tab are still being tracked, so their
            // live status keeps updating; nothing to poll if BOTH are empty.
            if (_chatTabs.Count == 0 && _chatButtonStatus.Count == 0) return;

            List<BuildConsole.Services.QueueItem> queue;
            try
            {
                queue = _queueDb != null
                    ? await _queueDb.GetQueueAsync()
                    : await _buildTrackerApi.GetQueueAsync();
            }
            catch { return; }

            foreach (var (tab, state) in _chatTabs.ToList())
            {
                if (state.GithubNumber == null) continue;

                var match = queue.FirstOrDefault(q => q.GithubNumber == state.GithubNumber && q.Status == "running");
                if (match == null)
                {
                    if (state.BuildColumn.Width.Value > 0)
                    {
                        state.BuildColumn.Width = new GridLength(0);
                        state.TailingQueueItemId = null;
                        state.TailedLength = 0;
                    }
                    continue;
                }

                if (state.BuildColumn.Width.Value == 0)
                {
                    state.BuildColumn.Width = new GridLength(420);
                }
                if (state.TailingQueueItemId != match.Id)
                {
                    state.TailingQueueItemId = match.Id;
                    state.TailedLength = 0;
                    state.BuildOutputBox.Text = "";
                    state.BuildStatusText.Text = $"▶ Building: {match.Title}";
                }

                TailBuildLog(state);
            }

            // Git #942 — reuse this same poll's queue snapshot (no second
            // poller) to drive the injected chat buttons' live labels.
            PushChatButtonStatuses(queue);
        }

        /// <summary>
        /// Git #942 — for every currently-tracked button-to-queue-id mapping,
        /// maps the real queue item's status to a label and, only on an actual
        /// transition, logs it on chat-button.status and pushes it into that
        /// specific injected DOM button (found by its data-bt-queue-id).
        /// Tracking is dropped the instant an item reaches a terminal state
        /// (done/failed/canceled) or vanishes from the queue, so nothing is
        /// polled forever: a "Failed: Retry" button keeps its clickable label
        /// in the DOM (its own click handler re-queues), and that retry re-adds
        /// tracking under the new id back in ChatWv_WebMessageReceived.
        /// </summary>
        private void PushChatButtonStatuses(List<BuildConsole.Services.QueueItem> queue)
        {
            if (_chatButtonStatus.Count == 0) return;
            foreach (var id in _chatButtonStatus.Keys.ToList())
            {
                var item = queue.FirstOrDefault(q => q.Id == id);
                if (item == null)
                {
                    // Row is gone (e.g. canceled + deleted) — stop tracking and
                    // leave the button's last rendered label untouched.
                    _chatButtonStatus.Remove(id);
                    continue;
                }

                var interactiveState = _queueWatcher?.GetInteractiveState(id);
                bool isWaitingForInput = interactiveState == BuildConsole.Services.InteractiveInputState.WaitingForInput;

                string label, mode;
                bool terminal;

                if (isWaitingForInput)
                {
                    label = "❓ Ask Question";
                    mode = "waiting";
                    terminal = false; // still active and waiting for Shane's answer!
                }
                else
                {
                    switch (item.Status)
                    {
                        case "done":     label = "Done";           mode = "done";     terminal = true;  break;
                        case "failed":
                        case "canceled": label = "Failed: Retry";  mode = "failed";   terminal = true;  break;
                        // Git #1638 — a parked row is staged, not running; keep tracking it
                        // (terminal=false) so the label updates the moment it's un-parked, but
                        // don't show the "In Progress..." label the default case below would.
                        case "parked":   label = "📥 Parked";      mode = "parked";   terminal = false; break;
                        // Git #1989 — a capped row is parked by the Conservation Cap, not
                        // running; same terminal=false shape as "parked" above so the label
                        // updates the moment it's overridden/drained, without showing the
                        // misleading "In Progress..." default.
                        case BuildConsole.Services.AccountCapPolicy.CappedStatus: label = "Capped";        mode = "capped";   terminal = false; break;
                        case "queued":
                        case "running":
                        default:         label = "In Progress..."; mode = "progress"; terminal = false; break;
                    }
                }

                if (_chatButtonStatus[id] != label)
                {
                    BuildConsole.Services.ActivityLog.Log("chat-button.status",
                        $"queue #{id} ({item.Title}): {_chatButtonStatus[id]} -> {label} (status={item.Status}, waiting={isWaitingForInput})");
                    _chatButtonStatus[id] = label;
                    _ = PushChatButtonLabelAsync(id, label, mode);
                }

                if (terminal) _chatButtonStatus.Remove(id);
            }
        }

        /// <summary>Git #942 — pushes one button's new label into every injected claude.ai WebView (the main Claude tab + each open chat tab). __btApplyStatus finds the specific element by data-bt-queue-id and no-ops where it isn't present, so broadcasting is safe and saves having to track which tab holds the button.</summary>
        private System.Threading.Tasks.Task PushChatButtonLabelAsync(int queueId, string label, string mode)
            => RunScriptInAllChatWebViewsAsync($"window.__btApplyStatus && window.__btApplyStatus({queueId}, {JsLiteral(label)}, {JsLiteral(mode)});");

        /// <summary>Git #942 — runs a snippet in ClaudeWebView and every open chat tab's WebView (all the views ChatButtonInjector's script was injected into). Each is guarded independently so one view mid-navigation/teardown can't stop the rest.</summary>
        private async System.Threading.Tasks.Task RunScriptInAllChatWebViewsAsync(string js)
        {
            var views = new List<Microsoft.Web.WebView2.Wpf.WebView2>();
            if (ClaudeWebView?.CoreWebView2 != null) views.Add(ClaudeWebView);
            foreach (var st in _chatTabs.Values)
                if (st.WebView?.CoreWebView2 != null) views.Add(st.WebView);
            foreach (var wv in views)
            {
                try { await wv.CoreWebView2.ExecuteScriptAsync(js); }
                catch { /* a view mid-navigation/teardown just isn't a valid target this tick */ }
            }
        }

        /// <summary>Git #942 — a JS string literal safe to interpolate into ExecuteScriptAsync; JSON string encoding covers quotes/backslashes/newlines.</summary>
        private static string JsLiteral(string s) => System.Text.Json.JsonSerializer.Serialize(s);

        /// <summary>
        /// Git #2691 point 3 — re-resolves and re-pushes mention-span colors for every #NNN
        /// <see cref="Services.LiveMentionNumberRegistry"/> has ever seen on screen, on every
        /// <see cref="Controls.BuildQueuePanel.QueueRefreshed"/> tick (the panel's own real ~15s
        /// poll, no new polling loop here). Broadcasts to ClaudeWebView + every embedded chat tab
        /// via the existing #942 broadcast helper, plus the floating chat window's own tabs — a
        /// number a given page doesn't currently have a live span for is simply a no-op
        /// (__btSetMentionColors only touches spans that exist), so over-broadcasting is safe.
        /// </summary>
        private async System.Threading.Tasks.Task PushLiveMentionColorsAsync()
        {
            var numbers = BuildConsole.Services.LiveMentionNumberRegistry.Snapshot();
            if (numbers.Count == 0) return;

            string? js;
            try
            {
                js = BuildConsole.Services.ChatMentionPopupHelper.BuildSetMentionColorsScript(numbers, LeftSidebar);
            }
            catch { return; }
            if (js == null) return;

            await RunScriptInAllChatWebViewsAsync(js);
            if (_floatingChatWindow != null) await _floatingChatWindow.RefreshAllMentionColorsAsync(js);
        }

        /// <summary>
        /// Git #1421 — every 3s (same interval as PollChatTabBuildStateAsync above),
        /// reads the local dev-server checkout's own git state directly
        /// (LocalDeployStatusService) and treats a changed commitHash from the last
        /// one this app has seen as "deploy complete". No HTTP call to the local Dev
        /// api-server — this used to poll GET /api/internal/deploy-status (#805), which
        /// required that server to be running just to answer "what commit is currently
        /// deployed"; Shane: "it should not even be reading the API anymore... I don't
        /// have to have it running all the time." The first successful poll after
        /// startup only seeds the baseline - it deliberately does NOT fire a "deploy
        /// complete" line, since there was no prior deploy this app watched to compare
        /// against.
        /// </summary>
        private async System.Threading.Tasks.Task PollDeployStatusAsync()
        {
            BuildConsole.Services.DeployStatus? status;
            try
            {
                status = await System.Threading.Tasks.Task.Run(
                    () => BuildConsole.Services.LocalDeployStatusService.GetLocalDeployStatus());
            }
            catch (Exception ex)
            {
                ReportDeployStatus(ex.Message);
                return;
            }

            if (status == null || string.IsNullOrWhiteSpace(status.CommitHash))
            {
                ReportDeployStatus(
                    $"local dev-server checkout not found at {BuildConsole.Services.LocalDeployStatusService.ResolveServerWorktree()} — has it been bootstrapped (scripts/dev-server/bootstrap-server.mjs)?");
                return;
            }

            if (_lastSeenDeployCommitHash != null && _lastSeenDeployCommitHash != status.CommitHash)
            {
                BuildConsole.Services.ActivityLog.Log("deploy",
                    $"Deploy complete: {_lastSeenDeployCommitHash} -> {status.CommitHash} ({status.Timestamp})");
                DeployStatusText.Text = $"Deploy: {status.CommitHash} (complete)";
            }
            else
            {
                DeployStatusText.Text = $"Deploy: {status.CommitHash}";
            }

            _lastSeenDeployCommitHash = status.CommitHash;
            DeployDot.Fill = DotReady;
        }

        private void ReportDeployStatus(string error)
        {
            DeployDot.Fill = DotError;
            DeployStatusText.Text = $"Deploy sync error: {error}";
            BuildConsole.Services.ActivityLog.Log("deploy", $"FAILED: {error}");

            // Proactively wake Replit via SSH / watcher if dev server is asleep or returned 502 / unreachable
            if (_replitWatcher != null && (error.Contains("502") || error.Contains("unreachable") || error.Contains("dev server")))
            {
                _ = _replitWatcher.CheckNowAndWakeIfDownAsync();
            }
        }

        /// <summary>Git #902 — renders the Replit idle watcher's live state in the status bar (dot + short text), with last-check / last-intervention times on the tooltip. Runs on the UI thread; the service raises this from UI-thread continuations already, but guard anyway.</summary>
        private void ReplitWatcher_StatusChanged(BuildConsole.Services.ReplitWatcherStatus status)
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(() => ReplitWatcher_StatusChanged(status)));
                return;
            }

            ReplitDot.Fill = status.State switch
            {
                BuildConsole.Services.ReplitWatcherState.Monitoring => DotReady,
                BuildConsole.Services.ReplitWatcherState.Checking => DotLoading,
                BuildConsole.Services.ReplitWatcherState.GracePeriod => DotLoading,
                BuildConsole.Services.ReplitWatcherState.Waking => DotLoading,
                BuildConsole.Services.ReplitWatcherState.Error => DotError,
                _ => (Brush)FindResource("Surface2Brush"), // Disabled
            };

            ReplitStatusText.Text = $"Replit: {status.Message}";

            var tip = new System.Text.StringBuilder();
            tip.Append("Replit idle watcher");
            tip.Append(status.LastCheck.HasValue ? $"\nLast check: {status.LastCheck:HH:mm:ss}" : "\nLast check: —");
            tip.Append(status.LastIntervention.HasValue ? $"\nLast wake: {status.LastIntervention:yyyy-MM-dd HH:mm:ss}" : "\nLast wake: never");
            tip.Append("\n\nClick to check status and turn Replit on if down.");
            ReplitStatusText.ToolTip = tip.ToString();
        }

        private async void BtnReplitRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (_replitWatcher == null) return;
            BtnReplitRefresh.IsEnabled = false;
            try
            {
                await _replitWatcher.CheckNowAndWakeIfDownAsync();
            }
            finally
            {
                BtnReplitRefresh.IsEnabled = true;
            }
        }

        private void ReplitStatus_Click(object sender, MouseButtonEventArgs e)
        {
            BtnReplitRefresh_Click(sender, e);
        }

        /// <summary>
        /// Git #1417 — polls the real local PostgreSQL Windows service (via
        /// PostgresServiceMonitor, System.ServiceProcess.ServiceController under
        /// the hood) and renders dot + text + a "Start" action in the status bar.
        /// The Start button is only shown when the service is genuinely down
        /// (Stopped/NotFound/Unknown) — never for Running/pending states.
        /// </summary>
        private async System.Threading.Tasks.Task RefreshPostgresStatusAsync()
        {
            BuildConsole.Services.PostgresServiceStatus status;
            try
            {
                status = await BuildConsole.Services.PostgresServiceMonitor.CheckAsync();
            }
            catch (Exception ex)
            {
                status = new BuildConsole.Services.PostgresServiceStatus
                {
                    State = BuildConsole.Services.PostgresServiceState.Unknown,
                    Summary = $"Error checking service: {ex.Message}",
                    Details = ex.ToString(),
                };
            }

            _lastPostgresStatus = status;
            RenderPostgresStatus(status);
        }

        private void RenderPostgresStatus(BuildConsole.Services.PostgresServiceStatus status)
        {
            PostgresDot.Fill = status.State switch
            {
                BuildConsole.Services.PostgresServiceState.Running => DotReady,
                BuildConsole.Services.PostgresServiceState.StartPending => DotLoading,
                BuildConsole.Services.PostgresServiceState.StopPending => DotLoading,
                BuildConsole.Services.PostgresServiceState.Stopped => DotError,
                BuildConsole.Services.PostgresServiceState.NotFound => (Brush)FindResource("Surface2Brush"),
                _ => DotError,
            };

            string label = status.State switch
            {
                BuildConsole.Services.PostgresServiceState.Running => $"Postgres: up ({status.ServiceName})",
                BuildConsole.Services.PostgresServiceState.StartPending => "Postgres: starting…",
                BuildConsole.Services.PostgresServiceState.StopPending => "Postgres: stopping…",
                BuildConsole.Services.PostgresServiceState.Stopped => $"Postgres: DOWN ({status.ServiceName})",
                BuildConsole.Services.PostgresServiceState.NotFound => "Postgres: service not found",
                _ => $"Postgres: {status.Summary}",
            };
            PostgresStatusText.Text = label;
            PostgresStatusText.ToolTip = $"{status.Details}\n\nClick to re-check now.";

            bool canOfferStart = status.State == BuildConsole.Services.PostgresServiceState.Stopped
                || status.State == BuildConsole.Services.PostgresServiceState.Unknown;
            BtnPostgresStart.Visibility = canOfferStart ? Visibility.Visible : Visibility.Collapsed;
        }

        private void PostgresStatus_Click(object sender, MouseButtonEventArgs e)
        {
            _ = RefreshPostgresStatusAsync();
        }

        /// <summary>
        /// Git #1417 — the one-click "Start" action. Invokes the real Windows
        /// service-control start (PostgresServiceMonitor.StartAsync), which
        /// re-checks the actual service state afterward before reporting success
        /// — never assumes Start() succeeding means the DB is genuinely up.
        /// Surfaces an elevation failure with a clear, actionable message rather
        /// than failing silently.
        /// </summary>
        private async void BtnPostgresStart_Click(object sender, RoutedEventArgs e)
        {
            string? serviceName = _lastPostgresStatus?.ServiceName;
            if (string.IsNullOrWhiteSpace(serviceName))
            {
                // NotFound/never-checked — re-check once to try to resolve a real name first.
                await RefreshPostgresStatusAsync();
                serviceName = _lastPostgresStatus?.ServiceName;
            }
            if (string.IsNullOrWhiteSpace(serviceName))
            {
                BuildConsole.Services.ActivityLog.Log("system.health", "Postgres Start clicked but no service name resolved — nothing to start.");
                return;
            }

            BtnPostgresStart.IsEnabled = false;
            PostgresStatusText.Text = "Postgres: starting…";
            PostgresDot.Fill = DotLoading;
            try
            {
                var (success, message) = await BuildConsole.Services.PostgresServiceMonitor.StartAsync(serviceName);
                if (!success)
                {
                    PostgresStatusText.Text = $"Postgres: start failed — {message}";
                    PostgresStatusText.ToolTip = message;
                    PostgresDot.Fill = DotError;
                    BuildConsole.Services.ActivityLog.Log("system.health", $"Postgres start FAILED: {message}");
                }
            }
            finally
            {
                await RefreshPostgresStatusAsync();
                BtnPostgresStart.IsEnabled = true;
            }
        }

        /// <summary>Refresh icon next to the usage status text — triggers an immediate manual poll instead of waiting for the next scheduled cycle (Shane reports the automatic poll only lands ~25% of the time). Reuses the exact same polling logic as the timer via ClaudeUsageMeterService.ManualRefreshAsync; the service's own Polling-state emit (dot turns amber, "Checking claude.ai…" tooltip) is the in-progress feedback, so a click is never silent. Button is disabled for the duration so repeat clicks can't stack polls.</summary>
        private async void BtnUsageRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (_usageMeter == null) return;
            BtnUsageRefresh.IsEnabled = false;
            BtnWeeklyUsageRefresh.IsEnabled = false;
            BtnSecondaryWeeklyUsageRefresh.IsEnabled = false;
            try
            {
                await _usageMeter.ManualRefreshAsync();
            }
            finally
            {
                BtnUsageRefresh.IsEnabled = true;
                BtnWeeklyUsageRefresh.IsEnabled = true;
                BtnSecondaryWeeklyUsageRefresh.IsEnabled = true;
            }
        }

        /// <summary>Shared by both the Primary and Secondary weekly refresh icons — a single
        /// ManualRefreshAsync polls both accounts in the same cycle (see PollSecondaryAsync inside
        /// ClaudeUsageMeterService.TickAsync, Git #1437), so either button refreshes both meters.</summary>
        private async void BtnWeeklyUsageRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (_usageMeter == null) return;
            BtnUsageRefresh.IsEnabled = false;
            BtnWeeklyUsageRefresh.IsEnabled = false;
            BtnSecondaryWeeklyUsageRefresh.IsEnabled = false;
            try
            {
                await _usageMeter.ManualRefreshAsync();
            }
            finally
            {
                BtnUsageRefresh.IsEnabled = true;
                BtnWeeklyUsageRefresh.IsEnabled = true;
                BtnSecondaryWeeklyUsageRefresh.IsEnabled = true;
            }
        }

        /// <summary>Renders the Claude usage meter's live state in the status bar (dot + text + tooltip). The service computes DisplayText/ToolTip fully, so this just paints them and maps the state to a dot colour. Runs on the UI thread; the service raises this from UI-thread timer continuations already, but guard anyway.</summary>
        private void UsageMeter_StatusChanged(BuildConsole.Services.ClaudeUsageStatus status)
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(() => UsageMeter_StatusChanged(status)));
                return;
            }

            Brush dotBrush = status.State switch
            {
                BuildConsole.Services.ClaudeUsageMeterState.Ok => DotReady,
                BuildConsole.Services.ClaudeUsageMeterState.Polling => DotLoading,
                BuildConsole.Services.ClaudeUsageMeterState.Error => DotError,
                _ => (Brush)FindResource("Surface2Brush"), // Unavailable — muted
            };

            UsageDot.Fill = dotBrush;
            UsageStatusText.Text = status.DisplayText;
            UsageStatusText.ToolTip = status.ToolTip;

            WeeklyUsageDot.Fill = dotBrush;
            WeeklyUsageStatusText.Text = status.WeeklyDisplayText;
            WeeklyUsageStatusText.ToolTip = status.WeeklyToolTip;

            // Git #1437 — Secondary account's dot/text/tooltip are driven entirely by its own
            // independent SecondaryState/SecondaryWeeklyDisplayText/SecondaryWeeklyToolTip, never
            // by the Primary dotBrush/DisplayText above — the two meters must be able to disagree
            // (e.g. Primary at 96% while Secondary still has headroom).
            Brush secondaryDotBrush = !status.SecondaryConfigured
                ? (Brush)FindResource("Surface2Brush")
                : status.SecondaryState switch
                {
                    BuildConsole.Services.ClaudeUsageMeterState.Ok => DotReady,
                    BuildConsole.Services.ClaudeUsageMeterState.Polling => DotLoading,
                    BuildConsole.Services.ClaudeUsageMeterState.Error => DotError,
                    _ => (Brush)FindResource("Surface2Brush"), // Unavailable / not configured — muted
                };
            SecondaryWeeklyUsageDot.Fill = secondaryDotBrush;
            SecondaryWeeklyUsageStatusText.Text = status.SecondaryWeeklyDisplayText;
            SecondaryWeeklyUsageStatusText.ToolTip = status.SecondaryWeeklyToolTip;

            // Git #1989 — the Conservation Cap toggle's own adjacent usage readout: the
            // primary account's real weekly percent + reset countdown (the same numbers
            // already polled above for the status bar, matching the real scenario the
            // toggle exists for — "90% consumed hours before the primary account's 9pm
            // reset"). "Do surface those numbers beside the toggle so the decision is
            // informed" — that adjacency is the point.
            TopConservationUsageText.Text = status.WeeklyPercent.HasValue
                ? $"{status.WeeklyPercent.Value}% used" + (status.WeeklyResetTarget.HasValue
                    ? $" · resets {BuildConsole.Services.ClaudeUsageMeterService.FormatCountdown(status.WeeklyResetTarget.Value - DateTime.Now)}"
                    : "")
                : "";
            TopConservationUsageText.ToolTip = status.WeeklyToolTip;

            // Git #2003 — feed the real per-account reading to the automation service, which runs
            // the auto-conservation state machine (engage/release with hysteresis, fail-closed on a
            // stale/errored reading) and drives the account-routing decision the watcher consults at
            // launch. Its Changed event (wired at construction) repaints the Conservation toggle and
            // the automation status text below when it acts.
            BuildConsole.Services.UsageAutomationService.Instance.OnMeterStatus(status);
            RefreshTopAutomationUi();

            // Feed the SAME real meter reading into the startup splash's "Claude usage"
            // row (no-op once that row has already settled — the meter keeps polling for
            // the status bar long after launch).
            _startupConnectivity?.ReportUsageMeter(status);
        }

        // ── Claude Online Status (source: status.anthropic.com) ─────────────────
        private void ClaudeOnlineService_StatusChanged(object? sender, BuildConsole.Services.ClaudeStatusInfo info)
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(() => ClaudeOnlineService_StatusChanged(sender, info)));
                return;
            }

            ClaudeOnlineDot.Fill = info.Health switch
            {
                BuildConsole.Services.ClaudeStatusHealth.Operational => DotReady,
                BuildConsole.Services.ClaudeStatusHealth.Minor => DotLoading,
                BuildConsole.Services.ClaudeStatusHealth.Major => DotError,
                _ => (Brush)FindResource("Surface2Brush")
            };

            ClaudeOnlineStatusText.Text = info.Health switch
            {
                BuildConsole.Services.ClaudeStatusHealth.Operational => "Status: OK",
                BuildConsole.Services.ClaudeStatusHealth.Minor => "Status: Degraded",
                BuildConsole.Services.ClaudeStatusHealth.Major => "Status: Outage",
                _ => "Status: --"
            };

            ClaudeOnlineStatusText.ToolTip = $"Claude Service Health: {info.Description}\nIndicator: {info.Indicator}\nSource: {info.PageUrl}\nLast Checked: {info.CheckedAt:HH:mm:ss}\n\nClick to open status page";
        }

        private async void BtnClaudeOnlineRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (_claudeOnlineService == null) return;
            BtnClaudeOnlineRefresh.IsEnabled = false;
            try
            {
                await _claudeOnlineService.CheckStatusAsync();
            }
            finally
            {
                BtnClaudeOnlineRefresh.IsEnabled = true;
            }
        }

        private void ClaudeOnlineStatus_Click(object sender, MouseButtonEventArgs e)
        {
            string url = _claudeOnlineService?.CurrentStatus?.PageUrl ?? "https://status.anthropic.com/";
            OpenWebTab(url, "Claude Status", "\uE774");
        }

        // ── Animated startup loading overlay ────────────────────────────────────
        /// <summary>
        /// Builds the StartupOverlay's honest per-connection rows and starts the real
        /// launch-connection probes (Build Tracker board / in-flight / queue / deploy via
        /// the shared BuildTrackerApiClient, plus the observed Claude usage meter). Each
        /// connection updates its own row as it settles; once every connection reaches a
        /// terminal state (or the service's global cap fires), the overlay fades out and
        /// is removed from the visual tree so it costs nothing after launch. Called at the
        /// end of the constructor, after _buildTrackerApi + _usageMeter exist.
        /// </summary>
        private void InitializeStartupOverlayShell()
        {
            if (StartupOverlay == null) return;

            // #1882 — created with NO services here so it can be wired the instant the
            // window paints, before the heavy startup work runs. The probes that need
            // _buildTrackerApi / _replitWatcher / _queueDb are kicked off later, from
            // RunDeferredStartupAsync via _startupConnectivity.Start(...), once those
            // services exist. The static Connections list doesn't depend on them, so the
            // honest per-connection rows show (as "waiting…") from the very first frame.
            _startupConnectivity = new BuildConsole.Services.StartupConnectivityService();

            // Build one row per real connection, in order, before any probe reports in.
            StartupOverlay.Initialize(_startupConnectivity.Connections);

            // Per-connection repaint (marshals onto the UI thread itself).
            _startupConnectivity.ConnectionChanged += status => StartupOverlay.UpdateConnection(status);

            // Every real connection AND the shell-ready signal settled → "Ready!" + fade-out.
            _startupConnectivity.AllSettled += () => StartupOverlay.FadeOutAndDismiss();

            // Fade-out finished → drop the overlay from the tree entirely.
            StartupOverlay.DismissRequested += StartupOverlay_DismissRequested;
        }

        private void StartupOverlay_DismissRequested()
        {
            if (StartupOverlay == null) return;
            // Remove from the root Grid so it stops rendering/animating for good.
            if (StartupOverlay.Parent is Panel parent)
                parent.Children.Remove(StartupOverlay);
        }

        private static void TailBuildLog(ChatTabState state)
        {
            if (state.TailingQueueItemId == null) return;
            var path = BuildConsole.Services.BuildLogPaths.ForQueueItem(state.TailingQueueItemId.Value);
            try
            {
                if (!File.Exists(path)) return;
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (fs.Length <= state.TailedLength) return;
                fs.Seek(state.TailedLength, SeekOrigin.Begin);
                using var reader = new StreamReader(fs);
                string newText = reader.ReadToEnd();
                state.TailedLength = fs.Length;
                state.BuildOutputBox.AppendText(newText);
                state.BuildOutputBox.ScrollToEnd();
            }
            catch { /* file locked mid-write by the watcher - just retry next tick */ }
        }

        /// <summary>Git #1629 — the ONE shared claude.ai conversation-URL pattern (full
        /// 8-4-4-4-12 UUID). The old inline copies had drifted: OpenWebTab's was missing
        /// the fourth hyphen group and never matched a real conversation URL.</summary>
        private static readonly System.Text.RegularExpressions.Regex ClaudeChatUrlRegex =
            new(@"/chat/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})");

        /// <summary>Git #1629 — walks a tab's constructed content (panels / decorators /
        /// content controls, which exist whether or not WPF has realized the tab's visual
        /// tree) to find its hosted WebView2, so a tab's REAL current URL can be read even
        /// for tabs not opened through OpenChatTab and tabs that aren't currently selected.</summary>
        private static Microsoft.Web.WebView2.Wpf.WebView2? FindWebViewIn(object? root)
        {
            switch (root)
            {
                case Microsoft.Web.WebView2.Wpf.WebView2 wv:
                    return wv;
                case Panel panel:
                    foreach (var child in panel.Children)
                    {
                        var found = FindWebViewIn(child);
                        if (found != null) return found;
                    }
                    return null;
                case Decorator decorator:
                    return FindWebViewIn(decorator.Child);
                case ContentControl contentControl:
                    return FindWebViewIn(contentControl.Content);
                default:
                    return null;
            }
        }

        /// <summary>
        /// Git #1629 (root cause 1) — resolves the claude.ai conversation URL for ANY tab
        /// genuinely showing a chat, not just tabs whose Tag is typed BoardChat. Order
        /// matters: the live WebView2 source first (the truest current state — a plain web
        /// tab has only a bare string Tag, and any tab can navigate between conversations
        /// after opening), then the BoardChat.ClaudeUrl snapshot only when the tag is
        /// present. Null when the tab genuinely shows no conversation (e.g. a brand-new
        /// chat that hasn't sent its first message yet has no /chat/&lt;uuid&gt; URL).
        /// </summary>
        private string? TryGetChatUrlForTab(TabItem tab)
        {
            try
            {
                var wv = _chatTabs.TryGetValue(tab, out var state) ? state.WebView : FindWebViewIn(tab.Content);
                var src = wv?.Source?.ToString();
                if (!string.IsNullOrEmpty(src) && ClaudeChatUrlRegex.IsMatch(src)) return src;
            }
            catch { /* an uninitialized/disposed WebView2 just falls through to the Tag */ }

            if (tab.Tag is BuildConsole.Services.BoardChat chat && !string.IsNullOrEmpty(chat.ClaudeUrl))
                return chat.ClaudeUrl;
            return null;
        }

        /// <summary>Git #2663 — the open chat tab (across all four panes) whose BoardChat tag
        /// carries this conversation id, or null. Lets the shared resolver below refresh a
        /// chat's live URL even when the caller only knows the persisted conversation id
        /// (the sidebar card / immersive chip) and never held the tab itself.</summary>
        private TabItem? FindOpenChatTabByConversationId(string? conversationId)
        {
            if (string.IsNullOrWhiteSpace(conversationId)) return null;
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Key.Tag is BuildConsole.Services.BoardChat bc &&
                    string.Equals(bc.ConversationId, conversationId, StringComparison.OrdinalIgnoreCase))
                    return kvp.Key;
            }
            return null;
        }

        /// <summary>
        /// Git #2663 — the ONE conversation-identity resolver every "toggle In Progress"
        /// entry point shares (tab-header ⚡ bolt, tab right-click, sidebar card right-click,
        /// immersive chip, and the new Replace action). Reads the chat's REAL current identity
        /// live off its open tab's WebView2 URL (<see cref="TryGetChatUrlForTab"/> +
        /// <see cref="ClaudeChatUrlRegex"/>) so a tab that has navigated to a new conversation
        /// is marked as the chat it ACTUALLY shows — never a cached
        /// <c>BoardChat.ClaudeUrl</c> / <c>PersistedInProgressChat.ClaudeUrl</c> that went
        /// stale after the tab moved (the "marks the new chat, opens the old one" bug).
        ///
        /// <para>Two intents, one path: when the caller hands us the tab directly (the
        /// tab-header bolt / tab menu / Replace — "mark what THIS tab really shows"), the live
        /// URL is authoritative even if it moved past the cached id. When we only *find* the
        /// tab via the cached conversation id (the sidebar card / immersive chip operate on an
        /// already-known persisted chat), we keep that authoritative id and merely refresh its
        /// URL — so an unmark still matches the exact row it is removing. Falls back to the
        /// supplied cached values when no live URL resolves (chat not open, or a brand-new chat
        /// with no <c>/chat/&lt;uuid&gt;</c> URL yet); returns (null, null) only when nothing
        /// at all resolves.</para>
        /// </summary>
        public (string? conversationId, string? claudeUrl) ResolveChatIdentity(
            TabItem? tab, string? cachedConversationId, string? cachedClaudeUrl)
        {
            bool tabWasExplicit = tab != null;
            tab ??= FindOpenChatTabByConversationId(cachedConversationId);
            if (tab != null)
            {
                var liveUrl = TryGetChatUrlForTab(tab);
                if (!string.IsNullOrEmpty(liveUrl))
                {
                    var m = ClaudeChatUrlRegex.Match(liveUrl);
                    if (m.Success)
                    {
                        var liveCid = m.Groups[1].Value;
                        if (tabWasExplicit || string.IsNullOrEmpty(cachedConversationId))
                            return (liveCid, liveUrl);
                        // Found via the cached id — keep it authoritative, just refresh the URL.
                        return (cachedConversationId, liveUrl);
                    }
                }
            }
            return (string.IsNullOrEmpty(cachedConversationId) ? null : cachedConversationId,
                    string.IsNullOrEmpty(cachedClaudeUrl) ? null : cachedClaudeUrl);
        }

        /// <summary>Git #2663 — the ONE toggle path the tab-header bolt / sidebar card /
        /// immersive chip (and the new Replace action) share: resolve live identity via
        /// <see cref="ResolveChatIdentity"/>, then flip FocusModeService's In Progress mark.
        /// Returns the resolved conversation id, or null when nothing resolved (caller may
        /// warn). <see cref="MarkChatTabInProgressAsync"/> deliberately does NOT go through
        /// this wrapper — it resolves via the same <see cref="ResolveChatIdentity"/> helper but
        /// keeps its own gh-label / toast / tab-decoration work around the toggle.</summary>
        public string? ToggleChatInProgressResolved(TabItem? tab, string? cachedConversationId, string title, string? cachedClaudeUrl)
        {
            var (cid, url) = ResolveChatIdentity(tab, cachedConversationId, cachedClaudeUrl);
            if (string.IsNullOrEmpty(cid)) return null;
            BuildConsole.Services.FocusModeService.Instance.ToggleChatInProgress(cid, title, url);
            return cid;
        }

        /// <summary>Git #2663 — the selected chat tab across all four editor panes (primary
        /// wins), or null if no selected tab genuinely shows a claude.ai conversation. Backs
        /// the FocusModeBar chip's "Replace with active tab" action.</summary>
        private TabItem? GetActiveChatTab()
        {
            foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
            {
                if (pane.SelectedItem is TabItem sel && TryGetChatUrlForTab(sel) != null)
                    return sel;
            }
            return null;
        }

        /// <summary>Git #1629 — a tab's visible title text (icon TextBlock is child 0 in
        /// every header this app builds, so prefer the second), for chat rows created from
        /// tabs that have no BoardChat snapshot to take a title from.</summary>
        private static string TabTitleOf(TabItem tab)
        {
            if (tab.Header is Panel panel)
            {
                var tb = panel.Children.OfType<TextBlock>().Skip(1).FirstOrDefault()
                         ?? panel.Children.OfType<TextBlock>().FirstOrDefault();
                if (tb != null && !string.IsNullOrWhiteSpace(tb.Text)) return tb.Text;
            }
            return tab.Header?.ToString() ?? "Chat";
        }

        private void AttachTabContextMenu(TabItem tabItem, TabControl ownerTabControl)
        {
            var cm = new ContextMenu();

            // Git #893 — a tab can now be dragged into a DIFFERENT pane than
            // the one it was created in, so `ownerTabControl` captured here
            // at attach-time can go stale the moment that happens. Every
            // action below resolves the tab's REAL current owner at click
            // time instead (falling back to the captured one only for the
            // - impossible in practice, but harmless - case its Parent isn't
            // set at all).
            TabControl CurrentOwner() => tabItem.Parent as TabControl ?? ownerTabControl;

            // 0a. Chat actions (Git #1629, root cause 4) — previously only a tab whose Tag
            // was typed BoardChat got "Mark as In Progress" (and there was no tab-level
            // assign at all), so a plain claude.ai tab Shane browsed to himself had
            // neither. Both items are attached to EVERY tab and shown/hidden at menu-OPEN
            // time instead, because a plain web tab can navigate to a chat long after this
            // menu was attached — the decision must be made against the tab's current URL.
            var miInProgress = new MenuItem { Header = "⚡ Mark as In Progress" };
            miInProgress.Click += async (s, e) =>
                await MarkChatTabInProgressAsync(tabItem, tabItem.Tag as BuildConsole.Services.BoardChat);
            var miAssignIssue = new MenuItem { Header = "🔗 Assign to Issue..." };
            miAssignIssue.Click += async (s, e) => await AssignChatTabToIssueAsync(tabItem);
            // Git #1837 — starts a successor chat on the same epic, handing it a pointer
            // back to this conversation. Label carries the resolved epic number when one
            // is known; resolved fresh at cm.Opened (same reasoning as isChatTab above —
            // a tab's associated epic can become known long after the menu was attached).
            var miNewSuccessorChat = new MenuItem { Header = "🧵 Start a new chat on an Epic..." };
            miNewSuccessorChat.Click += (s, e) => StartSuccessorChat(tabItem);
            var chatActionsSeparator = new Separator();
            cm.Items.Add(miInProgress);
            cm.Items.Add(miAssignIssue);
            cm.Items.Add(miNewSuccessorChat);
            cm.Items.Add(chatActionsSeparator);
            cm.Opened += (s, e) =>
            {
                bool isChatTab = tabItem.Tag is BuildConsole.Services.BoardChat
                                 || _chatTabs.ContainsKey(tabItem)
                                 || TryGetChatUrlForTab(tabItem) != null;
                var visibility = isChatTab ? Visibility.Visible : Visibility.Collapsed;
                miInProgress.Visibility = visibility;
                miAssignIssue.Visibility = visibility;
                miNewSuccessorChat.Visibility = visibility;
                chatActionsSeparator.Visibility = visibility;

                if (isChatTab)
                {
                    var resolvedEpic = ResolveEpicNumberForTab(tabItem);
                    miNewSuccessorChat.Header = resolvedEpic.HasValue
                        ? $"🧵 Start a new chat on Epic #{resolvedEpic.Value}"
                        : "🧵 Start a new chat on an Epic...";
                }
            };

            // 0b. Rename Tab
            var miRename = new MenuItem { Header = "Rename Tab...", InputGestureText = "F2" };
            miRename.Click += (s, e) => RenameTab(tabItem);
            cm.Items.Add(miRename);
            cm.Items.Add(new Separator());

            // 1. Close
            var miClose = new MenuItem { Header = "Close", InputGestureText = "Ctrl+W" };
            miClose.Click += (s, e) => CloseTab(tabItem, CurrentOwner());
            cm.Items.Add(miClose);

            // 2. Close Others
            var miCloseOthers = new MenuItem { Header = "Close Others" };
            miCloseOthers.Click += (s, e) =>
            {
                var owner = CurrentOwner();
                var others = owner.Items.OfType<TabItem>().Where(t => t != tabItem).ToList();
                foreach (var t in others)
                {
                    CloseTab(t, owner);
                }
            };
            cm.Items.Add(miCloseOthers);

            // 3. Close to the Right
            var miCloseRight = new MenuItem { Header = "Close to the Right" };
            miCloseRight.Click += (s, e) =>
            {
                var owner = CurrentOwner();
                int idx = owner.Items.IndexOf(tabItem);
                if (idx >= 0)
                {
                    var itemsRight = owner.Items.OfType<TabItem>().Skip(idx + 1).ToList();
                    foreach (var t in itemsRight)
                    {
                        CloseTab(t, owner);
                    }
                }
            };
            cm.Items.Add(miCloseRight);

            // 4. Close Saved
            var miCloseSaved = new MenuItem { Header = "Close Saved" };
            miCloseSaved.Click += (s, e) =>
            {
                var owner = CurrentOwner();
                var savedTabs = owner.Items.OfType<TabItem>().Where(t => !(t.Tag?.ToString()?.EndsWith("*") ?? false)).ToList();
                foreach (var t in savedTabs)
                {
                    CloseTab(t, owner);
                }
            };
            cm.Items.Add(miCloseSaved);

            // 5. Close All
            var miCloseAll = new MenuItem { Header = "Close All" };
            miCloseAll.Click += (s, e) =>
            {
                var owner = CurrentOwner();
                var allTabs = owner.Items.OfType<TabItem>().ToList();
                foreach (var t in allTabs)
                {
                    CloseTab(t, owner);
                }
            };
            cm.Items.Add(miCloseAll);

            cm.Items.Add(new Separator());

            // 5b. Pin Tab — collapse this tab to the always-visible pinned strip,
            // keeping its WebView2 session alive off-screen (see MainWindow.PinnedTabs.cs).
            var miPin = new MenuItem { Header = "Pin Tab" };
            miPin.Click += (s, e) => PinTabFromMenu(tabItem);
            cm.Items.Add(miPin);

            // 5c. Shelve Tab — remove this tab from the bar but keep its content
            // genuinely alive off-screen (the SAME #972/#982 PinnedHostCanvas keep-alive
            // as Pin, generalized to any tab), browsable + restorable from the Shelf
            // activity-bar icon (see MainWindow.ShelvedTabs.cs).
            var miShelve = new MenuItem { Header = "Shelve Tab" };
            miShelve.Click += (s, e) => ShelveTabFromMenu(tabItem);
            cm.Items.Add(miShelve);

            cm.Items.Add(new Separator());

            // 6. Copy Path
            var miCopyPath = new MenuItem { Header = "Copy Path" };
            miCopyPath.Click += (s, e) =>
            {
                string path = tabItem.Tag?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(path))
                {
                    try { Clipboard.SetText(path); } catch { }
                }
            };
            cm.Items.Add(miCopyPath);

            // 7. Open in Explorer
            var miOpenExplorer = new MenuItem { Header = "Open in Explorer" };
            miOpenExplorer.Click += (s, e) =>
            {
                string path = tabItem.Tag?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(path))
                {
                    try
                    {
                        if (File.Exists(path))
                        {
                            System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{path}\"");
                        }
                        else if (Directory.Exists(path))
                        {
                            System.Diagnostics.Process.Start("explorer.exe", $"\"{path}\"");
                        }
                        else if (Uri.TryCreate(path, UriKind.Absolute, out var uri))
                        {
                            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });
                        }
                    }
                    catch { }
                }
            };
            cm.Items.Add(miOpenExplorer);

            cm.Items.Add(new Separator());

            // 8. Pop Out Tab
            var miPopOut = new MenuItem { Header = "↗️ Pop Out Window" };
            miPopOut.Click += (s, e) => PopOutTab(tabItem, CurrentOwner());
            cm.Items.Add(miPopOut);

            if (tabItem.Header is FrameworkElement feHeader)
            {
                feHeader.ContextMenu = cm;
            }
        }

        private void PopOutTab(TabItem tabItem, TabControl ownerTab)
        {
            if (tabItem == null) return;

            // Extract the Content of the tab
            var content = tabItem.Content as UIElement;
            if (content == null) return;

            // Remove it from the tab
            tabItem.Content = null;

            // Get the title string from the tab header
            string title = "Popped Out Window";
            if (tabItem.Header is string strHeader)
            {
                title = strHeader;
            }
            else if (tabItem.Header is Panel headerPanel)
            {
                var textBlocks = headerPanel.Children.OfType<TextBlock>().ToList();
                if (textBlocks.Count > 1)
                {
                    title = textBlocks[1].Text;
                }
                else if (textBlocks.Count > 0)
                {
                    title = textBlocks[0].Text;
                }
            }

            // Create a new window to host the content
            var popWindow = new Window
            {
                Title = title,
                Width = 950,
                Height = 680,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Background = (Brush)FindResource("BaseBrush"),
                Content = content
            };

            // Close/Remove the tab item from the TabControl
            ownerTab.Items.Remove(tabItem);

            // When closing the popout window, restore the content back as a tab
            popWindow.Closed += (s, e) =>
            {
                if (this.IsLoaded)
                {
                    popWindow.Content = null; // Unparent content from the popped-out window
                    tabItem.Content = content; // Re-assign content back to the tab item

                    ownerTab.Items.Add(tabItem);
                    ownerTab.SelectedItem = tabItem;
                }
            };

            popWindow.Show();
        }

        public void RenameTab(TabItem tabItem)
        {
            string currentTitle = "";
            TextBlock? titleBlock = null;
            if (tabItem.Header is Panel panel)
            {
                titleBlock = panel.Children.OfType<TextBlock>().Skip(1).FirstOrDefault()
                             ?? panel.Children.OfType<TextBlock>().FirstOrDefault();
                if (titleBlock != null) currentTitle = titleBlock.Text;
            }
            else if (tabItem.Header is TextBlock tb)
            {
                titleBlock = tb;
                currentTitle = tb.Text;
            }
            else if (tabItem.Header is string s)
            {
                currentTitle = s;
            }

            // Git #2079 — the displayed title may carry a "[#N] " linked-issue
            // prefix that OpenChatTab renders on top of chat.Title. Strip it
            // before showing the rename dialog and re-apply it after saving so
            // the prefix never gets baked into chat.Title/the persisted title
            // (which would double up as "[#N] [#N] ..." next time the tab opens).
            int? linkedGithubNumber = _chatTabs.TryGetValue(tabItem, out var tabState) ? tabState.GithubNumber : null;
            string? issuePrefix = linkedGithubNumber.HasValue ? $"[#{linkedGithubNumber.Value}] " : null;
            if (issuePrefix != null && currentTitle.StartsWith(issuePrefix, StringComparison.Ordinal))
            {
                currentTitle = currentTitle.Substring(issuePrefix.Length);
            }

            var dlg = new RenameTabDialog(currentTitle) { Owner = this };
            if (dlg.ShowDialog() == true && !string.IsNullOrWhiteSpace(dlg.NewTabName))
            {
                string newName = dlg.NewTabName;
                string displayName = issuePrefix != null ? issuePrefix + newName : newName;
                if (titleBlock != null)
                {
                    titleBlock.Text = displayName;
                    titleBlock.ToolTip = displayName;
                }
                else if (tabItem.Header is string)
                {
                    tabItem.Header = displayName;
                }

                if (tabItem.Tag is BuildConsole.Services.BoardChat chat)
                {
                    chat.Title = newName;
                    PersistOpenChatTabs();
                }

                BuildConsole.Services.ActivityLog.Log("tabs", $"Renamed tab to '{newName}'");
            }
        }

        private async System.Threading.Tasks.Task MarkChatTabInProgressAsync(TabItem tabItem, BuildConsole.Services.BoardChat? chat)
        {
            try
            {
                // Git #1629 (root cause 4) — a tab NOT opened through OpenChatTab (bare
                // string Tag) used to fall into a null-chat branch that toasted "marked
                // in-progress" while telling FocusModeService NOTHING. Resolve the real
                // conversation id from the tab itself (live WebView2 source — the same
                // logic backing GetActiveChatUrl, but for THIS tab, selected or not) so
                // any genuine claude.ai tab actually gets marked — or say plainly why not.
                string title = chat?.Title ?? TabTitleOf(tabItem);
                // Git #2663 — resolve what THIS tab REALLY shows now through the one shared
                // resolver. Previously the live-URL read was only a fallback taken when the
                // cached BoardChat fields were empty, so a stale-but-nonempty snapshot URL
                // (tab navigated to a new chat after opening) still won and the wrong
                // conversation got marked. Now the live tab URL is authoritative, with the
                // cached snapshot only as the last resort.
                var (conversationId, chatUrl) = ResolveChatIdentity(tabItem, chat?.ConversationId, chat?.ClaudeUrl);
                if (string.IsNullOrEmpty(conversationId) || string.IsNullOrEmpty(chatUrl))
                {
                    ToastEngine.Warning("In-Progress",
                        "This tab isn't showing a claude.ai conversation yet — a brand-new chat has no conversation id until its first message is sent. Open the chat (or send its first message) and try again.");
                    return;
                }

                int? githubNumber = chat?.IssueGithubNumber;
                if (githubNumber.HasValue)
                {
                    bool ok = await BuildConsole.Services.GitHubIssuesService.AddLabelAsync(githubNumber.Value, "in-flight");
                    if (ok)
                    {
                        ToastEngine.Success("In-Progress", $"Issue #{githubNumber.Value} marked 'in-flight' on GitHub");
                    }
                    else
                    {
                        ToastEngine.Info("In-Progress", $"Marked chat tab as in-progress (gh label sync attempted)");
                    }
                }
                else
                {
                    ToastEngine.Success("In-Progress", $"Chat '{title}' marked in-progress");
                }

                if (tabItem.Header is Panel panel)
                {
                    var titleBlock = panel.Children.OfType<TextBlock>().Skip(1).FirstOrDefault()
                                     ?? panel.Children.OfType<TextBlock>().FirstOrDefault();
                    if (titleBlock != null && !titleBlock.Text.StartsWith("✈"))
                    {
                        titleBlock.Text = "✈️ " + titleBlock.Text;
                    }

                    var bolt = panel.Children.OfType<Button>().FirstOrDefault(b => b.Content?.ToString() == "⚡");
                    if (bolt != null)
                    {
                        bolt.Foreground = (Brush)FindResource("YellowBrush");
                        bolt.ToolTip = "In Progress (Active in Focus Mode) — click to unmark";
                    }
                }

                if (chat != null && !chat.Title.StartsWith("✈"))
                {
                    chat.Title = "✈️ " + chat.Title;
                }
                // Git #1629 — the actual FocusModeService mark now happens for EVERY
                // resolvable chat tab, not only ones carrying a BoardChat snapshot.
                if (!BuildConsole.Services.FocusModeService.Instance.IsChatInProgress(conversationId))
                {
                    BuildConsole.Services.FocusModeService.Instance.ToggleChatInProgress(conversationId, chat?.Title ?? title, chatUrl);
                }
                if (_chatTabs.TryGetValue(tabItem, out var state))
                {
                    if (state.BuildStatusText != null)
                    {
                        state.BuildStatusText.Text = "In-Progress";
                    }
                }

                PersistOpenChatTabs();

                LeftSidebar.PopulateGitTrackerBoard();
                // Git #1629 — forceFresh: an in-progress mark changes nothing in the raw
                // board payload, so a plain PopulateChatsTree() would be silently skipped
                // by the unchanged-signature short-circuit and the tab wouldn't appear
                // under "In Progress" until the next unrelated data change.
                LeftSidebar.PopulateChatsTree(forceFresh: true);
                _ = BuildQueuePanel.RefreshAsync();

                BuildConsole.Services.ActivityLog.Log("git-board.chat", $"Marked chat '{chat?.Title ?? title}' ({conversationId}) as in-progress (in-flight)");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("In-Progress", $"Failed to mark in-progress: {ex.Message}");
            }
        }

        /// <summary>
        /// Git #1629 (root cause 4) — tab-level "Assign to Issue...": resolves THIS tab's
        /// real conversation id (same generalized logic as GetActiveChatUrl, so it works
        /// for a plain browsed-to claude.ai tab, selected or not) and hands it to the
        /// Chats panel's own issue/milestone picker + link path — Shane never has to find
        /// the issue node on the Git Board or copy the chat URL by hand. A tab with no
        /// resolvable conversation gets told plainly why, not silently ignored.
        /// </summary>
        private async System.Threading.Tasks.Task AssignChatTabToIssueAsync(TabItem tabItem)
        {
            var chatUrl = TryGetChatUrlForTab(tabItem);
            var convMatch = chatUrl != null ? ClaudeChatUrlRegex.Match(chatUrl) : null;
            if (convMatch is not { Success: true })
            {
                ToastEngine.Warning("Assign to Issue",
                    "This tab isn't showing a claude.ai conversation yet — a brand-new chat has no conversation id until its first message is sent. Open the chat (or send its first message) and try again.");
                return;
            }
            string conversationId = convMatch.Groups[1].Value;
            string title = (tabItem.Tag as BuildConsole.Services.BoardChat)?.Title ?? TabTitleOf(tabItem);
            await LeftSidebar.AssignChatToIssueInteractiveAsync(conversationId, title);
        }

        /// <summary>Git #1837 — resolves a chat tab's epic, in the same order the "Hand Off
        /// Now" flow already uses (<see cref="TriggerHandoffAsync"/>): the tab's own tracked
        /// GithubNumber first, then <see cref="LeftSidebar.GetEpicForChat"/> off its BoardChat
        /// tag, then <see cref="LeftSidebar.GetEpicByGithubNumber"/> off that chat's
        /// IssueGithubNumber. Null when none of those resolve — the caller falls back to
        /// asking Shane via <see cref="NewChatEpicDialog"/>.</summary>
        private int? ResolveEpicNumberForTab(TabItem tabItem)
        {
            if (_chatTabs.TryGetValue(tabItem, out var state) && state.GithubNumber.HasValue)
                return state.GithubNumber;

            if (tabItem.Tag is BuildConsole.Services.BoardChat chat)
            {
                var epic = LeftSidebar.GetEpicForChat(chat);
                if (epic != null) return epic.GithubNumber;

                if (chat.IssueGithubNumber.HasValue)
                {
                    var epicByNumber = LeftSidebar.GetEpicByGithubNumber(chat.IssueGithubNumber.Value);
                    if (epicByNumber != null) return epicByNumber.GithubNumber;
                }
            }

            // Git #1905 — same audit gap as TriggerHandoffAsync had: this resolver (used
            // by the "Start a new chat on Epic #N" context menu, both its label and
            // StartSuccessorChat) had no title-text fallback, so a tab clearly titled
            // `[#1202]` with stale/empty tracked github fields silently fell through to
            // null and forced Shane through the NewChatEpicDialog prompt. Parse the visible
            // title as a last resort, same ExtractTabTitleIssueNumber path #1802 and the
            // handoff fix use; prefer the canonical epic mapping, else the raw title number.
            var titleNumber = ExtractTabTitleIssueNumber(ExtractTabTitle(tabItem));
            if (titleNumber.HasValue)
            {
                var titleEpic = LeftSidebar.GetEpicByGithubNumber(titleNumber.Value);
                return titleEpic?.GithubNumber ?? titleNumber.Value;
            }

            return null;
        }

        /// <summary>
        /// Git #1837 — the chat-tab context menu's "Start a new chat on Epic #N", modelled on
        /// <see cref="MenuNewChat_Click"/> but starting from an existing tab rather than a
        /// File &gt; New Chat prompt, and always carrying a handoff pointer back to the tab
        /// it was started from. Never touches the predecessor tab — that's the Hand Off Now
        /// button's job (<see cref="TriggerHandoffAsync"/>), not this one's.
        /// </summary>
        private void StartSuccessorChat(TabItem tabItem)
        {
            var chatUrl = TryGetChatUrlForTab(tabItem);
            var convMatch = chatUrl != null ? ClaudeChatUrlRegex.Match(chatUrl) : null;
            if (convMatch is not { Success: true })
            {
                ToastEngine.Warning("New Chat",
                    "This tab isn't showing a claude.ai conversation yet — a brand-new chat has no conversation id until its first message is sent. Open the chat (or send its first message) and try again.");
                return;
            }

            int? epicNumber = ResolveEpicNumberForTab(tabItem);
            if (!epicNumber.HasValue)
            {
                var dialog = new NewChatEpicDialog { Owner = this };
                if (dialog.ShowDialog() != true || !dialog.EpicNumber.HasValue) return;
                epicNumber = dialog.EpicNumber.Value;
            }
            int n = epicNumber.Value;

            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (settings == null || string.IsNullOrWhiteSpace(settings.EpicChatProjectUrl))
            {
                ToastEngine.Warning("New Chat", "New Chat Project URL is not configured in Settings.");
                return;
            }

            var baseUrl = settings.EpicChatProjectUrl.Trim();
            if (!System.Uri.TryCreate(baseUrl, System.UriKind.Absolute, out _))
            {
                BuildConsole.Services.ActivityLog.Log("git-board.chat", $"successor chat aborted — invalid New Chat Project URL '{baseUrl}'");
                ToastEngine.Warning("New Chat", "The configured New Chat Project URL isn't a valid URL.");
                return;
            }

            var pat = settings.GitHubPat?.Trim() ?? "";
            var fullUrl = BuildConsole.Services.EpicChatUrlBuilder.BuildEpicChatUrl(baseUrl, pat, n, handoffFromChatUrl: chatUrl);

            BuildConsole.Services.ActivityLog.Log("git-board.chat", $"successor chat for Epic #{n} -> {baseUrl} (handoff from {chatUrl}, PAT {(string.IsNullOrEmpty(pat) ? "absent" : "present")})");
            OpenWebTab(fullUrl, $"#{n} New Chat", "", injectPrefillPoll: true, associateIssueNumber: n, associateIssueType: "Epic", associateDefaultTitle: $"[#{n}] New Chat");
        }

        public void CloseTab(TabItem tabItem, TabControl? ownerTabControl = null)
        {
            var owner = (tabItem.Parent as TabControl)
                        ?? ownerTabControl
                        ?? new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 }.FirstOrDefault(p => p.Items.Contains(tabItem));

            if (owner == null) return;

            // Clean up tab tracking
            if (_chatTabs.TryGetValue(tabItem, out var closingChatState))
            {
                // Git #2688 — unsubscribe the Detected-panel refresh handler wired at tab creation,
                // or this tab's container leaks forever off LeftSidebar.BoardRefreshCompleted.
                if (closingChatState.DetectedRefreshHandler != null && LeftSidebar != null)
                {
                    LeftSidebar.BoardRefreshCompleted -= closingChatState.DetectedRefreshHandler;
                }
                _chatTabs.Remove(tabItem);
                PersistOpenChatTabs();
            }
            // Git #1887 — this tab may still have a background reopen preload loading for
            // it (never selected, so never swapped in). Without this, closing it before
            // ever clicking it would leave that WebView2 loaded and running forever,
            // unreferenced by anything.
            CleanupPendingReopenSwap(tabItem);
            if (_homeView != null && tabItem.Content == _homeView)
            {
                _homeView = null;
            }

            Services.UiFadeHelper.FadeOut(tabItem, onComplete: () =>
            {
                // Re-resolve owner in case of pane drag
                var currentOwner = (tabItem.Parent as TabControl)
                                   ?? owner
                                   ?? new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 }.FirstOrDefault(p => p.Items.Contains(tabItem));

                if (currentOwner != null)
                {
                    currentOwner.Items.Remove(tabItem);
                    if (currentOwner.Items.Count > 0)
                    {
                        currentOwner.SelectedIndex = Math.Max(0, currentOwner.Items.Count - 1);
                    }
                    else
                    {
                        currentOwner.SelectedItem = null;
                    }
                }

                // Explicitly detach and dispose content so WPF visual tree, native HWNDs, and the
                // CoreWebView2 process behind each control never get stuck. Content is never the
                // WebView2 itself (web/chat/file tabs each wrap it in a container Grid), so this
                // recurses the visual tree to find and dispose every WebView2 descendant.
                DisposeWebView2Descendants(tabItem.Content as DependencyObject);
                tabItem.Content = null;
                tabItem.Header = null;

                CollapseEmptySplitPanes();
            });
        }

        /// <summary>Recursively finds and disposes every WebView2 in <paramref name="root"/>'s visual
        /// subtree. A tab's WebView2 is always wrapped (nav toolbar + WebView2 in a Grid for web tabs,
        /// a split Grid with an optional inline SQL runner for chat tabs, etc.), so a single-level
        /// `Content is WebView2` check never matches — this is what actually frees the native HWND and
        /// CoreWebView2 process when a tab closes, instead of leaving it running unreferenced.</summary>
        private void DisposeWebView2Descendants(DependencyObject? root)
        {
            if (root == null) return;
            if (root is Microsoft.Web.WebView2.Wpf.WebView2 wv)
            {
                // Git #1628 — the context-meter entry is keyed on the WebView2 instance and was
                // never removed when a tab closed, leaking one entry per closed chat. Drop it here,
                // the single point every closing chat WebView flows through. The persisted
                // per-conversation high-water (ChatContextMeterStore) is unaffected — reopening the
                // same chat restores its level from disk.
                _contextMeters.Remove(wv);
                try { wv.Dispose(); } catch { }
                return;
            }
            int count = VisualTreeHelper.GetChildrenCount(root);
            for (int i = 0; i < count; i++)
            {
                DisposeWebView2Descendants(VisualTreeHelper.GetChild(root, i));
            }
        }

        public void CollapseEmptySplitPanes()
        {
            if (EditorTabs2.Items.Count == 0 && EditorTabs3.Items.Count == 0 && EditorTabs4.Items.Count == 0)
            {
                ApplyGridForMode("Single");
            }
            else if (EditorTabs.Items.Count == 0 && EditorTabs2.Items.Count > 0 && EditorTabs3.Items.Count == 0 && EditorTabs4.Items.Count == 0)
            {
                MoveAllTabsToTarget(EditorTabs2, EditorTabs);
                ApplyGridForMode("Single");
            }
        }

        private void LeftSidebar_FileSelected(object? sender, string filePath)
        {
            OpenFileTab(filePath);
        }

        public Controls.SqlDocumentView OpenSqlRunnerTab()
        {
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagPath && tagPath == "scratch_sql_runner")
                {
                    EditorTabs.SelectedItem = item;
                    return (Controls.SqlDocumentView)item.Content;
                }
            }

            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };
            var iconBlock = new TextBlock { Text = "🗄️", FontSize = 12, Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
            var titleBlock = new TextBlock { Text = "SQL Runner", FontSize = 13, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)FindResource("TextBrush") };
            var closeBtn = new Button { Content = "✕", Style = (Style)FindResource("IconButton"), FontSize = 10, Padding = new Thickness(3, 1, 3, 1), Margin = new Thickness(4, 0, 0, 0), ToolTip = "Close Tab", VerticalAlignment = VerticalAlignment.Center };
            
            headerPanel.Children.Add(iconBlock);
            headerPanel.Children.Add(titleBlock);
            headerPanel.Children.Add(closeBtn);

            var sqlViewer = new Controls.SqlDocumentView();
            sqlViewer.Initialize(_buildTrackerApi);
            WireSqlRunnerSendToChat(sqlViewer);

            var newTab = new TabItem
            {
                Header = headerPanel,
                Content = sqlViewer,
                Tag = "scratch_sql_runner"
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;

            return sqlViewer;
        }

        public void OpenChatMappingsTab()
        {
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagPath && tagPath == "chat_mappings")
                {
                    EditorTabs.SelectedItem = item;
                    return;
                }
            }

            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };
            var iconBlock = new TextBlock { Text = "🗺️", FontSize = 12, Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
            var titleBlock = new TextBlock { Text = "Chat Mappings", FontSize = 13, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)FindResource("TextBrush") };
            var closeBtn = new Button { Content = "✕", Style = (Style)FindResource("IconButton"), FontSize = 10, Padding = new Thickness(3, 1, 3, 1), Margin = new Thickness(4, 0, 0, 0), ToolTip = "Close Tab", VerticalAlignment = VerticalAlignment.Center };
            
            headerPanel.Children.Add(iconBlock);
            headerPanel.Children.Add(titleBlock);
            headerPanel.Children.Add(closeBtn);

            var mappingsViewer = new Controls.ChatMappingsDocumentView();
            mappingsViewer.Initialize(_buildTrackerApi);

            var newTab = new TabItem
            {
                Header = headerPanel,
                Content = mappingsViewer,
                Tag = "chat_mappings"
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        public void OpenGraphApiTab(Controls.GraphApiSelectionArgs args)
        {
            TabItem? targetTab = null;
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagPath && tagPath == "graph_api")
                {
                    targetTab = item;
                    break;
                }
            }

            Controls.GraphApiDocumentView viewer;

            if (targetTab == null)
            {
                var headerPanel = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    VerticalAlignment = VerticalAlignment.Center
                };
                var iconBlock = new TextBlock { Text = "🔌", FontSize = 12, Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
                var titleBlock = new TextBlock { Text = "Microsoft Graph", FontSize = 13, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)FindResource("TextBrush") };
                var closeBtn = new Button { Content = "✕", Style = (Style)FindResource("IconButton"), FontSize = 10, Padding = new Thickness(3, 1, 3, 1), Margin = new Thickness(4, 0, 0, 0), ToolTip = "Close Tab", VerticalAlignment = VerticalAlignment.Center };

                headerPanel.Children.Add(iconBlock);
                headerPanel.Children.Add(titleBlock);
                headerPanel.Children.Add(closeBtn);

                viewer = new Controls.GraphApiDocumentView();
                viewer.Initialize(_buildTrackerApi);

                targetTab = new TabItem
                {
                    Header = headerPanel,
                    Content = viewer,
                    Tag = "graph_api"
                };

                AttachTabContextMenu(targetTab, EditorTabs);
                AttachTabDragHandlers(targetTab);

                closeBtn.Click += (s, e) => CloseTab(targetTab);

                EditorTabs.Items.Add(targetTab);
            }
            else
            {
                viewer = (Controls.GraphApiDocumentView)targetTab.Content;
            }

            EditorTabs.SelectedItem = targetTab;
            viewer.LoadApiEndpoint(
                args.Type,
                args.Key,
                args.Label,
                args.Description,
                args.Endpoint,
                args.Method,
                args.RequiredVariables,
                args.BodyTemplate
            );
        }

        public void OpenFileTab(string filePath)
        {
            if (!File.Exists(filePath)) return;

            string fileName = Path.GetFileName(filePath);
            string ext = Path.GetExtension(filePath).ToLowerInvariant();

            if (ext == ".sql")
            {
                var sqlViewer = OpenSqlRunnerTab();
                try { sqlViewer.SetSqlQuery(File.ReadAllText(filePath)); } catch {}
                return;
            }

            if (ext == ".json" && (filePath.Contains("\\test-manifests\\") || filePath.Contains("/test-manifests/")))
            {
                var manifest = BuildConsole.Services.TestManifest.LoadFromFile(filePath);
                if (manifest != null)
                {
                    new BuildConsole.ManifestViewerWindow(manifest, false) { Owner = this }.Show();
                    return;
                }
            }

            // Deduplicate if already open
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagPath && string.Equals(tagPath, filePath, StringComparison.OrdinalIgnoreCase))
                {
                    EditorTabs.SelectedItem = item;
                    return;
                }
            }

            string glyph = ext switch
            {
                ".json"               => "⚙",
                ".sql"                => "🗄️",
                ".md"                 => "📝",
                ".cs"                 => "⚡",
                ".xaml"               => "🎨",
                ".ts" or ".tsx" or ".js" or ".jsx" => "⚛",
                ".csproj"             => "📦",
                _                     => "📄"
            };

            // Header panel
            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            var iconBlock = new TextBlock
            {
                Text = glyph,
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            if (glyph.Length == 1 && glyph[0] >= 0xE000)
            {
                iconBlock.FontFamily = new FontFamily("Segoe MDL2 Assets");
                iconBlock.Foreground = (Brush)FindResource("BlueBrush");
            }

            var titleBlock = new TextBlock
            {
                Text = fileName,
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
            };

            var closeBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1),
                Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab",
                VerticalAlignment = VerticalAlignment.Center
            };

            headerPanel.Children.Add(iconBlock);
            headerPanel.Children.Add(titleBlock);
            headerPanel.Children.Add(closeBtn);

            // Tab Content
            UIElement tabContent;

            // Rich HTML Viewer / Monaco Code Editor in WebView2
            string fileText;
            try
            {
                fileText = File.ReadAllText(filePath);
            }
                catch (Exception ex)
                {
                    fileText = $"Error reading file: {ex.Message}";
                }

                string htmlContent = GenerateViewerHtml(filePath, fileText, ext);
                var wv = new BuildConsole.Controls.ChatSafeWebView2();
                // Git #852 — same fix as OpenWebTab/OpenChatTab: Loaded
                // fires again on every tab reactivation, not just once.
                bool navigated = false;
                wv.Loaded += async (s, e) =>
                {
                    bool ready = await EnsureWebViewInitializedAsync(wv);
                    if (ready && !navigated)
                    {
                        navigated = true;
                        wv.CoreWebView2.NavigateToString(htmlContent);
                    }
                };

                tabContent = wv;

            var newTab = new TabItem
            {
                Tag = filePath,
                Header = headerPanel,
                Content = tabContent
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        private static string GenerateViewerHtml(string filePath, string fileText, string ext)
        {
            string safePath = System.Net.WebUtility.HtmlEncode(filePath);
            long fileBytes = 0;
            try { fileBytes = new FileInfo(filePath).Length; } catch {}
            string sizeStr = fileBytes > 1024 * 1024 ? $"{fileBytes / (1024.0 * 1024.0):F2} MB" : fileBytes > 1024 ? $"{fileBytes / 1024.0:F1} KB" : $"{fileBytes} B";
            string codeJson = System.Text.Json.JsonSerializer.Serialize(fileText);

            if (ext == ".md")
            {
                string mdTemplate = @"<!DOCTYPE html>
<html>
<head>
<meta charset=""utf-8"">
<script src=""https://cdn.jsdelivr.net/npm/marked/marked.min.js""></script>
<style>
  body { background-color: #1E1E2E; color: #CDD6F4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; line-height: 1.6; }
  .toolbar { background-color: #181825; border-bottom: 1px solid #313244; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; position: sticky; top: 0; z-index: 100; }
  .path { color: #94E2D5; font-weight: 600; }
  .badge { background-color: #313244; color: #89B4FA; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .content { padding: 24px 32px; max-width: 960px; margin: 0 auto; }
  h1, h2, h3, h4, h5, h6 { color: #89B4FA; border-bottom: 1px solid #313244; padding-bottom: 6px; margin-top: 24px; }
  h1 { color: #CBA6F7; }
  a { color: #89B4FA; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background-color: #181825; color: #A6E3A1; padding: 2px 6px; border-radius: 4px; font-family: Consolas, monospace; font-size: 13px; }
  pre { background-color: #181825; border: 1px solid #313244; padding: 14px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: #CDD6F4; }
  blockquote { border-left: 4px solid #CBA6F7; margin: 12px 0; padding: 4px 16px; background-color: #181825; color: #BAC2DE; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #313244; padding: 8px 12px; text-align: left; }
  th { background-color: #181825; color: #89B4FA; }
  tr:nth-child(even) { background-color: #181825; }
  hr { border: none; border-top: 1px solid #313244; margin: 24px 0; }
</style>
</head>
<body>
  <div class=""toolbar"">
    <span class=""path"">📝 Markdown Preview — __PATH__</span>
    <span class=""badge"">__SIZE__</span>
  </div>
  <div class=""content"" id=""markdown-body""></div>
  <script>
    var rawMd = __CODE__;
    if (typeof marked !== 'undefined') {
      document.getElementById('markdown-body').innerHTML = marked.parse(rawMd);
    } else {
      document.getElementById('markdown-body').innerHTML = '<pre>' + rawMd.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
    }
  </script>
</body>
</html>";
                return mdTemplate.Replace("__PATH__", safePath).Replace("__SIZE__", sizeStr).Replace("__CODE__", codeJson);
            }

            // Monaco Code Editor for TypeScript (.ts, .tsx), JS, C#, XAML, JSON, CSS, etc.
            string lang = GetMonacoLanguage(ext);
            string monacoTemplate = @"<!DOCTYPE html>
<html>
<head>
  <meta charset=""utf-8"">
  <link rel=""stylesheet"" data-name=""vs/editor/editor.main"" href=""https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/editor/editor.main.css"">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background-color: #1E1E2E; font-family: 'Segoe UI', sans-serif; }
    #toolbar { height: 32px; background-color: #181825; border-bottom: 1px solid #313244; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; font-size: 12px; box-sizing: border-box; }
    .path { color: #89B4FA; font-weight: 600; }
    .badge { background-color: #313244; color: #A6E3A1; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    #editor-container { width: 100%; height: calc(100% - 32px); }
  </style>
</head>
<body>
  <div id=""toolbar"">
    <span class=""path"">⚛ __PATH__</span>
    <span class=""badge"">__SIZE__  •  Ctrl+F Find  •  Ctrl+G Go to Line</span>
  </div>
  <div id=""editor-container""></div>

  <script src=""https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.js""></script>
  <script>
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
      monaco.editor.defineTheme('catppuccin-mocha', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: '', background: '1E1E2E', foreground: 'CDD6F4' },
          { token: 'keyword', foreground: 'CBA6F7', fontStyle: 'bold' },
          { token: 'string', foreground: 'A6E3A1' },
          { token: 'number', foreground: 'FAB387' },
          { token: 'comment', foreground: '6C7086', fontStyle: 'italic' },
          { token: 'type', foreground: '89B4FA' },
          { token: 'identifier', foreground: '89DCEB' }
        ],
        colors: {
          'editor.background': '#1E1E2E',
          'editor.foreground': '#CDD6F4',
          'editorLineNumber.foreground': '#585B70',
          'editorLineNumber.activeForeground': '#89B4FA',
          'editor.selectionBackground': '#45475A',
          'editor.lineHighlightBackground': '#181825',
          'editorCursor.foreground': '#89B4FA'
        }
      });

      var editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: __CODE__,
        language: '__LANG__',
        theme: 'catppuccin-mocha',
        lineNumbers: 'on',
        renderLineHighlight: 'all',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: 13,
        fontFamily: 'Consolas, ""Courier New"", monospace',
        contextmenu: true,
        minimap: { enabled: true }
      });
    });
  </script>
</body>
</html>";

            return monacoTemplate.Replace("__PATH__", safePath)
                                 .Replace("__SIZE__", sizeStr)
                                 .Replace("__LANG__", lang)
                                 .Replace("__CODE__", codeJson);
        }

        private static string GetMonacoLanguage(string ext)
        {
            switch (ext.ToLowerInvariant())
            {
                case ".ts":
                case ".tsx":
                    return "typescript";
                case ".js":
                case ".jsx":
                    return "javascript";
                case ".cs":
                    return "csharp";
                case ".xaml":
                case ".xml":
                case ".html":
                case ".htm":
                case ".csproj":
                    return "xml";
                case ".css":
                    return "css";
                case ".json":
                    return "json";
                case ".md":
                    return "markdown";
                case ".sql":
                    return "sql";
                case ".yaml":
                case ".yml":
                    return "yaml";
                case ".ps1":
                case ".bat":
                case ".sh":
                    return "powershell";
                default:
                    return "plaintext";
            }
        }

        private void BuildQueuePanel_TaskSelected(object? sender, Controls.TaskSelectedEventArgs e)
        {
            // Git #2689 — keep the panel's content in sync on every selection (even a plain
            // click), but only force the panel open when explicitly requested (right-click →
            // "Open Build Log"). A plain click should just select/highlight the card.
            BuildLogView.LoadQueueItem(e.QueueItemId, e.Epic, e.Task, e.Status, e.ExitCode);
            if (e.OpenLogPanel)
                SetBottomPanel(true, tabIndex: 0);
        }

        /// <summary>QueueWatcherService.BuildFinished — the genuine "a queue-managed
        /// build is done" moment (fires for success AND failure alike). Playback
        /// itself is muted via Settings, not this handler, so the event keeps
        /// firing/logging normally either way (per the mute toggle's contract).</summary>
        private void QueueWatcher_BuildFinished(int queueItemId, string title, int exitCode)
        {
            _buildSound.Play();

            // Automatically deploy the just-finished build and verify+test it end to
            // end (build done -> pull+restart -> poll to new commit hash ->
            // scoped issue manifest test -> toast + Needs Attention).
            int? ghNum = null;
            var m = System.Text.RegularExpressions.Regex.Match(title, @"#(\d+)");
            if (m.Success && int.TryParse(m.Groups[1].Value, out var n))
            {
                ghNum = n;
            }

            if (exitCode == 0)
            {
                Dispatcher.BeginInvoke(() =>
                {
                    SailorDuckLayer?.TriggerCelebration($"⚓ {(ghNum.HasValue ? $"#{ghNum.Value} " : "")}BUILD COMPLETE! QUACK! 🎉");
                });
            }

            if (_postBuildDeploy != null)
                _ = _postBuildDeploy.OnBuildFinishedAsync(queueItemId, title, exitCode, ghNum);
        }

        /// <summary>
        /// Git #1884 — called on the UI thread once the app has signaled genuine full
        /// readiness (#1882/#1883's AllSettled). Rather than lifting the queue's launch
        /// gate immediately, this starts a real grace-period countdown (<see
        /// cref="AutoQueueGracePeriod"/>) and shows the non-blocking banner docked under
        /// the editor-pane layout toolbar. The gate only actually lifts
        /// (<see cref="QueueWatcherService.MarkAppReady"/>) once the countdown elapses,
        /// "Start now" is clicked, or "Stop" is clicked (see
        /// <see cref="ResolveAutoQueueGrace"/>). Runs harmlessly in Agent mode too — the
        /// queue watcher's own pickup timer is never started there (see the caller's own
        /// guard), so MarkAppReady/SetPaused calls here have nothing to gate; leaving the
        /// banner visible in Agent mode is what lets it be screenshotted/clicked for
        /// verification without ever touching Shane's real Postgres queue.
        /// </summary>
        private void StartAutoQueueGracePeriod()
        {
            if (_queueWatcher == null) return;

            _autoQueueGraceResolved = false;
            _autoQueueGraceEndUtc = DateTime.UtcNow + AutoQueueGracePeriod;
            AutoQueueGraceBanner.Visibility = Visibility.Visible;
            UpdateAutoQueueGraceText();

            _autoQueueGraceTimer?.Stop();
            _autoQueueGraceTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _autoQueueGraceTimer.Tick += (_, _) =>
            {
                if (DateTime.UtcNow >= _autoQueueGraceEndUtc)
                {
                    ResolveAutoQueueGrace(pauseQueue: false);
                }
                else
                {
                    UpdateAutoQueueGraceText();
                }
            };
            _autoQueueGraceTimer.Start();

            BuildConsole.Services.ActivityLog.Log("watcher",
                $"App signaled genuine full readiness (#1882) — auto-queue grace period started, " +
                $"{AutoQueueGracePeriod.TotalSeconds:0}s before the launch gate lifts (#1884).");
        }

        private void UpdateAutoQueueGraceText()
        {
            var remaining = _autoQueueGraceEndUtc - DateTime.UtcNow;
            if (remaining < TimeSpan.Zero) remaining = TimeSpan.Zero;
            AutoQueueGraceText.Text =
                $"Build queue auto-start in {(int)remaining.TotalMinutes}:{remaining.Seconds:00} — giving the app a moment to settle";
        }

        /// <summary>
        /// Ends the #1884 grace period exactly once — via the countdown elapsing, "Start
        /// now", or "Stop" — hides the banner, and lifts the #1883 launch gate
        /// (MarkAppReady). When <paramref name="pauseQueue"/> is true ("Stop" was
        /// clicked), also pauses the queue the same way the existing manual pause toggle
        /// does, so auto-start genuinely does not happen this session — but the gate
        /// itself is still lifted so a later manual "Resume" (the existing pause toggle)
        /// works normally instead of staying silently blocked forever.
        /// </summary>
        private void ResolveAutoQueueGrace(bool pauseQueue)
        {
            if (_autoQueueGraceResolved) return;
            _autoQueueGraceResolved = true;

            _autoQueueGraceTimer?.Stop();
            _autoQueueGraceTimer = null;
            AutoQueueGraceBanner.Visibility = Visibility.Collapsed;

            _queueWatcher?.MarkAppReady();
            if (pauseQueue)
            {
                _queueWatcher?.SetPaused(true);
                BuildConsole.Services.ActivityLog.Log("watcher",
                    "Auto-queue grace period stopped by user (#1884) — queue paused for this session, same as the manual pause toggle.");
            }
        }

        private void BtnAutoQueueStartNow_Click(object sender, RoutedEventArgs e) => ResolveAutoQueueGrace(pauseQueue: false);

        private void BtnAutoQueueStop_Click(object sender, RoutedEventArgs e) => ResolveAutoQueueGrace(pauseQueue: true);

        private void BtnSailorDuckMascot_Click(object sender, RoutedEventArgs e)
        {
            SailorDuckLayer?.SummonMascot();
            ToastEngine.Success("Sailor Duck Mascot", "Quack! Ahoy Captain Shane! ⚓ (Ctrl+Shift+D)");
        }

        #region Top Bar Quick Services Control

        private DispatcherTimer? _topServicesTimer;

        // service name -> the dynamically-built top-bar MenuItem for it (Git #1782).
        private readonly Dictionary<string, MenuItem> _serviceMenuItems = new();

        // The four services below have a dedicated bottom-panel tab + ServiceLogView
        // control wired up today (unchanged from before #1782). Any other
        // DevServicesManager.KnownServices entry (e.g. Website, or a new artifact added
        // later) still gets a full dynamic Start/Stop/Open-in-Edge menu - it just has no
        // dedicated log tab to jump to until one is built for it by name here.
        private static int TabIndexForService(string name) => name switch
        {
            "shane-mccaw-consulting" => 2,
            "portal" => 3,
            "admin-panel" => 4,
            "api-server" => 5,
            _ => -1,
        };

        private ServiceLogView? LogViewForService(string name) => name switch
        {
            "shane-mccaw-consulting" => MarketingLogView,
            "portal" => PortalLogView,
            "admin-panel" => AdminLogView,
            "api-server" => ApiServerLogView,
            _ => null,
        };

        /// <summary>
        /// Builds one MenuItem per DevServicesManager.KnownServices entry (itself loaded
        /// from scripts/dev-server/services.json) and inserts them ahead of the static
        /// "Start All / Stop All / Refresh" items already in XAML. No fixed per-service
        /// list in XAML or code-behind (Git #1782) - adding a real artifact to the shared
        /// JSON config is the only edit needed for it to show up here.
        /// </summary>
        private void BuildServicesMenu()
        {
            int insertAt = 0;
            foreach (var kvp in DevServicesManager.KnownServices)
            {
                string name = kvp.Key;
                var (title, port, _, icon) = kvp.Value;

                var item = new MenuItem { Header = $"{icon} {title} ({port})", StaysOpenOnClick = true };

                var start = new MenuItem { Header = $"▶ Start {title}" };
                start.Click += async (_, _) => await StartServiceFromMenuAsync(name);
                item.Items.Add(start);

                var stop = new MenuItem { Header = $"⏹ Stop {title}" };
                stop.Click += async (_, _) => await StopServiceFromMenuAsync(name);
                item.Items.Add(stop);

                item.Items.Add(new Separator());

                int tabIndex = TabIndexForService(name);
                if (tabIndex >= 0)
                {
                    var viewTab = new MenuItem { Header = "📄 View Log Tab" };
                    viewTab.Click += (_, _) => SetBottomPanel(true, tabIndex: tabIndex);
                    item.Items.Add(viewTab);
                }

                var openTab = new MenuItem { Header = $"🪟 Open in Tab (localhost:{port})" };
                openTab.Click += (_, _) => OpenWebTab($"http://localhost:{port}", title, icon);
                item.Items.Add(openTab);

                var openEdge = new MenuItem { Header = $"🌐 Open in Edge (localhost:{port})" };
                openEdge.Click += (_, _) => OpenBrowserUrl($"http://localhost:{port}");
                item.Items.Add(openEdge);

                _serviceMenuItems[name] = item;
                TopServicesMenuItem.Items.Insert(insertAt++, item);
            }
        }

        private async System.Threading.Tasks.Task StartServiceFromMenuAsync(string name)
        {
            int tabIndex = TabIndexForService(name);
            if (tabIndex >= 0) SetBottomPanel(true, tabIndex: tabIndex);
            await DevServicesManager.StartServiceAsync(name);
            await RefreshTopServicesStatusAsync();
            var logView = LogViewForService(name);
            if (logView != null) await logView.UpdateStatusAsync();
        }

        private async System.Threading.Tasks.Task StopServiceFromMenuAsync(string name)
        {
            await DevServicesManager.StopServiceAsync(name);
            await RefreshTopServicesStatusAsync();
            var logView = LogViewForService(name);
            if (logView != null) await logView.UpdateStatusAsync();
        }

        private void StartTopServicesPoll()
        {
            _topServicesTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _topServicesTimer.Tick += async (_, _) => await RefreshTopServicesStatusAsync();
            _topServicesTimer.Start();
            _ = RefreshTopServicesStatusAsync();
        }

        private async System.Threading.Tasks.Task RefreshTopServicesStatusAsync()
        {
            try
            {
                int total = DevServicesManager.KnownServices.Count;
                int runningCount = 0;

                foreach (var kvp in DevServicesManager.KnownServices)
                {
                    string name = kvp.Key;
                    var (title, port, _, icon) = kvp.Value;
                    bool running = await DevServicesManager.IsPortOpenAsync(port);
                    if (running) runningCount++;
                    if (_serviceMenuItems.TryGetValue(name, out var menuItem))
                    {
                        menuItem.Header = $"{icon} {title} ({port}) [{(running ? "RUNNING" : "STOPPED")}]";
                    }
                }

                if (total > 0 && runningCount == total)
                {
                    TopServicesStatusDot.Text = "🟢";
                    TopServicesStatusDot.ToolTip = $"All {total} dev services running";
                }
                else if (runningCount > 0)
                {
                    TopServicesStatusDot.Text = "🟡";
                    TopServicesStatusDot.ToolTip = $"{runningCount}/{total} dev services running";
                }
                else
                {
                    TopServicesStatusDot.Text = "⚪";
                    TopServicesStatusDot.ToolTip = "All dev services stopped";
                }
            }
            catch { }
        }

        private async void MenuStartAllServices_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 2);
            await DevServicesManager.StartAllServicesAsync();
            await System.Threading.Tasks.Task.Delay(2000);
            await RefreshTopServicesStatusAsync();
        }

        private async void MenuStopAllServices_Click(object sender, RoutedEventArgs e)
        {
            await DevServicesManager.StopAllServicesAsync();
            await RefreshTopServicesStatusAsync();
            await MarketingLogView.UpdateStatusAsync();
            await PortalLogView.UpdateStatusAsync();
            await AdminLogView.UpdateStatusAsync();
            await ApiServerLogView.UpdateStatusAsync();
        }

        private async void MenuRefreshServices_Click(object sender, RoutedEventArgs e)
        {
            await RefreshTopServicesStatusAsync();
            await MarketingLogView.UpdateStatusAsync();
            await PortalLogView.UpdateStatusAsync();
            await AdminLogView.UpdateStatusAsync();
            await ApiServerLogView.UpdateStatusAsync();
        }

        private static void OpenBrowserUrl(string url)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                ToastEngine.Show("Browser", $"Could not open {url}: {ex.Message}", ToastKind.Warning);
            }
        }

        #endregion

        private void MenuNewChat_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new NewChatEpicDialog { Owner = this };
            if (dialog.ShowDialog() == true && dialog.EpicNumber.HasValue)
            {
                int targetIssue = dialog.EpicNumber.Value;
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (settings == null || string.IsNullOrWhiteSpace(settings.EpicChatProjectUrl))
                {
                    ToastEngine.Warning("New Chat", "New Chat Project URL is not configured in Settings.");
                    return;
                }

                var baseUrl = settings.EpicChatProjectUrl.Trim();
                if (!System.Uri.TryCreate(baseUrl, System.UriKind.Absolute, out _))
                {
                    BuildConsole.Services.ActivityLog.Log("git-board.chat", $"new chat aborted — invalid New Chat Project URL '{baseUrl}'");
                    ToastEngine.Warning("New Chat", "The configured New Chat Project URL isn't a valid URL.");
                    return;
                }

                var pat = settings.GitHubPat?.Trim() ?? "";
                var label = $"Epic #{targetIssue}";
                var fullUrl = BuildConsole.Services.EpicChatUrlBuilder.BuildEpicChatUrl(baseUrl, pat, targetIssue);

                BuildConsole.Services.ActivityLog.Log("git-board.chat", $"new chat for Epic #{targetIssue} -> {baseUrl} (prefill '{label}', PAT {(string.IsNullOrEmpty(pat) ? "absent" : "present")})");
                OpenWebTab(fullUrl, $"#{targetIssue} New Chat", "", injectPrefillPoll: true, associateIssueNumber: targetIssue, associateIssueType: "Epic", associateDefaultTitle: $"[#{targetIssue}] New Chat");
            }
        }

        /// <summary>Git #834 / #954 — File > Settings selects the sidebar's Settings
        /// category nav (via ActivityBar.SelectSettings, which also expands a
        /// collapsed sidebar) AND opens/focuses the native Settings tab directly, so
        /// it works even when Settings is already the active sidebar view (a re-check
        /// of an already-checked RadioButton fires no ActiveViewChanged event).</summary>
        private void MenuSettings_Click(object sender, RoutedEventArgs e)
        {
            ActivityBar.SelectSettings();
            OpenSettingsTab();
        }

        // ── ActivityBar → LeftSidebar ─────────────────────────────────────────
        private void ActivityBar_ActiveViewChanged(object? sender, string view)
        {
            // Git #954 (Epic #803) — the cog now opens/focuses the native Settings
            // tab instead of cramming everything into the sidebar; the sidebar's
            // Settings view is just the category nav list. Done before the collapse
            // toggle below so the tab still opens even on an already-active re-click.
            if (view == "Settings")
                OpenSettingsTab();

            // VS Code behavior: clicking the already-active icon collapses the sidebar
            if (ColSidebar.Width.Value > 0 && LeftSidebar.GetCurrentView() == view)
            {
                ColSidebar.Width = new GridLength(0);
                SidebarSplitter.Visibility = Visibility.Collapsed;
            }
            else
            {
                if (ColSidebar.Width.Value == 0)
                {
                    ColSidebar.Width = new GridLength(DefaultSidebarWidth);
                    SidebarSplitter.Visibility = Visibility.Visible;
                    LeftSidebar.ExpandPanel();
                }
                LeftSidebar.SwitchView(view);
            }
        }

        // ── WebView2 events ───────────────────────────────────────────────────
        private void WebView_NavigationStarting(
            object? sender,
            Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs e)
        {
            NavStatusText.Text = "Loading…";
            StatusDot.Fill     = DotLoading;
            UrlStatusText.Text = e.Uri ?? string.Empty;
        }

        private void WebView_NavigationCompleted(
            object? sender,
            Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
        {
            NavStatusText.Text = e.IsSuccess ? "Ready" : $"Error {(int)e.WebErrorStatus}";
            StatusDot.Fill     = e.IsSuccess ? DotReady : DotError;
            var activeWv = sender as Microsoft.Web.WebView2.Wpf.WebView2 ?? GetActiveWebView();
            UrlStatusText.Text = activeWv.Source?.ToString() ?? string.Empty;

            // Git #1472 — filtered to only fire for tabs matching the configured watched base
            // URLs, so it never triggers on e.g. claude.ai chat tabs.
            UpdateVisualTestTrackerForNavigatedTab(sender as Microsoft.Web.WebView2.Wpf.WebView2);
        }

        private void WebView_SourceChanged(
            object? sender,
            Microsoft.Web.WebView2.Core.CoreWebView2SourceChangedEventArgs e)
        {
            var activeWv = sender as Microsoft.Web.WebView2.Wpf.WebView2 ?? GetActiveWebView();
            UrlStatusText.Text = activeWv.Source?.ToString() ?? string.Empty;
        }

        private void UpdateZoomDisplay()
            => ZoomText.Text = $"{GetActiveWebView().ZoomFactor:P0}";

        // ── Menu: File ────────────────────────────────────────────────────────
        private void MenuExit_Click(object sender, RoutedEventArgs e)
            => Application.Current.Shutdown();

        // ── Menu: Sound ───────────────────────────────────────────────────────
        private void MuteCompletionSound_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            settings.BuildCompleteSoundMuted = MuteCompletionSoundMenuItem.IsChecked;
            settings.Save();
        }

        // ── Title bar: Primary/Secondary account toggle (Git #1419) ────────────
        // Shane: "put a checkbox or toggle switch up on the title bar that just
        // switches all the builds over." Flips BuildConsoleSettings.DefaultAccount,
        // which every NEW build-queue trigger that doesn't already carry an explicit
        // `--account` flag or dialog override (the chat-button BT_QUEUE_BUILD path,
        // and EditBuildPromptDialog's own initial selector state) falls back to. The
        // per-build Account selector from #1416 remains a real, explicit override —
        // this toggle only changes what NEW builds default to going forward.
        private void TopAccountToggle_Click(object sender, MouseButtonEventArgs e)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            bool nowSecondary = !string.Equals(settings.DefaultAccount, "secondary", StringComparison.OrdinalIgnoreCase);
            settings.DefaultAccount = nowSecondary ? "secondary" : "primary";
            settings.Save();
            RefreshTopAccountToggleUi();

            // Git #1480 — the Chats panel + In Progress list scope to this same toggle; flipping
            // it must refresh both live, no app restart / manual refresh required. Both re-render
            // from already-cached data (no re-fetch) — see LeftSidebar.RefreshForAccountToggle
            // and FocusModeService.NotifyAccountToggleChanged.
            try { LeftSidebar.RefreshForAccountToggle(); } catch { /* best-effort */ }
            try { BuildConsole.Services.FocusModeService.Instance.NotifyAccountToggleChanged(); } catch { /* best-effort */ }
        }

        /// <summary>Repaints the title-bar account toggle from the persisted global default.</summary>
        private void RefreshTopAccountToggleUi()
        {
            bool secondary = string.Equals(
                BuildConsole.Services.BuildConsoleSettings.Load().DefaultAccount,
                "secondary", StringComparison.OrdinalIgnoreCase);

            // Git #1423: secondary state was a solid full-brightness MauveBrush fill (#CBA6F7),
            // reading as harsh bright purple/magenta — the same class of regression already fixed
            // once in ae7316606 ("Subtle dark ambient polish"), which moved Focus/Immersive off
            // pink/mauve onto the palette's muted COOL accent (Blue #89B4FA) as a dark surface with
            // a blue border/text accent, never a solid bright fill. Mirror that same treatment here.
            TopAccountToggleText.Text = secondary ? "Secondary" : "Primary";
            TopAccountToggleBorder.Background = secondary
                ? (System.Windows.Media.Brush)FindResource("Surface1Brush")
                : (System.Windows.Media.Brush)FindResource("Surface0Brush");
            TopAccountToggleBorder.BorderBrush = secondary
                ? (System.Windows.Media.Brush)FindResource("BlueBrush")
                : (System.Windows.Media.Brush)FindResource("Surface1Brush");
            TopAccountToggleText.Foreground = secondary
                ? (System.Windows.Media.Brush)FindResource("BlueBrush")
                : (System.Windows.Media.Brush)FindResource("TextBrush");
            TopAccountToggleBorder.ToolTip = secondary
                ? "Account: SECONDARY — new builds launch against Shane's overflow Pro account (CLAUDE_CONFIG_DIR override). Click to switch new builds back to primary."
                : "Account: PRIMARY (default Max 20x account) — new builds launch normally. Click to default new builds to the secondary overflow account instead.\n\nThis only sets the default for NEW builds; the Edit Build Prompt dialog's own Account selector always overrides it per build.";
        }

        /// <summary>Git #1419 — the `account` value a newly queued build should carry when it has
        /// no explicit `--account` flag of its own: "secondary" when the title-bar toggle's global
        /// default is secondary, else null (primary, unchanged from pre-#1419 behavior).</summary>
        private static string? ResolveDefaultAccountFlag() =>
            string.Equals(BuildConsole.Services.BuildConsoleSettings.Load().DefaultAccount, "secondary", StringComparison.OrdinalIgnoreCase)
                ? "secondary"
                : null;

        // ── Title bar: Home/Rental location toggle (Git #1986) ──────────────────
        // Shane splits time between a fibre "Home" line and a capped Verizon "Rental"
        // line. This manual, persisted switch tells BuildConsole which one it's on so
        // metered network work can be gated. NEVER auto-detected — a wrong guess that
        // silently enabled heavy downloads on the capped line is exactly the failure
        // being prevented. Flips BuildConsoleSettings.LocationMode, which drives:
        //   • BUILD_NETWORK=metered|unmetered injected into every launched build,
        //   • the --network header flag default,
        //   • the repo-root .pnpmfile.cjs metered-install refusal,
        //   • the version-update deploy's one-shot metered override.
        //
        // The one-shot override below is a SEPARATE, in-memory, per-operation exception
        // for an app-initiated network action (the version-update deploy). It authorises
        // a single operation and expires the moment that operation finishes. It NEVER
        // flips LocationMode — the switch stays on Rental throughout; the toggle just
        // shows a distinct "Rental — override active" state for the override's duration.
        // There is deliberately no flag/env/settings key an agent can set to obtain it —
        // BeginMeteredOverride is only ever reached from a Shane-driven UI action.

        /// <summary>Git #1986 — true while a Shane-authorised one-shot metered override is live for
        /// a single app-initiated operation. NEVER changes LocationMode; reverts on completion.</summary>
        private bool _meteredOverrideActive;

        /// <summary>The operation a live one-shot override was granted for (shown in the toggle tooltip + logged), or null.</summary>
        private string? _meteredOverrideOperation;

        private void TopLocationToggle_Click(object sender, MouseButtonEventArgs e)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            bool nowRental = !string.Equals(settings.LocationMode, "Rental", StringComparison.OrdinalIgnoreCase);
            settings.LocationMode = nowRental ? "Rental" : "Home";
            settings.Save();
            // Flipping the mode by hand is a fresh, deliberate decision — clear any stale
            // one-shot override so it can't linger across a manual switch.
            _meteredOverrideActive = false;
            _meteredOverrideOperation = null;
            RefreshTopLocationToggleUi();
            BuildConsole.Services.ActivityLog.Log("system.core",
                $"Location switched to {(nowRental ? "RENTAL (metered — network-heavy operations gated)" : "HOME (unmetered)")}.");
        }

        /// <summary>Repaints the title-bar Home/Rental toggle from the persisted LocationMode,
        /// surfacing a distinct "Rental — override active" state while a one-shot override is live.</summary>
        private void RefreshTopLocationToggleUi()
        {
            bool metered = BuildConsole.Services.BuildConsoleSettings.CurrentNetworkIsMetered();

            // Same de-brightened idiom as the account (Blue) and Conservation (Peach) toggles:
            // a dark surface with an accent border/text when Rental, never a solid bright fill.
            // Red is used for the metered state so it reads as the one worth noticing, and a
            // live override shows the SAME Red accent (never Home's neutral treatment) — the
            // switch stays visibly on Rental for the override's whole duration, per #1986.
            if (metered && _meteredOverrideActive)
            {
                TopLocationToggleText.Text = "Rental — override active";
                TopLocationToggleBorder.Background = (System.Windows.Media.Brush)FindResource("Surface1Brush");
                TopLocationToggleBorder.BorderBrush = (System.Windows.Media.Brush)FindResource("RedBrush");
                TopLocationToggleText.Foreground = (System.Windows.Media.Brush)FindResource("RedBrush");
                TopLocationToggleBorder.ToolTip =
                    $"Location: RENTAL (metered) — a one-shot override is ACTIVE for: {_meteredOverrideOperation ?? "an operation"}. It authorises that single operation only and reverts on completion; it does NOT un-gate anything else. Click to switch back to Home.";
                return;
            }

            TopLocationToggleText.Text = metered ? "Rental" : "Home";
            TopLocationToggleBorder.Background = metered
                ? (System.Windows.Media.Brush)FindResource("Surface1Brush")
                : (System.Windows.Media.Brush)FindResource("Surface0Brush");
            TopLocationToggleBorder.BorderBrush = metered
                ? (System.Windows.Media.Brush)FindResource("RedBrush")
                : (System.Windows.Media.Brush)FindResource("Surface1Brush");
            TopLocationToggleText.Foreground = metered
                ? (System.Windows.Media.Brush)FindResource("RedBrush")
                : (System.Windows.Media.Brush)FindResource("TextBrush");
            TopLocationToggleBorder.ToolTip = metered
                ? "Location: RENTAL (capped Verizon — metered). Network-heavy operations are gated: launched builds carry BUILD_NETWORK=metered, `pnpm install` at the repo root is refused (.pnpmfile.cjs), and the version-update deploy requires a one-shot right-click override. Click to switch to Home when you're back on fibre."
                : "Location: HOME (fibre — unmetered). Network-heavy operations run at full weight. Click to switch to Rental when you're on the capped connection, to gate metered work.";
        }

        /// <summary>Git #1986 — the `network` value a newly queued build should carry when it has
        /// no explicit `--network` flag of its own: "metered" when the location toggle is Rental,
        /// else null (unmetered). Mirrors <see cref="ResolveDefaultAccountFlag"/>.</summary>
        private static string? ResolveDefaultNetworkFlag() =>
            BuildConsole.Services.BuildConsoleSettings.CurrentNetworkIsMetered() ? "metered" : null;

        /// <summary>Git #1986 — begin a one-shot metered override for a single app-initiated
        /// operation. Records it, repaints the toggle to "Rental — override active", and logs it on
        /// the same channel as the gate's refusals so Shane can answer "what did I let through on the
        /// capped line" from the log alone. NEVER flips LocationMode. Only ever called from a
        /// Shane-driven UI action — there is no flag/env/settings path an agent can reach this by.</summary>
        private void BeginMeteredOverride(string operation)
        {
            _meteredOverrideActive = true;
            _meteredOverrideOperation = operation;
            RefreshTopLocationToggleUi();
            BuildConsole.Services.ActivityLog.Log("system.core",
                $"Metered override GRANTED (one-shot) for: {operation}. LocationMode stays Rental; this authorises only this operation and reverts on completion.");
        }

        /// <summary>Git #1986 — public wrapper so the Settings tab's Location combo can refresh the
        /// title-bar toggle live after saving, keeping both controls in agreement.</summary>
        public void RefreshLocationToggle() => RefreshTopLocationToggleUi();

        /// <summary>Ends the live one-shot override (operation finished) and reverts the toggle to the plain Rental state.</summary>
        private void EndMeteredOverride()
        {
            if (!_meteredOverrideActive) return;
            string op = _meteredOverrideOperation ?? "an operation";
            _meteredOverrideActive = false;
            _meteredOverrideOperation = null;
            RefreshTopLocationToggleUi();
            BuildConsole.Services.ActivityLog.Log("system.core",
                $"Metered override for '{op}' expired (operation finished). Gate is back in force.");
        }

        // ── Title bar: Conservation Cap toggle (Git #1989) ──────────────────────
        // Shane: "anything Sonnet High+ needs to be detected and parked. I still have the
        // ability to override and execute them if I want." When ON, QueueWatcherService
        // parks (never launches) any build above Sonnet High instead of running it — see
        // AccountCapPolicy.ExceedsSonnetHigh and QueueWatcherService.ParkForConservationAsync.
        // Clicking OFF also releases every currently-capped build back to 'queued' at its
        // original model/effort (per Shane's own requirement) — no confirm dialog, since a
        // direct toggle click is already the deliberate act; the Drain button below is the
        // separate, confirm-first bulk lever for the "release everything" moment.
        private void TopConservationToggle_Click(object sender, MouseButtonEventArgs e)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            bool turningOff = settings.ConservationModeEnabled;
            settings.ConservationModeEnabled = !turningOff;
            settings.Save();
            RefreshTopConservationToggleUi();
            BuildConsole.Services.ActivityLog.Log("build-queue", $"Conservation Cap toggled {(turningOff ? "OFF" : "ON")}.");
            // Git #2003 — a manual toggle must win over automation for a visible window: arm the
            // manual-hold so the next poll can't silently undo Shane's choice.
            BuildConsole.Services.UsageAutomationService.Instance.NotifyManualConservationChange();
            RefreshTopAutomationUi();
            if (turningOff) _ = ReleaseAllCappedAsync("toggle turned off");
        }

        // ── Title bar: usage-meter automation toggle (Git #2003) ────────────────
        // Shane: "If that [usage meter] was accurate ... I would use that as the indicator basis
        // and not have to click any buttons." This master switch turns the meter-driven automation
        // (auto-conservation + headroom-aware account routing) on/off. OFF by default and OFF is the
        // full-manual escape hatch: while off, the Conservation toggle and account routing behave
        // exactly as the pure manual #1989/#1419 controls. When on, automation is still only a
        // default — it fails closed on any unavailable/errored/stale reading and never overrides a
        // manual Conservation toggle inside its hold window. See UsageAutomationService.
        private void TopAutomationToggle_Click(object sender, MouseButtonEventArgs e)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            bool turningOn = !settings.UsageAutomationEnabled;
            settings.UsageAutomationEnabled = turningOn;
            settings.Save();
            BuildConsole.Services.ActivityLog.Log("build-queue", $"Usage-meter automation toggled {(turningOn ? "ON" : "OFF")}.");
            // Re-evaluate immediately against the last reading rather than waiting for the next poll.
            if (_usageMeter != null) _ = _usageMeter.ManualRefreshAsync();
            RefreshTopAutomationUi();
        }

        /// <summary>Git #2003 — the automation service acted on a poll (or flipped active/inactive);
        /// repaint the Conservation toggle (it may have engaged/released the cap) and the automation
        /// status text.</summary>
        private void OnAutomationChanged()
        {
            RefreshTopConservationToggleUi();
            RefreshTopAutomationUi();
        }

        /// <summary>Repaints the title-bar automation toggle + status text from the live setting and
        /// the automation service's current active/inactive state.</summary>
        private void RefreshTopAutomationUi()
        {
            if (TopAutomationToggleText == null) return; // called before InitializeComponent in edge paths
            var svc = BuildConsole.Services.UsageAutomationService.Instance;
            bool on = BuildConsole.Services.BuildConsoleSettings.Load().UsageAutomationEnabled;

            TopAutomationToggleText.Text = on ? "On" : "Off";
            // Green accent when acting on live data, muted when off/inactive — distinct from the
            // account (Blue) and Conservation (Peach) toggles.
            var state = svc.State;
            bool acting = state == BuildConsole.Services.UsageAutomationService.AutomationState.Active;
            TopAutomationToggleBorder.Background = on
                ? (System.Windows.Media.Brush)FindResource("Surface1Brush")
                : (System.Windows.Media.Brush)FindResource("Surface0Brush");
            TopAutomationToggleBorder.BorderBrush = acting
                ? (System.Windows.Media.Brush)FindResource("GreenBrush")
                : on ? (System.Windows.Media.Brush)FindResource("PeachBrush")
                     : (System.Windows.Media.Brush)FindResource("Surface1Brush");
            TopAutomationToggleText.Foreground = acting
                ? (System.Windows.Media.Brush)FindResource("GreenBrush")
                : on ? (System.Windows.Media.Brush)FindResource("PeachBrush")
                     : (System.Windows.Media.Brush)FindResource("TextBrush");

            // The status text plainly states inactivity + reason (fail-closed transparency, #2003 req 3).
            TopAutomationStatusText.Text = on ? svc.StatusText() : "";
            TopAutomationStatusText.Foreground = acting
                ? (System.Windows.Media.Brush)FindResource("Subtext0Brush")
                : (System.Windows.Media.Brush)FindResource("PeachBrush");
            TopAutomationToggleBorder.ToolTip = on
                ? $"Usage automation: ON — {svc.StatusText()}.\n\nEngages Conservation for you when the account with the most headroom still crosses the threshold, and routes heavy builds to the account with more headroom. Fails closed: if a reading is unavailable, errored, or stale (>{(int)BuildConsole.Services.UsageAutomationService.StaleAfter.TotalMinutes}m old) it does nothing and holds the last manual state. A manual Conservation toggle wins for {(int)BuildConsole.Services.UsageAutomationService.ManualHoldWindow.TotalHours}h. Click to turn off (full manual control)."
                : "Usage automation: OFF — the Conservation toggle and account routing are fully manual (as before). Click to let the live usage meter engage Conservation and route heavy builds to the account with more headroom automatically.";
        }

        /// <summary>Repaints the title-bar Conservation Cap toggle from the persisted setting.</summary>
        private void RefreshTopConservationToggleUi()
        {
            bool on = BuildConsole.Services.BuildConsoleSettings.Load().ConservationModeEnabled;

            // Git #1989 — same de-brightened treatment as RefreshTopAccountToggleUi's own
            // comment describes: a dark surface with a peach border/text accent when ON,
            // never a solid bright fill. Peach (not Blue, which the account toggle already
            // uses) so the two title-bar toggles read as visually distinct at a glance.
            TopConservationToggleText.Text = on ? "On" : "Off";
            TopConservationToggleBorder.Background = on
                ? (System.Windows.Media.Brush)FindResource("Surface1Brush")
                : (System.Windows.Media.Brush)FindResource("Surface0Brush");
            TopConservationToggleBorder.BorderBrush = on
                ? (System.Windows.Media.Brush)FindResource("PeachBrush")
                : (System.Windows.Media.Brush)FindResource("Surface1Brush");
            TopConservationToggleText.Foreground = on
                ? (System.Windows.Media.Brush)FindResource("PeachBrush")
                : (System.Windows.Media.Brush)FindResource("TextBrush");
            TopConservationToggleBorder.ToolTip = on
                ? "Conservation Cap: ON — no build above Sonnet High launches; it's parked instead (right-click a parked build for Run at Full Model, or use Drain). Click to turn off (releases every parked build back to the queue)."
                : "Conservation Cap: OFF — builds launch normally. Click to turn on when a usage window is tight: nothing above Sonnet High will launch until you turn this off or Drain.";
        }

        /// <summary>Git #1989 — the shared release used by both the toggle's OFF click and
        /// Drain: flips every currently-capped row back to 'queued' at its real original
        /// model/effort (never substituted) and logs each one on the same channel as the
        /// park/override actions, so a release is auditable afterward either way. Returns the
        /// released count.</summary>
        private async System.Threading.Tasks.Task<int> ReleaseAllCappedAsync(string reason)
        {
            if (_queueDb == null) return 0;
            try
            {
                var released = await _queueDb.DrainCappedAsync();
                foreach (var item in released)
                    BuildConsole.Services.ActivityLog.Log("build-queue", $"Conservation Cap release ({reason}): queue #{item.Id} ({item.Title}) back to queued at {item.Model ?? "default"}/{item.Effort ?? "default"}.");
                if (released.Count > 0)
                    BuildConsole.Services.ActivityLog.Log("build-queue", $"Conservation Cap release ({reason}): {released.Count} build(s) released back to the queue.");
                try { _ = BuildQueuePanel.RefreshAsync(); } catch { }
                return released.Count;
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("build-queue", $"Conservation Cap release ({reason}) failed: {ex.Message}");
                return 0;
            }
        }

        /// <summary>
        /// Drain (Git #1989) — Shane: "I also need a quick button to drain the parked
        /// queue with its full model... especially if it's 9pm+ ET on a Sunday." Confirms
        /// with the real count first (this is the one action here that can spend a lot of
        /// headroom at once), then turns the toggle off BEFORE releasing the rows — so by
        /// the time they're claimable again, LaunchItem's cap check reads OFF and can never
        /// re-park them out from under the drain — then releases every capped row back to
        /// 'queued' at its original model/effort.
        /// </summary>
        private async void BtnDrainCapped_Click(object sender, RoutedEventArgs e)
        {
            if (_queueDb == null)
            {
                ToastEngine.Warning("Drain", "No direct DB connection — can't drain.");
                return;
            }
            List<BuildConsole.Services.QueueItem> capped;
            try
            {
                capped = await _queueDb.GetCappedAsync();
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Drain Failed", $"Couldn't read capped builds: {ex.Message}");
                return;
            }
            if (capped.Count == 0)
            {
                ToastEngine.Info("Drain", "Nothing is currently capped.");
                return;
            }

            var confirmResult = System.Windows.MessageBox.Show(this,
                $"Release {capped.Count} parked build{(capped.Count == 1 ? "" : "s")} at full model?",
                "Drain Conservation Cap", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (confirmResult != MessageBoxResult.Yes) return;

            // Turn the toggle off FIRST — the deliberate exception to the one-shot override
            // rule (the per-item "Run at Full Model" override does NOT touch the toggle;
            // Drain does, because draining means the tight window is over).
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            settings.ConservationModeEnabled = false;
            settings.Save();
            RefreshTopConservationToggleUi();
            // Git #2003 — Drain is a manual action that turns Conservation off; arm the manual-hold
            // so automation can't silently re-engage the cap on the next poll while the tight window
            // Shane just declared over is still, by the numbers, above threshold.
            BuildConsole.Services.UsageAutomationService.Instance.NotifyManualConservationChange();
            RefreshTopAutomationUi();

            int released = await ReleaseAllCappedAsync("Drain");
            ToastEngine.Success("Drained", $"{released} build{(released == 1 ? "" : "s")} released back to the queue at full model. Conservation Cap turned off.");
        }

        // ── Menu: View ────────────────────────────────────────────────────────
        private void ToggleSidebar_Click(object sender, RoutedEventArgs e)
        {
            ColSidebar.Width = ColSidebar.Width.Value > 0
                ? new GridLength(0)
                : new GridLength(DefaultSidebarWidth);
        }

        private void ToggleQueuePanel_Click(object sender, RoutedEventArgs e)
        {
            ColQueue.Width = ColQueue.Width.Value > 0
                ? new GridLength(0)
                : new GridLength(DefaultQueueWidth);
            BuildQueuePanel.Visibility = ColQueue.Width.Value > 0
                ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ToggleBottomPanel_Click(object sender, RoutedEventArgs e)
            => SetBottomPanel(RowBottom.Height.Value == 0);

        private void SetBottomPanel(bool open, int tabIndex = -1)
        {
            if (open)
            {
                RowBottom.Height      = new GridLength(DefaultBottomHeight);
                BottomSplitter.Visibility = Visibility.Visible;
                BottomPanelGrid.Visibility = Visibility.Visible;
                if (tabIndex >= 0 && tabIndex < BottomTabs.Items.Count)
                    BottomTabs.SelectedIndex = tabIndex;
            }
            else
            {
                RowBottom.Height          = new GridLength(0);
                BottomSplitter.Visibility = Visibility.Collapsed;
                BottomPanelGrid.Visibility = Visibility.Collapsed;
            }
        }

        // ── Git #815: live Output log + sync status indicator ──────────────────
        private const int MaxOutputLogChars = 200_000;
        private BuildConsole.Services.PausableTextBoxLog? _outputPausableLog;

        private void AppendOutputLog(string line)
        {
            _outputPausableLog ??= new BuildConsole.Services.PausableTextBoxLog(OutputLogBox);
            _outputPausableLog.Append(line + Environment.NewLine, text =>
            {
                if (OutputLogBox.Text == "[Output] Waiting for activity…") OutputLogBox.Clear();
                OutputLogBox.AppendText(text);
                if (OutputLogBox.Text.Length > MaxOutputLogChars)
                {
                    OutputLogBox.Text = OutputLogBox.Text.Substring(OutputLogBox.Text.Length - MaxOutputLogChars);
                }
            });
        }

        private void OutputPauseToggle_Click(object sender, RoutedEventArgs e)
        {
            _outputPausableLog ??= new BuildConsole.Services.PausableTextBoxLog(OutputLogBox);
            _outputPausableLog.Toggle();
            OutputPauseButton.Content = _outputPausableLog.IsPaused ? "▶ Resume" : "⏸ Pause";
        }

        private void ReportSyncStatus(string? error)
        {
            if (error == null)
            {
                QueueDot.Fill = DotReady;
                QueueStatusText.Text = "Sync: live";
            }
            else
            {
                QueueDot.Fill = DotError;
                QueueStatusText.Text = $"Sync error: {error}";
                BuildConsole.Services.ActivityLog.Log("sync", $"FAILED: {error}");

                // Proactively wake Replit via SSH / watcher if dev server is asleep or returned 502 / unreachable
                if (_replitWatcher != null && (error.Contains("502") || error.Contains("unreachable") || error.Contains("dev server")))
                {
                    _ = _replitWatcher.CheckNowAndWakeIfDownAsync();
                }
            }
        }

        private void ResetLayout_Click(object sender, RoutedEventArgs e)
        {
            ColSidebar.Width = new GridLength(DefaultSidebarWidth);
            ColQueue.Width   = new GridLength(DefaultQueueWidth);
            SetBottomPanel(false);

            BuildQueuePanel.Visibility = Visibility.Visible;
            LeftSidebar.Visibility     = Visibility.Visible;
        }

        // ── Menu: View → Zoom ─────────────────────────────────────────────────
        private void ZoomIn_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            wv.ZoomFactor = Math.Min(wv.ZoomFactor + 0.1, 3.0);
            UpdateZoomDisplay();
        }

        private void ZoomOut_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            wv.ZoomFactor = Math.Max(wv.ZoomFactor - 0.1, 0.25);
            UpdateZoomDisplay();
        }

        private void ZoomReset_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            wv.ZoomFactor = 1.0;
            UpdateZoomDisplay();
        }

        // ── Menu: Claude ──────────────────────────────────────────────────────
        private void NavBack_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            if (wv.CanGoBack) wv.GoBack();
        }

        private void NavForward_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            if (wv.CanGoForward) wv.GoForward();
        }

        private void NavRefresh_Click(object sender, RoutedEventArgs e)
            => GetActiveWebView().Reload();

        // ── Menu: Terminal ────────────────────────────────────────────────────
        private void OpenTerminal_Click(object sender, RoutedEventArgs e)
            => SetBottomPanel(true, tabIndex: 1);

        private void GitChip_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 1);
            if (sender is MenuItem mi)
                TerminalView.SetCommand(mi.Tag?.ToString() ?? string.Empty);
        }

        // ── Menu: SQL ─────────────────────────────────────────────────────────
        private void OpenSql_Click(object sender, RoutedEventArgs e)
            => OpenSqlRunnerTab();

        // Git #816 — Shane: "the very first browser that opens is hard
        // stuck... that Claude works I'm logged in every time" (others
        // don't). Root cause: this was `if (_sharedWv2Env == null) {
        // _sharedWv2Env = await CreateAsync(...); }` — a check-then-assign
        // that is NOT safe against a second call arriving while the first
        // `await CreateAsync` is still pending (which happens routinely:
        // ClaudeWebView initializes at startup, then Shane opens a chat tab
        // seconds later before that first await has resolved). A second
        // concurrent CoreWebView2Environment.CreateAsync() against the SAME
        // user data folder while the first is still opening it does NOT
        // reliably hand back the same live session — cookies then don't
        // sync in real time between "whichever one won the race" and
        // everything after it, and AddScriptToExecuteOnDocumentCreatedAsync
        // on a WebView2 whose environment call got stuck behind that race
        // can also lose its window to run before the first navigation.
        // Caching the in-flight Task itself (not the eventual result) closes
        // the window: every caller awaits the exact same task, so there is
        // only ever one CreateAsync call for the app's whole lifetime.
        private static System.Threading.Tasks.Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment>? _sharedWv2EnvTask;

        private static System.Threading.Tasks.Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment> GetSharedWebView2EnvironmentAsync()
        {
            _sharedWv2EnvTask ??= CreateSharedWebView2EnvironmentAsync();
            return _sharedWv2EnvTask;
        }

        private static async System.Threading.Tasks.Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment> CreateSharedWebView2EnvironmentAsync()
        {
            string userDataDir = Path.Combine(Path.GetTempPath(), "BuildConsole_WebView2");
            Directory.CreateDirectory(userDataDir);
            BuildConsole.Services.ActivityLog.Log("startup", $"Creating shared WebView2 environment ({userDataDir})…");
            var options = new Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions(
                additionalBrowserArguments: "--default-background-color=181825 --force-dark-mode"
            );
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, userDataDir, options);
            BuildConsole.Services.ActivityLog.Log("startup", "Shared WebView2 environment ready.");
            return env;
        }

        /// <summary>Git #830 — auto-grants Notification permission requests so claude.ai's real push notifications can actually display as Windows toasts, without Shane having to click an infobar prompt he'd otherwise have no way to get back to later. Anything else falls through to WebView2's own default prompt.</summary>
        private static void WebView_PermissionRequested(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2PermissionRequestedEventArgs e)
        {
            if (e.PermissionKind == Microsoft.Web.WebView2.Core.CoreWebView2PermissionKind.Notifications)
            {
                e.State = Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Allow;
                e.Handled = true;
            }
        }

        public static async System.Threading.Tasks.Task<bool> EnsureWebViewInitializedAsync(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            try
            {
                // Never flash bright white during initialization / loading
                wv.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37);

                if (wv.CoreWebView2 != null) return true;

                var env = await GetSharedWebView2EnvironmentAsync();
                await wv.EnsureCoreWebView2Async(env);
                if (wv.CoreWebView2 != null)
                {
                    wv.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37);
                    wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                    // Git #830 — Shane: "Is there a way to make push
                    // notifications from Claude.ai work in this WebView2
                    // browser?" Without this, WebView2 shows its own
                    // permission-prompt UI (an infobar) the first time
                    // claude.ai calls Notification.requestPermission(), and
                    // if that's ever dismissed/denied there's no browser
                    // chrome to go re-grant it from later, unlike a real
                    // browser's site-settings page. Auto-allow so it just
                    // works, same as a user clicking "Allow" once.
                    wv.CoreWebView2.PermissionRequested -= WebView_PermissionRequested;
                    wv.CoreWebView2.PermissionRequested += WebView_PermissionRequested;

                    // Immediately enforce dark background on every document navigation so pages don't flash white before CSS loads
                    await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                        "(() => { try { const setDark = () => { if (document.documentElement && !document.documentElement.style.backgroundColor) { document.documentElement.style.backgroundColor = '#181825'; } if (document.body && !document.body.style.backgroundColor) { document.body.style.backgroundColor = '#181825'; } }; setDark(); document.addEventListener('DOMContentLoaded', setDark); } catch (e) {} })();"
                    );

                    return true;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"WebView2 init error: {ex.Message}");
                BuildConsole.Services.ActivityLog.Log("startup", $"WebView2 init error: {ex.Message}");
            }
            return false;
        }

        /// <summary>
        /// Git #814 — Shane: "can I use it like the addon? with the UI
        /// elements in the Chat?" Injects content.js's "Send to Builder" /
        /// "Queue" button bar into a claude.ai WebView2 via
        /// AddScriptToExecuteOnDocumentCreatedAsync (WPF's equivalent of a
        /// browser content script) - only meaningful on claude.ai itself, so
        /// callers should only use this for the Claude tab and per-chat tabs,
        /// not the generic OpenWebTab/OpenFileTab viewers.
        /// </summary>
        private async System.Threading.Tasks.Task<bool> InjectBuilderButtonsAsync(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            try
            {
                bool ready = await EnsureWebViewInitializedAsync(wv);
                if (!ready) return false;
                // Git #816 - MUST happen before the WebView2 navigates anywhere
                // (that's the whole reason ClaudeWebView's XAML Source binding
                // got removed - see the wv2:WebView2 declaration) - a script
                // added after navigation starts only applies to the NEXT one.
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildConsole.Services.ChatButtonInjector.Script);
                // Git #1253 — also inject the issue-mention highlighter that underlines
                // #NNN tokens in Claude's responses and lets Shane hover/click them.
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildConsole.Services.IssueMentionInjector.Script);
                // Issue #1424 — inject the chat context DOM scraper script
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildConsole.Services.ChatContextMeterScript.Script);

                wv.WebMessageReceived -= ChatWv_WebMessageReceived;
                wv.WebMessageReceived += ChatWv_WebMessageReceived;
                return true;
            }
            catch { return false; }
        }

        private FrameworkElement CreateChatContextWrapper(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            if (wv == ClaudeWebView) return wv;
            if (_contextMeters.TryGetValue(wv, out var existing)) return existing.ProgressBar.Parent as FrameworkElement ?? wv;

            // Create Banner
            // Git #1705 — dark, panel-matching base (MantleBrush) with a low-opacity tier-hue
            // wash + left accent stripe layered on top, never a flat bright fill. See
            // BuildTierWashBrush/BuildTierAccentBrush below for the per-tier values.
            var banner = new Border
            {
                Background = (Brush)FindResource("MantleBrush"),
                BorderThickness = new Thickness(3, 0, 0, 0),
                Padding = new Thickness(10, 6, 10, 6),
                Visibility = Visibility.Collapsed
            };

            var bannerGrid = new Grid();
            bannerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            bannerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            bannerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var bannerText = new TextBlock
            {
                Text = "",
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                TextWrapping = TextWrapping.Wrap
            };
            Grid.SetColumn(bannerText, 0);
            bannerGrid.Children.Add(bannerText);

            // Git #1470 — the only way handoff ever fires: a real button Shane clicks himself.
            // Git #1885 — this same button/handler is now also surfaced (relabeled "Start
            // handoff chat") in the yellow (60k-85k) and peach (85k-100k) tiers below, not just
            // critical/red — one button, one TriggerHandoffAsync call, reused rather than
            // duplicated per tier. Collapsed by default here; each tier branch in
            // UpdateContextMeter sets its own Content + Visibility.
            var handoffBtn = new Button
            {
                Content = "Hand Off Now",
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(8, 0, 8, 0),
                Foreground = (Brush)FindResource("TextBrush"),
                Background = Brushes.Transparent,
                BorderBrush = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                Visibility = Visibility.Collapsed
            };
            Grid.SetColumn(handoffBtn, 1);
            bannerGrid.Children.Add(handoffBtn);

            var bannerCloseBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(4, 2, 4, 2),
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(bannerCloseBtn, 2);
            bannerGrid.Children.Add(bannerCloseBtn);
            banner.Child = bannerGrid;

            // Create ProgressBar
            var progressBar = new ProgressBar
            {
                Height = 4,
                Minimum = 0,
                Maximum = 130000,
                Value = 0,
                BorderThickness = new Thickness(0),
                Background = Brushes.Transparent,
                Foreground = (Brush)FindResource("GreenBrush"),
                Visibility = Visibility.Collapsed
            };

            var chatContextGrid = new Grid();
            chatContextGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            chatContextGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            chatContextGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            Grid.SetRow(banner, 0);
            Grid.SetRow(progressBar, 1);
            Grid.SetRow(wv, 2);

            chatContextGrid.Children.Add(banner);
            chatContextGrid.Children.Add(progressBar);
            chatContextGrid.Children.Add(wv);

            var meterState = new ChatContextMeterState
            {
                ProgressBar = progressBar,
                Banner = banner,
                BannerText = bannerText,
                BannerCloseBtn = bannerCloseBtn,
                HandoffBtn = handoffBtn
            };

            bannerCloseBtn.Click += (s, e) =>
            {
                banner.Visibility = Visibility.Collapsed;
                meterState.BannerDismissed = true;
                BuildConsole.Services.ActivityLog.Log("system.core.chat-context", "User dismissed context warning banner.");
            };

            // Git #1470 — handoff fires ONLY here, on Shane's explicit click. Never automatic,
            // never forces navigation on its own, never blocks him from reading/opening other chats
            // while the banner sits there waiting.
            handoffBtn.Click += (s, e) =>
            {
                if (meterState.HandoffInProgress) return;
                meterState.HandoffInProgress = true;
                handoffBtn.IsEnabled = false;
                BuildConsole.Services.ActivityLog.Log("system.core.chat-context", $"Critical context reached ({meterState.EstimatedTokens:N0} tokens). Shane clicked Hand Off Now.");
                _ = TriggerHandoffAsync(wv, meterState, handoffBtn);
            };

            _contextMeters[wv] = meterState;
            return chatContextGrid;
        }

        /// <summary>
        /// Git #1705 — the chat context meter banners used to be a flat, fully-saturated fill in
        /// the tier's raw hue (bright enough it "physically hurts to look at"). This reproduces the
        /// score-dynamic shell recipe from docs/design-system.md §5 verbatim: a radial wash bleeding
        /// from the bottom-left corner (120% 90% at 0% 100%) at low tier-hue opacity, falling back to
        /// the dark MantleBrush base by ~62%. Alpha here is tuned higher than the doc's page-wide
        /// 14-18% (as the doc itself invites — "tune it so text contrast holds") because this is a
        /// compact banner strip that has to read as a distinct tier at a glance, not a full-screen
        /// ambient wash.
        /// </summary>
        private Brush BuildTierWashBrush(string tierBrushKey, double alpha)
        {
            var tint = ((SolidColorBrush)FindResource(tierBrushKey)).Color;
            var mantle = ((SolidColorBrush)FindResource("MantleBrush")).Color;
            var wash = Color.FromArgb((byte)Math.Round(255 * alpha), tint.R, tint.G, tint.B);
            var brush = new RadialGradientBrush
            {
                GradientOrigin = new Point(0, 1),
                Center = new Point(0, 1),
                RadiusX = 1.2,
                RadiusY = 0.9
            };
            brush.GradientStops.Add(new GradientStop(wash, 0.0));
            brush.GradientStops.Add(new GradientStop(mantle, 0.62));
            brush.Freeze();
            return brush;
        }

        /// <summary>
        /// Git #1705 — the left accent-border stripe: a flat, higher-opacity blend of the tier hue
        /// into MantleBrush's RGB, giving a second, sharper at-a-glance signal alongside the wash
        /// above without the stripe itself reading as bright (it's 3px, blended into the dark base,
        /// not the tier's raw saturated color).
        /// </summary>
        private Brush BuildTierAccentBrush(string tierBrushKey, double amount)
        {
            var baseColor = ((SolidColorBrush)FindResource("MantleBrush")).Color;
            var tint = ((SolidColorBrush)FindResource(tierBrushKey)).Color;
            byte Blend(byte b, byte t) => (byte)Math.Round(b * (1 - amount) + t * amount);
            var blended = Color.FromArgb(baseColor.A, Blend(baseColor.R, tint.R), Blend(baseColor.G, tint.G), Blend(baseColor.B, tint.B));
            return new SolidColorBrush(blended);
        }

        private void UpdateContextMeter(Microsoft.Web.WebView2.Wpf.WebView2 wv, double estTokens, int turnCount, int heavyTurnCount, bool selectorsLikelyStale = false, string? conversationId = null)
        {
            if (!_contextMeters.TryGetValue(wv, out var meterState)) return;

            // Git #1628 — clamp the incoming reading to the persisted per-conversation high-water
            // (and write back when a new maximum arrives) BEFORE it touches the bar. A transcript
            // only ever grows, so a lower reading is always a measurement artifact — a heavy turn
            // scrolling out of the virtualization window, a mid-render/streaming poll — never real.
            // This is also what restores a reopened chat: the first post-load poll reads ~0 out of
            // the not-yet-observed DOM, and the clamp pulls it straight back up to the stored level
            // instead of flashing green at zero. A brand-new chat has no conversation id yet (URL is
            // still /new until the first message), so it correctly starts at zero — nothing to clamp to.
            if (!string.IsNullOrEmpty(conversationId))
            {
                meterState.ConversationId = conversationId;
                var hw = BuildConsole.Services.ChatContextMeterStore.Merge(conversationId, estTokens, turnCount, heavyTurnCount);
                estTokens = hw.EstTokens;
                turnCount = hw.TurnCount;
                heavyTurnCount = hw.HeavyTurnCount;
            }

            // Cost/buffer derive from the (clamped) token total, so recompute them here rather than
            // trusting values computed from the raw pre-clamp reading.
            double cost = estTokens * (3.00 / 1000000.0);
            double remainingBuffer = 100000.0 - estTokens;

            // Update state fields
            meterState.EstimatedTokens = estTokens;
            meterState.TurnCount = turnCount;
            meterState.HeavyTurnCount = heavyTurnCount;
            meterState.Cost = cost;
            meterState.RemainingBuffer = remainingBuffer;

            // Git #1436 — the scraper reported it can no longer find any messages on what
            // looks like a real, populated chat. Log it once (loud, discoverable) and flip the
            // meter into an explicit "broken" visual state instead of quietly sitting at 0/green
            // forever, which is exactly what read as "not working" in the original report.
            if (selectorsLikelyStale && !meterState.SelectorsLikelyStale)
            {
                meterState.SelectorsLikelyStale = true;
                BuildConsole.Services.ActivityLog.Log("system.core.chat-context",
                    "Chat context meter: DOM scraper found zero messages on a populated chat page for ~10s straight — claude.ai's markup likely drifted and ChatContextMeterScript's selectors need updating (Git #1436).");
            }

            if (meterState.SelectorsLikelyStale)
            {
                meterState.ProgressBar.Visibility = Visibility.Visible;
                meterState.ProgressBar.Value = 0;
                meterState.ProgressBar.Foreground = (Brush)FindResource("OverlayBrush");
                meterState.ProgressBar.ToolTip = "Chat context meter: message detection isn't finding any turns on this chat. claude.ai's DOM likely changed — selectors in ChatContextMeterScript need updating (Git #1436).";
                meterState.HandoffBtn.Visibility = Visibility.Collapsed;
                if (!meterState.BannerDismissed)
                {
                    meterState.Banner.Background = (Brush)FindResource("YellowBrush");
                    meterState.BannerText.Text = "Context meter can't read this chat (selectors likely stale) — see Git #1436.";
                    meterState.BannerText.Foreground = (Brush)FindResource("CrustBrush");
                    meterState.BannerCloseBtn.Visibility = Visibility.Visible;
                    meterState.BannerCloseBtn.Foreground = (Brush)FindResource("CrustBrush");
                    meterState.Banner.Visibility = Visibility.Visible;
                }
                return;
            }

            // Make progress bar visible
            meterState.ProgressBar.Visibility = Visibility.Visible;
            meterState.ProgressBar.Value = Math.Min(estTokens, 130000);
            // Git #1470 — the handoff button only belongs in the critical (red) banner; reset it
            // here so it doesn't linger visible if tokens drop back below critical (e.g. new turn
            // recount) between polls, and only the >=100000 branch below turns it back on.
            meterState.HandoffBtn.Visibility = Visibility.Collapsed;

            // Format tooltip
            meterState.ProgressBar.ToolTip = $"Turns: {turnCount}\n" +
                                             $"Estimated Tokens: {estTokens:N0} / 130,000\n" +
                                             $"Remaining to Critical (100k): {(remainingBuffer > 0 ? remainingBuffer.ToString("N0") : "0")} tokens\n" +
                                             $"Remaining to Limit (130k): {Math.Max(0, 130000 - estTokens):N0} tokens (30k buffer)\n" +
                                             $"Estimated Cost: ${cost:F3}\n" +
                                             $"Heavy Turns: {heavyTurnCount}";

            // Threshold rules
            if (estTokens < 60000)
            {
                meterState.ProgressBar.Foreground = (Brush)FindResource("GreenBrush");
                meterState.Banner.Visibility = Visibility.Collapsed;
            }
            else if (estTokens >= 60000 && estTokens < 85000)
            {
                // Git #1705 — ambient wash over a dark base (same convention as the score-dynamic
                // shell elsewhere in the app), not a flat bright fill. Progress-bar fill color is
                // untouched.
                meterState.ProgressBar.Foreground = (Brush)FindResource("YellowBrush");
                meterState.Banner.Background = BuildTierWashBrush("YellowBrush", 0.16);
                meterState.Banner.BorderBrush = BuildTierAccentBrush("YellowBrush", 0.55);
                meterState.BannerText.Text = "Chat getting long, consider wrapping up soon.";
                meterState.BannerText.Foreground = (Brush)FindResource("TextBrush");
                meterState.BannerCloseBtn.Visibility = Visibility.Visible;
                meterState.BannerCloseBtn.Foreground = (Brush)FindResource("TextBrush");
                // Git #1885 — offer the same TriggerHandoffAsync mechanism the critical tier
                // uses (relabeled — this tier is still dismissible/optional, not an order), so
                // Shane can start the handoff early instead of waiting for the non-dismissible
                // red tier to force it.
                meterState.HandoffBtn.Content = "Start handoff chat";
                meterState.HandoffBtn.Visibility = Visibility.Visible;

                if (!meterState.BannerDismissed)
                {
                    meterState.Banner.Visibility = Visibility.Visible;
                }
            }
            else if (estTokens >= 85000 && estTokens < 100000)
            {
                meterState.ProgressBar.Foreground = (Brush)FindResource("PeachBrush");
                meterState.Banner.Background = BuildTierWashBrush("PeachBrush", 0.22);
                meterState.Banner.BorderBrush = BuildTierAccentBrush("PeachBrush", 0.70);
                double buffer = 100000.0 - estTokens;
                meterState.BannerText.Text = $"Chat getting very long. Remaining token buffer to critical: {Math.Max(0, buffer):N0} tokens.";
                meterState.BannerText.Foreground = (Brush)FindResource("TextBrush");
                meterState.BannerCloseBtn.Visibility = Visibility.Visible;
                meterState.BannerCloseBtn.Foreground = (Brush)FindResource("TextBrush");
                // Git #1885 — this tier is closer to critical than yellow is, so the same
                // early-handoff offer applies here too (judgment call invited by #1885 itself).
                meterState.HandoffBtn.Content = "Start handoff chat";
                meterState.HandoffBtn.Visibility = Visibility.Visible;

                // Re-surface banner even if user previously dismissed it in lower zone
                meterState.Banner.Visibility = Visibility.Visible;
            }
            else if (estTokens >= 100000)
            {
                // Non-dismissible/critical tier — runs a touch more saturated than the other two
                // so the "this one's actually urgent" signal survives the de-brightening, while
                // staying well below the old flat RedBrush fill.
                meterState.ProgressBar.Foreground = (Brush)FindResource("RedBrush");
                meterState.Banner.Background = BuildTierWashBrush("RedBrush", 0.30);
                meterState.Banner.BorderBrush = BuildTierAccentBrush("RedBrush", 0.90);
                // Git #1470 — never auto-fires and never forces navigation. This is now purely a
                // loud "please hand off soon" prompt; the button below is the only trigger.
                meterState.BannerText.Text = "Critical context reached! Hand off to a new chat when you're ready.";
                meterState.BannerText.Foreground = (Brush)FindResource("MauveBrush");
                meterState.BannerCloseBtn.Visibility = Visibility.Collapsed; // Non-dismissible — stays visible until Shane hands off.
                meterState.HandoffBtn.Content = "Hand Off Now";
                meterState.HandoffBtn.Visibility = Visibility.Visible;
                meterState.Banner.Visibility = Visibility.Visible;
            }
        }

        private async System.Threading.Tasks.Task TriggerHandoffAsync(Microsoft.Web.WebView2.Wpf.WebView2 oldWv, ChatContextMeterState meterState, Button handoffBtn)
        {
            try
            {
                TabItem? oldTab = null;
                BuildConsole.Services.BoardChat? chat = null;

                foreach (var kvp in _chatTabs)
                {
                    if (kvp.Value.WebView == oldWv)
                    {
                        oldTab = kvp.Key;
                        chat = oldTab.Tag as BuildConsole.Services.BoardChat;
                        break;
                    }
                }

                if (oldTab == null)
                {
                    foreach (TabItem item in EditorTabs.Items)
                    {
                        if (WebViewOf(item) == oldWv)
                        {
                            oldTab = item;
                            chat = item.Tag as BuildConsole.Services.BoardChat;
                            break;
                        }
                    }
                }

                if (oldTab == null)
                {
                    BuildConsole.Services.ActivityLog.Log("system.core.chat-context", "Handoff failed: old chat tab could not be identified.");
                    return;
                }

                int? targetIssue = null;
                if (chat != null)
                {
                    var resolvedEpic = LeftSidebar.GetEpicForChat(chat);
                    if (resolvedEpic == null)
                    {
                        int? tabGithubNumber = null;
                        if (_chatTabs.TryGetValue(oldTab, out var tabState))
                        {
                            tabGithubNumber = tabState.GithubNumber;
                        }
                        if (!tabGithubNumber.HasValue)
                        {
                            tabGithubNumber = chat.IssueGithubNumber;
                        }
                        if (tabGithubNumber.HasValue)
                        {
                            resolvedEpic = LeftSidebar.GetEpicByGithubNumber(tabGithubNumber.Value);
                        }
                    }
                    if (resolvedEpic != null)
                    {
                        targetIssue = resolvedEpic.GithubNumber;
                    }
                }

                // Git #1905 — Shane: "Hand Off Now" fails with "chat has no associated
                // epic" on a tab whose title literally shows `[#1202]`. The entire chain
                // above is nested under `if (chat != null)` and depends on
                // GetEpicForChat / tabState.GithubNumber / chat.IssueGithubNumber — every
                // one of which can be null or stale — and it's skipped outright when the
                // tab isn't a tracked BoardChat at all. The tab's visible title still
                // carries the real issue number, so parse it out as a last resort, the
                // SAME ExtractTabTitleIssueNumber fallback #1802 built for the Working-epic
                // highlight. Prefer the canonical epic mapping when the number is a known
                // epic; otherwise the number on the title is itself a valid handoff target,
                // so a stale/empty bt_epics cache never turns a clearly-numbered tab back
                // into "no associated epic". Covers BOTH the chat==null case and the
                // chat!=null-but-chain-empty case the issue calls out.
                if (!targetIssue.HasValue)
                {
                    var titleNumber = ExtractTabTitleIssueNumber(ExtractTabTitle(oldTab));
                    if (titleNumber.HasValue)
                    {
                        var titleEpic = LeftSidebar.GetEpicByGithubNumber(titleNumber.Value);
                        targetIssue = titleEpic?.GithubNumber ?? titleNumber.Value;
                    }
                }

                // Git #2545 — final last resort. The anchored parse above (now including
                // #2545's bare-leading-number branch) resolves the real reported case,
                // `1202 Build Console`. But a manually-renamed chat can carry its number
                // anywhere in the title, so scan the whole visible title for any real
                // #?<n> token before giving up. This exists specifically so this exact
                // "no associated epic" failure — which already recurred once after #1905
                // was declared fixed — can never fire again on a tab that visibly shows an
                // issue number, regardless of which path (or manual rename) set the title.
                if (!targetIssue.HasValue)
                {
                    var anyNumber = ExtractAnyTitleIssueNumber(ExtractTabTitle(oldTab));
                    if (anyNumber.HasValue)
                    {
                        var anyEpic = LeftSidebar.GetEpicByGithubNumber(anyNumber.Value);
                        targetIssue = anyEpic?.GithubNumber ?? anyNumber.Value;
                    }
                }

                if (!targetIssue.HasValue)
                {
                    BuildConsole.Services.ActivityLog.Log("system.core.chat-context", "Handoff aborted: no resolved epic associated with the current chat.");
                    ToastEngine.Warning("Handoff", "Cannot hand off: chat has no associated epic.");
                    return;
                }

                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (settings == null || string.IsNullOrWhiteSpace(settings.EpicChatProjectUrl))
                {
                    ToastEngine.Warning("Handoff", "New Chat Project URL is not configured in Settings.");
                    return;
                }

                var baseUrl = settings.EpicChatProjectUrl.Trim();
                if (!System.Uri.TryCreate(baseUrl, System.UriKind.Absolute, out _))
                {
                    BuildConsole.Services.ActivityLog.Log("system.core.chat-context", $"Handoff aborted — invalid New Chat Project URL '{baseUrl}'");
                    ToastEngine.Warning("Handoff", "The configured New Chat Project URL isn't a valid URL.");
                    return;
                }

                var pat = settings.GitHubPat?.Trim() ?? "";

                // Git #1837 — carry a pointer back to the chat being archived, so the
                // successor isn't dropped into the epic with no idea a predecessor existed.
                // A handoff that loses its pointer is still better than one that doesn't fire
                // at all, so a URL that can't be resolved just logs it and fires without one.
                string? handoffFromChatUrl = chat?.ClaudeUrl;
                if (string.IsNullOrEmpty(handoffFromChatUrl))
                {
                    handoffFromChatUrl = TryGetChatUrlForTab(oldTab);
                }
                if (string.IsNullOrEmpty(handoffFromChatUrl))
                {
                    BuildConsole.Services.ActivityLog.Log("system.core.chat-context", $"Handoff for Epic #{targetIssue.Value} firing without a handoff pointer — old chat's conversation URL could not be resolved.");
                }

                var fullUrl = BuildConsole.Services.EpicChatUrlBuilder.BuildEpicChatUrl(baseUrl, pat, targetIssue.Value, handoffFromChatUrl);

                if (chat != null)
                {
                    string convId = chat.ConversationId;
                    BuildConsole.Services.ActivityLog.Log("system.core.chat-context", $"Archiving old chat '{chat.Title}' ({convId})...");
                    DateTime? archivedAtUtc = null;
                    if (_queueDb != null)
                    {
                        archivedAtUtc = await _queueDb.ArchiveChatAsync(convId);
                    }
                    else if (_buildTrackerApi != null && _buildTrackerApi.IsConfigured)
                    {
                        var res = await _buildTrackerApi.ArchiveChatAsync(convId);
                        if (res.IsSuccessStatusCode)
                        {
                            archivedAtUtc = DateTime.UtcNow;
                        }
                    }
                    chat.Archived = true;
                    chat.ArchivedAt = archivedAtUtc;
                    try { LeftSidebar.PopulateChatsTree(); } catch { }
                }

                BuildConsole.Services.ActivityLog.Log("system.core.chat-context", $"Firing new chat for Epic #{targetIssue.Value}...");
                OpenWebTab(fullUrl, $"#{targetIssue.Value} New Chat", "", injectPrefillPoll: true, associateIssueNumber: targetIssue.Value, associateIssueType: "Epic", associateDefaultTitle: $"[#{targetIssue.Value}] New Chat");

                CloseTab(oldTab);
                ToastEngine.Success("Handoff", $"Handoff fired for Epic #{targetIssue.Value}! Old chat archived.");
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("system.core.chat-context", $"Handoff failed: {ex.Message}");
            }
            finally
            {
                // Git #1470 — re-arm the button so a failed/aborted attempt (missing settings,
                // no resolved epic, etc.) can be retried by clicking again, rather than leaving
                // it permanently disabled. Harmless no-op if the old tab/wrapper was already closed.
                meterState.HandoffInProgress = false;
                handoffBtn.IsEnabled = true;
            }
        }

        /// <summary>Git #816 — injects the builder buttons into ClaudeWebView BEFORE navigating it to claude.ai for the first time (the XAML Source binding that used to do this navigated too early).</summary>
        private async System.Threading.Tasks.Task InitializeClaudeTabAsync()
        {
            await InjectBuilderButtonsAsync(ClaudeWebView);
            if (ClaudeWebView.CoreWebView2 != null) ClaudeWebView.CoreWebView2.Navigate("https://claude.ai");
            else ClaudeWebView.Source = new Uri("https://claude.ai");
        }

        /// <summary>
        /// Git #814 — the injected script's bridge back to the app (it can't
        /// reach chrome.runtime/chrome.storage since it isn't a browser
        /// extension). BT_SEND_TO_BUILDER reuses the exact same mybuilder://
        /// URI + OS-registered handler the browser extension already
        /// launches through, so behavior stays identical either way.
        /// BT_QUEUE_BUILD calls the real queue API directly (the app already
        /// holds the same client BuildQueuePanel/LeftSidebar use).
        /// </summary>
        /// <summary>
        /// Git #1480 — opens EditBuildPromptDialog and processes its result (Send to
        /// Builder / Add to Build Queue), identically whether the raw prompt came from
        /// a chat-injected "Edit Build" click (<paramref name="rawText"/> seeded, a real
        /// <paramref name="referencedNumber"/>) or the Build Queue header's paste-prompt
        /// button (both empty — the dialog's own header-flag parser reads whatever gets
        /// pasted into the prompt editor, honoring --model/--effort/--title/--buildSet/
        /// --account/--blocked-by/--block-by/--notGit exactly the same either way).
        /// Extracted verbatim from the former BT_EDIT_BUILD handler body.
        /// </summary>
        /// <summary>
        /// Git #1638 — locked decision on the "should Send to Builder be tracked?" open
        /// question: YES, but purely for dedup/visibility/log-capture, never pulled into
        /// the normal queue/watcher/slot pipeline. Behaviorally identical launch (external
        /// mybuilder:// Process.Start, outside the 8-slot cap, hands-off --permission-mode
        /// auto) — the only addition is inserting a real bt_build_queue row with status
        /// 'external' first (via QueueExternalAsync, a plain insert never claimed by
        /// BuildQueuePostgresClient.GetNextAsync's WHERE status = 'queued' or by
        /// BuildWatchWindow.AdmitNewRunning's WHERE status == "running") and passing its
        /// id through as queueId= so scripts/run-claude.ps1 can redirect this launch's real
        /// stdout/stderr into that same id's BuildLogPaths.ForQueueItem log file and write
        /// the real exit code back when it finishes. Never blocks the launch — a missing
        /// DATABASE_URL means no tracking row, not a refused launch, exactly like every
        /// other "not connected" fallback in this file.
        /// </summary>
        private async System.Threading.Tasks.Task LaunchSendToBuilderAsync(
            string? prompt, string? title, string? model, string? effort, string? cwd, string? mode, string? buildSet, string? chatUrl)
        {
            int? queueId = null;
            if (_queueDb != null && !string.IsNullOrWhiteSpace(prompt))
            {
                try
                {
                    var row = await _queueDb.QueueExternalAsync(title ?? "Untitled", prompt, model, effort, cwd, chatUrl);
                    queueId = row.Id;
                    BuildConsole.Services.ActivityLog.Log("build-queue-panel.external",
                        $"Send to Builder: tracked queue #{queueId} ({title ?? "Untitled"}) as external — outside the 8-slot cap, not watcher-claimable.");
                    try { await BuildQueuePanel.RefreshAsync(); } catch { /* best-effort visual refresh */ }
                }
                catch (Exception ex)
                {
                    BuildConsole.Services.ActivityLog.Log("build-queue-panel.external",
                        $"Send to Builder: couldn't insert tracking row for \"{title}\" — launching untracked. {ex.Message}");
                }
            }

            var q = new List<string>();
            void Add(string key, string? val) { if (!string.IsNullOrEmpty(val)) q.Add($"{key}={Uri.EscapeDataString(val)}"); }
            Add("q", prompt);
            Add("title", title);
            Add("model", model);
            Add("effort", effort);
            Add("cwd", cwd);
            Add("mode", mode);
            Add("buildSet", buildSet);
            if (queueId.HasValue) Add("queueId", queueId.Value.ToString());
            var uri = $"mybuilder://open?{string.Join("&", q)}";
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri) { UseShellExecute = true });
        }

        private async System.Threading.Tasks.Task OpenBuildPromptDialogAsync(string rawText, int? referencedNumber)
        {
            var dialog = new EditBuildPromptDialog(rawText, referencedNumber, _buildTrackerApi, LeftSidebar.CurrentBoardIssues);
            dialog.Owner = this;
            if (dialog.ShowDialog() != true) return;

            if (dialog.ActionChosen == EditBuildAction.SendToBuilder)
            {
                await LaunchSendToBuilderAsync(
                    dialog.FinalPrompt, dialog.FinalTitle, dialog.FinalModel, dialog.FinalEffort,
                    dialog.FinalCwd, dialog.FinalMode, dialog.FinalBuildSet, chatUrl: null);
            }
            else if (dialog.ActionChosen == EditBuildAction.QueueBuild)
            {
                if (_queueDb == null)
                {
                    ToastEngine.Warning("Queue Build", "Not connected — no DATABASE_URL found (see Settings).");
                    return;
                }

                // Local-id resolution: a --notGit build is handed the next unused
                // letter id; --block-by letters resolve through the registry; a bare
                // number with no --notGit is verified against real GitHub (detection).
                var (dialogGithubNum, dialogBlockedByNums, editStop) =
                    await ResolveLocalBuildIdentityAsync(
                        dialog.FinalIsLocalBuild, dialog.FinalGithubNumber,
                        dialog.FinalGitBlockers, dialog.FinalLocalBlockers);
                if (editStop) return;

                try
                {
                    await _queueDb.QueueBuildAsync(
                        dialog.FinalTitle ?? "Untitled", dialog.FinalPrompt, dialog.FinalModel, dialog.FinalEffort, dialog.FinalCwd,
                        dialogGithubNum, dialogBlockedByNums, buildSet: dialog.FinalBuildSet, cli: dialog.FinalCli, account: dialog.FinalAccount);
                    var editIdLabel = dialogGithubNum.HasValue ? BuildConsole.Services.LocalBuildId.FormatRef(dialogGithubNum.Value) : "";
                    ToastEngine.Success("Build Queued",
                        $"Queued '{dialog.FinalTitle ?? "Build"}'{(editIdLabel.Length > 0 ? $" as {editIdLabel}" : "")} successfully.");
                    try { await BuildQueuePanel.RefreshAsync(); } catch { }
                }
                catch (Exception ex)
                {
                    ToastEngine.Error("Queue Build", $"Failed to queue build: {ex.Message}");
                }
            }
        }

        private async void ChatWv_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                string type = root.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "";

                string? Str(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
                int? Int(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetInt32() : null;
                bool Bool(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.True;

                if (type == "BT_CHAT_STATS")
                {
                    var activeWv = sender as Microsoft.Web.WebView2.Wpf.WebView2;
                    if (activeWv != null)
                    {
                        int turnCount = Int("turnCount") ?? 0;
                        int charCount = Int("charCount") ?? 0;
                        int heavyTurnCount = Int("heavyTurnCount") ?? 0;
                        bool selectorsLikelyStale = Bool("selectorsLikelyStale");
                        // Git #1628 — the conversation the accumulator is keyed to; drives the
                        // per-conversation high-water clamp/persist inside UpdateContextMeter.
                        string? conversationId = Str("conversationId");

                        double estTokens = charCount / 4.0;

                        UpdateContextMeter(activeWv, estTokens, turnCount, heavyTurnCount, selectorsLikelyStale, conversationId);
                    }
                }
                else if (type == "BT_EDIT_BUILD")
                {
                    string rawText = Str("rawText") ?? "";
                    int? referencedNumber = Int("referencedNumber");
                    await OpenBuildPromptDialogAsync(rawText, referencedNumber);
                }
                else if (type == "BT_SEND_TO_BUILDER")
                {
                    await LaunchSendToBuilderAsync(
                        Str("prompt"), Str("title"), Str("model"), Str("effort"),
                        Str("cwd"), Str("mode"), buildSet: null, chatUrl: Str("chatUrl"));
                }
                else if (type == "BT_QUEUE_BUILD")
                {
                    // Git #942 — the token the injected button tagged itself with
                    // so we can find that exact element again to tag it with the
                    // real queue id (or reset it if the queue call fails).
                    string? correlation = Str("correlation");
                    string? chatUrl = Str("chatUrl");
                    int? githubNum = Int("githubNumber");
                    string? buildSet = Str("buildSet");
                    // Git #1638 — the injected Park button reuses this same handler with an
                    // added `park: true` flag rather than a whole second message type (chosen
                    // over a separate BT_PARK_BUILD because every other field — resolving the
                    // local-build id, blockers, account, dedup — is identical either way).
                    bool park = Bool("park");
                    string promptText = Str("prompt") ?? "";
                    // Git #1419 — a chat-button build carries no `--account` flag of its own; fall
                    // back to the title-bar toggle's current global default instead of always primary.
                    string? accountFlag = Str("account") ?? ResolveDefaultAccountFlag();
                    string? originatingChatId = null;
                    if (EditorTabs.SelectedItem is TabItem selected)
                    {
                        if (selected.Tag is BuildConsole.Services.BoardChat activeChat)
                        {
                            originatingChatId = activeChat.ConversationId;
                        }
                        else if (selected.Tag is string tagUrl)
                        {
                            var match = System.Text.RegularExpressions.Regex.Match(tagUrl, @"/chat/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})");
                            if (match.Success)
                            {
                                originatingChatId = match.Groups[1].Value;
                            }
                        }
                    }
                    if (!string.IsNullOrWhiteSpace(chatUrl))
                    {
                        BuildConsole.Services.ChatUrlStore.SetChatUrl(null, githubNum, chatUrl);
                    }
                    if (_queueDb == null)
                    {
                        ToastEngine.Warning("Queue Build", "Not connected — no DATABASE_URL found (see Settings).");
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                        return;
                    }
                    // Letter-aware inputs from the injected chat button (with legacy fallbacks):
                    //   localBuild        -> --notGit present; allocate the next letter id
                    //   gitBlockers[]     -> --blocked-by GitHub issue numbers
                    //   localBlockers[]   -> --block-by LOCAL letter ids (A, AB…)
                    bool localBuild = false;
                    if (root.TryGetProperty("localBuild", out var lbEl) &&
                        (lbEl.ValueKind == System.Text.Json.JsonValueKind.True || lbEl.ValueKind == System.Text.Json.JsonValueKind.False))
                        localBuild = lbEl.GetBoolean();

                    var gitBlockerTokens = ReadStringArray(root, "gitBlockers");
                    var localBlockerTokens = ReadStringArray(root, "localBlockers");

                    // Backward compat: an older injected script may still send numeric
                    // blockedByNumbers and/or a negative githubNumber. Fold those in.
                    if (root.TryGetProperty("blockedByNumbers", out var arr) && arr.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        foreach (var x in arr.EnumerateArray())
                        {
                            if (x.ValueKind != System.Text.Json.JsonValueKind.Number || !x.TryGetInt32(out var n)) continue;
                            if (n > 0) gitBlockerTokens.Add(n.ToString());
                            else if (n < 0) localBlockerTokens.Add((-n).ToString());
                        }
                    }
                    if (!localBuild && githubNum is < 0) { localBuild = true; githubNum = null; }

                    var (resolvedGithubNum, blockedByNumbers, queueStop) =
                        await ResolveLocalBuildIdentityAsync(localBuild, githubNum, gitBlockerTokens, localBlockerTokens);
                    if (queueStop)
                    {
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                        return;
                    }
                    githubNum = resolvedGithubNum;

                    // Git #1638 — generalized, VISIBLE dedup check shared by Queue and Park,
                    // run right before either would insert a new row. An active match (still
                    // queued/parked/running/verifying/limit-paused/external) is surfaced on
                    // the button instead of silently duplicated; a terminal match (done/
                    // failed/canceled) gets an explicit "run it again?" confirm instead of
                    // the old silent reset.
                    int? reuseRowId = null;
                    var dedupMatch = await _queueDb.FindDedupCandidateAsync(githubNum, promptText);
                    if (dedupMatch != null)
                    {
                        if (BuildConsole.Services.BuildQueuePostgresClient.IsActiveStatus(dedupMatch.Status))
                        {
                            string dupLabel = dedupMatch.Status switch
                            {
                                "parked" => "📥 Already Parked",
                                BuildConsole.Services.AccountCapPolicy.CappedStatus => "Already Capped",
                                "running" => "▶ Already Running",
                                "external" => "🚀 Already Sent",
                                BuildConsole.Services.SessionLimitAutoRestartService.LimitPausedStatus => "⏸ Already Paused",
                                _ when dedupMatch.Status == BuildConsole.Services.BuildQueuePostgresClient.VerifyingStatus => "🔎 Already Verifying",
                                _ => "📋 Already Queued",
                            };
                            BuildConsole.Services.ActivityLog.Log("build-queue-panel.dedup",
                                $"{(park ? "Park" : "Queue")} click for \"{Str("title")}\" matched existing active queue #{dedupMatch.Id} ({dedupMatch.Status}) — surfaced instead of duplicating.");
                            if (correlation != null)
                                await RunScriptInAllChatWebViewsAsync($"window.__btAlreadyExists && window.__btAlreadyExists({JsLiteral(correlation)}, {dedupMatch.Id}, {JsLiteral(dupLabel)});");
                            return;
                        }
                        if (BuildConsole.Services.BuildQueuePostgresClient.IsTerminalStatus(dedupMatch.Status))
                        {
                            string statusWord = dedupMatch.Status switch { "done" => "Done", "failed" => "Failed", _ => "Canceled" };
                            string agoText = "earlier";
                            if (dedupMatch.UpdatedAt.HasValue)
                            {
                                var elapsed = DateTimeOffset.UtcNow - dedupMatch.UpdatedAt.Value;
                                agoText = elapsed.TotalHours >= 1 ? $"{(int)elapsed.TotalHours}h {elapsed.Minutes}m ago" : $"{Math.Max(1, (int)elapsed.TotalMinutes)}m ago";
                            }
                            var confirmResult = System.Windows.MessageBox.Show(this,
                                $"“{dedupMatch.Title}” already ran — {statusWord} {agoText}. Run it again?",
                                park ? "Already Ran — Park Again?" : "Already Ran — Run Again?",
                                MessageBoxButton.YesNo, MessageBoxImage.Question);
                            if (confirmResult != MessageBoxResult.Yes)
                            {
                                BuildConsole.Services.ActivityLog.Log("build-queue-panel.dedup",
                                    $"{(park ? "Park" : "Queue")} click for \"{Str("title")}\" declined re-run of terminal queue #{dedupMatch.Id} ({dedupMatch.Status}).");
                                if (correlation != null)
                                    await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                                return;
                            }
                            reuseRowId = dedupMatch.Id;
                            BuildConsole.Services.ActivityLog.Log("build-queue-panel.dedup",
                                $"Re-{(park ? "parking" : "queuing")} terminal queue #{dedupMatch.Id} ({dedupMatch.Status}) via explicit confirm.");
                        }
                    }

                    BuildConsole.Services.QueueItem queued;
                    try
                    {
                        queued = await _queueDb.QueueBuildAsync(
                            Str("title") ?? "Untitled", promptText, Str("model"), Str("effort"), Str("cwd"), githubNum, blockedByNumbers, chatUrl: chatUrl, originatingChatId: originatingChatId, buildSet: buildSet, cli: Str("cli"), account: accountFlag, park: park, reuseRowId: reuseRowId);
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error(park ? "Park Build" : "Queue Build", $"Couldn't {(park ? "park" : "queue")} build: {ex.Message}");
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                        return;
                    }

                    {
                        // Git #942 (queue) / #1638 (park) — tag the exact button with the real
                        // queue id and start tracking so the existing chat-tab queue poll
                        // (PollChatTabBuildStateAsync) pushes live status onto it.
                        int qid = queued.Id;
                        string title = Str("title") ?? "Untitled";
                        string initialLabel = park ? "📥 Parked" : "In Progress...";
                        _chatButtonStatus[qid] = initialLabel;
                        BuildConsole.Services.ActivityLog.Log("chat-button.status",
                            $"queue #{qid} ({title}): {(park ? "queued -> Parked" : "queued -> In Progress...")} (now tracking)");
                        BuildConsole.Services.ActivityLog.Log("build-queue",
                            park ? $"Parked queue item #{qid} ({title})." : $"Queued build item #{qid} ({title}).");
                        if (!string.IsNullOrWhiteSpace(chatUrl))
                        {
                            BuildConsole.Services.ChatUrlStore.SetChatUrl(qid, githubNum, chatUrl);
                        }
                        if (correlation != null)
                        {
                            string tagFn = park ? "__btTagParked" : "__btTagQueued";
                            await RunScriptInAllChatWebViewsAsync($"window.{tagFn} && window.{tagFn}({JsLiteral(correlation)}, {qid});");
                        }
                        await BuildQueuePanel.RefreshAsync();
                    }
                }
                else if (type == "BT_REVEAL_QUEUE_ITEM")
                {
                    // Git #1638 — the dedup check found an existing item and the injected
                    // button was tagged clickable-but-not-duplicating; this jumps the Build
                    // Queue panel to it instead of creating a second row.
                    int? revealId = Int("queueId");
                    if (revealId.HasValue)
                        BuildQueuePanel.RevealQueueItem(revealId.Value);
                }
                else if (type == "BT_LOAD_SQL")
                {
                    var sqlText = Str("sql") ?? "";

                    // Find the chat tab that received this message or is currently selected
                    ChatTabState? chatState = null;
                    TabItem? chatTab = null;

                    foreach (var kvp in _chatTabs)
                    {
                        if (kvp.Value.WebView?.CoreWebView2 == sender || ReferenceEquals(kvp.Value.WebView, sender))
                        {
                            chatTab = kvp.Key;
                            chatState = kvp.Value;
                            break;
                        }
                    }

                    if (chatState == null)
                    {
                        foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
                        {
                            if (pane.SelectedItem is TabItem sel && _chatTabs.TryGetValue(sel, out var state))
                            {
                                chatTab = sel;
                                chatState = state;
                                break;
                            }
                        }
                    }

                    if (chatState != null)
                    {
                        if (chatState.InlineSqlRunner != null)
                        {
                            chatState.InlineSqlRunner.SetSqlQuery(sqlText);
                            if (chatState.SqlColumn != null)
                                chatState.SqlColumn.Width = new GridLength(1, GridUnitType.Star);
                        }
                        else
                        {
                            var inlineSql = new Controls.SqlDocumentView();
                            inlineSql.Initialize(_buildTrackerApi);
                            inlineSql.IsInline = true;
                            inlineSql.SetSqlQuery(sqlText);
                            WireSqlRunnerSendToChat(inlineSql);

                            var sqlCol = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
                            chatState.SplitGrid.ColumnDefinitions.Add(sqlCol);
                            int colIndex = chatState.SplitGrid.ColumnDefinitions.Count - 1;

                            var sqlSplitter = new GridSplitter
                            {
                                Width = 4,
                                HorizontalAlignment = HorizontalAlignment.Left,
                                VerticalAlignment = VerticalAlignment.Stretch,
                                ResizeBehavior = GridResizeBehavior.PreviousAndNext
                            };

                            Grid.SetColumn(sqlSplitter, colIndex);
                            Grid.SetColumn(inlineSql, colIndex);
                            chatState.SplitGrid.Children.Add(sqlSplitter);
                            chatState.SplitGrid.Children.Add(inlineSql);

                            chatState.InlineSqlRunner = inlineSql;
                            chatState.SqlSplitter = sqlSplitter;
                            chatState.SqlColumn = sqlCol;

                            inlineSql.CloseRequested += (s, ev) =>
                            {
                                chatState.SplitGrid.Children.Remove(sqlSplitter);
                                chatState.SplitGrid.Children.Remove(inlineSql);
                                chatState.SplitGrid.ColumnDefinitions.Remove(sqlCol);
                                chatState.InlineSqlRunner = null;
                                chatState.SqlSplitter = null;
                                chatState.SqlColumn = null;
                            };
                        }
                    }
                    else
                    {
                        // Fallback if triggered from a non-chat tab
                        OpenSqlRunnerTab().SetSqlQuery(sqlText);
                    }
                }
                // ── Git #1253: issue-mention hover / click handlers ───────────────────
                else if (type == "BT_OPEN_ISSUE")
                {
                    int? issueNum = Int("number");
                    if (issueNum.HasValue && issueNum.Value > 0)
                    {
                        ActivityLog.Log("chat.issue-mention", $"BT_OPEN_ISSUE #{issueNum}");
                        await OpenGitDetailByNumberAsync(issueNum.Value);
                    }
                }
                else if (type == "BT_HOVER_ISSUE")
                {
                    int? issueNum = Int("number");
                    if (!issueNum.HasValue || issueNum.Value <= 0) return;
                    int n = issueNum.Value;

                    // Find the sender WebView so we push the tooltip back into the right tab
                    Microsoft.Web.WebView2.Wpf.WebView2? senderWv = null;
                    foreach (var kvp in _chatTabs)
                    {
                        if (ReferenceEquals(kvp.Value.WebView, sender) ||
                            kvp.Value.WebView?.CoreWebView2 == sender)
                        {
                            senderWv = kvp.Value.WebView;
                            break;
                        }
                    }
                    if (senderWv == null && ClaudeWebView.CoreWebView2 == sender)
                        senderWv = ClaudeWebView;

                    if (senderWv == null) return;

                    // Git #2080 — resolution (cache/live-fetch) + the state-aware action payload
                    // (Dispatch/Cancel/Retry/Open/Reply, same classification #2061 built for the
                    // Git Board popover) now share one implementation with FloatingChatWindow.
                    try
                    {
                        string js = await BuildConsole.Services.ChatMentionPopupHelper.BuildShowTipScriptAsync(n, LeftSidebar);
                        await senderWv.ExecuteScriptAsync(js);
                        ActivityLog.Log("chat.issue-mention", $"BT_HOVER_ISSUE #{n}");
                    }
                    catch { }
                }
                else if (type == "BT_UNHOVER_ISSUE")
                {
                    // Tooltip hide is handled entirely in JS; nothing to do on the C# side.
                }
                // ── Git #2080: chat-mention popup's state-aware action buttons ────────────
                else if (type == "BT_ISSUE_ACTION")
                {
                    int? issueNum = Int("number");
                    int? buildId  = Int("buildId");
                    string? action = Str("action");
                    if (!issueNum.HasValue || issueNum.Value <= 0 || string.IsNullOrWhiteSpace(action)) return;
                    int n = issueNum.Value;

                    ActivityLog.Log("chat.issue-mention",
                        $"BT_ISSUE_ACTION #{n}: {action}{(buildId.HasValue ? $" (build {buildId})" : "")}");

                    if (action == "dispatchask")
                    {
                        var issue = LeftSidebar.BuildDetailIssue(n)
                            ?? new BuildConsole.Controls.GitIssue { IssueNumber = n, Title = $"#{n}", RawTitle = $"#{n}" };
                        await LeftSidebar.DispatchOrAskActiveChatAsync(issue);
                        return;
                    }

                    var build = buildId.HasValue
                        ? BuildQueuePanel.CurrentQueueItems.FirstOrDefault(i => i.Id == buildId.Value)
                        : LeftSidebar.FindAssociatedBuild(n);
                    if (build == null) return;

                    switch (action)
                    {
                        case "dispatch": await BuildQueuePanel.QuickDispatchAsync(build); break;
                        case "cancel": await BuildQueuePanel.QuickCancelOrStopAsync(build); break;
                        case "retry": await BuildQueuePanel.QuickRetryAsync(build); break;
                        case "openbuild":
                        case "openchat": BuildQueuePanel.QuickOpenChat(build); break;
                        case "reply":
                        {
                            string? message = Str("message");
                            if (!string.IsNullOrWhiteSpace(message)) await BuildQueuePanel.QuickReplyAsync(build, message);
                            break;
                        }
                    }
                }
                // ── Git #2066: live per-chat "every #NNN this chat has mentioned" registry ──
                else if (type == "BT_ISSUE_MENTIONS_SCAN")
                {
                    string? convId = Str("conversationId");
                    if (string.IsNullOrWhiteSpace(convId)) return;
                    if (!root.TryGetProperty("numbers", out var numsEl) || numsEl.ValueKind != System.Text.Json.JsonValueKind.Array) return;

                    var numbers = new List<int>();
                    foreach (var x in numsEl.EnumerateArray())
                    {
                        if (x.ValueKind == System.Text.Json.JsonValueKind.Number && x.TryGetInt32(out var n) && n > 0)
                            numbers.Add(n);
                    }
                    if (numbers.Count == 0) return;

                    // Git #2691 — remember every number this scan has ever surfaced (not just this
                    // delta) so the QueueRefreshed-driven re-push (PushLiveMentionColorsAsync) knows
                    // which numbers are actually on screen somewhere and worth recoloring later.
                    BuildConsole.Services.LiveMentionNumberRegistry.Track(numbers);

                    // Git #2134 — eager color-by-type/status for these newly-on-screen mentions,
                    // straight off the same cache BT_HOVER_ISSUE already resolves from (no live
                    // GitHub fetch for a whole batch). Independent of _queueDb below.
                    try
                    {
                        string? colorJs = BuildConsole.Services.ChatMentionPopupHelper.BuildSetMentionColorsScript(numbers, LeftSidebar);
                        if (colorJs != null)
                        {
                            Microsoft.Web.WebView2.Wpf.WebView2? colorSenderWv = null;
                            foreach (var kvp in _chatTabs)
                            {
                                if (ReferenceEquals(kvp.Value.WebView, sender) ||
                                    kvp.Value.WebView?.CoreWebView2 == sender)
                                {
                                    colorSenderWv = kvp.Value.WebView;
                                    break;
                                }
                            }
                            if (colorSenderWv == null && ClaudeWebView.CoreWebView2 == sender)
                                colorSenderWv = ClaudeWebView;
                            if (colorSenderWv != null) await colorSenderWv.ExecuteScriptAsync(colorJs);
                        }
                    }
                    catch { }

                    if (_queueDb == null) return;

                    string chatUrl = $"https://claude.ai/chat/{convId}";
                    try
                    {
                        await _queueDb.RecordChatIssueMentionsAsync(chatUrl, numbers);
                        ActivityLog.Log("chat.issue-mention", $"BT_ISSUE_MENTIONS_SCAN {chatUrl}: {string.Join(", ", numbers.Select(n => $"#{n}"))}");
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("chat.issue-mention", $"BT_ISSUE_MENTIONS_SCAN FAILED for {chatUrl}: {ex.Message}");
                    }
                }
                else if (type == "BT_OPEN_SQL_FILE")
                {
                    string? fileParam = Str("file");
                    if (!string.IsNullOrEmpty(fileParam))
                    {
                        ActivityLog.Log("chat.sql-mention", $"BT_OPEN_SQL_FILE: {fileParam}");
                        await OpenSqlFileInInlineRunnerAsync(sender, fileParam);
                    }
                }
            }
            catch { }
        }

        /// <summary>Git #931 — true when a non-2xx response is really Replit's own "wake up the app"
        /// dev-server-nap placeholder page (HTML) rather than a genuine JSON API error, so callers can
        /// show a short human message and retry instead of dumping the raw page markup into a dialog.</summary>
        private static bool IsLikelyDevServerNapHtml(HttpResponseMessage res, string body)
        {
            var mediaType = res.Content.Headers.ContentType?.MediaType;
            if (!string.IsNullOrEmpty(mediaType) && mediaType.Contains("html", StringComparison.OrdinalIgnoreCase))
                return true;
            var trimmed = body.TrimStart();
            return trimmed.StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("<html", StringComparison.OrdinalIgnoreCase);
        }

        private async System.Threading.Tasks.Task OpenSqlFileInInlineRunnerAsync(object? sender, string fileParam)
        {
            string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
            if (string.IsNullOrEmpty(repoRoot))
            {
                // Git #1985 — was a bare `return`: the user clicked "open in SQL Runner" and
                // nothing happened, with no feedback at all. Log it so it's at least traceable.
                BuildConsole.Services.ActivityLog.Log("system.core", $"Cannot open '{fileParam}' in the inline SQL Runner: repo root not found.");
                return;
            }

            string fileName = Path.GetFileName(fileParam);
            string? targetPath = null;

            // Search for the file recursively starting from repoRoot
            try
            {
                // First check if it's a direct path relative to repoRoot
                string directPath = Path.Combine(repoRoot, fileParam.Replace('/', '\\'));
                if (File.Exists(directPath))
                {
                    targetPath = directPath;
                }
                else
                {
                    // Scan recursively
                    var files = Directory.GetFiles(repoRoot, fileName, SearchOption.AllDirectories);
                    if (files.Length > 0)
                    {
                        targetPath = files[0];
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.sql-mention", $"Error finding SQL file {fileParam}: {ex.Message}");
            }

            if (targetPath == null)
            {
                ToastEngine.Warning("SQL File Not Found", $"Could not find SQL file '{fileParam}' in the repository.");
                return;
            }

            // Read the SQL content
            string sqlContent;
            try
            {
                sqlContent = await File.ReadAllTextAsync(targetPath);
            }
            catch (Exception ex)
            {
                ToastEngine.Error("SQL Read Error", $"Could not read SQL file: {ex.Message}");
                return;
            }

            // Open in SQL inline runner of the active chat tab
            // Find the chat tab that received this message
            ChatTabState? chatState = null;
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Value.WebView?.CoreWebView2 == sender || ReferenceEquals(kvp.Value.WebView, sender))
                {
                    chatState = kvp.Value;
                    break;
                }
            }

            if (chatState == null)
            {
                // Fallback: check selected tab
                foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
                {
                    if (pane.SelectedItem is TabItem sel && _chatTabs.TryGetValue(sel, out var state))
                    {
                        chatState = state;
                        break;
                    }
                }
            }

            if (chatState != null)
            {
                if (chatState.InlineSqlRunner != null)
                {
                    chatState.InlineSqlRunner.SetSqlQuery(sqlContent);
                    if (chatState.SqlColumn != null)
                        chatState.SqlColumn.Width = new GridLength(1, GridUnitType.Star);
                }
                else
                {
                    var inlineSql = new Controls.SqlDocumentView();
                    inlineSql.Initialize(_buildTrackerApi);
                    inlineSql.IsInline = true;
                    inlineSql.SetSqlQuery(sqlContent);
                    WireSqlRunnerSendToChat(inlineSql);

                    var sqlCol = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
                    chatState.SplitGrid.ColumnDefinitions.Add(sqlCol);
                    int colIndex = chatState.SplitGrid.ColumnDefinitions.Count - 1;

                    var sqlSplitter = new GridSplitter
                    {
                        Width = 4,
                        HorizontalAlignment = HorizontalAlignment.Left,
                        VerticalAlignment = VerticalAlignment.Stretch,
                        ResizeBehavior = GridResizeBehavior.PreviousAndNext
                    };

                    Grid.SetColumn(sqlSplitter, colIndex);
                    Grid.SetColumn(inlineSql, colIndex);
                    chatState.SplitGrid.Children.Add(sqlSplitter);
                    chatState.SplitGrid.Children.Add(inlineSql);

                    chatState.InlineSqlRunner = inlineSql;
                    chatState.SqlSplitter = sqlSplitter;
                    chatState.SqlColumn = sqlCol;

                    inlineSql.CloseRequested += (s, ev) =>
                    {
                        chatState.SplitGrid.Children.Remove(sqlSplitter);
                        chatState.SplitGrid.Children.Remove(inlineSql);
                        chatState.SplitGrid.ColumnDefinitions.Remove(sqlCol);
                        chatState.InlineSqlRunner = null;
                        chatState.SqlSplitter = null;
                        chatState.SqlColumn = null;
                    };
                }
            }
            else
            {
                // Fallback if not inside a chat tab
                OpenSqlRunnerTab().SetSqlQuery(sqlContent);
            }
        }

        // ── Menu: Help ────────────────────────────────────────────────────────
        private void OpenDevTools_Click(object sender, RoutedEventArgs e)
            => GetActiveWebView().CoreWebView2?.OpenDevToolsWindow();

        private void CheerMeUp_Click(object sender, RoutedEventArgs e)
            => BuildConsole.Services.EncouragementService.Instance.TriggerCheerNow();

        // ── Git #821: Release build button ───────────────────────────────────
        private System.Diagnostics.Process? _releaseBuildProcess;

        /// <summary>
        /// Shane: "a play button someplace that lets me click it, that kicks
        /// off a build of the BuildConsole in Production mode so I can use it
        /// to build stuff while we work on building this out more." Runs
        /// `dotnet build --configuration Release` for THIS project as a real
        /// background process (redirected output streamed to ActivityLog /
        /// the Output tab, same place #815's activity log already lives) -
        /// never blocks the UI thread. Deliberately a separate `bin\Release`
        /// output from the `bin\Debug` this dev instance runs from, so a
        /// Release build can finish and be launched separately while this
        /// Debug instance keeps running for further work.
        /// </summary>
        private void BuildRelease_Click(object sender, RoutedEventArgs e)
        {
            if (_releaseBuildProcess != null && !_releaseBuildProcess.HasExited)
            {
                BuildConsole.Services.ActivityLog.Log("release-build", "Already running - ignoring click.");
                return;
            }

            // Git #1985 — audited, genuinely tolerable: the fallback is derived from this app's
            // own known build-output layout (not an arbitrary hardcoded machine path), and the
            // resolved projectDir is logged right below either way, so a wrong guess is visible.
            string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
            string projectDir = repoRoot != null
                ? Path.Combine(repoRoot, "desktop", "BuildConsole")
                : Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..")); // bin\Debug\net7.0-windows -> project dir

            BuildConsole.Services.ActivityLog.Log("release-build", $"Starting: dotnet build --configuration Release ({projectDir})");
            SetBottomPanel(true, tabIndex: 5); // Output tab

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "dotnet",
                WorkingDirectory = projectDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("build");
            psi.ArgumentList.Add("--configuration");
            psi.ArgumentList.Add("Release");

            var proc = new System.Diagnostics.Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (_, args) => { if (args.Data != null) BuildConsole.Services.ActivityLog.Log("release-build", args.Data); };
            proc.ErrorDataReceived += (_, args) => { if (args.Data != null) BuildConsole.Services.ActivityLog.Log("release-build", args.Data); };
            proc.Exited += (_, _) =>
            {
                Dispatcher.BeginInvoke(() =>
                {
                    bool ok = proc.ExitCode == 0;
                    BuildConsole.Services.ActivityLog.Log("release-build", ok
                        ? $"Succeeded (exit 0) - bin\\Release\\net7.0-windows\\BuildConsole.exe"
                        : $"FAILED (exit {proc.ExitCode}) - see output above.");
                });
            };

            _releaseBuildProcess = proc;
            try
            {
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("release-build", $"Couldn't start: {ex.Message}");
            }
        }

        // Command Palette / Universal Search (Ctrl+K) - see MainWindow.UniversalSearch.cs
        // ── SPLIT SCREEN GRID LAYOUT ENGINE ────────────────────────────────
        private string _currentLayoutMode = "Single";

        private void BtnLayout_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string mode)
            {
                SetLayoutMode(mode);
            }
        }

        private void DockTarget_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string mode)
            {
                SetLayoutMode(mode.StartsWith("SplitH") ? "SplitH" : mode);
                DockGuideOverlay.Visibility = Visibility.Collapsed;
            }
        }

        public void SetLayoutMode(string mode)
        {
            ApplyGridForMode(mode);

            switch (mode)
            {
                case "Single":
                    // Move all items back to EditorTabs
                    MoveAllTabsToTarget(EditorTabs2, EditorTabs);
                    MoveAllTabsToTarget(EditorTabs3, EditorTabs);
                    MoveAllTabsToTarget(EditorTabs4, EditorTabs);
                    break;

                case "SplitH": // 2 Columns (Side by Side)
                    DistributeTabsBetweenPanes(EditorTabs, EditorTabs2);
                    break;

                case "SplitV": // 2 Rows (Top / Bottom)
                    DistributeTabsBetweenPanes(EditorTabs, EditorTabs3);
                    break;

                case "Grid4": // 4 Squares Layout
                    DistributeTabsTo4Grid(EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4);
                    break;
            }
        }

        /// <summary>
        /// Git #893 — Shane: "I need to be able to drag and drop tabs into
        /// different layouts." Extracted from SetLayoutMode's original body:
        /// just the grid row/column/splitter/pane-visibility math, with NO
        /// tab redistribution. SetLayoutMode (the toolbar buttons) still does
        /// both together, unchanged behavior; the drag-and-drop path below
        /// calls ONLY this - it wants to reveal a pane and move the ONE
        /// dragged tab into it, not scramble every other open tab's
        /// placement the way the toolbar buttons intentionally do.
        /// </summary>
        private void ApplyGridForMode(string mode)
        {
            _currentLayoutMode = mode;

            switch (mode)
            {
                case "Single":
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(0);
                    PaneCol1.Width = new GridLength(0);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(0);
                    PaneRow1.Height = new GridLength(0);

                    PaneGridSplitterH.Visibility = Visibility.Collapsed;
                    PaneGridSplitterV.Visibility = Visibility.Collapsed;

                    EditorTabs2.Visibility = Visibility.Collapsed;
                    EditorTabs3.Visibility = Visibility.Collapsed;
                    EditorTabs4.Visibility = Visibility.Collapsed;
                    break;

                case "SplitH": // 2 Columns (Side by Side)
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(4);
                    PaneCol1.Width = new GridLength(1, GridUnitType.Star);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(0);
                    PaneRow1.Height = new GridLength(0);

                    PaneGridSplitterH.Visibility = Visibility.Visible;
                    PaneGridSplitterV.Visibility = Visibility.Collapsed;

                    EditorTabs2.Visibility = Visibility.Visible;
                    EditorTabs3.Visibility = Visibility.Collapsed;
                    EditorTabs4.Visibility = Visibility.Collapsed;
                    break;

                case "SplitV": // 2 Rows (Top / Bottom)
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(0);
                    PaneCol1.Width = new GridLength(0);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(4);
                    PaneRow1.Height = new GridLength(1, GridUnitType.Star);

                    PaneGridSplitterH.Visibility = Visibility.Collapsed;
                    PaneGridSplitterV.Visibility = Visibility.Visible;

                    EditorTabs2.Visibility = Visibility.Collapsed;
                    EditorTabs3.Visibility = Visibility.Visible;
                    EditorTabs4.Visibility = Visibility.Collapsed;
                    break;

                case "Grid4": // 4 Squares Layout
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(4);
                    PaneCol1.Width = new GridLength(1, GridUnitType.Star);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(4);
                    PaneRow1.Height = new GridLength(1, GridUnitType.Star);

                    PaneGridSplitterH.Visibility = Visibility.Visible;
                    PaneGridSplitterV.Visibility = Visibility.Visible;

                    EditorTabs2.Visibility = Visibility.Visible;
                    EditorTabs3.Visibility = Visibility.Visible;
                    EditorTabs4.Visibility = Visibility.Visible;
                    break;
            }
        }

        private void MoveAllTabsToTarget(TabControl source, TabControl target)
        {
            var items = source.Items.OfType<TabItem>().ToList();
            foreach (var item in items)
            {
                source.Items.Remove(item);
                target.Items.Add(item);
            }
        }

        // ── Git #893: drag-and-drop tabs between panes / reorder within a pane ──
        private const string TabDragFormat = "BuildConsoleTabItem";
        private Point _tabDragStartPoint;
        private TabItem? _tabDragCandidate;

        /// <summary>
        /// Git #893 — wired alongside every AttachTabContextMenu call site.
        /// PreviewMouseMove only starts a REAL drag once the mouse has moved
        /// past the OS's own click/drag threshold (SystemParameters), so a
        /// plain click (select the tab, or hit the close button) is
        /// untouched - this never marks the initiating MouseDown as Handled.
        /// </summary>
        /// <summary>Git #1035 — Shane: "The document tabs still do not drag and drop.
        /// What does is the body of the document... Its like the TAB itself doesnt
        /// have the drag. If I use say the Epic document screen I can grab the body
        /// of that document and then it drags." The Epic detail screen is pure WPF
        /// content (GitDetailView, no WebView2 anywhere in it); every other kind of
        /// tab hosts a WebView2. That split is the tell: PreviewMouseLeftButtonDown
        /// never called CaptureMouse(), so once a drag gesture's cursor drifted even
        /// slightly off the header — trivially easy, since real drags rarely move in
        /// a perfectly straight horizontal line — a WebView2 (a native child HWND)
        /// sitting anywhere nearby steals ALL further mouse input the instant the
        /// cursor crosses into its bounds, and no more PreviewMouseMove ever reaches
        /// the TabItem again for that gesture; the OS drag-threshold check (further
        /// down) never gets a chance to fire again, so DoDragDrop never runs. A pure-
        /// WPF tab has no competing native HWND to steal capture, so it never hit
        /// this failure mode — matching exactly what Shane described. Fixed by
        /// explicitly capturing the mouse on the initiating MouseDown (the standard
        /// WPF idiom for manual drag-threshold-then-DoDragDrop, which this code was
        /// missing) and releasing it either on a plain click (MouseUp before the
        /// threshold crosses) or right before DoDragDrop takes over (which manages
        /// its own capture for the rest of the real OS-level drag). Kept the
        /// "tabs.drag" ActivityLog instrumentation from investigating this so any
        /// future regression here is diagnosable without another blind guess.</summary>
        private void AttachTabDragHandlers(TabItem tab)
        {
            tab.PreviewMouseLeftButtonDown += (s, e) =>
            {
                // Git #1035 — don't arm/capture for a click that's actually on the
                // close button (or any other interactive header child): capturing
                // the mouse on the TabItem itself would redirect the button's own
                // release-within-bounds Click logic to the ancestor instead,
                // silently breaking "close this tab" for the one click that
                // started here.
                if (e.OriginalSource is DependencyObject src)
                {
                    if (FindAncestorButton(src, tab) != null) return;
                    
                    // Git #1035 continued — don't arm/capture if the user clicked inside 
                    // the tab's CONTENT (e.g. a RichTextBox selecting text). The TabItem 
                    // itself visually represents ONLY the header. If the clicked element 
                    // isn't a visual descendant of the TabItem, it's in the ContentPresenter.
                    bool isVisualDescendant = false;
                    var current = src;
                    while (current != null)
                    {
                        if (ReferenceEquals(current, tab)) { isVisualDescendant = true; break; }
                        if (current is System.Windows.ContentElement ce)
                        {
                            current = System.Windows.LogicalTreeHelper.GetParent(ce);
                        }
                        else
                        {
                            current = System.Windows.Media.VisualTreeHelper.GetParent(current) ?? System.Windows.LogicalTreeHelper.GetParent(current);
                        }
                    }
                    if (!isVisualDescendant) return;
                }

                _tabDragStartPoint = e.GetPosition(null);
                _tabDragCandidate = tab;
                tab.CaptureMouse();
                BuildConsole.Services.ActivityLog.Log("tabs.drag", $"candidate armed: '{TabDragLabel(tab)}' at {_tabDragStartPoint}");
            };

            tab.PreviewMouseLeftButtonUp += (s, e) =>
            {
                if (ReferenceEquals(_tabDragCandidate, tab)) _tabDragCandidate = null;
                if (tab.IsMouseCaptured) tab.ReleaseMouseCapture();
            };

            tab.PreviewMouseMove += (s, e) =>
            {
                if (e.LeftButton != MouseButtonState.Pressed || !ReferenceEquals(_tabDragCandidate, tab)) return;

                var pos = e.GetPosition(null);
                if (Math.Abs(pos.X - _tabDragStartPoint.X) < SystemParameters.MinimumHorizontalDragDistance &&
                    Math.Abs(pos.Y - _tabDragStartPoint.Y) < SystemParameters.MinimumVerticalDragDistance)
                {
                    return;
                }

                _tabDragCandidate = null;
                BuildConsole.Services.ActivityLog.Log("tabs.drag", $"threshold crossed for '{TabDragLabel(tab)}' - starting DoDragDrop");

                // Release our manual capture — DoDragDrop runs its own modal loop
                // with its own capture for the rest of the real OS-level drag.
                if (tab.IsMouseCaptured) tab.ReleaseMouseCapture();

                // Nowhere else visible to drop this tab (still in Single-pane
                // mode) - show the dock-target overlay so dragging can reveal
                // a NEW pane to place it in. Already split? Skip the overlay
                // entirely; the visible panes themselves are real drop
                // targets (EditorTabsPane_Drop below) and showing a
                // screen-covering overlay on top of them would only block
                // dropping directly onto a pane that's already right there.
                bool anyOtherPaneVisible = EditorTabs2.Visibility == Visibility.Visible
                    || EditorTabs3.Visibility == Visibility.Visible
                    || EditorTabs4.Visibility == Visibility.Visible;
                if (!anyOtherPaneVisible)
                {
                    DockGuideOverlay.Visibility = Visibility.Visible;
                }

                var result = DragDrop.DoDragDrop(tab, new DataObject(TabDragFormat, tab), DragDropEffects.Move);
                BuildConsole.Services.ActivityLog.Log("tabs.drag", $"DoDragDrop returned {result} for '{TabDragLabel(tab)}'");

                DockGuideOverlay.Visibility = Visibility.Collapsed;
            };
        }

        private static string TabDragLabel(TabItem tab) => tab.Tag?.ToString() ?? tab.Header?.ToString() ?? "?";

        /// <summary>Walks up from <paramref name="start"/> (typically e.OriginalSource)
        /// looking for a Button, stopping once it reaches <paramref name="stopAt"/>
        /// (the TabItem itself) without finding one. Used to tell "clicked the close
        /// button" apart from "clicked the header text/icon" for the same tunneling
        /// MouseDown.</summary>
        private static Button? FindAncestorButton(DependencyObject start, TabItem stopAt)
        {
            var current = start;
            while (current != null && !ReferenceEquals(current, stopAt))
            {
                if (current is Button b) return b;
                
                if (current is System.Windows.ContentElement ce)
                {
                    current = System.Windows.LogicalTreeHelper.GetParent(ce);
                }
                else
                {
                    current = System.Windows.Media.VisualTreeHelper.GetParent(current) ?? System.Windows.LogicalTreeHelper.GetParent(current);
                }
            }
            return null;
        }

        /// <summary>
        /// Git #895 — Shane: "Drag and drop tabs are not working" - reported
        /// as the screen dimming (the DockGuideOverlay showing, correctly)
        /// but the cursor staying a permanent "no drop" circle-slash the
        /// whole time, even over a real target. Root cause: WPF does NOT
        /// compute drag-allowed cursor feedback from AllowDrop="True" alone -
        /// without an explicit DragOver handler setting e.Effects, it
        /// defaults to DragDropEffects.None (the blocked cursor) everywhere,
        /// forever, regardless of what's actually under the mouse. Only Drop
        /// was wired (fires on release) - DragOver (fires continuously while
        /// hovering, drives the cursor) never was. Shared by every drop
        /// target below (both the four editor panes and the four dock
        /// overlay buttons) - same accept/reject logic everywhere: valid iff
        /// the drag actually carries our tab payload.
        /// </summary>
        private void TabDragOver(object sender, DragEventArgs e)
        {
            e.Effects = e.Data.GetDataPresent(TabDragFormat) ? DragDropEffects.Move : DragDropEffects.None;
            e.Handled = true;
        }

        /// <summary>Git #893 — shared Drop handler for all four editor panes: dropping on the SAME pane it came from reorders it there; dropping on a DIFFERENT (already-visible) pane moves it there.</summary>
        private void EditorTabsPane_Drop(object sender, DragEventArgs e)
        {
            if (sender is not TabControl targetTabs) return;
            if (e.Data.GetData(TabDragFormat) is not TabItem draggedTab) return;
            if (draggedTab.Parent is not TabControl sourceTabs) return;

            BuildConsole.Services.ActivityLog.Log("tabs.drag", $"Drop received on {targetTabs.Name} for '{TabDragLabel(draggedTab)}' (source pane: {sourceTabs.Name})");

            if (sourceTabs == targetTabs)
            {
                int currentIndex = targetTabs.Items.IndexOf(draggedTab);
                int dropIndex = ComputeTabDropIndex(targetTabs, e.GetPosition(targetTabs));
                if (dropIndex == currentIndex || dropIndex == currentIndex + 1) return; // no real move

                targetTabs.Items.Remove(draggedTab);
                targetTabs.Items.Insert(dropIndex > currentIndex ? dropIndex - 1 : dropIndex, draggedTab);
            }
            else
            {
                sourceTabs.Items.Remove(draggedTab);
                targetTabs.Items.Add(draggedTab);
            }

            targetTabs.SelectedItem = draggedTab;
            PersistOpenChatTabs(); // Git #874 — a chat dragged to another pane updates its persisted per-pane layout
            e.Handled = true;
        }

        /// <summary>Git #893 — where among a pane's existing tab headers a drop point falls, by comparing against each header's horizontal center (already-realized TabItems, since they're populated directly rather than via a bound ItemsSource).</summary>
        private static int ComputeTabDropIndex(TabControl tabs, Point dropPointRelativeToTabs)
        {
            var items = tabs.Items.OfType<TabItem>().ToList();
            for (int i = 0; i < items.Count; i++)
            {
                Point topLeft;
                try { topLeft = items[i].TranslatePoint(new Point(0, 0), tabs); }
                catch { continue; } // not yet in the visual tree - shouldn't happen for an existing visible tab, but don't crash a drop over it
                double center = topLeft.X + items[i].ActualWidth / 2;
                if (dropPointRelativeToTabs.X < center) return i;
            }
            return items.Count;
        }

        /// <summary>Git #893 — the four DockGuideOverlay buttons (Left/Top/4-Squares/Right) as real drop targets, alongside their existing Click handlers (which only fire for a plain click, never during an active DragDrop.DoDragDrop - the two never conflict).</summary>
        private void DockTarget_Drop(object sender, DragEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string tag) return;
            if (e.Data.GetData(TabDragFormat) is not TabItem draggedTab) return;

            string mode = tag.StartsWith("SplitH") ? "SplitH" : tag;
            ApplyGridForMode(mode); // reveal the pane only - do NOT redistribute every other open tab

            TabControl target = tag switch
            {
                "SplitH_Right" => EditorTabs2,
                "SplitV" => EditorTabs,
                "Grid4" => EditorTabs,
                _ => EditorTabs, // "SplitH" (Left)
            };

            if (draggedTab.Parent is TabControl source && source != target)
            {
                source.Items.Remove(draggedTab);
            }
            if (!target.Items.Contains(draggedTab)) target.Items.Add(draggedTab);
            target.SelectedItem = draggedTab;

            DockGuideOverlay.Visibility = Visibility.Collapsed;
            PersistOpenChatTabs(); // Git #874 — a chat docked into a pane updates its persisted per-pane layout
            e.Handled = true;
        }

        private void DistributeTabsBetweenPanes(TabControl source, TabControl target)
        {
            if (source.Items.Count > 1 && target.Items.Count == 0)
            {
                int half = source.Items.Count / 2;
                var itemsToMove = source.Items.OfType<TabItem>().Skip(half).ToList();
                foreach (var item in itemsToMove)
                {
                    source.Items.Remove(item);
                    target.Items.Add(item);
                }
            }
        }

        private void DistributeTabsTo4Grid(TabControl t1, TabControl t2, TabControl t3, TabControl t4)
        {
            var allItems = t1.Items.OfType<TabItem>()
                .Concat(t2.Items.OfType<TabItem>())
                .Concat(t3.Items.OfType<TabItem>())
                .Concat(t4.Items.OfType<TabItem>())
                .Distinct().ToList();

            t1.Items.Clear();
            t2.Items.Clear();
            t3.Items.Clear();
            t4.Items.Clear();

            TabControl[] targetPanes = new[] { t1, t2, t3, t4 };
            for (int i = 0; i < allItems.Count; i++)
            {
                targetPanes[i % 4].Items.Add(allItems[i]);
            }
        }

        // ── Git #806: test manifest runner (Epic #803 Phase 2 — orchestration shell) ──
        // This phase wires the Menu > Run items, tracks the manifest last loaded via
        // the Automation sidebar, and gives #807 (apiTests), #808 (graphTests) and
        // #809 (uiSteps, retrofitting AutomationRunnerWindow) a single, stable entry
        // point — RunManifestAsync — to plug their real execution into. Nothing here
        // actually runs an apiTest/graphTest/uiStep yet.
        private void RunTestsCurrentIssue_Click(object sender, RoutedEventArgs e)
        {
            if (_loadedManifest == null)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    "Run Tests (Current Issue): no manifest loaded — use Load Manifest in the Automation sidebar first.");
                ToastEngine.Warning("Run Tests", "No manifest loaded — use Load Manifest in the Automation sidebar first.");
                return;
            }
            _ = BuildConsole.Services.TestQueueService.Instance.EnqueueAndRunAsync(
                $"{_loadedManifest.Feature} (#{_loadedManifest.Issue})",
                "menu-current-issue",
                () => RunManifestAsync(_loadedManifest, isRegression: false)
            );
        }

        private async void RunRegressionSuite_Click(object sender, RoutedEventArgs e)
        {
            await BuildConsole.Services.TestQueueService.Instance.EnqueueAndRunAsync(
                "Regression Suite Sweep",
                "menu-regression-suite",
                () => RunRegressionSuiteCollectAsync()
            );
        }

        // Git #967 (Epic #803) — the full-suite sweep, factored out of the menu handler so the
        // background RegressionScheduleService can reuse the EXACT same code path (parse
        // _regression-suite.json → LoadFromFile → RunManifestAsync per entry, sequentially
        // through the one shared WebView2 runner). Returns each manifest's ManifestRunResult;
        // the menu caller ignores the list, the scheduler inspects it for failures. Empty list
        // when the suite file can't be found/parsed (also logged, as before).
        public async System.Threading.Tasks.Task<List<BuildConsole.Services.ManifestRunResult>> RunRegressionSuiteCollectAsync()
        {
            var results = new List<BuildConsole.Services.ManifestRunResult>();

            string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    "Run Regression Suite: no repo root found (missing scripts\\build-queue-watcher.config.json).");
                return results;
            }

            string suitePath = Path.Combine(repoRoot, "test-manifests", "_regression-suite.json");
            if (!File.Exists(suitePath))
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Run Regression Suite: {suitePath} not found.");
                return results;
            }

            List<string> manifestFiles;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(suitePath));
                manifestFiles = doc.RootElement.TryGetProperty("manifests", out var arr)
                    ? arr.EnumerateArray().Select(v => v.GetString() ?? "").Where(s => s.Length > 0).ToList()
                    : new List<string>();
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Couldn't parse {suitePath}: {ex.Message}");
                return results;
            }

            BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Run Regression Suite: {manifestFiles.Count} manifest(s) queued.");
            foreach (var relPath in manifestFiles)
            {
                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                var manifest = BuildConsole.Services.TestManifest.LoadFromFile(Path.Combine(repoRoot, "test-manifests", relPath));
                if (manifest == null)
                {
                    BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Skipping {relPath} — couldn't load/parse.");
                    continue;
                }
                results.Add(await RunManifestAsync(manifest, isRegression: true));
            }
            return results;
        }

        /// <summary>
        /// Runs only the specific test manifest(s) scoped to a build's issue number (e.g. #1057).
        /// If no matching issue manifest exists, skips tests unless full-suite fallback is enabled in Settings.
        /// </summary>
        public async System.Threading.Tasks.Task<List<BuildConsole.Services.ManifestRunResult>> RunScopedManifestsAsync(int? issueNumber, int? queueItemId = null)
        {
            var results = new List<BuildConsole.Services.ManifestRunResult>();

            string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    "Run Scoped Manifests: no repo root found.");
                return results;
            }

            string manifestsDir = Path.Combine(repoRoot, "test-manifests");
            if (!Directory.Exists(manifestsDir))
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    $"Run Scoped Manifests: directory {manifestsDir} does not exist.");
                return results;
            }

            var settings = BuildConsole.Services.BuildConsoleSettings.Load();

            if (issueNumber.HasValue && issueNumber.Value > 0)
            {
                int targetIssue = issueNumber.Value;
                var files = Directory.GetFiles(manifestsDir, "*.json", SearchOption.AllDirectories)
                    .Where(f => !Path.GetFileName(f).Equals("_regression-suite.json", StringComparison.OrdinalIgnoreCase))
                    .ToList();

                var matching = new List<BuildConsole.Services.TestManifest>();
                foreach (var file in files)
                {
                    var manifest = BuildConsole.Services.TestManifest.LoadFromFile(file);
                    if (manifest != null && manifest.Issue == targetIssue)
                    {
                        matching.Add(manifest);
                    }
                }

                if (matching.Count > 0)
                {
                    BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                        $"Running {matching.Count} scoped manifest(s) for issue #{targetIssue}: {string.Join(", ", matching.Select(m => m.Feature))}");
                    foreach (var manifest in matching)
                    {
                        BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                        results.Add(await RunManifestAsync(manifest, isRegression: true, queueItemId: queueItemId));
                    }
                    return results;
                }
                else
                {
                    BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                        $"No specific test manifest found for issue #{targetIssue} — skipping post-build test run.");
                    return results;
                }
            }

            if (settings.AutoRunFullSuiteFallbackOnBuildComplete)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    "No issue number on build — running full regression suite per Settings fallback.");
                return await RunRegressionSuiteCollectAsync();
            }

            BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                "No issue number on build and full-suite fallback is disabled — skipping tests.");
            return results;
        }

        // ── Git #807 (Epic #803 Phase 3): HTTP test executor (apiTests) ──
        // Plugs into RunManifestAsync at the exact point #806 left as the stable
        // entry point. Results feed the ONE shared ManifestRunResult -> test-results/
        // pipeline #808 (graphTests) and #809 (uiSteps) will append their own
        // TestStepResult entries into as well, per #803/#807 — not a separate
        // output path per executor kind.
        // Git #898 — returns the finished ManifestRunResult (previously void) so the
        // #898 remote-trigger poll loop can POST the exact same result JSON back to the
        // api-server for a waiting Claude Code session to read. The two existing callers
        // (Run Tests / Run Regression Suite) ignore the return value, unchanged.
        public async System.Threading.Tasks.Task<BuildConsole.Services.ManifestRunResult> RunManifestPublicAsync(BuildConsole.Services.TestManifest manifest)
        {
            return await RunManifestAsync(manifest, isRegression: false, targetEnv: BuildConsole.Services.TargetEnvironment.Dev);
        }

        private async System.Threading.Tasks.Task<BuildConsole.Services.ManifestRunResult> RunManifestAsync(
            BuildConsole.Services.TestManifest manifest,
            bool isRegression,
            BuildConsole.Services.TargetEnvironment targetEnv = BuildConsole.Services.TargetEnvironment.Dev,
            int? queueItemId = null)
        {
            string mode = isRegression ? "regression" : "single";

            var config = BuildConsole.Services.BuildTrackerConfig.Load().ForEnvironment(targetEnv);

            BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                $"[{mode}] Running manifest for issue #{manifest.Issue} ({manifest.Feature}) — TargetEnv: {targetEnv} ({config.ApiBaseUrl}) — {manifest.ApiTests.Count} apiTests, {manifest.GraphTests.Count} graphTests, {manifest.PostGraphApiTests.Count} postGraphApiTests, {manifest.ZohoTests.Count} zohoTests, {manifest.UiSteps.Count} uiSteps, {manifest.PowerShellVerify.Count} powerShellVerify.");

            var runResult = new BuildConsole.Services.ManifestRunResult
            {
                Issue = manifest.Issue,
                Feature = manifest.Feature,
                Mode = mode,
                StartedAt = DateTime.Now,
            };

            // Git #810 / #857 — single manual runs now come up on-screen (visible, unfocused)
            // so you can watch progress without hunting through the taskbar. Regression sweeps
            // stay background (off-screen) as before — they run unattended and have their own
            // per-manifest toast if attention is needed.
            var runner = EnsureTestRunnerWindow(background: false);
            if (isRegression)
            {
                // Sweep: keep it on-screen/watchable but never steal focus.
                runner.EnsureOnScreenBackground();
            }
            else
            {
                // Manual run: bring it on-screen immediately so it's watchable,
                // but don't activate (don't steal focus from whatever Shane's doing).
                runner.EnsureOnScreenBackground();
            }
            runner.Clear();
            runner.SetSteps(manifest);
            runner.BeginRun(manifest.Issue, manifest.Feature, mode, targetEnv, queueItemId);

            // Git #877 (Epic #803) — one per-run variable store, shared across all three executors
            // so a value an apiTest extracts (regex/jsonPath over its own response body) can be
            // interpolated via {{name}} into a later graphTest/uiStep in this same run.
            var vars = new BuildConsole.Services.TestRunVariables();

            // Git #953 (Epic #803) — seed the config-variable layer from Settings' stored
            // "Test Environment Variables" (TEST_PORTAL_PASSWORD, GRAPH_TEST_TENANT_ID, …) before
            // any executor runs, so {{NAME}} placeholders resolve against them first — the general
            // replacement for HttpTestExecutor's old hardcoded two-name DEPLOY_URL/SECRET_KEY chain.
            vars.SeedConfigVariables(BuildConsole.Services.BuildConsoleSettings.Load().TestEnvironmentVariables);

            // Pause-on-unset (Epic #803, extends #953/#961) — on an interactive Play Test / manual run
            // (NOT the #967 scheduled sweep or the #898 headless remote trigger — same interactive test
            // as the device-code bridge below), if a step is about to resolve a {{NAME}} whose stored
            // Test Environment Variable is still <unset>/needsReview, pause the run and prompt for the
            // real value in a non-blocking floaty (same shape as DeviceCodeWindow). Once entered it's
            // saved to the store (needsReview cleared) and the run resumes on that value; dismissal fails
            // just that step, clearly naming the variable. Headless runs leave this null and keep today's
            // fail-clearly-on-unset behaviour (Resolve refuses to ship the "<unset>" placeholder).
            if (!isRegression && !_testTriggerBusy)
            {
                vars.OnMissingVariable = prompt => Dispatcher.Invoke(() =>
                {
                    var mvWin = new MissingVariableWindow(prompt) { Owner = this };
                    mvWin.Show();
                    return mvWin.Result;
                });
            }

            var capturedShots = new List<BuildConsole.Services.UiScreenshotCapture>();
            try
            {
                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();

                string targetBaseUrl = string.IsNullOrWhiteSpace(manifest.BaseUrl) ? config.ApiBaseUrl : manifest.BaseUrl;
                targetBaseUrl = vars.Resolve(BuildConsole.Services.HttpTestExecutor.ResolvePlaceholders(targetBaseUrl, config));
                await EnsureServerReadyWithProbeAsync(targetBaseUrl, "testing.manifest-runner", maxWaitSeconds: 90);

                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                var apiResults = await BuildConsole.Services.HttpTestExecutor.RunAsync(manifest, config, vars);
                runResult.AddRange(apiResults);

                if (apiResults.Count > 0)
                {
                    int passed = apiResults.Count(r => r.Passed);
                    BuildConsole.Services.ActivityLog.Log("testing.api-executor",
                        $"apiTests: {passed}/{apiResults.Count} passed for issue #{manifest.Issue}.");
                }

                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                var graphResults = await BuildConsole.Services.GraphTestExecutor.RunAsync(manifest, vars);
                runResult.AddRange(graphResults);

                if (graphResults.Count > 0)
                {
                    int passed = graphResults.Count(r => r.Passed);
                    BuildConsole.Services.ActivityLog.Log("testing.graph-executor",
                        $"graphTests: {passed}/{graphResults.Count} passed for issue #{manifest.Issue}.");
                }

                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                var postGraphApiResults = await BuildConsole.Services.HttpTestExecutor.RunPostGraphAsync(manifest, config, vars);
                runResult.AddRange(postGraphApiResults);

                if (postGraphApiResults.Count > 0)
                {
                    int passed = postGraphApiResults.Count(r => r.Passed);
                    BuildConsole.Services.ActivityLog.Log("testing.api-executor",
                        $"postGraphApiTests: {passed}/{postGraphApiResults.Count} passed for issue #{manifest.Issue}.");
                }

                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                var zohoResults = await BuildConsole.Services.ZohoTestExecutor.RunAsync(manifest, config);
                runResult.AddRange(zohoResults);

                if (zohoResults.Count > 0)
                {
                    int passed = zohoResults.Count(r => r.Passed);
                    BuildConsole.Services.ActivityLog.Log("testing.zoho",
                        $"zohoTests: {passed}/{zohoResults.Count} passed for issue #{manifest.Issue}.");
                }

                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                capturedShots = new List<BuildConsole.Services.UiScreenshotCapture>();

                if (manifest.UiSteps.Count > 0)
                {
                    var uiActions = manifest.UiSteps.Select((step, i) => new Controls.AutomationAction
                    {
                        Index = i + 1,
                        ActionType = step.Action,
                        Selector = step.Selector ?? step.Target ?? string.Empty,
                        TagName = "div",
                        Value = step.Value ?? step.State ?? string.Empty,
                        CaptureResponse = step.CaptureResponseJson,
                        Extract = step.ExtractJson,
                        TextContains = step.TextContainsJson,
                        TextPrefixOfAny = step.TextPrefixOfAnyJson,
                        Viewport = step.ViewportJson,
                        MaxDurationMs = step.MaxDurationMs,
                        TimeoutMs = step.TimeoutMs,
                        Screenshot = step.Screenshot,
                        Critical = step.Critical,
                    }).ToList();

                    // Git #1210 — resolve the uiSteps base URL and per-navigation origin. In local Dev each
                    // front-end lives on its OWN port (Marketing 5173 / Admin 5174 / Portal 5175 / Website 5176)
                    // and the API server (8080, what {{DEPLOY_URL}} resolves to) serves NO SPA — so a uiStep that
                    // navigated to the resolved {{DEPLOY_URL}} base (8080) hit a blank/404 page and every step
                    // failed. Here we classify the manifest's PRIMARY front-end service from its navigation
                    // routes, base the run at that front-end's port, and hand UiTestExecutor a resolver that
                    // remaps EACH goto to the front-end that owns its route (so a cross-service flow — e.g. a
                    // Marketing landing page then a Portal page — lands each goto on the right port). For
                    // Staging/Production a single origin serves every route, so we keep the old base-URL behaviour
                    // and pass no resolver.
                    string uiTargetUrl;
                    Func<string, string>? uiOriginResolver = null;
                    if (targetEnv == BuildConsole.Services.TargetEnvironment.Dev)
                    {
                        var uiNavRoutes = manifest.UiSteps
                            .Where(s => BuildConsole.Services.DevServiceRouting.IsNavAction(s.Action))
                            .Select(s => s.Target ?? s.Selector ?? string.Empty)
                            .ToList();
                        string primaryServiceKey = BuildConsole.Services.DevServiceRouting.PrimaryServiceKey(uiNavRoutes);
                        uiTargetUrl = BuildConsole.Services.DevServiceRouting.OriginForServiceKey(primaryServiceKey);
                        uiOriginResolver = route => BuildConsole.Services.DevServiceRouting.OriginForRoute(route, primaryServiceKey);
                        BuildConsole.Services.ActivityLog.Log("testing.ui-executor",
                            $"[{mode}] Issue #{manifest.Issue} uiSteps Dev front-end routing: primary service {BuildConsole.Services.DevServiceRouting.DescribeServiceKey(primaryServiceKey)} (base {uiTargetUrl}); each goto remaps to its owning front-end port (API server 8080 is not a uiSteps target).");
                    }
                    else
                    {
                        uiTargetUrl = BuildConsole.Services.HttpTestExecutor.ResolvePlaceholders(manifest.BaseUrl, config);
                    }
                    var uiDefaultViewport = BuildConsole.Services.ViewportSpec.Parse(manifest.ViewportJson);

                    string? uiRepoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                    string? screenshotDir = uiRepoRoot != null
                        ? System.IO.Path.Combine(uiRepoRoot, "test-results", runResult.RunFolderName, "screenshots")
                        : null;

                    var uiResult = await runner.RunUiTestAsync(uiTargetUrl, uiActions, vars, uiDefaultViewport, screenshotDir, uiOriginResolver);
                    capturedShots = uiResult.Screenshots;
                    var uiStepResults = uiResult.ToTestStepResults();

                    if (uiRepoRoot != null)
                    {
                        foreach (var s in uiStepResults)
                        {
                            if (!string.IsNullOrEmpty(s.ScreenshotPath))
                                s.ScreenshotPath = System.IO.Path.GetRelativePath(uiRepoRoot, s.ScreenshotPath).Replace('\\', '/');
                        }
                    }

                    runResult.AddRange(uiStepResults);

                    BuildConsole.Services.ActivityLog.Log("testing.ui-executor",
                        $"[{mode}] Issue #{manifest.Issue} uiSteps: {uiResult.PassedSteps}/{uiResult.TotalSteps} passed" +
                        $"{(uiResult.Aborted ? $"; RUN ABORTED — {uiResult.AbortReason} (remaining steps skipped)" : "")}" +
                        $"{(uiResult.Screenshots.Count > 0 ? $"; {uiResult.Screenshots.Count} screenshot(s) captured" : "")}.");
                }

                BuildConsole.Services.TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                BuildConsole.Services.PowerShellTestExecutor.DeviceCodeInteraction? deviceCodeUi = null;
                if (!isRegression && !_testTriggerBusy)
                {
                    DeviceCodeWindow? dcWin = null;
                    deviceCodeUi = new BuildConsole.Services.PowerShellTestExecutor.DeviceCodeInteraction
                    {
                        OnPrompt = prompt => Dispatcher.Invoke(() =>
                        {
                            try
                            {
                                dcWin?.Close();
                                dcWin = new DeviceCodeWindow(prompt) { Owner = this };
                                dcWin.Closed += (_, _) => dcWin = null;
                                dcWin.Show();
                            }
                            catch (Exception ex)
                            {
                                BuildConsole.Services.ActivityLog.Log("testing.powershell-verify",
                                    $"device-code floaty failed to show: {ex.Message}");
                            }
                        }),
                        OnResolved = res => Dispatcher.Invoke(() =>
                        {
                            try
                            {
                                if (dcWin == null) return;
                                if (res.TimedOut) dcWin.MarkTimedOut(res.Message);
                                else dcWin.MarkSignedIn(res.Message);
                            }
                            catch { /* best-effort UI update */ }
                        }),
                    };
                }

                var powerShellResults = await BuildConsole.Services.PowerShellTestExecutor.RunAsync(manifest, vars, deviceCodeUi);
                runResult.AddRange(powerShellResults);

                if (powerShellResults.Count > 0)
                {
                    int passed = powerShellResults.Count(r => r.Passed);
                    BuildConsole.Services.ActivityLog.Log("testing.powershell-verify",
                        $"powerShellVerify: {passed}/{powerShellResults.Count} passed for issue #{manifest.Issue}.");
                }
            }
            catch (OperationCanceledException)
            {
                runResult.Cancelled = true;
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    $"Run cancelled for issue #{manifest.Issue} ({manifest.Feature}).");
            }

            runner.CompleteRun(runResult);

            if (runResult.Steps.Count > 0)
            {
                string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                if (repoRoot != null)
                {
                    try
                    {
                        string resultPath = runResult.WriteToFile(repoRoot);
                        BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Results written: {resultPath}");
                    }
                    catch (Exception ex)
                    {
                        BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Couldn't write test results: {ex.Message}");
                    }
                }
                else
                {
                    // Git #1985 — audited: was a silent skip. The run itself already completed and
                    // its pass/fail is surfaced elsewhere (SetStatus/toast); this only means the
                    // durable test-results/*.json for this run won't be written. Log it so a missing
                    // results file is traceable back to an unresolved repo root, not a mystery.
                    BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                        $"Repo root not found — test results for issue #{manifest.Issue} were NOT written to disk.");
                }
            }

            // Epic #803 — screenshot baseline review: diff this run's captured screenshots (#966)
            // against their stored baselines. #975's exact condition (items.Any(i => i.NeedsReview))
            // decides whether review is needed; the dialog itself is now DEFERRED (returned as an action)
            // rather than popped inline, so it never interrupts the run — the "needs attention" toast
            // below pops it on Shane's click. This is the single general entry point every
            // screenshot-producing run uses. The scheduled regression sweep (#967) and the #898 headless
            // remote-trigger stay non-interactive — they compare-and-log but build no dialog action.
            BuildConsole.Services.ScreenshotReviewResult? reviewResult = null;
            if (capturedShots.Count > 0)
            {
                // Git #1985 — audited, genuinely tolerable: screenshot baseline review is optional
                // polish on top of an already-completed, already-surfaced run; skipping it silently
                // when the repo root is unresolved doesn't hide anything the operator needed to see.
                string? reviewRepoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                if (reviewRepoRoot != null)
                {
                    try
                    {
                        var subject = BuildConsole.Services.ScreenshotReviewService.SubjectFromManifest(manifest, reviewRepoRoot);
                        reviewResult = await BuildConsole.Services.ScreenshotReviewService.EvaluateAsync(
                            runner, reviewRepoRoot, subject, capturedShots,
                            (text, showMessage, onInserted) =>
                                SendTextToActiveClaudeChatAsync(text, showMessage, onInserted, "testing.screenshot-review", "report"),
                            interactive: !isRegression && !_testTriggerBusy);
                    }
                    catch (Exception ex)
                    {
                        BuildConsole.Services.ActivityLog.Log("testing.screenshot-review", $"Screenshot review failed: {ex.Message}");
                    }
                }
            }

            // ── Auto-close-clean / toast-on-attention — the window's own default behaviour for a run ──
            // Applied to every single-run trigger (Play Test, double-click, shaneapp://runTest, #898
            // remote) since they all reach here. A regression SWEEP (isRegression) drives the ONE shared
            // window across many manifests in a loop, so it must NOT auto-close per manifest — it keeps
            // today's behaviour (no auto-close, no per-manifest toast).
            if (!isRegression)
                ApplyRunOutcomeToRunnerWindow(runner, runResult, reviewResult);

            return runResult;
        }

        /// <summary>Decides what happens to the Test Runner window once a single run finishes: a genuinely
        /// clean run (no failed steps AND #975's screenshot review not needed) auto-closes the window —
        /// Shane never needs to look. A run that needs attention (a real step failure, or #975's needsReview
        /// firing) leaves the window and surfaces a non-blocking, clickable ToastEngine (#24) toast whose
        /// click restores the window and pops the deferred #975 review dialog (when there is one). Logs the
        /// real outcome on the window's own "testing.results-panel" channel.</summary>
        private void ApplyRunOutcomeToRunnerWindow(
            TestRunnerWindow runner,
            BuildConsole.Services.ManifestRunResult runResult,
            BuildConsole.Services.ScreenshotReviewResult? reviewResult)
        {
            const string ch = "testing.results-panel";
            int total = runResult.Steps.Count;
            int passed = runResult.Steps.Count(s => s.Passed);
            bool hasFailure = runResult.Steps.Any(s => !s.Passed);
            bool needsReview = reviewResult?.NeedsReview == true;

            if (!hasFailure && !needsReview)
            {
                BuildConsole.Services.ActivityLog.Log(ch,
                    $"Run #{runResult.Issue} clean ({passed}/{total} passed) — no attention needed; auto-closing the Test Runner window.");
                runner.AutoCloseAfterCleanRun();
                return;
            }

            string title = hasFailure
                ? $"Test run needs attention — #{runResult.Issue}"
                : $"Screenshot review needed — #{runResult.Issue}";
            string body = hasFailure
                ? $"{passed}/{total} steps passed. Click to open the Test Runner and see the failing steps."
                : $"{reviewResult?.NoBaseline ?? 0} new, {reviewResult?.Diffs ?? 0} changed vs baseline. Click to review & approve.";

            BuildConsole.Services.ActivityLog.Log(ch,
                $"Run #{runResult.Issue} needs attention (hasFailure={hasFailure}, needsReview={needsReview}) — surfaced a non-blocking toast and kept the window (not auto-closed).");

            // Capture the deferred review dialog (if any) so the toast click can pop it.
            Action? showReviewDialog = reviewResult?.ShowReviewDialog;
            int? issueNum = runResult.Issue;
            Action openAction = () =>
            {
                try
                {
                    if (runner != null && runner.IsLoaded)
                    {
                        runner.RestoreToForeground();
                        showReviewDialog?.Invoke();
                    }
                    else
                    {
                        var freshRunner = EnsureTestRunnerWindow(background: false);
                        freshRunner.RestoreToForeground();
                        showReviewDialog?.Invoke();
                    }
                }
                catch
                {
                    try
                    {
                        var freshRunner = EnsureTestRunnerWindow(background: false);
                        freshRunner.RestoreToForeground();
                    }
                    catch { }
                }

                if (issueNum.HasValue)
                {
                    try { _ = OpenGitDetailByNumberAsync(issueNum.Value); } catch { }
                }
            };

            // Durable fallback for the toast's auto-dismiss: ALSO record this result in the Build Queue
            // panel's "Needs Attention" section, where it stays until Shane actually addresses it. Keyed by
            // issue+feature so a re-run of the same manifest updates its row instead of stacking duplicates.
            string attentionKey = $"{runResult.Issue}:{runResult.Feature}";

            var testDetailsSb = new System.Text.StringBuilder();
            testDetailsSb.AppendLine($"=== TEST MANIFEST RUN REPORT ===");
            testDetailsSb.AppendLine($"Issue: #{runResult.Issue}");
            testDetailsSb.AppendLine($"Feature: {runResult.Feature}");
            testDetailsSb.AppendLine($"Total Steps: {total}");
            testDetailsSb.AppendLine($"Passed: {passed}");
            testDetailsSb.AppendLine($"Failed: {total - passed}");
            testDetailsSb.AppendLine();
            if (hasFailure)
            {
                testDetailsSb.AppendLine($"=== FAILING STEPS ===");
                foreach (var s in runResult.Steps.Where(st => !st.Passed))
                {
                    testDetailsSb.AppendLine($"• Step: {s.Label} ({s.Kind})");
                    if (!string.IsNullOrEmpty(s.Detail)) testDetailsSb.AppendLine($"  Detail: {s.Detail}");
                    if (!string.IsNullOrEmpty(s.Expected)) testDetailsSb.AppendLine($"  Expected: {s.Expected}");
                    if (!string.IsNullOrEmpty(s.Actual)) testDetailsSb.AppendLine($"  Actual: {s.Actual}");
                    if (!string.IsNullOrEmpty(s.Context)) testDetailsSb.AppendLine($"  Context: {s.Context}");
                    if (!string.IsNullOrEmpty(s.ScreenshotPath)) testDetailsSb.AppendLine($"  Screenshot: {s.ScreenshotPath}");
                    testDetailsSb.AppendLine();
                }
            }
            if (needsReview)
            {
                testDetailsSb.AppendLine($"=== SCREENSHOT REVIEW ===");
                testDetailsSb.AppendLine($"New baselines needed: {reviewResult?.NoBaseline ?? 0}");
                testDetailsSb.AppendLine($"Visual diffs detected: {reviewResult?.Diffs ?? 0}");
            }
            string testDetails = testDetailsSb.ToString();

            BuildQueuePanel.AddNeedsAttention(attentionKey, title, body, hasFailure, openAction, testDetails);

            // Clicking the toast addresses it just like clicking the section row does: open the Test Runner /
            // review dialog AND clear the durable item so it doesn't linger after Shane has looked.
            Action onClick = () =>
            {
                openAction();
                BuildQueuePanel.ClearNeedsAttention(attentionKey);
            };

            ToastEngine.Show(title, body, hasFailure ? ToastKind.Error : ToastKind.Warning, duration: null, onClick: onClick);
        }

        private static async System.Threading.Tasks.Task<bool> EnsureServerReadyWithProbeAsync(string baseUrl, string channel, int maxWaitSeconds = 90)
        {
            if (string.IsNullOrWhiteSpace(baseUrl)) return true;
            string probeUrl = baseUrl.TrimEnd('/') + "/api/internal/deploy-status";
            var deadline = DateTime.UtcNow.AddSeconds(maxWaitSeconds);
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };

            int attempt = 0;
            while (DateTime.UtcNow < deadline)
            {
                attempt++;
                try
                {
                    var resp = await client.GetAsync(probeUrl);
                    if (resp.IsSuccessStatusCode)
                    {
                        BuildConsole.Services.ActivityLog.Log(channel, $"[Readiness Probe] Server ready on attempt #{attempt} (HTTP {(int)resp.StatusCode} OK): {baseUrl}");
                        return true;
                    }
                    BuildConsole.Services.ActivityLog.Log(channel, $"[Readiness Probe] Attempt #{attempt} returned HTTP {(int)resp.StatusCode} (waiting for server to fully compile / restart)…");
                }
                catch (Exception ex)
                {
                    BuildConsole.Services.ActivityLog.Log(channel, $"[Readiness Probe] Attempt #{attempt}: {ex.Message} (waiting for node server startup)…");
                }

                await System.Threading.Tasks.Task.Delay(2500);
            }
            BuildConsole.Services.ActivityLog.Log(channel, $"[Readiness Probe] Timed out after {maxWaitSeconds}s — proceeding with manifest steps.");
            return false;
        }

        /// <summary>Epic #803 — surfaces the auto deploy+verify+test pipeline's end-to-end outcome
        /// through the SAME notification mechanisms a manifest run uses (#24 ToastEngine + the Build
        /// Queue "Needs Attention" section, #54) rather than letting it complete silently. A fully
        /// green run (deploy confirmed live + every manifest passed) shows a transient success toast
        /// only; anything that needs eyes (deploy not confirmed, tests failed/errored, or the deploy
        /// couldn't be proven to include this build's own commit) shows an error/warning toast AND
        /// records a durable Needs-Attention row that stays until Shane addresses it. The real live
        /// commit hash is always in the surfaced text so the deploy is independently verifiable. The
        /// benign "already live, nothing to deploy" no-op is silent.</summary>
        private void SurfacePostBuildDeployOutcome(BuildConsole.Services.PostBuildPipelineResult r)
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(() => SurfacePostBuildDeployOutcome(r)));
                return;
            }

            // Server was already on this build's commit — nothing deployed, nothing to surface.
            if (r.AlreadyLive) return;

            string deployPart = r.DeployConfirmed
                ? $"deploy live @ {r.NewCommit}" + (r.AdvancedToOwnCommit == false ? " (⚠ does NOT contain this build's commit)" : "")
                : "deploy NOT confirmed";
            string testPart = r.TestsRan ? $"tests {r.TestsPassed}/{r.TestsTotal} passed" : "tests not run";

            // Fully green end to end — transient success toast, no durable attention item.
            if (r.OverallOk && r.AdvancedToOwnCommit != false)
            {
                ToastEngine.Success("Build deployed & tested", $"{deployPart}; {testPart}.");
                return;
            }

            string title = !r.DeployConfirmed
                ? "Auto-deploy needs attention — deploy not confirmed"
                : (r.TestsRan && r.TestsFailed > 0)
                    ? $"Post-deploy tests failing ({r.TestsFailed})"
                    : "Auto-deploy needs attention";

            var bodySb = new System.Text.StringBuilder();
            bodySb.Append($"Build '{r.BuildTitle}' (#{r.QueueItemId}): {deployPart}; {testPart}.");
            if (!string.IsNullOrEmpty(r.Error)) bodySb.Append($" {r.Error}.");
            if (r.FailedManifests.Count > 0) bodySb.Append($" Failing: {string.Join(", ", r.FailedManifests)}.");
            string body = bodySb.ToString();

            bool isFailure = !r.DeployConfirmed || (r.TestsRan && r.TestsFailed > 0);

            // Construct full diagnostic details for the inspection window
            var deployDetailsSb = new System.Text.StringBuilder();
            deployDetailsSb.AppendLine($"=== AUTO DEPLOY & TEST REPORT ===");
            deployDetailsSb.AppendLine($"Build: {r.BuildTitle} (Queue Item #{r.QueueItemId})");
            deployDetailsSb.AppendLine($"Overall Status: {(r.OverallOk ? "SUCCESS" : "NEEDS ATTENTION")}");
            deployDetailsSb.AppendLine($"Stage: {r.Stage}");
            deployDetailsSb.AppendLine($"Deploy Confirmed: {(r.DeployConfirmed ? "YES" : "NO")}");
            deployDetailsSb.AppendLine($"Old Live Commit: {r.OldCommit}");
            deployDetailsSb.AppendLine($"Expected Commit: {r.ExpectedCommit}");
            deployDetailsSb.AppendLine($"New Live Commit: {r.NewCommit}");
            deployDetailsSb.AppendLine($"Advanced to Own Commit: {(r.AdvancedToOwnCommit == null ? "N/A" : r.AdvancedToOwnCommit.Value ? "YES" : "NO (⚠ Server behind build commit)")}");
            if (!string.IsNullOrEmpty(r.AdvancementNote)) deployDetailsSb.AppendLine($"Advancement Note: {r.AdvancementNote}");
            deployDetailsSb.AppendLine($"Deploy Elapsed Time: {r.DeployElapsedSeconds:F1}s");
            deployDetailsSb.AppendLine();
            deployDetailsSb.AppendLine($"=== TEST RESULTS ===");
            deployDetailsSb.AppendLine($"Tests Ran: {(r.TestsRan ? "YES" : "NO")}");
            deployDetailsSb.AppendLine($"Pass / Total: {r.TestsPassed} / {r.TestsTotal}");
            deployDetailsSb.AppendLine($"Failed: {r.TestsFailed}");
            if (r.FailedManifests.Count > 0)
            {
                deployDetailsSb.AppendLine($"Failed Manifests:");
                foreach (var fm in r.FailedManifests) deployDetailsSb.AppendLine($"  - {fm}");
            }
            if (!string.IsNullOrEmpty(r.Error))
            {
                deployDetailsSb.AppendLine();
                deployDetailsSb.AppendLine($"=== ERROR MESSAGE / LOG ===");
                deployDetailsSb.AppendLine(r.Error);
            }
            string deployDetails = deployDetailsSb.ToString();

            // Durable row in the Build Queue "Needs Attention" section, keyed so a re-run for the same
            // build updates in place rather than stacking. Clicking pops the rich diagnostics window!
            string attentionKey = $"post-build-deploy:{r.QueueItemId}";
            Action onOpen = () =>
            {
                try
                {
                    Activate();
                    if (r.FailedManifests.Count > 0)
                    {
                        var runnerWin = EnsureTestRunnerWindow(background: false);
                        runnerWin.RestoreToForeground();
                    }
                    else
                    {
                        if (_buildWatch == null) ToggleBuildWatch();
                        else _buildWatch.Activate();
                    }
                }
                catch (Exception ex)
                {
                    BuildConsole.Services.ActivityLog.Log("testing.post-build-deploy",
                        $"Needs-Attention open action threw: {ex.Message}");
                }

                BuildConsole.Services.ActivityLog.Log("testing.post-build-deploy",
                    $"Needs-Attention opened for build #{r.QueueItemId} (deploy {r.OldCommit}->{r.NewCommit}, tests {r.TestsPassed}/{r.TestsTotal}).");
            };
            BuildQueuePanel.AddNeedsAttention(attentionKey, title, body, isFailure, onOpen, deployDetails);

            Action onClick = () =>
            {
                onOpen();
                BuildQueuePanel.ClearNeedsAttention(attentionKey);
            };
            ToastEngine.Show(title, body, isFailure ? ToastKind.Error : ToastKind.Warning, duration: null, onClick: onClick);
        }

        // ── Git #898 (Epic #803): remote UI-test trigger poll ────────────────────
        // The rendezvous half that lives in this app. A headless Claude Code session
        // POSTs /admin/deploy/test-run naming a manifest; it can't drive WebView2
        // itself. This app already has a real GUI session (it's open for the build
        // queue anyway), so it claims the pending run, executes the SAME
        // RunManifestAsync pipeline the Run Tests menu uses, and POSTs the finished
        // ManifestRunResult back for the waiting Claude Code poll to read. Poll shape
        // mirrors the existing build-queue watcher and deploy-status timers exactly.
        private void StartTestTriggerPoll()
        {
            if (_testTriggerTimer != null || _buildTrackerApi == null || !_buildTrackerApi.IsConfigured) return;
            _testTriggerTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            _testTriggerTimer.Tick += async (_, _) => await TestTriggerTickAsync();
            _testTriggerTimer.Start();
            BuildConsole.Services.ActivityLog.Log("testing.remote-trigger",
                "Remote UI-test trigger poll started — polling /admin/deploy/test-run/next every 5s.");
        }

        private async System.Threading.Tasks.Task TestTriggerTickAsync()
        {
            // One manifest run at a time: RunManifestAsync drives the single shared
            // TestRunnerWindow/WebView2, which can't service two runs concurrently.
            if (_testTriggerBusy || _buildTrackerApi == null) return;

            BuildConsole.Services.TestRunRequest? req;
            try
            {
                req = await _buildTrackerApi.GetNextTestRunAsync();
                if (!_testTriggerPollReachable)
                {
                    _testTriggerPollReachable = true;
                    BuildConsole.Services.ActivityLog.Log("testing.remote-trigger", "Poll recovered — API server reachable again.");
                }
            }
            catch (Exception ex)
            {
                // Transient poll failure (server down mid-session, etc.) — log the
                // reachable→unreachable transition once, not a line every 5s tick
                // forever (Git #1969); the next tick still retries either way.
                if (_testTriggerPollReachable)
                {
                    _testTriggerPollReachable = false;
                    BuildConsole.Services.ActivityLog.Log("testing.remote-trigger", $"Poll failed: {ex.Message} — suppressing repeat lines until it recovers.");
                }
                return;
            }

            if (req?.RunId == null || string.IsNullOrWhiteSpace(req.ManifestFile)) return;

            _testTriggerBusy = true;
            string runId = req.RunId;
            string manifestFile = req.ManifestFile;
            try
            {
                BuildConsole.Services.ActivityLog.Log("testing.remote-trigger",
                    $"Claimed remote test-run {runId} for manifest {manifestFile}.");

                string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                if (repoRoot == null)
                {
                    await CompleteTestRunFailedAsync(runId,
                        "No repo root found (missing scripts\\build-queue-watcher.config.json) — can't locate test-manifests/.");
                    return;
                }

                // Git #964: manifestFile arrives as a bare filename (admin-test-trigger.ts's
                // MANIFEST_FILE_RE deliberately rejects anything containing a path separator,
                // so the {area}/ subdir a #960-migrated manifest actually lives under is never
                // part of the wire payload). A flat Path.Combine here 404'd every manifest once
                // #960 moved them all into test-manifests/{area}/{feature-slug}.json — search
                // the tree for that exact filename instead, still safely scoped under
                // test-manifests/ since manifestFile itself was already validated path-traversal-free.
                string testManifestsRoot = Path.Combine(repoRoot, "test-manifests");
                string? manifestPath = Directory.Exists(testManifestsRoot)
                    ? Directory.EnumerateFiles(testManifestsRoot, manifestFile, SearchOption.AllDirectories).FirstOrDefault()
                    : null;
                var manifest = manifestPath != null ? BuildConsole.Services.TestManifest.LoadFromFile(manifestPath) : null;
                if (manifest == null)
                {
                    await CompleteTestRunFailedAsync(runId,
                        $"Manifest not found or unparseable: {manifestFile} (searched recursively under {testManifestsRoot})");
                    return;
                }

                BuildConsole.Services.ActivityLog.Log("testing.remote-trigger",
                    $"Running manifest #{manifest.Issue} ({manifest.Feature}) for remote test-run {runId}…");
                var result = await BuildConsole.Services.TestQueueService.Instance.EnqueueAndRunAsync(
                    $"{manifest.Feature} (#{manifest.Issue})",
                    $"remote-run-{runId}",
                    () => RunManifestAsync(manifest, isRegression: false)
                );

                // Serialize with the SAME options WriteToFile uses (default PascalCase,
                // WriteIndented) so what Claude Code reads back over HTTP is identical in
                // shape to the test-results/{issue}-{timestamp}.json file on disk.
                var resultsElement = System.Text.Json.JsonSerializer.SerializeToElement(result,
                    new System.Text.Json.JsonSerializerOptions { WriteIndented = true });

                try
                {
                    await _buildTrackerApi.CompleteTestRunAsync(runId, "done", resultsElement, null);
                    int passed = result.Steps.Count(s => s.Passed);
                    BuildConsole.Services.ActivityLog.Log("testing.remote-trigger",
                        $"Delivered results for remote test-run {runId}: {passed}/{result.Steps.Count} step(s) passed.");
                }
                catch (Exception ex)
                {
                    // Ran fine but couldn't deliver — the waiting Claude Code poll will
                    // time out. Nothing to retry against here; log it plainly.
                    BuildConsole.Services.ActivityLog.Log("testing.remote-trigger",
                        $"Ran manifest but couldn't deliver results for {runId}: {ex.Message}");
                }
            }
            catch (Exception ex)
            {
                await CompleteTestRunFailedAsync(runId, $"Run threw: {ex.Message}");
            }
            finally
            {
                _testTriggerBusy = false;
            }
        }

        private async System.Threading.Tasks.Task CompleteTestRunFailedAsync(string runId, string reason)
        {
            BuildConsole.Services.ActivityLog.Log("testing.remote-trigger", $"Remote test-run {runId} failed: {reason}");
            try { await _buildTrackerApi!.CompleteTestRunAsync(runId, "failed", null, reason); }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("testing.remote-trigger", $"Couldn't report failure for {runId}: {ex.Message}");
            }
        }

        // ── shaneapp://executeSql local protocol handler ─────────────────────────

        /// <summary>
        /// Starts the named-pipe listener that receives shaneapp:// URIs from a
        /// (transient) protocol launch — see <see cref="BuildConsole.Services.ShaneAppProtocol"/>.
        /// The callback only POSTS onto the UI thread (so the accept loop never
        /// blocks on a running query), where <see cref="HandleShaneAppUriAsync"/>
        /// does the real work. Also drains a cold-start URI (this instance having
        /// been launched BY the protocol because nothing else was running).
        /// </summary>
        private void StartShaneAppProtocolListener()
        {
            BuildConsole.Services.ShaneAppStreamService.Instance.Attach(Dispatcher);
            BuildConsole.Services.ShaneAppStreamService.Instance.StatusChanged += () => Dispatcher.Invoke(UpdateTopShaneAppIndicator);

            if (_shaneAppListener != null) return;
            _shaneAppListener = new BuildConsole.Services.ShaneAppProtocol();
            _shaneAppListener.Start(uri =>
                Dispatcher.BeginInvoke(new Action(async () => await HandleShaneAppUriAsync(uri))));
            BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                $"shaneapp:// listener started (pipe '{BuildConsole.Services.ShaneAppProtocol.PipeName}').");

            var pending = App.PendingProtocolUri;
            App.PendingProtocolUri = null;
            if (!string.IsNullOrEmpty(pending))
            {
                BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                    "Handling cold-start shaneapp:// URI (no prior instance was running to forward to).");
                _ = Dispatcher.BeginInvoke(new Action(async () => await HandleShaneAppUriAsync(pending!)));
            }
        }

        private void UpdateTopShaneAppIndicator()
        {
            var svc = BuildConsole.Services.ShaneAppStreamService.Instance;
            if (svc.IsRunning)
            {
                TopShaneAppIndicator.Visibility = Visibility.Visible;
                var label = string.IsNullOrWhiteSpace(svc.CurrentAction) ? "RUNNING" : svc.CurrentAction.ToUpperInvariant();
                if (label.Length > 20) label = label.Substring(0, 18) + "…";
                TopShaneAppIndicatorText.Text = label;
                TopShaneAppIndicator.ToolTip = $"shaneapp:// is executing: {svc.CurrentAction} — Click to view live streaming console";
            }
            else
            {
                TopShaneAppIndicator.Visibility = Visibility.Collapsed;
            }
        }

        private void TopShaneAppIndicator_Click(object sender, MouseButtonEventArgs e) => StreamingConsoleWindow.OpenOrFocus();
        private void OpenStreamingConsole_Click(object sender, RoutedEventArgs e) => StreamingConsoleWindow.OpenOrFocus();

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        /// <summary>
        /// Git #2141 — bring Shane's real MainWindow to the foreground in response to a
        /// <c>shaneapp://activate</c> courier from a blocked second instance. Restores a minimized
        /// window, then forces foreground via the Topmost toggle + <see cref="SetForegroundWindow"/>
        /// (WPF's <c>Activate()</c> alone is unreliable when another process just asked for focus).
        /// Runs on the UI thread (HandleShaneAppUriAsync is dispatched there); best-effort, never throws.
        /// </summary>
        private void ActivateMainWindowFromProtocol()
        {
            try
            {
                if (WindowState == WindowState.Minimized)
                    WindowState = WindowState.Normal;
                Show();
                Activate();
                Topmost = true;
                Topmost = false;
                Focus();
                var handle = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                if (handle != IntPtr.Zero)
                    SetForegroundWindow(handle);
                BuildConsole.Services.ActivityLog.Log("system.core",
                    "Single-instance guard (#2141): brought MainWindow to the foreground for Shane at a blocked second instance's request.");
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("system.core",
                    $"Single-instance guard (#2141): foreground activation failed (non-fatal): {ex.Message}");
            }
        }

        /// <summary>
        /// Handles one shaneapp:// invocation on the UI thread: logs it (source,
        /// action, real outcome), reads the payload from the temp file the URI
        /// pointed at (never inline in the URL), runs the SQL through the SAME pipe the
        /// manual SQL Runner uses (<see cref="BuildConsole.Services.LocalSqlExecutor"/> →
        /// <c>BuildTrackerApiClient.ExecuteSqlAsync</c> → <c>POST /api/simulator/sql/execute</c>),
        /// and writes a JSON result envelope back for the caller. Wrapped end-to-end so nothing escapes to crash
        /// the app; every branch logs on <see cref="BuildConsole.Services.ShaneAppProtocol.LogChannel"/>.
        /// </summary>
        private async System.Threading.Tasks.Task HandleShaneAppUriAsync(string uri)
        {
            const string ch = BuildConsole.Services.ShaneAppProtocol.LogChannel;
            // Git #1828 — mark the ENTIRE shaneapp:// dispatch (every action handler, and anything they
            // await or spawn within this scope) as agent/protocol origin. This is the single choke point
            // through which all shaneapp:// invocations flow, so setting the ambient marker here makes SSH
            // structurally unreachable from any agent-originated path — ReplitSshService refuses on
            // IsAgentOrigin FIRST, regardless of what Shane has the Target Environment selector set to.
            using var _agentOriginScope = BuildConsole.Services.ShaneAppExecutionContext.Enter();
            try
            {
                // Stage: URI physically received (off the named pipe, or drained as a
                // cold-start URI). Logged BEFORE parse so even a malformed/unroutable URI
                // leaves a trace on the channel — a future failure is diagnosable from the
                // log alone without another live repro.
                BuildConsole.Services.ActivityLog.Log(ch, $"URI received: {uri}");

                if (!BuildConsole.Services.ShaneAppProtocol.TryParse(uri, out var req, out var parseError))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"Ignored malformed shaneapp:// URI: {parseError}");
                    return;
                }

                string src = string.IsNullOrWhiteSpace(req.Source) ? "unknown" : req.Source!;
                BuildConsole.Services.ActivityLog.Log(ch,
                    $"Parsed: action='{req.Action}' src='{src}' ref='{req.Ref ?? "(none)"}'.");

                // activate → Git #2141: a blocked SECOND instance couriered this to ask the real,
                // already-running window to come to the foreground. No payload, no stream run —
                // just restore-if-minimized + SetForegroundWindow, on the UI thread we're already
                // on. Extends the existing pipe rather than a second parallel channel.
                if (string.Equals(req.Action, "activate", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action 'activate' to foreground handler (src='{src}').");
                    ActivateMainWindowFromProtocol();
                    return;
                }

                // runTest / uiTest → run a whole test manifest IN-PROCESS through the same
                // RunManifestAsync pipeline Play Test uses (MainWindow.ShaneAppRunTest.cs).
                if (string.Equals(req.Action, "runTest", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(req.Action, "uiTest", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to in-process runTest handler (src='{src}').");
                    await HandleShaneAppRunTestAsync(req, src, ch);
                    return;
                }

                // runPowerShell / executePowerShell / powershell → run PowerShell script and stream live stdout/stderr
                if (string.Equals(req.Action, "runPowerShell", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(req.Action, "executePowerShell", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(req.Action, "powershell", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to in-process PowerShell handler (src='{src}').");
                    await HandleShaneAppPowerShellAsync(req, src, ch);
                    return;
                }

                // runScan → trigger the REAL Copilot Readiness scan/assessment engine against a testbed
                // tenant over HTTP, reusing the exact trigger the customer UI calls (POST
                // /api/portal/assessment/debug-trigger-scan → runDiagnostics), enforcing the #965
                // isTestbed gate, and writing the real findings/scores/pillar breakdown to a result
                // envelope (MainWindow.ShaneAppRunScan.cs).
                if (string.Equals(req.Action, "runScan", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to runScan handler (src='{src}').");
                    BuildConsole.Services.ShaneAppStreamService.Instance.BeginRun("Tenant Scan", $"Source: {src}");
                    await HandleShaneAppRunScanAsync(req, src, ch);
                    BuildConsole.Services.ShaneAppStreamService.Instance.EndRun(true, "Scan completed");
                    return;
                }

                // executeScan → trigger exactly ONE real monitor check by its monitor_checks key
                // against a testbed tenant.
                if (string.Equals(req.Action, "executeScan", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to in-process executeScan handler (src='{src}').");
                    BuildConsole.Services.ShaneAppStreamService.Instance.BeginRun($"Monitor Check: {req.Ref}", $"Source: {src}");
                    await HandleShaneAppExecuteScanAsync(req, src, ch);
                    BuildConsole.Services.ShaneAppStreamService.Instance.EndRun(true, "Check completed");
                    return;
                }

                // executeCmdlet → run ONE allowlisted ps-execution PowerShell cmdlet (by its
                // cmdlet-catalog key) against a testbed tenant, through the SAME server code path a
                // real scan uses (POST /api/simulator/ps-execution/cmdlet → callPsExecution → the
                // ca-ps-execution[-dev] container). #1404 — the agent never holds the raw bearer
                // secret. See MainWindow.ShaneAppExecuteCmdlet.cs.
                if (string.Equals(req.Action, "executeCmdlet", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to executeCmdlet handler (src='{src}').");
                    BuildConsole.Services.ShaneAppStreamService.Instance.BeginRun("PowerShell Cmdlet", $"Source: {src}");
                    await HandleShaneAppExecuteCmdletAsync(req, src, ch);
                    BuildConsole.Services.ShaneAppStreamService.Instance.EndRun(true, "Cmdlet completed");
                    return;
                }

                // deployPsExecution → #1277: Docker build + ACR push + revision deploy of the
                // ps-execution container to the DEV Container App (ca-ps-execution-dev) ONLY —
                // never production (PsExecutionDeployService is dev-only by construction, #1385).
                // See MainWindow.ShaneAppDeployPsExecution.cs.
                if (string.Equals(req.Action, "deployPsExecution", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(req.Action, "deployPsExec", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to deployPsExecution handler (src='{src}').");
                    await HandleShaneAppDeployPsExecutionAsync(req, src, ch);
                    return;
                }

                // psExecutionRevision → #1277: read-only report of the DEV container's current
                // ACTIVE serving revision (Azure control plane), so a fix is verified against the
                // revision that is genuinely live and not a stale one (#1434).
                if (string.Equals(req.Action, "psExecutionRevision", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(req.Action, "psExecRevision", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to psExecutionRevision handler (src='{src}').");
                    await HandleShaneAppPsExecutionRevisionAsync(req, src, ch);
                    return;
                }

                // reportProgress → explicit progress report from running build
                if (string.Equals(req.Action, "reportProgress", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(req.Action, "progress", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Routing action '{req.Action}' to reportProgress handler (src='{src}').");
                    await HandleShaneAppReportProgressAsync(req, src, ch);
                    return;
                }

                if (!string.Equals(req.Action, "executeSql", StringComparison.OrdinalIgnoreCase))
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"Unsupported action '{req.Action}' — only executeSql / runTest / uiTest / runPowerShell / runScan / executeScan / executeCmdlet / deployPsExecution / psExecutionRevision / reportProgress / activate are handled. Ignoring.");
                    return;
                }

                var stream = BuildConsole.Services.ShaneAppStreamService.Instance;
                stream.BeginRun($"SQL: {System.IO.Path.GetFileName(req.Ref ?? "query.sql")}", $"Source: {src}");

                // Design: the payload NEVER rides in the URL — the URI carries only a
                // short ref to a temp file the caller wrote the real SQL into.
                if (string.IsNullOrWhiteSpace(req.Ref))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, "executeSql called with no ref= payload file — nothing to run.");
                    stream.AppendLine("[SQL ERROR] no ref= payload file supplied", BuildConsole.Services.ShaneAppLogLevel.Error);
                    WriteShaneAppResult(req, ok: false, error: "no ref= payload file supplied", statements: null);
                    stream.EndRun(false, "no ref file supplied");
                    return;
                }

                string sql;
                try
                {
                    var fi = new System.IO.FileInfo(req.Ref!);
                    if (!fi.Exists)
                    {
                        BuildConsole.Services.ActivityLog.Log(ch, $"executeSql payload file not found: {req.Ref}");
                        stream.AppendLine($"[SQL ERROR] payload file not found: {req.Ref}", BuildConsole.Services.ShaneAppLogLevel.Error);
                        WriteShaneAppResult(req, ok: false, error: $"payload file not found: {req.Ref}", statements: null);
                        stream.EndRun(false, "file not found");
                        return;
                    }
                    if (fi.Length > ShaneAppMaxPayloadBytes)
                    {
                        BuildConsole.Services.ActivityLog.Log(ch, $"executeSql payload file too large ({fi.Length} bytes > {ShaneAppMaxPayloadBytes}). Refusing.");
                        stream.AppendLine($"[SQL ERROR] payload file too large ({fi.Length} bytes)", BuildConsole.Services.ShaneAppLogLevel.Error);
                        WriteShaneAppResult(req, ok: false, error: $"payload file too large ({fi.Length} bytes)", statements: null);
                        stream.EndRun(false, "file too large");
                        return;
                    }
                    sql = await System.IO.File.ReadAllTextAsync(req.Ref!);
                }
                catch (Exception ex)
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeSql couldn't read payload {req.Ref}: {ex.Message}");
                    stream.AppendLine($"[SQL ERROR] couldn't read payload: {ex.Message}", BuildConsole.Services.ShaneAppLogLevel.Error);
                    WriteShaneAppResult(req, ok: false, error: $"couldn't read payload: {ex.Message}", statements: null);
                    stream.EndRun(false, ex.Message);
                    return;
                }

                if (string.IsNullOrWhiteSpace(sql))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeSql payload {req.Ref} was empty — nothing to run.");
                    stream.AppendLine("[SQL ERROR] payload was empty", BuildConsole.Services.ShaneAppLogLevel.Error);
                    WriteShaneAppResult(req, ok: false, error: "payload was empty", statements: null);
                    stream.EndRun(false, "empty payload");
                    return;
                }

                // shaneapp://executeSql routes SQL through the SAME pipe the manual SQL Runner
                // uses: BuildTrackerApiClient.ExecuteSqlAsync → POST /api/simulator/sql/execute
                if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
                {
                    const string notConfigured =
                        "api-server not configured — set apiBaseUrl + ingestToken in scripts/build-queue-watcher.config.json " +
                        "(executeSql uses the same POST /api/simulator/sql/execute path as the SQL Runner).";
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeSql can't run — {notConfigured}");
                    stream.AppendLine($"[SQL ERROR] {notConfigured}", BuildConsole.Services.ShaneAppLogLevel.Error);
                    WriteShaneAppResult(req, ok: false, error: notConfigured, statements: null);
                    stream.EndRun(false, "api-server not configured");
                    return;
                }

                BuildConsole.Services.ActivityLog.Log(ch,
                    $"executeSql running {sql.Length} char(s) of SQL from {req.Ref} (src='{src}') via SQL Runner pipe [{_buildTrackerApi.ConfiguredApiBaseUrl}]…");
                stream.AppendLine($"[SQL] Executing {sql.Length} chars of SQL from {req.Ref} on [{_buildTrackerApi.ConfiguredApiBaseUrl}]…", BuildConsole.Services.ShaneAppLogLevel.Sql);

                var sw = System.Diagnostics.Stopwatch.StartNew();
                try
                {
                    var statements = await BuildConsole.Services.LocalSqlExecutor.ExecuteAsync(_buildTrackerApi, sql);
                    int failed = statements.Count(s => !s.Success);
                    int ok = statements.Count - failed;
                    string? firstError = failed > 0 ? statements.First(s => !s.Success).Error : null;
                    WriteShaneAppResult(req, ok: failed == 0, error: firstError, statements: statements);
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"executeSql done in {sw.ElapsedMilliseconds}ms: {ok}/{statements.Count} statement(s) ok, {failed} failed. Result -> {BuildConsole.Services.ShaneAppProtocol.ResolveResultPath(req)}");

                    foreach (var s in statements)
                    {
                        var lvl = s.Success ? BuildConsole.Services.ShaneAppLogLevel.Success : BuildConsole.Services.ShaneAppLogLevel.Error;
                        var preview = s.StatementText.Length > 60 ? s.StatementText.Substring(0, 57) + "…" : s.StatementText;
                        stream.AppendLine($"[SQL] Statement: {preview} -> {(s.Success ? "OK" : "FAIL")} ({s.RowCount} rows, {s.ExecutionMs}ms)" + (!string.IsNullOrWhiteSpace(s.Error) ? $" :: {s.Error}" : ""), lvl);
                    }
                    stream.EndRun(failed == 0, $"{ok}/{statements.Count} statements ok in {sw.ElapsedMilliseconds}ms");
                }
                catch (Exception ex)
                {
                    WriteShaneAppResult(req, ok: false, error: ex.Message, statements: null);
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeSql FAILED after {sw.ElapsedMilliseconds}ms: {ex.Message}");
                    stream.AppendLine($"[SQL ERROR] {ex.Message}", BuildConsole.Services.ShaneAppLogLevel.Error);
                    stream.EndRun(false, ex.Message);
                }
            }
            catch (Exception ex)
            {
                // Absolute backstop — a protocol invocation must never take the app down.
                BuildConsole.Services.ActivityLog.Log(ch, $"shaneapp:// handler threw (swallowed): {ex.Message}");
                BuildConsole.Services.ShaneAppStreamService.Instance.EndRun(false, ex.Message);
            }
        }

        private async System.Threading.Tasks.Task HandleShaneAppPowerShellAsync(BuildConsole.Services.ShaneAppRequest req, string src, string ch)
        {
            var stream = BuildConsole.Services.ShaneAppStreamService.Instance;
            stream.BeginRun($"PowerShell: {System.IO.Path.GetFileName(req.Ref ?? "script.ps1")}", $"Source: {src}");

            try
            {
                string? scriptPath = req.Ref;
                string? scriptText = null;

                if (!string.IsNullOrWhiteSpace(scriptPath) && System.IO.File.Exists(scriptPath))
                {
                    scriptText = await System.IO.File.ReadAllTextAsync(scriptPath);
                }
                else
                {
                    scriptText = GetShaneAppQueryParam(req.Raw, "script") ?? req.Ref;
                }

                if (string.IsNullOrWhiteSpace(scriptText))
                {
                    stream.AppendLine("[PS ERROR] No PowerShell script content or ref= file found.", BuildConsole.Services.ShaneAppLogLevel.Error);
                    WriteShaneAppResult(req, ok: false, error: "no script supplied", statements: null);
                    stream.EndRun(false, "no script");
                    return;
                }

                stream.AppendLine($"[PS] Executing PowerShell script ({scriptText.Length} chars)…", BuildConsole.Services.ShaneAppLogLevel.PowerShell);

                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{scriptText.Replace("\"", "\\\"")}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var proc = new System.Diagnostics.Process { StartInfo = psi };
                proc.OutputDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                        stream.AppendLine(e.Data, BuildConsole.Services.ShaneAppLogLevel.PowerShell);
                };
                proc.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                        stream.AppendLine(e.Data, BuildConsole.Services.ShaneAppLogLevel.Error);
                };

                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                await proc.WaitForExitAsync();

                bool ok = proc.ExitCode == 0;
                stream.AppendLine($"[PS] Process exited with code {proc.ExitCode}", ok ? BuildConsole.Services.ShaneAppLogLevel.Success : BuildConsole.Services.ShaneAppLogLevel.Error);
                WriteShaneAppResult(req, ok: ok, error: ok ? null : $"Exit code {proc.ExitCode}", statements: null);
                stream.EndRun(ok, $"Exit code {proc.ExitCode}");
            }
            catch (Exception ex)
            {
                stream.AppendLine($"[PS ERROR] {ex.Message}", BuildConsole.Services.ShaneAppLogLevel.Error);
                WriteShaneAppResult(req, ok: false, error: ex.Message, statements: null);
                stream.EndRun(false, ex.Message);
            }
        }

        /// <summary>
        /// Best-effort writes the JSON result envelope for a shaneapp:// invocation
        /// to <see cref="BuildConsole.Services.ShaneAppProtocol.ResolveResultPath"/>,
        /// so the caller can read the real outcome (the same SqlStatementResult shape
        /// the SQL Runner renders). A failed write is logged, never thrown.
        /// </summary>
        private void WriteShaneAppResult(BuildConsole.Services.ShaneAppRequest req, bool ok, string? error,
            System.Collections.Generic.List<BuildConsole.Services.SqlStatementResult>? statements)
        {
            string path = BuildConsole.Services.ShaneAppProtocol.ResolveResultPath(req);
            try
            {
                var envelope = new
                {
                    ok,
                    error,
                    action = req.Action,
                    source = req.Source,
                    ranAtUtc = DateTime.UtcNow.ToString("o"),
                    statementCount = statements?.Count ?? 0,
                    statements,
                };
                System.IO.File.WriteAllText(path,
                    System.Text.Json.JsonSerializer.Serialize(envelope,
                        new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                    $"couldn't write result file {path}: {ex.Message}");
            }
        }
    }
}
