using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3657 (sub-issue of Epic #1202) — Shot Vault window: real runs grouping (newest-first,
    /// <see cref="ShotVaultService.RunGap"/>), real search by filename/screen, real tag filter chips
    /// (multi-select, AND semantics), a thumbnail grid, and the real per-shot Copy action. Every shot
    /// shown here comes straight from <see cref="ShotVaultService.ListShots"/>'s own real read of
    /// <see cref="ShotVaultService.ShotsDirectory"/> — the exact folder
    /// <see cref="DesktopScreenClipService"/>'s own screen-clip capture already writes to. No fixture
    /// rows: an empty vault (nothing captured yet) renders a real, honest empty state naming that same
    /// real directory.
    ///
    /// Ported from ShaneBuilder's MainWindow.ShotVaultPanel.cs behavior. Deliberately NOT ported: DIFF-
    /// from-previous badges, baseline-compare pinning, retention auto-purge, "send to tab" — none of
    /// those are named in #3657's own scoped feature list (search, tag filters, runs, thumbnail grid,
    /// Copy), and #3657 explicitly forbids porting/duplicating the capture mechanism itself.
    /// </summary>
    public partial class ShotVaultWindow : Window
    {
        private const double TileWidth = 150;
        private const double ThumbHeight = 92;

        /// <summary>The currently-active tag filter chips (multi-select, AND semantics: a shot must
        /// carry every active label to show, on top of the current search query).</summary>
        private readonly HashSet<string> _activeTagFilters = new(StringComparer.Ordinal);

        /// <summary>The real search query text, live-applied on every render.</summary>
        private string _searchQuery = "";

        public ShotVaultWindow()
        {
            InitializeComponent();
            Loaded += (_, _) => Render();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "" : "";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }

        private void BtnShotVaultRefresh_Click(object sender, RoutedEventArgs e) => Render();

        private void ShotVaultSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _searchQuery = ShotVaultSearchBox.Text;
            Render();
        }

        /// <summary>The real render pass: re-reads the shots folder, re-derives runs/tags off that real
        /// read, applies the current search + tag filters, and rebuilds the visible run headers +
        /// thumbnail grids. Cheap enough to fully rebuild on every change — a folder of loose PNGs, not
        /// a paginated table.</summary>
        private void Render()
        {
            ShotVaultRows.Children.Clear();
            ShotVaultTagChips.Children.Clear();

            IReadOnlyList<ShotVaultRun> runs;
            try
            {
                runs = ShotVaultService.ListRuns();
            }
            catch (Exception ex)
            {
                ShotVaultStatus.Text = $"Couldn't read the shots folder — {ex.Message}";
                ShotVaultEmptyText.Visibility = Visibility.Collapsed;
                return;
            }

            var allShots = runs.SelectMany(r => r.Shots).ToList();

            if (allShots.Count == 0)
            {
                ShotVaultStatus.Text = "";
                ShotVaultTagChipsRow.Visibility = Visibility.Collapsed;
                ShotVaultEmptyText.Text = $"No shots yet — captures land in {ShotVaultService.ShotsDirectory}.";
                ShotVaultEmptyText.Visibility = Visibility.Visible;
                _activeTagFilters.Clear(); // nothing left to filter against
                return;
            }

            ShotVaultTagChipsRow.Visibility = Visibility.Visible;
            ShotVaultEmptyText.Visibility = Visibility.Collapsed;

            // Real tags per shot — one pass over the real (unfiltered) list.
            var tagsByPath = allShots.ToDictionary(s => s.FilePath, s => ShotVaultService.GetTags(s));

            // Drop any active filter label the current shot set no longer has anything tagged with (a
            // shot behind it may have aged off, or the folder may have been cleared) — an active chip
            // that can never match anything again would otherwise silently hide everything forever.
            var allLabels = tagsByPath.Values.SelectMany(t => t).Select(t => t.Label).ToHashSet(StringComparer.Ordinal);
            _activeTagFilters.RemoveWhere(label => !allLabels.Contains(label));

            RenderTagChips(tagsByPath);

            int totalShots = runs.Sum(r => r.Count);

            string query = _searchQuery.Trim();
            bool tagFiltered = _activeTagFilters.Count > 0;
            bool anyFilterActive = query.Length > 0 || tagFiltered;

            bool MatchesFilter(ShotVaultItem shot) =>
                (query.Length == 0 || ShotVaultService.MatchesQuery(shot, query)) &&
                (!tagFiltered || _activeTagFilters.All(f => tagsByPath[shot.FilePath].Any(t => t.Label == f)));

            IReadOnlyList<ShotVaultRun> visibleRuns = anyFilterActive
                ? ShotVaultService.ListRuns(allShots.Where(MatchesFilter).ToList())
                : runs;

            if (!anyFilterActive)
            {
                ShotVaultStatus.Text = $"{totalShots} shot{(totalShots == 1 ? "" : "s")} in {runs.Count} run{(runs.Count == 1 ? "" : "s")} — newest first.";
            }
            else
            {
                int matchCount = visibleRuns.Sum(r => r.Count);
                string against = query.Length > 0 && tagFiltered
                    ? $"\"{query}\" + {_activeTagFilters.Count} tag{(_activeTagFilters.Count == 1 ? "" : "s")}"
                    : query.Length > 0 ? $"\"{query}\"" : $"{_activeTagFilters.Count} tag{(_activeTagFilters.Count == 1 ? "" : "s")}";
                ShotVaultStatus.Text = matchCount == 0
                    ? $"No shots match {against} (of {totalShots} total)."
                    : $"{matchCount} of {totalShots} shot{(totalShots == 1 ? "" : "s")} match {against}.";
            }

            foreach (var run in visibleRuns)
            {
                ShotVaultRows.Children.Add(BuildRunHeader(run));

                var grid = new WrapPanel { Orientation = Orientation.Horizontal };
                foreach (var shot in run.Shots)
                    grid.Children.Add(BuildTile(shot));
                ShotVaultRows.Children.Add(grid);
            }
        }

        /// <summary>The real tag chip row: every distinct label actually present across the current
        /// shot set, each with its own real match count, grouped by kind (screen, then date, then
        /// resolution) and sorted most-common-first within a kind so the row stays stable between
        /// refreshes rather than reshuffling on every render.</summary>
        private void RenderTagChips(Dictionary<string, IReadOnlyList<ShotVaultTag>> tagsByPath)
        {
            var counts = tagsByPath.Values.SelectMany(t => t)
                .GroupBy(t => (t.Kind, t.Label))
                .Select(g => (g.Key.Kind, g.Key.Label, Count: g.Count()))
                .ToList();

            var kindOrder = new[] { "screen", "date", "resolution" };
            var ordered = counts
                .OrderBy(c => Array.IndexOf(kindOrder, c.Kind))
                .ThenByDescending(c => c.Count)
                .ThenBy(c => c.Label, StringComparer.OrdinalIgnoreCase);

            foreach (var (_, label, count) in ordered)
                ShotVaultTagChips.Children.Add(BuildTagChip(label, count));
        }

        /// <summary>One clickable, multi-select tag filter chip.</summary>
        private Border BuildTagChip(string label, int count)
        {
            bool active = _activeTagFilters.Contains(label);
            var fg = (SolidColorBrush)FindResource("BlueBrush");
            var border = new Border
            {
                Padding = new Thickness(8, 3, 8, 3),
                Margin = new Thickness(0, 0, 6, 6),
                CornerRadius = new CornerRadius(99),
                Background = new SolidColorBrush(fg.Color) { Opacity = active ? 0.28 : 0.12 },
                BorderThickness = new Thickness(active ? 1.5 : 1),
                BorderBrush = new SolidColorBrush(fg.Color) { Opacity = active ? 0.9 : 0.4 },
                Cursor = Cursors.Hand,
                ToolTip = active ? $"Showing only shots tagged \"{label}\" — click to clear" : $"Filter to shots tagged \"{label}\""
            };
            var stack = new StackPanel { Orientation = Orientation.Horizontal };
            stack.Children.Add(new TextBlock { Text = label, FontSize = 10.5, FontWeight = FontWeights.SemiBold, Foreground = fg });
            stack.Children.Add(new TextBlock
            {
                Text = $" {count}",
                FontSize = 10.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = fg,
                Margin = new Thickness(3, 0, 0, 0)
            });
            border.Child = stack;
            border.MouseLeftButtonDown += (_, _) =>
            {
                if (!_activeTagFilters.Remove(label))
                    _activeTagFilters.Add(label);
                Render();
            };
            return border;
        }

        private Border BuildRunHeader(ShotVaultRun run)
        {
            // A single-shot run has nothing to range over — just show that one timestamp. A multi-shot
            // run shows the real oldest→newest span so the count actually means something at a glance.
            string when = run.Count == 1
                ? run.NewestUtc.ToLocalTime().ToString("MMM d, h:mm tt")
                : $"{run.OldestUtc.ToLocalTime():MMM d, h:mm tt} – {run.NewestUtc.ToLocalTime():h:mm tt}";

            var label = new TextBlock
            {
                Text = when,
                FontSize = 12.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center
            };

            var countChip = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 1, 6, 1),
                Margin = new Thickness(8, 0, 0, 0),
                Child = new TextBlock
                {
                    Text = run.Count == 1 ? "1 shot" : $"{run.Count} shots",
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("Subtext1Brush")
                }
            };

            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 12, 2, 6) };
            row.Children.Add(label);
            row.Children.Add(countChip);

            return new Border { Child = row };
        }

        /// <summary>One grid cell: thumbnail, filename/timestamp beneath, and the real per-shot Copy
        /// action.</summary>
        private Border BuildTile(ShotVaultItem shot)
        {
            var thumb = new Image
            {
                Width = TileWidth - 12,
                Height = ThumbHeight,
                Stretch = Stretch.UniformToFill,
                ClipToBounds = true
            };
            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad; // load bytes now, don't hold a file lock
                bmp.DecodePixelWidth = 300; // real shots can be full-screen; decode small for a grid tile
                bmp.UriSource = new Uri(shot.FilePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();
                thumb.Source = bmp;
            }
            catch
            {
                // A shot that fails to decode (corrupt, or still mid-write) just renders without a
                // thumbnail — the tile, and its real Copy action, still stand.
            }

            var thumbHost = new Border
            {
                CornerRadius = new CornerRadius(4),
                Background = (Brush)FindResource("CrustBrush"),
                Child = thumb
            };

            var name = new TextBlock
            {
                Text = shot.FileName,
                FontSize = 10.5,
                Foreground = (Brush)FindResource("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                Margin = new Thickness(0, 6, 0, 0)
            };
            var when = new TextBlock
            {
                Text = shot.CreatedAtUtc.ToLocalTime().ToString("MMM d, h:mm tt"),
                FontSize = 9.5,
                Foreground = (Brush)FindResource("Subtext0Brush"),
                Margin = new Thickness(0, 1, 0, 0)
            };

            var copyLink = new TextBlock
            {
                Text = "Copy",
                FontSize = 10.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("BlueBrush"),
                Cursor = Cursors.Hand,
                Margin = new Thickness(0, 4, 0, 0)
            };
            copyLink.MouseLeftButtonUp += (_, _) => CopyClicked(shot);

            var footer = new StackPanel();
            footer.Children.Add(name);
            footer.Children.Add(when);
            footer.Children.Add(copyLink);

            var cell = new StackPanel();
            cell.Children.Add(thumbHost);
            cell.Children.Add(footer);

            return new Border
            {
                Width = TileWidth,
                Margin = new Thickness(0, 0, 8, 8),
                Padding = new Thickness(6),
                CornerRadius = new CornerRadius(4),
                Background = (Brush)FindResource("MantleBrush"),
                ToolTip = $"{shot.FileName}\n{shot.CreatedAtUtc.ToLocalTime():MMM d, yyyy h:mm:ss tt}",
                Child = cell
            };
        }

        private void CopyClicked(ShotVaultItem shot)
        {
            try
            {
                ShotVaultService.CopyToClipboard(shot);
                ToastEngine.Success("Copied", $"{shot.FileName} copied to clipboard.");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Copy failed", ex.Message);
            }
        }
    }
}
