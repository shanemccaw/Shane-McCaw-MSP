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
        /// <summary>Git #843 — the real GitHub title with no display suffix (e.g. the epic tree's " (N sub)"), for the Edit dialog to pre-fill correctly.</summary>
        public string RawTitle { get; set; } = string.Empty;
        public string Priority { get; set; } = "HIGH";
        public string Status { get; set; } = "OPEN";
        /// <summary>lib/db/migrations/manual/*.sql path referenced in the real GitHub issue body, if any — Shane To-Do items only. See CreateIssueHeader's "Load SQL" context menu item.</summary>
        public string? SqlPath { get; set; }
        /// <summary>Git #843 — the real GitHub issue body, carried through from <see cref="GitBoardIssue.Body"/> so the Edit dialog can pre-fill it without a second fetch.</summary>
        public string Body { get; set; } = string.Empty;
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
        /// <summary>Git #806 — raw JSON of the manifest's optional uiSteps[].captureResponse block, carried through untouched for the UI executor (#809) to parse. Null for manually-recorded steps.</summary>
        public string? CaptureResponse { get; set; }
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
        /// <summary>Git #840 (Git Board Phase 2) — fired when Shane clicks an issue node in the Git Board tree, so MainWindow can show its real description/comment thread.</summary>
        public event EventHandler<GitIssue>? IssueSelected;
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

            // Git #834 — pre-fill the Settings tab's PAT box from the local store
            // (%AppData%\BuildConsole\settings.json) so it round-trips visibly.
            var savedSettings = BuildConsole.Services.BuildConsoleSettings.Load();
            GitHubPatBox.Password = savedSettings.GitHubPat;
        }

        // ── SETTINGS: GitHub PAT (Git #834) ──────────────────────────────────
        private void BtnSaveGitHubPat_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            settings.GitHubPat = GitHubPatBox.Password.Trim();
            settings.Save();
            GitHubPatSavedText.Text = "Saved.";
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

        // ── Git #806: manifest loader (Epic #803 Phase 2) ───────────────────
        /// <summary>Fired after a manifest loads successfully — carries the parsed manifest so MainWindow can track it for Menu &gt; Run &gt; "Run Tests (Current Issue)".</summary>
        public event EventHandler<TestManifest>? ManifestLoaded;

        private void BtnLoadManifest_Click(object sender, RoutedEventArgs e)
        {
            string manifestsDir = Path.Combine(RootWorkspacePath, "test-manifests");
            var dlg = new Microsoft.Win32.OpenFileDialog
            {
                Title = "Load Test Manifest",
                Filter = "Test manifest (*.json)|*.json|All files (*.*)|*.*",
                InitialDirectory = Directory.Exists(manifestsDir) ? manifestsDir : RootWorkspacePath
            };
            if (dlg.ShowDialog() != true) return;

            var manifest = TestManifest.LoadFromFile(dlg.FileName);
            if (manifest == null)
            {
                MessageBox.Show($"Couldn't parse {dlg.FileName} as a test manifest.", "Load Manifest");
                return;
            }

            RecordedSteps.Clear();
            AutomationStepsList.Items.Clear();
            for (int i = 0; i < manifest.UiSteps.Count; i++)
            {
                var step = manifest.UiSteps[i];
                AddRecordedStep(step.Action, step.Selector ?? step.Target ?? string.Empty, "div", step.Value ?? step.State ?? string.Empty);
                RecordedSteps[^1].CaptureResponse = step.CaptureResponseJson;
            }

            ApiTestsBadge.Text = $"API: {manifest.ApiTests.Count}";
            GraphTestsBadge.Text = $"Graph: {manifest.GraphTests.Count}";
            ManifestBadgesRow.Visibility = Visibility.Visible;

            ManifestLoaded?.Invoke(this, manifest);
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

        // Git #839 (Git Board Phase 1) — _currentFilter tracks the active chip
        // so a 20s poll re-renders the same view; _boardShowsClosed marks when
        // the tree is holding the 🟢 Done (CLOSED) snapshot so leaving it for
        // any other chip reloads the default OPEN set. The board's own no-flash
        // content guard reuses the existing _lastInProgressSignature below.
        private string _currentFilter = "All";
        private bool _boardShowsClosed;

        // Git #821 — Shane: "can you stop all the flashing... every refresh
        // the left panel clears and rebuilds... so it flashes and sucks."
        // Both boards used to Items.Clear() + fully rebuild on EVERY 20s
        // poll regardless of whether anything actually changed - a
        // content-signature guard (cheap JSON serialize + string compare)
        // skips the rebuild entirely when the fetched data is identical to
        // what's already on screen, which is the overwhelming majority of
        // polls. Also preserves scroll position/expanded state on those
        // no-op polls, which a blind rebuild always threw away anyway.
        private string? _lastInProgressSignature;
        private string? _lastBoardSignature;

        public async void PopulateGitTrackerBoard()
        {
            // Git #839 — the 🟢 Done view is a manual CLOSED snapshot; let a
            // background poll leave it be rather than repaint OPEN over it.
            if (_boardShowsClosed && _currentFilter == "Done") return;

            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                IssuesTree.Items.Clear();
                IssueStatMilestones.Text = "0 Active";
                IssueStatEpics.Text = "0 Active";
                IssueStatOpen.Text = "0 Pending";
                IssueStatClosed.Text = "0 Done";
                IssuesTree.Items.Add(new TreeViewItem { Header = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings)." });
                return;
            }

            List<GitBoardIssue> issues;
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                // Default Git Board = real OPEN issues only. Closed drop out of
                // view entirely ("done done get out of my view") and are
                // reachable solely via the 🟢 Done chip (IssueFilter_Click).
                issues = await client.ListBoardIssuesAsync(GitHubIssueState.Open);
                SyncError?.Invoke(this, null);
            }
            catch (Exception ex)
            {
                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = $"Couldn't reach GitHub: {ex.Message}" });
                SyncError?.Invoke(this, $"Git Board: {ex.Message}");
                ActivityLog.Log("git-board.data", $"open-issue fetch FAILED: {ex.Message}");
                return;
            }

            ActivityLog.Log("git-board.data", $"loaded {issues.Count} open issue(s), {issues.Count(i => i.IsEpic)} epic(s)");

            _boardShowsClosed = false;
            var signature = System.Text.Json.JsonSerializer.Serialize(
                issues.Select(i => new { i.Number, i.Title, i.State, i.SubIssueCount, i.MilestoneTitle }));
            if (signature == _lastInProgressSignature) return;
            _lastInProgressSignature = signature;

            BuildBoardFromGitHub(issues);
            RenderIssuesTree(_currentFilter == "Done" ? "All" : _currentFilter);
        }

        /// <summary>
        /// Git #839 — turns the real GitHub issue list into the existing
        /// milestone → bucket → issue tree model. Grouped by the real GitHub
        /// Milestone (issues with none fall under "No Milestone"); within each,
        /// split into Epics (any issue with sub-issues), plain Issues, and
        /// Shane To-Do (the label). Status carried through is the real issue
        /// state, never a label.
        /// </summary>
        private void BuildBoardFromGitHub(List<GitBoardIssue> issues)
        {
            _milestones.Clear();

            static string? DeriveSqlPath(string body)
            {
                if (string.IsNullOrEmpty(body)) return null;
                var m = System.Text.RegularExpressions.Regex.Match(body, @"lib/db/migrations/manual/[^\s""'`)\]]+\.sql");
                return m.Success ? m.Value : null;
            }

            GitEpic MapBucket(string title, string colorHex, IEnumerable<GitBoardIssue> src)
            {
                var epic = new GitEpic { Title = title, ColorHex = colorHex };
                foreach (var it in src.OrderByDescending(i => i.Number))
                {
                    epic.Issues.Add(new GitIssue
                    {
                        IssueNumber = it.Number,
                        Title = it.IsEpic ? $"{it.Title}  ({it.SubIssueCount} sub)" : it.Title,
                        RawTitle = it.Title,
                        Priority = it.IsTodo ? "HIGH" : "MED",
                        Status = it.IsClosed ? "CLOSED" : "OPEN",
                        SqlPath = DeriveSqlPath(it.Body),
                        Body = it.Body,
                    });
                }
                return epic;
            }

            var groups = issues
                .GroupBy(i => i.MilestoneTitle)
                .OrderBy(g => g.Key == null ? 1 : 0)
                .ThenBy(g => g.Key);

            foreach (var g in groups)
            {
                var list = g.ToList();
                var milestone = new GitMilestone { Title = g.Key ?? "No Milestone" };
                var epicsBucket = MapBucket("⚡ Epics", "#89B4FA", list.Where(i => i.IsEpic && !i.IsTodo));
                var issuesBucket = MapBucket("⚡ Issues", "#A6E3A1", list.Where(i => !i.IsEpic && !i.IsTodo));
                var todoBucket = MapBucket("⚡ Shane To-Do", "#F5C2E7", list.Where(i => i.IsTodo));
                if (epicsBucket.Issues.Count > 0) milestone.Epics.Add(epicsBucket);
                if (issuesBucket.Issues.Count > 0) milestone.Epics.Add(issuesBucket);
                if (todoBucket.Issues.Count > 0) milestone.Epics.Add(todoBucket);
                milestone.TotalCount = list.Count;
                milestone.CompletedCount = list.Count(i => i.IsClosed);
                if (milestone.Epics.Count > 0) _milestones.Add(milestone);
            }
        }

        // ── CHATS (real GET /extension/board — grouped by linked epic) ──────
        public async void PopulateChatsTree()
        {
            if (_api == null || !_api.IsConfigured)
            {
                ChatsTree.Items.Clear();
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
                ChatsTree.Items.Clear();
                ChatsTree.Items.Add(new TreeViewItem { Header = $"Couldn't reach the API: {ex.Message}" });
                SyncError?.Invoke(this, $"Chats: {ex.Message}");
                return;
            }

            var signature = System.Text.Json.JsonSerializer.Serialize(board);
            if (signature == _lastBoardSignature) return;
            _lastBoardSignature = signature;
            ChatsTree.Items.Clear();

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
                var tvi = new TreeViewItem { Header = p, Tag = chat };

                // Git #828 - Shane: "I need a way to assign a chat to an
                // epic in the WPF app." Same POST /chats/ingest the
                // extensions own "link this chat to that epic" click
                // already uses (Git #781), just reached from here instead.
                var cm = new ContextMenu();
                var miAssign = new MenuItem { Header = "Assign to Epic..." };
                miAssign.Click += async (_, _) =>
                {
                    if (_api == null) return;
                    var dialog = new AssignEpicDialog(chat.Title, board.Epics);
                    if (dialog.ShowDialog() != true || dialog.SelectedEpicId == null) return;
                    try
                    {
                        var res = await _api.LinkChatToEpicAsync(chat.ConversationId, dialog.SelectedEpicId.Value);
                        if (!res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync();
                            MessageBox.Show($"Couldn't assign: {body}", "Assign to Epic");
                            return;
                        }
                        _lastBoardSignature = null;
                        PopulateChatsTree();
                    }
                    catch (System.Exception ex)
                    {
                        MessageBox.Show($"Couldn't assign: {ex.Message}", "Assign to Epic");
                    }
                };
                cm.Items.Add(miAssign);
                tvi.ContextMenu = cm;

                return tvi;
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

        /// <summary>Git #829 — MainWindow needs the real epic TITLE (not just its id) for the right panel's "Issues in this epic" header; reuses the same lookup PopulateChatsTree already built rather than a second fetch.</summary>
        public string? GetEpicTitle(int epicId) => _chatEpicById.TryGetValue(epicId, out var epic) ? epic.Title : null;

        private void ChatsTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is BoardChat chat && !string.IsNullOrEmpty(chat.ClaudeUrl))
            {
                int? githubNumber = chat.IssueGithubNumber
                    ?? (chat.EpicId.HasValue && _chatEpicById.TryGetValue(chat.EpicId.Value, out var epic) ? epic.GithubNumber : null);
                ChatSelected?.Invoke(this, (chat, githubNumber));
            }
        }

        /// <summary>Git #840 (Git Board Phase 2) — clicking an issue node shows its real description/comments in MainWindow's detail panel.</summary>
        private void IssuesTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is GitIssue issue)
            {
                IssueSelected?.Invoke(this, issue);
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
                            // Git #839 — default views show real OPEN issues only;
                            // CLOSED are reachable solely through the 🟢 Done chip,
                            // gated on the real issue state, never a "complete" label.
                            if (filter != "Done" && issue.Status == "CLOSED") continue;
                            if (filter == "Done" && issue.Status != "CLOSED") continue;
                            if (filter == "Priority" && issue.Priority != "HIGH") continue;

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

            // Git #841 (Git Board Phase 3) — real GitHub issue state, not the
            // `complete` label. Shane emphasized reopening specifically: this
            // is the way a closed issue that shouldn't have been comes back
            // into view (default board only shows real OPEN issues per #839).
            var miState = new MenuItem { Header = issue.Status == "CLOSED" ? "↩ Reopen Issue" : "✕ Close Issue" };
            miState.Click += async (s, e) =>
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat) return;
                bool closing = issue.Status != "CLOSED";
                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    await client.SetIssueStateAsync(issue.IssueNumber, closing);
                    ActivityLog.Log("git-board.state-change", $"#{issue.IssueNumber} -> {(closing ? "closed" : "reopened")}");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.state-change", $"#{issue.IssueNumber} state change FAILED: {ex.Message}");
                    MessageBox.Show($"Couldn't {(closing ? "close" : "reopen")} #{issue.IssueNumber}: {ex.Message}", "Git Board");
                    return;
                }
                _lastInProgressSignature = null;
                _boardShowsClosed = false;
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miState);

            // Git #843 (Git Board Phase 5) — dialog pre-filled with the real
            // current title/body (already carried on GitIssue.RawTitle/Body
            // from #839's ListBoardIssuesAsync, no second fetch needed). Save
            // does the real PATCH /issues/{n} via GitHubApiClient.
            var miEdit = new MenuItem { Header = "✎ Edit..." };
            miEdit.Click += async (s, e) =>
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat) return;

                var dialog = new EditIssueDialog(issue.IssueNumber, issue.RawTitle, issue.Body);
                if (dialog.ShowDialog() != true) return;

                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    await client.UpdateIssueAsync(issue.IssueNumber, dialog.ResultTitle, dialog.ResultBody);
                    ActivityLog.Log("git-board.edit", $"#{issue.IssueNumber} title/body updated");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.edit", $"#{issue.IssueNumber} update FAILED: {ex.Message}");
                    MessageBox.Show($"Couldn't save #{issue.IssueNumber}: {ex.Message}", "Edit Issue");
                    return;
                }
                _lastInProgressSignature = null;
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miEdit);

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

        // ── GIT BOARD: real GitHub issue search (Git #834) ──────────────────
        // Shane: "I should be able to put in the Git number or title and it
        // searches everything in Git... clearly finds even the closed ones."
        // Replaces the old QuickAddIssueBox_KeyDown fake-add behavior
        // entirely (local-only GitIssue with a placeholder number, never
        // touched GitHub, nothing persisted) — this calls GitHub's real
        // Search Issues API directly (Shane confirmed: direct call, not an
        // api-server proxy) so CLOSED issues show up too, not just whatever
        // GET /extension/in-progress currently has queued.
        private System.Threading.CancellationTokenSource? _issueSearchCts;

        private async void QuickAddIssueBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter) return;

            string query = QuickAddIssueBox.Text.Trim();
            if (string.IsNullOrEmpty(query)) return;

            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings)." });
                ActivityLog.Log("git-board.search", "blocked: no GitHub PAT configured");
                return;
            }

            _issueSearchCts?.Cancel();
            var cts = new System.Threading.CancellationTokenSource();
            _issueSearchCts = cts;

            IssuesTree.Items.Clear();
            IssuesTree.Items.Add(new TreeViewItem { Header = $"Searching GitHub for \"{query}\"…" });

            var client = new GitHubApiClient(settings.GitHubPat);
            try
            {
                var results = await client.SearchIssuesAsync(query);
                if (cts.IsCancellationRequested) return;

                ActivityLog.Log("git-board.search", $"query=\"{query}\" -> {results.Count} result(s)");

                IssuesTree.Items.Clear();
                if (results.Count == 0)
                {
                    IssuesTree.Items.Add(new TreeViewItem { Header = "No matching issues found." });
                    return;
                }

                foreach (var result in results)
                {
                    bool blocked = false;
                    if (!result.IsClosed)
                    {
                        try { blocked = await client.HasOpenBlockedByAsync(result.Number); }
                        catch { /* best-effort — worst case this one issue just doesn't show a Blocked badge */ }
                    }
                    if (cts.IsCancellationRequested) return;

                    IssuesTree.Items.Add(CreateSearchIssueHeader(result, blocked));
                }
            }
            catch (Exception ex)
            {
                if (cts.IsCancellationRequested) return;
                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = $"GitHub search failed: {ex.Message}" });
                ActivityLog.Log("git-board.search", $"FAILED query=\"{query}\": {ex.Message}");
            }
        }

        /// <summary>Shane: clearing the search box goes back to the normal live Git Board view, unchanged.</summary>
        private void QuickAddIssueBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(QuickAddIssueBox.Text))
            {
                _issueSearchCts?.Cancel();
                _currentFilter = "All";
                // Git #839 — if the board was showing the CLOSED Done snapshot,
                // reload the real OPEN set rather than filtering it to empty.
                if (_boardShowsClosed)
                {
                    _lastInProgressSignature = null;
                    PopulateGitTrackerBoard();
                }
                else
                {
                    RenderIssuesTree("All");
                }
            }
        }

        private TreeViewItem CreateSearchIssueHeader(GitHubIssueResult result, bool blocked)
        {
            string statusLabel;
            string statusHex;
            if (result.IsClosed) { statusLabel = "Closed"; statusHex = "#A6E3A1"; }
            else if (result.HasInFlightLabel) { statusLabel = "In Flight"; statusHex = "#FAB387"; }
            else if (blocked) { statusLabel = "Blocked"; statusHex = "#F38BA8"; }
            else { statusLabel = "Open"; statusHex = "#89B4FA"; }

            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };

            var numBlock = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            numBlock.Child = new TextBlock { Text = $"#{result.Number}", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") };

            var statusBadge = new Border
            {
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(statusHex)),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            statusBadge.Child = new TextBlock { Text = statusLabel, FontSize = 9, FontWeight = FontWeights.Bold, Foreground = Brushes.Black };

            var titleBlock = new TextBlock
            {
                Text = result.Title,
                FontSize = 11,
                Foreground = result.IsClosed ? GetBrush("Subtext0Brush") : GetBrush("TextBrush"),
                TextDecorations = result.IsClosed ? TextDecorations.Strikethrough : null
            };

            p.Children.Add(numBlock);
            p.Children.Add(statusBadge);
            p.Children.Add(titleBlock);

            var tvi = new TreeViewItem { Header = p, Tag = result };

            var cm = new ContextMenu();
            var miOpen = new MenuItem { Header = "Open on GitHub" };
            miOpen.Click += (s, e) =>
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(result.HtmlUrl) { UseShellExecute = true }); }
                catch { }
            };
            cm.Items.Add(miOpen);
            tvi.ContextMenu = cm;

            return tvi;
        }

        private async void IssueFilter_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string filter) return;
            _currentFilter = filter;

            if (filter == "Done")
            {
                // Git #839 — the 🟢 Done chip pulls the real CLOSED set on
                // demand, since closed issues are dropped from the default view.
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    IssuesTree.Items.Clear();
                    IssuesTree.Items.Add(new TreeViewItem { Header = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings)." });
                    return;
                }

                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = "Loading closed issues…" });
                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    var closed = await client.ListBoardIssuesAsync(GitHubIssueState.Closed);
                    ActivityLog.Log("git-board.data", $"loaded {closed.Count} closed issue(s) for the Done view");
                    BuildBoardFromGitHub(closed);
                    _boardShowsClosed = true;
                    _lastInProgressSignature = null; // force the next poll to repaint the OPEN board
                    RenderIssuesTree("Done");
                }
                catch (Exception ex)
                {
                    IssuesTree.Items.Clear();
                    IssuesTree.Items.Add(new TreeViewItem { Header = $"Couldn't load closed issues: {ex.Message}" });
                    ActivityLog.Log("git-board.data", $"closed-issue fetch FAILED: {ex.Message}");
                }
                return;
            }

            // Leaving the Done snapshot for any other chip: reload the real OPEN
            // board so we're not filtering an empty CLOSED-only set.
            if (_boardShowsClosed)
            {
                PopulateGitTrackerBoard();
                return;
            }

            RenderIssuesTree(filter);
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
