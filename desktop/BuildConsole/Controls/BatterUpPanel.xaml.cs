using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1709 — additive Batter Up panel. Polls the real project-board "Batter Up"
    /// status on a timer, parses each item's BUILD: comment, and auto-queues anything not
    /// already tracked through <see cref="BatterUpQueueService.RefreshAndAutoQueueAsync"/>
    /// (which itself calls the existing BuildQueuePostgresClient.QueueBuildAsync — the same
    /// pipeline Queue / Send to Builder use). Never touches BuildQueuePanel or its launch
    /// paths; this control only reads GitHub + writes new rows via the same queue client.
    ///
    /// Git #1803 — rows render via <see cref="BuildBatterUpCard"/>, the same card shell/
    /// critter-mascot/status-pill pattern BuildQueuePanel's BuildQueueCard uses, instead of
    /// a plain-text ItemsControl row.
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
                (RowsList.Children.Count == 0 ? Visibility.Visible : Visibility.Collapsed);
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
                    RowsList.Children.Clear();
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
                    RowsList.Children.Clear();
                    TxtEmpty.Text = $"Couldn't read Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                RowsList.Children.Clear();
                foreach (var row in rows)
                    RowsList.Children.Add(BuildBatterUpCard(row));
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

        /// <summary>
        /// Git #1803 — one Batter Up row, built in the same card shape as
        /// BuildQueuePanel.BuildQueueCard: status pill + issue-number badge on top, title,
        /// blocked/model detail line, and the same critter mascot on the right (mood
        /// Blocked when a real open blocker exists, Normal otherwise — "waiting to be
        /// picked up", the same as a freshly queued item).
        /// </summary>
        private static Border BuildBatterUpCard(Services.BatterUpRow r)
        {
            var card = BuildQueuePanel.BuildGenericCardShell(r.IsBlocked);

            var mainStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
            topRow.Children.Add(BuildStatusPill(r));

            var numBadge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1.5, 5, 1.5),
                Margin = new Thickness(6, 0, 0, 0)
            };
            numBadge.Child = new TextBlock
            {
                Text = Services.LocalBuildId.FormatRef(r.Number),
                FontSize = 9.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("PeachBrush")
            };
            topRow.Children.Add(numBadge);
            mainStack.Children.Add(topRow);

            mainStack.Children.Add(new TextBlock
            {
                Text = r.Title,
                FontSize = 11.5,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 1, 0)
            });

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
            mainStack.Children.Add(new TextBlock
            {
                Text = string.Join("  ·  ", detailParts),
                FontSize = 10,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 0, 0)
            });

            if (r.IsBlocked)
            {
                mainStack.Children.Add(new TextBlock
                {
                    Text = $"waiting on #{string.Join(", #", r.OpenBlockedByNumbers)}",
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    Margin = new Thickness(1, 2, 0, 0)
                });
            }

            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(mainStack, 0);
            cardGrid.Children.Add(mainStack);

            var mood = r.IsBlocked ? BuildQueuePanel.CritterMood.Blocked
                : r.JustAutoQueued ? BuildQueuePanel.CritterMood.Done
                : BuildQueuePanel.CritterMood.Normal;
            var mascot = BuildQueuePanel.CreateGenericCardMascot(r.Number, mood, r.IsBlocked);
            Grid.SetColumn(mascot, 1);
            cardGrid.Children.Add(mascot);

            card.Child = cardGrid;
            return card;
        }

        private static Border BuildStatusPill(Services.BatterUpRow r)
        {
            if (!r.HasBuildComment)
                return BuildQueuePanel.BuildStatusPill("NO BUILD",
                    Color.FromRgb(0x21, 0x22, 0x34), Color.FromRgb(0x6C, 0x70, 0x86), Color.FromRgb(0xBA, 0xB4, 0xCD));
            if (r.IsBlocked)
                return BuildQueuePanel.BuildStatusPill("🔒 BLOCKED",
                    Color.FromRgb(0x3A, 0x1E, 0x26), Color.FromRgb(0xF3, 0x8B, 0xA8), Color.FromRgb(0xF3, 0x8B, 0xA8));
            if (r.JustAutoQueued)
                return BuildQueuePanel.BuildStatusPill("✨ QUEUED",
                    Color.FromRgb(0x1C, 0x35, 0x27), Color.FromRgb(0xA6, 0xE3, 0xA1), Color.FromRgb(0xA6, 0xE3, 0xA1));
            if (r.AlreadyTracked)
                return BuildQueuePanel.BuildStatusPill("TRACKED",
                    Color.FromRgb(0x1D, 0x2E, 0x45), Color.FromRgb(0x89, 0xB4, 0xFA), Color.FromRgb(0x89, 0xB4, 0xFA));
            return BuildQueuePanel.BuildStatusPill("⏳ UP NEXT",
                Color.FromRgb(0x21, 0x22, 0x34), Color.FromRgb(0x6C, 0x70, 0x86), Color.FromRgb(0xBA, 0xB4, 0xCD));
        }
    }
}
