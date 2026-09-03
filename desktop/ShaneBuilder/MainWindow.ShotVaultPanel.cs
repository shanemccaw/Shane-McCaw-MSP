using System;
using System.Collections.Generic;
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
///
/// Real audit before #2372: Shot Vault (#2367) was entirely `notBuilt` — grouped into
/// <c>MainWindow.xaml.cs</c>'s shared "not built" placeholder alongside Build Console / Build Watch /
/// UI Testing, with no panel, no data source, and no index anywhere in ShaneBuilder. The only real
/// shot-producing mechanism is <see cref="Services.DesktopScreenClipService"/>'s manual desktop clip,
/// which drops loose timestamped PNGs into <c>%Pictures%\Screenshots\ShaneBuilder\</c> with no
/// metadata or tags — there is still no search/tag indexed store to build the fuller panel spec
/// against (that's #2368 search, #2369 tags — separate, real sibling sub-issues, still open).
///
/// #2372 stood up the minimum real scaffold Shot Vault needed to exist at all: a real, newest-first
/// list of the actual shots on disk (<see cref="ShotVaultService.ListShots"/>), each with a real
/// thumbnail and a working Copy action that puts that exact shot back on the clipboard
/// (<see cref="ShotVaultService.CopyToClipboard"/>, itself reusing
/// <see cref="Services.DesktopScreenClipService"/>'s own multi-format clipboard write rather than a
/// second one). #2370 grouped that same real list into runs (<see cref="ShotVaultService.ListRuns"/>
/// — shots within <see cref="ShotVaultService.RunGap"/> of each other are the same capture session)
/// and renders a real header per run. This build (#2371) turns each run's shot rows into a wrapped
/// thumbnail grid via <see cref="Services.ShotVaultService.BuildTiles"/>, which pairs every real shot
/// on disk with a real DIFF flag computed from a downsampled MD5 of its actual pixels against the shot
/// immediately before it in time (chronological, independent of which run it falls in — see the
/// service for the honest reasoning). No fixture DIFF state, no random/rotating badge — a tile is only
/// badged when its own bytes actually changed. Search and tag chips remain deliberately NOT built
/// here; sibling issues extend this same <c>ShotVaultPanelBody</c>/<see cref="RenderShotVaultPanel"/>
/// surface rather than it being redone per issue.
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
        RenderShotVaultPanel();
    }

    private void RenderShotVaultPanel()
    {
        ShotVaultRows.Children.Clear();

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

        if (runs.Count == 0)
        {
            ShotVaultPanelStatus.Text = $"No shots yet — captures land in {ShotVaultService.ShotsDirectory}.";
            ShotVaultPanelStatus.Visibility = Visibility.Visible;
            return;
        }

        // Git #2371: DIFF is computed once, across the real chronological order of every shot in the
        // vault (not per-run — a run boundary is a capture-session gap, not a reset of "did the pixels
        // actually change"), then each tile is placed back under its own run's header/grid below.
        var tilesByPath = ShotVaultService.BuildTiles(_shotVaultLastShots!)
            .ToDictionary(t => t.Shot.FilePath, t => t);
        int diffCount = tilesByPath.Values.Count(t => t.HasDiffFromPrevious);

        int totalShots = runs.Sum(r => r.Count);
        ShotVaultPanelStatus.Text = diffCount == 0
            ? $"{totalShots} shot{(totalShots == 1 ? "" : "s")} in {runs.Count} run{(runs.Count == 1 ? "" : "s")} — newest first."
            : $"{totalShots} shot{(totalShots == 1 ? "" : "s")} in {runs.Count} run{(runs.Count == 1 ? "" : "s")} — newest first, {diffCount} DIFF from the shot before it.";
        ShotVaultPanelStatus.Visibility = Visibility.Visible;

        foreach (var run in runs)
        {
            ShotVaultRows.Children.Add(BuildShotVaultRunHeader(run));

            var grid = new WrapPanel { Orientation = Orientation.Horizontal };
            foreach (var shot in run.Shots)
                grid.Children.Add(BuildShotVaultTile(tilesByPath[shot.FilePath]));
            ShotVaultRows.Children.Add(grid);
        }
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

        var footer = new StackPanel();
        footer.Children.Add(name);
        footer.Children.Add(when);
        footer.Children.Add(copyLink);

        var cell = new StackPanel();
        cell.Children.Add(thumbHost);
        cell.Children.Add(footer);

        return new Border
        {
            Width = ShotVaultTileWidth,
            Margin = new Thickness(0, 0, 8, 8),
            Padding = new Thickness(6),
            CornerRadius = new CornerRadius(4),
            Background = (Brush)FindResource("Brush.Bg.Card"),
            ToolTip = $"{shot.FileName}\n{shot.CreatedAtUtc.ToLocalTime():MMM d, yyyy h:mm:ss tt}" +
                      (tile.HasDiffFromPrevious ? "\nDIFF — changed from the shot before it" : ""),
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
