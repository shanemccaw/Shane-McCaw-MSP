using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #921 (Epic #803) — the native, ADHD-friendly Git Board detail tabs.
    /// Shane: "When I click a milestone, it should open a new Tab and show me
    /// all the Epics, Issues, and Shane To-Do in an ADHD friendly way to
    /// consume. When I click on an epic it should do the same thing... Clicking
    /// on an issue - same thing... but with Epic linked."
    ///
    /// Split into its own partial-class file so it stays isolated from the
    /// concurrently-edited MainWindow.xaml.cs. Every tab is a real editor
    /// <see cref="TabItem"/> hosting a <see cref="GitDetailView"/>, built with
    /// the exact same recipe as OpenFileTab's .sql branch (header StackPanel +
    /// IconButton close + AttachTabContextMenu/AttachTabDragHandlers), so the
    /// #893/#894 multi-pane drag/dock all keep working — this is just tab
    /// content. Opens-or-focuses, keyed on the TabItem's string Tag.
    /// </summary>
    public partial class MainWindow
    {
        private const string GitDetailChannel = "git-board.detail-tab";

        // ── Public entry points (LeftSidebar events wire straight to these) ──

        /// <summary>Open (or focus) a milestone's detail tab: its real open/closed
        /// counts, then every Epic/Issue under it plus a distinct Shane To-Do
        /// carve-out (all reused verbatim from the board's own #884/#875 bucket
        /// split).</summary>
        public void OpenMilestoneDetailTab(GitMilestone m)
        {
            string key = $"git-detail:milestone:{m.Title}";
            if (FocusExistingGitDetailTab(key)) return;

            var view = new GitDetailView();
            view.OpenIssueNumberRequested += async (s, n) => await OpenGitDetailByNumberAsync(n);
            view.LoadMilestone(m);
            AddGitDetailTab(key, "🎯", m.Title, view);
        }

        /// <summary>Open (or focus) an epic or issue detail tab. Epic vs issue is
        /// routed by the real <see cref="GitIssue.IsEpic"/> (a GitHub sub-issue
        /// count &gt; 0, never a title convention): epics show their assigned
        /// sub-issues, issues show their comment thread plus their linked
        /// epic.</summary>
        public void OpenGitIssueDetailTab(GitIssue issue)
        {
            if (issue.IsEpic)
            {
                string epicKey = $"git-detail:epic:{issue.IssueNumber}";
                if (FocusExistingGitDetailTab(epicKey)) return;

                var view = new GitDetailView();
                view.OpenIssueNumberRequested += async (s, n) => await OpenGitDetailByNumberAsync(n);
                // sub_issues carry no labels, so the epic's Shane To-Do carve-out
                // is cross-referenced against the board's known To-Do numbers
                // (which DO carry labels), resolved from cached board data.
                var todoNumbers = LeftSidebar.CurrentBoardIssues.Where(i => i.IsTodo).Select(i => i.Number).ToHashSet();
                view.LoadEpic(issue, todoNumbers);
                AddGitDetailTab(epicKey, "⚡", GitDetailDisplayTitle(issue), view);
            }
            else
            {
                string issueKey = $"git-detail:issue:{issue.IssueNumber}";
                if (FocusExistingGitDetailTab(issueKey)) return;

                var view = new GitDetailView();
                view.OpenIssueNumberRequested += async (s, n) => await OpenGitDetailByNumberAsync(n);
                var (epicNumber, epicTitle) = ResolveLinkedEpic(issue);
                view.LoadIssue(issue, epicNumber, epicTitle);
                AddGitDetailTab(issueKey, "📄", GitDetailDisplayTitle(issue), view);
            }
        }

        /// <summary>Tab-to-tab navigation: a card click inside any detail tab
        /// (a milestone child, an epic's assigned issue, or an issue's linked
        /// epic) hands back a number here. Focus its tab if already open; else
        /// resolve it from the cached board (no refetch), falling back to one
        /// live GetIssueAsync only when the number isn't on the current OPEN
        /// board (e.g. a closed linked epic).</summary>
        public async Task OpenGitDetailByNumberAsync(int number)
        {
            if (FocusExistingGitDetailTab($"git-detail:epic:{number}") ||
                FocusExistingGitDetailTab($"git-detail:issue:{number}"))
                return;

            // Cached board resolution first — same GitIssue shape the tree nodes
            // carry, no second GitHub round-trip.
            var cached = LeftSidebar.BuildDetailIssue(number);
            if (cached != null)
            {
                OpenGitIssueDetailTab(cached);
                return;
            }

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ActivityLog.Log(GitDetailChannel, $"open #{number} by number: no GitHub PAT configured");
                return;
            }

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var detail = await client.GetIssueAsync(number);
                if (detail == null)
                {
                    ActivityLog.Log(GitDetailChannel, $"open #{number} by number: not found on GitHub");
                    return;
                }
                // IsEpic is a real sub-issue count, not a label — one extra fetch
                // to get it right for an off-board item.
                var subs = await client.GetSubIssuesAsync(number);
                var gi = new GitIssue
                {
                    IssueNumber = detail.Number,
                    Title = detail.Title,
                    RawTitle = detail.Title,
                    Status = string.Equals(detail.State, "closed", StringComparison.OrdinalIgnoreCase) ? "CLOSED" : "OPEN",
                    Body = detail.Body,
                    IsEpic = subs.Count > 0,
                };
                ActivityLog.Log(GitDetailChannel, $"open #{number} by number: resolved via live fetch ({(gi.IsEpic ? "epic" : "issue")})");
                OpenGitIssueDetailTab(gi);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(GitDetailChannel, $"open #{number} by number FAILED: {ex.Message}");
            }
        }

        // ── Helpers ─────────────────────────────────────────────────────────

        /// <summary>Shane's real convention is "Part of Epic #803" / "Epic #803"
        /// in the issue body — parse that, then resolve the epic's title from the
        /// cached board (null title if it isn't on the current OPEN board, in
        /// which case the linked-epic card still links by number).</summary>
        private (int? number, string? title) ResolveLinkedEpic(GitIssue issue)
        {
            if (string.IsNullOrEmpty(issue.Body)) return (null, null);
            var m = System.Text.RegularExpressions.Regex.Match(issue.Body, @"[Ee]pic\s+#(\d+)");
            if (!m.Success || !int.TryParse(m.Groups[1].Value, out var n)) return (null, null);
            var epic = LeftSidebar.CurrentBoardIssues.FirstOrDefault(i => i.Number == n);
            return (n, epic?.Title);
        }

        /// <summary>Focus an already-open detail tab by its string Tag; true if
        /// one existed. Mirrors OpenFileTab's own EditorTabs dedup scan.</summary>
        private bool FocusExistingGitDetailTab(string dedupKey)
        {
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tag && string.Equals(tag, dedupKey, StringComparison.Ordinal))
                {
                    EditorTabs.SelectedItem = item;
                    return true;
                }
            }
            return false;
        }

        /// <summary>Build and add the tab — same header/close/context-menu/drag
        /// recipe as OpenFileTab, so multi-pane drag/dock keep working.</summary>
        private void AddGitDetailTab(string dedupKey, string glyph, string title, GitDetailView view)
        {
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

            var titleBlock = new TextBlock
            {
                Text = title,
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush"),
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis,
                ToolTip = title
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

            var newTab = new TabItem
            {
                Tag = dedupKey,
                Header = headerPanel,
                Content = view
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
            ActiveDocTitleText.Text = $" - {title}";

            ActivityLog.Log(GitDetailChannel, $"tab opened: {dedupKey}");
        }

        private static string GitDetailDisplayTitle(GitIssue gi)
            => !string.IsNullOrWhiteSpace(gi.RawTitle) ? gi.RawTitle : gi.Title;
    }
}
