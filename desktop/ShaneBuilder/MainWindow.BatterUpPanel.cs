using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
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
public partial class MainWindow
{
    private enum BatterUpLane { All, BatterUp, AiBatterUp, AskShane }

    private bool _batterUpPanelLoaded;
    private bool _batterUpPanelLoading;
    private BatterUpLaneCounts? _batterUpCounts;
    private BatterUpLane _batterUpSelectedLane = BatterUpLane.All;

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

    /// <summary>Item rendering/grouping is out of scope for this build (#2357 onward) — an honest
    /// count-only line for whichever lane is selected, not invented rows.</summary>
    private void RenderBatterUpLaneBody()
    {
        BatterUpLaneBody.Children.Clear();
        var counts = _batterUpCounts;
        if (counts == null) return;

        int laneCount = _batterUpSelectedLane switch
        {
            BatterUpLane.BatterUp => counts.BatterUp,
            BatterUpLane.AiBatterUp => counts.AiBatterUp,
            BatterUpLane.AskShane => counts.AskShane,
            _ => counts.All,
        };
        string laneLabel = _batterUpSelectedLane switch
        {
            BatterUpLane.BatterUp => "Batter Up",
            BatterUpLane.AiBatterUp => "AI Batter Up",
            BatterUpLane.AskShane => "Ask Shane",
            _ => "All",
        };

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
}
