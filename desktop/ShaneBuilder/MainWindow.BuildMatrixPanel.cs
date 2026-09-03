using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace ShaneBuilder;

/// <summary>
/// Git #2287 (Feature #2281 "Build Matrix — agent slot drawer", item 6 of 7) — "Tab" sends the
/// real Matrix drawer built by Git #2286 (items 1-5, MainWindow.xaml.cs's Build Matrix drawer
/// region: <c>_matrixSlotAssignments</c>/<c>RenderMatrixDrawer</c>/<c>MatrixSlotCard</c>) to its
/// own document tab. Real audit before this build: #2286 landed on `main` while this issue was
/// in flight (its own commit explicitly scoped Tab-to-own-tab as out of scope, "#2287" — this
/// issue) — so this reuses that real drawer state rather than building a second one.
///
/// Same real, just-merged mechanism Git #2365 used for the Batter Up panel's own "Send to tab"
/// (itself Git #2312's Git Panel peek split): freeze the live state into a plain record on click,
/// render it inert into its own document tab. No fixture data — the snapshot is read straight off
/// the same real <c>_matrixSlotAssignments</c>/<c>_queueItems</c> the live drawer already shows.
/// </summary>
public sealed record BuildMatrixSlotSnapshot(int Number, bool Busy, int? GithubNumber, string? Title, string? BuildSet, string? Model, string? Status);
public sealed record BuildMatrixDocSnapshot(IReadOnlyList<BuildMatrixSlotSnapshot> Slots, int BusyCount);

public partial class MainWindow
{
    /// <summary>The real, currently-assigned slots (#2286's own admission model), frozen into
    /// plain values for the tab document. Reads the SAME <see cref="_matrixSlotAssignments"/> the
    /// live drawer just rendered from — no second slot-assignment pass.</summary>
    private BuildMatrixDocSnapshot BuildMatrixSnapshotNow()
    {
        var byId = _queueItems.Where(i => i.Status == "Running").ToDictionary(i => i.Id);
        var slots = new List<BuildMatrixSlotSnapshot>(MatrixSlotCount);
        for (int slot = 0; slot < MatrixSlotCount; slot++)
        {
            var itemId = _matrixSlotAssignments.FirstOrDefault(kv => kv.Value == slot).Key;
            QueueItem? item = itemId != null && byId.TryGetValue(itemId, out var found) ? found : null;
            slots.Add(new BuildMatrixSlotSnapshot(
                slot + 1, item != null, item?.GithubNumber, item?.Title, item?.BuildSet, item?.Model, item?.Status));
        }
        return new BuildMatrixDocSnapshot(slots, slots.Count(s => s.Busy));
    }

    /// <summary>"Tab" (#2287) — opens (or refreshes and focuses) a document tab holding a real,
    /// frozen snapshot of the current 8 slots.</summary>
    private void BtnMatrixSendToTab_Click(object sender, MouseButtonEventArgs e)
    {
        var snapshot = BuildMatrixSnapshotNow();

        const string tabId = "buildmatrix-doc";
        var existing = _tabs.Find(t => t.Id == tabId);
        if (existing != null)
            _tabs.Remove(existing); // refresh — slots may have moved since it was last sent

        var tab = new TabDef(tabId, "Build Matrix", buildMatrixSnapshot: snapshot,
            dot: (Brush)FindResource("Brush.Accent.Primary"),
            // Git #2472 taxonomy — a Build Matrix document is a plain reloadable tab, never a
            // dedicated parked WebView2.
            keepAliveClass: TabKeepAliveClass.Reloadable);
        _tabs.Add(tab);
        SelectTab(tabId);
    }

    /// <summary>Renders the "Tab" document (#2287) into the shared BuildMatrixItemDock — the same
    /// 8 slot cards the drawer shows, off the frozen snapshot rather than the live
    /// <c>_queueItems</c>/<c>_matrixSlotAssignments</c> (a slot that finished after this tab was
    /// sent stays showing what it was sent, honestly, not silently live). Inert — clicking a sent
    /// slot does nothing, same "clickable on the live surface, inert on the sent copy" convention
    /// <c>RenderBatterUpDoc</c>/<c>RenderGitItemDoc</c> already use.</summary>
    private void RenderBuildMatrixDoc(TabDef tab)
    {
        BuildMatrixItemDocHost.Children.Clear();
        var snap = tab.BuildMatrixSnapshot;
        if (snap == null) return;

        BuildMatrixItemDocHost.Children.Add(new TextBlock
        {
            Margin = new Thickness(6, 0, 6, 10),
            TextWrapping = TextWrapping.Wrap,
            Text = $"{snap.BusyCount}/{MatrixSlotCount} slots, at send time.",
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
        });

        var grid = new WrapPanel();
        foreach (var s in snap.Slots)
            grid.Children.Add(MatrixDocSlotCard(s));
        BuildMatrixItemDocHost.Children.Add(grid);
    }

    /// <summary>Inert twin of #2286's own <c>MatrixSlotCard</c> — same layout/palette, no pulse
    /// animation and no click handler (a frozen document, not a live drill surface).</summary>
    private Border MatrixDocSlotCard(BuildMatrixSlotSnapshot s)
    {
        var accent = s.Busy && s.Status != null ? StatusBrush(s.Status) : (Brush)FindResource("Brush.Text.Dim");

        var card = new Border
        {
            Width = 150,
            Margin = new Thickness(0, 0, 6, 6),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(8, 6, 8, 6),
            Background = s.Busy ? Tint(accent, 0x1a) : (Brush)FindResource("Brush.Bg.Chip"),
            BorderBrush = s.Busy ? Tint(accent, 0x66) : (Brush)FindResource("Brush.Border.Default"),
            BorderThickness = new Thickness(1),
            Opacity = s.Busy ? 1.0 : 0.45
        };

        var stack = new StackPanel();
        stack.Children.Add(new TextBlock
        {
            Text = $"SLOT {s.Number}",
            FontFamily = (FontFamily)FindResource("FontFamily.Monospace"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });

        if (s.Busy)
        {
            var (slotFg, slotBg, slotBorder) = StatusPalette(s.Status ?? "Running");
            stack.Children.Add(StatusPill(s.Status ?? "Running", slotFg, slotBg, slotBorder));
            stack.Children.Add(new TextBlock
            {
                Text = s.GithubNumber.HasValue ? $"#{s.GithubNumber.Value} {s.Title}" : s.Title,
                Margin = new Thickness(0, 4, 0, 0),
                TextTrimming = TextTrimming.CharacterEllipsis,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.10.5"),
                FontWeight = (FontWeight)FindResource("FontWeight.SemiBold"),
                Foreground = (Brush)FindResource("Brush.Text.Primary")
            });
            stack.Children.Add(new TextBlock
            {
                Text = string.Join(" · ", new[] { s.BuildSet, s.Model }.Where(v => !string.IsNullOrWhiteSpace(v))),
                Margin = new Thickness(0, 2, 0, 0),
                TextTrimming = TextTrimming.CharacterEllipsis,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 9,
                Foreground = (Brush)FindResource("Brush.Text.Muted")
            });
        }
        else
        {
            stack.Children.Add(new TextBlock
            {
                Text = "Idle",
                Margin = new Thickness(0, 4, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
        }

        card.Child = stack;
        return card;
    }
}
