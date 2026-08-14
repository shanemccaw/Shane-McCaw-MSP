using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>Git #874 Home screen — a click on a "Running now" / "Done, waiting for you"
    /// row, carrying the real GitHub issue number so MainWindow can resolve and open the
    /// originating chat tab (same FindChatForIssue → OpenChatTab path the Build Queue
    /// panel's In-Flight rows already use, #851).</summary>
    public class HomeQueueClick : EventArgs
    {
        public int? GithubNumber { get; init; }
        public string Title { get; init; } = "";
    }

    /// <summary>Home screen "clear stuck build" — a click on the ✕ of a stale/orphaned
    /// "Running now" row, carrying the real queue item id so MainWindow can cancel it
    /// (DELETE queue/{id} via the shared BuildTrackerApiClient.CancelQueueItemAsync — the
    /// same action the Build Queue panel's right-click "✕ Cancel" uses) and refresh.</summary>
    public class HomeStuckItemClear : EventArgs
    {
        public int QueueItemId { get; init; }
        public int? GithubNumber { get; init; }
        public string Title { get; init; } = "";
    }

    /// <summary>
    /// Git #874 Home screen — the native WPF landing tab that replaced the old
    /// hardcoded (non-closable) claude.ai tab. Renders three real-data roll-up
    /// sections and raises click-through events; MainWindow owns the data feed
    /// (persisted last-launch chat tabs + the shared BuildTrackerApiClient queue
    /// + GitHubIssuesService open-issue awareness) and the navigation (OpenChatTab
    /// / FindChatForIssue). All three "moments" log on the home-screen channel:
    /// open (MainWindow.OpenHomeTab), section render (here), and click-through
    /// (here + MainWindow).
    /// </summary>
    public partial class HomeView : UserControl
    {
        /// <summary>"Where you left off" row clicked — reopen the persisted chat.</summary>
        public event EventHandler<PersistedChatTab>? ResumeChatRequested;
        /// <summary>"Running now" row clicked — open the chat linked to that build's GitHub issue.</summary>
        public event EventHandler<HomeQueueClick>? RunningItemClicked;
        /// <summary>"Done, waiting for you" row clicked — open the chat linked to that build's GitHub issue.</summary>
        public event EventHandler<HomeQueueClick>? DoneItemClicked;
        /// <summary>A stale/orphaned "Running now" row's ✕ clicked — cancel that queue item and refresh.</summary>
        public event EventHandler<HomeStuckItemClear>? ClearStuckItemRequested;

        /// <summary>A "running" queue item whose last update is at least this old (or which has
        /// no update timestamp at all) is treated as a stale orphan — the exact failure Shane
        /// saw: builds queued during last night's network outage that never completed but still
        /// report "running" hours later. An hour is comfortably longer than any genuine build.</summary>
        private const int StaleRunningMinutes = 60;

        public HomeView() => InitializeComponent();

        // ── Section 0: What's New (real commit titles since last launch, patch-notes style) ──
        /// <summary>
        /// Renders the "What's New" patch-notes bullets from the real commit titles
        /// MainWindow computed via VersionInfo.GetNewCommitTitles (reusing the #992
        /// git-commit-count build number). ADHD-scroll redesign: the section is now a
        /// single collapsed-by-default quiet count-badge tile ("N changes since you last
        /// looked"); the real full bullet list lives inside the attached content and only
        /// shows once Shane clicks the tile — so a launch with 14+ new commits no longer
        /// forces a long scroll past everything actionable. The whole section stays
        /// collapsed (invisible) when there's nothing new. <paramref name="moreCount"/>
        /// &gt; 0 means the list was capped and that many additional changes aren't shown
        /// individually.
        /// </summary>
        public void RenderWhatsNew(string versionLabel, IReadOnlyList<string> titles, int moreCount = 0)
        {
            WhatsNewList.Children.Clear();

            if (titles == null || titles.Count == 0)
            {
                WhatsNewSection.Visibility = Visibility.Collapsed;
                return;
            }

            WhatsNewVersionText.Text = versionLabel;

            foreach (var title in titles)
                WhatsNewList.Children.Add(BuildBullet(title));

            if (moreCount > 0)
            {
                var more = BuildBullet($"…and {moreCount} more change{(moreCount == 1 ? "" : "s")}");
                // The "…and N more" line reads as a quiet aside, not another change.
                ((TextBlock)((StackPanel)((Border)more).Child).Children[1]).FontStyle = FontStyles.Italic;
                WhatsNewList.Children.Add(more);
            }

            // Quiet one-line summary on the collapsed tile — the whole point of the
            // redesign: glance the count, expand only if you actually want the detail.
            int total = titles.Count + moreCount;
            WhatsNewSummaryText.Text = $"{total} change{(total == 1 ? "" : "s")} since you last looked";
            WhatsNewTile.IsChecked = false;                       // collapsed by default
            WhatsNewContent.Visibility = Visibility.Collapsed;

            WhatsNewSection.Visibility = Visibility.Visible;
            ActivityLog.Log("home-screen", $"Rendered 'What's New' {versionLabel} — collapsed summary ({total} change{(total == 1 ? "" : "s")}, {titles.Count} shown{(moreCount > 0 ? $" +{moreCount} more" : "")})");
        }

        /// <summary>Toggle the What's New full list open/closed in place (same #874 QuietTile
        /// expand behavior the Build Queue panel's In-Flight/Completed tiles use).</summary>
        private void WhatsNewTile_Click(object sender, RoutedEventArgs e)
        {
            bool expand = WhatsNewTile.IsChecked == true;
            WhatsNewContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
                ActivityLog.Log("home-screen", "Expanded 'What's New' full list");
        }

        /// <summary>One light patch-notes bullet: a muted "•" glyph + the raw commit title (wraps, no click, no hover chrome — this is read-only, unlike the roll-up rows below).</summary>
        private Border BuildBullet(string text)
        {
            var dot = new TextBlock
            {
                Text = "•",
                FontSize = 13,
                Margin = new Thickness(2, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#C6A0F6")),
            };
            var body = new TextBlock
            {
                Text = text,
                FontSize = 12,
                Foreground = (Brush)FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                MaxWidth = 660,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(dot);
            panel.Children.Add(body);
            return new Border { Padding = new Thickness(0, 2, 0, 2), Child = panel };
        }

        /// <summary>Focus Mode diagnostics — when a milestone is active and this Home section
        /// actually hid something, record the shown/hidden split on the focus-mode channel so a
        /// future regression (the filter silently not applying) is caught by comparing this against
        /// what actually rendered. Silent off-focus and when nothing was hidden, to avoid noise on
        /// the roll-up's normal ticks.</summary>
        private static void LogFocusHidden(string section, int before, int after)
        {
            var focus = FocusModeService.Instance;
            if (focus.IsActive && after < before)
                ActivityLog.Log("focus-mode", $"Home '{section}' — {after} shown, {before - after} hidden by focus");
        }

        // ── Section 1: Where you left off (persisted last-launch chat tabs) ──
        public void RenderLeftOff(IReadOnlyList<PersistedChatTab> tabs)
        {
            // Focus Mode — while a milestone is active, the Home tab only shows on-milestone work.
            int beforeFocus = tabs.Count;
            tabs = tabs.Where(t => FocusModeService.Instance.IsIssueInFocus(t.IssueGithubNumber)).ToList();
            LogFocusHidden("Where you left off", beforeFocus, tabs.Count);
            LeftOffList.Children.Clear();
            LeftOffCountText.Text = $"({tabs.Count})";
            LeftOffEmpty.Visibility = tabs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var tab in tabs)
            {
                var captured = tab;
                string sub =
                    (tab.IssueGithubNumber.HasValue ? $"#{tab.IssueGithubNumber}  ·  " : "") +
                    $"pane {tab.PaneIndex + 1}  ·  left off {tab.SavedAt.ToLocalTime():MMM d, h:mm tt}";

                LeftOffList.Children.Add(BuildRow(
                    "🕘", "#8FA6C4",
                    string.IsNullOrWhiteSpace(tab.Title) ? "(untitled chat)" : tab.Title,
                    sub,
                    string.IsNullOrWhiteSpace(tab.ClaudeUrl) ? null : tab.ClaudeUrl,
                    (_, _) =>
                    {
                        ActivityLog.Log("home-screen",
                            $"Click-through 'Where you left off' → resume chat \"{captured.Title}\"" +
                            (captured.IssueGithubNumber.HasValue ? $" (#{captured.IssueGithubNumber})" : ""));
                        ResumeChatRequested?.Invoke(this, captured);
                    }));
            }

            ActivityLog.Log("home-screen", $"Rendered 'Where you left off' ({tabs.Count})");
        }

        // ── Section 2: Running now (live queue — same source as the Build Queue panel) ──
        /// <summary>
        /// Renders the live "running" queue rows, flagging stale orphans. A row whose last
        /// update is ≥<see cref="StaleRunningMinutes"/> old (or which has no timestamp at all)
        /// is rendered with a ⚠ amber treatment and a "no update in Xh — likely stuck"
        /// subtitle instead of looking identical to a genuinely active build, and carries a
        /// ✕ clear button that cancels the orphaned queue item. This is the exact bug Shane
        /// hit: builds queued during a network outage that never completed but still say
        /// "running" hours later, with no way to tell they're dead or to clear them.
        /// </summary>
        public void RenderRunning(IReadOnlyList<QueueItem> running)
        {
            int beforeFocus = running.Count;
            running = running.Where(i => FocusModeService.Instance.IsIssueInFocus(i.GithubNumber)).ToList();
            LogFocusHidden("Running now", beforeFocus, running.Count);
            RunningList.Children.Clear();

            int staleCount = 0;
            foreach (var item in running)
            {
                var captured = item;
                bool stale = IsRunningStale(item.UpdatedAt);
                if (stale) staleCount++;

                string numPrefix = item.GithubNumber.HasValue ? $"#{item.GithubNumber}  ·  " : "";
                string sub;
                if (stale)
                {
                    sub = numPrefix + "⚠ " + StuckPhrase(item.UpdatedAt) + " — likely stuck";
                }
                else
                {
                    string when = item.UpdatedAt.HasValue ? $"  ·  updated {item.UpdatedAt.Value.ToLocalTime():MMM d, h:mm tt}" : "";
                    sub = numPrefix + "running" + when;
                }

                // Only stale rows get a clear (✕) affordance — an actively-running build
                // must not be casually cancellable from a glance screen.
                Action? onClear = null;
                if (stale)
                {
                    onClear = () =>
                    {
                        ActivityLog.Log("home-screen",
                            $"Clear stuck 'Running now' item → cancel queue #{captured.Id}" +
                            (captured.GithubNumber.HasValue ? $" (Git #{captured.GithubNumber})" : "") +
                            $" \"{captured.Title}\"");
                        ClearStuckItemRequested?.Invoke(this, new HomeStuckItemClear
                        {
                            QueueItemId = captured.Id,
                            GithubNumber = captured.GithubNumber,
                            Title = captured.Title,
                        });
                    };
                }

                RunningList.Children.Add(BuildRow(
                    stale ? "⚠" : "▶",
                    stale ? "#EE99A0" : "#F2CA63",
                    string.IsNullOrWhiteSpace(item.Title) ? "(untitled build)" : item.Title,
                    sub,
                    item.GithubNumber.HasValue ? $"Open the chat linked to #{item.GithubNumber}" : null,
                    (_, _) =>
                    {
                        ActivityLog.Log("home-screen",
                            $"Click-through 'Running now' → chat for #{captured.GithubNumber} \"{captured.Title}\"");
                        RunningItemClicked?.Invoke(this, new HomeQueueClick { GithubNumber = captured.GithubNumber, Title = captured.Title });
                    },
                    onClear: onClear,
                    stale: stale));
            }

            // Count badge notes stuck orphans and turns amber, so the glance itself says
            // "some of these aren't really running" without expanding anything.
            if (staleCount > 0)
            {
                RunningCountText.Text = $"({running.Count}  ·  {staleCount} stuck)";
                RunningCountText.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EE99A0"));
            }
            else
            {
                RunningCountText.Text = $"({running.Count})";
                RunningCountText.Foreground = (Brush)FindResource("Subtext1Brush");
            }

            RunningEmpty.Visibility = running.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            if (staleCount > 0)
                ActivityLog.Log("home-screen", $"Flagged {staleCount} 'Running now' item{(staleCount == 1 ? "" : "s")} as likely stale/orphaned (no update ≥{StaleRunningMinutes}m)");

            ActivityLog.Log("home-screen", $"Rendered 'Running now' ({running.Count}{(staleCount > 0 ? $", {staleCount} stuck" : "")})");
        }

        /// <summary>A running item is stale when its last update is at least StaleRunningMinutes old — or when it carries no update timestamp at all, since then we can't confirm it's still alive.</summary>
        private static bool IsRunningStale(DateTimeOffset? updatedAt)
        {
            if (!updatedAt.HasValue) return true;
            return (DateTimeOffset.Now - updatedAt.Value).TotalMinutes >= StaleRunningMinutes;
        }

        /// <summary>Human "no update in …" phrasing for a stale row's subtitle.</summary>
        private static string StuckPhrase(DateTimeOffset? updatedAt)
        {
            if (!updatedAt.HasValue) return "no recent activity";
            var age = DateTimeOffset.Now - updatedAt.Value;
            if (age.TotalHours >= 24) { int d = (int)age.TotalDays; return $"no update in {d} day{(d == 1 ? "" : "s")}"; }
            if (age.TotalHours >= 1) { int h = (int)age.TotalHours; return $"no update in {h}h"; }
            int m = Math.Max(1, (int)age.TotalMinutes);
            return $"no update in {m}m";
        }

        // ── Section 3: Done, waiting for you (done builds whose GitHub issue is still open) ──
        public void RenderDoneWaiting(IReadOnlyList<QueueItem> done)
        {
            int beforeFocus = done.Count;
            done = done.Where(i => FocusModeService.Instance.IsIssueInFocus(i.GithubNumber)).ToList();
            LogFocusHidden("Done, waiting for you", beforeFocus, done.Count);
            DoneList.Children.Clear();
            DoneCountText.Text = $"({done.Count})";
            DoneEmpty.Visibility = done.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            UpdateDoneAnnounce(done.Count);

            foreach (var item in done)
            {
                var captured = item;
                string when = item.UpdatedAt.HasValue ? item.UpdatedAt.Value.ToLocalTime().ToString("MMM d, h:mm tt") : "unknown time";
                string sub = (item.GithubNumber.HasValue ? $"#{item.GithubNumber}  ·  " : "") + $"done {when}  ·  click to open chat";

                DoneList.Children.Add(BuildRow(
                    "✅", "#7FAE91",
                    string.IsNullOrWhiteSpace(item.Title) ? "(untitled build)" : item.Title,
                    sub,
                    item.GithubNumber.HasValue ? $"Open the chat linked to #{item.GithubNumber}" : null,
                    (_, _) =>
                    {
                        ActivityLog.Log("home-screen",
                            $"Click-through 'Done, waiting for you' → chat for #{captured.GithubNumber} \"{captured.Title}\"");
                        DoneItemClicked?.Invoke(this, new HomeQueueClick { GithubNumber = captured.GithubNumber, Title = captured.Title });
                    }));
            }

            ActivityLog.Log("home-screen", $"Rendered 'Done, waiting for you' ({done.Count})");
        }

        /// <summary>Git #874/#905 — the Done section announces itself with the app's PeachBrush accent once there's something to act on, matching the Build Queue panel's Completed/To-Do tiles; neutral at 0.</summary>
        private void UpdateDoneAnnounce(int count)
        {
            if (count > 0)
            {
                var peach = (Brush)Application.Current.FindResource("PeachBrush");
                DoneIcon.Foreground = peach;
                DoneHeaderText.Foreground = peach;
                DoneCountText.Foreground = peach;
            }
            else
            {
                DoneIcon.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#7FAE91"));
                DoneHeaderText.ClearValue(TextBlock.ForegroundProperty);   // back to the HomeSectionHeader style's Subtext1
                DoneCountText.Foreground = (Brush)Application.Current.FindResource("Subtext1Brush");
            }
        }

        /// <summary>
        /// Builds one clickable roll-up row: colored icon + title (ellipsis) + subtitle, in
        /// the shared HomeRow hover style. When <paramref name="onClear"/> is supplied a ✕
        /// button is docked at the right (used only by stale "Running now" rows to cancel the
        /// orphaned queue item); when <paramref name="stale"/> is set the row gets the amber
        /// warning accent (border + subtitle color).
        /// </summary>
        private Border BuildRow(string icon, string iconHex, string title, string subtitle, string? tooltip, MouseButtonEventHandler onClick, Action? onClear = null, bool stale = false)
        {
            var iconBlock = new TextBlock
            {
                Text = icon,
                FontSize = 14,
                Margin = new Thickness(0, 0, 10, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconHex)),
            };
            DockPanel.SetDock(iconBlock, Dock.Left);

            var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            textStack.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 13,
                Foreground = (Brush)FindResource("TextBrush"),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            textStack.Children.Add(new TextBlock
            {
                Text = subtitle,
                FontSize = 10,
                Foreground = stale
                    ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EE99A0"))
                    : (Brush)FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });

            var panel = new DockPanel { LastChildFill = true };
            panel.Children.Add(iconBlock);

            if (onClear != null)
            {
                var clearBtn = new Button
                {
                    Content = "✕",
                    FontSize = 11,
                    Padding = new Thickness(5, 1, 5, 1),
                    Margin = new Thickness(8, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Cursor = Cursors.Hand,
                    ToolTip = "Clear this stuck build (cancels the orphaned queue item)",
                };
                if (TryFindResource("IconButton") is Style ib) clearBtn.Style = ib;
                // The Button captures & handles the mouse-up, so clicking ✕ never also
                // triggers the row's open-chat MouseLeftButtonUp below.
                clearBtn.Click += (_, _) => onClear();
                DockPanel.SetDock(clearBtn, Dock.Right);
                panel.Children.Add(clearBtn);
            }

            panel.Children.Add(textStack);   // LastChildFill — takes the remaining width

            var row = new Border { Style = (Style)FindResource("HomeRow"), Child = panel };
            if (stale)
                row.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EE99A0"));
            if (tooltip != null) row.ToolTip = tooltip;
            row.MouseLeftButtonUp += onClick;
            return row;
        }
    }
}
