using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Documents;
using System.Threading.Tasks;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #921 (Epic #803) — the native, ADHD-friendly detail tab Shane asked
    /// for: "When I click a milestone, it should open a new Tab and show me all
    /// the Epics, Issues, and Shane To-Do in an ADHD friendly way to consume.
    /// When I click on an epic it should do the same thing... Clicking on an
    /// issue - same thing all issue details, but with Epic linked."
    ///
    /// One control, three render modes (<see cref="LoadMilestone"/> /
    /// <see cref="LoadEpic"/> / <see cref="LoadIssue"/>), all built in code the
    /// same way <see cref="IssueDetailView"/> (#840) builds its comment cards,
    /// and matching the #874 Build Queue panel's visual language: Catppuccin
    /// Mocha brushes, generous spacing, glanceable cards over dense text, and a
    /// PeachBrush-escalated "Shane To-Do" carve-out.
    ///
    /// Hosted as a real editor <c>TabItem</c> via MainWindow.OpenMilestoneDetailTab
    /// / OpenGitIssueDetailTab (reusing the #893/#894 multi-pane tab infra), so
    /// drag/dock/multi-pane all keep working — this control is just tab content.
    /// </summary>
    public class GitDetailView : UserControl
    {
        private const string Channel = "git-board.detail-tab";
        private readonly Grid _root;
        private readonly StackPanel _mainColumn;
        private readonly StackPanel _sideColumn;

        // Stored context so the Refresh button can re-run LoadIssue.
        private GitIssue? _loadedIssue;
        private int? _loadedLinkedEpicNumber;
        private string? _loadedLinkedEpicTitle;

        /// <summary>
        /// Raised when Shane clicks any issue/epic card inside a detail tab — a
        /// milestone's child list, an epic's assigned issues, or an issue's
        /// "Linked Epic" button. MainWindow resolves the number to the right
        /// kind of tab (epic vs issue) and opens/focuses it, so the whole board
        /// is navigable tab-to-tab. One number-based hook covers every case.
        /// </summary>
        public event EventHandler<int>? OpenIssueNumberRequested;

        /// <summary>
        /// Raised when the user clicks the quick link to open or create a Claude chat for this Epic.
        /// </summary>
        public event EventHandler<int>? OpenOrCreateEpicChatRequested;

        public GitDetailView()
        {
            _root = new Grid { Margin = new Thickness(18, 16, 18, 24) };
            _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0) });

            _mainColumn = new StackPanel { Margin = new Thickness(0) };
            Grid.SetColumn(_mainColumn, 0);

            _sideColumn = new StackPanel { Visibility = Visibility.Collapsed };
            Grid.SetColumn(_sideColumn, 1);

            _root.Children.Add(_mainColumn);
            _root.Children.Add(_sideColumn);
            Content = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Background = GetBrush("BaseBrush"),
                Content = _root,
            };
        }

        private void SetSideColumnVisibility(bool visible, double sideWidth = 280)
        {
            if (visible)
            {
                _root.ColumnDefinitions[1].Width = new GridLength(sideWidth);
                _mainColumn.Margin = new Thickness(0, 0, 16, 0);
                _sideColumn.Visibility = Visibility.Visible;
            }
            else
            {
                _root.ColumnDefinitions[1].Width = new GridLength(0);
                _mainColumn.Margin = new Thickness(0);
                _sideColumn.Visibility = Visibility.Collapsed;
            }
        }

        // ── Milestone tab ──────────────────────────────────────────────────
        public void LoadMilestone(GitMilestone m)
        {
            _mainColumn.Children.Clear();
            _sideColumn.Children.Clear();
            SetSideColumnVisibility(true, 300);
            AddHeaderRow("🎯", m.Title, m.GithubNumber);

            if (m.HasRealCounts)
            {
                var counts = new WrapPanel { Margin = new Thickness(0, 0, 0, 16) };
                counts.Children.Add(CountPill($"{m.OpenIssues} open", "GreenBrush"));
                counts.Children.Add(CountPill($"{m.ClosedIssues} done", "BlueBrush"));
                counts.Children.Add(CountPill($"{m.TotalCount} total", "Subtext0Brush"));
                counts.Children.Add(CountPill(m.ProgressStr, "PeachBrush"));
                _mainColumn.Children.Add(counts);
            }
            else
            {
                _mainColumn.Children.Add(Meta("Live open/closed counts aren't available for this bucket (no real GitHub milestone behind it)."));
            }

            // The board already splits every milestone's OPEN items into three
            // named buckets (#884/#875) — reuse that split verbatim rather than
            // re-deriving it, so the tab and the tree agree exactly.
            var epicsBucket = m.Epics.FirstOrDefault(b => b.Title.Contains("Epics"));
            var issuesBucket = m.Epics.FirstOrDefault(b => b.Title.Contains("Issues"));
            var todoBucket = m.Epics.FirstOrDefault(b => b.Title.Contains("To-Do"));

            RenderGitIssueSection(_sideColumn, "EPICS", epicsBucket?.Issues, escalate: false);
            RenderGitIssueSection(_sideColumn, "ISSUES", issuesBucket?.Issues, escalate: false);
            RenderGitIssueSection(_sideColumn, "SHANE TO-DO", todoBucket?.Issues, escalate: true);

            int total = (epicsBucket?.Issues.Count ?? 0) + (issuesBucket?.Issues.Count ?? 0) + (todoBucket?.Issues.Count ?? 0);
            if (total == 0)
                _sideColumn.Children.Add(Meta("Nothing open under this milestone right now."));

            ActivityLog.Log(Channel, $"milestone '{m.Title}' opened ({m.OpenIssues} open / {m.ClosedIssues} done, {total} open item(s))");
        }

        // ── Epic tab ───────────────────────────────────────────────────────
        public async void LoadEpic(GitIssue epic, ISet<int> todoNumbers, BoardChat? linkedChat = null)
        {
            _mainColumn.Children.Clear();
            _sideColumn.Children.Clear();
            SetSideColumnVisibility(true, 280);
            AddHeaderRow("⚡", DisplayTitle(epic), epic.IssueNumber);

            // Check if blocked
            bool isBlocked = epic.IsBlocked || epic.BlockedByNumber.HasValue;
            var actionsRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 14) };
            actionsRow.Children.Add(StatePill(epic.Status, isBlocked));

            int capturedEpicNumber = epic.IssueNumber;
            if (linkedChat != null && !string.IsNullOrEmpty(linkedChat.ClaudeUrl))
            {
                var chatBtn = new Button
                {
                    Content = $"💬 Open Assigned Chat ({(!string.IsNullOrEmpty(linkedChat.Title) ? linkedChat.Title : $"#{epic.IssueNumber}")})",
                    Style = (Style)FindResource("PrimaryButton"),
                    Height = 28,
                    Padding = new Thickness(12, 0, 12, 0),
                    Margin = new Thickness(8, 0, 0, 0),
                    FontSize = 11,
                    FontWeight = FontWeights.SemiBold,
                    Cursor = Cursors.Hand,
                    ToolTip = $"Jump to Claude chat linked to Epic #{epic.IssueNumber}"
                };
                chatBtn.Click += (s, e) => OpenOrCreateEpicChatRequested?.Invoke(this, capturedEpicNumber);
                actionsRow.Children.Add(chatBtn);
            }
            else
            {
                var newChatBtn = new Button
                {
                    Content = $"💬➕ Start Claude Chat (Epic #{epic.IssueNumber})",
                    Height = 28,
                    Padding = new Thickness(12, 0, 12, 0),
                    Margin = new Thickness(8, 0, 0, 0),
                    FontSize = 11,
                    FontWeight = FontWeights.SemiBold,
                    Cursor = Cursors.Hand,
                    Background = (Brush)FindResource("Surface0Brush"),
                    Foreground = (Brush)FindResource("BlueBrush"),
                    BorderBrush = (Brush)FindResource("BlueBrush"),
                    BorderThickness = new Thickness(1),
                    ToolTip = $"Create a new Claude chat prefilled with PAT and Epic #{epic.IssueNumber}"
                };
                newChatBtn.Click += (s, e) => OpenOrCreateEpicChatRequested?.Invoke(this, capturedEpicNumber);
                actionsRow.Children.Add(newChatBtn);
            }

            _mainColumn.Children.Add(actionsRow);

            UIElement? blockedBanner = null;
            if (isBlocked)
            {
                blockedBanner = CreateBlockedBanner(isEpic: true, epic.BlockedByNumber, epic.BlockedByTitle, isLabelBlockedOnly: epic.IsBlocked && !epic.BlockedByNumber.HasValue);
                _mainColumn.Children.Add(blockedBanner);
            }

            AddBody(epic.Body);

            var loading = Meta($"Loading assigned issues for #{epic.IssueNumber}…");
            _sideColumn.Children.Add(loading);

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                loading.Text = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).";
                ActivityLog.Log(Channel, $"epic #{epic.IssueNumber}: no GitHub PAT configured");
                return;
            }

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                // Background check for live blocked status if not already known
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var blocker = await client.GetOpenBlockedByAsync(epic.IssueNumber);
                        if (blocker != null)
                        {
                            Dispatcher.Invoke(() =>
                            {
                                if (capturedEpicNumber != epic.IssueNumber) return;
                                epic.IsBlocked = true;
                                epic.BlockedByNumber = blocker.Number;
                                epic.BlockedByTitle = blocker.Title;
                                if (blockedBanner == null)
                                {
                                    blockedBanner = CreateBlockedBanner(isEpic: true, blocker.Number, blocker.Title);
                                    int insertIdx = _mainColumn.Children.IndexOf(actionsRow) + 1;
                                    if (insertIdx > 0 && insertIdx <= _mainColumn.Children.Count)
                                        _mainColumn.Children.Insert(insertIdx, blockedBanner);
                                    else
                                        _mainColumn.Children.Add(blockedBanner);
                                }
                            });
                        }
                    }
                    catch { }
                });

                // Real sub-issue graph (#910) — the epic's actual children, not
                // the never-synced bt_issues.epic_id table.
                var subs = await client.GetSubIssuesAsync(epic.IssueNumber);
                _sideColumn.Children.Remove(loading);

                // sub_issues carries no labels, so the "Shane To-Do" carve-out
                // is cross-referenced against the board's known To-Do numbers
                // (which DO carry labels). Closed children not on the OPEN board
                // just fall into the main list — the best we can do without an
                // N+1 per-child fetch.
                
                var filterPanel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 16, 0, 8) };
                _sideColumn.Children.Add(filterPanel);
                
                var itemsContainer = new StackPanel();
                _sideColumn.Children.Add(itemsContainer);
                
                string currentFilter = "Open";
                Action renderSubs = null;
                renderSubs = () => 
                {
                    itemsContainer.Children.Clear();
                    filterPanel.Children.Clear();
                    
                    filterPanel.Children.Add(new TextBlock 
                    { 
                        Text = "ASSIGNED ISSUES", 
                        FontSize = 11, 
                        FontWeight = FontWeights.SemiBold, 
                        Foreground = GetBrush("Subtext1Brush"), 
                        VerticalAlignment = VerticalAlignment.Center,
                        Margin = new Thickness(0, 0, 12, 0)
                    });
                    
                    var filters = new[] { "Open", "Closed", "All" };
                    foreach(var f in filters) 
                    {
                        var isSelected = f == currentFilter;
                        var border = new Border 
                        {
                            Background = isSelected ? GetBrush("Surface2Brush") : GetBrush("Surface0Brush"),
                            CornerRadius = new CornerRadius(12),
                            Padding = new Thickness(10, 4, 10, 4),
                            Margin = new Thickness(0, 0, 6, 0),
                            Cursor = Cursors.Hand,
                            Child = new TextBlock 
                            { 
                                Text = f, 
                                FontSize = 11, 
                                Foreground = isSelected ? GetBrush("TextBrush") : GetBrush("Subtext0Brush") 
                            }
                        };
                        border.MouseLeftButtonUp += (s, e) => { currentFilter = f; renderSubs(); };
                        filterPanel.Children.Add(border);
                    }
                    
                    var filteredSubs = subs.Where(s => 
                    {
                        bool isOpen = !string.Equals(s.State, "closed", StringComparison.OrdinalIgnoreCase);
                        if (currentFilter == "Open") return isOpen;
                        if (currentFilter == "Closed") return !isOpen;
                        return true;
                    }).ToList();
                    
                    var todo = filteredSubs.Where(s => todoNumbers.Contains(s.Number)).ToList();
                    var rest = filteredSubs.Where(s => !todoNumbers.Contains(s.Number)).ToList();

                    RenderSubIssueSection(itemsContainer, $"OTHER ({rest.Count})", rest, escalate: false);
                    RenderSubIssueSection(itemsContainer, "SHANE TO-DO", todo, escalate: true);
                    
                    if (filteredSubs.Count == 0)
                        itemsContainer.Children.Add(Meta("No assigned issues match this filter."));
                };
                
                renderSubs();

                int initialTodoCount = subs.Count(s => todoNumbers.Contains(s.Number));
                ActivityLog.Log(Channel, $"epic #{epic.IssueNumber} opened ({subs.Count} assigned, {initialTodoCount} to-do)");
            }
            catch (Exception ex)
            {
                loading.Text = $"Couldn't load sub-issues for #{epic.IssueNumber}: {ex.Message}";
                ActivityLog.Log(Channel, $"epic #{epic.IssueNumber} load FAILED: {ex.Message}");
            }
        }

        // ── Issue tab ──────────────────────────────────────────────────────
        public async void LoadIssue(GitIssue issue, int? linkedEpicNumber, string? linkedEpicTitle)
        {
            // Resolve parent epic if not passed in
            if (!linkedEpicNumber.HasValue && Application.Current.MainWindow is MainWindow mwForEpic)
            {
                var boardIssue = mwForEpic.LeftSidebar?.CurrentBoardIssues.FirstOrDefault(i => i.Number == issue.IssueNumber);
                if (boardIssue?.ParentNumber != null)
                {
                    linkedEpicNumber = boardIssue.ParentNumber.Value;
                    var parentEpic = mwForEpic.LeftSidebar?.CurrentBoardIssues.FirstOrDefault(i => i.Number == linkedEpicNumber.Value);
                    linkedEpicTitle = parentEpic?.Title;
                }
            }

            if (!linkedEpicNumber.HasValue && !string.IsNullOrWhiteSpace(issue.Body))
            {
                var m = System.Text.RegularExpressions.Regex.Match(issue.Body, @"(?:[Ee]pic|[Pp]art of|[Pp]arent|[Ss]ub-issue of)\s+#(\d+)");
                if (m.Success && int.TryParse(m.Groups[1].Value, out var n))
                {
                    linkedEpicNumber = n;
                    if (Application.Current.MainWindow is MainWindow mwForEpic2)
                    {
                        var parentEpic = mwForEpic2.LeftSidebar?.CurrentBoardIssues.FirstOrDefault(i => i.Number == n);
                        linkedEpicTitle = parentEpic?.Title;
                    }
                }
            }

            // Store for refresh.
            _loadedIssue = issue;
            _loadedLinkedEpicNumber = linkedEpicNumber;
            _loadedLinkedEpicTitle = linkedEpicTitle;

            _mainColumn.Children.Clear();
            _sideColumn.Children.Clear();
            _sideColumn.Visibility = Visibility.Collapsed;

            // Header row with inline Refresh button
            AddHeaderRow("📄", DisplayTitle(issue), issue.IssueNumber);

            var refreshBtn = new Button
            {
                Content = "↻ Refresh",
                FontSize = 11,
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 0, 10),
                HorizontalAlignment = HorizontalAlignment.Left,
                ToolTip = "Re-fetch migration status, comments and body",
                Cursor = Cursors.Hand,
            };
            refreshBtn.Click += (s, e) =>
            {
                if (_loadedIssue != null)
                    LoadIssue(_loadedIssue, _loadedLinkedEpicNumber, _loadedLinkedEpicTitle);
            };
            _mainColumn.Children.Add(refreshBtn);

            // Check if blocked
            bool isBlocked = issue.IsBlocked || issue.BlockedByNumber.HasValue;
            var statePill = StatePill(issue.Status, isBlocked);
            _mainColumn.Children.Add(statePill);

            // Blocked Banner if blocked
            UIElement? blockedBanner = null;
            if (isBlocked)
            {
                blockedBanner = CreateBlockedBanner(isEpic: false, issue.BlockedByNumber, issue.BlockedByTitle, isLabelBlockedOnly: issue.IsBlocked && !issue.BlockedByNumber.HasValue);
                _mainColumn.Children.Add(blockedBanner);
            }

            // Linked epic shown in a subtle call out box above the description.
            if (linkedEpicNumber.HasValue)
                _mainColumn.Children.Add(LinkedEpicCard(linkedEpicNumber.Value, linkedEpicTitle));

            // 1. Immediately render in-memory body and initial actions column (0ms latency)
            AddBody(issue.Body, _cachedExecutedMigrations, _cachedLatestTestRuns);
            RenderActionsColumn(_sideColumn, issue.Body, null, _cachedExecutedMigrations, _cachedLatestTestRuns, _loadedLinkedEpicNumber, _loadedLinkedEpicTitle);

            var loading = Meta("Loading comments…");
            _mainColumn.Children.Add(loading);

            // 2. Offload migration status, test history, and comments to background task
            _ = Task.Run(async () =>
            {
                var executedMigrations = await GetOrFetchMigrationsAsync();
                var latestTestRuns = await GetOrFetchTestHistoryAsync();

                var settings = BuildConsoleSettings.Load();
                List<GitHubIssueComment> comments = new();
                GitHubIssueResult? blocker = null;
                string? errorMsg = null;

                if (!settings.HasGitHubPat)
                {
                    errorMsg = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).";
                }
                else
                {
                    try
                    {
                        var client = new GitHubApiClient(settings.GitHubPat);
                        var commentsTask = client.GetIssueCommentsAsync(issue.IssueNumber);
                        var blockerTask = client.GetOpenBlockedByAsync(issue.IssueNumber);
                        await Task.WhenAll(commentsTask, blockerTask);
                        comments = await commentsTask;
                        blocker = await blockerTask;
                    }
                    catch (Exception ex)
                    {
                        errorMsg = $"Couldn't load comments for #{issue.IssueNumber}: {ex.Message}";
                    }
                }

                Dispatcher.Invoke(() =>
                {
                    if (_loadedIssue?.IssueNumber != issue.IssueNumber) return;

                    // If blocker discovered on live fetch
                    if (blocker != null)
                    {
                        issue.IsBlocked = true;
                        issue.BlockedByNumber = blocker.Number;
                        issue.BlockedByTitle = blocker.Title;
                        if (blockedBanner == null)
                        {
                            blockedBanner = CreateBlockedBanner(isEpic: false, blocker.Number, blocker.Title);
                            int insertIdx = _mainColumn.Children.IndexOf(statePill) + 1;
                            if (insertIdx > 0 && insertIdx <= _mainColumn.Children.Count)
                                _mainColumn.Children.Insert(insertIdx, blockedBanner);
                            else
                                _mainColumn.Children.Add(blockedBanner);
                        }
                    }

                    _mainColumn.Children.Remove(loading);

                    if (errorMsg != null)
                    {
                        _mainColumn.Children.Add(Meta(errorMsg));
                        return;
                    }

                    _mainColumn.Children.Add(SectionHeader($"COMMENTS ({comments.Count})", escalate: false));
                    if (comments.Count == 0)
                        _mainColumn.Children.Add(Meta("No comments yet."));

                    foreach (var c in comments)
                        _mainColumn.Children.Add(CommentCard(c, executedMigrations, latestTestRuns));

                    // Re-populate side column with actions extracted from both body and comments
                    RenderActionsColumn(_sideColumn, issue.Body, comments.Select(c => c.Body ?? ""), executedMigrations, latestTestRuns, _loadedLinkedEpicNumber, _loadedLinkedEpicTitle);

                    ActivityLog.Log(Channel, $"issue #{issue.IssueNumber} opened ({comments.Count} comment(s))");
                });
            });
        }

        private static HashSet<string>? _cachedExecutedMigrations;
        private static DateTime _migrationsCacheTime = DateTime.MinValue;

        private static async Task<HashSet<string>> GetOrFetchMigrationsAsync()
        {
            if (_cachedExecutedMigrations != null && (DateTime.UtcNow - _migrationsCacheTime).TotalSeconds < 30)
                return _cachedExecutedMigrations;

            var migrations = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (Application.Current?.Dispatcher != null)
                {
                    BuildTrackerApiClient? api = null;
                    Application.Current.Dispatcher.Invoke(() =>
                    {
                        if (Application.Current.MainWindow is MainWindow mw && mw.BuildTrackerApi != null && mw.BuildTrackerApi.IsConfigured)
                            api = mw.BuildTrackerApi;
                    });

                    if (api != null)
                    {
                        using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(2));
                        var res = await api.ExecuteSqlAsync("SELECT filename FROM simulator_migration_runs");
                        var stmt = res.FirstOrDefault();
                        if (stmt != null && stmt.Rows != null)
                        {
                            foreach (var row in stmt.Rows)
                            {
                                if (row.TryGetValue("filename", out var val) && val.ValueKind != System.Text.Json.JsonValueKind.Null)
                                    migrations.Add(val.GetString() ?? "");
                            }
                        }
                    }
                }
            }
            catch { }

            _cachedExecutedMigrations = migrations;
            _migrationsCacheTime = DateTime.UtcNow;
            return migrations;
        }

        private static BuildConsole.Services.TestHistoryLookup? _cachedLatestTestRuns;
        private static DateTime _testHistoryCacheTime = DateTime.MinValue;

        private static Task<BuildConsole.Services.TestHistoryLookup> GetOrFetchTestHistoryAsync()
        {
            if (_cachedLatestTestRuns != null && (DateTime.UtcNow - _testHistoryCacheTime).TotalSeconds < 30)
                return Task.FromResult(_cachedLatestTestRuns);

            var dict = new BuildConsole.Services.TestHistoryLookup();
            try
            {
                string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                if (repoRoot != null)
                {
                    var history = BuildConsole.Services.TestHistoryStore.ReadAll(repoRoot);
                    dict = BuildConsole.Services.TestHistoryLookup.BuildLookup(history);
                }
            }
            catch { }

            _cachedLatestTestRuns = dict;
            _testHistoryCacheTime = DateTime.UtcNow;
            return Task.FromResult(dict);
        }

        // ── Section rendering ──────────────────────────────────────────────
        private void RenderGitIssueSection(Panel target, string header, List<GitIssue>? issues, bool escalate)
        {
            if (issues == null || issues.Count == 0) return;
            target.Children.Add(SectionHeader($"{header} ({issues.Count})", escalate));
            foreach (var gi in issues)
                target.Children.Add(GitIssueCard(gi, escalate));
        }

        private void RenderSubIssueSection(Panel target, string header, List<GitHubSubIssue> subs, bool escalate)
        {
            if (subs == null || subs.Count == 0) return;
            target.Children.Add(SectionHeader($"{header} ({subs.Count})", escalate));
            foreach (var s in subs)
                target.Children.Add(SubIssueCard(s, escalate));
        }

        // ── Card / element builders (match #874 + #840 recipes) ────────────
        private void AddHeaderRow(string glyph, string title, int? number)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 10) };
            row.Children.Add(new TextBlock
            {
                Text = glyph + " ",
                FontSize = 20,
                VerticalAlignment = VerticalAlignment.Center,
            });
            if (number.HasValue)
            {
                var badge = new Border
                {
                    Background = GetBrush("Surface0Brush"),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1, 6, 1),
                    Margin = new Thickness(0, 0, 8, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Child = new TextBlock { Text = $"#{number.Value}", FontSize = 12, FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") },
                };
                row.Children.Add(badge);
            }
            row.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
            });
            _mainColumn.Children.Add(row);
        }

        private Border CountPill(string text, string brushKey)
        {
            return new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(9, 3, 9, 3),
                Margin = new Thickness(0, 0, 6, 6),
                Child = new TextBlock { Text = text, FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = GetBrush(brushKey) },
            };
        }

        private UIElement StatePill(string status, bool isBlocked = false)
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 10), HorizontalAlignment = HorizontalAlignment.Left };

            bool closed = string.Equals(status, "CLOSED", StringComparison.OrdinalIgnoreCase);
            var border = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = closed ? GetBrush("RedBrush") : GetBrush("GreenBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(9, 3, 9, 3),
                Margin = new Thickness(0, 0, 8, 0),
                Child = new TextBlock
                {
                    Text = closed ? "CLOSED" : "OPEN",
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = closed ? GetBrush("RedBrush") : GetBrush("GreenBrush"),
                },
            };
            panel.Children.Add(border);

            if (isBlocked)
            {
                var blockedPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(40, 243, 139, 168)),
                    BorderBrush = GetBrush("RedBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(10),
                    Padding = new Thickness(9, 3, 9, 3),
                    Child = new TextBlock
                    {
                        Text = "🚫 BLOCKED",
                        FontSize = 10,
                        FontWeight = FontWeights.Bold,
                        Foreground = GetBrush("RedBrush"),
                    },
                };
                panel.Children.Add(blockedPill);
            }

            return panel;
        }

        private Border CreateBlockedBanner(bool isEpic, int? blockerNumber, string? blockerTitle, bool isLabelBlockedOnly = false)
        {
            var banner = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(28, 243, 139, 168)),
                BorderBrush = GetBrush("RedBrush"),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(14, 10, 14, 10),
                Margin = new Thickness(0, 0, 0, 16),
            };

            var mainGrid = new Grid();
            mainGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            mainGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            // 1. Whammy Block Critter Mascot on the left
            try
            {
                var whammyCritter = IssueChompAnimation.BuildWhammyElement(scale: 0.95);
                whammyCritter.Margin = new Thickness(0, 0, 14, 0);
                whammyCritter.VerticalAlignment = VerticalAlignment.Center;
                whammyCritter.ToolTip = "Whammy: BLOCKED!";
                whammyCritter.Cursor = Cursors.Hand;
                Grid.SetColumn(whammyCritter, 0);
                mainGrid.Children.Add(whammyCritter);
            }
            catch { }

            var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(stack, 1);

            // Header line
            var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            headerRow.Children.Add(new TextBlock
            {
                Text = "🚫 BLOCKED",
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("RedBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 8, 0),
            });

            headerRow.Children.Add(new TextBlock
            {
                Text = isEpic ? "This Epic is currently blocked and cannot proceed." : "This Issue is currently blocked and cannot proceed.",
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            });
            stack.Children.Add(headerRow);

            // Blocker details row
            if (blockerNumber.HasValue)
            {
                var detailsPanel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
                detailsPanel.Children.Add(new TextBlock
                {
                    Text = "Blocked by: ",
                    FontSize = 12,
                    Foreground = GetBrush("Subtext0Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 6, 0),
                });

                // Clickable blocker card
                var blockerCard = new Border
                {
                    Background = GetBrush("Surface0Brush"),
                    BorderBrush = GetBrush("RedBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(8, 4, 10, 4),
                    Cursor = Cursors.Hand,
                    ToolTip = $"Click to open Blocker Issue #{blockerNumber.Value} in a new tab",
                };

                var cardContent = new StackPanel { Orientation = Orientation.Horizontal };
                cardContent.Children.Add(new TextBlock
                {
                    Text = $"🔒 #{blockerNumber.Value}",
                    FontSize = 12,
                    FontWeight = FontWeights.Bold,
                    Foreground = GetBrush("RedBrush"),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                });

                if (!string.IsNullOrWhiteSpace(blockerTitle))
                {
                    cardContent.Children.Add(new TextBlock
                    {
                        Text = blockerTitle,
                        FontSize = 12,
                        FontWeight = FontWeights.Medium,
                        Foreground = GetBrush("TextBrush"),
                        VerticalAlignment = VerticalAlignment.Center,
                    });
                }

                blockerCard.Child = cardContent;
                blockerCard.MouseEnter += (s, e) => blockerCard.Background = GetBrush("Surface1Brush");
                blockerCard.MouseLeave += (s, e) => blockerCard.Background = GetBrush("Surface0Brush");
                blockerCard.MouseLeftButtonUp += (s, e) => OpenIssueNumberRequested?.Invoke(this, blockerNumber.Value);

                detailsPanel.Children.Add(blockerCard);
                stack.Children.Add(detailsPanel);
            }
            else
            {
                var labelNotice = new TextBlock
                {
                    Text = "Marked with the 'blocked' label. Resolve prerequisite dependencies before continuing.",
                    FontSize = 12,
                    Foreground = GetBrush("Subtext0Brush"),
                    Margin = new Thickness(0, 2, 0, 0),
                };
                stack.Children.Add(labelNotice);
            }

            mainGrid.Children.Add(stack);
            banner.Child = mainGrid;
            return banner;
        }

        private UIElement RenderMarkdownBody(string? markdown, double baseFontSize = 13, System.Collections.Generic.HashSet<string>? executedMigrations = null, BuildConsole.Services.TestHistoryLookup? latestTestRuns = null)
        {
            if (string.IsNullOrWhiteSpace(markdown)) return new StackPanel();

            var options = new MarkdownRenderer.RenderOptions
            {
                GetBrush = key => GetBrush(key),
                BaseFontSize = baseFontSize,
                OnIssueClick = issueNum => OpenIssueNumberRequested?.Invoke(this, issueNum),
                OnUrlClick = url =>
                {
                    try
                    {
                        var psi = new System.Diagnostics.ProcessStartInfo
                        {
                            FileName = url,
                            UseShellExecute = true
                        };
                        System.Diagnostics.Process.Start(psi);
                    }
                    catch { }
                },
                OnFileClick = async fileName =>
                {
                    var repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                    string fullPath = fileName;
                    if (!System.IO.Path.IsPathRooted(fileName) && repoRoot != null)
                    {
                        fullPath = await System.Threading.Tasks.Task.Run(() => FastResolveFileInRepo(repoRoot, fileName) ?? fileName);
                    }

                    if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mWindow)
                    {
                        mWindow.OpenFileTab(fullPath);
                    }
                }
            };

            return MarkdownRenderer.Render(markdown, options);
        }

        private void AddBody(string? markdown, System.Collections.Generic.HashSet<string>? executedMigrations = null, BuildConsole.Services.TestHistoryLookup? latestTestRuns = null)
        {
            if (string.IsNullOrWhiteSpace(markdown)) return;

            var border = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(16),
                Margin = new Thickness(0, 0, 0, 24),
            };

            border.Child = RenderMarkdownBody(markdown, 13, executedMigrations, latestTestRuns);

            _mainColumn.Children.Add(border);
        }

        private TextBlock SectionHeader(string text, bool escalate)
        {
            return new TextBlock
            {
                Text = text.ToUpperInvariant(),
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = escalate ? GetBrush("PeachBrush") : GetBrush("Subtext1Brush"),
                Margin = new Thickness(0, 16, 0, 8),
            };
        }

        private TextBlock Meta(string text)
        {
            return new TextBlock
            {
                Text = text,
                FontSize = 11,
                Foreground = GetBrush("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 4),
            };
        }

        private Border GitIssueCard(GitIssue gi, bool escalate)
        {
            // The tree's GitIssue doesn't carry a sub-count (that lives on the
            // board's GitBoardIssue), so an epic card just reads "⚡ epic" — its
            // real sub-issue list is one click away in the epic's own tab.
            var meta = gi.IsEpic ? "⚡ epic" : "issue";
            string status = gi.Status;
            if (status != "CLOSED" && gi.IsBlocked) status = "BLOCKED";
            return NavCard(gi.IssueNumber, DisplayTitle(gi), meta, status, escalate);
        }

        private Border SubIssueCard(GitHubSubIssue s, bool escalate)
        {
            // sub_issues state is REST-cased ("open"/"closed") — normalise so
            // the strikethrough/colour logic (which expects "CLOSED") matches.
            string status = string.Equals(s.State, "closed", StringComparison.OrdinalIgnoreCase) ? "CLOSED" : "OPEN";
            return NavCard(s.Number, s.Title, "issue", status, escalate);
        }

        /// <summary>A glanceable, clickable card that opens the referenced
        /// item's own detail tab. The whole card is the hit target (ADHD-friendly
        /// — no tiny link to aim at).</summary>
        private Border NavCard(int number, string title, string meta, string status, bool escalate)
        {
            bool closed = string.Equals(status, "CLOSED", StringComparison.OrdinalIgnoreCase);
            bool blocked = string.Equals(status, "BLOCKED", StringComparison.OrdinalIgnoreCase);
            
            SolidColorBrush normalBorder;
            if (blocked) normalBorder = (SolidColorBrush)GetBrush("RedBrush");
            else if (closed) normalBorder = (SolidColorBrush)GetBrush("GreenBrush");
            else normalBorder = (SolidColorBrush)GetBrush("PeachBrush");

            var card = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = normalBorder,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10),
                Margin = new Thickness(0, 0, 0, 8),
                Cursor = Cursors.Hand,
                ToolTip = $"Open #{number} in its own tab",
            };

            var rowPanel = new StackPanel { Orientation = Orientation.Horizontal };
            rowPanel.Children.Add(new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = $"#{number}", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") },
            });

            var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            textStack.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 12,
                Foreground = closed ? GetBrush("Subtext0Brush") : GetBrush("TextBrush"),
                TextDecorations = closed ? TextDecorations.Strikethrough : null,
                TextWrapping = TextWrapping.Wrap,
            });
            textStack.Children.Add(new TextBlock
            {
                Text = closed ? $"{meta} · closed" : meta,
                FontSize = 10,
                Foreground = escalate ? GetBrush("PeachBrush") : GetBrush("Subtext1Brush"),
            });
            rowPanel.Children.Add(textStack);

            card.Child = rowPanel;

            card.MouseEnter += (s, e) => card.BorderBrush = GetBrush("BlueBrush");
            card.MouseLeave += (s, e) => card.BorderBrush = normalBorder;
            card.MouseLeftButtonUp += (s, e) => OpenIssueNumberRequested?.Invoke(this, number);

            return card;
        }

        private Border LinkedEpicCard(int number, string? title)
        {
            var card = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10, 6, 10, 6),
                Margin = new Thickness(0, 0, 0, 12),
                Cursor = Cursors.Hand,
                ToolTip = $"Open Epic #{number} in its own tab",
                HorizontalAlignment = HorizontalAlignment.Left
            };

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock
            {
                Text = "Parent epic: ",
                FontSize = 12,
                Foreground = GetBrush("Subtext0Brush"),
                VerticalAlignment = VerticalAlignment.Center
            });

            panel.Children.Add(new TextBlock
            {
                Text = $"#{number}",
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("MauveBrush"),
                VerticalAlignment = VerticalAlignment.Center
            });

            if (!string.IsNullOrEmpty(title))
            {
                panel.Children.Add(new TextBlock
                {
                    Text = $" — {title}",
                    FontSize = 12,
                    Foreground = GetBrush("Subtext0Brush"),
                    VerticalAlignment = VerticalAlignment.Center
                });
            }

            card.Child = panel;

            card.MouseEnter += (s, e) => card.Background = GetBrush("Surface1Brush");
            card.MouseLeave += (s, e) => card.Background = GetBrush("Surface0Brush");
            card.MouseLeftButtonUp += (s, e) => OpenIssueNumberRequested?.Invoke(this, number);

            return card;
        }


        private Border CommentCard(GitHubIssueComment comment, System.Collections.Generic.HashSet<string>? executedMigrations = null, BuildConsole.Services.TestHistoryLookup? latestTestRuns = null)
        {
            var border = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8),
                Margin = new Thickness(0, 0, 0, 8),
            };

            var panel = new StackPanel();
            var headerPanel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            headerPanel.Children.Add(new TextBlock
            {
                Text = comment.User?.Login ?? "(unknown)",
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("BlueBrush"),
            });
            headerPanel.Children.Add(new TextBlock
            {
                Text = "  " + comment.CreatedAt.LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                FontSize = 10,
                Foreground = GetBrush("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center,
            });

            panel.Children.Add(headerPanel);
            panel.Children.Add(RenderMarkdownBody(comment.Body ?? "", 12, executedMigrations, latestTestRuns));
            border.Child = panel;
            return border;
        }

        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _resolvedPathCache = new(StringComparer.OrdinalIgnoreCase);

        private static string? FastResolveFileInRepo(string repoRoot, string fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName)) return null;
            if (System.IO.Path.IsPathRooted(fileName) && System.IO.File.Exists(fileName))
                return fileName;

            if (_resolvedPathCache.TryGetValue(fileName, out var cached) && System.IO.File.Exists(cached))
                return cached;

            // 1. Direct path check relative to repoRoot
            string direct = System.IO.Path.Combine(repoRoot, fileName);
            if (System.IO.File.Exists(direct))
            {
                _resolvedPathCache[fileName] = direct;
                return direct;
            }

            // 2. Check common subdirectories directly without recursive scanning
            string justName = System.IO.Path.GetFileName(fileName);
            var commonDirs = new[]
            {
                "client/src", "client/src/components", "client/src/pages", "client/src/lib", "client",
                "server", "server/routes", "server/services",
                "desktop/BuildConsole/Controls", "desktop/BuildConsole/Services", "desktop/BuildConsole", "desktop",
                "src", "src/components", "src/pages", "src/services",
                "migrations", "test-manifests", "scripts", "docs"
            };

            foreach (var rel in commonDirs)
            {
                string candidate = System.IO.Path.Combine(repoRoot, rel, fileName);
                if (System.IO.File.Exists(candidate))
                {
                    _resolvedPathCache[fileName] = candidate;
                    return candidate;
                }
                string candidateByName = System.IO.Path.Combine(repoRoot, rel, justName);
                if (System.IO.File.Exists(candidateByName))
                {
                    _resolvedPathCache[fileName] = candidateByName;
                    return candidateByName;
                }
            }

            // 3. Fast shallow/pruned breadth-first search (skips node_modules, .git, bin, obj, etc.)
            try
            {
                var ignoredDirs = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase)
                {
                    ".git", "node_modules", "bin", "obj", ".vs", ".gemini", "dist", "build", ".next", ".cache", "tmp", "temp"
                };

                var queue = new System.Collections.Generic.Queue<string>();
                queue.Enqueue(repoRoot);

                while (queue.Count > 0)
                {
                    string currentDir = queue.Dequeue();
                    try
                    {
                        foreach (var file in System.IO.Directory.EnumerateFiles(currentDir, justName))
                        {
                            if (System.IO.File.Exists(file))
                            {
                                _resolvedPathCache[fileName] = file;
                                return file;
                            }
                        }

                        foreach (var subDir in System.IO.Directory.EnumerateDirectories(currentDir))
                        {
                            string dirName = System.IO.Path.GetFileName(subDir);
                            if (!ignoredDirs.Contains(dirName) && !dirName.StartsWith("."))
                            {
                                queue.Enqueue(subDir);
                            }
                        }
                    }
                    catch { }
                }
            }
            catch { }

            _resolvedPathCache[fileName] = direct;
            return direct;
        }

        private TextBlock CreateLinkedTextBlock(string? text, double fontSize, string foregroundKey, System.Collections.Generic.HashSet<string>? executedMigrations = null, BuildConsole.Services.TestHistoryLookup? latestTestRuns = null)
        {
            var tb = new TextBlock
            {
                FontSize = fontSize,
                Foreground = GetBrush(foregroundKey),
                TextWrapping = TextWrapping.Wrap
            };

            if (string.IsNullOrEmpty(text)) return tb;

            var matches = System.Text.RegularExpressions.Regex.Matches(text, @"(?:\w[\w\-\./\\]*)\.(?:sql|cs|ts|tsx|json|xaml|ps1|cmd|md)\b");
            int lastIndex = 0;

            foreach (System.Text.RegularExpressions.Match match in matches)
            {
                if (match.Index > lastIndex)
                {
                    tb.Inlines.Add(new Run(text.Substring(lastIndex, match.Index - lastIndex)));
                }

                var hyperlink = new Hyperlink(new Run(match.Value))
                {
                    Foreground = GetBrush("BlueBrush"),
                    Cursor = Cursors.Hand,
                    ToolTip = $"Click to open {match.Value} in editor"
                };

                string fileName = match.Value;
                Func<System.Threading.Tasks.Task<string>> resolvePathAsync = async () =>
                {
                    if (System.IO.Path.IsPathRooted(fileName) && System.IO.File.Exists(fileName))
                        return fileName;

                    var repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                    if (repoRoot == null) return fileName;

                    return await System.Threading.Tasks.Task.Run(() => FastResolveFileInRepo(repoRoot, fileName) ?? fileName);
                };

                hyperlink.Click += async (s, e) =>
                {
                    string fullPath = await resolvePathAsync();
                    if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mWindow)
                    {
                        mWindow.OpenFileTab(fullPath);
                    }
                };

                if (fileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase) && (fileName.Contains("test-manifests/") || fileName.Contains("test-manifests\\")))
                {
                    var ctx = new ContextMenu();
                    var viewItem = new MenuItem { Header = "View Test Manifest" };
                    viewItem.Click += async (s, e) => {
                        string fullPath = await resolvePathAsync();
                        if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mWindow) mWindow.OpenFileTab(fullPath);
                    };
                    var runItem = new MenuItem { Header = "Run Test" };
                    runItem.Click += async (s, e) => {
                        string fullPath = await resolvePathAsync();
                        if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mWindow) 
                        {
                            var manifest = BuildConsole.Services.TestManifest.LoadFromFile(fullPath);
                            if (manifest != null) await mWindow.RunManifestPublicAsync(manifest);
                        }
                    };
                    var historyItem = new MenuItem { Header = "History" };
                    historyItem.Click += async (s, e) =>
                    {
                        string fullPath = await resolvePathAsync();
                        if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mWindow)
                        {
                            var manifest = BuildConsole.Services.TestManifest.LoadFromFile(fullPath);
                            if (manifest != null) mWindow.EnsureTestHistoryWindowPublic(manifest.Issue);
                        }
                    };
                    ctx.Items.Add(viewItem);
                    ctx.Items.Add(runItem);
                    ctx.Items.Add(new Separator());
                    ctx.Items.Add(historyItem);
                    hyperlink.ContextMenu = ctx;
                }

                tb.Inlines.Add(hyperlink);

                // Migration run indicator for .sql files
                if (fileName.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
                {
                    string basename = System.IO.Path.GetFileNameWithoutExtension(fileName);
                    string justFilename = System.IO.Path.GetFileName(fileName);
                    bool isRan = executedMigrations != null &&
                                 (executedMigrations.Contains(basename) ||
                                  executedMigrations.Contains(justFilename) ||
                                  executedMigrations.Contains(fileName) ||
                                  executedMigrations.Any(n => System.IO.Path.GetFileNameWithoutExtension(n).Equals(basename, StringComparison.OrdinalIgnoreCase)));
                    if (isRan)
                    {
                        tb.Inlines.Add(new Run(" ✅"));
                    }
                    else
                    {
                        var warnRun = new Run(" ⚠️ [NEEDS EXECUTION]")
                        {
                            Foreground = GetBrush("RedBrush"),
                            FontWeight = FontWeights.Bold
                        };
                        tb.Inlines.Add(warnRun);
                    }
                }

                // Run indicator for test-manifest .json files
                if (fileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase) && (fileName.Contains("test-manifests/") || fileName.Contains("test-manifests\\")))
                {
                    int? manifestIssue = null;
                    string? manifestFeature = null;
                    string? rRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                    if (rRoot != null)
                    {
                        string fullPath = System.IO.Path.Combine(rRoot, fileName.Replace("/", "\\"));
                        if (!System.IO.File.Exists(fullPath))
                        {
                            string target = System.IO.Path.GetFileName(fileName);
                            string mDir = System.IO.Path.Combine(rRoot, "test-manifests");
                            if (System.IO.Directory.Exists(mDir))
                            {
                                var matchFile = System.IO.Directory.GetFiles(mDir, target, System.IO.SearchOption.AllDirectories).FirstOrDefault();
                                if (matchFile != null) fullPath = matchFile;
                            }
                        }

                        if (System.IO.File.Exists(fullPath))
                        {
                            try
                            {
                                var m = BuildConsole.Services.TestManifest.LoadFromFile(fullPath);
                                if (m != null && m.Issue > 0) manifestIssue = m.Issue;
                                if (m != null && !string.IsNullOrEmpty(m.Feature)) manifestFeature = m.Feature;
                            }
                            catch { }
                        }
                    }

                    if (latestTestRuns != null && latestTestRuns.TryGetForManifest(manifestIssue, manifestFeature, out var lastRun) && lastRun != null)
                    {
                        if (lastRun.AllPassed)
                        {
                            var passRun = new Run($" ✅ [PASSED ({lastRun.Passed}/{lastRun.Total})]")
                            {
                                Foreground = GetBrush("GreenBrush"),
                                FontWeight = FontWeights.Bold,
                                ToolTip = $"Last run: {lastRun.StartedAt:yyyy-MM-dd HH:mm:ss} ({lastRun.Passed}/{lastRun.Total} passed)"
                            };
                            tb.Inlines.Add(passRun);
                        }
                        else
                        {
                            var failRun = new Run($" ❌ [FAILED ({lastRun.Passed}/{lastRun.Total})]")
                            {
                                Foreground = GetBrush("RedBrush"),
                                FontWeight = FontWeights.Bold,
                                ToolTip = $"Last run: {lastRun.StartedAt:yyyy-MM-dd HH:mm:ss} ({lastRun.Failed} failed)"
                            };
                            tb.Inlines.Add(failRun);
                        }
                    }
                    else
                    {
                        var neverRan = new Run(" ⚠️ [NEVER RAN]")
                        {
                            Foreground = GetBrush("PeachBrush"),
                            FontWeight = FontWeights.Bold,
                            ToolTip = "No recorded runs in test-results/_history.jsonl"
                        };
                        tb.Inlines.Add(neverRan);
                    }
                }

                lastIndex = match.Index + match.Length;
            }

            if (lastIndex < text.Length)
            {
                tb.Inlines.Add(new Run(text.Substring(lastIndex)));
            }

            return tb;
        }

        private void RenderActionsColumn(
            Panel target, 
            string? body, 
            IEnumerable<string>? commentBodies, 
            System.Collections.Generic.HashSet<string>? executedMigrations, 
            BuildConsole.Services.TestHistoryLookup? latestTestRuns,
            int? linkedEpicNumber = null,
            string? linkedEpicTitle = null)
        {
            target.Children.Clear();

            var allText = (body ?? "") + "\n" + string.Join("\n", commentBodies ?? Enumerable.Empty<string>());
            if (string.IsNullOrWhiteSpace(allText))
            {
                SetSideColumnVisibility(false);
                return;
            }

            var matches = System.Text.RegularExpressions.Regex.Matches(allText, @"(?:\w[\w\-\./\\]*)\.(?:sql|json)\b");
            var sqlFiles = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var testManifests = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (System.Text.RegularExpressions.Match m in matches)
            {
                string val = m.Value;
                if (val.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
                {
                    sqlFiles.Add(val);
                }
                else if (val.EndsWith(".json", StringComparison.OrdinalIgnoreCase) && 
                         (val.Contains("test-manifests/") || val.Contains("test-manifests\\")))
                {
                    testManifests.Add(val);
                }
            }

            string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();

            // 1. Render Test Manifests section if present
            if (testManifests.Count > 0)
            {
                target.Children.Add(SectionHeader($"🧪 TEST MANIFESTS ({testManifests.Count})", escalate: false));

                foreach (var manifestPath in testManifests)
                {
                    target.Children.Add(CreateTestManifestActionCard(manifestPath, repoRoot, latestTestRuns));
                }
            }

            // 2. Render SQL Migrations section if present
            if (sqlFiles.Count > 0)
            {
                target.Children.Add(SectionHeader($"🗄️ SQL MIGRATIONS ({sqlFiles.Count})", escalate: false));

                foreach (var sqlPath in sqlFiles)
                {
                    target.Children.Add(CreateSqlActionCard(sqlPath, repoRoot, executedMigrations));
                }
            }

            // If no action cards, collapse side column completely so issue details get full width
            if (testManifests.Count == 0 && sqlFiles.Count == 0)
            {
                SetSideColumnVisibility(false);
            }
            else
            {
                SetSideColumnVisibility(true, 240);
            }
        }

        private UIElement CreateParentItemActionCard(int number, string? title)
        {
            var card = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10),
                Margin = new Thickness(0, 0, 0, 10),
                Cursor = Cursors.Hand,
                ToolTip = $"Click to open Parent Epic #{number} in its own tab"
            };

            var stack = new StackPanel();

            var headerRow = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            var badge = new Border
            {
                Background = GetBrush("MauveBrush", 0x25),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 2, 6, 2),
                HorizontalAlignment = HorizontalAlignment.Left,
                Child = new TextBlock
                {
                    Text = "⚡ PARENT EPIC",
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = GetBrush("MauveBrush")
                }
            };
            headerRow.Children.Add(badge);
            stack.Children.Add(headerRow);

            var titlePanel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            titlePanel.Children.Add(new TextBlock
            {
                Text = $"#{number}",
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("MauveBrush"),
                Margin = new Thickness(0, 0, 6, 0)
            });

            if (!string.IsNullOrWhiteSpace(title))
            {
                titlePanel.Children.Add(new TextBlock
                {
                    Text = title,
                    FontSize = 12,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = GetBrush("TextBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    MaxWidth = 220
                });
            }
            stack.Children.Add(titlePanel);

            var subtext = new TextBlock
            {
                Text = "Click to open parent epic details & sub-issues",
                FontSize = 10,
                Foreground = GetBrush("Subtext0Brush"),
                Margin = new Thickness(0, 2, 0, 0)
            };
            stack.Children.Add(subtext);

            card.Child = stack;

            card.MouseEnter += (s, e) => { card.BorderBrush = GetBrush("MauveBrush"); card.Background = GetBrush("Surface0Brush"); };
            card.MouseLeave += (s, e) => { card.BorderBrush = GetBrush("Surface0Brush"); card.Background = GetBrush("MantleBrush"); };
            card.MouseLeftButtonUp += (s, e) => OpenIssueNumberRequested?.Invoke(this, number);

            return card;
        }

        private UIElement CreateTestManifestActionCard(string manifestPath, string? repoRoot, BuildConsole.Services.TestHistoryLookup? latestTestRuns)
        {
            var card = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10),
                Margin = new Thickness(0, 0, 0, 8),
            };

            var stack = new StackPanel();

            // Header row: status badge
            var headerRow = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };

            int? manifestIssue = null;
            string? manifestFeature = null;
            string fullPath = manifestPath;
            if (repoRoot != null)
            {
                string candidate = System.IO.Path.Combine(repoRoot, manifestPath.Replace("/", "\\"));
                if (System.IO.File.Exists(candidate))
                {
                    fullPath = candidate;
                }
                else
                {
                    string targetName = System.IO.Path.GetFileName(manifestPath);
                    string mDir = System.IO.Path.Combine(repoRoot, "test-manifests");
                    if (System.IO.Directory.Exists(mDir))
                    {
                        var matchFile = System.IO.Directory.GetFiles(mDir, targetName, System.IO.SearchOption.AllDirectories).FirstOrDefault();
                        if (matchFile != null) fullPath = matchFile;
                    }
                }

                if (System.IO.File.Exists(fullPath))
                {
                    try
                    {
                        var m = BuildConsole.Services.TestManifest.LoadFromFile(fullPath);
                        if (m != null && m.Issue > 0) manifestIssue = m.Issue;
                        if (m != null && !string.IsNullOrEmpty(m.Feature)) manifestFeature = m.Feature;
                    }
                    catch { }
                }
            }

            Border badge;
            if (latestTestRuns != null && latestTestRuns.TryGetForManifest(manifestIssue, manifestFeature, out var lastRun) && lastRun != null)
            {
                latestTestRuns.TryGetReliability(manifestIssue, manifestFeature, out var rel);
                if (rel != null && rel.IsFlaky)
                {
                    badge = new Border
                    {
                        Background = GetBrush("PeachBrush", 0x25),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(6, 2, 6, 2),
                        HorizontalAlignment = HorizontalAlignment.Left,
                        ToolTip = rel.DetailReason,
                        Child = new TextBlock
                        {
                            Text = $"⚠️ FLAKY ({lastRun.Passed}/{lastRun.Total} · {rel.FlipsCount} flips)",
                            FontSize = 10,
                            FontWeight = FontWeights.Bold,
                            Foreground = GetBrush("PeachBrush")
                        }
                    };
                }
                else if (rel != null && rel.IsRegression)
                {
                    badge = new Border
                    {
                        Background = GetBrush("RedBrush", 0x25),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(6, 2, 6, 2),
                        HorizontalAlignment = HorizontalAlignment.Left,
                        ToolTip = rel.DetailReason,
                        Child = new TextBlock
                        {
                            Text = $"🚨 REGRESSION ({lastRun.Passed}/{lastRun.Total} · failed last {rel.CurrentStreak} runs)",
                            FontSize = 10,
                            FontWeight = FontWeights.Bold,
                            Foreground = GetBrush("RedBrush")
                        }
                    };
                }
                else if (lastRun.AllPassed)
                {
                    badge = new Border
                    {
                        Background = GetBrush("GreenBrush", 0x25),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(6, 2, 6, 2),
                        HorizontalAlignment = HorizontalAlignment.Left,
                        ToolTip = rel?.DetailReason,
                        Child = new TextBlock
                        {
                            Text = $"✅ PASSED ({lastRun.Passed}/{lastRun.Total})",
                            FontSize = 10,
                            FontWeight = FontWeights.Bold,
                            Foreground = GetBrush("GreenBrush")
                        }
                    };
                }
                else
                {
                    badge = new Border
                    {
                        Background = GetBrush("RedBrush", 0x25),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(6, 2, 6, 2),
                        HorizontalAlignment = HorizontalAlignment.Left,
                        ToolTip = rel?.DetailReason,
                        Child = new TextBlock
                        {
                            Text = $"❌ FAILED ({lastRun.Passed}/{lastRun.Total})",
                            FontSize = 10,
                            FontWeight = FontWeights.Bold,
                            Foreground = GetBrush("RedBrush")
                        }
                    };
                }
            }
            else
            {
                badge = new Border
                {
                    Background = GetBrush("PeachBrush", 0x25),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(6, 2, 6, 2),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    Child = new TextBlock
                    {
                        Text = "⚠️ NEVER RAN",
                        FontSize = 10,
                        FontWeight = FontWeights.Bold,
                        Foreground = GetBrush("PeachBrush")
                    }
                };
            }
            headerRow.Children.Add(badge);
            stack.Children.Add(headerRow);

            // File name
            var nameBlock = new TextBlock
            {
                Text = System.IO.Path.GetFileName(manifestPath),
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                ToolTip = manifestPath,
                Margin = new Thickness(0, 0, 0, 2)
            };
            stack.Children.Add(nameBlock);

            var pathBlock = new TextBlock
            {
                Text = manifestPath,
                FontSize = 10,
                Foreground = GetBrush("Subtext0Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 8)
            };
            stack.Children.Add(pathBlock);

            // Action buttons panel
            var btnPanel = new WrapPanel { Margin = new Thickness(0, 2, 0, 0) };

            var runBtn = new Button
            {
                Content = "▶ Run",
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 6, 4),
                Cursor = Cursors.Hand
            };
            runBtn.Click += async (s, e) =>
            {
                if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mw)
                {
                    var manifest = BuildConsole.Services.TestManifest.LoadFromFile(fullPath);
                    if (manifest != null) await mw.RunManifestPublicAsync(manifest);
                }
            };
            btnPanel.Children.Add(runBtn);

            var viewBtn = new Button
            {
                Content = "📄 View",
                FontSize = 11,
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 6, 4),
                Cursor = Cursors.Hand
            };
            viewBtn.Click += (s, e) =>
            {
                if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mw)
                {
                    mw.OpenFileTab(fullPath);
                }
            };
            btnPanel.Children.Add(viewBtn);

            var histBtn = new Button
            {
                Content = "🕒 History",
                FontSize = 11,
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 6, 4),
                Cursor = Cursors.Hand
            };
            histBtn.Click += (s, e) =>
            {
                if (Application.Current.MainWindow is MainWindow mw)
                {
                    if (manifestIssue.HasValue) mw.EnsureTestHistoryWindowPublic(manifestIssue.Value);
                    else mw.EnsureTestHistoryWindowPublic();
                }
            };
            btnPanel.Children.Add(histBtn);

            stack.Children.Add(btnPanel);
            card.Child = stack;
            return card;
        }

        private UIElement CreateSqlActionCard(string sqlPath, string? repoRoot, System.Collections.Generic.HashSet<string>? executedMigrations)
        {
            var card = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10),
                Margin = new Thickness(0, 0, 0, 8),
            };

            var stack = new StackPanel();

            string basename = System.IO.Path.GetFileNameWithoutExtension(sqlPath);
            string justFilename = System.IO.Path.GetFileName(sqlPath);
            bool isRan = executedMigrations != null &&
                         (executedMigrations.Contains(basename) ||
                          executedMigrations.Contains(justFilename) ||
                          executedMigrations.Contains(sqlPath) ||
                          executedMigrations.Any(n => System.IO.Path.GetFileNameWithoutExtension(n).Equals(basename, StringComparison.OrdinalIgnoreCase)));

            // Status badge
            var headerRow = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
            Border badge;
            if (isRan)
            {
                badge = new Border
                {
                    Background = GetBrush("GreenBrush", 0x25),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(6, 2, 6, 2),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    Child = new TextBlock
                    {
                        Text = "✅ EXECUTED",
                        FontSize = 10,
                        FontWeight = FontWeights.Bold,
                        Foreground = GetBrush("GreenBrush")
                    }
                };
            }
            else
            {
                badge = new Border
                {
                    Background = GetBrush("RedBrush", 0x25),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(6, 2, 6, 2),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    Child = new TextBlock
                    {
                        Text = "⚠️ NEEDS EXECUTION",
                        FontSize = 10,
                        FontWeight = FontWeights.Bold,
                        Foreground = GetBrush("RedBrush")
                    }
                };
            }
            headerRow.Children.Add(badge);
            stack.Children.Add(headerRow);

            // Filename
            var nameBlock = new TextBlock
            {
                Text = justFilename,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                ToolTip = sqlPath,
                Margin = new Thickness(0, 0, 0, 2)
            };
            stack.Children.Add(nameBlock);

            var pathBlock = new TextBlock
            {
                Text = sqlPath,
                FontSize = 10,
                Foreground = GetBrush("Subtext0Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 8)
            };
            stack.Children.Add(pathBlock);

            string fullPath = sqlPath;
            if (repoRoot != null)
            {
                string candidate = System.IO.Path.Combine(repoRoot, sqlPath.Replace("/", "\\"));
                if (System.IO.File.Exists(candidate)) fullPath = candidate;
                else
                {
                    try
                    {
                        var match = System.IO.Directory.GetFiles(repoRoot, justFilename, System.IO.SearchOption.AllDirectories)
                            .FirstOrDefault(f => !f.Contains("\\bin\\") && !f.Contains("\\obj\\") && !f.Contains("\\.git\\"));
                        if (match != null) fullPath = match;
                    }
                    catch { }
                }
            }

            var btnPanel = new WrapPanel { Margin = new Thickness(0, 2, 0, 0) };
            var openBtn = new Button
            {
                Content = "📄 Open File",
                FontSize = 11,
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 6, 4),
                Cursor = Cursors.Hand
            };
            openBtn.Click += (s, e) =>
            {
                if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mw)
                {
                    mw.OpenFileTab(fullPath);
                }
            };
            btnPanel.Children.Add(openBtn);

            stack.Children.Add(btnPanel);
            card.Child = stack;
            return card;
        }

        private static string DisplayTitle(GitIssue gi)
            => !string.IsNullOrWhiteSpace(gi.RawTitle) ? gi.RawTitle : gi.Title;

        private Brush GetBrush(string key, byte alpha = 255)
        {
            try
            {
                Brush? b = null;
                if (TryFindResource(key) is Brush found) b = found;
                else if (Application.Current != null && Application.Current.TryFindResource(key) is Brush appB) b = appB;

                if (b is SolidColorBrush scb)
                {
                    if (alpha == 255) return scb;
                    var c = scb.Color;
                    return new SolidColorBrush(Color.FromArgb(alpha, c.R, c.G, c.B));
                }
                if (b != null) return b;
            }
            catch { }
            return Brushes.Gray;
        }
    }
}
