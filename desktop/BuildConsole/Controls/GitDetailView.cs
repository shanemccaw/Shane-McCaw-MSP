using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
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
        private readonly StackPanel _root;

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
            _root = new StackPanel { Margin = new Thickness(18, 16, 18, 24) };
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
            _root.Children.Clear();
            AddHeaderRow("🎯", m.Title, m.GithubNumber);

            if (m.HasRealCounts)
            {
                var counts = new WrapPanel { Margin = new Thickness(0, 0, 0, 6) };
                counts.Children.Add(CountPill($"{m.OpenIssues} open", "GreenBrush"));
                counts.Children.Add(CountPill($"{m.ClosedIssues} done", "BlueBrush"));
                counts.Children.Add(CountPill($"{m.TotalCount} total", "Subtext0Brush"));
                counts.Children.Add(CountPill(m.ProgressStr, "PeachBrush"));
                _root.Children.Add(counts);
            }
            else
            {
                _root.Children.Add(Meta("Live open/closed counts aren't available for this bucket (no real GitHub milestone behind it)."));
            }

            // The board already splits every milestone's OPEN items into three
            // named buckets (#884/#875) — reuse that split verbatim rather than
            // re-deriving it, so the tab and the tree agree exactly.
            var epicsBucket = m.Epics.FirstOrDefault(b => b.Title.Contains("Epics"));
            var issuesBucket = m.Epics.FirstOrDefault(b => b.Title.Contains("Issues"));
            var todoBucket = m.Epics.FirstOrDefault(b => b.Title.Contains("To-Do"));

            RenderGitIssueSection("EPICS", epicsBucket?.Issues, escalate: false);
            RenderGitIssueSection("ISSUES", issuesBucket?.Issues, escalate: false);
            RenderGitIssueSection("SHANE TO-DO", todoBucket?.Issues, escalate: true);

            int total = (epicsBucket?.Issues.Count ?? 0) + (issuesBucket?.Issues.Count ?? 0) + (todoBucket?.Issues.Count ?? 0);
            if (total == 0)
                _root.Children.Add(Meta("Nothing open under this milestone right now."));

            ActivityLog.Log(Channel, $"milestone '{m.Title}' opened ({m.OpenIssues} open / {m.ClosedIssues} done, {total} open item(s))");
        }

        // ── Epic tab ───────────────────────────────────────────────────────
        public async void LoadEpic(GitIssue epic, ISet<int> todoNumbers)
        {
            _root.Children.Clear();
            AddHeaderRow("⚡", DisplayTitle(epic), epic.IssueNumber);
            _root.Children.Add(StatePill(epic.Status));
            AddBody(epic.Body);

            var loading = Meta($"Loading assigned issues for #{epic.IssueNumber}…");
            _root.Children.Add(loading);

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
                _root.Children.Remove(loading);

                // sub_issues carries no labels, so the "Shane To-Do" carve-out
                // is cross-referenced against the board's known To-Do numbers
                // (which DO carry labels). Closed children not on the OPEN board
                // just fall into the main list — the best we can do without an
                // N+1 per-child fetch.
                var todo = subs.Where(s => todoNumbers.Contains(s.Number)).ToList();
                var rest = subs.Where(s => !todoNumbers.Contains(s.Number)).ToList();

                RenderSubIssueSection($"ASSIGNED ISSUES ({rest.Count})", rest, escalate: false);
                RenderSubIssueSection("SHANE TO-DO", todo, escalate: true);
                if (subs.Count == 0)
                    _root.Children.Add(Meta("No sub-issues assigned to this epic yet."));

                ActivityLog.Log(Channel, $"epic #{epic.IssueNumber} opened ({subs.Count} assigned, {todo.Count} to-do)");
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
            _root.Children.Clear();
            AddHeaderRow("📄", DisplayTitle(issue), issue.IssueNumber);
            _root.Children.Add(StatePill(issue.Status));

            // Linked epic shown prominently, with a click-through back to that
            // epic's own tab (OpenIssueNumberRequested → MainWindow).
            if (linkedEpicNumber.HasValue)
                _root.Children.Add(LinkedEpicCard(linkedEpicNumber.Value, linkedEpicTitle));

            // Body comes straight from the board's in-memory GitIssue.Body
            // (already fetched by ListBoardIssuesAsync) — deliberately NOT a
            // second GetIssueAsync call, honouring "don't refetch what's cached."
            AddBody(issue.Body);

            var loading = Meta("Loading comments…");
            _root.Children.Add(loading);

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                loading.Text = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).";
                ActivityLog.Log(Channel, $"issue #{issue.IssueNumber}: no GitHub PAT configured");
                return;
            }

            try
            {
                // Comments are the one piece nothing caches (#840 refetches them
                // every click too), so this is the only network hit here.
                var client = new GitHubApiClient(settings.GitHubPat);
                var comments = await client.GetIssueCommentsAsync(issue.IssueNumber);
                _root.Children.Remove(loading);

                _root.Children.Add(SectionHeader($"COMMENTS ({comments.Count})", escalate: false));
                if (comments.Count == 0)
                    _root.Children.Add(Meta("No comments yet."));
                foreach (var c in comments) // GitHub returns these chronological already
                    _root.Children.Add(CommentCard(c));

                ActivityLog.Log(Channel, $"issue #{issue.IssueNumber} opened ({comments.Count} comment(s))");
            }
            catch (Exception ex)
            {
                loading.Text = $"Couldn't load comments for #{issue.IssueNumber}: {ex.Message}";
                ActivityLog.Log(Channel, $"issue #{issue.IssueNumber} load FAILED: {ex.Message}");
            }
        }

        // ── Section rendering ──────────────────────────────────────────────
        private void RenderGitIssueSection(string header, List<GitIssue>? issues, bool escalate)
        {
            if (issues == null || issues.Count == 0) return;
            _root.Children.Add(SectionHeader($"{header} ({issues.Count})", escalate));
            foreach (var gi in issues)
                _root.Children.Add(GitIssueCard(gi, escalate));
        }

        private void RenderSubIssueSection(string header, List<GitHubSubIssue> subs, bool escalate)
        {
            if (subs.Count == 0) return;
            _root.Children.Add(SectionHeader($"{header} ({subs.Count})", escalate));
            foreach (var s in subs)
                _root.Children.Add(SubIssueCard(s, escalate));
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
            _root.Children.Add(row);
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

        private void AddBody(string body)
        {
            var card = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12),
                Margin = new Thickness(0, 0, 0, 4),
                Child = new TextBlock
                {
                    Text = string.IsNullOrWhiteSpace(body) ? "(no description)" : body,
                    FontSize = 12,
                    Foreground = GetBrush("TextBrush"),
                    TextWrapping = TextWrapping.Wrap,
                },
            };
            _root.Children.Add(card);
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
            return NavCard(gi.IssueNumber, DisplayTitle(gi), meta, gi.Status, escalate);
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
            var normalBorder = escalate ? GetBrush("PeachBrush") : GetBrush("Surface0Brush");

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
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("MauveBrush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12),
                Margin = new Thickness(0, 0, 0, 10),
                Cursor = Cursors.Hand,
                ToolTip = $"Open Epic #{number} in its own tab",
            };

            var panel = new StackPanel();
            panel.Children.Add(new TextBlock
            {
                Text = "⚡ LINKED EPIC",
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("MauveBrush"),
                Margin = new Thickness(0, 0, 0, 4),
            });

            var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
            titleRow.Children.Add(new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = $"#{number}", FontSize = 11, FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") },
            });
            titleRow.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(title) ? "(open to view)" : title,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
            });
            panel.Children.Add(titleRow);
            panel.Children.Add(new TextBlock
            {
                Text = "click to jump to this epic →",
                FontSize = 10,
                Foreground = GetBrush("Subtext1Brush"),
                Margin = new Thickness(0, 4, 0, 0),
            });

            card.Child = panel;
            card.MouseLeftButtonUp += (s, e) => OpenIssueNumberRequested?.Invoke(this, number);
            return card;
        }

        private Border CommentCard(GitHubIssueComment comment)
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
            panel.Children.Add(new TextBlock
            {
                Text = comment.Body,
                FontSize = 12,
                Foreground = GetBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
            });
            border.Child = panel;
            return border;
        }

        private static string DisplayTitle(GitIssue gi)
            => !string.IsNullOrWhiteSpace(gi.RawTitle) ? gi.RawTitle : gi.Title;

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
    }
}
