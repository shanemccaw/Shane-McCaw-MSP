using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
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

        public HomeView() => InitializeComponent();

        // ── Section 0: What's New (real commit titles since last launch, patch-notes style) ──
        /// <summary>
        /// Renders the "What's New" patch-notes bullets from the real commit titles
        /// MainWindow computed via VersionInfo.GetNewCommitTitles (reusing the #992
        /// git-commit-count build number). Video-game-update style: a handful of short
        /// bullets, no rewriting — the commit subjects are already concise. The whole
        /// section stays collapsed when there's nothing new, so a launch with no new
        /// commits shows no empty box. <paramref name="moreCount"/> &gt; 0 means the
        /// list was capped and that many additional changes aren't shown individually.
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

            WhatsNewSection.Visibility = Visibility.Visible;
            ActivityLog.Log("home-screen", $"Rendered 'What's New' {versionLabel} ({titles.Count} item{(titles.Count == 1 ? "" : "s")}{(moreCount > 0 ? $", +{moreCount} more" : "")})");
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

        // ── Section 1: Where you left off (persisted last-launch chat tabs) ──
        public void RenderLeftOff(IReadOnlyList<PersistedChatTab> tabs)
        {
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
        public void RenderRunning(IReadOnlyList<QueueItem> running)
        {
            RunningList.Children.Clear();
            RunningCountText.Text = $"({running.Count})";
            RunningEmpty.Visibility = running.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var item in running)
            {
                var captured = item;
                string when = item.UpdatedAt.HasValue ? $"  ·  updated {item.UpdatedAt.Value.ToLocalTime():MMM d, h:mm tt}" : "";
                string sub = (item.GithubNumber.HasValue ? $"#{item.GithubNumber}  ·  " : "") + "running" + when;

                RunningList.Children.Add(BuildRow(
                    "▶", "#F2CA63",
                    string.IsNullOrWhiteSpace(item.Title) ? "(untitled build)" : item.Title,
                    sub,
                    item.GithubNumber.HasValue ? $"Open the chat linked to #{item.GithubNumber}" : null,
                    (_, _) =>
                    {
                        ActivityLog.Log("home-screen",
                            $"Click-through 'Running now' → chat for #{captured.GithubNumber} \"{captured.Title}\"");
                        RunningItemClicked?.Invoke(this, new HomeQueueClick { GithubNumber = captured.GithubNumber, Title = captured.Title });
                    }));
            }

            ActivityLog.Log("home-screen", $"Rendered 'Running now' ({running.Count})");
        }

        // ── Section 3: Done, waiting for you (done builds whose GitHub issue is still open) ──
        public void RenderDoneWaiting(IReadOnlyList<QueueItem> done)
        {
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

        /// <summary>Builds one clickable roll-up row: colored icon + title (ellipsis) + subtitle, in the shared HomeRow hover style.</summary>
        private Border BuildRow(string icon, string iconHex, string title, string subtitle, string? tooltip, MouseButtonEventHandler onClick)
        {
            var iconBlock = new TextBlock
            {
                Text = icon,
                FontSize = 14,
                Margin = new Thickness(0, 0, 10, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconHex)),
            };

            var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            textStack.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 13,
                Foreground = (Brush)FindResource("TextBrush"),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxWidth = 600,
            });
            textStack.Children.Add(new TextBlock
            {
                Text = subtitle,
                FontSize = 10,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxWidth = 600,
            });

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(iconBlock);
            panel.Children.Add(textStack);

            var row = new Border { Style = (Style)FindResource("HomeRow"), Child = panel };
            if (tooltip != null) row.ToolTip = tooltip;
            row.MouseLeftButtonUp += onClick;
            return row;
        }
    }
}
