using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    /// <summary>Git #1710 — one AI Batter Up row bound into <see cref="AiBatterUpPanel"/>'s list.</summary>
    public class AiBatterUpRowVm
    {
        public int Number { get; set; }
        public string ItemId { get; set; } = "";
        public string HeaderText { get; set; } = "";
        public string DetailText { get; set; } = "";
        public string StatusText { get; set; } = "";
    }

    /// <summary>
    /// Git #1710 — additive "AI Batter Up" review panel, polled independently from
    /// #1709's Batter Up panel. Shows every open issue currently sitting in the real
    /// "AI Batter Up" project-board status (agent-filed findings awaiting Shane's
    /// Yes/No — CLAUDE.md's "Board status" routing rule). Yes promotes the item's
    /// Status to real "Batter Up" and leaves it there — it does NOT queue or launch
    /// anything; #1709's BatterUpPanel picks the promoted item up on its own next
    /// refresh. No demotes to "Backlog". Never touches BuildQueuePanel, BatterUpPanel,
    /// or BuildQueuePostgresClient.
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
                (RowsList.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed);
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
                    RowsList.ItemsSource = null;
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
                    RowsList.ItemsSource = null;
                    TxtEmpty.Text = $"Couldn't read AI Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                var vms = rows.Select(ToVm).ToList();
                RowsList.ItemsSource = vms;
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

        private async void BtnYes_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not AiBatterUpRowVm vm) return;
            await ApplyDecisionAsync(btn, vm, promote: true);
        }

        private async void BtnNo_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not AiBatterUpRowVm vm) return;
            await ApplyDecisionAsync(btn, vm, promote: false);
        }

        /// <summary>
        /// Applies Shane's real decision: Yes flips Status → "Batter Up" (never launches
        /// anything itself — see class docs), No flips it → "Backlog". Either way this
        /// item leaves the AI Batter Up queue, so a refresh removes its row.
        /// </summary>
        private async System.Threading.Tasks.Task ApplyDecisionAsync(Button source, AiBatterUpRowVm vm, bool promote)
        {
            var gh = GetClient();
            if (gh == null) return;

            var parent = source.Parent as Panel;
            if (parent != null) foreach (var child in parent.Children) if (child is Button b) b.IsEnabled = false;

            try
            {
                if (promote)
                    await Services.AiBatterUpQueueService.PromoteToBatterUpAsync(gh, vm.ItemId);
                else
                    await Services.AiBatterUpQueueService.DemoteToBacklogAsync(gh, vm.ItemId);

                Services.ActivityLog.Log("ai-batter-up",
                    $"#{vm.Number} — {(promote ? "YES: promoted to Batter Up" : "NO: demoted to Backlog")}.");
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("ai-batter-up", $"#{vm.Number} — decision FAILED: {ex.Message}");
                MessageBox.Show($"Couldn't update #{vm.Number} on GitHub: {ex.Message}", "AI Batter Up",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                if (parent != null) foreach (var child in parent.Children) if (child is Button b) b.IsEnabled = true;
                return;
            }

            await RefreshAsync();
        }

        private static AiBatterUpRowVm ToVm(Services.AiBatterUpRow r)
        {
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

            return new AiBatterUpRowVm
            {
                Number = r.Number,
                ItemId = r.ItemId,
                HeaderText = $"#{r.Number} {r.Title}",
                DetailText = string.Join("  ·  ", detailParts),
            };
        }
    }
}
