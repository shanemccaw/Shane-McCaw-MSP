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
        /// <summary>The achievements chip was clicked — show the earned list.</summary>
        public event Action? AchievementsRequested;
        /// <summary>The ⛶ Immersive button was clicked — MainWindow engages the full-screen immersive view.</summary>
        public event Action? ImmersiveRequested;
        /// <summary>An in-progress chat chip was clicked in the bar — open/switch to that chat tab.</summary>
        public event Action<PersistedInProgressChat>? InProgressChatActivated;
        /// <summary>Git #2663 — "Replace with active tab" was chosen on an in-progress chip:
        /// MainWindow unmarks this chip's chat and marks whatever chat tab is currently active,
        /// in one action (kills the old open-old-tab → unmark → find-new-tab → mark round trip).</summary>
        public event Action<PersistedInProgressChat>? InProgressChatReplaceRequested;

        public FocusModeBar()
        {
            InitializeComponent();
            Loaded += (_, _) =>
            {
                var svc = FocusModeService.Instance;
                svc.StateChanged += OnStateChanged;
                svc.InProgressChatsChanged += OnInProgressChatsChanged;
                Refresh();
            };
            Unloaded += (_, _) =>
            {
                var svc = FocusModeService.Instance;
                svc.StateChanged -= OnStateChanged;
                svc.InProgressChatsChanged -= OnInProgressChatsChanged;
            };
        }

        private void OnStateChanged() => Dispatcher.Invoke(Refresh);
        private void OnInProgressChatsChanged() => Dispatcher.Invoke(RefreshInProgressChats);

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
            RefreshInProgressChats();

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

        private void RefreshInProgressChats()
        {
            var svc = FocusModeService.Instance;
            // Git #2663 — GLOBAL across both accounts (was Git #1480's per-account filter
            // via svc.InProgressChatsForAccount(CurrentAccountLabel())). A chat marked under
            // one account silently vanished from the strip the moment Shane flipped the
            // title-bar Primary/Secondary toggle — the "chips just disappear on their own"
            // symptom. Showing every marked chat regardless of the active account is the
            // safer default for "why did this disappear." NOTE: this is a judgment-call
            // default per the #2663 dispatch, not a confirmed product decision — if Shane
            // wants per-account scoping back, restore the InProgressChatsForAccount(...) call
            // (and surface an "N more on <other account>" indicator instead of hiding).
            var list = svc.InProgressChats;
            if (list == null || list.Count == 0)
            {
                InProgressStrip.Visibility = Visibility.Collapsed;
                InProgressList.Children.Clear();
                return;
            }

            InProgressStrip.Visibility = Visibility.Visible;
            InProgressList.Children.Clear();

            foreach (var item in list)
            {
                var chip = new Border
                {
                    Background = (Brush)FindResource("Surface0Brush"),
                    BorderBrush = (Brush)FindResource("Surface1Brush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 2, 6, 2),
                    Margin = new Thickness(0, 0, 6, 0),
                    Cursor = Cursors.Hand,
                    ToolTip = $"Click to open \"{item.Title}\""
                };

                var txt = new TextBlock
                {
                    Text = item.Title,
                    FontSize = 10.5,
                    Foreground = (Brush)FindResource("TextBrush"),
                    MaxWidth = 130,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center
                };
                chip.Child = txt;
                chip.MouseLeftButtonUp += (s, e) =>
                {
                    InProgressChatActivated?.Invoke(item);
                };

                // Git #2663 — right-click a chip to swap which chat is "in progress" in ONE
                // action: unmark this chip's chat and mark whatever chat tab is currently
                // active. `item` is captured per-chip (foreach's own loop variable).
                var captured = item;
                var cm = new ContextMenu();
                var miReplace = new MenuItem { Header = "Replace with active tab" };
                miReplace.Click += (_, _) => InProgressChatReplaceRequested?.Invoke(captured);
                cm.Items.Add(miReplace);
                chip.ContextMenu = cm;

                InProgressList.Children.Add(chip);
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
        // Interactions
        // ----------------------------------------------------------------
        private void StartFocusBtn_Click(object sender, RoutedEventArgs e)
        {
            if (MilestoneCombo.SelectedItem is ComboBoxItem item && item.Tag is FocusMilestone m && m.Number.HasValue)
                FocusModeService.Instance.Activate(m.Number, m.Title);
        }

        private void ExitBtn_Click(object sender, RoutedEventArgs e) => FocusModeService.Instance.Deactivate();

        private void ImmersiveBtn_Click(object sender, RoutedEventArgs e) => ImmersiveRequested?.Invoke();

        private void ActiveTitle_Click(object sender, MouseButtonEventArgs e)
        {
            var n = FocusModeService.Instance.ActiveMilestoneNumber;
            if (n.HasValue) MilestoneOpenRequested?.Invoke(n.Value);
        }

        private void AchvChip_Click(object sender, MouseButtonEventArgs e) => AchievementsRequested?.Invoke();
    }
}
