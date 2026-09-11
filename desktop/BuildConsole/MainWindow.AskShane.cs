using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
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

        /// <summary>Ask #4 — click-through. A single item navigates directly; several show a small
        /// menu naming each one, click one to navigate to it.</summary>
        private void BtnAskShane_Click(object sender, RoutedEventArgs e)
        {
            if (_askShaneItems.Count == 0) return;

            if (_askShaneItems.Count == 1)
            {
                NavigateToAskShaneItem(_askShaneItems[0]);
                return;
            }

            var menu = new ContextMenu();
            foreach (var item in _askShaneItems.OrderByDescending(i => i.Number))
            {
                var captured = item;
                var mi = new MenuItem { Header = $"#{captured.Number} — {captured.Title}" };
                mi.Click += (_, _) => NavigateToAskShaneItem(captured);
                menu.Items.Add(mi);
            }
            menu.PlacementTarget = BtnAskShane;
            menu.IsOpen = true;
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
