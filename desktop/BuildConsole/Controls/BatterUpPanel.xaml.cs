using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>Git #1709 — one Batter Up row bound into <see cref="BatterUpPanel"/>'s list.</summary>
    public class BatterUpRowVm
    {
        public string HeaderText { get; set; } = "";
        public string DetailText { get; set; } = "";
        public string StatusBadgeText { get; set; } = "";
        public Brush StatusBadgeBrush { get; set; } = Brushes.Gray;
    }

    /// <summary>
    /// Git #1709 — additive Batter Up panel. Polls the real project-board "Batter Up"
    /// status on a timer, parses each item's BUILD: comment, and auto-queues anything not
    /// already tracked through <see cref="BatterUpQueueService.RefreshAndAutoQueueAsync"/>
    /// (which itself calls the existing BuildQueuePostgresClient.QueueBuildAsync — the same
    /// pipeline Queue / Send to Builder use). Never touches BuildQueuePanel or its launch
    /// paths; this control only reads GitHub + writes new rows via the same queue client.
    /// </summary>
    public partial class BatterUpPanel : UserControl
    {
        private Services.BuildQueuePostgresClient? _db;
        private System.Windows.Threading.DispatcherTimer? _timer;
        private bool _refreshing;

        /// <summary>Fired after a refresh pass auto-queued one or more rows, so MainWindow can
        /// tell the sibling BuildQueuePanel to repaint — same "best-effort visual refresh"
        /// pattern every other queue-mutating action in this app already follows.</summary>
        public event EventHandler? RowsAutoQueued;

        public BatterUpPanel()
        {
            InitializeComponent();
        }

        /// <summary>Mirrors BuildQueuePanel.Initialize's shape — called once from MainWindow right after BuildQueuePanel.Initialize.</summary>
        public void Initialize(Services.BuildQueuePostgresClient? db)
        {
            _db = db;

            _timer = new System.Windows.Threading.DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(90),
            };
            _timer.Tick += async (_, _) => await RefreshAsync();
            _timer.Start();

            _ = RefreshAsync();
        }

        private async void BtnRefresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

        private void BtnCollapse_Click(object sender, RoutedEventArgs e)
        {
            bool collapsed = BtnCollapse.IsChecked == true;
            RowsScroller.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
            TxtEmpty.Visibility = collapsed ? Visibility.Collapsed :
                (RowsList.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed);
            BtnCollapse.Content = collapsed ? "▸" : "▾";
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_refreshing) return; // a slow GitHub round-trip shouldn't stack on the next timer tick
            _refreshing = true;
            try
            {
                var settings = Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    TxtCount.Text = "";
                    RowsList.ItemsSource = null;
                    TxtEmpty.Text = "No GitHub PAT configured — set one in Settings.";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                var gh = new Services.GitHubApiClient(settings.GitHubPat);
                List<Services.BatterUpRow> rows;
                try
                {
                    rows = await Services.BatterUpQueueService.RefreshAndAutoQueueAsync(
                        gh, _db, msg => Services.ActivityLog.Log("batter-up", msg));
                }
                catch (Exception ex)
                {
                    Services.ActivityLog.Log("batter-up", $"Refresh failed: {ex.Message}");
                    TxtCount.Text = "";
                    RowsList.ItemsSource = null;
                    TxtEmpty.Text = $"Couldn't read Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                var vms = rows.Select(ToVm).ToList();
                RowsList.ItemsSource = vms;
                TxtCount.Text = rows.Count == 0 ? "" : $"({rows.Count})";

                bool anyVisible = BtnCollapse.IsChecked != true;
                TxtEmpty.Visibility = (rows.Count == 0 && anyVisible) ? Visibility.Visible : Visibility.Collapsed;
                if (rows.Count == 0) TxtEmpty.Text = "No open issues in Batter Up.";

                int queuedNow = rows.Count(r => r.JustAutoQueued);
                if (queuedNow > 0)
                {
                    try { RowsAutoQueued?.Invoke(this, EventArgs.Empty); }
                    catch { /* best-effort visual refresh of the sibling queue panel */ }
                }
            }
            finally
            {
                _refreshing = false;
            }
        }

        private static BatterUpRowVm ToVm(Services.BatterUpRow r)
        {
            string header = $"#{r.Number} {r.Title}";
            var detailParts = new List<string>();
            if (r.HasBuildComment)
            {
                detailParts.Add($"{r.Model ?? "default model"} / {r.Effort ?? "default effort"}");
                if (!string.IsNullOrWhiteSpace(r.BuildSet)) detailParts.Add($"buildSet={r.BuildSet}");
            }
            else
            {
                detailParts.Add("no BUILD: comment — not auto-queued");
            }
            if (r.IsBlocked)
                detailParts.Add($"blocked by #{string.Join(", #", r.OpenBlockedByNumbers)}");

            string badge;
            Brush badgeBrush;
            if (!r.HasBuildComment) { badge = "NO BUILD"; badgeBrush = (Brush)Application.Current.FindResource("Subtext0Brush"); }
            else if (r.IsBlocked) { badge = "BLOCKED"; badgeBrush = (Brush)Application.Current.FindResource("RedBrush"); }
            else if (r.JustAutoQueued) { badge = "QUEUED"; badgeBrush = (Brush)Application.Current.FindResource("GreenBrush"); }
            else if (r.AlreadyTracked) { badge = "TRACKED"; badgeBrush = (Brush)Application.Current.FindResource("BlueBrush"); }
            else { badge = ""; badgeBrush = Brushes.Transparent; }

            return new BatterUpRowVm
            {
                HeaderText = header,
                DetailText = string.Join("  ·  ", detailParts),
                StatusBadgeText = badge,
                StatusBadgeBrush = badgeBrush,
            };
        }
    }
}
