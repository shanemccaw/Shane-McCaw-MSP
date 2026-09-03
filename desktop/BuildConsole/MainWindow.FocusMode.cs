using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Focus Mode — MainWindow's integration glue (the ONLY shell-side wiring, kept in
    /// this partial so MainWindow.xaml.cs needs a single call: InitFocusMode()).
    ///
    /// This is where the things only the shell can do live:
    ///   • host the <see cref="FocusModeBar"/> inside the existing single-window layout,
    ///   • fan a filter-change out to every panel and route the bar's open-issue / open-milestone
    ///     intents into real tabs.
    /// The behavioural logic itself all lives in <see cref="FocusModeService"/>.
    /// </summary>
    public partial class MainWindow
    {
        private FocusModeBar? _focusBar;

        private void InitFocusMode()
        {
            try
            {
                _focusBar = new FocusModeBar();
                _focusBar.MilestoneOpenRequested += OnFocusMilestoneOpen;
                _focusBar.AchievementsRequested += OnFocusAchievementsRequested;
                _focusBar.ImmersiveRequested += () => FocusModeService.Instance.EnterImmersive();
                _focusBar.InProgressChatActivated += item =>
                {
                    var boardChat = LeftSidebar.FindChatByConversationId(item.ConversationId) ?? new BuildConsole.Services.BoardChat
                    {
                        ConversationId = item.ConversationId,
                        Title = item.Title,
                        ClaudeUrl = item.ClaudeUrl
                    };
                    OpenChatTab(boardChat, boardChat.IssueGithubNumber);
                };
                _focusBar.InProgressChatReplaceRequested += ReplaceInProgressChatWithActiveTab;
                InsertFocusBar(_focusBar);

                // Subscribe BEFORE Start(): a restored-active milestone fires FilterChanged from
                // inside Start(), and we want that first fan-out to reach the panels.
                // A filter change must HARD re-render every panel (genuinely hide/show).
                FocusModeService.Instance.FilterChanged += OnFocusFilterChanged;

                // Tasteful, non-blocking achievement toast (ToastEngine, never a MessageBox).
                FocusModeService.Instance.AchievementUnlocked += a =>
                    Dispatcher.Invoke(() => ToastEngine.Success($"{a.Emoji} {a.Title}", a.Detail));

                FocusModeService.Instance.Start();

                // Wire the dedicated immersive full-screen view on top of everything above (runs AFTER
                // Start() so the service's persisted state — including whether immersive was engaged — is
                // already loaded and can be restored).
                InitFocusImmersive();

                ActivityLog.Log("focus-mode", "Focus Mode wired into the shell");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("focus-mode", $"InitFocusMode failed: {ex.Message}");
            }
        }

        /// <summary>Git #2663 — the real one-action "Replace" behind an in-progress chip's
        /// right-click "Replace with active tab": unmark the chip's own chat and mark whatever
        /// chat tab is currently active, resolving the active tab's identity through the ONE
        /// shared resolver (<see cref="ResolveChatIdentity"/>) so it stores the chat that tab
        /// really shows. Kills the old open-old-tab → unmark → find-new-tab → mark round trip
        /// Shane described.</summary>
        private void ReplaceInProgressChatWithActiveTab(PersistedInProgressChat oldItem)
        {
            try
            {
                var active = GetActiveChatTab();
                if (active == null)
                {
                    ToastEngine.Warning("Replace In Progress",
                        "No active chat tab — select the chat tab you want to mark In Progress, then try Replace again.");
                    return;
                }
                var (cid, url) = ResolveChatIdentity(active, null, null);
                if (string.IsNullOrEmpty(cid))
                {
                    ToastEngine.Warning("Replace In Progress",
                        "The active tab isn't showing a claude.ai conversation yet — a brand-new chat has no conversation id until its first message is sent.");
                    return;
                }
                if (string.Equals(cid, oldItem.ConversationId, StringComparison.OrdinalIgnoreCase))
                {
                    ToastEngine.Info("Replace In Progress", "That chat is already the active tab — nothing to replace.");
                    return;
                }

                var svc = FocusModeService.Instance;
                // Unmark the old (a chip is In Progress by construction) then mark the new,
                // both through the same service the four entry points use.
                if (svc.IsChatInProgress(oldItem.ConversationId))
                    svc.ToggleChatInProgress(oldItem.ConversationId, oldItem.Title, oldItem.ClaudeUrl);
                var newTitle = (active.Tag as BoardChat)?.Title ?? TabTitleOf(active);
                if (!svc.IsChatInProgress(cid))
                    svc.ToggleChatInProgress(cid, newTitle, url);

                ToastEngine.Success("Replace In Progress", $"Now tracking \"{newTitle}\" (was \"{oldItem.Title}\")");
                ActivityLog.Log("focus-mode",
                    $"Replaced in-progress chat \"{oldItem.Title}\" ({oldItem.ConversationId}) with active tab \"{newTitle}\" ({cid})");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Replace In Progress", $"Failed to replace: {ex.Message}");
            }
        }

        /// <summary>Dock the bar as a full-width strip directly above the main content, inside
        /// the existing frame DockPanel — a single window, no new one.</summary>
        private void InsertFocusBar(FocusModeBar bar)
        {
            var root = Content as Grid;
            var dock = root?.Children.OfType<DockPanel>().FirstOrDefault();
            if (dock != null && dock.Children.Count > 0)
            {
                DockPanel.SetDock(bar, Dock.Top);
                // Insert just before the LastChildFill content so it takes the top of the
                // remaining area (below the menu/toolbar, above the sidebar+editor).
                dock.Children.Insert(dock.Children.Count - 1, bar);
            }
            else if (root != null)
            {
                bar.VerticalAlignment = VerticalAlignment.Top;
                bar.HorizontalAlignment = HorizontalAlignment.Stretch;
                root.Children.Add(bar);
            }
        }

        // ---- filter fan-out (Piece 2) -----------------------------------

        private void OnFocusFilterChanged()
        {
            Dispatcher.Invoke(() =>
            {
                try { LeftSidebar.ReapplyFocusFilter(); } catch { }
                // Cache-only re-render of every Build Queue sub-list (Queue/In-Flight/To-Do/
                // Completed) — NOT RefreshAsync: that re-fetches and its unchanged-data signature
                // guard would skip the re-render, so the focus filter never actually re-applied
                // (the live bug). ReapplyFocusFilter renders from the last-fetched cache, no API/gh.
                try { BuildQueuePanel.ReapplyFocusFilter(); } catch { }
                // Re-render Home from the LOCAL queue + already-known open-issue set so the filter
                // applies immediately. force:false deliberately avoids any gh/GitHub call (Shane's
                // manual-refresh-only rule); clearing the signature defeats the anti-flicker guard
                // so the re-render actually happens even though the queue data itself didn't change.
                try { _homeRollupSignature = null; _ = RefreshHomeRollupAsync(); } catch { }
                // "Where you left off" isn't part of the roll-up (it's rendered once when the Home
                // tab opens), so re-filter it explicitly here from the same persisted snapshot —
                // otherwise that one Home section would stay unfiltered across a focus toggle.
                try { _homeView?.RenderLeftOff(_chatTabsAtLaunch); } catch { }
            });
        }

        // ---- bar intents ------------------------------------------------

        /// <summary>A quick-task suggestion chip was tapped — currently only raised by the immersive
        /// view's empty state (#1874 removed the downtime band, the other former source).</summary>
        private void OnFocusSuggestionActivated(FocusSuggestion s) => OpenChatForIssue(s.IssueNumber);

        private void OnFocusMilestoneOpen(int milestoneNumber)
        {
            var m = LeftSidebar.CurrentMilestones.FirstOrDefault(x => x.GithubNumber == milestoneNumber);
            if (m != null) OpenMilestoneDetailTab(m);
        }

        private void OnFocusAchievementsRequested()
        {
            var list = FocusModeService.Instance.Achievements.OrderByDescending(a => a.UnlockedAt).ToList();
            if (list.Count == 0)
            {
                ToastEngine.Info("🎯 Focus", "No achievements yet — close some issues under your milestone.");
                return;
            }
            var body = string.Join("\n", list.Take(8).Select(a => $"{a.Emoji} {a.Title} — {a.Detail}"));
            ToastEngine.Info($"🎯 Focus achievements ({list.Count}) · {FocusModeService.Instance.Points} pts", body,
                             TimeSpan.FromSeconds(8));
        }
    }
}
