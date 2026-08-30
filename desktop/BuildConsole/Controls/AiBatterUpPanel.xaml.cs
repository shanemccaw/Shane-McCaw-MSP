using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1710 — additive "AI Batter Up" review panel, polled independently from
    /// #1709's Batter Up panel. Shows every open issue currently sitting in the real
    /// "AI Batter Up" project-board status (agent-filed findings awaiting Shane's
    /// Yes/No — CLAUDE.md's "Board status" routing rule). Yes promotes the item's
    /// Status to real "Batter Up" and leaves it there — it does NOT queue or launch
    /// anything; #1709's BatterUpPanel picks the promoted item up on its own next
    /// refresh. No demotes to "Backlog". Never touches BuildQueuePanel, BatterUpPanel,
    /// or BuildQueuePostgresClient.
    ///
    /// Git #1803 — rows render via <see cref="BuildAiBatterUpCard"/>, the same card
    /// shell/critter-mascot/status-pill pattern BuildQueuePanel's BuildQueueCard uses,
    /// with Yes/No as real footer actions inside the card instead of a plain-text
    /// ItemsControl row with bare buttons.
    /// </summary>
    public partial class AiBatterUpPanel : UserControl
    {
        private Services.GitHubApiClient? _gh;
        private System.Windows.Threading.DispatcherTimer? _timer;
        private bool _refreshing;

        public AiBatterUpPanel()
        {
            InitializeComponent();
        }

        /// <summary>Called once from MainWindow right after BatterUpPanel.Initialize.</summary>
        public void Initialize()
        {
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

        private Services.GitHubApiClient? GetClient()
        {
            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return null;
            return _gh ??= new Services.GitHubApiClient(settings.GitHubPat);
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_refreshing) return; // a slow GitHub round-trip shouldn't stack on the next timer tick
            _refreshing = true;
            try
            {
                var gh = GetClient();
                if (gh == null)
                {
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    TxtEmpty.Text = "No GitHub PAT configured — set one in Settings.";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                List<Services.AiBatterUpRow> rows;
                try
                {
                    rows = await Services.AiBatterUpQueueService.RefreshAsync(gh);
                }
                catch (Exception ex)
                {
                    Services.ActivityLog.Log("ai-batter-up", $"Refresh failed: {ex.Message}");
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    TxtEmpty.Text = $"Couldn't read AI Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                RowsList.Children.Clear();
                foreach (var row in rows)
                    RowsList.Children.Add(BuildAiBatterUpCard(row));
                TxtCount.Text = rows.Count == 0 ? "" : $"({rows.Count})";

                bool anyVisible = BtnCollapse.IsChecked != true;
                TxtEmpty.Visibility = (rows.Count == 0 && anyVisible) ? Visibility.Visible : Visibility.Collapsed;
                if (rows.Count == 0) TxtEmpty.Text = "No open issues in AI Batter Up.";
            }
            finally
            {
                _refreshing = false;
            }
        }

        /// <summary>
        /// Applies Shane's real decision: Yes flips Status → "Batter Up" (never launches
        /// anything itself — see class docs), No flips it → "Backlog". Either way this
        /// item leaves the AI Batter Up queue, so a refresh removes its row.
        /// </summary>
        private async System.Threading.Tasks.Task ApplyDecisionAsync(StackPanel footer, Services.AiBatterUpRow r, bool promote)
        {
            var gh = GetClient();
            if (gh == null) return;

            foreach (var child in footer.Children) if (child is Button b) b.IsEnabled = false;

            try
            {
                if (promote)
                    await Services.AiBatterUpQueueService.PromoteToBatterUpAsync(gh, r.ItemId);
                else
                    await Services.AiBatterUpQueueService.DemoteToBacklogAsync(gh, r.ItemId);

                Services.ActivityLog.Log("ai-batter-up",
                    $"#{r.Number} — {(promote ? "YES: promoted to Batter Up" : "NO: demoted to Backlog")}.");
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("ai-batter-up", $"#{r.Number} — decision FAILED: {ex.Message}");
                MessageBox.Show($"Couldn't update #{r.Number} on GitHub: {ex.Message}", "AI Batter Up",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                foreach (var child in footer.Children) if (child is Button b) b.IsEnabled = true;
                return;
            }

            await RefreshAsync();
        }

        /// <summary>
        /// Git #1803 — one AI Batter Up row, built in the same card shape as
        /// BuildQueuePanel.BuildQueueCard: status pill + issue-number badge on top, title,
        /// model/effort/buildSet detail line, the same critter mascot on the right (mood
        /// WaitingForInput — this is the one human-gate review queue in the app), and a
        /// real footer action row (Yes/No) styled as card-level buttons instead of bare
        /// buttons floating next to text.
        /// </summary>
        private Border BuildAiBatterUpCard(Services.AiBatterUpRow r)
        {
            var card = BuildQueuePanel.BuildGenericCardShell(isBlocked: false);

            var mainStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
            topRow.Children.Add(BuildQueuePanel.BuildStatusPill("❓ AWAITING REVIEW",
                Color.FromRgb(0x3E, 0x2C, 0x1A), Color.FromRgb(0xF9, 0xE2, 0xAF), Color.FromRgb(0xF9, 0xE2, 0xAF)));

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
                detailParts.Add("no BUILD: comment yet");
            }
            mainStack.Children.Add(new TextBlock
            {
                Text = string.Join("  ·  ", detailParts),
                FontSize = 10,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 0, 4)
            });

            // ── Footer action row: Yes/No as real in-card actions ──
            var footer = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(1, 0, 0, 0) };
            // Git #1810 — de-brightened to match "No"'s calm dark visual weight (same
            // dark-base-with-accent philosophy as #1705): dark Surface0Brush fill instead of a
            // solid bright GreenBrush, with green kept only as the border/text accent so "Yes"
            // still reads as green without being a jarring solid fill.
            var btnYes = new Button
            {
                Content = "Yes",
                Padding = new Thickness(10, 2, 10, 2),
                Margin = new Thickness(0, 0, 6, 0),
                Background = (Brush)Application.Current.FindResource("Surface0Brush"),
                Foreground = (Brush)Application.Current.FindResource("GreenBrush"),
                BorderBrush = (Brush)Application.Current.FindResource("GreenBrush"),
                BorderThickness = new Thickness(1),
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = "Promote to Batter Up"
            };
            btnYes.Click += async (_, _) => await ApplyDecisionAsync(footer, r, promote: true);
            footer.Children.Add(btnYes);

            var btnNo = new Button
            {
                Content = "No",
                Padding = new Thickness(10, 2, 10, 2),
                Background = (Brush)Application.Current.FindResource("Surface0Brush"),
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = "Decline to Backlog"
            };
            btnNo.Click += async (_, _) => await ApplyDecisionAsync(footer, r, promote: false);
            footer.Children.Add(btnNo);
            mainStack.Children.Add(footer);

            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(mainStack, 0);
            cardGrid.Children.Add(mainStack);

            var mascot = BuildQueuePanel.CreateGenericCardMascot(r.Number, BuildQueuePanel.CritterMood.WaitingForInput);
            Grid.SetColumn(mascot, 1);
            cardGrid.Children.Add(mascot);

            card.Child = cardGrid;
            return card;
        }
    }
}
