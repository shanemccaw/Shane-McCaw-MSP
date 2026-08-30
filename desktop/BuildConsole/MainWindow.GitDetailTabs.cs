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
    /// Supports side-by-side split view so Shane can inspect issue descriptions
    /// and comment threads simultaneously alongside active Claude chats.
    /// When in side-by-side mode, clicking another issue replaces the previous document
    /// in the secondary pane so tabs do not stack up.
    /// </summary>
    public partial class MainWindow
    {
        private const string GitDetailChannel = "git-board.detail-tab";

        // ── Public entry points (LeftSidebar / BuildQueuePanel events wire straight to these) ──

        /// <summary>Open (or focus) a milestone's detail tab: its real open/closed
        /// counts, then every Epic/Issue under it plus a distinct Shane To-Do
        /// carve-out.</summary>
        public void OpenMilestoneDetailTab(GitMilestone m, bool sideBySide = false)
        {
            TabControl targetPane = EditorTabs;
            if (sideBySide)
            {
                ApplyGridForMode("SplitH");
                targetPane = EditorTabs2;
            }

            string key = $"git-detail:milestone:{m.Title}";
            if (FocusExistingGitDetailTab(key, sideBySide ? targetPane : null)) return;

            var view = new GitDetailView();
            view.OpenIssueNumberRequested += async (s, n) => await OpenGitDetailByNumberAsync(n, sideBySide);
            view.LoadMilestone(m);
            AddGitDetailTab(key, "🎯", m.Title, view, targetPane, replaceExistingInPane: sideBySide);
        }

        /// <summary>Open (or focus) an epic or issue detail tab.
        /// When <paramref name="sideBySide"/> is true, opens in the secondary pane
        /// alongside the active chat, replacing any previous document in that pane.</summary>
        public void OpenGitIssueDetailTab(GitIssue issue, bool sideBySide = false)
        {
            TabControl targetPane = EditorTabs;
            if (sideBySide)
            {
                ApplyGridForMode("SplitH");
                targetPane = EditorTabs2;
            }

            if (issue.IsEpic)
            {
                string epicKey = $"git-detail:epic:{issue.IssueNumber}";
                if (FocusExistingGitDetailTab(epicKey, sideBySide ? targetPane : null)) return;

                var view = new GitDetailView();
                view.OpenIssueNumberRequested += async (s, n) => await OpenGitDetailByNumberAsync(n, sideBySide);
                view.OpenOrCreateEpicChatRequested += (s, n) => OpenOrCreateEpicChat(n);
                var todoNumbers = LeftSidebar.CurrentBoardIssues.Where(i => i.IsTodo).Select(i => i.Number).ToHashSet();
                var linkedChat = LeftSidebar.FindChatForIssue(issue.IssueNumber);
                view.LoadEpic(issue, todoNumbers, linkedChat);
                AddGitDetailTab(epicKey, "⚡", GitDetailDisplayTitle(issue), view, targetPane, replaceExistingInPane: sideBySide);
            }
            else
            {
                string issueKey = $"git-detail:issue:{issue.IssueNumber}";
                if (FocusExistingGitDetailTab(issueKey, sideBySide ? targetPane : null)) return;

                var view = new GitDetailView();
                view.OpenIssueNumberRequested += async (s, n) => await OpenGitDetailByNumberAsync(n, sideBySide);
                var (epicNumber, epicTitle) = ResolveLinkedEpic(issue);
                view.LoadIssue(issue, epicNumber, epicTitle);
                AddGitDetailTab(issueKey, "📄", GitDetailDisplayTitle(issue), view, targetPane, replaceExistingInPane: sideBySide);
            }
        }

        /// <summary>Tab-to-tab navigation: a card click inside any detail tab
        /// (a milestone child, an epic's assigned issue, or an issue's linked
        /// epic) hands back a number here.</summary>
        public async Task OpenGitDetailByNumberAsync(int number, bool sideBySide = false)
        {
            TabControl? targetPane = sideBySide ? EditorTabs2 : null;
            if (FocusExistingGitDetailTab($"git-detail:epic:{number}", targetPane) ||
                FocusExistingGitDetailTab($"git-detail:issue:{number}", targetPane))
                return;

            // Cached board resolution first — same GitIssue shape the tree nodes
            // carry, no second GitHub round-trip.
            var cached = LeftSidebar.BuildDetailIssue(number);
            if (cached != null)
            {
                OpenGitIssueDetailTab(cached, sideBySide);
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
                var subs = await client.GetSubIssuesAsync(number);
                var gi = new GitIssue
                {
                    IssueNumber = detail.Number,
                    Title = detail.Title,
                    RawTitle = detail.Title,
                    Status = string.Equals(detail.State, "closed", StringComparison.OrdinalIgnoreCase) ? "CLOSED" : "OPEN",
                    Body = detail.Body,
                    IsEpic = subs.Count > 0,
                    Labels = detail.Labels,
                };
                ActivityLog.Log(GitDetailChannel, $"open #{number} by number: resolved via live fetch ({(gi.IsEpic ? "epic" : "issue")})");
                OpenGitIssueDetailTab(gi, sideBySide);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(GitDetailChannel, $"open #{number} by number FAILED: {ex.Message}");
            }
        }

        // ── Helpers ─────────────────────────────────────────────────────────

        private (int? number, string? title) ResolveLinkedEpic(GitIssue issue)
        {
            if (string.IsNullOrEmpty(issue.Body)) return (null, null);
            var m = System.Text.RegularExpressions.Regex.Match(issue.Body, @"[Ee]pic\s+#(\d+)");
            if (!m.Success || !int.TryParse(m.Groups[1].Value, out var n)) return (null, null);
            var epic = LeftSidebar.CurrentBoardIssues.FirstOrDefault(i => i.Number == n);
            return (n, epic?.Title);
        }

        /// <summary>Focus an already-open detail tab by its string Tag across panes; true if one existed.</summary>
        private bool FocusExistingGitDetailTab(string dedupKey, TabControl? targetPane = null)
        {
            if (targetPane != null)
            {
                foreach (TabItem item in targetPane.Items)
                {
                    if (item.Tag is string tag && string.Equals(tag, dedupKey, StringComparison.Ordinal))
                    {
                        targetPane.SelectedItem = item;
                        return true;
                    }
                }
                return false;
            }

            foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
            {
                foreach (TabItem item in pane.Items)
                {
                    if (item.Tag is string tag && string.Equals(tag, dedupKey, StringComparison.Ordinal))
                    {
                        pane.SelectedItem = item;
                        return true;
                    }
                }
            }
            return false;
        }

        /// <summary>Build and add the tab to the specified target pane, optionally replacing existing git document tabs.</summary>
        private void AddGitDetailTab(string dedupKey, string glyph, string title, GitDetailView view, TabControl? targetPane = null, bool replaceExistingInPane = false)
        {
            var pane = targetPane ?? EditorTabs;

            if (replaceExistingInPane)
            {
                var existingGitTabs = pane.Items.OfType<TabItem>()
                    .Where(t => t.Tag is string tag && tag.StartsWith("git-detail:", StringComparison.OrdinalIgnoreCase))
                    .ToList();

                foreach (var oldTab in existingGitTabs)
                {
                    pane.Items.Remove(oldTab);
                }
            }

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

            AttachTabContextMenu(newTab, pane);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab, pane);

            pane.Items.Add(newTab);
            pane.SelectedItem = newTab;

            ActivityLog.Log(GitDetailChannel, $"tab opened ({pane.Name}): {dedupKey}");
        }

        public void OpenOrCreateEpicChat(int epicNumber)
        {
            var linkedChat = LeftSidebar.FindChatForIssue(epicNumber);
            if (linkedChat != null && !string.IsNullOrEmpty(linkedChat.ClaudeUrl))
            {
                ActivityLog.Log(GitDetailChannel, $"open linked chat for epic #{epicNumber} -> {linkedChat.ClaudeUrl}");
                OpenChatTab(linkedChat, epicNumber);
            }
            else
            {
                var settings = BuildConsoleSettings.Load();
                if (!settings.HasEpicChatProjectUrl)
                {
                    ActivityLog.Log(GitDetailChannel, $"new chat for epic #{epicNumber} aborted — no New Chat Project URL configured");
                    ToastEngine.Warning("New Epic Chat", "Set a \"New Chat Project URL\" in the Settings tab first.");
                    return;
                }
                var baseUrl = settings.EpicChatProjectUrl.Trim();
                if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out _))
                {
                    ActivityLog.Log(GitDetailChannel, $"new chat for epic #{epicNumber} aborted — invalid New Chat Project URL '{baseUrl}'");
                    ToastEngine.Warning("New Epic Chat", "The configured New Chat Project URL isn't a valid URL.");
                    return;
                }
                var pat = settings.GitHubPat?.Trim() ?? "";
                var fullUrl = EpicChatUrlBuilder.BuildEpicChatUrl(baseUrl, pat, epicNumber);
                ActivityLog.Log(GitDetailChannel, $"new chat for epic #{epicNumber} -> {baseUrl} (prefill 'Epic #{epicNumber}')");
                OpenWebTab(fullUrl, $"Epic #{epicNumber} New Chat", "", injectPrefillPoll: true, associateIssueNumber: epicNumber, associateIssueType: "Epic", associateDefaultTitle: $"[#{epicNumber}] Epic Chat");
            }
        }

        private static string GitDetailDisplayTitle(GitIssue gi)
            => !string.IsNullOrWhiteSpace(gi.RawTitle) ? gi.RawTitle : gi.Title;

        /// <summary>Refreshes any open Git detail tabs (milestones, epics, issues) with fresh data from LeftSidebar.</summary>
        public void RefreshOpenGitDetailTabs()
        {
            var panes = new[] { EditorTabs, EditorTabs2 };
            foreach (var pane in panes)
            {
                if (pane == null) continue;
                foreach (TabItem tab in pane.Items.OfType<TabItem>())
                {
                    if (tab.Content is GitDetailView view && tab.Tag is string tag)
                    {
                        if (tag.StartsWith("git-detail:milestone:", StringComparison.OrdinalIgnoreCase))
                        {
                            string mTitle = tag.Substring("git-detail:milestone:".Length);
                            var m = LeftSidebar.CurrentMilestones.FirstOrDefault(ms => ms.Title.Equals(mTitle, StringComparison.OrdinalIgnoreCase));
                            if (m != null) view.LoadMilestone(m);
                        }
                        else if (tag.StartsWith("git-detail:epic:", StringComparison.OrdinalIgnoreCase))
                        {
                            if (int.TryParse(tag.Substring("git-detail:epic:".Length), out int num))
                            {
                                var issue = LeftSidebar.BuildDetailIssue(num);
                                if (issue != null)
                                {
                                    var todoNumbers = LeftSidebar.CurrentBoardIssues.Where(i => i.IsTodo).Select(i => i.Number).ToHashSet();
                                    var linkedChat = LeftSidebar.FindChatForIssue(issue.IssueNumber);
                                    view.LoadEpic(issue, todoNumbers, linkedChat);
                                }
                            }
                        }
                        else if (tag.StartsWith("git-detail:issue:", StringComparison.OrdinalIgnoreCase))
                        {
                            if (int.TryParse(tag.Substring("git-detail:issue:".Length), out int num))
                            {
                                var issue = LeftSidebar.BuildDetailIssue(num);
                                if (issue != null)
                                {
                                    var (epicNumber, epicTitle) = ResolveLinkedEpic(issue);
                                    view.LoadIssue(issue, epicNumber, epicTitle);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
