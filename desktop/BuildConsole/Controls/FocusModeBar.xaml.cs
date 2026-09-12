using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
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

                // ETA — only when the projection cleared its gates (honest, or nothing).
                if (p.HasEta && p.Eta.HasValue)
                    EtaText.Text = $"~{FormatEta(p.Eta.Value)} left · {p.IssuesPerDay:0.#}/day";
                else if (p.Percent >= 100)
                    EtaText.Text = "done 🎉";
                else
                    EtaText.Text = ""; // withheld; tooltip carries the reason
                EtaText.ToolTip = p.HasEta ? "Estimated at the current close rate" : p.EtaReason;

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

        private void ActiveTitle_Click(object sender, MouseButtonEventArgs e)
        {
            var n = FocusModeService.Instance.ActiveMilestoneNumber;
            if (n.HasValue) MilestoneOpenRequested?.Invoke(n.Value);
        }
    }
}
