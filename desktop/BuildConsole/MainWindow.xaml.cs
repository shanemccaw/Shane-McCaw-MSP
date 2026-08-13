using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

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
        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        // ── Git #894: WindowStyle="None" + WindowChrome maximize-covers-taskbar fix ──
        // A well-known WPF gotcha (not specific to this app): a chromeless
        // window's WindowState.Maximized ignores the taskbar and covers the
        // whole monitor, including other apps' taskbars on multi-monitor
        // setups, unless WM_GETMINMAXINFO is intercepted and clamped to the
        // real work area. Native chrome (WindowStyle=SingleBorderWindow, the
        // default before this issue) never had this problem - the OS handled
        // it. Registered from OnSourceInitialized, right next to the
        // existing dark-title-bar DWM call.
        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MINMAXINFO
        {
            public POINT ptReserved;
            public POINT ptMaxSize;
            public POINT ptMaxPosition;
            public POINT ptMinTrackSize;
            public POINT ptMaxTrackSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public int dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr handle, int flags);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        private const int MONITOR_DEFAULTTONEAREST = 0x00000002;
        private const int WM_GETMINMAXINFO = 0x0024;

        private static void ClampMaximizedBoundsToWorkArea(IntPtr hwnd, IntPtr lParam)
        {
            var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);

            IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var monitorInfo = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
                GetMonitorInfo(monitor, ref monitorInfo);
                RECT workArea = monitorInfo.rcWork;
                RECT monitorArea = monitorInfo.rcMonitor;

                mmi.ptMaxPosition.X = Math.Abs(workArea.Left - monitorArea.Left);
                mmi.ptMaxPosition.Y = Math.Abs(workArea.Top - monitorArea.Top);
                mmi.ptMaxSize.X = Math.Abs(workArea.Right - workArea.Left);
                mmi.ptMaxSize.Y = Math.Abs(workArea.Bottom - workArea.Top);
            }

            Marshal.StructureToPtr(mmi, lParam, true);
        }

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
        private BuildConsole.Services.QueueWatcherService? _queueWatcher;

        // ── Git #902: Replit idle watcher (background WebView2 + status indicator) ──
        private BuildConsole.Services.ReplitWatcherService? _replitWatcher;

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
        }
        private readonly Dictionary<TabItem, ChatTabState> _chatTabs = new();
        /// <summary>Git #942 — queue item id -> last label pushed to that item's injected chat button ("In Progress..."/"Done"/"Failed: Retry"). Populated when BT_QUEUE_BUILD captures a real id; drained by PushChatButtonStatuses the moment an item hits a terminal state (done/failed/canceled) or leaves the queue, so nothing is polled forever. UI-thread only (event handler + DispatcherTimer), so no locking needed.</summary>
        private readonly Dictionary<int, string> _chatButtonStatus = new();
        private DispatcherTimer? _buildTailTimer;

        // ── Git #937: always-on-top Sticky Notes floaty ─────────────────────────
        private StickyNotesWindow? _stickyNotes;
        // The editor pane (of the four from #893) the user last interacted with —
        // Send targets whatever Claude chat is active THERE. Updated both on tab
        // selection and on keyboard focus entering a pane (clicking into a
        // WebView2 to type doesn't change WPF selection, but it does move focus).
        private TabControl? _activeEditorPane;

        // ── Git #805: deploy-status poll (Epic #803 Phase 1) ─────────────────────
        private DispatcherTimer? _deployStatusTimer;
        private string? _lastSeenDeployCommitHash;

        // ── Git #806: test manifest runner (Epic #803 Phase 2) ───────────────────
        private BuildConsole.Services.TestManifest? _loadedManifest;

        // ── Git #898: remote UI-test trigger poll (Epic #803) ────────────────────
        // Claude Code (headless, no GUI) POSTs a run request to the api-server; THIS
        // already-running app is the only thing with a real Windows GUI session that
        // can drive a manifest's WebView2 uiSteps. Same DispatcherTimer poll shape as
        // the build queue watcher (#817) and the deploy-status poll (#805).
        private DispatcherTimer? _testTriggerTimer;
        private bool _testTriggerBusy;

        // ── Git #857: dedicated Test Runner window, replacing the retired bottom
        // "Test Results" tab entirely — reused across runs for the app's lifetime
        // (a new one is only created if none exists yet or Shane closed the last one).
        private TestRunnerWindow? _testRunnerWindow;

        private TestRunnerWindow EnsureTestRunnerWindow()
        {
            if (_testRunnerWindow == null)
            {
                _testRunnerWindow = new TestRunnerWindow();
                _testRunnerWindow.Closed += (_, _) => _testRunnerWindow = null;
                _testRunnerWindow.Show();
            }
            _testRunnerWindow.Activate();
            return _testRunnerWindow;
        }

        // Git #968 (Epic #803): same reused-across-the-app's-lifetime pattern as
        // EnsureTestRunnerWindow — a new one is only created if none exists yet or Shane
        // closed the last one.
        private TestHistoryWindow? _testHistoryWindow;

        private TestHistoryWindow EnsureTestHistoryWindow()
        {
            if (_testHistoryWindow == null)
            {
                _testHistoryWindow = new TestHistoryWindow();
                _testHistoryWindow.Closed += (_, _) => _testHistoryWindow = null;
                _testHistoryWindow.Show();
            }
            _testHistoryWindow.Activate();
            _testHistoryWindow.Refresh();
            return _testHistoryWindow;
        }

        private void OpenTestHistory_Click(object sender, RoutedEventArgs e)
        {
            EnsureTestHistoryWindow();
        }

        public MainWindow()
        {
            InitializeComponent();

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
                _queueWatcher = new BuildConsole.Services.QueueWatcherService(
                    _buildTrackerApi, btConfig.MaxConcurrent, BuildConsole.Services.BuildTrackerConfig.FindRepoRoot());
                _queueWatcher.Start();

                // Git #898 — same "app is already open for the build queue" assumption:
                // start listening for remote UI-test run requests too.
                StartTestTriggerPoll();
            }

            BuildQueuePanel.Initialize(_buildTrackerApi, _queueWatcher);
            LeftSidebar.Initialize(_buildTrackerApi);
            SqlRunnerView.Initialize(_buildTrackerApi);
            WireSqlRunnerSendToChat(SqlRunnerView); // Git #940
            BuildLogView.Initialize(_buildTrackerApi);

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
            // Git #954 — the Replit watcher's "re-apply on save" hook moved onto the
            // Settings tab (SettingsTabView.ReplitWatcherSettingsChanged), wired per
            // tab instance in OpenSettingsTab; the sidebar no longer owns it.
            _replitWatcher.ApplyConfig();

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
            BuildQueuePanel.IssueChatRequested += (s, githubNumber) =>
            {
                var chat = LeftSidebar.FindChatForIssue(githubNumber);
                if (chat == null)
                {
                    MessageBox.Show($"No chat linked to #{githubNumber} yet.", "Open Chat");
                    return;
                }
                OpenChatTab(chat, githubNumber);
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
                OpenWebTab(e.Url, e.Title, "", injectPrefillPoll: e.InjectPrefill);

            // Git #840 (Git Board Phase 2) — Shane: "I need to be able to...
            // read their descriptions, comments, etc..." Clicking an issue in
            // the Git Board tree opens the bottom panel's Issue Detail tab
            // (index 4 — Build Log, Terminal, SQL Runner, Output, Issue
            // Detail; the "Test Results" tab that used to sit at index 4 was
            // retired by Git #857's dedicated TestRunnerWindow) and loads its
            // real body/comment thread.
            LeftSidebar.IssueSelected += (s, issue) =>
            {
                SetBottomPanel(true, 4);
                IssueDetailView.LoadIssue(issue.IssueNumber);
            };

            // Git #921 (Epic #803) — Shane: "When I click a milestone, it should
            // open a new Tab and show me all the Epics, Issues, and Shane To-Do
            // in an ADHD friendly way... When I click on an epic... same thing...
            // Clicking on an issue - same thing... but with Epic linked."
            // Additive to the #840 side panel above (which still fires): these
            // open (or focus) the native GitDetailView tab, reusing the same
            // #893/#894 multi-pane editor tab infra every other tab uses.
            LeftSidebar.MilestoneTabRequested += (s, m) => OpenMilestoneDetailTab(m);
            LeftSidebar.GitDetailTabRequested += (s, issue) => OpenGitIssueDetailTab(issue);

            // Git #954 (Epic #803) — the sidebar's Settings view is a category nav
            // list now; a click opens (or focuses) the native Settings tab scrolled
            // to that section (same opens-or-focuses infra as the #921 detail tabs).
            LeftSidebar.SettingsCategoryRequested += (s, category) => OpenSettingsTab(category);
            _buildTailTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _buildTailTimer.Tick += async (_, _) => await PollChatTabBuildStateAsync();
            _buildTailTimer.Start();

            // Git #805 — Epic #803 Phase 1: "polling, not webhook/SSE... follow
            // the existing pattern." Same 3s DispatcherTimer shape as
            // _buildTailTimer above, hitting the new GET /api/internal/deploy-status
            // endpoint. A changed commitHash from the last-seen value IS the
            // "deploy complete" signal - no separate push mechanism needed.
            _deployStatusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _deployStatusTimer.Tick += async (_, _) => await PollDeployStatusAsync();
            _deployStatusTimer.Start();

            // Shane To-Do "Load SQL" -> real GitHub file content into the SQL Runner tab (index 2 in BottomTabs — Build Log, Terminal, SQL Runner, Output).
            LeftSidebar.SqlLoadRequested += (s, path) =>
            {
                SetBottomPanel(true, 2);
                SqlRunnerView.LoadFromGitHub(path);
            };

            // Git #806 (Epic #803 Phase 2) — tracks the manifest last loaded via the
            // Automation sidebar's Load Manifest button for Menu > Run > "Run Tests (Current Issue)".
            LeftSidebar.ManifestLoaded += (s, manifest) => _loadedManifest = manifest;

            // Git #827 — LeftSidebar's Automation sidebar raises these three events, and
            // MainWindow already had correct handlers for all of them, but none were ever
            // subscribed: the Play button (and Start/Stop Recording) did nothing.
            LeftSidebar.PlayTestRequested += LeftSidebar_PlayTestRequested;
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

            // Editor Tab "Pinned" state (Epic #803) — first real use: seed a pinned
            // LinkedIn entry whose WebView2 session stays alive in the background and
            // is one click away in the strip. Deferred to Loaded priority so the
            // PinnedHostCanvas has real layout extents before its content mounts.
            Dispatcher.BeginInvoke(new Action(SeedPinnedLinkedIn), System.Windows.Threading.DispatcherPriority.Loaded);
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            var hwnd = new WindowInteropHelper(this).Handle;
            try
            {
                int darkMode = 1;
                DwmSetWindowAttribute(hwnd, 20, ref darkMode, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE
                DwmSetWindowAttribute(hwnd, 19, ref darkMode, sizeof(int)); // Fallback for older Win10 builds
            }
            catch { }

            // Git #894 — see ClampMaximizedBoundsToWorkArea's own doc comment.
            HwndSource.FromHwnd(hwnd)?.AddHook((IntPtr wnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) =>
            {
                if (msg == WM_GETMINMAXINFO)
                {
                    ClampMaximizedBoundsToWorkArea(wnd, lParam);
                    handled = true;
                }
                return IntPtr.Zero;
            });
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
                    CommandPaletteOverlay.Visibility = Visibility.Collapsed;
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

            TabSwitcherOverlay.Visibility = Visibility.Visible;
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

            TabSwitcherOverlay.Visibility = Visibility.Collapsed;

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
                var u when u.Contains("/admin-panel/") => "\uE7EF",
                var u when u.Contains("/portal/")      => "\uE77B",
                var u when u.Contains("claude.ai")     => "\uE8BD",
                _                                      => "\uE774"
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
        /// Git #940 — routes a SqlRunnerView's "Send to Chat" through the same
        /// shared active-chat injection path (#937). Applied to both the docked
        /// SQL Runner and each .sql file tab; reports the outcome back inline on
        /// the view's own status strip.
        /// </summary>
        private void WireSqlRunnerSendToChat(Controls.SqlRunnerView view)
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
                var u when u.Contains("/admin-panel/")   => ("Admin Center", "\uE7EF"),
                var u when u.Contains("/portal/")        => ("Customer Portal", "\uE77B"),
                var u when u.Contains("replit.com")      => ("Replit Workspace", "\uE7B8"),
                _                                        => ("Marketing Site", "\uE774")
            };
            // Git #821 \u2014 Shane: "I want a play/pause button and when play
            // is on... this page stays alive refreshing every 5 or 10
            // minutes." Replit puts a workspace to sleep after a period of
            // inactivity; a periodic reload keeps it awake. Only the Replit
            // tab gets the toggle - it's the one use case asked for.
            OpenWebTab(url, title, glyph, offerKeepAlive: url.Contains("replit.com"));
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
                    BuildQueuePanel.SetActiveChatEpic(
                        chat.EpicId,
                        chat.EpicId.HasValue ? LeftSidebar.GetEpicGithubNumber(chat.EpicId.Value) : null,
                        chat.EpicId.HasValue ? LeftSidebar.GetEpicTitle(chat.EpicId.Value) : null);
                }
                else
                {
                    BuildQueuePanel.SetActiveChatEpic(null, null, null);
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
        // AutomationRunnerWindow popup; it drives the same UiTestExecutor directly through a
        // shared WebView2 instead, so both manual and manifest-driven UI runs share one
        // telemetry stream and the popup is retired entirely. Git #857 moved that shared
        // WebView2 from the (now also retired) Test Results tab into the dedicated
        // TestRunnerWindow.
        private void LeftSidebar_PlayTestRequested(object? sender, (string url, List<Controls.AutomationAction> steps) e)
        {
            var runner = EnsureTestRunnerWindow();
            runner.Clear();
            runner.SetStepsFromActions(e.steps);
            runner.BeginRun(0, "Manual Play Test", "manual");
            _ = runner.RunUiTestAsync(e.url, e.steps);
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

        public void OpenWebTab(string url, string title, string glyph, bool offerKeepAlive = false, bool injectPrefillPoll = false)
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

            // WebView2 content
            var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
            wv.NavigationStarting  += WebView_NavigationStarting;
            wv.NavigationCompleted += WebView_NavigationCompleted;
            wv.SourceChanged       += WebView_SourceChanged;

            // Git #922 (Epic #803) — this tab is BuildConsole's own WebView2, not
            // real Chrome with the build-tracker extension, so the extension's
            // tryInsertPrefillFromUrl() never runs here. Replicate it: after each
            // navigation completes, inject the same composer-poll + insert logic
            // (EpicChatPrefillPollScript) via ExecuteScriptAsync — the exact
            // pattern UiTestExecutor.cs already uses to drive elements. The script
            // is idempotent (it strips the bt_prefill param once inserted), so
            // re-firing on a later navigation harmlessly no-ops.
            if (injectPrefillPoll)
            {
                wv.NavigationCompleted += async (s, e) =>
                {
                    if (!e.IsSuccess) return;
                    try { await wv.ExecuteScriptAsync(EpicChatPrefillPollScript); }
                    catch { /* best-effort — a fresh SPA tab may have no composer yet; the injected script itself polls up to ~15s */ }
                };
            }

            // Git #852 — Shane: "Whenever I click on a tab that is
            // inactive, as soon as it becomes active again it refreshes the
            // page I'm on." WPF's TabControl detaches an inactive tab's
            // Content from the visual tree and reattaches it on
            // reactivation, so Loaded fires again EVERY time a tab becomes
            // active, not just once at creation - this used to
            // unconditionally re-Navigate every time, discarding whatever
            // Shane had navigated to within the page. `navigated` makes the
            // real navigation happen exactly once.
            bool navigated = false;
            wv.Loaded += async (s, e) =>
            {
                bool ready = await EnsureWebViewInitializedAsync(wv);
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

            var webContainer = new Grid();
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
                EditorTabs.Items.Remove(newTab);
                if (EditorTabs.Items.Count > 0)
                    EditorTabs.SelectedIndex = Math.Max(0, EditorTabs.Items.Count - 1);
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        // ── Git #802: chat tabs (own WebView2 per chat) + build split pane ──────
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
                Text = chat.Title, FontSize = 13, Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)FindResource("TextBrush")
            });
            var closeBtn = new Button
            {
                Content = "✕", Style = (Style)FindResource("IconButton"), FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1), Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab", VerticalAlignment = VerticalAlignment.Center
            };
            headerPanel.Children.Add(closeBtn);

            var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
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

            closeBtn.Click += (s, e) =>
            {
                _chatTabs.Remove(newTab);
                EditorTabs.Items.Remove(newTab);
                if (EditorTabs.Items.Count > 0)
                    EditorTabs.SelectedIndex = Math.Max(0, EditorTabs.Items.Count - 1);
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);
            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
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

                string label, mode;
                bool terminal;
                switch (item.Status)
                {
                    case "done":     label = "Done";           mode = "done";     terminal = true;  break;
                    case "failed":
                    case "canceled": label = "Failed: Retry";  mode = "failed";   terminal = true;  break;
                    case "queued":
                    case "running":
                    default:         label = "In Progress..."; mode = "progress"; terminal = false; break;
                }

                if (_chatButtonStatus[id] != label)
                {
                    BuildConsole.Services.ActivityLog.Log("chat-button.status",
                        $"queue #{id} ({item.Title}): {_chatButtonStatus[id]} -> {label} (status={item.Status})");
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

        /// <summary>Git #805 — same visible-indicator pattern as Git #815's ReportSyncStatus: a failed poll turns the status-bar dot red with the error inline, PLUS the full text goes to the Output log, instead of failing silently.</summary>
        private void ReportDeployStatus(string error)
        {
            DeployDot.Fill = DotError;
            DeployStatusText.Text = $"Deploy sync error: {error}";
            BuildConsole.Services.ActivityLog.Log("deploy", $"FAILED: {error}");
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
            ReplitStatusText.ToolTip = tip.ToString();
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
                    owner.Items.Remove(t);
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
                        owner.Items.Remove(t);
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
                    owner.Items.Remove(t);
                }
            };
            cm.Items.Add(miCloseSaved);

            // 5. Close All
            var miCloseAll = new MenuItem { Header = "Close All" };
            miCloseAll.Click += (s, e) =>
            {
                CurrentOwner().Items.Clear();
            };
            cm.Items.Add(miCloseAll);

            cm.Items.Add(new Separator());

            // 5b. Pin Tab — collapse this tab to the always-visible pinned strip,
            // keeping its WebView2 session alive off-screen (see MainWindow.PinnedTabs.cs).
            var miPin = new MenuItem { Header = "Pin Tab" };
            miPin.Click += (s, e) => PinTabFromMenu(tabItem);
            cm.Items.Add(miPin);

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

            tabItem.ContextMenu = cm;
            if (tabItem.Header is FrameworkElement feHeader)
            {
                feHeader.ContextMenu = cm;
            }
        }

        private void CloseTab(TabItem tabItem, TabControl ownerTabControl)
        {
            ownerTabControl.Items.Remove(tabItem);
            if (ownerTabControl.Items.Count > 0)
            {
                ownerTabControl.SelectedIndex = Math.Max(0, ownerTabControl.Items.Count - 1);
            }
        }

        private void LeftSidebar_FileSelected(object? sender, string filePath)
        {
            OpenFileTab(filePath);
        }

        public void OpenFileTab(string filePath)
        {
            if (!File.Exists(filePath)) return;

            string fileName = Path.GetFileName(filePath);
            string ext = Path.GetExtension(filePath).ToLowerInvariant();

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

            if (ext == ".sql")
            {
                // SQL Viewer tab
                var sqlViewer = new Controls.SqlRunnerView();
                WireSqlRunnerSendToChat(sqlViewer); // Git #940
                try
                {
                    string sqlText = File.ReadAllText(filePath);
                    sqlViewer.SetSqlQuery(sqlText);
                }
                catch { }

                tabContent = sqlViewer;
            }
            else
            {
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
            }

            var newTab = new TabItem
            {
                Tag = filePath,
                Header = headerPanel,
                Content = tabContent
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) =>
            {
                EditorTabs.Items.Remove(newTab);
                if (EditorTabs.Items.Count > 0)
                    EditorTabs.SelectedIndex = Math.Max(0, EditorTabs.Items.Count - 1);
            };

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
                BottomTabs.Visibility     = Visibility.Visible;
                if (tabIndex >= 0 && tabIndex < BottomTabs.Items.Count)
                    BottomTabs.SelectedIndex = tabIndex;
            }
            else
            {
                RowBottom.Height          = new GridLength(0);
                BottomSplitter.Visibility = Visibility.Collapsed;
                BottomTabs.Visibility     = Visibility.Collapsed;
            }
        }

        // ── Git #815: live Output log + sync status indicator ──────────────────
        private const int MaxOutputLogChars = 200_000;

        private void AppendOutputLog(string line)
        {
            if (OutputLogBox.Text == "[Output] Waiting for activity…") OutputLogBox.Clear();
            OutputLogBox.AppendText(line + Environment.NewLine);
            if (OutputLogBox.Text.Length > MaxOutputLogChars)
            {
                OutputLogBox.Text = OutputLogBox.Text.Substring(OutputLogBox.Text.Length - MaxOutputLogChars);
            }
            OutputLogBox.ScrollToEnd();
        }

        /// <summary>null = last poll succeeded (green "live"); a message = last poll failed (red, message shown + full text in the Output log).</summary>
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
            => SetBottomPanel(true, tabIndex: 2);

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
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, userDataDir);
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

        private static async System.Threading.Tasks.Task<bool> EnsureWebViewInitializedAsync(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            try
            {
                if (wv.CoreWebView2 != null) return true;

                var env = await GetSharedWebView2EnvironmentAsync();
                await wv.EnsureCoreWebView2Async(env);
                if (wv.CoreWebView2 != null)
                {
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

                if (type == "BT_SEND_TO_BUILDER")
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
                    if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
                    {
                        MessageBox.Show("Not connected — see Settings.", "Queue Build");
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                        return;
                    }
                    List<int>? blockedByNumbers = null;
                    if (root.TryGetProperty("blockedByNumbers", out var arr) && arr.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        blockedByNumbers = arr.EnumerateArray().Select(x => x.GetInt32()).ToList();
                    }
                    var res = await _buildTrackerApi.QueueBuildAsync(
                        Str("title") ?? "Untitled", Str("prompt") ?? "", Str("model"), Str("effort"), Str("cwd"), Int("githubNumber"), blockedByNumbers);
                    if (!res.IsSuccessStatusCode)
                    {
                        var body = await res.Content.ReadAsStringAsync();
                        MessageBox.Show($"Couldn't queue build: {body}", "Queue Build");
                        if (correlation != null)
                            await RunScriptInAllChatWebViewsAsync($"window.__btQueueFailed && window.__btQueueFailed({JsLiteral(correlation)});");
                    }
                    else
                    {
                        // Git #942 — the 201 body IS the queue row; capture its
                        // real id, tag the exact button with it, and start
                        // tracking so the existing chat-tab queue poll
                        // (PollChatTabBuildStateAsync) pushes live status onto it.
                        int? queueId = null;
                        try
                        {
                            var bodyJson = await res.Content.ReadAsStringAsync();
                            using var rdoc = System.Text.Json.JsonDocument.Parse(bodyJson);
                            if (rdoc.RootElement.TryGetProperty("id", out var idEl) && idEl.ValueKind == System.Text.Json.JsonValueKind.Number)
                                queueId = idEl.GetInt32();
                        }
                        catch { }

                        if (queueId is int qid && qid > 0)
                        {
                            string title = Str("title") ?? "Untitled";
                            _chatButtonStatus[qid] = "In Progress...";
                            BuildConsole.Services.ActivityLog.Log("chat-button.status",
                                $"queue #{qid} ({title}): queued -> In Progress... (now tracking)");
                            if (correlation != null)
                                await RunScriptInAllChatWebViewsAsync($"window.__btTagQueued && window.__btTagQueued({JsLiteral(correlation)}, {qid});");
                        }
                        await BuildQueuePanel.RefreshAsync();
                    }
                }
                else if (type == "BT_LOAD_SQL")
                {
                    SetBottomPanel(true, tabIndex: 2);
                    SqlRunnerView.SetSqlQuery(Str("sql") ?? "");
                }
            }
            catch { }
        }

        // ── Menu: Help ────────────────────────────────────────────────────────
        private void OpenDevTools_Click(object sender, RoutedEventArgs e)
            => GetActiveWebView().CoreWebView2?.OpenDevToolsWindow();

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

            BtnBuildRelease.IsEnabled = false;
            BtnBuildReleaseIcon.Text = "\uE72C"; // hourglass while running
            BuildConsole.Services.ActivityLog.Log("release-build", $"Starting: dotnet build --configuration Release ({projectDir})");
            SetBottomPanel(true, tabIndex: 3); // Output tab

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
                    BtnBuildReleaseIcon.Text = "\uE768"; // back to play glyph
                    BtnBuildReleaseIcon.Foreground = ok ? DotReady : DotError;
                    BtnBuildRelease.IsEnabled = true;
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
                BtnBuildReleaseIcon.Text = "\uE768";
                BtnBuildRelease.IsEnabled = true;
            }
        }

        // ── Command Palette (Ctrl+K) logic ──────────────────────────────────
        private readonly List<PaletteItem> _allPaletteItems = new();

        private void ToggleCommandPalette()
        {
            if (CommandPaletteOverlay.Visibility == Visibility.Visible)
            {
                HideCommandPalette();
            }
            else
            {
                ShowCommandPalette();
            }
        }

        private void ShowCommandPalette()
        {
            BuildPaletteItems();

            // Hide active WebView2 HWND to fix WPF Airspace overlap
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Hidden;

            CommandPaletteOverlay.Visibility = Visibility.Visible;
            PaletteSearchBox.Text = string.Empty;
            PerformPaletteSearch();

            Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
            {
                PaletteSearchBox.Focus();
                Keyboard.Focus(PaletteSearchBox);
            }));
        }

        private void HideCommandPalette()
        {
            CommandPaletteOverlay.Visibility = Visibility.Collapsed;

            // Restore active WebView2 HWND visibility
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Visible;
        }

        private void CommandPaletteOverlay_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.OriginalSource == CommandPaletteOverlay)
            {
                HideCommandPalette();
            }
        }

        private void BuildPaletteItems()
        {
            _allPaletteItems.Clear();

            // 1. Files - Safe non-blocking file search
            try
            {
                string repoDir = @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP";
                if (Directory.Exists(repoDir))
                {
                    var opt = new EnumerationOptions
                    {
                        IgnoreInaccessible = true,
                        RecurseSubdirectories = true,
                        MaxRecursionDepth = 6
                    };

                    foreach (var f in Directory.EnumerateFiles(repoDir, "*.*", opt))
                    {
                        string name = Path.GetFileName(f);
                        if (name.StartsWith(".") || f.Contains("\\bin\\") || f.Contains("\\obj\\") || f.Contains("\\node_modules\\") || f.Contains("\\.git\\"))
                            continue;

                        string ext = Path.GetExtension(f).ToLowerInvariant();
                        string icon = ext switch
                        {
                            ".cs" => "⚡",
                            ".xaml" => "🎨",
                            ".ts" or ".tsx" or ".js" or ".jsx" => "⚛",
                            ".json" => "⚙",
                            ".sql" => "🗄️",
                            ".md" => "📝",
                            _ => "📄"
                        };

                        _allPaletteItems.Add(new PaletteItem
                        {
                            Category = "Files",
                            Icon = icon,
                            Title = name,
                            Description = f,
                            ExecuteAction = () => OpenFileTab(f)
                        });

                        if (_allPaletteItems.Count >= 100) break;
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Palette file scan error: {ex.Message}");
            }

            // 2. Chats
            _allPaletteItems.Add(new PaletteItem { Category = "Chats", Icon = "💬", Title = "Antigravity IDE layout & Catppuccin theme", Description = "Active pairing chat session", ExecuteAction = () => LeftSidebar.SwitchView("Chats") });
            _allPaletteItems.Add(new PaletteItem { Category = "Chats", Icon = "💬", Title = "TreeViewUsability & Mouse Wheel Fix", Description = "File Explorer smooth scroll discussion", ExecuteAction = () => LeftSidebar.SwitchView("Chats") });
            _allPaletteItems.Add(new PaletteItem { Category = "Chats", Icon = "💬", Title = "UI Automation & Web Recorder Test", Description = "Recorded Web UI Test suite", ExecuteAction = () => LeftSidebar.SwitchView("Automation") });

            // 3. Builds
            _allPaletteItems.Add(new PaletteItem { Category = "Builds", Icon = "📦", Title = "dotnet build --configuration Release", Description = "Build desktop console application", ExecuteAction = () => SetBottomPanel(true, 0) });
            _allPaletteItems.Add(new PaletteItem { Category = "Builds", Icon = "📦", Title = "Compile MSP Backend & Portal Services", Description = "Full solution build queue", ExecuteAction = () => SetBottomPanel(true, 0) });

            // 4. Automation Tests
            _allPaletteItems.Add(new PaletteItem { Category = "Automation", Icon = "⚡", Title = "Public Facing Website Smoke Test", Description = "Target: https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/", ExecuteAction = () => LeftSidebar.SwitchView("Automation") });
            _allPaletteItems.Add(new PaletteItem { Category = "Automation", Icon = "⚡", Title = "Admin Panel v2 Navigation Test", Description = "Target: https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/admin-panel/adminv2", ExecuteAction = () => OpenWebTab("https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/admin-panel/adminv2", "Admin Center", "\uE7EF") });

            // 5. Git
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git status", Description = "Check working tree status", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git status"); } });
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git pull", Description = "Fetch and merge changes", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git pull"); } });
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git push", Description = "Push local commits", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git push"); } });
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git log", Description = "View commit history log", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git log --oneline -20"); } });
        }

        private void PerformPaletteSearch()
        {
            if (PaletteSearchBox == null || PaletteResultsList == null) return;

            string query = PaletteSearchBox.Text?.Trim().ToLowerInvariant() ?? string.Empty;
            string selectedCat = "All";
            if (ChipFiles?.IsChecked == true) selectedCat = "Files";
            else if (ChipChats?.IsChecked == true) selectedCat = "Chats";
            else if (ChipBuilds?.IsChecked == true) selectedCat = "Builds";
            else if (ChipAutomation?.IsChecked == true) selectedCat = "Automation";
            else if (ChipGit?.IsChecked == true) selectedCat = "Git";

            var filtered = _allPaletteItems.Where(item =>
            {
                if (selectedCat != "All" && !item.Category.Equals(selectedCat, StringComparison.OrdinalIgnoreCase))
                    return false;

                if (string.IsNullOrEmpty(query)) return true;

                return item.Title.ToLowerInvariant().Contains(query) ||
                       item.Description.ToLowerInvariant().Contains(query) ||
                       item.Category.ToLowerInvariant().Contains(query);
            }).ToList();

            PaletteResultsList.ItemsSource = filtered;
            if (filtered.Count > 0)
                PaletteResultsList.SelectedIndex = 0;
        }

        private void PaletteSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            PerformPaletteSearch();
        }

        private void PaletteChip_Click(object sender, RoutedEventArgs e)
        {
            PerformPaletteSearch();
        }

        private void PaletteSearchBox_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Down)
            {
                e.Handled = true;
                if (PaletteResultsList.Items.Count > 0)
                    PaletteResultsList.SelectedIndex = Math.Min(PaletteResultsList.SelectedIndex + 1, PaletteResultsList.Items.Count - 1);
            }
            else if (e.Key == Key.Up)
            {
                e.Handled = true;
                if (PaletteResultsList.Items.Count > 0)
                    PaletteResultsList.SelectedIndex = Math.Max(PaletteResultsList.SelectedIndex - 1, 0);
            }
            else if (e.Key == Key.Return)
            {
                e.Handled = true;
                ExecuteSelectedPaletteItem();
            }
            else if (e.Key == Key.Escape)
            {
                e.Handled = true;
                HideCommandPalette();
            }
        }

        private void PaletteResultsList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
        {
            ExecuteSelectedPaletteItem();
        }

        private void ExecuteSelectedPaletteItem()
        {
            if (PaletteResultsList.SelectedItem is PaletteItem item)
            {
                HideCommandPalette();
                item.ExecuteAction?.Invoke();
            }
        }

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
        private void AttachTabDragHandlers(TabItem tab)
        {
            tab.PreviewMouseLeftButtonDown += (s, e) =>
            {
                _tabDragStartPoint = e.GetPosition(null);
                _tabDragCandidate = tab;
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

                DragDrop.DoDragDrop(tab, new DataObject(TabDragFormat, tab), DragDropEffects.Move);

                DockGuideOverlay.Visibility = Visibility.Collapsed;
            };
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
                MessageBox.Show("No manifest loaded — use Load Manifest in the Automation sidebar first.", "Run Tests");
                return;
            }
            _ = RunManifestAsync(_loadedManifest, isRegression: false);
        }

        private async void RunRegressionSuite_Click(object sender, RoutedEventArgs e)
        {
            await RunRegressionSuiteCollectAsync();
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
        private async System.Threading.Tasks.Task<BuildConsole.Services.ManifestRunResult> RunManifestAsync(BuildConsole.Services.TestManifest manifest, bool isRegression)
        {
            string mode = isRegression ? "regression" : "single";
            BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                $"[{mode}] Running manifest for issue #{manifest.Issue} ({manifest.Feature}) — {manifest.ApiTests.Count} apiTests, {manifest.GraphTests.Count} graphTests, {manifest.PostGraphApiTests.Count} postGraphApiTests, {manifest.ZohoTests.Count} zohoTests, {manifest.UiSteps.Count} uiSteps, {manifest.PowerShellVerify.Count} powerShellVerify.");

            var runResult = new BuildConsole.Services.ManifestRunResult
            {
                Issue = manifest.Issue,
                Feature = manifest.Feature,
                Mode = mode,
                StartedAt = DateTime.Now,
            };

            // Git #810 (Epic #803 Phase 6), relocated by Git #857 into a dedicated window —
            // apiTests/graphTests cards stream in live via HttpTestExecutor/GraphTestExecutor's
            // own StepCompleted events (subscribed once per TestRunnerWindow instance), not
            // pushed from here.
            var runner = EnsureTestRunnerWindow();
            runner.Clear();
            runner.SetSteps(manifest);
            runner.BeginRun(manifest.Issue, manifest.Feature, mode);

            // Git #877 (Epic #803) — one per-run variable store, shared across all three executors
            // so a value an apiTest extracts (regex/jsonPath over its own response body) can be
            // interpolated via {{name}} into a later graphTest/uiStep in this same run.
            var vars = new BuildConsole.Services.TestRunVariables();

            // Git #953 (Epic #803) — seed the config-variable layer from Settings' stored
            // "Test Environment Variables" (TEST_PORTAL_PASSWORD, GRAPH_TEST_TENANT_ID, …) before
            // any executor runs, so {{NAME}} placeholders resolve against them first — the general
            // replacement for HttpTestExecutor's old hardcoded two-name DEPLOY_URL/SECRET_KEY chain.
            vars.SeedConfigVariables(BuildConsole.Services.BuildConsoleSettings.Load().TestEnvironmentVariables);

            var config = BuildConsole.Services.BuildTrackerConfig.Load();
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
                    Viewport = step.ViewportJson,
                    MaxDurationMs = step.MaxDurationMs,
                    // Git #966 — carry the uiStep's `"screenshot": true` opt-in so UiTestExecutor captures a
                    // WebView2 screenshot after this step, not only on failure.
                    Screenshot = step.Screenshot,
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
            var powerShellResults = await BuildConsole.Services.PowerShellTestExecutor.RunAsync(manifest, vars);
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

            return runResult;
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
                var result = await RunManifestAsync(manifest, isRegression: false);

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
    }

    public class PaletteItem
    {
        public string Category { get; set; } = "Files";
        public string CategoryUpper => Category.ToUpper();
        public string Icon { get; set; } = "📁";
        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public Action? ExecuteAction { get; set; }
    }
}
