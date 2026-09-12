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
                // Git #3825 — AchievementsRequested/InProgressChatActivated/InProgressChatReplaceRequested
                // subscriptions removed: #3566 deleted the PointsChip/AchvChip/InProgressStrip UI in
                // FocusModeBar that used to raise them, so FocusModeBar no longer declares these events
                // (see its own Git #3825 comment). Their handlers (OnFocusAchievementsRequested,
                // ReplaceInProgressChatWithActiveTab, the inline InProgressChatActivated lambda) were
                // genuinely dead — unreachable from any real UI — and removed with them.
                // Git #2708 — "Open Last Tabs" reuses the SAME real reopen-all logic #2707 built
                // (Home_ReopenAllRequested → Home_ResumeChatRequested per tab → OpenChatTab), fed
                // the same _chatTabsAtLaunch list #2707's Home "Reopen All" button consumes.
                _focusBar.OpenLastTabsRequested += OnFocusOpenLastTabsRequested;
                InsertFocusBar(_focusBar);

                // Seed the bar with the real unrestored-tab count from launch (only entries with
                // a real ClaudeUrl actually get reopened — same skip rule Home_ResumeChatRequested
                // already applies, so the displayed count matches what a click will actually do).
                _focusBar.SetUnrestoredTabCount(_chatTabsAtLaunch.Count(t => !string.IsNullOrWhiteSpace(t.ClaudeUrl)));

                // Subscribe BEFORE Start(): a restored-active milestone fires FilterChanged from
                // inside Start(), and we want that first fan-out to reach the panels.
                // A filter change must HARD re-render every panel (genuinely hide/show).
                FocusModeService.Instance.FilterChanged += OnFocusFilterChanged;

                // Tasteful, non-blocking achievement toast (ToastEngine, never a MessageBox).
                FocusModeService.Instance.AchievementUnlocked += a =>
                    Dispatcher.Invoke(() => ToastEngine.Success($"{a.Emoji} {a.Title}", a.Detail));

                FocusModeService.Instance.Start();

                ActivityLog.Log("focus-mode", "Focus Mode wired into the shell");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("focus-mode", $"InitFocusMode failed: {ex.Message}");
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

        /// <summary>Git #2708 — "Open Last Tabs" chip clicked: reopens every remembered tab via
        /// the SAME real logic #2707 built for Home's "Reopen All" (loops Home_ResumeChatRequested,
        /// same OpenChatTab path, same honest skip/toast for an entry with no ClaudeUrl). The bar's
        /// own count is cleared as soon as ANY chat tab opens (see OpenChatTab), so this call alone
        /// already swaps Points/Achievement back in via the loop's own OpenChatTab calls — the
        /// explicit clear here just covers the edge case of every entry being skipped for a missing
        /// ClaudeUrl (no OpenChatTab call would otherwise fire).</summary>
        private void OnFocusOpenLastTabsRequested()
        {
            Home_ReopenAllRequested(this, _chatTabsAtLaunch);
            _focusBar?.SetUnrestoredTabCount(0);
        }

    }
}
