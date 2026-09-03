using System;
using System.Collections.Generic;
using System.Diagnostics;
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
/// key. Group header content (badges/actions) is out of scope here — #2358/#2360 land the
/// richer header content on top of this grouping+persistence structure.
///
/// Git #2364 (Feature #2355 item 9) — that no-parent bucket is now flagged, not just another
/// group: distinct warning-tinted styling, an honest "needs a home before it can be built" label,
/// and it sorts last (the existing #2357 <c>OrderBy</c> already puts key 0 at the end) so items
/// with nothing to build against visibly collect at the bottom of the panel instead of blending
/// into the real Feature groups above them.
///
/// Git #2359 (Feature #2355 item 4) — each item row now carries real per-item detail: an AGENT
/// FOUND / CHAT FILED badge (the real <c>agent-finding</c> label — both origins are AI-authored,
/// this label is the only structural signal that distinguishes an unplanned mid-build finding from
/// a planned chat-filed issue), a real effort label (the item's own most-recent <c>BUILD:</c>
/// comment's <c>effort=</c> token, or an honest "not yet estimated"), and a real "why it is here"
/// line (that comment's stated scope, or the issue body). Resolved by
/// <see cref="ChatGitHubFilter.EnrichBatterUpItemDetailsAsync"/> — a second, batched GraphQL call
/// scoped to just the real items already sorted into a lane, not the whole board walk.
///
/// Git #2358 (Feature #2355 item 3) — each real feature group's header row now also carries a
/// real state pill for the group's parent Feature (same CLOSED/BLOCKED/IN FLIGHT/COMPLETE/OPEN
/// vocabulary <see cref="GitNodeState"/> already established for Feature rows in the Git Panel
/// tree — reused, not reinvented) and a "Dispatch all" action link. State/labels come off the
/// same real <c>parent</c> GraphQL edge #2357 already fetches, extended in the same query (see
/// <see cref="ChatGitHubFilter.BatterUpItemRef.FeatureIsClosed"/>/<c>FeatureLabels</c>) — no
/// second round trip. "Dispatch all" is button-and-affordance-only here, per this issue's own
/// scope: the click handler is a stub reporting an honest "not wired yet" status line, since the
/// real dispatch semantics land downstream in #2366 (built on top of #2360's per-item actions).
/// The "No Feature" bucket gets neither — there's no real parent Feature to show state for or
/// dispatch against.
///
/// Git #2360 (Feature #2355 item 5) — each item row now carries real per-item action links:
/// Hold / Release moves the item's real board Status to/from Park (<see
/// cref="GitEpicPanelService.StatusOption_Park"/> — the same real bucket #2307/#2308 built for
/// exactly this "pull it out of the queue, put it in its own queue away from the build" use
/// case), via the same <see cref="GitEpicPanelService.SetProjectStatusAsync"/> write path that
/// panel already uses; Release writes back to <see cref="BatterUpItemRef.LaneOptionId"/> — the
/// real lane the item was actually sitting in, not a guessed default. Dispatch is deliberately
/// NOT a queue write (per #2360's own governing comment, #2366 owns that): it opens the real
/// issue in the browser and copies a ready-to-act prompt to the clipboard, leaving the actual
/// build-prompt-and-queue-push flow as a real, named hook point (<see cref="BatterUpDispatchClicked"/>)
/// for #2366 to extend.
///
/// Git #2366 (Feature #2355 item 11) — enforces the real flow #2355's own body states in words: a
/// Batter Up item requires a build prompt written by Claude in chat after approval, then a Git
/// issue push, then an app-side Git refresh; nothing may write to the queue directly. Audited
/// #2360's own Dispatch implementation first — it already only opens the browser + copies a
/// clipboard prompt, no direct write of any kind — so this issue's real work is turning that
/// already-correct behavior into a runtime-enforced boundary instead of a boundary that only
/// exists as a doc comment: <see cref="Services.BatterUpDispatchGuard"/> marks Dispatch's call
/// scope, and the app's two real write choke points — <see cref="Services.QueueWriteClient"/>'s
/// direct `bt_build_queue` mutations (added for Build Matrix's #2288 slot actions) and
/// <see cref="Services.GitMapService"/>'s `gh` CLI runner (the only path to a `gh issue comment`)
/// — both throw immediately if reached from inside that scope.
///
/// Git #2361 (Feature #2355 item 6) — a real "Ask Shane" lane item renders as a question: a real
/// NEEDS YOU badge, an amber row tint (the same <c>Brush.Toast.Warning</c> token #2364's
/// "No Feature" bucket and #2311's amber banner already use), and the real reason it's blocking —
/// the issue's own most-recent comment (or body, when there's no comment yet) — replacing the
/// generic "why it is here" line for just these items. Ask Shane membership is checked by number
/// against <c>counts.AskShaneItems</c>, not by which lane tab is currently selected, so the badge
/// still shows correctly on the "All" tab.
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

    /// <summary>Git #2360 — real items currently held (their board Status was written to Park by
    /// this panel's own Hold action this session). Kept locally, same convention as
    /// <see cref="_gitEpicActionBusy"/>: the real write already happened on GitHub; this just lets
    /// the row keep showing (with a Release action) instead of vanishing until the next full lane
    /// walk re-fetches from the board.</summary>
    private readonly HashSet<int> _batterUpHeldItems = new();

    /// <summary>Git #2360 — items with a Hold/Release/Dispatch write in flight, so a second click
    /// can't double-fire the same mutation. Same pattern as <see cref="_gitEpicActionBusy"/>.</summary>
    private readonly HashSet<int> _batterUpActionBusy = new();

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

        if (!counts.Success)
        {
            _batterUpPanelLoading = false;
            _batterUpCounts = counts;
            _batterUpPanelLoaded = false; // a total failure stays unloaded so reopening retries
            BatterUpPanelStatus.Text = "GitHub unreachable — " + (counts.Error ?? "unknown error");
            BatterUpLaneTabs.Children.Clear();
            BatterUpLaneBody.Children.Clear();
            return;
        }

        // Git #2359 — a second, batched detail fetch (badge/effort/why-here) scoped to just the
        // real items the lane walk resolved, not the whole board. A failure here doesn't fail the
        // whole panel load — items just render with an honest "couldn't load" detail state.
        var allItems = counts.BatterUpItems.Concat(counts.AiBatterUpItems).Concat(counts.AskShaneItems).ToList();
        if (allItems.Count > 0)
        {
            BatterUpPanelStatus.Text = "Loading item details…";
            await _chatGitHubFilter.EnrichBatterUpItemDetailsAsync(allItems);
        }

        _batterUpPanelLoading = false;
        _batterUpCounts = counts;
        _batterUpPanelLoaded = true;

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

    /// <summary>Git #2357 — real items for the selected lane, grouped by real parent Feature, with
    /// persisted expand/collapse state. Git #2364 flags the no-parent bucket distinctly. Git #2359
    /// adds each item's real badge/effort/why-here detail (see <see cref="BatterUpEffortLabel"/>/
    /// <see cref="BatterUpWhyHereLabel"/>). Group header content beyond number/title/count is still
    /// out of scope here — #2358 lands that on top of this structure.</summary>
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

        // Git #2361 — real Ask Shane membership by number, not by which lane is currently
        // selected: the "All" lane concatenates all three lists and loses per-item lane
        // identity, so an Ask Shane item must still read as one there too.
        var askShaneNumbers = counts.AskShaneItems.Select(i => i.Number).ToHashSet();

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

            // Git #2358 — real state pill for the group's parent Feature (same left-to-right
            // convention the Git Panel tree's fRow already uses: state closest to the title, then
            // the count, then the "Dispatch all" action rightmost), then the real count pill, then
            // "Dispatch all" (stub — button/affordance only, see class doc). Neither the state
            // pill nor the button render for the "No Feature" bucket — there's no real parent
            // Feature to show state for or dispatch against.
            if (!isNoHome)
            {
                var (stateLabel, stateBrushKey) = BatterUpFeatureState(group.First());
                header.ColumnRight(GitCountPill(stateLabel, stateBrushKey));
            }
            header.ColumnRight(GitCountPill(group.Count().ToString(), isNoHome ? "Brush.Toast.Warning" : "Brush.Text.Muted"));
            if (!isNoHome)
            {
                var groupItems = group.ToList();
                var dispatchLink = GitEpicActionLink("Dispatch all", disabled: false,
                    () => BatterUpDispatchAllClicked(featureNumber, group.First().FeatureTitle ?? $"#{featureNumber}", groupItems.Count));
                dispatchLink.Margin = new Thickness(8, 0, 0, 0);
                header.ColumnRight(dispatchLink);
            }
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
                bool isAskShane = askShaneNumbers.Contains(item.Number);

                var row = GitRowShell(indent: 24);
                row.ColumnLeft(GitMono($"#{item.Number}", 10, "Brush.Accent.IssueNum"));
                var itemText = GitText(item.Title, 10.5, "Brush.Text.Muted");
                itemText.TextTrimming = TextTrimming.CharacterEllipsis;
                itemText.Margin = new Thickness(5, 0, 0, 0);
                row.ColumnFill(itemText);
                // Git #2359 — real badge (AGENT FOUND / CHAT FILED) + real effort label, right of
                // the title, using the same right-column pill pattern the Git Panel feature rows
                // already use for their own state/bug/open pills.
                bool held = _batterUpHeldItems.Contains(item.Number);
                if (held) row.ColumnRight(GitCountPill("HELD", "Brush.Status.Parked"));
                row.ColumnRight(GitCountPill(BatterUpEffortLabel(item), "Brush.Text.Dim"));
                row.ColumnRight(GitCountPill(
                    item.IsAgentFinding ? "AGENT FOUND" : "CHAT FILED",
                    item.IsAgentFinding ? "Brush.Status.Running" : "Brush.Text.Muted"));
                // Git #2361 — a real Ask Shane item is a question, not just another row: a NEEDS
                // YOU badge and an amber row tint, reusing the same Brush.Toast.Warning token
                // #2364's "No Feature" bucket and #2311's amber banner already use — never a new
                // amber invented for this.
                if (isAskShane)
                {
                    row.ColumnRight(GitCountPill("NEEDS YOU", "Brush.Toast.Warning"));
                    var askWarn = (SolidColorBrush)FindResource("Brush.Toast.Warning");
                    row.Root.Background = new SolidColorBrush(askWarn.Color) { Opacity = 0.08 };
                    row.Root.BorderBrush = new SolidColorBrush(askWarn.Color) { Opacity = 0.35 };
                    row.Root.BorderThickness = new Thickness(0, 1, 0, 1);
                }
                BatterUpLaneBody.Children.Add(row.Root);
                // The real reason it's blocking (the issue's own most-recent comment or body —
                // never invented) replaces the generic "why it is here" scope line for an Ask
                // Shane item, since that's the actually load-bearing question here.
                BatterUpLaneBody.Children.Add(BatterUpWhyHereLine(
                    isAskShane ? BatterUpBlockingReasonLabel(item) : BatterUpWhyHereLabel(item),
                    indent: 44));
                // Git #2360 — real per-item actions: Dispatch, and Hold/Release.
                BatterUpLaneBody.Children.Add(BatterUpActionRow(item, held));
            }
        }
    }

    /// <summary>Git #2359 — the real effort label: the item's own parsed `effort=` value when a
    /// `BUILD:` comment exists, an honest "unknown" when the detail fetch for this item's batch
    /// failed (never silently mislabeled as "not yet estimated"), else the real "not yet
    /// estimated" state for an item that genuinely hasn't been dispatched yet.</summary>
    private static string BatterUpEffortLabel(BatterUpItemRef item) =>
        item.DetailError != null ? "effort: unknown"
        : string.IsNullOrWhiteSpace(item.Effort) ? "not yet estimated"
        : $"effort: {item.Effort}";

    /// <summary>Git #2359 — the real "why it is here" line: the item's most-recent `BUILD:`
    /// comment's stated scope, or its issue body, per <see cref="ChatGitHubFilter.EnrichBatterUpItemDetailsAsync"/>.
    /// Never invented — a genuine fetch failure or a genuinely empty body/comment both say so
    /// plainly instead of fabricating text.</summary>
    private static string BatterUpWhyHereLabel(BatterUpItemRef item) =>
        item.DetailError != null ? $"Couldn't load why this is here — {item.DetailError}"
        : string.IsNullOrWhiteSpace(item.WhyHere) ? "No description yet."
        : item.WhyHere!;

    /// <summary>Git #2361 — the real reason a genuine Ask Shane item is blocking: its issue's own
    /// most-recent comment or body (see <see cref="ChatGitHubFilter.BatterUpItemRef.BlockingReason"/>),
    /// never invented. A genuine fetch failure or a genuinely empty body/comment both say so
    /// plainly, same honesty convention as <see cref="BatterUpWhyHereLabel"/>.</summary>
    private static string BatterUpBlockingReasonLabel(BatterUpItemRef item) =>
        item.DetailError != null ? $"Couldn't load why this is blocking — {item.DetailError}"
        : string.IsNullOrWhiteSpace(item.BlockingReason) ? "No open question stated yet."
        : item.BlockingReason!;

    /// <summary>A single-line, ellipsis-truncated dim/italic line under a Batter Up item row —
    /// the real "why it is here" text. Deliberately non-wrapping so a long scope paragraph doesn't
    /// blow out the row height; the full text remains available via the item's real GitHub body/
    /// BUILD comment, not reproduced here.</summary>
    private TextBlock BatterUpWhyHereLine(string text, double indent)
    {
        var tb = GitText(text, 9.5, "Brush.Text.Dim");
        tb.Margin = new Thickness(indent, 0, 6, 5);
        tb.FontStyle = FontStyles.Italic;
        tb.TextTrimming = TextTrimming.CharacterEllipsis;
        tb.ToolTip = text;
        return tb;
    }

    // ── Git #2360 — per-item actions: Dispatch, Hold/Release ────────────────────────────────

    /// <summary>The real action row under a Batter Up item: Hold/Release (toggles on <paramref
    /// name="held"/>) and Dispatch, reusing the same <see cref="GitEpicActionLink"/> link-style
    /// action the Git Panel's Epic peek already established for Queue all/Park/Pause.</summary>
    private StackPanel BatterUpActionRow(BatterUpItemRef item, bool held)
    {
        bool busy = _batterUpActionBusy.Contains(item.Number);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(44, 0, 6, 6) };
        row.Children.Add(GitEpicActionLink(
            busy ? "…" : (held ? "Release" : "Hold"),
            busy,
            () => { if (held) BatterUpReleaseClicked(item); else BatterUpHoldClicked(item); }));
        row.Children.Add(GitEpicActionLink(busy ? "…" : "Dispatch", busy, () => BatterUpDispatchClicked(item)));
        return row;
    }

    /// <summary>Hold — takes the real item out of active consideration. Writes the item's real
    /// board Status to <see cref="GitEpicPanelService.StatusOption_Park"/> (Git #2307/#2308's real
    /// "pull it out of the queue, into its own queue away from the build" bucket — audited against
    /// the live board before reuse, not guessed). An item with no real <see
    /// cref="BatterUpItemRef.ProjectItemId"/> genuinely isn't on the project board and can't have
    /// its Status written — reported honestly, never silently no-op'd.</summary>
    private async void BatterUpHoldClicked(BatterUpItemRef item)
    {
        if (string.IsNullOrEmpty(item.ProjectItemId))
        {
            ToastEngine.Show("Batter Up", $"#{item.Number} isn't on the project board — can't set its Status.", ToastKind.Warning);
            return;
        }
        if (!_batterUpActionBusy.Add(item.Number)) return;
        RenderBatterUpLaneBody();

        var (ok, error) = await GitEpicPanelService.SetProjectStatusAsync(item.ProjectItemId, GitEpicPanelService.StatusOption_Park);
        _batterUpActionBusy.Remove(item.Number);

        if (ok)
        {
            _batterUpHeldItems.Add(item.Number);
            ToastEngine.Show("Batter Up", $"Held #{item.Number} — {item.Title} (moved to Park).", ToastKind.Success);
        }
        else
        {
            ToastEngine.Show("Batter Up", $"Hold — #{item.Number} failed: {error}", ToastKind.Warning);
        }
        RenderBatterUpLaneBody();
    }

    /// <summary>Release — returns a held item to the real lane it was actually in before Hold
    /// (<see cref="BatterUpItemRef.LaneOptionId"/>), never a guessed default. Same write path,
    /// reverse direction.</summary>
    private async void BatterUpReleaseClicked(BatterUpItemRef item)
    {
        if (string.IsNullOrEmpty(item.ProjectItemId) || string.IsNullOrEmpty(item.LaneOptionId))
        {
            ToastEngine.Show("Batter Up", $"#{item.Number} — missing real board identity, can't release.", ToastKind.Warning);
            return;
        }
        if (!_batterUpActionBusy.Add(item.Number)) return;
        RenderBatterUpLaneBody();

        var (ok, error) = await GitEpicPanelService.SetProjectStatusAsync(item.ProjectItemId, item.LaneOptionId);
        _batterUpActionBusy.Remove(item.Number);

        if (ok)
        {
            _batterUpHeldItems.Remove(item.Number);
            ToastEngine.Show("Batter Up", $"Released #{item.Number} — {item.Title}.", ToastKind.Success);
        }
        else
        {
            ToastEngine.Show("Batter Up", $"Release — #{item.Number} failed: {error}", ToastKind.Warning);
        }
        RenderBatterUpLaneBody();
    }

    /// <summary>Dispatch — real, safe, standalone: opens the real issue in the browser and copies
    /// a ready-to-act signal to the clipboard. Per #2360's own governing comment, a Batter Up item
    /// requires a build prompt written by Claude in chat after approval, then a Git issue push,
    /// then an app-side Git refresh — nothing here may write <c>bt_build_queue</c> or push a build
    /// prompt directly, and this never claims a "Dispatched!" success state for something that
    /// didn't actually happen.
    ///
    /// Git #2366 — that boundary is now a real runtime guard, not just this doc comment:
    /// <see cref="BatterUpDispatchGuard.Enter"/> marks this call's whole scope (including any
    /// future awaited work added inside it) as "inside the no-write zone", and the two real write
    /// choke points this app has — <see cref="QueueWriteClient"/>'s direct `bt_build_queue`
    /// mutations, and <see cref="GitMapService"/>'s `gh` CLI runner (the only path to a `gh issue
    /// comment`) — both throw immediately if reached while that scope is active. A future edit
    /// that starts writing the queue or posting a comment from in here fails loudly the first time
    /// it actually runs, not silently in review.</summary>
    private void BatterUpDispatchClicked(BatterUpItemRef item)
    {
        using var _dispatchGuard = BatterUpDispatchGuard.Enter();

        try
        {
            Process.Start(new ProcessStartInfo($"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{item.Number}") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            ToastEngine.Show("Batter Up", $"Dispatch — couldn't open #{item.Number} in the browser: {ex.Message}", ToastKind.Warning);
        }

        try
        {
            Clipboard.SetText($"Write a build prompt and dispatch Batter Up item #{item.Number} — {item.Title}.");
            ToastEngine.Show("Batter Up",
                $"Opened #{item.Number} in the browser and copied a dispatch prompt to the clipboard — paste it into chat to write the real build prompt.",
                ToastKind.Success);
        }
        catch (Exception ex)
        {
            ToastEngine.Show("Batter Up", $"Opened #{item.Number} in the browser, but couldn't copy to clipboard: {ex.Message}", ToastKind.Warning);
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

    /// <summary>Git #2358 — the group header's real state pill for its parent Feature: the exact
    /// same CLOSED/BLOCKED/IN FLIGHT/COMPLETE/OPEN vocabulary and brush keys
    /// <see cref="GitNodeState"/> already established for Feature rows in the Git Panel tree,
    /// applied to <see cref="BatterUpItemRef.FeatureIsClosed"/>/<c>FeatureLabels</c> — same real
    /// labels, fetched off the same GraphQL <c>parent</c> edge, no new vocabulary invented for
    /// this panel.</summary>
    private static (string Label, string BrushKey) BatterUpFeatureState(BatterUpItemRef item)
    {
        if (item.FeatureIsClosed) return ("CLOSED", "Brush.Status.Done");
        if (item.FeatureLabels.Contains("blocked", StringComparer.OrdinalIgnoreCase)) return ("BLOCKED", "Brush.NextUp.Blocked.Fg");
        if (item.FeatureLabels.Contains("in-flight", StringComparer.OrdinalIgnoreCase)) return ("IN FLIGHT", "Brush.Status.Running");
        if (item.FeatureLabels.Contains("complete", StringComparer.OrdinalIgnoreCase)) return ("COMPLETE", "Brush.Status.Verifying");
        return ("OPEN", "Brush.Text.Muted");
    }

    /// <summary>Git #2358 — "Dispatch all" is button-and-affordance-only in this build (per the
    /// issue's own scope). Real dispatch semantics — what "Dispatch" is and isn't allowed to
    /// write — are governed by #2366: nothing here may write <c>bt_build_queue</c> or post a
    /// synthetic <c>BUILD:</c> comment, same as the per-item <see cref="BatterUpDispatchClicked"/>.
    /// This stub does nothing destructive: it just reports an honest "not wired yet" status line
    /// rather than silently swallowing the click or faking success. Still enters the real
    /// <see cref="BatterUpDispatchGuard"/> scope for the duration of the click — a future edit
    /// that wires this stub into an actual write path trips the same runtime guard the per-item
    /// action does, not just a doc comment.</summary>
    private void BatterUpDispatchAllClicked(int featureNumber, string featureTitle, int itemCount)
    {
        using var _dispatchGuard = BatterUpDispatchGuard.Enter();

        BatterUpPanelStatus.Text = $"Dispatch all — #{featureNumber} {featureTitle} ({itemCount} item(s)): " +
            "not wired yet — real dispatch semantics land in #2366.";
        BatterUpPanelStatus.Visibility = Visibility.Visible;
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
