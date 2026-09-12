using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3700 (sub-issue of Feature #1788) — real, always-visible surfacing for items sitting
    /// in the board's "Ask Shane" status. Confirmed real gap: zero surfacing mechanism existed
    /// before this (#3577's real incident — "this same circle happens", Shane's own words). Applies
    /// the same already-proven principle #3624/#3626 established for "Blocked" visibility: never
    /// gated behind a specific status or view, always surfaced.
    ///
    /// Reuses the exact mirror-driven poll shape <see cref="Services.AiBatterUpQueueService"/> /
    /// <see cref="Controls.AiBatterUpPanel"/> already established (Git #3253/#3335/#3469) — react
    /// to <see cref="Services.GitHubIssueMirror.SyncCompleted"/> instead of a second polling timer,
    /// subscribed once in the constructor and never unsubscribed (this is an app-lifetime
    /// singleton's own wiring, not a document-tab Loaded/Unloaded hook). Unlike those two panels,
    /// there is no document tab here at all — just the title-bar badge (issue's ask #1), the
    /// transition toast (ask #2, the most important piece per the dispatch), the Build Queue
    /// card label (ask #3, wired via <see cref="Controls.BuildQueuePanel.ApplyAskShaneSet"/>), and
    /// click-through navigation (ask #4, reusing #3599's <see cref="Controls.BuildQueuePanel.RevealQueueItem"/>).
    /// </summary>
    public partial class MainWindow
    {
        /// <summary>The real, live "Ask Shane" items as of the last successful poll.</summary>
        private List<AskShaneItem> _askShaneItems = new();

        /// <summary>Git #3700 — the issue numbers seen on the PREVIOUS poll, so a fresh poll can
        /// diff and fire a toast only for a genuine transition INTO the status, not for every item
        /// already sitting there at app start (that would toast the entire standing backlog on
        /// every cold start, not "the moment it happens").</summary>
        private HashSet<int> _lastKnownAskShaneNumbers = new();

        /// <summary>True until the first poll lands. The first poll seeds the baseline silently —
        /// only the SECOND poll onward can detect a real transition.</summary>
        private bool _askShaneFirstPollDone;

        /// <summary>Called once from the same constructor phase as WireBatterUpTitleBarCounts.</summary>
        private void InitializeAskShaneMonitor()
        {
            Services.GitHubIssueMirror.SyncCompleted += OnAskShaneMirrorSyncCompleted;
            _ = RefreshAskShaneAsync();
        }

        private void OnAskShaneMirrorSyncCompleted()
        {
            Dispatcher.InvokeAsync(async () => await RefreshAskShaneAsync());
        }

        private async Task RefreshAskShaneAsync()
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    UpdateAskShaneBadge(new List<AskShaneItem>());
                    return;
                }

                var gh = new GitHubApiClient(settings.GitHubPat);
                var items = await AskShaneMonitorService.GetOpenItemsAsync(gh);
                var currentNumbers = items.Select(i => i.Number).ToHashSet();

                // Git #3700 — the real notification-timing piece: fires a persistent, click-through
                // toast (ToastEngine.ShowPersistent, same shape as the #3518 reconciliation-summary
                // and #1636 priority-build-set toasts already use) for every issue newly present in
                // this poll's set that wasn't in the previous one. Never fires on the first poll —
                // that's the standing backlog at app start, not a fresh transition.
                if (_askShaneFirstPollDone)
                {
                    var newlyAsking = items.Where(i => !_lastKnownAskShaneNumbers.Contains(i.Number)).ToList();
                    foreach (var item in newlyAsking)
                    {
                        var captured = item;
                        ToastEngine.ShowPersistent(
                            "❓ Needs your decision",
                            $"#{captured.Number} — {captured.Title}",
                            ToastKind.Warning,
                            onClick: () => NavigateToAskShaneItem(captured));
                        ActivityLog.Log("ask-shane", $"#{captured.Number} transitioned into Ask Shane — toast fired.");
                    }
                }

                _askShaneFirstPollDone = true;
                _lastKnownAskShaneNumbers = currentNumbers;
                _askShaneItems = items;
                UpdateAskShaneBadge(items);

                // Git #3700 — feeds the Build Queue Panel's card treatment (ask #3): a card whose
                // real GitHub issue is in this set shows "❓ NEEDS YOUR INPUT" regardless of its own
                // raw queue status, mirroring #3626's no-gating principle for 🔒 BLOCKED.
                try { BuildQueuePanel?.ApplyAskShaneSet(currentNumbers); } catch { }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("ask-shane", $"Refresh failed: {ex.Message}");
            }
        }

        /// <summary>Ask #1 — the persistent, always-visible counter. Absent entirely at zero (not a
        /// static "0" the way Batter Up/AI Batter Up's badges stay), per the issue's own wording.</summary>
        private void UpdateAskShaneBadge(List<AskShaneItem> items)
        {
            if (BtnAskShane == null || TopAskShaneCount == null) return;

            if (items.Count == 0)
            {
                BtnAskShane.Visibility = Visibility.Collapsed;
                TopAskShaneCount.Text = "0";
                return;
            }

            BtnAskShane.Visibility = Visibility.Visible;
            TopAskShaneCount.Text = items.Count.ToString();
            BtnAskShane.ToolTip = items.Count == 1
                ? $"Ask Shane — #{items[0].Number} needs your decision"
                : $"Ask Shane — {items.Count} items need your decision";
        }

        /// <summary>Ask #4 — click-through. A single item navigates directly (nothing to group
        /// with only one real item); several open the Git #3710 Epic-grouped panel instead of the
        /// old flat <c>ContextMenu</c> — "tells me nothing" once there are several real items in
        /// it, per Shane's own words on that issue.</summary>
        private void BtnAskShane_Click(object sender, RoutedEventArgs e)
        {
            if (_askShaneItems.Count == 0) return;

            if (_askShaneItems.Count == 1)
            {
                NavigateToAskShaneItem(_askShaneItems[0]);
                return;
            }

            ShowAskShanePanel();
        }

        /// <summary>Git #3710 — one real, resolved Epic group and the "Ask Shane" items under it,
        /// for the panel below. <see cref="EpicNumber"/> is null for the real "No Epic" bucket (an
        /// item whose issue has no resolvable Epic ancestor) — never a fake/placeholder Epic.</summary>
        private readonly struct AskShaneEpicGroup
        {
            public int SortRank { get; init; }
            public int? EpicNumber { get; init; }
            public string Label { get; init; }
            public List<AskShaneItem> Items { get; init; }
        }

        /// <summary>Git #3710 — replaces the old flat <c>ContextMenu</c> (one <c>MenuItem</c> per
        /// item, each opening the raw GitHub issue page) with a real popup panel: the open "Ask
        /// Shane" items grouped by their resolved Epic — reusing the exact same real
        /// <see cref="Controls.BuildQueuePanel.ResolveEpicForIssue"/> path (wired to
        /// <c>LeftSidebar.GetEpicForIssueNumber</c>, see <c>MainWindow.xaml.cs</c>'s own wiring)
        /// the Build Queue card's own Epic chip (Git #2795) already uses — no second epic-resolution
        /// mechanism invented here. Each item gets a real "✈" airplane button, the same visual/
        /// interaction convention as the Build Queue rollup's own aggregate send button (Git
        /// #1893/#1932/#3605): on click it sends the item's real question/decision text (its issue
        /// body plus its most recent comment — not just the title) into the active Claude chat via
        /// the shared <see cref="SendTextToActiveClaudeChatAsync"/> primitive, instead of opening
        /// GitHub at all. Clicking the row itself (not the airplane) keeps the existing real
        /// navigate-to-item behavior (<see cref="NavigateToAskShaneItem"/>) so nothing that worked
        /// before is lost, only the flat dropdown presentation.</summary>
        private void ShowAskShanePanel()
        {
            var resolveEpic = BuildQueuePanel?.ResolveEpicForIssue;
            var groups = _askShaneItems
                .GroupBy(item =>
                {
                    var epic = resolveEpic?.Invoke(item.Number);
                    return epic != null && !string.IsNullOrWhiteSpace(epic.Title)
                        ? (SortRank: 0, EpicNumber: (int?)epic.GithubNumber, Label: epic.GithubNumber.HasValue ? $"#{epic.GithubNumber} — {epic.Title}" : epic.Title)
                        : (SortRank: 1, EpicNumber: (int?)null, Label: "No Epic");
                })
                .Select(g => new AskShaneEpicGroup
                {
                    SortRank = g.Key.SortRank,
                    EpicNumber = g.Key.EpicNumber,
                    Label = g.Key.Label,
                    Items = g.OrderByDescending(i => i.Number).ToList(),
                })
                .OrderBy(g => g.SortRank)
                .ThenBy(g => g.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var root = new StackPanel { Margin = new Thickness(10, 8, 10, 8) };
            root.Children.Add(new TextBlock
            {
                Text = $"Ask Shane — {_askShaneItems.Count} item(s) need your decision",
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                Margin = new Thickness(0, 0, 0, 6),
            });

            foreach (var group in groups)
            {
                root.Children.Add(new TextBlock
                {
                    Text = group.Label,
                    FontSize = 10.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    Margin = new Thickness(0, 8, 0, 3),
                });

                foreach (var item in group.Items)
                {
                    root.Children.Add(BuildAskShanePanelRow(item));
                }
            }

            var border = new Border
            {
                Background = (Brush)Application.Current.FindResource("MantleBrush"),
                BorderBrush = (Brush)Application.Current.FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                MinWidth = 320,
                MaxWidth = 460,
                MaxHeight = 480,
            };
            border.Child = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Content = root,
            };

            var popup = new Popup
            {
                PlacementTarget = BtnAskShane,
                Placement = PlacementMode.Bottom,
                StaysOpen = false,
                AllowsTransparency = true,
                Child = border,
            };
            popup.IsOpen = true;
        }

        /// <summary>Git #3710 — one real row in the Epic-grouped panel: the item's number/title
        /// (click navigates, same as the old menu item did) plus a real "✈" send button.</summary>
        private UIElement BuildAskShanePanelRow(AskShaneItem item)
        {
            var row = new Grid { Margin = new Thickness(0, 1, 0, 1) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var text = new TextBlock
            {
                Text = $"#{item.Number} — {item.Title}",
                FontSize = 11,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                Cursor = Cursors.Hand,
                ToolTip = "Click to open/reveal this item",
            };
            text.MouseLeftButtonDown += (_, e) =>
            {
                e.Handled = true;
                NavigateToAskShaneItem(item);
            };
            Grid.SetColumn(text, 0);
            row.Children.Add(text);

            var statusText = new TextBlock
            {
                FontSize = 9.5,
                Margin = new Thickness(0, 1, 0, 3),
                TextWrapping = TextWrapping.Wrap,
                Visibility = Visibility.Collapsed,
            };

            var sendButton = new Button
            {
                Content = "✈",
                FontSize = 12,
                Padding = new Thickness(5, 1, 5, 2),
                Margin = new Thickness(6, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Cursor = Cursors.Hand,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                ToolTip = $"Send #{item.Number}'s real question/decision text to the active chat",
            };
            sendButton.Click += async (_, e) =>
            {
                e.Handled = true;
                sendButton.IsEnabled = false;
                await SendAskShaneItemToChatAsync(item, (msg, isError) =>
                {
                    statusText.Text = msg;
                    statusText.Foreground = isError
                        ? (Brush)Application.Current.FindResource("StatusErrorBrush")
                        : (Brush)Application.Current.FindResource("StatusSuccessBrush");
                    statusText.Visibility = Visibility.Visible;
                });
                sendButton.IsEnabled = true;
            };
            Grid.SetColumn(sendButton, 1);
            row.Children.Add(sendButton);

            var wrapper = new StackPanel();
            wrapper.Children.Add(row);
            wrapper.Children.Add(statusText);
            return wrapper;
        }

        /// <summary>Git #3710 — the real send: fetches the item's actual issue body and most recent
        /// comment (never just the title — that's the whole point Shane asked for) and routes the
        /// combined text through the exact same shared <see cref="SendTextToActiveClaudeChatAsync"/>
        /// primitive the Build Queue rollup airplane and SQL Runner's "Send to Chat" already use —
        /// no second send-to-chat mechanism.</summary>
        private async Task SendAskShaneItemToChatAsync(AskShaneItem item, Action<string, bool> showMessage)
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    showMessage("No GitHub PAT configured — can't fetch this item's real question text.", true);
                    return;
                }

                var gh = new GitHubApiClient(settings.GitHubPat);
                var detail = await gh.GetIssueAsync(item.Number);
                var comments = await gh.GetIssueCommentsAsync(item.Number);
                string? latestComment = comments.Count > 0 ? comments[^1].Body : null;

                var sb = new System.Text.StringBuilder();
                sb.Append($"#{item.Number} — {item.Title}");
                if (detail != null && !string.IsNullOrWhiteSpace(detail.Body))
                    sb.Append("\n\n").Append(detail.Body.Trim());
                if (!string.IsNullOrWhiteSpace(latestComment))
                    sb.Append("\n\n---\nLatest comment:\n").Append(latestComment!.Trim());

                await SendTextToActiveClaudeChatAsync(
                    sb.ToString(),
                    showMessage: showMessage,
                    onInserted: null,
                    logChannel: "ask-shane.send-to-chat",
                    whatSingular: "Ask Shane question");
                ActivityLog.Log("ask-shane", $"#{item.Number} — sent real question text to active chat.");
            }
            catch (Exception ex)
            {
                showMessage("Couldn't fetch this item's real question text — send failed.", true);
                ActivityLog.Log("ask-shane", $"#{item.Number} — send-to-chat fetch failed: {ex.Message}");
            }
        }

        /// <summary>Ask #4 — reuses #3599's <see cref="Controls.BuildQueuePanel.RevealQueueItem"/>
        /// cross-filter navigation when this issue also has a live queue row; falls back to opening
        /// the real GitHub issue in the browser when it doesn't (an "Ask Shane" item is frequently a
        /// plain issue with no dispatched build behind it at all).</summary>
        private void NavigateToAskShaneItem(AskShaneItem item)
        {
            try
            {
                var match = BuildQueuePanel?.CurrentQueueItems?.FirstOrDefault(q => q.GithubNumber == item.Number);
                if (match != null)
                {
                    BuildQueuePanel!.RevealQueueItem(match.Id);
                    Activate();
                    return;
                }

                string url = !string.IsNullOrWhiteSpace(item.HtmlUrl)
                    ? item.HtmlUrl
                    : $"https://github.com/{item.RepoOwner}/{item.RepoName}/issues/{item.Number}";
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                ActivityLog.Log("ask-shane", $"#{item.Number} — navigate failed: {ex.Message}");
            }
        }
    }
}
