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

        /// <summary>A quick task was tapped — MainWindow opens the issue, then the service restores context.</summary>
        public event Action<FocusSuggestion>? SuggestionActivated;
        /// <summary>The active-milestone chip was clicked — open its detail tab.</summary>
        public event Action<int>? MilestoneOpenRequested;
        /// <summary>The achievements chip was clicked — show the earned list.</summary>
        public event Action? AchievementsRequested;
        /// <summary>The ⛶ Immersive button was clicked — MainWindow engages the full-screen immersive view.</summary>
        public event Action? ImmersiveRequested;

        public FocusModeBar()
        {
            InitializeComponent();
            Loaded += (_, _) =>
            {
                var svc = FocusModeService.Instance;
                svc.StateChanged += OnStateChanged;
                svc.DowntimeChanged += OnDowntimeChanged;
                Refresh();
                RefreshDowntime();
            };
            Unloaded += (_, _) =>
            {
                var svc = FocusModeService.Instance;
                svc.StateChanged -= OnStateChanged;
                svc.DowntimeChanged -= OnDowntimeChanged;
            };
        }

        private void OnStateChanged() => Dispatcher.Invoke(Refresh);
        private void OnDowntimeChanged() => Dispatcher.Invoke(RefreshDowntime);

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

                if (p.Total > 0)
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

                PointsChip.Visibility = svc.Points > 0 ? Visibility.Visible : Visibility.Collapsed;
                PointsText.Text = $"⭐ {svc.Points} pts";

                var latest = svc.Achievements.OrderByDescending(a => a.UnlockedAt).FirstOrDefault();
                if (latest != null)
                {
                    AchvChip.Visibility = Visibility.Visible;
                    AchvText.Text = $"{latest.Emoji} {latest.Title}" + (svc.Achievements.Count > 1 ? $"  (+{svc.Achievements.Count - 1})" : "");
                }
                else AchvChip.Visibility = Visibility.Collapsed;

                int hidden = svc.HiddenIssueCount();
                HiddenText.Text = hidden > 0 ? $"{hidden} hidden" : "";
                HiddenText.ToolTip = hidden > 0 ? $"{hidden} off-milestone issue(s) hidden by focus" : null;
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
            foreach (var m in milestones.Where(m => m.Number.HasValue))
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
        // Downtime panel
        // ----------------------------------------------------------------
        private void RefreshDowntime()
        {
            var svc = FocusModeService.Instance;
            if (!svc.InDowntime || svc.Suggestions.Count == 0)
            {
                DowntimePanel.Visibility = Visibility.Collapsed;
                return;
            }

            DowntimePanel.Visibility = Visibility.Visible;
            DowntimeHeader.Text = $"⏳ Build running — {svc.Suggestions.Count} quick win{(svc.Suggestions.Count == 1 ? "" : "s")} while you wait:";
            SuggestionsPanel.Children.Clear();
            foreach (var s in svc.Suggestions)
                SuggestionsPanel.Children.Add(BuildSuggestionChip(s));
            svc.NoteSuggestionsShown();
        }

        private UIElement BuildSuggestionChip(FocusSuggestion s)
        {
            var content = new StackPanel { Orientation = Orientation.Horizontal };
            content.Children.Add(new TextBlock { Text = s.Emoji + " ", FontSize = 11, VerticalAlignment = VerticalAlignment.Center });
            content.Children.Add(new TextBlock
            {
                Text = $"{s.NumberStr}  {s.Title}",
                FontSize = 11,
                Foreground = Res("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                MaxWidth = 320,
                TextTrimming = TextTrimming.CharacterEllipsis
            });
            if (!string.IsNullOrWhiteSpace(s.Effort))
                content.Children.Add(new TextBlock { Text = $"  ·{s.Effort}", FontSize = 9.5, Foreground = Res("Subtext0Brush"), VerticalAlignment = VerticalAlignment.Center });

            var btn = new Button
            {
                Content = content,
                Margin = new Thickness(0, 0, 8, 6),
                Padding = new Thickness(10, 5, 10, 5),
                Cursor = Cursors.Hand,
                Background = Res("Surface1Brush"),
                BorderThickness = new Thickness(0),
                ToolTip = $"{s.Kind} — open it now; you'll snap back when the build's done",
                Tag = s
            };
            btn.Click += (_, _) => SuggestionActivated?.Invoke(s);
            return btn;
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

        private void ImmersiveBtn_Click(object sender, RoutedEventArgs e) => ImmersiveRequested?.Invoke();

        private void BackNowBtn_Click(object sender, RoutedEventArgs e) => FocusModeService.Instance.RequestRestoreNow();

        private void ActiveTitle_Click(object sender, MouseButtonEventArgs e)
        {
            var n = FocusModeService.Instance.ActiveMilestoneNumber;
            if (n.HasValue) MilestoneOpenRequested?.Invoke(n.Value);
        }

        private void AchvChip_Click(object sender, MouseButtonEventArgs e) => AchievementsRequested?.Invoke();

        /// <summary>App-level brush lookup (works whether or not this control is in the visual tree yet).</summary>
        private static Brush Res(string key) => (Brush)Application.Current.FindResource(key);
    }
}
