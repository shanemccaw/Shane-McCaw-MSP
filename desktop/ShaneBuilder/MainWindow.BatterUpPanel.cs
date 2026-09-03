using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2356 (Feature #2355 item 1) — the Batter Up rail panel shell: the lane switch (All /
/// Batter Up / AI Batter Up / Ask Shane) with a real live count per tab.
///
/// Real audit before this build: <c>MainWindow.xaml.cs</c> only had a <c>BatterUp</c> rail-icon
/// stub folded into the shared "not built" placeholder — no panel content, no data read, existed
/// anywhere. This is the real thing, not a patch: counts come from
/// <see cref="ChatGitHubFilter.GetBatterUpLaneCountsAsync"/>, a genuine backward-paginated GraphQL
/// walk of the whole AI/Batter-Up project board's Status field (same pagination shape as
/// BuildConsole's own <c>GitHubApiClient.ScanProjectItemsForStatusAsync</c>).
///
/// Git #2357 (Feature #2355 item 2) — group each lane's real items by their real immediate parent
/// Feature (the GraphQL <c>parent</c> edge fetched inline by the same board walk — see
/// <see cref="ChatGitHubFilter.BatterUpItemRef"/>), and keep which groups exist and their
/// expand/collapse state stable across lane switches via <see cref="_batterUpCollapsedGroups"/>,
/// an instance field never reset by <see cref="RenderBatterUpPanel"/>/<see cref="SelectBatterUpLane"/>.
/// An issue with no real parent gets an honest "No Feature" bucket — never an invented grouping
/// key. Group header content (badges/actions) is out of scope here — #2358/#2359/#2360 land the
/// richer header/item content on top of this grouping+persistence structure.
///
/// Git #2364 (Feature #2355 item 9) — that no-parent bucket is now flagged, not just another
/// group: distinct warning-tinted styling, an honest "needs a home before it can be built" label,
/// and it sorts last (the existing #2357 <c>OrderBy</c> already puts key 0 at the end) so items
/// with nothing to build against visibly collect at the bottom of the panel instead of blending
/// into the real Feature groups above them.
/// </summary>
/// <summary>Git #2365 — a frozen snapshot of the Batter Up panel's real state (selected lane +
/// the four live counts) at the moment "Send to tab" was clicked. Carried on <c>TabDef</c>, read
/// by <see cref="MainWindow.RenderBatterUpDoc"/>.</summary>
public sealed record BatterUpDocSnapshot(string LaneLabel, int LaneCount, int All, int BatterUp, int AiBatterUp, int AskShane, bool Complete);

public partial class MainWindow
{
    private enum BatterUpLane { All, BatterUp, AiBatterUp, AskShane }

    private bool _batterUpPanelLoaded;
    private bool _batterUpPanelLoading;
    private BatterUpLaneCounts? _batterUpCounts;
    private BatterUpLane _batterUpSelectedLane = BatterUpLane.All;

    // Git #2365 — "Expand full page here" widens the rail panel in place (no tab opened); "Send to
    // tab" is the explicit opt-in takeover that opens the same real lane/count state in a document
    // tab (BatterUpItemDock). Same split, same widths, as Git #2312 built for the Git Panel peek —
    // reused rather than reinvented for this panel.
    private bool _batterUpExpanded;

    /// <summary>Git #2357 — real parent-Feature numbers the user has collapsed. Keyed by feature
    /// number (0 = the "No Feature" bucket). Deliberately an instance field, not lane-scoped and
    /// never cleared by a lane switch, so a group's expand/collapse choice survives switching
    /// lanes and back — the whole point of this build.</summary>
    private readonly HashSet<int> _batterUpCollapsedGroups = new();

    /// <summary>Fires the real lane-count walk the first time the BATTER UP rail panel opens.
    /// A failed walk reports its real error in the status line; nothing falls back to a fixture
    /// count.</summary>
    private async Task EnsureBatterUpPanelLoadedAsync()
    {
        if (_batterUpPanelLoading) return;
        if (_batterUpPanelLoaded) { RenderBatterUpPanel(); return; }

        _batterUpPanelLoading = true;
        BatterUpPanelStatus.Text = "Loading real board counts…";
        BatterUpPanelStatus.Visibility = Visibility.Visible;

        var counts = await _chatGitHubFilter.GetBatterUpLaneCountsAsync();

        _batterUpPanelLoading = false;
        _batterUpCounts = counts;
        _batterUpPanelLoaded = counts.Success; // a total failure stays unloaded so reopening retries

        if (!counts.Success)
        {
            BatterUpPanelStatus.Text = "GitHub unreachable — " + (counts.Error ?? "unknown error");
            BatterUpLaneTabs.Children.Clear();
            BatterUpLaneBody.Children.Clear();
            return;
        }

        RenderBatterUpPanel();
    }

    private void RenderBatterUpPanel()
    {
        var counts = _batterUpCounts;
        if (counts == null || !counts.Success) return;

        BatterUpPanelStatus.Text = counts.Complete
            ? "Live counts from the AI/Batter-Up project board."
            : "Live counts (partial — the board walk hit a page cap or a transient error; refresh to retry).";
        BatterUpPanelStatus.Visibility = Visibility.Visible;

        BatterUpLaneTabs.Children.Clear();
        BatterUpLaneTabs.Children.Add(BatterUpLaneChip("All", counts.All, BatterUpLane.All));
        BatterUpLaneTabs.Children.Add(BatterUpLaneChip("Batter Up", counts.BatterUp, BatterUpLane.BatterUp));
        BatterUpLaneTabs.Children.Add(BatterUpLaneChip("AI Batter Up", counts.AiBatterUp, BatterUpLane.AiBatterUp));
        BatterUpLaneTabs.Children.Add(BatterUpLaneChip("Ask Shane", counts.AskShane, BatterUpLane.AskShane));

        RenderBatterUpLaneBody();
    }

    private Border BatterUpLaneChip(string label, int count, BatterUpLane lane) =>
        FsCountChip(label, count, null, _batterUpSelectedLane == lane, () => SelectBatterUpLane(lane));

    private void SelectBatterUpLane(BatterUpLane lane)
    {
        if (_batterUpSelectedLane == lane) return;
        _batterUpSelectedLane = lane;
        RenderBatterUpPanel();
    }

    private static int BatterUpLaneCount(BatterUpLaneCounts counts, BatterUpLane lane) => lane switch
    {
        BatterUpLane.BatterUp => counts.BatterUp,
        BatterUpLane.AiBatterUp => counts.AiBatterUp,
        BatterUpLane.AskShane => counts.AskShane,
        _ => counts.All,
    };

    private static string BatterUpLaneLabel(BatterUpLane lane) => lane switch
    {
        BatterUpLane.BatterUp => "Batter Up",
        BatterUpLane.AiBatterUp => "AI Batter Up",
        BatterUpLane.AskShane => "Ask Shane",
        _ => "All",
    };

    private static List<BatterUpItemRef> BatterUpLaneItems(BatterUpLaneCounts counts, BatterUpLane lane) => lane switch
    {
        BatterUpLane.BatterUp => counts.BatterUpItems,
        BatterUpLane.AiBatterUp => counts.AiBatterUpItems,
        BatterUpLane.AskShane => counts.AskShaneItems,
        _ => counts.BatterUpItems.Concat(counts.AiBatterUpItems).Concat(counts.AskShaneItems).ToList(),
    };

    /// <summary>Git #2357 — real items for the selected lane, grouped by real parent Feature.
    /// Group header content beyond number/title/count and item content beyond number/title are
    /// deliberately out of scope (#2358/#2359/#2360 land those on top of this structure); this
    /// build is the grouping + persisted expand/collapse state only.</summary>
    private void RenderBatterUpLaneBody()
    {
        BatterUpLaneBody.Children.Clear();
        var counts = _batterUpCounts;
        if (counts == null) return;

        var items = BatterUpLaneItems(counts, _batterUpSelectedLane);
        string laneLabel = BatterUpLaneLabel(_batterUpSelectedLane);

        if (items.Count == 0)
        {
            BatterUpLaneBody.Children.Add(GitDimLine($"No items in {laneLabel}.", indent: 6));
            return;
        }

        // Group by real parent Feature (Git #2357). No parent = an honest "No Feature" bucket
        // (key 0), never an invented grouping key. Sorting by real feature number (not insertion
        // order) is what keeps a given feature's group in the same visual slot across re-renders —
        // part of what "stable across lane switches" means here; the "No Feature" bucket sorts last.
        var groups = items
            .GroupBy(i => i.FeatureNumber ?? 0)
            .OrderBy(g => g.Key == 0 ? int.MaxValue : g.Key)
            .ToList();

        foreach (var group in groups)
        {
            int featureNumber = group.Key;
            // Git #2364 — the no-parent bucket isn't just another group: it's flagged, distinctly
            // styled, and sorts last (already true via the OrderBy above) so items with nothing to
            // build against collect at the bottom rather than blending into the real Feature groups.
            bool isNoHome = featureNumber == 0;
            string headerLabel = isNoHome
                ? "No Feature — needs a home before it can be built"
                : $"#{featureNumber} {group.First().FeatureTitle}";
            string headerBrushKey = isNoHome ? "Brush.Toast.Warning" : "Brush.Text.Primary";
            // Never reset by a lane switch — this is the persistence #2357 asks for.
            bool expanded = !_batterUpCollapsedGroups.Contains(featureNumber);

            var header = GitRowShell(indent: 6);
            header.ColumnLeft(GitChevron(expanded));
            var headerText = GitText(headerLabel, 10.5, headerBrushKey);
            headerText.TextTrimming = TextTrimming.CharacterEllipsis;
            headerText.Margin = new Thickness(4, 0, 4, 0);
            if (isNoHome) headerText.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
            header.ColumnFill(headerText);
            header.ColumnRight(GitCountPill(group.Count().ToString(), isNoHome ? "Brush.Toast.Warning" : "Brush.Text.Muted"));
            header.Root.MouseLeftButtonDown += (_, _) => ToggleBatterUpGroup(featureNumber);
            if (isNoHome)
            {
                var warn = (SolidColorBrush)FindResource("Brush.Toast.Warning");
                header.Root.Background = new SolidColorBrush(warn.Color) { Opacity = 0.08 };
                header.Root.BorderBrush = new SolidColorBrush(warn.Color) { Opacity = 0.35 };
                header.Root.BorderThickness = new Thickness(0, 1, 0, 1);
            }
            BatterUpLaneBody.Children.Add(header.Root);

            if (!expanded) continue;

            foreach (var item in group)
            {
                var row = GitRowShell(indent: 24);
                row.ColumnLeft(GitMono($"#{item.Number}", 10, "Brush.Accent.IssueNum"));
                var itemText = GitText(item.Title, 10.5, "Brush.Text.Muted");
                itemText.TextTrimming = TextTrimming.CharacterEllipsis;
                itemText.Margin = new Thickness(5, 0, 0, 0);
                row.ColumnFill(itemText);
                BatterUpLaneBody.Children.Add(row.Root);
            }
        }
    }

    /// <summary>Toggles one group's expand/collapse state and re-renders. The state lives in
    /// <see cref="_batterUpCollapsedGroups"/>, so it survives the next lane switch untouched.</summary>
    private void ToggleBatterUpGroup(int featureNumber)
    {
        if (!_batterUpCollapsedGroups.Remove(featureNumber))
            _batterUpCollapsedGroups.Add(featureNumber);
        RenderBatterUpLaneBody();
    }

    // ── Panel-level chrome (#2365) ───────────────────────────────────────────────────────────

    /// <summary>Widens/collapses the rail in place for "Expand full page here" (#2365). Only
    /// touches the shared <c>LeftPanel</c> while Batter Up is the one actually showing it —
    /// switching rail sources (Git/Chats/NextUp) leaves this state behind rather than stretching
    /// an unrelated panel. Same width Git #2312 uses for its own peek expand.</summary>
    private void SetBatterUpExpanded(bool expanded)
    {
        _batterUpExpanded = expanded;
        BtnBatterUpExpand.ToolTip = expanded ? "Collapse back to the rail width" : "Expand full page here";
        if (_leftPanelSource == "BatterUp")
            LeftPanel.Width = expanded ? GitPeekExpandedWidth : LeftPanelWidth;
    }

    private void BtnBatterUpExpand_Click(object sender, MouseButtonEventArgs e) => SetBatterUpExpanded(!_batterUpExpanded);

    /// <summary>"Send to tab" (#2365) — opens (or refreshes and focuses) a document tab holding a
    /// real snapshot of the panel's current selected lane + live counts, via the exact same
    /// <see cref="RenderBatterUpDoc"/> path. One real board-backed panel, two surfaces — same
    /// "widen in place vs. explicit opt-in takeover" split Git #2312 built for the Git Panel
    /// peek.</summary>
    private void BtnBatterUpSendToTab_Click(object sender, MouseButtonEventArgs e)
    {
        var counts = _batterUpCounts;
        if (counts == null || !counts.Success) return;

        var snapshot = new BatterUpDocSnapshot(
            BatterUpLaneLabel(_batterUpSelectedLane),
            BatterUpLaneCount(counts, _batterUpSelectedLane),
            counts.All, counts.BatterUp, counts.AiBatterUp, counts.AskShane, counts.Complete);

        const string tabId = "batterup-doc";
        var existing = _tabs.Find(t => t.Id == tabId);
        if (existing != null)
        {
            _tabs.Remove(existing); // refresh — counts may have moved since it was last sent
        }

        var tab = new TabDef(tabId, "Batter Up", batterUpSnapshot: snapshot,
            dot: (Brush)FindResource("Brush.Accent.Primary"),
            // Git #2472 — explicit, not just the default: a Batter Up document is the contract's
            // named reloadable class, never a dedicated parked WebView2.
            keepAliveClass: TabKeepAliveClass.Reloadable);
        _tabs.Add(tab);
        SelectTab(tabId);
    }

    /// <summary>Renders a "Send to tab" document (#2365) into the shared BatterUpItemDock — the
    /// same lane chips + status line the rail panel shows, off the frozen snapshot rather than the
    /// live <c>_batterUpCounts</c> (a re-open of the rail panel after this tab was sent may have
    /// moved the real counts; the doc stays honest about what it was sent, not silently live).
    /// The snapshot only carries counts, not the real items/parents #2357 groups by, so this
    /// frozen doc deliberately stays count-only rather than faking a grouped item list it never
    /// captured.</summary>
    private void RenderBatterUpDoc(TabDef tab)
    {
        BatterUpItemDocHost.Children.Clear();
        var snap = tab.BatterUpSnapshot;
        if (snap == null) return;

        var status = new TextBlock
        {
            Margin = new Thickness(6, 0, 6, 10),
            TextWrapping = TextWrapping.Wrap,
            Text = snap.Complete
                ? "Live counts from the AI/Batter-Up project board, at send time."
                : "Live counts (partial — the board walk hit a page cap or a transient error), at send time.",
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
        };
        BatterUpItemDocHost.Children.Add(status);

        // Inert — a frozen snapshot, not a live drill surface (same "clickable on the live rail,
        // inert on the sent copy" split RenderGitIdentityBlock uses for its breadcrumb).
        static void NoPick() { }
        var chips = new WrapPanel { Margin = new Thickness(6, 0, 6, 10) };
        chips.Children.Add(FsCountChip("All", snap.All, null, snap.LaneLabel == "All", NoPick));
        chips.Children.Add(FsCountChip("Batter Up", snap.BatterUp, null, snap.LaneLabel == "Batter Up", NoPick));
        chips.Children.Add(FsCountChip("AI Batter Up", snap.AiBatterUp, null, snap.LaneLabel == "AI Batter Up", NoPick));
        chips.Children.Add(FsCountChip("Ask Shane", snap.AskShane, null, snap.LaneLabel == "Ask Shane", NoPick));
        BatterUpItemDocHost.Children.Add(chips);

        BatterUpItemDocHost.Children.Add(new TextBlock
        {
            Margin = new Thickness(6, 0, 6, 0),
            TextWrapping = TextWrapping.Wrap,
            Text = $"{snap.LaneCount} item(s) in {snap.LaneLabel}. This sent copy is count-only — grouped items are a live-panel-only view.",
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
        });
    }
}
