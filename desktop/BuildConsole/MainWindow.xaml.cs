using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
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
        private BuildConsole.Services.BuildQueuePostgresClient? _queueDb;

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
        }
        private readonly Dictionary<TabItem, ChatTabState> _chatTabs = new();
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
        /// <summary>Open-issue-number cache for the Home "Done, waiting for you" section (a `gh` CLI read). Manual-only GitHub (Shane, 2026-08-14): refreshed ONLY on a force roll-up (Home-tab open/refresh), no longer on a ~60s background cadence — the background 10s tick keeps the local-dev-server queue live without touching GitHub.</summary>
        private HashSet<int> _homeOpenIssueNumbers = new();
        /// <summary>Content signature of the last Running/Done render — skips the re-render (and its section-render log) on a 10s tick whose data is identical, same anti-flicker pattern as BuildQueuePanel's _lastQueueSignature.</summary>
        private string? _homeRollupSignature;

        // ── Git #937: always-on-top Sticky Notes floaty ─────────────────────────
        private StickyNotesWindow? _stickyNotes;

        // ── Git #980: floaty 8-slot Build Watch window ──────────────────────────
        private BuildWatchWindow? _buildWatch;
        // The editor pane (of the four from #893) the user last interacted with —
        // Send targets whatever Claude chat is active THERE. Updated both on tab
        // selection and on keyboard focus entering a pane (clicking into a
        // WebView2 to type doesn't change WPF selection, but it does move focus).
        private TabControl? _activeEditorPane;

        // ── Git #805: deploy-status poll (Epic #803 Phase 1) ─────────────────────
        private DispatcherTimer? _deployStatusTimer;
        private string? _lastSeenDeployCommitHash;

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

        private void OpenTestHistory_Click(object sender, RoutedEventArgs e)
        {
            EnsureTestHistoryWindow();
        }

        /// <summary>Called from controls (e.g. GitDetailView) to open history filtered to a specific issue.</summary>
        public void EnsureTestHistoryWindowPublic(int? issueFilter = null) => EnsureTestHistoryWindow(issueFilter);

        public MainWindow()
        {
            InitializeComponent();

            // Set dark background on XAML background webviews so they never flash white
            ClaudeWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37);
            ReplitWatcherWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37);
            UsageMeterWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37);

            // Build completion sound mute toggle — reflect the persisted state
            // (%AppData%\BuildConsole\settings.json) in the menu checkmark on launch.
            MuteCompletionSoundMenuItem.IsChecked = BuildConsole.Services.BuildConsoleSettings.Load().BuildCompleteSoundMuted;

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

            _ = InitializeClaudeTabAsync();

            // Build Queue selection -> Build Log
            BuildQueuePanel.TaskSelected += BuildQueuePanel_TaskSelected;

            // Shane: "Feel free to change anything to patch how I actually work
            // based on the Add-In." One shared API client, reading the SAME
            // config scripts/build-queue-watcher.ps1 already uses (no separate
            // setup step) - both the queue panel and the left sidebar's real
            // Issues board are driven by it, same backend the extension talks to.
            var btConfig = BuildConsole.Services.BuildTrackerConfig.Load();
            BuildConsole.Services.ActivityLog.Log("startup", btConfig.IsConfigured
                ? $"Config loaded: {btConfig.ApiBaseUrl}"
                : $"Config NOT found/incomplete (checked {BuildConsole.Services.BuildTrackerConfig.FindConfigPath() ?? "scripts\\build-queue-watcher.config.json"}) — panels will show 'Not connected'.");
            _buildTrackerApi = new BuildConsole.Services.BuildTrackerApiClient(btConfig);

            // Git #817 — Shane: "Ohh I thought you build that into the WPF
            // app." He was right to assume that - a queue with nothing
            // claiming it isn't useful, and requiring a SEPARATE PowerShell
            // window running scripts/build-queue-watcher.ps1 defeated the
            // whole "everything in one window" point of this app. Same
            // logic, now running in-process; see QueueWatcherService's own
            // doc comment for the one real caveat (don't run both at once).
            // Created BEFORE BuildQueuePanel.Initialize so Stop/Run Now
            // (#820) have a real watcher to call into from the start.
            if (_buildTrackerApi.IsConfigured)
            {
                // Direct Postgres connection for all queue DB operations (claim, complete,
                // force-claim, orphan-sweep) — bypasses the API server entirely so queue
                // state is always correct even when Replit is napping. Reads DATABASE_URL
                // from .env.local at the repo root (already set up for local dev).
                var repoRootForDb = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot() ?? "";
                _queueDb = BuildConsole.Services.BuildQueuePostgresClient.TryCreate(
                    btConfig,
                    repoRootForDb,
                    msg => BuildConsole.Services.ActivityLog.Log("watcher", msg));

                _queueWatcher = new BuildConsole.Services.QueueWatcherService(
                    _buildTrackerApi, _queueDb, btConfig.MaxConcurrent, BuildConsole.Services.BuildTrackerConfig.FindRepoRoot());
                _queueWatcher.BuildFinished += QueueWatcher_BuildFinished;
                _queueWatcher.Start();

                // Git #898 — same "app is already open for the build queue" assumption:
                // start listening for remote UI-test run requests too.
                StartTestTriggerPoll();

                // Epic #803 — auto deploy+verify+test on build completion. Reuses the exact
                // endpoints trigger-deploy-and-wait.ps1 drives by hand (#911 build-complete +
                // #805 deploy-status) and the in-process regression sweep, fired automatically
                // off QueueWatcherService.BuildFinished (see QueueWatcher_BuildFinished) instead
                // of requiring the .ps1 + a manual test run. Injected-delegate shape mirrors
                // RegressionScheduleService above.
                _postBuildDeploy = new BuildConsole.Services.PostBuildDeployPipeline(
                    BuildConsole.Services.BuildTrackerConfig.FindRepoRoot() ?? "",
                    () => _buildTrackerApi.PostBuildCompleteAsync(),
                    () => _buildTrackerApi.GetDeployStatusAsync(),
                    RunScopedManifestsAsync,
                    SurfacePostBuildDeployOutcome);

                BuildQueuePanel.Initialize(_buildTrackerApi, _queueWatcher, _queueDb);
            }
            else
            {
                BuildQueuePanel.Initialize(_buildTrackerApi, _queueWatcher);
            }

            // shaneapp://executeSql — the LOCAL protocol trigger (deliberately NOT
            // over HTTP like #898; SQL runs through this app's own direct local Postgres
            // connection, zero round-trip to the deployed api-server). Started
            // unconditionally, even when no databaseUrl is configured, so an invocation
            // is always logged and gets a clear error result rather than silence.
            StartShaneAppProtocolListener();

            LeftSidebar.Initialize(_buildTrackerApi, _queueDb);
            BuildLogView.Initialize(_buildTrackerApi);
            TerminalView.Initialize(_buildTrackerApi);
            MarketingLogView.Initialize("shane-mccaw-consulting", "Marketing", 5173, "artifacts/shane-mccaw-consulting", "🌐");
            PortalLogView.Initialize("msp-portal", "Portal", 5175, "artifacts/msp-portal", "💼");
            AdminLogView.Initialize("admin-panel", "Admin", 5174, "artifacts/admin-panel", "⚙️");
            ApiServerLogView.Initialize("api-server", "API Server", 8080, "artifacts/api-server", "🖥️");

            StartTopServicesPoll();

            // Git #902 — Shane: "Replit shuts its dev mode down after ~10 min of
            // inactivity... Can we use WebView2 to watch the site. When it sees the
            // services off it waits 20 seconds then turns them back on." The watcher
            // drives the hidden ReplitWatcherWebView through the SAME shared WebView2
            // environment as every visible tab (EnsureWebViewInitializedAsync), so it
            // clicks Run inside Shane's authenticated Replit session. ApplyConfig()
            // starts/stops it per Settings; it re-reads Settings whenever Shane saves.
            _replitWatcher = new BuildConsole.Services.ReplitWatcherService(
                ReplitWatcherWebView, EnsureWebViewInitializedAsync);
            _replitWatcher.StatusChanged += ReplitWatcher_StatusChanged;
            _replitWatcher.OpenVisibleWorkspaceTab = OpenOrFocusReplitWorkspaceTabAsync;
            // Git #954 — the Replit watcher's "re-apply on save" hook moved onto the
            // Settings tab (SettingsTabView.ReplitWatcherSettingsChanged), wired per
            // tab instance in OpenSettingsTab; the sidebar no longer owns it.
            _replitWatcher.ApplyConfig();

            // Claude usage meter — a background poll (same DispatcherTimer + hidden
            // WebView2 shape as the Replit watcher) of claude.ai/settings/usage,
            // driving its own dedicated UsageMeterWebView through the SAME shared
            // WebView2 environment so it reads the meter inside Shane's login. Start()
            // arms the poll + a fast display timer that ticks the ≥85% countdown
            // smoothly between polls; the status bar just renders what it emits.
            _usageMeter = new BuildConsole.Services.ClaudeUsageMeterService(
                UsageMeterWebView, EnsureWebViewInitializedAsync);
            _usageMeter.StatusChanged += UsageMeter_StatusChanged;
            _usageMeter.Start();

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
            _regressionScheduler.ApplyConfig();

            // Claude Online Status (status.anthropic.com) — polls Anthropic's public Statuspage
            _claudeOnlineService = new BuildConsole.Services.ClaudeStatusService();
            _claudeOnlineService.StatusChanged += ClaudeOnlineService_StatusChanged;
            _claudeOnlineTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
            _claudeOnlineTimer.Tick += async (_, _) => await _claudeOnlineService.CheckStatusAsync();
            _claudeOnlineTimer.Start();
            _ = _claudeOnlineService.CheckStatusAsync();

            // Random Encouragement Critter — strolls across the screen periodically to cheer Shane on with milestone progress!
            BuildConsole.Services.EncouragementService.Instance.Start();

            // Git #815 — surfaces a failed poll as a real, visible signal
            // (status-bar QueueDot/QueueStatusText, previously unused
            // hardcoded XAML) instead of silent inline tree text nobody
            // notices, PLUS every poll's outcome goes to the Output log too.
            LeftSidebar.SyncError += (s, err) => ReportSyncStatus(err);
            BuildQueuePanel.SyncError += (s, err) => ReportSyncStatus(err);

            // Git #851 — Shane: "When clicking on an In-Flight Still Open
            // issue, it should open the chat that is associated to that
            // issue." Resolves via LeftSidebar's already-fetched chat/epic
            // data (no separate fetch) and opens/focuses it exactly like
            // clicking the same chat in the Chats tree would.
            BuildQueuePanel.IssueChatRequested += (s, githubNumber) => OpenChatForIssue(githubNumber);
            BuildQueuePanel.QueueItemChatRequested += (s, item) => OpenChatForQueueItem(item);
            BuildQueuePanel.EpicSubIssueClicked += async (s, githubNumber) => await OpenGitDetailByNumberAsync(githubNumber, sideBySide: true);
            BuildQueuePanel.FullGitRefreshRequested += (s, e) =>
            {
                LeftSidebar.PopulateGitTrackerBoard(forceFresh: true);
                LeftSidebar.PopulateChatsTree();
                LeftSidebar.RefreshGitStatus();
                LeftSidebar.PopulateManifestsList();
                if (_homeView != null)
                {
                    _homeView.RenderDashboardState(LeftSidebar.CurrentBoardIssues, LeftSidebar.CurrentMilestones);
                }
                RefreshOpenGitDetailTabs();
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

            // Backs "Assign Chat to Epic..."'s "Assign current chat" button --
            // only a chat tab opened via OpenChatTab has its TabItem.Tag typed as
            // BoardChat (plain web tabs use a bare string url), so this is how we
            // tell "a real focused chat" apart from any other open tab kind.
            LeftSidebar.GetActiveChatUrl = () =>
                EditorTabs.SelectedItem is TabItem selected && selected.Tag is BuildConsole.Services.BoardChat chat
                    ? chat.ClaudeUrl
                    : null;
            LeftSidebar.GetQueueItems = () => BuildQueuePanel.CurrentQueueItems;

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
            try { OpenOrFocusReplitWorkspaceTabInternal(); } catch { }
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

            // Git #805 — Epic #803 Phase 1: "polling, not webhook/SSE... follow
            // the existing pattern." Same 3s DispatcherTimer shape as
            // _buildTailTimer above, hitting the new GET /api/internal/deploy-status
            // endpoint. A changed commitHash from the last-seen value IS the
            // "deploy complete" signal - no separate push mechanism needed.
            _deployStatusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _deployStatusTimer.Tick += async (_, _) => await PollDeployStatusAsync();
            _deployStatusTimer.Start();

            // Version status bar + auto-Update button (see MainWindow.VersionUpdate.cs):
            // live "Current: v{Major}.{Minor}.{build}" vs the build THIS instance was
            // compiled from, with a queue-gated deploy when the running copy is behind.
            InitializeVersionUpdate();

            // Focus Mode (active-milestone global filter + downtime quick-tasks +
            // context save/restore + game layer). All logic lives in FocusModeService
            // and MainWindow.FocusMode.cs — this is the single shell-side entry point.
            InitFocusMode();

            // If a previous session persisted Queue clicks while a version Update was
            // pending (the deploy restart would have dropped them), re-queue them now
            // that the Build Tracker client + panels are initialized (see
            // MainWindow.PendingUpdateQueue.cs). Fire-and-forget — never blocks launch.
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

            // Animated startup loading overlay (StartupOverlay in XAML, already painting
            // its running-character animation). Build its honest per-connection rows and
            // kick off the real probes now that _buildTrackerApi + _usageMeter exist; it
            // fades out to reveal Home once every real launch connection settles (or times
            // out). See InitializeStartupOverlay for the full wiring.
            InitializeStartupOverlay();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Services.WindowChromeHelper.Setup(this);
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

        private static Microsoft.Web.WebView2.Wpf.WebView2? WebViewOf(TabItem ti)
        {
            if (ti.Content is Microsoft.Web.WebView2.Wpf.WebView2 direct) return direct;
            if (ti.Content is Panel panel)
            {
                foreach (var child in panel.Children)
                    if (child is Microsoft.Web.WebView2.Wpf.WebView2 wv) return wv;
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
                if (EditorTabs.SelectedItem is TabItem { Tag: BuildConsole.Services.BoardChat chat })
                {
                    // Git #910 — the real GitHub epic number now goes along with the
                    // internal epicId/title, so BuildQueuePanel can fetch real sub-issues.
                    var epicGithubNumber = chat.EpicId.HasValue ? LeftSidebar.GetEpicGithubNumber(chat.EpicId.Value) : null;
                    BuildQueuePanel.SetActiveChatEpic(
                        chat.EpicId,
                        epicGithubNumber,
                        chat.EpicId.HasValue ? LeftSidebar.GetEpicTitle(chat.EpicId.Value) : null);
                    // Shane: "I should be able to look at the Git Board Tree
                    // View and know exactly what Epic I'm working" — same
                    // signal, so the Git Board highlight tracks whichever
                    // chat tab is on screen.
                    LeftSidebar.SetActiveEpicGithubNumber(epicGithubNumber);
                }
                else
                {
                    BuildQueuePanel.SetActiveChatEpic(null, null, null);
                    LeftSidebar.SetActiveEpicGithubNumber(null);
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
        private const string EpicChatPrefillPollScript = @"
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
            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
            {
                BuildConsole.Services.ActivityLog.Log("git-board.chat", $"cannot associate chat {conversationId} to {issueType} #{issueNumber}: Build Tracker API not configured");
                return;
            }
            try
            {
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
            var wv = new Microsoft.Web.WebView2.Wpf.WebView2
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

            string? initialConversationId = null;
            var initConvMatch = System.Text.RegularExpressions.Regex.Match(
                url, @"/chat/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})");
            if (initConvMatch.Success) initialConversationId = initConvMatch.Groups[1].Value;

            bool navigated = false;
            bool epicAssocWired = false;
            bool epicAssociated = false;
            wv.Loaded += async (s, e) =>
            {
                bool ready = await EnsureWebViewInitializedAsync(wv);

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

                if (ready && !navigated)
                {
                    navigated = true;
                    wv.CoreWebView2.Navigate(url);
                }
            };

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


            wv.SourceChanged += (s, e) =>
            {
                urlBox.Text = wv.Source?.ToString() ?? string.Empty;
            };

            var webContainer = new Grid
            {
                Background = (Brush)FindResource("BaseBrush")
            };
            webContainer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            webContainer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            Grid.SetRow(navBar, 0);
            Grid.SetRow(wv, 1);

            webContainer.Children.Add(navBar);
            webContainer.Children.Add(wv);

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
            var wv = new Microsoft.Web.WebView2.Wpf.WebView2
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

        public void OpenChatTab(BuildConsole.Services.BoardChat chat, int? githubNumber)
        {
            // Dedupe on the chat's own id, not the URL - a chat's ClaudeUrl
            // doesn't change, so this is equivalent, but keeps the intent clear.
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Key.Tag is BuildConsole.Services.BoardChat existing &&
                    existing.ConversationId == chat.ConversationId)
                {
                    EditorTabs.SelectedItem = kvp.Key;
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
            headerPanel.Children.Add(new TextBlock
            {
                Text = chat.Title, FontSize = 13, Margin = new Thickness(0, 0, 6, 0),
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
            boltBtn.Click += (s, e) =>
            {
                BuildConsole.Services.FocusModeService.Instance.ToggleChatInProgress(chat.ConversationId, chat.Title, chat.ClaudeUrl);
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

            var wv = BuildChatWebView(chat);

            // Split grid: chat WebView2 in column 0, build output pane in
            // column 1 (starts collapsed - PollChatTabBuildStateAsync opens it
            // the moment a matching queue item goes 'running', closes it again
            // once that item finishes).
            var splitGrid = new Grid();
            var col0 = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
            var buildCol = new ColumnDefinition { Width = new GridLength(0) };
            splitGrid.ColumnDefinitions.Add(col0);
            splitGrid.ColumnDefinitions.Add(buildCol);
            Grid.SetColumn(wv, 0);
            splitGrid.Children.Add(wv);

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

            var newTab = new TabItem { Tag = chat, Header = headerPanel, Content = splitGrid };
            var state = new ChatTabState
            {
                GithubNumber = githubNumber,
                SplitGrid = splitGrid,
                BuildColumn = buildCol,
                BuildOutputBox = buildOutputBox,
                BuildStatusText = buildStatusText,
                WebView = wv // Git #942 — target for live chat-button status pushes
            };
            _chatTabs[newTab] = state;

            closeBtn.Click += (s, e) => CloseTab(newTab);

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);
            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
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
            home.DoneItemClicked     += (s, c) => { if (c.GithubNumber is int n) OpenChatForIssue(n); };
            // Clear a stale/orphaned "Running now" row — cancel the queue item (same
            // DELETE queue/{id} the Build Queue panel's right-click Cancel uses), then refresh.
            home.ClearStuckItemRequested += async (s, c) =>
            {
                if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured) return;
                try { await _buildTrackerApi.CancelQueueItemAsync(c.QueueItemId); }
                catch { /* best-effort — a failed cancel just leaves the row, never crashes the glance screen */ }
                await RefreshHomeRollupAsync(force: true);
            };

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
            if (_whatsNewReady) home.RenderWhatsNew(_whatsNewVersion, _whatsNewTitles, _whatsNewMore);
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

                // First launch ever (or a pre-existing settings.json with no lastSeenBuild):
                // seed the baseline silently — don't dump the whole history as "new".
                if (lastSeen < 0)
                {
                    settings.LastSeenBuild = current;
                    settings.Save();
                    return;
                }

                if (current <= lastSeen) return; // nothing new since last launch

                const int max = 15;
                var titles = await System.Threading.Tasks.Task.Run(
                    () => BuildConsole.Services.VersionInfo.GetNewCommitTitles(lastSeen, max));

                // "more" means genuinely-uncovered-by-the-max-cap commits, NOT bookend
                // commits GetNewCommitTitles already filtered out of titles — those are
                // intentionally hidden, not truncated, so they must not inflate this count.
                int totalNew = current - lastSeen;
                int take = Math.Min(totalNew, max);
                int more = Math.Max(0, totalNew - take);

                _whatsNewTitles = titles;
                _whatsNewVersion = BuildConsole.Services.VersionInfo.Format(current);
                _whatsNewMore = more;
                _whatsNewReady = true;

                // Advance last-seen now (once computed) so this set won't re-show next launch.
                settings.LastSeenBuild = current;
                settings.Save();

                // Render into the Home tab if it's currently open (it is at launch).
                if (_homeView != null && titles.Count > 0)
                    _homeView.RenderWhatsNew(_whatsNewVersion, _whatsNewTitles, _whatsNewMore);
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

        private void OpenChatForQueueItem(BuildConsole.Services.QueueItem item)
        {
            // 0. Try resolving by OriginatingChatId
            if (!string.IsNullOrWhiteSpace(item.OriginatingChatId))
            {
                var matchByConv = LeftSidebar.CurrentBoardChats?.FirstOrDefault(c =>
                    string.Equals(c.ConversationId, item.OriginatingChatId, StringComparison.OrdinalIgnoreCase));
                if (matchByConv != null)
                {
                    OpenChatTab(matchByConv, item.GithubNumber ?? matchByConv.IssueGithubNumber);
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
                OpenChatUrl(url, item.Title, item.GithubNumber);
                return;
            }

            // 2. Fall back to resolving chat by GitHub issue number via LeftSidebar
            if (item.GithubNumber.HasValue)
            {
                var chat = LeftSidebar.FindChatForIssue(item.GithubNumber.Value);
                if (chat != null)
                {
                    OpenChatTab(chat, item.GithubNumber.Value);
                    return;
                }
            }

            // 3. Fall back to search for matching title in LeftSidebar's board chats
            var fallbackChat = LeftSidebar.CurrentBoardChats?.FirstOrDefault(c =>
                (item.GithubNumber.HasValue && c.IssueGithubNumber == item.GithubNumber.Value) ||
                (!string.IsNullOrEmpty(c.Title) && item.Title.Contains(c.Title, StringComparison.OrdinalIgnoreCase)));
            if (fallbackChat != null)
            {
                OpenChatTab(fallbackChat, item.GithubNumber ?? fallbackChat.IssueGithubNumber);
                return;
            }

            ToastEngine.Warning("Open Chat", $"No Claude chat found for build '{item.Title}'.");
        }

        public void OpenChatUrl(string url, string? title = null, int? githubNumber = null)
        {
            if (string.IsNullOrWhiteSpace(url)) return;
            url = url.Trim();
            string convId = ExtractConversationId(url);

            // 1. If tab is already open in any pane, activate and focus it
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Key.Tag is BuildConsole.Services.BoardChat existing &&
                    (existing.ConversationId == convId || (!string.IsNullOrEmpty(existing.ClaudeUrl) && existing.ClaudeUrl.TrimEnd('/') == url.TrimEnd('/'))))
                {
                    var parentTabControl = kvp.Key.Parent as TabControl ?? EditorTabs;
                    parentTabControl.SelectedItem = kvp.Key;
                    return;
                }
            }

            // 2. Check if LeftSidebar already knows this chat
            var knownChat = LeftSidebar.CurrentBoardChats?.FirstOrDefault(c => c.ConversationId == convId || (!string.IsNullOrEmpty(c.ClaudeUrl) && c.ClaudeUrl.TrimEnd('/') == url.TrimEnd('/')));
            if (knownChat != null)
            {
                OpenChatTab(knownChat, githubNumber ?? knownChat.IssueGithubNumber);
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
            OpenChatTab(newChat, githubNumber);
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

        /// <summary>
        /// Local #47 — resolve the Claude chat linked to a child issue and return a
        /// ready-to-host chat WebView2 for the immersive Focus view's OWN centre panel.
        /// Returns null (and toasts) when no chat is linked yet, so the immersive view can
        /// fall back to its own calm empty state. Crucially this does NOT touch the normal
        /// tab bar and does NOT exit immersive mode — that exit-then-open-in-main-tabs
        /// behaviour (via OpenChatForIssue) was the whole bug this fixes.
        /// </summary>
        public Microsoft.Web.WebView2.Wpf.WebView2? BuildImmersiveChatView(int githubNumber)
        {
            var chat = LeftSidebar.FindChatForIssue(githubNumber);
            if (chat == null)
            {
                ToastEngine.Warning("Open Chat", $"No chat linked to #{githubNumber} yet.");
                return null;
            }
            return BuildChatWebView(chat);
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
            try { queue = await _buildTrackerApi.GetQueueAsync(); }
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
        /// Git #805 — polls GET /api/internal/deploy-status every 3s (same
        /// interval as PollChatTabBuildStateAsync above) and treats a changed
        /// commitHash from the last one this app has seen as "deploy complete".
        /// The first successful poll after startup only seeds the baseline -
        /// it deliberately does NOT fire a "deploy complete" line, since there
        /// was no prior deploy this app watched to compare against.
        /// </summary>
        private async System.Threading.Tasks.Task PollDeployStatusAsync()
        {
            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured) return;

            BuildConsole.Services.DeployStatus? status;
            try
            {
                status = await _buildTrackerApi.GetDeployStatusAsync();
            }
            catch (Exception ex)
            {
                ReportDeployStatus(ex.Message);
                return;
            }

            if (status == null || string.IsNullOrWhiteSpace(status.CommitHash))
            {
                ReportDeployStatus("empty deploy-status response");
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

        /// <summary>Refresh icon next to the usage status text — triggers an immediate manual poll instead of waiting for the next scheduled cycle (Shane reports the automatic poll only lands ~25% of the time). Reuses the exact same polling logic as the timer via ClaudeUsageMeterService.ManualRefreshAsync; the service's own Polling-state emit (dot turns amber, "Checking claude.ai…" tooltip) is the in-progress feedback, so a click is never silent. Button is disabled for the duration so repeat clicks can't stack polls.</summary>
        private async void BtnUsageRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (_usageMeter == null) return;
            BtnUsageRefresh.IsEnabled = false;
            try
            {
                await _usageMeter.ManualRefreshAsync();
            }
            finally
            {
                BtnUsageRefresh.IsEnabled = true;
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

            UsageDot.Fill = status.State switch
            {
                BuildConsole.Services.ClaudeUsageMeterState.Ok => DotReady,
                BuildConsole.Services.ClaudeUsageMeterState.Polling => DotLoading,
                BuildConsole.Services.ClaudeUsageMeterState.Error => DotError,
                _ => (Brush)FindResource("Surface2Brush"), // Unavailable — muted
            };

            UsageStatusText.Text = status.DisplayText;
            UsageStatusText.ToolTip = status.ToolTip;

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
        private void InitializeStartupOverlay()
        {
            if (StartupOverlay == null) return;

            _startupConnectivity = new BuildConsole.Services.StartupConnectivityService(_buildTrackerApi, _replitWatcher);

            // Build one row per real connection, in order, before any probe reports in.
            StartupOverlay.Initialize(_startupConnectivity.Connections);

            // Per-connection repaint (marshals onto the UI thread itself).
            _startupConnectivity.ConnectionChanged += status => StartupOverlay.UpdateConnection(status);

            // All real connections settled → play the brief "Ready!" beat + fade-out.
            _startupConnectivity.AllSettled += () => StartupOverlay.FadeOutAndDismiss();

            // Fade-out finished → drop the overlay from the tree entirely.
            StartupOverlay.DismissRequested += StartupOverlay_DismissRequested;

            _startupConnectivity.Start();
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

            // 0a. Mark as In Progress (for Chat Tabs)
            if (tabItem.Tag is BuildConsole.Services.BoardChat chat || _chatTabs.ContainsKey(tabItem))
            {
                var targetChat = (tabItem.Tag as BuildConsole.Services.BoardChat)
                                 ?? _chatTabs.Keys.FirstOrDefault(k => k == tabItem)?.Tag as BuildConsole.Services.BoardChat;

                var miInProgress = new MenuItem { Header = "✈️ Mark as In Progress" };
                miInProgress.Click += async (s, e) =>
                {
                    await MarkChatTabInProgressAsync(tabItem, targetChat);
                };
                cm.Items.Add(miInProgress);
                cm.Items.Add(new Separator());
            }

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

            if (tabItem.Header is FrameworkElement feHeader)
            {
                feHeader.ContextMenu = cm;
            }
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

            var dlg = new RenameTabDialog(currentTitle) { Owner = this };
            if (dlg.ShowDialog() == true && !string.IsNullOrWhiteSpace(dlg.NewTabName))
            {
                string newName = dlg.NewTabName;
                if (titleBlock != null)
                {
                    titleBlock.Text = newName;
                    titleBlock.ToolTip = newName;
                }
                else if (tabItem.Header is string)
                {
                    tabItem.Header = newName;
                }

                if (tabItem.Tag is BuildConsole.Services.BoardChat chat)
                {
                    chat.Title = newName;
                    PersistOpenChatTabs();
                }

                var currentOwner = tabItem.Parent as TabControl;
                if (currentOwner?.SelectedItem == tabItem)
                {
                    ActiveDocTitleText.Text = $" - {newName}";
                }

                BuildConsole.Services.ActivityLog.Log("tabs", $"Renamed tab to '{newName}'");
            }
        }

        private async System.Threading.Tasks.Task MarkChatTabInProgressAsync(TabItem tabItem, BuildConsole.Services.BoardChat? chat)
        {
            try
            {
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
                    ToastEngine.Success("In-Progress", $"Chat '{chat?.Title ?? "Session"}' marked in-progress");
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

                if (chat != null)
                {
                    if (!chat.Title.StartsWith("✈"))
                    {
                        chat.Title = "✈️ " + chat.Title;
                    }
                    if (!string.IsNullOrEmpty(chat.ConversationId) && !BuildConsole.Services.FocusModeService.Instance.IsChatInProgress(chat.ConversationId))
                    {
                        BuildConsole.Services.FocusModeService.Instance.ToggleChatInProgress(chat.ConversationId, chat.Title, chat.ClaudeUrl);
                    }
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
                LeftSidebar.PopulateChatsTree();
                _ = BuildQueuePanel.RefreshAsync();

                BuildConsole.Services.ActivityLog.Log("chat.status", $"Marked chat '{chat?.Title ?? tabItem.Tag?.ToString()}' as in-progress (in-flight)");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("In-Progress", $"Failed to mark in-progress: {ex.Message}");
            }
        }

        public void CloseTab(TabItem tabItem, TabControl? ownerTabControl = null)
        {
            var owner = (tabItem.Parent as TabControl)
                        ?? ownerTabControl
                        ?? new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 }.FirstOrDefault(p => p.Items.Contains(tabItem));

            if (owner == null) return;

            // Clean up tab tracking
            if (_chatTabs.ContainsKey(tabItem))
            {
                _chatTabs.Remove(tabItem);
                PersistOpenChatTabs();
            }
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

                if (EditorTabs.Items.Count == 0 && EditorTabs2.Items.Count == 0 && EditorTabs3.Items.Count == 0 && EditorTabs4.Items.Count == 0)
                {
                    ActiveDocTitleText.Text = "";
                }

                CollapseEmptySplitPanes();
            });
        }

        /// <summary>Recursively finds and disposes every WebView2 in <paramref name="root"/>'s visual
        /// subtree. A tab's WebView2 is always wrapped (nav toolbar + WebView2 in a Grid for web tabs,
        /// a split Grid with an optional inline SQL runner for chat tabs, etc.), so a single-level
        /// `Content is WebView2` check never matches — this is what actually frees the native HWND and
        /// CoreWebView2 process when a tab closes, instead of leaving it running unreferenced.</summary>
        private static void DisposeWebView2Descendants(DependencyObject? root)
        {
            if (root == null) return;
            if (root is Microsoft.Web.WebView2.Wpf.WebView2 wv)
            {
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
            
            ActiveDocTitleText.Text = " - SQL Runner";
            
            return sqlViewer;
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
                var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
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

            ActiveDocTitleText.Text = $" - {fileName}";
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
            BuildLogView.LoadQueueItem(e.QueueItemId, e.Epic, e.Task, e.Status, e.ExitCode);
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

        private void BtnSailorDuckMascot_Click(object sender, RoutedEventArgs e)
        {
            SailorDuckLayer?.SummonMascot();
            ToastEngine.Success("Sailor Duck Mascot", "Quack! Ahoy Captain Shane! ⚓ (Ctrl+Shift+D)");
        }

        #region Top Bar Quick Services Control

        private DispatcherTimer? _topServicesTimer;

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
                bool mkt  = await DevServicesManager.IsPortOpenAsync(5173);
                bool port = await DevServicesManager.IsPortOpenAsync(5175);
                bool adm  = await DevServicesManager.IsPortOpenAsync(5174);
                bool api  = await DevServicesManager.IsPortOpenAsync(8080);

                int runningCount = (mkt ? 1 : 0) + (port ? 1 : 0) + (adm ? 1 : 0) + (api ? 1 : 0);
                if (runningCount == 4)
                {
                    TopServicesStatusDot.Text = "🟢";
                    TopServicesStatusDot.ToolTip = "All 4 dev services running (5173, 5174, 5175, 8080)";
                }
                else if (runningCount > 0)
                {
                    TopServicesStatusDot.Text = "🟡";
                    TopServicesStatusDot.ToolTip = $"{runningCount}/4 dev services running";
                }
                else
                {
                    TopServicesStatusDot.Text = "⚪";
                    TopServicesStatusDot.ToolTip = "All dev services stopped";
                }

                MenuMarketingItem.Header  = $"🌐 Marketing (5173) [{(mkt  ? "RUNNING" : "STOPPED")}]";
                MenuPortalItem.Header     = $"💼 Portal (5175) [{(port ? "RUNNING" : "STOPPED")}]";
                MenuAdminItem.Header      = $"⚙️ Admin (5174) [{(adm  ? "RUNNING" : "STOPPED")}]";
                MenuApiServerItem.Header  = $"🖥️ API Server (8080) [{(api  ? "RUNNING" : "STOPPED")}]";
            }
            catch { }
        }

        private async void MenuStartMarketing_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 2); // Marketing tab
            await DevServicesManager.StartServiceAsync("shane-mccaw-consulting");
            await RefreshTopServicesStatusAsync();
            await MarketingLogView.UpdateStatusAsync();
        }

        private async void MenuStopMarketing_Click(object sender, RoutedEventArgs e)
        {
            await DevServicesManager.StopServiceAsync("shane-mccaw-consulting");
            await RefreshTopServicesStatusAsync();
            await MarketingLogView.UpdateStatusAsync();
        }

        private void MenuOpenMarketingTab_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 2);
        }

        private void MenuBrowseMarketing_Click(object sender, RoutedEventArgs e)
        {
            OpenWebTab("http://localhost:5173", "Marketing", "🌐");
        }

        private void MenuOpenInEdgeMarketing_Click(object sender, RoutedEventArgs e)
        {
            OpenBrowserUrl("http://localhost:5173");
        }

        private async void MenuStartPortal_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 3); // Portal tab
            await DevServicesManager.StartServiceAsync("msp-portal");
            await RefreshTopServicesStatusAsync();
            await PortalLogView.UpdateStatusAsync();
        }

        private async void MenuStopPortal_Click(object sender, RoutedEventArgs e)
        {
            await DevServicesManager.StopServiceAsync("msp-portal");
            await RefreshTopServicesStatusAsync();
            await PortalLogView.UpdateStatusAsync();
        }

        private void MenuOpenPortalTab_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 3);
        }

        private void MenuBrowsePortal_Click(object sender, RoutedEventArgs e)
        {
            OpenWebTab("http://localhost:5175", "Portal", "💼");
        }

        private void MenuOpenInEdgePortal_Click(object sender, RoutedEventArgs e)
        {
            OpenBrowserUrl("http://localhost:5175");
        }

        private async void MenuStartAdmin_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 4); // Admin tab
            await DevServicesManager.StartServiceAsync("admin-panel");
            await RefreshTopServicesStatusAsync();
            await AdminLogView.UpdateStatusAsync();
        }

        private async void MenuStopAdmin_Click(object sender, RoutedEventArgs e)
        {
            await DevServicesManager.StopServiceAsync("admin-panel");
            await RefreshTopServicesStatusAsync();
            await AdminLogView.UpdateStatusAsync();
        }

        private void MenuOpenAdminTab_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 4);
        }

        private void MenuBrowseAdmin_Click(object sender, RoutedEventArgs e)
        {
            OpenWebTab("http://localhost:5174", "Admin", "⚙️");
        }

        private void MenuOpenInEdgeAdmin_Click(object sender, RoutedEventArgs e)
        {
            OpenBrowserUrl("http://localhost:5174");
        }

        private async void MenuStartApiServer_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 5); // API Server tab
            await DevServicesManager.StartServiceAsync("api-server");
            await RefreshTopServicesStatusAsync();
            await ApiServerLogView.UpdateStatusAsync();
        }

        private async void MenuStopApiServer_Click(object sender, RoutedEventArgs e)
        {
            await DevServicesManager.StopServiceAsync("api-server");
            await RefreshTopServicesStatusAsync();
            await ApiServerLogView.UpdateStatusAsync();
        }

        private void MenuOpenApiServerTab_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 5);
        }

        private void MenuBrowseApiServer_Click(object sender, RoutedEventArgs e)
        {
            OpenWebTab("http://localhost:8080", "API Server", "🖥️");
        }

        private void MenuOpenInEdgeApiServer_Click(object sender, RoutedEventArgs e)
        {
            OpenBrowserUrl("http://localhost:8080");
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
                wv.WebMessageReceived -= ChatWv_WebMessageReceived;
                wv.WebMessageReceived += ChatWv_WebMessageReceived;
                return true;
            }
            catch { return false; }
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

                if (type == "BT_EDIT_BUILD")
                {
                    string rawText = Str("rawText") ?? "";
                    int? referencedNumber = Int("referencedNumber");
                    var dialog = new EditBuildPromptDialog(rawText, referencedNumber, _buildTrackerApi, LeftSidebar.CurrentBoardIssues);
                    dialog.Owner = this;
                    if (dialog.ShowDialog() == true)
                    {
                        if (dialog.ActionChosen == EditBuildAction.SendToBuilder)
                        {
                            var q = new List<string>();
                            void Add(string key, string? val) { if (!string.IsNullOrEmpty(val)) q.Add($"{key}={Uri.EscapeDataString(val)}"); }
                            Add("q", dialog.FinalPrompt);
                            Add("title", dialog.FinalTitle);
                            Add("model", dialog.FinalModel);
                            Add("effort", dialog.FinalEffort);
                            Add("cwd", dialog.FinalCwd);
                            Add("mode", dialog.FinalMode);
                            var uri = $"mybuilder://open?{string.Join("&", q)}";
                            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri) { UseShellExecute = true });
                        }
                        else if (dialog.ActionChosen == EditBuildAction.QueueBuild)
                        {
                            if (_queueDb == null)
                            {
                                ToastEngine.Warning("Queue Build", "Not connected — no DATABASE_URL found (see Settings).");
                                return;
                            }

                            // --notGit deduplication: allocate a unique local number so no two
                            // queued builds share the same negative GithubNumber.
                            var dialogGithubNum = dialog.FinalGithubNumber;
                            var dialogBlockedByNums = dialog.FinalBlockedByNumbers;
                            if (dialogGithubNum.HasValue && dialogGithubNum.Value < 0)
                            {
                                int allocated = BuildConsole.Services.NotGitNumberRegistry.Allocate(-dialogGithubNum.Value);
                                if (allocated != -dialogGithubNum.Value)
                                    BuildConsole.Services.ActivityLog.Log("build-queue.notgit",
                                        $"BT_EDIT_BUILD: --notGit {-dialogGithubNum.Value} -> remapped to {allocated}");
                                dialogGithubNum = -allocated;
                            }
                            if (dialogBlockedByNums != null)
                            {
                                dialogBlockedByNums = dialogBlockedByNums
                                    .Select(n => n < 0 ? -BuildConsole.Services.NotGitNumberRegistry.Allocate(-n) : n)
                                    .ToList();
                            }

                            if (_updatePending)
                            {
                                bool saved = PersistQueueRequestDuringPendingUpdate(
                                    dialog.FinalTitle ?? "Untitled", dialog.FinalPrompt, dialog.FinalModel, dialog.FinalEffort, dialog.FinalCwd,
                                    dialogGithubNum, dialogBlockedByNums);
                                if (saved)
                                {
                                    ToastEngine.Success("Queued after update", "Build request saved for after restart.");
                                    try { await BuildQueuePanel.RefreshAsync(); } catch { }
                                }
                                return;
                            }
                            try
                            {
                                await _queueDb.QueueBuildAsync(
                                    dialog.FinalTitle ?? "Untitled", dialog.FinalPrompt, dialog.FinalModel, dialog.FinalEffort, dialog.FinalCwd,
                                    dialogGithubNum, dialogBlockedByNums);
                                ToastEngine.Success("Build Queued", $"Queued '{dialog.FinalTitle ?? "Build"}' successfully.");
                                try { await BuildQueuePanel.RefreshAsync(); } catch { }
                            }
                            catch (Exception ex)
                            {
                                ToastEngine.Error("Queue Build", $"Failed to queue build: {ex.Message}");
                            }
                        }
                    }
                }
                else if (type == "BT_SEND_TO_BUILDER")
                {
                    var q = new List<string>();
                    void Add(string key, string? val) { if (!string.IsNullOrEmpty(val)) q.Add($"{key}={Uri.EscapeDataString(val)}"); }
                    Add("q", Str("prompt"));
                    Add("title", Str("title"));
                    Add("model", Str("model"));
                    Add("effort", Str("effort"));
                    Add("cwd", Str("cwd"));
                    Add("mode", Str("mode"));
                    var uri = $"mybuilder://open?{string.Join("&", q)}";
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri) { UseShellExecute = true });
                }
                else if (type == "BT_QUEUE_BUILD")
                {
                    // Git #942 — the token the injected button tagged itself with
                    // so we can find that exact element again to tag it with the
                    // real queue id (or reset it if the queue call fails).
                    string? correlation = Str("correlation");
                    string? chatUrl = Str("chatUrl");
                    int? githubNum = Int("githubNumber");
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
                    List<int>? blockedByNumbers = null;
                    if (root.TryGetProperty("blockedByNumbers", out var arr) && arr.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        blockedByNumbers = arr.EnumerateArray().Select(x => x.GetInt32()).ToList();
                    }

                    // --notGit deduplication: if the incoming githubNumber is negative (a --notGit
                    // item), make sure it gets a unique slot in the local registry starting at 2000.
                    // Duplicate --notGit numbers from parallel agent sessions all claiming the same
                    // small number (e.g. --notGit 1) will each be remapped to distinct values so the
                    // Build Queue can nest them correctly (keyed by GithubNumber).
                    if (githubNum.HasValue && githubNum.Value < 0)
                    {
                        int requested = -githubNum.Value;
                        int allocated = BuildConsole.Services.NotGitNumberRegistry.Allocate(requested);
                        if (allocated != requested)
                            BuildConsole.Services.ActivityLog.Log("build-queue.notgit",
                                $"BT_QUEUE_BUILD: --notGit {requested} -> remapped to {allocated}");
                        githubNum = -allocated;
                    }
                    // Also remap negative blockedByNumbers (--block-by local references).
                    if (blockedByNumbers != null)
                    {
                        blockedByNumbers = blockedByNumbers
                            .Select(n => n < 0 ? -BuildConsole.Services.NotGitNumberRegistry.Allocate(-n) : n)
                            .ToList();
                    }

                    // A version Update is pending: the deploy is deferred until the
                    // Build Queue drains, then deploy-shanesbuild.cmd restarts this
                    // whole process. Don't add this request to the live/in-memory queue
                    // the restart would drop it from — persist it to disk instead and
                    // let the next launch re-queue it automatically (see
                    // MainWindow.PendingUpdateQueue.cs).
                    if (_updatePending)
                    {
                        bool saved = PersistQueueRequestDuringPendingUpdate(
                            Str("title") ?? "Untitled", Str("prompt") ?? "", Str("model"), Str("effort"), Str("cwd"),
                            githubNum, blockedByNumbers, chatUrl: chatUrl, originatingChatId: originatingChatId);
                        // Unstick the injected button back to its clickable label (it was
                        // set to a disabled "In Progress..." on click) — nothing is in the
                        // live queue, so leaving it stuck would misrepresent reality.
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                        if (saved)
                            ToastEngine.Success("Queued after update",
                                "A BuildConsole update is pending and will restart the app once the Build Queue clears.\n\n" +
                                "This build request has been saved and will be queued automatically right after that restart.");
                        else
                            ToastEngine.Warning("Queued after update",
                                "A BuildConsole update is pending, but saving this build request to disk failed — it was NOT queued. Try again after the update finishes.");
                        // Queued-for-Restart lag fix — repaint the "🔄 Queued for Restart"
                        // group NOW instead of waiting up to 15s for the panel's own poll.
                        // The normal (non-pending) queue path below already calls
                        // RefreshAsync after its POST; the intercept path never did, so a
                        // just-persisted item only appeared on a later poll that happened to
                        // re-render for an unrelated reason — a real contributor to the lag
                        // Shane reported. RefreshAsync now folds the spillover file into its
                        // render signature, so this forces the group to show the new item
                        // immediately. Only when it actually persisted (a failed save has
                        // nothing to show).
                        if (saved)
                        {
                            try { await BuildQueuePanel.RefreshAsync(); }
                            catch { /* best-effort visual refresh */ }
                        }
                        return;
                    }

                    BuildConsole.Services.QueueItem queued;
                    try
                    {
                        queued = await _queueDb.QueueBuildAsync(
                            Str("title") ?? "Untitled", Str("prompt") ?? "", Str("model"), Str("effort"), Str("cwd"), githubNum, blockedByNumbers, chatUrl: chatUrl, originatingChatId: originatingChatId);
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Queue Build", $"Couldn't queue build: {ex.Message}");
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                        return;
                    }

                    {
                        // Git #942 — tag the exact button with the real queue id and
                        // start tracking so the existing chat-tab queue poll
                        // (PollChatTabBuildStateAsync) pushes live status onto it.
                        int qid = queued.Id;
                        string title = Str("title") ?? "Untitled";
                        _chatButtonStatus[qid] = "In Progress...";
                        BuildConsole.Services.ActivityLog.Log("chat-button.status",
                            $"queue #{qid} ({title}): queued -> In Progress... (now tracking)");
                        if (!string.IsNullOrWhiteSpace(chatUrl))
                        {
                            BuildConsole.Services.ChatUrlStore.SetChatUrl(qid, githubNum, chatUrl);
                        }
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btTagQueued && window.__btTagQueued({JsLiteral(correlation)}, {qid});");
                        await BuildQueuePanel.RefreshAsync();
                    }
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
        public async System.Threading.Tasks.Task<List<BuildConsole.Services.ManifestRunResult>> RunScopedManifestsAsync(int? issueNumber)
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
                        results.Add(await RunManifestAsync(manifest, isRegression: true));
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
            BuildConsole.Services.TargetEnvironment targetEnv = BuildConsole.Services.TargetEnvironment.Dev)
        {
            string mode = isRegression ? "regression" : "single";

            if (targetEnv == BuildConsole.Services.TargetEnvironment.Staging && _replitWatcher != null &&
                (_replitWatcher.CurrentStatus.State == BuildConsole.Services.ReplitWatcherState.GracePeriod ||
                 _replitWatcher.CurrentStatus.State == BuildConsole.Services.ReplitWatcherState.Waking ||
                 _replitWatcher.CurrentStatus.State == BuildConsole.Services.ReplitWatcherState.Error))
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    "Replit is currently down — attempting automatic wake before running manifest...");
                BuildConsole.ToastEngine.Show(
                    "Waking Replit",
                    "Replit is down. Automatically waking your Replit dev server now...",
                    BuildConsole.ToastKind.Info,
                    TimeSpan.FromSeconds(5)
                );

                bool woke = await _replitWatcher.TriggerWakeAsync();
                if (!woke)
                {
                    BuildConsole.ToastEngine.Show(
                        "Replit Not Responding",
                        "Could not wake Replit automatically. Click here to open the workspace.",
                        BuildConsole.ToastKind.Warning,
                        TimeSpan.FromSeconds(15),
                        () => OpenWebTab(BuildConsole.Services.BuildConsoleSettings.Load().ReplitWorkspaceUrl, "Replit Workspace", "")
                    );

                    return new BuildConsole.Services.ManifestRunResult
                    {
                        Issue = manifest.Issue,
                        Feature = manifest.Feature,
                        Mode = mode,
                        StartedAt = DateTime.Now,
                    };
                }
            }

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
            runner.BeginRun(manifest.Issue, manifest.Feature, mode, targetEnv);

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

            string targetBaseUrl = string.IsNullOrWhiteSpace(manifest.BaseUrl) ? config.ApiBaseUrl : manifest.BaseUrl;
            targetBaseUrl = vars.Resolve(BuildConsole.Services.HttpTestExecutor.ResolvePlaceholders(targetBaseUrl, config));
            await EnsureServerReadyWithProbeAsync(targetBaseUrl, "testing.manifest-runner", maxWaitSeconds: 90);

            var apiResults = await BuildConsole.Services.HttpTestExecutor.RunAsync(manifest, config, vars);
            runResult.AddRange(apiResults);

            if (apiResults.Count > 0)
            {
                int passed = apiResults.Count(r => r.Passed);
                BuildConsole.Services.ActivityLog.Log("testing.api-executor",
                    $"apiTests: {passed}/{apiResults.Count} passed for issue #{manifest.Issue}.");
            }

            var graphResults = await BuildConsole.Services.GraphTestExecutor.RunAsync(manifest, vars);
            runResult.AddRange(graphResults);

            if (graphResults.Count > 0)
            {
                int passed = graphResults.Count(r => r.Passed);
                BuildConsole.Services.ActivityLog.Log("testing.graph-executor",
                    $"graphTests: {passed}/{graphResults.Count} passed for issue #{manifest.Issue}.");
            }

            // Git #879 — postGraphApiTests: apiTest-shaped calls that must run AFTER graphTests
            // (e.g. #437's verify-code call needing the 6-digit code #878's mail-poll `extract`
            // only captures during the graphTests phase above). Same shared vars store, same
            // HttpTestExecutor evaluator apiTests use.
            var postGraphApiResults = await BuildConsole.Services.HttpTestExecutor.RunPostGraphAsync(manifest, config, vars);
            runResult.AddRange(postGraphApiResults);

            if (postGraphApiResults.Count > 0)
            {
                int passed = postGraphApiResults.Count(r => r.Passed);
                BuildConsole.Services.ActivityLog.Log("testing.api-executor",
                    $"postGraphApiTests: {passed}/{postGraphApiResults.Count} passed for issue #{manifest.Issue}.");
            }

            // Git #881 — zohoTests run after graphTests, before uiSteps, matching the step-list
            // order TestRunnerWindow.SetSteps renders. Same shared ManifestRunResult, same live
            // StepCompleted card stream, authenticated with the #880 Zoho API Token internally.
            var zohoResults = await BuildConsole.Services.ZohoTestExecutor.RunAsync(manifest, config);
            runResult.AddRange(zohoResults);

            if (zohoResults.Count > 0)
            {
                int passed = zohoResults.Count(r => r.Passed);
                BuildConsole.Services.ActivityLog.Log("testing.zoho",
                    $"zohoTests: {passed}/{zohoResults.Count} passed for issue #{manifest.Issue}.");
            }

            // Git #810 — uiSteps run directly through TestRunnerWindow.RunUiTestAsync (the
            // same UiTestExecutor #809 built), driving its own WebView2 instead of opening
            // the standalone AutomationRunnerWindow popup — retired entirely, per #810's own
            // instruction. Telemetry cards stream live via UiTestExecutor.Telemetry, subscribed
            // for the duration of this call inside RunUiTestAsync itself.
            // Epic #803 — this run's captured WebView2 screenshots (#966), surfaced to the screenshot
            // baseline review after the whole run completes. Declared out here so it outlives the
            // uiSteps block scope below; empty when no uiStep ran or nothing was captured.
            var capturedShots = new List<BuildConsole.Services.UiScreenshotCapture>();

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
                    // Git #1016 — carry the uiStep's textContains through so the `expect` action can assert
                    // the element's real rendered text, not just its presence/visibility.
                    TextContains = step.TextContainsJson,
                    // Git #1025 — carry the uiStep's textPrefixOfAny through so the `expect` action can prefix-
                    // match the rendered text against a whole runtime set (randomized/progressively-typed content).
                    TextPrefixOfAny = step.TextPrefixOfAnyJson,
                    Viewport = step.ViewportJson,
                    MaxDurationMs = step.MaxDurationMs,
                    // Per-step override for the `expect` DOM poll window; null falls back to ExpectPollTimeoutMs.
                    TimeoutMs = step.TimeoutMs,
                    // Git #966 — carry the uiStep's `"screenshot": true` opt-in so UiTestExecutor captures a
                    // WebView2 screenshot after this step, not only on failure.
                    Screenshot = step.Screenshot,
                    // Carry the uiStep's `"critical": true` opt-in so UiTestExecutor halts the whole run the
                    // moment this step fails (instead of cascading through every downstream step) — e.g. a
                    // failed login makes all subsequent steps meaningless by definition.
                    Critical = step.Critical,
                }).ToList();

                // Git #877 — the same per-run variable store the api/graph executors used, so a
                // {{name}} extracted earlier resolves in a uiStep's selector/value, and a uiStep's
                // own extract feeds any later step.
                // Git #958 — manifest.BaseUrl (e.g. "{{DEPLOY_URL}}") must be resolved through the
                // same config placeholder substitution HttpTestExecutor already applies to apiTests;
                // previously this handed UiTestExecutor the raw unresolved literal, which
                // CoreWebView2.Navigate() throws on, failing every uiSteps manifest's very first step.
                string uiTargetUrl = BuildConsole.Services.HttpTestExecutor.ResolvePlaceholders(manifest.BaseUrl, config);
                // Git #970 — manifest-level default viewport applied to every uiStep that doesn't
                // declare its own override (see AutomationAction.Viewport / ViewportSpec.Parse).
                var uiDefaultViewport = BuildConsole.Services.ViewportSpec.Parse(manifest.ViewportJson);

                // Git #966 — screenshots for this run land under test-results/{issue}-{timestamp}/screenshots/,
                // a folder named for the same run stem WriteToFile uses for the results JSON. Null repoRoot ⇒
                // capture disabled (nowhere stable to write), same guard WriteToFile already uses.
                string? uiRepoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                string? screenshotDir = uiRepoRoot != null
                    ? System.IO.Path.Combine(uiRepoRoot, "test-results", runResult.RunFolderName, "screenshots")
                    : null;

                var uiResult = await runner.RunUiTestAsync(uiTargetUrl, uiActions, vars, uiDefaultViewport, screenshotDir);
                // Epic #803 — hand this run's captured screenshots (absolute paths, unchanged by the
                // repo-relative rewrite below) to the post-run baseline review.
                capturedShots = uiResult.Screenshots;
                var uiStepResults = uiResult.ToTestStepResults();

                // Git #966 — the executor set each step's ScreenshotPath to an absolute path; rewrite it
                // repo-relative (forward slashes) so the committed-shape results JSON stays portable and a
                // reader resolves it against the repo root.
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

            // Git #900 — powerShellVerify runs LAST, after every HTTP/Graph/Zoho/UI step has
            // populated the shared #877 variable store, so any value those steps captured is
            // available to diff against. Each step shells out to pwsh 7 signed in as Shane himself
            // (delegated, NOT app-only), reads the Get-* ground truth, and compares it to the
            // app-reported value. Same shared ManifestRunResult, same live StepCompleted card
            // stream, same test-results/ file — no separate output path. Because the #898 remote
            // trigger runs this exact RunManifestAsync, a Claude-Code-triggered run includes and
            // reports powerShellVerify with no special casing.
            // Interactive device-code bridge. On a Play Test / manual run (NOT the #967 scheduled sweep
            // or the #898 headless remote trigger — same interactive test as the screenshot review below:
            // !isRegression && !_testTriggerBusy), a Connect-MgGraph device-code prompt is surfaced in a
            // non-blocking floaty (real code + clickable devicelogin link) and the pwsh process is given
            // real time to complete sign-in, then continues to the verification cmdlet automatically — no
            // manual re-run. Headless runs pass null and keep today's fast-abort behaviour unchanged.
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
                    BuildConsole.Services.ActivityLog.Log(channel, $"[Readiness Probe] Attempt #{attempt} returned HTTP {(int)resp.StatusCode} (waiting for Replit compile / restart)…");
                }
                catch (Exception ex)
                {
                    BuildConsole.Services.ActivityLog.Log(channel, $"[Readiness Probe] Attempt #{attempt}: {ex.Message} (waiting for Replit startup / Wi-Fi connection)…");
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
            try { req = await _buildTrackerApi.GetNextTestRunAsync(); }
            catch (Exception ex)
            {
                // Transient poll failure (server down mid-session, etc.) — note it once
                // and let the next tick retry; never spam or throw out of a timer tick.
                BuildConsole.Services.ActivityLog.Log("testing.remote-trigger", $"Poll failed: {ex.Message}");
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
                        $"Unsupported action '{req.Action}' — only executeSql / runTest / uiTest / runPowerShell / runScan / executeScan / reportProgress are handled. Ignoring.");
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
