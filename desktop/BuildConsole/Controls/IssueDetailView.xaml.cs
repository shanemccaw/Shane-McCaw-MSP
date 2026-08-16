using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Documents;
using System.Linq;
using System.Text.RegularExpressions;
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

        public IssueDetailView()
        {
            InitializeComponent();
        }

        public async void LoadIssue(int number)
        {
            int myRequest = ++_requestId;

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
                        TextDecorations = TextDecorations.Underline,
                        NavigateUri = new Uri($"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{epicNumber}")
                    };
                    hyperlink.RequestNavigate += (sender, e) =>
                    {
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                        {
                            FileName = e.Uri.AbsoluteUri,
                            UseShellExecute = true
                        });
                    };
                    EpicText.Inlines.Add(hyperlink);
                }

                var executedMigrations = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (Application.Current.MainWindow is MainWindow mainWin && mainWin.BuildTrackerApi != null && mainWin.BuildTrackerApi.IsConfigured)
                {
                    try
                    {
                        var res = await mainWin.BuildTrackerApi.ExecuteSqlAsync("SELECT filename FROM simulator_migration_runs");
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
                if (myRequest != _requestId) return;

                BodyText.Document = ParseBodyToFlowDocument(string.IsNullOrWhiteSpace(issue.Body) ? "(no description)" : issue.Body, executedMigrations);
                BodyLabel.Visibility = Visibility.Visible;

                CommentsLabel.Text = $"COMMENTS ({comments.Count})";
                CommentsLabel.Visibility = Visibility.Visible;
                foreach (var comment in comments) // GitHub returns these in chronological order already
                {
                    CommentsList.Items.Add(CreateCommentCard(comment, executedMigrations));
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

        private UIElement CreateCommentCard(GitHubIssueComment comment, System.Collections.Generic.HashSet<string> executedMigrations)
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
                Document = ParseBodyToFlowDocument(comment.Body ?? "", executedMigrations),
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

        private Brush GetBrush(string key)
        {
            try
            {
                if (TryFindResource(key) is Brush b) return b;
                if (Application.Current != null && Application.Current.TryFindResource(key) is Brush appB) return appB;
            }
            catch { }
            return Brushes.Gray;
        }

        private FlowDocument ParseBodyToFlowDocument(string text, System.Collections.Generic.HashSet<string>? executedMigrations = null)
        {
            var doc = new FlowDocument
            {
                PagePadding = new Thickness(0),
                FontFamily = new FontFamily("Segoe UI"),
                FontSize = 12,
                Foreground = GetBrush("TextBrush")
            };
            var p = new Paragraph { Margin = new Thickness(0) };

            if (string.IsNullOrEmpty(text))
            {
                doc.Blocks.Add(p);
                return doc;
            }

            var matches = Regex.Matches(text, @"(?:\w[\w\-\./\\]*)\.(?:sql|cs|ts|tsx|json|xaml|ps1|cmd|md)\b");
            int lastIndex = 0;

            foreach (Match match in matches)
            {
                if (match.Index > lastIndex)
                {
                    p.Inlines.Add(new Run(text.Substring(lastIndex, match.Index - lastIndex)));
                }

                var hyperlink = new Hyperlink(new Run(match.Value))
                {
                    Foreground = GetBrush("BlueBrush"),
                    TextDecorations = TextDecorations.Underline
                };
                
                string fileName = match.Value;

                Func<System.Threading.Tasks.Task<string>> resolvePathAsync = async () =>
                {
                    string? repoRoot = BuildTrackerConfig.FindRepoRoot();
                    if (repoRoot == null) return string.Empty;
                    
                    string fullPath = System.IO.Path.Combine(repoRoot, fileName.Replace("/", "\\"));
                    if (!System.IO.File.Exists(fullPath))
                    {
                        var mw = Application.Current.MainWindow as MainWindow;
                        if (mw != null) mw.Cursor = System.Windows.Input.Cursors.Wait;
                        try
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
                        finally { if (mw != null) mw.Cursor = System.Windows.Input.Cursors.Arrow; }
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
                    ctx.Items.Add(viewItem);
                    ctx.Items.Add(runItem);
                    hyperlink.ContextMenu = ctx;
                }

                p.Inlines.Add(hyperlink);

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
                        p.Inlines.Add(new Run(" ✅"));
                    }
                    else 
                    {
                        var warnRun = new Run(" ⚠️ [NEEDS EXECUTION]");
                        warnRun.Foreground = GetBrush("RedBrush");
                        warnRun.FontWeight = FontWeights.Bold;
                        p.Inlines.Add(warnRun);
                    }
                }

                lastIndex = match.Index + match.Length;
            }

            if (lastIndex < text.Length)
            {
                p.Inlines.Add(new Run(text.Substring(lastIndex)));
            }

            doc.Blocks.Add(p);
            return doc;
        }
    }
}
