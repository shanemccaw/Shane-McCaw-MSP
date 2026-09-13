using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Threading.Tasks;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// The single Focus Mode strip. Self-contained: it subscribes to
    /// <see cref="FocusModeService"/> (the singleton) and re-renders itself; it drives
    /// activation / exit / suggestion resolution back into the service directly. The only
    /// things it can't do itself — open an issue tab, open a milestone tab — it raises as
    /// events for MainWindow to handle inside the existing shell.
    /// </summary>
    public partial class FocusModeBar : UserControl
    {
        private const double TrackWidth = 120;
        private string _pickerSignature = "";
        /// <summary>Git #3906 — true while a manual ETA refresh (triggered by <see cref="EtaRefreshBtn_Click"/>)
        /// has asked the shell to re-run the real underlying board fetch/recompute and is still waiting on
        /// it. Distinct from <see cref="FocusProgress.HasRealCounts"/> (the "never computed yet this
        /// session" cold-board case) — this covers "computed before, recomputing now on demand."</summary>
        private bool _etaRefreshInProgress;

        /// <summary>The active-milestone chip was clicked — open its detail tab.</summary>
        public event Action<int>? MilestoneOpenRequested;
        // Git #3825 — AchievementsRequested/InProgressChatActivated/InProgressChatReplaceRequested
        // were removed here: #3566 already deleted the PointsChip/AchvChip/InProgressStrip UI that
        // used to raise them (nothing in this bar's current XAML can fire them), leaving them as
        // real CS0067 "event never used" warnings. #3566 kept them declared, and MainWindow.FocusMode.cs
        // subscribed, because deleting them meant touching that file too — out of scope then, in
        // scope for this issue. See MainWindow.FocusMode.cs (Git #3825) for the matching removal of
        // the subscriptions and their now-orphaned handlers.
        /// <summary>Git #2708 — the "Open Last Tabs" chip was clicked: MainWindow owns the real
        /// remembered-tab list (_chatTabsAtLaunch) and the reopen logic, so this bar only raises intent.</summary>
        public event Action? OpenLastTabsRequested;

        /// <summary>Git #3906 — the manual ETA-refresh icon was clicked: MainWindow owns the real
        /// recompute (<c>LeftSidebar.PopulateGitTrackerBoardAsync(forceFresh: true)</c>, the same
        /// method a manual Git refresh already runs, which feeds
        /// <see cref="FocusModeService.UpdateBoardSnapshot"/> → the real ETA recompute). Awaited so
        /// this bar can show "Calculating…" for the actual duration of the real fetch, not just a redraw.</summary>
        public event Func<Task>? EtaRefreshRequested;

        /// <summary>Git #2708 — how many remembered tabs from last session are still unrestored.
        /// Pushed in by MainWindow (see <see cref="SetUnrestoredTabCount"/>); &gt; 0 swaps the
        /// "Open Last Tabs" chip in for PointsChip/AchvChip in <see cref="Refresh"/>.</summary>
        private int _unrestoredTabCount;

        public FocusModeBar()
        {
            InitializeComponent();
            Loaded += (_, _) =>
            {
                var svc = FocusModeService.Instance;
                svc.StateChanged += OnStateChanged;
                Refresh();
            };
            Unloaded += (_, _) =>
            {
                var svc = FocusModeService.Instance;
                svc.StateChanged -= OnStateChanged;
            };
        }

        private void OnStateChanged() => Dispatcher.Invoke(Refresh);

        /// <summary>Git #2708 — MainWindow calls this whenever the real unrestored-last-session-tab
        /// count changes (loaded at launch, cleared once reopened or once the user opens any chat
        /// tab manually). No-ops on an unchanged count so it's safe to call freely.</summary>
        public void SetUnrestoredTabCount(int count)
        {
            if (_unrestoredTabCount == count) return;
            _unrestoredTabCount = count;
            Refresh();
        }

        private void OpenLastTabsChip_Click(object sender, MouseButtonEventArgs e) => OpenLastTabsRequested?.Invoke();

        // ----------------------------------------------------------------
        // Main strip
        // ----------------------------------------------------------------
        private void Refresh()
        {
            var svc = FocusModeService.Instance;
            bool active = svc.IsActive;

            PickerPanel.Visibility = active ? Visibility.Collapsed : Visibility.Visible;
            ActivePanel.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
            RightPanel.Visibility = active ? Visibility.Visible : Visibility.Collapsed;

            PopulatePicker(svc.Milestones);

            if (active)
            {
                var p = svc.Progress;
                ActiveTitle.Text = string.IsNullOrWhiteSpace(p.MilestoneTitle) ? svc.ActiveMilestoneTitle : p.MilestoneTitle;

                if (!p.HasRealCounts)
                {
                    // Git #3591 — cold board, no real ALL-states fetch has landed yet this
                    // session. Show an honest loading state rather than GitHub's raw native
                    // open_issues/closed_issues counter, which may include Epic/Feature/
                    // internal-tooling placeholders and briefly show a wrong number.
                    ProgressFill.Width = 0;
                    ProgressText.Text = "loading…";
                    ProgressText.Visibility = Visibility.Visible;
                }
                else if (p.Total > 0)
                {
                    ProgressFill.Width = Math.Max(0, Math.Min(TrackWidth, TrackWidth * p.Percent / 100.0));
                    ProgressText.Text = $"{p.Closed}/{p.Total} · {p.Percent}%";
                    ProgressText.Visibility = Visibility.Visible;
                }
                else
                {
                    ProgressFill.Width = 0;
                    ProgressText.Text = "no issues yet";
                }

                // ETA — Git #3906: a real, visible "Calculating…" state comes first, both for the
                // genuinely-cold-this-session case (!p.HasRealCounts — no ALL-states fetch has landed
                // yet, same signal the progress bar above already uses) and for a manual refresh
                // actually in flight (_etaRefreshInProgress). Only once real data exists do we render
                // a confident ETA, "done", or — Git #3906 part 1 — the honest reason VISIBLY instead of
                // withholding it to a tooltip on blank text nobody sees.
                if (_etaRefreshInProgress || !p.HasRealCounts)
                {
                    EtaText.Text = "Calculating…";
                    EtaText.ToolTip = "Recomputing the real 30-day net-rate ETA from GitHub…";
                }
                else if (p.HasEta && p.Eta.HasValue)
                {
                    EtaText.Text = $"~{FormatEta(p.Eta.Value)} left · {p.IssuesPerDay:0.#}/day net";
                    // Git #3869 — "net" here means closed-minus-created, not gross close rate (the old
                    // wording), so the tooltip stays honest about what the number actually reflects.
                    EtaText.ToolTip = "Estimated at the current net rate (issues closed minus new issues filed)";
                }
                else if (p.Percent >= 100)
                {
                    EtaText.Text = "done 🎉";
                    EtaText.ToolTip = null;
                }
                else
                {
                    // Git #3906 — was: EtaText.Text = ""; the honest reason was withheld to a tooltip
                    // on blank text nobody sees. It must be visible as the primary text now.
                    EtaText.Text = p.EtaReason;
                    EtaText.ToolTip = p.EtaReason;
                }
                EtaRefreshBtn.IsEnabled = !_etaRefreshInProgress;

                // Git #3869 — production-scope toggle: default real count vs. stricter
                // reachable-from-shipping-epics scope.
                bool prodScope = svc.ProductionScopeOnly;
                ScopeToggleText.Text = prodScope ? "PROD" : "ALL";
                ScopeToggleText.Foreground = (Brush)FindResource(prodScope ? "GreenBrush" : "Subtext1Brush");
                ScopeToggle.ToolTip = prodScope
                    ? "Showing production scope only — BuildConsole (#1202), MyArchitect (#3454) and disconnected legacy epics excluded. Click for all real work."
                    : "Showing all real work (Epics/Features filtered, BuildConsole/Admin Panel excluded). Click for production scope only.";

                // Git #2708 — "Open Last Tabs" SWAPS in for Points/Achievement (not stacked
                // alongside them) whenever there's a real unrestored last-session tab set.
                bool showOpenLastTabs = _unrestoredTabCount > 0;
                OpenLastTabsChip.Visibility = showOpenLastTabs ? Visibility.Visible : Visibility.Collapsed;
                OpenLastTabsText.Text = $"↩ Open Last Tabs ({_unrestoredTabCount})";

            }
        }

        private void PopulatePicker(IReadOnlyList<FocusMilestone> milestones)
        {
            // Only rebuild when the set actually changes, so an open dropdown / current
            // selection isn't clobbered on every StateChanged tick.
            var sig = string.Join("|", milestones.Select(m => $"{m.Number}:{m.ClosedIssues}/{m.TotalIssues}"));
            if (sig == _pickerSignature) return;
            _pickerSignature = sig;

            MilestoneCombo.Items.Clear();
            foreach (var m in milestones.Where(m => m.Number.HasValue && !m.IsClosed))
            {
                MilestoneCombo.Items.Add(new ComboBoxItem
                {
                    Content = $"{m.Title}   ({m.ClosedIssues}/{m.TotalIssues})",
                    Tag = m,
                    FontSize = 11
                });
            }
            if (MilestoneCombo.Items.Count > 0 && MilestoneCombo.SelectedIndex < 0)
                MilestoneCombo.SelectedIndex = 0;
        }

        private static string FormatEta(TimeSpan t)
        {
            if (t.TotalDays >= 1) return $"{t.TotalDays:0.#}d";
            if (t.TotalHours >= 1) return $"{t.TotalHours:0.#}h";
            return $"{Math.Max(1, t.TotalMinutes):0}m";
        }

        // ----------------------------------------------------------------
        // Interactions
        // ----------------------------------------------------------------
        private void StartFocusBtn_Click(object sender, RoutedEventArgs e)
        {
            if (MilestoneCombo.SelectedItem is ComboBoxItem item && item.Tag is FocusMilestone m && m.Number.HasValue)
                FocusModeService.Instance.Activate(m.Number, m.Title);
        }

        private void ExitBtn_Click(object sender, RoutedEventArgs e) => FocusModeService.Instance.Deactivate();

        /// <summary>Git #3906 — manual ETA refresh. Raises <see cref="EtaRefreshRequested"/> and awaits
        /// it so "Calculating…" (see <see cref="Refresh"/>) is shown for the real duration of the
        /// underlying recompute MainWindow triggers, not just re-rendering stale cached data.</summary>
        private async void EtaRefreshBtn_Click(object sender, RoutedEventArgs e)
        {
            if (_etaRefreshInProgress) return;
            _etaRefreshInProgress = true;
            Refresh();
            try
            {
                if (EtaRefreshRequested != null) await EtaRefreshRequested.Invoke();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("focus-mode", $"manual ETA refresh failed: {ex.Message}");
            }
            finally
            {
                _etaRefreshInProgress = false;
                Refresh();
            }
        }

        /// <summary>Git #3869 — toggles the milestone tile's production-scope filter. The service
        /// raises StateChanged itself, which drives the actual re-render.</summary>
        private void ScopeToggle_Click(object sender, MouseButtonEventArgs e)
        {
            var svc = FocusModeService.Instance;
            svc.SetProductionScopeOnly(!svc.ProductionScopeOnly);
        }

        private void ActiveTitle_Click(object sender, MouseButtonEventArgs e)
        {
            var n = FocusModeService.Instance.ActiveMilestoneNumber;
            if (n.HasValue) MilestoneOpenRequested?.Invoke(n.Value);
        }
    }
}
