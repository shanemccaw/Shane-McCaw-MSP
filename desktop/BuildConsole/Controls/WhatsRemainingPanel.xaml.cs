using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #4149 — read-only "what's left" document tab. Shane: "I can see 73 items remaining
    /// but no real clear view into what they are." Every real open issue in the active
    /// milestone that counts toward Home's own "remaining" figure
    /// (<see cref="Services.WhatsRemainingService"/> reuses the exact same scope
    /// <see cref="Services.GitHubIssueTimeSeriesService.GetActiveMilestoneSeriesAsync"/> already
    /// defines), grouped by resolved top Epic — no Yes/No, no board-status mutation, this is a
    /// viewer. Opened via MainWindow's own open-or-focus singleton document-tab recipe, the same
    /// as Batter Up / AI Batter Up (see MainWindow.BatterUpTabs.cs).
    /// </summary>
    public partial class WhatsRemainingPanel : UserControl
    {
        private List<Services.WhatsRemainingRow> _allRows = new();

        public WhatsRemainingPanel()
        {
            InitializeComponent();
            IsVisibleChanged += OnIsVisibleChanged;
        }

        /// <summary>Fires every time this document tab becomes visible (opened, or focused after
        /// already being open) — a cheap local-mirror-only read, so re-running it on every focus
        /// costs nothing live and keeps the list from opening onto stale data.</summary>
        private async void OnIsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (IsVisible) await RefreshAsync();
        }

        private async void BtnRefresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

        private Services.GitHubApiClient? GetClient()
        {
            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return null;
            return new Services.GitHubApiClient(settings.GitHubPat);
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            BtnRefresh.IsEnabled = false;
            try
            {
                var result = await Services.WhatsRemainingService.GetRemainingAsync(GetClient());
                if (!result.Success)
                {
                    _allRows = new List<Services.WhatsRemainingRow>();
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    TxtEmpty.Text = $"Couldn't build the remaining list: {result.Reason}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                _allRows = result.Rows.ToList();
                TxtCount.Text = _allRows.Count == 0
                    ? $"— none remaining in \"{result.MilestoneLabel}\""
                    : $"({_allRows.Count}) remaining in \"{result.MilestoneLabel}\"";
                TxtEmpty.Visibility = Visibility.Collapsed;
                Render();
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("whats-remaining", $"Refresh failed: {ex.Message}");
                TxtCount.Text = "";
                RowsList.Children.Clear();
                TxtEmpty.Text = $"Couldn't read What's Remaining: {ex.Message}";
                TxtEmpty.Visibility = Visibility.Visible;
            }
            finally
            {
                BtnRefresh.IsEnabled = true;
            }
        }

        /// <summary>Git #3336-style grouping: one real Epic-header group of rows, "No Epic" always
        /// last. Shared shape with AiBatterUpPanel's own EpicRowGroup, but this panel's own rows
        /// (<see cref="Services.WhatsRemainingRow"/>), not <see cref="Services.AiBatterUpRow"/>.</summary>
        private readonly struct EpicRowGroup
        {
            public int? EpicNumber { get; init; }
            public string Label { get; init; }
            public List<Services.WhatsRemainingRow> Rows { get; init; }
        }

        private static List<EpicRowGroup> GroupByEpic(IEnumerable<Services.WhatsRemainingRow> rows)
        {
            return rows
                .GroupBy(r => r.EpicNumber)
                .OrderBy(g => g.Key.HasValue ? 0 : 1)
                .ThenBy(g => g.Key ?? int.MaxValue)
                .Select(g => new EpicRowGroup
                {
                    EpicNumber = g.Key,
                    Label = g.Key.HasValue ? $"#{g.Key} — {g.First().EpicTitle}" : "No Epic",
                    Rows = g.ToList(),
                })
                .ToList();
        }

        private void Render()
        {
            RowsList.Children.Clear();

            if (_allRows.Count == 0) return;

            foreach (var group in GroupByEpic(_allRows))
            {
                RowsList.Children.Add(EpicGroupHeaderHelper.Build(
                    group.Label, group.Rows.Select(r => r.Number).ToList(),
                    "Check What's Remaining for your issues:"));
                foreach (var row in group.Rows)
                    RowsList.Children.Add(BuildRow(row));
            }
        }

        /// <summary>One plain document row — number, title, real board Status. No card shell, no
        /// mascot, no footer actions: per the issue's own ask, "a document, not a card-shell UI
        /// like the queue panels." Double-click opens the issue on GitHub.</summary>
        private static UIElement BuildRow(Services.WhatsRemainingRow r)
        {
            var grid = new Grid { Margin = new Thickness(2, 3, 2, 3) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var numBadge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1.5, 5, 1.5),
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
            };
            numBadge.Child = new TextBlock
            {
                Text = Services.LocalBuildId.FormatRef(r.Number),
                FontSize = 9.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("PeachBrush"),
            };
            Grid.SetColumn(numBadge, 0);
            grid.Children.Add(numBadge);

            var title = new TextBlock
            {
                Text = r.Title,
                FontSize = 11.5,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(title, 1);
            grid.Children.Add(title);

            var statusBadge = new Border
            {
                Background = (Brush)Application.Current.FindResource("Surface0Brush"),
                BorderBrush = (Brush)Application.Current.FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 1.5, 6, 1.5),
                Margin = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
            };
            statusBadge.Child = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(r.BoardStatus) ? "—" : r.BoardStatus,
                FontSize = 9.5,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
            };
            Grid.SetColumn(statusBadge, 2);
            grid.Children.Add(statusBadge);

            var border = new Border
            {
                Child = grid,
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = r.HtmlUrl,
            };
            if (!string.IsNullOrEmpty(r.HtmlUrl))
            {
                border.MouseLeftButtonUp += (_, _) =>
                {
                    try
                    {
                        var psi = new System.Diagnostics.ProcessStartInfo { FileName = r.HtmlUrl, UseShellExecute = true };
                        System.Diagnostics.Process.Start(psi);
                    }
                    catch { /* best-effort — never blocks the viewer on a launch failure */ }
                };
            }
            return border;
        }
    }
}
