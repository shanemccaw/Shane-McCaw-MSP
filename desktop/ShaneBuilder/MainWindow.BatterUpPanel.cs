using System;
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
/// Scope, per #2356's own final dispatch comment: shell + lanes + counts ONLY. Grouping by
/// feature, group headers, item rendering/actions, and everything else are separate builds on
/// #2357 onward — <see cref="BatterUpLaneBody"/> deliberately stays a plain status line naming
/// the selected lane's count rather than rendering invented rows.
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

    /// <summary>Item rendering/grouping is out of scope for this build (#2357 onward) — an honest
    /// count-only line for whichever lane is selected, not invented rows.</summary>
    private void RenderBatterUpLaneBody()
    {
        BatterUpLaneBody.Children.Clear();
        var counts = _batterUpCounts;
        if (counts == null) return;

        int laneCount = BatterUpLaneCount(counts, _batterUpSelectedLane);
        string laneLabel = BatterUpLaneLabel(_batterUpSelectedLane);

        BatterUpLaneBody.Children.Add(new TextBlock
        {
            Margin = new Thickness(6, 0, 6, 0),
            TextWrapping = TextWrapping.Wrap,
            Text = $"{laneCount} item(s) in {laneLabel}. Grouping and item rendering land in a later build (#2357 onward).",
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
        });
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
    /// moved the real counts; the doc stays honest about what it was sent, not silently live).</summary>
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
            Text = $"{snap.LaneCount} item(s) in {snap.LaneLabel}. Grouping and item rendering land in a later build (#2357 onward).",
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
        });
    }
}
