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
/// Git #2290 (Feature #2289 items 1-11) — the Git Panel navigation shell, replacing the
/// placeholder TextBlock the left rail's GIT source used to show. Real audit before this build:
/// no tree, no breadcrumb, no peek of any kind existed — <c>GitPanelBody</c> was a single static
/// TextBlock toggled visible/collapsed.
///
/// What lives here: the Milestone/Gate/Epic → FEATURE → Issue tree (every row a real GitHub
/// object via <see cref="GitPanelService"/>/<see cref="GitMapService"/>), the in-panel peek any
/// level opens into, the labelled breadcrumb trail (MILESTONE v1.1 › EPIC #1202 Build Console ›
/// FEATURE SQL Runner), a back button that names its destination, and cold-open ancestry
/// derivation (#2300) via the real GraphQL `parent` chain. Peek CONTENT beyond identity
/// (#2301-#2312, items 12-23) is a later build — the peek honestly says so rather than
/// rendering invented vitals.
/// </summary>
public partial class MainWindow
{
    private enum GitCrumbKind { Milestone, Gate, Epic, Feature, Issue }

    private sealed class GitCrumb
    {
        public GitCrumbKind Kind { get; init; }
        public int Number { get; init; }
        public string Title { get; init; } = "";
    }

    private bool _gitPanelLoaded;
    private bool _gitPanelLoading;
    private List<GitPanelMilestone> _gitMilestones = new();
    private List<GitPanelIssueNode> _gitGates = new();
    private List<GitMapEpic> _gitEpics = new();
    private readonly Dictionary<int, List<GitPanelIssueNode>> _gitEpicFeatures = new();
    private readonly Dictionary<int, int> _gitEpicFeatureTotals = new();
    private readonly HashSet<int> _gitEpicsLoadingFeatures = new();
    private readonly HashSet<int> _gitExpandedEpics = new();
    private readonly HashSet<int> _gitExpandedFeatures = new();
    private bool _gitMilestonesOpen; // collapsed by default — epics are the panel's main tree
    private bool _gitEpicsOpen = true;
    private readonly List<GitCrumb> _gitTrail = new();
    private readonly Dictionary<int, GitPanelAncestry> _gitPeekCache = new();
    private int _gitPeekRequestSeq;

    // ── Gate peek (#2302) — ring, verdict band, blocked critical epics, full check list ────────
    private readonly Dictionary<int, GitGateDetail> _gitGateDetailCache = new();
    private readonly HashSet<int> _gitGateDetailLoading = new();

    // ── Milestone panel (#2301, item 12) ────────────────────────────────────────────────────
    private readonly Dictionary<int, GitPanelMilestoneSnapshot> _gitMilestoneSnapshotCache = new();
    private readonly HashSet<int> _gitMilestoneSnapshotLoading = new();
    private int _gitMilestoneSnapshotSeq;

    // ── load ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>Fires the three real reads the tree renders from (open milestones, open GATE:
    /// issues, open Epic: issues) the first time the GIT rail panel opens. A failed leg reports
    /// its real error in the status line; nothing falls back to fixture rows.</summary>
    private async Task EnsureGitPanelLoadedAsync()
    {
        if (_gitPanelLoading) return;
        if (_gitPanelLoaded) { RenderGitPanel(); return; }

        _gitPanelLoading = true;
        GitPanelStatus.Text = "Loading real GitHub state…";
        GitPanelStatus.Visibility = Visibility.Visible;

        var msTask = GitPanelService.GetOpenMilestonesAsync();
        var gateTask = GitPanelService.GetOpenGatesAsync();
        var epicTask = GitMapService.GetOpenEpicsAsync(null);
        await Task.WhenAll(msTask, gateTask, epicTask);

        var (msOk, milestones, msErr) = msTask.Result;
        var (gateOk, gates, gateErr) = gateTask.Result;
        var (epicOk, epics, epicErr) = epicTask.Result;
        if (msOk) _gitMilestones = milestones;
        if (gateOk) _gitGates = gates;
        if (epicOk) _gitEpics = epics;

        _gitPanelLoading = false;
        _gitPanelLoaded = msOk || gateOk || epicOk; // total failure stays unloaded so reopening retries

        if (!_gitPanelLoaded)
        {
            GitPanelStatus.Text = "GitHub unreachable — " + (epicErr ?? msErr ?? gateErr ?? "unknown error");
            return;
        }

        var legErrors = new List<string>();
        if (!msOk) legErrors.Add($"milestones: {msErr}");
        if (!gateOk) legErrors.Add($"gates: {gateErr}");
        if (!epicOk) legErrors.Add($"epics: {epicErr}");
        if (legErrors.Count > 0)
        {
            GitPanelStatus.Text = "Partial GitHub read — " + string.Join(" · ", legErrors);
            GitPanelStatus.Visibility = Visibility.Visible;
        }
        else
        {
            GitPanelStatus.Visibility = Visibility.Collapsed;
        }

        RenderGitPanel();
    }

    private void RenderGitPanel()
    {
        if (_gitTrail.Count == 0)
        {
            GitPeekHost.Visibility = Visibility.Collapsed;
            GitTreeHost.Visibility = Visibility.Visible;
            RenderGitTree();
        }
        else
        {
            GitTreeHost.Visibility = Visibility.Collapsed;
            GitPeekHost.Visibility = Visibility.Visible;
            RenderGitPeek();
        }
    }

    // ── tree (#2290, #2291) ──────────────────────────────────────────────────────────────────

    private void RenderGitTree()
    {
        GitTreeHost.Children.Clear();
        if (!_gitPanelLoaded) return;

        // Milestones — every real open milestone, collapsible group (#2292's click targets).
        var msHeader = GitSectionHeader($"Milestones ({_gitMilestones.Count})", _gitMilestonesOpen);
        msHeader.MouseLeftButtonDown += (_, _) => { _gitMilestonesOpen = !_gitMilestonesOpen; RenderGitTree(); };
        GitTreeHost.Children.Add(msHeader);
        if (_gitMilestonesOpen)
        {
            foreach (var ms in _gitMilestones)
            {
                var row = GitRowShell(indent: 20);
                var title = GitText(ms.Title, 11, "Brush.Text.Primary");
                title.TextTrimming = TextTrimming.CharacterEllipsis;
                row.ColumnFill(title);
                row.ColumnRight(GitCountPill($"{ms.OpenCount} open", "Brush.Text.Muted"));
                var captured = ms;
                row.Root.MouseLeftButtonDown += (_, _) => OpenGitMilestonePeek(captured);
                GitTreeHost.Children.Add(row.Root);
            }
        }

        // Gate cards — every real open "GATE:" issue (#2293's click target).
        foreach (var gate in _gitGates)
        {
            var accent = (SolidColorBrush)FindResource("Brush.Epic.Gate");
            var card = new Border
            {
                Margin = new Thickness(4, 6, 4, 2),
                Padding = new Thickness(9, 7, 9, 7),
                CornerRadius = new CornerRadius(7),
                BorderThickness = new Thickness(1.5),
                BorderBrush = new SolidColorBrush(accent.Color) { Opacity = 0.55 },
                Background = new SolidColorBrush(accent.Color) { Opacity = 0.08 },
                Cursor = Cursors.Hand
            };
            var stack = new StackPanel();
            var caption = GitText("GATE · BLOCKS RELEASE", 8.5, null);
            caption.Foreground = accent;
            caption.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
            stack.Children.Add(caption);
            var gateTitle = GitText($"#{gate.Number} {StripGitPrefix(gate.Title)}", 10.5, "Brush.Text.Heading");
            gateTitle.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
            gateTitle.TextTrimming = TextTrimming.CharacterEllipsis;
            gateTitle.Margin = new Thickness(0, 2, 0, 0);
            stack.Children.Add(gateTitle);
            card.Child = stack;
            var captured = gate;
            card.MouseLeftButtonDown += (_, _) => OpenGitIssuePeekDerived(captured.Number);
            GitTreeHost.Children.Add(card);
        }

        // Epics — the main tree (#2290): Epic → FEATURE → Issue, collapsible at both levels.
        var epicHeader = GitSectionHeader($"Epics ({_gitEpics.Count})", _gitEpicsOpen);
        epicHeader.Margin = new Thickness(0, 6, 0, 0);
        epicHeader.MouseLeftButtonDown += (_, _) => { _gitEpicsOpen = !_gitEpicsOpen; RenderGitTree(); };
        GitTreeHost.Children.Add(epicHeader);
        if (!_gitEpicsOpen) return;

        foreach (var epic in _gitEpics)
        {
            bool expanded = _gitExpandedEpics.Contains(epic.Number);
            var row = GitRowShell(indent: 20);
            row.ColumnLeft(GitChevron(expanded));
            row.ColumnLeft(GitMono($"#{epic.Number}", 10, "Brush.Accent.IssueNum"));
            var name = GitText(StripGitPrefix(epic.Title), 11, "Brush.Text.Primary");
            name.TextTrimming = TextTrimming.CharacterEllipsis;
            name.Margin = new Thickness(5, 0, 0, 0);
            name.Cursor = Cursors.Hand;
            name.ToolTip = $"Open EPIC #{epic.Number} in the panel";
            var capturedEpic = epic;
            name.MouseLeftButtonDown += (_, e) => { e.Handled = true; OpenGitEpicPeek(capturedEpic); };
            row.ColumnFill(name);
            row.Root.MouseLeftButtonDown += (_, _) => ToggleGitEpic(capturedEpic.Number);
            GitTreeHost.Children.Add(row.Root);

            if (!expanded) continue;

            if (_gitEpicsLoadingFeatures.Contains(epic.Number))
            {
                GitTreeHost.Children.Add(GitDimLine("Loading real sub-issues…", indent: 38));
                continue;
            }
            if (!_gitEpicFeatures.TryGetValue(epic.Number, out var features))
                continue; // load failed — the load path already rendered the real error line
            if (features.Count == 0)
            {
                GitTreeHost.Children.Add(GitDimLine("No sub-issues under this epic.", indent: 38));
                continue;
            }
            if (_gitEpicFeatureTotals.TryGetValue(epic.Number, out var total) && total > features.Count)
                GitTreeHost.Children.Add(GitDimLine($"Showing first {features.Count} of {total} sub-issues (GitHub page cap).", indent: 38));

            foreach (var feature in features)
            {
                bool fExpanded = _gitExpandedFeatures.Contains(feature.Number);
                var fRow = GitRowShell(indent: 34);
                fRow.ColumnLeft(feature.HasChildren ? GitChevron(fExpanded) : GitDot(GitNodeBrush(feature)));
                var fName = GitText(StripGitPrefix(feature.Title), 10.5, feature.IsClosed ? "Brush.Text.Dim" : "Brush.Text.Primary");
                fName.TextTrimming = TextTrimming.CharacterEllipsis;
                fName.Margin = new Thickness(5, 0, 4, 0);
                fName.Cursor = Cursors.Hand;
                fName.ToolTip = $"Open FEATURE #{feature.Number} in the panel";
                var capturedFeature = feature;
                fName.MouseLeftButtonDown += (_, e) => { e.Handled = true; OpenGitFeaturePeek(capturedEpic, capturedFeature); };
                fRow.ColumnFill(fName);

                // #2291 — state pill, bug count, open count, all real.
                var (stateLabel, stateBrushKey) = GitNodeState(feature);
                fRow.ColumnRight(GitCountPill(stateLabel, stateBrushKey));
                if (feature.OpenBugCount > 0)
                    fRow.ColumnRight(GitCountPill($"{feature.OpenBugCount} bug{(feature.OpenBugCount == 1 ? "" : "s")}", "Brush.NextUp.Blocked.Fg"));
                if (feature.OpenChildCount > 0)
                    fRow.ColumnRight(GitCountPill($"{feature.OpenChildCount} open", "Brush.Text.Muted"));

                if (feature.HasChildren)
                    fRow.Root.MouseLeftButtonDown += (_, _) => { ToggleGitFeature(capturedFeature.Number); };
                else
                    fRow.Root.MouseLeftButtonDown += (_, _) => OpenGitFeaturePeek(capturedEpic, capturedFeature);
                GitTreeHost.Children.Add(fRow.Root);

                if (!fExpanded || !feature.HasChildren) continue;

                foreach (var issue in feature.Children)
                {
                    var iRow = GitRowShell(indent: 52);
                    iRow.ColumnLeft(GitDot(GitNodeBrush(issue)));
                    var iText = GitText($"#{issue.Number} {issue.Title}", 10.5, issue.IsClosed ? "Brush.Text.Dim" : "Brush.Text.Muted");
                    iText.TextTrimming = TextTrimming.CharacterEllipsis;
                    iText.Margin = new Thickness(6, 0, 0, 0);
                    iRow.ColumnFill(iText);
                    var capturedIssue = issue;
                    iRow.Root.MouseLeftButtonDown += (_, _) => OpenGitIssueRowPeek(capturedEpic, capturedFeature, capturedIssue);
                    GitTreeHost.Children.Add(iRow.Root);
                }
            }
        }
    }

    private void ToggleGitEpic(int epicNumber)
    {
        if (!_gitExpandedEpics.Remove(epicNumber))
        {
            _gitExpandedEpics.Add(epicNumber);
            if (!_gitEpicFeatures.ContainsKey(epicNumber))
                _ = LoadGitEpicFeaturesAsync(epicNumber);
        }
        RenderGitTree();
    }

    private void ToggleGitFeature(int featureNumber)
    {
        if (!_gitExpandedFeatures.Remove(featureNumber))
            _gitExpandedFeatures.Add(featureNumber);
        RenderGitTree();
    }

    private async Task LoadGitEpicFeaturesAsync(int epicNumber)
    {
        if (!_gitEpicsLoadingFeatures.Add(epicNumber)) return;
        var (ok, features, totalCount, error) = await GitPanelService.GetFeatureTreeAsync(epicNumber);
        _gitEpicsLoadingFeatures.Remove(epicNumber);
        if (ok)
        {
            _gitEpicFeatures[epicNumber] = features;
            _gitEpicFeatureTotals[epicNumber] = totalCount;
        }
        else
        {
            GitPanelStatus.Text = $"Epic #{epicNumber} sub-issues failed — {error}";
            GitPanelStatus.Visibility = Visibility.Visible;
        }
        if (_gitTrail.Count == 0) RenderGitTree();
        else if (_gitTrail.Count > 0 && _gitTrail[^1].Kind == GitCrumbKind.Epic && _gitTrail[^1].Number == epicNumber)
            RenderGitPeek();
    }

    // ── peek open paths (#2292-#2296) ────────────────────────────────────────────────────────

    private void OpenGitMilestonePeek(GitPanelMilestone ms)
    {
        SetGitTrail(new List<GitCrumb> { new() { Kind = GitCrumbKind.Milestone, Number = ms.Number, Title = ms.Title } });
        _ = FetchGitMilestoneSnapshotAsync(ms);
    }

    /// <summary>Git #2301 — the Milestone panel's real snapshot: fetched once per milestone number,
    /// cached, re-rendered in place when it lands. Guarded by a request sequence so a user who
    /// navigates away before this resolves doesn't have a stale fetch clobber whatever they opened
    /// next — same pattern <see cref="FetchGitPeekStateAsync"/> already uses.</summary>
    private async Task FetchGitMilestoneSnapshotAsync(GitPanelMilestone ms)
    {
        if (_gitMilestoneSnapshotCache.ContainsKey(ms.Number)) { RenderGitPanel(); return; }
        if (!_gitMilestoneSnapshotLoading.Add(ms.Number)) return;

        int seq = ++_gitMilestoneSnapshotSeq;
        var epicsInMilestone = _gitEpics.Where(e => string.Equals(e.Milestone, ms.Title, StringComparison.OrdinalIgnoreCase)).ToList();
        var snapshot = await GitPanelService.GetMilestoneSnapshotAsync(ms, epicsInMilestone);
        _gitMilestoneSnapshotLoading.Remove(ms.Number);
        if (seq != _gitMilestoneSnapshotSeq) return; // user already navigated elsewhere

        _gitMilestoneSnapshotCache[ms.Number] = snapshot;
        if (_gitTrail.Count > 0 && _gitTrail[^1].Kind == GitCrumbKind.Milestone && _gitTrail[^1].Number == ms.Number)
            RenderGitPanel();
    }

    private void OpenGitEpicPeek(GitMapEpic epic)
    {
        var trail = new List<GitCrumb>();
        AddGitMilestoneCrumb(trail, epic.Milestone);
        trail.Add(new GitCrumb { Kind = GitCrumbKind.Epic, Number = epic.Number, Title = epic.Title });
        SetGitTrail(trail, fetchLastIssue: true);
        // #2311 — the amber "no burndown" banner needs a real feature count, not just identity
        // state; kick off the same load the tree row uses if this epic hasn't been fetched yet.
        if (!_gitEpicFeatures.ContainsKey(epic.Number) && !_gitEpicsLoadingFeatures.Contains(epic.Number))
            _ = LoadGitEpicFeaturesAsync(epic.Number);
    }

    private void OpenGitFeaturePeek(GitMapEpic epic, GitPanelIssueNode feature)
    {
        var trail = new List<GitCrumb>();
        AddGitMilestoneCrumb(trail, epic.Milestone);
        trail.Add(new GitCrumb { Kind = GitCrumbKind.Epic, Number = epic.Number, Title = epic.Title });
        trail.Add(new GitCrumb { Kind = GitCrumbKind.Feature, Number = feature.Number, Title = feature.Title });
        SetGitTrail(trail, fetchLastIssue: true);
    }

    private void OpenGitIssueRowPeek(GitMapEpic epic, GitPanelIssueNode feature, GitPanelIssueNode issue)
    {
        var trail = new List<GitCrumb>();
        AddGitMilestoneCrumb(trail, epic.Milestone);
        trail.Add(new GitCrumb { Kind = GitCrumbKind.Epic, Number = epic.Number, Title = epic.Title });
        trail.Add(new GitCrumb { Kind = GitCrumbKind.Feature, Number = feature.Number, Title = feature.Title });
        trail.Add(new GitCrumb { Kind = GitCrumbKind.Issue, Number = issue.Number, Title = issue.Title });
        SetGitTrail(trail, fetchLastIssue: true);
    }

    /// <summary>Git #2300 — open an issue with no drill trail (a gate card, an alert's "open #N",
    /// a crumb whose context is gone) and still walk up: the trail is derived from the issue's
    /// real GraphQL `parent` chain and nearest real milestone, never guessed.</summary>
    private async void OpenGitIssuePeekDerived(int issueNumber)
    {
        SetGitTrail(new List<GitCrumb> { new() { Kind = GitCrumbKind.Issue, Number = issueNumber, Title = $"#{issueNumber}" } },
            fetchLastIssue: false);

        int seq = ++_gitPeekRequestSeq;
        var (ok, ancestry, error) = await GitPanelService.GetAncestryAsync(issueNumber);
        if (seq != _gitPeekRequestSeq) return; // user already navigated elsewhere
        if (!ok || ancestry == null)
        {
            GitPanelStatus.Text = $"Couldn't derive #{issueNumber}'s ancestry — {error}";
            GitPanelStatus.Visibility = Visibility.Visible;
            return;
        }

        _gitPeekCache[issueNumber] = ancestry;
        var trail = new List<GitCrumb>();
        if (ancestry.MilestoneNumber.HasValue)
            trail.Add(new GitCrumb { Kind = GitCrumbKind.Milestone, Number = ancestry.MilestoneNumber.Value, Title = ancestry.MilestoneTitle ?? "" });
        foreach (var step in ancestry.Chain)
            trail.Add(new GitCrumb { Kind = GitKindFromTitle(step.Title), Number = step.Number, Title = step.Title });
        trail.Add(new GitCrumb { Kind = GitKindFromTitle(ancestry.Title), Number = ancestry.Number, Title = ancestry.Title });

        _gitTrail.Clear();
        _gitTrail.AddRange(trail);
        RenderGitPanel();
    }

    /// <summary>Entry point for surfaces outside this panel (alerts, future Command Center hooks):
    /// opens the GIT rail panel and cold-opens the issue with derived ancestry.</summary>
    private void OpenGitIssueInPanelCold(int issueNumber)
    {
        OpenLeftPanelGit();
        _ = EnsureGitPanelLoadedAsync();
        OpenGitIssuePeekDerived(issueNumber);
    }

    private void SetGitTrail(List<GitCrumb> trail, bool fetchLastIssue = false)
    {
        _gitTrail.Clear();
        _gitTrail.AddRange(trail);
        RenderGitPanel();
        if (fetchLastIssue && trail.Count > 0 && trail[^1].Kind != GitCrumbKind.Milestone)
            _ = FetchGitPeekStateAsync(trail[^1].Number);
    }

    /// <summary>Fills the current peek's real state/labels (one ancestry call, cached). The peek
    /// renders immediately with its known identity and upgrades in place when this lands.</summary>
    private async Task FetchGitPeekStateAsync(int issueNumber)
    {
        if (_gitPeekCache.ContainsKey(issueNumber)) { RenderGitPanel(); return; }
        int seq = ++_gitPeekRequestSeq;
        var (ok, ancestry, _) = await GitPanelService.GetAncestryAsync(issueNumber);
        if (ok && ancestry != null) _gitPeekCache[issueNumber] = ancestry;
        if (seq != _gitPeekRequestSeq) return;
        if (_gitTrail.Count > 0 && _gitTrail[^1].Number == issueNumber && _gitTrail[^1].Kind != GitCrumbKind.Milestone)
            RenderGitPanel();
    }

    // ── peek render (#2297-#2299 breadcrumb + named back) ────────────────────────────────────

    private void RenderGitPeek()
    {
        GitPeekHost.Children.Clear();
        if (_gitTrail.Count == 0) return;
        var current = _gitTrail[^1];

        // Header: back link naming its real destination (#2299) + close-to-tree.
        var header = new DockPanel { Margin = new Thickness(4, 2, 4, 8) };
        var close = GitText("×", 14, "Brush.Text.Dim");
        close.Cursor = Cursors.Hand;
        close.ToolTip = "Close peek — back to the Git tree";
        close.MouseLeftButtonDown += (_, _) => { _gitTrail.Clear(); RenderGitPanel(); };
        DockPanel.SetDock(close, Dock.Right);
        header.Children.Add(close);

        string backLabel = _gitTrail.Count >= 2 ? $"‹ Back to {GitCrumbLabel(_gitTrail[^2])}" : "‹ Back to Git tree";
        var back = GitText(backLabel, 10.5, "Brush.Text.Muted");
        back.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
        back.TextTrimming = TextTrimming.CharacterEllipsis;
        back.Cursor = Cursors.Hand;
        back.MouseLeftButtonDown += (_, _) => GitPeekBack();
        header.Children.Add(back);
        GitPeekHost.Children.Add(header);

        // Breadcrumb strip — labelled chips, every non-current crumb clickable (#2297, #2298).
        var chipWrap = new WrapPanel { Margin = new Thickness(4, 0, 4, 8) };
        for (int i = 0; i < _gitTrail.Count; i++)
        {
            bool isCurrent = i == _gitTrail.Count - 1;
            var crumb = _gitTrail[i];
            var chip = new Border
            {
                Margin = new Thickness(0, 0, 3, 3),
                Padding = new Thickness(6, 2, 6, 2),
                CornerRadius = new CornerRadius(5),
                Background = (Brush)FindResource("Brush.Bg.Chip"),
                BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource(isCurrent ? "Brush.Border.Popover" : "Brush.Border.Default"),
                MaxWidth = 240
            };
            var chipText = GitText(GitCrumbLabel(crumb), 9.5, isCurrent ? "Brush.Text.Heading" : "Brush.Text.Muted");
            chipText.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
            chipText.TextTrimming = TextTrimming.CharacterEllipsis;
            chip.Child = chipText;
            if (!isCurrent)
            {
                chip.Cursor = Cursors.Hand;
                chip.ToolTip = $"Back to {GitCrumbLabel(crumb)}";
                int capturedIndex = i;
                chip.MouseLeftButtonDown += (_, _) => GitTruncateTrailTo(capturedIndex);
            }
            chipWrap.Children.Add(chip);
            if (!isCurrent)
                chipWrap.Children.Add(GitText("›", 9.5, "Brush.Text.Dim", rightPad: 3));
        }
        GitPeekHost.Children.Add(chipWrap);

        // Identity — the minimal real peek this build ships (#2292-#2296). Rich content is
        // items 12-23, later builds under Feature #2289.
        var kindCaption = GitText(current.Kind.ToString().ToUpperInvariant(), 9, null);
        kindCaption.Foreground = (Brush)FindResource(current.Kind == GitCrumbKind.Gate ? "Brush.Epic.Gate" : "Brush.Accent.Primary");
        kindCaption.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        kindCaption.Margin = new Thickness(6, 0, 6, 2);
        GitPeekHost.Children.Add(kindCaption);

        if (current.Kind != GitCrumbKind.Milestone)
        {
            var num = GitMono($"#{current.Number}", 11, "Brush.Accent.IssueNum");
            num.Margin = new Thickness(6, 0, 6, 2);
            GitPeekHost.Children.Add(num);
        }

        var title = GitText(current.Kind == GitCrumbKind.Milestone ? current.Title : StripGitPrefix(current.Title), 13, "Brush.Text.Heading");
        title.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        title.TextWrapping = TextWrapping.Wrap;
        title.Margin = new Thickness(6, 0, 6, 8);
        GitPeekHost.Children.Add(title);

        if (current.Kind == GitCrumbKind.Milestone)
        {
            RenderGitMilestonePanel(current.Number);
            return;
        }

        if (current.Kind == GitCrumbKind.Gate)
        {
            RenderGitGatePeekBody(current.Number);
        }
        else
        {
            if (_gitPeekCache.TryGetValue(current.Number, out var state))
            {
                var pills = new WrapPanel { Margin = new Thickness(6, 0, 6, 8) };
                pills.Children.Add(GitCountPill(state.IsClosed ? "CLOSED" : "OPEN", state.IsClosed ? "Brush.Status.Done" : "Brush.Status.Running"));
                foreach (var label in state.Labels)
                    pills.Children.Add(GitCountPill(label, "Brush.Text.Muted"));
                GitPeekHost.Children.Add(pills);
            }
            else
            {
                GitPeekHost.Children.Add(GitDimLine("Loading real state…", indent: 6));
            }

            // #2311 — real "no burndown" warning: an Epic whose sub-issue fetch came back with
            // zero FEATURE children has nothing to compute a burndown ring from. Total comes
            // straight off GitPanelService.GetFeatureTreeAsync's real TotalCount (#2290), never
            // inferred/guessed.
            if (current.Kind == GitCrumbKind.Epic && _gitEpicFeatureTotals.TryGetValue(current.Number, out var featureTotal) && featureTotal == 0)
            {
                var amber = (Color)ColorConverter.ConvertFromString("#E2984A"); // Brush.Toast.Warning hex
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

            var note = GitDimLine("Peek detail content (vitals, rings, actions) lands in later builds under Feature #2289.", indent: 6);
            note.Margin = new Thickness(6, 10, 6, 0);
            GitPeekHost.Children.Add(note);
        }
    }

    // ── Gate peek body (#2302) ───────────────────────────────────────────────────────────────

    /// <summary>Git #2302 — the real Gate detail body: a ring of green checks (closed/total of
    /// the gate's own real sub-issues), a verdict band, the real blocked-critical-epics list
    /// (open Epic: issues sharing the gate's milestone that carry the `blocked` label, each
    /// resolved against its real `blocked_by` edges so a stale edge is flagged), the full check
    /// list, and a real "Run Verification Sweep" action that re-fetches all of it.</summary>
    private void RenderGitGatePeekBody(int gateNumber)
    {
        if (!_gitGateDetailCache.TryGetValue(gateNumber, out var detail))
        {
            GitPeekHost.Children.Add(GitDimLine(
                _gitGateDetailLoading.Contains(gateNumber) ? "Running verification sweep — reading real GitHub state…" : "Loading real gate checks…",
                indent: 6));
            if (!_gitGateDetailLoading.Contains(gateNumber))
                _ = FetchGitGateDetailAsync(gateNumber);
            return;
        }

        bool hasChecks = detail.TotalCheckCount > 0;
        bool ready = hasChecks && detail.ClosedCheckCount == detail.TotalCheckCount && detail.BlockedCriticalEpics.Count == 0;
        int openChecks = detail.TotalCheckCount - detail.ClosedCheckCount;
        double fraction = hasChecks ? (double)detail.ClosedCheckCount / detail.TotalCheckCount : 0;

        // Ring of green checks + summary ------------------------------------------------------
        var ringRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(6, 2, 6, 10) };
        ringRow.Children.Add(GitRing(84, 9, fraction,
            (Brush)FindResource("Brush.Status.Done"), (Brush)FindResource("Brush.Border.Default"),
            hasChecks ? $"{detail.ClosedCheckCount}/{detail.TotalCheckCount}" : "0/0", "checks"));

        var ringSide = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0) };
        var summaryLine = GitText(
            !hasChecks ? "No checks on this gate yet" : ready ? "All checks green" : $"{openChecks} check{(openChecks == 1 ? "" : "s")} still open",
            11.5, ready ? "Brush.Status.Done" : "Brush.Text.Primary");
        summaryLine.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
        ringSide.Children.Add(summaryLine);
        if (detail.BlockedCriticalEpics.Count > 0)
        {
            var blockedLine = GitText($"{detail.BlockedCriticalEpics.Count} blocked critical epic{(detail.BlockedCriticalEpics.Count == 1 ? "" : "s")}", 10.5, "Brush.NextUp.Blocked.Fg");
            blockedLine.Margin = new Thickness(0, 2, 0, 0);
            ringSide.Children.Add(blockedLine);
        }
        var sweptLine = GitDimLine($"Last swept {FormatSweptAgo(detail.SweptAtUtc)}", indent: 0);
        sweptLine.Margin = new Thickness(0, 2, 0, 0);
        ringSide.Children.Add(sweptLine);
        ringRow.Children.Add(ringSide);
        GitPeekHost.Children.Add(ringRow);

        // Verdict band --------------------------------------------------------------------------
        var verdictAccent = (SolidColorBrush)FindResource(ready ? "Brush.Status.Done" : "Brush.NextUp.Blocked.Fg");
        string verdictHeadline = !hasChecks ? "NO CHECKS FOUND" : ready ? "READY — every check is closed" : "NOT READY";
        var verdictParts = new List<string>();
        if (hasChecks && openChecks > 0) verdictParts.Add($"{openChecks} of {detail.TotalCheckCount} checks open");
        if (detail.BlockedCriticalEpics.Count > 0) verdictParts.Add($"{detail.BlockedCriticalEpics.Count} blocked critical epic{(detail.BlockedCriticalEpics.Count == 1 ? "" : "s")}");
        if (detail.StaleBlockerEdgeCount > 0) verdictParts.Add($"{detail.StaleBlockerEdgeCount} stale blocking edge{(detail.StaleBlockerEdgeCount == 1 ? "" : "s")} — blocker already closed");
        string? verdictSub = verdictParts.Count > 0 ? string.Join(" · ", verdictParts) : (ready ? "No blocked critical epics." : null);
        GitPeekHost.Children.Add(GitVerdictBand(verdictHeadline, verdictSub, verdictAccent));

        // Blocked critical epics ------------------------------------------------------------------
        var epicsHeader = GitText($"BLOCKED CRITICAL EPICS ({detail.BlockedCriticalEpics.Count})", 9, "Brush.Text.Dim");
        epicsHeader.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        epicsHeader.Margin = new Thickness(6, 4, 6, 4);
        GitPeekHost.Children.Add(epicsHeader);
        if (detail.BlockedCriticalEpics.Count == 0)
        {
            GitPeekHost.Children.Add(GitDimLine(
                detail.MilestoneNumber.HasValue
                    ? "None — no open Epic: issue in this gate's milestone carries the blocked label."
                    : "This gate has no milestone — blocked-critical-epic scan skipped.",
                indent: 6));
        }
        else
        {
            foreach (var epic in detail.BlockedCriticalEpics)
            {
                var card = new Border
                {
                    Margin = new Thickness(4, 0, 4, 4),
                    Padding = new Thickness(8, 6, 8, 6),
                    CornerRadius = new CornerRadius(6),
                    BorderThickness = new Thickness(1),
                    BorderBrush = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.NextUp.Blocked.Fg")).Color) { Opacity = 0.35 },
                    Background = (Brush)FindResource("Brush.NextUp.Blocked.Bg"),
                    Cursor = Cursors.Hand
                };
                var stack = new StackPanel();
                var titleTb = GitText($"#{epic.Number} {StripGitPrefix(epic.Title)}", 10.5, "Brush.Text.Heading");
                titleTb.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
                titleTb.TextWrapping = TextWrapping.Wrap;
                stack.Children.Add(titleTb);
                if (epic.BlockedBy.Count == 0)
                {
                    var noEdge = GitDimLine("blocked label set, but no real blocked_by edge recorded", indent: 0);
                    noEdge.Margin = new Thickness(0, 3, 0, 0);
                    stack.Children.Add(noEdge);
                }
                else
                {
                    var wrap = new WrapPanel { Margin = new Thickness(0, 3, 0, 0) };
                    foreach (var edge in epic.BlockedBy)
                    {
                        string pillText = edge.IsClosed ? $"STALE — #{edge.Number} already closed" : $"blocked by #{edge.Number}";
                        wrap.Children.Add(GitCountPill(pillText, edge.IsClosed ? "Brush.NextUp.Blocked.Fg" : "Brush.Text.Muted"));
                    }
                    stack.Children.Add(wrap);
                }
                card.Child = stack;
                var capturedEpicNum = epic.Number;
                card.MouseLeftButtonDown += (_, _) => OpenGitIssuePeekDerived(capturedEpicNum);
                GitPeekHost.Children.Add(card);
            }
        }

        // Full check list -------------------------------------------------------------------------
        var checksHeader = GitText($"CHECKS ({detail.ClosedCheckCount}/{detail.TotalCheckCount})", 9, "Brush.Text.Dim");
        checksHeader.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        checksHeader.Margin = new Thickness(6, 10, 6, 4);
        GitPeekHost.Children.Add(checksHeader);
        if (detail.Checks.Count == 0)
        {
            GitPeekHost.Children.Add(GitDimLine("This gate has no sub-issues yet — nothing to check.", indent: 6));
        }
        else
        {
            foreach (var check in detail.Checks)
            {
                var row = GitRowShell(indent: 6);
                row.ColumnLeft(GitDot((Brush)FindResource(check.IsClosed ? "Brush.Status.Done" : "Brush.Text.Dim")));
                var text = GitText($"#{check.Number} {check.Title}", 10.5, check.IsClosed ? "Brush.Text.Dim" : "Brush.Text.Primary");
                text.TextTrimming = TextTrimming.CharacterEllipsis;
                text.Margin = new Thickness(5, 0, 4, 0);
                row.ColumnFill(text);
                row.ColumnRight(GitCountPill(check.IsClosed ? "CLOSED" : "OPEN", check.IsClosed ? "Brush.Status.Done" : "Brush.Status.Running"));
                var capturedCheckNum = check.Number;
                row.Root.MouseLeftButtonDown += (_, _) => OpenGitIssuePeekDerived(capturedCheckNum);
                GitPeekHost.Children.Add(row.Root);
            }
        }

        // Run Verification Sweep -------------------------------------------------------------------
        bool sweeping = _gitGateDetailLoading.Contains(gateNumber);
        var sweepBtn = new Button
        {
            Content = sweeping ? "Sweeping…" : "Run Verification Sweep",
            Margin = new Thickness(6, 12, 6, 0),
            Height = 30,
            Padding = new Thickness(12, 0, 12, 0),
            Background = (Brush)FindResource("Brush.Accent.Primary"),
            Foreground = Brushes.Black,
            BorderThickness = new Thickness(0),
            FontSize = 11,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Cursor = Cursors.Hand,
            IsEnabled = !sweeping,
            HorizontalAlignment = HorizontalAlignment.Left
        };
        sweepBtn.Click += (_, _) =>
        {
            _gitGateDetailCache.Remove(gateNumber);
            _ = FetchGitGateDetailAsync(gateNumber);
            RenderGitPanel();
        };
        GitPeekHost.Children.Add(sweepBtn);
    }

    /// <summary>Fetches (or re-fetches, for "Run Verification Sweep") one gate's real detail
    /// snapshot. Guarded against overlapping calls for the same gate; a stale response (user
    /// navigated elsewhere before this landed) is dropped rather than rendered.</summary>
    private async Task FetchGitGateDetailAsync(int gateNumber)
    {
        if (!_gitGateDetailLoading.Add(gateNumber)) return;
        int seq = ++_gitPeekRequestSeq;
        var (ok, detail, error) = await GitPanelService.GetGateDetailAsync(gateNumber);
        _gitGateDetailLoading.Remove(gateNumber);
        if (ok && detail != null) _gitGateDetailCache[gateNumber] = detail;
        if (seq != _gitPeekRequestSeq) return;
        if (!ok)
        {
            GitPanelStatus.Text = $"Gate #{gateNumber} verification sweep failed — {error}";
            GitPanelStatus.Visibility = Visibility.Visible;
        }
        if (_gitTrail.Count > 0 && _gitTrail[^1].Number == gateNumber && _gitTrail[^1].Kind == GitCrumbKind.Gate)
            RenderGitPanel();
    }

    private static string FormatSweptAgo(DateTime sweptAtUtc)
    {
        var span = DateTime.UtcNow - sweptAtUtc;
        if (span.TotalSeconds < 30) return "just now";
        if (span.TotalMinutes < 1) return $"{(int)span.TotalSeconds}s ago";
        if (span.TotalHours < 1) return $"{(int)span.TotalMinutes}m ago";
        if (span.TotalDays < 1) return $"{(int)span.TotalHours}h ago";
        return $"{(int)span.TotalDays}d ago";
    }

    /// <summary>A translucent, accent-colored band naming the gate's real verdict — same visual
    /// language as the gate cards in the tree (translucent bg, 55%-opacity border, bold accent
    /// caption).</summary>
    private Border GitVerdictBand(string headline, string? sub, SolidColorBrush accent)
    {
        var card = new Border
        {
            Margin = new Thickness(6, 0, 6, 10),
            Padding = new Thickness(10, 8, 10, 8),
            CornerRadius = new CornerRadius(7),
            BorderThickness = new Thickness(1.5),
            BorderBrush = new SolidColorBrush(accent.Color) { Opacity = 0.55 },
            Background = new SolidColorBrush(accent.Color) { Opacity = 0.10 }
        };
        var stack = new StackPanel();
        var head = GitText(headline, 11.5, null);
        head.Foreground = accent;
        head.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        stack.Children.Add(head);
        if (!string.IsNullOrEmpty(sub))
        {
            var subTb = GitText(sub, 10, "Brush.Text.Muted");
            subTb.TextWrapping = TextWrapping.Wrap;
            subTb.Margin = new Thickness(0, 3, 0, 0);
            stack.Children.Add(subTb);
        }
        card.Child = stack;
        return card;
    }

    /// <summary>A round progress ring drawn from real fraction-complete — no chart library, just
    /// a background <see cref="Ellipse"/> track and a foreground <see cref="Path"/> arc (a full
    /// <see cref="Ellipse"/> when fraction is effectively 1, since a single ArcSegment can't
    /// describe a full 360° sweep). Center text is the real count, not a fabricated percentage.</summary>
    private FrameworkElement GitRing(double size, double thickness, double fraction, Brush fgBrush, Brush bgBrush, string centerLine1, string? centerLine2 = null)
    {
        fraction = Math.Max(0, Math.Min(1, fraction));
        double r = (size - thickness) / 2;
        var grid = new Grid { Width = size, Height = size };

        grid.Children.Add(new Ellipse
        {
            Width = r * 2,
            Height = r * 2,
            Stroke = bgBrush,
            StrokeThickness = thickness,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        });

        if (fraction >= 0.999)
        {
            grid.Children.Add(new Ellipse
            {
                Width = r * 2,
                Height = r * 2,
                Stroke = fgBrush,
                StrokeThickness = thickness,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            });
        }
        else if (fraction > 0.001)
        {
            double center = size / 2;
            double angleDeg = fraction * 360.0;
            var start = new Point(center, center - r);
            double rad = (angleDeg - 90.0) * Math.PI / 180.0;
            var end = new Point(center + r * Math.Cos(rad), center + r * Math.Sin(rad));
            bool isLargeArc = angleDeg > 180.0;

            var figure = new PathFigure { StartPoint = start, IsClosed = false };
            figure.Segments.Add(new ArcSegment(end, new Size(r, r), 0, isLargeArc, SweepDirection.Clockwise, true));
            var geometry = new PathGeometry();
            geometry.Figures.Add(figure);

            grid.Children.Add(new Path
            {
                Data = geometry,
                Stroke = fgBrush,
                StrokeThickness = thickness,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            });
        }

        var centerStack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var line1 = GitText(centerLine1, size * 0.20, "Brush.Text.Heading");
        line1.HorizontalAlignment = HorizontalAlignment.Center;
        line1.TextAlignment = TextAlignment.Center;
        line1.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        centerStack.Children.Add(line1);
        if (!string.IsNullOrEmpty(centerLine2))
        {
            var line2 = GitText(centerLine2, size * 0.12, "Brush.Text.Dim");
            line2.HorizontalAlignment = HorizontalAlignment.Center;
            line2.TextAlignment = TextAlignment.Center;
            centerStack.Children.Add(line2);
        }
        grid.Children.Add(centerStack);

        return grid;
    }

    // ── Milestone panel content (#2301, item 12) ────────────────────────────────────────────

    /// <summary>Git #2301 — the Milestone detail panel: the big ring (real open/closed issue
    /// counts straight off GitHub's own milestone endpoint — already loaded, no wait), the
    /// epics/features/issues/gate-check vitals and per-epic rows (both need the real snapshot
    /// fetch triggered on open — rendered once it lands), and the stalled-feature warning.</summary>
    private void RenderGitMilestonePanel(int milestoneNumber)
    {
        var ms = _gitMilestones.FirstOrDefault(m => m.Number == milestoneNumber);
        if (ms == null)
        {
            GitPeekHost.Children.Add(GitDimLine("Milestone no longer in the real open list.", indent: 6));
            return;
        }

        int totalIssues = ms.OpenCount + ms.ClosedCount;
        double overallPercent = totalIssues == 0 ? 0 : (double)ms.ClosedCount / totalIssues;

        // Big ring + real open/closed legend.
        var ringRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(6, 0, 6, 10) };
        ringRow.Children.Add(GitRing(overallPercent, 76, 9,
            overallPercent >= 1.0 ? "Brush.Status.Done" : "Brush.Status.Running",
            $"{Math.Round(overallPercent * 100)}%", 13));
        var legend = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0) };
        legend.Children.Add(GitLegendLine($"{ms.ClosedCount} closed", "Brush.Status.Done"));
        legend.Children.Add(GitLegendLine($"{ms.OpenCount} open", "Brush.Status.Running"));
        legend.Children.Add(GitDimLine($"{totalIssues} real issue{(totalIssues == 1 ? "" : "s")} on this milestone", indent: 0));
        ringRow.Children.Add(legend);
        GitPeekHost.Children.Add(ringRow);

        if (!_gitMilestoneSnapshotCache.TryGetValue(milestoneNumber, out var snap))
        {
            GitPeekHost.Children.Add(GitDimLine("Loading real epics/features/issues/gate-check breakdown…", indent: 6));
            return;
        }

        // Vitals — epics / features / issues / gate-check, all real counts off this session's snapshot.
        var vitals = new WrapPanel { Margin = new Thickness(6, 0, 6, 10) };
        vitals.Children.Add(GitVitalTile(snap.OpenEpicCount.ToString(), "OPEN EPICS"));
        vitals.Children.Add(GitVitalTile(snap.OpenFeatureCount.ToString(), "FEATURES OPEN"));
        vitals.Children.Add(GitVitalTile(snap.OpenIssueCount.ToString(), "ISSUES OPEN"));
        vitals.Children.Add(GitVitalTile(snap.GateTotal == 0 ? "—" : $"{snap.GateClosedCount}/{snap.GateTotal}", "GATE CHECKS",
            snap.GateTotal > 0 && snap.GateClosedCount == snap.GateTotal ? "Brush.Status.Done" : "Brush.Text.Heading"));
        GitPeekHost.Children.Add(vitals);

        // Stalled-feature warning — real, only rendered when something genuinely qualifies.
        if (snap.StalledFeatures.Count > 0)
        {
            var warnBorder = new Border
            {
                Margin = new Thickness(4, 0, 4, 10),
                Padding = new Thickness(9, 7, 9, 7),
                CornerRadius = new CornerRadius(7),
                Background = (Brush)FindResource("Brush.NextUp.NeedsReview.Bg"),
                BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource("Brush.NextUp.NeedsReview.Border")
            };
            var warnStack = new StackPanel();
            var warnHeader = GitText($"⚠ {snap.StalledFeatures.Count} stalled feature{(snap.StalledFeatures.Count == 1 ? "" : "s")}", 10.5, "Brush.NextUp.NeedsReview.Fg");
            warnHeader.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
            warnStack.Children.Add(warnHeader);
            foreach (var sf in snap.StalledFeatures.Take(8))
            {
                var row = new TextBlock
                {
                    Margin = new Thickness(0, 3, 0, 0),
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                    FontSize = 9.5,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    Cursor = Cursors.Hand,
                    Foreground = (Brush)FindResource("Brush.NextUp.NeedsReview.Fg")
                };
                row.Inlines.Add(new System.Windows.Documents.Run($"#{sf.Number} {StripGitPrefix(sf.Title)} ") { FontWeight = (FontWeight)FindResource("FontWeight.Bold") });
                row.Inlines.Add(new System.Windows.Documents.Run($"— {sf.Reason} · under {StripGitPrefix(sf.EpicTitle)}") { Foreground = (Brush)FindResource("Brush.Text.Muted") });
                int captured = sf.Number;
                row.MouseLeftButtonDown += (_, e) => { e.Handled = true; OpenGitIssuePeekDerived(captured); };
                warnStack.Children.Add(row);
            }
            if (snap.StalledFeatures.Count > 8)
                warnStack.Children.Add(GitDimLine($"+ {snap.StalledFeatures.Count - 8} more.", indent: 0));
            warnBorder.Child = warnStack;
            GitPeekHost.Children.Add(warnBorder);
        }

        // Per-epic rows — mini ring + weeks-to-done, every open epic under this milestone.
        var epicsHeader = GitText($"EPICS ({snap.EpicRows.Count})", 9, "Brush.Text.Dim");
        epicsHeader.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        epicsHeader.Margin = new Thickness(6, 0, 6, 4);
        GitPeekHost.Children.Add(epicsHeader);

        if (snap.EpicRows.Count == 0)
        {
            GitPeekHost.Children.Add(GitDimLine("No open epics carry this milestone.", indent: 6));
        }
        foreach (var row in snap.EpicRows)
        {
            var epicMatch = _gitEpics.FirstOrDefault(e => e.Number == row.Number);
            var card = new Border
            {
                Margin = new Thickness(4, 0, 4, 4),
                Padding = new Thickness(8, 6, 8, 6),
                CornerRadius = new CornerRadius(6),
                Background = (Brush)FindResource("Brush.Bg.Chip"),
                Cursor = Cursors.Hand
            };
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var ring = GitRing(row.PercentDone, 30, 4, row.PercentDone >= 1.0 ? "Brush.Status.Done" : "Brush.Status.Running", null);
            Grid.SetColumn(ring, 0);
            grid.Children.Add(ring);

            var mid = new StackPanel { Margin = new Thickness(8, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
            var nameLine = GitText($"#{row.Number} {StripGitPrefix(row.Title)}", 10.5, "Brush.Text.Primary");
            nameLine.TextTrimming = TextTrimming.CharacterEllipsis;
            mid.Children.Add(nameLine);
            var subLine = GitText($"{row.OpenIssues} open of {row.TotalIssues}" + (row.StalledFeatures.Count > 0 ? $" · {row.StalledFeatures.Count} stalled" : ""),
                8.5, row.StalledFeatures.Count > 0 ? "Brush.NextUp.NeedsReview.Fg" : "Brush.Text.Muted");
            mid.Children.Add(subLine);
            Grid.SetColumn(mid, 1);
            grid.Children.Add(mid);

            var weeks = GitText(GitFormatWeeksToDone(row), 9, "Brush.Text.Muted");
            weeks.VerticalAlignment = VerticalAlignment.Center;
            weeks.TextAlignment = TextAlignment.Right;
            Grid.SetColumn(weeks, 2);
            grid.Children.Add(weeks);

            card.Child = grid;
            card.MouseLeftButtonDown += (_, e) =>
            {
                e.Handled = true;
                if (epicMatch != null) OpenGitEpicPeek(epicMatch);
                else OpenGitIssuePeekDerived(row.Number); // epic fell out of the open list between fetches — derive instead of failing silently
            };
            GitPeekHost.Children.Add(card);
        }

        if (snap.PartialErrors.Count > 0)
        {
            var errNote = GitDimLine("Partial data — " + string.Join(" · ", snap.PartialErrors), indent: 6);
            errNote.Margin = new Thickness(6, 6, 6, 0);
            GitPeekHost.Children.Add(errNote);
        }
    }

    private static string GitFormatWeeksToDone(GitPanelEpicSnapshot row)
    {
        if (row.OpenIssues <= 0) return "done";
        if (row.WeeksToDone == null) return "no recent closes";
        double w = row.WeeksToDone.Value;
        return w < 0.1 ? "<0.1w to done" : $"~{w:0.#}w to done";
    }

    private TextBlock GitLegendLine(string text, string brushKey)
    {
        var tb = GitText(text, 10, brushKey);
        tb.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
        return tb;
    }

    /// <summary>One real stat tile for the Milestone panel's vitals row — a big number over a
    /// small caption, no ring, no fabricated trend arrow.</summary>
    private Border GitVitalTile(string value, string caption, string valueBrushKey = "Brush.Text.Heading")
    {
        var stack = new StackPanel();
        var valueText = GitText(value, 15, valueBrushKey);
        valueText.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
        stack.Children.Add(valueText);
        var captionText = GitText(caption, 8, "Brush.Text.Dim");
        captionText.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
        stack.Children.Add(captionText);
        return new Border
        {
            Margin = new Thickness(0, 0, 8, 6),
            Padding = new Thickness(8, 5, 12, 5),
            CornerRadius = new CornerRadius(6),
            Background = (Brush)FindResource("Brush.Bg.Chip"),
            Child = stack
        };
    }

    /// <summary>Git #2301 — a real WPF-drawn progress ring (background track + a clockwise arc from
    /// 12 o'clock for <paramref name="percent"/>), no image assets. Used for both the Milestone
    /// panel's big overall ring and its per-epic mini rings.</summary>
    private FrameworkElement GitRing(double percent, double size, double thickness, string fgBrushKey, string? centerText, double centerFontSize = 9)
    {
        percent = Math.Clamp(percent, 0, 1);
        var grid = new Grid { Width = size, Height = size };

        grid.Children.Add(new System.Windows.Shapes.Ellipse
        {
            Width = size,
            Height = size,
            Stroke = (Brush)FindResource("Brush.Border.Default"),
            StrokeThickness = thickness,
            Opacity = 0.4
        });

        if (percent > 0.002)
        {
            double radius = (size - thickness) / 2;
            var center = new Point(size / 2, size / 2);
            const double startAngle = -90;
            double sweep = Math.Min(percent * 360.0, 359.9);
            double endAngle = startAngle + sweep;

            Point OnCircle(double angleDeg)
            {
                double rad = angleDeg * Math.PI / 180.0;
                return new Point(center.X + radius * Math.Cos(rad), center.Y + radius * Math.Sin(rad));
            }

            var figure = new PathFigure { StartPoint = OnCircle(startAngle), IsClosed = false };
            figure.Segments.Add(new ArcSegment(OnCircle(endAngle), new Size(radius, radius), 0, sweep > 180, SweepDirection.Clockwise, true));
            var geometry = new PathGeometry();
            geometry.Figures.Add(figure);
            grid.Children.Add(new System.Windows.Shapes.Path
            {
                Data = geometry,
                Stroke = (Brush)FindResource(fgBrushKey),
                StrokeThickness = thickness,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            });
        }

        if (centerText != null)
        {
            var text = GitText(centerText, centerFontSize, "Brush.Text.Heading");
            text.FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold");
            text.HorizontalAlignment = HorizontalAlignment.Center;
            text.VerticalAlignment = VerticalAlignment.Center;
            grid.Children.Add(text);
        }
        return grid;
    }

    private void GitPeekBack()
    {
        if (_gitTrail.Count > 0) _gitTrail.RemoveAt(_gitTrail.Count - 1);
        AfterGitTrailChanged();
    }

    private void GitTruncateTrailTo(int index)
    {
        if (index < 0 || index >= _gitTrail.Count - 1) return;
        _gitTrail.RemoveRange(index + 1, _gitTrail.Count - index - 1);
        AfterGitTrailChanged();
    }

    private void AfterGitTrailChanged()
    {
        RenderGitPanel();
        if (_gitTrail.Count == 0) return;
        var current = _gitTrail[^1];
        if (current.Kind == GitCrumbKind.Milestone)
        {
            var ms = _gitMilestones.FirstOrDefault(m => m.Number == current.Number);
            if (ms != null) _ = FetchGitMilestoneSnapshotAsync(ms);
        }
        else
        {
            _ = FetchGitPeekStateAsync(current.Number);
        }
    }

    // ── shared helpers ───────────────────────────────────────────────────────────────────────

    private void AddGitMilestoneCrumb(List<GitCrumb> trail, string? milestoneTitle)
    {
        if (string.IsNullOrEmpty(milestoneTitle)) return;
        var ms = _gitMilestones.FirstOrDefault(m => string.Equals(m.Title, milestoneTitle, StringComparison.OrdinalIgnoreCase));
        if (ms != null)
            trail.Add(new GitCrumb { Kind = GitCrumbKind.Milestone, Number = ms.Number, Title = ms.Title });
    }

    /// <summary>Labelled chip text per #2297's own example — MILESTONE v1.1 · EPIC #1202 Build
    /// Console · FEATURE SQL Runner: milestones show their short name, epics carry their number,
    /// features/issues read naturally with prefixes stripped.</summary>
    private static string GitCrumbLabel(GitCrumb crumb) => crumb.Kind switch
    {
        GitCrumbKind.Milestone => $"MILESTONE {ShortMilestoneTitle(crumb.Title)}",
        GitCrumbKind.Gate => $"GATE #{crumb.Number} {StripGitPrefix(crumb.Title)}",
        GitCrumbKind.Epic => $"EPIC #{crumb.Number} {StripGitPrefix(crumb.Title)}",
        GitCrumbKind.Feature => $"FEATURE {StripGitPrefix(crumb.Title)}",
        _ => $"ISSUE #{crumb.Number}"
    };

    private static GitCrumbKind GitKindFromTitle(string title)
    {
        if (title.StartsWith("Epic:", StringComparison.OrdinalIgnoreCase)) return GitCrumbKind.Epic;
        if (title.StartsWith("Feature:", StringComparison.OrdinalIgnoreCase)) return GitCrumbKind.Feature;
        if (title.StartsWith("GATE:", StringComparison.OrdinalIgnoreCase)) return GitCrumbKind.Gate;
        return GitCrumbKind.Issue;
    }

    /// <summary>"EPIC: Build Console" → "Build Console"; same for Epic:/Feature:/GATE: prefixes.</summary>
    private static string StripGitPrefix(string title)
    {
        foreach (var prefix in new[] { "EPIC:", "Epic:", "Feature:", "FEATURE:", "GATE:" })
            if (title.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return title[prefix.Length..].Trim();
        return title;
    }

    /// <summary>"v1.1 - Monitoring &amp; Launch Control" → "v1.1" — the short form #2297's example
    /// uses. Titles without a " - " separator show whole.</summary>
    private static string ShortMilestoneTitle(string title)
    {
        int sep = title.IndexOf(" - ", StringComparison.Ordinal);
        return sep > 0 ? title[..sep].Trim() : title;
    }

    private static (string Label, string BrushKey) GitNodeState(GitPanelIssueNode node)
    {
        if (node.IsClosed) return ("CLOSED", "Brush.Status.Done");
        if (node.Labels.Contains("blocked", StringComparer.OrdinalIgnoreCase)) return ("BLOCKED", "Brush.NextUp.Blocked.Fg");
        if (node.Labels.Contains("in-flight", StringComparer.OrdinalIgnoreCase)) return ("IN FLIGHT", "Brush.Status.Running");
        if (node.Labels.Contains("complete", StringComparer.OrdinalIgnoreCase)) return ("COMPLETE", "Brush.Status.Verifying");
        return ("OPEN", "Brush.Text.Muted");
    }

    private Brush GitNodeBrush(GitPanelIssueNode node) => (Brush)FindResource(GitNodeState(node).BrushKey);

    private TextBlock GitText(string text, double size, string? brushKey, double rightPad = 0)
    {
        var tb = new TextBlock
        {
            Text = text,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = size,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, rightPad, 0)
        };
        if (brushKey != null) tb.Foreground = (Brush)FindResource(brushKey);
        return tb;
    }

    private TextBlock GitMono(string text, double size, string brushKey)
    {
        var tb = GitText(text, size, brushKey);
        tb.FontFamily = (FontFamily)FindResource("FontFamily.Monospace");
        tb.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
        return tb;
    }

    private TextBlock GitDimLine(string text, double indent)
    {
        var tb = GitText(text, 10, "Brush.Text.Dim");
        tb.Margin = new Thickness(indent, 2, 6, 2);
        tb.TextWrapping = TextWrapping.Wrap;
        return tb;
    }

    private TextBlock GitChevron(bool expanded)
    {
        return new TextBlock
        {
            Text = expanded ? "" : "", // MDL2 ChevronDown / ChevronRight
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 8,
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 2, 0)
        };
    }

    private Border GitDot(Brush fill) => new()
    {
        Width = 6, Height = 6, CornerRadius = new CornerRadius(3),
        Background = fill, VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(2, 0, 2, 0)
    };

    private Border GitCountPill(string text, string brushKey)
    {
        var fg = (SolidColorBrush)FindResource(brushKey);
        return new Border
        {
            Padding = new Thickness(6, 1, 6, 1),
            Margin = new Thickness(3, 0, 0, 0),
            CornerRadius = new CornerRadius(99),
            Background = new SolidColorBrush(fg.Color) { Opacity = 0.12 },
            BorderThickness = new Thickness(1),
            BorderBrush = new SolidColorBrush(fg.Color) { Opacity = 0.35 },
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = text,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = 8.5,
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                Foreground = fg
            }
        };
    }

    private Border GitSectionHeader(string label, bool open)
    {
        var stack = new StackPanel { Orientation = Orientation.Horizontal };
        stack.Children.Add(GitChevron(open));
        var text = GitText(label, 11, "Brush.Text.Primary");
        text.FontWeight = (FontWeight)FindResource("FontWeight.Bold");
        text.Margin = new Thickness(3, 0, 0, 0);
        stack.Children.Add(text);
        return new Border
        {
            Padding = new Thickness(6, 4, 6, 4),
            Cursor = Cursors.Hand,
            Background = Brushes.Transparent, // hit-testable across the full row width
            Child = stack
        };
    }

    /// <summary>One tree row: a Grid under a transparent (hit-testable) Border. Columns append
    /// in call order — lefts and rights size to content (Auto), the fill takes the rest (Star)
    /// so it is the part that truncates, never the pills.</summary>
    private sealed class GitRow
    {
        public Border Root { get; }
        private readonly Grid _grid = new();

        public GitRow(double indent)
        {
            Root = new Border
            {
                Padding = new Thickness(indent, 3, 6, 3),
                Cursor = Cursors.Hand,
                Background = Brushes.Transparent,
                Child = _grid
            };
        }

        private void Add(UIElement el, GridLength width)
        {
            _grid.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
            Grid.SetColumn(el, _grid.ColumnDefinitions.Count - 1);
            _grid.Children.Add(el);
        }

        public void ColumnLeft(UIElement el) => Add(el, GridLength.Auto);
        public void ColumnFill(UIElement el) => Add(el, new GridLength(1, GridUnitType.Star));
        public void ColumnRight(UIElement el) => Add(el, GridLength.Auto);
    }

    private static GitRow GitRowShell(double indent) => new(indent);
}
