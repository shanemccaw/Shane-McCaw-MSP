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

        /// <summary>Git #4164 — the board-status chips currently toggled ON. Empty means "no
        /// filter" (every status shown), matching the issue's own "Default: all statuses shown"
        /// ask — this is deliberately NOT "all chips pre-selected", since a freshly-populated chip
        /// set with everything pre-toggled would look identical but behave differently once Shane
        /// deselects one. Normalized the same way BuildRow displays a blank status: "—".</summary>
        private readonly HashSet<string> _selectedStatuses = new(StringComparer.OrdinalIgnoreCase);

        public WhatsRemainingPanel()
        {
            InitializeComponent();
            IsVisibleChanged += OnIsVisibleChanged;
        }

        /// <summary>Git #4164 — the real, displayed status key for a row: BuildRow already shows a
        /// blank/null BoardStatus as "—" rather than leaving it empty, so the status filter groups
        /// and matches on that same normalized value instead of a separate blank bucket.</summary>
        private static string NormalizeStatus(string? boardStatus) =>
            string.IsNullOrWhiteSpace(boardStatus) ? "—" : boardStatus;

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
                    UpdateFilterVisibility();
                    TxtEmpty.Text = $"Couldn't build the remaining list: {result.Reason}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                _allRows = result.Rows.ToList();
                TxtCount.Text = _allRows.Count == 0
                    ? $"— none remaining in \"{result.MilestoneLabel}\""
                    : $"({_allRows.Count}) remaining in \"{result.MilestoneLabel}\"";
                TxtEmpty.Visibility = Visibility.Collapsed;
                UpdateFilterVisibility();
                PopulateEpicFilterOptions();
                BuildStatusFilterChips();
                ApplyFilters();
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("whats-remaining", $"Refresh failed: {ex.Message}");
                TxtCount.Text = "";
                RowsList.Children.Clear();
                UpdateFilterVisibility();
                TxtEmpty.Text = $"Couldn't read What's Remaining: {ex.Message}";
                TxtEmpty.Visibility = Visibility.Visible;
            }
            finally
            {
                BtnRefresh.IsEnabled = true;
            }
        }

        /// <summary>Git #4164 — both filter controls show only when there's something to filter
        /// (rows actually loaded), matching AiBatterUpPanel's own #4146/#1863 "nothing to filter"
        /// gate.</summary>
        private void UpdateFilterVisibility()
        {
            var visibility = _allRows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            CmbEpicFilter.Visibility = visibility;
            StatusFilterHost.Visibility = visibility;
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

        /// <summary>
        /// Git #4164 — rebuilds CmbEpicFilter's items from the distinct Epics actually present in
        /// <see cref="_allRows"/> (same shared shape AiBatterUpPanel's #4146 dropdown uses via
        /// <see cref="EpicFilterHelper"/>), with a real "All Epics" default first. Preserves the
        /// currently-selected Epic across a refresh if it's still present; falls back to "All
        /// Epics" otherwise.
        /// </summary>
        private void PopulateEpicFilterOptions()
        {
            var previouslySelected = CmbEpicFilter.SelectedItem is EpicFilterOption prev ? prev : (EpicFilterOption?)null;

            var options = EpicFilterHelper.BuildOptions(
                GroupByEpic(_allRows).Select(g => (g.EpicNumber, g.Label)));

            CmbEpicFilter.ItemsSource = options;
            CmbEpicFilter.SelectedIndex = EpicFilterHelper.ResolveSelectedIndex(options, previouslySelected);
        }

        /// <summary>Git #4164 — the Epic filter combines AND-wise with the status chips (see
        /// ApplyFilters); it never replaces them.</summary>
        private void CmbEpicFilter_SelectionChanged(object sender, SelectionChangedEventArgs e) => ApplyFilters();

        /// <summary>
        /// Git #4164 — rebuilds StatusFilterHost's toggle chips from the distinct real BoardStatus
        /// values actually present in <see cref="_allRows"/> (normalized via
        /// <see cref="NormalizeStatus"/> so a blank status groups under the same "—" BuildRow
        /// already shows) — never a hardcoded status list. Preserves any currently-toggled
        /// selections that are still present; drops ones that vanished (e.g. that status's last
        /// row left the queue).
        /// </summary>
        private void BuildStatusFilterChips()
        {
            var distinctStatuses = _allRows
                .Select(r => NormalizeStatus(r.BoardStatus))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(s => s, StringComparer.OrdinalIgnoreCase)
                .ToList();

            _selectedStatuses.RemoveWhere(s => !distinctStatuses.Contains(s, StringComparer.OrdinalIgnoreCase));

            StatusFilterHost.Children.Clear();
            foreach (var status in distinctStatuses)
                StatusFilterHost.Children.Add(BuildStatusChip(status));
        }

        /// <summary>One toggleable status chip — same badge shape as BuildRow's own per-row status
        /// badge, just clickable. Highlighted (blue border/text) while selected.</summary>
        private Border BuildStatusChip(string status)
        {
            bool isSelected = _selectedStatuses.Contains(status);

            var border = new Border
            {
                Background = (Brush)Application.Current.FindResource(isSelected ? "Surface1Brush" : "Surface0Brush"),
                BorderBrush = (Brush)Application.Current.FindResource(isSelected ? "BlueBrush" : "Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(7, 2.5, 7, 2.5),
                Margin = new Thickness(0, 0, 6, 6),
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = isSelected ? $"Showing only \"{status}\" — click to remove" : $"Click to show only \"{status}\"",
            };
            border.Child = new TextBlock
            {
                Text = status,
                FontSize = 10.5,
                Foreground = (Brush)Application.Current.FindResource(isSelected ? "BlueBrush" : "Subtext1Brush"),
                FontWeight = isSelected ? FontWeights.SemiBold : FontWeights.Normal,
            };
            border.MouseLeftButtonUp += (_, _) =>
            {
                if (!_selectedStatuses.Remove(status)) _selectedStatuses.Add(status);
                BuildStatusFilterChips();
                ApplyFilters();
            };
            return border;
        }

        /// <summary>
        /// Git #4164 — renders <see cref="_allRows"/> narrowed by the Epic filter and the status
        /// chips, combined AND-wise (matching AiBatterUpPanel's own #4146 combination rule): an
        /// empty <see cref="_selectedStatuses"/> means "all statuses", a selected Epic narrows to
        /// just that Epic (or "No Epic"). Each Epic group's copy button (EpicGroupHeaderHelper)
        /// copies only the currently-visible (filtered) rows in that group, since it's built from
        /// the already-filtered list.
        /// </summary>
        private void ApplyFilters()
        {
            RowsList.Children.Clear();
            if (_allRows.Count == 0) return;

            IEnumerable<Services.WhatsRemainingRow> visible = _allRows;

            if (CmbEpicFilter.SelectedItem is EpicFilterOption { IsAll: false } epicFilter)
                visible = visible.Where(r => r.EpicNumber == epicFilter.EpicNumber);

            if (_selectedStatuses.Count > 0)
                visible = visible.Where(r => _selectedStatuses.Contains(NormalizeStatus(r.BoardStatus)));

            var visibleList = visible.ToList();
            if (visibleList.Count == 0)
            {
                RowsList.Children.Add(new TextBlock
                {
                    Text = "no rows match the current filters",
                    FontSize = 11,
                    FontStyle = FontStyles.Italic,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    Margin = new Thickness(2, 4, 2, 4),
                });
                return;
            }

            foreach (var group in GroupByEpic(visibleList))
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
