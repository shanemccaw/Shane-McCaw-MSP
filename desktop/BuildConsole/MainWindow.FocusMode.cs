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
    /// This is where the three things only the shell can do live:
    ///   • host the <see cref="FocusModeBar"/> inside the existing single-window layout,
    ///   • answer "is a build running right now?" and capture/restore Shane's exact context,
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
                _focusBar.SuggestionActivated += OnFocusSuggestionActivated;
                _focusBar.MilestoneOpenRequested += OnFocusMilestoneOpen;
                _focusBar.AchievementsRequested += OnFocusAchievementsRequested;
                InsertFocusBar(_focusBar);

                // Subscribe BEFORE Start(): a restored-active milestone fires FilterChanged from
                // inside Start(), and we want that first fan-out to reach the panels.
                // A filter change must HARD re-render every panel (genuinely hide/show).
                FocusModeService.Instance.FilterChanged += OnFocusFilterChanged;

                // Tasteful, non-blocking achievement toast (ToastEngine, never a MessageBox).
                FocusModeService.Instance.AchievementUnlocked += a =>
                    Dispatcher.Invoke(() => ToastEngine.Success($"{a.Emoji} {a.Title}", a.Detail));

                // Real build-complete signal → auto-restore whatever we snapshotted at downtime.
                if (_queueWatcher != null)
                    _queueWatcher.BuildFinished += (id, title, exit) => FocusModeService.Instance.NotifyBuildFinished(id, title, exit);

                // Start the service with the probes only the shell can supply.
                FocusModeService.Instance.Start(
                    Dispatcher,
                    IsAnyBuildRunning,
                    CaptureFocusContext,
                    RestoreFocusContext);

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

        // ---- probes -----------------------------------------------------

        private bool IsAnyBuildRunning()
        {
            // App-owned running processes, OR the queue snapshot showing a running row
            // (covers foreign / standalone-watcher builds too).
            if ((_queueWatcher?.RunningCount ?? 0) > 0) return true;
            try { return BuildQueuePanel.CurrentQueueItems.Any(i => i.Status == "running"); }
            catch { return false; }
        }

        private static readonly Func<MainWindow, TabControl[]> PanesOf =
            mw => new[] { mw.EditorTabs, mw.EditorTabs2, mw.EditorTabs3, mw.EditorTabs4 };

        // ---- context capture / restore (Piece 4) ------------------------

        private FocusContextSnapshot CaptureFocusContext()
        {
            var panes = PanesOf(this);
            var snap = new FocusContextSnapshot { SavedAt = DateTime.Now, LayoutMode = DerivePaneMode() };

            foreach (var kv in _chatTabs)
            {
                var tab = kv.Key;
                if (tab.Tag is not BuildConsole.Services.BoardChat chat) continue;
                int pane = Array.IndexOf(panes, tab.Parent as TabControl);
                if (pane < 0) pane = 0;
                snap.Tabs.Add(new FocusContextTab
                {
                    ConversationId = chat.ConversationId,
                    Title = chat.Title,
                    ClaudeUrl = chat.ClaudeUrl,
                    EpicId = chat.EpicId,
                    IssueGithubNumber = kv.Value.GithubNumber ?? chat.IssueGithubNumber,
                    PaneIndex = pane
                });
            }

            snap.ActivePaneIndex = Math.Max(0, Array.IndexOf(panes, _activeEditorPane));

            var (_, activeTab) = GetActiveEditorTabWebView();
            if (activeTab?.Tag is BuildConsole.Services.BoardChat ac)
                snap.ActiveTabConversationId = ac.ConversationId;
            else if (activeTab?.Tag as string == HomeTabTag)
                snap.ActiveTabWasHome = true;

            return snap;
        }

        private void RestoreFocusContext(FocusContextSnapshot snap)
        {
            // Snap Shane back to exactly what he had focused before the quick-task detour.
            if (snap.ActiveTabWasHome) { OpenHomeTab(); return; }

            if (!string.IsNullOrEmpty(snap.ActiveTabConversationId))
            {
                // Prefer re-selecting the still-open tab (it usually never closed).
                foreach (var tab in _chatTabs.Keys.ToList())
                {
                    if (tab.Tag is BuildConsole.Services.BoardChat c && c.ConversationId == snap.ActiveTabConversationId)
                    {
                        if (tab.Parent is TabControl pane)
                        {
                            pane.SelectedItem = tab;
                            _activeEditorPane = pane;
                            tab.Focus();
                        }
                        return;
                    }
                }
                // Closed since capture — reopen from the snapshot.
                var ct = snap.Tabs.FirstOrDefault(t => t.ConversationId == snap.ActiveTabConversationId)
                         ?? snap.Tabs.FirstOrDefault();
                if (ct != null) { ReopenFocusTab(ct); return; }
            }

            var first = snap.Tabs.FirstOrDefault();
            if (first != null) ReopenFocusTab(first);
        }

        private void ReopenFocusTab(FocusContextTab ct)
        {
            OpenChatTab(new BuildConsole.Services.BoardChat
            {
                ConversationId = ct.ConversationId,
                Title = ct.Title,
                ClaudeUrl = ct.ClaudeUrl,
                EpicId = ct.EpicId,
                IssueGithubNumber = ct.IssueGithubNumber
            }, ct.IssueGithubNumber);
        }

        /// <summary>Best-effort layout-mode string from the pane visibility (for the snapshot's
        /// diagnostic record; restore re-selects the active tab rather than rebuilding the split).</summary>
        private string DerivePaneMode()
        {
            bool p2 = EditorTabs2.Visibility == Visibility.Visible;
            bool p3 = EditorTabs3.Visibility == Visibility.Visible;
            bool p4 = EditorTabs4.Visibility == Visibility.Visible;
            if (p2 && p3 && p4) return "Grid4";
            if (p3) return "SplitV";
            if (p2) return "SplitH";
            return "single";
        }

        // ---- filter fan-out (Piece 2) -----------------------------------

        private void OnFocusFilterChanged()
        {
            Dispatcher.Invoke(() =>
            {
                try { LeftSidebar.ReapplyFocusFilter(); } catch { }
                try { _ = BuildQueuePanel.RefreshAsync(); } catch { }  // local dev-server queue, no GitHub
                // Re-render Home from the LOCAL queue + already-known open-issue set so the filter
                // applies immediately. force:false deliberately avoids any gh/GitHub call (Shane's
                // manual-refresh-only rule); clearing the signature defeats the anti-flicker guard
                // so the re-render actually happens even though the queue data itself didn't change.
                try { _homeRollupSignature = null; _ = RefreshHomeRollupAsync(); } catch { }
            });
        }

        // ---- bar intents ------------------------------------------------

        private void OnFocusSuggestionActivated(FocusSuggestion s)
        {
            // Open the quick task, then tell the service he engaged it — it stops nagging and
            // keeps the saved context pending until the build finishes (or he hits "back").
            OpenChatForIssue(s.IssueNumber);
            FocusModeService.Instance.SuggestionTaken(s.IssueNumber);
        }

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
