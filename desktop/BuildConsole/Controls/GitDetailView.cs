using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Documents;
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

        public GitDetailView()
        {
            _root = new Grid { Margin = new Thickness(18, 16, 18, 24) };
            _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(350) });

            _mainColumn = new StackPanel { Margin = new Thickness(0, 0, 24, 0) };
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

        // ── Milestone tab ──────────────────────────────────────────────────
        public void LoadMilestone(GitMilestone m)
        {
            _mainColumn.Children.Clear();
            _sideColumn.Children.Clear();
            _sideColumn.Visibility = Visibility.Visible;
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
        public async void LoadEpic(GitIssue epic, ISet<int> todoNumbers)
        {
            _mainColumn.Children.Clear();
            _sideColumn.Children.Clear();
            _sideColumn.Visibility = Visibility.Visible;
            AddHeaderRow("⚡", DisplayTitle(epic), epic.IssueNumber);
            _mainColumn.Children.Add(StatePill(epic.Status));
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

            _mainColumn.Children.Add(StatePill(issue.Status));

            // Linked epic shown in a subtle call out box above the description.
            if (linkedEpicNumber.HasValue)
                _mainColumn.Children.Add(LinkedEpicCard(linkedEpicNumber.Value, linkedEpicTitle));

            // Pre-fetch migration run status so .sql links in the body and
            // comments can show ✅/⚠️ inline without a second round-trip per link.
            var executedMigrations = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (Application.Current.MainWindow is MainWindow mainWinForMigrations &&
                mainWinForMigrations.BuildTrackerApi != null &&
                mainWinForMigrations.BuildTrackerApi.IsConfigured)
            {
                try
                {
                    var res = await mainWinForMigrations.BuildTrackerApi.ExecuteSqlAsync("SELECT filename FROM simulator_migration_runs");
                    var stmt = res.FirstOrDefault();
                    if (stmt != null && stmt.Rows != null)
                    {
                        foreach (var row in stmt.Rows)
                        {
                            if (row.TryGetValue("filename", out var val) && val.ValueKind != System.Text.Json.JsonValueKind.Null)
                                executedMigrations.Add(val.GetString() ?? "");
                        }
                    }
                }
                catch { }
            }

            // Pre-fetch test history runs so test-manifests/*.json links show run status (never ran / passed / failed)
            var latestTestRuns = new System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>();
            string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
            if (repoRoot != null)
            {
                try
                {
                    var history = BuildConsole.Services.TestHistoryStore.ReadAll(repoRoot);
                    foreach (var group in history.GroupBy(e => e.Issue))
                    {
                        latestTestRuns[group.Key] = group.OrderByDescending(e => e.StartedAt).First();
                    }
                }
                catch { }
            }

            // Body comes straight from the board's in-memory GitIssue.Body
            AddBody(issue.Body, executedMigrations, latestTestRuns);

            // Populate side column with extracted SQL scripts and Test Manifests
            RenderActionsColumn(_sideColumn, issue.Body, null, executedMigrations, latestTestRuns);
            _sideColumn.Visibility = Visibility.Visible;

            var loading = Meta("Loading comments…");
            _mainColumn.Children.Add(loading);

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                loading.Text = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).";
                ActivityLog.Log(Channel, $"issue #{issue.IssueNumber}: no GitHub PAT configured");
                return;
            }

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var comments = await client.GetIssueCommentsAsync(issue.IssueNumber);
                _mainColumn.Children.Remove(loading);

                _mainColumn.Children.Add(SectionHeader($"COMMENTS ({comments.Count})", escalate: false));
                if (comments.Count == 0)
                    _mainColumn.Children.Add(Meta("No comments yet."));
                foreach (var c in comments)
                    _mainColumn.Children.Add(CommentCard(c, executedMigrations, latestTestRuns));

                // Re-populate side column with actions extracted from both body and comments
                RenderActionsColumn(_sideColumn, issue.Body, comments.Select(c => c.Body ?? ""), executedMigrations, latestTestRuns);

                ActivityLog.Log(Channel, $"issue #{issue.IssueNumber} opened ({comments.Count} comment(s))");
            }
            catch (Exception ex)
            {
                loading.Text = $"Couldn't load comments for #{issue.IssueNumber}: {ex.Message}";
                ActivityLog.Log(Channel, $"issue #{issue.IssueNumber} load FAILED: {ex.Message}");
            }
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

        private UIElement StatePill(string status)
        {
            bool closed = string.Equals(status, "CLOSED", StringComparison.OrdinalIgnoreCase);
            var border = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = closed ? GetBrush("RedBrush") : GetBrush("GreenBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(9, 3, 9, 3),
                Margin = new Thickness(0, 0, 0, 10),
                HorizontalAlignment = HorizontalAlignment.Left,
                Child = new TextBlock
                {
                    Text = closed ? "CLOSED" : "OPEN",
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = closed ? GetBrush("RedBrush") : GetBrush("GreenBrush"),
                },
            };
            return border;
        }

        private void AddBody(string? markdown, System.Collections.Generic.HashSet<string>? executedMigrations = null, System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>? latestTestRuns = null)
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

            var tb = CreateLinkedTextBlock(markdown, 13, "TextBrush", executedMigrations, latestTestRuns);
            tb.LineHeight = 20;
            border.Child = tb;

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


        private Border CommentCard(GitHubIssueComment comment, System.Collections.Generic.HashSet<string>? executedMigrations = null, System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>? latestTestRuns = null)
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
            panel.Children.Add(CreateLinkedTextBlock(comment.Body ?? "", 12, "TextBrush", executedMigrations, latestTestRuns));
            border.Child = panel;
            return border;
        }

        private TextBlock CreateLinkedTextBlock(string? text, double fontSize, string foregroundKey, System.Collections.Generic.HashSet<string>? executedMigrations = null, System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>? latestTestRuns = null)
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
                    string fullPath = fileName;
                    if (!System.IO.Path.IsPathRooted(fullPath))
                    {
                        var repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                        if (repoRoot != null)
                        {
                            string candidate = System.IO.Path.Combine(repoRoot, fileName);
                            if (System.IO.File.Exists(candidate))
                            {
                                fullPath = candidate;
                            }
                            else
                            {
                                string targetName = System.IO.Path.GetFileName(fileName);
                                try
                                {
                                    var found = await System.Threading.Tasks.Task.Run(() =>
                                        System.IO.Directory.GetFiles(repoRoot, targetName, System.IO.SearchOption.AllDirectories)
                                            .FirstOrDefault(f => !f.Contains("\\bin\\") && !f.Contains("\\obj\\") && !f.Contains("\\.git\\") && !f.Contains("\\node_modules\\"))
                                    );
                                    if (found != null) fullPath = found;
                                    else fullPath = candidate;
                                }
                                catch
                                {
                                    fullPath = candidate;
                                }
                            }
                        }
                    }
                    return fullPath;
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
                            }
                            catch { }
                        }
                    }

                    if (manifestIssue.HasValue && latestTestRuns != null && latestTestRuns.TryGetValue(manifestIssue.Value, out var lastRun))
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
            System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>? latestTestRuns)
        {
            target.Children.Clear();

            var allText = (body ?? "") + "\n" + string.Join("\n", commentBodies ?? Enumerable.Empty<string>());
            if (string.IsNullOrWhiteSpace(allText)) return;

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

            // 1. Render Test Manifests section
            if (testManifests.Count > 0)
            {
                target.Children.Add(SectionHeader($"🧪 TEST MANIFESTS ({testManifests.Count})", escalate: false));

                foreach (var manifestPath in testManifests)
                {
                    target.Children.Add(CreateTestManifestActionCard(manifestPath, repoRoot, latestTestRuns));
                }
            }

            // 2. Render SQL Migrations section
            if (sqlFiles.Count > 0)
            {
                target.Children.Add(SectionHeader($"🗄️ SQL MIGRATIONS ({sqlFiles.Count})", escalate: false));

                foreach (var sqlPath in sqlFiles)
                {
                    target.Children.Add(CreateSqlActionCard(sqlPath, repoRoot, executedMigrations));
                }
            }

            if (testManifests.Count == 0 && sqlFiles.Count == 0)
            {
                var emptyBorder = new Border
                {
                    Background = GetBrush("MantleBrush"),
                    BorderBrush = GetBrush("Surface0Brush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(12),
                    Margin = new Thickness(0, 0, 0, 8),
                };
                emptyBorder.Child = new TextBlock
                {
                    Text = "No SQL migrations or test manifests referenced in this issue.",
                    FontSize = 11,
                    Foreground = GetBrush("Subtext0Brush"),
                    TextWrapping = TextWrapping.Wrap
                };
                target.Children.Add(emptyBorder);
            }
        }

        private UIElement CreateTestManifestActionCard(string manifestPath, string? repoRoot, System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>? latestTestRuns)
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
                    }
                    catch { }
                }
            }

            Border badge;
            if (manifestIssue.HasValue && latestTestRuns != null && latestTestRuns.TryGetValue(manifestIssue.Value, out var lastRun))
            {
                if (lastRun.AllPassed)
                {
                    badge = new Border
                    {
                        Background = GetBrush("GreenBrush", 0x25),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(6, 2, 6, 2),
                        HorizontalAlignment = HorizontalAlignment.Left,
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
