using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>Git #2373 (Feature #2367 item 6) — a frozen snapshot of the Shot Vault panel's real
/// shot list at the moment "Send to tab" was clicked. Carried on <c>TabDef</c>, read by
/// <see cref="MainWindow.RenderShotVaultDoc"/>. Records — not the live <see cref="ShotVaultItem"/>
/// list itself — so a later re-open of the rail panel (which may have picked up new/removed
/// shots) can't silently mutate a tab that already claims to be a frozen send-time copy.</summary>
public sealed record ShotVaultDocSnapshot(IReadOnlyList<ShotVaultItem> Shots, DateTime SentAtUtc);

/// <summary>
/// Git #2372 (Feature #2367 item 5) — Shot Vault rail panel: the real per-shot Copy action.
/// Git #2370 (Feature #2367 item 3) — real run grouping: newest-first runs, each with a real
/// timestamp (or oldest–newest span) and shot count.
/// Git #2371 (Feature #2367 item 4) — each run's shots render as a wrapped thumbnail grid, and
/// each tile carries a real, computed DIFF badge.
/// Git #2368 (Feature #2367 item 1) — a real search box filters the same real shot list by filename
/// or by the shot's real capture-time screen (<see cref="Services.ShotVaultService.MatchesQuery"/>).
/// Git #2369 (Feature #2367 item 2) — real tag filter chips, derived from each shot's own real
/// properties (see <see cref="RenderShotVaultTagChips"/>).
///
/// Real audit before #2372: Shot Vault (#2367) was entirely `notBuilt` — grouped into
/// <c>MainWindow.xaml.cs</c>'s shared "not built" placeholder alongside Build Console / Build Watch /
/// UI Testing, with no panel, no data source, and no index anywhere in ShaneBuilder. The only real
/// shot-producing mechanism is <see cref="Services.DesktopScreenClipService"/>'s manual desktop clip,
/// which drops loose timestamped PNGs into <c>%Pictures%\Screenshots\ShaneBuilder\</c> with no
/// metadata or tags. Git #2368 closed that gap for search by having <c>DesktopScreenClipService</c>
/// encode the real monitor a shot was captured from straight into the filename at save time — no
/// second sidecar file, no fabricated screen name. There is still no manual tag store beyond that.
///
/// #2372 stood up the minimum real scaffold Shot Vault needed to exist at all: a real, newest-first
/// list of the actual shots on disk (<see cref="ShotVaultService.ListShots"/>), each with a real
/// thumbnail and a working Copy action that puts that exact shot back on the clipboard
/// (<see cref="ShotVaultService.CopyToClipboard"/>, itself reusing
/// <see cref="Services.DesktopScreenClipService"/>'s own multi-format clipboard write rather than a
/// second one). #2370 grouped that same real list into runs (<see cref="ShotVaultService.ListRuns()"/>
/// — shots within <see cref="ShotVaultService.RunGap"/> of each other are the same capture session)
/// and renders a real header per run. #2371 turned each run's shot rows into a wrapped thumbnail grid
/// via <see cref="Services.ShotVaultService.BuildTiles"/>, which pairs every real shot on disk with a
/// real DIFF flag computed from a downsampled MD5 of its actual pixels against the shot immediately
/// before it in time (chronological, independent of which run it falls in — see the service for the
/// honest reasoning). No fixture DIFF state, no random/rotating badge — a tile is only badged when its
/// own bytes actually changed. #2368 filters the same runs/tiles by a real query against filename or
/// screen, re-grouping only the matches into runs so a filtered view never shows a stale span. This
/// build (#2369) adds the tag chip row on top of that same (already search-filtered) shot set — since
/// there's still no manual tag store, a shot's tags are computed straight off data it already really
/// carries: its real capture screen (#2368), a date bucket off its own real timestamp, a resolution
/// tag off its own real decoded pixel dimensions, and "Changed" when the tile already carries a real
/// DIFF flag (#2371). Chips are multi-select with AND semantics; clicking one re-runs
/// <see cref="RenderShotVaultPanel"/> filtered to shots matching every active label AND the current
/// search query, and runs left with no matching shots simply don't render.
/// </summary>
public partial class MainWindow
{
    private bool _shotVaultPanelLoaded;

    private const double ShotVaultTileWidth = 140;
    private const double ShotVaultThumbHeight = 84;

    // Git #2373 — "Expand full page here" widens the rail panel in place (no tab opened); "Send to
    // tab" is the explicit opt-in takeover that opens the same real shot list in a document tab
    // (ShotVaultItemDock). Same split, same widths, as Git #2312/#2365 already built for the Git
    // Panel peek and the Batter Up panel — reused rather than reinvented for this panel.
    private bool _shotVaultExpanded;

    /// <summary>The real shot list from the panel's most recent successful render — read by "Send
    /// to tab" to build its frozen snapshot. Null until the panel has actually loaded at least once
    /// (never a guessed/empty stand-in for "not loaded yet").</summary>
    private IReadOnlyList<ShotVaultItem>? _shotVaultLastShots;

    /// <summary>Git #2368 — the real "search by shot name or screen" filter text, live-applied in
    /// <see cref="RenderShotVaultPanel"/> (never a separate search results list). Persists across a
    /// close/reopen of the rail panel the same way <c>ApiExplorerSearchBox</c> already does, since the
    /// TextBox itself stays in the visual tree.</summary>
    private string _shotVaultSearchQuery = "";

    /// <summary>Git #2369 — the currently-active tag filter chips (multi-select, AND semantics: a
    /// shot must carry every active label to show, on top of the real search query above). Empty
    /// means no filter — every (search-)matched shot shows, same as before this issue. Survives
    /// across re-renders of the same panel session; cleared only when the active shot set no longer
    /// has a matching tag at all (see <see cref="RenderShotVaultPanel"/>).</summary>
    private readonly HashSet<string> _shotVaultActiveTagFilters = new(StringComparer.Ordinal);

    /// <summary>Git #2374 — the real, persisted retention window (in days) shots are purged beyond.
    /// Backed by <see cref="SettingsStore"/> like every other real ShaneBuilder setting — 0 (the
    /// default) means "keep forever", the original pre-#2374 behavior, until Shane picks a window.</summary>
    private const string ShotVaultRetentionDaysKey = "shotvault:retentionDays";

    /// <summary>Guards <see cref="ShotVaultRetentionCombo_SelectionChanged"/> while <see
    /// cref="SyncShotVaultRetentionCombo"/> programmatically sets the combo's selection to match the
    /// persisted setting, so loading the saved value doesn't itself re-trigger a save + purge.</summary>
    private bool _shotVaultSyncingRetentionCombo;

    /// <summary>Git #2374 — the real, currently-pinned "compare to baseline" shot (its file path), or
    /// null when no baseline is active — the panel's original chronological-only DIFF behavior is
    /// unchanged in that case. Set via a tile's "Set as baseline" link; not persisted across an app
    /// restart — a baseline is a live working-session pin, not a saved vault property. Auto-cleared in
    /// <see cref="RenderShotVaultPanel"/> if the pinned shot ages off the current list (purged, or the
    /// file was otherwise removed).</summary>
    private string? _shotVaultBaselinePath;

    /// <summary>Fires the real folder read the first time the SHOT VAULT rail panel opens. A missing
    /// folder (nothing captured yet) renders an honest empty state, not a fixture row.</summary>
    private void EnsureShotVaultPanelLoaded()
    {
        if (_shotVaultPanelLoaded)
        {
            RenderShotVaultPanel();
            return;
        }

        _shotVaultPanelLoaded = true;
        SyncShotVaultRetentionCombo();
        ApplyShotVaultRetentionIfNeeded();
        RenderShotVaultPanel();
    }

    /// <summary>Git #2374 — sets the retention ComboBox's selection to match the real persisted
    /// setting (defaulting to "Keep forever" the first time it's ever opened), without firing the
    /// SelectionChanged save/purge handler for this programmatic sync.</summary>
    private void SyncShotVaultRetentionCombo()
    {
        int days = SettingsStore.Get(ShotVaultRetentionDaysKey, 0);
        _shotVaultSyncingRetentionCombo = true;
        try
        {
            foreach (ComboBoxItem item in ShotVaultRetentionCombo.Items)
            {
                if (item.Tag is string tag && int.TryParse(tag, out int itemDays) && itemDays == days)
                {
                    ShotVaultRetentionCombo.SelectedItem = item;
                    return;
                }
            }
            ShotVaultRetentionCombo.SelectedIndex = 0; // unrecognized/stale value — fall back to "Keep forever"
        }
        finally
        {
            _shotVaultSyncingRetentionCombo = false;
        }
    }

    /// <summary>Git #2374 — the real retention purge, run against the real current shot list. A
    /// policy of "Keep forever" (days &lt;= 0) is a real no-op — <see
    /// cref="ShotVaultService.ApplyRetention"/> itself returns nothing to delete. Reports the real
    /// deleted count via toast rather than staying silent, since this can run automatically on panel
    /// open, not only from the explicit "Purge now" link.</summary>
    private void ApplyShotVaultRetentionIfNeeded()
    {
        int days = SettingsStore.Get(ShotVaultRetentionDaysKey, 0);
        if (days <= 0) return;

        try
        {
            var deleted = ShotVaultService.ApplyRetention(ShotVaultService.ListShots(), days);
            if (deleted.Count > 0)
                ToastEngine.Show("Shot Vault",
                    $"Retention: removed {deleted.Count} shot{(deleted.Count == 1 ? "" : "s")} older than {days} days.",
                    ToastKind.Info);
        }
        catch (Exception ex)
        {
            ToastEngine.Error("Shot Vault retention", ex.Message);
        }
    }

    private void ShotVaultRetentionCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_shotVaultSyncingRetentionCombo) return;
        if (ShotVaultRetentionCombo.SelectedItem is not ComboBoxItem item) return;
        if (item.Tag is not string tag || !int.TryParse(tag, out int days)) return;

        SettingsStore.Set(ShotVaultRetentionDaysKey, days);
        ApplyShotVaultRetentionIfNeeded();
        RenderShotVaultPanel();
    }

    /// <summary>The explicit "Purge now" action — re-applies the currently-selected retention policy
    /// immediately, rather than waiting for the next panel open. An honest toast either way: a real
    /// deleted count, or (via <see cref="ApplyShotVaultRetentionIfNeeded"/>'s own no-op) nothing at
    /// all when the policy is "Keep forever" or nothing is old enough yet.</summary>
    private void ShotVaultPurgeNow_Click(object sender, MouseButtonEventArgs e)
    {
        int days = SettingsStore.Get(ShotVaultRetentionDaysKey, 0);
        if (days <= 0)
        {
            ToastEngine.Show("Shot Vault", "Retention is set to \"Keep forever\" — nothing to purge.", ToastKind.Warning);
            return;
        }
        ApplyShotVaultRetentionIfNeeded();
        RenderShotVaultPanel();
    }

    private void RenderShotVaultPanel()
    {
        ShotVaultRows.Children.Clear();
        ShotVaultTagChips.Children.Clear();

        // Git #2370: runs newest-first, each with a real timestamp + shot count, grouping the same
        // real shot list ListShots() reads. ListRuns() derives runs from ListShots() itself, so this
        // stays the single real read of the shots folder for the whole panel.
        IReadOnlyList<ShotVaultRun> runs;
        try
        {
            runs = ShotVaultService.ListRuns();
        }
        catch (Exception ex)
        {
            ShotVaultPanelStatus.Text = $"Couldn't read the shots folder — {ex.Message}";
            ShotVaultPanelStatus.Visibility = Visibility.Visible;
            return;
        }

        _shotVaultLastShots = runs.SelectMany(r => r.Shots).ToList(); // real flat list, read by "Send to tab" (#2373)

        // Git #2374 — a pinned baseline that has aged off the real list (purged, or removed by hand)
        // is an honest reset, not a stale pin that would otherwise silently compare against a file
        // that no longer exists.
        if (_shotVaultBaselinePath != null && !_shotVaultLastShots.Any(s => s.FilePath == _shotVaultBaselinePath))
            _shotVaultBaselinePath = null;

        if (runs.Count == 0)
        {
            ShotVaultPanelStatus.Text = $"No shots yet — captures land in {ShotVaultService.ShotsDirectory}.";
            ShotVaultPanelStatus.Visibility = Visibility.Visible;
            _shotVaultActiveTagFilters.Clear(); // nothing left to filter against
            _shotVaultBaselinePath = null;
            RenderShotVaultBaselineRow();
            return;
        }

        // Git #2371: DIFF is computed once, across the real chronological order of every shot in the
        // vault (not per-run — a run boundary is a capture-session gap, not a reset of "did the pixels
        // actually change"), then each tile is placed back under its own run's header/grid below. This
        // stays computed over the FULL, unfiltered list even while searching (#2368) — a search only
        // decides what's shown, it never changes what "changed from the shot before it" means.
        // Git #2374: the same pass also carries the real HasDiffFromBaseline flag when a baseline is
        // pinned — no second read of disk.
        var tilesByPath = ShotVaultService.BuildTiles(_shotVaultLastShots!, _shotVaultBaselinePath)
            .ToDictionary(t => t.Shot.FilePath, t => t);
        int diffCount = tilesByPath.Values.Count(t => t.HasDiffFromPrevious);
        int baselineDiffCount = tilesByPath.Values.Count(t => t.HasDiffFromBaseline == true);

        RenderShotVaultBaselineRow();

        // Git #2369: real tags per shot, derived off tilesByPath — never a second real read of disk.
        var tagsByPath = tilesByPath.ToDictionary(kv => kv.Key, kv => ShotVaultService.GetTags(kv.Value));

        // Drop any active filter label the current shot set no longer has anything tagged with (a
        // shot behind it may have aged off, or the whole vault may have been cleared) — an active
        // chip that can never match anything again would otherwise silently hide everything forever.
        var allLabels = tagsByPath.Values.SelectMany(t => t).Select(t => t.Label).ToHashSet(StringComparer.Ordinal);
        _shotVaultActiveTagFilters.RemoveWhere(label => !allLabels.Contains(label));

        RenderShotVaultTagChips(tagsByPath);

        int totalShots = runs.Sum(r => r.Count);

        // Git #2368 — real "search by shot name or screen"; Git #2369 — real tag chip filter, AND'd
        // with the search query. Filter the flat shot list down to matches, then re-derive runs so a
        // filtered-out gap doesn't leave a stale multi-shot header/span.
        string query = _shotVaultSearchQuery.Trim();
        bool tagFiltered = _shotVaultActiveTagFilters.Count > 0;
        bool anyFilterActive = query.Length > 0 || tagFiltered;

        bool MatchesFilter(ShotVaultItem shot) =>
            (query.Length == 0 || ShotVaultService.MatchesQuery(shot, query)) &&
            (!tagFiltered || _shotVaultActiveTagFilters.All(f => tagsByPath[shot.FilePath].Any(t => t.Label == f)));

        IReadOnlyList<ShotVaultRun> visibleRuns = anyFilterActive
            ? ShotVaultService.ListRuns(_shotVaultLastShots!.Where(MatchesFilter).ToList())
            : runs;

        // Git #2374 — the baseline compare-count reads on top of the existing chronological-DIFF
        // sentence rather than replacing it; both are real, independent comparisons over the same tiles.
        string baselineSuffix = _shotVaultBaselinePath != null
            ? $" {baselineDiffCount} differ{(baselineDiffCount == 1 ? "s" : "")} from the pinned baseline."
            : "";

        if (!anyFilterActive)
        {
            ShotVaultPanelStatus.Text = diffCount == 0
                ? $"{totalShots} shot{(totalShots == 1 ? "" : "s")} in {runs.Count} run{(runs.Count == 1 ? "" : "s")} — newest first.{baselineSuffix}"
                : $"{totalShots} shot{(totalShots == 1 ? "" : "s")} in {runs.Count} run{(runs.Count == 1 ? "" : "s")} — newest first, {diffCount} DIFF from the shot before it.{baselineSuffix}";
        }
        else
        {
            int matchCount = visibleRuns.Sum(r => r.Count);
            string against = query.Length > 0 && tagFiltered
                ? $"\"{query}\" + {_shotVaultActiveTagFilters.Count} tag{(_shotVaultActiveTagFilters.Count == 1 ? "" : "s")}"
                : query.Length > 0 ? $"\"{query}\"" : $"{_shotVaultActiveTagFilters.Count} tag{(_shotVaultActiveTagFilters.Count == 1 ? "" : "s")}";
            ShotVaultPanelStatus.Text = matchCount == 0
                ? $"No shots match {against} (of {totalShots} total)."
                : $"{matchCount} of {totalShots} shot{(totalShots == 1 ? "" : "s")} match {against}.";
        }
        ShotVaultPanelStatus.Visibility = Visibility.Visible;

        foreach (var run in visibleRuns)
        {
            ShotVaultRows.Children.Add(BuildShotVaultRunHeader(run));

            var grid = new WrapPanel { Orientation = Orientation.Horizontal };
            foreach (var shot in run.Shots)
                grid.Children.Add(BuildShotVaultTile(tilesByPath[shot.FilePath]));
            ShotVaultRows.Children.Add(grid);
        }
    }

    /// <summary>Git #2369 — the real tag chip row: every distinct label actually present across the
    /// current shot set, each with its own real match count, grouped by kind (screen, then date, then
    /// resolution, then diff) and sorted most-common-first within a kind so the row stays stable
    /// between refreshes rather than reshuffling on every render.</summary>
    private void RenderShotVaultTagChips(Dictionary<string, IReadOnlyList<ShotVaultTag>> tagsByPath)
    {
        var counts = tagsByPath.Values.SelectMany(t => t)
            .GroupBy(t => (t.Kind, t.Label))
            .Select(g => (g.Key.Kind, g.Key.Label, Count: g.Count()))
            .ToList();

        if (counts.Count == 0)
            return;

        var kindOrder = new[] { "screen", "date", "resolution", "diff" };
        var ordered = counts
            .OrderBy(c => Array.IndexOf(kindOrder, c.Kind))
            .ThenByDescending(c => c.Count)
            .ThenBy(c => c.Label, StringComparer.OrdinalIgnoreCase);

        foreach (var (_, label, count) in ordered)
            ShotVaultTagChips.Children.Add(ShotVaultTagChip(label, count));
    }

    /// <summary>One clickable, multi-select tag filter chip — same active/inactive visual language
    /// as <c>GitStateChip</c> (Git Panel's own build-state chips), reused rather than reinvented, but
    /// toggling into a set instead of a single selection since a shot can carry several real tags
    /// (screen, date bucket, resolution, optionally "Changed") that combine with AND.</summary>
    private Border ShotVaultTagChip(string label, int count)
    {
        bool active = _shotVaultActiveTagFilters.Contains(label);
        var fg = (SolidColorBrush)FindResource("Brush.Accent.Primary");
        var border = new Border
        {
            Padding = new Thickness(7, 3, 7, 3),
            Margin = new Thickness(0, 0, 4, 4),
            CornerRadius = new CornerRadius(99),
            Background = new SolidColorBrush(fg.Color) { Opacity = active ? 0.28 : 0.12 },
            BorderThickness = new Thickness(active ? 1.5 : 1),
            BorderBrush = new SolidColorBrush(fg.Color) { Opacity = active ? 0.9 : 0.4 },
            Cursor = Cursors.Hand,
            ToolTip = active ? $"Showing only shots tagged \"{label}\" — click to clear" : $"Filter to shots tagged \"{label}\""
        };
        var stack = new StackPanel { Orientation = Orientation.Horizontal };
        stack.Children.Add(new TextBlock
        {
            Text = label,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = fg
        });
        stack.Children.Add(new TextBlock
        {
            Text = $" {count}",
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = fg,
            Margin = new Thickness(3, 0, 0, 0)
        });
        border.Child = stack;
        border.MouseLeftButtonDown += (_, _) =>
        {
            if (!_shotVaultActiveTagFilters.Remove(label))
                _shotVaultActiveTagFilters.Add(label);
            RenderShotVaultPanel();
        };
        return border;
    }

    /// <summary>Git #2368 — live-filters as the panel's search box changes. Re-renders the whole panel
    /// off the current query rather than diffing rows in place; the shot list is small enough (a rail
    /// panel of loose PNGs, not a paginated table) that a full re-render stays cheap.</summary>
    private void ShotVaultSearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        _shotVaultSearchQuery = ShotVaultSearchBox.Text;
        RenderShotVaultPanel();
    }

    private Border BuildShotVaultRunHeader(ShotVaultRun run)
    {
        // A single-shot run has nothing to range over — just show that one timestamp. A multi-shot
        // run shows the real oldest→newest span so the count actually means something at a glance.
        string when = run.Count == 1
            ? run.NewestUtc.ToLocalTime().ToString("MMM d, h:mm tt")
            : $"{run.OldestUtc.ToLocalTime():MMM d, h:mm tt} – {run.NewestUtc.ToLocalTime():h:mm tt}";

        var label = new TextBlock
        {
            Text = when,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
            Foreground = (Brush)FindResource("Brush.Text.Primary"),
            VerticalAlignment = VerticalAlignment.Center
        };

        // Reuses the same small meta-chip style the Detected-in-this-chat cards already use for
        // count/kind badges (DetectionMetaChip) rather than inventing a new chip style for this one.
        var countChip = DetectionMetaChip(run.Count == 1 ? "1 shot" : $"{run.Count} shots");
        countChip.Margin = new Thickness(8, 0, 0, 0);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 10, 2, 6) };
        row.Children.Add(label);
        row.Children.Add(countChip);

        return new Border { Child = row };
    }

    /// <summary>One grid cell: thumbnail with an optional DIFF badge overlay, filename/timestamp
    /// beneath, and the real per-shot Copy action.</summary>
    private Border BuildShotVaultTile(ShotVaultTile tile)
    {
        var shot = tile.Shot;

        var thumb = new Image
        {
            Width = ShotVaultTileWidth - 12,
            Height = ShotVaultThumbHeight,
            Stretch = Stretch.UniformToFill,
            ClipToBounds = true
        };
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad; // load bytes now, don't hold a file lock
            bmp.DecodePixelWidth = 280; // real shots can be full-screen; decode small for a grid tile
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

        var thumbHost = new Grid();
        thumbHost.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(3),
            Background = (Brush)FindResource("Brush.Bg.Terminal"),
            Child = thumb
        });

        if (tile.HasDiffFromPrevious)
        {
            var diffBadge = GitCountPill("DIFF", "Brush.Alert.Danger.Border");
            diffBadge.HorizontalAlignment = HorizontalAlignment.Right;
            diffBadge.VerticalAlignment = VerticalAlignment.Top;
            diffBadge.Margin = new Thickness(0, 4, 4, 0);
            thumbHost.Children.Add(diffBadge);
        }

        // Git #2374 — the real "compare to baseline" badges, independent of the chronological DIFF
        // badge above: the pinned shot itself always reads BASE (it can't differ from itself), and
        // any other shot whose own real pixel hash differs from that one pinned shot's reads ≠ BASE.
        // Both are left off entirely when no baseline is pinned (HasDiffFromBaseline is null then).
        bool isBaseline = _shotVaultBaselinePath == shot.FilePath;
        if (isBaseline)
        {
            var baseBadge = GitCountPill("BASE", "Brush.Accent.Primary");
            baseBadge.HorizontalAlignment = HorizontalAlignment.Left;
            baseBadge.VerticalAlignment = VerticalAlignment.Top;
            baseBadge.Margin = new Thickness(4, 4, 0, 0);
            thumbHost.Children.Add(baseBadge);
        }
        else if (tile.HasDiffFromBaseline == true)
        {
            var baseDiffBadge = GitCountPill("≠ BASE", "Brush.Accent.Active");
            baseDiffBadge.HorizontalAlignment = HorizontalAlignment.Left;
            baseDiffBadge.VerticalAlignment = VerticalAlignment.Top;
            baseDiffBadge.Margin = new Thickness(4, 4, 0, 0);
            thumbHost.Children.Add(baseDiffBadge);
        }

        var name = new TextBlock
        {
            Text = shot.FileName,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.9.5"),
            Foreground = (Brush)FindResource("Brush.Text.Primary"),
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(0, 6, 0, 0)
        };
        var when = new TextBlock
        {
            Text = shot.CreatedAtUtc.ToLocalTime().ToString("MMM d, h:mm tt"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.8.5"),
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            Margin = new Thickness(0, 1, 0, 0)
        };

        // Reuses the same action-link style GitEpicActionLink already established for per-item
        // actions (Hold/Release/Dispatch on the Batter Up panel) rather than inventing a Button
        // style for this one action.
        var copyLink = GitEpicActionLink("Copy", disabled: false, () => ShotVaultCopyClicked(shot));
        copyLink.HorizontalAlignment = HorizontalAlignment.Left;
        copyLink.Margin = new Thickness(0, 4, 0, 0);

        // Git #2374 — the real "compare to baseline" pin/unpin action, same action-link style as
        // Copy above. The pinned shot itself offers "Clear baseline" in place of "Set as baseline"
        // rather than showing both actions on every tile.
        var baselineLink = isBaseline
            ? GitEpicActionLink("Clear baseline", disabled: false, ShotVaultClearBaselineClicked)
            : GitEpicActionLink("Set as baseline", disabled: false, () => ShotVaultSetBaselineClicked(shot));
        baselineLink.HorizontalAlignment = HorizontalAlignment.Left;
        baselineLink.Margin = new Thickness(0, 2, 0, 0);

        var footer = new StackPanel();
        footer.Children.Add(name);
        footer.Children.Add(when);
        footer.Children.Add(copyLink);
        footer.Children.Add(baselineLink);

        var cell = new StackPanel();
        cell.Children.Add(thumbHost);
        cell.Children.Add(footer);

        string tooltip = $"{shot.FileName}\n{shot.CreatedAtUtc.ToLocalTime():MMM d, yyyy h:mm:ss tt}" +
                          (tile.HasDiffFromPrevious ? "\nDIFF — changed from the shot before it" : "") +
                          (isBaseline ? "\nPinned as the comparison baseline" :
                           tile.HasDiffFromBaseline == true ? "\n≠ BASE — differs from the pinned baseline" : "");

        return new Border
        {
            Width = ShotVaultTileWidth,
            Margin = new Thickness(0, 0, 8, 8),
            Padding = new Thickness(6),
            CornerRadius = new CornerRadius(4),
            Background = (Brush)FindResource("Brush.Bg.Card"),
            BorderThickness = new Thickness(isBaseline ? 1.5 : 0),
            BorderBrush = isBaseline ? (Brush)FindResource("Brush.Accent.Primary") : Brushes.Transparent,
            ToolTip = tooltip,
            Child = cell
        };
    }

    private void ShotVaultCopyClicked(ShotVaultItem shot)
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

    /// <summary>Git #2374 — pins the real "compare to baseline" shot: every tile's real pixel hash
    /// is compared against this one shot's hash on the next render (see <see
    /// cref="ShotVaultService.BuildTiles"/>).</summary>
    private void ShotVaultSetBaselineClicked(ShotVaultItem shot)
    {
        _shotVaultBaselinePath = shot.FilePath;
        RenderShotVaultPanel();
        ToastEngine.Show("Shot Vault", $"Comparing every shot to {shot.FileName}.", ToastKind.Info);
    }

    private void ShotVaultClearBaselineClicked()
    {
        _shotVaultBaselinePath = null;
        RenderShotVaultPanel();
    }

    /// <summary>Git #2374 — the real baseline indicator row above the shot grid: hidden entirely
    /// when no baseline is pinned (the row's original, pre-#2374 collapsed state), or the pinned
    /// shot's own real filename plus a Clear action when one is.</summary>
    private void RenderShotVaultBaselineRow()
    {
        ShotVaultBaselineRow.Children.Clear();

        if (_shotVaultBaselinePath == null)
        {
            ShotVaultBaselineRow.Visibility = Visibility.Collapsed;
            return;
        }

        ShotVaultBaselineRow.Visibility = Visibility.Visible;
        ShotVaultBaselineRow.Children.Add(new TextBlock
        {
            Text = $"Comparing to: {Path.GetFileName(_shotVaultBaselinePath)}",
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.9.5"),
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 220
        });

        var clearLink = GitEpicActionLink("Clear", disabled: false, ShotVaultClearBaselineClicked);
        clearLink.Margin = new Thickness(8, 0, 0, 0);
        ShotVaultBaselineRow.Children.Add(clearLink);
    }

    // ── Panel-level chrome (#2373) ───────────────────────────────────────────────────────────

    /// <summary>Widens/collapses the rail in place for "Expand full page here" (#2373). Only
    /// touches the shared <c>LeftPanel</c> while Shot Vault is the one actually showing it —
    /// switching rail sources (Git/Chats/BatterUp/...) leaves this state behind rather than
    /// stretching an unrelated panel. Same width Git #2312/#2365 use for their own peek expand.</summary>
    private void SetShotVaultExpanded(bool expanded)
    {
        _shotVaultExpanded = expanded;
        BtnShotVaultExpand.ToolTip = expanded ? "Collapse back to the rail width" : "Expand full page here";
        if (_leftPanelSource == "ShotVault")
            LeftPanel.Width = expanded ? GitPeekExpandedWidth : LeftPanelWidth;
    }

    private void BtnShotVaultExpand_Click(object sender, MouseButtonEventArgs e) => SetShotVaultExpanded(!_shotVaultExpanded);

    /// <summary>"Send to tab" (#2373) — opens (or refreshes and focuses) a document tab holding a
    /// real frozen snapshot of the panel's current shot list, via <see cref="RenderShotVaultDoc"/>.
    /// One real disk-backed panel, two surfaces — same "widen in place vs. explicit opt-in
    /// takeover" split Git #2312/#2365 built for the Git Panel peek and the Batter Up panel.
    /// A panel that hasn't loaded yet (no real list to freeze) reports that honestly instead of
    /// sending an empty tab that looks like a genuinely empty vault.</summary>
    private void BtnShotVaultSendToTab_Click(object sender, MouseButtonEventArgs e)
    {
        var shots = _shotVaultLastShots;
        if (shots == null)
        {
            ToastEngine.Show("Shot Vault", "Still loading the shot list — try again in a moment.", ToastKind.Warning);
            return;
        }

        var snapshot = new ShotVaultDocSnapshot(shots.ToList(), DateTime.UtcNow);

        const string tabId = "shotvault-doc";
        var existing = _tabs.Find(t => t.Id == tabId);
        if (existing != null)
        {
            _tabs.Remove(existing); // refresh — the real shot list may have moved since it was last sent
        }

        var tab = new TabDef(tabId, "Shot Vault", shotVaultSnapshot: snapshot,
            dot: (Brush)FindResource("Brush.Accent.Primary"),
            // Same reasoning as the Batter Up doc tab (#2472) — a Shot Vault document is the
            // contract's named reloadable class, never a dedicated parked WebView2.
            keepAliveClass: TabKeepAliveClass.Reloadable);
        _tabs.Add(tab);
        SelectTab(tabId);
    }

    /// <summary>Renders a "Send to tab" document (#2373) into the shared ShotVaultItemDock — the
    /// same thumbnail rows + Copy action the rail panel shows, off the frozen snapshot rather than
    /// the live folder read (a re-open of the rail panel after this tab was sent may have picked up
    /// new/removed shots; the doc stays honest about what it was actually sent, not silently
    /// live).</summary>
    private void RenderShotVaultDoc(TabDef tab)
    {
        ShotVaultItemDocHost.Children.Clear();
        var snap = tab.ShotVaultSnapshot;
        if (snap == null) return;

        var status = new TextBlock
        {
            Margin = new Thickness(6, 0, 6, 10),
            TextWrapping = TextWrapping.Wrap,
            Text = snap.Shots.Count == 0
                ? $"No shots at send time ({snap.SentAtUtc.ToLocalTime():MMM d, h:mm tt})."
                : $"{snap.Shots.Count} shot{(snap.Shots.Count == 1 ? "" : "s")} — as of {snap.SentAtUtc.ToLocalTime():MMM d, h:mm tt}.",
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
        };
        ShotVaultItemDocHost.Children.Add(status);

        // Same real tile grid + real Copy action + real DIFF badges (#2371) the rail panel uses — a
        // sent shot still copies to the clipboard from the tab (the file on disk hasn't moved, only
        // the panel's own list state is frozen), so this isn't a dead, inert copy of the rail panel.
        var tiles = ShotVaultService.BuildTiles(snap.Shots);
        var grid = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var tile in tiles)
            grid.Children.Add(BuildShotVaultTile(tile));
        ShotVaultItemDocHost.Children.Add(grid);
    }
}
