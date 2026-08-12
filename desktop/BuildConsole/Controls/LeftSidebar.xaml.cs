using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public class SearchFileResult
    {
        public string FilePath { get; set; } = string.Empty;
        public string FileName => System.IO.Path.GetFileName(FilePath);
        public List<SearchResultLine> Matches { get; set; } = new();
        public string MatchCountStr => $"{Matches.Count} match{(Matches.Count == 1 ? "" : "es")}";
    }

    public class SearchResultLine
    {
        public string FilePath { get; set; } = string.Empty;
        public int LineNumber { get; set; }
        public string LineNumberStr => $"L{LineNumber}";
        public string Snippet { get; set; } = string.Empty;
    }

    public class GitMilestone
    {
        public string Title { get; set; } = string.Empty;
        public int CompletedCount { get; set; }
        public int TotalCount { get; set; }
        public int ProgressPercent => TotalCount == 0 ? 0 : (CompletedCount * 100 / TotalCount);
        public string ProgressStr => $"{ProgressPercent}% ({CompletedCount}/{TotalCount})";
        public List<GitEpic> Epics { get; set; } = new();
    }

    public class GitEpic
    {
        public string Title { get; set; } = string.Empty;
        public string ColorHex { get; set; } = "#CBA6F7";
        public List<GitIssue> Issues { get; set; } = new();
    }

    public class GitIssue
    {
        public int IssueNumber { get; set; }
        public string NumberStr => $"#{IssueNumber}";
        public string Title { get; set; } = string.Empty;
        public string Priority { get; set; } = "HIGH";
        public string Status { get; set; } = "OPEN";
        /// <summary>lib/db/migrations/manual/*.sql path referenced in the real GitHub issue body, if any — Shane To-Do items only. See CreateIssueHeader's "Load SQL" context menu item.</summary>
        public string? SqlPath { get; set; }
        public string PriorityBadge => Priority switch
        {
            "HIGH" => "🔥",
            "MED" => "🟡",
            _ => "🟢"
        };
    }

    public class GitItem
    {
        public string FilePath { get; set; } = string.Empty;
        public string RelativePath { get; set; } = string.Empty;
        public string FileName => System.IO.Path.GetFileName(FilePath);
        public string StatusLetter { get; set; } = "M";
        public bool IsStaged { get; set; }
        public Brush StatusBrush => StatusLetter switch
        {
            "M" => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")),
            "A" or "U" or "?" => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#A6E3A1")),
            "D" => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")),
            _ => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#89B4FA"))
        };
    }

    public class AutomationAction
    {
        public int Index { get; set; }
        public string IndexStr => $"#{Index}";
        public string ActionType { get; set; } = "click";
        public string ActionTypeUpper => ActionType.ToUpper();
        public string Selector { get; set; } = string.Empty;
        public string TagName { get; set; } = "div";
        public string Value { get; set; } = string.Empty;
        public Visibility ValueVisibility => string.IsNullOrEmpty(Value) ? Visibility.Collapsed : Visibility.Visible;
        public string Timestamp { get; set; } = DateTime.Now.ToString("HH:mm:ss");
    }

    public partial class LeftSidebar : UserControl
    {
        private string _currentView = "Chats";
        private const string RootWorkspacePath = @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP";

        public event EventHandler<string>? FileSelected;
        /// <summary>
        /// Git #802 - carries the resolved real GitHub number alongside the
        /// chat (chat's own IssueGithubNumber, falling back to its linked
        /// epic's) so MainWindow can match it against a live queue item and
        /// show/hide that tab's build split pane - the URL alone isn't enough.
        /// </summary>
        public event EventHandler<(BoardChat Chat, int? GithubNumber)>? ChatSelected;
        /// <summary>Fired when Shane clicks "Load SQL" on a Shane To-Do item — MainWindow fetches the real text and hands it to SqlRunnerView.</summary>
        public event EventHandler<string>? SqlLoadRequested;
        public event EventHandler<bool>? PinToggled;
        /// <summary>
        /// Git #815 — Shane: "I don't want to have to click the refresh
        /// button all the time... or an error alert when it fails." Fired
        /// with a message on a failed poll, null on the next successful one
        /// (MainWindow shows/clears a real status-bar indicator instead of
        /// the failure sitting silently as inline tree text nobody notices).
        /// </summary>
        public event EventHandler<string?>? SyncError;
        private bool _isPinned = true;

        private void BtnPinSidebar_Click(object sender, RoutedEventArgs e)
        {
            _isPinned = !_isPinned;
            PinSidebarIcon.Text = _isPinned ? "📌" : "📍";
            PinToggled?.Invoke(this, _isPinned);
        }

        public void ExpandPanel()
        {
            _isPinned = true;
            PinSidebarIcon.Text = "📌";
        }

        private BuildTrackerApiClient? _api;
        private DispatcherTimer? _pollTimer;

        /// <summary>Called once from MainWindow with the shared API client — the Issues board fetches on demand once this is set.</summary>
        public void Initialize(BuildTrackerApiClient api)
        {
            _api = api;
            ApiBaseUrlDisplay.Text = api.IsConfigured ? api.ConfiguredApiBaseUrl : "(not connected)";
            ConfigPathText.Text = api.ConfigPath ?? "No scripts\\build-queue-watcher.config.json found — copy the .example template next to it and fill in apiBaseUrl/ingestToken.";

            // Git #815 — both boards used to load ONLY when Shane switched to
            // that tab (or clicked a manual refresh), so anything that
            // changed while he was looking at a different view (or just
            // sitting on the same one) needed a manual click to show up.
            // Poll both regardless of which view is currently visible - cheap
            // (same two GETs BuildQueuePanel and the extension already poll
            // this often) and keeps everything current without Shane having
            // to remember to refresh.
            if (api.IsConfigured)
            {
                _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
                _pollTimer.Tick += (_, _) =>
                {
                    PopulateGitTrackerBoard();
                    PopulateChatsTree();
                };
                _pollTimer.Start();
            }
        }

        public LeftSidebar()
        {
            InitializeComponent();
            LoadWorkspaceExplorer(RootWorkspacePath);
        }

        private void ExplorerTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem item && item.Tag is string path && File.Exists(path))
            {
                FileSelected?.Invoke(this, path);
            }
        }

        private void ExplorerTree_PreviewMouseWheel(object sender, System.Windows.Input.MouseWheelEventArgs e)
        {
            if (ExplorerScrollViewer != null)
            {
                ExplorerScrollViewer.ScrollToVerticalOffset(ExplorerScrollViewer.VerticalOffset - e.Delta);
                e.Handled = true;
            }
        }

        public event EventHandler<string>? StartRecordingRequested;
        public event EventHandler? StopRecordingRequested;
        public event EventHandler<(string url, List<AutomationAction> steps)>? PlayTestRequested;

        private bool _isRecording = false;
        public readonly List<AutomationAction> RecordedSteps = new();

        public void RecordAction(string actionType, string selector, string tagName, string val)
        {
            AddRecordedStep(actionType, selector, tagName, val);
        }

        public void AddRecordedStep(string actionType, string selector, string tagName, string val)
        {
            var action = new AutomationAction
            {
                Index = RecordedSteps.Count + 1,
                ActionType = actionType,
                Selector = selector,
                TagName = tagName,
                Value = val
            };
            RecordedSteps.Add(action);
            AutomationStepsList.Items.Add(action);
        }

        private void BtnRecordTest_Click(object sender, RoutedEventArgs e)
        {
            _isRecording = !_isRecording;
            if (_isRecording)
            {
                BtnRecordTest.Content = "■ Stop";
                RecordingBadge.Visibility = Visibility.Visible;
                StartRecordingRequested?.Invoke(this, AutomationTargetUrl.Text);
            }
            else
            {
                BtnRecordTest.Content = "● Record";
                RecordingBadge.Visibility = Visibility.Collapsed;
                StopRecordingRequested?.Invoke(this, EventArgs.Empty);
            }
        }

        private void BtnPlayTest_Click(object sender, RoutedEventArgs e)
        {
            if (_isRecording)
            {
                BtnRecordTest_Click(sender, e);
            }
            PlayTestRequested?.Invoke(this, (AutomationTargetUrl.Text, RecordedSteps));
        }

        private void BtnClearSteps_Click(object sender, RoutedEventArgs e)
        {
            RecordedSteps.Clear();
            AutomationStepsList.Items.Clear();
        }

        /// <summary>Returns the currently displayed view name.</summary>
        public string GetCurrentView() => _currentView;

        /// <summary>Switch the visible content panel based on the activity bar selection.</summary>
        public void SwitchView(string view)
        {
            _currentView = view;
            ChatsView.Visibility      = view == "Chats"      ? Visibility.Visible : Visibility.Collapsed;
            ExplorerView.Visibility   = view == "Explorer"   ? Visibility.Visible : Visibility.Collapsed;
            SearchView.Visibility     = view == "Search"     ? Visibility.Visible : Visibility.Collapsed;
            GitView.Visibility        = view == "Git"        ? Visibility.Visible : Visibility.Collapsed;
            IssuesView.Visibility     = view == "Issues"     ? Visibility.Visible : Visibility.Collapsed;
            SettingsView.Visibility   = view == "Settings"   ? Visibility.Visible : Visibility.Collapsed;
            AutomationView.Visibility = view == "Automation" ? Visibility.Visible : Visibility.Collapsed;

            HeaderTitle.Text = view == "Automation" ? "UI AUTOMATION" : (view == "Issues" ? "GIT BOARD" : view.ToUpperInvariant());

            // Adjust the New button tooltip to match the active view
            BtnNewItem.ToolTip = view switch
            {
                "Chats"      => "New Chat",
                "Explorer"   => "New File",
                "Search"     => "Search",
                "Git"        => "Commit",
                "Issues"     => "New Issue",
                "Automation" => "New Test",
                _            => "New"
            };

            if (view == "Explorer" && ExplorerTree.Items.Count == 0)
            {
                LoadWorkspaceExplorer(RootWorkspacePath);
            }
            else if (view == "Git")
            {
                RefreshGitStatus();
            }
            else if (view == "Issues")
            {
                PopulateGitTrackerBoard();
            }
            else if (view == "Chats")
            {
                PopulateChatsTree();
            }
        }

        // ── GIT MILESTONES, EPICS & ISSUES ADHD TRACKER ─────────────────────
        // Git — Shane: "Feel free to change anything to patch how I actually
        // work based on the Add-In." This was 100% hardcoded demo data before;
        // now reads the SAME GET /extension/in-progress the browser
        // extension's left panel already polls, so this shows real
        // in-flight/complete/blocked/Shane-To-Do issues, not a fixed fake
        // board. There's no "milestone" concept in that endpoint's data (the
        // extension's own panel doesn't group by milestone either) — grouped
        // into Epics/Issues/Shane To-Do buckets instead, under one synthetic
        // "milestone" so the existing tree-rendering code below needs no
        // structural changes.
        private readonly List<GitMilestone> _milestones = new();

        public async void PopulateGitTrackerBoard()
        {
            IssuesTree.Items.Clear();

            if (_api == null || !_api.IsConfigured)
            {
                IssueStatMilestones.Text = "0 Active";
                IssueStatEpics.Text = "0 Active";
                IssueStatOpen.Text = "0 Pending";
                IssueStatClosed.Text = "0 Done";
                IssuesTree.Items.Add(new TreeViewItem { Header = "Not connected — set apiBaseUrl/ingestToken in scripts\\build-queue-watcher.config.json (Settings tab has the path)." });
                return;
            }

            List<InProgressItem> items;
            try
            {
                items = await _api.GetInProgressAsync();
                SyncError?.Invoke(this, null);
            }
            catch (Exception ex)
            {
                IssuesTree.Items.Add(new TreeViewItem { Header = $"Couldn't reach the API: {ex.Message}" });
                SyncError?.Invoke(this, $"Issues board: {ex.Message}");
                return;
            }

            GitEpic MapBucket(string title, string colorHex, IEnumerable<InProgressItem> src)
            {
                var epic = new GitEpic { Title = title, ColorHex = colorHex };
                foreach (var it in src)
                {
                    var title2 = it.IsBlocked && it.BlockedBy != null
                        ? $"{it.Title} (blocked by #{it.BlockedBy.Number})"
                        : it.Title;
                    epic.Issues.Add(new GitIssue
                    {
                        IssueNumber = it.GithubNumber,
                        Title = title2,
                        Priority = it.IsBlocked ? "HIGH" : "MED",
                        Status = it.Labels.Contains("complete") ? "CLOSED" : "OPEN",
                        SqlPath = it.SqlPath,
                    });
                }
                return epic;
            }

            var milestone = new GitMilestone { Title = "Live — GitHub in-flight" };
            var epicsBucket = MapBucket("⚡ Epics", "#89B4FA", items.Where(i => i.IsEpic && !i.IsTodo));
            var issuesBucket = MapBucket("⚡ Issues", "#A6E3A1", items.Where(i => !i.IsEpic && !i.IsTodo));
            var todoBucket = MapBucket("⚡ Shane To-Do", "#F5C2E7", items.Where(i => i.IsTodo));
            if (epicsBucket.Issues.Count > 0) milestone.Epics.Add(epicsBucket);
            if (issuesBucket.Issues.Count > 0) milestone.Epics.Add(issuesBucket);
            if (todoBucket.Issues.Count > 0) milestone.Epics.Add(todoBucket);
            milestone.TotalCount = items.Count;
            milestone.CompletedCount = items.Count(i => i.Labels.Contains("complete"));

            _milestones.Clear();
            if (milestone.Epics.Count > 0) _milestones.Add(milestone);

            RenderIssuesTree("All");
        }

        // ── CHATS (real GET /extension/board — grouped by linked epic) ──────
        public async void PopulateChatsTree()
        {
            ChatsTree.Items.Clear();

            if (_api == null || !_api.IsConfigured)
            {
                ChatsTree.Items.Add(new TreeViewItem { Header = "Not connected — see Settings" });
                return;
            }

            BoardResponse board;
            try
            {
                board = await _api.GetBoardAsync();
                SyncError?.Invoke(this, null);
            }
            catch (Exception ex)
            {
                ChatsTree.Items.Add(new TreeViewItem { Header = $"Couldn't reach the API: {ex.Message}" });
                SyncError?.Invoke(this, $"Chats: {ex.Message}");
                return;
            }

            var epicById = board.Epics.ToDictionary(e => e.Id);
            _chatEpicById = epicById;
            var byEpic = board.Chats.Where(c => c.EpicId.HasValue).GroupBy(c => c.EpicId!.Value);
            var unlinked = board.Chats.Where(c => !c.EpicId.HasValue).ToList();

            TreeViewItem BuildEpicHeader(string title)
            {
                var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
                p.Children.Add(new System.Windows.Shapes.Ellipse { Width = 7, Height = 7, Fill = GetBrush("BlueBrush"), Margin = new Thickness(0, 0, 7, 0), VerticalAlignment = VerticalAlignment.Center });
                p.Children.Add(new TextBlock { Text = title, FontSize = 13, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
                return new TreeViewItem { Header = p, IsExpanded = true };
            }

            TreeViewItem BuildChatLeaf(BoardChat chat)
            {
                var p = new StackPanel { Orientation = Orientation.Horizontal };
                p.Children.Add(new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 13, Foreground = GetBrush("BlueBrush"), Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center });
                p.Children.Add(new TextBlock { Text = chat.Title, FontSize = 13, VerticalAlignment = VerticalAlignment.Center });
                return new TreeViewItem { Header = p, Tag = chat };
            }

            foreach (var grp in byEpic)
            {
                var title = epicById.TryGetValue(grp.Key, out var epic) ? epic.Title : $"Epic #{grp.Key}";
                var epicItem = BuildEpicHeader(title);
                foreach (var chat in grp.OrderByDescending(c => c.UpdatedAt)) epicItem.Items.Add(BuildChatLeaf(chat));
                ChatsTree.Items.Add(epicItem);
            }

            if (unlinked.Count > 0)
            {
                var unlinkedItem = BuildEpicHeader("Unlinked");
                foreach (var chat in unlinked.OrderByDescending(c => c.UpdatedAt)) unlinkedItem.Items.Add(BuildChatLeaf(chat));
                ChatsTree.Items.Add(unlinkedItem);
            }

            if (ChatsTree.Items.Count == 0)
            {
                ChatsTree.Items.Add(new TreeViewItem { Header = "No chats linked yet." });
            }
        }

        private Dictionary<int, BoardEpic> _chatEpicById = new();

        private void ChatsTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is BoardChat chat && !string.IsNullOrEmpty(chat.ClaudeUrl))
            {
                int? githubNumber = chat.IssueGithubNumber
                    ?? (chat.EpicId.HasValue && _chatEpicById.TryGetValue(chat.EpicId.Value, out var epic) ? epic.GithubNumber : null);
                ChatSelected?.Invoke(this, (chat, githubNumber));
            }
        }

        private void RenderIssuesTree(string filter)
        {
            IssuesTree.Items.Clear();

            int totalMilestones = _milestones.Count;
            int totalEpics = _milestones.Sum(m => m.Epics.Count);
            int openIssues = _milestones.Sum(m => m.Epics.Sum(e => e.Issues.Count(i => i.Status != "CLOSED")));
            int closedIssues = _milestones.Sum(m => m.Epics.Sum(e => e.Issues.Count(i => i.Status == "CLOSED")));

            IssueStatMilestones.Text = $"{totalMilestones} Active";
            IssueStatEpics.Text = $"{totalEpics} Active";
            IssueStatOpen.Text = $"{openIssues} Pending";
            IssueStatClosed.Text = $"{closedIssues} Done";

            foreach (var m in _milestones)
            {
                if (filter == "Milestones" || filter == "All" || filter == "Priority")
                {
                    var milestoneItem = new TreeViewItem
                    {
                        Header = CreateMilestoneHeader(m),
                        IsExpanded = true
                    };

                    foreach (var epic in m.Epics)
                    {
                        var epicItem = new TreeViewItem
                        {
                            Header = CreateEpicHeader(epic),
                            IsExpanded = true
                        };

                        foreach (var issue in epic.Issues)
                        {
                            if (filter == "Priority" && issue.Priority != "HIGH") continue;
                            if (filter == "Done" && issue.Status != "CLOSED") continue;

                            epicItem.Items.Add(CreateIssueHeader(issue));
                        }

                        if (epicItem.Items.Count > 0 || filter == "All" || filter == "Epics")
                        {
                            milestoneItem.Items.Add(epicItem);
                        }
                    }

                    if (milestoneItem.Items.Count > 0 || filter == "All" || filter == "Milestones")
                    {
                        IssuesTree.Items.Add(milestoneItem);
                    }
                }
            }
        }

        private static readonly Dictionary<string, SolidColorBrush> _fallbackBrushes = new()
        {
            { "CrustBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#11111B")) },
            { "MantleBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#181825")) },
            { "BaseBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1E1E2E")) },
            { "Surface0Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#313244")) },
            { "Surface1Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#45475A")) },
            { "TextBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#CDD6F4")) },
            { "Subtext0Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#BAC2DE")) },
            { "Subtext1Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#A6ADC8")) },
            { "BlueBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#89B4FA")) },
            { "MauveBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#CBA6F7")) },
            { "GreenBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#A6E3A1")) },
            { "RedBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")) },
            { "PeachBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")) }
        };

        private Brush GetBrush(string key)
        {
            try
            {
                if (TryFindResource(key) is Brush b) return b;
                if (Application.Current != null && Application.Current.TryFindResource(key) is Brush appB) return appB;
            }
            catch { }

            return _fallbackBrushes.TryGetValue(key, out var fallback) ? fallback : Brushes.Gray;
        }

        private UIElement CreateMilestoneHeader(GitMilestone m)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 3, 0, 3) };
            p.Children.Add(new TextBlock { Text = "🎯 ", FontSize = 13 });
            p.Children.Add(new TextBlock { Text = m.Title, FontWeight = FontWeights.Bold, FontSize = 12, Foreground = GetBrush("TextBrush") });
            
            var badge = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 1, 6, 1),
                Margin = new Thickness(8, 0, 0, 0)
            };
            badge.Child = new TextBlock
            {
                Text = m.ProgressStr,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("BlueBrush")
            };
            p.Children.Add(badge);

            return p;
        }

        private UIElement CreateEpicHeader(GitEpic e)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
            p.Children.Add(new TextBlock { Text = e.Title, FontWeight = FontWeights.SemiBold, FontSize = 11, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(e.ColorHex)) });
            p.Children.Add(new TextBlock { Text = $" ({e.Issues.Count})", FontSize = 10, Foreground = GetBrush("Subtext0Brush"), Margin = new Thickness(4, 0, 0, 0) });
            return p;
        }

        private TreeViewItem CreateIssueHeader(GitIssue issue)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };

            var prioBlock = new TextBlock { Text = issue.PriorityBadge + " ", FontSize = 11 };

            var numBlock = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            numBlock.Child = new TextBlock { Text = issue.NumberStr, FontSize = 10, FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") };

            var titleBlock = new TextBlock
            {
                Text = issue.Title,
                FontSize = 11,
                Foreground = issue.Status == "CLOSED" ? GetBrush("Subtext0Brush") : GetBrush("TextBrush"),
                TextDecorations = issue.Status == "CLOSED" ? TextDecorations.Strikethrough : null
            };

            p.Children.Add(prioBlock);
            p.Children.Add(numBlock);
            p.Children.Add(titleBlock);

            var tvi = new TreeViewItem
            {
                Header = p,
                Tag = issue
            };

            // Real toggle - Shane: "Feel free to change anything to patch how I
            // actually work." This tree is live GitHub data now, so a purely
            // local status flip (the old demo behavior) would silently revert
            // on the next real refresh, looking like it worked when nothing
            // actually changed. Toggles the real `complete` label via the same
            // endpoint the extension's own Mark-In-Progress button uses. No
            // real "priority" concept exists anywhere in Build Tracker, so
            // that fake menu item is gone rather than left as a no-op.
            var cm = new ContextMenu();
            var miToggle = new MenuItem { Header = issue.Status == "CLOSED" ? "Remove 'complete' label" : "✓ Mark Complete" };
            miToggle.Click += async (s, e) =>
            {
                if (_api == null) return;
                try
                {
                    await _api.ToggleLabelAsync(issue.IssueNumber, "complete", issue.Status != "CLOSED");
                }
                catch { /* best-effort — next refresh will show the real state either way */ }
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miToggle);

            // Same real capability as the extension's Shane To-Do 🗄 button —
            // only shown when the real GitHub issue body actually references
            // a lib/db/migrations/manual/*.sql file.
            if (!string.IsNullOrEmpty(issue.SqlPath))
            {
                var miLoadSql = new MenuItem { Header = $"🗄 Load {issue.SqlPath} into SQL Runner" };
                miLoadSql.Click += (s, e) => SqlLoadRequested?.Invoke(this, issue.SqlPath!);
                cm.Items.Add(miLoadSql);
            }

            tvi.ContextMenu = cm;
            return tvi;
        }

        private void QuickAddIssueBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                string title = QuickAddIssueBox.Text.Trim();
                if (!string.IsNullOrEmpty(title))
                {
                    if (_milestones.Count > 0 && _milestones[0].Epics.Count > 0)
                    {
                        var targetEpic = _milestones[0].Epics[0];
                        targetEpic.Issues.Add(new GitIssue
                        {
                            IssueNumber = 300 + targetEpic.Issues.Count + 1,
                            Title = title,
                            Priority = "HIGH",
                            Status = "OPEN"
                        });
                        RenderIssuesTree("All");
                        QuickAddIssueBox.Text = string.Empty;
                    }
                }
            }
        }

        private void IssueFilter_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string filter)
            {
                RenderIssuesTree(filter);
            }
        }

        // ── SEARCH VIEW (Full-Text File Content Search) ──────────────────────
        private void SearchInputBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                PerformFullTextSearch();
            }
        }

        private void BtnExecuteSearch_Click(object sender, RoutedEventArgs e)
        {
            PerformFullTextSearch();
        }

        private void BtnClearSearch_Click(object sender, RoutedEventArgs e)
        {
            SearchInputBox.Text = string.Empty;
            SearchIncludesBox.Text = string.Empty;
            SearchResultsTree.ItemsSource = null;
            SearchSummaryText.Text = "Enter search query & press Enter";
        }

        private async void PerformFullTextSearch()
        {
            string query = SearchInputBox.Text.Trim();
            if (string.IsNullOrEmpty(query))
            {
                SearchResultsTree.ItemsSource = null;
                SearchSummaryText.Text = "Please enter a search query";
                return;
            }

            SearchSummaryText.Text = "Searching file contents...";
            bool matchCase = BtnMatchCase.IsChecked == true;
            string filterPattern = SearchIncludesBox.Text.Trim();

            var results = await System.Threading.Tasks.Task.Run(() =>
            {
                var fileResults = new List<SearchFileResult>();
                try
                {
                    var opt = new EnumerationOptions
                    {
                        IgnoreInaccessible = true,
                        RecurseSubdirectories = true,
                        MaxRecursionDepth = 6
                    };

                    string searchDir = RootWorkspacePath;
                    if (!Directory.Exists(searchDir)) return fileResults;

                    StringComparison comparison = matchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;

                    foreach (var file in Directory.EnumerateFiles(searchDir, "*.*", opt))
                    {
                        string name = Path.GetFileName(file);
                        if (name.StartsWith(".") || file.Contains("\\bin\\") || file.Contains("\\obj\\") || file.Contains("\\node_modules\\") || file.Contains("\\.git\\"))
                            continue;

                        if (!string.IsNullOrEmpty(filterPattern))
                        {
                            string ext = Path.GetExtension(file);
                            if (!filterPattern.Contains(ext, StringComparison.OrdinalIgnoreCase))
                                continue;
                        }

                        try
                        {
                            var lines = File.ReadAllLines(file);
                            var matches = new List<SearchResultLine>();

                            for (int i = 0; i < lines.Length; i++)
                            {
                                if (lines[i].Contains(query, comparison))
                                {
                                    matches.Add(new SearchResultLine
                                    {
                                        FilePath = file,
                                        LineNumber = i + 1,
                                        Snippet = lines[i].Trim()
                                    });

                                    if (matches.Count >= 20) break;
                                }
                            }

                            if (matches.Count > 0)
                            {
                                fileResults.Add(new SearchFileResult
                                {
                                    FilePath = file,
                                    Matches = matches
                                });

                                if (fileResults.Count >= 50) break;
                            }
                        }
                        catch { }
                    }
                }
                catch { }

                return fileResults;
            });

            SearchResultsTree.ItemsSource = results;
            int totalMatches = results.Sum(r => r.Matches.Count);
            SearchSummaryText.Text = $"Found {totalMatches} result{(totalMatches == 1 ? "" : "s")} in {results.Count} file{(results.Count == 1 ? "" : "s")}";
        }

        private void SearchResultsTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is SearchFileResult fileRes)
            {
                FileSelected?.Invoke(this, fileRes.FilePath);
            }
            else if (e.NewValue is SearchResultLine lineRes)
            {
                FileSelected?.Invoke(this, lineRes.FilePath);
            }
        }

        // ── GIT SOURCE CONTROL ENGINE ───────────────────────────────────────
        public async void RefreshGitStatus()
        {
            GitStatusSummaryText.Text = "REFRESHING GIT STATUS...";

            var (branch, stagedItems, unstagedItems) = await System.Threading.Tasks.Task.Run(() =>
            {
                string b = "main";
                var staged = new List<GitItem>();
                var unstaged = new List<GitItem>();

                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "git",
                        Arguments = "status --porcelain -b",
                        WorkingDirectory = RootWorkspacePath,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };

                    using var proc = System.Diagnostics.Process.Start(psi);
                    if (proc != null)
                    {
                        string output = proc.StandardOutput.ReadToEnd();
                        proc.WaitForExit();

                        string[] lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                        foreach (var line in lines)
                        {
                            if (line.StartsWith("##"))
                            {
                                string branchLine = line.Substring(2).Trim();
                                int dots = branchLine.IndexOf("...");
                                b = dots > 0 ? branchLine.Substring(0, dots) : branchLine;
                            }
                            else if (line.Length >= 4)
                            {
                                char indexState = line[0];
                                char workState = line[1];
                                string relPath = line.Substring(3).Trim().Trim('"');
                                string fullPath = System.IO.Path.Combine(RootWorkspacePath, relPath.Replace('/', '\\'));

                                if (indexState != ' ' && indexState != '?')
                                {
                                    staged.Add(new GitItem
                                    {
                                        FilePath = fullPath,
                                        RelativePath = relPath,
                                        StatusLetter = indexState.ToString(),
                                        IsStaged = true
                                    });
                                }

                                if (workState != ' ')
                                {
                                    unstaged.Add(new GitItem
                                    {
                                        FilePath = fullPath,
                                        RelativePath = relPath,
                                        StatusLetter = workState == '?' ? "U" : workState.ToString(),
                                        IsStaged = false
                                    });
                                }
                            }
                        }
                    }
                }
                catch { }

                return (b, staged, unstaged);
            });

            GitBranchText.Text = branch;
            GitStatusSummaryText.Text = $"STAGED ({stagedItems.Count})  •  CHANGES ({unstagedItems.Count})";

            GitChangesTree.Items.Clear();

            // Staged Tree Header
            var stagedTreeItem = new TreeViewItem
            {
                Header = CreateGitCategoryHeader("STAGED CHANGES", stagedItems.Count, "#A6E3A1"),
                IsExpanded = true
            };
            foreach (var item in stagedItems)
            {
                stagedTreeItem.Items.Add(CreateGitFileTreeItem(item));
            }

            // Unstaged Tree Header
            var unstagedTreeItem = new TreeViewItem
            {
                Header = CreateGitCategoryHeader("CHANGES", unstagedItems.Count, "#FAB387"),
                IsExpanded = true
            };
            foreach (var item in unstagedItems)
            {
                unstagedTreeItem.Items.Add(CreateGitFileTreeItem(item));
            }

            GitChangesTree.Items.Add(stagedTreeItem);
            GitChangesTree.Items.Add(unstagedTreeItem);
        }

        private UIElement CreateGitCategoryHeader(string title, int count, string hexColor)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
            p.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.Bold, FontSize = 11, Foreground = (Brush)FindResource("TextBrush") });
            p.Children.Add(new TextBlock { Text = $" ({count})", FontSize = 11, FontWeight = FontWeights.Bold, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hexColor)), Margin = new Thickness(4, 0, 0, 0) });
            return p;
        }

        private TreeViewItem CreateGitFileTreeItem(GitItem item)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };
            
            var badge = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            badge.Child = new TextBlock
            {
                Text = item.StatusLetter,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = item.StatusBrush
            };

            var txt = new TextBlock
            {
                Text = item.FileName,
                FontSize = 12,
                Foreground = (Brush)FindResource("TextBrush"),
                ToolTip = item.RelativePath
            };

            p.Children.Add(badge);
            p.Children.Add(txt);

            var tvi = new TreeViewItem
            {
                Header = p,
                Tag = item
            };

            // Context menu for Git actions
            var cm = new ContextMenu();
            if (item.IsStaged)
            {
                var miUnstage = new MenuItem { Header = "Unstage Change (-)" };
                miUnstage.Click += (s, e) => RunGitCommand($"restore --staged \"{item.RelativePath}\"");
                cm.Items.Add(miUnstage);
            }
            else
            {
                var miStage = new MenuItem { Header = "Stage Change (+)" };
                miStage.Click += (s, e) => RunGitCommand($"add \"{item.RelativePath}\"");
                cm.Items.Add(miStage);

                var miDiscard = new MenuItem { Header = "Discard Changes (↩)" };
                miDiscard.Click += (s, e) => RunGitCommand($"checkout -- \"{item.RelativePath}\"");
                cm.Items.Add(miDiscard);
            }

            var miOpen = new MenuItem { Header = "Open File" };
            miOpen.Click += (s, e) => FileSelected?.Invoke(this, item.FilePath);
            cm.Items.Add(miOpen);

            tvi.ContextMenu = cm;
            return tvi;
        }

        private async void RunGitCommand(string args)
        {
            GitStatusSummaryText.Text = $"RUNNING: git {args}...";
            await System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "git",
                        Arguments = args,
                        WorkingDirectory = RootWorkspacePath,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    using var p = System.Diagnostics.Process.Start(psi);
                    p?.WaitForExit();
                }
                catch { }
            });

            RefreshGitStatus();
        }

        private void BtnGitRefresh_Click(object sender, RoutedEventArgs e) => RefreshGitStatus();
        private void BtnGitPush_Click(object sender, RoutedEventArgs e) => RunGitCommand("push");
        private void BtnGitPull_Click(object sender, RoutedEventArgs e) => RunGitCommand("pull");

        private void BtnGitSection_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string section)
            {
                if (section == "Changes")
                {
                    GitChangesTree.Visibility = Visibility.Visible;
                    GitHistoryTree.Visibility = Visibility.Collapsed;
                    BtnShowGitChanges.Style = (Style)FindResource("PrimaryButton");
                    BtnShowGitGraph.Style = (Style)FindResource("SecondaryButton");
                }
                else
                {
                    GitChangesTree.Visibility = Visibility.Collapsed;
                    GitHistoryTree.Visibility = Visibility.Visible;
                    BtnShowGitChanges.Style = (Style)FindResource("SecondaryButton");
                    BtnShowGitGraph.Style = (Style)FindResource("PrimaryButton");
                    PopulateGitHistoryGraph();
                }
            }
        }

        private async void PopulateGitHistoryGraph()
        {
            GitStatusSummaryText.Text = "LOADING GIT HISTORY GRAPH...";

            var historyItems = await System.Threading.Tasks.Task.Run(() =>
            {
                var list = new List<(string hash, string msg, string author, string date, string graphSymbol, string hexColor)>();
                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "git",
                        Arguments = "log -n 25 --oneline --graph --pretty=format:\"%h|%s|%an|%cr\"",
                        WorkingDirectory = RootWorkspacePath,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };

                    using var proc = System.Diagnostics.Process.Start(psi);
                    if (proc != null)
                    {
                        string output = proc.StandardOutput.ReadToEnd();
                        proc.WaitForExit();

                        string[] lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                        string[] colors = new[] { "#89B4FA", "#A6E3A1", "#FAB387", "#F5C2E7", "#94E2D5" };
                        int colorIdx = 0;

                        foreach (var line in lines)
                        {
                            int pipeIdx = line.IndexOf('|');
                            if (pipeIdx > 0)
                            {
                                string graphSymbol = line.Substring(0, pipeIdx).Trim();
                                string rest = line.Substring(pipeIdx + 1);
                                string[] parts = rest.Split('|');

                                string hash = parts.Length > 0 ? parts[0] : "";
                                string msg = parts.Length > 1 ? parts[1] : "";
                                string author = parts.Length > 2 ? parts[2] : "";
                                string date = parts.Length > 3 ? parts[3] : "";

                                string hexColor = colors[colorIdx % colors.Length];
                                if (graphSymbol.Contains("*") || graphSymbol.Contains("●")) colorIdx++;

                                list.Add((hash, msg, author, date, string.IsNullOrEmpty(graphSymbol) ? "●" : graphSymbol, hexColor));
                            }
                        }
                    }
                }
                catch { }

                return list;
            });

            GitHistoryTree.Items.Clear();
            GitStatusSummaryText.Text = $"GIT COMMIT HISTORY ({historyItems.Count} COMMITS)";

            foreach (var item in historyItems)
            {
                var panel = new DockPanel { HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, 2, 0, 2) };

                // Graph Line Symbol e.g. "│  *  "
                var graphTxt = new TextBlock
                {
                    Text = item.graphSymbol + " ",
                    FontFamily = new FontFamily("Consolas"),
                    FontSize = 11,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(item.hexColor)),
                    VerticalAlignment = VerticalAlignment.Center
                };

                // Hash Badge
                var hashBorder = new Border
                {
                    Background = (Brush)FindResource("Surface0Brush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center
                };
                hashBorder.Child = new TextBlock
                {
                    Text = item.hash,
                    FontFamily = new FontFamily("Consolas"),
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("PeachBrush")
                };

                // Commit Message
                var msgTxt = new TextBlock
                {
                    Text = item.msg,
                    FontSize = 11,
                    Foreground = (Brush)FindResource("TextBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = $"{item.msg}\nAuthor: {item.author} ({item.date})"
                };

                panel.Children.Add(graphTxt);
                panel.Children.Add(hashBorder);
                panel.Children.Add(msgTxt);

                var tvi = new TreeViewItem
                {
                    Header = panel
                };
                GitHistoryTree.Items.Add(tvi);
            }
        }

        private void BtnGitCommit_Click(object sender, RoutedEventArgs e)
        {
            string msg = GitCommitMsgBox.Text.Trim();
            if (string.IsNullOrEmpty(msg))
            {
                GitStatusSummaryText.Text = "Please enter a commit message";
                return;
            }

            RunGitCommand($"commit -m \"{msg.Replace("\"", "\\\"")}\"");
            GitCommitMsgBox.Text = string.Empty;
        }

        private void GitCommitMsgBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                BtnGitCommit_Click(sender, e);
            }
        }

        private void GitChangesTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is GitItem item)
            {
                FileSelected?.Invoke(this, item.FilePath);
            }
        }

        public void LoadWorkspaceExplorer(string rootPath)
        {
            ExplorerTree.Items.Clear();
            if (!Directory.Exists(rootPath)) return;

            var rootDir = new DirectoryInfo(rootPath);
            var rootNode = CreateDirectoryNode(rootDir);
            rootNode.IsExpanded = true;
            ExplorerTree.Items.Add(rootNode);
        }

        private TreeViewItem CreateDirectoryNode(DirectoryInfo dir)
        {
            var item = new TreeViewItem
            {
                Tag = dir.FullName,
                Header = CreateHeaderPanel("\uE838", dir.Name, FrozenBrush(0xFA, 0xB3, 0x87), isBold: true),
                ContextMenu = CreateExplorerContextMenu(dir.FullName, isDirectory: true)
            };

            item.Items.Add(new TreeViewItem { Header = "Loading..." });
            item.Expanded += DirectoryNode_Expanded;
            return item;
        }

        private void DirectoryNode_Expanded(object sender, RoutedEventArgs e)
        {
            if (sender is TreeViewItem dirNode && dirNode.Tag is string path)
            {
                if (dirNode.Items.Count == 1 && dirNode.Items[0] is TreeViewItem dummy && dummy.Header?.ToString() == "Loading...")
                {
                    dirNode.Items.Clear();
                    try
                    {
                        var dirInfo = new DirectoryInfo(path);

                        foreach (var subDir in dirInfo.GetDirectories())
                        {
                            // Skip hidden system/cache folders if wanted, but list repo folders
                            if (subDir.Name.Equals(".git", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("node_modules", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("bin", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("obj", StringComparison.OrdinalIgnoreCase))
                            {
                                continue;
                            }

                            dirNode.Items.Add(CreateDirectoryNode(subDir));
                        }

                        foreach (var file in dirInfo.GetFiles())
                        {
                            dirNode.Items.Add(CreateFileNode(file));
                        }
                    }
                    catch (Exception ex)
                    {
                        dirNode.Items.Add(new TreeViewItem { Header = $"Access Denied: {ex.Message}" });
                    }
                }
            }
        }

        private TreeViewItem CreateFileNode(FileInfo file)
        {
            var (icon, color) = GetFileIconAndColor(file.Extension);
            var item = new TreeViewItem
            {
                Tag = file.FullName,
                Header = CreateHeaderPanel(icon, file.Name, color, isBold: false),
                ContextMenu = CreateExplorerContextMenu(file.FullName, isDirectory: false)
            };
            return item;
        }

        private ContextMenu CreateExplorerContextMenu(string path, bool isDirectory)
        {
            var cm = new ContextMenu();

            if (!isDirectory)
            {
                var miOpen = new MenuItem { Header = "Open" };
                miOpen.Click += (s, e) => FileSelected?.Invoke(this, path);
                cm.Items.Add(miOpen);
            }

            var miCopyPath = new MenuItem { Header = "Copy Path" };
            miCopyPath.Click += (s, e) => Clipboard.SetText(path);
            cm.Items.Add(miCopyPath);

            var miReveal = new MenuItem { Header = "Reveal in File Explorer" };
            miReveal.Click += (s, e) =>
            {
                try
                {
                    System.Diagnostics.Process.Start("explorer.exe", isDirectory ? $"\"{path}\"" : $"/select,\"{path}\"");
                }
                catch { }
            };
            cm.Items.Add(miReveal);

            cm.Items.Add(new Separator());

            var miRefresh = new MenuItem { Header = "Refresh Explorer" };
            miRefresh.Click += (s, e) => LoadWorkspaceExplorer(RootWorkspacePath);
            cm.Items.Add(miRefresh);

            return cm;
        }

        private StackPanel CreateHeaderPanel(string iconText, string text, Brush foreground, bool isBold)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            var iconBlock = new TextBlock
            {
                Text = iconText,
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            if (iconText.Length == 1 && iconText[0] >= 0xE000)
            {
                iconBlock.FontFamily = new FontFamily("Segoe MDL2 Assets");
                iconBlock.Foreground = foreground;
            }

            var textBlock = new TextBlock
            {
                Text = text,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = isBold ? (Brush)FindResource("TextBrush") : foreground
            };
            if (isBold) textBlock.FontWeight = FontWeights.SemiBold;

            sp.Children.Add(iconBlock);
            sp.Children.Add(textBlock);
            return sp;
        }

        private (string icon, Brush color) GetFileIconAndColor(string ext)
        {
            switch (ext.ToLowerInvariant())
            {
                case ".cs":
                    return ("⚡", FrozenBrush(0x89, 0xB4, 0xFA)); // Blue
                case ".xaml":
                    return ("🎨", FrozenBrush(0xCB, 0xA6, 0xF7)); // Mauve
                case ".ts":
                case ".tsx":
                case ".js":
                case ".jsx":
                    return ("⚛", FrozenBrush(0x89, 0xDC, 0xEB)); // Cyan
                case ".json":
                case ".config":
                case ".yaml":
                case ".yml":
                    return ("⚙", FrozenBrush(0xA6, 0xE3, 0xA1)); // Green
                case ".csproj":
                case ".sln":
                    return ("📦", FrozenBrush(0xF3, 0x8B, 0xA8)); // Red
                case ".md":
                case ".txt":
                case ".log":
                    return ("📝", FrozenBrush(0x94, 0xE2, 0xD5)); // Teal
                case ".gitignore":
                    return ("🔀", FrozenBrush(0xFA, 0xB3, 0x87)); // Orange
                default:
                    return ("📄", FrozenBrush(0xCD, 0xD6, 0xF4)); // Text
            }
        }

        private static SolidColorBrush FrozenBrush(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        private void CollapseAll_Click(object sender, RoutedEventArgs e)
        {
            // Collapse all top-level nodes in the active tree
            var tree = _currentView == "Explorer" ? ExplorerTree : ChatsTree;
            foreach (var item in tree.Items)
            {
                if (tree.ItemContainerGenerator.ContainerFromItem(item) is TreeViewItem tvi)
                    tvi.IsExpanded = false;
            }
        }
    }
}
