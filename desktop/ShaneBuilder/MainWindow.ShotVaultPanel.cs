using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2372 (Feature #2367 item 5) — Shot Vault rail panel: the real per-shot Copy action.
/// Git #2371 (Feature #2367 item 4) — the row list became a wrapped thumbnail grid, and each tile
/// carries a real, computed DIFF badge.
///
/// Real audit before the #2372 build: Shot Vault (#2367) was entirely `notBuilt` — grouped into
/// <c>MainWindow.xaml.cs</c>'s shared "not built" placeholder alongside Build Console / Build Watch /
/// UI Testing, with no panel, no data source, and no index anywhere in ShaneBuilder. The only real
/// shot-producing mechanism is <see cref="Services.DesktopScreenClipService"/>'s manual desktop clip,
/// which drops loose timestamped PNGs into <c>%Pictures%\Screenshots\ShaneBuilder\</c> with no
/// metadata, tags, or run grouping — there is still no search/tag/run indexed store to build the
/// fuller panel spec against (that's #2368 search, #2369 tags, #2370 runs — separate, real sibling
/// sub-issues, still open).
///
/// This build (#2371) lays the grid out with <see cref="Services.ShotVaultService.BuildTiles"/>, which
/// pairs every real shot on disk with a real DIFF flag computed from a downsampled MD5 of its actual
/// pixels against the shot immediately before it in time (there's no run/screen grouping yet to diff
/// within, so "immediately before" is the only real ordering that exists — see the service for the
/// honest reasoning). No fixture DIFF state, no random/rotating badge — a tile is only badged when its
/// own bytes actually changed. Search, tag chips, and run grouping remain deliberately NOT built here;
/// sibling issues extend this same <c>ShotVaultPanelBody</c>/<see cref="RenderShotVaultPanel"/> surface
/// rather than it being redone per issue.
/// </summary>
public partial class MainWindow
{
    private bool _shotVaultPanelLoaded;

    private const double ShotVaultTileWidth = 140;
    private const double ShotVaultThumbHeight = 84;

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

        IReadOnlyList<ShotVaultItem> shots;
        try
        {
            shots = ShotVaultService.ListShots();
        }
        catch (Exception ex)
        {
            ShotVaultPanelStatus.Text = $"Couldn't read the shots folder — {ex.Message}";
            ShotVaultPanelStatus.Visibility = Visibility.Visible;
            return;
        }

        if (shots.Count == 0)
        {
            ShotVaultPanelStatus.Text = $"No shots yet — captures land in {ShotVaultService.ShotsDirectory}.";
            ShotVaultPanelStatus.Visibility = Visibility.Visible;
            return;
        }

        var tiles = ShotVaultService.BuildTiles(shots);
        int diffCount = tiles.Count(t => t.HasDiffFromPrevious);
        ShotVaultPanelStatus.Text = diffCount == 0
            ? $"{shots.Count} shot{(shots.Count == 1 ? "" : "s")} — newest first."
            : $"{shots.Count} shot{(shots.Count == 1 ? "" : "s")} — newest first, {diffCount} DIFF from the shot before it.";
        ShotVaultPanelStatus.Visibility = Visibility.Visible;

        foreach (var tile in tiles)
            ShotVaultRows.Children.Add(BuildShotVaultTile(tile));
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
}
