using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2303-#2308 (Feature #2289 items 14-19) — the real Epic detail peek body: identity badge,
/// milestone, completion ring, sub-features/issues-closed/burn-rate/estimated-remaining (#2303),
/// an on-target/behind verdict against the epic's real milestone due date (#2304), a per-feature
/// list with mini rings, real state, non-zero state chips, last build, idle gap, hours left and
/// closed count (#2305), a blocked-on band naming the real upstream blocker (#2306), per-feature
/// Queue all / Park / Pause actions (#2307), and Park/Pause propagation to Git Map + the Command
/// Palette's epic preview (#2308 — see GitEpicPanelService.OverlayParkPauseAsync's header for the
/// single-sourced mechanism; Build Queue's own propagation is blocked on that panel's own
/// pre-existing fixture-seed gap, filed separately rather than faked here).
///
/// All data comes from <see cref="GitEpicPanelService"/> (GitHub GraphQL/REST + the real local
/// bt_build_queue and shanebuilder_feature_flags tables) — nothing here is invented. Every peek
/// caches by epic number and re-renders in place when its async load lands, same pattern
/// MainWindow.GitPanel.cs already established for the tree/ancestry peek.
/// </summary>
public partial class MainWindow
{
    private readonly Dictionary<int, GitEpicDetail> _gitEpicDetailCache = new();
    private readonly HashSet<int> _gitEpicDetailLoading = new();
    private readonly Dictionary<int, List<PaletteBuildQueueRow>> _gitEpicQueueRowsCache = new();
    private readonly Dictionary<int, bool> _gitFeaturePausedCache = new();
    private readonly Dictionary<int, List<GitBlockedByRef>> _gitBlockedByCache = new();
    private readonly HashSet<int> _gitEpicActionBusy = new(); // feature# whose action buttons are mid-flight
    private string? _gitEpicLastActionNote;

    // ── load ─────────────────────────────────────────────────────────────────────────────────

    private async Task LoadGitEpicDetailAsync(int epicNumber)
    {
        var (ok, detail, error) = await GitEpicPanelService.GetEpicDetailAsync(epicNumber);
        _gitEpicDetailLoading.Remove(epicNumber);
        if (ok && detail != null)
        {
            _gitEpicDetailCache[epicNumber] = detail;
            _ = LoadGitEpicSupplementalAsync(epicNumber, detail);
            _ = LoadGitEpicBlockedByAsync(epicNumber, detail);
        }
        else
        {
            GitPanelStatus.Text = $"Epic #{epicNumber} detail failed — {error}";
            GitPanelStatus.Visibility = Visibility.Visible;
        }
        RenderGitEpicPeekIfCurrent(epicNumber);
    }

    /// <summary>The real, latest-per-issue <c>bt_build_queue</c> row for every leaf/feature
    /// number under this epic (one batched read via #2309's own <c>GetLatestByGithubNumbersAsync</c>
    /// — SQL already reduces to latest-per-number, so this doubles as both the chip counts and
    /// the single freshest "last build" without a second all-history read) and this epic's real
    /// per-feature Pause flags — both needed for #2305's chips/last-build/idle-gap and the PAUSED
    /// badge.</summary>
    private async Task LoadGitEpicSupplementalAsync(int epicNumber, GitEpicDetail detail)
    {
        var allNumbers = detail.Features
            .SelectMany(f => f.Leaves.Select(l => l.Number))
            .Concat(detail.Features.Select(f => f.Number))
            .Distinct()
            .ToList();

        var qc = QueueReadClient.CreateFromEnvironment();
        if (qc != null && allNumbers.Count > 0)
        {
            try { _gitEpicQueueRowsCache[epicNumber] = await qc.GetLatestByGithubNumbersAsync(allNumbers); }
            catch (Exception ex) { ConsoleOutputSink.Log(LogLevel.Warn, $"[git-epic-panel] queue rows load failed for epic #{epicNumber}: {ex.Message}"); }
        }

        var connStr = ChatReadClient.ResolveConnectionStringForSqlRunner();
        if (!string.IsNullOrWhiteSpace(connStr) && detail.Features.Count > 0)
        {
            var paused = await FeaturePauseStore.GetPausedAsync(detail.Features.Select(f => f.Number), connStr!);
            foreach (var kv in paused) _gitFeaturePausedCache[kv.Key] = kv.Value;
        }

        RenderGitEpicPeekIfCurrent(epicNumber);
    }

    /// <summary>#2306 — the epic's own real blocked_by edges, plus (capped at 5) any open feature
    /// already carrying the real `blocked` label, so the band can name the actual upstream issue
    /// rather than just repeating "BLOCKED".</summary>
    private async Task LoadGitEpicBlockedByAsync(int epicNumber, GitEpicDetail detail)
    {
        var targets = new List<int> { epicNumber };
        targets.AddRange(detail.Features
            .Where(f => !f.IsClosed && f.Labels.Contains("blocked", StringComparer.OrdinalIgnoreCase))
            .Select(f => f.Number)
            .Take(5));

        var tasks = targets.Select(async n =>
        {
            var (ok, blockers, _) = await GitEpicPanelService.GetBlockedByAsync(n);
            if (ok) _gitBlockedByCache[n] = blockers;
        });
        await Task.WhenAll(tasks);
        RenderGitEpicPeekIfCurrent(epicNumber);
    }

    private void RenderGitEpicPeekIfCurrent(int epicNumber)
    {
        if (_gitTrail.Count > 0 && _gitTrail[^1].Kind == GitCrumbKind.Epic && _gitTrail[^1].Number == epicNumber)
            RenderGitPanel();
    }

    // ── render ───────────────────────────────────────────────────────────────────────────────

    private void RenderGitEpicPeekBody(GitCrumb current)
    {
        int epicNumber = current.Number;
        if (!_gitEpicDetailCache.TryGetValue(epicNumber, out var detail))
        {
            GitPeekHost.Children.Add(GitDimLine("Loading real epic detail…", indent: 6));
            if (_gitEpicDetailLoading.Add(epicNumber))
                _ = LoadGitEpicDetailAsync(epicNumber);
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var allLeaves = detail.Features.SelectMany(f => f.Leaves).ToList();
        var burn = GitEpicPanelService.ComputeBurnStats(allLeaves, now);
        var verdict = GitEpicPanelService.ComputeVerdict(burn, detail.MilestoneDueOn, now);

        // ── identity badge (#2303) ── RenderGitPeek already put the breadcrumb + "EPIC #N" +
        // title up via RenderGitIdentityBlock (#2312's shared identity path) before dispatching
        // here — this adds only the real state pills that block doesn't render.
        var idRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(6, 0, 6, 6) };
        idRow.Children.Add(GitCountPill(detail.IsClosed ? "CLOSED" : "OPEN", detail.IsClosed ? "Brush.Status.Done" : "Brush.Status.Running"));
        if (!string.IsNullOrEmpty(detail.ProjectStatus))
            idRow.Children.Add(GitCountPill(detail.ProjectStatus!.ToUpperInvariant(), "Brush.Text.Muted"));
        GitPeekHost.Children.Add(idRow);

        if (detail.MilestoneNumber.HasValue)
        {
            var msRow = GitText(
                $"MILESTONE {detail.MilestoneTitle}" + (detail.MilestoneDueOn.HasValue ? $" · due {detail.MilestoneDueOn:MMM d, yyyy}" : " · no due date set"),
                9.5, "Brush.Text.Muted");
            msRow.Margin = new Thickness(6, 0, 6, 10);
            msRow.Cursor = Cursors.Hand;
            var msNum = detail.MilestoneNumber.Value;
            var msTitle = detail.MilestoneTitle ?? "";
            msRow.MouseLeftButtonDown += (_, _) => SetGitTrail(new List<GitCrumb> { new() { Kind = GitCrumbKind.Milestone, Number = msNum, Title = msTitle } });
            GitPeekHost.Children.Add(msRow);
        }
        else
        {
            GitPeekHost.Children.Add(GitDimLine("No milestone set.", 6));
        }

        // ── ring + vitals (#2303) ──
        var vitalsRow = new Grid { Margin = new Thickness(6, 4, 6, 10) };
        vitalsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        vitalsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var ring = BuildRing(burn.RingFraction, 68, (Brush)FindResource("Brush.Accent.Primary"), $"{Math.Round(burn.RingFraction * 100)}%");
        Grid.SetColumn(ring, 0);
        vitalsRow.Children.Add(ring);

        var vitalsStack = new StackPanel { Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(vitalsStack, 1);
        vitalsStack.Children.Add(GitEpicVitalLine($"{detail.Features.Count} sub-feature{(detail.Features.Count == 1 ? "" : "s")}",
            detail.FeatureTotalCount > detail.Features.Count ? $" (showing first {detail.Features.Count} of {detail.FeatureTotalCount})" : ""));
        vitalsStack.Children.Add(GitEpicVitalLine($"{burn.ClosedLeaves} of {burn.TotalLeaves} issues closed", ""));
        vitalsStack.Children.Add(GitEpicVitalLine(
            burn.BurnRatePerWeek.HasValue ? $"burn rate: {burn.BurnRatePerWeek.Value:0.#}/week" : "burn rate: no closures yet", ""));
        vitalsStack.Children.Add(GitEpicVitalLine(
            burn.EstimatedRemainingWeeks.HasValue ? $"est. remaining: {FormatWeeks(burn.EstimatedRemainingWeeks.Value)}" : "est. remaining: can't project yet", ""));
        vitalsRow.Children.Add(vitalsStack);
        GitPeekHost.Children.Add(vitalsRow);

        // ── on-target / behind verdict (#2304) ──
        GitPeekHost.Children.Add(GitEpicVerdictBand(verdict, detail.MilestoneDueOn));

        // ── blocked-on band (#2306) ──
        var blockedBand = GitEpicBlockedBand(detail);
        if (blockedBand != null) GitPeekHost.Children.Add(blockedBand);

        // ── feature list (#2305, #2307) ──
        GitPeekHost.Children.Add(GitSectionHeader($"Features ({detail.Features.Count})", true));
        if (detail.Features.Count == 0)
        {
            // #2311's own real "nothing here has a burndown" warning, reproduced here against
            // this panel's own real fetch (detail.Features) — #2311 read a separate tree-load
            // cache that this Epic peek no longer falls through to (#2303-#2308's own dispatch),
            // so the same real condition is checked again here rather than left dead for Epics.
            var amber = (Color)ColorConverter.ConvertFromString("#E2984A");
            var warn = new Border
            {
                Margin = new Thickness(6, 0, 6, 8),
                Padding = new Thickness(8, 6, 8, 6),
                CornerRadius = new CornerRadius(5),
                Background = new SolidColorBrush(Color.FromArgb(38, amber.R, amber.G, amber.B)),
                BorderThickness = new Thickness(1),
                BorderBrush = new SolidColorBrush(amber)
            };
            var warnText = GitText("⚠ Nothing here has a burndown — this Epic has no FEATURE sub-issues yet.", 10, "Brush.Text.Heading");
            warnText.TextWrapping = TextWrapping.Wrap;
            warn.Child = warnText;
            GitPeekHost.Children.Add(warn);
        }
        else
        {
            var epicAvgCycleHours = burn.AvgCycleHours;
            var queueRows = _gitEpicQueueRowsCache.TryGetValue(epicNumber, out var rows) ? rows : new List<PaletteBuildQueueRow>();
            foreach (var feature in detail.Features)
                GitPeekHost.Children.Add(GitEpicFeatureRow(detail, feature, queueRows, epicAvgCycleHours, now));
        }

        if (!string.IsNullOrEmpty(_gitEpicLastActionNote))
        {
            var note = GitText(_gitEpicLastActionNote!, 9.5, "Brush.Text.Muted");
            note.Margin = new Thickness(6, 8, 6, 0);
            note.TextWrapping = TextWrapping.Wrap;
            GitPeekHost.Children.Add(note);
        }
    }

    private TextBlock GitEpicVitalLine(string text, string suffix)
    {
        var tb = GitText(text + suffix, 10.5, "Brush.Text.Primary");
        tb.Margin = new Thickness(0, 0, 0, 2);
        return tb;
    }

    /// <summary>#2304 — a real verdict band, colour-coded, naming the real projected date and
    /// margin against the epic's real milestone due date. Genuinely no data (no milestone due
    /// date, or no burn rate to project from yet) renders an honest neutral note instead of a
    /// guessed verdict.</summary>
    private Border GitEpicVerdictBand(GitEpicVerdictResult verdict, DateTimeOffset? dueOn)
    {
        string label;
        string brushKey;
        switch (verdict.Verdict)
        {
            case GitEpicVerdict.OnTarget:
                label = $"ON TARGET — projected {verdict.ProjectedDate:MMM d} vs. due {dueOn:MMM d, yyyy} ({FormatMargin(verdict.Margin!.Value)} buffer)";
                brushKey = "Brush.Alert.Success";
                break;
            case GitEpicVerdict.Behind:
                label = $"BEHIND SCHEDULE — projected {verdict.ProjectedDate:MMM d} vs. due {dueOn:MMM d, yyyy} ({FormatMargin(verdict.Margin!.Value.Negate())} over)";
                brushKey = "Brush.Alert.Critical";
                break;
            default:
                label = dueOn == null ? "No target date set — milestone has no due date." : "Not enough closure history yet to project a completion date.";
                brushKey = "Brush.Text.Muted";
                break;
        }

        var accent = (Brush)FindResource(brushKey);
        var band = new Border
        {
            Margin = new Thickness(6, 0, 6, 10),
            Padding = new Thickness(9, 6, 9, 6),
            CornerRadius = new CornerRadius(6),
            Background = Tint(accent, 0x22),
            BorderBrush = Tint(accent, 0x66),
            BorderThickness = new Thickness(1)
        };
        var text = new TextBlock
        {
            Text = label, TextWrapping = TextWrapping.Wrap,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = accent
        };
        band.Child = text;
        return band;
    }

    /// <summary>#2306 — names the real upstream blocker(s) rather than just flashing a red
    /// "BLOCKED" pill. Covers the epic's own real blocked_by edges plus (capped) any open feature
    /// carrying the real `blocked` label. Null when genuinely nothing is blocked.</summary>
    private Border? GitEpicBlockedBand(GitEpicDetail detail)
    {
        var lines = new List<string>();
        if (_gitBlockedByCache.TryGetValue(detail.Number, out var epicBlockers) && epicBlockers.Count > 0)
            lines.Add("EPIC blocked on " + string.Join(", ", epicBlockers.Select(b => $"#{b.Number} {b.Title}" + (b.IsClosed ? " (closed)" : ""))));

        foreach (var f in detail.Features.Where(f => !f.IsClosed && f.Labels.Contains("blocked", StringComparer.OrdinalIgnoreCase)))
        {
            if (_gitBlockedByCache.TryGetValue(f.Number, out var fBlockers) && fBlockers.Count > 0)
                lines.Add($"FEATURE #{f.Number} blocked on " + string.Join(", ", fBlockers.Select(b => $"#{b.Number} {b.Title}" + (b.IsClosed ? " (closed)" : ""))));
            else if (!_gitBlockedByCache.ContainsKey(f.Number))
                lines.Add($"FEATURE #{f.Number} carries the blocked label — resolving its real blocker…");
        }

        if (lines.Count == 0) return null;

        var accent = (Brush)FindResource("Brush.NextUp.Blocked.Fg");
        var band = new Border
        {
            Margin = new Thickness(6, 0, 6, 10),
            Padding = new Thickness(9, 6, 9, 6),
            CornerRadius = new CornerRadius(6),
            Background = (Brush)FindResource("Brush.NextUp.Blocked.Bg"),
            BorderBrush = (Brush)FindResource("Brush.NextUp.Blocked.Border"),
            BorderThickness = new Thickness(1)
        };
        var stack = new StackPanel();
        foreach (var line in lines)
        {
            var tb = new TextBlock
            {
                Text = line, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 2),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 9.5,
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = accent
            };
            stack.Children.Add(tb);
        }
        band.Child = stack;
        return band;
    }

    /// <summary>#2305 (data) + #2307 (actions) — one feature card: mini ring, real state, real
    /// non-zero state chips, last build, idle gap, hours left, closed count, and the three real
    /// actions.</summary>
    private Border GitEpicFeatureRow(GitEpicDetail detail, GitEpicFeature feature, List<PaletteBuildQueueRow> allQueueRows, double? epicAvgCycleHours, DateTimeOffset now)
    {
        var leafNumbers = feature.Leaves.Select(l => l.Number).ToHashSet();
        var relatedRows = allQueueRows.Where(r => r.GithubNumber.HasValue && leafNumbers.Contains(r.GithubNumber.Value)).ToList();
        bool paused = _gitFeaturePausedCache.TryGetValue(feature.Number, out var p) && p;
        var stats = GitEpicPanelService.ComputeFeatureStats(feature, relatedRows, paused, epicAvgCycleHours, now);

        var (stateLabel, stateBrushKey) = GitEpicFeatureState(feature, paused);

        var card = new Border
        {
            Margin = new Thickness(6, 0, 6, 6),
            Padding = new Thickness(8, 7, 8, 7),
            CornerRadius = new CornerRadius(7),
            Background = (Brush)FindResource("Brush.Bg.Card"),
            BorderBrush = (Brush)FindResource("Brush.Border.Card"),
            BorderThickness = new Thickness(1)
        };
        var outer = new StackPanel();

        var headRow = new Grid();
        headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var miniRing = BuildRing(stats.RingFraction, 28, (Brush)FindResource(stateBrushKey), "");
        Grid.SetColumn(miniRing, 0);
        headRow.Children.Add(miniRing);

        var headStack = new StackPanel { Margin = new Thickness(8, 0, 0, 0) };
        Grid.SetColumn(headStack, 1);
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
        var name = GitText(StripGitPrefix(feature.Title), 10.5, feature.IsClosed ? "Brush.Text.Dim" : "Brush.Text.Primary");
        name.TextTrimming = TextTrimming.CharacterEllipsis;
        name.MaxWidth = 220;
        name.Cursor = Cursors.Hand;
        var capturedEpic = detail; var capturedFeature = feature;
        name.MouseLeftButtonDown += (_, e) =>
        {
            e.Handled = true;
            var trail = new List<GitCrumb>();
            if (capturedEpic.MilestoneNumber.HasValue)
                trail.Add(new GitCrumb { Kind = GitCrumbKind.Milestone, Number = capturedEpic.MilestoneNumber.Value, Title = capturedEpic.MilestoneTitle ?? "" });
            trail.Add(new GitCrumb { Kind = GitCrumbKind.Epic, Number = capturedEpic.Number, Title = capturedEpic.Title });
            trail.Add(new GitCrumb { Kind = GitCrumbKind.Feature, Number = capturedFeature.Number, Title = capturedFeature.Title });
            SetGitTrail(trail, fetchLastIssue: true);
        };
        titleRow.Children.Add(GitMono($"#{feature.Number}", 9.5, "Brush.Accent.IssueNum"));
        var nameWrap = new Border { Margin = new Thickness(5, 0, 0, 0), Child = name };
        titleRow.Children.Add(nameWrap);
        headStack.Children.Add(titleRow);

        var chipRow = new WrapPanel { Margin = new Thickness(0, 3, 0, 0) };
        chipRow.Children.Add(GitCountPill(stateLabel, stateBrushKey));
        chipRow.Children.Add(GitCountPill($"{stats.ClosedCount} closed", "Brush.Status.Done"));
        foreach (var (bucket, count) in stats.Chips)
            chipRow.Children.Add(GitCountPill($"{count} {bucket}", GitEpicChipBrushKey(bucket)));
        headStack.Children.Add(chipRow);

        var metaRow = new WrapPanel { Margin = new Thickness(0, 3, 0, 0) };
        metaRow.Children.Add(GitText(
            stats.LastBuild != null ? $"last build: {FormatIdleGap(stats.IdleGap)} ago — {stats.LastBuild.Status}" : "last build: never",
            8.5, "Brush.Text.Dim", rightPad: 8));
        metaRow.Children.Add(GitText(
            stats.HoursLeft.HasValue ? $"~{Math.Round(stats.HoursLeft.Value, 1)}h left" : "hours left: no data yet",
            8.5, "Brush.Text.Dim"));
        headStack.Children.Add(metaRow);

        headRow.Children.Add(headStack);
        outer.Children.Add(headRow);

        // ── actions (#2307) ──
        bool busy = _gitEpicActionBusy.Contains(feature.Number);
        var actionRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
        actionRow.Children.Add(GitEpicActionLink(busy ? "Queuing…" : "Queue all", busy, () => GitEpicQueueAllClicked(detail.Number, feature)));
        actionRow.Children.Add(GitEpicActionLink(
            busy ? "…" : (string.Equals(feature.ProjectStatus, "Park", StringComparison.OrdinalIgnoreCase) ? "Unpark" : "Park"),
            busy, () => GitEpicParkClicked(detail.Number, feature)));
        actionRow.Children.Add(GitEpicActionLink(busy ? "…" : (paused ? "Resume" : "Pause"), busy, () => GitEpicPauseClicked(detail.Number, feature)));
        outer.Children.Add(actionRow);

        card.Child = outer;
        return card;
    }

    private TextBlock GitEpicActionLink(string label, bool disabled, Action onClick)
    {
        var tb = new TextBlock
        {
            Text = label,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 8.5,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource(disabled ? "Brush.Text.Dim" : "Brush.Accent.Primary"),
            Margin = new Thickness(0, 0, 12, 0),
            Cursor = disabled ? Cursors.Arrow : Cursors.Hand
        };
        if (!disabled) tb.MouseLeftButtonDown += (_, e) => { e.Handled = true; onClick(); };
        return tb;
    }

    private static (string Label, string BrushKey) GitEpicFeatureState(GitEpicFeature f, bool paused)
    {
        if (paused) return ("PAUSED", "Brush.Status.Paused");
        if (string.Equals(f.ProjectStatus, "Park", StringComparison.OrdinalIgnoreCase)) return ("PARKED", "Brush.Status.Parked");
        if (f.IsClosed) return ("CLOSED", "Brush.Status.Done");
        if (f.Labels.Contains("blocked", StringComparer.OrdinalIgnoreCase)) return ("BLOCKED", "Brush.NextUp.Blocked.Fg");
        if (f.Labels.Contains("in-flight", StringComparer.OrdinalIgnoreCase)) return ("IN FLIGHT", "Brush.Status.Running");
        if (f.Labels.Contains("complete", StringComparer.OrdinalIgnoreCase)) return ("COMPLETE", "Brush.Status.Verifying");
        return ("OPEN", "Brush.Text.Muted");
    }

    private static string GitEpicChipBrushKey(string bucket) => bucket switch
    {
        "up next" => "Brush.Status.Queued",
        "running" => "Brush.Status.Running",
        "verifying" => "Brush.Status.Verifying",
        "blocked" => "Brush.NextUp.Blocked.Fg",
        "parked" => "Brush.Status.Parked",
        "paused" => "Brush.Status.Paused",
        _ => "Brush.Text.Muted"
    };

    // ── actions (#2307, #2308) ───────────────────────────────────────────────────────────────

    private async void GitEpicQueueAllClicked(int epicNumber, GitEpicFeature feature)
    {
        if (!_gitEpicActionBusy.Add(feature.Number)) return;
        RenderGitEpicPeekIfCurrent(epicNumber);

        var itemIds = feature.Leaves.Where(l => !l.IsClosed).Select(l => l.ProjectItemId).ToList();
        var (ok, written, skipped, error) = await GitEpicPanelService.SetProjectStatusBulkAsync(itemIds, GitEpicPanelService.StatusOption_BatterUp);
        _gitEpicActionBusy.Remove(feature.Number);

        _gitEpicLastActionNote = ok
            ? $"Queue all — feature #{feature.Number}: {written} issue(s) moved to Batter Up" + (skipped > 0 ? $", {skipped} not on the board" : "")
            : $"Queue all — feature #{feature.Number} failed: {error}";
        ToastEngine.Show("Git Panel", _gitEpicLastActionNote, ok ? ToastKind.Success : ToastKind.Warning);
        RenderGitEpicPeekIfCurrent(epicNumber);
    }

    private async void GitEpicParkClicked(int epicNumber, GitEpicFeature feature)
    {
        if (string.IsNullOrEmpty(feature.ProjectItemId))
        {
            _gitEpicLastActionNote = $"Park — feature #{feature.Number} isn't on the project board; can't set its Status.";
            ToastEngine.Show("Git Panel", _gitEpicLastActionNote, ToastKind.Warning);
            RenderGitEpicPeekIfCurrent(epicNumber);
            return;
        }
        if (!_gitEpicActionBusy.Add(feature.Number)) return;
        RenderGitEpicPeekIfCurrent(epicNumber);

        bool currentlyParked = string.Equals(feature.ProjectStatus, "Park", StringComparison.OrdinalIgnoreCase);
        string target = currentlyParked ? GitEpicPanelService.StatusOption_Backlog : GitEpicPanelService.StatusOption_Park;
        var (ok, error) = await GitEpicPanelService.SetProjectStatusAsync(feature.ProjectItemId!, target);
        _gitEpicActionBusy.Remove(feature.Number);

        _gitEpicLastActionNote = ok
            ? $"{(currentlyParked ? "Unparked" : "Parked")} feature #{feature.Number}."
            : $"Park — feature #{feature.Number} failed: {error}";
        ToastEngine.Show("Git Panel", _gitEpicLastActionNote, ok ? ToastKind.Success : ToastKind.Warning);

        if (ok)
        {
            // Force a real refetch so ProjectStatus reflects the write, then propagate (#2308).
            _gitEpicDetailCache.Remove(epicNumber);
            RefreshGitMapAfterFeatureStateChange(epicNumber);
            await LoadGitEpicDetailAsync(epicNumber);
        }
        RenderGitEpicPeekIfCurrent(epicNumber);
    }

    private async void GitEpicPauseClicked(int epicNumber, GitEpicFeature feature)
    {
        if (!_gitEpicActionBusy.Add(feature.Number)) return;
        RenderGitEpicPeekIfCurrent(epicNumber);

        bool currentlyPaused = _gitFeaturePausedCache.TryGetValue(feature.Number, out var p) && p;
        var connStr = ChatReadClient.ResolveConnectionStringForSqlRunner();
        bool ok = !string.IsNullOrWhiteSpace(connStr) && await FeaturePauseStore.SetPausedAsync(feature.Number, !currentlyPaused, connStr!, Environment.UserName);
        _gitEpicActionBusy.Remove(feature.Number);

        if (ok) _gitFeaturePausedCache[feature.Number] = !currentlyPaused;
        _gitEpicLastActionNote = ok
            ? $"{(currentlyPaused ? "Resumed" : "Paused")} feature #{feature.Number}."
            : $"Pause — feature #{feature.Number} failed: no local database connection.";
        ToastEngine.Show("Git Panel", _gitEpicLastActionNote, ok ? ToastKind.Success : ToastKind.Warning);

        if (ok) RefreshGitMapAfterFeatureStateChange(epicNumber);
        RenderGitEpicPeekIfCurrent(epicNumber);
    }

    /// <summary>#2308 — if Git Map already has this epic's features cached (the user has that
    /// panel open too), drop the cache and reload so its own real overlay call picks up the just-
    /// written Park/Pause state immediately rather than waiting for its own next manual refresh.</summary>
    private void RefreshGitMapAfterFeatureStateChange(int epicNumber)
    {
        if (_gitMapFeatureCache.Remove(epicNumber))
            _ = LoadGitMapEpicFeaturesAsync(epicNumber);
    }

    // ── ring control ─────────────────────────────────────────────────────────────────────────

    private FrameworkElement BuildRing(double fraction, double diameter, Brush progressColor, string centerText)
    {
        fraction = Math.Clamp(fraction, 0.0, 1.0);
        double strokeThickness = Math.Max(2.5, diameter * 0.14);
        var grid = new Grid { Width = diameter, Height = diameter };

        var bg = new Ellipse
        {
            Width = diameter - strokeThickness,
            Height = diameter - strokeThickness,
            Stroke = (Brush)FindResource("Brush.Border.Default"),
            StrokeThickness = strokeThickness
        };
        grid.Children.Add(bg);

        if (fraction > 0.001)
        {
            double radius = (diameter - strokeThickness) / 2.0;
            double center = diameter / 2.0;
            double angleDeg = fraction >= 0.999 ? 359.999 : fraction * 360.0;
            double startRad = -Math.PI / 2.0;
            double endRad = startRad + angleDeg * Math.PI / 180.0;
            var start = new Point(center + radius * Math.Cos(startRad), center + radius * Math.Sin(startRad));
            var end = new Point(center + radius * Math.Cos(endRad), center + radius * Math.Sin(endRad));
            bool isLargeArc = angleDeg > 180.0;

            var figure = new System.Windows.Media.PathFigure { StartPoint = start, IsClosed = false };
            figure.Segments.Add(new System.Windows.Media.ArcSegment(end, new Size(radius, radius), 0, isLargeArc, System.Windows.Media.SweepDirection.Clockwise, true));
            var geometry = new System.Windows.Media.PathGeometry();
            geometry.Figures.Add(figure);
            var path = new System.Windows.Shapes.Path
            {
                Data = geometry,
                Stroke = progressColor,
                StrokeThickness = strokeThickness,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            };
            grid.Children.Add(path);
        }

        if (!string.IsNullOrEmpty(centerText))
        {
            grid.Children.Add(new TextBlock
            {
                Text = centerText,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = Math.Max(8, diameter * 0.17),
                FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
                Foreground = (Brush)FindResource("Brush.Text.Heading"),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            });
        }
        return grid;
    }

    // ── formatting ───────────────────────────────────────────────────────────────────────────

    private static string FormatWeeks(double weeks)
    {
        if (weeks < 1.0) return $"{Math.Max(1, Math.Round(weeks * 7))} day(s)";
        if (weeks < 8.0) return $"{Math.Round(weeks, 1)} week(s)";
        return $"{Math.Round(weeks / 4.345, 1)} month(s)";
    }

    private static string FormatMargin(TimeSpan span)
    {
        double days = span.TotalDays;
        if (days < 1) return $"{Math.Max(0, Math.Round(span.TotalHours))}h";
        if (days < 14) return $"{Math.Round(days)}d";
        return $"{Math.Round(days / 7.0, 1)}wk";
    }

    private static string FormatIdleGap(TimeSpan? gap)
    {
        if (!gap.HasValue) return "never";
        var g = gap.Value;
        if (g.TotalMinutes < 60) return $"{Math.Max(0, Math.Round(g.TotalMinutes))}m";
        if (g.TotalHours < 48) return $"{Math.Round(g.TotalHours)}h";
        return $"{Math.Round(g.TotalDays)}d";
    }
}
