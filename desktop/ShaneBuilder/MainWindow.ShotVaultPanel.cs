using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2372 (Feature #2367 item 5) — Shot Vault rail panel: the real per-shot Copy action.
///
/// Real audit before this build: Shot Vault (#2367) was entirely `notBuilt` — grouped into
/// <c>MainWindow.xaml.cs</c>'s shared "not built" placeholder alongside Build Console / Build Watch /
/// UI Testing, with no panel, no data source, and no index anywhere in ShaneBuilder. The only real
/// shot-producing mechanism is <see cref="Services.DesktopScreenClipService"/>'s manual desktop clip,
/// which drops loose timestamped PNGs into <c>%Pictures%\Screenshots\ShaneBuilder\</c> with no
/// metadata, tags, or run grouping — there is no existing search/tag/run/thumbnail-diff indexed store
/// to build the fuller panel spec against (that's #2368 search, #2369 tags, #2370 runs, #2371
/// thumbnail-diff — separate, real sibling sub-issues).
///
/// This build stands up the minimum real scaffold #2372 itself needs to exist at all: a real,
/// newest-first list of the actual shots on disk (<see cref="ShotVaultService.ListShots"/>), each row
/// with a real thumbnail and a working Copy action that puts that exact shot back on the clipboard
/// (<see cref="ShotVaultService.CopyToClipboard"/>, itself reusing
/// <see cref="Services.DesktopScreenClipService"/>'s own multi-format clipboard write rather than a
/// second one). Search, tag chips, run grouping, and DIFF badges are deliberately NOT built here —
/// sibling issues extend this same <c>ShotVaultPanelBody</c>/<see cref="RenderShotVaultPanel"/>
/// surface rather than it being redone per issue.
/// </summary>
public partial class MainWindow
{
    private bool _shotVaultPanelLoaded;

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

        ShotVaultPanelStatus.Text = $"{shots.Count} shot{(shots.Count == 1 ? "" : "s")} — newest first.";
        ShotVaultPanelStatus.Visibility = Visibility.Visible;

        foreach (var shot in shots)
            ShotVaultRows.Children.Add(BuildShotVaultRow(shot));
    }

    private Border BuildShotVaultRow(ShotVaultItem shot)
    {
        var thumb = new Image
        {
            Width = 64,
            Height = 40,
            Stretch = Stretch.UniformToFill,
            Margin = new Thickness(0, 0, 8, 0)
        };
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad; // load bytes now, don't hold a file lock
            bmp.DecodePixelWidth = 128; // real shots can be full-screen; decode small for a rail thumbnail
            bmp.UriSource = new Uri(shot.FilePath, UriKind.Absolute);
            bmp.EndInit();
            bmp.Freeze();
            thumb.Source = bmp;
        }
        catch
        {
            // A shot that fails to decode (corrupt, or still mid-write) just renders without a
            // thumbnail — the row, and its real Copy action, still stand.
        }

        var name = new TextBlock
        {
            Text = shot.FileName,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Primary"),
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        var when = new TextBlock
        {
            Text = shot.CreatedAtUtc.ToLocalTime().ToString("MMM d, h:mm tt"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            Margin = new Thickness(0, 2, 0, 0)
        };
        var textCol = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        textCol.Children.Add(name);
        textCol.Children.Add(when);

        // Reuses the same action-link style GitEpicActionLink already established for per-item
        // actions (Hold/Release/Dispatch on the Batter Up panel) rather than inventing a Button
        // style for this one action.
        var copyLink = GitEpicActionLink("Copy", disabled: false, () => ShotVaultCopyClicked(shot));
        copyLink.VerticalAlignment = VerticalAlignment.Center;
        copyLink.Margin = new Thickness(8, 0, 0, 0);

        var row = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };
        DockPanel.SetDock(copyLink, Dock.Right);
        row.Children.Add(copyLink);
        row.Children.Add(thumb);
        row.Children.Add(textCol);

        return new Border
        {
            Padding = new Thickness(6),
            CornerRadius = new CornerRadius(4),
            Background = (Brush)FindResource("Brush.Bg.Card"),
            Child = row
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
