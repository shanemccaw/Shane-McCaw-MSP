using System;
using System.IO;
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
        _tabs.Add(new TabDef("epic-1202", "#1202 ShaneBuilder", isChat: true, dot: (Brush)FindResource("Brush.Epic.BuildConsole"), buildSet: "ShaneBuilder"));
        SelectTab("home");

        SeedSampleQueueData();
        RenderQueue();
        RenderBuildDetail(); // starts closed (BuildDetailColumn.Width = 0) — no item selected yet
    }

    // ── SAMPLE DATA — for visually iterating on BuildQueueCard/BuildSetCard
    // styling only. Not real builds; delete this method (and its call above)
    // once ShaneBuilder has a real queue backend to read from. Covers every
    // status branch StatusBrush() handles so all the card colors are visible
    // at once.
    private void SeedSampleQueueData()
    {
        var referenceChecklist = new (string, bool)[]
        {
            ("Read spec & acceptance criteria", true),
            ("Explore codebase", true),
            ("Write implementation", true),
            ("Add/update tests", true),
            ("Run test suite", true),
            ("Fix lint & type errors", true),
            ("Update docs", true),
            ("Self-review diff", true),
            ("Push branch", false),
            ("Open PR / request review", false)
        };

        _queueItems.Add(new QueueItem("s1", "Wire the left rail's Chats panel to real session data", "ShaneBuilder", "Running",
            2007, "claude-sonnet-5", branch: "feat/side-by-side-doc-host", buildId: "bld_2007_side_by_side",
            blocks: new[] { 2008 }, blockedBy: new[] { (2002, "queued", (string?)null) }, checklist: referenceChecklist));
        _queueItems.Add(new QueueItem("s1b", "Status bar — bottom 23px, per README", "ShaneBuilder", "Blocked",
            2005, "Opus", "High", branch: "ui/consolidated-ring-progress", buildId: "bld_2005_status_bar",
            blocks: new[] { 2003, 2010 }, blockedBy: new[] { (2002, "queued", (string?)null) },
            checklist: referenceChecklist.Take(8).Select((c, i) => (c.Item1, i < 2)).ToArray()));
        _queueItems.Add(new QueueItem("s1c", "Focus nudge pill — 6-stage escalation", "ShaneBuilder", "Blocked",
            2003, "Opus", "High", branch: "feat/automated-threshold-routing", buildId: "bld_2003_auto_route",
            blockedBy: new[]
            {
                (1485, "in-flight", (string?)"Portal"),
                (1925, "queued", (string?)"Config-State-Core"),
                (2001, "queued", (string?)null),
                (2005, "blocked", (string?)null)
            },
            checklist: referenceChecklist.Take(6).Select((c, i) => (c.Item1, i < 1)).ToArray()));
        _queueItems.Add(new QueueItem("s2", "Build detail flyout — slide out from Build Queue's left edge", "ShaneBuilder", "Queued",
            2202, "Sonnet 5", "High", blockedBy: new[] { (2201, "in-flight", (string?)null) }));
        _queueItems.Add(new QueueItem("s3", "Status bar — bottom 23px, per README", "ShaneBuilder", "Verifying", 2199, "Opus 5", "Medium"));
        _queueItems.Add(new QueueItem("s4", "Focus nudge pill — 6-stage escalation", "ShaneBuilder", "Done", 2190));
        _queueItems.Add(new QueueItem("s5", "Claude chat pane — warm sub-palette", "ShaneBuilder", "Failed", 2185, "Sonnet 5", "High"));
        _queueItems.Add(new QueueItem("s6", "Next Up panel real GitHub wiring", "App Core", "Blocked", 2144, blockedBy: new[] { (2101, "queued", (string?)null), (2102, "queued", (string?)null) }));
        _queueItems.Add(new QueueItem("s7", "Epics panel real GitHub wiring", "App Core", "Parked", 2145));
        _queueItems.Add(new QueueItem("s8", "Ad-hoc research spike — deferred", "App Core", "Cancelled", 2130));
        _queueItems.Add(new QueueItem("s9", "Opus run over Conservation Cap threshold", "App Core", "Capped", 2131, "Opus 5", "High"));
        _queueItems.Add(new QueueItem("s10", "Launched via Send to Builder", "App Core", "External", 2132));
        _queueItems.Add(new QueueItem("s11", "Regression sweep — test-manifests", "App Core", "Tests", 2133));

        _buildSetChatRefs["ShaneBuilder"] = "Chat 1: App Shell Scaffolding";
        _buildSetChatRefs["App Core"] = "Chat 1: Engine & Schema Work";

        _expandedSets.Add("ShaneBuilder"); // expanded by default so the sample cards are visible immediately
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        WindowChromeHelper.Setup(this);
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

        _leftPanelSource = source;
        LeftPanel.Width = LeftPanelWidth;
        LeftPanelTitle.Text = RailPanelLabels.TryGetValue(source, out var label) ? label : source.ToUpperInvariant();

        foreach (var rail in RailButtons)
            rail.IsChecked = ReferenceEquals(rail, clicked);

        ChatsPanelBody.Visibility = source == "Chat" ? Visibility.Visible : Visibility.Collapsed;
        GitPanelBody.Visibility = source == "Git" ? Visibility.Visible : Visibility.Collapsed;
        NextUpPanelBody.Visibility = source == "NextUp" ? Visibility.Visible : Visibility.Collapsed;

        // Batter Up / Build Console / Build Watch / UI Testing / Shot Vault
        // share one placeholder body — none of them have a real design or
        // data source yet, so this is an honest "not built" state, not
        // invented content per panel.
        bool notBuilt = source is "BatterUp" or "BuildConsole" or "BuildWatch" or "UiTesting" or "ShotVault";
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
    // is pinned first and never closable, matching kind:'home' there having
    // no onClose affordance; every other tab gets an epic-accent dot (shown
    // only while active, per tb.dot logic) and a × close button that falls
    // back to the previous tab, or Home, same as the mockup's closeTabById.
    private sealed class TabDef
    {
        public string Id { get; }
        public string Title { get; }
        public bool IsHome { get; }
        public bool IsChat { get; }
        public Brush? Dot { get; }
        public string? BuildSet { get; }

        public TabDef(string id, string title, bool isHome = false, bool isChat = false, Brush? dot = null, string? buildSet = null)
        {
            Id = id;
            Title = title;
            IsHome = isHome;
            IsChat = isChat;
            Dot = dot;
            BuildSet = buildSet;
        }
    }

    private readonly List<TabDef> _tabs = new();
    private string _activeTabId = "home";

    private void RenderTabStrip()
    {
        TabStripPanel.Children.Clear();
        foreach (var t in _tabs)
            TabStripPanel.Children.Add(BuildTabPill(t));
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

        content.Children.Add(new TextBlock
        {
            Text = t.Title,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = isActive ? (double)FindResource("FontSize.15") : (double)FindResource("FontSize.14"),
            FontWeight = isActive ? (FontWeight)FindResource("FontWeight.Bold") : (FontWeight)FindResource("FontWeight.Regular"),
            Foreground = isActive ? (Brush)FindResource("Brush.Text.Heading") : (Brush)FindResource("Brush.Text.Muted"),
            VerticalAlignment = VerticalAlignment.Center
        });

        if (!t.IsHome)
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

        if (!t.IsHome)
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

        _activeTabId = id;
        RenderTabStrip();

        HomeTabContent.Visibility = tab.IsHome ? Visibility.Visible : Visibility.Collapsed;
        ClaudeChatDock.Visibility = tab.IsChat ? Visibility.Visible : Visibility.Collapsed;
        StubTabContent.Visibility = !tab.IsHome && !tab.IsChat ? Visibility.Visible : Visibility.Collapsed;
        if (!tab.IsHome && !tab.IsChat)
            StubTabContent.Text = tab.Title + " — nothing here yet";
        if (tab.IsChat)
            RenderClaudeChatContext(tab);
    }

    private void CloseTab(string id)
    {
        int idx = _tabs.FindIndex(t => t.Id == id);
        if (idx < 0 || _tabs[idx].IsHome) return;

        _tabs.RemoveAt(idx);

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
    // No real queue backend (Postgres/GitHub) is wired up in ShaneBuilder
    // yet, so _queueItems starts empty and the panel shows an honest empty
    // state — RenderQueue is fully ready for when real items land.
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

    // Sample-only: a chat reference pill per build set. Real chat linking
    // isn't built yet, so this is populated only from SeedSampleQueueData —
    // BuildSetCard hides the pill entirely when a set has no entry here.
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

        CloseStatDetailPanel(); // stale filter after a re-render (e.g. switching chat tabs)
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

    // ── Command Palette — Ctrl+K (or the title bar search trigger). Results
    // are built from real data only (_tabs, _queueItems). The reference
    // screenshot's other categories (Git Epics, Git Issues, Services,
    // Terminal, SQL, Build IDs, Files) are kept for visual parity but stay
    // an honest (0) — ShaneBuilder has no real data source for any of them
    // yet, so they're never populated with invented rows.
    private sealed class PaletteResult
    {
        public string Category { get; }
        public string Title { get; }
        public string? Subtitle { get; }
        public Brush? Dot { get; }
        public string PreviewTitle { get; }
        public string? PreviewBody { get; }
        public Action OnSelect { get; }

        public PaletteResult(string category, string title, string? subtitle, Brush? dot, string previewTitle, string? previewBody, Action onSelect)
        {
            Category = category;
            Title = title;
            Subtitle = subtitle;
            Dot = dot;
            PreviewTitle = previewTitle;
            PreviewBody = previewBody;
            OnSelect = onSelect;
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
            else if (e.Key == Key.Enter) { e.Handled = true; ActivatePaletteSelection(); }
            else if (e.Key == Key.Tab)
            {
                e.Handled = true;
                int idx = Array.FindIndex(PaletteCategories, c => c.Key == _paletteCategory);
                int dir = (Keyboard.Modifiers & ModifierKeys.Shift) != 0 ? -1 : 1;
                SetPaletteCategory(PaletteCategories[(idx + dir + PaletteCategories.Length) % PaletteCategories.Length].Key);
            }
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

        foreach (var tab in _tabs)
        {
            results.Add(new PaletteResult("ClaudeUrls", tab.Title, tab.IsHome ? "Home tab" : "Chat tab",
                tab.Dot, tab.Title, tab.IsHome ? "Today's objectives and Next Up." : "Real claude.ai, embedded via WebView2.",
                () => SelectTab(tab.Id)));
        }

        foreach (var item in _queueItems)
        {
            string title = item.GithubNumber.HasValue ? $"#{item.GithubNumber.Value} {item.Title}" : item.Title;
            results.Add(new PaletteResult("Builds", title, $"{item.BuildSet} · {StatusDisplayLabel(item.Status)}",
                StatusBrush(item.Status), title, item.Branch != null ? $"Branch: {item.Branch}" : null,
                () => OpenBuildDetail(item)));
        }

        return results;
    }

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
        _paletteFiltered[_paletteSelectedIndex].OnSelect();
        CloseCommandPalette();
    }

    private void RenderCommandPaletteResults(bool preserveSelection = false)
    {
        string query = CommandPaletteInput.Text.Trim();
        var all = BuildAllPaletteResults();
        var scoped = _paletteCategory == "All" ? all : all.Where(r => r.Category == _paletteCategory);

        _paletteFiltered = (query.Length == 0
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

        RenderPalettePreview(_paletteFiltered[_paletteSelectedIndex]);
    }

    private void RenderPalettePreview(PaletteResult result)
    {
        CommandPalettePreview.Children.Clear();
        CommandPalettePreview.Children.Add(new TextBlock
        {
            Text = result.PreviewTitle,
            TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.13"),
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Heading")
        });
        if (result.PreviewBody != null)
        {
            CommandPalettePreview.Children.Add(new TextBlock
            {
                Text = result.PreviewBody,
                Margin = new Thickness(0, 8, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.11.5"),
                Foreground = (Brush)FindResource("Brush.Text.Muted")
            });
        }
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
        border.MouseLeftButtonDown += (s, e) => { result.OnSelect(); CloseCommandPalette(); };
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
}