using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #840 (Git Board Phase 2) — Shane: "I need to be able to... read
    /// their descriptions, comments, etc..." Clicking an issue in the Git
    /// Board tree (LeftSidebar.IssueSelected) loads its real description and
    /// comment thread here, via GitHubApiClient.GetIssueAsync/GetIssueCommentsAsync
    /// (GET /issues/{n} + GET /issues/{n}/comments) — same docked-tab
    /// convention as BuildLogView/TestResultsView, not a floating window.
    /// </summary>
    public partial class IssueDetailView : UserControl
    {
        private const string Channel = "git-board.issue-detail";
        private int _requestId;
        private int _currentNumber;

        /// <summary>
        /// Shane, 2026-08-30 — when true, LoadIssue renders a live Claude.ai chat in the
        /// right column (see RenderChatColumnAsync) instead of the default SQL-migration/
        /// test-manifest ActionsPanel. Used by Batter Up / AI Batter Up's document tabs;
        /// the Git Board's own detail tabs leave this false and keep the original actions
        /// sidebar unchanged.
        /// </summary>
        public bool ShowChatInsteadOfActions { get; set; }

        public IssueDetailView()
        {
            InitializeComponent();
        }

        public async void LoadIssue(int number)
        {
            int myRequest = ++_requestId;
            _currentNumber = number;
            CommentBox.Text = "";
            ChatColumnHost.Child = null;

            EmptyState.Visibility = Visibility.Collapsed;
            NumberBadgeText.Text = $"#{number}";
            TitleLabel.Text = "Loading…";
            StateBadgeText.Text = "";
            EpicLabel.Visibility = Visibility.Collapsed;
            EpicText.Visibility = Visibility.Collapsed;
            BodyLabel.Visibility = Visibility.Collapsed;
            CommentsLabel.Visibility = Visibility.Collapsed;
            BodyText.Document = new FlowDocument();
            CommentsList.Items.Clear();
            ActionsPanel.Children.Clear();
            LoadingText.Text = $"Loading #{number}…";
            LoadingText.Visibility = Visibility.Visible;

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                LoadingText.Text = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).";
                ActivityLog.Log(Channel, $"#{number}: no GitHub PAT configured");
                return;
            }

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var issue = await client.GetIssueAsync(number);
                var comments = await client.GetIssueCommentsAsync(number);
                if (myRequest != _requestId) return; // superseded by a newer click

                if (issue == null)
                {
                    LoadingText.Text = $"Couldn't load #{number}: issue not found.";
                    ActivityLog.Log(Channel, $"#{number}: not found");
                    return;
                }

                TitleLabel.Text = issue.Title;
                StateBadgeText.Text = issue.State.ToUpperInvariant();
                StateBadgeText.Foreground = string.Equals(issue.State, "closed", StringComparison.OrdinalIgnoreCase)
                    ? GetBrush("RedBrush") : GetBrush("GreenBrush");

                var m = Regex.Match(issue.Body ?? "", @"[Ee]pic\s+#(\d+)");
                if (m.Success && int.TryParse(m.Groups[1].Value, out var epicNumber))
                {
                    EpicLabel.Visibility = Visibility.Visible;
                    EpicText.Visibility = Visibility.Visible;
                    EpicText.Inlines.Clear();
                    
                    GitIssue? cachedEpic = null;
                    if (Application.Current.MainWindow is MainWindow mw)
                    {
                        cachedEpic = mw.LeftSidebar.BuildDetailIssue(epicNumber);
                    }
                    string epicTitle = cachedEpic?.Title ?? "";
                    
                    var hyperlink = new Hyperlink(new Run($"#{epicNumber} {epicTitle}".Trim()))
                    {
                        Foreground = GetBrush("BlueBrush"),
                        Cursor = Cursors.Hand,
                        ToolTip = $"Click to open Epic #{epicNumber} in a new tab"
                    };
                    hyperlink.Click += async (s, e) =>
                    {
                        if (Application.Current.MainWindow is MainWindow mw)
                        {
                            await mw.OpenGitDetailByNumberAsync(epicNumber);
                        }
                    };
                    EpicText.Inlines.Add(hyperlink);
                }

                var executedMigrations = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (Application.Current.MainWindow is MainWindow mainWin && mainWin.BuildTrackerApi != null && mainWin.BuildTrackerApi.IsConfigured)
                {
                    try
                    {
                        var res = await LocalSqlExecutor.ExecuteAsync(mainWin.BuildTrackerApi, "SELECT filename FROM simulator_migration_runs");
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

                if (myRequest != _requestId) return;

                BodyText.Document = ParseBodyToFlowDocument(string.IsNullOrWhiteSpace(issue.Body) ? "(no description)" : issue.Body, executedMigrations, latestTestRuns);
                BodyLabel.Visibility = Visibility.Visible;

                CommentsLabel.Text = $"COMMENTS ({comments.Count})";
                CommentsLabel.Visibility = Visibility.Visible;
                foreach (var comment in comments) // GitHub returns these in chronological order already
                {
                    CommentsList.Items.Add(CreateCommentCard(comment, executedMigrations, latestTestRuns));
                }

                // Populate the right column — either the default SQL-migration/test-manifest
                // actions sidebar, or (Batter Up / AI Batter Up) a live linked chat.
                var commentBodies = comments.Select(c => c.Body ?? "");
                if (ShowChatInsteadOfActions)
                {
                    ActionsScroller.Visibility = Visibility.Collapsed;
                    ChatColumnHost.Visibility = Visibility.Visible;
                    _ = RenderChatColumnAsync(number, myRequest);
                }
                else
                {
                    ActionsScroller.Visibility = Visibility.Visible;
                    ChatColumnHost.Visibility = Visibility.Collapsed;
                    RenderActionsColumn(ActionsPanel, issue.Body, commentBodies, executedMigrations, latestTestRuns);
                }

                LoadingText.Visibility = Visibility.Collapsed;
                ActivityLog.Log(Channel, $"#{number}: loaded ({comments.Count} comment(s))");
            }
            catch (Exception ex)
            {
                if (myRequest != _requestId) return;
                LoadingText.Text = $"Couldn't load #{number}: {ex.Message}";
                ActivityLog.Log(Channel, $"#{number}: load FAILED: {ex.Message}");
            }
        }

        /// <summary>
        /// Shane, 2026-08-30 — "I should be able to respond to the issue and post a
        /// comment directly to it." Posts via the real GitHub API and appends the
        /// created comment to the thread immediately rather than waiting on a full
        /// reload.
        /// </summary>
        private async void BtnPostComment_Click(object sender, RoutedEventArgs e)
        {
            string text = CommentBox.Text?.Trim() ?? "";
            if (string.IsNullOrEmpty(text) || _currentNumber <= 0) return;

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ToastEngine.Warning("Post Comment", "No GitHub PAT configured — set one in Settings.");
                return;
            }

            int number = _currentNumber;
            var originalContent = BtnPostComment.Content;
            BtnPostComment.IsEnabled = false;
            BtnPostComment.Content = "Posting…";
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var created = await client.AddIssueCommentAsync(number, text);
                if (_currentNumber != number) return; // switched issues mid-post — don't append to the wrong thread

                CommentsList.Items.Add(CreateCommentCard(created));
                CommentsLabel.Text = $"COMMENTS ({CommentsList.Items.Count})";
                CommentsLabel.Visibility = Visibility.Visible;
                CommentBox.Text = "";
                ActivityLog.Log(Channel, $"#{number}: posted a comment ({text.Length} chars).");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Post Comment", $"Couldn't post to #{number}: {ex.Message}");
                ActivityLog.Log(Channel, $"#{number}: post comment FAILED: {ex.Message}");
            }
            finally
            {
                BtnPostComment.Content = originalContent;
                BtnPostComment.IsEnabled = true;
            }
        }

        /// <summary>
        /// Shane, 2026-08-30 — "look at find the parent, all the way to the parent
        /// Epic until you find the Epic with the chat associated." Walks
        /// LeftSidebar.FindChatForIssue up the issue's own cached parent-epic chain
        /// (LeftSidebar.BuildDetailIssue(n).ParentNumber) until a chat turns up or the
        /// chain runs out (guards against a cycle with `seen`). Depends on the Git
        /// Board having loaded at least once this session to populate that cache —
        /// same dependency the existing parent-epic lookup above already has.
        /// </summary>
        private static (BuildConsole.Services.BoardChat Chat, int ResolvedAtNumber)? FindChatWalkingUpToEpic(MainWindow mw, int startNumber)
        {
            var seen = new System.Collections.Generic.HashSet<int>();
            int? current = startNumber;
            while (current.HasValue && seen.Add(current.Value))
            {
                var chat = mw.LeftSidebar.FindChatForIssue(current.Value);
                if (chat != null && !string.IsNullOrWhiteSpace(chat.ClaudeUrl))
                    return (chat, current.Value);
                var issue = mw.LeftSidebar.BuildDetailIssue(current.Value);
                current = issue?.ParentNumber;
            }
            return null;
        }

        /// <summary>
        /// Shane, 2026-08-30 — Batter Up / AI Batter Up's chat column. Resolves the
        /// nearest chat via <see cref="FindChatWalkingUpToEpic"/>, embeds a real chat
        /// WebView2 navigated to it, and pre-fills (never sends) "lets discuss Git
        /// #&lt;n&gt;" via the same bt_prefill poll mechanism the "New Epic Chat" flow
        /// already uses (MainWindow.EpicChatPrefillPollScript) — a fresh chat's SPA
        /// composer can take several seconds to mount, so a fixed short delay isn't
        /// reliable here; the poll script already handles that (~15s, 500ms interval).
        /// </summary>
        private async System.Threading.Tasks.Task RenderChatColumnAsync(int number, int myRequest)
        {
            ChatColumnHost.Child = new TextBlock
            {
                Text = "Looking for a linked chat…",
                FontSize = 11.5,
                Foreground = GetBrush("Subtext1Brush"),
                Margin = new Thickness(16),
                TextWrapping = TextWrapping.Wrap
            };

            if (Application.Current.MainWindow is not MainWindow mw) return;

            // In-memory walk over LeftSidebar's already-cached board data — fast enough
            // to run inline on the UI thread; those lists aren't safe to touch off it.
            var found = FindChatWalkingUpToEpic(mw, number);
            if (myRequest != _requestId) return; // superseded by a newer click
            await System.Threading.Tasks.Task.Yield(); // keep this genuinely async for the awaits below

            if (found == null)
            {
                ChatColumnHost.Child = new TextBlock
                {
                    Text = $"No chat linked to #{number}, its parent, or any ancestor epic yet.",
                    FontSize = 11.5,
                    Foreground = GetBrush("Subtext0Brush"),
                    Margin = new Thickness(16),
                    TextWrapping = TextWrapping.Wrap
                };
                return;
            }

            var (chat, resolvedAt) = found.Value;
            ActivityLog.Log(Channel, resolvedAt == number
                ? $"#{number}: chat resolved directly ({chat.Title})."
                : $"#{number}: chat resolved via ancestor #{resolvedAt} ({chat.Title}).");

            string prefillUrl = chat.ClaudeUrl
                + (chat.ClaudeUrl.Contains('?') ? "&" : "?")
                + "bt_prefill=" + Uri.EscapeDataString($"lets discuss Git #{number}");

            var wv = new ChatSafeWebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37) };
            wv.NavigationCompleted += async (s, e) =>
            {
                if (!e.IsSuccess) return;
                try { await wv.ExecuteScriptAsync(MainWindow.EpicChatPrefillPollScript); }
                catch { }
            };
            bool navigated = false;
            wv.Loaded += (s, e) =>
            {
                if (!navigated && wv.CoreWebView2 != null)
                {
                    navigated = true;
                    wv.CoreWebView2.Navigate(prefillUrl);
                }
            };

            if (myRequest != _requestId) return; // superseded while we were resolving
            ChatColumnHost.Child = wv;
        }

        private Border CreateCommentCard(GitHubIssueComment comment, System.Collections.Generic.HashSet<string>? executedMigrations = null, System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>? latestTestRuns = null)
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

            var bodyBlock = new RichTextBox
            {
                Document = ParseBodyToFlowDocument(comment.Body ?? "", executedMigrations, latestTestRuns),
                IsReadOnly = true,
                IsDocumentEnabled = true,
                BorderThickness = new Thickness(0),
                Background = Brushes.Transparent,
                Margin = new Thickness(0)
            };

            panel.Children.Add(headerPanel);
            panel.Children.Add(bodyBlock);
            border.Child = panel;
            return border;
        }

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

        private Border SectionHeader(string text, bool escalate)
        {
            var border = new Border
            {
                Background = escalate ? GetBrush("RedBrush") : GetBrush("CrustBrush"),
                Padding = new Thickness(10, 5, 10, 5),
                Margin = new Thickness(0, 0, 0, 8),
                CornerRadius = new CornerRadius(3),
            };
            border.Child = new TextBlock
            {
                Text = text,
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = escalate ? GetBrush("CrustBrush") : GetBrush("Subtext1Brush"),
            };
            return border;
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

        private FlowDocument ParseBodyToFlowDocument(string text, System.Collections.Generic.HashSet<string>? executedMigrations = null, System.Collections.Generic.Dictionary<int, BuildConsole.Services.TestHistoryEntry>? latestTestRuns = null)
        {
            var doc = new FlowDocument
            {
                PagePadding = new Thickness(0),
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 12,
                Foreground = GetBrush("TextBrush")
            };

            if (string.IsNullOrEmpty(text))
            {
                doc.Blocks.Add(new Paragraph(new Run("(no description)")) { Margin = new Thickness(0) });
                return doc;
            }

            var options = new MarkdownRenderer.RenderOptions
            {
                GetBrush = key => GetBrush(key),
                BaseFontSize = 12,
                OnIssueClick = async issueNum =>
                {
                    if (Application.Current.MainWindow is MainWindow mWindow)
                        await mWindow.OpenGitDetailByNumberAsync(issueNum, sideBySide: true);
                },
                OnUrlClick = url =>
                {
                    try
                    {
                        var psi = new System.Diagnostics.ProcessStartInfo { FileName = url, UseShellExecute = true };
                        System.Diagnostics.Process.Start(psi);
                    }
                    catch { }
                },
                OnFileClick = async fileName =>
                {
                    string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                    if (repoRoot == null) return;
                    string fullPath = System.IO.Path.Combine(repoRoot, fileName.Replace("/", "\\"));
                    if (!System.IO.File.Exists(fullPath))
                    {
                        fullPath = await System.Threading.Tasks.Task.Run(() =>
                        {
                            var queue = new System.Collections.Generic.Queue<string>();
                            queue.Enqueue(repoRoot);
                            string target = System.IO.Path.GetFileName(fileName);
                            while (queue.Count > 0)
                            {
                                var current = queue.Dequeue();
                                try
                                {
                                    foreach (var file in System.IO.Directory.GetFiles(current, target)) return file;
                                    foreach (var dir in System.IO.Directory.GetDirectories(current))
                                    {
                                        var name = System.IO.Path.GetFileName(dir);
                                        if (name == "node_modules" || name == ".git" || name == "bin" || name == "obj" || name == ".next") continue;
                                        queue.Enqueue(dir);
                                    }
                                }
                                catch { }
                            }
                            return fullPath;
                        });
                    }

                    if (System.IO.File.Exists(fullPath) && Application.Current.MainWindow is MainWindow mWindow)
                    {
                        mWindow.OpenFileTab(fullPath);
                    }
                }
            };

            var renderedElement = MarkdownRenderer.Render(text, options);
            doc.Blocks.Add(new BlockUIContainer(renderedElement));
            return doc;
        }
    }
}
