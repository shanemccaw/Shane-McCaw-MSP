using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
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

        /// <summary>Git #3688 — bumped on every <see cref="Render"/> call and captured by that call's
        /// own async scan; if a newer render started (refresh clicked, search text changed, tag chip
        /// toggled) while an older scan was still running in the background, the older one's result is
        /// discarded rather than clobbering the UI with stale data once it lands.</summary>
        private int _renderGeneration;

        /// <summary>The real off-UI-thread work for one <see cref="Render"/> pass: the folder scan
        /// (<see cref="ShotVaultService.ListRuns()"/>), the derived tags per shot, and every visible
        /// shot's thumbnail — all real file I/O/decode, none of it touching a UI element, so it's safe
        /// to run on a background thread via <see cref="Task.Run{TResult}(Func{TResult})"/>.</summary>
        private sealed record ShotVaultScan(
            IReadOnlyList<ShotVaultRun> Runs,
            Dictionary<string, IReadOnlyList<ShotVaultTag>> TagsByPath,
            Dictionary<string, BitmapImage?> ThumbsByPath);

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

        /// <summary>Git #3688 — the real render pass, kicked off async so the real folder scan
        /// (<see cref="ShotVaultService.ListRuns()"/>'s <c>Directory.EnumerateFiles</c>) and every
        /// visible shot's real thumbnail decode both run on a background thread via
        /// <see cref="Task.Run{TResult}(Func{TResult})"/> — never on the UI thread. A real,
        /// honest "Loading shots…" status shows immediately, before the scan starts, rather than a
        /// frozen UI with nothing to indicate why. Only the final, already-decoded result is marshaled
        /// back (the `await` continuation resumes on this window's own UI-thread `SynchronizationContext`
        /// automatically — no explicit <c>Dispatcher.Invoke</c> needed) to build the run headers +
        /// thumbnail grid.</summary>
        private async void Render()
        {
            int myGeneration = ++_renderGeneration;

            ShotVaultRows.Children.Clear();
            ShotVaultTagChips.Children.Clear();
            ShotVaultTagChipsRow.Visibility = Visibility.Collapsed;
            ShotVaultEmptyText.Visibility = Visibility.Collapsed;
            ShotVaultStatus.Text = "Loading shots…";

            ShotVaultScan scan;
            try
            {
                scan = await Task.Run(ScanShotsAndDecodeThumbnails);
            }
            catch (Exception ex)
            {
                // A newer render (refresh, search, tag toggle) already superseded this one — don't
                // clobber whatever it's already showing/loading with this stale failure.
                if (myGeneration != _renderGeneration) return;
                ShotVaultStatus.Text = $"Couldn't read the shots folder — {ex.Message}";
                ShotVaultEmptyText.Visibility = Visibility.Collapsed;
                return;
            }

            // Same staleness guard on the success path — e.g. the user typed a second search
            // character while the first scan was still running in the background.
            if (myGeneration != _renderGeneration) return;

            RenderScan(scan);
        }

        /// <summary>The real off-UI-thread work: re-reads the shots folder, re-derives real tags, and
        /// pre-decodes every visible shot's real thumbnail (frozen so it's safe to hand back across
        /// threads). Touches no UI element — safe to run inside <see cref="Task.Run{TResult}(Func{TResult})"/>.</summary>
        private static ShotVaultScan ScanShotsAndDecodeThumbnails()
        {
            var runs = ShotVaultService.ListRuns();
            var allShots = runs.SelectMany(r => r.Shots).ToList();

            var tagsByPath = allShots.ToDictionary(s => s.FilePath, s => ShotVaultService.GetTags(s));
            var thumbsByPath = allShots.ToDictionary(s => s.FilePath, s => DecodeThumbnail(s.FilePath));

            return new ShotVaultScan(runs, tagsByPath, thumbsByPath);
        }

        /// <summary>Real per-shot thumbnail decode, off the UI thread. <see cref="BitmapImage.Freeze"/>
        /// makes the result thread-safe to hand back to the UI thread for direct use as an
        /// <see cref="Image.Source"/> — real shots can be full-screen, so this decodes small
        /// (<see cref="BitmapImage.DecodePixelWidth"/>) rather than full-size. Returns null on any
        /// decode failure (corrupt file, still mid-write) rather than a guessed placeholder — the tile
        /// still renders, just without a thumbnail.</summary>
        private static BitmapImage? DecodeThumbnail(string filePath)
        {
            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad; // load bytes now, don't hold a file lock
                bmp.DecodePixelWidth = 300;
                bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();
                return bmp;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>The real UI-thread build: applies the current search + tag filters over an
        /// already-scanned/already-decoded <see cref="ShotVaultScan"/> and rebuilds the visible run
        /// headers + thumbnail grid. No file I/O or decode happens here — that already ran in the
        /// background in <see cref="ScanShotsAndDecodeThumbnails"/>.</summary>
        private void RenderScan(ShotVaultScan scan)
        {
            var runs = scan.Runs;
            var tagsByPath = scan.TagsByPath;
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
                    grid.Children.Add(BuildTile(shot, scan.ThumbsByPath.GetValueOrDefault(shot.FilePath)));
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
        /// action. Git #3688 — the thumbnail itself is already decoded (off the UI thread, in
        /// <see cref="ScanShotsAndDecodeThumbnails"/>); this just assigns the already-frozen bitmap. A
        /// null thumbnail (decode failed — corrupt file, still mid-write) just renders the tile without
        /// one — the tile, and its real Copy action, still stand.</summary>
        private Border BuildTile(ShotVaultItem shot, BitmapImage? thumbnail)
        {
            var thumb = new Image
            {
                Width = TileWidth - 12,
                Height = ThumbHeight,
                Stretch = Stretch.UniformToFill,
                ClipToBounds = true,
                Source = thumbnail
            };

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
