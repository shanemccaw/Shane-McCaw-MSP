using System;
using System.Data;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Navigation;
using System.Windows.Shapes;
using System.Windows.Threading;
using System.Text.RegularExpressions;
using System.Threading;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        SyncMaximizeRestoreIcon();
        RenderNudgePill();
        RenderQueueActivePaused();
        RenderQuickAccessToolbar();

        _tabs.Add(new TabDef("home", "Home", isHome: true));
        _tabs.Add(new TabDef("epic-1202", "#1202 ShaneBuilder", isChat: true, kind: TabKind.Chat, dot: (Brush)FindResource("Brush.Epic.BuildConsole"), buildSet: "ShaneBuilder", epicNumber: 1202));
        SelectTab("home");
        _ = ResolveChatFeatureNumbersAsync(); // Git #2319 — real FeatureNumber per chat tab, lands async below

        RenderQueue(); // _queueItems starts empty — real rows land async below (Git #2413)
        RenderBuildDetail(); // starts closed (BuildDetailColumn.Width = 0) — no item selected yet
        _ = LoadQueueFromDatabaseAsync();

        RunStartupConnectivityCheckAsync();
        InitializeAlertsAndCritters();
        InitializeTestPad();
    }

    // ── Git #2327 — Test Pad pill + pad (Feature: Test Pad, #2326, item 1 of 28) ──────────────
    private TestPadPillWindow? _testPadPillWindow;
    private TestPadWindow? _testPadWindow;

    private void InitializeTestPad()
    {
        _testPadPillWindow = new TestPadPillWindow { OnTogglePad = ToggleTestPad };
        _testPadWindow = new TestPadWindow();
        _testPadPillWindow.Show();
    }

    private void ToggleTestPad()
    {
        if (_testPadWindow == null) return;
        if (_testPadWindow.IsVisible) _testPadWindow.Hide();
        else _testPadWindow.Show();
    }

    // ── Git #2201 — Alerts and Critters (readme-phase2.md Step 11) ────────────────────────────
    private AlertStackWindow? _alertStackWindow;
    private CritterOverlayWindow? _critterOverlayWindow;
    private AlertLabWindow? _alertLabWindow;

    private void InitializeAlertsAndCritters()
    {
        _alertStackWindow = new AlertStackWindow { OnOpenAlertLab = OpenAlertLab };
        _critterOverlayWindow = new CritterOverlayWindow();
        _alertLabWindow = new AlertLabWindow();

        AlertCenter.AlertsChanged += OnAlertsChanged;
        AlertCenter.CelebrationRequested += OnCelebrationRequested;

        // Wire the real actions a card/lab fire — AlertWatchers.cs and AlertLabWindow build their
        // AlertAction delegates against these static fields (Notifications/AlertActions.cs) rather
        // than depending on MainWindow directly, same static-bridge shape ToastEngine already uses.
        AlertActions.OpenLogAt = (sourceId, levels, query) => OpenLogAt(sourceId, levels, query);
        AlertActions.OpenGitDoctor = OpenGitDoctor;
        AlertActions.OpenIssueInGitPanel = n => OpenGitIssueInPanelCold(n); // Git #2300 — derived-ancestry cold open
        AlertActions.AppendToComposer = AppendToComposer;
        AlertActions.OpenChatInBrowser = conversationId =>
        {
            if (string.IsNullOrWhiteSpace(conversationId)) return;
            try { Process.Start(new ProcessStartInfo($"https://claude.ai/chat/{conversationId}") { UseShellExecute = true }); }
            catch { /* opening the browser must never crash the card */ }
        };

        AlertWatchers.Start();
    }

    private void OnAlertsChanged()
    {
        var live = AlertCenter.LiveAlerts;
        _alertStackWindow?.Render(live);
        BellBadge.Visibility = live.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        BellBadgeText.Text = live.Count.ToString();
    }

    private void OnCelebrationRequested(Celebration c) => _critterOverlayWindow?.Play(c);

    private void BtnAlertBell_Click(object sender, RoutedEventArgs e) => OpenAlertLab();

    private void OpenAlertLab()
    {
        if (_alertLabWindow == null) return;
        var point = BtnAlertBell.PointToScreen(new Point(BtnAlertBell.ActualWidth - 296, BtnAlertBell.ActualHeight + 4));
        _alertLabWindow.ShowNear(point);
    }

    /// <summary>The real "lands you in the pre-filtered log" primary action for a Crash/BuildFailed
    /// alert — sets the Log Viewer's own filter state (same fields BuildCurrentLogQuery reads) and
    /// switches to it, then refreshes.</summary>
    private void OpenLogAt(string? sourceId, IReadOnlyList<LogLevel>? levels, string? query)
    {
        _logEnabledSourceIds.Clear();
        if (sourceId != null && LogService.Sources.Any(s => s.Id == sourceId))
            _logEnabledSourceIds.Add(sourceId);
        else
            foreach (var s in LogService.Sources) _logEnabledSourceIds.Add(s.Id);

        _logSelectedLevels.Clear();
        if (levels != null && levels.Count > 0)
            foreach (var l in levels) _logSelectedLevels.Add(l);
        else
            foreach (var l in Enum.GetValues<LogLevel>()) _logSelectedLevels.Add(l);

        _logHighlight = false;
        _logRegex = false;
        _logSearchText = query ?? "";
        _logExcludeText = "";
        _logScrubberMinutesBack = 0;

        OpenLogViewer();
        RefreshLogViewerQuery();
    }

    /// <summary>The real "opens #N in the Git panel — your document stayed put" secondary action for
    /// an IssueBlocked alert. Reuses RailToggle_Click's own panel-opening logic against BtnRailGit.</summary>
    private void OpenLeftPanelGit()
    {
        if (_leftPanelSource == "Git") return;
        _leftPanelSource = "Git";
        LeftPanel.Width = LeftPanelWidth;
        LeftPanelTitle.Text = RailPanelLabels["Git"];
        foreach (var rail in RailButtons) rail.IsChecked = ReferenceEquals(rail, BtnRailGit);
        ChatsPanelBody.Visibility = Visibility.Collapsed;
        GitPanelBody.Visibility = Visibility.Visible;
        NextUpPanelBody.Visibility = Visibility.Collapsed;
        NotBuiltPanelBody.Visibility = Visibility.Collapsed;
        _ = EnsureGitPanelLoadedAsync(); // Git #2290 — first open fires the real GitHub reads
    }

    // ── Git #2176 — real live-connectivity proof at startup ────────────────────────────────
    // Fires the same two real connections BuildConsole's own MainWindow establishes at launch
    // (GitHub API via a Bearer PAT, direct local Postgres via DATABASE_URL) and shows the real
    // result — genuine open-issue count, genuine bt_build_queue row count — in the status bar's
    // ConnHealthStatus segment. Each leg reports its own honest state independently; a missing
    // PAT or DB doesn't block the other, and neither ever falls back to fixture data.
    private async void RunStartupConnectivityCheckAsync()
    {
        string githubPart;
        try
        {
            var gh = GitHubReadClient.CreateFromEnvironment();
            githubPart = gh == null
                ? "GitHub: no PAT"
                : $"GitHub: {await gh.GetOpenIssueCountAsync()} open";
        }
        catch (Exception ex)
        {
            githubPart = $"GitHub: failed ({ex.Message})";
        }

        string queuePart;
        try
        {
            var db = QueueReadClient.CreateFromEnvironment();
            queuePart = db == null
                ? "Queue: no DB"
                : $"Queue: {await db.GetQueueRowCountAsync()} rows";
        }
        catch (Exception ex)
        {
            queuePart = $"Queue: failed ({ex.Message})";
        }

        ConnHealthStatus.Text = $"{githubPart} · {queuePart}";
    }

    // ── Git #2413 — Build Queue panel's real backing data ──────────────────────────────────
    // Replaces the former SeedSampleQueueData() fixture (filed off #2308's own build audit)
    // with a real read off bt_build_queue via QueueReadClient — the same client #2309/#2410
    // and the Command Palette's "Builds" category (#2203) already use for other real queue
    // reads in this app. No second client, no fixture rows ever mixed with real ones. No
    // DATABASE_URL resolvable, or the read itself failing, means the panel starts genuinely
    // empty (RenderQueue's own "No builds in the queue yet." state) — never a fallback to
    // fabricated rows.
    private async Task LoadQueueFromDatabaseAsync()
    {
        var client = QueueReadClient.CreateFromEnvironment();
        if (client == null)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, "[queue] Build Queue panel: no DATABASE_URL resolvable — starting empty.");
            return;
        }

        List<PaletteBuildQueueRow> rows;
        try
        {
            rows = await client.GetRecentBuildsAsync(limit: 150);
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[queue] Build Queue panel: real read failed: {ex.Message}");
            return;
        }

        // A row's blocked_by_number can point at a build outside this recent-150 window (an
        // older row) — backfill just those so the "blocked by #N (status)" chip reflects the
        // real blocker's real state instead of "unknown".
        var blockerInfo = new Dictionary<int, (string Status, string? BuildSet)>();
        foreach (var r in rows)
            if (r.GithubNumber.HasValue)
                blockerInfo[r.GithubNumber.Value] = (r.Status, r.BuildSet);

        var missingBlockerNumbers = rows
            .Where(r => r.BlockedByNumber.HasValue && !blockerInfo.ContainsKey(r.BlockedByNumber.Value))
            .Select(r => r.BlockedByNumber!.Value)
            .Distinct()
            .ToList();

        if (missingBlockerNumbers.Count > 0)
        {
            try
            {
                var backfill = await client.GetLatestByGithubNumbersAsync(missingBlockerNumbers);
                foreach (var b in backfill)
                    if (b.GithubNumber.HasValue)
                        blockerInfo[b.GithubNumber.Value] = (b.Status, b.BuildSet);
            }
            catch (Exception ex)
            {
                // Non-fatal — affected rows just show "unknown" for a blocker this couldn't reach.
                Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[queue] Build Queue panel: blocker backfill failed: {ex.Message}");
            }
        }

        // "Blocks" is the reverse edge: which other loaded rows are waiting on THIS row's own
        // github_number — derivable from the same recent window, no extra query needed.
        var blocksLookup = rows
            .Where(r => r.BlockedByNumber.HasValue && r.GithubNumber.HasValue)
            .GroupBy(r => r.BlockedByNumber!.Value)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<int>)g.Select(r => r.GithubNumber!.Value).Distinct().ToList());

        var items = new List<QueueItem>();
        foreach (var row in rows)
        {
            string buildSet = string.IsNullOrWhiteSpace(row.BuildSet) ? "Ungrouped" : row.BuildSet;
            string status = MapQueueStatus(row.Status);

            // A queued row whose real blocker hasn't reached a terminal state yet displays as
            // Blocked instead of Queued — mirrors BuildConsole's own BuildQueuePanel.xaml.cs
            // "isBlocked" derivation, computed here off real rows rather than a second live pass.
            IReadOnlyList<(int, string, string?)> blockedBy = Array.Empty<(int, string, string?)>();
            if (row.BlockedByNumber.HasValue)
            {
                int blockerNum = row.BlockedByNumber.Value;
                if (blockerInfo.TryGetValue(blockerNum, out var info))
                {
                    string blockerStatus = MapQueueStatus(info.Status).ToLowerInvariant();
                    string? crossSet = info.BuildSet != null && !string.Equals(info.BuildSet, buildSet, StringComparison.Ordinal)
                        ? info.BuildSet
                        : null;
                    blockedBy = new[] { (blockerNum, blockerStatus, crossSet) };
                    if (status == "Queued" && !IsTerminalDbStatus(info.Status))
                        status = "Blocked";
                }
                else
                {
                    blockedBy = new[] { (blockerNum, "unknown", (string?)null) };
                }
            }

            IReadOnlyList<int> blocks = row.GithubNumber.HasValue && blocksLookup.TryGetValue(row.GithubNumber.Value, out var b)
                ? b
                : Array.Empty<int>();

            items.Add(new QueueItem(
                row.Id.ToString(),
                row.Title,
                buildSet,
                status,
                row.GithubNumber,
                row.Model,
                row.Effort,
                branch: null, // bt_build_queue has no branch column — never fabricated
                buildId: string.IsNullOrWhiteSpace(row.SessionId) ? null : row.SessionId,
                blocks: blocks,
                blockedBy: blockedBy));
            // checklist intentionally omitted — real rows carry no checklist data
        }

        _queueItems.Clear();
        _queueItems.AddRange(items);
        // Real chat linking isn't built yet, so _buildSetChatRefs stays empty — BuildSetCard
        // already hides the chat-reference pill entirely when a set has no entry there.
        RenderQueue();

        // Git #2308 — the same real Park/Pause overlay Git Map and the Command Palette already
        // apply after their own fetch (GitEpicPanelService.OverlayParkPauseAsync), applied here
        // too so the Build Queue panel's rows read the same real state instead of a third,
        // divergent notion of "parked"/"paused". Fire-and-forget after the first real render —
        // mirrors the same pattern this method's own caller already uses for the initial load.
        _ = OverlayQueueParkPauseAsync(items);
    }

    private async Task OverlayQueueParkPauseAsync(List<QueueItem> items)
    {
        var withNumbers = items.Where(i => i.GithubNumber.HasValue).ToList();
        if (withNumbers.Count == 0) return;

        var features = withNumbers
            .Select(i => new Services.GitMapFeature { Number = i.GithubNumber!.Value, Title = i.Title })
            .ToList();

        try
        {
            await Services.GitEpicPanelService.OverlayParkPauseAsync(features, Services.ChatReadClient.ResolveConnectionStringForSqlRunner());
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[queue] Build Queue panel: park/pause overlay failed: {ex.Message}");
            return;
        }

        var byNumber = features.ToDictionary(f => f.Number, f => f);
        foreach (var item in withNumbers)
        {
            if (byNumber.TryGetValue(item.GithubNumber!.Value, out var f))
            {
                item.IsParked = f.IsParked;
                item.IsPaused = f.IsPaused;
            }
        }

        RenderQueue();
    }

    private static bool IsTerminalDbStatus(string? dbStatus) => dbStatus is "done" or "failed" or "canceled";

    // Real bt_build_queue status vocabulary (confirmed via `\d bt_build_queue` + a live
    // GROUP BY, plus the real status constants BuildConsole's own BuildQueuePostgresClient /
    // AccountCapPolicy / SessionLimitAutoRestartService define for that same shared table)
    // mapped onto this panel's own display vocabulary. An unrecognized real status shows
    // verbatim rather than being silently dropped or coerced.
    private static string MapQueueStatus(string? dbStatus) => dbStatus switch
    {
        "queued" => "Queued",
        "running" => "Running",
        "verifying" => "Verifying",
        "done" => "Done",
        "failed" => "Failed",
        "canceled" => "Cancelled",
        "parked" => "Parked",
        "external" => "External",
        "capped" => "Capped",
        "limit-paused" => "Queued", // still pending, same coarser treatment BuildConsole's own panel gives it
        "blocked" => "Blocked",
        null or "" => "Queued",
        _ => dbStatus
    };

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        WindowChromeHelper.Setup(this);
        RegisterScreenClipHotkey();
    }

    // ── Git #2210 — desktop screen-clipping tool (ported from BuildConsole's Git #1866) ───────
    // Title-bar icon + PrintScreen. Two key paths, both needed:
    //   Global: RegisterHotKey(VK_SNAPSHOT) via an HwndSource hook, so PrtScn fires even when
    //           ShaneBuilder isn't focused. Windows 11's "Use the Print screen key to open
    //           Snipping Tool" claims the key first — RegisterHotKey then returns false; we log
    //           it, toast once, and put the reason in the button tooltip.
    //   In-app: WPF doesn't reliably raise KeyDown for PrtScn (only key-up), so
    //           Window_PreviewKeyUp also handles Key.Snapshot — this covers the focused case
    //           even when the global registration was refused.
    private const int WM_HOTKEY = 0x0312;
    private const int VK_SNAPSHOT = 0x2C;
    private const int SCREEN_CLIP_HOTKEY_ID = 0xB1A6; // arbitrary, app-unique
    private bool _screenClipHotkeyRegistered;
    private System.Windows.Interop.HwndSource? _screenClipHwndSource;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    private void RegisterScreenClipHotkey()
    {
        var helper = new System.Windows.Interop.WindowInteropHelper(this);
        _screenClipHwndSource = System.Windows.Interop.HwndSource.FromHwnd(helper.Handle);
        _screenClipHwndSource?.AddHook(ScreenClipWndProc);

        // fsModifiers=0: bare PrintScreen, no modifier.
        _screenClipHotkeyRegistered = RegisterHotKey(helper.Handle, SCREEN_CLIP_HOTKEY_ID, 0, VK_SNAPSHOT);
        if (_screenClipHotkeyRegistered)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Info, "Screen clip global PrintScreen hotkey registered.");
            BtnScreenClip.ToolTip = "Screen clip (PrintScreen) — drag a region to the clipboard and disk";
        }
        else
        {
            // Almost always: Windows 11 Snipping Tool already owns PrtScn.
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn,
                "Screen clip global PrintScreen hotkey registration REFUSED (RegisterHotKey returned false) — likely Windows Snipping Tool owns the key. In-app key-up still works when ShaneBuilder is focused.");
            ToastEngine.Warning("PrintScreen already claimed",
                "Windows (Snipping Tool) already owns the Print Screen key, so ShaneBuilder couldn't register it globally. PrtScn still works when ShaneBuilder is focused; the title-bar icon always works. Turn off \"Use the Print screen key to open Snipping Tool\" in Windows Settings to free it.");
            BtnScreenClip.ToolTip = "Screen clip — drag a region to the clipboard and disk. Global PrintScreen is claimed by Windows Snipping Tool; PrtScn works only when ShaneBuilder is focused (or free the key in Windows Settings).";
        }
    }

    private IntPtr ScreenClipWndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_HOTKEY && wParam.ToInt32() == SCREEN_CLIP_HOTKEY_ID)
        {
            handled = true;
            Services.DesktopScreenClipService.Capture();
        }
        return IntPtr.Zero;
    }

    private void ScreenClip_Click(object sender, RoutedEventArgs e) => Services.DesktopScreenClipService.Capture();

    protected override void OnClosed(EventArgs e)
    {
        // Git #2210 — release the global PrintScreen hotkey and detach the message hook.
        try
        {
            if (_screenClipHotkeyRegistered)
            {
                UnregisterHotKey(new System.Windows.Interop.WindowInteropHelper(this).Handle, SCREEN_CLIP_HOTKEY_ID);
                _screenClipHotkeyRegistered = false;
            }
            _screenClipHwndSource?.RemoveHook(ScreenClipWndProc);
        }
        catch { /* best-effort teardown on shutdown */ }

        DisposeAllTerminalSessions(); // Git #2216 — never leave a live powershell.exe/cmd.exe running after exit

        try
        {
            AlertWatchers.Stop();
            AlertCenter.AlertsChanged -= OnAlertsChanged;
            AlertCenter.CelebrationRequested -= OnCelebrationRequested;
            _alertStackWindow?.Close();
            _critterOverlayWindow?.Close();
            _alertLabWindow?.Close();
        }
        catch { /* best-effort teardown on shutdown */ }

        base.OnClosed(e);
    }

    private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

    /// <summary>Keeps the maximize/restore button's glyph and tooltip in sync with the real
    /// WindowState, including when it changes some OTHER way (double-click the title bar,
    /// Aero-snap drag-to-top, Win+Up). StateChanged only fires on a CHANGE — since the window
    /// starts already Maximized (WindowState="Maximized" in XAML), this must also be called
    /// once explicitly at startup, or the icon shows the wrong (Maximize) glyph until the
    /// user changes state some other way first.</summary>
    private void Window_StateChanged(object sender, EventArgs e) => SyncMaximizeRestoreIcon();

    private void SyncMaximizeRestoreIcon()
    {
        bool maximized = WindowState == WindowState.Maximized;
        BtnMaximizeRestoreIcon.Text = maximized ? "" : ""; // ChromeRestore / ChromeMaximize
        BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
    }

    // ── Focus nudge pill — title bar, per README's spec: 6 escalating
    // stages (on track → 10m → 15m → 30m → 45m → 60m+), each warmer and
    // wider than the last. Colors are Brush.FocusNudge.<Stage>.* from
    // Colors.xaml section 8 — an exact match to the mockup's own LEVELS
    // table (same hex values), not new colors. There's no real "quiet
    // timer" yet (needs the Home tab's not-yet-wired Today's Objectives),
    // so clicking the pill cycles the stage for now, same as the mockup's
    // own onCycle demo behavior. The objective shown is honestly this
    // project's own real epic (#1202 ShaneBuilder), not invented data.
    private static readonly (string StageKey, string Label, double Width, bool Pulse)[] NudgeStages =
    {
        ("OnTrack", "On track", 90, false),
        ("Quiet10m", "Quiet 10m", 130, false),
        ("Quiet15m", "Quiet 15m", 170, false),
        ("Quiet30m", "Quiet 30m", 210, false),
        ("Quiet45m", "Quiet 45m", 250, true),
        ("Quiet60mLoud", "Quiet 60m+", 340, true)
    };

    private int _nudgeLevel;

    private void RenderNudgePill()
    {
        var stage = NudgeStages[_nudgeLevel];
        var fg = (Brush)FindResource($"Brush.FocusNudge.{stage.StageKey}.Fg");
        var bg = (Brush)FindResource($"Brush.FocusNudge.{stage.StageKey}.Bg");
        var border = (Brush)FindResource($"Brush.FocusNudge.{stage.StageKey}.Border");

        NudgePill.Width = stage.Width;
        NudgePill.Background = bg;
        NudgePill.BorderBrush = border;
        NudgePill.BorderThickness = new Thickness(1);
        NudgeDot.Fill = fg;
        NudgeLabel.Text = "ShaneBuilder · " + stage.Label;
        NudgeLabel.Foreground = fg;

        bool showMessage = _nudgeLevel >= 3;
        NudgeMessageHost.Visibility = showMessage ? Visibility.Visible : Visibility.Collapsed;
        if (showMessage)
        {
            NudgeMessageText.Text = "Hey Shane, want to get back to #1202 ShaneBuilder?";
            NudgeMessageText.Foreground = fg;
        }
    }

    private void NudgePill_Click(object sender, MouseButtonEventArgs e)
    {
        _nudgeLevel = (_nudgeLevel + 1) % NudgeStages.Length;
        RenderNudgePill();
    }

    private void NudgeJumpBack_Click(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true; // don't also cycle the pill underneath
        SelectTab("epic-1202");
    }

    // ── Left panel — icon rail drives which source (Chats/Epics/Git/NextUp)
    // fills the 280px panel, per mockup's leftPanelOpen/leftPanelSource
    // state (Shell Skeleton v2.html line 89). Clicking the already-active
    // rail icon closes the panel, same as the mockup's onToggleLeft* handlers.
    private const double LeftPanelWidth = 280;
    private string? _leftPanelSource;

    private void RailToggle_Click(object sender, RoutedEventArgs e)
    {
        var clicked = (ToggleButton)sender;
        var source = (string)clicked.Tag;

        if (_leftPanelSource == source)
        {
            CloseLeftPanel();
            return;
        }

        OpenLeftPanel(source);
    }

    /// <summary>Git #2203 — pulled out of RailToggle_Click so the Command Center's per-category
    /// right pane (Git panel / Build Watch / Sidebar buttons) can open a real rail panel too,
    /// not just a physical rail-icon click. Matches rail buttons by <c>Tag</c> instead of by
    /// reference, since there's no clicked ToggleButton in this call path.</summary>
    private void OpenLeftPanel(string source)
    {
        _leftPanelSource = source;
        LeftPanel.Width = LeftPanelWidth;
        LeftPanelTitle.Text = RailPanelLabels.TryGetValue(source, out var label) ? label : source.ToUpperInvariant();

        foreach (var rail in RailButtons)
            rail.IsChecked = (string)rail.Tag == source;

        ChatsPanelBody.Visibility = source == "Chat" ? Visibility.Visible : Visibility.Collapsed;
        BtnNewChat.Visibility = source == "Chat" ? Visibility.Visible : Visibility.Collapsed; // Git #2320
        GitPanelBody.Visibility = source == "Git" ? Visibility.Visible : Visibility.Collapsed;
        NextUpPanelBody.Visibility = source == "NextUp" ? Visibility.Visible : Visibility.Collapsed;
        BatterUpPanelBody.Visibility = source == "BatterUp" ? Visibility.Visible : Visibility.Collapsed;
        if (source == "Git")
            _ = EnsureGitPanelLoadedAsync(); // Git #2290 — first open fires the real GitHub reads
        if (source == "BatterUp")
            _ = EnsureBatterUpPanelLoadedAsync(); // Git #2356 — first open fires the real lane-count read

        // Build Console / Build Watch / UI Testing / Shot Vault share one
        // placeholder body — none of them have a real design or data source
        // yet, so this is an honest "not built" state, not invented content
        // per panel. Batter Up moved to its own real panel above (#2356).
        bool notBuilt = source is "BuildConsole" or "BuildWatch" or "UiTesting" or "ShotVault";
        NotBuiltPanelBody.Visibility = notBuilt ? Visibility.Visible : Visibility.Collapsed;
        if (notBuilt)
            NotBuiltPanelBody.Text = $"{RailPanelLabels[source]} isn't built yet — no design or data source wired up here.";
    }

    // Shane's pared-down rail list, in his given order (Epics dropped).
    private ToggleButton[] RailButtons => new[]
    {
        BtnRailChat, BtnRailGit, BtnRailNextUp, BtnRailBatterUp,
        BtnRailBuildConsole, BtnRailBuildWatch, BtnRailUiTesting, BtnRailShotVault
    };

    private static readonly Dictionary<string, string> RailPanelLabels = new()
    {
        ["Chat"] = "CHAT",
        ["Git"] = "GIT",
        ["NextUp"] = "NEXT UP",
        ["BatterUp"] = "BATTER UP",
        ["BuildConsole"] = "BUILD CONSOLE",
        ["BuildWatch"] = "BUILD WATCH",
        ["UiTesting"] = "UI TESTING",
        ["ShotVault"] = "SHOT VAULT"
    };

    // Collapse icon on the panel's own outer edge (right side, away from the
    // rail) — closes it directly instead of requiring the same rail icon to
    // be clicked again. Shares the exact close logic RailToggle_Click uses
    // when toggling the already-active source off.
    private void BtnCollapseLeftPanel_Click(object sender, RoutedEventArgs e) => CloseLeftPanel();

    private void CloseLeftPanel()
    {
        _leftPanelSource = null;
        LeftPanel.Width = 0;
        foreach (var rail in RailButtons)
            rail.IsChecked = false;
    }

    // ── Build Queue panel — 348px open / 40px collapsed, per mockup's
    // queuePanelStyle (Shell Skeleton v2.html line 2370).
    private const double QueuePanelWidthOpen = 348;
    private const double QueuePanelWidthCollapsed = 40;
    private bool _queuePanelOpen = true;

    private void BtnToggleQueue_Click(object sender, RoutedEventArgs e)
    {
        _queuePanelOpen = !_queuePanelOpen;
        BuildQueuePanel.Width = _queuePanelOpen ? QueuePanelWidthOpen : QueuePanelWidthCollapsed;
        BtnToggleQueueIcon.Text = _queuePanelOpen ? "" : ""; // ChevronLeft / ChevronRight
        BtnToggleQueue.ToolTip = _queuePanelOpen ? "Collapse Build Queue" : "Expand Build Queue";
        QueuePanelTitle.Visibility = _queuePanelOpen ? Visibility.Visible : Visibility.Collapsed;
        QueueHeaderActions.Visibility = _queuePanelOpen ? Visibility.Visible : Visibility.Collapsed;
        QueuePanelBody.Visibility = _queuePanelOpen ? Visibility.Visible : Visibility.Collapsed;
    }

    // Active/Paused toggle — per mockup's toggleQPaused (line 2256). Real
    // locally-tracked state (no queue-watcher backend exists to actually
    // pause/resume yet), same honest-demo pattern as the nudge pill.
    private bool _queuePaused;

    private void RenderQueueActivePaused()
    {
        var accent = _queuePaused ? (Brush)FindResource("Brush.Status.Capped") : (Brush)FindResource("Brush.Status.Running");
        BtnQueueActivePaused.Background = Tint(accent, 0x26);
        BtnQueueActivePaused.BorderBrush = Tint(accent, 0x66);
        BtnQueueActivePaused.BorderThickness = new Thickness(1);
        QueueActivePausedIcon.Text = _queuePaused ? "" : ""; // Play / Pause
        QueueActivePausedIcon.Foreground = accent;
        QueueActivePausedText.Text = _queuePaused ? "Paused" : "Active";
        QueueActivePausedText.Foreground = accent;
        BtnQueueActivePaused.ToolTip = _queuePaused ? "Queue paused — click to resume" : "Queue running — click to pause";
    }

    private void BtnQueueActivePaused_Click(object sender, MouseButtonEventArgs e)
    {
        _queuePaused = !_queuePaused;
        RenderQueueActivePaused();
    }

    // Lens chip — opens Filter Studio, now that docs/Filter Studio & Lenses.md
    // gives it a real spec to build against.
    private void BtnLensChip_Click(object sender, MouseButtonEventArgs e) => OpenFilterStudio();

    // ── Document host — tab strip + content switch, per mockup's tabDefs /
    // tabs (Shell Skeleton v2.html lines 1489-1494, 2465-2474). The Home tab
    // is pinned first, outside every workspace, and only grows a close
    // button once something else is open (Step 9); every other tab gets an
    // epic-accent dot (shown only while active, per tb.dot logic) and a ×
    // close button that falls back to the previous tab, or a fresh Home if
    // that was the last tab standing.
    // Tab-strip workspace grouping — Step 9 (wpf-handoff/readme-phase2.md).
    // TabKind→workspace is the "one place" default map the readme's contract
    // calls for; a tab's own WorkspaceId (set at construction) overrides it,
    // same as the contract's TabDef.WorkspaceId semantics.
    private enum TabKind { Chat, Design, GitIssue, Favorite, Log, Api, File }

    private sealed record WorkspaceDef(string Id, string Label, string IconKey, string BrushKey, bool IsPrimary);

    private static readonly WorkspaceDef[] AllWorkspaces =
    {
        new("chats", "CLAUDE CHATS", "Icon.Chat", "Brush.Workspace.Chats", true),
        new("designs", "CLAUDE DESIGNS", "Icon.LayoutGrid", "Brush.Workspace.Designs", false),
        new("git", "GIT ISSUES", "Icon.Git", "Brush.Workspace.GitIssues", false),
        new("favorites", "FAVORITES", "Icon.Star", "Brush.Workspace.Favorites", false),
        new("logs", "LOGS", "Icon.Activity", "Brush.Workspace.Logs", false),
        new("api", "API EXPLORERS", "Icon.Zap", "Brush.Workspace.Api", false),
        new("files", "FILES", "Icon.FileCode", "Brush.Workspace.Files", false),
    };

    private static readonly Dictionary<TabKind, string> KindWorkspaceDefault = new()
    {
        [TabKind.Chat] = "chats",
        [TabKind.Design] = "designs",
        [TabKind.GitIssue] = "git",
        [TabKind.Favorite] = "favorites",
        [TabKind.Log] = "logs",
        [TabKind.Api] = "api",
        [TabKind.File] = "files",
    };

    private sealed class TabDef
    {
        public string Id { get; }
        public string Title { get; }
        public bool IsHome { get; }
        public bool IsChat { get; }
        public bool IsGitDoctor { get; }
        public bool IsRepoHealth { get; }
        public TabKind? Kind { get; }
        public string? Ext { get; }
        public bool IsLogViewer { get; }
        public bool IsGitMap { get; }
        public bool IsSettings { get; }
        // Git #2211 — set for a Markdown Viewer tab opened by dropping a .md file;
        // the real path SelectTab reads from and MarkdownRenderer.Render()s into
        // MarkdownViewerDock. Null for every other tab kind.
        public string? MdFilePath { get; }
        public bool IsMarkdownViewer => MdFilePath != null;
        public Brush? Dot { get; }
        public string? BuildSet { get; }
        // Git #2209 §11 — the chat's epic is DERIVED from the tab, never hardcoded or stored
        // twice. The mockup shipped "#1202" baked into the context bar and the panel lied about
        // which chat you were in after a tab switch; the fix is that the epic number lives HERE,
        // once, and every chat-chrome surface reads it off the active tab.
        public int? EpicNumber { get; }
        // Git #2319 — the real Feature-tier ancestor of EpicNumber's issue (GitHub's own `parent`
        // sub-issue edge, walked via GitIssuesService.ResolveFeatureTierAncestorAsync — see
        // ResolveChatFeatureNumbersAsync). Null is a genuinely honest state (an Epic-tier anchor
        // sitting at the top of the tree, or a lookup that hasn't resolved/failed yet) — never
        // guessed. Mutable (not init), same pattern as GitMapFeature.IsParked: resolved
        // asynchronously AFTER the tab is constructed, then the tab strip is re-rendered.
        public int? FeatureNumber { get; set; }
        // Git #2312 — set for a Git Panel peek sent to a tab via "Send to tab"; the real crumb
        // trail snapshot GitItemDock's RenderGitItemDoc renders through the same
        // RenderGitIdentityBlock the rail peek uses. Null for every other tab kind.
        public List<GitCrumb>? GitItemTrail { get; }
        public bool IsGitItemDoc => GitItemTrail != null;
        private readonly string? _workspaceIdOverride;

        public string? WorkspaceId => _workspaceIdOverride ?? (Kind.HasValue ? KindWorkspaceDefault[Kind.Value] : null);

        public TabDef(string id, string title, bool isHome = false, bool isChat = false, bool isGitDoctor = false,
            TabKind? kind = null, string? workspaceId = null, string? ext = null, bool isLogViewer = false,
            string? mdFilePath = null, Brush? dot = null, string? buildSet = null, int? epicNumber = null,
            bool isRepoHealth = false, bool isGitMap = false, bool isSettings = false,
            List<GitCrumb>? gitItemTrail = null)
        {
            Id = id;
            Title = title;
            IsHome = isHome;
            IsChat = isChat;
            IsGitDoctor = isGitDoctor;
            IsRepoHealth = isRepoHealth;
            Kind = kind;
            _workspaceIdOverride = workspaceId;
            Ext = ext;
            IsLogViewer = isLogViewer;
            MdFilePath = mdFilePath;
            Dot = dot;
            BuildSet = buildSet;
            EpicNumber = epicNumber;
            IsGitMap = isGitMap;
            IsSettings = isSettings;
            GitItemTrail = gitItemTrail;
        }
    }

    private readonly List<TabDef> _tabs = new();
    private string _activeTabId = "home";

    // Dismissed ("stashed") workspaces — their tabs stay in _tabs, just out
    // of the strip, per the readme's "Dismiss" behavior. Folded ("collapsed")
    // workspaces still show in the strip but shrunk to their header chip.
    private readonly HashSet<string> _stashedWorkspaces = new();
    private readonly HashSet<string> _collapsedWorkspaces = new();

    // Git #2319 — real FeatureNumber per chat tab, resolved off GitHub's own `parent` sub-issue
    // edge (GitIssuesService.ResolveFeatureTierAncestorAsync — same real-fail-closed `gh` shellout
    // pattern GitMapService/GitIssuesService already use, never a second data path). Runs once at
    // startup for the tabs that exist then; called again for any tab created afterward whose
    // FeatureNumber hasn't been resolved yet (the "New Chat" flow lands in #2320-#2323).
    private async Task ResolveChatFeatureNumbersAsync()
    {
        var targets = _tabs.Where(t => t.IsChat && t.EpicNumber.HasValue && t.FeatureNumber == null).ToList();
        if (targets.Count == 0) return;

        bool changed = false;
        foreach (var tab in targets)
        {
            try
            {
                var (number, _) = await Services.GitIssuesService.ResolveFeatureTierAncestorAsync(tab.EpicNumber!.Value);
                if (number.HasValue)
                {
                    tab.FeatureNumber = number.Value;
                    changed = true;
                }
            }
            catch (Exception ex)
            {
                Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.feature] resolve failed for tab {tab.Id} (epic #{tab.EpicNumber}): {ex.Message}");
            }
        }

        if (changed) RenderTabStrip();
    }

    private void RenderTabStrip()
    {
        TabStripPanel.Children.Clear();

        var home = _tabs.Find(t => t.IsHome);
        if (home != null)
            TabStripPanel.Children.Add(BuildTabPill(home));

        foreach (var ws in AllWorkspaces)
        {
            if (_stashedWorkspaces.Contains(ws.Id)) continue;
            var members = _tabs.Where(t => !t.IsHome && t.WorkspaceId == ws.Id).ToList();
            if (members.Count == 0) continue;
            TabStripPanel.Children.Add(BuildWorkspaceGroup(ws, members));
        }

        // A tab with no workspace mapping (shouldn't normally happen once
        // every real tab kind carries a Kind) still renders rather than
        // silently vanishing from the strip.
        foreach (var t in _tabs.Where(t => !t.IsHome && t.WorkspaceId == null))
            TabStripPanel.Children.Add(BuildTabPill(t));

        RenderWorkspaceBox();
    }

    private Border BuildWorkspaceGroup(WorkspaceDef ws, List<TabDef> members)
    {
        var accent = (Brush)FindResource(ws.BrushKey);
        var accentColor = ((SolidColorBrush)accent).Color;
        bool ownsActive = members.Any(t => t.Id == _activeTabId);
        bool collapsed = _collapsedWorkspaces.Contains(ws.Id);

        // The whole group is one rounded capsule — a visible border + tinted
        // fill all the way around, not just a top accent line — with the
        // workspace chip as its own smaller pill nested at the left edge.
        var wrapper = new Border
        {
            Margin = new Thickness(0, 3, 6, 3),
            Padding = new Thickness(4, 3, 4, 3),
            CornerRadius = new CornerRadius(10),
            BorderThickness = new Thickness(1),
            BorderBrush = new SolidColorBrush(accentColor) { Opacity = 0.4 },
            Background = new SolidColorBrush(accentColor) { Opacity = ownsActive ? 0.10 : 0.055 }
        };

        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

        var chip = new Border
        {
            CornerRadius = new CornerRadius(7),
            Padding = new Thickness(8, 4, 7, 4),
            Cursor = Cursors.Hand,
            Background = new SolidColorBrush(accentColor) { Opacity = 0.14 },
            BorderThickness = new Thickness(1),
            BorderBrush = new SolidColorBrush(accentColor) { Opacity = 0.35 }
        };
        var chipStack = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        chipStack.Children.Add(new System.Windows.Shapes.Path
        {
            Data = (Geometry)FindResource(ws.IconKey), Stroke = accent, Width = 11, Height = 11, Margin = new Thickness(0, 0, 6, 0),
            Stretch = Stretch.Uniform, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round,
            StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Fill = Brushes.Transparent
        });
        chipStack.Children.Add(new TextBlock
        {
            Text = ws.Label, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = accent
        });
        chipStack.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(7), Padding = new Thickness(6, 1, 6, 1), VerticalAlignment = VerticalAlignment.Center,
            Background = new SolidColorBrush(accentColor) { Opacity = 0.3 },
            Child = new TextBlock { Text = members.Count.ToString(), FontSize = 9, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = accent }
        });
        chip.Child = chipStack;
        var capturedWsId = ws.Id;
        chip.MouseLeftButtonDown += (s, e) => { e.Handled = true; ToggleWorkspaceCollapse(capturedWsId); };
        row.Children.Add(chip);

        if (collapsed)
        {
            var activeMember = members.Find(t => t.Id == _activeTabId);
            if (activeMember != null)
                row.Children.Add(new TextBlock
                {
                    Text = activeMember.Title, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 4, 0),
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading")
                });
        }
        else
        {
            foreach (var t in members)
                row.Children.Add(BuildTabPill(t));
        }

        var dismiss = new Border
        {
            Width = 22, Height = 22, CornerRadius = new CornerRadius(11), Cursor = Cursors.Hand,
            Margin = new Thickness(4, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center,
            Background = Brushes.Transparent, ToolTip = $"Dismiss {ws.Label} to the workspace box"
        };
        var dismissIcon = new System.Windows.Shapes.Path
        {
            Data = (Geometry)FindResource("Icon.Undo2"), Stroke = (Brush)FindResource("Brush.Text.Dim"),
            Width = 12, Height = 12, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Stretch = Stretch.Uniform, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round,
            StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Fill = Brushes.Transparent
        };
        dismiss.Child = dismissIcon;
        dismiss.MouseLeftButtonDown += (s, e) => { e.Handled = true; StashWorkspace(capturedWsId); };
        dismiss.MouseEnter += (s, e) => { dismiss.Background = new SolidColorBrush(accentColor) { Opacity = 0.14 }; dismissIcon.Stroke = accent; };
        dismiss.MouseLeave += (s, e) => { dismiss.Background = Brushes.Transparent; dismissIcon.Stroke = (Brush)FindResource("Brush.Text.Dim"); };
        row.Children.Add(dismiss);

        wrapper.Child = row;
        return wrapper;
    }

    private void ToggleWorkspaceCollapse(string workspaceId)
    {
        if (!_collapsedWorkspaces.Remove(workspaceId)) _collapsedWorkspaces.Add(workspaceId);
        RenderTabStrip();
    }

    private void StashWorkspace(string workspaceId)
    {
        _stashedWorkspaces.Add(workspaceId);
        _collapsedWorkspaces.Remove(workspaceId);

        // If the tab you were looking at just got parked, fall back to Home
        // rather than leaving the document host pointed at a hidden tab.
        var active = _tabs.Find(t => t.Id == _activeTabId);
        if (active != null && active.WorkspaceId == workspaceId)
            SelectTab(_tabs.First(t => t.IsHome).Id);
        else
            RenderTabStrip();
    }

    private void RestoreWorkspace(string workspaceId)
    {
        _stashedWorkspaces.Remove(workspaceId);
        _collapsedWorkspaces.Remove(workspaceId);
        RenderTabStrip();
    }

    private void RenderWorkspaceBox()
    {
        BtnWorkspaceBox.Visibility = _stashedWorkspaces.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

        WorkspaceBoxPipsGrid.Children.Clear();
        WorkspaceBoxPipsGrid.ColumnDefinitions.Clear();
        WorkspaceBoxPipsGrid.RowDefinitions.Clear();
        for (int r = 0; r < 2; r++) WorkspaceBoxPipsGrid.RowDefinitions.Add(new RowDefinition());
        for (int c = 0; c < 2; c++) WorkspaceBoxPipsGrid.ColumnDefinitions.Add(new ColumnDefinition());
        for (int i = 0; i < AllWorkspaces.Length && i < 4; i++)
        {
            var pip = new Rectangle
            {
                Width = 8, Height = 8, Margin = new Thickness(1),
                Fill = (Brush)FindResource(AllWorkspaces[i].BrushKey),
                Opacity = _tabs.Any(t => t.WorkspaceId == AllWorkspaces[i].Id) ? 1.0 : 0.25
            };
            Grid.SetRow(pip, i / 2);
            Grid.SetColumn(pip, i % 2);
            WorkspaceBoxPipsGrid.Children.Add(pip);
        }

        WorkspaceBoxPanelList.Children.Clear();
        if (_stashedWorkspaces.Count == 0) return;

        foreach (var wsId in _stashedWorkspaces.ToList())
        {
            var ws = AllWorkspaces.FirstOrDefault(w => w.Id == wsId);
            if (ws == null) continue;
            int count = _tabs.Count(t => t.WorkspaceId == wsId);

            var row = new Grid { Margin = new Thickness(4, 4, 4, 4) };
            var stack = new StackPanel { Orientation = Orientation.Horizontal };
            stack.Children.Add(new Ellipse { Width = 8, Height = 8, Margin = new Thickness(0, 0, 8, 0), Fill = (Brush)FindResource(ws.BrushKey) });
            var textCol = new StackPanel();
            textCol.Children.Add(new TextBlock { Text = ws.Label, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 11, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading") });
            textCol.Children.Add(new TextBlock
            {
                Text = $"{count} tab{(count == 1 ? "" : "s")} · dismissed" + (ws.IsPrimary ? " · primary" : ""),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9, Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            stack.Children.Add(textCol);

            var restore = new TextBlock
            {
                Text = "Restore", Cursor = Cursors.Hand, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = (Brush)FindResource(ws.BrushKey)
            };
            var capturedId = wsId;
            restore.MouseLeftButtonDown += (s, e) => { e.Handled = true; RestoreWorkspace(capturedId); WorkspaceBoxPopup.IsOpen = false; };

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(stack, 0);
            Grid.SetColumn(restore, 1);
            grid.Children.Add(stack);
            grid.Children.Add(restore);
            row.Children.Add(grid);
            WorkspaceBoxPanelList.Children.Add(row);
        }
    }

    private Border BuildTabPill(TabDef t)
    {
        bool isActive = t.Id == _activeTabId;
        var accent = t.Dot ?? (Brush)FindResource("Brush.Accent.Primary");

        var border = new Border
        {
            CornerRadius = new CornerRadius(8, 8, 0, 0),
            Height = isActive ? 44 : 38,
            Margin = new Thickness(0, 0, 2, 0),
            Padding = new Thickness(16, 0, 16, 0),
            Cursor = Cursors.Hand,
            BorderThickness = new Thickness(0, 3, 0, 0),
            // Inactive fill is a 6%-opacity tint of Brush.Accent.Primary (#7C8CF0),
            // recomputed from that base hex per wpf-handoff/README.md's rule for
            // rgba-derived tints rather than an invented color.
            Background = isActive
                ? (Brush)FindResource("Brush.Bg.Panel")
                : new SolidColorBrush(Color.FromArgb(0x0F, 0x7C, 0x8C, 0xF0)),
            BorderBrush = isActive ? accent : Brushes.Transparent
        };

        var content = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

        if (isActive && t.Dot != null)
        {
            content.Children.Add(new Ellipse
            {
                Width = 8,
                Height = 8,
                Fill = accent,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center
            });
        }

        // Home is pinned first, outside every workspace — a house glyph
        // marks it, and it only grows a close button once something else is
        // open (Step 9 "Home" behavior).
        if (t.IsHome)
        {
            content.Children.Add(new System.Windows.Shapes.Path
            {
                Data = (Geometry)FindResource("Icon.Home"),
                Stroke = isActive ? (Brush)FindResource("Brush.Text.Muted") : (Brush)FindResource("Brush.Text.Dim"),
                Width = 12, Height = 12, Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center,
                Stretch = Stretch.Uniform, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round,
                StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Fill = Brushes.Transparent
            });
        }

        content.Children.Add(new TextBlock
        {
            Text = t.Title,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = isActive ? (double)FindResource("FontSize.15") : (double)FindResource("FontSize.14"),
            FontWeight = isActive ? (FontWeight)FindResource("FontWeight.Bold") : (FontWeight)FindResource("FontWeight.Regular"),
            Foreground = isActive ? (Brush)FindResource("Brush.Text.Heading") : (Brush)FindResource("Brush.Text.Muted"),
            VerticalAlignment = VerticalAlignment.Center
        });

        // Git #2319 — every chat row shows the real Feature it's anchored to, once resolved
        // (ResolveChatFeatureNumbersAsync). No badge at all when FeatureNumber is genuinely null
        // (a still-resolving lookup, a failed one, or an Epic-tier anchor with no Feature-tier
        // ancestor) — never a placeholder in its place.
        if (t.IsChat && t.FeatureNumber.HasValue)
        {
            content.Children.Add(new TextBlock
            {
                Text = $"⬡ #{t.FeatureNumber}",
                Margin = new Thickness(6, 0, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 10.5,
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = (Brush)FindResource("Brush.Text.Dim"),
                VerticalAlignment = VerticalAlignment.Center,
                ToolTip = "Feature this chat is anchored to"
            });
        }

        bool closable = !t.IsHome || _tabs.Count > 1;
        if (closable)
        {
            var close = new TextBlock
            {
                Text = "×",
                Margin = new Thickness(8, 0, 0, 0),
                FontSize = 13,
                Foreground = (Brush)FindResource("Brush.Text.Dim"),
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center
            };
            close.MouseLeftButtonDown += (s, e) => { e.Handled = true; CloseTab(t.Id); };
            close.MouseEnter += (s, e) => close.Foreground = (Brush)FindResource("Brush.Text.Heading");
            close.MouseLeave += (s, e) => close.Foreground = (Brush)FindResource("Brush.Text.Dim");
            content.Children.Add(close);
        }

        border.Child = content;
        border.MouseLeftButtonDown += (s, e) => SelectTab(t.Id);

        if (closable)
        {
            border.ContextMenu = BuildContextMenu(
                ("", "Close", () => CloseTab(t.Id), true, true),
                ("", "Close Others", () => CloseOtherTabs(t.Id), _tabs.Count(x => !x.IsHome) > 1, false)
            );
        }

        return border;
    }

    private void CloseOtherTabs(string keepId)
    {
        foreach (var id in _tabs.Where(x => !x.IsHome && x.Id != keepId).Select(x => x.Id).ToList())
            CloseTab(id);
    }

    // Shared right-click menu builder — used by tabs, build cards, and build
    // set headers. Every item here maps to a real action already wired
    // elsewhere (SelectTab/CloseTab/OpenBuildDetail/clipboard), nothing
    // decorative.
    // A null Label marks a separator (Icon/OnClick/Enabled/Destructive are
    // ignored for it) — lets a menu group related actions visually without a
    // second overload.
    private static (string? Icon, string? Label, Action? OnClick, bool Enabled, bool Destructive) MenuSep() => (null, null, null, true, false);

    private ContextMenu BuildContextMenu(params (string? Icon, string? Label, Action? OnClick, bool Enabled, bool Destructive)[] items)
    {
        var menu = new ContextMenu();
        foreach (var (icon, label, onClick, enabled, destructive) in items)
        {
            if (label == null)
            {
                menu.Items.Add(new Separator());
                continue;
            }

            var item = new MenuItem
            {
                Header = label,
                IsEnabled = enabled,
                Tag = destructive ? "Destructive" : null,
                Icon = new TextBlock
                {
                    Text = icon,
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 12,
                    Foreground = destructive
                        ? (Brush)FindResource("Brush.Alert.Danger.Border")
                        : (Brush)FindResource("Brush.Text.Muted")
                }
            };
            item.Click += (s, e) => onClick!();
            menu.Items.Add(item);
        }
        return menu;
    }

    private void SelectTab(string id)
    {
        var tab = _tabs.Find(t => t.Id == id);
        if (tab == null) return;

        // Opening a tab un-stashes and unfolds its workspace so you see it
        // arrive, per Step 9's "Routing" behavior. A no-op when the
        // workspace is already visible.
        if (tab.WorkspaceId != null)
        {
            _stashedWorkspaces.Remove(tab.WorkspaceId);
            _collapsedWorkspaces.Remove(tab.WorkspaceId);
        }

        _activeTabId = id;
        RenderTabStrip();

        HomeTabContent.Visibility = tab.IsHome ? Visibility.Visible : Visibility.Collapsed;
        ClaudeChatDock.Visibility = tab.IsChat ? Visibility.Visible : Visibility.Collapsed;
        GitDoctorDock.Visibility = tab.IsGitDoctor ? Visibility.Visible : Visibility.Collapsed;
        RepoHealthDock.Visibility = tab.IsRepoHealth ? Visibility.Visible : Visibility.Collapsed;
        LogViewerDock.Visibility = tab.IsLogViewer ? Visibility.Visible : Visibility.Collapsed;
        MarkdownViewerDock.Visibility = tab.IsMarkdownViewer ? Visibility.Visible : Visibility.Collapsed;
        GitMapDock.Visibility = tab.IsGitMap ? Visibility.Visible : Visibility.Collapsed;
        SettingsDock.Visibility = tab.IsSettings ? Visibility.Visible : Visibility.Collapsed;
        GitItemDock.Visibility = tab.IsGitItemDoc ? Visibility.Visible : Visibility.Collapsed;
        if (tab.IsSettings) RenderSettings();
        bool isStub = !tab.IsHome && !tab.IsChat && !tab.IsGitDoctor && !tab.IsRepoHealth && !tab.IsLogViewer && !tab.IsMarkdownViewer && !tab.IsGitMap && !tab.IsSettings && !tab.IsGitItemDoc;
        StubTabContent.Visibility = isStub ? Visibility.Visible : Visibility.Collapsed;
        if (isStub)
            StubTabContent.Text = tab.Title + " — nothing here yet";
        if (tab.IsChat)
            RenderClaudeChatContext(tab);
        if (tab.IsGitDoctor)
            _ = EnsureGitDoctorLoadedAsync();
        if (tab.IsRepoHealth)
            _ = EnsureRepoHealthLoadedAsync();
        if (tab.IsLogViewer)
            EnsureLogViewerLoaded();
        if (tab.IsMarkdownViewer)
            LoadMarkdownViewerTab(tab);
        if (tab.IsGitMap)
            _ = RenderGitMapDocAsync();
        if (tab.IsGitItemDoc)
        {
            GitItemDocTitleText.Text = tab.Title;
            RenderGitItemDoc(tab);
        }
    }

    // ── Markdown Viewer — Git #2211. Real OS file drag-and-drop onto the
    // document host: DataFormats.FileDrop, filtered to .md, each dropped file
    // opened as its own tab rendered through the ported MarkdownRenderer. A
    // non-.md file in the drop is a clean no-op (toast), not a silent error.
    private void DocumentHostGrid_DragEnter(object sender, DragEventArgs e)
    {
        bool hasMarkdown = e.Data.GetDataPresent(DataFormats.FileDrop) &&
            ((string[])e.Data.GetData(DataFormats.FileDrop)!).Any(f =>
                string.Equals(System.IO.Path.GetExtension(f), ".md", StringComparison.OrdinalIgnoreCase));
        e.Effects = hasMarkdown ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private void DocumentHostGrid_Drop(object sender, DragEventArgs e)
    {
        e.Handled = true;
        if (!e.Data.GetDataPresent(DataFormats.FileDrop)) return;

        var dropped = (string[])e.Data.GetData(DataFormats.FileDrop)!;
        var mdFiles = dropped.Where(f => string.Equals(System.IO.Path.GetExtension(f), ".md", StringComparison.OrdinalIgnoreCase)).ToList();

        if (mdFiles.Count == 0)
        {
            ToastEngine.Show("Markdown Viewer", "Only .md files can be opened here.", ToastKind.Info);
            return;
        }

        string? lastOpenedId = null;
        foreach (var path in mdFiles)
            lastOpenedId = OpenMarkdownFileTab(path);

        if (lastOpenedId != null)
            SelectTab(lastOpenedId);
    }

    private string OpenMarkdownFileTab(string path)
    {
        var existing = _tabs.Find(t => t.MdFilePath != null &&
            string.Equals(t.MdFilePath, path, StringComparison.OrdinalIgnoreCase));
        if (existing != null) return existing.Id;

        var tab = new TabDef(
            "md-" + Guid.NewGuid().ToString("N"),
            System.IO.Path.GetFileName(path),
            kind: TabKind.File,
            mdFilePath: path,
            dot: (Brush)FindResource("Brush.Ext.Md"));
        _tabs.Add(tab);
        return tab.Id;
    }

    private void LoadMarkdownViewerTab(TabDef tab)
    {
        MarkdownViewerFileNameText.Text = tab.Title;
        MarkdownViewerContentHost.Child = null;

        string content;
        try
        {
            content = File.ReadAllText(tab.MdFilePath!);
        }
        catch (Exception ex)
        {
            ToastEngine.Show("Markdown Viewer", $"Could not read {tab.Title}: {ex.Message}", ToastKind.Error);
            return;
        }

        var options = new MarkdownRenderer.RenderOptions
        {
            OnUrlClick = url => { try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { /* real navigation failure, nothing more this can do */ } },
            OnFileClick = _ => { },
            OnIssueClick = _ => { }
        };
        MarkdownViewerContentHost.Child = MarkdownRenderer.Render(content, options);
    }

    private void CloseTab(string id)
    {
        int idx = _tabs.FindIndex(t => t.Id == id);
        // Home is closable once something else is open, per Step 9 — only a
        // lone Home tab refuses to close.
        if (idx < 0 || (_tabs[idx].IsHome && _tabs.Count == 1)) return;

        // Git #2216 — "sessions persist per chat tab while the tab lives": once the tab is
        // actually gone, the real powershell.exe/cmd.exe backing it must go too.
        DisposeTerminalSessionsForTab(id);

        _tabs.RemoveAt(idx);

        if (_tabs.Count == 0)
        {
            // Closing the last tab resets to Home in its first-run state —
            // clear tool belts (none exist yet to clear), workspace collapse
            // and stash state.
            _collapsedWorkspaces.Clear();
            _stashedWorkspaces.Clear();
            _tabs.Add(new TabDef("home", "Home", isHome: true));
            SelectTab("home");
            return;
        }

        if (_activeTabId == id)
        {
            var fallback = idx - 1 >= 0 && idx - 1 < _tabs.Count ? _tabs[idx - 1] : _tabs[0];
            SelectTab(fallback.Id);
        }
        else
        {
            RenderTabStrip();
        }
    }

    // ── Build Queue panel body — grouped Build Set cards, each a vertical
    // timeline of build cards. This is the same mechanism BuildConsole's own
    // Controls/BuildQueuePanel.xaml.cs (BuildQueueCard) already proved out —
    // a status pill switched per state, an issue-number badge, a
    // model/effort badge — ported onto ShaneBuilder's own App-Shell-v2 theme
    // tokens (Brush.Status.* / Brush.NextUp.*) instead of BuildConsole's
    // Catppuccin one, per this project's "use the theme already here" rule.
    // _queueItems starts empty and is filled asynchronously from a real bt_build_queue read
    // (LoadQueueFromDatabaseAsync, Git #2413) — RenderQueue's own empty state covers the window
    // before that first read lands, and the honest "no DB" case if it never does.
    private sealed class QueueItem
    {
        public string Id { get; }
        public string Title { get; }
        public string BuildSet { get; }
        public string Status { get; }
        public int? GithubNumber { get; }
        public string? Model { get; }
        public string? Effort { get; }
        public string? Branch { get; }
        public string? BuildId { get; }
        public IReadOnlyList<int> Blocks { get; }
        public IReadOnlyList<(int Num, string StatusLabel, string? CrossSet)> BlockedBy { get; }
        public IReadOnlyList<(string Label, bool Done)> Checklist { get; }
        // Git #2308 — real propagation from the Epic panel's own Park/Pause actions (#2307),
        // via the same GitEpicPanelService.OverlayParkPauseAsync overlay Git Map and the
        // Command Palette already call. Mutable (not init) so it can be set AFTER construction
        // once the overlay resolves, without rebuilding the whole row.
        public bool IsParked { get; set; }
        public bool IsPaused { get; set; }

        public QueueItem(string id, string title, string buildSet, string status,
            int? githubNumber = null, string? model = null, string? effort = null,
            string? branch = null, string? buildId = null,
            IReadOnlyList<int>? blocks = null,
            IReadOnlyList<(int, string, string?)>? blockedBy = null,
            IReadOnlyList<(string, bool)>? checklist = null)
        {
            Id = id;
            Title = title;
            BuildSet = buildSet;
            Status = status;
            GithubNumber = githubNumber;
            Model = model;
            Effort = effort;
            Branch = branch;
            BuildId = buildId;
            Blocks = blocks ?? Array.Empty<int>();
            BlockedBy = blockedBy ?? Array.Empty<(int, string, string?)>();
            Checklist = checklist ?? Array.Empty<(string, bool)>();
        }
    }

    private readonly List<QueueItem> _queueItems = new();
    private readonly HashSet<string> _expandedSets = new();

    // A chat reference pill per build set. Real chat linking isn't built yet, so this stays
    // empty (LoadQueueFromDatabaseAsync never populates it) — BuildSetCard hides the pill
    // entirely when a set has no entry here.
    private readonly Dictionary<string, string> _buildSetChatRefs = new();

    private void RenderQueue()
    {
        QueueSetsHost.Children.Clear();
        var visible = GetFsFilteredQueueItems();

        QueueEmptyText.Visibility = visible.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        QueueEmptyText.Text = _queueItems.Count == 0
            ? "No builds in the queue yet."
            : "No builds match the current Filter Studio facets.";

        foreach (var group in visible.GroupBy(q => q.BuildSet))
            QueueSetsHost.Children.Add(BuildSetCard(group.Key, group.ToList()));

        RenderStatusBar();
    }

    // ── Status bar — 23px, per README's spec: flat "Label: N" segments
    // colored per status, dimmed to 40% opacity when the count is zero, with
    // a right-hand hover flyout listing the matching builds (skipped
    // entirely for empty segments — nothing meaningful to show). Rebuilt
    // from real _queueItems counts every time RenderQueue runs.
    private static readonly (string Label, string Status)[] StatusBarSegmentDefs =
    {
        ("Parked", "Parked"),
        ("In-Flight", "Running"),
        ("Queued", "Queued"),
        ("Blocked", "Blocked"),
        ("Verifying", "Verifying"),
        ("Failed", "Failed"),
        ("Done", "Done"),
        ("Cancelled", "Cancelled")
    };

    private void RenderStatusBar()
    {
        StatusBarHost.Children.Clear();
        foreach (var (label, status) in StatusBarSegmentDefs)
        {
            var items = _queueItems.Where(i => i.Status == status).ToList();
            StatusBarHost.Children.Add(StatusBarSegment(label, status, items));
        }
    }

    private UIElement StatusBarSegment(string label, string status, List<QueueItem> items)
    {
        var accent = StatusBrush(status);
        var border = new Border
        {
            Padding = new Thickness(10, 0, 10, 0),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(0, 0, 1, 0),
            Child = new TextBlock
            {
                Text = $"{label}: {items.Count}",
                VerticalAlignment = VerticalAlignment.Center,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = (double)FindResource("FontSize.11"),
                Foreground = accent,
                Opacity = items.Count > 0 ? 1.0 : 0.4
            }
        };

        if (items.Count == 0)
            return border;

        border.Cursor = Cursors.Hand;

        var flyoutList = new StackPanel { Margin = new Thickness(6) };
        flyoutList.Children.Add(new TextBlock
        {
            Text = $"{label.ToUpperInvariant()}: {items.Count}",
            Margin = new Thickness(0, 0, 0, 6),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        foreach (var item in items)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            if (item.GithubNumber.HasValue)
            {
                row.Children.Add(new TextBlock
                {
                    Text = $"#{item.GithubNumber.Value}",
                    Margin = new Thickness(0, 0, 8, 0),
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                    Foreground = (Brush)FindResource("Brush.Accent.IssueNum")
                });
            }
            row.Children.Add(new TextBlock
            {
                Text = item.Title,
                TextTrimming = TextTrimming.CharacterEllipsis,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Primary")
            });
            flyoutList.Children.Add(row);
        }

        // A hand-managed Popup toggled on MouseEnter/MouseLeave flickered badly
        // here — WPF's own ToolTip already solves hover-show/hide without that,
        // and happily hosts arbitrary content, so it replaces the Popup outright.
        var tooltip = new ToolTip
        {
            Placement = PlacementMode.Top,
            HasDropShadow = true,
            Background = (Brush)FindResource("Brush.Bg.Card"),
            BorderBrush = (Brush)FindResource("Brush.Border.Popover"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(0),
            Content = new Border
            {
                MinWidth = 230,
                MaxWidth = 300,
                MaxHeight = 260,
                Child = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = flyoutList }
            }
        };
        ToolTipService.SetInitialShowDelay(border, 150);
        ToolTipService.SetBetweenShowDelay(border, 0);
        border.ToolTip = tooltip;

        return border;
    }

    // Each known build set gets its own Brush.Epic.* accent (same tokens
    // Section 5 of Colors.xaml already defines for exactly this purpose);
    // an unrecognized/"Ungrouped" set falls back to the neutral Archived
    // accent rather than inventing a new color.
    private Brush AccentForBuildSet(string setName) => (Brush)FindResource(setName switch
    {
        "ShaneBuilder" => "Brush.Epic.BuildConsole",
        "App Core" => "Brush.Epic.AppCore",
        "Config-State-Core" => "Brush.Epic.AppCore",
        "Portal" => "Brush.Epic.Portal",
        "Marketing" => "Brush.Epic.Marketing",
        "Admin Panel" => "Brush.Epic.AdminPanel",
        "Portal Admin" => "Brush.Epic.PortalAdmin",
        "Gate" => "Brush.Epic.Gate",
        _ => "Brush.Epic.Archived"
    });

    private static Brush Tint(Brush accent, byte alpha) =>
        accent is SolidColorBrush solid
            ? new SolidColorBrush(Color.FromArgb(alpha, solid.Color.R, solid.Color.G, solid.Color.B))
            : accent;

    // Collapsed-by-default Build Set card: colored tile + name + task-count
    // pill, an optional chat-reference pill, and a bold "N queued, N
    // in-flight, N verifying" stat line — all tinted from one accent color
    // via AccentForBuildSet/Tint. Clicking the header expands/collapses the
    // per-item timeline below it (hidden while collapsed, not just scrolled
    // past — matches the mockup's own s.open gate). "In-flight" is Shane's
    // own term for what the mockup calls "running."
    private Border BuildSetCard(string setName, List<QueueItem> items)
    {
        var accent = AccentForBuildSet(setName);
        bool expanded = _expandedSets.Contains(setName);
        int queued = items.Count(i => i.Status == "Queued");
        int inFlight = items.Count(i => i.Status == "Running");
        int verifying = items.Count(i => i.Status == "Verifying");
        _buildSetChatRefs.TryGetValue(setName, out var chatRef);

        var outer = new Border
        {
            CornerRadius = new CornerRadius(12),
            Background = (Brush)FindResource("Brush.Bg.Card"),
            BorderBrush = Tint(accent, 0x73),
            BorderThickness = new Thickness(2),
            Margin = new Thickness(0, 0, 0, 10),
            Effect = new DropShadowEffect { Color = Colors.Black, BlurRadius = 20, ShadowDepth = 6, Opacity = 0.35 }
        };

        var body = new StackPanel();

        var header = new Border
        {
            Background = Tint(accent, 0x22),
            BorderBrush = Tint(accent, 0x66),
            BorderThickness = new Thickness(0, 0, 0, expanded ? 1 : 0),
            Padding = new Thickness(12, 10, 12, 10),
            Cursor = Cursors.Hand
        };

        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var tile = new Border
        {
            Width = 26,
            Height = 26,
            CornerRadius = new CornerRadius(6),
            Background = accent,
            Margin = new Thickness(0, 0, 10, 0),
            VerticalAlignment = VerticalAlignment.Top,
            Child = new TextBlock
            {
                Text = "",
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 12,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            }
        };
        Grid.SetColumn(tile, 0);
        headerGrid.Children.Add(tile);

        var mid = new StackPanel();
        var nameRow = new StackPanel { Orientation = Orientation.Horizontal };
        nameRow.Children.Add(new TextBlock
        {
            Text = setName.ToUpperInvariant(),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = (double)FindResource("FontSize.12"),
            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
            Foreground = (Brush)FindResource("Brush.Text.Heading"),
            VerticalAlignment = VerticalAlignment.Center
        });
        nameRow.Children.Add(new Border
        {
            Margin = new Thickness(8, 0, 0, 0),
            Padding = new Thickness(6, 1, 6, 1),
            CornerRadius = new CornerRadius(4),
            Background = Tint(accent, 0x33),
            Child = new TextBlock
            {
                Text = $"{items.Count} task{(items.Count == 1 ? "" : "s")}",
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.10"),
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = accent
            }
        });
        mid.Children.Add(nameRow);

        if (chatRef != null)
        {
            mid.Children.Add(new Border
            {
                Margin = new Thickness(0, 4, 0, 0),
                Padding = new Thickness(6, 1, 6, 1),
                CornerRadius = new CornerRadius(4),
                HorizontalAlignment = HorizontalAlignment.Left,
                Background = Tint(accent, 0x26),
                BorderBrush = Tint(accent, 0x66),
                BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = chatRef,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                    FontSize = (double)FindResource("FontSize.9"),
                    FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
                    Foreground = accent
                }
            });
        }

        mid.Children.Add(new TextBlock
        {
            Text = $"{queued} queued, {inFlight} in-flight, {verifying} verifying",
            Margin = new Thickness(0, 4, 0, 0),
            TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = (double)FindResource("FontSize.15"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });
        Grid.SetColumn(mid, 1);
        headerGrid.Children.Add(mid);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Top };
        var deployBtn = new TextBlock
        {
            Text = "",
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 12,
            Margin = new Thickness(0, 0, 10, 0),
            Foreground = (Brush)FindResource("Brush.Text.Muted"),
            Cursor = Cursors.Hand,
            ToolTip = "Deploy to Staging"
        };
        deployBtn.MouseLeftButtonDown += (s, e) => { e.Handled = true; };
        actions.Children.Add(deployBtn);

        var chevron = new TextBlock
        {
            Text = "",
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 12,
            Foreground = (Brush)FindResource("Brush.Text.Muted"),
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = new RotateTransform(expanded ? 90 : 0)
        };
        actions.Children.Add(chevron);
        Grid.SetColumn(actions, 2);
        headerGrid.Children.Add(actions);

        header.Child = headerGrid;
        header.MouseLeftButtonDown += (s, e) =>
        {
            if (!_expandedSets.Remove(setName))
                _expandedSets.Add(setName);
            RenderQueue();
        };
        var allSets = _queueItems.Select(i => i.BuildSet).Distinct().ToList();
        bool allExpanded = allSets.Count > 0 && allSets.All(_expandedSets.Contains);

        header.ContextMenu = BuildContextMenu(
            (expanded ? "" : "", expanded ? "Collapse" : "Expand", () => { if (!_expandedSets.Remove(setName)) _expandedSets.Add(setName); RenderQueue(); }, true, false),
            MenuSep(),
            (allExpanded ? "" : "", allExpanded ? "Collapse All Sets" : "Expand All Sets",
                () => { if (allExpanded) _expandedSets.Clear(); else foreach (var s in allSets) _expandedSets.Add(s); RenderQueue(); }, true, false),
            MenuSep(),
            ("", "Copy Set Name", () => Clipboard.SetText(setName), true, false)
        );
        body.Children.Add(header);

        if (expanded)
        {
            var timeline = new StackPanel { Margin = new Thickness(12, 10, 12, 10) };
            for (int i = 0; i < items.Count; i++)
                timeline.Children.Add(TimelineRow(items[i], isFirst: i == 0, isLast: i == items.Count - 1));
            body.Children.Add(timeline);
        }

        outer.Child = body;
        return outer;
    }

    // Per-status (fg, bg, border) triple. Where Colors.xaml section 7
    // (Brush.NextUp.*) already has an exact triple for a status, use it
    // verbatim — those turned out to be byte-for-byte the same palette this
    // card wants. Everywhere else there's only a single flat color in
    // section 6 (Brush.Status.*), so the bg/border are derived tints of it
    // via Tint(), same rule as everywhere else in this file.
    private (Brush Fg, Brush Bg, Brush Border) StatusPalette(string status)
    {
        switch (status)
        {
            case "Blocked":
                return ((Brush)FindResource("Brush.NextUp.Blocked.Fg"), (Brush)FindResource("Brush.NextUp.Blocked.Bg"), (Brush)FindResource("Brush.NextUp.Blocked.Border"));
            case "Failed":
                return ((Brush)FindResource("Brush.NextUp.Failed.Fg"), (Brush)FindResource("Brush.NextUp.Failed.Bg"), (Brush)FindResource("Brush.NextUp.Failed.Border"));
            case "Cancelled":
                return ((Brush)FindResource("Brush.NextUp.Canceled.Fg"), (Brush)FindResource("Brush.NextUp.Canceled.Bg"), (Brush)FindResource("Brush.NextUp.Canceled.Border"));
            case "Parked":
                return ((Brush)FindResource("Brush.NextUp.Parked.Fg"), (Brush)FindResource("Brush.NextUp.Parked.Bg"), (Brush)FindResource("Brush.NextUp.Parked.Border"));
            case "Queued":
                return ((Brush)FindResource("Brush.NextUp.NoBuild.Fg"), (Brush)FindResource("Brush.NextUp.NoBuild.Bg"), (Brush)FindResource("Brush.NextUp.NoBuild.Border"));
            default:
                var accent = StatusBrush(status);
                return (accent, Tint(accent, 0x26), Tint(accent, 0x88));
        }
    }

    // Maps a queue item's status to this app's own Build/Queue Status Colors
    // (Colors.xaml section 6) rather than any hardcoded hex — "Crashed" is
    // used for a failed build since the App-Shell-v2 palette collapsed
    // BuildConsole's separate failed/crashed distinction into one bucket.
    private Brush StatusBrush(string status) => (Brush)FindResource(status switch
    {
        "Running" => "Brush.Status.Running",
        "Blocked" => "Brush.Status.Blocked",
        "Verifying" => "Brush.Status.Verifying",
        "Done" => "Brush.Status.Done",
        "Failed" => "Brush.Status.Crashed",
        "Cancelled" => "Brush.Status.Cancelled",
        "Parked" => "Brush.Status.Parked",
        "Capped" => "Brush.Status.Capped",
        "External" => "Brush.Status.External",
        "Tests" => "Brush.Status.Tests",
        _ => "Brush.Status.Queued"
    });

    // A short glyph shown both inside the status pill and inside the
    // timeline node for that same status — real, documented Segoe MDL2
    // Assets codepoints, not guesses (Lock/Play/CheckMark/Warning/Pause/
    // Clock/Cancel are all standard glyphs already used elsewhere in this
    // codebase's Segoe MDL2 usage).
    private string? StatusIconGlyph(string status) => status switch
    {
        "Blocked" => "",   // Lock
        "Running" => "",   // Play
        "Done" => "",      // CheckMark
        "Failed" => "",    // Warning
        "Parked" => "",    // Pause
        "Queued" => "",    // Clock
        "Cancelled" => "", // Cancel
        _ => null
    };

    // One row of the Build Set's expanded timeline: a left-hand connector
    // column (rail line + a status-colored node with its status icon + a
    // short branch label) beside the card itself, per the reference
    // screenshot's lock-node-and-rail treatment.
    private Grid TimelineRow(QueueItem item, bool isFirst, bool isLast)
    {
        var (fg, _, border) = StatusPalette(item.Status);

        var row = new Grid { Margin = new Thickness(0, 0, 0, 4) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(30) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var nodeColumn = new Grid();
        nodeColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        nodeColumn.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // Continuous rail line behind the node, spanning the full row height.
        nodeColumn.Children.Add(new Border
        {
            Width = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
            Background = (Brush)FindResource("Brush.Border.Hover"),
            Visibility = isFirst && isLast ? Visibility.Collapsed : Visibility.Visible
        });
        Grid.SetRowSpan(nodeColumn.Children[^1], 2);

        var nodeStack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        var node = new Border
        {
            Width = 22,
            Height = 22,
            CornerRadius = new CornerRadius(11),
            Background = (Brush)FindResource("Brush.Bg.Card"),
            BorderBrush = fg,
            BorderThickness = new Thickness(2)
        };
        string? glyph = StatusIconGlyph(item.Status);
        if (glyph != null)
        {
            node.Child = new TextBlock
            {
                Text = glyph,
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 10,
                Foreground = fg,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
        }
        nodeStack.Children.Add(node);

        if (item.Branch != null)
        {
            string shortBranch = item.Branch.Split('/')[0];
            nodeStack.Children.Add(new TextBlock
            {
                Text = shortBranch,
                Margin = new Thickness(0, 3, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Center,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = 8,
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
        }
        Grid.SetRow(nodeStack, 0);
        nodeColumn.Children.Add(nodeStack);

        Grid.SetColumn(nodeColumn, 0);
        row.Children.Add(nodeColumn);

        var card = BuildQueueCard(item);
        Grid.SetColumn(card, 1);
        row.Children.Add(card);

        return row;
    }

    // Individual build card — matches the reference screenshot layout:
    // avatar placeholder + status pill + issue# + branch + model +
    // blocked-by/blocks chips (wrapping), title, a segmented progress bar
    // with its checklist, and a Prerequisites footer. No real avatar
    // identity exists yet, so that circle is a plain placeholder, not a
    // fabricated name/image.
    private Border BuildQueueCard(QueueItem item)
    {
        var (fg, bg, border) = StatusPalette(item.Status);

        var card = new Border
        {
            CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Bg.Card"),
            BorderBrush = border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
            Cursor = Cursors.Hand
        };
        card.MouseLeftButtonDown += (s, e) => OpenBuildDetail(item);
        card.ContextMenu = BuildContextMenu(
            ("", "Open Detail", () => OpenBuildDetail(item), true, false),
            MenuSep(),
            ("", "Copy Issue #", () => Clipboard.SetText(item.GithubNumber.HasValue ? $"#{item.GithubNumber.Value}" : item.Id), item.GithubNumber.HasValue, false),
            ("", "Copy Branch", () => Clipboard.SetText(item.Branch ?? ""), item.Branch != null, false),
            ("", "Copy Title", () => Clipboard.SetText(item.Title), true, false)
        );

        var stack = new StackPanel();

        var badges = new WrapPanel { Margin = new Thickness(0, 0, 0, 6) };

        badges.Children.Add(new Ellipse
        {
            Width = 18,
            Height = 18,
            Margin = new Thickness(0, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Fill = (Brush)FindResource("Brush.Bg.Chip"),
            Stroke = (Brush)FindResource("Brush.Border.Default"),
            StrokeThickness = 1
        });

        badges.Children.Add(StatusPill(item.Status, fg, bg, border));

        // Git #2308 — real propagation from the Epic panel's own Park/Pause actions (#2307),
        // same overlay Git Map and the Command Palette already show.
        if (item.IsParked)
        {
            var parkedAccent = (Brush)FindResource("Brush.Status.Parked");
            badges.Children.Add(Chip("PARKED", parkedAccent, Tint(parkedAccent, 0x22), Tint(parkedAccent, 0x66)));
        }
        if (item.IsPaused)
        {
            var pausedAccent = (Brush)FindResource("Brush.Status.Paused");
            badges.Children.Add(Chip("PAUSED", pausedAccent, Tint(pausedAccent, 0x22), Tint(pausedAccent, 0x66)));
        }

        if (item.GithubNumber.HasValue)
        {
            var issueAccent = (Brush)FindResource("Brush.Accent.IssueNum");
            badges.Children.Add(Chip($"#{item.GithubNumber.Value}", issueAccent, Tint(issueAccent, 0x22), Tint(issueAccent, 0x66), largeFont: true));
        }

        if (item.Branch != null)
            badges.Children.Add(BranchChip(item.Branch));

        string? modelEffort = item.Model != null && item.Effort != null ? $"{item.Model} · {item.Effort}"
            : item.Model ?? item.Effort;
        if (modelEffort != null)
            badges.Children.Add(Chip(modelEffort, (Brush)FindResource("Brush.Text.Muted"), (Brush)FindResource("Brush.Bg.Chip"), (Brush)FindResource("Brush.Border.Default")));

        if (item.BlockedBy.Count > 0)
        {
            var blockedFg = (Brush)FindResource("Brush.NextUp.Blocked.Fg");
            var blockedBg = (Brush)FindResource("Brush.NextUp.Blocked.Bg");
            var blockedBorder = (Brush)FindResource("Brush.NextUp.Blocked.Border");
            badges.Children.Add(Chip("blocked by " + string.Join(" ", item.BlockedBy.Select(b => $"#{b.Num}")), blockedFg, blockedBg, blockedBorder));
        }

        if (item.Blocks.Count > 0)
        {
            var gateAccent = (Brush)FindResource("Brush.Gate.Accent");
            badges.Children.Add(Chip("blocks " + string.Join(" ", item.Blocks.Select(n => $"#{n}")), gateAccent, Tint(gateAccent, 0x22), Tint(gateAccent, 0x66)));
        }

        stack.Children.Add(badges);

        var titleRow = new DockPanel();
        var titleText = new TextBlock
        {
            Text = item.Title,
            TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.12"),
            FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        };
        titleRow.Children.Add(titleText);
        if (item.BuildId != null)
        {
            var buildIdText = new TextBlock
            {
                Text = item.BuildId,
                Margin = new Thickness(8, 0, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = (double)FindResource("FontSize.10"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            };
            DockPanel.SetDock(buildIdText, Dock.Right);
            titleRow.Children.Add(buildIdText);
        }
        stack.Children.Add(titleRow);

        if (item.Checklist.Count > 0)
            stack.Children.Add(ProgressSection(item.Checklist));

        if (item.BlockedBy.Count > 0)
            stack.Children.Add(PrerequisitesFooter(item.BlockedBy));

        card.Child = stack;
        return card;
    }

    private Border BranchChip(string branch)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(new TextBlock
        {
            Text = "", // git-branch glyph (reusing the rail's Git icon)
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 9,
            Margin = new Thickness(0, 0, 4, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("Brush.Accent.Active")
        });
        row.Children.Add(new TextBlock
        {
            Text = branch,
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = (double)FindResource("FontSize.9"),
            Foreground = (Brush)FindResource("Brush.Text.Muted")
        });

        return new Border
        {
            Background = (Brush)FindResource("Brush.Bg.Chip"),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 1, 6, 1),
            Margin = new Thickness(0, 0, 6, 4),
            Child = row,
            ToolTip = "Git branch"
        };
    }

    private StackPanel ProgressSection(IReadOnlyList<(string Label, bool Done)> checklist)
    {
        int done = checklist.Count(c => c.Done);
        var section = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };

        var labelRow = new DockPanel { Margin = new Thickness(0, 0, 0, 4) };
        labelRow.Children.Add(new TextBlock
        {
            Text = "PROGRESS",
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.9.5"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        var fraction = new TextBlock
        {
            Text = $"{done} / {checklist.Count} steps",
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = (double)FindResource("FontSize.9.5"),
            Foreground = (Brush)FindResource("Brush.Text.Muted")
        };
        DockPanel.SetDock(fraction, Dock.Right);
        labelRow.Children.Add(fraction);
        section.Children.Add(labelRow);

        var segments = new UniformGrid { Rows = 1, Columns = checklist.Count };
        for (int i = 0; i < checklist.Count; i++)
        {
            segments.Children.Add(new Border
            {
                Height = 4,
                Margin = new Thickness(i == 0 ? 0 : 1, 0, i == checklist.Count - 1 ? 0 : 1, 0),
                CornerRadius = new CornerRadius(2),
                Background = i < done ? (Brush)FindResource("Brush.Status.Done") : (Brush)FindResource("Brush.Border.Default")
            });
        }
        section.Children.Add(segments);

        var itemsPanel = new StackPanel { Margin = new Thickness(0, 7, 0, 0) };
        foreach (var (label, isDone) in checklist)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
            row.Children.Add(new TextBlock
            {
                Text = isDone ? "" : "", // CheckMark / RadioBtnOff
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 10,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = isDone ? (Brush)FindResource("Brush.Status.Done") : (Brush)FindResource("Brush.Text.Dim")
            });
            row.Children.Add(new TextBlock
            {
                Text = label,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = isDone ? (Brush)FindResource("Brush.Text.Muted") : (Brush)FindResource("Brush.Text.Dim")
            });
            itemsPanel.Children.Add(row);
        }
        section.Children.Add(itemsPanel);

        return section;
    }

    private Border PrerequisitesFooter(IReadOnlyList<(int Num, string StatusLabel, string? CrossSet)> blockedBy)
    {
        var blockedFg = (Brush)FindResource("Brush.NextUp.Blocked.Fg");
        var blockedBg = (Brush)FindResource("Brush.NextUp.Blocked.Bg");
        var blockedBorder = (Brush)FindResource("Brush.NextUp.Blocked.Border");

        var row = new WrapPanel();
        row.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(0, 0, 6, 4),
            Children =
            {
                new TextBlock
                {
                    Text = "", // Flag glyph
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 10,
                    Margin = new Thickness(0, 0, 4, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = blockedFg
                },
                new TextBlock
                {
                    Text = "Prerequisites:",
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                    FontSize = (double)FindResource("FontSize.10"),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                    Foreground = blockedFg,
                    VerticalAlignment = VerticalAlignment.Center
                }
            }
        });

        foreach (var (num, statusLabel, crossSet) in blockedBy)
        {
            var chipContent = new StackPanel { Orientation = Orientation.Horizontal };

            if (crossSet != null)
            {
                var crossAccent = AccentForBuildSet(crossSet);
                chipContent.Children.Add(new Border
                {
                    BorderBrush = new SolidColorBrush(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF)),
                    BorderThickness = new Thickness(0, 0, 1, 0),
                    Padding = new Thickness(0, 0, 6, 0),
                    Margin = new Thickness(0, 0, 6, 0),
                    Child = new TextBlock
                    {
                        Text = crossSet.ToUpperInvariant(),
                        FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                        FontSize = 9,
                        FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                        Foreground = crossAccent
                    }
                });
            }

            chipContent.Children.Add(new TextBlock
            {
                Text = $"#{num} ({statusLabel})",
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = (double)FindResource("FontSize.10"),
                Foreground = blockedFg
            });

            row.Children.Add(new Border
            {
                Background = blockedBg,
                BorderBrush = blockedBorder,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 1, 8, 1),
                Margin = new Thickness(0, 0, 6, 4),
                Child = chipContent
            });
        }

        return new Border
        {
            Margin = new Thickness(0, 10, 0, 0),
            Padding = new Thickness(0, 8, 0, 0),
            BorderThickness = new Thickness(0, 1, 0, 0),
            BorderBrush = new SolidColorBrush(Color.FromArgb(0x0D, 0xFF, 0xFF, 0xFF)),
            Child = row
        };
    }

    // Shane's own term for the "Running" status is "In-Flight" — the
    // internal QueueItem.Status value stays "Running" (that's the data),
    // only the displayed label changes here.
    private string StatusDisplayLabel(string status) => status == "Running" ? "IN-FLIGHT" : status.ToUpperInvariant();

    private Border StatusPill(string status, Brush fg, Brush bg, Brush border)
    {
        return new Border
        {
            Background = bg,
            BorderBrush = border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 1, 6, 1),
            Margin = new Thickness(0, 0, 6, 4),
            Child = new TextBlock
            {
                Text = StatusDisplayLabel(status),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.9.5"),
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = fg
            }
        };
    }

    private Border Chip(string text, Brush foreground, Brush background, Brush border, bool largeFont = false)
    {
        return new Border
        {
            Background = background,
            BorderBrush = border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 1, 6, 1),
            Margin = new Thickness(0, 0, 6, 4),
            Child = new TextBlock
            {
                Text = text,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = largeFont ? (double)FindResource("FontSize.13") : (double)FindResource("FontSize.9.5"),
                FontWeight = largeFont ? (FontWeight)FindResource("FontWeight.ExtraBold") : (FontWeight)FindResource("FontWeight.SemiBold"),
                Foreground = foreground
            }
        };
    }

    // ── Build detail flyout — slides out from the Build Queue panel's left
    // edge, per README's spec: 320px normal, expandable to fill the document
    // area, a Blocked banner, an Epic callout, and three collapsible
    // sections (Build Output / Description / Comments). Opened by clicking
    // any BuildQueueCard. No real log/description/comment backend exists
    // yet, so each section shows an honest empty state rather than invented
    // content — the chrome (collapse/expand, terminal styling) is real and
    // ready for when that data lands.
    private const double BuildDetailWidthNormal = 320;
    private QueueItem? _selectedBuildItem;
    private bool _buildDetailExpanded;
    private readonly Dictionary<string, bool> _buildDetailSectionOpen = new()
    {
        ["output"] = true,
        ["description"] = false
    };

    private void OpenBuildDetail(QueueItem item)
    {
        _selectedBuildItem = item;
        _buildDetailExpanded = false;
        RenderBuildDetail();
    }

    private void CloseBuildDetail()
    {
        _selectedBuildItem = null;
        RenderBuildDetail();
    }

    private void RenderBuildDetail()
    {
        var item = _selectedBuildItem;

        if (item == null)
        {
            BuildDetailColumn.Width = new GridLength(0);
            DocumentHostColumn.Width = new GridLength(1, GridUnitType.Star);
            return;
        }

        if (_buildDetailExpanded)
        {
            DocumentHostColumn.Width = new GridLength(0);
            BuildDetailColumn.Width = new GridLength(1, GridUnitType.Star);
        }
        else
        {
            DocumentHostColumn.Width = new GridLength(1, GridUnitType.Star);
            BuildDetailColumn.Width = new GridLength(BuildDetailWidthNormal);
        }

        BuildDetailNum.Text = item.GithubNumber.HasValue ? $"#{item.GithubNumber.Value}" : item.Id;

        var (fg, bg, border) = StatusPalette(item.Status);
        BuildDetailStatusHost.Children.Clear();
        BuildDetailStatusHost.Children.Add(StatusPill(item.Status, fg, bg, border));

        BuildDetailActions.Children.Clear();
        // Re-renders this same item's detail from current state — real once
        // there's a live backend to pull a fresh build from.
        BuildDetailActions.Children.Add(BuildDetailIconButton("", "Refresh", () => OpenBuildDetail(item)));
        BuildDetailActions.Children.Add(BuildDetailIconButton(
            _buildDetailExpanded ? "" : "", // BackToWindow / FullScreen
            _buildDetailExpanded ? "Retract to normal size" : "Expand to fill the document area",
            () => { _buildDetailExpanded = !_buildDetailExpanded; RenderBuildDetail(); }));
        BuildDetailActions.Children.Add(BuildDetailIconButton("", "Close", CloseBuildDetail)); // Cancel

        BuildDetailBody.Children.Clear();

        if (item.Status == "Blocked")
            BuildDetailBody.Children.Add(BlockedBanner(item));

        BuildDetailBody.Children.Add(EpicCallout(item));

        BuildDetailBody.Children.Add(CollapsibleDetailSection("output", "Build Output", "",
            () =>
            {
                var body = new StackPanel
                {
                    Background = (Brush)FindResource("Brush.Bg.Terminal")
                };
                body.Children.Add(new TextBlock
                {
                    Text = "No build output yet.",
                    Margin = new Thickness(14, 12, 14, 12),
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                    FontSize = (double)FindResource("FontSize.11"),
                    Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                return (FrameworkElement)body;
            }));

        BuildDetailBody.Children.Add(CollapsibleDetailSection("description", "Description", "",
            () => (FrameworkElement)new TextBlock
            {
                Text = "No description yet.",
                Margin = new Thickness(14, 12, 14, 12),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            }));

        BuildDetailBody.Children.Add(CommentsSection());
    }

    private Button BuildDetailIconButton(string glyph, string tooltip, Action onClick)
    {
        var btn = new Button
        {
            Style = (Style)FindResource("PanelCollapseButton"),
            Margin = new Thickness(4, 0, 0, 0),
            ToolTip = tooltip,
            Content = new TextBlock { Text = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 10 }
        };
        btn.Click += (s, e) => onClick();
        return btn;
    }

    private Border BlockedBanner(QueueItem item)
    {
        var danger = (Brush)FindResource("Brush.Alert.Danger.Border");
        var stack = new StackPanel();
        stack.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(0, 0, 0, 6),
            Children =
            {
                new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 14, Foreground = danger, Margin = new Thickness(0,0,8,0), VerticalAlignment = VerticalAlignment.Center }, // Warning
                new TextBlock { Text = "BLOCKED", FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10"), FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = danger, VerticalAlignment = VerticalAlignment.Center }
            }
        });
        stack.Children.Add(new TextBlock
        {
            Text = (item.GithubNumber.HasValue ? $"#{item.GithubNumber.Value} " : "") + item.Title,
            TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.13"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Heading")
        });
        if (item.BlockedBy.Count > 0)
        {
            stack.Children.Add(new TextBlock
            {
                Text = "Waiting on " + string.Join(", ", item.BlockedBy.Select(b => $"#{b.Num} ({b.StatusLabel})")) + ".",
                Margin = new Thickness(0, 5, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.11.5"),
                Foreground = danger
            });
        }

        return new Border
        {
            Margin = new Thickness(12, 12, 12, 12),
            Padding = new Thickness(14),
            CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Alert.Danger.Bg"),
            BorderBrush = danger,
            BorderThickness = new Thickness(1.5),
            Child = stack
        };
    }

    private Border EpicCallout(QueueItem item)
    {
        var accent = AccentForBuildSet(item.BuildSet);

        var row = new Grid { Cursor = Cursors.Hand };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var tile = new Border
        {
            Width = 22,
            Height = 22,
            CornerRadius = new CornerRadius(6),
            Background = accent,
            Margin = new Thickness(0, 0, 9, 0),
            Child = new TextBlock
            {
                Text = "", // reusing the rail's Git icon
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 11,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            }
        };
        Grid.SetColumn(tile, 0);
        row.Children.Add(tile);

        var mid = new StackPanel();
        mid.Children.Add(new TextBlock
        {
            Text = "EPIC",
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Muted")
        });
        mid.Children.Add(new TextBlock
        {
            Text = item.BuildSet,
            TextTrimming = TextTrimming.CharacterEllipsis,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.12.5"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Heading")
        });
        Grid.SetColumn(mid, 1);
        row.Children.Add(mid);

        var chevron = new TextBlock
        {
            Text = "", // ChevronRight
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 11,
            Foreground = (Brush)FindResource("Brush.Text.Muted"),
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(chevron, 2);
        row.Children.Add(chevron);

        return new Border
        {
            Margin = new Thickness(12, 0, 12, 12),
            Padding = new Thickness(12, 10, 12, 10),
            CornerRadius = new CornerRadius(8),
            Background = Tint(accent, 0x14),
            BorderBrush = Tint(accent, 0x55),
            BorderThickness = new Thickness(1),
            Child = row
        };
    }

    private Border CollapsibleDetailSection(string key, string title, string glyph, Func<FrameworkElement> buildBody)
    {
        bool isOpen = _buildDetailSectionOpen.TryGetValue(key, out var open) && open;
        return CollapsibleSection(title, glyph, isOpen, () =>
        {
            _buildDetailSectionOpen[key] = !isOpen;
            RenderBuildDetail();
        }, buildBody);
    }

    // Generic collapsible header + inline body — the same control used by
    // both the Build detail flyout's Build Output/Description sections and
    // the chat tab's stat detail rows below, so a Git issue listed there
    // gets the identical collapse/expand design, not a re-implementation.
    private Border CollapsibleSection(string title, string glyph, bool isOpen, Action onToggle, Func<FrameworkElement> buildBody)
    {
        var outer = new Border
        {
            Margin = new Thickness(12, 0, 12, 12),
            CornerRadius = new CornerRadius(8),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            ClipToBounds = true
        };
        var stack = new StackPanel();

        var header = new Border
        {
            Background = (Brush)FindResource("Brush.Bg.Panel"),
            Padding = new Thickness(12, 9, 12, 9),
            Cursor = Cursors.Hand
        };
        var headerRow = new DockPanel();
        headerRow.Children.Add(new TextBlock
        {
            Text = glyph,
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 11,
            Margin = new Thickness(0, 0, 7, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("Brush.Text.Muted")
        });
        var chev = new TextBlock
        {
            Text = "", // ChevronDown
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 10,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = new RotateTransform(isOpen ? 0 : -90)
        };
        DockPanel.SetDock(chev, Dock.Right);
        headerRow.Children.Add(chev);
        headerRow.Children.Add(new TextBlock
        {
            Text = title,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11.5"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });
        header.Child = headerRow;
        header.MouseLeftButtonDown += (s, e) => onToggle();
        stack.Children.Add(header);

        if (isOpen)
            stack.Children.Add(buildBody());

        outer.Child = stack;
        return outer;
    }

    private StackPanel CommentsSection()
    {
        var section = new StackPanel { Margin = new Thickness(12, 0, 12, 0) };
        section.Children.Add(new TextBlock
        {
            Text = "COMMENTS (0) · NEWEST FIRST",
            Margin = new Thickness(0, 0, 0, 6),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 10,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        section.Children.Add(new TextBlock
        {
            Text = "No comments yet.",
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        return section;
    }

    // ── Claude chat dock — the real claude.ai in ClaudeWebView plus the
    // chrome around it: a context bar with real epic stats, a Detected
    // Items flyout, and the Inspector check-in overlays. Per README items 6
    // and 9 — the site itself isn't rebuilt, only what surrounds it.

    // Context bar stats are real, drawn from _queueItems for the tab's own
    // BuildSet. There's no real token-usage source for the context-usage
    // fraction, so that stays a plain "— / 300k ctx" rather than a made-up
    // percentage.
    private string? _activeChatBuildSet;

    // ── Git #2209 real state model (§11) ─────────────────────────────────────────────────────
    // The tab currently bound to the chat document's chrome. The epic is DERIVED from it, never
    // stored twice — reading TabDef.EpicNumber off THIS is the §11 bug fix.
    private TabDef? _activeChatTab;

    // §8 — per-tab composer drafts, keyed by tab id. A single global draft breaks both the
    // tool-writes-to-composer pattern and the cross-epic flow, so this is a correctness
    // requirement, not a nicety. Populated/read only through the composer's own load+TextChanged.
    private readonly Dictionary<string, string> _chatDrafts = new();

    // §6 — dismissed detections (by stable Detection.Id) survive a re-render, per chat tab.
    private readonly Dictionary<string, HashSet<string>> _dismissedDetections = new();

    // §7 — live cross-epic questions in this session (real user-authored records, not fixture).
    private readonly List<CrossEpicQuestion> _crossEpicQuestions = new();

    // §5 — the rail tool remembered per chat tab (resolved open question #4: persist per tab).
    private readonly Dictionary<string, string> _openRailToolByTab = new();

    // The #2197 real read layer, lazily created once. Null when no DATABASE_URL is resolvable —
    // the Detected panel then states that honestly rather than faking an empty "nothing caught".
    private Services.ChatReadClient? _chatReadClient;
    private bool _chatReadClientResolved;
    private readonly Services.ChatGitHubFilter _chatGitHubFilter = new();

    // The live claude.ai conversation URL, tracked off CoreWebView2.SourceChanged so Share, Floaty
    // and the Detected pipe all key on the SAME conversation the WebView2 is actually showing.
    private string _currentConversationUrl = "https://claude.ai/";
    private bool _webViewWired;

    private Services.ChatReadClient? ResolveChatReadClient()
    {
        if (!_chatReadClientResolved)
        {
            try { _chatReadClient = Services.ChatReadClient.CreateFromEnvironment(); }
            catch (Exception ex)
            {
                Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.detect] read client resolve failed: {ex.Message}");
                _chatReadClient = null;
            }
            _chatReadClientResolved = true;
        }
        return _chatReadClient;
    }

    private void RenderClaudeChatContext(TabDef tab)
    {
        _activeChatBuildSet = tab.BuildSet;
        var items = tab.BuildSet != null ? _queueItems.Where(i => i.BuildSet == tab.BuildSet).ToList() : new List<QueueItem>();
        int verifying = items.Count(i => i.Status == "Verifying");
        int inFlight = items.Count(i => i.Status == "Running");
        int queued = items.Count(i => i.Status == "Queued");
        int blocked = items.Count(i => i.Status == "Blocked");
        int done = items.Count(i => i.Status == "Done");

        CtxStatVerifying.Text = $"{verifying} verifying";
        CtxStatInFlight.Text = $"{inFlight} in-flight";
        CtxStatQueued.Text = $"{queued} queued";
        CtxStatBlocked.Text = $"{blocked} blocked";
        CtxStatDone.Text = items.Count > 0 ? $"{done}/{items.Count} done" : "0/0 done";

        // §11 — epic DERIVED from the tab, set on every chrome surface at once so a tab switch can
        // never leave a stale "#1202" behind.
        _activeChatTab = tab;
        CtxEpicNum.Text = tab.EpicNumber.HasValue ? $"#{tab.EpicNumber}" : "#—";
        CrumbEpic.Text = tab.EpicNumber.HasValue ? $"Epic #{tab.EpicNumber}" : "Epic";
        CrumbChat.Text = tab.Title;

        // §8 — bind this tab's own draft into the composer (guard the load so setting .Text doesn't
        // re-save mid-load).
        _composerLoading = true;
        ChatComposer.Text = _chatDrafts.TryGetValue(tab.Id, out var draft) ? draft : "";
        _composerLoading = false;
        UpdateContextGauge();
        RenderComposerReturnBar();

        EnsureWebViewWired();
        CloseStatDetailPanel(); // stale filter after a re-render (e.g. switching chat tabs)

        if (_detectedItemsOpen)
            _ = RenderDetectedItemsAsync();

        // Git #2216 — the rail column stays open across a tab switch, but its CONTENT is
        // per-tab: repaint from (or lazily start) the newly-active tab's own session.
        if (_psOpen) RenderPsPanel();
        if (_terminalOpen) RenderTerminalPanel();
    }

    // Stat detail flyout — Shane's own addition, not in the original mockup:
    // clicking a context-bar stat opens this, the mirror image of the
    // Detected Items panel on the opposite (left) edge, listing the real
    // builds behind that count.
    private const double StatDetailWidthOpen = 280;

    private static readonly Dictionary<string, string> StatDetailLabels = new()
    {
        ["Verifying"] = "Verifying",
        ["Running"] = "In-Flight",
        ["Queued"] = "Queued",
        ["Blocked"] = "Blocked",
        ["Done"] = "Done"
    };

    private void CtxStat_Click(object sender, MouseButtonEventArgs e)
    {
        var status = (string)((FrameworkElement)sender).Tag;
        OpenStatDetailPanel(status);
    }

    private string? _statDetailStatus;
    private readonly Dictionary<string, bool> _statDetailItemOpen = new();

    private void OpenStatDetailPanel(string status)
    {
        _statDetailStatus = status;
        _statDetailItemOpen.Clear(); // fresh collapse state each time the filter changes
        StatDetailTitle.Text = StatDetailLabels.TryGetValue(status, out var label) ? label : status;
        RenderStatDetailResults();
        StatDetailColumn.Width = new GridLength(StatDetailWidthOpen);
    }

    private void RenderStatDetailResults()
    {
        var items = _activeChatBuildSet != null && _statDetailStatus != null
            ? _queueItems.Where(i => i.BuildSet == _activeChatBuildSet && i.Status == _statDetailStatus).ToList()
            : new List<QueueItem>();

        StatDetailResults.Children.Clear();

        if (items.Count == 0)
        {
            StatDetailResults.Children.Add(new TextBlock
            {
                Text = "Nothing in this state right now.",
                TextWrapping = TextWrapping.Wrap,
                FontStyle = FontStyles.Italic,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted")
            });
            return;
        }

        foreach (var item in items)
            StatDetailResults.Children.Add(StatDetailRow(item));
    }

    // Each Git issue is its own CollapsibleSection — the exact same
    // control the Build detail flyout uses for Build Output/Description —
    // collapsed by default, expanding inline to the real BuildQueueCard (the
    // same card design/control the Build Queue's own timeline renders), not
    // a separately-styled bubble.
    private Border StatDetailRow(QueueItem item)
    {
        bool isOpen = _statDetailItemOpen.TryGetValue(item.Id, out var open) && open;
        string title = item.GithubNumber.HasValue ? $"#{item.GithubNumber.Value} {item.Title}" : item.Title;

        return CollapsibleSection(title, "", isOpen, () =>
        {
            _statDetailItemOpen[item.Id] = !isOpen;
            RenderStatDetailResults();
        }, () => (FrameworkElement)new Border { Padding = new Thickness(0, 0, 0, 12), Child = BuildQueueCard(item) });
    }

    private void CloseStatDetailPanel_Click(object sender, MouseButtonEventArgs e) => CloseStatDetailPanel();

    private void CloseStatDetailPanel() => StatDetailColumn.Width = new GridLength(0);

    private const double DetectedItemsWidthOpen = 280;
    private bool _detectedItemsOpen;

    private void BtnToggleDetectedItems_Click(object sender, RoutedEventArgs e)
    {
        _detectedItemsOpen = !_detectedItemsOpen;
        DetectedItemsColumn.Width = new GridLength(_detectedItemsOpen ? DetectedItemsWidthOpen : 0);
        if (_detectedItemsOpen)
            _ = RenderDetectedItemsAsync();
    }

    private void DetectedRefresh_Click(object sender, MouseButtonEventArgs e) => _ = RenderDetectedItemsAsync();

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // Git #2209 §6 — Detected in this chat: real #2197 ChatDockData → grouped/loose Detection cards.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    private int _detectedRenderSeq;

    private HashSet<string> DismissedForActiveChat()
    {
        var key = _activeChatTab?.Id ?? "";
        if (!_dismissedDetections.TryGetValue(key, out var set))
        {
            set = new HashSet<string>();
            _dismissedDetections[key] = set;
        }
        return set;
    }

    private async Task RenderDetectedItemsAsync()
    {
        int seq = ++_detectedRenderSeq;
        DetectedItemsResults.Children.Clear();

        // Cross-epic pending-question cards ride at the top of this panel (§7) — they are local
        // session state, always available even with no DB.
        RenderCrossEpicCards();

        DetectedItemsResults.Children.Add(DetectedLoadingRow());

        var db = ResolveChatReadClient();
        Services.DetectionSnapshot snap;
        try
        {
            snap = await Services.ChatDetectionService.BuildAsync(db, _chatGitHubFilter, _currentConversationUrl);
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.detect] build failed: {ex.Message}");
            snap = Services.DetectionSnapshot.NoDataLayer;
        }

        if (seq != _detectedRenderSeq) return; // a newer refresh superseded this one

        DetectedItemsResults.Children.Clear();
        RenderCrossEpicCards();

        if (!snap.DataLayerAvailable)
        {
            DetectedItemsResults.Children.Add(DetectedNote(
                "No local database reachable (DATABASE_URL not resolvable), so mentioned issues and pinned questions can't be read. This is stated honestly — no rows are invented."));
            return;
        }

        if (!snap.GitHubReachable)
            DetectedItemsResults.Children.Add(DetectedNote(
                "GitHub was unreachable this pass — items are shown fail-closed (kept as still-relevant) rather than dropped."));

        var dismissed = DismissedForActiveChat();
        int shown = 0;

        foreach (var group in snap.Groups)
        {
            var visible = group.Items.Where(d => !dismissed.Contains(d.Id)).ToList();
            if (visible.Count == 0) continue;
            DetectedItemsResults.Children.Add(DetectedGroupHeader($"{group.Label} ({visible.Count})"));
            foreach (var d in visible) { DetectedItemsResults.Children.Add(DetectionCard(d)); shown++; }
        }

        var looseVisible = snap.Loose.Where(d => !dismissed.Contains(d.Id)).ToList();
        if (looseVisible.Count > 0)
        {
            DetectedItemsResults.Children.Add(DetectedGroupHeader($"Loose ({looseVisible.Count})"));
            foreach (var d in looseVisible) { DetectedItemsResults.Children.Add(DetectionCard(d)); shown++; }
        }

        if (shown == 0 && _crossEpicQuestions.All(q => q.FromTabId != (_activeChatTab?.Id ?? "")))
        {
            string reason = snap.PinnedQuestionsUnavailableReason != null
                ? "Nothing actionable yet. " + snap.PinnedQuestionsUnavailableReason
                : "Nothing caught yet — mentioned issues and pinned questions will surface here as they land.";
            DetectedItemsResults.Children.Add(DetectedNote(reason));
        }
    }

    private Border DetectionCard(Services.Detection d)
    {
        var outer = new Border
        {
            Margin = new Thickness(0, 0, 0, 8),
            CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Claude.Bg.Bubble"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
        };
        var stack = new StackPanel();

        // Type chip row (DetectionKind).
        var chipRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 5) };
        chipRow.Children.Add(DetectionKindChip(d.Kind));
        if (!string.IsNullOrWhiteSpace(d.BoardStatus))
            chipRow.Children.Add(DetectionMetaChip(d.BoardStatus!));
        if (d.StateUnknown)
            chipRow.Children.Add(DetectionMetaChip("state unknown"));
        stack.Children.Add(chipRow);

        stack.Children.Add(new TextBlock
        {
            Text = d.Title,
            TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });

        if (!string.IsNullOrWhiteSpace(d.Detail))
            stack.Children.Add(new TextBlock
            {
                Text = d.Detail,
                Margin = new Thickness(0, 3, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 9.5,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });

        // Actions — Promote to Queue / Dismiss (§6).
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 7, 0, 0) };
        actions.Children.Add(DetectionActionLink("Promote to Queue", (Brush)FindResource("Brush.Claude.Accent"),
            () => PromoteDetection(d)));
        actions.Children.Add(DetectionActionLink("Dismiss", (Brush)FindResource("Brush.Claude.Text.Muted"),
            () => { DismissedForActiveChat().Add(d.Id); _ = RenderDetectedItemsAsync(); }));
        stack.Children.Add(actions);

        outer.Child = stack;
        return outer;
    }

    private void PromoteDetection(Services.Detection d)
    {
        // "Promote to Queue" stages a real, queue-ready build prompt into the composer — it never
        // auto-dispatches (§5: every panel writes into the composer, never auto-sends). For a
        // GitIssue we know the leaf number, so the staged line is a real --title build header.
        string staged = d.Kind == Services.DetectionKind.GitIssue && d.Number.HasValue
            ? $"--title {d.Number} --model claude-opus-4-8 --effort medium --buildSet ShaneBuilder\n\n{d.Title}"
            : $"[{d.Kind}] {d.Title}";
        AppendToComposer(staged);
        ToastEngine.Show("Detected", "Promoted into the composer — review, then Send to queue it.", ToastKind.Info);
    }

    private Border DetectionKindChip(Services.DetectionKind kind)
    {
        (string label, Brush fg) = kind switch
        {
            Services.DetectionKind.GitIssue => ("GIT ISSUE", (Brush)FindResource("Brush.Claude.Accent")),
            Services.DetectionKind.Task => ("TASK", (Brush)FindResource("Brush.Claude.Text.Body")),
            Services.DetectionKind.Todo => ("TODO", (Brush)FindResource("Brush.Claude.Text.Body")),
            Services.DetectionKind.Commitment => ("COMMITMENT", (Brush)FindResource("Brush.Claude.Text.Body")),
            Services.DetectionKind.Question => ("QUESTION", (Brush)FindResource("Brush.Claude.Accent")),
            _ => (kind.ToString().ToUpperInvariant(), (Brush)FindResource("Brush.Claude.Text.Body")),
        };
        return new Border
        {
            CornerRadius = new CornerRadius(3),
            Background = (Brush)FindResource("Brush.Claude.Bg.Button"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(5, 1, 5, 1),
            Margin = new Thickness(0, 0, 5, 0),
            Child = new TextBlock
            {
                Text = label,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 8.5,
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = fg,
            },
        };
    }

    private Border DetectionMetaChip(string text) => new()
    {
        CornerRadius = new CornerRadius(3),
        Background = (Brush)FindResource("Brush.Claude.Bg.Button"),
        Padding = new Thickness(5, 1, 5, 1),
        Margin = new Thickness(0, 0, 5, 0),
        Child = new TextBlock
        {
            Text = text,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 8.5,
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
        },
    };

    private FrameworkElement DetectionActionLink(string text, Brush fg, Action onClick)
    {
        var tb = new TextBlock
        {
            Text = text,
            Cursor = Cursors.Hand,
            Margin = new Thickness(0, 0, 14, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9.5,
            FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
            Foreground = fg,
        };
        tb.MouseLeftButtonDown += (s, e) => onClick();
        return tb;
    }

    private Border DetectedGroupHeader(string text) => new()
    {
        Margin = new Thickness(0, 4, 0, 6),
        Child = new TextBlock
        {
            Text = text.ToUpperInvariant(),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9.5,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
        },
    };

    private TextBlock DetectedNote(string text) => new()
    {
        Text = text,
        Margin = new Thickness(0, 6, 0, 0),
        TextWrapping = TextWrapping.Wrap,
        FontStyle = FontStyles.Italic,
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
        FontSize = (double)FindResource("FontSize.11"),
        Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
    };

    private TextBlock DetectedLoadingRow() => new()
    {
        Text = "Reading mentions + pinned questions…",
        Margin = new Thickness(0, 6, 0, 0),
        FontStyle = FontStyles.Italic,
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
        FontSize = (double)FindResource("FontSize.11"),
        Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
    };

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // Git #2209 §7 — Cross-epic question round trip (CrossEpicQuestion with required FromTabId).
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    private void RenderCrossEpicCards()
    {
        var here = _activeChatTab?.Id ?? "";
        // Cards shown in a chat = the questions asked FROM this chat (awaiting an answer to bring back).
        var mine = _crossEpicQuestions.Where(q => q.FromTabId == here).ToList();
        if (mine.Count == 0) return;

        DetectedItemsResults.Children.Add(DetectedGroupHeader($"Cross-epic questions ({mine.Count})"));
        foreach (var q in mine)
            DetectedItemsResults.Children.Add(CrossEpicCard(q));
    }

    private Border CrossEpicCard(CrossEpicQuestion q)
    {
        var outer = new Border
        {
            Margin = new Thickness(0, 0, 0, 8),
            CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Claude.Bg.Bubble"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Accent"),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
        };
        var stack = new StackPanel();
        stack.Children.Add(new TextBlock
        {
            Text = $"Asked epic #{q.TargetEpic}",
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9.5,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Claude.Accent"),
        });
        stack.Children.Add(new TextBlock
        {
            Text = q.QuestionText,
            Margin = new Thickness(0, 3, 0, 0),
            TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });

        if (q.Answered)
        {
            stack.Children.Add(new TextBlock
            {
                Text = "Answer: " + q.Answer,
                Margin = new Thickness(0, 5, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 9.5,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Body"),
            });
            var pasteRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 7, 0, 0) };
            pasteRow.Children.Add(DetectionActionLink("Paste answer into this chat", (Brush)FindResource("Brush.Claude.Accent"),
                () => { AppendToComposer(q.Answer!); }));
            pasteRow.Children.Add(DetectionActionLink("Clear", (Brush)FindResource("Brush.Claude.Text.Muted"),
                () => { _crossEpicQuestions.Remove(q); _ = RenderDetectedItemsAsync(); }));
            stack.Children.Add(pasteRow);
        }
        else
        {
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 7, 0, 0) };
            // "Bring the answer back": jump to the target chat, then capture its real last assistant
            // turn (resolved OQ#2: attempt the DOM read; the button holds the return address either way).
            actions.Children.Add(DetectionActionLink("Bring the answer back", (Brush)FindResource("Brush.Claude.Accent"),
                () => _ = BringAnswerBackAsync(q)));
            actions.Children.Add(DetectionActionLink("Cancel", (Brush)FindResource("Brush.Claude.Text.Muted"),
                () => { _crossEpicQuestions.Remove(q); _ = RenderDetectedItemsAsync(); }));
            stack.Children.Add(actions);
        }

        outer.Child = stack;
        return outer;
    }

    // Launches a cross-epic question: writes it into the TARGET tab's composer draft stamped with
    // the return address, and files the CrossEpicQuestion(FromTabId = current tab).
    private void StartCrossEpicQuestion(TabDef target, string questionText)
    {
        if (_activeChatTab == null || string.IsNullOrWhiteSpace(questionText)) return;
        var q = new CrossEpicQuestion
        {
            Id = Guid.NewGuid().ToString("N"),
            FromTabId = _activeChatTab.Id,
            TargetEpic = target.EpicNumber ?? 0,
            TargetTabId = target.Id,
            QuestionText = questionText.Trim(),
        };
        _crossEpicQuestions.Add(q);

        // §7 — stamp the target tab's OWN draft (per-tab drafts make this correct) with the return
        // address so whoever picks up that chat sees where the answer needs to go back to.
        string fromLabel = _activeChatTab.EpicNumber.HasValue ? $"#{_activeChatTab.EpicNumber}" : _activeChatTab.Title;
        string stamped = $"[cross-epic question from {fromLabel}]\n{q.QuestionText}\n";
        _chatDrafts[target.Id] = (_chatDrafts.TryGetValue(target.Id, out var existing) && !string.IsNullOrEmpty(existing)
            ? existing.TrimEnd() + "\n\n" : "") + stamped;

        ToastEngine.Show("Cross-epic", $"Question written into epic #{q.TargetEpic}'s chat. Switch to it to ask, then Bring the answer back.", ToastKind.Info);
        if (_detectedItemsOpen) _ = RenderDetectedItemsAsync();
    }

    private async Task BringAnswerBackAsync(CrossEpicQuestion q)
    {
        // Jump to the target chat tab if it's open (that's where the answer lives).
        var target = q.TargetTabId != null ? _tabs.Find(t => t.Id == q.TargetTabId) : null;
        if (target != null && target.Id != _activeTabId)
            SelectTab(target.Id);

        // Resolved OQ#2 — attempt ONE real DOM read of the destination chat's last assistant turn.
        // claude.ai renders assistant turns as [data-testid="assistant-turn"] (or .font-claude-message);
        // if the read yields nothing, the doc's own fallback stands: keep the card, user pastes.
        string? captured = null;
        try { captured = await TryReadLastAssistantTurnAsync(); }
        catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.crossepic] answer read failed: {ex.Message}"); }

        if (!string.IsNullOrWhiteSpace(captured))
        {
            q.Answer = captured!.Trim();
            ToastEngine.Show("Cross-epic", "Captured the last assistant turn. Go back and paste it into your chat.", ToastKind.Success);
        }
        else
        {
            ToastEngine.Show("Cross-epic", "Couldn't auto-read the answer — copy it from the chat and paste manually (the card holds the return address).", ToastKind.Warning);
            q.Answer = ""; // mark as answer-pending-manual so the card offers a Paste row anyway
        }

        // Return to the asking chat so "Paste answer into this chat" targets the right composer.
        if (!string.IsNullOrWhiteSpace(q.Answer))
        {
            var from = _tabs.Find(t => t.Id == q.FromTabId);
            if (from != null && from.Id != _activeTabId) SelectTab(from.Id);
        }
        if (_detectedItemsOpen) _ = RenderDetectedItemsAsync();
    }

    // Demo trigger for the Inspector check-in flow — no real inspector agent
    // exists yet to drive this from a live event, so this reproduces the
    // mockup's own phase timing (idle → warning for 5s → blocking → idle)
    // on a button click, same honest-demo approach as the nudge pill's
    // click-to-cycle.
    private bool _inspectorRunning;

    private async void BtnSimulateInspector_Click(object sender, RoutedEventArgs e)
    {
        if (_inspectorRunning) return;
        _inspectorRunning = true;
        try
        {
            InspectorWarningNotice.Visibility = Visibility.Visible;
            for (int secondsLeft = 5; secondsLeft >= 1; secondsLeft--)
            {
                InspectorWarningText.Text = $"Inspector will ask Claude a question in {secondsLeft}s…";
                await Task.Delay(TimeSpan.FromSeconds(1));
            }

            InspectorWarningNotice.Visibility = Visibility.Collapsed;
            // WebView2 hosts a native child window that always paints over any
            // WPF sibling sharing its screen space ("airspace") regardless of
            // Z-order, so the overlay can't visually sit "on top of" it — hide
            // the webview itself while the overlay is shown instead.
            ClaudeWebView.Visibility = Visibility.Collapsed;
            InspectorBlockingOverlay.Visibility = Visibility.Visible;
            await Task.Delay(TimeSpan.FromSeconds(4));

            InspectorBlockingOverlay.Visibility = Visibility.Collapsed;
            ClaudeWebView.Visibility = Visibility.Visible;
        }
        finally
        {
            _inspectorRunning = false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // Git #2209 §8/§5 — App-owned composer: per-tab drafts + tool-writes-to-composer + Send bridge.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    private bool _composerLoading;

    private void ChatComposer_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_composerLoading) return;
        var id = _activeChatTab?.Id;
        if (id == null) return;
        _chatDrafts[id] = ChatComposer.Text; // §8 — save into THIS tab's draft only
        UpdateContextGauge();
    }

    // The one way tools/cross-epic content reach the chat — writes into the composer, never sends.
    private void AppendToComposer(string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        string cur = ChatComposer.Text;
        ChatComposer.Text = string.IsNullOrEmpty(cur) ? text : cur.TrimEnd() + "\n\n" + text;
        ChatComposer.CaretIndex = ChatComposer.Text.Length;
        ChatComposer.Focus();
    }

    // §2 — context gauge estimate: 0.28 tokens/char over the draft + a 40k fixed overhead, kept as a
    // two-part "used / 300k" shape (resolved OQ#3: no real tokeniser wired yet). The transcript's own
    // length isn't reachable without a full DOM read, so the estimate reflects the draft + overhead and
    // says so; the shape is what matters until a real tokeniser lands.
    private const double TokensPerChar = 0.28;
    private const int FixedOverheadTokens = 40000;
    private const int ContextWindowTokens = 300000;

    private void UpdateContextGauge()
    {
        int draftChars = ChatComposer?.Text?.Length ?? 0;
        int estimate = FixedOverheadTokens + (int)Math.Ceiling(draftChars * TokensPerChar);
        double frac = Math.Min(1.0, (double)estimate / ContextWindowTokens);
        if (CtxGauge != null)
            CtxGauge.Text = $"≈{estimate / 1000}k / {ContextWindowTokens / 1000}k ctx";
        if (CtxBarFill != null && CtxBarBorder != null)
            CtxBarFill.Width = Math.Max(0, CtxBarBorder.ActualWidth * frac);
        if (BtnStartNewChat != null)
            BtnStartNewChat.Visibility = frac >= 0.75 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderComposerReturnBar()
    {
        // Show the return-address bar when a cross-epic question was written INTO this tab (i.e. this
        // tab is someone else's TargetTabId and still unanswered).
        var here = _activeChatTab?.Id;
        var incoming = here == null ? null : _crossEpicQuestions.FirstOrDefault(q => q.TargetTabId == here && !q.Answered);
        if (incoming == null)
        {
            ComposerReturnBar.Visibility = Visibility.Collapsed;
            return;
        }
        var from = _tabs.Find(t => t.Id == incoming.FromTabId);
        string fromLabel = from?.Title ?? "another chat";
        ComposerReturnText.Text = $"Answering a cross-epic question from {fromLabel} — reply, then they'll bring it back.";
        ComposerReturnBar.Visibility = Visibility.Visible;
    }

    private void ComposerReturnClear_Click(object sender, MouseButtonEventArgs e)
        => ComposerReturnBar.Visibility = Visibility.Collapsed;

    private async void BtnComposerSend_Click(object sender, RoutedEventArgs e)
    {
        var text = ChatComposer.Text?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            ToastEngine.Show("Composer", "Nothing to send — the draft is empty.", ToastKind.Info);
            return;
        }
        bool sent = await TrySendToClaudeAsync(text);
        if (sent)
        {
            // Sending clears ONLY this tab's draft (§8).
            var id = _activeChatTab?.Id;
            if (id != null) _chatDrafts[id] = "";
            _composerLoading = true; ChatComposer.Text = ""; _composerLoading = false;
            UpdateContextGauge();
        }
        else
        {
            ToastEngine.Show("Composer", "Couldn't reach the claude.ai composer — the draft is kept. Paste it into the chat manually.", ToastKind.Warning);
        }
    }

    // ── WebView2 bridge ──────────────────────────────────────────────────────────────────────
    private async void EnsureWebViewWired()
    {
        if (_webViewWired || ClaudeWebView == null) return;
        try
        {
            await ClaudeWebView.EnsureCoreWebView2Async();
            if (ClaudeWebView.CoreWebView2 == null) return;
            _currentConversationUrl = ClaudeWebView.CoreWebView2.Source ?? _currentConversationUrl;
            ClaudeWebView.CoreWebView2.SourceChanged += (s, e) =>
            {
                _currentConversationUrl = ClaudeWebView.CoreWebView2.Source ?? _currentConversationUrl;
            };
            _webViewWired = true;
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.webview] init failed: {ex.Message}");
        }
    }

    private async Task<bool> TrySendToClaudeAsync(string text)
    {
        try
        {
            await ClaudeWebView.EnsureCoreWebView2Async();
            if (ClaudeWebView.CoreWebView2 == null) return false;
            // Inject the draft into claude.ai's ProseMirror composer. We DO NOT auto-submit — the
            // user reviews on the site and presses Enter — matching §5's "writes into the composer,
            // never auto-sends" invariant end to end.
            string json = System.Text.Json.JsonSerializer.Serialize(text);
            string script = @"(function(t){
                var el = document.querySelector('div[contenteditable=""true""]') || document.querySelector('textarea');
                if(!el) return 'no-composer';
                el.focus();
                if(el.tagName === 'TEXTAREA'){ el.value = t; el.dispatchEvent(new Event('input',{bubbles:true})); }
                else { el.innerText = t; el.dispatchEvent(new InputEvent('input',{bubbles:true})); }
                return 'ok';
            })(" + json + ");";
            var result = await ClaudeWebView.CoreWebView2.ExecuteScriptAsync(script);
            return result != null && result.Contains("ok");
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.webview] send failed: {ex.Message}");
            return false;
        }
    }

    private async Task<string?> TryReadLastAssistantTurnAsync()
    {
        await ClaudeWebView.EnsureCoreWebView2Async();
        if (ClaudeWebView.CoreWebView2 == null) return null;
        const string script = @"(function(){
            var sel = document.querySelectorAll('.font-claude-message, [data-testid=""assistant-turn""]');
            if(!sel || sel.length===0) return '';
            return (sel[sel.length-1].innerText || '').trim();
        })();";
        var raw = await ClaudeWebView.CoreWebView2.ExecuteScriptAsync(script);
        if (string.IsNullOrEmpty(raw) || raw == "null") return null;
        try { return System.Text.Json.JsonSerializer.Deserialize<string>(raw); }
        catch { return null; }
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // Git #2209 §2/§10 — context-bar action handlers (epic click-target, wrench, floaty, share).
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    private void CtxEpic_Click(object sender, MouseButtonEventArgs e)
    {
        var epic = _activeChatTab?.EpicNumber;
        if (epic.HasValue)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = $"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{epic}",
                    UseShellExecute = true,
                });
            }
            catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat] open epic failed: {ex.Message}"); }
        }
        else
        {
            ToastEngine.Show("Epic", "This chat has no epic assigned yet.", ToastKind.Info);
        }
    }

    private void BtnStartNewChat_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            ClaudeWebView.Source = new Uri("https://claude.ai/new");
        }
        catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat] start-new failed: {ex.Message}"); }
    }

    /// <summary>Git #2320 (Feature #2318 item 2) — New Chat button at the top of the Chats
    /// panel. Pure UI addition; hands off into OpenNewChatFlow() so #2321 (the real
    /// anchor-disclosure — active features, epic/state, "decide later") has one seam to
    /// build against instead of a second copy of this button's wiring.</summary>
    private void BtnNewChat_Click(object sender, RoutedEventArgs e) => OpenNewChatFlow();

    /// <summary>Today: opens a fresh claude.ai tab, same navigation BtnStartNewChat_Click
    /// already uses. #2321 replaces this body with the real disclosure listing active
    /// features + their epic/state and a "no feature yet — decide later" option before
    /// writing the anchor into the new tab's subtitle.</summary>
    private void OpenNewChatFlow()
    {
        try
        {
            ClaudeWebView.Source = new Uri("https://claude.ai/new");
        }
        catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat] new-chat failed: {ex.Message}"); }
    }

    private void BtnWrench_Click(object sender, RoutedEventArgs e)
    {
        BuildWrenchMenu();
        WrenchPopup.IsOpen = !WrenchPopup.IsOpen;
    }

    // Git #2233 — the real 12-tool spec (Shane's screenshot, audited against docs/Toolbelt.md
    // which was stale — it still described the old vault/batter/matrix/gate/health/settings
    // belt). Order below matches that spec: Log Peek, API Runner, Graph Read, Graph Write,
    // Git Doctor, Git Map, Repo Health, SQL Runner, PowerShell, Terminal, JSON Viewer,
    // Windows File Browser. All 12 are landed and wired to their real existing
    // panel/service state — nothing here is a fixture or a stub.
    private void BuildWrenchMenu()
    {
        WrenchMenuItems.Children.Clear();
        WrenchMenuItems.Children.Add(WrenchItem("Ask another epic a question…", () => { WrenchPopup.IsOpen = false; OpenCrossEpicComposer(); }));
        WrenchMenuItems.Children.Add(WrenchItem(_detectedItemsOpen ? "Hide Detected panel" : "Show Detected panel",
            () => { WrenchPopup.IsOpen = false; BtnToggleDetectedItems_Click(this, new RoutedEventArgs()); }));

        WrenchMenuItems.Children.Add(WrenchSeparator());

        WrenchMenuItems.Children.Add(WrenchItem(_logPeekOpen ? "Hide Log Peek" : "Show Log Peek",
            () => { WrenchPopup.IsOpen = false; BtnToggleLogPeek_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_apiExplorerOpen && _apiExplorerMode == Services.ApiExplorerMode.Local ? "Hide API Runner" : "Show API Runner",
            () => { WrenchPopup.IsOpen = false; OpenApiExplorer(Services.ApiExplorerMode.Local); }));
        WrenchMenuItems.Children.Add(WrenchItem(_apiExplorerOpen && _apiExplorerMode == Services.ApiExplorerMode.GraphRead ? "Hide Graph Read" : "Show Graph Read",
            () => { WrenchPopup.IsOpen = false; OpenApiExplorer(Services.ApiExplorerMode.GraphRead); }));
        WrenchMenuItems.Children.Add(WrenchItem(_apiExplorerOpen && _apiExplorerMode == Services.ApiExplorerMode.GraphWrite ? "Hide Graph Write" : "Show Graph Write",
            () => { WrenchPopup.IsOpen = false; OpenApiExplorer(Services.ApiExplorerMode.GraphWrite); }));
        WrenchMenuItems.Children.Add(WrenchItem(_gdMiniOpen ? "Hide Git Doctor" : "Show Git Doctor",
            () => { WrenchPopup.IsOpen = false; BtnToggleGitDoctorMini_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_gitMapOpen ? "Hide Git Map" : "Show Git Map",
            () => { WrenchPopup.IsOpen = false; BtnToggleGitMap_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_repoHealthOpen ? "Hide Repo Health" : "Show Repo Health",
            () => { WrenchPopup.IsOpen = false; BtnToggleRepoHealth_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_sqlRunnerOpen ? "Hide SQL Runner" : "Show SQL Runner",
            () => { WrenchPopup.IsOpen = false; BtnToggleSqlRunner_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_psOpen ? "Hide PowerShell" : "Show PowerShell",
            () => { WrenchPopup.IsOpen = false; BtnTogglePs_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_terminalOpen ? "Hide Terminal" : "Show Terminal",
            () => { WrenchPopup.IsOpen = false; BtnToggleTerminal_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_jsonViewerOpen ? "Hide JSON Viewer" : "Show JSON Viewer",
            () => { WrenchPopup.IsOpen = false; BtnToggleJsonViewer_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem(_fileBrowserOpen ? "Hide File Browser" : "Show File Browser",
            () => { WrenchPopup.IsOpen = false; BtnToggleFileBrowser_Click(this, new RoutedEventArgs()); }));

        WrenchMenuItems.Children.Add(WrenchSeparator());

        // Git #2204 — Settings is a document, not a mini-panel toggle (it has no bolt-on
        // column, same reason "Ask another epic a question…"/"Start a new chat" below aren't
        // in the 12-tool spec either). One real entry point among the three: gear icon
        // (BtnRailSettings), Ctrl+K palette, and here — all open the exact same tab.
        WrenchMenuItems.Children.Add(WrenchItem("Settings", () => { WrenchPopup.IsOpen = false; OpenSettingsTab(); }));
        WrenchMenuItems.Children.Add(WrenchItem("Pop into Claude Floaty", () => { WrenchPopup.IsOpen = false; BtnFloaty_Click(this, new RoutedEventArgs()); }));
        WrenchMenuItems.Children.Add(WrenchItem("Start a new chat", () => { WrenchPopup.IsOpen = false; BtnStartNewChat_Click(this, new RoutedEventArgs()); }));
    }

    private FrameworkElement WrenchSeparator() => new Border
    {
        Height = 1,
        Margin = new Thickness(4, 4, 4, 4),
        Background = (Brush)FindResource("Brush.Border.Popover"),
    };

    private FrameworkElement WrenchItem(string label, Action onClick)
    {
        var b = new Border { CornerRadius = new CornerRadius(5), Padding = new Thickness(9, 7, 9, 7), Cursor = Cursors.Hand };
        b.Child = new TextBlock
        {
            Text = label,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11.5"),
            Foreground = (Brush)FindResource("Brush.Text.Primary"),
        };
        b.MouseEnter += (s, e) => b.Background = (Brush)FindResource("Brush.Bg.Chip");
        b.MouseLeave += (s, e) => b.Background = Brushes.Transparent;
        b.MouseLeftButtonUp += (s, e) => onClick();
        return b;
    }

    // Minimal cross-epic composer: pick a target epic (from OTHER open chat tabs that carry an
    // EpicNumber) and type the question. Uses AppDialog for the prompt so it stays inside the app's
    // own dialog system rather than a MessageBox.
    private void OpenCrossEpicComposer()
    {
        var targets = _tabs.Where(t => t.IsChat && t.Id != _activeChatTab?.Id && t.EpicNumber.HasValue).ToList();
        if (targets.Count == 0)
        {
            ToastEngine.Show("Cross-epic", "No other epic chats are open to ask. Open one first.", ToastKind.Info);
            return;
        }
        // For now the single most-recent other epic chat is the target; the question text comes from
        // whatever is currently staged in the composer (real user text, no fixture).
        var target = targets[0];
        var question = ChatComposer.Text?.Trim();
        if (string.IsNullOrEmpty(question))
        {
            ToastEngine.Show("Cross-epic", $"Type your question in the composer first, then it will be sent to epic #{target.EpicNumber}.", ToastKind.Info);
            return;
        }
        StartCrossEpicQuestion(target, question);
        _composerLoading = true; ChatComposer.Text = ""; _composerLoading = false;
        var id = _activeChatTab?.Id; if (id != null) _chatDrafts[id] = "";
        UpdateContextGauge();
    }

    // §10 — Claude Floaty: a minimal always-on-top mini window showing the SAME conversation. Full
    // floaty spec lives with #2035/#2059/#2065; this is just the button + shared conversation.
    private Window? _floatyWindow;
    private void BtnFloaty_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (_floatyWindow != null) { _floatyWindow.Activate(); return; }
            var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
            _floatyWindow = new Window
            {
                Title = "Claude Floaty",
                Width = 420,
                Height = 620,
                Topmost = true,
                ShowInTaskbar = false,
                Owner = this,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = (Brush)FindResource("Brush.Claude.Bg.Content"),
                Content = wv,
            };
            _floatyWindow.Closed += (s, ev) => { _floatyWindow = null; };
            _floatyWindow.Show();
            wv.Source = new Uri(_currentConversationUrl); // same conversation the tab is on
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.floaty] open failed: {ex.Message}");
            ToastEngine.Show("Floaty", "Couldn't open the floaty window.", ToastKind.Error);
        }
    }

    // §3 — Share, resolved OQ#1: copy the real claude.ai share URL for the mapped conversation. If
    // the current URL isn't a real conversation (e.g. the /new or root page), hide the pill rather
    // than shipping a fake/inert one.
    private void BtnShare_Click(object sender, RoutedEventArgs e)
    {
        var cid = Services.ChatReadClient.ExtractConversationId(_currentConversationUrl);
        bool isRealConversation = _currentConversationUrl.Contains("/chat/") && !string.IsNullOrWhiteSpace(cid);
        if (!isRealConversation)
        {
            BtnShare.Visibility = Visibility.Collapsed;
            ToastEngine.Show("Share", "No shareable conversation is open yet.", ToastKind.Info);
            return;
        }
        try
        {
            Clipboard.SetText(_currentConversationUrl);
            ToastEngine.Show("Share", "Conversation link copied to clipboard.", ToastKind.Success);
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.share] copy failed: {ex.Message}");
        }
    }

    // ── Command Palette — Ctrl+K (or the title bar search trigger). Git #2203 —
    // every category now renders its own real right-pane per readme-phase2.md Step 14:
    // Git Epics/Issues off live `gh` (GitMapService/GitIssuesService), Builds/Build IDs off
    // real bt_build_queue rows (QueueReadClient) plus the real per-build stdout log
    // (BuildLogTailReader), Claude & URLs off _tabs, Services off scripts/dev-all.mjs's own
    // real .meta.json files (DevServicesReadClient), Terminal off a real TerminalSession,
    // SQL off the real SqlRunnerService + on-disk .sql files (RepoSqlFileScanner). "Files"
    // stays an honest (0) — Tab Workspaces (Step 9) isn't built yet, and Step 14's own
    // contract doesn't list Files as one of the seven panes to build.
    private sealed class PaletteResult
    {
        public string Category { get; }
        public string Title { get; }
        public string? Subtitle { get; }
        public Brush? Dot { get; }
        public string PreviewTitle { get; }
        public string? PreviewBody { get; }
        public Action OnSelect { get; }
        /// <summary>The real typed row backing this result (GitMapEpic / GitIssueRow /
        /// BuildQueueRow / TabDef / DevServiceRow) — null for the handful of static quick-open
        /// items (Git Doctor, Log Viewer, Git Map). <see cref="RenderPaletteDetailPane"/> reads
        /// this to build the category-specific right pane instead of the old one-sentence
        /// generic preview.</summary>
        public object? Payload { get; }

        public PaletteResult(string category, string title, string? subtitle, Brush? dot, string previewTitle, string? previewBody, Action onSelect, object? payload = null)
        {
            Category = category;
            Title = title;
            Subtitle = subtitle;
            Dot = dot;
            PreviewTitle = previewTitle;
            PreviewBody = previewBody;
            OnSelect = onSelect;
            Payload = payload;
        }
    }

    private static readonly (string Key, string Label)[] PaletteCategories =
    {
        ("All", "Smart All"),
        ("GitEpics", "Git Epics"),
        ("GitIssues", "Git Issues"),
        ("Builds", "Builds"),
        ("ClaudeUrls", "Claude & URLs"),
        ("Services", "Services"),
        ("Terminal", "Terminal"),
        ("SQL", "SQL"),
        ("BuildIDs", "Build IDs"),
        ("Files", "Files")
    };

    private string _paletteCategory = "All";
    private List<PaletteResult> _paletteFiltered = new();
    private int _paletteSelectedIndex;

    // ── Real per-category data caches (Git #2203). Populated by EnsurePaletteRealDataAsync,
    // never inline in BuildAllPaletteResults — that stays a fast synchronous read of whatever
    // was last loaded, so it's still safe to call on every keystroke.
    private readonly List<Services.GitMapEpic> _paletteEpics = new();
    private readonly Dictionary<int, List<Services.GitMapFeature>> _paletteEpicFeatures = new();
    private readonly List<Services.GitIssueRow> _paletteIssues = new();
    private readonly List<Services.PaletteBuildQueueRow> _paletteBuilds = new();
    private readonly List<Services.DevServiceRow> _paletteServices = new();
    private List<Services.RepoSqlFile> _paletteSqlFiles = new();
    private bool _paletteRealDataLoaded;
    private DateTime _paletteRealDataLoadedAtUtc = DateTime.MinValue;
    private int _paletteRealDataLoadSeq;
    private int _paletteEpicFeaturesLoadSeq;

    // Terminal category — one dedicated session for the palette itself (not tied to any chat
    // tab, since the palette is a global overlay). SQL category — the last real execution
    // result, kept independent of CommandPaletteInput's live text so it "survives without
    // touching the input" per Step 14's own done-when criteria.
    private TerminalSession? _paletteTerminalSession;
    private List<Services.SqlStatementResult>? _paletteSqlResult;
    private string? _paletteSqlError;
    private string? _paletteSqlLastRunAt;

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if ((Keyboard.Modifiers & ModifierKeys.Control) != 0 && (Keyboard.Modifiers & ModifierKeys.Shift) != 0 && e.Key == Key.F)
        {
            e.Handled = true;
            if (FilterStudioOverlay.Visibility == Visibility.Visible)
                CloseFilterStudio();
            else
                OpenFilterStudio();
        }
        else if ((Keyboard.Modifiers & ModifierKeys.Control) != 0 && e.Key == Key.K)
        {
            e.Handled = true;
            if (CommandPaletteOverlay.Visibility == Visibility.Visible)
                CloseCommandPalette();
            else
                OpenCommandPalette();
        }
        else if (e.Key == Key.Escape && FilterStudioOverlay.Visibility == Visibility.Visible)
        {
            e.Handled = true;
            CloseFilterStudio();
        }
        else if (CommandPaletteOverlay.Visibility == Visibility.Visible)
        {
            if (e.Key == Key.Escape) { e.Handled = true; CloseCommandPalette(); }
            else if (e.Key == Key.Down) { e.Handled = true; MovePaletteSelection(1); }
            else if (e.Key == Key.Up) { e.Handled = true; MovePaletteSelection(-1); }
            else if (e.Key == Key.Enter)
            {
                e.Handled = true;
                // Terminal/SQL — the search box IS the prompt; Enter runs the real command
                // instead of activating a list row (README-phase2.md Step 14's "Enter in
                // Terminal/SQL executes").
                string cmd = CommandPaletteInput.Text.Trim();
                if (_paletteCategory == "Terminal" && cmd.Length > 0) PaletteRunTerminalCommand(cmd);
                else if (_paletteCategory == "SQL" && cmd.Length > 0) _ = PaletteRunSqlAsync(cmd);
                else ActivatePaletteSelection();
            }
            else if (e.Key == Key.Tab)
            {
                e.Handled = true;
                int idx = Array.FindIndex(PaletteCategories, c => c.Key == _paletteCategory);
                int dir = (Keyboard.Modifiers & ModifierKeys.Shift) != 0 ? -1 : 1;
                SetPaletteCategory(PaletteCategories[(idx + dir + PaletteCategories.Length) % PaletteCategories.Length].Key);
            }
        }
    }

    private void Window_PreviewKeyUp(object sender, KeyEventArgs e)
    {
        // Git #2210 — PrtScn while ShaneBuilder is focused. WPF only surfaces PrintScreen on
        // key-up, so we handle it here (not KeyDown). Guard against double-firing: when the
        // GLOBAL hotkey is registered it consumes the key before it reaches this window, so we
        // only act on the in-app path when the global registration was refused. (The service's
        // own overlay-open guard is a second backstop.)
        if (e.Key == Key.Snapshot && !_screenClipHotkeyRegistered)
        {
            e.Handled = true;
            Services.DesktopScreenClipService.Capture();
        }
    }

    private void SearchTrigger_Click(object sender, MouseButtonEventArgs e) => OpenCommandPalette();
    private void CommandPaletteOverlay_Click(object sender, MouseButtonEventArgs e) => CloseCommandPalette();
    private void CommandPaletteDialog_Click(object sender, MouseButtonEventArgs e) => e.Handled = true; // don't let this bubble to the backdrop
    private void CommandPaletteEsc_Click(object sender, MouseButtonEventArgs e) => CloseCommandPalette();

    private void OpenCommandPalette()
    {
        CloseFilterStudio(); // mutually exclusive, per docs/Command Center (Ctrl+K).md

        // Same WebView2 "airspace" issue as the Inspector overlay: a native
        // child window always paints over every WPF sibling sharing its
        // screen space regardless of Z-order, so this overlay would render
        // behind claude.ai no matter where it sits in the visual tree unless
        // the webview itself is hidden while it's open.
        ClaudeWebView.Visibility = Visibility.Collapsed;

        CommandPaletteOverlay.Visibility = Visibility.Visible;
        _paletteCategory = "All";
        CommandPaletteInput.Text = "";
        RenderPaletteTiles();
        RenderPaletteCategories();
        RenderCommandPaletteResults();
        CommandPaletteInput.Focus();
        _ = EnsurePaletteRealDataAsync();
    }

    /// <summary>Loads every category's real backing data in parallel — real `gh` epics/issues,
    /// real bt_build_queue rows, real dev-service status, real on-disk .sql files. Cached for
    /// 30s so repeated Ctrl+K taps don't re-hit GitHub/Postgres/gh every time; a stale cache is
    /// still real data, just not the freshest possible read.</summary>
    private async Task EnsurePaletteRealDataAsync(bool force = false)
    {
        if (!force && _paletteRealDataLoaded && (DateTime.UtcNow - _paletteRealDataLoadedAtUtc) < TimeSpan.FromSeconds(30))
            return;

        int seq = ++_paletteRealDataLoadSeq;
        string repoRoot = _logService.MainRepoRoot ?? Environment.CurrentDirectory;

        var epicsTask = Services.GitMapService.GetOpenEpicsAsync(_activeChatTab?.EpicNumber);
        var issuesTask = Services.GitIssuesService.GetRecentOpenIssuesAsync();
        var servicesTask = Services.DevServicesReadClient.GetAllAsync(repoRoot);
        var queueClient = Services.QueueReadClient.CreateFromEnvironment();
        var buildsTask = queueClient?.GetRecentBuildsAsync() ?? Task.FromResult(new List<Services.PaletteBuildQueueRow>());

        try { await Task.WhenAll(epicsTask, issuesTask, servicesTask, buildsTask); }
        catch { /* individual tasks report their own honest failure below */ }
        if (seq != _paletteRealDataLoadSeq) return; // superseded by a newer load

        _paletteEpics.Clear();
        _paletteEpicFeatures.Clear(); // real reload — an epic's real sub-issues can have changed since the last fetch
        if (epicsTask.IsCompletedSuccessfully && epicsTask.Result.Ok) _paletteEpics.AddRange(epicsTask.Result.Epics);

        _paletteIssues.Clear();
        if (issuesTask.IsCompletedSuccessfully && issuesTask.Result.Ok) _paletteIssues.AddRange(issuesTask.Result.Issues);

        _paletteServices.Clear();
        if (servicesTask.IsCompletedSuccessfully) _paletteServices.AddRange(servicesTask.Result);

        _paletteBuilds.Clear();
        if (buildsTask.IsCompletedSuccessfully) _paletteBuilds.AddRange(buildsTask.Result);

        _paletteSqlFiles = Services.RepoSqlFileScanner.Scan(repoRoot);

        _paletteRealDataLoaded = true;
        _paletteRealDataLoadedAtUtc = DateTime.UtcNow;

        if (CommandPaletteOverlay.Visibility == Visibility.Visible)
        {
            RenderPaletteCategories();
            RenderCommandPaletteResults(preserveSelection: true);
        }

        // Git #2410 — revalidate every locally-active row's real GitHub board Status on this same
        // refresh, not just the local bt_build_queue snapshot (the real #1734 incident: an item
        // moved back to Backlog on GitHub kept showing as running/queued locally until Shane
        // manually stopped it). Runs AFTER the render above so a normal palette open never blocks
        // on GitHub — reconciliation lands as a second, fire-and-forget re-render once it resolves.
        if (_paletteBuilds.Count > 0)
            _ = ReconcilePaletteBuildStatusesAsync(seq);
    }

    private async Task ReconcilePaletteBuildStatusesAsync(int seq)
    {
        try
        {
            await Services.QueueStatusReconciler.ReconcileAsync(_paletteBuilds, _chatGitHubFilter);
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[queue] palette status reconciliation failed: {ex.Message}");
            return;
        }
        if (seq != _paletteRealDataLoadSeq) return; // superseded by a newer load

        if (CommandPaletteOverlay.Visibility == Visibility.Visible)
            RenderCommandPaletteResults(preserveSelection: true);
    }

    private void CloseCommandPalette()
    {
        CommandPaletteOverlay.Visibility = Visibility.Collapsed;
        // Don't reveal the webview if the Inspector's own blocking overlay is
        // still up — it hid ClaudeWebView for the same airspace reason and
        // owns un-hiding it once that phase ends.
        if (InspectorBlockingOverlay.Visibility != Visibility.Visible)
            ClaudeWebView.Visibility = Visibility.Visible;
    }

    private void CommandPaletteInput_TextChanged(object sender, TextChangedEventArgs e)
    {
        CommandPalettePlaceholder.Visibility = CommandPaletteInput.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        RenderCommandPaletteResults();
    }

    private void CommandPaletteInput_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        // Up/Down/Enter/Tab/Escape are all handled by the window-level
        // handler above (PreviewKeyDown tunnels through the focused TextBox).
    }

    // Real quick actions only — the reference screenshot's tiles (Git Pull,
    // Paste Manual Build, Recover Builds) are BuildConsole-specific concepts
    // that don't exist in ShaneBuilder yet.
    private void RenderPaletteTiles()
    {
        CommandPaletteTiles.Children.Clear();
        CommandPaletteTiles.Children.Add(PaletteTile("", "Toggle Build\nQueue", () => BtnToggleQueue_Click(BtnToggleQueue, new RoutedEventArgs())));
        CommandPaletteTiles.Children.Add(PaletteTile("", "Open Home", () => SelectTab("home")));
    }

    private Border PaletteTile(string glyph, string label, Action onClick)
    {
        var stack = new StackPanel { Width = 64, Margin = new Thickness(0, 0, 8, 8) };
        stack.Children.Add(new Border
        {
            Width = 48,
            Height = 48,
            CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Bg.Chip"),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            Child = new TextBlock
            {
                Text = glyph,
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 16,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("Brush.Text.Primary")
            }
        });
        stack.Children.Add(new TextBlock
        {
            Text = label,
            Margin = new Thickness(0, 5, 0, 0),
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            Foreground = (Brush)FindResource("Brush.Text.Muted")
        });

        var tile = new Border { Cursor = Cursors.Hand, Background = Brushes.Transparent, Child = stack };
        tile.MouseLeftButtonDown += (s, e) => { onClick(); CloseCommandPalette(); };
        return tile;
    }

    private List<PaletteResult> BuildAllPaletteResults()
    {
        var results = new List<PaletteResult>();

        results.Add(new PaletteResult("GitIssues", "Git Doctor", "Diagnose and fix whatever git is refusing to do",
            (Brush)FindResource("Brush.Epic.Gate"), "Git Doctor",
            "Every check git can fail, in plain English, each with real remedies you can run.",
            () => OpenGitDoctor()));

        results.Add(new PaletteResult("ClaudeUrls", "Log Viewer", "9 real log sources — Websites, Services, Local",
            (Brush)FindResource("Brush.LogSource.Console"), "Log Viewer",
            "COLD search, BURST/LIVE tail, and the real on-disk archive.",
            () => OpenLogViewer()));

        results.Add(new PaletteResult("ClaudeUrls", "Git Map", "Epic-scoped focus build, dropped work, and features",
            (Brush)FindResource("Brush.Epic.Gate"), "Git Map",
            "Real Focus Build + Started-and-Dropped + open-epic browser, off live GitHub + bt_build_queue.",
            () => OpenGitMap()));

        results.Add(new PaletteResult("ClaudeUrls", "Settings", "Environment, credentials, accounts",
            (Brush)FindResource("Brush.Status.Verifying"), "Settings",
            "Test env variables, API tokens, gated accounts, Claude Projects — one real store, no placeholder.",
            () => OpenSettingsTab()));

        // API Explorers — the third entry point (topbar zap menu + this Ctrl+K palette + chat tool panel), per readme Step 12.
        results.Add(new PaletteResult("ClaudeUrls", "API Endpoint Runner", "Local API server — routes, token, run",
            (Brush)FindResource("Brush.Workspace.Api"), "API Endpoint Runner",
            "Real local dev api-server routes. Login & fill token from the autofill lock, then run.",
            () => OpenApiExplorer(Services.ApiExplorerMode.Local)));
        results.Add(new PaletteResult("ClaudeUrls", "MS Graph Read Explorer", "Graph v1.0 reads — client-credentials token",
            (Brush)FindResource("Brush.Workspace.Api"), "MS Graph Read Explorer",
            "Real Microsoft Graph read endpoints against the DEV app registration, with a live permission gate.",
            () => OpenApiExplorer(Services.ApiExplorerMode.GraphRead)));
        results.Add(new PaletteResult("ClaudeUrls", "MS Graph Write Explorer", "Graph writes — risk-rated, DRY RUN default",
            (Brush)FindResource("Brush.Workspace.Api"), "MS Graph Write Explorer",
            "Risk-rated Graph writes. Defaults to DRY RUN — LIVE returns the real 403 when a scope is missing.",
            () => OpenApiExplorer(Services.ApiExplorerMode.GraphWrite)));

        foreach (var tab in _tabs)
        {
            results.Add(new PaletteResult("ClaudeUrls", tab.Title, tab.IsHome ? "Home tab" : "Chat tab",
                tab.Dot, tab.Title, tab.IsHome ? "Today's objectives and Next Up." : "Real claude.ai, embedded via WebView2.",
                () => SelectTab(tab.Id), payload: tab));
        }

        // Git #2203 — the "Builds" category used to be populated from _queueItems here, but at
        // the time that list was pre-existing sample/fixture data (SeedSampleQueueData), never
        // real. Mixing fabricated rows into the same category as the real _paletteBuilds rows
        // below would have violated this project's "never invent data to display" rule.
        // _queueItems is a real bt_build_queue read as of Git #2413, but this category still
        // deliberately reads from _paletteBuilds (its own independent GetRecentBuildsAsync
        // call, see EnsurePaletteRealDataAsync) rather than being switched over — unifying the
        // two real reads into one is a separate refactor, out of #2413's own scope.

        // ── Git Epics — real, off live `gh` (Git #2203). ─────────────────────────────────────
        foreach (var epic in _paletteEpics)
        {
            string title = $"#{epic.Number} {StripEpicTitlePrefix(epic.Title)}";
            results.Add(new PaletteResult("GitEpics", title, epic.Milestone != null ? $"Milestone: {epic.Milestone}" : "No milestone",
                (Brush)FindResource("Brush.Epic.Gate"), title, null,
                () => { OpenIssueInBrowser(epic.Number); CloseCommandPalette(); }, payload: epic));
        }

        // ── Git Issues — real, off live `gh` (Git #2203). ────────────────────────────────────
        foreach (var issue in _paletteIssues)
        {
            string title = $"#{issue.Number} {issue.Title}";
            string subtitle = issue.Labels.Count > 0 ? string.Join(", ", issue.Labels) : "No labels";
            results.Add(new PaletteResult("GitIssues", title, subtitle,
                (Brush)FindResource("Brush.Text.Dim"), title, null,
                () => { OpenIssueInBrowser(issue.Number); CloseCommandPalette(); }, payload: issue));
        }

        // ── Builds & Build IDs — real bt_build_queue rows, shown under both category tabs
        // (Step 14 pairs them under one right-pane shape), keyed differently per tab so
        // searching by title or by raw build id both work. ──────────────────────────────────
        foreach (var build in _paletteBuilds)
        {
            string byTitle = build.GithubNumber.HasValue ? $"#{build.GithubNumber.Value} {build.Title}" : build.Title;
            // Git #2410 — a row flagged stale by ReconcilePaletteBuildStatusesAsync shows the real
            // GitHub board Status, not the local cache's own belief it's still active.
            string subtitle = build.IsStale
                ? $"{build.BuildSet ?? "—"} · stale — GitHub now says {build.BoardStatus}"
                : $"{build.BuildSet ?? "—"} · {build.Status}";
            var dot = build.IsStale ? (Brush)FindResource("Brush.Text.Dim") : QueueStatusBrush(build.Status);
            results.Add(new PaletteResult("Builds", byTitle, subtitle, dot, byTitle, null,
                () => { if (build.GithubNumber.HasValue) OpenIssueInBrowser(build.GithubNumber.Value); CloseCommandPalette(); }, payload: build));
            results.Add(new PaletteResult("BuildIDs", $"Build {build.Id} — {build.Title}", subtitle, dot, byTitle, null,
                () => { if (build.GithubNumber.HasValue) OpenIssueInBrowser(build.GithubNumber.Value); CloseCommandPalette(); }, payload: build));
        }

        // ── Services — real, off scripts/dev-all.mjs's own .meta.json files (Git #2203). ────
        foreach (var svc in _paletteServices)
        {
            results.Add(new PaletteResult("Services", svc.Title, $"Port {svc.Port} · {(svc.PortOpen ? "Running" : "Stopped")}",
                svc.PortOpen ? (Brush)FindResource("Brush.Status.Done") : (Brush)FindResource("Brush.Text.Dim"),
                svc.Title, null,
                () => { if (svc.PortOpen) Process.Start(new ProcessStartInfo($"http://localhost:{svc.Port}") { UseShellExecute = true }); CloseCommandPalette(); },
                payload: svc));
        }

        // ── Terminal / SQL — one fixed quick-open item each, deliberately NOT filtered by the
        // query box (BuildAllPaletteResults always includes them; RenderCommandPaletteResults
        // skips the text filter entirely for these two categories) so the tool item can't
        // unmount out from under the user while they're typing a command. ──────────────────
        // Selecting either row (e.g. from the "All" category, before the query box has become a
        // command buffer) switches into that category rather than no-opping — a selectable row
        // that does nothing on Enter/click would be a real, surprising dead end.
        int termCount = _paletteTerminalSession?.Lines.Count ?? 0;
        results.Add(new PaletteResult("Terminal", "Terminal session", termCount > 0 ? $"{termCount} lines" : "Type a command below and press Enter",
            (Brush)FindResource("Brush.LogSource.Terminal"), "Terminal", null,
            () => SetPaletteCategory("Terminal"), payload: null));

        string sqlSubtitle = _paletteSqlResult != null ? $"Last run {_paletteSqlLastRunAt}" : "Type SQL below and press Enter";
        results.Add(new PaletteResult("SQL", "SQL Runner", sqlSubtitle,
            (Brush)FindResource("Brush.LogSource.Sql"), "SQL", null,
            () => SetPaletteCategory("SQL"), payload: null));

        return results;
    }

    private static string StripEpicTitlePrefix(string title) =>
        System.Text.RegularExpressions.Regex.Replace(title ?? "", @"^epic:\s*", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    private Brush QueueStatusBrush(string status) => (Brush)FindResource(status switch
    {
        "done" => "Brush.Status.Done",
        "running" => "Brush.Status.Running",
        "failed" => "Brush.Status.Crashed",
        "verifying" => "Brush.Status.Verifying",
        "blocked" => "Brush.Status.Blocked",
        "parked" => "Brush.Status.Parked",
        "canceled" or "cancelled" => "Brush.Status.Cancelled",
        "external" => "Brush.Status.External",
        _ => "Brush.Status.Queued"
    });

    private void RenderPaletteCategories()
    {
        var all = BuildAllPaletteResults();
        CommandPaletteCategories.Children.Clear();

        foreach (var (key, label) in PaletteCategories)
        {
            int count = key == "All" ? all.Count : all.Count(r => r.Category == key);
            bool active = key == _paletteCategory;

            var pill = new Border
            {
                Margin = new Thickness(0, 0, 6, 0),
                Padding = new Thickness(10, 5, 10, 5),
                CornerRadius = new CornerRadius(6),
                Cursor = Cursors.Hand,
                Background = active ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent,
                BorderBrush = active ? (Brush)FindResource("Brush.Accent.Primary") : Brushes.Transparent,
                BorderThickness = new Thickness(1),
                Child = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Children =
                    {
                        new TextBlock
                        {
                            Text = label,
                            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                            FontSize = (double)FindResource("FontSize.11"),
                            FontWeight = active ? (FontWeight)FindResource("FontWeight.Bold") : (FontWeight)FindResource("FontWeight.Regular"),
                            Foreground = active ? (Brush)FindResource("Brush.Accent.Primary") : (Brush)FindResource("Brush.Text.Muted")
                        },
                        new TextBlock
                        {
                            Text = $" ({count})",
                            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                            FontSize = (double)FindResource("FontSize.10"),
                            Foreground = (Brush)FindResource("Brush.Text.Dim")
                        }
                    }
                }
            };
            string capturedKey = key;
            pill.MouseLeftButtonDown += (s, e) => SetPaletteCategory(capturedKey);
            CommandPaletteCategories.Children.Add(pill);
        }
    }

    private void SetPaletteCategory(string key)
    {
        _paletteCategory = key;
        RenderPaletteCategories();
        RenderCommandPaletteResults();
    }

    private void MovePaletteSelection(int delta)
    {
        if (_paletteFiltered.Count == 0) return;
        _paletteSelectedIndex = Math.Clamp(_paletteSelectedIndex + delta, 0, _paletteFiltered.Count - 1);
        RenderCommandPaletteResults(preserveSelection: true);
    }

    private void ActivatePaletteSelection()
    {
        if (_paletteSelectedIndex < 0 || _paletteSelectedIndex >= _paletteFiltered.Count) return;
        ActivatePaletteResult(_paletteFiltered[_paletteSelectedIndex]);
    }

    /// <summary>Runs a result's primary action. Every category closes the palette afterward
    /// except Terminal/SQL's own quick-open row, whose action is switching INTO that category
    /// (e.g. from "All") — closing the palette right after would defeat the point of landing on
    /// a live command buffer to keep typing into.</summary>
    private void ActivatePaletteResult(PaletteResult result)
    {
        result.OnSelect();
        if (result.Category != "Terminal" && result.Category != "SQL")
            CloseCommandPalette();
    }

    private void RenderCommandPaletteResults(bool preserveSelection = false)
    {
        // Git #2203 — Terminal/SQL: the search box IS the prompt (a command buffer, not a list
        // filter), so their one tool-item result is exempt from the text filter entirely — it
        // can never unmount out from under a query the user is still typing.
        bool isConsoleTab = _paletteCategory == "Terminal" || _paletteCategory == "SQL";
        string query = CommandPaletteInput.Text.Trim();
        var all = BuildAllPaletteResults();
        var scoped = _paletteCategory == "All" ? all : all.Where(r => r.Category == _paletteCategory);

        _paletteFiltered = (isConsoleTab || query.Length == 0
            ? scoped
            : scoped.Where(r => r.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                                 (r.Subtitle?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false))
        ).ToList();

        if (!preserveSelection)
            _paletteSelectedIndex = 0;
        else
            _paletteSelectedIndex = Math.Clamp(_paletteSelectedIndex, 0, Math.Max(0, _paletteFiltered.Count - 1));

        CommandPaletteResults.Children.Clear();

        if (_paletteFiltered.Count == 0)
        {
            CommandPaletteResults.Children.Add(new TextBlock
            {
                Text = "No matches.",
                Margin = new Thickness(10, 12, 10, 12),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            CommandPalettePreview.Children.Clear();
            return;
        }

        for (int i = 0; i < _paletteFiltered.Count; i++)
            CommandPaletteResults.Children.Add(PaletteRow(_paletteFiltered[i], i == _paletteSelectedIndex));

        if (_paletteCategory == "Terminal") RenderPaletteTerminalPane();
        else if (_paletteCategory == "SQL") RenderPaletteSqlPane();
        else RenderPaletteDetailPane(_paletteFiltered[_paletteSelectedIndex]);
    }

    /// <summary>Git #2203 — the per-category right pane. Every category with real backing data
    /// gets its own real render; everything else (Git Doctor/Log Viewer/Git Map quick items,
    /// and any category with no selection yet) falls back to the original one-line preview.</summary>
    private void RenderPaletteDetailPane(PaletteResult result)
    {
        CommandPalettePreview.Children.Clear();

        switch (result.Payload)
        {
            case Services.GitMapEpic epic: RenderPaletteEpicDetail(epic); return;
            case Services.GitIssueRow issue: RenderPaletteIssueDetail(issue); return;
            case Services.PaletteBuildQueueRow build: RenderPaletteBuildDetail(build); return;
            case TabDef tab: RenderPaletteTabDetail(tab); return;
            case Services.DevServiceRow svc: RenderPaletteServiceDetail(svc); return;
        }

        RenderPaletteGenericPreview(result);
    }

    private void RenderPaletteGenericPreview(PaletteResult result)
    {
        CommandPalettePreview.Children.Add(PaletteDetailTitle(result.PreviewTitle));
        if (result.PreviewBody != null)
            CommandPalettePreview.Children.Add(PaletteDetailBody(result.PreviewBody));
    }

    // ── Shared right-pane building blocks ────────────────────────────────────────────────────
    private TextBlock PaletteDetailTitle(string text) => new()
    {
        Text = text, TextWrapping = TextWrapping.Wrap,
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.13"),
        FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading")
    };

    private TextBlock PaletteDetailBody(string text) => new()
    {
        Text = text, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap,
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"),
        Foreground = (Brush)FindResource("Brush.Text.Muted")
    };

    private TextBlock PaletteDetailMeta(string text) => new()
    {
        Text = text, Margin = new Thickness(0, 4, 0, 0), TextWrapping = TextWrapping.Wrap,
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10"),
        Foreground = (Brush)FindResource("Brush.Text.Dim")
    };

    private TextBlock PaletteSectionLabel(string text) => new()
    {
        Text = text.ToUpperInvariant(), Margin = new Thickness(0, 14, 0, 6),
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9,
        FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Dim")
    };

    private TextBlock PaletteMutedNote(string text) => new()
    {
        Text = text, TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
        Foreground = (Brush)FindResource("Brush.Text.Dim")
    };

    private WrapPanel PaletteButtonRow(params (string Label, Action OnClick)[] buttons)
    {
        var wrap = new WrapPanel { Margin = new Thickness(0, 14, 0, 0) };
        foreach (var (label, onClick) in buttons)
        {
            var btn = new Button
            {
                Content = label, Margin = new Thickness(0, 0, 6, 6), Padding = new Thickness(10, 5, 10, 5),
                Background = (Brush)FindResource("Brush.Bg.Chip"), Foreground = (Brush)FindResource("Brush.Text.Primary"),
                BorderBrush = (Brush)FindResource("Brush.Border.Default"), BorderThickness = new Thickness(1),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
                Cursor = Cursors.Hand
            };
            btn.Click += (_, _) => onClick();
            wrap.Children.Add(btn);
        }
        return wrap;
    }

    // ── Git Epics detail (Git #2203) — milestone + real "contains" tiles off
    // GitMapService.GetFeaturesForEpicAsync, lazy-loaded per epic and cached. ──────────────────
    private void RenderPaletteEpicDetail(Services.GitMapEpic epic)
    {
        CommandPalettePreview.Children.Add(PaletteDetailTitle($"#{epic.Number} {StripEpicTitlePrefix(epic.Title)}"));
        CommandPalettePreview.Children.Add(PaletteDetailMeta(epic.Milestone != null ? $"Milestone: {epic.Milestone}" : "No milestone set"));

        CommandPalettePreview.Children.Add(PaletteSectionLabel("Contains"));
        if (_paletteEpicFeatures.TryGetValue(epic.Number, out var features))
        {
            if (features.Count == 0)
                CommandPalettePreview.Children.Add(PaletteMutedNote("No open sub-issues."));
            else
                foreach (var f in features)
                    CommandPalettePreview.Children.Add(PaletteEpicFeatureRow(f));
        }
        else
        {
            CommandPalettePreview.Children.Add(PaletteMutedNote("Loading…"));
            _ = LoadPaletteEpicFeaturesAsync(epic.Number);
        }

        CommandPalettePreview.Children.Add(PaletteButtonRow(
            ("Open the epic page", () => { OpenIssueInBrowser(epic.Number); CloseCommandPalette(); }),
            ("Git panel", () => { OpenLeftPanel("Git"); CloseCommandPalette(); })
        ));
    }

    private async Task LoadPaletteEpicFeaturesAsync(int epicNumber)
    {
        int seq = ++_paletteEpicFeaturesLoadSeq;
        var (ok, features, _) = await Services.GitMapService.GetFeaturesForEpicAsync(epicNumber);
        if (ok)
        {
            try { await Services.GitEpicPanelService.OverlayParkPauseAsync(features, Services.ChatReadClient.ResolveConnectionStringForSqlRunner()); }
            catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[palette] park/pause overlay failed for epic #{epicNumber}: {ex.Message}"); }
        }
        _paletteEpicFeatures[epicNumber] = ok ? features : new List<Services.GitMapFeature>();
        if (seq != _paletteEpicFeaturesLoadSeq) return; // a newer load superseded this one

        if (CommandPaletteOverlay.Visibility != Visibility.Visible || _paletteCategory != "GitEpics") return;
        if (_paletteSelectedIndex < 0 || _paletteSelectedIndex >= _paletteFiltered.Count) return;
        if (_paletteFiltered[_paletteSelectedIndex].Payload is Services.GitMapEpic sel && sel.Number == epicNumber)
            RenderPaletteDetailPane(_paletteFiltered[_paletteSelectedIndex]);
    }

    private StackPanel PaletteEpicFeatureRow(Services.GitMapFeature f)
    {
        string coarse = f.IsComplete || f.IsClosed ? "done" : f.IsBlocked ? "blocked" : f.IsInFlight ? "running" : "queued";
        var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4), Cursor = Cursors.Hand };
        row.Children.Add(new Ellipse { Width = 7, Height = 7, Margin = new Thickness(0, 0, 7, 0), VerticalAlignment = VerticalAlignment.Center, Fill = QueueStatusBrush(coarse) });
        row.Children.Add(new TextBlock
        {
            Text = $"#{f.Number} {f.Title}", TextWrapping = TextWrapping.Wrap, MaxWidth = 240,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });
        row.MouseLeftButtonDown += (_, _) => { OpenIssueInBrowser(f.Number); CloseCommandPalette(); };
        return row;
    }

    // ── Git Issues detail (Git #2203) — real labels + real parent epic (GraphQL). ─────────────
    private void RenderPaletteIssueDetail(Services.GitIssueRow issue)
    {
        CommandPalettePreview.Children.Add(PaletteDetailTitle($"#{issue.Number} {issue.Title}"));
        CommandPalettePreview.Children.Add(PaletteDetailMeta(issue.Labels.Count > 0 ? string.Join(", ", issue.Labels) : "No labels"));
        CommandPalettePreview.Children.Add(PaletteDetailMeta(issue.ParentNumber.HasValue
            ? $"Parent: #{issue.ParentNumber} {issue.ParentTitle}"
            : "No parent epic"));

        var buttons = new List<(string, Action)>
        {
            ("Open the issue page", () => { OpenIssueInBrowser(issue.Number); CloseCommandPalette(); }),
            ("Git panel", () => { OpenLeftPanel("Git"); CloseCommandPalette(); })
        };
        if (issue.ParentNumber.HasValue)
            buttons.Add(("Its epic", () => { OpenIssueInBrowser(issue.ParentNumber!.Value); CloseCommandPalette(); }));
        buttons.Add(("Dispatch build", () => { SendFeatureToComposer(issue.Number, issue.Title); CloseCommandPalette(); }));
        CommandPalettePreview.Children.Add(PaletteButtonRow(buttons.ToArray()));
    }

    // ── Builds & Build IDs detail (Git #2203) — real bt_build_queue row, best-effort real
    // step/% (report-progress.mjs's own durable JSON snapshot, when one exists for this build
    // id), and the real last-10 stdout lines off the machine-global per-build log file. ───────
    private void RenderPaletteBuildDetail(Services.PaletteBuildQueueRow build)
    {
        string titleLine = build.GithubNumber.HasValue ? $"#{build.GithubNumber} {build.Title}" : build.Title;
        CommandPalettePreview.Children.Add(PaletteDetailTitle(titleLine));
        CommandPalettePreview.Children.Add(PaletteDetailMeta($"Build {build.Id} · {build.BuildSet ?? "—"} · {build.Model ?? "—"} / {build.Effort ?? "—"}"));

        // Git #2410 — real reconciliation result, not just the cached local status: a row can look
        // active in `bt_build_queue` while GitHub has already moved it back to Backlog (or anywhere
        // else non-launch). Only rendered once a real board-status lookup has actually resolved for
        // this row (BoardStatus != null) — an unresolved/unreachable lookup says nothing here.
        if (build.BoardStatus != null)
        {
            CommandPalettePreview.Children.Add(build.IsStale
                ? PaletteMutedNote($"⚠ Stale — local status is \"{build.Status}\" but GitHub's real board Status is now \"{build.BoardStatus}\".")
                : PaletteDetailMeta($"GitHub board Status: {build.BoardStatus} (matches local)"));
        }

        CommandPalettePreview.Children.Add(PaletteSectionLabel("Progress"));
        var (step, total, label) = ReadPaletteBuildProgress(build.Id);
        if (step.HasValue && total.HasValue && total.Value > 0)
        {
            CommandPalettePreview.Children.Add(PaletteProgressBar(step.Value, total.Value));
            int pct = (int)Math.Round(100.0 * step.Value / total.Value);
            CommandPalettePreview.Children.Add(PaletteDetailMeta($"Step {step}/{total} ({pct}%) — {label}"));
        }
        else
        {
            // No live cross-process %/step is reliably readable for a build that ran in an
            // isolated worktree (report-progress.mjs's JSON snapshot is worktree-relative, so
            // it never merges into the main checkout — same real constraint GitMapService's
            // own FocusBuild already documents). Real coarse queue status, never a guess.
            CommandPalettePreview.Children.Add(PaletteDetailMeta($"Real queue status: {build.Status} — no step/% has been reported here yet"));
        }

        CommandPalettePreview.Children.Add(PaletteSectionLabel("Last 10 stdout lines"));
        var tail = Services.BuildLogTailReader.TailLines(build.Id, 10);
        if (tail.Count == 0)
        {
            CommandPalettePreview.Children.Add(PaletteMutedNote("No real stdout log on disk for this build id."));
        }
        else
        {
            foreach (var line in tail)
                CommandPalettePreview.Children.Add(new TextBlock
                {
                    Text = line, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 2),
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
                    Foreground = (Brush)FindResource("Brush.Text.Muted")
                });
        }

        var buttons = new List<(string, Action)>
        {
            ("Focus in the queue", () => { BtnToggleQueue_Click(BtnToggleQueue, new RoutedEventArgs()); CloseCommandPalette(); }),
            ("Build Watch", () => { OpenLeftPanel("BuildWatch"); CloseCommandPalette(); })
        };
        if (Services.BuildLogTailReader.HasLog(build.Id))
            buttons.Add(("Full log", () => { OpenLogViewer(); CloseCommandPalette(); }));
        CommandPalettePreview.Children.Add(PaletteButtonRow(buttons.ToArray()));
    }

    private (int? Step, int? Total, string? Label) ReadPaletteBuildProgress(int buildId)
    {
        try
        {
            string repoRoot = _logService.MainRepoRoot ?? Environment.CurrentDirectory;
            var path = System.IO.Path.Combine(repoRoot, ".logs", "dev-all", "progress", $"{buildId}.json");
            if (!File.Exists(path)) return (null, null, null);
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            int? step = root.TryGetProperty("step", out var s) ? s.GetInt32() : null;
            int? total = root.TryGetProperty("total", out var t) ? t.GetInt32() : null;
            string? label = root.TryGetProperty("label", out var l) ? l.GetString() : null;
            return (step, total, label);
        }
        catch { return (null, null, null); }
    }

    private Border PaletteProgressBar(int step, int total)
    {
        double pct = total > 0 ? Math.Clamp((double)step / total, 0, 1) : 0;
        var track = new Border
        {
            Height = 6, CornerRadius = new CornerRadius(3), Background = (Brush)FindResource("Brush.Bg.Chip"),
            Margin = new Thickness(0, 4, 0, 0), ClipToBounds = true
        };
        track.Child = new Border
        {
            CornerRadius = new CornerRadius(3), Background = (Brush)FindResource("Brush.Status.Running"),
            HorizontalAlignment = HorizontalAlignment.Left, Width = 268 * pct
        };
        return track;
    }

    // ── Claude & URLs detail (Git #2203) — real epic tie via TabDef.EpicNumber, real builds
    // cross-referenced through the just-fetched issue parent data. Context meter has no real
    // reading available: the chat is a claude.ai session embedded via WebView2, not a metered
    // API call, so there's no real token/context count to show — an honest note, not a guess. ──
    private void RenderPaletteTabDetail(TabDef tab)
    {
        CommandPalettePreview.Children.Add(PaletteDetailTitle(tab.Title));
        CommandPalettePreview.Children.Add(PaletteDetailMeta(tab.IsHome ? "Home tab" : "Chat tab"));

        var epic = tab.EpicNumber.HasValue ? _paletteEpics.FirstOrDefault(e => e.Number == tab.EpicNumber.Value) : null;
        CommandPalettePreview.Children.Add(PaletteSectionLabel("Epic"));
        if (tab.EpicNumber.HasValue)
        {
            string epicLine = $"#{tab.EpicNumber} " + (epic != null ? StripEpicTitlePrefix(epic.Title) : "(not in the open-epics list)");
            CommandPalettePreview.Children.Add(PaletteDetailMeta(epicLine));
            if (epic?.Milestone != null)
                CommandPalettePreview.Children.Add(PaletteDetailMeta($"Milestone: {epic.Milestone}"));
        }
        else
        {
            CommandPalettePreview.Children.Add(PaletteMutedNote("No epic derived for this chat."));
        }

        // Git #2319 — the real Feature-tier ancestor, once resolved (ResolveChatFeatureNumbersAsync).
        CommandPalettePreview.Children.Add(PaletteSectionLabel("Feature"));
        CommandPalettePreview.Children.Add(tab.FeatureNumber.HasValue
            ? PaletteDetailMeta($"#{tab.FeatureNumber}")
            : PaletteMutedNote("No Feature-tier ancestor found for this chat's epic."));

        CommandPalettePreview.Children.Add(PaletteSectionLabel("Context meter"));
        CommandPalettePreview.Children.Add(PaletteMutedNote("Not exposed by the embedded claude.ai session — no real token/context reading is available here."));

        CommandPalettePreview.Children.Add(PaletteSectionLabel("Builds tied to this epic"));
        if (tab.EpicNumber.HasValue)
        {
            var tied = _paletteBuilds.Where(b => b.GithubNumber.HasValue &&
                _paletteIssues.Any(i => i.Number == b.GithubNumber.Value && i.ParentNumber == tab.EpicNumber.Value)).ToList();
            if (tied.Count == 0)
                CommandPalettePreview.Children.Add(PaletteMutedNote("None found among the most recently updated open issues checked."));
            else
                foreach (var b in tied)
                    CommandPalettePreview.Children.Add(PaletteDetailMeta($"#{b.GithubNumber} {b.Title} — {b.Status}"));
        }
        else
        {
            CommandPalettePreview.Children.Add(PaletteMutedNote("No epic derived for this chat."));
        }

        var buttons = new List<(string, Action)> { ("Open the chat", () => { SelectTab(tab.Id); CloseCommandPalette(); }) };
        if (tab.EpicNumber.HasValue)
            buttons.Add(("Its epic", () => { OpenIssueInBrowser(tab.EpicNumber!.Value); CloseCommandPalette(); }));
        buttons.Add(("Sidebar", () => { OpenLeftPanel("Chat"); CloseCommandPalette(); }));
        CommandPalettePreview.Children.Add(PaletteButtonRow(buttons.ToArray()));
    }

    // ── Services detail (Git #2203) — real status/port/pid off scripts/dev-all.mjs's own
    // .meta.json, real Start/Stop via the same --start/--stop flags dev-all.mjs defines. ──────
    private void RenderPaletteServiceDetail(Services.DevServiceRow svc)
    {
        CommandPalettePreview.Children.Add(PaletteDetailTitle(svc.Title));
        CommandPalettePreview.Children.Add(PaletteDetailMeta(
            $"Port {svc.Port} · {(svc.PortOpen ? "Running" : "Stopped")}" + (svc.Pid.HasValue ? $" · PID {svc.Pid}" : "")));

        string repoRoot = _logService.MainRepoRoot ?? Environment.CurrentDirectory;
        var buttons = new List<(string, Action)>();
        if (svc.PortOpen)
        {
            buttons.Add(("Stop", () =>
            {
                Services.DevServicesReadClient.StopService(repoRoot, svc.Name);
                ToastEngine.Show("Services", $"Stopping {svc.Title}…", ToastKind.Info);
                _ = EnsurePaletteRealDataAsync(force: true);
            }));
            buttons.Add(("Open in Edge", () => { Process.Start(new ProcessStartInfo($"http://localhost:{svc.Port}") { UseShellExecute = true }); CloseCommandPalette(); }));
        }
        else
        {
            buttons.Add(("Start", () =>
            {
                Services.DevServicesReadClient.StartService(repoRoot, svc.Name);
                ToastEngine.Show("Services", $"Starting {svc.Title}…", ToastKind.Info);
                _ = EnsurePaletteRealDataAsync(force: true);
            }));
        }
        // "Open in tab" (a generic-URL WebView2 tab) has no real surface to wire yet —
        // ShaneBuilder's only embedded browser today is ClaudeWebView, dedicated to claude.ai —
        // so it's left out rather than faked; filed as a real finding (see #2203's completion
        // comment) instead of building a placeholder tab kind.
        buttons.Add(("See logs", () => { OpenLogViewer(); CloseCommandPalette(); }));
        CommandPalettePreview.Children.Add(PaletteButtonRow(buttons.ToArray()));
    }

    // ── Terminal (Git #2203) — one dedicated real TerminalSession for the palette itself. ────
    private TerminalSession GetOrCreatePaletteTerminalSession()
    {
        if (_paletteTerminalSession != null && !_paletteTerminalSession.HasExited) return _paletteTerminalSession;
        _paletteTerminalSession?.Dispose();
        var session = new TerminalSession(TerminalSessionKind.Cmd);
        session.Updated += () => Dispatcher.Invoke(() =>
        {
            if (CommandPaletteOverlay.Visibility == Visibility.Visible && _paletteCategory == "Terminal")
                RenderPaletteTerminalPane();
        });
        _paletteTerminalSession = session;
        return session;
    }

    private void RenderPaletteTerminalPane()
    {
        var session = GetOrCreatePaletteTerminalSession();

        CommandPalettePreview.Children.Clear();
        CommandPalettePreview.Children.Add(PaletteDetailTitle("Terminal"));
        CommandPalettePreview.Children.Add(PaletteDetailMeta(session.HasExited ? "Session ended" : $"cmd.exe — {session.Lines.Count} lines"));
        CommandPalettePreview.Children.Add(PaletteSectionLabel("Session"));

        if (session.Lines.Count == 0)
        {
            CommandPalettePreview.Children.Add(PaletteMutedNote("Type a command in the search box above and press Enter."));
        }
        else
        {
            foreach (var line in session.Lines)
                CommandPalettePreview.Children.Add(new TextBlock
                {
                    Text = line.Text, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 2),
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
                    FontWeight = line.IsPrompt ? FontWeights.SemiBold : FontWeights.Normal,
                    Foreground = line.IsPrompt ? (Brush)FindResource("Brush.LogSource.Terminal") : (Brush)FindResource("Brush.Text.Muted")
                });
        }

        CommandPalettePreview.Children.Add(PaletteButtonRow(
            ("Send session to chat", PaletteSendTerminalSessionToChat),
            ("Open tool", () => { BtnToggleTerminal_Click(this, new RoutedEventArgs()); CloseCommandPalette(); }),
            ("Clear", () => { _paletteTerminalSession?.Dispose(); _paletteTerminalSession = null; RenderCommandPaletteResults(preserveSelection: true); })
        ));
    }

    private void PaletteRunTerminalCommand(string cmd)
    {
        CommandPaletteInput.Text = "";
        _ = GetOrCreatePaletteTerminalSession().RunAsync(cmd);
    }

    private void PaletteSendTerminalSessionToChat()
    {
        var session = _paletteTerminalSession;
        if (session == null || session.Lines.Count == 0) { CloseCommandPalette(); return; }
        var text = string.Join("\n", session.Lines.Select(l => l.Text));
        AppendToComposer("```\n" + text + "\n```");
        ToastEngine.Show("Terminal", "Session sent to the composer.", ToastKind.Info);
        CloseCommandPalette();
    }

    // ── SQL (Git #2203) — real SqlRunnerService execution + real on-disk .sql files. ─────────
    private void RenderPaletteSqlPane()
    {
        CommandPalettePreview.Children.Clear();
        CommandPalettePreview.Children.Add(PaletteDetailTitle("SQL Runner"));
        CommandPalettePreview.Children.Add(PaletteDetailMeta(_paletteSqlResult != null
            ? $"Last run {_paletteSqlLastRunAt}"
            : "Type SQL in the search box above and press Enter"));

        if (_paletteSqlError != null)
            CommandPalettePreview.Children.Add(PaletteMutedNote($"Error: {_paletteSqlError}"));
        else if (_paletteSqlResult != null)
            foreach (var stmt in _paletteSqlResult)
                CommandPalettePreview.Children.Add(PaletteSqlResultBlock(stmt));

        CommandPalettePreview.Children.Add(PaletteSectionLabel("Repo .sql files"));
        if (_paletteSqlFiles.Count == 0)
        {
            CommandPalettePreview.Children.Add(PaletteMutedNote("No .sql files found."));
        }
        else
        {
            foreach (var group in _paletteSqlFiles.GroupBy(f => f.Group))
            {
                CommandPalettePreview.Children.Add(new TextBlock
                {
                    Text = group.Key, Margin = new Thickness(0, 8, 0, 3),
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
                    FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"), Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                foreach (var file in group.Take(12)) // bounded — some real dirs here run long
                    CommandPalettePreview.Children.Add(PaletteSqlFileRow(file));
            }
        }

        CommandPalettePreview.Children.Add(PaletteButtonRow(
            ("Send result to chat", PaletteSendSqlResultToChat),
            ("Full SQL Runner", () => { BtnToggleSqlRunner_Click(this, new RoutedEventArgs()); CloseCommandPalette(); })
        ));
    }

    private DockPanel PaletteSqlFileRow(Services.RepoSqlFile file)
    {
        var row = new DockPanel { Margin = new Thickness(0, 0, 0, 4) };
        var btns = new StackPanel { Orientation = Orientation.Horizontal };
        DockPanel.SetDock(btns, Dock.Right);

        Button MakeBtn(string label) => new()
        {
            Content = label, Margin = new Thickness(4, 0, 0, 0), Padding = new Thickness(6, 2, 6, 2), FontSize = 9,
            Cursor = Cursors.Hand, Background = (Brush)FindResource("Brush.Bg.Chip"), Foreground = (Brush)FindResource("Brush.Text.Primary"),
            BorderThickness = new Thickness(0)
        };

        var loadBtn = MakeBtn("Load");
        loadBtn.Click += (_, _) =>
        {
            try
            {
                CommandPaletteInput.Text = File.ReadAllText(file.FullPath);
                ToastEngine.Show("SQL Runner", $"{file.Name} loaded — press Enter to run it.", ToastKind.Info);
            }
            catch (Exception ex) { ToastEngine.Show("SQL Runner", $"Couldn't read {file.Name}: {ex.Message}", ToastKind.Info); }
        };

        var runBtn = MakeBtn("Run");
        runBtn.Click += (_, _) =>
        {
            try { _ = PaletteRunSqlAsync(File.ReadAllText(file.FullPath)); }
            catch (Exception ex) { _paletteSqlError = ex.Message; _paletteSqlResult = null; RenderPaletteSqlPane(); }
        };

        btns.Children.Add(loadBtn);
        btns.Children.Add(runBtn);
        row.Children.Add(btns);
        row.Children.Add(new TextBlock
        {
            Text = file.Name, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
            Foreground = (Brush)FindResource("Brush.Text.Muted")
        });
        return row;
    }

    private async Task PaletteRunSqlAsync(string sql)
    {
        CommandPaletteInput.Text = "";
        var connStr = Services.SqlRunnerService.ResolveConnectionString();
        if (string.IsNullOrWhiteSpace(connStr))
        {
            _paletteSqlError = "No DATABASE_URL found — add it to .env.local at the repo root.";
            _paletteSqlResult = null;
            if (_paletteCategory == "SQL") RenderPaletteSqlPane();
            return;
        }

        try
        {
            var results = await Services.SqlRunnerService.ExecuteAsync(connStr, sql);
            _paletteSqlResult = results;
            _paletteSqlError = results.FirstOrDefault(r => !r.Success)?.Error;
            _paletteSqlLastRunAt = DateTime.Now.ToString("HH:mm:ss");
        }
        catch (Exception ex)
        {
            _paletteSqlError = ex.Message;
            _paletteSqlResult = null;
        }

        if (CommandPaletteOverlay.Visibility == Visibility.Visible && _paletteCategory == "SQL")
            RenderPaletteSqlPane();
    }

    private void PaletteSendSqlResultToChat()
    {
        var stmt = _paletteSqlResult?.LastOrDefault();
        if (stmt == null) { CloseCommandPalette(); return; }
        var sb = new StringBuilder();
        sb.AppendLine("```");
        sb.AppendLine(string.Join(" | ", stmt.Fields));
        foreach (var row in stmt.Rows.Take(50))
            sb.AppendLine(string.Join(" | ", stmt.Fields.Select(f => row.TryGetValue(f, out var je) ? je.ToString() : "")));
        sb.AppendLine("```");
        AppendToComposer(sb.ToString());
        ToastEngine.Show("SQL Runner", "Result sent to the composer.", ToastKind.Info);
        CloseCommandPalette();
    }

    private FrameworkElement PaletteSqlResultBlock(Services.SqlStatementResult stmt)
    {
        var stack = new StackPanel { Margin = new Thickness(0, 8, 0, 0) };
        stack.Children.Add(new TextBlock
        {
            Text = stmt.Success ? $"{stmt.RowCount} rows · {stmt.ExecutionMs}ms" : $"Error: {stmt.Error}",
            TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
            Foreground = stmt.Success ? (Brush)FindResource("Brush.Text.Dim") : (Brush)FindResource("Brush.Status.Crashed")
        });

        if (stmt.Success && stmt.Fields.Count > 0 && stmt.Rows.Count > 0)
        {
            var grid = new Grid { Margin = new Thickness(0, 4, 0, 0) };
            for (int c = 0; c < stmt.Fields.Count; c++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition());
            for (int c = 0; c < stmt.Fields.Count; c++)
            {
                var h = new TextBlock
                {
                    Text = stmt.Fields[c], FontSize = 9, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 0, 6, 2),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Dim")
                };
                Grid.SetColumn(h, c); Grid.SetRow(h, 0);
                grid.Children.Add(h);
            }
            int rowIdx = 1;
            foreach (var row in stmt.Rows.Take(20))
            {
                grid.RowDefinitions.Add(new RowDefinition());
                for (int c = 0; c < stmt.Fields.Count; c++)
                {
                    var val = row.TryGetValue(stmt.Fields[c], out var je) ? je.ToString() : "";
                    var cell = new TextBlock
                    {
                        Text = val, FontSize = 9, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 0, 6, 2),
                        Foreground = (Brush)FindResource("Brush.Text.Muted")
                    };
                    Grid.SetColumn(cell, c); Grid.SetRow(cell, rowIdx);
                    grid.Children.Add(cell);
                }
                rowIdx++;
            }
            stack.Children.Add(grid);
            if (stmt.Rows.Count > 20)
                stack.Children.Add(PaletteMutedNote($"…and {stmt.Rows.Count - 20} more rows (Full SQL Runner shows all)."));
        }
        return stack;
    }

    private Border PaletteRow(PaletteResult result, bool isSelected)
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
        if (result.Dot != null)
        {
            titleRow.Children.Add(new Border
            {
                Width = 30,
                Height = 30,
                CornerRadius = new CornerRadius(7),
                Margin = new Thickness(0, 0, 10, 0),
                Background = Tint(result.Dot, 0x26),
                BorderBrush = result.Dot,
                BorderThickness = new Thickness(1)
            });
        }
        var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        textStack.Children.Add(new TextBlock
        {
            Text = result.Title,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.12.5"),
            FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });
        if (result.Subtitle != null)
        {
            textStack.Children.Add(new TextBlock
            {
                Text = result.Subtitle,
                Margin = new Thickness(0, 1, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.10"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
        }
        titleRow.Children.Add(textStack);

        var rowGrid = new DockPanel();
        var categoryLabel = PaletteCategories.FirstOrDefault(c => c.Key == result.Category).Label ?? result.Category;
        var categoryTag = new TextBlock
        {
            Text = categoryLabel.ToUpperInvariant(),
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        };
        DockPanel.SetDock(categoryTag, Dock.Right);
        rowGrid.Children.Add(categoryTag);
        rowGrid.Children.Add(titleRow);

        var border = new Border
        {
            Margin = new Thickness(0, 0, 0, 2),
            Padding = new Thickness(10, 8, 10, 8),
            CornerRadius = new CornerRadius(6),
            Cursor = Cursors.Hand,
            Background = isSelected ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent,
            BorderBrush = isSelected ? (Brush)FindResource("Brush.Accent.Primary") : Brushes.Transparent,
            BorderThickness = new Thickness(1),
            Child = rowGrid
        };
        border.MouseEnter += (s, e) => { if (!isSelected) border.Background = (Brush)FindResource("Brush.Bg.Chip"); };
        border.MouseLeave += (s, e) => { if (!isSelected) border.Background = Brushes.Transparent; };
        border.MouseLeftButtonDown += (s, e) => ActivatePaletteResult(result);
        return border;
    }

    // ── Filter Studio — Ctrl+Shift+F, or the Lens chip. Built against the
    // real spec in docs/Filter Studio & Lenses.md, laid out per
    // docs/fs-overlay-stash.txt (scope rail | facets | live impact + lenses).
    // Build Queue is the only real registered surface today — its facets
    // (state, build set, search) genuinely filter QueueSetsHost via
    // GetFsFilteredQueueItems(), which RenderQueue calls on every render.
    // Chats Pane / Git Board / Batter Up are shown per the doc's scope
    // model (so the rail/registry concept is real) but have no live surface
    // to filter yet, so they sit under "Awaiting Registration" rather than
    // pretending to filter something that doesn't exist.
    private sealed class FsLens
    {
        public string Name { get; set; } = "";
        public string GlobalSearch { get; set; } = "";
        public string? GlobalEpic { get; set; }
        public string? QueueState { get; set; }
        public string? QueueBuildSet { get; set; }
        public string QueueSearch { get; set; } = "";
        public string? QueueModel { get; set; }
        public string? QueueEffort { get; set; }
        public string QueueSort { get; set; } = "QueueOrder";
    }

    private static readonly (string Key, string Label)[] FsScopes =
    {
        ("Global", "Global"),
        ("BuildQueue", "Build Queue"),
        ("ChatsPane", "Chats Pane"),
        ("GitBoard", "Git Board"),
        ("BatterUp", "Batter Up")
    };

    private string _fsScope = "Global";
    private string _fsGlobalSearch = "";
    private string? _fsGlobalEpic;
    private string? _fsQueueState;
    private string? _fsQueueBuildSet;
    private string _fsQueueSearch = "";
    private string? _fsQueueModel;
    private string? _fsQueueEffort;
    private string _fsQueueSort = "QueueOrder";
    private List<FsLens> _fsLenses = new();

    private static string FsLensesPath => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ShaneBuilder", "lenses.json");

    private void LoadFsLenses()
    {
        try
        {
            if (File.Exists(FsLensesPath))
                _fsLenses = JsonSerializer.Deserialize<List<FsLens>>(File.ReadAllText(FsLensesPath)) ?? new List<FsLens>();
        }
        catch
        {
            _fsLenses = new List<FsLens>(); // corrupt/unreadable file — start clean, per the doc's own fallback rule
        }
    }

    private void SaveFsLenses()
    {
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(FsLensesPath)!);
            File.WriteAllText(FsLensesPath, JsonSerializer.Serialize(_fsLenses));
        }
        catch { /* best-effort persistence — a failed save shouldn't crash the UI */ }
    }

    private bool FsAnyActive =>
        _fsGlobalSearch.Length > 0 || _fsGlobalEpic != null ||
        _fsQueueState != null || _fsQueueBuildSet != null || _fsQueueSearch.Length > 0 ||
        _fsQueueModel != null || _fsQueueEffort != null;

    private List<QueueItem> GetFsFilteredQueueItems()
    {
        IEnumerable<QueueItem> items = _queueItems;
        if (_fsGlobalSearch.Length > 0)
            items = items.Where(i => FsMatches(i, _fsGlobalSearch));
        if (_fsGlobalEpic != null)
            items = items.Where(i => i.BuildSet == _fsGlobalEpic);
        if (_fsQueueState == "RunningQueued")
            items = items.Where(i => i.Status == "Running" || i.Status == "Queued");
        else if (_fsQueueState != null)
            items = items.Where(i => i.Status == _fsQueueState);
        if (_fsQueueBuildSet != null)
            items = items.Where(i => i.BuildSet == _fsQueueBuildSet);
        if (_fsQueueModel != null)
            items = items.Where(i => i.Model != null && i.Model.Contains(_fsQueueModel, StringComparison.OrdinalIgnoreCase));
        if (_fsQueueEffort != null)
            items = items.Where(i => string.Equals(i.Effort, _fsQueueEffort, StringComparison.OrdinalIgnoreCase));
        if (_fsQueueSearch.Length > 0)
            items = items.Where(i => FsMatches(i, _fsQueueSearch));

        items = _fsQueueSort switch
        {
            "NewestNum" => items.OrderByDescending(i => i.GithubNumber ?? 0),
            "OldestNum" => items.OrderBy(i => i.GithubNumber ?? int.MaxValue),
            "SeverityFirst" => items.OrderByDescending(i => i.Status == "Blocked" ? 1 : 0).ThenByDescending(i => i.BlockedBy.Count),
            "UnblocksMost" => items.OrderByDescending(i => i.Blocks.Count),
            "TitleAZ" => items.OrderBy(i => i.Title, StringComparer.OrdinalIgnoreCase),
            _ => items // "QueueOrder" — leave as-is, the queue's own insertion order
        };

        return items.ToList();
    }

    private static bool FsMatches(QueueItem item, string query) =>
        item.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
        (item.GithubNumber.HasValue && item.GithubNumber.Value.ToString().Contains(query.TrimStart('#')));

    private void OpenFilterStudio()
    {
        CloseCommandPalette(); // mutually exclusive, per docs/Filter Studio & Lenses.md
        LoadFsLenses();

        // Same WebView2 "airspace" fix as the other overlays.
        ClaudeWebView.Visibility = Visibility.Collapsed;

        FilterStudioOverlay.Visibility = Visibility.Visible;
        _fsScope = "Global";
        RenderFsAll();
    }

    private void CloseFilterStudio()
    {
        FilterStudioOverlay.Visibility = Visibility.Collapsed;
        if (InspectorBlockingOverlay.Visibility != Visibility.Visible && CommandPaletteOverlay.Visibility != Visibility.Visible)
            ClaudeWebView.Visibility = Visibility.Visible;
    }

    private void FilterStudioOverlay_Click(object sender, MouseButtonEventArgs e) => CloseFilterStudio();
    private void FilterStudioDialog_Click(object sender, MouseButtonEventArgs e) => e.Handled = true;
    private void FilterStudioEsc_Click(object sender, MouseButtonEventArgs e) => CloseFilterStudio();

    private void FilterStudioResetAll_Click(object sender, MouseButtonEventArgs e)
    {
        _fsGlobalSearch = ""; _fsGlobalEpic = null;
        _fsQueueState = null; _fsQueueBuildSet = null; _fsQueueSearch = "";
        _fsQueueModel = null; _fsQueueEffort = null; _fsQueueSort = "QueueOrder";
        RenderFsAll();
        RenderQueue();
    }

    private void RenderFsAll()
    {
        RenderFsScopeList();
        RenderFsFacetPanel();
        RenderFsImpactPanel();
        FilterStudioResetButton.Visibility = FsAnyActive ? Visibility.Visible : Visibility.Collapsed;
        FilterStudioSummary.Text = FsAnyActive ? "Facets active" : "No constraints. Everything visible.";

        // Real registry counts: Build Queue is the only genuinely registered
        // surface right now; facet count is the sum of real chip options
        // across it (status/build-set/model/effort) plus Global's epic chips.
        int buildSets = _queueItems.Select(i => i.BuildSet).Distinct().Count();
        int facetCount = buildSets * 2 /* Global Epic + Build Queue Build Set */ + 11 /* status */ + 2 /* model */ + 4 /* effort */;
        FilterStudioRegistryLabel.Text = $"1 SURFACE · {facetCount} FACETS";
    }

    private int FsScopeActiveCount(string scope) => scope switch
    {
        "Global" => (_fsGlobalSearch.Length > 0 ? 1 : 0) + (_fsGlobalEpic != null ? 1 : 0),
        "BuildQueue" => (_fsQueueState != null ? 1 : 0) + (_fsQueueBuildSet != null ? 1 : 0) + (_fsQueueSearch.Length > 0 ? 1 : 0) +
                        (_fsQueueModel != null ? 1 : 0) + (_fsQueueEffort != null ? 1 : 0),
        _ => 0
    };

    private void RenderFsScopeList()
    {
        FilterStudioScopeList.Children.Clear();

        FilterStudioScopeList.Children.Add(FsSectionLabel("LENS"));
        FilterStudioScopeList.Children.Add(FsScopeRow("Global", "Global", "cascades everywhere"));

        FilterStudioScopeList.Children.Add(FsSectionLabel("TARGETS"));
        int visible = GetFsFilteredQueueItems().Count;
        FilterStudioScopeList.Children.Add(FsScopeRow("BuildQueue", "Build Queue", $"{visible} / {_queueItems.Count} builds"));
        FilterStudioScopeList.Children.Add(FsScopeRow("ChatsPane", "Chats Pane", "not registered"));
        FilterStudioScopeList.Children.Add(FsScopeRow("GitBoard", "Git Board", "not registered"));
        FilterStudioScopeList.Children.Add(FsScopeRow("BatterUp", "Batter Up", "not registered"));
    }

    private TextBlock FsSectionLabel(string text) => new TextBlock
    {
        Text = text,
        Margin = new Thickness(8, 10, 8, 4),
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
        FontSize = 8.5,
        FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
        Foreground = (Brush)FindResource("Brush.Text.Dim")
    };

    private Border FsScopeRow(string key, string label, string sub)
    {
        bool active = key == _fsScope;
        int activeCount = FsScopeActiveCount(key);

        var row = new DockPanel { Margin = new Thickness(0, 1, 0, 1) };
        var textStack = new StackPanel();
        var labelRow = new StackPanel { Orientation = Orientation.Horizontal };
        labelRow.Children.Add(new TextBlock
        {
            Text = label,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
            FontWeight = active ? (FontWeight)FindResource("FontWeight.Bold") : (FontWeight)FindResource("FontWeight.Regular"),
            Foreground = active ? (Brush)FindResource("Brush.Text.Heading") : (Brush)FindResource("Brush.Text.Muted")
        });
        if (activeCount > 0)
        {
            labelRow.Children.Add(new Border
            {
                Margin = new Thickness(5, 0, 0, 0),
                Padding = new Thickness(5, 0, 5, 0),
                CornerRadius = new CornerRadius(4),
                Background = (Brush)FindResource("Brush.Accent.Active"),
                Child = new TextBlock
                {
                    Text = activeCount.ToString(),
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                    FontSize = 8.5,
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                    Foreground = (Brush)FindResource("Brush.Bg.Window")
                }
            });
        }
        textStack.Children.Add(labelRow);
        textStack.Children.Add(new TextBlock
        {
            Text = sub,
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = 8.5,
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        row.Children.Add(textStack);

        var border = new Border
        {
            Padding = new Thickness(8, 6, 8, 6),
            CornerRadius = new CornerRadius(6),
            Cursor = Cursors.Hand,
            Background = active ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent,
            Child = row
        };
        border.MouseLeftButtonDown += (s, e) => { _fsScope = key; RenderFsAll(); };
        return border;
    }

    private void RenderFsFacetPanel()
    {
        FilterStudioFacetHost.Children.Clear();

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 14) };
        titleRow.Children.Add(new TextBlock
        {
            Text = FsScopes.First(s => s.Key == _fsScope).Label,
            VerticalAlignment = VerticalAlignment.Bottom,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 14,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Heading")
        });
        string? subtitle = _fsScope switch
        {
            "Global" => "cascades everywhere",
            "BuildQueue" => "Local facets stack on top of the global lens.",
            _ => null
        };
        if (subtitle != null)
        {
            titleRow.Children.Add(new TextBlock
            {
                Text = subtitle,
                Margin = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Bottom,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 10,
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
        }
        FilterStudioFacetHost.Children.Add(titleRow);

        switch (_fsScope)
        {
            case "Global":
                FilterStudioFacetHost.Children.Add(FsSearchBox("SEARCH", "Search everything…", _fsGlobalSearch,
                    v => { _fsGlobalSearch = v; RenderQueue(); RenderFsScopeList(); RenderFsImpactPanel(); }));
                FilterStudioFacetHost.Children.Add(FsFacetChips("EPIC", null, "All epics", _queueItems.Count,
                    _queueItems.GroupBy(i => i.BuildSet).Select(g => (g.Key, g.Key, g.Count(), (Brush?)AccentForBuildSet(g.Key))).ToList(),
                    _fsGlobalEpic, v => { _fsGlobalEpic = v; RenderQueue(); RenderFsScopeList(); RenderFsImpactPanel(); }));
                break;

            case "BuildQueue":
                FilterStudioFacetHost.Children.Add(FsSearchBox("SEARCH THE QUEUE", "#, title, branch, internal id. Enter applies", _fsQueueSearch,
                    v => { _fsQueueSearch = v; RenderQueue(); RenderFsScopeList(); RenderFsImpactPanel(); }));

                FilterStudioFacetHost.Children.Add(FsStatusDistributionBar());

                var statusOptions = new List<(string Value, string Label, int Count, Brush? Dot)>
                {
                    ("RunningQueued", "Running & Queued", _queueItems.Count(i => i.Status == "Running" || i.Status == "Queued"), null),
                    ("Running", "Running", _queueItems.Count(i => i.Status == "Running"), null),
                    ("Queued", "Queued", _queueItems.Count(i => i.Status == "Queued"), null),
                    ("Blocked", "Blocked", _queueItems.Count(i => i.Status == "Blocked"), null),
                    ("Failed", "Crashed", _queueItems.Count(i => i.Status == "Failed"), null),
                    ("Parked", "Parked", _queueItems.Count(i => i.Status == "Parked"), null),
                    ("Capped", "Capped", _queueItems.Count(i => i.Status == "Capped"), null),
                    ("External", "External", _queueItems.Count(i => i.Status == "External"), null),
                    ("Done", "Done", _queueItems.Count(i => i.Status == "Done"), null),
                    ("Cancelled", "Cancelled", _queueItems.Count(i => i.Status == "Cancelled"), null),
                    ("Tests", "Tests", _queueItems.Count(i => i.Status == "Tests"), null)
                };
                FilterStudioFacetHost.Children.Add(FsFacetChips("STATUS", null, "All", _queueItems.Count, statusOptions,
                    _fsQueueState, v => { _fsQueueState = v; RenderQueue(); RenderFsScopeList(); RenderFsImpactPanel(); }));

                FilterStudioFacetHost.Children.Add(FsFacetChips("BUILD SET", null, "All build sets", _queueItems.Count,
                    _queueItems.GroupBy(i => i.BuildSet).Select(g => (g.Key, g.Key, g.Count(), (Brush?)AccentForBuildSet(g.Key))).ToList(),
                    _fsQueueBuildSet, v => { _fsQueueBuildSet = v; RenderQueue(); RenderFsScopeList(); RenderFsImpactPanel(); }));

                // Model — bucketed by a case-insensitive substring match against the
                // real Model field (our sample data mixes "Opus"/"Opus 5"/"claude-
                // sonnet-5" naming, so this is the only honest way to group it).
                FilterStudioFacetHost.Children.Add(FsFacetChips("MODEL", null, "Any model", _queueItems.Count,
                    new List<(string, string, int, Brush?)>
                    {
                        ("Opus", "Opus", _queueItems.Count(i => i.Model?.Contains("Opus", StringComparison.OrdinalIgnoreCase) == true), null),
                        ("Sonnet", "Sonnet", _queueItems.Count(i => i.Model?.Contains("Sonnet", StringComparison.OrdinalIgnoreCase) == true), null)
                    },
                    _fsQueueModel, v => { _fsQueueModel = v; RenderQueue(); RenderFsScopeList(); RenderFsImpactPanel(); }));

                FilterStudioFacetHost.Children.Add(FsFacetChips("EFFORT", "From the build prompt flags", "Any effort", _queueItems.Count,
                    new List<(string, string, int, Brush?)>
                    {
                        ("Low", "Low", _queueItems.Count(i => string.Equals(i.Effort, "Low", StringComparison.OrdinalIgnoreCase)), null),
                        ("Medium", "Medium", _queueItems.Count(i => string.Equals(i.Effort, "Medium", StringComparison.OrdinalIgnoreCase)), null),
                        ("High", "High", _queueItems.Count(i => string.Equals(i.Effort, "High", StringComparison.OrdinalIgnoreCase)), null),
                        ("xhigh", "xhigh", _queueItems.Count(i => string.Equals(i.Effort, "xhigh", StringComparison.OrdinalIgnoreCase)), null)
                    },
                    _fsQueueEffort, v => { _fsQueueEffort = v; RenderQueue(); RenderFsScopeList(); RenderFsImpactPanel(); }));

                FilterStudioFacetHost.Children.Add(FsSortChips());
                break;

            default:
                FilterStudioFacetHost.Children.Add(new TextBlock
                {
                    Text = "No live surface yet — nothing to filter.",
                    TextWrapping = TextWrapping.Wrap,
                    FontStyle = FontStyles.Italic,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                    FontSize = (double)FindResource("FontSize.11"),
                    Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                break;
        }
    }

    private StackPanel FsSearchBox(string label, string placeholder, string value, Action<string> onChange)
    {
        var section = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
        section.Children.Add(new TextBlock
        {
            Text = label,
            Margin = new Thickness(0, 0, 0, 6),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        var box = new TextBox
        {
            Text = value,
            Height = 30,
            Padding = new Thickness(8, 0, 8, 0),
            VerticalContentAlignment = VerticalAlignment.Center,
            Background = (Brush)FindResource("Brush.Bg.Chip"),
            Foreground = (Brush)FindResource("Brush.Text.Heading"),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = 11.5
        };
        box.TextChanged += (s, e) => onChange(box.Text);
        section.Children.Add(box);
        return section;
    }

    // Facet group with real per-option counts (and an optional colored dot),
    // matching the reference screenshot's chip rows. allLabel/allCount is
    // the default "clear this facet" option, always shown first.
    private StackPanel FsFacetChips(string label, string? sublabel, string allLabel, int allCount,
        List<(string Value, string Label, int Count, Brush? Dot)> options, string? selected, Action<string?> onPick)
    {
        var section = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
        var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 6) };
        header.Children.Add(new TextBlock
        {
            Text = label,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        if (sublabel != null)
        {
            header.Children.Add(new TextBlock
            {
                Text = sublabel,
                Margin = new Thickness(6, 0, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 9,
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
        }
        section.Children.Add(header);

        var wrap = new WrapPanel();
        wrap.Children.Add(FsCountChip(allLabel, allCount, null, selected == null, () => onPick(null)));
        foreach (var (value, chipLabel, count, dot) in options)
            wrap.Children.Add(FsCountChip(chipLabel, count, dot, selected == value, () => onPick(value)));
        section.Children.Add(wrap);
        return section;
    }

    private Border FsCountChip(string label, int count, Brush? dot, bool selected, Action onPick)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal };
        if (dot != null)
        {
            content.Children.Add(new Ellipse
            {
                Width = 7,
                Height = 7,
                Fill = dot,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            });
        }
        content.Children.Add(new TextBlock
        {
            Text = label,
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            FontWeight = selected ? (FontWeight)FindResource("FontWeight.Bold") : (FontWeight)FindResource("FontWeight.Regular"),
            Foreground = selected ? (Brush)FindResource("Brush.Bg.Window") : (Brush)FindResource("Brush.Text.Muted")
        });
        content.Children.Add(new Border
        {
            Margin = new Thickness(6, 0, 0, 0),
            Padding = new Thickness(5, 0, 5, 0),
            CornerRadius = new CornerRadius(4),
            Background = selected ? new SolidColorBrush(Color.FromArgb(0x40, 0, 0, 0)) : (Brush)FindResource("Brush.Bg.Window"),
            Child = new TextBlock
            {
                Text = count.ToString(),
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = 8.5,
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = selected ? (Brush)FindResource("Brush.Bg.Window") : (Brush)FindResource("Brush.Text.Dim")
            }
        });

        var chip = new Border
        {
            Margin = new Thickness(0, 0, 6, 6),
            Padding = new Thickness(9, 4, 9, 4),
            CornerRadius = new CornerRadius(6),
            Cursor = Cursors.Hand,
            Background = selected ? (Brush)FindResource("Brush.Accent.Active") : (Brush)FindResource("Brush.Bg.Chip"),
            BorderBrush = selected ? (Brush)FindResource("Brush.Accent.Active") : (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            Child = content
        };
        chip.MouseLeftButtonDown += (s, e) => onPick();
        return chip;
    }

    // Thin multi-segment bar showing the real proportion of each status
    // across the whole queue — a static visual (not itself clickable), per
    // the reference's STATUS distribution bar.
    private Border FsStatusDistributionBar()
    {
        var bar = new Border { Height = 5, Margin = new Thickness(0, 0, 0, 8), CornerRadius = new CornerRadius(99), ClipToBounds = true };
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        int total = Math.Max(1, _queueItems.Count);
        foreach (var group in _queueItems.GroupBy(i => i.Status))
        {
            row.Children.Add(new Border
            {
                Width = 254.0 * group.Count() / total,
                Background = StatusBrush(group.Key)
            });
        }
        bar.Child = row;
        return bar;
    }

    private StackPanel FsSortChips()
    {
        var options = new (string Value, string Label)[]
        {
            ("QueueOrder", "Queue order"),
            ("NewestNum", "Newest #"),
            ("OldestNum", "Oldest #"),
            ("SeverityFirst", "Severity first"),
            ("UnblocksMost", "Unblocks most"),
            ("TitleAZ", "Title A-Z")
        };

        var section = new StackPanel();
        var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 6) };
        header.Children.Add(new TextBlock
        {
            Text = "SORT",
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        header.Children.Add(new TextBlock
        {
            Text = "Order within each set",
            Margin = new Thickness(6, 0, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        section.Children.Add(header);

        var wrap = new WrapPanel();
        foreach (var (value, label) in options)
        {
            string v = value;
            wrap.Children.Add(FsChip(label, _fsQueueSort == v, () =>
            {
                _fsQueueSort = v;
                RenderQueue();
                RenderFsFacetPanel();
            }));
        }
        section.Children.Add(wrap);
        return section;
    }

    private Border FsChip(string label, bool selected, Action onPick)
    {
        var chip = new Border
        {
            Margin = new Thickness(0, 0, 6, 6),
            Padding = new Thickness(9, 4, 9, 4),
            CornerRadius = new CornerRadius(6),
            Cursor = Cursors.Hand,
            Background = selected ? (Brush)FindResource("Brush.Accent.Active") : (Brush)FindResource("Brush.Bg.Chip"),
            BorderBrush = selected ? (Brush)FindResource("Brush.Accent.Active") : (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            Child = new TextBlock
            {
                Text = label,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.10.5"),
                FontWeight = selected ? (FontWeight)FindResource("FontWeight.Bold") : (FontWeight)FindResource("FontWeight.Regular"),
                Foreground = selected ? (Brush)FindResource("Brush.Bg.Window") : (Brush)FindResource("Brush.Text.Muted")
            }
        };
        chip.MouseLeftButtonDown += (s, e) => onPick();
        return chip;
    }

    private void RenderFsImpactPanel()
    {
        FilterStudioImpactHost.Children.Clear();

        FilterStudioImpactHost.Children.Add(FsSectionLabel("LIVE IMPACT"));

        int visible = GetFsFilteredQueueItems().Count;
        var impactBox = new Border
        {
            Margin = new Thickness(0, 0, 0, 4),
            Padding = new Thickness(9),
            CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Bg.Chip"),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1)
        };
        var impactStack = new StackPanel();
        impactStack.Children.Add(new DockPanel
        {
            Children =
            {
                new TextBlock
                {
                    Text = "Build Queue",
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                    FontSize = (double)FindResource("FontSize.11"),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                    Foreground = (Brush)FindResource("Brush.Text.Primary")
                },
                new TextBlock
                {
                    Text = $"{visible} / {_queueItems.Count}",
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                    FontSize = (double)FindResource("FontSize.10"),
                    Foreground = (Brush)FindResource("Brush.Text.Muted")
                }
            }
        });
        var track = new Border
        {
            Height = 4,
            Margin = new Thickness(0, 8, 0, 0),
            CornerRadius = new CornerRadius(99),
            Background = (Brush)FindResource("Brush.Border.Default")
        };
        var fillWidthFraction = _queueItems.Count > 0 ? (double)visible / _queueItems.Count : 0;
        track.Child = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            Width = 254 * fillWidthFraction,
            CornerRadius = new CornerRadius(99),
            Background = (Brush)FindResource("Brush.Accent.Active")
        };
        impactStack.Children.Add(track);
        impactBox.Child = impactStack;
        FilterStudioImpactHost.Children.Add(impactBox);

        FilterStudioImpactHost.Children.Add(FsSectionLabel("AWAITING REGISTRATION"));
        foreach (var label in new[] { "Chats Pane", "Git Board", "Batter Up" })
        {
            FilterStudioImpactHost.Children.Add(new Border
            {
                Margin = new Thickness(0, 0, 0, 4),
                Padding = new Thickness(9, 6, 9, 6),
                CornerRadius = new CornerRadius(8),
                Opacity = 0.6,
                BorderBrush = (Brush)FindResource("Brush.Border.Default"),
                BorderThickness = new Thickness(1),
                Child = new DockPanel
                {
                    Children =
                    {
                        new TextBlock
                        {
                            Text = label,
                            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                            FontSize = (double)FindResource("FontSize.10.5"),
                            Foreground = (Brush)FindResource("Brush.Text.Muted")
                        },
                        new TextBlock
                        {
                            Text = "no facets yet",
                            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                            FontSize = 8.5,
                            Foreground = (Brush)FindResource("Brush.Text.Dim")
                        }
                    }
                }
            });
        }

        FilterStudioImpactHost.Children.Add(FsSectionLabel("LENSES"));
        foreach (var lens in _fsLenses)
            FilterStudioImpactHost.Children.Add(FsLensRow(lens));

        var saveRow = new Grid { Margin = new Thickness(0, 4, 0, 0) };
        saveRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        saveRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var nameBox = new TextBox
        {
            Height = 26,
            Padding = new Thickness(7, 0, 7, 0),
            VerticalContentAlignment = VerticalAlignment.Center,
            Background = (Brush)FindResource("Brush.Bg.Chip"),
            Foreground = (Brush)FindResource("Brush.Text.Heading"),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 10.5
        };
        Grid.SetColumn(nameBox, 0);
        saveRow.Children.Add(nameBox);
        var saveBtn = new Border
        {
            Margin = new Thickness(6, 0, 0, 0),
            Padding = new Thickness(10, 0, 10, 0),
            Height = 26,
            CornerRadius = new CornerRadius(5),
            Cursor = Cursors.Hand,
            Background = (Brush)FindResource("Brush.Bg.Chip"),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            Child = new TextBlock
            {
                Text = "Save",
                VerticalAlignment = VerticalAlignment.Center,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 10.5,
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = (Brush)FindResource("Brush.Text.Primary")
            }
        };
        saveBtn.MouseLeftButtonDown += (s, e) =>
        {
            string name = nameBox.Text.Trim();
            if (name.Length == 0) return;
            SaveFsLens(name);
        };
        Grid.SetColumn(saveBtn, 1);
        saveRow.Children.Add(saveBtn);
        FilterStudioImpactHost.Children.Add(saveRow);
    }

    private Border FsLensRow(FsLens lens)
    {
        var row = new DockPanel();
        var close = new TextBlock
        {
            Text = "×",
            FontSize = 13,
            Cursor = Cursors.Hand,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        };
        close.MouseLeftButtonDown += (s, e) => { e.Handled = true; DeleteFsLens(lens.Name); };
        DockPanel.SetDock(close, Dock.Right);
        row.Children.Add(close);
        row.Children.Add(new TextBlock
        {
            Text = lens.Name,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 8, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });

        var border = new Border
        {
            Margin = new Thickness(0, 0, 0, 6),
            Padding = new Thickness(9, 6, 9, 6),
            CornerRadius = new CornerRadius(8),
            Cursor = Cursors.Hand,
            Background = (Brush)FindResource("Brush.Bg.Window"),
            BorderBrush = (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            Child = row
        };
        border.MouseLeftButtonDown += (s, e) => ApplyFsLens(lens);
        return border;
    }

    private void SaveFsLens(string name)
    {
        _fsLenses.RemoveAll(l => l.Name == name);
        _fsLenses.Add(new FsLens
        {
            Name = name,
            GlobalSearch = _fsGlobalSearch,
            GlobalEpic = _fsGlobalEpic,
            QueueState = _fsQueueState,
            QueueBuildSet = _fsQueueBuildSet,
            QueueSearch = _fsQueueSearch,
            QueueModel = _fsQueueModel,
            QueueEffort = _fsQueueEffort,
            QueueSort = _fsQueueSort
        });
        SaveFsLenses();
        RenderFsImpactPanel();
    }

    private void ApplyFsLens(FsLens lens)
    {
        _fsGlobalSearch = lens.GlobalSearch;
        _fsGlobalEpic = lens.GlobalEpic;
        _fsQueueState = lens.QueueState;
        _fsQueueBuildSet = lens.QueueBuildSet;
        _fsQueueSearch = lens.QueueSearch;
        _fsQueueModel = lens.QueueModel;
        _fsQueueEffort = lens.QueueEffort;
        _fsQueueSort = lens.QueueSort;
        RenderQueue();
        RenderFsAll();
        RenderFsFacetPanel();
    }

    private void DeleteFsLens(string name)
    {
        _fsLenses.RemoveAll(l => l.Name == name);
        SaveFsLenses();
        RenderFsImpactPanel();
    }

    // ── Quick access toolbar — title bar, per README's "small toggle chips
    // (account / location / conservation mode)" and the mockup's
    // topbarToggles/topbarQuickActions. Account/Location/Conservation/Drain
    // have no real backing concept in ShaneBuilder yet, so they're local
    // demo toggles (same honest pattern as the nudge pill); the camera
    // button is real (captures the window to the clipboard); Git Pull is an
    // honest stub — no repo integration is wired up here.
    private string _qaAccount = "Primary";
    private string _qaLocation = "Home";
    private bool _qaConservation;
    private bool _qaDrain;

    private void RenderQuickAccessToolbar()
    {
        QuickAccessToolbar.Children.Clear();

        QuickAccessToolbar.Children.Add(QaToggleChip("", _qaAccount, _qaAccount != "Primary",
            (Brush)FindResource("Brush.Accent.Active"), () =>
            {
                _qaAccount = _qaAccount == "Primary" ? "Secondary" : "Primary";
                RenderQuickAccessToolbar();
            }));

        QuickAccessToolbar.Children.Add(QaToggleChip("", _qaLocation, _qaLocation != "Home",
            (Brush)FindResource("Brush.Accent.Active"), () =>
            {
                _qaLocation = _qaLocation == "Home" ? "Rental" : "Home";
                RenderQuickAccessToolbar();
            }));

        QuickAccessToolbar.Children.Add(QaToggleChip("", "Conservation: " + (_qaConservation ? "On" : "Off"), _qaConservation,
            (Brush)FindResource("Brush.Status.Running"), () =>
            {
                _qaConservation = !_qaConservation;
                RenderQuickAccessToolbar();
            }));

        QuickAccessToolbar.Children.Add(QaToggleChip("", "Drain: " + (_qaDrain ? "✓" : "✕"), _qaDrain,
            (Brush)FindResource("Brush.Status.Capped"), () =>
            {
                _qaDrain = !_qaDrain;
                RenderQuickAccessToolbar();
            }));

        QuickAccessToolbar.Children.Add(new Border
        {
            Width = 1,
            Height = 14,
            Margin = new Thickness(3, 0, 3, 0),
            Background = (Brush)FindResource("Brush.Border.Popover")
        });

        QuickAccessToolbar.Children.Add(QaIconButton("", "Screenshot Tool — captures the window to the clipboard", CaptureWindowScreenshot));
        QuickAccessToolbar.Children.Add(QaIconButton("", "Git Pull — no repo integration wired up here", () => { }));
    }

    private Border QaToggleChip(string glyph, string text, bool active, Brush tint, Action onClick)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal };
        content.Children.Add(new TextBlock
        {
            Text = glyph,
            Margin = new Thickness(0, 0, 4, 0),
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 9,
            Foreground = active ? tint : (Brush)FindResource("Brush.Text.Muted")
        });
        content.Children.Add(new TextBlock
        {
            Text = text,
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
            Foreground = active ? tint : (Brush)FindResource("Brush.Text.Muted")
        });

        var chip = new Border
        {
            Height = 20,
            Margin = new Thickness(0, 0, 3, 0),
            Padding = new Thickness(6, 0, 6, 0),
            CornerRadius = new CornerRadius(5),
            Cursor = Cursors.Hand,
            Background = active ? Tint(tint, 0x22) : (Brush)FindResource("Brush.Bg.Panel"),
            BorderBrush = active ? Tint(tint, 0x73) : (Brush)FindResource("Brush.Border.Popover"),
            BorderThickness = new Thickness(1),
            Child = content
        };
        chip.MouseLeftButtonDown += (s, e) => onClick();
        return chip;
    }

    private Border QaIconButton(string glyph, string tooltip, Action onClick)
    {
        var btn = new Border
        {
            Width = 24,
            Height = 24,
            CornerRadius = new CornerRadius(6),
            Cursor = Cursors.Hand,
            Background = Brushes.Transparent,
            ToolTip = tooltip,
            Child = new TextBlock
            {
                Text = glyph,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 11,
                Foreground = (Brush)FindResource("Brush.Text.Muted")
            }
        };
        btn.MouseEnter += (s, e) => btn.Background = (Brush)FindResource("Brush.Bg.Chip");
        btn.MouseLeave += (s, e) => btn.Background = Brushes.Transparent;
        btn.MouseLeftButtonDown += (s, e) => onClick();
        return btn;
    }

    private void CaptureWindowScreenshot()
    {
        var bounds = new Rect(0, 0, ActualWidth, ActualHeight);
        var bitmap = new RenderTargetBitmap((int)bounds.Width, (int)bounds.Height, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(this);
        Clipboard.SetImage(bitmap);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Git Doctor — Step 13 (wpf-handoff/readme-phase2.md). Every finding,
    // branch and commit lookup here comes from GitDoctorService running real
    // git against the actual repo this executable lives inside. There is no
    // seeded/demo data path — an empty findings list means the repo really
    // is clean, not that data hasn't loaded.
    //
    // "Ask Claude" / "send all findings" copy markdown to the clipboard and
    // toast rather than injecting into the chat composer: ClaudeChatDock is
    // the real claude.ai site in a WebView2 (see its own comment above), not
    // a composer this app owns, so there is nothing to inject text into.
    // ══════════════════════════════════════════════════════════════════════

    private readonly GitDoctorService _gitDoctorService = new();
    private IReadOnlyList<GitDoctorFinding> _gdFindings = Array.Empty<GitDoctorFinding>();
    private IReadOnlyList<GitDoctorBranch> _gdBranches = Array.Empty<GitDoctorBranch>();
    private GitDoctorRepoStatus? _gdRepoStatus;
    private string? _gdSelectedFindingId;
    private readonly Dictionary<string, string> _gdRemedyChoice = new();
    private readonly Dictionary<string, bool> _gdBranchSelection = new();
    private string _gdBranchFilter = "merged";
    private bool _gdLoaded;
    private bool _gdLoading;
    private bool _gdRunning;
    private readonly List<(string Text, string? Why, bool IsHead)> _gdLog = new();
    private GitDoctorCommitInfo? _gdLookupResult;
    private bool _gdLookupNotFound;
    private string _gdLookupQueryShown = "";
    private List<(string Cmd, bool Approved)> _gdPlan = new();

    // Git #2218 — Git Doctor mini rail panel (README-ClaudeChat.md §6.2, posted on #2194). A 7th
    // ClaudeChatDock flyout column sharing every field above with the full GitDoctorDock document —
    // no second copy of findings/plan/log state, only a second, compact rendering path plus an
    // AppendToComposer-based bridge (the mini panel sits next to the real app-owned composer; the
    // full document does not, hence its clipboard-based bridge).
    private bool _gdMiniOpen;

    // ══════════════════════════════════════════════════════════════════════
    // Repo Health — Git #2214 §6.6. Every finding comes from RepoHealthService's
    // real `gh api graphql` scan of this repo's own open issues (Depth/Naming
    // rules) plus a real filesystem check (Stale) — no seeded data. The mini
    // panel (5th ClaudeChatDock flyout column) and the full document (its own
    // tab) share this same scan + selection state, per §5's tool-writes-to-
    // composer invariant: "Send N to this chat" calls AppendToComposer, same
    // as Detected Items' "Promote to Queue".
    // ══════════════════════════════════════════════════════════════════════
    private const int RepoHealthMaxSelected = 5;
    private readonly RepoHealthService _repoHealthService = new();
    private RepoHealthScan? _rhScan;
    private bool _rhLoaded;
    private bool _rhLoading;
    private bool _repoHealthOpen;
    private readonly HashSet<string> _rhSelected = new();
    private readonly HashSet<string> _rhSent = new();

    private void OpenGitDoctor()
    {
        if (_tabs.Find(t => t.Id == "gitdoctor") == null)
            _tabs.Add(new TabDef("gitdoctor", "Git Doctor", isGitDoctor: true, kind: TabKind.GitIssue, dot: (Brush)FindResource("Brush.Epic.Gate")));
        SelectTab("gitdoctor");
    }

    private async Task EnsureGitDoctorLoadedAsync()
    {
        if (_gdLoaded || _gdLoading) return;
        await LoadGitDoctorChecksAsync();
    }

    private void BtnGitDoctorRecheck_Click(object sender, RoutedEventArgs e) => _ = LoadGitDoctorChecksAsync();

    private async Task LoadGitDoctorChecksAsync()
    {
        _gdLoading = true;
        GitDoctorHeadline.Text = "Checking git…";
        GitDoctorSubline.Text = "";

        _gdRepoStatus = await _gitDoctorService.GetRepoStatusAsync();
        _gdFindings = await _gitDoctorService.RunChecksAsync();
        _gdBranches = _gdFindings.Any(f => f.ShowsBranches) ? await _gitDoctorService.ComputeBranchesAsync() : Array.Empty<GitDoctorBranch>();

        _gdLoaded = true;
        _gdLoading = false;
        _gdSelectedFindingId = _gdFindings.FirstOrDefault(f => !f.Fixed)?.CheckId ?? _gdFindings.FirstOrDefault()?.CheckId;
        _gdLookupResult = null;
        _gdLookupNotFound = false;
        RenderGitDoctor();
    }

    private void RenderGitDoctor()
    {
        var open = _gdFindings.Where(f => !f.Fixed).ToList();
        var repo = _gdRepoStatus;

        GitDoctorHeadline.Text = open.Count > 0
            ? $"{open.Count} thing{(open.Count == 1 ? " is" : "s are")} blocking git right now"
            : (_gdLoaded ? "Everything git was complaining about is fixed" : "");
        GitDoctorSubline.Text = repo != null
            ? $"{repo.Repo} · {repo.Branch} · {repo.Ahead} ahead · {repo.Behind} behind · {repo.Worktrees} worktrees"
            : "";

        GitDoctorNightmareLabel.Text = open.Count > 0 ? "End this git nightmare" : "Nothing left to fix";
        BtnGitDoctorNightmare.IsEnabled = open.Count > 0;
        BtnGitDoctorNightmare.Background = open.Count > 0
            ? (Brush)FindResource("Brush.Epic.Gate")
            : (Brush)FindResource("Brush.Bg.Card");
        GitDoctorNightmareLabel.Foreground = open.Count > 0 ? Brushes.Black : (Brush)FindResource("Brush.Text.Dim");
        int totalSteps = open.Sum(f => RemedyFor(f)?.Steps.Count ?? 0);
        GitDoctorNightmareSub.Text = open.Count > 0 ? $"backup branch first, then {totalSteps} commands" : "run a fresh check any time";
        GitDoctorOpenCount.Text = open.Count.ToString();

        RenderGitDoctorFindingsList();
        RenderGitDoctorDetail();
        RenderGitDoctorLog();
        RenderGitDoctorMini();
    }

    // Git #2218 §6.2 — mini rail panel's own Summary section: headline, branch/ahead-behind
    // subline, and the big red "Fix My Git Nightmare" button. Reads the same _gdFindings/
    // _gdRepoStatus state RenderGitDoctor() above already computed for the full document.
    private void RenderGitDoctorMini()
    {
        var open = _gdFindings.Where(f => !f.Fixed).ToList();
        var repo = _gdRepoStatus;

        GdMiniHeadline.Text = open.Count > 0
            ? $"{open.Count} thing{(open.Count == 1 ? " is" : "s are")} blocking git right now"
            : (_gdLoaded ? "Everything git was complaining about is fixed" : "Checking git…");
        GdMiniSubline.Text = repo != null
            ? $"{repo.Repo} · {repo.Branch} · {repo.Ahead} ahead · {repo.Behind} behind · {repo.Worktrees} worktrees"
            : "";

        GdMiniNightmareLabel.Text = open.Count > 0 ? "Fix My Git Nightmare" : "Nothing left to fix";
        GdMiniNightmareBtn.IsEnabled = open.Count > 0;
        GdMiniNightmareBtn.Background = open.Count > 0
            ? (Brush)FindResource("Brush.Epic.Gate")
            : (Brush)FindResource("Brush.Bg.Card");
        GdMiniNightmareLabel.Foreground = open.Count > 0 ? Brushes.Black : (Brush)FindResource("Brush.Text.Dim");

        RenderGitDoctorMiniFindingsList();
        RenderGitDoctorMiniLog();
        RenderGitDoctorMiniPlan();
    }

    private GitDoctorRemedy? RemedyFor(GitDoctorFinding f)
    {
        if (_gdRemedyChoice.TryGetValue(f.CheckId, out var pick))
        {
            var m = f.Remedies.FirstOrDefault(r => r.Id == pick);
            if (m != null) return m;
        }
        return f.Remedies.FirstOrDefault(r => r.Recommended) ?? f.Remedies.FirstOrDefault();
    }

    private Brush SeverityBrush(GitDoctorSeverity s) => s switch
    {
        GitDoctorSeverity.Low => (Brush)FindResource("Brush.NextUp.NoBuild.Fg"),
        GitDoctorSeverity.Medium => (Brush)FindResource("Brush.Epic.AppCore"),
        _ => (Brush)FindResource("Brush.Epic.Gate")
    };

    private Brush RiskBrush(GitDoctorRisk r) => r switch
    {
        GitDoctorRisk.Safe => (Brush)FindResource("Brush.Status.Running"),
        GitDoctorRisk.Careful => (Brush)FindResource("Brush.Epic.AppCore"),
        _ => (Brush)FindResource("Brush.Epic.Gate")
    };

    private void RenderGitDoctorFindingsList() => RenderGitDoctorFindingsList(GitDoctorFindingsPanel);

    private void RenderGitDoctorMiniFindingsList() => RenderGitDoctorFindingsList(GdMiniFindingsPanel);

    // Git #2218 §6.2 — shared between the full document's findings list and the mini rail panel's
    // own (severity dot + title + chip, clickable), same underlying _gdFindings/_gdSelectedFindingId
    // state, only the target StackPanel differs.
    private void RenderGitDoctorFindingsList(StackPanel target)
    {
        target.Children.Clear();

        if (!_gdLoaded)
        {
            target.Children.Add(new TextBlock
            {
                Text = "Running checks…", Margin = new Thickness(8),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }

        if (_gdFindings.Count == 0)
        {
            target.Children.Add(new TextBlock
            {
                Text = "No findings. Git is clean.", Margin = new Thickness(8), TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }

        foreach (var f in _gdFindings)
        {
            bool selected = f.CheckId == _gdSelectedFindingId && _gdLookupResult == null && !_gdLookupNotFound;
            var row = new Border
            {
                Padding = new Thickness(8, 7, 8, 7),
                Margin = new Thickness(0, 0, 0, 2),
                CornerRadius = new CornerRadius(7),
                Cursor = Cursors.Hand,
                Opacity = f.Fixed ? 0.5 : 1.0,
                Background = selected ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent,
                BorderThickness = new Thickness(2, 0, 0, 0),
                BorderBrush = selected ? SeverityBrush(f.Severity) : Brushes.Transparent
            };

            var textCol = new StackPanel { Width = double.NaN };
            textCol.Children.Add(new TextBlock
            {
                Text = f.Title, TextTrimming = TextTrimming.CharacterEllipsis,
                TextDecorations = f.Fixed ? TextDecorations.Strikethrough : null,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"),
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = f.Fixed ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Text.Heading")
            });
            textCol.Children.Add(new TextBlock
            {
                Text = f.Where, TextTrimming = TextTrimming.CharacterEllipsis,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.9"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var sev = new Border
            {
                CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                Background = new SolidColorBrush(((SolidColorBrush)SeverityBrush(f.Severity)).Color) { Opacity = 0.16 },
                Child = new TextBlock
                {
                    Text = f.Severity.ToString().ToUpperInvariant(),
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 8,
                    FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
                    Foreground = SeverityBrush(f.Severity)
                }
            };

            var ellipse = new Ellipse { Width = 7, Height = 7, VerticalAlignment = VerticalAlignment.Center, Fill = f.Fixed ? (Brush)FindResource("Brush.Status.Running") : SeverityBrush(f.Severity) };
            Grid.SetColumn(ellipse, 0);
            var textColWrap = new Border { Margin = new Thickness(8, 0, 8, 0), Child = textCol };
            Grid.SetColumn(textColWrap, 1);
            Grid.SetColumn(sev, 2);
            grid.Children.Add(ellipse);
            grid.Children.Add(textColWrap);
            grid.Children.Add(sev);

            row.Child = grid;
            var capturedId = f.CheckId;
            row.MouseLeftButtonDown += (s, e) => SelectGitDoctorFinding(capturedId);
            target.Children.Add(row);
        }
    }

    private void SelectGitDoctorFinding(string checkId)
    {
        _gdSelectedFindingId = checkId;
        _gdLookupResult = null;
        _gdLookupNotFound = false;
        GitDoctorQueryBox.Text = "";
        RenderGitDoctorFindingsList();
        RenderGitDoctorMiniFindingsList();
        RenderGitDoctorDetail();
    }

    private TextBlock GdLabel(string text) => new()
    {
        Text = text, Margin = new Thickness(0, 0, 0, 5),
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.8.5"),
        FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Dim")
    };

    private void RenderGitDoctorDetail()
    {
        GitDoctorDetailPanel.Children.Clear();

        if (_gdLookupNotFound)
        {
            RenderGitDoctorLookupNotFound();
            return;
        }
        if (_gdLookupResult != null)
        {
            RenderGitDoctorLookupResult(_gdLookupResult);
            return;
        }

        var sel = _gdFindings.FirstOrDefault(f => f.CheckId == _gdSelectedFindingId);
        if (sel == null)
        {
            GitDoctorDetailPanel.Children.Add(new TextBlock
            {
                Text = _gdLoaded ? "Nothing to show — pick a finding on the left." : "Running checks against the real repo…",
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }

        var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 9) };
        header.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 3, 7, 3), Margin = new Thickness(0, 0, 9, 0),
            Background = new SolidColorBrush(((SolidColorBrush)SeverityBrush(sel.Severity)).Color) { Opacity = 0.16 },
            BorderBrush = SeverityBrush(sel.Severity), BorderThickness = new Thickness(1),
            Child = new TextBlock { Text = sel.Severity.ToString().ToUpperInvariant(), FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = SeverityBrush(sel.Severity) }
        });
        header.Children.Add(new TextBlock
        {
            Text = sel.Title, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 9, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.15"),
            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading")
        });
        header.Children.Add(new TextBlock
        {
            Text = sel.Where, VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.10"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        GitDoctorDetailPanel.Children.Add(header);

        GitDoctorDetailPanel.Children.Add(new TextBlock
        {
            Text = sel.PlainEnglish, TextWrapping = TextWrapping.Wrap, MaxWidth = 660, Margin = new Thickness(0, 0, 0, 12),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12.5"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });

        GitDoctorDetailPanel.Children.Add(GdLabel("WHAT GIT ACTUALLY SAID"));
        GitDoctorDetailPanel.Children.Add(new Border
        {
            Padding = new Thickness(10, 9, 10, 9), CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 0, 0, 14),
            Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
            Child = new TextBlock
            {
                Text = sel.RawGitOutput, TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.11"),
                Foreground = new SolidColorBrush(Color.FromRgb(0xF0, 0xC9, 0xC2))
            }
        });

        if (sel.ShowsBranches)
            RenderGitDoctorBranchSection(sel);

        GitDoctorDetailPanel.Children.Add(GdLabel("HOW TO GET OUT OF IT"));
        var chosen = RemedyFor(sel);
        foreach (var r in sel.Remedies)
        {
            bool active = chosen?.Id == r.Id;
            var card = new Border
            {
                Padding = new Thickness(11, 10, 11, 10), CornerRadius = new CornerRadius(8), Cursor = Cursors.Hand,
                Margin = new Thickness(0, 0, 0, 7), MaxWidth = 660,
                Background = active ? new SolidColorBrush(((SolidColorBrush)RiskBrush(r.Risk)).Color) { Opacity = 0.07 } : (Brush)FindResource("Brush.Bg.Card"),
                BorderBrush = active ? RiskBrush(r.Risk) : (Brush)FindResource("Brush.Border.Card"),
                BorderThickness = new Thickness(1)
            };
            var body = new StackPanel();
            var top = new StackPanel { Orientation = Orientation.Horizontal };
            top.Children.Add(new Ellipse
            {
                Width = 12, Height = 12, Margin = new Thickness(0, 0, 8, 0),
                Stroke = active ? RiskBrush(r.Risk) : (Brush)FindResource("Brush.Border.Strong"),
                Fill = active ? RiskBrush(r.Risk) : Brushes.Transparent, StrokeThickness = 1
            });
            top.Children.Add(new TextBlock
            {
                Text = r.Label, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading")
            });
            if (r.Recommended)
                top.Children.Add(new Border
                {
                    CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 8, 0),
                    Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Status.Running")).Color) { Opacity = 0.16 },
                    Child = new TextBlock { Text = "RECOMMENDED", FontSize = 8, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Status.Running") }
                });
            top.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                Background = new SolidColorBrush(((SolidColorBrush)RiskBrush(r.Risk)).Color) { Opacity = 0.16 },
                Child = new TextBlock { Text = r.Risk.ToString().ToUpperInvariant(), FontSize = 8, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = RiskBrush(r.Risk) }
            });
            body.Children.Add(top);
            body.Children.Add(new TextBlock
            {
                Text = r.Preserves, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(20, 6, 0, 8),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = (Brush)FindResource("Brush.Text.Muted")
            });
            foreach (var st in r.Steps)
            {
                var stepRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(20, 0, 0, 3) };
                stepRow.Children.Add(new TextBlock
                {
                    Text = st.Cmd, Margin = new Thickness(0, 0, 9, 0), TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.10.5"),
                    Foreground = new SolidColorBrush(Color.FromRgb(0x7D, 0xC4, 0xF5))
                });
                stepRow.Children.Add(new TextBlock
                {
                    Text = st.Why, TextTrimming = TextTrimming.CharacterEllipsis,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.9.5"),
                    Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                body.Children.Add(stepRow);
            }
            card.Child = body;
            var capturedR = r.Id;
            card.MouseLeftButtonDown += (s, e) => { _gdRemedyChoice[sel.CheckId] = capturedR; RenderGitDoctorDetail(); };
            GitDoctorDetailPanel.Children.Add(card);
        }

        if (sel.CheckId == "auth")
            GitDoctorDetailPanel.Children.Add(BuildGitDoctorPastePatCard(sel));

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
        var runBtn = new Button
        {
            Content = sel.Fixed ? "Run it again" : "Run this fix", Height = 32, Padding = new Thickness(14, 0, 14, 0), Margin = new Thickness(0, 0, 6, 0),
            Background = chosen != null ? RiskBrush(chosen.Risk) : (Brush)FindResource("Brush.Status.Running"), Foreground = Brushes.Black,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"), BorderThickness = new Thickness(0), Cursor = Cursors.Hand
        };
        runBtn.Click += (s, e) => _ = RunGitDoctorRemedyAsync(sel);
        actions.Children.Add(runBtn);

        var askBtn = new Button
        {
            Content = "Ask Claude", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 0),
            Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Claude.Accent")).Color) { Opacity = 0.13 },
            Foreground = (Brush)FindResource("Brush.Claude.Accent"), BorderBrush = (Brush)FindResource("Brush.Claude.Accent"),
            BorderThickness = new Thickness(1), FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand
        };
        askBtn.Click += (s, e) => AskClaudeAboutFinding(sel);
        actions.Children.Add(askBtn);

        var copyBtn = new Button
        {
            Content = "Copy plan JSON", Height = 32, Padding = new Thickness(12, 0, 12, 0),
            Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Muted"),
            BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"), Cursor = Cursors.Hand
        };
        copyBtn.Click += (s, e) => CopyFindingPlanJson(sel);
        actions.Children.Add(copyBtn);

        GitDoctorDetailPanel.Children.Add(actions);
    }

    // Git #2205 — paste-a-fresh-PAT field on Git Doctor's auth finding. An alternative to the
    // "Re-authenticate with a fresh PAT" remedy's OS browser login flow: applies the pasted PAT
    // directly as the git credential and writes it to the same "secret:token:github" key Settings'
    // API Tokens card (#2204) already reads/writes, so both surfaces stay in sync.
    private bool _gdPasteBusy;

    private Border BuildGitDoctorPastePatCard(GitDoctorFinding sel)
    {
        var card = new Border
        {
            Padding = new Thickness(11, 10, 11, 10), CornerRadius = new CornerRadius(8),
            Margin = new Thickness(0, 0, 0, 7), MaxWidth = 660,
            Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
        };
        var body = new StackPanel();
        body.Children.Add(new TextBlock
        {
            Text = "Or paste a fresh PAT directly", Margin = new Thickness(0, 0, 0, 3),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading"),
        });
        body.Children.Add(new TextBlock
        {
            Text = "Applies it as the real git credential and saves it to Settings → API Tokens, no browser login.",
            TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 7),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Muted"),
        });

        var row = new DockPanel();
        var patBox = new PasswordBox
        {
            Height = 28, Padding = new Thickness(8, 0, 8, 0), VerticalContentAlignment = VerticalAlignment.Center,
            Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"),
            Foreground = (Brush)FindResource("Brush.Text.Primary"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
        };
        var applyBtn = new Button
        {
            Content = "Apply", Height = 28, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(6, 0, 0, 0),
            Background = (Brush)FindResource("Brush.Status.Running"), Foreground = Brushes.Black, BorderThickness = new Thickness(0),
            FontSize = 11, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand,
        };
        DockPanel.SetDock(applyBtn, Dock.Right);
        applyBtn.Click += (s, e) => _ = ApplyGitDoctorPastedPatAsync(sel, patBox.Password, applyBtn);
        row.Children.Add(applyBtn);
        row.Children.Add(patBox);
        body.Children.Add(row);

        card.Child = body;
        return card;
    }

    private async Task ApplyGitDoctorPastedPatAsync(GitDoctorFinding sel, string pat, Button applyBtn)
    {
        if (_gdPasteBusy) return;
        if (string.IsNullOrWhiteSpace(pat))
        {
            ToastEngine.Show("Git Doctor", "Paste a PAT first.", ToastKind.Warning);
            return;
        }

        _gdPasteBusy = true;
        applyBtn.IsEnabled = false;
        try
        {
            var (success, output) = await _gitDoctorService.ApplyGitHubPatAsync(pat);
            if (success)
            {
                SettingsStore.Set("secret:token:github", pat.Trim());
                sel.Fixed = true;
                ToastEngine.Show("Git Doctor", output, ToastKind.Success);
                await LoadGitDoctorChecksAsync();
            }
            else
            {
                ToastEngine.Show("Git Doctor", $"PAT rejected — {output}", ToastKind.Error);
            }
        }
        finally
        {
            _gdPasteBusy = false;
        }
    }

    private void RenderGitDoctorBranchSection(GitDoctorFinding sel)
    {
        GitDoctorDetailPanel.Children.Add(GdLabel("THE BRANCHES"));

        var filters = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 7) };
        (string Id, string Label, Func<GitDoctorBranch, bool> Pred)[] defs =
        {
            ("all", "All", _ => true),
            ("merged", "Merged", b => b.Merged),
            ("unmerged", "Unmerged", b => !b.Merged),
            ("gone", "Remote gone", b => b.RemoteGone),
            ("old", "Older than 90 d", b => b.AgeDays > 90)
        };
        foreach (var (id, label, pred) in defs)
        {
            int count = _gdBranches.Count(pred);
            bool active = _gdBranchFilter == id;
            var pill = new Border
            {
                Padding = new Thickness(9, 3, 9, 3), Margin = new Thickness(0, 0, 5, 0), CornerRadius = new CornerRadius(6), Cursor = Cursors.Hand,
                Background = active ? new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.14 } : Brushes.Transparent,
                BorderBrush = active ? (Brush)FindResource("Brush.Epic.AppCore") : (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = $"{label} ({count})", FontSize = 10, FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                    Foreground = active ? (Brush)FindResource("Brush.Epic.AppCore") : (Brush)FindResource("Brush.Text.Muted")
                }
            };
            var capturedId = id;
            pill.MouseLeftButtonDown += (s, e) => { _gdBranchFilter = capturedId; RenderGitDoctorDetail(); };
            filters.Children.Add(pill);
        }
        GitDoctorDetailPanel.Children.Add(filters);

        var filterDef = defs.First(d => d.Id == _gdBranchFilter);
        var filtered = _gdBranches.Where(filterDef.Pred).Take(60).ToList();

        var listBorder = new Border
        {
            MaxHeight = 230, CornerRadius = new CornerRadius(8), Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8),
            Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1)
        };
        var listScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var listPanel = new StackPanel();
        foreach (var b in filtered)
        {
            bool picked = _gdBranchSelection.TryGetValue(b.Name, out var v) ? v : b.Merged;
            var row = new Grid { Margin = new Thickness(6, 3, 6, 3) };
            var rowStack = new StackPanel { Orientation = Orientation.Horizontal };
            rowStack.Children.Add(new Border
            {
                Width = 12, Height = 12, CornerRadius = new CornerRadius(3), Margin = new Thickness(0, 0, 8, 0),
                Background = picked ? (Brush)FindResource("Brush.Epic.AppCore") : Brushes.Transparent,
                BorderBrush = picked ? (Brush)FindResource("Brush.Epic.AppCore") : (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1)
            });
            rowStack.Children.Add(new TextBlock
            {
                Text = b.Name, Width = 220, TextTrimming = TextTrimming.CharacterEllipsis,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                Foreground = b.Merged ? (Brush)FindResource("Brush.Text.Muted") : new SolidColorBrush(Color.FromRgb(0xF0, 0xC9, 0xC2))
            });
            rowStack.Children.Add(new TextBlock { Text = $"{b.AgeDays}d", Width = 42, TextAlignment = TextAlignment.Right, FontSize = 9, Foreground = (Brush)FindResource("Brush.Text.Dim") });
            rowStack.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(6, 0, 0, 0),
                Background = new SolidColorBrush(((SolidColorBrush)(b.Merged ? FindResource("Brush.Status.Running") : FindResource("Brush.Epic.Gate"))).Color) { Opacity = 0.14 },
                Child = new TextBlock { Text = b.Merged ? "merged" : $"{b.Ahead} unmerged", FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = b.Merged ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Epic.Gate") }
            });
            if (b.RemoteGone || b.InWorktree)
                rowStack.Children.Add(new TextBlock { Text = b.RemoteGone ? "remote gone" : "in a worktree", Margin = new Thickness(6, 0, 0, 0), FontSize = 8.5, Foreground = new SolidColorBrush(Color.FromRgb(0xA3, 0x74, 0xEA)) });
            row.Children.Add(rowStack);
            row.Cursor = Cursors.Hand;
            var capturedName = b.Name;
            row.MouseLeftButtonDown += (s, e) => { _gdBranchSelection[capturedName] = !picked; RenderGitDoctorDetail(); };
            listPanel.Children.Add(row);
        }
        listScroll.Content = listPanel;
        listBorder.Child = listScroll;
        GitDoctorDetailPanel.Children.Add(listBorder);

        int pickedCount = _gdBranches.Count(b => _gdBranchSelection.TryGetValue(b.Name, out var v) ? v : b.Merged);
        var actionRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 16) };
        var deleteBtn = new Button
        {
            Content = $"Delete {pickedCount} selected — backup tag first", Height = 32, Padding = new Thickness(14, 0, 14, 0), Margin = new Thickness(0, 0, 6, 0),
            Background = (Brush)FindResource("Brush.Epic.AppCore"), Foreground = Brushes.Black, BorderThickness = new Thickness(0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"), FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand
        };
        deleteBtn.Click += (s, e) => _ = DeleteSelectedBranchesAsync();
        actionRow.Children.Add(deleteBtn);
        var mergedOnlyBtn = new Button { Content = "Select merged only", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 0), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Primary"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
        mergedOnlyBtn.Click += (s, e) => { foreach (var b in _gdBranches) _gdBranchSelection[b.Name] = b.Merged; RenderGitDoctorDetail(); };
        actionRow.Children.Add(mergedOnlyBtn);
        var clearBtn = new Button { Content = "Clear", Height = 32, Padding = new Thickness(12, 0, 12, 0), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Muted"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
        clearBtn.Click += (s, e) => { foreach (var b in _gdBranches) _gdBranchSelection[b.Name] = false; RenderGitDoctorDetail(); };
        actionRow.Children.Add(clearBtn);
        GitDoctorDetailPanel.Children.Add(actionRow);
    }

    private async Task DeleteSelectedBranchesAsync()
    {
        var picked = _gdBranches.Where(b => _gdBranchSelection.TryGetValue(b.Name, out var v) ? v : b.Merged).ToList();
        if (picked.Count == 0) { ToastEngine.Show("Git Doctor", "Nothing selected.", ToastKind.Warning); return; }

        var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd-HHmmss");
        var steps = new List<GitDoctorStep> { new($"git tag backup/branches-{stamp}", $"anchor before deleting {picked.Count} branches") };
        foreach (var b in picked)
            steps.Add(new GitDoctorStep($"git branch {(b.Merged ? "-d" : "-D")} {b.Name}", b.Merged ? "merged, safe delete" : $"FORCED — {b.Ahead} unmerged commits"));
        steps.Add(new GitDoctorStep("git remote prune origin", "drop remote-tracking refs that no longer exist"));

        await RunGitDoctorStepsAsync(steps, $"Delete {picked.Count} branches", onDone: null);
        _gdBranchSelection.Clear();
        _gdBranches = await _gitDoctorService.ComputeBranchesAsync();
        RenderGitDoctorDetail();
    }

    private void RenderGitDoctorLookupResult(GitDoctorCommitInfo hit)
    {
        var top = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 9) };
        top.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 3, 7, 3), Margin = new Thickness(0, 0, 9, 0),
            Background = new SolidColorBrush(((SolidColorBrush)(hit.Reachable ? FindResource("Brush.Status.Running") : FindResource("Brush.Epic.Gate"))).Color) { Opacity = 0.16 },
            Child = new TextBlock { Text = hit.Reachable ? "REACHABLE" : "UNREACHABLE", FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = hit.Reachable ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Epic.Gate") }
        });
        top.Children.Add(new TextBlock { Text = hit.Sha[..9], FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 15, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading") });
        GitDoctorDetailPanel.Children.Add(top);
        GitDoctorDetailPanel.Children.Add(new TextBlock { Text = hit.Subject, TextWrapping = TextWrapping.Wrap, MaxWidth = 660, Margin = new Thickness(0, 0, 0, 9), FontSize = 12.5, Foreground = (Brush)FindResource("Brush.Text.Primary") });
        GitDoctorDetailPanel.Children.Add(new Border
        {
            Padding = new Thickness(10, 9, 10, 9), CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 0, 0, 11),
            Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
            Child = new TextBlock
            {
                Text = $"commit {hit.Sha}\nAuthor: {hit.Author}\nDate:   {hit.When}\nFound in: {hit.Where}\n{hit.Stat}",
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5, Foreground = (Brush)FindResource("Brush.Text.Muted")
            }
        });
        GitDoctorDetailPanel.Children.Add(GdLabel("FILES"));
        foreach (var f in hit.Files.Take(20))
            GitDoctorDetailPanel.Children.Add(new TextBlock { Text = f, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5, Margin = new Thickness(0, 0, 0, 1), Foreground = new SolidColorBrush(Color.FromRgb(0x7D, 0xC4, 0xF5)) });
        GitDoctorDetailPanel.Children.Add(new Border
        {
            Padding = new Thickness(9, 8, 9, 8), CornerRadius = new CornerRadius(7), MaxWidth = 660, Margin = new Thickness(0, 11, 0, 12),
            Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.07 },
            BorderBrush = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.28 }, BorderThickness = new Thickness(1),
            Child = new TextBlock { Text = hit.Notes, TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = new SolidColorBrush(Color.FromRgb(0xE6, 0xC9, 0x8D)) }
        });

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 18) };
        var branchBtn = new Button { Content = "Save it on a branch", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 0), Background = (Brush)FindResource("Brush.Status.Running"), Foreground = Brushes.Black, BorderThickness = new Thickness(0), FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand };
        branchBtn.Click += (s, e) => _ = RunGitDoctorStepsAsync(new[] { new GitDoctorStep($"git branch recover/{hit.Sha[..7]} {hit.Sha[..9]}", "make the commit reachable so it cannot be garbage collected") }, $"Save {hit.Sha[..9]} on a branch", null);
        actions.Children.Add(branchBtn);
        var cherryBtn = new Button { Content = "Cherry-pick here", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 0), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Primary"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
        cherryBtn.Click += (s, e) => _ = RunGitDoctorStepsAsync(new[] { new GitDoctorStep($"git cherry-pick {hit.Sha[..9]}", "replay it onto the branch you are on") }, $"Cherry-pick {hit.Sha[..9]}", null);
        actions.Children.Add(cherryBtn);
        var showBtn = new Button { Content = "Copy git show", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 0), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Primary"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
        showBtn.Click += (s, e) => { Clipboard.SetText($"git show {hit.Sha[..9]} --stat"); ToastEngine.Show("Git Doctor", "Copied git show command.", ToastKind.Info); };
        actions.Children.Add(showBtn);
        var askBtn = new Button { Content = "Ask Claude", Height = 32, Padding = new Thickness(12, 0, 12, 0), Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Claude.Accent")).Color) { Opacity = 0.13 }, Foreground = (Brush)FindResource("Brush.Claude.Accent"), BorderBrush = (Brush)FindResource("Brush.Claude.Accent"), BorderThickness = new Thickness(1), FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand };
        askBtn.Click += (s, e) =>
        {
            var md = $"**Git Doctor — commit {hit.Sha[..9]}**\n\n```\ncommit {hit.Sha}\nAuthor: {hit.Author}\nDate:   {hit.When}\n\n    {hit.Subject}\n\n{hit.Stat}\n```\n{hit.Notes}";
            Clipboard.SetText(md);
            ToastEngine.Show("Git Doctor", "Commit details copied — paste into the chat.", ToastKind.Info);
        };
        actions.Children.Add(askBtn);
        GitDoctorDetailPanel.Children.Add(actions);
    }

    private void RenderGitDoctorLookupNotFound()
    {
        var top = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 9) };
        top.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 3, 7, 3), Margin = new Thickness(0, 0, 9, 0),
            Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.16 },
            Child = new TextBlock { Text = "NOT FOUND", FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Epic.AppCore") }
        });
        top.Children.Add(new TextBlock { Text = _gdLookupQueryShown, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 15, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading") });
        GitDoctorDetailPanel.Children.Add(top);
        GitDoctorDetailPanel.Children.Add(new TextBlock
        {
            Text = "No object starting with that text was found in this repository or any of its worktrees. It may live on a remote you have not fetched, or in a worktree that was deleted.",
            TextWrapping = TextWrapping.Wrap, MaxWidth = 660, Margin = new Thickness(0, 0, 0, 12), FontSize = 12.5, Foreground = (Brush)FindResource("Brush.Text.Primary")
        });
        var huntBtn = new Button { Content = "Hunt for it everywhere", Height = 32, Padding = new Thickness(14, 0, 14, 0), Background = (Brush)FindResource("Brush.Epic.AppCore"), Foreground = Brushes.Black, BorderThickness = new Thickness(0), FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand };
        var capturedQuery = _gdLookupQueryShown;
        huntBtn.Click += (s, e) => _ = RunGitDoctorStepsAsync(new[]
        {
            new GitDoctorStep("git fetch --all --prune", "pull every remote ref"),
            new GitDoctorStep($"git log --all --oneline | findstr {capturedQuery}", "search every branch for the object"),
            new GitDoctorStep("git fsck --lost-found", "check dangling objects too")
        }, $"Hunt for {capturedQuery}", null);
        GitDoctorDetailPanel.Children.Add(huntBtn);
    }

    private void GitDoctorQueryBox_TextChanged(object sender, TextChangedEventArgs e) => _ = GitDoctorLookupAsync(GitDoctorQueryBox.Text.Trim());

    private async Task GitDoctorLookupAsync(string query)
    {
        if (query.Length == 0)
        {
            _gdLookupResult = null;
            _gdLookupNotFound = false;
            RenderGitDoctorDetail();
            return;
        }
        _gdLookupQueryShown = query;
        var isHashLike = query.Length >= 4 && query.All(c => Uri.IsHexDigit(c));
        if (!isHashLike)
        {
            _gdLookupResult = null;
            _gdLookupNotFound = true;
            RenderGitDoctorDetail();
            return;
        }

        var hit = await _gitDoctorService.LookupCommitAsync(query);
        if (GitDoctorQueryBox.Text.Trim() != query) return; // superseded by a newer keystroke
        _gdLookupResult = hit;
        _gdLookupNotFound = hit == null;
        RenderGitDoctorDetail();
    }

    private async Task RunGitDoctorRemedyAsync(GitDoctorFinding f)
    {
        var r = RemedyFor(f);
        if (r == null) return;
        await RunGitDoctorStepsAsync(r.Steps, $"{r.Label} — {f.Title}", () =>
        {
            f.Fixed = true;
            ToastEngine.Show("Git Doctor", $"{f.Title} — fixed.", ToastKind.Success);
        });
        RenderGitDoctor();
    }

    private async Task RunGitDoctorNightmareAsync()
    {
        var open = _gdFindings.Where(f => !f.Fixed).ToList();
        if (open.Count == 0) { ToastEngine.Show("Git Doctor", "Nothing left to fix — the repo is clean.", ToastKind.Info); return; }

        var stamp = DateTime.UtcNow.ToString("HHmmss");
        var steps = new List<GitDoctorStep> { new($"git branch backup/pre-doctor-{stamp}", "safety net before anything else") };
        foreach (var f in open)
        {
            var r = RemedyFor(f);
            if (r != null) steps.AddRange(r.Steps);
        }
        steps.Add(new GitDoctorStep("git status --short --branch", "prove the tree is clean at the end"));

        await RunGitDoctorStepsAsync(steps, $"End this git nightmare — {open.Count} findings, {steps.Count} commands", () =>
        {
            foreach (var f in open) f.Fixed = true;
            ToastEngine.Show("Git Doctor", "Repo is clean. Backup branch kept in case you want the old history.", ToastKind.Success);
        });
        RenderGitDoctor();
    }

    private void BtnGitDoctorNightmare_Click(object sender, RoutedEventArgs e) => _ = RunGitDoctorNightmareAsync();

    private async Task RunGitDoctorStepsAsync(IReadOnlyList<GitDoctorStep> steps, string label, Action? onDone)
    {
        _gdRunning = true;
        _gdLog.Clear();
        _gdLog.Add((label, null, true));
        RenderGitDoctorLog();
        RenderGitDoctorMiniLog();

        await foreach (var result in _gitDoctorService.RunStepsAsync(steps))
        {
            _gdLog.Add((result.Success ? result.Cmd : $"{result.Cmd}  (failed)", result.Why, false));
            RenderGitDoctorLog();
            RenderGitDoctorMiniLog();
        }

        _gdRunning = false;
        _gdLog.Add(($"Finished — {steps.Count} command{(steps.Count == 1 ? "" : "s")}.", null, false));
        RenderGitDoctorLog();
        RenderGitDoctorMiniLog();
        onDone?.Invoke();
    }

    private void RenderGitDoctorLog()
    {
        GitDoctorRunningLabel.Visibility = _gdRunning ? Visibility.Visible : Visibility.Collapsed;
        RenderGitDoctorLog(GitDoctorLogPanel);
    }

    private void RenderGitDoctorMiniLog()
    {
        GdMiniRunningLabel.Visibility = _gdRunning ? Visibility.Visible : Visibility.Collapsed;
        RenderGitDoctorLog(GdMiniLogPanel);
    }

    // Git #2218 §6.2 — the mini panel's own Run log (mono scroller), same _gdLog state the full
    // document's log already streams RunGitDoctorStepsAsync into.
    private void RenderGitDoctorLog(StackPanel target)
    {
        target.Children.Clear();
        if (_gdLog.Count == 0)
        {
            target.Children.Add(new TextBlock
            {
                Text = "Every command the doctor runs shows up here with the reason it ran, so you can paste the whole session into a chat if something still goes wrong.",
                TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10, Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }
        foreach (var (text, why, isHead) in _gdLog)
        {
            var row = new StackPanel { Margin = new Thickness(0, 0, 0, 4) };
            row.Children.Add(new TextBlock
            {
                Text = text, TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                Foreground = isHead ? (Brush)FindResource("Brush.Text.Heading") : (Brush)FindResource("Brush.Status.Running")
            });
            if (why != null)
                row.Children.Add(new TextBlock { Text = why, FontSize = 9, Foreground = (Brush)FindResource("Brush.Text.Dim") });
            target.Children.Add(row);
        }
    }

    private void AskClaudeAboutFinding(GitDoctorFinding f)
    {
        var r = RemedyFor(f);
        var md = $"**Git Doctor — {f.Title}** ({f.Where})\n\n```\n{f.RawGitOutput}\n```\n\nProposed remedy: {r?.Label} ({r?.Risk})\n```bash\n{string.Join("\n", r?.Steps.Select(s => s.Cmd) ?? Array.Empty<string>())}\n```\nIs this the right call, or is there something safer?";
        Clipboard.SetText(md);
        ToastEngine.Show("Git Doctor", "Finding and proposed fix copied — paste into the chat.", ToastKind.Info);
    }

    private void CopyFindingPlanJson(GitDoctorFinding f)
    {
        var r = RemedyFor(f);
        if (r == null) return;
        var plan = new { check = f.CheckId, severity = f.Severity.ToString().ToLowerInvariant(), remedy = r.Id, risk = r.Risk.ToString().ToLowerInvariant(), steps = r.Steps.Select(s => s.Cmd).ToArray() };
        Clipboard.SetText(JsonSerializer.Serialize(plan, new JsonSerializerOptions { WriteIndented = true }));
        ToastEngine.Show("Git Doctor", "Plan JSON copied.", ToastKind.Info);
    }

    private void GitDoctorSendAll_Click(object sender, MouseButtonEventArgs e)
    {
        var open = _gdFindings.Where(f => !f.Fixed).ToList();
        if (open.Count == 0) { ToastEngine.Show("Git Doctor", "No open findings to send.", ToastKind.Info); return; }
        var repoName = _gdRepoStatus?.Repo ?? "";
        var md = $"**Git Doctor — {open.Count} open findings on {repoName}**\n\n" +
            string.Join("\n", open.Select(f => $"- {f.Title} ({f.Severity}, {f.Where})\n```\n{f.RawGitOutput}\n```"));
        Clipboard.SetText(md);
        ToastEngine.Show("Git Doctor", "All open findings copied — paste into the chat.", ToastKind.Info);
    }

    private void BtnGitDoctorExtract_Click(object sender, RoutedEventArgs e) => ExtractGitDoctorPlanFrom(GitDoctorInboundBox.Text ?? "");

    private void GdMiniExtract_Click(object sender, RoutedEventArgs e) => ExtractGitDoctorPlanFrom(GdMiniInboundBox.Text ?? "");

    private void ExtractGitDoctorPlanFrom(string raw)
    {
        var lines = raw.Split('\n')
            .Select(l => System.Text.RegularExpressions.Regex.Replace(l, @"^\s*[$>#]\s*", "").Trim())
            .Where(l => l.Length > 0 && !l.StartsWith("```") && System.Text.RegularExpressions.Regex.IsMatch(l, @"^(git|del|cmdkey|ssh|rm)\b"))
            .ToList();

        if (lines.Count == 0)
        {
            ToastEngine.Show("Git Doctor", "No runnable commands found in that paste.", ToastKind.Warning);
            return;
        }

        _gdPlan = lines.Select(l => (l, true)).ToList();
        RenderGitDoctorPlan();
        RenderGitDoctorMiniPlan();
    }

    private void RenderGitDoctorPlan()
    {
        BtnGitDoctorRunPlan.Visibility = _gdPlan.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        RenderGitDoctorPlan(GitDoctorPlanPanel);
        GitDoctorRunPlanLabel.Text = $"Run {_gdPlan.Count(p => p.Approved)} approved";
    }

    private void RenderGitDoctorMiniPlan()
    {
        GdMiniRunPlan.Visibility = _gdPlan.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        RenderGitDoctorPlan(GdMiniPlanPanel);
        GdMiniRunPlanLabel.Text = $"Run {_gdPlan.Count(p => p.Approved)} approved";
    }

    // Git #2218 §6.2 — the mini panel's own Plan (checkbox rows of parsed commands), same _gdPlan
    // state the full document's own plan panel already tracks.
    private void RenderGitDoctorPlan(StackPanel target)
    {
        target.Children.Clear();
        if (_gdPlan.Count == 0) return;

        var box = new Border
        {
            Padding = new Thickness(7, 6, 7, 6), CornerRadius = new CornerRadius(6),
            Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1)
        };
        var stack = new StackPanel();
        for (int i = 0; i < _gdPlan.Count; i++)
        {
            var (cmd, approved) = _gdPlan[i];
            var row = new StackPanel { Orientation = Orientation.Horizontal, Cursor = Cursors.Hand, Margin = new Thickness(0, 1, 0, 1) };
            row.Children.Add(new Border
            {
                Width = 12, Height = 12, Margin = new Thickness(0, 2, 7, 0), CornerRadius = new CornerRadius(3),
                Background = approved ? (Brush)FindResource("Brush.Status.Running") : Brushes.Transparent,
                BorderBrush = approved ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1)
            });
            row.Children.Add(new TextBlock
            {
                Text = cmd, TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                Foreground = approved ? (Brush)FindResource("Brush.Text.Primary") : (Brush)FindResource("Brush.Text.Dim")
            });
            int capturedIndex = i;
            row.MouseLeftButtonDown += (s, e) =>
            {
                var (c, a) = _gdPlan[capturedIndex];
                _gdPlan[capturedIndex] = (c, !a);
                RenderGitDoctorPlan();
                RenderGitDoctorMiniPlan();
            };
            stack.Children.Add(row);
        }
        box.Child = stack;
        target.Children.Add(box);
    }

    private void BtnGitDoctorRunPlan_Click(object sender, RoutedEventArgs e) => RunGitDoctorApprovedPlan();

    private void GdMiniRunPlan_Click(object sender, RoutedEventArgs e) => RunGitDoctorApprovedPlan();

    private void RunGitDoctorApprovedPlan()
    {
        var approved = _gdPlan.Where(p => p.Approved).Select(p => new GitDoctorStep(p.Cmd, "from Claude")).ToList();
        if (approved.Count == 0)
        {
            ToastEngine.Show("Git Doctor", "Approve at least one command first.", ToastKind.Warning);
            return;
        }
        _ = RunGitDoctorStepsAsync(approved, $"Running Claude's plan — {approved.Count} commands", null);
    }

    // ── Git Doctor — mini rail panel (Git #2218, README-ClaudeChat.md §6.2) ─
    // 7th ClaudeChatDock flyout column. Toggle/maximize follow the exact same
    // mechanism as RepoHealth/SqlRunner above; the bridge actions below are the
    // one real behavioral difference from the full document (AppendToComposer
    // instead of Clipboard, since this panel sits next to the real composer).
    private void BtnToggleGitDoctorMini_Click(object sender, RoutedEventArgs e)
    {
        _gdMiniOpen = !_gdMiniOpen;
        GdMiniColumn.Width = new GridLength(_gdMiniOpen ? 300 : 0);
        if (_gdMiniOpen) _ = EnsureGitDoctorMiniLoadedAsync();
    }

    private void GdMiniMaximize_Click(object sender, MouseButtonEventArgs e)
    {
        _gdMiniOpen = false;
        GdMiniColumn.Width = new GridLength(0);
        OpenGitDoctor();
    }

    private void GdMiniRecheck_Click(object sender, MouseButtonEventArgs e) => _ = LoadGitDoctorChecksAsync();

    private void GdMiniNightmareBtn_Click(object sender, RoutedEventArgs e) => _ = RunGitDoctorNightmareAsync();

    private async Task EnsureGitDoctorMiniLoadedAsync()
    {
        if (_gdLoaded || _gdLoading) { RenderGitDoctorMini(); return; }
        await LoadGitDoctorChecksAsync();
    }

    // Claude bridge "send findings" — writes the currently-selected finding (or every open
    // finding if none is selected) into the real app-owned composer as a markdown block, same
    // §5 tool-writes-to-composer invariant RepoHealth's "Send N to this chat" already follows.
    // Never auto-sends.
    private void GdMiniSendFindings_Click(object sender, RoutedEventArgs e)
    {
        var open = _gdFindings.Where(f => !f.Fixed).ToList();
        if (open.Count == 0) { ToastEngine.Show("Git Doctor", "No open findings to send.", ToastKind.Info); return; }

        var selected = open.FirstOrDefault(f => f.CheckId == _gdSelectedFindingId);
        string md;
        if (selected != null)
        {
            var r = RemedyFor(selected);
            md = $"**Git Doctor — {selected.Title}** ({selected.Where})\n\n```\n{selected.RawGitOutput}\n```\n\nProposed remedy: {r?.Label} ({r?.Risk})\n```bash\n{string.Join("\n", r?.Steps.Select(s => s.Cmd) ?? Array.Empty<string>())}\n```\nIs this the right call, or is there something safer?";
        }
        else
        {
            var repoName = _gdRepoStatus?.Repo ?? "";
            md = $"**Git Doctor — {open.Count} open finding{(open.Count == 1 ? "" : "s")} on {repoName}**\n\n" +
                string.Join("\n", open.Select(f => $"- {f.Title} ({f.Severity}, {f.Where})\n```\n{f.RawGitOutput}\n```"));
        }
        AppendToComposer(md);
        ToastEngine.Show("Git Doctor", "Written into the composer — review, then Send.", ToastKind.Info);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Log Viewer — Step 10 (wpf-handoff/readme-phase2.md), corrected by issue
    // #2200's 2026-09-02 comment: level handling is per-source (Services/
    // LogService.cs), never one uniform InferLevel pass. Two surfaces share
    // this same state block — the Log Peek flyout (LogPeekPanel, 280px, bolted
    // onto ClaudeChatDock) and the full Log Viewer document (LogViewerDock) —
    // per the spec's "two surfaces, one state." "Send to chat" copies a
    // fenced ```log block to the clipboard and toasts, the same precedent
    // Git Doctor's own "send all findings" already set: ClaudeChatDock is the
    // real claude.ai site in a WebView2, not a composer this app owns, so
    // there is nothing to inject text into directly.
    // ══════════════════════════════════════════════════════════════════════

    private readonly LogService _logService = new();
    private bool _logViewerLoaded;

    private LogStreamMode _logStreamMode = LogStreamMode.Cold;
    private CancellationTokenSource? _logStreamCts;
    private DispatcherTimer? _logBurstTimer;
    private DispatcherTimer? _logRenderPumpTimer;
    private volatile bool _logBufferDirty;
    private int _logBurstSecondsLeft;
    private const int LogBurstDefaultSeconds = 30;

    private readonly List<LogLine> _logLiveBuffer = new();
    private readonly object _logBufferLock = new();
    private List<LogLine> _logDisplayed = new();
    private List<LogLine> _logLastRenderedLines = new();

    private readonly HashSet<string> _logEnabledSourceIds = new(LogService.Sources.Select(s => s.Id));
    private string _logSearchText = "";
    private bool _logRegex;
    private string _logExcludeText = "";
    private bool _logHighlight;
    private string? _logLoggerFilter;
    private readonly HashSet<LogLevel> _logSelectedLevels = new(Enum.GetValues<LogLevel>());
    private int _logScrubberMinutesBack;

    private LogLine? _logSelectedLine;
    private readonly List<LogLine> _logPinned = new();

    private string _logRailTab = "Sources";
    private readonly Dictionary<string, bool> _logRailGroupOpen = new() { ["Websites"] = true, ["Services"] = true, ["Local"] = true };
    private readonly HashSet<string> _logArchiveOpenDays = new();
    private IReadOnlyList<ArchiveNode>? _logArchiveCache;
    private bool _logViewingArchive;

    private readonly List<(string Name, LogQuery Query)> _logSavedFilters = new();

    private bool _logPeekOpen;
    private string _logPeekSearchText = "";
    private readonly HashSet<LogLine> _logPeekChecked = new();

    private void OpenLogViewer()
    {
        if (_tabs.Find(t => t.Id == "logviewer") == null)
            _tabs.Add(new TabDef("logviewer", "Log Viewer", isLogViewer: true, dot: (Brush)FindResource("Brush.LogSource.Console")));
        SelectTab("logviewer");
    }

    private void OpenRepoHealth()
    {
        if (_tabs.Find(t => t.Id == "repohealth") == null)
            _tabs.Add(new TabDef("repohealth", "Repo Health", isRepoHealth: true, dot: (Brush)FindResource("Brush.Epic.Gate")));
        SelectTab("repohealth");
    }

    private void EnsureLogViewerLoaded()
    {
        if (!_logViewerLoaded)
        {
            _logViewerLoaded = true;
            SeedLogSavedFilters();
            RefreshLogViewerQuery();
        }
        RenderLogViewer();
    }

    private void SeedLogSavedFilters()
    {
        _logSavedFilters.Add(("Graph 401s", new LogQuery("401", false, null, null, null, null, null, null)));
        _logSavedFilters.Add(("Drift aborts", new LogQuery("drift", false, new[] { "success" }, new[] { LogLevel.Error, LogLevel.Warn }, null, null, null, null)));
        _logSavedFilters.Add(("Build failures", new LogQuery("failed", false, null, new[] { LogLevel.Error, LogLevel.Fatal }, new[] { "build" }, null, null, null)));
    }

    private static string LogLevelBrushKey(LogLevel level) => level switch
    {
        LogLevel.Trace => "Brush.LogLevel.Trace",
        LogLevel.Debug => "Brush.LogLevel.Debug",
        LogLevel.Info => "Brush.LogLevel.Info",
        LogLevel.Warn => "Brush.LogLevel.Warn",
        LogLevel.Error => "Brush.LogLevel.Error",
        LogLevel.Fatal => "Brush.LogLevel.Fatal",
        _ => "Brush.LogLevel.Info"
    };

    private static string LogSourceBrushKey(string sourceId) => sourceId switch
    {
        "marketing" => "Brush.LogSource.Marketing",
        "portal" => "Brush.LogSource.Portal",
        "admin" => "Brush.LogSource.Admin",
        "api" => "Brush.LogSource.Api",
        "sql" => "Brush.LogSource.Sql",
        "build" => "Brush.LogSource.Build",
        "ssh" => "Brush.LogSource.Ssh",
        "terminal" => "Brush.LogSource.Terminal",
        "console" => "Brush.LogSource.Console",
        _ => "Brush.Text.Muted"
    };

    private List<LogLine> SnapshotLiveBuffer() { lock (_logBufferLock) { return _logLiveBuffer.ToList(); } }

    private List<LogLine> CurrentLoadedLines() =>
        _logStreamMode == LogStreamMode.Cold ? _logDisplayed : SnapshotLiveBuffer();

    // ── Top-level render ────────────────────────────────────────────────────
    private void RenderLogViewer()
    {
        RenderStreamSwitch(LogViewerStreamSwitch);
        RenderLogViewerStatusPill();
        RenderLogViewerRail();
        RenderLogViewerLevelPills();
        RenderLogViewerSavedFilterChips();
        if (!_logViewingArchive) RenderLogViewerLines();
        RenderLogViewerLineDetail();
        RenderLogViewerScratchPad();
        RenderLogViewerFilterChips();
    }

    private void RenderStreamSwitch(StackPanel host)
    {
        host.Children.Clear();
        foreach (var mode in new[] { LogStreamMode.Cold, LogStreamMode.Burst, LogStreamMode.Live })
        {
            bool active = _logStreamMode == mode;
            var btn = new Border
            {
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 2, 0),
                CornerRadius = new CornerRadius(4),
                Cursor = Cursors.Hand,
                Background = active ? (Brush)FindResource("Brush.Accent.Primary") : (Brush)FindResource("Brush.Bg.Chip"),
                Child = new TextBlock
                {
                    Text = mode.ToString().ToUpperInvariant(),
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                    FontSize = 9,
                    FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
                    Foreground = active ? Brushes.Black : (Brush)FindResource("Brush.Text.Muted")
                }
            };
            btn.MouseLeftButtonDown += (s, e) => SetLogStreamMode(mode);
            host.Children.Add(btn);
        }
    }

    private void RenderLogViewerStatusPill()
    {
        bool narrow = ActualWidth > 0 && ActualWidth < 1250;
        string text = _logStreamMode switch
        {
            LogStreamMode.Cold => narrow ? "COLD" : "COLD · NOT STREAMING",
            LogStreamMode.Burst => narrow ? $"{_logBurstSecondsLeft}s" : $"BURST · {_logBurstSecondsLeft}s LEFT",
            LogStreamMode.Live => narrow ? "LIVE" : "LIVE · TAILING",
            _ => ""
        };
        LogViewerStatusPill.Text = text;
        LogViewerStatusPill.Foreground = _logStreamMode switch
        {
            LogStreamMode.Live => (Brush)FindResource("Brush.Status.Running"),
            LogStreamMode.Burst => (Brush)FindResource("Brush.Status.Capped"),
            _ => (Brush)FindResource("Brush.Text.Dim")
        };
    }

    // ── Streaming — COLD/BURST/LIVE ─────────────────────────────────────────
    private void SetLogStreamMode(LogStreamMode mode)
    {
        StopLogStream();
        _logStreamMode = mode;

        if (mode != LogStreamMode.Cold)
        {
            lock (_logBufferLock) { _logLiveBuffer.Clear(); _logLiveBuffer.AddRange(_logDisplayed); }

            _logStreamCts = new CancellationTokenSource();
            var ct = _logStreamCts.Token;
            _ = Task.Run(() => ConsumeLogTailAsync(ct));

            _logRenderPumpTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
            _logRenderPumpTimer.Tick += (s, e) =>
            {
                if (!_logBufferDirty) return;
                _logBufferDirty = false;
                if (!_logViewingArchive) RenderLogViewerLines();
                RenderLogPeekLines();
                RenderLogViewerRail();
            };
            _logRenderPumpTimer.Start();

            if (mode == LogStreamMode.Burst)
            {
                _logBurstSecondsLeft = LogBurstDefaultSeconds;
                _logBurstTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                _logBurstTimer.Tick += (s, e) =>
                {
                    _logBurstSecondsLeft--;
                    RenderLogViewerStatusPill();
                    // BURST self-cancels back to COLD when the countdown hits zero —
                    // the "BURST counts down and self-cancels" done-when criterion.
                    if (_logBurstSecondsLeft <= 0) SetLogStreamMode(LogStreamMode.Cold);
                };
                _logBurstTimer.Start();
            }
        }

        RenderLogViewerStatusPill();
        RenderStreamSwitch(LogViewerStreamSwitch);
        RenderStreamSwitch(LogPeekStreamSwitch);
        if (mode == LogStreamMode.Cold)
        {
            if (!_logViewingArchive) RenderLogViewerLines();
            RenderLogPeekLines();
        }
    }

    private void StopLogStream()
    {
        _logBurstTimer?.Stop(); _logBurstTimer = null;
        _logRenderPumpTimer?.Stop(); _logRenderPumpTimer = null;
        _logStreamCts?.Cancel(); _logStreamCts = null;
    }

    private void RestartLogStreamIfActive()
    {
        if (_logStreamMode == LogStreamMode.Cold) return;
        var mode = _logStreamMode;
        var secondsLeft = _logBurstSecondsLeft;
        SetLogStreamMode(mode);
        if (mode == LogStreamMode.Burst) _logBurstSecondsLeft = secondsLeft; // source set changed — keep the same countdown
    }

    private async Task ConsumeLogTailAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var line in _logService.Tail(_logEnabledSourceIds, ct))
            {
                if (ct.IsCancellationRequested) break;
                lock (_logBufferLock)
                {
                    _logLiveBuffer.Add(line);
                    if (_logLiveBuffer.Count > 5000) _logLiveBuffer.RemoveAt(0);
                }
                _logBufferDirty = true;
            }
        }
        catch (OperationCanceledException) { /* expected on stop/mode-switch */ }
        catch { /* a streaming hiccup must never crash the app */ }
    }

    // ── COLD query (works regardless of streaming state) ────────────────────
    private void RefreshLogViewerQuery()
    {
        if (_logViewingArchive) return; // archive view owns the lines panel while open
        var q = BuildCurrentLogQuery();
        _logDisplayed = _logService.Query(q).ToList();
        if (_logStreamMode == LogStreamMode.Cold) RenderLogViewerLines();
        RenderLogViewerFilterChips();
    }

    private LogQuery BuildCurrentLogQuery()
    {
        DateTime? from = _logScrubberMinutesBack > 0 ? DateTime.Now.AddMinutes(-_logScrubberMinutesBack) : null;
        var excludes = string.IsNullOrWhiteSpace(_logExcludeText)
            ? null
            : _logExcludeText.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var levels = _logSelectedLevels.Count == Enum.GetValues<LogLevel>().Length ? null : _logSelectedLevels.ToArray();
        var sourceIds = _logEnabledSourceIds.Count == LogService.Sources.Count ? null : _logEnabledSourceIds.ToArray();
        // HIGHLIGHT mode dims non-matches instead of hiding them, so the search
        // text is deliberately withheld from the query itself when active —
        // RenderLogViewerLines applies it client-side as a dim, not a filter.
        var text = _logHighlight ? null : (string.IsNullOrWhiteSpace(_logSearchText) ? null : _logSearchText);
        return new LogQuery(text, _logRegex, excludes, levels, sourceIds, from, null, _logLoggerFilter);
    }

    private bool LineMatchesSearchText(LogLine line)
    {
        if (string.IsNullOrWhiteSpace(_logSearchText)) return true;
        if (_logRegex)
        {
            try { return Regex.IsMatch(line.Message, _logSearchText, RegexOptions.IgnoreCase); }
            catch { return false; }
        }
        return line.Message.Contains(_logSearchText, StringComparison.OrdinalIgnoreCase);
    }

    // ── Center stream ────────────────────────────────────────────────────────
    private void RenderLogViewerLines()
    {
        LogViewerLinesPanel.Children.Clear();

        var ordered = CurrentLoadedLines().OrderBy(l => l.Ts).TakeLast(600).ToList();
        _logLastRenderedLines = ordered;

        if (ordered.Count == 0)
        {
            LogViewerLinesPanel.Children.Add(new TextBlock
            {
                Text = "No lines match the current filter.",
                FontStyle = FontStyles.Italic,
                Margin = new Thickness(6),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }

        foreach (var line in ordered)
        {
            bool dim = _logHighlight && !string.IsNullOrWhiteSpace(_logSearchText) && !LineMatchesSearchText(line);
            LogViewerLinesPanel.Children.Add(BuildLogLineRow(line, dim));
        }
    }

    // An inferred level renders outline-only, never filled — a real
    // platform_log_stream level is the only one that gets the solid tinted
    // background. See InferLevel's own doc comment for why this distinction
    // is mandatory, not cosmetic. Shared by the full Log Viewer document AND
    // Log Peek (#2219 §6.4) — the mini panel must not re-derive its own
    // lighter-weight treatment of the same fact.
    private Border BuildLogLevelPill(LogLine line, double fontSize = 9)
    {
        var levelBrush = (Brush)FindResource(LogLevelBrushKey(line.Level));
        return new Border
        {
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(5, 1, 5, 1),
            Margin = new Thickness(0, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Top,
            BorderThickness = new Thickness(line.LevelIsInferred ? 1 : 0),
            BorderBrush = levelBrush,
            Background = line.LevelIsInferred
                ? Brushes.Transparent
                : new SolidColorBrush(((SolidColorBrush)levelBrush).Color) { Opacity = 0.22 },
            ToolTip = line.LevelIsInferred
                ? "Inferred from message text — no structured level exists for this source"
                : "Real level from platform_log_stream",
            Child = new TextBlock
            {
                Text = (line.LevelIsInferred ? "~" : "") + line.Level.ToString().ToUpperInvariant(),
                Foreground = levelBrush,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = fontSize,
                FontWeight = line.LevelIsInferred ? (FontWeight)FindResource("FontWeight.Regular") : (FontWeight)FindResource("FontWeight.Bold")
            }
        };
    }

    private Border BuildLogLineRow(LogLine line, bool dim)
    {
        var sourceBrush = (Brush)FindResource(LogSourceBrushKey(line.SourceId));
        bool isPinned = _logPinned.Contains(line);
        bool isSelected = _logSelectedLine != null && _logSelectedLine.Equals(line);
        var levelPill = BuildLogLevelPill(line);

        var row = new DockPanel
        {
            Margin = new Thickness(0, 1, 0, 1),
            Background = isSelected ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent,
            Opacity = dim ? 0.35 : 1.0
        };

        var pin = new TextBlock
        {
            Text = isPinned ? "★" : "☆",
            Margin = new Thickness(6, 0, 6, 0),
            Cursor = Cursors.Hand,
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 11,
            Foreground = isPinned ? (Brush)FindResource("Brush.Accent.IssueNum") : (Brush)FindResource("Brush.Text.Dim")
        };
        pin.MouseLeftButtonDown += (s, e) => { e.Handled = true; ToggleLogLinePin(line); };
        DockPanel.SetDock(pin, Dock.Right);

        var dot = new Ellipse { Width = 6, Height = 6, Fill = sourceBrush, Margin = new Thickness(6, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
        var ts = new TextBlock
        {
            Text = line.Ts.ToString("HH:mm:ss.fff"), Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10, Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        var msg = new TextBlock
        {
            Text = line.Message, Foreground = (Brush)FindResource("Brush.Text.Primary"),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 11,
            TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center
        };

        DockPanel.SetDock(dot, Dock.Left);
        DockPanel.SetDock(ts, Dock.Left);
        DockPanel.SetDock(levelPill, Dock.Left);
        row.Children.Add(pin);
        row.Children.Add(dot);
        row.Children.Add(ts);
        row.Children.Add(levelPill);
        row.Children.Add(msg);

        var outer = new Border { Child = row, Padding = new Thickness(0, 2, 4, 2), Cursor = Cursors.Hand };
        outer.MouseLeftButtonDown += (s, e) => LogViewerSelectLine(line);
        outer.ContextMenu = BuildLogLineContextMenu(line);
        return outer;
    }

    private ContextMenu BuildLogLineContextMenu(LogLine line)
    {
        return BuildContextMenu(
            ("", "Copy", () => Clipboard.SetText(FormatLogLine(line)), true, false),
            ("", "Copy ±3 context", () => CopyLogLineContext(line), true, false),
            ("", _logPinned.Contains(line) ? "Unpin" : "Pin", () => ToggleLogLinePin(line), true, false),
            ("", "Send to chat", () => SendLogLinesToChat(new[] { line }), true, false),
            ("", string.IsNullOrEmpty(line.Logger) ? "Follow this logger" : $"Follow logger: {line.Logger}",
                () => { _logLoggerFilter = line.Logger; RefreshLogViewerQuery(); RenderLogViewerFilterChips(); }, !string.IsNullOrEmpty(line.Logger), false)
        );
    }

    private static string FormatLogLine(LogLine l) =>
        $"[{l.Ts:HH:mm:ss.fff}] {(l.LevelIsInferred ? "~" : "")}{l.Level.ToString().ToUpperInvariant()} {l.SourceId}/{l.Logger}: {l.Message}";

    private void CopyLogLineContext(LogLine line)
    {
        int idx = _logLastRenderedLines.FindIndex(l => l.Equals(line));
        if (idx < 0) { Clipboard.SetText(FormatLogLine(line)); return; }
        int from = Math.Max(0, idx - 3), to = Math.Min(_logLastRenderedLines.Count - 1, idx + 3);
        var text = string.Join(Environment.NewLine, _logLastRenderedLines.Skip(from).Take(to - from + 1).Select(FormatLogLine));
        Clipboard.SetText(text);
        ToastEngine.Show("Log Viewer", "Copied line with ±3 context.", ToastKind.Info);
    }

    private void SendLogLinesToChat(IEnumerable<LogLine> lines)
    {
        var list = lines.ToList();
        if (list.Count == 0) { ToastEngine.Show("Log Viewer", "Nothing selected.", ToastKind.Warning); return; }
        var body = string.Join(Environment.NewLine, list.Select(FormatLogLine));
        Clipboard.SetText("```log\n" + body + "\n```");
        ToastEngine.Show("Log Viewer", $"Copied {list.Count} line(s) as a fenced log block — paste into the chat.", ToastKind.Info);
    }

    private void ToggleLogLinePin(LogLine line)
    {
        if (_logPinned.Contains(line)) _logPinned.Remove(line); else _logPinned.Add(line);
        RenderLogViewerLines();
        RenderLogViewerScratchPad();
    }

    private void LogViewerSelectLine(LogLine line)
    {
        _logSelectedLine = line;
        RenderLogViewerLines();
        RenderLogViewerLineDetail();
    }

    // ── Right inspector ──────────────────────────────────────────────────────
    private void RenderLogViewerLineDetail()
    {
        LogViewerLineDetail.Children.Clear();
        if (_logSelectedLine == null)
        {
            LogViewerLineDetail.Children.Add(new TextBlock
            {
                Text = "Select a line to see its detail.",
                FontStyle = FontStyles.Italic, TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }

        var l = _logSelectedLine;
        void Row(string label, string value)
        {
            var dock = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            dock.Children.Add(new TextBlock
            {
                Text = label, Width = 92, Foreground = (Brush)FindResource("Brush.Text.Dim"),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold")
            });
            dock.Children.Add(new TextBlock
            {
                Text = value, TextWrapping = TextWrapping.Wrap, Foreground = (Brush)FindResource("Brush.Text.Primary"),
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5
            });
            LogViewerLineDetail.Children.Add(dock);
        }

        Row("LEVEL", l.Level.ToString().ToUpperInvariant() + (l.LevelIsInferred ? " (inferred — no structured level for this source)" : " (real)"));
        Row("TIMESTAMP", l.Ts.ToString("yyyy-MM-dd HH:mm:ss.fff"));
        var src = LogService.Sources.FirstOrDefault(s => s.Id == l.SourceId);
        Row("SOURCE", src?.Label ?? l.SourceId);
        Row("LOGGER", string.IsNullOrEmpty(l.Logger) ? "—" : l.Logger);
        Row("CORRELATION ID", string.IsNullOrEmpty(l.CorrelationId) ? "—" : l.CorrelationId);

        LogViewerLineDetail.Children.Add(new TextBlock
        {
            Text = "MESSAGE", Margin = new Thickness(0, 4, 0, 4), Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold")
        });
        LogViewerLineDetail.Children.Add(new TextBox
        {
            Text = l.Message, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, BorderThickness = new Thickness(0),
            Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Primary"),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5
        });
    }

    private void RenderLogViewerFilterChips()
    {
        LogViewerFilterChips.Children.Clear();
        void Chip(string text, Action clear)
        {
            var chip = new Border
            {
                Margin = new Thickness(0, 0, 6, 6), Padding = new Thickness(8, 3, 6, 3), CornerRadius = new CornerRadius(10),
                Background = (Brush)FindResource("Brush.Bg.Chip")
            };
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(new TextBlock
            {
                Text = text, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
                Foreground = (Brush)FindResource("Brush.Text.Primary"), VerticalAlignment = VerticalAlignment.Center
            });
            var x = new TextBlock
            {
                Text = " ×", Cursor = Cursors.Hand, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
                Foreground = (Brush)FindResource("Brush.Text.Dim"), VerticalAlignment = VerticalAlignment.Center
            };
            x.MouseLeftButtonDown += (s, e) => clear();
            row.Children.Add(x);
            chip.Child = row;
            LogViewerFilterChips.Children.Add(chip);
        }

        if (!string.IsNullOrWhiteSpace(_logSearchText))
            Chip($"search: {_logSearchText}", () => { _logSearchText = ""; LogViewerSearchBox.Text = ""; RefreshLogViewerQuery(); });
        if (_logRegex)
            Chip("regex", () => { _logRegex = false; RefreshLogViewerQuery(); });
        if (!string.IsNullOrWhiteSpace(_logExcludeText))
            Chip($"exclude: {_logExcludeText}", () => { _logExcludeText = ""; LogViewerExcludeBox.Text = ""; RefreshLogViewerQuery(); });
        if (!string.IsNullOrEmpty(_logLoggerFilter))
            Chip($"logger: {_logLoggerFilter}", () => { _logLoggerFilter = null; RefreshLogViewerQuery(); });
        if (_logSelectedLevels.Count < Enum.GetValues<LogLevel>().Length)
            Chip($"levels: {string.Join(",", _logSelectedLevels)}", () =>
            {
                _logSelectedLevels.Clear();
                foreach (LogLevel lv in Enum.GetValues<LogLevel>()) _logSelectedLevels.Add(lv);
                RefreshLogViewerQuery(); RenderLogViewerLevelPills();
            });
        if (_logEnabledSourceIds.Count < LogService.Sources.Count)
            Chip($"sources: {_logEnabledSourceIds.Count}/{LogService.Sources.Count}", () =>
            {
                _logEnabledSourceIds.Clear();
                foreach (var s in LogService.Sources) _logEnabledSourceIds.Add(s.Id);
                RefreshLogViewerQuery(); RenderLogViewerRail();
            });

        if (LogViewerFilterChips.Children.Count == 0)
            LogViewerFilterChips.Children.Add(new TextBlock
            {
                Text = "None", FontStyle = FontStyles.Italic, FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 10, Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
    }

    // ── Scratch pad — pinned lines survive a filter change, per the
    // "pinned lines survive a filter change and paste as one block" done-when
    // criterion: they live in _logPinned, a set entirely separate from
    // _logDisplayed/_logLiveBuffer, so re-filtering never touches it.
    private void RenderLogViewerScratchPad()
    {
        LogViewerScratchPad.Children.Clear();
        if (_logPinned.Count == 0)
        {
            LogViewerScratchPad.Children.Add(new TextBlock
            {
                Text = "Pin a line to build a set here — it survives filter changes.",
                TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }
        foreach (var line in _logPinned)
        {
            var row = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            var unpin = new TextBlock
            {
                Text = "✕", FontSize = 10, Cursor = Cursors.Hand, Foreground = (Brush)FindResource("Brush.Text.Dim"),
                Margin = new Thickness(6, 0, 0, 0)
            };
            unpin.MouseLeftButtonDown += (s, e) => ToggleLogLinePin(line);
            DockPanel.SetDock(unpin, Dock.Right);
            row.Children.Add(unpin);
            row.Children.Add(new TextBlock
            {
                Text = FormatLogLine(line), TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10,
                Foreground = (Brush)FindResource("Brush.Text.Primary")
            });
            LogViewerScratchPad.Children.Add(row);
        }
    }

    private void LogViewerScratchCopy_Click(object sender, MouseButtonEventArgs e)
    {
        if (_logPinned.Count == 0) { ToastEngine.Show("Log Viewer", "Nothing pinned.", ToastKind.Warning); return; }
        Clipboard.SetText(string.Join(Environment.NewLine, _logPinned.Select(FormatLogLine)));
        ToastEngine.Show("Log Viewer", $"Copied {_logPinned.Count} pinned line(s) as one block.", ToastKind.Success);
    }

    private void LogViewerScratchSendToChat_Click(object sender, MouseButtonEventArgs e) => SendLogLinesToChat(_logPinned);

    // ── Filter bar ───────────────────────────────────────────────────────────
    private void LogViewerSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _logSearchText = LogViewerSearchBox.Text;
        if (_logStreamMode == LogStreamMode.Cold) RefreshLogViewerQuery();
        else { RenderLogViewerLines(); RenderLogViewerFilterChips(); }
    }

    private void BtnLogViewerRegex_Click(object sender, RoutedEventArgs e)
    {
        _logRegex = !_logRegex;
        BtnLogViewerRegex.Background = _logRegex ? (Brush)FindResource("Brush.Accent.Primary") : (Brush)FindResource("Brush.Bg.Chip");
        if (_logStreamMode == LogStreamMode.Cold) RefreshLogViewerQuery();
        else { RenderLogViewerLines(); RenderLogViewerFilterChips(); }
    }

    private void LogViewerExcludeBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _logExcludeText = LogViewerExcludeBox.Text;
        RefreshLogViewerQuery();
    }

    private void BtnLogViewerHighlight_Click(object sender, RoutedEventArgs e)
    {
        _logHighlight = !_logHighlight;
        BtnLogViewerHighlight.Background = _logHighlight ? (Brush)FindResource("Brush.Accent.Primary") : (Brush)FindResource("Brush.Bg.Chip");
        RefreshLogViewerQuery();
        RenderLogViewerLines();
    }

    private void LogViewerScrubber_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        _logScrubberMinutesBack = (int)e.NewValue;
        if (LogViewerScrubberReadout != null)
            LogViewerScrubberReadout.Text = _logScrubberMinutesBack == 0 ? "now" : $"{_logScrubberMinutesBack}m back";
        if (_logStreamMode == LogStreamMode.Cold) RefreshLogViewerQuery();
    }

    private void LogViewerSaveCurrentFilter_Click(object sender, MouseButtonEventArgs e)
    {
        var name = $"Filter {_logSavedFilters.Count + 1}";
        _logSavedFilters.Add((name, BuildCurrentLogQuery()));
        RenderLogViewerSavedFilterChips();
        ToastEngine.Show("Log Viewer", $"Saved as \"{name}\".", ToastKind.Success);
    }

    private void RenderLogViewerSavedFilterChips()
    {
        LogViewerSavedFilters.Children.Clear();
        foreach (var (name, query) in _logSavedFilters)
        {
            var chip = new Border
            {
                Margin = new Thickness(0, 0, 6, 0), Padding = new Thickness(8, 3, 8, 3), CornerRadius = new CornerRadius(10), Cursor = Cursors.Hand,
                Background = (Brush)FindResource("Brush.Bg.Chip"),
                Child = new TextBlock { Text = name, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5, Foreground = (Brush)FindResource("Brush.Text.Primary") }
            };
            chip.MouseLeftButtonDown += (s, e) => ApplySavedLogFilter(query);
            LogViewerSavedFilters.Children.Add(chip);
        }
    }

    private void ApplySavedLogFilter(LogQuery q)
    {
        _logSearchText = q.Text ?? ""; LogViewerSearchBox.Text = _logSearchText;
        _logRegex = q.Regex;
        _logExcludeText = q.Exclude != null ? string.Join(", ", q.Exclude) : ""; LogViewerExcludeBox.Text = _logExcludeText;
        _logSelectedLevels.Clear();
        foreach (var lv in q.Levels ?? Enum.GetValues<LogLevel>()) _logSelectedLevels.Add(lv);
        _logEnabledSourceIds.Clear();
        foreach (var id in q.SourceIds ?? LogService.Sources.Select(s => s.Id).ToArray()) _logEnabledSourceIds.Add(id);
        _logLoggerFilter = q.Logger;
        RenderLogViewerLevelPills();
        RenderLogViewerRail();
        RefreshLogViewerQuery();
    }

    private void RenderLogViewerLevelPills()
    {
        LogViewerLevelPills.Children.Clear();
        foreach (LogLevel level in Enum.GetValues<LogLevel>())
        {
            bool active = _logSelectedLevels.Contains(level);
            var brush = (Brush)FindResource(LogLevelBrushKey(level));
            var pill = new Border
            {
                Padding = new Thickness(8, 3, 8, 3), Margin = new Thickness(0, 0, 4, 0), CornerRadius = new CornerRadius(4), Cursor = Cursors.Hand,
                BorderThickness = new Thickness(1), BorderBrush = brush,
                Background = active ? new SolidColorBrush(((SolidColorBrush)brush).Color) { Opacity = 0.22 } : Brushes.Transparent,
                Child = new TextBlock
                {
                    Text = level.ToString().ToUpperInvariant(), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9,
                    Foreground = active ? brush : (Brush)FindResource("Brush.Text.Dim")
                }
            };
            pill.MouseLeftButtonDown += (s, e) =>
            {
                if (_logSelectedLevels.Contains(level)) _logSelectedLevels.Remove(level); else _logSelectedLevels.Add(level);
                RefreshLogViewerQuery();
                RenderLogViewerLevelPills();
            };
            LogViewerLevelPills.Children.Add(pill);
        }
    }

    // ── Left rail — Sources / Archive ───────────────────────────────────────
    private void BtnLogViewerRailSources_Click(object sender, RoutedEventArgs e) { _logRailTab = "Sources"; RenderLogViewerRail(); }
    private void BtnLogViewerRailArchive_Click(object sender, RoutedEventArgs e) { _logRailTab = "Archive"; RenderLogViewerRail(); }

    private void RenderLogViewerRail()
    {
        LogViewerRailContent.Children.Clear();
        BtnLogViewerRailSources.Background = _logRailTab == "Sources" ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent;
        BtnLogViewerRailArchive.Background = _logRailTab == "Archive" ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent;

        if (_logRailTab == "Sources") RenderLogViewerSourcesRail();
        else RenderLogViewerArchiveRail();
    }

    private void RenderLogViewerSourcesRail()
    {
        var counts = LogErrorCountsBySource();
        foreach (var group in LogService.Sources.Select(s => s.Group).Distinct())
        {
            bool open = _logRailGroupOpen.TryGetValue(group, out var o) && o;
            LogViewerRailContent.Children.Add(CollapsibleSection(group, "", open, () =>
            {
                _logRailGroupOpen[group] = !open;
                RenderLogViewerRail();
            }, () =>
            {
                var stack = new StackPanel();
                foreach (var src in LogService.Sources.Where(s => s.Group == group))
                    stack.Children.Add(BuildLogSourceRow(src, counts.GetValueOrDefault(src.Id, 0)));
                return stack;
            }));
        }
    }

    private Dictionary<string, int> LogErrorCountsBySource() =>
        CurrentLoadedLines()
            .Where(l => l.Level == LogLevel.Error || l.Level == LogLevel.Fatal)
            .GroupBy(l => l.SourceId)
            .ToDictionary(g => g.Key, g => g.Count());

    private Border BuildLogSourceRow(LogSource src, int errorCount)
    {
        bool enabled = _logEnabledSourceIds.Contains(src.Id);
        var brush = new SolidColorBrush(src.Colour);
        bool streamingNow = enabled && _logStreamMode != LogStreamMode.Cold;

        var row = new DockPanel { Margin = new Thickness(4, 5, 4, 5) };

        var toggle = new Border
        {
            Width = 30, Height = 16, CornerRadius = new CornerRadius(8), Cursor = Cursors.Hand,
            Background = enabled ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Bg.Chip"),
            Child = new Ellipse
            {
                Width = 12, Height = 12, Fill = Brushes.White,
                HorizontalAlignment = enabled ? HorizontalAlignment.Right : HorizontalAlignment.Left, Margin = new Thickness(2)
            }
        };
        toggle.MouseLeftButtonDown += (s, e) => { e.Handled = true; ToggleLogSourceEnabled(src.Id); };
        DockPanel.SetDock(toggle, Dock.Right);
        row.Children.Add(toggle);

        if (errorCount > 0)
        {
            var badge = new TextBlock
            {
                Text = errorCount.ToString(), Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("Brush.LogLevel.Error"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                FontSize = 9.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold")
            };
            DockPanel.SetDock(badge, Dock.Right);
            row.Children.Add(badge);
        }

        var dotBorder = new Border
        {
            Width = 8, Height = 8, CornerRadius = new CornerRadius(4), Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center,
            Background = brush,
            Effect = streamingNow ? new System.Windows.Media.Effects.DropShadowEffect { Color = src.Colour, BlurRadius = 8, ShadowDepth = 0, Opacity = 0.9 } : null
        };
        row.Children.Add(dotBorder);

        row.Children.Add(new TextBlock
        {
            Text = src.Label, VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });

        return new Border { Child = row };
    }

    private void ToggleLogSourceEnabled(string sourceId)
    {
        if (_logEnabledSourceIds.Contains(sourceId)) _logEnabledSourceIds.Remove(sourceId); else _logEnabledSourceIds.Add(sourceId);
        RenderLogViewerRail();
        RenderLogViewerFilterChips();
        RefreshLogViewerQuery();
        RestartLogStreamIfActive();
        RenderLogPeekSourceChips();
    }

    // ── Archive tab — real day → build → bookend tree, see LogService.Archive()'s
    // own header comment for why there is no fabricated stdout.log leaf.
    private void RenderLogViewerArchiveRail()
    {
        var openBox = new TextBox
        {
            Height = 26, Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(6, 0, 6, 0), VerticalContentAlignment = VerticalAlignment.Center,
            Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"),
            Foreground = (Brush)FindResource("Brush.Text.Heading"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
            Tag = "Open bookend by Git ID…"
        };
        openBox.KeyDown += (s, e) =>
        {
            if (e.Key != Key.Enter || string.IsNullOrWhiteSpace(openBox.Text)) return;
            var id = openBox.Text.Trim();
            var content = _logService.OpenBookendByGitId(id);
            if (content == null) { ToastEngine.Show("Log Viewer", $"No bookend found for #{id}.", ToastKind.Warning); return; }
            var leaf = new ArchiveNode(id + "-bookend", $"{id}.md (bookend)", "bookend", Array.Empty<ArchiveNode>(),
                FilePath: System.IO.Path.Combine(_logService.MainRepoRoot ?? "", "build-journal", id + ".md"), GitIssueId: id);
            LogViewerOpenArchiveLeaf(leaf);
        };
        LogViewerRailContent.Children.Add(openBox);

        _logArchiveCache ??= _logService.Archive();
        if (_logArchiveCache.Count == 0)
        {
            LogViewerRailContent.Children.Add(new TextBlock
            {
                Text = "No build-journal bookends found.", TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            return;
        }
        foreach (var day in _logArchiveCache.Take(30))
            LogViewerRailContent.Children.Add(BuildArchiveDayNode(day));
    }

    private Border BuildArchiveDayNode(ArchiveNode day)
    {
        bool open = _logArchiveOpenDays.Contains(day.Id);
        return CollapsibleSection($"{day.Label} ({day.Children.Count})", "", open, () =>
        {
            if (open) _logArchiveOpenDays.Remove(day.Id); else _logArchiveOpenDays.Add(day.Id);
            RenderLogViewerRail();
        }, () =>
        {
            var stack = new StackPanel();
            foreach (var build in day.Children) stack.Children.Add(BuildArchiveBuildNode(build));
            return stack;
        });
    }

    private FrameworkElement BuildArchiveBuildNode(ArchiveNode build)
    {
        var stack = new StackPanel { Margin = new Thickness(10, 2, 4, 6) };
        stack.Children.Add(new TextBlock
        {
            Text = build.Label, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 2),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10, FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Primary")
        });
        foreach (var leaf in build.Children)
        {
            var leafRow = new TextBlock
            {
                Text = leaf.Label, Cursor = Cursors.Hand, Margin = new Thickness(0, 0, 0, 2),
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5, Foreground = (Brush)FindResource("Brush.Claude.Accent")
            };
            leafRow.MouseLeftButtonDown += (s, e) => LogViewerOpenArchiveLeaf(leaf);
            stack.Children.Add(leafRow);
        }
        return stack;
    }

    private void LogViewerOpenArchiveLeaf(ArchiveNode leaf)
    {
        if (leaf.FilePath == null) return;
        var content = _logService.ReadArchiveFile(leaf.FilePath);
        if (content == null) { ToastEngine.Show("Log Viewer", "Could not read that archive file.", ToastKind.Error); return; }

        StopLogStream();
        _logStreamMode = LogStreamMode.Cold;
        _logViewingArchive = true;
        LogViewerArchiveBanner.Visibility = Visibility.Visible;
        LogViewerArchiveBannerText.Text = $"ARCHIVE — READ-ONLY — {leaf.GitIssueId} ({leaf.Label})";

        LogViewerLinesPanel.Children.Clear();
        LogViewerLinesPanel.Children.Add(new TextBox
        {
            Text = content, IsReadOnly = true, TextWrapping = TextWrapping.NoWrap, AcceptsReturn = true,
            Background = Brushes.Transparent, BorderThickness = new Thickness(0),
            Foreground = (Brush)FindResource("Brush.Text.Primary"),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 11
        });

        RenderLogViewerStatusPill();
        RenderStreamSwitch(LogViewerStreamSwitch);
    }

    private void LogViewerCloseArchiveBanner_Click(object sender, MouseButtonEventArgs e)
    {
        _logViewingArchive = false;
        LogViewerArchiveBanner.Visibility = Visibility.Collapsed;
        RefreshLogViewerQuery();
    }

    // ── Log Peek — the chat document's own 280px tool-panel flyout ──────────
    private void BtnToggleLogPeek_Click(object sender, RoutedEventArgs e)
    {
        _logPeekOpen = !_logPeekOpen;
        LogPeekColumn.Width = new GridLength(_logPeekOpen ? 280 : 0);
        if (_logPeekOpen) RenderLogPeek();
    }

    private void LogPeekMaximize_Click(object sender, MouseButtonEventArgs e)
    {
        _logPeekOpen = false;
        LogPeekColumn.Width = new GridLength(0);
        OpenLogViewer();
    }

    private void LogPeekSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _logPeekSearchText = LogPeekSearchBox.Text;
        RenderLogPeekLines();
    }

    private void RenderLogPeek()
    {
        if (!_logPeekOpen) return;
        RenderLogPeekSourceChips();
        RenderStreamSwitch(LogPeekStreamSwitch);
        RenderLogPeekLines();
    }

    private void RenderLogPeekSourceChips()
    {
        LogPeekSourceChips.Children.Clear();
        foreach (var src in LogService.Sources)
        {
            bool enabled = _logEnabledSourceIds.Contains(src.Id);
            var chip = new Border
            {
                Margin = new Thickness(0, 0, 4, 4), Padding = new Thickness(6, 2, 6, 2), CornerRadius = new CornerRadius(8), Cursor = Cursors.Hand,
                Background = enabled ? new SolidColorBrush(src.Colour) { Opacity = 0.28 } : (Brush)FindResource("Brush.Claude.Bg.Button"),
                BorderBrush = new SolidColorBrush(src.Colour), BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = src.Label, FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 8.5,
                    Foreground = enabled ? new SolidColorBrush(src.Colour) : (Brush)FindResource("Brush.Claude.Text.Muted")
                }
            };
            chip.MouseLeftButtonDown += (s, e) => ToggleLogSourceEnabled(src.Id);
            LogPeekSourceChips.Children.Add(chip);
        }
    }

    private void RenderLogPeekLines()
    {
        if (!_logPeekOpen) return;
        LogPeekLinesPanel.Children.Clear();
        var lines = CurrentLoadedLines()
            .Where(l => string.IsNullOrWhiteSpace(_logPeekSearchText) || l.Message.Contains(_logPeekSearchText, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(l => l.Ts)
            .Take(100)
            .ToList();

        foreach (var line in lines)
        {
            var row = new DockPanel { Margin = new Thickness(0, 0, 0, 4) };
            var cb = new CheckBox { IsChecked = _logPeekChecked.Contains(line), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 2, 4, 0) };
            cb.Checked += (s, e) => { _logPeekChecked.Add(line); UpdateLogPeekSendLabel(); };
            cb.Unchecked += (s, e) => { _logPeekChecked.Remove(line); UpdateLogPeekSendLabel(); };
            DockPanel.SetDock(cb, Dock.Left);
            row.Children.Add(cb);

            var pill = BuildLogLevelPill(line, fontSize: 8);
            DockPanel.SetDock(pill, Dock.Left);
            row.Children.Add(pill);

            row.Children.Add(new TextBlock
            {
                Text = $"[{line.Ts:HH:mm:ss}] {line.Message}", TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
                Foreground = (Brush)FindResource("Brush.Text.Primary")
            });
            LogPeekLinesPanel.Children.Add(row);
        }
        UpdateLogPeekSendLabel();
    }

    private void UpdateLogPeekSendLabel()
    {
        if (LogPeekSendToChatLabel != null) LogPeekSendToChatLabel.Text = $"Send {_logPeekChecked.Count} to chat";
    }

    private void BtnLogPeekSendToChat_Click(object sender, RoutedEventArgs e)
    {
        SendLogLinesToChat(_logPeekChecked);
        _logPeekChecked.Clear();
        RenderLogPeekLines();
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // Git #2215 — SQL Runner mini panel. Real execution against the local Postgres DATABASE_URL
    // (Services/SqlRunnerService.cs), statement splitting/rendering ported from BuildConsole's
    // already-working Controls/SqlDocumentView.xaml.cs + Services/LocalSqlExecutor.cs rather than
    // reimplemented. Same bolt-on-flyout mechanism as Log Peek (5th tool-panel column).
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    private bool _sqlRunnerOpen;
    private const double SqlRunnerWidthOpen = 380;
    private const int SqlRunnerMaxSendRows = 200;

    private List<SqlStatementResult>? _sqlLastStatements;
    private readonly List<DataTable> _sqlLastResultTables = new();
    private string _sqlLastResultQuery = "";

    private void BtnToggleSqlRunner_Click(object sender, RoutedEventArgs e)
    {
        _sqlRunnerOpen = !_sqlRunnerOpen;
        SqlRunnerColumn.Width = new GridLength(_sqlRunnerOpen ? SqlRunnerWidthOpen : 0);
        if (_sqlRunnerOpen) UpdateSqlRunnerGutter();
    }

    // Gutter-numbered mono editor (§6.7) — the gutter is regenerated on every keystroke rather than
    // tracked incrementally; at mini-panel scale (a handful of ad-hoc statements, not a document)
    // that's cheap enough not to matter and keeps this from needing a real text-editor dependency.
    private void SqlRunnerEditor_TextChanged(object sender, TextChangedEventArgs e) => UpdateSqlRunnerGutter();

    private void UpdateSqlRunnerGutter()
    {
        if (SqlRunnerGutter == null || SqlRunnerEditor == null) return;
        int lineCount = Math.Max(1, SqlRunnerEditor.LineCount <= 0 ? 1 : SqlRunnerEditor.LineCount);
        var sb = new StringBuilder();
        for (int i = 1; i <= lineCount; i++)
        {
            if (i > 1) sb.Append('\n');
            sb.Append(i);
        }
        SqlRunnerGutter.Text = sb.ToString();
    }

    private void SqlRunnerEditor_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            e.Handled = true;
            BtnSqlRunnerExecute_Click(sender, new RoutedEventArgs());
        }
    }

    private async void BtnSqlRunnerExecute_Click(object sender, RoutedEventArgs e)
    {
        var query = SqlRunnerEditor.Text.Trim();
        if (string.IsNullOrEmpty(query))
        {
            SqlRunnerStatus.Text = "Nothing to execute.";
            return;
        }

        var connStr = SqlRunnerService.ResolveConnectionString();
        if (string.IsNullOrWhiteSpace(connStr))
        {
            SqlRunnerStatus.Text = "No DATABASE_URL found — add it to .env.local at the repo root.";
            return;
        }

        SqlRunnerStatus.Text = "Executing…";
        BtnSqlRunnerExecute.IsEnabled = false;
        try
        {
            var statements = await SqlRunnerService.ExecuteAsync(connStr, query);
            RenderSqlRunnerResults(statements);
        }
        catch (Exception ex)
        {
            SqlRunnerStatus.Text = $"Execute failed: {ex.Message}";
            SqlRunnerResultsStack.Children.Clear();
            SqlRunnerRowCount.Text = "Error";
            _sqlLastResultTables.Clear();
            _sqlLastStatements = null;
            BtnSqlRunnerCopyCsv.IsEnabled = false;
            BtnSqlRunnerCopyJson.IsEnabled = false;
            BtnSqlRunnerSendToChat.IsEnabled = false;
        }
        finally
        {
            BtnSqlRunnerExecute.IsEnabled = true;
        }
    }

    private void RenderSqlRunnerResults(List<SqlStatementResult> statements)
    {
        _sqlLastStatements = statements;
        _sqlLastResultTables.Clear();
        SqlRunnerResultsStack.Children.Clear();
        SqlRunnerJsonView.Text = "";

        var failed = statements.Count(s => !s.Success);
        var succeeded = statements.Count - failed;
        var totalMs = statements.Sum(s => s.ExecutionMs);

        if (statements.Count == 0)
        {
            SqlRunnerStatus.Text = "No statements found.";
            SqlRunnerRowCount.Text = "0 rows";
            BtnSqlRunnerCopyCsv.IsEnabled = false;
            BtnSqlRunnerCopyJson.IsEnabled = false;
            BtnSqlRunnerSendToChat.IsEnabled = false;
            return;
        }

        SqlRunnerStatus.Text = failed > 0
            ? $"{succeeded}/{statements.Count} succeeded, {failed} failed ({totalMs}ms). First error: {statements.First(s => !s.Success).Error}"
            : $"{succeeded} statement{(succeeded == 1 ? "" : "s")} succeeded ({totalMs}ms).";

        var jsonOpts = new JsonSerializerOptions { WriteIndented = true };
        SqlRunnerJsonView.Text = JsonSerializer.Serialize(statements, jsonOpts);

        int totalRows = 0;
        for (int i = 0; i < statements.Count; i++)
        {
            var stmt = statements[i];
            int stmtNum = stmt.StatementIndex >= 0 ? stmt.StatementIndex + 1 : i + 1;

            if (stmt.Success && stmt.Fields.Count > 0)
            {
                var table = new DataTable();
                foreach (var field in stmt.Fields) table.Columns.Add(field, typeof(string));
                foreach (var row in stmt.Rows)
                {
                    var dr = table.NewRow();
                    foreach (var field in stmt.Fields)
                        dr[field] = row.TryGetValue(field, out var value) ? SqlRunnerService.JsonElementToDisplayString(value) : "";
                    table.Rows.Add(dr);
                }
                _sqlLastResultTables.Add(table);
                totalRows += table.Rows.Count;

                SqlRunnerResultsStack.Children.Add(new TextBlock
                {
                    Text = $"Statement {stmtNum} — {table.Rows.Count} row{(table.Rows.Count == 1 ? "" : "s")} ({stmt.ExecutionMs}ms)",
                    FontSize = 10, FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
                    Margin = new Thickness(0, i == 0 ? 0 : 10, 0, 4)
                });

                SqlRunnerResultsStack.Children.Add(new DataGrid
                {
                    IsReadOnly = true, AutoGenerateColumns = true, BorderThickness = new Thickness(0),
                    MaxHeight = statements.Count > 1 ? 220 : double.PositiveInfinity,
                    RowBackground = Brushes.Transparent, FontSize = 10.5,
                    ItemsSource = table.DefaultView
                });
            }
            else if (stmt.Success)
            {
                var sp = new StackPanel { Margin = new Thickness(0, i == 0 ? 0 : 8, 0, 4) };
                sp.Children.Add(new TextBlock
                {
                    Text = $"✅ Statement {stmtNum}: OK" + (stmt.RowCount > 0 ? $" — {stmt.RowCount} row{(stmt.RowCount == 1 ? "" : "s")} affected" : "") + $" ({stmt.ExecutionMs}ms)",
                    FontSize = 10.5, FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("Brush.Status.Running"), TextWrapping = TextWrapping.Wrap
                });
                SqlRunnerResultsStack.Children.Add(sp);
            }
            else
            {
                var sp = new StackPanel { Margin = new Thickness(0, i == 0 ? 0 : 8, 0, 4) };
                sp.Children.Add(new TextBlock
                {
                    Text = $"❌ Statement {stmtNum}: Failed ({stmt.ExecutionMs}ms)",
                    FontSize = 10.5, FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)FindResource("Brush.Status.Blocked")
                });
                sp.Children.Add(new TextBlock
                {
                    Text = stmt.Error ?? "Execution error", FontSize = 10, TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("Brush.Status.Blocked")
                });
                SqlRunnerResultsStack.Children.Add(sp);
            }
        }

        SqlRunnerRowCount.Text = totalRows > 0
            ? (_sqlLastResultTables.Count > 1 ? $"{totalRows} rows ({_sqlLastResultTables.Count} result sets)" : $"{totalRows} row{(totalRows == 1 ? "" : "s")}")
            : failed > 0 ? $"{failed} error{(failed == 1 ? "" : "s")}" : $"{statements.Count} OK";

        bool hasData = _sqlLastResultTables.Any(t => t.Rows.Count > 0);
        BtnSqlRunnerCopyCsv.IsEnabled = hasData;
        BtnSqlRunnerCopyJson.IsEnabled = statements.Count > 0;
        BtnSqlRunnerSendToChat.IsEnabled = statements.Any(s => s.Success);

        _sqlLastResultQuery = SqlRunnerEditor.Text.Trim();
    }

    private void SqlRunnerViewTableBtn_Click(object sender, RoutedEventArgs e)
    {
        SqlRunnerTableScrollView.Visibility = Visibility.Visible;
        SqlRunnerJsonView.Visibility = Visibility.Collapsed;
    }

    private void SqlRunnerViewJsonBtn_Click(object sender, RoutedEventArgs e)
    {
        SqlRunnerJsonView.Visibility = Visibility.Visible;
        SqlRunnerTableScrollView.Visibility = Visibility.Collapsed;
    }

    private void BtnSqlRunnerCopyCsv_Click(object sender, RoutedEventArgs e)
    {
        if (_sqlLastResultTables.Count == 0) return;
        if (_sqlLastResultTables.Count == 1)
        {
            Clipboard.SetText(SqlRunnerBuildCsv(_sqlLastResultTables[0]));
        }
        else
        {
            var sb = new StringBuilder();
            for (int i = 0; i < _sqlLastResultTables.Count; i++)
            {
                sb.AppendLine($"-- Statement {i + 1}");
                sb.AppendLine(SqlRunnerBuildCsv(_sqlLastResultTables[i]));
                sb.AppendLine();
            }
            Clipboard.SetText(sb.ToString().TrimEnd());
        }
        SqlRunnerStatus.Text = "Copied CSV to clipboard.";
    }

    private void BtnSqlRunnerCopyJson_Click(object sender, RoutedEventArgs e)
    {
        if (_sqlLastStatements == null || _sqlLastStatements.Count == 0) return;
        Clipboard.SetText(SqlRunnerJsonView.Text);
        SqlRunnerStatus.Text = "Copied JSON to clipboard.";
    }

    // "Send result to chat box" (§6.7) — writes into the shared app-owned composer via
    // AppendToComposer, the same tool-writes-to-composer path every other panel uses. Never
    // auto-sends (§5).
    private void BtnSqlRunnerSendToChat_Click(object sender, RoutedEventArgs e)
    {
        var table = _sqlLastResultTables.FirstOrDefault(t => t.Rows.Count > 0);
        if (table != null)
        {
            AppendToComposer(SqlRunnerBuildMarkdownForChat(table));
            SqlRunnerStatus.Text = "Sent to chat composer.";
        }
        else if (_sqlLastStatements != null && _sqlLastStatements.Count > 0)
        {
            AppendToComposer(SqlRunnerBuildNonSelectMarkdownForChat(_sqlLastStatements));
            SqlRunnerStatus.Text = "Sent to chat composer.";
        }
        else
        {
            SqlRunnerStatus.Text = "Nothing to send — run a query first.";
        }
    }

    private static string SqlRunnerBuildNonSelectMarkdownForChat(List<SqlStatementResult> statements)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"SQL Runner execution result — {statements.Count} statement{(statements.Count == 1 ? "" : "s")}:");
        sb.AppendLine();
        foreach (var s in statements)
        {
            int idx = s.StatementIndex >= 0 ? s.StatementIndex + 1 : 1;
            sb.AppendLine(s.Success
                ? $"- ✅ **Statement {idx}**: {(s.RowCount > 0 ? $"{s.RowCount} row(s) affected" : "OK")} ({s.ExecutionMs}ms)"
                : $"- ❌ **Statement {idx}**: Failed — {s.Error} ({s.ExecutionMs}ms)");
        }
        return sb.ToString().TrimEnd();
    }

    private static string SqlRunnerBuildMarkdownForChat(DataTable table)
    {
        var cols = table.Columns.Cast<DataColumn>().Select(c => c.ColumnName).ToList();
        int total = table.Rows.Count;
        int shown = Math.Min(total, SqlRunnerMaxSendRows);

        var sb = new StringBuilder();
        sb.AppendLine($"SQL Runner result — {total} row{(total == 1 ? "" : "s")}" + (total > shown ? $" (showing first {shown})" : "") + ":");
        sb.AppendLine();
        sb.AppendLine("| " + string.Join(" | ", cols.Select(SqlRunnerEscapeCell)) + " |");
        sb.AppendLine("| " + string.Join(" | ", cols.Select(_ => "---")) + " |");
        for (int i = 0; i < shown; i++)
        {
            var row = table.Rows[i];
            sb.AppendLine("| " + string.Join(" | ", cols.Select(c => SqlRunnerEscapeCell(row[c]?.ToString() ?? ""))) + " |");
        }
        if (total > shown)
        {
            sb.AppendLine();
            sb.AppendLine($"_…truncated — {total - shown} more row{(total - shown == 1 ? "" : "s")} not shown (capped at {SqlRunnerMaxSendRows})._");
        }
        return sb.ToString().TrimEnd();
    }

    private static string SqlRunnerEscapeCell(string value) =>
        value.Replace("\\", "\\\\").Replace("|", "\\|").Replace("\r\n", " ").Replace("\n", " ").Replace("\r", " ");

    private static string SqlRunnerBuildCsv(DataTable table)
    {
        var cols = table.Columns.Cast<DataColumn>().Select(c => c.ColumnName).ToList();
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", cols.Select(SqlRunnerEscapeCsvCell)));
        foreach (DataRow row in table.Rows)
            sb.AppendLine(string.Join(",", cols.Select(c => SqlRunnerEscapeCsvCell(row[c]?.ToString() ?? ""))));
        return sb.ToString().TrimEnd();
    }

    private static string SqlRunnerEscapeCsvCell(string value) =>
        value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;

    // ── Repo Health — mini panel (5th ClaudeChatDock flyout column) ─────────
    private void BtnToggleRepoHealth_Click(object sender, RoutedEventArgs e)
    {
        _repoHealthOpen = !_repoHealthOpen;
        RepoHealthColumn.Width = new GridLength(_repoHealthOpen ? 300 : 0);
        if (_repoHealthOpen) _ = EnsureRepoHealthScanAsync();
    }

    private void RepoHealthMaximize_Click(object sender, MouseButtonEventArgs e)
    {
        _repoHealthOpen = false;
        RepoHealthColumn.Width = new GridLength(0);
        OpenRepoHealth();
    }

    private void RepoHealthRescan_Click(object sender, MouseButtonEventArgs e) => _ = RunRepoHealthScanAsync();
    private void RepoHealthDocRescan_Click(object sender, RoutedEventArgs e) => _ = RunRepoHealthScanAsync();

    private async Task EnsureRepoHealthLoadedAsync()
    {
        await EnsureRepoHealthScanAsync();
        RenderRepoHealthDoc();
    }

    private async Task EnsureRepoHealthScanAsync()
    {
        if (_rhLoaded || _rhLoading) { RenderRepoHealth(); RenderRepoHealthDoc(); return; }
        await RunRepoHealthScanAsync();
    }

    private async Task RunRepoHealthScanAsync()
    {
        _rhLoading = true;
        RepoHealthScanLine.Text = "Scanning…";
        RepoHealthDocScanLine.Text = "Scanning…";
        _rhScan = await _repoHealthService.RunScanAsync();
        _rhLoaded = true;
        _rhLoading = false;
        RenderRepoHealth();
        RenderRepoHealthDoc();
    }

    private string RepoHealthScanLineText()
    {
        if (_rhScan == null) return "Scanning…";
        if (!_rhScan.GitHubReachable) return $"GitHub unreachable — {_rhScan.GitHubError}";
        return $"Scanned {_rhScan.ScanTime.ToLocalTime():HH:mm:ss} · {_rhScan.Total} finding{(_rhScan.Total == 1 ? "" : "s")}";
    }

    private void RenderRepoHealth()
    {
        RepoHealthScanLine.Text = RepoHealthScanLineText();
        RenderRepoHealthTiles(RepoHealthTiles);
        RenderRepoHealthFindingsList(RepoHealthFindingsPanel);
        UpdateRepoHealthSendLabel();
    }

    private static readonly (RepoHealthRule Rule, string Desc)[] RepoHealthRuleDescriptions =
    {
        (RepoHealthRule.Depth, "More than 3 ancestor levels above an open issue — a parent-chain walk (subIssuesSummary + parent) same as this session's own manual audit."),
        (RepoHealthRule.Naming, "An issue with real sub-issues (epic-shaped) whose title isn't prefixed \"Epic: \" — this repo's own naming convention."),
        (RepoHealthRule.Stale, "An issue body references a backtick-quoted repo path that no longer exists in this checkout."),
        (RepoHealthRule.Orphan, "An open issue whose direct parent is CLOSED."),
    };

    private void RenderRepoHealthDoc()
    {
        RepoHealthDocScanLine.Text = RepoHealthScanLineText();
        RenderRepoHealthTiles(RepoHealthDocTiles);
        RenderRepoHealthDocFindingsList();
        RenderRepoHealthDocDetail();
        UpdateRepoHealthSendLabel();
    }

    private void RenderRepoHealthDocDetail()
    {
        RepoHealthDocDetailPanel.Children.Clear();
        RepoHealthDocDetailPanel.Children.Add(new TextBlock
        {
            Text = "THE FOUR RULES", Margin = new Thickness(0, 0, 0, 10),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10,
            FontWeight = FontWeights.ExtraBold,
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
        });
        foreach (var (rule, desc) in RepoHealthRuleDescriptions)
        {
            var block = new StackPanel { Margin = new Thickness(0, 0, 0, 14) };
            block.Children.Add(new TextBlock
            {
                Text = $"{RuleLabel(rule)} — {_rhScan?.Count(rule) ?? 0} open",
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)FindResource("Brush.Text.Heading"),
            });
            block.Children.Add(new TextBlock
            {
                Text = desc, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 3, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10.5,
                Foreground = (Brush)FindResource("Brush.Text.Dim"),
            });
            RepoHealthDocDetailPanel.Children.Add(block);
        }
    }

    private void RenderRepoHealthTiles(UniformGrid target)
    {
        target.Children.Clear();
        foreach (var rule in new[] { RepoHealthRule.Depth, RepoHealthRule.Naming, RepoHealthRule.Stale, RepoHealthRule.Orphan })
        {
            int count = _rhScan?.Count(rule) ?? 0;
            var tile = new Border
            {
                Margin = new Thickness(2), Padding = new Thickness(6, 4, 6, 4), CornerRadius = new CornerRadius(6),
                Background = (Brush)FindResource("Brush.Claude.Bg.Button"),
                BorderBrush = count > 0 ? (Brush)FindResource("Brush.Epic.Gate") : (Brush)FindResource("Brush.Claude.Border"),
                BorderThickness = new Thickness(1),
            };
            var stack = new StackPanel();
            stack.Children.Add(new TextBlock
            {
                Text = count.ToString(), HorizontalAlignment = HorizontalAlignment.Center,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 14,
                FontWeight = FontWeights.ExtraBold,
                Foreground = count > 0 ? (Brush)FindResource("Brush.Epic.Gate") : (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
            stack.Children.Add(new TextBlock
            {
                Text = RuleLabel(rule), HorizontalAlignment = HorizontalAlignment.Center,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 8.5,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
            tile.Child = stack;
            target.Children.Add(tile);
        }
    }

    private static string RuleLabel(RepoHealthRule rule) => rule switch
    {
        RepoHealthRule.Depth => "DEPTH",
        RepoHealthRule.Naming => "NAMING",
        RepoHealthRule.Stale => "STALE",
        RepoHealthRule.Orphan => "ORPHAN",
        _ => rule.ToString().ToUpperInvariant(),
    };

    private void RenderRepoHealthFindingsList(StackPanel target)
    {
        target.Children.Clear();

        if (_rhScan != null && !_rhScan.GitHubReachable)
        {
            target.Children.Add(new TextBlock
            {
                Text = $"GitHub unreachable: {_rhScan.GitHubError}", TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
            return;
        }

        var findings = _rhScan?.Findings ?? new List<RepoHealthFinding>();
        if (findings.Count == 0)
        {
            target.Children.Add(new TextBlock
            {
                Text = _rhLoaded ? "No open findings — repo is clean." : "Not scanned yet.",
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
            return;
        }

        // "pick next 5" — a convenience link that fills the remaining selection slots (up to the
        // 5-selection cap) with the next not-yet-sent, not-yet-selected findings, top to bottom.
        var pickNext = new TextBlock
        {
            Text = "pick next 5", Cursor = Cursors.Hand, Margin = new Thickness(0, 0, 0, 6),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
            FontWeight = FontWeights.Bold,
            Foreground = (Brush)FindResource("Brush.Claude.Accent"),
        };
        pickNext.MouseLeftButtonDown += (s, e) => PickNextRepoHealthFindings(findings);
        target.Children.Add(pickNext);

        foreach (var f in findings)
        {
            bool sent = _rhSent.Contains(f.Id);
            var row = new Border
            {
                Margin = new Thickness(0, 0, 0, 6), Padding = new Thickness(8, 6, 8, 6), CornerRadius = new CornerRadius(6),
                Background = (Brush)FindResource("Brush.Claude.Bg.Button"),
                Opacity = sent ? 0.55 : 1.0,
            };
            var dock = new DockPanel();

            if (sent)
            {
                var inChat = new TextBlock
                {
                    Text = "In chat",
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
                };
                DockPanel.SetDock(inChat, Dock.Right);
                dock.Children.Add(inChat);
            }
            else
            {
                var cb = new CheckBox { IsChecked = _rhSelected.Contains(f.Id), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 1, 8, 0) };
                DockPanel.SetDock(cb, Dock.Left);
                cb.Checked += (s, e) => { if (_rhSelected.Count >= RepoHealthMaxSelected) { cb.IsChecked = false; ToastEngine.Show("Repo Health", $"Cap is {RepoHealthMaxSelected} selections at a time.", ToastKind.Warning); return; } _rhSelected.Add(f.Id); UpdateRepoHealthSendLabel(); };
                cb.Unchecked += (s, e) => { _rhSelected.Remove(f.Id); UpdateRepoHealthSendLabel(); };
                dock.Children.Add(cb);
            }

            var body = new StackPanel();
            body.Children.Add(new TextBlock
            {
                Text = $"[{f.RuleLabel}] #{f.Number} {f.Title}", TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
            });
            body.Children.Add(new TextBlock
            {
                Text = f.Evidence, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
            dock.Children.Add(body);

            row.Child = dock;
            target.Children.Add(row);
        }
    }

    private void RenderRepoHealthDocFindingsList() => RenderRepoHealthFindingsList(RepoHealthDocFindingsPanel);

    private void PickNextRepoHealthFindings(List<RepoHealthFinding> findings)
    {
        foreach (var f in findings)
        {
            if (_rhSelected.Count >= RepoHealthMaxSelected) break;
            if (_rhSent.Contains(f.Id) || _rhSelected.Contains(f.Id)) continue;
            _rhSelected.Add(f.Id);
        }
        RenderRepoHealth();
        RenderRepoHealthDoc();
    }

    private void UpdateRepoHealthSendLabel()
    {
        var text = $"Send {_rhSelected.Count} to this chat";
        if (RepoHealthSendToChatLabel != null) RepoHealthSendToChatLabel.Text = text;
        if (RepoHealthDocSendToChatLabel != null) RepoHealthDocSendToChatLabel.Text = text;
    }

    // The real markdown work order: one bullet per selected finding, with its real evidence, plus
    // the closing instruction distinguishing directly-fixable (Depth/Naming) from must-be-reported
    // (Stale) findings — exactly the issue body's own footer contract.
    private void BtnRepoHealthSendToChat_Click(object sender, RoutedEventArgs e)
    {
        var findings = _rhScan?.Findings ?? new List<RepoHealthFinding>();
        var selected = findings.Where(f => _rhSelected.Contains(f.Id)).ToList();
        if (selected.Count == 0) { ToastEngine.Show("Repo Health", "Nothing selected.", ToastKind.Warning); return; }

        var bullets = string.Join("\n", selected.Select(f => $"- [{f.RuleLabel}] #{f.Number} {f.Title} — {f.Evidence}"));
        bool anyStale = selected.Any(f => f.Rule == RepoHealthRule.Stale);
        bool anyFixable = selected.Any(f => f.FixableDirectly);
        var closing = anyFixable && anyStale
            ? "Depth and Naming findings above may be fixed directly (retitle / re-parent). Stale references must be reported as a new issue, not closed — the referenced path may simply have moved."
            : anyStale
                ? "Stale references must be reported as a new issue, not closed — the referenced path may simply have moved."
                : "Depth and Naming findings above may be fixed directly (retitle / re-parent).";

        var md = $"**Repo Health — {selected.Count} finding{(selected.Count == 1 ? "" : "s")}**\n\n{bullets}\n\n{closing}";
        AppendToComposer(md);

        foreach (var f in selected) { _rhSent.Add(f.Id); _rhSelected.Remove(f.Id); }
        RenderRepoHealth();
        RenderRepoHealthDoc();
        ToastEngine.Show("Repo Health", $"{selected.Count} finding(s) written into the composer — review, then Send.", ToastKind.Info);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // Git #2217 — JSON Viewer mini panel (§6.9). Same bolt-on-flyout mechanism as
    // SqlRunnerPanel/RepoHealthPanel above (7th tool-panel column). Prettify runs on click, not
    // live-as-you-type — the error line reflects the last Prettify attempt, cleared as soon as the
    // user edits the input again so a stale error never lingers over freshly-typed text.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    private bool _jsonViewerOpen;
    private const double JsonViewerWidthOpen = 340;

    private void BtnToggleJsonViewer_Click(object sender, RoutedEventArgs e)
    {
        _jsonViewerOpen = !_jsonViewerOpen;
        JsonViewerColumn.Width = new GridLength(_jsonViewerOpen ? JsonViewerWidthOpen : 0);
        // Seeded with a small object so the panel is never blank on first open (§6.9).
        if (_jsonViewerOpen && string.IsNullOrEmpty(JsonViewerInput.Text))
        {
            JsonViewerInput.Text = "{\n  \"hello\": \"world\",\n  \"count\": 1\n}";
            JsonViewerPrettify();
        }
    }

    private void JsonViewerInput_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (JsonViewerError.Text.Length > 0) JsonViewerError.Text = "";
    }

    private void BtnJsonViewerPrettify_Click(object sender, RoutedEventArgs e) => JsonViewerPrettify();

    private void JsonViewerPrettify()
    {
        var raw = JsonViewerInput.Text;
        if (string.IsNullOrWhiteSpace(raw))
        {
            JsonViewerError.Text = "Nothing to prettify.";
            return;
        }
        try
        {
            using var doc = JsonDocument.Parse(raw);
            JsonViewerOutput.Text = JsonSerializer.Serialize(doc.RootElement, new JsonSerializerOptions { WriteIndented = true });
            JsonViewerError.Text = "";
        }
        catch (JsonException ex)
        {
            JsonViewerError.Text = $"Invalid JSON: {ex.Message}";
        }
    }

    private void BtnJsonViewerCopy_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(JsonViewerOutput.Text)) return;
        Clipboard.SetText(JsonViewerOutput.Text);
        ToastEngine.Show("JSON Viewer", "Copied.", ToastKind.Info);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // Git #2217 — Windows File Browser mini panel (§6.10). READ-ONLY BY DESIGN — hands Claude an
    // exact path, does not edit files; no create/rename/delete/write capability exists anywhere in
    // this section, per spec. Real local DriveInfo/DirectoryInfo, no fixture data. Lazy-expanding
    // tree (a single placeholder child per unexpanded folder, replaced with real children on first
    // Expanded) so opening the panel doesn't walk the whole filesystem up front.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    private bool _fileBrowserOpen;
    private bool _fileBrowserLoaded;
    private const double FileBrowserWidthOpen = 320;
    private static readonly object FileBrowserPlaceholder = new();

    private sealed class FileBrowserNode
    {
        public readonly string FullPath;
        public readonly bool IsDirectory;
        public FileBrowserNode(string fullPath, bool isDirectory) { FullPath = fullPath; IsDirectory = isDirectory; }
    }

    private void BtnToggleFileBrowser_Click(object sender, RoutedEventArgs e)
    {
        _fileBrowserOpen = !_fileBrowserOpen;
        FileBrowserColumn.Width = new GridLength(_fileBrowserOpen ? FileBrowserWidthOpen : 0);
        if (_fileBrowserOpen && !_fileBrowserLoaded)
        {
            _fileBrowserLoaded = true;
            LoadFileBrowserRoots();
        }
    }

    private void LoadFileBrowserRoots()
    {
        FileBrowserTree.Items.Clear();
        foreach (var drive in DriveInfo.GetDrives())
        {
            if (!drive.IsReady) continue;
            var name = drive.Name.TrimEnd('\\');
            FileBrowserTree.Items.Add(CreateFileBrowserDirectoryItem(drive.RootDirectory.FullName, name));
        }
    }

    private TreeViewItem CreateFileBrowserDirectoryItem(string fullPath, string displayName)
    {
        var item = new TreeViewItem { Header = BuildFileBrowserHeader(displayName, true), Tag = new FileBrowserNode(fullPath, true) };
        item.Items.Add(FileBrowserPlaceholder);
        item.Expanded += FileBrowserDirectory_Expanded;
        return item;
    }

    private FrameworkElement BuildFileBrowserHeader(string name, bool isDirectory)
    {
        var sp = new StackPanel { Orientation = Orientation.Horizontal };
        sp.Children.Add(new TextBlock
        {
            Text = isDirectory ? "" : "",
            FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 11, Margin = new Thickness(0, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted")
        });
        sp.Children.Add(new TextBlock
        {
            Text = name, FontSize = 10.5, VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Body")
        });
        return sp;
    }

    // Folders expand in place (§6.10) — real children replace the single placeholder on first expand.
    private void FileBrowserDirectory_Expanded(object sender, RoutedEventArgs e)
    {
        if (sender is not TreeViewItem item || item.Tag is not FileBrowserNode node || !node.IsDirectory) return;
        if (item.Items.Count != 1 || !ReferenceEquals(item.Items[0], FileBrowserPlaceholder)) return;
        item.Items.Clear();
        PopulateFileBrowserChildren(item, node.FullPath);
    }

    private void PopulateFileBrowserChildren(TreeViewItem parent, string path)
    {
        try
        {
            foreach (var dir in Directory.GetDirectories(path).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
                parent.Items.Add(CreateFileBrowserDirectoryItem(dir, System.IO.Path.GetFileName(dir)));

            foreach (var file in Directory.GetFiles(path).OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
            {
                parent.Items.Add(new TreeViewItem
                {
                    Header = BuildFileBrowserHeader(System.IO.Path.GetFileName(file), false),
                    Tag = new FileBrowserNode(file, false)
                });
            }

            if (parent.Items.Count == 0) AddFileBrowserPlaceholderRow(parent, "(empty)", "Brush.Claude.Text.Muted");
        }
        catch (UnauthorizedAccessException)
        {
            AddFileBrowserPlaceholderRow(parent, "(access denied)", "Brush.Status.Blocked");
        }
        catch (IOException ex)
        {
            AddFileBrowserPlaceholderRow(parent, $"(error: {ex.Message})", "Brush.Status.Blocked");
        }
    }

    private void AddFileBrowserPlaceholderRow(TreeViewItem parent, string text, string brushKey)
    {
        parent.Items.Add(new TreeViewItem
        {
            Header = new TextBlock
            {
                Text = text, FontStyle = FontStyles.Italic, FontSize = 10,
                Foreground = (Brush)FindResource(brushKey)
            },
            IsEnabled = false
        });
    }

    // Selecting a file shows its full path (word-break, §6.10) and enables Copy Path. Selecting a
    // folder just disables Copy Path — the panel exists to hand Claude a file path, not a folder.
    private void FileBrowserTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is TreeViewItem item && item.Tag is FileBrowserNode { IsDirectory: false } node)
        {
            FileBrowserSelectedPath.Text = node.FullPath;
            BtnFileBrowserCopyPath.IsEnabled = true;
        }
        else
        {
            BtnFileBrowserCopyPath.IsEnabled = false;
        }
    }

    private void BtnFileBrowserCopyPath_Click(object sender, RoutedEventArgs e)
    {
        if (FileBrowserTree.SelectedItem is not TreeViewItem item || item.Tag is not FileBrowserNode { IsDirectory: false } node) return;
        Clipboard.SetText(node.FullPath);
        ToastEngine.Show("File Browser", "Path copied.", ToastKind.Info);
    }
    // ── Git Map — Git #2213 ══════════════════════════════════════════════════════════════════
    // Epic-scoped digest: pending cross-epic questions targeting this epic, the Focus Build
    // (this epic's real in-flight feature), Started-and-Dropped (real abandoned work, global),
    // and an Epics browser whose expanded epic lists real feature cards. Single-sourced with the
    // full Git Map document (RenderGitMapAsync / RenderGitMapDocAsync both read the same
    // _gitMapData/_gitMapFeatureCache, built by Services.GitMapService — no second data path,
    // per #2213's hard constraint). Full-document LAYOUT has no surviving spec — see the note on
    // GitMapDock in XAML and #2227 — so the doc tab reuses these SAME card builders in one wide
    // column rather than guessing a distinct design.
    private bool _gitMapOpen;
    private Services.GitMapData? _gitMapData;
    private int _gitMapDataEpic = int.MinValue;
    private readonly Dictionary<int, List<Services.GitMapFeature>> _gitMapFeatureCache = new();
    private readonly HashSet<int> _gitMapExpandedEpics = new();
    private int _gitMapRenderSeq;

    private void BtnToggleGitMap_Click(object sender, RoutedEventArgs e)
    {
        _gitMapOpen = !_gitMapOpen;
        GitMapColumn.Width = new GridLength(_gitMapOpen ? 280 : 0);
        if (_gitMapOpen) _ = RenderGitMapAsync();
    }

    private void GitMapMaximize_Click(object sender, MouseButtonEventArgs e)
    {
        _gitMapOpen = false;
        GitMapColumn.Width = new GridLength(0);
        OpenGitMap();
    }

    private void OpenGitMap()
    {
        if (_tabs.Find(t => t.Id == "gitmap") == null)
            _tabs.Add(new TabDef("gitmap", "Git Map", isGitMap: true, dot: (Brush)FindResource("Brush.Epic.Gate")));
        SelectTab("gitmap");
    }

    private void BtnGitMapRefresh_Click(object sender, RoutedEventArgs e)
    {
        _gitMapData = null;
        _gitMapFeatureCache.Clear();
        _ = RenderGitMapDocAsync();
    }

    /// <summary>Fetches (or reuses) the epic-scoped snapshot for the active chat's epic. A tab
    /// switch to a different epic invalidates the cache — a stale epic's Focus Build/Epics-first
    /// tag must never linger under a new epic's chat.</summary>
    private async Task<Services.GitMapData> EnsureGitMapDataAsync()
    {
        int epic = _activeChatTab?.EpicNumber ?? 0;
        if (_gitMapData != null && _gitMapDataEpic == epic) return _gitMapData;

        var db = ResolveChatReadClient();
        var repoRoot = _logService.MainRepoRoot ?? Environment.CurrentDirectory;
        var data = await Services.GitMapService.BuildAsync(epic > 0 ? epic : (int?)null, repoRoot, db);

        _gitMapData = data;
        _gitMapDataEpic = epic;
        _gitMapFeatureCache.Clear();
        _gitMapExpandedEpics.Clear();
        return data;
    }

    private async Task RenderGitMapAsync()
    {
        int seq = ++_gitMapRenderSeq;
        GitMapResults.Children.Clear();
        GitMapResults.Children.Add(GitMapLoadingRow());

        var data = await EnsureGitMapDataAsync();
        if (seq != _gitMapRenderSeq) return; // a newer refresh superseded this one

        GitMapResults.Children.Clear();
        foreach (var el in BuildGitMapBody(data))
            GitMapResults.Children.Add(el);
    }

    private async Task RenderGitMapDocAsync()
    {
        int seq = ++_gitMapRenderSeq;
        GitMapDocResults.Children.Clear();
        GitMapDocResults.Children.Add(GitMapLoadingRow());

        var data = await EnsureGitMapDataAsync();
        if (seq != _gitMapRenderSeq) return;

        GitMapDocResults.Children.Clear();
        foreach (var el in BuildGitMapBody(data))
            GitMapDocResults.Children.Add(el);
    }

    private TextBlock GitMapLoadingRow() => new()
    {
        Text = "Loading Git Map…",
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10.5,
        Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
    };

    /// <summary>The one real UI-construction path both surfaces call — the actual single-source
    /// guarantee, not just shared data. Rebuilds a fresh element tree each call (a WPF element can't
    /// be parented twice) but every element is built from the identical GitMapData/feature cache.</summary>
    private List<UIElement> BuildGitMapBody(Services.GitMapData data)
    {
        var children = new List<UIElement>();

        if (!data.GitHubReachable)
        {
            children.Add(GitMapNote($"GitHub unreachable — {data.GitHubError ?? "gh call failed"}. Showing whatever loaded before the failure."));
        }

        // Pending cross-epic questions targeting THIS epic — real, in-memory CrossEpicQuestion
        // state from §7 (#2209), filtered the other direction from the Detected panel's "questions
        // I asked" view: here it's "other chats are asking THIS epic something, still open".
        int epic = _activeChatTab?.EpicNumber ?? 0;
        var pending = _crossEpicQuestions.Where(q => q.TargetEpic == epic && !q.Answered).ToList();
        if (pending.Count > 0)
        {
            children.Add(GitMapSectionHeader($"Pending cross-epic questions ({pending.Count})"));
            foreach (var q in pending) children.Add(GitMapPendingQuestionCard(q));
        }

        children.Add(GitMapSectionHeader("Focus Build"));
        children.Add(data.FocusBuild != null ? GitMapFocusBuildCard(data.FocusBuild) : GitMapNote(
            epic > 0 ? "No feature in this epic currently carries the real in-flight label." : "This chat has no epic assigned."));

        children.Add(GitMapSectionHeader("Started-and-Dropped"));
        if (data.Dropped.Count == 0)
            children.Add(GitMapNote("No real abandoned work found — every non-DONE bookend's issue is either closed elsewhere or has no bookend at all."));
        else
            foreach (var d in data.Dropped) children.Add(GitMapDroppedCard(d));

        children.Add(GitMapSectionHeader($"Epics ({data.Epics.Count})"));
        foreach (var e in data.Epics) children.Add(GitMapEpicRow(e));

        return children;
    }

    private TextBlock GitMapSectionHeader(string text) => new()
    {
        Text = text.ToUpperInvariant(),
        Margin = new Thickness(0, 14, 0, 6),
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
        Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
    };

    private TextBlock GitMapNote(string text) => new()
    {
        Text = text, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8),
        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
        Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
    };

    private Border GitMapPendingQuestionCard(CrossEpicQuestion q)
    {
        var outer = new Border
        {
            Margin = new Thickness(0, 0, 0, 8), CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Claude.Bg.Bubble"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Accent"), BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
        };
        var stack = new StackPanel();
        stack.Children.Add(new TextBlock
        {
            Text = q.QuestionText, TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });
        outer.Child = stack;
        return outer;
    }

    private Border GitMapFocusBuildCard(Services.GitMapFocusBuild f)
    {
        var green = (Brush)FindResource("Brush.Alert.Success");
        var outer = new Border
        {
            Margin = new Thickness(0, 0, 0, 8), CornerRadius = new CornerRadius(8),
            Background = Tint(green, 0x1E), BorderBrush = Tint(green, 0x66), BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
        };
        var stack = new StackPanel();
        stack.Children.Add(new TextBlock
        {
            Text = $"#{f.Number} · IN FLIGHT", FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = green,
        });
        stack.Children.Add(new TextBlock
        {
            Text = f.Title, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 3, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });
        string meta = $"{f.OpenGapCount} open gap{(f.OpenGapCount == 1 ? "" : "s")}" +
            (f.BuildQueueStatus != null ? $" · queue: {f.BuildQueueStatus}" : "");
        stack.Children.Add(new TextBlock
        {
            Text = meta, Margin = new Thickness(0, 3, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
        });
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 7, 0, 0) };
        actions.Children.Add(DetectionActionLink("Send to chat", green, () => SendFeatureToComposer(f.Number, f.Title)));
        actions.Children.Add(DetectionActionLink("Open on GitHub", (Brush)FindResource("Brush.Claude.Text.Muted"), () => OpenIssueInBrowser(f.Number)));
        stack.Children.Add(actions);
        outer.Child = stack;
        return outer;
    }

    private Border GitMapDroppedCard(Services.GitMapDroppedItem d)
    {
        var red = (Brush)FindResource("Brush.Alert.Danger.Border");
        var outer = new Border
        {
            Margin = new Thickness(0, 0, 0, 8), CornerRadius = new CornerRadius(8),
            Background = (Brush)FindResource("Brush.Alert.Danger.Bg"), BorderBrush = Tint(red, 0x66), BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
        };
        var stack = new StackPanel();
        stack.Children.Add(new TextBlock
        {
            Text = $"#{d.Number} · {d.BuildsSince} build{(d.BuildsSince == 1 ? "" : "s")} since last touched",
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = red,
        });
        stack.Children.Add(new TextBlock
        {
            Text = d.Title, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 3, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });
        stack.Children.Add(new TextBlock
        {
            Text = $"Last touched {d.LastTouchedAtUtc.ToLocalTime():MMM d, h:mm tt}",
            Margin = new Thickness(0, 3, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
        });
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 7, 0, 0) };
        actions.Children.Add(DetectionActionLink("Send to chat", red, () => SendFeatureToComposer(d.Number, d.Title)));
        actions.Children.Add(DetectionActionLink("Open on GitHub", (Brush)FindResource("Brush.Claude.Text.Muted"), () => OpenIssueInBrowser(d.Number)));
        stack.Children.Add(actions);
        outer.Child = stack;
        return outer;
    }

    private StackPanel GitMapEpicRow(Services.GitMapEpic e)
    {
        bool expanded = _gitMapExpandedEpics.Contains(e.Number);
        var container = new StackPanel { Margin = new Thickness(0, 0, 0, 4) };

        var header = new Border
        {
            CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 6, 8, 6), Cursor = Cursors.Hand,
            Background = e.IsThisChat ? Tint((Brush)FindResource("Brush.Claude.Accent"), 0x1E) : (Brush)FindResource("Brush.Claude.Bg.Bubble"),
        };
        var headerRow = new DockPanel();
        headerRow.Children.Add(new TextBlock
        {
            Text = expanded ? "" : "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 9,
            Margin = new Thickness(0, 0, 7, 0), VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
        });
        var titleStack = new StackPanel();
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
        titleRow.Children.Add(new TextBlock
        {
            Text = $"#{e.Number}", FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
            Margin = new Thickness(0, 0, 6, 0), Foreground = (Brush)FindResource("Brush.Claude.Accent"),
        });
        if (e.IsThisChat)
            titleRow.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 6, 0),
                Background = (Brush)FindResource("Brush.Claude.Accent"),
                Child = new TextBlock { Text = "THIS CHAT", FontSize = 7.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = Brushes.Black },
            });
        titleStack.Children.Add(titleRow);
        titleStack.Children.Add(new TextBlock
        {
            Text = e.Title, TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });
        headerRow.Children.Add(titleStack);
        header.Child = headerRow;
        header.MouseLeftButtonDown += (s, ev) => ToggleGitMapEpic(e.Number);
        container.Children.Add(header);

        if (expanded)
        {
            var body = new StackPanel { Margin = new Thickness(16, 4, 0, 4) };
            if (_gitMapFeatureCache.TryGetValue(e.Number, out var cached))
            {
                if (cached.Count == 0)
                    body.Children.Add(GitMapNote("No open sub-issues under this epic."));
                else
                    foreach (var f in cached.Where(x => !x.IsClosed)) body.Children.Add(GitMapFeatureCard(f));
            }
            else
            {
                body.Children.Add(GitMapNote("Loading features…"));
                _ = LoadGitMapEpicFeaturesAsync(e.Number);
            }
            container.Children.Add(body);
        }

        return container;
    }

    private void ToggleGitMapEpic(int epicNumber)
    {
        if (!_gitMapExpandedEpics.Remove(epicNumber)) _gitMapExpandedEpics.Add(epicNumber);
        _ = RenderGitMapAsync();
        _ = RenderGitMapDocAsync();
    }

    private async Task LoadGitMapEpicFeaturesAsync(int epicNumber)
    {
        var (ok, features, error) = await Services.GitMapService.GetFeaturesForEpicAsync(epicNumber);
        if (ok)
        {
            _gitMapFeatureCache[epicNumber] = features;
            // Git #2308 — Park/Pause propagation: this ONE builder feeds both the mini rail and
            // the full Git Map doc tab (this file's own header), so overlaying here is single-
            // sourced for both real surfaces at once.
            try { await Services.GitEpicPanelService.OverlayParkPauseAsync(features, Services.ChatReadClient.ResolveConnectionStringForSqlRunner()); }
            catch (Exception ex) { Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[git-map] park/pause overlay failed for epic #{epicNumber}: {ex.Message}"); }
        }
        else Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[git-map] feature load failed for epic #{epicNumber}: {error}");
        _ = RenderGitMapAsync();
        _ = RenderGitMapDocAsync();
    }

    private Border GitMapFeatureCard(Services.GitMapFeature f)
    {
        var outer = new Border
        {
            Margin = new Thickness(0, 0, 0, 6), CornerRadius = new CornerRadius(7),
            Background = (Brush)FindResource("Brush.Claude.Bg.Bubble"), BorderBrush = (Brush)FindResource("Brush.Claude.Border"),
            BorderThickness = new Thickness(1), Padding = new Thickness(8, 6, 8, 6),
        };
        var stack = new StackPanel();
        var chipRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
        if (f.IsInFlight) chipRow.Children.Add(GitMapChip("IN FLIGHT", (Brush)FindResource("Brush.Alert.Success")));
        if (f.IsBlocked) chipRow.Children.Add(GitMapChip("BLOCKED", (Brush)FindResource("Brush.Status.Blocked")));
        if (f.IsComplete) chipRow.Children.Add(GitMapChip("COMPLETE", (Brush)FindResource("Brush.Status.Done")));
        // Git #2308 — real propagation from the Epic panel's own Park/Pause actions (#2307).
        if (f.IsParked) chipRow.Children.Add(GitMapChip("PARKED", (Brush)FindResource("Brush.Status.Parked")));
        if (f.IsPaused) chipRow.Children.Add(GitMapChip("PAUSED", (Brush)FindResource("Brush.Status.Paused")));
        if (chipRow.Children.Count > 0) stack.Children.Add(chipRow);

        stack.Children.Add(new TextBlock
        {
            Text = $"#{f.Number} {f.Title}", TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10,
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 5, 0, 0) };
        actions.Children.Add(DetectionActionLink("Focus", (Brush)FindResource("Brush.Claude.Accent"), () => OpenIssueInBrowser(f.Number)));
        actions.Children.Add(DetectionActionLink("Send", (Brush)FindResource("Brush.Claude.Text.Muted"), () => SendFeatureToComposer(f.Number, f.Title)));
        stack.Children.Add(actions);

        outer.Child = stack;
        return outer;
    }

    private Border GitMapChip(string text, Brush color) => new()
    {
        CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 5, 0),
        Background = Tint(color, 0x33), BorderBrush = color, BorderThickness = new Thickness(1),
        Child = new TextBlock { Text = text, FontSize = 7.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = color },
    };

    // "Send" mirrors #2209's already-established "Promote to Queue" shape exactly (PromoteDetection) —
    // a real, queue-ready --title build header staged into the composer, never auto-dispatched (§5).
    private void SendFeatureToComposer(int number, string title)
    {
        string staged = $"--title {number} --model claude-sonnet-5 --effort medium --buildSet ShaneBuilder\n\n{title}";
        AppendToComposer(staged);
        ToastEngine.Show("Git Map", "Staged into the composer — review, then Send to queue it.", ToastKind.Info);
    }

    private void OpenIssueInBrowser(int number)
    {
        try
        {
            Process.Start(new ProcessStartInfo($"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{number}") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[git-map] couldn't open issue #{number} in browser: {ex.Message}");
        }
    }

    // ── PowerShell / Terminal mini panels — Git #2216, §6.8. Real live child processes
    // (Shane's explicit 2026-09-02 decision on the issue — no scripted replies: running
    // PowerShell/cmd from inside this app is no more capable than opening either from the
    // Start menu, since he already has full local access either way). One TerminalSession
    // per chat tab, keyed the same shape as _chatDrafts (§8) — per tab, not global — so a
    // session's scrollback survives switching tabs away and back, and is torn down for
    // good in CloseTab/OnClosed rather than leaking a live powershell.exe/cmd.exe.
    private bool _psOpen;
    private bool _terminalOpen;
    private readonly Dictionary<string, TerminalSession> _psSessionsByTab = new();
    private readonly Dictionary<string, TerminalSession> _terminalSessionsByTab = new();

    private static readonly Brush PsPromptBrush = new SolidColorBrush(Color.FromRgb(0x4f, 0x8f, 0xf0));
    private static readonly Brush TerminalPromptBrush = new SolidColorBrush(Color.FromRgb(0x6e, 0xe7, 0xb7));
    private static readonly Brush TerminalOutputBrush = new SolidColorBrush(Color.FromRgb(0x9f, 0xd0, 0xa9));

    private void BtnTogglePs_Click(object sender, RoutedEventArgs e)
    {
        _psOpen = !_psOpen;
        PsColumn.Width = new GridLength(_psOpen ? 280 : 0);
        if (_psOpen) RenderPsPanel();
    }

    private void BtnToggleTerminal_Click(object sender, RoutedEventArgs e)
    {
        _terminalOpen = !_terminalOpen;
        TerminalColumn.Width = new GridLength(_terminalOpen ? 280 : 0);
        if (_terminalOpen) RenderTerminalPanel();
    }

    // Looks up (or lazily starts) the session for one tab + kind, wires its Updated event to
    // repaint the matching panel ONLY while that tab is still the one on screen — a session
    // that finishes a command after you've switched away must not paint into someone else's
    // rail — and repaints once immediately for the caller's own use.
    private TerminalSession GetOrCreateSession(Dictionary<string, TerminalSession> byTab, string tabId, TerminalSessionKind kind)
    {
        if (byTab.TryGetValue(tabId, out var existing))
        {
            if (!existing.HasExited) return existing;
            existing.Dispose();
            byTab.Remove(tabId);
        }

        var session = new TerminalSession(kind);
        bool isPs = kind == TerminalSessionKind.PowerShell;
        session.Updated += () => Dispatcher.Invoke(() =>
        {
            if (_activeChatTab?.Id != tabId) return;
            if (isPs) RenderTerminalSessionLines(session, PsLinesPanel, PsOutputScroll, PsInputBox, PsPromptBrush);
            else RenderTerminalSessionLines(session, TerminalLinesPanel, TerminalOutputScroll, TerminalInputBox, TerminalPromptBrush);
        });
        byTab[tabId] = session;
        return session;
    }

    private void RenderPsPanel()
    {
        if (!_psOpen || _activeChatTab == null) return;
        var session = GetOrCreateSession(_psSessionsByTab, _activeChatTab.Id, TerminalSessionKind.PowerShell);
        RenderTerminalSessionLines(session, PsLinesPanel, PsOutputScroll, PsInputBox, PsPromptBrush);
    }

    private void RenderTerminalPanel()
    {
        if (!_terminalOpen || _activeChatTab == null) return;
        var session = GetOrCreateSession(_terminalSessionsByTab, _activeChatTab.Id, TerminalSessionKind.Cmd);
        RenderTerminalSessionLines(session, TerminalLinesPanel, TerminalOutputScroll, TerminalInputBox, TerminalPromptBrush);
    }

    // Disables the input row while a command is in flight — RunAsync tracks completion via a
    // single pending-command marker per session, so a second command sent before the first's
    // marker comes back would clobber that wait rather than queueing behind it.
    private void RenderTerminalSessionLines(TerminalSession session, StackPanel host, ScrollViewer scroller, TextBox input, Brush promptBrush)
    {
        input.IsEnabled = !session.IsRunning;
        host.Children.Clear();
        if (session.Lines.Count == 0)
        {
            host.Children.Add(new TextBlock
            {
                Text = "Session ready. Type a command below.",
                FontStyle = FontStyles.Italic,
                TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted")
            });
            return;
        }

        foreach (var line in session.Lines)
        {
            host.Children.Add(new TextBlock
            {
                Text = line.Text,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 2),
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                FontWeight = line.IsPrompt ? FontWeights.SemiBold : FontWeights.Normal,
                Foreground = line.IsPrompt ? promptBrush : TerminalOutputBrush
            });
        }
        scroller.ScrollToEnd();
    }

    private void PsInputBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || _activeChatTab == null) return;
        e.Handled = true;
        var cmd = PsInputBox.Text;
        PsInputBox.Text = "";
        var session = GetOrCreateSession(_psSessionsByTab, _activeChatTab.Id, TerminalSessionKind.PowerShell);
        _ = session.RunAsync(cmd);
    }

    private void TerminalInputBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || _activeChatTab == null) return;
        e.Handled = true;
        var cmd = TerminalInputBox.Text;
        TerminalInputBox.Text = "";
        var session = GetOrCreateSession(_terminalSessionsByTab, _activeChatTab.Id, TerminalSessionKind.Cmd);
        _ = session.RunAsync(cmd);
    }

    // Real teardown so a closed chat tab doesn't leave a live powershell.exe/cmd.exe behind.
    private void DisposeTerminalSessionsForTab(string tabId)
    {
        if (_psSessionsByTab.Remove(tabId, out var ps)) ps.Dispose();
        if (_terminalSessionsByTab.Remove(tabId, out var term)) term.Dispose();
    }

    private void DisposeAllTerminalSessions()
    {
        foreach (var s in _psSessionsByTab.Values) s.Dispose();
        foreach (var s in _terminalSessionsByTab.Values) s.Dispose();
        _psSessionsByTab.Clear();
        _terminalSessionsByTab.Clear();
        _paletteTerminalSession?.Dispose(); // Git #2203 — the Command Center's own terminal session
        _paletteTerminalSession = null;
    }

    // ── Git #2220 / #2202 — API Endpoint Runner / MS Graph Read / MS Graph Write, one shared panel ═
    // README-ClaudeChat.md §6.3 (mini panel) + readme-phase2.md Step 12 (the full explorer contract:
    // ITokenBroker, GatedProfile, GraphTenant, the permission gate, the autofill lock). #2204 (the
    // Accounts & Tiers store the autofill lock reads from) landed on main (e17b4620e), so the lock is
    // now wired to the real SettingsStore.GetProfiles()/AddProfile() — no parallel profile store.
    private bool _apiExplorerOpen;
    private Services.ApiExplorerMode _apiExplorerMode = Services.ApiExplorerMode.Local;
    private string _apiExplorerSearchText = "";
    private Services.ApiEndpoint? _apiExplorerSelected;
    private string? _apiExplorerToken;
    private DateTimeOffset? _apiExplorerTokenExpiresAt;
    // Live scope list parsed from the acquired token's own roles/scp claim (Step 12 permission gate),
    // plus the flow + subject the token panel shows. Reset on every fresh token / panel open.
    private IReadOnlyList<string> _apiExplorerTokenScopes = Array.Empty<string>();
    private string _apiExplorerTokenFlow = "";
    private string _apiExplorerTokenFor = "";
    // §6.3 — "Dry run is the default and must stay the default on every panel open — never
    // remember LIVE across sessions." No persistence anywhere; this resets to true every OpenApiExplorer.
    private bool _apiExplorerDryRun = true;
    // Response pane view: false = JSON Output (indented), true = Raw Response (status line + headers +
    // unindented body). Step 12 "Done when: Raw Response differs from JSON Output."
    private bool _apiExplorerResponseRaw;
    // Set when the autofill lock filled the local login from a gated profile (shows "filled from the
    // gated profile · <label>"). Cleared when the user edits the fields by hand.
    private string? _apiExplorerFilledFromProfile;
    private Services.ApiExplorerResponse? _apiExplorerLastResponse;
    private bool _apiExplorerBusy;
    private System.Windows.Controls.Primitives.Popup? _apiExplorerLockPopup;

    private void OpenApiExplorer(Services.ApiExplorerMode mode)
    {
        bool sameMode = _apiExplorerOpen && _apiExplorerMode == mode;
        _apiExplorerMode = mode;
        _apiExplorerOpen = !sameMode || !_apiExplorerOpen;
        // Switching mode (or reopening) always resets dry-run/selection/response — a stale LIVE
        // write-safety state or a Local endpoint selected while looking at Graph Write would be a
        // real correctness bug here, not a cosmetic one.
        if (_apiExplorerOpen)
        {
            _apiExplorerDryRun = true;      // never remembered as LIVE across opens (§6.3)
            _apiExplorerResponseRaw = false; // default to JSON Output
            _apiExplorerSelected = null;
            _apiExplorerLastResponse = null;
            _apiExplorerSearchText = "";
        }
        ApiExplorerColumn.Width = new GridLength(_apiExplorerOpen ? 320 : 0);
        if (_apiExplorerOpen) RenderApiExplorer();
    }

    private void BtnToggleApiExplorer_CloseClick(object sender, MouseButtonEventArgs e)
    {
        _apiExplorerOpen = false;
        ApiExplorerColumn.Width = new GridLength(0);
    }

    private void RenderApiExplorer()
    {
        if (ApiExplorerTitle == null) return;

        var (title, colour) = _apiExplorerMode switch
        {
            Services.ApiExplorerMode.Local => ("API Runner", Color.FromRgb(0xC0, 0x84, 0xFC)),
            Services.ApiExplorerMode.GraphRead => ("Graph Read", Color.FromRgb(0x00, 0xB4, 0xD8)),
            Services.ApiExplorerMode.GraphWrite => ("Graph Write", Color.FromRgb(0xE2, 0x59, 0x3F)),
            _ => ("API Runner", Color.FromRgb(0xC0, 0x84, 0xFC)),
        };
        ApiExplorerTitle.Text = title;
        ApiExplorerTitle.Foreground = new SolidColorBrush(colour);

        ApiExplorerSearchBox.Text = _apiExplorerSearchText;
        ApiExplorerWriteSafetyRow.Visibility = _apiExplorerMode == Services.ApiExplorerMode.GraphWrite ? Visibility.Visible : Visibility.Collapsed;

        RenderApiExplorerAuthRow();
        RenderApiExplorerTokenPill();
        RenderApiExplorerEndpointList();
        RenderApiExplorerSelected();
        RenderApiExplorerWriteSafetyButtons();
        RenderApiExplorerResponse();
    }

    private void RenderApiExplorerAuthRow()
    {
        ApiExplorerAuthExtra.Children.Clear();
        if (_apiExplorerMode == Services.ApiExplorerMode.Local)
        {
            var lockRow = new Border
            {
                CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 6, 8, 6),
                Background = (Brush)FindResource("Brush.Claude.Bg.Content"),
                BorderBrush = (Brush)FindResource("Brush.Claude.Border"), BorderThickness = new Thickness(1),
            };
            var sp = new StackPanel();
            var profileCount = SettingsStore.GetProfiles().Count;
            sp.Children.Add(new TextBlock
            {
                Text = profileCount > 0
                    ? "Autofill a gated profile with the lock, or type an email + password, then get a real token."
                    : "Type an email + password, or add a gated profile with the lock. Then get a real token.",
                FontSize = 9.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 6),
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });

            var emailBox = new TextBox
            {
                Text = _apiExplorerLocalEmail, Height = 24, Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(0, 0, 0, 4),
                Background = (Brush)FindResource("Brush.Claude.Bg.Button"), Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
                BorderBrush = (Brush)FindResource("Brush.Claude.Border"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10,
            };
            emailBox.TextChanged += (s, e) => { _apiExplorerLocalEmail = emailBox.Text; _apiExplorerFilledFromProfile = null; };
            sp.Children.Add(new TextBlock { Text = "Email", FontSize = 8.5, Foreground = (Brush)FindResource("Brush.Claude.Text.Muted") });
            sp.Children.Add(emailBox);

            // Password field with the autofill lock docked beside it (readme Step 12).
            sp.Children.Add(new TextBlock { Text = "Password", FontSize = 8.5, Foreground = (Brush)FindResource("Brush.Claude.Text.Muted") });
            var pwRow = new DockPanel { Margin = new Thickness(0, 0, 0, 2) };
            var lockBtn = new Button
            {
                Width = 26, Height = 24, Margin = new Thickness(4, 0, 0, 0), Cursor = Cursors.Hand,
                Style = (Style)FindResource("PanelCollapseButton"),
                ToolTip = "Autofill a gated profile",
                Content = new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 11, Foreground = (Brush)FindResource("Brush.Claude.Accent") },
                RenderTransformOrigin = new Point(0.5, 0.5),
            };
            lockBtn.RenderTransform = new TransformGroup { Children = { new RotateTransform(0), new TranslateTransform(0, 0) } };
            DockPanel.SetDock(lockBtn, Dock.Right);
            var pwBox = new PasswordBox
            {
                Height = 24, Padding = new Thickness(6, 2, 6, 2),
                Background = (Brush)FindResource("Brush.Claude.Bg.Button"), Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
                BorderBrush = (Brush)FindResource("Brush.Claude.Border"),
            };
            if (!string.IsNullOrEmpty(_apiExplorerLocalPassword)) pwBox.Password = _apiExplorerLocalPassword;
            pwBox.PasswordChanged += (s, e) => { _apiExplorerLocalPassword = pwBox.Password; _apiExplorerFilledFromProfile = null; };
            lockBtn.Click += (s, e) => { DroopLock(lockBtn); ShowAutofillLockPopup(lockBtn); };
            pwRow.Children.Add(lockBtn);
            pwRow.Children.Add(pwBox);
            sp.Children.Add(pwRow);

            if (!string.IsNullOrEmpty(_apiExplorerFilledFromProfile))
            {
                sp.Children.Add(new TextBlock
                {
                    Text = $"filled from the gated profile · {_apiExplorerFilledFromProfile}",
                    FontSize = 8.5, Margin = new Thickness(0, 2, 0, 0), FontStyle = FontStyles.Italic,
                    Foreground = (Brush)FindResource("Brush.Status.Running"),
                });
            }
            lockRow.Child = sp;
            ApiExplorerAuthExtra.Children.Add(lockRow);
        }
        else
        {
            // #2205 — Graph tenant picker with a gear to add/edit an App Registration inline, stored
            // in the same Settings store (#2204). Kept intact and extended below with #2202's
            // granted-scope readout that drives the permission gate.
            var creds = Services.ApiExplorerService.ResolveGraphCredentials(_logService.MainRepoRoot, SettingsStore);

            var pickerRow = new DockPanel();
            var gearBtn = new Button
            {
                Content = "⚙", Width = 20, Height = 20, Padding = new Thickness(0), Margin = new Thickness(6, 0, 0, 0),
                Background = Brushes.Transparent, BorderThickness = new Thickness(0), Cursor = Cursors.Hand,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"), FontSize = 11,
                ToolTip = "Add or edit an App Registration",
            };
            DockPanel.SetDock(gearBtn, Dock.Right);
            gearBtn.Click += (s, e) => { _apiExplorerGraphEditOpen = !_apiExplorerGraphEditOpen; RenderApiExplorerAuthRow(); };
            pickerRow.Children.Add(gearBtn);
            pickerRow.Children.Add(new TextBlock
            {
                Text = creds != null ? $"Tenant: {creds.TenantLabel}" : "GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET not found — add an App Registration.",
                FontSize = 9.5, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource(creds != null ? "Brush.Claude.Text.Muted" : "Brush.Toast.Warning"),
            });
            ApiExplorerAuthExtra.Children.Add(pickerRow);

            if (_apiExplorerGraphEditOpen)
                ApiExplorerAuthExtra.Children.Add(BuildGraphAppRegistrationEditor());

            // #2202 — granted-scope readout (from the acquired token's own roles/scp claim). Empty
            // until a token is fetched; feeds the permission gate on the selected endpoint.
            if (creds != null)
            {
                ApiExplorerAuthExtra.Children.Add(new TextBlock
                {
                    Text = _apiExplorerTokenScopes.Count > 0
                        ? $"Granted: {_apiExplorerTokenScopes.Count} permission(s) — from the token's own claims"
                        : "Get token for this tenant to read its granted permissions.",
                    FontSize = 8.5, Margin = new Thickness(0, 2, 0, 0), TextWrapping = TextWrapping.Wrap,
                    Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
                });
            }
        }
    }

    // Git #2205 — gear on the Graph tenant picker: add/edit an App Registration inline, writing to
    // the same Settings store (SettingsStoreService) the redesigned Settings screen (#2204) reads.
    private bool _apiExplorerGraphEditOpen;

    private Border BuildGraphAppRegistrationEditor()
    {
        var card = new Border
        {
            CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 7, 8, 7), Margin = new Thickness(0, 6, 0, 0),
            Background = (Brush)FindResource("Brush.Claude.Bg.Content"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"), BorderThickness = new Thickness(1),
        };
        var sp = new StackPanel();

        TextBox MakeBox(string text) => new()
        {
            Text = text, Height = 24, Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(0, 0, 0, 4),
            Background = (Brush)FindResource("Brush.Claude.Bg.Button"), Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10,
        };
        TextBlock MakeLabel(string text) => new() { Text = text, FontSize = 8.5, Foreground = (Brush)FindResource("Brush.Claude.Text.Muted") };

        var tenantBox = MakeBox(SettingsStore.Get(Services.ApiExplorerService.GraphTenantIdKey, ""));
        var clientBox = MakeBox(SettingsStore.Get(Services.ApiExplorerService.GraphClientIdKey, ""));
        var labelBox = MakeBox(SettingsStore.Get(Services.ApiExplorerService.GraphTenantLabelKey, ""));
        var secretBox = new PasswordBox
        {
            Height = 24, Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(0, 0, 0, 4),
            Background = (Brush)FindResource("Brush.Claude.Bg.Button"), Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"),
        };
        bool hasStoredSecret = !string.IsNullOrEmpty(SettingsStore.Get(Services.ApiExplorerService.GraphClientSecretKey, ""));

        sp.Children.Add(MakeLabel("Tenant ID"));
        sp.Children.Add(tenantBox);
        sp.Children.Add(MakeLabel("Client ID"));
        sp.Children.Add(clientBox);
        sp.Children.Add(MakeLabel(hasStoredSecret ? "Client secret (leave blank to keep the saved one)" : "Client secret"));
        sp.Children.Add(secretBox);
        sp.Children.Add(MakeLabel("Label (optional)"));
        sp.Children.Add(labelBox);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
        var saveBtn = new Button
        {
            Content = "Save", Height = 24, Padding = new Thickness(10, 0, 10, 0), Margin = new Thickness(0, 0, 6, 0),
            Background = (Brush)FindResource("Brush.Status.Running"), Foreground = Brushes.Black, BorderThickness = new Thickness(0),
            FontSize = 10.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand,
        };
        saveBtn.Click += (s, e) =>
        {
            var tenantId = tenantBox.Text.Trim();
            var clientId = clientBox.Text.Trim();
            if (string.IsNullOrEmpty(tenantId) || string.IsNullOrEmpty(clientId) || (!hasStoredSecret && string.IsNullOrEmpty(secretBox.Password)))
            {
                ToastEngine.Show("API Explorer", "Tenant ID, Client ID and a client secret are all required.", ToastKind.Warning);
                return;
            }
            SettingsStore.Set(Services.ApiExplorerService.GraphTenantIdKey, tenantId);
            SettingsStore.Set(Services.ApiExplorerService.GraphClientIdKey, clientId);
            if (!string.IsNullOrEmpty(secretBox.Password))
                SettingsStore.Set(Services.ApiExplorerService.GraphClientSecretKey, secretBox.Password);
            SettingsStore.Set(Services.ApiExplorerService.GraphTenantLabelKey, labelBox.Text.Trim());
            _apiExplorerGraphEditOpen = false;
            ToastEngine.Show("API Explorer", "App Registration saved.", ToastKind.Success);
            RenderApiExplorerAuthRow();
        };
        actions.Children.Add(saveBtn);

        var clearBtn = new Button
        {
            Content = "Clear", Height = 24, Padding = new Thickness(10, 0, 10, 0),
            Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"), BorderThickness = new Thickness(1),
            FontSize = 10.5, Cursor = Cursors.Hand,
        };
        clearBtn.Click += (s, e) =>
        {
            SettingsStore.Set(Services.ApiExplorerService.GraphTenantIdKey, "");
            SettingsStore.Set(Services.ApiExplorerService.GraphClientIdKey, "");
            SettingsStore.Set(Services.ApiExplorerService.GraphClientSecretKey, "");
            SettingsStore.Set(Services.ApiExplorerService.GraphTenantLabelKey, "");
            ToastEngine.Show("API Explorer", "App Registration cleared — falling back to .env.local.", ToastKind.Info);
            RenderApiExplorerAuthRow();
        };
        actions.Children.Add(clearBtn);

        sp.Children.Add(actions);
        card.Child = sp;
        return card;
    }

    private string _apiExplorerLocalEmail = "";
    private string _apiExplorerLocalPassword = "";

    /// <summary>Builds the readme Step 12 <see cref="Services.GraphTenant"/> from the resolved DEV
    /// credentials. <c>GrantedScopes</c> is the live list parsed from the last acquired token (empty
    /// until one is fetched) — never a hardcoded scope list.</summary>
    private Services.GraphTenant? BuildGraphTenant()
    {
        var creds = Services.ApiExplorerService.ResolveGraphCredentials(_logService.MainRepoRoot, SettingsStore);
        if (creds == null) return null;
        return new Services.GraphTenant(
            Id: creds.TenantId, Label: creds.TenantLabel, Env: "DEV app registration",
            TenantId: creds.TenantId, AppRegistration: creds.ClientId,
            GrantedScopes: _apiExplorerTokenScopes.ToArray());
    }

    private Services.ITokenBroker BuildTokenBroker() =>
        new Services.TokenBroker(Services.ApiExplorerService.ResolveGraphCredentials(_logService.MainRepoRoot, SettingsStore));

    /// <summary>The lock "droops" (tilt + slide down, 180ms) when opened — readme Step 12 detail.</summary>
    private static void DroopLock(Button lockBtn)
    {
        if (lockBtn.RenderTransform is not TransformGroup g || g.Children.Count < 2) return;
        var dur = new Duration(TimeSpan.FromMilliseconds(180));
        ((RotateTransform)g.Children[0]).BeginAnimation(RotateTransform.AngleProperty,
            new System.Windows.Media.Animation.DoubleAnimation(0, 12, dur) { AutoReverse = true });
        ((TranslateTransform)g.Children[1]).BeginAnimation(TranslateTransform.YProperty,
            new System.Windows.Media.Animation.DoubleAnimation(0, 2, dur) { AutoReverse = true });
    }

    private static Brush TierTone(FrameworkElement ctx, string tier) => tier switch
    {
        "Enterprise" => (Brush)ctx.FindResource("Brush.Workspace.Designs"),
        "Premium" => (Brush)ctx.FindResource("Brush.Epic.Portal"),
        _ => (Brush)ctx.FindResource("Brush.Status.Verifying"),
    };

    /// <summary>Readme Step 12 — "Autofill Gated Profile": the configured profiles (read live from
    /// #2204's real <c>SettingsStore.GetProfiles()</c>, the SAME list as Settings → Accounts &amp;
    /// Tiers, never a parallel store) with tier badges, each picking fills both fields and marks
    /// "filled from the gated profile". "+ Add an account" does add-it-and-use-it: saves via
    /// <c>SettingsStore.AddProfile</c>, closes the lock, fills the login.</summary>
    private void ShowAutofillLockPopup(Button anchor)
    {
        _apiExplorerLockPopup?.SetCurrentValue(System.Windows.Controls.Primitives.Popup.IsOpenProperty, false);

        var outer = new StackPanel { MinWidth = 240 };
        var card = new Border
        {
            CornerRadius = new CornerRadius(8), Padding = new Thickness(10), Background = (Brush)FindResource("Brush.Claude.Bg.Chrome"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"), BorderThickness = new Thickness(1),
            Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 14, ShadowDepth = 3, Opacity = 0.4, Color = Colors.Black },
        };
        card.Child = outer;

        outer.Children.Add(new TextBlock
        {
            Text = "Autofill Gated Profile", FontWeight = FontWeights.Bold, FontSize = 11, Margin = new Thickness(0, 0, 0, 8),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
        });

        var popup = new System.Windows.Controls.Primitives.Popup
        {
            PlacementTarget = anchor, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom,
            StaysOpen = false, AllowsTransparency = true, Child = card,
        };
        _apiExplorerLockPopup = popup;

        void Fill(Services.AccountProfile p)
        {
            _apiExplorerLocalEmail = p.User;
            _apiExplorerLocalPassword = p.Password;
            _apiExplorerFilledFromProfile = string.IsNullOrEmpty(p.Description) ? p.User : p.Description;
            popup.IsOpen = false;
            RenderApiExplorerAuthRow();
        }

        var profiles = SettingsStore.GetProfiles();
        foreach (var p in profiles)
        {
            var tone = TierTone(this, p.Tier);
            var rowBtn = new Button
            {
                Margin = new Thickness(0, 0, 0, 4), Padding = new Thickness(0), Cursor = Cursors.Hand,
                Background = Brushes.Transparent, BorderThickness = new Thickness(0), HorizontalContentAlignment = HorizontalAlignment.Stretch,
            };
            var row = new DockPanel { LastChildFill = true };
            var badge = new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 1, 6, 1), Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center,
                Background = Tint(tone, 0x29), BorderBrush = Tint(tone, 0x66), BorderThickness = new Thickness(1),
                Child = new TextBlock { Text = p.Tier, FontSize = 8.5, FontWeight = FontWeights.Bold, Foreground = tone },
            };
            DockPanel.SetDock(badge, Dock.Right);
            row.Children.Add(badge);
            row.Children.Add(new TextBlock
            {
                Text = p.User, FontSize = 10, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Body"),
            });
            var wrap = new Border
            {
                CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 5, 8, 5),
                Background = (Brush)FindResource("Brush.Claude.Bg.Content"),
                BorderBrush = (Brush)FindResource("Brush.Claude.Border"), BorderThickness = new Thickness(1), Child = row,
            };
            rowBtn.Content = wrap;
            var captured = p;
            rowBtn.Click += (s, e) => Fill(captured);
            outer.Children.Add(rowBtn);
        }

        if (profiles.Count == 0)
        {
            outer.Children.Add(new TextBlock
            {
                Text = "No gated profiles yet — add one below.", FontSize = 9.5, FontStyle = FontStyles.Italic,
                Margin = new Thickness(0, 0, 0, 6), Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
        }

        outer.Children.Add(new Border { Height = 1, Margin = new Thickness(0, 4, 0, 8), Background = (Brush)FindResource("Brush.Claude.Border") });

        // "+ Add an account" — add-it-and-use-it inline form.
        var addToggle = new Button
        {
            Height = 24, HorizontalAlignment = HorizontalAlignment.Stretch, Style = (Style)FindResource("PanelCollapseButton"),
            Content = new TextBlock { Text = "+ Add an account", FontSize = 10, Foreground = (Brush)FindResource("Brush.Claude.Accent") },
        };
        var addForm = new StackPanel { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 6, 0, 0) };
        addToggle.Click += (s, e) => addForm.Visibility = addForm.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        outer.Children.Add(addToggle);

        var userBox = new TextBox
        {
            Height = 24, Margin = new Thickness(0, 0, 0, 4), Padding = new Thickness(6, 2, 6, 2),
            Background = (Brush)FindResource("Brush.Claude.Bg.Button"), Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"), FontSize = 10,
        };
        var newPwBox = new PasswordBox
        {
            Height = 24, Margin = new Thickness(0, 0, 0, 4), Padding = new Thickness(6, 2, 6, 2),
            Background = (Brush)FindResource("Brush.Claude.Bg.Button"), Foreground = (Brush)FindResource("Brush.Claude.Text.Bright"),
            BorderBrush = (Brush)FindResource("Brush.Claude.Border"),
        };
        addForm.Children.Add(new TextBlock { Text = "Username", FontSize = 8.5, Foreground = (Brush)FindResource("Brush.Claude.Text.Muted") });
        addForm.Children.Add(userBox);
        addForm.Children.Add(new TextBlock { Text = "Password", FontSize = 8.5, Foreground = (Brush)FindResource("Brush.Claude.Text.Muted") });
        addForm.Children.Add(newPwBox);

        var chosenTier = "Standard";
        var tierRow = new WrapPanel { Margin = new Thickness(0, 2, 0, 6) };
        var tierBtns = new List<Border>();
        foreach (var tier in new[] { "Standard", "Enterprise", "Premium" })
        {
            var tone = TierTone(this, tier);
            var btn = new Border
            {
                CornerRadius = new CornerRadius(6), Padding = new Thickness(9, 4, 9, 4), Margin = new Thickness(0, 0, 5, 0), Cursor = Cursors.Hand,
                Background = tier == chosenTier ? Tint(tone, 0x24) : Brushes.Transparent,
                BorderBrush = tier == chosenTier ? Tint(tone, 0x80) : (Brush)FindResource("Brush.Claude.Border"), BorderThickness = new Thickness(1),
                Child = new TextBlock { Text = tier, FontSize = 9.5, FontWeight = FontWeights.Bold, Foreground = tier == chosenTier ? tone : (Brush)FindResource("Brush.Claude.Text.Muted") },
                Tag = tier,
            };
            var capturedTier = tier;
            btn.MouseLeftButtonDown += (s, e) =>
            {
                chosenTier = capturedTier;
                foreach (var b in tierBtns)
                {
                    var bt = (string)b.Tag; var bTone = TierTone(this, bt); bool on = bt == chosenTier;
                    b.Background = on ? Tint(bTone, 0x24) : Brushes.Transparent;
                    b.BorderBrush = on ? Tint(bTone, 0x80) : (Brush)FindResource("Brush.Claude.Border");
                    ((TextBlock)b.Child).Foreground = on ? bTone : (Brush)FindResource("Brush.Claude.Text.Muted");
                }
            };
            tierBtns.Add(btn);
            tierRow.Children.Add(btn);
        }
        addForm.Children.Add(tierRow);

        var addUseBtn = new Button
        {
            Height = 26, HorizontalAlignment = HorizontalAlignment.Stretch, Style = (Style)FindResource("PanelCollapseButton"),
            Content = new TextBlock { Text = "Add & use", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("Brush.Claude.Accent") },
        };
        addUseBtn.Click += (s, e) =>
        {
            var user = userBox.Text.Trim();
            var pw = newPwBox.Password;
            if (string.IsNullOrWhiteSpace(user) || string.IsNullOrEmpty(pw))
            {
                ToastEngine.Show("API Runner", "Enter a username and password to add an account.", ToastKind.Info);
                return;
            }
            var added = SettingsStore.AddProfile(user, pw, "", chosenTier); // same store as Settings → Accounts & Tiers
            Fill(added);                                                     // add-it-and-use-it
            ToastEngine.Show("API Runner", $"Added {user} ({chosenTier}) and filled the login.", ToastKind.Success);
        };
        addForm.Children.Add(addUseBtn);
        outer.Children.Add(addForm);

        popup.IsOpen = true;
    }

    private void RenderApiExplorerTokenPill()
    {
        bool hasToken = !string.IsNullOrEmpty(_apiExplorerToken);
        bool expired = hasToken && _apiExplorerTokenExpiresAt.HasValue && _apiExplorerTokenExpiresAt.Value <= DateTimeOffset.UtcNow;
        string text;
        if (!hasToken) text = "No token";
        else if (expired) text = "Expired";
        else
        {
            // Token panel shows who it's for, the flow, and when it expires (readme Step 12).
            var who = string.IsNullOrEmpty(_apiExplorerTokenFor) ? "" : $" · {_apiExplorerTokenFor}";
            var flow = string.IsNullOrEmpty(_apiExplorerTokenFlow) ? "" : $" · {_apiExplorerTokenFlow}";
            text = $"Valid until {_apiExplorerTokenExpiresAt!.Value.LocalDateTime:HH:mm}{who}{flow}";
        }
        ApiExplorerTokenPillText.Text = text;
        ApiExplorerTokenPillText.Foreground = (Brush)FindResource(hasToken && !expired ? "Brush.Status.Running" : "Brush.Claude.Text.Muted");
        ApiExplorerTokenBtnLabel.Text = hasToken ? "Refresh token" : "Get token";
        BtnApiExplorerToken.IsEnabled = !_apiExplorerBusy;
    }

    private void RenderApiExplorerWriteSafetyButtons()
    {
        var accent = (Brush)FindResource("Brush.Claude.Accent");
        var idleBg = (Brush)FindResource("Brush.Claude.Bg.Content");
        var idleFg = (Brush)FindResource("Brush.Claude.Text.Muted");
        BtnApiExplorerDryRun.Background = _apiExplorerDryRun ? accent : idleBg;
        ((TextBlock)BtnApiExplorerDryRun.Content).Foreground = _apiExplorerDryRun ? new SolidColorBrush(Color.FromRgb(0x1A, 0x0F, 0x0A)) : idleFg;
        BtnApiExplorerLive.Background = !_apiExplorerDryRun ? new SolidColorBrush(Color.FromRgb(0xE2, 0x59, 0x3F)) : idleBg;
        ((TextBlock)BtnApiExplorerLive.Content).Foreground = !_apiExplorerDryRun ? Brushes.White : idleFg;
    }

    private void BtnApiExplorerDryRun_Click(object sender, RoutedEventArgs e)
    {
        _apiExplorerDryRun = true;
        RenderApiExplorerWriteSafetyButtons();
    }

    private void BtnApiExplorerLive_Click(object sender, RoutedEventArgs e)
    {
        _apiExplorerDryRun = false;
        RenderApiExplorerWriteSafetyButtons();
    }

    private void ApiExplorerSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _apiExplorerSearchText = ApiExplorerSearchBox.Text;
        RenderApiExplorerEndpointList();
    }

    private void RenderApiExplorerEndpointList()
    {
        ApiExplorerEndpointList.Children.Clear();
        var endpoints = Services.ApiExplorerService.GetEndpoints(_apiExplorerMode)
            .Where(ep => string.IsNullOrWhiteSpace(_apiExplorerSearchText)
                || ep.Path.Contains(_apiExplorerSearchText, StringComparison.OrdinalIgnoreCase)
                || ep.Name.Contains(_apiExplorerSearchText, StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var ep in endpoints)
        {
            var row = new DockPanel { Margin = new Thickness(0, 0, 0, 3), Cursor = Cursors.Hand };
            var methodChip = new Border
            {
                CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 6, 0),
                Background = (Brush)FindResource("Brush.Claude.Bg.Button"),
                Child = new TextBlock { Text = ep.Method, FontSize = 8.5, FontWeight = FontWeights.Bold, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), Foreground = (Brush)FindResource("Brush.Claude.Accent") },
            };
            DockPanel.SetDock(methodChip, Dock.Left);
            row.Children.Add(methodChip);
            row.Children.Add(new TextBlock
            {
                Text = ep.Path, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Body"), TextTrimming = TextTrimming.CharacterEllipsis,
            });
            row.MouseLeftButtonDown += (s, e) => { _apiExplorerSelected = ep; RenderApiExplorerSelected(); RenderApiExplorerResponse(); };
            ApiExplorerEndpointList.Children.Add(row);
        }

        if (endpoints.Count == 0)
        {
            ApiExplorerEndpointList.Children.Add(new TextBlock
            {
                Text = "No endpoints match.", FontStyle = FontStyles.Italic, FontSize = 10,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
        }
    }

    private void RenderApiExplorerSelected()
    {
        ApiExplorerSelectedPanel.Children.Clear();
        if (_apiExplorerSelected == null)
        {
            ApiExplorerSelectedPanel.Children.Add(new TextBlock
            {
                Text = "Pick an endpoint above.", FontStyle = FontStyles.Italic, FontSize = 9.5,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
            return;
        }
        var ep = _apiExplorerSelected;
        var line = new TextBlock { TextWrapping = TextWrapping.Wrap, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10 };
        line.Inlines.Add(new Run(ep.Method + " ") { FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("Brush.Claude.Accent") });
        line.Inlines.Add(new Run(ep.Path) { Foreground = (Brush)FindResource("Brush.Claude.Text.Bright") });
        ApiExplorerSelectedPanel.Children.Add(line);
        if (!string.IsNullOrEmpty(ep.Permission))
        {
            var riskTone = ep.Risk switch
            {
                "critical" => (Brush)FindResource("Brush.Epic.Gate"),
                "high" => (Brush)FindResource("Brush.Status.Blocked"),
                "write" => (Brush)FindResource("Brush.LogLevel.Warn"),
                _ => (Brush)FindResource("Brush.Claude.Text.Muted"),
            };
            var permLine = new TextBlock { FontSize = 8.5, Margin = new Thickness(0, 2, 0, 0), TextWrapping = TextWrapping.Wrap };
            permLine.Inlines.Add(new Run($"Requires {ep.Permission} · risk: ") { Foreground = (Brush)FindResource("Brush.Claude.Text.Muted") });
            permLine.Inlines.Add(new Run(ep.Risk) { Foreground = riskTone, FontWeight = FontWeights.Bold });
            ApiExplorerSelectedPanel.Children.Add(permLine);
        }
        RenderApiExplorerPermissionGate(ep);
    }

    /// <summary>Readme Step 12 permission gate. For a Graph endpoint whose required scope is NOT in
    /// the acquired token's granted scopes, drops an amber banner naming the missing grant and
    /// offering the real admin-consent URL. A LIVE execute is still allowed through — it returns the
    /// real Graph <c>403 Authorization_RequestDenied</c> shape, which is exactly what the readme wants
    /// the runner to surface (the banner is the "why it will fail" heads-up, not a client-side block
    /// that hides the real server response).</summary>
    private void RenderApiExplorerPermissionGate(Services.ApiEndpoint ep)
    {
        bool isGraph = _apiExplorerMode is Services.ApiExplorerMode.GraphRead or Services.ApiExplorerMode.GraphWrite;
        if (!isGraph || string.IsNullOrEmpty(ep.Permission)) return;
        if (string.IsNullOrEmpty(_apiExplorerToken)) return; // nothing to check yet — token panel already prompts
        if (Services.ApiExplorerService.HasPermission(_apiExplorerTokenScopes, ep.Permission)) return;

        var tenant = BuildGraphTenant();
        var banner = new Border
        {
            CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 6, 8, 6), Margin = new Thickness(0, 6, 0, 0),
            Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.LogLevel.Warn")).Color) { Opacity = 0.16 },
            BorderBrush = (Brush)FindResource("Brush.LogLevel.Warn"), BorderThickness = new Thickness(1),
        };
        var sp = new StackPanel();
        sp.Children.Add(new TextBlock
        {
            Text = $"This App Registration isn't granted {ep.Permission}.", FontSize = 9.5, FontWeight = FontWeights.Bold,
            TextWrapping = TextWrapping.Wrap, Foreground = (Brush)FindResource("Brush.LogLevel.Warn"),
        });
        sp.Children.Add(new TextBlock
        {
            Text = "A LIVE call will come back 403 Authorization_RequestDenied. Grant it with admin consent:",
            FontSize = 8.5, Margin = new Thickness(0, 2, 0, 4), TextWrapping = TextWrapping.Wrap,
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
        });
        if (tenant != null)
        {
            var consentUrl = Services.ApiExplorerService.BuildAdminConsentUrl(tenant.TenantId, tenant.AppRegistration);
            var consentBtn = new Button
            {
                Height = 22, HorizontalAlignment = HorizontalAlignment.Left, Style = (Style)FindResource("PanelCollapseButton"),
                Content = new TextBlock { Text = "Copy admin-consent URL", FontSize = 9, Foreground = (Brush)FindResource("Brush.Claude.Accent") },
            };
            consentBtn.Click += (s, e) => { Clipboard.SetText(consentUrl); ToastEngine.Show("API Runner", "Admin-consent URL copied.", ToastKind.Info); };
            sp.Children.Add(consentBtn);
        }
        banner.Child = sp;
        ApiExplorerSelectedPanel.Children.Add(banner);
    }

    private async void BtnApiExplorerToken_Click(object sender, RoutedEventArgs e)
    {
        if (_apiExplorerBusy) return;
        _apiExplorerBusy = true;
        RenderApiExplorerTokenPill();
        try
        {
            var broker = BuildTokenBroker();
            Services.Token result;
            if (_apiExplorerMode == Services.ApiExplorerMode.Local)
            {
                if (string.IsNullOrWhiteSpace(_apiExplorerLocalEmail) || string.IsNullOrWhiteSpace(_apiExplorerLocalPassword))
                {
                    ToastEngine.Show("API Runner", "Enter an email and password first (or autofill a gated profile).", ToastKind.Info);
                    return;
                }
                result = await broker.PasswordLogin(LocalApiBaseUrl, _apiExplorerLocalEmail, _apiExplorerLocalPassword);
            }
            else
            {
                var tenant = BuildGraphTenant();
                if (tenant == null)
                {
                    ToastEngine.Show("API Runner", "No Graph credentials configured in .env.local.", ToastKind.Error);
                    return;
                }
                result = await broker.ClientCredentials(tenant);
            }

            if (!result.Ok)
            {
                ToastEngine.Show("API Runner", $"Token acquisition failed: {result.Error}", ToastKind.Error);
            }
            else
            {
                _apiExplorerToken = result.AccessToken;
                _apiExplorerTokenExpiresAt = result.ExpiresAt;
                _apiExplorerTokenScopes = result.GrantedScopes;
                _apiExplorerTokenFlow = result.Flow;
                _apiExplorerTokenFor = result.For;
                RenderApiExplorerAuthRow();   // Graph auth row now shows granted-scope count
                RenderApiExplorerSelected();  // re-evaluate the permission gate against the new token
            }
        }
        finally
        {
            _apiExplorerBusy = false;
            RenderApiExplorerTokenPill();
        }
    }

    // Real local dev api-server (scripts/dev-server/config.mjs / artifacts/api-server/package.json
    // "PORT=${PORT:-8080}") — not a fixture URL.
    private const string LocalApiBaseUrl = "http://localhost:8080";
    private const string GraphApiBase = "https://graph.microsoft.com";

    private async void BtnApiExplorerSend_Click(object sender, RoutedEventArgs e)
    {
        if (_apiExplorerBusy) return;
        var ep = _apiExplorerSelected;
        if (ep == null)
        {
            ToastEngine.Show("API Runner", "Pick an endpoint first.", ToastKind.Info);
            return;
        }

        var url = _apiExplorerMode == Services.ApiExplorerMode.Local ? LocalApiBaseUrl + ep.Path : GraphApiBase + ep.Path;
        var method = new HttpMethod(ep.Method);
        var body = string.IsNullOrEmpty(ep.ExampleBody) ? null : ep.ExampleBody;

        bool isWrite = _apiExplorerMode == Services.ApiExplorerMode.GraphWrite;
        if (isWrite && _apiExplorerDryRun)
        {
            var tenant = BuildGraphTenant();
            _apiExplorerLastResponse = Services.ApiExplorerService.BuildDryRunPreview(
                method, url, !string.IsNullOrEmpty(_apiExplorerToken), body, ep.Permission, tenant?.Label);
            RenderApiExplorerResponse();
            return;
        }

        // A LIVE Graph write is the one genuinely consequential action on this surface — audit it.
        if (isWrite && !_apiExplorerDryRun)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn,
                $"[api-explorer] LIVE Graph write: {ep.Method} {ep.Path} (permission {ep.Permission}, risk {ep.Risk}) against {BuildGraphTenant()?.Label ?? "?"}");
        }

        _apiExplorerBusy = true;
        BtnApiExplorerSend.IsEnabled = false;
        try
        {
            _apiExplorerLastResponse = await Services.ApiExplorerService.ExecuteAsync(url, method, _apiExplorerToken, body);
        }
        finally
        {
            _apiExplorerBusy = false;
            BtnApiExplorerSend.IsEnabled = true;
            RenderApiExplorerResponse();
        }
    }

    private void RenderApiExplorerResponse()
    {
        ApiExplorerResponsePanel.Children.Clear();
        var r = _apiExplorerLastResponse;
        if (r == null)
        {
            ApiExplorerResponsePanel.Children.Add(new TextBlock
            {
                Text = "Run it here and paste the result straight into the message you are writing.",
                FontStyle = FontStyles.Italic, FontSize = 10, TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
            });
            BtnApiExplorerCopy.IsEnabled = false;
            return;
        }

        var toneBrushKey = r.Tone switch
        {
            "success" => "Brush.Status.Running",
            "denied" => "Brush.Status.Blocked",
            "dry" => "Brush.LogLevel.Warn",
            _ => "Brush.Status.Blocked",
        };
        var chip = new Border
        {
            CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(0, 0, 0, 4),
            HorizontalAlignment = HorizontalAlignment.Left,
            Background = new SolidColorBrush(((SolidColorBrush)FindResource(toneBrushKey)).Color) { Opacity = 0.22 },
            Child = new TextBlock
            {
                Text = r.StatusCode.HasValue ? $"{r.StatusCode} {r.StatusText}" : r.StatusText,
                FontSize = 9.5, FontWeight = FontWeights.Bold, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
                Foreground = (Brush)FindResource(toneBrushKey),
            },
        };
        ApiExplorerResponsePanel.Children.Add(chip);
        ApiExplorerResponsePanel.Children.Add(new TextBlock
        {
            Text = $"{r.ElapsedMs}ms · {r.SizeBytes}b", FontSize = 8.5, Margin = new Thickness(0, 0, 0, 4),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Muted"),
        });

        // JSON Output / Raw Response toggle (Step 12 — the two must genuinely differ).
        var viewToggle = new UniformGrid { Rows = 1, Columns = 2, Margin = new Thickness(0, 0, 0, 4) };
        Button ViewBtn(string label, bool raw)
        {
            bool on = _apiExplorerResponseRaw == raw;
            var b = new Button
            {
                Height = 22, Margin = new Thickness(raw ? 3 : 0, 0, raw ? 0 : 3, 0), Style = (Style)FindResource("PanelCollapseButton"),
                Background = on ? (Brush)FindResource("Brush.Claude.Accent") : (Brush)FindResource("Brush.Claude.Bg.Content"),
                Content = new TextBlock { Text = label, FontSize = 9, Foreground = on ? new SolidColorBrush(Color.FromRgb(0x1A, 0x0F, 0x0A)) : (Brush)FindResource("Brush.Claude.Text.Muted") },
            };
            b.Click += (s, e) => { _apiExplorerResponseRaw = raw; RenderApiExplorerResponse(); };
            return b;
        }
        viewToggle.Children.Add(ViewBtn("JSON Output", false));
        viewToggle.Children.Add(ViewBtn("Raw Response", true));
        ApiExplorerResponsePanel.Children.Add(viewToggle);

        var bodyText = _apiExplorerResponseRaw ? r.RawBody : r.Body;
        ApiExplorerResponsePanel.Children.Add(new TextBox
        {
            Text = bodyText, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, AcceptsReturn = true,
            MaxHeight = 150, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Background = (Brush)FindResource("Brush.Claude.Bg.Content"), BorderThickness = new Thickness(0),
            Foreground = (Brush)FindResource("Brush.Claude.Text.Body"),
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 9.5, Margin = new Thickness(0, 0, 0, 6),
        });
        var pasteBtn = new Button
        {
            Height = 24, HorizontalAlignment = HorizontalAlignment.Stretch,
            Style = (Style)FindResource("PanelCollapseButton"),
            Content = new TextBlock { Text = "Paste response into the chat", FontSize = 10, Foreground = (Brush)FindResource("Brush.Claude.Text.Muted") },
        };
        pasteBtn.Click += (s, e) => AppendToComposer($"```\n{r.Body}\n```");
        ApiExplorerResponsePanel.Children.Add(pasteBtn);

        BtnApiExplorerCopy.IsEnabled = true;
    }

    private void BtnApiExplorerCopy_Click(object sender, RoutedEventArgs e)
    {
        if (_apiExplorerLastResponse == null) return;
        var text = _apiExplorerResponseRaw ? _apiExplorerLastResponse.RawBody : _apiExplorerLastResponse.Body;
        Clipboard.SetText(text);
        ToastEngine.Show("API Runner", _apiExplorerResponseRaw ? "Raw response copied." : "JSON output copied.", ToastKind.Info);
    }
}